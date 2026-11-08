# 白日梦咖啡馆 · 绘空事

汐凪岛上的咖啡馆故事，一个跑在 Cloudflare Pages + Pages Functions + D1 上的小说站。

- 展示地址：<https://daydream7.pages.dev>
- 前端：原生 JS（hash 路由）+ 手写 CSS，**无构建步骤**，`public/` 直接就是产物
- 后端：Pages Functions 单文件路由 `functions/api/[[route]].js`
- 数据库：Cloudflare D1（binding 名必须是 `DB`）
- 主题：只有一套「夜读」（深色），配色跟着主页壁纸走
- 对话：咖啡馆前台（AI 对话）已下线，见文末「已下线的功能」

---

## 目录结构

```
public/                       静态资源（Pages 发布目录，原样部署）
  index.html                  单页入口 + SEO / 分享元信息
  robots.txt                  爬虫规则
  _headers                    安全响应头 + 静态资源缓存
  css/style.css               全部样式（唯一的主题 + 壁纸配色 + 毛玻璃）
  js/theme-boot.js            首屏绘制前定好主题，避免闪白
  js/api.js                   fetch 封装（超时、错误统一）
  js/rich.js                  标记式正文 → HTML（编辑器实时预览用）
  js/docx.js                  Word（.docx）/ 纯文本 导入解析
  js/app.js                   全部前端逻辑（书架 / 阅读 / 后台 / 编辑器）
  games/quality/              幻梦牌（index.html 页面与样式、game.js 流程、
                              engine.js 规则、pvp.js 联机、analysis.html 复盘、
                              sfx-data.js 11 记采样音效的 base64 包）
  media/wallpaper.mp4         主页动态壁纸（另含 poster 海报图与 lqip 低清占位）
  media/wallpaper-palette.css 从壁纸里提取的配色（页面配色跟着它走）
  media/logo-*.png            logo 三种规格（封面蒙版 / 小徽记 / 实心剪影）
  media/cover-night.webp      封面那本书的夜景插画（340×472 裁切后再压）
  media/card-back.webp        幻梦牌的牌背（烫金印章）
  media/favicon.png           站点图标（180 与 32 两个尺寸）
functions/api/[[route]].js    全部后端接口（含富文本渲染，与 rich.js 必须一致）
schema.sql                    D1 表结构与索引（换新库时执行一次）
tools/                        素材处理脚本（壁纸 / logo / 风铃），都在本地跑
archive/                      已下线功能的代码与恢复说明（不在 public/ 里，不会部署）
.preview/                     本地预览用（假后端 + 同步的测试副本），已 gitignore
.github/workflows/backup.yml  每周自动导出 D1 备份
wrangler.toml                 Pages 配置（发布目录、D1 绑定）
```

`archive/` 里每个文件都写明了「原来是什么、为什么下线、怎么恢复」：

| 文件 | 原功能 |
| --- | --- |
| `chat-module.js` | 咖啡馆前台（AI 对话） |
| `themes.css` / `theme-module.js` | 另外两套主题（海洋 / 暖纸）—— 现在只有「夜读」 |
| `continue-reading.js` | 书架上的「继续阅读」卡片（**已恢复上线**，这个文件只作历史存档） |
| `cover-whale.js` | 封面原有的鲸鱼插画（现为烫金徽记） |
| `cover-button.md` | 封面按钮的旧样式 |
| `favicon-moon.svg` | 旧的月亮图标 |
| `menu-stats.md` | 书架上的作品统计行 |
| `raw-html-mode.md` | 后台的「原始 HTML 模式（高级）」 |

---

## 环境变量

在 Cloudflare 控制台 **Pages → 你的项目 → Settings → Environment variables** 配置。

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | ✅ | 登录令牌的签名密钥，**至少 16 位**（建议 32 位以上的随机串，比如 `openssl rand -hex 32`）。未配置时站点仍可浏览，但任何人都无法登录（这是刻意的安全设计，绝不会回退到默认密钥）。修改它会让所有已登录用户掉线一次。 |
| `DEEPSEEK_API_KEY` | 暂时不用 | 对话功能的密钥。**该功能已下线**，恢复时才需要。 |
| `CHAT_DAILY_LIMIT` | 暂时不用 | 对话的全站每日条数上限（默认 300）。**该功能已下线**。 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | 可选 | 开启注册/登录的人机验证。**两个必须一起配**，只配一个会导致注册页出现验证框却校验失败（或后端强制校验但前端没有控件）。 |

生成一个 `AUTH_SECRET`：

```bash
# macOS / Linux
openssl rand -hex 32
# 任意平台
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 首次部署 / 换了新数据库

```bash
# 1. 建库（如果还没有）
npx wrangler d1 create daydream

# 2. 建表和索引（IF NOT EXISTS，对已有数据没有影响）
npx wrangler d1 execute daydream --remote --file=schema.sql

# 3. 确认没有重名账号，否则建唯一索引会失败
npx wrangler d1 execute daydream --remote --command \
  "SELECT username, COUNT(*) c FROM users GROUP BY username HAVING c > 1;"
```

代码里保留了「每个 isolate 首次请求时补建 `settings` / `chat_usage` / `chat_daily` / `login_attempts` /
`scores` / `game_rank` / `pvp_*` / `media`」以及**给 `articles` 补 `source` / `summary` / `locked` 列**的兜底
（`ALTER TABLE` + 吞掉「已存在」的报错，所以老库会自动升级，不用手动迁移）。但**索引必须靠 `schema.sql` 建**，
否则评论分页和目录接口在大数据量下会变慢。`schema.sql` 里已经包含 `scores` / `game_rank` / `media`
三张表，新库跑一次就齐了。

把第一个管理员标出来：

```bash
npx wrangler d1 execute daydream --remote --command \
  "UPDATE users SET role='admin' WHERE username='你的用户名';"
```

## 本地开发

```bash
npx wrangler pages dev public --d1 DB=daydream
```

（`--d1` 指向本地库；也可以直接用 `wrangler.toml` 里的绑定。）

---

## 正文的标记语法

后台编辑器是**标记式**的：左边写标记，右边实时预览。工具栏点一下就会插入对应模板，
不需要背语法。

| 写法 | 效果 |
| --- | --- |
| 一行一段 | 段落（从 Word 粘贴时**整篇没有空行就每行一段**，有空行则按空行分段） |
| `**文字**` | **加粗**（正文基准字重是 350，加粗 700，对比明显） |
| `*文字*` | *斜体* |
| `## 标题` / `### 标题` | 小标题 / 次级标题 |
| `> 文字` | 引用（连续多行会合成一个引用块） |
| `---` | 分隔线 |
| `![说明](图片地址)` | 插图 |
| `{{r\|文字}}` `{{y\|}}` `{{b\|}}` `{{g\|}}` | 红 / 黄 / 蓝 / 绿 四种字色（色值偏柔和，深色纸上不刺眼） |

块语法都是 `:::` 开头、`:::` 收尾（`:::scene` 例外，它只占一行）：

| 写法 | 效果 |
| --- | --- |
| `:::card 潮見柒乃 \| 18 岁 · 咖啡师`<br>`安静少言。`<br>`:::` | 人物卡（书名号里的 `\|` 后面写副标题） |
| `:::note 提醒`<br>`内容`<br>`:::` | 提示块 |
| `:::scene` | 场景分隔（渲染出一枚居中的 ❧，用于章内换场） |
| `:::say 神代桐悠`<br>`「你见过雪吗？」`<br>`:::` | 对白（角色名金色小字 + 台词，左侧一道竖线） |
| `:::letter 一封来信`<br>`致店长：……`<br>`:::` | 书信（信纸面板，标题下一条虚线） |
| `:::spoiler 后文剧透`<br>`他其实是……`<br>`:::` | **剧透折叠**：默认收起，点标题才展开 |

> **剧透折叠**用的是浏览器原生的 `<details>`，所以不需要任何 JS ——
> 关掉 JavaScript 也照样能展开。

### ⚠️ 渲染器有两份，必须保持一致

前端 `public/js/rich.js` 负责**实时预览**，后端 `functions/api/[[route]].js` 里的
`richToHtml` 负责**生成正式正文**。两份实现必须逐字等价，否则「作者看到什么」和
「读者看到什么」就会不一样。

- 新增一种语法时，**两边一起改**
- `preview-test/check-parsers.mjs` 会直接比对两边代码（忽略注释与缩进差异），
  比样本测试更硬 —— 新增语法自动纳入
- 顺序建议：**先把新语法的样本加进测试**，再动两边

### 序章怎么写

章号约定：**序章填 `0`，第一章填 `1`，第二章填 `2`**……列表里就会显示成「序章 / 第 01 章 / 第 02 章」。

显示上做了处理：**章号为 0、或章标题以「序章 / 序言 / 序幕 / 序曲 / 楔子 / 引子 / 前言」开头**的，
在章列表、章节页眉标、阅读页眉标里都会显示成「序章」，而不是「第 00 章」。
数据库里存的章号仍然是 0，只是列表显示时做了换算（见 `public/js/app.js` 的 `chapterLabel()`）。

### 卡片简介（防剧透）

个人章与设定的**列表卡片**原本显示正文开头（自动截取），容易剧透。
后台编辑器「正文内容」上方有一个**卡片简介**输入框：

- **填了** → 卡片上就显示你写的那句，正文一个字都不露
- **留空** → 完全照旧（自动截取正文开头）

存在 `articles.summary` 里，老文章不用做任何处理。

---

## 图片：插图和头像（2026 年 11 月改版）

### 插图：编辑器里直接选本地图片

后台编辑器的工具条上有一枚「图片」按钮，点了会弹出文件选择框，**不需要自己找图床上传**：

1. 选一张本地图片（PNG / JPG / WebP / GIF 都行）
2. 浏览器里压一遍：最长边 1400px、质量 0.86 的 WebP；如果压完还超过 620KB，会再压到 1000px / 0.78
3. `POST /api/media` 上传，落到 D1 的 `media` 表
4. 正文里插入 `![图片说明](/api/media/12)`，**「图片说明」四个字会自动选中**，直接打字就能改

图片走 `GET /api/media/:id` 输出，带 `max-age=31536000, immutable`，一张图只下载一次。
单张上限 700KB（实际插图多在 100~300KB）。老写法 `![说明](https://外链)` 依然有效。

渲染时 `![说明](地址)` 会变成一个 `<figure>`，`style.css` 里 `.reading-content figure { text-align: center }`
—— **图片天然居中**，不需要额外标记。

> 为什么存 D1：这个项目没有 R2 / KV（见文末「还可以继续做的」）。图片以 base64 存在 `media` 表里，
> 由 Worker 解成二进制吐出来。量再大一个数量级就该搬去 R2 了。

### 头像

- 上传：客户端压到 128px 的 WebP，`PUT /api/me/avatar`，**上限 64KB，且拒绝 GIF 动图**（动图太占地方）
- 读取：所有列表接口只回一个地址 `/api/avatar/<uid>`，带 7 天 immutable 缓存 + ETag
- 没设头像：该地址回一张 68 字节的透明 PNG（不是 404），前端露出名字首字母，控制台也不会红

> 历史包袱：2026-11-08 之前允许 300KB 且能传 GIF，库里至今还留着一个 789KB 的动图头像。
> 它现在只会被单独请求一次（之后走缓存），但那位作者重新选一张静态图会更省。

---

## 后台：从 Word 文件导入文章

后台「文章管理 → 新增文章」页面的顶部有「从文件导入」，选一个文件（或者直接把文件拖到表单上）就行。

| 格式 | 支持情况 |
| --- | --- |
| `.docx`（Word 2007 及以后） | 完整解析：段落、段内换行、制表符、标题级别 |
| `.txt` / `.md` | 按行拆段 |
| `.doc`（旧版二进制格式） | 不支持，会提示先在 Word 里「另存为 .docx」 |

导入后会自动填好：

- **正文**（交给 `plainToHtml()` 自动分段：**整篇没有空行时每行算一段**，有空行则按空行分段；
  所以从 Word 直接粘贴不用手动补空行，和文件导入效果一致）
- **章号 / 章标题 / 节号 / 节标题** —— 从文件名或文档里的第一个标题解析，中文数字也认（「第三章」→ 3）
- **按节拆分**：文档里如果有「第 N 节」这样的标题，会提示「拆成 N 篇分别发布」，勾上之后一次提交就能把整章建成多篇文章（节号沿用文档里的编号，没写编号的自动接在现有节号后面）

解析**完全在浏览器本地完成**，文件不会上传到任何地方；解析结果先填进表单，确认无误再点发布。

实现见 `public/js/docx.js`：没有引入任何第三方库。`.docx` 本身就是一个 zip，
用浏览器自带的 `DecompressionStream('deflate-raw')` 解开 `word/document.xml`，
再用正则取 `<w:p>` / `<w:t>` 拼出段落。（这样也就不需要给站点加构建步骤或 npm 依赖。）

## 后台：导出

「文章管理」页导航里有两个入口，每篇文章的「操作」列里还有一个单独的「导出」：

| 入口 | 得到什么 | 用途 |
| --- | --- | --- |
| 操作列的**导出** | 那一节的 `.txt`（标题 + 更新日期 + 分隔线 + 正文） | 单篇留档 / 发给别人 |
| **导出全部（ZIP·每篇一个 txt）** | 一个 zip，里面按 `主线故事/章/节.txt` 分好目录，**一篇一个文件，不合并** | 整站留档 |
| **备份 JSON（含标记原文）** | `.json`，含每篇的 `source`（标记原文）与纯文本、时间戳 | **日后恢复靠它** |

ZIP 是后端手写封装的（Worker 环境没有 zip 库）：本地文件头 + 数据 + 中央目录 + EOCD，
只做存储不压缩，文件名标了 UTF-8 位，所以中文名不会乱码。

---

## 主页动态壁纸

主页（`#/`）的背景是 `D:\素材库` 里那张咖啡厅动态壁纸，处理脚本在 `tools/make-wallpaper.py`。
它会做四件事：切一段短循环压成网页尺寸的 MP4、抽一张海报图、生成极小的模糊占位图（首屏不白屏）、
并从画面里提取配色写成 `public/media/wallpaper-palette.css`（页面配色跟着壁纸走）。

```powershell
# 需要 ffmpeg（没有的话脚本会尝试用 pip 装的 imageio-ffmpeg）
python tools/make-wallpaper.py --src "D:\素材库\咖啡厅壁纸动态.mp4" `
  --out public/media --start 6.5 --dur 10 --width 1280 --crf 30
```

- `--start` 取关键帧处最干净（源视频每 10 秒一个关键帧）；循环是否无缝可以用 `pick-loop.py` 的思路算
- 视频只在宽屏、非省流量、非 3G、且系统没开"减少动态效果"时加载；其余情况只显示海报图
- 想换壁纸：把新素材放进 `D:\素材库`，改 `--src` 重新跑一遍即可，不用动任何代码

## 其它素材脚本

素材改动后**只需重跑脚本、提交产物**，站点本身没有构建步骤。

| 脚本 | 用途 |
| --- | --- |
| `tools/make-logo.py` | 把白底的 logo 原图转成三种规格：`logo-mask.png`（封面烫金用蒙版）、`logo-mark.png`（顶栏与书架的小徽记）、`logo-simple.png`（favicon 用的实心剪影），并生成 favicon |
| `tools/make-chime.py` | 离线合成风铃音色，用来对照调整前端合成参数（听感对齐用，不参与部署） |
| `tools/make-wallpaper.py` | 壁纸转码 + 抽海报 + 抽配色（见上一节） |

前端的风铃音是**用 Web Audio 现场合成**的（不加载任何音频文件，占用 0 KB）：
钟管的不谐和分音 `1 : 2.756 : 5.404 : 8.933`、6ms 敲击噪声、若干延迟抽头，
参数与 `tools/make-chime.py` 里的一致。

## 备份（很重要）

整本小说只存在 D1 里。`.github/workflows/backup.yml` 每周一自动导出一次 SQL 并保存为 Actions artifact（保留 90 天）。
**后台的「备份 JSON」是另一条更细的备份线**（含标记原文，可读、可 diff）。两条都建议留着。

- 需要仓库 Secrets：`CLOUDFLARE_API_TOKEN`（D1:Edit 权限）、`CLOUDFLARE_ACCOUNT_ID`
- 也可以随时手动跑：`npx wrangler d1 export daydream --remote --output=backup.sql`
- ⚠️ 导出的 SQL 含全部正文。**如果这个仓库是公开的，不要把备份提交回仓库**，用 artifact 或私有 R2 桶。

---

## 前端资源的版本戳（改了前端必看）

`public/index.html` 里引用自家 js / css 时**一律带版本戳**：

```html
<script src="/js/app.js?v=20261015"></script>
<link rel="stylesheet" href="/css/style.css?v=20261015">
```

**为什么**：这些文件走长缓存，而文件名不变。改了前端却不改版本戳，
用户（尤其是手机）可能一直读到旧文件 —— 于是每次修 bug 都要先怀疑
「到底是没修好，还是缓存？」。这个坑真踩过：手机上头像上传失败，
排查了三个来回，其中一轮就是被缓存盖住了真实结果。

**规矩**：每次改动 `public/js/` 或 `public/css/` 下的文件，
就把 `index.html` 里的 `?v=` 日期改成当天（`20261015` 这样的八位数字即可）。
`preflight.mjs` 里有一条守卫会检查这件事，漏了会报出来。

## 留言板与游戏（2026 年 10 月新增）

底部导航：**书架 · 留言 · 游戏 · 我的**（主线 / 个人篇 / 设定的路由都还在，
只是从书架进入，不再占导航格）。

| 位置 | 说明 |
| --- | --- |
| `#/board` 留言板 | 顶部一块**黑板**，只有管理员能编辑（存在 `settings` 表的 `board_note`）；下面是一张张**便签**，两栏错落。**游客能看不能写**；本人可删自己的便签，管理员可删任何一条 |
| `#/games` 游戏主页 | 选择页，每张游戏卡带自己的迷你榜（前三名）；游客进来直接跳登录 |
| `#/games/memory` | 记忆翻牌：4×4 共 8 对，牌面用 ☕ ❧ 🐈 🌙 ☂ 🎐 📖 ⛄ |
| `#/games/number` | 猜数字：连着出三个 1~100 的数，三个都猜中才算完（故意压掉运气成分） |
| `#/profile` 我的 | 头像、角色、退出登录；右上角头像也指向这里 |

计分统一为 `1000 − 次数×20 − 秒数×3`，下限 100。排行榜取**每个用户的最高分**，
只显示**前五名**。后端只有一张 `scores` 表（`game / user_id / username / score`）
和三个接口：

```
GET    /api/games/scores?game=xxx        公开，前五名
POST   /api/games/scores                 需登录，分数限 0..100000
DELETE /api/admin/games/scores?game=…    仅管理员清榜（clear 全部要明说 game=all）
```

留言板的接口复用了 `comments` 表，约定 `article_id = 0` 表示留言板
（真实文章 id 从 1 开始，不会撞；目录接口的 `comment_count` 也只按文章 id 关联）。

## 幻梦牌 · 双人对局（PvP，异步轮流出牌）

和朋友约一局，不用同时在线：谁有空谁出牌，两边都出了才结算。**不计段位、不计分**。

```
入口    /games/quality/?room=ABCD      （房间码 6 位，去掉 0/O/1/I）
建房    单机牌桌右下角「和好友开一局」→ 跳到 ?room=CODE，把链接发过去
对局    每回合双方各交两张；我先出、你三天后再出，结果一样（双方同时亮牌，没有先后手）
结束    分出胜负 / 认输；没人管的房间不会自动清理，但也不会打扰谁
```

**为什么不做 WebSocket**：异步对局不需要常连接，轮询一下就够了。真正的难点是
「谁来算牌」—— 现在整副牌都在浏览器里算，PvP 如果照旧，对手开 F12 就能看到我的手牌。
所以 PvP 一律**服务端裁决**：

| | 做法 |
| --- | --- |
| 存什么 | `pvp_rooms`（房间 + `seed` 随机种子）+ `pvp_moves`（每人每回合每种动作一行） |
| 不存什么 | **局面不落库**。每次请求都拿 `seed` + 动作记录重放（`engine.pvpReplay`） |
| 下发什么 | 只发我自己的手牌 + 对手的**张数**；对手的牌要等结算后才公开 |
| 怎么防冲突 | `pvp_moves` 主键 `(code, round_no, side, kind)`，两个人同时提交各写各的行，不需要锁 |
| 怎么防作弊 | 出牌/弃牌都要校验：是不是你的回合、牌在不在你手里、是不是冷却中 |
| 弃牌 | 月亮点名和手牌超上限都要**自己挑**弃哪张（`kind='discard'` 另存一行） |
| 过期 | 房间 24 小时没人动就按"不存在"处理（读取时判断，不留垃圾数据） |

引擎只有一份 `public/games/quality/engine.js`，服务端用 `functions/api/engine.js`
（同一份文件的副本，`preflight` 会比对两份是否逐字节一致，不一致就不许推）。

```
POST /api/pvp/rooms                    建房（需登录）→ { code, url }
GET  /api/pvp/rooms                    我还没打完的房间
GET  /api/pvp/rooms/:code              房间局面（只有自己那半边）
POST /api/pvp/rooms/:code/join         入座（满员 409）
POST /api/pvp/rooms/:code/play         出牌 { round, cards:[id,id] }
POST /api/pvp/rooms/:code/discard      弃牌 { round, cards:[id,…] }
POST /api/pvp/rooms/:code/resign       认输
```

本地怎么试：`node preview-server.cjs` 后开两个浏览器（或 `?as=2` 切身份），
一个建房一个加入；验收脚本是 `pvp-browser.mjs`（真页面）和 `pvp-e2e.mjs`（真接口）。
**还没做的**：对局日志导出、观战、公开房间。

## 开发与自测

推送即部署（Pages 与仓库 git 连接，约 60–85 秒后生效），所以**推送前必须先自测**。

测试脚本放在仓库**之外**（本机 `preview-test/`），另有一份同步副本在 `.preview/tests/`
（已 gitignore）。也就是说：**改测试永远不需要推送，也永远影响不到线上**。

```powershell
# 一条命令跑完全部 12 项，退出码 0 才放行
node preflight.mjs
```

`preflight.mjs` 覆盖：

| 检查 | 说明 |
| --- | --- |
| 渲染 / 前端页面 | `app-render-check.mjs`，200+ 条静态断言（含「用到的 class 必须有定义」「不许出现 undefined」等） |
| 样式规则 | `css-check.mjs`：毛玻璃只能在壁纸页用、不许写死颜色（实物本色区除外）、变量必须有定义或兜底 |
| 假后端一致性 | `mock-check.mjs`：`.preview/mock-api.js` 与真后端的形状一致 |
| Word 导入 | `docx-check.mjs` |
| 后端接口 | `harness.mjs`：跑一个桩 D1，含 **SQL 绑定一致性**（列数 / 占位符 / values 数组长度必须相符）与**没有启用对话功能时不许泄露内部错误** |
| 封面资源 | `svg-check.py` |
| 前后端解析器一致 | `check-parsers.mjs`，见上文「渲染器有两份」 |
| 修复工具自测 | `asserts-repair.mjs --selftest` |
| 新语法端到端渲染 | 一个全特性样本过一遍前端解析器，检查 13 项特征是否都在 |
| 已删除功能的残留 | 审计本次会话删掉的名字（`rawHtml`、`applyTheme`、`continueReading` 等），**只看代码、跳过注释与存档** —— 这条正是用来抓「删了引用没删干净」的 |
| JS 语法检查 | 逐个 `node --check` |
| 线上资源文件 | 壁纸、海报、三个 logo、两个 favicon 是否都在 |

本地预览（改样式/文案时先看这个，不要直接推）：

```powershell
node preview-server.cjs        # 起在 8899，根目录指向仓库
# 然后开 http://127.0.0.1:8899/.preview/preview.html
```

预览页顶部有一排开关（游客/登录、模拟延迟、模拟新章节、富文本示例、风铃试听等），
用的是 `.preview/mock-api.js` 这套假后端 —— 所以**离线也能把界面看全**。

几个踩过的坑（写在这儿省得再踩）：

- 管理页的**骨架屏**里也有一段 `<div class="admin-nav">`，往导航里插东西时要挑
  「里面确实有 `<a>` 链接」的那一个，否则按钮只在加载的一瞬间出现
- 往渲染函数里插代码前先确认自己动的是**真页面**，不是 `loadingSkeleton`
- 小改动别写「JS 套 Python 套 PowerShell」三层，引号层数一多必出错；能用单引号字符串就用

还有一个更硬的做法值得以后补上：**行为级**比对 —— 把同一份样本分别喂给两个渲染器，
比对**输出的 HTML**（需要后端多导出一个 `richToHtml`）。文本比对只能证明代码像，
行为比对才能证明结果一样。

---

## 性能（2026-11-08 体检）

测量方式：无头 Edge + CDP，**关掉缓存**、1440×900，读 `performance.getEntriesByType('resource')`
汇总（脚本在仓库外的 `analysis/perf-probe.mjs`，不参与部署）。

| 页面 | 请求 | 传输 |
| --- | --- | --- |
| 书架 `#/menu` | 20 | **299KB** |
| 正文 `#/read/1` | 22 | **307KB** |

最大的一笔曾经不是图片也不是 JS，而是**留言接口里内嵌的头像 base64**：`/api/board` 1.58MB、
评论接口 790KB，占首屏下载量的 77%（一个 789KB 的动图头像被复制进每条留言）。
现在列表只回 `/api/avatar/<uid>`，两个接口降到 **777B / 585B**。

剩下的瓶颈（按体积）：Google Fonts 的中文 CSS 89KB、海报 59KB、`logo-mask.png` 55KB、
`app.js` 55KB、`style.css` 48KB。前三项都还有压的空间，见文末「还可以继续做的」。

> 记一笔：字节数掉 5 倍并不会让 DCL 等比例下降 —— 首屏时间主要卡在字体 CSS 和几张图上，
> 优化资源体积省的是**流量和白屏前的下载时长**，尤其对手机流量有意义。

---

## 接口一览

| 方法 | 路径 | 是否需要登录 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/config` | 否 | 站点公开配置（Turnstile site key） |
| GET | `/api/health` | 否 | 健康检查 |
| POST | `/api/register` | 否 | 注册（用户名 2-20 位，密码至少 8 位） |
| POST | `/api/login` | 否 | 登录，同一用户名 15 分钟内失败 10 次会被限流 |
| POST | `/api/logout` | 否 | 退出（清 Cookie） |
| GET | `/api/me` | 否 | 当前登录用户，未登录返回 `{user:null}` |
| PUT | `/api/me/avatar` | 是 | 设置头像（只接受 `https://` 或 `data:image/*`，**上限 64KB，拒绝 GIF**） |
| GET | `/api/avatar/:id` | 否 | 头像二进制（7 天 immutable 缓存 + ETag；没设头像回 68B 透明 PNG） |
| POST | `/api/media` | 管理员 | 上传插图（`{type,data,width,height,name}`，700KB 上限）→ `{id,url,bytes}` |
| GET | `/api/media/:id` | 否 | 插图二进制（1 年 immutable 缓存） |
| GET | `/api/menu` | 否 | 目录 + **摘要**（不返回正文；摘要优先用 `summary`，没填才自动截取） |
| GET | `/api/quote` | 否 | 「今日一句」：从主线/个人章里随机取一句 |
| GET | `/api/article/:id` | 否 | 文章正文 |
| GET | `/api/article/:id/comments?limit=20&before=<id>` | 否 | 留言分页，返回 `{items, has_more, total, next_before}` |
| POST | `/api/article/:id/comments` | 是 | 发留言 |
| GET | `/api/board?limit=20&before=<id>` | 否 | 留言板（复用 `comments`，`article_id=0`），含黑板文案 `note` |
| POST | `/api/board` | 是 | 贴一张便签 |
| DELETE | `/api/board/comments/:id` | 是 | 删便签（本人或管理员） |
| GET | `/api/chat/config` | — | **已下线**，返回 404 |
| POST | `/api/chat` | — | **已下线**，返回 404 |
| GET/POST/PUT/DELETE | `/api/admin/articles...` | 管理员 | 文章增删改查（**正文以标记原文 `source` 提交**） |
| GET | `/api/admin/source/:id` | 管理员 | 取某篇的标记原文（编辑器回填用） |
| GET | `/api/admin/export/txt/:id` | 管理员 | 单篇导出 `.txt` |
| GET | `/api/admin/export/zip` | 管理员 | 全部导出为 `.zip`（每篇一个 txt） |
| GET | `/api/admin/export?format=json` | 管理员 | 完整备份（含 `source`） |
| GET/PUT/DELETE | `/api/admin/users...` | 管理员 | 用户角色与删除 |
| GET/PUT | `/api/admin/chat-config` | — | **已下线**，返回 404 |

> 后端里仍保留 `raw_html === true` 的兼容分支（几行）。界面上的「原始 HTML 模式（高级）」
> 已按需要移除，留着这个分支是当**安全网**：万一以后发现有「正文是手写富 HTML、
> 又没有标记原文」的文章，接口层面还能原样保存。见 `archive/raw-html-mode.md`。

游戏与联机的接口不在上面这张表里，见上文「留言板与游戏」「幻梦牌 · 双人对局」两节
（`/api/games/scores*`、`/api/pvp/rooms*`）。

---

## 部署后需要手动做的事

1. **配置 `AUTH_SECRET`**（不配的话登录会直接报错）。
2. 对线上库执行一次 `schema.sql`（建索引）。
3. 想开人机验证就配 `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET`。
4. 如果仓库里还有多余的顶层 `workflows/` 目录，删掉它（定时任务必须放在 `.github/workflows/` 下才生效）。
5. 可选：Pages → Settings → **关闭 Single Page Application 回退**。本项目用的是 hash 路由，不需要 SPA 回退；关掉之后不存在的路径会正确返回 404，而不是把首页当成 200 返回（现在搜索引擎会认为满站都是同一个页面）。

## 已下线的功能

### 咖啡馆前台（AI 对话）· 暂时下线

| 位置 | 处理方式 |
| --- | --- |
| 书架入口 | 已移除（`renderMenu()` 里不再有那张卡片） |
| `#/chat` 路由 | 已移除，访问会跳回书架（老书签不会白屏） |
| 后台「对话设定」页 | 已从后台导航和路由中移除 |
| 三个接口 | `functions/api/[[route]].js` 里的 `CHAT_FEATURE = false`，统一返回 404 |
| 前端代码 | 存档在 [`archive/chat-module.js`](archive/chat-module.js)，恢复步骤写在文件顶部 |
| 样式 | 2026-11-08 的死代码清理里已删掉 `.chat-*`（当时无页面引用）；恢复办法见本节末尾 |
| 数据库 | `chat_usage` / `chat_daily` 表和管理员设定都还在，恢复后不丢 |

恢复只需要四步，`archive/chat-module.js` 顶部有完整说明：把文件移回 `public/js/`、在
`index.html` 加一行 `<script>`、把 `app.js` 里的几处接回去（文件末尾附了要贴回的 HTML）、
把 `CHAT_FEATURE` 改成 `true`。

⚠️ **第五步（2026-11-08 新增）**：对话的那批 `.chat-*` 样式已经在死代码清理里删掉了
（当时它们确实没有任何页面在用）。恢复前先从 git 历史里取回那一节：

```bash
git show 4150763:public/css/style.css | grep -n "chat-"   # 找到行号区间后手工贴回
```

### 其它已下线的部分

| 功能 | 处理方式 |
| --- | --- |
| 另外两套主题（海洋 / 暖纸） | 只保留「夜读」；代码在 `archive/themes.css` / `archive/theme-module.js`，恢复步骤见文件内说明 |
| 作品统计行 | 存档 `archive/menu-stats.md` |
| 封面的鲸鱼插画 | 换成烫金徽记；原代码在 `archive/cover-whale.js` |
| 「原始 HTML 模式（高级）」 | 从编辑器移除；见 `archive/raw-html-mode.md`（后端保留了兼容分支） |

> 书架上的「继续阅读」曾经下架过（`archive/continue-reading.js`），现在**已经回来了**：
> `app.js` 的 `resumeBar()` 渲染 `.resume-wrap / .resume-bar / .resume-chip`。
> 存档文件留着当历史，不参与部署。

## 还可以继续做的

- **设定篇系统化**：地点 / 组织 / 名词做成卡片与互链，读者不必记设定
- **站内搜索**：现在只能靠目录翻，篇数一多就不好找
- **人物关系 + 年表**：把人物卡之间的关系可视化
- **把 hash 路由换成 History API**：这样每篇文章会有真实 URL（`/read/12`），可以被搜索引擎收录、被单独分享。改动涉及全站链接，建议单独排一次。
- **加 og:image**：截一张 1200×630 的封面图放到 `public/`，然后补 `index.html` 里的 `og:image`，微信/QQ 分享才有大图。
- **大头像搬去 R2**：现在头像以 base64 存在 `users.avatar` 里，读的时候由 `/api/avatar/<uid>` 转成二进制
  并长缓存（列表接口只回地址，不再内嵌）。还剩一个 789KB 的历史动图，作者重选一次就没了；
  真要长期存大图/sticker，R2 仍然更合适。
- **再压首屏**：`logo-mask.png` 55KB 只是当 CSS 遮罩用（显示尺寸 22px），降到 256px 或换 SVG 能省 ~40KB；
  Google Fonts 那份 89KB 的中文字体 CSS 可以子集化（只留站内出现过的字）或改本地托管；
  海报 59KB 还能转 AVIF（约 35KB，要多一条 fallback）。
- **行为级渲染比对**：见上文「开发与自测」最后一段。
