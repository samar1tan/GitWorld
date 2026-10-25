import { createHash } from 'node:crypto';
import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeObject, KnowledgeQualifier, KnowledgeSource, KnowledgeTemporalScope, KnowledgeText } from '../../domain/src/knowledge.ts';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';

export const OFFICE_PROJECTION_VERSION = 'office-tenures-v1';
export type OfficeListRule = {
  id: string; listId: string; memberPropertyId: string; officeId: string; jurisdictionId?: string;
  /** The rule's interpretation of this list must be inspectable, not guessed from a title. */
  evidenceUrl: string;
};
export type OfficePositionRule = { id: string; heldPropertyId: string; jurisdictionPropertyId?: string; evidenceUrl: string };
export type OfficeReviewFlag = {
  id: string; code: string; evidenceUrl: string;
  assertionId?: string; objectId?: string; ruleId?: string; beforeYear?: number;
};
export type OfficeProjectionPolicy = { version: string; flags: OfficeReviewFlag[] };
export type OfficeProjectionException = {
  assertionId: string;
  code: 'MISSING_TIME' | 'OPEN_TIME' | 'MISSING_OFFICE' | 'AMBIGUOUS_JURISDICTION' | 'NEEDS_JURISDICTION' | 'UNREFERENCED' | 'DEPRECATED' | 'SOURCE_QUALIFICATION' | 'POLICY_REVIEW_REQUIRED' | 'SUBYEAR_PRECISION';
  details?: string;
};
export type OfficeTenure = {
  assertionId: string; derivedFrom: string; officeId: string; holderId: string; subjectId: string;
  jurisdictionId: string | null; sourceSnapshotId: string; ruleId: string; validTime: KnowledgeTemporalScope;
};
export type OfficeProjectionResult = {
  collection: KnowledgeCollection; tenures: OfficeTenure[]; exceptions: OfficeProjectionException[];
  mappingVersion: typeof OFFICE_PROJECTION_VERSION;
};
export type OfficeTenureRow = {
  id: string;
  holder: { id: string; labels: KnowledgeText };
  office: { id: string; labels: KnowledgeText };
  jurisdiction?: { id: string; labels: KnowledgeText };
  validTime?: KnowledgeTemporalScope;
  locator: string;
  qualifiers?: KnowledgeQualifier[];
  reviewFlags?: string[];
};
const key = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const textQualifier = (propertyId: string, value: string): KnowledgeQualifier => ({ propertyId, value: { kind: 'text', value } });
const entityQualifier = (propertyId: string, objectId: string): KnowledgeQualifier => ({ propertyId, value: { kind: 'entity', objectId } });
const url = (value: string) => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
const timeValues = (scope: KnowledgeTemporalScope) => [scope.start, scope.end, scope.point].filter(value => !!value);

/** A stable analytical scope, not an assertion that two political institutions are identical. */
export function officeScopeId(officeId: string, jurisdictionId?: string): string {
  return jurisdictionId ? `office-scope:${key(JSON.stringify([officeId, jurisdictionId]))}` : officeId;
}

/**
 * Reverses explicitly dated position claims and declared list-member rules into
 * office-holder state assertions. Original records, statements and identities remain intact.
 */
export function projectOfficeTenures(input: KnowledgeCollection, options: { listRules?: OfficeListRule[]; positionRules?: OfficePositionRule[]; policy?: OfficeProjectionPolicy } = {}): OfficeProjectionResult {
  createKnowledgeIndex(input);
  const rules = options.listRules ?? [], policy = options.policy;
  const positionRules: OfficePositionRule[] = [{ id: 'wikidata-position-held-inverse', heldPropertyId: 'wikidata:P39', jurisdictionPropertyId: 'wikidata:P1001', evidenceUrl: 'https://www.wikidata.org/wiki/Property:P39' }, ...(options.positionRules ?? [])];
  if (new Set(rules.map(rule => rule.id)).size !== rules.length || rules.some(rule => !rule.id || !rule.listId || !rule.memberPropertyId || !rule.officeId || !url(rule.evidenceUrl))) throw new Error('INVALID_OFFICE_RULE');
  if (new Set(positionRules.map(rule => rule.id)).size !== positionRules.length || positionRules.some(rule => !rule.id || !rule.heldPropertyId || !url(rule.evidenceUrl))) throw new Error('INVALID_OFFICE_RULE');
  if (policy && (!policy.version || !Array.isArray(policy.flags) || policy.flags.some(flag => !flag.id || !flag.code || !url(flag.evidenceUrl) || !flag.assertionId && !flag.objectId && !flag.ruleId || flag.beforeYear !== undefined && (!Number.isSafeInteger(flag.beforeYear) || flag.beforeYear === 0)))) throw new Error('INVALID_OFFICE_POLICY');
  const collection = structuredClone(input), objects = new Map(collection.objects.map(object => [object.id, object]));
  const assertionIds = new Set(collection.assertions.map(assertion => assertion.id)), tenures: OfficeTenure[] = [], exceptions: OfficeProjectionException[] = [];
  const addException = (assertionId: string, code: OfficeProjectionException['code'], details?: string) => exceptions.push({ assertionId, code, ...(details ? { details } : {}) });
  function ensureOffice(officeId: string, jurisdictionId?: string) {
    const subjectId = officeScopeId(officeId, jurisdictionId);
    if (objects.has(subjectId)) return subjectId;
    const office = objects.get(officeId);
    const object: KnowledgeObject = {
      id: subjectId,
      identities: [{ provider: jurisdictionId ? 'office-scope' : 'unresolved-office', externalId: jurisdictionId ? JSON.stringify([officeId, jurisdictionId]) : officeId }],
      labels: office ? structuredClone(office.labels) : {}, descriptions: {}, aliases: [],
      types: [jurisdictionId ? 'gitworld:office-in-jurisdiction' : 'gitworld:office'],
    };
    collection.objects.push(object); objects.set(subjectId, object);
    return subjectId;
  }
  function add(original: KnowledgeAssertion, holderId: string, officeId: string, jurisdictionId: string | undefined, rule: { id: string; evidenceUrl: string }) {
    if (!original.validTime || !timeValues(original.validTime).length) { addException(original.id, 'MISSING_TIME'); return; }
    if (original.validTime.point === undefined && (!original.validTime.start || !original.validTime.end)) addException(original.id, 'OPEN_TIME');
    if (timeValues(original.validTime).some(value => value!.precision === 'month' || value!.precision === 'day')) addException(original.id, 'SUBYEAR_PRECISION', 'Year projection retains all claims; it does not order appointments within a year.');
    if (!jurisdictionId) addException(original.id, 'NEEDS_JURISDICTION');
    if (!objects.has(officeId)) addException(original.id, 'MISSING_OFFICE', officeId);
    if (input.sources.find(source => source.id === original.sourceSnapshotId)?.identity.provider === 'wikidata' && original.evidence.length <= 1) addException(original.id, 'UNREFERENCED');
    if (original.rank === 'deprecated') addException(original.id, 'DEPRECATED');
    if (original.qualifiers.some(qualifier => ['wikidata:P1480', 'wikidata:P5102', 'source:review-flag'].includes(qualifier.propertyId))) addException(original.id, 'SOURCE_QUALIFICATION');
    const flags = (policy?.flags ?? []).filter(flag =>
      (!flag.assertionId || flag.assertionId === original.id) &&
      (!flag.objectId || [original.subjectId, holderId, officeId, jurisdictionId].includes(flag.objectId)) &&
      (!flag.ruleId || flag.ruleId === rule.id) &&
      (flag.beforeYear === undefined || timeValues(original.validTime!).some(value => value!.earliestYear < flag.beforeYear!)));
    for (const flag of flags) addException(original.id, 'POLICY_REVIEW_REQUIRED', `${flag.id}:${flag.code}`);
    const subjectId = ensureOffice(officeId, jurisdictionId), assertionId = `office-projection:${key(JSON.stringify([OFFICE_PROJECTION_VERSION, rule.id, original.id, officeId, jurisdictionId ?? null]))}`;
    if (assertionIds.has(assertionId)) return;
    const derived: KnowledgeAssertion = {
      ...structuredClone(original), id: assertionId, subjectId, propertyId: 'office:holder', value: { kind: 'entity', objectId: holderId }, review: 'unreviewed',
      qualifiers: [
        ...structuredClone(original.qualifiers),
        textQualifier('projection:version', OFFICE_PROJECTION_VERSION), textQualifier('projection:rule-id', rule.id),
        textQualifier('projection:derived-from', original.id), textQualifier('projection:rule-evidence', rule.evidenceUrl),
        entityQualifier('office:position', officeId),
        ...(jurisdictionId ? [entityQualifier('office:jurisdiction', jurisdictionId)] : []),
        ...(policy ? [textQualifier('projection:policy-version', policy.version)] : []),
        ...flags.flatMap(flag => [textQualifier('projection:review-flag', `${flag.id}:${flag.code}`), textQualifier('projection:review-evidence', flag.evidenceUrl)]),
      ],
    };
    collection.assertions.push(derived); assertionIds.add(assertionId);
    tenures.push({ assertionId, derivedFrom: original.id, officeId, holderId, subjectId, jurisdictionId: jurisdictionId ?? null, sourceSnapshotId: original.sourceSnapshotId, ruleId: rule.id, validTime: structuredClone(original.validTime) });
  }
  for (const assertion of input.assertions) {
    if (assertion.review === 'rejected' || assertion.value.kind !== 'entity') continue;
    if (assertion.propertyId === 'wikidata:P1308') {
      const jurisdictions = [...new Set(assertion.qualifiers.flatMap(qualifier => qualifier.propertyId === 'wikidata:P1001' && qualifier.value.kind === 'entity' ? [qualifier.value.objectId] : []))];
      if (jurisdictions.length > 1) addException(assertion.id, 'AMBIGUOUS_JURISDICTION');
      else add(assertion, assertion.value.objectId, assertion.subjectId, jurisdictions[0], { id: 'wikidata-position-holder-direct', evidenceUrl: 'https://www.wikidata.org/wiki/Property:P1308' });
    }
    for (const rule of positionRules) if (assertion.propertyId === rule.heldPropertyId) {
      const jurisdictions = [...new Set(assertion.qualifiers.flatMap(qualifier => qualifier.propertyId === rule.jurisdictionPropertyId && qualifier.value.kind === 'entity' ? [qualifier.value.objectId] : []))];
      if (jurisdictions.length > 1) { addException(assertion.id, 'AMBIGUOUS_JURISDICTION'); continue; }
      add(assertion, assertion.subjectId, assertion.value.objectId, jurisdictions[0], rule);
    }
    for (const rule of rules) if (assertion.subjectId === rule.listId && assertion.propertyId === rule.memberPropertyId) add(assertion, assertion.value.objectId, rule.officeId, rule.jurisdictionId, rule);
  }
  return { collection, tenures, exceptions, mappingVersion: OFFICE_PROJECTION_VERSION };
}

/** A CSV/structured-table parser can supply this DTO without impersonating a Wikidata statement. */
export function mapOfficeTenureRows(rows: OfficeTenureRow[], source: KnowledgeSource, rule: { id: string; evidenceUrl: string }): OfficeProjectionResult {
  if (!rows.length || rows.length > 10000 || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !row.id || !row.locator || !row.holder.id || !row.office.id || row.jurisdiction && !row.jurisdiction.id) || !rule.id || !url(rule.evidenceUrl)) throw new Error('INVALID_OFFICE_ROWS');
  const collection: KnowledgeCollection = { schemaVersion: 1, objects: [], assertions: [], sources: [structuredClone(source)] }, objects = new Map<string, KnowledgeObject>();
  function ensure(value: { id: string; labels: KnowledgeText }, type: string) {
    const current = objects.get(value.id);
    if (current) {
      for (const [language, label] of Object.entries(value.labels)) if (!current.labels[language]) current.labels[language] = label;
      else if (current.labels[language] !== label && !current.aliases.some(alias => alias[language] === label)) current.aliases.push({ [language]: label });
      if (!current.types.includes(type)) current.types.push(type);
      return;
    }
    const object: KnowledgeObject = { id: value.id, labels: structuredClone(value.labels), descriptions: {}, aliases: [], identities: [{ provider: 'declared-office-tenure-row', externalId: value.id }], types: [type] };
    collection.objects.push(object); objects.set(value.id, object);
  }
  for (const row of rows) {
    ensure(row.holder, 'gitworld:office-holder'); ensure(row.office, 'gitworld:office'); if (row.jurisdiction) ensure(row.jurisdiction, 'gitworld:jurisdiction-scope');
    collection.assertions.push({ id: `office-row:${key(JSON.stringify([source.identity.provider, source.identity.externalId, row.id]))}`, subjectId: row.holder.id, propertyId: 'office:held-position', value: { kind: 'entity', objectId: row.office.id },
      qualifiers: [...structuredClone(row.qualifiers ?? []), ...(row.jurisdiction ? [entityQualifier('office:jurisdiction', row.jurisdiction.id)] : []), ...(row.reviewFlags ?? []).map(flag => textQualifier('source:review-flag', flag))],
      evidence: [{ sourceId: source.id, locator: row.locator }], sourceSnapshotId: source.id, review: 'unreviewed', ...(row.validTime ? { validTime: structuredClone(row.validTime) } : {}) });
  }
  return projectOfficeTenures(collection, { positionRules: [{ id: rule.id, heldPropertyId: 'office:held-position', jurisdictionPropertyId: 'office:jurisdiction', evidenceUrl: rule.evidenceUrl }] });
}
