import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createSqliteRepository } from './index.ts';
import { validPackage } from './test-fixtures.ts';
import { canonicalJson, contentHash, createHistoryEngine, snapshotTree } from '../../domain/src/index.ts';
import type { DataPackage } from '../../domain/src/index.ts';
import type { ServiceResult, WorkspaceState } from '../../contracts/src/index.ts';

const unwrap = <T>(r: ServiceResult<T>): T => { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw new Error(r.error.code); return r.value; };
const review = { reviewer: 'Test curator', reviewedAt: '2026-10-25T00:00:00.000Z', evidenceReviewed: true, rightsReviewed: true, note: 'Reviewed synthetic test assertions.' };
const directory = (t: { after(fn: () => void): void }) => { const root = mkdtempSync(path.join(tmpdir(), 'gitworld-storage-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
async function publish(repo: ReturnType<typeof createSqliteRepository>, data: DataPackage, operation = 'first') {
  const draft = unwrap(await repo.createDraft({ package: data, baseRevision: data.revision.parentRevisionId ? { datasetId: data.dataset.id, revisionId: data.revision.parentRevisionId } : null, operationId: `create-${operation}` }));
  const params = { draftId: draft.id, expectedVersion: draft.version, operationId: `publish-${operation}`, review };
  return { revision: unwrap(await repo.publishDraft(params)), params, draft };
}

test('published immutable objects and indices reconstruct identical states after restart', async t => {
  const dataDirectory = directory(t); let repo = createSqliteRepository({ dataDirectory });
  unwrap(await repo.initialize()); const data = validPackage(); await publish(repo, data);
  const ref = { datasetId: data.dataset.id, revisionId: data.revision.id };
  assert.equal(canonicalJson(unwrap(await repo.getPublishedPackage(ref))), canonicalJson(data));
  await repo.close(); repo = createSqliteRepository({ dataDirectory }); unwrap(await repo.initialize());
  const loaded = unwrap(await repo.getPublishedPackage(ref));
  assert.deepEqual(createHistoryEngine(loaded.history).snapshot('new'), createHistoryEngine(data.history).snapshot('new'));
  const db = new DatabaseSync(repo.databasePath, { readOnly: true });
  assert.ok(Number(db.prepare('SELECT COUNT(*) AS n FROM objects').get()!.n) >= 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_index').get()!.n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM field_change_index').get()!.n, 2);
  const snapshot = createHistoryEngine(loaded.history).snapshot('new'); assert.ok(snapshot.ok);
  if (snapshot.ok) assert.equal(db.prepare("SELECT tree_hash FROM commit_tree_index WHERE commit_id='new'").get()!.tree_hash, await contentHash(snapshotTree(snapshot.value)));
  db.close(); await repo.close();
});

test('a corrected revision preserves old state and source objects and retries publish idempotently', async t => {
  const repo = createSqliteRepository({ dataDirectory: directory(t) }); unwrap(await repo.initialize());
  const first = validPackage(), firstResult = await publish(repo, first);
  const second = structuredClone(first); second.revision.id = second.history.id = 'revision-2'; second.revision.parentRevisionId = 'revision-1'; second.revision.notes.en = 'Corrected'; second.history.commits[1].changes.capital!.key = 'corrected'; second.history.sources.source.title = 'Revised source metadata';
  const secondResult = await publish(repo, second, 'second');
  assert.deepEqual(unwrap(await repo.publishDraft(secondResult.params)), secondResult.revision);
  assert.equal(unwrap(await repo.getPublishedPackage(firstResult.revision)).history.sources.source.title, 'Synthetic');
  assert.equal(unwrap(await repo.getPublishedPackage(secondResult.revision)).history.sources.source.title, 'Revised source metadata');
  assert.equal(unwrap(await repo.listRevisions(first.dataset.id)).length, 2);
  const db = new DatabaseSync(repo.databasePath);
  assert.throws(() => db.prepare('UPDATE objects SET canonical_json=?').run('{}'), /IMMUTABLE_OBJECT/);
  db.close(); await repo.close();
});

test('publication interruption rolls back objects, indices, audit and active pointer', async t => {
  let interrupt = false;
  const repo = createSqliteRepository({ dataDirectory: directory(t), fault: point => { if (interrupt && point === 'publish:activate') throw new Error('Injected transaction interruption'); } });
  unwrap(await repo.initialize()); await publish(repo, validPackage());
  const second = validPackage(); second.history.id = second.revision.id = 'revision-2'; second.revision.parentRevisionId = 'revision-1';
  const draft = unwrap(await repo.createDraft({ package: second, baseRevision: { datasetId: second.dataset.id, revisionId: 'revision-1' }, operationId: 'create-second' }));
  const params = { draftId: draft.id, expectedVersion: draft.version, operationId: 'publish-second', review };
  interrupt = true; assert.equal((await repo.publishDraft(params)).ok, false);
  assert.equal(unwrap(await repo.listRevisions(second.dataset.id)).length, 1);
  assert.equal(unwrap(await repo.initialize()).datasets[0].activeRevisionId, 'revision-1');
  const db = new DatabaseSync(repo.databasePath, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commit_index WHERE revision_id='revision-2'").get()!.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operations WHERE id='publish-second'").get()!.n, 0);
  db.close(); interrupt = false; unwrap(await repo.publishDraft(params)); await repo.close();
});

test('workspace compare-and-swap preserves exact refs and refuses stale overwrites', async t => {
  const repo = createSqliteRepository({ dataDirectory: directory(t) }); unwrap(await repo.initialize()); await publish(repo, validPackage());
  const ref = { datasetId: 'test-world', revisionId: 'revision-1' };
  const state: WorkspaceState = { id: 'main', version: 0, dataset: ref, locale: 'zh-CN', head: { ...ref, commitId: 'old', requestedYear: -50 }, comparison: [{ ...ref, commitId: 'old', requestedYear: null }, { ...ref, commitId: 'new', requestedYear: null }], view: { panel: 'snapshot', scopeId: 'region', processId: 'courts', eventId: null, selectedCommitId: 'old', graphRef: 'realm/main', graphBranch: 'realm/main', requestedYear: -50, timeWindow: [-100, 100], cursor: -50, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] };
  const saved = unwrap(await repo.saveWorkspace({ workspace: state, expectedVersion: null }));
  assert.equal(saved.version, 1); assert.equal((await repo.saveWorkspace({ workspace: state, expectedVersion: null })).ok, false);
  assert.deepEqual(unwrap(await repo.loadWorkspace('main')), saved);
  saved.head!.revisionId = 'revision-2'; assert.equal((await repo.saveWorkspace({ workspace: saved, expectedVersion: 1 })).ok, false);
  await repo.close();
});

test('backup restores releases, sources, drafts and hashes into an empty library', async t => {
  const root = directory(t), original = createSqliteRepository({ dataDirectory: path.join(root, 'original') });
  unwrap(await original.initialize()); const data = validPackage(); const { revision } = await publish(original, data);
  const draftData = structuredClone(data); draftData.history.id = draftData.revision.id = 'unpublished';
  const draft = unwrap(await original.createDraft({ package: draftData, baseRevision: revision, operationId: 'another-draft' }));
  const backup = path.join(root, 'backup.sqlite'); unwrap(await original.backup(backup));
  const restored = createSqliteRepository({ dataDirectory: path.join(root, 'restored') }); unwrap(await restored.initialize());
  unwrap(await restored.restore(backup));
  assert.equal(canonicalJson(unwrap(await restored.getPublishedPackage(revision))), canonicalJson(data));
  assert.deepEqual(unwrap(await restored.getDraft(draft.id)), draft);
  assert.deepEqual(unwrap(await restored.listRevisions(data.dataset.id)), unwrap(await original.listRevisions(data.dataset.id)));
  await restored.close(); await original.close();
});

test('corrupt or incompatible backup and failed restore cannot replace healthy data', async t => {
  const root = directory(t); let failRestore = false;
  const repo = createSqliteRepository({ dataDirectory: path.join(root, 'db'), fault: point => { if (failRestore && point === 'restore:installed') throw new Error('Injected restore interruption'); } });
  unwrap(await repo.initialize()); const { revision } = await publish(repo, validPackage());
  const before = canonicalJson(unwrap(await repo.getPublishedPackage(revision)));
  const corrupt = path.join(root, 'corrupt.sqlite'); writeFileSync(corrupt, 'Not a SQLite file');
  assert.equal((await repo.restore(corrupt)).ok, false); assert.equal(canonicalJson(unwrap(await repo.getPublishedPackage(revision))), before);
  const backup = path.join(root, 'valid.sqlite'); unwrap(await repo.backup(backup));
  failRestore = true; assert.equal((await repo.restore(backup)).ok, false); assert.equal(canonicalJson(unwrap(await repo.getPublishedPackage(revision))), before);
  assert.equal(existsSync(path.join(root, 'db', 'restore-journal.json')), false);
  await repo.close();
});

test('migration interruption rolls back and retains a verified pre-migration copy', async t => {
  const root = directory(t), dbFile = path.join(root, 'library.sqlite'); new DatabaseSync(dbFile).close();
  const failing = createSqliteRepository({ dataDirectory: root, fault: point => { if (point === 'migration:applied') throw new Error('Injected migration interruption'); } });
  assert.equal((await failing.initialize()).ok, false);
  assert.ok(existsSync(`${dbFile}.before-migration`));
  const db = new DatabaseSync(dbFile); assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 0); db.close();
  const recovered = createSqliteRepository({ dataDirectory: root }); unwrap(await recovered.initialize()); await recovered.close();
});

test('concurrent publication attempts cannot publish two revisions from one draft version', async t => {
  const repo = createSqliteRepository({ dataDirectory: directory(t) }); unwrap(await repo.initialize());
  const draft = unwrap(await repo.createDraft({ package: validPackage(), baseRevision: null, operationId: 'create' }));
  const results = await Promise.all(['one', 'two'].map(operationId => repo.publishDraft({ draftId: draft.id, expectedVersion: draft.version, operationId, review })));
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(unwrap(await repo.listRevisions('test-world')).length, 1); await repo.close();
});

test('a rejected concurrent maintenance call cannot release another call’s lock', async t => {
  const root = directory(t), repo = createSqliteRepository({ dataDirectory: path.join(root, 'db') }); unwrap(await repo.initialize()); await publish(repo, validPackage());
  const first = repo.backup(path.join(root, 'first.sqlite'));
  const rejectedPromise = repo.backup(path.join(root, 'second.sqlite'));
  const writePromise = repo.createDraft({ package: validPackage(), baseRevision: null, operationId: 'blocked' });
  const rejected = await rejectedPromise;
  assert.ok(!rejected.ok && rejected.error.code === 'OPERATION_IN_PROGRESS');
  const attemptedWrite = await writePromise;
  assert.ok(!attemptedWrite.ok && attemptedWrite.error.code === 'OPERATION_IN_PROGRESS');
  unwrap(await first);
  const restoring = repo.restore(path.join(root, 'first.sqlite'));
  const secondRestorePromise = repo.restore(path.join(root, 'first.sqlite'));
  const blockedWritePromise = repo.saveSource({ id: 'source', adapter: 'met-open-access-v1', enabled: false, settings: { objectIds: '1' }, rightsBasis: 'Test' });
  const secondRestore = await secondRestorePromise;
  assert.ok(!secondRestore.ok && secondRestore.error.code === 'OPERATION_IN_PROGRESS');
  const blockedWrite = await blockedWritePromise;
  assert.ok(!blockedWrite.ok && blockedWrite.error.code === 'OPERATION_IN_PROGRESS');
  unwrap(await restoring); await repo.close();
});

test('import receipt and operation result are committed together and survive restart', async t => {
  const dataDirectory = directory(t); let repo = createSqliteRepository({ dataDirectory }); unwrap(await repo.initialize());
  const preview = { importId: 'import-one', inputHash: 'test-hash', package: validPackage(), issues: [] };
  const operation = { id: 'operation-one', method: 'import.preview', input: { fileToken: 'selected', operationId: 'operation-one' } };
  unwrap(await repo.saveImport(preview, operation)); await repo.close(); repo = createSqliteRepository({ dataDirectory }); unwrap(await repo.initialize());
  assert.deepEqual(unwrap(await repo.getOperation(operation.id, operation.method, operation.input)), preview);
  assert.deepEqual(unwrap(await repo.saveImport(preview, operation)), preview);
  assert.equal((await repo.saveImport({ ...preview, inputHash: 'different' })).ok, false); await repo.close();
});

test('abrupt process exit during publication and restore recovers the last committed library', async t => {
  const root = directory(t), dataDirectory = path.join(root, 'db'), backup = path.join(root, 'backup.sqlite');
  let repo = createSqliteRepository({ dataDirectory }); unwrap(await repo.initialize()); await publish(repo, validPackage()); unwrap(await repo.backup(backup));
  const second = validPackage(); second.history.id = second.revision.id = 'revision-2'; second.revision.parentRevisionId = 'revision-1';
  const draft = unwrap(await repo.createDraft({ package: second, baseRevision: { datasetId: 'test-world', revisionId: 'revision-1' }, operationId: 'create-second' })); await repo.close();
  const moduleUrl = new URL('./index.ts', import.meta.url).href;
  const publishChild = `import {createSqliteRepository} from ${JSON.stringify(moduleUrl)}; const repo=createSqliteRepository({dataDirectory:process.argv[1],fault:point=>{if(point==='publish:objects')process.exit(23)}});await repo.initialize();await repo.publishDraft(${JSON.stringify({ draftId: draft.id, expectedVersion: 1, operationId: 'interrupted-publish', review })});`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', publishChild, dataDirectory], { timeout: 5000 }).status, 23);
  repo = createSqliteRepository({ dataDirectory }); unwrap(await repo.initialize()); assert.equal(unwrap(await repo.listRevisions('test-world')).length, 1);
  unwrap(await repo.publishDraft({ draftId: draft.id, expectedVersion: 1, operationId: 'resume-publish', review })); await repo.close();
  const restoreChild = `import {createSqliteRepository} from ${JSON.stringify(moduleUrl)};const repo=createSqliteRepository({dataDirectory:process.argv[1],fault:point=>{if(point==='restore:installed')process.exit(24)}});await repo.initialize();await repo.restore(process.argv[2]);`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', restoreChild, dataDirectory, backup], { timeout: 5000 }).status, 24);
  repo = createSqliteRepository({ dataDirectory }); unwrap(await repo.initialize());
  assert.equal(unwrap(await repo.initialize()).datasets[0].activeRevisionId, 'revision-2'); assert.equal(unwrap(await repo.listRevisions('test-world')).length, 2); await repo.close();
});
