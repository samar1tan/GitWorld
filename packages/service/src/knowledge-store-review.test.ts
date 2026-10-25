import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { mapCliopatriaDocument } from '../../ingestion/src/cliopatria.ts';
import type { EditorialJson, EditorialRepository, EditorialWrite, EditorialWriteGuards } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeObjectBundle } from '../../contracts/src/knowledge-workspace-types.ts';
import type { KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { createKnowledgeStore } from './knowledge-store.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git to run reliability review.' };
const source = { url: 'https://example.invalid/synthetic-cliopatria.zip', revision: 'synthetic-review-only', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-25T00:00:00Z' };
const feature = (fromYear: number, toYear: number) => ({ type: 'Feature', properties: { Name: 'Synthetic review polity', Type: 'POLITY', Wikipedia: 'Synthetic_review_polity', FromYear: fromYear, ToYear: toYear, Area: 100 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } });
const document = { type: 'FeatureCollection', features: [feature(100, 150), feature(200, 250)] };
const batches = () => [0, 1].map(startRecord => mapCliopatriaDocument(document, source, { startRecord, limit: 1 }).collection);

async function setup(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-knowledge-review-'));
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  await repository.initialize();
  t.after(async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); });
  const store = createKnowledgeStore(repository);
  const adopt = async (collection: KnowledgeCollection, mode: 'append-observations' | 'replace-object' = 'append-observations') => {
    const input = { collection, mode, review: 'adopted' as const, expectedHead: (await repository.status()).head, expectedInputHash: store.previewCollection(collection).preview.inputHash };
    return store.adopt(input);
  };
  let commits = 0;
  const commit = async () => {
    const status = await repository.status();
    const staged = await repository.stage(status.unstaged.map(value => ({ path: value.path })));
    return repository.commit({ operationId: `review-commit-${++commits}`, expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record synthetic review observations' });
  };
  return { repository, store, adopt, commit };
}

test('separately acquired observation batches preserve earlier states and replay without a new change', native, async t => {
  const { repository, store, adopt, commit } = await setup(t), [first, second] = batches();
  assert.equal(first.objects[0].id, second.objects[0].id);
  await adopt(first); const earlier = await commit();
  const unchangedFirst = await adopt(first);
  assert.equal(unchangedFirst.changedObjects.length, 0, 'The first unchanged batch replay must not reorder assertions into a new change');
  assert.equal((await repository.status()).unstaged.length, 0);
  const result = await adopt(second); assert.equal(result.conflicts.length, 0);
  const { index } = await store.index(), objectId = first.objects[0].id;
  assert.equal(index.assertions(objectId).length, first.assertions.length + second.assertions.length);
  for (const year of [125, 225]) assert.equal(index.state({ objectId, year }).fields.find(field => field.propertyId === 'territory.geometry')?.status, 'known');
  const latest = await commit(); assert.notEqual(latest.oid, earlier.oid);
  const replay = await adopt(first);
  assert.equal(replay.changedObjects.length, 0); assert.equal(replay.conflicts.length, 0);
  assert.equal((await repository.status()).unstaged.length, 0);
  const pinned = await store.index(earlier.oid);
  assert.equal(pinned.index.assertions(objectId).length, first.assertions.length);
});

test('a new observation batch cannot turn a local correction into an upstream baseline', native, async t => {
  const { repository, store, adopt, commit } = await setup(t), [first, second] = batches();
  await adopt(first); await commit();
  const objectPath = (await repository.list({ prefix: 'objects/' }))[0];
  const local = structuredClone(await repository.read(objectPath)) as unknown as KnowledgeObjectBundle;
  local.assertions.find(assertion => assertion.propertyId === 'polity.source-name')!.value = { kind: 'text', value: 'Local reviewed correction' };
  await repository.write([{ path: objectPath, value: local as unknown as EditorialJson }]); store.invalidate();
  const result = await adopt(second);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(await repository.read(objectPath), local);
  const conflict = result.conflicts[0];
  assert.equal(conflict.base?.assertions.length, first.assertions.length);
  assert.equal(conflict.incoming.assertions.length, first.assertions.length + second.assertions.length);
  assert.equal(conflict.incoming.assertions.some(assertion => assertion.value.kind === 'text' && assertion.value.value === 'Local reviewed correction'), false);
  await store.resolve(first.objects[0].id, 'local', (await repository.status()).head);
  assert.deepEqual(await repository.read(objectPath), local);
});

test('complete object refresh retains replacement semantics and rejects a changed preview', native, async t => {
  const { repository, store, adopt } = await setup(t), [first, second] = batches();
  await adopt(first, 'replace-object');
  const expectedHead = (await repository.status()).head;
  await assert.rejects(store.adopt({ collection: second, review: 'adopted', expectedHead, expectedInputHash: store.previewCollection(first).preview.inputHash }), /CONFLICT/);
  assert.equal((await store.index()).index.assertions(first.objects[0].id).length, first.assertions.length);
  await adopt(second, 'replace-object');
  assert.deepEqual((await store.index()).index.assertions(first.objects[0].id).map(value => value.id), second.assertions.map(value => value.id));
});

test('a further partial batch cannot discard an unresolved incoming observation', native, async t => {
  const { repository, store, adopt, commit } = await setup(t), [first, second] = batches();
  const third = mapCliopatriaDocument({ type: 'FeatureCollection', features: [feature(300, 350)] }, source).collection;
  await adopt(first); await commit();
  const objectPath = (await repository.list({ prefix: 'objects/' }))[0];
  const local = structuredClone(await repository.read(objectPath)) as unknown as KnowledgeObjectBundle;
  local.object.descriptions.en = 'A local correction awaiting upstream reconciliation';
  await repository.write([{ path: objectPath, value: local as unknown as EditorialJson }]); store.invalidate();
  assert.equal((await adopt(second)).conflicts.length, 1);
  try { await adopt(third); }
  catch (error) { assert.match(String(error), /REVIEW_REQUIRED|CONFLICT/); }
  const pending = (await store.conflicts())[0];
  for (const assertion of second.assertions) assert.ok(pending.incoming.assertions.some(value => value.id === assertion.id), 'Unresolved incoming evidence must be preserved or further adoption refused');
  assert.deepEqual(await repository.read(objectPath), local);
});

test('an adoption preview based on an older repository HEAD cannot write a partial source batch', native, async t => {
  const { repository, store, adopt, commit } = await setup(t), [first, second] = batches();
  await adopt(first); const old = await commit();
  const preview = store.previewCollection(second).preview;
  await repository.write([{ path: 'research/later.json', value: { interpretation: 'A newer data revision' } }]);
  const newer = await commit(), before = await repository.snapshot();
  const input = { collection: second, mode: 'append-observations' as const, review: 'adopted' as const, expectedHead: old.oid, expectedInputHash: preview.inputHash };
  await assert.rejects(store.adopt(input), /HEAD_CHANGED/);
  const after = await repository.snapshot();
  assert.equal(after.head, newer.oid); assert.deepEqual(after.files, before.files);
});

test('a working label correction at unchanged HEAD refreshes index and display without leaking source records', native, async t => {
  const {repository,store,adopt}=await setup(t),[first]=batches();await adopt(first);
  const before=await store.objectDetail(first.objects[0].id),head=(await repository.status()).head;
  const objectPath=(await repository.list({prefix:'objects/'}))[0], local=structuredClone(await repository.read(objectPath)) as unknown as KnowledgeObjectBundle;
  local.object.labels['zh-CN']='工作区更正';await repository.write([{path:objectPath,value:local as unknown as EditorialJson}]);
  const after=await store.objectDetail(first.objects[0].id);
  assert.equal((await repository.status()).head,head);assert.notEqual(after.display?.fingerprint,before.display?.fingerprint);
  assert.equal(after.display?.objects[first.objects[0].id].display['zh-CN'].text,'工作区更正');
  assert.equal((await store.index()).index.query({text:'工作区更正'}).total,1);
  assert.ok(after.sources.every(source=>!('record' in source)));
  const repeated=await adopt(first);assert.equal(repeated.objects?.[0].labels['zh-CN'],'工作区更正');assert.equal(repeated.totalObjects,1);
});

test('adoption navigation labels are bounded while changed and unchanged identifier lists remain complete',native,async t=>{
  const {store,adopt}=await setup(t),[original]=batches(),input:KnowledgeCollection={schemaVersion:1,objects:Array.from({length:55},(_,i)=>({id:`synthetic:${i}`,identities:[],labels:{en:`Synthetic object ${i}`,'zh-CN':`测试对象 ${i}`},descriptions:{},aliases:[],types:[]})),assertions:[],sources:original.sources};
  const changed=await adopt(input);assert.equal(changed.changedObjects.length,55);assert.equal(changed.objects?.length,40);assert.equal(changed.totalObjects,55);
  const repeated=await adopt(input);assert.equal(repeated.changedObjects.length,0);assert.equal(repeated.unchangedObjects.length,55);assert.equal(repeated.objects?.length,40);assert.equal(repeated.totalObjects,55);
  assert.equal((await store.index()).index.query().total,55);
});

test('an unchanged upstream record preserving a local deletion is not returned as a navigable object',native,async t=>{
  const {repository,adopt}=await setup(t),[input]=batches();await adopt(input);
  const objectPath=(await repository.list({prefix:'objects/'}))[0];await repository.write([{path:objectPath,value:null}]);
  const result=await adopt(input);assert.equal(result.unchangedObjects.length,1);assert.deepEqual(result.objects,[]);assert.equal(result.totalObjects,0);assert.equal(await repository.read(objectPath),null);
});

test('a local correction matching incoming upstream advances its baseline before a later observation batch', native, async t => {
  const {repository,adopt,store}=await setup(t),[first,second]=batches();await adopt(first);
  const objectPath=(await repository.list({prefix:'objects/'}))[0],baseline=(await repository.list({prefix:'mappings/baseline-'}))[0];
  const original=await repository.read(baseline),local=structuredClone(await repository.read(objectPath)) as unknown as KnowledgeObjectBundle;
  const incoming=structuredClone(first),claim=incoming.assertions.find(value=>value.propertyId==='polity.source-name')!;
  claim.value={kind:'text',value:'Matching source correction'};
  local.assertions.find(value=>value.id===claim.id)!.value=structuredClone(claim.value);
  await repository.write([{path:objectPath,value:local as unknown as EditorialJson}]);
  const matched=await adopt(incoming);
  assert.equal(matched.changedObjects.length,0);assert.equal(matched.unchangedObjects.length,1);assert.equal(matched.conflicts.length,0);
  assert.notDeepEqual(await repository.read(baseline),original);assert.deepEqual(await repository.read(baseline),local);
  assert.equal((await adopt(second)).conflicts.length,0);
  const index=(await store.index()).index;
  assert.deepEqual(index.state({objectId:first.objects[0].id,year:125}).fields.find(field=>field.propertyId==='polity.source-name')?.values,[{kind:'text',value:'Matching source correction'}]);
  assert.equal(index.state({objectId:first.objects[0].id,year:225}).fields.find(field=>field.propertyId==='territory.geometry')?.status,'known');
});

test('baseline repair guards both the unchanged object and the previously read baseline', native, async t => {
  const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
  for(const racedPath of ['object','baseline'] as const){
    const {repository,adopt}=await setup(t),[first]=batches();await adopt(first);
    const objectPath=(await repository.list({prefix:'objects/'}))[0],baseline=(await repository.list({prefix:'mappings/baseline-'}))[0];
    const local=await repository.read(objectPath) as unknown as KnowledgeObjectBundle;
    await repository.write([{path:baseline,value:null}]);
    const concurrent=structuredClone(local);concurrent.object.descriptions.en='Concurrent correction';
    let submitted:{changes:EditorialWrite[];guards:EditorialWriteGuards|undefined}|undefined;
    const intercepted:EditorialRepository={...repository,write:async(changes,guards)=>{
      submitted=structuredClone({changes,guards});
      await repository.write([{path:racedPath==='object'?objectPath:baseline,value:concurrent as unknown as EditorialJson}]);
      return repository.write(changes,guards);
    }};
    const retry=createKnowledgeStore(intercepted);
    await assert.rejects(retry.adopt({collection:first,mode:'append-observations',review:'adopted',expectedHead:(await repository.status()).head,expectedInputHash:retry.previewCollection(first).preview.inputHash}),/CONTENT_CHANGED/);
    assert.deepEqual(submitted?.changes,[{path:baseline,value:local}]);
    assert.equal(submitted?.guards?.expectedContentHashes?.[objectPath],digest(local));assert.equal(submitted?.guards?.expectedContentHashes?.[baseline],null);
    assert.deepEqual(await repository.read(objectPath),racedPath==='object'?concurrent:local);
    assert.deepEqual(await repository.read(baseline),racedPath==='baseline'?concurrent:null);
  }
});
