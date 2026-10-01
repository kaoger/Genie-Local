'use strict';
const fs = require('fs');
const { test, expect, STORAGE_KEY, projectItems, STEPS, completeAllSteps, stepMeta, openEditor, saveEditor, goStep } = require('./helpers');

test('六步完成舊案缺坪數區間鍵，載入後仍全完成且 localStorage 位元組不變', async ({ page }) => {
  test.setTimeout(90000);
  await completeAllSteps(page);
  const raw = await page.evaluate(key => {
    const [p] = JSON.parse(localStorage.getItem(key));
    p.strategyPrev = structuredClone(p.strategy);
    p.strategyPending = { snapshot: structuredClone(p.strategy.snapshot), at: '2026-09-30T08:00:00.000Z' };
    p.strategyCompare = [{ at: '2026-09-30T08:00:00.000Z', source: 'Gemini', snapshot: structuredClone(p.strategy.snapshot), sections: p.strategy.sections, warnings: [] }];
    const strip = value => {
      if (!value || typeof value !== 'object') return;
      delete value.areaRange;
      Object.values(value).forEach(strip);
    };
    strip(p);
    const text = JSON.stringify([p]);
    localStorage.setItem(key, text);
    return text;
  }, STORAGE_KEY);
  await page.reload();
  for (const id of STEPS) await expect(stepMeta(page, id), id).toHaveText('已完成');
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
  await expect(page.locator('#storage-warning')).toBeHidden();
  await openEditor(page);
  await page.locator('#drawer-form [name="areaRange"]').selectOption('21–30 坪');
  await saveEditor(page);
  await expect(stepMeta(page, 'brief')).toHaveText('需更新');
  await goStep(page, 'brief');
  await page.locator('#status-slot [data-action="complete"]').click();
  await expect(stepMeta(page, 'strategy')).toHaveText('需更新');
  await expect(stepMeta(page, 'estimate')).toHaveText('已完成');
});

for (const type of ['品牌設計', '其他設計']) {
  test(`${type}完成舊案缺新鍵，重載及重新確認後維持完成且比較清單不誤報`, async ({ page }) => {
    await completeAllSteps(page, { type });
    const raw = await page.evaluate(key => {
      const [p] = JSON.parse(localStorage.getItem(key));
      p.strategyPrev = structuredClone(p.strategy);
      p.strategyPending = { snapshot: structuredClone(p.strategy.snapshot), at: '2026-09-30T08:00:00.000Z' };
      p.strategyCompare = [{ at: '2026-09-30T08:00:00.000Z', source: 'Gemini', snapshot: structuredClone(p.strategy.snapshot), sections: p.strategy.sections, warnings: [] }];
      const strip = value => {
        if (!value || typeof value !== 'object') return;
        delete value.areaRange;
        Object.values(value).forEach(strip);
      };
      strip(p);
      const text = JSON.stringify([p]);
      localStorage.setItem(key, text);
      return text;
    }, STORAGE_KEY);
    await page.reload();
    for (const id of STEPS) await expect(stepMeta(page, id), id).toHaveText(id === 'model3d' && type === '品牌設計' ? '本版不提供' : '已完成');
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
    await goStep(page, 'strategy');
    await page.locator('.strategy-compare-item summary').click();
    await expect(page.locator('.strategy-compare-item')).not.toContainText('這份對應的是複製當時的需求，與現在不同');
    await goStep(page, 'brief');
    await page.locator('#status-slot [data-action="uncomplete"]').click();
    await page.locator('#status-slot [data-action="complete"]').click();
    await page.reload();
    for (const id of STEPS) await expect(stepMeta(page, id), id).toHaveText(id === 'model3d' && type === '品牌設計' ? '本版不提供' : '已完成');
  });
}

for (const areaRange of [32, { a: 1 }]) {
  test(`已完成空間案的異常區間 ${JSON.stringify(areaRange)} 不讓舊完成依據變需更新`, async ({ page }) => {
    await completeAllSteps(page);
    const raw = await page.evaluate(({ key, areaRange }) => {
      const [p] = JSON.parse(localStorage.getItem(key));
      p.brief.areaRange = areaRange;
      const strip = value => {
        if (!value || typeof value !== 'object') return;
        delete value.areaRange;
        Object.values(value).forEach(strip);
      };
      Object.values(p.steps).forEach(strip);
      strip(p.strategy);
      const text = JSON.stringify([p]);
      localStorage.setItem(key, text);
      return text;
    }, { key: STORAGE_KEY, areaRange });
    await page.reload();
    for (const id of STEPS) await expect(stepMeta(page, id), id).toHaveText('已完成');
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
  });
}

test('缺少或異常的坪數區間原值保留，壞專案仍逐筆隔離且不寫回', async ({ page }) => {
  const inputs = [
    { id: 'missing-range', name: '缺鍵', date: '2024-01-01', type: '居家裝潢設計', brief: {} },
    { id: 'null-range', name: '空值', date: '2024-01-01', type: '居家裝潢設計', brief: { areaRange: null } },
    { id: 'number-range', name: '數字', date: '2024-01-01', type: '居家裝潢設計', brief: { areaRange: 32 } },
    { id: 'custom-range', name: '未知選項', date: '2024-01-01', type: '居家裝潢設計', brief: { areaRange: '20-30 坪' } },
    { id: 'empty-object-range', name: '空物件', date: '2024-01-01', type: '居家裝潢設計', brief: { areaRange: {} } },
    { id: 'object-range', name: '物件', date: '2024-01-01', type: '居家裝潢設計', brief: { areaRange: { a: 1 } } },
    { id: 'broken', name: '壞依據', date: '2024-01-01', steps: { brief: { basis: 3 } } },
  ];
  const raw = JSON.stringify(inputs);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
  await page.reload();
  await expect(page.locator('#storage-warning')).toBeVisible();
  for (const [id, expected] of [['missing-range', undefined], ['null-range', null], ['number-range', 32], ['custom-range', '20-30 坪'], ['empty-object-range', {}], ['object-range', { a: 1 }]]) {
    await page.goto(`/#/p/${id}/brief`);
    await expect(page.locator('.crumbs h1')).toBeVisible();
    await openEditor(page);
    await expect(page.locator('#drawer-form [name="areaRange"]')).toBeVisible();
    await page.locator('#drawer').getByRole('button', { name: '關閉' }).click();
    const project = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).find(p => p.id === id), { key: STORAGE_KEY, id });
    expect(project.brief.areaRange).toEqual(expected);
  }
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
});

test('編輯其他欄位不改寫異常坪數區間；實際改選才寫入', async ({ page }) => {
  for (const areaRange of [null, 32, {}, { a: 1 }]) {
    const data = [{ id: 'preserve-range', name: '異常區間', date: '2024-01-01', type: '居家裝潢設計', brief: { areaRange } }];
    await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: STORAGE_KEY, data });
    await page.reload();
    await page.goto('/#/p/preserve-range/brief');
    await openEditor(page);
    await page.locator('#drawer-form [name="notes"]').fill('新增備註');
    await saveEditor(page);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0], STORAGE_KEY);
    expect(saved.brief.areaRange).toEqual(areaRange);
    await openEditor(page);
    await page.locator('#drawer-form [name="areaRange"]').selectOption('21–30 坪');
    await saveEditor(page);
    const changed = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0], STORAGE_KEY);
    expect(changed.brief.areaRange).toBe('21–30 坪');
  }
});

test('舊快照與巢狀完成依據已有坪數區間鍵時保留原值', async ({ page }) => {
  const snapshot = areaRange => ({ type: '居家裝潢設計', brief: { areaRange } });
  const input = [{
    id: 'existing-ranges', name: '已有鍵的舊案', date: '2024-01-01', type: '居家裝潢設計', leadId: 'linked',
    brief: { areaRange: null },
    strategy: { snapshot: snapshot(null) }, strategyPrev: { snapshot: snapshot(32) },
    strategyPending: { snapshot: snapshot('20-30 坪') },
    strategyCompare: [{ snapshot: snapshot('尚未確定'), source: 'Gemini' }],
    steps: {
      brief: { basis: { req: { areaRange: null } } },
      strategy: { basis: { req: snapshot(32) } },
      proposal: { basis: { parts: [['brief', { req: { areaRange: '20-30 坪' } }], ['strategy', { req: snapshot('尚未確定') }]] } },
    },
  }];
  const raw = JSON.stringify(input);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
  await page.reload();
  const p = await page.evaluate(() => window.GenieProjects.projectsForLead('linked')[0]);
  expect([p.brief.areaRange, p.strategy.snapshot.brief.areaRange, p.strategyPrev.snapshot.brief.areaRange,
    p.strategyPending.snapshot.brief.areaRange, p.strategyCompare[0].snapshot.brief.areaRange,
    p.steps.brief.basis.req.areaRange, p.steps.strategy.basis.req.brief.areaRange,
    p.steps.proposal.basis.parts[0][1].req.areaRange,
    p.steps.proposal.basis.parts[1][1].req.brief.areaRange]).toEqual([
    null, null, 32, '20-30 坪', '尚未確定', null, 32, '20-30 坪', '尚未確定',
  ]);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
});

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
