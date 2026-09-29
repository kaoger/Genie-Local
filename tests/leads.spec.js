'use strict';
const { test: base, expect } = require('@playwright/test');

const SELECT = 'id,status,answers,customer_name,phone,project_type,location,interior_area,budget_range,start_time,completed_at,contact_result,contact_result_at,contact_first_at,lead_grade,notification_status';
const email = 'member@example.test';
const user = { id: '00000000-0000-4000-8000-000000000001', email, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated' };
const session = () => ({ access_token: 'member-access-token', refresh_token: 'member-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
const lead = (id, extra = {}) => ({ id, status: 'complete', answers: { contact_time: ['平日晚上'] }, customer_name: `客戶 ${id}`, phone: '0912 345-678', project_type: '居家裝潢設計', location: '台中市', interior_area: 35, budget_range: '100–200 萬', start_time: '下個月', completed_at: new Date(Date.now() - 4 * 86400000).toISOString(), contact_result: null, contact_result_at: null, contact_first_at: null, lead_grade: 'hot', notification_status: 'failed', ...extra });

const test = base.extend({
  api: [async ({ page }, use) => {
    const api = { rows: [], requests: [], fail: false, unauthorized: false, refreshes: 0 };
    await page.route('https://llqwzrgzekalwdnetvyb.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return route.fulfill({ status: 200, headers, body: JSON.stringify(session()) });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') { api.refreshes++; return route.fulfill({ status: 200, headers, body: JSON.stringify(session()) }); }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/app_admins') return route.fulfill({ status: 200, headers, body: '[{"display_name":"測試成員","active":true}]' });
      if (url.pathname === '/rest/v1/customer_leads') {
        api.requests.push({ url, headers: request.headers() });
        if (api.unauthorized === true || api.unauthorized > 0) {
          if (typeof api.unauthorized === 'number') api.unauthorized--;
          return route.fulfill({ status: 401, headers, body: '{"code":"PGRST301","message":"JWT expired"}' });
        }
        if (api.fail) return route.fulfill({ status: 500, headers, body: '{"message":"read failed"}' });
        const pending = url.searchParams.get('contact_result') === 'is.null';
        const rows = api.rows.filter(row => pending ? row.contact_result === null : row.contact_result !== null);
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || (pending ? 50 : 20));
        return route.fulfill({ status: 200, headers, body: JSON.stringify(rows.slice(offset, offset + limit)) });
      }
      return route.fulfill({ status: 500, headers, body: '{}' });
    });
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    if (!await page.locator('#rows tr[data-id]').count()) await page.reload();
    await expect(page.locator('#rows tr[data-id]')).toHaveCount(8);
    await use(api);
  }, { auto: true }],
});

async function login(page) {
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await page.locator('#leads-login [name="email"]').fill(email);
  await page.locator('#leads-login [name="password"]').fill('test-password');
  await page.locator('#leads-login button[type="submit"]').click();
  await expect(page.locator('#leads-list')).toBeVisible();
}

test('明列欄位、篩選排序與卡片內容安全顯示', async ({ page, api }) => {
  api.rows = [lead('one', { customer_name: '<img src=x onerror=alert(1)>', phone: '+886 (912) 345-678' }), lead('two', { contact_result: 'site_visit', contact_result_at: new Date().toISOString(), lead_grade: null, notification_status: 'sent' })];
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(1);
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(1);
  for (const request of api.requests) {
    expect(request.url.searchParams.get('select')).toBe(SELECT);
    expect(request.url.searchParams.get('status')).toBe('eq.complete');
  }
  const pending = api.requests.find(r => r.url.searchParams.get('contact_result') === 'is.null');
  const contacted = api.requests.find(r => r.url.searchParams.get('contact_result') === 'not.is.null');
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
  await expect(page.locator('[data-lead-section="contacted"] .lead-tag')).toHaveCount(0);
  await expect(page.locator('[data-lead-section="contacted"]')).toContainText('剛剛');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('空清單、失敗、重新整理與回到前景重讀', async ({ page, api }) => {
  await login(page);
  await expect(page.locator('#leads-list')).toContainText('目前沒有待聯絡的客戶');
  await expect(page.locator('#leads-list')).toContainText('還沒有已聯絡的客戶');
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
  await page.locator('[data-lead-section="pending"] [data-lead-more]').click();
  await page.locator('[data-lead-section="contacted"] [data-lead-more]').click();
  await expect(page.locator('[data-lead-section="pending"] .lead-card')).toHaveCount(51);
  await expect(page.locator('[data-lead-section="contacted"] .lead-card')).toHaveCount(21);
  expect(api.requests.some(r => r.url.searchParams.get('contact_result') === 'is.null' && r.url.searchParams.get('offset') === '50')).toBe(true);
  expect(api.requests.some(r => r.url.searchParams.get('contact_result') === 'not.is.null' && r.url.searchParams.get('offset') === '20')).toBe(true);
});

test('成功登入後記住信箱，登出後可清除，密碼不入 localStorage', async ({ page }) => {
  await login(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('genie-last-email'))).toBe(email);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-password');
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.locator('#leads-login [name="email"]')).toHaveValue(email);
  await page.getByRole('button', { name: '不是這個帳號？' }).click();
  await expect(page.locator('#leads-login [name="email"]')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('genie-last-email'))).toBeNull();
});

test('JWT 失效續期仍失敗時回到登入畫面', async ({ page, api }) => {
  api.unauthorized = true;
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await page.locator('#leads-login [name="email"]').fill(email);
  await page.locator('#leads-login [name="password"]').fill('test-password');
  await page.locator('#leads-login button[type="submit"]').click();
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
