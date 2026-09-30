'use strict';
const { test, expect, STORAGE_KEY, projectItems } = require('./helpers');

test('已套用 AI 策略的專案重新載入後仍可顯示清單', async ({ page, browserErrors }) => {
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
  await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify([data])),
    { key: STORAGE_KEY, data: project });
  await page.reload();
  await expect(page.locator('#auth-shell')).toBeHidden();
  await expect(page.locator('#list-view')).toBeVisible();
  await expect(projectItems(page)).toContainText(['已套用 AI 策略專案']);
  expect(browserErrors).toEqual([]);
});
