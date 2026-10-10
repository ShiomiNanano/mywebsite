/* ============================================================
   主题引导：必须在 CSS 之前同步执行。
   （CSP 里没有允许内联脚本，所以单独放一个文件）
   ============================================================ */
(function () {
  // 站点目前只保留「夜读」一套主题（海洋 / 暖纸已下线，见 archive/themes.css）。
  // 仍然写上 data-theme 属性，方便将来恢复多主题、也方便 CSS 里按主题写规则。
  document.documentElement.setAttribute('data-theme', 'night');

  // 手机浏览器的地址栏 / 状态栏颜色（否则夜读时上面还是一条白）
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#0c1822');

  // 阅读字号也在这里恢复，否则阅读页会先按默认字号渲染再跳一下
  var f = '0';
  try { f = localStorage.getItem('daydream-font-size') || '0'; } catch (e) {}
  if (['0', '1', '2'].indexOf(f) < 0) f = '0';
  document.documentElement.setAttribute('data-font', f);
})();
