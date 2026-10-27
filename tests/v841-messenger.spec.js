'use strict';
const { test, expect, lead, login } = require('./mock-leads');

/* ================= Messenger 行動裝置沿用收件匣 ================= */
const macUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
for (const { label, userAgent, maxTouchPoints, mobile } of [
  { label: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5, mobile: true },
  { label: 'Android 手機', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', maxTouchPoints: 5, mobile: true },
  { label: 'Android 平板', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', maxTouchPoints: 5, mobile: true },
  { label: 'iPad', userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5, mobile: true },
  { label: 'iPod', userAgent: 'Mozilla/5.0 (iPod; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5, mobile: true },
  { label: 'iPadOS 桌機偽裝', userAgent: macUserAgent, maxTouchPoints: 5, mobile: true },
  { label: 'Mac 桌機', userAgent: macUserAgent, maxTouchPoints: 0, mobile: false },
  { label: 'Mac 單點觸控邊界', userAgent: macUserAgent, maxTouchPoints: 1, mobile: false },
  { label: 'Windows 觸控桌機', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', maxTouchPoints: 5, mobile: false },
]) {
  test.describe(label, () => {
    test.use({ userAgent });

    test(`Messenger 有合法編號${mobile ? '仍開收件匣、複製姓名與提示' : '同步直達對話，不複製或提示'}`, async ({ page, api }) => {
      api.rows = [lead('device', { messenger_user_id: '123', messenger_thread_id: '456' })];
      await page.addInitScript(touchPoints => {
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => touchPoints });
        window.__opened = [];
        window.__copied = [];
        window.open = (...args) => { window.__opened.push(args); return null; };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied.push(value); } } });
      }, maxTouchPoints);
      await page.reload();
      await login(page);
      expect(await page.evaluate(() => ({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }))).toEqual({ userAgent, maxTouchPoints });
      // 回傳點擊堆疊中的開窗紀錄，確保任何 await 之前已開窗。
      const opened = await page.locator('[data-lead-id="device"] [data-lead-messenger]').evaluate(button => {
        button.click();
        return window.__opened.map(args => args.slice());
      });
      expect(opened).toEqual([[mobile
        ? 'https://business.facebook.com/latest/inbox/all/?asset_id=157645098246646&business_id=404673281059049'
        : 'https://www.facebook.com/157645098246646/inbox/456/?section=messages', '_blank', 'noopener']]);
      if (mobile) {
        expect(await page.evaluate(() => window.__copied)).toEqual(['客戶 device']);
        await expect(page.locator('#toast')).toBeVisible();
        await expect(page.locator('#toast-text')).toHaveText('已複製「客戶 device」，到收件匣搜尋欄貼上');
      } else {
        expect(await page.evaluate(() => window.__copied)).toEqual([]);
        await expect(page.locator('#toast')).toBeHidden();
      }
    });
  });
}
