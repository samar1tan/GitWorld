import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import { CLIOPATRIA_VERIFIED_RELEASE, mapCliopatriaDocument, readCliopatriaZip, unpackCliopatriaZip, type CliopatriaSource } from './cliopatria.ts';

const source: CliopatriaSource = { url: 'https://example.invalid/source.zip', revision: 'synthetic-only', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-25T00:00:00Z' };
const polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
const feature = (name: string, from = 100, to = 200, external = 'Q7001') => ({ type: 'Feature', properties: { Name: name, FromYear: from, ToYear: to, Area: 100, Type: 'POLITY', Wikipedia: name.replaceAll(' ', '_'), Wikidata: external, SeshatID: '', Components: '', MemberOf: '' }, geometry: polygon });
const document = (features: unknown[]) => ({ type: 'FeatureCollection', features });
function crc32(bytes: Buffer) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
function zip(name: string, raw: Buffer) {
  const filename = Buffer.from(name), compressed = deflateRawSync(raw), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22), checksum = crc32(raw);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(filename.length, 28);
  const data = Buffer.concat([local, filename, compressed]), directory = Buffer.concat([central, filename]);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(data.length, 16);
  return Buffer.concat([data, directory, end]);
}

test('source entities are provisional composite identities, not shared QIDs or names alone', () => {
  const first = feature('First source label'), second = feature('Second source label');
  const sameName = feature('First source label'); sameName.properties.Wikipedia = 'Other_source_page';
  const mapped = mapCliopatriaDocument(document([first, second, sameName]), source);
  assert.equal(mapped.collection.objects.length, 3); assert.ok(mapped.issues.some(issue => issue.code === 'SHARED_EXTERNAL_REFERENCE'));
  for (const object of mapped.collection.objects) { assert.match(object.id, /^cliopatria-provisional:/); assert.equal(object.identities[0].provider, 'cliopatria-provisional'); }
});

test('intervals create reviewable geometry state observations, not polity lifespans or capitals', () => {
  const mapped = mapCliopatriaDocument(document([feature('One source entity', 100, 150), feature('One source entity', 200, 250)]), source);
  const index = createKnowledgeIndex(mapped.collection), id = mapped.collection.objects[0].id;
  assert.equal(index.state({ objectId: id, year: 125 }).fields.find(field => field.propertyId === 'territory.geometry')!.status, 'unknown');
  const state = index.state({ objectId: id, year: 125, includeUnreviewed: true });
  assert.equal(state.fields.find(field => field.propertyId === 'territory.geometry')!.status, 'known');
  assert.equal(index.state({ objectId: id, year: 175, includeUnreviewed: true }).fields.find(field => field.propertyId === 'territory.geometry')!.status, 'unknown');
  assert.equal(mapped.collection.assertions.some(value => value.propertyId.includes('capital') || value.propertyId.includes('inception')), false);
  const location = mapped.collection.assertions.find(value => value.value.kind === 'coordinate')!;
  assert.ok(location.qualifiers.some(value => value.propertyId === 'geo:semantic-role' && (value.value as any).value === 'geometry-derived-location-not-capital'));
  assert.deepEqual(mapped.collection.sources[0].record, document([feature('One source entity', 100, 150)]).features[0]);
});

test('membership remains an unresolved source reference and exact duplicates do not multiply claims', () => {
  const value = feature('Synthetic alliance'); value.properties.Type = 'RELATION'; value.properties.MemberOf = '(Synthetic parent)';
  const result = mapCliopatriaDocument(document([value, structuredClone(value)]), source);
  assert.equal(result.report.selected, 1); assert.ok(result.issues.some(issue => issue.code === 'EXACT_DUPLICATE'));
  assert.equal(result.collection.assertions.find(value => value.propertyId === 'relation.source-member-of')!.value.kind, 'text');
  assert.ok(!('parents' in result.collection.objects[0])); createKnowledgeIndex(result.collection);
});

test('generic name/time filtering and continuation work without a case-specific renderer', () => {
  const input = document([feature('Object A', -500, -300), feature('Object B', 100, 200), feature('Object C', 300, 400)]);
  const first = mapCliopatriaDocument(input, source, { limit: 1 }); assert.equal(first.report.nextRecord, 1);
  const second = mapCliopatriaDocument(input, source, { startRecord: first.report.nextRecord!, filter: { text: 'Object', years: [50, 250] } });
  assert.equal(second.report.selected, 1); assert.equal(second.collection.objects[0].labels.en, 'Object B');
});

test('year zero and malformed geometry become exceptions rather than invented observations', () => {
  const invalid = feature('Zero year', 0, 20), geometry = feature('Missing geometry'); (geometry as any).geometry = null;
  const result = mapCliopatriaDocument(document([invalid, geometry]), source);
  assert.ok(result.issues.some(value => value.code === 'INVALID_TIME')); assert.ok(result.issues.some(value => value.code === 'INVALID_GEOMETRY'));
  assert.equal(result.collection.objects.length, 1); assert.equal(result.collection.assertions.some(value => value.value.kind === 'coordinate'), false);
});

test('a representative point does not occupy an excluded polygon hole', () => {
  const value = feature('Synthetic donut');
  value.geometry.coordinates.push([[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]);
  const result = mapCliopatriaDocument(document([value]), source);
  const location = result.collection.assertions.find(value => value.value.kind === 'coordinate')!;
  assert.deepEqual(location.value, { kind: 'coordinate', longitude: 0, latitude: 0, globe: 'earth' });
  assert.ok(location.qualifiers.some(value => value.propertyId === 'geo:derivation-method' && (value.value as any).value === 'boundary-vertex-of-largest-polygon'));
});

test('bounded ZIP reading checks integrity without extracting names as filesystem paths', () => {
  const body = Buffer.from(JSON.stringify(document([feature('Synthetic')]))), archive = zip('cliopatria_polities_only_v021.geojson', body);
  assert.deepEqual(unpackCliopatriaZip(archive).bytes, body);
  assert.throws(() => unpackCliopatriaZip(zip('../cliopatria.geojson', body)), /GEOJSON_MISSING/);
  const broken = Buffer.from(archive), central = broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); broken.writeUInt32LE(0, central + 16);
  assert.throws(() => unpackCliopatriaZip(broken), /INTEGRITY/);
  assert.throws(() => unpackCliopatriaZip(Buffer.from('not a zip')), /INVALID_CLIOPATRIA_ZIP/);
});

test('a local ZIP cannot claim a reviewed public-source license through its filename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gitworld-cliopatria-test-'));
  try {
    const file = join(directory, 'cliopatria.geojson.zip');
    await writeFile(file, zip('cliopatria.geojson', Buffer.from(JSON.stringify(document([feature('Synthetic')])))));
    const options = { file, url: CLIOPATRIA_VERIFIED_RELEASE.url, revision: CLIOPATRIA_VERIFIED_RELEASE.tag, retrievedAt: source.retrievedAt };
    assert.deepEqual(await readCliopatriaZip(options), { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } });
    assert.deepEqual(await readCliopatriaZip({ ...options, url: source.url }), { ok: false, error: { code: 'INVALID_REQUEST', retryable: false } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
