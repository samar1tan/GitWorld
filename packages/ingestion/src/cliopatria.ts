import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeJson, KnowledgeObject, KnowledgeSource, KnowledgeText, KnowledgeTime } from '../../domain/src/knowledge.ts';
import type { JsonValue, SourceResult } from './source-types.ts';
import { canonicalSourceJson } from './wikidata.ts';
import { acquirePinnedDownload, type PinnedDownloadReceipt } from './pinned-download.ts';

export const CLIOPATRIA_REPOSITORY = 'https://github.com/Seshat-Global-History-Databank/cliopatria';
export const CLIOPATRIA_LICENSE = 'https://creativecommons.org/licenses/by/4.0/';
export const CLIOPATRIA_MAPPING_VERSION = 'cliopatria-observation-frames-v1';
export const CLIOPATRIA_VERIFIED_RELEASE = {
  tag: 'v0.2.1',
  commit: '5f433377139a6eeaeacbdc894b70f8805b72c8b5',
  revision: 'v0.2.1@5f433377139a6eeaeacbdc894b70f8805b72c8b5',
  url: 'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/v0.2.1/cliopatria.geojson.zip',
  contentHash: 'e10a4e429fca708788ff9e7572a95fce801fae55852d217cffabc1c59cd4eed4',
  bytes: 46_005_176,
} as const;
export type CliopatriaDownloadReceipt = PinnedDownloadReceipt & { revision: typeof CLIOPATRIA_VERIFIED_RELEASE.revision; licenseId: 'CC-BY-4.0'; licenseUrl: typeof CLIOPATRIA_LICENSE };
export async function acquireCliopatriaRelease(options: { directory: string; signal?: AbortSignal; onProgress?: (value: { bytes: number; totalBytes: number }) => void }, dependencies: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<SourceResult<CliopatriaDownloadReceipt>> {
  const release = CLIOPATRIA_VERIFIED_RELEASE;
  const result = await acquirePinnedDownload({ url: release.url, fileName: `cliopatria-${release.tag}.zip`, bytes: release.bytes, contentHash: release.contentHash }, options, dependencies);
  return result.ok ? { ok: true, value: { ...result.value, revision: release.revision, licenseId: 'CC-BY-4.0', licenseUrl: CLIOPATRIA_LICENSE } } : result;
}
type Geometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: JsonValue[] };
export type CliopatriaSource = { url: string; revision: string; retrievedAt: string; contentHash: string };
export type CliopatriaIssue = { code: 'INVALID_FEATURE' | 'INVALID_TIME' | 'INVALID_GEOMETRY' | 'PROVISIONAL_IDENTITY' | 'SHARED_EXTERNAL_REFERENCE' | 'OVERLAPPING_SOURCE_FRAMES' | 'EXACT_DUPLICATE'; record: number; details?: string };
export type CliopatriaFilter = { text?: string; names?: string[]; years?: [number, number] };
export type CliopatriaReadResult = {
  collection: KnowledgeCollection;
  report: { source: CliopatriaSource; totalSourceRecords: number; scanned: number; selected: number; nextRecord: number | null; truncated: boolean; sourceYearRange: [number, number] | null; mappingVersion: typeof CLIOPATRIA_MAPPING_VERSION; provisionalIdentities: number };
  issues: CliopatriaIssue[];
};
const MAX_ZIP = 64 * 1024 * 1024, MAX_JSON = 256 * 1024 * 1024;
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const year = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc32(bytes: Buffer) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }

/** Reads one bounded, unencrypted GeoJSON member without extracting archive paths. */
export function unpackCliopatriaZip(bytes: Buffer): { name: string; bytes: Buffer } {
  if (bytes.length > MAX_ZIP || bytes.length < 22) throw new Error('INVALID_CLIOPATRIA_ZIP');
  let eocd = -1;
  for (let cursor = bytes.length - 22; cursor >= Math.max(0, bytes.length - 65557); cursor--) if (bytes.readUInt32LE(cursor) === 0x06054b50 && cursor + 22 + bytes.readUInt16LE(cursor + 20) === bytes.length) { eocd = cursor; break; }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0 || bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)) throw new Error('INVALID_CLIOPATRIA_ZIP');
  const count = bytes.readUInt16LE(eocd + 10), directorySize = bytes.readUInt32LE(eocd + 12), directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (count < 1 || count > 32 || directoryOffset + directorySize > eocd || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw new Error('INVALID_CLIOPATRIA_ZIP');
  let cursor = directoryOffset, found: { name: string; bytes: Buffer } | null = null;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('INVALID_CLIOPATRIA_ZIP');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), checksum = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20), uncompressed = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) throw new Error('INVALID_CLIOPATRIA_ZIP');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'); cursor = next;
    if (!/^cliopatria[A-Za-z0-9._-]*\.geojson$/i.test(name)) continue;
    if (found || flags & 1 || ![0, 8].includes(method) || uncompressed > MAX_JSON || uncompressed === 0xffffffff || offset + 30 > directoryOffset || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('INVALID_CLIOPATRIA_ZIP');
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28), end = start + compressed;
    if (end > directoryOffset) throw new Error('INVALID_CLIOPATRIA_ZIP');
    const raw = method === 0 ? Buffer.from(bytes.subarray(start, end)) : inflateRawSync(bytes.subarray(start, end), { maxOutputLength: MAX_JSON });
    if (raw.length !== uncompressed || crc32(raw) !== checksum) throw new Error('CLIOPATRIA_ZIP_INTEGRITY');
    found = { name, bytes: raw };
  }
  if (!found) throw new Error('CLIOPATRIA_GEOJSON_MISSING');
  return found;
}
function frameIdentity(properties: Record<string, JsonValue>, index: number, sourceHash: string): { id: string; signature: string } {
  const refs = { type: properties.Type ?? '', name: properties.Name ?? '', wikipedia: properties.Wikipedia ?? '', seshat: properties.SeshatID ?? '' };
  // External QIDs are known to be reused/misaligned in this source and are not identity keys.
  const identified = typeof refs.wikipedia === 'string' && !!refs.wikipedia || typeof refs.seshat === 'string' && !!refs.seshat;
  const signature = identified ? canonicalSourceJson(refs) : canonicalSourceJson({ ...refs, sourceHash, record: index });
  return { id: `cliopatria-provisional:${hash(signature).slice(0, 32)}`, signature };
}
function geometry(value: unknown): Geometry | null {
  if (!object(value) || !['Polygon', 'MultiPolygon'].includes(String(value.type)) || !Array.isArray(value.coordinates)) return null;
  const polygons = value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  if (!polygons.length || polygons.some(polygon => !Array.isArray(polygon) || !polygon.length || polygon.some(ring => !Array.isArray(ring) || ring.length < 4 || ring.some(point => !Array.isArray(point) || point.length < 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number' || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)))) return null;
  return value as Geometry;
}
function representative(shape: Geometry): { longitude: number; latitude: number; method: string } {
  const polygons = (shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates) as number[][][][];
  let selectedPolygon = polygons[0], greatest = -1;
  const area = (ring: number[][]) => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2;
  for (const polygon of polygons) { const size = Math.abs(area(polygon[0])); if (size > greatest) { greatest = size; selectedPolygon = polygon; } }
  const selected = selectedPolygon[0];
  const signedArea = area(selected);
  if (Math.abs(signedArea) < 1e-12) return { longitude: selected[0][0], latitude: selected[0][1], method: 'boundary-vertex-of-largest-polygon' };
  let x = 0, y = 0;
  for (let index = 0; index < selected.length; index++) { const a = selected[index], b = selected[(index + 1) % selected.length], cross = a[0] * b[1] - b[0] * a[1]; x += (a[0] + b[0]) * cross; y += (a[1] + b[1]) * cross; }
  x /= 6 * signedArea; y /= 6 * signedArea;
  const withinRing = (ring: number[][]) => {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result; }
    return result;
  };
  const inside = withinRing(selected) && !selectedPolygon.slice(1).some(withinRing);
  return inside && Number.isFinite(x) && Number.isFinite(y) ? { longitude: x, latitude: y, method: 'planar-centroid-of-largest-polygon' } : { longitude: selected[0][0], latitude: selected[0][1], method: 'boundary-vertex-of-largest-polygon' };
}
function time(value: number): KnowledgeTime { return { earliestYear: value, latestYear: value, precision: 'year', calendar: 'source-civil-year' }; }

/** Provisional source entities and dated geography observations, never a canonical political chronology. */
export function mapCliopatriaDocument(document: unknown, source: CliopatriaSource, options: { startRecord?: number; limit?: number; filter?: CliopatriaFilter; review?: 'unreviewed' | 'adopted' } = {}): CliopatriaReadResult {
  if (!object(document) || document.type !== 'FeatureCollection' || !Array.isArray(document.features)) throw new Error('INVALID_CLIOPATRIA_DOCUMENT');
  const start = options.startRecord ?? 0, limit = options.limit ?? 1000, filter = options.filter;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000 || !/^[a-f0-9]{64}$/.test(source.contentHash) || !source.revision || !Number.isFinite(Date.parse(source.retrievedAt))) throw new Error('INVALID_CLIOPATRIA_REQUEST');
  if (filter?.years && (!filter.years.every(year) || filter.years[0] > filter.years[1])) throw new Error('INVALID_CLIOPATRIA_REQUEST');
  const collection: KnowledgeCollection = { schemaVersion: 1, objects: [], assertions: [], sources: [] }, issues: CliopatriaIssue[] = [], objects = new Map<string, KnowledgeObject>(), qids = new Map<string, Set<string>>();
  let scanned = 0, selected = 0, minYear = Infinity, maxYear = -Infinity, nextRecord: number | null = null;
  const overlaps = new Map<string, [number, number, number][]>(), seenFeatures = new Set<string>();
  for (const [index, raw] of document.features.entries()) {
    scanned = index + 1;
    if (index < start) continue;
    if (!object(raw) || raw.type !== 'Feature' || !object(raw.properties) || typeof raw.properties.Name !== 'string' || !raw.properties.Name.trim()) { issues.push({ code: 'INVALID_FEATURE', record: index }); continue; }
    const props = raw.properties, sourceName = props.Name as string;
    if (!year(props.FromYear) || !year(props.ToYear) || props.FromYear > props.ToYear) { issues.push({ code: 'INVALID_TIME', record: index }); continue; }
    const fromYear = props.FromYear, toYear = props.ToYear;
    if (filter?.names?.length && !filter.names.includes(sourceName)) continue;
    if (filter?.text && !sourceName.toLocaleLowerCase().includes(filter.text.toLocaleLowerCase())) continue;
    if (filter?.years && (toYear < filter.years[0] || fromYear > filter.years[1])) continue;
    const identity = frameIdentity(props, index, source.contentHash), featureHash = hash(canonicalSourceJson(raw)), sourceId = `cliopatria:frame@${featureHash}`, periodId = `${identity.id}:frame:${fromYear}:${toYear}:${featureHash.slice(0, 16)}`;
    if (seenFeatures.has(featureHash)) { issues.push({ code: 'EXACT_DUPLICATE', record: index, details: featureHash }); continue; }
    seenFeatures.add(featureHash);
    const qid = typeof props.Wikidata === 'string' && /^Q[1-9]\d*$/.test(props.Wikidata) ? props.Wikidata : null;
    if (!objects.has(identity.id)) {
      objects.set(identity.id, { id: identity.id, identities: [{ provider: 'cliopatria-provisional', externalId: identity.id.split(':')[1] }], labels: { en: sourceName }, descriptions: {}, aliases: [], types: [`cliopatria:${String(props.Type ?? 'UNSPECIFIED')}`] });
      issues.push({ code: 'PROVISIONAL_IDENTITY', record: index, details: identity.id });
    }
    if (qid) { const values = qids.get(qid) ?? new Set<string>(); values.add(identity.id); qids.set(qid, values); if (values.size > 1) issues.push({ code: 'SHARED_EXTERNAL_REFERENCE', record: index, details: qid }); }
    const prior = overlaps.get(identity.id) ?? [];
    if (prior.some(([from, to]) => fromYear <= to && toYear >= from)) issues.push({ code: 'OVERLAPPING_SOURCE_FRAMES', record: index, details: identity.id });
    prior.push([fromYear, toYear, index]); overlaps.set(identity.id, prior);
    const record: KnowledgeSource = { id: sourceId, identity: { provider: 'cliopatria-frame', externalId: featureHash }, revision: source.revision, contentHash: featureHash, retrievedAt: source.retrievedAt, url: source.url, adapterVersion: CLIOPATRIA_MAPPING_VERSION,
      rights: { licenseId: 'CC-BY-4.0', licenseUrl: CLIOPATRIA_LICENSE, redistribution: 'allowed', attribution: `Cliopatria, Seshat Global History Databank, ${source.revision}; ${CLIOPATRIA_REPOSITORY}. Changes: source observation frames normalized by GitWorld; provisional identity and derived map location are GitWorld transformations.` }, record: raw };
    collection.sources.push(record);
    const qualifiers: KnowledgeAssertion['qualifiers'] = [
      { propertyId: 'cliopatria:source-entity-status', value: { kind: 'text', value: 'provisional' } },
      { propertyId: 'cliopatria:temporal-semantics', value: { kind: 'text', value: 'geography-observation-interval-not-polity-lifespan' } },
      ...(qid ? [{ propertyId: 'cliopatria:unverified-wikidata-reference', value: { kind: 'text' as const, value: qid } }] : []),
    ];
    const add = (field: string, value: KnowledgeAssertion['value'], locator: string, extra: KnowledgeAssertion['qualifiers'] = []) => collection.assertions.push({ id: `${periodId}:${field}`, subjectId: identity.id, propertyId: field, value, qualifiers: [...qualifiers, ...extra], evidence: [{ sourceId, locator }], sourceSnapshotId: sourceId, review: options.review ?? 'unreviewed', validTime: { start: time(fromYear), end: time(toYear) } });
    add('polity.source-name', { kind: 'text', value: sourceName }, '$.properties.Name');
    if (typeof props.Area === 'number' && Number.isFinite(props.Area) && props.Area >= 0) add('territory.area', { kind: 'number', value: props.Area, unit: 'km2' }, '$.properties.Area', [{ propertyId: 'geo:area-projection', value: { kind: 'text', value: 'EPSG:6933' } }]);
    const shape = geometry(raw.geometry);
    if (shape) {
      add('territory.geometry', { kind: 'raw', value: shape as unknown as KnowledgeJson }, '$.geometry');
      const point = representative(shape);
      add('geo:representative-location', { kind: 'coordinate', longitude: point.longitude, latitude: point.latitude, globe: 'earth' }, '$.geometry', [{ propertyId: 'geo:derivation-method', value: { kind: 'text', value: point.method } }, { propertyId: 'geo:semantic-role', value: { kind: 'text', value: 'geometry-derived-location-not-capital' } }]);
    } else issues.push({ code: 'INVALID_GEOMETRY', record: index });
    for (const [field, property] of [['relation.source-member-of', 'MemberOf'], ['relation.source-components', 'Components']] as const) if (typeof props[property] === 'string' && props[property]) add(field, { kind: 'text', value: props[property] }, `$.properties.${property}`, [{ propertyId: 'relation:resolution-status', value: { kind: 'text', value: 'unresolved-source-reference-not-ancestry' } }]);
    minYear = Math.min(minYear, fromYear); maxYear = Math.max(maxYear, toYear); selected++;
    if (selected >= limit) { nextRecord = index + 1 < document.features.length ? index + 1 : null; break; }
  }
  collection.objects = [...objects.values()];
  return { collection, issues, report: { source, totalSourceRecords: document.features.length, scanned, selected, nextRecord, truncated: nextRecord !== null, sourceYearRange: selected ? [minYear, maxYear] : null, mappingVersion: CLIOPATRIA_MAPPING_VERSION, provisionalIdentities: objects.size } };
}

export async function readCliopatriaZip(options: { file: string; revision: string; url: string; retrievedAt: string; startRecord?: number; limit?: number; filter?: CliopatriaFilter; review?: 'unreviewed' | 'adopted'; signal?: AbortSignal }): Promise<SourceResult<CliopatriaReadResult>> {
  try {
    if (options.signal?.aborted) return { ok: false, error: { code: 'CANCELLED', retryable: true } };
    const release = CLIOPATRIA_VERIFIED_RELEASE;
    if (options.url !== release.url || ![release.tag, release.commit, release.revision].some(revision => revision === options.revision)) return { ok: false, error: { code: 'INVALID_REQUEST', retryable: false } };
    const info = await stat(options.file); if (!info.isFile() || info.size > MAX_ZIP) return { ok: false, error: { code: 'RESPONSE_TOO_LARGE', retryable: false } };
    const bytes = await readFile(options.file); if (bytes.length > MAX_ZIP) return { ok: false, error: { code: 'RESPONSE_TOO_LARGE', retryable: false } };
    if (hash(bytes) !== release.contentHash || bytes.length !== release.bytes) return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } };
    const unpacked = unpackCliopatriaZip(bytes), document: unknown = JSON.parse(unpacked.bytes.toString('utf8'));
    if (options.signal?.aborted) return { ok: false, error: { code: 'CANCELLED', retryable: true } };
    const result = mapCliopatriaDocument(document, { url: release.url, revision: release.revision, retrievedAt: options.retrievedAt, contentHash: release.contentHash }, options);
    return { ok: true, value: result };
  } catch { return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } }; }
}
