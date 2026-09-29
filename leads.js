'use strict';
(() => {
/* ================= 客戶名單（唯讀） ================= */
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const columns = 'id,status,answers,customer_name,phone,project_type,location,interior_area,budget_range,start_time,completed_at,contact_result,contact_result_at,contact_first_at,lead_grade,notification_status';
const sections = {
  pending: { size: 50, order: 'completed_at', ascending: true, empty: '目前沒有待聯絡的客戶' },
  contacted: { size: 20, order: 'contact_result_at', ascending: false, empty: '還沒有已聯絡的客戶' },
};
const results = { contacted: '已聯絡', site_visit: '約丈量', not_interested: '沒興趣', unreachable: '聯絡不上' };
const grades = { hot: '🔥 高分', normal: '一般', low: '低' };
let epoch = 0;
let lists = {};
let root = null;

function active() { return location.hash === '#/leads' && window.GenieAuth.getState().status === 'member' && root?.isConnected; }
function relative(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
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
function card(lead, kind) {
  const phone = valueText(lead.phone);
  const tel = String(lead.phone ?? '').replace(/[^0-9+\-]/g, '');
  const contactTime = lead.answers && typeof lead.answers === 'object' ? lead.answers.contact_time : null;
  const overdue = kind === 'pending' && Number.isFinite(Date.parse(lead.completed_at)) && Date.now() - Date.parse(lead.completed_at) > 3 * 86400000;
  const grade = lead.lead_grade ? `<span class="lead-tag grade-${esc(lead.lead_grade)}">${esc(grades[lead.lead_grade] || lead.lead_grade)}</span>` : '';
  const phoneHtml = tel ? `<a href="tel:${esc(tel)}">${esc(phone)}</a>` : esc(phone);
  return `<article class="lead-card" data-lead-id="${esc(lead.id)}">
    <div class="lead-card-top"><h3>${esc(valueText(lead.customer_name))}</h3><div class="lead-tags">${grade}${overdue ? '<span class="lead-tag lead-alert">超過 3 天未聯絡</span>' : ''}${lead.notification_status === 'failed' ? '<span class="lead-tag lead-alert">通知信寄送失敗</span>' : ''}</div></div>
    <dl class="lead-fields">${field('服務', lead.project_type)}${field('地區', lead.location)}${field('坪數', lead.interior_area)}${field('預算', lead.budget_range)}${field('開始時間', lead.start_time)}${field('方便聯絡時段', contactTime)}<div><dt>姓名</dt><dd>${esc(valueText(lead.customer_name))}</dd></div><div><dt>電話</dt><dd>${phoneHtml}</dd></div><div><dt>送出時間</dt><dd>${timeHtml(lead.completed_at)}</dd></div>${kind === 'contacted' ? `<div><dt>聯絡結果</dt><dd>${esc(results[lead.contact_result] || valueText(lead.contact_result))}</dd></div><div><dt>結果時間</dt><dd>${timeHtml(lead.contact_result_at)}</dd></div>` : ''}</dl>
  </article>`;
}
function render(kind) {
  if (!active()) return;
  const state = lists[kind], target = root.querySelector(`[data-lead-section="${kind}"]`);
  if (!target) return;
  const content = state.items.map(item => card(item, kind)).join('') || (state.loading ? '<p class="lead-state" role="status">讀取中…</p>' : state.error ? '' : `<p class="lead-state">${sections[kind].empty}</p>`);
  target.innerHTML = `<div class="lead-cards">${content}</div>${state.error ? '<p class="lead-error" role="alert">讀取失敗，請按重新整理</p>' : ''}${state.more && !state.error ? `<button type="button" class="lead-more" data-lead-more="${kind}" ${state.loading ? 'disabled' : ''}>${state.loading ? '讀取中…' : '載入更多'}</button>` : ''}`;
}
async function query(kind, offset) {
  const client = window.GenieAuth.getClient(), section = sections[kind];
  const run = () => {
    let request = client.from('customer_leads').select(columns).eq('status', 'complete');
    request = kind === 'pending' ? request.is('contact_result', null) : request.not('contact_result', 'is', null);
    return request.order(section.order, { ascending: section.ascending }).range(offset, offset + section.size - 1);
  };
  let response = await run();
  if (response.status === 401) {
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error || !refreshed.data?.session) {
      await window.GenieAuth.signOut();
      return null;
    }
    response = await run();
    if (response.status === 401) {
      await window.GenieAuth.signOut();
      return null;
    }
  }
  return response;
}
async function load(kind) {
  if (!active()) return;
  const state = lists[kind];
  if (state.loading || !state.more) return;
  const current = epoch, offset = state.items.length;
  state.loading = true;
  state.error = false;
  render(kind);
  try {
    const response = await query(kind, offset);
    if (current !== epoch || !active() || !response) return;
    if (response.error) throw response.error;
    const rows = Array.isArray(response.data) ? response.data : [];
    state.items.push(...rows);
    state.more = rows.length === sections[kind].size;
  } catch {
    if (current !== epoch || !active()) return;
    state.error = true;
  } finally {
    if (current === epoch && active()) { state.loading = false; render(kind); }
  }
}
function refresh() {
  if (!active()) return;
  ++epoch;
  lists = Object.fromEntries(Object.keys(sections).map(kind => [kind, { items: [], more: true, loading: false, error: false }]));
  Object.keys(sections).forEach(kind => { render(kind); load(kind); });
}
function activate() {
  root = $('#leads-list');
  if (root) refresh();
}
function deactivate() { ++epoch; root = null; }
$('#leads-view').addEventListener('click', event => {
  const kind = event.target.closest('[data-lead-more]')?.dataset.leadMore;
  if (kind && sections[kind]) load(kind);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.GenieLeads = { activate, deactivate, refresh };
})();
