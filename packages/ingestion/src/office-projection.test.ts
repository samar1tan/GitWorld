import test from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeTemporalScope } from '../../domain/src/knowledge.ts';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import { mapOfficeTenureRows, officeScopeId, projectOfficeTenures } from './office-projection.ts';

const interval = (start: number, end?: number): KnowledgeTemporalScope => ({ start: { earliestYear: start, latestYear: start, precision: 'year', calendar: 'source-calendar' }, ...(end ? { end: { earliestYear: end, latestYear: end, precision: 'year', calendar: 'source-calendar' } } : {}) });
const assertion = (id: string, person: string, office: string, validTime?: KnowledgeTemporalScope): KnowledgeAssertion => ({
  id, subjectId: person, propertyId: 'wikidata:P39', value: { kind: 'entity', objectId: office },
  sourceSnapshotId: 'source@one', review: 'adopted', rank: 'preferred', ...(validTime ? { validTime } : {}),
  evidence: [{ sourceId: 'source@one', locator: `$.claims.P39.${id}` }, { sourceId: 'source@one', locator: `$.claims.P39.${id}.references[0]`, url: 'https://example.invalid/reference' }],
  qualifiers: [{ propertyId: 'wikidata:P1001', value: { kind: 'entity', objectId: 'jurisdiction' } }],
});
const collection = (assertions: KnowledgeAssertion[]): KnowledgeCollection => ({
  schemaVersion: 1,
  objects: ['personA', 'personB', 'office', 'otherOffice', 'jurisdiction', 'list'].map(id => ({ id, identities: [{ provider: 'synthetic', externalId: id }], labels: { en: `Synthetic ${id}` }, descriptions: {}, aliases: [], types: [] })),
  assertions,
  sources: [{ id: 'source@one', identity: { provider: 'synthetic', externalId: 'one' }, revision: 'fixture-revision', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', adapterVersion: 'fixture-v1', rights: { redistribution: 'unknown' }, record: { original: 'retained fixture' } }],
});

test('inverse position claims preserve separate terms, qualifiers, GUIDs, source revision and references', () => {
  const first = assertion('personA$term1', 'personA', 'office', interval(100, 110));
  const second = assertion('personA$term2', 'personA', 'office', interval(120, 130));
  second.qualifiers.push({ propertyId: 'wikidata:P1365', value: { kind: 'entity', objectId: 'personB' } });
  const input = collection([first, second]), frozen = structuredClone(input), result = projectOfficeTenures(input);
  assert.deepEqual(input, frozen); assert.equal(result.tenures.length, 2); assert.equal(new Set(result.tenures.map(value => value.assertionId)).size, 2);
  assert.ok(result.tenures.every(value => value.subjectId === officeScopeId('office', 'jurisdiction')));
  for (const term of result.tenures) {
    const original = input.assertions.find(value => value.id === term.derivedFrom)!, derived = result.collection.assertions.find(value => value.id === term.assertionId)!;
    assert.deepEqual(derived.evidence, original.evidence); assert.deepEqual(derived.validTime, original.validTime);
    assert.deepEqual(derived.qualifiers.slice(0, original.qualifiers.length), original.qualifiers); assert.equal(derived.review, 'unreviewed');
    assert.equal(derived.sourceSnapshotId, original.sourceSnapshotId); assert.equal(derived.rank, 'preferred');
    assert.ok(derived.qualifiers.some(value => value.propertyId === 'projection:derived-from' && value.value.kind === 'text' && value.value.value === original.id));
  }
  assert.deepEqual(result.collection.sources, input.sources);
});

test('office-holder states and differences use the normal index while jurisdictions and offices remain distinct', () => {
  const result = projectOfficeTenures(collection([
    assertion('A', 'personA', 'office', interval(100, 110)), assertion('B', 'personB', 'office', interval(111, 120)), assertion('C', 'personB', 'otherOffice', interval(100, 120)),
  ]));
  const index = createKnowledgeIndex(result.collection), subjectId = result.tenures[0].subjectId;
  assert.notEqual(subjectId, result.tenures[2].subjectId);
  assert.equal(index.state({ objectId: subjectId, year: 105 }).fields[0].status, 'unknown');
  const diff = index.diff({ objectId: subjectId, year: 105, includeUnreviewed: true }, { objectId: subjectId, year: 115, includeUnreviewed: true });
  assert.equal(diff.fields[0].kind, 'changed'); assert.deepEqual(diff.fields[0].before.values, [{ kind: 'entity', objectId: 'personA' }]);
  assert.deepEqual(diff.fields[0].after.values, [{ kind: 'entity', objectId: 'personB' }]);
  assert.equal(index.history({ objectId: subjectId, includeUnreviewed: true }).changes.length, 1);
});

test('list interpretation is explicit and source-backed; early traditional material stays in a review queue', () => {
  const member = assertion('list$member', 'list', 'personA', interval(-600, -500)); member.propertyId = 'wikidata:P527';
  const input = collection([member]); assert.equal(projectOfficeTenures(input).tenures.length, 0);
  const result = projectOfficeTenures(input, {
    listRules: [{ id: 'synthetic-list-members-v1', listId: 'list', memberPropertyId: 'wikidata:P527', officeId: 'office', evidenceUrl: 'https://example.invalid/list-definition' }],
    policy: { version: 'synthetic-review-v1', flags: [{ id: 'traditional-bounds', code: 'TRADITIONAL_CHRONOLOGY', ruleId: 'synthetic-list-members-v1', beforeYear: 500, evidenceUrl: 'https://example.invalid/chronology-policy' }] },
  });
  assert.equal(result.tenures.length, 1); assert.ok(result.exceptions.some(value => value.code === 'POLICY_REVIEW_REQUIRED'));
  const derived = result.collection.assertions.find(value => value.id === result.tenures[0].assertionId)!;
  assert.equal(derived.review, 'unreviewed'); assert.ok(derived.qualifiers.some(value => value.propertyId === 'projection:review-flag'));
  assert.throws(() => projectOfficeTenures(input, { listRules: [{ id: 'no-source', listId: 'list', memberPropertyId: 'wikidata:P527', officeId: 'office', evidenceUrl: '' }] }), /INVALID_OFFICE_RULE/);
});

test('missing dates and ambiguous jurisdictions are exceptions; open dates do not imply an unlimited tenure', () => {
  const ambiguous = assertion('ambiguous', 'personA', 'office', interval(100, 120));
  ambiguous.qualifiers.push({ propertyId: 'wikidata:P1001', value: { kind: 'entity', objectId: 'anotherJurisdiction' } });
  const result = projectOfficeTenures(collection([assertion('undated', 'personA', 'office'), ambiguous, assertion('open', 'personA', 'office', interval(100))]));
  assert.equal(result.tenures.length, 1); assert.ok(result.exceptions.some(value => value.code === 'MISSING_TIME')); assert.ok(result.exceptions.some(value => value.code === 'AMBIGUOUS_JURISDICTION'));
  assert.ok(result.exceptions.some(value => value.code === 'OPEN_TIME'));
  const index = createKnowledgeIndex(result.collection), subjectId = result.tenures[0].subjectId;
  assert.equal(index.state({ objectId: subjectId, year: 100, includeUnreviewed: true }).fields[0].status, 'uncertain');
  assert.equal(index.state({ objectId: subjectId, year: 2026, includeUnreviewed: true }).fields[0].status, 'unknown');
});

test('year-level projection retains multiple within-year terms without declaring a winning holder', () => {
  const early = assertion('early', 'personA', 'office', interval(100, 100)), late = assertion('late', 'personB', 'office', interval(100, 100));
  early.validTime!.start!.precision = 'day'; early.validTime!.start!.month = 1; early.validTime!.start!.day = 1;
  late.validTime!.start!.precision = 'day'; late.validTime!.start!.month = 6; late.validTime!.start!.day = 1;
  const result = projectOfficeTenures(collection([early, late]));
  assert.equal(result.exceptions.filter(value => value.code === 'SUBYEAR_PRECISION').length, 2);
  assert.equal(createKnowledgeIndex(result.collection).state({ objectId: result.tenures[0].subjectId, year: 100, includeUnreviewed: true }).fields[0].status, 'multiple');
});

test('rejected source claims stay rejected and repeated projection does not multiply assertions', () => {
  const rejected = assertion('rejected', 'personB', 'office', interval(100, 110)); rejected.review = 'rejected';
  const result = projectOfficeTenures(collection([assertion('one', 'personA', 'office', interval(100, 110)), rejected]));
  assert.equal(result.tenures.length, 1);
  const repeated = projectOfficeTenures(result.collection);
  assert.equal(repeated.tenures.length, 0); assert.deepEqual(repeated.collection, result.collection);
});

test('ordinary structured table DTOs retain their own source identity and repeated named terms', () => {
  const result = mapOfficeTenureRows([
    { id: 'first-term', holder: { id: 'table:person:one', labels: { en: 'Synthetic first source name' } }, office: { id: 'table:office:one', labels: { en: 'Synthetic office' } }, validTime: interval(100, 110), locator: '$.rows[0]', reviewFlags: ['SOURCE_CALENDAR_UNSPECIFIED'] },
    { id: 'second-term', holder: { id: 'table:person:one', labels: { en: 'Synthetic second source name' } }, office: { id: 'table:office:one', labels: { en: 'Synthetic office' } }, validTime: interval(120, 130), locator: '$.rows[1]' },
  ], collection([]).sources[0], { id: 'synthetic-table-meaning-v1', evidenceUrl: 'https://example.invalid/structured-table-definition' });
  assert.equal(result.tenures.length, 2); assert.equal(result.collection.objects.find(value => value.id === 'table:person:one')!.aliases[0].en, 'Synthetic second source name');
  assert.ok(result.exceptions.some(value => value.code === 'SOURCE_QUALIFICATION'));
  assert.equal(result.exceptions.some(value => value.code === 'UNREFERENCED'), false);
  assert.ok(result.collection.assertions.every(value => !value.id.startsWith('wikidata:')));
  assert.equal(result.collection.assertions.filter(value => value.propertyId === 'office:holder').length, 2);
  createKnowledgeIndex(result.collection);
});

test('a Wikidata claim lacking external references remains an explicit review exception', () => {
  const input = collection([assertion('no-external-reference', 'personA', 'office', interval(100, 110))]);
  input.sources[0].identity.provider = 'wikidata'; input.assertions[0].evidence = input.assertions[0].evidence.slice(0, 1);
  assert.ok(projectOfficeTenures(input).exceptions.some(value => value.code === 'UNREFERENCED'));
});

test('direct Wikidata position-holder claims use the same normal office state path', () => {
  const direct = assertion('office$term', 'office', 'personA', interval(100, 110)); direct.propertyId = 'wikidata:P1308';
  const result = projectOfficeTenures(collection([direct]));
  assert.equal(result.tenures.length, 1); assert.equal(result.tenures[0].officeId, 'office'); assert.equal(result.tenures[0].holderId, 'personA');
  assert.equal(result.tenures[0].derivedFrom, 'office$term');
  const field = createKnowledgeIndex(result.collection).state({ objectId: result.tenures[0].subjectId, year: 105, includeUnreviewed: true }).fields[0];
  assert.deepEqual(field.values, [{ kind: 'entity', objectId: 'personA' }]);
});
