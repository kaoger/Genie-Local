'use strict';
const { test: base, expect } = require('@playwright/test');

const KEY = 'sb_publishable_8qqY0NqIsbsjniO-QeJAqQ_eTWeDanS';
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'member@example.test',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated' };
const session = () => ({ access_token: 'member-access-token', refresh_token: 'member-refresh-token',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });

// 本 spec 的路由先於任何頁面載入；所有 Supabase URL 都在瀏覽器內回應。
const test = base.extend({
  api: [async ({ page }, use) => {
    const api = { password: 'correct', member: { display_name: '測試成員', active: true }, requests: [] };
    await page.route('https://llqwzrgzekalwdnetvyb.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url());
      api.requests.push({ path: url.pathname, search: url.search, method: request.method(), headers: request.headers() });
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
        'content-type': 'application/json' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const data = request.postDataJSON();
        return route.fulfill({ status: data.password === api.password ? 200 : 400, headers,
          body: JSON.stringify(data.password === api.password ? session() : { error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        return route.fulfill({ status: 200, headers, body: JSON.stringify(session()) });
      }
      if (url.pathname === '/rest/v1/app_admins') {
        return route.fulfill({ status: 200, headers, body: JSON.stringify(api.member ? [api.member] : []) });
      }
      if (url.pathname === '/rest/v1/customer_leads') {
        return route.fulfill({ status: 200, headers, body: '[]' });
      }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 500, headers, body: JSON.stringify({ error: `Unexpected ${url.pathname}` }) });
    });
    await page.goto('/');
    await expect(page.locator('#rows tr[data-id]')).toHaveCount(8);
    await use(api);
    for (const request of api.requests.filter(r => r.method !== 'OPTIONS')) {
      expect(request.headers.apikey, request.path).toBe(KEY);
      expect(request.headers.authorization, request.path).not.toBe(`Bearer ${KEY}`);
    }
  }, { auto: true }],
});

async function openLeads(page) {
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await expect(page).toHaveURL(/#\/leads$/);
}
async function login(page, password = 'correct') {
  await page.locator('#leads-login [name="email"]').fill(USER.email);
  await page.locator('#leads-login [name="password"]').fill(password);
  await page.locator('#leads-login button[type="submit"]').click();
}
async function authStorage(page) {
  return page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('auth-token')));
}

test('本機首頁無須登入；客戶名單顯示登入畫面', async ({ page }) => {
  await expect(page.locator('#list-view')).toBeVisible();
  await expect(page.locator('#rows tr[data-id]')).toHaveCount(8);
  await openLeads(page);
  await expect(page.locator('#leads-login')).toBeVisible();
  await expect(page.locator('#leads-login [name="email"]')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('#leads-login [name="password"]')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#leads-view')).toContainText('忘記密碼？請聯絡管理者重設');
});

test('密碼錯誤只顯示固定錯誤', async ({ page, api }) => {
  await openLeads(page);
  await login(page, 'wrong');
  await expect(page.locator('#leads-error')).toHaveText('帳號或密碼錯誤');
  await expect(authStorage(page)).resolves.toEqual([]);
  expect(api.requests.some(r => r.path === '/rest/v1/app_admins')).toBe(false);
});

test('成員可登入、重新整理保持登入，登出清除本機 session', async ({ page, api }) => {
  await openLeads(page);
  await login(page);
  await expect(page.locator('.leads-account')).toContainText('測試成員');
  await expect(page.locator('#leads-view')).toContainText('目前沒有待聯絡的客戶');
  expect(await authStorage(page)).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.leads-account')).toContainText('測試成員');
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.locator('#leads-login')).toBeVisible();
  expect(await authStorage(page)).toEqual([]);
  expect(api.requests.filter(r => r.path === '/rest/v1/app_admins').length).toBeGreaterThanOrEqual(2);
  expect(api.requests.find(r => r.path === '/rest/v1/app_admins').search)
    .toContain('select=display_name%2Cactive');
});

for (const [name, member] of [['非成員', null], ['停用成員', { display_name: '已停用', active: false }]]) {
  test(`${name}顯示無權限並清除 session`, async ({ page, api }) => {
    api.member = member;
    await openLeads(page);
    await login(page);
    await expect(page.locator('#leads-view')).toContainText('此帳號沒有權限，請聯絡管理者');
    await expect(page.getByRole('button', { name: '換個帳號登入' })).toBeVisible();
    expect(await authStorage(page)).toEqual([]);
    await page.getByRole('button', { name: '換個帳號登入' }).click();
    await expect(page.locator('#leads-login')).toBeVisible();
  });
}

test('所有 Supabase 請求只把 publishable key 放在 apikey', async ({ page, api }) => {
  await openLeads(page);
  await login(page);
  await expect(page.locator('.leads-account')).toBeVisible();
  expect(api.requests.length).toBeGreaterThan(0);
  for (const request of api.requests) {
    expect(request.headers.apikey, request.path).toBe(KEY);
    expect(request.headers.authorization, request.path).not.toBe(`Bearer ${KEY}`);
  }
  const loginRequest = api.requests.find(r => r.path === '/auth/v1/token');
  expect(loginRequest.headers.authorization).toBeUndefined();
  const memberRequest = api.requests.find(r => r.path === '/rest/v1/app_admins');
  expect(memberRequest.headers.authorization).toBe('Bearer member-access-token');
});

test('手機版顯示登入者，名稱安全輸出', async ({ page, api }) => {
  api.member = { display_name: '<img src=x onerror=alert(1)>', active: true };
  await page.setViewportSize({ width: 375, height: 812 });
  await openLeads(page);
  await login(page);
  await expect(page.locator('.leads-account')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.leads-account img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
