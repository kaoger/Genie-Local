'use strict';
const { test, expect, STORAGE_KEY, createProject, openEditor, saveEditor, goStep, stepMeta } = require('./helpers');

async function editArea(page, range, exact = '') {
  await openEditor(page);
  await page.locator('#drawer-form [name="area"]').fill(exact);
  await page.locator('#drawer-form [name="areaRange"]').selectOption(range);
  await saveEditor(page);
}

test('坪數區間與精確坪數擇一即可確認；尚未確定仍缺坪數', async ({ page }) => {
  await createProject(page);
  await openEditor(page);
  const form = page.locator('#drawer-form');
  await form.getByLabel('現代簡約', { exact: true }).check();
  await form.getByLabel('夫妻', { exact: true }).check();
  await form.getByLabel('全室裝修', { exact: true }).check();
  await form.locator('[name="areaRange"]').selectOption('尚未確定');
  await saveEditor(page);
  await expect(page.locator('#status-slot')).toContainText('坪數區間為尚未確定，請改選或填精確坪數');
  await expect(page.locator('#status-slot')).toContainText('坪數或坪數區間');
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await editArea(page, '21–30 坪');
  await expect(page.locator('#status-slot')).toContainText('可以確認');
  await page.locator('#status-slot [data-action="complete"]').click();
  await expect(stepMeta(page, 'brief')).toHaveText('已完成');
  await editArea(page, '尚未確定', '35');
  await expect(stepMeta(page, 'brief')).toHaveText('需更新');
  await page.locator('#status-slot [data-action="complete"]').click();
  await expect(stepMeta(page, 'brief')).toHaveText('已完成');
});

test('策略指令精確坪數在前、區間在後；展覽類型可複製', async ({ page }) => {
  for (const type of ['居家裝潢設計', '商業空間設計', '展覽空間設計']) {
    await createProject(page, { type });
    await openEditor(page);
    const form = page.locator('#drawer-form');
    await form.locator('[name="areaRange"]').selectOption('21–30 坪');
    if (type === '居家裝潢設計') {
      await form.getByLabel('現代簡約', { exact: true }).check();
      await form.getByLabel('夫妻', { exact: true }).check();
      await form.getByLabel('全室裝修', { exact: true }).check();
    } else {
      await form.locator('[name="usage"]').fill('品牌展位');
      await form.getByLabel('現代簡約', { exact: true }).check();
      await form.getByLabel(type === '展覽空間設計' ? '展場搭建' : '全區裝修', { exact: true }).check();
    }
    await saveEditor(page);
    await page.locator('#status-slot [data-action="complete"]').click();
    await goStep(page, 'strategy');
    await page.locator('[data-action="strategy-prompt"]').click();
    const prompt = await page.locator('#strategy-prompt-text').inputValue();
    expect(prompt).toMatch(/坪數：未填\n坪數區間：21–30 坪/);
    await page.locator('#info-dialog [data-close]').first().click();
  }
});

test('只有區間時估價設計費維持 0；改區間不改估價依據', async ({ page }) => {
  await createProject(page);
  await openEditor(page);
  const form = page.locator('#drawer-form');
  await form.locator('[name="areaRange"]').selectOption('21–30 坪');
  await form.getByLabel('現代簡約', { exact: true }).check();
  await form.getByLabel('夫妻', { exact: true }).check();
  await form.getByLabel('全室裝修', { exact: true }).check();
  await saveEditor(page);
  await page.locator('#status-slot [data-action="complete"]').click();
  await goStep(page, 'estimate');
  await expect(page.locator('[data-est-id="design"] [data-est-field="qty"]')).toHaveValue('');
  await expect(page.locator('[data-est-id="design"] .area-link')).toContainText('需求沒有精確坪數，數量是 0。目前只有區間：21–30 坪。填了精確坪數才會帶入。');
  await page.locator('[data-est-id="design"] [data-est-field="qty"]').fill('1');
  await page.locator('[data-est-id="design"] [data-est-field="qty"]').press('Tab');
  for (const price of await page.locator('[data-est-field="price"]').all()) {
    await price.fill('1000');
    await price.press('Tab');
  }
  await page.getByLabel('有效期限', { exact: true }).fill('2030-12-31');
  await page.getByLabel('報價範圍與說明', { exact: true }).fill('設計與施工圖');
  await page.getByLabel('報價範圍與說明', { exact: true }).press('Tab');
  await page.locator('#status-slot [data-action="complete"]').click();
  await goStep(page, 'brief');
  await editArea(page, '31–40 坪');
  await page.locator('#status-slot [data-action="complete"]').click();
  await expect(stepMeta(page, 'estimate')).toHaveText('已完成');
  const [project] = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(project.steps.estimate.basis.deps).not.toHaveProperty('areaRange');
});

test('舊其他需求區間提示不計入新欄；375 與 844 新畫面無橫向捲動且操作元件足夠大', async ({ page }) => {
  await createProject(page);
  await openEditor(page);
  await page.locator('#drawer-form [name="needsNote"]').fill('坪數（客人勾選）：21–30 坪');
  await saveEditor(page);
  const fits = async width => {
    const size = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, main: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth }));
    expect(size.document).toBeLessThanOrEqual(width + 1);
    expect(size.main).toBeLessThanOrEqual(1);
  };
  for (const viewport of [{ width: 375, height: 812 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await goStep(page, 'brief');
    await expect(page.getByText('其他需求裡的區間不會算進新欄位，請在坪數區間重選一次')).toBeVisible();
    await expect(page.locator('#status-slot')).toContainText('坪數或坪數區間');
    await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
    const field = page.locator('[data-edit-field="areaRange"]');
    await expect(field).toContainText('未填');
    const fieldSize = await field.boundingBox();
    expect(fieldSize.width).toBeGreaterThanOrEqual(44);
    expect(fieldSize.height).toBeGreaterThanOrEqual(44);
    await fits(viewport.width);
    await openEditor(page);
    const select = page.locator('#drawer-form [name="areaRange"]');
    await expect(select).toBeVisible();
    const selectSize = await select.boundingBox();
    expect(selectSize.width).toBeGreaterThanOrEqual(44);
    expect(selectSize.height).toBeGreaterThanOrEqual(44);
    await fits(viewport.width);
    await page.locator('#drawer').getByRole('button', { name: '關閉' }).click();
    await goStep(page, 'estimate');
    await expect(page.locator('[data-est-id="design"] .area-link')).toContainText('需求沒有精確坪數，數量是 0。目前只有區間：未填。填了精確坪數才會帶入。');
    await fits(viewport.width);
  }
});
