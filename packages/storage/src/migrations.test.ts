import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSqliteRepository } from './index.ts';
import { DATABASE_SCHEMA_VERSION, MIGRATIONS, VERSION_ONE_VARIANTS } from './migrations.ts';
import { validPackage } from './test-fixtures.ts';
import { canonicalJson } from '../../domain/src/index.ts';
import type { ServiceResult, WorkspaceState } from '../../contracts/src/index.ts';

const unwrap = <T>(result: ServiceResult<T>): T => { assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) throw new Error(result.error.code); return result.value; };
const preservedTables = ['datasets', 'revisions', 'revision_objects', 'commit_index', 'parent_index', 'branch_index', 'field_change_index', 'tag_index', 'relationship_index', 'drafts', 'workspaces', 'sources', 'operations', 'audit', 'imports'];
function records(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Object.fromEntries(preservedTables.map(table => [table, canonicalJson(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())])); }
  finally { db.close(); }
}
function objectRecords(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT hash,canonical_json FROM objects ORDER BY hash').all(); }
  finally { db.close(); }
}
async function legacyFixture(t: { after(fn: () => unknown): void }, variant = VERSION_ONE_VARIANTS[0]) {
  const root = mkdtempSync(path.join(tmpdir(), 'gitworld-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, 'old'), repo = createSqliteRepository({ dataDirectory }); unwrap(await repo.initialize());
  const data = validPackage(), ref = { datasetId: data.dataset.id, revisionId: data.revision.id };
  const released = unwrap(await repo.createDraft({ package: data, baseRevision: null, operationId: 'create-released' }));
  unwrap(await repo.publishDraft({ draftId: released.id, expectedVersion: 1, operationId: 'publish', review: { reviewer: 'Fixture editor', reviewedAt: '2026-10-25T00:00:00Z', evidenceReviewed: true, rightsReviewed: true, note: 'Synthetic review' } }));
  const draftData = structuredClone(data); draftData.revision.id = draftData.history.id = 'unfinished'; draftData.revision.parentRevisionId = data.revision.id;
  let draft = unwrap(await repo.createDraft({ package: draftData, baseRevision: ref, operationId: 'create-unfinished' }));
  draftData.revision.notes.en = 'Unfinished user work retained through upgrade';
  draft = unwrap(await repo.saveDraft({ draftId: draft.id, expectedVersion: 1, package: draftData }));
  const workspace: WorkspaceState = { id: 'main', version: 0, dataset: ref, locale: 'zh-CN', head: { ...ref, commitId: 'old', requestedYear: null }, comparison: [{ ...ref, commitId: 'old', requestedYear: null }, { ...ref, commitId: 'new', requestedYear: null }], view: { panel: 'compare', scopeId: 'region', processId: 'courts', eventId: null, selectedCommitId: 'new', graphRef: 'realm/main', timeWindow: [-100, 100], cursor: 100, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] };
  const saved = unwrap(await repo.saveWorkspace({ workspace, expectedVersion: null }));
  unwrap(await repo.saveSource({ id: 'configured', adapter: 'met-open-access-v1', enabled: false, settings: { objectIds: '1' }, rightsBasis: 'Synthetic configuration' }));
  await repo.close();
  const db = new DatabaseSync(repo.databasePath);
  try {
    if (!variant.hasTrees) {
      db.exec('DROP TABLE commit_tree_index; DROP TRIGGER objects_no_delete; DELETE FROM objects WHERE hash NOT IN (SELECT object_hash FROM revision_objects);');
      db.exec("CREATE TRIGGER objects_no_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OBJECT'); END;");
    }
    db.exec(`ALTER TABLE workspaces RENAME TO saved_workspaces;
CREATE TABLE workspaces (id TEXT PRIMARY KEY, version INTEGER NOT NULL, dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, state_json TEXT NOT NULL, FOREIGN KEY(dataset_id,revision_id) REFERENCES revisions(dataset_id,id));
INSERT INTO workspaces SELECT * FROM saved_workspaces ORDER BY rowid;
DROP TABLE saved_workspaces;
DELETE FROM schema_migrations WHERE version>1; PRAGMA user_version=1;`);
    db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run(variant.checksum);
  } finally { db.close(); }
  return { root, dataDirectory, file: repo.databasePath, ref, draft, saved, data };
}

test('both exact legacy v1 schemas upgrade with all drafts, workspaces and published bytes retained', async t => {
  for (const variant of VERSION_ONE_VARIANTS) {
    const fixture = await legacyFixture(t, variant), before = records(fixture.file), objectsBefore = objectRecords(fixture.file);
    const repo = createSqliteRepository({ dataDirectory: fixture.dataDirectory });
    assert.equal(unwrap(await repo.initialize()).schemaVersion, DATABASE_SCHEMA_VERSION);
    assert.deepEqual(records(fixture.file), before);
    const objectsAfter = objectRecords(fixture.file); for (const original of objectsBefore) assert.deepEqual(objectsAfter.find(row => row.hash === original.hash), original);
    if (!variant.hasTrees) assert.ok(objectsAfter.length > objectsBefore.length);
    assert.deepEqual(unwrap(await repo.getDraft(fixture.draft.id)), fixture.draft);
    assert.deepEqual(unwrap(await repo.loadWorkspace('main')), fixture.saved);
    assert.deepEqual(unwrap(await repo.getPublishedPackage(fixture.ref)), fixture.data);
    const listed = unwrap(await repo.listDrafts());
    assert.equal(listed.length, 1); assert.equal(listed[0].revisionId, 'unfinished'); assert.equal(listed[0].version, 2);
    const db = new DatabaseSync(fixture.file, { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM commit_tree_index').get()!.n, 2); db.close();
    const backup = `${fixture.file}.before-migration`; assert.ok(existsSync(backup)); assert.deepEqual(records(backup), before);
    const old = new DatabaseSync(backup, { readOnly: true });
    assert.equal(old.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.equal(old.prepare('SELECT checksum FROM schema_migrations WHERE version=1').get()!.checksum, variant.checksum); old.close();
    await repo.close();
    const restored = createSqliteRepository({ dataDirectory: path.join(fixture.root, 'restore') }); unwrap(await restored.initialize());
    assert.equal(unwrap(await restored.restore(backup)).schemaVersion, DATABASE_SCHEMA_VERSION);
    assert.deepEqual(unwrap(await restored.getDraft(fixture.draft.id)), fixture.draft);
    assert.deepEqual(unwrap(await restored.loadWorkspace('main')), fixture.saved);
    assert.deepEqual(unwrap(await restored.getPublishedPackage(fixture.ref)), fixture.data);
    await restored.close();
  }
});

test('failed v1 migration rolls back the tree backfill and keeps its pre-migration backup', async t => {
  const fixture = await legacyFixture(t), before = records(fixture.file), objectsBefore = objectRecords(fixture.file);
  const failing = createSqliteRepository({ dataDirectory: fixture.dataDirectory, fault: point => { if (point === 'migration:applied') throw new Error('Interrupted schema upgrade'); } });
  assert.equal((await failing.initialize()).ok, false); assert.deepEqual(records(fixture.file), before);
  assert.deepEqual(objectRecords(fixture.file), objectsBefore);
  const db = new DatabaseSync(fixture.file, { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='commit_tree_index'").get()!.n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 1); db.close();
  assert.deepEqual(records(`${fixture.file}.before-migration`), before);
  const retry = createSqliteRepository({ dataDirectory: fixture.dataDirectory }); assert.equal(unwrap(await retry.initialize()).schemaVersion, DATABASE_SCHEMA_VERSION); await retry.close();
});

test('unknown checksums and altered DDL cannot enter the legacy migration path', async t => {
  for (const tamper of ['checksum', 'schema']) {
    const fixture = await legacyFixture(t), before = records(fixture.file);
    const db = new DatabaseSync(fixture.file);
    if (tamper === 'checksum') db.exec("UPDATE schema_migrations SET checksum='not-an-approved-migration'");
    else db.exec('CREATE TABLE unexpected (value TEXT)');
    db.close();
    const repo = createSqliteRepository({ dataDirectory: fixture.dataDirectory }); assert.equal((await repo.initialize()).ok, false);
    assert.deepEqual(records(fixture.file), before);
    const after = new DatabaseSync(fixture.file, { readOnly: true }); assert.equal(after.prepare('PRAGMA user_version').get()!.user_version, 1); after.close();
    assert.equal(existsSync(`${fixture.file}.before-migration`), false);
  }
});

test('v2 workspace migration preserves exact rows and rolls back a failed schema change', async t => {
  for (const interrupted of [true, false]) {
    const fixture = await legacyFixture(t, VERSION_ONE_VARIANTS[1]), db = new DatabaseSync(fixture.file);
    db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(2, MIGRATIONS[1].checksum, '2026-10-25T00:00:00Z'); db.exec('PRAGMA user_version=2'); db.close();
    const before = records(fixture.file), originalObjects = objectRecords(fixture.file);
    const repo = createSqliteRepository({ dataDirectory: fixture.dataDirectory, ...(interrupted ? { fault: (point: string) => { if (point === 'migration:applied') throw new Error('Interrupted v2 workspace migration'); } } : {}) });
    const result = await repo.initialize(); assert.equal(result.ok, !interrupted);
    assert.deepEqual(records(fixture.file), before); assert.deepEqual(objectRecords(fixture.file), originalObjects);
    assert.deepEqual(records(`${fixture.file}.before-migration`), before);
    const inspected = new DatabaseSync(fixture.file, { readOnly: true });
    assert.equal(inspected.prepare('PRAGMA user_version').get()!.user_version, interrupted ? 2 : DATABASE_SCHEMA_VERSION);
    assert.equal(inspected.prepare('PRAGMA foreign_key_list(workspaces)').all().length, interrupted ? 2 : 0); inspected.close();
    await repo.close();
    const retry = createSqliteRepository({ dataDirectory: fixture.dataDirectory }); unwrap(await retry.initialize()); assert.deepEqual(unwrap(await retry.loadWorkspace('main')), fixture.saved); await retry.close();
  }
});
