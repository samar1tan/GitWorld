import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalService } from './index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import type { DataPackage } from '../../domain/src/index.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, ServiceResponse } from '../../contracts/src/index.ts';

let sequence = 0;
async function call<M extends ServiceMethod>(service: Awaited<ReturnType<typeof createLocalService>>, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const response = await service.dispatch({ protocolVersion: 1, requestId: `request-${++sequence}`, method, params } as ServiceRequest);
  assert.equal(response.ok, true, JSON.stringify(response)); if (!response.ok) throw new Error(response.error.code); return response.result as ServiceMethods[M]['result'];
}
async function setup(t: { after(fn: () => unknown): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'gitworld-service-')), seed = path.join(root, 'seed.json');
  writeFileSync(seed, JSON.stringify(validPackage()));
  const tokens = new Map<string, { purpose: string; path: string }>();
  const options = { dataDirectory: path.join(root, 'library'), seedPackagePath: seed, resolveFileToken: (token: string, purpose: string) => tokens.get(token)?.purpose === purpose ? tokens.get(token)!.path : undefined };
  const service = await createLocalService(options);
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, service, options, tokens };
}
const review = { reviewer: 'Test', reviewedAt: '2026-10-25T00:00:00Z', evidenceReviewed: true, rightsReviewed: true, note: 'Synthetic test review' };
// This file exercises the retained SQL-only compatibility adapter, without a Git runtime.
const legacyGuards = { expectedHead: '0'.repeat(40), expectedModelHash: null };
async function publish(service: Awaited<ReturnType<typeof createLocalService>>, data: DataPackage, id: string) {
  const draft = await call(service, 'draft.create', { package: data, baseRevision: data.revision.parentRevisionId ? { datasetId: data.dataset.id, revisionId: data.revision.parentRevisionId } : null, operationId: `create-${id}` });
  return call(service, 'draft.publish', { draftId: draft.id, expectedVersion: draft.version, operationId: `publish-${id}`, review, ...legacyGuards });
}

test('packaged seed initializes through publication, remains offline, and is never reimported', async t => {
  const { service, options } = await setup(t);
  const status = await call(service, 'library.status', {}); assert.equal(status.datasets.length, 1); assert.equal(status.datasets[0].activeRevisionId, 'revision-1');
  const data = await call(service, 'revision.get', { dataset: { datasetId: 'test-world', revisionId: 'revision-1' } });
  assert.equal(data.history.commits.length, 2);
  const command = await call(service, 'query.execute', { dataset: { datasetId: 'test-world', revisionId: 'revision-1' }, input: { command: 'git show tag:start' }, context: { head: null } });
  const gui = await call(service, 'query.execute', { dataset: { datasetId: 'test-world', revisionId: 'revision-1' }, input: { intent: { type: 'show', ref: 'tag:start' } }, context: { head: null } });
  assert.deepEqual(gui, command);
  await service.close(); const restarted = await createLocalService(options);
  assert.equal((await call(restarted, 'revision.list', { datasetId: 'test-world' })).length, 1); await restarted.close();
});

test('a new scope and historical period enter through import and work without rebuilding', async t => {
  const { root, service, tokens } = await setup(t), data = validPackage();
  data.dataset.id = data.history.datasetId = 'new-world'; data.revision.id = data.history.id = 'new-release';
  data.catalog.scopes[0].id = data.history.branches[0].scopeId = 'new-scope'; data.catalog.processes[0].scopeIds = ['new-scope'];
  data.catalog.scopes[0].coverage = data.catalog.processes[0].coverage = data.history.branches[0].coverage = data.catalog.defaults.timeWindow = [-4000, -3990];
  data.history.commits[0].year = data.history.commits[0].date!.earliestYear = data.history.commits[0].date!.latestYear = -4000;
  data.history.commits[1].year = data.history.commits[1].date!.earliestYear = data.history.commits[1].date!.latestYear = -3990;
  const input = path.join(root, 'new-package.json'); writeFileSync(input, JSON.stringify(data)); tokens.set('new-input', { purpose: 'import', path: input });
  const preview = await call(service, 'import.preview', { fileToken: 'new-input', operationId: 'preview-new' }); assert.ok(preview.package);
  const draft = await call(service, 'import.accept', { importId: preview.importId, operationId: 'accept-new' });
  await call(service, 'draft.publish', { draftId: draft.id, expectedVersion: draft.version, operationId: 'publish-new', review, ...legacyGuards });
  const resolved = await call(service, 'query.execute', { dataset: { datasetId: 'new-world', revisionId: 'new-release' }, input: { command: 'git checkout realm/main@BCE:3995' }, context: { head: null } });
  assert.ok(resolved.ok && resolved.output.kind === 'snapshot' && resolved.output.version.commitId === 'old' && resolved.output.version.requestedYear === -3995);
});

test('file tokens are purpose-bound and sources cannot select arbitrary network adapters', async t => {
  const { root, service, tokens } = await setup(t); tokens.set('import-only', { purpose: 'import', path: path.join(root, 'input.json') });
  const response = await service.dispatch({ protocolVersion: 1, requestId: 'bad-purpose', method: 'backup.create', params: { fileToken: 'import-only', operationId: 'backup-wrong' } });
  assert.ok(!response.ok && response.error.code === 'INVALID_REQUEST'); assert.equal(existsSync(path.join(root, 'input.json')), false);
  const source = await service.dispatch({ protocolVersion: 1, requestId: 'bad-adapter', method: 'source.save', params: { source: { id: 'source', adapter: 'http-json', enabled: true, settings: { url: 'http://127.0.0.1/' }, rightsBasis: 'Test' } } });
  assert.ok(!source.ok && source.error.code === 'INVALID_REQUEST');
});

test('restore operation retries cannot erase data written after the successful restore', async t => {
  const { root, service, options, tokens } = await setup(t), file = path.join(root, 'backup.sqlite');
  tokens.set('backup-output', { purpose: 'backup', path: file }); tokens.set('restore-input', { purpose: 'restore', path: file });
  await call(service, 'backup.create', { fileToken: 'backup-output', operationId: 'backup' });
  const second = validPackage(); second.history.id = second.revision.id = 'revision-2'; second.revision.parentRevisionId = 'revision-1'; await publish(service, second, 'second');
  const restore = { fileToken: 'restore-input', operationId: 'restore-one' };
  await call(service, 'backup.restore', restore); assert.equal((await call(service, 'revision.list', { datasetId: 'test-world' })).length, 1);
  const third = validPackage(); third.history.id = third.revision.id = 'revision-3'; third.revision.parentRevisionId = 'revision-1'; await publish(service, third, 'third');
  await service.close(); const restarted = await createLocalService(options);
  await call(restarted, 'backup.restore', restore);
  assert.equal((await call(restarted, 'library.status', {})).datasets[0].activeRevisionId, 'revision-3');
  const conflict = await restarted.dispatch({ protocolVersion: 1, requestId: 'changed-restore', method: 'backup.restore', params: { fileToken: 'different', operationId: 'restore-one' } });
  assert.ok(!conflict.ok && conflict.error.code === 'CONFLICT'); await restarted.close();
});

test('only unpublished drafts can be deleted with their current version', async t => {
  const { service } = await setup(t), data = validPackage(); data.revision.id = data.history.id = 'draft-only';
  const draft = await call(service, 'draft.create', { package: data, baseRevision: null, operationId: 'new-draft' });
  assert.deepEqual(await call(service, 'draft.delete', { draftId: draft.id, expectedVersion: draft.version }), { deleted: true });
  const publishedDraft = await call(service, 'draft.create', { package: data, baseRevision: null, operationId: 'publishable-draft' });
  await call(service, 'draft.publish', { draftId: publishedDraft.id, expectedVersion: publishedDraft.version, operationId: 'publish-draft', review, ...legacyGuards });
  assert.deepEqual(await call(service, 'draft.list', {}), []);
  assert.equal((await call(service, 'draft.get', { draftId: publishedDraft.id })).package.revision.id, 'draft-only');
  const refused = await service.dispatch({ protocolVersion: 1, requestId: 'delete-published', method: 'draft.delete', params: { draftId: publishedDraft.id, expectedVersion: publishedDraft.version + 1 } });
  assert.ok(!refused.ok && refused.error.code === 'CONFLICT');
});

test('a valid backup can recover a library that cannot initialize without deleting its original', async t => {
  const { root, service, tokens } = await setup(t), backup = path.join(root, 'healthy.sqlite');
  tokens.set('healthy-backup', { purpose: 'backup', path: backup }); await call(service, 'backup.create', { fileToken: 'healthy-backup', operationId: 'healthy' });
  const dataDirectory = path.join(root, 'damaged'); mkdirSync(dataDirectory); writeFileSync(path.join(dataDirectory, 'library.sqlite'), 'Damaged input retained for recovery');
  const invalidBackup = path.join(root, 'invalid.sqlite'); writeFileSync(invalidBackup, 'Not a valid backup');
  const recoveryOptions = { dataDirectory, resolveFileToken: (token: string, purpose: string) => purpose === 'restore' ? token === 'recovery' ? backup : token === 'invalid' ? invalidBackup : undefined : undefined };
  const recovering = await createLocalService(recoveryOptions);
  const before = await recovering.dispatch({ protocolVersion: 1, requestId: 'before-recovery', method: 'library.status', params: {} }); assert.equal(before.ok, false);
  for (const method of ['draft.list', 'source.list'] as const) assert.equal((await recovering.dispatch({ protocolVersion: 1, requestId: `unavailable-${method}`, method, params: {} })).ok, false);
  const refused = await recovering.dispatch({ protocolVersion: 1, requestId: 'bad-recovery', method: 'backup.restore', params: { fileToken: 'invalid', operationId: 'rejected-repair' } });
  assert.ok(!refused.ok && refused.error.code === 'BACKUP_INVALID');
  assert.equal(readFileSync(path.join(dataDirectory, 'library.sqlite'), 'utf8'), 'Damaged input retained for recovery');
  assert.equal((await recovering.dispatch({ protocolVersion: 1, requestId: 'still-unavailable', method: 'library.status', params: {} })).ok, false);
  await call(recovering, 'backup.restore', { fileToken: 'recovery', operationId: 'repair' });
  assert.equal((await call(recovering, 'library.status', {})).datasets[0].activeRevisionId, 'revision-1');
  assert.deepEqual(await call(recovering, 'draft.list', {}), []); assert.deepEqual(await call(recovering, 'source.list', {}), []);
  assert.deepEqual(await call(recovering, 'revision.get', { dataset: { datasetId: 'test-world', revisionId: 'revision-1' } }), validPackage());
  const preserved = readdirSync(root).find(name => name.startsWith('damaged.before-restore-'));
  assert.ok(preserved);
  assert.equal(readFileSync(path.join(root, preserved, 'library.sqlite'), 'utf8'), 'Damaged input retained for recovery');
  await recovering.close(); const restarted = await createLocalService(recoveryOptions);
  assert.equal((await call(restarted, 'library.status', {})).datasets[0].activeRevisionId, 'revision-1'); await restarted.close();
});

test('acquisition cancellation starts at admission and rejected writes never execute later', async t => {
  const { service } = await setup(t);
  await call(service, 'source.save', { source: { id: 'met-test', adapter: 'met-open-access-v1', enabled: true, settings: { objectIds: '1' }, rightsBasis: 'Synthetic metadata fixture; no network access' } });
  let started!: () => void;
  const fetching = new Promise<void>(resolve => { started = resolve; });
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    fetchCount++; started();
    return new Promise<Response>((_resolve, reject) => {
      const stop = () => reject(new Error('cancelled fixture'));
      if (options.signal?.aborted) stop(); else options.signal?.addEventListener('abort', stop, { once: true });
    });
  });
  const immediate = service.dispatch({ protocolVersion: 1, requestId: 'queued-acquisition', method: 'source.acquire', params: { sourceId: 'met-test', operationId: 'cancel-at-admission' } });
  assert.deepEqual(await call(service, 'operation.cancel', { operationId: 'cancel-at-admission' }), { cancelled: true });
  const cancelled = await immediate; assert.ok(!cancelled.ok && cancelled.error.code === 'CANCELLED'); assert.equal(fetchCount, 0);

  const acquisition = service.dispatch({ protocolVersion: 1, requestId: 'active-acquisition', method: 'source.acquire', params: { sourceId: 'met-test', operationId: 'active-network' } });
  await fetching;
  const data = validPackage(); data.revision.id = data.history.id = 'must-not-arrive';
  const rejected = await service.dispatch({ protocolVersion: 1, requestId: 'write-during-acquisition', method: 'draft.create', params: { package: data, baseRevision: null, operationId: 'rejected-create' } });
  assert.ok(!rejected.ok && rejected.error.code === 'OPERATION_IN_PROGRESS');
  assert.equal((await call(service, 'library.status', {})).datasets.length, 1);
  await call(service, 'operation.cancel', { operationId: 'active-network' });
  const stopped = await acquisition; assert.ok(!stopped.ok && stopped.error.code === 'CANCELLED');
  assert.equal((await call(service, 'draft.list', {})).length, 0);
  const accepted = await call(service, 'draft.create', { package: data, baseRevision: null, operationId: 'rejected-create' });
  assert.equal(accepted.package.revision.id, 'must-not-arrive');
});
