import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createNavigationContexts, NavigationFailure } from './navigation-contexts.ts';
import { createKnowledgeStore, knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { navigationDigest as hash, readNavigationTree } from './navigation-tree.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const pending = (error: unknown) => error instanceof NavigationFailure && error.detail.code === 'REVIEW_REQUIRED' && error.detail.parameters?.reason === 'navigation-operation-pending';
const invalidated = (error: unknown) => error instanceof NavigationFailure && error.detail.code === 'CONTENT_CHANGED' && error.detail.parameters?.reason === 'navigation-read-changed';

async function fixture(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-navigation-read-'));
  const record = { fixture: 'Interleaved durable metadata writes' };
  const source = { id: 'source:read-race', identity: { provider: 'fixture', externalId: 'Read race source' }, revision: '1', contentHash: hash(record), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', adapterVersion: 'fixture-1', rights: { redistribution: 'unknown' as const }, record };
  const objects = Array.from({ length: 12 }, (_, index) => ({ id: `object:read-race:${index}`, labels: { en: `Object ${index}` }, identities: [], descriptions: {}, aliases: [], types: ['fixture:object'] }));
  const collection: KnowledgeCollection = { schemaVersion: 1, objects, sources: [source], assertions: objects.map((object, index) => ({ id: `claim:read-race:${index}`, subjectId: object.id, propertyId: 'fixture:value', value: { kind: 'text', value: `Value ${index}` }, qualifiers: [], sourceSnapshotId: source.id, evidence: [{ sourceId: source.id, locator: `row ${index}` }], review: 'adopted' })) };
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  await repository.initialize(knowledgeCollectionSeedFiles(collection));
  let snapshotPause: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>; captured?: ReturnType<typeof deferred>; complete?: ReturnType<typeof deferred> } | undefined;
  let importsPause: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  const releaseGates: (() => void)[] = [];
  let interruptWrite = false;
  const wrapped: EditorialRepository = {
    ...repository,
    async snapshot(input) {
      const pause = snapshotPause; snapshotPause = undefined;
      if (pause) { pause.entered.resolve(); await pause.release.promise; }
      const value = await repository.snapshot(input);
      if (pause?.captured) { pause.captured.resolve(); await pause.complete!.promise; }
      return value;
    },
    async write(changes, guards) {
      if (interruptWrite) { interruptWrite = false; assert.ok(changes.length > 1); await repository.write(changes.slice(0, 1), guards); throw new Error('Interrupted after one durable membership shard'); }
      return repository.write(changes, guards);
    },
  };
  const navigation = createNavigationContexts(wrapped, { dataDirectory: directory, imports: async () => { const pause = importsPause; importsPause = undefined; if (pause) { pause.entered.resolve(); await pause.release.promise; } return []; } });
  const knowledge = createKnowledgeStore(wrapped);
  t.after(async () => { for (const release of releaseGates) release(); await navigation.close(); await repository.close(); await rm(directory, { recursive: true, force: true }); });
  const current = await repository.status();
  const context = await navigation.save({ operationId: 'create-context', expectedHead: current.head, expectedContentHash: null, labels: { en: 'Interleaved context' } });
  await repository.stage(context.paths.map(path => ({ path })));
  const staged = await repository.status(), commit = await repository.commit({ operationId: 'freeze-empty-context', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Freeze complete original metadata' });
  const batch = (await navigation.batches({ limit: 100 })).items.find(item => item.batch.kind === 'saved-source' && item.batch.selection === 'source-claim-subjects')!.batch;
  const plan = await navigation.membershipPlan({ contextId: context.contextId, expectedHead: commit.oid, expectedDefinitionHash: context.contentHash, batch, mode: 'add' });
  assert.ok(plan.paths.length > 1);
  return {
    repository, navigation, knowledge, contextId: context.contextId, revision: commit.oid, batch, plan,
    pauseSnapshot(capture = false) { const pause = { entered: deferred(), release: deferred(), ...(capture ? { captured: deferred(), complete: deferred() } : {}) }; snapshotPause = pause; releaseGates.push(() => { pause.release.resolve(); pause.complete?.resolve(); }); return pause; },
    pauseImports() { const pause = { entered: deferred(), release: deferred() }; importsPause = pause; releaseGates.push(pause.release.resolve); return pause; },
    async interrupt() {
      interruptWrite = true;
      await assert.rejects(navigation.apply({ operationId: 'interrupted-apply', planId: plan.planId, expectedPlanHash: plan.planHash }), /Interrupted after one durable/);
      const partial = await repository.snapshot({ from: 'working', prefixes: ['objects/', 'sources/', 'navigation/'] });
      const count = readNavigationTree(partial.files).members.get(context.contextId)!.size;
      assert.ok(count > 0 && count < objects.length);
      assert.equal(navigation.pending().length, 1);
      return count;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const readers: [string, (value: Fixture) => Promise<unknown>][] = [
  ['list', f => f.navigation.list({})],
  ['get', f => f.navigation.get({ contextId: f.contextId })],
  ['batches', f => f.navigation.batches({})],
  ['batchObjects', f => f.navigation.batchObjects({ batch: f.batch })],
  ['batchSources', f => f.navigation.batchSources({ batch: f.batch })],
];

test('every Working metadata reader rejects an in-flight snapshot of a durable partial classification', native, async t => {
  for (const [name, read] of readers) await t.test(name, async t => {
    const f = await fixture(t), pause = f.pauseSnapshot();
    const response = read(f); const rejected = assert.rejects(response, pending);
    await pause.entered.promise;
    await f.interrupt();
    pause.release.resolve();
    await rejected;
    await assert.rejects(read(f), pending);
    assert.equal(f.navigation.pending()[0].counts!.selected, 12);
  });
});

test('a prepared write followed by complete recovery cannot validate an older partial snapshot', native, async t => {
  const f = await fixture(t), pause = f.pauseSnapshot(true);
  const response = f.navigation.list({}); const rejected = assert.rejects(response, invalidated);
  await pause.entered.promise;
  await f.interrupt();
  pause.release.resolve(); await pause.captured!.promise;
  await f.navigation.resume('interrupted-apply');
  assert.deepEqual(f.navigation.pending(), []);
  pause.complete!.resolve(); await rejected;
  assert.equal((await f.navigation.get({ contextId: f.contextId })).total, 12);
  assert.deepEqual((await f.navigation.list({})).counts, { objects: 12, assigned: 12, unassigned: 0 });
});

test('batch resolution rechecks after its asynchronous receipt read, not only after the Git snapshot', native, async t => {
  const f = await fixture(t), pause = f.pauseImports();
  const response = f.navigation.batches({}); const rejected = assert.rejects(response, pending);
  await pause.entered.promise; await f.interrupt();
  pause.release.resolve(); await rejected;
});

test('the Working query guard covers a real knowledge index while fixed OIDs, immutable plans and recovery remain available', native, async t => {
  const f = await fixture(t), pause = f.pauseSnapshot();
  const response = f.navigation.readReady('working', async () => (await f.knowledge.index()).index.query({ contextIds: [f.contextId] }));
  const rejected = assert.rejects(response, pending);
  await pause.entered.promise; await f.interrupt();
  pause.release.resolve(); await rejected;
  assert.equal((await f.navigation.list({ revision: f.revision })).items[0].members, 0);
  assert.equal((await f.navigation.get({ contextId: f.contextId, revision: f.revision })).total, 0);
  const batches = await f.navigation.batches({ revision: f.revision }), historical = batches.items.find(item => item.batch.kind === 'saved-source')!.batch;
  assert.equal((await f.navigation.batchObjects({ batch: historical })).total, 12);
  assert.equal((await f.navigation.batchSources({ batch: historical })).total, 1);
  assert.equal((await f.navigation.readReady(f.revision, async () => (await f.knowledge.index(f.revision)).index.query({ contextIds: [f.contextId] }))).total, 0);
  assert.equal((await f.knowledge.index(f.revision)).index.state({ objectId: 'object:read-race:0', year: 1200 }).objectId, 'object:read-race:0');
  assert.equal(f.navigation.plan({ planId: f.plan.planId }).counts.selected, 12);
  const recovered = await f.navigation.resume('interrupted-apply');
  assert.deepEqual(await f.navigation.resume('interrupted-apply'), recovered);
  assert.equal((await f.navigation.readReady('working', async () => (await f.knowledge.index()).index.query({ contextIds: [f.contextId] }))).total, 12);
});

test('the real service dispatcher applies the Working read guard before and after a completed recovery', native, async () => {
  // Module instrumentation is confined to the child; ordinary tests and production keep their real imports.
  const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', fileURLToPath(new URL('./navigation-read-service.test-fixture.mjs', import.meta.url))], { timeout: 30_000, env: { ...process.env, GITWORLD_TEST_GIT: binary } });
  const result = JSON.parse(stdout);
  assert.equal(result.cases.length, 2);
  assert.deepEqual(result.cases.map((value: { inFlight: { error: { code: string } }; historicalCount: number; recoveredCount: number }) => [value.inFlight.error.code, value.historicalCount, value.recoveredCount]), [['REVIEW_REQUIRED', 0, 12], ['CONTENT_CHANGED', 0, 12]]);
});
