'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMember } = require('./mock-auth');
const { createCloud } = require('./mock-cloud');

const sizes = [
  { width: 375, height: 812, left: 59, right: 59, name: '直拿' },
  { width: 844, height: 390, left: 59, right: 0, name: '橫拿左瀏海' },
  { width: 844, height: 390, left: 0, right: 59, name: '橫拿右瀏海' },
  { width: 768, height: 1024, left: 59, right: 59, name: '平板' },
  { width: 1280, height: 800, left: 59, right: 59, name: '桌機' },
];
const mobile = size => size.width <= 600 || size.height <= 500;
async function injectInsets(page, size) {
  await page.evaluate(({ left, right }) => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries({ top: 59, bottom: 34, left, right })) {
      root.style.setProperty(`--safe-${name}`, `${value}px`);
    }
  }, size);
}
async function safeTarget(page, locator, size, { minSize = false } = {}) {
  await expect(locator).toBeVisible();
  await locator.click({ trial: true });
  const box = await locator.boundingBox();
  expect(box.x, '左安全區').toBeGreaterThanOrEqual(size.left - 1);
  expect(box.x + box.width, '右安全區').toBeLessThanOrEqual(size.width - size.right + 1);
  expect(box.y, '頂部安全區').toBeGreaterThanOrEqual(58);
  expect(box.y + box.height, '底部安全區').toBeLessThanOrEqual(size.height - 33);
  if (minSize) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  }), '按鈕中心可點擊，沒有被另一層遮住').toBe(true);
}
async function start(page, size, cloud = createCloud()) {
  await page.setViewportSize(size);
  await installMember(page, cloud);
  await page.goto('/');
  await expect(page.locator('#sync-status')).toHaveText('已同步');
  await injectInsets(page, size);
}
async function closeInfo(page) {
  await page.locator('#info-dialog [data-close]').first().click();
}
async function showBanner(page) {
  await page.evaluate(() => {
    const banner = document.querySelector('#offline-banner');
    banner.hidden = false;
    banner.querySelector('span').textContent = '尚未重新確認成員（離線），請保留目前內容並重試。'.repeat(3);
  });
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--offline-height')))).toBeGreaterThan(59);
}
async function hideBanner(page) {
  await page.locator('#offline-banner').evaluate(el => { el.hidden = true; });
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--offline-height')))).toBe(0);
}

test('manifest、head、圖示 HTTP／尺寸／maskable 安全圓；沒有 Service Worker', async ({ page, request }) => {
  await page.goto('/');
  const manifestURL = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await request.get(manifestURL);
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: '/', name: '三禾工作台', short_name: '三禾', start_url: '/#/', scope: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#ffffff' });
  expect(manifest).not.toHaveProperty('orientation');
  expect(manifest.icons).toEqual([
    { src: '/assets/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/assets/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]);
  const apple = page.locator('link[rel="apple-touch-icon"]');
  await expect(apple).toHaveAttribute('sizes', '180x180');
  const icons = [...manifest.icons, { src: await apple.getAttribute('href'), sizes: '180x180' }];
  for (const icon of icons) {
    const url = new URL(icon.src, response.url()).href;
    const png = await request.get(url);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toContain('image/png');
    const size = Number(icon.sizes.split('x')[0]);
    const pixels = await page.evaluate(async ({ url, size }) => {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, size, size).data;
      let opaque = true, outside = false, light = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (data[i + 3] !== 255) opaque = false;
        if (data[i] > 0) {
          light++;
          if (Math.hypot(x + .5 - size / 2, y + .5 - size / 2) > size * .4) outside = true;
        }
      }
      return { width: img.naturalWidth, height: img.naturalHeight, opaque, outside, light };
    }, { url, size });
    expect(pixels.width).toBe(size); expect(pixels.height).toBe(size);
    expect(pixels.opaque).toBe(true); expect(pixels.light).toBeGreaterThan(100);
    if (icon.purpose === 'maskable') expect(pixels.outside).toBe(false);
  }
  for (const [name, content] of Object.entries({ viewport: 'width=device-width, initial-scale=1, viewport-fit=cover', 'theme-color': '#ffffff', 'apple-mobile-web-app-capable': 'yes', 'apple-mobile-web-app-title': '三禾', 'apple-mobile-web-app-status-bar-style': 'default' })) {
    await expect(page.locator(`meta[name="${name}"]`)).toHaveAttribute('content', content);
  }
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')).not.toMatch(/serviceWorker\.register|beforeinstallprompt/);
});

test('nginx manifest 的 MIME、no-cache、CSP 與標頭繼承設定', () => {
  const nginx = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'nginx.conf'), 'utf8');
  expect(nginx).toMatch(/\/assets\/manifest\.webmanifest\s+"no-cache";/);
  expect(nginx).toContain("manifest-src 'self'");
  expect(nginx).not.toMatch(/\btypes\s*\{/);
  const location = nginx.match(/location = \/assets\/manifest\.webmanifest\s*\{([^}]+)\}/)[1];
  expect(location).toMatch(/default_type application\/manifest\+json;/);
  expect(location).toMatch(/try_files \$uri =404;/);
  for (const block of nginx.matchAll(/location[^{}]*\{([^}]+)\}/g)) expect(block[1]).not.toContain('add_header');
});

for (const size of sizes) {
  const label = `${size.width}×${size.height} ${size.name}`;
  test(`${label} 第一次開啟的登入殼層避開四向安全區`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#leads-login')).toBeVisible();
    await injectInsets(page, size);
    for (const selector of ['[name="email"]', '[name="password"]', 'button[type="submit"]']) {
      const field = page.locator(`#leads-login ${selector}`);
      await field.scrollIntoViewIfNeeded();
      await safeTarget(page, field, size);
    }
    await expect(page.locator('main')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });

  test(`${label} 清單、名單、頁首、換行橫幅、toast、更多與回頂可點擊`, async ({ page }) => {
    await start(page, size);
    await safeTarget(page, page.locator('[data-action="add"]'), size, { minSize: true });
    if (mobile(size)) await safeTarget(page, page.locator('#home-account .account-name'), size);
    await showBanner(page);
    const banner = page.locator('#offline-banner');
    await safeTarget(page, banner.locator('button'), size);
    const header = page.locator('.list-header');
    await expect.poll(async () => {
      const h = await header.boundingBox(), b = await banner.boundingBox();
      return Math.abs(h.y - b.y - b.height);
    }).toBeLessThanOrEqual(1);
    expect(await header.evaluate(el => getComputedStyle(el).paddingTop)).toBe(mobile(size) ? '6px' : '12px');
    if (mobile(size)) {
      await page.locator('main').evaluate(el => { el.scrollTop = 500; });
      await expect.poll(async () => (await header.boundingBox()).y - (await banner.boundingBox()).height).toBe(0);
    }
    await hideBanner(page);
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await page.evaluate(() => window.GenieToast('換行通知：安全區中的長文字。'.repeat(5), { duration: 60000, actionLabel: '操作', onAction: () => { document.body.dataset.toastClicked = 'yes'; } }));
    await safeTarget(page, page.locator('#toast-action'), size);
    await safeTarget(page, page.locator('#dismiss-toast'), size);
    await page.locator('#toast-action').click();
    await expect(page.locator('body')).toHaveAttribute('data-toast-clicked', 'yes');
    await expect(page.locator('#toast')).toBeHidden();
    if (mobile(size)) {
      await page.locator('main').evaluate(el => { el.scrollTop = 500; });
      await safeTarget(page, page.locator('#back-to-top'), size, { minSize: true });
      await page.locator('#back-to-top').click();
      await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBe(0);
      await page.locator('#more-button').click();
      for (const button of await page.locator('#more-menu button').all()) await safeTarget(page, button, size, { minSize: true });
      await page.keyboard.press('Escape');
    }
    await page.locator('[data-action="leads"]').click();
    await expect(page.locator('#leads-list')).toBeVisible();
    await safeTarget(page, page.getByRole('button', { name: '重新整理', exact: true }), size);
    await safeTarget(page, page.locator('.leads-header .leads-account button').first(), size);
    await showBanner(page);
    await safeTarget(page, banner.locator('button'), size);
    await expect.poll(async () => (await page.locator('.leads-header').boundingBox()).y - (await banner.boundingBox()).height).toBe(0);
    await hideBanner(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });

  test(`${label} 詳細頁直接返回、抽屜頭尾與策略滿版對話框`, async ({ page }) => {
    await start(page, size);
    await page.goto('/#/p/sample-0/brief');
    await injectInsets(page, size);
    await expect(page.locator('.crumbs h1')).toBeVisible();
    if (mobile(size)) {
      await safeTarget(page, page.locator('.detail-back'), size, { minSize: true });
      await expect(page.locator('.crumbs>a')).toBeHidden();
      await page.locator('.detail-back').click();
      await expect(page).toHaveURL(/#\/$/);
      await page.goto('/#/p/sample-0/brief');
      await injectInsets(page, size);
    } else await expect(page.locator('.detail-back')).toBeHidden();
    await showBanner(page);
    await page.locator('main').evaluate(el => { el.scrollTop = 500; });
    await expect.poll(async () => (await page.locator('.detail-header').boundingBox()).y - (await page.locator('#offline-banner').boundingBox()).height).toBe(0);
    expect(await page.locator('.detail-header').evaluate(el => getComputedStyle(el).paddingTop)).toBe('0px');
    await hideBanner(page);
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await page.locator('[data-action="edit-all"]').click();
    await safeTarget(page, page.locator('.drawer-head button'), size);
    await safeTarget(page, page.locator('.drawer-foot button.primary'), size);
    await page.locator('#drawer-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await safeTarget(page, page.locator('.drawer-foot button.primary'), size);
    await page.locator('.drawer-head button').click();
    // 僅確認隔離測試頁中的範例需求，解鎖策略對話框。
    await page.locator('#status-slot [data-action="complete"]').click();
    await page.locator('#dismiss-toast').click();
    await page.locator('.stepper a[href$="/strategy"]').click();
    await page.locator('[data-action="strategy-paste"]').click();
    await safeTarget(page, page.locator('#info-dialog .dialog-heading button'), size);
    const body = page.locator('#info-body');
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    for (const action of ['[data-close]', '[data-action="strategy-parse"]']) {
      await safeTarget(page, page.locator(`#info-dialog .strategy-footer ${action}`), size);
    }
    await page.locator('#info-dialog [data-action="strategy-parse"]').click();
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await safeTarget(page, page.locator('#info-dialog .strategy-footer [data-close]'), size);
    await closeInfo(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

for (const size of sizes.filter(mobile)) test(`${size.name} 唯讀分頁從深連結返回潛在客戶`, async ({ page, context }) => {
  const project = { id: 'webapp-readonly', name: '返回測試專案', date: '2026-10-01', type: '居家裝潢設計', brief: {}, steps: {}, skip: {}, source: { kind: 'manual' } };
  const cloud = createCloud([{ id: project.id, data: project, version: 1, deleted_at: null, updated_at: '2026-10-01T00:00:00Z' }]);
  await start(page, size, cloud);
  const second = await context.newPage();
  await second.setViewportSize(size);
  await installMember(second, cloud);
  await second.goto('/#/p/webapp-readonly/brief');
  await injectInsets(second, size);
  await expect(second.locator('#sync-readonly')).toBeVisible();
  await safeTarget(second, second.locator('.detail-back'), size, { minSize: true });
  await second.locator('.detail-back').click();
  await expect(second).toHaveURL(/#\/$/);
  await expect(second.locator('#list-view')).toBeVisible();
  await expect(second.locator('#sync-readonly')).toBeVisible();
});

test('桌機 inset=0 的既有版面與使用說明', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installMember(page); await page.goto('/');
  await expect(page.locator('#sync-status')).toHaveText('已同步');
  expect((await page.locator('.sidebar').boundingBox()).width).toBe(73);
  expect((await page.locator('.list-header').boundingBox()).height).toBe(52);
  expect((await page.locator('main').boundingBox()).x).toBe(73);
  expect(await page.locator('.content').evaluate(el => getComputedStyle(el).paddingLeft)).toBe('32px');
  await expect(page.locator('#more-button')).toBeHidden();
  await page.locator('[data-action="help"]').click();
  await expect(page.locator('#info-title')).toHaveText('三禾工作台使用說明');
  for (const text of ['以 Web App 開啟', '安裝應用程式／加入主畫面', '第一次開啟要重新登入', '筆記、本機顯示名稱與未儲存內容不會帶過去', '專案：點清單上方同步狀態；名單：按重新整理', '若主畫面 App 無法儲存備份，請改用 Safari 打開網站匯出']) await expect(page.locator('#info-body')).toContainText(text);
});
