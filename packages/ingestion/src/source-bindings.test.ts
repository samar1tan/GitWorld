import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeObject } from '../../domain/src/knowledge.ts';
import { applySourceBindings, type SourceBindingPlan } from './source-bindings.ts';

const object = (id: string, type: string): KnowledgeObject => ({ id, identities: [{ provider: 'synthetic', externalId: id }], labels: { en: id === 'other-identity' ? 'Ada' : id }, descriptions: {}, aliases: [], types: [type] });
const time = (year: number) => ({ earliestYear: year, latestYear: year, precision: 'year' as const, calendar: 'synthetic' });
function fixture(): KnowledgeCollection {
  const term = (id: string, holder: string, start: number, end: number): KnowledgeAssertion => ({ id, subjectId: 'source-office', propertyId: 'office:holder', value: { kind: 'entity', objectId: holder }, validTime: { start: time(start), end: time(end) }, qualifiers: [{ propertyId: 'source:row', value: { kind: 'text', value: id } }], evidence: [{ sourceId: 'source', locator: `$.rows.${id}` }], sourceSnapshotId: 'source', review: 'adopted' });
  return { schemaVersion: 1, objects: [object('source-office', 'gitworld:office'), object('Ada', 'person'), object('Bea', 'person'), object('other-identity', 'person')], assertions: [term('a1', 'Ada', 100, 110), term('b1', 'Bea', 111, 119), term('a2', 'Ada', 120, 130)], sources: [{ id: 'source', identity: { provider: 'synthetic', externalId: 'office-table' }, revision: '7', contentHash: 'synthetic-hash', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/table', adapterVersion: 'test', rights: { redistribution: 'unknown' } }] };
}
function plan(): SourceBindingPlan {
  return { schemaVersion: 1, id: 'synthetic-binding', revision: '1', preparedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/interpretation', rights: { redistribution: 'unknown' }, objects: [object('polity', 'gitworld:polity')], rules: [{ id: 'rulership', source: { provider: 'synthetic', externalId: 'office-table', revision: '7' }, propertyId: 'office:holder', subjectId: 'source-office', targetSubjectId: 'polity', targetPropertyId: 'polity:ruler', targetType: 'gitworld:polity', direction: 'value', evidence: [{ url: 'https://example.invalid/table#role', locator: 'role paragraph' }] }] };
}

test('declared source bindings retain originals, separate terms and source/interpretation evidence', () => {
  const input = fixture(), original = structuredClone(input), mapped = applySourceBindings(input, plan());
  assert.deepEqual(input, original); assert.equal(mapped.issues.length, 0); assert.equal(mapped.results[0].derivedAssertionIds.length, 3);
  const derived = mapped.collection.assertions.filter(value => value.subjectId === 'polity');
  assert.equal(derived.filter(value => value.value.kind === 'entity' && value.value.objectId === 'Ada').length, 2);
  assert.ok(derived.every(value => value.review === 'unreviewed' && value.evidence.length === 2 && value.qualifiers.some(item => item.propertyId === 'binding:derived-from')));
  const index = createKnowledgeIndex(mapped.collection); assert.equal(index.diff({ objectId: 'polity', year: 105, includeUnreviewed: true }, { objectId: 'polity', year: 115, includeUnreviewed: true }).fields[0].kind, 'changed');
  assert.equal(mapped.collection.objects.filter(value => value.labels.en === 'Ada').length, 2);
  assert.ok(!JSON.stringify(mapped.collection).includes('parentId'));
  const again = applySourceBindings(mapped.collection, plan()); assert.equal(again.collection.assertions.length, mapped.collection.assertions.length); assert.equal(again.collection.sources.length, mapped.collection.sources.length);
});

test('an explicit inverse membership rule projects the source subject without inferring an office from a name', () => {
  const input = fixture(); input.assertions = input.assertions.map(value => ({ ...value, subjectId: (value.value as { kind: 'entity'; objectId: string }).objectId, propertyId: 'held-position', value: { kind: 'entity', objectId: 'source-office' } }));
  const selected = plan(); selected.rules[0] = { ...selected.rules[0], subjectId: undefined, entityValueId: 'source-office', propertyId: 'held-position', direction: 'subject' };
  const result = applySourceBindings(input, selected);
  assert.equal(result.results[0].derivedAssertionIds.length, 3);
  assert.deepEqual(result.collection.assertions.filter(value => value.subjectId === 'polity').map(value => value.value), [{ kind: 'entity', objectId: 'Ada' }, { kind: 'entity', objectId: 'Bea' }, { kind: 'entity', objectId: 'Ada' }]);
});

test('revision mismatch and unknown assertion selections defer the whole rule while preserving source material', () => {
  const input = fixture(), changed = plan(); changed.rules[0].source.revision = '8';
  const mismatch = applySourceBindings(input, changed); assert.ok(mismatch.issues.some(value => value.code === 'SOURCE_REVISION_MISMATCH')); assert.equal(mismatch.collection.assertions.length, input.assertions.length);
  const unknown = plan(); unknown.rules[0].assertionIds = ['a1', 'not-present'];
  const selected = applySourceBindings(input, unknown); assert.ok(selected.issues.some(value => value.code === 'UNKNOWN_ASSERTION_SELECTION')); assert.equal(selected.results[0].derivedAssertionIds.length, 0);
});

test('concurrent court roles use explicit assertion selections and do not extend or split their source intervals', () => {
  const input = fixture(); input.assertions[1].validTime = { start: time(105), end: time(119) };
  const selected = plan(); selected.objects = [object('north', 'gitworld:court'), object('south', 'gitworld:court')];
  selected.rules = ['north', 'south'].map((id, index) => ({ ...selected.rules[0], id, targetSubjectId: id, targetPropertyId: 'court:monarch', targetType: 'gitworld:court', assertionIds: [index === 0 ? 'a1' : 'b1'] }));
  const result = applySourceBindings(input, selected), index = createKnowledgeIndex(result.collection);
  assert.equal(index.state({ objectId: 'north', year: 108, includeUnreviewed: true }).fields[0].status, 'known');
  assert.equal(index.state({ objectId: 'south', year: 108, includeUnreviewed: true }).fields[0].status, 'known');
  assert.deepEqual(result.collection.assertions.find(value => value.subjectId === 'north')!.validTime, input.assertions[0].validTime);
});

test('rejected claims, target type conflicts and changed interpretations never overwrite earlier content', () => {
  const input = fixture(); input.assertions[0].review = 'rejected';
  const result = applySourceBindings(input, plan()); assert.ok(result.issues.some(value => value.code === 'REJECTED_SOURCE_CLAIM')); assert.equal(result.results[0].derivedAssertionIds.length, 2);
  const wrong = plan(); wrong.rules[0].targetType = 'gitworld:court'; assert.ok(applySourceBindings(input, wrong).issues.some(value => value.code === 'TARGET_TYPE_MISMATCH'));
  const changed = plan(); changed.revision = '2'; changed.rules[0].targetPropertyId = 'polity:council';
  const conflict = applySourceBindings(result.collection, changed); assert.ok(conflict.issues.some(value => value.code === 'ASSERTION_CONFLICT')); assert.ok(!conflict.collection.assertions.some(value => value.propertyId === 'polity:council'));
});

test('explicit entity identity decisions preserve provisional values and retain their own evidence', () => {
  const input = fixture(), selected = plan(); selected.objects.push(object('identified-holder', 'person'));
  selected.rules[0].valueIdentities = [{ sourceObjectId: 'Ada', targetObjectId: 'identified-holder', targetType: 'person', evidence: [{ url: 'https://example.invalid/table#personal-name', locator: 'personal-name cell', citation: 'The separate source name cell supplies this exact identity.' }] }];
  const result = applySourceBindings(input, selected);
  assert.equal(result.issues.length, 0); assert.equal(input.assertions[0].value.kind === 'entity' && input.assertions[0].value.objectId, 'Ada');
  assert.equal(result.collection.assertions.filter(value => value.subjectId === 'polity' && value.value.kind === 'entity' && value.value.objectId === 'identified-holder').length, 2);
  assert.ok(result.collection.assertions.find(value => value.subjectId === 'polity')!.evidence.some(value => value.url?.endsWith('#personal-name')));
  selected.rules[0].valueIdentities![0].sourceObjectId = 'not-selected';
  assert.ok(applySourceBindings(input, selected).issues.some(value => value.code === 'UNUSED_VALUE_IDENTITY'));
});

test('generic role bindings defer source-qualified authority while preserving raw claims and ordinary tenures', () => {
  const input = fixture(), selected = plan(); selected.objects = [object('office', 'gitworld:office')];
  selected.rules[0] = { ...selected.rules[0], targetSubjectId: 'office', targetType: 'gitworld:office', targetPropertyId: 'office:holder' };
  input.assertions[0].qualifiers.push({ propertyId: 'source:tenure-text', value: { kind: 'text', value: '100 – de facto 110' } });
  input.assertions[2].validTime!.end!.raw = 'de jure 130';
  const before = structuredClone(input), result = applySourceBindings(input, selected);
  assert.deepEqual(input, before); assert.deepEqual(result.collection.assertions.slice(0, input.assertions.length), before.assertions);
  assert.deepEqual(result.issues.filter(value => value.code === 'AUTHORITY_BASIS_REQUIRED').map(value => value.assertionId), ['a1', 'a2']);
  assert.deepEqual(result.collection.assertions.filter(value => value.subjectId === 'office').map(value => value.value), [{ kind: 'entity', objectId: 'Bea' }]);
  const survey = plan(); survey.objects = [object('survey', 'gitworld:authority-survey')];
  survey.rules[0] = { ...survey.rules[0], targetSubjectId: 'survey', targetType: 'gitworld:authority-survey', targetPropertyId: 'office:holder' };
  assert.equal(applySourceBindings(fixture(), survey).issues.filter(value => value.code === 'AUTHORITY_BASIS_REQUIRED').length, 3);
  selected.rules[0].targetPropertyId = 'office:listed-de-facto-authority';
  assert.equal(applySourceBindings(input, selected).results[0].derivedAssertionIds.length, 3);
});
