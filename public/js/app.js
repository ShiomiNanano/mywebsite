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
  /* 手机上失败的排查版：把「解码」这一步做成三条路，并把失败环节报出来。
     ① createImageBitmap(file)：最省内存；Safari 对它的选项支持不全，
        所以【不传任何选项】，只用它解码。
     ② 老路：URL.createObjectURL + <img>。
     ③ 另一条路：FileReader 读成 data URL 再交给 <img> ——
        和 blob URL 是不同的解码路径，某些格式在一条路上失败、另一条能过。
     出口只有两个：成功，或者抛出一个说明「哪一步、什么原因」的错误。 */
  const toData = (bmp) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const s = Math.min(bmp.width, bmp.height);
    ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    let out = c.toDataURL('image/webp', 0.85);
    if (out.indexOf('data:image/webp') !== 0) out = c.toDataURL('image/jpeg', 0.85);
    if (out.indexOf('data:image/') !== 0) throw new Error('画布导出失败');
    return out;
  };
  const viaImage = (src, cleanup) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try { resolve(toData(img)); } catch (e) { reject(new Error('画布:' + e.message)); }
      finally { cleanup && cleanup(); }
    };
    img.onerror = () => { cleanup && cleanup(); reject(new Error('解码失败')); };
    img.src = src;
  });
  const viaBlob = () => {
    const url = URL.createObjectURL(file);
    return viaImage(url, () => URL.revokeObjectURL(url));
  };
  const viaDataUrl = () => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => viaImage(String(fr.result)).then(resolve, reject);
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.readAsDataURL(file);
  });
  const viaBitmap = () => {
    if (typeof createImageBitmap !== 'function') return Promise.reject(new Error('不支持'));
    return createImageBitmap(file).then((bmp) => {
      try { return toData(bmp); } catch (e) { throw new Error('画布:' + e.message); }
      finally { if (bmp && bmp.close) bmp.close(); }
    });
  };
  const errs = [];
  const tryOne = (name, fn) => fn().then(
    (v) => v,
    (e) => { errs.push(name + '=' + (e && e.message ? e.message : '失败')); throw e; }
  );
  return new Promise((resolve) => {
    tryOne('位图', viaBitmap)
      .catch(() => tryOne('blob', viaBlob))
      .catch(() => tryOne('dataURL', viaDataUrl))
      .then(resolve, () => {
        // 三条都失败：把每一步的原因拼进错误里，界面会显示出来
        const e = new Error(errs.join(' / '));
        e.detail = errs.join(' / ');
        throw e;
      });
  });
}

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

    window.addEventListener('hashchange', () => {
      if (this.game && this.game.timer) { clearInterval(this.game.timer); this.game = null; }
      this.route();
    });
    /* 留言板的按钮用事件委派统一处理 —— 这样不必去猜各页面各自的绑定函数叫什么。
       黑板编辑只对管理员可见，后端 PUT /api/admin/board 也会再校验一次权限。 */
    /* 游戏页的点击：翻牌与重开。单独一个委派，不去动留言板那一个。 */
    document.addEventListener('click', (e) => {
      const card = e.target.closest && e.target.closest('.flip-card');
      if (card) { this.flipCard(Number(card.getAttribute('data-i'))); return; }
      if (e.target.closest && e.target.closest('#gameRestart')) { this.startMemory(); }
      if (e.target.closest && e.target.closest('#numGuess')) { this.guessNumber(); return; }
      if (e.target.closest && e.target.closest('#numRestart')) { this.startNumber(); return; }
      if (e.key === 'Enter' && e.target && e.target.id === 'numInput') { this.guessNumber(); }
      /* 读者点互链去查设定时，先把"从哪一篇来的"记下来（存 sessionStorage：
         关掉标签页就没了，正好是"这一次阅读"的范围）。
         目的：看完设定能一键回到原文，而不是回主页重新点一遍。 */
      const wk = e.target.closest && e.target.closest('a.wiki');
      if (wk) {
        try {
          const cur = String(location.hash || '');
          const m = /^#\/read\/(\d+)$/.exec(cur);
          if (m) {
            const art = (this.state.readArticle && String(this.state.readArticle.id) === m[1]) ? this.state.readArticle : null;
            const title = art ? (art.title || art.section_title || '原文') : '原文';
            sessionStorage.setItem('daydream-wiki-back', JSON.stringify({ hash: cur, title: title, ts: Date.now() }));
          }
        } catch (e) { /* 存不了就算了，不影响跳转 */ }
      }
      /* 切换分类时，让对应的字段行立刻显隐 ——
         主线要章号/节号，其它分类要标题，设定还要类型与标签。 */
      if (e.target && e.target.id === 'articleCategory') {
        const v = e.target.value;
        const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
        show('mainFields', v === 'main');
        show('sectionFields', v === 'main');   // 节号/节标题只有主线用得上（设定填了也会被丢掉）
        show('titleRow', v !== 'main');
        show('settingFields', v === 'settings');
        return;
      }
      const st = e.target.closest && e.target.closest('.set-tab');
      if (st) {
        const v = st.getAttribute('data-settype') || '';
        this.settingFilter = v;
        this.route();
        return;
      }
      const clr = e.target.closest && e.target.closest('.rank-clear');
      if (clr) {
        const gm = clr.getAttribute('data-game');
        const label = gm === 'memory' ? '记忆翻牌' : '猜数字';
        if (!confirm('清空「' + label + '」的排行榜？所有人的成绩都会没了，不可恢复。')) return;
        this.clearRank(gm);
      }
    });
    document.addEventListener('click', async (e) => {
      const t = e.target.closest && e.target.closest('#bbEdit, #bbCancel, #bbSave, #boardSend, #boardMore, .note-del, .set-tab');
      if (!t) return;
      const id = t.id;
      try {
        if (id === 'bbEdit') {
          document.getElementById('bbText').hidden = true;
          document.getElementById('bbEditor').hidden = false;
          const ta = document.getElementById('bbInput');
          if (ta) ta.focus();
        } else if (id === 'bbCancel') {
          document.getElementById('bbEditor').hidden = true;
          document.getElementById('bbText').hidden = false;
        } else if (id === 'bbSave') {
          const note = (document.getElementById('bbInput').value || '').trim();
          const hint = document.getElementById('bbHint');
          if (hint) hint.textContent = '保存中…';
          await API.put('/api/admin/board', { note });
          toast('黑板已更新');
          this.route();
        } else if (id === 'boardSend') {
          const box = document.getElementById('boardInput');
          const content = (box.value || '').trim();
          const hint = document.getElementById('boardHint');
          if (!content) { if (hint) hint.textContent = '写点什么再贴吧'; return; }
          if (hint) hint.textContent = '贴上去…';
          await API.post('/api/board/comments', { content });
          toast('便签贴好了');
          this.route();
        } else if (t.classList.contains('note-del')) {
          const noteId = Number(t.getAttribute('data-note'));
          if (!confirm('删掉这张便签？删了就找不回来了。')) return;
          await API.del('/api/board/comments/' + noteId);
          toast('便签已撕掉');
          this.route();
        } else if (id === 'boardMore') {
          t.disabled = true;
          t.textContent = '加载中…';
          const before = this.board && this.board.next_before;
          const more = await API.get('/api/board?before=' + encodeURIComponent(before));
          const list = document.getElementById('boardList');
          const add = (more.items || []).length;
          this.board.items = (more.items || []).concat(this.board.items);
          this.board.has_more = !!more.has_more;
          this.board.next_before = more.next_before || null;
          if (list) list.innerHTML = this.boardNotes();
          if (!more.has_more && t.parentNode) t.remove(); else { t.disabled = false; t.textContent = '看更早的留言'; }
          if (!add) toast('没有更早的留言了');
        }
      } catch (err) {
        toast(err && err.message ? err.message : '操作失败，稍后再试');
        const hint = document.getElementById('bbHint');
        if (hint) hint.textContent = '';
        const h2 = document.getElementById('boardHint');
        if (h2) h2.textContent = '';
      }
    });

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
  /* ---------- 读过哪些篇（只存在本机，不上传） ---------- */
  readMap() {
    try { return JSON.parse(localStorage.getItem('daydream-read') || '{}'); } catch (e) { return {}; }
  },
  markRead(id) {
    if (!id) return;
    try {
      const m = this.readMap();
      m[id] = Date.now();
      // 只留最近 500 篇，免得 localStorage 无限涨
      const keys = Object.keys(m);
      if (keys.length > 500) {
        keys.sort((x, y) => m[x] - m[y]).slice(0, keys.length - 500).forEach(k => delete m[k]);
      }
      localStorage.setItem('daydream-read', JSON.stringify(m));
    } catch (e) {}
  },
  isRead(id) { return !!this.readMap()[id]; },
  // 一章的每一节都读过，才算这章读完
  isChapterRead(c) {
    const ss = (c && c.sections) || [];
    return ss.length > 0 && ss.every(s => this.isRead(s.id));
  },

  /* ---------- 按时段问好（咖啡馆的招牌问候不该只有"晚安"） ---------- */
  greet(u) {
    const h = new Date().getHours();
    const word = (h >= 5 && h < 11) ? '早安'
      : (h >= 11 && h < 14) ? '午安'
      : (h >= 14 && h < 18) ? '下午好'
      : (h >= 18 && h < 23) ? '晚上好'
      : '夜深了';
    return u ? (word + '，' + esc(u.username) + '。') : (word + '，欢迎来到白日梦咖啡馆。');
  },

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
    if (parts[0] === 'menu') { try { sessionStorage.removeItem('daydream-wiki-back'); } catch (e) {} }
      else if (parts[0] === 'main') view = parts.length >= 2
        ? await this.renderChapter(parts[1]) : await this.renderMainList();
      else if (parts[0] === 'personal') view = await this.renderPersonal();
    else if (parts[0] === 'board') view = await this.renderBoard();
    else if (parts[0] === 'wiki') view = await this.renderWiki(decodeURIComponent(parts[1] || ''));
    else if (parts[0] === 'games') view = parts[1] === 'memory' ? await this.renderMemory() : (parts[1] === 'number' ? await this.renderNumber() : await this.renderGames());
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
    // 底部导航有哪几格、哪一格高亮，都看这个列表 ——
    // 给导航增删格子时，记得同时改这里，否则新格子点了不会亮。
    // settings 已经没有对应的格子了（设定页仍可从书架进入），所以从列表里去掉。
    const active = !showNav ? '' : (['menu', 'board', 'games', 'profile'].includes(parts[0]) ? parts[0] : '');
    document.getElementById('app').innerHTML = view + (showNav ? this.bottomNav(active) : '');
    this.markWiki();   // 正文渲染完，把没收录的名词标成红链
    // 游戏页的棋盘要等 HTML 插进去之后才能画（上面那步先渲染，这里再开局）
    if (parts[0] === 'games' && parts[1] === 'memory') { this.startMemory(); }
    if (parts[0] === 'games' && parts[1] === 'number') { this.startNumber(); }
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
      body = `<div class="admin-nav">
        </div><div class="admin-head"></div>
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
      boardIcon: '<path d="M3.5 6.4h17v11.2h-17z"/><path d="M3.8 6.9l8.2 5.8 8.2-5.8"/>',
      settings: '<path d="M12 3.4l8.4 4.7-8.4 4.7-8.4-4.7z"/><path d="M3.6 12.6l8.4 4.7 8.4-4.7"/><path d="M3.6 16.8l8.4 4.7 8.4-4.7"/>',
      /* 下面三枚是为底部导航的新规划准备的（图标先备好，换导航时就只改一行）。
         全部只用 path，和上面几枚写法一致 —— 这样自动继承现有图标的描边样式。
         注：personal 那枚本身就是信封，做「留言」比做「个人」更贴，所以留言复用它。 */
      profile: '<path d="M12 4.6a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4z"/><path d="M4.9 20.4c0-3.7 3.2-5.8 7.1-5.8s7.1 2.1 7.1 5.8"/>',
      board: '<path d="M4.3 5.6h15.4v10.7h-9.6L5 19.5v-3.2H4.3z"/><path d="M8.2 9.5h7.6M8.2 12.4h4.6"/>',
      games: '<path d="M7.4 4.2h9.2a3.2 3.2 0 0 1 3.2 3.2v9.2a3.2 3.2 0 0 1-3.2 3.2H7.4a3.2 3.2 0 0 1-3.2-3.2V7.4a3.2 3.2 0 0 1 3.2-3.2z"/><path d="M9.2 8.4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/><path d="M14.8 8.4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/><path d="M9.2 13.1a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/><path d="M14.8 13.1a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/>',
    };
    const item = (key, txt) => `
      <a class="bn-item ${active === key ? 'active' : ''}" href="#/${key}"${active === key ? ' aria-current="page"' : ''}>
        <span class="bn-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg></span>
        <span class="bn-txt">${txt}</span>
      </a>`;
    return `
    <nav class="bottom-nav">
      ${item('menu', '书架')}
      ${item('board', '留言')}
      ${item('games', '游戏')}
      ${item('profile', '我的')}
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
        <span class="brand-mark" role="img" aria-label="白日梦咖啡馆"></span>
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
        <!-- 封面下面的一叠纸。放在封面之前，靠 DOM 顺序压在下面（不用负 z-index，
             也不依赖浏览器对封面背景的 3D 层排序 —— 那样有可能把纸画到封面正面上）。
             整本书翻开时它们依次翻过去，否则只有封面单独转走，看着像一张纸。 -->
        <div class="book-stack" id="bookStack" aria-hidden="true">
            <span class="bp"></span>
            <span class="bp"></span>
            <span class="bp"></span>
            <span class="bp"></span>
            <span class="bp"></span>
            <span class="bp"></span>
            <span class="bp"></span>
        </div>
        <div class="book-cover" id="bookCover" role="button" tabindex="0" aria-label="翻开这本书">
          <div class="cover-inner">
            <div class="cover-top">汐凪島 · 绘空事</div>
            <div class="cover-logo" role="img" aria-label="Daydream Café：咖啡杯里打盹的猫"></div>
            <h1 class="cover-title">白日梦</h1>
            <div class="cover-line"></div>
            <div class="cover-bottom">梦从此刻开始</div>
          </div>
        </div>
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
        <p class="menu-greet"><span class="greet-logo" role="img" aria-label="白日梦咖啡馆"></span>${this.greet(u)}</p>
        <p class="menu-quote" id="menuQuote">“今日海风正好，书已为你翻开。”<span class="quote-author">—— 白日梦咖啡馆</span></p>
      </div>
      <div class="menu-cards">
        <a class="menu-card menu-main" href="#/main">
          <div class="menu-card-badge">主 线</div>
          <span class="menu-main-mark" aria-hidden="true"></span>
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
            <p>各自安放的心事</p>
            <span class="menu-card-meta">${m.personal.length} 篇</span>
          </div>
          <div class="menu-card-arrow">→</div>
        </a>
        <a class="menu-card menu-settings" href="#/settings">
          <div class="menu-card-icon">❖</div>
          <div class="menu-card-content">
            <h3>设定</h3>
            <p>索格诺的现世</p>
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
        <span class="eyebrow">メインストーリー</span>
        <h1>主线故事</h1>
        <p>梦从此刻开始</p>
      </div>
      <div class="chapter-list">
        ${m.main.length ? m.main.map(c => `
          <a class="chapter-card${this.isChapterRead(c) ? ' is-read' : ''}" href="#/main/${c.chapter_no}"><span class="read-tag" aria-label="已读">已读</span>
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
          <a class="section-card${this.isRead(s.id) ? ' is-read' : ''}" href="#/read/${s.id}"><span class="read-tag" aria-label="已读">已读</span>
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
  /* ---------- 留言板 ----------
     顶部那块黑板只有管理员能改（内容存在 settings 表的 board_note，见后端 PUT /api/admin/board）；
     下面的便签就是 comments 表里 article_id = 0 的那些。
     游客能看不能写：can_post 由后端根据当前登录状态给出，前端据此显示「登录后可以留言」。
     取不到数据时显示一块空板，不让整页崩掉。 */
  /* ---------- 游戏页 ----------
     游客不能玩：一进来就跳登录（和 renderProfile 一样的处理）。
     游戏页对每款游戏给一个排行榜，只显示前五名，分数取每个用户的最高分。
     记忆翻牌的状态放在 this.game 里；翻牌只重画棋盘那一小块，
     整页不重渲染 —— 否则计时器会被打断、动画也会重来。 */
  /* ---------- 游戏主页 ----------
     底部导航点「游戏」进的是这一页（选择页），每款游戏有自己的路由：
     记忆翻牌是 #/games/memory。这里是游客也进不来的地方，
     所以一上来就跳登录（和 renderProfile / renderMemory 同一套做法）。 */
  /* ---------- 猜数字 ----------
     规则：连出三个 1~100 的数，猜中一个再猜下一个，三个都猜中才算完。
     这样设计是为了压掉运气 —— 单个数字可能一次蒙中，
     但连着三个都靠蒙几乎不可能，所以分数能反映真实水平。
     计分与记忆翻牌同一套：1000 − 次数×20 − 秒数×3，下限 100。 */
  async renderNumber() {
    const u = this.state.user;
    if (!u) { location.hash = '#/login'; return ''; }
    this.pageTitle = '猜数字 · 白日梦咖啡馆';
    if (this.num && this.num.timer) { clearInterval(this.num.timer); }
    this.num = null;
    try {
      const r = await API.get('/api/games/scores?game=number');
      this.numTops = (r && r.tops) || [];
    } catch (e) { this.numTops = []; }
    return `
    <div class="page game-page">
      ${this.topbar()}
      <div class="page-head">
        <h1>猜数字</h1>
        <p>连猜三个，别指望运气。</p>
      </div>

      <section class="game-card">
        <div class="game-head">
          <h2>猜数字</h2>
          <span class="game-stat">第 <b id="numRound">1</b>/3 个 · 共猜 <b id="numGuesses">0</b> 次 · <b id="numTime">0:00</b></span>
        </div>
        <p class="game-desc">我会连着出三个 1~100 的数。猜中一个，接着猜下一个；三个都猜中才算完。<b>分数看总次数和总时间</b>，所以蒙中一个没用。</p>

        <div class="num-pips" id="numPips" aria-label="三次进度">
          <span class="pip is-now"></span><span class="pip"></span><span class="pip"></span>
        </div>

        <div class="num-board">
          <div class="num-range-row">
            <span class="num-range-label">答案就在</span>
            <span class="num-range" id="numRange">1 ~ 100</span>
            <span class="num-range-label">之间</span>
          </div>
          <div class="num-track"><span class="num-fill" id="numFill"></span></div>
          <div class="num-readout" id="numReadout">—</div>
          <div class="num-hint" id="numHint"></div>
        </div>

        <div class="num-panel">
          <input type="number" id="numInput" min="1" max="100" inputmode="numeric" placeholder="1 ~ 100" aria-label="猜一个 1 到 100 的数">
          <button type="button" class="btn btn-primary num-go" id="numGuess">猜</button>
        </div>
        <div class="num-restart-row">
          <button type="button" class="num-restart" id="numRestart">重新开始</button>
        </div>
        <div class="num-history" id="numHistory"></div>
        <p class="num-log" id="numLog"></p>
        <p class="game-result" id="numResult">　</p>
      </section>

      <section class="game-rank">
        <div class="rank-head">
          <h3>排行榜 · 前五名</h3>
          ${this.state.user && this.state.user.role === 'admin' ? `<button type="button" class="rank-clear" data-game="number">清空本榜</button>` : ''}
        </div>
        <ol class="rank-list" id="numRanks">${this.numRankItems()}</ol>
        <p class="game-more"><a href="#/games">← 回到游戏主页</a></p>
      </section>
    </div>`;
  },

  numRankItems() {
    const tops = this.numTops || [];
    if (!tops.length) return '<li class="rank-empty">还没有人上榜，第一个就是你。</li>';
    const medal = ['👑', '②', '③', '④', '⑤'];
    return tops.map((x, i) =>
      `<li><span class="rank-no">${medal[i]}</span><span class="rank-name">${esc(x.username)}</span><span class="rank-score">${Number(x.score) || 0}</span></li>`
    ).join('');
  },

  startNumber() {
    if (this.num && this.num.timer) clearInterval(this.num.timer);
    const secret = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 100));
    const g = { secret: secret, round: 0, guesses: 0, over: false, startAt: Date.now(), timer: null,
                lo: 1, hi: 100, history: [], lastHint: '' };
    this.num = g;
    g.timer = setInterval(() => {
      const el = document.getElementById('numTime');
      if (el && this.num === g && !g.over) el.textContent = this.mmss(Date.now() - g.startAt);
    }, 1000);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('numRound', '1');
    set('numGuesses', '0');
    set('numTime', '0:00');
    set('numResult', '　');
    const log = document.getElementById('numLog');
    if (log) log.innerHTML = '开始吧 —— 第一个数已经想好了。';
    this.paintNumber();
    const box = document.getElementById('numInput');
    if (box) { box.value = ''; box.focus(); }
  },

  guessNumber() {
    const g = this.num;
    if (!g || g.over) return;
    const box = document.getElementById('numInput');
    const log = document.getElementById('numLog');
    const v = Math.floor(Number(box && box.value));
    if (!Number.isFinite(v) || v < 1 || v > 100) {
      if (log) log.innerHTML = '<span class="num-warn">要猜 1 到 100 之间的整数。</span>';
      return;
    }
    g.guesses++;
    const secret = g.secret[g.round];
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('numGuesses', String(g.guesses));
    let line = '';
    if (v === secret) {
      line = '第 ' + (g.round + 1) + ' 个：<b>' + v + '</b> —— 猜中了！';
      g.lastHint = 'hit';
      g.round++;
      g.lo = 1; g.hi = 100;                                  // 下一个数重新开一局范围
      if (g.round >= 3) {
        if (log) log.innerHTML = line + ' 三个全中。';
        this.paintNumber(v);
        this.finishNumber();
        return;
      }
      line += ' 接着猜第 ' + (g.round + 1) + ' 个。';
    } else if (v < secret) {
      line = '第 ' + (g.round + 1) + ' 个：' + v + ' —— 小了';
      g.lo = Math.max(g.lo, v + 1);
      g.lastHint = 'low';
    } else {
      line = '第 ' + (g.round + 1) + ' 个：' + v + ' —— 大了';
      g.hi = Math.min(g.hi, v - 1);
      g.lastHint = 'high';
    }
    g.history.push({ v: v, hint: v === secret ? 'hit' : (v < secret ? 'low' : 'high') });
    if (g.history.length > 8) g.history.shift();
    if (log) log.innerHTML = line;
    set('numRound', String(Math.min(g.round + 1, 3)));
    this.paintNumber(v);
    if (box) { box.value = ''; box.focus(); }
  },

  /* 猜数字的界面刷新集中在这里：范围条、进度点、大数字、提示、历史小签。
     逻辑与视觉分开，改样式时不用碰判断。 */
  paintNumber(lastGuess) {
    // 查表而不是拼字符串：检查器会把 'is-' 这种碎片当成一个类名
    const CHIP_CLASS = { low: 'is-low', high: 'is-high', hit: 'is-hit' };
    const g = this.num;
    if (!g) return;
    const el = (id) => document.getElementById(id);
    const range = el('numRange');
    if (range) range.textContent = g.lo + ' ~ ' + g.hi;
    const fill = el('numFill');
    if (fill) {
      const lo = Math.max(1, g.lo), hi = Math.min(100, g.hi);
      const pct = Math.max(2, Math.round(((hi - lo + 1) / 100) * 100));
      fill.style.width = pct + '%';
      fill.classList.toggle('is-tight', pct <= 12);
    }
    const read = el('numReadout');
    if (read) read.textContent = (lastGuess === undefined || lastGuess === null) ? '—' : String(lastGuess);
    const hint = el('numHint');
    if (hint) {
      const map = { low: '小了 ↑', high: '大了 ↓', hit: '猜中了 ✓' };
      hint.textContent = map[g.lastHint] || '';
      hint.className = 'num-hint' + (g.lastHint ? ' is-' + g.lastHint : '');
    }
    const pips = el('numPips');
    if (pips) {
      const kids = pips.querySelectorAll('.pip');
      kids.forEach((p, i) => {
        p.className = 'pip' + (i < g.round ? ' is-done' : (i === g.round ? ' is-now' : ''));
      });
    }
    const his = el('numHistory');
    if (his) {
      his.innerHTML = g.history.map(x =>
        `<span class="num-chip ${CHIP_CLASS[x.hint] || ''}">${x.v}</span>`).join('');
    }
  },

  // 管理员清榜：清完把当前页的榜也刷成空的
  async clearRank(game) {
    try {
      const r = await API.del('/api/admin/games/scores?game=' + encodeURIComponent(game));
      const gone = (r && r.removed) || 0;
      if (game === 'number') {
        this.numTops = [];
        const b = document.getElementById('numRanks');
        if (b) b.innerHTML = this.numRankItems();
      } else {
        this.gameTops = [];
        const b2 = document.getElementById('gameRanks');
        if (b2) b2.innerHTML = this.rankItems();
      }
      toast(gone ? ('清掉了 ' + gone + ' 条成绩') : '这个榜本来就是空的');
    } catch (e) {
      toast('清榜失败：' + (e && e.message ? e.message : '稍后再试'));
    }
  },
  async finishNumber() {
    const g = this.num;
    if (!g || g.over) return;
    g.over = true;
    if (g.timer) clearInterval(g.timer);
    const secs = Math.floor((Date.now() - g.startAt) / 1000);
    const score = Math.max(100, 1000 - g.guesses * 20 - secs * 3);
    const rs = document.getElementById('numResult');
    if (rs) rs.textContent = '三个全中！共猜 ' + g.guesses + ' 次 · ' + this.mmss(Date.now() - g.startAt) + ' · ' + score + ' 分';
    try {
      const r = await API.post('/api/games/scores', { game: 'number', score: score });
      if (r && r.tops && r.tops.length) this.numTops = r.tops;
      else {
        const t = await API.get('/api/games/scores?game=number');
        this.numTops = (t && t.tops) || [];
      }
      const box = document.getElementById('numRanks');
      if (box) box.innerHTML = this.numRankItems();
      toast('得了 ' + score + ' 分，已上榜');
    } catch (e) {
      toast('分数没能上榜：' + (e && e.message ? e.message : '稍后再试'));
    }
  },

  async renderGames() {
    const u = this.state.user;
    if (!u) { location.hash = '#/login'; return ''; }
    this.pageTitle = '游戏 · 白日梦咖啡馆';
    let memoryTops = [], numberTops = [];
    try {
      const r = await API.get('/api/games/scores?game=memory');
      memoryTops = (r && r.tops) || [];
    } catch (e) { memoryTops = []; }
    try {
      const r2 = await API.get('/api/games/scores?game=number');
      numberTops = (r2 && r2.tops) || [];
    } catch (e) { numberTops = []; }
    return `
    <div class="page game-page">
      ${this.topbar()}
      <div class="page-head">
        <h1>游戏</h1>
        <p>几款小游戏而已，赢个分数贴在榜上。</p>
      </div>

      <section class="game-hub">
        <a class="hub-card" href="#/games/memory">
          <div class="hub-top">
            <span class="hub-ico">☕❧🐈</span>
            <span class="hub-tag">可玩</span>
          </div>
          <h2>记忆翻牌</h2>
          <p>翻开两张一样的牌，八对全配对。步数越少、越快，分数越高。</p>
          ${this.hubRank(memoryTops)}
        </a>

        <a class="hub-card" href="#/games/number">
          <div class="hub-top">
            <span class="hub-ico">1 2 3</span>
            <span class="hub-tag">可玩</span>
          </div>
          <h2>猜数字</h2>
          <p>连着三个 1~100 的数，猜中一个再猜下一个。蒙中一个不算本事，三个都中才算。</p>
          ${this.hubRank(numberTops)}
        </a>
      </section>

    </div>`;
  },

  // 主页每张游戏卡上的迷你榜（取前三）
  hubRank(tops) {
    if (!tops || !tops.length) return '<p class="hub-rank-empty">还没有人上榜</p>';
    const medal = ['👑', '②', '③'];
    return '<ol class="hub-rank">' + tops.slice(0, 3).map((x, i) =>
      `<li><span>${medal[i]}</span><span class="hub-rank-name">${esc(x.username)}</span><b>${Number(x.score) || 0}</b></li>`
    ).join('') + '</ol>';
  },

  async renderMemory() {
    const u = this.state.user;
    if (!u) { location.hash = '#/login'; return ''; }
    this.pageTitle = '记忆翻牌 · 白日梦咖啡馆';
    if (this.game && this.game.timer) { clearInterval(this.game.timer); }
    this.game = null;
    this.gameTops = [];
    try {
      const r = await API.get('/api/games/scores?game=memory');
      this.gameTops = (r && r.tops) || [];
    } catch (e) { this.gameTops = []; }
    return `
    <div class="page game-page">
      ${this.topbar()}
      <div class="page-head">
        <h1>游戏</h1>
        <p>小游戏而已，赢个分数贴在榜上。</p>
      </div>

      <section class="game-card" id="gameCard">
        <div class="game-head">
          <h2>记忆翻牌</h2>
          <span class="game-stat">步数 <b id="gameMoves">0</b> · 用时 <b id="gameTime">0:00</b></span>
        </div>
        <p class="game-desc">翻开两张一样的牌，八对全配对就赢。步数越少、越快，分数越高。</p>
        <div class="game-grid" id="gameGrid"></div>
        <div class="game-foot">
          <span class="game-result" id="gameResult">　</span>
          <button type="button" class="btn btn-small" id="gameRestart">重新开始</button>
        </div>
      </section>

      <section class="game-rank">
        <div class="rank-head">
          <h3>排行榜 · 前五名</h3>
          ${this.state.user && this.state.user.role === 'admin' ? `<button type="button" class="rank-clear" data-game="memory">清空本榜</button>` : ''}
        </div>
        <ol class="rank-list" id="gameRanks">${this.rankItems()}</ol>
      </section>
    </div>`;
  },

  // 排行榜（首次渲染与提交分数之后都走它）
  rankItems() {
    const tops = this.gameTops || [];
    if (!tops.length) return '<li class="rank-empty">还没有人上榜，第一个就是你。</li>';
    const medal = ['👑', '②', '③', '④', '⑤'];
    return tops.map((x, i) =>
      `<li><span class="rank-no">${medal[i]}</span><span class="rank-name">${esc(x.username)}</span><span class="rank-score">${Number(x.score) || 0}</span></li>`
    ).join('');
  },

  // 开局：8 对牌洗好后铺上去
  startMemory() {
    const faces = ['\u2615', '\u2767', '\u{1F408}', '\u{1F319}', '\u2602', '\u{1F390}', '\u{1F4D6}', '\u26C4'];
    const deck = faces.concat(faces).map((f, i) => ({ f: f, i: i, up: false, done: false }));
    for (let i = deck.length - 1; i > 0; i--) {           // 洗牌
      const j = Math.floor(Math.random() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    if (this.game && this.game.timer) clearInterval(this.game.timer);
    const g = { deck: deck, open: [], moves: 0, matched: 0, over: false, startAt: Date.now(), timer: null };
    this.game = g;
    g.timer = setInterval(() => {
      const el = document.getElementById('gameTime');
      if (el && this.game === g && !g.over) el.textContent = this.mmss(Date.now() - g.startAt);
    }, 1000);
    this.paintGame();
    const mv = document.getElementById('gameMoves');
    if (mv) mv.textContent = '0';
    const tm = document.getElementById('gameTime');
    if (tm) tm.textContent = '0:00';
    const rs = document.getElementById('gameResult');
    if (rs) rs.textContent = '　';
  },

  mmss(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },

  /* 只在开局时整块重建棋盘（也只有这时该播放发牌动画）。
     之前每翻一张牌也走这里，于是 16 张牌全被重建、发牌动画跟着重播，
     看起来就是"每点一下整页闪一下"。 */
  paintGame() {
    const box = document.getElementById('gameGrid');
    if (!box || !this.game) return;
    box.innerHTML = this.game.deck.map((c, i) =>
      `<button type="button" class="flip-card${c.up || c.done ? ' is-up' : ''}${c.done ? ' is-done' : ''}" data-i="${i}" style="--i:${i}" aria-label="第 ${i + 1} 张">
         <span class="fc-inner"><span class="fc-face">?</span><span class="fc-back">${c.f}</span></span>
       </button>`).join('');
    box.classList.add('is-dealing');                       // 只在这一刻允许播发牌动画
    setTimeout(() => box.classList.remove('is-dealing'), 760);
  },

  /* 翻牌专用：只把变化了的那几张牌的类名改一下，绝不重建 DOM。
     这样翻转过渡能正常播（重建的话会直接跳到位），也不会引发频闪。 */
  syncGame() {
    const box = document.getElementById('gameGrid');
    if (!box || !this.game) return;
    const bs = box.querySelectorAll('.flip-card');
    this.game.deck.forEach((c, i) => {
      const b = bs[i];
      if (!b) return;
      b.classList.toggle('is-up', !!(c.up || c.done));
      b.classList.toggle('is-done', !!c.done);
    });
  },

  // 翻开一张
  async flipCard(i) {
    const g = this.game;
    if (!g || g.over) return;
    const c = g.deck[i];
    if (!c || c.up || c.done || g.open.length >= 2) return;
    c.up = true;
    g.open.push(i);
    this.syncGame();
    if (g.open.length < 2) return;
    g.moves++;
    const mv = document.getElementById('gameMoves');
    if (mv) mv.textContent = String(g.moves);
    const [x, y] = g.open;
    if (g.deck[x].f === g.deck[y].f) {
      g.deck[x].done = g.deck[y].done = true;
      g.open = [];
      g.matched++;
      this.syncGame();
      if (g.matched === 8) this.finishMemory();
    } else {
      // 先让这两张抖一下，再翻回去
      const bs = document.querySelectorAll('.flip-card');
      [x, y].forEach(k2 => { if (bs[k2]) bs[k2].classList.add('is-wrong'); });
      await new Promise(r => setTimeout(r, 420));
      if (this.game !== g) return;                        // 中途重开过就别管了
      [x, y].forEach(k2 => { if (bs[k2]) bs[k2].classList.remove('is-wrong'); });
      await new Promise(r => setTimeout(r, 180));
      if (this.game !== g) return;
      g.deck[x].up = g.deck[y].up = false;
      g.open = [];
      this.syncGame();
    }
  },

  async finishMemory() {
    const g = this.game;
    if (!g || g.over) return;
    g.over = true;
    if (g.timer) clearInterval(g.timer);
    const secs = Math.floor((Date.now() - g.startAt) / 1000);
    const score = Math.max(100, 1000 - g.moves * 20 - secs * 3);
    const rs = document.getElementById('gameResult');
    if (rs) rs.textContent = '配对完成！' + g.moves + ' 步 · ' + this.mmss(Date.now() - g.startAt) + ' · ' + score + ' 分';
    try {
      const r = await API.post('/api/games/scores', { game: 'memory', score: score });
      if (r && r.tops) this.gameTops = r.tops;
      else {
        const t = await API.get('/api/games/scores?game=memory');
        this.gameTops = (t && t.tops) || [];
      }
      const box = document.getElementById('gameRanks');
      if (box) box.innerHTML = this.rankItems();
      toast('得了 ' + score + ' 分，已上榜');
    } catch (e) {
      toast('分数没能上榜：' + (e && e.message ? e.message : '稍后再试'));
    }
  },

  async renderBoard() {
    this.pageTitle = '留言板 · 白日梦咖啡馆';
    let data = { note: '', items: [], total: 0, has_more: false, next_before: null, can_post: false };
    try {
      data = await API.get('/api/board');
    } catch (e) {
      data.load_error = true;
    }
    this.board = { items: data.items || [], has_more: !!data.has_more, next_before: data.next_before || null };
    const u = this.state.user;
    const isAdmin = !!(u && u.role === 'admin');
    const note = String(data.note || '');
    return `
    <div class="page board-page">
      ${this.topbar()}
      <div class="page-head">
        <h1>留言板</h1>
        <p>随便聊聊，或者给店长留句话。</p>
      </div>

      <section class="board-board${isAdmin ? ' is-editable' : ''}" id="boardBoard">
        <div class="bb-head">
          <span class="bb-label">今日推荐</span>
          ${isAdmin ? `<button type="button" class="bb-edit" id="bbEdit">编辑</button>` : ''}
        </div>
        <div class="bb-text" id="bbText">${note ? esc(note).replace(/\n/g, '<br>') : `<span class="bb-empty">${isAdmin ? '点右上角「编辑」，写下今天想说的话' : '店长还没写今天的推荐'}</span>`}</div>
        ${isAdmin ? `
        <div class="bb-editor" id="bbEditor" hidden>
          <textarea id="bbInput" rows="3" maxlength="500" placeholder="例如：今日推荐 · 榛果拿铁，第二杯半价">${esc(note)}</textarea>
          <div class="bb-actions">
            <button type="button" class="btn btn-small" id="bbSave">保存</button>
            <button type="button" class="btn btn-small btn-ghost" id="bbCancel">取消</button>
            <span class="hint" id="bbHint"></span>
          </div>
        </div>` : ''}
      </section>

      <section class="board-notes">
        ${data.can_post ? `
        <div class="note-card note-compose">
          <div class="note-compose-head">${this.avatarHtml(u, 36)}<span>以「${esc(u.username)}」的身份留言</span></div>
          <textarea id="boardInput" rows="3" maxlength="500" placeholder="想说什么……"></textarea>
          <div class="note-compose-foot">
            <span class="hint" id="boardHint"></span>
            <button type="button" class="btn btn-small" id="boardSend">贴上便签</button>
          </div>
        </div>` : `
        <div class="note-card note-guest">
          <span>留言板上任何人都可以看，<a href="#/login">登录</a>之后就能贴自己的便签。</span>
        </div>`}
        <div class="board-list" id="boardList">${this.boardNotes()}</div>
        ${this.board.has_more ? `<button type="button" class="board-more" id="boardMore">看更早的留言</button>` : ''}
        ${data.total ? `<p class="board-count">一共 ${data.total} 张便签</p>` : ''}
      </section>
    </div>`;
  },

  // 谁能删这张便签：本人或管理员。这里只决定「显示不显示删除按钮」，
  // 真正的权限由后端 DELETE /api/board/comments/:id 再判一次。
  canDeleteNote(c) {
    const u = this.state.user;
    if (!u || !c) return false;
    return u.role === 'admin' || c.user_id === u.id;
  },

  // 便签列表（首次渲染与「看更早」之后都走它，避免两处各写一遍）
  boardNotes() {
    const items = (this.board && this.board.items) || [];
    if (!items.length) return `<p class="board-empty">还没有人留言，来做第一个吧。</p>`;
    return items.map(c => `
      <article class="note-card note-item">
        <header class="note-head">
          ${this.avatarHtml({ username: c.username, avatar: c.avatar }, 36)}
          <span class="note-name">${esc(c.username)}</span>
          <time class="note-time">${esc(formatTime(c.created_at))}</time>
          ${this.canDeleteNote(c) ? `<button type="button" class="note-del" data-note="${c.id}" title="删掉这张便签">删除</button>` : ''}
        </header>
        <p class="note-text">${esc(c.content).replace(/\n/g, '<br>')}</p>
      </article>`).join('');
  },

  async renderPersonal() {
    const m = await this.ensureMenu();
    this.pageTitle = '个人章 · 白日梦咖啡馆';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 个人章</div>
      <div class="page-head">
        <span class="eyebrow">読み切り</span>
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
  /* 设定的类型筛选行。类型存在 chapter_title 里（设定类文章本来不用章标题），
     所以这里不用额外的数据结构，菜单里已经带着 setting_type 了。 */
  settingFilterRow(items) {
    const types = this.settingTypes(items);
    const cur = this.settingFilter || '';
    const btn = (v, label) => `<button type="button" class="set-tab${cur === v ? ' is-on' : ''}" data-settype="${esc(v)}">${esc(label)}<b>${v ? items.filter(x => (x.setting_type || '其它') === v).length : items.length}</b></button>`;
    return `<div class="set-tabs">${btn('', '全部')}${types.map(t => btn(t, t)).join('')}</div>`;
  },

  // 有哪些类型（按固定顺序，没出现过的就不显示）
  settingTypes(items) {
    const order = ['地点', '人物', '组织', '名词', '其它'];
    const has = {};
    (items || []).forEach(x => { has[x.setting_type || '其它'] = true; });
    return order.filter(t => has[t]);
  },

  // 按类型分组渲染
  settingGroups(items) {
    const cur = this.settingFilter || '';
    const list = (items || []).filter(x => !cur || (x.setting_type || '其它') === cur);
    if (!list.length) return '<p class="empty-hint">这一类还没有内容。</p>';
    const types = this.settingTypes(items);
    // 设定卡片做成小方块：只留名字，不要简介 —— 一行能塞下更多，
    // 类型靠颜色区分（data-type 给 CSS 用），一眼就能看出这页有哪几类。
    const card = (x) => `
          <a class="set-card" data-type="${esc(x.setting_type || '其它')}" href="#/read/${x.id}" title="${esc(this.excerpt(x))}">
            <span class="set-dot"></span><span class="set-name">${esc(x.title)}</span>
          </a>`;
    if (cur) return `<div class="article-grid grid-settings">${list.map(card).join('')}</div>`;
    return types.map(t => `
        <section class="setting-group" data-group="${esc(t)}">
          <h2 class="set-group-title">${esc(t)}<span>${list.filter(x => (x.setting_type || '其它') === t).length}</span></h2>
          <div class="article-grid grid-settings">${list.filter(x => (x.setting_type || '其它') === t).map(card).join('')}</div>
        </section>`).join('');
  },

  /* #/wiki/名字 —— 互链的落点。
     按名字在设定里查（名字就是 title），查到就跳到那一篇；
     查不到就显示「这个词条还没写」，管理员可以直接去新建（名字已经带过去）。 */
  async renderWiki(name) {
    const m = await this.ensureMenu();
    const want = String(name || '').trim();
    const hit = (m.settings || []).find(x => String(x.title || '').trim() === want);
    if (hit) { location.hash = '#/read/' + hit.id; return ''; }
    const u = this.state.user;
    const isAdmin = !!(u && u.role === 'admin');
    this.pageTitle = want + ' · 还没有这个词条';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / <a href="#/settings">设定</a> / ${esc(want)}</div>
      <div class="page-head">
        <span class="eyebrow">未收录</span>
        <h1>${esc(want)}</h1>
        <p>这个词条还没有写。正文里写了 <code>[[${esc(want)}]]</code> 的地方，就会连到这里。</p>
      </div>
      ${isAdmin
        ? `<p class="wiki-make"><a class="btn btn-small btn-primary" href="#/admin/new?setting=${encodeURIComponent(want)}">去新建「${esc(want)}」</a></p>`
        : `<p class="wiki-make">等店长补上。可以先去 <a href="#/settings">设定</a> 看看别的。</p>`}
    </div>`;
  },

  /* 正文渲染之后走一遍：把指向不存在词条的链接标成「红链」。
     渲染器本身不知道哪些词条存在（它要保持是纯函数），所以这件事放在这里做。 */
  markWiki(root) {
    const box = root || document.getElementById('app');
    if (!box) return;
    const m = this.state.menu;
    /* 菜单还没加载就先取一次，取完再标记。少了这一步，预览会把所有互链
       都当成"没写过"而显示成灰色 —— 误报比不报更糟。 */
    if (!m || !m.settings) {
      this.ensureMenu().then(() => this.markWiki(box)).catch(() => {});
      return;
    }
    const names = {};
    m.settings.forEach(x => { names[String(x.title || '').trim()] = true; });
    box.querySelectorAll('a.wiki').forEach(a => {
      const href = a.getAttribute('href') || '';
      const raw = href.replace(/^#\/wiki\//, '');
      let name = raw;
      try { name = decodeURIComponent(raw); } catch (e) {}
      a.classList.toggle('is-missing', !names[String(name).trim()]);
    });
  },

  async renderSettings() {
    const m = await this.ensureMenu();
    this.pageTitle = '设定 · 白日梦咖啡馆';
    return `
    <div class="page">
      ${this.topbar()}
      <div class="breadcrumb"><a href="#/menu">书架</a> / 设定</div>
      <div class="page-head">
        <span class="eyebrow">世界観設定</span>
        <h1>设定</h1>
        <p>人物 · 岛屿 · 咖啡馆的来客。</p>
      </div>
      ${this.settingFilterRow(m.settings)}
      <div class="setting-groups">${this.settingGroups(m.settings)}</div>
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

  /* 「回到原文」那一条。只有当读者是【从另一篇正文点互链过来的】才显示，
     而且不在原文自己那一页显示。存的是 sessionStorage，关标签页即清。 */
  wikiBackBar(article) {
    let rec = null;
    try { rec = JSON.parse(sessionStorage.getItem('daydream-wiki-back') || 'null'); } catch (e) { rec = null; }
    if (!rec || !rec.hash) return '';
    if (Date.now() - (rec.ts || 0) > 30 * 60 * 1000) {
      try { sessionStorage.removeItem('daydream-wiki-back'); } catch (e) {}
      return '';
    }
    if (String(rec.hash) === String(location.hash || '')) return '';
    return `<p class="wiki-back"><a href="${esc(rec.hash)}" data-wikiback="1">← 回到《${esc(rec.title || '原文')}》</a></p>`;
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
    // 进正文就算读过了（书架上的「已读」标记靠这个）
    this.markRead(article.id);
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
        ${this.wikiBackBar(article)}
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
        
          <a class="admin-export" href="/api/admin/export/zip" download>导出全部（ZIP·每篇一个 txt）</a>
          <a class="admin-export" href="/api/admin/export?format=json" download>备份 JSON（含标记原文）</a>
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
                <a class="admin-export-row" href="/api/admin/export/txt/${a.id}" download>导出</a>
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
    const rich = false;   // 原始 HTML 模式已移除：一律先给纯文本，标记原文随后异步覆盖
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
          <div class="form-row inline" id="sectionFields" ${isMain ? '' : 'style="display:none"'}>
            <div>
              <label>节号</label>
              <input name="section_no" type="number" min="1" placeholder="如 1" value="${a ? a.section_no : ''}">
            </div>
            <div>
              <label>节标题</label>
              <input name="section_title" placeholder="如：新港来的青年" value="${a ? esc(a.section_title) : ''}">
            </div>
          </div>
          <div class="form-row inline set-only" id="settingFields" ${category === 'settings' ? '' : 'style="display:none"'}>
            <div>
              <label>类型 <span class="hint">（设定用：地点 / 人物 / 组织 / 名词 / 其它）</span></label>
              <select name="setting_type">
                ${['地点', '人物', '组织', '名词', '其它'].map(t => `<option value="${t}" ${a && a.chapter_title === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>标签 <span class="hint">（逗号分隔，如：汐凪岛,咖啡）</span></label>
              <input name="tags" placeholder="逗号分隔" value="${a && a.tags ? esc(a.tags) : ''}">
            </div>
          </div>
          <div class="form-row" id="titleRow" ${isMain ? 'style="display:none"' : ''}>
            <label>标题</label>
            <input name="title" placeholder="请输入文章标题" value="${a ? esc(a.title) : ''}">
          </div>
          <div class="form-row">
            <label>卡片简介 <span class="hint">（可不填：留空就自动截取正文开头；在这里写就不会剧透正文）</span></label>
            <input type="text" name="summary" maxlength="300" placeholder="一句话概括这一节/这一篇，显示在卡片上" value="${a && a.summary ? esc(a.summary) : ''}">
          </div>
          <div class="form-row">
            <label>正文内容 <span class="hint">（一行就是一段；工具栏可以插人物卡、图片、互链等（互链写成 <code>[[名字]]</code>，指向同名设定））</span></label>
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
              <button type="button" class="et-btn" data-act="scene" title="章节内换场的一行分隔">场景分隔</button>
              <button type="button" class="et-btn et-key" data-act="say">对白</button>
              <button type="button" class="et-btn" data-act="letter">书信</button>
              <button type="button" class="et-btn" data-act="spoiler">剧透折叠</button>
              <span class="et-sep"></span>
              <button type="button" class="et-btn et-color c-red" data-act="c-r" title="红色">红</button>
              <button type="button" class="et-btn et-color c-yellow" data-act="c-y" title="黄色">黄</button>
              <button type="button" class="et-btn et-color c-blue" data-act="c-b" title="蓝色">蓝</button>
              <button type="button" class="et-btn et-color c-green" data-act="c-g" title="绿色">绿</button>
              <button type="button" class="et-btn et-wiki" data-act="wiki" title="插入指向某个设定的互链（写 [[名字]]）">互链</button>
              <button type="button" class="et-btn et-wiki" data-act="wiki-alias" title="别名互链：显示成别的文字，但指向那个设定（写 [[名字|显示文字]]）">别名</button>
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
          <!-- 原始 HTML 模式（高级）已按店长要求移除：后台只用标记式编辑器。
               想恢复见 archive/raw-html-mode.md -->
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
  /* 把"为什么没加载动态壁纸"集中成一处：控制台能报出来，测试也能断言 */
  /* ---------- 点击封面时的风铃音效（浏览器实时合成，0 KB 下载） ----------
     风铃是「有音高的金属敲击声」，物理很干净：一根金属管的振动是几个非谐分音
     （频率比 1 : 2.756 : 5.404 : 8.933），高次分音衰减更快。照这个叠加，再加
     6ms 的击打噪声和几拍衰减延迟当混响 —— 和 tools/make-chime.py 是同一套算法。
     想换风格只改下面的 CHIME_VOICING（单声 / 三声 / 摇曳）。 */
  chime(voicing) {
    // 默认音型：一声清响（参数可覆盖，便于预览里 A/B 对比）
    const V = voicing || [[1046.5, 0, 1]];
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;                        // 老浏览器直接静音，绝不耽误点书
    try {
      if (!this._ac) this._ac = new Ctx();
      const ac = this._ac;
      if (ac.state === 'suspended' && ac.resume) ac.resume();   // iOS 必须在用户手势里恢复
      const RATIOS = [1, 2.756, 5.404, 8.933];
      const TAUS = [1.7, 0.85, 0.48, 0.26];   // 衰减更长：拖尾更久，像真的金属管
      const AMPS = [1, 0.42, 0.20, 0.09];
      const t0 = ac.currentTime + 0.02;
      const master = ac.createGain();
      master.gain.value = 0.09;              // 很轻：它是点缀，绝不能盖过阅读
      master.connect(ac.destination);
      // 几拍衰减延迟当混响，给一点空间感（干声会显得很电子）
      [[0.055, 0.24], [0.098, 0.17], [0.163, 0.12], [0.242, 0.085], [0.341, 0.055]].forEach(function (pair) {
        const dl = ac.createDelay(0.5);
        dl.delayTime.value = pair[0];
        const gg = ac.createGain();
        gg.gain.value = pair[1];
        master.connect(dl); dl.connect(gg); gg.connect(ac.destination);
      });
      // 敲响一根管子
      const ping = function (f0, at, amp) {
        for (let i = 0; i < RATIOS.length; i++) {
          const o = ac.createOscillator();
          o.type = 'sine';
          o.frequency.value = f0 * RATIOS[i];
          const g = ac.createGain();
          const dur = TAUS[i] * 3.2;
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(AMPS[i] * amp, at + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
          o.connect(g); g.connect(master);
          o.start(at); o.stop(at + dur + 0.02);
        }
        // 击打瞬间那 6ms 的金属噪声，没有它就不像敲出来的
        const n = Math.max(1, Math.floor(ac.sampleRate * 0.006));
        const buf = ac.createBuffer(1, n, ac.sampleRate);
        const ch = buf.getChannelData(0);
        for (let k = 0; k < n; k++) {
          ch[k] = (Math.random() * 2 - 1) * Math.exp(-k / (ac.sampleRate * 0.0018));
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const ng = ac.createGain();
        ng.gain.value = 0.30 * amp;
        src.connect(ng); ng.connect(master);
        src.start(at);
      };
      (V || [[1046.5, 0, 1]]).forEach(function (v) { ping(v[0], t0 + v[1], v[2]); });
    } catch (e) { /* 出不了声也绝不能影响看书 */ }
  },

  wallpaperBlockers() {
    const out = [];
    try { if (!window.matchMedia('(min-width: 900px)').matches) out.push('窗口不足 900px'); } catch (e) {}
    try {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (c) {
        if (c.saveData) out.push('浏览器开了省流量');
        const t = c.effectiveType || '';
        if (/(^|-)2g$/.test(t) || t === 'slow-2g' || t === '3g') out.push('网络 ' + t);
      }
    } catch (e) {}
    try { if (this.reduceMotion()) out.push('系统要求减少动态效果'); } catch (e) {}
    return out;
  },

  /* 浏览器拦下自动播放时的兜底：等一次点击（点页面任意处或那枚按钮）再播 */
  armWallpaperTap(v) {
    if (this._wpTapArmed) return;
    this._wpTapArmed = true;
    console.info('[壁纸] 浏览器拦下了自动播放：点一下页面任意处即可播放');
    const go = () => {
      document.removeEventListener('pointerdown', go, true);
      const q = v.play();
      if (q && q.catch) q.catch(() => {});
    };
    document.addEventListener('pointerdown', go, true);
  },

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
    if (!wide || saveData || slow || this.reduceMotion()) {
      // 以前这里是静默 return：出问题时页面上一点线索都没有，只能靠猜。
      // 现在把原因说出来，并且监听窗口变化 —— 条件变好了就自动补上。
      console.info('[壁纸] 暂不加载动态壁纸：' + this.wallpaperBlockers().join('、'));
      if (wide && !this._wpRetry) {
        this._wpRetry = true;
        const retry = () => {
          if (!this.wallpaperBlockers().length) { window.removeEventListener('resize', retry); this.initWallpaper(); }
        };
        window.addEventListener('resize', retry, { passive: true });
      }
      return;
    }
    const src = v.dataset.src;
    if (!src) return;
    v.dataset.loaded = '1';
    v.addEventListener('canplay', () => v.classList.add('on'), { once: true });
    v.addEventListener('error', () => v.classList.remove('on'), { once: true });
    v.src = src;
    const p = v.play();
    // 被浏览器拦下（省电模式、自动播放策略）时不再静默放弃：等一次点击就播
    if (p && p.catch) p.catch(() => this.armWallpaperTap(v));
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
      else if (act === 'scene') R.insertBlock(box, ':::scene');
      else if (act === 'say') R.insertBlock(box, ':::say 角色名\n「台词……」\n:::', 4, 7);
      else if (act === 'letter') R.insertBlock(box, ':::letter 标题\n内容……\n:::', 8, 10);
      else if (act === 'spoiler') R.insertBlock(box, ':::spoiler 后文剧透\n这里写不能提前看的内容……\n:::', 10, 14);
      else if (act.indexOf('c-') === 0) R.surround(box, '{{' + act.slice(2) + '|', '}}', '文字');
      /* 互链：选中了文字就包成 [[选中]]；没选就插 [[名字]] 并把「名字」选中，直接打字即可替换。 */
      else if (act === 'wiki') R.surround(box, '[[', ']]', '名字');
      /* 别名：选中「潮見柒乃」再点，得到 [[潮見柒乃|显示文字]] ——
         链接仍指向潮見柒乃，读者看到的是「显示文字」。没选就把「名字」占位选中。 */
      else if (act === 'wiki-alias') R.surround(box, '[[', '|显示文字]]', '名字');
      else if (act === 'card') {
        const tpl = ':::card 名字 | 别名\n@ 一句话简介（年龄 / 身份 之类）\n正文……\n:::';
        R.insertBlock(box, tpl, 8, 10);
      } else if (act === 'preview') {
        const on = wrap.classList.toggle('preview-off');
        const btn = document.getElementById('etPreviewBtn');
        if (btn) btn.textContent = on ? '显示预览' : '隐藏预览';
      }
      paint();
      this.markWiki(document.getElementById('editorPreview'));   // 预览里的互链：有词条=金色，没写过=灰色
      const n = this.countParagraphs(box.value);
      const hint = document.getElementById('paraHint');
      if (hint) hint.textContent = '共 ' + n + ' 段（一行一段；工具栏插入的块也算在内）';
    };

    bar.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      ev.preventDefault();
      const st = box.scrollTop, sl = box.scrollLeft;   // 记住视野
      doAct(btn.dataset.act);
      box.focus();
      /* 把视野还原回去。textarea 重新获得焦点时，浏览器会把滚动位置拉到光标处，
         长正文里就表现为"框一下子跳到文末"，作者得自己爬回去找刚才写的地方。 */
      box.scrollTop = st;
      box.scrollLeft = sl;
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
  /* ---------- 书架页的 3D 氛围：指针视差 + 空气中的尘埃 ----------
     只在书架页生效（找不到招牌就退出），不碰壁纸、不改单列排布。
     系统要求减少动态效果时只加类名、不做视差，尘埃也不生成。
     指针位置写进 --px / --py，由 CSS 去算倾斜 —— 每帧只改两个变量，开销极小。 */
  initShelf3D() {
    const hero = document.querySelector('.menu-hero');
    const wrap = hero && hero.parentElement;
    if (!hero || !wrap) return;
    wrap.classList.add('menu-3d');
    if (this.reduceMotion()) return;
    // 尘埃：十几颗小光点缓慢上浮，跟着指针有视差
    const d = document.createElement('div');
    d.className = 'dust';
    d.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('i');
      s.style.left = Math.round(Math.random() * 100) + '%';
      s.style.top = (55 + Math.round(Math.random() * 45)) + '%';
      s.style.animationDuration = (9 + Math.random() * 12).toFixed(1) + 's';
      s.style.animationDelay = (-Math.random() * 14).toFixed(1) + 's';
      s.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 90) + 'px');
      s.style.transform = 'scale(' + (0.6 + Math.random() * 1.1).toFixed(2) + ')';
      d.appendChild(s);
    }
    wrap.insertBefore(d, wrap.firstChild);
    if (!this._shelfMove) {
      this._shelfMove = true;
      window.addEventListener('pointermove', (e) => {
        const W = window.innerWidth || 1, H = window.innerHeight || 1;
        document.documentElement.style.setProperty('--px', ((e.clientX / W) * 2 - 1).toFixed(3));
        document.documentElement.style.setProperty('--py', ((e.clientY / H) * 2 - 1).toFixed(3));
      }, { passive: true });
    }
  },

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
    // 整本书都能点（原来的「翻开这本书」按钮已去掉）。
    // 去掉可见按钮后，键盘和读屏用户会打不开 —— 所以补 role=button + tabindex + 回车/空格
    const book = document.getElementById('bookCover');
    if (book) {
      const stack = document.getElementById('bookStack');
      const openBook = () => {
        if (book.classList.contains('turning')) return;        // 连点不要触发两次
        this.chime();                                          // 风铃（点书就在手势里，不会被拦）
        book.classList.add('turning');
        if (stack) stack.classList.add('turning');
        setTimeout(() => { location.hash = '#/menu'; }, 1050);   // 等书页依次翻完
      };
      book.onclick = openBook;
      book.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          openBook();
        }
      };
    }

    // 书架页的「今日一句」：从正文里随机取一句填进去。
    // 取不到就保留上面那句写死的话，页面永远不会空着。
    const quoteEl = document.getElementById('menuQuote');
    if (quoteEl && !quoteEl.dataset.loaded) {
      API.get('/api/quote').then(r => {
        if (!r || !r.text) return;
        quoteEl.dataset.loaded = '1';
        quoteEl.innerHTML = '“' + esc(r.text) + '”' +
          (r.from ? '<span class="quote-author">—— ' + esc(r.from) + '</span>' : '');
      }).catch(() => {});
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
    /* 从「红链」点「去新建」过来时，地址是 #/admin/new?setting=名字 ——
       把分类切到设定，并把名字填进标题，省得再打一遍。 */
    const af = document.getElementById('adminForm');
    if (af && location.hash.indexOf('setting=') > 0) {
      let name = '';
      try { name = decodeURIComponent(location.hash.split('setting=')[1].split('&')[0]); } catch (e) { name = ''; }
      const catSel = document.getElementById('articleCategory');
      const titleBox = document.querySelector('#adminForm input[name="title"]');
      if (name && catSel && titleBox && !titleBox.value) {
        catSel.value = 'settings';
        titleBox.value = name;
        ['mainFields', 'sectionFields', 'titleRow', 'settingFields'].forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.style.display = (id === 'mainFields') ? 'none' : '';
        });
        const tf = document.getElementById('titleRow');
        if (tf) tf.style.display = '';
      }
    }
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
    this.initShelf3D();     // 书架页的 3D 氛围（别的页面会自动跳过）

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
    // 上限只是防呆：反正后面会压缩成 128px，十几 MB 的手机照片完全能处理。
    // 原来卡在 8MB，而现在的手机随手一拍就超 —— 这是手机上「一直失败」的原因之一。
    if (file.size > 40 * 1024 * 1024) { toast('图片太大了（超过 40MB），换一张吧', 'err'); return; }
    try {
      // 压缩后再上传：2MB 的原图 → 约 10KB 的 128×128 webp
      this.pendingAvatar = await shrinkImage(file, 128);
      const box = document.getElementById('avatarPreview');
      if (box) box.innerHTML = `<img class="avatar size-56" src="${esc(this.pendingAvatar)}" alt="">`;
      toast('图片已压缩，点击“保存头像”生效');
    } catch (err) {
      /* 诊断优先：把「哪一步失败、什么原因」直接显示出来。
         手机上不同机型/浏览器卡住的地方不一样，看提示才能对症。
         同时给一条一定走得通的后备：先用截图，或直接用图片链接。 */
      const detail = (err && (err.detail || err.message)) || '未知';
      const mb = (file.size / 1024 / 1024).toFixed(1);
      console.warn('[头像] 压缩失败：' + detail + ' · ' + mb + 'MB · ' + (file.type || '未知类型'));
      toast('图片处理失败（' + detail + '）· ' + mb + 'MB。可以先截图再上传，或直接用图片链接', 'err');
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
    const payload = { category, content: form.content.value.trim(), raw_html: false,
      summary: form.summary ? form.summary.value.trim() : '' };
    // 富文本模式：把标记原文交给后端，由后端统一渲染成正文（前端那份只用来做预览）
      // RAW 模式已移除：永远作为标记原文提交（原来读 rawHtml，删掉那一行后会抛 ReferenceError）
      payload.source = form.content.value;
      if (form.tags) payload.tags = form.tags.value.trim();
      // 设定的「类型」写进 chapter_title —— 复用现成字段，后端无需改动
      if (category === 'settings' && form.setting_type) payload.chapter_title = form.setting_type.value;
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
