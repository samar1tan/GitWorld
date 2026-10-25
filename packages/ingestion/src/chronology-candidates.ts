import { createHash } from 'node:crypto';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeJson, type KnowledgeObject, type KnowledgeSource, type KnowledgeTemporalScope, type KnowledgeTime, type KnowledgeValue } from '../../domain/src/knowledge.ts';
import { parsePublishedTenure } from './mediawiki-tables.ts';
import { createBindingSource, matchesBindingSource, type BindingSourceIdentity, type SourceBindingPlan } from './source-bindings.ts';
import { canonicalSourceJson } from './wikidata.ts';
import type { JsonValue } from './source-types.ts';

export const CHRONOLOGY_CANDIDATE_VERSION = 'published-chronology-candidates-v1';
export type ChronologyColumn = { header: string; kind: 'calendar-range' | 'duration'; bce?: boolean; calendar: string };
export type ChronologyScope = { sourceScopeId: string; targetSubjectId: string; targetPropertyId: string; targetType: string };
export type PublishedChronologyRow = {
  id: string; sourceAssertionId: string; memberPropertyId: string; source: BindingSourceIdentity; upstreamSnapshotHash: string;
  scope: ChronologyScope; column: ChronologyColumn; dateText: string;
  sourceUrl: string; sourceLocator: string; sourceOrder?: number;
};
export type ChronologyCandidatePlan = Pick<SourceBindingPlan, 'schemaVersion' | 'id' | 'revision' | 'preparedAt' | 'url' | 'rights'> & { rows: PublishedChronologyRow[] };
export type ChronologyCandidateIssue = { code: 'SOURCE_CLAIM_NOT_FOUND' | 'SOURCE_REVISION_MISMATCH' | 'SOURCE_HASH_MISMATCH' | 'SOURCE_SCOPE_MISMATCH' | 'REJECTED_SOURCE_CLAIM' | 'TARGET_NOT_FOUND' | 'TARGET_TYPE_MISMATCH' | 'DURATION_WITHOUT_CALENDAR' | 'UNPARSED_CHRONOLOGY' | 'CANDIDATE_CONFLICT'; rowId: string; assertionId?: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown) => canonicalSourceJson(JSON.parse(JSON.stringify(value)) as JsonValue);
const record = (value: KnowledgeJson | undefined): value is { [key: string]: KnowledgeJson } => !!value && typeof value === 'object' && !Array.isArray(value);

/** Reads explicitly declared source columns; it never derives years from reign lengths. */
export function collectPublishedChronologyRows(input: KnowledgeCollection, options: { source: BindingSourceIdentity; memberPropertyId: string; qualifierPropertyId: string; scopes: ChronologyScope[]; columns: ChronologyColumn[] }): PublishedChronologyRow[] {
  createKnowledgeIndex(input);
  if (!options.memberPropertyId || !options.qualifierPropertyId || new Set(options.columns.map(value => value.header)).size !== options.columns.length || new Set(options.scopes.map(value => value.sourceScopeId)).size !== options.scopes.length || options.columns.some(value => value.kind === 'calendar-range' && /\b(?:length|duration)\b/i.test(value.header))) throw new Error('INVALID_CHRONOLOGY_COLUMNS');
  const sources = new Map(input.sources.filter(value => matchesBindingSource(value, options.source)).map(value => [value.id, value])), rows: PublishedChronologyRow[] = [];
  for (const assertion of input.assertions) {
    if (!sources.has(assertion.sourceSnapshotId) || assertion.propertyId !== options.memberPropertyId || assertion.value.kind !== 'entity') continue;
    const scopeId = assertion.value.objectId, scope = options.scopes.find(value => value.sourceScopeId === scopeId); if (!scope) continue;
    const source = sources.get(assertion.sourceSnapshotId)!, alternatives = assertion.qualifiers.find(value => value.propertyId === options.qualifierPropertyId)?.value;
    if (alternatives?.kind !== 'raw' || !Array.isArray(alternatives.value)) continue;
    const locator = assertion.qualifiers.find(value => value.propertyId === 'source:table-locator')?.value, sourceLocator = locator?.kind === 'text' ? locator.value : assertion.evidence[0]?.locator ?? '';
    const sourceOrder = sourceLocator.match(/(?:^|;)row:(\d+)(?:;|$)/)?.[1];
    for (const value of alternatives.value) {
      if (!record(value) || typeof value.header !== 'string' || typeof value.text !== 'string') continue;
      const column = options.columns.find(column => column.header === value.header); if (!column) continue;
      rows.push({ id: digest(`${assertion.id}:${value.column}:${value.header}`).slice(0, 40), sourceAssertionId: assertion.id, memberPropertyId: options.memberPropertyId, source: structuredClone(options.source), upstreamSnapshotHash: source.contentHash, scope: structuredClone(scope), column: structuredClone(column), dateText: value.text, sourceUrl: source.revisionUrl ?? source.url, sourceLocator: `${sourceLocator};chronology-column:${value.column}`, ...(sourceOrder !== undefined ? { sourceOrder: Number(sourceOrder) } : {}) });
    }
  }
  return rows;
}

/** Retains an untimed source date as a separate candidate rather than dropping the row. */
export function collectPublishedSingleChronologyRows(input: KnowledgeCollection, options: { source: BindingSourceIdentity; memberPropertyId: string; timeQualifierId: string; excludeQualifierId?: string; scopes: ChronologyScope[]; column: ChronologyColumn }): PublishedChronologyRow[] {
  createKnowledgeIndex(input);
  if (!options.memberPropertyId || !options.timeQualifierId || !options.column.header || !options.column.calendar || options.column.kind === 'calendar-range' && /\b(?:length|duration)\b/i.test(options.column.header)) throw new Error('INVALID_CHRONOLOGY_COLUMNS');
  const sources = new Map(input.sources.filter(value => matchesBindingSource(value, options.source)).map(value => [value.id, value])), rows: PublishedChronologyRow[] = [];
  for (const assertion of input.assertions) {
    if (!sources.has(assertion.sourceSnapshotId) || assertion.propertyId !== options.memberPropertyId || assertion.value.kind !== 'entity' || assertion.validTime || options.excludeQualifierId && assertion.qualifiers.some(value => value.propertyId === options.excludeQualifierId)) continue;
    const scopeId = assertion.value.objectId, scope = options.scopes.find(value => value.sourceScopeId === scopeId), date = assertion.qualifiers.find(value => value.propertyId === options.timeQualifierId)?.value;
    if (!scope || date?.kind !== 'text') continue;
    const source = sources.get(assertion.sourceSnapshotId)!, locator = assertion.qualifiers.find(value => value.propertyId === 'source:table-locator')?.value, sourceLocator = locator?.kind === 'text' ? locator.value : assertion.evidence[0]?.locator ?? '', sourceOrder = sourceLocator.match(/(?:^|;)row:(\d+)(?:;|$)/)?.[1];
    rows.push({ id: digest(`${assertion.id}:${options.timeQualifierId}:${options.column.header}`).slice(0, 40), sourceAssertionId: assertion.id, memberPropertyId: options.memberPropertyId, source: structuredClone(options.source), upstreamSnapshotHash: source.contentHash, scope: structuredClone(scope), column: structuredClone(options.column), dateText: date.value, sourceUrl: source.revisionUrl ?? source.url, sourceLocator, ...(sourceOrder !== undefined ? { sourceOrder: Number(sourceOrder) } : {}) });
  }
  return rows;
}

function candidateInterval(text: string, column: ChronologyColumn) {
  const options = { bce: column.bce, calendar: column.calendar }, parsed = parsePublishedTenure(text, options);
  if (parsed.validTime || !/\b(?:circa|early|late)\b|\bc\./i.test(text) || /\b(?:fl|or|before|after)\b|\?/i.test(text)) return { ...parsed, qualified: false };
  const cleaned = text.replace(/\b(?:circa|early|late)\s*|\bc\.\s*/gi, ''), candidate = parsePublishedTenure(cleaned, options);
  if (candidate.validTime?.start && candidate.validTime.end) for (const time of [candidate.validTime.start, candidate.validTime.end]) { time.precision = 'broader'; time.raw = text; }
  return { ...candidate, qualified: true };
}

function upstreamHash(source: KnowledgeSource, hash: string): boolean {
  return source.contentHash === hash || record(source.record) && record(source.record.manifest) && source.record.manifest.upstreamSnapshotHash === hash;
}

/** Retains full candidate intervals while exposing only conservative possible membership to state queries. */
export function projectChronologyCandidates(input: KnowledgeCollection, plan: ChronologyCandidatePlan) {
  createKnowledgeIndex(input);
  if (!Array.isArray(plan.rows) || new Set(plan.rows.map(value => value.id)).size !== plan.rows.length || plan.rows.some(value => !value.id || !value.sourceAssertionId || !value.memberPropertyId || !value.scope.targetSubjectId || !value.scope.targetPropertyId || !value.scope.targetType || !value.column.header || !value.column.calendar || !['calendar-range', 'duration'].includes(value.column.kind) || value.column.kind === 'calendar-range' && /\b(?:length|duration)\b/i.test(value.column.header) || typeof value.dateText !== 'string' || !value.sourceUrl || !value.sourceLocator || !value.upstreamSnapshotHash || value.sourceOrder !== undefined && (!Number.isSafeInteger(value.sourceOrder) || value.sourceOrder < 0))) throw new Error('INVALID_CHRONOLOGY_PLAN');
  const source = createBindingSource(plan, { schemaVersion: 1, id: plan.id, revision: plan.revision, mappingVersion: CHRONOLOGY_CANDIDATE_VERSION, rows: plan.rows } as unknown as KnowledgeJson);
  const collection = structuredClone(input), objects = new Map(collection.objects.map(value => [value.id, value])), assertions = new Map(collection.assertions.map(value => [value.id, value])), sources = new Map(collection.sources.map(value => [value.id, value])), originals = new Map(input.assertions.map(value => [value.id, value]));
  const issues: ChronologyCandidateIssue[] = [], candidates: { rowId: string; objectId: string; interval?: KnowledgeTemporalScope; possibleAssertionId?: string }[] = [];
  const priorSource = sources.get(source.id);
  if (priorSource && stable({ ...priorSource, retrievedAt: '' }) !== stable({ ...source, retrievedAt: '' })) return { collection, sourceId: source.id, mappingVersion: CHRONOLOGY_CANDIDATE_VERSION, candidates, issues: [{ code: 'CANDIDATE_CONFLICT' as const, rowId: plan.id }] };
  if (!priorSource) { collection.sources.push(source); sources.set(source.id, source); }
  for (const [rowIndex, row] of plan.rows.entries()) {
    const original = originals.get(row.sourceAssertionId), origin = original ? sources.get(original.sourceSnapshotId) : undefined;
    if (!original || !origin) { issues.push({ code: 'SOURCE_CLAIM_NOT_FOUND', rowId: row.id, assertionId: row.sourceAssertionId }); continue; }
    if (!matchesBindingSource(origin, row.source)) { issues.push({ code: 'SOURCE_REVISION_MISMATCH', rowId: row.id, assertionId: original.id }); continue; }
    if (!upstreamHash(origin, row.upstreamSnapshotHash)) { issues.push({ code: 'SOURCE_HASH_MISMATCH', rowId: row.id }); continue; }
    if (original.propertyId !== row.memberPropertyId || original.value.kind !== 'entity' || original.value.objectId !== row.scope.sourceScopeId) { issues.push({ code: 'SOURCE_SCOPE_MISMATCH', rowId: row.id, assertionId: original.id }); continue; }
    if (original.review === 'rejected') { issues.push({ code: 'REJECTED_SOURCE_CLAIM', rowId: row.id, assertionId: original.id }); continue; }
    const target = objects.get(row.scope.targetSubjectId);
    if (!target) { issues.push({ code: 'TARGET_NOT_FOUND', rowId: row.id }); continue; }
    if (!target.types.includes(row.scope.targetType)) { issues.push({ code: 'TARGET_TYPE_MISMATCH', rowId: row.id }); continue; }
    const holder = objects.get(original.subjectId), objectId = `chronology-candidate:${plan.id}:${row.id}`;
    const object: KnowledgeObject = { id: objectId, identities: [{ provider: 'gitworld-published-chronology-cell', externalId: `${plan.id}:${row.id}` }], labels: { en: `${holder?.labels.en ?? original.subjectId} · ${row.column.header}` }, descriptions: {}, aliases: [], types: ['gitworld:chronology-candidate'] };
    const priorObject = objects.get(objectId);
    if (priorObject && stable(priorObject) !== stable(object)) { issues.push({ code: 'CANDIDATE_CONFLICT', rowId: row.id }); continue; }
    if (!priorObject) { collection.objects.push(object); objects.set(objectId, object); }
    const qualifiers = [...structuredClone(original.qualifiers), { propertyId: 'binding:derived-from', value: { kind: 'text' as const, value: original.id } }, { propertyId: 'chronology:rule', value: { kind: 'text' as const, value: `${plan.id}@${plan.revision}` } }, { propertyId: 'chronology:source-column', value: { kind: 'text' as const, value: row.column.header } }, { propertyId: 'chronology:source-locator', value: { kind: 'text' as const, value: row.sourceLocator } }];
    const add = (propertyId: string, value: KnowledgeValue, subjectId = objectId, validTime?: KnowledgeTemporalScope): string | undefined => {
      const assertion: KnowledgeAssertion = { id: `chronology-projection:${digest(`${plan.id}:${row.id}:${subjectId}:${propertyId}`).slice(0, 40)}`, subjectId, propertyId, value, qualifiers: structuredClone(qualifiers), evidence: [...structuredClone(original.evidence), { sourceId: source.id, locator: `$.rows[${rowIndex}]`, url: row.sourceUrl }], sourceSnapshotId: original.sourceSnapshotId, review: 'unreviewed', ...(validTime ? { validTime: structuredClone(validTime) } : {}) };
      const prior = assertions.get(assertion.id);
      if (prior && stable(prior) !== stable(assertion)) { issues.push({ code: 'CANDIDATE_CONFLICT', rowId: row.id, assertionId: assertion.id }); return undefined; }
      if (!prior) { collection.assertions.push(assertion); assertions.set(assertion.id, assertion); }
      return assertion.id;
    };
    add('chronology:holder', { kind: 'entity', objectId: original.subjectId }); add('chronology:scope', { kind: 'entity', objectId: target.id }); add('chronology:published-date-text', { kind: 'text', value: row.dateText }); add('chronology:source-column', { kind: 'text', value: row.column.header });
    if (row.sourceOrder !== undefined) add('chronology:source-order', { kind: 'number', value: row.sourceOrder });
    const candidate: typeof candidates[number] = { rowId: row.id, objectId }; candidates.push(candidate);
    if (row.column.kind === 'duration') { issues.push({ code: 'DURATION_WITHOUT_CALENDAR', rowId: row.id }); continue; }
    const parsed = candidateInterval(row.dateText, row.column);
    if (!parsed.validTime?.start || !parsed.validTime.end || parsed.issue) {
      issues.push({ code: 'UNPARSED_CHRONOLOGY', rowId: row.id });
      const qualified = row.dateText.replace(/\s+/g, ' ').trim().match(/^(?:fl\.\s*)?c\.\s*(\d{1,4})$/i);
      if (qualified && Number(qualified[1])) { const year = Number(qualified[1]) * (row.column.bce ? -1 : 1); add('chronology:reported-approximate-year', { kind: 'time', value: { earliestYear: year, latestYear: year, precision: 'broader', calendar: row.column.calendar, raw: row.dateText } }); }
      const pieces = row.dateText.split('(')[0].replace(/\s+/g, ' ').trim().split(/\s*[–—−-]\s*/);
      if (pieces.length === 2 && pieces.some(value => !value || value === '?')) for (const [side, value] of pieces.entries()) {
        const partial = parsePublishedTenure(value, { bce: row.column.bce, calendar: row.column.calendar });
        if (partial.validTime?.start && !partial.issue) add(side === 0 ? 'chronology:reported-start' : 'chronology:reported-end', { kind: 'time', value: { ...partial.validTime.start, raw: row.dateText } });
      }
      continue;
    }
    if (parsed.qualified) qualifiers.push({ propertyId: 'chronology:date-qualification', value: { kind: 'text', value: 'source-qualified-date-retained-no-invented-margin-or-exact-accession' } });
    candidate.interval = parsed.validTime;
    add('chronology:interval-start', { kind: 'time', value: parsed.validTime.start }); add('chronology:interval-end', { kind: 'time', value: parsed.validTime.end });
    const first = parsed.validTime.start.earliestYear, last = parsed.validTime.end.latestYear;
    const envelope: KnowledgeTime = { earliestYear: first, latestYear: last, precision: 'interval', calendar: row.column.calendar, raw: row.dateText };
    add('chronology:published-interval', { kind: 'time', value: envelope });
    qualifiers.push({ propertyId: 'chronology:projection-semantics', value: { kind: 'text', value: 'possible-applicability-throughout-published-candidate-interval-not-confirmed-tenure-or-a-single-event' } });
    candidate.possibleAssertionId = add(row.scope.targetPropertyId, { kind: 'entity', objectId: original.subjectId }, target.id, { ...structuredClone(parsed.validTime), certainty: 'possible' });
  }
  createKnowledgeIndex(collection);
  return { collection, sourceId: source.id, mappingVersion: CHRONOLOGY_CANDIDATE_VERSION, candidates, issues };
}
