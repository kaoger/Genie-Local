'use strict';
const { test: browserTest, expect } = require('@playwright/test');
const { test, createProject, fillRequired, goStep, markComplete } = require('./helpers');

async function expectFits(page, width) {
  await page.evaluate(() => document.fonts.ready);
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    main: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(width + 1);
  expect(sizes.main).toBeLessThanOrEqual(1);
}

browserTest('375 與 844px 登入欄位不觸發 iOS 文字放大，畫面不橫向溢出', async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#leads-login')).toBeVisible();
    const fontSizes = await page.locator('#leads-login input').evaluateAll(elements => elements.map(el => parseFloat(getComputedStyle(el).fontSize)));
    expect(fontSizes.every(size => size >= 16)).toBe(true);
    await expectFits(page, viewport.width);
  }
});

test('375、768、844、1280 四種寬度巡檢清單、六步驟、drawer、對話框與客戶名單', async ({ page }) => {
  test.setTimeout(90000);
  const id = await createProject(page);
  await fillRequired(page);
  await markComplete(page, 'brief');
  for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '潛在客戶', exact: true }).click();
    await expectFits(page, viewport.width);
    await page.goto(`/#/p/${id}/brief`);
    for (const step of ['brief', 'strategy', 'visual', 'model3d', 'estimate', 'proposal']) {
      if (step !== 'brief') await goStep(page, step);
      await expectFits(page, viewport.width);
    }
    await goStep(page, 'brief');
    await page.getByRole('button', { name: '編輯全部資料', exact: true }).click();
    await expectFits(page, viewport.width);
    if (viewport.width === 375 || viewport.width === 844) {
      const inputs = await page.locator('#drawer input:not([type="checkbox"]):visible, #drawer select:visible, #drawer textarea:visible').evaluateAll(elements => elements.map(el => parseFloat(getComputedStyle(el).fontSize)));
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.every(size => size >= 16)).toBe(true);
    }
    await page.locator('#drawer').getByRole('button', { name: '關閉' }).click();
    await goStep(page, 'strategy');
    await page.locator('[data-action="strategy-paste"]').click();
    await expectFits(page, viewport.width);
    await page.locator('#info-dialog [data-close]').first().click();
    await page.getByRole('button', { name: '客戶名單', exact: true }).click();
    await expect(page.locator('#leads-list')).toBeVisible();
    await expectFits(page, viewport.width);
    await page.locator('[data-lead-tab="contacted"]').click();
    await expectFits(page, viewport.width);
    if (viewport.width <= 900) {
      const buttons = await page.locator('.sidebar button:visible').evaluateAll(elements => elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
      expect(buttons.filter(size => size.width < 44 || size.height < 44)).toEqual([]);
      if (viewport.width === 375 || viewport.width === 844) {
        const padding = await page.locator('.leads-content').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
        expect(padding).toBeGreaterThanOrEqual(150);
      }
    }
  }
});

test('375px 離線橫幅換行後，main 留出實際高度且側欄可捲', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 390 });
  await page.locator('#offline-banner span').evaluate(el => { el.textContent = '尚未重新確認成員（離線），請等待網路恢復後重新確認登入身分'; });
  await page.locator('#offline-banner').evaluate(el => { el.hidden = false; });
  await expect.poll(() => page.evaluate(() => {
    const padding = parseFloat(getComputedStyle(document.querySelector('main')).paddingTop);
    const height = document.querySelector('#offline-banner').getBoundingClientRect().height;
    return height > 44 && padding >= height - 1;
  })).toBe(true);
  const sizes = await page.evaluate(() => ({
    padding: parseFloat(getComputedStyle(document.querySelector('main')).paddingTop),
    height: document.querySelector('#offline-banner').getBoundingClientRect().height,
    sidebarScroll: document.querySelector('.sidebar').scrollHeight,
    sidebarHeight: document.querySelector('.sidebar').clientHeight,
  }));
  expect(sizes.padding).toBeGreaterThanOrEqual(sizes.height - 1);
  expect(sizes.sidebarScroll).toBeGreaterThan(sizes.sidebarHeight);
  await expectFits(page, 375);
});
