import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalService } from './index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, WorkspaceState } from '../../contracts/src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(git) && 'The pinned bundled Git is required.' };
type Service = Awaited<ReturnType<typeof createLocalService>>;
let sequence = 0;
async function response<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']) {
  return service.dispatch({ protocolVersion: 1, requestId: `legacy-model-${++sequence}`, method, params } as ServiceRequest);
}
async function call<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const result = await response(service, method, params); assert.ok(result.ok, JSON.stringify(result)); return result.result as ServiceMethods[M]['result'];
}

test('legacy authored IDs resolve exact committed packages, preserve newer Working data and remain usable after restart', native, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-legacy-model-')), seed = path.join(directory, 'seed.json');
  await writeFile(seed, JSON.stringify(validPackage()));
  const options = { dataDirectory: path.join(directory, 'library'), seedPackagePath: seed, gitExecutable: git, gitExecPath: path.resolve(git, '../../libexec/git-core'), resolveFileToken: () => undefined };
  let service = await createLocalService(options);
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await call(service, 'repository.status', {}), old = await call(service, 'model.read', { datasetId: 'test-world', revision: a.head });
  // This is an explicitly synthetic pre-OID workspace, not copied user data.
  const workspace: WorkspaceState = { id: 'primary', version: 0, dataset: { datasetId: 'test-world', revisionId: 'revision-1' }, locale: 'zh-CN',
    view: { panel: 'history', scopeId: 'region', processId: 'courts', eventId: null, timeWindow: [-100, 100], cursor: 100, viewport: { x: 0, y: 0, width: 1000, height: 500 }, graphBranch: 'realm/main', graphRef: null, selectedCommitId: 'new', requestedYear: 100 }, trail: [],
    head: { datasetId: 'test-world', revisionId: 'revision-1', commitId: 'old', requestedYear: -100 }, comparison: [{ datasetId: 'test-world', revisionId: 'revision-1', commitId: 'old', requestedYear: -100 }, { datasetId: 'test-world', revisionId: 'revision-1', commitId: 'new', requestedYear: 100 }] };
  const saved = await call(service, 'workspace.save', { workspace, expectedVersion: null });
  const b = validPackage(); b.revision.id = b.history.id = 'authored-user-B'; b.history.commits[1].summary = { en: 'A later user interpretation' };
  const draft = await call(service, 'draft.create', { package: b, baseRevision: { datasetId: b.dataset.id, revisionId: a.head }, operationId: 'create-B' });
  const published = await call(service, 'draft.publish', { draftId: draft.id, expectedVersion: draft.version, operationId: 'publish-B', expectedHead: a.head, expectedModelHash: old.contentHash, review: { reviewer: 'Synthetic fixture', reviewedAt: b.revision.createdAt, evidenceReviewed: true, rightsReviewed: true, note: 'Synthetic data' } });
  const stage = await call(service, 'repository.stage', { paths: [published.working!.path] });
  const committed = await call(service, 'repository.commit', { operationId: 'commit-B', expectedHead: stage.head, expectedTree: stage.stagedTree, message: 'Record user B' });
  const c = structuredClone(b); c.history.commits[1].summary = { en: 'Uncommitted user C' };
  const edited = await call(service, 'draft.save', { draftId: draft.id, expectedVersion: draft.version, package: c });
  await call(service, 'draft.publish', { draftId: edited.id, expectedVersion: edited.version, operationId: 'publish-C', expectedHead: committed.oid, expectedModelHash: published.working!.contentHash, review: { reviewer: 'Synthetic fixture', reviewedAt: c.revision.createdAt, evidenceReviewed: true, rightsReviewed: true, note: 'Synthetic data' } });
  const before = await call(service, 'repository.status', {});
  const resolved = await call(service, 'model.resolveLegacy', { dataset: workspace.dataset });
  assert.equal(resolved.revision, a.head); assert.equal(resolved.contentHash, old.contentHash); assert.deepEqual(resolved.package, old.package);
  assert.equal(resolved.legacyAuthoredRevisionId, 'revision-1');
  for (const command of ['show state:new', 'checkout state:old', 'diff state:old state:new']) {
    const result = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${resolved.revision} ${command}` } }); assert.ok(result.ok, JSON.stringify(result));
  }
  const invalid = await response(service, 'command.execute', { input: { intent: { family: 'history', target: { kind: 'model', modelId: 'test-world', revision: 'revision-1' }, intent: { type: 'show', ref: 'state:new' } } } });
  assert.ok(!invalid.ok && invalid.error.code === 'INVALID_REQUEST');
  const normalized = structuredClone(saved); normalized.dataset.revisionId = resolved.revision; normalized.head!.revisionId = resolved.revision; for (const ref of normalized.comparison!) ref.revisionId = resolved.revision;
  await call(service, 'workspace.save', { workspace: normalized, expectedVersion: saved.version });
  assert.deepEqual(await call(service, 'repository.status', {}), before);
  assert.equal((await call(service, 'model.read', { datasetId: 'test-world', revision: 'working' })).package.history.commits[1].summary.en, 'Uncommitted user C');
  await service.close(); service = await createLocalService(options);
  assert.equal((await call(service, 'workspace.load', { workspaceId: 'primary' }))!.dataset.revisionId, a.head);
  assert.equal((await call(service, 'model.resolveLegacy', { dataset: workspace.dataset })).revision, a.head);
  const missing = await response(service, 'model.resolveLegacy', { dataset: { datasetId: 'test-world', revisionId: 'missing-authored-package' } }); assert.ok(!missing.ok && missing.error.code === 'REVISION_NOT_FOUND');
});
