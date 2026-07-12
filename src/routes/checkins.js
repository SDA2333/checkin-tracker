// 打卡：今日清单（含连续天数）、勾选/取消、日历汇总
import { Router } from 'express';
import db from '../db.js';
import { addDays, daysBetween, isoToday, isValidDate } from '../dates.js';

const r = Router();

// 今日（或指定日期）清单：返回所有在用网站 + 当天是否已签 + 连续天数
r.get('/today', (req, res) => {
  const date = String(req.query.date || '');
  if (!isValidDate(date)) return res.status(400).json({ error: '需要有效的 date=YYYY-MM-DD' });

  const sites = db
    .prepare(`SELECT * FROM sites WHERE archived = 0 AND active_from <= ? ORDER BY sort_order, id`)
    .all(date);
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
  const siteId = Number(site_id);
  if (!Number.isSafeInteger(siteId) || siteId <= 0 || !isValidDate(date))
    return res.status(400).json({ error: '需要 site_id 与 date' });
  if (String(date) > isoToday()) return res.status(400).json({ error: '不能给未来日期签到' });
  const site = db.prepare('SELECT id, archived, active_from FROM sites WHERE id = ?').get(siteId);
  if (!site) return res.status(404).json({ error: '网站不存在' });
  if (site.archived) return res.status(409).json({ error: '已归档网站不能签到' });
  if (String(date) < site.active_from) return res.status(409).json({ error: '不能在网站启用日期之前签到' });
  db.prepare('INSERT OR IGNORE INTO checkins (site_id, date) VALUES (?, ?)').run(
    siteId,
    String(date)
  );
  res.json({ ok: true });
});

// 取消勾选
r.delete('/', (req, res) => {
  const src = { ...req.query, ...(req.body || {}) };
  const { site_id, date } = src;
  const siteId = Number(site_id);
  if (!Number.isSafeInteger(siteId) || siteId <= 0 || !isValidDate(date))
    return res.status(400).json({ error: '需要 site_id 与有效日期' });
  db.prepare('DELETE FROM checkins WHERE site_id = ? AND date = ?').run(
    siteId,
    String(date)
  );
  res.json({ ok: true });
});

// 日历汇总：返回区间内每天的打卡数量，以及当前在用网站总数
r.get('/calendar', (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!isValidDate(from) || !isValidDate(to) || from > to)
    return res.status(400).json({ error: '需要 from 与 to（YYYY-MM-DD）' });
  if (daysBetween(from, to) > 366) return res.status(400).json({ error: '日历查询范围不能超过 366 天' });
  const rows = db
    .prepare(
      `SELECT c.date, COUNT(*) AS c
       FROM checkins c
       JOIN sites s ON s.id = c.site_id AND s.archived = 0 AND s.active_from <= c.date
       WHERE c.date BETWEEN ? AND ?
       GROUP BY c.date`
    )
    .all(from, to);
  const days = {};
  for (const row of rows) days[row.date] = row.c;
  const activeTotal = db.prepare('SELECT COUNT(*) AS c FROM sites WHERE archived = 0').get().c;
  const starts = db
    .prepare(
      `SELECT active_from, COUNT(*) AS c
       FROM sites
       WHERE archived = 0 AND active_from <= ?
       GROUP BY active_from
       ORDER BY active_from`
    )
    .all(to);
  const increments = new Map(starts.map((row) => [row.active_from, row.c]));
  const beforeRange = starts
    .filter((row) => row.active_from < from)
    .reduce((sum, row) => sum + row.c, 0);
  const totals = {};
  let runningTotal = beforeRange;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    runningTotal += increments.get(date) || 0;
    totals[date] = runningTotal;
  }
  res.json({ from, to, activeTotal, totals, days });
});

export default r;
