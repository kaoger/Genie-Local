'use strict';
const { test, expect } = require('@playwright/test');
const { installMember } = require('./mock-auth');

// Browser plugin not available；依專案規則只用 Playwright 官方執行器。
// 清單／名單／詳細頁 → 顯示提示與離線橫幅 → 避開安全區、依序排列且控制項可點。
const sizes = [
  { width: 375, height: 812, left: 59, right: 59, name: '直拿' },
  { width: 844, height: 390, left: 59, right: 0, name: '橫拿左瀏海' },
  { width: 844, height: 390, left: 0, right: 59, name: '橫拿右瀏海' },
  { width: 768, height: 1024, left: 59, right: 59, name: '平板' },
  { width: 1280, height: 800, left: 59, right: 59, name: '桌機' },
];
const notices = [
  { name: '只有唯讀條', storage: false, readonly: true },
  { name: '只有儲存警告', storage: true, readonly: false },
  { name: '兩條同時', storage: true, readonly: true },
];
const views = [
  { hash: '#/', root: '#list-view', header: '.list-header', button: '#sync-status' },
  { hash: '#/leads', root: '#leads-view', header: '.leads-header', button: '[data-action="lead-refresh"]' },
  { hash: '#/p/sample-0/brief', root: '#detail-view', header: '.detail-header', button: '[data-action="edit-all"]' },
];
const bannerText = '尚未重新確認成員（離線）';

async function showState(page, state, bannerMode) {
  await page.evaluate(({ state, bannerMode, bannerText }) => {
    document.querySelector('main').scrollTop = 0;
    document.querySelector('#storage-warning').hidden = !state.storage;
    document.querySelector('#sync-readonly').hidden = !state.readonly;
    const banner = document.querySelector('#offline-banner');
    banner.hidden = bannerMode === '隱藏';
    banner.querySelector('span').textContent = bannerMode === '換行' ? bannerText.repeat(12) : bannerText;
  }, { state, bannerMode, bannerText });
  await expect.poll(() => page.evaluate(() => {
    const banner = document.querySelector('#offline-banner');
    const height = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--offline-height'));
    return Math.abs(height - (banner.hidden ? 0 : banner.getBoundingClientRect().height));
  })).toBeLessThanOrEqual(1);
}

async function expectLayout(page, size, insets, state, view, bannerMode) {
  const layout = await page.evaluate(({ header }) => {
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    const banner = document.querySelector('#offline-banner');
    const main = document.querySelector('main');
    return {
      banner: banner.hidden ? null : rect(banner),
      bannerPadding: parseFloat(getComputedStyle(banner).paddingTop),
      notices: [...main.querySelectorAll(':scope > #storage-warning:not([hidden]), :scope > #sync-readonly:not([hidden])')].map(el => {
        const text = document.createRange();
        text.selectNodeContents(el);
        const r = text.getBoundingClientRect();
        return { id: el.id, ...rect(el), padding: parseFloat(getComputedStyle(el).paddingTop), textLeft: r.left, textRight: r.right };
      }),
      header: rect(document.querySelector(header)),
      headerPadding: parseFloat(getComputedStyle(document.querySelector(header)).paddingTop),
      documentWidth: document.documentElement.scrollWidth,
      mainOverflow: main.scrollWidth - main.clientWidth,
    };
  }, view);
  const visible = layout.notices;
  expect(visible.map(n => n.id)).toEqual([
    ...(state.storage ? ['storage-warning'] : []),
    ...(state.readonly ? ['sync-readonly'] : []),
  ]);
  const offset = layout.banner ? layout.banner.bottom : insets.top;
  const basePadding = view.header === '.detail-header' ? 0 : size.width <= 600 || size.height <= 500 ? 6 : 12;
  expect(layout.headerPadding, '頁首只在沒有上方元件時承接安全區').toBe(basePadding + (!visible.length && !layout.banner ? insets.top : 0));
  if (layout.banner) {
    expect(layout.bannerPadding, '橫幅獨自承接頂部安全區').toBe(6 + insets.top);
    if (bannerMode === '換行') expect(layout.banner.height).toBeGreaterThan(insets.top + 60);
  }
  if (visible.length) {
    expect(visible[0].top, '第一條提示在安全區或橫幅之後，且只留一次頂部空間').toBeCloseTo(offset + (state.storage ? 12 : 0), 0);
    let bottom = offset;
    for (const notice of visible) {
      expect(notice.top, '提示彼此不重疊').toBeGreaterThanOrEqual(bottom - 1);
      expect(notice.padding, '提示內部不重複加頂部安全區').toBe(12);
      expect(notice.textLeft, '提示文字避開左瀏海').toBeGreaterThanOrEqual(insets.left);
      expect(notice.textRight, '提示文字避開右瀏海').toBeLessThanOrEqual(size.width - insets.right);
      bottom = notice.bottom;
    }
    expect(layout.header.top, '頁首緊接所有提示之後').toBeCloseTo(bottom + (state.storage && !state.readonly ? 12 : 0), 0);
  } else {
    expect(layout.header.top, '提示隱藏後恢復既有頁首位置').toBeCloseTo(layout.banner ? layout.banner.bottom : 0, 0);
  }
  expect(layout.documentWidth, '文件沒有橫向捲動').toBeLessThanOrEqual(size.width);
  expect(layout.mainOverflow, '主欄沒有橫向捲動').toBeLessThanOrEqual(1);
  const button = page.locator(`${view.root} ${view.button}`);
  await button.click({ trial: true });
  expect(await button.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  }), '按鈕中心沒有被提示或橫幅遮住').toBe(true);
  if (layout.banner) await page.locator('#offline-banner button').click({ trial: true });
}

for (const size of sizes) for (const safe of [true, false]) for (const state of notices) {
  test(`${size.width}×${size.height} ${size.name} ${safe ? '安全區' : 'inset=0'} ${state.name} 三頁與離線橫幅`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: size.width, height: size.height });
    await installMember(page);
    await page.goto('/');
    await expect(page.locator('#sync-status')).toHaveText('已同步');
    const insets = safe ? { top: 59, bottom: 34, left: size.left, right: size.right } : { top: 0, bottom: 0, left: 0, right: 0 };
    // 沿用 v8.1 透過根元素四向 CSS 變數注入安全區的方式。
    await page.evaluate(insets => {
      for (const [name, value] of Object.entries(insets)) document.documentElement.style.setProperty(`--safe-${name}`, `${value}px`);
    }, insets);
    await page.evaluate(() => document.fonts.ready);
    for (const view of views) {
      await page.evaluate(hash => { location.hash = hash; }, view.hash);
      await expect(page.locator(view.header)).toBeVisible();
      if (view.hash === '#/leads') await expect(page.locator('#leads-list')).toBeVisible();
      for (const bannerMode of ['隱藏', '短橫幅', '換行']) {
        await test.step(`${view.hash} ${bannerMode}`, async () => {
          await showState(page, state, bannerMode);
          await expectLayout(page, size, insets, state, view, bannerMode);
        });
      }
      await showState(page, { storage: false, readonly: false }, '短橫幅');
      await expectLayout(page, size, insets, { storage: false, readonly: false }, view, '短橫幅');
      await showState(page, { storage: false, readonly: false }, '隱藏');
      await expectLayout(page, size, insets, { storage: false, readonly: false }, view, '隱藏');
    }
    expect(errors).toEqual([]);
  });
}
