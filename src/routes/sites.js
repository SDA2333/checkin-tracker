// 网站清单 CRUD
import { Router } from 'express';
import db from '../db.js';
import { isoToday } from '../dates.js';

const r = Router();
const MAX_NAME = 200;
const MAX_URL = 2048;
const MAX_CATEGORY = 100;

function validateText(value, field, max) {
  if (value !== undefined && String(value).length > max) return `${field}不能超过 ${max} 个字符`;
  return null;
}

// 列表（默认不含已归档；?archived=1 返回全部）
r.get('/', (req, res) => {
  const where = req.query.archived === '1' ? '' : 'WHERE archived = 0';
  res.json(db.prepare(`SELECT * FROM sites ${where} ORDER BY sort_order, id`).all());
});

// 新增
r.post('/', (req, res) => {
  const { name, url = '', category = '', frequency = 'daily' } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '名称不能为空' });
  const textError = validateText(name, '名称', MAX_NAME) || validateText(url, '链接', MAX_URL) || validateText(category, '分类', MAX_CATEGORY);
  if (textError) return res.status(400).json({ error: textError });
  if (frequency !== 'daily' && frequency !== 'weekly')
    return res.status(400).json({ error: 'frequency 必须为 daily 或 weekly' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM sites').get().m;
  const activeFrom = isoToday();
  const info = db
    .prepare(`INSERT INTO sites (name, url, category, frequency, active_from, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      String(name).trim(),
      String(url).trim(),
      String(category).trim(),
      frequency,
      activeFrom,
      maxOrder + 1
    );
  res.json(db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid));
});

// 修改（字段可选传，未传保持原值）
r.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const cur = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  const { name, url, category, frequency, archived, sort_order } = req.body || {};
  if (name !== undefined && !String(name).trim())
    return res.status(400).json({ error: '名称不能为空' });
  const textError = validateText(name, '名称', MAX_NAME) || validateText(url, '链接', MAX_URL) || validateText(category, '分类', MAX_CATEGORY);
  if (textError) return res.status(400).json({ error: textError });
  if (frequency !== undefined && frequency !== 'daily' && frequency !== 'weekly')
    return res.status(400).json({ error: 'frequency 必须为 daily 或 weekly' });
  if (archived !== undefined && typeof archived !== 'boolean' && archived !== 0 && archived !== 1)
    return res.status(400).json({ error: 'archived 必须是布尔值' });
  const nextOrder = sort_order !== undefined ? Number(sort_order) : cur.sort_order;
  if (!Number.isSafeInteger(nextOrder)) return res.status(400).json({ error: '排序值无效' });
  db.prepare(
    `UPDATE sites SET name=?, url=?, category=?, frequency=?, archived=?, sort_order=? WHERE id=?`
  ).run(
    name !== undefined ? String(name).trim() : cur.name,
    url !== undefined ? String(url).trim() : cur.url,
    category !== undefined ? String(category).trim() : cur.category,
    frequency !== undefined ? frequency : cur.frequency,
    archived !== undefined ? (archived ? 1 : 0) : cur.archived,
    nextOrder,
    id
  );
  res.json(db.prepare('SELECT * FROM sites WHERE id = ?').get(id));
});

// 与相邻网站交换顺序（dir = 'up' | 'down'）
r.post('/:id/move', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const dir = req.body?.dir;
  if (dir !== 'up' && dir !== 'down') return res.status(400).json({ error: 'dir 必须为 up 或 down' });
  const cur = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  const neighbor = db
    .prepare(
      dir === 'up'
        ? `SELECT * FROM sites WHERE archived=0 AND (sort_order, id) < (?, ?) ORDER BY sort_order DESC, id DESC LIMIT 1`
        : `SELECT * FROM sites WHERE archived=0 AND (sort_order, id) > (?, ?) ORDER BY sort_order ASC, id ASC LIMIT 1`
    )
    .get(cur.sort_order, id);
  if (neighbor) {
    const swap = db.transaction(() => {
      db.prepare('UPDATE sites SET sort_order=? WHERE id=?').run(neighbor.sort_order, cur.id);
      db.prepare('UPDATE sites SET sort_order=? WHERE id=?').run(cur.sort_order, neighbor.id);
    });
    swap();
  }
  res.json({ ok: true });
});

// 删除（连带其打卡记录，由外键 CASCADE 处理）
r.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const result = db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: '不存在' });
  res.json({ ok: true });
});

export default r;
