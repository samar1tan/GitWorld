import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import { mapSourceSnapshot, mapWikidataTime, combineKnowledgeCollections } from './knowledge-mapping.ts';
import type { SourceRecordSnapshot } from './source-types.ts';

const snapshot = (raw: any, provider = 'wikidata'): SourceRecordSnapshot => ({ identity: { provider, externalId: String(raw.id) }, sourceRevision: '17', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/record', contentHash: 'a'.repeat(64), mediaType: 'application/json', raw, adapterVersion: 'synthetic-test', rights: { redistribution: 'unknown' } });
const date = (year: number, precision = 9) => ({ snaktype: 'value', property: 'P580', datavalue: { type: 'time', value: { time: `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(4, '0')}-00-00T00:00:00Z`, precision, calendarmodel: 'http://www.wikidata.org/entity/Q1985786', before: 0, after: 0 } } });
const statement = (id = 'Q7001$statement') => ({ id, rank: 'preferred', mainsnak: { property: 'P17', snaktype: 'value', datavalue: { type: 'wikibase-entityid', value: { id: 'Q7002' } } }, qualifiers: { P580: [date(100)], P582: [{ ...date(200), property: 'P582' }] }, references: [{ hash: 'ref', snaks: { P854: [{ snaktype: 'value', property: 'P854', datavalue: { type: 'string', value: 'https://example.invalid/evidence' } }] } }] });

test('Wikidata mapping retains stable assertion identity, full source bytes and review boundaries', () => {
  const raw = { id: 'Q7001', labels: { en: { value: 'Synthetic entity' } }, descriptions: {}, aliases: {}, claims: { P17: [statement()] } };
  const mapped = mapSourceSnapshot(snapshot(raw));
  assert.equal(mapped.collection.objects[0].id, 'wikidata:Q7001');
  const assertion = mapped.collection.assertions[0]; assert.equal(assertion.id, 'wikidata:Q7001$statement'); assert.equal(assertion.review, 'unreviewed'); assert.equal(assertion.rank, 'preferred');
  assert.deepEqual(mapped.collection.sources[0].record, raw); assert.equal(assertion.qualifiers.length, 2); assert.equal(assertion.evidence[1].url, 'https://example.invalid/evidence');
  const index = createKnowledgeIndex(mapped.collection);
  assert.equal(index.state({ objectId: 'wikidata:Q7001', year: 150 }).fields[0].status, 'unknown');
  assert.equal(index.state({ objectId: 'wikidata:Q7001', year: 150, includeUnreviewed: true }).fields[0].status, 'known');
});

test('JSON BCE, coarse precision and source calendars survive while unsupported dates remain raw', () => {
  assert.equal(mapWikidataTime(date(-458).datavalue.value)!.earliestYear, -458);
  assert.deepEqual([mapWikidataTime(date(-458, 7).datavalue.value)!.earliestYear, mapWikidataTime(date(-458, 7).datavalue.value)!.latestYear], [-500, -401]);
  assert.equal(mapWikidataTime({ ...date(100).datavalue.value, time: '+0000-00-00T00:00:00Z' }), null);
  assert.equal(mapWikidataTime({ ...date(100).datavalue.value, calendarmodel: 'https://example.invalid/other-calendar' }), null);
  const raw = { id: 'Q7001', claims: { P17: [{ ...statement(), qualifiers: { P580: [date(100), date(150)] } }] } };
  const result = mapSourceSnapshot(snapshot(raw)); assert.ok(result.issues.some(issue => issue.code === 'UNMAPPED_TIME')); assert.equal(result.collection.assertions[0].validTime, undefined);
});

test('unknown and no-value snaks remain distinct assertions, never filled from a model', () => {
  const raw = { id: 'Q7001', claims: { P17: [{ ...statement('unknown'), mainsnak: { property: 'P17', snaktype: 'somevalue' } }, { ...statement('absent'), mainsnak: { property: 'P17', snaktype: 'novalue' } }] } };
  const result = mapSourceSnapshot(snapshot(raw)); assert.deepEqual(result.collection.assertions.map(value => value.value.kind), ['unknown', 'absent']);
});

test('Pleiades maps dated connections and geometry but does not turn place coverage into ancestry', () => {
  const raw = { id: '7001', title: 'Synthetic ancient place', description: 'A transport fixture', placeTypes: ['settlement'], start: -800, end: 300, reprPoint: [25, 35], names: [{ title: 'Alternate name', language: 'en' }], connections: [{ id: '7002', connectsTo: 'https://pleiades.stoa.org/places/7002', connectionType: 'capital', start: -500, end: -300, attestations: [{ timePeriod: 'synthetic' }], references: [{ shortTitle: 'Synthetic reference', citationDetail: 'section 1', accessURI: 'https://example.invalid/evidence' }] }] };
  const result = mapSourceSnapshot(snapshot(raw, 'pleiades'), { review: 'adopted' }), index = createKnowledgeIndex(result.collection);
  assert.equal(result.collection.objects.length, 1); assert.equal(index.query({ bounds: { west: 20, east: 30, south: 30, north: 40 } }).total, 1);
  assert.equal(index.state({ objectId: 'pleiades:7001', year: -400 }).fields.find(value => value.propertyId === 'pleiades-connection:capital')!.status, 'known');
  assert.equal(index.state({ objectId: 'pleiades:7001', year: -700 }).fields.find(value => value.propertyId === 'pleiades-connection:capital')!.status, 'unknown');
  assert.ok(index.history({ objectId: 'pleiades:7001' }).exceptions.some(value => value.reason === 'undated'));
  assert.ok(!('branches' in result.collection));
});

test('unchanged repeated input creates no duplicate objects/assertions; changed claims are surfaced', () => {
  const raw = { id: 'Q7001', claims: { P17: [statement()] } }, first = mapSourceSnapshot(snapshot(raw)).collection;
  const same = snapshot(raw); same.retrievedAt = '2026-10-26T00:00:00Z';
  const combined = combineKnowledgeCollections([first, mapSourceSnapshot(same).collection]);
  assert.equal(combined.collection.objects.length, 1); assert.equal(combined.collection.assertions.length, 1); assert.deepEqual(combined.conflicts, []);
  const reordered = { claims: raw.claims, id: raw.id };
  assert.deepEqual(combineKnowledgeCollections([first, mapSourceSnapshot(snapshot(reordered)).collection]).conflicts, []);
  const changed = structuredClone(raw); changed.claims.P17[0].mainsnak.datavalue.value.id = 'Q7003';
  const conflict = combineKnowledgeCollections([first, mapSourceSnapshot(snapshot(changed)).collection]);
  assert.ok(conflict.conflicts.some(value => value.kind === 'assertion')); assert.equal((conflict.collection.assertions[0].value as any).objectId, 'wikidata:Q7002');
});

test('Pleiades attested and romanized names retain their language, source type and time scope', () => {
  const raw = { id: '7001', title: 'Synthetic place', placeTypes: ['settlement'], names: [
    { id: 'first-name', attested: 'First form', romanized: 'First form', language: 'la', nameType: 'ancient', start: -500, end: -100 },
    { id: 'second-name', attested: 'Second form', language: 'la', nameType: 'associated_modern', start: 100, end: 300 },
  ] };
  const result = mapSourceSnapshot(snapshot(raw, 'pleiades'), { review: 'adopted' }), index = createKnowledgeIndex(result.collection);
  const names = result.collection.assertions.filter(value => value.propertyId === 'pleiades:attested-name:la');
  assert.equal(names.length, 2); assert.deepEqual(names[0].value, { kind: 'text', value: 'First form', language: 'la' });
  assert.ok(names[1].qualifiers.some(value => value.propertyId === 'pleiades:nameType' && (value.value as any).value === 'associated_modern'));
  const history = index.history({ objectId: 'pleiades:7001' }); assert.equal(history.changes.length, 1); assert.deepEqual(history.changes[0].observedBetween, [-100, 100]);
  assert.equal(index.state({ objectId: 'pleiades:7001', year: -300 }).fields[0].values[0].kind, 'text');
});
