/* ============================================================================
   简易富文本标记 → HTML（浏览器端）
   ----------------------------------------------------------------------------
   ⚠️ 这套规则必须和 functions/api/[[route]].js 里的 richToHtml() 完全一致 ——
      前端用它做实时预览，后端用它生成正式正文。两边不一致的话，
      作者看到的和实际发布的就不一样了。测试里有一条"逐条比对两边输出"守这个。

   标记一览（写的时候可以不记，编辑器工具栏会插）：
     一行就是一段
     **加粗**   *斜体*
     ## 小标题      ### 更小的标题
     > 引用一段
     ---            分隔线
     ![说明](图片地址)
     :::card 名字 | 别名
     @ 一句话简介
     正文……
     :::
     :::note 提示标题
     内容
     :::
   行尾打两个空格 = 和下一行之间用软换行（不另起一段）
   ============================================================================ */
window.Rich = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // 行内标记。先转义再套标签 —— 顺序反了的话，粘贴进来的 <script> 会被当成真标签。
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  function paras(buf, cls) {
    return buf.map(function (b) { return b.trim(); }).filter(Boolean)
      .map(function (b) { return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + inline(b) + '</p>'; })
      .join('');
  }

  // 人物卡：复用站点原有的 .char-block / .char-name / .char-note / .char-meta / .char-desc
  function cardHtml(head, buf) {
    var parts = String(head || '').split('|');
    var name = (parts[0] || '').trim();
    var note = (parts[1] || '').trim();
    var lines = buf.slice();
    var meta = '';
    if (lines.length && /^@\s?/.test(lines[0].trim())) meta = lines.shift().trim().replace(/^@\s?/, '');
    return '<div class="char-block">' +
      ((name || note)
        ? '<div class="char-head">' +
          (name ? '<span class="char-name">' + inline(name) + '</span>' : '') +
          (note ? '<span class="char-note">' + inline(note) + '</span>' : '') +
          '</div>'
        : '') +
      (meta ? '<p class="char-meta">' + inline(meta) + '</p>' : '') +
      paras(lines, 'char-desc') +
      '</div>';
  }

  function noteHtml(head, buf) {
    return '<div class="rc-note">' +
      (head ? '<p class="rc-note-title">' + inline(head) + '</p>' : '') +
      paras(buf) +
      '</div>';
  }

  function render(text) {
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var raw = lines[i];
      var t = raw.trim();
      if (!t) { i++; continue; }

      var img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(t);
      if (img) {
        out.push('<figure><img src="' + img[2] + '" alt="' + esc(img[1]) + '" loading="lazy" decoding="async">' +
          (img[1] ? '<figcaption>' + esc(img[1]) + '</figcaption>' : '') + '</figure>');
        i++; continue;
      }

      if (/^(?:-\s*){3,}$/.test(t) || /^(?:\*\s*){3,}$/.test(t)) { out.push('<hr>'); i++; continue; }

      var h = /^(#{2,3})\s+(.+)$/.exec(t);
      if (h) {
        var lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++; continue;
      }

      if (/^>\s?/.test(t)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, '').trim());
          i++;
        }
        out.push('<blockquote>' + paras(q) + '</blockquote>');
        continue;
      }

      var blk = /^:::(card|note)\s*(.*)$/.exec(t);
      if (blk) {
        var kind = blk[1], head = blk[2].trim(), buf = [];
        i++;
        while (i < lines.length && lines[i].trim() !== ':::') { buf.push(lines[i]); i++; }
        i++;   // 吃掉收尾的 :::
        out.push(kind === 'card' ? cardHtml(head, buf) : noteHtml(head, buf));
        continue;
      }

      // 普通段落：一行一段；行尾两个空格 = 与下一行软换行相连
      var html = inline(t);
      while (/ {2}$/.test(lines[i]) && i + 1 < lines.length && lines[i + 1].trim()) {
        i++;
        html += '<br>' + inline(lines[i].trim());
      }
      out.push('<p>' + html + '</p>');
      i++;
    }
    return out.join('\n');
  }

  /* ---------- 编辑器工具栏用的小工具 ---------- */

  // 把选中的文字包起来；没选中就插入占位符并把光标放到中间
  function surround(el, before, after, placeholder) {
    var s = el.selectionStart, e = el.selectionEnd, v = el.value;
    var sel = v.slice(s, e) || placeholder || '';
    el.value = v.slice(0, s) + before + sel + after + v.slice(e);
    el.focus();
    el.setSelectionRange(s + before.length, s + before.length + sel.length);
    return el.value;
  }

  // 在选中行的行首加前缀（多行一起加）
  function prefixLines(el, prefix) {
    var v = el.value;
    var s = v.lastIndexOf('\n', Math.max(0, el.selectionStart - 1)) + 1;
    var e = v.indexOf('\n', el.selectionEnd);
    if (e < 0) e = v.length;
    var block = v.slice(s, e) || '这里写内容';
    var out = block.split('\n').map(function (l) { return prefix + l.replace(/^(\s*)(?:#{2,3}\s+|>\s?)?/, '$1'); }).join('\n');
    el.value = v.slice(0, s) + out + v.slice(e);
    el.focus();
    el.setSelectionRange(s, s + out.length);
    return el.value;
  }

  // 在光标处插入一个块级标记（前后保证独立成行；文末也留一个换行，
  // 否则作者接着敲的字会粘在标记后面，比如 ---文字）
  function insertBlock(el, text, selStart, selEnd) {
    var v = el.value, s = el.selectionStart, e = el.selectionEnd;
    var before = v.slice(0, s);
    var after = v.slice(e);
    var pad = (before && !/\n$/.test(before)) ? '\n' : '';
    var tail = after ? (/^\n/.test(after) ? '' : '\n') : '\n';
    el.value = before + pad + text + tail + after;
    el.focus();
    var base = before.length + pad.length;
    if (selStart == null) el.setSelectionRange(base + text.length, base + text.length);
    else el.setSelectionRange(base + selStart, base + (selEnd == null ? text.length : selEnd));
    return el.value;
  }

  return { render: render, inline: inline, esc: esc, surround: surround, prefixLines: prefixLines, insertBlock: insertBlock };
})();
