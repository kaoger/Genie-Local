'use strict';
const { test: base, expect } = require('@playwright/test');
const {createCloud,cloudRoute}=require('./mock-cloud');

const SELECT = 'id,status,answers,customer_name,phone,project_type,location,interior_area,budget_range,start_time,completed_at,contact_result,contact_result_at,contact_first_at,contact_undo_until,lead_grade,notification_status,messenger_user_id';
const email = 'member@example.test';
const user = { id: '00000000-0000-4000-8000-000000000001', email, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated' };
const session = () => ({ access_token: 'member-access-token', refresh_token: 'member-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
const lead = (id, extra = {}) => ({ id, status: 'complete', answers: { contact_time: ['平日晚上'] }, customer_name: `客戶 ${id}`, phone: '0912 345-678', project_type: '居家裝潢設計', location: '台中市', interior_area: 35, budget_range: '100–200 萬', start_time: '下個月', completed_at: new Date(Date.now() - 4 * 86400000).toISOString(), contact_result: null, contact_result_at: null, contact_first_at: null, contact_undo_until: null, lead_grade: 'hot', notification_status: 'failed', ...extra });

const test = base.extend({
  api: [async ({ page }, use) => {
    const cloud=createCloud();
    const api = { rows: [], requests: [], patches: [], rpcs: [], rpcResult: 'undone', rpcUnauthorized: false, fail: false, patchStatus: 200, unauthorized: false, refreshes: 0, refreshFails: false, holdReads: false, readWaiters: [], invalidCount: false };
    await page.route('https://llqwzrgzekalwdnetvyb.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/genie_projects' || /\/rpc\/genie_(save|delete|restore)_project$/.test(url.pathname)) return cloudRoute(route,cloud,headers);
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return route.fulfill({ status: 200, headers, body: JSON.stringify(session()) });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        api.refreshes++;
        return route.fulfill({ status: api.refreshFails ? 400 : 200, headers, body: JSON.stringify(api.refreshFails ? { error: 'invalid_grant', error_description: 'Refresh token expired' } : session()) });
      }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/app_admins') return route.fulfill({ status: 200, headers, body: '[{"display_name":"測試成員","active":true}]' });
      if (url.pathname === '/rest/v1/rpc/genie_undo_contact_result') {
        const body = JSON.parse(request.postData());
        api.rpcs.push(body);
        if (api.rpcUnauthorized === true || api.rpcUnauthorized > 0) {
          if (typeof api.rpcUnauthorized === 'number') api.rpcUnauthorized--;
          return route.fulfill({ status: 401, headers, body: '{"code":"PGRST301","message":"JWT expired"}' });
        }
        if (api.rpcResult === 'undone') {
          const row = api.rows.find(item => item.id === body.p_id);
          if (row) { row.contact_result = null; row.contact_result_at = null; row.contact_undo_until = null; }
        }
        return route.fulfill({ status: 200, headers, body: JSON.stringify(api.rpcResult) });
      }
      if (url.pathname === '/rest/v1/customer_leads') {
        if (request.method() === 'PATCH') api.patches.push({ url, body: request.postData(), headers: request.headers() });
        else api.requests.push({ url, method: request.method(), headers: request.headers() });
        if (api.unauthorized === true || api.unauthorized > 0) {
          if (typeof api.unauthorized === 'number') api.unauthorized--;
          return route.fulfill({ status: 401, headers, body: '{"code":"PGRST301","message":"JWT expired"}' });
        }
        if (request.method() === 'PATCH') {
          if (api.patchStatus === 500) return route.fulfill({ status: 500, headers, body: '{"message":"write failed"}' });
          if (api.patchStatus === 0) return route.fulfill({ status: 200, headers, body: '[]' });
          const row = api.rows.find(item => item.id === url.searchParams.get('id')?.replace(/^eq\./, ''));
          if (!row) return route.fulfill({ status: 200, headers, body: '[]' });
          if (url.searchParams.get('contact_result') !== (row.contact_result === null ? 'is.null' : `eq.${row.contact_result}`)) return route.fulfill({ status: 200, headers, body: '[]' });
          if (row.contact_result !== null && url.searchParams.get('contact_result_at') !== `eq.${row.contact_result_at}`) return route.fulfill({ status: 200, headers, body: '[]' });
          const first = row.contact_result === null;
          row.contact_result = JSON.parse(request.postData()).contact_result;
          row.contact_result_at = new Date().toISOString();
          row.contact_undo_until = first ? new Date(Date.now() + 15 * 60000).toISOString() : null;
          return route.fulfill({ status: 200, headers, body: JSON.stringify([row]) });
        }
        if (api.fail) return route.fulfill({ status: 500, headers, body: '{"message":"read failed"}' });
        if (url.searchParams.has('id')) {
          const row = api.rows.find(item => item.id === url.searchParams.get('id')?.replace(/^eq\./, ''));
          return route.fulfill({ status: 200, headers, body: JSON.stringify(row ? [row] : []) });
        }
        if (api.holdReads) await new Promise(resolve => api.readWaiters.push({ url, method: request.method(), release: resolve }));
        const resultFilter = url.searchParams.get('contact_result');
        const pending = resultFilter === 'is.null';
        const rows = api.rows.filter(row => pending ? row.contact_result === null : resultFilter === 'not.is.null' ? row.contact_result !== null : row.contact_result === resultFilter?.replace(/^eq\./, ''));
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || (pending ? 50 : 20));
        const ranged = rows.slice(offset, offset + limit);
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
  await expect(page.locator('#list-view')).toBeVisible();
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await expect(page.locator('#leads-list')).toBeVisible();
}
async function showContacted(page) { await page.locator('[data-lead-tab="contacted"]').click(); }
async function showPending(page) { await page.locator('[data-lead-tab="pending"]').click(); }
function releaseRead(api, method, filter) {
  const index = api.readWaiters.findIndex(waiter => waiter.method === method && waiter.url.searchParams.get('contact_result') === filter);
  expect(index).toBeGreaterThanOrEqual(0);
  api.readWaiters.splice(index, 1)[0].release();
}

test('明列欄位、篩選排序與卡片內容安全顯示', async ({ page, api }) => {
  api.rows = [lead('one', { customer_name: '<img src=x onerror=alert(1)>', phone: '+886 (912) 345-678' }), lead('two', { contact_result: 'site_visit', contact_result_at: new Date().toISOString(), lead_grade: null, notification_status: 'sent' })];
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(1);
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  for (const request of api.requests) {
    expect(request.url.searchParams.get('select')).toBe(request.method === 'HEAD' ? 'id' : SELECT);
    expect(request.url.searchParams.get('status')).toBe('eq.complete');
  }
  const pending = api.requests.find(r => r.url.searchParams.get('contact_result') === 'is.null');
  const contacted = api.requests.find(r => r.method === 'GET' && r.url.searchParams.get('contact_result') === 'not.is.null');
  expect(pending.url.searchParams.get('order')).toBe('completed_at.asc');
  expect(pending.url.searchParams.get('limit')).toBe('50');
  expect(contacted.url.searchParams.get('order')).toBe('contact_result_at.desc');
  expect(contacted.url.searchParams.get('limit')).toBe('20');
  const card = page.locator('[data-lead-section="pending"] .lead-card');
  for (const value of ['居家裝潢設計', '台中市', '35', '100–200 萬', '下個月', '平日晚上', '+886 (912) 345-678', '超過 3 天未聯絡', '🔥 高分', '通知信寄送失敗']) await expect(card).toContainText(value);
  await expect(card.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:+886912345-678');
  await expect(card.locator('img')).toHaveCount(0);
  await expect(card).toContainText('<img src=x onerror=alert(1)>');
  await expect(card.locator('time')).toHaveAttribute('title', /\d{4}/);
  await expect(page.locator('[data-lead-section="contacted"]')).toContainText('約丈量');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 1');
  await expect(page.locator('[data-lead-section="contacted"] .lead-result-heading')).toHaveText('約丈量');
  await expect(page.locator('[data-lead-section="contacted"] .lead-tag')).toHaveCount(0);
  await expect(page.locator('[data-lead-section="contacted"]')).toContainText('剛剛');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('空清單、失敗、重新整理與回到前景重讀', async ({ page, api }) => {
  await login(page);
  await expect(page.locator('#leads-list')).toContainText('目前沒有待聯絡的客戶');
  await expect(page.locator('#leads-list')).toContainText('還沒有已回報的客戶');
  api.fail = true;
  await page.getByRole('button', { name: '重新整理' }).click();
  await expect(page.locator('.lead-error')).toHaveCount(2);
  await expect(page.locator('#leads-list')).toContainText('讀取失敗，請按重新整理');
  api.fail = false;
  api.rows = [lead('new')];
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(1);
});

test('兩區載入更多使用下一段 offset', async ({ page, api }) => {
  api.rows = [...Array.from({ length: 51 }, (_, i) => lead(`p${i}`)), ...Array.from({ length: 21 }, (_, i) => lead(`c${i}`, { contact_result: 'contacted', contact_result_at: new Date().toISOString() }))];
  await login(page);
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(50);
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(20);
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('51');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('21');
  await expect(page.locator('[data-lead-panel="contacted"]')).toBeHidden();
  await page.locator('[data-lead-section="pending"] [data-lead-more]').click();
  await page.locator('main').evaluate(el => { el.scrollTop = 300; });
  await showContacted(page);
  await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.locator('[data-lead-panel="pending"]')).toBeHidden();
  await page.locator('[data-lead-section="contacted"] [data-lead-more]').click();
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(51);
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(21);
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('51');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('21');
  expect(api.requests.filter(r => r.url.searchParams.get('offset') === '0').every(r => r.headers.prefer?.includes('count=exact'))).toBe(true);
  expect(api.requests.filter(r => Number(r.url.searchParams.get('offset')) > 0).every(r => !r.headers.prefer?.includes('count=exact'))).toBe(true);
  expect(api.requests.some(r => r.url.searchParams.get('contact_result') === 'is.null' && r.url.searchParams.get('offset') === '50')).toBe(true);
  expect(api.requests.some(r => r.url.searchParams.get('contact_result') === 'not.is.null' && r.url.searchParams.get('offset') === '20')).toBe(true);
});

test('已載入筆數達到精確總數時，不再顯示載入更多', async ({ page, api }) => {
  api.rows = Array.from({ length: 100 }, (_, i) => lead(`p${i}`));
  await login(page);
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('100');
  await page.locator('[data-lead-section="pending"] [data-lead-more]').click();
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(100);
  await expect(page.locator('[data-lead-section="pending"] [data-lead-more]')).toHaveCount(0);
});

test('已回報晶片由伺服器篩選，頂部維持全部總數；重新整理與回前景保留選擇', async ({ page, api }) => {
  api.rows = [lead('visit', { contact_result: 'site_visit' }), lead('call', { contact_result: 'contacted' })];
  await login(page);
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 2');
  await showContacted(page);
  await expect(page.locator('[data-lead-tab="contacted"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-lead-tab="contacted"]')).toBeFocused();
  expect(new URL(page.url()).hash).toBe('#/leads');
  await page.locator('[data-lead-filter="site_visit"]').click();
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  await expect(page.locator('[data-lead-section="contacted"]')).toContainText('客戶 visit');
  await expect(page.locator('[data-lead-section="contacted"]')).not.toContainText('客戶 call');
  await expect(page.locator('[data-lead-filter="site_visit"]')).toContainText('1');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 2');
  expect(api.requests.at(-1).url.searchParams.get('contact_result')).toBe('eq.site_visit');
  await page.getByRole('button', { name: '重新整理' }).click();
  await expect(page.locator('[data-lead-filter="site_visit"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-lead-panel="contacted"]')).toBeVisible();
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('[data-lead-filter="site_visit"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  await page.locator('[data-lead-filter="not_interested"]').click();
  await expect(page.locator('[data-lead-section="contacted"]')).toContainText('目前篩選沒有資料');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 2');
  await page.locator('[data-lead-filter="all"]').click();
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(2);
  expect(api.requests.at(-1).url.searchParams.get('contact_result')).toBe('not.is.null');
});

test('首批載入中切晶片，頂部仍取得全部已回報總數且舊清單不覆寫', async ({ page, api }) => {
  api.rows = [lead('visit', { contact_result: 'site_visit' }), lead('call', { contact_result: 'contacted' })];
  api.holdReads = true;
  await login(page);
  await expect.poll(() => api.readWaiters.length).toBe(3);
  await showContacted(page);
  await page.locator('[data-lead-filter="site_visit"]').click();
  await expect.poll(() => api.readWaiters.length).toBe(4);
  releaseRead(api, 'HEAD', 'not.is.null');
  releaseRead(api, 'GET', 'eq.site_visit');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 2');
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  await expect(page.locator('[data-lead-filter="site_visit"] [data-filter-count]')).toHaveText('1');
  api.readWaiters.splice(0).forEach(waiter => waiter.release());
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 2');
});

test('全部重新整理後立刻切晶片，頂部總數更新；失敗保留有效數字', async ({ page, api }) => {
  api.rows = [lead('visit', { contact_result: 'site_visit' }), lead('call', { contact_result: 'contacted' })];
  await login(page);
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 2');
  api.rows.push(lead('visit-2', { contact_result: 'site_visit' }));
  api.holdReads = true;
  await page.getByRole('button', { name: '重新整理' }).click();
  await expect.poll(() => api.readWaiters.length).toBe(3);
  await showContacted(page);
  await page.locator('[data-lead-filter="site_visit"]').click();
  await expect.poll(() => api.readWaiters.length).toBe(4);
  releaseRead(api, 'HEAD', 'not.is.null');
  releaseRead(api, 'GET', 'eq.site_visit');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 3');
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(2);
  api.readWaiters.splice(0).forEach(waiter => waiter.release());
  api.holdReads = false;
  api.fail = true;
  await page.getByRole('button', { name: '重新整理' }).click();
  await expect(page.locator('.lead-error')).toHaveCount(2);
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('已回報 3');
});

test('整頁重載回到待聯絡與全部，未選中晶片不顯示數字', async ({ page, api }) => {
  api.rows = [lead('visit', { contact_result: 'site_visit' }), lead('call', { contact_result: 'contacted' })];
  await login(page);
  await showContacted(page);
  await page.locator('[data-lead-filter="site_visit"]').click();
  await expect(page.locator('[data-lead-filter="site_visit"] [data-filter-count]')).toHaveText('1');
  await page.reload();
  await expect(page.locator('[data-lead-tab="pending"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-lead-panel="contacted"]')).toBeHidden();
  await expect(page.locator('[data-lead-filter="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-lead-filter="all"] [data-filter-count]')).toHaveText('2');
  for (const filter of ['contacted', 'site_visit', 'not_interested', 'unreachable']) {
    await expect(page.locator(`[data-lead-filter="${filter}"] [data-filter-count]`)).toBeEmpty();
  }
});

test('篩選不符的回報仍提供收回，離線計數顯示破折號', async ({ page, api }) => {
  api.rows = [lead('pending'), lead('visit', { contact_result: 'site_visit' })];
  await login(page);
  await showContacted(page);
  await page.locator('[data-lead-filter="site_visit"]').click();
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  await showPending(page);
  await page.locator('[data-lead-id="pending"]').getByRole('button', { name: '已聯絡' }).click();
  await expect(page.locator('#toast-text')).toHaveText('已記錄為已聯絡（目前篩選未顯示）');
  await expect(page.locator('#toast-action')).toHaveText('收回');
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('0');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('2');
  await page.locator('#toast-action').click();
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('1');
  await page.evaluate(() => window.GenieLeads.showOffline());
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('—');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('—');
});

test('重新整理讀取中保留舊總數，非有限 count 顯示破折號', async ({ page, api }) => {
  api.rows = [lead('one')];
  await login(page);
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('1');
  api.holdReads = true;
  api.invalidCount = true;
  await page.getByRole('button', { name: '重新整理' }).click();
  await expect.poll(() => api.readWaiters.length).toBe(3);
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('1');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('0');
  api.holdReads = false;
  api.readWaiters.splice(0).forEach(waiter => waiter.release());
  await expect(page.locator('[data-lead-tab="pending"]')).toContainText('—');
  await expect(page.locator('[data-lead-tab="contacted"]')).toContainText('—');
});

test('成功登入後記住信箱，登出後可清除，密碼不入 localStorage', async ({ page }) => {
  await login(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('genie-last-email'))).toBe(email);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-password');
  await page.locator('#leads-view').getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.locator('#leads-login [name="email"]')).toHaveValue(email);
  await page.getByRole('button', { name: '不是這個帳號？' }).click();
  await expect(page.locator('#leads-login [name="email"]')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('genie-last-email'))).toBeNull();
});

test('JWT 失效續期仍失敗時回到登入畫面', async ({ page, api }) => {
  await login(page);
  await expect(page.locator('#leads-list')).toContainText('目前沒有待聯絡的客戶');
  api.unauthorized = true;
  api.refreshFails = true;
  await page.evaluate(() => window.GenieLeads.refresh());
  await expect(page.locator('#leads-login')).toBeVisible();
  expect(api.refreshes).toBeGreaterThan(0);
});

test('JWT 失效後續期成功會重試查詢', async ({ page, api }) => {
  api.rows = [lead('recovered')];
  api.unauthorized = 2;
  await login(page);
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(1);
  expect(api.refreshes).toBeGreaterThan(0);
});

test('回報結果帶待聯絡條件，重新讀取後移到已回報', async ({ page, api }) => {
  api.rows = [lead('write-one')];
  await login(page);
  const pending = page.locator('[data-lead-section="pending"] .lead-card');
  await expect(pending.locator('[data-lead-result]')).toHaveCount(4);
  const before = api.requests.length;
  await pending.getByRole('button', { name: '約丈量' }).click();
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(0);
  await showContacted(page);
  const contacted = page.locator('[data-lead-section="contacted"] .lead-card');
  await expect(contacted).toHaveCount(1);
  await expect(contacted).toContainText('約丈量');
  await expect(contacted).toContainText('剛剛');
  await expect(contacted.getByRole('button', { name: '約丈量' })).toHaveAttribute('aria-pressed', 'true');
  await expect(contacted.getByRole('button', { name: '已聯絡' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#toast-text')).toHaveText('已記錄：約丈量');
  expect(api.patches).toHaveLength(1);
  expect(api.patches[0].body).toBe('{"contact_result":"site_visit"}');
  expect(api.patches[0].url.searchParams.get('id')).toBe('eq.write-one');
  expect(api.patches[0].url.searchParams.get('contact_result')).toBe('is.null');
  expect(api.patches[0].url.searchParams.get('select')).toBe(SELECT);
  expect(api.requests.length).toBeGreaterThanOrEqual(before + 2);
});

test('空回傳會重讀實際結果，500 保留卡片和原結果', async ({ page, api }) => {
  api.rows = [lead('write-fail')];
  await login(page);
  const card = page.locator('[data-lead-section="pending"] .lead-card');
  api.patchStatus = 0;
  await card.getByRole('button', { name: '已聯絡' }).click();
  await expect(page.locator('#toast-text')).toHaveText('這筆已經被記成待聯絡');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('button', { name: '已聯絡' })).toHaveAttribute('aria-pressed', 'false');
  api.patchStatus = 500;
  await card.getByRole('button', { name: '約丈量' }).click();
  await expect(page.locator('#toast-text')).toHaveText('儲存失敗，請稍後再試');
  await expect(card).toHaveCount(1);
  expect(api.rows[0].contact_result).toBeNull();
});

test('Messenger 只對數字 ID 顯示，開收件匣並複製姓名', async ({ page, api }) => {
  api.rows = [lead('valid', { messenger_user_id: '123456789012345' }), lead('letters', { messenger_user_id: 'abc' }), lead('empty', { messenger_user_id: null })];
  await page.evaluate(() => {
    window.open = (...args) => { window.__openArgs = args; return null; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied = value; } } });
  });
  await login(page);
  const button = page.locator('[data-lead-id="valid"] .lead-messenger');
  await expect(button).toHaveText('💬 Messenger');
  await button.click();
  expect(await page.evaluate(() => window.__openArgs)).toEqual(['https://business.facebook.com/latest/inbox/all/?asset_id=157645098246646&business_id=404673281059049', '_blank', 'noopener']);
  expect(await page.evaluate(() => window.__copied)).toBe('客戶 valid');
  await expect(page.locator('#toast-text')).toHaveText('已複製「客戶 valid」，到收件匣搜尋欄貼上');
  await expect(page.locator('[data-lead-id="letters"] .lead-messenger')).toHaveCount(0);
  await expect(page.locator('[data-lead-id="empty"] .lead-messenger')).toHaveCount(0);
  await expect(page.locator('.lead-messenger-hint')).toContainText('貼到搜尋欄即可找到對話');
  expect(api.requests.filter(request => request.method === 'GET').every(request => request.url.searchParams.get('select')?.includes('messenger_user_id'))).toBe(true);
});

test('寫入時 401 續期後重試，仍失敗則返回登入', async ({ page, api }) => {
  api.rows = [lead('retry')];
  await login(page);
  await expect(page.locator('[data-lead-section="contacted"]')).toContainText('還沒有已回報的客戶');
  api.unauthorized = 1;
  await page.locator('[data-lead-id="retry"]').getByRole('button', { name: '聯絡不上' }).click();
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  expect(api.patches).toHaveLength(2);
  expect(api.refreshes).toBeGreaterThan(0);
  api.unauthorized = true;
  api.refreshFails = true;
  await showContacted(page);
  await page.locator('[data-lead-id="retry"]').getByRole('button', { name: '約丈量' }).click();
  await expect(page.locator('#leads-login')).toBeVisible();
});

test('已回報改結果帶畫面結果與時間條件；過期沒有收回按鈕', async ({ page, api }) => {
  const at = new Date(Date.now() - 60000).toISOString();
  api.rows = [lead('reported', { contact_result: 'contacted', contact_result_at: at, contact_undo_until: new Date(Date.now() - 1000).toISOString() })];
  await login(page);
  await showContacted(page);
  const card = page.locator('[data-lead-id="reported"]');
  await expect(card.locator('.lead-result-heading')).toHaveText('已聯絡');
  await expect(card.locator('[data-lead-undo]')).toHaveCount(0);
  await card.getByRole('button', { name: '沒興趣' }).click();
  await expect(page.locator('#toast-text')).toHaveText('已記錄：沒興趣');
  expect(api.patches.at(-1).url.searchParams.get('contact_result')).toBe('eq.contacted');
  expect(api.patches.at(-1).url.searchParams.get('contact_result_at')).toBe(`eq.${at}`);
});

test('條件式寫入 0 列會重讀並提示實際結果，讀不到用一般提示', async ({ page, api }) => {
  api.rows = [lead('changed')];
  await login(page);
  await expect(page.locator('[data-lead-section="pending"] [data-lead-id="changed"]')).toBeVisible();
  api.patchStatus = 0;
  api.rows[0].contact_result = 'unreachable';
  api.rows[0].contact_result_at = new Date().toISOString();
  const before = api.requests.length;
  await page.locator('[data-lead-id="changed"]').getByRole('button', { name: '約丈量' }).click();
  await expect(page.locator('#toast-text')).toHaveText('這筆已經被記成聯絡不上');
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  expect(api.requests.length).toBeGreaterThan(before);
  api.rows = [];
  await showContacted(page);
  await page.locator('[data-lead-id="changed"]').getByRole('button', { name: '沒興趣' }).click();
  await expect(page.locator('#toast-text')).toHaveText('這筆已被更新，請重新整理');
});

test('記錄成功的 toast 收回捷徑呼叫 RPC 並移回待聯絡', async ({ page, api }) => {
  api.rows = [lead('shortcut')];
  await login(page);
  await page.locator('[data-lead-id="shortcut"]').getByRole('button', { name: '約丈量' }).click();
  await showContacted(page);
  await expect(page.locator('[data-lead-id="shortcut"] [data-lead-undo]')).toBeVisible();
  await expect(page.locator('[data-lead-id="shortcut"] .lead-undo-time')).toContainText('還可收回');
  await page.locator('#toast-action').click();
  await expect(page.locator('#toast-text')).toHaveText('已改回待聯絡');
  await showPending(page);
  await expect(page.locator('[data-lead-section="pending"] [data-lead-id="shortcut"]')).toBeVisible();
  expect(api.rpcs).toHaveLength(1);
  expect(api.rpcs[0]).toEqual({ p_id: 'shortcut', p_expected_result: 'site_visit', p_expected_at: expect.any(String) });
});

test('收回遇 401 時續期成功並重試 RPC', async ({ page, api }) => {
  const at = new Date().toISOString();
  api.rows = [lead('undo-retry', { contact_result: 'contacted', contact_result_at: at, contact_undo_until: new Date(Date.now() + 14 * 60000).toISOString() })];
  await login(page);
  await showContacted(page);
  api.rpcUnauthorized = 1;
  await page.locator('[data-lead-id="undo-retry"] [data-lead-undo]').click();
  await showPending(page);
  await expect(page.locator('[data-lead-section="pending"] [data-lead-id="undo-retry"]')).toBeVisible();
  expect(api.refreshes).toBe(1);
  expect(api.rpcs).toEqual(Array(2).fill({ p_id: 'undo-retry', p_expected_result: 'contacted', p_expected_at: at }));
});

test('收回遇 401 且續期失敗時登出並回登入畫面', async ({ page, api }) => {
  api.rows = [lead('undo-expired', { contact_result: 'contacted', contact_result_at: new Date().toISOString(), contact_undo_until: new Date(Date.now() + 14 * 60000).toISOString() })];
  await login(page);
  await showContacted(page);
  api.rpcUnauthorized = true;
  api.refreshFails = true;
  await page.locator('[data-lead-id="undo-expired"] [data-lead-undo]').click();
  await expect(page.locator('#leads-login')).toBeVisible();
  expect(api.refreshes).toBe(1);
  expect(api.rpcs).toHaveLength(1);
});

test('收回期限到時，卡片按鈕自動消失', async ({ page, api }) => {
  await page.clock.install();
  api.rows = [lead('timed', { contact_result: 'contacted', contact_result_at: new Date().toISOString(), contact_undo_until: new Date(Date.now() + 10000).toISOString() })];
  await login(page);
  await showContacted(page);
  await expect(page.locator('[data-lead-id="timed"] [data-lead-undo]')).toBeVisible();
  await page.clock.fastForward(30000);
  await expect(page.locator('[data-lead-id="timed"] [data-lead-undo]')).toHaveCount(0);
});

for (const [result, message] of [['undone', '已改回待聯絡'], ['changed', '這筆已經被記成沒興趣'], ['expired', '已超過 15 分鐘，無法收回'], ['forbidden', '收回失敗，請稍後再試']]) {
  test(`卡片收回 RPC 回傳 ${result}`, async ({ page, api }) => {
    const at = new Date().toISOString();
    api.rows = [lead('undo', { contact_result: 'site_visit', contact_result_at: at, contact_undo_until: new Date(Date.now() + 14 * 60000).toISOString() })];
    api.rpcResult = result;
    await login(page);
    await showContacted(page);
    const button = page.locator('[data-lead-id="undo"] [data-lead-undo]');
    await expect(button).toBeVisible();
    if (result === 'changed') api.rows[0].contact_result = 'not_interested';
    await button.click();
    await expect(page.locator('#toast-text')).toHaveText(message);
    expect(api.rpcs).toEqual([{ p_id: 'undo', p_expected_result: 'site_visit', p_expected_at: at }]);
    if (result === 'undone') { await showPending(page); await expect(page.locator('[data-lead-section="pending"] [data-lead-id="undo"]')).toBeVisible(); }
  });
}

test('Messenger 剪貼簿失敗時提示手動搜尋', async ({ page, api }) => {
  api.rows = [lead('copy-fail', { messenger_user_id: '123', customer_name: '<測試>' })];
  await page.evaluate(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied'); } } });
  });
  await login(page);
  await page.locator('[data-lead-id="copy-fail"] .lead-messenger').click();
  await expect(page.locator('#toast-text')).toHaveText('請到收件匣搜尋：<測試>');
  await expect(page.locator('#toast-text').locator('測試')).toHaveCount(0);
});
