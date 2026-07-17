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

// 列表按用户设置的稳定顺序返回；紧迫度通过状态字段单独表达。
r.get('/', (req, res) => {
  const today = isValidDate(req.query.today) ? String(req.query.today) : isoToday();
  const where = req.query.archived === '1' ? '' : 'WHERE archived = 0';
  const rows = db.prepare(`SELECT * FROM renewals ${where} ORDER BY sort_order, id`).all();
  res.json(rows.map((x) => decorate(x, today)));
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
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM renewals').get().m;
  const createRenewal = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO renewals
       (name, url, cycle_days, last_renewed, current_period_start, current_period_end, renewal_policy,
        remind_before_days, note, category, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      String(category).trim(),
      maxOrder + 1
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
  const nextCategory = category !== undefined ? String(category).trim() : (cur.category || '');
  const nextSortOrder = nextCategory !== (cur.category || '')
    ? db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM renewals').get().m + 1
    : cur.sort_order;
  db.prepare(
    `UPDATE renewals
     SET name=?, url=?, cycle_days=?, last_renewed=?, current_period_start=?, current_period_end=?, renewal_policy=?,
         remind_before_days=?, note=?, category=?, sort_order=?, archived=?
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
    nextCategory,
    nextSortOrder,
    archived !== undefined ? (archived ? 1 : 0) : cur.archived,
    id
  );
  res.json(decorate(db.prepare('SELECT * FROM renewals WHERE id = ?').get(id), isoToday()));
});

// 与同一分类中的相邻续期项目交换顺序（dir = 'up' | 'down'）。
r.post('/:id/move', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const dir = req.body?.dir;
  if (dir !== 'up' && dir !== 'down') return res.status(400).json({ error: 'dir 必须为 up 或 down' });
  const cur = db.prepare('SELECT * FROM renewals WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  if (cur.archived) return res.status(409).json({ error: '已归档项目不能调整顺序' });

  const neighbor = db
    .prepare(
      dir === 'up'
        ? `SELECT * FROM renewals
           WHERE archived = 0 AND category = ? AND (sort_order, id) < (?, ?)
           ORDER BY sort_order DESC, id DESC LIMIT 1`
        : `SELECT * FROM renewals
           WHERE archived = 0 AND category = ? AND (sort_order, id) > (?, ?)
           ORDER BY sort_order ASC, id ASC LIMIT 1`
    )
    .get(cur.category || '', cur.sort_order, id);

  if (!neighbor) return res.json({ ok: true, moved: false });
  const swap = db.transaction(() => {
    db.prepare('UPDATE renewals SET sort_order = ? WHERE id = ?').run(neighbor.sort_order, cur.id);
    db.prepare('UPDATE renewals SET sort_order = ? WHERE id = ?').run(cur.sort_order, neighbor.id);
  });
  swap();
  res.json({ ok: true, moved: true });
});

// 一键续期：记录实际付款日，并按策略推进服务周期
r.post('/:id/renew', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID 无效' });
  const body = req.body || {};
  const paidDate = String(body.paid_on || body.date || '');
  if ((body.paid_on !== undefined || body.date !== undefined) && !isValidDate(paidDate))
    return res.status(400).json({ error: '付款日期格式错误' });
  const paidOn = isValidDate(paidDate) ? paidDate : isoToday();
  if (body.policy !== undefined && !POLICIES.has(String(body.policy)))
    return res.status(400).json({ error: '续期策略不支持' });
  const expectedPeriodEnd = String(body.expected_period_end || '');
  if (!isValidDate(expectedPeriodEnd))
    return res.status(400).json({ error: '续期状态已过期，请刷新后重试' });
  if (body.policy === 'manual_effective_date' && !isValidDate(String(body.effective_on || '')))
    return res.status(400).json({ error: '请选择生效日期（YYYY-MM-DD）' });

  const applyRenewal = db.transaction(() => {
    const current = db.prepare('SELECT * FROM renewals WHERE id = ?').get(id);
    if (!current) return { missing: true };
    const previousStart = periodStart(current);
    const previousEnd = periodEnd(current);
    if (previousEnd !== expectedPeriodEnd) return { conflict: true };

    const policy = normalizePolicy(String(body.policy || current.renewal_policy), normalizePolicy(current.renewal_policy));
    if (policy === 'manual_effective_date' && !isValidDate(String(body.effective_on || '')))
      return { invalidEffectiveDate: true };
    const effectiveOn = policy === 'manual_effective_date'
      ? String(body.effective_on)
      : policy === 'reset_from_payment'
        ? paidOn
        : daysBetween(paidOn, previousEnd) >= 0 ? previousEnd : paidOn;
    const newEnd = addDays(effectiveOn, current.cycle_days);
    const historyNote =
      policy === 'extend_from_due' && effectiveOn === previousEnd
        ? '按原到期日顺延'
        : policy === 'reset_from_payment'
          ? '按付款日重算'
          : policy === 'manual_effective_date'
            ? '手动选择生效日'
            : '';

    const updated = db.prepare(
      `UPDATE renewals
       SET last_renewed = ?, current_period_start = ?, current_period_end = ?, renewal_policy = ?
       WHERE id = ? AND current_period_end = ?`
    ).run(effectiveOn, effectiveOn, newEnd, policy, id, expectedPeriodEnd);
    if (updated.changes !== 1) return { conflict: true };
    db.prepare(
      `INSERT INTO renewal_history
       (renewal_id, renewed_on, paid_on, effective_on, previous_period_start, previous_period_end,
        new_period_start, new_period_end, policy_used, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, paidOn, paidOn, effectiveOn, previousStart, previousEnd, effectiveOn, newEnd, policy, historyNote);
    return { row: db.prepare('SELECT * FROM renewals WHERE id = ?').get(id) };
  });
  const result = applyRenewal();
  if (result.missing) return res.status(404).json({ error: '不存在' });
  if (result.conflict) return res.status(409).json({ error: '续期状态已变化，请刷新后重试' });
  if (result.invalidEffectiveDate) return res.status(400).json({ error: '请选择生效日期（YYYY-MM-DD）' });
  res.json(decorate(result.row, paidOn));
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
