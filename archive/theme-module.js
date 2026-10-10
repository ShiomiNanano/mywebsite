/* ============================================================================
   主题切换（海洋 / 暖纸 / 夜读）—— 暂时下线
   ----------------------------------------------------------------------------
   用户决定只保留「夜读」一套主题，所以这里保存被拆掉的代码，方便以后恢复。

   恢复步骤：
     1. 把下面【主题常量与方法】放回 app.js 的 applyFont 之前
     2. 把【顶栏按钮】放回 topbar() 的 <div class="topbar-right"> 里，
        并在 return 之前补回： const theme = document.documentElement.getAttribute('data-theme') || 'night';
     3. 把【事件绑定】放回 afterRender 里
     4. 恢复 CSS：见 archive/themes.css 里的说明
     5. 把 theme-boot.js 改回读 localStorage('daydream-theme') / 系统偏好
     6. 把 css-check 里"只有一套主题"的断言改回"三套主题都覆盖关键变量"
   ============================================================================ */

  themes: ['ocean', 'paper', 'night'],
  themeNames: { ocean: '海洋', paper: '暖纸', night: '夜读' },
  themeBg: { ocean: '#e8f0f6', paper: '#f3ecdd', night: '#0c1822' },

  themeIcon(theme) {
    if (theme === 'paper') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.2C10.4 5.9 8.4 5.2 5.8 5.2H3.5v13.6h2.3c2.6 0 4.6.7 6.2 2 1.6-1.3 3.6-2 6.2-2h2.3V5.2h-2.3c-2.6 0-4.6.7-6.2 2z"/><path d="M12 7.2v13.6"/></svg>';
    }
    if (theme === 'night') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 14.8A8.6 8.6 0 0 1 9.2 3.8a8.6 8.6 0 1 0 11 11z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4L6 6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6L6 18M18 6l1.6-1.6"/></svg>';
  },

  applyTheme(t) {
    const theme = this.themes.indexOf(t) > -1 ? t : 'ocean';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('daydream-theme', theme); } catch (e) {}
    const btn = document.getElementById('themeBtn');
    if (btn) {
      btn.innerHTML = this.themeIcon(theme);
      btn.setAttribute('title', '当前主题：' + this.themeNames[theme] + '（点击切换）');
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', this.themeBg[theme] || this.themeBg.ocean);
  },

  toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'ocean';
    const next = this.themes[(this.themes.indexOf(cur) + 1) % this.themes.length] || 'ocean';
    this.applyTheme(next);
    toast('已切换到「' + this.themeNames[next] + '」主题');
  },


    const theme = document.documentElement.getAttribute('data-theme') || 'ocean';

        <button class="icon-btn" id="themeBtn" title="切换主题（海洋 / 暖纸 / 夜读）" aria-label="切换主题">${this.themeIcon(theme)}</button>

    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.onclick = () => this.toggleTheme();


