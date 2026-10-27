'use strict';
const { test, expect, lead, login, showContacted } = require('./mock-leads');

/* ================= Messenger 直達對話與舊流程 ================= */
for (const [label, threadId, contacted] of [
  ['一般編號', '123456789012345', false],
  ['1 位編號', '0', false],
  ['30 位編號與已回報名單', '123456789012345678901234567890', true],
]) {
  test(`Messenger ${label}同步開啟對話，不複製或提示`, async ({ page, api }) => {
    api.rows = [lead('direct', { messenger_user_id: '123456789012345', messenger_thread_id: threadId,
      ...(contacted ? { contact_result: 'contacted', contact_result_at: new Date().toISOString() } : {}) })];
    await login(page);
    if (contacted) await showContacted(page);
    await page.evaluate(() => {
      window.__opened = [];
      window.__copied = [];
      window.__notices = [];
      window.open = (...args) => { window.__opened.push(args); return null; };
      window.GenieToast = (...args) => window.__notices.push(args);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied.push(value); } } });
    });
    // 同一個呼叫堆疊檢查開窗；即使多加 await Promise.resolve() 也會失敗。
    const opened = await page.locator('[data-lead-id="direct"] [data-lead-messenger]').evaluate(button => {
      button.click();
      return window.__opened.map(args => args.slice());
    });
    expect(opened).toEqual([[`https://www.facebook.com/157645098246646/inbox/${threadId}/?section=messages`, '_blank', 'noopener']]);
    expect(await page.evaluate(() => ({ copied: window.__copied, notices: window.__notices }))).toEqual({ copied: [], notices: [] });
    await expect(page.locator('#toast')).toBeHidden();
    expect(api.requests.filter(request => request.method === 'GET').every(request => request.url.searchParams.get('select').split(',').includes('messenger_thread_id'))).toBe(true);
  });
}

test('Messenger 空值與不合法對話編號完整沿用收件匣、複製與提示', async ({ page, api }) => {
  const invalid = [undefined, null, '', '1/../x', 'javascript:', '1'.repeat(31), ' 123', '123 ', '１２３', '123\n'];
  api.rows = invalid.map((messenger_thread_id, index) => lead(`fallback-${index}`, { messenger_user_id: '123', messenger_thread_id }));
  await page.evaluate(() => {
    window.__opened = [];
    window.__copied = [];
    window.open = (...args) => { window.__opened.push(args); return null; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied.push(value); } } });
  });
  await login(page);
  for (let index = 0; index < invalid.length; ++index) {
    await page.locator(`[data-lead-id="fallback-${index}"] [data-lead-messenger]`).click();
    expect(await page.evaluate(() => window.__opened)).toHaveLength(index + 1);
    expect(await page.evaluate(() => window.__opened.at(-1))).toEqual(['https://business.facebook.com/latest/inbox/all/?asset_id=157645098246646&business_id=404673281059049', '_blank', 'noopener']);
    expect(await page.evaluate(() => window.__copied)).toHaveLength(index + 1);
    expect(await page.evaluate(() => window.__copied.at(-1))).toBe(`客戶 fallback-${index}`);
    await expect(page.locator('#toast-text')).toHaveText(`已複製「客戶 fallback-${index}」，到收件匣搜尋欄貼上`);
  }
});

test('Messenger 有對話編號仍須數字使用者 ID，粉專編號經網址編碼', async ({ page, api }) => {
  api.rows = [lead('encoded', { messenger_user_id: '123', messenger_thread_id: '456' }),
    ...[null, '', 'abc', 'javascript:'].map((messenger_user_id, index) => lead(`hidden-${index}`, { messenger_user_id, messenger_thread_id: '456' }))];
  await login(page);
  await page.evaluate(() => {
    window.GENIE_CONFIG.metaPageId = '123/../x?&';
    window.open = (...args) => { window.__openArgs = args; return null; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await page.locator('[data-lead-id="encoded"] [data-lead-messenger]').click();
  expect(await page.evaluate(() => window.__openArgs)).toEqual(['https://www.facebook.com/123%2F..%2Fx%3F%26/inbox/456/?section=messages', '_blank', 'noopener']);
  await expect(page.locator('[data-lead-id^="hidden-"]')).toHaveCount(4);
  await expect(page.locator('[data-lead-id^="hidden-"] [data-lead-messenger]')).toHaveCount(0);
  await expect(page.locator('#toast')).toBeHidden();
});
