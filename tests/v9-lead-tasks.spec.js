'use strict';
const { test, expect, lead, login, showContacted } = require('./mock-leads');

// 同一畫面在美西裝置仍須顯示台北 10/8 00:30 的日期邊界。
test.use({ timezoneId: 'America/Los_Angeles' });
const NOW = '2026-10-07T16:30:00.000Z';
function seed(api, id = 'workflow', extra = {}) {
  const result = extra.result || 'site_visit';
  api.rows.push(lead(id, { contact_result: result, contact_result_at: '2026-10-07T12:00:00.000Z', notification_status: 'sent', ...extra.lead }));
  api.taskRuns.push({ id: `run-${id}`, lead_id: id, run_no: 1, playbook_key: result, version: 1, source_result: result, status: 'active', ...extra.run });
  api.tasks.push({ id: `task-${id}`, run_id: `run-${id}`, lead_id: id, step_key: result === 'contacted' ? 'interest' : 'confirm_visit', status: 'open', version: 1, due_at: '2026-10-09T06:00:00.000Z', ...extra.task });
  return id;
}
const card = (page, id = 'workflow') => page.locator(`[data-lead-panel="contacted"] [data-lead-id="${id}"]`);
async function enter(page, api) {
  api.authNow = Date.parse(NOW);
  await page.clock.setFixedTime(new Date(NOW));
  await login(page); await showContacted(page);
}
async function choose(page, label, id = 'workflow') {
  await card(page, id).getByRole('button', { name: label, exact: true }).click();
  await expect(card(page, id).locator('[data-task-confirm]')).toBeVisible();
}

async function fillDraft(page) {
  await choose(page, '已約好時間');
  await card(page).locator('[name="task_note"]').fill('保留確認區的測試備註');
  await card(page).locator('[name="task_due"]').fill('2026-10-10T14:30');
}
async function expectDraft(page) {
  await expect(card(page).locator('[data-task-confirm]')).toContainText('確認結果：已約好時間');
  await expect(card(page).locator('[name="task_note"]')).toHaveValue('保留確認區的測試備註');
  await expect(card(page).locator('[name="task_due"]')).toHaveValue('2026-10-10T14:30');
}
async function selectNote(page) {
  await card(page).locator('[name="task_note"]').evaluate(input => { input.focus(); input.setSelectionRange(2, 6, 'backward'); });
}
async function expectNoteFocus(page) {
  const input = card(page).locator('[name="task_note"]');
  await expect(input).toBeFocused();
  expect(await input.evaluate(input => [input.selectionStart, input.selectionEnd, input.selectionDirection])).toEqual([2, 6, 'backward']);
}

for (const name of ['task_note', 'task_due']) test(`30 秒重畫後 ${name} 保留焦點、輸入值及文字選取範圍`, async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page);
  if (name === 'task_note') await selectNote(page);
  else await card(page).locator('[name="task_due"]').focus();
  const original = await card(page).locator(`[name="${name}"]`).elementHandle();
  await page.clock.runFor(30000);
  // 確認真的換過 DOM，避免只檢查未觸發計時器的原欄位。
  expect(await original.evaluate(input => input.isConnected)).toBe(false);
  await expectDraft(page);
  await expect(card(page).locator(`[name="${name}"]`)).toBeFocused();
  if (name === 'task_note') await expectNoteFocus(page);
});

test('手機備註重畫後點卡片空白處，下一次計時器不搶回焦點且保留草稿', async ({ page, api }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  seed(api); await enter(page, api); await fillDraft(page); await selectNote(page);
  await page.evaluate(() => window.GenieLeads.refreshProjects());
  await expectNoteFocus(page);
  // 非控制項的卡片標題代表點擊空白處，焦點回到 body。
  await card(page).locator('h3').click();
  await expect(page.locator('body')).toBeFocused();
  const original = await card(page).locator('[name="task_note"]').elementHandle();
  await page.clock.runFor(30000);
  expect(await original.evaluate(input => input.isConnected)).toBe(false);
  await expectDraft(page);
  await expect(card(page).locator('[name="task_note"]')).not.toBeFocused();
  await expect(page.locator('body')).toBeFocused();
});

test('A 卡備註移到 B 卡結果按鈕，立即及定時重畫都不搶回 A 焦點', async ({ page, api }) => {
  seed(api); seed(api, 'second'); await enter(page, api); await fillDraft(page); await selectNote(page);
  await page.evaluate(() => window.GenieLeads.refreshProjects());
  await expectNoteFocus(page);
  const original = await card(page).locator('[name="task_note"]').elementHandle();
  await choose(page, '客人取消', 'second');
  expect(await original.evaluate(input => input.isConnected)).toBe(false);
  await expect(card(page).locator('[name="task_note"]')).not.toBeFocused();
  await page.clock.runFor(30000);
  await expectDraft(page);
  await expect(card(page).locator('[name="task_note"]')).not.toBeFocused();
  await expect(card(page, 'second').locator('[data-task-confirm]')).toContainText('確認結果：客人取消');
});

test('按 Tab 離開確認區欄位後，重畫不把焦點拉回備註', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  const note = card(page).locator('[name="task_note"]');
  await note.fill('Tab 離開測試');
  await page.evaluate(() => window.GenieLeads.refreshProjects());
  await expect(note).toBeFocused();
  await note.press('Tab');
  await expect(card(page).getByRole('button', { name: '確定', exact: true })).toBeFocused();
  await page.clock.runFor(30000);
  await expect(note).not.toBeFocused();
  await expect(note).toHaveValue('Tab 離開測試');
});

test('主動 blur 後同一 tick 重畫，不誤認為 DOM 移除而還原焦點', async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page); await selectNote(page);
  await page.evaluate(() => {
    window.GenieLeads.refreshProjects();
    document.activeElement.blur();
    window.GenieLeads.refreshProjects();
  });
  await expectDraft(page);
  await expect(page.locator('body')).toBeFocused();
});

test('重新整理等待期間點空白處，晚到待辦保留草稿但不還原焦點', async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page); await selectNote(page);
  let release;
  api.holdTaskRead = url => { if (url.pathname.endsWith('/lead_tasks')) return new Promise(resolve => { release = resolve; }); };
  await page.evaluate(() => window.GenieLeads.refresh());
  await expect.poll(() => typeof release).toBe('function');
  await card(page).locator('h3').click();
  await expect(page.locator('body')).toBeFocused();
  release();
  await expectDraft(page);
  await expect(card(page).locator('[name="task_note"]')).not.toBeFocused();
});

test('載入更多的晚到待辦批次重畫，不打斷原卡片備註焦點與選取範圍', async ({ page, api }) => {
  seed(api);
  for (let i = 0; i < 20; ++i) seed(api, `more-${i.toString().padStart(2, '0')}`, { lead: { contact_result_at: '2026-10-06T12:00:00Z' } });
  await enter(page, api); await fillDraft(page);
  let release;
  api.holdTaskRead = url => { if (url.pathname.endsWith('/lead_tasks')) return new Promise(resolve => { release = resolve; }); };
  await page.locator('[data-lead-more="contacted"]').click();
  await expect.poll(() => typeof release).toBe('function');
  await selectNote(page);
  release();
  await expect(page.locator('[data-lead-panel="contacted"] .lead-task-block')).toHaveCount(21);
  await expectDraft(page); await expectNoteFocus(page);
});

test('其他卡片完成後 loadTasks 重畫，保留原卡片草稿與日期焦點', async ({ page, api }) => {
  seed(api); seed(api, 'second'); await enter(page, api); await fillDraft(page);
  await choose(page, '客人取消', 'second');
  let release; api.holdTaskRpc = () => new Promise(resolve => { release = resolve; });
  await card(page, 'second').getByRole('button', { name: '確定', exact: true }).click();
  await expect.poll(() => api.taskRpcs.length).toBe(1);
  await card(page).locator('[name="task_due"]').focus();
  release();
  await expect(card(page, 'second').locator('.lead-task-block')).toHaveText('✓ 流程已完成');
  await expectDraft(page); await expect(card(page).locator('[name="task_due"]')).toBeFocused();
});

for (const trigger of ['visibilitychange', 'online']) test(`${trigger} 同身分重新整理後保留結果、日期、備註、焦點與游標`, async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page); await selectNote(page);
  const readCount = api.taskReads.length;
  await page.evaluate(trigger => {
    if (trigger === 'visibilitychange') {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event(trigger));
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event(trigger));
    } else {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event(trigger));
    }
  }, trigger);
  await expect.poll(() => api.taskReads.length).toBeGreaterThan(readCount);
  await expectDraft(page); await expectNoteFocus(page);
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-heading')).toContainText('到場丈量');
  expect(api.taskRpcs[0]).toMatchObject({ p_id: 'task-workflow', p_outcome: 'scheduled', p_note: '保留確認區的測試備註', p_next_due_at: '2026-10-10T14:30:00+08:00' });
});

test('同身分重新讀取失敗仍保留草稿；重試成功才還原確認區', async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page); await selectNote(page);
  api.taskReadStatus = 500;
  await page.evaluate(() => window.GenieLeads.refresh());
  await expect(card(page).locator('.lead-task-block')).toContainText('下一步讀取失敗');
  api.taskReadStatus = 200;
  await page.evaluate(() => window.GenieLeads.refresh());
  await expectDraft(page); await expectNoteFocus(page);
});

test('重新整理等待期間自行移到其他控制項，晚到待辦不搶回焦點', async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page); await selectNote(page);
  let release;
  api.holdTaskRead = url => { if (url.pathname.endsWith('/lead_tasks')) return new Promise(resolve => { release = resolve; }); };
  await page.evaluate(() => window.GenieLeads.refresh());
  await expect.poll(() => typeof release).toBe('function');
  const refresh = page.getByRole('button', { name: '重新整理', exact: true });
  await refresh.focus();
  release();
  await expectDraft(page); await expect(refresh).toBeFocused();
});

test('換帳號後即使同一名單與同一待辦仍可讀，也清除舊草稿', async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page);
  await page.locator('#leads-view').getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.locator('#leads-login')).toBeVisible();
  api.user = { ...api.user, id: '00000000-0000-4000-8000-000000000002', email: 'second@example.test' };
  await login(page); await showContacted(page);
  await expect(card(page).locator('.lead-task-heading')).toContainText('確認丈量時間');
  await expect(card(page).locator('[data-task-confirm]')).toHaveCount(0);
  await choose(page, '已約好時間');
  await expect(card(page).locator('[name="task_note"]')).toHaveValue('');
  await expect(card(page).locator('[name="task_due"]')).toHaveValue('');
});

for (const next of [false, true]) test(`別人完成待辦後${next ? '接到不同待辦' : '已無 open 待辦'}，重新讀取清除草稿`, async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page); await selectNote(page);
  api.tasks[0].status = 'done';
  if (next) api.tasks.push({ ...api.tasks[0], id: 'task-next', status: 'open', step_key: 'measure' });
  else api.taskRuns[0].status = 'finished';
  await page.evaluate(() => window.GenieLeads.refresh());
  await expect(card(page).locator('.lead-task-block')).toContainText(next ? '下一步：到場丈量' : '✓ 流程已完成');
  await expect(card(page).locator('[data-task-confirm]')).toHaveCount(0);
  // 再提供原 id 的 open 快照，確認草稿已刪除，而非僅因新畫面不符而隱藏。
  api.tasks = [api.tasks[0]]; api.tasks[0].status = 'open'; api.taskRuns[0].status = 'active';
  await page.evaluate(() => window.GenieLeads.refresh());
  await expect(card(page).locator('.lead-task-heading')).toContainText('確認丈量時間');
  await expect(card(page).locator('[data-task-confirm]')).toHaveCount(0);
});

test('離開名單頁再回來，同一待辦的確認區草稿仍須清除', async ({ page, api }) => {
  seed(api); await enter(page, api); await fillDraft(page);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.locator('#list-view')).toBeVisible();
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await showContacted(page);
  await expect(card(page).locator('.lead-task-heading')).toContainText('確認丈量時間');
  await expect(card(page).locator('[data-task-confirm]')).toHaveCount(0);
});

test('下一步與到期時間顯示；卡片批次讀取且範本只快取一次', async ({ page, api }) => {
  seed(api); seed(api, 'second');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page, api);
  await expect(card(page).locator('.lead-task-heading')).toContainText('下一步：確認丈量時間');
  await expect(card(page).locator('.lead-task-heading')).toContainText('10/9 14:00');
  await expect(card(page, 'second').locator('.lead-task-block')).toBeVisible();
  expect(api.taskReads.filter(url => url.pathname.endsWith('/lead_tasks'))).toHaveLength(1);
  const latest = api.taskReads.find(url => url.pathname.endsWith('/customer_leads'));
  expect(latest.searchParams.get('id')).toContain('workflow');
  expect(latest.searchParams.get('id')).toContain('second');
  expect(latest.searchParams.get('lead_playbook_runs.limit')).toBe('1');
  expect(latest.searchParams.get('lead_task_errors.limit')).toBe('1');
  await choose(page, '客人取消');
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
  for (const table of ['lead_playbook_steps', 'lead_playbook_transitions']) expect(api.taskReads.filter(url => url.pathname.endsWith(`/${table}`))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('到期狀態：逾期天／小時、台北跨午夜今天到期、未來無顏色', async ({ page, api }) => {
  seed(api, 'days', { task: { due_at: '2026-10-05T14:30:00Z' } });
  seed(api, 'hours', { task: { due_at: '2026-10-07T14:30:00Z' } });
  seed(api, 'today', { task: { due_at: '2026-10-07T17:00:00Z' } });
  seed(api, 'future');
  await enter(page, api);
  await expect(card(page, 'days').locator('.lead-task-due.overdue')).toHaveText('🔴 已逾期 2 天');
  await expect(card(page, 'hours').locator('.lead-task-due.overdue')).toHaveText('🔴 已逾期 2 小時');
  await expect(card(page, 'today').locator('.lead-task-due.today')).toHaveText('🟡 今天到期');
  await expect(card(page, 'today').locator('time').last()).toContainText('10/8 01:00');
  await expect(card(page, 'future').locator('.lead-task-block')).toBeVisible();
  await expect(card(page, 'future').locator('.lead-task-due')).toHaveCount(0);
});

test('指定日期必填、台北 +08:00 送出並接下一步，備註一併保存', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '已約好時間');
  const form = card(page).locator('[data-task-confirm]');
  await form.getByRole('button', { name: '確定', exact: true }).click();
  expect(api.taskRpcs).toHaveLength(0);
  expect(await form.locator('[name="task_due"]').evaluate(input => input.validity.valueMissing)).toBe(true);
  await form.locator('textarea').fill('測試備註');
  await form.locator('[name="task_due"]').fill('2026-10-10T14:30');
  await form.getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-heading')).toContainText('下一步：到場丈量');
  await expect(card(page).locator('.lead-task-heading')).toContainText('10/10 14:30');
  expect(api.taskRpcs[0]).toEqual({ p_id: 'task-workflow', p_expected_version: 1, p_outcome: 'scheduled', p_note: '測試備註', p_next_due_at: '2026-10-10T14:30:00+08:00' });
  await expect(page.locator('#toast-text')).toHaveText('已完成：確認丈量時間');
});

test('約丈量三步走完，offset 步驟不要求填日期', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '已約好時間');
  await card(page).locator('[name="task_due"]').fill('2026-10-08T10:00');
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await choose(page, '已丈量');
  await expect(card(page).locator('[name="task_due"]')).toHaveCount(0);
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-heading')).toContainText('整理資料並報價');
  expect(api.taskRpcs[1].p_next_due_at).toBeNull();
  await choose(page, '已報價');
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
});

test('已聯絡流程接再次追蹤再結束', async ({ page, api }) => {
  seed(api, 'workflow', { result: 'contacted' }); await enter(page, api);
  await choose(page, '有興趣'); await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-heading')).toContainText('再次追蹤');
  await choose(page, '已追蹤'); await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
});

test('最新錯誤與過時錯誤分開；無轮次舊名單不顯示區塊', async ({ page, api }) => {
  seed(api, 'failed'); seed(api, 'old-error');
  api.taskErrors = [{ lead_id: 'failed', created_at: '2026-10-07T12:00:00Z' }, { lead_id: 'old-error', created_at: '2026-10-06T12:00:00Z' }];
  api.rows.push(lead('legacy', { contact_result: 'site_visit', contact_result_at: NOW }));
  api.rows.push(lead('no-template', { contact_result: 'not_interested', contact_result_at: NOW }));
  await enter(page, api);
  await expect(card(page, 'failed').locator('.lead-task-block')).toContainText('⚠️ 下一步沒有建立成功，請通知管理員');
  await expect(card(page, 'old-error').locator('.lead-task-heading')).toContainText('確認丈量時間');
  await expect(card(page, 'legacy')).toBeVisible();
  await expect(card(page, 'legacy').locator('.lead-task-block')).toHaveCount(0);
  await expect(card(page, 'no-template').locator('.lead-task-block')).toHaveCount(0);
});

for (const status of ['conflict', 'inactive', 'not_found']) test(`${status} 重新讀名單與待辦且清掉確認區`, async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  api.taskRpcResult = status;
  api.holdTaskRpc = async () => { api.taskRuns[0].status = 'finished'; api.tasks[0].status = 'done'; };
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
  await expect(page.locator('#toast-text')).toHaveText('這筆剛被更新，已重新整理');
  expect(api.requests.some(request => request.url.searchParams.get('id') === 'eq.workflow')).toBe(true);
  await expect(card(page).locator('[data-task-confirm]')).toHaveCount(0);
});

test('inactive 且名單已收回，卡片改回待聯絡', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  api.taskRpcResult = 'inactive';
  api.holdTaskRpc = async () => { api.rows[0].contact_result = null; api.rows[0].contact_result_at = null; api.taskRuns[0].status = 'undone'; api.tasks[0].status = 'cancelled'; };
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await page.locator('[data-lead-tab="pending"]').click();
  await expect(page.locator('[data-lead-panel="pending"] [data-lead-id="workflow"]')).toBeVisible();
});

test('invalid 在確認區顯示原因並保留備註', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  await card(page).locator('textarea').fill('保留這段測試備註');
  api.taskRpcResult = 'invalid';
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('[data-task-confirm] [role="alert"]')).toContainText('結果或下一步日期無效');
  await expect(card(page).locator('textarea')).toHaveValue('保留這段測試備註');
  await expect(card(page).getByRole('button', { name: '確定', exact: true })).toBeEnabled();
});

test('離線不送出、不排隊，顯示需連線', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  // 模擬失去網路但 offline 事件尚未到達的競態。
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('#toast-text')).toHaveText('需連線才能完成下一步，請連線後重試');
  expect(api.taskRpcs).toHaveLength(0);
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }));
  expect(api.taskRpcs).toHaveLength(0);
});

test('送出中停用、只發一次 RPC，失敗可重試', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  let release; api.holdTaskRpc = () => new Promise(resolve => { release = resolve; });
  api.taskRpcStatus = 500;
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).getByRole('button', { name: '送出中…', exact: true })).toBeDisabled();
  await expect(card(page).getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await expect(card(page).getByRole('button', { name: '客人取消', exact: true })).toBeDisabled();
  await expect.poll(() => api.taskRpcs.length).toBe(1); release();
  await expect(card(page).locator('[data-task-confirm] [role="alert"]')).toContainText('送出失敗');
  api.holdTaskRpc = null; api.taskRpcStatus = 200;
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
});

test('401 更新驗證後重送，確認區草稿不因定時刷新丟失', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  await card(page).locator('textarea').fill('驗證更新測試');
  await page.clock.runFor(30000);
  await expect(card(page).locator('textarea')).toHaveValue('驗證更新測試');
  api.taskUnauthorized = 1;
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
  expect(api.taskRpcs).toHaveLength(2); expect(api.refreshes).toBeGreaterThan(0);
});

test('範本文字與備註 XSS 經跳脫，備註上限 500 字', async ({ page, api }) => {
  seed(api);
  const payload = '</textarea><img src=x onerror="window.taskXss=true">';
  api.taskSteps[0].label = payload; api.taskTransitions[1].outcome_label = payload;
  await enter(page, api);
  await expect(card(page).locator('.lead-task-heading')).toContainText(payload);
  await choose(page, payload);
  await card(page).locator('textarea').fill(payload);
  await page.clock.runFor(30000);
  await expect(card(page).locator('textarea')).toHaveValue(payload);
  expect(await card(page).locator('textarea').getAttribute('maxlength')).toBe('500');
  await expect(card(page).locator('.lead-task-block img')).toHaveCount(0);
  expect(await page.evaluate(() => window.taskXss)).toBeUndefined();
});

test('手機 375×812：按鈕可換行、觸控 44px、日期框無横向捲動', async ({ page, api }) => {
  await page.setViewportSize({ width: 375, height: 812 }); seed(api);
  api.taskTransitions[0].outcome_label = '已約好時間（這是一段很長的測試結果名稱，用來確認手機換行）';
  await enter(page, api); await choose(page, api.taskTransitions[0].outcome_label);
  const buttons = await card(page).locator('.lead-task-results button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(buttons.every(height => height >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await card(page).locator('[name="task_due"]').boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: test.info().outputPath('v9-mobile.png'), fullPage: true });
});

test('改結果與收回都更新下一步，再按約丈量開第二輪', async ({ page, api }) => {
  api.rows = [lead('workflow', { notification_status: 'sent' })]; await enter(page, api);
  await page.locator('[data-lead-tab="pending"]').click();
  await page.locator('[data-lead-panel="pending"] [data-lead-result="site_visit"]').click();
  await showContacted(page);
  await expect(card(page).locator('.lead-task-heading')).toContainText('確認丈量時間');
  await card(page).locator('[data-lead-undo]').click();
  await page.locator('[data-lead-tab="pending"]').click();
  await page.locator('[data-lead-panel="pending"] [data-lead-result="site_visit"]').click();
  await showContacted(page);
  await expect(card(page).locator('.lead-task-heading')).toContainText('確認丈量時間');
  expect(api.taskRuns.map(run => run.run_no)).toEqual([1, 2]);
  await card(page).locator('[data-lead-result="contacted"]').click();
  await expect(card(page).locator('.lead-task-heading')).toContainText('追蹤意願');
  await card(page).locator('[data-lead-result="unreachable"]').click();
  await expect(card(page).locator('.lead-task-block')).toHaveCount(0);
});

test('下一步讀取失敗可重新整理重試', async ({ page, api }) => {
  seed(api); api.taskReadStatus = 500; await enter(page, api);
  await expect(card(page).locator('.lead-task-block')).toContainText('下一步讀取失敗');
  api.taskReadStatus = 200;
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await expect(card(page).locator('.lead-task-heading')).toContainText('確認丈量時間');
});

test('離開頁面／重新進頁時，晚到批次不覆蓋新輪次', async ({ page, api }) => {
  seed(api);
  let release; let held = false;
  api.holdTaskRead = url => {
    if (url.pathname.endsWith('/customer_leads') && !held) { held = true; return new Promise(resolve => { release = resolve; }); }
  };
  await enter(page, api); await expect.poll(() => held).toBe(true);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.locator('#list-view')).toBeVisible();
  api.taskRuns[0].status = 'finished'; api.tasks[0].status = 'done'; api.holdTaskRead = null;
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await showContacted(page);
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
  release();
  await expect.poll(() => api.taskReads.filter(url => url.pathname.endsWith('/lead_playbook_steps')).length).toBe(2);
  await expect(card(page).locator('.lead-task-block')).toHaveText('✓ 流程已完成');
});

test('載入更多只讀該批卡片，範本沿用快取；結果篩選不串卡片', async ({ page, api }) => {
  for (let i = 0; i < 21; ++i) seed(api, `batch-${i.toString().padStart(2, '0')}`);
  await enter(page, api);
  await expect(page.locator('[data-lead-panel="contacted"] .lead-task-block')).toHaveCount(20);
  await page.locator('[data-lead-more="contacted"]').click();
  await expect(page.locator('[data-lead-panel="contacted"] .lead-task-block')).toHaveCount(21);
  const reads = api.taskReads.filter(url => url.pathname.endsWith('/lead_tasks'));
  expect(reads).toHaveLength(2);
  expect(reads[0].searchParams.get('lead_id').split(',')).toHaveLength(20);
  expect(reads[1].searchParams.get('lead_id').split(',')).toHaveLength(1);
  expect(api.taskReads.filter(url => url.pathname.endsWith('/lead_playbook_steps'))).toHaveLength(1);
  await page.locator('[data-lead-filter="unreachable"]').click();
  await expect(page.locator('[data-lead-panel="contacted"] .lead-task-block')).toHaveCount(0);
});

test('換帳號後，舊帳號晚到批次不回填卡片或範本', async ({ page, api }) => {
  seed(api);
  let release, held = false;
  api.holdTaskRead = url => {
    if (url.pathname.endsWith('/customer_leads') && !held) { held = true; return new Promise(resolve => { release = resolve; }); }
  };
  await enter(page, api); await expect.poll(() => held).toBe(true);
  await page.locator('#leads-view').getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.locator('#leads-login')).toBeVisible();
  api.user = { ...api.user, id: '00000000-0000-4000-8000-000000000002', email: 'second@example.test' };
  api.rows = []; api.taskRuns = []; api.tasks = []; api.holdTaskRead = null;
  seed(api, 'new-account', { run: { status: 'finished' }, task: { status: 'done' } });
  await login(page); await showContacted(page);
  await expect(card(page, 'new-account').locator('.lead-task-block')).toHaveText('✓ 流程已完成');
  release();
  await expect(card(page)).toHaveCount(0);
  await expect(card(page, 'new-account').locator('.lead-task-block')).toHaveText('✓ 流程已完成');
});

test('換帳號後，舊完成 RPC 不顯示成功提示或改寫新卡片', async ({ page, api }) => {
  seed(api); await enter(page, api); await choose(page, '客人取消');
  let release; api.holdTaskRpc = () => new Promise(resolve => { release = resolve; });
  await card(page).getByRole('button', { name: '確定', exact: true }).click();
  await expect.poll(() => api.taskRpcs.length).toBe(1);
  await page.locator('#leads-view').getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.locator('#leads-login')).toBeVisible();
  api.user = { ...api.user, id: '00000000-0000-4000-8000-000000000002', email: 'second@example.test' };
  api.rows = []; seed(api, 'new-account');
  await login(page); await showContacted(page);
  await expect(card(page, 'new-account').locator('.lead-task-heading')).toContainText('確認丈量時間');
  release();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('#toast-text')).not.toHaveText('已完成：確認丈量時間');
  await expect(card(page, 'new-account').locator('.lead-task-heading')).toContainText('確認丈量時間');
});
