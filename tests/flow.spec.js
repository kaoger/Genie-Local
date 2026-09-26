'use strict';
const {
  test, expect, STEPS, createProject, goStep, stepMeta, expectSteps, fillRequired,
  editFields, markComplete, generateStrategy, fillEstimate, completeAllSteps,
} = require('./helpers');

const allDone = Object.fromEntries(STEPS.map(id => [id, '已完成']));

test('驗收 4：補必填、確認、生成與人工完成依序解開後續操作', async ({ page }) => {
  await createProject(page);
  await fillRequired(page);
  await expect(stepMeta(page, 'brief')).toHaveText('可以確認');
  await expect(stepMeta(page, 'strategy')).toHaveText('需先確認需求');
  await markComplete(page, 'brief');
  await expect(stepMeta(page, 'strategy')).toHaveText('可以生成');
  await generateStrategy(page);
  await expect(stepMeta(page, 'strategy')).toHaveText('待標記完成');
  await expectSteps(page, { visual: '需先完成策略', model3d: '需先完成策略' });
  await markComplete(page, 'strategy');
  await expectSteps(page, { visual: '待標記完成', model3d: '待標記完成', estimate: '可以開始' });
  await goStep(page, 'estimate');
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await expect(page.locator('#status-slot')).toContainText('至少需要一筆有效明細');
  await expect(page.locator('#status-slot')).toContainText('報價範圍必填');
  await expect(page.locator('#status-slot')).toContainText('有效期限必填');
  await goStep(page, 'proposal');
  await expect(page.locator('#status-slot')).toContainText('尚未完成：視覺發想');
  await expect(page.locator('#status-slot')).toContainText('尚未完成：3D 建模');
  await expect(page.locator('#status-slot')).toContainText('尚未完成：業務估價');
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
});

test('驗收 5／17：坪數 35→40 讓六步驟需更新，舊策略保留且估價連動', async ({ page }) => {
  await completeAllSteps(page);
  await editFields(page, { area: '40' });
  await expectSteps(page, Object.fromEntries(STEPS.map(id => [id, '需更新'])));
  await expect(page.locator('#status-slot')).toContainText('引用的內容已更新：需求總覽、策略企劃、視覺發想、3D 建模、業務估價');
  const reasons = {
    brief: '需求修改了：坪數', strategy: '需求修改了：坪數',
    visual: '會帶入的資料修改了：坪數', model3d: '會帶入的資料修改了：坪數',
    estimate: '估價引用的需求修改了：坪數',
  };
  for (const [id, reason] of Object.entries(reasons)) {
    await goStep(page, id);
    await expect(page.locator('#status-slot')).toContainText(reason);
  }
  await goStep(page, 'strategy');
  await expect(page.locator('.doc-table tr').filter({ has: page.getByRole('rowheader', { name: '坪數', exact: true }) }).locator('td')).toHaveText('35 坪');
  await expect(page.locator('#status-slot').getByRole('link', { name: '前往需求總覽', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新生成', exact: true })).toHaveCount(0);
  await goStep(page, 'estimate');
  await expect(page.getByRole('spinbutton', { name: '第 1 列數量', exact: true })).toHaveValue('40');
  await expect(page.locator('[data-est-id="design"]')).toContainText('沿用需求坪數');
  await markComplete(page, 'brief');
  await expect(stepMeta(page, 'estimate')).toHaveText('需更新');
  await markComplete(page, 'estimate');
  await expect(stepMeta(page, 'proposal')).toHaveText('需更新');
});

test('驗收 15：取消確認使下游顯示上游需更新，原內容再確認自動恢復', async ({ page }) => {
  await completeAllSteps(page);
  await goStep(page, 'brief');
  await page.getByRole('button', { name: '取消確認', exact: true }).click();
  await expect(stepMeta(page, 'brief')).toHaveText('可以確認');
  await expectSteps(page, Object.fromEntries(STEPS.slice(1).map(id => [id, '上游需更新'])));
  await goStep(page, 'proposal');
  for (const label of ['需求總覽', '策略企劃', '視覺發想', '3D 建模', '業務估價']) {
    await expect(page.locator('#status-slot')).toContainText(`『${label}』目前不是已完成`);
  }
  await expect(page.locator('#status-slot')).not.toContainText('引用的內容已更新');
  await markComplete(page, 'brief');
  await expectSteps(page, allDone);
  await goStep(page, 'proposal');
  await expect(page.locator('#status-slot .status-bar')).toHaveClass('status-bar is-done');
  await page.reload();
  await expectSteps(page, allDone);
});

test('驗收 16：重新生成策略只讓策略、視覺、3D 與提案需更新', async ({ page }) => {
  await completeAllSteps(page);
  await generateStrategy(page);
  await expectSteps(page, { ...allDone, strategy: '需更新', visual: '需更新', model3d: '需更新', proposal: '需更新' });
  await expect(page.locator('details summary')).toContainText('上一版');
  for (const id of ['strategy', 'visual', 'model3d']) {
    await goStep(page, id);
    await expect(page.locator('#status-slot')).toContainText('策略企劃已重新生成');
  }
  await goStep(page, 'proposal');
  await expect(page.locator('#status-slot')).toContainText('引用的內容已更新：策略企劃、視覺發想、3D 建模');
  await markComplete(page, 'strategy');
  await expectSteps(page, { visual: '需更新', model3d: '需更新', estimate: '已完成', proposal: '需更新' });
});

test('驗收 18：改地址後重確認，估價自動恢復，策略與下游仍需更新', async ({ page }) => {
  await completeAllSteps(page);
  await editFields(page, { address: '測試路 100 號' });
  await expectSteps(page, { brief: '需更新', strategy: '需更新', visual: '上游需更新', model3d: '上游需更新', estimate: '上游需更新', proposal: '需更新' });
  await markComplete(page, 'brief');
  await expectSteps(page, { brief: '已完成', strategy: '需更新', visual: '上游需更新', model3d: '上游需更新', estimate: '已完成', proposal: '需更新' });
  await goStep(page, 'strategy');
  await expect(page.locator('#status-slot')).toContainText('需求修改了：地址');
  await expect(page.locator('#status-slot')).toContainText('策略依舊需求產生，須重新生成');
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: '重新生成', exact: true })).toBeEnabled();
  await goStep(page, 'proposal');
  await expect(page.locator('#status-slot')).toContainText('引用的內容已更新：需求總覽、策略企劃');
  await expect(page.locator('#status-slot')).toContainText('『視覺發想』目前不是已完成');
  await expect(page.locator('#status-slot')).not.toContainText('尚未完成：業務估價');
});

test('驗收 19：改專案名稱只有提案需更新，並顯示名稱原因', async ({ page }) => {
  await completeAllSteps(page);
  await editFields(page, { name: '修改後的測試專案' });
  await expectSteps(page, { ...allDone, proposal: '需更新' });
  await expect(page.locator('#status-slot')).toContainText('專案名稱已修改');
  await expect(page.locator('#status-slot')).not.toContainText('引用的內容已更新');
  await expect(page.locator('.crumbs h1')).toHaveText('修改後的測試專案');
});

test('驗收 7：品牌 3D 本版不提供，清單目前步驟跳過 3D', async ({ page }) => {
  const id = await createProject(page, { type: '品牌設計' });
  await goStep(page, 'model3d');
  await expect(stepMeta(page, 'model3d')).toHaveText('本版不提供');
  await expect(page.locator('#status-slot')).toContainText('不適用');
  await expect(page.locator('#status-slot')).toContainText('『品牌設計』本版未提供 3D 建模。');
  await expect(page.locator('[data-skip="model3d"]')).toHaveCount(0);
  await fillRequired(page, { type: '品牌設計' });
  await markComplete(page, 'brief');
  await generateStrategy(page);
  await markComplete(page, 'strategy');
  await markComplete(page, 'visual');
  await page.getByRole('link', { name: '潛在客戶', exact: true }).click();
  const row = page.locator(`#rows tr[data-id="${id}"]`);
  await expect(row.locator('td').nth(9)).toHaveText('⑤ 業務估價・可開始');
  await row.locator('td').nth(9).getByRole('link').click();
  await fillEstimate(page);
  await markComplete(page, 'estimate');
  await markComplete(page, 'proposal');
  await expect(page.getByRole('heading', { name: '4 3D 建模', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '潛在客戶', exact: true }).click();
  await expect(row.locator('td').nth(9)).toHaveText('提案已完成');
});

test('驗收 8：視覺不採用時不阻擋提案完成，且不出現在提案中', async ({ page }) => {
  await completeAllSteps(page, { skipVisual: true });
  await expect(page.getByRole('heading', { name: '3 視覺發想', exact: true })).toHaveCount(0);
  await expect(page.locator('#status-slot')).not.toContainText('尚未完成：視覺發想');
  await goStep(page, 'visual');
  await expect(page.locator('#status-slot')).toContainText('不適用');
  await expect(page.locator('#status-slot')).toContainText('本案不採用此步驟');
  await page.getByRole('button', { name: '改為採用', exact: true }).click();
  await goStep(page, 'proposal');
  await expect(stepMeta(page, 'proposal')).toHaveText('需更新');
  await expect(page.locator('#status-slot')).toContainText('尚未完成：視覺發想');
  await expect(page.locator('#status-slot')).toContainText('引用的內容已更新：視覺發想');
});
