'use strict';
const fs = require('fs');
const path = require('path');
const {
  test, expect, createProject, fillRequired, editFields, markComplete, goStep,
  stepMeta, storedProjects, fillEstimate, completeAllSteps, STORAGE_KEY,
} = require('./helpers');

const names = ['chatgpt-codeblock', 'gemini', 'claude'];
const sources = ['ChatGPT', 'Gemini', 'Claude'];
const keys = ['overview', 'directions', 'budgetTimeline', 'questions', 'nextSteps'];
const labels = ['提案概述', '設計方向', '預算與時程提醒', '需要向客戶確認的問題', '下一步'];
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', `strategy-real-${name}.txt`), 'utf8');
const sample = name => fixture(name).replace(/\r\n?/g, '\n');
// 以樣本的固定標籤邊界切出原文，逐欄核對完整內容，不用正式解析器當預期值。
function expected(name) {
  const raw = sample(name);
  return Object.fromEntries(keys.map((key, i) => {
    const start = raw.indexOf(`【${labels[i]}】`) + labels[i].length + 2;
    const end = raw.indexOf(i === 4 ? '【GENIE-STRATEGY-v1 結束】' : `【${labels[i + 1]}】`, start);
    expect(start).toBeGreaterThan(labels[i].length + 1);
    expect(end).toBeGreaterThan(start);
    return [key, raw.slice(start, end).trim()];
  }));
}
async function ready(page) {
  await createProject(page);
  await fillRequired(page);
  await markComplete(page, 'brief');
  await goStep(page, 'strategy');
}
async function copyInstruction(page) {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }));
  await page.locator('[data-action="strategy-prompt"]').click();
  await page.locator('[data-action="strategy-copy-confirm"]').click();
  await expect(page.locator('#info-dialog')).not.toBeVisible();
}
async function preview(page, name) {
  await page.locator('[data-action="strategy-paste"]').click();
  await page.locator('#strategy-paste-text').fill(sample(name));
  await page.locator('[data-action="strategy-parse"]').click();
  return page.locator('#strategy-parse-result');
}
async function compare(page, name, source) {
  await preview(page, name);
  await page.locator(`[name="strategy-source"][value="${source}"]`).check();
  await page.locator('[data-action="strategy-compare"]').click();
}
async function states(page) {
  return Promise.all(['strategy', 'visual', 'model3d', 'estimate', 'proposal'].map(async id => [id, await stepMeta(page, id).textContent()]));
}

test('三家真實樣本逐欄全文吻合；同一指令三份後改用 Gemini', async ({ page }) => {
  await ready(page);
  await copyInstruction(page);
  for (const [i, name] of names.entries()) {
    const result = await preview(page, name), bodies = expected(name);
    for (const [index, key] of keys.entries()) {
      expect(await result.locator('.strategy-preview > section').nth(index).locator('p').textContent()).toBe(bodies[key]);
    }
    await expect(result.locator('.strategy-warnings')).toHaveCount(0);
    await expect(result.getByText('無法歸類的原文')).toHaveCount(0);
    await expect(result).not.toContainText('快照');
    await expect(result).not.toContainText('待回覆');
    if (i === 0) await page.locator('[data-action="strategy-apply"]').click();
    else {
      await page.locator(`[name="strategy-source"][value="${sources[i]}"]`).check();
      await page.locator('[data-action="strategy-compare"]').click();
    }
  }
  let p = (await storedProjects(page))[0];
  expect(p.strategyPending).toMatchObject({ applied: 1, compared: 2 });
  expect(p.strategyCompare.map(item => item.source)).toEqual(['Gemini', 'Claude']);
  expect(p.strategy.sections).toEqual(expected(names[0]));
  await expect(page.locator('.strategy-workflow')).toContainText('已套用 1 份、比較 2 份');
  await expect(page.locator('.strategy-workflow')).not.toContainText('快照');
  await expect(page.locator('.strategy-workflow')).not.toContainText('待回覆');
  await page.locator('.strategy-compare-item').first().locator('summary').click();
  await page.locator('[data-strategy-use="0"]').click();
  p = (await storedProjects(page))[0];
  expect(p.strategy.sections).toEqual(expected('gemini'));
  expect(p.strategyPrev.sections).toEqual(expected(names[0]));
  expect(p.strategyPending.applied).toBe(2);
});

test('五欄預覽分別說明設成目前版與只留下比較', async ({ page }) => {
  await ready(page);
  const result = await preview(page, names[0]);
  const notes = result.locator('.strategy-preview > p.muted');
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toContainText('設成目前版：這份會變成目前版');
  await expect(notes.nth(0)).toContainText('上一版');
  await expect(notes.nth(1)).toHaveText('只留下比較：存進比較清單，不會改動目前版。');
});

test('只留下比較不產生目前版，也不改完成狀態；改字需重新預覽', async ({ page }) => {
  await ready(page);
  await copyInstruction(page);
  await preview(page, names[0]);
  await page.locator(`[name="strategy-source"][value="ChatGPT"]`).check();
  await page.locator('#strategy-paste-text').fill(sample(names[1]));
  await page.locator('[data-action="strategy-compare"]').click();
  await expect(page.locator('#info-dialog')).toBeVisible();
  expect((await storedProjects(page))[0].strategyCompare).toHaveLength(0);
  await page.locator(`[name="strategy-source"][value="Gemini"]`).check();
  await page.locator('[data-action="strategy-compare"]').click();
  let p = (await storedProjects(page))[0];
  expect(p.strategy).toBeUndefined();
  expect(p.strategyCompare[0].sections).toEqual(expected('gemini'));
  expect(p.strategyCompare[0].warnings).toEqual([]); // 預覽提示不寫進解析警告
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await expect(stepMeta(page, 'strategy')).toHaveText('可以生成');
  await expect(stepMeta(page, 'visual')).toHaveText('需先完成策略');
  await page.locator('[data-action="gen-strategy"]').click();
  await markComplete(page, 'strategy');
  await markComplete(page, 'visual');
  await markComplete(page, 'model3d');
  await fillEstimate(page);
  await markComplete(page, 'estimate');
  await markComplete(page, 'proposal');
  await goStep(page, 'strategy');
  const before = (await storedProjects(page))[0], priorStates = await states(page);
  await compare(page, names[2], 'Claude');
  p = (await storedProjects(page))[0];
  expect(p.strategy).toEqual(before.strategy);
  expect(p.steps).toEqual(before.steps);
  expect(await states(page)).toEqual(priorStates);
  await page.locator('.strategy-compare-item').last().locator('summary').click();
  expect(await states(page)).toEqual(priorStates);
});

test('新目前版使策略與下游需更新，相同內容不重新記時', async ({ page }) => {
  await completeAllSteps(page);
  await goStep(page, 'strategy');
  await copyInstruction(page);
  await preview(page, names[0]);
  await page.locator('[data-action="strategy-apply"]').click();
  await markComplete(page, 'strategy');
  await markComplete(page, 'visual');
  await markComplete(page, 'model3d');
  await markComplete(page, 'proposal');
  await goStep(page, 'strategy');
  const before = (await storedProjects(page))[0];
  await preview(page, names[0]);
  await page.locator('[data-action="strategy-apply"]').click();
  await expect(page.locator('#toast-text')).toHaveText('跟目前版相同');
  let p = (await storedProjects(page))[0];
  expect(p.strategy.at).toBe(before.strategy.at);
  expect(p.strategyPrev).toEqual(before.strategyPrev);
  expect(p.steps).toEqual(before.steps);
  await preview(page, names[1]);
  await page.locator('[data-action="strategy-apply"]').click();
  p = (await storedProjects(page))[0];
  expect(p.strategy.at).not.toBe(before.strategy.at);
  expect(p.strategyPrev.sections).toEqual(expected(names[0]));
  await expect(stepMeta(page, 'strategy')).toHaveText('需更新');
  await expect(stepMeta(page, 'visual')).toHaveText('需更新');
  await expect(stepMeta(page, 'model3d')).toHaveText('需更新');
  await expect(stepMeta(page, 'estimate')).toHaveText('已完成');
  await expect(stepMeta(page, 'proposal')).toHaveText('需更新');
});

test('第四份先確認；取消不覆蓋，確認擠掉最舊一份，並可刪單份', async ({ page }) => {
  await ready(page);
  await copyInstruction(page);
  for (const [i, name] of names.entries()) await compare(page, name, sources[i]);
  const first = (await storedProjects(page))[0].strategyCompare[0];
  await preview(page, names[0]);
  await page.locator(`[name="strategy-source"][value="其他"]`).check();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('會擠掉最舊的一份'); dialog.dismiss(); });
  await page.locator('[data-action="strategy-compare"]').click();
  expect((await storedProjects(page))[0].strategyCompare[0]).toEqual(first);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="strategy-compare"]').click();
  const p = (await storedProjects(page))[0];
  expect(p.strategyCompare).toHaveLength(3);
  expect(p.strategyCompare.map(item => item.source)).toEqual(['Gemini', 'Claude', '其他']);
  await page.locator('.strategy-compare-item').first().locator('summary').click();
  await page.locator('.strategy-compare-item').last().locator('summary').click();
  await expect(page.locator('.strategy-compare-item').first()).not.toHaveAttribute('open');
  await page.locator('[data-strategy-remove="2"]').click();
  expect((await storedProjects(page))[0].strategyCompare.map(item => item.source)).toEqual(['Gemini', 'Claude']);
});

test('再次複製警告只限未使用或需求不同；舊指令標示與無紀錄文案', async ({ page }) => {
  await ready(page);
  await preview(page, names[0]);
  await expect(page.locator('#strategy-parse-result .strategy-warnings')).toContainText('這台瀏覽器沒有這次『複製 AI 指令』的紀錄。套用後，五欄仍是你貼上的文字，並會被當成依現在的需求所寫。若這份回答來自較早的指令，請先按『複製 AI 指令』再貼，或套用後自己核對。');
  await page.locator('#info-dialog [data-close]').first().click();
  await copyInstruction(page);
  await page.locator('[data-action="strategy-prompt"]').click();
  await expect(page.locator('.strategy-warning')).toContainText('再次複製');
  await page.locator('[data-action="strategy-copy-confirm"]').click();
  await preview(page, names[0]);
  await expect(page.locator('#strategy-parse-result .strategy-warnings')).toContainText('指令曾再次複製');
  await page.locator(`[name="strategy-source"][value="ChatGPT"]`).check();
  await page.locator('[data-action="strategy-compare"]').click();
  await page.locator('[data-action="strategy-prompt"]').click();
  await expect(page.locator('.strategy-warning')).toHaveCount(0);
  await page.locator('[data-action="strategy-copy-confirm"]').click();
  await preview(page, names[1]);
  await expect(page.locator('#strategy-parse-result .strategy-warnings')).toHaveCount(0);
  await page.locator('#info-dialog [data-close]').first().click();
  await editFields(page, { needsNote: '改過的需求' });
  await markComplete(page, 'brief');
  await goStep(page, 'strategy');
  await page.locator('.strategy-compare-item').first().locator('summary').click();
  await expect(page.locator('.strategy-compare-content .strategy-warning')).toContainText('這份對應的是複製當時的需求，與現在不同');
  await preview(page, names[1]);
  await expect(page.locator('#strategy-parse-result .strategy-warnings')).toContainText('仍可套用；套用後策略會是『需重新生成』');
  await page.locator('#info-dialog [data-close]').first().click();
  await page.locator('[data-action="strategy-prompt"]').click();
  await expect(page.locator('#info-dialog .strategy-warning')).toContainText('再次複製');
  await page.locator('[data-action="strategy-copy-confirm"]').click();
  await expect(page.locator('.strategy-compare-tag')).toContainText('舊指令');
});

test('複製專案清比較版；舊資料載入後比較版只留需求白名單', async ({ page }) => {
  await ready(page);
  await copyInstruction(page);
  await compare(page, names[0], 'ChatGPT');
  await page.evaluate(key => {
    const projects = JSON.parse(localStorage.getItem(key));
    projects[0].strategyCompare[0].snapshot.brief.address = '測試地址';
    projects[0].strategyCompare[0].snapshot.brief.privateData = '不應保留';
    localStorage.setItem(key, JSON.stringify(projects));
  }, STORAGE_KEY);
  await page.reload();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出本機資料', exact: true }).click();
  const download = await downloadPromise;
  let p = JSON.parse(fs.readFileSync(await download.path(), 'utf8')).projects[0];
  expect(p.strategyCompare[0].snapshot.brief).not.toHaveProperty('address');
  expect(p.strategyCompare[0].snapshot.brief).not.toHaveProperty('privateData');
  await page.getByRole('link', { name: '潛在客戶', exact: true }).click();
  await page.locator('#rows tr[data-id]').first().locator('[data-copy]').click();
  p = (await storedProjects(page))[0];
  expect(p.strategyCompare).toEqual([]);
  expect(p.strategyPending).toBeUndefined();
});

test('375 與 844×390 比較清單可單份展開、按鈕夠高且無橫向捲動', async ({ page }) => {
  await ready(page);
  await copyInstruction(page);
  for (const [i, name] of names.entries()) await compare(page, name, sources[i]);
  for (const viewport of [{ width: 375, height: 812 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const items = page.locator('.strategy-compare-item');
    await expect(items).toHaveCount(3);
    await expect(page.locator('.strategy-compare-item[open]')).toHaveCount(0);
    await items.nth(0).locator('summary').click();
    await items.nth(1).locator('summary').click();
    await expect(items.nth(0)).not.toHaveAttribute('open');
    await expect(items.nth(1)).toHaveAttribute('open', '');
    const sizes = await page.locator('.strategy-compare-item summary, .strategy-compare-item button:visible').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
    expect(sizes.every(size => size >= 44)).toBe(true);
    const fit = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, main: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth }));
    expect(fit.document).toBeLessThanOrEqual(viewport.width + 1);
    expect(fit.main).toBeLessThanOrEqual(1);
    await items.nth(1).locator('summary').click();
  }
});
