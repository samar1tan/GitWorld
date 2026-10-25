import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalService } from './index.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import { wikipediaHash } from '../../ingestion/src/wikipedia-profiles.ts';
import { DatabaseSync } from 'node:sqlite';
import { validateWikipediaWorkspaceDirectory } from './wikipedia-workspace.ts';

const binary=path.resolve('.local/bundled-git/runtime/bin/git');
const native={skip:!existsSync(binary)&&'Prepare bundled Git runtime'};
let sequence=0;
async function response<M extends ServiceMethod>(service:Awaited<ReturnType<typeof createLocalService>>,method:M,params:ServiceMethods[M]['params']){
  return service.dispatch({protocolVersion:1,requestId:`issues-${++sequence}`,method,params} as ServiceRequest);
}
async function call<M extends ServiceMethod>(service:Awaited<ReturnType<typeof createLocalService>>,method:M,params:ServiceMethods[M]['params']):Promise<ServiceMethods[M]['result']>{
  const result=await response(service,method,params);assert.ok(result.ok,JSON.stringify(result));return result.result as ServiceMethods[M]['result'];
}
async function fixture(t:{after(fn:()=>unknown):void}){
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-wikipedia-issues-')),library=path.join(directory,'library');let fetches=0;
  const html='<table class="wikitable"><tr><th>Name</th><th>Term</th></tr>'+Array.from({length:45},(_,i)=>`<tr><td><a href="/wiki/Recorded_${i}">Recorded ${i}</a></td><td>Unresolved date ${i}</td></tr>`).join('')+'</table>';
  const fetcher:typeof fetch=async(input)=>{fetches++;const url=new URL(String(input)),other=url.searchParams.get('titles')==='Different source'||url.searchParams.get('oldid')==='102',pageid=other?43:42,title=other?'Different source':'Source with unresolved dates',revid=other?102:101;return url.searchParams.get('action')==='query'?Response.json({query:{pages:[{pageid,title,revisions:[{revid}]}]}}):Response.json({parse:{pageid,title,revid,text:other?html.replaceAll('Unresolved date','Another unresolved date'):html}});};
  const options={dataDirectory:library,gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core'),sourceFetch:fetcher};
  let service=await createLocalService(options);t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const job=await call(service,'wikipedia.collect',{title:'Source with unresolved dates',operationId:'collect-issues'}),inspection=await call(service,'wikipedia.inspect',{jobId:job.id}),status=await call(service,'repository.status',{});
  const preview=await call(service,'wikipedia.preview',{jobId:job.id,sourceHash:job.source!.contentHash,expectedHead:status.head,selection:{profileId:'office-tenures-v1',tables:[{tableIndex:0,headerHash:inspection.tables[0].headerHash,holderColumn:0,tenureColumn:1}]}});
  const request={jobId:job.id,previewId:preview.preview.prepared!.id,expectedInputHash:preview.preview.inputHash};
  return{library,job,preview,request,get service(){return service;},fetches:()=>fetches,async restart(){await service.close();service=await createLocalService({...options,sourceFetch:async()=>{throw Error('Offline');}});}};
}
test('the complete prepared issue report is paged and stable after an offline restart without changing Git',native,async t=>{
  const f=await fixture(t);assert.equal(f.preview.exceptionCount,45);assert.equal(f.preview.exceptions.length,30);
  const before=await call(f.service,'repository.status',{}),first=await call(f.service,'wikipedia.issues',{...f.request,offset:0,limit:30});
  assert.deepEqual(first.issues,f.preview.exceptions);assert.equal(first.total,45);assert.match(first.reportHash,/^[a-f0-9]{64}$/);
  const middle=await call(f.service,'wikipedia.issues',{...f.request,offset:30,limit:10});assert.equal(middle.issues.length,10);assert.equal(middle.issues[0].locator,'table[0].row[31]');assert.equal(middle.reportHash,first.reportHash);
  assert.deepEqual(await call(f.service,'repository.status',{}),before);
  const adopted=await call(f.service,'wikipedia.adopt',{...f.request,expectedHead:f.preview.preview.prepared!.baseHead,review:'unreviewed',operationId:'adopt-after-issue-review'});
  await call(f.service,'repository.stage',{paths:adopted.paths!});const staged=await call(f.service,'repository.status',{});
  await call(f.service,'repository.commit',{operationId:'commit-after-issue-review',expectedHead:staged.head,expectedTree:staged.stagedTree,message:'Keep the reviewed source report'});
  const committed=await call(f.service,'repository.status',{});assert.notEqual(committed.head,before.head);
  await f.restart();
  const last=await call(f.service,'wikipedia.issues',{...f.request,offset:40,limit:10});assert.equal(last.issues.length,5);assert.equal(last.issues[4].locator,'table[0].row[45]');assert.equal(last.reportHash,first.reportHash);assert.equal(f.fetches(),2);
  assert.deepEqual((await call(f.service,'wikipedia.issues',{...f.request,offset:45,limit:10})).issues,[]);
  assert.deepEqual(await call(f.service,'repository.status',{}),committed);
});
test('issue pages reject exchanged preview bindings, invalid pages and corrupt stored reports',native,async t=>{
  const f=await fixture(t);
  const cases=[{...f.request,expectedInputHash:'0'.repeat(64)},{...f.request,previewId:'0'.repeat(64)},{...f.request,jobId:'0'.repeat(64)},{...f.request,limit:101},{...f.request,limit:0},{...f.request,offset:-1},{...f.request,offset:0.5},{...f.request,extra:'unexpected'}];
  for(const params of cases){const result=await response(f.service,'wikipedia.issues',params as any);assert.equal(result.ok,false,JSON.stringify(params));}
  const file=path.join(f.library,'wikipedia-workspace',f.job.id,'previews',f.request.previewId+'.json'),original=await readFile(file,'utf8'),saved=JSON.parse(original);
  saved.value.artifact.projection.exceptions[44].locator='exchanged report row';saved.hash=wikipediaHash(saved.value);await writeFile(file,JSON.stringify(saved));
  const changed=await response(f.service,'wikipedia.issues',f.request);assert.ok(!changed.ok&&changed.error.code==='CONFLICT');
  await writeFile(file,original);assert.equal((await call(f.service,'wikipedia.issues',f.request)).total,45);
});
test('issue reading remains available while the original accepted import awaits recovery',native,async t=>{
  const f=await fixture(t),database=new DatabaseSync(path.join(f.library,'knowledge-imports.sqlite'));
  try{
    database.exec("CREATE TRIGGER interrupt_receipt BEFORE UPDATE OF result ON operations BEGIN SELECT RAISE(FAIL,'issue test receipt interruption'); END");
    const adopted=await response(f.service,'wikipedia.adopt',{...f.request,expectedHead:f.preview.preview.prepared!.baseHead,review:'unreviewed',operationId:'interrupted-with-report'});assert.equal(adopted.ok,false);
  }finally{database.exec('DROP TRIGGER interrupt_receipt');database.close();}
  const pending=await call(f.service,'knowledge.pendingImports',{});assert.equal(pending.length,1);
  const before=await call(f.service,'repository.status',{}),last=await call(f.service,'wikipedia.issues',{...f.request,offset:40,limit:10});assert.equal(last.issues.length,5);
  assert.deepEqual(await call(f.service,'repository.status',{}),before);assert.deepEqual(await call(f.service,'knowledge.pendingImports',{}),pending);assert.equal(f.fetches(),2);
});
test('an authentic prepared report cannot be relabeled under another acquired source job',native,async t=>{
  const f=await fixture(t),job=await call(f.service,'wikipedia.collect',{title:'Different source',operationId:'different-source'});
  const sourceFile=path.join(f.library,'wikipedia-workspace',f.job.id,'previews',f.request.previewId+'.json'),forged=JSON.parse(await readFile(sourceFile,'utf8'));
  forged.value.result.jobId=job.id;forged.value.result.sourceHash=job.source!.contentHash;forged.hash=wikipediaHash(forged.value);
  const targetDirectory=path.join(f.library,'wikipedia-workspace',job.id,'previews');const {mkdir}=await import('node:fs/promises');await mkdir(targetDirectory);
  const target=path.join(targetDirectory,f.request.previewId+'.json');await writeFile(target,JSON.stringify(forged));
  const before=await call(f.service,'repository.status',{}),request={...f.request,jobId:job.id};
  const read=await response(f.service,'wikipedia.issues',{...request,offset:40,limit:10});assert.ok(!read.ok&&read.error.code==='CONFLICT');
  const adopt=await response(f.service,'wikipedia.adopt',{...request,expectedHead:f.preview.preview.prepared!.baseHead,review:'unreviewed',operationId:'relabeled-source'});assert.ok(!adopt.ok&&adopt.error.code==='CONFLICT');
  await assert.rejects(validateWikipediaWorkspaceDirectory(f.library),/VALIDATION_FAILED/);
  assert.deepEqual(await call(f.service,'repository.status',{}),before);assert.equal((await call(f.service,'knowledge.pendingImports',{})).length,0);
  await rm(target);await validateWikipediaWorkspaceDirectory(f.library);assert.equal((await call(f.service,'wikipedia.issues',f.request)).total,45);
});
