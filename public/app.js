'use strict';

/* ---------- 工具 ---------- */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localToday() { return ymd(new Date()); }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function monthStart(s) { const d = parseYmd(s); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function addMonths(s, n) { const d = parseYmd(s); d.setMonth(d.getMonth() + n); return ymd(d); }
function addDaysLocal(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hrefOf(u) {
  if (!u) return null;
  try {
    const value = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
function policyLabel(policy) {
  return ({
    extend_from_due: '按原到期日顺延',
    reset_from_payment: '按付款日重算',
    manual_effective_date: '手动选择生效日',
  })[policy] || '按原到期日顺延';
}
function renewButtonText(policy) {
  return ({
    extend_from_due: '✓ 已缴费，顺延',
    reset_from_payment: '✓ 已缴费，重算',
    manual_effective_date: '✓ 已缴费，选日期',
  })[policy] || '✓ 已缴费，顺延';
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('未登录'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
  return data;
}

let toastTimer;
/**
 * 显示 toast。
 * @param {string} msg 文本
 * @param {'info'|'success'|'error'} [type] 类型（决定颜色/图标）
 * @param {{label:string,onClick:Function,duration?:number}} [action] 可选的行动按钮（如「撤销」）
 */
function toast(msg, type = 'info', action = null) {
  const t = document.getElementById('toast');
  t.className = 'toast'; // 重置
  t.textContent = '';
  const span = document.createElement('span');
  span.className = 'toast-msg';
  span.textContent = msg;
  t.appendChild(span);

  if (action && action.label && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      t.classList.remove('show');
      action.onClick();
    });
    t.appendChild(btn);
  }

  // 触发重排以重放动画
  void t.offsetWidth;
  t.classList.add('show', type);
  clearTimeout(toastTimer);
  const dur = (action && action.duration) || 1900;
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}
const toastOk = (m, a) => toast(m, 'success', a);
const toastErr = (m) => toast(m, 'error');

/* ---------- 应用内 Modal（替换原生 confirm/prompt）---------- */
let activeModalCleanup = null;
function closeModal() {
  const root = document.getElementById('modal-root');
  const overlay = root.querySelector('.modal-overlay');
  if (!overlay) return;
  overlay.classList.add('closing');
  if (activeModalCleanup) { activeModalCleanup(); activeModalCleanup = null; }
  setTimeout(() => { if (overlay.isConnected) overlay.remove(); }, 160);
}

/**
 * 通用 modal。返回 Promise，resolve 为 true/false 或输入值。
 * @param {object} opts
 * @param {string} opts.title 标题
 * @param {string} [opts.message] 说明文本
 * @param {string} [opts.confirmText] 确认按钮文字
 * @param {string} [opts.cancelText] 取消按钮文字
 * @param {boolean} [opts.danger] 确认按钮是否红色
 * @param {'date'|'text'} [opts.input] 需要输入时的类型
 * @param {string} [opts.inputValue] 输入初始值
 * @param {string} [opts.inputLabel] 输入标签
 */
function openModal(opts) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (activeModalCleanup) { activeModalCleanup(); activeModalCleanup = null; }
    const prevFocus = document.activeElement;
    const needInput = !!opts.input;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(opts.title || '')}">
        <h3>${esc(opts.title || '')}</h3>
        ${opts.message ? `<p>${esc(opts.message)}</p>` : ''}
        ${needInput ? `<div class="field">
          ${opts.inputLabel ? `<label>${esc(opts.inputLabel)}</label>` : ''}
          <input id="modal-input" type="${opts.input}" value="${esc(opts.inputValue || '')}">
        </div>` : ''}
        <div class="modal-actions">
          <button class="btn ghost" data-modal="cancel">${esc(opts.cancelText || '取消')}</button>
          <button class="btn ${opts.danger ? 'danger' : ''}" data-modal="ok">${esc(opts.confirmText || '确定')}</button>
        </div>
      </div>`;
    root.innerHTML = '';
    root.appendChild(overlay);

    const input = overlay.querySelector('#modal-input');
    const okBtn = overlay.querySelector('[data-modal="ok"]');

    const done = (val) => { closeModal(); if (prevFocus && prevFocus.focus) prevFocus.focus(); resolve(val); };
    const onOk = () => {
      if (needInput) {
        const v = input.value.trim();
        done(v || null);
      } else done(true);
    };
    const onCancel = () => done(needInput ? null : false);

    overlay.querySelector('[data-modal="ok"]').addEventListener('click', onOk);
    overlay.querySelector('[data-modal="cancel"]').addEventListener('click', onCancel);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) onCancel(); });

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter' && (needInput || document.activeElement === okBtn || document.activeElement.tagName !== 'BUTTON')) {
        e.preventDefault(); onOk();
      } else if (e.key === 'Tab') {
        // 焦点陷阱
        const f = overlay.querySelectorAll('button, input, [tabindex]');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    activeModalCleanup = () => document.removeEventListener('keydown', onKey);

    // 初始焦点
    setTimeout(() => { (input || okBtn).focus(); if (input) input.select && input.select(); }, 40);
  });
}
const confirmModal = (title, message, opts = {}) =>
  openModal({ title, message, danger: opts.danger, confirmText: opts.confirmText || '确定', cancelText: '取消' });
const promptDateModal = (title, value) =>
  openModal({ title, input: 'date', inputValue: value, inputLabel: '生效日期', confirmText: '确定' });

/* ---------- 状态 ---------- */
const state = {
  date: localToday(),
  calMonth: monthStart(localToday()),
  sites: [], renewals: [],
  editSite: null, editRenew: null,
  showSiteForm: false, showRenewForm: false,
};

/* ---------- 今日签到 ---------- */
async function loadToday() {
  const view = document.getElementById('view-today');
  const data = await api(`/api/checkins/today?date=${state.date}`);
  const pct = data.total ? Math.round((data.doneCount / data.total) * 100) : 0;
  const isToday = state.date === localToday();

  let items;
  if (!data.sites.length) {
    items = `<div class="empty">还没有签到网站。<br>去「管理」里添加你每天要签到的网站吧。</div>`;
  } else {
    // 按 category 分组
    const groups = {};
    data.sites.forEach((s) => {
      const cat = s.category || '其他';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    });

    items = Object.keys(groups).map((cat) => {
      const sites = groups[cat];
      const groupItems = sites.map((s) => {
        const href = hrefOf(s.url);
        return `<div class="checkitem ${s.done ? 'done' : ''}" data-id="${s.id}" data-done="${s.done ? 1 : 0}" role="button" tabindex="0" aria-pressed="${s.done ? 'true' : 'false'}" aria-label="${esc(s.name)}${s.done ? '，已签到' : '，未签到'}">
          <div class="checkbox" aria-hidden="true"><span class="tick">${s.done ? '✓' : ''}</span></div>
          <div class="info">
            <div class="name">${esc(s.name)}</div>
            <div class="sub">
              ${s.category ? `<span class="tag">${esc(s.category)}</span>` : ''}
              ${s.frequency === 'weekly' ? '<span>每周</span>' : ''}
              ${s.streak ? `<span class="streak">🔥 连续 ${s.streak} 天</span>` : ''}
            </div>
          </div>
          ${href ? `<a class="go" href="${esc(href)}" target="_blank" rel="noopener" data-action="go" data-id="${s.id}">去签到 ↗</a>` : ''}
        </div>`;
      }).join('');

      return `<div class="group" data-category="${esc(cat)}">
        <div class="group-header" role="button" tabindex="0" aria-expanded="true">
          <span class="group-arrow" aria-hidden="true">▼</span>
          <span class="group-title">${esc(cat)}</span>
          <span class="group-count">(${sites.length})</span>
        </div>
        <div class="group-items"><div class="group-inner">${groupItems}</div></div>
      </div>`;
    }).join('');
  }

  view.innerHTML = `
    <div class="today-head">
      <input type="date" id="datePick" value="${state.date}" max="${localToday()}" />
      ${isToday ? '' : `<button class="btn ghost sm" data-action="backToday">回到今天</button>`}
      <div class="progress">
        <div class="row spread"><span class="muted">${isToday ? '今日进度' : esc(state.date)}</span><b>${data.doneCount}/${data.total}</b></div>
        <div class="bar"><i style="width:0%"></i></div>
      </div>
    </div>
    <div class="stagger">${items}</div>`;

  // 进度条：下一帧再设宽度，让它从 0 缓动到目标值
  requestAnimationFrame(() => {
    const bar = view.querySelector('.progress .bar > i');
    if (bar) bar.style.width = pct + '%';
  });
}

/* ---------- 日历 ---------- */
function buildMonthCells(firstStr) {
  const first = parseYmd(firstStr);
  const year = first.getFullYear(), month = first.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let lead = (first.getDay() + 6) % 7; // 周一为一周起始
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return cells;
}

async function loadCalendar() {
  const view = document.getElementById('view-calendar');
  const from = state.calMonth;
  const to = addDaysLocal(addMonths(from, 1), -1);
  const data = await api(`/api/checkins/calendar?from=${from}&to=${to}`);
  const cells = buildMonthCells(from);
  const d0 = parseYmd(from);
  const today = localToday();
  const dows = ['一', '二', '三', '四', '五', '六', '日'];

  const cellHtml = cells.map((c) => {
    if (!c) return `<div class="cell empty"></div>`;
    const cnt = data.days[c] || 0;
    const total = data.totals?.[c] ?? data.activeTotal;
    let cls = '';
    if (total > 0 && cnt >= total) cls = 'full';
    else if (cnt > 0) cls = 'partial';
    if (c === today) cls += ' today';
    const future = c > today;
    return `<div class="cell ${cls}" data-date="${c}" ${future ? '' : 'role="button" tabindex="0"'} aria-label="${c}${total > 0 ? `，已签 ${cnt}/${total}` : ''}">
      <span>${Number(c.slice(8, 10))}</span>
      <span class="dot">${cnt > 0 ? cnt + '✓' : ''}</span>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="cal-head">
      <button class="btn ghost sm" data-action="prev" aria-label="上一月">‹</button>
      <div class="title">${d0.getFullYear()}年${d0.getMonth() + 1}月</div>
      <button class="btn ghost sm" data-action="next" aria-label="下一月">›</button>
    </div>
    <div class="cal-grid">
      ${dows.map((d) => `<div class="dow">${d}</div>`).join('')}
      ${cellHtml}
    </div>
    <div class="legend">
      <span><i style="background:var(--green-bg);border:1px solid color-mix(in srgb,var(--green) 45%,transparent)"></i>全部完成</span>
      <span><i style="background:var(--amber-bg);border:1px solid color-mix(in srgb,var(--amber) 45%,transparent)"></i>部分完成</span>
      <span><i style="background:var(--card);border:1px solid var(--line)"></i>未签</span>
    </div>
    <p class="muted" style="text-align:center;margin-top:10px">点某一天可查看 / 补签当天清单</p>`;
}

/* ---------- 续期 ---------- */
function renewCard(rn) {
  let big, small;
  if (rn.days_left < 0) { big = '已过期'; small = `${-rn.days_left} 天`; }
  else if (rn.days_left === 0) { big = '今天'; small = '到期'; }
  else { big = `${rn.days_left} 天`; small = '后到期'; }
  const href = hrefOf(rn.url);
  const start = rn.current_period_start || rn.last_renewed;
  const end = rn.current_period_end || rn.next_due;
  const policy = rn.renewal_policy || 'extend_from_due';
  return `<div class="card renew-card ${rn.status}" data-id="${rn.id}">
    <div class="badge ${rn.status}"><span>${big}</span><small>${small}</small></div>
    <div class="info">
      <div class="name">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(rn.name)} ↗</a>` : esc(rn.name)}</div>
      <div class="muted">周期 ${rn.cycle_days} 天 · 当前到期 ${esc(end)} · ${policyLabel(policy)}</div>
      <div class="muted">当前周期 ${esc(start)} → ${esc(end)}</div>
      ${rn.note ? `<div class="muted">${esc(rn.note)}</div>` : ''}
      <div class="renew-actions">
        <button class="btn sm" data-action="renew" data-id="${rn.id}">${renewButtonText(policy)}</button>
        <div class="menu-wrap">
          <button class="btn ghost sm" data-action="menu" data-id="${rn.id}" aria-haspopup="true" aria-expanded="false">更多 ▾</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderRenewForm() {
  const box = document.getElementById('renewForm');
  if (!box) return;
  const e = state.editRenew || {};
  const cycle = e.cycle_days || 40;
  const start = e.current_period_start || e.last_renewed || localToday();
  const end = e.current_period_end || e.next_due || addDaysLocal(start, cycle);
  const policy = e.renewal_policy || 'extend_from_due';
  box.innerHTML = `<div class="card"><div class="form-grid">
    <div class="field full"><label>名称 *</label><input id="rn-name" value="${esc(e.name || '')}" placeholder="如 GPT Plus 会员"></div>
    <div class="field full">
      <label>分类（可选）</label>
      <div class="category-suggest" id="category-suggest" style="display:none">
        💡 建议分类：<strong id="suggest-text"></strong>
        <button class="btn ghost sm" data-action="accept-suggest" type="button">采纳</button>
      </div>
      <input id="rn-category" list="category-list" value="${esc(e.category || '')}" placeholder="如 会员服务">
      <datalist id="category-list">
        <option value="会员服务">
        <option value="服务器">
        <option value="域名">
        <option value="软件订阅">
        <option value="存储服务">
      </datalist>
    </div>
    <div class="field full"><label>链接（可选）</label><input id="rn-url" value="${esc(e.url || '')}" placeholder="https://..."></div>
    <div class="field"><label>周期天数 *</label><input id="rn-cycle" type="number" min="1" value="${cycle}"></div>
    <div class="field"><label>续期策略</label><select id="rn-policy">
      <option value="extend_from_due" ${policy === 'extend_from_due' ? 'selected' : ''}>按原到期日顺延</option>
      <option value="reset_from_payment" ${policy === 'reset_from_payment' ? 'selected' : ''}>按付款日重算</option>
      <option value="manual_effective_date" ${policy === 'manual_effective_date' ? 'selected' : ''}>手动选择生效日</option>
    </select></div>
    <div class="field"><label>当前周期开始 *</label><input id="rn-start" type="date" value="${start}"></div>
    <div class="field"><label>当前到期日 *</label><input id="rn-end" type="date" value="${end}"></div>
    <div class="field"><label>提前几天提醒</label><input id="rn-remind" type="number" min="0" value="${e.remind_before_days ?? 3}"></div>
    <div class="field"><label>备注（可选）</label><input id="rn-note" value="${esc(e.note || '')}"></div>
  </div>
  <div class="form-actions">
    <button class="btn" data-action="save">${state.editRenew ? '保存修改' : '添加'}</button>
    <button class="btn ghost" data-action="cancel">取消</button>
  </div></div>`;

  // 绑定名称输入监听，实时推荐分类
  setTimeout(() => {
    const nameInput = document.getElementById('rn-name');
    const categoryInput = document.getElementById('rn-category');
    const suggestBox = document.getElementById('category-suggest');
    const suggestText = document.getElementById('suggest-text');

    if (nameInput && categoryInput && suggestBox && suggestText) {
      // 使用命名函数，避免重复绑定
      const handleCategoryInput = () => {
        const suggested = suggestCategory(nameInput.value);
        if (suggested && !categoryInput.value) {
          suggestText.textContent = suggested;
          suggestBox.style.display = 'block';
        } else {
          suggestBox.style.display = 'none';
        }
      };

      // 每次渲染表单时会创建新的 input 元素（innerHTML），所以不需要 removeEventListener
      nameInput.addEventListener('input', handleCategoryInput);

      // 初始触发一次（编辑时如果名称已填充）
      if (nameInput.value) {
        handleCategoryInput();
      }
    }
  }, 0);
}

// 分类推荐规则
function suggestCategory(name) {
  const nameLC = name.toLowerCase();

  if (/plus|premium|pro|会员|vip|订阅|subscription/.test(nameLC)) {
    return '会员服务';
  }
  if (/云|server|服务器|vps|ecs|轻量|阿里|腾讯|aws|azure/.test(nameLC)) {
    return '服务器';
  }
  if (/域名|domain|\.com|\.cn|\.net|dns/.test(nameLC)) {
    return '域名';
  }
  if (/office|adobe|jetbrains|github|notion|chatgpt|gpt/.test(nameLC)) {
    return '软件订阅';
  }
  if (/oss|cos|s3|存储|storage|backup|网盘/.test(nameLC)) {
    return '存储服务';
  }

  return '';
}

function syncRenewEndFromStart() {
  const start = document.getElementById('rn-start');
  const cycle = document.getElementById('rn-cycle');
  const end = document.getElementById('rn-end');
  if (!start || !cycle || !end || !start.value) return;
  const days = Number(cycle.value);
  if (!(days > 0)) return;
  end.value = addDaysLocal(start.value, days);
}

async function loadRenewals() {
  const view = document.getElementById('view-renew');
  const list = await api(`/api/renewals?today=${localToday()}`);
  state.renewals = list;

  // 按分类分组
  const groups = {};
  list.forEach(r => {
    const cat = r.category || '未分类';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(r);
  });

  // 按紧迫度排序各分组
  Object.keys(groups).forEach(cat => {
    groups[cat].sort((a, b) => a.days_left - b.days_left);
  });

  // 将"未分类"放到最后
  const sortedCategories = Object.keys(groups).sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    return a.localeCompare(b);
  });

  const groupsHtml = sortedCategories.map(cat => {
    const items = groups[cat];
    const hasUrgent = items.some(r => r.status === 'overdue' || r.status === 'soon');
    return `
      <div class="group ${hasUrgent ? '' : 'collapsed'}">
        <div class="group-header" role="button" tabindex="0" aria-expanded="${hasUrgent ? 'true' : 'false'}">
          <span class="group-name">${esc(cat)} (${items.length})</span>
          <span class="group-toggle" aria-hidden="true">▼</span>
        </div>
        <div class="group-content">
          <div class="group-inner">${items.map(renewCard).join('')}</div>
        </div>
      </div>
    `;
  }).join('');

  view.innerHTML = `
    <div class="section-head"><h2>续期提醒</h2><button class="btn sm" data-action="add">+ 添加</button></div>
    <div id="renewForm"></div>
    ${list.length ? `<div class="stagger">${groupsHtml}</div>`
      : `<div class="empty">还没有续期项。<br>把需要定期续期的东西加进来（如 40 天续期），到期会自动提醒。</div>`}`;

  // 根据状态决定是否显示表单
  if (state.showRenewForm || state.editRenew) {
    renderRenewForm();
  }

  updateRenewBadge(list);
}

async function saveRenew() {
  // 防止重复提交
  const saveBtn = document.querySelector('[data-action="save"]');
  if (saveBtn && saveBtn.disabled) return;
  if (saveBtn) saveBtn.disabled = true;

  if (saveBtn) saveBtn.classList.add('loading');
  try {
    const v = (id) => document.getElementById(id).value;
    const body = {
      name: v('rn-name').trim(), url: v('rn-url').trim(),
      cycle_days: Number(v('rn-cycle')),
      current_period_start: v('rn-start'),
      current_period_end: v('rn-end'),
      renewal_policy: v('rn-policy'),
      remind_before_days: Number(v('rn-remind')) || 0,
      note: v('rn-note').trim(),
      category: v('rn-category').trim(),
    };
    if (!body.name) return toastErr('请填写名称');
    if (!(body.cycle_days > 0)) return toastErr('周期天数需为正整数');
    if (!body.current_period_start) return toastErr('请选择当前周期开始日期');
    if (!body.current_period_end) return toastErr('请选择当前到期日');

    if (state.editRenew) {
      await api(`/api/renewals/${state.editRenew.id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/renewals', { method: 'POST', body: JSON.stringify(body) });
    }
    state.showRenewForm = false;
    state.editRenew = null;
    toastOk('已保存');
    await loadRenewals();
  } catch (err) {
    toastErr(err.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('loading'); }
  }
}

async function promptEffectiveDateFor(id) {
  const rn = state.renewals.find((x) => x.id === id);
  const defaultDate = (rn && (rn.current_period_end || rn.next_due)) || localToday();
  const effectiveOn = await promptDateModal('选择续期生效日', defaultDate);
  if (!effectiveOn) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) {
    toastErr('日期格式应为 YYYY-MM-DD');
    return null;
  }
  return effectiveOn;
}

async function renewItem(id, policy, effectiveOn) {
  const body = { paid_on: localToday(), policy };
  if (effectiveOn) body.effective_on = effectiveOn;
  const rn = await api(`/api/renewals/${id}/renew`, { method: 'POST', body: JSON.stringify(body) });
  const end = rn.current_period_end || rn.next_due;
  if (policy === 'reset_from_payment') toastOk(`已按今天重算，下次到期 ${end}`);
  else if (policy === 'manual_effective_date') toastOk(`已更新，下次到期 ${end}`);
  else toastOk(`已顺延，下次到期 ${end}`);
  loadRenewals();
}

/* ---------- 管理 ---------- */
function manageItem(s, idx, total) {
  const href = hrefOf(s.url);
  const isArch = !!s.archived;
  return `<div class="card manage-item" data-id="${s.id}">
    ${!isArch ? `<div class="ord">
      <button data-action="up" data-id="${s.id}" ${idx <= 0 ? 'disabled' : ''}>▲</button>
      <button data-action="down" data-id="${s.id}" ${idx >= total - 1 ? 'disabled' : ''}>▼</button>
    </div>` : ''}
    <div class="info">
      <div class="name truncate">${esc(s.name)} ${s.frequency === 'weekly' ? '<span class="muted">· 每周</span>' : ''}</div>
      <div class="muted truncate">${s.category ? esc(s.category) + ' · ' : ''}${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : '无链接'}</div>
    </div>
    <div class="renew-actions" style="margin:0">
      <button class="btn ghost sm" data-action="edit" data-id="${s.id}">编辑</button>
      <button class="btn ghost sm" data-action="archive" data-id="${s.id}">${isArch ? '恢复' : '归档'}</button>
      <button class="btn danger sm" data-action="del" data-id="${s.id}">删除</button>
    </div>
  </div>`;
}

function renderSiteForm() {
  const box = document.getElementById('siteForm');
  if (!box) return;
  const e = state.editSite || {};
  box.innerHTML = `<div class="card"><div class="form-grid">
    <div class="field full"><label>网站名称 *</label><input id="st-name" value="${esc(e.name || '')}" placeholder="如 掘金 / V2EX / 某论坛"></div>
    <div class="field full"><label>签到链接（可选，点「去签到」会打开）</label><input id="st-url" value="${esc(e.url || '')}" placeholder="https://..."></div>
    <div class="field"><label>分类（可选）</label><input id="st-cat" value="${esc(e.category || '')}" placeholder="如 论坛 / 游戏"></div>
    <div class="field"><label>频率</label><select id="st-freq">
      <option value="daily" ${e.frequency !== 'weekly' ? 'selected' : ''}>每天</option>
      <option value="weekly" ${e.frequency === 'weekly' ? 'selected' : ''}>每周</option>
    </select></div>
  </div>
  <div class="form-actions">
    <button class="btn" data-action="save">${state.editSite ? '保存修改' : '添加'}</button>
    <button class="btn ghost" data-action="cancel">取消</button>
  </div></div>`;
}

async function loadManage() {
  const view = document.getElementById('view-manage');
  const sites = await api('/api/sites?archived=1');
  state.sites = sites;
  const active = sites.filter((s) => !s.archived);
  const archived = sites.filter((s) => s.archived);
  view.innerHTML = `
    <div class="section-head"><h2>网站管理</h2><button class="btn sm" data-action="add">+ 添加网站</button></div>
    <div id="siteForm"></div>
    ${active.length ? `<div class="stagger">${active.map((s, i) => manageItem(s, i, active.length)).join('')}</div>`
      : `<div class="empty">还没有网站，点右上角「添加网站」。</div>`}
    ${archived.length ? `<h3 class="muted" style="margin:18px 2px 8px">已归档</h3><div class="stagger">` + archived.map((s) => manageItem(s, -1, 0)).join('') + '</div>' : ''}`;
  if (state.showSiteForm || state.editSite) renderSiteForm();
}

async function saveSite() {
  const saveBtn = document.querySelector('#siteForm [data-action="save"]');
  const v = (id) => document.getElementById(id).value;
  const body = { name: v('st-name').trim(), url: v('st-url').trim(), category: v('st-cat').trim(), frequency: v('st-freq') };
  if (!body.name) return toastErr('请填写网站名称');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('loading'); }
  try {
    if (state.editSite) await api(`/api/sites/${state.editSite.id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/sites', { method: 'POST', body: JSON.stringify(body) });
    state.showSiteForm = false; state.editSite = null;
    toastOk('已保存'); loadManage();
  } catch (err) {
    toastErr(err.message);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('loading'); }
  }
}

/* ---------- 续期角标 ---------- */
function updateRenewBadge(list) {
  const urgent = list.filter((r) => r.status !== 'ok').length;
  const btn = document.querySelector('#tabs button[data-tab="renew"]');
  if (btn) btn.textContent = urgent ? `续期 (${urgent})` : '续期';
}
async function refreshRenewBadge() {
  try { updateRenewBadge(await api(`/api/renewals?today=${localToday()}`)); } catch { /* ignore */ }
}

/* ---------- 设置页 ---------- */
async function loadSettings() {
  const view = document.getElementById('view-settings');

  try {
    const config = await api('/api/settings');
    const history = await api('/api/settings/history?limit=10');

    const urlInputs = (config.urls || ['']).map((url, i) =>
      `<div class="url-row">
        <input type="text" class="bark-url" data-index="${i}" value="${esc(url)}" placeholder="https://api.day.app/your-key">
        ${config.urls.length > 1 ? `<button class="btn danger sm" data-action="remove-url" data-index="${i}">删除</button>` : ''}
      </div>`
    ).join('');

    const historyHtml = history.length
      ? history.map(h => {
          const statusIcon = h.status === 'success' ? '✓' : '✗';
          const statusClass = h.status === 'success' ? 'success' : 'failed';
          const itemCount = h.items.length;
          return `<div class="history-item ${statusClass}">
            <div class="history-header">
              <span class="history-status">${statusIcon}</span>
              <span class="history-date">${esc(h.date)}</span>
              <span class="history-count">${itemCount} 项</span>
            </div>
            ${h.error ? `<div class="history-error">${esc(h.error)}</div>` : ''}
            ${h.items.map(item => `<div class="history-detail">${esc(item.name)} (${item.daysLeft >= 0 ? '剩' + item.daysLeft : '过期' + (-item.daysLeft)} 天)</div>`).join('')}
          </div>`;
        }).join('')
      : '<div class="empty">暂无推送记录</div>';

    view.innerHTML = `
      <div class="section-head"><h2>⚙️ 推送设置</h2></div>

      <div class="card">
        <h3>Bark 推送配置</h3>
        <div class="form-grid">
          <div class="field full">
            <label>Bark URL（支持多设备）</label>
            <div id="url-container">${urlInputs}</div>
            <button class="btn ghost sm" data-action="add-url" style="margin-top:8px">+ 添加设备</button>
          </div>

          <div class="field">
            <label>推送标题</label>
            <input id="cfg-title" value="${esc(config.title || '签到清单续期提醒')}">
          </div>

          <div class="field">
            <label>通知分组</label>
            <input id="cfg-group" value="${esc(config.group || '签到清单')}">
          </div>

          <div class="field">
            <label>优先级</label>
            <select id="cfg-level">
              <option value="active" ${config.level === 'active' ? 'selected' : ''}>普通</option>
              <option value="timeSensitive" ${config.level === 'timeSensitive' ? 'selected' : ''}>时效性（推荐）</option>
              <option value="passive" ${config.level === 'passive' ? 'selected' : ''}>静默</option>
            </select>
          </div>

          <div class="field full">
            <label>图标 URL（可选）</label>
            <input id="cfg-icon" value="${esc(config.icon || '')}" placeholder="https://...">
          </div>

          <div class="field full">
            <label>点击跳转 URL（可选）</label>
            <input id="cfg-jump" value="${esc(config.jumpUrl || '')}" placeholder="https://...">
          </div>
        </div>

        <div class="form-actions">
          <button class="btn" data-action="save-settings">保存配置</button>
          <button class="btn ghost" data-action="test-push">发送测试消息</button>
          <button class="btn ghost" data-action="check-now">立即检查并推送</button>
        </div>
      </div>

      <div class="section-head" style="margin-top:24px"><h2>📊 推送历史</h2></div>
      <div class="history-list">${historyHtml}</div>
    `;
  } catch (err) {
    view.innerHTML = `<div class="empty">加载失败: ${esc(err.message)}</div>`;
  }
}

async function saveSettings() {
  const urls = Array.from(document.querySelectorAll('.bark-url'))
    .map(input => input.value.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return toastErr('请至少配置一个 Bark URL');
  }

  const config = {
    urls,
    title: document.getElementById('cfg-title').value.trim(),
    group: document.getElementById('cfg-group').value.trim(),
    level: document.getElementById('cfg-level').value,
    icon: document.getElementById('cfg-icon').value.trim(),
    jumpUrl: document.getElementById('cfg-jump').value.trim(),
  };

  const btn = document.querySelector('[data-action="save-settings"]');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(config) });
    toastOk('配置已保存');
  } catch (err) {
    toastErr('保存失败: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

async function testPush() {
  const btn = document.querySelector('[data-action="test-push"]');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    const result = await api('/api/settings/test', { method: 'POST' });
    toastOk(`测试消息已发送到 ${result.sent_to}/${result.total} 个设备`);
  } catch (err) {
    toastErr('发送失败: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

async function checkNow() {
  const btn = document.querySelector('[data-action="check-now"]');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    const result = await api('/api/settings/check-now', { method: 'POST' });
    if (result.pending && result.pending.length > 0) {
      toastOk(result.message);
      loadSettings(); // 刷新历史记录
    } else {
      toast(result.message, 'info');
    }
  } catch (err) {
    toastErr('检查失败: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

/* ---------- 导航 ---------- */
const views = { today: loadToday, calendar: loadCalendar, renew: loadRenewals, manage: loadManage, settings: loadSettings };
function switchTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + tab).classList.remove('hidden');
  views[tab]().catch((err) => toastErr(err.message));
}

/* ---------- 事件绑定 ---------- */
document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) switchTab(b.dataset.tab);
});
document.getElementById('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.href = '/login.html';
});

// 背景切换
const bgToggle = document.getElementById('bgToggle');
const bgEnabled = localStorage.getItem('bgEnabled') === '1';
if (bgEnabled) document.body.classList.add('with-bg');
bgToggle.addEventListener('click', () => {
  document.body.classList.toggle('with-bg');
  localStorage.setItem('bgEnabled', document.body.classList.contains('with-bg') ? '1' : '0');
});

// 主题切换（深色 / 浅色 / 跟随系统）
const themeToggle = document.getElementById('themeToggle');
function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function currentThemeIsDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return systemPrefersDark();
}
function syncThemeIcon() {
  // 显示「点击后会切到的目标」的图标
  themeToggle.textContent = currentThemeIsDark() ? '☀️' : '🌙';
}
themeToggle.addEventListener('click', () => {
  const nextDark = !currentThemeIsDark();
  document.documentElement.setAttribute('data-theme', nextDark ? 'dark' : 'light');
  localStorage.setItem('theme', nextDark ? 'dark' : 'light');
  syncThemeIcon();
});
// 跟随系统变化时更新图标（仅当用户未手动锁定）
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem('theme')) syncThemeIcon();
  });
}
syncThemeIcon();

// 折叠分组的通用函数（同步 aria-expanded）
function toggleGroup(header) {
  const group = header.closest('.group');
  if (!group) return;
  const collapsed = group.classList.toggle('collapsed');
  header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

// 根据当前卡片状态同步顶部计数和进度条，供乐观更新与回滚复用。
function syncTodayProgress() {
  const items = todayView.querySelectorAll('.checkitem');
  const doneCount = todayView.querySelectorAll('.checkitem[data-done="1"]').length;
  const total = items.length;
  const count = todayView.querySelector('.progress .row b');
  const bar = todayView.querySelector('.progress .bar > i');
  if (count) count.textContent = `${doneCount}/${total}`;
  if (bar) bar.style.width = `${total ? Math.round((doneCount / total) * 100) : 0}%`;
}

function setCheckitemDone(item, done) {
  item.classList.toggle('done', done);
  item.dataset.done = done ? '1' : '0';
  item.setAttribute('aria-pressed', done ? 'true' : 'false');
  const label = item.getAttribute('aria-label') || '';
  item.setAttribute('aria-label', label.replace(done ? '，未签到' : '，已签到', done ? '，已签到' : '，未签到'));
  const tick = item.querySelector('.checkbox .tick');
  if (tick) tick.textContent = done ? '✓' : '';
  syncTodayProgress();
}

// 打卡切换（供点击与键盘复用）
async function toggleCheckin(item) {
  const id = Number(item.dataset.id);
  const done = item.dataset.done === '1';
  try {
    await api('/api/checkins', {
      method: done ? 'DELETE' : 'POST',
      body: JSON.stringify({ site_id: id, date: state.date }),
    });
    await loadToday();
    // 取消签到后给一次撤销机会
    if (done) {
      toast('已取消签到', 'info', {
        label: '撤销', duration: 4000,
        onClick: async () => {
          try { await api('/api/checkins', { method: 'POST', body: JSON.stringify({ site_id: id, date: state.date }) }); await loadToday(); toastOk('已恢复签到'); }
          catch (err) { toastErr(err.message); }
        },
      });
    }
  } catch (err) { toastErr(err.message); }
}

// 今日
const todayView = document.getElementById('view-today');
todayView.addEventListener('click', async (e) => {
  // 分组折叠/展开
  const header = e.target.closest('.group-header');
  if (header) { toggleGroup(header); return; }

  const t = e.target.closest('[data-action]');
  if (t && t.dataset.action === 'go') {
    // 点「去签到」时立刻打勾（乐观更新），后台提交；失败则回滚并提示
    const id = Number(t.dataset.id);
    const item = t.closest('.checkitem');
    if (item && item.dataset.done === '0') {
      setCheckitemDone(item, true);
      api('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({ site_id: id, date: state.date }),
      }).catch(() => {
        // 失败回滚，让用户知道没签上
        setCheckitemDone(item, false);
        toastErr('签到未成功，请重试');
      });
    }
    return; // 让浏览器处理 <a> 的默认跳转
  }
  if (t && t.dataset.action === 'backToday') {
    state.date = localToday(); loadToday();
    return;
  }
  // 点击卡片本体（非链接区域）切换勾选状态
  const item = e.target.closest('.checkitem');
  if (item && !e.target.closest('a, button')) toggleCheckin(item);
});
// 键盘：Enter/Space 触发签到卡片与分组折叠
todayView.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const header = e.target.closest('.group-header');
  if (header) { e.preventDefault(); toggleGroup(header); return; }
  const item = e.target.closest('.checkitem');
  if (item) { e.preventDefault(); toggleCheckin(item); }
});
todayView.addEventListener('change', (e) => {
  if (e.target.id === 'datePick') { state.date = e.target.value || localToday(); loadToday(); }
});

// 日历
const calView = document.getElementById('view-calendar');
function openCalCell(cell) {
  if (cell.dataset.date > localToday()) return toast('不能给未来的日期签到', 'info');
  state.date = cell.dataset.date;
  switchTab('today');
}
calView.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (t) {
    if (t.dataset.action === 'prev') state.calMonth = addMonths(state.calMonth, -1);
    if (t.dataset.action === 'next') state.calMonth = addMonths(state.calMonth, 1);
    loadCalendar();
    return;
  }
  const cell = e.target.closest('.cell[data-date]');
  if (cell) openCalCell(cell);
});
calView.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const cell = e.target.closest('.cell[data-date]');
  if (cell) { e.preventDefault(); openCalCell(cell); }
});

// 关闭所有打开的「更多▾」下拉
function closeRenewMenus() {
  document.querySelectorAll('.menu-pop').forEach((m) => m.remove());
  document.querySelectorAll('.renew-card.menu-open').forEach((card) => card.classList.remove('menu-open'));
  document.querySelectorAll('[data-action="menu"][aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

// 打开某个续期卡片的「更多▾」下拉
function openRenewMenu(btn, id) {
  const wasOpen = btn.getAttribute('aria-expanded') === 'true';
  closeRenewMenus();
  if (wasOpen) return;
  btn.setAttribute('aria-expanded', 'true');
  btn.closest('.renew-card')?.classList.add('menu-open');
  const pop = document.createElement('div');
  pop.className = 'menu-pop';
  pop.innerHTML = `
    <button data-action="renewToday" data-id="${id}">按今天重算</button>
    <button data-action="renewManual" data-id="${id}">选择生效日</button>
    <button data-action="edit" data-id="${id}">编辑</button>
    <button class="danger" data-action="del" data-id="${id}">删除</button>`;
  btn.parentElement.appendChild(pop);
}

// 点击页面其他区域关闭下拉
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) closeRenewMenus();
});

async function handleRenewAction(action, id) {
  switch (action) {
    case 'add':
      state.showRenewForm = true;
      state.editRenew = null;
      renderRenewForm();
      break;
    case 'cancel': {
      state.showRenewForm = false;
      state.editRenew = null;
      const box = document.getElementById('renewForm');
      if (box) box.innerHTML = '';
      break;
    }
    case 'accept-suggest': {
      const suggested = document.getElementById('suggest-text').textContent;
      document.getElementById('rn-category').value = suggested;
      document.getElementById('category-suggest').style.display = 'none';
      break;
    }
    case 'edit':
      closeRenewMenus();
      state.editRenew = state.renewals.find((x) => x.id === id) || null;
      state.showRenewForm = false; // 编辑模式下不使用 showRenewForm
      renderRenewForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'save':
      saveRenew();
      break;
    case 'renew': {
      const rn = state.renewals.find((x) => x.id === id);
      const policy = (rn && rn.renewal_policy) || 'extend_from_due';
      const effectiveOn = policy === 'manual_effective_date' ? await promptEffectiveDateFor(id) : null;
      if (policy === 'manual_effective_date' && !effectiveOn) break;
      try { await renewItem(id, policy, effectiveOn); } catch (err) { toastErr(err.message); }
      break;
    }
    case 'renewToday':
      closeRenewMenus();
      try { await renewItem(id, 'reset_from_payment'); } catch (err) { toastErr(err.message); }
      break;
    case 'renewManual': {
      closeRenewMenus();
      const effectiveOn = await promptEffectiveDateFor(id);
      if (!effectiveOn) break;
      try { await renewItem(id, 'manual_effective_date', effectiveOn); } catch (err) { toastErr(err.message); }
      break;
    }
    case 'del': {
      closeRenewMenus();
      const rn = state.renewals.find((x) => x.id === id);
      const ok = await confirmModal('删除续期项', `确定删除「${rn ? rn.name : '该项'}」？此操作不可撤销。`, { danger: true, confirmText: '删除' });
      if (ok) {
        try { await api(`/api/renewals/${id}`, { method: 'DELETE' }); await loadRenewals(); toastOk('已删除'); } catch (err) { toastErr(err.message); }
      }
      break;
    }
  }
}

// 续期
document.getElementById('view-renew').addEventListener('click', async (e) => {
  // 分组折叠/展开
  const header = e.target.closest('.group-header');
  if (header) { toggleGroup(header); return; }

  const t = e.target.closest('[data-action]');
  if (!t) return;
  const id = t.dataset.id ? Number(t.dataset.id) : null;
  if (t.dataset.action === 'menu') { openRenewMenu(t, id); return; }
  handleRenewAction(t.dataset.action, id);
});
document.getElementById('view-renew').addEventListener('keydown', (e) => {
  // 表单内回车提交（select 除外，避免误触）
  if (e.key === 'Enter' && e.target.closest('#renewForm') && e.target.tagName === 'INPUT') {
    e.preventDefault(); saveRenew(); return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const header = e.target.closest('.group-header');
  if (header) { e.preventDefault(); toggleGroup(header); }
});
document.getElementById('view-renew').addEventListener('change', (e) => {
  if (e.target.id === 'rn-start' || e.target.id === 'rn-cycle') syncRenewEndFromStart();
});

// 管理
document.getElementById('view-manage').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const id = t.dataset.id ? Number(t.dataset.id) : null;
  switch (t.dataset.action) {
    case 'add': state.showSiteForm = true; state.editSite = null; renderSiteForm(); break;
    case 'cancel': state.showSiteForm = false; state.editSite = null; { const b = document.getElementById('siteForm'); if (b) b.innerHTML = ''; } break;
    case 'edit': state.editSite = state.sites.find((x) => x.id === id) || null; state.showSiteForm = true; renderSiteForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'save': saveSite(); break;
    case 'archive': {
      const s = state.sites.find((x) => x.id === id);
      try { await api(`/api/sites/${id}`, { method: 'PUT', body: JSON.stringify({ archived: s && s.archived ? 0 : 1 }) }); await loadManage(); toastOk(s && s.archived ? '已恢复' : '已归档'); }
      catch (err) { toastErr(err.message); }
      break;
    }
    case 'del': {
      const s = state.sites.find((x) => x.id === id);
      const ok = await confirmModal('删除网站', `删除「${s ? s.name : '该网站'}」后，它的所有打卡记录也会一并删除，且不可撤销。确定吗？`, { danger: true, confirmText: '删除' });
      if (ok) {
        try { await api(`/api/sites/${id}`, { method: 'DELETE' }); await loadManage(); toastOk('已删除'); } catch (err) { toastErr(err.message); }
      }
      break;
    }
    case 'up':
    case 'down':
      try { await api(`/api/sites/${id}/move`, { method: 'POST', body: JSON.stringify({ dir: t.dataset.action }) }); await loadManage(); }
      catch (err) { toastErr(err.message); }
      break;
  }
});
// 管理表单：回车提交
document.getElementById('view-manage').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.closest('#siteForm') && e.target.tagName === 'INPUT') {
    e.preventDefault(); saveSite();
  }
});

// 设置
document.getElementById('view-settings').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;

  switch (t.dataset.action) {
    case 'save-settings':
      saveSettings();
      break;
    case 'test-push':
      testPush();
      break;
    case 'check-now':
      checkNow();
      break;
    case 'add-url': {
      const container = document.getElementById('url-container');
      const index = document.querySelectorAll('.bark-url').length;
      const div = document.createElement('div');
      div.className = 'url-row';
      div.innerHTML = `
        <input type="text" class="bark-url" data-index="${index}" placeholder="https://api.day.app/your-key">
        <button class="btn danger sm" data-action="remove-url" data-index="${index}">删除</button>
      `;
      container.appendChild(div);
      break;
    }
    case 'remove-url': {
      const row = t.closest('.url-row');
      if (row) row.remove();
      break;
    }
  }
});

/* ---------- 启动 ---------- */
switchTab('today');
refreshRenewBadge();
