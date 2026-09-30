'use strict';
const fs = require('fs');
const path = require('path');
const {
  test, expect, createProject, fillRequired, openEditor, saveEditor, editFields,
  markComplete, goStep, stepMeta, storedProjects, fillEstimate, completeAllSteps, STORAGE_KEY,
} = require('./helpers');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', `strategy-${name}.txt`), 'utf8');
const standard = fixture('chatgpt');
const keys = ['overview', 'directions', 'budgetTimeline', 'questions', 'nextSteps'];
const labels = ['提案概述', '設計方向', '預算與時程提醒', '需要向客戶確認的問題', '下一步'];
const sampleNote = '自擬樣本，待使用者以手機實際回答取代';
async function allowCopy(page) { await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } })); }

async function assertSections(result, expected) {
  for (const [index, label] of labels.entries()) {
    const section = result.locator('.strategy-preview > section').nth(index);
    await expect(section.locator('h4')).toContainText(label);
    await expect.poll(() => section.locator('p').textContent()).toBe(expected[index]);
  }
}

async function closePreview(page) { await page.locator('#info-dialog [data-close]').first().click(); }

async function ready(page, type = '居家裝潢設計') {
  await createProject(page, { type });
  if (type === '商業空間設計') {
    await openEditor(page);
    const form = page.locator('#drawer-form');
    await form.locator('[name="area"]').fill('40');
    await form.locator('[name="usage"]').fill('咖啡廳');
    await form.getByLabel('現代簡約', { exact: true }).check();
    await form.getByLabel('全區裝修', { exact: true }).check();
    await saveEditor(page);
  } else await fillRequired(page, { type });
  await markComplete(page, 'brief');
  await goStep(page, 'strategy');
}

async function preview(page, answer) {
  await page.locator('[data-action="strategy-paste"]').click();
  await page.locator('#strategy-paste-text').fill(answer);
  await page.locator('[data-action="strategy-parse"]').click();
  return page.locator('#strategy-parse-result');
}

test('指令使用明確白名單、遮罩與類型用語；複製時保存待回覆快照', async ({ page }) => {
  await allowCopy(page);
  for (const [type, phrase] of [['居家裝潢設計', '使用空間設計語彙'], ['商業空間設計', '使用空間設計語彙'], ['品牌設計', '不要套用室內裝修建議']]) {
    await ready(page, type);
    await openEditor(page);
    const form = page.locator('#drawer-form');
    await form.locator('[name="name"]').fill('秘密專案名稱');
    await form.locator('[name="contact"]').fill('秘密聯絡人');
    await form.locator('[name="phone"]').fill('0912345678');
    await form.locator('[name="email"]').fill('private@example.com');
    await form.locator('[name="notes"]').fill('秘密備註');
    if (type === '品牌設計') await form.locator('[name="needsNote"]').fill('請聯絡 0912-345-678 或 hello@example.com');
    else await form.locator('[name="needsNote"]').fill('請聯絡 02-23456789 或 hello@example.com');
    if (type !== '品牌設計') await form.locator('[name="address"]').fill('秘密地址');
    await saveEditor(page);
    await markComplete(page, 'brief');
    await goStep(page, 'strategy');
    await page.locator('[data-action="strategy-prompt"]').click();
    const prompt = await page.locator('#strategy-prompt-text').inputValue();
    expect(prompt).toContain('版本：strategy-v1');
    expect(prompt).toContain('【GENIE-STRATEGY-v1 開始】');
    expect(prompt).toContain('【GENIE-STRATEGY-v1 結束】');
    expect(prompt).toContain('【提案概述】');
    expect(prompt).toContain('整份輸出必須放進單一程式碼框');
    expect(prompt).toContain('框外不要說任何話');
    expect(prompt).toContain('框內不要再有其他程式碼框');
    expect(prompt).toMatch(/```text\n【GENIE-STRATEGY-v1 開始】/);
    expect(prompt).toMatch(/【GENIE-STRATEGY-v1 結束】\n```$/);
    expect(prompt).toContain(phrase);
    expect(prompt).toContain('[電話]');
    expect(prompt).toContain('[信箱]');
    expect(prompt).toMatch(/^預算：未填$/m);
    for (const secret of ['秘密專案名稱', '秘密聯絡人', '0912345678', 'private@example.com', '秘密地址', '秘密備註', 'hello@example.com']) expect(prompt).not.toContain(secret);
    await page.locator('[data-action="strategy-copy-confirm"]').click();
    await expect(page.locator('#info-dialog')).not.toBeVisible();
    const p = (await storedProjects(page))[0];
    expect(p.strategyPending.template).toBe('strategy-v1');
    expect(Object.keys(p.strategyPending.snapshot.brief).sort()).toEqual((type === '居家裝潢設計' ? ['region','houseType','elevator','area','completion','layout','style','members','renoType','budget','needsNote'] : type === '商業空間設計' ? ['region','area','completion','usage','style','renoType','budget','needsNote'] : ['background','audience','stylePref','deliverables','budget','needsNote']).sort());
    expect(p.strategyPending.snapshot.brief).not.toHaveProperty('address');
    await page.getByRole('link', { name: '潛在客戶', exact: true }).click();
  }
});

test('三份自擬 fixture 逐欄解析正文，前言與圍欄留在無法歸類區', async ({ page }) => {
  await ready(page);
  const cases = [
    ['chatgpt', ['已知需求為居家空間調整，以收納與動線為優先。格局與現場尺寸仍需核對。', '方向 1：清楚動線\n以公共空間的走道整理為核心；取捨是展示面積。\n方向 2：彈性收納\n以可變用途的收納區為核心；須確認實際物品尺寸。', '若預算尚未確定，先列工作優先順序。交屋月份仍待確認。', '1. 哪些物品需要固定收納？\n2. 現場丈量可安排在何時？', '1. 整理參考視覺。\n2. 安排丈量並核對需求。']],
    ['claude', ['品牌識別需清楚呈現核心訊息。', '方向 1：簡潔符號；方向 2：字體主導。', '先確認交付範圍。', '最主要的使用場景為何？', '整理兩組視覺方向。']],
    ['gemini', ['網站改版目標是讓資訊更容易找到。', '方向 1：清晰導覽\n### 需要驗證\n核對目前的內容分類。\n方向 2：重點頁面\n清楚呈現主要服務。', '先確認需要改動的頁面。', '現有網站哪些頁面最常被使用？', '盤點內容並製作線框。']],
  ];
  for (const [name, expected] of cases) {
    const result = await preview(page, fixture(name));
    await assertSections(result, expected);
    const unclassified = result.locator('.strategy-preview > section').last();
    await expect(unclassified.locator('h4')).toHaveText('無法歸類的原文');
    await expect(unclassified).toContainText(sampleNote);
    if (name === 'claude') { await expect(unclassified).toContainText('以下是內部草稿：'); await expect(unclassified).toContainText('```text'); }
    await expect(page.locator('[data-action="strategy-apply"]')).toBeEnabled();
    await closePreview(page);
  }
});

test('只有 CRLF 與裸標題時仍可逐欄解析', async ({ page }) => {
  await ready(page);
  const bodies = ['CRLF 概述', '方向 1：動線\n方向 2：收納', 'CRLF 預算', 'CRLF 問題', 'CRLF 下一步'];
  const answer = labels.map((label, index) => `${label}\r\n${bodies[index].replace(/\n/g, '\r\n')}`).join('\r\n');
  await page.locator('[data-action="strategy-paste"]').click();
  const textarea = page.locator('#strategy-paste-text');
  const rawValue = await textarea.evaluate((el, raw) => {
    Object.defineProperty(el, 'value', { configurable: true, get: () => raw });
    return el.value;
  }, answer);
  expect(rawValue).toContain('\r\n');
  await page.locator('[data-action="strategy-parse"]').click();
  const result = page.locator('#strategy-parse-result');
  await assertSections(result, bodies);
  await expect(result).toContainText('找不到完整的 START／END 標記');
  await expect(page.locator('[data-action="strategy-apply"]')).toBeEnabled();
});

test('只有外層圍欄、沒有 START／END 時可逐欄解析', async ({ page }) => {
  await ready(page);
  const bodies = ['圍欄概述', '方向 1：圍欄\n方向 2：替代', '圍欄預算', '圍欄問題', '圍欄下一步'];
  const answer = `\`\`\`text\n${labels.map((label, index) => `【${label}】\n${bodies[index]}`).join('\n')}\n\`\`\``;
  const result = await preview(page, answer);
  await assertSections(result, bodies);
  await expect(result).toContainText('找不到完整的 START／END 標記');
  await expect(result).not.toContainText('無法歸類的原文');
  await expect(result).not.toContainText('```');
});

test('只有全形標記與【】標題時可逐欄解析', async ({ page }) => {
  await ready(page);
  const bodies = ['全形概述', '方向 1：甲\n方向 2：乙', '全形預算', '全形問題', '全形下一步'];
  const answer = `＜＜＜GENIE-STRATEGY-v1:START＞＞＞\n${labels.map((label, index) => `【${label}】\n${bodies[index]}`).join('\n')}\n＜＜＜GENIE-STRATEGY-v1:END＞＞＞`;
  const result = await preview(page, answer);
  await assertSections(result, bodies);
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
  await expect(result).not.toContainText('無法歸類的原文');
});

test('新標記標準樣本可逐欄解析，標記不會進入欄位', async ({ page }) => {
  await ready(page);
  const result = await preview(page, standard.replace(sampleNote, '').trim());
  await assertSections(result, ['已知需求為居家空間調整，以收納與動線為優先。格局與現場尺寸仍需核對。', '方向 1：清楚動線\n以公共空間的走道整理為核心；取捨是展示面積。\n方向 2：彈性收納\n以可變用途的收納區為核心；須確認實際物品尺寸。', '若預算尚未確定，先列工作優先順序。交屋月份仍待確認。', '1. 哪些物品需要固定收納？\n2. 現場丈量可安排在何時？', '1. 整理參考視覺。\n2. 安排丈量並核對需求。']);
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
  await expect(result).not.toContainText('無法歸類的原文');
  await expect(result).not.toContainText('GENIE-STRATEGY-v1');
});

test('iPhone 複製丟失標記與概述標題時，第一段補入概述', async ({ page }) => {
  await ready(page);
  const result = await preview(page, fixture('chatgpt-ios-2026-09-30'));
  await assertSections(result, ['本案以收納與動線調整為主要目標。現場尺寸尚未確認，設計提案需保留調整空間。', '方向 1：梳理動線\n先確認主要走道與家具位置。\n方向 2：彈性收納\n依實際物品尺寸規劃收納區。', '預算尚未確定，先釐清工作優先順序。', '1. 哪些物品需要固定收納？\n2. 何時可以安排現場丈量？', '1. 整理兩組方向草圖。\n2. 安排丈量並核對需求。']);
  await expect(result).toContainText('提案概述沒有標題，已把第一個標題前的文字全部放入，請刪除不屬於概述的句子');
  await expect(result).toContainText('找不到完整的 START／END 標記');
  await expect(result).not.toContainText('缺少欄位：提案概述');
  await expect(result).not.toContainText('無法歸類的原文');
  await expect(page.locator('[data-action="strategy-apply"]')).toBeEnabled();
});

test('兩層舊式標記可辨識，單獨標記不會列為原文', async ({ page }) => {
  await ready(page);
  const bodies = ['舊式概述', '方向 1：甲\n方向 2：乙', '舊式預算', '舊式問題', '舊式下一步'];
  const answer = `<<GENIE-STRATEGY-v1:START>>\n${labels.map((label, index) => `【${label}】\n${bodies[index]}`).join('\n')}\n<<GENIE-STRATEGY-v1:END>>`;
  let result = await preview(page, answer);
  await assertSections(result, bodies);
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
  await expect(result).not.toContainText('無法歸類的原文');
  await closePreview(page);
  result = await preview(page, `＜ genie-strategy-v1 start ＞\n${labels.map((label, index) => `【${label}】\n${bodies[index]}`).join('\n')}\n＜ genie-strategy-v1 end ＞`);
  await assertSections(result, bodies);
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
  await closePreview(page);
  result = await preview(page, `［ GENIE-STRATEGY-v1 開始 ］\n${labels.map((label, index) => `【${label}】\n${bodies[index]}`).join('\n')}\n[ GENIE-STRATEGY-v1 結束 ]`);
  await assertSections(result, bodies);
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
  await closePreview(page);
  result = await preview(page, `<<GENIE-STRATEGY-v1:START>>\n${labels.map((label, index) => `【${label}】\n${bodies[index]}`).join('\n')}`);
  await assertSections(result, bodies);
  await expect(result).toContainText('找不到完整的 START／END 標記');
  await expect(result).not.toContainText('無法歸類的原文');
  await expect(result).not.toContainText('GENIE-STRATEGY-v1');
});

test('iPhone ChatGPT 長按原始樣本可完整拆出五欄', async ({ page }) => {
  await ready(page);
  const raw = fixture('chatgpt-ios-longpress');
  const result = await preview(page, raw);
  const contents = await result.locator('.strategy-preview > section p').allTextContents();
  expect(contents).toHaveLength(5);
  for (const [index, label] of labels.entries()) {
    const start = raw.indexOf(`【${label}】`);
    const end = index + 1 < labels.length ? raw.indexOf(`【${labels[index + 1]}】`, start) : raw.indexOf('<<GENIE-STRATEGY-v1:END', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(contents[index]).toBe(raw.slice(start + label.length + 2, end).trim());
  }
  await expect(result).not.toContainText('無法歸類的原文');
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
  await expect(page.locator('[data-action="strategy-apply"]')).toBeEnabled();
});

test('前後閒聊包住程式碼框時，框內五欄正確且閒聊進無法歸類', async ({ page }) => {
  await ready(page);
  const bodies = ['框內概述', '方向 1：甲\n方向 2：乙', '框內預算', '框內問題', '框內下一步'];
  const answer = `這是前言。\n\`\`\`text\n【GENIE-STRATEGY-v1 開始】\n${labels.map((label, index) => `【${label}】\n${bodies[index]}`).join('\n')}\n【GENIE-STRATEGY-v1 結束】\n\`\`\`\n這是後記。`;
  const result = await preview(page, answer);
  await assertSections(result, bodies);
  const unclassified = result.locator('.strategy-preview > section').last();
  await expect(unclassified.locator('h4')).toHaveText('無法歸類的原文');
  await expect(unclassified.locator('p')).toHaveText('這是前言。\n這是後記。');
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
});

test('裸標題、Markdown 標題及粗體標題的程式碼框均可辨識；多框選非空欄最多且同分取最後', async ({ page }) => {
  await ready(page);
  const blocks = [
    '提案概述\n第一框',
    '## 提案概述\n第二框概述\n**設計方向**\n第二框方向',
    '提案概述\n最後框概述\n## 設計方向\n最後框方向',
  ];
  const result = await preview(page, blocks.map(body => `\`\`\`text\n${body}\n\`\`\``).join('\n'));
  await assertSections(result, ['最後框概述', '最後框方向', '未辨識', '未辨識', '未辨識']);
  await expect(result).toContainText('有多個程式碼框，請核對');
});

test('只有標記、沒有正文的欄位不計入多框非空分數', async ({ page }) => {
  await ready(page);
  const answer = '\`\`\`text\n【提案概述】\n【GENIE-STRATEGY-v1 結束】\n\`\`\`\n\`\`\`text\n【提案概述】\n有正文\n\`\`\`';
  const result = await preview(page, answer);
  await assertSections(result, ['有正文', '未辨識', '未辨識', '未辨識', '未辨識']);
  await expect(result).toContainText('有多個程式碼框，請核對');
});

test('框外後續標題代表程式碼框提前結束，改用全文解析', async ({ page }) => {
  await ready(page);
  const result = await preview(page, '\`\`\`text\n【提案概述】\n概述\n\`\`\`\n【設計方向】\n方向\n【預算與時程提醒】\n預算');
  await assertSections(result, ['概述', '方向', '預算', '未辨識', '未辨識']);
  await expect(result).toContainText('程式碼框可能被提前結束');
});

test('ZWNJ 與 ZWJ 僅在兩側均為 CJK 或全形時移除', async ({ page }) => {
  await ready(page);
  const result = await preview(page, '【提\u200C案概述】\n👩\u200D💻 與 a\u200Cb 保留；中\u200D文移除。\n【設計方向】\n方向\n【預算與時程提醒】\n預算');
  await assertSections(result, ['👩\u200D💻 與 a\u200Cb 保留；中文移除。', '方向', '預算', '未辨識', '未辨識']);
});

test('擴充的隱形字元不會妨礙標記和標題', async ({ page }) => {
  await ready(page);
  const invisible = '\u00AD\u180E\u200B\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2061\u2062\u2063\u2064\uFEFF';
  const bodies = ['概述', '方向 1：甲\n方向 2：乙', '預算', '問題', '整理內部工作順序'];
  const answer = `  <<GENIE-STRATEGY-v1:START${invisible}>>\n${labels.map((label, index) => `【${label.slice(0, 1)}${invisible}${label.slice(1)}】\n${bodies[index]}`).join('\n')}\n    <<GENIE-STRATEGY-v1:END${invisible}>>`;
  const result = await preview(page, answer);
  await assertSections(result, bodies);
  await expect(result).not.toContainText('找不到完整的 START／END 標記');
  await expect(result).not.toContainText('無法歸類的原文');
});

test('策略頁與貼上對話框顯示程式碼框複製說明', async ({ page }) => {
  await ready(page);
  const instruction = '按 AI 回答中程式碼框右上角的『複製』；沒有程式碼框時，長按回答 → 複製';
  await expect(page.locator('.strategy-workflow')).toContainText(instruction);
  await page.locator('[data-action="strategy-paste"]').click();
  await expect(page.locator('#info-dialog')).toContainText(instruction);
  await expect(page.locator('#info-dialog')).toContainText('Claude 若把內容開在側邊文件，按文件上的 Copy');
});

test('BOM 與零寬字元夾在標題中仍可逐欄解析', async ({ page }) => {
  await ready(page);
  const bodies = ['隱藏字元概述', '方向 1：甲\n方向 2：乙', '隱藏字元預算', '隱藏字元問題', '隱藏字元下一步'];
  const titles = ['提\uFEFF案概述', '設\u200B計方向', '預算\u200C與時程提醒', '需要向客戶確\u200D認的問題', '下\u2060一步'];
  const result = await preview(page, titles.map((title, index) => `【${title}】\n${bodies[index]}`).join('\n'));
  await assertSections(result, bodies);
  await expect(page.locator('[data-action="strategy-apply"]')).toBeEnabled();
});

test('內文重複【】標題會提示重複欄位；零標題不能套用', async ({ page }) => {
  await ready(page);
  let result = await preview(page, standard.replace('【設計方向】', '【提案概述】補充概述\n【設計方向】'));
  await expect(result).toContainText('重複欄位：提案概述');
  await expect(page.locator('[data-action="strategy-apply"]')).toBeEnabled();
  await closePreview(page);
  result = await preview(page, '這段回答只有說明，沒有任何欄位標題。');
  await expect(result).toContainText('請確認有複製到整段回答');
  await expect(page.locator('[data-action="strategy-apply"]')).toBeDisabled();
  await assertSections(result, Array(5).fill('未辨識'));
});

test('缺欄、缺標記、無法歸類與超長顯示警告；AI HTML 僅顯示文字', async ({ page }) => {
  await ready(page);
  let result = await preview(page, '前言\n【提案概述】<img src=x onerror=alert(1)>\n【設計方向】方向 1：A');
  await expect(result).toContainText('找不到完整的 START／END 標記');
  await expect(result).toContainText('缺少欄位');
  await expect(result).toContainText('無法歸類的原文');
  await expect(result.locator('img')).toHaveCount(0);
  await expect(result).toContainText('<img src=x onerror=alert(1)>');
  await page.locator('[data-action="strategy-apply"]').click();
  await expect(page.locator('.strategy-document img')).toHaveCount(0);
  await expect(page.locator('.strategy-document')).toContainText('<img src=x onerror=alert(1)>');
  result = await preview(page, standard.replace('已知需求為居家空間調整', '甲'.repeat(5001)));
  await expect(result).toContainText('欄位超過 5,000 字元：提案概述');
  await expect(page.locator('[data-action="strategy-apply"]')).toBeDisabled();
  await page.locator('#strategy-paste-text').evaluate(el => { el.value = '乙'.repeat(30001); });
  await page.locator('[data-action="strategy-parse"]').click();
  await expect(result).toContainText('整段超過 30,000 字元');
  await expect(page.locator('[data-action="strategy-apply"]')).toBeDisabled();
});

test('複製、重載、貼回、編輯與完成依據傳遞至視覺及提案', async ({ page }) => {
  await ready(page);
  await allowCopy(page);
  await page.locator('[data-action="strategy-prompt"]').click();
  await page.locator('[data-action="strategy-copy-confirm"]').click();
  await page.reload();
  await expect(page.locator('.strategy-workflow')).toContainText('這次指令');
  await preview(page, standard);
  expect((await storedProjects(page))[0].strategy).toBeUndefined();
  await page.locator('[data-action="strategy-apply"]').click();
  const p = (await storedProjects(page))[0];
  expect(p.strategy.source).toBe('ai-paste');
  expect(p.strategy.template).toBe('strategy-v1');
  expect(Object.keys(p.strategy.sections)).toEqual(keys);
  expect(p.strategy.sections.overview).toContain('已知需求為居家空間調整');
  expect(p.strategy.sections.directions).toContain('方向 2：彈性收納');
  expect(p.strategy.sections.budgetTimeline).toContain('交屋月份仍待確認');
  expect(p.strategy.sections.questions).toContain('哪些物品需要固定收納');
  expect(p.strategy.sections.nextSteps).toContain('安排丈量並核對需求');
  for (const body of Object.values(p.strategy.sections)) expect(body).not.toContain(sampleNote);
  await markComplete(page, 'strategy');
  await markComplete(page, 'visual');
  await markComplete(page, 'model3d');
  await fillEstimate(page);
  await markComplete(page, 'estimate');
  await markComplete(page, 'proposal');
  await goStep(page, 'strategy');
  await page.locator('#strategy-edit-form button[type="submit"]').click();
  await expect(stepMeta(page, 'strategy')).toHaveText('已完成');
  await page.locator('#strategy-edit-form [name="overview"]').fill('修改後概述');
  await page.locator('#strategy-edit-form button[type="submit"]').click();
  await expect(stepMeta(page, 'strategy')).toHaveText('需更新');
  await expect(stepMeta(page, 'visual')).toHaveText('需更新');
  await expect(stepMeta(page, 'proposal')).toHaveText('需更新');
  await markComplete(page, 'strategy');
  await expect(stepMeta(page, 'strategy')).toHaveText('已完成');
  await goStep(page, 'proposal');
  await expect(page.locator('.strategy-document')).toContainText('修改後概述');
});

test('需求改動與重新複製有警告；五欄全空不能完成，示範保留上一版', async ({ page }) => {
  await ready(page);
  await allowCopy(page);
  await page.locator('[data-action="strategy-prompt"]').click();
  await page.locator('[data-action="strategy-copy-confirm"]').click();
  await editFields(page, { needsNote: '新增需求' });
  await markComplete(page, 'brief');
  await goStep(page, 'strategy');
  let result = await preview(page, standard);
  await expect(result).toContainText('需求在複製指令後改過');
  await page.locator('#info-dialog [data-close]').first().click();
  await page.locator('[data-action="strategy-prompt"]').click();
  await page.locator('[data-action="strategy-copy-confirm"]').click();
  result = await preview(page, standard);
  await expect(result).toContainText('舊回答可能不對應');
  await page.locator('[data-action="strategy-apply"]').click();
  for (const key of keys) await page.locator(`#strategy-edit-form [name="${key}"]`).fill('');
  await page.locator('#strategy-edit-form button[type="submit"]').click();
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await expect(page.locator('#status-slot')).toContainText('五個欄位全空');
  await page.locator('[data-action="gen-strategy"]').click();
  await expect(page.locator('details summary')).toContainText('上一版');
  expect((await storedProjects(page))[0].strategy.sections).toBeUndefined();
});

test('剪貼簿寫入失敗可手動複製；375 與 1280 版面可操作', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-action="strategy-prompt"]').click();
    if (viewport.width === 375) expect(await page.locator('#info-dialog .dialog-heading button').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.locator('[data-action="strategy-copy-confirm"]').click();
    await expect(page.locator('#toast-text')).toContainText('手動複製');
    const selected = await page.locator('#strategy-prompt-text').evaluate(el => el.selectionEnd - el.selectionStart);
    expect(selected).toBeGreaterThan(100);
    if (viewport.width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.locator('#info-dialog [data-close]').first().click();
    await preview(page, standard);
    await expect(page.locator('[data-action="strategy-apply"]')).toBeInViewport();
    if (viewport.width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.locator('#info-dialog [data-close]').first().click();
  }
});

test('舊版示範策略載入後維持完成，策略快照移除地址', async ({ page }) => {
  await completeAllSteps(page);
  await page.evaluate(key => {
    const projects = JSON.parse(localStorage.getItem(key));
    const p = projects[0];
    p.brief.address = '僅供舊資料測試的地址';
    p.strategy.snapshot = { type: p.type, brief: { ...p.brief } };
    p.steps.brief.basis.req.address = p.brief.address;
    p.steps.strategy.basis.req = { type: p.type, ...p.brief };
    delete p.steps.strategy.basis.sections;
    for (const id of ['visual', 'model3d']) delete p.steps[id].basis.sections;
    p.steps.proposal.basis.parts = p.steps.proposal.basis.parts.map(([id, basis]) => {
      if (id === 'brief') basis.req.address = p.brief.address;
      if (id === 'strategy') { basis.req = { type: p.type, ...p.brief }; delete basis.sections; }
      if (['visual', 'model3d'].includes(id)) delete basis.sections;
      return [id, basis];
    });
    localStorage.setItem(key, JSON.stringify(projects));
  }, STORAGE_KEY);
  await page.reload();
  for (const id of ['brief', 'strategy', 'visual', 'model3d', 'estimate', 'proposal']) await expect(stepMeta(page, id)).toHaveText('已完成');
  await goStep(page, 'strategy');
  await expect(page.locator('.strategy-document')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出本機資料', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8')).projects[0];
  expect(exported.brief.address).toBe('僅供舊資料測試的地址');
  expect(exported.strategy.snapshot.brief).not.toHaveProperty('address');
});
