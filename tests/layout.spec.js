'use strict';
const { test, expect, createProject, fillRequired, goStep, fillEstimate, projectItems } = require('./helpers');

test.use({ viewport: { width: 375, height: 812 } });

test('驗收 14：375×812 清單、需求、估價與提案無整頁橫向溢位，console error 為零', async ({ page, browserErrors }) => {
  async function expectNoOverflow(label) {
    await page.evaluate(() => document.fonts.ready);
    await expect.soft(page.locator('body'), `${label}有內容`).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(width, `${label}整頁寬度`).toBeLessThanOrEqual(375);
  }
  await expect(page).toHaveTitle('潛在客戶｜Genie-Local v4');
  await expect(projectItems(page)).toHaveCount(8);
  await expectNoOverflow('清單');
  await createProject(page);
  await fillRequired(page);
  await expectNoOverflow('需求');
  await fillEstimate(page);
  await expect(page.locator('#estimate-form')).toBeVisible();
  await expectNoOverflow('估價');
  await goStep(page, 'proposal');
  await expect(page.getByRole('heading', { name: '1 專案概要', exact: true })).toBeVisible();
  await expectNoOverflow('提案');
  expect(browserErrors, '全程 console error 與未捕捉例外').toEqual([]);
});
