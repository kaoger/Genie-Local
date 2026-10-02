'use strict';
// 每個 fixture 可共用這個物件跨 browser context，完全不連真實資料庫。
const jsonb=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function createCloud(rows=[]){return {rows:structuredClone(rows),reads:[],rpcs:[],results:[],readStatus:200,rpcStatus:200,rpcCode:null,holdRead:null,holdRpc:null,afterRpc:null,dropResponse:false};}
async function cloudRoute(route,cloud,headers){
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/rest/v1/genie_projects'){
    cloud.reads.push({url,headers:request.headers()});
    if(cloud.holdRead)await cloud.holdRead();
    if(cloud.readStatus!==200)return route.fulfill({status:cloud.readStatus,headers,body:'{"message":"read failed"}'});
    let rows=cloud.rows.slice().sort((a,b)=>a.id.localeCompare(b.id));
    if(url.searchParams.has('id'))rows=rows.filter(row=>row.id===url.searchParams.get('id').replace(/^eq\./,''));
    const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||rows.length);
    return route.fulfill({status:200,headers,body:JSON.stringify(rows.slice(offset,offset+limit))});
  }
  const operation=url.pathname.match(/^\/rest\/v1\/rpc\/genie_(save|delete|restore)_project$/)?.[1];
  if(!operation)return false;
  const body=request.postDataJSON();cloud.rpcs.push({operation,...body,headers:request.headers()});
  if(cloud.holdRpc)await cloud.holdRpc(operation,body);
  const invalid=operation==='save'&&(typeof body.p_data?.name!=='string'||typeof body.p_data?.date!=='string'||body.p_data?.id!==body.p_id);
  const tooLarge=operation==='save'&&Buffer.byteLength(JSON.stringify(body.p_data))>=1000000;
  const code=cloud.rpcCode||(invalid?'22023':tooLarge?'23514':null);
  if(code||cloud.rpcStatus!==200)return route.fulfill({status:code==='42501'?403:code?400:cloud.rpcStatus,headers,body:JSON.stringify({code,message:tooLarge?'data too large':'write failed'})});
  let row=cloud.rows.find(row=>row.id===body.p_id),status;
  if(operation==='save'&&body.p_expected_version===0){
    if(row)status='conflict';
    else{row={id:body.p_id,data:structuredClone(body.p_data),version:1,deleted_at:null,updated_at:new Date().toISOString()};cloud.rows.push(row);status='saved';}
  }else if(!row)status='not_found';
  else if(row.version!==body.p_expected_version||operation==='save'&&row.deleted_at)status='conflict';
  else{
    const unchanged=operation==='save'?jsonb(row.data)===jsonb(body.p_data):operation==='delete'?!!row.deleted_at:!row.deleted_at;
    status=unchanged?'unchanged':operation==='save'?'saved':operation==='delete'?'deleted':'restored';
    if(!unchanged){row.version++;if(operation==='save')row.data=structuredClone(body.p_data);else row.deleted_at=operation==='delete'?new Date().toISOString():null;row.updated_at=new Date().toISOString();}
  }
  cloud.results.push({operation,id:body.p_id,status,version:row?.version??null});
  if(cloud.afterRpc)await cloud.afterRpc(operation,body);
  if(cloud.dropResponse){cloud.dropResponse=false;return route.abort('failed');}
  return route.fulfill({status:200,headers,body:JSON.stringify({status,version:row?.version??null})});
}
module.exports={createCloud,cloudRoute};
