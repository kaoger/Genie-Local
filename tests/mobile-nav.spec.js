'use strict';
const fs = require('fs');
const { test: browserTest } = require('@playwright/test');
const { test, expect, STORAGE_KEY, STEPS, createProject, goStep } = require('./helpers');
const { installMember, session } = require('./mock-auth');

const phones = [{ width: 375, height: 812 }, { width: 600, height: 900 }, { width: 844, height: 390 }];
const more = page => page.locator('#more-button');
const menu = page => page.locator('#more-menu');

async function expectClosed(page) {
  await expect(menu(page)).toBeHidden();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(more(page)).toBeFocused();
}

async function expectAboveBar(page, locator) {
  await page.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const bar = await page.locator('.sidebar').boundingBox();
  const rect = await locator.boundingBox();
  expect(rect.y + rect.height).toBeLessThanOrEqual(bar.y);
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth,
    main: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth }));
  expect(widths.document).toBeLessThanOrEqual(page.viewportSize().width);
  expect(widths.main).toBeLessThanOrEqual(1);
}

for (const viewport of phones) {
  const size = `${viewport.width}×${viewport.height}`;
  test(`${size} 四格文字、點擊範圍、圖示與 Tab 順序；更多三種關閉方式`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const buttons = page.locator('.nav-actions>button:visible');
    await expect(buttons).toHaveCount(4);
    expect(await buttons.evaluateAll(elements => elements.map(el => ({
      action: el.dataset.action, label: el.querySelector('.nav-label').textContent,
      aria: el.getAttribute('aria-label'), title: el.title,
    })))).toEqual([
      { action: 'home', label: '潛在客戶', aria: '潛在客戶', title: '潛在客戶' },
      { action: 'leads', label: '客戶名單', aria: '客戶名單', title: '客戶名單' },
      { action: 'add', label: '新增', aria: '新增專案', title: '新增專案' },
      { action: 'more', label: '更多', aria: '更多', title: '更多' },
    ]);
    const bar = await page.locator('.sidebar').boundingBox();
    expect(bar.x).toBe(0);
    expect(bar.width).toBe(viewport.width);
    expect(bar.y + bar.height).toBe(viewport.height);
    await expect(page.locator('.avatar')).toBeHidden();
    for (let i = 0; i < 4; i++) {
      const button = buttons.nth(i);
      await expect(button.locator('.nav-label')).toBeVisible();
      await expect(button.locator('svg')).toHaveCount(1);
      const rect = await button.boundingBox();
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.y).toBe(bar.y + 1);
      expect(await button.locator('.nav-label').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    }
    const circle = await buttons.nth(2).locator('.nav-icon').evaluate(el => ({
      color: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius,
    }));
    expect(circle).toEqual({ color: 'rgb(0, 0, 0)', radius: '50%' });
    await buttons.first().focus();
    for (let i = 1; i < 4; i++) { await page.keyboard.press('Tab'); await expect(buttons.nth(i)).toBeFocused(); }
    await page.keyboard.press('Enter');
    await expect(more(page)).toHaveAttribute('aria-controls', 'more-menu');
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('button .nav-label')).toHaveText(['知識庫', '匯出本機資料', '使用說明']);
    for (let i = 0; i < 3; i++) {
      const button = menu(page).locator('button').nth(i);
      await expect(button).toBeFocused();
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await expect(button.locator('svg')).toHaveCount(1);
      expect(await button.locator('.nav-label').textContent()).toBe(await button.getAttribute('aria-label'));
      expect(await button.getAttribute('title')).toBe(await button.getAttribute('aria-label'));
      if (i < 2) await page.keyboard.press('Tab');
    }
    expect((await menu(page).boundingBox()).y).toBeGreaterThanOrEqual(0);
    expect((await menu(page).boundingBox()).y + (await menu(page).boundingBox()).height).toBeLessThan(bar.y);
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await more(page).click();
    await more(page).click();
    await expectClosed(page);
    await more(page).click();
    await page.locator('#list-view h1').click();
    await expectClosed(page);
    await expect(page.locator('.sidebar button:visible')).toHaveCount(4);
    // 共用圖示注入仍保留分頁與關閉鈕的既有行為。
    await expect(page.locator('#prev>svg')).toHaveCount(1);
    await expect(page.locator('#dismiss-toast>svg')).toHaveCount(1);
  });

  test(`${size} 更多三項功能與對話框焦點、匯出格式、頁首設定與登出`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await createProject(page, { name: '手機匯出測試' });
    await page.locator('[data-action="home"]').click();
    await page.locator('#dismiss-toast').click();
    for (const action of ['knowledge', 'help']) {
      await more(page).click();
      await menu(page).locator(`[data-action="${action}"]`).click();
      await expect(menu(page)).toBeHidden();
      await expect(page.locator('#info-dialog')).toBeVisible();
      if (action === 'knowledge') {
        await page.locator('#notes-form textarea').fill('手機測試筆記');
        await page.locator('#notes-form button[type="submit"]').click();
        expect(await page.evaluate(() => localStorage.getItem('genie-local-notes'))).toBe('手機測試筆記');
      } else {
        await expect(page.locator('#info-body')).toContainText('手機底部「更多」');
        await page.keyboard.press('Escape');
      }
      await expect(page.locator('#info-dialog')).toBeHidden();
      await expectClosed(page);
      if (action !== 'help') await page.locator('#dismiss-toast').click();
    }
    const name = page.locator('#home-account .account-name');
    await name.click();
    await expect(page.locator('#info-dialog')).toBeVisible();
    await page.locator('#account-form input').fill('手機測試名稱');
    await page.locator('#account-form button[type="submit"]').click();
    expect(await page.evaluate(() => localStorage.getItem('genie-local-name'))).toBe('手機測試名稱');
    await expect(name).toHaveText('測試成員');
    await expect(name).toBeFocused();
    await page.locator('#dismiss-toast').click();
    await more(page).click();
    const pending = page.waitForEvent('download');
    await menu(page).locator('[data-action="export"]').click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('客戶資料備份.json');
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(Object.keys(backup).sort()).toEqual(['displayName', 'notes', 'projects', 'version']);
    expect(backup.version).toBe(3);
    expect(backup.projects).toEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY));
    expect(backup.displayName).toBe('手機測試名稱');
    expect(backup.notes).toBe('手機測試筆記');
    await expectClosed(page);
    const bar = await page.locator('.sidebar').boundingBox();
    const toast = await page.locator('#toast').boundingBox();
    expect(toast.y + toast.height).toBeLessThan(bar.y);
    expect(toast.x + toast.width / 2).toBeCloseTo(viewport.width / 2, 0);
    await page.locator('#dismiss-toast').click();
    await more(page).click();
    await page.locator('#home-account [data-action="lead-signout"]').click();
    await expect(page.locator('#leads-login')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(menu(page)).toBeHidden();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test(`${size} 導覽切換、詳細頁、瀏覽器返回與最後內容不被底部列遮住`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expectAboveBar(page, page.locator('#list-view footer'));
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `nav-lead-${i}`, status: 'complete',
      customer_name: `測試名單 ${i + 1}`, answers: {}, contact_result: null,
      completed_at: '2026-10-01T00:00:00.000Z', lead_grade: 'normal' }));
    await page.route('**/rest/v1/customer_leads*', route => route.fulfill({ status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json',
        'content-range': '0-49/60', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(rows) }));
    const home = page.locator('[data-action="home"]');
    const leads = page.locator('[data-action="leads"]');
    await leads.click();
    await expect(page.locator('#leads-list')).toBeVisible();
    await expect(leads).toHaveAttribute('aria-current', 'page');
    await expect(home).toHaveAttribute('aria-current', 'false');
    await expect(page.locator('.lead-card:visible')).toHaveCount(50);
    await expectAboveBar(page, page.locator('#leads-list'));
    await expectAboveBar(page, page.locator('.lead-card:visible').last());
    await expectAboveBar(page, page.locator('.lead-more:visible'));
    await home.click();
    const id = await createProject(page);
    await expect(home).toHaveAttribute('aria-current', 'page');
    const paddings = [];
    for (const step of STEPS) {
      await goStep(page, step);
      await expectAboveBar(page, page.locator('.detail-body> :last-child'));
      paddings.push(await page.locator('.detail-body').evaluate(el => getComputedStyle(el).paddingBottom));
    }
    await leads.click();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#/p/${id}/proposal$`));
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(leads).toHaveAttribute('aria-current', 'false');
    await expect(page.locator('.nav-actions [aria-current="page"]')).toHaveCount(1);
    await expect(more(page)).not.toHaveAttribute('aria-current');
    await expect(page.locator('[data-action="add"]')).not.toHaveAttribute('aria-current');
    await home.click();
    paddings.push(await page.locator('.content').evaluate(el => getComputedStyle(el).paddingBottom));
    await leads.click();
    paddings.push(await page.locator('.leads-content').evaluate(el => getComputedStyle(el).paddingBottom));
    expect(new Set(paddings).size).toBe(1);
    await expect(page.locator('#detail-view .leads-account')).toHaveCount(0);
  });

  test(`${size} 右上角帳號區同列、長信箱省略、安全文字、登入更新與離線登出`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let displayName = '<img src=x onerror=alert(1)>', offline = false;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    await page.route('**/rest/v1/app_admins*', route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: offline ? 500 : 200, headers,
        body: offline ? '{}' : JSON.stringify([{ display_name: displayName, active: true }]) });
    });
    await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
    for (const view of ['home', 'leads']) {
      await page.locator(`[data-action="${view}"]`).click();
      const header = page.locator(view === 'home' ? '#list-view header' : '#leads-view header');
      await expect(header.locator('.account-name')).toHaveText(displayName);
      await expect(header.locator('.account-name')).toHaveAttribute('aria-label', `個人設定（${displayName}）`);
      await expect(header.locator('img')).toHaveCount(0);
      await expect(page.locator('button[data-action="account"]:visible')).toHaveCount(1);
      await expect(page.locator('button[data-action="signout"]:visible,button[data-action="lead-signout"]:visible')).toHaveCount(1);
      const title = await header.locator('h1').boundingBox();
      const logout = await header.locator('[data-action="lead-signout"]').boundingBox();
      expect(Math.abs(title.y + title.height / 2 - logout.y - logout.height / 2)).toBeLessThanOrEqual(1);
      expect(logout.x + logout.width).toBe(viewport.width - 16);
      for (const button of ['.account-name', '[data-action="lead-signout"]']) {
        const rect = await header.locator(button).boundingBox();
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.height).toBeGreaterThanOrEqual(44);
      }
      await header.locator('.account-name').click();
      await expect(page.locator('#info-dialog')).toContainText(displayName);
      await page.locator('#info-dialog [data-close]').click();
      await expect(header.locator('.account-name')).toBeFocused();
    }
    const email = 'a'.repeat(27) + '@example.test';
    displayName = '';
    const value = session();
    value.user.email = email;
    await page.route('**/auth/v1/token?grant_type=refresh_token', route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 200, headers, body: JSON.stringify(value) });
    });
    await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
    for (const view of ['home', 'leads']) {
      await page.locator(`[data-action="${view}"]`).click();
      const name = page.locator(view === 'home' ? '#home-account .account-name' : '#leads-view .account-name');
      await expect(name).toHaveText(email);
      const style = await name.evaluate(el => {
        const css = getComputedStyle(el), canvas = document.createElement('canvas').getContext('2d');
        canvas.font = css.font;
        return { clipped: canvas.measureText(el.textContent).width > el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
          ellipsis: css.textOverflow, minWidth: css.minWidth, overflow: css.overflowX, wrap: css.whiteSpace };
      });
      expect(style).toEqual({ clipped: true, ellipsis: 'ellipsis', minWidth: '0px', overflow: 'hidden', wrap: 'nowrap' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    }
    await page.screenshot({ path: test.info().outputPath(`account-${viewport.width}.png`) });
    offline = true;
    await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
    await expect(page.locator('#offline-banner')).toBeVisible();
    for (const view of ['home', 'leads']) {
      await page.locator(`[data-action="${view}"]`).click();
      const account = page.locator(view === 'home' ? '#home-account' : '#leads-view .leads-account');
      await expect(account).toBeVisible();
      const rect = await account.boundingBox();
      const banner = await page.locator('#offline-banner').boundingBox();
      expect(rect.y).toBeGreaterThanOrEqual(banner.y + banner.height);
    }
    await page.locator('#leads-view [data-action="lead-signout"]').click();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('#home-account .leads-account')).toHaveCount(0);
    await expect(page.locator('#leads-view .leads-account')).toHaveCount(0);
  });
}

for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  test(`${viewport.width}×${viewport.height} 維持左側欄外觀與按鈕順序`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(more(page)).toBeHidden();
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('.avatar')).toBeVisible();
    await expect(page.locator('#home-account')).toBeHidden();
    expect(await page.locator('.nav-actions>button:visible').evaluateAll(elements => elements.map(el => el.dataset.action)))
      .toEqual(['add', 'home', 'leads', 'knowledge', 'account', 'export']);
    expect(await page.locator('.sidebar-bottom>button').evaluateAll(elements => elements.map(el => el.dataset.action)))
      .toEqual(['signout', 'help']);
    const rect = await page.locator('.sidebar').boundingBox();
    expect(rect).toEqual({ x: 0, y: 0, width: 73, height: viewport.height });
    const avatar = await page.locator('.avatar').boundingBox();
    expect(avatar.width).toBe(46);
    expect(avatar.height).toBe(46);
    expect(avatar.y).toBe(24);
    expect(await page.locator('main').evaluate(el => el.getBoundingClientRect().left)).toBe(73);
    await expect(page.locator('.nav-actions .nav-label:visible')).toHaveCount(0);
    await expect(page.locator('.sidebar-bottom [data-action="signout"]')).toHaveText('登出');
    expect(await page.locator('.help-button svg').evaluate(el => el.getBoundingClientRect().width)).toBe(40);
  });
}

test('跨手機與左側欄切換時收起更多，反覆切換仍只有同一組按鈕', async ({ page }) => {
  await page.setViewportSize(phones[0]);
  await page.locator('.sidebar button').evaluateAll(elements => elements.forEach(el => { el.dataset.original = 'yes'; }));
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await more(page).click();
    await page.setViewportSize(viewport);
    await expect(menu(page)).toBeHidden();
    await expect(more(page)).toBeHidden();
    await expect(page.locator('.nav-actions>button:visible')).toHaveCount(6);
    await page.setViewportSize(phones[2]);
    await expect(menu(page)).toBeHidden();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.nav-actions>button:visible')).toHaveCount(4);
  }
  await expect(page.locator('.sidebar button[data-original="yes"]')).toHaveCount(10);
});

browserTest('手機未登入時底部列不出現', async ({ page }) => {
  await page.setViewportSize(phones[0]);
  await page.goto('/');
  await expect(page.locator('#leads-login')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(menu(page)).toBeHidden();
});

browserTest('手機更多開啟後權限失效，底部列與選單消失', async ({ page }) => {
  await installMember(page);
  await page.setViewportSize(phones[2]);
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await more(page).click();
  await page.route('**/rest/v1/app_admins*', route => route.fulfill({ status: 403,
    headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' }));
  await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
  await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(menu(page)).toBeHidden();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
});
