'use strict';
const {
  test, expect, createProject, fillRequired, goStep, editFields, storedProjects,
} = require('./helpers');

function amount(page, label) {
  return page.locator('#estimate-totals .totals > div').filter({
    has: page.locator('dt', { hasText: label }),
  }).locator('dd');
}

test('驗收 11：input 即時計算，change 儲存保留原 input，Tab 焦點不消失', async ({ page }) => {
  await createProject(page);
  await fillRequired(page);
  await goStep(page, 'estimate');
  const before = await storedProjects(page);
  expect(before[0].estimate).toBeUndefined();
  const price = page.getByRole('spinbutton', { name: '第 1 列單價', exact: true });
  // 保存 DOM 物件參照，確認 change 沒有以相同選擇器的新元素取代它。
  const original = await price.elementHandle();
  await price.fill('1050');
  await expect(page.locator('[data-est-id="design"] .row-subtotal')).toHaveText('36,750');
  await expect(amount(page, '小計（未稅）')).toHaveText('NT$ 36,750');
  await expect(amount(page, '營業稅（5%）')).toHaveText('NT$ 1,837.5');
  await expect(amount(page, /^總計$/)).toHaveText('NT$ 38,587.5');
  expect(await storedProjects(page)).toEqual(before);
  await price.press('Tab');
  expect(await price.evaluate((current, previous) => current === previous, original)).toBe(true);
  await expect(page.getByRole('button', { name: '刪除第 1 列', exact: true })).toBeFocused();
  expect((await storedProjects(page))[0].estimate.rows[0].price).toBe('1050');
  await original.dispose();
  // 在相鄰輸入欄位之間 Tab，確認下一格的焦點也保留。
  const item = page.getByRole('textbox', { name: '第 1 列項目', exact: true });
  await item.fill('室內設計費（測試）');
  await item.press('Tab');
  await expect(page.getByRole('spinbutton', { name: '第 1 列數量', exact: true })).toBeFocused();
  await page.reload();
  await expect(price).toHaveValue('1050');
  await expect(item).toHaveValue('室內設計費（測試）');
});

test('驗收 11：自訂計價坪數不回寫需求，可改回沿用需求坪數', async ({ page }) => {
  await createProject(page);
  await fillRequired(page);
  await goStep(page, 'estimate');
  const row = page.locator('[data-est-id="design"]');
  const quantity = page.getByRole('spinbutton', { name: '第 1 列數量', exact: true });
  await expect(quantity).toHaveValue('35');
  await expect(row).toContainText('沿用需求坪數');
  await quantity.fill('20');
  await quantity.press('Tab');
  await expect(row).toContainText('自訂計價坪數');
  let project = (await storedProjects(page))[0];
  expect(project.brief.area).toBe('35');
  expect(project.estimate.rows[0].areaLink).toBe('off');
  await editFields(page, { area: '40' });
  await expect(quantity).toHaveValue('20');
  await row.getByRole('button', { name: '改回沿用', exact: true }).click();
  await expect(quantity).toHaveValue('40');
  await expect(row).toContainText('沿用需求坪數');
  await expect(row.getByRole('button', { name: '改回沿用', exact: true })).toHaveCount(0);
  project = (await storedProjects(page))[0];
  expect(project.brief.area).toBe('40');
  expect(project.estimate.rows[0].areaLink).toBe('on');
  await page.reload();
  await expect(quantity).toHaveValue('40');
});

for (const { tax, label, subtotal, vat, total } of [
  { tax: 'excl', label: '未稅', subtotal: '1,050', vat: '52.5', total: '1,102.5' },
  { tax: 'incl', label: '含稅', subtotal: '1,000', vat: '50', total: '1,050' },
]) {
  test(`規格 9.3-2：單價 1050、數量 1 的${label}三個金額正確`, async ({ page }) => {
    await createProject(page);
    await fillRequired(page, { area: '1' });
    await goStep(page, 'estimate');
    const price = page.getByRole('spinbutton', { name: '第 1 列單價', exact: true });
    await price.fill('1050');
    await price.press('Tab');
    await page.getByRole('combobox', { name: '稅別', exact: true }).selectOption(tax);
    await expect(amount(page, '小計（未稅）')).toHaveText(`NT$ ${subtotal}`);
    await expect(amount(page, '營業稅（5%）')).toHaveText(`NT$ ${vat}`);
    await expect(amount(page, /^總計$/)).toHaveText(`NT$ ${total}`);
    await page.reload();
    await expect(page.getByRole('combobox', { name: '稅別', exact: true })).toHaveValue(tax);
    await expect(amount(page, '小計（未稅）')).toHaveText(`NT$ ${subtotal}`);
    await expect(amount(page, '營業稅（5%）')).toHaveText(`NT$ ${vat}`);
    await expect(amount(page, /^總計$/)).toHaveText(`NT$ ${total}`);
  });
}
