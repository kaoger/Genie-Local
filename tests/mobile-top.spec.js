'use strict';
const { test: browserTest } = require('@playwright/test');
const { test, expect, createProject } = require('./helpers');
const { installMember } = require('./mock-auth');

const phones = [{ width: 375, height: 812 }, { width: 600, height: 900 }, { width: 844, height: 390 }];
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
const topButton = page => page.getByRole('button', { name: '回到頂部', exact: true });
const title = page => page.locator('.page-header:visible h1');
const scroll = async (page, value) => {
  await page.locator('main').evaluate((el, top) => { el.scrollTop = top; }, value);
  await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBe(value);
};
async function leadsData(page, count = 12) {
  let requests = 0;
  await page.route('**/rest/v1/customer_leads*', route => {
    requests++;
    const rows = Array.from({ length: count }, (_, i) => ({ id: `top-lead-${i}`, status: 'complete',
      customer_name: `回頂測試 ${i + 1}`, answers: {}, contact_result: null,
      completed_at: '2026-10-01T00:00:00.000Z', lead_grade: 'normal' }));
    return route.fulfill({ status: 200, headers: { ...headers, 'content-range': `0-${count - 1}/${count}`,
      'access-control-expose-headers': 'content-range' }, body: JSON.stringify(rows) });
  });
  return () => requests;
}
async function openList(page, kind) {
  await page.locator(`[data-action="${kind}"]`).click();
  await expect(title(page)).toHaveText(kind === 'home' ? '潛在客戶' : '客戶名單');
  if (kind === 'leads') await expect(page.locator('.lead-card:visible')).toHaveCount(12);
}
async function expectHidden(page) {
  const button = page.locator('#back-to-top');
  await expect(button).toHaveAttribute('hidden', '');
  await expect(button).toBeHidden();
  // hidden 必須使按鈕不能取得鍵盤焦點。
  await button.evaluate(el => el.focus());
  await expect(button).not.toBeFocused();
}
test.describe('登入後手機回頂', () => {
test.afterEach(async ({ browserErrors }) => {
  // 離線測試刻意回傳 500；其他主控台與程式錯誤仍必須為零。
  expect(browserErrors.filter(error => !error.includes('server responded with a status of 500'))).toEqual([]);
});

for (const viewport of phones) {
  const size = `${viewport.width}×${viewport.height}`;
  for (const kind of ['home', 'leads']) {
    test(`${size} ${kind} 頁首固定、帳號操作、重新整理與換行離線橫幅`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const requests = await leadsData(page);
      await openList(page, kind);
      const header = page.locator('.page-header:visible');
      const initial = await header.boundingBox();
      if (kind === 'leads') {
        const refresh = page.getByRole('button', { name: '重新整理', exact: true });
        const rect = await refresh.boundingBox();
        expect(rect.y).toBeGreaterThanOrEqual(initial.y + initial.height);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        const before = requests();
        await refresh.click();
        await expect.poll(requests).toBeGreaterThan(before);
        await expect(page.locator('.lead-card:visible')).toHaveCount(12);
      }
      for (const position of ['middle', 'bottom']) {
        await page.locator('main').evaluate((el, where) => { el.scrollTop = where === 'middle' ? 500 : el.scrollHeight; }, position);
        await expect(topButton(page)).toBeVisible();
        expect((await header.boundingBox()).y).toBe(initial.y);
        if (kind === 'leads') {
          expect((await page.locator('.lead-refresh').boundingBox()).y + 44).toBeLessThan(0);
          expect((await page.locator('.lead-tabs').boundingBox()).y).toBeLessThan(0);
        }
        await header.locator('.account-name').click();
        await expect(page.locator('#info-dialog')).toBeVisible();
        await expectHidden(page);
        await page.locator('#info-dialog [data-close]').click();
        await expect(header.locator('.account-name')).toBeFocused();
      }
      await page.route('**/rest/v1/app_admins*', route => route.fulfill({ status: 500, headers, body: '{}' }));
      await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
      const banner = page.locator('#offline-banner');
      await expect(banner).toBeVisible();
      await banner.locator('span').evaluate(el => { el.textContent = '尚未重新確認成員（離線）'.repeat(8); });
      await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--offline-height')))).toBeGreaterThan(44);
      await expect.poll(async () => {
        const head = await header.boundingBox(), offline = await banner.boundingBox();
        return Math.abs(head.y - offline.y - offline.height);
      }).toBeLessThanOrEqual(1);
      await page.route('**/rest/v1/app_admins*', route => route.fulfill({ status: 200, headers,
        body: '[{"display_name":"測試成員","active":true}]' }));
      await banner.getByRole('button', { name: '重試', exact: true }).click();
      await expect(banner).toBeHidden();
      await expect.poll(async () => (await header.boundingBox()).y).toBe(0);
      await header.locator('[data-action="lead-signout"]').click();
      await expect(page.locator('#leads-login')).toBeVisible();
      await expectHidden(page);
    });

    test(`${size} ${kind} 回頂門檻、平滑捲動焦點、reduced-motion 與最後操作列`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await leadsData(page);
      await openList(page, kind);
      await expectHidden(page);
      await scroll(page, 240);
      await expectHidden(page);
      await scroll(page, 241);
      await expect(topButton(page)).toBeVisible();
      const rect = await topButton(page).boundingBox();
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.x + rect.width).toBe(viewport.width - 16);
      expect(rect.y + rect.height).toBeLessThan((await page.locator('.sidebar').boundingBox()).y);
      await scroll(page, 150);
      await expect(topButton(page)).toBeVisible();
      await scroll(page, 80);
      await expect(topButton(page)).toBeVisible();
      await scroll(page, 79);
      await expectHidden(page);
      await scroll(page, 150);
      await expectHidden(page);
      await scroll(page, 700);
      // 阻擋 scrollend，確認未提供此事件時仍會在捲動結束後聚焦。
      await page.locator('main').evaluate(el => el.addEventListener('scrollend', event => event.stopImmediatePropagation(), { capture: true }));
      await topButton(page).click();
      await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBe(0);
      await expect(title(page)).toBeFocused();
      await expectHidden(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await scroll(page, 700);
      await expect(topButton(page)).toBeVisible();
      // 同一個事件內驗證直接到頂，不用固定等待時間。
      expect(await page.locator('#back-to-top').evaluate(el => { el.click(); return document.querySelector('main').scrollTop; })).toBe(0);
      await expect(title(page)).toBeFocused();
      await page.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(topButton(page)).toBeVisible();
      const button = await topButton(page).boundingBox();
      for (const selector of kind === 'home' ? ['.project-card-actions'] : ['.lead-actions:visible', '.lead-project-action:visible']) {
        const actions = await page.locator(selector).last().boundingBox();
        expect(actions.y + actions.height).toBeLessThan(button.y);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      expect(await page.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      if (kind === 'home' && viewport.width === 375) await page.screenshot({ path: test.info().outputPath('mobile-top.png') });
    });
  }
}

for (const kind of ['home', 'leads']) {
  test(`${kind} toast、更多、對話框與抽屜隱藏回頂；關閉後恢復`, async ({ page }) => {
    await page.setViewportSize(phones[0]);
    await leadsData(page);
    await openList(page, kind);
    await scroll(page, 600);
    await expect(topButton(page)).toBeVisible();
    await page.evaluate(() => window.GenieToast('測試通知', { duration: 60000 }));
    await expectHidden(page);
    await page.locator('#dismiss-toast').click();
    await expect(topButton(page)).toBeVisible();
    await page.locator('#more-button').click();
    await expectHidden(page);
    await page.keyboard.press('Escape');
    await expect(topButton(page)).toBeVisible();
    await page.locator('[data-action="add"]').click();
    await expect(page.locator('#editor')).toBeVisible();
    await expectHidden(page);
    await page.locator('#editor [data-close]').first().click();
    await expect(topButton(page)).toBeVisible();
    // 抽屜正常只由詳細頁開啟，此處直接開既有 dialog 驗證同一隱藏規則。
    await page.locator('#drawer').evaluate(el => el.showModal());
    await expectHidden(page);
    await page.keyboard.press('Escape');
    await expect(topButton(page)).toBeVisible();
  });
}

test('平滑捲動中切頁／開對話框取消焦點；分類、重畫、資料縮短與尺寸更新', async ({ page }) => {
  await page.setViewportSize(phones[0]);
  await leadsData(page);
  await scroll(page, 900);
  await expect(topButton(page)).toBeVisible();
  await page.evaluate(() => { document.querySelector('#back-to-top').click(); location.hash = '#/leads'; });
  await expect(title(page)).toHaveText('客戶名單');
  await expectHidden(page);
  await expect(title(page)).not.toBeFocused();
  await expect(page.locator('.lead-card:visible')).toHaveCount(12);
  await scroll(page, 900);
  await expect(topButton(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await expectHidden(page);
  await expect(page.locator('.lead-card:visible')).toHaveCount(12);
  await scroll(page, 900);
  await expect(topButton(page)).toBeVisible();
  await page.evaluate(() => { document.querySelector('#back-to-top').click(); document.querySelector('[data-action="add"]').click(); });
  await expect(page.locator('#editor')).toBeVisible();
  await expectHidden(page);
  await expect(title(page)).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toBeHidden();
  await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBe(0);
  await expect(title(page)).not.toBeFocused();
  await scroll(page, 900);
  await expect(topButton(page)).toBeVisible();
  // 以程式觸發分類切換，避免 Playwright 自動捲到標籤先改變 scrollTop。
  await page.locator('[data-lead-tab="contacted"]').evaluate(el => el.click());
  await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBe(0);
  await expectHidden(page);
  await scroll(page, 900);
  await expect(topButton(page)).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expectHidden(page);
  await expect(page.locator('.leads-header .lead-refresh')).toHaveCount(1);
  await page.setViewportSize(phones[0]);
  await expect(page.locator('.leads-content>.lead-refresh')).toHaveCount(1);
  await scroll(page, 900);
  await expect(topButton(page)).toBeVisible();
  await leadsData(page, 0);
  await page.evaluate(() => window.GenieLeads.refresh());
  await expect(page.locator('.lead-card:visible')).toHaveCount(0);
  await expectHidden(page);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(title(page)).toHaveText('潛在客戶');
  await scroll(page, 600);
  await expect(topButton(page)).toBeVisible();
  await page.locator('[data-action="home"]').click();
  await expectHidden(page);
  await createProject(page);
  await page.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expectHidden(page);
  expect(await page.locator('.detail-header').evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  expect((await page.locator('.detail-header').boundingBox()).y).toBe(0);
});

for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  test(`${viewport.width}×${viewport.height} 清單頁首維持非固定、重新整理位置不變`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await leadsData(page);
    for (const kind of ['home', 'leads']) {
      await openList(page, kind);
      const header = page.locator('.page-header:visible');
      expect(await header.evaluate(el => getComputedStyle(el).position)).toBe('static');
      if (kind === 'leads') await expect(header.locator('.lead-refresh')).toBeVisible();
      await page.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
      expect((await header.boundingBox()).y).toBeLessThan(0);
      await expectHidden(page);
    }
  });
}

});

browserTest('手機未登入／權限失效時回頂不在可見與 Tab 順序', async ({ page }) => {
  await page.setViewportSize(phones[0]);
  await page.goto('/');
  await expect(page.locator('#leads-login')).toBeVisible();
  await expectHidden(page);
  await installMember(page);
  await page.reload();
  await expect(title(page)).toHaveText('潛在客戶');
  await scroll(page, 600);
  await expect(topButton(page)).toBeVisible();
  await page.route('**/rest/v1/app_admins*', route => route.fulfill({ status: 403, headers, body: '{}' }));
  await page.evaluate(() => window.GenieAuth.getClient().auth.refreshSession());
  await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限');
  await expectHidden(page);
});
