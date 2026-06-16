// 续期项 CRUD + 到期计算 + 一键续期
import { Router } from 'express';
import db from '../db.js';
import { addDays, daysBetween, isoToday, DATE_RE } from '../dates.js';

const r = Router();

// 附加计算字段：下次到期日、剩余天数、状态
function decorate(row, today) {
  const nextDue = addDays(row.last_renewed, row.cycle_days);
  const daysLeft = daysBetween(today, nextDue);
  let status = 'ok';
  if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= row.remind_before_days) status = 'soon';
  return { ...row, next_due: nextDue, days_left: daysLeft, status };
}

// 列表，按剩余天数升序（最紧急在前）
r.get('/', (req, res) => {
  const today = DATE_RE.test(String(req.query.today)) ? String(req.query.today) : isoToday();
  const where = req.query.archived === '1' ? '' : 'WHERE archived = 0';
  const rows = db.prepare(`SELECT * FROM renewals ${where}`).all();
  res.json(rows.map((x) => decorate(x, today)).sort((a, b) => a.days_left - b.days_left));
});

// 新增
r.post('/', (req, res) => {
  const { name, url = '', cycle_days, last_renewed, remind_before_days = 3, note = '' } =
    req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '名称不能为空' });
  const cycle = Number(cycle_days);
  if (!Number.isFinite(cycle) || cycle <= 0)
    return res.status(400).json({ error: '周期天数需为正整数' });
  if (!DATE_RE.test(String(last_renewed)))
    return res.status(400).json({ error: '需要上次续期日期（YYYY-MM-DD）' });
  const info = db
    .prepare(
      `INSERT INTO renewals (name, url, cycle_days, last_renewed, remind_before_days, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(url).trim(),
      cycle,
      String(last_renewed),
      Number(remind_before_days) || 0,
      String(note)
    );
  db.prepare('INSERT INTO renewal_history (renewal_id, renewed_on) VALUES (?, ?)').run(
    info.lastInsertRowid,
    String(last_renewed)
  );
  res.json(db.prepare('SELECT * FROM renewals WHERE id = ?').get(info.lastInsertRowid));
});

// 修改
r.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM renewals WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  const { name, url, cycle_days, last_renewed, remind_before_days, note, archived } = req.body || {};
  if (cycle_days !== undefined) {
    const cycle = Number(cycle_days);
    if (!Number.isFinite(cycle) || cycle <= 0)
      return res.status(400).json({ error: '周期天数需为正整数' });
  }
  if (last_renewed !== undefined && !DATE_RE.test(String(last_renewed)))
    return res.status(400).json({ error: '上次续期日期格式错误' });
  db.prepare(
    `UPDATE renewals SET name=?, url=?, cycle_days=?, last_renewed=?, remind_before_days=?, note=?, archived=? WHERE id=?`
  ).run(
    name !== undefined ? String(name).trim() : cur.name,
    url !== undefined ? String(url).trim() : cur.url,
    cycle_days !== undefined ? Number(cycle_days) : cur.cycle_days,
    last_renewed !== undefined ? String(last_renewed) : cur.last_renewed,
    remind_before_days !== undefined ? Number(remind_before_days) || 0 : cur.remind_before_days,
    note !== undefined ? String(note) : cur.note,
    archived !== undefined ? (archived ? 1 : 0) : cur.archived,
    id
  );
  res.json(db.prepare('SELECT * FROM renewals WHERE id = ?').get(id));
});

// 一键续期：把上次续期日期更新为指定日期（默认今天），并记一条历史
r.post('/:id/renew', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM renewals WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  const date = String((req.body && req.body.date) || '').slice(0, 10);
  const day = DATE_RE.test(date) ? date : isoToday();
  db.prepare('UPDATE renewals SET last_renewed = ? WHERE id = ?').run(day, id);
  db.prepare('INSERT INTO renewal_history (renewal_id, renewed_on) VALUES (?, ?)').run(id, day);
  res.json(db.prepare('SELECT * FROM renewals WHERE id = ?').get(id));
});

// 续期历史
r.get('/:id/history', (req, res) => {
  const id = Number(req.params.id);
  res.json(
    db
      .prepare('SELECT * FROM renewal_history WHERE renewal_id = ? ORDER BY renewed_on DESC, id DESC')
      .all(id)
  );
});

// 删除
r.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM renewals WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default r;
