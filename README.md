# 白日梦咖啡馆 · 绘空事

汐凪岛上的咖啡馆故事，一个跑在 Cloudflare Pages + Pages Functions + D1 上的小说站。

- 展示地址：<https://daydream7.pages.dev>
- 前端：原生 JS（hash 路由）+ 手写 CSS，无构建步骤，`public/` 直接就是产物
- 后端：Pages Functions 单文件路由 `functions/api/[[route]].js`
- 数据库：Cloudflare D1（binding 名必须是 `DB`）
- 对话：~~接入 DeepSeek 的 `deepseek-chat`，读者可以和柒乃聊天~~ → **咖啡馆前台（AI 对话）已暂时下线**，见文末「已下线的功能」

---

## 目录结构

```
public/                     静态资源（Pages 发布目录）
  index.html                单页入口 + SEO / 分享元信息
  favicon.svg               站点图标
  robots.txt                爬虫规则
  _headers                  安全响应头 + 静态资源缓存
  css/style.css             全部样式（海洋 / 暖纸 / 夜读 三套主题）
  js/theme-boot.js          首屏绘制前定好主题，避免深色模式闪白
  js/api.js                 fetch 封装（超时、错误统一）
  js/docx.js                Word（.docx）/ 纯文本 导入解析
  js/app.js                 全部前端逻辑
functions/api/[[route]].js  全部后端接口
schema.sql                  D1 表结构与索引（换新库时执行一次）
archive/chat-module.js      已下线的 AI 对话前端代码（不在 public/ 里，不会部署）
.preview/                   本地预览用（假后端 + 回归测试），已加入 .gitignore
.github/workflows/backup.yml 每周自动导出 D1 备份
wrangler.toml               Pages 配置（发布目录、D1 绑定）
```

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

代码里保留了「每个 isolate 首次请求时补建 `settings` / `chat_usage` / `chat_daily` / `login_attempts`」的兜底，但没有建索引。**索引必须靠 `schema.sql` 建**，否则评论分页和目录接口在大数据量下会变慢。

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

### 序章怎么写

章号约定：**序章填 `0`，第一章填 `1`，第二章填 `2`**……列表里就会显示成「序章 / 第 01 章 / 第 02 章」。

显示上做了处理：**章号为 0、或章标题以「序章 / 序言 / 序幕 / 序曲 / 楔子 / 引子 / 前言」开头**的，
在章列表、章节页眉标、阅读页眉标里都会显示成「序章」，而不是「第 00 章」。
数据库里存的章号仍然是 0，只是列表显示时做了换算（见 `public/js/app.js` 的 `chapterLabel()`）。

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

## 备份（很重要）

整本小说只存在 D1 里。`.github/workflows/backup.yml` 每周一自动导出一次 SQL 并保存为 Actions artifact（保留 90 天）。

- 需要仓库 Secrets：`CLOUDFLARE_API_TOKEN`（D1:Edit 权限）、`CLOUDFLARE_ACCOUNT_ID`
- 也可以随时手动跑：`npx wrangler d1 export daydream --remote --output=backup.sql`
- ⚠️ 导出的 SQL 含全部正文。**如果这个仓库是公开的，不要把备份提交回仓库**，用 artifact 或私有 R2 桶。

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
| PUT | `/api/me/avatar` | 是 | 设置头像（只接受 `https://` 或 `data:image/*`，上限 300KB 字符串） |
| GET | `/api/menu` | 否 | 目录 + **摘要**（不返回正文） |
| GET | `/api/article/:id` | 否 | 文章正文 |
| GET | `/api/article/:id/comments?limit=20&before=<id>` | 否 | 留言分页，返回 `{items, has_more, total, next_before}` |
| POST | `/api/article/:id/comments` | 是 | 发留言 |
| GET | `/api/chat/config` | — | **已下线**，返回 404 |
| POST | `/api/chat` | — | **已下线**，返回 404 |
| GET/POST/PUT/DELETE | `/api/admin/articles...` | 管理员 | 文章增删改查（`raw_html: true` 可原样保存 HTML） |
| GET/PUT/DELETE | `/api/admin/users...` | 管理员 | 用户角色与删除 |
| GET/PUT | `/api/admin/chat-config` | — | **已下线**，返回 404 |

---

## 部署后需要手动做的事

1. **配置 `AUTH_SECRET`**（不配的话登录会直接报错）。
2. 对线上库执行一次 `schema.sql`（建索引）。
3. 想开人机验证就配 `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET`。
4. 删除仓库里多余的 `workflows/` 目录（定时任务要放在 `.github/workflows/` 才会生效，见该目录里的说明）。
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
| 样式 | 仍保留在 `public/css/style.css`（那一节标注了「已下线」） |
| 数据库 | `chat_usage` / `chat_daily` 表和管理员设定都还在，恢复后不丢 |

恢复只需要四步，`archive/chat-module.js` 顶部有完整说明：把文件移回 `public/js/`、在
`index.html` 加一行 `<script>`、把 `app.js` 里的几处接回去（文件末尾附了要贴回的 HTML）、
把 `CHAT_FEATURE` 改成 `true`。

## 还可以继续做的

- **把 hash 路由换成 History API**：这样每篇文章会有真实 URL（`/read/12`），可以被搜索引擎收录、被单独分享。改动涉及全站链接，建议单独排一次。
- **加 og:image**：截一张 1200×630 的封面图放到 `public/`，然后补 `index.html` 里的 `og:image`，微信/QQ 分享才有大图。
- **头像放 R2**：现在是压缩后的 data URI 存在 D1 里，量大了会撑大行宽；R2 更合适。
