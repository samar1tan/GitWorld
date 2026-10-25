import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { combineKnowledgeCollections } from '../../ingestion/src/knowledge-mapping.ts';
import { KNOWLEDGE_IMPORT_MAX_BYTES, parseKnowledgeCollectionFile, previewKnowledgeCollectionFile, readSelectedKnowledgeCollectionFile } from './knowledge-collection-files.ts';
import { knowledgeCollectionFingerprint, loadTrustedKnowledgeBundle, partitionKnowledgeCollection, type KnowledgeBundleManifest } from './trusted-bundled-knowledge.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture():KnowledgeCollection {
  return {schemaVersion:1,objects:Array.from({length:8},(_,i)=>({id:`test:${i}`,identities:[],labels:{en:`Synthetic ${i}`},descriptions:{},aliases:[],types:[]})),assertions:Array.from({length:8},(_,i)=>({id:`claim:${i}`,subjectId:`test:${i}`,propertyId:'test:state',value:{kind:'text',value:'x'.repeat(1000),language:'en'},qualifiers:[],evidence:[{sourceId:'source',locator:`row ${i}`}],sourceSnapshotId:'source',review:'unreviewed'})),sources:[{id:'source',identity:{provider:'test',externalId:'1'},revision:'1',contentHash:'synthetic',retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid',adapterVersion:'test',rights:{redistribution:'unknown'}}]};
}
function bundle(collection=fixture()) {
  const parts=partitionKnowledgeCollection(collection,4200), files=new Map(parts.map(file=>[file.path,file.text]));
  const fields=JSON.stringify({schemaVersion:1,kind:'historical-field-display-labels',properties:[],types:[]}), rights=JSON.stringify({schemaVersion:1,dataLicense:'test-only'});
  files.set('fields.json',fields);files.set('rights.json',rights);
  const entry=(path:string)=>({path,bytes:Buffer.byteLength(files.get(path)!),sha256:hash(files.get(path)!)});
  const manifest:KnowledgeBundleManifest={schemaVersion:1,kind:'gitworld-knowledge-bundle',id:'synthetic',labels:{en:'Synthetic','zh-CN':'测试'},shards:parts.map(file=>entry(file.path)),fieldCatalog:entry('fields.json'),sourceRights:entry('rights.json'),collectionHash:knowledgeCollectionFingerprint(collection),counts:{objects:collection.objects.length,assertions:collection.assertions.length,sources:collection.sources.length},sourceHashes:collection.sources.map(value=>({id:value.id,contentHash:value.contentHash}))};
  const load=()=>{const manifestText=JSON.stringify(manifest);return loadTrustedKnowledgeBundle({manifestText,expectedManifestHash:hash(manifestText),readText:async path=>{assert.ok(files.has(path));return files.get(path)!;}});};
  return{parts,files,manifest,load};
}
test('source/whole-subject shards merge through the ordinary collection path without semantic or review changes',async()=>{
  const input=fixture(),{parts,load}=bundle(input);assert.ok(parts.length>2);for(const part of parts)assert.ok(part.bytes<=4200);
  const normal=combineKnowledgeCollections(parts.map(part=>parseKnowledgeCollectionFile(part.text)));assert.deepEqual(normal.conflicts,[]);assert.equal(knowledgeCollectionFingerprint(normal.collection),knowledgeCollectionFingerprint(input));
  const loaded=await load();assert.equal(loaded.collection.assertions.length,8);assert.ok(loaded.collection.assertions.every(value=>value.review==='unreviewed'));
  assert.equal(knowledgeCollectionFingerprint({...input,objects:[...input.objects].reverse()}),knowledgeCollectionFingerprint(input));
});
test('pinned bundle verifies exact bytes and rejects changed content or unsafe paths before reading',async()=>{
  const changed=bundle();changed.files.set(changed.parts[0].path,changed.parts[0].text+' ');await assert.rejects(changed.load,/KNOWLEDGE_BUNDLE_HASH_MISMATCH/);
  const unsafe=bundle();unsafe.manifest.shards[0].path='../outside.json';await assert.rejects(unsafe.load,/INVALID_KNOWLEDGE_BUNDLE/);
  const stale=bundle();stale.manifest.sourceHashes[0].contentHash='changed';await assert.rejects(stale.load,/KNOWLEDGE_BUNDLE_MISMATCH/);
});
test('a conflicting duplicate object is reported rather than selected by shard order',async()=>{
  const {files,manifest,load}=bundle(), altered=JSON.parse(files.get(manifest.shards[1].path)!);altered.objects[0].labels.en='Conflicting identity label';
  const text=JSON.stringify(altered);files.set(manifest.shards[1].path,text);manifest.shards[1].bytes=Buffer.byteLength(text);manifest.shards[1].sha256=hash(text);
  await assert.rejects(load,/KNOWLEDGE_BUNDLE_CONFLICT/);
});
test('separately licensed vocabulary overlays and their supporting plans remain pinned and cannot override labels',async()=>{
  const {files,manifest,load}=bundle();
  const put=(path:string,value:unknown)=>{const text=JSON.stringify(value);files.set(path,text);return{path,bytes:Buffer.byteLength(text),sha256:hash(text)};};
  manifest.fieldCatalogOverlays=[put('extensions/fields.json',{schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'test:state',labels:{en:'Recorded state','zh-CN':'收录状态'}}],types:[]})];
  manifest.supportingFiles=[put('extensions/plan.json',{schemaVersion:1,kind:'mapping-plan',sourceRevision:'17'})];
  const loaded=await load();assert.equal(loaded.fieldCatalog.properties[0].labels['zh-CN'],'收录状态');assert.equal(loaded.supportingFiles[0].path,'extensions/plan.json');
  files.set('extensions/plan.json','{}');await assert.rejects(load,/KNOWLEDGE_BUNDLE_HASH_MISMATCH/);
  manifest.supportingFiles=[];
  manifest.fieldCatalogOverlays.push(put('extensions/conflicting-fields.json',{schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'test:state',labels:{en:'Different meaning','zh-CN':'不同含义'}}],types:[]}));
  await assert.rejects(load,/KNOWLEDGE_BUNDLE_CONFLICT/);
});
test('ordinary files remain bounded schema-checked collections, distinct from model packages and filesystem commands',()=>{
  const input=fixture();assert.equal(previewKnowledgeCollectionFile({text:JSON.stringify(input),name:'research.json'}).collection.objects.length,8);
  assert.throws(()=>previewKnowledgeCollectionFile({text:JSON.stringify(input),name:'../research.json'}),/INVALID_REQUEST/);
  assert.throws(()=>parseKnowledgeCollectionFile(JSON.stringify({schemaVersion:1,branches:[]})),/INVALID_KNOWLEDGE_COLLECTION_FILE/);
  assert.throws(()=>parseKnowledgeCollectionFile(' '.repeat(50),30),/KNOWLEDGE_FILE_TOO_LARGE/);
  input.assertions[0].validTime={certainty:'certain' as 'possible'};assert.throws(()=>parseKnowledgeCollectionFile(JSON.stringify(input)),/INVALID_KNOWLEDGE_COLLECTION_FILE/);
});

test('a host-selected file is read with a byte bound and invalid UTF-8 is rejected',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-knowledge-file-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'research.json');await writeFile(file,JSON.stringify(fixture()));assert.equal((await readSelectedKnowledgeCollectionFile(file)).name,'research.json');
  await writeFile(file,Buffer.from([0xff]));await assert.rejects(()=>readSelectedKnowledgeCollectionFile(file),/INVALID_KNOWLEDGE_COLLECTION_FILE/);
  await truncate(file,KNOWLEDGE_IMPORT_MAX_BYTES+1);await assert.rejects(()=>readSelectedKnowledgeCollectionFile(file),/KNOWLEDGE_FILE_TOO_LARGE/);
});
