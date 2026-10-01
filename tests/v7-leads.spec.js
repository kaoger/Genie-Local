'use strict';
const { test: base, expect } = require('@playwright/test');
const { installMember } = require('./mock-auth');

const KEY = 'genie-local-projects-v1';
const answers = (extra = {}) => ({
  service: '舊屋翻新', area: '台南', area_other: '', size: '21–30 坪',
  timeline: '1–3 個月', budget: '100–200 萬', name: '王先生',
  phone: '0912345678', contact_time: '上午 8–12 點', ...extra,
});
const row = (id, extra = {}) => ({
  id, status: 'complete', answers: answers(), customer_name: '王先生', phone: '0912345678',
  project_type: '舊屋翻新', location: '台南', interior_area: '21–30 坪',
  budget_range: '100–200 萬', start_time: '1–3 個月',
  completed_at: '2026-09-30T16:30:00.000Z', contact_result: null,
  contact_result_at: null, contact_first_at: null, contact_undo_until: null,
  lead_grade: 'normal', notification_status: 'sent', messenger_user_id: null, ...extra,
});
const test = base.extend({
  api: [async ({ page }, use) => {
    const api = { rows: [], reads: [], fail: false, hold: null };
    await installMember(page);
    await page.route('https://llqwzrgzekalwdnetvyb.supabase.co/rest/v1/customer_leads**', async route => {
      const url = new URL(route.request().url());
      api.reads.push(url);
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json', 'content-range': '*/0', 'access-control-expose-headers': 'content-range' };
      if (api.hold && url.searchParams.has('id')) await api.hold;
      if (api.fail) return route.fulfill({ status: 500, headers, body: '{"message":"read failed"}' });
      if (url.searchParams.has('id')) {
        const item = api.rows.find(x => x.id === url.searchParams.get('id').replace(/^eq\./, ''));
        return route.fulfill({ status: 200, headers, body: JSON.stringify(item ? [item] : []) });
      }
      const result = url.searchParams.get('contact_result');
      const rows = api.rows.filter(x => result === 'is.null' ? x.contact_result === null : result === 'not.is.null' ? x.contact_result !== null : x.contact_result === result?.replace(/^eq\./, ''));
      headers['content-range'] = `*/${rows.length}`;
      return route.fulfill({ status: 200, headers, body: route.request().method() === 'HEAD' ? '' : JSON.stringify(rows) });
    });
    await page.goto('/');
    await expect(page.locator('#list-view')).toBeVisible();
    await use(api);
  }, { auto: true }],
});

async function leads(page, id) {
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await expect(page.locator(`[data-lead-id="${id}"]`)).toBeVisible();
  return page.locator(`[data-lead-id="${id}"]`);
}
async function create(page, id) {
  const card = await leads(page, id);
  await card.locator('[data-lead-project]').click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/brief$/);
  return (await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY))[0];
}

test('帶入最新名單並依欄位分流，需求仍須確認', async ({ page, api }) => {
  api.rows = [row('fresh')];
  const card = await leads(page, 'fresh');
  expect(await card.locator('.lead-project-action').locator('.lead-results').count()).toBe(0);
  api.rows[0].answers.name = '最新姓名';
  await card.locator('[data-lead-project]').click();
  await expect(page.locator('#toast-text')).toHaveText('已建立專案（名單的聯絡結果沒有改變）');
  const [p] = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  expect(p).toMatchObject({ name: '最新姓名｜台南 老屋翻新 21–30 坪', contact: '最新姓名', phone: '0912345678', date: '2026-10-01', type: '居家裝潢設計', leadId: 'fresh' });
  expect(p.brief).toMatchObject({ region: '台南市', houseType: '老屋翻新', areaRange: '21–30 坪', contactTime: ['上午 8–12 點'], budget: '100–200 萬' });
  expect(p.brief.area).toBeUndefined();
  expect(p.brief.needsNote).toContain('預計開始（客人勾選）：1–3 個月');
  expect(p.brief.needsNote).not.toMatch(/最新姓名|0912345678|台南/);
  expect(p.notes).not.toContain('方便聯絡（客人勾選）');
  expect(p.leadDigest).toEqual({ service: '舊屋翻新', area: '台南', size: '21–30 坪', timeline: '1–3 個月', budget: '100–200 萬', name: '最新姓名', phone: '0912345678', contact_time: '上午 8–12 點' });
  await expect(page.locator('#status-slot [data-action="complete"]')).toBeDisabled();
  await expect(page.locator('.source-card')).toContainText('來自客戶名單，送出時間');
  await expect(page.locator('.source-card')).toContainText('已寫入欄位：聯絡人、電話、洽詢日期、需求類型、縣市、屋況、預算、坪數區間、方便聯絡');
  await expect(page.locator('.source-card')).toContainText('名稱是建立當下的簡稱');
  await expect(page.locator('.source-card [data-action="client-submit"]')).toHaveCount(0);
  expect(api.reads.some(url => url.searchParams.get('id') === 'eq.fresh')).toBe(true);
});

test('坪數區間依類型與選項分流，來源卡依實際位置顯示', async ({ page, api }) => {
  const cases = [
    ['home', '新成屋裝潢', '20 坪以下', '20 坪以下'],
    ['space', '商業空間', '31–40 坪', '31–40 坪'],
    ['unknown-size', '商業空間', '20-30 坪', null],
    ['other', '其他服務', '21–30 坪', null],
  ];
  api.rows = cases.map(([id, service, size]) => row(id, { answers: answers({ service, size }) }));
  for (const [id, , size, expected] of cases) {
    const p = await create(page, id);
    expect(p.brief.areaRange ?? null).toBe(expected);
    expect(p.brief.needsNote || '').toContain(expected ? '預計開始（客人勾選）' : `坪數（客人勾選）：${size}`);
    if (expected) expect(p.brief.needsNote).not.toContain('坪數（客人勾選）');
    await expect(page.locator('.source-card')).toContainText(expected ? '已寫入欄位：' : '寫在其他需求：坪數');
    if (expected) await expect(page.locator('.source-card')).toContainText('坪數區間');
  }
});

test('名稱使用全形分隔、縣市及服務短名，無效坪數省略', async ({ page, api }) => {
  const cases = [
    ['hs', '新竹市', '新成屋裝潢', '20 坪以下', '高旭陽｜新竹市 新成屋 20 坪以下'],
    ['hc', '新竹縣', '舊屋翻新', '21–30 坪', '高旭陽｜新竹縣 老屋翻新 21–30 坪'],
    ['cs', '嘉義市', '局部裝修', '31–40 坪', '高旭陽｜嘉義市 局部翻修 31–40 坪'],
    ['cc', '嘉義縣', '商業空間', '41–60 坪', '高旭陽｜嘉義縣 商業空間 41–60 坪'],
    ['c', '嘉義', '其他服務', '61 坪以上', '高旭陽｜嘉義 其他 61 坪以上'],
    ['u', '未知地區', '未知服務', '尚未確定', '高旭陽｜未知地區 未知服務'],
    ['prototype', '台北市', 'constructor', '', '高旭陽｜台北 constructor'],
    ['empty', '', '', '', '未留姓名'],
  ];
  api.rows = cases.map(([id, area, service, size]) => row(id, { answers: answers({ area, service, size, name: id === 'empty' ? '' : '高旭陽' }) }));
  for (const [id, , , , expected] of cases) expect((await create(page, id)).name).toBe(expected);
});

test('三種逐字聯絡時段帶入欄位；其餘原文留在備註', async ({ page, api }) => {
  const values = ['上午 8–12 點', '下午 1–5 點', '晚上 6–9 點', '平日白天', '上午 8-12 點'];
  api.rows = values.map((contact_time, i) => row(`time-${i}`, { answers: answers({ contact_time }) }));
  for (let i = 0; i < values.length; i++) {
    const p = await create(page, `time-${i}`);
    if (i < 3) {
      expect(p.brief.contactTime).toEqual([values[i]]);
      expect(p.notes).not.toContain('方便聯絡（客人勾選）');
      await expect(page.locator('.source-card')).toContainText('方便聯絡');
    } else {
      expect(p.brief.contactTime).toBeUndefined();
      expect(p.notes).toContain(`方便聯絡（客人勾選）：${values[i]}`);
    }
  }
  await page.getByRole('button', { name: '編輯全部資料' }).click();
  await expect(page.locator('#drawer')).toContainText('時段有重疊，帶入客人勾的即可，不必再勾平日白天／晚上。');
});

for (const [service, expectedType, expectedField] of [
  ['新成屋裝潢', '居家裝潢設計', ['houseType', '新成屋']],
  ['局部裝修', '居家裝潢設計', ['renoType', '局部翻修']],
  ['商業空間', '商業空間設計', ['budget', '100–200 萬']],
  ['其他服務', '其他設計', null], ['未知項目', '其他設計', null],
]) {
  test(`服務對應：${service}`, async ({ page, api }) => {
    api.rows = [row('service', { answers: answers({ service }) })];
    const p = await create(page, 'service');
    expect(p.type).toBe(expectedType);
    if (expectedField) expect(p.brief[expectedField[0]]).toBe(expectedField[1]);
    else { expect(p.brief.needsNote).toContain(`服務（客人勾選）：${service}`); expect(p.brief.needsNote).toContain('預算（客人勾選）：100–200 萬'); }
  });
}

test('其他設計即使預算文字與一般欄位相同仍寫進其他需求', async ({ page, api }) => {
  api.rows = [row('other-budget', { answers: answers({ service: '其他服務', budget: '尚未確定' }) })];
  const p = await create(page, 'other-budget');
  expect(p.brief.budget).toBeUndefined();
  expect(p.brief.needsNote).toContain('預算（客人勾選）：尚未確定');
});

for (const [label, form, expected] of [
  ['其他地區＋高雄市', { area: '其他地區', area_other: '高雄市' }, '高雄市'],
  ['其他地區＋台南自由文字', { area: '其他地區', area_other: '台南' }, ''],
  ['聊天室屏東縣', { area: '屏東縣' }, '屏東縣'],
  ['聊天室屏東', { area: '屏東' }, ''],
  ['網頁台南', { area: '台南', area_other: '' }, '台南市'],
  ['聊天室台南選項', { area: '台南' }, '台南市'],
  ['聊天室台中選項', { area: '台中' }, '台中市'],
  ['聊天室彰化選項', { area: '彰化' }, '彰化縣'],
  ['聊天室雲林選項', { area: '雲林' }, '雲林縣'],
  ['嘉義', { area: '嘉義', area_other: '' }, ''],
]) {
  test(`地區對應：${label}`, async ({ page, api }) => {
    api.rows = [row('region', { answers: { ...answers(), ...form, ...(Object.hasOwn(form, 'area_other') ? {} : { area_other: undefined }) } })];
    if (!Object.hasOwn(form, 'area_other')) delete api.rows[0].answers.area_other;
    const p = await create(page, 'region');
    expect(p.brief.region || '').toBe(expected);
    expect(p.name).toContain(['新竹市','新竹縣','嘉義市','嘉義縣'].includes(expected) ? expected : expected ? expected.replace(/[市縣]$/, '') : form.area === '其他地區' ? form.area_other : form.area);
    if (!expected) expect(p.notes).toContain(`地區（客人填寫）：${form.area === '其他地區' ? form.area_other : form.area}`);
    expect(p.brief.needsNote).not.toContain(form.area === '其他地區' ? form.area_other : form.area);
  });
}

test('尚未確定坪數、無效時間、空姓名及 XSS 原文安全', async ({ page, api }) => {
  const payload = '<img src=x onerror=alert(1)></textarea>', place = `屏東${payload}`;
  api.rows = [row('unsafe', { answers: answers({ service: `未知服務${payload}`, area: '其他地區', area_other: place, size: '尚未確定', name: payload, phone: '0912345678' }), completed_at: 'bad time' })];
  const p = await create(page, 'unsafe');
  expect(p.date).toBe('');
  expect(p.source.submittedAt).toBeUndefined();
  expect(p.brief.area).toBeUndefined();
  expect(p.brief.areaRange).toBeUndefined();
  expect(p.brief.needsNote).toContain('坪數（客人勾選）：尚未確定');
  expect(p.brief.needsNote).toContain(`未知服務${payload}`);
  expect(p.brief.needsNote).not.toContain(place);
  expect(p.notes).toContain(place);
  await expect(page.locator('img[onerror]')).toHaveCount(0);
  await expect(page.locator('.crumbs h1')).toContainText(payload);
  await page.getByRole('button', { name: '編輯全部資料' }).click();
  await expect(page.locator('#drawer')).toBeVisible();
  await expect(page.locator('#drawer textarea[name="notes"]')).toHaveValue(new RegExp('img src'));
  await expect(page.locator('#drawer img[onerror]')).toHaveCount(0);
});

test('空姓名用未留姓名，null／非物件 answers 不建立半筆', async ({ page, api }) => {
  api.rows = [row('empty', { answers: answers({ name: '  ' }) }), row('bad', { answers: null }), row('string', { answers: 'bad' })];
  const p = await create(page, 'empty');
  expect(p.contact).toBe('未留姓名');
  const card = await leads(page, 'bad');
  await card.locator('[data-lead-project]').click();
  await expect(page).toHaveURL(/#\/leads$/);
  await expect(page.locator('#toast-text')).toHaveText('名單資料不完整，無法建立專案');
  const stringCard = page.locator('[data-lead-id="string"]');
  await stringCard.locator('[data-lead-project]').click();
  await expect(page.locator('#toast-text')).toHaveText('名單資料不完整，無法建立專案');
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)).length).toBe(9);
});

test('待聯絡及已回報卡片都有建立按鈕，備註保留建立時聯絡結果', async ({ page, api }) => {
  api.rows = [row('pending'), row('reported', { contact_result: 'site_visit', contact_result_at: '2026-09-30T16:30:00Z' })];
  await leads(page, 'pending');
  await expect(page.locator('[data-lead-id="pending"] [data-lead-project]')).toHaveText('帶入名單建立專案');
  await page.locator('[data-lead-tab="contacted"]').click();
  await expect(page.locator('[data-lead-id="reported"] [data-lead-project]')).toBeVisible();
  await page.locator('[data-lead-id="reported"] [data-lead-project]').click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/brief$/);
  const [p] = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  expect(p.notes).toContain('建立時聯絡結果：約丈量');
  expect(api.rows[1].contact_result).toBe('site_visit');
});

test('連點只建一筆；已建立時開啟，多筆開最新', async ({ page, api }) => {
  api.rows = [row('repeat')];
  const card = await leads(page, 'repeat');
  await card.locator('[data-lead-project]').evaluate(button => { button.click(); button.click(); });
  await expect(page).toHaveURL(/#\/p\/[^/]+\/brief$/);
  let projects = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  expect(projects.filter(p => p.leadId === 'repeat')).toHaveLength(1);
  const latest = projects[0];
  await page.evaluate(({ key, latest }) => { const items = JSON.parse(localStorage.getItem(key)); items.push({ ...latest, id: 'older', createdAt: '2026-01-01T00:00:00Z' }); localStorage.setItem(key, JSON.stringify(items)); }, { key: KEY, latest });
  await page.reload();
  const again = await leads(page, 'repeat');
  await expect(again.locator('[data-lead-project]')).toHaveText('開啟專案');
  await again.locator('[data-lead-project]').click();
  await expect(page).toHaveURL(new RegExp(`/#/p/${latest.id}/brief$`));
  await expect(page.locator('#toast-text')).toHaveText('這位客人有兩筆專案，開啟最近的');
});

test('儲存失敗與讀取失敗都留在名單', async ({ page, api }) => {
  api.rows = [row('fail')];
  const card = await leads(page, 'fail');
  await page.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(name, value) { if (name === key) throw Error('quota'); return original.call(this, name, value); }; }, KEY);
  await card.locator('[data-lead-project]').click();
  await expect(page).toHaveURL(/#\/leads$/);
  await expect(card.locator('[data-lead-project]')).toHaveText('帶入名單建立專案');
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY))?.some(p => p.leadId === 'fail')).not.toBe(true);
  api.fail = true;
  await card.locator('[data-lead-project]').click();
  await expect(page.locator('#toast-text')).toHaveText('名單讀取失敗，請稍後再試');
  await expect(page).toHaveURL(/#\/leads$/);
});

test('重取名單期間離頁會提示已取消建立', async ({ page, api }) => {
  api.rows = [row('leave')];
  const card = await leads(page, 'leave');
  let release;
  api.hold = new Promise(resolve => { release = resolve; });
  await card.locator('[data-lead-project]').evaluate(button => button.click());
  try {
    await expect.poll(() => api.reads.filter(url => url.searchParams.get('id') === 'eq.leave').length).toBe(1);
    await page.evaluate(() => { location.hash = '#/'; });
  } finally { release(); }
  await expect(page.locator('#toast-text')).toHaveText('已取消建立（離開了客戶名單）');
  await expect(page).toHaveURL(/#\/$/);
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY))?.some(p => p.leadId === 'leave')).not.toBe(true);
});

test('複製清除名單關聯；刪除與復原更新名單按鈕', async ({ page, api }) => {
  api.rows = [row('lifecycle')];
  const p = await create(page, 'lifecycle');
  await page.getByRole('button', { name: '潛在客戶', exact: true }).click();
  await page.locator(`#rows [data-copy="${p.id}"]`).click();
  const copy = (await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY))[0];
  expect(copy.leadId).toBeUndefined();
  expect(copy.leadDigest).toBeUndefined();
  expect(copy.brief.areaRange).toBe('21–30 坪');
  expect(copy.brief.contactTime).toEqual(['上午 8–12 點']);
  await page.locator(`#rows [data-delete="${p.id}"]`).click();
  await page.locator('#confirm-delete').click();
  const card = await leads(page, 'lifecycle');
  await expect(card.locator('[data-lead-project]')).toHaveText('帶入名單建立專案');
  await page.locator('#toast-action').click();
  await expect(card.locator('[data-lead-project]')).toHaveText('開啟專案');
});

test('名單較新僅顯示改動題目；查詢失敗顯示無法核對', async ({ page, api }) => {
  api.rows = [row('changed')];
  await create(page, 'changed');
  await expect(page.locator('#lead-update-status')).toBeEmpty();
  api.rows[0].answers.service = '商業空間';
  api.rows[0].answers.size = '41–60 坪';
  await page.reload();
  await expect(page.locator('#lead-update-status')).toHaveText('名單在帶入之後改過：服務、坪數。專案維持現在的內容。');
  api.fail = true;
  await page.reload();
  await expect(page.locator('#lead-update-status')).toHaveText('無法核對名單是否已更新');
});

test('離線時顯示無法核對，不把名單視為未更新', async ({ page, api }) => {
  api.rows = [row('offline')];
  await create(page, 'offline');
  await page.evaluate(() => { const prior = window.GenieAuth.getState; window.GenieAuth.getState = () => ({ ...prior(), status: 'offline', localAccess: true }); });
  await page.getByRole('button', { name: '潛在客戶', exact: true }).click();
  await page.locator('#rows a.project-name').first().click();
  await expect(page.locator('#lead-update-status')).toHaveText('無法核對名單是否已更新');
});

test('375 與 844 寬度的按鈕可點且無橫向捲動', async ({ page, api }) => {
  api.rows = [row('mobile')];
  for (const width of [375, 844]) {
    await page.setViewportSize({ width, height: 812 });
    const card = await leads(page, 'mobile');
    const box = await card.locator('[data-lead-project]').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('舊資料與單筆損壞隔離，原 localStorage 不被覆蓋', async ({ page }) => {
  const input = [
    { id: 'old', name: '舊資料', date: '2024-01-01', type: '居家裝潢設計', brief: {}, steps: {}, leadId: 8, leadDigest: 'bad' },
    { id: 'v3', name: 'v3 舊資料', date: '2024-01-01', done: false, brief: {} },
    { id: 'bad-basis', name: '壞依據', date: '2024-01-02', type: '居家裝潢設計', brief: {}, steps: { brief: { basis: 3 } } },
    { id: 'bad-render', name: '壞聯絡人', date: '2024-01-02', brief: {}, contact: { toString: null } },
    { id: 'empty-lead', name: '空關聯', date: '2024-01-03', brief: {}, steps: {}, leadId: '' },
    { id: 'object-lead', name: '物件關聯', date: '2024-01-04', brief: {}, steps: {}, leadId: { id: 'x' } },
  ];
  const raw = JSON.stringify(input);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: KEY, raw });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(page.locator('#storage-warning')).toBeVisible();
  await expect(page.locator('#rows tr[data-id="old"]')).toBeVisible();
  await expect(page.locator('#rows tr[data-id="v3"]')).toBeVisible();
  await expect(page.locator('#rows tr[data-id="empty-lead"]')).toBeVisible();
  await expect(page.locator('#rows tr[data-id="bad-basis"]')).toHaveCount(0);
  await expect(page.locator('#rows tr[data-id="bad-render"]')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('#project-cards article[data-id="old"]')).toBeVisible();
  await expect(page.locator('#project-cards article[data-id="v3"]')).toBeVisible();
  await expect(page.locator('#project-cards article[data-id="bad-render"]')).toHaveCount(0);
  await page.getByRole('button', { name: '新增專案', exact: true }).click();
  await page.locator('#project-form [name="name"]').fill('不能覆蓋');
  await page.locator('#project-form button[type="submit"]').evaluate(button => button.click());
  await expect(page.locator('#toast-text')).toHaveText('部分資料無法讀取，請先匯出本機資料。');
  await page.locator('#editor [data-close]').first().click();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '匯出本機資料' }).click();
  await download;
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  await page.locator('#project-cards [data-delete="old"]').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#toast-text')).toHaveText('部分資料無法讀取，請先匯出本機資料。');
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  expect(errors).toEqual([]);
});

test('缺少欄位定義的舊策略快照仍能載入', async ({ page }) => {
  const input = [
    { id: 'missing-field', name: '缺欄策略', date: '2024-01-01', type: '其他設計', brief: {}, strategy: { snapshot: { type: '其他設計', brief: {} } } },
    { id: 'bad-basis', name: '壞依據', date: '2024-01-02', steps: { brief: { basis: 3 } } },
  ];
  const raw = JSON.stringify(input);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: KEY, raw });
  await page.route('**/app.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain("general:['background'");
    await route.fulfill({ response, body: body.replace("general:['background'", "general:['legacyMissingField','background'") });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(page.locator('#rows tr[data-id="missing-field"]')).toBeVisible();
  await expect(page.locator('#storage-warning')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  expect(errors).toEqual([]);
});

test('隔離開啟後按復原仍保留原 localStorage 位元組', async ({ page }) => {
  const input = [
    { id: 'linked', name: '名單專案', date: '2024-01-01', brief: {}, contact: '正常', leadId: 'linked-lead' },
    { id: 'remove', name: '待刪專案', date: '2024-01-02', brief: {} },
  ];
  await page.evaluate(({ key, input }) => localStorage.setItem(key, JSON.stringify(input)), { key: KEY, input });
  await page.reload();
  await page.locator('#rows [data-delete="remove"]').click();
  await page.locator('#confirm-delete').click();
  const raw = await page.evaluate(key => localStorage.getItem(key), KEY);
  await page.evaluate(() => { window.GenieProjects.projectsForLead('linked-lead')[0].contact = { toString: null }; });
  await page.getByRole('button', { name: '客戶名單', exact: true }).click();
  await page.getByRole('button', { name: '潛在客戶', exact: true }).click();
  await expect(page.locator('#storage-warning')).toBeVisible();
  await page.locator('#toast-action').click();
  await expect(page.locator('#toast-text')).toContainText('復原未儲存');
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
});
