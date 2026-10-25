import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKnowledgeIndex, type KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { auditSourceReferenceTargets, projectSourceReferenceLinks, publishedRedirectTarget, sourceReferenceHash, SOURCE_REFERENCE_PROPERTY, SOURCE_REFERENCE_TYPE, type SourceReferencePlan, type WikipediaRedirectSnapshot } from './source-reference-links.ts';

// Synthetic identities exercise the generic mapper; no fixture asserts real historical facts.
function fixture() {
  const record = { facts: [{ linkedTitle: 'Listed Name' }] }, wikitext = '#REDIRECT [[Existing Person]]\n{{R from move}}';
  const input: KnowledgeCollection = { schemaVersion: 1, objects: [{ id: 'wikipedia-en:Existing_Person', identities: [], labels: { en: 'Existing person', 'zh-CN': '已有条目' }, descriptions: {}, aliases: [], types: ['fixture:person'] }], assertions: [{ id: 'fixture:claim', subjectId: 'wikipedia-en:Existing_Person', propertyId: 'fixture:listed-person', value: { kind: 'entity', objectId: 'wikipedia-en:Listed_Name' }, qualifiers: [{ propertyId: 'source:context-identity', value: { kind: 'entity', objectId: 'raw:source-group' } }], evidence: [{ sourceId: 'fixture:source', locator: '$.facts[0]', url: 'https://en.wikipedia.org/w/index.php?oldid=5' }], sourceSnapshotId: 'fixture:source', review: 'unreviewed' }], sources: [{ id: 'fixture:source', identity: { provider: 'fixture', externalId: 'source' }, revision: '5', contentHash: sourceReferenceHash(record), record, retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/fixture', adapterVersion: 'fixture', rights: { redistribution: 'allowed', licenseId: 'CC-BY-SA-4.0' } }] };
  const snapshot: WikipediaRedirectSnapshot = { provider: 'wikipedia-en', pageId: '10', title: 'Listed Name', revision: '11', retrievedAt: '2026-10-25T00:00:00Z', wikitext, contentHash: createHash('sha256').update(wikitext).digest('hex'), destination: { pageId: '20', title: 'Existing Person', revision: '21' } };
  const plan: SourceReferencePlan = { schemaVersion: 1, id: 'fixture-reference-repair', revision: '1', preparedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/plan', rights: { redistribution: 'allowed', licenseId: 'CC-BY-SA-4.0' }, sourceLabels: { en: 'Identity references', 'zh-CN': '身份引用' }, decisions: [{ id: 'explicit-source-link', sourceObjectId: 'wikipedia-en:Listed_Name', originalAssertionId: input.assertions[0].id, originalAssertionHash: sourceReferenceHash(input.assertions[0]), source: { id: input.sources[0].id, revision: '5', contentHash: input.sources[0].contentHash }, redirect: { pageId: '10', title: 'Listed Name', revision: '11', contentHash: snapshot.contentHash, destinationPageId: '20', destinationTitle: 'Existing Person', destinationRevision: '21' }, target: { objectId: input.objects[0].id, sha256: sourceReferenceHash(input.objects[0]), type: 'fixture:person' }, labels: { en: 'Listed name', 'zh-CN': '来源列名' }, descriptions: { en: 'Source link to the existing person.', 'zh-CN': '来源指向已有条目。' } }] };
  return { input, snapshots: [snapshot], plan };
}

test('audit distinguishes missing main-value targets, provenance identifiers and incomplete presentation without creating objects', () => {
  const { input } = fixture(), before = structuredClone(input), audit = auditSourceReferenceTargets(input);
  assert.deepEqual(audit.missingValues.map(value => value.objectId), ['wikipedia-en:Listed_Name']);
  assert.deepEqual(audit.missingQualifiers.map(value => value.objectId), ['raw:source-group']);
  assert.deepEqual(audit.incompleteLabels, []); assert.deepEqual(audit.opaqueLabels, []); assert.deepEqual(input, before);
});

test('explicit fixed redirect adds a source reference and untimed person link while preserving all input records', () => {
  const { input, snapshots, plan } = fixture(), before = structuredClone(input), result = projectSourceReferenceLinks(input, snapshots, plan);
  assert.deepEqual(input, before); assert.equal(result.collection.objects.length, 2); assert.equal(result.collection.assertions.length, 2); assert.equal(result.collection.sources.length, 2);
  assert.deepEqual(result.collection.objects[0], input.objects[0]); assert.deepEqual(result.collection.assertions[0], input.assertions[0]); assert.deepEqual(result.collection.sources[0], input.sources[0]);
  const reference = result.collection.objects[1], link = result.collection.assertions[1];
  assert.deepEqual(reference.types, [SOURCE_REFERENCE_TYPE]); assert.equal(reference.labels.en, 'Listed name');
  assert.equal(link.propertyId, SOURCE_REFERENCE_PROPERTY); assert.equal(link.validTime, undefined); assert.equal(link.review, 'unreviewed');
  assert.deepEqual(link.value, { kind: 'entity', objectId: input.objects[0].id });
  assert.equal(link.evidence[0].locator, '$.facts[0]'); assert.match(link.evidence[1].url!, /oldid=11$/);
  const index = createKnowledgeIndex(result.collection), state = index.state({ objectId: reference.id, year: 100, includeUnreviewed: true });
  assert.equal(state.fields[0].status, 'unknown'); assert.deepEqual(state.fields[0].values, []); assert.deepEqual(state.untimedAssertionIds, [link.id]);
  assert.deepEqual(auditSourceReferenceTargets(result.collection).missingValues, []);
  assert.deepEqual(projectSourceReferenceLinks(result.collection, snapshots, plan).collection, result.collection);
});

test('name similarity, ordinary prose, section redirects and multiple instructions do not establish identity', () => {
  assert.equal(publishedRedirectTarget('Listed Name resembles Existing Person.'), null);
  assert.equal(publishedRedirectTarget('#REDIRECT [[Existing Person#Life]]'), null);
  assert.equal(publishedRedirectTarget('#REDIRECT [[Existing Person]]\n#REDIRECT [[Other Person]]'), null);
  for (const wikitext of ['Existing Person', '#REDIRECT [[Similar Person]]', '#REDIRECT [[Existing Person#Life]]']) {
    const { input, snapshots, plan } = fixture(); snapshots[0].wikitext = wikitext; snapshots[0].contentHash = createHash('sha256').update(wikitext).digest('hex'); plan.decisions[0].redirect.contentHash = snapshots[0].contentHash;
    assert.throws(() => projectSourceReferenceLinks(input, snapshots, plan), /SOURCE_REFERENCE_SNAPSHOT_MISMATCH/);
  }
});

test('changed source, claim, target and redirect pins fail without modifying input', () => {
  const changes: ((value: ReturnType<typeof fixture>) => void)[] = [
    value => { value.input.sources[0].revision = '6'; },
    value => { value.input.sources[0].rights.redistribution = 'unknown'; },
    value => { (value.input.sources[0].record as any).facts[0].linkedTitle = 'Other'; },
    value => { value.input.assertions[0].value = { kind: 'entity', objectId: 'wikipedia-en:Similar_Name' }; },
    value => { value.input.assertions[0].review = 'rejected'; },
    value => { value.input.objects[0].labels.en = 'Changed'; },
    value => { value.input.objects = []; },
    value => { value.snapshots[0].revision = '12'; },
    value => { value.snapshots[0].wikitext += '\nChanged'; },
    value => { value.snapshots[0].destination.pageId = '30'; },
    value => { value.snapshots[0].destination.title = 'Similar Person'; },
  ];
  for (const change of changes) { const value = fixture(); change(value); const before = structuredClone(value.input); assert.throws(() => projectSourceReferenceLinks(value.input, value.snapshots, value.plan), /SOURCE_REFERENCE_|INVALID_KNOWLEDGE_REFERENCE/); assert.deepEqual(value.input, before); }
});

test('duplicate decisions, extra snapshots, missing bilingual labels and conflicting existing references are rejected', () => {
  const duplicate = fixture(); duplicate.plan.decisions.push(structuredClone(duplicate.plan.decisions[0])); assert.throws(() => projectSourceReferenceLinks(duplicate.input, duplicate.snapshots, duplicate.plan), /INVALID_SOURCE_REFERENCE_PLAN/);
  const extra = fixture(); extra.snapshots.push(structuredClone(extra.snapshots[0])); assert.throws(() => projectSourceReferenceLinks(extra.input, extra.snapshots, extra.plan), /SOURCE_REFERENCE_SNAPSHOT_MISMATCH/);
  const missing = fixture(); missing.plan.decisions[0].labels['zh-CN'] = ''; assert.throws(() => projectSourceReferenceLinks(missing.input, missing.snapshots, missing.plan), /INVALID_SOURCE_REFERENCE_PLAN/);
  const conflict = fixture(); conflict.input.objects.push({ ...structuredClone(conflict.input.objects[0]), id: 'wikipedia-en:Listed_Name' }); assert.throws(() => projectSourceReferenceLinks(conflict.input, conflict.snapshots, conflict.plan), /SOURCE_REFERENCE_OBJECT_CONFLICT/);
});
