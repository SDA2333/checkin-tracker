// 网站清单 CRUD
import { Router } from 'express';
import db from '../db.js';

const r = Router();

// 列表（默认不含已归档；?archived=1 返回全部）
r.get('/', (req, res) => {
  const where = req.query.archived === '1' ? '' : 'WHERE archived = 0';
  res.json(db.prepare(`SELECT * FROM sites ${where} ORDER BY sort_order, id`).all());
});

// 新增
r.post('/', (req, res) => {
  const { name, url = '', category = '', frequency = 'daily' } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '名称不能为空' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM sites').get().m;
  const info = db
    .prepare(`INSERT INTO sites (name, url, category, frequency, sort_order) VALUES (?, ?, ?, ?, ?)`)
    .run(
      String(name).trim(),
      String(url).trim(),
      String(category).trim(),
      frequency === 'weekly' ? 'weekly' : 'daily',
      maxOrder + 1
    );
  res.json(db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid));
});

// 修改（字段可选传，未传保持原值）
r.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  const { name, url, category, frequency, archived, sort_order } = req.body || {};
  db.prepare(
    `UPDATE sites SET name=?, url=?, category=?, frequency=?, archived=?, sort_order=? WHERE id=?`
  ).run(
    name !== undefined ? String(name).trim() : cur.name,
    url !== undefined ? String(url).trim() : cur.url,
    category !== undefined ? String(category).trim() : cur.category,
    frequency !== undefined ? (frequency === 'weekly' ? 'weekly' : 'daily') : cur.frequency,
    archived !== undefined ? (archived ? 1 : 0) : cur.archived,
    sort_order !== undefined ? Number(sort_order) : cur.sort_order,
    id
  );
  res.json(db.prepare('SELECT * FROM sites WHERE id = ?').get(id));
});

// 与相邻网站交换顺序（dir = 'up' | 'down'）
r.post('/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const dir = (req.body && req.body.dir) === 'up' ? 'up' : 'down';
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
  db.prepare('DELETE FROM sites WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default r;
