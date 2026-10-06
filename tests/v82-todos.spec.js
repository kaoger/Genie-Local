'use strict';
const { test, expect, lead, login, showContacted, showPending } = require('./mock-leads');
const { test: routeTest } = require('@playwright/test');
const { installMember } = require('./mock-auth');
const path = require('path'), os = require('os');
const NOW = Math.floor(Date.now() / 1000) * 1000, HOUR = 3600000;
const timed = (id, hours, extra = {}) => lead(id, { completed_at: new Date(NOW - hours * HOUR).toISOString(), ...extra });
const badge = page => page.locator('#lead-nav-badge');
const summary = page => page.locator('[data-lead-summary]');
const chip = (page, level) => page.locator(`[data-lead-wait="${level}"]`);
const cards = page => page.locator('[data-lead-section="pending"] .lead-card');
async function freeze(page) { await page.clock.setFixedTime(new Date(NOW)); }
async function total(page, count) {
  await expect(summary(page).locator('strong')).toHaveText(`待聯絡 ${count} 位`);
  await expect(page.locator('[data-lead-count="pending"]')).toHaveText(String(count));
  if (count) { await expect(badge(page)).toBeVisible(); await expect(badge(page)).toHaveText(count > 99 ? '99+' : String(count)); }
  else await expect(badge(page)).toBeHidden();
}
test.beforeEach(async ({ page }) => {
  page.runtimeErrors = [];
  page.on('pageerror', error => page.runtimeErrors.push(error.message));
  await freeze(page);
});
test.afterEach(async ({ page }) => { expect(page.runtimeErrors).toEqual([]); });

test('四級精確邊界、空／無效時間、排除非 complete 與已回報；文字與 XSS', async ({ page, api }) => {
  api.rows = [timed('23h59', 24 - 1 / 60, { customer_name: '<img src=x onerror=alert(1)>' }), timed('24h', 24), timed('71h59', 72 - 1 / 60), timed('72h', 72), timed('119h59', 120 - 1 / 60), timed('120h', 120), lead('null', { completed_at: null }), lead('invalid', { completed_at: '<svg onload=alert(1)>' }), timed('draft', 200, { status: 'draft' }), timed('reported', 200, { contact_result: 'unreachable' })];
  await login(page);
  await total(page, 8);
  for (const [level, label, count] of [['today', '🟢 當天', 1], ['recent', '🔵 1–2 天', 2], ['aging', '🟡 3–4 天', 2], ['old', '🔴 5 天以上', 1]]) await expect(chip(page, level)).toHaveText(`${label} ${count}`);
  await expect(summary(page).locator('small')).toHaveText('時間不明 2 位（已計入待聯絡總數）');
  for (const [id, level] of [['23h59', 'today'], ['24h', 'recent'], ['71h59', 'recent'], ['72h', 'aging'], ['119h59', 'aging'], ['120h', 'old'], ['null', 'unknown'], ['invalid', 'unknown']]) await expect(page.locator(`[data-lead-id="${id}"] .wait-${level}`)).toBeVisible();
  await expect(page.locator('[data-lead-id="24h"] .wait-recent')).toHaveText('🔵 1 天前');
  await expect(page.locator('[data-lead-id="120h"] .wait-old')).toHaveText('🔴 5 天前');
  await expect(page.locator('[data-lead-id="23h59"] h3')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#leads-list img, #leads-list svg')).toHaveCount(0);
  for (const [level, ids] of [['today', ['23h59']], ['recent', ['71h59', '24h']], ['aging', ['119h59', '72h']], ['old', ['120h']]]) {
    await chip(page, level).click();
    await expect(cards(page)).toHaveCount(ids.length);
    expect(await cards(page).evaluateAll(elements => elements.map(el => el.dataset.leadId))).toEqual(ids);
    await total(page, 8);
    expect(new URL(page.url()).hash).toBe('#/leads');
  }
  await showContacted(page);
  await expect(page.locator('[data-lead-section="contacted"] [class*="wait-"]')).toHaveCount(0);
  expect(api.patches).toHaveLength(0); expect(api.rpcs).toHaveLength(0);
});

test('24／72／120 小時整點與前後微秒：摘要數、卡片級別、晶片篩出數一致', async ({ page, api }) => {
  const expected = { today: [], recent: [], aging: [], old: [] };
  api.rows = [24, 72, 120].flatMap((hours, index) => [-1, 0, 1, 999, 1000].map(micros => {
    const id = `${hours}h-${micros}`, ms = NOW - hours * HOUR + Math.floor(micros / 1000);
    const fraction = String((micros % 1000 + 1000) % 1000).padStart(3, '0');
    const completed_at = new Date(ms).toISOString().replace('Z', `${fraction}Z`);
    const level = ['today', 'recent', 'aging', 'old'][index + (micros <= 0 ? 1 : 0)];
    expected[level].push(id);
    return lead(id, { completed_at });
  })).reverse();
  // 同一整點以帶時區的六位小數表示，也必須歸入較久級。
  api.rows.push(lead('24h-offset', { completed_at: new Date(NOW - 24 * HOUR).toISOString().replace('Z', '000+00:00') }));
  expected.recent.push('24h-offset');
  await login(page); await total(page, 16);
  for (const [level, ids] of Object.entries(expected)) {
    await expect(chip(page, level)).toHaveText(new RegExp(` ${ids.length}$`));
    for (const id of ids) await expect(page.locator(`[data-lead-id="${id}"] .wait-${level}`)).toBeVisible();
  }
  for (const [level, ids] of Object.entries(expected)) {
    await chip(page, level).click(); await expect(cards(page)).toHaveCount(ids.length);
    expect((await cards(page).evaluateAll(elements => elements.map(el => el.dataset.leadId))).sort()).toEqual(ids.slice().sort());
    await expect(cards(page).locator(`.wait-${level}`)).toHaveCount(ids.length);
  }
});

test('篩選與載入更多沿用摘要 now，跨門檻後直到重新整理才更新', async ({ page, api }) => {
  api.rows = Array.from({ length: 51 }, (_, i) => timed(`edge-${i}`, 24, { completed_at: new Date(NOW - 24 * HOUR).toISOString().replace('Z', '001Z') }));
  await login(page); await total(page, 51); await expect(chip(page, 'today')).toHaveText('🟢 當天 51');
  await page.clock.setFixedTime(new Date(NOW + 1));
  await chip(page, 'today').click(); await expect(cards(page)).toHaveCount(50);
  await page.locator('[data-lead-more="pending"]').click(); await expect(cards(page)).toHaveCount(51);
  await expect(cards(page).locator('.wait-today')).toHaveCount(51);
  const queries = api.requests.filter(r => r.url.searchParams.has('completed_at'));
  expect(queries.map(r => r.url.searchParams.get('offset') || '0')).toEqual(['0', '50']);
  for (const r of queries) expect(r.url.searchParams.getAll('completed_at')).toEqual([`gt.${new Date(NOW - 24 * HOUR).toISOString()}`]);
  await page.getByRole('button', { name: '重新整理' }).click();
  await expect(chip(page, 'today')).toHaveText('🟢 當天 0'); await expect(chip(page, 'recent')).toHaveText('🔵 1–2 天 51');
  await expect(cards(page)).toHaveCount(0);
  await chip(page, 'recent').click(); await expect(cards(page)).toHaveCount(50);
  await page.locator('[data-lead-more="pending"]').click(); await expect(cards(page)).toHaveCount(51);
  await expect(cards(page).locator('.wait-recent')).toHaveCount(51);
  const last = api.requests.filter(r => r.url.searchParams.has('completed_at')).slice(-2);
  for (const r of last) expect(r.url.searchParams.getAll('completed_at')).toEqual([`gt.${new Date(NOW + 1 - 72 * HOUR).toISOString()}`, `lte.${new Date(NOW + 1 - 24 * HOUR).toISOString()}`]);
});

for (const operation of ['report', 'undo']) {
  test(`${operation} changed 的摘要與仍在畫面的清單共用 now，重查完成才換時間`, async ({ page, api }) => {
    api.rows = [timed('edge', 23), timed('reported', 150, { contact_result: 'contacted', contact_result_at: new Date(NOW).toISOString(), contact_undo_until: new Date(NOW + HOUR).toISOString() })];
    await login(page); await total(page, 1);
    let release, waiting = false;
    const held = new Promise(resolve => { release = resolve; });
    api.holdLead = async () => { waiting = true; await held; };
    await page.clock.setFixedTime(new Date(NOW + 2 * HOUR));
    const before = api.summaries.length;
    const summaryResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('select') === 'id,completed_at');
    if (operation === 'report') { api.patchStatus = 0; await page.locator('[data-lead-id="edge"] [data-lead-result="contacted"]').click(); }
    else { api.rpcResult = 'changed'; await showContacted(page); await page.locator('[data-lead-undo]').click(); await showPending(page); }
    await expect.poll(() => waiting).toBe(true); await expect.poll(() => api.summaries.length).toBeGreaterThan(before);
    await (await summaryResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(chip(page, 'today')).toHaveText('🟢 當天 1'); await expect(chip(page, 'recent')).toHaveText('🔵 1–2 天 0');
    await chip(page, 'today').click(); await expect(cards(page)).toHaveCount(1); await expect(cards(page).locator('.wait-today')).toBeVisible();
    release(); await expect(chip(page, 'recent')).toHaveText('🔵 1–2 天 1'); await expect(cards(page)).toHaveCount(0);
    await chip(page, 'recent').click(); await expect(cards(page)).toHaveCount(1); await expect(cards(page).locator('.wait-recent')).toBeVisible();
  });
}

test('160 筆混合名單：伺服器篩選、載入更多、排序、全部與再點取消、不保存篩選', async ({ page, api }) => {
  const levels = [['today', 5, 61], ['recent', 40, 55], ['aging', 90, 31], ['old', 150, 13]];
  api.rows = levels.flatMap(([level, hours, count]) => Array.from({ length: count }, (_, i) => timed(`${level}-${i}`, hours + i / 100))).reverse();
  await login(page); await total(page, 160);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  for (const [level, , count] of levels) {
    await chip(page, level).click();
    await expect(cards(page)).toHaveCount(Math.min(count, 50));
    if (count > 50) { await page.locator('[data-lead-more="pending"]').click(); await expect(cards(page)).toHaveCount(count); }
    await expect(page.locator('[data-lead-more="pending"]')).toHaveCount(0);
    expect(await cards(page).evaluateAll(elements => elements.every(el => el.dataset.leadId.startsWith(elements[0].dataset.leadId.split('-')[0] + '-')))).toBe(true);
    const rows = await cards(page).evaluateAll(elements => elements.map(el => el.querySelector('time').dateTime));
    expect(rows).toEqual(rows.slice().sort());
    await total(page, 160);
  }
  const recentQuery = api.requests.find(r => r.url.searchParams.getAll('completed_at').length === 2).url;
  expect(recentQuery.searchParams.getAll('completed_at')).toEqual([`gt.${new Date(NOW - 72 * HOUR).toISOString()}`, `lte.${new Date(NOW - 24 * HOUR).toISOString()}`]);
  await chip(page, 'old').click(); await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(50);
  await chip(page, 'today').click(); await chip(page, 'all').click(); await expect(cards(page)).toHaveCount(50);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  await page.reload(); await total(page, 160); await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  expect(api.patches).toHaveLength(0); expect(api.rpcs).toHaveLength(0);
});

test('摘要每頁 1000 明列欄位取完，不受列表 50 筆限制', async ({ page, api }) => {
  api.rows = Array.from({ length: 1005 }, (_, i) => timed(String(i).padStart(4, '0'), i < 1000 ? 2 : 150)).reverse();
  const batches = [];
  api.holdSummary = async ({ url, rows }) => { batches.push({ offset: Number(url.searchParams.get('offset') || 0), ids: rows.map(row => row.id) }); };
  await login(page); await total(page, 1005);
  await expect(chip(page, 'today')).toHaveText('🟢 當天 1000'); await expect(chip(page, 'old')).toHaveText('🔴 5 天以上 5');
  expect(api.summaries.some(r => r.url.searchParams.get('offset') === '1000')).toBe(true);
  for (const r of api.summaries) {
    expect(r.url.searchParams.get('select')).toBe('id,completed_at'); expect(r.url.searchParams.get('limit')).toBe('1000');
    expect(r.url.searchParams.get('status')).toBe('eq.complete'); expect(r.url.searchParams.get('contact_result')).toBe('is.null');
    expect(r.method).toBe('GET'); expect(r.url.searchParams.get('order')).toBe('id.asc');
  }
  for (const batch of batches) expect(batch.ids).toEqual(Array.from({ length: batch.offset ? 5 : 1000 }, (_, i) => String(batch.offset + i).padStart(4, '0')));
  await expect(cards(page)).toHaveCount(50);
});

test('成為 member 時在專案頁取得徽章，前景與進名單都重查', async ({ page, api }) => {
  api.rows = [timed('one', 5)];
  await page.locator('#leads-login [name="email"]').fill('member@example.test');
  await page.locator('#leads-login [name="password"]').fill('test-password');
  await page.locator('#leads-login button[type="submit"]').click();
  await expect(page.locator('#list-view')).toBeVisible(); await expect(badge(page)).toHaveText('1');
  api.rows.push(timed('two', 40));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(badge(page)).toHaveText('2'); await expect(badge(page)).toHaveClass(/wait-recent/);
  api.rows.push(timed('three', 150));
  await page.getByRole('button', { name: '客戶名單', exact: true }).click(); await total(page, 3); await expect(badge(page)).toHaveClass(/wait-old/);
});

test('快速切換待聯絡晶片，晚到的舊清單不覆寫新篩選', async ({ page, api }) => {
  api.rows = [timed('today', 5), timed('old', 150)]; await login(page); await total(page, 2);
  api.holdReads = true;
  await chip(page, 'today').click(); await expect.poll(() => api.readWaiters.length).toBe(1);
  await chip(page, 'old').click(); await expect.poll(() => api.readWaiters.length).toBe(2);
  api.holdReads = false;
  api.readWaiters[1].release(); await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toHaveAttribute('data-lead-id', 'old');
  const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.getAll('completed_at').some(value => value.startsWith('gt.')));
  api.readWaiters[0].release(); await oldResponse;
  await expect(cards(page)).toHaveAttribute('data-lead-id', 'old'); await expect(chip(page, 'old')).toHaveAttribute('aria-pressed', 'true'); await total(page, 2);
});

test('Auth offline 狀態立即清空，恢復 member 重新取得摘要', async ({ page, api }) => {
  api.rows = [timed('one', 24, { completed_at: new Date(NOW - 24 * HOUR).toISOString().replace('Z', '001Z') })]; await login(page); await total(page, 1);
  api.memberFails = true; await page.evaluate(() => window.GenieAuth.recheck());
  await expect(badge(page)).toBeHidden(); await expect(summary(page)).toBeHidden();
  expect(await page.evaluate(() => window.GenieAuth.getState().status)).toBe('offline');
  const before = api.summaries.length; await page.evaluate(() => window.GenieLeads.refresh()); expect(api.summaries.length).toBe(before);
  await page.clock.setFixedTime(new Date(NOW + 1));
  api.memberFails = false; await page.evaluate(() => window.GenieAuth.recheck()); await total(page, 1);
  await expect(chip(page, 'recent')).toHaveText('🔵 1–2 天 1');
  await chip(page, 'recent').click(); await expect(cards(page)).toHaveCount(1); await expect(page.locator('.lead-card .wait-recent')).toBeVisible();
});

for (const [count, hours, level] of [[0, 5, null], [1, 5, 'today'], [99, 40, 'recent'], [100, 90, 'aging'], [2, 150, 'old'], [1, null, 'unknown']]) {
  test(`徽章 ${count} 位 ${level || '隱藏'}：名稱不變、文字描述、99+`, async ({ page, api }) => {
    api.rows = Array.from({ length: count }, (_, i) => hours === null ? lead(String(i), { completed_at: null }) : timed(String(i), hours));
    await login(page); await total(page, count);
    const button = page.getByRole('button', { name: '客戶名單', exact: true });
    await expect(button).toHaveAttribute('title', '客戶名單'); await expect(button).toHaveAttribute('aria-label', '客戶名單');
    await expect(button.locator('.nav-label')).toHaveText('客戶名單'); await expect(button.locator('.nav-icon .lead-nav-badge')).toHaveCount(0);
    if (count) {
      await expect(badge(page)).not.toHaveAttribute('aria-hidden');
      await expect(badge(page)).toHaveClass(new RegExp(`wait-${level}`));
      await expect(button).toHaveAttribute('aria-describedby', 'lead-nav-description');
      await expect(page.locator('#lead-nav-description')).toHaveText(`待聯絡 ${count} 位，${level === 'unknown' ? '時間不明' : `最久 ${{ today: '當天', recent: '1–2 天', aging: '3–4 天', old: '5 天以上' }[level]}`}`);
      if (level === 'unknown') {
        for (const id of ['today', 'recent', 'aging', 'old']) await expect(chip(page, id)).toHaveText(/ 0$/);
        expect(await badge(page).evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))).toEqual({ color: 'rgb(71, 85, 105)', background: 'rgb(226, 232, 240)' });
      }
    } else await expect(button).not.toHaveAttribute('aria-describedby');
  });
}

test('四級逐筆回報與收回都重查；最嚴重級跟著改變', async ({ page, api }) => {
  api.rows = [timed('today', 5), timed('recent', 40), timed('aging', 90), timed('old', 150)];
  await login(page); await total(page, 4);
  for (const [id, nextLevel, count] of [['old', 'aging', 3], ['aging', 'recent', 2], ['recent', 'today', 1], ['today', null, 0]]) {
    const before = api.summaries.length;
    await page.locator(`[data-lead-id="${id}"] [data-lead-result="contacted"]`).click(); await total(page, count);
    expect(api.summaries.length).toBeGreaterThan(before);
    if (nextLevel) await expect(badge(page)).toHaveClass(new RegExp(`wait-${nextLevel}`));
  }
  await showContacted(page);
  for (const [id, count] of [['today', 1], ['recent', 2], ['aging', 3], ['old', 4]]) {
    const before = api.summaries.length;
    await page.locator(`[data-lead-id="${id}"] [data-lead-undo]`).click();
    await expect(badge(page)).toBeVisible(); await expect(badge(page)).toHaveText(String(count)); expect(api.summaries.length).toBeGreaterThan(before);
    await expect(badge(page)).toHaveClass(new RegExp(`wait-${id}`));
  }
  await showPending(page); await total(page, 4);
});

for (const result of ['changed', 'expired']) {
  test(`收回 ${result} 重查實際資料，徽章不固定加一`, async ({ page, api }) => {
    api.rows = [timed('pending', 5), timed('undo', 150, { contact_result: 'contacted', contact_result_at: new Date(NOW).toISOString(), contact_undo_until: new Date(NOW + HOUR).toISOString() })];
    await login(page); await total(page, 1); await showContacted(page);
    api.rpcResult = result;
    // 另一個工作台同時新增待聯絡：應重查得三位，不能以畫面的一位加減。
    api.rows.push(timed('new1', 150), timed('new2', 90));
    await page.locator('[data-lead-id="undo"] [data-lead-undo]').click();
    await expect(badge(page)).toHaveText('3'); await expect(badge(page)).toHaveClass(/wait-old/);
    await showPending(page); await total(page, 3);
  });
}

test('寫入與收回 500 保留正確徽章，沒有樂觀加減', async ({ page, api }) => {
  api.rows = [timed('one', 150)]; await login(page); await total(page, 1);
  api.patchStatus = 500;
  await page.locator('[data-lead-result="contacted"]').click(); await expect(page.locator('#toast-text')).toHaveText('儲存失敗，請稍後再試'); await total(page, 1);
  api.patchStatus = 200;
  await page.locator('[data-lead-result="contacted"]').click(); await total(page, 0); await showContacted(page);
  api.rpcStatus = 500;
  await page.locator('[data-lead-undo]').click(); await expect(page.locator('#toast-text')).toHaveText('收回失敗，請稍後再試'); await expect(badge(page)).toBeHidden();
});

for (const operation of ['report', 'undo']) {
  test(`${operation} 送出後離開名單仍更新徽章`, async ({ page, api }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    api.rows = [timed('one', 150, operation === 'undo' ? { contact_result: 'contacted', contact_result_at: new Date(NOW).toISOString(), contact_undo_until: new Date(NOW + HOUR).toISOString() } : {})];
    await login(page); await total(page, operation === 'report' ? 1 : 0);
    if (operation === 'report') { api.holdPatch = () => held; await page.locator('[data-lead-result="contacted"]').click(); await expect.poll(() => api.patches.length).toBe(1); }
    else { await showContacted(page); api.holdRpc = () => held; await page.locator('[data-lead-undo]').click(); await expect.poll(() => api.rpcs.length).toBe(1); }
    await page.getByRole('button', { name: '潛在客戶', exact: true }).click(); await expect(page.locator('#list-view')).toBeVisible();
    const before = api.summaries.length; release(); await expect.poll(() => api.summaries.length).toBeGreaterThan(before);
    if (operation === 'report') await expect(badge(page)).toBeHidden(); else await expect(badge(page)).toHaveText('1');
    await page.getByRole('button', { name: '客戶名單', exact: true }).click(); await showPending(page); await total(page, operation === 'report' ? 0 : 1);
  });
}

test('晚到舊摘要不覆寫新摘要；密集更新合併一次', async ({ page, api }) => {
  api.rows = [timed('old', 150)]; await login(page); await total(page, 1);
  let release, waiting = false;
  const held = new Promise(resolve => { release = resolve; });
  api.holdSummary = async () => { waiting = true; await held; };
  await page.getByRole('button', { name: '重新整理' }).click(); await expect.poll(() => waiting).toBe(true);
  const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('select') === 'id,completed_at');
  api.holdSummary = null; api.rows = [timed('today1', 5), timed('today2', 6)];
  const before = api.summaries.length;
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); window.GenieLeads.refresh(); });
  await total(page, 2); await expect(badge(page)).toHaveClass(/wait-today/); expect(api.summaries.length).toBe(before + 1);
  release(); await oldResponse; await total(page, 2); await expect(badge(page)).toHaveClass(/wait-today/);
});

test('跨過門檻不輪詢，下一次更新才變色；空級提示', async ({ page, api }) => {
  api.rows = [timed('one', 23)]; await login(page); await total(page, 1); await expect(badge(page)).toHaveClass(/wait-today/);
  await chip(page, 'old').click(); await expect(cards(page)).toHaveCount(0); await expect(page.locator('[data-lead-section="pending"]')).toContainText('這一級目前沒有待聯絡的客人');
  const before = api.summaries.length;
  await page.clock.setFixedTime(new Date(NOW + 2 * HOUR));
  await expect(badge(page)).toHaveClass(/wait-today/); expect(api.summaries.length).toBe(before);
  await page.getByRole('button', { name: '重新整理' }).click(); await expect(badge(page)).toHaveClass(/wait-recent/);
  await chip(page, 'recent').click(); await expect(cards(page)).toHaveCount(1); await expect(page.locator('.lead-card .wait-recent')).toHaveText('🔵 1 天前');
});

test('未登入不讀；離線立即清空，online 在專案頁也重查', async ({ page, api, context }) => {
  expect(api.summaries).toHaveLength(0); await expect(badge(page)).toBeHidden();
  api.rows = [timed('one', 150)]; await login(page); await total(page, 1);
  await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(badge(page)).toBeHidden(); await expect(summary(page)).toBeHidden();
  const before = api.summaries.length;
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.GenieLeads.refresh(); });
  expect(api.summaries.length).toBe(before);
  await page.getByRole('button', { name: '潛在客戶', exact: true }).click();
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(badge(page)).toHaveText('1'); await expect(badge(page)).toHaveClass(/wait-old/);
});

for (const failure of ['500', '401']) {
  test(`${failure} 讀取失敗隱藏摘要與徽章，不顯示假零`, async ({ page, api }) => {
    api.rows = [timed('one', 150)]; await login(page); await total(page, 1);
    if (failure === '500') api.fail = true; else { api.unauthorized = true; api.refreshFails = true; }
    await page.getByRole('button', { name: '重新整理' }).click();
    await expect(badge(page)).toBeHidden(); await expect(page.locator('[data-action="leads"]')).not.toHaveAttribute('aria-describedby');
    if (failure === '500') { await expect(summary(page)).toBeHidden(); await expect(summary(page)).toBeEmpty(); }
    else { await expect(page.locator('#leads-login')).toBeVisible(); await expect(summary(page)).toHaveCount(0); }
  });
}

test('登出／換帳號立即清空，晚到舊回應不洩漏上一個帳號計數', async ({ page, api }) => {
  api.rows = [timed('old', 150)]; await login(page); await total(page, 1);
  let release, waiting = false;
  const held = new Promise(resolve => { release = resolve; });
  api.holdSummary = async () => { waiting = true; await held; };
  await page.getByRole('button', { name: '重新整理' }).click(); await expect.poll(() => waiting).toBe(true);
  await page.locator('#leads-view [data-action="lead-signout"]').click(); await expect(page.locator('#leads-login')).toBeVisible(); await expect(badge(page)).toBeHidden();
  api.holdSummary = null; api.user = { ...api.user, id: '00000000-0000-4000-8000-000000000002', email: 'second@example.test' }; api.rows = [timed('new1', 5), timed('new2', 5)];
  await login(page); await total(page, 2);
  const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('select') === 'id,completed_at');
  release(); await oldResponse; await total(page, 2); await expect(badge(page)).toHaveClass(/wait-today/);
});

const sizes = [
  { width: 375, height: 812, left: 0, right: 0 }, { width: 844, height: 390, left: 59, right: 0 },
  { width: 844, height: 390, left: 0, right: 59 }, { width: 768, height: 1024, left: 0, right: 0 }, { width: 1280, height: 800, left: 59, right: 59 },
];
for (const size of sizes) {
  test(`${size.width}×${size.height} 安全區 ${size.left}/${size.right}：徽章不裁切、不改四格高度`, async ({ page, api }) => {
    await page.setViewportSize(size); api.rows = [timed('one', 150)]; await login(page); await total(page, 1);
    await page.evaluate(({ left, right }) => { for (const [key, value] of Object.entries({ top: 59, bottom: 34, left, right })) document.documentElement.style.setProperty(`--safe-${key}`, `${value}px`); }, size);
    const dimensions = () => page.locator('.nav-actions>button:visible').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
    const before = await dimensions(); const box = await badge(page).boundingBox(), bar = await page.locator('.sidebar').boundingBox();
    const rightEdge = Math.min(bar.x + bar.width, size.width - size.right);
    expect(box.x).toBeGreaterThanOrEqual(bar.x + size.left); expect(box.x + box.width).toBeLessThanOrEqual(rightEdge);
    expect(box.y).toBeGreaterThanOrEqual(bar.y); expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height - 34);
    await expect(chip(page, 'old')).toBeVisible(); await chip(page, 'old').click(); await expect(cards(page)).toHaveCount(1);
    api.rows = Array.from({ length: 100 }, (_, i) => timed(String(i), 150)); await page.getByRole('button', { name: '重新整理' }).click(); await total(page, 100);
    expect(await dimensions()).toEqual(before);
    if (size.width <= 600 || size.height <= 500) { expect(before).toHaveLength(4); expect(new Set(before).size).toBe(1); }
    const wideBadge = await badge(page).boundingBox(); expect(wideBadge.x + wideBadge.width).toBeLessThanOrEqual(rightEdge);
    const buttonBox = await page.locator('[data-action="leads"]').boundingBox();
    expect(wideBadge.x).toBeGreaterThanOrEqual(buttonBox.x); expect(wideBadge.y).toBeGreaterThanOrEqual(buttonBox.y);
    expect(wideBadge.x + wideBadge.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
    expect(wideBadge.y + wideBadge.height).toBeLessThanOrEqual(buttonBox.y + buttonBox.height);
    const layout = await badge(page).evaluate(el => {
      const css = getComputedStyle(el), range = document.createRange(); range.selectNodeContents(el);
      const text = range.getBoundingClientRect(), box = el.getBoundingClientRect();
      return { top: parseFloat(css.top), right: parseFloat(css.right), fits: text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom, painted: document.elementFromPoint(text.left + text.width / 2, text.top + text.height / 2)?.closest('[data-action="leads"]') === el.parentElement };
    });
    expect(layout.top).toBeGreaterThanOrEqual(0); expect(layout.right).toBeGreaterThanOrEqual(0); expect(layout.fits).toBe(true); expect(layout.painted).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: path.join(os.tmpdir(), `genie-v82-${size.width}-${size.height}-${size.left}-${size.right}.png`) });
  });
}

for (const mode of ['media', 'navigator', 'browser']) {
  for (const hash of ['', '#/']) {
    routeTest(`冷啟動 ${mode} ${hash || '空 hash'}：主畫面進名單、一般瀏覽維持專案`, async ({ page }) => {
      await installMember(page);
      await page.addInitScript(mode => {
        if (mode === 'navigator') Object.defineProperty(navigator, 'standalone', { value: true });
        if (mode === 'media') { const original = window.matchMedia.bind(window); window.matchMedia = query => query === '(display-mode: standalone)' ? { ...original(query), matches: true } : original(query); }
      }, mode);
      await page.goto(`/${hash}`);
      if (mode === 'browser') { expect(new URL(page.url()).hash).toBe(hash); await expect(page.locator('#list-view')).toBeVisible(); }
      else {
        await expect(page).toHaveURL(/#\/leads$/); await expect(page.locator('[data-lead-tab="pending"]')).toHaveAttribute('aria-selected', 'true');
        await page.getByRole('button', { name: '潛在客戶', exact: true }).click(); await expect(page).toHaveURL(/#\/$/); await expect(page.locator('#list-view')).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await expect(page.locator('#list-view')).toBeVisible();
      }
    });
  }
}
routeTest('standalone 專案深連結不被啟動入口改寫', async ({ page }) => {
  await installMember(page);
  await page.goto('/'); await expect(page.locator('#rows tr[data-id]')).toHaveCount(8);
  const id = await page.locator('#rows tr[data-id]').first().getAttribute('data-id');
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  const hash = `#/p/${encodeURIComponent(id)}/brief`; await page.goto(`/${hash}`);
  await expect(page.locator('#detail-view')).toBeVisible(); expect(new URL(page.url()).hash).toBe(hash);
});
