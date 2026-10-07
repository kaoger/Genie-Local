'use strict';
const { test: base, expect } = require('@playwright/test');
const {createCloud,cloudRoute}=require('./mock-cloud');

const SELECT = 'id,status,answers,customer_name,phone,project_type,location,interior_area,budget_range,start_time,completed_at,contact_result,contact_result_at,contact_first_at,contact_undo_until,lead_grade,notification_status,messenger_user_id';
const email = 'member@example.test';
const user = { id: '00000000-0000-4000-8000-000000000001', email, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated' };
const session = (identity = user, now = Date.now()) => ({ access_token: 'member-access-token', refresh_token: 'member-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user: identity });
const lead = (id, extra = {}) => ({ id, status: 'complete', answers: { contact_time: ['平日晚上'] }, customer_name: `客戶 ${id}`, phone: '0912 345-678', project_type: '居家裝潢設計', location: '台中市', interior_area: 35, budget_range: '100–200 萬', start_time: '下個月', completed_at: new Date(Date.now() - 4 * 86400000).toISOString(), contact_result: null, contact_result_at: null, contact_first_at: null, contact_undo_until: null, lead_grade: 'hot', notification_status: 'failed', ...extra });
const taskSteps = [
  ['site_visit', 'confirm_visit', '確認丈量時間', 'offset', 24],
  ['site_visit', 'measure', '到場丈量', 'input', null],
  ['site_visit', 'quote', '整理資料並報價', 'offset', 72],
  ['contacted', 'interest', '追蹤意願', 'offset', 72],
  ['contacted', 'follow_up', '再次追蹤', 'offset', 168],
].map(([playbook_key, step_key, label, due_kind, hours], sort) => ({ playbook_key, version: 1, step_key, label, due_kind, hours, sort }));
const taskTransitions = [
  ['site_visit', 'confirm_visit', 'scheduled', '已約好時間', 'measure'],
  ['site_visit', 'confirm_visit', 'cancelled', '客人取消', null],
  ['site_visit', 'measure', 'measured', '已丈量', 'quote'],
  ['site_visit', 'measure', 'missed', '沒丈量到', null],
  ['site_visit', 'quote', 'quoted', '已報價', null],
  ['contacted', 'interest', 'interested', '有興趣', 'follow_up'],
  ['contacted', 'interest', 'not_interested', '沒興趣', null],
  ['contacted', 'follow_up', 'followed', '已追蹤', null],
].map(([playbook_key, step_key, outcome_key, outcome_label, next_step_key], sort) => ({ playbook_key, version: 1, step_key, outcome_key, outcome_label, next_step_key, sort }));
function startTaskRun(api, row) {
  const old = api.taskRuns.find(run => run.lead_id === row.id && run.status === 'active');
  if (old) {
    old.status = row.contact_result === null ? 'undone' : 'superseded';
    api.tasks.filter(task => task.run_id === old.id && task.status === 'open').forEach(task => { task.status = 'cancelled'; ++task.version; });
  }
  const step = api.taskSteps.find(step => step.playbook_key === row.contact_result && step.due_kind === 'offset');
  if (!step) return;
  const run_no = Math.max(0, ...api.taskRuns.filter(run => run.lead_id === row.id).map(run => run.run_no)) + 1;
  const run = { id: `run-${row.id}-${run_no}`, lead_id: row.id, run_no, playbook_key: step.playbook_key, version: 1, source_result: row.contact_result, status: 'active' };
  api.taskRuns.push(run);
  api.tasks.push({ id: `task-${row.id}-${run_no}`, run_id: run.id, lead_id: row.id, step_key: step.step_key, status: 'open', version: 1,
    due_at: new Date(Date.parse(row.contact_result_at) + step.hours * 3600000).toISOString() });
}
// 以整數微秒模擬資料庫比較，獨立於前端的毫秒數值分級。
function timestamp(value) {
  const ms = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return null;
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1] || '';
  return BigInt(ms) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}

const test = base.extend({
  api: [async ({ page }, use) => {
    const cloud=createCloud();
    const api = { user, memberFails: false, rows: [], requests: [], patches: [], rpcs: [], rpcResult: 'undone', rpcUnauthorized: false, fail: false, patchStatus: 200, unauthorized: false, unauthorizedMethod: null, refreshes: 0, refreshFails: false, holdReads: false, readWaiters: [], summaries: [], holdSummary: null, holdPatch: null, holdRpc: null, rpcStatus: 200, invalidCount: false };
    Object.assign(api, { tasks: [], taskRuns: [], taskErrors: [], taskSteps: structuredClone(taskSteps), taskTransitions: structuredClone(taskTransitions),
      taskReads: [], taskRpcs: [], taskRpcResult: null, taskRpcStatus: 200, taskReadStatus: 200, taskUnauthorized: 0, holdTaskRead: null, holdTaskRpc: null });
    await page.route('https://llqwzrgzekalwdnetvyb.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/genie_projects' || /\/rpc\/genie_(save|delete|restore)_project$/.test(url.pathname)) return cloudRoute(route,cloud,headers);
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return route.fulfill({ status: 200, headers, body: JSON.stringify(session(api.user, api.authNow)) });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        api.refreshes++;
        return route.fulfill({ status: api.refreshFails ? 400 : 200, headers, body: JSON.stringify(api.refreshFails ? { error: 'invalid_grant', error_description: 'Refresh token expired' } : session(api.user, api.authNow)) });
      }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/app_admins') return route.fulfill({ status: api.memberFails ? 500 : 200, headers, body: api.memberFails ? '{"message":"offline"}' : '[{"display_name":"測試成員","active":true}]' });
      if (url.pathname === '/rest/v1/rpc/genie_complete_task') {
        const body = JSON.parse(request.postData());
        api.taskRpcs.push(body);
        if (api.holdTaskRpc) await api.holdTaskRpc(body);
        if (api.taskUnauthorized > 0) { --api.taskUnauthorized; return route.fulfill({ status: 401, headers, body: '{"message":"expired"}' }); }
        if (api.taskRpcStatus !== 200) return route.fulfill({ status: api.taskRpcStatus, headers, body: '{"message":"task failed"}' });
        const task = api.tasks.find(task => task.id === body.p_id), run = api.taskRuns.find(run => run.id === task?.run_id);
        let status = api.taskRpcResult || (!task ? 'not_found' : run?.status !== 'active' || task.status !== 'open' ? 'inactive' : task.version !== body.p_expected_version ? 'conflict' : 'completed');
        const transition = api.taskTransitions.find(item => item.playbook_key === run?.playbook_key && item.step_key === task?.step_key && item.outcome_key === body.p_outcome);
        const nextStep = api.taskSteps.find(step => step.playbook_key === run?.playbook_key && step.step_key === transition?.next_step_key);
        if (status === 'completed' && (!transition || (nextStep?.due_kind === 'input' && !body.p_next_due_at))) status = 'invalid';
        let next_task_id = null;
        if (status === 'completed') {
          task.status = 'done'; task.note = body.p_note; task.outcome = body.p_outcome; ++task.version;
          if (nextStep) {
            next_task_id = `${task.id}-next`;
            api.tasks.push({ id: next_task_id, run_id: run.id, lead_id: task.lead_id, step_key: nextStep.step_key, version: 1, status: 'open',
              due_at: nextStep.due_kind === 'input' ? body.p_next_due_at : new Date((api.authNow ?? Date.now()) + nextStep.hours * 3600000).toISOString() });
          } else run.status = 'finished';
        }
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ status, version: task?.version || null, next_task_id }) });
      }
      const taskTable = url.pathname.split('/').pop();
      const embedded = url.pathname === '/rest/v1/customer_leads' && url.searchParams.get('select')?.includes('lead_playbook_runs(');
      if (['lead_tasks', 'lead_playbook_steps', 'lead_playbook_transitions'].includes(taskTable) || embedded) {
        api.taskReads.push(url);
        // 保存請求當下快照，才能測試晚到回應不覆蓋新身分／新頁面。
        const ids = (url.searchParams.get(embedded ? 'id' : 'lead_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(id => id.replace(/^"|"$/g, ''));
        let rows = embedded ? api.rows.filter(row => ids.includes(row.id)).map(row => ({ id: row.id,
          lead_playbook_runs: api.taskRuns.filter(run => run.lead_id === row.id).sort((a, b) => b.run_no - a.run_no).slice(0, 1),
          lead_task_errors: api.taskErrors.filter(error => error.lead_id === row.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 1) }))
          : taskTable === 'lead_tasks' ? api.tasks.filter(task => ids.includes(task.lead_id) && task.status === 'open')
          : taskTable === 'lead_playbook_steps' ? api.taskSteps : api.taskTransitions;
        if (!embedded && taskTable !== 'lead_tasks') rows = rows.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 1000));
        rows = structuredClone(rows);
        if (api.holdTaskRead) await api.holdTaskRead(url);
        if (api.taskReadStatus !== 200) return route.fulfill({ status: api.taskReadStatus, headers, body: '{"message":"task read failed"}' });
        return route.fulfill({ status: 200, headers, body: JSON.stringify(rows) });
      }
      if (url.pathname === '/rest/v1/rpc/genie_undo_contact_result') {
        const body = JSON.parse(request.postData());
        api.rpcs.push(body);
        if (api.holdRpc) await api.holdRpc();
        if (api.rpcStatus !== 200) return route.fulfill({ status: api.rpcStatus, headers, body: '{"message":"undo failed"}' });
        if (api.rpcUnauthorized === true || api.rpcUnauthorized > 0) {
          if (typeof api.rpcUnauthorized === 'number') api.rpcUnauthorized--;
          return route.fulfill({ status: 401, headers, body: '{"code":"PGRST301","message":"JWT expired"}' });
        }
        if (api.rpcResult === 'undone') {
          const row = api.rows.find(item => item.id === body.p_id);
          if (row) { row.contact_result = null; row.contact_result_at = null; row.contact_undo_until = null; startTaskRun(api, row); }
        }
        return route.fulfill({ status: 200, headers, body: JSON.stringify(api.rpcResult) });
      }
      if (url.pathname === '/rest/v1/customer_leads') {
        const summary = url.searchParams.get('select') === 'id,completed_at';
        if (request.method() === 'PATCH') api.patches.push({ url, body: request.postData(), headers: request.headers() });
        else (summary ? api.summaries : api.requests).push({ url, method: request.method(), headers: request.headers() });
        if ((api.unauthorized === true || api.unauthorized > 0) && (!api.unauthorizedMethod || request.method() === api.unauthorizedMethod)) {
          if (typeof api.unauthorized === 'number') api.unauthorized--;
          return route.fulfill({ status: 401, headers, body: '{"code":"PGRST301","message":"JWT expired"}' });
        }
        if (request.method() === 'PATCH') {
          if (api.holdPatch) await api.holdPatch();
          if (api.patchStatus === 500) return route.fulfill({ status: 500, headers, body: '{"message":"write failed"}' });
          if (api.patchStatus === 0) return route.fulfill({ status: 200, headers, body: '[]' });
          const row = api.rows.find(item => item.id === url.searchParams.get('id')?.replace(/^eq\./, ''));
          if (!row) return route.fulfill({ status: 200, headers, body: '[]' });
          if (url.searchParams.get('contact_result') !== (row.contact_result === null ? 'is.null' : `eq.${row.contact_result}`)) return route.fulfill({ status: 200, headers, body: '[]' });
          if (row.contact_result !== null && url.searchParams.get('contact_result_at') !== `eq.${row.contact_result_at}`) return route.fulfill({ status: 200, headers, body: '[]' });
          const first = row.contact_result === null, changed = row.contact_result !== JSON.parse(request.postData()).contact_result;
          row.contact_result = JSON.parse(request.postData()).contact_result;
          row.contact_result_at = new Date(api.authNow ?? Date.now()).toISOString();
          row.contact_undo_until = first ? new Date((api.authNow ?? Date.now()) + 15 * 60000).toISOString() : null;
          if (changed) startTaskRun(api, row);
          return route.fulfill({ status: 200, headers, body: JSON.stringify([row]) });
        }
        if (api.fail) return route.fulfill({ status: 500, headers, body: '{"message":"read failed"}' });
        if (url.searchParams.has('id')) {
          const row = api.rows.find(item => item.id === url.searchParams.get('id')?.replace(/^eq\./, ''));
          if (api.holdLead) await api.holdLead();
          return route.fulfill({ status: 200, headers, body: JSON.stringify(row ? [row] : []) });
        }
        if (api.holdReads && !summary) await new Promise(resolve => api.readWaiters.push({ url, method: request.method(), release: resolve }));
        const resultFilter = url.searchParams.get('contact_result');
        const pending = resultFilter === 'is.null';
        let rows = api.rows.filter(row => row.status === url.searchParams.get('status')?.replace(/^eq\./, '') && (pending ? row.contact_result === null : resultFilter === 'not.is.null' ? row.contact_result !== null : row.contact_result === resultFilter?.replace(/^eq\./, '')));
        for (const condition of url.searchParams.getAll('completed_at')) {
          const dot = condition.indexOf('.'), operator = condition.slice(0, dot), time = timestamp(condition.slice(dot + 1));
          rows = rows.filter(row => {
            const value = timestamp(row.completed_at);
            return value !== null && time !== null && (operator === 'gte' ? value >= time : operator === 'gt' ? value > time : operator === 'lte' ? value <= time : operator === 'lt' ? value < time : false);
          });
        }
        for (const order of (url.searchParams.get('order') || '').split(',').reverse()) {
          const [field, direction] = order.split('.');
          rows.sort((a, b) => {
            if (a[field] == null || b[field] == null) return a[field] == null ? (b[field] == null ? 0 : 1) : -1;
            const comparison = field.endsWith('_at') && timestamp(a[field]) !== null && timestamp(b[field]) !== null
              ? (timestamp(a[field]) < timestamp(b[field]) ? -1 : timestamp(a[field]) > timestamp(b[field]) ? 1 : 0)
              : String(a[field]).localeCompare(String(b[field]));
            return direction === 'desc' ? -comparison : comparison;
          });
        }
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || (pending ? 50 : 20));
        const fields = url.searchParams.get('select').split(',');
        const ranged = rows.slice(offset, offset + limit).map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
        if (summary && api.holdSummary) await api.holdSummary({ url, rows: ranged });
        const total = api.invalidCount ? 'invalid' : rows.length;
        return route.fulfill({ status: 200, headers: { ...headers, 'content-range': ranged.length ? `${offset}-${offset + ranged.length - 1}/${total}` : `*/${total}`, 'access-control-expose-headers': 'content-range' }, body: request.method() === 'HEAD' ? '' : JSON.stringify(ranged) });
      }
      return route.fulfill({ status: 500, headers, body: '{}' });
    });
    await page.goto('/');
    await expect(page.locator('#leads-login')).toBeVisible();
    await use(api);
  }, { auto: true }],
});

async function login(page) {
  await page.locator('#leads-login [name="email"]').fill(email);
  await page.locator('#leads-login [name="password"]').fill('test-password');
  await page.locator('#leads-login button[type="submit"]').click();
  if (new URL(page.url()).hash !== '#/leads') {
    await expect(page.locator('#list-view')).toBeVisible();
    await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  }
  await expect(page.locator('#leads-list')).toBeVisible();
}
async function showContacted(page) { await page.locator('[data-lead-tab="contacted"]').click(); }
async function showPending(page) { await page.locator('[data-lead-tab="pending"]').click(); }
function releaseRead(api, method, filter) {
  const index = api.readWaiters.findIndex(waiter => waiter.method === method && waiter.url.searchParams.get('contact_result') === filter);
  expect(index).toBeGreaterThanOrEqual(0);
  api.readWaiters.splice(index, 1)[0].release();
}

module.exports = { test, expect, SELECT, lead, login, showContacted, showPending, releaseRead };
