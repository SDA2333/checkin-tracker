// SQLite 初始化与建表。首次运行自动创建 data/ 目录与表结构。
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/checkin.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
-- 需要每天/每周签到的网站清单
CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',
  frequency   TEXT    NOT NULL DEFAULT 'daily',   -- daily | weekly
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
  remind_before_days  INTEGER NOT NULL DEFAULT 3,  -- 到期前几天开始提醒
  note                TEXT    NOT NULL DEFAULT '',
  archived            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 续期历史，便于回看
CREATE TABLE IF NOT EXISTS renewal_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  renewal_id  INTEGER NOT NULL,
  renewed_on  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (renewal_id) REFERENCES renewals(id) ON DELETE CASCADE
);
`);

export default db;
