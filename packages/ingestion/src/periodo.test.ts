import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import { mapPeriodODocument, mapPeriodOYear, PERIODO_DATASET } from './periodo.ts';

const source = { url: PERIODO_DATASET, revision: 'synthetic-fixture-only', retrievedAt: '2026-10-25T00:00:00Z', contentHash: 'b'.repeat(64) };
const period = (id: string, label = 'Synthetic period') => ({ id, label, languageTag: 'ja', localizedLabels: { en: ['Synthetic English label'], ja: ['合成テスト'] }, start: { in: { year: '-0220' }, label: '221 BCE' }, stop: { in: { earliestYear: '0200', latestYear: '0205' }, label: '200–205 CE' }, spatialCoverage: [{ id: 'http://www.wikidata.org/entity/Q17', label: 'Japan' }], spatialCoverageDescription: 'Synthetic test region' });
const document = { authorities: {
  p0aaaaa: { id: 'p0aaaaa', source: { title: 'Synthetic bibliographic source', locator: 'page 1' }, periods: { p0aaaaabbbb: period('p0aaaaabbbb') } },
  p0ccccc: { id: 'p0ccccc', source: { title: 'Different synthetic definition source' }, periods: { p0ccccddddd: period('p0ccccddddd') } },
} };

test('XSD zero and negative years are converted independently from Wikidata JSON civil years', () => {
  assert.equal(mapPeriodOYear('0000'), -1); assert.equal(mapPeriodOYear('-0001'), -2); assert.equal(mapPeriodOYear('-0220'), -221);
  assert.equal(mapPeriodOYear('0200'), 200); assert.equal(mapPeriodOYear('about 200'), null); assert.equal(mapPeriodOYear(200), null);
});

test('source-specific period definitions keep original labels, bounds and bibliographic evidence', () => {
  const result = mapPeriodODocument(document, source);
  assert.equal(result.collection.objects.length, 2); assert.equal(result.collection.objects[0].labels.en, 'Synthetic English label');
  assert.equal(result.collection.objects[0].labels.ja, '合成テスト');
  assert.deepEqual(result.collection.objects[0].types, ['periodo:period-definition']);
  assert.deepEqual((result.collection.sources[0].record as any).authority.source, document.authorities.p0aaaaa.source);
  const start = result.collection.assertions.find(value => value.propertyId === 'periodo:definition-start')!;
  assert.equal(start.value.kind, 'time'); if (start.value.kind === 'time') assert.equal(start.value.value.earliestYear, -221);
  const activeLabel = result.collection.assertions.find(value => value.propertyId === 'periodo:definition-label')!;
  assert.equal(activeLabel.review, 'unreviewed'); assert.equal(activeLabel.validTime!.end!.latestYear, 205);
  assert.ok(activeLabel.qualifiers.some(value => value.propertyId === 'periodo:source-stop-label'));
  assert.ok(result.collection.assertions.find(value => value.propertyId === 'periodo:definition-spatial-scope')!.qualifiers.some(value => value.propertyId === 'periodo:spatial-semantics'));
  const index = createKnowledgeIndex(result.collection); assert.equal(index.query({ time: [-250, -200] }).total, 2);
  assert.equal(index.state({ objectId: result.collection.objects[0].id, year: 202, includeUnreviewed: true }).fields.find(value => value.propertyId === 'periodo:definition-label')!.status, 'uncertain');
  assert.ok(!result.collection.objects.some(object => object.types.includes('polity')));
});

test('authority/spatial selection, explicit exclusion and continuation preserve a reusable bulk flow', () => {
  const first = mapPeriodODocument(document, source, { limit: 1, spatialIds: ['wikidata:Q17'] });
  assert.equal(first.report.nextRecord, 1);
  const next = mapPeriodODocument(document, source, { startRecord: first.report.nextRecord! }); assert.equal(next.report.selected, 1);
  assert.equal(mapPeriodODocument(document, source, { excludeAuthorityIds: ['p0aaaaa'] }).collection.objects[0].id, 'periodo:p0ccccddddd');
  assert.equal(mapPeriodODocument(document, source, { authorityIds: ['p0aaaaa'], spatialIds: ['wikidata:Q148'] }).report.selected, 0);
});

test('invalid or reversed dates do not fabricate an active historical interval', () => {
  const bad = structuredClone(document); bad.authorities.p0aaaaa.periods.p0aaaaabbbb.start.in.year = '0900';
  const result = mapPeriodODocument(bad, source, { authorityIds: ['p0aaaaa'] });
  assert.ok(result.issues.some(value => value.code === 'REVERSED_INTERVAL'));
  assert.equal(result.collection.assertions.find(value => value.propertyId === 'periodo:definition-label')!.validTime, undefined);
  assert.throws(() => mapPeriodODocument(document, { ...source, url: 'https://example.invalid/arbitrary-file' }), /INVALID_PERIODO_DOCUMENT/);
});

test('an open-ended published label does not become a historical end at the catalog cutoff', () => {
  const input = structuredClone(document); input.authorities.p0aaaaa.periods.p0aaaaabbbb.label = 'Synthetic period, 1989-';
  const result = mapPeriodODocument(input, source, { authorityIds: ['p0aaaaa'] });
  assert.ok(result.issues.some(value => value.code === 'OPEN_LABEL_CLOSED_RANGE'));
  assert.ok(result.collection.assertions.some(value => value.propertyId === 'periodo:definition-stop'));
  assert.equal(result.collection.assertions.find(value => value.propertyId === 'periodo:definition-label')!.validTime, undefined);
});

test('an aggregate CC0 declaration does not automatically clear every upstream authority', () => {
  assert.equal(mapPeriodODocument(document, source).collection.sources[0].rights.redistribution, 'unknown');
  const allowed = mapPeriodODocument(document, source, { authorityIds: ['p0aaaaa'], authorityRights: { p0aaaaa: { redistribution: 'allowed', evidenceUrl: 'https://example.invalid/reviewed-authority-rights' } } });
  assert.equal(allowed.collection.sources[0].rights.redistribution, 'allowed');
  const restricted = structuredClone(document) as any; restricted.authorities.p0fp7wv = restricted.authorities.p0aaaaa; delete restricted.authorities.p0aaaaa;
  assert.equal(mapPeriodODocument(restricted, source, { authorityIds: ['p0fp7wv'] }).collection.sources[0].rights.redistribution, 'restricted');
});
