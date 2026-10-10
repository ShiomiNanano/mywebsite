-- 白日梦咖啡馆 · D1 数据库结构
--
-- 用法（首次部署或换了新库时执行一次）：
--   npx wrangler d1 execute daydream --remote --file=schema.sql
--
-- 说明：
--   1. 全部语句都是 IF NOT EXISTS，对已经存在的表不会有任何改动（你现有的数据是安全的）。
--   2. 下面的字段是照着代码里的 SQL 还原出来的，和线上库保持一致。
--   3. 代码里已经不再有运行时建表（CREATE TABLE），所以新库必须先跑这个文件，
--      否则 /api/chat 与后台的「对话设定」会报表不存在。

/* ---------- 用户 ---------- */
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,              -- 格式：<salt-hex>$<pbkdf2-hex>
  role          TEXT    NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  avatar        TEXT    NOT NULL DEFAULT '',   -- 头像 URL；建议只存 https:// 或压缩后的 data:image/webp
  created_at    TEXT    NOT NULL               -- UTC，格式 YYYY-MM-DD HH:MM:SS
);

/* ---------- 文章 ---------- */
-- category = 'main'     主线：chapter_no / chapter_title / section_no / section_title 有值
-- category = 'personal' 个人章：只用 title
-- category = 'settings' 设定：只用 title
CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT    NOT NULL,
  chapter_no    INTEGER,
  chapter_title TEXT,
  section_no    INTEGER,
  section_title TEXT,
  title         TEXT,
  content       TEXT    NOT NULL DEFAULT '',   -- HTML（由 plainToHtml 自动分段转成 <p>，或用 RAW 模式直接写）
  sort_order    INTEGER NOT NULL DEFAULT 0,
  source        TEXT,                     -- 富文本标记原文（后台编辑时回填，读者接口不返回）
  created_at    TEXT,
  updated_at    TEXT
);

/* ---------- 留言 ---------- */
-- username / avatar 是写入时的快照，用户注销后留言仍保留并显示为「已注销」
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  user_id    INTEGER,
  username   TEXT    NOT NULL DEFAULT '',
  avatar     TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL,
  created_at TEXT
);

/* ---------- 站点设置（对话人格 / 开场白 / 开关） ---------- */
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

/* ---------- 对话限流 ---------- */
-- 每用户每分钟计数（防刷屏）
CREATE TABLE IF NOT EXISTS chat_usage (
  user_id INTEGER PRIMARY KEY,
  minute  INTEGER NOT NULL,
  cnt     INTEGER NOT NULL
);

-- 全站每天计数（防账单被刷爆；上限由环境变量 CHAT_DAILY_LIMIT 控制）
CREATE TABLE IF NOT EXISTS chat_daily (
  day INTEGER PRIMARY KEY,   -- Math.floor(Date.now() / 86400000)
  cnt INTEGER NOT NULL
);

/* ---------- 登录失败计数（防暴力破解） ---------- */
CREATE TABLE IF NOT EXISTS login_attempts (
  username      TEXT PRIMARY KEY,
  window_minute INTEGER NOT NULL,  -- Math.floor(Date.now() / 60000)
  fails         INTEGER NOT NULL
);

/* ---------- 索引 ---------- */
-- 注意：user 唯一索引要求库里没有重名账号。先跑这条检查，有结果就先清理再建索引：
--   SELECT username, COUNT(*) c FROM users GROUP BY username HAVING c > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username    ON users(username);

-- 评论按文章取列表 + 分页
CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id, id);
-- 注销用户时按 user_id 反查
CREATE INDEX IF NOT EXISTS idx_comments_user    ON comments(user_id);

-- 目录接口的排序
CREATE INDEX IF NOT EXISTS idx_articles_order   ON articles(category, chapter_no, section_no, sort_order, id);
