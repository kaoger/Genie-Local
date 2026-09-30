'use strict';
const fs = require('fs');
const { test, expect, STORAGE_KEY, projectItems } = require('./helpers');

test('舊格式與含比較清單的 AI 策略重新載入後仍可顯示清單', async ({ page, browserErrors }) => {
  const snapshot = {
    type: '居家裝潢設計',
    brief: { area: '35', layout: { r: 3, l: 1, b: 2 }, style: ['現代簡約'] },
  };
  const sections = {
    overview: '提案概述', directions: '設計方向', budgetTimeline: '預算與時程提醒',
    questions: '需要向客戶確認的問題', nextSteps: '下一步',
  };
  const project = {
    id: 'upgraded-strategy', name: '已套用 AI 策略專案', date: '2026-09-30',
    type: '居家裝潢設計', brief: snapshot.brief,
    strategy: { snapshot, sections },
    strategyPrev: { snapshot, sections },
    strategyPending: { snapshot, sections },
  };
  for (const strategyCompare of [undefined, [{ at: '2026-09-30T08:00:00.000Z', source: 'Gemini', snapshot, sections, warnings: [] }]]) {
    const data = { ...project };
    if (strategyCompare) data.strategyCompare = strategyCompare;
    await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify([data])),
      { key: STORAGE_KEY, data });
    await page.goto('/');
    await expect(page.locator('#auth-shell')).toBeHidden();
    await expect(page.locator('#list-view')).toBeVisible();
    await expect(projectItems(page)).toContainText(['已套用 AI 策略專案']);
    await page.goto('/#/p/upgraded-strategy/strategy');
    await expect(page.locator('.strategy-compare-item')).toHaveCount(strategyCompare ? 1 : 0);
  }
  expect(browserErrors).toEqual([]);
});

test('壞掉的比較清單重新載入後可開啟，儲存與匯出只保留白名單', async ({ page, browserErrors }) => {
  const snapshot = { type: '居家裝潢設計', brief: { area: '35', address: '不應保留', raw: '不應保留' } };
  const sections = { overview: '概述', directions: '方向', budgetTimeline: '預算', questions: '問題', nextSteps: '下一步' };
  const entry = (source, extra = {}) => ({ at: '2026-09-30T08:00:00.000Z', source, snapshot, sections, warnings: [], ...extra });
  const project = {
    id: 'broken-compare', name: '壞資料測試專案', date: '2026-09-30', type: '居家裝潢設計',
    brief: { area: '35' }, strategy: { snapshot, sections },
    strategyCompare: [
      entry('ChatGPT'),
      '壞元素',
      entry('亂填來源', { warnings: '字串警告', sections: { overview: '只剩概述', directions: 42 }, address: '私密地址', raw: '原始回答', brief: { address: '私密地址' } }),
      entry('Gemini', { warnings: ['解析警告', null, 12], sections: { ...sections, nextSteps: null }, raw: '原始回答' }),
      null,
      entry('Claude', { warnings: [false, '第二個警告'], sections: { ...sections, questions: ['不是字串'] }, address: '私密地址' }),
    ],
  };
  await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify([data])), { key: STORAGE_KEY, data: project });
  await page.reload();
  await expect(page.locator('#list-view')).toBeVisible();
  await expect(projectItems(page)).toContainText(['壞資料測試專案']);
  await page.goto('/#/p/broken-compare/strategy');
  await expect(page.locator('.strategy-compare-item')).toHaveCount(3);
  await expect(page.locator('.strategy-compare-item').first().locator('summary')).toContainText('其他');
  await page.locator('.strategy-compare-item').first().locator('summary').click();
  await expect(page.locator('.strategy-compare-item').first().locator('.strategy-warnings')).toHaveCount(0);
  await expect(page.locator('.strategy-compare-item').first().locator('.strategy-document')).toContainText('只剩概述');
  await page.locator('.strategy-compare-item').nth(1).locator('summary').click();
  await expect(page.locator('.strategy-compare-item').nth(1).locator('.strategy-warnings')).toHaveText('解析警告');
  await page.locator('.strategy-compare-item').first().locator('summary').click();
  await page.locator('[data-strategy-remove="0"]').click(); // 觸發 save()
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0].strategyCompare, STORAGE_KEY);
  expect(stored).toHaveLength(2);
  for (const item of stored) {
    expect(Object.keys(item).sort()).toEqual(['at', 'instructionAt', 'oldInstruction', 'sections', 'snapshot', 'source', 'warnings']);
    expect(Object.values(item.sections).every(value => typeof value === 'string')).toBe(true);
    expect(item.snapshot.brief).not.toHaveProperty('address');
    expect(item.snapshot.brief).not.toHaveProperty('raw');
  }
  expect(stored[0].warnings).toEqual(['解析警告']);
  expect(stored[1].warnings).toEqual(['第二個警告']);
  expect(stored[0].sections.nextSteps).toBe('');
  expect(stored[1].sections.questions).toBe('');
  expect(JSON.stringify(stored)).not.toMatch(/address|raw|私密地址|原始回答/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出本機資料', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8')).projects[0].strategyCompare;
  expect(exported).toEqual(stored);
  expect(JSON.stringify(exported)).not.toMatch(/address|raw|私密地址|原始回答/);
  expect(browserErrors).toEqual([]);
});
