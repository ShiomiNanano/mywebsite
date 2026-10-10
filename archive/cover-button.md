# 封面原来的「翻开这本书」按钮

2026-10-10 去掉：店长要求**点封面那本书的任意处**就能打开，不再需要单独的按钮。

## 原来的 HTML（在 cover-scene 里，book-cover 之后）

```html
<button class="btn-cover" id="openBook">翻 开 这 本 书</button>
```

## 原来的绑定（afterRender 里）

```js
const openBtn = document.getElementById('openBook');
if (openBtn) {
  openBtn.onclick = () => {
    document.getElementById('bookCover').classList.add('turning');
    setTimeout(() => { location.hash = '#/menu'; }, 900);
  };
}
```

## 原来的样式

```css
.btn-cover { /* 见 git 历史里 style.css 的 .btn-cover 与 .landing .btn-cover 规则 */ }
.landing .btn-cover { /* 颜色取自 --wp-* 壁纸配色 */ }
```

## 恢复步骤

1. 把上面的 HTML 放回 cover-scene，并把 `.book-cover` 上的
   role/tabindex/aria-label 去掉（同时删掉 afterRender 里 book.onclick / onkeydown 那段）
2. 把按钮的 CSS 从 git 历史里取回（`git log -p -- public/css/style.css | grep btn-cover`）
3. 把测试里"不再有单独的翻开按钮"那条断言删掉，改回 `has('封面有开启按钮', landing, 'id="openBook"')`
