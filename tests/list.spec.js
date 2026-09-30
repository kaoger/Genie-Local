'use strict';
const { test, expect, STORAGE_KEY, STEPS, goStep, stepMeta, storedProjects, projectItems } = require('./helpers');

test('驗收 1：v3 舊資料可載入，來源未註明，done 不影響六步驟', async ({ page, browserErrors }) => {
  const brief = { area: '35', style: ['現代簡約'], members: ['夫妻'], renoType: '全室裝修' };
  const legacy = [true, false].map((done, i) => ({
    id: `legacy-${i}`, name: `舊版測試 ${i + 1}`, date: '2026-01-01',
    type: '居家裝潢設計', done, brief, strategyStale: true,
  }));
  await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: STORAGE_KEY, data: legacy });
  await page.reload();
  await expect(projectItems(page)).toHaveCount(2);
  const expected = ['可以確認', '需先確認需求', '需先完成策略', '需先完成策略', '可以開始', '需先確認需求'];
  for (const project of legacy) {
    const row = page.locator(`#rows tr[data-id="${project.id}"]`);
    await expect(row.locator('td').nth(8)).toHaveText('未註明');
    await expect(row.locator('td').nth(9)).toHaveText('① 需求總覽・可開始');
    await row.locator('.project-name').click();
    await expect(page.locator('.source-card')).toContainText('未註明來源（舊資料），請選擇');
    for (const [index, id] of STEPS.entries()) {
      await goStep(page, id);
      await expect(stepMeta(page, id)).toHaveText(expected[index]);
    }
    await page.getByRole('link', { name: '潛在客戶', exact: true }).click();
  }
  expect(browserErrors).toEqual([]);
});

test('驗收 2：全新瀏覽器有 8 筆示範資料，來源與目前步驟正確', async ({ page }) => {
  await expect(page).toHaveTitle('潛在客戶｜Genie-Local v4');
  await expect(projectItems(page)).toHaveCount(8);
  await expect(page.locator('#rows .example-row')).toHaveCount(1);
  await expect(page.locator('#count')).toHaveText('8 / 8');
  const sources = ['客戶已送出', '客戶已送出', '手動建立', '客戶已送出', '客戶已送出', '客戶已送出', '手動建立', '手動建立'];
  for (let i = 0; i < 8; i++) {
    const row = page.locator(`#rows tr[data-id="sample-${i}"]`);
    await expect(row.locator('td').nth(8)).toHaveText(sources[i]);
    await expect(row.locator('td').nth(9)).toHaveText(`① 需求總覽・${i === 0 ? '可開始' : '缺資料'}`);
    await expect(row.locator('td').nth(9).getByRole('link')).toHaveAttribute('href', `#/p/sample-${i}/brief`);
  }
});

test('驗收 12：批次刪除兩筆後，整批復原且順序不變', async ({ page }) => {
  const rows = page.locator('#rows tr[data-id]');
  const before = await rows.evaluateAll(elements => elements.map(el => el.dataset.id));
  // 選擇不相鄰列，避免只測到連續插回的情境。
  for (const id of [before[1], before[5]]) await page.locator(`#rows [data-select="${id}"]`).check();
  await page.getByRole('button', { name: '刪除所選', exact: true }).click();
  await expect(page.locator('#confirm-copy')).toHaveText('確定刪除所選的 2 個專案？');
  await page.locator('#confirm-delete').click();
  await expect(projectItems(page)).toHaveCount(6);
  const remaining = before.filter((_, i) => i !== 1 && i !== 5);
  expect(await rows.evaluateAll(elements => elements.map(el => el.dataset.id))).toEqual(remaining);
  expect((await storedProjects(page)).map(p => p.id)).toEqual(remaining);
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(projectItems(page)).toHaveCount(8);
  expect(await rows.evaluateAll(elements => elements.map(el => el.dataset.id))).toEqual(before);
  expect((await storedProjects(page)).map(p => p.id)).toEqual(before);
  await page.reload();
  await expect(projectItems(page)).toHaveCount(8);
  expect(await rows.evaluateAll(elements => elements.map(el => el.dataset.id))).toEqual(before);
});

test('首頁 900px 以下改用卡片，保留全選、批次刪除、復原與分頁', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const cards = page.locator('#project-cards article[data-id]');
  await expect(cards).toHaveCount(8);
  await expect(page.locator('.project-cards')).toBeVisible();
  await expect(page.locator('.table-scroll')).toBeHidden();
  await expect(page.locator('.card-example')).toContainText('不是客戶資料');
  await expect(cards.first()).toContainText('示範');
  await expect(cards.first()).toContainText('聯絡人');
  await expect(cards.first()).toContainText('洽詢日期');
  await expect(cards.first()).toContainText('需求來源');
  await expect(cards.first()).toContainText('目前步驟');
  await expect(cards.first()).not.toContainText('電子信箱');
  const targets = await cards.first().locator('.project-card-select, .project-card-actions a, .project-card-actions button').evaluateAll(elements => elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  expect(targets.every(size => size.width >= 44 && size.height >= 44)).toBe(true);
  await page.locator('#project-cards [data-select="sample-0"]').check();
  await expect(page.locator('#selected-count')).toHaveText('已選取 1 個專案');
  await page.locator('#card-select-all').check();
  await expect(page.locator('#selected-count')).toHaveText('已選取 8 個專案');
  await page.getByRole('button', { name: '刪除所選', exact: true }).click();
  await page.locator('#confirm-delete').click();
  await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(cards).toHaveCount(8);
  await page.evaluate(key => {
    const rows = JSON.parse(localStorage.getItem(key));
    rows.push({ ...rows[0], id: 'page-nine', name: '第九筆' });
    localStorage.setItem(key, JSON.stringify(rows));
  }, STORAGE_KEY);
  await page.reload();
  await page.locator('#next').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('第九筆');
});

test('卡片整卡可進專案，獨立操作不誤觸；900px 以上保留表格', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1024 });
  await expect(page.locator('.project-cards')).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  const card = page.locator('#project-cards [data-id="sample-0"]');
  await card.locator('[data-copy]').click();
  await expect(page).not.toHaveURL(/#\/p\//);
  await expect(page.locator('#project-cards article[data-id]')).toHaveCount(8);
  await card.locator('h2').click();
  await expect(page).toHaveURL(/#\/p\/sample-0\/brief$/);
  await page.getByRole('link', { name: '潛在客戶', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.table-scroll')).toBeVisible();
  await expect(page.locator('.project-cards')).toBeHidden();
});

test('375px 的 96 筆專案分 12 頁時，分頁不造成橫向捲動', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#project-cards [data-id="sample-0"] [data-copy]').click();
  await page.evaluate(key => {
    const projects = JSON.parse(localStorage.getItem(key));
    for (let i = projects.length; i < 96; i++) projects.push({ ...projects[0], id: `many-${i}`, name: `專案 ${i}` });
    localStorage.setItem(key, JSON.stringify(projects));
  }, STORAGE_KEY);
  await page.reload();
  await expect(projectItems(page)).toHaveCount(8);
  await expect(page.locator('#pages')).toHaveAttribute('data-total', '12');
  await expect(page.locator('#pages .current')).toBeVisible();
  const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, main: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth }));
  expect(sizes.document).toBeLessThanOrEqual(376);
  expect(sizes.main).toBeLessThanOrEqual(1);
  await page.locator('#next').click();
  await expect(page.locator('#pages .current')).toHaveText('2');
  await expect(page.locator('#pages')).toHaveAttribute('data-total', '12');
});
