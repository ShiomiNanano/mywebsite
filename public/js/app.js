/* =================================================== 工具函数 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 后端存的是 UTC 时间（YYYY-MM-DD HH:MM:SS），这里转成访客本地时间显示
function formatTime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

// 本地图片 → 正方形缩略图（默认 128px webp，约 10KB），避免把 2MB 原图塞进数据库
function shrinkImage(file, size = 128) {
  return new Promise((resolve, reject) => {
    const draw = (src, cleanup) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const s = Math.min(img.width, img.height);
          const ctx = c.getContext('2d');
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          resolve(c.toDataURL('image/webp', 0.85));
        } catch (e) { reject(e); } finally { cleanup && cleanup(); }
      };
      img.onerror = () => { cleanup && cleanup(); reject(new Error('图片读取失败')); };
      img.src = src;
    };
    const url = URL.createObjectURL(file);
    draw(url, () => URL.revokeObjectURL(url));
  });
}

// 封面插画：按小说的意象来 —— 星海巨鲸、它头顶悬着的那颗黑洞、月亮与海
const coverSVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" class="cover-svg" aria-hidden="true">
  <defs>
    <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(240,220,170,0.30)"/>
      <stop offset="100%" stop-color="rgba(240,220,170,0)"/>
    </radialGradient>
    <radialGradient id="eyeGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(240,223,174,0.20)"/>
      <stop offset="100%" stop-color="rgba(240,223,174,0)"/>
    </radialGradient>
    <linearGradient id="whaleBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#dceefb" stop-opacity=".20"/>
      <stop offset="100%" stop-color="#8fc3e4" stop-opacity=".05"/>
    </linearGradient>
  </defs>

  <g class="cv-stars" fill="#d6ecf8">
    <circle cx="36" cy="34" r="1.4" opacity=".85"/><circle cx="70" cy="20" r="1.1" opacity=".7"/>
    <circle cx="150" cy="30" r="1.2" opacity=".75"/><circle cx="196" cy="54" r="1.3" opacity=".8"/>
    <circle cx="26" cy="76" r="1.1" opacity=".6"/><circle cx="174" cy="82" r="1" opacity=".65"/>
    <circle cx="222" cy="98" r="1.2" opacity=".7"/><circle cx="52" cy="52" r="1" opacity=".6"/>
    <circle cx="242" cy="76" r="1.1" opacity=".65"/><circle cx="120" cy="16" r="1" opacity=".55"/>
  </g>

  <circle cx="250" cy="46" r="52" fill="url(#moonGlow)"/>
  <path class="cv-moon" d="M 238 22 A 26 26 0 1 0 254 62 A 21 21 0 0 1 238 22 Z" fill="#f0dfae"/>

  <ellipse cx="106" cy="62" rx="38" ry="25" fill="url(#eyeGlow)"/>
  <path class="cv-hole" d="M 76 62 Q 106 40 136 62 Q 106 84 76 62 Z" fill="#05090d" stroke="rgba(240,223,174,.45)" stroke-width="1"/>
  <circle class="cv-ring" cx="106" cy="62" r="3" fill="none" stroke="rgba(240,223,174,.5)" stroke-width=".9"/>

  <g class="cv-whale" fill="url(#whaleBody)" stroke="rgba(206,232,247,.5)" stroke-width="1.3" stroke-linejoin="round">
    <path d="M 28 130 C 52 104 98 92 146 96 C 190 100 222 114 244 130 C 224 144 178 156 126 156 C 78 156 44 146 28 130 Z"/>
    <path d="M 238 124 C 250 112 262 102 272 96 C 268 116 268 138 272 158 C 260 148 248 136 236 134 Z"/>
    <path d="M 116 146 C 122 162 136 170 150 168 C 140 160 130 152 126 144 Z"/>
  </g>

  <g class="cv-stars-w" fill="#eaf5fb">
    <circle cx="62" cy="132" r="1.5"/><circle cx="98" cy="124" r="1.1"/>
    <circle cx="140" cy="127" r="1.3"/><circle cx="176" cy="134" r="1"/>
    <circle cx="206" cy="141" r="1.2"/>
  </g>
  <path class="cv-line-soft" d="M 44 134 C 82 148 152 152 224 140" fill="none" stroke="rgba(206,232,247,.20)" stroke-width="1"/>
  <path class="cv-line" d="M 30 129 C 38 125 46 125 54 128" fill="none" stroke="rgba(206,232,247,.38)" stroke-width="1.1" stroke-linecap="round"/>

  <g class="cv-wave" fill="none" stroke="rgba(208,232,247,.4)" stroke-width="1.3" stroke-linecap="round">
    <path d="M0 170 Q 20 162 40 170 T 80 170 T 120 170 T 160 170 T 200 170 T 240 170 T 280 170 T 320 170"/>
    <path d="M0 184 Q 26 177 52 184 T 104 184 T 156 184 T 208 184 T 260 184 T 312 184"/>
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

const DEFAULT_TITLE = '白日梦咖啡馆 · 绘空事';

/* =================================================== 应用主体 */
const App = {
  state: { user: null, menu: null, config: { turnstile_site_key: '' } },
  authMode: 'login',
  pendingAvatar: null,
  pageTitle: DEFAULT_TITLE,

  async init() {
    // 主题固定为「夜读」，已由 js/theme-boot.js 在首屏绘制前设好；这里只是兜底
    if (!document.documentElement.getAttribute('data-theme')) {
      document.documentElement.setAttribute('data-theme', 'night');
    }

    // 阅读字号（0 小 / 1 中 / 2 大）
    try { document.documentElement.setAttribute('data-font', localStorage.getItem('daydream-font-size') || '0'); } catch (e) {}

    // 字体延后注入：正文优先用系统字体，装饰/标题字体不再阻塞首屏。
    // （国内直连 fonts.googleapis.com 经常超时，放在这里加载失败也不影响阅读）
    try {
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@600;700&display=swap';
      document.head.appendChild(fontLink);
    } catch (e) {}

    // 登录态与站点配置并行拉取，互不阻塞
    const [me, cfg] = await Promise.all([
      API.get('/api/me').catch(() => null),
      API.get('/api/config').catch(() => null),
    ]);
    this.state.user = (me && me.user) || null;
    this.state.config = { turnstile_site_key: (cfg && cfg.turnstile_site_key) || '' };

    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  applyFont(n) {
    const v = String(Math.min(2, Math.max(0, parseInt(n, 10) || 0)));
    document.documentElement.setAttribute('data-font', v);
    try { localStorage.setItem('daydream-font-size', v); } catch (e) {}
  },

  /* ---------- 上次读到哪儿 ---------- */
  // 注意：书架的「继续阅读」卡片已下线（见 archive/continue-reading.js），
  // 但"上次读到哪"仍然在记录 —— 留着它，哪天想恢复那个模块，改回来就能直接用。
  lastRead() {
    try { return JSON.parse(localStorage.getItem('daydream-last-read') || 'null'); } catch (e) { return null; }
  },
  rememberRead(a) {
    try { localStorage.setItem('daydream-last-read', JSON.stringify({ id: a.id, ts: Date.now() })); } catch (e) {}
  },
  // 在已缓存的目录里按 id 找一篇文章
  findArticle(id) {
    const m = this.state.menu;
    if (!m) return null;
    const all = [];
    (m.main || []).forEach(ch => all.push(...(ch.sections || [])));
    (m.personal || []).forEach(a => all.push(a));
    (m.settings || []).forEach(a => all.push(a));
    return all.find(x => x.id === Number(id)) || null;
  },
  titleOf(a) {
    if (!a) return '';
    return a.category === 'main' ? (a.chapter_title + ' · ' + a.section_title) : a.title;
  },
  // 书架上显示的留言数不用整份重取，直接改缓存即可
  bumpCommentCount(id, d) {
    const a = this.findArticle(id);
    if (a) a.comment_count = Math.max(0, (a.comment_count || 0) + d);
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
    this.pageTitle = DEFAULT_TITLE;
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
      // 咖啡馆前台（AI 对话）已下线：老链接直接送回书架
      else if (parts[0] === 'chat') { location.hash = '#/menu'; return ''; }
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
    // 壁纸背景：封面页和文章页不用，其余主要页面都铺（配色在 CSS 里统一跟随壁纸）
    this.setWallpaper(this.wallpaperOnRoute(hash));

    const isOutside = parts.length === 0 || parts[0] === 'login';
    // 游客也能看书，所以底部导航对所有人显示（登录/封面页除外）
    const showNav = !isOutside;
    const active = !showNav ? '' : (['menu', 'main', 'personal', 'settings'].includes(parts[0]) ? parts[0] : '');
    document.getElementById('app').innerHTML = view + (showNav ? this.bottomNav(active) : '');
    document.title = this.pageTitle || DEFAULT_TITLE;
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
    // 用矢量图标代替原来的 ☾☂✉❖ 文本符号
    const icons = {
      menu: '<path d="M4 5.2h5.2v13.6H4z"/><path d="M9.2 5.2h4.4v13.6H9.2z"/><path d="M15.4 6.6l3.9 1-3 12.2-3.9-1z"/>',
      main: '<path d="M12 7.2C10.4 5.9 8.4 5.2 5.8 5.2H3.5v13.6h2.3c2.6 0 4.6.7 6.2 2 1.6-1.3 3.6-2 6.2-2h2.3V5.2h-2.3c-2.6 0-4.6.7-6.2 2z"/><path d="M12 7.2v13.6"/>',
      personal: '<path d="M3.5 6.4h17v11.2h-17z"/><path d="M3.8 6.9l8.2 5.8 8.2-5.8"/>',
      settings: '<path d="M12 3.4l8.4 4.7-8.4 4.7-8.4-4.7z"/><path d="M3.6 12.6l8.4 4.7 8.4-4.7"/><path d="M3.6 16.8l8.4 4.7 8.4-4.7"/>',
    };
    const item = (key, txt) => `
      <a class="bn-item ${active === key ? 'active' : ''}" href="#/${key}"${active === key ? ' aria-current="page"' : ''}>
        <span class="bn-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg></span>
        <span class="bn-txt">${txt}</span>
      </a>`;
    return `
    <nav class="bottom-nav">
      ${item('menu', '书架')}
      ${item('main', '主线')}
      ${item('personal', '个人')}
      ${item('settings', '设定')}
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

  async ensureMenu(force) {
    if (force || !this.state.menu) {
      const m = await API.get('/api/menu');
      this.state.menu = {
        main: m.main || [], personal: m.personal || [], settings: m.settings || [],
        latest: m.latest || null,   // 各分类最新一篇的时间，书架上的 New! 靠它判断
      };
    }
    return this.state.menu;
  },

  // 摘要由后端生成（目录接口不再返回全文）
  excerpt(a) {
    return (a && a.excerpt) || '';
  },

  /* ---------- 1. 书封面 ---------- */
  renderLanding() {
    return `
    <div class="landing">
      <!-- 动态壁纸：海报打底（首屏秒出），视频由 JS 视情况加载，蒙版保证文字可读 -->
      <div class="wp-shot" aria-hidden="true"></div>
      <video class="wp-video" id="wpVideo" muted loop playsinline preload="none"
             poster="/media/wallpaper-poster.webp" data-src="/media/wallpaper.mp4" aria-hidden="true"></video>
      <div class="wp-veil" aria-hidden="true"></div>
      <div class="cover-scene">
        <div class="book-cover" id="bookCover">
          <div class="cover-inner">
            <div class="cover-top">汐凪島 · 绘空事</div>
            <div class="cover-illus">${coverSVG}</div>
            <h1 class="cover-title">白日梦</h1>
            <div class="cover-sub">— Daydream Café —</div>
            <div class="cover-line"></div>
            <div class="cover-bottom">梦从此刻开始</div>
          </div>
        </div>
        <button class="btn-cover" id="openBook">翻 开 这 本 书</button>
      </div>
    </div>`;
  },

  /* ---------- 2. 登录 / 注册 ---------- */
  renderLogin() {
    if (this.state.user) { location.hash = '#/menu'; return ''; }
    const siteKey = (this.state.config && this.state.config.turnstile_site_key) || '';
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
            <input name="password" type="password" placeholder="至少8位" autocomplete="current-password" required>
            <div id="confirmRow">
              <label>确认密码</label>
              <input name="confirmPassword" type="password" placeholder="再次输入密码">
            </div>
            ${siteKey ? `<div class="turnstile-box" id="turnstileBox" data-sitekey="${esc(siteKey)}"></div>` : ''}
            <div class="login-error" id="loginError"></div>
            <button class="btn btn-primary btn-block" type="submit">进入咖啡馆</button>
          </form>
          <div class="login-guest">
            <a href="#/menu">只想看看书？以访客身份进入 →</a>
          </div>
          <div class="demo-tip">
            <p>咕咕嘎嘎</p>
          </div>
        </div>
      </div>
    </div>`;
  },

  /* ---------- 3. 书架（三大入口 + 与柒乃聊聊） ---------- */
  async renderMenu() {
    const m = await this.ensureMenu();
    const u = this.state.user;
    // 第一次来先静默记下当前进度（不弹 New!），之后靠时间戳比较决定要不要提示
    if (!this.mainSeenTs()) this.markMainSeen();
    const showNew = this.hasNewMain();
    const cc = m.main.length;
    const sc = m.main.reduce((s, c) => s + (c.sections || []).length, 0);
    return `
    <div class="page">
      ${this.topbar()}
      <div class="menu-hero">
        <p class="menu-greet">${u ? '晚安，' + esc(u.username) + '。' : '欢迎来到白日梦咖啡馆。'}</p>
        <p class="menu-quote">“今日海风正好，书已为你翻开。”<span class="quote-author">—— 白日梦咖啡馆</span></p>
      </div>
      <div class="menu-cards">
        <a class="menu-card menu-main" href="#/main">
          <div class="menu-card-badge">主 线</div>
          ${showNew ? '<span class="menu-new">NEW</span>' : ''}
          <div class="menu-card-icon">☂</div>
          <div class="menu-card-content">
            <h3>主线故事</h3>
            <p>梦从此刻开始</p>
            <span class="menu-card-meta">${cc} 章 · ${sc} 节</span>
          </div>
          <div class="menu-card-arrow">→</div>
        </a>
        <a class="menu-card menu-personal" href="#/personal">
          <div class="menu-card-icon">✉</div>
          <div class="menu-card-content">
            <h3>个人章</h3>
            <p>独立成篇 · 各自安放的心事</p>
            <span class="menu-card-meta">${m.personal.length} 篇</span>
          </div>
          <div class="menu-card-arrow">→</div>
        </a>
        <a class="menu-card menu-settings" href="#/settings">
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
    this.markMainSeen();   // 进了这个模块就算看过，New! 消失
    this.pageTitle = '主线故事 · 白日梦咖啡馆';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 主线故事</div>
      <div class="page-head">
        <span class="eyebrow">Main Story</span>
        <h1>主线故事</h1>
        <p>梦从此刻开始</p>
      </div>
      <div class="chapter-list">
        ${m.main.length ? m.main.map(c => `
          <a class="chapter-card" href="#/main/${c.chapter_no}">
            <div class="chapter-num">${this.chapterLabel(c.chapter_no, c.chapter_title)}</div>
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
    this.markMainSeen();   // 进了主线模块里的任一章节，同样算看过
    const c = m.main.find(x => String(x.chapter_no) === String(chapterNo));
    if (!c) return `<div class="page">${this.topbar()}<div class="notfound">这一章还不存在。</div></div>`;
    this.pageTitle = c.chapter_title + ' · 白日梦咖啡馆';
    const secs = c.sections || [];
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/main">主线故事</a> / ${esc(c.chapter_title)}</div>
      <div class="page-head">
        <span class="eyebrow">${this.chapterLabel(c.chapter_no, c.chapter_title)}</span>
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
    this.pageTitle = '个人章 · 白日梦咖啡馆';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 个人章</div>
      <div class="page-head">
        <span class="eyebrow">Independent Pieces</span>
        <h1>个人章</h1>
        <p>每一篇，都是一段被妥善安放的心事。</p>
      </div>
      <div class="article-grid grid-personal">
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
    this.pageTitle = '设定 · 白日梦咖啡馆';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 设定</div>
      <div class="page-head">
        <span class="eyebrow">World Archive</span>
        <h1>设定</h1>
        <p>人物 · 岛屿 · 咖啡馆的来客。</p>
      </div>
      <div class="article-grid grid-settings">
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

  /* ---------- 8. 阅读页 + 留言（文章只等1次查询，留言异步加载） ---------- */
  catCrumb(a) {
    if (a.category === 'main') return `<a href="#/main">主线故事</a> / <a href="#/main/${a.chapter_no}">${esc(a.chapter_title)}</a> / ${esc(a.section_title)}`;
    if (a.category === 'personal') return `<a href="#/personal">个人章</a> / ${esc(a.title)}`;
    return `<a href="#/settings">设定</a> / ${esc(a.title)}`;
  },
  eyebrow(a) {
    if (a.category === 'main') return `主线 · ${this.chapterLabel(a.chapter_no, a.chapter_title)} · 第 ${a.section_no} 节`;
    if (a.category === 'personal') return '个人章 · 独立篇目';
    return '设定 · 世界档案';
  },

  async renderRead(id) {
    // 直接深链进来时目录还是空的，和正文并行加载，这样上下篇按钮不会消失
    const [article] = await Promise.all([
      API.get('/api/article/' + id),
      this.ensureMenu().catch(() => null),
    ]);
    if (!article) return `<div class="page">${this.topbar()}<div class="notfound">文章不存在。</div></div>`;

    // 上下篇用前端已缓存的目录计算，不额外请求数据库
    let prev_id = null, next_id = null;
    const m = this.state.menu;
    if (m) {
      if (article.category === 'main') {
        const all = [];
        m.main.forEach(ch => all.push(...(ch.sections || [])));
        const i = all.findIndex(x => x.id === article.id);
        if (i > 0) prev_id = all[i - 1].id;
        if (i > -1 && i < all.length - 1) next_id = all[i + 1].id;
      } else {
        const list = article.category === 'personal' ? m.personal : m.settings;
        const i = list.findIndex(x => x.id === article.id);
        if (i > 0) prev_id = list[i - 1].id;
        if (i > -1 && i < list.length - 1) next_id = list[i + 1].id;
      }
    }

    const heading = article.category === 'main' ? article.section_title : article.title;
    // 正文字数（去掉标签和空白），阅读页显示"约 N 字"
    const plainLen = String(article.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
    const articleChars = plainLen.toLocaleString('zh-CN');
    this.pageTitle = heading + ' · 白日梦咖啡馆';
    this.rememberRead(article);

    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb">${this.catCrumb(article)}</div>
      <article class="reading reading-cat-${article.category}" data-prev="${prev_id || ''}" data-next="${next_id || ''}">
        <header class="reading-head">
          <span class="eyebrow">${this.eyebrow(article)}</span>
          <h1>${esc(heading)}</h1>
          <div class="reading-meta">${esc(formatTime(article.updated_at))} 更新 · 约 ${articleChars} 字</div>
          <div class="reading-divider"><span>❧</span></div>
        </header>
        <div class="reading-tools">
          <span class="reading-tools-label">字号</span>
          <button class="btn btn-small btn-ghost" id="fontSmaller" title="缩小字号">A－</button>
          <button class="btn btn-small btn-ghost" id="fontLarger" title="放大字号">A＋</button>
        </div>
        <div class="reading-content">${article.content}</div>
        <footer class="reading-foot"><span>— 全文完 —</span></footer>
        <div class="reading-nav">
          ${prev_id ? `<a class="btn btn-small btn-ghost" href="#/read/${prev_id}">← 上一篇</a>` : '<span></span>'}
          ${next_id ? `<a class="btn btn-small btn-ghost" href="#/read/${next_id}">下一篇 →</a>` : '<span></span>'}
        </div>
        <p class="reading-swipe-hint">手机上左右滑动、电脑上按 ← → 可切换上一篇 / 下一篇</p>
      </article>

      <section class="comments">
        <h2 class="comments-title">留言 <span class="comments-count" id="commentCount">…</span></h2>
        ${this.commentForm(article.id)}
        <div class="comments-list" id="commentList" data-article="${article.id}">
          <p class="comments-empty">留言加载中……</p>
        </div>
        <div class="comments-more-wrap" id="commentMoreWrap"></div>
      </section>
    </div>`;
  },

  commentHtml(c) {
    return `
      <div class="comment" data-id="${c.id}">
        ${this.avatarHtml({ username: c.username, avatar: c.avatar }, 36)}
        <div class="comment-body">
          <div class="comment-head">
            <span class="comment-name">${esc(c.username)}</span>
            <span class="comment-time">${esc(formatTime(c.created_at))}</span>
          </div>
          <div class="comment-content">${esc(c.content)}</div>
        </div>
      </div>`;
  },

  async loadCommentsAsync(articleId, listEl) {
    try {
      const data = await API.get('/api/article/' + articleId + '/comments?limit=20');
      const items = (data && data.items) || [];
      const countEl = document.getElementById('commentCount');
      if (countEl) countEl.textContent = (data && typeof data.total === 'number') ? data.total : items.length;
      listEl.innerHTML = items.length === 0
        ? '<p class="comments-empty">还没有留言，来占个位置吧。</p>'
        : items.map(c => this.commentHtml(c)).join('');
      const wrap = document.getElementById('commentMoreWrap');
      if (wrap) {
        wrap.innerHTML = (data && data.has_more)
          ? '<button class="btn btn-small btn-ghost" id="loadMoreComments">加载更早的留言</button>'
          : '';
      }
    } catch (e) {
      listEl.innerHTML = '<p class="comments-empty">留言加载失败，请刷新重试。</p>';
    }
  },

  async loadMoreComments(btn) {
    const listEl = document.getElementById('commentList');
    if (!listEl) return;
    const first = listEl.querySelector('.comment');
    const before = first ? first.dataset.id : '';
    btn.disabled = true;
    btn.textContent = '加载中…';
    try {
      const data = await API.get('/api/article/' + listEl.dataset.article + '/comments?limit=20&before=' + encodeURIComponent(before));
      const items = (data && data.items) || [];
      if (items.length) listEl.insertAdjacentHTML('afterbegin', items.map(c => this.commentHtml(c)).join(''));
      if (data && data.has_more) {
        btn.disabled = false;
        btn.textContent = '加载更早的留言';
      } else {
        btn.remove();
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '加载失败，点击重试';
    }
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
    this.pageTitle = '个人中心 · 白日梦咖啡馆';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="profile-card">
        ${this.avatarHtml(u, 96)}
        <h2>${esc(u.username)}</h2>
        <p class="profile-role">${u.role === 'admin' ? '管理员' : '普通会员'}</p>
        <p class="profile-since">加入于 ${esc(formatTime(u.created_at))}</p>
        <div class="profile-avatar-edit">
          <h3>自定义头像</h3>
          <p class="hint">未设置头像时，默认显示用户名的第一个字。本地上传会自动压缩成 128×128。</p>
          <div class="avatar-edit-row">
            <input type="text" id="avatarUrl" placeholder="粘贴图片链接（https://…）" value="${esc(u.avatar && u.avatar.startsWith('http') ? u.avatar : '')}">
          </div>
          <div class="avatar-edit-row">
            <label class="btn btn-small btn-ghost btn-file">选择本地图片<input type="file" id="avatarFile" accept="image/*" hidden></label>
          </div>
          <div class="avatar-edit-row">
            <button class="btn btn-small btn-primary" id="saveAvatar">保存头像</button>
            ${u.avatar ? `<button class="btn btn-small btn-ghost" id="clearAvatar">恢复默认</button>` : ''}
          </div>
          <div class="avatar-preview"><span>预览</span><span id="avatarPreview">${this.avatarHtml(u, 56)}</span></div>
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
    this.pageTitle = '文章管理 · 白日梦咖啡馆';
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
              <td>${a.category === 'main' ? `${a.chapter_no === 0 ? '序章' : a.chapter_no} · ${a.section_no}` : '—'}</td>
              <td class="td-title">${esc(a.category === 'main' ? a.section_title : a.title)}</td>
              <td>${esc(formatTime(a.updated_at))}</td>
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
    this.pageTitle = (id ? '编辑文章' : '新增文章') + ' · 白日梦咖啡馆';
    this.docImport = null;      // 每次进表单都清掉上一次导入的文件
    let a = null;
    if (id) a = await API.get('/api/admin/articles/' + id);
    const category = a ? a.category : 'main';
    const isMain = category === 'main';
    const rich = !!(a && a.rich);
    const body = a ? (rich ? a.content : a.content_text) : '';
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
          <div class="form-row">
            <label>从文件导入 <span class="hint">（Word 的 .docx，或 .txt / .md）</span></label>
            <div class="doc-import">
              <label class="btn btn-small btn-ghost btn-file">选择文件<input type="file" id="docFile" accept=".docx,.txt,.md,.doc" hidden></label>
              <span class="doc-import-state" id="docState">也可以把文件直接拖到下面任意位置；旧的 .doc 请先在 Word 里另存为 .docx</span>
            </div>
            <div class="doc-summary" id="docSummary" hidden></div>
          </div>
          <div class="form-row inline" id="mainFields" ${isMain ? '' : 'style="display:none"'}>
            <div>
              <label>章号</label>
              <input name="chapter_no" type="number" min="0" placeholder="0 = 序章" value="${a ? a.chapter_no : ''}">
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
            <label>正文内容 <span class="hint">（一行就是一段；工具栏可以插人物卡、图片等）</span></label>
            <div class="editor-toolbar" id="editorToolbar">
              <button type="button" class="et-btn" data-act="bold" title="加粗（Ctrl+B）"><b>B</b></button>
              <button type="button" class="et-btn" data-act="italic" title="斜体（Ctrl+I）"><i>I</i></button>
              <span class="et-sep"></span>
              <button type="button" class="et-btn" data-act="h2">小标题</button>
              <button type="button" class="et-btn" data-act="h3">次级标题</button>
              <button type="button" class="et-btn" data-act="quote">引用</button>
              <button type="button" class="et-btn" data-act="hr">分隔线</button>
              <span class="et-sep"></span>
              <button type="button" class="et-btn et-key" data-act="card">人物卡</button>
              <button type="button" class="et-btn" data-act="note">提示块</button>
              <button type="button" class="et-btn" data-act="image">图片</button>
              <span class="et-sep"></span>
              <button type="button" class="et-btn" data-act="preview" id="etPreviewBtn">显示预览</button>
            </div>
            <div class="editor-split" id="editorSplit">
              <textarea name="content" rows="18" placeholder="在此写正文……">${a ? esc(body) : ''}</textarea>
              <div class="editor-preview" id="editorPreview"><div class="reading-content"></div></div>
            </div>
            <p class="hint" id="paraHint"></p>
          </div>
          <div class="form-row">
            <label class="switch-row"><input type="checkbox" id="rawHtml" ${rich ? 'checked' : ''}> 原始 HTML 模式（高级）</label>
            <p class="hint">勾选后正文会原样保存，不会自动转成 &lt;p&gt; 段落，也不会被转义。用于人物卡这类带结构的内容。</p>
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
    this.pageTitle = '用户管理 · 白日梦咖啡馆';
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
              <td>${esc(formatTime(x.created_at))}</td>
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

  /* ---------- 卡片跟随鼠标的 3D 倾斜 ---------- */
  /* ---------- 「主线故事」有新章节的小提示 ---------- */
  // SQLite 存的是 UTC 的 "YYYY-MM-DD HH:MM:SS"。不补 Z 的话 Date.parse 会按本地时间算，
  // 时区一偏就会把"刚更新"判成"早看过了"（或者反过来一直显示 New!）。
  tsOf(s) {
    // 只接受字符串：传数字 0 进来会变成 Date.parse('0Z')，
    // 那在 Chrome 里是 2000-01-01 而不是 0 —— 假值判断会被它骗过去。
    const t = typeof s === 'string' ? s.trim() : '';
    if (!t) return 0;
    const norm = t.indexOf('T') > -1 ? t : t.replace(' ', 'T');
    const ms = Date.parse(/[Zz]$|[+-]\d\d:?\d\d$/.test(norm) ? norm : norm + 'Z');
    return Number.isFinite(ms) ? ms : 0;
  },
  mainLatest() {
    const m = this.state.menu;
    return this.tsOf(m && m.latest ? m.latest.main : 0);
  },
  mainSeenTs() {
    try {
      const v = Number(localStorage.getItem('daydream-main-seen') || 0);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  },
  // 首次访问（还没有记录）不提示，否则每个新访客一进书架就看到 New!
  hasNewMain() {
    const cur = this.mainLatest(), seen = this.mainSeenTs();
    return cur > 0 && seen > 0 && cur > seen;
  },
  // 点进「主线故事」模块就算看过了 —— 不需要特地去看具体是哪一章
  markMainSeen() {
    const cur = this.mainLatest();
    if (!cur) return;
    try { localStorage.setItem('daydream-main-seen', String(cur)); } catch (e) {}
  },

  // 哪些页面铺壁纸背景：封面页和文章页不铺，其余主要页面都铺。
  // 未知路由会回落到封面页，所以也按"不铺"处理。
  wallpaperOnRoute(route) {
    const h = String(route == null ? location.hash : route).replace(/^#/, '').replace(/^\//, '');
    const first = h.split('/').filter(Boolean)[0] || '';
    return ['login', 'menu', 'main', 'personal', 'settings', 'profile', 'admin'].indexOf(first) >= 0;
  },

  setWallpaper(on) {
    const root = document.documentElement;
    if (on) { this.ensureWallpaperLayer(); root.setAttribute('data-wallpaper', 'on'); }
    else root.removeAttribute('data-wallpaper');
  },

  // 壁纸层只建一次，之后靠 <html data-wallpaper> 切换显隐，避免每次翻页都重建
  ensureWallpaperLayer() {
    if (this._wpLayer || !document.body) return this._wpLayer;
    const el = document.createElement('div');
    el.className = 'wp-bg';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    this._wpLayer = el;
    return el;
  },

  // 主页动态壁纸：只有"宽屏 + 允许动效 + 不省流量 + 网络不差"时才真的去下视频，
  // 其余情况（手机、3G、省流量模式、系统开了减少动态效果）就停在海报图上，不浪费流量。
  initWallpaper() {
    const v = document.getElementById('wpVideo');
    if (!v || v.dataset.loaded) return;
    let wide = false, saveData = false, conn = '';
    try {
      wide = window.matchMedia('(min-width: 900px)').matches;
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (c) { saveData = !!c.saveData; conn = c.effectiveType || ''; }
    } catch (e) {}
    const slow = /(^|-)2g$/.test(conn) || conn === 'slow-2g' || conn === '3g';
    if (!wide || saveData || slow || this.reduceMotion()) return;   // 保持海报图
    const src = v.dataset.src;
    if (!src) return;
    v.dataset.loaded = '1';
    v.addEventListener('canplay', () => v.classList.add('on'), { once: true });
    v.addEventListener('error', () => v.classList.remove('on'), { once: true });
    v.src = src;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});   // 被浏览器拦下就静静退回海报
  },

  // 段落计数：必须和后台 plainToHtml 的规则一致（测试会逐条比对两边结果，防跑偏）
  countParagraphs(text) {
    const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
    if (!src) return 0;
    const blocks = /\n[ \t]*\n/.test(src) ? src.split(/\n[ \t]*\n+/) : src.split('\n');
    return blocks.filter(b => b.trim()).length;
  },

  /* ---------- 后台正文编辑器：工具栏 + 实时预览 ---------- */
  initEditor() {
    const box = document.querySelector('textarea[name="content"]');
    const bar = document.getElementById('editorToolbar');
    const wrap = document.getElementById('editorSplit');
    const pane = document.getElementById('editorPreview');
    if (!box || !bar || !window.Rich) return;
    const R = window.Rich;

    const paint = () => {
      const holder = pane && pane.firstElementChild;
      if (!holder) return;
      const html = R.render(box.value);
      holder.innerHTML = html || '<p class="ph">（还没有内容，左边写完这里就会实时显示）</p>';
    };
    let timer = 0;
    const lazyPaint = () => { clearTimeout(timer); timer = setTimeout(paint, 120); };

    const PLACEHOLDERS = { bold: '加粗文字', italic: '斜体文字' };
    const doAct = (act) => {
      if (act === 'bold') R.surround(box, '**', '**', PLACEHOLDERS.bold);
      else if (act === 'italic') R.surround(box, '*', '*', PLACEHOLDERS.italic);
      else if (act === 'h2') R.prefixLines(box, '## ');
      else if (act === 'h3') R.prefixLines(box, '### ');
      else if (act === 'quote') R.prefixLines(box, '> ');
      else if (act === 'hr') R.insertBlock(box, '---');
      else if (act === 'note') R.insertBlock(box, ':::note 提示标题\n写在这里\n:::', 8, 12);
      else if (act === 'image') R.insertBlock(box, '![图片说明](https://图片地址)', 2, 6);
      else if (act === 'card') {
        const tpl = ':::card 名字 | 别名\n@ 一句话简介（年龄 / 身份 之类）\n正文……\n:::';
        R.insertBlock(box, tpl, 8, 10);
      } else if (act === 'preview') {
        const on = wrap.classList.toggle('preview-off');
        const btn = document.getElementById('etPreviewBtn');
        if (btn) btn.textContent = on ? '显示预览' : '隐藏预览';
      }
      paint();
      const n = this.countParagraphs(box.value);
      const hint = document.getElementById('paraHint');
      if (hint) hint.textContent = '共 ' + n + ' 段（一行一段；工具栏插入的块也算在内）';
    };

    bar.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      ev.preventDefault();
      doAct(btn.dataset.act);
      box.focus();
    });

    box.addEventListener('input', () => {
      lazyPaint();
      this.updateParaHint();
    });

    // Ctrl/Cmd + B / I
    box.addEventListener('keydown', (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = (ev.key || '').toLowerCase();
      if (k !== 'b' && k !== 'i') return;
      ev.preventDefault();
      doAct(k === 'b' ? 'bold' : 'italic');
    });

    paint();

    // 老文章：异步取回标记原文回填。只有用户还没动过输入框才覆盖，
    // 免得网络慢的时候把刚敲的字冲掉。
    const m = location.hash.match(/admin\/edit\/(\d+)/);
    if (!m) return;
    const initial = box.value;
    API.get('/api/admin/source/' + m[1]).then(r => {
      if (r && r.source && box.value === initial) { box.value = r.source; paint(); this.updateParaHint(); }
    }).catch(() => {});
  },

  // 正文框下面的提示：让作者当场看到"会被识别成几段"
  updateParaHint() {
    const el = document.querySelector('textarea[name="content"]');
    const hint = document.getElementById('paraHint');
    if (!el || !hint) return;
    const n = this.countParagraphs(el.value);
    hint.textContent = n === 0
      ? '正文还是空的'
      : '共 ' + n + ' 段（一行就是一段）';
  },

  // 标题像"序章/楔子/引子"的，都按序章对待
  isPrologueTitle(title) {
    return /^\s*(序章|序言|序幕|序曲|楔子|引子|前言)/.test(String(title || ''));
  },

  // 列表与页眉标统一用这个：章号 0（或标题像序章）显示成「序章」
  chapterLabel(no, title) {
    const n = Number(no);
    if (!Number.isFinite(n) || n <= 0) return '序章';
    if (this.isPrologueTitle(title)) return '序章';
    return '第 ' + String(n).padStart(2, '0') + ' 章';
  },

  // 表单里填的章号优先（填 0 就是序章，不能被当成"没填"）；
  // 没填时用导入解析出来的（0 视为"没解析到"），最后兜底第 1 章。
  pickChapterNo(typed, meta) {
    if (Number.isFinite(typed)) return typed;
    const m = Number(meta && meta.chapter_no);
    return (Number.isFinite(m) && m > 0) ? m : 1;
  },

  reduceMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  },

  // 只有"精确指针 + 允许动效"时才启用：触摸设备完全不参与，也不会有额外开销
  initTilt() {
    let fine = false;
    try { fine = window.matchMedia('(pointer: fine)').matches; } catch (e) {}
    if (!fine || this.reduceMotion()) return;

    const cards = document.querySelectorAll('.menu-card, .article-card, .chapter-card, .section-card');
    if (!cards.length) return;
    const MAX = 7;                       // 最大倾斜角度（度）

    Array.prototype.forEach.call(cards, (el) => {
      let raf = 0;
      el.classList.add('js-tilt');
      el.addEventListener('pointermove', (e) => {
        if (raf) return;                 // rAF 节流，避免每次移动都算布局
        raf = requestAnimationFrame(() => {
          raf = 0;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const px = (e.clientX - r.left) / r.width;    // 0..1
          const py = (e.clientY - r.top) / r.height;
          el.style.setProperty('--ry', ((px - 0.5) * MAX * 2).toFixed(2) + 'deg');
          el.style.setProperty('--rx', ((0.5 - py) * MAX * 2).toFixed(2) + 'deg');
          // 高光位置用 px，让它靠 transform 移动（不触发重绘）
          el.style.setProperty('--mx', (px * r.width).toFixed(0) + 'px');
          el.style.setProperty('--my', (py * r.height).toFixed(0) + 'px');
        });
      });
      el.addEventListener('pointerleave', () => {
        ['--rx', '--ry', '--mx', '--my'].forEach((k) => {
          try { el.style.removeProperty(k); } catch (err) {}
        });
      });
    });
  },

  /* ---------- 事件绑定 ---------- */
  afterRender() {
    const openBtn = document.getElementById('openBook');
    if (openBtn) {
      openBtn.onclick = () => {
        document.getElementById('bookCover').classList.add('turning');
        setTimeout(() => { location.hash = '#/menu'; }, 900);
      };
    }

    document.querySelectorAll('[data-tab]').forEach(t => {
      t.onclick = () => this.switchAuthTab(t.dataset.tab);
    });
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.onsubmit = (e) => this.handleLogin(e);
    const turnstileBox = document.getElementById('turnstileBox');
    if (turnstileBox) this.ensureTurnstile(turnstileBox);

    // 后台正文编辑器（工具栏 + 实时预览）；不在后台页会自动跳过
    this.initEditor();

    const commentForm = document.querySelector('.comment-form');
    if (commentForm) commentForm.onsubmit = (e) => this.handleComment(e);
    const moreBtn = document.getElementById('loadMoreComments');
    if (moreBtn) moreBtn.onclick = () => this.loadMoreComments(moreBtn);

    const fontSmaller = document.getElementById('fontSmaller');
    if (fontSmaller) fontSmaller.onclick = () => this.applyFont((parseInt(document.documentElement.getAttribute('data-font'), 10) || 0) - 1);
    const fontLarger = document.getElementById('fontLarger');
    if (fontLarger) fontLarger.onclick = () => this.applyFont((parseInt(document.documentElement.getAttribute('data-font'), 10) || 0) + 1);

    const saveAvatar = document.getElementById('saveAvatar');
    if (saveAvatar) saveAvatar.onclick = () => this.handleSaveAvatar();
    const clearAvatar = document.getElementById('clearAvatar');
    if (clearAvatar) clearAvatar.onclick = () => this.handleClearAvatar();
    const avatarFile = document.getElementById('avatarFile');
    if (avatarFile) avatarFile.onchange = (e) => this.handleAvatarFile(e);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = () => this.handleLogout();

    const adminForm = document.getElementById('adminForm');
    if (adminForm) {
      adminForm.onsubmit = (e) => this.handleAdminForm(e);
      // 文件直接拖到表单上也能导入
      adminForm.ondragover = (e) => { e.preventDefault(); adminForm.classList.add('dragging'); };
      adminForm.ondragleave = () => adminForm.classList.remove('dragging');
      adminForm.ondrop = (e) => {
        e.preventDefault();
        adminForm.classList.remove('dragging');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this.handleDocFile(f);
      };
    }
    const docFile = document.getElementById('docFile');
    if (docFile) {
      docFile.onchange = (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';        // 清掉才能重复选同一个文件
        if (f) this.handleDocFile(f);
      };
    }
    const catSelect = document.getElementById('articleCategory');
    if (catSelect) {
      catSelect.onchange = () => {
        const isMain = catSelect.value === 'main';
        document.getElementById('mainFields').style.display = isMain ? '' : 'none';
        document.getElementById('titleRow').style.display = isMain ? 'none' : '';
        if (this.docImport) { this.applyDocToForm(this.docImport); this.renderDocSummary(); this.updateParaHint(); }
      };
    }

    const readingEl = document.querySelector('.reading');
    bindSwipe(readingEl);
    this.updateReadingChrome(readingEl);
    // 桌面端键盘翻页（用 onkeydown 赋值，避免每次渲染都往 document 上叠加监听）
    document.onkeydown = readingEl ? (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft' && readingEl.dataset.prev) location.hash = '#/read/' + readingEl.dataset.prev;
      else if (e.key === 'ArrowRight' && readingEl.dataset.next) location.hash = '#/read/' + readingEl.dataset.next;
    } : null;

    // 留言异步加载：文章先出，留言后到，互不阻塞
    const commentList = document.getElementById('commentList');
    if (commentList) this.loadCommentsAsync(commentList.dataset.article, commentList);

    // 卡片跟随鼠标的 3D 倾斜（触摸设备和"减少动态效果"下会自动跳过）
    this.initTilt();

    // 主页动态壁纸（不是主页会自动跳过）
    this.initWallpaper();
  },

  /* ---------- 阅读页的滚动装饰：顶部进度条 + 回到顶部 ---------- */
  readingChrome() {
    if (this._chrome) return this._chrome;
    const bar = document.createElement('div');
    bar.id = 'readingProgress';
    bar.className = 'reading-progress';
    const top = document.createElement('button');
    top.type = 'button';
    top.id = 'toTop';
    top.className = 'to-top';
    top.setAttribute('aria-label', '回到顶部');
    top.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/></svg>';
    top.onclick = () => {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    };
    document.body.appendChild(bar);
    document.body.appendChild(top);
    this._chrome = { bar, top };
    return this._chrome;
  },

  updateReadingChrome(readingEl) {
    const chrome = this.readingChrome();
    const reading = readingEl || document.querySelector('.reading');
    if (!reading) {
      chrome.bar.classList.remove('on');
      chrome.top.classList.remove('on');
      window.onscroll = null;
      return;
    }
    chrome.bar.classList.add('on');
    // 用 onscroll 赋值而不是 addEventListener，避免每次渲染都叠加监听
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const y = window.scrollY || 0;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      chrome.bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      chrome.top.classList.toggle('on', y > 560);
    };
    window.onscroll = onScroll;
    onScroll();
  },

  /* ---------- 人机验证（仅在配置了 TURNSTILE_SITE_KEY 时启用） ---------- */
  ensureTurnstile(el) {
    const sitekey = el.dataset.sitekey;
    if (!sitekey) return;
    const render = () => {
      try { window.turnstile.render(el, { sitekey }); } catch (e) {}
    };
    if (window.turnstile) { render(); return; }
    if (!document.getElementById('cfTurnstileScript')) {
      const s = document.createElement('script');
      s.id = 'cfTurnstileScript';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = render;
      document.head.appendChild(s);
    } else {
      let tries = 0;
      const timer = setInterval(() => {
        if (window.turnstile) { clearInterval(timer); render(); }
        else if (++tries > 50) clearInterval(timer);
      }, 200);
    }
  },
  turnstileToken() {
    const input = document.querySelector('[name="cf-turnstile-response"]');
    return input ? input.value : '';
  },
  turnstileReset() {
    try { if (window.turnstile) window.turnstile.reset(); } catch (e) {}
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
      const payload = { username, password };
      const token = this.turnstileToken();
      if (token) payload.turnstile_token = token;
      if (this.authMode === 'register') {
        if (password !== form.confirmPassword.value) throw new Error('两次输入的密码不一致');
        if (password.length < 8) throw new Error('密码至少8位');
        await API.post('/api/register', payload);
        toast('账号已创建，欢迎来到白日梦咖啡馆');
      } else {
        await API.post('/api/login', payload);
        toast('欢迎回来，' + username);
      }
      // 获取登录用户信息（带自动重试，避免偶发的响应异常导致登录失败）
      let me = null;
      for (let i = 0; i < 3; i++) {
        try {
          me = await API.get('/api/me');
          if (me && me.user) break;
        } catch (err) { /* 重试 */ }
        await new Promise(r => setTimeout(r, 600));
      }
      if (!me || !me.user) throw new Error('登录状态异常，请再试一次');
      this.state.user = me.user;
      location.hash = '#/menu';
    } catch (err) {
      errEl.textContent = err.message;
      this.turnstileReset();
    }
  },

  async handleComment(e) {
    e.preventDefault();
    const form = e.target;
    try {
      await API.post('/api/article/' + form.dataset.article + '/comments',
        { content: form.content.value.trim() });
      toast('留言已发布');
      // 只改缓存里的计数，不整份重取目录
      this.bumpCommentCount(Number(form.dataset.article), 1);
      this.route();
    } catch (err) { toast(err.message, 'err'); }
  },

  async handleAvatarFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('图片请小于 8MB', 'err'); return; }
    try {
      // 压缩后再上传：2MB 的原图 → 约 10KB 的 128×128 webp
      this.pendingAvatar = await shrinkImage(file, 128);
      const box = document.getElementById('avatarPreview');
      if (box) box.innerHTML = `<img class="avatar size-56" src="${esc(this.pendingAvatar)}" alt="">`;
      toast('图片已压缩，点击“保存头像”生效');
    } catch (err) {
      toast('图片处理失败，请换一张试试', 'err');
    }
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
      this.pendingAvatar = null;
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

  /* ---------- 后台：从 Word / 文本文件导入 ---------- */
  async handleDocFile(file) {
    const stateEl = document.getElementById('docState');
    const say = (t) => { if (stateEl) stateEl.textContent = t; };
    if (!file) return;
    const D = window.DocxImport;
    if (!D) { say('解析脚本没加载成功，刷新页面再试'); return; }
    this.docImport = null;
    say('正在解析 ' + file.name + ' …');
    try {
      const r = await D.parseFile(file);
      this.docImport = r;
      this.applyDocToForm(r);
      this.renderDocSummary();
      say(file.name + ' 解析完成');
      toast('已识别 ' + r.chars.toLocaleString('zh-CN') + ' 字，确认后点发布');
    } catch (err) {
      say(err.message || '解析失败');
      toast(err.message || '解析失败', 'err');
    }
  },

  // 填进表单：结构字段只填空着的，正文总是覆盖
  applyDocToForm(r) {
    const form = document.getElementById('adminForm');
    if (!form || !r) return;
    const m = r.meta || {};
    if (form.category.value === 'main') {
      if (!form.chapter_no.value) {
        // 标题是序章/楔子/引子的，章号自动填 0；否则用文件名里解析到的章号
        if (this.isPrologueTitle(m.chapter_title)) form.chapter_no.value = 0;
        else if (m.chapter_no) form.chapter_no.value = m.chapter_no;
      }
      if (m.chapter_title && !form.chapter_title.value) form.chapter_title.value = m.chapter_title;
      if (m.section_no && !form.section_no.value) form.section_no.value = m.section_no;
      if (m.section_title && !form.section_title.value) form.section_title.value = m.section_title;
    } else if (m.title && !form.title.value) {
      form.title.value = m.title;
    }
    form.content.value = r.plain;
  },

  // 导入摘要：显示识别结果，并给出「按节拆分」选项
  renderDocSummary() {
    const box = document.getElementById('docSummary');
    if (!box) return;
    const D = window.DocxImport;
    const r = this.docImport;
    if (!D || !r) { box.hidden = true; box.innerHTML = ''; return; }
    const form = document.getElementById('adminForm');
    const isMain = !!(form && form.category.value === 'main');
    const groups = isMain ? D.splitSections(r.blocks) : [];
    const canSplit = groups.length > 1;
    box.hidden = false;
    box.innerHTML = `
      <div class="doc-summary-line">已识别 <b>${r.chars.toLocaleString('zh-CN')}</b> 字 · ${r.blocks.length} 段${r.headings ? ' · ' + r.headings + ' 个标题' : ''}</div>
      ${canSplit ? `<label class="switch-row"><input type="checkbox" id="docSplit" ${r.hasSectionMarkers ? 'checked' : ''}> 按「第 N 节」拆成 ${groups.length} 篇分别发布</label>` : ''}
      <div class="doc-summary-hint">${canSplit ? '勾选拆分时，下面正文输入框的内容会被忽略，每篇的正文直接从文件里取。' : '正文已经填到下面的输入框，可以再改，确认后点发布。'}</div>`;
  },

  // 这一章里目前最大的节号，用来给没写节号的篇目续号
  nextSectionNo(chapterNo, menu) {
    let max = 0;
    if (menu && menu.main) {
      const ch = menu.main.find(c => String(c.chapter_no) === String(chapterNo));
      if (ch) (ch.sections || []).forEach(s => { if (Number(s.section_no) > max) max = Number(s.section_no); });
    }
    return max + 1;
  },

  // 按标题拆成多篇，依次发布
  async publishSplit(form, groups, meta) {
    if (!confirm('将按标题拆成 ' + groups.length + ' 篇文章依次发布，确定吗？')) return;
    const cn = this.pickChapterNo(parseInt(form.chapter_no.value, 10), meta);
    const ct = String(form.chapter_title.value || '').trim() || meta.chapter_title || (cn === 0 ? '序章' : ('第' + cn + '章'));
    const menu = await this.ensureMenu(true).catch(() => null);
    let next = this.nextSectionNo(cn, menu);
    let done = 0;
    const failed = [];
    for (const g of groups) {
      const no = g.no || next++;
      const title = g.title || ('第' + no + '节');
      try {
        await API.post('/api/admin/articles', {
          category: 'main', chapter_no: cn, chapter_title: ct,
          section_no: no, section_title: title, content: g.text,
        });
        done++;
      } catch (err) {
        failed.push(title + '（' + err.message + '）');
      }
    }
    this.state.menu = null;
    this.docImport = null;
    if (failed.length) toast('发布完成：成功 ' + done + ' 篇，失败 ' + failed.length + ' 篇', 'err');
    else toast('已发布 ' + done + ' 篇文章');
    location.hash = '#/admin/articles';
  },

  async handleAdminForm(e) {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.id || null;
    const category = form.category.value;
    // 从文件导入、并且勾了「按节拆分」→ 走批量发布
    const splitBox = document.getElementById('docSplit');
    if (!id && category === 'main' && splitBox && splitBox.checked && this.docImport) {
      const groups = window.DocxImport.splitSections(this.docImport.blocks);
      if (groups.length > 1) return this.publishSplit(form, groups, this.docImport.meta || {});
    }
    const rawHtml = !!(document.getElementById('rawHtml') && document.getElementById('rawHtml').checked);
    const payload = { category, content: form.content.value.trim(), raw_html: rawHtml };
    // 富文本模式：把标记原文交给后端，由后端统一渲染成正文（前端那份只用来做预览）
    if (!rawHtml) payload.source = form.content.value;
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
      this.state.menu = null;   // 目录变了，重新拉一次
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
