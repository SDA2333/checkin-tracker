// SQLite 初始化与建表。首次运行自动创建 data/ 目录与表结构。
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/checkin.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

db.exec(`
-- 需要每天/每周签到的网站清单
CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',
  frequency   TEXT    NOT NULL DEFAULT 'daily',   -- daily | weekly
  active_from TEXT    NOT NULL DEFAULT '',        -- 从哪一天开始计入签到总数
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,          -- 1 = 已归档/暂停
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 打卡记录：每个网站每天最多一条
CREATE TABLE IF NOT EXISTS checkins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL,
  date        TEXT    NOT NULL,                    -- YYYY-MM-DD（客户端本地日期）
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, date),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);

-- 需要周期性续期的项目（如 40 天续期）
CREATE TABLE IF NOT EXISTS renewals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  url                 TEXT    NOT NULL DEFAULT '',
  cycle_days          INTEGER NOT NULL,            -- 周期天数，如 40
  last_renewed        TEXT    NOT NULL,            -- 上次续期日期 YYYY-MM-DD
  current_period_start TEXT   NOT NULL DEFAULT '',  -- 当前周期开始日期 YYYY-MM-DD
  current_period_end   TEXT   NOT NULL DEFAULT '',  -- 当前周期到期日期 YYYY-MM-DD
  renewal_policy       TEXT   NOT NULL DEFAULT 'extend_from_due', -- extend_from_due | reset_from_payment | manual_effective_date
  remind_before_days  INTEGER NOT NULL DEFAULT 3,  -- 到期前几天开始提醒
  note                TEXT    NOT NULL DEFAULT '',
  archived            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 推送配置
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 推送历史记录
CREATE TABLE IF NOT EXISTS notification_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at    TEXT NOT NULL,
  items      TEXT NOT NULL,  -- JSON 数组
  status     TEXT NOT NULL,  -- success | failed
  error_msg  TEXT,
  results    TEXT,           -- JSON 数组
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON notification_logs(sent_at);

-- 续期历史，便于回看
CREATE TABLE IF NOT EXISTS renewal_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  renewal_id  INTEGER NOT NULL,
  renewed_on  TEXT    NOT NULL,
  paid_on     TEXT    NOT NULL DEFAULT '',
  effective_on TEXT   NOT NULL DEFAULT '',
  previous_period_start TEXT NOT NULL DEFAULT '',
  previous_period_end   TEXT NOT NULL DEFAULT '',
  new_period_start      TEXT NOT NULL DEFAULT '',
  new_period_end        TEXT NOT NULL DEFAULT '',
  policy_used           TEXT NOT NULL DEFAULT '',
  note                  TEXT NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (renewal_id) REFERENCES renewals(id) ON DELETE CASCADE
);
`);

function columnsOf(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name));
}

function ensureColumn(table, column, definition) {
  const columns = columnsOf(table);
  if (!columns.has(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn('renewals', 'current_period_start', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewals', 'current_period_end', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewals', 'renewal_policy', "TEXT NOT NULL DEFAULT 'extend_from_due'");
ensureColumn('sites', 'active_from', "TEXT NOT NULL DEFAULT ''");

db.prepare(
  `UPDATE sites
   SET active_from = COALESCE(
     (SELECT MIN(checkins.date) FROM checkins WHERE checkins.site_id = sites.id),
     substr(created_at, 1, 10)
   )
   WHERE active_from = '' OR active_from IS NULL`
).run();

ensureColumn('renewal_history', 'paid_on', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewal_history', 'effective_on', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewal_history', 'previous_period_start', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewal_history', 'previous_period_end', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewal_history', 'new_period_start', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewal_history', 'new_period_end', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewal_history', 'policy_used', "TEXT NOT NULL DEFAULT ''");
ensureColumn('renewal_history', 'note', "TEXT NOT NULL DEFAULT ''");

ensureColumn('renewals', 'category', "TEXT NOT NULL DEFAULT ''");

db.prepare(
  `UPDATE renewals
   SET current_period_start = last_renewed
   WHERE current_period_start = '' OR current_period_start IS NULL`
).run();

db.prepare(
  `UPDATE renewals
   SET current_period_end = date(last_renewed, '+' || cycle_days || ' days')
   WHERE current_period_end = '' OR current_period_end IS NULL`
).run();

db.prepare(
  `UPDATE renewal_history
   SET paid_on = renewed_on
   WHERE paid_on = '' OR paid_on IS NULL`
).run();

db.prepare(
  `UPDATE renewal_history
   SET effective_on = renewed_on
   WHERE effective_on = '' OR effective_on IS NULL`
).run();

db.prepare(
  `UPDATE renewal_history
   SET new_period_start = renewed_on
   WHERE new_period_start = '' OR new_period_start IS NULL`
).run();

db.prepare(
  `UPDATE renewal_history
   SET new_period_end = date(renewed_on, '+' || COALESCE((SELECT cycle_days FROM renewals WHERE renewals.id = renewal_history.renewal_id), 0) || ' days')
   WHERE new_period_end = '' OR new_period_end IS NULL`
).run();

db.prepare(
  `UPDATE renewal_history
   SET policy_used = 'legacy'
   WHERE policy_used = '' OR policy_used IS NULL`
).run();

// 从环境变量迁移推送配置到数据库（仅首次运行）
function migrateEnvToDb() {
  const existing = db.prepare('SELECT COUNT(*) as count FROM settings').get();
  if (existing.count > 0) return; // 已有配置，跳过迁移

  const envMapping = {
    bark_urls: process.env.CHECKIN_BARK_URLS?.split(',').map((u) => u.trim()).filter(Boolean) || [],
    bark_title: process.env.CHECKIN_BARK_TITLE || '签到清单续期提醒',
    bark_group: process.env.CHECKIN_BARK_GROUP || '签到清单',
    bark_level: process.env.CHECKIN_BARK_LEVEL || 'timeSensitive',
    bark_icon: process.env.CHECKIN_BARK_ICON || '',
    bark_jump_url: process.env.CHECKIN_BARK_JUMP_URL || '',
  };

  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(envMapping)) {
    stmt.run(key, JSON.stringify(value));
  }

  console.log('[db] 已从 .env 迁移推送配置到数据库');
}

migrateEnvToDb();

export default db;
