import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { mapCliopatriaDocument } from '../../ingestion/src/cliopatria.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeCollection, KnowledgeObject, KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { KnowledgeObjectBundle } from '../../contracts/src/knowledge-workspace-types.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import { createKnowledgeStore, knowledgeCollectionSeedFiles } from './knowledge-store.ts';

const binary = path.resolve('.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Prepare bundled Git runtime' };
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const objectPath = (id: string) => 'objects/' + hash(id) + '.json';
const baselinePath = (id: string) => 'mappings/baseline-' + hash(id) + '.json';
const person: KnowledgeObject = {
  id: 'wikipedia-en:Synthetic_shared_person',
  identities: [{ provider: 'declared-office-tenure-row', externalId: 'wikipedia-en:Synthetic_shared_person' }],
  labels: { en: 'Synthetic shared person', ja: '既存の人物名', 'zh-CN': '既有译名' },
  descriptions: { en: 'Existing source description', 'zh-CN': '既有来源说明' },
  aliases: [{ en: 'Prior source spelling', 'zh-CN': '既有别名' }],
  types: ['gitworld:office-holder'],
};
const source = (suffix: string): KnowledgeSource => ({
  id: 'fixture-source:' + suffix, identity: { provider: 'fixture', externalId: suffix },
  revision: suffix, contentHash: hash(suffix), retrievedAt: '2026-10-26T00:00:00Z',
  url: 'https://example.invalid/source/' + suffix, adapterVersion: 'fixture',
  rights: { redistribution: 'unknown' },
});
const collection = (object: KnowledgeObject, suffix: string): KnowledgeCollection => ({
  schemaVersion: 1, objects: [structuredClone(object)], sources: [source(suffix)],
  assertions: [{ id: 'fixture-claim:' + suffix, subjectId: object.id, propertyId: 'fixture:recorded-note',
    value: { kind: 'text', value: suffix }, qualifiers: [],
    evidence: [{ sourceId: source(suffix).id, locator: 'row 1' }], sourceSnapshotId: source(suffix).id,
    review: 'unreviewed', validTime: { point: { earliestYear: 1900, latestYear: 1900, precision: 'year', calendar: 'source-unspecified' } } }],
});
function partialPerson(): KnowledgeObject {
  return { ...structuredClone(person), labels: { en: person.labels.en }, descriptions: {}, aliases: [],
    types: ['gitworld:source-listed-holder'] };
}
async function fixture(t: { after(fn: () => unknown): void }, seed: KnowledgeCollection) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-append-metadata-'));
  const repo = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary,
    gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  const initial = await repo.initialize(knowledgeCollectionSeedFiles(seed));
  t.after(async () => { await repo.close(); await rm(directory, { recursive: true, force: true }); });
  const store = createKnowledgeStore(repo);
  const adopt = async (input: KnowledgeCollection) => store.adopt({ collection: input,
    mode: 'append-observations', review: 'unreviewed', expectedHead: (await repo.status()).head,
    expectedInputHash: store.previewCollection(input).preview.inputHash });
  return { repo, store, adopt, initial };
}

test('a partial English source preserves a shared seeded person metadata, old claims and immutable source identity', native, async t => {
  const before = collection(person, 'first'), next = collection(partialPerson(), 'second');
  const f = await fixture(t, before), result = await f.adopt(next);
  assert.deepEqual(result.conflicts, []);
  const saved = await f.store.objectDetail(person.id);
  assert.deepEqual(saved.object.labels, person.labels);
  assert.deepEqual(saved.object.descriptions, person.descriptions);
  assert.deepEqual(saved.object.aliases, person.aliases);
  assert.deepEqual(saved.object.identities, person.identities);
  assert.deepEqual([...saved.object.types].sort(), ['gitworld:office-holder', 'gitworld:source-listed-holder']);
  assert.deepEqual(saved.assertions.map(value => value.id).sort(), [...before.assertions, ...next.assertions].map(value => value.id).sort());
  for (const item of [...before.sources, ...next.sources]) assert.deepEqual(await f.repo.read('sources/' + hash(item.id) + '.json'), item);
  const upstream = await f.repo.read(baselinePath(person.id)) as unknown as KnowledgeObjectBundle;
  assert.deepEqual(upstream.object, (await f.repo.read(objectPath(person.id)) as unknown as KnowledgeObjectBundle).object);
  const replay = await f.adopt(next);
  assert.deepEqual(replay.changedObjects, []);
  assert.deepEqual(replay.unchangedObjects, [person.id]);
  assert.deepEqual((await f.repo.read(objectPath(person.id), { from: f.initial.head }) as unknown as KnowledgeObjectBundle).object, person);
});

test('a different nonempty name or incompatible same-provider identity remains an explicit object conflict even without a local edit', native, async t => {
  for (const variant of ['name', 'identity'] as const) {
    await t.test(variant, async sub => {
      const f = await fixture(sub, collection(person, 'first')), changed = partialPerson();
      if (variant === 'name') changed.labels.en = 'A different primary name';
      else changed.identities[0].externalId = 'wikipedia-en:Unrelated_person';
      const result = await f.adopt(collection(changed, 'second'));
      assert.equal(result.conflicts.length, 1);
      assert.deepEqual((await f.repo.read(objectPath(person.id)) as unknown as KnowledgeObjectBundle).object, person);
      assert.deepEqual(result.conflicts[0].base?.object.labels, person.labels);
      assert.equal(result.conflicts[0].incoming.object.labels['zh-CN'], person.labels['zh-CN']);
    });
  }
});

test('a partial source never launders local metadata into the incoming upstream baseline', native, async t => {
  const f = await fixture(t, collection(person, 'first'));
  const local = await f.repo.read(objectPath(person.id)) as unknown as KnowledgeObjectBundle;
  local.object.labels['zh-CN'] = '本地尚未合并的更名';
  await f.repo.write([{ path: objectPath(person.id), value: local as unknown as EditorialJson }]);
  const result = await f.adopt(collection(partialPerson(), 'second'));
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].incoming.object.labels['zh-CN'], person.labels['zh-CN']);
  assert.deepEqual(await f.repo.read(objectPath(person.id)), local);
  assert.deepEqual((await f.repo.read(baselinePath(person.id)) as unknown as KnowledgeObjectBundle).object, person);
});

test('separate Cliopatria batches retain compatible prior locale, aliases, types and both observation frames', native, async t => {
  const feature = (start: number) => ({ type: 'Feature', properties: {
    Name: 'Synthetic polity', Type: 'POLITY', Wikipedia: 'Synthetic_polity', FromYear: start, ToYear: start + 10, Area: 100,
  }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } });
  const doc = { type: 'FeatureCollection', features: [feature(100), feature(200)] };
  const pin = { url: 'https://example.invalid/collection', revision: 'fixture', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-26T00:00:00Z' };
  const first = mapCliopatriaDocument(doc, pin, { startRecord: 0, limit: 1 }).collection;
  const second = mapCliopatriaDocument(doc, pin, { startRecord: 1, limit: 1 }).collection;
  first.objects[0].labels['zh-CN'] = '先前来源译名';
  first.objects[0].aliases.push({ en: 'Earlier spelling' });
  first.objects[0].types.push('fixture:additional-type');
  const f = await fixture(t, first);
  await f.adopt(second);
  const saved = await f.store.objectDetail(first.objects[0].id);
  assert.deepEqual(saved.object.labels, first.objects[0].labels);
  assert.deepEqual(saved.object.aliases, first.objects[0].aliases);
  assert.deepEqual(new Set(saved.object.types), new Set(first.objects[0].types));
  assert.equal(saved.assertions.length, first.assertions.length + second.assertions.length);
});

test('a pre-change collection preview cannot authorize adoption under the new merge semantics', native, async t => {
  const f=await fixture(t,collection(person,'first')),input=collection(partialPerson(),'second');
  const legacyHash=hash({objects:input.objects,assertions:input.assertions.map(value=>({...value,review:'unreviewed'})),sources:input.sources.map(value=>({...value,retrievedAt:''}))});
  assert.notEqual(f.store.previewCollection(input).preview.inputHash,legacyHash);
  const before=await f.repo.snapshot();
  await assert.rejects(f.store.adopt({collection:input,mode:'append-observations',review:'unreviewed',expectedHead:before.head,expectedInputHash:legacyHash}),/CONFLICT/);
  assert.deepEqual(await f.repo.snapshot(),before);
});

test('metadata conflict evidence is guarded against a concurrent same-HEAD object edit', native, async t => {
  const f=await fixture(t,collection(person,'first')),incoming=partialPerson();incoming.labels.en='Another primary name';
  const local=await f.repo.read(objectPath(person.id)) as unknown as KnowledgeObjectBundle;
  local.object.descriptions.en='A newer working edit';
  const guarded=createKnowledgeStore({...f.repo,async write(changes,guards){await f.repo.write([{path:objectPath(person.id),value:local as unknown as EditorialJson}]);return f.repo.write(changes,guards);}});
  const input=collection(incoming,'second');
  await assert.rejects(guarded.adopt({collection:input,mode:'append-observations',review:'unreviewed',expectedHead:f.initial.head,expectedInputHash:guarded.previewCollection(input).preview.inputHash}),/CONTENT_CHANGED/);
  assert.deepEqual(await f.repo.read(objectPath(person.id)),local);assert.deepEqual(await f.store.conflicts(),[]);
  assert.equal(await f.repo.read('sources/'+hash(source('second').id)+'.json'),null);
});
