/** Pure, provider-independent research content. Acquisition does not imply historical review. */
export type KnowledgeText = Record<string, string>;
export type KnowledgeJson = null | boolean | number | string | KnowledgeJson[] | { [key: string]: KnowledgeJson };
export type KnowledgeReview = 'unreviewed' | 'adopted' | 'rejected';
export const KNOWLEDGE_NAVIGATION_ROLES = ['structure','person','document','source-group','chronology-candidate','period-definition','other'] as const;
export type KnowledgeNavigationRole = typeof KNOWLEDGE_NAVIGATION_ROLES[number];
/** Civil year numbering: -1 is 1 BCE; zero is not a historical year. */
export type KnowledgeTime = {
  earliestYear: number; latestYear: number; precision: 'year' | 'month' | 'day' | 'decade' | 'century' | 'millennium' | 'broader' | 'interval';
  calendar: string; raw?: string; month?: number; day?: number; sourcePrecision?: number; before?: number; after?: number;
};
export type KnowledgeTemporalScope = { start?: KnowledgeTime; end?: KnowledgeTime; point?: KnowledgeTime; certainty?: 'possible' };
export type KnowledgeValue =
  | { kind: 'entity'; objectId: string }
  | { kind: 'text'; value: string; language?: string }
  | { kind: 'number'; value: number; unit?: string; lowerBound?: number; upperBound?: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'time'; value: KnowledgeTime }
  | { kind: 'coordinate'; longitude: number; latitude: number; globe: string; precision?: number }
  | { kind: 'unknown' } | { kind: 'absent' } | { kind: 'raw'; value: KnowledgeJson };
export type KnowledgeSource = {
  id: string; identity: { provider: string; externalId: string }; revision: string | null; contentHash: string;
  retrievedAt: string; url: string; revisionUrl?: string; adapterVersion: string;
  rights: { licenseId?: string; licenseUrl?: string; attribution?: string; redistribution: 'allowed' | 'restricted' | 'unknown' };
  /** Kept for offline evidence locators and reproducible normalization; not an adopted interpretation. */
  record?: KnowledgeJson;
};
export type KnowledgeEvidence = { sourceId: string; locator: string; url?: string; citation?: string };
export type KnowledgeQualifier = { propertyId: string; value: KnowledgeValue; raw?: KnowledgeJson };
export type KnowledgeObject = {
  id: string; identities: { provider: string; externalId: string }[]; labels: KnowledgeText;
  descriptions: KnowledgeText; aliases: KnowledgeText[]; types: string[];
};
export type KnowledgeAssertion = {
  id: string; subjectId: string; propertyId: string; value: KnowledgeValue;
  qualifiers: KnowledgeQualifier[]; evidence: KnowledgeEvidence[]; sourceSnapshotId: string;
  review: KnowledgeReview; rank?: 'preferred' | 'normal' | 'deprecated'; validTime?: KnowledgeTemporalScope;
};
export type KnowledgeCollection = { schemaVersion: 1; objects: KnowledgeObject[]; assertions: KnowledgeAssertion[]; sources: KnowledgeSource[] };
export type KnowledgeBounds = { west: number; south: number; east: number; north: number };
export type KnowledgeQuery = {
  text?: string; typeIds?: string[]; objectIds?: string[]; time?: [number, number]; bounds?: KnowledgeBounds;
  contextIds?: string[]; unassigned?: boolean;
  includeUndated?: boolean; includeUnlocated?: boolean; review?: KnowledgeReview[];
  offset?: number; limit?: number;
};
export type KnowledgeObjectResult = KnowledgeObject & {
  assertionCount: number; datedAssertionCount: number; coordinates: { assertionId: string; longitude: number; latitude: number }[];
  reviewCounts: Record<KnowledgeReview, number>;
  observedTimes: { assertionId: string; kind: 'value-date' | 'valid-time'; time: KnowledgeTime }[];
};
export type KnowledgeCoverage = {
  matchedObjects: number; datedObjects: number; undatedObjects: number; locatedObjects: number; unlocatedObjects: number;
  validTimeObjects: number; sourceDateObjects: number; validTimeRange: [number, number] | null; sourceDateRange: [number, number] | null;
  typeCounts: { typeId: string; count: number; labels?: KnowledgeText; navigationRole?: KnowledgeNavigationRole }[]; remainingTypes: number; untypedObjects: number;
  buckets: { from: number; to: number; objects: number }[];
};
export type KnowledgeQueryResult = { objects: KnowledgeObjectResult[]; total: number; offset: number; limit: number; unlocated: number; undated: number; coverage?: KnowledgeCoverage; typeCatalog?: { id: string; labels: KnowledgeText; navigationRole?: KnowledgeNavigationRole }[] };
export type KnowledgeStateField = {
  propertyId: string; status: 'known' | 'multiple' | 'unknown' | 'absent' | 'uncertain';
  assertionIds: string[]; values: KnowledgeValue[]; possibleAssertionIds: string[];
  possibleValues: KnowledgeValue[];
};
export type KnowledgeState = { objectId: string; year: number; fields: KnowledgeStateField[]; untimedAssertionIds: string[]; unreviewedAssertionIds: string[] };
export type KnowledgeStateRequest = { objectId: string; year: number; propertyIds?: string[]; includeUnreviewed?: boolean };
export type KnowledgeStateDiff = { a: KnowledgeState; b: KnowledgeState; fields: { propertyId: string; kind: 'same' | 'changed' | 'unknown'; before: KnowledgeStateField; after: KnowledgeStateField }[] };
export type KnowledgeObservation = { id: string; objectId: string; year: number; kind: 'baseline' | 'observation' | 'coverage-boundary'; state: KnowledgeState; sourceAssertionIds: string[] };
export type KnowledgeHistory = { objectId: string; observations: KnowledgeObservation[]; changes: { fromObservationId: string; toObservationId: string; observedBetween: [number, number]; propertyIds: string[]; kind: 'change-candidate' }[]; exceptions: { assertionId: string; reason: 'undated' | 'open-boundary' | 'uncertain-time' | 'unreviewed' }[] };

const civilYear = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
const clone = <T>(value: T): T => structuredClone(value);
function validTime(value: KnowledgeTime): boolean { return civilYear(value.earliestYear) && civilYear(value.latestYear) && value.earliestYear <= value.latestYear && typeof value.calendar === 'string'; }
const ordinal = (year: number) => year < 0 ? year + 1 : year;
const compareYear = (a: number, b: number) => ordinal(a) - ordinal(b);
const overlaps = (a: KnowledgeTime, b: [number, number]) => compareYear(a.latestYear, b[0]) >= 0 && compareYear(a.earliestYear, b[1]) <= 0;
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function assertionTimes(assertion: KnowledgeAssertion): { kind: 'value-date' | 'valid-time'; time: KnowledgeTime }[] {
  const result: { kind: 'value-date' | 'valid-time'; time: KnowledgeTime }[] = [];
  if (assertion.value.kind === 'time') result.push({ kind: 'value-date', time: assertion.value.value });
  const temporal = assertion.validTime;
  if (temporal?.point) result.push({ kind: 'valid-time', time: temporal.point });
  else if (temporal?.start && temporal.end) result.push({ kind: 'valid-time', time: { earliestYear: temporal.start.earliestYear, latestYear: temporal.end.latestYear, precision: 'interval', calendar: temporal.start.calendar === temporal.end.calendar ? temporal.start.calendar : 'mixed-source-calendars' } });
  else if (temporal?.start) result.push({ kind: 'valid-time', time: temporal.start });
  else if (temporal?.end) result.push({ kind: 'valid-time', time: temporal.end });
  return result;
}
/** A single open boundary is evidence at that boundary, not permission for unlimited extrapolation. */
function applicability(assertion: KnowledgeAssertion, year: number): 'definite' | 'possible' | 'outside' | 'untimed' {
  const temporal = assertion.validTime;
  if (!temporal || !temporal.point && !temporal.start && !temporal.end) return 'untimed';
  if (temporal.point) return overlaps(temporal.point, [year, year]) ? temporal.point.earliestYear === temporal.point.latestYear && temporal.certainty !== 'possible' ? 'definite' : 'possible' : 'outside';
  if (temporal.start && temporal.end) {
    if (compareYear(year, temporal.start.earliestYear) < 0 || compareYear(year, temporal.end.latestYear) > 0) return 'outside';
    return compareYear(year, temporal.start.latestYear) >= 0 && compareYear(year, temporal.end.earliestYear) <= 0 && temporal.certainty !== 'possible' ? 'definite' : 'possible';
  }
  const boundary = temporal.start ?? temporal.end!;
  return overlaps(boundary, [year, year]) ? 'possible' : 'outside';
}
function inBounds(longitude: number, latitude: number, bounds: KnowledgeBounds): boolean {
  const longitudeMatches = bounds.west <= bounds.east ? longitude >= bounds.west && longitude <= bounds.east : longitude >= bounds.west || longitude <= bounds.east;
  return longitudeMatches && latitude >= bounds.south && latitude <= bounds.north;
}
/** Coverage counts matching objects, including possible intervals; it does not infer events or continuous existence. */
function coverage(matches: KnowledgeObjectResult[]): KnowledgeCoverage {
  const range = (kind: 'valid-time' | 'value-date'): [number, number] | null => {
    let first = Infinity, last = -Infinity;
    for (const object of matches) for (const observed of object.observedTimes) if (observed.kind === kind) { first = Math.min(first, observed.time.earliestYear); last = Math.max(last, observed.time.latestYear); }
    return Number.isFinite(first) ? [first, last] : null;
  };
  const validTimeRange = range('valid-time'), sourceDateRange = range('value-date'), typeCounts = new Map<string, number>();
  for (const object of matches) for (const type of new Set(object.types)) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  const sorted = [...typeCounts].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const buckets: KnowledgeCoverage['buckets'] = [];
  if (validTimeRange) {
    const start = ordinal(validTimeRange[0]), stop = ordinal(validTimeRange[1]), span = stop - start + 1;
    const step = Math.max(1, Math.ceil(span / 12)), civil = (value: number) => value <= 0 ? value - 1 : value;
    for (let from = start; from <= stop; from += step) {
      const interval: [number, number] = [civil(from), civil(Math.min(stop, from + step - 1))];
      buckets.push({ from: interval[0], to: interval[1], objects: matches.filter(object => object.observedTimes.some(value => value.kind === 'valid-time' && overlaps(value.time, interval))).length });
    }
  }
  const datedObjects = matches.filter(value => value.observedTimes.length).length, locatedObjects = matches.filter(value => value.coordinates.length).length;
  return { matchedObjects: matches.length, datedObjects, undatedObjects: matches.length - datedObjects, locatedObjects, unlocatedObjects: matches.length - locatedObjects,
    validTimeObjects: matches.filter(value => value.observedTimes.some(time => time.kind === 'valid-time')).length, sourceDateObjects: matches.filter(value => value.observedTimes.some(time => time.kind === 'value-date')).length,
    validTimeRange, sourceDateRange, typeCounts: sorted.slice(0,40).map(([typeId,count]) => ({typeId,count})), remainingTypes: Math.max(0,sorted.length-40), untypedObjects: matches.filter(value => !value.types.length).length, buckets };
}
function assertCollection(collection: KnowledgeCollection): void {
  if (collection.schemaVersion !== 1 || !Array.isArray(collection.objects) || !Array.isArray(collection.assertions) || !Array.isArray(collection.sources)) throw new Error('INVALID_KNOWLEDGE_COLLECTION');
  for (const values of [collection.objects, collection.assertions, collection.sources]) if (new Set(values.map(value => value.id)).size !== values.length || values.some(value => typeof value.id !== 'string' || !value.id)) throw new Error('DUPLICATE_KNOWLEDGE_ID');
  const objects = new Set(collection.objects.map(value => value.id)), sources = new Set(collection.sources.map(value => value.id));
  for (const assertion of collection.assertions) {
    if (!objects.has(assertion.subjectId) || !sources.has(assertion.sourceSnapshotId) || assertion.evidence.some(value => !sources.has(value.sourceId)) || !['unreviewed', 'adopted', 'rejected'].includes(assertion.review)) throw new Error('INVALID_KNOWLEDGE_REFERENCE');
    if (assertion.validTime?.certainty !== undefined && assertion.validTime.certainty !== 'possible') throw new Error('INVALID_KNOWLEDGE_TIME_CERTAINTY');
    for (const time of assertionTimes(assertion)) if (!validTime(time.time)) throw new Error('INVALID_KNOWLEDGE_TIME');
    if (assertion.value.kind === 'coordinate' && (!Number.isFinite(assertion.value.longitude) || !Number.isFinite(assertion.value.latitude) || Math.abs(assertion.value.longitude) > 180 || Math.abs(assertion.value.latitude) > 90)) throw new Error('INVALID_KNOWLEDGE_COORDINATE');
  }
}

/** Queries are deterministic projections over supplied content; no source, filesystem or model calls. */
export function createKnowledgeIndex(input: KnowledgeCollection, navigation: ReadonlyMap<string, ReadonlySet<string>> = new Map()) {
  assertCollection(input);
  const collection = clone(input), objects = new Map(collection.objects.map(value => [value.id, value]));
  const bySubject = new Map<string, KnowledgeAssertion[]>();
  for (const assertion of collection.assertions) { const list = bySubject.get(assertion.subjectId) ?? []; list.push(assertion); bySubject.set(assertion.subjectId, list); }
  function resultObject(object: KnowledgeObject, review?: KnowledgeReview[]): KnowledgeObjectResult {
    const assertions = (bySubject.get(object.id) ?? []).filter(assertion => review ? review.includes(assertion.review) : assertion.review !== 'rejected');
    const coordinates: KnowledgeObjectResult['coordinates'] = [], observedTimes: KnowledgeObjectResult['observedTimes'] = [];
    for (const assertion of assertions) {
      if (assertion.value.kind === 'coordinate' && ['earth', 'http://www.wikidata.org/entity/Q2', 'https://www.wikidata.org/entity/Q2'].includes(assertion.value.globe)) coordinates.push({ assertionId: assertion.id, longitude: assertion.value.longitude, latitude: assertion.value.latitude });
      for (const time of assertionTimes(assertion)) observedTimes.push({ assertionId: assertion.id, ...time });
    }
    return { ...object, assertionCount: assertions.length, datedAssertionCount: new Set(observedTimes.map(value => value.assertionId)).size,
      reviewCounts: { adopted: assertions.filter(value => value.review === 'adopted').length, unreviewed: assertions.filter(value => value.review === 'unreviewed').length, rejected: assertions.filter(value => value.review === 'rejected').length }, coordinates, observedTimes };
  }
  function query(options: KnowledgeQuery = {}): KnowledgeQueryResult {
    const offset = options.offset ?? 0, limit = options.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000 || options.time && (!options.time.every(civilYear) || options.time[0] > options.time[1])) throw new Error('INVALID_KNOWLEDGE_QUERY');
    if (options.bounds && (!Object.values(options.bounds).every(Number.isFinite) || Math.abs(options.bounds.west) > 180 || Math.abs(options.bounds.east) > 180 || Math.abs(options.bounds.south) > 90 || Math.abs(options.bounds.north) > 90 || options.bounds.south > options.bounds.north)) throw new Error('INVALID_KNOWLEDGE_QUERY');
    const text = options.text?.trim().normalize('NFKC').toLocaleLowerCase() ?? '';
    if(options.objectIds&&(!Array.isArray(options.objectIds)||options.objectIds.length>1000||!options.objectIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=300)))throw new Error('INVALID_KNOWLEDGE_QUERY');
    if (options.contextIds !== undefined && (!Array.isArray(options.contextIds) || options.contextIds.length > 100 || options.contextIds.some(id => typeof id !== 'string' || !id || !navigation.has(id))) || options.unassigned !== undefined && typeof options.unassigned !== 'boolean' || options.unassigned === true && options.contextIds !== undefined) throw new Error('INVALID_KNOWLEDGE_CONTEXT');
    const objectFocus=options.objectIds?new Set(options.objectIds):null;
    const contextFocus = options.contextIds === undefined ? null : new Set(options.contextIds.flatMap(id => [...navigation.get(id)!]));
    const assigned = options.unassigned ? new Set([...navigation.values()].flatMap(ids => [...ids])) : null;
    let unlocated = 0, undated = 0;
    const matches: KnowledgeObjectResult[] = [];
    for (const object of collection.objects) {
      if(objectFocus&&!objectFocus.has(object.id))continue;
      if (contextFocus && !contextFocus.has(object.id) || assigned?.has(object.id)) continue;
      if (text && ![...Object.values(object.labels), ...Object.values(object.descriptions), ...object.aliases.flatMap(value => Object.values(value))].some(value => value.normalize('NFKC').toLocaleLowerCase().includes(text))) continue;
      if (options.typeIds?.length && !options.typeIds.some(type => object.types.includes(type))) continue;
      const result = resultObject(object, options.review);
      if (!result.coordinates.length) unlocated++;
      if (!result.observedTimes.length) undated++;
      if (options.bounds && (!result.coordinates.length ? !options.includeUnlocated : !result.coordinates.some(value => inBounds(value.longitude, value.latitude, options.bounds!)))) continue;
      if (options.time && (!result.observedTimes.length ? !options.includeUndated : !result.observedTimes.some(value => overlaps(value.time, options.time!)))) continue;
      matches.push(result);
    }
    matches.sort((a, b) => a.id.localeCompare(b.id));
    return clone({ objects: matches.slice(offset, offset + limit), total: matches.length, offset, limit, unlocated, undated, coverage: coverage(matches) });
  }
  function state(options: KnowledgeStateRequest): KnowledgeState {
    if (!objects.has(options.objectId)) throw new Error('KNOWLEDGE_OBJECT_NOT_FOUND');
    if (!civilYear(options.year)) throw new Error('INVALID_KNOWLEDGE_YEAR');
    const assertions = bySubject.get(options.objectId) ?? [];
    const propertyIds = options.propertyIds ?? [...new Set(assertions.map(value => value.propertyId))].sort();
    const fields: KnowledgeStateField[] = propertyIds.map(propertyId => {
      const candidates = assertions.filter(value => value.propertyId === propertyId && (value.review === 'adopted' || options.includeUnreviewed && value.review === 'unreviewed'));
      const applicable = candidates.filter(value => applicability(value, options.year) === 'definite');
      const possible = candidates.filter(value => applicability(value, options.year) === 'possible');
      const values = [...new Map(applicable.map(value => [stable(value.value), value.value])).values()];
      const possibleValues = [...new Map(possible.map(value => [stable(value.value), value.value])).values()];
      const status = values.length > 1 ? 'multiple' : values.length === 1 ? values[0].kind === 'unknown' ? 'unknown' : values[0].kind === 'absent' ? 'absent' : possible.length ? 'uncertain' : 'known' : possible.length ? 'uncertain' : 'unknown';
      return { propertyId, status, assertionIds: applicable.map(value => value.id), values, possibleAssertionIds: possible.map(value => value.id), possibleValues };
    });
    return clone({ objectId: options.objectId, year: options.year, fields, untimedAssertionIds: assertions.filter(value => applicability(value, options.year) === 'untimed' && value.review !== 'rejected').map(value => value.id), unreviewedAssertionIds: assertions.filter(value => value.review === 'unreviewed').map(value => value.id) });
  }
  function diff(a: KnowledgeStateRequest, b: KnowledgeStateRequest): KnowledgeStateDiff {
    const properties = [...new Set([...(a.propertyIds ?? (bySubject.get(a.objectId) ?? []).map(value => value.propertyId)), ...(b.propertyIds ?? (bySubject.get(b.objectId) ?? []).map(value => value.propertyId))])].sort();
    const before = state({ ...a, propertyIds: properties }), after = state({ ...b, propertyIds: properties });
    return { a: before, b: after, fields: properties.map((propertyId, index) => {
      const left = before.fields[index], right = after.fields[index];
      const uncertain = ['unknown', 'uncertain'].includes(left.status) || ['unknown', 'uncertain'].includes(right.status);
      return { propertyId, kind: uncertain ? 'unknown' : stable(left.values.map(stable).sort()) === stable(right.values.map(stable).sort()) ? 'same' : 'changed', before: left, after: right };
    }) };
  }
  function history(options: { objectId: string; propertyIds?: string[]; includeUnreviewed?: boolean }): KnowledgeHistory {
    if (!objects.has(options.objectId)) throw new Error('KNOWLEDGE_OBJECT_NOT_FOUND');
    const assertions = (bySubject.get(options.objectId) ?? []).filter(value => !options.propertyIds?.length || options.propertyIds.includes(value.propertyId));
    const years = new Map<number, { boundary: boolean; assertionIds: Set<string> }>(), exceptions: KnowledgeHistory['exceptions'] = [];
    const add = (year: number, assertionId: string, boundary: boolean) => { const value = years.get(year) ?? { boundary, assertionIds: new Set<string>() }; value.boundary &&= boundary; value.assertionIds.add(assertionId); years.set(year, value); };
    for (const assertion of assertions) {
      if (assertion.review === 'rejected') continue;
      if (assertion.review === 'unreviewed' && !options.includeUnreviewed) { exceptions.push({ assertionId: assertion.id, reason: 'unreviewed' }); continue; }
      const temporal = assertion.validTime;
      if (!temporal || !temporal.start && !temporal.end && !temporal.point) { exceptions.push({ assertionId: assertion.id, reason: 'undated' }); continue; }
      if (!temporal.point && (!temporal.start || !temporal.end)) exceptions.push({ assertionId: assertion.id, reason: 'open-boundary' });
      for (const time of [temporal.start, temporal.end, temporal.point].filter((value): value is KnowledgeTime => !!value)) {
        add(time.earliestYear, assertion.id, false); add(time.latestYear, assertion.id, false);
        if (time.earliestYear !== time.latestYear) exceptions.push({ assertionId: assertion.id, reason: 'uncertain-time' });
      }
      if (temporal.end) { const next = temporal.end.latestYear === -1 ? 1 : temporal.end.latestYear + 1; if (civilYear(next)) add(next, assertion.id, true); }
    }
    const observations: KnowledgeObservation[] = [...years.entries()].sort(([a], [b]) => compareYear(a, b)).map(([year, boundary], index) => {
      const projected = state({ ...options, year }), activeIds = projected.fields.flatMap(field => [...field.assertionIds, ...field.possibleAssertionIds]);
      return { id: `${options.objectId}@${year}`, objectId: options.objectId, year, kind: boundary.boundary && !activeIds.length ? 'coverage-boundary' : index === 0 ? 'baseline' : 'observation', state: projected, sourceAssertionIds: [...new Set([...boundary.assertionIds, ...activeIds])].sort() };
    });
    const changes: KnowledgeHistory['changes'] = [];
    let previous: KnowledgeObservation | null = null;
    for (const b of observations) {
      if (b.kind === 'coverage-boundary' || !b.state.fields.some(field => ['known', 'absent'].includes(field.status))) continue;
      const a = previous; previous = b;
      if (!a) continue;
      const result = diff({ ...options, year: a.year }, { ...options, year: b.year });
      const changed = result.fields.filter(value => value.kind === 'changed' && !['multiple', 'uncertain', 'unknown'].includes(value.before.status) && !['multiple', 'uncertain', 'unknown'].includes(value.after.status));
      if (changed.length) changes.push({ fromObservationId: a.id, toObservationId: b.id, observedBetween: [a.year, b.year], propertyIds: changed.map(value => value.propertyId), kind: 'change-candidate' });
    }
    return clone({ objectId: options.objectId, observations, changes, exceptions });
  }
  return {
    query, state, diff, history,
    object: (id: string): KnowledgeObjectResult | null => objects.has(id) ? clone(resultObject(objects.get(id)!)) : null,
    assertions: (id: string): KnowledgeAssertion[] => clone(bySubject.get(id) ?? []),
    stats: () => ({ objects: collection.objects.length, assertions: collection.assertions.length, sources: collection.sources.length,
      datedAssertions: collection.assertions.filter(value => assertionTimes(value).length > 0).length,
      locatedObjects: collection.objects.filter(value => resultObject(value).coordinates.length > 0).length,
      adoptedAssertions: collection.assertions.filter(value => value.review === 'adopted').length }),
  };
}
