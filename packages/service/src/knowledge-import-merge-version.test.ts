import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeCollection, KnowledgeObject } from '../../domain/src/knowledge.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeFileImportRequest, KnowledgeObjectBundle } from '../../contracts/src/knowledge-workspace-types.ts';
import type { KnowledgeImportArtifact } from '../../contracts/src/knowledge-import-types.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createKnowledgeStore, knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { createKnowledgeImports, validateKnowledgeImportDirectory } from './knowledge-imports.ts';
import { previewKnowledgeCollectionFile } from './knowledge-collection-files.ts';
import { vocabularyHash as hash } from './knowledge-vocabulary.ts';

const binary=path.resolve('.local/bundled-git/runtime/bin/git'),native={skip:!existsSync(binary)&&'Prepare bundled Git runtime'};
const id='fixture:shared-person',objectPath='objects/'+hash(id)+'.json',baselinePath='mappings/baseline-'+hash(id)+'.json';
const inputObject:KnowledgeObject={id,identities:[{provider:'fixture',externalId:id}],labels:{en:'A shared person'},descriptions:{},aliases:[],types:['fixture:listed-person']};
function collection(object:KnowledgeObject,suffix:string):KnowledgeCollection{
  const sourceId='fixture:source:'+suffix;
  return{schemaVersion:1,objects:[structuredClone(object)],assertions:[{id:'fixture:claim:'+suffix,subjectId:id,propertyId:'fixture:note',value:{kind:'text',value:suffix},qualifiers:[],evidence:[{sourceId,locator:'row 1'}],sourceSnapshotId:sourceId,review:'unreviewed'}],sources:[{id:sourceId,identity:{provider:'fixture-source',externalId:suffix},revision:suffix,contentHash:hash(suffix),retrievedAt:'2026-10-26T00:00:00Z',url:'https://example.invalid/'+suffix,adapterVersion:'fixture',rights:{redistribution:'unknown'}}]};
}
async function fixture(t:{after(fn:()=>unknown):void},richer=false,uncommittedBase=false){
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-merge-version-')),seed=structuredClone(inputObject);
  if(richer){seed.labels['zh-CN']='既有译名';seed.aliases.push({ja:'既存名'});seed.types.push('fixture:prior-role');}
  const before=collection(seed,'first'),incoming=collection(inputObject,'second');
  const repo=await createEditorialRepository({dataDirectory:directory,gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core')});
  await repo.initialize(knowledgeCollectionSeedFiles(before));
  if(uncommittedBase){const bundle=await repo.read(baselinePath) as unknown as KnowledgeObjectBundle;bundle.object.descriptions.fr='Earlier uncommitted metadata';await repo.write([{path:objectPath,value:bundle as unknown as EditorialJson},{path:baselinePath,value:bundle as unknown as EditorialJson}]);}
  const store=createKnowledgeStore(repo);
  const artifact:KnowledgeImportArtifact={schemaVersion:1,kind:'gitworld-knowledge-import',collection:incoming};
  const file=previewKnowledgeCollectionFile({name:'synthetic.json',text:canonicalJson(artifact)});
  let imports=createKnowledgeImports(repo,store,{dataDirectory:directory});
  t.after(async()=>{await imports.close();await repo.close();await rm(directory,{recursive:true,force:true});});
  const selected=await imports.preview(file),params:KnowledgeFileImportRequest={fileToken:'synthetic',operationId:'synthetic-adoption',previewId:selected.prepared!.id,expectedHead:selected.prepared!.baseHead,expectedInputHash:selected.inputHash,review:'unreviewed'};
  return{directory,repo,store,file,before,incoming,params,get imports(){return imports;},async restart(fault?:()=>void){await imports.close();imports=createKnowledgeImports(repo,store,{dataDirectory:directory,onFault:point=>{if(point==='after-prepare')fault?.();}});},async closeImports(){await imports.close();}};
}

// A prior internal schema has no merge-version or saved-base fields. Construct its
// canonical envelope explicitly; this is a synthetic compatibility fixture.
async function convertToLegacy(f:Awaited<ReturnType<typeof fixture>>,withOperation:boolean){
  await f.closeImports();
  const db=new DatabaseSync(path.join(f.directory,'knowledge-imports.sqlite'));
  try{
    const row=db.prepare('SELECT body FROM previews WHERE id=?').get(f.params.previewId!) as {body:string},preview=JSON.parse(row.body);
    delete preview.objectMergeVersion;preview.preview.prepared.id='';
    const legacyId=hash(preview);preview.preview.prepared.id=legacyId;
    db.prepare('INSERT INTO previews(id,body) VALUES(?,?)').run(legacyId,canonicalJson(preview));
    f.params.previewId=legacyId;
    if(withOperation){
      const operation=db.prepare('SELECT prepared FROM operations WHERE id=?').get(f.params.operationId) as {prepared:string},prepared=JSON.parse(operation.prepared);
      delete prepared.objectMergeVersion;delete prepared.appendBases;prepared.previewId=legacyId;prepared.result.preview=preview.preview;
      const legacy:KnowledgeObjectBundle={schemaVersion:1,object:structuredClone(f.incoming.objects[0]),assertions:[...f.before.assertions,...f.incoming.assertions].sort((a,b)=>a.id.localeCompare(b.id))};
      for(const change of prepared.changes)if(change.path===objectPath||change.path===baselinePath)change.value=structuredClone(legacy);
      prepared.result.objects=[{id,labels:structuredClone(f.incoming.objects[0].labels)}];prepared.hash='';prepared.hash=hash(prepared);
      db.prepare('UPDATE operations SET signature=?,prepared=? WHERE id=?').run(hash(f.params),canonicalJson(prepared),f.params.operationId);
      return prepared;
    }
  }finally{db.close();}
}

test('an unadopted legacy preview requires an ordinary new versioned preview before any working write',native,async t=>{
  const f=await fixture(t,true);await convertToLegacy(f,false);await f.restart();
  const before=await f.repo.snapshot();
  await assert.rejects(f.imports.adopt(f.params,async()=>f.file),(error:any)=>error.detail?.code==='REVIEW_REQUIRED'&&error.detail.parameters?.reason==='import-preview-merge-version-changed');
  assert.deepEqual(await f.repo.snapshot(),before);assert.deepEqual(f.imports.pending(),[]);
  const fresh=await f.imports.preview(f.file);assert.notEqual(fresh.prepared!.id,f.params.previewId);assert.equal(fresh.inputHash,f.params.expectedInputHash);
  const result=await f.imports.adopt({...f.params,operationId:'new-reviewed-adoption',previewId:fresh.prepared!.id},async()=>f.file);
  assert.deepEqual(result.conflicts,[]);assert.equal((await f.store.objectDetail(id)).object.labels['zh-CN'],'既有译名');
});

test('a nondestructive legacy pending plan resumes its exact bytes, while unsafe or unverifiable partial plans stay blocked with specific reasons',native,async t=>{
  for(const variant of ['safe','destructive','unverifiable']as const)await t.test(variant,async sub=>{
    const unsafe=variant!=='safe',f=await fixture(sub,unsafe,variant==='unverifiable');await f.restart(()=>{throw Error('Synthetic interruption after prepare');});
    await assert.rejects(f.imports.adopt(f.params,async()=>f.file),/Synthetic interruption/);
    const prepared=await convertToLegacy(f,true);
    if(unsafe)await f.repo.write(prepared.changes);
    await f.restart();validateKnowledgeImportDirectory(f.directory);
    const before=await f.repo.snapshot();
    if(unsafe){
      const reason=variant==='unverifiable'?'legacy-import-merge-unverifiable':'legacy-import-merge-review-required';
      await assert.rejects(f.imports.resume({operationId:f.params.operationId,previewId:f.params.previewId!}),(error:any)=>error.detail?.code==='REVIEW_REQUIRED'&&error.detail.parameters?.reason===reason);
      assert.deepEqual(await f.repo.snapshot(),before);assert.deepEqual(f.imports.pendingOperationIds(),[f.params.operationId]);assert.ok(f.imports.pendingPaths().includes(objectPath));
    }else{
      assert.equal(canonicalJson(await f.imports.resume({operationId:f.params.operationId,previewId:f.params.previewId!})),canonicalJson(prepared.result));
      assert.deepEqual(f.imports.pending(),[]);assert.deepEqual((await f.store.objectDetail(id)).object.labels,inputObject.labels);
    }
  });
});

test('a completed legacy receipt remains byte-identical and read-only without restoring lost metadata or overwriting later input',native,async t=>{
  const f=await fixture(t,true);await f.restart(()=>{throw Error('Synthetic interruption after prepare');});
  await assert.rejects(f.imports.adopt(f.params,async()=>f.file),/Synthetic interruption/);
  const prepared=await convertToLegacy(f,true);await f.repo.write(prepared.changes);
  const db=new DatabaseSync(path.join(f.directory,'knowledge-imports.sqlite')),bytes=canonicalJson(prepared.result);
  db.prepare('UPDATE operations SET result=? WHERE id=?').run(bytes,f.params.operationId);db.close();
  await f.restart();validateKnowledgeImportDirectory(f.directory);
  const local=await f.repo.read(objectPath) as unknown as KnowledgeObjectBundle;local.object.descriptions.en='A later deliberate local edit';
  await f.repo.write([{path:objectPath,value:local as unknown as EditorialJson}]);const before=await f.repo.snapshot();
  assert.equal(canonicalJson(await f.imports.adopt(f.params,async()=>{throw Error('No reader on completed replay');})),bytes);
  assert.equal(canonicalJson(await f.imports.resume({operationId:f.params.operationId,previewId:f.params.previewId!})),bytes);
  assert.deepEqual(await f.repo.snapshot(),before);assert.equal((await f.store.objectDetail(id)).object.labels['zh-CN'],undefined);
});

test('new pending plans preserve reviewed bases across restart and reject recomputed metadata tampering',native,async t=>{
  for(const tamper of [false,true])await t.test(tamper?'changed saved baseline':'normal partial recovery',async sub=>{
    const f=await fixture(sub,true);await f.restart(()=>{throw Error('Synthetic interruption after prepare');});
    await assert.rejects(f.imports.adopt(f.params,async()=>f.file),/Synthetic interruption/);await f.closeImports();
    const db=new DatabaseSync(path.join(f.directory,'knowledge-imports.sqlite')),row=db.prepare('SELECT prepared FROM operations WHERE id=?').get(f.params.operationId) as {prepared:string},prepared=JSON.parse(row.prepared);
    assert.equal(prepared.objectMergeVersion,2);
    if(tamper){prepared.appendBases[id].object.labels['zh-CN']='Tampered baseline';prepared.hash='';prepared.hash=hash(prepared);db.prepare('UPDATE operations SET prepared=? WHERE id=?').run(canonicalJson(prepared),f.params.operationId);}db.close();
    if(tamper){assert.throws(()=>validateKnowledgeImportDirectory(f.directory),/VALIDATION_FAILED/);return;}
    await f.repo.write(prepared.changes.slice(0,1));await f.restart();
    await f.imports.resume({operationId:f.params.operationId,previewId:f.params.previewId!});
    assert.equal((await f.store.objectDetail(id)).object.labels['zh-CN'],'既有译名');assert.deepEqual(f.imports.pending(),[]);
  });
});
