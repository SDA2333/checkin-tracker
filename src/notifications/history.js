// 推送历史与配置管理
import db from '../db.js';

/**
 * 从数据库读取推送配置
 * @returns {Object} 配置对象
 */
export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const config = {};

  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch {
      config[row.key] = row.value;
    }
  }

  // 设置默认值
  return {
    urls: config.bark_urls || [],
    group: config.bark_group || '签到清单',
    level: config.bark_level || 'timeSensitive',
    icon: config.bark_icon || '',
    jumpUrl: config.bark_jump_url || '',
    title: config.bark_title || '签到清单续期提醒',
  };
}

/**
 * 更新推送配置
 * @param {Object} updates - 要更新的配置项
 */
export function updateSettings(updates) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  const mapping = {
    urls: 'bark_urls',
    group: 'bark_group',
    level: 'bark_level',
    icon: 'bark_icon',
    jumpUrl: 'bark_jump_url',
    title: 'bark_title',
  };

  for (const [key, dbKey] of Object.entries(mapping)) {
    if (updates[key] !== undefined) {
      stmt.run(dbKey, JSON.stringify(updates[key]));
    }
  }
}

/**
 * 记录推送日志
 * @param {Object} log - 日志对象
 */
export function logNotification(log) {
  const stmt = db.prepare(`
    INSERT INTO notification_logs (sent_at, items, status, error_msg, results)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    log.date,
    JSON.stringify(log.items),
    log.status,
    log.error || null,
    JSON.stringify(log.results || [])
  );
}

/**
 * 获取推送历史
 * @param {number} limit - 返回条数
 * @returns {Array} 历史记录
 */
export function getNotificationHistory(limit = 30) {
  const rows = db
    .prepare(
      `SELECT id, sent_at, items, status, error_msg, results, created_at
       FROM notification_logs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit);

  return rows.map((row) => ({
    id: row.id,
    date: row.sent_at,
    items: JSON.parse(row.items || '[]'),
    status: row.status,
    error: row.error_msg,
    results: JSON.parse(row.results || '[]'),
    createdAt: row.created_at,
  }));
}

/**
 * 获取今天已提醒的续期项 ID 列表
 * @param {string} today - YYYY-MM-DD
 * @returns {Set<number>} 已提醒的 ID 集合
 */
export function getNotifiedToday(today) {
  const row = db
    .prepare(
      `SELECT items FROM notification_logs
       WHERE sent_at = ? AND status = 'success'
       ORDER BY id DESC LIMIT 1`
    )
    .get(today);

  if (!row) return new Set();

  try {
    const items = JSON.parse(row.items || '[]');
    return new Set(items.map((item) => item.id));
  } catch {
    return new Set();
  }
}
