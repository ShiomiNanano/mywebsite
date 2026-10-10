# 书架招牌上的「作品数据行」

2026-10-10 做过又撤掉：店长觉得招牌上不该出现"几章几节 / 约多少字"，所以整行去掉。

## 原来长这样

```
12 章 · 96 节 · 约 2.6 万字
```

## 恢复需要的三处改动

1. **后端** `functions/api/[[route]].js` 的 `/menu`，在 `return jsonPublic(...)` 之前加：

```js
const st = await env.DB.prepare(
  "SELECT MAX(updated_at) AS updated, " +
  "SUM(LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(content,'<p>',''),'</p>',''),'<br>',''),'<br/>',''))) AS chars " +
  "FROM articles WHERE category IN ('main','personal')"
).first();
const stats = { chars: (st && st.chars) || 0, updated: (st && st.updated) || '' };
```
   并把返回改成 `jsonPublic({ main, personal, settings, latest, stats }, 60)`

2. **前端** `public/js/app.js` 的 `renderMenu`：在 `const cc = m.main.length;` 之前加

```js
const st = (m && m.stats) || null;
const chars = (st && st.chars) || 0;
const stat = !chars ? '' : (chars >= 10000 ? '约 ' + (chars / 10000).toFixed(1) + ' 万' : String(chars));
```
   并在 `.menu-quote` 之后加：

```html
<p class="menu-stats">
  <span><b>${cc}</b> 章</span>
  <span><b>${sc}</b> 节</span>
  ${stat ? `<span><b>${stat}</b> 字</span>` : ''}
</p>
```
   另外 `ensureMenu` 里的 `latest: m.latest || null` 要改成带上 `stats`

3. **样式** `public/css/style.css` 加回 `.menu-stats` 与 `.menu-stats b` 两组规则
