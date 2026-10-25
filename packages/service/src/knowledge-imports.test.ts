import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeImportArtifact } from '../../contracts/src/knowledge-import-types.ts';
import type { KnowledgeFileImportRequest, KnowledgeFieldCatalog } from '../../contracts/src/knowledge-workspace-types.ts';
import type { EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createKnowledgeStore, knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { createKnowledgeEditor } from './knowledge-editor.ts';
import { createKnowledgeImports, knowledgeArtifactHash, validateKnowledgeImportDirectory } from './knowledge-imports.ts';
import { parseKnowledgeImportArtifact, readSelectedKnowledgeCollectionFile } from './knowledge-collection-files.ts';
import { loadLegacyFieldCatalog, planKnowledgeVocabulary, vocabularyBaselinePath, vocabularyHash as hash, vocabularyPath } from './knowledge-vocabulary.ts';
import { createLocalService } from './index.ts';
import { createLibraryBackup } from './library-backup.ts';

const root=fileURLToPath(new URL('../../../',import.meta.url)),binary=process.env.GITWORLD_TEST_GIT??path.join(root,'.local/bundled-git/runtime/bin/git');
const native={skip:!existsSync(binary)&&'Build the pinned bundled Git runtime.'};
const git={gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core')};
const objectPath=(id='fixture:subject')=>`objects/${hash(id)}.json`;
const retainedReview={reviewConflicts:{kind:'wikipedia-mapping' as const,jobId:'a'.repeat(64)}};
function artifact(version='A',catalogId='fixture:catalog'):KnowledgeImportArtifact{
  const record={fixture:'Selected synthetic fact',version},sourceId=`fixture:source:${version}`,contentHash=hash(record);
  return{schemaVersion:1,kind:'gitworld-knowledge-import',collection:{schemaVersion:1,
    objects:[{id:'fixture:subject',identities:[],labels:{en:'Subject','zh-CN':'对象'},descriptions:{},aliases:[],types:['fixture:type']}],
    assertions:[{id:'fixture:claim',subjectId:'fixture:subject',propertyId:'fixture:field',value:{kind:'text',value:version,language:'en'},qualifiers:[{propertyId:'fixture:basis',value:{kind:'text',value:'legal'}}],sourceSnapshotId:sourceId,evidence:[{sourceId,locator:'selected row'}],review:'unreviewed',validTime:{point:{earliestYear:630,latestYear:630,precision:'year',calendar:'test'}}}],
    sources:[{id:sourceId,identity:{provider:'fixture',externalId:version},revision:version,contentHash,retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/source',adapterVersion:'fixture',rights:{redistribution:'unknown'},record}]},
    vocabulary:{id:catalogId,revision:version,catalog:{schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'fixture:field',labels:{en:`Field ${version}`,'zh-CN':`字段${version}`}},{id:'fixture:basis',labels:{en:'Basis','zh-CN':'依据'}}],types:[{id:'fixture:type',labels:{en:`Type ${version}`,'zh-CN':`类型${version}`}}],values:[{propertyId:'fixture:basis',value:'legal',labels:{en:'Legal basis','zh-CN':'法定依据'}}]},origin:{identity:{provider:'fixture-editor',externalId:catalogId},url:'https://example.invalid/catalog',retrievedAt:'2026-10-25T00:00:00Z',rights:{redistribution:'unknown'},evidence:[{sourceId,sourceHash:contentHash,locator:'field names'}]}},
    sourceRights:{schemaVersion:1,redistribution:'unknown'},
  };
}
async function fixture(t:{after(fn:()=>unknown):void},legacy?:KnowledgeFieldCatalog){
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-vocabulary-')),library=path.join(directory,'library');
  const repo=await createEditorialRepository({dataDirectory:library,...git});await repo.initialize();
  const catalog=await loadLegacyFieldCatalog(library,legacy),store=createKnowledgeStore(repo,{fieldCatalog:catalog});
  const imports:ReturnType<typeof createKnowledgeImports>[]=[],editors:ReturnType<typeof createKnowledgeEditor>[]=[];
  const open=(options:Partial<Parameters<typeof createKnowledgeImports>[2]>={},repository:EditorialRepository=repo)=>{const value=createKnowledgeImports(repository,store,{dataDirectory:library,legacy:catalog,...options});imports.push(value);return value;};
  const editor=()=>{const value=createKnowledgeEditor(repo,{dataDirectory:library,catalog});editors.push(value);return value;};
  t.after(async()=>{for(const value of imports)await value.close();for(const value of editors)await value.close();await repo.close();await rm(directory,{recursive:true,force:true});});
  return{directory,library,repo,store,open,editor,async selected(input=artifact(),id='file'){const file=path.join(directory,id+'.json');await writeFile(file,JSON.stringify(input));return{file,read:()=>readSelectedKnowledgeCollectionFile(file)};}};
}
async function request(f:Awaited<ReturnType<typeof fixture>>,imports:ReturnType<typeof createKnowledgeImports>,input=artifact(),operationId='adopt'){
  const selected=await f.selected(input,operationId),preview=await imports.preview(await selected.read());
  const params:KnowledgeFileImportRequest={fileToken:operationId,previewId:preview.prepared!.id,expectedHead:preview.prepared!.baseHead,expectedInputHash:preview.inputHash,review:'unreviewed',operationId};
  return{...selected,preview,params};
}

test('paired preview binds catalog, plan, exceptions and rights; malformed input is rejected before any Git write',native,async t=>{
  const f=await fixture(t),imports=f.open(),a=artifact(),first=await request(f,imports,a);
  const variants=[structuredClone(a),structuredClone(a),structuredClone(a),structuredClone(a)];
  variants[0].vocabulary!.catalog.properties[0].labels['zh-CN']='另一名称';
  variants[1].sourceRights={schemaVersion:1,note:'Different rights scope'};
  variants[2].projection={profileId:'profile',profileVersion:'1',libraryRevision:first.params.expectedHead,sourcePins:[{sourceId:a.collection.sources[0].id,contentHash:a.collection.sources[0].contentHash,revision:'A'}],plan:{rule:'one'},exceptions:[]};
  variants[3].projection={...variants[2].projection!,exceptions:[{code:'UNRESOLVED',locator:'row 2'}]};
  for(const [i,value]of variants.entries())assert.notEqual((await request(f,imports,value,'variant-'+i)).preview.inputHash,first.preview.inputHash);
  const reviewed=structuredClone(a);reviewed.collection.assertions[0].review='adopted';assert.equal(knowledgeArtifactHash(reviewed),first.preview.inputHash);
  const invalid=structuredClone(a);invalid.vocabulary!.origin.evidence[0].sourceHash='0'.repeat(64);assert.throws(()=>parseKnowledgeImportArtifact(JSON.stringify(invalid)));
  const duplicate=structuredClone(a);duplicate.vocabulary!.catalog.properties.push(duplicate.vocabulary!.catalog.properties[0]);assert.throws(()=>parseKnowledgeImportArtifact(JSON.stringify(duplicate)));
  const huge=structuredClone(a);huge.vocabulary!.catalog.properties[0].labels.en='x'.repeat(1024*1024);assert.throws(()=>parseKnowledgeImportArtifact(JSON.stringify(huge)));
  assert.deepEqual((await f.repo.status()).unstaged,[]);
});

test('selected-file changes reject first adoption; accepted retries retain stable content after restart and later edits',native,async t=>{
  const f=await fixture(t);let imports=f.open();const selected=await request(f,imports);
  await writeFile(selected.file,JSON.stringify(artifact('B')));await assert.rejects(imports.adopt(selected.params,selected.read),{message:'CONFLICT'});assert.deepEqual((await f.repo.status()).unstaged,[]);
  await writeFile(selected.file,JSON.stringify(artifact()));const saved=await imports.adopt(selected.params,selected.read);
  await imports.close();imports=f.open();await f.repo.write([{path:objectPath(),value:{...(await f.repo.read(objectPath())) as any,localMarker:'C'}}]);
  const before=await f.repo.read(objectPath());assert.deepEqual(await imports.adopt(selected.params,async()=>{throw Error('Expired file token must not be read');}),saved);assert.deepEqual(await f.repo.read(objectPath()),before);
  await assert.rejects(imports.adopt({...selected.params,review:'adopted'},selected.read),{message:'IDEMPOTENCY_CONFLICT'});
});

test('ordinary object/query/editor paths consume the same Git vocabulary with missing status and unchanged unknown rights',native,async t=>{
  const f=await fixture(t),imports=f.open(),a=artifact();a.sourceRights={schemaVersion:1,redistribution:'allowed',review:'A file cannot approve publication'};a.vocabulary!.catalog.properties.push({id:'fixture:untranslated',labels:{en:'English only'}});
  const selected=await request(f,imports,a),saved=await imports.adopt(selected.params,selected.read),detail=await f.store.objectDetail('fixture:subject');
  assert.equal(detail.display!.properties['fixture:field']['zh-CN'],'字段A');assert.equal(detail.display!.types['fixture:type']['zh-CN'],'类型A');assert.equal(detail.display!.qualifierValues['fixture:basis'].legal['zh-CN'],'法定依据');
  const query=(await f.store.index()).index.query({includeUndated:true,includeUnlocated:true});assert.equal(query.coverage!.typeCounts[0].labels!['zh-CN'],'类型A');
  const context=await f.editor().editContext({objectId:'fixture:subject'});assert.equal(context.catalog.properties.find(value=>value.id==='fixture:field')!.labels['zh-CN'],'字段A');assert.equal(context.catalog.properties.find(value=>value.id==='fixture:untranslated')!.labels.en,'English only');
  assert.equal(saved.preview.vocabulary!.missingCount,1);assert.deepEqual(detail.assertions[0].value,a.collection.assertions[0].value);assert.equal(detail.assertions[0].review,'unreviewed');
  assert.ok((await f.store.read()).collection.sources.every(value=>value.rights.redistribution==='unknown'));assert.ok(detail.sources.every(value=>!Object.hasOwn(value,'record')));assert.equal(detail.display!.vocabulary!.origin,'git');
  assert.equal((await f.repo.status()).staged.length,0);
});

test('frozen B and Working C retain their own catalogs; fixed A/B and a new process never drift to current labels',native,async t=>{
  const f=await fixture(t),imports=f.open();async function adopt(version:string){const value=await request(f,imports,artifact(version),'adopt-'+version);return imports.adopt(value.params,value.read);}
  const first=await adopt('A');await f.repo.stage(first.paths!.map(path=>({path})));let status=await f.repo.status();const a=await f.repo.commit({operationId:'commit-A',expectedHead:status.head,expectedTree:status.stagedTree,message:'A'});
  const second=await adopt('B');await f.repo.stage(second.paths!.map(path=>({path})));status=await f.repo.status();await adopt('C');
  const b=await f.repo.commit({operationId:'commit-B',expectedHead:status.head,expectedTree:status.stagedTree,message:'B'});
  const wrong=artifact('WRONG').vocabulary!.catalog,restarted=createKnowledgeStore(f.repo,{fieldCatalog:wrong});
  for(const [revision,expected]of [[a.oid,'A'],[b.oid,'B'],['working','C']]as const){const detail=await restarted.objectDetail('fixture:subject',revision);assert.equal(detail.display!.properties['fixture:field']['zh-CN'],'字段'+expected);assert.equal(detail.display!.types['fixture:type']['zh-CN'],'类型'+expected);assert.equal(detail.assertions[0].value.kind==='text'&&detail.assertions[0].value.value,expected);}
  assert.notEqual((await restarted.objectDetail('fixture:subject',a.oid)).display!.fingerprint,(await restarted.objectDetail('fixture:subject',b.oid)).display!.fingerprint);
});

test('catalog competition, deletion by omission and local corrections block the whole paired adoption without writes',native,async t=>{
  const f=await fixture(t),imports=f.open(),initial=await request(f,imports);await imports.adopt(initial.params,initial.read);
  const before=await f.repo.status(),competing=await request(f,imports,artifact('B','another:catalog'),'competing');assert.ok(competing.preview.vocabulary!.conflictCount>0);
  await assert.rejects(imports.adopt(competing.params,competing.read),(error:any)=>error.detail.code==='CONFLICT'&&error.detail.vocabularyConflicts.length>0);assert.deepEqual(await f.repo.status(),before);
  const omission=artifact('B');delete omission.vocabulary!.catalog.properties[0].labels['zh-CN'];const missing=await request(f,imports,omission,'omission');await assert.rejects(imports.adopt(missing.params,missing.read),{message:'CONFLICT'});assert.deepEqual(await f.repo.status(),before);
  const local=artifact();local.vocabulary!.revision='LOCAL';local.vocabulary!.catalog=artifact('LOCAL').vocabulary!.catalog;const snapshot=await f.repo.snapshot(),plan=planKnowledgeVocabulary(snapshot.files,local,knowledgeArtifactHash(local));await f.repo.write(plan.changes.filter(change=>change.path!==vocabularyBaselinePath(local.vocabulary!.id)));const localFile=await f.repo.read(vocabularyPath(local.vocabulary!.id));
  const incoming=await request(f,imports,artifact('NEXT'),'incoming');await assert.rejects(imports.adopt(incoming.params,incoming.read),{message:'CONFLICT'});assert.deepEqual(await f.repo.read(vocabularyPath(local.vocabulary!.id)),localFile);
});

async function reviewedConflict(f:Awaited<ReturnType<typeof fixture>>,imports:ReturnType<typeof createKnowledgeImports>){
  const initial=await request(f,imports);await imports.adopt(initial.params,initial.read);
  const editor=f.editor(),context=await editor.editContext({objectId:'fixture:subject'});
  await editor.saveEdit({operationId:'local-before-source-update',objectId:'fixture:subject',assertionId:'fixture:claim',expectedHead:context.head,expectedObjectHash:context.objectHash,change:{mode:'correct',propertyId:'fixture:field',value:{kind:'text',value:'LOCAL',language:'en'},evidence:{sourceId:'fixture:source:A',locator:'Local review'},review:'unreviewed',reason:'Preserve this local review while considering the next source'}});
  const incoming=artifact('B');incoming.vocabulary!.catalog.properties.push({id:'fixture:new-field',labels:{en:'New field','zh-CN':'新增字段'}});
  incoming.collection.assertions.push({...structuredClone(incoming.collection.assertions[0]),id:'fixture:new-claim',propertyId:'fixture:new-field',value:{kind:'text',value:'A newly mapped value'}});
  return{initial,incoming,selected:await request(f,imports,incoming,'source-update')};
}

test('paired conflict review cannot commit an incoming new field before its complete catalog adoption',native,async t=>{
  const f=await fixture(t),imports=f.open(),prepared=await reviewedConflict(f,imports),before=await f.repo.snapshot();
  await assert.rejects(imports.adopt(prepared.selected.params,prepared.selected.read),{message:'CONFLICT'});assert.deepEqual(await f.repo.snapshot(),before);assert.deepEqual(imports.pendingPaths(),[]);
  const report=await imports.adopt(prepared.selected.params,prepared.selected.read,retainedReview);
  assert.equal(report.conflicts.length,1);assert.deepEqual(report.changedObjects,[]);assert.ok(imports.pendingPaths().includes(objectPath()));
  assert.deepEqual(report.continuation,retainedReview.reviewConflicts);const raw=await f.store.conflicts();assert.equal(raw[0].continuation,undefined);
  assert.deepEqual(imports.annotateConflicts(raw),raw.map(value=>({...value,continuation:report.continuation})));
  const unrelated=structuredClone(raw);unrelated[0].local!.object.labels.en='A different current conflict';assert.equal(imports.annotateConflicts(unrelated)[0].continuation,undefined);
  await imports.close();await f.repo.close();
  const options={dataDirectory:f.library,...git,resolveFileToken:(token:string)=>token==='source-update'?prepared.selected.file:undefined};let service=await createLocalService(options);t.after(async()=>{await service.close();});
  const status=await call(service,'repository.status',{});await call(service,'knowledge.resolve',{objectId:'fixture:subject',choice:'incoming',expectedHead:status.head});
  const detail=await call(service,'knowledge.object',{objectId:'fixture:subject'});assert.ok(detail.assertions.some(value=>value.propertyId==='fixture:new-field'));assert.equal(detail.display!.properties['fixture:new-field']?.['zh-CN'],undefined);
  const stage=await api(service,'repository.stage',{paths:[objectPath()]});assert.ok(!stage.ok&&stage.error.code==='REVIEW_REQUIRED');assert.equal(stage.error.parameters?.reason,'incomplete-paired-import');
  await service.close();service=await createLocalService(options);assert.deepEqual(await call(service,'knowledge.pendingImports',{}),[]);assert.ok((await call(service,'repository.stagePlan',{paths:[objectPath()]})).incomplete!.includes(objectPath()));
  const preview=await call(service,'knowledge.filePreview',{fileToken:'source-update'}),accepted=await call(service,'knowledge.fileAdopt',{fileToken:'source-update',operationId:'complete-reviewed-source',previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'unreviewed'});
  assert.deepEqual(accepted.conflicts,[]);assert.equal((await call(service,'knowledge.object',{objectId:'fixture:subject'})).display!.properties['fixture:new-field']['zh-CN'],'新增字段');
  const paths=(await call(service,'repository.status',{})).unstaged.map(value=>value.path);await call(service,'repository.stage',{paths});const frozen=await call(service,'repository.status',{});const committed=await call(service,'repository.commit',{operationId:'commit-complete-pair',expectedHead:frozen.head,expectedTree:frozen.stagedTree,message:'Adopt the reviewed source and its complete vocabulary'});
  await service.close();service=await createLocalService(options);assert.equal((await call(service,'knowledge.object',{objectId:'fixture:subject',revision:committed.oid})).display!.properties['fixture:new-field']['zh-CN'],'新增字段');
  assert.deepEqual(await call(service,'knowledge.resumeImport',{operationId:prepared.selected.params.operationId,previewId:prepared.selected.params.previewId!}),report);
  assert.equal((await call(service,'repository.stagePlan',{paths:[objectPath()]})).incomplete,undefined);
});

test('paired conflict evidence resumes prepared, partial, written and lost-receipt phases through the existing import receipt',native,async t=>{
  for(const point of ['after-prepare','partial-write','after-write','after-receipt']as const)await t.test(point,async sub=>{
    const f=await fixture(sub);let imports=f.open();const prepared=await reviewedConflict(f,imports);await imports.close();
    let once=true;const wrapped:EditorialRepository={...f.repo,async write(changes,guards){if(point==='partial-write'&&once){once=false;await f.repo.write(changes.slice(0,1),guards);throw Error('Interrupted conflict evidence');}return f.repo.write(changes,guards);}};
    imports=f.open({onFault:at=>{if(point===at&&once){once=false;throw Error('Interrupted conflict evidence');}}},wrapped);
    const before=await f.repo.read(objectPath()),catalog=await f.repo.read(vocabularyPath('fixture:catalog'));await assert.rejects(imports.adopt(prepared.selected.params,prepared.selected.read,retainedReview),/Interrupted conflict evidence/);
    assert.deepEqual(await f.repo.read(objectPath()),before);assert.deepEqual(await f.repo.read(vocabularyPath('fixture:catalog')),catalog);validateKnowledgeImportDirectory(f.library);
    await imports.close();await f.repo.close();const service=await createLocalService({dataDirectory:f.library,...git,resolveFileToken:()=>{throw Error('Expired token must not be used');}});sub.after(async()=>{await service.close();});
    const pending=await call(service,'knowledge.pendingImports',{});assert.equal(pending.length,point==='after-receipt'?0:1);
    if(pending.length){const refused=await api(service,'knowledge.resolve',{objectId:'fixture:subject',choice:'incoming',expectedHead:prepared.selected.params.expectedHead});assert.ok(!refused.ok&&refused.error.code==='REVIEW_REQUIRED');}
    const input={operationId:prepared.selected.params.operationId,previewId:prepared.selected.params.previewId!},report=await call(service,'knowledge.resumeImport',input);
    assert.equal(report.conflicts.length,1);assert.deepEqual(await call(service,'knowledge.resumeImport',input),report);assert.deepEqual(await call(service,'knowledge.conflicts',{}),report.conflicts.map(value=>({...value,continuation:report.continuation})));
    assert.deepEqual((await call(service,'knowledge.object',{objectId:'fixture:subject'})).assertions,(before as any).assertions);assert.deepEqual(await call(service,'knowledge.pendingImports',{}),[]);
    await call(service,'knowledge.resolve',{objectId:'fixture:subject',choice:'local',expectedHead:prepared.selected.params.expectedHead});assert.deepEqual(await call(service,'knowledge.conflicts',{}),[]);
    assert.ok((await call(service,'repository.stagePlan',{paths:[objectPath()]})).incomplete!.includes(objectPath()));
  });
});

test('paired conflict review validates the whole candidate before evidence writes and rejects damaged prepared or changed HEAD recovery',native,async t=>{
  await t.test('vocabulary conflict precedes evidence',async sub=>{
    const f=await fixture(sub),imports=f.open(),prepared=await reviewedConflict(f,imports),competing=structuredClone(prepared.incoming);competing.vocabulary!.id='fixture:competing';competing.vocabulary!.origin.identity.externalId='fixture:competing';
    const selected=await request(f,imports,competing,'competing-with-local-edit'),before=await f.repo.snapshot();await assert.rejects(imports.adopt(selected.params,selected.read),{message:'CONFLICT'});assert.deepEqual(await f.repo.snapshot(),before);assert.deepEqual(await f.store.conflicts(),[]);
  });
  await t.test('cross-object duplicate assertion is not valid evidence',async sub=>{
    const f=await fixture(sub),imports=f.open(),prepared=await reviewedConflict(f,imports),outside={schemaVersion:1,object:{...artifact().collection.objects[0],id:'fixture:outside'},assertions:[{...artifact().collection.assertions[0],id:'fixture:new-claim',subjectId:'fixture:outside'}]};
    await f.repo.write([{path:objectPath('fixture:outside'),value:outside as any}]);const selected=await request(f,imports,prepared.incoming,'invalid-complete-candidate'),before=await f.repo.snapshot();
    await assert.rejects(imports.adopt(selected.params,selected.read),/DUPLICATE_KNOWLEDGE_ID/);assert.deepEqual(await f.repo.snapshot(),before);assert.deepEqual(await f.store.conflicts(),[]);
  });
  await t.test('recomputed envelope cannot add an object write to conflict review',async sub=>{
    const f=await fixture(sub);let imports=f.open();const prepared=await reviewedConflict(f,imports);await imports.close();imports=f.open({onFault:at=>{if(at==='after-prepare')throw Error('Prepared review');}});await assert.rejects(imports.adopt(prepared.selected.params,prepared.selected.read,retainedReview),/Prepared review/);await imports.close();
    const database=new DatabaseSync(path.join(f.library,'knowledge-imports.sqlite')),row=database.prepare('SELECT prepared FROM operations WHERE id=?').get(prepared.selected.params.operationId) as {prepared:string},value=JSON.parse(row.prepared);value.changes.push({path:objectPath(),value:value.result.conflicts[0].incoming});value.result.paths.push(objectPath());value.hash=hash({...value,hash:''});database.prepare('UPDATE operations SET prepared=? WHERE id=?').run(canonicalJson(value),prepared.selected.params.operationId);database.close();
    const before=await f.repo.snapshot();assert.throws(()=>validateKnowledgeImportDirectory(f.library),/VALIDATION_FAILED/);assert.throws(()=>f.open(),/VALIDATION_FAILED/);assert.deepEqual(await f.repo.snapshot(),before);
  });
  await t.test('partial review cannot be moved to a new HEAD',async sub=>{
    const f=await fixture(sub);let imports=f.open();const prepared=await reviewedConflict(f,imports);await imports.close();imports=f.open({onFault:at=>{if(at==='after-prepare')throw Error('Prepared review');}});await assert.rejects(imports.adopt(prepared.selected.params,prepared.selected.read,retainedReview),/Prepared review/);await imports.close();
    await f.repo.write([{path:objectPath('fixture:outside'),value:{schemaVersion:1,object:{...artifact().collection.objects[0],id:'fixture:outside'},assertions:[]}}]);let status=await f.repo.status();await f.repo.stage(status.unstaged.map(value=>({path:value.path})));status=await f.repo.status();await f.repo.commit({operationId:'advance-before-review-write',expectedHead:status.head,expectedTree:status.stagedTree,message:'A separate technical concurrent update'});
    imports=f.open();const before=await f.repo.snapshot();await assert.rejects(imports.resume({operationId:prepared.selected.params.operationId,previewId:prepared.selected.params.previewId!}),{message:'HEAD_CHANGED'});assert.deepEqual(await f.repo.snapshot(),before);assert.deepEqual(await f.store.conflicts(),[]);
  });
});

test('complete-pair references reject damaged review identities and legacy report replay never adds continuation metadata',native,async t=>{
  await t.test('referenced operation and immutable review hash are both required',async sub=>{
    const f=await fixture(sub),imports=f.open(),prepared=await reviewedConflict(f,imports);await imports.adopt(prepared.selected.params,prepared.selected.read,retainedReview);
    await f.store.resolve('fixture:subject','incoming',prepared.selected.params.expectedHead);const complete=await request(f,imports,prepared.incoming,'later-complete');await imports.adopt(complete.params,complete.read);await imports.close();
    const database=new DatabaseSync(path.join(f.library,'knowledge-imports.sqlite')),row=database.prepare('SELECT prepared FROM operations WHERE id=?').get(complete.params.operationId)as{prepared:string},original=JSON.parse(row.prepared),before=await f.repo.snapshot();assert.equal(original.supersedes.length,1);
    for(const field of ['operationId','preparedHash']as const){const invalid=structuredClone(original);invalid.supersedes[0][field]=field==='operationId'?'missing-review':'0'.repeat(64);invalid.hash=hash({...invalid,hash:''});database.prepare('UPDATE operations SET prepared=? WHERE id=?').run(canonicalJson(invalid),complete.params.operationId);assert.throws(()=>validateKnowledgeImportDirectory(f.library),/VALIDATION_FAILED/);assert.deepEqual(await f.repo.snapshot(),before);}
    database.prepare('UPDATE operations SET prepared=? WHERE id=?').run(row.prepared,complete.params.operationId);database.close();validateKnowledgeImportDirectory(f.library);
  });
  await t.test('a stored legacy report remains byte-compatible',async sub=>{
    const f=await fixture(sub);let imports=f.open();const prepared=await reviewedConflict(f,imports);await imports.adopt(prepared.selected.params,prepared.selected.read,retainedReview);await imports.close();
    const database=new DatabaseSync(path.join(f.library,'knowledge-imports.sqlite')),row=database.prepare('SELECT prepared FROM operations WHERE id=?').get(prepared.selected.params.operationId)as{prepared:string},value=JSON.parse(row.prepared);delete value.result.continuation;value.hash=hash({...value,hash:''});const oldResult=canonicalJson(value.result);database.prepare('UPDATE operations SET prepared=?,result=? WHERE id=?').run(canonicalJson(value),oldResult,prepared.selected.params.operationId);database.close();
    imports=f.open();const result=await imports.resume({operationId:prepared.selected.params.operationId,previewId:prepared.selected.params.previewId!});assert.equal(canonicalJson(result),oldResult);assert.equal(result.continuation,undefined);assert.deepEqual(imports.annotateConflicts(await f.store.conflicts()),await f.store.conflicts());
  });
});

let sequence=0;
async function api<M extends ServiceMethod>(service:Awaited<ReturnType<typeof createLocalService>>,method:M,params:ServiceMethods[M]['params']){return service.dispatch({protocolVersion:1,requestId:'vocabulary-'+(++sequence),method,params}as ServiceRequest);}
async function call<M extends ServiceMethod>(service:Awaited<ReturnType<typeof createLocalService>>,method:M,params:ServiceMethods[M]['params']):Promise<ServiceMethods[M]['result']>{const response=await api(service,method,params);assert.ok(response.ok,JSON.stringify(response));return response.result as ServiceMethods[M]['result'];}

test('service staging requires exact catalog dependencies; malformed frozen catalogs cannot commit',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-catalog-stage-')),library=path.join(directory,'library'),file=path.join(directory,'input.json');await writeFile(file,JSON.stringify(artifact()));
  const options={dataDirectory:library,...git,resolveFileToken:(token:string,purpose:string)=>token==='file'&&purpose==='import'?file:undefined};let service=await createLocalService(options);
  t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const preview=await call(service,'knowledge.filePreview',{fileToken:'file'}),params={fileToken:'file',previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'unreviewed' as const,operationId:'service-adopt'};
  const journal=new DatabaseSync(path.join(library,'knowledge-imports.sqlite'));journal.exec("CREATE TRIGGER refuse_receipt BEFORE UPDATE OF result ON operations BEGIN SELECT RAISE(FAIL,'pending fixture'); END");
  const first=api(service,'knowledge.fileAdopt',params),queued=api(service,'repository.commit',{operationId:'queued-before-prepare',expectedHead:params.expectedHead,message:'Must not strand an unconfirmed import'});
  const [unconfirmed,commit]=await Promise.all([first,queued]);assert.ok(!unconfirmed.ok&&unconfirmed.error.code==='IO_ERROR');assert.ok(!commit.ok&&commit.error.code==='REVIEW_REQUIRED');
  const pendingStatus=await call(service,'repository.status',{});const terminal=await api(service,'command.execute',{input:{command:'git commit -m "Must wait"'},operationId:'terminal-before-receipt',expectedHead:params.expectedHead,expectedTree:pendingStatus.stagedTree});assert.ok(!terminal.ok&&terminal.error.code==='REVIEW_REQUIRED');
  journal.exec('DROP TRIGGER refuse_receipt');journal.close();await call(service,'knowledge.fileAdopt',params);
  const plan=await call(service,'repository.stagePlan',{paths:[objectPath()]});assert.ok(plan.required.includes(vocabularyPath('fixture:catalog')));assert.ok(plan.required.includes(vocabularyBaselinePath('fixture:catalog')));assert.ok(plan.required.some(path=>path.startsWith('sources/')));
  const refused=await api(service,'repository.stage',{paths:[objectPath()]});assert.ok(!refused.ok&&refused.error.code==='REVIEW_REQUIRED');
  const paths=[...new Set([...plan.selected,...plan.required])];await call(service,'repository.stage',{paths});let status=await call(service,'repository.status',{});await call(service,'repository.commit',{operationId:'commit-catalog',expectedHead:status.head,expectedTree:status.stagedTree,message:'Adopt vocabulary'});
  await service.close();const repo=await createEditorialRepository({dataDirectory:library,...git});await repo.initialize();const name=vocabularyPath('fixture:catalog'),active=await repo.read(name) as any;await repo.stage([{path:name,value:{...active,sourceId:'missing-source'}}]);await repo.close();service=await createLocalService(options);status=await call(service,'repository.status',{});
  const invalid=await api(service,'repository.commit',{operationId:'invalid-catalog',expectedHead:status.head,expectedTree:status.stagedTree,message:'Must fail'});assert.ok(!invalid.ok&&invalid.error.code==='VALIDATION_FAILED');
});

test('prepared/write/receipt failures and partial files recover with one input; later source collisions remain protected',native,async t=>{
  for(const point of ['after-prepare','after-write','after-receipt'] as const)await t.test(point,async sub=>{
    const f=await fixture(sub);let once=true,imports=f.open({onFault:at=>{if(at===point&&once){once=false;throw Error('Lost response');}}});const selected=await request(f,imports);await assert.rejects(imports.adopt(selected.params,selected.read),{message:'Lost response'});await imports.close();imports=f.open();
    if(point==='after-write'){const status=await f.repo.status();await f.repo.stage(status.unstaged.map(change=>({path:change.path})));const staged=await f.repo.status();await f.repo.commit({operationId:'late-commit',expectedHead:staged.head,expectedTree:staged.stagedTree,message:'Already written input'});}
    const saved=await imports.adopt(selected.params,async()=>{throw Error('No file token after restart');});assert.equal(saved.changedObjects[0],'fixture:subject');assert.deepEqual(imports.pendingPaths(),[]);assert.equal((await f.store.read()).collection.assertions.length,1);
  });
  await t.test('partial durable write',async sub=>{
    const f=await fixture(sub);let once=true;const wrapped:EditorialRepository={...f.repo,async write(changes,guards){if(once){once=false;await f.repo.write(changes.slice(0,2),guards);throw Error('Partial write');}return f.repo.write(changes,guards);}};
    let imports=f.open({},wrapped);const selected=await request(f,imports);await assert.rejects(imports.adopt(selected.params,selected.read),{message:'Partial write'});assert.ok(imports.pendingPaths().length>0);await imports.close();imports=f.open();await imports.adopt(selected.params,async()=>{throw Error('Expired token');});assert.equal((await f.store.objectDetail('fixture:subject')).display!.properties['fixture:field']['zh-CN'],'字段A');
  });
  await t.test('different immutable source collision',async sub=>{
    const f=await fixture(sub);let once=true,imports=f.open({onFault:at=>{if(at==='after-prepare'&&once){once=false;throw Error('Prepared');}}});const selected=await request(f,imports);await assert.rejects(imports.adopt(selected.params,selected.read));await imports.close();imports=f.open();const source=artifact().collection.sources[0],sourceName=`sources/${hash(source.id)}.json`;await f.repo.write([{path:sourceName,value:{...source,record:{changed:true}} as any}]);const collided=await f.repo.read(sourceName);await assert.rejects(imports.adopt(selected.params,selected.read),{message:'CONTENT_CHANGED'});assert.deepEqual(await f.repo.read(sourceName),collided);
  });
});

test('complete backup restores pending import and legacy pin; malformed optional metadata rejects before replacing the library',native,async t=>{
  const f=await fixture(t,artifact('LEGACY').vocabulary!.catalog);
  const old=knowledgeCollectionSeedFiles(artifact('OLD').collection);await f.repo.write(Object.entries(old).map(([path,value])=>({path,value})));await f.repo.stage(Object.keys(old).map(path=>({path})));const frozen=await f.repo.status();const oldCommit=await f.repo.commit({operationId:'old-library',expectedHead:frozen.head,expectedTree:frozen.stagedTree,message:'Legacy collection without a catalog'});
  assert.equal((await loadLegacyFieldCatalog(f.library,artifact('NEW').vocabulary!.catalog))!.properties[0].labels['zh-CN'],'字段LEGACY');
  let imports=f.open({onFault:at=>{if(at==='after-prepare')throw Error('Prepared');}});const selected=await request(f,imports);await assert.rejects(imports.adopt(selected.params,selected.read));await imports.close();await f.repo.close();
  const backup=path.join(f.directory,'pending.gitworld'),badBackup=path.join(f.directory,'bad.gitworld'),tokens=new Map([['backup',backup],['restore',backup],['bad',badBackup]]);
  const options={dataDirectory:f.library,...git,resolveFileToken:(token:string)=>tokens.get(token)};let service=await createLocalService(options);t.after(async()=>{await service.close();});
  const plan=await call(service,'repository.stagePlan',{paths:[objectPath()]});assert.ok(plan.incomplete!.includes(objectPath()));const blocked=await api(service,'repository.stage',{paths:[objectPath()]});assert.ok(!blocked.ok&&blocked.error.code==='REVIEW_REQUIRED');
  const oldDetail=await call(service,'knowledge.object',{objectId:'fixture:subject',revision:oldCommit.oid});assert.equal(oldDetail.display!.properties['fixture:field']['zh-CN'],'字段LEGACY');assert.equal(oldDetail.display!.vocabulary!.properties['fixture:field']['zh-CN'].origin,'legacy');
  const premature=await api(service,'repository.commit',{operationId:'must-wait',expectedHead:selected.params.expectedHead,message:'Unrelated commit must wait for the receipt'});assert.ok(!premature.ok&&premature.error.code==='REVIEW_REQUIRED');
  await call(service,'clientState.save',{key:'object-input',expectedVersion:null,value:{reason:'Recover this ordinary user input'}});await call(service,'backup.create',{fileToken:'backup',operationId:'backup-pending'});
  const first=await call(service,'knowledge.fileAdopt',selected.params);await call(service,'backup.restore',{fileToken:'restore',operationId:'restore-pending'});const pendingRestored=(await call(service,'knowledge.pendingImports',{}))[0];const restored=await call(service,'knowledge.resumeImport',{operationId:pendingRestored.operationId,previewId:pendingRestored.previewId});assert.deepEqual(restored,first);assert.equal((await call(service,'clientState.load',{key:'object-input'}))!.value&&((await call(service,'clientState.load',{key:'object-input'}))!.value as any).reason,'Recover this ordinary user input');
  const detail=await call(service,'knowledge.object',{objectId:'fixture:subject'});assert.equal(detail.display!.properties['fixture:field']['zh-CN'],'字段A');const pin=JSON.parse(await readFile(path.join(f.library,'legacy-field-catalog.json'),'utf8'));assert.equal(pin.catalog.properties[0].labels['zh-CN'],'字段LEGACY');
  const before=await call(service,'repository.status',{});await service.close();const candidate=path.join(f.directory,'candidate');await cp(f.library,candidate,{recursive:true});await writeFile(path.join(candidate,'legacy-field-catalog.json'),JSON.stringify({...pin,hash:'0'.repeat(64)}));await createLibraryBackup({dataDirectory:candidate,destinationPath:badBackup});service=await createLocalService(options);
  const bad=await api(service,'backup.restore',{fileToken:'bad',operationId:'reject-corrupt-pin'});assert.ok(!bad.ok&&bad.error.code==='BACKUP_INVALID');assert.deepEqual(await call(service,'repository.status',{}),before);assert.equal((await call(service,'knowledge.object',{objectId:'fixture:subject'})).display!.properties['fixture:field']['zh-CN'],'字段A');
});

test('ordinary pending summaries resume an accepted import after a real service restart without any file token',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-import-resume-')),library=path.join(directory,'library'),file=path.join(directory,'selected.json');await writeFile(file,JSON.stringify(artifact()));
  let tokensAvailable=true,forbiddenReads=0;
  const options={dataDirectory:library,...git,resolveFileToken:(token:string,purpose:string)=>{if(!tokensAvailable){forbiddenReads++;throw Error('The previous host token map no longer exists');}return token==='chosen'&&purpose==='import'?file:undefined;}};
  let service=await createLocalService(options);t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const preview=await call(service,'knowledge.filePreview',{fileToken:'chosen'}),params={fileToken:'chosen',previewId:preview.preview.prepared!.id,expectedHead:preview.preview.prepared!.baseHead,expectedInputHash:preview.preview.inputHash,review:'adopted' as const,operationId:'accepted-before-restart'};
  const journal=new DatabaseSync(path.join(library,'knowledge-imports.sqlite'));journal.exec("CREATE TRIGGER lose_ack BEFORE UPDATE OF result ON operations BEGIN SELECT RAISE(FAIL,'lost receipt fixture'); END");
  const failed=await api(service,'knowledge.fileAdopt',params);assert.ok(!failed.ok&&failed.error.code==='IO_ERROR');journal.exec('DROP TRIGGER lose_ack');journal.close();
  const beforeRestart=await call(service,'knowledge.pendingImports',{});assert.equal(beforeRestart.length,1);assert.equal(beforeRestart[0].review,'adopted');assert.ok(!JSON.stringify(beforeRestart).includes('Field A'));assert.ok(!JSON.stringify(beforeRestart).includes('Selected synthetic fact'));
  await service.close();tokensAvailable=false;service=await createLocalService(options);
  const pending=await call(service,'knowledge.pendingImports',{});assert.deepEqual(pending,beforeRestart);
  const recovered=pending[0],resume={operationId:recovered.operationId,previewId:recovered.previewId};
  const wrong=await api(service,'knowledge.resumeImport',{...resume,previewId:'0'.repeat(64)});assert.ok(!wrong.ok&&wrong.error.code==='CONFLICT');assert.deepEqual(await call(service,'knowledge.pendingImports',{}),pending);
  const blocked=await api(service,'repository.commit',{operationId:'still-blocked',expectedHead:recovered.baseHead,message:'Wait for the accepted receipt'});assert.ok(!blocked.ok&&blocked.error.code==='REVIEW_REQUIRED');
  const saved=await call(service,'knowledge.resumeImport',resume);assert.deepEqual(await call(service,'knowledge.pendingImports',{}),[]);assert.deepEqual(await call(service,'knowledge.resumeImport',resume),saved);assert.equal(forbiddenReads,0);
  let detail=await call(service,'knowledge.object',{objectId:'fixture:subject'});assert.equal(detail.assertions[0].review,'adopted');assert.equal(detail.display!.properties['fixture:field']['zh-CN'],'字段A');
  const context=await call(service,'knowledge.editContext',{objectId:'fixture:subject'});
  await call(service,'knowledge.saveEdit',{operationId:'later-working-C',expectedHead:context.head,expectedObjectHash:context.objectHash,objectId:'fixture:subject',assertionId:'fixture:claim',change:{mode:'correct',propertyId:'fixture:field',value:{kind:'text',value:'C',language:'en'},evidence:{sourceId:artifact().collection.sources[0].id,locator:'Local correction'},review:'adopted',reason:'Keep the subsequent working correction'}});
  assert.deepEqual(await call(service,'knowledge.resumeImport',resume),saved);assert.deepEqual(await call(service,'knowledge.fileAdopt',params),saved);assert.equal(forbiddenReads,0);
  detail=await call(service,'knowledge.object',{objectId:'fixture:subject'});assert.deepEqual(detail.assertions[0].value,{kind:'text',value:'C',language:'en'});
});
