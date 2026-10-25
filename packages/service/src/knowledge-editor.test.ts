import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createSqliteRepository } from '../../storage/src/index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeCollection, KnowledgeValue } from '../../domain/src/knowledge.ts';
import type { EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeFieldCatalog, KnowledgeSaveEditRequest, ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import { createKnowledgeStore, knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { createKnowledgeEditor, MANUAL_KNOWLEDGE_ADAPTER } from './knowledge-editor.ts';
import { createLocalService } from './index.ts';
import { createModelStore, modelPath } from './model-store.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)), binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const objectPath = (id: string) => `objects/${digest(id)}.json`, sourcePath = (id: string) => `sources/${digest(id)}.json`;
const catalog: KnowledgeFieldCatalog = { schemaVersion: 1, kind: 'historical-field-display-labels', properties: [{ id: 'fixture:value', labels: { en: 'Recorded value', 'zh-CN': '记录值' } }], types: [{ id: 'fixture:subject-type', labels: { en: 'Subject', 'zh-CN': '对象' } }] };
function fixtureCollection(value: KnowledgeValue = { kind: 'text', value: 'Original', language: 'en' }): KnowledgeCollection {
  const record = { fixture: 'Original raw source, retained exactly' };
  return { schemaVersion: 1, objects: [{ id: 'fixture:subject', labels: { en: 'Subject', 'zh-CN': '对象' }, identities: [{ provider: 'fixture', externalId: 'subject' }], descriptions: {}, aliases: [], types: ['fixture:subject-type'] }, { id: 'fixture:other', labels: { en: 'Other' }, identities: [], descriptions: {}, aliases: [], types: [] }],
    assertions: [{ id: 'fixture:claim', subjectId: 'fixture:subject', propertyId: 'fixture:value', value, review: 'unreviewed', rank: 'preferred', sourceSnapshotId: 'fixture:source', evidence: [{ sourceId: 'fixture:source', locator: 'Original row' }], qualifiers: [{ propertyId: 'fixture:qualifier', value: { kind: 'raw', value: { uncertain: true, raw: ['untouched'] } }, raw: { preserved: true } }], validTime: { point: { earliestYear: 100, latestYear: 100, precision: 'day', month: 1, day: 2, sourcePrecision: 11, calendar: 'proleptic-gregorian', raw: '+0100-01-02', before: 0, after: 0 } } }],
    sources: [{ id: 'fixture:source', identity: { provider: 'fixture', externalId: 'source' }, revision: 'original-1', contentHash: digest(record), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/original', adapterVersion: 'fixture-v1', rights: { redistribution: 'allowed' }, record }],
  };
}
const citation = { title: 'User selected reference', url: 'https://example.invalid/citation', locator: 'p. 12' };
const point = (year: number) => ({ point: { earliestYear: year, latestYear: year, precision: 'year' as const, calendar: 'proleptic-gregorian' } });
async function setup(t: { after(fn: () => unknown): void }, value?: KnowledgeValue) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-knowledge-edit-')), collection = fixtureCollection(value);
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  const initial = await repository.initialize(knowledgeCollectionSeedFiles(collection)), editors: ReturnType<typeof createKnowledgeEditor>[] = [];
  const open = (options: { onFault?: (point: 'after-prepare' | 'after-write' | 'after-receipt') => void; repository?: EditorialRepository } = {}) => {
    const editor = createKnowledgeEditor(options.repository ?? repository, { dataDirectory: directory, catalog, ...(options.onFault ? { onFault: options.onFault } : {}) }); editors.push(editor); return editor;
  };
  t.after(async () => { for (const editor of editors) await editor.close(); await repository.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, collection, repository, initial, open, editor: open(), knowledge: createKnowledgeStore(repository, { fieldCatalog: catalog }) };
}
async function correction(editor: ReturnType<typeof createKnowledgeEditor>, operationId: string): Promise<KnowledgeSaveEditRequest> {
  const context = await editor.editContext({ objectId: 'fixture:subject' });
  return { operationId, expectedHead: context.head, expectedObjectHash: context.objectHash, objectId: 'fixture:subject', assertionId: 'fixture:claim', change: { mode: 'correct', propertyId: 'fixture:value', evidence: { sourceId: 'fixture:source', locator: 'Reviewed locator' }, review: 'adopted', reason: 'Correct the local interpretation' } };
}
function addition(head: string, operationId: string): KnowledgeSaveEditRequest {
  return { operationId, expectedHead: head, expectedObjectHash: null, change: { mode: 'add', newObject: { labels: { 'zh-CN': '新对象' }, types: ['fixture:subject-type'] }, propertyId: 'fixture:value', value: { kind: 'text', value: 'B' }, validTime: point(300), evidence: citation, review: 'adopted', reason: 'Record the first sourced observation' } };
}

test('ordinary manual observations use coherent current hashes and normal dated state/dependency paths', native, async t => {
  const { editor, initial, repository, knowledge, collection } = await setup(t), context = await editor.editContext({ objectId: 'fixture:subject' });
  const original = await repository.read(objectPath('fixture:subject')), baselinePath = `mappings/baseline-${digest('fixture:subject')}.json`, baseline = await repository.read(baselinePath);
  assert.equal(context.head, initial.head); assert.equal(context.objectHash, digest(original)); assert.equal(context.catalog.properties[0].labels['zh-CN'], '记录值'); assert.ok(context.sources.every(value => !Object.hasOwn(value,'record')));
  const saved = await editor.saveEdit({ operationId: 'add-observation', expectedHead: context.head, expectedObjectHash: context.objectHash, objectId: 'fixture:subject', change: { mode: 'add', propertyId: 'fixture:value', value: { kind: 'text', value: 'Later' }, validTime: point(200), evidence: citation, review: 'unreviewed', reason: 'Add a later observation' } });
  assert.equal(saved.objectId, 'fixture:subject'); assert.notEqual(saved.assertionId, 'fixture:claim'); assert.equal((await repository.status()).head, initial.head); assert.equal((await repository.status()).staged.length, 0);
  const index = (await knowledge.index()).index; assert.deepEqual(index.state({ objectId: saved.objectId, year: 200, includeUnreviewed: true }).fields[0].values, [{ kind: 'text', value: 'Later' }]);
  assert.equal(index.state({ objectId: saved.objectId, year: 200 }).fields[0].status, 'unknown');
  const dependencies = await knowledge.dependencies([objectPath(saved.objectId)]); assert.ok(dependencies.required.includes(saved.paths[0])); assert.deepEqual((await knowledge.dependencies(saved.paths)).required, []);
  assert.deepEqual(await repository.read(baselinePath), baseline); assert.deepEqual(await repository.read(sourcePath('fixture:source')), collection.sources[0]);
});

test('corrections keep unsupported values, precise dates and qualifiers while recording a separate local source', native, async t => {
  const raw: KnowledgeValue = { kind: 'raw', value: { geometry: { type: 'MultiPolygon', coordinates: [[[1,2],[3,4]]] }, retained: true } };
  const { editor, repository, collection } = await setup(t, raw), input = await correction(editor, 'preserve-complex'), before = structuredClone(input);
  const saved = await editor.saveEdit(input), object = await editor.editContext({ objectId: saved.objectId }), assertion = object.object!.assertions[0], original = collection.assertions[0];
  assert.deepEqual(input, before); assert.equal(assertion.id, original.id); assert.deepEqual(assertion.value, original.value); assert.deepEqual(assertion.validTime, original.validTime); assert.deepEqual(assertion.qualifiers, original.qualifiers); assert.equal(assertion.rank, 'preferred');
  assert.notEqual(assertion.sourceSnapshotId, original.sourceSnapshotId);
  const source = await repository.read(sourcePath(assertion.sourceSnapshotId)) as any; assert.equal(source.adapterVersion, MANUAL_KNOWLEDGE_ADAPTER); assert.equal(source.contentHash, digest(source.record));
  assert.deepEqual(source.record.amendment.originalAssertion, original); assert.equal(source.record.amendment.originalAssertionHash, digest(original)); assert.equal(source.record.amendment.originalSource.contentHash, collection.sources[0].contentHash); assert.equal(source.record.reference.sourceSnapshotHash, collection.sources[0].contentHash);
  const next = { ...input, operationId: 'replace-complex', expectedObjectHash: saved.objectHash, change: { ...input.change, value: { kind: 'number' as const, value: 17.5, unit: 'fixture:unit', lowerBound: 17, upperBound: 18 }, validTime: null, evidence: citation } };
  await editor.saveEdit(next); const replaced = (await editor.editContext({ objectId: saved.objectId })).object!.assertions[0]; assert.equal(replaced.validTime, undefined); assert.deepEqual(replaced.qualifiers, original.qualifiers); assert.deepEqual(replaced.value, next.change.value);
});

test('preserving an existing unresolved entity is allowed while explicit replacements require real selection', native, async t => {
  const { editor } = await setup(t, { kind: 'entity', objectId: 'external:not-adopted' });
  const input = await correction(editor, 'keep-entity'), saved = await editor.saveEdit(input); assert.deepEqual((await editor.editContext({ objectId: saved.objectId })).object!.assertions[0].value, { kind: 'entity', objectId: 'external:not-adopted' });
  await assert.rejects(editor.saveEdit({ ...input, operationId: 'invalid-entity', expectedObjectHash: saved.objectHash, change: { ...input.change, value: { kind: 'entity', objectId: 'external:not-selected' } } }), { message: 'NOT_FOUND' });
});

test('stable new IDs, frozen B/working C and completed retry survive a later commit and reopen', native, async t => {
  const { editor, repository, initial, knowledge, open } = await setup(t), input = addition(initial.head, 'new-subject');
  const saved = await editor.saveEdit(input); assert.deepEqual(await editor.saveEdit(input), saved);
  const staged = await repository.stage(saved.paths.map(path => ({ path })));
  await editor.saveEdit({ operationId: 'edit-to-C', expectedHead: initial.head, expectedObjectHash: saved.objectHash, objectId: saved.objectId, assertionId: saved.assertionId, change: { mode: 'correct', propertyId: 'fixture:value', value: { kind: 'text', value: 'C' }, evidence: citation, review: 'adopted', reason: 'Refine the interpretation' } });
  const commit = await repository.commit({ operationId: 'commit-B', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record the first observation' });
  assert.deepEqual((await knowledge.index(commit.oid)).index.state({ objectId: saved.objectId, year: 300 }).fields[0].values, [{ kind: 'text', value: 'B' }]);
  assert.deepEqual((await knowledge.index()).index.state({ objectId: saved.objectId, year: 300 }).fields[0].values, [{ kind: 'text', value: 'C' }]);
  await editor.close(); const reopened = open(); assert.deepEqual(await reopened.saveEdit(input), saved); assert.deepEqual((await knowledge.index()).index.state({ objectId: saved.objectId, year: 300 }).fields[0].values, [{ kind: 'text', value: 'C' }]);
  await assert.rejects(reopened.saveEdit({ ...input, change: { ...input.change, reason: 'Different request under the same ID' } }), { message: 'IDEMPOTENCY_CONFLICT' });
});

test('stale object/HEAD, invalid evidence and unknown fields preserve working input', native, async t => {
  const { editor, repository } = await setup(t), input = await correction(editor, 'first-correction');
  const first = await editor.saveEdit(input), status = await repository.status();
  await assert.rejects(editor.saveEdit({ ...input, operationId: 'stale-content' }), { message: 'CONTENT_CHANGED' });
  let invalidSequence=0;for (const change of [{ ...input.change, propertyId: 'unknown:field' }, { ...input.change, evidence: { sourceId: 'unknown:source', locator: 'row' } }]) await assert.rejects(editor.saveEdit({ ...input, operationId: `invalid-${++invalidSequence}`, expectedObjectHash: first.objectHash, change }), error => ['VALIDATION_FAILED','NOT_FOUND'].includes((error as Error).message));
  await assert.rejects(editor.saveEdit({ ...input, operationId: 'unsafe-url', expectedObjectHash: first.objectHash, change: { ...input.change, evidence: { ...citation, url: 'file:///private/input' } } }), { message: 'INVALID_REQUEST' });
  assert.deepEqual(await repository.status(), status);
  const staged = await repository.stage(first.paths.map(path => ({ path }))); await repository.commit({ operationId: 'advance-editorial-head', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record the correction' });
  await assert.rejects(editor.saveEdit({ ...input, operationId: 'stale-head', expectedObjectHash: first.objectHash }), { message: 'HEAD_CHANGED' });
});

for (const interruption of ['after-prepare','after-write','after-receipt'] as const) test(`manual edit recovers ${interruption} with the same generated IDs`, native, async t => {
  const { repository, initial, open, knowledge } = await setup(t); let interrupt = true;
  const editor = open({ onFault: point => { if (interrupt && point === interruption) { interrupt = false; throw new Error('Interrupted manual save'); } } }), input = addition(initial.head, `recover-${interruption}`);
  await assert.rejects(editor.saveEdit(input), /Interrupted manual save/); await editor.close();
  if (interruption === 'after-write') { const staged = await repository.stage((await repository.status()).unstaged.map(value => ({ path: value.path }))); await repository.commit({ operationId: 'commit-before-result-check', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record the already-written observation' }); }
  const recovered = await open().saveEdit(input); assert.equal(recovered.head, initial.head); assert.equal((await knowledge.index()).index.query({ text: '新对象' }).total, 1);
  assert.equal((await knowledge.index()).index.assertions(recovered.objectId).length, 1);
});

test('a source-only partial write retries coherently and a different source collision is never overwritten', native, async t => {
  const { repository, initial, open, knowledge, directory } = await setup(t); let interrupt = true;
  const wrapped: EditorialRepository = { ...repository, write: async (changes, guards) => { if (interrupt) { interrupt = false; await repository.write([changes[0]],guards); throw new Error('After first durable source'); } return repository.write(changes,guards); } };
  const input = addition(initial.head, 'source-partial'), editor = open({ repository: wrapped });
  await assert.rejects(editor.saveEdit(input), /After first durable source/); assert.equal((await knowledge.index()).index.query({ text: '新对象' }).total, 0);
  const saved = await editor.saveEdit(input); assert.equal((await knowledge.index()).index.query({ text: '新对象' }).total, 1);
  let failPrepare = true; const another = open({ onFault: point => { if (point === 'after-prepare' && failPrepare) { failPrepare = false; throw new Error('Prepared only'); } } }), pending = addition(initial.head, 'source-collision');
  await assert.rejects(another.saveEdit(pending), /Prepared only/);
  const metadata = new DatabaseSync(path.join(directory,'knowledge-editor-operations.sqlite')), row = metadata.prepare('SELECT prepared_json FROM edits WHERE id=?').get(pending.operationId)!; const prepared = JSON.parse(String(row.prepared_json)); metadata.close();
  const different = { ...prepared.source, rights: { redistribution: 'restricted' } }; await repository.write([{ path: prepared.result.paths[0], value: different }]);
  await assert.rejects(another.saveEdit(pending), { message: 'CONTENT_CHANGED' }); assert.deepEqual(await repository.read(prepared.result.paths[0]), different); assert.equal(await repository.read(prepared.result.paths[1]), null); assert.notEqual(saved.objectId, prepared.result.objectId);
});

test('a referenced source changing after prepare fails its CAS before any new working files', native, async t => {
  const { repository, open } = await setup(t); let failPrepare = true;
  const editor = open({ onFault: point => { if (point === 'after-prepare' && failPrepare) { failPrepare = false; throw new Error('Prepared citation'); } } }), input = await correction(editor, 'source-cas');
  await assert.rejects(editor.saveEdit(input), /Prepared citation/);
  const path = sourcePath('fixture:source'), original = await repository.read(path) as any; await repository.write([{ path, value: { ...original, retrievedAt: '2026-10-26T00:00:00Z' } }]);
  const before = await repository.status(); await assert.rejects(editor.saveEdit(input), { message: 'CONTENT_CHANGED' }); assert.deepEqual(await repository.status(), before);
});

test('a pending model publication and manual edit retain separate receipts and share one eventual commit', native, async t => {
  const { directory, repository, editor, knowledge }=await setup(t), sql=createSqliteRepository({dataDirectory:directory});assert.ok((await sql.initialize()).ok);
  let interrupt=true;const models=createModelStore(repository,{dataDirectory:directory,getDraft:async id=>{const result=await sql.getDraft(id);assert.ok(result.ok);return result.value;},onFault:point=>{if(interrupt&&point==='after-write'){interrupt=false;throw new Error('Pending model publication');}}});
  try{
    const data=validPackage(),file=modelPath(data.dataset.id);await repository.write([{path:file,value:data as any}]);let staged=await repository.stage([{path:file}]);await repository.commit({operationId:'initial-model',expectedHead:staged.head,expectedTree:staged.stagedTree,message:'Add the model'});
    const previous=await models.read(data.dataset.id,'working'),status=await repository.status();data.revision.id=data.history.id='model-B';data.history.commits[1].title.en='Model B';
    const draft=await sql.createDraft({package:data,baseRevision:null,operationId:'pending-model-draft'});assert.ok(draft.ok);
    const input={draftId:draft.value.id,expectedVersion:draft.value.version,expectedHead:status.head,expectedModelHash:previous.contentHash,operationId:'pending-model-publish',review:{reviewer:'Fixture',reviewedAt:'2026-10-25T00:00:00Z',evidenceReviewed:true,rightsReviewed:true,note:'Synthetic review'}};
    await assert.rejects(models.publish(input),/Pending model publication/);
    const context=await editor.editContext({objectId:'fixture:subject'}),saved=await editor.saveEdit({operationId:'manual-during-model-retry',expectedHead:context.head,expectedObjectHash:context.objectHash,objectId:'fixture:subject',change:{mode:'add',propertyId:'fixture:value',value:{kind:'text',value:'Manual observation'},validTime:point(250),evidence:citation,review:'adopted',reason:'Add an independent observation'}});
    const recovered=await models.publish(input);assert.equal(recovered.working!.head,status.head);assert.equal((await models.read(data.dataset.id,'working')).package.history.commits[1].title.en,'Model B');
    const changes=(await repository.status()).unstaged;assert.ok(changes.some(value=>value.path===file));assert.ok(changes.some(value=>value.path===objectPath(saved.objectId)));
    staged=await repository.stage(changes.map(value=>({path:value.path})));const committed=await repository.commit({operationId:'commit-model-and-manual',expectedHead:staged.head,expectedTree:staged.stagedTree,message:'Record model B and the observation'});
    assert.deepEqual((await knowledge.index(committed.oid)).index.state({objectId:saved.objectId,year:250}).fields[0].values,[{kind:'text',value:'Manual observation'}]);assert.equal((await models.read(data.dataset.id,committed.oid)).package.history.commits[1].title.en,'Model B');assert.deepEqual(await models.publish(input),recovered);
  }finally{await models.close();await sql.close();}
});

test('full service backup preserves pending manual receipts and recoverable input across restore', native, async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'gitworld-manual-backup-')), dataDirectory = path.join(directory,'library'), file = path.join(directory,'collection.json'), backup = path.join(directory,'complete.gitworld'); await writeFile(file,JSON.stringify(fixtureCollection()));
  const tokens = new Map([['input',file],['backup',backup],['restore',backup]]); let inject = false;
  const service = await createLocalService({ dataDirectory, gitExecutable: binary, gitExecPath: path.resolve(binary,'../../libexec/git-core'), resolveFileToken: token => tokens.get(token), onProgress: progress => {
    if (inject && progress.operationId === 'pending-service-edit' && progress.stage === 'writing' && progress.completed === progress.total) {
      inject = false; const db = new DatabaseSync(path.join(dataDirectory,'knowledge-editor-operations.sqlite')); db.exec("CREATE TRIGGER fail_editor_receipt BEFORE UPDATE ON edits BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END"); db.close();
    }
  } });
  t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});}); let sequence=0;
  async function call<M extends ServiceMethod>(method:M,params:ServiceMethods[M]['params']):Promise<ServiceMethods[M]['result']>{const response=await service.dispatch({protocolVersion:1,requestId:`manual-backup-${++sequence}`,method,params}as ServiceRequest);assert.ok(response.ok,JSON.stringify(response));return response.result as ServiceMethods[M]['result'];}
  const status = await call('repository.status',{}), preview = await call('knowledge.filePreview',{fileToken:'input'}); await call('knowledge.fileAdopt',{fileToken:'input',operationId:'adopt-fixture',expectedHead:status.head,expectedInputHash:preview.preview.inputHash,review:'unreviewed'});
  const context=await call('knowledge.editContext',{}), input=addition(context.head,'pending-service-edit'); await call('clientState.save',{key:'object-input',expectedVersion:null,value:{fixture:'pending',request:input} as any}); inject=true;
  const failed=await service.dispatch({protocolVersion:1,requestId:'unknown-manual-save',method:'knowledge.saveEdit',params:input}); assert.ok(!failed.ok&&failed.error.code==='IO_ERROR');
  const db=new DatabaseSync(path.join(dataDirectory,'knowledge-editor-operations.sqlite'));db.exec('DROP TRIGGER fail_editor_receipt');assert.equal(db.prepare('SELECT result_json FROM edits WHERE id=?').get(input.operationId)!.result_json,null);db.close();
  await call('backup.create',{fileToken:'backup',operationId:'backup-pending-manual'});const confirmed=await call('knowledge.saveEdit',input);
  await call('backup.restore',{fileToken:'restore',operationId:'restore-pending-manual'});
  assert.deepEqual((await call('clientState.load',{key:'object-input'}))!.value,{fixture:'pending',request:input});
  const recovered=await call('knowledge.saveEdit',input);assert.deepEqual(recovered,confirmed);assert.equal((await call('knowledge.query',{query:{text:'新对象'}})).total,1);
});
