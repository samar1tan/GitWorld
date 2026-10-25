import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as actualNavigation from './navigation-contexts.ts';
import { navigationDigest as hash, readNavigationTree } from './navigation-tree.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const git = { gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let captured, pause, interruptWrite = false;
mock.module('./navigation-contexts.ts', {
  namedExports: {
    ...actualNavigation,
    createNavigationContexts(repository, options) {
      // Only the dependency boundary is instrumented. Dispatch, query, index, receipt and Git are real.
      const snapshot = repository.snapshot.bind(repository), write = repository.write.bind(repository);
      repository.snapshot = async input => {
        const selected = pause; pause = undefined;
        if (selected) { selected.entered.resolve(); await selected.release.promise; }
        const value = await snapshot(input);
        if (selected?.captured) { selected.captured.resolve(); await selected.complete.promise; }
        return value;
      };
      repository.write = async (changes, guards) => {
        if (interruptWrite) { interruptWrite = false; assert.ok(changes.length > 1); await write(changes.slice(0, 1), guards); throw new Error('Controlled durable partial membership write'); }
        return write(changes, guards);
      };
      captured = { repository, snapshot };
      return actualNavigation.createNavigationContexts(repository, options);
    },
  },
});
const { createLocalService } = await import('./index.ts');
const results = { schemaVersion: 1, evidence: 'Real service dispatcher, knowledge index, navigation receipt and bundled Git; constructor boundary instrumented for controlled scheduling only', cases: [] };

async function run(recoverBeforeReply) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-query-read-race-'));
  const selected = path.join(directory, 'selected.json'), gates = []; let service;
  const api = (method, params) => service.dispatch({ protocolVersion: 1, requestId: 'query-read-race', method, params });
  const call = async (method, params) => { const result = await api(method, params); assert.ok(result.ok, JSON.stringify(result)); return result.result; };
  try {
    const record = { fixture: 'Full dispatcher query interleaving' }, source = { id: 'source:query-race', identity: { provider: 'fixture', externalId: 'Query race' }, revision: '1', contentHash: hash(record), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/query', adapterVersion: 'fixture-1', rights: { redistribution: 'unknown' }, record };
    const objects = Array.from({ length: 12 }, (_, index) => ({ id: `object:query-race:${index}`, labels: { en: `Object ${index}` }, identities: [], descriptions: {}, aliases: [], types: ['fixture:object'] }));
    const collection = { schemaVersion: 1, objects, sources: [source], assertions: objects.map((object, index) => ({ id: `claim:query-race:${index}`, subjectId: object.id, propertyId: 'fixture:value', value: { kind: 'text', value: `Value ${index}` }, qualifiers: [], sourceSnapshotId: source.id, evidence: [{ sourceId: source.id, locator: `row ${index}` }], review: 'adopted' })) };
    await writeFile(selected, JSON.stringify(collection));
    service = await createLocalService({ ...git, dataDirectory: path.join(directory, 'library'), resolveFileToken: token => token === 'selected' ? selected : undefined });
    const preview = await call('knowledge.filePreview', { fileToken: 'selected' }), initial = await call('repository.status', {});
    await call('knowledge.fileAdopt', { fileToken: 'selected', operationId: 'adopt-facts', expectedHead: initial.head, expectedInputHash: preview.preview.inputHash, review: 'adopted' });
    const context = await call('context.save', { operationId: 'create-context', expectedHead: initial.head, expectedContentHash: null, labels: { en: 'A complete context' } });
    const changes = await call('repository.status', {}); await call('repository.stage', { paths: changes.unstaged.map(change => change.path) });
    const staged = await call('repository.status', {}), commit = await call('repository.commit', { operationId: 'commit-original', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Freeze original context and facts' });
    const batch = (await call('context.batches', { limit: 100 })).items.find(item => item.batch.kind === 'saved-source' && item.batch.selection === 'source-claim-subjects').batch;
    const plan = await call('context.membershipPlan', { contextId: context.contextId, expectedHead: commit.oid, expectedDefinitionHash: context.contentHash, batch, mode: 'add' });
    const gate = { entered: deferred(), release: deferred(), ...(recoverBeforeReply ? { captured: deferred(), complete: deferred() } : {}) }; pause = gate; gates.push(gate);
    const inFlight = api('knowledge.query', { query: { contextIds: [context.contextId] } });
    await gate.entered.promise; interruptWrite = true;
    const failed = await api('context.applyMembership', { operationId: 'interrupted-apply', planId: plan.planId, expectedPlanHash: plan.planHash }); assert.ok(!failed.ok && failed.error.code === 'IO_ERROR');
    const partial = await captured.snapshot({ from: 'working', prefixes: ['objects/', 'sources/', 'navigation/'] }), partialMembers = readNavigationTree(partial.files).members.get(context.contextId).size;
    assert.ok(partialMembers > 0 && partialMembers < 12);
    if (recoverBeforeReply) {
      gate.release.resolve(); await gate.captured.promise;
      await call('context.resume', { operationId: 'interrupted-apply' }); assert.deepEqual(await call('context.pending', {}), []);
      gate.complete.resolve();
    } else gate.release.resolve();
    const response = await inFlight;
    assert.ok(!response.ok && response.error.code === (recoverBeforeReply ? 'CONTENT_CHANGED' : 'REVIEW_REQUIRED') && response.error.parameters.reason === (recoverBeforeReply ? 'navigation-read-changed' : 'navigation-operation-pending'), JSON.stringify(response));
    const historical = await call('knowledge.query', { revision: commit.oid, query: { contextIds: [context.contextId] } }); assert.equal(historical.total, 0);
    const state = await call('knowledge.state', { revision: commit.oid, state: { objectId: objects[0].id, year: 1200 } }); assert.equal(state.objectId, objects[0].id);
    if (!recoverBeforeReply) await call('context.resume', { operationId: 'interrupted-apply' });
    const current = await call('knowledge.query', { query: { contextIds: [context.contextId] } }); assert.equal(current.total, 12);
    results.cases.push({ recoverBeforeReply, planShards: plan.paths.length, partialMembers, inFlight: response, historicalCount: historical.total, recoveredCount: current.total });
  } finally { for (const gate of gates) { gate.release.resolve(); gate.complete?.resolve(); } await service?.close(); await rm(directory, { recursive: true, force: true }); }
}
await run(false); await run(true);
console.log(JSON.stringify(results, null, 2));
