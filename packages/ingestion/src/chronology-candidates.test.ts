import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex, type KnowledgeCollection, type KnowledgeObject } from '../../domain/src/knowledge.ts';
import { collectPublishedChronologyRows, collectPublishedSingleChronologyRows, projectChronologyCandidates, type ChronologyCandidatePlan } from './chronology-candidates.ts';

const object = (id: string, type: string): KnowledgeObject => ({ id, identities: [{ provider: 'synthetic', externalId: id }], labels: { en: id }, descriptions: {}, aliases: [], types: [type] });
function fixture(): KnowledgeCollection {
  return { schemaVersion: 1, objects: [object('holder', 'person'), object('source-scope', 'gitworld:office'), object('polity', 'gitworld:polity')], assertions: [{ id: 'term', subjectId: 'holder', propertyId: 'held-position', value: { kind: 'entity', objectId: 'source-scope' }, qualifiers: [{ propertyId: 'columns', value: { kind: 'raw', value: [{ header: 'Chronology A', text: '100–110', column: 1 }, { header: 'Chronology B', text: '105–115', column: 2 }] } }, { propertyId: 'source:table-locator', value: { kind: 'text', value: 'table:0;row:1;name-column:0' } }], evidence: [{ sourceId: 'source', locator: '$.row[1]' }], sourceSnapshotId: 'source', review: 'unreviewed' }], sources: [{ id: 'source', identity: { provider: 'synthetic', externalId: 'table' }, revision: '4', contentHash: 'upstream-hash', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/table', adapterVersion: 'test', rights: { redistribution: 'unknown' } }] };
}
function plan(input = fixture()): ChronologyCandidatePlan {
  const rows = collectPublishedChronologyRows(input, { source: { provider: 'synthetic', externalId: 'table', revision: '4' }, memberPropertyId: 'held-position', qualifierPropertyId: 'columns', scopes: [{ sourceScopeId: 'source-scope', targetSubjectId: 'polity', targetPropertyId: 'polity:ruler', targetType: 'gitworld:polity' }], columns: ['Chronology A', 'Chronology B'].map(header => ({ header, kind: 'calendar-range' as const, calendar: 'source-unspecified' })) });
  return { schemaVersion: 1, id: 'synthetic-chronology', revision: '1', preparedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/chronology', rights: { redistribution: 'unknown' }, rows };
}

test('competing source intervals remain separate candidates and only possible state values', () => {
  const input = fixture(), original = structuredClone(input), selected = plan(input), result = projectChronologyCandidates(input, selected);
  assert.deepEqual(input, original); assert.equal(result.candidates.length, 2); assert.ok(result.candidates.every(value => value.interval?.start && value.interval.end));
  assert.deepEqual(result.candidates.map(value => value.interval!.start!.earliestYear), [100, 105]);
  const index = createKnowledgeIndex(result.collection), state = index.state({ objectId: 'polity', year: 108, includeUnreviewed: true });
  assert.equal(state.fields[0].status, 'uncertain'); assert.equal(state.fields[0].values.length, 0); assert.deepEqual(state.fields[0].possibleValues, [{ kind: 'entity', objectId: 'holder' }]);
  assert.equal(index.state({ objectId: 'polity', year: 300, includeUnreviewed: true }).fields[0].status, 'unknown');
  assert.equal(index.query({ typeIds: ['gitworld:chronology-candidate'], time: [101, 101] }).total, 1);
  assert.ok(result.collection.assertions.some(value => value.propertyId === 'chronology:source-order' && value.value.kind === 'number' && value.value.value === 1));
  assert.equal(index.history({ objectId: 'polity', includeUnreviewed: true }).changes.length, 0);
  const again = projectChronologyCandidates(result.collection, selected); assert.equal(again.collection.assertions.length, result.collection.assertions.length); assert.equal(again.collection.objects.length, result.collection.objects.length);
});

test('one-year candidates remain possible and do not extend into later years', () => {
  const input = fixture(), selected = plan(input); selected.rows = [selected.rows[0]]; selected.rows[0].dateText = '200';
  const result = projectChronologyCandidates(input, selected), index = createKnowledgeIndex(result.collection);
  assert.equal(index.state({ objectId: 'polity', year: 200, includeUnreviewed: true }).fields[0].status, 'uncertain');
  assert.equal(index.state({ objectId: 'polity', year: 201, includeUnreviewed: true }).fields[0].status, 'unknown');
  assert.ok(!index.history({ objectId: 'polity', includeUnreviewed: true }).exceptions.some(value => value.reason === 'open-boundary'));
  assert.ok(result.collection.assertions.filter(value => value.propertyId === 'polity:ruler').every(value => value.validTime?.start && value.validTime.end && value.validTime.certainty === 'possible'));
});

test('speculative lengths and qualified dates remain source material without fabricated reigns', () => {
  const input = fixture(), selected = plan(input); selected.rows[0].column = { ...selected.rows[0].column, header: 'Speculative reign length', kind: 'duration' }; selected.rows[0].dateText = '45'; selected.rows[1].dateText = 'fl. c. 1600'; selected.rows[1].column.bce = true;
  const result = projectChronologyCandidates(input, selected), index = createKnowledgeIndex(result.collection);
  assert.equal(result.candidates.length, 2); assert.ok(result.candidates.every(value => !value.possibleAssertionId));
  assert.ok(result.issues.some(value => value.code === 'DURATION_WITHOUT_CALENDAR')); assert.ok(result.issues.some(value => value.code === 'UNPARSED_CHRONOLOGY'));
  assert.equal(index.query({ time: [45, 45] }).total, 0); assert.equal(index.query({ typeIds: ['gitworld:chronology-candidate'], time: [-1600, -1600] }).total, 1);
  assert.equal(index.state({ objectId: 'polity', year: -1600, includeUnreviewed: true }).fields.length, 0);
  assert.throws(() => projectChronologyCandidates(input, { ...selected, rows: [{ ...selected.rows[0], column: { ...selected.rows[0].column, kind: 'calendar-range' } }] }), /INVALID_CHRONOLOGY_PLAN/);
});

test('multiple possible holders and alternative chronologies are not flattened to a preferred value', () => {
  const input = fixture(); input.objects.push(object('other-holder', 'person')); input.assertions.push({ ...structuredClone(input.assertions[0]), id: 'term-2', subjectId: 'other-holder' });
  const result = projectChronologyCandidates(input, plan(input)), state = createKnowledgeIndex(result.collection).state({ objectId: 'polity', year: 108, includeUnreviewed: true });
  assert.equal(state.fields[0].status, 'uncertain'); assert.equal(state.fields[0].possibleValues.length, 2); assert.equal(state.fields[0].values.length, 0);
});

test('wrong revisions, hashes, scope selections and rejected claims cannot create candidate states', () => {
  for (const issue of ['SOURCE_REVISION_MISMATCH', 'SOURCE_HASH_MISMATCH', 'SOURCE_SCOPE_MISMATCH', 'REJECTED_SOURCE_CLAIM']) {
    const input = fixture(), selected = plan(input); selected.rows = [selected.rows[0]];
    if (issue === 'SOURCE_REVISION_MISMATCH') selected.rows[0].source.revision = '5';
    if (issue === 'SOURCE_HASH_MISMATCH') selected.rows[0].upstreamSnapshotHash = 'other';
    if (issue === 'SOURCE_SCOPE_MISMATCH') selected.rows[0].scope.sourceScopeId = 'other';
    if (issue === 'REJECTED_SOURCE_CLAIM') input.assertions[0].review = 'rejected';
    const result = projectChronologyCandidates(input, selected); assert.ok(result.issues.some(value => value.code === issue)); assert.equal(result.candidates.length, 0);
  }
});

test('a separated factual source can reference its retained upstream hash without archiving raw HTML in the plan', () => {
  const input = fixture(), selected = plan(input); input.sources[0].contentHash = 'facts-hash'; input.sources[0].record = { manifest: { upstreamSnapshotHash: 'upstream-hash' }, facts: [] };
  const result = projectChronologyCandidates(input, selected); assert.equal(result.candidates.length, 2); assert.ok(result.collection.sources.every(value => !JSON.stringify(value.record).includes('<table')));
  const changed = structuredClone(selected); changed.revision = '2'; changed.rows[0].dateText = '120–130';
  const conflict = projectChronologyCandidates(result.collection, changed); assert.ok(conflict.issues.some(value => value.code === 'CANDIDATE_CONFLICT'));
});

test('qualified ranges retain source wording and only possible applicability while unknown endpoints remain partial material', () => {
  const input = fixture(), selected = plan(input); selected.rows[0].dateText = 'late 210 – October 207 BCE'; selected.rows[1].dateText = '?–1189'; selected.rows[1].column.bce = true;
  const result = projectChronologyCandidates(input, selected), index = createKnowledgeIndex(result.collection);
  assert.equal(index.state({ objectId: 'polity', year: -209, includeUnreviewed: true }).fields[0].status, 'uncertain');
  const possible = result.collection.assertions.find(value => value.propertyId === 'polity:ruler')!;
  assert.equal(possible.validTime!.start!.raw, 'late 210 – October 207 BCE'); assert.equal(possible.validTime!.start!.precision, 'broader');
  assert.equal(result.candidates.filter(value => value.possibleAssertionId).length, 1);
  assert.ok(result.collection.assertions.some(value => value.propertyId === 'chronology:reported-end' && value.value.kind === 'time' && value.value.value.earliestYear === -1189));
  input.assertions[0].qualifiers.push({ propertyId: 'source-time', value: { kind: 'text', value: 'late 210 – October 207 BCE' } });
  const options = { source: selected.rows[0].source, memberPropertyId: 'held-position', timeQualifierId: 'source-time', excludeQualifierId: 'columns', scopes: [selected.rows[0].scope], column: selected.rows[0].column };
  assert.equal(collectPublishedSingleChronologyRows(input, options).length, 0);
  assert.equal(collectPublishedSingleChronologyRows(input, { ...options, excludeQualifierId: undefined }).length, 1);
});
