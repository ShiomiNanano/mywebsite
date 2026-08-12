/* =================================================== 工具函数 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function toast(msg, type = 'ok') {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => box.classList.remove('show'), 2400);
}

const coverSVG = `
<svg viewBox="0 0 320 200" class="cover-svg" aria-hidden="true">
  <defs><radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="rgba(232,195,106,0.35)"/><stop offset="100%" stop-color="rgba(232,195,106,0)"/>
  </radialGradient></defs>
  <circle cx="252" cy="52" r="60" fill="url(#moonGlow)"/>
  <path d="M 238 22 A 26 26 0 1 0 254 62 A 21 21 0 0 1 238 22 Z" fill="#e8c36a"/>
  <g fill="#e8c36a" opacity="0.75">
    <circle cx="60" cy="40" r="1.6"/><circle cx="120" cy="70" r="1.2"/><circle cx="40" cy="90" r="1.4"/>
    <circle cx="200" cy="112" r="1.2"/><circle cx="286" cy="122" r="1.5"/><circle cx="70" cy="150" r="1.3"/>
    <circle cx="160" cy="28" r="1.1"/><circle cx="18" cy="130" r="1.3"/>
  </g>
  <g fill="none" stroke="rgba(245,239,226,0.55)" stroke-width="1.4" stroke-linecap="round">
    <path d="M0 150 Q 20 142 40 150 T 80 150 T 120 150 T 160 150 T 200 150 T 240 150 T 280 150 T 320 150"/>
    <path d="M0 162 Q 25 155 50 162 T 100 162 T 150 162 T 200 162 T 250 162 T 300 162 T 320 162"/>
  </g>
  <g fill="#f5efe2">
    <path d="M 60 150 C 58 130 52 120 52 106 C 52 90 66 80 80 80 C 94 80 106 90 106 106 C 106 120 100 132 94 150 Z"/>
    <circle cx="77" cy="78" r="14"/>
    <path d="M 66 70 L 60 52 L 75 64 Z"/><path d="M 82 66 L 92 50 L 92 70 Z"/>
    <path d="M 98 138 C 112 136 118 122 114 112 C 112 106 106 104 102 108" fill="none" stroke="#f5efe2" stroke-width="6" stroke-linecap="round"/>
  </g>
  <g fill="none" stroke="#1c1710" stroke-width="2" stroke-linecap="round">
    <path d="M 69 80 Q 74 76 79 80"/><path d="M 84 80 Q 89 76 94 80"/>
  </g>
</svg>`;

function bindSwipe(el) {
  if (!el) return;
  let sx = null, sy = null;
  el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    sx = null; sy = null;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const prev = el.dataset.prev, next = el.dataset.next;
      if (dx < 0 && next) location.hash = '#/read/' + next;
      else if (dx > 0 && prev) location.hash = '#/read/' + prev;
    }
  }, { passive: true });
}

/* =================================================== 应用主体 */
const App = {
  state: { user: null, menu: null },
  authMode: 'login',
  pendingAvatar: null,

  async init() {
    try {
      const { user } = await API.get('/api/me');
      this.state.user = user;
    } catch (e) {}
    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  async route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const parts = hash.split('/').filter(Boolean);
    // 需要加载数据的页面，先显示骨架屏
    const heavy = ['menu', 'main', 'personal', 'settings', 'read', 'admin'].includes(parts[0]);
    if (heavy) {
      document.getElementById('app').innerHTML = this.loadingSkeleton(parts[0]);
      window.scrollTo(0, 0);
    }
    let view = '';
    try {
      if (parts.length === 0) view = this.renderLanding();
      else if (parts[0] === 'login') view = this.renderLogin();
      else if (parts[0] === 'menu') view = await this.renderMenu();
      else if (parts[0] === 'main') view = parts.length >= 2
        ? await this.renderChapter(parts[1]) : await this.renderMainList();
      else if (parts[0] === 'personal') view = await this.renderPersonal();
      else if (parts[0] === 'settings') view = await this.renderSettings();
      else if (parts[0] === 'read') view = await this.renderRead(parts[1]);
      else if (parts[0] === 'profile') view = this.renderProfile();
      else if (parts[0] === 'admin') {
        const sub = parts[1];
        if (sub === 'new') view = await this.renderAdminForm();
        else if (sub === 'edit') view = await this.renderAdminForm(parts[2]);
        else if (sub === 'users') view = await this.renderAdminUsers();
        else view = await this.renderAdminArticles();
      }
      else view = this.renderLanding();
    } catch (e) {
      view = `<div class="page">${this.topbar()}<div class="notfound">${esc(e.message)}</div></div>`;
    }
    const isOutside = parts.length === 0 || parts[0] === 'login';
    const showNav = this.state.user && !isOutside;
    const active = !showNav ? '' : (['menu', 'main', 'personal', 'settings'].includes(parts[0]) ? parts[0] : '');
    document.getElementById('app').innerHTML = view + (showNav ? this.bottomNav(active) : '');
    window.scrollTo(0, 0);
    this.afterRender();
  },

  loadingSkeleton(kind) {
    const line = (w) => `<span class="sk-line" style="width:${w}%"></span>`;
    let body = '';
    if (kind === 'read') {
      body = `<div class="breadcrumb sk-text"></div>
      <div class="reading sk-reading">
        <div class="sk-title"></div>
        <div class="sk-title" style="width:55%"></div>
        <div class="sk-divider"></div>
        ${Array.from({ length: 9 }, () => `<div class="sk-para">${line(100)}${line(92)}${line(64)}</div>`).join('')}
      </div>`;
    } else if (kind === 'menu') {
      body = `<div class="menu-hero">${line(40)}${line(60)}</div>
      <div class="menu-cards">${Array.from({ length: 3 }, () => `<div class="sk-card"></div>`).join('')}</div>`;
    } else if (kind === 'admin') {
      body = `<div class="admin-nav"></div><div class="admin-head"></div>
      <div class="admin-table-wrap"><div class="sk-card" style="height:320px"></div></div>`;
    } else {
      body = `<div class="page-head">${line(30)}</div>
      <div class="chapter-list">${Array.from({ length: 3 }, () => `<div class="sk-card"></div>`).join('')}</div>`;
    }
    return `<div class="page loading-page">${this.topbar()}${body}</div>`;
  },

  bottomNav(active) {
    const item = (key, ico, txt) => `
      <a class="bn-item ${active === key ? 'active' : ''}" href="#/${key}">
        <span class="bn-ico">${ico}</span><span class="bn-txt">${txt}</span>
      </a>`;
    return `
    <nav class="bottom-nav">
      ${item('menu', '☾', '书架')}
      ${item('main', '☂', '主线')}
      ${item('personal', '✉', '个人')}
      ${item('settings', '❖', '设定')}
    </nav>`;
  },

  /* ---------- 通用片段 ---------- */
  avatarHtml(user, size = 38) {
    const cls = `avatar size-${size}`;
    if (user && user.avatar) return `<img class="${cls}" src="${esc(user.avatar)}" alt="">`;
    const initial = user ? (user.username || '?').charAt(0) : '?';
    return `<div class="${cls} avatar-initial">${esc(initial)}</div>`;
  },

  topbar() {
    const u = this.state.user;
    return `
    <header class="topbar">
      <a class="brand" href="#/menu">
        <span class="brand-mark">☾</span>
        <span class="brand-name">白日梦咖啡馆</span>
      </a>
      <div class="topbar-right">
        ${u ? `
          <a class="topbar-item topbar-hide-mobile" href="#/menu">书架</a>
          ${u.role === 'admin' ? `<a class="topbar-item" href="#/admin/articles">管理</a>` : ''}
          <a href="#/profile" class="topbar-avatar" title="${esc(u.username)}">${this.avatarHtml(u, 38)}</a>
        ` : `<a class="btn btn-small btn-ghost" href="#/login">登录</a>`}
      </div>
    </header>`;
  },

  async ensureMenu() {
    if (!this.state.menu) {
      const m = await API.get('/api/menu');
      this.state.menu = { main: m.main || [], personal: m.personal || [], settings: m.settings || [] };
    }
    return this.state.menu;
  },

  excerpt(a) {
    const txt = (a.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return txt.length > 42 ? txt.slice(0, 42) + '…' : txt;
  },

  /* ---------- 1. 书封面 ---------- */
  renderLanding() {
    return `
    <div class="landing">
      <div class="cover-scene">
        <div class="book-cover" id="bookCover">
          <div class="cover-inner">
            <div class="cover-top">汐凪島 · 物語</div>
            <div class="cover-illus">${coverSVG}</div>
            <h1 class="cover-title">白日梦</h1>
            <div class="cover-sub">— Daydream Café —</div>
            <div class="cover-line"></div>
            <div class="cover-bottom">第一卷 · 如暖阳般和煦</div>
          </div>
        </div>
        <button class="btn-cover" id="openBook">翻 开 这 本 书</button>
      </div>
    </div>`;
  },

  /* ---------- 2. 登录 / 注册 ---------- */
  renderLogin() {
    if (this.state.user) { location.hash = '#/menu'; return ''; }
    return `
    <div class="page login-page">
      ${this.topbar()}
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-head">
            <div class="login-cat">☾</div>
            <h2>白日梦咖啡馆</h2>
            <p class="login-sub">欢迎回来 · 请选择你的座位</p>
          </div>
          <div class="login-tabs">
            <button class="tab active" data-tab="login">登 录</button>
            <button class="tab" data-tab="register">注 册</button>
          </div>
          <form id="loginForm">
            <label>用户名</label>
            <input name="username" placeholder="2-20位用户名" autocomplete="username" required>
            <label>密码</label>
            <input name="password" type="password" placeholder="至少4位" autocomplete="current-password" required>
            <div id="confirmRow">
              <label>确认密码</label>
              <input name="confirmPassword" type="password" placeholder="再次输入密码">
            </div>
            <div class="login-error" id="loginError"></div>
            <button class="btn btn-primary btn-block" type="submit">进入咖啡馆</button>
          </form>
          <div class="demo-tip">
            <p>管理员：<b>admin / admin123</b></p>
            <p>普通用户：<b>demo / demo123</b></p>
          </div>
        </div>
      </div>
    </div>`;
  },

  /* ---------- 3. 书架（三大入口） ---------- */
  async renderMenu() {
    if (!this.state.user) { location.hash = '#/login'; return ''; }
    const m = await this.ensureMenu();
    const cc = m.main.length;
    const sc = m.main.reduce((s, c) => s + (c.sections || []).length, 0);
    return `
    <div class="page">
      ${this.topbar()}
      <div class="menu-hero">
        <p class="menu-greet">晚安，${esc(this.state.user.username)}。</p>
        <p class="menu-quote">“今日海风正好，书已为你翻开。”<span class="quote-author">—— 白日梦咖啡馆</span></p>
      </div>
      <div class="menu-cards">
        <a class="menu-card menu-main" href="#/main">
          <div class="menu-card-badge">主 线</div>
          <div class="menu-card-icon">☂</div>
          <div class="menu-card-content">
            <h3>主线故事</h3>
            <p>第一卷 · 如暖阳般和煦</p>
            <span class="menu-card-meta">${cc} 章 · ${sc} 节</span>
          </div>
          <div class="menu-card-arrow">→</div>
        </a>
        <a class="menu-card" href="#/personal">
          <div class="menu-card-icon">✉</div>
          <div class="menu-card-content">
            <h3>个人章</h3>
            <p>独立成篇 · 各自安放的心事</p>
            <span class="menu-card-meta">${m.personal.length} 篇</span>
          </div>
          <div class="menu-card-arrow">→</div>
        </a>
        <a class="menu-card" href="#/settings">
          <div class="menu-card-icon">❖</div>
          <div class="menu-card-content">
            <h3>设定</h3>
            <p>人物 · 岛屿 · 咖啡馆的来客</p>
            <span class="menu-card-meta">${m.settings.length} 篇</span>
          </div>
          <div class="menu-card-arrow">→</div>
        </a>
      </div>
    </div>`;
  },

  /* ---------- 4. 主线：章列表 ---------- */
  async renderMainList() {
    const m = await this.ensureMenu();
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 主线故事</div>
      <div class="page-head">
        <span class="eyebrow">Main Story</span>
        <h1>主线故事</h1>
        <p>第一卷 · 如暖阳般和煦</p>
      </div>
      <div class="chapter-list">
        ${m.main.length ? m.main.map(c => `
          <a class="chapter-card" href="#/main/${c.chapter_no}">
            <div class="chapter-num">第 ${String(c.chapter_no).padStart(2, '0')} 章</div>
            <div class="chapter-body">
              <h3>${esc(c.chapter_title)}</h3>
              <p>共 ${(c.sections || []).length} 节</p>
            </div>
            <div class="chapter-arrow">→</div>
          </a>`).join('') : '<p class="empty-hint">主线还没有内容，等管理员更新吧。</p>'}
      </div>
    </div>`;
  },

  /* ---------- 5. 主线：某章的节列表 ---------- */
  async renderChapter(chapterNo) {
    const m = await this.ensureMenu();
    const c = m.main.find(x => String(x.chapter_no) === String(chapterNo));
    if (!c) return `<div class="page">${this.topbar()}<div class="notfound">这一章还不存在。</div></div>`;
    const secs = c.sections || [];
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/main">主线故事</a> / ${esc(c.chapter_title)}</div>
      <div class="page-head">
        <span class="eyebrow">第 ${c.chapter_no} 章</span>
        <h1>${esc(c.chapter_title)}</h1>
      </div>
      <div class="section-list">
        ${secs.length ? secs.map(s => `
          <a class="section-card" href="#/read/${s.id}">
            <span class="section-index">${String(s.section_no).padStart(2, '0')}</span>
            <div class="section-body">
              <h3>第 ${s.section_no} 节 · ${esc(s.section_title)}</h3>
              <p>${s.comment_count} 条留言</p>
            </div>
            <span class="section-arrow">→</span>
          </a>`).join('') : '<p class="empty-hint">这一章还没有小节。</p>'}
      </div>
    </div>`;
  },

  /* ---------- 6. 个人章 ---------- */
  async renderPersonal() {
    const m = await this.ensureMenu();
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 个人章</div>
      <div class="page-head">
        <span class="eyebrow">Independent Pieces</span>
        <h1>个人章</h1>
        <p>每一篇，都是一段被妥善安放的心事。</p>
      </div>
      <div class="article-grid">
        ${m.personal.length ? m.personal.map(a => `
          <a class="article-card" href="#/read/${a.id}">
            <div class="card-ico">✉</div>
            <h3>${esc(a.title)}</h3>
            <p>${esc(this.excerpt(a))}</p>
            <span class="card-meta">${a.comment_count} 条留言</span>
          </a>`).join('') : '<p class="empty-hint">个人章还没有内容。</p>'}
      </div>
    </div>`;
  },

  /* ---------- 7. 设定 ---------- */
  async renderSettings() {
    const m = await this.ensureMenu();
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 设定</div>
      <div class="page-head">
        <span class="eyebrow">World Archive</span>
        <h1>设定</h1>
        <p>人物 · 岛屿 · 咖啡馆的来客。</p>
      </div>
      <div class="article-grid">
        ${m.settings.length ? m.settings.map(a => `
          <a class="article-card" href="#/read/${a.id}">
            <div class="card-ico">❖</div>
            <h3>${esc(a.title)}</h3>
            <p>${esc(this.excerpt(a))}</p>
            <span class="card-meta">${a.comment_count} 条留言</span>
          </a>`).join('') : '<p class="empty-hint">设定还没有内容。</p>'}
      </div>
    </div>`;
  },

  /* ---------- 8. 阅读页 + 留言 ---------- */
  catCrumb(a) {
    if (a.category === 'main') return `<a href="#/main">主线故事</a> / <a href="#/main/${a.chapter_no}">${esc(a.chapter_title)}</a> / ${esc(a.section_title)}`;
    if (a.category === 'personal') return `<a href="#/personal">个人章</a> / ${esc(a.title)}`;
    return `<a href="#/settings">设定</a> / ${esc(a.title)}`;
  },
  eyebrow(a) {
    if (a.category === 'main') return `主线 · 第 ${a.chapter_no} 章 · 第 ${a.section_no} 节`;
    if (a.category === 'personal') return '个人章 · 独立篇目';
    return '设定 · 世界档案';
  },

  async renderRead(id) {
    const [article, comments] = await Promise.all([
      API.get('/api/article/' + id),
      API.get('/api/article/' + id + '/comments'),
    ]);
    if (!article) return `<div class="page">${this.topbar()}<div class="notfound">文章不存在。</div></div>`;
    const cmts = comments || [];
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb">${this.catCrumb(article)}</div>
      <article class="reading" data-prev="${article.prev_id || ''}" data-next="${article.next_id || ''}">
        <header class="reading-head">
          <span class="eyebrow">${this.eyebrow(article)}</span>
          <h1>${esc(article.category === 'main' ? article.section_title : article.title)}</h1>
          <div class="reading-divider"><span>❧</span></div>
        </header>
        <div class="reading-content">${article.content}</div>
        <footer class="reading-foot"><span>— 全文完 —</span></footer>
        <div class="reading-nav">
          ${article.prev_id ? `<a class="btn btn-small btn-ghost" href="#/read/${article.prev_id}">← 上一篇</a>` : '<span></span>'}
          ${article.next_id ? `<a class="btn btn-small btn-ghost" href="#/read/${article.next_id}">下一篇 →</a>` : '<span></span>'}
        </div>
        <p class="reading-swipe-hint">手机上左右滑动可切换上一篇 / 下一篇</p>
      </article>

      <section class="comments">
        <h2 class="comments-title">留言 <span class="comments-count">${cmts.length}</span></h2>
        ${this.commentForm(article.id)}
        <div class="comments-list">
          ${cmts.length === 0
            ? '<p class="comments-empty">还没有留言，来占个位置吧。</p>'
            : cmts.map(c => `
              <div class="comment">
                ${this.avatarHtml({ username: c.username, avatar: c.avatar }, 36)}
                <div class="comment-body">
                  <div class="comment-head">
                    <span class="comment-name">${esc(c.username)}</span>
                    <span class="comment-time">${esc(c.created_at)}</span>
                  </div>
                  <div class="comment-content">${esc(c.content)}</div>
                </div>
              </div>`).join('')}
        </div>
      </section>
    </div>`;
  },

  commentForm(articleId) {
    const u = this.state.user;
    if (!u) return `<div class="comment-login-tip">请 <a href="#/login">登录</a> 后留言。</div>`;
    return `
    <form class="comment-form" data-article="${articleId}">
      <div class="comment-form-head">${this.avatarHtml(u, 36)}<span>以「${esc(u.username)}」的身份留言</span></div>
      <textarea name="content" placeholder="写下你的感受……" rows="3" maxlength="2000" required></textarea>
      <div class="comment-form-foot"><button class="btn btn-small btn-primary" type="submit">发布留言</button></div>
    </form>`;
  },

  /* ---------- 9. 个人中心 ---------- */
  renderProfile() {
    const u = this.state.user;
    if (!u) { location.hash = '#/login'; return ''; }
    return `
    <div class="page">
      ${this.topbar()}
      <div class="profile-card">
        ${this.avatarHtml(u, 96)}
        <h2>${esc(u.username)}</h2>
        <p class="profile-role">${u.role === 'admin' ? '管理员' : '普通会员'}</p>
        <p class="profile-since">加入于 ${esc(u.created_at || '—')}</p>
        <div class="profile-avatar-edit">
          <h3>自定义头像</h3>
          <p class="hint">未设置头像时，默认显示用户名的第一个字。</p>
          <div class="avatar-edit-row">
            <input type="text" id="avatarUrl" placeholder="粘贴图片链接（http/https）" value="${esc(u.avatar || '')}">
          </div>
          <div class="avatar-edit-row">
            <label class="btn btn-small btn-ghost btn-file">选择本地图片<input type="file" id="avatarFile" accept="image/*" hidden></label>
          </div>
          <div class="avatar-edit-row">
            <button class="btn btn-small btn-primary" id="saveAvatar">保存头像</button>
            ${u.avatar ? `<button class="btn btn-small btn-ghost" id="clearAvatar">恢复默认</button>` : ''}
          </div>
          <div class="avatar-preview"><span>预览</span>${this.avatarHtml(u, 56)}</div>
        </div>
        <div class="profile-actions">
          <button class="btn btn-small btn-ghost" id="logoutBtn">退出登录</button>
          ${u.role === 'admin' ? `<a class="btn btn-small btn-ghost" href="#/admin/articles">进入管理后台</a>` : ''}
        </div>
      </div>
    </div>`;
  },

  /* ---------- 10. 管理后台 ---------- */
  adminNav(active) {
    return `<div class="admin-nav">
      <a class="${active === 'articles' ? 'active' : ''}" href="#/admin/articles">文章管理</a>
      <a class="${active === 'users' ? 'active' : ''}" href="#/admin/users">用户管理</a>
    </div>`;
  },

  async renderAdminArticles() {
    const u = this.state.user;
    if (!u || u.role !== 'admin') { location.hash = '#/menu'; return ''; }
    const articles = await API.get('/api/admin/articles');
    const list = articles || [];
    const cn = { main: '主线', personal: '个人章', settings: '设定' };
    return `
    <div class="page">
      ${this.topbar()}
      ${this.adminNav('articles')}
      <div class="admin-head">
        <h2>文章管理</h2>
        <a class="btn btn-small btn-primary" href="#/admin/new">＋ 新增文章</a>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>分类</th><th>章·节</th><th>标题</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>
          ${list.length ? list.map(a => `
            <tr>
              <td>${a.id}</td>
              <td><span class="tag tag-${a.category}">${cn[a.category]}</span></td>
              <td>${a.category === 'main' ? `${a.chapter_no} · ${a.section_no}` : '—'}</td>
              <td class="td-title">${esc(a.category === 'main' ? a.section_title : a.title)}</td>
              <td>${esc(a.updated_at)}</td>
              <td>
                <button class="btn btn-small btn-ghost" data-action="edit-article" data-id="${a.id}">编辑</button>
                <button class="btn btn-small btn-danger" data-action="delete-article" data-id="${a.id}">删除</button>
              </td>
            </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--ink-soft)">还没有文章，点右上角「＋ 新增文章」发布第一篇吧。</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  },

  async renderAdminForm(id) {
    const u = this.state.user;
    if (!u || u.role !== 'admin') { location.hash = '#/menu'; return ''; }
    let a = null;
    if (id) a = await API.get('/api/admin/articles/' + id);
    const category = a ? a.category : 'main';
    const isMain = category === 'main';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/admin/articles">管理后台</a> / ${id ? '编辑文章' : '新增文章'}</div>
      <div class="admin-form-wrap">
        <form id="adminForm" data-id="${id || ''}" class="admin-form">
          <div class="form-row">
            <label>分类</label>
            <select name="category" id="articleCategory">
              <option value="main" ${isMain ? 'selected' : ''}>主线</option>
              <option value="personal" ${category === 'personal' ? 'selected' : ''}>个人章</option>
              <option value="settings" ${category === 'settings' ? 'selected' : ''}>设定</option>
            </select>
          </div>
          <div class="form-row inline" id="mainFields" ${isMain ? '' : 'style="display:none"'}>
            <div>
              <label>章号</label>
              <input name="chapter_no" type="number" min="1" placeholder="如 1" value="${a ? a.chapter_no : ''}">
            </div>
            <div>
              <label>章节标题</label>
              <input name="chapter_title" placeholder="如：如暖阳般和煦" value="${a ? esc(a.chapter_title) : ''}">
            </div>
          </div>
          <div class="form-row inline" ${isMain ? '' : 'style="display:none"'}>
            <div>
              <label>节号</label>
              <input name="section_no" type="number" min="1" placeholder="如 1" value="${a ? a.section_no : ''}">
            </div>
            <div>
              <label>节标题</label>
              <input name="section_title" placeholder="如：新港来的青年" value="${a ? esc(a.section_title) : ''}">
            </div>
          </div>
          <div class="form-row" id="titleRow" ${isMain ? 'style="display:none"' : ''}>
            <label>标题</label>
            <input name="title" placeholder="请输入文章标题" value="${a ? esc(a.title) : ''}">
          </div>
          <div class="form-row">
            <label>正文内容 <span class="hint">（段落之间用空行分隔）</span></label>
            <textarea name="content" rows="14" placeholder="在此粘贴正文……">${a ? esc(a.content_text) : ''}</textarea>
          </div>
          <div class="form-row">
            <button class="btn btn-primary" type="submit">${id ? '保存修改' : '发布文章'}</button>
            <a class="btn btn-ghost" href="#/admin/articles">取消</a>
          </div>
        </form>
      </div>
    </div>`;
  },

  async renderAdminUsers() {
    const u = this.state.user;
    if (!u || u.role !== 'admin') { location.hash = '#/menu'; return ''; }
    const users = await API.get('/api/admin/users');
    const list = users || [];
    return `
    <div class="page">
      ${this.topbar()}
      ${this.adminNav('users')}
      <div class="admin-head"><h2>用户管理</h2></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>加入时间</th><th>操作</th></tr></thead>
          <tbody>
          ${list.map(x => `
            <tr>
              <td>${x.id}</td>
              <td>${esc(x.username)}</td>
              <td>${x.role === 'admin' ? '<span class="tag tag-main">管理员</span>' : '<span class="tag tag-personal">用户</span>'}</td>
              <td>${esc(x.created_at)}</td>
              <td>
                ${x.username === this.state.user.username ? '<span class="hint">（当前账号）</span>' : `
                  <button class="btn btn-small btn-ghost" data-action="set-role" data-id="${x.id}"
                    data-role="${x.role === 'admin' ? 'user' : 'admin'}">
                    ${x.role === 'admin' ? '设为用户' : '设为管理员'}
                  </button>
                  <button class="btn btn-small btn-danger" data-action="delete-user" data-id="${x.id}">删除</button>`}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  },

  /* ---------- 事件绑定 ---------- */
  afterRender() {
    const openBtn = document.getElementById('openBook');
    if (openBtn) {
      openBtn.onclick = () => {
        document.getElementById('bookCover').classList.add('turning');
        setTimeout(() => { location.hash = this.state.user ? '#/menu' : '#/login'; }, 900);
      };
    }

    document.querySelectorAll('[data-tab]').forEach(t => {
      t.onclick = () => this.switchAuthTab(t.dataset.tab);
    });
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.onsubmit = (e) => this.handleLogin(e);

    const commentForm = document.querySelector('.comment-form');
    if (commentForm) commentForm.onsubmit = (e) => this.handleComment(e);

    const saveAvatar = document.getElementById('saveAvatar');
    if (saveAvatar) saveAvatar.onclick = () => this.handleSaveAvatar();
    const clearAvatar = document.getElementById('clearAvatar');
    if (clearAvatar) clearAvatar.onclick = () => this.handleClearAvatar();
    const avatarFile = document.getElementById('avatarFile');
    if (avatarFile) avatarFile.onchange = (e) => this.handleAvatarFile(e);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = () => this.handleLogout();

    const adminForm = document.getElementById('adminForm');
    if (adminForm) adminForm.onsubmit = (e) => this.handleAdminForm(e);
    const catSelect = document.getElementById('articleCategory');
    if (catSelect) {
      catSelect.onchange = () => {
        const isMain = catSelect.value === 'main';
        document.getElementById('mainFields').style.display = isMain ? '' : 'none';
        document.getElementById('titleRow').style.display = isMain ? 'none' : '';
      };
    }

    bindSwipe(document.querySelector('.reading'));
  },

  switchAuthTab(tab) {
    this.authMode = tab;
    document.querySelectorAll('[data-tab]').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab));
    const form = document.getElementById('loginForm');
    form.classList.toggle('register-mode', tab === 'register');
    form.querySelector('button[type=submit]').textContent =
      tab === 'register' ? '创建账号，进入咖啡馆' : '进入咖啡馆';
    document.getElementById('loginError').textContent = '';
  },

  async handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.username.value.trim();
    const password = form.password.value;
    const errEl = document.getElementById('loginError');
    try {
      if (this.authMode === 'register') {
        if (password !== form.confirmPassword.value) throw new Error('两次输入的密码不一致');
        await API.post('/api/register', { username, password });
        toast('账号已创建，欢迎来到白日梦咖啡馆');
      } else {
        await API.post('/api/login', { username, password });
        toast('欢迎回来，' + username);
      }
      const { user } = await API.get('/api/me');
      this.state.user = user;
      location.hash = '#/menu';
    } catch (err) {
      errEl.textContent = err.message;
    }
  },

  async handleComment(e) {
    e.preventDefault();
    const form = e.target;
    try {
      await API.post('/api/article/' + form.dataset.article + '/comments',
        { content: form.content.value.trim() });
      toast('留言已发布');
      this.state.menu = null;
      this.route();
    } catch (err) { toast(err.message, 'err'); }
  },

  handleAvatarFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('图片请小于 2MB', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      this.pendingAvatar = reader.result;
      toast('已读取图片，点击“保存头像”生效');
    };
    reader.readAsDataURL(file);
  },

  async handleSaveAvatar() {
    let avatar = (document.getElementById('avatarUrl').value || '').trim();
    if (this.pendingAvatar) avatar = this.pendingAvatar;
    try {
      const { user } = await API.put('/api/me/avatar', { avatar });
      this.state.user = user;
      this.pendingAvatar = null;
      toast('头像已更新');
      this.route();
    } catch (err) { toast(err.message, 'err'); }
  },

  async handleClearAvatar() {
    try {
      const { user } = await API.put('/api/me/avatar', { avatar: '' });
      this.state.user = user;
      toast('已恢复默认头像');
      this.route();
    } catch (err) { toast(err.message, 'err'); }
  },

  async handleLogout() {
    await API.post('/api/logout');
    this.state.user = null;
    this.state.menu = null;
    toast('已退出，期待下次见面');
    location.hash = '#/';
  },

  async handleAdminForm(e) {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.id || null;
    const category = form.category.value;
    const payload = { category, content: form.content.value.trim() };
    if (category === 'main') {
      payload.chapter_no = parseInt(form.chapter_no.value, 10);
      payload.chapter_title = form.chapter_title.value.trim();
      payload.section_no = parseInt(form.section_no.value, 10);
      payload.section_title = form.section_title.value.trim();
    } else {
      payload.title = form.title.value.trim();
    }
    try {
      if (id) { await API.put('/api/admin/articles/' + id, payload); toast('文章已更新'); }
      else { await API.post('/api/admin/articles', payload); toast('文章已发布'); }
      this.state.menu = null;
      location.hash = '#/admin/articles';
    } catch (err) { toast(err.message, 'err'); }
  },
};

/* 全局委托：管理后台的编辑 / 删除 / 角色按钮 */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;
  if (action === 'edit-article') { location.hash = '#/admin/edit/' + id; return; }
  if (action === 'delete-article') {
    if (confirm('确定删除这篇文章吗？')) {
      try {
        await API.del('/api/admin/articles/' + id);
        App.state.menu = null;
        toast('已删除');
        location.hash = '#/admin/articles';
      } catch (err) { toast(err.message, 'err'); }
    }
    return;
  }
  if (action === 'set-role') {
    const role = el.dataset.role;
    if (confirm('确定将该用户角色设为「' + (role === 'admin' ? '管理员' : '普通用户') + '」吗？')) {
      try {
        await API.put('/api/admin/users/' + id, { role });
        toast('已更新');
        location.hash = '#/admin/users';
      } catch (err) { toast(err.message, 'err'); }
    }
    return;
  }
  if (action === 'delete-user') {
    if (confirm('确定删除该用户吗？其留言将保留并标记为“已注销”。')) {
      try {
        await API.del('/api/admin/users/' + id);
        toast('已删除');
        location.hash = '#/admin/users';
      } catch (err) { toast(err.message, 'err'); }
    }
    return;
  }
});

document.addEventListener('DOMContentLoaded', () => App.init());