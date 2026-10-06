/* ============================================================
   主题引导：必须在 CSS 之前同步执行，避免深色主题用户看到一瞬间白屏。
   （CSP 里没有允许内联脚本，所以单独放一个文件）
   ============================================================ */
(function () {
  var THEMES = ['ocean', 'paper', 'night'];
  var t = null;
  try { t = localStorage.getItem('daydream-theme'); } catch (e) {}
  if (THEMES.indexOf(t) < 0) {
    // 没有保存过就看系统偏好：深色系统 → 夜读，否则用海洋（站点的默认身份）
    var dark = false;
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    t = dark ? 'night' : 'ocean';
  }
  document.documentElement.setAttribute('data-theme', t);

  // 手机浏览器的地址栏 / 状态栏颜色跟着主题走（否则夜读时上面还是一条白）
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    var BG = { ocean: '#e8f0f6', paper: '#f3ecdd', night: '#0c1822' };
    meta.setAttribute('content', BG[t] || BG.ocean);
  }

  // 阅读字号也在这里恢复，否则阅读页会先按默认字号渲染再跳一下
  var f = '0';
  try { f = localStorage.getItem('daydream-font-size') || '0'; } catch (e) {}
  if (['0', '1', '2'].indexOf(f) < 0) f = '0';
  document.documentElement.setAttribute('data-font', f);
})();
