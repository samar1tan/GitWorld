import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeEvidence, KnowledgeJson, KnowledgeObject, KnowledgeQualifier, KnowledgeReview, KnowledgeSource, KnowledgeTemporalScope, KnowledgeText, KnowledgeTime, KnowledgeValue } from '../../domain/src/knowledge.ts';
import type { JsonValue, SourceRecordSnapshot } from './source-types.ts';

export type KnowledgeMappingIssue = { code: 'UNSUPPORTED_PROVIDER' | 'INVALID_SOURCE' | 'INVALID_STATEMENT' | 'UNMAPPED_TIME' | 'UNMAPPED_COORDINATE'; locator: string };
export type KnowledgeMappingOptions = { review?: KnowledgeReview; propertyMap?: Record<string, string> };
export type KnowledgeMappingResult = { collection: KnowledgeCollection; issues: KnowledgeMappingIssue[]; mappingVersion: string };
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const civil = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
const array = (value: unknown): JsonValue[] => Array.isArray(value) ? value : [];
const empty = (): KnowledgeCollection => ({ schemaVersion: 1, objects: [], assertions: [], sources: [] });
const id = (provider: string, externalId: string) => `${provider}:${externalId}`;
const stableJson = (value: unknown): string => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
function labels(value: unknown): KnowledgeText {
  if (!object(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([language, value]) => object(value) && string(value.value) ? [[language, value.value]] : []));
}

/** JSON Wikibase BCE numbering is civil, unlike the RDF/XSD export. No calendar conversion is made. */
export function mapWikidataTime(raw: unknown): KnowledgeTime | null {
  if (!object(raw) || !string(raw.time) || !Number.isInteger(raw.precision) || Number(raw.precision) < 0 || Number(raw.precision) > 14 || !string(raw.calendarmodel)) return null;
  const match = raw.time.match(/^([+-])(\d{1,16})-(\d{2})-(\d{2})T/);
  if (!match || !['http://www.wikidata.org/entity/Q1985727', 'http://www.wikidata.org/entity/Q1985786', 'https://www.wikidata.org/entity/Q1985727', 'https://www.wikidata.org/entity/Q1985786'].includes(raw.calendarmodel)) return null;
  const year = Number(match[2]) * (match[1] === '-' ? -1 : 1), precision = Number(raw.precision);
  if (!civil(year) || Number(raw.before ?? 0) !== 0 || Number(raw.after ?? 0) !== 0) return null;
  let earliestYear = year, latestYear = year;
  if (precision < 9) {
    const unit = 10 ** (9 - precision);
    if (!Number.isSafeInteger(unit)) return null;
    const absolute = Math.abs(year);
    const lower = precision === 8 ? Math.floor(absolute / unit) * unit : Math.floor((absolute - 1) / unit) * unit + 1;
    const upper = lower + unit - 1;
    earliestYear = year < 0 ? -upper : Math.max(1, lower); latestYear = year < 0 ? -Math.max(1, lower) : upper;
    if (!civil(earliestYear) || !civil(latestYear)) return null;
  }
  const name: KnowledgeTime['precision'] = precision >= 11 ? 'day' : precision === 10 ? 'month' : precision === 9 ? 'year' : precision === 8 ? 'decade' : precision === 7 ? 'century' : precision === 6 ? 'millennium' : 'broader';
  return { earliestYear, latestYear, precision: name, calendar: raw.calendarmodel, raw: raw.time, sourcePrecision: precision,
    ...(precision >= 10 && Number(match[3]) >= 1 && Number(match[3]) <= 12 ? { month: Number(match[3]) } : {}),
    ...(precision >= 11 && Number(match[4]) >= 1 && Number(match[4]) <= 31 ? { day: Number(match[4]) } : {}) };
}
function source(snapshot: SourceRecordSnapshot): KnowledgeSource {
  return { id: `${snapshot.identity.provider}:${snapshot.identity.externalId}@${snapshot.contentHash}`, identity: snapshot.identity,
    revision: snapshot.sourceRevision, contentHash: snapshot.contentHash, retrievedAt: snapshot.retrievedAt, url: snapshot.url,
    ...(snapshot.revisionUrl ? { revisionUrl: snapshot.revisionUrl } : {}), adapterVersion: snapshot.adapterVersion, rights: snapshot.rights, record: snapshot.raw };
}
function snakValue(snak: unknown, issues: KnowledgeMappingIssue[], locator: string): KnowledgeValue {
  if (!object(snak)) return { kind: 'raw', value: snak as KnowledgeJson ?? null };
  if (snak.snaktype === 'somevalue') return { kind: 'unknown' };
  if (snak.snaktype === 'novalue') return { kind: 'absent' };
  if (!object(snak.datavalue)) return { kind: 'raw', value: snak };
  const value = snak.datavalue.value;
  if (object(value) && string(value.id) && /^[QP][1-9]\d*$/.test(value.id)) return { kind: 'entity', objectId: id('wikidata', value.id) };
  if (object(value) && string(value.time)) {
    const time = mapWikidataTime(value);
    if (time) return { kind: 'time', value: time };
    issues.push({ code: 'UNMAPPED_TIME', locator }); return { kind: 'raw', value };
  }
  if (object(value) && typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    if (Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && string(value.globe)) return { kind: 'coordinate', latitude: value.latitude, longitude: value.longitude, globe: value.globe, ...(typeof value.precision === 'number' ? { precision: value.precision } : {}) };
    issues.push({ code: 'UNMAPPED_COORDINATE', locator }); return { kind: 'raw', value };
  }
  if (object(value) && string(value.amount) && Number.isFinite(Number(value.amount))) return { kind: 'number', value: Number(value.amount), ...(string(value.unit) ? { unit: value.unit } : {}), ...(string(value.lowerBound) && Number.isFinite(Number(value.lowerBound)) ? { lowerBound: Number(value.lowerBound) } : {}), ...(string(value.upperBound) && Number.isFinite(Number(value.upperBound)) ? { upperBound: Number(value.upperBound) } : {}) };
  if (object(value) && string(value.text)) return { kind: 'text', value: value.text, ...(string(value.language) ? { language: value.language } : {}) };
  if (string(value)) return { kind: 'text', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  return { kind: 'raw', value: value as KnowledgeJson ?? null };
}
function wikidata(snapshot: SourceRecordSnapshot, options: KnowledgeMappingOptions): KnowledgeMappingResult {
  const collection = empty(), issues: KnowledgeMappingIssue[] = [], raw = snapshot.raw, src = source(snapshot);
  if (!object(raw) || raw.id !== snapshot.identity.externalId || !object(raw.claims)) return { collection, issues: [{ code: 'INVALID_SOURCE', locator: '$' }], mappingVersion: 'wikidata-statements-v1' };
  const subjectId = id('wikidata', snapshot.identity.externalId);
  const types = array(raw.claims.P31).flatMap(statement => object(statement) && object(statement.mainsnak) && object(statement.mainsnak.datavalue) && object(statement.mainsnak.datavalue.value) && string(statement.mainsnak.datavalue.value.id) ? [id('wikidata', statement.mainsnak.datavalue.value.id)] : []);
  const aliases = object(raw.aliases) ? Object.entries(raw.aliases).flatMap(([language, values]) => array(values).flatMap(value => object(value) && string(value.value) ? [{ [language]: value.value }] : [])) : [];
  collection.objects.push({ id: subjectId, identities: [snapshot.identity], labels: labels(raw.labels), descriptions: labels(raw.descriptions), aliases, types: [...new Set(types)] }); collection.sources.push(src);
  for (const [property, statements] of Object.entries(raw.claims)) {
    for (const [index, statement] of array(statements).entries()) {
      const locator = `$.claims.${property}[${index}]`;
      if (!object(statement) || !string(statement.id) || !object(statement.mainsnak) || statement.mainsnak.property !== property) { issues.push({ code: 'INVALID_STATEMENT', locator }); continue; }
      const qualifiers: KnowledgeQualifier[] = [];
      if (object(statement.qualifiers)) for (const [propertyId, snaks] of Object.entries(statement.qualifiers)) for (const [qualifierIndex, snak] of array(snaks).entries()) qualifiers.push({ propertyId: id('wikidata', propertyId), value: snakValue(snak, issues, `${locator}.qualifiers.${propertyId}[${qualifierIndex}]`), raw: snak });
      const times = (property: string) => qualifiers.filter(value => value.propertyId === id('wikidata', property) && value.value.kind === 'time').map(value => (value.value as { kind: 'time'; value: KnowledgeTime }).value);
      const starts = times('P580'), ends = times('P582'), points = times('P585');
      // Multiple temporal qualifiers are preserved; they need review rather than an invented combined interval.
      let validTime: KnowledgeTemporalScope | undefined;
      if (starts.length <= 1 && ends.length <= 1 && points.length <= 1 && !(points.length && (starts.length || ends.length))) {
        if (starts.length || ends.length || points.length) validTime = { ...(starts[0] ? { start: starts[0] } : {}), ...(ends[0] ? { end: ends[0] } : {}), ...(points[0] ? { point: points[0] } : {}) };
      } else issues.push({ code: 'UNMAPPED_TIME', locator: `${locator}.qualifiers` });
      const evidence: KnowledgeEvidence[] = [{ sourceId: src.id, locator }];
      for (const [referenceIndex, reference] of array(statement.references).entries()) {
        if (!object(reference)) continue;
        const urls = object(reference.snaks) ? array(reference.snaks.P854).flatMap(snak => object(snak) && object(snak.datavalue) && string(snak.datavalue.value) ? [snak.datavalue.value] : []) : [];
        evidence.push({ sourceId: src.id, locator: `${locator}.references[${referenceIndex}]`, ...(urls[0] ? { url: urls[0] } : {}) });
      }
      collection.assertions.push({ id: id('wikidata', statement.id), subjectId, propertyId: options.propertyMap?.[property] ?? id('wikidata', property), value: snakValue(statement.mainsnak, issues, `${locator}.mainsnak`), qualifiers, evidence, sourceSnapshotId: src.id, review: options.review ?? 'unreviewed',
        ...(['preferred', 'normal', 'deprecated'].includes(String(statement.rank)) ? { rank: statement.rank as 'preferred' | 'normal' | 'deprecated' } : {}), ...(validTime ? { validTime } : {}) });
    }
  }
  return { collection, issues, mappingVersion: 'wikidata-statements-v1' };
}

function pleiadesTime(value: unknown): KnowledgeTime | null {
  return civil(value) ? { earliestYear: value, latestYear: value, precision: 'year', calendar: 'source-unspecified' } : null;
}
function pleiadesScope(raw: Record<string, JsonValue>): KnowledgeTemporalScope | undefined {
  const start = pleiadesTime(raw.start), end = pleiadesTime(raw.end);
  if (start && end && start.earliestYear > end.latestYear) return undefined;
  return start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined;
}
function pleiades(snapshot: SourceRecordSnapshot, options: KnowledgeMappingOptions): KnowledgeMappingResult {
  const collection = empty(), issues: KnowledgeMappingIssue[] = [], raw = snapshot.raw, src = source(snapshot);
  if (!object(raw) || !string(raw.title) || String(raw.id) !== snapshot.identity.externalId) return { collection, issues: [{ code: 'INVALID_SOURCE', locator: '$' }], mappingVersion: 'pleiades-assertions-v1' };
  const subjectId = id('pleiades', snapshot.identity.externalId);
  const nameText = (name: Record<string, JsonValue>) => string(name.attested) && name.attested.trim() ? name.attested : string(name.romanized) && name.romanized.trim() ? name.romanized : string(name.title) ? name.title : null;
  const aliases = array(raw.names).flatMap(name => object(name) && nameText(name) ? [{ [string(name.language) ? name.language : 'und']: nameText(name)! }] : []);
  const obj: KnowledgeObject = { id: subjectId, identities: [snapshot.identity], labels: { en: raw.title }, descriptions: string(raw.description) ? { en: raw.description } : {}, aliases, types: array(raw.placeTypes).filter(string).map(type => id('pleiades-type', type)) };
  collection.objects.push(obj); collection.sources.push(src);
  const add = (key: string, propertyId: string, value: KnowledgeValue, record: Record<string, JsonValue>, locator: string, temporal?: KnowledgeTemporalScope) => {
    const evidence: KnowledgeEvidence[] = [{ sourceId: src.id, locator }];
    for (const [index, reference] of array(record.references).entries()) if (object(reference)) evidence.push({ sourceId: src.id, locator: `${locator}.references[${index}]`, ...(string(reference.accessURI) && reference.accessURI ? { url: reference.accessURI } : {}), ...(string(reference.shortTitle) ? { citation: `${reference.shortTitle}${string(reference.citationDetail) && reference.citationDetail ? `, ${reference.citationDetail}` : ''}` } : {}) });
    const qualifiers: KnowledgeQualifier[] = [];
    for (const field of ['attestations', 'associationCertainty', 'locationType', 'accuracy', 'locationPrecision', 'nameType', 'romanized', 'transcriptionAccuracy', 'transcriptionCompleteness']) if (record[field] !== undefined) qualifiers.push({ propertyId: id('pleiades', field), value: { kind: 'raw', value: record[field] } });
    collection.assertions.push({ id: `${subjectId}:${key}`, subjectId, propertyId: options.propertyMap?.[propertyId] ?? propertyId, value, qualifiers, evidence, sourceSnapshotId: src.id, review: options.review ?? 'unreviewed', ...(temporal ? { validTime: temporal } : {}) });
  };
  // A place's top-level start/end is catalog coverage, never an automatically inferred life or state transition.
  const start = pleiadesTime(raw.start), end = pleiadesTime(raw.end);
  if (start) add('coverage-start', 'pleiades:coverage-start', { kind: 'time', value: start }, raw, '$.start');
  if (end) add('coverage-end', 'pleiades:coverage-end', { kind: 'time', value: end }, raw, '$.end');
  for (const [index, name] of array(raw.names).entries()) {
    if (!object(name) || !nameText(name)) continue;
    const language = string(name.language) && name.language ? name.language : 'und';
    const stableName = string(name.id) ? name.id : string(name.uri) ? name.uri : `${language}:${nameText(name)}`;
    add(`name:${stableName}`, `pleiades:attested-name:${language}`, { kind: 'text', value: nameText(name)!, language }, name, `$.names[${index}]`, pleiadesScope(name));
  }
  for (const [index, location] of array(raw.locations).entries()) {
    if (!object(location) || !object(location.geometry) || location.geometry.type !== 'Point' || !Array.isArray(location.geometry.coordinates)) continue;
    const [longitude, latitude] = location.geometry.coordinates;
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) { issues.push({ code: 'UNMAPPED_COORDINATE', locator: `$.locations[${index}].geometry` }); continue; }
    add(`location:${String(location.id ?? index)}`, 'geo:location', { kind: 'coordinate', longitude, latitude, globe: 'earth' }, location, `$.locations[${index}]`, pleiadesScope(location));
  }
  if (!collection.assertions.some(assertion => assertion.value.kind === 'coordinate') && Array.isArray(raw.reprPoint) && raw.reprPoint.length === 2 && raw.reprPoint.every(value => typeof value === 'number' && Number.isFinite(value))) {
    const [longitude, latitude] = raw.reprPoint as number[];
    if (Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90) add('representative-point', 'geo:representative-location', { kind: 'coordinate', longitude, latitude, globe: 'earth' }, raw, '$.reprPoint');
  }
  for (const [index, connection] of array(raw.connections).entries()) {
    if (!object(connection) || !string(connection.connectsTo) || !string(connection.connectionType)) continue;
    const target = connection.connectsTo.match(/(?:\/places\/)?(\d+)\/?$/)?.[1];
    if (!target) continue;
    add(`connection:${String(connection.id ?? index)}`, id('pleiades-connection', connection.connectionType), { kind: 'entity', objectId: id('pleiades', target) }, connection, `$.connections[${index}]`, pleiadesScope(connection));
  }
  return { collection, issues, mappingVersion: 'pleiades-assertions-v1' };
}

/** A versioned mapping creates reviewable source assertions, never history branches or hidden ancestry. */
export function mapSourceSnapshot(snapshot: SourceRecordSnapshot, options: KnowledgeMappingOptions = {}): KnowledgeMappingResult {
  if (snapshot.identity.provider === 'wikidata') return wikidata(snapshot, options);
  if (snapshot.identity.provider === 'pleiades') return pleiades(snapshot, options);
  return { collection: empty(), issues: [{ code: 'UNSUPPORTED_PROVIDER', locator: '$.identity.provider' }], mappingVersion: 'unsupported' };
}

/** Repeated identical mappings deduplicate. Conflicting stable identities are returned for review, never overwritten. */
export function combineKnowledgeCollections(collections: KnowledgeCollection[]): { collection: KnowledgeCollection; conflicts: { kind: 'object' | 'assertion' | 'source'; id: string }[] } {
  const result = empty(), conflicts: { kind: 'object' | 'assertion' | 'source'; id: string }[] = [];
  for (const [key, kind] of [['objects', 'object'], ['assertions', 'assertion'], ['sources', 'source']] as const) {
    const selected = new Map<string, any>();
    for (const collection of collections) for (const value of collection[key]) {
      const prior = selected.get(value.id);
      const comparable = (item: any) => kind === 'source' ? { ...item, retrievedAt: '' } : item;
      if (prior && stableJson(comparable(prior)) !== stableJson(comparable(value))) { conflicts.push({ kind, id: value.id }); continue; }
      if (!prior) selected.set(value.id, value);
    }
    (result[key] as any[]) = [...selected.values()];
  }
  return { collection: result, conflicts };
}
