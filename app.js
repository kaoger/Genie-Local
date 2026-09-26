'use strict';
(() => {
/* ================= 圖示 ================= */
const icons={plus:'<path d="M12 5v14M5 12h14"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 11h18"/>',book:'<path d="M12 5c-3-2-6-2-10-2v16c4 0 7 0 10 2 3-2 6-2 10-2V3c-4 0-7 0-10 2v16"/>',user:'<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',code:'<path d="M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="m9 9-2 3 2 3m6-6 2 3-2 3"/>',help:'<circle cx="12" cy="12" r="10"/><path d="M9.1 8a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01"/>',copy:'<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',trash:'<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6m4-6v6"/>',left:'<path d="m15 18-6-6 6-6"/>',right:'<path d="m9 18 6-6-6-6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="M20 6 9 17l-5-5"/>',lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',alert:'<path d="M12 8v5m0 3h.01"/>',edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',spark:'<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6"/>'};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[name]||''}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ================= 表單欄位定義 =================
   想新增或調整欄位，只要改這裡：
   top:true  → 存在專案本身（清單會顯示）
   ai:true   → 生成策略企劃的必填欄位
   type      → text / email / tel / date / month / number / select / textarea / chips / layout */
const TYPES=['居家裝潢設計','商業空間設計','展覽空間設計','品牌設計','包裝設計','網站設計','其他設計'];
const COUNTIES=['台北市','新北市','桃園市','台中市','台南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣','金門縣','連江縣'];
const CONTACT_SECTION={id:'contact',title:'聯絡資訊',fields:[
  {key:'name',label:'專案名稱',type:'text',top:true,required:true,wide:true,placeholder:'例如：王小姐 台中沙鹿 新成屋'},
  {key:'contact',label:'聯絡人',type:'text',top:true},
  {key:'phone',label:'電話',type:'tel',top:true,placeholder:'0912-345-678'},
  {key:'email',label:'電子信箱',type:'email',top:true},
  {key:'contactTime',label:'方便聯絡的時間',type:'chips',multi:true,options:['平日白天','平日晚上','週末','隨時']},
  {key:'type',label:'需求類型',type:'select',top:true,options:TYPES,noEmpty:true},
  {key:'date',label:'洽詢日期',type:'date',top:true},
  {key:'due',label:'專案到期日',type:'date',top:true}]};
const HOME_SECTIONS=[
  {id:'house',title:'房屋概況',fields:[
    {key:'region',label:'縣市',type:'select',options:COUNTIES},
    {key:'address',label:'地址',type:'text'},
    {key:'houseType',label:'屋況',type:'chips',options:['新成屋','老屋翻新','預售屋']},
    {key:'elevator',label:'電梯',type:'chips',options:['有電梯','無電梯']},
    {key:'area',label:'坪數',type:'number',suffix:'坪',ai:true,min:0,step:0.5},
    {key:'completion',label:'交屋／完工月份',type:'month'},
    {key:'layout',label:'格局',type:'layout',wide:true}]},
  {id:'needs',title:'空間需求',fields:[
    {key:'style',label:'風格',type:'chips',multi:true,ai:true,wide:true,options:['現代簡約','北歐','日式無印','侘寂','工業風','美式','輕奢','其他']},
    {key:'members',label:'空間成員',type:'chips',multi:true,ai:true,wide:true,options:['夫妻','小孩','長輩','寵物','獨居','室友']},
    {key:'renoType',label:'裝修類型',type:'chips',ai:true,wide:true,options:['全室裝修','局部翻修','只要設計','軟裝佈置']},
    {key:'budget',label:'預算',type:'select',options:['50 萬以下','50–100 萬','100–200 萬','200–300 萬','300 萬以上','尚未確定']},
    {key:'needsNote',label:'其他需求',type:'textarea',wide:true,placeholder:'例如：需要神明廳、孝親房、大量收納…'}]}];
const GENERAL_SECTIONS=[
  {id:'brief',title:'專案資訊',fields:[
    {key:'background',label:'專案背景',type:'textarea',ai:true,wide:true,placeholder:'例如：新品牌上市，需要獨特識別'},
    {key:'audience',label:'目標客群',type:'text',ai:true,wide:true},
    {key:'stylePref',label:'偏好風格／顏色',type:'text',ai:true,wide:true},
    {key:'budget',label:'預算',type:'select',options:['10 萬以下','10–30 萬','30–60 萬','60 萬以上','尚未確定']},
    {key:'needsNote',label:'其他設計需求',type:'textarea',wide:true}]}];
const NOTE_SECTION={id:'notes',title:'備註',fields:[{key:'notes',label:'專案備註',type:'textarea',top:true,wide:true,placeholder:'記錄預算、下次聯絡事項等'}]};
const sectionsFor=type=>[CONTACT_SECTION,...(type==='居家裝潢設計'?HOME_SECTIONS:GENERAL_SECTIONS),NOTE_SECTION];
const allFields=type=>sectionsFor(type).flatMap(s=>s.fields.map(f=>({...f,section:s.id})));
const aiFields=type=>allFields(type).filter(f=>f.ai);

const STEPS=[{id:'brief',label:'需求總覽'},{id:'strategy',label:'策略企劃'},{id:'visual',label:'視覺發想'},{id:'model3d',label:'3D 建模'},{id:'estimate',label:'業務估價'},{id:'proposal',label:'提案簡報'}];

/* ================= 資料與本機儲存 ================= */
const key='genie-local-projects-v1', selected=new Set(), pageSize=8;
const SAMPLE_BRIEFS={
  'sample-0':{region:'台中市',address:'沙鹿區示範路 1 號',houseType:'新成屋',elevator:'無電梯',area:'35',completion:'2026-08',layout:{r:3,l:1,b:4},style:['現代簡約','日式無印'],members:['夫妻','小孩','長輩'],renoType:'全室裝修',budget:'100–200 萬',contactTime:['平日晚上'],needsNote:'需要神明廳與車庫'},
  'sample-3':{region:'台中市',houseType:'老屋翻新',area:'28',style:['北歐'],renoType:'局部翻修'}};
const seed=[['居家設計','2026-07-25',true],['居家設計','2026-07-22',true],['測試','2026-07-21',false],['示範居家設計','2026-07-20',true],['示範居家設計','2026-07-15',true],['居家設計','2026-07-15',true],['設計專案','2026-07-15',false],['居家設計','2026-07-15',false]].map(([name,date,done],i)=>({id:'sample-'+i,name,date,done,contact:i===0?'示範客戶':i===6?'陳小明':i===7?'林小安':'',type:i===6?'其他設計':'居家裝潢設計',email:i>=6?'hello@example.com':'',phone:i===6?'0900000000':'',due:'',notes:''}));
let projects=seed.map(p=>({...p})),page=0,deleting=null,undoState=null,toastTimer,toastAction=null;
let storageWarning=false;
try{const value=JSON.parse(localStorage.getItem(key));if(Array.isArray(value)&&value.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&typeof p.date==='string'))projects=value;}catch{storageWarning=true;}
// 舊版資料沒有 brief，補上空白；示範專案補示範內容
projects.forEach(p=>{if(!p.brief||typeof p.brief!=='object')p.brief=structuredClone(SAMPLE_BRIEFS[p.id]||{});if(!p.type)p.type='居家裝潢設計';});
function save(){try{localStorage.setItem(key,JSON.stringify(projects));return true;}catch{toast('瀏覽器無法儲存，請使用左側「匯出本機資料」備份。',{duration:12000});return false;}}
const findProject=id=>projects.find(p=>p.id===id);

/* ================= 通知 ================= */
function toast(message,{actionLabel='',onAction=null,duration=5000}={}){clearTimeout(toastTimer);$('#toast-text').textContent=message;toastAction=onAction;$('#toast-action').textContent=actionLabel;$('#toast-action').hidden=!actionLabel;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,duration);}

/* ================= 欄位值工具 ================= */
const getVal=(p,f)=>f.top?p[f.key]:p.brief?.[f.key];
function isEmpty(v){if(v==null||v==='')return true;if(Array.isArray(v))return !v.length;if(typeof v==='object')return !Object.values(v).some(x=>x!==''&&x!=null);return false;}
function dateText(value){return value?String(value).replaceAll('-','/'):'';}
function display(f,v){
  if(isEmpty(v))return '';
  if(Array.isArray(v))return v.join('、');
  if(f.type==='layout')return [['r','房'],['l','廳'],['b','衛']].filter(([k])=>v[k]!==''&&v[k]!=null).map(([k,u])=>`${v[k]} ${u}`).join(' ');
  if(f.type==='date')return dateText(v);
  if(f.type==='month'){const [y,m]=String(v).split('-');return `${y} 年 ${Number(m)} 月`;}
  if(f.suffix)return `${v} ${f.suffix}`;
  return String(v);
}
function readiness(p){const list=aiFields(p.type);const missing=list.filter(f=>isEmpty(getVal(p,f)));return {total:list.length,filled:list.length-missing.length,missing,complete:!missing.length};}
function stepStatus(p,id){
  const r=readiness(p);
  if(id==='brief')return r.complete?{s:'done',meta:'已完成'}:{s:'active',meta:`必填 ${r.filled}/${r.total}`};
  if(!r.complete)return {s:'locked',meta:'需先完成需求'};
  if(id==='strategy'){if(!p.strategy)return {s:'ready',meta:'可以生成'};return p.strategyStale?{s:'stale',meta:'需要更新'}:{s:'done',meta:'已生成'};}
  if(!p.strategy)return {s:'locked',meta:'需先完成策略'};
  return {s:'todo',meta:'尚未開始'};
}
const aiBadge=f=>f.ai?'<span class="ai-badge" title="生成策略企劃需要這個欄位">AI 必填</span>':'';

/* ================= 清單頁 ================= */
function current(){return projects.slice(page*pageSize,(page+1)*pageSize);}
function render(){
page=Math.max(0,Math.min(page,Math.ceil(projects.length/pageSize)-1));
const rows=current();
$('#rows').innerHTML=rows.map(p=>`<tr data-id="${esc(p.id)}" class="${selected.has(p.id)?'selected':''}"><td><input type="checkbox" data-select="${esc(p.id)}" aria-label="選取專案 ${esc(p.name)}" ${selected.has(p.id)?'checked':''}></td><td><a class="project-name" href="#/p/${encodeURIComponent(p.id)}/brief" title="開啟專案">${esc(p.name)}</a></td><td>${esc(p.contact)}</td><td>${esc(dateText(p.date))}</td><td><span class="type-tag">${esc(p.type)}</span></td><td>${esc(p.email)}</td><td>${esc(p.phone)}</td><td>${esc(dateText(p.due))}</td><td><button class="status" data-status="${esc(p.id)}" aria-label="${esc(p.name)}：${p.done?'已完成':'未完成'}，點擊切換" title="${p.done?'已完成':'未完成'}" aria-pressed="${!!p.done}"><span class="dot ${p.done?'done':''}"></span><span class="status-text">${p.done?'完成':'未完成'}</span></button></td><td><div class="row-actions"><button data-copy="${esc(p.id)}" aria-label="複製 ${esc(p.name)}" title="複製專案">${icon('copy')}</button><button data-delete="${esc(p.id)}" aria-label="刪除 ${esc(p.name)}" title="刪除專案">${icon('trash')}</button></div></td></tr>`).join('')+`<tr class="example-row"><td></td><td><span class="example-badge">範例</span><span class="example-name">示範品牌 / Demo Brand</span></td><td>示範聯絡人</td><td>2024/11/27</td><td><span class="type-tag">品牌設計</span></td><td>info@example.com</td><td></td><td>2025/01/31</td><td></td><td></td></tr>`;
const all=$('#select-all');all.checked=rows.length>0&&rows.every(p=>selected.has(p.id));all.indeterminate=rows.some(p=>selected.has(p.id))&&!all.checked;all.disabled=!rows.length;
$('.selection-bar').hidden=!selected.size;$('#selected-count').textContent=`已選取 ${selected.size} 個專案`;
const total=Math.max(1,Math.ceil(projects.length/pageSize));$('#prev').disabled=page===0;$('#next').disabled=page>=total-1;
$('#pages').innerHTML=Array.from({length:total},(_,i)=>`<button data-page="${i}" class="${i===page?'current':''}" aria-label="第 ${i+1} 頁" ${i===page?'aria-current="page"':''}>${i+1}</button>`).join('');$('#count').textContent=`${rows.length} / ${projects.length}`;
}
function today(){const t=new Date();return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;}
function openCreate(){const form=$('#project-form');form.reset();form.elements.type.innerHTML=TYPES.map(t=>`<option>${t}</option>`).join('');form.elements.date.value=today();form.elements.type.value='居家裝潢設計';$('#editor').showModal();}

/* ================= 專案內頁 ================= */
let view={id:null,step:'brief'};
function renderDetail(){
  const p=findProject(view.id);if(!p)return;
  const r=readiness(p);
  const steps=STEPS.map((s,i)=>{const st=stepStatus(p,s.id);const badge=st.s==='done'?icon('check'):st.s==='locked'?icon('lock'):st.s==='stale'?'!':i+1;const cur=s.id===view.step;
    return `<li><a href="#/p/${encodeURIComponent(p.id)}/${s.id}" class="step is-${st.s}${cur?' is-current':''}" ${cur?'aria-current="step"':''} aria-label="第 ${i+1} 步 ${s.label}，${st.meta}"><span class="step-badge">${badge}</span><span class="step-text"><span class="step-label">${s.label}</span><span class="step-meta">${st.meta}</span></span></a></li>`;}).join('');
  $('#detail-view').innerHTML=`
  <header class="detail-header">
    <div class="detail-top">
      <nav class="crumbs" aria-label="路徑"><a href="#/">潛在客戶</a><span aria-hidden="true">›</span><h1 title="${esc(p.name)}">${esc(p.name)}</h1></nav>
      <div class="detail-actions"><span class="type-tag">${esc(p.type)}</span><button class="primary btn-icon" data-action="edit-all">${icon('edit')}編輯全部資料</button></div>
    </div>
    <nav class="stepper" aria-label="專案步驟"><ol>${steps}</ol></nav>
  </header>
  <div class="detail-body">${stepBody(p,r)}</div>`;
  const curStep=$('#detail-view .step.is-current');curStep?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function missingList(r){return r.missing.map(f=>`<button class="link-chip" data-edit-field="${f.key}">${esc(f.label)}</button>`).join('');}
function stepBody(p,r){
  if(view.step==='brief')return briefBody(p,r);
  const st=stepStatus(p,view.step);const label=STEPS.find(s=>s.id===view.step).label;
  if(st.s==='locked'&&!r.complete)return `<div class="empty-card"><div class="empty-icon">${icon('lock')}</div><h2>${label}還不能開始</h2><p>需求總覽還缺 ${r.missing.length} 個必填欄位：</p><div class="chip-row">${missingList(r)}</div><button class="primary" data-edit-field="${r.missing[0].key}">一次補齊</button></div>`;
  if(view.step==='strategy')return strategyBody(p);
  if(st.s==='locked')return `<div class="empty-card"><div class="empty-icon">${icon('lock')}</div><h2>${label}還不能開始</h2><p>請先完成「策略企劃」，這一步會參考策略內容。</p><a class="btn primary" href="#/p/${encodeURIComponent(p.id)}/strategy">前往策略企劃</a></div>`;
  return `<div class="empty-card"><h2>${label}</h2><p>本機示範版尚未製作這一步。資料已齊全，正式版會在這裡使用需求總覽與策略企劃的內容。</p></div>`;
}
function briefBody(p,r){
  const pct=Math.round(r.filled/r.total*100);
  const notice=r.complete
    ?`<div class="notice ok"><div>${icon('check')}</div><div><strong>必填資料已齊全</strong><p>可以前往策略企劃生成內容。</p></div><a class="btn" href="#/p/${encodeURIComponent(p.id)}/strategy">前往策略企劃</a></div>`
    :`<div class="notice"><div class="notice-main"><strong>生成策略企劃還需要 ${r.missing.length} 個欄位</strong><div class="bar" role="progressbar" aria-valuenow="${r.filled}" aria-valuemin="0" aria-valuemax="${r.total}" aria-label="必填完成度"><span style="width:${pct}%"></span></div><div class="chip-row">${missingList(r)}</div></div><button class="primary" data-edit-field="${r.missing[0].key}">一次補齊</button></div>`;
  const cards=sectionsFor(p.type).map(s=>`<section class="card"><div class="card-head"><h2>${s.title}</h2><button class="btn-icon" data-edit-section="${s.id}">${icon('edit')}編輯</button></div><div class="kv">${s.fields.map(f=>{const v=display(f,getVal(p,f));return `<button class="kv-item${f.wide?' wide':''}" data-edit-field="${f.key}" title="點一下編輯"><span class="kv-label">${esc(f.label)}${aiBadge(f)}</span><span class="kv-value${v?'':' is-empty'}">${v?esc(v):'未填'}</span></button>`;}).join('')}</div></section>`).join('');
  return `${notice}<p class="hint">小提示：點任何欄位，就會打開完整表單並跳到那一格。</p>${cards}`;
}
function strategyBody(p){
  if(!p.strategy)return `<div class="empty-card"><div class="empty-icon">${icon('spark')}</div><h2>資料已齊全，可以生成策略企劃</h2><p>本機示範版不連接 AI，會用需求總覽的內容組成一份示範摘要。</p><button class="primary" data-action="gen-strategy">生成策略企劃（示範）</button></div>`;
  const snap=p.strategy.snapshot;const fake={...p,brief:snap.brief,type:snap.type};
  const rows=allFields(snap.type).filter(f=>!f.top&&!isEmpty(getVal(fake,f))).map(f=>`<tr><th scope="row">${esc(f.label)}</th><td>${esc(display(f,getVal(fake,f)))}</td></tr>`).join('');
  const stale=p.strategyStale?`<div class="notice warn"><div class="notice-main"><strong>需求總覽在生成後有修改</strong><p>目前的策略企劃是依照舊資料產生的，建議重新生成。</p></div><button class="primary" data-action="gen-strategy">重新生成</button></div>`:'';
  return `${stale}<section class="card doc"><div class="card-head"><h2>策略企劃</h2><span class="muted">示範內容・${new Date(p.strategy.at).toLocaleString('zh-TW')}</span></div><h3>提案概述</h3><table class="doc-table">${rows}</table><h3>下一步</h3><ul><li>和客戶確認需求總覽內容是否正確。</li><li>依照風格與預算整理 2～3 個設計方向。</li><li>完成後進入「視覺發想」。</li></ul>${p.strategyStale?'':'<div class="card-foot"><button data-action="gen-strategy">重新生成</button></div>'}</section>`;
}

/* ================= 一次編輯全部資料的表單 ================= */
let drawerId=null,drawerType=null,dirty=false;
function fieldHtml(f,v){
  const id=`f-${f.key}`,wide=f.wide?' wide':'';
  const label=`<span class="field-label">${esc(f.label)}${f.required?' <span class="req" aria-hidden="true">*</span>':''}${aiBadge(f)}</span>`;
  if(f.type==='chips'){const vals=Array.isArray(v)?v:(v?[v]:[]);return `<fieldset class="field${wide}"><legend>${label}${f.multi?'<span class="muted small">可複選</span>':''}</legend><div class="chips">${f.options.map(o=>`<label class="chip"><input type="${f.multi?'checkbox':'radio'}" name="${f.key}" value="${esc(o)}" ${vals.includes(o)?'checked':''}><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`;}
  if(f.type==='layout'){const o=v||{};return `<fieldset class="field${wide}"><legend>${label}</legend><div class="layout-row">${[['r','房'],['l','廳'],['b','衛']].map(([k,u])=>`<label class="suffix-input small-num"><input type="number" min="0" max="20" name="${f.key}.${k}" value="${esc(o[k]??'')}" inputmode="numeric" aria-label="${u}"><span>${u}</span></label>`).join('')}</div></fieldset>`;}
  let control;
  if(f.type==='select')control=`<select id="${id}" name="${f.key}">${f.noEmpty?'':'<option value="">請選擇</option>'}${f.options.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
  else if(f.type==='textarea')control=`<textarea id="${id}" name="${f.key}" rows="3" maxlength="5000" placeholder="${esc(f.placeholder||'')}">${esc(v||'')}</textarea>`;
  else{const t=f.type==='tel'?'tel':f.type;control=`<input id="${id}" name="${f.key}" type="${t}" value="${esc(v??'')}" ${f.required?'required':''} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:''} ${f.min!=null?`min="${f.min}"`:''} ${f.step?`step="${f.step}"`:''} ${f.type==='tel'?'inputmode="tel"':''} ${f.type==='number'?'inputmode="decimal"':''} maxlength="150">`;if(f.suffix)control=`<span class="suffix-input">${control}<span>${f.suffix}</span></span>`;}
  return `<div class="field${wide}"><label for="${id}">${label}</label>${control}</div>`;
}
function buildDrawer(data,type){
  drawerType=type;
  const secs=sectionsFor(type);
  $('#drawer-tabs').innerHTML=secs.map(s=>`<button type="button" data-jump="${s.id}">${s.title}</button>`).join('');
  $('#drawer-body').innerHTML=secs.map(s=>`<section class="form-section" id="sec-${s.id}" aria-labelledby="sec-${s.id}-h"><h3 id="sec-${s.id}-h">${s.title}</h3><div class="form-grid">${s.fields.map(f=>fieldHtml(f,getVal(data,f))).join('')}</div></section>`).join('');
  updateDrawerProgress();
}
function readForm(){
  const form=$('#drawer-form');const top={},brief={};
  for(const f of allFields(drawerType)){
    let v;
    if(f.type==='chips'){const vals=[...form.querySelectorAll(`[name="${f.key}"]:checked`)].map(i=>i.value);v=f.multi?vals:(vals[0]||'');}
    else if(f.type==='layout'){v={};for(const k of ['r','l','b']){const n=form.elements[`${f.key}.${k}`].value;v[k]=n===''?'':Number(n);}if(isEmpty(v))v='';}
    else v=(form.elements[f.key]?.value??'').trim();
    (f.top?top:brief)[f.key]=v;
  }
  return {top,brief};
}
function draftProject(){const p=findProject(drawerId);const {top,brief}=readForm();return {...p,...top,brief:{...p.brief,...brief}};}
function updateDrawerProgress(){
  const r=readiness(draftProject());
  $('#drawer-progress').innerHTML=`<span class="bar small"><span style="width:${Math.round(r.filled/r.total*100)}%"></span></span><span>AI 必填 ${r.filled}/${r.total}</span>`;
  $('#dirty-note').textContent=dirty?'有未儲存的變更（Ctrl＋S 儲存）':'';
}
function openDrawer(id,{section,field}={}){
  const p=findProject(id);if(!p)return;
  drawerId=id;dirty=false;
  buildDrawer(p,p.type);
  $('#drawer').showModal();
  const target=field?$('#drawer-body').querySelector(`[name="${field}"],[name^="${field}."]`):null;
  const sec=section?$(`#sec-${section}`):target?.closest('.form-section');
  requestAnimationFrame(()=>{(target?.closest('.field')||sec)?.scrollIntoView({block:'start'});(target||sec?.querySelector('input,select,textarea'))?.focus({preventScroll:true});});
}
function closeDrawer(force){if(dirty&&!force){$('#discard-dialog').showModal();return;}dirty=false;$('#drawer').close();}
function saveDrawer(){
  const form=$('#drawer-form');
  const name=form.elements.name;if(!name.value.trim()){name.setCustomValidity('請輸入專案名稱');}
  if(!form.reportValidity()){name.setCustomValidity('');return;}
  const p=findProject(drawerId);const {top,brief}=readForm();
  const norm=v=>JSON.stringify(isEmpty(v)?'':v);
  const changed=allFields(drawerType).filter(f=>norm(getVal(p,f))!==norm((f.top?top:brief)[f.key]));
  if(!changed.length){closeDrawer(true);toast('沒有需要儲存的變更');return;}
  Object.assign(p,top);p.brief={...p.brief,...brief};
  const aiChanged=changed.some(f=>f.ai)||changed.some(f=>f.key==='type');
  if(p.strategy&&aiChanged)p.strategyStale=true;
  const saved=save();closeDrawer(true);renderDetail();render();
  if(!saved)return;
  if(p.strategyStale)toast(`已儲存 ${changed.length} 個欄位。策略企劃需要重新生成。`,{actionLabel:'前往更新',onAction:()=>{location.hash=`#/p/${encodeURIComponent(p.id)}/strategy`;},duration:8000});
  else toast(`已儲存 ${changed.length} 個欄位`);
}

/* ================= 頁面切換（網址 #/p/專案/步驟） ================= */
function route(){
  const m=location.hash.match(/^#\/p\/([^/]+)(?:\/(\w+))?/);
  const p=m&&findProject(decodeURIComponent(m[1]));
  if(m&&!p){location.replace('#/');return;}
  if(p){view={id:p.id,step:STEPS.some(s=>s.id===m[2])?m[2]:'brief'};$('#list-view').hidden=true;$('#detail-view').hidden=false;renderDetail();document.title=`${p.name}｜本機工作台`;}
  else{view={id:null,step:'brief'};$('#detail-view').hidden=true;$('#list-view').hidden=false;render();document.title='潛在客戶｜本機工作台';}
  $('main').scrollTop=0;
}

/* ================= 其他對話框 ================= */
function showInfo(title,body){$('#info-title').textContent=title;$('#info-body').innerHTML=body;$('#info-dialog').showModal();}
const actions={
add:()=>openCreate(),home:()=>{if(location.hash&&location.hash!=='#/')location.hash='#/';else{page=0;render();$('main').scrollTop=0;}},
'clear-selection':()=>{selected.clear();render();},
'complete-selected':()=>{projects.forEach(p=>{if(selected.has(p.id))p.done=true;});selected.clear();const saved=save();render();if(saved)toast('所選專案已標記完成');},
'edit-all':()=>openDrawer(view.id),
'gen-strategy':()=>{const p=findProject(view.id);p.strategy={at:new Date().toISOString(),snapshot:{type:p.type,brief:structuredClone(p.brief)}};p.strategyStale=false;if(save()){renderDetail();toast('已生成示範策略企劃');}},
knowledge:()=>{let notes='';try{notes=localStorage.getItem('genie-local-notes')||'';}catch{}showInfo('知識庫',`<p class="muted">整理你的常用問答與專案需求，保存在這台瀏覽器。</p><form id="notes-form"><label>工作筆記<textarea name="knowledge" rows="10" maxlength="30000" placeholder="例如：第一次洽談需要確認的事項…">${esc(notes)}</textarea></label><div class="dialog-footer"><button type="submit" class="primary">儲存筆記</button></div></form>`);},
account:()=>{let name='';try{name=localStorage.getItem('genie-local-name')||'';}catch{}showInfo('個人設定',`<div class="account-avatar"></div><form id="account-form"><label>顯示名稱<input name="displayName" maxlength="60" value="${esc(name)}" placeholder="你的名字"></label><p class="muted">本機示範版本，無需登入。資料保存在目前的瀏覽器。</p><div class="dialog-footer"><button class="primary" type="submit">儲存設定</button></div></form>`);},
help:()=>showInfo('使用說明','<p>這是依照參考頁面製作的本機工作台。</p><ul><li>點左側 ＋ 新增專案，建立後直接進入專案。</li><li>點專案名稱進入專案內頁。</li><li>專案上方的 6 個步驟會顯示狀態：✓ 完成、🔒 還不能開始、! 需要更新。</li><li>按「編輯全部資料」或點任何欄位，就能在右側表單一次修改，按一次儲存。</li><li>標示「AI 必填」的欄位，是生成策略企劃需要的資料。</li><li>表單中可按 Ctrl＋S 儲存；未儲存就關閉會提醒。</li><li>點綠色／紅色圓點切換對話完成狀態；勾選可批次標記完成。</li><li>刪除後，10 秒內可按提示中的「復原」。</li><li>左側對話圖示可匯出 JSON 備份。</li></ul><p class="muted">資料為示範內容。未連接原網站、AI 或雲端；清除瀏覽器資料將移除本機記錄。</p>'),
export:()=>{let notes='',name='';try{notes=localStorage.getItem('genie-local-notes')||'';name=localStorage.getItem('genie-local-name')||'';}catch{}const blob=new Blob([JSON.stringify({version:2,projects,notes,displayName:name},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='客戶資料備份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出本機資料');}
};

/* ================= 事件 ================= */
document.addEventListener('click',e=>{
const b=e.target.closest('button');if(!b)return;
if(b.hasAttribute('data-close'))return b.closest('dialog').close();
if(b.hasAttribute('data-drawer-close'))return closeDrawer();
if(b.dataset.jump){$(`#sec-${b.dataset.jump}`)?.scrollIntoView({block:'start',behavior:'smooth'});return;}
if(b.dataset.action)return actions[b.dataset.action]?.();
if(b.dataset.editField)return openDrawer(view.id,{field:b.dataset.editField});
if(b.dataset.editSection)return openDrawer(view.id,{section:b.dataset.editSection});
if(b.dataset.status){const p=findProject(b.dataset.status);p.done=!p.done;const saved=save();render();const focusButton=Array.from(document.querySelectorAll('[data-status]')).find(el=>el.dataset.status===p.id);focusButton?.focus();if(saved)toast(p.done?'已標記對話完成':'已標記對話未完成');}
if(b.dataset.copy){const p=findProject(b.dataset.copy);projects.unshift({...structuredClone(p),id:crypto.randomUUID(),name:p.name+'（副本）',strategy:undefined,strategyStale:false});page=0;const saved=save();render();if(saved)toast('已複製專案');}
if(b.dataset.delete){deleting=b.dataset.delete;const p=findProject(deleting);$('#confirm-copy').textContent=`確定刪除「${p.name}」？`;$('#confirm-dialog').showModal();}
if(b.dataset.page!==undefined){page=Number(b.dataset.page);render();$('main').scrollTop=0;}
});
$('#rows').addEventListener('change',e=>{const id=e.target.dataset.select;if(id){e.target.checked?selected.add(id):selected.delete(id);render();}});
$('#select-all').addEventListener('change',e=>{current().forEach(p=>e.target.checked?selected.add(p.id):selected.delete(p.id));render();});
// 快速新增
$('#project-form').addEventListener('submit',e=>{e.preventDefault();const form=e.target;if(!form.elements.name.value.trim()){form.elements.name.setCustomValidity('請輸入專案名稱');form.elements.name.reportValidity();return;}const data=Object.fromEntries(new FormData(form));for(const f of ['name','contact','email','phone'])data[f]=data[f].trim();Object.assign(data,{done:false,notes:'',brief:{},id:crypto.randomUUID()});projects.unshift(data);page=0;const saved=save();$('#editor').close();if(saved){location.hash=`#/p/${encodeURIComponent(data.id)}/brief`;toast('專案已建立，接著補齊需求資料',{actionLabel:'開始填寫',onAction:()=>openDrawer(data.id,{section:sectionsFor(data.type)[1].id})});}});
$('#project-form').elements.name.addEventListener('input',e=>e.target.setCustomValidity(''));
// 側邊表單
$('#drawer-form').addEventListener('input',e=>{if(e.target.name==='name')e.target.setCustomValidity('');dirty=true;updateDrawerProgress();});
$('#drawer-form').addEventListener('change',e=>{dirty=true;
  if(e.target.name==='type'){const d=draftProject();d.type=e.target.value;buildDrawer(d,d.type);$('#drawer-form').elements.type.focus();}
  updateDrawerProgress();});
// 單選的標籤再點一次可以取消（滑鼠／觸控）
let radioWas=null;
$('#drawer-form').addEventListener('pointerdown',e=>{const input=e.target.closest('.chip')?.querySelector('input[type=radio]');radioWas=input?{input,checked:input.checked}:null;});
$('#drawer-form').addEventListener('click',e=>{if(e.target.tagName!=='INPUT')return;if(radioWas&&radioWas.input===e.target&&radioWas.checked){e.target.checked=false;dirty=true;updateDrawerProgress();}radioWas=null;});
$('#drawer-form').addEventListener('submit',e=>{e.preventDefault();saveDrawer();});
$('#drawer').addEventListener('cancel',e=>{e.preventDefault();closeDrawer();});
$('#drawer').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('#drawer-form').requestSubmit();}});
$('#discard-cancel').addEventListener('click',()=>$('#discard-dialog').close());
$('#discard-confirm').addEventListener('click',()=>{$('#discard-dialog').close();closeDrawer(true);});
window.addEventListener('beforeunload',e=>{if(dirty&&$('#drawer').open){e.preventDefault();e.returnValue='';}});
// 刪除／復原
$('#confirm-delete').addEventListener('click',()=>{undoState={project:findProject(deleting),index:projects.findIndex(p=>p.id===deleting)};projects=projects.filter(p=>p.id!==deleting);selected.delete(deleting);const saved=save();render();$('#confirm-dialog').close();if(saved)toast('專案已刪除',{actionLabel:'復原',duration:10000,onAction:()=>{if(!undoState)return;projects.splice(undoState.index,0,undoState.project);page=Math.floor(undoState.index/pageSize);undoState=null;if(save()){render();toast('專案已復原');}}});});
$('#toast-action').addEventListener('click',()=>{const fn=toastAction;$('#toast').hidden=true;clearTimeout(toastTimer);fn?.();});
$('#dismiss-toast').addEventListener('click',()=>{$('#toast').hidden=true;clearTimeout(toastTimer);});
$('#prev').addEventListener('click',()=>{page--;render();$('main').scrollTop=0;});$('#next').addEventListener('click',()=>{page++;render();$('main').scrollTop=0;});
$('#info-dialog').addEventListener('submit',e=>{e.preventDefault();try{if(e.target.id==='notes-form')localStorage.setItem('genie-local-notes',e.target.elements.knowledge.value);if(e.target.id==='account-form')localStorage.setItem('genie-local-name',e.target.elements.displayName.value);$('#info-dialog').close();toast('已儲存');}catch{toast('瀏覽器無法儲存，請確認儲存空間與隱私設定。');}});
window.addEventListener('hashchange',route);
route();if(storageWarning)toast('無法讀取先前資料，目前顯示示範內容。',{duration:10000});
})();
