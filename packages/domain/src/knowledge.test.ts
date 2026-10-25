import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeTime } from './knowledge.ts';

const time = (year: number): KnowledgeTime => ({ earliestYear: year, latestYear: year, precision: 'year', calendar: 'source-unspecified' });
const assertion = (id: string, value: string, start?: number, end?: number): KnowledgeAssertion => ({ id, subjectId: 'subject', propertyId: 'seat', value: { kind: 'text', value }, qualifiers: [], evidence: [{ sourceId: 'source', locator: `claims.${id}` }], sourceSnapshotId: 'source', review: 'adopted', ...(start !== undefined || end !== undefined ? { validTime: { ...(start !== undefined ? { start: time(start) } : {}), ...(end !== undefined ? { end: time(end) } : {}) } } : {}) });
const fixture = (assertions: KnowledgeAssertion[]): KnowledgeCollection => ({ schemaVersion: 1, objects: [{ id: 'subject', identities: [{ provider: 'synthetic', externalId: 'subject' }], labels: { en: 'Synthetic settlement', 'zh-hans': '测试聚落' }, descriptions: {}, aliases: [{ en: 'Alternate name' }], types: ['settlement'] }], assertions, sources: [{ id: 'source', identity: { provider: 'synthetic', externalId: 'record' }, revision: '1', contentHash: 'test-hash', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', adapterVersion: 'test', rights: { redistribution: 'unknown' } }] });

test('object queries work by names, aliases and types without prepared subject IDs', () => {
  const index = createKnowledgeIndex(fixture([assertion('undated', 'A')]));
  assert.equal(index.query({ text: 'alternate' }).total, 1);
  assert.equal(index.query({ text: '测试' }).total, 1);
  assert.equal(index.query({ typeIds: ['other'] }).total, 0);
  assert.equal(index.query({ time: [100, 200] }).total, 0);
  assert.equal(index.query({ time: [100, 200], includeUndated: true }).total, 1);
  assert.equal(index.query({ bounds: { west: -10, east: 20, south: 0, north: 30 } }).total, 0);
  assert.equal(index.query({ bounds: { west: -10, east: 20, south: 0, north: 30 }, includeUnlocated: true }).total, 1);
});

test('an explicit object scope intersects other filters and cannot expand an empty focus',()=>{
  const input=fixture([assertion('dated','A',100,200)]);
  input.objects.push({...structuredClone(input.objects[0]),id:'other',labels:{en:'Other settlement'}});
  const index=createKnowledgeIndex(input);
  assert.deepEqual(index.query({objectIds:['subject'],time:[150,160]}).objects.map(value=>value.id),['subject']);
  assert.equal(index.query({objectIds:['subject'],text:'Other'}).total,0);
  assert.equal(index.query({objectIds:[]}).total,0);
  assert.equal(index.query({objectIds:['missing']}).coverage?.matchedObjects,0);
  assert.throws(()=>index.query({objectIds:['']}),/INVALID_KNOWLEDGE_QUERY/);
});

test('maps use supplied Earth coordinates and retain unlocated/non-Earth objects outside the map', () => {
  const coordinate: KnowledgeAssertion = { ...assertion('position', 'ignored'), propertyId: 'geo:location', value: { kind: 'coordinate', longitude: 179, latitude: 20, globe: 'earth' } };
  const index = createKnowledgeIndex(fixture([coordinate]));
  assert.equal(index.query({ bounds: { west: 170, east: -170, south: 0, north: 40 } }).total, 1);
  const moon = createKnowledgeIndex(fixture([{ ...coordinate, value: { ...coordinate.value as any, globe: 'moon' } }]));
  assert.equal(moon.query().total, 1); assert.equal(moon.query().objects[0].coordinates.length, 0);
});

test('source value dates are searchable observations, not validity of an undated field', () => {
  const birth: KnowledgeAssertion = { ...assertion('birth', 'ignored'), propertyId: 'birth-date', value: { kind: 'time', value: time(-50) } };
  const index = createKnowledgeIndex(fixture([birth]));
  assert.equal(index.query({ time: [-100, -1] }).total, 1);
  assert.equal(index.state({ objectId: 'subject', year: -50 }).fields[0].status, 'unknown');
  assert.equal(index.history({ objectId: 'subject' }).observations.length, 0);
});

test('multiple source assertions remain multiple despite a preferred rank', () => {
  const a = assertion('a', 'A', 100, 200), b = { ...assertion('b', 'B', 100, 200), rank: 'preferred' as const };
  const index = createKnowledgeIndex(fixture([a, b]));
  const state = index.state({ objectId: 'subject', year: 150 });
  assert.equal(state.fields[0].status, 'multiple'); assert.equal(state.fields[0].values.length, 2);
  assert.deepEqual(new Set(state.fields[0].assertionIds), new Set(['a', 'b']));
  assert.equal(index.history({ objectId: 'subject' }).changes.length, 0);
});

test('unreviewed, absent, unknown and open-boundary claims keep distinct meanings', () => {
  const values = [assertion('unreviewed', 'Candidate', 100, 200), assertion('open', 'Open', 300), assertion('absent', 'ignored', 400, 450), assertion('unknown', 'ignored', 500, 550)];
  values[0].review = 'unreviewed'; values[2].value = { kind: 'absent' }; values[3].value = { kind: 'unknown' };
  const index = createKnowledgeIndex(fixture(values));
  assert.equal(index.state({ objectId: 'subject', year: 150 }).fields[0].status, 'unknown');
  assert.equal(index.state({ objectId: 'subject', year: 150, includeUnreviewed: true }).fields[0].status, 'known');
  assert.equal(index.state({ objectId: 'subject', year: 300 }).fields[0].status, 'uncertain');
  assert.equal(index.state({ objectId: 'subject', year: 350 }).fields[0].status, 'unknown');
  assert.equal(index.state({ objectId: 'subject', year: 425 }).fields[0].status, 'absent');
  assert.equal(index.state({ objectId: 'subject', year: 525 }).fields[0].status, 'unknown');
});

test('uncertain dates produce possible values and no invented midpoint', () => {
  const value = assertion('approximate', 'Possible');
  value.validTime = { point: { earliestYear: 100, latestYear: 120, precision: 'interval', calendar: 'source-unspecified' } };
  const index = createKnowledgeIndex(fixture([value]));
  const field = index.state({ objectId: 'subject', year: 110 }).fields[0];
  assert.equal(field.status, 'uncertain'); assert.deepEqual(field.possibleValues, [{ kind: 'text', value: 'Possible' }]);
  assert.deepEqual(index.history({ objectId: 'subject' }).observations.map(value => value.year), [100, 120]);
});

test('possible temporal applicability preserves closed intervals without asserting claim truth or extending coverage', () => {
  const certain = assertion('certain', 'A', 100, 120), candidate = assertion('candidate', 'B', 100, 120), single = assertion('single', 'C', 200, 200);
  candidate.validTime!.certainty = 'possible'; single.validTime!.certainty = 'possible';
  const index = createKnowledgeIndex(fixture([certain, candidate, single]));
  const state = index.state({ objectId: 'subject', year: 110 }).fields[0];
  assert.equal(state.status, 'uncertain'); assert.deepEqual(state.values, [{ kind: 'text', value: 'A' }]); assert.deepEqual(state.possibleValues, [{ kind: 'text', value: 'B' }]);
  assert.equal(index.state({ objectId: 'subject', year: 200 }).fields[0].status, 'uncertain');
  assert.equal(index.state({ objectId: 'subject', year: 201 }).fields[0].status, 'unknown');
  assert.ok(!index.history({ objectId: 'subject' }).exceptions.some(value => value.reason === 'open-boundary'));
  const invalid = fixture([{ ...candidate, validTime: { ...candidate.validTime!, certainty: 'preferred' as any } }]);
  assert.throws(() => createKnowledgeIndex(invalid), /INVALID_KNOWLEDGE_TIME_CERTAINTY/);
});

test('history automatically proposes observed state changes while retaining coverage gaps', () => {
  const a = assertion('a', 'A', 100, 150), b = assertion('b', 'B', 200, 250);
  const index = createKnowledgeIndex(fixture([a, b]));
  const history = index.history({ objectId: 'subject' });
  assert.equal(history.observations[0].kind, 'baseline');
  assert.ok(history.observations.some(value => value.year === 151 && value.kind === 'coverage-boundary'));
  assert.equal(history.changes.length, 1); assert.deepEqual(history.changes[0].observedBetween, [150, 200]);
  assert.equal(history.changes[0].kind, 'change-candidate');
  assert.equal(index.diff({ objectId: 'subject', year: 150 }, { objectId: 'subject', year: 200 }).fields[0].kind, 'changed');
  assert.equal(index.diff({ objectId: 'subject', year: 150 }, { objectId: 'subject', year: 175 }).fields[0].kind, 'unknown');
});

test('a source interval ending does not hide another active state after an annual overlap', () => {
  const index = createKnowledgeIndex(fixture([assertion('a', 'A', 100, 150), assertion('b', 'B', 150, 200), assertion('c', 'C', 200, 220)]));
  const history = index.history({ objectId: 'subject' });
  const afterOverlap = history.observations.find(value => value.year === 151)!;
  assert.equal(afterOverlap.kind, 'observation'); assert.equal(afterOverlap.state.fields[0].status, 'known');
  assert.deepEqual(afterOverlap.sourceAssertionIds, ['a', 'b']);
  assert.equal(history.changes.length, 2);
  assert.equal(history.observations.find(value => value.year === 221)!.kind, 'coverage-boundary');
  assert.equal(history.observations.find(value => value.year === 150)!.state.fields[0].status, 'multiple');
});

test('BCE/CE boundaries have no year zero and queries do not mutate stored content', () => {
  const data = fixture([assertion('bce', 'A', -10, -1)]), original = structuredClone(data), index = createKnowledgeIndex(data);
  assert.deepEqual(index.history({ objectId: 'subject' }).observations.map(value => value.year), [-10, -1, 1]);
  assert.throws(() => index.state({ objectId: 'subject', year: 0 }), /INVALID_KNOWLEDGE_YEAR/);
  const result = index.query(); result.objects[0].labels.en = 'Changed locally';
  assert.equal(index.object('subject')!.labels.en, 'Synthetic settlement'); assert.deepEqual(data, original);
});

test('duplicate identities, invalid source references and invalid coordinates fail rather than hide data', () => {
  const data = fixture([assertion('a', 'A')]); data.objects.push(structuredClone(data.objects[0]));
  assert.throws(() => createKnowledgeIndex(data), /DUPLICATE_KNOWLEDGE_ID/);
  const missing = fixture([assertion('a', 'A')]); missing.assertions[0].sourceSnapshotId = 'missing';
  assert.throws(() => createKnowledgeIndex(missing), /INVALID_KNOWLEDGE_REFERENCE/);
  const wrong = fixture([assertion('a', 'A')]); wrong.assertions[0].value = { kind: 'coordinate', longitude: 181, latitude: 0, globe: 'earth' };
  assert.throws(() => createKnowledgeIndex(wrong), /INVALID_KNOWLEDGE_COORDINATE/);
});

test('coverage summarizes the complete filtered match, keeps source dates separate and bounds its groups',()=>{
  const input=fixture([]);input.objects=Array.from({length:55},(_,i)=>({...structuredClone(input.objects[0]),id:`object:${i}`,labels:{en:`Object ${i}`},types:[`type:${i}`]}));
  input.assertions=input.objects.flatMap((subject,i)=>i===54?[]:[{...assertion(`dated:${i}`,'Value',i===0?-1:100,200),subjectId:subject.id},...(i===0?[{...assertion('source-date','ignored'),subjectId:subject.id,value:{kind:'time' as const,value:time(-1000)}}]:[])]);
  const index=createKnowledgeIndex(input),first=index.query({limit:1}),later=index.query({offset:20,limit:1}),coverage=first.coverage!;
  assert.equal(first.objects.length,1);assert.equal(coverage.matchedObjects,55);assert.equal(coverage.validTimeObjects,54);assert.equal(coverage.sourceDateObjects,1);assert.equal(coverage.undatedObjects,1);assert.equal(coverage.unlocatedObjects,55);
  assert.deepEqual(coverage.validTimeRange,[-1,200]);assert.deepEqual(coverage.sourceDateRange,[-1000,-1000]);assert.deepEqual(later.coverage,coverage);
  assert.ok(coverage.buckets.length<=12);assert.ok(coverage.buckets.every(bucket=>bucket.from!==0&&bucket.to!==0));assert.ok(coverage.buckets.reduce((sum,bucket)=>sum+bucket.objects,0)>55,'Overlapping objects are deliberately counted in more than one interval');
  assert.equal(coverage.typeCounts.length,40);assert.equal(coverage.remainingTypes,15);
  const filtered=index.query({time:[-1001,-999],includeUndated:false});assert.equal(filtered.total,1);assert.equal(filtered.coverage?.matchedObjects,1);
  const sourceOnly=fixture([{...assertion('source-date-only','ignored'),value:{kind:'time',value:time(-100)}}]);
  const sourceCoverage=createKnowledgeIndex(sourceOnly).query().coverage!;assert.equal(sourceCoverage.datedObjects,1);assert.equal(sourceCoverage.validTimeObjects,0);assert.deepEqual(sourceCoverage.buckets,[]);assert.equal(sourceCoverage.validTimeRange,null);
});
