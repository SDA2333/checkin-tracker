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
function hrefOf(u) { if (!u) return null; return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('未登录'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

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
        return `<div class="checkitem ${s.done ? 'done' : ''}" data-id="${s.id}" data-done="${s.done ? 1 : 0}">
          <div class="checkbox" aria-label="完成标记">${s.done ? '✓' : ''}</div>
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
        <div class="group-header">
          <span class="group-arrow">▼</span>
          <span class="group-title">${esc(cat)}</span>
          <span class="group-count">(${sites.length})</span>
        </div>
        <div class="group-items">${groupItems}</div>
      </div>`;
    }).join('');
  }

  view.innerHTML = `
    <div class="today-head">
      <input type="date" id="datePick" value="${state.date}" max="${localToday()}" />
      ${isToday ? '' : `<button class="btn ghost sm" data-action="backToday">回到今天</button>`}
      <div class="progress">
        <div class="row spread"><span class="muted">${isToday ? '今日进度' : esc(state.date)}</span><b>${data.doneCount}/${data.total}</b></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
    </div>
    <div>${items}</div>`;
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
    let cls = '';
    if (data.activeTotal > 0 && cnt >= data.activeTotal) cls = 'full';
    else if (cnt > 0) cls = 'partial';
    if (c === today) cls += ' today';
    return `<div class="cell ${cls}" data-date="${c}">
      <span>${Number(c.slice(8, 10))}</span>
      <span class="dot">${cnt > 0 ? cnt + '✓' : ''}</span>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="cal-head">
      <button class="btn ghost sm" data-action="prev">‹</button>
      <div class="title">${d0.getFullYear()}年${d0.getMonth() + 1}月</div>
      <button class="btn ghost sm" data-action="next">›</button>
    </div>
    <div class="cal-grid">
      ${dows.map((d) => `<div class="dow">${d}</div>`).join('')}
      ${cellHtml}
    </div>
    <div class="legend">
      <span><i style="background:#dcfce7;border:1px solid #86efac"></i>全部完成</span>
      <span><i style="background:#fef3c7;border:1px solid #fcd34d"></i>部分完成</span>
      <span><i style="background:#fff;border:1px solid #e2e8f0"></i>未签</span>
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
  return `<div class="card renew-card" data-id="${rn.id}">
    <div class="badge ${rn.status}"><span>${big}</span><small>${small}</small></div>
    <div class="info">
      <div class="name">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(rn.name)} ↗</a>` : esc(rn.name)}</div>
      <div class="muted">周期 ${rn.cycle_days} 天 · 上次 ${rn.last_renewed} · 下次 ${rn.next_due}</div>
      ${rn.note ? `<div class="muted">${esc(rn.note)}</div>` : ''}
      <div class="renew-actions">
        <button class="btn sm" data-action="renew" data-id="${rn.id}">✓ 今天已续期</button>
        <button class="btn ghost sm" data-action="edit" data-id="${rn.id}">编辑</button>
        <button class="btn danger sm" data-action="del" data-id="${rn.id}">删除</button>
      </div>
    </div>
  </div>`;
}

function renderRenewForm() {
  const box = document.getElementById('renewForm');
  if (!box) return;
  const e = state.editRenew || {};
  box.innerHTML = `<div class="card"><div class="form-grid">
    <div class="field full"><label>名称 *</label><input id="rn-name" value="${esc(e.name || '')}" placeholder="如 XX 会员 / XX 服务器"></div>
    <div class="field full"><label>链接（可选）</label><input id="rn-url" value="${esc(e.url || '')}" placeholder="https://..."></div>
    <div class="field"><label>周期天数 *</label><input id="rn-cycle" type="number" min="1" value="${e.cycle_days || 40}"></div>
    <div class="field"><label>上次续期日期 *</label><input id="rn-last" type="date" value="${e.last_renewed || localToday()}" max="${localToday()}"></div>
    <div class="field"><label>提前几天提醒</label><input id="rn-remind" type="number" min="0" value="${e.remind_before_days ?? 3}"></div>
    <div class="field"><label>备注（可选）</label><input id="rn-note" value="${esc(e.note || '')}"></div>
  </div>
  <div class="form-actions">
    <button class="btn" data-action="save">${state.editRenew ? '保存修改' : '添加'}</button>
    <button class="btn ghost" data-action="cancel">取消</button>
  </div></div>`;
}

async function loadRenewals() {
  const view = document.getElementById('view-renew');
  const list = await api(`/api/renewals?today=${localToday()}`);
  state.renewals = list;
  view.innerHTML = `
    <div class="section-head"><h2>续期提醒</h2><button class="btn sm" data-action="add">+ 添加</button></div>
    <div id="renewForm"></div>
    ${list.length ? list.map(renewCard).join('')
      : `<div class="empty">还没有续期项。<br>把需要定期续期的东西加进来（如 40 天续期），到期会自动提醒。</div>`}`;
  if (state.showRenewForm || state.editRenew) renderRenewForm();
  updateRenewBadge(list);
}

async function saveRenew() {
  const v = (id) => document.getElementById(id).value;
  const body = {
    name: v('rn-name').trim(), url: v('rn-url').trim(),
    cycle_days: Number(v('rn-cycle')), last_renewed: v('rn-last'),
    remind_before_days: Number(v('rn-remind')), note: v('rn-note').trim(),
  };
  if (!body.name) return toast('请填写名称');
  if (!(body.cycle_days > 0)) return toast('周期天数需为正整数');
  if (!body.last_renewed) return toast('请选择上次续期日期');
  try {
    if (state.editRenew) await api(`/api/renewals/${state.editRenew.id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/renewals', { method: 'POST', body: JSON.stringify(body) });
    state.showRenewForm = false; state.editRenew = null;
    toast('已保存'); loadRenewals();
  } catch (err) { toast(err.message); }
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
    ${active.length ? active.map((s, i) => manageItem(s, i, active.length)).join('')
      : `<div class="empty">还没有网站，点右上角「添加网站」。</div>`}
    ${archived.length ? `<h3 class="muted" style="margin:18px 2px 8px">已归档</h3>` + archived.map((s) => manageItem(s, -1, 0)).join('') : ''}`;
  if (state.showSiteForm || state.editSite) renderSiteForm();
}

async function saveSite() {
  const v = (id) => document.getElementById(id).value;
  const body = { name: v('st-name').trim(), url: v('st-url').trim(), category: v('st-cat').trim(), frequency: v('st-freq') };
  if (!body.name) return toast('请填写网站名称');
  try {
    if (state.editSite) await api(`/api/sites/${state.editSite.id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/sites', { method: 'POST', body: JSON.stringify(body) });
    state.showSiteForm = false; state.editSite = null;
    toast('已保存'); loadManage();
  } catch (err) { toast(err.message); }
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

/* ---------- 导航 ---------- */
const views = { today: loadToday, calendar: loadCalendar, renew: loadRenewals, manage: loadManage };
function switchTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + tab).classList.remove('hidden');
  views[tab]().catch((err) => toast(err.message));
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

// 今日
const todayView = document.getElementById('view-today');
todayView.addEventListener('click', async (e) => {
  // 分组折叠/展开
  const header = e.target.closest('.group-header');
  if (header) {
    const group = header.closest('.group');
    group.classList.toggle('collapsed');
    return;
  }

  const t = e.target.closest('[data-action]');
  if (t && t.dataset.action === 'go') {
    // 点「去签到」时立刻打勾，静默提交打卡 API（不阻塞链接跳转）
    const id = Number(t.dataset.id);
    const item = t.closest('.checkitem');
    if (item && item.dataset.done === '0') {
      item.classList.add('done');
      item.dataset.done = '1';
      const box = item.querySelector('.checkbox');
      if (box) box.textContent = '✓';
      // 后台静默提交，失败也不影响用户继续操作（链接已经打开了）
      api('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({ site_id: id, date: state.date }),
      }).catch(() => {}); // 静默失败，用户刷新页面会看到真实状态
    }
    return; // 让浏览器处理 <a> 的默认跳转
  }
  if (t && t.dataset.action === 'backToday') {
    state.date = localToday(); loadToday();
    return;
  }
  // 点击卡片本体（非链接区域）切换勾选状态
  const item = e.target.closest('.checkitem');
  if (item && !e.target.closest('a, button')) {
    const id = Number(item.dataset.id);
    const done = item.dataset.done === '1';
    try {
      await api('/api/checkins', {
        method: done ? 'DELETE' : 'POST',
        body: JSON.stringify({ site_id: id, date: state.date }),
      });
      loadToday();
    } catch (err) { toast(err.message); }
  }
});
todayView.addEventListener('change', (e) => {
  if (e.target.id === 'datePick') { state.date = e.target.value || localToday(); loadToday(); }
});

// 日历
const calView = document.getElementById('view-calendar');
calView.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (t) {
    if (t.dataset.action === 'prev') state.calMonth = addMonths(state.calMonth, -1);
    if (t.dataset.action === 'next') state.calMonth = addMonths(state.calMonth, 1);
    loadCalendar();
    return;
  }
  const cell = e.target.closest('.cell[data-date]');
  if (cell) {
    if (cell.dataset.date > localToday()) return toast('不能给未来的日期签到');
    state.date = cell.dataset.date;
    switchTab('today');
  }
});

// 续期
document.getElementById('view-renew').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const id = t.dataset.id ? Number(t.dataset.id) : null;
  switch (t.dataset.action) {
    case 'add': state.showRenewForm = true; state.editRenew = null; renderRenewForm(); break;
    case 'cancel': state.showRenewForm = false; state.editRenew = null; { const b = document.getElementById('renewForm'); if (b) b.innerHTML = ''; } break;
    case 'edit': state.editRenew = state.renewals.find((x) => x.id === id) || null; state.showRenewForm = true; renderRenewForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'save': saveRenew(); break;
    case 'renew':
      try { await api(`/api/renewals/${id}/renew`, { method: 'POST', body: JSON.stringify({ date: localToday() }) }); toast('已续期，已重新计算下次到期'); loadRenewals(); }
      catch (err) { toast(err.message); }
      break;
    case 'del':
      if (confirm('确定删除该续期项？')) {
        try { await api(`/api/renewals/${id}`, { method: 'DELETE' }); loadRenewals(); } catch (err) { toast(err.message); }
      }
      break;
  }
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
      try { await api(`/api/sites/${id}`, { method: 'PUT', body: JSON.stringify({ archived: s && s.archived ? 0 : 1 }) }); loadManage(); }
      catch (err) { toast(err.message); }
      break;
    }
    case 'del':
      if (confirm('删除后该网站的打卡记录也会一并删除，确定？')) {
        try { await api(`/api/sites/${id}`, { method: 'DELETE' }); loadManage(); } catch (err) { toast(err.message); }
      }
      break;
    case 'up':
    case 'down':
      try { await api(`/api/sites/${id}/move`, { method: 'POST', body: JSON.stringify({ dir: t.dataset.action }) }); loadManage(); }
      catch (err) { toast(err.message); }
      break;
  }
});

/* ---------- 启动 ---------- */
switchTab('today');
refreshRenewBadge();
