import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLocalService } from './index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import { validateDataPackage, yearDate, type DataPackage, type HistoryCommit } from '../../domain/src/index.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, WorkbenchCommandExecution } from '../../contracts/src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)), binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
function packageFixture(): DataPackage {
  const data = validPackage(), source = data.history.commits[0], evidence = source.evidence!;
  const commit = (id: string, year: number, branchId: string, parents: string[], eventId?: string): HistoryCommit => ({ ...structuredClone(source), id, year, date: yearDate(year), branchId, parents, kind: parents.length > 1 ? 'integration' : parents.length ? 'change' : 'baseline', lineage: parents.map(parentId => ({ parentId, kind: parents.length > 1 ? 'integration' : 'continuation', evidence })), changes: { capital: { ...structuredClone(source.changes.capital!), key: id, label: { en: id, 'zh-CN': id } } }, ...(eventId ? { eventId } : {}), ...(parents.length > 1 ? { integration: { resolutions: { capital: { strategy: 'modify', parentIds: parents, evidence } } } } : {}) });
  data.dataset.id = data.history.datasetId = 'query-recovery-model'; data.revision.id = data.history.id = 'query-recovery-r1';
  const branch = data.history.branches[0];
  data.history.branches = [
    { ...branch, id: 'qa/shared', coverage: [-100, -51], commitIds: ['root'] },
    { ...branch, id: 'qa/left', coverage: [-50, 50], commitIds: ['base-a', 'tip-x'] },
    { ...branch, id: 'qa/right', coverage: [-50, 60], commitIds: ['base-b', 'tip-y'] },
    { ...branch, id: 'qa/independent', coverage: [80, 100], commitIds: ['independent'] },
  ];
  data.history.commits = [commit('root', -100, 'qa/shared', []), commit('base-a', -50, 'qa/left', ['root'], 'split'), commit('base-b', -50, 'qa/right', ['root'], 'split'), commit('tip-x', 50, 'qa/left', ['base-a', 'base-b']), commit('tip-y', 60, 'qa/right', ['base-b', 'base-a']), commit('independent', 80, 'qa/independent', [])];
  data.history.tags = []; data.catalog.processes[0].branchIds = data.history.branches.map(value => value.id); data.catalog.processes[0].eventIds = ['split'];
  data.catalog.events = [{ id: 'split', title: { en: 'Synthetic split' }, summary: { en: 'Two synthetic states, not a historical assertion.' }, commitIds: ['base-a', 'base-b'], sourceIds: ['source'] }];
  assert.ok(validateDataPackage(data, 'publish').ok); return data;
}
type Service = Awaited<ReturnType<typeof createLocalService>>;
async function call<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const response = await service.dispatch({ protocolVersion: 1, requestId: crypto.randomUUID(), method, params } as ServiceRequest); assert.ok(response.ok, JSON.stringify(response)); return response.result as ServiceMethods[M]['result'];
}
async function fixture(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-command-recovery-')), seed = path.join(directory, 'seed.json'), data = packageFixture(); await writeFile(seed, JSON.stringify(data));
  const service = await createLocalService({ dataDirectory: path.join(directory, 'library'), seedPackagePath: seed, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), resolveFileToken: () => undefined });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const status = await call(service, 'repository.status', {}), target = { kind: 'model' as const, modelId: data.dataset.id, revision: status.head };
  const execute = (action: string, revision = status.head) => call(service, 'command.execute', { input: { command: `history --model ${data.dataset.id} --revision ${revision} ${action}` } });
  return { service, data, status, target, execute };
}
const errorOf = (value: WorkbenchCommandExecution) => { assert.equal(value.ok, false); if (value.ok) throw Error('Expected command error'); assert.equal(value.effect.type, 'none'); return value.error; };

test('ambiguous model recovery retains candidate identity and executes Show at its original OID', native, async t => {
  const f = await fixture(t), before = await call(f.service, 'repository.status', {}), error = errorOf(await f.execute('show event:split'));
  assert.equal(error.code, 'AMBIGUOUS_REF'); assert.deepEqual(error.candidates, ['commit:base-a', 'commit:base-b']); assert.equal(error.recoveryActions?.length, 2);
  for (const action of error.recoveryActions!) {
    assert.equal(action.kind, 'model-state'); if (action.kind !== 'model-state') throw Error('Wrong action');
    assert.equal(action.reference.modelId, f.data.dataset.id); assert.equal(action.reference.revision, f.status.head); assert.equal(action.reference.ref, action.candidate.replace(/^commit:/, 'state:'));
    const result = await call(f.service, 'command.execute', { input: { command: action.command } }); assert.ok(result.ok && result.output.kind === 'model' && result.output.execution.output.kind === 'snapshot');
    assert.equal(result.output.target.revision, f.status.head); assert.equal(result.output.execution.output.version.ref, action.candidate); assert.equal(result.output.execution.effect.type, 'preview');
  }
  assert.deepEqual(await call(f.service, 'repository.status', {}), before);
});

test('multiple/no-base recoveries compare resolved endpoints in the original direction without selecting a base', native, async t => {
  const f = await fixture(t);
  for (const [a, b, code] of [['tip-x', 'tip-y', 'MULTIPLE_COMMON_BASES'], ['tip-y', 'tip-x', 'MULTIPLE_COMMON_BASES'], ['tip-x', 'independent', 'NO_COMMON_BASE']] as const) {
    const context = { head: 'root', comparison: [a, b] as [string, string] }, original = structuredClone(context);
    const failed = await call(f.service, 'command.execute', { input: { command: `history --model ${f.data.dataset.id} --revision ${f.status.head} diff A...B` }, context, contextTarget: f.target });
    const error = errorOf(failed); assert.equal(error.code, code); assert.equal(error.recoveryActions?.length, 1); const action = error.recoveryActions![0]; assert.equal(action.kind, 'model-endpoints'); if (action.kind !== 'model-endpoints') throw Error('Wrong action');
    assert.deepEqual(action.a, { ...f.target, ref: `state:${a}` }); assert.deepEqual(action.b, { ...f.target, ref: `state:${b}` });
    const result = await call(f.service, 'command.execute', { input: { command: action.command } }); assert.ok(result.ok && result.output.kind === 'model' && result.output.execution.output.kind === 'diff');
    assert.equal(result.output.execution.output.diff.a.commitId, a); assert.equal(result.output.execution.output.diff.b.commitId, b); assert.equal(result.output.execution.output.diff.query?.mode, 'endpoints'); assert.deepEqual(context, original);
  }
  for (const typed of [false, true]) {
    const a = { ...f.target, ref: 'qa/left@40' }, b = { ...f.target, ref: 'qa/independent@90' };
    const failed = await call(f.service, 'command.execute', typed ? { input: { intent: { family: 'history', target: f.target, context: { head: null }, intent: { type: 'compare', a, b, mode: 'merge-base' } } } } : { input: { command: `history --model ${f.data.dataset.id} --revision ${f.status.head} diff ${a.ref}...${b.ref}` } });
    const error = errorOf(failed); assert.equal(error.code, 'NO_COMMON_BASE'); const action = error.recoveryActions![0]; assert.equal(action.kind, 'model-endpoints'); if (action.kind !== 'model-endpoints') throw Error('Wrong action');
    assert.deepEqual(action.a, a); assert.deepEqual(action.b, b);
    const result = await call(f.service, 'command.execute', { input: { command: action.command } }); assert.ok(result.ok && result.output.kind === 'model' && result.output.execution.output.kind === 'diff');
    assert.equal(result.output.execution.output.diff.a.requestedYear, 40); assert.equal(result.output.execution.output.diff.a.recordedYear, -50); assert.equal(result.output.execution.output.diff.b.requestedYear, 90); assert.equal(result.output.execution.output.diff.b.recordedYear, 80);
  }
  assert.equal((await call(f.service, 'repository.status', {})).head, f.status.head);
});

test('cross-revision B ambiguity inspects B and never substitutes the open model revision or A target', native, async t => {
  const f = await fixture(t), data = structuredClone(f.data), old = await call(f.service, 'model.read', { datasetId: f.data.dataset.id, revision: f.status.head });
  data.revision.id = data.history.id = 'query-recovery-r2'; data.revision.parentRevisionId = f.status.head;
  data.history.commits.find(value => value.id === 'base-a')!.changes.capital!.label = { en: 'Only in B revision' };
  const draft = await call(f.service, 'draft.create', { package: data, baseRevision: { datasetId: data.dataset.id, revisionId: f.status.head }, operationId: 'recovery-draft' });
  const result = await call(f.service, 'draft.publish', { draftId: draft.id, expectedVersion: draft.version, expectedHead: f.status.head, expectedModelHash: old.contentHash, operationId: 'recovery-apply', review: { reviewer: 'Technical test', reviewedAt: '2026-10-25T00:00:00Z', evidenceReviewed: true, rightsReviewed: true, note: 'Synthetic query contract only' } });
  const stage = await call(f.service, 'repository.stage', { paths: [result.working!.path] }), committed = await call(f.service, 'repository.commit', { operationId: 'recovery-commit', expectedHead: stage.head, expectedTree: stage.stagedTree, message: 'Record synthetic model B' });
  const command = `history --model ${data.dataset.id} --revision ${f.status.head} diff state:root event:split --against-revision ${committed.oid}`;
  const error = errorOf(await call(f.service, 'command.execute', { input: { command } })); assert.equal(error.code, 'AMBIGUOUS_REF');
  for (const action of error.recoveryActions!) {
    assert.equal(action.kind, 'model-state'); if (action.kind !== 'model-state') throw Error('Wrong action'); assert.equal(action.reference.revision, committed.oid);
    const inspected = await call(f.service, 'command.execute', { input: { command: action.command } }); assert.ok(inspected.ok && inspected.output.kind === 'model'); assert.equal(inspected.output.target.revision, committed.oid);
  }
  const invalid = errorOf(await call(f.service, 'command.execute', { input: { intent: { family: 'history', target: f.target, context: { head: null }, intent: { type: 'compare', a: { ...f.target, ref: 'state:root' }, b: { ...f.target, modelId: 'different-model', revision: committed.oid, ref: 'event:split' } } } } })); assert.equal(invalid.code, 'INVALID_ARGUMENT'); assert.equal(invalid.recoveryActions, undefined);
  const crossBase = errorOf(await call(f.service, 'command.execute', { input: { command: `history --model ${data.dataset.id} --revision ${f.status.head} diff state:root...state:tip-x --against-revision ${committed.oid}` } })); assert.equal(crossBase.code, 'INVALID_ARGUMENT'); assert.equal(crossBase.recoveryActions, undefined);
});

test('bare checked aliases and migration templates stay syntax, while complete help recovery executes', native, async t => {
  const f = await fixture(t), checked = errorOf(await f.execute('show HEAD'));
  assert.equal(checked.replacement, 'CHECKED'); assert.equal(checked.recoveryActions, undefined);
  const template = errorOf(await call(f.service, 'command.execute', { input: { command: 'git show state:root' } })); assert.match(template.replacement!, /<model-id>/); assert.equal(template.recoveryActions, undefined);
  const bare = errorOf(await call(f.service, 'command.execute', { input: { command: 'commit:base-a' } })); assert.equal(bare.recoveryActions?.[0].kind, 'command');
  const help = await call(f.service, 'command.execute', { input: { command: bare.recoveryActions![0].command } }); assert.ok(help.ok && help.output.kind === 'help');
});
