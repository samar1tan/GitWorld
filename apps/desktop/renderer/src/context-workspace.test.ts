import test from 'node:test';
import assert from 'node:assert/strict';
import type { NavigationBatchRef, NavigationContextRead, NavigationMembershipPlan, NavigationResumeResult } from '../../../../packages/contracts/src/navigation-types.ts';
import { createContextWorkspace, parseContextInput, type ContextWorkspaceApi } from './context-workspace.ts';
import { ServiceFailure } from './client.ts';
import { validateServiceRequest } from '../../../../packages/contracts/src/validation.ts';

const HEAD='1'.repeat(40), HASH='a'.repeat(64), SET='b'.repeat(64), PREVIEW='c'.repeat(64);
const batch:NavigationBatchRef={kind:'adopted-import',method:'knowledge.fileAdopt',operationId:'fixture-import',inputHash:HASH,objectSetHash:SET,previewId:PREVIEW};
const later=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};};
function fixture(t:{after(fn:()=>void):void}){
  const before=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null,activeElement:null}});t.after(()=>{if(before)Object.defineProperty(globalThis,'document',before);else Reflect.deleteProperty(globalThis,'document');});
  const buffers=new Map<string,string>(),storage={getItem:(key:string)=>buffers.get(key)??null,setItem:(key:string,value:string)=>{buffers.set(key,value);},removeItem:(key:string)=>{buffers.delete(key);}};
  let record:NavigationContextRead|null=null,members=0,hash=HASH,renders=0,views:string[]=[],changed:unknown[]=[],pending:string|null=null;
  const calls:{method:string;input:any}[]=[],receipts=new Map<string,NavigationResumeResult>();let plan:NavigationMembershipPlan|null=null;
  const api:ContextWorkspaceApi={
    async list(input){calls.push({method:'list',input});return {revision:input.revision??'working',head:HEAD,items:record?[{definition:record.definition,contentHash:hash,members}]:[],total:record?1:0,offset:input.offset??0,limit:input.limit??25,counts:{objects:1004,assigned:members,unassigned:1004-members}};},
    async get(input){calls.push({method:'get',input});if(!record||input.contextId!==record.definition.id)throw new ServiceFailure({code:'NOT_FOUND'});return {...record,contentHash:hash,contextHash:hash,total:members};},
    async save(input){calls.push({method:'save',input});assert.ok(validateServiceRequest({protocolVersion:1,requestId:'context-renderer-test',method:'context.save',params:input}).ok);assert.equal(input.expectedHead,HEAD);assert.equal(input.expectedContentHash,record?hash:null);record={definition:{schemaVersion:1,id:record?.definition.id??'context:generated-by-service',labels:input.labels,description:input.description,origin:'user-organization'},contentHash:hash,contextHash:hash,revision:'working',head:HEAD,members:[],total:members,offset:0,limit:10};const result={contextId:record.definition.id,contentHash:hash,head:HEAD,paths:['navigation/contexts/definition.json']};receipts.set(input.operationId,{kind:'save',result});return result;},
    async batches(input){calls.push({method:'batches',input});return {revision:'working',head:HEAD,items:[{batchKey:SET,batch,labels:{en:'Synthetic complete batch','zh-CN':'技术夹具完整批次'},sourceRefs:[],sourceRefCount:0,objects:1004,directObjects:1004,relatedObjects:0,unresolvedObjects:0,status:'complete'}],total:1,offset:0,limit:10};},
    async batchSources(input){return{batch:input.batch,items:[],total:0,offset:input.offset??0,limit:10};},
    async batchObjects(input){calls.push({method:'batchObjects',input});return {batch,objectSetHash:SET,directObjects:1004,relatedObjects:0,items:Array.from({length:10},(_,i)=>({id:'fixture:'+i,labels:{en:'Fixture '+i},basis:'direct' as const})),total:1004,offset:input.offset??0,limit:10};},
    async membershipPlan(input){calls.push({method:'membershipPlan',input});assert.equal(input.expectedDefinitionHash,hash);assert.deepEqual(input.batch,batch);plan={planId:'plan-service',planHash:HASH,baseHead:HEAD,contextId:input.contextId,contextHash:hash,batch,objectSetHash:SET,counts:{selected:1004,already:members,added:1004-members,removed:0,unchanged:members},mode:'add',dependencies:[],paths:['navigation/contexts/members/00.json']};return plan;},
    async plan(input){calls.push({method:'plan',input});assert.ok(plan);const objects=await api.batchObjects({batch,offset:input.offset,limit:input.limit});return {...plan,...objects,planId:plan.planId};},
    async applyMembership(input){calls.push({method:'applyMembership',input});assert.ok(plan);if(plan.contextHash!==hash)throw new ServiceFailure({code:'CONTENT_CHANGED'});assert.equal(input.expectedPlanHash,plan.planHash);members=1004;const result={contextId:plan.contextId,head:HEAD,paths:plan.paths,counts:plan.counts,planId:plan.planId};receipts.set(input.operationId,{kind:'membership',result});return result;},
    async pending(){return pending?[{operationId:pending,kind:'membership',baseHead:HEAD,contextId:record?.definition.id??'context:generated-by-service',planId:'plan-service'}]:[];},
    async resume(input){calls.push({method:'resume',input});const value=receipts.get(input.operationId);if(!value)throw new ServiceFailure({code:'NOT_FOUND'});pending=null;return value;},
  };
  const create=(flushDraft?:()=>Promise<void>,locale:()=> 'en'|'zh-CN'=()=> 'en')=>createContextWorkspace({locale,render:()=>{renders++;},api,storage,flushDraft,onClose:()=>{},onChanged:result=>{changed.push(result);},onViewContext:id=>{views.push(id);}});
  return {api,storage,buffers,calls,create,views,changed,receipts,renders:()=>renders,stale:()=>{hash='d'.repeat(64);},pending:(id:string)=>{pending=id;}};
}
const input=(ui:ReturnType<typeof createContextWorkspace>,key:string,value:string)=>ui.input({dataset:{contextInput:key},value} as HTMLInputElement);
const click=(ui:ReturnType<typeof createContextWorkspace>,action:string,extra={})=>ui.click({dataset:{context:action,...extra}} as HTMLElement);
const save=(ui:ReturnType<typeof createContextWorkspace>)=>ui.submit({dataset:{contextForm:'definition'}} as HTMLFormElement);
async function createContext(ui:ReturnType<typeof createContextWorkspace>){await ui.open();input(ui,'name','A user-organized context');await save(ui);}

test('definition and full batch remain independent writes; a page does not truncate a reviewed plan',async t=>{
  const f=fixture(t),ui=f.create();await createContext(ui);assert.equal(f.calls.filter(v=>v.method==='save').length,1);assert.equal(f.calls.some(v=>v.method==='applyMembership'),false);
  await click(ui,'batch',{index:'0'});await click(ui,'preview');assert.equal(f.calls.find(v=>v.method==='membershipPlan')!.input.batch.objectSetHash,SET);assert.match(ui.content(),/1,004 selected/);assert.equal((ui.content().match(/<li>/g)??[]).length,10);
  await click(ui,'apply');assert.equal(f.calls.find(v=>v.method==='applyMembership')!.input.expectedPlanHash,HASH);assert.equal(f.views.length,0);assert.equal(f.changed.length,2);assert.equal(ui.hasUnsavedChanges(),false);
  await click(ui,'view',{id:'context:generated-by-service'});assert.deepEqual(f.views,['context:generated-by-service']);
});

test('a completed membership view does not masquerade as an unsaved definition when starting another context',async t=>{
  const f=fixture(t),ui=f.create();await createContext(ui);assert.equal(f.calls.find(v=>v.method==='save')!.input.description,undefined);await click(ui,'batch',{index:'0'});await click(ui,'preview');await click(ui,'apply');
  await ui.open({});assert.doesNotMatch(ui.content(),/Another context draft/);assert.match(ui.content(),/<h1>New context<\/h1>/);assert.equal(ui.hasUnsavedChanges(),false);
});

test('a stale membership plan cannot be applied and keeps the chosen complete batch for explicit re-review',async t=>{
  const f=fixture(t),ui=f.create();await createContext(ui);await click(ui,'batch',{index:'0'});await click(ui,'preview');f.stale();await click(ui,'apply');assert.match(ui.content(),/Review a new preview/);assert.equal(f.changed.length,1);assert.equal(ui.hasUnsavedChanges(),false);
  await click(ui,'retry');await click(ui,'preview');assert.equal(f.calls.filter(v=>v.method==='membershipPlan').length,2);await click(ui,'apply');assert.equal(f.changed.length,2);
});

test('normal writing shows progress; an uncertain result resumes the original operation after reopening',async t=>{
  const f=fixture(t),ui=f.create();await createContext(ui);await click(ui,'batch',{index:'0'});await click(ui,'preview');const gate=later<any>(),original=f.api.applyMembership;f.api.applyMembership=async request=>{const result=await original(request);f.pending(request.operationId);await gate.promise;throw new ServiceFailure({code:'IO_ERROR'});};
  const writing=click(ui,'apply');await Promise.resolve();assert.match(ui.content(),/Working…/);assert.doesNotMatch(ui.content(),/result of this write is not confirmed/);gate.resolve(null);await writing;assert.match(ui.content(),/result of this write is not confirmed/);const attempt=parseContextInput(f.storage.getItem('gitworld-context-input-v1'))!.attemptId!;assert.ok(attempt);ui.hide();
  const reopened=f.create();await reopened.resume();await click(reopened,'check');assert.equal(f.calls.filter(v=>v.method==='applyMembership').length,1);assert.equal(f.calls.find(v=>v.method==='resume')!.input.operationId,attempt);assert.match(reopened.content(),/Membership saved/);assert.equal(f.views.length,0);
});

test('draft input survives leaving, and replacement requires an explicit discard',async t=>{
  const f=fixture(t),ui=f.create();await ui.open();input(ui,'name','Unfinished name');input(ui,'purpose','A purpose');assert.equal((await ui.prepareClose()).ready,true);ui.hide();const restored=f.create();await restored.resume();assert.match(restored.content(),/Unfinished name/);assert.equal(restored.hasUnsavedChanges(),true);
  await restored.open({contextId:'another'});assert.match(restored.content(),/Another context draft/);await click(restored,'keep');assert.match(restored.content(),/Unfinished name/);assert.equal(f.calls.filter(v=>v.method==='save').length,0);
  await click(restored,'discard');await click(restored,'discard-confirm');assert.doesNotMatch(restored.content(),/Unfinished name/);assert.equal(f.calls.filter(v=>v.method==='save').length,0);
});

test('keeping a recovered draft while another target is requested loads its original edit base',async t=>{
  const f=fixture(t),first=f.create();await first.open();input(first,'name','Keep the original');await first.prepareClose();first.hide();
  const reopened=f.create();await reopened.open({contextId:'another-target'});assert.match(reopened.content(),/Another context draft/);await click(reopened,'keep');await save(reopened);assert.equal(f.calls.filter(v=>v.method==='save').length,1);assert.equal(f.calls.find(v=>v.method==='save')!.input.labels.en,'Keep the original');
});

test('a failed recovery-buffer flush prevents a domain write without inventing an uncertain operation',async t=>{
  const f=fixture(t),ui=f.create(async()=>{throw new Error('Disk unavailable');});await ui.open();input(ui,'name','Keep my input');await save(ui);assert.equal(f.calls.some(v=>v.method==='save'),false);assert.match(ui.content(),/input recovery copy could not be saved/);assert.doesNotMatch(ui.content(),/result of this write is not confirmed/);assert.equal(parseContextInput(f.storage.getItem('gitworld-context-input-v1'))!.name,'Keep my input');
});

test('an adopted-result identity filters actual receipts without deriving a batch from displayed samples',async t=>{
  const f=fixture(t),ui=f.create();await ui.open({importIdentity:{inputHash:HASH,previewId:PREVIEW}});const request=f.calls.find(v=>v.method==='batches')!.input;assert.equal(request.inputHash,HASH);assert.equal(request.previewId,PREVIEW);assert.equal(request.limit,10);assert.equal(f.calls.some(v=>v.method==='applyMembership'),false);
});

test('a slow initial pending read cannot revive a hidden editor or redraw a newer investigation',async t=>{
  const f=fixture(t),gate=later<[]>();f.api.pending=()=>gate.promise;const ui=f.create(),opening=ui.open();ui.hide();const count=f.renders();gate.resolve([]);await opening;assert.equal(f.renders(),count);assert.equal(ui.content(),'');assert.equal(f.calls.some(v=>v.method==='batches'),false);
});

test('complete source pins are paged independently; failed and late pages do not erase the current selection',async t=>{
  const f=fixture(t),pins=Array.from({length:31},(_,i)=>({sourceId:'source:'+i,revision:'r1',contentHash:HASH}));
  let fail=false;const gate=later<any>();let delayed=false;
  f.api.batchSources=async request=>{f.calls.push({method:'batchSources',input:request});if(delayed)return gate.promise;if(fail)throw new ServiceFailure({code:'IO_ERROR'});return {batch:request.batch,items:pins.slice(request.offset??0,(request.offset??0)+10),total:31,offset:request.offset??0,limit:10};};
  const ui=f.create();await createContext(ui);await click(ui,'batch',{index:'0'});await click(ui,'source-pins');assert.match(ui.content(),/1–10 of 31/);assert.match(ui.content(),/source:0/);fail=true;await click(ui,'pins-page',{offset:'10'});assert.match(ui.content(),/1–10 of 31/);assert.match(ui.content(),/source:0/);fail=false;await click(ui,'retry');assert.match(ui.content(),/11–20 of 31/);
  delayed=true;const reading=click(ui,'pins-page',{offset:'20'});await click(ui,'mode-remove');gate.resolve({batch,items:pins.slice(20,30),total:31,offset:20,limit:10});await reading;assert.doesNotMatch(ui.content(),/source:20/);assert.equal(f.calls.filter(v=>v.method==='applyMembership').length,0);
});

for(const locale of ['en','zh-CN'] as const)test(`batch search and kind filters keep a complete selection through pages and editor restart (${locale})`,async t=>{
  const f=fixture(t),whole={batchKey:SET,batch,labels:{en:HASH},providers:['wikipedia-en'],sourceRefs:[],sourceRefCount:37,objects:1004,directObjects:1004,relatedObjects:0,unresolvedObjects:0,status:'complete' as const};
  const rows=[whole,...Array.from({length:22},(_,i)=>({...whole,batchKey:String(i),labels:{en:'Saved source '+i},batch:{kind:'saved-source' as const,selection:'source-claim-subjects' as const,revision:'working',sourceId:'source:'+i,sourceRevision:'r1',sourceHash:HASH,selectionHash:HASH,objectSetHash:SET},objects:1,directObjects:1}))];
  f.api.batches=async request=>{f.calls.push({method:'batches',input:request});const items=request.text==='estuary'&&request.kind==='adopted-import'?[whole]:rows;return {revision:'working',head:HEAD,items:items.slice(request.offset??0,(request.offset??0)+(request.limit??10)),total:items.length,offset:request.offset??0,limit:request.limit??10};};
  const ui=f.create(undefined,()=>locale);await createContext(ui);assert.doesNotMatch(ui.content(),new RegExp('<strong>'+HASH+'</strong>'));
  input(ui,'batch-search','estuary');await ui.change({dataset:{contextInput:'batch-kind'},value:'adopted-import'} as HTMLSelectElement);await ui.submit({dataset:{contextForm:'batch-search'}} as HTMLFormElement);
  const read=f.calls.filter(value=>value.method==='batches').at(-1)!.input;assert.equal(read.text,'estuary');assert.equal(read.kind,'adopted-import');assert.equal(read.offset,0);
  assert.equal(validateServiceRequest({protocolVersion:1,requestId:'batch-filter',method:'context.batches',params:read}).ok,true);
  await click(ui,'batch',{index:'0'});await click(ui,'preview');await click(ui,'members-page',{offset:'10'});
  assert.equal(f.calls.filter(value=>value.method==='membershipPlan').at(-1)!.input.batch.objectSetHash,SET);assert.equal(f.calls.filter(value=>value.method==='plan').at(-1)!.input.offset,10);
  await ui.prepareClose();ui.hide();const reopened=f.create(undefined,()=>locale);await reopened.resume();
  const restored=f.calls.filter(value=>value.method==='batches').at(-1)!.input;assert.equal(restored.text,'estuary');assert.equal(restored.kind,'adopted-import');
  await click(reopened,'preview');assert.equal(f.calls.filter(value=>value.method==='membershipPlan').at(-1)!.input.batch.objectSetHash,SET);
  assert.equal(f.calls.some(value=>value.method==='applyMembership'),false);
});

test('failed or superseded batch reads keep the visible page, current filters and fixed selection',async t=>{
  const f=fixture(t),ui=f.create();await createContext(ui);await click(ui,'batch',{index:'0'});
  const original=f.api.batches,gate=later<any>();f.api.batches=async request=>{
    f.calls.push({method:'batches-gated',input:request});if(request.text==='slow')return gate.promise;if(request.text==='failed')throw new ServiceFailure({code:'IO_ERROR'});
    const value=await original(request);return {...value,items:value.items.map(item=>({...item,labels:{en:'Current readable batch'}}))};
  };
  input(ui,'batch-search','slow');const old=ui.submit({dataset:{contextForm:'batch-search'}} as HTMLFormElement);await Promise.resolve();
  input(ui,'batch-search','current');await ui.submit({dataset:{contextForm:'batch-search'}} as HTMLFormElement);gate.resolve({revision:'working',head:HEAD,items:[],total:0,offset:0,limit:10});await old;
  assert.match(ui.content(),/Current readable batch/);assert.doesNotMatch(ui.content(),/No material batches match/);
  input(ui,'batch-search','failed');await ui.submit({dataset:{contextForm:'batch-search'}} as HTMLFormElement);assert.match(ui.content(),/Current readable batch/);assert.match(ui.content(),/Your input is kept/);
  await click(ui,'preview');assert.deepEqual(f.calls.filter(value=>value.method==='membershipPlan').at(-1)!.input.batch,batch);
});

test('saving an explicitly entered Chinese name preserves that locale value while an English interface uses its English heading',async t=>{
  const f=fixture(t),ui=f.create();await createContext(ui);await ui.change({dataset:{contextInput:'language'},value:'zh-CN'} as HTMLSelectElement);
  input(ui,'name','古代地理来源观测');input(ui,'purpose','比较有日期的来源观测。');await save(ui);
  const request=f.calls.filter(value=>value.method==='save').at(-1)!.input;assert.deepEqual(request.labels,{en:'A user-organized context','zh-CN':'古代地理来源观测'});
  assert.equal(request.description['zh-CN'],'比较有日期的来源观测。');assert.match(ui.content(),/<h1>A user-organized context<\/h1>/);assert.match(ui.content(),/value="zh-CN" selected/);assert.match(ui.content(),/value="古代地理来源观测"/);
});
