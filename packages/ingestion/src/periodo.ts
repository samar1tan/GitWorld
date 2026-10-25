import { createHash } from 'node:crypto';
import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeQualifier, KnowledgeTemporalScope, KnowledgeText, KnowledgeTime } from '../../domain/src/knowledge.ts';
import { canonicalSourceJson } from './wikidata.ts';
import type { JsonValue } from './source-types.ts';

export const PERIODO_MAPPING_VERSION = 'periodo-definitions-v1';
export const PERIODO_DATASET = 'https://data.perio.do/d.json';
export type PeriodOSource = { url: string; revision: string; retrievedAt: string; contentHash: string };
export type PeriodOMappingIssue = { code: 'INVALID_AUTHORITY' | 'INVALID_PERIOD' | 'UNMAPPED_TIME' | 'REVERSED_INTERVAL' | 'OPEN_LABEL_CLOSED_RANGE'; id: string };
export type PeriodOAuthorityRights = { redistribution: 'allowed' | 'restricted' | 'unknown'; evidenceUrl: string; note?: string };
export type PeriodOMappingOptions = { authorityIds?: string[]; spatialIds?: string[]; excludeAuthorityIds?: string[]; authorityRights?: Record<string, PeriodOAuthorityRights>; startRecord?: number; limit?: number };
export type PeriodOMappingResult = {
  collection: KnowledgeCollection; issues: PeriodOMappingIssue[];
  report: { totalAuthorities: number; totalPeriods: number; selected: number; nextRecord: number | null; mappingVersion: typeof PERIODO_MAPPING_VERSION };
};
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const array = (value: unknown): JsonValue[] => Array.isArray(value) ? value : [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const text = (propertyId: string, value: string): KnowledgeQualifier => ({ propertyId, value: { kind: 'text', value } });

/** PeriodO uses XSD astronomical years: 0000 = 1 BCE, -0001 = 2 BCE. */
export function mapPeriodOYear(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[+-]?\d{1,16}$/.test(raw)) return null;
  const astronomical = Number(raw), civil = astronomical <= 0 ? astronomical - 1 : astronomical;
  return Number.isSafeInteger(civil) && civil !== 0 ? civil : null;
}
function boundary(raw: unknown): KnowledgeTime | null {
  if (!object(raw) || !object(raw.in)) return null;
  const first = mapPeriodOYear(raw.in.earliestYear ?? raw.in.year), last = mapPeriodOYear(raw.in.latestYear ?? raw.in.year);
  if (first === null || last === null || first > last) return null;
  return { earliestYear: first, latestYear: last, precision: first === last ? 'year' : 'interval', calendar: 'proleptic-gregorian-xsd-gYear', raw: canonicalSourceJson(raw.in) };
}
function spatialId(value: JsonValue): string | null {
  if (!object(value) || typeof value.id !== 'string') return null;
  const match = value.id.match(/^https?:\/\/www.wikidata.org\/entity\/(Q[1-9]\d*)$/);
  return match ? `wikidata:${match[1]}` : value.id;
}

/** Source-specific period definitions remain distinct; they are not polity identities or lifespans. */
export function mapPeriodODocument(document: unknown, source: PeriodOSource, options: PeriodOMappingOptions = {}): PeriodOMappingResult {
  if (!object(document) || !object(document.authorities) || source.url !== PERIODO_DATASET || !source.revision || !/^[a-f0-9]{64}$/.test(source.contentHash) || !Number.isFinite(Date.parse(source.retrievedAt))) throw new Error('INVALID_PERIODO_DOCUMENT');
  const startRecord = options.startRecord ?? 0, limit = options.limit ?? 1000;
  if (!Number.isSafeInteger(startRecord) || startRecord < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('INVALID_PERIODO_REQUEST');
  const collection: KnowledgeCollection = { schemaVersion: 1, objects: [], assertions: [], sources: [] }, issues: PeriodOMappingIssue[] = [];
  const rows = Object.entries(document.authorities).flatMap(([authorityId, authority]) => object(authority) && object(authority.periods) ? Object.entries(authority.periods).map(([id, period]) => ({ authorityId, authority, id, period })) : (issues.push({ code: 'INVALID_AUTHORITY', id: authorityId }), []));
  let selected = 0, nextRecord: number | null = null;
  for (const [position, row] of rows.entries()) {
    if (position < startRecord || options.excludeAuthorityIds?.includes(row.authorityId) || options.authorityIds?.length && !options.authorityIds.includes(row.authorityId)) continue;
    const { id, authorityId, authority, period } = row;
    if (!object(period) || period.id !== id || typeof period.label !== 'string' || !/^p0[a-z0-9]{9}$/.test(id)) { issues.push({ code: 'INVALID_PERIOD', id }); continue; }
    const spatial = array(period.spatialCoverage).flatMap((value, index) => { const id = spatialId(value); return id ? [{ id, index }] : []; });
    if (options.spatialIds?.length && !options.spatialIds.some(id => spatial.some(value => value.id === id))) continue;
    const subjectId = `periodo:${id}`, payload = { authority: { id: authorityId, source: authority.source ?? null, ...(authority.editorialNote ? { editorialNote: authority.editorialNote } : {}) }, period }, contentHash = hash(canonicalSourceJson(payload)), sourceId = `periodo:${id}@${contentHash}`;
    const declaredRights = options.authorityRights?.[authorityId];
    if (declaredRights && (!['allowed', 'restricted', 'unknown'].includes(declaredRights.redistribution) || !/^https?:\/\//.test(declaredRights.evidenceUrl))) throw new Error('INVALID_PERIODO_AUTHORITY_RIGHTS');
    const authorityRights: PeriodOAuthorityRights = declaredRights ?? (authorityId === 'p0fp7wv' ? { redistribution: 'restricted', evidenceUrl: 'https://chgis.fas.harvard.edu/data/chgis/v6/', note: 'Known upstream CHGIS redistribution restriction; an aggregate license is not sufficient clearance.' } : { redistribution: 'unknown', evidenceUrl: 'https://perio.do/license/', note: 'PeriodO declares CC0; this bibliographic authority has not been independently cleared for a public preset.' });
    const labels: KnowledgeText = {}, aliases: KnowledgeText[] = [];
    if (object(period.localizedLabels)) for (const [language, values] of Object.entries(period.localizedLabels)) {
      const strings = array(values).filter((value): value is string => typeof value === 'string');
      if (strings[0]) labels[language] = strings[0]; for (const value of strings.slice(1)) aliases.push({ [language]: value });
    }
    const sourceLanguage = typeof period.languageTag === 'string' ? period.languageTag : 'und';
    if (!labels[sourceLanguage]) labels[sourceLanguage] = period.label;
    collection.objects.push({ id: subjectId, identities: [{ provider: 'periodo', externalId: id }], labels, descriptions: {}, aliases, types: ['periodo:period-definition'] });
    collection.sources.push({ id: sourceId, identity: { provider: 'periodo', externalId: id }, revision: source.revision, contentHash, retrievedAt: source.retrievedAt, url: `https://n2t.net/ark:/99152/${id}`, adapterVersion: PERIODO_MAPPING_VERSION,
      rights: { ...(authorityRights.redistribution === 'allowed' ? { licenseId: 'CC0-1.0' } : {}), licenseUrl: authorityRights.evidenceUrl, redistribution: authorityRights.redistribution, attribution: 'PeriodO contributors. The original bibliographic authority and period definition are retained; GitWorld normalizes XSD years to civil BCE numbering.' }, record: payload });
    const start = boundary(period.start), stop = boundary(period.stop);
    if (!start || !stop) issues.push({ code: 'UNMAPPED_TIME', id });
    const reversed = !!start && !!stop && start.earliestYear > stop.latestYear;
    if (reversed) issues.push({ code: 'REVERSED_INTERVAL', id });
    const openLabel = /\d{3,}[-–—]\s*$/.test(period.label);
    if (openLabel && stop) issues.push({ code: 'OPEN_LABEL_CLOSED_RANGE', id });
    const scope: KnowledgeTemporalScope | undefined = start && stop && !reversed && !openLabel ? { start, end: stop } : undefined;
    const qualifiers: KnowledgeQualifier[] = [text('periodo:authority', authorityId), text('periodo:dataset-hash', source.contentHash), text('periodo:temporal-semantics', 'published-period-definition-not-polity-lifespan'), text('periodo:authority-rights-status', authorityRights.redistribution), text('periodo:authority-rights-evidence', authorityRights.evidenceUrl)];
    if (object(period.start) && typeof period.start.label === 'string') qualifiers.push(text('periodo:source-start-label', period.start.label));
    if (object(period.stop) && typeof period.stop.label === 'string') qualifiers.push(text('periodo:source-stop-label', period.stop.label));
    const add = (propertyId: string, value: KnowledgeAssertion['value'], locator: string, validTime?: KnowledgeTemporalScope, extra: KnowledgeQualifier[] = []) => collection.assertions.push({ id: `${subjectId}:${propertyId}:${hash(canonicalSourceJson(value as unknown as JsonValue)).slice(0, 16)}`, subjectId, propertyId, value, qualifiers: [...structuredClone(qualifiers), ...extra], evidence: [{ sourceId, locator }], sourceSnapshotId: sourceId, review: 'unreviewed', ...(validTime ? { validTime } : {}) });
    if (start) add('periodo:definition-start', { kind: 'time', value: start }, '$.period.start');
    if (stop) add('periodo:definition-stop', { kind: 'time', value: stop }, '$.period.stop');
    add('periodo:definition-label', { kind: 'text', value: period.label, language: sourceLanguage }, '$.period.label', scope);
    for (const { index, id } of spatial) add('periodo:definition-spatial-scope', { kind: 'entity', objectId: id }, `$.period.spatialCoverage[${index}]`, scope, [text('periodo:spatial-semantics', 'source-spatial-lookup-not-ancient-polity-membership')]);
    if (period.broader && typeof period.broader === 'string') add('periodo:broader-definition', { kind: 'entity', objectId: `periodo:${period.broader}` }, '$.period.broader');
    if (typeof period.spatialCoverageDescription === 'string') add('periodo:source-spatial-description', { kind: 'text', value: period.spatialCoverageDescription, language: sourceLanguage }, '$.period.spatialCoverageDescription');
    selected++;
    if (selected >= limit) { nextRecord = position + 1 < rows.length ? position + 1 : null; break; }
  }
  return { collection, issues, report: { totalAuthorities: Object.keys(document.authorities).length, totalPeriods: rows.length, selected, nextRecord, mappingVersion: PERIODO_MAPPING_VERSION } };
}
