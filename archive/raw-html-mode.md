# 「原始 HTML 模式（高级）」

2026-10-12 移除：店长表示用不到、也从没用过。

## 原来是什么

后台正文编辑器下方有一个勾选框：

```html
<label class="switch-row"><input type="checkbox" id="rawHtml" ${rich ? 'checked' : ''}>
  原始 HTML 模式（高级）</label>
```

勾上时：正文按 HTML 原样保存（不做任何转换）；编辑一篇"正文本身是手写 HTML"的文章时，
它会自动勾上，并把原始 HTML 填进输入框。

## 移除后现在的行为

- 编辑框里永远是**标记式文本**（一行一段；`**加粗**`、`:::card` 那些）
- 提交时永远带 `source`（标记原文），由后端统一渲染成正文
- 表单初始值一律给纯文本，若该文有标记原文，编辑器随后会异步取回并覆盖

## 后端为什么保留 raw_html 分支（4 行，不是漏删）

`functions/api/[[route]].js` 的 `makeContent` / `makeSource` 里仍认 `raw_html === true`。
留着它当**安全网**：万一以后发现有"正文是手写富 HTML、又没有标记原文"的文章，
还能通过接口把它原样保存（届时恢复界面即可）。

## 恢复步骤

1. 把上面的 `label` 那行放回正文编辑器（`archive/raw-html-mode.md` 里就是原文）
2. 把提交处的 `raw_html: false` 改回 `raw_html: rawHtml`，并恢复读取勾选框的那一行
3. 把 `const rich = false;` 改回原来的判定：`const rich = looksRich(a && a.content);`
4. 把渲染测试里"已移除"的断言删掉，改回：
   `has('HTML 文章的「原始 HTML 模式」被自动勾选', formRich, 'id="rawHtml" checked')`
