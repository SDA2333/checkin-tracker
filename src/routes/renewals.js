// 续期项 CRUD + 到期计算 + 一键续期
import { Router } from 'express';
import db from '../db.js';
import { addDays, daysBetween, isoToday, isValidDate } from '../dates.js';

const r = Router();
const POLICIES = new Set(['extend_from_due', 'reset_from_payment', 'manual_effective_date']);
const MAX_NAME = 200;
const MAX_URL = 2048;
const MAX_CATEGORY = 100;
const MAX_NOTE = 2000;

function textTooLong(value, max) {
  return value !== undefined && String(value).length > max;
}

function periodStart(row) {
  return row.current_period_start || row.last_renewed;
}

function periodEnd(row) {
  return row.current_period_end || addDays(row.last_renewed, row.cycle_days);
}

function normalizePolicy(policy, fallback = 'extend_from_due') {
  return POLICIES.has(policy) ? policy : fallback;
}

// 附加计算字段：下次到期日、剩余天数、状态
function decorate(row, today) {
  const nextDue = periodEnd(row);
  const daysLeft = daysBetween(today, nextDue);
  let status = 'ok';
  if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= row.remind_before_days) status = 'soon';
  return {
    ...row,
    current_period_start: periodStart(row),
    current_period_end: nextDue,
    renewal_policy: normalizePolicy(row.renewal_policy),
    next_due: nextDue,
    days_left: daysLeft,
    status,
  };
}

// 列表，按剩余天数升序（最紧急在前）
r.get('/', (req, res) => {
  const today = isValidDate(req.query.today) ? String(req.query.today) : isoToday();
  const where = req.query.archived === '1' ? '' : 'WHERE archived = 0';
  const rows = db.prepare(`SELECT * FROM renewals ${where}`).all();
  res.json(rows.map((x) => decorate(x, today)).sort((a, b) => a.days_left - b.days_left));
});

// 新增
r.post('/', (req, res) => {
  const {
    name,
    url = '',
    cycle_days,
    last_renewed,
    current_period_start,
    current_period_end,
    renewal_policy = 'extend_from_due',
    remind_before_days = 3,
    note = '',
    category = '',
  } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '名称不能为空' });
  if (textTooLong(name, MAX_NAME) || textTooLong(url, MAX_URL) || textTooLong(category, MAX_CATEGORY) || textTooLong(note, MAX_NOTE))
    return res.status(400).json({ error: '文本字段过长' });
  const cycle = Number(cycle_days);
  if (!Number.isSafeInteger(cycle) || cycle <= 0)
    return res.status(400).json({ error: '周期天数需为正整数' });
  const start = String(current_period_start || last_renewed || '');
  if (!isValidDate(start)) return res.status(400).json({ error: '需要当前周期开始日期（YYYY-MM-DD）' });
  const end = String(current_period_end || addDays(start, cycle));
  if (!isValidDate(end) || end < start) return res.status(400).json({ error: '当前到期日期无效' });
  const remindDays = Number(remind_before_days);
  if (!Number.isSafeInteger(remindDays) || remindDays < 0)
    return res.status(400).json({ error: '提醒天数需为非负整数' });
  if (!POLICIES.has(String(renewal_policy))) return res.status(400).json({ error: '续期策略不支持' });
  const policy = String(renewal_policy);
  const createRenewal = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO renewals
       (name, url, cycle_days, last_renewed, current_period_start, current_period_end, renewal_policy, remind_before_days, note, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(name).trim(),
      String(url).trim(),
      cycle,
      start,
      start,
      end,
      policy,
      remindDays,
      String(note),
      String(category).trim()
    );
    db.prepare(
      `INSERT INTO renewal_history
       (renewal_id, renewed_on, paid_on, effective_on, new_period_start, new_period_end, policy_used, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(info.lastInsertRowid, start, start, start, start, end, 'initial', 'initial period');
    return db.prepare('SELECT * FROM renewals WHERE id = ?').get(info.lastInsertRowid);
  });
  res.json(decorate(createRenewal(), start));
});

// 修改
r.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const cur = db.prepare('SELECT * FROM renewals WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  const {
    name,
    url,
    cycle_days,
    last_renewed,
    current_period_start,
    current_period_end,
    renewal_policy,
    remind_before_days,
    note,
    category,
    archived,
  } = req.body || {};
  if (name !== undefined && !String(name).trim())
    return res.status(400).json({ error: '名称不能为空' });
  if (textTooLong(name, MAX_NAME) || textTooLong(url, MAX_URL) || textTooLong(category, MAX_CATEGORY) || textTooLong(note, MAX_NOTE))
    return res.status(400).json({ error: '文本字段过长' });
  if (cycle_days !== undefined) {
    const cycle = Number(cycle_days);
    if (!Number.isSafeInteger(cycle) || cycle <= 0)
      return res.status(400).json({ error: '周期天数需为正整数' });
  }
  if (last_renewed !== undefined && !isValidDate(last_renewed))
    return res.status(400).json({ error: '上次续期日期格式错误' });
  if (current_period_start !== undefined && !isValidDate(current_period_start))
    return res.status(400).json({ error: '当前周期开始日期格式错误' });
  if (current_period_end !== undefined && !isValidDate(current_period_end))
    return res.status(400).json({ error: '当前到期日期格式错误' });
  if (renewal_policy !== undefined && !POLICIES.has(String(renewal_policy)))
    return res.status(400).json({ error: '续期策略不支持' });
  if (remind_before_days !== undefined) {
    const remind = Number(remind_before_days);
    if (!Number.isSafeInteger(remind) || remind < 0)
      return res.status(400).json({ error: '提醒天数需为非负整数' });
  }
  if (archived !== undefined && typeof archived !== 'boolean' && archived !== 0 && archived !== 1)
    return res.status(400).json({ error: 'archived 必须是布尔值' });
  const nextStart =
    current_period_start !== undefined
      ? String(current_period_start)
      : last_renewed !== undefined
        ? String(last_renewed)
        : periodStart(cur);
  const nextEnd =
    current_period_end !== undefined
      ? String(current_period_end)
      : cycle_days !== undefined || current_period_start !== undefined || last_renewed !== undefined
        ? addDays(nextStart, cycle_days !== undefined ? Number(cycle_days) : cur.cycle_days)
        : periodEnd(cur);
  if (nextEnd < nextStart) return res.status(400).json({ error: '当前到期日不能早于周期开始日' });
  db.prepare(
    `UPDATE renewals
     SET name=?, url=?, cycle_days=?, last_renewed=?, current_period_start=?, current_period_end=?, renewal_policy=?,
         remind_before_days=?, note=?, category=?, archived=?
     WHERE id=?`
  ).run(
    name !== undefined ? String(name).trim() : cur.name,
    url !== undefined ? String(url).trim() : cur.url,
    cycle_days !== undefined ? Number(cycle_days) : cur.cycle_days,
    nextStart,
    nextStart,
    nextEnd,
    renewal_policy !== undefined ? String(renewal_policy) : normalizePolicy(cur.renewal_policy),
    remind_before_days !== undefined ? Number(remind_before_days) : cur.remind_before_days,
    note !== undefined ? String(note) : cur.note,
    category !== undefined ? String(category).trim() : (cur.category || ''),
    archived !== undefined ? (archived ? 1 : 0) : cur.archived,
    id
  );
  res.json(decorate(db.prepare('SELECT * FROM renewals WHERE id = ?').get(id), isoToday()));
});

// 一键续期：记录实际付款日，并按策略推进服务周期
r.post('/:id/renew', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const cur = db.prepare('SELECT * FROM renewals WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  const body = req.body || {};
  const paidDate = String(body.paid_on || body.date || '');
  if ((body.paid_on !== undefined || body.date !== undefined) && !isValidDate(paidDate))
    return res.status(400).json({ error: '付款日期格式错误' });
  const paidOn = isValidDate(paidDate) ? paidDate : isoToday();
  if (body.policy !== undefined && !POLICIES.has(String(body.policy)))
    return res.status(400).json({ error: '续期策略不支持' });
  const policy = normalizePolicy(String(body.policy || cur.renewal_policy), normalizePolicy(cur.renewal_policy));
  const previousStart = periodStart(cur);
  const previousEnd = periodEnd(cur);
  let effectiveOn;

  if (policy === 'manual_effective_date') {
    const manualDate = String(body.effective_on || '');
    if (!isValidDate(manualDate)) return res.status(400).json({ error: '请选择生效日期（YYYY-MM-DD）' });
    effectiveOn = manualDate;
  } else if (policy === 'reset_from_payment') {
    effectiveOn = paidOn;
  } else {
    effectiveOn = daysBetween(paidOn, previousEnd) >= 0 ? previousEnd : paidOn;
  }

  const newEnd = addDays(effectiveOn, cur.cycle_days);
  const historyNote =
    policy === 'extend_from_due' && effectiveOn === previousEnd
      ? '按原到期日顺延'
      : policy === 'reset_from_payment'
        ? '按付款日重算'
        : policy === 'manual_effective_date'
          ? '手动选择生效日'
          : '';

  const applyRenewal = db.transaction(() => {
    db.prepare(
      `UPDATE renewals
       SET last_renewed = ?, current_period_start = ?, current_period_end = ?, renewal_policy = ?
       WHERE id = ?`
    ).run(effectiveOn, effectiveOn, newEnd, policy, id);
    db.prepare(
      `INSERT INTO renewal_history
       (renewal_id, renewed_on, paid_on, effective_on, previous_period_start, previous_period_end,
        new_period_start, new_period_end, policy_used, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, paidOn, paidOn, effectiveOn, previousStart, previousEnd, effectiveOn, newEnd, policy, historyNote);
    return db.prepare('SELECT * FROM renewals WHERE id = ?').get(id);
  });
  res.json(decorate(applyRenewal(), paidOn));
});

// 续期历史
r.get('/:id/history', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const renewal = db.prepare('SELECT id FROM renewals WHERE id = ?').get(id);
  if (!renewal) return res.status(404).json({ error: '不存在' });
  res.json(
    db
      .prepare(
        `SELECT * FROM renewal_history
         WHERE renewal_id = ?
         ORDER BY COALESCE(NULLIF(paid_on, ''), renewed_on) DESC, id DESC`
      )
      .all(id)
  );
});

// 删除
r.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const result = db.prepare('DELETE FROM renewals WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: '不存在' });
  res.json({ ok: true });
});

export default r;
