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
function richInline(s) {
  return escapeHtml(String(s == null ? '' : s))
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
    const blk = /^:::(card|note)\s*(.*)$/.exec(t);
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
        substr(a.content, 1, 400) AS head,
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
          excerpt: makeExcerpt(a.head),
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
      let values;
      if (category === 'main') {
        const cn = parseInt(body.chapter_no, 10), sn = parseInt(body.section_no, 10);
        if (!Number.isFinite(cn) || cn < 0) return json({ error: '章号必须是 0 或正整数（0 = 序章）' }, 400);
        if (!Number.isFinite(sn) || sn < 1) return json({ error: '节号必须是正整数' }, 400);
        const ct = String(body.chapter_title || '').trim() || (cn === 0 ? '序章' : ('第' + cn + '章'));
        const st = String(body.section_title || '').trim() || ('第' + sn + '节');
        values = [category, cn, ct, sn, st, st, content, source];
      } else {
        const t = String(body.title || '').trim();
        if (!t) return json({ error: '标题不能为空' }, 400);
        values = [category, null, null, null, null, t, content, source];
      }
      const r = await env.DB.prepare('INSERT INTO articles (category, chapter_no, chapter_title, section_no, section_title, title, content, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(...values, nowStr(), nowStr()).run();
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
      let values;
      if (category === 'main') {
        const cnRaw = parseInt(body.chapter_no, 10), snRaw = parseInt(body.section_no, 10);
        const cn = Number.isFinite(cnRaw) ? cnRaw : old.chapter_no;
        const sn = Number.isFinite(snRaw) && snRaw >= 1 ? snRaw : old.section_no;
        const ct = String(body.chapter_title || '').trim() || old.chapter_title || (cn === 0 ? '序章' : ('第' + cn + '章'));
        const st = String(body.section_title || '').trim() || old.section_title || ('第' + sn + '节');
        values = [category, cn, ct, sn, st, st, content, source];
      } else {
        const t = String(body.title || '').trim() || old.title || '未命名';
        values = [category, null, null, null, null, t, content, source];
      }
      await env.DB.prepare('UPDATE articles SET category=?, chapter_no=?, chapter_title=?, section_no=?, section_title=?, title=?, content=?, source=?, updated_at=? WHERE id=?').bind(...values, nowStr(), old.id).run();
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
