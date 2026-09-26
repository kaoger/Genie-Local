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
   req:true  → 區塊內的欄位屬於需求
   est:true  → 業務估價引用的欄位
   ai:true   → 確認需求與生成策略企劃的必填欄位
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
  {id:'house',title:'房屋概況',req:true,fields:[
    {key:'region',label:'縣市',type:'select',options:COUNTIES},
    {key:'address',label:'地址',type:'text'},
    {key:'houseType',label:'屋況',type:'chips',est:true,options:['新成屋','老屋翻新','預售屋']},
    {key:'elevator',label:'電梯',type:'chips',options:['有電梯','無電梯']},
    {key:'area',label:'坪數',type:'number',suffix:'坪',ai:true,est:true,min:0,step:'any'},
    {key:'completion',label:'交屋／完工月份',type:'month'},
    {key:'layout',label:'格局',type:'layout',est:true,wide:true}]},
  {id:'needs',title:'空間需求',req:true,fields:[
    {key:'style',label:'風格',type:'chips',multi:true,ai:true,wide:true,options:['現代簡約','北歐','日式無印','侘寂','工業風','美式','輕奢','其他']},
    {key:'members',label:'空間成員',type:'chips',multi:true,ai:true,wide:true,options:['夫妻','小孩','長輩','寵物','獨居','室友']},
    {key:'renoType',label:'裝修類型',type:'chips',ai:true,est:true,wide:true,options:['全室裝修','局部翻修','只要設計','軟裝佈置']},
    {key:'budget',label:'預算',type:'select',est:true,options:['50 萬以下','50–100 萬','100–200 萬','200–300 萬','300 萬以上','尚未確定']},
    {key:'needsNote',label:'其他需求',type:'textarea',wide:true,placeholder:'例如：需要神明廳、孝親房、大量收納…'}]}];
const GENERAL_SECTIONS=[
  {id:'project',title:'專案資訊',req:true,fields:[
    {key:'background',label:'專案背景',type:'textarea',ai:true,wide:true,placeholder:'例如：新品牌上市，需要獨特識別'},
    {key:'audience',label:'目標客群',type:'text',ai:true,wide:true},
    {key:'stylePref',label:'偏好風格／顏色',type:'text',ai:true,wide:true},
    {key:'deliverables',label:'交付項目',type:'text',est:true,wide:true,placeholder:'例如：Logo、名片、包裝盒'},
    {key:'budget',label:'預算',type:'select',est:true,options:['10 萬以下','10–30 萬','30–60 萬','60 萬以上','尚未確定']},
    {key:'needsNote',label:'其他設計需求',type:'textarea',wide:true}]}];
const NOTE_SECTION={id:'notes',title:'備註',fields:[{key:'notes',label:'專案備註',type:'textarea',top:true,wide:true,placeholder:'記錄預算、下次聯絡事項等'}]};
const SPACE_SECTIONS=[
  {id:'venue',title:'場地概況',req:true,fields:[
    {key:'region',label:'縣市',type:'select',options:COUNTIES},
    {key:'address',label:'地址',type:'text'},
    {key:'area',label:'坪數',type:'number',suffix:'坪',ai:true,est:true,min:0,step:'any'},
    {key:'completion',label:'開幕／展期月份',type:'month'}]},
  {id:'needs',title:'空間需求',req:true,fields:[
    {key:'usage',label:'空間用途',type:'text',ai:true,wide:true,placeholder:'例如：咖啡廳、辦公室、品牌展位'},
    {...HOME_SECTIONS[1].fields[0]},
    {key:'renoType',label:'施作範圍',type:'chips',ai:true,est:true,wide:true,options:['全區裝修','局部改裝','只要設計','展場搭建']},
    {...HOME_SECTIONS[1].fields[3]},
    {...HOME_SECTIONS[1].fields[4]}]}];
const isSpace=type=>['居家裝潢設計','商業空間設計','展覽空間設計'].includes(type);
const sectionsFor=type=>[CONTACT_SECTION,...(type==='居家裝潢設計'?HOME_SECTIONS:isSpace(type)?SPACE_SECTIONS:GENERAL_SECTIONS),NOTE_SECTION];
const allFields=type=>sectionsFor(type).flatMap(s=>s.fields.map(f=>({...f,section:s.id,req:!!s.req})));
const aiFields=type=>allFields(type).filter(f=>f.ai);
const referenceFields=(type,id)=>id==='visual'?aiFields(type):allFields(type).filter(f=>['area','layout','houseType','usage'].includes(f.key));

const STEPS=[{id:'brief',label:'需求總覽'},{id:'strategy',label:'策略企劃'},{id:'visual',label:'視覺發想'},{id:'model3d',label:'3D 建模'},{id:'estimate',label:'業務估價'},{id:'proposal',label:'提案簡報'}];

/* ================= 資料與本機儲存 ================= */
const key='genie-local-projects-v1', selected=new Set(), pageSize=8;
const SAMPLE_BRIEFS={
  'sample-0':{region:'台中市',address:'沙鹿區示範路 1 號',houseType:'新成屋',elevator:'無電梯',area:'35',completion:'2026-08',layout:{r:3,l:1,b:4},style:['現代簡約','日式無印'],members:['夫妻','小孩','長輩'],renoType:'全室裝修',budget:'100–200 萬',contactTime:['平日晚上'],needsNote:'需要神明廳與車庫'},
  'sample-3':{region:'台中市',houseType:'老屋翻新',area:'28',style:['北歐'],renoType:'局部翻修'}};
const seed=[['居家設計','2026-07-25',true],['居家設計','2026-07-22',true],['測試','2026-07-21',false],['示範居家設計','2026-07-20',true],['示範居家設計','2026-07-15',true],['居家設計','2026-07-15',true],['設計專案','2026-07-15',false],['居家設計','2026-07-15',false]].map(([name,date,done],i)=>({id:'sample-'+i,name,date,done,contact:i===0?'示範客戶':i===6?'示範聯絡人 A':i===7?'示範聯絡人 B':'',type:i===6?'其他設計':'居家裝潢設計',email:i>=6?'hello@example.com':'',phone:i===6?'0900000000':'',due:'',notes:''}));
let projects=seed.map(p=>({...p,brief:structuredClone(SAMPLE_BRIEFS[p.id]||{}),source:p.done?{kind:'client',submittedAt:p.date+'T08:00:00.000Z'}:{kind:'manual'}})),page=0,deleting=null,undoState=null,toastTimer,toastAction=null;
let storageWarning=false;
try{const value=JSON.parse(localStorage.getItem(key));if(Array.isArray(value)&&value.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&typeof p.date==='string'))projects=value;}catch{storageWarning=true;}
function normalizeProject(p){
  if(!p.brief||typeof p.brief!=='object'||Array.isArray(p.brief))p.brief={};
  if(!p.type)p.type='居家裝潢設計';
  if(!p.steps||typeof p.steps!=='object'||Array.isArray(p.steps))p.steps={};
  if(!p.skip||typeof p.skip!=='object'||Array.isArray(p.skip))p.skip={};
  if(!p.source||!['manual','meeting','client','unknown'].includes(p.source.kind))p.source={kind:'unknown'};
  delete p.strategyStale;
  return p;
}
projects.forEach(normalizeProject);
function save(){try{localStorage.setItem(key,JSON.stringify(projects));return true;}catch{toast('瀏覽器無法儲存，請使用左側「匯出本機資料」備份。',{duration:12000});return false;}}
function commit(change){const backup=structuredClone(projects);try{change();if(save())return true;}catch{toast('變更未儲存，請重試。');}projects=backup;return false;}
const findProject=id=>projects.find(p=>p.id===id);

/* ================= 通知 ================= */
function toast(message,{actionLabel='',onAction=null,duration=5000}={}){clearTimeout(toastTimer);$('#toast-text').innerHTML=esc(message);toastAction=onAction;$('#toast-action').innerHTML=esc(actionLabel);$('#toast-action').hidden=!actionLabel;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,duration);}

/* ================= 欄位值與完成依據 ================= */
const getVal=(p,f)=>f.top?p[f.key]:p.brief?.[f.key];
function isEmpty(v){if(v==null||v==='')return true;if(Array.isArray(v))return !v.length;if(typeof v==='object')return !Object.values(v).some(x=>x!==''&&x!=null);return false;}
function norm(v){if(isEmpty(v))return '';if(Array.isArray(v)){const values=v.map(norm).filter(v=>v!=='').sort();return values.length?values:'';}if(typeof v==='object'){const values=Object.fromEntries(Object.entries(v).map(([k,v])=>[k,norm(v)]));return isEmpty(values)?'':values;}return typeof v==='string'?v.trim():v;}
function stable(v){return JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);}
const equal=(a,b)=>stable(a)===stable(b);
function fieldNorm(f,v){v=norm(v);if(f.type==='number'&&!isEmpty(v))return Number.isFinite(Number(v))?Number(v):v;if(f.type==='layout'&&v&&typeof v==='object')return norm(Object.fromEntries(['r','l','b'].map(k=>[k,isEmpty(v[k])?'':number(v[k])])));return v;}
const reqOf=(type,brief)=>({type,...Object.fromEntries(allFields(type).filter(f=>f.req).map(f=>[f.key,fieldNorm(f,brief?.[f.key])]))});
const estDeps=p=>({type:p.type,...Object.fromEntries(allFields(p.type).filter(f=>f.est).map(f=>[f.key,fieldNorm(f,getVal(p,f))]))});
const modelSupported=p=>!['品牌設計','包裝設計','網站設計'].includes(p.type);
const proposalParts=p=>['brief','strategy',...(!p.skip.visual?['visual']:[]),...(modelSupported(p)&&!p.skip.model3d?['model3d']:[]),'estimate'];
const prerequisites=(p,id)=>id==='proposal'?proposalParts(p):({brief:[],strategy:['brief'],visual:['strategy'],model3d:['strategy'],estimate:['brief']}[id]||[]);
const pendingPrerequisites=(p,id)=>prerequisites(p,id).filter(s=>stepStatus(p,s).s!=='done');
const stepName=id=>STEPS.find(s=>s.id===id)?.label||id;
function basisOf(p,id){
  const req=reqOf(p.type,p.brief);
  if(id==='brief')return {req};
  if(id==='strategy')return {req,gen:p.strategy?.at??null};
  if(id==='visual'||id==='model3d')return {fields:Object.fromEntries(referenceFields(p.type,id).map(f=>[f.key,fieldNorm(f,getVal(p,f))])),gen:p.strategy?.at??null};
  if(id==='estimate')return {deps:estDeps(p),est:resolvedEstimate(p)};
  return {header:{name:norm(p.name),contact:norm(p.contact),type:norm(p.type)},parts:proposalParts(p).map(id=>[id,basisOf(p,id)])};
}
function dateText(value){return value?String(value).replaceAll('-','/'):'';}
function timeText(value){return value?new Date(value).toLocaleString('zh-TW'):'';}
// 即使快速連續按下，快照時間仍能代表不同的確認／生成版本。
function stamp(previous){return new Date(Math.max(Date.now(),(Date.parse(previous)||0)+1)).toISOString();}
function display(f,v){
  if(isEmpty(v))return '';
  if(Array.isArray(v))return v.join('、');
  if(f.type==='layout')return [['r','房'],['l','廳'],['b','衛']].filter(([k])=>v[k]!==''&&v[k]!=null).map(([k,u])=>`${v[k]} ${u}`).join(' ');
  if(f.type==='date')return dateText(v);
  if(f.type==='month'){const [y,m]=String(v).split('-');return `${y} 年 ${Number(m)} 月`;}
  if(f.suffix)return `${v} ${f.suffix}`;
  return String(v);
}
function readiness(p){const list=aiFields(p.type);const missing=list.filter(f=>isEmpty(norm(getVal(p,f)))||(f.type==='number'&&!(Number.isFinite(Number(getVal(p,f)))&&Number(getVal(p,f))>0)));return {total:list.length,filled:list.length-missing.length,missing,complete:!missing.length};}
const strategyOutdated=p=>!!p.strategy&&!equal(reqOf(p.strategy.snapshot?.type,p.strategy.snapshot?.brief),reqOf(p.type,p.brief));
function stepStatus(p,id){
  if(id==='model3d'&&!modelSupported(p))return {s:'na',meta:'本版不提供'};
  if(['visual','model3d'].includes(id)&&p.skip[id])return {s:'na',meta:'本案不採用'};
  if(p.steps[id]){
    if(!equal(p.steps[id].basis,basisOf(p,id)))return {s:'stale',meta:'需更新'};
    return pendingPrerequisites(p,id).length?{s:'stale',meta:'上游需更新'}:{s:'done',meta:'已完成'};
  }
  if(id==='strategy'&&strategyOutdated(p))return {s:'stale',meta:'需重新生成'};
  const r=readiness(p);
  if(id==='brief')return r.complete?{s:'ready',meta:'可以確認'}:{s:'missing',meta:`必填 ${r.filled}/${r.total}`};
  if(id==='estimate')return {s:'ready',meta:p.estimate?'編輯中':'可以開始'};
  if(id==='visual'||id==='model3d')return stepStatus(p,'strategy').s==='done'?{s:'ready',meta:'待標記完成'}:{s:'missing',meta:'需先完成策略'};
  if(stepStatus(p,'brief').s!=='done')return {s:'missing',meta:'需先確認需求'};
  return {s:'ready',meta:id==='proposal'?'可以預覽':p.strategy?'待標記完成':'可以生成'};
}
function changedLabels(old,current,fields=allFields(current?.type)){
  if(old?.type!==current?.type)return ['需求類型'];
  return [...new Set([...Object.keys(old||{}),...Object.keys(current||{})])].filter(k=>!equal(old?.[k],current?.[k])).map(k=>fields.find(f=>f.key===k)?.label||k);
}
function staleReason(p,id){
  const old=p.steps[id]?.basis,now=basisOf(p,id),reasons=[];
  const oldReq=['brief','strategy'].includes(id)?old?.req||(id==='strategy'&&p.strategy?reqOf(p.strategy.snapshot?.type,p.strategy.snapshot?.brief):null):null;
  if(oldReq&&!equal(oldReq,now.req))reasons.push('需求修改了：'+changedLabels(oldReq,now.req).join('、'));
  if(id==='strategy'&&old&&old.gen!==now.gen)reasons.push('策略企劃已重新生成');
  if(['visual','model3d'].includes(id)&&old){
    if(old.gen!==now.gen)reasons.push('策略企劃已重新生成');
    if(!equal(old.fields,now.fields))reasons.push('會帶入的資料修改了：'+changedLabels(old.fields,now.fields,[...referenceFields(p.type,id),...TYPES.flatMap(allFields)]).join('、'));
  }
  if(id==='estimate'&&old){
    if(!equal(old.deps,now.deps))reasons.push('估價引用的需求修改了：'+changedLabels(old.deps,now.deps).join('、'));
    if(!equal(old.est,now.est))reasons.push('報價明細或條件在完成後有修改（含連動坪數）');
  }
  if(id==='proposal'&&old&&!equal(old,now)){
    const before=Object.fromEntries(old.parts||[]),after=Object.fromEntries(now.parts),ids=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!equal(before[k],after[k]));
    if(ids.length)reasons.push('引用的內容已更新：'+ids.map(stepName).join('、'));
    const headers=[['name','專案名稱'],['contact','聯絡人'],['type','類型']].filter(([k])=>!equal(old.header?.[k],now.header[k])).map(([,label])=>label);
    if(headers.length)reasons.push(headers.join('／')+'已修改');
  }
  reasons.push(...pendingPrerequisites(p,id).map(s=>`『${stepName(s)}』目前不是已完成`));
  if(id==='brief'&&!readiness(p).complete)reasons.push('目前缺少必填欄位：'+readiness(p).missing.map(f=>f.label).join('、'));
  return reasons.join('；')||'完成依據已改變，請檢查後重新標記完成。';
}
function completionBlocks(p,id){
  if(id==='brief')return readiness(p).missing.length?['還缺必填欄位：'+readiness(p).missing.map(f=>f.label).join('、')]:[];
  if(id==='proposal')return proposalParts(p).filter(s=>stepStatus(p,s).s!=='done').map(s=>'尚未完成：'+stepName(s));
  const reasons=[];
  if(stepStatus(p,'brief').s!=='done')reasons.push('需先確認需求');
  if(id==='strategy'){if(!p.strategy)reasons.push('尚未生成策略企劃');else if(strategyOutdated(p))reasons.push('策略依舊需求產生，須重新生成');}
  if(['visual','model3d'].includes(id)&&stepStatus(p,'strategy').s!=='done')reasons.push('需先完成策略企劃');
  if(id==='estimate')reasons.push(...estimateBlocks(p));
  return reasons;
}
const aiBadge=f=>f.ai?'<span class="ai-badge" title="確認需求與生成策略企劃需要這個欄位">必填</span>':'';
const stateLabel={missing:'缺資料',ready:'可開始',done:'已完成',stale:'需更新',na:'不適用'};
const badge=(p,id)=>{const st=stepStatus(p,id);return `<span class="state-tag is-${st.s}">${stateLabel[st.s]}</span>`;};
const projectHref=(p,id)=>`#/p/${esc(encodeURIComponent(p.id))}/${id}`;
const sourceLabel=p=>({manual:'手動建立',meeting:'會議記錄',client:p.source.submittedAt?'客戶已送出':'等待客戶填寫',unknown:'未註明'}[p.source.kind]);
function nextStep(p){return STEPS.find(s=>!['done','na'].includes(stepStatus(p,s.id).s));}
function currentStep(p){const s=nextStep(p);if(!s)return '<span class="state-tag is-done">提案已完成</span>';const st=stepStatus(p,s.id);return `<a class="state-tag is-${st.s}" href="${projectHref(p,s.id)}">${['①','②','③','④','⑤','⑥'][STEPS.indexOf(s)]} ${s.label}・${stateLabel[st.s]}</a>`;}

/* ================= 清單頁 ================= */
function current(){return projects.slice(page*pageSize,(page+1)*pageSize);}
function render(){
page=Math.max(0,Math.min(page,Math.ceil(projects.length/pageSize)-1));
const rows=current();
$('#rows').innerHTML=rows.map(p=>`<tr data-id="${esc(p.id)}" class="${selected.has(p.id)?'selected':''}"><td><input type="checkbox" data-select="${esc(p.id)}" aria-label="選取專案 ${esc(p.name)}" ${selected.has(p.id)?'checked':''}></td><td><a class="project-name" href="${projectHref(p,'brief')}" title="開啟專案">${esc(p.name)}</a></td><td>${esc(p.contact)}</td><td>${esc(dateText(p.date))}</td><td><span class="type-tag">${esc(p.type)}</span></td><td>${esc(p.email)}</td><td>${esc(p.phone)}</td><td>${esc(dateText(p.due))}</td><td>${esc(sourceLabel(p))}</td><td>${currentStep(p)}</td><td><div class="row-actions"><button data-copy="${esc(p.id)}" aria-label="複製 ${esc(p.name)}" title="複製專案">${icon('copy')}</button><button data-delete="${esc(p.id)}" aria-label="刪除 ${esc(p.name)}" title="刪除專案">${icon('trash')}</button></div></td></tr>`).join('')+`<tr class="example-row"><td></td><td><span class="example-badge">範例</span><span class="example-name">示範品牌 / Demo Brand</span></td><td>示範聯絡人</td><td>2024/11/27</td><td><span class="type-tag">品牌設計</span></td><td>info@example.com</td><td></td><td>2025/01/31</td><td>—</td><td>—</td><td></td></tr>`;
const all=$('#select-all');all.checked=rows.length>0&&rows.every(p=>selected.has(p.id));all.indeterminate=rows.some(p=>selected.has(p.id))&&!all.checked;all.disabled=!rows.length;
$('.selection-bar').hidden=!selected.size;$('#selected-count').textContent=`已選取 ${selected.size} 個專案`;
const total=Math.max(1,Math.ceil(projects.length/pageSize));$('#prev').disabled=page===0;$('#next').disabled=page>=total-1;
$('#pages').innerHTML=Array.from({length:total},(_,i)=>`<button data-page="${i}" class="${i===page?'current':''}" aria-label="第 ${i+1} 頁" ${i===page?'aria-current="page"':''}>${i+1}</button>`).join('');$('#count').textContent=`${rows.length} / ${projects.length}`;
}
function today(){const t=new Date();return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;}
function openCreate(){const form=$('#project-form');form.reset();form.elements.type.innerHTML=TYPES.map(t=>`<option>${esc(t)}</option>`).join('');form.elements.date.value=today();form.elements.type.value='居家裝潢設計';$('#editor').showModal();}

/* ================= 專案內頁與狀態列 ================= */
let view={id:null,step:'brief'};
function stepsHtml(p){return STEPS.map((s,i)=>{const st=stepStatus(p,s.id),mark=st.s==='done'?icon('check'):st.s==='na'?'–':st.s==='stale'?'!':i+1,cur=s.id===view.step;return `<li><a href="${projectHref(p,s.id)}" class="step is-${st.s}${cur?' is-current':''}" ${cur?'aria-current="step"':''} aria-label="第 ${i+1} 步 ${s.label}，${esc(st.meta)}"><span class="step-badge">${mark}</span><span class="step-text"><span class="step-label">${s.label}</span><span class="step-meta">${esc(st.meta)}</span></span></a></li>`;}).join('');}
function renderDetail(){
  const p=findProject(view.id);if(!p)return;
  $('#detail-view').innerHTML=`<header class="detail-header"><div class="detail-top"><nav class="crumbs" aria-label="路徑"><a href="#/">潛在客戶</a><span aria-hidden="true">›</span><h1 title="${esc(p.name)}">${esc(p.name)}</h1></nav><div class="detail-actions"><span class="type-tag">${esc(p.type)}</span><button class="primary btn-icon" data-action="edit-all">${icon('edit')}編輯全部資料</button></div></div><nav class="stepper" aria-label="專案步驟"><ol>${stepsHtml(p)}</ol></nav></header><div class="detail-body"><div id="status-slot" aria-live="polite">${statusHtml(p,view.step)}</div>${stepBody(p)}</div>`;
}
function refreshStatus(){const p=findProject(view.id);if(!p)return;$('#status-slot').innerHTML=statusHtml(p,view.step);$('.stepper ol').innerHTML=stepsHtml(p);render();}
function missingList(r){return r.missing.map(f=>`<button class="link-chip" data-edit-field="${f.key}">${esc(f.label)}</button>`).join('');}
function statusHtml(p,id){
  const st=stepStatus(p,id),r=readiness(p),blocks=completionBlocks(p,id),disabled=blocks.length?'disabled':'';
  let title=st.s==='stale'?'需要更新':stateLabel[st.s],reason=st.s==='stale'?staleReason(p,id):st.meta,buttons='',extra='';
  if(st.s==='na')reason=id==='model3d'&&!modelSupported(p)?`『${p.type}』本版未提供 3D 建模。`:'本案不採用此步驟，提案不會引用。';
  else{
    if(st.s==='done')buttons=`<button data-action="uncomplete">${id==='brief'?'取消確認':'取消完成'}</button>`;
    else buttons=`<button class="primary" data-action="complete" ${disabled}>${id==='brief'?(st.s==='stale'?'重新確認需求':'確認需求'):'標記完成'}</button>`;
    if(id==='strategy'){
      const canGen=stepStatus(p,'brief').s==='done';
      if(p.strategy)buttons=(canGen?'<button data-action="gen-strategy">重新生成</button>':`<a class="btn" href="${projectHref(p,'brief')}">前往需求總覽</a>`)+buttons;
      if(st.s==='stale'&&canGen&&!strategyOutdated(p))reason+='；檢查後重新標記完成。';
    }
    if(id==='brief'&&!r.complete){extra=`<div class="bar" role="progressbar" aria-valuenow="${r.filled}" aria-valuemin="0" aria-valuemax="${r.total}" aria-label="必填完成度"><span style="width:${Math.round(r.filled/r.total*100)}%"></span></div><div class="chip-row">${missingList(r)}</div>`;buttons=`<button data-edit-field="${r.missing[0].key}">一次補齊</button>`+buttons;}
    if(st.s==='stale'&&p.steps[id])buttons+=`<button data-action="uncomplete">${id==='brief'?'取消確認':'取消完成'}</button>`;
  }
  return `<div class="status-bar is-${st.s}"><div class="status-main"><strong>${title}</strong><p>${esc(reason)}</p>${extra}${st.s!=='na'&&blocks.length?`<p class="status-reason">${esc(blocks.join('；'))}</p>`:''}</div><div class="status-actions">${buttons}</div></div>`;
}
function stepBody(p){if(view.step==='brief')return briefBody(p);if(view.step==='strategy')return strategyBody(p);if(view.step==='estimate')return estimateBody(p);if(view.step==='proposal')return proposalBody(p);return placeholderBody(p,view.step);}
function briefBody(p){
  const cards=sectionsFor(p.type).map(s=>`<section class="card"><div class="card-head"><h2>${s.title}</h2><button class="btn-icon" data-edit-section="${s.id}">${icon('edit')}編輯</button></div><div class="kv">${s.fields.map(f=>{const v=display(f,getVal(p,f));return `<button class="kv-item${f.wide?' wide':''}" data-edit-field="${f.key}" title="點一下編輯"><span class="kv-label">${esc(f.label)}${aiBadge(f)}</span><span class="kv-value${v?'':' is-empty'}">${v?esc(v):'未填'}</span></button>`;}).join('')}</div></section>`).join('');
  return `${sourceBody(p)}<p class="hint">小提示：點任何欄位，就會打開完整表單並跳到那一格。填好後請按「確認需求」。</p>${cards}`;
}
function sourceBody(p){
  const s=p.source;
  let body='<p>手動整理專案需求，填好後再確認需求。</p>';
  if(s.kind==='unknown')body='<p>未註明來源（舊資料），請選擇。</p>';
  if(s.kind==='meeting')body=`<form id="meeting-form"><label>會議記錄<textarea name="meetingText" rows="6">${esc(s.meetingText||'')}</textarea></label><label>參考檔名<input name="fileName" value="${esc(s.fileName||'')}"></label><p class="muted">僅記錄檔名，不保存檔案。貼上文字不會自動確認或改任何需求欄位。</p><div class="source-actions"><button type="submit" class="primary">儲存記錄</button><button type="button" data-action="meeting-edit">對照記錄填寫欄位</button></div></form>`;
  if(s.kind==='client')body=`<p>${s.submittedAt?'已送出・手動登錄 '+esc(timeText(s.submittedAt)):'尚未登錄客戶送出'}</p><button data-action="client-submit">${s.submittedAt?'取消登錄':'記錄客戶已送出'}</button><p class="muted">之後串接 Messenger 機器人後，客戶送出會自動記錄。</p>`;
  return `<section class="card source-card"><div class="card-head"><h2>需求來源</h2></div><div class="segmented" aria-label="需求來源">${[['manual','手動建立'],['meeting','會議記錄整理'],['client','客戶填寫']].map(([k,label])=>`<button data-source="${k}" aria-pressed="${s.kind===k}">${label}</button>`).join('')}</div>${body}</section>`;
}
function strategyDocument(p,strategy){
  const snap=strategy.snapshot||{type:p.type,brief:{}},fake={type:snap.type,brief:snap.brief||{}};
  const rows=allFields(fake.type).filter(f=>f.req&&!isEmpty(getVal(fake,f))).map(f=>`<tr><th scope="row">${esc(f.label)}</th><td>${esc(display(f,getVal(fake,f)))}</td></tr>`).join('');
  return `<div class="doc"><p class="muted">示範內容・${esc(timeText(strategy.at))}</p><h3>提案概述</h3><table class="doc-table"><tbody><tr><th scope="row">需求類型</th><td>${esc(fake.type)}</td></tr>${rows}</tbody></table><h3>下一步</h3><ul><li>和客戶確認需求總覽內容是否正確。</li><li>依照風格與預算整理 2～3 個設計方向。</li><li>完成後進入「視覺發想」。</li></ul></div>`;
}
function strategyBody(p){
  const ready=stepStatus(p,'brief').s==='done';
  const current=p.strategy?`<section class="card"><div class="card-head"><h2>策略企劃・目前版</h2></div>${strategyDocument(p,p.strategy)}</section>`:`<div class="empty-card"><div class="empty-icon">${icon('spark')}</div><h2>${ready?'可以生成策略企劃':'尚未生成策略企劃'}</h2><p>本機示範版不連接 AI，會用需求總覽組成示範摘要；生成後仍須人工標記完成。</p>${ready?'<button class="primary" data-action="gen-strategy">生成策略企劃（示範）</button>':`<a class="btn primary" href="${projectHref(p,'brief')}">前往需求總覽</a>`}</div>`;
  return current+(p.strategyPrev?`<details class="card"><summary>上一版（${esc(timeText(p.strategyPrev.at))}）</summary>${strategyDocument(p,p.strategyPrev)}</details>`:'');
}
function placeholderBody(p,id){
  const fields=referenceFields(p.type,id);
  return `<section class="card"><div class="card-head"><h2>${stepName(id)}</h2>${id==='model3d'&&!modelSupported(p)?'':`<button data-skip="${id}">${p.skip[id]?'改為採用':'本案不採用'}</button>`}</div><p>${id==='visual'?'依照已確認的策略整理設計方向、色彩、材質與視覺參考。':'依照空間條件建立模型，確認比例、配置與空間關係。'}</p><h3>會帶入的資料</h3><dl class="reference-values">${fields.map(f=>`<div><dt>${esc(f.label)}</dt><dd>${esc(display(f,getVal(p,f))||'未填')}</dd></div>`).join('')||'<div><dt>本類型沒有空間欄位</dt></div>'}</dl><p class="muted">示範版尚未製作內容，請在其他工具完成後回來標記完成；之後串接 AI 會在這裡生成。</p></section>`;
}

/* ================= 業務估價（草稿、解析與即時合計） ================= */
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const money=v=>number(v).toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2});
function defaultEstimate(p){return {rows:isSpace(p.type)?[{id:'design',item:'室內設計費',qty:'',unit:'坪',price:'',areaLink:'on'},{id:'drawing',item:'3D 圖與施工圖',qty:1,unit:'式',price:''},{id:'supervision',item:'工程監造',qty:1,unit:'式',price:''}]:[{id:'design',item:'設計提案',qty:1,unit:'式',price:''},{id:'final',item:'修改與完稿',qty:1,unit:'式',price:''}],tax:'excl',scope:'',validUntil:''};}
function resolvedEstimate(p,estimate=p.estimate||defaultEstimate(p)){return {rows:(estimate.rows||[]).map(r=>({id:r.id,item:String(r.item||'').trim(),qty:r.areaLink==='on'?number(p.brief.area):number(r.qty),unit:String(r.unit||'').trim(),price:number(r.price),...(r.areaLink?{areaLink:r.areaLink}:{})})),tax:estimate.tax==='incl'?'incl':'excl',scope:String(estimate.scope||'').trim(),validUntil:estimate.validUntil||''};}
function totals(p,estimate){const e=resolvedEstimate(p,estimate),sum=Math.round(e.rows.reduce((n,r)=>n+r.qty*r.price,0)*100)/100,tax=e.tax==='excl'?Math.round(sum*5)/100:Math.round((sum-sum/1.05)*100)/100;return {subtotal:e.tax==='excl'?sum:Math.round((sum-tax)*100)/100,tax,total:e.tax==='excl'?Math.round((sum+tax)*100)/100:sum};}
function estimateBlocks(p){
  const raw=p.estimate||defaultEstimate(p),e=resolvedEstimate(p,raw),reasons=[],valid=r=>r.item&&r.qty>0&&r.price>0&&Number.isFinite(r.qty*r.price);
  if(!e.rows.some(valid))reasons.push('至少需要一筆有效明細（項目、數量 > 0、單價 > 0）');
  e.rows.forEach((r,i)=>{const hasContent=['item','qty','unit','price'].some(k=>!isEmpty(norm(raw.rows[i][k])))||r.qty!==0;if(hasContent&&!valid(r))reasons.push(`第 ${i+1} 列「${r.item||'未命名'}」不完整：${[!r.item?'項目':'',!(r.qty>0)?'數量須 > 0':'',!(r.price>0)?'單價須 > 0':'',!Number.isFinite(r.qty*r.price)?'金額超出範圍':''].filter(Boolean).join('、')}`);});
  if(!e.scope)reasons.push('報價範圍必填');if(!e.validUntil)reasons.push('有效期限必填');return reasons;
}
function totalsHtml(p,estimate){const t=totals(p,estimate);return `<dl class="totals"><div><dt>小計（未稅）</dt><dd>NT$ ${esc(money(t.subtotal))}</dd></div><div><dt>營業稅（5%）</dt><dd>NT$ ${esc(money(t.tax))}</dd></div><div class="grand-total"><dt>總計</dt><dd>NT$ ${esc(money(t.total))}</dd></div><div><dt>客戶預算</dt><dd>${esc(p.brief.budget||'未填')}</dd></div></dl>`;}
function areaLinkHtml(r){return r.areaLink?`<span class="muted small">${r.areaLink==='on'?'沿用需求坪數':'自訂計價坪數'}</span>${r.areaLink==='off'?'<button type="button" data-est-link>改回沿用</button>':''}`:'';}
function estimateBody(p){
  const e=resolvedEstimate(p),input=(key,v,i,type='text')=>`<input data-est-field="${key}" type="${type}" value="${esc(v)}" aria-label="第 ${i+1} 列${{item:'項目',qty:'數量',unit:'單位',price:'單價'}[key]}" ${type==='number'?'min="0" step="any" inputmode="decimal"':''}>`;
  return `<section class="card estimate-card"><div class="card-head"><h2>報價明細</h2></div><form id="estimate-form"><div class="estimate-scroll" role="region" aria-label="報價明細，可左右捲動" tabindex="0"><table class="estimate-table"><thead><tr><th>項目</th><th>數量</th><th>單位</th><th>單價</th><th>小計</th><th>操作</th></tr></thead><tbody>${e.rows.map((r,i)=>`<tr data-est-id="${esc(r.id)}"><td>${input('item',r.item,i)}</td><td>${input('qty',r.qty||'',i,'number')}<div class="area-link">${areaLinkHtml(r)}</div></td><td>${input('unit',r.unit,i)}</td><td>${input('price',r.price||'',i,'number')}</td><td class="row-subtotal">${esc(money(r.qty*r.price))}</td><td><button type="button" data-est-delete aria-label="刪除第 ${i+1} 列">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div><button type="button" data-action="est-add">＋ 新增一列</button><div class="form-grid estimate-conditions"><label>稅別<select data-est-condition="tax"><option value="excl" ${e.tax==='excl'?'selected':''}>未稅（另加 5% 營業稅）</option><option value="incl" ${e.tax==='incl'?'selected':''}>含稅</option></select></label><label>有效期限<input type="date" data-est-condition="validUntil" value="${esc(e.validUntil)}"></label><label class="wide">報價範圍與說明<textarea data-est-condition="scope" rows="3">${esc(e.scope)}</textarea></label></div></form><div id="estimate-totals" aria-live="polite">${totalsHtml(p,e)}</div></section>`;
}
function readEstimate(){
  const p=findProject(view.id),old=p.estimate||defaultEstimate(p);
  return {rows:[...document.querySelectorAll('[data-est-id]')].map(tr=>{const before=old.rows.find(r=>r.id===tr.dataset.estId),r={id:tr.dataset.estId};tr.querySelectorAll('[data-est-field]').forEach(el=>r[el.dataset.estField]=el.value);if(before?.areaLink)r.areaLink=tr.dataset.areaLink||before.areaLink;return r;}),...Object.fromEntries([...document.querySelectorAll('[data-est-condition]')].map(el=>[el.dataset.estCondition,el.value]))};
}
function updateEstimateTotals(e){const p=findProject(view.id),resolved=resolvedEstimate(p,e);document.querySelectorAll('[data-est-id]').forEach((tr,i)=>{tr.querySelector('.row-subtotal').innerHTML=esc(money(resolved.rows[i].qty*resolved.rows[i].price));});$('#estimate-totals').innerHTML=totalsHtml(p,e);}
function estimateEdit(target,saveChange){
  const p=findProject(view.id),tr=target.closest('[data-est-id]'),field=target.dataset.estField;
  if(field==='qty'&&tr.querySelector('.area-link')?.textContent)tr.dataset.areaLink='off';
  const draft=readEstimate();updateEstimateTotals(draft);
  if(!saveChange)return;
  if(!commit(()=>p.estimate=draft)){
    // 保留焦點，逐格還原成已儲存內容；失敗的變更不混入下一次儲存。
    const saved=resolvedEstimate(findProject(view.id));
    document.querySelectorAll('[data-est-id]').forEach((row,i)=>{row.querySelectorAll('[data-est-field]').forEach(el=>el.value=saved.rows[i][el.dataset.estField]??'');delete row.dataset.areaLink;row.querySelector('.area-link').innerHTML=areaLinkHtml(saved.rows[i]);});
    document.querySelectorAll('[data-est-condition]').forEach(el=>el.value=saved[el.dataset.estCondition]);updateEstimateTotals(saved);return;
  }
  if(tr)tr.querySelector('.area-link').innerHTML=areaLinkHtml(draft.rows.find(r=>r.id===tr.dataset.estId));
  refreshStatus();
}
function estimatePreview(p){const e=resolvedEstimate(p);return `<div class="estimate-scroll"><table class="doc-table"><thead><tr><th>項目</th><th>數量</th><th>單位</th><th>單價</th><th>小計</th></tr></thead><tbody>${e.rows.map(r=>`<tr><td>${esc(r.item)}</td><td>${esc(r.qty)}</td><td>${esc(r.unit)}</td><td>${esc(money(r.price))}</td><td>${esc(money(r.qty*r.price))}</td></tr>`).join('')}</tbody></table></div><p>稅別：${e.tax==='incl'?'含稅':'未稅（另加 5% 營業稅）'}；有效期限：${esc(dateText(e.validUntil)||'未填')}</p><p class="pre-wrap">報價範圍：${esc(e.scope||'未填')}</p>${totalsHtml(p,e)}`;}
function proposalBody(p){
  const rows=allFields(p.type).filter(f=>f.req&&!isEmpty(getVal(p,f))).map(f=>`<tr><th>${esc(f.label)}</th><td>${esc(display(f,getVal(p,f)))}</td></tr>`).join('');
  const section=(id,n,title,body)=>`<section class="card"><div class="card-head"><h2>${n} ${title}</h2>${badge(p,id)}</div>${body}</section>`;
  return section('brief',1,'專案概要',`<table class="doc-table"><tbody><tr><th>專案名稱</th><td>${esc(p.name)}</td></tr><tr><th>聯絡人</th><td>${esc(p.contact||'未填')}</td></tr><tr><th>需求類型</th><td>${esc(p.type)}</td></tr>${rows}</tbody></table>`)+section('strategy',2,'策略企劃',p.strategy?strategyDocument(p,p.strategy):'<p>尚未生成策略企劃。</p>')+(!p.skip.visual?section('visual',3,'視覺發想',`<p>${esc(stepStatus(p,'visual').meta)}</p>`):'')+(modelSupported(p)&&!p.skip.model3d?section('model3d',4,'3D 建模',`<p>${esc(stepStatus(p,'model3d').meta)}</p>`):'')+section('estimate',5,'業務估價',estimatePreview(p))+'<section class="card"><p>正式匯出（PDF／簡報）會在串接 AI 後提供，目前可在這裡檢查提案內容是否完整。</p></section>';
}

/* ================= 一次編輯全部資料的表單 ================= */
let drawerId=null,drawerType=null,drawerDraft=null,dirty=false;
function fieldHtml(f,v){
  const id=`f-${f.key}`,wide=f.wide?' wide':'';
  const label=`<span class="field-label">${esc(f.label)}${f.required?' <span class="req" aria-hidden="true">*</span>':''}${aiBadge(f)}</span>`;
  if(f.type==='chips'){const vals=Array.isArray(v)?v:(v?[v]:[]);return `<fieldset class="field${wide}"><legend>${label}${f.multi?'<span class="muted small">可複選</span>':''}</legend><div class="chips">${[...new Set([...f.options,...vals])].map(o=>`<label class="chip"><input type="${f.multi?'checkbox':'radio'}" name="${f.key}" value="${esc(o)}" ${vals.includes(o)?'checked':''}><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`;}
  if(f.type==='layout'){const o=v||{};return `<fieldset class="field${wide}"><legend>${label}</legend><div class="layout-row">${[['r','房'],['l','廳'],['b','衛']].map(([k,u])=>`<label class="suffix-input small-num"><input type="number" min="0" max="20" name="${f.key}.${k}" value="${esc(o[k]??'')}" inputmode="numeric" aria-label="${u}"><span>${u}</span></label>`).join('')}</div></fieldset>`;}
  let control;
  if(f.type==='select')control=`<select id="${id}" name="${f.key}">${f.noEmpty?'':'<option value="">請選擇</option>'}${[...new Set([...f.options,...(isEmpty(v)?[]:[v])])].map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
  else if(f.type==='textarea')control=`<textarea id="${id}" name="${f.key}" rows="3" maxlength="5000" placeholder="${esc(f.placeholder||'')}">${esc(v||'')}</textarea>`;
  else{const t=f.type==='tel'?'tel':f.type;control=`<input id="${id}" name="${f.key}" type="${t}" value="${esc(v??'')}" ${f.required?'required':''} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:''} ${f.min!=null?`min="${f.min}"`:''} ${f.step?`step="${f.step}"`:''} ${f.type==='tel'?'inputmode="tel"':''} ${f.type==='number'?'inputmode="decimal"':''} maxlength="150">`;if(f.suffix)control=`<span class="suffix-input">${control}<span>${f.suffix}</span></span>`;}
  return `<div class="field${wide}"><label for="${id}">${label}</label>${control}</div>`;
}
function buildDrawer(data,type){
  drawerType=type;
  const secs=sectionsFor(type);
  $('#drawer-tabs').innerHTML=secs.map(s=>`<button type="button" data-jump="${s.id}">${s.title}</button>`).join('');
  $('#drawer-body').innerHTML=(data.source?.kind==='meeting'&&data.source.meetingText?`<details class="meeting-reference"><summary>會議記錄（對照填寫）</summary><p class="pre-wrap">${esc(data.source.meetingText)}</p></details>`:'')+secs.map(s=>`<section class="form-section" id="sec-${s.id}" aria-labelledby="sec-${s.id}-h"><h3 id="sec-${s.id}-h">${s.title}</h3><div class="form-grid">${s.fields.map(f=>fieldHtml(f,getVal(data,f))).join('')}</div></section>`).join('');
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
function draftProject(){const {top,brief}=readForm();return {...drawerDraft,...top,brief:{...drawerDraft.brief,...brief}};}
function updateDrawerProgress(){
  const r=readiness(draftProject());
  $('#drawer-progress').innerHTML=`<span class="bar small"><span style="width:${Math.round(r.filled/r.total*100)}%"></span></span><span>必填 ${r.filled}/${r.total}</span>`;
  $('#dirty-note').textContent=dirty?'有未儲存的變更（Ctrl＋S 儲存）':'';
}
function openDrawer(id,{section,field}={}){
  const p=findProject(id);if(!p)return;
  drawerId=id;drawerDraft=structuredClone(p);dirty=false;
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
  const p=findProject(drawerId),draft=draftProject();
  const topKeys=[...new Set([...CONTACT_SECTION.fields,...NOTE_SECTION.fields].filter(f=>f.top).map(f=>f.key))];
  const briefKeys=[...new Set([...Object.keys(p.brief),...Object.keys(draft.brief)])];
  const count=topKeys.filter(k=>!equal(norm(p[k]),norm(draft[k]))).length+briefKeys.filter(k=>!equal(norm(p.brief[k]),norm(draft.brief[k]))).length;
  if(!count){closeDrawer(true);toast('沒有需要儲存的變更');return;}
  const before=Object.fromEntries(STEPS.map(s=>[s.id,stepStatus(p,s.id).s]));
  if(!commit(()=>{topKeys.forEach(k=>p[k]=draft[k]);p.brief=draft.brief;}))return;
  const stale=STEPS.filter(s=>before[s.id]!=='stale'&&stepStatus(p,s.id).s==='stale');
  closeDrawer(true);renderDetail();render();
  toast(`已儲存 ${count} 個欄位。${stale.length?'需要更新：'+stale.map(s=>s.label).join('、'):''}`,{actionLabel:stale.length?'前往':'',onAction:()=>{location.hash=`#/p/${encodeURIComponent(p.id)}/${stale[0].id}`;},duration:8000});
}

/* ================= 頁面切換（網址 #/p/專案/步驟） ================= */
function route(){
  const m=location.hash.match(/^#\/p\/([^/]+)(?:\/(\w+))?/);
  let p;try{p=m&&findProject(decodeURIComponent(m[1]));}catch{location.replace('#/');return;}
  if(m&&!p){location.replace('#/');return;}
  if(p){view={id:p.id,step:STEPS.some(s=>s.id===m[2])?m[2]:'brief'};$('#list-view').hidden=true;$('#detail-view').hidden=false;renderDetail();const title=document.createElement('span');title.innerHTML=esc(`${p.name}｜Genie-Local v4`);document.title=title.textContent;}
  else{view={id:null,step:'brief'};$('#detail-view').hidden=true;$('#list-view').hidden=false;render();document.title='潛在客戶｜Genie-Local v4';}
  $('main').scrollTop=0;
}

/* ================= 其他對話框 ================= */
function showInfo(title,body){$('#info-title').innerHTML=esc(title);$('#info-body').innerHTML=body;$('#info-dialog').showModal();}
const actions={
add:()=>openCreate(),home:()=>{if(location.hash&&location.hash!=='#/')location.hash='#/';else{page=0;render();$('main').scrollTop=0;}},
'clear-selection':()=>{selected.clear();render();},
'delete-selected':()=>confirmDelete([...selected]),
'edit-all':()=>openDrawer(view.id),
'gen-strategy':()=>{
  const p=findProject(view.id);if(stepStatus(p,'brief').s!=='done')return;
  if(!commit(()=>{p.strategyPrev=p.strategy;p.strategy={at:stamp(p.strategy?.at),snapshot:{type:p.type,brief:structuredClone(p.brief)}};}))return;
  renderDetail();render();toast('已生成示範策略企劃，請檢查後標記完成');
},
complete:()=>{
  const p=findProject(view.id),id=view.step;if(stepStatus(p,id).s==='na'||completionBlocks(p,id).length)return;
  if(!commit(()=>p.steps[id]={at:stamp(p.steps[id]?.at),basis:basisOf(p,id)}))return;
  renderDetail();render();const next=nextStep(p);
  toast(id==='brief'?'需求已確認':'已標記完成',{actionLabel:next?'前往下一步':'',onAction:()=>{location.hash=`#/p/${encodeURIComponent(p.id)}/${next.id}`;}});
},
uncomplete:()=>{const p=findProject(view.id);if(commit(()=>delete p.steps[view.step])){renderDetail();render();toast(view.step==='brief'?'已取消確認':'已取消完成');}},
'client-submit':()=>{const p=findProject(view.id);if(commit(()=>{if(p.source.submittedAt)delete p.source.submittedAt;else p.source.submittedAt=new Date().toISOString();})){renderDetail();render();}},
'meeting-edit':()=>{if(saveMeeting())openDrawer(view.id,{section:sectionsFor(findProject(view.id).type)[1].id});},
'est-add':()=>changeEstimate(e=>e.rows.push({id:crypto.randomUUID(),item:'',qty:'',unit:'',price:''})),
knowledge:()=>{let notes='';try{notes=localStorage.getItem('genie-local-notes')||'';}catch{}showInfo('知識庫',`<p class="muted">整理你的常用問答與專案需求，保存在這台瀏覽器。</p><form id="notes-form"><label>工作筆記<textarea name="knowledge" rows="10" maxlength="30000" placeholder="例如：第一次洽談需要確認的事項…">${esc(notes)}</textarea></label><div class="dialog-footer"><button type="submit" class="primary">儲存筆記</button></div></form>`);},
account:()=>{let name='';try{name=localStorage.getItem('genie-local-name')||'';}catch{}showInfo('個人設定',`<div class="account-avatar"></div><form id="account-form"><label>顯示名稱<input name="displayName" maxlength="60" value="${esc(name)}" placeholder="你的名字"></label><p class="muted">本機示範版本，無需登入。資料保存在目前的瀏覽器。</p><div class="dialog-footer"><button class="primary" type="submit">儲存設定</button></div></form>`);},
help:()=>showInfo('Genie-Local v4 使用說明','<p>六個步驟都能隨時打開查看，條件只限制生成與確認。</p><ol><li>需求總覽：選擇需求來源，補齊「必填」後按「確認需求」。會議記錄不會自動改寫欄位；客戶送出是手動登錄。</li><li>策略企劃：確認需求後生成示範摘要，檢查後「標記完成」；重新生成保留上一版。</li><li>視覺發想與 3D：在其他工具完成後回來標記，或設為「本案不採用」。品牌、包裝、網站本版不提供 3D。</li><li>業務估價：填明細、稅別、有效期限與報價範圍，確認需求後才能標記完成。修改數量會解除坪數連動，可按「改回沿用」。</li><li>提案簡報：預覽所有採用的段落，引用步驟都完成後才能標記完成；尚無正式匯出。</li></ol><p>狀態：缺資料／可開始／已完成／需更新／不適用。修改需求或成果後會比對完成依據，顯示更新原因；電話與備註不影響狀態。</p><ul><li>表單支援類型切換保留草稿、Ctrl＋S 儲存、未儲存關閉提醒。</li><li>勾選可批次刪除，10 秒內可復原整批；連續刪除也會一併復原。</li><li>左側對話圖示可匯出 JSON 備份，目前不提供匯入。</li></ul><p class="muted">資料只在目前瀏覽器，未連接 AI、Messenger 或雲端。清除瀏覽器資料會移除本機記錄。</p>'),
export:()=>{let notes='',name='';try{notes=localStorage.getItem('genie-local-notes')||'';name=localStorage.getItem('genie-local-name')||'';}catch{}const blob=new Blob([JSON.stringify({version:3,projects,notes,displayName:name},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='客戶資料備份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出本機資料');}
};

/* ================= 儲存來源、估價與批次刪除 ================= */
function saveMeeting(){const form=$('#meeting-form');if(!form)return true;const p=findProject(view.id);return commit(()=>{p.source.meetingText=form.elements.meetingText.value;p.source.fileName=form.elements.fileName.value.trim();});}
function changeEstimate(change){const p=findProject(view.id),e=readEstimate();change(e);if(commit(()=>p.estimate=e)){renderDetail();render();}}
function confirmDelete(ids){if(!ids.length)return;deleting=ids;$('#confirm-copy').innerHTML=ids.length>1?esc(`確定刪除所選的 ${ids.length} 個專案？`):esc(`確定刪除「${findProject(ids[0]).name}」？`);$('#confirm-dialog').showModal();}
function undoDelete(){
  if(!undoState||Date.now()>undoState.until){undoState=null;toast('復原時間已超過 10 秒');return;}
  const batches=undoState.batches;
  if(!commit(()=>{[...batches].reverse().forEach(batch=>batch.forEach(({project,index})=>{if(!findProject(project.id))projects.splice(index,0,project);}));})){
    toast('復原未儲存，資料尚未還原，請重試。',{actionLabel:'重試復原',onAction:undoDelete,duration:Math.max(1,undoState.until-Date.now())});return;
  }
  page=Math.floor(Math.min(...batches.flat().map(x=>x.index))/pageSize);undoState=null;render();toast('專案已整批復原');
}

/* ================= 事件 ================= */
document.addEventListener('click',e=>{
const b=e.target.closest('button');if(!b)return;
if(b.hasAttribute('data-close'))return b.closest('dialog').close();
if(b.hasAttribute('data-drawer-close'))return closeDrawer();
if(b.dataset.jump){$(`#sec-${b.dataset.jump}`)?.scrollIntoView({block:'start',behavior:'smooth'});return;}
if(b.dataset.action)return actions[b.dataset.action]?.();
if(b.dataset.editField)return openDrawer(view.id,{field:b.dataset.editField});
if(b.dataset.editSection)return openDrawer(view.id,{section:b.dataset.editSection});
if(b.dataset.source){const p=findProject(view.id);if(commit(()=>p.source.kind=b.dataset.source)){renderDetail();render();}return;}
if(b.dataset.skip){const p=findProject(view.id);if(commit(()=>{if(p.skip[b.dataset.skip])delete p.skip[b.dataset.skip];else p.skip[b.dataset.skip]=true;})){renderDetail();render();}return;}
if(b.hasAttribute('data-est-delete'))return changeEstimate(e=>e.rows=e.rows.filter(r=>r.id!==b.closest('[data-est-id]').dataset.estId));
if(b.hasAttribute('data-est-link'))return changeEstimate(e=>e.rows.find(r=>r.id===b.closest('[data-est-id]').dataset.estId).areaLink='on');
if(b.dataset.copy){const p=findProject(b.dataset.copy);if(commit(()=>projects.unshift({...structuredClone(p),id:crypto.randomUUID(),name:p.name+'（副本）',steps:{},strategy:undefined,strategyPrev:undefined,source:{kind:'manual'}}))){page=0;render();toast('已複製專案');}}
if(b.dataset.delete)confirmDelete([b.dataset.delete]);
if(b.dataset.page!==undefined){page=Number(b.dataset.page);render();$('main').scrollTop=0;}
});
$('#detail-view').addEventListener('submit',e=>{e.preventDefault();if(e.target.id==='meeting-form'&&saveMeeting())toast('會議記錄已儲存');});
$('#detail-view').addEventListener('input',e=>{if(e.target.matches('[data-est-field],[data-est-condition]'))estimateEdit(e.target,false);});
$('#detail-view').addEventListener('change',e=>{if(e.target.matches('[data-est-field],[data-est-condition]'))estimateEdit(e.target,true);});
$('#rows').addEventListener('change',e=>{const id=e.target.dataset.select;if(id){e.target.checked?selected.add(id):selected.delete(id);render();}});
$('#select-all').addEventListener('change',e=>{current().forEach(p=>e.target.checked?selected.add(p.id):selected.delete(p.id));render();});
// 快速新增
$('#project-form').addEventListener('submit',e=>{e.preventDefault();const form=e.target;if(!form.elements.name.value.trim()){form.elements.name.setCustomValidity('請輸入專案名稱');form.elements.name.reportValidity();return;}const data=Object.fromEntries(new FormData(form));for(const f of ['name','contact','email','phone'])data[f]=data[f].trim();Object.assign(data,{done:false,notes:'',brief:{},steps:{},skip:{},source:{kind:'manual'},id:crypto.randomUUID()});if(!commit(()=>projects.unshift(data)))return;page=0;$('#editor').close();location.hash=`#/p/${encodeURIComponent(data.id)}/brief`;toast('專案已建立，接著補齊需求資料',{actionLabel:'開始填寫',onAction:()=>openDrawer(data.id,{section:sectionsFor(data.type)[1].id})});});
$('#project-form').elements.name.addEventListener('input',e=>e.target.setCustomValidity(''));
// 側邊表單
$('#drawer-form').addEventListener('input',e=>{if(e.target.name==='name')e.target.setCustomValidity('');dirty=true;updateDrawerProgress();});
$('#drawer-form').addEventListener('change',e=>{dirty=true;
  if(e.target.name==='type'){drawerDraft=draftProject();drawerDraft.type=e.target.value;buildDrawer(drawerDraft,drawerDraft.type);$('#drawer-form').elements.type.focus();}
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
$('#confirm-delete').addEventListener('click',()=>{
  const batch=projects.map((project,index)=>({project,index})).filter(x=>deleting.includes(x.project.id));
  if(!commit(()=>projects=projects.filter(p=>!deleting.includes(p.id))))return;
  const prior=undoState&&Date.now()<=undoState.until?undoState.batches:[];
  undoState={batches:[...prior,batch],until:Date.now()+10000};deleting.forEach(id=>selected.delete(id));render();$('#confirm-dialog').close();
  toast(`已刪除 ${batch.length} 個專案`,{actionLabel:'復原',duration:10000,onAction:undoDelete});
});
$('#toast-action').addEventListener('click',()=>{const fn=toastAction;$('#toast').hidden=true;clearTimeout(toastTimer);fn?.();});
$('#dismiss-toast').addEventListener('click',()=>{$('#toast').hidden=true;clearTimeout(toastTimer);});
$('#prev').addEventListener('click',()=>{page--;render();$('main').scrollTop=0;});$('#next').addEventListener('click',()=>{page++;render();$('main').scrollTop=0;});
$('#info-dialog').addEventListener('submit',e=>{e.preventDefault();try{if(e.target.id==='notes-form')localStorage.setItem('genie-local-notes',e.target.elements.knowledge.value);if(e.target.id==='account-form')localStorage.setItem('genie-local-name',e.target.elements.displayName.value);$('#info-dialog').close();toast('已儲存');}catch{toast('瀏覽器無法儲存，請確認儲存空間與隱私設定。');}});
window.addEventListener('hashchange',route);
route();if(storageWarning)toast('無法讀取先前資料，目前顯示示範內容。',{duration:10000});
})();
