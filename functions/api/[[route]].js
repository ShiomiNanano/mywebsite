// Cloudflare Pages Function —— 白日梦咖啡馆 API（D1 数据库版）
// 注意：本文件不含任何文章内容；数据库首次访问只建表 + 建账号，文章由管理员在后台发布到数据库。

const COOKIE = 'daydream_session';
const ONE_DAY = 86400;

/* ---------- 基础工具 ---------- */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
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
function setCookie(token) { return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_DAY * 7}`; }
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }
const enc = new TextEncoder();
function toHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function encB64(obj) { return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decB64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(atob(s)); }

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
async function verifyPassword(password, stored) {
  const [salt, h] = (stored || '').split('$');
  if (!salt || !h) return false;
  return h === await hashPassword(password, salt);
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

/* ---------- 正文格式转换（后台发布时用） ---------- */
function plainToHtml(text) {
  return (text || '').trim().split(/\n\s*\n/).map(b => { b = b.trim(); return b ? '<p>' + b.replace(/\n/g, '<br>') + '</p>' : ''; }).join('');
}
function htmlToPlain(h) {
  return (h || '').replace(/<\/p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- 建表（表不存在才建）+ 首次创建账号；正常请求只做一次轻量检查 ---------- */
async function initDB(env) {
  let ready = true;
  try {
    await env.DB.prepare('SELECT COUNT(*) c FROM users').first();
  } catch (e) {
    ready = false;
  }
  if (!ready) {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        role TEXT DEFAULT 'user',
        created_at TEXT
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        chapter_no INTEGER,
        chapter_title TEXT,
        section_no INTEGER,
        section_title TEXT,
        title TEXT,
        content TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        user_id INTEGER,
        username TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        content TEXT NOT NULL,
        created_at TEXT
      )`),
    ]);
  }
  const urow = await env.DB.prepare('SELECT COUNT(*) c FROM users').first();
  if (urow.c === 0) {
    const now = nowStr();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)').bind('admin', await makePasswordHash('admin123'), 'admin', now),
      env.DB.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)').bind('demo', await makePasswordHash('demo123'), 'user', now),
    ]);
  }
}

async function currentUser(env, request) {
  const secret = env.AUTH_SECRET || 'daydream-cafe-dev-secret';
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
  const secret = env.AUTH_SECRET || 'daydream-cafe-dev-secret';

  try {
    await initDB(env);
    const user = await currentUser(env, request);

    /* ===== 认证 ===== */
    if (method === 'POST' && path === '/login') {
      const body = await readBody(request);
      const u = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind((body.username || '').trim()).first();
      if (!u || !(await verifyPassword(body.password || '', u.password_hash))) return json({ error: '用户名或密码错误' }, 401);
      const token = await sign(encB64({ uid: u.id, exp: Math.floor(Date.now() / 1000) + ONE_DAY * 7 }), secret);
      return json({ ok: true, user: publicUser(u) }, 200, { 'Set-Cookie': setCookie(token) });
    }
    if (method === 'POST' && path === '/register') {
      const body = await readBody(request);
      const name = (body.username || '').trim();
      if (!/^[\w\u4e00-\u9fff]{2,20}$/.test(name)) return json({ error: '用户名需为2-20位的中文、字母、数字或下划线' }, 400);
      if ((body.password || '').length < 4) return json({ error: '密码至少4位' }, 400);
      if (await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()) return json({ error: '用户名已存在' }, 400);
      const r = await env.DB.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)').bind(name, await makePasswordHash(body.password), 'user', nowStr()).run();
      const u = await env.DB.prepare('SELECT id, username, avatar, role, created_at FROM users WHERE id=?').bind(r.meta.last_row_id).first();
      const token = await sign(encB64({ uid: u.id, exp: Math.floor(Date.now() / 1000) + ONE_DAY * 7 }), secret);
      return json({ ok: true, user: u }, 201, { 'Set-Cookie': setCookie(token) });
    }
    if (method === 'POST' && path === '/logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
    if (method === 'GET' && path === '/me') return json({ user });

    if (method === 'PUT' && path === '/me/avatar') {
      if (!user) return json({ error: '请先登录' }, 401);
      const body = await readBody(request);
      const avatar = (body.avatar || '').trim();
      if (avatar && !(avatar.startsWith('data:image/') || avatar.startsWith('http://') || avatar.startsWith('https://'))) return json({ error: '头像格式无效' }, 400);
      await env.DB.prepare('UPDATE users SET avatar=? WHERE id=?').bind(avatar, user.id).run();
      const u = await env.DB.prepare('SELECT id, username, avatar, role, created_at FROM users WHERE id=?').bind(user.id).first();
      return json({ ok: true, user: u });
    }

    /* ===== 阅读 ===== */
    if (method === 'GET' && path === '/menu') {
      const rows = await env.DB.prepare(`SELECT a.id, a.category, a.chapter_no, a.chapter_title, a.section_no, a.section_title, a.title, a.content,
        (SELECT COUNT(*) FROM comments c WHERE c.article_id = a.id) AS comment_count
        FROM articles a ORDER BY a.category, a.chapter_no, a.section_no, a.sort_order, a.id`).all();
      const main = [], mmap = {}, personal = [], settings = [];
      for (const a of rows.results) {
        const it = { ...a, comment_count: Number(a.comment_count) };
        if (a.category === 'main') {
          const k = a.chapter_no + '|' + a.chapter_title;
          if (!mmap[k]) { mmap[k] = { chapter_no: a.chapter_no, chapter_title: a.chapter_title, sections: [] }; main.push(mmap[k]); }
          mmap[k].sections.push(it);
        } else if (a.category === 'personal') personal.push(it);
        else settings.push(it);
      }
      return json({ main, personal, settings });
    }

    // 文章详情 + 留言（合并成一个请求，避免留言再单独慢一次）
    let m = path.match(/^\/article\/(\d+)$/);
    if (method === 'GET' && m) {
      const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(Number(m[1])).first();
      if (!a) return json({ error: '文章不存在' }, 404);
      const catRows = await env.DB.prepare('SELECT * FROM articles WHERE category=? ORDER BY id').bind(a.category).all();
      const list = a.category === 'main' ? catRows.results.sort((x, y) => (x.chapter_no - y.chapter_no) || (x.section_no - y.section_no)) : catRows.results;
      const i = list.findIndex(x => x.id === a.id);
      const cmtRows = await env.DB.prepare('SELECT id, article_id, user_id, username, avatar, content, created_at FROM comments WHERE article_id=? ORDER BY id ASC').bind(a.id).all();
      return json({
        ...a,
        content_text: htmlToPlain(a.content),
        prev_id: i > 0 ? list[i - 1].id : null,
        next_id: i < list.length - 1 ? list[i + 1].id : null,
        comments: cmtRows.results || [],
        comment_count: (cmtRows.results || []).length,
      });
    }

    m = path.match(/^\/article\/(\d+)\/comments$/);
    if (method === 'GET' && m) {
      const rows = await env.DB.prepare('SELECT id, article_id, user_id, username, avatar, content, created_at FROM comments WHERE article_id=? ORDER BY id ASC').bind(Number(m[1])).all();
      return json(rows.results);
    }
    if (method === 'POST' && m) {
      if (!user) return json({ error: '请先登录' }, 401);
      const body = await readBody(request);
      const content = (body.content || '').trim();
      if (!content) return json({ error: '留言不能为空' }, 400);
      if (content.length > 2000) return json({ error: '留言过长' }, 400);
      const r = await env.DB.prepare('INSERT INTO comments (article_id, user_id, username, avatar, content, created_at) VALUES (?,?,?,?,?,?)')
        .bind(Number(m[1]), user.id, user.username, user.avatar || '', content, nowStr()).run();
      const c = await env.DB.prepare('SELECT * FROM comments WHERE id=?').bind(r.meta.last_row_id).first();
      return json(c, 201);
    }

    /* ===== 管理（管理员） ===== */
    const needAdmin = () => { if (!user) return json({ error: '请先登录' }, 401); if (user.role !== 'admin') return json({ error: '需要管理员权限' }, 403); return null; };

    if (method === 'GET' && path === '/admin/articles') {
      const e = needAdmin(); if (e) return e;
      const rows = await env.DB.prepare('SELECT * FROM articles ORDER BY category, chapter_no, section_no, id').all();
      return json(rows.results);
    }
    m = path.match(/^\/admin\/articles\/(\d+)$/);
    if (method === 'GET' && m) {
      const e = needAdmin(); if (e) return e;
      const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(Number(m[1])).first();
      if (!a) return json({ error: '文章不存在' }, 404);
      return json({ ...a, content_text: htmlToPlain(a.content) });
    }
    if (method === 'POST' && path === '/admin/articles') {
      const e = needAdmin(); if (e) return e;
      const body = await readBody(request);
      const category = body.category;
      if (!['main', 'personal', 'settings'].includes(category)) return json({ error: '分类无效' }, 400);
      const content = plainToHtml((body.content || '').trim());
      if (!content) return json({ error: '正文不能为空' }, 400);
      let values;
      if (category === 'main') {
        const cn = parseInt(body.chapter_no, 10), sn = parseInt(body.section_no, 10);
        if (!cn || !sn) return json({ error: '章号与节号必须为数字' }, 400);
        const ct = (body.chapter_title || '').trim() || ('第' + cn + '章');
        const st = (body.section_title || '').trim() || ('第' + sn + '节');
        values = [category, cn, ct, sn, st, st, content];
      } else {
        const t = (body.title || '').trim();
        if (!t) return json({ error: '标题不能为空' }, 400);
        values = [category, null, null, null, null, t, content];
      }
      const r = await env.DB.prepare('INSERT INTO articles (category, chapter_no, chapter_title, section_no, section_title, title, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(...values, nowStr(), nowStr()).run();
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
      const content = plainToHtml((body.content || '').trim()) || old.content;
      let values;
      if (category === 'main') {
        const cn = parseInt(body.chapter_no, 10) || old.chapter_no, sn = parseInt(body.section_no, 10) || old.section_no;
        const ct = (body.chapter_title || '').trim() || old.chapter_title || ('第' + cn + '章');
        const st = (body.section_title || '').trim() || old.section_title || ('第' + sn + '节');
        values = [category, cn, ct, sn, st, st, content];
      } else {
        const t = (body.title || '').trim() || old.title || '未命名';
        values = [category, null, null, null, null, t, content];
      }
      await env.DB.prepare('UPDATE articles SET category=?, chapter_no=?, chapter_title=?, section_no=?, section_title=?, title=?, content=?, updated_at=? WHERE id=?').bind(...values, nowStr(), old.id).run();
      const a = await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(old.id).first();
      return json(a);
    }
    if (method === 'DELETE' && m) {
      const e = needAdmin(); if (e) return e;
      await env.DB.prepare('DELETE FROM articles WHERE id=?').bind(Number(m[1])).run();
      await env.DB.prepare('DELETE FROM comments WHERE article_id=?').bind(Number(m[1])).run();
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
      await env.DB.prepare('DELETE FROM users WHERE id=?').bind(uid).run();
      await env.DB.prepare('UPDATE comments SET username=?, avatar=?, user_id=NULL WHERE user_id=?').bind('已注销', '', uid).run();
      return json({ ok: true });
    }

    return json({ error: '未知请求' }, 404);
  } catch (err) {
    return json({ error: err.message || '服务器错误' }, 500);
  }
}