import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalService } from './index.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import type { WikipediaMappingSelection } from '../../contracts/src/wikipedia-types.ts';
import { validateWikipediaWorkspaceDirectory } from './wikipedia-workspace.ts';
import { mapWikipediaProfile, wikipediaHash as hash } from '../../ingestion/src/wikipedia-profiles.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createKnowledgeStore } from './knowledge-store.ts';
import { createKnowledgeImports } from './knowledge-imports.ts';
import { previewKnowledgeCollectionFile } from './knowledge-collection-files.ts';

const binary=path.resolve('.local/bundled-git/runtime/bin/git'),native={skip:!existsSync(binary)&&'Prepare bundled Git runtime'},git={gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core')};
const html='<h2>A source scope</h2><table class="wikitable"><tr><th>Name</th><th>Term</th></tr><tr><td><a href="/wiki/Recorded_A">Recorded A</a></td><td>1900–1902</td></tr><tr><td><a href="/wiki/Recorded_B">Recorded B</a></td><td>1903–1905</td></tr></table>';
let sequence=0;
async function response<M extends ServiceMethod>(service:Awaited<ReturnType<typeof createLocalService>>,method:M,params:ServiceMethods[M]['params']){return service.dispatch({protocolVersion:1,requestId:'wikipedia-'+(++sequence),method,params}as ServiceRequest);}
async function call<M extends ServiceMethod>(service:Awaited<ReturnType<typeof createLocalService>>,method:M,params:ServiceMethods[M]['params']):Promise<ServiceMethods[M]['result']>{const result=await response(service,method,params);assert.ok(result.ok,JSON.stringify(result));return result.result as ServiceMethods[M]['result'];}
function mock(options:{rights?:boolean;parse?:(url:URL)=>Response;metadata?:(url:URL)=>Response}={}){const calls:URL[]=[];const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input));calls.push(url);assert.equal(url.origin,'https://en.wikipedia.org');assert.equal(url.pathname,'/w/api.php');assert.equal(init?.redirect,'error');if(url.searchParams.get('action')==='query')return options.metadata?.(url)??Response.json({query:{...(options.rights?{rightsinfo:{url:'https://creativecommons.org/licenses/by-sa/4.0/'}}:{}),pages:[{pageid:31,title:'A source-selected table',revisions:[{revid:77}]}]}});return options.parse?.(url)??Response.json({parse:{pageid:31,title:'A source-selected table',revid:Number(url.searchParams.get('oldid')),text:html}});};return{fetcher,calls};}
async function fixture(t:{after(fn:()=>unknown):void},fetcher:typeof fetch,files?:Map<string,string>){const directory=await mkdtemp(path.join(tmpdir(),'gitworld-wikipedia-service-')),library=path.join(directory,'library');let available=true,forbiddenReads=0;const options={dataDirectory:library,...git,sourceFetch:fetcher,resolveFileToken(token:string,purpose:string){const file=files?.get(token);if(file&&(purpose==='backup'||purpose==='restore'))return file;forbiddenReads++;throw Error('Wikipedia workflow has no selected file token');}};let service=await createLocalService(options);t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});return{directory,library,get service(){return service;},forbiddenReads:()=>forbiddenReads,async restart(sourceFetch:typeof fetch=fetcher){await service.close();service=await createLocalService({...options,sourceFetch});return service;},async prepare(){const job=await call(service,'wikipedia.collect',{title:'A source-selected table',operationId:'source-job'});assert.equal(job.receipt.status,'complete');const inspection=await call(service,'wikipedia.inspect',{jobId:job.id});const status=await call(service,'repository.status',{}),selection:WikipediaMappingSelection={profileId:'office-tenures-v1',tables:[{tableIndex:0,headerHash:inspection.tables[0].headerHash,holderColumn:0,tenureColumn:1}]};const preview=await call(service,'wikipedia.preview',{jobId:job.id,sourceHash:job.source!.contentHash,expectedHead:status.head,selection});const adopt={jobId:job.id,previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'unreviewed'as const,operationId:'adopt-wikipedia'};return{job,inspection,preview,adopt,selection};}};}
test('ordinary service acquires one fixed page and adopts a profile into true Git, state, vocabulary and source evidence',native,async t=>{
  const source=mock(),f=await fixture(t,source.fetcher),p=await f.prepare();assert.equal(source.calls.length,2);assert.equal(source.calls[1].searchParams.get('oldid'),'77');
  assert.deepEqual(await call(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:'source-job'}),p.job);assert.equal(source.calls.length,2);assert.equal((await call(f.service,'wikipedia.jobs',{})).jobs.length,1);
  assert.equal(p.inspection.tables[0].rows,2);assert.equal(p.preview.counts.sourceRows,2);assert.equal(p.preview.counts.mappedRows,2);assert.equal(p.preview.counts.timedRows,2);assert.equal(p.preview.counts.assertions,4);assert.equal(p.preview.preview.vocabulary!.catalog.types.find(v=>v.id==='gitworld:source-tenure-scope')!.labels['zh-CN'],'来源年表分组');
  const adopted=await call(f.service,'wikipedia.adopt',p.adopt);assert.equal((await call(f.service,'repository.status',{})).head,p.adopt.expectedHead);assert.equal((await call(f.service,'repository.status',{})).staged.length,0);
  const query=await call(f.service,'knowledge.query',{query:{typeIds:['gitworld:source-tenure-scope'],includeUndated:true,includeUnlocated:true}}),scope=query.objects[0];assert.ok(scope);const state=await call(f.service,'knowledge.state',{state:{objectId:scope.id,year:1901,includeUnreviewed:true}});assert.equal(state.fields.find(v=>v.propertyId==='office:holder')!.status,'known');
  const detail=await call(f.service,'knowledge.object',{objectId:scope.id});assert.equal(detail.display!.types['gitworld:source-tenure-scope']['zh-CN'],'来源年表分组');assert.ok(detail.sources.every(s=>s.rights.redistribution==='unknown'));assert.ok(detail.sources.every(s=>!('record'in s)));assert.equal(f.forbiddenReads(),0);
  await call(f.service,'repository.stage',{paths:adopted.paths!});const status=await call(f.service,'repository.status',{});await call(f.service,'repository.commit',{operationId:'commit-wikipedia',expectedHead:status.head,expectedTree:status.stagedTree,message:'Adopt a source-selected table'});
  const stale=await response(f.service,'wikipedia.adopt',{...p.adopt,operationId:'new-late-adoption'});assert.ok(!stale.ok&&stale.error.code==='HEAD_CHANGED');assert.deepEqual(await call(f.service,'wikipedia.adopt',p.adopt),adopted);
});
test('Wikipedia paired updates retain visible three-way conflicts, resolve explicitly and re-preview the complete mapping before staging',native,async t=>{
  for(const choice of ['local','incoming']as const)await t.test(choice,async sub=>{
    const changed=html.replace('1900–1902','1900–1904').replace('</table>','<tr><td><a href="/wiki/Recorded_C">Recorded C</a></td><td>1906–1908</td></tr></table>');
    const source=mock({parse:url=>Response.json({parse:{pageid:31,title:'A source-selected table',revid:Number(url.searchParams.get('oldid')),text:url.searchParams.get('oldid')==='78'?changed:html}})}),f=await fixture(sub,source.fetcher),first=await f.prepare();
    const initial=await call(f.service,'wikipedia.adopt',first.adopt);await call(f.service,'repository.stage',{paths:initial.paths!});let status=await call(f.service,'repository.status',{});
    const committed=await call(f.service,'repository.commit',{operationId:'baseline',expectedHead:status.head,expectedTree:status.stagedTree,message:'Record the first source mapping'});
    const scopes=await call(f.service,'knowledge.query',{query:{typeIds:['gitworld:source-tenure-scope'],includeUndated:true,includeUnlocated:true}}),scope=scopes.objects[0].id,objectFile=`objects/${hash(scope)}.json`;
    const context=await call(f.service,'knowledge.editContext',{objectId:scope}),original=context.object!.assertions.find(claim=>claim.propertyId==='office:holder'&&claim.validTime?.start?.earliestYear===1900)!;
    await call(f.service,'knowledge.saveEdit',{operationId:'local-date-review',objectId:scope,assertionId:original.id,expectedHead:context.head,expectedObjectHash:context.objectHash,change:{mode:'correct',propertyId:original.propertyId,validTime:{...original.validTime!,end:{...original.validTime!.end!,earliestYear:1903,latestYear:1903}},evidence:{sourceId:original.sourceSnapshotId,locator:'Local date review'},review:'unreviewed',reason:'Keep the locally reviewed end date until the new source is reviewed'}});
    const local=await call(f.service,'knowledge.object',{objectId:scope}),catalogBefore=(await call(f.service,'knowledge.editContext',{objectId:scope})).catalog;
    const stagedPlan=await call(f.service,'repository.stagePlan',{paths:[objectFile]});await call(f.service,'repository.stage',{paths:[...new Set([...stagedPlan.selected,...stagedPlan.required])]});const stagedBefore=(await call(f.service,'repository.status',{})).stagedTree;
    const job=await call(f.service,'wikipedia.collect',{title:'A source-selected table',revision:78,operationId:'updated-source'});
    const prepare=async()=>{const head=(await call(f.service,'repository.status',{})).head;return call(f.service,'wikipedia.preview',{jobId:job.id,sourceHash:job.source!.contentHash,expectedHead:head,selection:first.selection});};
    const preview=await prepare(),attempt={jobId:job.id,previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'unreviewed'as const,operationId:'review-updated-source'};
    const report=await call(f.service,'wikipedia.adopt',attempt);
    assert.equal(report.conflicts.length,1);assert.equal(report.conflicts[0].objectId,scope);assert.deepEqual(report.changedObjects,[]);assert.deepEqual(report.unchangedObjects,[]);
    assert.ok(report.paths!.every(name=>name.startsWith('sources/')||name.startsWith('mappings/conflict-')));
    assert.deepEqual((await call(f.service,'knowledge.object',{objectId:scope})).assertions,local.assertions);
    assert.deepEqual((await call(f.service,'knowledge.editContext',{objectId:scope})).catalog,catalogBefore);
    assert.equal((await call(f.service,'knowledge.query',{query:{text:'Recorded C',includeUndated:true,includeUnlocated:true}})).total,0);
    assert.deepEqual(report.continuation,{kind:'wikipedia-mapping',jobId:job.id});assert.deepEqual(await call(f.service,'knowledge.conflicts',{}),report.conflicts.map(value=>({...value,continuation:report.continuation})));assert.deepEqual(await call(f.service,'knowledge.pendingImports',{}),[]);
    assert.equal((await call(f.service,'repository.status',{})).stagedTree,stagedBefore);
    assert.ok((await call(f.service,'repository.stagePlan',{paths:[objectFile]})).incomplete!.includes(objectFile));
    let refused=await response(f.service,'repository.stage',{paths:[objectFile]});assert.ok(!refused.ok&&refused.error.code==='REVIEW_REQUIRED');
    refused=await response(f.service,'knowledge.resolve',{objectId:scope,choice,expectedHead:'0'.repeat(40)});assert.ok(!refused.ok&&refused.error.code==='HEAD_CHANGED');
    await call(f.service,'knowledge.resolve',{objectId:scope,choice,expectedHead:attempt.expectedHead});assert.deepEqual(await call(f.service,'knowledge.conflicts',{}),[]);
    const resolved=await call(f.service,'knowledge.object',{objectId:scope});assert.deepEqual(resolved.assertions,choice==='local'?local.assertions:report.conflicts[0].incoming.assertions);
    refused=await response(f.service,'repository.stage',{paths:[objectFile]});assert.ok(!refused.ok&&refused.error.code==='REVIEW_REQUIRED');
    refused=await response(f.service,'repository.commit',{operationId:'cannot-commit-half-pair',expectedHead:attempt.expectedHead,expectedTree:stagedBefore,message:'Wait for the complete mapping'});assert.ok(!refused.ok&&refused.error.code==='REVIEW_REQUIRED');assert.equal((await call(f.service,'repository.status',{})).stagedTree,stagedBefore);
    await f.restart(async()=>{throw Error('The reviewed source must be reused offline');});
    assert.deepEqual(await call(f.service,'wikipedia.adopt',attempt),report);assert.deepEqual((await call(f.service,'knowledge.object',{objectId:scope})).assertions,resolved.assertions);
    const stale=await response(f.service,'wikipedia.adopt',{...attempt,operationId:'old-preview-after-resolution'});assert.ok(!stale.ok&&stale.error.code==='CONTENT_CHANGED');
    const otherRecipe=await call(f.service,'wikipedia.preview',{jobId:job.id,sourceHash:job.source!.contentHash,expectedHead:attempt.expectedHead,selection:{profileId:'dated-entries-v1',tableIndex:0,headerHash:first.inspection.tables[0].headerHash,timeColumn:1,columns:[{column:0,kind:'text'}]}});
    const other=await call(f.service,'wikipedia.adopt',{...attempt,operationId:'adopt-a-different-recipe',previewId:otherRecipe.preview.prepared!.id,expectedInputHash:otherRecipe.preview.inputHash});assert.deepEqual(other.conflicts,[]);
    refused=await response(f.service,'repository.stage',{paths:[objectFile]});assert.ok(!refused.ok&&refused.error.code==='REVIEW_REQUIRED');
    const reviewed=await prepare();assert.notEqual(reviewed.preview.prepared!.id,attempt.previewId);
    const accepted=await call(f.service,'wikipedia.adopt',{...attempt,previewId:reviewed.preview.prepared!.id,expectedHead:reviewed.preview.prepared!.baseHead,expectedInputHash:reviewed.preview.inputHash,operationId:'adopt-reviewed-pair'});
    assert.deepEqual(accepted.conflicts,[]);assert.equal((await call(f.service,'knowledge.query',{query:{text:'Recorded C',includeUndated:true,includeUnlocated:true}})).total,1);
    assert.deepEqual((await call(f.service,'knowledge.object',{objectId:scope})).assertions,resolved.assertions);
    status=await call(f.service,'repository.status',{});const paths=status.unstaged.map(value=>value.path);assert.equal((await call(f.service,'repository.stagePlan',{paths})).incomplete,undefined);
    await call(f.service,'repository.stage',{paths});status=await call(f.service,'repository.status',{});const final=await call(f.service,'repository.commit',{operationId:'commit-reviewed-pair',expectedHead:status.head,expectedTree:status.stagedTree,message:'Resolve the source update and adopt its complete mapping'});
    await f.restart(async()=>{throw Error('No network after commit');});assert.deepEqual((await call(f.service,'knowledge.object',{objectId:scope,revision:final.oid})).assertions,resolved.assertions);
    assert.equal((await call(f.service,'knowledge.object',{objectId:scope,revision:committed.oid})).assertions.find(claim=>claim.id===original.id)!.validTime!.end!.earliestYear,1902);
    assert.deepEqual(await call(f.service,'wikipedia.adopt',attempt),report);assert.equal(f.forbiddenReads(),0);assert.equal(source.calls.length,4);
  });
});
test('only a later complete receipt can supersede a new review after checkout, branch, restart and full backup restore',native,async t=>{
  const changed=html.replace('1900–1902','1900–1904').replace('</table>','<tr><td><a href="/wiki/Recorded_C">Recorded C</a></td><td>1906–1908</td></tr></table>');
  const source=mock({parse:url=>Response.json({parse:{pageid:31,title:'A source-selected table',revid:Number(url.searchParams.get('oldid')),text:url.searchParams.get('oldid')==='78'?changed:html}})}),files=new Map<string,string>(),f=await fixture(t,source.fetcher,files),first=await f.prepare();
  async function commit(operationId:string){const status=await call(f.service,'repository.status',{});await call(f.service,'repository.stage',{paths:status.unstaged.map(value=>value.path)});const frozen=await call(f.service,'repository.status',{});return call(f.service,'repository.commit',{operationId,expectedHead:frozen.head,expectedTree:frozen.stagedTree,message:'Synthetic review '+operationId});}
  await call(f.service,'wikipedia.adopt',first.adopt);const a=await commit('first-A');
  const job=await call(f.service,'wikipedia.collect',{title:'A source-selected table',revision:78,operationId:'source-B'});
  const prepare=async()=>call(f.service,'wikipedia.preview',{jobId:job.id,sourceHash:job.source!.contentHash,expectedHead:(await call(f.service,'repository.status',{})).head,selection:first.selection});
  const input=(preview:Awaited<ReturnType<typeof prepare>>,operationId:string)=>({jobId:job.id,operationId,previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'unreviewed'as const});
  const earlier=await prepare(),oldInput=input(earlier,'past-complete-B'),oldSuccess=await call(f.service,'wikipedia.adopt',oldInput);await commit('past-B');
  await call(f.service,'repository.checkout',{oid:a.oid});await call(f.service,'repository.branch',{name:'repeat-review'});await call(f.service,'repository.switch',{name:'repeat-review'});
  const scope=(await call(f.service,'knowledge.query',{query:{typeIds:['gitworld:source-tenure-scope'],includeUndated:true,includeUnlocated:true}})).objects[0].id,objectFile=`objects/${hash(scope)}.json`;
  const context=await call(f.service,'knowledge.editContext',{objectId:scope}),claim=context.object!.assertions.find(value=>value.propertyId==='office:holder'&&value.validTime?.start?.earliestYear===1900)!;
  await call(f.service,'knowledge.saveEdit',{operationId:'new-local-C',objectId:scope,assertionId:claim.id,expectedHead:context.head,expectedObjectHash:context.objectHash,change:{mode:'correct',propertyId:claim.propertyId,validTime:{...claim.validTime!,end:{...claim.validTime!.end!,earliestYear:1903,latestYear:1903}},evidence:{sourceId:claim.sourceSnapshotId,locator:'Repeated review'},review:'unreviewed',reason:'Review the same source after returning to A'}});
  const next=await prepare(),reviewInput=input(next,'new-review-B'),report=await call(f.service,'wikipedia.adopt',reviewInput);assert.equal(report.conflicts.length,1);assert.equal(next.preview.inputHash,earlier.preview.inputHash);
  const blocked=async()=>{assert.ok((await call(f.service,'repository.stagePlan',{paths:[objectFile]})).incomplete!.includes(objectFile));const status=await call(f.service,'repository.status',{}),stage=await response(f.service,'repository.stage',{paths:status.unstaged.map(value=>value.path)});assert.ok(!stage.ok&&stage.error.code==='REVIEW_REQUIRED');};
  await blocked();await call(f.service,'knowledge.resolve',{objectId:scope,choice:'incoming',expectedHead:a.oid});await blocked();
  assert.equal((await call(f.service,'knowledge.query',{query:{text:'Recorded C',includeUndated:true,includeUnlocated:true}})).total,0);
  await f.restart(async()=>{throw Error('Only retained material is available');});assert.deepEqual(await call(f.service,'wikipedia.adopt',oldInput),oldSuccess);await blocked();
  files.set('review-backup',path.join(f.directory,'review.gitworld'));await call(f.service,'backup.create',{fileToken:'review-backup',operationId:'backup-review'});
  const full=await prepare();await call(f.service,'wikipedia.adopt',input(full,'first-later-full-B'));assert.equal((await call(f.service,'repository.stagePlan',{paths:[objectFile]})).incomplete,undefined);
  await call(f.service,'backup.restore',{fileToken:'review-backup',operationId:'restore-review'});await blocked();assert.deepEqual(await call(f.service,'wikipedia.adopt',reviewInput),report);
  const pending=await prepare(),pendingInput=input(pending,'later-full-lost-ack'),database=new DatabaseSync(path.join(f.library,'knowledge-imports.sqlite'));
  database.exec("CREATE TRIGGER lose_completion BEFORE UPDATE OF result ON operations BEGIN SELECT RAISE(FAIL,'Lost complete-pair acknowledgement'); END");
  const failed=await response(f.service,'wikipedia.adopt',pendingInput);assert.ok(!failed.ok&&failed.error.code==='IO_ERROR');database.exec('DROP TRIGGER lose_completion');
  const prepared=JSON.parse((database.prepare('SELECT prepared FROM operations WHERE id=?').get(pendingInput.operationId)as{prepared:string}).prepared),reviewed=JSON.parse((database.prepare('SELECT prepared FROM operations WHERE id=?').get(reviewInput.operationId)as{prepared:string}).prepared);database.close();
  assert.deepEqual(prepared.supersedes,[{operationId:reviewInput.operationId,preparedHash:reviewed.hash}]);assert.equal(prepared.result.continuation,undefined);
  await f.restart(async()=>{throw Error('No network during receipt recovery');});assert.equal((await call(f.service,'knowledge.pendingImports',{})).length,1);
  const accepted=await call(f.service,'knowledge.resumeImport',{operationId:pendingInput.operationId,previewId:pendingInput.previewId});assert.deepEqual(accepted.conflicts,[]);assert.equal((await call(f.service,'repository.stagePlan',{paths:[objectFile]})).incomplete,undefined);
  assert.equal((await call(f.service,'knowledge.query',{query:{text:'Recorded C',includeUndated:true,includeUnlocated:true}})).total,1);await commit('complete-current-B');
  assert.deepEqual(await call(f.service,'wikipedia.adopt',reviewInput),report);assert.equal(source.calls.length,4);assert.equal(f.forbiddenReads(),0);
});
test('controlled HTTP 429 holds its original Retry-After deadline across restart and cancellation without duplicate adoption',native,async t=>{
  for(const phase of ['metadata','parse']as const)await t.test(phase,async sub=>{
    sub.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,25)});
    let requests=0;
    const limited=()=>new Response('',{status:429,headers:{'Retry-After':'7'}});
    const source=mock(phase==='metadata'?{metadata:()=>++requests===1?limited():Response.json({query:{pages:[{pageid:31,title:'A source-selected table',revisions:[{revid:77}]}]}})}:{parse:url=>++requests===1?limited():Response.json({parse:{pageid:31,revid:Number(url.searchParams.get('oldid')),title:'A source-selected table',text:html}})});
    const f=await fixture(sub,source.fetcher),before=await call(f.service,'repository.status',{}),input={title:'A source-selected table',revision:77};
    const first=await call(f.service,'wikipedia.collect',{...input,operationId:'controlled-429'}),fetches=source.calls.length;
    const attempts=async()=>(await readdir(path.join(f.library,'wikipedia-workspace',first.id))).filter(name=>name.startsWith('attempt-')).sort();
    const originalAttempts=await attempts();assert.equal(originalAttempts.length,1);
    assert.equal(first.receipt.status,'partial');assert.deepEqual(first.receipt.issues,[{code:'RATE_LIMITED',retryable:true,status:429,retryAfterMs:7000}]);assert.equal(first.source,undefined);
    assert.equal(fetches,phase==='metadata'?1:2);
    const incomplete=await response(f.service,'wikipedia.inspect',{jobId:first.id});assert.ok(!incomplete.ok&&incomplete.error.code==='REVIEW_REQUIRED');
    assert.deepEqual(await call(f.service,'repository.status',{}),before);assert.equal(await call(f.service,'clientState.load',{key:'onboarding'}),null);
    const retry=(operationId:string)=>call(f.service,'wikipedia.collect',{...input,operationId,resumeJobId:first.id});
    const cancelRetry=async(operationId:string)=>{
      const pending=response(f.service,'wikipedia.collect',{...input,operationId,resumeJobId:first.id});
      assert.equal((await call(f.service,'operation.cancel',{operationId})).cancelled,true);
      const cancelled=await pending;assert.ok(cancelled.ok);assert.deepEqual(cancelled.result,first);
      assert.equal(source.calls.length,fetches);assert.deepEqual(await attempts(),originalAttempts);
    };
    assert.deepEqual(await retry('too-soon-before-restart'),first);assert.equal(source.calls.length,fetches);
    await cancelRetry('cancel-before-restart');
    await f.restart();const recovered=await call(f.service,'wikipedia.jobs',{});assert.equal(recovered.total,1);assert.deepEqual(recovered.jobs[0],first);
    sub.mock.timers.tick(6999);
    assert.deepEqual(await retry('one-ms-before-deadline'),first);assert.equal(source.calls.length,fetches);assert.deepEqual(await attempts(),originalAttempts);
    await cancelRetry('cancel-after-restart');
    sub.mock.timers.tick(1);
    const complete=await retry('resume-controlled-429');assert.equal(complete.id,first.id);assert.equal(complete.receipt.status,'complete');assert.equal(complete.source!.revision,'77');
    assert.equal(source.calls.filter(url=>url.searchParams.get('action')==='query').length,phase==='metadata'?2:1);
    assert.deepEqual(source.calls.filter(url=>url.searchParams.get('action')==='parse').map(url=>url.searchParams.get('oldid')),phase==='metadata'?['77']:['77','77']);
    assert.deepEqual(await call(f.service,'repository.status',{}),before);assert.equal(await call(f.service,'clientState.load',{key:'onboarding'}),null);
    assert.equal((await attempts()).length,2);
    const inspection=await call(f.service,'wikipedia.inspect',{jobId:first.id});
    const preview=await call(f.service,'wikipedia.preview',{jobId:first.id,sourceHash:complete.source!.contentHash,expectedHead:before.head,selection:{profileId:'office-tenures-v1',tables:[{tableIndex:0,headerHash:inspection.tables[0].headerHash,holderColumn:0,tenureColumn:1}]}});
    const adopt={jobId:first.id,previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'unreviewed'as const,operationId:'adopt-after-controlled-429'};
    const adopted=await call(f.service,'wikipedia.adopt',adopt),after=await call(f.service,'repository.status',{});assert.ok(after.unstaged.length>0);assert.equal(after.head,before.head);assert.equal(after.staged.length,0);
    await f.restart(async()=>{throw Error('Controlled offline transport after adoption');});
    assert.deepEqual(await retry('resume-controlled-429'),complete);assert.deepEqual(await call(f.service,'wikipedia.adopt',adopt),adopted);assert.deepEqual(await call(f.service,'repository.status',{}),after);
    assert.equal((await call(f.service,'wikipedia.jobs',{})).total,1);assert.equal(source.calls.length,3);assert.equal((await attempts()).length,2);
  });
});
test('source, headers, profile and HEAD cannot be exchanged under a prepared preview',native,async t=>{
  const source=mock({rights:true}),f=await fixture(t,source.fetcher),p=await f.prepare(),base={jobId:p.job.id,sourceHash:p.job.source!.contentHash,expectedHead:p.adopt.expectedHead,selection:p.selection};
  for(const params of [{...base,sourceHash:'0'.repeat(64)},{...base,selection:{...p.selection,tables:[{...(p.selection as any).tables[0],headerHash:'0'.repeat(64)}]}}]){const rejected=await response(f.service,'wikipedia.preview',params as any);assert.ok(!rejected.ok&&rejected.error.code==='CONFLICT',JSON.stringify(rejected));}
  const wrongHead=await response(f.service,'wikipedia.preview',{...base,expectedHead:'0'.repeat(40)});assert.ok(!wrongHead.ok&&wrongHead.error.code==='HEAD_CHANGED');
  const another=await call(f.service,'wikipedia.preview',{...base,selection:{...p.selection,calendar:'Julian'}});assert.notEqual(another.preview.inputHash,p.preview.preview.inputHash);
  const differentProfile=await call(f.service,'wikipedia.preview',{...base,selection:{profileId:'dated-entries-v1',tableIndex:0,headerHash:p.inspection.tables[0].headerHash,timeColumn:1,columns:[{column:0,kind:'linked-entities'}]}});assert.equal(differentProfile.profile.id,'dated-entries-v1');assert.ok(differentProfile.sample.assertions.some(a=>a.propertyId==='event:listed-link'));assert.ok(differentProfile.sample.sources.every(s=>!('record'in s)));assert.notEqual(differentProfile.preview.inputHash,p.preview.preview.inputHash);
  const mix=await response(f.service,'wikipedia.adopt',{...p.adopt,expectedInputHash:differentProfile.preview.inputHash});assert.ok(!mix.ok&&mix.error.code==='CONFLICT');assert.deepEqual((await call(f.service,'repository.status',{})).unstaged,[]);
  const snapshot=path.join(f.library,'wikipedia-workspace',p.job.id,'snapshot.json'),bytes=await readFile(snapshot,'utf8'),value=JSON.parse(bytes);value.value.raw.text='<table>changed</table>';await writeFile(snapshot,JSON.stringify(value));const corrupt=await response(f.service,'wikipedia.inspect',{jobId:p.job.id});assert.ok(!corrupt.ok&&corrupt.error.code==='VALIDATION_FAILED');await writeFile(snapshot,bytes);
});
test('complete restore validation checks archive cross-references, not only individually self-consistent JSON hashes',native,async t=>{
  const source=mock(),f=await fixture(t,source.fetcher),p=await f.prepare();await validateWikipediaWorkspaceDirectory(f.library);
  const file=path.join(f.library,'wikipedia-workspace',p.job.id,'resolved.json'),original=await readFile(file,'utf8'),saved=JSON.parse(original);saved.value.metadata.query.pages[0].pageid=999;saved.hash=hash(saved.value);await writeFile(file,JSON.stringify(saved));await assert.rejects(validateWikipediaWorkspaceDirectory(f.library),/VALIDATION_FAILED/);await writeFile(file,original);await validateWikipediaWorkspaceDirectory(f.library);
});
test('prepared Wikipedia adoption survives real restart and resumes without network or a previous page/file token',native,async t=>{
  const source=mock(),f=await fixture(t,source.fetcher),p=await f.prepare(),database=new DatabaseSync(path.join(f.library,'knowledge-imports.sqlite'));database.exec("CREATE TRIGGER lose_wikipedia_receipt BEFORE UPDATE OF result ON operations BEGIN SELECT RAISE(FAIL,'interrupted receipt'); END");
  const failed=await response(f.service,'wikipedia.adopt',p.adopt);assert.ok(!failed.ok&&failed.error.code==='IO_ERROR');database.exec('DROP TRIGGER lose_wikipedia_receipt');database.close();
  await f.restart(async()=>{throw Error('Offline after restart');});const pending=await call(f.service,'knowledge.pendingImports',{});assert.equal(pending.length,1);assert.equal(pending[0].previewId,p.adopt.previewId);assert.equal((await call(f.service,'wikipedia.inspect',{jobId:p.job.id})).job.source!.revision,'77');
  const result=await call(f.service,'knowledge.resumeImport',{operationId:pending[0].operationId,previewId:pending[0].previewId});assert.deepEqual(await call(f.service,'wikipedia.adopt',p.adopt),result);assert.equal(source.calls.length,2);assert.equal(f.forbiddenReads(),0);
  const objectId=result.changedObjects[0],context=await call(f.service,'knowledge.editContext',{objectId}),claim=context.object!.assertions[0];await call(f.service,'knowledge.saveEdit',{objectId,assertionId:claim.id,operationId:'later-edit',expectedHead:context.head,expectedObjectHash:context.objectHash,change:{mode:'correct',propertyId:claim.propertyId,value:{kind:'unknown'},evidence:{sourceId:claim.sourceSnapshotId,locator:'Local review'},review:'unreviewed',reason:'Keep later correction'}});
  assert.deepEqual(await call(f.service,'knowledge.resumeImport',{operationId:p.adopt.operationId,previewId:p.adopt.previewId}),result);assert.equal((await call(f.service,'knowledge.object',{objectId})).assertions.find(a=>a.id===claim.id)!.value.kind,'unknown');
});
test('obsolete unaccepted profiles require review, while already accepted receipts recover their exact stored operation',native,async t=>{
  for(const accepted of [false,true])await t.test(accepted?'accepted receipt':'unaccepted preview',async sub=>{
    const source=mock(),f=await fixture(sub,source.fetcher),p=await f.prepare();await f.service.close();
    const snapshot=JSON.parse(await readFile(path.join(f.library,'wikipedia-workspace',p.job.id,'snapshot.json'),'utf8')).value,artifact=mapWikipediaProfile(snapshot,p.selection,p.adopt.expectedHead).artifact;artifact.projection!.profileVersion='wikipedia-table-profiles-v2';
    const repo=await createEditorialRepository({dataDirectory:f.library,...git});await repo.initialize();const store=createKnowledgeStore(repo),imports=createKnowledgeImports(repo,store,{dataDirectory:f.library,onFault:point=>{if(accepted&&point==='after-prepare')throw Error('Accepted before restart');}});
    const file=previewKnowledgeCollectionFile({name:'wikipedia-mapping.json',text:canonicalJson(artifact)}),preview=await imports.preview(file),result={...p.preview,preview},saved={schemaVersion:1,result,artifact};
    await writeFile(path.join(f.library,'wikipedia-workspace',p.job.id,'previews',preview.prepared!.id+'.json'),canonicalJson({schemaVersion:1,hash:hash(saved),value:saved}));
    const request={...p.adopt,previewId:preview.prepared!.id,expectedInputHash:preview.inputHash,operationId:accepted?'accepted-v1':'unaccepted-v1'};
    if(accepted)await assert.rejects(imports.adopt({...request,fileToken:`wikipedia:${p.job.id}`},async()=>file),/Accepted before restart/);await imports.close();await repo.close();
    await f.restart(async()=>{throw Error('No network after restart');});const responseValue=await response(f.service,'wikipedia.adopt',request);
    if(accepted){assert.ok(responseValue.ok,JSON.stringify(responseValue));assert.deepEqual(await call(f.service,'knowledge.resumeImport',{operationId:request.operationId,previewId:request.previewId}),responseValue.result);}else{assert.ok(!responseValue.ok&&responseValue.error.code==='REVIEW_REQUIRED');assert.equal(responseValue.error.parameters?.reason,'wikipedia-profile-version-changed');assert.deepEqual((await call(f.service,'repository.status',{})).unstaged,[]);}
    assert.equal(source.calls.length,2);assert.equal(f.forbiddenReads(),0);
  });
});
test('fixed-host acquisition stops on backpressure, preserves its resolved revision and rejects mismatched pages or URLs',native,async t=>{
  await t.test('parse maxlag retry retains fixed metadata revision',async sub=>{let parses=0;const source=mock({parse:url=>++parses===1?Response.json({error:{code:'maxlag'}}):Response.json({parse:{pageid:31,revid:Number(url.searchParams.get('oldid')),title:'A source-selected table',text:html}})}),f=await fixture(sub,source.fetcher);const first=await call(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:'busy'});assert.equal(first.receipt.status,'partial');assert.equal(first.receipt.issues[0].code,'UPSTREAM_BUSY');assert.equal(source.calls.length,2);await f.restart();const second=await call(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:'retry',resumeJobId:first.id});assert.equal(second.receipt.status,'complete');assert.equal(source.calls.filter(u=>u.searchParams.get('action')==='query').length,1);assert.equal(source.calls[2].searchParams.get('oldid'),'77');});
  await t.test('a revision of a different page is not accepted',async sub=>{const source=mock({parse:()=>Response.json({parse:{pageid:99,revid:66,title:'Another page',text:html}})}),f=await fixture(sub,source.fetcher);const job=await call(f.service,'wikipedia.collect',{title:'A source-selected table',revision:66,operationId:'wrong-revision'});assert.equal(job.receipt.status,'failed');assert.equal(job.receipt.issues[0].providerCode,'revision-page-mismatch');assert.equal(job.source,undefined);});
  await t.test('renderer URL and provider redirect cannot select another host',async sub=>{const source=mock({metadata:()=>new Response('',{status:302,headers:{location:'https://other.invalid'}})}),f=await fixture(sub,source.fetcher);const invalid=await response(f.service,'wikipedia.collect',{title:'https://other.invalid',operationId:'not-a-page'});assert.ok(!invalid.ok&&invalid.error.code==='INVALID_REQUEST');assert.equal(source.calls.length,0);const job=await call(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:'redirect'});assert.equal(job.receipt.status,'failed');assert.equal(source.calls.length,1);assert.equal(job.source,undefined);});
  await t.test('a redirected or off-host successful response is not accepted',async sub=>{for(const mode of ['off-host','redirected']){const source=mock({metadata:()=>{const response=Response.json({query:{pages:[{pageid:31,title:'A source-selected table',revisions:[{revid:77}]}]}});Object.defineProperty(response,mode==='off-host'?'url':'redirected',{value:mode==='off-host'?'https://other.invalid/w/api.php':true});return response;}}),f=await fixture(sub,source.fetcher);const job=await call(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:mode});assert.equal(job.source,undefined);assert.equal(job.receipt.issues[0].code,'NETWORK_FAILED');assert.equal(source.calls.length,1);}});
  await t.test('invalid and oversized metadata cannot substitute a complete source',async sub=>{for(const mode of ['invalid','large']){const source=mock({metadata:()=>mode==='invalid'?new Response('not JSON'):new Response('{}',{headers:{'content-length':String(512*1024+1)}})}),f=await fixture(sub,source.fetcher);const job=await call(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:mode});assert.equal(job.source,undefined);assert.equal(job.receipt.status,'failed');assert.equal(job.receipt.issues[0].code,mode==='invalid'?'INVALID_RESPONSE':'RESPONSE_TOO_LARGE');assert.equal(source.calls.length,1);}});
  await t.test('cancelled request leaves a resumable source job',async sub=>{let release!:(r:Response)=>void;const source=mock(),waiting:typeof fetch=async(input,init)=>{if(String(input).includes('action=query'))return new Promise((resolve,reject)=>{release=resolve;init?.signal?.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});return source.fetcher(input,init);},f=await fixture(sub,waiting);const task=response(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:'cancel-me'});for(let i=0;i<20&&!release;i++)await new Promise(setImmediate);await call(f.service,'operation.cancel',{operationId:'cancel-me'});const cancelled=await task;assert.ok(cancelled.ok);assert.equal((cancelled.result as any).receipt.status,'cancelled');await f.restart(source.fetcher);const recovered=await call(f.service,'wikipedia.collect',{title:'A source-selected table',operationId:'resume-cancel',resumeJobId:(cancelled.result as any).id});assert.equal(recovered.receipt.status,'complete');});
});
