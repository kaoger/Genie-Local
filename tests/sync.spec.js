'use strict';
const fs=require('fs');
const {test,expect}=require('@playwright/test');
const {installMember,session}=require('./mock-auth');
const {createCloud}=require('./mock-cloud');
const {createProject,openEditor,saveEditor,editFields,projectItems}=require('./helpers');
const KEY='genie-local-projects-v1',META='genie-sync-v1';
const project=(id='cloud-one',extra={})=>({id,name:'雲端專案',date:'2026-10-01',type:'居家裝潢設計',brief:{},steps:{},skip:{},source:{kind:'manual'},strategyCompare:[],...extra});
const row=(id='cloud-one',extra={})=>({id,data:project(id),version:1,deleted_at:null,updated_at:'2026-10-01T00:00:00Z',...extra});
async function start(page,cloud,local){await installMember(page,cloud);if(local)await page.addInitScript(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key:KEY,data:local});await page.goto('/');await expect.poll(()=>page.evaluate(()=>window.GenieSync.getState().ready)).toBe(true);await settle(page);}
async function settle(page){await expect.poll(()=>page.evaluate(()=>window.GenieSync.getState().busy)).toBe(false);}
async function sync(page,options){await page.evaluate(options=>window.GenieSync.sync(options),options);await settle(page);}
async function stored(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),KEY);}
async function edit(page,id,values){await page.goto(`/#/p/${id}/brief`);await editFields(page,values);}
async function remove(page,id){await page.goto('/#/');await page.locator(`#rows [data-delete="${id}"]`).click();await page.locator('#confirm-delete').click();}
function gate(){let release;const wait=new Promise(resolve=>{release=resolve;});return {wait,release};}

test('新裝置完整分頁下載，不寫示範、不反向上傳或改寫雲端原值',async({page})=>{
  const cloud=createCloud(Array.from({length:105},(_,i)=>row(`p-${String(i).padStart(3,'0')}`)));
  await start(page,cloud);expect((await stored(page)).length).toBe(105);expect(cloud.rpcs).toEqual([]);
  expect(cloud.reads[0].url.searchParams.get('select')).toBe('id,data,version,deleted_at,updated_at');
  expect(cloud.reads[0].url.searchParams.get('order')).toBe('id.asc');expect(cloud.reads).toHaveLength(2);
  expect(await page.locator('[data-id^="sample-"]').count()).toBe(0);
  expect((await stored(page))[0]).toEqual(cloud.rows[0].data);
});
test('雲端只有已刪列也不顯示示範',async({page})=>{const cloud=createCloud([row('deleted',{deleted_at:'2026-10-01T01:00:00Z'})]);await start(page,cloud);expect(await stored(page)).toBeNull();await expect(projectItems(page)).toHaveCount(0);});
test('首次讀取失敗不當空庫、不寫種子；重試後才顯示八筆示範',async({page})=>{
  const cloud=createCloud();cloud.readStatus=500;await installMember(page,cloud);await page.goto('/');
  await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');expect(await stored(page)).toBeNull();await expect(projectItems(page)).toHaveCount(0);expect(cloud.rpcs).toEqual([]);
  cloud.readStatus=200;await sync(page);await expect(projectItems(page)).toHaveCount(8);expect(await stored(page)).toBeNull();
});
test('讀取失敗保留本機內容與原始位元組，不啟動首次上傳',async({page})=>{
  const cloud=createCloud();cloud.readStatus=500;await installMember(page,cloud);const raw=JSON.stringify([project('local')]);await page.addInitScript(({key,raw})=>localStorage.setItem(key,raw),{key:KEY,raw});await page.goto('/');await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(raw);expect(cloud.rpcs).toEqual([]);
});
test('首次上傳逐筆記錄，部分失敗重新載入可續傳，不重送成功案',async({page})=>{
  const cloud=createCloud();cloud.holdRpc=async(operation,body)=>{cloud.rpcStatus=body.p_id==='local-b'?500:200;};
  await start(page,cloud,[project('local-a'),project('local-b')]);expect(cloud.rows.map(p=>p.id)).toEqual(['local-a']);
  cloud.holdRpc=null;cloud.rpcStatus=200;await page.reload();await settle(page);await expect.poll(()=>cloud.rows.length).toBe(2);await settle(page);
  expect(cloud.rpcs.filter(r=>r.p_id==='local-a')).toHaveLength(1);await expect(page.locator('#toast')).toContainText('已上傳 2 筆本機專案到雲端');
});
test('只上傳變動 id；表單 no-op 與純拉取不入列',async({page})=>{
  const cloud=createCloud([row('one'),row('two')]);await start(page,cloud);await edit(page,'one',{notes:'真的改了'});await sync(page);expect(cloud.rpcs.map(r=>r.p_id)).toEqual(['one']);
  await openEditor(page);await saveEditor(page);await sync(page);expect(cloud.rpcs).toHaveLength(1);
  cloud.rows[1].version++;cloud.rows[1].data.name='另一台的更新';await sync(page);expect(cloud.rpcs).toHaveLength(1);expect((await stored(page)).find(p=>p.id==='two').name).toBe('另一台的更新');
});
test('修改示範換 UUID，同步資料 id 一致，未改示範不傳',async({page})=>{
  const cloud=createCloud();await start(page,cloud);await edit(page,'sample-0',{name:'真實用途測試'});await sync(page);await expect.poll(()=>cloud.rows.length).toBe(1);expect(cloud.rows[0].id).toMatch(/^[\da-f]{8}-[\da-f-]{27}$/);expect(cloud.rows[0].data.id).toBe(cloud.rows[0].id);expect(cloud.rpcs.every(r=>!r.p_id.startsWith('sample-'))).toBe(true);
});
test('上傳等待中繼續編輯，只確認送出修訂，下一輪保留新內容',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'第一份'});const held=gate();cloud.holdRpc=()=>held.wait;
  await page.evaluate(()=>{window.GenieSync.sync();});await expect.poll(()=>cloud.rpcs.length).toBe(1);await editFields(page,{notes:'第二份'});
  cloud.holdRpc=null;held.release();await settle(page);expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(1);await sync(page);expect(cloud.rows[0].data.notes).toBe('第二份');expect(cloud.rows[0].version).toBe(3);
});
test('RPC 落庫後回應遺失，讀回同內容確認，不製造假衝突',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'落庫資料'});cloud.dropResponse=true;await sync(page);expect(cloud.rpcs).toHaveLength(1);await expect(page.locator('#sync-conflicts')).toBeEmpty();expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(0);
});
for(const choice of ['local','cloud'])test(`兩台裝置衝突選 ${choice}，僅一筆且不重複提示`,async({browser})=>{
  const a=await browser.newContext(),b=await browser.newContext();try{const pa=await a.newPage(),pb=await b.newPage(),cloud=createCloud([row()]);await start(pa,cloud);await start(pb,cloud);
    await edit(pa,'cloud-one',{notes:'A 的內容'});await sync(pa);await edit(pb,'cloud-one',{notes:'B 的內容'});await sync(pb);await pb.goto('/#/');await expect(pb.locator('#sync-conflicts .sync-conflict')).toHaveCount(1);expect((await stored(pb))[0].notes).toBe('B 的內容');
    await pb.locator(`[data-sync-choice="${choice}"]`).click();await settle(pb);await sync(pb);await expect(pb.locator('#sync-conflicts')).toBeEmpty();expect(cloud.rows).toHaveLength(1);expect(cloud.rows[0].data.notes).toBe(choice==='local'?'B 的內容':'A 的內容');expect((await stored(pb))[0].notes).toBe(cloud.rows[0].data.notes);
  }finally{await a.close();await b.close();}
});
test('同內容不同 version 只更新基準，不算衝突或上傳',async({page})=>{const cloud=createCloud([row()]);await start(page,cloud);cloud.rows[0].version=3;await sync(page);expect(cloud.rpcs).toEqual([]);await expect(page.locator('#sync-conflicts')).toBeEmpty();expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).entries['cloud-one'].version,META)).toBe(3);});
for(const choice of ['local','cloud'])test(`雲端刪除遇本機修改，選 ${choice} 會復原或一起刪除`,async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'離線修改'});cloud.rows[0].version++;cloud.rows[0].deleted_at='2026-10-01T01:00:00Z';await sync(page);await page.goto('/#/');await expect(page.locator('#sync-conflicts')).toContainText('另一台已刪除');await page.locator(`[data-sync-choice="${choice}"]`).click();await sync(page);
  await expect(page.locator('#sync-conflicts')).toBeEmpty();expect(cloud.rows[0].deleted_at===null).toBe(choice==='local');expect((await stored(page)).length).toBe(choice==='local'?1:0);if(choice==='local')expect(cloud.rows[0].data.notes).toBe('離線修改');
});
test('刪除十秒內完全不打網路，未送出復原不打 delete／restore',async({page})=>{const cloud=createCloud([row()]);await start(page,cloud);await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));const reads=cloud.reads.length;await remove(page,'cloud-one');await sync(page);await page.clock.runFor(9999);expect(cloud.reads).toHaveLength(reads);expect(cloud.rpcs).toEqual([]);await page.locator('#toast-action').click();await sync(page);expect(cloud.rpcs).toEqual([]);expect((await stored(page))).toHaveLength(1);});
test('刪除送出中按復原，拿到刪除 version 再 restore',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await remove(page,'cloud-one');const held=gate();cloud.holdRpc=()=>held.wait;await page.evaluate(()=>{window.GenieSync.sync({keepalive:true});});await expect.poll(()=>cloud.rpcs.length).toBe(1);await page.locator('#toast-action').click();cloud.holdRpc=null;held.release();await sync(page);await expect.poll(()=>cloud.rows[0].deleted_at).toBeNull();await settle(page);expect(cloud.rpcs.map(r=>r.operation)).toEqual(['delete','restore']);expect(cloud.rpcs[1].p_expected_version).toBe(2);
});
test('刪除已完成十秒內按復原，restore 成功；提示不蓋復原按鈕',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await remove(page,'cloud-one');await sync(page,{keepalive:true});expect(cloud.rows[0].deleted_at).not.toBeNull();await expect(page.locator('#toast-action')).toHaveText('復原');await page.locator('#toast-action').click();await sync(page);expect(cloud.rows[0].deleted_at).toBeNull();expect(cloud.rpcs.map(r=>r.operation)).toEqual(['delete','restore']);
});
test('離線刪除重載不復活，墓碑不會當成新增上傳',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await remove(page,'cloud-one');cloud.readStatus=500;await page.reload();await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');await expect(projectItems(page)).toHaveCount(0);cloud.readStatus=200;await sync(page,{keepalive:true});await expect(projectItems(page)).toHaveCount(0);expect(cloud.rpcs.map(r=>r.operation)).toEqual(['delete']);
});
test('十秒逾時自動 delete，連續刪除延長共同期限',async({page})=>{
  const cloud=createCloud([row('one'),row('two')]);await start(page,cloud);await page.clock.install();await remove(page,'one');await page.clock.runFor(6000);await remove(page,'two');await page.clock.runFor(6000);expect(cloud.rpcs).toEqual([]);await page.clock.runFor(4100);await settle(page);expect(cloud.rpcs.map(r=>r.operation)).toEqual(['delete','delete']);
});
test('同瀏覽器雙分頁唯讀、storage 更新，主分頁关闭後接手',async({page,context})=>{
  const cloud=createCloud([row()]);await start(page,cloud);const second=await context.newPage();await installMember(second,cloud);await second.goto('/');await expect(second.locator('#sync-readonly')).toBeVisible();await second.getByRole('button',{name:'新增專案',exact:true}).click();await expect(second.locator('#editor')).toBeHidden();await edit(page,'cloud-one',{notes:'主分頁修改'});await sync(page);await expect.poll(async()=> (await stored(second))[0].notes).toBe('主分頁修改');await page.close();await expect.poll(()=>second.evaluate(()=>window.GenieSync.getState().writer)).toBe(true);await edit(second,'cloud-one',{notes:'接手後修改'});await sync(second);expect(cloud.rows[0].data.notes).toBe('接手後修改');
});
test('登出有待上傳時阻擋；匯出四欄 version 3 後登出清專案，保留筆記',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await page.evaluate(()=>{localStorage.setItem('genie-local-notes','保留筆記');localStorage.setItem('genie-local-name','本機名稱');});await edit(page,'cloud-one',{notes:'未上傳'});cloud.rpcStatus=500;await page.getByRole('button',{name:'登出',exact:true}).first().click();await expect(page.locator('#signout-dialog')).toContainText('還有 1 筆沒上傳');expect(await stored(page)).not.toBeNull();const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="export-signout"]').click();const download=await downloadPromise,data=JSON.parse(fs.readFileSync(await download.path(),'utf8'));expect(Object.keys(data).sort()).toEqual(['displayName','notes','projects','version']);expect(data.version).toBe(3);expect(data.projects[0].notes).toBe('未上傳');await expect(page.locator('#leads-login')).toBeVisible();expect(await stored(page)).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('genie-sync-v1'))).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('genie-local-notes'))).toBe('保留筆記');
});
test('登出前請求晚到不得把已清快取寫回',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);const held=gate();cloud.holdRead=()=>held.wait;await page.evaluate(()=>{window.GenieSync.sync();});await expect.poll(()=>cloud.reads.length).toBeGreaterThan(1);await page.evaluate(()=>window.GenieAuth.signOut({exported:true}));held.release();await expect(page.locator('#leads-login')).toBeVisible();expect(await stored(page)).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('genie-sync-v1'))).toBeNull();
});
test('停用清專案快取與同步標記，離線不清',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await page.route('**/rest/v1/app_admins**',route=>route.fulfill({status:500,body:'{}',headers:{'content-type':'application/json','access-control-allow-origin':'*'}}));await page.evaluate(()=>window.GenieAuth.getClient().auth.refreshSession());await expect(page.locator('#offline-banner')).toBeVisible();expect(await stored(page)).not.toBeNull();await page.route('**/rest/v1/app_admins**',route=>route.fulfill({status:200,body:'[{"active":false}]',headers:{'content-type':'application/json','access-control-allow-origin':'*'}}));await page.locator('[data-action="auth-retry"]').click();await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限');expect(await stored(page)).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('genie-sync-v1'))).toBeNull();
});
test('壞雲端列隔離，XSS 安全顯示，其他專案仍可存檔上傳',async({page})=>{
  const bad=row('bad');bad.data.steps={brief:{basis:3}};const cloud=createCloud([bad,row('good',{data:project('good',{name:'<img src=x onerror=alert(1)>'})})]);await start(page,cloud);await expect(page.locator('#sync-quarantine')).toContainText('1 筆無法讀取');await expect(page.locator('#storage-warning')).toBeHidden();await expect(page.locator('#rows img')).toHaveCount(0);await edit(page,'good',{notes:'仍可存檔'});await sync(page);expect(cloud.rows.find(r=>r.id==='good').data.notes).toBe('仍可存檔');
});
test('抽屜開啟時雲端更新保留草稿，儲存產生衝突提示',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await page.goto('/#/p/cloud-one/brief');await openEditor(page);await page.locator('#drawer-form [name="notes"]').fill('抽屜未儲存');cloud.rows[0].version++;cloud.rows[0].data.notes='另一台已改';await sync(page);await expect(page.locator('#drawer-form [name="notes"]')).toHaveValue('抽屜未儲存');await expect(page.locator('#drawer-cloud-note')).toBeVisible();await saveEditor(page);await sync(page);await page.goto('/#/');await expect(page.locator('#sync-conflicts')).toContainText('另一台有較新的');expect(cloud.rows[0].data.notes).toBe('另一台已改');
});
test('已有相同 leadId 的雲端專案，上傳前改開既有案',async({page})=>{
  const cloud=createCloud();await start(page,cloud);cloud.rows.push(row('existing',{data:project('existing',{leadId:'lead-one'})}));await page.evaluate(()=>window.GenieProjects.createFromLead({id:'lead-one',answers:{name:'測試客戶'},completed_at:'2026-10-01T00:00:00Z'}));await sync(page);expect(cloud.rpcs).toEqual([]);await expect(page).toHaveURL(/existing\/brief$/);await expect(page.locator('#toast')).toContainText('這位客人已有專案');expect((await stored(page)).filter(p=>p.leadId==='lead-one')).toHaveLength(1);
});
test('下載途中 commit 作廢本次套用，不覆盖新編輯',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);const held=gate();cloud.holdRead=()=>held.wait;await page.evaluate(()=>{window.GenieSync.sync();});await expect.poll(()=>cloud.reads.length).toBeGreaterThan(1);await edit(page,'cloud-one',{notes:'剛存的'});cloud.holdRead=null;held.release();await settle(page);await sync(page);expect((await stored(page))[0].notes).toBe('剛存的');expect(cloud.rows[0].data.notes).toBe('剛存的');
});
test('手機同步狀態列可見且沒有橫向溢出',async({page})=>{await page.setViewportSize({width:375,height:812});await start(page,createCloud([row()]));await expect(page.locator('#sync-status')).toBeVisible();expect(await page.locator('#sync-panel').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(375);});
for(const change of ['edit','new','delete'])test(`同步標記寫入失敗後重载补判 ${change}，不遗失本機變更`,async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);
  await page.evaluate(key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};},META);
  if(change==='edit')await edit(page,'cloud-one',{notes:'標記失敗也保留'});
  if(change==='new')await createProject(page,{name:'標記失敗的新建案'});
  if(change==='delete')await remove(page,'cloud-one');
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.GenieSync.getState().ready)).toBe(true);await settle(page);
  if(change==='edit')expect(cloud.rows[0].data.notes).toBe('標記失敗也保留');
  if(change==='new')expect(cloud.rows.some(r=>r.data.name==='標記失敗的新建案')).toBe(true);
  if(change==='delete'){expect(cloud.rows[0].deleted_at).not.toBeNull();await expect(projectItems(page)).toHaveCount(0);}
});
test('下載本機存檔失敗放棄套用，畫面與原始快取維持原狀',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);const before=await stored(page);await page.evaluate(key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};},KEY);
  cloud.rows[0].version++;cloud.rows[0].data.name='不得套用的遠端';await sync(page);expect(await stored(page)).toEqual(before);await expect(page.locator('#rows')).not.toContainText('不得套用的遠端');await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');
});
test('分頁第 2 頁讀取失敗，不套用第 1 頁、不搬家或播種',async({page})=>{
  const cloud=createCloud(Array.from({length:101},(_,i)=>row(`p-${i}`)));await installMember(page,cloud);await page.route('**/rest/v1/genie_projects**',async(route)=>{const url=new URL(route.request().url());if(url.searchParams.get('offset')==='100')return route.fulfill({status:500,body:'{}',headers:{'content-type':'application/json','access-control-allow-origin':'*'}});return route.fallback();});await page.goto('/');await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');expect(await stored(page)).toBeNull();expect(cloud.rpcs).toEqual([]);await expect(projectItems(page)).toHaveCount(0);
});
test('commit 防抖 1.5 秒；連續編輯最長十秒仍會送出',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));await edit(page,'cloud-one',{notes:'防抖'});await page.clock.runFor(1499);expect(cloud.rpcs).toEqual([]);await page.clock.runFor(1);await settle(page);expect(cloud.rpcs).toHaveLength(1);
  cloud.rpcs=[];for(let i=0;i<10;i++){await editFields(page,{notes:`連續 ${i}`});await page.clock.runFor(1000);}
  await settle(page);expect(cloud.rpcs).toHaveLength(1);expect(cloud.rows[0].data.notes).toBe('連續 9');
});
test('被藏起立即送 RPC 並帶 keepalive，不先等雲端清單讀取',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'切換 App 前'});const reads=cloud.reads.length;
  await page.evaluate(()=>{window.__keepalive=[];const original=window.fetch;window.fetch=(input,init)=>{if(String(input).includes('/rpc/'))window.__keepalive.push(init.keepalive);return original(input,init);};Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await settle(page);expect(cloud.rows[0].data.notes).toBe('切換 App 前');expect(await page.evaluate(()=>window.__keepalive)).toEqual([true]);expect(cloud.reads.slice(reads).every(r=>r.url.searchParams.has('id'))).toBe(true);
});
test('同步與名單同時 401 共用一次續期，成功後保留編輯',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'續期後保留'});let refreshes=0;const held=gate();await page.route('**/auth/v1/token**',async route=>{refreshes++;await held.wait;return route.fulfill({status:200,body:JSON.stringify(session()),headers:{'content-type':'application/json','access-control-allow-origin':'*'}});});
  cloud.readStatus=401;await page.evaluate(()=>{window.GenieSync.sync();});await expect.poll(()=>refreshes).toBe(1);await page.evaluate(()=>{window.GenieAuth.refresh();});cloud.readStatus=200;held.release();await settle(page);expect(refreshes).toBe(1);expect(cloud.rows[0].data.notes).toBe('續期後保留');
});
test('续期成功但读取仍 401 保留快取與佇列，不清資料或改 auth.status',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'等連線恢復'});cloud.readStatus=401;await sync(page);expect(await page.evaluate(()=>window.GenieAuth.getState().status)).toBe('member');expect((await stored(page))[0].notes).toBe('等連線恢復');expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(1);await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');
});
test('refresh token 確定無效才回登入，未上傳快取保留',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'失效前儲存'});cloud.readStatus=401;await page.route('**/auth/v1/token**',route=>route.fulfill({status:400,body:'{"error":"invalid_grant","error_description":"Refresh token expired"}',headers:{'content-type':'application/json','access-control-allow-origin':'*'}}));await sync(page);await expect(page.locator('#leads-login')).toBeVisible();expect((await stored(page))[0].notes).toBe('失效前儲存');expect(await page.evaluate(()=>localStorage.getItem('genie-sync-v1'))).not.toBeNull();
});
test('续期遇暫時網路失敗保留快取與佇列，恢復後可重送',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'續期離線'});cloud.readStatus=401;const held=gate();await page.route('**/auth/v1/token**',async route=>{await held.wait;return route.abort('failed');});
  await page.evaluate(()=>{window.GenieAuth.getClient().auth.refreshSession=async()=>({data:{session:null},error:{status:0,message:'Network error'}});});await sync(page);expect((await stored(page))[0].notes).toBe('續期離線');expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(1);expect(await page.evaluate(()=>window.GenieAuth.getState().status)).toBe('member');cloud.readStatus=200;await sync(page);expect(cloud.rows[0].data.notes).toBe('續期離線');held.release();
});
test('舊版未編輯示範缺新增欄位，仍不會上傳；載入正規化不回寫或入列',async({page})=>{
  const sample={id:'sample-2',name:'測試',date:'2026-07-21',done:false,contact:'',type:'居家裝潢設計',email:'',phone:'',due:'',notes:''};
  const cloud=createCloud();await start(page,cloud,[sample]);expect(cloud.rpcs).toEqual([]);expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(0);expect(await stored(page)).toEqual([sample]);await page.reload();await settle(page);expect(cloud.rpcs).toEqual([]);expect(await stored(page)).toEqual([sample]);
});
test('正常登出完成所有上傳後清快取與標記，筆記、名稱、記住信箱保留',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await page.evaluate(()=>{localStorage.setItem('genie-local-notes','筆記');localStorage.setItem('genie-local-name','名稱');localStorage.setItem('genie-last-email','member@example.test');});await edit(page,'cloud-one',{notes:'登出前上傳'});await page.getByRole('button',{name:'登出',exact:true}).first().click();await expect(page.locator('#leads-login')).toBeVisible();expect(cloud.rows[0].data.notes).toBe('登出前上傳');expect(await stored(page)).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('genie-sync-v1'))).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('genie-local-notes'))).toBe('筆記');expect(await page.evaluate(()=>localStorage.getItem('genie-local-name'))).toBe('名稱');await expect(page.locator('#leads-login [name="email"]')).toHaveValue('member@example.test');
});
test('另一分頁登出會撤銷主分頁晚到回應，不重新寫入快取',async({page,context})=>{
  const cloud=createCloud([row()]);await start(page,cloud);const second=await context.newPage();await installMember(second,cloud);await second.goto('/');await expect(second.locator('#sync-readonly')).toBeVisible();const held=gate();cloud.holdRead=()=>held.wait;await page.evaluate(()=>{window.GenieSync.sync();});await expect.poll(()=>cloud.reads.length).toBeGreaterThan(1);await second.evaluate(()=>window.GenieAuth.signOut({exported:true}));held.release();await expect(page.locator('#leads-login')).toBeVisible();expect(await stored(page)).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('genie-sync-v1'))).toBeNull();
});
test('抽屜草稿遇雲端刪除，儲存後提示選擇，仍要留下才 restore',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await page.goto('/#/p/cloud-one/brief');await openEditor(page);await page.locator('#drawer-form [name="notes"]').fill('刪除後仍要留的草稿');cloud.rows[0].version++;cloud.rows[0].deleted_at='2026-10-01T01:00:00Z';await sync(page);await expect(page.locator('#drawer-cloud-note')).toBeVisible();await expect(page.locator('#drawer-form [name="notes"]')).toHaveValue('刪除後仍要留的草稿');await saveEditor(page);await sync(page);expect(cloud.rpcs).toEqual([]);await page.goto('/#/');await expect(page.locator('#sync-conflicts')).toContainText('另一台已刪除');await page.locator('[data-sync-choice="local"]').click();await sync(page);expect(cloud.rows[0].deleted_at).toBeNull();expect(cloud.rows[0].data.notes).toBe('刪除後仍要留的草稿');
});
test('首次完整讀取失敗時登出，仍將舊本機案算作未上傳並阻擋清除',async({page})=>{
  const cloud=createCloud();cloud.readStatus=500;await installMember(page,cloud);await page.addInitScript(({key,data})=>localStorage.setItem(key,JSON.stringify([data])),{key:KEY,data:project('legacy-local')});await page.goto('/');await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');await page.getByRole('button',{name:'登出',exact:true}).first().click();await expect(page.locator('#signout-dialog')).toContainText('還有 1 筆沒上傳');expect((await stored(page))[0].id).toBe('legacy-local');await expect(page.locator('#leads-login')).toHaveCount(0);
});
test('復原時標記寫入失敗，重載後以本機內容補判復原，不送 delete',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await remove(page,'cloud-one');await page.evaluate(key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};},META);await page.locator('#toast-action').click();await page.reload();await expect.poll(()=>page.evaluate(()=>window.GenieSync.getState().ready)).toBe(true);await settle(page);expect(cloud.rpcs).toEqual([]);expect(cloud.rows[0].deleted_at).toBeNull();expect((await stored(page))).toHaveLength(1);
});

test('墓碑寫入失敗後重載、雲端讀取失敗，登出被擋；恢復後刪除不復活',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);
  await page.evaluate(key=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('full','QuotaExceededError');return set.call(this,k,v);};},META);
  await remove(page,'cloud-one');cloud.readStatus=500;await page.reload();await expect(page.locator('#sync-status')).toHaveText('同步失敗，點此重試');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).entries['cloud-one'].pending,META)).toBe('delete');
  await page.getByRole('button',{name:'登出',exact:true}).first().click();await expect(page.locator('#signout-dialog')).toContainText('還有 1 筆沒上傳');expect(await stored(page)).toEqual([]);expect(cloud.rows[0].deleted_at).toBeNull();
  await page.locator('#signout-dialog [data-close]').click();cloud.readStatus=200;await sync(page);expect(cloud.rows[0].deleted_at).not.toBeNull();
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.GenieSync.getState().ready)).toBe(true);await settle(page);expect(await stored(page)).toEqual([]);expect(cloud.rpcs.map(r=>r.operation)).toEqual(['delete']);
});

for(const change of ['edit','delete'])test(`唯讀分頁未收到 storage 時，登出重讀磁碟 ${change} 並阻擋清除`,async({page,context})=>{
  const cloud=createCloud([row()]);await start(page,cloud);const second=await context.newPage();await second.addInitScript(()=>window.addEventListener('storage',e=>e.stopImmediatePropagation()));await installMember(second,cloud);await second.goto('/');await expect(second.locator('#sync-readonly')).toBeVisible();
  cloud.rpcStatus=500;if(change==='edit')await edit(page,'cloud-one',{notes:'磁碟上未送出的修改'});else{await page.evaluate(key=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('full','QuotaExceededError');return set.call(this,k,v);};},META);await remove(page,'cloud-one');}
  await second.getByRole('button',{name:'登出',exact:true}).first().click();await expect(second.locator('#signout-dialog')).toContainText('還有 1 筆沒上傳');if(change==='edit')expect((await stored(second))[0].notes).toBe('磁碟上未送出的修改');else expect(await stored(second)).toEqual([]);await second.close();
});

test('本機乾淨遇到雲端已刪，移除本機且不反向上傳',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);cloud.rows[0].deleted_at='2026-10-01T01:00:00Z';cloud.rows[0].version++;await sync(page);expect(await stored(page)).toEqual([]);expect(cloud.rpcs).toEqual([]);await expect(page.locator('#sync-conflicts')).toBeEmpty();
});

test('pagehide 撞進行中的同步，等回應後補送新修訂 keepalive 才停止',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await edit(page,'cloud-one',{notes:'第一份'});const held=gate();cloud.holdRpc=()=>held.wait;
  await page.evaluate(()=>{window.__keepalive=[];const fetch=window.fetch;window.fetch=(input,init)=>{if(String(input).includes('/rpc/'))window.__keepalive.push(!!init.keepalive);return fetch(input,init);};window.GenieSync.sync();});await expect.poll(()=>cloud.rpcs.length).toBe(1);
  await editFields(page,{notes:'切走前第二份'});await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));cloud.holdRpc=null;held.release();
  await expect.poll(()=>cloud.rows[0].data.notes).toBe('切走前第二份');await expect.poll(()=>page.evaluate(()=>window.GenieSync.canWrite())).toBe(false);expect(cloud.rpcs).toHaveLength(2);expect(await page.evaluate(()=>window.__keepalive)).toEqual([false,true]);expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(0);
});

test('相同 leadId 本機建立後已編輯，保留並上傳新專案',async({page})=>{
  const cloud=createCloud();await start(page,cloud);cloud.rows.push(row('existing',{data:project('existing',{leadId:'lead-one'})}));
  await page.evaluate(()=>window.GenieProjects.createFromLead({id:'lead-one',answers:{name:'測試客戶'},completed_at:'2026-10-01T00:00:00Z'}));const id=decodeURIComponent(new URL(page.url()).hash.split('/')[2]);await editFields(page,{phone:'0912345678',notes:'建立後的編輯'});await sync(page);
  expect(cloud.rows.filter(r=>r.data.leadId==='lead-one')).toHaveLength(2);expect(cloud.rows.find(r=>r.id===id).data.notes).toBe('建立後的編輯');expect((await stored(page)).find(p=>p.id===id).phone).toBe('0912345678');await expect(page.locator('#toast')).toContainText('這位客人雲端已有另一筆專案');
});

test('詳細頁未儲存會議記錄失焦後仍保留；儲存才重畫並提示衝突',async({page})=>{
  const cloud=createCloud([row('cloud-one',{data:project('cloud-one',{source:{kind:'meeting',meetingText:'原始記錄'}})})]);await start(page,cloud);await page.goto('/#/p/cloud-one/brief');
  await page.locator('#meeting-form [name="meetingText"]').fill('尚未儲存的記錄');await page.locator('.crumbs h1').click();cloud.rows[0].version++;cloud.rows[0].data.source.meetingText='另一台的記錄';await sync(page);
  await expect(page.locator('#meeting-form [name="meetingText"]')).toHaveValue('尚未儲存的記錄');await expect(page.locator('#detail-cloud-note')).toHaveText('另一台已更新這個專案，儲存或離開後會重新整理');await page.locator('#meeting-form button[type="submit"]').click();await expect(page.locator('#detail-cloud-note')).toHaveCount(0);await sync(page);await page.goto('/#/');await expect(page.locator('#sync-conflicts')).toContainText('另一台有較新的');expect(cloud.rows[0].data.source.meetingText).toBe('另一台的記錄');
});

test('詳細頁可編輯欄位有焦點，即使未輸入也延後重畫，失焦後刷新',async({page})=>{
  const cloud=createCloud([row('cloud-one',{data:project('cloud-one',{source:{kind:'meeting',meetingText:'原始'}})})]);await start(page,cloud);await page.goto('/#/p/cloud-one/brief');await page.locator('[name="meetingText"]').focus();cloud.rows[0].data.source.meetingText='另一台';cloud.rows[0].version++;await sync(page);await expect(page.locator('[name="meetingText"]')).toHaveValue('原始');await expect(page.locator('#detail-cloud-note')).toBeVisible();await page.locator('.crumbs h1').click();await expect(page.locator('[name="meetingText"]')).toHaveValue('另一台');
});

test('restore 回應遺失但讀回內容不同，保持本機並列出衝突',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);await remove(page,'cloud-one');await sync(page,{keepalive:true});await page.locator('#toast-action').click();
  cloud.afterRpc=operation=>{if(operation==='restore'){cloud.rows[0].version++;cloud.rows[0].data.notes='別台復原後修改';cloud.dropResponse=true;}};await sync(page);await page.goto('/#/');await expect(page.locator('#sync-conflicts')).toContainText('另一台有較新的');expect((await stored(page))[0].notes).not.toBe('別台復原後修改');expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(1);expect(await page.evaluate(()=>window.GenieSync.getState().failed)).toBe(false);
  // 選「留下這台的」：拆掉已復原墓碑，本機內容真的上傳，重載後仍是本機版，登出不被擋。
  const localNotes=(await stored(page))[0].notes,before=cloud.rows[0].version;
  await page.locator('[data-sync-choice="local"]').click();await sync(page);
  expect(cloud.rows[0].version).toBeGreaterThan(before);expect(cloud.rows[0].deleted_at).toBeNull();expect(cloud.rows[0].data.notes).toBe(localNotes);
  await expect(page.locator('#sync-conflicts')).toBeEmpty();expect(await page.evaluate(()=>window.GenieSync.getState().pending)).toBe(0);
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.GenieSync.getState().ready)).toBe(true);await settle(page);
  expect((await stored(page))[0].notes).toBe(localNotes);expect(await page.evaluate(()=>window.GenieSync.prepareSignOut())).toBe(0);
});

for(const choice of ['local','cloud'])test(`not_found 不拖垮其他案，選 ${choice} 重新上傳或從本機移除`,async({page})=>{
  const cloud=createCloud([row('missing'),row('good')]);await start(page,cloud);await edit(page,'missing',{notes:'管理者移除後仍在本機'});await edit(page,'good',{notes:'其他案照常'});
  cloud.holdRpc=(operation,body)=>{if(body.p_id==='missing'&&body.p_expected_version>0)cloud.rows=cloud.rows.filter(r=>r.id!=='missing');};await sync(page);await page.goto('/#/');
  await expect(page.locator('#sync-status')).toHaveText('1 筆無法上傳：雲端專案');await expect(page.locator('#sync-conflicts')).toContainText('雲端已沒有');await expect(page.locator('[data-sync-choice="local"]')).toHaveText('重新上傳');await expect(page.locator('[data-sync-choice="cloud"]')).toHaveText('從這台移除');expect(cloud.rows.find(r=>r.id==='good').data.notes).toBe('其他案照常');expect(await page.evaluate(()=>window.GenieSync.getState().failed)).toBe(false);
  await page.locator(`[data-sync-choice="${choice}"]`).click();await sync(page);expect((await stored(page)).some(p=>p.id==='missing')).toBe(choice==='local');expect(cloud.rows.some(r=>r.id==='missing')).toBe(choice==='local');await expect(page.locator('#sync-conflicts')).toBeEmpty();await expect(page.locator('#sync-status')).toHaveText('已同步');
});

for(const code of ['22023','23514'])test(`單筆 ${code} 標無法上傳，其他案成功；修正後可以再傳`,async({page})=>{
  const cloud=createCloud([row('bad'),row('good')]);await start(page,cloud);await edit(page,'bad',{notes:'拒絕這筆'});await edit(page,'good',{notes:'正常這筆'});cloud.holdRpc=(operation,body)=>{cloud.rpcCode=body.p_id==='bad'?code:null;};await sync(page);await page.goto('/#/');await expect(page.locator('#sync-status')).toContainText('1 筆無法上傳');expect(cloud.rows.find(r=>r.id==='good').data.notes).toBe('正常這筆');expect(await page.evaluate(()=>window.GenieSync.getState().failed)).toBe(false);const calls=cloud.rpcs.length;await sync(page);expect(cloud.rpcs).toHaveLength(calls);
  cloud.holdRpc=null;cloud.rpcCode=null;await edit(page,'bad',{notes:'修正完成'});await sync(page);expect(cloud.rows.find(r=>r.id==='bad').data.notes).toBe('修正完成');expect(await page.evaluate(()=>window.GenieSync.getState().unable)).toEqual([]);
});

test('超大小的專案隔離為無法上傳，其他案成功',async({page})=>{
  const cloud=createCloud([row('large'),row('good')]);await start(page,cloud);await page.evaluate(()=>{const before=JSON.parse(localStorage.getItem('genie-local-projects-v1')),after=structuredClone(before);after.find(p=>p.id==='large').notes='x'.repeat(1000000);after.find(p=>p.id==='good').notes='正常大小';localStorage.setItem('genie-local-projects-v1',JSON.stringify(after));window.GenieSync.record(before,after);});
  // 同步 adapter 必須讀取這份磁碟資料，模擬重新載入後恢復待上傳。
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.GenieSync.getState().ready)).toBe(true);await settle(page);await expect(page.locator('#sync-status')).toContainText('1 筆無法上傳');expect(cloud.rows.find(r=>r.id==='good').data.notes).toBe('正常大小');expect(await page.evaluate(()=>window.GenieSync.getState().failed)).toBe(false);
});

test('42501 重查成員停用，清除未上傳修改與刪除，不再寫入',async({page})=>{
  const cloud=createCloud([row('one'),row('two')]);await start(page,cloud);await edit(page,'one',{notes:'停用前未上傳'});await remove(page,'two');cloud.rpcCode='42501';await page.route('**/rest/v1/app_admins**',route=>route.fulfill({status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:'[{"active":false}]'}));await sync(page,{keepalive:true});await expect(page.locator('#auth-shell')).toContainText('此帳號沒有權限');expect(await stored(page)).toBeNull();expect(await page.evaluate(key=>localStorage.getItem(key),META)).toBeNull();expect(cloud.rpcs).toHaveLength(1);
});

test('沒有 navigator.locks 仍可單分頁存檔與上傳',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));const cloud=createCloud([row()]);await start(page,cloud);await expect(page.locator('#sync-readonly')).toBeHidden();await edit(page,'cloud-one',{notes:'無鎖單分頁'});await sync(page);expect(cloud.rows[0].data.notes).toBe('無鎖單分頁');
});

test('mock jsonb 鍵序無關，相同內容的 RPC 回 unchanged 且 version 不增加',async({page})=>{
  const cloud=createCloud([row()]);await start(page,cloud);const before=cloud.rows[0].version;const result=await page.evaluate(async data=>{const reversed=Object.fromEntries(Object.entries(data).reverse());const {data:result,error}=await window.GenieAuth.getClient().rpc('genie_save_project',{p_id:data.id,p_data:reversed,p_expected_version:1});if(error)throw error;return result;},cloud.rows[0].data);expect(result).toEqual({status:'unchanged',version:before});expect(cloud.results.at(-1).status).toBe('unchanged');expect(cloud.rows[0].version).toBe(before);
});
