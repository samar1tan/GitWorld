import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeCollection } from '../../domain/src/knowledge.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import type { NavigationBootstrap } from '../../contracts/src/navigation-types.ts';
import type { KnowledgeSourceHeader, KnowledgeSourcePresentation } from '../../contracts/src/knowledge-workspace-types.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createLocalService } from './index.ts';
import { createLibraryBackup } from './library-backup.ts';
import { knowledgeSourceHeader } from './knowledge-display.ts';
import { createKnowledgeStore, knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { navigationBootstrapSeedFiles } from './navigation-tree.ts';
import { SOURCE_PRESENTATIONS_PATH, readSourcePresentations, sourcePresentationEntries, sourcePresentationsFile } from './knowledge-source-presentations.ts';
import { knowledgeCollectionFingerprint, loadTrustedKnowledgeBundle, type KnowledgeBundleManifest } from './trusted-bundled-knowledge.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const binary = process.env.GITWORLD_TEST_GIT ?? fileURLToPath(new URL('../../../.local/bundled-git/runtime/bin/git',import.meta.url));
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
const git = { gitExecutable: binary, gitExecPath: path.resolve(binary,'../../libexec/git-core') };
type Service = Awaited<ReturnType<typeof createLocalService>>;
const request = <M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']) => service.dispatch({protocolVersion:1,requestId:'source-presentation',method,params} as ServiceRequest<M>);
async function call<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const result = await request(service,method,params); assert.ok(result.ok,JSON.stringify(result)); return result.result as ServiceMethods[M]['result'];
}
const header = (value: {sources: KnowledgeSourceHeader[]}) => {const found=value.sources.find(source=>source.id==='fixture:derived');assert.ok(found);return found;};
function fixture(includeTitles = true) {
  const record = { manifest: { articleTitle:'Original external article',historyUrl:'https://example.invalid/history' }, citationTitle:'Original citation title', transformation:'A separately recorded source interpretation' };
  const source = {id:'fixture:derived',identity:{provider:'gitworld-source-binding',externalId:'opaque-source-slug'},revision:'source-v1',contentHash:sha(canonicalJson(record)),retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/source',adapterVersion:'fixture-v1',rights:{redistribution:'unknown' as const},record};
  const collection: KnowledgeCollection = {schemaVersion:1,objects:[{id:'fixture:council',identities:[],labels:{en:'A council','zh-CN':'议事机构'},descriptions:{},aliases:[],types:[]}],assertions:[{id:'fixture:claim',subjectId:'fixture:council',propertyId:'fixture:activity',value:{kind:'text',value:'An unchanged source statement'},qualifiers:[],evidence:[{sourceId:source.id,locator:'row 1',citation:'Original citation title'}],sourceSnapshotId:source.id,review:'adopted'}],sources:[source]};
  const title = (suffix: string): KnowledgeSourcePresentation => ({sourceId:source.id,revision:source.revision,contentHash:source.contentHash,labels:{en:'Collection '+suffix,'zh-CN':'来源集合 '+suffix}});
  const navigation: NavigationBootstrap = {schemaVersion:1,definitions:[],memberships:[],...(includeTitles?{sourcePresentations:[title('A')]}:{})};
  const files: Record<string,string> = {'collection.json':JSON.stringify(collection),'fields.json':JSON.stringify({schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'fixture:activity',labels:{en:'Recorded activity','zh-CN':'收录活动'}}],types:[]}),'rights.json':JSON.stringify({schemaVersion:1,redistribution:'unknown'})};
  const entry = (name: string) => ({path:name,bytes:Buffer.byteLength(files[name]),sha256:sha(files[name])});
  const manifest: KnowledgeBundleManifest = {schemaVersion:1,kind:'gitworld-knowledge-bundle',id:'presentation-fixture',labels:{en:'Fixture','zh-CN':'测试'},shards:[entry('collection.json')],fieldCatalog:entry('fields.json'),sourceRights:entry('rights.json'),collectionHash:knowledgeCollectionFingerprint(collection),counts:{objects:1,assertions:1,sources:1},sourceHashes:[{id:source.id,contentHash:source.contentHash}]};
  const refresh = () => {files['navigation.json']=JSON.stringify(navigation);manifest.navigation=entry('navigation.json');};
  const load = () => {refresh();const manifestText=JSON.stringify(manifest);return loadTrustedKnowledgeBundle({manifestText,expectedManifestHash:sha(manifestText),readText:async name=>files[name]});};
  async function save(directory: string) {refresh();await mkdir(directory,{recursive:true});const text=JSON.stringify(manifest);for(const[name,body]of Object.entries({...files,'manifest.json':text}))await writeFile(path.join(directory,name),body);return{manifestPath:path.join(directory,'manifest.json'),expectedManifestHash:sha(text)};}
  return {collection,source,title,navigation,files,manifest,load,save};
}

test('a trusted bilingual title validates exact source pins without changing any original collection bytes',async()=>{
  const f=fixture(),before=canonicalJson(f.collection),loaded=await f.load();
  assert.deepEqual(loaded.navigation!.sourcePresentations,[f.title('A')]);assert.equal(canonicalJson(loaded.collection),before);
  const files={...knowledgeCollectionSeedFiles(f.collection),...navigationBootstrapSeedFiles(loaded.navigation!,{id:f.manifest.id,manifestHash:'1'.repeat(64)},knowledgeCollectionSeedFiles(f.collection))};
  assert.deepEqual(readSourcePresentations(files),[f.title('A')]);
  const header=knowledgeSourceHeader(f.source,readSourcePresentations(files)[0]);assert.equal(header.labels!['zh-CN'],'来源集合 A');assert.equal(header.title!.en,'Original external article');assert.equal(header.contentHash,f.source.contentHash);assert.equal(header.rights.redistribution,'unknown');assert.equal('record' in header,false);
  assert.equal(knowledgeSourceHeader(f.source,{...f.title('A'),revision:'stale'}).labels,undefined);
  assert.equal(canonicalJson(f.collection),before);
});

test('duplicate, malformed, monolingual and stale source presentation pins fail before seed files are accepted',async()=>{
  const mutations: ((f: ReturnType<typeof fixture>)=>void)[] = [
    f=>f.navigation.sourcePresentations!.push(f.title('B')),
    f=>f.navigation.sourcePresentations![0].sourceId='missing',
    f=>f.navigation.sourcePresentations![0].revision='source-v2',
    f=>f.navigation.sourcePresentations![0].contentHash='0'.repeat(64),
    f=>delete (f.navigation.sourcePresentations![0].labels as any)['zh-CN'],
    f=>f.navigation.sourcePresentations![0].labels.en=' ',
    f=>(f.navigation.sourcePresentations![0] as any).rights={redistribution:'allowed'},
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(f.load,/VALIDATION_FAILED/);}
  const f=fixture();assert.throws(()=>sourcePresentationEntries([{...f.title('A'),labels:{en:'A','zh-CN':'甲',other:'unsupported'}}]),/VALIDATION_FAILED/);
  const files=knowledgeCollectionSeedFiles(f.collection);files[SOURCE_PRESENTATIONS_PATH]={schemaVersion:2,kind:'gitworld-source-presentations',sources:[]};assert.throws(()=>readSourcePresentations(files),/VALIDATION_FAILED/);
  assert.deepEqual(readSourcePresentations(knowledgeCollectionSeedFiles(f.collection)),[]);
});

test('real service source headers and batches retain old OIDs, frozen B and Working C through restart and full backup',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-source-titles-')),library=path.join(directory,'library'),bundlePath=path.join(directory,'bundle'),backup=path.join(directory,'full.gitworld'),selected=path.join(directory,'selection.json'),f=fixture();await writeFile(selected,JSON.stringify(f.collection));
  let seed=await f.save(bundlePath),service=await createLocalService({dataDirectory:library,...git,seedKnowledgeBundle:seed,resolveFileToken:token=>token==='selection'?selected:backup});
  t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const original=await call(service,'repository.status',{});assert.equal(header(await call(service,'knowledge.object',{objectId:'fixture:council'})).labels!.en,'Collection A');
  const preview=await call(service,'knowledge.filePreview',{fileToken:'selection'}),adopted=await call(service,'knowledge.fileAdopt',{fileToken:'selection',expectedHead:original.head,expectedInputHash:preview.preview.inputHash,review:'adopted',operationId:'reused-source-selection'});assert.deepEqual(adopted.unchangedObjects,['fixture:council']);assert.deepEqual((await call(service,'repository.status',{})).unstaged,[]);
  await service.close();const repo=await createEditorialRepository({dataDirectory:library,...git});
  await repo.initialize();await repo.write([{path:SOURCE_PRESENTATIONS_PATH,value:sourcePresentationsFile([f.title('B')]) as unknown as EditorialJson}]);const stage=await repo.stage([{path:SOURCE_PRESENTATIONS_PATH}]);await repo.write([{path:SOURCE_PRESENTATIONS_PATH,value:sourcePresentationsFile([f.title('C')]) as unknown as EditorialJson}]);await repo.close();
  service=await createLocalService({dataDirectory:library,...git,seedKnowledgeBundle:seed,resolveFileToken:()=>backup});
  const before=await call(service,'knowledge.object',{objectId:'fixture:council',revision:original.head});const working=await call(service,'knowledge.object',{objectId:'fixture:council'});assert.equal(header(before).labels!.en,'Collection A');assert.equal(header(working).labels!.en,'Collection C');assert.deepEqual(before.assertions,working.assertions);
  assert.equal(header(await call(service,'knowledge.editContext',{objectId:'fixture:council'})).labels!.en,'Collection C');
  const changes=await call(service,'repository.changes',{mode:'working',offset:0,limit:25});assert.deepEqual(changes.items.map(item=>[item.path,item.group]),[[SOURCE_PRESENTATIONS_PATH,'mapping']]);
  await call(service,'backup.create',{fileToken:'backup',operationId:'save-titles-b-c'});
  const commit=await call(service,'repository.commit',{operationId:'titles-B',expectedHead:stage.head,expectedTree:stage.stagedTree,message:'Change display collection titles'});
  for(const[revision,name]of [[original.head,'A'],[commit.oid,'B'],['working','C']]){
    const detail=await call(service,'knowledge.object',{objectId:'fixture:council',revision});assert.equal(header(detail).labels!.en,'Collection '+name);assert.equal(header(detail).title!.en,'Original external article');assert.deepEqual(detail.assertions,before.assertions);
    const batches=await call(service,'context.batches',{revision});assert.equal(batches.total,3);assert.ok(batches.items.some(batch=>batch.batch.kind==='adopted-import'));assert.ok(batches.items.every(batch=>batch.labels.en==='Collection '+name));assert.ok(batches.items.every(batch=>batch.sourceRefs[0].contentHash===f.source.contentHash));
    assert.equal((await call(service,'knowledge.query',{revision,query:{text:'council'}})).total,1);
  }
  assert.deepEqual((await call(service,'repository.status',{})).unstaged.map(change=>change.path),[SOURCE_PRESENTATIONS_PATH]);
  await service.close();f.navigation.sourcePresentations=[f.title('Must not overlay C')];seed=await f.save(bundlePath);service=await createLocalService({dataDirectory:library,...git,seedKnowledgeBundle:seed,resolveFileToken:()=>backup});assert.equal(header(await call(service,'knowledge.object',{objectId:'fixture:council'})).labels!.en,'Collection C');
  await call(service,'backup.restore',{fileToken:'restore',operationId:'restore-titles-b-c'});const restored=await call(service,'repository.status',{});assert.equal(restored.head,original.head);assert.equal(restored.stagedTree,stage.stagedTree);assert.equal(header(await call(service,'knowledge.object',{objectId:'fixture:council'})).labels!.en,'Collection C');
  const restoredCommit=await call(service,'repository.commit',{operationId:'restored-titles-B',expectedHead:restored.head,expectedTree:restored.stagedTree,message:'Commit restored staged title B'});assert.equal(header(await call(service,'knowledge.object',{objectId:'fixture:council',revision:restoredCommit.oid})).labels!.en,'Collection B');
  await service.close();const check=await createEditorialRepository({dataDirectory:library,...git});try{await check.initialize();for(const[name,value]of Object.entries(knowledgeCollectionSeedFiles(f.collection)))for(const revision of [original.head,restoredCommit.oid,'working'])assert.deepEqual(await check.read(name,{from:revision}),value);}finally{await check.close();}
});

test('title metadata staging requires its exact source support and a frozen invalid title pin cannot be read as valid',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-source-title-dependency-')),repo=await createEditorialRepository({dataDirectory:directory,...git}),f=fixture();t.after(async()=>{await repo.close();await rm(directory,{recursive:true,force:true});});
  await repo.initialize();const source=Object.entries(knowledgeCollectionSeedFiles(f.collection)).find(([name])=>name.startsWith('sources/'))!;
  await repo.write([{path:source[0],value:source[1]},{path:SOURCE_PRESENTATIONS_PATH,value:sourcePresentationsFile([f.title('A')]) as unknown as EditorialJson}]);const store=createKnowledgeStore(repo),plan=await store.dependencies([SOURCE_PRESENTATIONS_PATH]);assert.deepEqual(plan.required,[source[0]]);assert.deepEqual(plan.missing,[]);
  const broken=await repo.stage([{path:SOURCE_PRESENTATIONS_PATH}]);await assert.rejects(()=>store.read('tree:'+broken.stagedTree),/VALIDATION_FAILED/);
  const supported=await repo.stage([{path:source[0]}]);assert.equal((await store.read('tree:'+supported.stagedTree)).sourcePresentations![0].labels.en,'Collection A');assert.deepEqual((await store.dependencies([SOURCE_PRESENTATIONS_PATH])).required,[]);
});

test('an invalid presentation inside an otherwise valid full backup is rejected before replacing the target',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-source-title-backup-')),source=path.join(directory,'source'),target=path.join(directory,'target'),bundlePath=path.join(directory,'bundle'),backup=path.join(directory,'bad.gitworld'),f=fixture(),seed=await f.save(bundlePath);
  const donor=await createLocalService({dataDirectory:source,...git,seedKnowledgeBundle:seed});await donor.close();
  const body=sourcePresentationsFile([f.title('A')]);body.sources[0].contentHash='0'.repeat(64);await writeFile(path.join(source,'repository',SOURCE_PRESENTATIONS_PATH),canonicalJson(body)+'\n');await createLibraryBackup({dataDirectory:source,destinationPath:backup});
  const service=await createLocalService({dataDirectory:target,...git,seedKnowledgeBundle:seed,resolveFileToken:()=>backup});t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const initial=await call(service,'repository.status',{}),name=path.join(target,'repository',SOURCE_PRESENTATIONS_PATH),bytes=await readFile(name,'utf8');
  const rejected=await request(service,'backup.restore',{fileToken:'bad',operationId:'reject-stale-title-pin'});assert.ok(!rejected.ok&&rejected.error.code==='BACKUP_INVALID',JSON.stringify(rejected));assert.deepEqual(await call(service,'repository.status',{}),initial);assert.equal(await readFile(name,'utf8'),bytes);assert.equal(header(await call(service,'knowledge.object',{objectId:'fixture:council'})).labels!.en,'Collection A');
});

test('a populated legacy library without presentation metadata keeps its original title after a newer bundle is installed',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-source-title-legacy-')),library=path.join(directory,'library'),bundlePath=path.join(directory,'bundle'),f=fixture(false);let seed=await f.save(bundlePath),service=await createLocalService({dataDirectory:library,...git,seedKnowledgeBundle:seed});t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const original=await call(service,'repository.status',{});assert.equal(header(await call(service,'knowledge.object',{objectId:'fixture:council'})).labels,undefined);await service.close();f.navigation.sourcePresentations=[f.title('New bundle')];seed=await f.save(bundlePath);service=await createLocalService({dataDirectory:library,...git,seedKnowledgeBundle:seed});
  const detail=await call(service,'knowledge.object',{objectId:'fixture:council'});assert.equal(header(detail).labels,undefined);assert.equal(header(detail).title!.en,'Original external article');assert.ok((await call(service,'context.batches',{})).items.every(batch=>batch.labels.en==='Original external article'));assert.equal((await call(service,'repository.status',{})).head,original.head);assert.equal(existsSync(path.join(library,'repository',SOURCE_PRESENTATIONS_PATH)),false);
});
