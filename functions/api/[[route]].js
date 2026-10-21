// Cloudflare Pages Function —— 白日梦咖啡馆 API（D1 数据库版）
//
// 表结构见仓库根目录 schema.sql（换新库时先跑一次）。
// 需要的环境变量（Pages → Settings → Environment variables）：
//   AUTH_SECRET        必填，至少 32 位的随机字符串，用于签发登录令牌
//   DEEPSEEK_API_KEY   对话功能的密钥（该功能已下线，恢复时才需要）
//   CHAT_DAILY_LIMIT   可选，全站每日对话条数上限，默认 300，设为 0 表示不限制（同上）
//   TURNSTILE_SITE_KEY / TURNSTILE_SECRET  可选，两个都要配才会启用注册/登录人机验证
//
// 安全要点（改动说明）：
//   1. AUTH_SECRET 不再有硬编码兜底：没配置就不认任何会话，登录会直接报错提示去配置。
//   2. Cookie 加了 Secure。
//   3. 所有 JSON 响应默认 no-store，只有公开只读接口显式允许缓存。
//   4. 头像限制长度与协议；登录有失败次数限制；对话有全站每日预算。

const COOKIE = 'daydream_session';
const ONE_DAY = 86400;
const MAX_BODY = 1024 * 1024;      // 请求体上限 1MB
const MAX_AVATAR = 300000;         // 头像字符串上限（约 200KB 图片）
const MAX_CONTENT = 200000;        // 单篇正文上限
const CHAT_PER_MINUTE = 15;        // 每个用户每分钟的对话条数
const LOGIN_MAX_FAILS = 10;        // 同一用户名在窗口内的最大失败次数
const LOGIN_WINDOW_MIN = 15;       // 登录失败统计窗口（分钟）
const CHAT_PAGE_SIZE = 50;         // 留言默认每页条数
const CHAT_PAGE_MAX = 100;

// 咖啡馆前台（AI 对话）开关：暂时下线。
//   false = /api/chat、/api/chat/config、/api/admin/chat-config 一律返回 404，
//           前端也已经没有入口（前端代码存档在 archive/chat-module.js）。
//   恢复方法见 archive/chat-module.js 顶部说明：把这里改成 true，再把前端接回去。
const CHAT_FEATURE = false;

const DEFAULT_PERSONA = '你是汐凪岛「白日梦咖啡馆」的咖啡师潮見柒乃。你安静少言，说话简短而温柔，偶尔带一点神秘感。你不追问来客的姓名，也不在意谁记得谁，你只是陪愿意坐下来的人聊几句。回答请用中文，尽量简短自然（一般不超过150字），像日常说话一样，不要说“作为一个AI/语言模型”之类的话。';
const DEFAULT_GREETING = '欢迎来到白日梦咖啡馆。今天想聊点什么？';

/* ---------- 错误：只有 HttpError 的 message 会返回给前端 ---------- */
class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/* ---------- 基础工具 ---------- */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
// 公开只读接口：短缓存 + 后台续期，减轻 D1 读取
function jsonPublic(data, maxAge = 30) {
  return json(data, 200, { 'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=300` });
}
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function publicUser(u) {
  return { id: u.id, username: u.username, avatar: u.avatar || '', role: u.role, created_at: u.created_at };
}
function parseCookies(req) {
  const h = req.headers.get('cookie') || '';
  const o = {};
  h.split(';').forEach(c => { const i = c.indexOf('='); if (i > -1) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return o;
}
function setCookie(token) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ONE_DAY * 7}`; }
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
const enc = new TextEncoder();
function toHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function encB64(obj) { return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decB64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(atob(s)); }

/* ---------- 密钥：没有配置就拒绝，绝不回退到默认值 ---------- */
// 长度下限 16 位；短于 32 位会在日志里提醒一次（建议换成 32 位以上的随机串）。
// 注意：这里只做长度检查，不做强度检查——密钥的强度靠你自己挑选。
let warnedShortSecret = false;
function authSecret(env) {
  const s = env.AUTH_SECRET;
  if (!s || String(s).length < 16) {
    throw new HttpError('服务端未配置 AUTH_SECRET，请在 Cloudflare Pages 的环境变量里设置一个至少 16 位的字符串', 500);
  }
  const str = String(s);
  if (str.length < 32 && !warnedShortSecret) {
    warnedShortSecret = true;
    console.warn('AUTH_SECRET 长度只有 ' + str.length + ' 位，建议换成 32 位以上的随机串（openssl rand -hex 32）');
  }
  return str;
}

/* ---------- 密码（PBKDF2）与登录令牌（HMAC 签名） ---------- */
async function hashPassword(password, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, km, 256);
  return toHex(bits);
}
async function makePasswordHash(password) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return salt + '$' + await hashPassword(password, salt);
}
// 定长比较，避免用 === 泄露前缀信息
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyPassword(password, stored) {
  const [salt, h] = (stored || '').split('$');
  if (!salt || !h) return false;
  return safeEqual(h, await hashPassword(password, salt));
}
async function sign(data, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  let s = ''; sig.forEach(b => s += String.fromCharCode(b));
  return data + '.' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function verifyToken(token, secret) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const data = token.slice(0, dot), sigPart = token.slice(dot + 1);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  try {
    let sig = sigPart.replace(/-/g, '+').replace(/_/g, '/'); while (sig.length % 4) sig += '=';
    const bytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, bytes, enc.encode(data));
    if (!ok) return null;
    const p = decB64(data);
    if (p.exp < Date.now() / 1000) return null;
    return p;
  } catch (e) { return null; }
}

/* ---------- 正文格式转换 ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
/* ---------- 简易富文本标记 → HTML ----------
   ⚠️ 必须和 public/js/rich.js 里的 render() 保持一致：前端用它做实时预览，
      后端用它生成正式正文。两边不一致，作者看到的和发布的就不一样了。
      （测试里有一条"逐条比对两边输出"守这个。）
   先转义再套标签 —— 顺序反了的话，粘贴进来的 <script> 会被当成真标签执行。 */
var COLOR_NAME = { r: 'red', y: 'yellow', b: 'blue', g: 'green' };

function richInline(s) {
  return escapeHtml(String(s == null ? '' : s))
    .replace(/\{\{([rybg])\|([^{}]+)\}\}/g, function (m, k, t) {
      return '<span class="t-' + COLOR_NAME[k] + '">' + t + '</span>';
    })
          .replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, function (m, target, label) {
        const t = String(target).trim();
        const show = String(label || target).trim();
        return '<a class="wiki" href="#/wiki/' + encodeURIComponent(t) + '">' + show + '</a>';
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}
function richParas(buf, cls) {
  return buf.map(b => b.trim()).filter(Boolean)
    .map(b => '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + richInline(b) + '</p>')
    .join('');
}
function richCard(head, buf) {
  const parts = String(head || '').split('|');
  const name = (parts[0] || '').trim();
  const note = (parts[1] || '').trim();
  const lines = buf.slice();
  let meta = '';
  if (lines.length && /^@\s?/.test(lines[0].trim())) meta = lines.shift().trim().replace(/^@\s?/, '');
  return '<div class="char-block">' +
    ((name || note)
      ? '<div class="char-head">' +
        (name ? '<span class="char-name">' + richInline(name) + '</span>' : '') +
        (note ? '<span class="char-note">' + richInline(note) + '</span>' : '') +
        '</div>'
      : '') +
    (meta ? '<p class="char-meta">' + richInline(meta) + '</p>' : '') +
    richParas(lines, 'char-desc') +
    '</div>';
}
function richNote(head, buf) {
  return '<div class="rc-note">' +
    (head ? '<p class="rc-note-title">' + richInline(head) + '</p>' : '') +
    richParas(buf) +
    '</div>';
}
function richToHtml(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { i++; continue; }

    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(t);
    if (img) {
      out.push('<figure><img src="' + img[2] + '" alt="' + escapeHtml(img[1]) + '" loading="lazy" decoding="async">' +
        (img[1] ? '<figcaption>' + escapeHtml(img[1]) + '</figcaption>' : '') + '</figure>');
      i++; continue;
    }
    if (/^(?:-\s*){3,}$/.test(t) || /^(?:\*\s*){3,}$/.test(t)) { out.push('<hr>'); i++; continue; }

    const h = /^(#{2,3})\s+(.+)$/.exec(t);
    if (h) {
      const lv = h[1].length;
      out.push('<h' + lv + '>' + richInline(h[2]) + '</h' + lv + '>');
      i++; continue;
    }
    if (/^>\s?/.test(t)) {
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '').trim()); i++; }
      out.push('<blockquote>' + richParas(q) + '</blockquote>');
      continue;
    }
      // 场景分隔：单独一行 :::scene，不需要收尾
      if (/^:::scene\s*$/.test(t)) {
        out.push('<div class="rc-scene" role="separator">\u2767</div>');
        i++; continue;
      }
      // 对白 / 书信 / 剧透折叠（后者用原生 <details>，不需要任何 JS）
      var blk4 = /^:::(say|letter|spoiler)\s*(.*)$/.exec(t);
      if (blk4) {
        var kind4 = blk4[1], head4 = blk4[2].trim(), buf4 = [];
        i++;
        while (i < lines.length && lines[i].trim() !== ':::') { buf4.push(lines[i]); i++; }
        i++;
        if (kind4 === 'say') {
          out.push('<div class="rc-say">' + (head4 ? '<span class="rc-say-who">' + richInline(head4) + '</span>' : '')
            + '<div class="rc-say-body">' + richParas(buf4) + '</div></div>');
        } else if (kind4 === 'letter') {
          out.push('<div class="rc-letter">' + (head4 ? '<div class="rc-letter-head">' + richInline(head4) + '</div>' : '')
            + '<div class="rc-letter-body">' + richParas(buf4) + '</div></div>');
        } else {
          out.push('<details class="rc-spoiler"><summary>' + (head4 ? richInline(head4) : '剧透预警')
            + '</summary><div class="rc-spoiler-body">' + richParas(buf4) + '</div></details>');
        }
        continue;
      }    const blk = /^:::(card|note)\s*(.*)$/.exec(t);
    if (blk) {
      const kind = blk[1], head = blk[2].trim(), buf = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') { buf.push(lines[i]); i++; }
      i++;
      out.push(kind === 'card' ? richCard(head, buf) : richNote(head, buf));
      continue;
    }
    let html = richInline(t);
    while (/ {2}$/.test(lines[i]) && i + 1 < lines.length && lines[i + 1].trim()) {
      i++;
      html += '<br>' + richInline(lines[i].trim());
    }
    out.push('<p>' + html + '</p>');
    i++;
  }
  return out.join('\n');
}

// 纯文本 → HTML（后台粘贴正文用）。默认转义，避免粘贴进来的 <script> 被当成标签执行。
//   整篇一个空行都没有 → 每行自动算一段（从 Word / 网页直接粘过来就是这种形态，作者不用手动补空行）
//   整篇有空行        → 按空行分段，段内的单个换行保留为 <br>
// 这样"手动粘贴"和"Word 导入"两条路径都能自动分段，旧文重新编辑也不会变形。
function plainToHtml(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  if (!src) return '';
  const blocks = /\n[ \t]*\n/.test(src) ? src.split(/\n[ \t]*\n+/) : src.split('\n');
  return blocks.map(b => {
    b = b.trim();
    return b ? '<p>' + escapeHtml(b).replace(/\n/g, '<br>') + '</p>' : '';
  }).join('');
}
function htmlToPlain(h) {
  return (h || '').replace(/<\/p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
// 后台表单：勾了「原始 HTML」就原样存，否则交给 plainToHtml 自动分段
function makeContent(body) {
  // 富文本模式：编辑器把标记原文放在 source 里，正文 HTML 由后端统一生成
  if (typeof body.source === 'string' && body.raw_html !== true) {
    return richToHtml(body.source).slice(0, MAX_CONTENT);
  }
  const raw = String(body.content || '').trim();
  if (body.raw_html === true) return raw.slice(0, MAX_CONTENT);
  return plainToHtml(raw);
}
// 标记原文：只有富文本模式才存；切到原始 HTML 模式就清空，
// 否则下次打开编辑器会拿旧的标记覆盖掉刚写的 HTML。
function makeSource(body) {
  return (typeof body.source === 'string' && body.raw_html !== true)
    ? body.source.slice(0, MAX_CONTENT) : '';
}
// 判断正文里是否有 <p>/<br> 之外的富文本结构（用于后台自动切换 HTML 模式）
function looksRich(html) {
  return /<(div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|section|article|figure|figcaption|span|strong|em|b|i|u|img|a|hr|pre|code)\b/i.test(html || '');
}
// 目录用的短摘要：先截断 HTML，再转纯文本，再截 42 字
function makeExcerpt(head) {
  const plain = htmlToPlain(String(head || '')).replace(/<[^>]*$/, '');
  return plain.length > 42 ? plain.slice(0, 42) + '…' : plain;
}

/* ---------- 表结构：每个 isolate 只检查一次（不再是每个请求都建表） ---------- */
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  // 老库没有 articles.source（富文本编辑器的标记原文），这里补一下。
  // 注意：别用 PRAGMA table_info 去探测 —— D1 上那条会抛错（被 catch 吞掉后
  // 字段就永远加不上，表现为 SELECT source 直接 500）。直接 ALTER 最省事：
  // 字段已存在时这条会报错，忽略即可；表还不存在则交给下面的建表语句。
  try { await env.DB.prepare('ALTER TABLE articles ADD COLUMN source TEXT').run(); } catch (e) {}
  // 卡片简介（可单独编辑，避免卡片上剧透正文）
  try { await env.DB.prepare('ALTER TABLE articles ADD COLUMN summary TEXT').run(); } catch (e) {}
  /* 设定篇的标签：类型复用 chapter_title（设定类文章本来不用章标题），
     标签另开一列，逗号分隔。老库自动补列。 */
  try { await env.DB.prepare('ALTER TABLE articles ADD COLUMN tags TEXT').run(); } catch (e) {}
  /* 设定的公开性：0 = 公开，1 = 锁定。锁定的设定在列表里只露名字，读不到正文。 */
  try { await env.DB.prepare('ALTER TABLE articles ADD COLUMN locked INTEGER').run(); } catch (e) {}

  /* 小游戏的分数表：一款游戏一个榜，取每个用户的最高分排前五 */
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, user_id INTEGER, username TEXT, score INTEGER NOT NULL, created_at TEXT)'
    ).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_scores_game ON scores (game, score DESC)').run();
    /* 幻梦牌的段位：每人一行，服务端保存（跨设备）。rating 是段位分。 */
    await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS game_rank (game TEXT NOT NULL, user_id INTEGER NOT NULL, username TEXT, rating INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (game, user_id))'
    ).run();
    /* 连胜：服务端也记一份，连胜奖励按这里的数算（跨设备一致）。老库自动补列。 */
    try { await env.DB.prepare('ALTER TABLE game_rank ADD COLUMN streak INTEGER NOT NULL DEFAULT 0').run(); } catch (e) { /* 已经有了 */ }
  } catch (e) {}
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_usage (user_id INTEGER PRIMARY KEY, minute INTEGER NOT NULL, cnt INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_daily (day INTEGER PRIMARY KEY, cnt INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (username TEXT PRIMARY KEY, window_minute INTEGER NOT NULL, fails INTEGER NOT NULL)`),
  ]);
  schemaReady = true;
}

/* ---------- 设置项（管理员配置对话人格等） ---------- */
async function getSetting(env, key, def) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
  return r ? r.value : def;
}
function setSettingStmt(env, key, value) {
  return env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value);
}
async function setSetting(env, key, value) {
  await setSettingStmt(env, key, value).run();
}

/* ---------- 对话限流：每用户每分钟 + 全站每天 ---------- */
async function chatRateLimit(env, userId) {
  const minute = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare('SELECT * FROM chat_usage WHERE user_id=?').bind(userId).first();
  if (!row) {
    await env.DB.prepare('INSERT INTO chat_usage (user_id, minute, cnt) VALUES (?,?,?)').bind(userId, minute, 1).run();
    return true;
  }
  if (row.minute === minute) {
    if (row.cnt >= CHAT_PER_MINUTE) return false;
    await env.DB.prepare('UPDATE chat_usage SET cnt=cnt+1 WHERE user_id=?').bind(userId).run();
    return true;
  }
  await env.DB.prepare('UPDATE chat_usage SET minute=?, cnt=1 WHERE user_id=?').bind(minute, userId).run();
  return true;
}
async function chatDailyAllow(env) {
  const limit = parseInt(env.CHAT_DAILY_LIMIT || '300', 10);
  if (!isNaN(limit) && limit <= 0) return true;   // 设 0 = 不限制
  const cap = isNaN(limit) ? 300 : limit;
  const day = Math.floor(Date.now() / 86400000);
  const row = await env.DB.prepare('SELECT * FROM chat_daily WHERE day=?').bind(day).first();
  if (!row) {
    await env.DB.prepare('INSERT INTO chat_daily (day, cnt) VALUES (?,?)').bind(day, 1).run();
    return true;
  }
  if (row.cnt >= cap) return false;
  await env.DB.prepare('UPDATE chat_daily SET cnt=cnt+1 WHERE day=?').bind(day).run();
  return true;
}

/* ---------- 登录失败限制 ---------- */
async function loginFails(env, username) {
  const row = await env.DB.prepare('SELECT * FROM login_attempts WHERE username=?').bind(username).first();
  if (!row) return 0;
  if (Math.floor(Date.now() / 60000) - row.window_minute >= LOGIN_WINDOW_MIN) return 0;
  return row.fails;
}
async function loginFail(env, username) {
  const now = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare('SELECT * FROM login_attempts WHERE username=?').bind(username).first();
  if (!row || now - row.window_minute >= LOGIN_WINDOW_MIN) {
    await env.DB.prepare('INSERT INTO login_attempts (username, window_minute, fails) VALUES (?,?,1) ON CONFLICT(username) DO UPDATE SET window_minute=excluded.window_minute, fails=1')
      .bind(username, now).run();
  } else {
    await env.DB.prepare('UPDATE login_attempts SET fails=fails+1 WHERE username=?').bind(username).run();
  }
}
async function loginClear(env, username) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
}

/* ---------- 人机验证（可选，配了 TURNSTILE_SECRET 才生效） ---------- */
async function verifyTurnstile(env, request, body) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return;
  const token = (body && body.turnstile_token) || '';
  if (!token) throw new HttpError('请先完成人机验证', 400);
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!data || !data.success) throw new HttpError('人机验证失败，请重试', 400);
}

/* ---------- 调用 DeepSeek ---------- */
async function callDeepSeek(env, messages) {
  const key = env.DEEPSEEK_API_KEY || '';
  if (!key) throw new Error('对话服务未配置（缺少 DEEPSEEK_API_KEY）');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.8, max_tokens: 500 }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch (e) {}
      throw new Error('对话服务出错了（' + res.status + '）' + (detail ? '：' + detail : ''));
    }
    const data = await res.json();
    const reply = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    if (!reply) throw new Error('对话服务返回为空');
    return reply;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('对话服务响应超时，请稍后再试');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function currentUser(env, request) {
  // 没配置 AUTH_SECRET 时：不认任何会话（也不回退到默认密钥），公开阅读仍可用
  let secret;
  try { secret = authSecret(env); } catch (e) { return null; }
  const cookies = parseCookies(request);
  const payload = await verifyToken(cookies[COOKIE], secret);
  if (!payload) return null;
  return env.DB.prepare('SELECT id, username, avatar, role, created_at FROM users WHERE id=?').bind(payload.uid).first();
}

async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }

/* ---------- 主入口 ---------- */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  try {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
      return json({ error: '请求体过大' }, 413);
    }

    await ensureSchema(env);
    const user = await currentUser(env, request);

    // 咖啡馆前台（AI 对话）已下线：相关接口统一 404，连登录都不必校验
    if (!CHAT_FEATURE && (path === '/chat' || path === '/chat/config' || path === '/admin/chat-config')) {
      return json({ error: '这个功能已经下线了' }, 404);
    }

    /* ===== 站点公开配置 ===== */
    if (method === 'GET' && path === '/config') {
      return jsonPublic({ turnstile_site_key: env.TURNSTILE_SITE_KEY || '' }, 300);
    }
    if (method === 'GET' && path === '/health') {
      return json({ ok: true, time: nowStr() });
    }

    /* ===== 认证 ===== */
    if (method === 'POST' && path === '/login') {
      authSecret(env);   // 配置缺失就在这里立刻报错，而不是等密码校验通过之后
      const body = await readBody(request);
      await verifyTurnstile(env, request, body);
      const name = (body.username || '').trim();
      if (name && (await loginFails(env, name)) >= LOGIN_MAX_FAILS) {
        return json({ error: '尝试次数过多，请 ' + LOGIN_WINDOW_MIN + ' 分钟后再试' }, 429);
      }
      const u = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(name).first();
      if (!u || !(await verifyPassword(body.password || '', u.password_hash))) {
        if (name) await loginFail(env, name);
        return json({ error: '用户名或密码错误' }, 401);
      }
      await loginClear(env, name);
      const token = await sign(encB64({ uid: u.id, exp: Math.floor(Date.now() / 1000) + ONE_DAY * 7 }), authSecret(env));
      return json({ ok: true, user: publicUser(u) }, 200, { 'Set-Cookie': setCookie(token) });
    }
    if (method === 'POST' && path === '/register') {
      // 先确认密钥配置好了：否则会出现「账号已入库但接口返回 500」的半途失败
      authSecret(env);
      const body = await readBody(request);
      await verifyTurnstile(env, request, body);
      const name = (body.username || '').trim();
      const pw = String(body.password || '');
      if (!/^[\w\u4e00-\u9fff]{2,20}$/.test(name)) return json({ error: '用户名需为2-20位的中文、字母、数字或下划线' }, 400);
      if (pw.length < 8) return json({ error: '密码至少8位' }, 400);
      if (await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()) return json({ error: '用户名已存在' }, 400);
      let r;
      try {
        r = await env.DB.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)')
          .bind(name, await makePasswordHash(pw), 'user', nowStr()).run();
      } catch (e) {
        // 并发注册同名会被唯一索引拦下
        if (/UNIQUE|constraint/i.test(String(e && e.message))) return json({ error: '用户名已存在' }, 400);
        throw e;
      }
      const u = await env.DB.prepare('SELECT id, username, avatar, role, created_at FROM users WHERE id=?').bind(r.meta.last_row_id).first();
      const token = await sign(encB64({ uid: u.id, exp: Math.floor(Date.now() / 1000) + ONE_DAY * 7 }), authSecret(env));
      return json({ ok: true, user: u }, 201, { 'Set-Cookie': setCookie(token) });
    }
    if (method === 'POST' && path === '/logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
    if (method === 'GET' && path === '/me') return json({ user });

    if (method === 'PUT' && path === '/me/avatar') {
      if (!user) return json({ error: '请先登录' }, 401);
      const body = await readBody(request);
      const avatar = String(body.avatar || '').trim();
      if (avatar.length > MAX_AVATAR) return json({ error: '头像过大，请压缩后再试' }, 413);
      if (avatar && !(avatar.startsWith('data:image/') || avatar.startsWith('https://'))) {
        return json({ error: '头像格式无效（只支持 https 图片或本地上传）' }, 400);
      }
      await env.DB.prepare('UPDATE users SET avatar=? WHERE id=?').bind(avatar, user.id).run();
      const u = await env.DB.prepare('SELECT id, username, avatar, role, created_at FROM users WHERE id=?').bind(user.id).first();
      return json({ ok: true, user: u });
    }

    /* ===== 阅读（公开，游客可读） ===== */
    if (method === 'GET' && path === '/menu') {
      // 注意：这里只取正文的前 400 字用来生成摘要，绝不把全文带进目录接口。
      // 否则每次打开书架都要下载整本小说。
      const rows = await env.DB.prepare(`SELECT a.id, a.category, a.chapter_no, a.chapter_title,
        a.section_no, a.section_title, a.title, a.created_at,
        substr(a.content, 1, 400) AS head, a.summary, a.tags, a.chapter_title AS setting_type, a.locked,
        (SELECT COUNT(*) FROM comments c WHERE c.article_id = a.id) AS comment_count
        FROM articles a ORDER BY a.category, a.chapter_no, a.section_no, a.sort_order, a.id`).all();
      const main = [], mmap = {}, personal = [], settings = [];
      // 每个分类里最新一篇文章的发布时间（UTC 的 "YYYY-MM-DD HH:MM:SS"，字符串比较即时间先后）。
      // 只回这一个时间戳，不给每条都带上 created_at —— 那样目录接口会白胖一圈。
      const latest = { main: '', personal: '', settings: '' };
      for (const a of rows.results) {
        if (a.created_at && a.created_at > (latest[a.category] || '')) latest[a.category] = a.created_at;
        const it = {
          id: a.id, category: a.category,
          chapter_no: a.chapter_no, chapter_title: a.chapter_title,
          section_no: a.section_no, section_title: a.section_title,
          title: a.title,
          excerpt: (a.summary && String(a.summary).trim()) ? String(a.summary).trim() : makeExcerpt(a.head),
          setting_type: a.setting_type || '',
          locked: Number(a.locked) ? 1 : 0,
          tags: a.tags || '',
          comment_count: Number(a.comment_count),
        };
        if (a.category === 'main') {
          const k = a.chapter_no + '|' + a.chapter_title;
          if (!mmap[k]) { mmap[k] = { chapter_no: a.chapter_no, chapter_title: a.chapter_title, sections: [] }; main.push(mmap[k]); }
          mmap[k].sections.push(it);
        } else if (a.category === 'personal') personal.push(it);
        else settings.push(it);
      }
      return jsonPublic({ main, personal, settings, latest }, 60);
    }

    // 文章详情：只查文章本身（上下篇由前端用已缓存的目录计算）
    let m = path.match(/^\/article\/(\d+)$/);
    if (method === 'GET' && m) {
      const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(Number(m[1])).first();
      if (!a) return json({ error: '文章不存在' }, 404);
      // 锁定的设定：只有管理员能读正文（列表里仍然只有名字 ✓）
      if (Number(a.locked) && !(user && user.role === 'admin')) {
        return json({ error: '这篇设定是锁定的', locked: 1 }, 403);
      }
      // source 是作者的标记原文，只走后台接口；塞进给读者的响应会让它大一倍
      const pub = Object.assign({}, a);
      delete pub.source;
      return jsonPublic(pub, 300);
    }

    // 书架页的「今日一句」：从正文里随机挑一句还算完整的话。
    // 只挑长度合适、以句末标点结尾的句子，避免摘出半句话或者一整段。
    if (method === 'GET' && path === '/quote') {
      const row = await env.DB.prepare(
        "SELECT title, chapter_title, section_title, content FROM articles WHERE category IN ('main','personal') ORDER BY RANDOM() LIMIT 1"
      ).first();
      if (!row) return json({ text: '', from: '' });
      const plain = htmlToPlain(row.content || '').replace(/\s+/g, ' ').trim();
      const sentences = plain.split(/(?<=[。！？…])/).map(s => s.trim())
        .filter(s => s.length >= 10 && s.length <= 48);
      const text = sentences.length
        ? sentences[Math.floor(Math.random() * sentences.length)]
        : plain.slice(0, 32);
      const from = row.chapter_title ? (row.chapter_title + ' · ' + row.section_title) : row.title;
      return jsonPublic({ text, from: from || '' }, 60);
    }

    m = path.match(/^\/article\/(\d+)\/comments$/);
    if (method === 'GET' && m) {
      const articleId = Number(m[1]);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || String(CHAT_PAGE_SIZE), 10) || CHAT_PAGE_SIZE, 1), CHAT_PAGE_MAX);
      const before = parseInt(url.searchParams.get('before') || '', 10);
      const base = 'SELECT id, article_id, user_id, username, avatar, content, created_at FROM comments WHERE article_id=?';
      const rows = before
        ? await env.DB.prepare(base + ' AND id<? ORDER BY id DESC LIMIT ?').bind(articleId, before, limit + 1).all()
        : await env.DB.prepare(base + ' ORDER BY id DESC LIMIT ?').bind(articleId, limit + 1).all();
      const got = rows.results || [];
      const hasMore = got.length > limit;
      const items = (hasMore ? got.slice(0, limit) : got).reverse();  // 按时间正序展示
      const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM comments WHERE article_id=?').bind(articleId).first();
      return jsonPublic({
        items,
        has_more: hasMore,
        total: Number((totalRow && totalRow.c) || items.length),
        next_before: items.length ? items[0].id : null,
      }, 15);
    }
    if (method === 'POST' && m) {
      if (!user) return json({ error: '请先登录' }, 401);
      const body = await readBody(request);
      const content = String(body.content || '').trim();
      if (!content) return json({ error: '留言不能为空' }, 400);
      if (content.length > 2000) return json({ error: '留言过长' }, 400);
      const r = await env.DB.prepare('INSERT INTO comments (article_id, user_id, username, avatar, content, created_at) VALUES (?,?,?,?,?,?)')
        .bind(Number(m[1]), user.id, user.username, user.avatar || '', content, nowStr()).run();
      const c = await env.DB.prepare('SELECT * FROM comments WHERE id=?').bind(r.meta.last_row_id).first();
      return json(c, 201);
    }

    /* ===== 留言板 =====
       复用 comments 表：article_id = 0 表示「留言板」。
       （真实文章 id 从 1 开始，所以不会撞上任何文章；目录接口里那个
        comment_count 子查询是按 article_id = a.id 关联的，也不会把留言板算进去。）
       黑板上的那段话存在 settings 表，key = board_note，只能由管理员修改。 */
    /* ===== 小游戏排行榜 =====
       读：公开（前五名，取每人最高分）。写：需登录 + 开局令牌 + 服务端封顶。
       分数越高越好，所以排序是 score DESC。

       ⚠️ 防作弊（2026-10 加）：以前客户端 POST 什么分数就存什么，改个包就能交
       99999。现在开一局要先领一枚 HMAC 令牌（含游戏名、用户 id、开局时间），
       交卷必须带上它；服务端用"开局到现在过了多少秒"反推理论上限：
         memory 满分 = 1000 − 8 步×20 − 秒数×3   （8 对牌，最少 8 步）
         number 满分 = 1000 − 3 次×20 − 秒数×3   （三个数，最少 3 次）
       超过上限直接拒收 —— 手速再快也快不过真实时间。令牌绑用户、绑游戏、
       两小时过期，所以拿别人的令牌或者拿昨天的令牌重放都不成立。 */
    const GAME_LIMIT = {
      memory: { steps: 8, stepPts: 20, minSec: 10, hard: 840 },
      number: { steps: 3, stepPts: 20, minSec: 3, hard: 940 }
    };
    if (method === 'POST' && path === '/games/start') {
      if (!user) return json({ error: '登录后才能开始' }, 401);
      const body = await readBody(request);
      const game = String(body.game || '').slice(0, 32) || 'memory';
      if (!GAME_LIMIT[game]) return json({ error: '没有这个游戏' }, 400);
      const t = Math.floor(Date.now() / 1000);
      const token = await sign(encB64({ g: game, u: user.id, t: t, exp: t + 7200 }), authSecret(env));
      return json({ ok: true, game, token });
    }
    if (method === 'GET' && path === '/games/scores') {
      const game = String(url.searchParams.get('game') || '').slice(0, 32) || 'memory';
      const rows = await env.DB.prepare(
        'SELECT username, MAX(score) AS score FROM scores WHERE game=? GROUP BY user_id, username ORDER BY score DESC LIMIT 5'
      ).bind(game).all();
      return jsonPublic({ game, tops: (rows && rows.results) || [] }, 10);
    }
    if (method === 'POST' && path === '/games/scores') {
      if (!user) return json({ error: '登录后才能上榜' }, 401);
      const body = await readBody(request);
      const game = String(body.game || '').slice(0, 32) || 'memory';
      const lim = GAME_LIMIT[game];
      if (!lim) return json({ error: '没有这个游戏' }, 400);
      const score = Math.floor(Number(body.score));
      if (!Number.isFinite(score) || score < 0) return json({ error: '分数不合法' }, 400);
      const claim = await verifyToken(String(body.token || ''), authSecret(env));
      if (!claim || claim.g !== game || claim.u !== user.id) {
        return json({ error: '这一局的凭证对不上，刷新页面重新开始吧' }, 400);
      }
      const spent = Math.floor(Date.now() / 1000) - Number(claim.t || 0);
      if (!(spent >= 0)) return json({ error: '凭证时间异常' }, 400);
      if (spent < lim.minSec) return json({ error: '这一局结束得太快了' }, 400);
      /* 理论满分：1000 起手，每步/每次固定扣分，每秒扣 3 分。
         留 2 秒的宽限（回合计时按整秒截断，客户端与服务端各数一次）。
         再夹到 100 —— 慢局本来就只拿保底 100 分，不能因为太慢反被拒。 */
      const ceiling = Math.min(lim.hard, Math.max(100, 1000 - lim.steps * lim.stepPts - Math.max(0, spent - 2) * 3));
      if (score > ceiling) {
        return json({ error: '这个分数不可能（按用时上限 ' + ceiling + ' 分），已拒收' }, 400);
      }
      await env.DB.prepare('INSERT INTO scores (game, user_id, username, score, created_at) VALUES (?,?,?,?,?)')
        .bind(game, user.id, user.username, score, nowStr()).run();
      const mine = await env.DB.prepare(
        'SELECT MAX(score) AS best FROM scores WHERE game=? AND user_id=?'
      ).bind(game, user.id).first();
      const rows = await env.DB.prepare(
        'SELECT username, MAX(score) AS score FROM scores WHERE game=? GROUP BY user_id, username ORDER BY score DESC LIMIT 5'
      ).bind(game).all();
      return json({ ok: true, best: (mine && mine.best) || score, tops: (rows && rows.results) || [] });
    }

    /* ===== 幻梦牌 · 段位 =====
       读：需登录（返回自己的段位）
       写：需登录，服务端自己算涨幅（不信客户端传来的分数）
       榜：公开，按段位分前五
       段位阶梯与前端一致（七段）：
         浅眠初客 0 / 云游熟客 500 / 半醒学徒 1200 / 梦游咖啡师 2000 /
         日光调梦师 3000 / 清醒造梦官 4200 / 白日梦掌梦人 6000
       对应的 AI：简单 / 普通 / 普通 / 困难 / 困难 / 噩梦 / 噩梦
       （游戏里的 AI 由前端按同一张表决定；这里只管名字和分数线） */
    const RANK_GAME = 'quality';
        function rankTier(rating) {
      if (rating >= 6000) return '白日梦掌梦人';
      if (rating >= 4200) return '清醒造梦官';
      if (rating >= 3000) return '日光调梦师';
      if (rating >= 2000) return '梦游咖啡师';
      if (rating >= 1200) return '半醒学徒';
      if (rating >= 500) return '云游熟客';
      return '浅眠初客';
    }
    async function readRank(env, userId) {
      const row = await env.DB.prepare(
        'SELECT rating, wins, losses, streak FROM game_rank WHERE game=? AND user_id=?'
      ).bind(RANK_GAME, userId).first();
      const rating = (row && row.rating) || 0;
      return {
        rating, tier: rankTier(rating), wins: (row && row.wins) || 0, losses: (row && row.losses) || 0,
        streak: (row && row.streak) || 0
      };
    }
    if (method === 'GET' && path === '/games/rank') {
      if (!user) return json({ error: '登录后才能查看段位' }, 401);
      const me = await readRank(env, user.id);
      return json({ game: RANK_GAME, ...me });
    }
    if (method === 'POST' && path === '/games/rank') {
      if (!user) return json({ error: '登录后才能记录段位' }, 401);
      const body = await readBody(request);
      const result = String(body.result || '').slice(0, 12);
      const rounds = Math.max(0, Math.min(999, Math.floor(Number(body.rounds) || 0)));
      const oppPts = Math.max(0, Math.min(999, Math.floor(Number(body.oppPts) || 0)));
      const cur = await readRank(env, user.id);
      const haunt = body.haunt === true;      // 这一局是不是"被噩梦盯上"的那局
      let rating = cur.rating;
      let wins = cur.wins;
      let losses = cur.losses;
      let streak = cur.streak;
      let delta = 0;
      let omenBonus = 0;
      let streakBonus = 0;
      if (result === 'win') {
        // 速胜多、磨局少：原始值 = 1000 − 回合×8 − 对手剩余点数×3，减基线 400 再除 12，钳 5~50
        delta = Math.max(5, Math.min(50, Math.round((1000 - rounds * 8 - oppPts * 3 - 400) / 12)));
        // 连胜彩蛋：本来打不到噩梦的段位（<4200 分 = 梦游咖啡师及以下）打赢被盯上的那局，额外 +30
        if (haunt && cur.rating < 4200) { omenBonus = 30; delta += omenBonus; }
        // 连胜奖励：到 3 连胜起，每赢一局额外 +3×连胜数（3 连胜 +9、4 连胜 +12…）
        streak = cur.streak + 1;
        if (streak >= 3) { streakBonus = 3 * streak; delta += streakBonus; }
        rating += delta;
        wins += 1;
      } else if (result === 'loss' || result === 'abandon') {
        delta = -18;
        rating = Math.max(0, rating - 18);
        losses += 1;
        streak = 0;                 // 输了 / 中途放弃 = 连胜中断
      } else {
        return json({ error: '结果不合法' }, 400);
      }
      await env.DB.prepare(
        'INSERT INTO game_rank (game, user_id, username, rating, wins, losses, streak, updated_at) VALUES (?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(game, user_id) DO UPDATE SET username=excluded.username, rating=excluded.rating, wins=excluded.wins, losses=excluded.losses, streak=excluded.streak, updated_at=excluded.updated_at'
      ).bind(RANK_GAME, user.id, user.username, rating, wins, losses, streak, nowStr()).run();
      return json({ ok: true, delta, rating, tier: rankTier(rating), wins, losses, streak, bonus: { omen: omenBonus, streak: streakBonus } });
    }
    if (method === 'GET' && path === '/games/rank/tops') {
      const rows = await env.DB.prepare(
        'SELECT username, rating FROM game_rank WHERE game=? ORDER BY rating DESC, updated_at ASC LIMIT 5'
      ).bind(RANK_GAME).all();
      const tops = ((rows && rows.results) || []).map((x) => ({ username: x.username, rating: x.rating, tier: rankTier(x.rating) }));
      return jsonPublic({ game: RANK_GAME, tops }, 10);
    }
    if (method === 'GET' && path === '/board') {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
      const before = parseInt(url.searchParams.get('before') || '', 10);
      const base = 'SELECT id, user_id, username, avatar, content, created_at FROM comments WHERE article_id=0';
      const rows = before
        ? await env.DB.prepare(base + ' AND id<? ORDER BY id DESC LIMIT ?').bind(before, limit + 1).all()
        : await env.DB.prepare(base + ' ORDER BY id DESC LIMIT ?').bind(limit + 1).all();
      const got = rows.results || [];
      const hasMore = got.length > limit;
      const items = (hasMore ? got.slice(0, limit) : got).reverse();   // 按时间正序展示
      const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM comments WHERE article_id=0').first();
      return jsonPublic({
        note: await getSetting(env, 'board_note', ''),
        items,
        has_more: hasMore,
        total: Number((totalRow && totalRow.c) || items.length),
        next_before: items.length ? items[0].id : null,
        can_post: !!user,
      }, 5);
    }
    /* 留言板：删除某条便签 —— 本人可以删自己的，管理员可以删任何一条。
       （文章留言没有这个能力，只有管理员删文章时连带删掉。留言板敞着，需要它。） */
    m = path.match(/^\/board\/comments\/(\d+)$/);
    if (method === 'DELETE' && m) {
      if (!user) return json({ error: '请先登录' }, 401);
      const id = Number(m[1]);
      const row = await env.DB.prepare('SELECT id, user_id FROM comments WHERE id=? AND article_id=0').bind(id).first();
      if (!row) return json({ error: '留言不存在' }, 404);
      if (!(user.role === 'admin' || row.user_id === user.id)) {
        return json({ error: '只能删自己的留言' }, 403);
      }
      await env.DB.prepare('DELETE FROM comments WHERE id=?').bind(id).run();
      return json({ ok: true });
    }

    if (method === 'POST' && path === '/board/comments') {
      if (!user) return json({ error: '登录后就可以留言了' }, 401);
      const body = await readBody(request);
      const content = String(body.content || '').trim();
      if (!content) return json({ error: '留言不能为空' }, 400);
      if (content.length > 500) return json({ error: '留言请控制在 500 字以内' }, 400);
      /* 防刷：同一用户 10 秒内只能发一条。
         文章留言没有这个限制（在文章下面连发也算正常），但留言板敞着更该拦一下。
         时间戳解析失败就跳过限流，宁可少拦也不要误伤。 */
      const last = await env.DB.prepare('SELECT created_at FROM comments WHERE article_id=0 AND user_id=? ORDER BY id DESC LIMIT 1').bind(user.id).first();
      if (last && last.created_at) {
        const t = new Date(String(last.created_at).replace(' ', 'T') + 'Z').getTime();
        if (Number.isFinite(t) && Date.now() - t < 10000) return json({ error: '发得太快了，稍等一下再发' }, 429);
      }
      const r = await env.DB.prepare('INSERT INTO comments (article_id, user_id, username, avatar, content, created_at) VALUES (?,?,?,?,?,?)')
        .bind(0, user.id, user.username, user.avatar || '', content, nowStr()).run();
      const c = await env.DB.prepare('SELECT id, user_id, username, avatar, content, created_at FROM comments WHERE id=?').bind(r.meta.last_row_id).first();
      return json(c, 201);
    }

    /* ===== 对话（LLM，读者与柒乃聊天，需要登录） ===== */
    if (method === 'GET' && path === '/chat/config') {
      if (!user) return json({ error: '请先登录' }, 401);
      const enabled = (await getSetting(env, 'chat_enabled', '1')) === '1';
      const greeting = await getSetting(env, 'chat_greeting', DEFAULT_GREETING);
      return json({ enabled, greeting });
    }
    if (method === 'POST' && path === '/chat') {
      if (!user) return json({ error: '请先登录' }, 401);
      const body = await readBody(request);
      const enabled = (await getSetting(env, 'chat_enabled', '1')) === '1';
      if (!enabled) return json({ error: '柒乃现在休息中，请稍后再来。' }, 403);
      const msgs = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'user' || !(last.content || '').trim()) return json({ error: '消息不能为空' }, 400);
      if (!(await chatRateLimit(env, user.id))) return json({ error: '说话太快啦，让柒乃喘口气吧。' }, 429);
      if (!(await chatDailyAllow(env))) return json({ error: '今天的对话额度用完了，明天再来吧。' }, 429);
      const persona = await getSetting(env, 'chat_persona', DEFAULT_PERSONA);
      const full = [];
      if (persona) full.push({ role: 'system', content: persona });
      msgs.forEach(mm => full.push({ role: mm.role === 'assistant' ? 'assistant' : 'user', content: String(mm.content || '').slice(0, 2000) }));
      let reply;
      try {
        reply = await callDeepSeek(env, full);
      } catch (e) {
        // 让前端看到「对话服务出错了（401）」这类可读提示，而不是统一的服务器错误
        throw new HttpError(e && e.message ? e.message : '对话服务暂不可用', 502);
      }
      return json({ reply });
    }

    /* ===== 管理（管理员） ===== */
    const needAdmin = () => {
      if (!user) return json({ error: '请先登录' }, 401);
      if (user.role !== 'admin') return json({ error: '需要管理员权限' }, 403);
      return null;
    };

    // 后台编辑用：取标记原文（只有管理员拿得到，而且不缓存）。
    // ⚠️ 必须放在 needAdmin 定义之后 —— 它是局部 const，放在前面会触发 TDZ 报错（表现为 500）
    m = path.match(/^\/admin\/source\/(\d+)$/);
    if (method === 'GET' && m) {
      const e = needAdmin(); if (e) return e;
      try {
        const row = await env.DB.prepare('SELECT source, content FROM articles WHERE id=?').bind(Number(m[1])).first();
        if (!row) return json({ error: '文章不存在' }, 404);
        return json({ source: row.source || '' });
      } catch (err) {
        // 只给管理员看的诊断信息：方便定位"字段没加上"这类问题
        return json({ error: '读取标记原文失败', detail: String((err && err.message) || err).slice(0, 160) }, 500);
      }
    }

    /* ---------- 导出（管理员）----------
       · /admin/export/txt/:id  → 单篇 TXT，用于"一节一节导出"
       · /admin/export/zip      → 全部打包成 ZIP，里面一篇一个 txt（不合并成一个文件）
       · /admin/export?format=json → 完整备份（含标记原文 source，日后恢复靠它）
       ZIP 是自己按规范拼的（Worker 里没有 zip 库）：只做"存储"不压缩，
       格式简单、可预期，任何解压软件都能打开。 */
    if (method === 'GET' && (path === '/admin/export/zip' || path.indexOf('/admin/export/txt/') === 0 || path === '/admin/export')) {
      const e = needAdmin(); if (e) return e;
      const stamp = nowStr().slice(0, 10);

      // 把一篇文章渲染成 txt
      const txtOf = (a) => {
        const title = a.category === 'main'
          ? ((a.chapter_title || '') + (a.section_title ? ' · ' + a.section_title : ''))
          : (a.title || '未命名');
        return title + '\n'
          + '更新：' + (a.updated_at || '') + '\n\n'
          + '─'.repeat(20) + '\n\n'
          + htmlToPlain(a.content || '') + '\n';
      };
      // 压缩包里的路径：分类/章/节.txt
      const safe = (t) => String(t || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';
      const pathOf = (a) => {
        if (a.category === 'main') {
          return '主线故事/' + safe(a.chapter_title) + '/' + safe(a.section_title) + '.txt';
        }
        return (a.category === 'personal' ? '个人章' : '设定') + '/' + safe(a.title) + '.txt';
      };

      const one = path.match(/^\/admin\/export\/txt\/(\d+)$/);
      if (one) {
        const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(Number(one[1])).first();
        if (!a) return json({ error: '文章不存在' }, 404);
        const name = safe(a.category === 'main' ? (a.chapter_title + '-' + a.section_title) : a.title) + '.txt';
        return new Response(txtOf(a), { headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': 'attachment; filename="' + encodeURIComponent(name) + '"',
          'cache-control': 'no-store'
        } });
      }

      const rows = await env.DB.prepare(
        'SELECT * FROM articles ORDER BY category, chapter_no, section_no, id'
      ).all();
      const items = (rows && rows.results) || [];

      if (path === '/admin/export') {
        const payload = {
          site: '白日梦', exported_at: nowStr(), count: items.length,
          articles: items.map(a => ({
            id: a.id, category: a.category, chapter_no: a.chapter_no, chapter_title: a.chapter_title,
            section_no: a.section_no, section_title: a.section_title, title: a.title,
            source: a.source || '', text: htmlToPlain(a.content || ''),
            created_at: a.created_at, updated_at: a.updated_at
          }))
        };
        return new Response(JSON.stringify(payload, null, 2), { headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="daydream-backup-' + stamp + '.json"',
          'cache-control': 'no-store'
        } });
      }

      // ---- 下面是自己拼 ZIP（存储方式，不压缩）----
      const crc32 = (bytes) => {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
          crc ^= bytes[i];
          for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
      };
      const enc = new TextEncoder();
      const files = items.map(a => ({ name: pathOf(a), data: enc.encode(txtOf(a)) }));
      const chunks = [];
      const central = [];
      let offset = 0;
      files.forEach(f => {
        const nameB = enc.encode(f.name);
        const crc = crc32(f.data);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true);          // 本地文件头签名
        lh.setUint16(4, 20, true);                  // 需要版本 2.0
        lh.setUint16(6, 0x0800, true);              // 文件名是 UTF-8
        lh.setUint16(8, 0, true);                   // 存储（不压缩）
        lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);   // 时间/日期留 0
        lh.setUint32(14, crc, true);
        lh.setUint32(18, f.data.length, true);      // 压缩后大小 = 原大小
        lh.setUint32(22, f.data.length, true);
        lh.setUint16(26, nameB.length, true);
        lh.setUint16(28, 0, true);
        chunks.push(new Uint8Array(lh.buffer), nameB, f.data);
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true);          // 中央目录签名
        cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
        cd.setUint16(8, 0x0800, true);
        cd.setUint16(10, 0, true);
        cd.setUint16(12, 0, true); cd.setUint16(14, 0, true);
        cd.setUint32(16, crc, true);
        cd.setUint32(20, f.data.length, true);
        cd.setUint32(24, f.data.length, true);
        cd.setUint16(28, nameB.length, true);
        cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
        cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
        cd.setUint32(38, 0, true);
        cd.setUint32(42, offset, true);             // 本地头偏移
        central.push(new Uint8Array(cd.buffer), nameB);
        offset += 30 + nameB.length + f.data.length;
      });
      const cdSize = central.reduce((n, x) => n + x.length, 0);
      const eocd = new DataView(new ArrayBuffer(22));
      eocd.setUint32(0, 0x06054b50, true);
      eocd.setUint16(8, files.length, true);
      eocd.setUint16(10, files.length, true);
      eocd.setUint32(12, cdSize, true);
      eocd.setUint32(16, offset, true);
      const all = chunks.concat(central, [new Uint8Array(eocd.buffer)]);
      const total = all.reduce((n, x) => n + x.length, 0);
      const out = new Uint8Array(total);
      let p = 0;
      all.forEach(x => { out.set(x, p); p += x.length; });
      return new Response(out, { headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="daydream-' + stamp + '.zip"',
        'cache-control': 'no-store'
      } });
    }

    /* ===== 留言板：黑板内容（仅管理员可改，就是「今日推荐」那块） ===== */
    if (method === 'PUT' && path === '/admin/board') {
      const e = needAdmin(); if (e) return e;
      const body = await readBody(request);
      const note = String(body.note || '').slice(0, 500);
      await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .bind('board_note', note).run();
      return json({ ok: true, note });
    }

    /* ===== 清榜 / 删单条成绩（仅管理员）=====
       整榜：传 game=memory / number 清某一款；传 game=all 清全部
             （要明说 all 才清全部，免得手滑一次把两个榜都抹了）。
       单人：传 name=用户名（或 uid=数字）只删这个人在这个榜上的成绩。
             用户名注册时是唯一的，所以按名字删不会误伤同名的另一个号。 */
    if (method === 'DELETE' && path === '/admin/games/scores') {
      const e = needAdmin(); if (e) return e;
      const game = String(url.searchParams.get('game') || '').slice(0, 32);
      const name = url.searchParams.get('name');
      const uidRaw = url.searchParams.get('uid');
      const uid = Number(uidRaw);
      if (!game) return json({ error: '要说清清哪一个榜（game=memory / number / all）' }, 400);
      if (name) {
        const r = await env.DB.prepare('DELETE FROM scores WHERE game=? AND username=?').bind(game, name).run();
        const gone = (r && r.meta && r.meta.changes) || 0;
        return json({ ok: true, game: game, name: name, removed: gone });
      }
      if (uidRaw !== null && Number.isFinite(uid)) {
        const r2 = await env.DB.prepare('DELETE FROM scores WHERE game=? AND user_id=?').bind(game, uid).run();
        const gone2 = (r2 && r2.meta && r2.meta.changes) || 0;
        return json({ ok: true, game: game, uid: uid, removed: gone2 });
      }
      const r = game === 'all'
        ? await env.DB.prepare('DELETE FROM scores').run()
        : await env.DB.prepare('DELETE FROM scores WHERE game=?').bind(game).run();
      const gone = (r && r.meta && r.meta.changes) || 0;
      return json({ ok: true, game: game, removed: gone });
    }
    if (method === 'GET' && path === '/admin/chat-config') {
      const e = needAdmin(); if (e) return e;
      const enabled = (await getSetting(env, 'chat_enabled', '1')) === '1';
      const persona = await getSetting(env, 'chat_persona', DEFAULT_PERSONA);
      const greeting = await getSetting(env, 'chat_greeting', DEFAULT_GREETING);
      return json({ enabled, persona, greeting });
    }
    if (method === 'PUT' && path === '/admin/chat-config') {
      const e = needAdmin(); if (e) return e;
      const body = await readBody(request);
      await env.DB.batch([
        setSettingStmt(env, 'chat_enabled', body.enabled ? '1' : '0'),
        setSettingStmt(env, 'chat_persona', String(body.persona || '').trim()),
        setSettingStmt(env, 'chat_greeting', String(body.greeting || '').trim()),
      ]);
      return json({ ok: true });
    }

    if (method === 'GET' && path === '/admin/articles') {
      const e = needAdmin(); if (e) return e;
      // 管理列表不显示正文，别把整本书再传一遍
      const rows = await env.DB.prepare(`SELECT id, category, chapter_no, chapter_title, section_no, section_title, title, created_at, updated_at
        FROM articles ORDER BY category, chapter_no, section_no, sort_order, id`).all();
      return json(rows.results);
    }
    m = path.match(/^\/admin\/articles\/(\d+)$/);
    if (method === 'GET' && m) {
      const e = needAdmin(); if (e) return e;
      const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(Number(m[1])).first();
      if (!a) return json({ error: '文章不存在' }, 404);
      // content 是原始 HTML（可能含 <div class="char-block"> 这类结构），content_text 是拍平后的纯文本
      return json({ ...a, content_text: htmlToPlain(a.content), rich: looksRich(a.content) });
    }
    if (method === 'POST' && path === '/admin/articles') {
      const e = needAdmin(); if (e) return e;
      const body = await readBody(request);
      const category = body.category;
      if (!['main', 'personal', 'settings'].includes(category)) return json({ error: '分类无效' }, 400);
      const content = makeContent(body);
      if (!content) return json({ error: '正文不能为空' }, 400);
      const source = makeSource(body);
      const summary = String(body.summary == null ? '' : body.summary).slice(0, 300);
      const tags = String(body.tags == null ? '' : body.tags).slice(0, 200);
      let values;
      const type = String(body.chapter_title || '').trim();   // 同上（新增路径）
      if (category === 'main') {
        const cn = parseInt(body.chapter_no, 10), sn = parseInt(body.section_no, 10);
        if (!Number.isFinite(cn) || cn < 0) return json({ error: '章号必须是 0 或正整数（0 = 序章）' }, 400);
        if (!Number.isFinite(sn) || sn < 1) return json({ error: '节号必须是正整数' }, 400);
        const ct = String(body.chapter_title || '').trim() || (cn === 0 ? '序章' : ('第' + cn + '章'));
        const st = String(body.section_title || '').trim() || ('第' + sn + '节');
        values = [category, cn, ct, sn, st, st, content, source, summary, tags];
      } else {
        const t = String(body.title || '').trim();
        if (!t) return json({ error: '标题不能为空' }, 400);
        values = [category, null, type, null, null, t, content, source, summary, tags];
      }
      // 新增时按传入的公开性（默认公开 0）
      const lockedNew = body.locked ? 1 : 0;
      values.push(lockedNew);
      const r = await env.DB.prepare('INSERT INTO articles (category, chapter_no, chapter_title, section_no, section_title, title, content, source, summary, tags, locked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...values, nowStr(), nowStr()).run();
      const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(r.meta.last_row_id).first();
      return json(a, 201);
    }
    if (method === 'PUT' && m) {
      const e = needAdmin(); if (e) return e;
      const old = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(Number(m[1])).first();
      if (!old) return json({ error: '文章不存在' }, 404);
      const body = await readBody(request);
      const category = body.category || old.category;
      if (!['main', 'personal', 'settings'].includes(category)) return json({ error: '分类无效' }, 400);
      const content = makeContent(body) || old.content;
      const source = makeSource(body);
      const summary = String(body.summary == null ? '' : body.summary).slice(0, 300);
      const tags = String(body.tags == null ? '' : body.tags).slice(0, 200);
      let values;
      const type = String(body.chapter_title || '').trim() || old.chapter_title || '';   // 设定的「类型」，在分支之前定义
      if (category === 'main') {
        const cnRaw = parseInt(body.chapter_no, 10), snRaw = parseInt(body.section_no, 10);
        const cn = Number.isFinite(cnRaw) ? cnRaw : old.chapter_no;
        const sn = Number.isFinite(snRaw) && snRaw >= 1 ? snRaw : old.section_no;
        const ct = String(body.chapter_title || '').trim() || old.chapter_title || (cn === 0 ? '序章' : ('第' + cn + '章'));
        const st = String(body.section_title || '').trim() || old.section_title || ('第' + sn + '节');
        values = [category, cn, ct, sn, st, st, content, source, summary, tags];
      } else {
        const t = String(body.title || '').trim() || old.title || '未命名';
        values = [category, null, type, null, null, t, content, source, summary, tags];
      }
      // 编辑时：没传就沿用原来的公开性
      const lockedPut = body.locked == null ? (Number(old.locked) ? 1 : 0) : (body.locked ? 1 : 0);
      values.push(lockedPut);
      await env.DB.prepare('UPDATE articles SET category=?, chapter_no=?, chapter_title=?, section_no=?, section_title=?, title=?, content=?, source=?, summary=?, tags=?, locked=?, updated_at=? WHERE id=?').bind(...values, nowStr(), old.id).run();
      const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(old.id).first();
      return json(a);
    }
    if (method === 'DELETE' && m) {
      const e = needAdmin(); if (e) return e;
      const id = Number(m[1]);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM articles WHERE id=?').bind(id),
        env.DB.prepare('DELETE FROM comments WHERE article_id=?').bind(id),
      ]);
      return json({ ok: true });
    }

    if (method === 'GET' && path === '/admin/users') {
      const e = needAdmin(); if (e) return e;
      const rows = await env.DB.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
      return json(rows.results);
    }
    m = path.match(/^\/admin\/users\/(\d+)$/);
    if (method === 'PUT' && m) {
      const e = needAdmin(); if (e) return e;
      const body = await readBody(request);
      if (!['user', 'admin'].includes(body.role)) return json({ error: '角色无效' }, 400);
      const uid = Number(m[1]);
      if (uid === user.id) return json({ error: '不能修改自己的角色' }, 400);
      await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(body.role, uid).run();
      return json({ ok: true });
    }
    if (method === 'DELETE' && m) {
      const e = needAdmin(); if (e) return e;
      const uid = Number(m[1]);
      if (uid === user.id) return json({ error: '不能删除自己' }, 400);
      const target = await env.DB.prepare('SELECT id, username FROM users WHERE id=?').bind(uid).first();
      if (!target) return json({ error: '用户不存在' }, 404);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM users WHERE id=?').bind(uid),
        env.DB.prepare('UPDATE comments SET username=?, avatar=?, user_id=NULL WHERE user_id=?').bind('已注销', '', uid),
        env.DB.prepare('DELETE FROM chat_usage WHERE user_id=?').bind(uid),
        env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(target.username),
      ]);
      return json({ ok: true });
    }

    return json({ error: '未知请求' }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    // 数据库报错之类的内容不返回给前端，只写进日志
    console.error('API error:', err && (err.stack || err.message || String(err)));
    return json({ error: '服务器错误，请稍后再试' }, 500);
  }
}

// 导出这两个纯函数，方便测试直接验证「纯文本 → 段落」的规则（Pages 只认 onRequest*，多余导出会被忽略）
export { plainToHtml, htmlToPlain };
