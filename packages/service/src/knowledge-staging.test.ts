import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeObject, KnowledgeSource, KnowledgeValue } from '../../domain/src/knowledge.ts';
import type { EditorialJson, EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, ServiceResponse } from '../../contracts/src/index.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createLocalService } from './index.ts';
import { knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { brokenKnowledgeReferencePaths, knowledgeEntityReferences, knowledgeObjectPath as objectPath } from './knowledge-staging.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const json = (value: unknown) => value as EditorialJson;
const sourcePath = (id: string) => `sources/${hash(id)}.json`;
const named = (id: string): KnowledgeObject => ({ id, labels: { en: id }, types: [], identities: [], aliases: [], descriptions: {} });
const entity = (objectId: string): KnowledgeValue => ({ kind: 'entity', objectId });
function source(id = 'fixture:source'): KnowledgeSource {
  const record = { synthetic: id };
  return { id, identity: { provider: 'fixture', externalId: id }, revision: '1', contentHash: hash(record), retrievedAt: '2026-10-26T00:00:00Z', url: 'https://example.invalid/fixture', adapterVersion: 'fixture', rights: { redistribution: 'unknown' }, record };
}
function claim(subjectId: string, value: KnowledgeValue, id = `claim:${subjectId}`, sourceId = 'fixture:source'): KnowledgeAssertion {
  return { id, subjectId, propertyId: 'fixture:link', value, qualifiers: [], sourceSnapshotId: sourceId, evidence: [{ sourceId, locator: 'Synthetic row' }], review: 'unreviewed' };
}
function collection(): KnowledgeCollection {
  return { schemaVersion: 1, objects: [named('fixture:subject'), named('fixture:original')], assertions: [claim('fixture:subject', entity('fixture:original'))], sources: [source()] };
}
async function fixture(t: { after(fn: () => unknown): void }, initial = collection()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-staging-links-'));
  const options = { dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') };
  const initialRepository = await createEditorialRepository(options);
  await initialRepository.initialize(knowledgeCollectionSeedFiles(initial));
  await initialRepository.close();
  let service = await createLocalService({ ...options, resolveFileToken: () => undefined }), sequence = 0;
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  async function request<M extends ServiceMethod>(method: M, params: ServiceMethods[M]['params']): Promise<ServiceResponse<M>> {
    return await service.dispatch({ protocolVersion: 1, requestId: `staging-link-${++sequence}`, method, params } as ServiceRequest) as ServiceResponse<M>;
  }
  async function call<M extends ServiceMethod>(method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
    const response = await request(method, params); assert.ok(response.ok, JSON.stringify(response)); return response.result;
  }
  async function reopen() { await service.close(); service = await createLocalService({ ...options, resolveFileToken: () => undefined }); }
  // Fault fixtures deliberately construct an old or externally incomplete index, never a user library.
  async function raw(change: (repository: EditorialRepository) => Promise<unknown>) {
    await service.close();
    const repository = await createEditorialRepository(options);
    try { await repository.initialize(); await change(repository); } finally { await repository.close(); }
    service = await createLocalService({ ...options, resolveFileToken: () => undefined });
  }
  async function addTarget(title = 'New sourced office', value?: KnowledgeValue) {
    const context = await call('knowledge.editContext', {});
    return call('knowledge.saveEdit', { operationId: `add-target-${++sequence}`, expectedHead: context.head, expectedObjectHash: null,
      change: { mode: 'add', newObject: { labels: { en: title, 'zh-CN': '新职务' }, types: [] }, propertyId: 'fixture:link', value: value ?? { kind: 'text', value: title }, validTime: null,
        evidence: { sourceId: 'fixture:source', locator: 'Synthetic title' }, review: 'adopted', reason: 'Create a sourced synthetic office' } });
  }
  async function correct(targetId?: string, assertionId = 'claim:fixture:subject', objectId = 'fixture:subject', text?: string) {
    const context = await call('knowledge.editContext', { objectId });
    return call('knowledge.saveEdit', { operationId: `correct-link-${++sequence}`, expectedHead: context.head, expectedObjectHash: context.objectHash, objectId, assertionId,
      change: { mode: 'correct', propertyId: 'fixture:link', ...(targetId ? { value: entity(targetId) } : text ? { value: { kind: 'text' as const, value: text } } : {}),
        evidence: { sourceId: 'fixture:source', locator: 'Synthetic row' }, review: 'adopted', reason: 'Record the selected local interpretation' } });
  }
  async function stage(paths: string[]) {
    const plan = await call('repository.stagePlan', { paths }); assert.deepEqual(plan.missing, []); assert.deepEqual(plan.incomplete ?? [], []);
    return call('repository.stage', { paths: [...new Set([...plan.selected, ...plan.required])] });
  }
  async function commit(operationId: string) {
    const status = await call('repository.status', {});
    return call('repository.commit', { operationId, expectedHead: status.head, expectedTree: status.stagedTree, message: 'Record the synthetic reference closure' });
  }
  return { call, request, raw, reopen, addTarget, correct, stage, commit };
}
function expectDependency(response: ServiceResponse, target: string) {
  assert.ok(!response.ok, JSON.stringify(response));
  assert.equal(response.error.code, 'REVIEW_REQUIRED');
  assert.ok(response.error.issues?.some(issue => issue.code === 'DANGLING_REFERENCE' && issue.path === objectPath(target)), JSON.stringify(response));
}

test('typed reference traversal includes qualifiers, ignores opaque raw payloads and permits existing unresolved imports', () => {
  const data = collection();
  data.assertions[0].qualifiers = [{ propertyId: 'fixture:context', value: entity('fixture:qualifier') }, { propertyId: 'fixture:raw', value: { kind: 'raw', value: { kind: 'entity', objectId: 'opaque:not-a-reference' } } }];
  const files = knowledgeCollectionSeedFiles(data);
  assert.deepEqual(knowledgeEntityReferences(files).map(value => value.targetId), ['fixture:original', 'fixture:qualifier']);
  assert.deepEqual(brokenKnowledgeReferencePaths({}, files), []);
  const candidate = { ...files }; delete candidate[objectPath('fixture:original')];
  assert.deepEqual(brokenKnowledgeReferencePaths(files, candidate), [objectPath('fixture:original')]);
});

test('ordinary new entity correction stages the target and its source, blocks incomplete unstage and commits a readable target', native, async t => {
  const f = await fixture(t), target = await f.addTarget(), correction = await f.correct(target.objectId), selected = [objectPath('fixture:subject')];
  const before = await f.call('repository.status', {}), plan = await f.call('repository.stagePlan', { paths: selected });
  assert.equal(before.unstaged.length, 4);
  assert.deepEqual(new Set(plan.required), new Set([...target.paths, correction.paths[0]]));
  assert.deepEqual(plan.missing, []);
  const incomplete = await f.request('repository.stage', { paths: selected }); expectDependency(incomplete, target.objectId);
  assert.equal((await f.call('repository.status', {})).stagedTree, before.stagedTree);
  const all = [...selected, ...plan.required]; await f.call('repository.stage', { paths: all });
  const frozen = await f.call('repository.status', {});
  expectDependency(await f.request('repository.unstage', { paths: [objectPath(target.objectId)] }), target.objectId);
  assert.equal((await f.call('repository.status', {})).stagedTree, frozen.stagedTree);
  assert.equal((await f.call('repository.unstage', { paths: all })).staged.length, 0);
  await f.stage(selected); const saved = await f.commit('commit-linked-new-office');
  assert.equal((await f.call('knowledge.object', { objectId: target.objectId, revision: saved.oid })).assertions[0].value.kind, 'text');
  assert.deepEqual((await f.call('knowledge.object', { objectId: 'fixture:subject', revision: saved.oid })).assertions[0].value, entity(target.objectId));
  await f.reopen();
  assert.equal((await f.call('knowledge.object', { objectId: target.objectId, revision: saved.oid })).sources.length, 2);
  assert.equal((await f.call('repository.status', {})).unstaged.length, 0);
});

test('recursive entity and qualifier dependencies close cycles once and exclude unrelated working objects', native, async t => {
  const initial = collection(), f = await fixture(t, initial), expanded = structuredClone(initial);
  const ids = ['fixture:second', 'fixture:third', 'fixture:qualifier', 'fixture:unrelated'];
  expanded.objects.push(...ids.map(named)); expanded.sources.push(...ids.map(id => source(`source:${id}`)));
  expanded.assertions[0].value = entity(ids[0]);
  expanded.assertions.push(claim(ids[0], entity(ids[1]), 'second-link', `source:${ids[0]}`), claim(ids[1], entity(ids[0]), 'cycle-link', `source:${ids[1]}`), claim(ids[2], entity('fixture:subject'), 'qualifier-link', `source:${ids[2]}`), claim(ids[3], { kind: 'text', value: 'Unrelated work' }, 'unrelated-link', `source:${ids[3]}`));
  expanded.assertions[1].qualifiers.push({ propertyId: 'fixture:context', value: entity(ids[2]) });
  const oldFiles = knowledgeCollectionSeedFiles(initial), nextFiles = knowledgeCollectionSeedFiles(expanded);
  await f.raw(repository => repository.write(Object.entries(nextFiles).filter(([name, value]) => oldFiles[name] === undefined || name.startsWith('objects/') && hash(value) !== hash(oldFiles[name])).map(([path, value]) => ({ path, value }))));
  const plan = await f.call('repository.stagePlan', { paths: [objectPath('fixture:subject')] });
  for (const id of ids.slice(0, 3)) { assert.ok(plan.required.includes(objectPath(id))); assert.ok(plan.required.includes(sourcePath(`source:${id}`))); }
  assert.ok(!plan.required.includes(objectPath(ids[3]))); assert.ok(!plan.required.includes(sourcePath(`source:${ids[3]}`)));
  assert.equal(new Set(plan.required).size, plan.required.length); assert.deepEqual(plan.missing, []);
  await f.stage(plan.selected);
  expectDependency(await f.request('repository.unstage', { paths: [objectPath(ids[2])] }), ids[2]);
  const saved = await f.commit('commit-cyclic-reference-closure');
  assert.deepEqual((await f.call('knowledge.object', { objectId: ids[0], revision: saved.oid })).assertions[0].qualifiers[0].value, entity(ids[2]));
  assert.ok((await f.call('repository.status', {})).unstaged.some(value => value.path === objectPath(ids[3])));
});

test('a referenced frozen target B is not replaced by its later working C or C source', native, async t => {
  const f = await fixture(t), target = await f.addTarget('Frozen office B'); await f.stage(target.paths);
  const later = await f.correct(undefined, target.assertionId, target.objectId, 'Later working C');
  await f.correct(target.objectId);
  const plan = await f.call('repository.stagePlan', { paths: [objectPath('fixture:subject')] });
  assert.ok(!plan.required.includes(objectPath(target.objectId))); assert.ok(!plan.required.includes(later.paths[0]));
  await f.stage(plan.selected); const saved = await f.commit('commit-frozen-target-b');
  assert.deepEqual((await f.call('knowledge.object', { objectId: target.objectId, revision: saved.oid })).assertions[0].value, { kind: 'text', value: 'Frozen office B' });
  assert.deepEqual((await f.call('knowledge.object', { objectId: target.objectId })).assertions[0].value, { kind: 'text', value: 'Later working C' });
  const status = await f.call('repository.status', {});
  assert.equal(status.staged.length, 0); assert.deepEqual(new Set(status.unstaged.map(value => value.path)), new Set(later.paths));
});

test('a new target revised before its first stage retains its recursive manual source history', native, async t => {
  const f = await fixture(t), target = await f.addTarget('First interpretation');
  const revised = await f.correct(undefined, target.assertionId, target.objectId, 'Reviewed interpretation');
  await f.correct(target.objectId);
  const plan = await f.call('repository.stagePlan', { paths: [objectPath('fixture:subject')] });
  assert.ok(plan.required.includes(target.paths[0])); assert.ok(plan.required.includes(revised.paths[0]));
  await f.stage(plan.selected);
  const before = await f.call('repository.status', {}), removed = await f.request('repository.unstage', { paths: [target.paths[0]] });
  assert.ok(!removed.ok && removed.error.code === 'REVIEW_REQUIRED'); assert.ok(removed.error.issues?.some(issue => issue.path === target.paths[0]));
  assert.equal((await f.call('repository.status', {})).stagedTree, before.stagedTree);
  const saved = await f.commit('commit-target-with-original-sources');
  const detail = await f.call('knowledge.object', { objectId: target.objectId, revision: saved.oid });
  assert.deepEqual(detail.assertions[0].value, { kind: 'text', value: 'Reviewed interpretation' });
  await f.raw(async repository => { assert.ok(await repository.read(target.paths[0], { from: saved.oid })); assert.ok(await repository.read(revised.paths[0], { from: saved.oid })); });
  const diff = await f.call('repository.diff', { mode: 'staged' }); assert.equal(diff.total, 0);
});

test('a context membership selection expands its newly required object through the same complete entity closure', native, async t => {
  const f = await fixture(t), target = await f.addTarget('Related office'), subject = await f.addTarget('New related subject', entity(target.objectId));
  const detail = await f.call('knowledge.object', { objectId: subject.objectId });
  const context = await f.call('context.save', { operationId: 'create-staging-context', expectedHead: (await f.call('repository.status', {})).head, expectedContentHash: null, labels: { en: 'Synthetic scope', 'zh-CN': '合成背景' } });
  const batches = await f.call('context.batches', { limit: 100 });
  const batch = batches.items.find(value => value.batch.kind === 'saved-source' && value.batch.sourceId === detail.assertions[0].sourceSnapshotId && value.batch.selection === 'source-claim-subjects')!.batch;
  const membership = await f.call('context.membershipPlan', { contextId: context.contextId, expectedHead: context.head, expectedDefinitionHash: context.contentHash, batch, mode: 'add', rationale: 'Organize the synthetic subject' });
  const applied = await f.call('context.applyMembership', { operationId: 'apply-staging-context', planId: membership.planId, expectedPlanHash: membership.planHash });
  const plan = await f.call('repository.stagePlan', { paths: applied.paths });
  for (const name of [...subject.paths, ...target.paths, ...context.paths]) assert.ok(plan.required.includes(name), name);
  assert.deepEqual(plan.missing, []);
  await f.call('repository.stage', { paths: [...new Set([...plan.selected, ...plan.required])] });
  const saved = await f.commit('commit-membership-reference-closure');
  assert.equal((await f.call('context.get', { contextId: context.contextId, revision: saved.oid })).total, 1);
  assert.equal((await f.call('knowledge.object', { objectId: target.objectId, revision: saved.oid })).object.id, target.objectId);
});

test('new unresolved imported values and qualifiers remain valid, including an explicit keep-value correction', native, async t => {
  const initial = collection(), f = await fixture(t, initial), unresolved = claim('fixture:subject', entity('external:unresolved'), 'unresolved-import');
  unresolved.qualifiers.push({ propertyId: 'fixture:context', value: entity('external:context') });
  const files = knowledgeCollectionSeedFiles({ ...initial, assertions: [...initial.assertions, unresolved] });
  await f.raw(repository => repository.write([{ path: objectPath('fixture:subject'), value: files[objectPath('fixture:subject')] }]));
  await f.stage([objectPath('fixture:subject')]); await f.commit('commit-unresolved-import');
  const corrected = await f.correct(undefined, unresolved.id); await f.stage(corrected.paths); const saved = await f.commit('commit-kept-unresolved-value');
  const assertion = (await f.call('knowledge.object', { objectId: 'fixture:subject', revision: saved.oid })).assertions.find(value => value.id === unresolved.id)!;
  assert.deepEqual(assertion.value, unresolved.value); assert.deepEqual(assertion.qualifiers, unresolved.qualifiers);
});

test('a later working target does not retroactively invalidate or alter an unresolved frozen import B', native, async t => {
  const initial = collection(), f = await fixture(t, initial), imported = claim('fixture:subject', entity('external:later-target'), 'unresolved-b');
  const files = knowledgeCollectionSeedFiles({ ...initial, assertions: [...initial.assertions, imported] });
  await f.raw(repository => repository.write([{ path: objectPath('fixture:subject'), value: files[objectPath('fixture:subject')] }]));
  const staged = await f.stage([objectPath('fixture:subject')]);
  await f.raw(repository => repository.write([{ path: objectPath('external:later-target'), value: json({ schemaVersion: 1, object: named('external:later-target'), assertions: [] }) }]));
  const saved = await f.commit('commit-originally-unresolved-b');
  assert.equal((await f.call('repository.status', {})).stagedTree, staged.stagedTree);
  const absent = await f.request('knowledge.object', { objectId: 'external:later-target', revision: saved.oid }); assert.ok(!absent.ok && absent.error.code === 'NOT_FOUND');
  assert.ok((await f.call('repository.status', {})).unstaged.some(value => value.path === objectPath('external:later-target')));
});

test('stage and commit reject severing a resolved target, while an explicit coherent removal or restoration is allowed', native, async t => {
  const initial = collection(), f = await fixture(t, initial), target = 'fixture:original', targetPath = objectPath(target);
  await f.raw(repository => repository.write([{ path: targetPath, value: null }]));
  assert.deepEqual((await f.call('repository.stagePlan', { paths: [targetPath] })).missing, [targetPath]);
  expectDependency(await f.request('repository.stage', { paths: [targetPath] }), target);
  await f.raw(async repository => { await repository.stage([{ path: targetPath, value: null }]); await repository.write([{ path: targetPath, value: knowledgeCollectionSeedFiles(initial)[targetPath] }]); });
  assert.deepEqual((await f.call('repository.stagePlan', { paths: [objectPath('fixture:subject')] })).missing, [targetPath]);
  const before = await f.call('repository.status', {});
  expectDependency(await f.request('repository.commit', { operationId: 'reject-staged-target-deletion', expectedHead: before.head, expectedTree: before.stagedTree, message: 'Cannot sever a resolved relation' }), target);
  assert.deepEqual(await f.call('repository.status', {}), before);
  const restorePlan = await f.call('repository.stagePlan', { paths: [objectPath('fixture:subject'), targetPath] }); assert.deepEqual(restorePlan.missing, []);
  await f.stage(restorePlan.selected); assert.equal((await f.call('repository.status', {})).staged.length, 0);
  const subject = knowledgeCollectionSeedFiles({ ...initial, assertions: [] })[objectPath('fixture:subject')];
  await f.raw(repository => repository.write([{ path: targetPath, value: null }, { path: objectPath('fixture:subject'), value: subject }]));
  await f.stage([targetPath, objectPath('fixture:subject')]); const saved = await f.commit('commit-coherent-relation-removal');
  const absent = await f.request('knowledge.object', { objectId: target, revision: saved.oid }); assert.ok(!absent.ok && absent.error.code === 'NOT_FOUND');
});

test('an old incomplete index with a newly selected manual target fails commit without changing HEAD or the frozen selection', native, async t => {
  const f = await fixture(t), target = await f.addTarget(), corrected = await f.correct(target.objectId);
  await f.raw(repository => repository.stage(corrected.paths.map(path => ({ path }))));
  const before = await f.call('repository.status', {});
  expectDependency(await f.request('repository.commit', { operationId: 'reject-old-incomplete-index', expectedHead: before.head, expectedTree: before.stagedTree, message: 'Cannot publish a missing selected office' }), target.objectId);
  assert.deepEqual(await f.call('repository.status', {}), before);
  await f.stage([objectPath('fixture:subject')]); const saved = await f.commit('recover-complete-selection');
  assert.equal((await f.call('knowledge.object', { objectId: target.objectId, revision: saved.oid })).object.id, target.objectId);
});
