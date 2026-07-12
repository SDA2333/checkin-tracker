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
  const levels = new Set(['active', 'timeSensitive', 'passive']);
  return {
    urls: Array.isArray(config.bark_urls) ? config.bark_urls.filter((url) => typeof url === 'string') : [],
    group: typeof config.bark_group === 'string' ? config.bark_group : '签到清单',
    level: levels.has(config.bark_level) ? config.bark_level : 'timeSensitive',
    icon: typeof config.bark_icon === 'string' ? config.bark_icon : '',
    jumpUrl: typeof config.bark_jump_url === 'string' ? config.bark_jump_url : '',
    title: typeof config.bark_title === 'string' ? config.bark_title : '签到清单续期提醒',
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

  const parseJson = (value, fallback) => {
    try { return JSON.parse(value); } catch { return fallback; }
  };
  return rows.map((row) => {
    const items = parseJson(row.items || '[]', []);
    const results = parseJson(row.results || '[]', []);
    return {
      id: row.id,
      date: row.sent_at,
      items: Array.isArray(items) ? items : [],
      status: row.status,
      error: row.error_msg,
      results: Array.isArray(results) ? results : [],
      createdAt: row.created_at,
    };
  });
}

/**
 * 获取今天已提醒的续期项 ID 列表
 * @param {string} today - YYYY-MM-DD
 * @returns {Set<number>} 已提醒的 ID 集合
 */
export function getNotifiedToday(today) {
  const rows = db
    .prepare(
      `SELECT items FROM notification_logs
       WHERE sent_at = ? AND status = 'success'
       ORDER BY id DESC`
    )
    .all(today);

  const ids = new Set();
  for (const row of rows) {
    try {
      const items = JSON.parse(row.items || '[]');
      for (const item of items) {
        if (Number.isSafeInteger(item?.id)) ids.add(item.id);
      }
    } catch {
      // 单条损坏日志不应影响其他成功记录的去重。
    }
  }
  return ids;
}
