/* ============================================================================
   Word / 纯文本导入
   ----------------------------------------------------------------------------
   把 .docx 里的正文抽成段落，供后台「新增文章」一键填入。

   为什么自己写而不是用 mammoth 之类的库：
     这个站点没有构建步骤、也没有 npm 依赖，引一个几百 KB 的库不划算。
     .docx 本质是一个 zip，里面 word/document.xml 就是正文，用浏览器自带的
     DecompressionStream 解压 + 正则取段落就够了，还顺带能在 Node 里跑测试。

   支持的格式：
     .docx  → 完整解析（段落、换行、制表符、标题级别）
     .txt / .md → 按行拆段落
     .doc   → 旧版二进制格式，浏览器解不开，会给出明确提示

   对外接口：
     DocxImport.parseFile(file)      → { blocks, plain, chars, headings, meta, hasSectionMarkers }
     DocxImport.splitSections(blocks) → [{ no, title, text }]  按「第 N 节」或标题切分
     DocxImport.parseStruct(text)    → 从标题/文件名里解析 第N章 / 第N节
   ============================================================================ */
(function (global) {
  'use strict';

  var MAX_SIZE = 10 * 1024 * 1024;   // 10MB 足够了，一章 docx 通常几十 KB

  /* ---------------------------------------------------------------- 工具 */
  var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  // 中文数字 → 阿拉伯数字（支持 一 到 九十九）
  function toNumber(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === '十') return 10;
    if (/^十[一二三四五六七八九]$/.test(s)) return 10 + CN_NUM[s[1]];
    if (/^[一二三四五六七八九]十$/.test(s)) return CN_NUM[s[0]] * 10;
    if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(s)) return CN_NUM[s[0]] * 10 + CN_NUM[s[2]];
    return CN_NUM[s] || 0;
  }

  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unescapeXml(s) {
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, function (m, e) {
      if (e.charAt(0) === '#') {
        var code = (e.charAt(1) === 'x' || e.charAt(1) === 'X')
          ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      return ENT[e] !== undefined ? ENT[e] : m;
    });
  }

  // 去掉开头的分隔符、压缩空白
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/^[\s｜|·•\-—–_:：、]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* --------------------------------------------------- 从标题里解析章 / 节 */
  function parseStruct(text) {
    var src = String(text == null ? '' : text).replace(/\.[a-z0-9]{1,5}$/i, '').trim();
    var out = { chapter_no: 0, chapter_title: '', section_no: 0, section_title: '', title: '' };
    var mCh = src.match(/第\s*([0-9]+|[一二三四五六七八九十]+)\s*章/);
    var mSe = src.match(/第\s*([0-9]+|[一二三四五六七八九十]+)\s*节/);

    if (mCh) {
      out.chapter_no = toNumber(mCh[1]);
      var afterCh = src.slice(src.indexOf(mCh[0]) + mCh[0].length);
      var cut = afterCh.search(/第\s*(?:[0-9]+|[一二三四五六七八九十]+)\s*节/);
      out.chapter_title = clean(cut > -1 ? afterCh.slice(0, cut) : afterCh);
    }
    if (mSe) {
      out.section_no = toNumber(mSe[1]);
      out.section_title = clean(src.slice(src.indexOf(mSe[0]) + mSe[0].length));
    }
    out.title = out.section_title || out.chapter_title || clean(src);
    return out;
  }

  function isChapterLine(text) {
    return /^第\s*(?:[0-9]+|[一二三四五六七八九十]+)\s*章/.test(String(text).trim());
  }
  function isSectionLine(text) {
    return /^第\s*(?:[0-9]+|[一二三四五六七八九十]+)\s*节/.test(String(text).trim());
  }
  // 没有样式信息时的兜底判断：像「第3节 xxx」这种短行当标题
  function looksLikeHeading(text) {
    var t = String(text).trim();
    return t.length > 0 && t.length <= 40 && (isChapterLine(t) || isSectionLine(t));
  }

  /* ------------------------------------------------------------------ ZIP */
  function findEOCD(dv) {
    var min = Math.max(0, dv.byteLength - 22 - 65535);
    for (var i = dv.byteLength - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  // 从 zip 里取出指定条目的文本内容
  async function readZipEntry(buf, wantName, inflate) {
    var dv = new DataView(buf);
    var eocd = findEOCD(dv);
    if (eocd < 0) throw new Error('这个文件不是有效的 docx（找不到 ZIP 结尾）');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder('utf-8');

    for (var i = 0; i < count && p + 46 <= dv.byteLength; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;   // 中央目录条目
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(buf, p + 46, nameLen));

      if (name === wantName) {
        if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('docx 内部结构异常');
        var lNameLen = dv.getUint16(localOff + 26, true);
        var lExtraLen = dv.getUint16(localOff + 28, true);
        var dataOff = localOff + 30 + lNameLen + lExtraLen;
        var data = new Uint8Array(buf, dataOff, compSize);
        if (method === 0) return dec.decode(data);          // 未压缩
        if (method === 8) return await inflate(data);       // deflate
        throw new Error('docx 里用了不支持的压缩方式（' + method + '）');
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  }

  async function inflateRawText(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('这个浏览器太旧了，解不开 docx。请用较新的 Chrome / Edge / Safari，或直接把正文粘进输入框');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  /* ------------------------------------------------- document.xml → 段落 */
  // 取出一个 <w:p> 里的文字：w:t 是文本，w:br / w:cr 是换行，w:tab 是制表符
  function paragraphText(pXml) {
    var out = '';
    var re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(br|cr)\s*\/?>|<w:tab\s*\/?>/g;
    var m;
    while ((m = re.exec(pXml)) !== null) {
      if (m[1] !== undefined) out += unescapeXml(m[1]);
      else if (m[2]) out += '\n';
      else out += '\t';
    }
    return out;
  }

  // 标题级别：优先看 outlineLvl，其次看 pStyle（Heading1 / 标题1 / 1）
  function headingLevel(pXml, style) {
    var o = pXml.match(/<w:outlineLvl[^>]*w:val="(\d+)"/);
    if (o) return parseInt(o[1], 10) + 1;
    var h = String(style).match(/^(?:heading|标题)\s*([1-9])$/i);
    if (h) return parseInt(h[1], 10);
    if (/^[1-9]$/.test(String(style))) return parseInt(style, 10);
    return 0;
  }

  function paragraphsOf(documentXml) {
    var body = documentXml
      .replace(/[\s\S]*?<w:body[^>]*>/, '')
      .replace(/<\/w:body>[\s\S]*/, '');
    var raw = body.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g) || [];
    var out = [];
    raw.forEach(function (p) {
      var text = paragraphText(p).replace(/\s+$/, '');
      if (!text.trim()) return;
      var styleM = p.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
      var style = styleM ? styleM[1] : '';
      var lvl = headingLevel(p, style);
      out.push({
        text: text,
        heading: lvl > 0 ? lvl : (looksLikeHeading(text) ? 1 : 0),
      });
    });
    return out;
  }

  /* --------------------------------------------------------------- 主流程 */
  async function parseFile(file, opts) {
    if (!file) throw new Error('没有选择文件');
    if (file.size > MAX_SIZE) throw new Error('文件太大了（超过 10MB）');
    var inflate = (opts && opts.inflate) || inflateRawText;
    var ext = (String(file.name).split('.').pop() || '').toLowerCase();
    var head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    var isZip = head[0] === 0x50 && head[1] === 0x4b;                     // PK
    var isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;

    if (isOle) {
      throw new Error('这是旧版 .doc 格式，浏览器解不开。请在 Word 里「文件 → 另存为 → Word 文档 (.docx)」后再上传');
    }

    var blocks;
    if (isZip) {
      var xml = await readZipEntry(await file.arrayBuffer(), 'word/document.xml', inflate);
      if (xml == null) throw new Error('这个 .docx 里找不到正文（word/document.xml）');
      blocks = paragraphsOf(xml);
    } else if (ext === 'doc') {
      throw new Error('这个 .doc 文件不是新版格式，请在 Word 里另存为 .docx 后再上传');
    } else {
      var text = await file.text();
      blocks = text.split(/\r?\n/).map(function (line) {
        var t = line.replace(/\s+$/, '');
        return { text: t, heading: looksLikeHeading(t) ? 1 : 0 };
      }).filter(function (b) { return b.text.trim() !== ''; });
    }

    // 段内的软换行（Word 里的 Shift+Enter）写成"行尾两个空格"，
  // 这样正文换成富文本标记后仍然是软换行，而不会被拆成两段
  var plain = blocks.map(function (b) { return b.text.trim().replace(/\n/g, '  \n'); }).join('\n\n');
    var headings = blocks.filter(function (b) { return b.heading; });
    var meta = parseStruct(file.name);

    // 文件名里没有的信息，再从文档里的标题补
    if (!meta.chapter_no && !meta.section_no && headings.length) {
      var m2 = parseStruct(headings[0].text);
      if (m2.chapter_no || m2.section_no) meta = m2;
    }
    // 文件名里没写「第 N 节」时，用文档里第一个节标题补上
    if (!meta.section_no) {
      var secHead = headings.filter(function (b) { return isSectionLine(b.text); })[0];
      if (secHead) {
        var m3 = parseStruct(secHead.text);
        if (m3.section_no) meta.section_no = m3.section_no;
        if (m3.section_title && !meta.section_title) meta.section_title = m3.section_title;
      }
    }

    return {
      blocks: blocks,
      plain: plain,
      chars: plain.replace(/\s/g, '').length,
      headings: headings.length,
      hasSectionMarkers: headings.some(function (b) { return isSectionLine(b.text); }),
      meta: meta,
    };
  }

  /* ------------------------------------------------- 按「第 N 节」或标题切分 */
  // 返回 [{ no, title, text }]：每个元素对应将要发布的一篇文章
  function splitSections(blocks) {
    var useSection = blocks.some(function (b) { return b.heading && isSectionLine(b.text); });
    var groups = [];
    var cur = null;

    blocks.forEach(function (b) {
      var t = b.text.trim();
      var isHead = useSection
        ? (b.heading && isSectionLine(t))
        : (b.heading && !isChapterLine(t));
      if (isHead) {
        if (cur) groups.push(cur);
        var st = parseStruct(t);
        cur = { no: st.section_no || 0, title: st.section_title || t, lines: [] };
        return;
      }
      // 章的标题不进正文（章信息由表单单独填）
      if (b.heading && isChapterLine(t)) return;
      if (!cur) cur = { no: 0, title: '', lines: [] };
      cur.lines.push(b.text);
    });
    if (cur) groups.push(cur);

    return groups
      .filter(function (g) { return g.lines.length > 0; })
      .map(function (g) {
        return { no: g.no, title: g.title, text: g.lines.join('\n\n') };
      });
  }

  global.DocxImport = {
    parseFile: parseFile,
    splitSections: splitSections,
    parseStruct: parseStruct,
    MAX_SIZE: MAX_SIZE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
