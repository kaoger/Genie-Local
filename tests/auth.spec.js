'use strict';
const { test: base, expect } = require('@playwright/test');
const {createCloud,cloudRoute}=require('./mock-cloud');
const { USER, session } = require('./mock-auth');
const { projectItems } = require('./helpers');

const KEY = 'sb_publishable_8qqY0NqIsbsjniO-QeJAqQ_eTWeDanS';
const TOKEN_KEY = 'sb-llqwzrgzekalwdnetvyb-auth-token';
const PROJECT_KEY = 'genie-local-projects-v1';
const VERIFIED_KEY = 'genie-verified-member-ids';
const OTHER_UID = '00000000-0000-4000-8000-000000000002';
const test = base.extend({
  api: [async ({ page }, use) => {
    const cloud=createCloud();
    const api = { password: 'correct', member: { display_name: '測試成員', active: true },
      memberMode: 'ok', refreshMode: 'ok', requests: [], memberRequests: 0, refreshes: 0, release: null };
    await page.route('https://llqwzrgzekalwdnetvyb.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url());
      api.requests.push({ path: url.pathname, search: url.search, method: request.method(), headers: request.headers() });
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/genie_projects' || /\/rpc\/genie_(save|delete|restore)_project$/.test(url.pathname)) return cloudRoute(route,cloud,headers);
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const valid = request.postDataJSON().password === api.password;
        return route.fulfill({ status: valid ? 200 : 400, headers, body: JSON.stringify(valid ? session() :
          { error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        api.refreshes++;
        if (api.refreshMode === 'invalid') return route.fulfill({status:400,headers,body:'{"error":"invalid_grant","error_description":"Refresh token expired"}'});
        return route.fulfill({ status: 200, headers, body: JSON.stringify(session()) });
      }
      if (url.pathname === '/rest/v1/app_admins') {
        api.memberRequests++;
        if (api.memberMode === 'hold') await new Promise(resolve => { api.release = resolve; });
        if (api.memberMode === 'abort') return route.abort('failed');
        if (api.memberMode === 'server') return route.fulfill({ status: 500, headers, body: '{"message":"Unavailable"}' });
        if (api.memberMode === 'unauthorized' || api.memberMode === 'forbidden') {
          const status = api.memberMode === 'unauthorized' ? 401 : 403;
          return route.fulfill({ status, headers, body: JSON.stringify({ message: 'Member lookup failed' }) });
        }
        return route.fulfill({ status: 200, headers, body: JSON.stringify(api.member ? [api.member] : []) });
      }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/customer_leads') return route.fulfill({ status: 200, headers, body: '[]' });
      return route.fulfill({ status: 500, headers, body: '{}' });
    });
    await use(api);
    for (const request of api.requests.filter(r => r.method !== 'OPTIONS')) {
      expect(request.headers.apikey, request.path).toBe(KEY);
      expect(request.headers.authorization, request.path).not.toBe(`Bearer ${KEY}`);
    }
  }, { auto: true }],
});

async function login(page, password = 'correct') {
  await page.locator('#leads-login [name="email"]').fill(USER.email);
  await page.locator('#leads-login [name="password"]').fill(password);
  await page.locator('#leads-login button[type="submit"]').click();
}
async function storedSession(page) {
  return page.evaluate(key => localStorage.getItem(key), TOKEN_KEY);
}

for (const hash of ['#/', '#/p/sample-0/brief', '#/leads']) {
  test(`未登入深連結 ${hash} 只見登入殼層；登入後保留網址`, async ({ page }) => {
    await page.goto('/' + hash);
    await expect(page.locator('#leads-login')).toBeVisible();
    await expect(projectItems(page)).toHaveCount(0);
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('#list-view')).toBeHidden();
    await expect(page.locator('#detail-view')).toBeHidden();
    await expect(page.locator('#leads-view')).toBeHidden();
    await expect(page).toHaveTitle('登入 Genie-Local');
    await login(page);
    await expect(page).toHaveURL(new RegExp(hash.replace(/[.*+?^$()|[\]{}]/g, '\\$&') + '$'));
    if (hash === '#/') await expect(projectItems(page)).toHaveCount(8);
    if (hash.includes('/p/')) await expect(page.locator('.crumbs h1')).toContainText('居家設計');
    if (hash === '#/leads') await expect(page.locator('#leads-list')).toBeVisible();
  });
}

for (const [name, url] of [
  ['網址片段 token', '/#access_token=link-access-token&refresh_token=link-refresh-token&expires_in=3600&token_type=bearer'],
  ['網址查詢 code', '/?code=link-auth-code'],
]) {
  test(`${name}不建立 session、交換 token 或顯示工作台`, async ({ page, api }) => {
    if (name === '網址查詢 code') await page.addInitScript(() => {
      localStorage.setItem('sb-llqwzrgzekalwdnetvyb-auth-token-code-verifier', 'test-verifier');
    });
    await page.goto(url);
    await expect(page.locator('#leads-login')).toBeVisible();
    await expect(page.locator('#auth-shell')).toContainText('登入 Genie-Local');
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('#list-view')).toBeHidden();
    await expect(page.locator('#detail-view')).toBeHidden();
    await expect(page.locator('#leads-view')).toBeHidden();
    await expect(projectItems(page)).toHaveCount(0);
    expect(await storedSession(page)).toBeNull();
    expect(api.requests.filter(request => request.path === '/auth/v1/token')).toEqual([]);
    expect(api.memberRequests).toBe(0);
  });
}

test('成員查詢載入中不顯示內容或執行匯出', async ({ page, api }) => {
  api.memberMode = 'hold';
  await page.addInitScript(value => localStorage.setItem('sb-llqwzrgzekalwdnetvyb-auth-token', JSON.stringify(value)), session());
  await page.goto('/#/p/sample-0/brief');
  await expect.poll(() => api.memberRequests).toBe(1);
  await expect(page.locator('#auth-shell')).toContainText('正在檢查登入狀態…');
  await expect(projectItems(page)).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page).toHaveURL(/#\/p\/sample-0\/brief$/);
  api.release();
  await expect(page.locator('.crumbs h1')).toBeVisible();
});

test('密碼錯誤固定文案，登入後續期複查不拆表單或閃白', async ({ page, api }) => {
  await page.goto('/');
  await login(page, 'wrong');
  await expect(page.locator('#leads-error')).toHaveText('帳號或密碼錯誤');
  expect(await storedSession(page)).toBeNull();
  await login(page);
  await expect(projectItems(page)).toHaveCount(8);
  await page.getByRole('button', { name: '新增專案', exact: true }).click();
  await page.locator('#project-form [name="name"]').fill('未送出的表單');
  api.memberMode = 'hold';
  await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
  await expect.poll(() => api.memberRequests).toBeGreaterThan(1);
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#project-form [name="name"]')).toHaveValue('未送出的表單');
  await expect(page.locator('#auth-shell')).toBeHidden();
  api.release();
  await expect(page.locator('#editor')).toBeVisible();
});

test('非成員與停用成員登出並顯示拒絕畫面', async ({ page, api }) => {
  api.member = null;
  await page.goto('/');
  await login(page);
  await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限，請聯絡管理者');
  await expect(projectItems(page)).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect.poll(() => storedSession(page)).toBeNull();
  await page.getByRole('button', { name: '換個帳號登入' }).click();
  await expect(page.locator('#leads-login')).toBeVisible();
  api.member = { display_name: '停用', active: false };
  await login(page);
  await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限，請聯絡管理者');
});

test('登出關閉對話框、清 toast 與畫面，清除專案快取、保留記住信箱', async ({ page }) => {
  await page.goto('/');
  await login(page);
  await expect(projectItems(page)).toHaveCount(8);
  await page.getByRole('button', { name: '新增專案', exact: true }).click();
  await page.locator('#project-form [name="name"]').fill('本機測試');
  await page.locator('#project-form button[type="submit"]').click();
  await expect(page.locator('#toast')).toBeVisible();
  await page.getByRole('button', { name: '編輯全部資料' }).click();
  await expect(page.locator('#drawer')).toBeVisible();
  const keyBefore = await page.evaluate(key => localStorage.getItem(key), PROJECT_KEY);
  await page.evaluate(() => window.GenieAuth.signOut());
  await expect(page.locator('#leads-login')).toBeVisible();
  await expect(page.locator('#drawer')).toBeHidden();
  await expect(page.locator('#toast')).toBeHidden();
  await expect(projectItems(page)).toHaveCount(0);
  await expect(page.locator('#project-cards')).toBeEmpty();
  await expect(page).toHaveTitle('登入 Genie-Local');
  expect(keyBefore).not.toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), PROJECT_KEY)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('genie-sync-v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('genie-last-email'))).toBe(USER.email);
});

for (const mode of ['server', 'abort']) {
  test(`初次成員查詢 ${mode} 保留 session，只見重試`, async ({ page, api }) => {
    api.memberMode = mode;
    await page.addInitScript(value => localStorage.setItem('sb-llqwzrgzekalwdnetvyb-auth-token', JSON.stringify(value)), session());
    await page.goto('/');
    await expect(page.locator('#auth-shell')).toContainText('無法連線，請稍後再試', { timeout: 11000 });
    await expect(page.locator('#auth-shell button')).toHaveText('重試');
    await expect(page.locator('.sidebar')).toBeHidden();
    expect(await storedSession(page)).not.toBeNull();
    api.memberMode = 'ok';
    await page.getByRole('button', { name: '重試' }).click();
    await expect(projectItems(page)).toHaveCount(8);
  });
}

test('成員查詢逾時約 8 秒後保留 session 並顯示重試', async ({ page, api }) => {
  api.memberMode = 'hold';
  await page.addInitScript(value => localStorage.setItem('sb-llqwzrgzekalwdnetvyb-auth-token', JSON.stringify(value)), session());
  await page.goto('/');
  await expect.poll(() => api.memberRequests).toBe(1);
  await expect(page.locator('#auth-shell')).toContainText('正在檢查登入狀態…');
  const started = Date.now();
  await expect(page.locator('#auth-shell')).toContainText('無法連線，請稍後再試', { timeout: 11000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(7000);
  await expect(page.getByRole('button', { name: '重試' })).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await storedSession(page)).not.toBeNull();
  api.release();
});

test('已確認成員離線可用本機，恢復後查到停用即收畫面', async ({ page, api }) => {
  await page.goto('/');
  await login(page);
  await expect(projectItems(page)).toHaveCount(8);
  api.memberMode = 'server';
  await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
  await expect(page.locator('#offline-banner')).toBeVisible();
  await expect(projectItems(page)).toHaveCount(8);
  expect(await storedSession(page)).not.toBeNull();
  api.memberMode = 'ok';
  api.member = { display_name: '停用', active: false };
  await page.getByRole('button', { name: '重試' }).click();
  await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限，請聯絡管理者');
  await expect(projectItems(page)).toHaveCount(0);
  await expect(page.locator('#offline-banner')).toBeHidden();
  await expect.poll(() => storedSession(page)).toBeNull();
});

test('停用 A 只移除 A 的曾確認紀錄，再登入遇 5xx 不放行', async ({ page, api }) => {
  await page.goto('/');
  await login(page);
  await expect(projectItems(page)).toHaveCount(8);
  await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids)),
    { key: VERIFIED_KEY, ids: [USER.id, OTHER_UID] });
  api.member = { display_name: '停用', active: false };
  await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
  await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限，請聯絡管理者');
  await expect.poll(() => storedSession(page)).toBeNull();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), VERIFIED_KEY)).toEqual([OTHER_UID]);
  await page.getByRole('button', { name: '換個帳號登入' }).click();
  api.memberMode = 'server';
  await login(page);
  await expect(page.locator('#auth-shell')).toContainText('無法連線，請稍後再試');
  await expect(page.getByRole('button', { name: '重試' })).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(projectItems(page)).toHaveCount(0);
  await expect(page.locator('#offline-banner')).toBeHidden();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), VERIFIED_KEY)).toEqual([OTHER_UID]);
});

for (const [mode, expected] of [['unauthorized', '登入 Genie-Local'], ['forbidden', '此帳號沒有權限，請聯絡管理者']]) {
  test(`成員查詢 ${mode} 登出並顯示${expected}`, async ({ page, api }) => {
    api.memberMode = mode;
    if(mode==='unauthorized')api.refreshMode='invalid';
    await page.addInitScript(({ key, ids, tokenKey, value }) => {
      localStorage.setItem(key, JSON.stringify(ids));
      localStorage.setItem(tokenKey, JSON.stringify(value));
    }, { key: VERIFIED_KEY, ids: [USER.id, OTHER_UID], tokenKey: TOKEN_KEY, value: session() });
    await page.goto('/');
    await expect(page.locator('#auth-shell')).toContainText(expected);
    await expect.poll(() => storedSession(page)).toBeNull();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(projectItems(page)).toHaveCount(0);
    await expect(page.locator('#offline-banner')).toBeHidden();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), VERIFIED_KEY))
      .toEqual(mode === 'forbidden' ? [OTHER_UID] : [USER.id, OTHER_UID]);
  });
}

test('離線重試、online 與回到前景會重新查驗；客戶名單維持讀取失敗', async ({ page, api }) => {
  await page.goto('/#/leads');
  await login(page);
  await expect(page.locator('#leads-list')).toBeVisible();
  api.memberMode = 'server';
  await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
  await expect(page.locator('#offline-banner')).toBeVisible();
  await expect(page.locator('.lead-error')).toHaveCount(2);
  api.memberMode = 'ok';
  const beforeOnline = api.memberRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => api.memberRequests).toBeGreaterThan(beforeOnline);
  await expect(page.locator('#offline-banner')).toBeHidden();
  api.memberMode = 'server';
  await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
  await expect(page.locator('#offline-banner')).toBeVisible();
  api.memberMode = 'ok';
  const beforeVisible = api.memberRequests;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => api.memberRequests).toBeGreaterThan(beforeVisible);
  await expect(page.locator('#offline-banner')).toBeHidden();
});

test('未登入時合成的匯出與說明動作不執行', async ({ page }) => {
  await page.goto('/#/');
  const downloads = [];
  page.on('download', download => downloads.push(download));
  await page.evaluate(() => {
    document.querySelector('[data-action="export"]').click();
    document.querySelector('[data-action="help"]').click();
  });
  await expect(page.locator('#info-dialog')).toBeHidden();
  await expect(page.locator('#toast')).toBeHidden();
  expect(downloads).toHaveLength(0);
  await expect(projectItems(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/$/);
});

test('示範種子列加標籤，另有原本的範例列', async ({ page }) => {
  await page.goto('/');
  await login(page);
  await expect(page.locator('#rows tr[data-id^="sample-"] .seed-badge')).toHaveCount(8);
  await expect(page.locator('#rows .example-row .example-badge')).toHaveText('範例');
});

test('顯示名稱安全輸出並與本機名稱分開', async ({ page, api }) => {
  api.member = { display_name: '<img src=x onerror=alert(1)>', active: true };
  await page.goto('/');
  await login(page);
  await page.getByRole('button', { name: '個人設定', exact: true }).click();
  await expect(page.locator('#info-dialog')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#info-dialog img')).toHaveCount(0);
  await expect(page.locator('#info-dialog')).toContainText('本機顯示名稱');
});
