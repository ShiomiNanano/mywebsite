/* ============================================================================
   书架上的「继续阅读」模块 —— 已下线
   ----------------------------------------------------------------------------
   用户决定移除这个模块（书架现在固定是主线 / 个人章 / 设定三张卡）。

   恢复步骤：
     1. 把下面【卡片渲染】放回 renderMenu() 里 <div class="menu-cards"> 的开头
     2. 把【两个变量】放回 renderMenu() 顶部（const sc = ... 之后）
     3. 样式不用动：.menu-continue 的规则仍在 style.css 里
        （金色卡片那一组，和已下线的对话入口共用；壁纸页的玻璃样式里也有它）
     4. 把 app-render-check 里"读过之后也不显示继续阅读"的断言改回"读过之后出现"

   备注：「上次读到哪」一直在 localStorage（daydream-last-read）里记录着，
        所以恢复之后不需要等用户重新读一遍才出现。
   ============================================================================ */

// ---------- 卡片渲染（放回 <div class="menu-cards"> 开头）----------
//         ${lastArticle ? `
//         <a class="menu-card menu-continue" href="#/read/${lastArticle.id}">
//           <div class="menu-card-icon">❧</div>
//           <div class="menu-card-content">
//             <h3>继续阅读</h3>
//             <p>${esc(this.titleOf(lastArticle))}</p>
//             <span class="menu-card-meta">上次读到这里</span>
//           </div>
//           <div class="menu-card-arrow">→</div>
//         </a>` : ''}

// ---------- 两个变量（放回 renderMenu 顶部）----------
    const last = this.lastRead();
    const lastArticle = last ? this.findArticle(last.id) : null;
