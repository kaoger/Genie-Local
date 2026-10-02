'use strict';
(() => {
/* ================= 專案快取與雲端同步（不改專案／匯出格式） ================= */
const key='genie-sync-v1', projectKey='genie-local-projects-v1';
const columns='id,data,version,deleted_at,updated_at', pageSize=100;
const clone=value=>structuredClone(value);
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
// 同步用內容指紋，不作安全用途；正規化後計算，避免升級本身變成編輯。
function hash(value){const text=stable(value);let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}return `${a>>>0}:${b>>>0}:${text.length}`;}
const empty=()=>({initialized:false,entries:{},migration:null});
let meta=empty(), adapter, ready=false, writer=false, busy=null, epoch=0, edits=0;
let timer,maxTimer,retryTimer,deleteTimer,releaseLock,lockController;
let failed=false,metaFailed=false,quarantine=[],attempt=0,forceHidden=false,again=false,stopped=false,pageHiding=false;
const drafts=new Map();
let cloudRows=new Map();
function readMeta(){const value=JSON.parse(localStorage.getItem(key)||'null');if(value&&typeof value==='object'&&!Array.isArray(value)&&value.entries&&typeof value.entries==='object'&&!Array.isArray(value.entries))return value;return empty();}
function persist(){try{localStorage.setItem(key,JSON.stringify(meta));metaFailed=false;return true;}catch{metaFailed=true;failed=true;return false;}}
function fingerprint(p){return hash(adapter.normalize(clone(p)));}
function readLocal(){const text=localStorage.getItem(projectKey);const raw=text===null?adapter.getProjects():JSON.parse(text);if(!Array.isArray(raw))throw Error('本機格式無效');return {text,raw};}
function entry(id){if(!Object.hasOwn(meta.entries,id))Object.defineProperty(meta.entries,id,{value:{version:0,baseHash:null,revision:0,pending:null,conflict:null},enumerable:true,writable:true,configurable:true});return meta.entries[id];}
function pendingCount(){
  const ids=new Set(Object.keys(meta.entries).filter(id=>meta.entries[id].pending||meta.entries[id].conflict));
  const local=adapter?.getProjects()||[];
  for(const [id,e] of Object.entries(meta.entries))if(e.version>0&&!e.tombstone&&!local.some(p=>p.id===id))ids.add(id);
  // 第一次完整雲端讀取尚未成功，舊本機案也算未上傳，登出不能清掉。
  for(const p of adapter?.getProjects()||[]){try{if(p.id.startsWith('sample-')&&adapter.isSample(p))continue;const e=Object.hasOwn(meta.entries,p.id)?meta.entries[p.id]:null;if(!e||!e.baseHash||!e.tombstone&&fingerprint(p)!==e.baseHash)ids.add(p.id);}catch{ids.add(p?.id||'unreadable');}}
  return Math.max(ids.size,adapter?.blocked()?1:0);
}
function getState(){return {ready,writer,busy:!!busy,failed:failed||metaFailed,quarantine:clone(quarantine),unable:Object.entries(meta.entries).filter(([,e])=>e.uploadError).map(([id,e])=>({id,name:e.uploadError.name})),pending:pendingCount(),conflicts:Object.entries(meta.entries).filter(([,e])=>e.conflict).map(([id,e])=>({id,...clone(e.conflict)})),unsynced:Object.keys(meta.entries).filter(id=>meta.entries[id].pending||meta.entries[id].conflict)};}
function notify(){adapter?.status(getState());}
function clearTimers(){[timer,maxTimer,retryTimer,deleteTimer].forEach(clearTimeout);timer=maxTimer=retryTimer=deleteTimer=null;}
function deferredDelete(){return Object.values(meta.entries).some(e=>e.pending==='delete'&&e.tombstone&&!e.tombstone.sent&&e.tombstone.until>Date.now());}
function schedule(){if(!writer||stopped)return;clearTimeout(timer);if(deferredDelete()){clearTimeout(maxTimer);timer=maxTimer=null;scheduleDelete();notify();return;}timer=setTimeout(()=>sync(),1500);if(!maxTimer)maxTimer=setTimeout(()=>sync(),10000);notify();}
function scheduleDelete(){clearTimeout(deleteTimer);const times=Object.values(meta.entries).filter(e=>e.pending==='delete'&&!e.conflict&&e.tombstone&&!e.tombstone.sent&&e.tombstone.until>Date.now()).map(e=>e.tombstone.until);if(times.length)deleteTimer=setTimeout(()=>sync(),Math.max(0,Math.min(...times)-Date.now()));}
function recover(raw){
  for(const p of raw){let e=Object.hasOwn(meta.entries,p.id)?meta.entries[p.id]:null;
    if(!e&&meta.initialized&&(!p.id.startsWith('sample-')||!adapter.isSample(p))){e=entry(p.id);e.pending='save';e.revision++;}
    if(e?.tombstone&&!e.tombstone.undo){e.revision++;if(e.tombstone.sent||e.tombstone.deleted){e.tombstone.undo=true;e.pending='restore';}else{delete e.tombstone;e.pending=fingerprint(p)===e.baseHash?null:'save';}}
    if(!e||e.tombstone||e.conflict)continue;const current=fingerprint(p);if(e.baseHash&&current!==e.baseHash&&!e.pending){e.pending='save';e.revision++;}}
  // 專案寫入成功、標記寫入失敗後，也能從已確認的 id 補出刪除墓碑。
  for(const [id,e] of Object.entries(meta.entries))if(e.version>0&&!e.tombstone&&!raw.some(p=>p.id===id)){e.pending='delete';e.revision++;e.tombstone={data:null,until:0,sent:false,undo:false};}
}
/* commit 在同步寫專案之後，立即同步寫此標記。 */
function record(before,after,{deleteUntil}={}){
  if(!writer)return;
  ++edits;
  const old=new Map(before.map(p=>[p.id,p])),next=new Map(after.map(p=>[p.id,p]));
  for(const [id,p] of next){if(old.has(id)&&fingerprint(old.get(id))===fingerprint(p))continue;const e=entry(id);e.revision++;
    if(!old.has(id)&&!e.tombstone){e.createdHash=fingerprint(p);e.edited=false;}else if(e.version===0)e.edited=true;
    delete e.uploadError;
    if(e.tombstone){e.tombstone.undo=true;if(e.tombstone.sent||e.version>0&&e.tombstone.deleted){e.pending='restore';}else{delete e.tombstone;e.pending=e.baseHash===fingerprint(p)?null:'save';}}
    else e.pending='save';
    const draft=drafts.get(id);if(draft?.row&&draft.version!==draft.row.version){e.version=draft.version;conflict(e,draft.row,p);}
  }
  for(const [id,p] of old)if(!next.has(id)){const e=entry(id);e.revision++;e.pending='delete';e.conflict=null;e.tombstone={data:clone(p),index:before.findIndex(x=>x.id===id),until:deleteUntil||Date.now()+10000,sent:false,undo:false};}
  if(deleteUntil)for(const e of Object.values(meta.entries))if(e.tombstone&&!e.tombstone.undo&&e.tombstone.until>Date.now())e.tombstone.until=deleteUntil;
  persist();scheduleDelete();schedule();
}
/* ================= 完整讀取、驗證與獨立套用入口 ================= */
async function request(run,token){
  const once=async()=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);try{return await run(controller.signal);}finally{clearTimeout(timeout);}};
  let response=await once();if(token!==epoch)throw Error('已取消');
  if(response.status===401){await window.GenieAuth.refresh();if(token!==epoch)throw Error('已取消');response=await once();}
  if(token!==epoch)throw Error('已取消');
  if(response.error){if(response.status===403||response.error.code==='42501')await window.GenieAuth.recheck();throw Object.assign(Error('同步失敗'),{status:response.status,code:response.error.code});}
  return response.data;
}
async function pull(token){
  const rows=[];
  for(let offset=0;;offset+=pageSize){const data=await request(signal=>window.GenieAuth.getClient().from('genie_projects').select(columns).order('id',{ascending:true}).range(offset,offset+pageSize-1).abortSignal(signal),token);if(!Array.isArray(data))throw Error('讀取格式無效');rows.push(...data);if(data.length<pageSize)break;}
  return rows;
}
function validRows(rows){const valid=new Map();quarantine=[];for(const row of rows){try{if(typeof row.id!=='string'||!Number.isInteger(row.version)||row.version<=0||row.data?.id!==row.id)throw Error();adapter.normalize(clone(row.data));valid.set(row.id,clone(row));}catch{quarantine.push(typeof row?.id==='string'?row.id:'無效專案');}}return valid;}
function apply(raw,changed,local){
  if(!writer||adapter.blocked()||localStorage.getItem(projectKey)!==local.text)return false;
  const text=JSON.stringify(raw);
  if(text!==JSON.stringify(local.raw)){try{localStorage.setItem(projectKey,text);}catch{failed=true;return false;}adapter.apply(raw,changed);}
  return true;
}
function conflict(e,row,p){e.conflict={row:clone(row),name:p?.name||e.tombstone?.data?.name||row.data.name,deleted:!!row.deleted_at};}
function unable(e,id,reason,p){e.uploadError={reason,name:p?.name||e.tombstone?.data?.name||id};if(reason==='not_found')e.conflict={row:null,name:e.uploadError.name,missing:true};persist();}
function reconcile(rows,startEdits){
  if(startEdits!==edits||adapter.blocked())return false;
  const local=readLocal(),raw=clone(local.raw),nextMeta=clone(meta),changed=[];
  recover(raw);
  for(const [id,row] of rows){const index=raw.findIndex(p=>p.id===id),p=index<0?null:raw[index],e=entry(id),cloudHash=fingerprint(row.data);
    const draft=drafts.get(id);if(draft&&draft.version!==row.version)draft.row=clone(row);
    if(e.tombstone){
      if(e.conflict&&e.tombstone.undo){conflict(e,row,p);continue;}
      if(row.deleted_at){e.version=row.version;e.baseHash=cloudHash;e.tombstone.deleted=true;if(e.tombstone.undo)e.pending='restore';else e.pending=null;e.conflict=null;}
      else if(e.pending==='delete'&&e.version!==row.version){e.version=row.version;conflict(e,row,p);}
      continue;
    }
    if(p&&fingerprint(p)===cloudHash&&!row.deleted_at){e.version=row.version;e.baseHash=cloudHash;e.pending=null;e.conflict=null;delete e.uploadError;migrationDone(id);continue;}
    if(e.pending||e.conflict){if(e.version!==row.version||row.deleted_at)conflict(e,row,p);continue;}
    if(row.deleted_at){if(p){raw.splice(index,1);changed.push(id);}e.version=row.version;e.baseHash=cloudHash;e.tombstone={data:null,until:0,deleted:true,sent:true,undo:false};continue;}
    if(!p||row.version!==e.version){if(p)raw[index]=clone(row.data);else raw.push(clone(row.data));changed.push(id);e.version=row.version;e.baseHash=cloudHash;}
  }
  if(!apply(raw,changed,local)){meta=nextMeta;return false;}
  persist();return true;
}
function firstUpload(rows){
  if(meta.initialized||adapter.blocked())return;
  const local=readLocal(),raw=clone(local.raw),ids=[],changed=[];
  for(let i=raw.length-1;i>=0;i--){const p=raw[i];if(p.id.startsWith('sample-')){
      if(adapter.isSample(p)){if(rows.size){raw.splice(i,1);changed.push(p.id);}continue;}
      const oldId=p.id;p.id=crypto.randomUUID();changed.push(oldId,p.id);delete meta.entries[oldId];
    }
    const e=entry(p.id);if(!e.baseHash&&!e.tombstone){e.pending='save';e.revision++;ids.push(p.id);}
  }
  if(!apply(raw,changed,local))return;
  meta.initialized=true;meta.migration={ids,done:[],notified:false};persist();
}
function migrationNotice(){const m=meta.migration;if(!m||m.notified||!m.ids.length)return;if(m.ids.every(id=>m.done.includes(id))){m.notified=true;persist();adapter.notice(`已上傳 ${m.ids.length} 筆本機專案到雲端`);}}
function migrationDone(id){const m=meta.migration;if(m?.ids.includes(id)&&!m.done.includes(id))m.done.push(id);}
function confirmSave(id,snapshot,revision,version){const e=entry(id);e.version=version;e.baseHash=fingerprint(snapshot);if(e.revision===revision&&e.pending==='save'){e.pending=null;e.conflict=null;}migrationDone(id);persist();}
async function readOne(id,token){const rows=await request(signal=>window.GenieAuth.getClient().from('genie_projects').select(columns).eq('id',id).order('id',{ascending:true}).abortSignal(signal),token);if(!Array.isArray(rows))throw Error('讀取格式無效');const savedQuarantine=quarantine;const result=validRows(rows).get(id)||null;quarantine=[...new Set([...savedQuarantine,...quarantine])];return result;}
function rpc(name,args,token,keepalive){return request(signal=>{const req=window.GenieAuth.getClient().rpc(name,args).abortSignal(signal);if(keepalive)req.setHeader('x-genie-keepalive','1');return req;},token);}
/* ================= 快照上傳、墓碑與復原 ================= */
async function send(id,rows,token,keepalive){
  let e=entry(id);if(e.conflict||e.uploadError||!e.pending)return;
  const operation=e.pending,revision=e.revision;
  const p=adapter.getProjects().find(p=>p.id===id);
  if(operation==='save'){
    if(!p||e.tombstone)return;
    // 改過的示範只換一次 id；新 id 與內容同時保存，後續重送沿用。
    if(id.startsWith('sample-')){
      if(adapter.isSample(p)){e.pending=null;persist();return;}
      const local=readLocal(),raw=clone(local.raw),item=raw.find(x=>x.id===id),newId=crypto.randomUUID();if(!item)return;item.id=newId;
      if(!apply(raw,[id,newId],local))throw Error('本機存檔失敗');meta.entries[newId]=e;delete meta.entries[id];persist();adapter.open(newId);again=true;return;
    }
    if(e.version===0&&p.leadId){const existing=[...rows.values()].find(row=>!row.deleted_at&&row.id!==id&&row.data.leadId===p.leadId);if(existing){
      if(!e.edited&&e.createdHash===fingerprint(p)){const local=readLocal(),raw=local.raw.filter(x=>x.id!==id);if(!raw.some(x=>x.id===existing.id))raw.push(clone(existing.data));if(!apply(raw,[id,existing.id],local))throw Error('本機存檔失敗');delete meta.entries[id];migrationDone(id);persist();adapter.open(existing.id);adapter.notice('這位客人已有專案');return;}
      if(!e.leadNotice){e.leadNotice=true;persist();adapter.notice('這位客人雲端已有另一筆專案');}
    }}
  }
  if(operation==='delete'&&!keepalive&&Date.now()<(e.tombstone?.until||0))return;
  if(operation==='delete'&&e.version===0){e.pending=null;e.tombstone.deleted=true;persist();return;}
  const snapshot=p?clone(p):null;
  const name=operation==='save'?'genie_save_project':operation==='delete'?'genie_delete_project':'genie_restore_project';
  const args={p_id:id,p_expected_version:e.version,...(operation==='save'?{p_data:snapshot}:{})};
  if(operation==='delete'){e.tombstone.sent=true;persist();}
  let result;
  try{result=await rpc(name,args,token,keepalive);}catch(error){
    if(token!==epoch)throw error;
    if(['22023','23514'].includes(error.code)||error.status===413){unable(e,id,error.code||'too_large',p);return;}
    // RPC 已落庫但回應遺失：先讀回確認，再決定要不要重送。
    const row=await readOne(id,token);
    if(operation==='save'&&row&&!row.deleted_at&&fingerprint(row.data)===fingerprint(snapshot))result={status:'saved',version:row.version};
    else if(operation==='delete'&&row?.deleted_at)result={status:'deleted',version:row.version};
    else if(operation==='restore'&&row&&!row.deleted_at&&fingerprint(row.data)===e.baseHash)result={status:'restored',version:row.version};
    else if(operation==='restore'&&row){conflict(e,row,p);persist();return;}
    else throw error;
  }
  if(token!==epoch)return;
  e=entry(id);
  if(['saved','unchanged','deleted','restored'].includes(result?.status)&&Number.isInteger(result.version)){
    if(operation==='save')confirmSave(id,snapshot,revision,result.version);
    else{e.version=result.version;if(operation==='delete'){e.tombstone.deleted=true;e.pending=e.tombstone.undo?'restore':null;if(e.pending)again=true;}
      else{delete e.tombstone;const current=adapter.getProjects().find(p=>p.id===id);e.pending=current&&fingerprint(current)!==e.baseHash?'save':null;if(e.pending)again=true;}persist();}
    const row=await readOne(id,token);if(row)rows.set(id,row);
  }else if(result?.status==='conflict'){
    const row=await readOne(id,token);if(!row)throw Error('衝突專案無法讀取');
    if(operation==='save'&&!row.deleted_at&&fingerprint(row.data)===fingerprint(snapshot))confirmSave(id,snapshot,revision,row.version);
    else if(operation==='delete'&&row.deleted_at){e.version=row.version;e.tombstone.deleted=true;e.pending=e.tombstone.undo?'restore':null;persist();if(e.pending)again=true;}
    else{conflict(e,row,p);persist();}
  }else if(result?.status==='not_found')unable(e,id,'not_found',p);
  else throw Error('雲端未接受變更');
}
async function sync({keepalive=false}={}){
  if(!adapter||!writer||stopped||window.GenieAuth.getState().status!=='member')return;
  if(!keepalive&&deferredDelete()){scheduleDelete();notify();return;}
  forceHidden=forceHidden||keepalive;
  if(busy){again=true;return busy;}
  clearTimeout(timer);clearTimeout(maxTimer);clearTimeout(retryTimer);timer=maxTimer=retryTimer=null;
  const token=epoch;
  busy=(async()=>{
    let errors=false;
    try{
      const startEdits=edits,background=keepalive&&ready&&meta.initialized;
      const allRows=background?[...cloudRows.values()]:await pull(token);if(token!==epoch)return;
      const rows=background?new Map(cloudRows):validRows(allRows);cloudRows=rows;
      if(startEdits!==edits){again=true;return;}
      // 必須完整讀完才搬家；失敗絕不當作空雲端。
      firstUpload(rows);
      if(!background&&!reconcile(rows,startEdits)){if(!adapter.blocked())throw Error('本機套用失敗');return;}
      ready=true;
      if(localStorage.getItem(projectKey)===null&&allRows.length===0)adapter.showSamples();
      adapter.ready();notify();
      for(const id of Object.keys(meta.entries)){if(token!==epoch||stopped)return;try{await send(id,rows,token,forceHidden);}catch{errors=true;}}
      if(token!==epoch)return;
      failed=errors||metaFailed;if(!failed){attempt=0;migrationNotice();}
    }catch{if(token===epoch)failed=true;}
    finally{if(token===epoch){busy=null;forceHidden=false;notify();scheduleDelete();if(!pageHiding){if(failed){clearTimeout(retryTimer);retryTimer=setTimeout(()=>sync(),Math.min(60000,1500*2**Math.min(attempt++,6)));}else if(again){again=false;queueMicrotask(()=>sync());}}}}
  })();notify();return busy;
}
/* ================= 衝突選擇、登出與單一可寫分頁 ================= */
function resolve(id,choice){
  if(!writer||stopped)return;const e=meta.entries[id];if(!e?.conflict)return;
  const row=clone(e.conflict.row),local=readLocal(),raw=clone(local.raw),p=raw.find(p=>p.id===id);
  if(e.conflict.missing){
    if(choice==='cloud'){if(!apply(raw.filter(p=>p.id!==id),[id],local))return;delete meta.entries[id];}
    else{e.version=0;e.baseHash=null;e.conflict=null;delete e.uploadError;delete e.tombstone;e.pending=p?'save':null;e.revision++;}
    ++edits;persist();notify();sync();return;
  }
  delete e.uploadError;
  if(choice==='cloud'){
    const next=raw.filter(p=>p.id!==id);if(!row.deleted_at)next.push(clone(row.data));
    if(!apply(next,[id],local))return;
    e.version=row.version;e.baseHash=fingerprint(row.data);e.pending=null;e.conflict=null;
    if(row.deleted_at)e.tombstone={data:null,until:0,deleted:true,sent:true,undo:false};else delete e.tombstone;
  }else{
    // 雲端未刪、本機要保留：拆掉已復原的墓碑，否則 send() 見墓碑就略過、永遠送不出去。
    const keepDelete=!row.deleted_at&&e.tombstone&&!e.tombstone.undo;
    if(!row.deleted_at&&!keepDelete&&!p&&e.tombstone?.data){const next=clone(raw);next.splice(Math.min(e.tombstone.index??next.length,next.length),0,clone(e.tombstone.data));if(!apply(next,[id],local))return;}
    e.version=row.version;e.baseHash=fingerprint(row.data);e.conflict=null;e.revision++;
    if(row.deleted_at){e.tombstone={data:p?clone(p):e.tombstone?.data,until:0,deleted:true,sent:true,undo:true};e.pending='restore';}
    else if(keepDelete)e.pending='delete';
    else{delete e.tombstone;e.pending='save';}
  }
  ++edits;persist();notify();sync();
}
async function prepareSignOut(){
  if(busy)await busy;
  try{meta=readMeta();adapter.reload();recover(readLocal().raw);if(writer)persist();}catch{failed=true;return Math.max(1,pendingCount());}
  if(!writer&&pendingCount())return pendingCount();
  await sync({keepalive:true});if(busy)await busy;
  // restore／編輯中的新修訂也必須送完，不能只等第一輪。
  for(let i=0;i<3&&pendingCount()&&!failed;i++)await sync({keepalive:true});
  return pendingCount();
}
function clear(){
  stopped=true;++epoch;busy=null;again=false;clearTimers();
  localStorage.removeItem(projectKey);localStorage.removeItem(key);
  meta=empty();ready=false;failed=metaFailed=false;quarantine=[];cloudRows=new Map();drafts.clear();adapter?.clear();notify();
}
function authChanged(auth){
  if(auth.status==='denied'){try{clear();}catch{adapter?.notice('這台裝置無法清除快取，請清除瀏覽器資料');}return;}
  if(auth.status==='signedOut'){stopped=true;++epoch;busy=null;clearTimers();return;}
  if(auth.status==='member'){stopped=false;if(writer)sync();}else if(auth.status==='offline'){if(auth.localAccess)stopped=false;notify();}
}
function becomeWriter(){meta=readMeta();adapter.reload();try{if(!adapter.blocked())recover(readLocal().raw);}catch{failed=true;}writer=true;persist();notify();if(window.GenieAuth.getState().status==='member'){stopped=false;sync();}}
function acquire(){
  if(!navigator.locks){try{becomeWriter();}catch{failed=true;notify();}return;}
  lockController=new AbortController();
  navigator.locks.request('genie-projects-writer',{signal:lockController.signal},async()=>{
    if(!adapter)return;becomeWriter();
    await new Promise(resolve=>{releaseLock=resolve;});writer=false;releaseLock=null;notify();
  }).catch(error=>{if(error.name!=='AbortError'){writer=false;failed=true;notify();}});
}
function init(options){adapter=options;try{meta=readMeta();recover(readLocal().raw);}catch{failed=true;}window.GenieAuth.subscribe(authChanged);acquire();notify();}
window.addEventListener('storage',event=>{if(event.key!==key&&event.key!==projectKey)return;
  // 另一分頁登出／停用也會刪除同步標記，先撤銷晚到回應。
  if(event.key===key&&event.newValue===null){stopped=true;++epoch;busy=null;clearTimers();meta=empty();ready=false;adapter?.clear();notify();return;}
  if(!writer){try{meta=readMeta();adapter?.reload();notify();}catch{failed=true;notify();}}
});
window.addEventListener('online',()=>{if(!stopped)sync();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)sync({keepalive:true});else{if(!writer&&!releaseLock&&lockController?.signal.aborted)acquire();sync();}});
window.addEventListener('pagehide',async()=>{pageHiding=true;try{await sync({keepalive:true});if(pendingCount())await sync({keepalive:true});}finally{stopped=true;++epoch;busy=null;again=false;clearTimers();releaseLock?.();lockController?.abort();}});
window.addEventListener('pageshow',()=>{pageHiding=false;if(adapter&&!writer&&lockController?.signal.aborted)acquire();else if(adapter&&!navigator.locks){stopped=false;sync();}});
window.GenieSync={init,record,sync,getState,resolve,prepareSignOut,clear,
  openDraft:id=>{if(!drafts.has(id))drafts.set(id,{version:meta.entries[id]?.version||0});},closeDraft:id=>drafts.delete(id),
  canWrite:()=>writer&&(!stopped)&& (ready||localStorage.getItem(projectKey)!==null)};
})();
