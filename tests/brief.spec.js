'use strict';
const {
  test, expect, STEPS, createProject, goStep, stepMeta, expectSteps, openEditor,
  saveEditor, fillRequired, editFields, completeAllSteps, storedProjects,
} = require('./helpers');

test('驗收 3：新增預設居家專案，缺必填 0/4，六步驟都能開啟', async ({ page }) => {
  await createProject(page);
  await expect(page.locator('.detail-actions .type-tag')).toHaveText('居家裝潢設計');
  await expect(page.locator('#status-slot')).toContainText('缺資料');
  await expect(stepMeta(page, 'brief')).toHaveText('必填 0/4');
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await expect(page.locator('.source-card [data-source="manual"]')).toHaveAttribute('aria-pressed', 'true');
  for (const id of STEPS) {
    await goStep(page, id);
    await expect(page.locator('#status-slot')).toBeVisible();
    await expect(page.locator('.detail-body > .card, .detail-body > .empty-card').first()).toBeVisible();
  }
});

for (const [field, label, value] of [['phone', '電話', '0000000000'], ['notes', '備註', '自動化測試備註']]) {
  test(`驗收 6：全部完成後修改${label}，六步驟維持已完成`, async ({ page }) => {
    await completeAllSteps(page);
    await editFields(page, { [field]: value });
    await expectSteps(page, Object.fromEntries(STEPS.map(id => [id, '已完成'])));
    expect((await storedProjects(page))[0][field]).toBe(value);
    await page.reload();
    await expectSteps(page, Object.fromEntries(STEPS.map(id => [id, '已完成'])));
  });
}

test('驗收 9：切換居家、品牌再回居家，草稿與額外預算選項保留', async ({ page }) => {
  await createProject(page);
  await openEditor(page);
  const form = page.locator('#drawer-form');
  await form.locator('[name="area"]').fill('42');
  await form.locator('[name="budget"]').selectOption('100–200 萬');
  await form.getByLabel('現代簡約', { exact: true }).check();
  await form.locator('[name="type"]').selectOption('品牌設計');
  await expect(form.locator('[name="budget"]')).toHaveValue('100–200 萬');
  await form.locator('[name="background"]').fill('尚未儲存的品牌草稿');
  await form.locator('[name="type"]').selectOption('居家裝潢設計');
  await expect(form.locator('[name="area"]')).toHaveValue('42');
  await expect(form.locator('[name="budget"]')).toHaveValue('100–200 萬');
  await expect(form.getByLabel('現代簡約', { exact: true })).toBeChecked();
  await saveEditor(page);
  await page.reload();
  await openEditor(page);
  await expect(form.locator('[name="area"]')).toHaveValue('42');
  await form.locator('[name="type"]').selectOption('品牌設計');
  await expect(form.locator('[name="background"]')).toHaveValue('尚未儲存的品牌草稿');
  await expect(form.locator('[name="budget"]')).toHaveValue('100–200 萬');
  await saveEditor(page);
  await page.reload();
  await openEditor(page);
  await expect(form.locator('[name="budget"]')).toHaveValue('100–200 萬');
});

test('驗收 10：坪數為 0 時只有必填 3/4，不能確認需求', async ({ page }) => {
  await createProject(page);
  await fillRequired(page, { area: '0' });
  await expect(stepMeta(page, 'brief')).toHaveText('必填 3/4');
  await expect(page.locator('#status-slot .status-reason')).toHaveText('還缺必填欄位：坪數');
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await editFields(page, { area: '35' });
  await expect(stepMeta(page, 'brief')).toHaveText('可以確認');
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeEnabled();
});

test('驗收 13：localStorage 寫入失敗保留表單，不顯示已儲存且資料不變', async ({ page }) => {
  await createProject(page);
  const before = await storedProjects(page);
  await openEditor(page);
  await page.locator('#drawer-form [name="name"]').fill('不應儲存的名稱');
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new DOMException('測試儲存失敗', 'QuotaExceededError'); };
  });
  await page.locator('#drawer').getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(page.locator('#drawer')).toBeVisible();
  await expect(page.locator('#drawer-form [name="name"]')).toHaveValue('不應儲存的名稱');
  await expect(page.locator('#toast-text')).toContainText('瀏覽器無法儲存');
  await expect(page.locator('#toast-text')).not.toContainText('已儲存');
  expect(await storedProjects(page)).toEqual(before);
  await page.locator('#drawer').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放棄變更', exact: true }).click();
  await expect(page.locator('.crumbs h1')).toHaveText(before[0].name);
  await openEditor(page);
  await expect(page.locator('#drawer-form [name="name"]')).toHaveValue(before[0].name);
  await page.locator('#drawer').getByRole('button', { name: '取消', exact: true }).click();
  await page.reload();
  expect(await storedProjects(page)).toEqual(before);
  await expect(page.locator('.crumbs h1')).toHaveText(before[0].name);
});
