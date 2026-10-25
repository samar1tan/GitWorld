import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLocalService } from './index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import type { DataPackage } from '../../domain/src/package.ts';
import type { ResearchRecord, ServiceMethod, ServiceMethods, ServiceRequest, WorkspaceState } from '../../contracts/src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)), binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
type Service = Awaited<ReturnType<typeof createLocalService>>;
let sequence = 0;
async function response<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']) {
  return service.dispatch({ protocolVersion: 1, requestId: `workbench-${++sequence}`, method, params } as ServiceRequest);
}
async function call<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const result = await response(service, method, params); assert.ok(result.ok, JSON.stringify(result)); return result.result as ServiceMethods[M]['result'];
}
const review = { reviewer: 'Test', reviewedAt: '2026-10-25T00:00:00Z', evidenceReviewed: true, rightsReviewed: true, note: 'Synthetic test assertions' };
function changed(value: string): DataPackage {
  const data = validPackage(); data.revision.id = data.history.id = `authored-${value}`; data.revision.parentRevisionId = 'revision-1';
  data.history.commits[1].changes.capital = { ...data.history.commits[1].changes.capital!, key: value, label: { en: value } }; return data;
}
async function setup(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-workbench-')), seed = path.join(directory, 'seed.json'); await writeFile(seed, JSON.stringify(validPackage()));
  const files = new Map<string, string>(), services: Service[] = [];
  const sourceFetch: typeof fetch = async url => {
    const ids = new URL(String(url)).searchParams.get('ids')!.split('|');
    return new Response(JSON.stringify({ entities: Object.fromEntries(ids.map(id => [id, { id, type: id.startsWith('P') ? 'property' : 'item', lastrevid: 1, labels: { en: { language: 'en', value: `Synthetic ${id}` } }, descriptions: {}, aliases: {}, claims: id !== 'Q7001' ? {} : { P17: [{ id: `${id}$first`, rank: 'normal', mainsnak: { property: 'P17', snaktype: 'value', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { id: 'Q2' } } }, qualifiers: Object.fromEntries([['P580', '0800'], ['P582', '0900']].map(([property, year]) => [property, [{ snaktype: 'value', property, datatype: 'time', datavalue: { type: 'time', value: { time: `+${year}-00-00T00:00:00Z`, precision: 9, calendarmodel: 'http://www.wikidata.org/entity/Q1985786' } } }]])), references: [] }] } }])) }));
  };
  const options = { dataDirectory: path.join(directory, 'library'), seedPackagePath: seed, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), sourceFetch, resolveFileToken: (token: string) => files.get(token) };
  const open = async () => { const service = await createLocalService(options); services.push(service); return service; };
  t.after(async () => { for (const service of services) await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { service: await open(), open, directory, files };
}
async function publish(service: Service, data: DataPackage, id: string) {
  const status = await call(service, 'repository.status', {}), previous = (await call(service, 'model.catalog', { revision: 'working' })).models.find(value => value.datasetId === data.dataset.id);
  const draft = await call(service, 'draft.create', { package: data, baseRevision: previous ? { datasetId: data.dataset.id, revisionId: status.head } : null, operationId: `draft-${id}` });
  const input = { draftId: draft.id, expectedVersion: draft.version, operationId: id, expectedHead: status.head, expectedModelHash: previous?.contentHash ?? null, review };
  return { draft, input, result: await call(service, 'draft.publish', input) };
}
async function adopt(service: Service) {
  const fetched = await call(service, 'source.collect', { entityIds: ['Q7001'], operationId: 'fetch-object' }); assert.ok(fetched.ok);
  const preview = await call(service, 'knowledge.previewJob', { jobId: fetched.value.id }), status = await call(service, 'repository.status', {});
  return call(service, 'knowledge.adoptJob', { jobId: fetched.value.id, expectedHead: status.head, expectedInputHash: preview.inputHash, operationId: 'adopt-object', review: 'unreviewed' });
}

test('models and object assertions share one freeze/commit; replay never overwrites later C or fabricates a SQL HEAD', native, async t => {
  const { service, open, directory, files } = await setup(t), initial = await call(service, 'repository.status', {});
  assert.equal((await call(service, 'library.status', {})).datasets[0].activeRevisionId, initial.head);
  const old = await call(service, 'model.read', { datasetId: 'test-world', revision: initial.head });
  assert.equal(old.package.revision.id, 'revision-1');
  const b = await publish(service, changed('B'), 'publish-B'); assert.ok(b.result.working);
  assert.equal((await call(service, 'repository.status', {})).head, initial.head);
  assert.equal((await call(service, 'revision.list', { datasetId: 'test-world' })).length, 1);
  assert.equal((await call(service, 'model.read', { datasetId: 'test-world', revision: initial.head })).contentHash, old.contentHash);
  await adopt(service);
  const working = await call(service, 'repository.status', {});
  assert.ok(working.unstaged.some(value => value.path === b.result.working!.path)); assert.ok(working.unstaged.some(value => value.path.startsWith('objects/')));
  const staged = await call(service, 'repository.stage', { paths: working.unstaged.map(value => value.path) });
  const cDraft = await call(service, 'draft.save', { draftId: b.draft.id, expectedVersion: b.draft.version, package: changed('C') });
  await call(service, 'draft.publish', { ...b.input, expectedVersion: cDraft.version, expectedModelHash: b.result.working!.contentHash, operationId: 'publish-C' });
  assert.deepEqual(await call(service, 'draft.publish', b.input), b.result);
  const backup = path.join(directory, 'mixed.gitworld'); files.set('mixed-backup', backup); files.set('mixed-restore', backup);
  await call(service, 'backup.create', { fileToken: 'mixed-backup', operationId: 'backup-mixed-frozen' });
  const executed = await call(service, 'command.execute', { input: { command: 'git commit -m "Record mixed B"' }, operationId: 'mixed-B', expectedHead: staged.head, expectedTree: staged.stagedTree });
  assert.ok(executed.ok && executed.output.kind === 'repository-commit'); const committed = executed.output.commit;
  assert.equal((await call(service, 'model.read', { datasetId: 'test-world', revision: committed.oid })).package.history.commits[1].changes.capital!.key, 'B');
  assert.equal((await call(service, 'model.read', { datasetId: 'test-world', revision: 'working' })).package.history.commits[1].changes.capital!.key, 'C');
  assert.equal((await call(service, 'knowledge.state', { revision: committed.oid, state: { objectId: 'wikidata:Q7001', year: 825, includeUnreviewed: true } })).fields[0].status, 'known');
  const after = await call(service, 'repository.status', {}); assert.equal(after.staged.length, 0); assert.deepEqual(after.unstaged.map(value => value.path), [b.result.working!.path]);
  const restored = await call(service, 'backup.restore', { fileToken: 'mixed-restore', operationId: 'restore-mixed-frozen' });
  assert.equal(restored.datasets[0].activeRevisionId, initial.head);
  const frozen = await call(service, 'repository.status', {}); assert.equal(frozen.head, initial.head); assert.equal(frozen.stagedTree, staged.stagedTree);
  await service.close(); const restarted = await open();
  assert.deepEqual(await call(restarted, 'draft.publish', b.input), b.result);
  assert.equal((await call(restarted, 'model.read', { datasetId: 'test-world', revision: 'working' })).package.history.commits[1].changes.capital!.key, 'C');
  assert.equal((await call(restarted, 'revision.get', { dataset: { datasetId: 'test-world', revisionId: 'revision-1' } })).history.commits[1].changes.capital!.key, 'new');
});

test('explicit global history GUI/text operations preserve targets, observations, aliases and fixed revisions', native, async t => {
  const { service } = await setup(t); await adopt(service);
  const staged = await call(service, 'repository.stage', { paths: (await call(service, 'repository.status', {})).unstaged.map(value => value.path) });
  const commit = await call(service, 'repository.commit', { operationId: 'historical-material', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record material' });
  const target = { kind: 'model' as const, modelId: 'test-world', revision: commit.oid };
  const cli = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${commit.oid} show state:old` } });
  const gui = await call(service, 'command.execute', { input: { intent: { family: 'history', target, intent: { type: 'show', ref: 'state:old' }, context: { head: null } } } });
  assert.ok(cli.ok && gui.ok); assert.deepEqual(cli.effect, gui.effect); assert.equal(cli.output.kind, 'model');
  for (const command of ['log realm/main --graph', 'branch --all', 'tag', 'trace state:old', 'blame state:new --field capital', 'diff state:old...state:new', 'checkout state:old']) {
    const execution = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${commit.oid} ${command}` } }); assert.ok(execution.ok, JSON.stringify(execution));
  }
  const checked = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${commit.oid} show CHECKED` }, context: { head: 'old' }, contextTarget: target }); assert.ok(checked.ok);
  const object = { kind: 'object' as const, objectId: 'wikidata:Q7001', revision: commit.oid };
  const preview = await call(service, 'command.execute', { input: { intent: { family: 'history', target: object, intent: { type: 'show', state: { year: 825, includeUnreviewed: true } } } } });
  assert.ok(preview.ok && preview.output.kind === 'object-state' && preview.effect.type === 'object-preview'); assert.equal(preview.output.state.fields[0].status, 'known'); assert.equal(preview.effect.reference.includeUnreviewed, true);
  const comparison = await call(service, 'command.execute', { input: { command: `history --object wikidata:Q7001 --revision ${commit.oid} diff 825 875 --include-unreviewed` } });
  assert.ok(comparison.ok && comparison.effect.type === 'object-compare'); assert.equal(comparison.effect.a.revision, commit.oid); assert.equal(comparison.effect.b.includeUnreviewed, true);
  const asymmetric = await call(service, 'command.execute', { input: { intent: { family: 'history', target: object, intent: { type: 'diff', a: { year: 825, includeUnreviewed: true }, b: { ...object, year: 875, includeUnreviewed: false } } } } }); assert.ok(asymmetric.ok);
  const replayed = await call(service, 'command.execute', { input: { command: asymmetric.command } }); assert.ok(replayed.ok); assert.deepEqual(replayed.effect, asymmetric.effect); assert.deepEqual(replayed.output, asymmetric.output);
  const history = await call(service, 'command.execute', { input: { command: `history --object wikidata:Q7001 --revision ${commit.oid} log --include-unreviewed` } }); assert.ok(history.ok && history.output.kind === 'object-history' && history.output.history.observations.length);
  assert.ok((await call(service, 'command.complete', { input: 'history --model ' })).some(value => value.value.includes('test-world')));
  assert.ok((await call(service, 'command.complete', { input: 'history --object ' })).some(value => value.value.includes('wikidata:Q7001')));
  const before = await call(service, 'repository.status', {});
  for (const [command, code] of [ ['git show tag:start', 'COMMAND_MIGRATED'], ['git diff state:old state:new', 'COMMAND_MIGRATED'], ['git checkout realm/main@100', 'COMMAND_MIGRATED'], ['history show state:old', 'TARGET_REQUIRED'], [`history --model test-world --revision ${commit.oid} show HEAD`, 'COMMAND_MIGRATED'], ['history --model test-world --revision working checkout state:old', 'COMMITTED_REVISION_REQUIRED'], ['history --object wikidata:Q7001 --revision working diff 825 875', 'COMMITTED_REVISION_REQUIRED'], ['git status; echo unsafe', 'UNSUPPORTED_SYNTAX'], ['git status | cat', 'UNSUPPORTED_SYNTAX'], ['git add ../../outside.json', 'INVALID_ARGUMENT'], ['git commit -m "no reviewed tree"', 'INVALID_ARGUMENT'] ]) {
    const execution = await call(service, 'command.execute', { input: { command } }); assert.ok(!execution.ok && execution.error.code === code, JSON.stringify(execution));
  }
  assert.deepEqual(await call(service, 'repository.status', {}), before);
  const status = await call(service, 'command.execute', { input: { command: 'git status' } }); assert.ok(status.ok && status.output.kind === 'repository-status');
  await call(service, 'command.execute', { input: { command: 'git branch investigation' } }); await call(service, 'command.execute', { input: { command: 'git switch investigation' } });
  const branches = await call(service, 'command.execute', { input: { command: 'git branch' } }); assert.ok(branches.ok && branches.output.kind === 'repository-branches' && branches.output.branches.some(value => value.name === 'investigation' && value.current));
});

test('working-only import stays a draft until valid publication; Git workspace pins survive another revision and restart', native, async t => {
  const { service, open, directory, files } = await setup(t), initial = await call(service, 'repository.status', {});
  const data = validPackage(); data.dataset.id = data.history.datasetId = 'imported-world'; data.revision.id = data.history.id = 'imported-package';
  const file = path.join(directory, 'import.json'); await writeFile(file, JSON.stringify(data)); files.set('input', file);
  const preview = await call(service, 'import.preview', { fileToken: 'input', operationId: 'preview-model' });
  const draft = await call(service, 'import.accept', { importId: preview.importId, operationId: 'accept-draft' });
  assert.equal((await call(service, 'model.catalog', { revision: 'working' })).models.length, 1);
  const published = await call(service, 'draft.publish', { draftId: draft.id, expectedVersion: draft.version, operationId: 'adopt-imported-model', review, expectedHead: initial.head, expectedModelHash: null }); assert.ok(published.working);
  assert.equal((await call(service, 'library.status', {})).datasets.find(value => value.id === data.dataset.id)!.activeRevisionId, null);
  assert.ok(!(await response(service, 'model.read', { datasetId: data.dataset.id, revision: initial.head })).ok);
  await publish(service, changed('B'), 'workspace-B');
  const staged = await call(service, 'repository.stage', { paths: (await call(service, 'repository.status', {})).unstaged.map(value => value.path) });
  const commit = await call(service, 'repository.commit', { operationId: 'workspace-commit', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Add models' });
  const ref = { datasetId: 'test-world', revisionId: initial.head, commitId: 'old', requestedYear: null };
  const workspace: WorkspaceState = { id: 'explicit-model', version: 0, dataset: { datasetId: 'test-world', revisionId: commit.oid }, locale: 'en', head: ref, comparison: [ref, { ...ref, commitId: 'new', revisionId: commit.oid }], view: { panel: 'snapshot', scopeId: null, processId: null, eventId: null, selectedCommitId: 'new', graphRef: 'realm/main', timeWindow: [-100, 100], cursor: 100, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] };
  const saved = await call(service, 'workspace.save', { workspace, expectedVersion: null }); assert.equal(saved.head!.revisionId, initial.head);
  await publish(service, changed('C'), 'workspace-C');
  const working = await call(service, 'workspace.save', { workspace: { ...saved, dataset: { ...saved.dataset, revisionId: 'working' } }, expectedVersion: saved.version }); assert.deepEqual(working.comparison, saved.comparison);
  const invalid = await response(service, 'workspace.save', { workspace: { ...working, head: { ...ref, commitId: 'missing' } }, expectedVersion: working.version }); assert.ok(!invalid.ok && invalid.error.code === 'VALIDATION_FAILED');
  const unset = await response(service, 'workspace.save', { workspace: { ...working, head: { ...ref, revisionId: 'working' } }, expectedVersion: working.version }); assert.ok(!unset.ok && unset.error.code === 'COMMITTED_REVISION_REQUIRED');
  await service.close(); const restarted = await open(); assert.deepEqual(await call(restarted, 'workspace.load', { workspaceId: saved.id }), working);
});

test('model comparisons resolve each immutable endpoint in its own tree and bind aliases to an explicit context target', native, async t => {
  const { service } = await setup(t), initial = await call(service, 'repository.status', {});
  await publish(service, changed('B'), 'fixed-B');
  const parallel = changed('parallel'); parallel.dataset.id = parallel.history.datasetId = 'parallel-world'; await publish(service, parallel, 'parallel-model');
  const staged = await call(service, 'repository.stage', { paths: (await call(service, 'repository.status', {})).unstaged.map(value => value.path) }), commit = await call(service, 'repository.commit', { operationId: 'fixed-model-B', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record B' });
  const a = { kind: 'model' as const, modelId: 'test-world', revision: initial.head, ref: 'state:new' }, b = { ...a, revision: commit.oid }, target = { kind: 'model' as const, modelId: a.modelId, revision: a.revision };
  const input = { input: { intent: { family: 'history' as const, target, intent: { type: 'compare' as const, a, b }, context: { head: null } } } };
  const compared = await call(service, 'command.execute', input); assert.ok(compared.ok && compared.output.kind === 'model' && compared.output.execution.output.kind === 'diff' && compared.effect.type === 'model-compare');
  const diff = compared.output.execution.output.diff; assert.equal(diff.rows[0].before!.key, 'new'); assert.equal(diff.rows[0].after!.key, 'B'); assert.equal(diff.rows[0].kind, 'changed');
  assert.equal(diff.a.datasetVersion, initial.head); assert.equal(diff.b.datasetVersion, commit.oid); assert.deepEqual(diff.commonBaseIds, []); assert.equal(compared.output.comparison!.commonBaseStatus, 'different-revisions');
  const cli = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${initial.head} diff state:new state:new --against-revision ${commit.oid}` } }); assert.ok(cli.ok); assert.deepEqual(cli.effect, compared.effect);
  await publish(service, changed('C'), 'fixed-C');
  assert.deepEqual(await call(service, 'command.execute', input), compared);
  const latestStage = await call(service, 'repository.stage', { paths: (await call(service, 'repository.status', {})).unstaged.map(value => value.path) }); await call(service, 'repository.commit', { operationId: 'fixed-model-C', expectedHead: latestStage.head, expectedTree: latestStage.stagedTree, message: 'Record correction C' });
  assert.deepEqual(await call(service, 'command.execute', input), compared);
  for (const [patch, code] of [[{ b: { ...b, revision: 'working' } }, 'COMMITTED_REVISION_REQUIRED'], [{ b: { ...b, modelId: 'parallel-world' } }, 'INVALID_ARGUMENT'], [{ mode: 'merge-base' }, 'INVALID_ARGUMENT']] as const) {
    const result = await call(service, 'command.execute', { ...input, input: { intent: { ...input.input.intent, intent: { ...input.input.intent.intent, ...patch } } } }); assert.ok(!result.ok && result.error.code === code, JSON.stringify(result));
  }
  const contextTarget = { kind: 'model' as const, modelId: 'test-world', revision: commit.oid }, context = { head: 'old', comparison: ['old','new'] as [string,string] };
  const matched = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${commit.oid} diff A B` }, contextTarget, context }); assert.ok(matched.ok);
  for (const modelId of ['test-world','parallel-world']) {
    const revision = modelId === 'test-world' ? initial.head : commit.oid;
    const result = await call(service, 'command.execute', { input: { command: `history --model ${modelId} --revision ${revision} show CHECKED` }, contextTarget, context }); assert.ok(!result.ok && result.error.code === 'HEAD_UNSET');
    const completions = await call(service, 'command.complete', { input: `history --model ${modelId} --revision ${revision} show C`, contextTarget, context }); assert.ok(!completions.some(value => value.value.endsWith('CHECKED')));
  }
  const owned = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${commit.oid} show CHECKED` }, contextTarget, context }); assert.ok(owned.ok);
  const unbound = await call(service, 'command.execute', { input: { command: `history --model test-world --revision ${commit.oid} show CHECKED` }, context }); assert.ok(!unbound.ok && unbound.error.code === 'HEAD_UNSET');
  const completions = await call(service, 'command.complete', { input: `history --model test-world --revision ${commit.oid} show C`, contextTarget, context }); assert.ok(completions.some(value => value.value.endsWith('CHECKED')));
});

test('repository diff returns bounded exact pages of frozen B and working C through the same global command', native, async t => {
  const { service } = await setup(t); let first: Awaited<ReturnType<typeof call<'research.save'>>> | undefined;
  for (let index = 0; index < 30; index++) {
    const record: ResearchRecord = { schemaVersion: 1, id: `doc-${String(index).padStart(2,'0')}`, title: 'B', scope: { query: '', timeWindow: null, objectIds: [], fieldIds: [] }, interpretation: '', openQuestions: [], evidence: [], comparison: null, updatedAt: '2026-10-25T00:00:00Z' };
    const saved = await call(service, 'research.save', { record, expectedHash: null }); if (index === 0) first = saved;
  }
  const staged = await call(service, 'repository.stage', { paths: (await call(service, 'repository.status', {})).unstaged.map(value => value.path) });
  await call(service, 'research.save', { record: { ...first!.record, title: 'C' }, expectedHash: first!.contentHash });
  const initialPage = await call(service, 'repository.diff', { mode: 'staged' }); assert.equal(initialPage.total, 30); assert.equal(initialPage.entries.length, 25); assert.equal(initialPage.limit, 25);
  const last = await call(service, 'command.execute', { input: { command: 'git diff --staged --offset 25 --limit 7' } }); assert.ok(last.ok && last.output.kind === 'repository-diff');
  assert.equal(last.output.diff.total, 30); assert.equal(last.output.diff.entries.length, 5); assert.equal(last.output.diff.offset, 25); assert.equal(last.output.diff.limit, 7);
  const selected = await call(service, 'repository.diff', { mode: 'staged', paths: ['research/doc-00.json'] }); assert.equal(selected.total, 1); assert.equal((selected.entries[0].after as unknown as ResearchRecord).title, 'B'); assert.equal(selected.entries[0].before, null);
  const working = await call(service, 'command.execute', { input: { command: 'git diff --limit 1 -- research/doc-00.json' } }); assert.ok(working.ok && working.output.kind === 'repository-diff');
  assert.equal((working.output.diff.entries[0].before as unknown as ResearchRecord).title, 'B'); assert.equal((working.output.diff.entries[0].after as unknown as ResearchRecord).title, 'C');
  const empty = await call(service, 'repository.diff', { mode: 'staged', offset: 100 }); assert.equal(empty.total, 30); assert.equal(empty.entries.length, 0);
  const invalid = await call(service, 'command.execute', { input: { command: 'git diff --limit 101' } }); assert.ok(!invalid.ok && invalid.error.code === 'INVALID_ARGUMENT');
  assert.equal((await call(service, 'repository.status', {})).stagedTree, staged.stagedTree);
});
