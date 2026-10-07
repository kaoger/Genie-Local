'use strict';
(() => {
/* ================= 客戶名單與聯絡結果 ================= */
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const columns = 'id,status,answers,customer_name,phone,project_type,location,interior_area,budget_range,start_time,completed_at,contact_result,contact_result_at,contact_first_at,contact_undo_until,lead_grade,notification_status,messenger_user_id';
const sections = {
  pending: { size: 50, order: 'completed_at', ascending: true, empty: '目前沒有待聯絡的客戶' },
  contacted: { size: 20, order: 'contact_result_at', ascending: false, empty: '還沒有已回報的客戶' },
};
const results = { contacted: '已聯絡', site_visit: '約丈量', not_interested: '沒興趣', unreachable: '聯絡不上' };
const grades = { hot: '🔥 高分', normal: '一般', low: '低' };
// 連續經過時間；摘要、卡片與伺服器篩選共用同一組門檻。
const waitLevels = [
  { id: 'today', label: '當天', icon: '🟢', hours: 24 },
  { id: 'recent', label: '1–2 天', icon: '🔵', hours: 72 },
  { id: 'aging', label: '3–4 天', icon: '🟡', hours: 120 },
  { id: 'old', label: '5 天以上', icon: '🔴', hours: Infinity },
];
const hourMs = 3600000, summaryPageSize = 1000;
let pendingFilter = 'all', pendingNow = Date.now();
let summary = null, summaryRequest = 0, summaryTimer;
let authIdentity = '', authStatus = '', identityEpoch = 0;
let epoch = 0;
let contactedTotalRequest = 0;
let lists = {};
let root = null;
let activeTab = 'pending', selectedFilter = 'all';
let totals = { pending: null, contacted: null }, filteredCount = null;
const saving = new Set();
const creating = new Set();
let undoTimer;
let taskTemplates = null;
let taskRows = new Map(), taskDrafts = new Map(), taskRequests = new Map();
let taskFocus = null;
let replacingTaskDOM = false;
const completingTasks = new Set();

/* ================= 流程待辦（範本快取與批次讀取） ================= */
const stepIdentity = (run, key) => JSON.stringify([run.playbook_key, run.version, key]);
function clearTasks(preserveDrafts = false) {
  taskRows = new Map(); taskRequests = new Map();
  if (!preserveDrafts) { taskDrafts = new Map(); taskFocus = null; }
}
async function taskRead(run, valid) {
  let response = await run();
  if (!valid()) return null;
  if (response.status === 401) {
    const session = await window.GenieAuth.refresh();
    if (!session || !valid()) return null;
    response = await run();
  }
  if (!valid()) return null;
  if (response.error || !Array.isArray(response.data)) throw Error('下一步讀取失敗');
  return response.data;
}
function loadTaskTemplates() {
  if (taskTemplates) return taskTemplates.promise;
  const cache = { steps: new Map(), transitions: [], ready: false }, identity = identityEpoch;
  taskTemplates = cache;
  const valid = () => taskTemplates === cache && identity === identityEpoch && active() && canReadSummary();
  const client = window.GenieAuth.getClient();
  // 範本可能升版；批次分頁避免 REST 預設筆數上限截斷舊輪次的範本。
  const readAll = async table => {
    const rows = [];
    for (let offset = 0; valid(); offset += 1000) {
      let query = client.from(table).select('*').order('playbook_key').order('version').order('step_key');
      if (table === 'lead_playbook_transitions') query = query.order('outcome_key');
      const page = await taskRead(() => query.range(offset, offset + 999), valid);
      if (!page) return null;
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
    return null;
  };
  cache.promise = Promise.all([readAll('lead_playbook_steps'), readAll('lead_playbook_transitions')]).then(([steps, transitions]) => {
    if (!valid() || !steps || !transitions) { if (taskTemplates === cache) taskTemplates = null; return false; }
    cache.steps = new Map(steps.map(step => [stepIdentity(step, step.step_key), step]));
    cache.transitions = transitions.slice().sort((a, b) => a.sort - b.sort);
    cache.ready = true;
    return true;
  }).catch(() => { if (taskTemplates === cache) taskTemplates = null; return false; });
  return cache.promise;
}
async function loadTasks(leads) {
  if (!leads.length || !active() || !canReadSummary()) return;
  const current = epoch, state = lists.contacted, identity = identityEpoch;
  const ids = leads.map(lead => String(lead.id));
  const requests = new Map(ids.map(id => {
    const request = (taskRequests.get(id) || 0) + 1;
    taskRequests.set(id, request);
    return [id, request];
  }));
  const valid = () => current === epoch && identity === identityEpoch && state === lists.contacted && active() && canReadSummary();
  try {
    const client = window.GenieAuth.getClient();
    const [ready, tasks, latest] = await Promise.all([
      loadTaskTemplates(),
      taskRead(() => client.from('lead_tasks').select('id,run_id,lead_id,step_key,status,due_at,version').eq('status', 'open').in('lead_id', ids), valid),
      // 每位名單各取最新輪次與錯誤；嵌入關聯的 limit 為每位父列各 1 筆。
      taskRead(() => client.from('customer_leads').select('id,lead_playbook_runs(id,lead_id,run_no,playbook_key,version,source_result,status),lead_task_errors(created_at)')
        .in('id', ids).order('run_no', { referencedTable: 'lead_playbook_runs', ascending: false }).limit(1, { referencedTable: 'lead_playbook_runs' })
        .order('created_at', { referencedTable: 'lead_task_errors', ascending: false }).limit(1, { referencedTable: 'lead_task_errors' }), valid),
    ]);
    if (!valid() || !tasks || !latest) return;
    for (const id of ids) {
      if (requests.get(id) !== taskRequests.get(id)) continue;
      const row = latest.find(item => String(item.id) === id);
      const run = row?.lead_playbook_runs?.[0] || null;
      const task = tasks.find(task => String(task.lead_id) === id && task.run_id === run?.id) || null;
      taskRows.set(id, { run, task,
        errorAt: row?.lead_task_errors?.[0]?.created_at, readError: !ready });
      if (taskDrafts.get(id)?.taskId !== task?.id) taskDrafts.delete(id);
    }
  } catch {
    if (valid()) for (const id of ids) if (requests.get(id) === taskRequests.get(id)) taskRows.set(id, { readError: true });
  }
  if (valid()) render('contacted');
}
function taipeiDay(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function taskDue(task) {
  const due = Date.parse(task.due_at), now = Date.now();
  if (!Number.isFinite(due)) return '';
  const display = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(due));
  const elapsed = now - due;
  const status = elapsed > 0 ? `🔴 已逾期 ${elapsed < 86400000 ? `${Math.max(1, Math.floor(elapsed / hourMs))} 小時` : `${Math.floor(elapsed / 86400000)} 天`}`
    : taipeiDay(due) === taipeiDay(now) ? '🟡 今天到期' : '';
  return `<time datetime="${esc(task.due_at)}">${esc(`到期 ${display}`)}</time>${status ? `<span class="lead-task-due ${elapsed > 0 ? 'overdue' : 'today'}">${esc(status)}</span>` : ''}`;
}
function taskBlock(lead) {
  const id = String(lead.id), data = taskRows.get(id);
  if (!data) return '';
  if (data.readError) return '<div class="lead-task-block"><p class="lead-error" role="alert">下一步讀取失敗，請按重新整理</p></div>';
  if (lead.contact_result_at && Date.parse(data.errorAt) >= Date.parse(lead.contact_result_at)) {
    return '<div class="lead-task-block"><p class="lead-error" role="alert">⚠️ 下一步沒有建立成功，請通知管理員</p></div>';
  }
  const { run, task } = data;
  if (!run || run.source_result !== lead.contact_result) return '';
  if (run.status === 'finished') return '<div class="lead-task-block">✓ 流程已完成</div>';
  if (run.status !== 'active' || !task) return '';
  const step = taskTemplates?.steps.get(stepIdentity(run, task.step_key));
  if (!step) return '<div class="lead-task-block"><p class="lead-error" role="alert">下一步讀取失敗，請按重新整理</p></div>';
  const choices = taskTemplates.transitions.filter(item => stepIdentity(item, item.step_key) === stepIdentity(run, task.step_key));
  const draft = taskDrafts.get(id), busy = completingTasks.has(id);
  const selected = draft && choices.find(item => item.outcome_key === draft.outcome && draft.taskId === task.id);
  const inputDue = selected?.next_step_key && taskTemplates.steps.get(stepIdentity(run, selected.next_step_key))?.due_kind === 'input';
  return `<section class="lead-task-block" aria-label="下一步"><div class="lead-task-heading"><strong>${esc(`下一步：${step.label}`)}</strong>${taskDue(task)}</div>
    <div class="lead-task-results" role="group" aria-label="下一步結果">${choices.map(item => `<button type="button" data-task-outcome="${esc(item.outcome_key)}" ${busy ? 'disabled' : ''}>${esc(item.outcome_label)}</button>`).join('')}</div>
    ${selected ? `<form class="lead-task-confirm" data-task-confirm><strong>${esc(`確認結果：${selected.outcome_label}`)}</strong>
      <label>備註（選填，最多 500 字）<textarea name="task_note" maxlength="500" rows="3" ${busy ? 'disabled' : ''}>${esc(draft.note)}</textarea></label>
      ${inputDue ? `<label>下一步日期時間（台北時間，必填）<input type="datetime-local" name="task_due" value="${esc(draft.due)}" required ${busy ? 'disabled' : ''}></label>` : ''}
      ${draft.error ? `<p class="lead-error" role="alert">${esc(draft.error)}</p>` : ''}
      <div class="lead-task-results"><button type="submit" ${busy ? 'disabled' : ''}>${busy ? '送出中…' : '確定'}</button><button type="button" data-task-cancel ${busy ? 'disabled' : ''}>取消</button></div></form>` : ''}</section>`;
}
async function completeTask(form) {
  const id = form.closest('.lead-card')?.dataset.leadId, draft = taskDrafts.get(id), data = taskRows.get(id);
  if (!draft || !data?.task || completingTasks.has(id)) return;
  if (!canReadSummary()) { notice('需連線才能完成下一步，請連線後重試'); return; }
  const transition = taskTemplates.transitions.find(item => stepIdentity(item, item.step_key) === stepIdentity(data.run, data.task.step_key) && item.outcome_key === draft.outcome);
  const inputDue = transition?.next_step_key && taskTemplates.steps.get(stepIdentity(data.run, transition.next_step_key))?.due_kind === 'input';
  draft.note = form.elements.task_note.value;
  draft.due = form.elements.task_due?.value || '';
  const nextDue = inputDue && draft.due ? `${draft.due}${draft.due.length === 16 ? ':00' : ''}+08:00` : null;
  if ([...draft.note].length > 500 || (inputDue && (!nextDue || !Number.isFinite(Date.parse(nextDue))))) {
    draft.error = inputDue && !nextDue ? '請填下一步日期時間（台北時間）' : '請確認備註不超過 500 字且日期時間有效';
    render('contacted'); return;
  }
  const current = epoch, identity = identityEpoch;
  const valid = () => current === epoch && identity === identityEpoch && active() && canReadSummary();
  completingTasks.add(id); draft.error = ''; render('contacted');
  try {
    const client = window.GenieAuth.getClient();
    const run = () => client.rpc('genie_complete_task', { p_id: data.task.id, p_expected_version: data.task.version,
      p_outcome: draft.outcome, p_note: draft.note || null, p_next_due_at: nextDue });
    let response = await run();
    if (!valid()) return;
    if (response.status === 401) {
      const session = await window.GenieAuth.refresh();
      if (!session || !valid()) return;
      response = await run();
    }
    if (!valid()) return;
    if (response.error) throw Error('送出失敗');
    if (response.data?.status === 'completed') {
      await loadTasks([findLead(id)]);
      if (valid()) notice(`已完成：${taskTemplates.steps.get(stepIdentity(data.run, data.task.step_key)).label}`);
    } else if (['conflict', 'inactive', 'not_found'].includes(response.data?.status)) {
      const lead = await fetchLead(id);
      if (!valid()) return;
      const index = lists.contacted.items.findIndex(item => String(item.id) === id);
      if (index >= 0) lists.contacted.items[index] = lead;
      if (lead.contact_result === null) refresh(); else await loadTasks([lead]);
      if (identity === identityEpoch && active()) notice('這筆剛被更新，已重新整理');
    } else if (response.data?.status === 'invalid') {
      draft.error = '結果或下一步日期無效，請確認日期時間與備註（最多 500 字）';
    } else throw Error('送出失敗');
  } catch {
    if (valid()) draft.error = '送出失敗，請確認連線後重試';
  } finally {
    if (identity === identityEpoch) completingTasks.delete(id);
    if (valid()) render('contacted');
  }
}

/* ================= 待聯絡分級（不依賴名單頁 DOM） ================= */
function canReadSummary() { return window.GenieAuth.getState().status === 'member' && navigator.onLine; }
function completedTime(value) {
  const time = value ? Date.parse(value) : NaN;
  // Postgres 可回傳微秒；Date.parse 會截掉毫秒後的位數，需保留以免跨級。
  const fraction = typeof value === 'string' ? value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1] : null;
  return time + (fraction?.length > 3 ? Number(`0.${fraction.slice(3)}`) : 0);
}
function waitLevel(value, now) {
  const time = completedTime(value);
  if (!Number.isFinite(time)) return null;
  return waitLevels.find(level => now - time < level.hours * hourMs);
}
function renderSummary() {
  const button = $('[data-action="leads"]'), badge = $('#lead-nav-badge'), description = $('#lead-nav-description');
  badge.hidden = !summary || summary.total === 0;
  if (badge.hidden) { badge.innerHTML = ''; badge.className = 'lead-nav-badge'; }
  button.removeAttribute('aria-describedby');
  description.innerHTML = '';
  if (summary?.total) {
    const worst = waitLevels.slice().reverse().find(level => summary.counts[level.id] > 0);
    badge.className = `lead-nav-badge wait-${worst?.id || 'unknown'}`;
    badge.innerHTML = esc(summary.total > 99 ? '99+' : summary.total);
    description.innerHTML = esc(`待聯絡 ${summary.total} 位，${worst ? `最久 ${worst.label}` : '時間不明'}`);
    button.setAttribute('aria-describedby', description.id);
  }
  const target = root?.querySelector('[data-lead-summary]');
  if (!target) return;
  target.hidden = !summary;
  if (!summary) { target.innerHTML = ''; return; }
  target.innerHTML = `<strong>${esc(`待聯絡 ${summary.total} 位`)}</strong><div class="lead-wait-filters" role="group" aria-label="待聯絡時間篩選"><button type="button" data-lead-wait="all" aria-pressed="${pendingFilter === 'all'}">${esc('全部')}</button>${waitLevels.map(level => `<button type="button" class="wait-${esc(level.id)}" data-lead-wait="${esc(level.id)}" aria-pressed="${pendingFilter === level.id}">${esc(`${level.icon} ${level.label} ${summary.counts[level.id]}`)}</button>`).join('')}</div>${summary.unknown ? `<small>${esc(`時間不明 ${summary.unknown} 位（已計入待聯絡總數）`)}</small>` : ''}`;
}
function clearSummary() {
  ++summaryRequest;
  clearTimeout(summaryTimer);
  summary = null;
  renderSummary();
}
function requestSummary(now) {
  const current = ++summaryRequest;
  clearTimeout(summaryTimer);
  if (!canReadSummary()) { clearSummary(); return; }
  // 合併成員確認、進頁與同步完成等密集觸發；新觸發立即作廢舊回應。
  summaryTimer = setTimeout(() => loadSummary(current, now), 80);
}
async function loadSummary(current, now) {
  const uid = window.GenieAuth.getState().userId;
  const valid = () => current === summaryRequest && canReadSummary() && uid === window.GenieAuth.getState().userId;
  const next = { total: 0, unknown: 0, counts: Object.fromEntries(waitLevels.map(level => [level.id, 0])), now };
  try {
    const client = window.GenieAuth.getClient();
    for (let offset = 0; valid(); offset += summaryPageSize) {
      const run = () => client.from('customer_leads').select('id,completed_at').eq('status', 'complete').is('contact_result', null).order('id', { ascending: true }).range(offset, offset + summaryPageSize - 1);
      let response = await run();
      if (!valid()) return;
      if (response.status === 401) {
        const session = await window.GenieAuth.refresh();
        if (!session || !valid()) throw Error('名單驗證失敗');
        response = await run();
      }
      if (!valid()) return;
      if (response.error || !Array.isArray(response.data)) throw Error('待聯絡摘要讀取失敗');
      for (const row of response.data) {
        ++next.total;
        const level = waitLevel(row.completed_at, now);
        if (level) ++next.counts[level.id]; else ++next.unknown;
      }
      if (response.data.length < summaryPageSize) break;
    }
    if (!valid()) return;
    summary = next;
    totals.pending = next.total;
    renderSummary(); renderNavigation();
  } catch {
    if (valid()) clearSummary();
  }
}

function active() {
  const auth = window.GenieAuth.getState();
  return location.hash === '#/leads' && (auth.status === 'member' || (auth.status === 'offline' && auth.localAccess)) && root?.isConnected;
}
function relative(value, now = Date.now()) {
  const time = completedTime(value);
  if (!Number.isFinite(time)) return '—';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return '剛剛';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小時前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}
function timeHtml(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '—';
  const full = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `<time datetime="${esc(date.toISOString())}" title="${esc(full)}">${esc(relative(value))}</time>`;
}
function valueText(value) {
  if (Array.isArray(value)) return value.join('、') || '—';
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
function field(label, value) { return `<div><dt>${label}</dt><dd>${esc(valueText(value))}</dd></div>`; }
function notice(message, options) { window.GenieToast(message, options); }
function undoMinutes(lead) {
  const until = Date.parse(lead.contact_undo_until);
  return Number.isFinite(until) && until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0;
}
function findLead(id) { return Object.values(lists).flatMap(state => state.items).find(item => String(item.id) === String(id)); }
async function fetchLead(id) {
  if (window.GenieAuth.getState().status !== 'member') throw Error('離線');
  const client = window.GenieAuth.getClient();
  const run = () => client.from('customer_leads').select(columns).eq('id', id).eq('status', 'complete').maybeSingle();
  let response = await run();
  if (response.status === 401) {
    const refreshed = await window.GenieAuth.refresh().then(session=>({data:{session}})).catch(()=>({error:true}));
    if (refreshed.error || !refreshed.data?.session) throw Error('名單驗證失敗');
    response = await run();
  }
  if (response.error || !response.data) throw Error('名單讀取失敗');
  return response.data;
}
const countText = value => Number.isFinite(value) ? String(value) : '—';
function renderNavigation() {
  if (!root) return;
  for (const kind of Object.keys(sections)) {
    const tab = root.querySelector(`[data-lead-tab="${kind}"]`), panel = root.querySelector(`[data-lead-panel="${kind}"]`);
    tab.setAttribute('aria-selected', String(activeTab === kind));
    tab.tabIndex = activeTab === kind ? 0 : -1;
    panel.hidden = activeTab !== kind;
    root.querySelector(`[data-lead-count="${kind}"]`).textContent = countText(totals[kind]);
  }
  root.querySelectorAll('[data-lead-filter]').forEach(button => {
    const selected = button.dataset.leadFilter === selectedFilter;
    button.setAttribute('aria-pressed', String(selected));
    button.querySelector('[data-filter-count]').textContent = selected ? countText(filteredCount) : '';
  });
}
function card(lead, kind) {
  const phone = valueText(lead.phone);
  const tel = String(lead.phone ?? '').replace(/[^0-9+\-]/g, '');
  const contactTime = lead.answers && typeof lead.answers === 'object' ? lead.answers.contact_time : null;
  const level = kind === 'pending' ? waitLevel(lead.completed_at, pendingNow) : null;
  const waitTag = kind === 'pending' ? `<span class="lead-tag wait-${esc(level?.id || 'unknown')}">${esc(level ? `${level.icon} ${relative(lead.completed_at, pendingNow)}` : '時間不明')}</span>` : '';
  const grade = lead.lead_grade ? `<span class="lead-tag grade-${esc(lead.lead_grade)}">${esc(grades[lead.lead_grade] || lead.lead_grade)}</span>` : '';
  const phoneHtml = tel ? `<a href="tel:${esc(tel)}">${esc(phone)}</a>` : esc(phone);
  const messengerId = String(lead.messenger_user_id ?? '');
  const messenger = /^\d+$/.test(messengerId);
  const minutes = kind === 'contacted' ? undoMinutes(lead) : 0;
  const resultButtons = Object.entries(results).map(([value, label]) => `<button type="button" class="lead-result" data-lead-result="${esc(value)}" aria-pressed="${lead.contact_result === value}" ${saving.has(String(lead.id)) ? 'disabled' : ''}>${esc(label)}</button>`).join('');
  const existing = window.GenieProjects.projectsForLead(lead.id).length > 0;
  const createDisabled = creating.has(String(lead.id)) || (!existing && window.GenieAuth.getState().status !== 'member');
  return `<article class="lead-card" data-lead-id="${esc(lead.id)}">
    ${kind === 'contacted' ? `<strong class="lead-result-heading">${esc(results[lead.contact_result] || valueText(lead.contact_result))}</strong>` : ''}
    <div class="lead-card-top"><h3>${esc(valueText(lead.customer_name))}</h3><div class="lead-tags">${grade}${waitTag}${lead.notification_status === 'failed' ? '<span class="lead-tag lead-alert">通知信寄送失敗</span>' : ''}</div></div>
    <dl class="lead-fields">${field('服務', lead.project_type)}${field('地區', lead.location)}${field('坪數', lead.interior_area)}${field('預算', lead.budget_range)}${field('開始時間', lead.start_time)}${field('方便聯絡時段', contactTime)}<div><dt>姓名</dt><dd>${esc(valueText(lead.customer_name))}</dd></div><div><dt>電話</dt><dd>${phoneHtml}</dd></div><div><dt>送出時間</dt><dd>${timeHtml(lead.completed_at)}</dd></div>${kind === 'contacted' ? `<div><dt>聯絡結果</dt><dd>${esc(results[lead.contact_result] || valueText(lead.contact_result))}</dd></div><div><dt>結果時間</dt><dd>${timeHtml(lead.contact_result_at)}</dd></div>` : ''}</dl>
    <div class="lead-actions"><div class="lead-results" role="group" aria-label="聯絡結果">${resultButtons}</div>${minutes ? `<div class="lead-undo-wrap"><button type="button" class="lead-undo" data-lead-undo ${saving.has(String(lead.id)) ? 'disabled' : ''}>收回，改回待聯絡</button><span class="lead-undo-time">還可收回 ${minutes} 分鐘</span></div>` : ''}${messenger ? '<button type="button" class="lead-messenger" data-lead-messenger>💬 Messenger</button>' : ''}</div>
    ${kind === 'contacted' ? taskBlock(lead) : ''}
    <div class="lead-project-action"><button type="button" class="lead-project-button" data-lead-project ${createDisabled ? 'disabled' : ''}>${creating.has(String(lead.id)) ? '建立中…' : existing ? '開啟專案' : '帶入名單建立專案'}</button><span>儲存後同步到雲端</span></div>
  </article>`;
}
function render(kind) {
  if (!active()) return;
  const state = lists[kind], target = root.querySelector(`[data-lead-section="${kind}"]`);
  if (!target) return;
  if (kind === 'contacted') {
    const focused = document.activeElement;
    const id = focused?.closest('[data-task-confirm]')?.closest('.lead-card')?.dataset.leadId;
    const draft = taskDrafts.get(id);
    if (draft && target.contains(focused) && ['task_note', 'task_due'].includes(focused.name)) {
      taskFocus = { id, taskId: draft.taskId, name: focused.name, start: focused.selectionStart,
        end: focused.selectionEnd, direction: focused.selectionDirection };
    }
    if (taskFocus && taskDrafts.get(taskFocus.id)?.taskId !== taskFocus.taskId) taskFocus = null;
  }
  const empty = kind === 'pending' && pendingFilter !== 'all' ? '這一級目前沒有待聯絡的客人' : kind === 'contacted' && selectedFilter !== 'all' ? '目前篩選沒有資料' : sections[kind].empty;
  const content = state.items.map((item, index) => { try { return card(item, kind); } catch (error) { console.warn(`第 ${index + 1} 筆名單無法顯示`, error); return '<p class="lead-error" role="alert">一筆名單無法顯示，請重新整理</p>'; } }).join('') || (state.loading ? '<p class="lead-state" role="status">讀取中…</p>' : state.error ? '' : `<p class="lead-state">${esc(empty)}</p>`);
  // 只在同步替換 DOM 時保留失焦記錄；使用者失焦後立即重畫也不能誤判。
  replacingTaskDOM = kind === 'contacted';
  try {
    target.innerHTML = `<div class="lead-cards">${content}</div>${state.error ? '<p class="lead-error" role="alert">讀取失敗，請按重新整理</p>' : ''}${state.more && !state.error ? `<button type="button" class="lead-more" data-lead-more="${kind}" ${state.loading ? 'disabled' : ''}>${state.loading ? '讀取中…' : '載入更多'}</button>` : ''}`;
  } finally { replacingTaskDOM = false; }
  // refresh 的空白／讀取中畫面也保留焦點記錄，等同一待辦的確認區回來再還原。
  if (kind === 'contacted' && taskFocus) {
    const restore = taskFocus;
    const form = [...target.querySelectorAll('[data-task-confirm]')].find(form => form.closest('.lead-card').dataset.leadId === restore.id);
    const focused = form?.elements.namedItem(restore.name);
    if (focused && !focused.disabled) {
      // 記錄只供這次 DOM 移除還原；成功後不留下會再次搶焦點的舊記錄。
      taskFocus = null;
      focused.focus({ preventScroll: true });
      // datetime-local 不支援選取範圍；只有文字欄位才還原游標。
      if (restore.start !== null) focused.setSelectionRange(restore.start, restore.end, restore.direction);
    }
  }
}
async function query(kind, offset, filter = selectedFilter, head = false, wait = pendingFilter, now = pendingNow) {
  const client = window.GenieAuth.getClient(), section = sections[kind];
  const run = () => {
    let request = client.from('customer_leads').select(head ? 'id' : columns, offset === 0 ? { count: 'exact', ...(head ? { head: true } : {}) } : undefined).eq('status', 'complete');
    request = kind === 'pending' ? request.is('contact_result', null) : filter === 'all' ? request.not('contact_result', 'is', null) : request.eq('contact_result', filter);
    if (kind === 'pending' && wait !== 'all') {
      const index = waitLevels.findIndex(level => level.id === wait), level = waitLevels[index];
      // 完成時間越早，經過時間越久；門檻整點歸入較久的一級，無毫秒縫隙。
      if (Number.isFinite(level.hours)) request = request.gt('completed_at', new Date(now - level.hours * hourMs).toISOString());
      if (index > 0) request = request.lte('completed_at', new Date(now - waitLevels[index - 1].hours * hourMs).toISOString());
    }
    return head ? request : request.order(section.order, { ascending: section.ascending }).range(offset, offset + section.size - 1);
  };
  let response = await run();
  if (response.status === 401) {
    const refreshed = await window.GenieAuth.refresh().then(session=>({data:{session}})).catch(()=>({error:true}));
    if (refreshed.error || !refreshed.data?.session) {
      return null;
    }
    response = await run();
    if (response.status === 401) {
      return response;
    }
  }
  return response;
}
async function load(kind) {
  if (!active() || !canReadSummary()) return;
  const state = lists[kind];
  if (state.loading || !state.more) return;
  const current = epoch, offset = state.items.length, filter = selectedFilter;
  state.loading = true;
  state.error = false;
  render(kind);
  try {
    const response = await query(kind, offset, filter);
    if (current !== epoch || !active() || !response || state !== lists[kind]) return;
    if (response.error) throw response.error;
    const rows = Array.isArray(response.data) ? response.data : [];
    state.items.push(...rows);
    if (kind === 'contacted') loadTasks(rows);
    if (offset === 0) {
      const count = Number.isFinite(response.count) ? response.count : null;
      state.total = count;
      if (kind === 'pending' && pendingFilter === 'all') totals.pending = summary ? summary.total : count;
      if (kind === 'contacted') filteredCount = count;
      renderNavigation();
    }
    state.more = rows.length === sections[kind].size && (!Number.isFinite(state.total) || state.items.length < state.total);
  } catch {
    if (current !== epoch || !active() || state !== lists[kind]) return;
    state.error = true;
  } finally {
    if (current === epoch && active() && state === lists[kind]) { state.loading = false; render(kind); }
  }
}
async function loadContactedTotal() {
  const current = ++contactedTotalRequest;
  try {
    const response = await query('contacted', 0, 'all', true);
    if (current !== contactedTotalRequest || !active() || !response || response.error) return;
    totals.contacted = Number.isFinite(response.count) ? response.count : null;
    renderNavigation();
  } catch {} // 讀取失敗時保留上一次有效總數。
}
function refresh() {
  pendingNow = Date.now();
  requestSummary(pendingNow);
  if (!active()) return;
  ++epoch;
  clearTasks(true);
  lists = Object.fromEntries(Object.keys(sections).map(kind => [kind, { items: [], more: true, loading: false, error: false }]));
  renderNavigation();
  if (!canReadSummary()) { showOffline(); return; }
  Object.keys(sections).forEach(kind => { render(kind); load(kind); });
  loadContactedTotal();
}
function showOffline() {
  clearSummary();
  if (!active()) return;
  ++epoch; ++contactedTotalRequest;
  totals = { pending: null, contacted: null }; filteredCount = null;
  lists = Object.fromEntries(Object.keys(sections).map(kind => [kind, { items: [], more: false, loading: false, error: true }]));
  renderNavigation();
  Object.keys(sections).forEach(render);
}
function activate() {
  taskTemplates = null;
  root = $('#leads-list');
  if (root) {
    renderNavigation();
    renderSummary();
    refresh();
    clearInterval(undoTimer);
    undoTimer = setInterval(() => { if (active()) render('contacted'); }, 30000);
  }
}
function deactivate() { ++epoch; ++contactedTotalRequest; taskTemplates = null; clearTasks(); root = null; clearInterval(undoTimer); }
function refreshProjects() { if (active()) Object.keys(sections).forEach(render); }
async function saveResult(cardElement, value) {
  const id = cardElement.dataset.leadId;
  if (!id || !Object.hasOwn(results, value) || saving.has(id)) return;
  saving.add(id);
  const before = findLead(id);
  if (!before) { saving.delete(id); return; }
  cardElement.querySelectorAll('[data-lead-result],[data-lead-undo]').forEach(button => { button.disabled = true; });
  const current = epoch;
  const identity = identityEpoch;
  const client = window.GenieAuth.getClient();
  const run = () => {
    let request = client.from('customer_leads').update({ contact_result: value }).eq('id', id);
    request = before.contact_result === null ? request.is('contact_result', null) : request.eq('contact_result', before.contact_result).eq('contact_result_at', before.contact_result_at);
    return request.select(columns);
  };
  try {
    let response = await run();
    if (response.status === 401) {
      const refreshed = await window.GenieAuth.refresh().then(session=>({data:{session}})).catch(()=>({error:true}));
      if (refreshed.error || !refreshed.data?.session) { notice('無法連線，請稍後再試'); return; }
      response = await run();
      if (response.status === 401) { notice('無法連線，請稍後再試'); return; }
    }
    if (identity !== identityEpoch || !canReadSummary()) return;
    if (response.error) { if (current === epoch && active()) notice('儲存失敗，請稍後再試'); return; }
    if (!Array.isArray(response.data) || response.data.length === 0) { requestSummary(pendingNow); await changedNotice(id, current); return; }
    const saved = response.data[0];
    const showNotice = current === epoch && active();
    refresh();
    if (!showNotice) return;
    const hiddenByFilter = selectedFilter !== 'all' && selectedFilter !== value;
    notice(hiddenByFilter ? `已記錄為${results[value]}（目前篩選未顯示）` : `已記錄：${results[value]}`, undoMinutes(saved) ? { actionLabel: '收回', onAction: () => undoResult(saved) } : undefined);
  } catch {
    if (current === epoch && active()) notice('儲存失敗，請稍後再試');
  } finally {
    saving.delete(id);
    cardElement.querySelectorAll('[data-lead-result],[data-lead-undo]').forEach(button => { button.disabled = false; });
  }
}
async function changedNotice(id, current) {
  const client = window.GenieAuth.getClient();
  let label = '';
  try {
    const response = await client.from('customer_leads').select(columns).eq('id', id).maybeSingle();
    if (!response.error && response.data) label = results[response.data.contact_result] || (response.data.contact_result === null ? '待聯絡' : '');
  } catch {}
  if (current !== epoch || !active()) return;
  refresh();
  notice(label ? `這筆已經被記成${label}` : '這筆已被更新，請重新整理');
}
async function undoResult(lead) {
  const id = String(lead.id);
  if (saving.has(id) || !canReadSummary()) return;
  saving.add(id);
  root?.querySelectorAll('.lead-card').forEach(card => {
    if (card.dataset.leadId === id) card.querySelectorAll('[data-lead-result],[data-lead-undo]').forEach(button => { button.disabled = true; });
  });
  const current = epoch;
  const identity = identityEpoch;
  try {
    const client = window.GenieAuth.getClient();
    const run = () => client.rpc('genie_undo_contact_result', { p_id: lead.id, p_expected_result: lead.contact_result, p_expected_at: lead.contact_result_at });
    let response = await run();
    if (response.status === 401) {
      const refreshed = await window.GenieAuth.refresh().then(session=>({data:{session}})).catch(()=>({error:true}));
      if (refreshed.error || !refreshed.data?.session) { notice('無法連線，請稍後再試'); return; }
      response = await run();
      if (response.status === 401) { notice('無法連線，請稍後再試'); return; }
    }
    if (identity !== identityEpoch || !canReadSummary()) return;
    const showNotice = current === epoch && active();
    if (response.error) { if (showNotice) notice('收回失敗，請稍後再試'); return; }
    if (response.data === 'undone') { refresh(); if (showNotice) notice('已改回待聯絡'); }
    else if (response.data === 'changed') { requestSummary(pendingNow); await changedNotice(id, current); }
    else if (response.data === 'expired') { refresh(); if (showNotice) notice('已超過 15 分鐘，無法收回'); }
    else if (showNotice) notice('收回失敗，請稍後再試');
  } catch {
    if (current === epoch && active()) notice('收回失敗，請稍後再試');
  } finally {
    saving.delete(id);
    root?.querySelectorAll('.lead-card').forEach(card => {
      if (card.dataset.leadId === id) card.querySelectorAll('[data-lead-result],[data-lead-undo]').forEach(button => { button.disabled = false; });
    });
  }
}
async function openMessenger(lead) {
  if (!/^\d+$/.test(String(lead.messenger_user_id ?? ''))) return;
  const config = window.GENIE_CONFIG;
  const url = `https://business.facebook.com/latest/inbox/all/?asset_id=${encodeURIComponent(config.metaPageId)}&business_id=${encodeURIComponent(config.metaBusinessId)}`;
  window.open(url, '_blank', 'noopener');
  const name = valueText(lead.customer_name);
  try {
    await navigator.clipboard.writeText(name);
    notice(`已複製「${name}」，到收件匣搜尋欄貼上`);
  } catch { notice(`請到收件匣搜尋：${name}`); }
}
async function createProject(cardElement) {
  const id = cardElement?.dataset.leadId;
  if (!id || creating.has(id)) return;
  if (window.GenieProjects.openLeadProject(id)) return;
  if (window.GenieAuth.getState().status !== 'member') { notice('離線時無法建立專案'); return; }
  creating.add(id);
  const button = cardElement.querySelector('[data-lead-project]');
  button.disabled = true;
  button.textContent = '建立中…';
  try {
    await window.GenieSync.sync();
    if (window.GenieProjects.openLeadProject(id)) { notice('這位客人已有專案'); return; }
    const lead = await fetchLead(id);
    if (!active()) { notice('已取消建立（離開了客戶名單）'); return; }
    if (window.GenieProjects.openLeadProject(id)) return;
    const result = window.GenieProjects.createFromLead(lead);
    if (result.error) notice(result.error);
  } catch {
    notice(active()?'名單讀取失敗，請稍後再試':'已取消建立（離開了客戶名單）');
  } finally {
    creating.delete(id);
    if (active()) render(activeTab);
  }
}
$('#leads-view').addEventListener('click', event => {
  const taskOutcome = event.target.closest('[data-task-outcome]');
  if (taskOutcome) {
    const id = taskOutcome.closest('.lead-card').dataset.leadId, data = taskRows.get(id);
    if (data?.task && !completingTasks.has(id)) {
      taskDrafts.set(id, { taskId: data.task.id, outcome: taskOutcome.dataset.taskOutcome, note: '', due: '', error: '' });
      render('contacted');
    }
    return;
  }
  const taskCancel = event.target.closest('[data-task-cancel]');
  if (taskCancel) { const id = taskCancel.closest('.lead-card').dataset.leadId; if (!completingTasks.has(id)) { taskDrafts.delete(id); render('contacted'); } return; }
  const tab = event.target.closest('[data-lead-tab]');
  if (tab) { activeTab = tab.dataset.leadTab; renderNavigation(); $('main').scrollTop = 0; tab.focus(); return; }
  const wait = event.target.closest('[data-lead-wait]');
  if (wait) {
    pendingFilter = pendingFilter === wait.dataset.leadWait ? 'all' : wait.dataset.leadWait;
    lists.pending = { items: [], more: true, loading: false, error: false };
    renderSummary(); render('pending'); load('pending');
    root.querySelector(`[data-lead-wait="${pendingFilter}"]`)?.focus();
    return;
  }
  const filter = event.target.closest('[data-lead-filter]');
  if (filter) {
    if (selectedFilter === filter.dataset.leadFilter) return;
    selectedFilter = filter.dataset.leadFilter;
    filteredCount = null;
    lists.contacted = { items: [], more: true, loading: false, error: false };
    renderNavigation(); render('contacted'); load('contacted');
    return;
  }
  const result = event.target.closest('[data-lead-result]');
  if (result) { saveResult(result.closest('.lead-card'), result.dataset.leadResult); return; }
  const project = event.target.closest('[data-lead-project]');
  if (project) { createProject(project.closest('.lead-card')); return; }
  const undo = event.target.closest('[data-lead-undo]');
  if (undo) { const lead = findLead(undo.closest('.lead-card')?.dataset.leadId); if (lead) undoResult(lead); return; }
  const messenger = event.target.closest('[data-lead-messenger]');
  if (messenger) { const lead = findLead(messenger.closest('.lead-card')?.dataset.leadId); if (lead) openMessenger(lead); return; }
  const kind = event.target.closest('[data-lead-more]')?.dataset.leadMore;
  if (kind && sections[kind]) load(kind);
});
$('#leads-view').addEventListener('input', event => {
  if (!event.target.closest('[data-task-confirm]')) return;
  const draft = taskDrafts.get(event.target.closest('.lead-card').dataset.leadId);
  if (draft) { if (event.target.name === 'task_note') draft.note = event.target.value; if (event.target.name === 'task_due') draft.due = event.target.value; }
});
document.addEventListener('focusin', () => {
  // 包含同一確認區或另一張卡的控制項；重畫還原已先取出自己的記錄。
  taskFocus = null;
});
document.addEventListener('focusout', () => {
  if (!replacingTaskDOM) taskFocus = null;
});
document.addEventListener('pointerdown', () => {
  // refresh 等待時欄位已不在 DOM，點空白處不一定有 focusout。
  taskFocus = null;
});
$('#leads-view').addEventListener('submit', event => {
  if (event.target.matches('[data-task-confirm]')) { event.preventDefault(); completeTask(event.target); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', refresh);
window.addEventListener('offline', showOffline);
window.GenieAuth.subscribe(auth => {
  if (auth.userId !== authIdentity) {
    ++identityEpoch; ++epoch;
    taskTemplates = null; clearTasks(); completingTasks.clear();
    authIdentity = auth.userId;
    activeTab = 'pending'; selectedFilter = pendingFilter = 'all';
    totals = { pending: null, contacted: null }; filteredCount = null;
    clearSummary();
  }
  if (auth.status !== 'member' || !navigator.onLine) clearSummary();
  else if (authStatus !== 'member' || !summary) refresh();
  authStatus = auth.status;
});
window.GenieLeads = { activate, deactivate, refresh, showOffline, fetchLead, refreshProjects };
})();
