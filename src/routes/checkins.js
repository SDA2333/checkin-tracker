// 打卡：今日清单（含连续天数）、勾选/取消、日历汇总
import { Router } from 'express';
import db from '../db.js';
import { addDays, daysBetween, isoToday, isValidDate } from '../dates.js';

const r = Router();

const activeOnDateSql = `EXISTS (
  SELECT 1 FROM site_activity_periods p
  WHERE p.site_id = sites.id
    AND p.active_from <= ?
    AND (p.active_until = '' OR ? < p.active_until)
)`;

function siteWasActiveOn(siteId, date) {
  return !!db.prepare(
    `SELECT 1 FROM site_activity_periods
     WHERE site_id = ? AND active_from <= ? AND (active_until = '' OR ? < active_until)
     LIMIT 1`
  ).get(siteId, date, date);
}

// 今日（或指定日期）清单：按当天启用状态返回网站；已有签到始终作为历史事实展示。
r.get('/today', (req, res) => {
  const date = String(req.query.date || '');
  if (!isValidDate(date)) return res.status(400).json({ error: '需要有效的 date=YYYY-MM-DD' });

  const sites = db
    .prepare(
      `SELECT * FROM sites
       WHERE active_from <= ?
         AND (${activeOnDateSql} OR EXISTS (
           SELECT 1 FROM checkins c WHERE c.site_id = sites.id AND c.date = ?
         ))
       ORDER BY sort_order, id`
    )
    .all(date, date, date, date);
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
  const site = db.prepare('SELECT id, active_from FROM sites WHERE id = ?').get(siteId);
  if (!site) return res.status(404).json({ error: '网站不存在' });
  if (String(date) < site.active_from) return res.status(409).json({ error: '不能在网站启用日期之前签到' });
  if (!siteWasActiveOn(siteId, String(date))) return res.status(409).json({ error: '该网站在此日期未启用' });
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

// 日历汇总：打卡记录不因归档消失；每日总数按当日的网站启用区间计算。
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
       JOIN sites s ON s.id = c.site_id AND s.active_from <= c.date
       WHERE c.date BETWEEN ? AND ?
       GROUP BY c.date`
    )
    .all(from, to);
  const days = {};
  for (const row of rows) days[row.date] = row.c;
  const activeTotal = db.prepare('SELECT COUNT(*) AS c FROM sites WHERE archived = 0').get().c;
  const periods = db
    .prepare(
      `SELECT active_from, active_until
       FROM site_activity_periods
       WHERE active_from <= ? AND (active_until = '' OR active_until > ?)`
    )
    .all(to, from);
  const events = new Map();
  for (const period of periods) {
    const start = period.active_from < from ? from : period.active_from;
    events.set(start, (events.get(start) || 0) + 1);
    if (period.active_until && period.active_until <= to) {
      events.set(period.active_until, (events.get(period.active_until) || 0) - 1);
    }
  }

  // 兼容“当天签到后再归档”：区间从当天关闭，但已经发生的签到仍计入当天分子与分母。
  const exceptions = new Map(
    db.prepare(
      `SELECT c.date, COUNT(*) AS c
       FROM checkins c
       JOIN sites s ON s.id = c.site_id AND s.active_from <= c.date
       WHERE c.date BETWEEN ? AND ?
         AND NOT EXISTS (
           SELECT 1 FROM site_activity_periods p
           WHERE p.site_id = c.site_id
             AND p.active_from <= c.date
             AND (p.active_until = '' OR c.date < p.active_until)
         )
       GROUP BY c.date`
    ).all(from, to).map((row) => [row.date, row.c])
  );
  const totals = {};
  let runningTotal = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    runningTotal += events.get(date) || 0;
    totals[date] = runningTotal + (exceptions.get(date) || 0);
  }
  res.json({ from, to, activeTotal, totals, days });
});

export default r;
