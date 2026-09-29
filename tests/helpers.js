'use strict';
const { test: base, expect } = require('@playwright/test');
const { installMember } = require('./mock-auth');

const STORAGE_KEY = 'genie-local-projects-v1';
const STEPS = ['brief', 'strategy', 'visual', 'model3d', 'estimate', 'proposal'];

// 每個案例有獨立的 browser context，localStorage 與 sessionStorage 一開始均為空。
// 自動 fixture 確保每個 spec 都初始化，錯誤監聽涵蓋首次載入與整段操作。
const test = base.extend({
  browserErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    await use(errors);
  }, { auto: true }],
  cleanStorage: [async ({ page, browserErrors }, use) => {
    await installMember(page);
    await page.goto('/');
    await expect(page.locator('#rows tr[data-id]')).toHaveCount(8);
    await use();
  }, { auto: true }],
});

async function createProject(page, { name = '自動化測試專案', type } = {}) {
  await page.getByRole('button', { name: '新增專案', exact: true }).click();
  const form = page.locator('#project-form');
  await form.getByLabel('專案名稱', { exact: true }).fill(name);
  const typeSelect = form.getByRole('combobox', { name: '需求類型', exact: true });
  if (type) await typeSelect.selectOption(type);
  else await expect(typeSelect).toHaveValue('居家裝潢設計');
  await form.getByRole('button', { name: '建立專案', exact: true }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/brief$/);
  await expect(page.locator('.crumbs h1')).toHaveText(name);
  return decodeURIComponent(new URL(page.url()).hash.split('/')[2]);
}

async function goStep(page, id) {
  await page.locator(`.stepper a[href$="/${id}"]`).click();
  await expect(page.locator(`.stepper a[href$="/${id}"]`)).toHaveAttribute('aria-current', 'step');
}

function stepMeta(page, id) {
  return page.locator(`.stepper a[href$="/${id}"] .step-meta`);
}

async function expectSteps(page, states) {
  for (const [id, meta] of Object.entries(states)) await expect(stepMeta(page, id), id).toHaveText(meta);
}

async function openEditor(page) {
  await page.getByRole('button', { name: '編輯全部資料', exact: true }).click();
  await expect(page.locator('#drawer')).toBeVisible();
}

async function saveEditor(page) {
  await page.locator('#drawer').getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(page.locator('#drawer')).not.toBeVisible();
}

async function fillRequired(page, { type = '居家裝潢設計', area = '35' } = {}) {
  await openEditor(page);
  const form = page.locator('#drawer-form');
  if (type === '品牌設計') {
    await form.locator('[name="background"]').fill('測試品牌識別專案');
    await form.locator('[name="audience"]').fill('一般消費者');
    await form.locator('[name="stylePref"]').fill('簡潔黑白');
  } else {
    await form.locator('[name="area"]').fill(area);
    await form.getByLabel('現代簡約', { exact: true }).check();
    await form.getByLabel('夫妻', { exact: true }).check();
    await form.getByLabel('全室裝修', { exact: true }).check();
  }
  await saveEditor(page);
}

async function editFields(page, values) {
  await openEditor(page);
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`#drawer-form [name="${name}"]`).fill(value);
  }
  await saveEditor(page);
}

async function markComplete(page, id) {
  await goStep(page, id);
  await page.locator('#status-slot [data-action="complete"]').click();
  await expect(stepMeta(page, id)).toHaveText('已完成');
}

async function generateStrategy(page) {
  await goStep(page, 'strategy');
  await page.locator('[data-action="gen-strategy"]').click();
  await expect(page.getByRole('heading', { name: '策略企劃・目前版', exact: true })).toBeVisible();
}

async function fillEstimate(page) {
  await goStep(page, 'estimate');
  const prices = page.locator('[data-est-field="price"]');
  for (let i = 0; i < await prices.count(); i++) {
    await prices.nth(i).fill('1000');
    await prices.nth(i).press('Tab');
  }
  await page.getByLabel('有效期限', { exact: true }).fill('2030-12-31');
  await page.getByLabel('報價範圍與說明', { exact: true }).fill('包含本案設計與交付項目');
  await page.getByLabel('報價範圍與說明', { exact: true }).press('Tab');
}

async function completeAllSteps(page, { type = '居家裝潢設計', skipVisual = false } = {}) {
  await createProject(page, { type });
  await fillRequired(page, { type });
  await markComplete(page, 'brief');
  await generateStrategy(page);
  await markComplete(page, 'strategy');
  if (skipVisual) {
    await goStep(page, 'visual');
    await page.getByRole('button', { name: '本案不採用', exact: true }).click();
  } else await markComplete(page, 'visual');
  if (type !== '品牌設計') await markComplete(page, 'model3d');
  await fillEstimate(page);
  await markComplete(page, 'estimate');
  await markComplete(page, 'proposal');
  await expectSteps(page, Object.fromEntries(STEPS.map(id => [id,
    id === 'model3d' && type === '品牌設計' ? '本版不提供' :
      id === 'visual' && skipVisual ? '本案不採用' : '已完成'])));
}

async function storedProjects(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

module.exports = {
  test, expect, STORAGE_KEY, STEPS, createProject, goStep, stepMeta, expectSteps,
  openEditor, saveEditor, fillRequired, editFields, markComplete, generateStrategy,
  fillEstimate, completeAllSteps, storedProjects,
};
