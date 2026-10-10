/* ============================================================================
   封面原来的插画（星海巨鲸 / 黑洞 / 月亮）—— 已被 logo 取代
   ----------------------------------------------------------------------------
   2026-10-10：店长上传了 logo，要求放在封面代替原来的插画。
   现在封面主图案是 logo 的"金色烫印"效果（见 style.css 里的 .cover-logo）。

   恢复步骤：
     1. 把下面的 coverSVG 常量放回 app.js 顶部（bindSwipe 之前）
     2. 把封面的 <div class="cover-logo" ...></div> 换回
        <div class="cover-illus">${coverSVG}</div>
        并把 <div class="cover-sub">— Daydream Café —</div> 加回标题下面
     3. 把下面【CSS】里的规则放回 style.css
     4. 把 app-render-check 里"封面用上了 logo 蒙版"的断言改回去
   ============================================================================ */

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

/* ---------- 对应的 CSS ---------- */
.cover-illus { width: 100%; }
.cover-illus svg { display: block; width: 100%; height: auto; }

/* 封面插画跟着壁纸调色（SVG 的 fill 属性里不能用 var()，所以用类名从 CSS 覆盖） */
.cover-svg .cv-stars, .cover-svg .cv-stars-w { fill: var(--wp-ink, #d6ecf8); }
.cover-svg .cv-moon { fill: var(--wp-accent, #f0dfae); }
.cover-svg .cv-hole { fill: var(--wp-deep, #05090d); }
.cover-svg .cv-ring { stroke: var(--wp-accent, rgba(240, 223, 174, .5)); }
.cover-svg .cv-whale { stroke: var(--wp-line, rgba(206, 232, 247, .5)); }
.cover-svg .cv-line { stroke: var(--wp-line, rgba(206, 232, 247, .38)); }
.cover-svg .cv-line-soft { stroke: var(--wp-line-soft, rgba(206, 232, 247, .2)); }
.cover-svg .cv-wave { stroke: var(--wp-line, rgba(208, 232, 247, .4)); }
.cover-svg #moonGlow stop, .cover-svg #eyeGlow stop { stop-color: var(--wp-accent, #f0dfae); }
.cover-svg #whaleBody stop:first-child { stop-color: var(--wp-ink, #dceefb); }
.cover-svg #whaleBody stop:last-child { stop-color: var(--wp-accent, #8fc3e4); }
