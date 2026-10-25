import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeImportArtifact } from '../../contracts/src/knowledge-import-types.ts';
import type { NavigationBatchSummary } from '../../contracts/src/navigation-types.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createLocalService } from './index.ts';
import { createNavigationContexts } from './navigation-contexts.ts';
import { createLibraryBackup } from './library-backup.ts';
import { navigationDefinitionPath, navigationDigest as hash, navigationObjectPath, navigationSourcePath } from './navigation-tree.ts';

const root=fileURLToPath(new URL('../../../',import.meta.url)),binary=process.env.GITWORLD_TEST_GIT??path.join(root,'.local/bundled-git/runtime/bin/git');
const native={skip:!existsSync(binary)&&'Build the pinned bundled Git runtime.'};
const git={gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core')};
function artifact(count=6):KnowledgeImportArtifact {
  const record={fixture:'Complete source selection and accepted object manifest'},source={id:'fixture:source',identity:{provider:'fixture',externalId:'Local source'},revision:'source-v1',contentHash:hash(record),retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/source',adapterVersion:'fixture-v1',rights:{redistribution:'unknown' as const},record};
  const objects=Array.from({length:count},(_,index)=>({id:`opaque:987654:${String(index).padStart(5,'0')}`,identities:[],labels:{en:index===count-1?'The council':'An investigator '+index,'zh-CN':index===count-1?'议事机构':'研究者'+index},descriptions:{en:index===0?'A literal 1267 reference':''},aliases:index===1?[{en:'Archive alias'}]:[],types:[index===count-1?'fixture:structure':'fixture:person']}));
  return{schemaVersion:1,kind:'gitworld-knowledge-import',collection:{schemaVersion:1,objects,sources:[source],assertions:objects.slice(0,-1).map((object,index)=>({id:'claim:'+index,subjectId:object.id,propertyId:'fixture:affiliation',value:{kind:'entity' as const,objectId:objects[count-1].id},qualifiers:[],sourceSnapshotId:source.id,evidence:[{sourceId:source.id,locator:'row '+index}],review:'unreviewed' as const,validTime:{point:{earliestYear:1200+index%2,latestYear:1200+index%2,precision:'year' as const,calendar:'fixture'}}}))},vocabulary:{id:'fixture:catalog',revision:'v1',catalog:{schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'fixture:affiliation',labels:{en:'Affiliation','zh-CN':'所属'}}],types:[{id:'fixture:person',labels:{en:'Person','zh-CN':'人物'},navigationRole:'person'},{id:'fixture:structure',labels:{en:'Structure','zh-CN':'机构'},navigationRole:'structure'}]},origin:{identity:{provider:'fixture',externalId:'catalog'},url:'https://example.invalid/catalog',retrievedAt:source.retrievedAt,rights:{redistribution:'unknown'},evidence:[{sourceId:source.id,sourceHash:source.contentHash,locator:'Columns'}]}}};
}
type Service=Awaited<ReturnType<typeof createLocalService>>;
const api=<M extends ServiceMethod>(service:Service,method:M,params:ServiceMethods[M]['params'])=>service.dispatch({protocolVersion:1,requestId:'navigation-test',method,params} as ServiceRequest<M>);
async function call<M extends ServiceMethod>(service:Service,method:M,params:ServiceMethods[M]['params']):Promise<ServiceMethods[M]['result']>{const result=await api(service,method,params);assert.ok(result.ok,JSON.stringify(result));return result.result as ServiceMethods[M]['result'];}
async function fixture(t:{after(fn:()=>unknown):void},count=6){
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-navigation-')),library=path.join(directory,'library'),selected=path.join(directory,'selected.json'),backup=path.join(directory,'full.gitworld');await writeFile(selected,JSON.stringify(artifact(count)));
  const options={dataDirectory:library,...git,resolveFileToken:(token:string)=>token==='selected'?selected:token==='backup'||token==='restore'?backup:undefined};
  let service=await createLocalService(options);t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  return{directory,library,selected,backup,options,get service(){return service;},async restart(){await service.close();service=await createLocalService(options);},async close(){await service.close();},async reopen(){service=await createLocalService(options);}};
}
async function adopt(f:Awaited<ReturnType<typeof fixture>>,operationId='facts'){
  const preview=await call(f.service,'knowledge.filePreview',{fileToken:'selected'}),result=await call(f.service,'knowledge.fileAdopt',{fileToken:'selected',previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'adopted',operationId});
  return{preview,result};
}
async function context(f:Awaited<ReturnType<typeof fixture>>,operationId='new-context'){
  const status=await call(f.service,'repository.status',{});return call(f.service,'context.save',{operationId,expectedHead:status.head,expectedContentHash:null,labels:{en:'Maritime research','zh-CN':'海上研究'},description:{en:'A modern organization decision'}});
}
async function batch(f:Awaited<ReturnType<typeof fixture>>,kind:'adopted-import'|'saved-source'='adopted-import',related=false){
  const values=await call(f.service,'context.batches',{limit:100});const found=values.items.find(value=>value.batch.kind===kind&&(kind!=='saved-source'||value.batch.kind==='saved-source'&&value.batch.selection===(related?'subjects-and-referenced-objects':'source-claim-subjects')));assert.ok(found);return found;
}
async function plan(f:Awaited<ReturnType<typeof fixture>>,contextId:string,selected:NavigationBatchSummary,mode:'add'|'remove'='add'){
  const current=await call(f.service,'context.get',{contextId});return call(f.service,'context.membershipPlan',{contextId,expectedHead:current.head,expectedDefinitionHash:current.contentHash,batch:selected.batch,mode,rationale:'Explicit whole-batch organization'});
}

test('empty legacy library stays unassigned; literal labels, aliases and descriptions exclude opaque identifiers',native,async t=>{
  const f=await fixture(t);const empty=await call(f.service,'context.list',{});assert.deepEqual(empty.counts,{objects:0,assigned:0,unassigned:0});assert.deepEqual(empty.items,[]);
  const first=await adopt(f),query=await call(f.service,'knowledge.query',{query:{text:'987654'}});assert.equal(query.total,0);
  assert.equal((await call(f.service,'knowledge.query',{query:{text:'archive alias'}})).total,1);assert.equal((await call(f.service,'knowledge.query',{query:{text:'1267'}})).total,1);
  const direct=await call(f.service,'knowledge.object',{objectId:artifact().collection.objects[0].id});assert.equal(direct.object.id,artifact().collection.objects[0].id);
  assert.equal((await call(f.service,'knowledge.query',{query:{unassigned:true}})).total,6);
  const unknown=await api(f.service,'knowledge.query',{query:{contextIds:['missing-context']}});assert.ok(!unknown.ok&&unknown.error.code==='NOT_FOUND');
  const old=await call(f.service,'context.list',{revision:first.preview.preview.prepared!.baseHead});assert.deepEqual(old.counts,{objects:0,assigned:0,unassigned:0});
});

test('an actual adoption larger than pages and the explicit-object limit keeps accepted and reused objects in its fixed full batch',native,async t=>{
  const f=await fixture(t,1005),first=await adopt(f);assert.equal(first.result.objects!.length,40);assert.equal(first.result.changedObjects.length,1005);
  const selected=await batch(f);assert.equal(selected.objects,1005);assert.equal(selected.batch.objectSetHash,hash(first.result.changedObjects.slice().sort()));
  const last=await call(f.service,'context.batchObjects',{batch:selected.batch,offset:1000,limit:100});assert.equal(last.total,1005);assert.equal(last.items.length,5);
  const ctx=await context(f),prepared=await plan(f,ctx.contextId,selected);assert.deepEqual(prepared.counts,{selected:1005,already:0,added:1005,removed:0,unchanged:0});
  const saved=await call(f.service,'context.applyMembership',{operationId:'assign-all',planId:prepared.planId,expectedPlanHash:prepared.planHash});assert.equal(saved.counts.added,1005);
  const query=await call(f.service,'knowledge.query',{query:{contextIds:[ctx.contextId],offset:1000,limit:25}});assert.equal(query.total,1005);assert.equal(query.objects.length,5);
  const counts=await call(f.service,'context.list',{offset:10,limit:1,text:'no such name'});assert.deepEqual(counts.counts,{objects:1005,assigned:1005,unassigned:0});assert.equal(counts.total,0);
  const again=await plan(f,ctx.contextId,selected);assert.equal(again.counts.unchanged,1005);assert.deepEqual(again.paths,[]);
  const repeated=await adopt(f,'facts-reused'),reused=(await call(f.service,'context.batches',{inputHash:repeated.preview.preview.inputHash,limit:100})).items.find(value=>value.batch.kind==='adopted-import'&&value.batch.operationId==='facts-reused')!;
  assert.equal(repeated.result.unchangedObjects.length,1005);assert.equal(reused.objects,1005);assert.equal(reused.status,'complete');
});

test('saved-source selection distinguishes claim subjects and one-hop typed entities; counts and roles use actual data',native,async t=>{
  const f=await fixture(t);await adopt(f);const subjects=await batch(f,'saved-source'),related=await batch(f,'saved-source',true);
  assert.deepEqual([subjects.objects,subjects.directObjects,subjects.relatedObjects],[5,5,0]);assert.deepEqual([related.objects,related.directObjects,related.relatedObjects],[6,5,1]);
  const ctx=await context(f),prepared=await plan(f,ctx.contextId,related);await call(f.service,'context.applyMembership',{operationId:'related-members',planId:prepared.planId,expectedPlanHash:prepared.planHash});
  const structures=await call(f.service,'knowledge.query',{query:{contextIds:[ctx.contextId],typeIds:['fixture:structure'],includeUndated:true}});assert.equal(structures.total,1);assert.equal(structures.coverage!.typeCounts[0].navigationRole,'structure');
  const peopleOnly=await call(f.service,'knowledge.query',{query:{contextIds:[ctx.contextId],typeIds:['fixture:person']}});assert.ok(!peopleOnly.coverage!.typeCounts.some(type=>type.typeId==='fixture:structure'));assert.equal(peopleOnly.typeCatalog!.find(type=>type.id==='fixture:structure')!.navigationRole,'structure');
  const detail=await call(f.service,'context.get',{contextId:ctx.contextId});assert.equal(detail.total,6);assert.equal(detail.members[0].decision.kind,'manual');assert.equal(detail.members[0].sourceRefs![0].contentHash,artifact().collection.sources[0].contentHash);
  const a=await call(f.service,'knowledge.query',{query:{contextIds:[ctx.contextId],text:'alias',time:[1200,1201]}});assert.equal(a.total,1);
  const bad=await api(f.service,'knowledge.query',{query:{contextIds:[ctx.contextId],unassigned:true}});assert.ok(!bad.ok&&bad.error.code==='INVALID_REQUEST');
});

test('stale definition, changed membership, changed full source set and changed HEAD reject the plan without partial classification',native,async t=>{
  const f=await fixture(t);await adopt(f);const ctx=await context(f),selected=await batch(f),a=await plan(f,ctx.contextId,selected);
  const renamed=await call(f.service,'context.save',{operationId:'rename-context',contextId:ctx.contextId,expectedHead:ctx.head,expectedContentHash:ctx.contentHash,labels:{en:'Changed purpose'}});
  let rejected=await api(f.service,'context.applyMembership',{operationId:'stale-definition',planId:a.planId,expectedPlanHash:a.planHash});assert.ok(!rejected.ok&&rejected.error.code==='CONTENT_CHANGED');
  const b=await plan(f,ctx.contextId,selected);await call(f.service,'context.applyMembership',{operationId:'first-writer',planId:b.planId,expectedPlanHash:b.planHash});
  rejected=await api(f.service,'context.applyMembership',{operationId:'second-writer',planId:b.planId,expectedPlanHash:b.planHash});assert.ok(!rejected.ok&&rejected.error.code==='CONTENT_CHANGED');
  const remove=await plan(f,ctx.contextId,selected,'remove'),detail=await call(f.service,'knowledge.editContext',{objectId:artifact().collection.objects[0].id});
  await call(f.service,'knowledge.saveEdit',{operationId:'facts-change-after-plan',objectId:artifact().collection.objects[0].id,assertionId:'claim:0',expectedHead:detail.head,expectedObjectHash:detail.objectHash,change:{mode:'correct',propertyId:'fixture:affiliation',value:{kind:'text',value:'A reviewed correction'},evidence:{sourceId:'fixture:source',locator:'Correction'},review:'adopted',reason:'Exercise the exact material basis guard'}});
  rejected=await api(f.service,'context.applyMembership',{operationId:'stale-basis',planId:remove.planId,expectedPlanHash:remove.planHash});assert.ok(!rejected.ok&&rejected.error.code==='CONTENT_CHANGED');
  assert.equal((await call(f.service,'context.get',{contextId:ctx.contextId})).total,6);
  const status=await call(f.service,'repository.status',{});await call(f.service,'repository.stage',{paths:status.unstaged.map(change=>change.path)});const staged=await call(f.service,'repository.status',{});await call(f.service,'repository.commit',{operationId:'advance-head',expectedHead:staged.head,expectedTree:staged.stagedTree,message:'Commit guarded organization'});
  rejected=await api(f.service,'context.save',{operationId:'stale-head',contextId:ctx.contextId,expectedHead:renamed.head,expectedContentHash:renamed.contentHash,labels:{en:'Must not save'}});assert.ok(!rejected.ok&&rejected.error.code==='HEAD_CHANGED');
});

test('semantic Changes and dependency staging freeze B while later context and membership C remain working',native,async t=>{
  const f=await fixture(t);await adopt(f);const ctx=await context(f),selected=await batch(f),prepared=await plan(f,ctx.contextId,selected);await call(f.service,'context.applyMembership',{operationId:'members-B',planId:prepared.planId,expectedPlanHash:prepared.planHash});
  const dependencies=await call(f.service,'repository.stagePlan',{paths:prepared.paths});assert.ok(dependencies.required.includes(navigationDefinitionPath(ctx.contextId)));assert.ok(dependencies.required.includes(navigationObjectPath(artifact().collection.objects[0].id)));
  const summary=await call(f.service,'repository.changes',{mode:'working',group:'navigation',offset:0,limit:100});assert.equal(summary.total,prepared.paths.length+1);assert.ok(summary.items.every(value=>value.title.en==='Maritime research'));
  const diff=await call(f.service,'repository.diff',{mode:'working',paths:[prepared.paths[0]],limit:1});assert.equal(diff.entries[0].navigation!.kind,'context-membership');assert.ok(diff.entries[0].navigation!.kind==='context-membership'&&diff.entries[0].navigation.added>0);
  let status=await call(f.service,'repository.status',{});await call(f.service,'repository.stage',{paths:status.unstaged.map(change=>change.path)});status=await call(f.service,'repository.status',{});const frozen=status.stagedTree;
  await call(f.service,'context.save',{operationId:'label-C',contextId:ctx.contextId,expectedHead:ctx.head,expectedContentHash:ctx.contentHash,labels:{en:'Working C'}});const removal=await plan(f,ctx.contextId,selected,'remove');await call(f.service,'context.applyMembership',{operationId:'members-C',planId:removal.planId,expectedPlanHash:removal.planHash});
  const committed=await call(f.service,'repository.commit',{operationId:'commit-B',expectedHead:status.head,expectedTree:frozen,message:'Freeze organization B'});
  assert.equal((await call(f.service,'context.get',{contextId:ctx.contextId,revision:committed.oid})).total,6);assert.equal((await call(f.service,'context.get',{contextId:ctx.contextId,revision:committed.oid})).definition.labels.en,'Maritime research');
  const working=await call(f.service,'context.get',{contextId:ctx.contextId});assert.equal(working.total,0);assert.equal(working.definition.labels.en,'Working C');assert.ok((await call(f.service,'repository.status',{})).unstaged.length>0);
  await f.restart();assert.equal((await call(f.service,'knowledge.query',{query:{contextIds:[ctx.contextId]},revision:committed.oid})).total,6);assert.equal((await call(f.service,'knowledge.query',{query:{unassigned:true}})).total,6);
});

test('unknown save acknowledgement exposes a typed restart recovery and never replaces later C',native,async t=>{
  const f=await fixture(t);await adopt(f);const journal=new DatabaseSync(path.join(f.library,'navigation.sqlite'));journal.exec("CREATE TRIGGER lose_ack BEFORE UPDATE OF result ON operations BEGIN SELECT RAISE(FAIL,'lost navigation acknowledgement'); END");
  const status=await call(f.service,'repository.status',{}),request={operationId:'uncertain-create',expectedHead:status.head,expectedContentHash:null,labels:{en:'A retained definition'}};
  const failed=await api(f.service,'context.save',request);assert.ok(!failed.ok&&failed.error.code==='IO_ERROR');journal.exec('DROP TRIGGER lose_ack');journal.close();
  const pending=await call(f.service,'context.pending',{});assert.equal(pending[0].kind,'save');assert.ok(!JSON.stringify(pending).includes('A retained definition'));
  const query=await api(f.service,'knowledge.query',{query:{}});assert.ok(!query.ok&&query.error.code==='REVIEW_REQUIRED'&&query.error.parameters!.reason==='navigation-operation-pending');
  assert.ok((await api(f.service,'knowledge.object',{objectId:artifact().collection.objects[0].id})).ok);
  const blocked=await api(f.service,'knowledge.fileAdopt',{fileToken:'selected',expectedHead:status.head,expectedInputHash:hash('not-adopted'),review:'adopted',operationId:'different-facts'});assert.ok(!blocked.ok&&blocked.error.parameters!.reason==='navigation-operation-pending');
  await f.restart();assert.deepEqual(await call(f.service,'context.pending',{}),pending);const resumed=await call(f.service,'context.resume',{operationId:pending[0].operationId});assert.equal(resumed.kind,'save');if(resumed.kind!=='save')return;
  const a=resumed.result;await call(f.service,'context.save',{operationId:'later-C',contextId:a.contextId,expectedHead:a.head,expectedContentHash:a.contentHash,labels:{en:'Subsequent C'}});
  assert.deepEqual(await call(f.service,'context.resume',{operationId:pending[0].operationId}),resumed);assert.deepEqual(await call(f.service,'context.save',request),a);assert.equal((await call(f.service,'context.get',{contextId:a.contextId})).definition.labels.en,'Subsequent C');
});

test('partial durable classification is backed up with its receipt, restored and resumed; corrupt expected bytes reject before exchange',native,async t=>{
  const f=await fixture(t);await adopt(f);const ctx=await context(f),selected=await batch(f,'saved-source',true),prepared=await plan(f,ctx.contextId,selected);await f.close();
  const repository=await createEditorialRepository({...git,dataDirectory:f.library,requireExistingHead:true});await repository.initialize();let failOnce=true;
  const wrapped={...repository,async write(changes,guards){if(failOnce){failOnce=false;await repository.write(changes.slice(0,1),guards);throw Error('Interrupted after one durable membership shard');}return repository.write(changes,guards);}} satisfies EditorialRepository;
  const navigation=createNavigationContexts(wrapped,{dataDirectory:f.library,imports:async()=>[]});await assert.rejects(navigation.apply({operationId:'partial-membership',planId:prepared.planId,expectedPlanHash:prepared.planHash}),/Interrupted/);await navigation.close();await repository.close();
  await createLibraryBackup({dataDirectory:f.library,destinationPath:f.backup});await f.reopen();const pending=await call(f.service,'context.pending',{});assert.equal(pending[0].kind,'membership');
  const goodBackup=path.join(f.directory,'good-partial.gitworld'),badPending=path.join(f.directory,'bad-pending'),badPendingBackup=path.join(f.directory,'bad-pending.gitworld');await cp(f.backup,goodBackup);await cp(f.library,badPending,{recursive:true});
  const written=prepared.paths.find(name=>existsSync(path.join(f.library,'repository',name)))!,partialBytes=await readFile(path.join(f.library,'repository',written)),changed=JSON.parse(partialBytes.toString('utf8'));changed.members[0].decision.rationale='Valid metadata that is neither original baseline nor prepared bytes';await writeFile(path.join(badPending,'repository',written),JSON.stringify(changed));await createLibraryBackup({dataDirectory:badPending,destinationPath:badPendingBackup});await cp(badPendingBackup,f.backup);
  const rejectedPartial=await api(f.service,'backup.restore',{fileToken:'restore',operationId:'reject-wrong-partial-bytes'});assert.ok(!rejectedPartial.ok&&rejectedPartial.error.code==='BACKUP_INVALID');assert.deepEqual(await readFile(path.join(f.library,'repository',written)),partialBytes);assert.deepEqual(await call(f.service,'context.pending',{}),pending);await cp(goodBackup,f.backup);
  await call(f.service,'backup.restore',{fileToken:'restore',operationId:'restore-partial'});const resumed=await call(f.service,'context.resume',{operationId:'partial-membership'});assert.equal(resumed.kind,'membership');assert.equal((await call(f.service,'context.get',{contextId:ctx.contextId})).total,6);
  assert.deepEqual(await call(f.service,'context.resume',{operationId:'partial-membership'}),resumed);
  const candidate=path.join(f.directory,'bad-candidate'),badBackup=path.join(f.directory,'bad.gitworld');await f.close();await cp(f.library,candidate,{recursive:true});
  const name=navigationDefinitionPath(ctx.contextId),body=JSON.parse(await readFile(path.join(candidate,'repository',name),'utf8'));body.schemaVersion=2;await writeFile(path.join(candidate,'repository',name),JSON.stringify(body));await createLibraryBackup({dataDirectory:candidate,destinationPath:badBackup});await f.reopen();
  const before=await call(f.service,'repository.status',{});await cp(badBackup,f.backup);const rejected=await api(f.service,'backup.restore',{fileToken:'restore',operationId:'reject-new-schema'});assert.ok(!rejected.ok&&rejected.error.code==='BACKUP_INVALID');assert.deepEqual(await call(f.service,'repository.status',{}),before);assert.equal((await call(f.service,'context.get',{contextId:ctx.contextId})).total,6);
});

test('bounded scope commands and GUI intents share the exact context, plan, filter and apply services',native,async t=>{
  const f=await fixture(t);await adopt(f);const status=await call(f.service,'repository.status',{});
  const created=await call(f.service,'command.execute',{input:{command:'scope create --name "Command context" --language en --purpose "Explicit organization"'},operationId:'command-create',expectedHead:status.head});assert.ok(created.ok&&created.output.kind==='scope-saved');if(!created.ok||created.output.kind!=='scope-saved')return;const contextId=created.output.result.contextId;
  const use=await call(f.service,'command.execute',{input:{command:`scope use --context "${contextId}"`}});assert.ok(use.ok&&use.effect.type==='scope'&&use.effect.patch.type==='selection');
  const filter=await call(f.service,'command.execute',{input:{command:'scope filter --text "1267"'}});assert.ok(filter.ok&&filter.effect.type==='scope');if(filter.ok&&filter.effect.type==='scope')assert.deepEqual(filter.effect.patch,{type:'filters',filters:{text:'1267'}});
  const selected=await batch(f),planned=await call(f.service,'command.execute',{input:{command:`scope assign --context "${contextId}" --batch ${selected.batchKey}`},expectedHead:status.head});assert.ok(planned.ok&&planned.output.kind==='scope-plan');if(!planned.ok||planned.output.kind!=='scope-plan')return;
  const applied=await call(f.service,'command.execute',{input:{command:`scope apply ${planned.output.plan.planId}`},operationId:'command-apply'});assert.ok(applied.ok&&applied.output.kind==='scope-applied');assert.ok(applied.ok&&applied.effect.type==='none');
  assert.equal((await call(f.service,'knowledge.query',{query:{contextIds:[contextId]}})).total,6);
  const direct=await call(f.service,'command.execute',{input:{command:`history --object "${artifact().collection.objects[0].id}" --revision working show 1200 --include-unreviewed`}});assert.ok(direct.ok&&direct.output.kind==='object-state');
  const completions=await call(f.service,'command.complete',{input:'scope use --context Command'});assert.equal(completions[0].label.en,'Command context');
  assert.equal((await call(f.service,'command.complete',{input:'scope filter --type Struct'}))[0].value,'scope filter --type "fixture:structure" ');
  const prior=await api(f.service,'command.execute',{input:{command:`scope use --context "${contextId}"`},scopeRevision:status.head});assert.ok(!prior.ok&&prior.error.code==='NOT_FOUND');
  const explicit=await call(f.service,'command.execute',{input:{command:`scope use --context "${contextId}" --revision working`},scopeRevision:status.head});assert.ok(explicit.ok&&explicit.effect.type==='scope'&&explicit.effect.patch.type==='selection'&&explicit.effect.patch.revision==='working');
});

test('overlapping contexts form an OR set, unassigned counts stay global, and removing one membership does not remove the other',native,async t=>{
  const f=await fixture(t);await adopt(f);const first=await context(f,'first'),second=await context(f,'second'),subjects=await batch(f,'saved-source'),all=await batch(f,'saved-source',true);
  const p=await plan(f,first.contextId,subjects);await call(f.service,'context.applyMembership',{operationId:'assign-first',planId:p.planId,expectedPlanHash:p.planHash});
  assert.equal((await call(f.service,'knowledge.query',{query:{unassigned:true}})).total,1);
  const q=await plan(f,second.contextId,all);await call(f.service,'context.applyMembership',{operationId:'assign-second',planId:q.planId,expectedPlanHash:q.planHash});
  const combined=await call(f.service,'knowledge.query',{query:{contextIds:[first.contextId,second.contextId],limit:1}});assert.equal(combined.total,6);assert.equal(combined.coverage!.matchedObjects,6);
  assert.deepEqual((await call(f.service,'context.list',{limit:1})).counts,{objects:6,assigned:6,unassigned:0});
  const remove=await plan(f,first.contextId,subjects,'remove');await call(f.service,'context.applyMembership',{operationId:'remove-first',planId:remove.planId,expectedPlanHash:remove.planHash});assert.equal((await call(f.service,'context.get',{contextId:second.contextId})).total,6);assert.equal((await call(f.service,'knowledge.query',{query:{unassigned:true}})).total,0);
});

test('new generic receipts bind their original full set and source pins; legacy receipts retain shape and cannot borrow working C provenance',native,async t=>{
  const f=await fixture(t),data=artifact().collection;await writeFile(f.selected,JSON.stringify(data));
  const preview=await call(f.service,'knowledge.filePreview',{fileToken:'selected'}),head=(await call(f.service,'repository.status',{})).head,params={fileToken:'selected',operationId:'legacy-generic',expectedHead:head,expectedInputHash:preview.preview.inputHash,review:'adopted' as const};
  const result=await call(f.service,'knowledge.fileAdopt',params);assert.equal(result.batch!.inputObjectSetHash,hash(data.objects.map(object=>object.id).sort()));assert.equal(result.batch!.acceptedObjectSetHash,hash([...result.changedObjects,...result.unchangedObjects].sort()));assert.deepEqual(result.batch!.sourceRefs,data.sources.map(source=>({sourceId:source.id,revision:source.revision,contentHash:source.contentHash})));
  const real=(await call(f.service,'context.batches',{inputHash:preview.preview.inputHash})).items[0];assert.equal(real.status,'complete');
  const legacy={...result};delete legacy.batch;const journal=new DatabaseSync(path.join(f.library,'library.sqlite')),oldBytes=JSON.stringify(legacy);journal.prepare('UPDATE operations SET result_json=? WHERE id=?').run(oldBytes,params.operationId);journal.close();
  const object=await call(f.service,'knowledge.editContext',{objectId:data.objects[0].id});await call(f.service,'knowledge.saveEdit',{operationId:'working-C-provenance',objectId:data.objects[0].id,assertionId:'claim:0',expectedHead:object.head,expectedObjectHash:object.objectHash,change:{mode:'correct',propertyId:'fixture:affiliation',value:{kind:'text',value:'Local C'},evidence:{title:'A later citation',url:'https://example.invalid/later',locator:'Later correction'},review:'adopted',reason:'This citation did not belong to the original import'}});
  const unavailable=(await call(f.service,'context.batches',{inputHash:preview.preview.inputHash})).items[0];assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.reason,'import-origin-unavailable');assert.deepEqual(unavailable.sourceRefs,[]);assert.equal(unavailable.objects,6);
  assert.deepEqual(await call(f.service,'knowledge.fileAdopt',params),legacy);const inspect=new DatabaseSync(path.join(f.library,'library.sqlite'));assert.equal((inspect.prepare('SELECT result_json FROM operations WHERE id=?').get(params.operationId) as {result_json:string}).result_json,oldBytes);inspect.close();
  const saved=await batch(f,'saved-source',true);assert.equal(saved.status,'complete');
});

test('membership staging uses committed support objects and never refreshes an unrelated working correction into the commit',native,async t=>{
  const f=await fixture(t);await adopt(f);let status=await call(f.service,'repository.status',{});await call(f.service,'repository.stage',{paths:status.unstaged.map(change=>change.path)});status=await call(f.service,'repository.status',{});await call(f.service,'repository.commit',{operationId:'facts-A',expectedHead:status.head,expectedTree:status.stagedTree,message:'Commit factual support A'});
  const ctx=await context(f),selected=await batch(f,'saved-source',true),prepared=await plan(f,ctx.contextId,selected);await call(f.service,'context.applyMembership',{operationId:'organization-B',planId:prepared.planId,expectedPlanHash:prepared.planHash});
  const objectId=artifact().collection.objects[0].id,base=await call(f.service,'knowledge.editContext',{objectId});await call(f.service,'knowledge.saveEdit',{operationId:'unrelated-C',objectId,assertionId:'claim:0',expectedHead:base.head,expectedObjectHash:base.objectHash,change:{mode:'correct',propertyId:'fixture:affiliation',value:{kind:'text',value:'Working correction C'},evidence:{sourceId:'fixture:source',locator:'Correction'},review:'adopted',reason:'This correction must stay outside the organization commit'}});
  const paths=[navigationDefinitionPath(ctx.contextId),...prepared.paths],dependencies=await call(f.service,'repository.stagePlan',{paths});assert.deepEqual(dependencies.required,[]);assert.deepEqual(dependencies.missing,[]);await call(f.service,'repository.stage',{paths});status=await call(f.service,'repository.status',{});const committed=await call(f.service,'repository.commit',{operationId:'commit-organization-only',expectedHead:status.head,expectedTree:status.stagedTree,message:'Commit organization B with factual support A'});
  const fixed=await call(f.service,'knowledge.object',{objectId,revision:committed.oid}),working=await call(f.service,'knowledge.object',{objectId});assert.equal(fixed.assertions[0].value.kind,'entity');assert.deepEqual(working.assertions[0].value,{kind:'text',value:'Working correction C'});assert.equal((await call(f.service,'context.get',{contextId:ctx.contextId,revision:committed.oid})).total,6);assert.ok((await call(f.service,'repository.status',{})).unstaged.some(change=>change.path===navigationObjectPath(objectId)));
});

test('batch source summaries are bounded while source pages and guarded plans retain every original source pin',native,async t=>{
  const f=await fixture(t),input=artifact();for(let index=0;index<35;index++){const body={fixture:'Additional original source',index};input.collection.sources.push({...structuredClone(input.collection.sources[0]),id:'extra-source:'+index,identity:{provider:'fixture',externalId:'Extra source '+index},contentHash:hash(body),record:body});}
  await writeFile(f.selected,JSON.stringify(input));await adopt(f);const selected=await batch(f);assert.equal(selected.sourceRefCount,36);assert.equal(selected.sourceRefs.length,30);
  const tail=await call(f.service,'context.batchSources',{batch:selected.batch,offset:30,limit:100});assert.equal(tail.total,36);assert.equal(tail.items.length,6);assert.deepEqual(tail.items,input.collection.sources.slice(30).map(source=>({sourceId:source.id,revision:source.revision,contentHash:source.contentHash})));
  const ctx=await context(f),prepared=await plan(f,ctx.contextId,selected),last=input.collection.sources.at(-1)!;assert.ok(prepared.dependencies.includes(navigationSourcePath(last.id)));
  await f.close();const repository=await createEditorialRepository({...git,dataDirectory:f.library,requireExistingHead:true});await repository.initialize();await repository.write([{path:navigationSourcePath(last.id),value:{...last,url:'https://example.invalid/changed-header'} as any}]);await repository.close();await f.reopen();
  const rejected=await api(f.service,'context.applyMembership',{operationId:'changed-last-pin',planId:prepared.planId,expectedPlanHash:prepared.planHash});assert.ok(!rejected.ok&&rejected.error.code==='CONTENT_CHANGED');assert.equal((await call(f.service,'context.get',{contextId:ctx.contextId})).total,0);
});

test('the Git namespace rejects malformed navigation paths and schemas before durable writes or index replacement',native,async t=>{
  const f=await fixture(t);await f.close();const repository=await createEditorialRepository({...git,dataDirectory:f.library,requireExistingHead:true});await repository.initialize();t.after(()=>repository.close());
  const name=navigationDefinitionPath('context:gate'),definition={schemaVersion:1,id:'context:gate',labels:{en:'A valid definition'},origin:'user-organization'},before=await readFile(path.join(f.library,'repository/.git/index'));
  await assert.rejects(repository.write([{path:'navigation/unbounded.json',value:definition as any}]),{code:'INVALID_PATH'});
  await assert.rejects(repository.write([{path:navigationSourcePath('must-not-write'),value:{id:'must-not-write'}},{path:name,value:{...definition,schemaVersion:2} as any}]),{code:'INVALID_REQUEST'});assert.equal(await repository.read(navigationSourcePath('must-not-write')),null);
  await assert.rejects(repository.stage([{path:name,value:{...definition,schemaVersion:2} as any}]),{code:'INVALID_REQUEST'});assert.deepEqual(await readFile(path.join(f.library,'repository/.git/index')),before);assert.equal(await repository.read(name),null);
});

test('interrupted empty journal creation initializes atomically while an unsupported existing schema is preserved and refused',native,async t=>{
  const f=await fixture(t);await f.close();await rm(path.join(f.library,'navigation.sqlite'),{force:true});const empty=new DatabaseSync(path.join(f.library,'navigation.sqlite'));empty.close();await f.reopen();assert.equal((await call(f.service,'context.list',{})).total,0);
  const saved=await context(f);await f.close();const existing=new DatabaseSync(path.join(f.library,'navigation.sqlite'));existing.exec('PRAGMA user_version=2');existing.close();const before=await readFile(path.join(f.library,'navigation.sqlite'));await f.reopen();const refused=await api(f.service,'context.list',{});assert.ok(!refused.ok);assert.deepEqual(await readFile(path.join(f.library,'navigation.sqlite')),before);
  const restore=new DatabaseSync(path.join(f.library,'navigation.sqlite'));restore.exec('PRAGMA user_version=1');restore.close();await f.restart();assert.equal((await call(f.service,'context.get',{contextId:saved.contextId})).definition.labels.en,'Maritime research');
});
