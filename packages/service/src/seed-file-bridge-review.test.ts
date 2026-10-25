import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLocalService } from './index.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeCollection } from '../../domain/src/knowledge.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';
import { knowledgeCollectionFingerprint, type KnowledgeBundleManifest } from './trusted-bundled-knowledge.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)), binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Service = Awaited<ReturnType<typeof createLocalService>>;
let sequence = 0;
async function response<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']) { return service.dispatch({ protocolVersion: 1, requestId: `seed-review-${++sequence}`, method, params } as ServiceRequest); }
async function call<M extends ServiceMethod>(service: Service, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> { const value = await response(service, method, params); assert.ok(value.ok, JSON.stringify(value)); return value.result as ServiceMethods[M]['result']; }
function collection(id: string, year: number, text = id): KnowledgeCollection {
  const sourceId = `source:${id}`, record = { fixture: 'Synthetic source', privateBodyMarker: 'RAW_BODY_MUST_STAY_HOST_SIDE', id };
  return { schemaVersion: 1,
    objects: [{ id: 'fixture:subject', identities: [{ provider: 'fixture', externalId: 'subject' }], labels: { en: 'Synthetic subject', 'zh-CN': '测试对象' }, descriptions: {}, aliases: [], types: ['fixture:polity'] }],
    assertions: [{ id: `claim:${id}`, subjectId: 'fixture:subject', propertyId: 'fixture:field', value: { kind: 'text', value: text }, sourceSnapshotId: sourceId, review: 'unreviewed', qualifiers: [], evidence: [{ sourceId, locator: `row ${id}` }], validTime: { point: { earliestYear: year, latestYear: year, calendar: 'test', precision: 'year' } } }],
    sources: [{ id: sourceId, identity: { provider: 'fixture', externalId: id }, revision: id, contentHash: hash(canonicalJson(record)), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', adapterVersion: 'fixture-v1', rights: { redistribution: 'unknown' }, record }],
  };
}
async function bundle(directory: string, data: KnowledgeCollection) {
  await mkdir(directory, { recursive: true });
  const files: Record<string,string> = {
    'collection.json': JSON.stringify(data),
    'fields.json': JSON.stringify({ schemaVersion: 1, kind: 'historical-field-display-labels', properties: [{ id: 'fixture:field', labels: { en: 'Recorded affiliation', 'zh-CN': '记录的隶属' } }], types: [{ id: 'fixture:polity', labels: { en: 'Polity', 'zh-CN': '政治实体' } }] }),
    'rights.json': JSON.stringify({ schemaVersion: 1, basis: 'Synthetic review fixture; no historical rights claim' }),
  };
  const entry = (name: string) => ({ path: name, bytes: Buffer.byteLength(files[name]), sha256: hash(files[name]) });
  const manifest: KnowledgeBundleManifest = { schemaVersion: 1, kind: 'gitworld-knowledge-bundle', id: 'review-fixture', labels: { en: 'Review fixture', 'zh-CN': '测试资料' }, shards: [entry('collection.json')], fieldCatalog: entry('fields.json'), sourceRights: entry('rights.json'), collectionHash: knowledgeCollectionFingerprint(data), counts: { objects: data.objects.length, assertions: data.assertions.length, sources: data.sources.length }, sourceHashes: data.sources.map(value => ({ id: value.id, contentHash: value.contentHash })) };
  const body = JSON.stringify(manifest); files['manifest.json'] = body;
  for (const [name,text] of Object.entries(files)) await writeFile(path.join(directory, name), text);
  return { manifestPath: path.join(directory, 'manifest.json'), expectedManifestHash: hash(body) };
}
async function setup(t: { after(fn: () => unknown): void }, seeded: boolean) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-seed-bridge-')), files = new Map<string,{ path: string; purpose: string }>(), services: Service[] = [];
  const seed = seeded ? await bundle(path.join(directory, 'bundle'), collection('initial', 100)) : undefined;
  const open = async (seedKnowledgeBundle = seed) => { const service = await createLocalService({ dataDirectory: path.join(directory, 'library'), gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), resolveFileToken: (token,purpose) => files.get(token)?.purpose === purpose ? files.get(token)!.path : undefined, ...(seedKnowledgeBundle ? { seedKnowledgeBundle } : {}) }); services.push(service); return service; };
  t.after(async () => { for (const service of services) await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, files, open, service: await open() };
}
async function selected(fixture: Awaited<ReturnType<typeof setup>>, data: KnowledgeCollection, id: string) {
  const file = path.join(fixture.directory, `${id}.json`); await writeFile(file, JSON.stringify(data)); fixture.files.set(id, { path: file, purpose: 'import' });
  return { file, preview: await call(fixture.service, 'knowledge.filePreview', { fileToken: id }) };
}
async function adopt(fixture: Awaited<ReturnType<typeof setup>>, fileToken: string, expectedInputHash: string, operationId: string) {
  const status = await call(fixture.service, 'repository.status', {});
  return call(fixture.service, 'knowledge.fileAdopt', { fileToken, expectedHead: status.head, expectedInputHash, review: 'unreviewed', operationId });
}

test('trusted seed initializes one real Git tree; restart and restore cannot replace existing working content', native, async t => {
  const fixture = await setup(t, true), initial = await call(fixture.service, 'repository.status', {});
  assert.equal(initial.staged.length, 0); assert.equal(initial.unstaged.length, 0);
  const detail = await call(fixture.service, 'knowledge.object', { objectId: 'fixture:subject', revision: initial.head });
  assert.equal(detail.assertions[0].review, 'unreviewed'); assert.equal(detail.display!.properties['fixture:field']['zh-CN'], '记录的隶属');
  assert.ok(detail.sources.every(value => !Object.hasOwn(value, 'record'))); assert.ok(!JSON.stringify(detail).includes('RAW_BODY_MUST_STAY_HOST_SIDE'));
  const later = await selected(fixture, collection('later', 200), 'later'); await adopt(fixture, 'later', later.preview.preview.inputHash, 'append-later');
  const backup = path.join(fixture.directory, 'working.gitworld'); fixture.files.set('backup', { path: backup, purpose: 'backup' }); fixture.files.set('restore', { path: backup, purpose: 'restore' });
  await call(fixture.service, 'backup.create', { fileToken: 'backup', operationId: 'backup-before-restart' });
  await fixture.service.close();
  const replacement = await bundle(path.join(fixture.directory, 'new-bundle'), collection('replacement', 100, 'Must not overwrite'));
  fixture.service = await fixture.open(replacement);
  const reopened = await call(fixture.service, 'knowledge.object', { objectId: 'fixture:subject' }); assert.deepEqual(reopened.assertions.map(value => value.id).sort(), ['claim:initial','claim:later']);
  assert.equal((await call(fixture.service, 'repository.status', {})).head, initial.head);
  const third = await selected(fixture, collection('third', 300), 'third'); await adopt(fixture, 'third', third.preview.preview.inputHash, 'append-third');
  await call(fixture.service, 'backup.restore', { fileToken: 'restore', operationId: 'restore-existing-working' });
  const restored = await call(fixture.service, 'knowledge.object', { objectId: 'fixture:subject' }); assert.deepEqual(restored.assertions.map(value => value.id).sort(), ['claim:initial','claim:later']);
  assert.equal((await call(fixture.service, 'repository.status', {})).head, initial.head);
  const state = await call(fixture.service, 'knowledge.state', { state: { objectId: 'fixture:subject', year: 100, includeUnreviewed: true } }); assert.deepEqual(state.fields[0].values, [{ kind: 'text', value: 'initial' }]);
});

test('selected-file preview is bound to claims; retries are idempotent and separate immutable batches retain earlier assertions', native, async t => {
  const fixture = await setup(t, false), initial = await call(fixture.service, 'repository.status', {});
  const input = collection('earlier', 100), first = await selected(fixture, input, 'first');
  input.assertions[0].value = { kind: 'text', value: 'Changed after preview' }; await writeFile(first.file, JSON.stringify(input));
  const request = { fileToken: 'first', expectedHead: initial.head, expectedInputHash: first.preview.preview.inputHash, review: 'unreviewed' as const, operationId: 'first-adoption' };
  const refused = await response(fixture.service, 'knowledge.fileAdopt', request); assert.ok(!refused.ok && refused.error.code === 'CONFLICT'); assert.deepEqual((await call(fixture.service, 'repository.status', {})).unstaged, []);
  await writeFile(first.file, JSON.stringify(collection('earlier', 100)));
  const adopted = await call(fixture.service, 'knowledge.fileAdopt', request), after = await call(fixture.service, 'repository.status', {}); assert.deepEqual(adopted.changedObjects, ['fixture:subject']);
  await writeFile(first.file, JSON.stringify(collection('unrelated-new-input', 400)));
  assert.deepEqual(await call(fixture.service, 'knowledge.fileAdopt', request), adopted); assert.deepEqual(await call(fixture.service, 'repository.status', {}), after);
  const second = await selected(fixture, collection('later', 200), 'second'); await adopt(fixture, 'second', second.preview.preview.inputHash, 'second-adoption');
  const detail = await call(fixture.service, 'knowledge.object', { objectId: 'fixture:subject' }); assert.deepEqual(detail.assertions.map(value => value.id).sort(), ['claim:earlier','claim:later']);
  for (const year of [100,200]) assert.equal((await call(fixture.service, 'knowledge.state', { state: { objectId: 'fixture:subject', year, includeUnreviewed: true } })).fields[0].status, 'known');
  const replay = await adopt(fixture, 'second', second.preview.preview.inputHash, 'second-new-operation'); assert.deepEqual(replay.changedObjects, []); assert.deepEqual(replay.unchangedObjects, ['fixture:subject']);
  const forbidden = await response(fixture.service, 'knowledge.filePreview', { fileToken: 'backup' }); assert.ok(!forbidden.ok && forbidden.error.code === 'INVALID_REQUEST');
});
