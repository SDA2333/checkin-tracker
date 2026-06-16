// 打卡：今日清单（含连续天数）、勾选/取消、日历汇总
import { Router } from 'express';
import db from '../db.js';
import { addDays, DATE_RE } from '../dates.js';

const r = Router();

// 今日（或指定日期）清单：返回所有在用网站 + 当天是否已签 + 连续天数
r.get('/today', (req, res) => {
  const date = String(req.query.date || '').slice(0, 10);
  if (!DATE_RE.test(date)) return res.status(400).json({ error: '需要 date=YYYY-MM-DD' });

  const sites = db.prepare(`SELECT * FROM sites WHERE archived = 0 ORDER BY sort_order, id`).all();
  const checked = new Set(
    db.prepare('SELECT site_id FROM checkins WHERE date = ?').all(date).map((x) => x.site_id)
  );

  // 取截止当天的所有打卡日期，按网站分组算连续天数
  const rows = db
    .prepare('SELECT site_id, date FROM checkins WHERE date <= ? ORDER BY site_id')
    .all(date);
  const datesBySite = new Map();
  for (const row of rows) {
    if (!datesBySite.has(row.site_id)) datesBySite.set(row.site_id, new Set());
    datesBySite.get(row.site_id).add(row.date);
  }
  const streakOf = (siteId) => {
    const set = datesBySite.get(siteId);
    if (!set) return 0;
    let streak = 0;
    let cursor = date;
    while (set.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  };

  const list = sites.map((s) => ({
    ...s,
    done: checked.has(s.id),
    streak: s.frequency === 'daily' ? streakOf(s.id) : null,
  }));
  res.json({ date, sites: list, doneCount: list.filter((s) => s.done).length, total: list.length });
});

// 勾选完成
r.post('/', (req, res) => {
  const { site_id, date } = req.body || {};
  if (!site_id || !DATE_RE.test(String(date)))
    return res.status(400).json({ error: '需要 site_id 与 date' });
  db.prepare('INSERT OR IGNORE INTO checkins (site_id, date) VALUES (?, ?)').run(
    Number(site_id),
    String(date)
  );
  res.json({ ok: true });
});

// 取消勾选
r.delete('/', (req, res) => {
  const src = { ...req.query, ...(req.body || {}) };
  const { site_id, date } = src;
  if (!site_id || !date) return res.status(400).json({ error: '需要 site_id 与 date' });
  db.prepare('DELETE FROM checkins WHERE site_id = ? AND date = ?').run(
    Number(site_id),
    String(date)
  );
  res.json({ ok: true });
});

// 日历汇总：返回区间内每天的打卡数量，以及当前在用网站总数
r.get('/calendar', (req, res) => {
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return res.status(400).json({ error: '需要 from 与 to（YYYY-MM-DD）' });
  const rows = db
    .prepare('SELECT date, COUNT(*) AS c FROM checkins WHERE date BETWEEN ? AND ? GROUP BY date')
    .all(from, to);
  const days = {};
  for (const row of rows) days[row.date] = row.c;
  const activeTotal = db.prepare('SELECT COUNT(*) AS c FROM sites WHERE archived = 0').get().c;
  res.json({ from, to, activeTotal, days });
});

export default r;
