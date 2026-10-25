import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { KnowledgeCollection } from '../../domain/src/knowledge.ts';
import type { NavigationBootstrap } from '../../contracts/src/navigation-types.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import { validateServiceRequest } from '../../contracts/src/index.ts';
import { createLocalService } from './index.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { knowledgeCollectionFingerprint, loadTrustedKnowledgeBundle, type KnowledgeBundleManifest } from './trusted-bundled-knowledge.ts';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const binary=process.env.GITWORLD_TEST_GIT??path.join(fileURLToPath(new URL('../../../',import.meta.url)),'.local/bundled-git/runtime/bin/git');
const native={skip:!existsSync(binary)&&'Build the pinned bundled Git runtime.'},git={gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core')};
const profile={id:'fixture:organization',version:'1'};
function bundle(includeNavigation=true){
  const record={fixture:'Original collection bytes and rights do not change'},source={id:'fixture:source',identity:{provider:'fixture',externalId:'source'},revision:'1',contentHash:sha(canonicalJson(record)),retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid',adapterVersion:'fixture',rights:{redistribution:'unknown' as const},record};
  const collection:KnowledgeCollection={schemaVersion:1,objects:[{id:'fixture:council',labels:{en:'A council','zh-CN':'议事机构'},identities:[],descriptions:{},aliases:[],types:['fixture:structure']}],assertions:[{id:'claim',subjectId:'fixture:council',propertyId:'fixture:activity',value:{kind:'text',value:'Recorded council'},qualifiers:[],evidence:[{sourceId:source.id,locator:'Original record'}],sourceSnapshotId:source.id,review:'adopted'}],sources:[source]};
  const navigation:NavigationBootstrap={schemaVersion:1,definitions:[{schemaVersion:1,id:'context:fixture',labels:{en:'A research context','zh-CN':'研究背景'},origin:'source-profile',profile}],memberships:[{contextId:'context:fixture',objectId:'fixture:council',decision:{kind:'profile',recordedAt:'2026-10-25T00:00:00Z',profile,rationale:'A declared source-profile organization decision'},sourceRefs:[{sourceId:source.id,revision:source.revision,contentHash:source.contentHash}]}],typeRoles:[{typeId:'fixture:structure',role:'structure'}]};
  const files:Record<string,string>={'collection.json':JSON.stringify(collection),'fields.json':JSON.stringify({schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'fixture:activity',labels:{en:'Activity','zh-CN':'活动'}}],types:[{id:'fixture:structure',labels:{en:'Structure','zh-CN':'机构'}}]}),'rights.json':JSON.stringify({schemaVersion:1,redistribution:'unknown'})};
  const entry=(name:string)=>({path:name,bytes:Buffer.byteLength(files[name]),sha256:sha(files[name])});
  const manifest:KnowledgeBundleManifest={schemaVersion:1,kind:'gitworld-knowledge-bundle',id:'fixture-bundle',labels:{en:'Fixture','zh-CN':'测试'},shards:[entry('collection.json')],fieldCatalog:entry('fields.json'),sourceRights:entry('rights.json'),counts:{objects:1,assertions:1,sources:1},collectionHash:knowledgeCollectionFingerprint(collection),sourceHashes:[{id:source.id,contentHash:source.contentHash}]};
  const refresh=()=>{files['navigation.json']=JSON.stringify(navigation);if(includeNavigation)manifest.navigation=entry('navigation.json');};refresh();
  const load=()=>{refresh();const manifestText=JSON.stringify(manifest);return loadTrustedKnowledgeBundle({manifestText,expectedManifestHash:sha(manifestText),readText:async name=>files[name]});};
  return{collection,navigation,files,manifest,refresh,load};
}
type Service=Awaited<ReturnType<typeof createLocalService>>;
async function call<M extends ServiceMethod>(service:Service,method:M,params:ServiceMethods[M]['params']):Promise<ServiceMethods[M]['result']>{const value=await service.dispatch({protocolVersion:1,requestId:'bootstrap-test',method,params} as ServiceRequest);assert.ok(value.ok,JSON.stringify(value));return value.result as ServiceMethods[M]['result'];}

test('a pinned optional bootstrap validates every target and source while roles annotate only the final catalog copy',async()=>{
  const f=bundle(),original={...f.files},loaded=await f.load();assert.equal(loaded.navigation!.memberships.length,1);assert.equal(loaded.fieldCatalog.types[0].navigationRole,'structure');
  assert.equal(knowledgeCollectionFingerprint(loaded.collection),knowledgeCollectionFingerprint(f.collection));assert.equal(loaded.collection.sources[0].rights.redistribution,'unknown');assert.equal(f.files['fields.json'],original['fields.json']);assert.equal(f.files['collection.json'],original['collection.json']);
  const old=await bundle(false).load();assert.equal(old.navigation,undefined);assert.equal(old.fieldCatalog.types[0].navigationRole,undefined);
  const missingObject=bundle();missingObject.navigation.memberships[0].objectId='missing';await assert.rejects(missingObject.load,/VALIDATION_FAILED/);
  const missingSource=bundle();missingSource.navigation.memberships[0].sourceRefs![0].sourceId='missing';await assert.rejects(missingSource.load,/VALIDATION_FAILED/);
  const wrongSource=bundle();wrongSource.navigation.memberships[0].sourceRefs![0].contentHash='0'.repeat(64);await assert.rejects(wrongSource.load,/VALIDATION_FAILED/);
  const unknown=bundle();(unknown.navigation as any).schemaVersion=2;await assert.rejects(unknown.load,/VALIDATION_FAILED/);
  const duplicate=bundle();duplicate.navigation.typeRoles!.push(duplicate.navigation.typeRoles![0]);await assert.rejects(duplicate.load,/VALIDATION_FAILED/);
  const absentType=bundle();absentType.navigation.typeRoles![0].typeId='missing';await assert.rejects(absentType.load,/KNOWLEDGE_BUNDLE_CONFLICT/);
  const unsafe=bundle();unsafe.manifest.navigation!.path='../outside.json';const text=JSON.stringify(unsafe.manifest);await assert.rejects(()=>loadTrustedKnowledgeBundle({manifestText:text,expectedManifestHash:sha(text),readText:async()=>{throw Error('Unsafe path must not be read');}}),/INVALID_KNOWLEDGE_BUNDLE/);
  const tampered=bundle(),text2=JSON.stringify(tampered.manifest);tampered.files['navigation.json']+=' ';await assert.rejects(()=>loadTrustedKnowledgeBundle({manifestText:text2,expectedManifestHash:sha(text2),readText:async name=>tampered.files[name]}),/KNOWLEDGE_BUNDLE_HASH_MISMATCH/);
});

test('only empty-library initialization writes validated bootstrap metadata; reopen and restore do not replace organization',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-navigation-seed-')),library=path.join(directory,'library'),bundlePath=path.join(directory,'bundle');await mkdir(bundlePath);const f=bundle();
  async function save(){f.refresh();const text=JSON.stringify(f.manifest);for(const[name,body]of Object.entries({...f.files,'manifest.json':text}))await writeFile(path.join(bundlePath,name),body);return{manifestPath:path.join(bundlePath,'manifest.json'),expectedManifestHash:sha(text)};}
  const backup=path.join(directory,'full.gitworld'),options=()=>({dataDirectory:library,...git,seedKnowledgeBundle:seed,resolveFileToken:(token:string)=>token==='backup'||token==='restore'?backup:undefined});
  let seed=await save(),service=await createLocalService(options());t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const first=await call(service,'context.list',{});assert.equal(first.items[0].members,1);assert.equal(first.counts.objects,1);assert.equal(first.counts.assigned,1);const initial=await call(service,'repository.status',{});assert.deepEqual(initial.unstaged,[]);
  const context=await call(service,'context.get',{contextId:'context:fixture'});assert.equal(context.members[0].batchRef.kind,'trusted-bundle');assert.ok(context.members[0].batchRef.kind==='trusted-bundle'&&context.members[0].batchRef.manifestHash===seed.expectedManifestHash);
  assert.equal((await call(service,'knowledge.query',{query:{contextIds:['context:fixture']}})).coverage!.typeCounts[0].navigationRole,'structure');
  const forbidden=validateServiceRequest({protocolVersion:1,requestId:'forged',method:'context.membershipPlan',params:{contextId:'context:fixture',expectedHead:initial.head,expectedDefinitionHash:context.contentHash,mode:'add',batch:context.members[0].batchRef}});assert.equal(forbidden.ok,false);
  await call(service,'backup.create',{fileToken:'backup',operationId:'backup-original-bootstrap'});
  await call(service,'context.save',{operationId:'local-profile-label',contextId:'context:fixture',expectedHead:initial.head,expectedContentHash:context.contentHash,labels:{en:'A local name','zh-CN':'本地名称'}});const edited=await call(service,'context.get',{contextId:'context:fixture'});assert.equal(edited.definition.origin,'source-profile');assert.deepEqual(edited.definition.profile,profile);assert.deepEqual(edited.members[0].decision,context.members[0].decision);
  await service.close();f.navigation.definitions[0].labels.en='Must not replace the existing definition';f.navigation.typeRoles![0].role='person';seed=await save();service=await createLocalService(options());
  assert.equal((await call(service,'context.get',{contextId:'context:fixture'})).definition.labels.en,'A local name');assert.equal((await call(service,'context.get',{contextId:'context:fixture',revision:initial.head})).definition.labels.en,'A research context');assert.equal((await call(service,'knowledge.query',{query:{}})).coverage!.typeCounts[0].navigationRole,'structure');assert.equal((await call(service,'repository.status',{})).head,initial.head);
  await call(service,'context.save',{operationId:'later-manual-context',expectedHead:initial.head,expectedContentHash:null,labels:{en:'Later local context'}});await call(service,'backup.restore',{fileToken:'restore',operationId:'restore-bootstrap'});
  assert.equal((await call(service,'context.list',{})).total,1);assert.equal((await call(service,'context.get',{contextId:'context:fixture'})).definition.labels.en,'A research context');assert.equal((await call(service,'knowledge.query',{query:{}})).coverage!.typeCounts[0].navigationRole,'structure');
});

test('opening a populated old library with the new bundle does not install contexts or leak bootstrap roles through a missing legacy pin',native,async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-navigation-legacy-')),library=path.join(directory,'library'),bundlePath=path.join(directory,'bundle'),selected=path.join(directory,'legacy.json'),f=bundle();await mkdir(bundlePath);await writeFile(selected,JSON.stringify(f.collection));let service=await createLocalService({dataDirectory:library,...git,resolveFileToken:()=>selected});t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  const preview=await call(service,'knowledge.filePreview',{fileToken:'legacy'});await call(service,'knowledge.fileAdopt',{fileToken:'legacy',expectedHead:(await call(service,'repository.status',{})).head,expectedInputHash:preview.preview.inputHash,review:'adopted',operationId:'legacy-facts'});let status=await call(service,'repository.status',{});await call(service,'repository.stage',{paths:status.unstaged.map(change=>change.path)});status=await call(service,'repository.status',{});const committed=await call(service,'repository.commit',{operationId:'commit-legacy',expectedHead:status.head,expectedTree:status.stagedTree,message:'Existing factual library'});await service.close();assert.equal(existsSync(path.join(library,'legacy-field-catalog.json')),false);
  f.refresh();const text=JSON.stringify(f.manifest);for(const[name,body]of Object.entries({...f.files,'manifest.json':text}))await writeFile(path.join(bundlePath,name),body);service=await createLocalService({dataDirectory:library,...git,resolveFileToken:()=>undefined,seedKnowledgeBundle:{manifestPath:path.join(bundlePath,'manifest.json'),expectedManifestHash:sha(text)}});
  const contexts=await call(service,'context.list',{});assert.equal(contexts.total,0);assert.deepEqual(contexts.counts,{objects:1,assigned:0,unassigned:1});assert.equal((await call(service,'knowledge.query',{query:{},revision:committed.oid})).coverage!.typeCounts[0].navigationRole,undefined);assert.equal((await call(service,'repository.status',{})).head,committed.oid);assert.deepEqual((await call(service,'repository.status',{})).unstaged,[]);
});
