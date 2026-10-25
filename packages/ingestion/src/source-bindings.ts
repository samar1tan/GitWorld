import { createHash } from 'node:crypto';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeEvidence, type KnowledgeJson, type KnowledgeObject, type KnowledgeQualifier, type KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { JsonValue } from './source-types.ts';
import { canonicalSourceJson } from './wikidata.ts';

export const SOURCE_BINDING_VERSION = 'source-identity-role-bindings-v2';
export type BindingSourceIdentity = { provider: string; externalId: string; revision: string };
export type BindingEvidence = { url: string; locator: string; citation?: string };
export type SourceBindingRule = {
  id: string; source: BindingSourceIdentity; propertyId: string; subjectId?: string; entityValueId?: string;
  assertionIds?: string[]; targetSubjectId: string; targetPropertyId: string; targetType: string;
  direction: 'value' | 'subject'; evidence: BindingEvidence[]; qualifiers?: KnowledgeQualifier[];
  valueIdentities?: { sourceObjectId: string; targetObjectId: string; targetType: string; evidence: BindingEvidence[] }[];
};
export type SourceBindingPlan = {
  schemaVersion: 1; id: string; revision: string; preparedAt: string; url: string;
  rights: KnowledgeSource['rights']; objects: KnowledgeObject[]; rules: SourceBindingRule[];
};
export type SourceBindingIssue = {
  code: 'SOURCE_NOT_FOUND' | 'SOURCE_REVISION_MISMATCH' | 'NO_MATCHING_ASSERTIONS' | 'UNKNOWN_ASSERTION_SELECTION' | 'REJECTED_SOURCE_CLAIM' | 'AUTHORITY_BASIS_REQUIRED' | 'TARGET_NOT_FOUND' | 'TARGET_TYPE_MISMATCH' | 'OBJECT_CONFLICT' | 'ASSERTION_CONFLICT' | 'SOURCE_CONFLICT' | 'VALUE_IDENTITY_INVALID' | 'UNUSED_VALUE_IDENTITY';
  ruleId?: string; objectId?: string; assertionId?: string; sourceId?: string;
};
export type SourceBindingResult = {
  collection: KnowledgeCollection; sourceId: string; mappingVersion: typeof SOURCE_BINDING_VERSION;
  results: { ruleId: string; derivedAssertionIds: string[] }[]; issues: SourceBindingIssue[];
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown) => canonicalSourceJson(JSON.parse(JSON.stringify(value)) as JsonValue);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validEvidence = (value: BindingEvidence[]) => Array.isArray(value) && value.length > 0 && value.every(item => nonempty(item.url) && nonempty(item.locator));

/** Source authority qualifications cannot disappear inside an interpreted officeholder field. */
export function bindingRequiresQualifiedAuthority(original: KnowledgeAssertion, target: Pick<SourceBindingRule, 'targetPropertyId' | 'targetType'>): boolean {
  if (target.targetPropertyId !== 'office:holder') return false;
  if (target.targetType === 'gitworld:authority-survey') return true;
  const sourceText = original.qualifiers.flatMap(item => item.propertyId === 'source:tenure-text' && item.value.kind === 'text' ? [item.value.value] : []);
  for (const time of Object.values(original.validTime ?? {})) if (time && typeof time === 'object' && 'raw' in time && typeof time.raw === 'string') sourceText.push(time.raw);
  return original.qualifiers.some(item => item.propertyId === 'office:authority-basis') || sourceText.some(value => /\bde[\s-]+(?:jure|facto)\b/i.test(value));
}
function validRule(value: SourceBindingRule): boolean {
  if (![value.id, value.propertyId, value.targetSubjectId, value.targetPropertyId, value.targetType, value.source.provider, value.source.externalId, value.source.revision].every(nonempty)) return false;
  if (!value.subjectId && !value.entityValueId || !['value', 'subject'].includes(value.direction) || !validEvidence(value.evidence)) return false;
  if (value.assertionIds && (!value.assertionIds.length || new Set(value.assertionIds).size !== value.assertionIds.length)) return false;
  const identities = value.valueIdentities;
  return !identities || new Set(identities.map(item => item.sourceObjectId)).size === identities.length && identities.every(item => [item.sourceObjectId, item.targetObjectId, item.targetType].every(nonempty) && validEvidence(item.evidence));
}

export function matchesBindingSource(source: KnowledgeSource, expected: BindingSourceIdentity): boolean {
  return source.identity.provider === expected.provider && source.identity.externalId === expected.externalId && source.revision === expected.revision;
}

/** A sidecar is interpretation evidence; it never replaces or edits an upstream snapshot. */
export function createBindingSource(plan: Pick<SourceBindingPlan, 'schemaVersion' | 'id' | 'revision' | 'preparedAt' | 'url' | 'rights'>, record: KnowledgeJson): KnowledgeSource {
  if (plan.schemaVersion !== 1 || ![plan.id, plan.revision, plan.url, plan.preparedAt].every(nonempty) || !Number.isFinite(new Date(plan.preparedAt).getTime()) || !['allowed', 'restricted', 'unknown'].includes(plan.rights.redistribution)) throw new Error('INVALID_SOURCE_BINDING_PLAN');
  const contentHash = digest(stable(record));
  return { id: `gitworld-binding:${plan.id}@${contentHash}`, identity: { provider: 'gitworld-source-binding', externalId: plan.id }, revision: plan.revision, contentHash, retrievedAt: plan.preparedAt, url: plan.url, adapterVersion: SOURCE_BINDING_VERSION, rights: structuredClone(plan.rights), record: structuredClone(record) };
}

/** Selects only declared source identities/revisions, never a name or reused external reference. */
export function applySourceBindings(input: KnowledgeCollection, plan: SourceBindingPlan): SourceBindingResult {
  createKnowledgeIndex(input);
  if (!Array.isArray(plan.objects) || !Array.isArray(plan.rules) || new Set(plan.objects.map(value => value.id)).size !== plan.objects.length || new Set(plan.rules.map(value => value.id)).size !== plan.rules.length || !plan.rules.every(validRule)) throw new Error('INVALID_SOURCE_BINDING_PLAN');
  const source = createBindingSource(plan, { schemaVersion: 1, id: plan.id, revision: plan.revision, objects: plan.objects, rules: plan.rules, mappingVersion: SOURCE_BINDING_VERSION } as unknown as KnowledgeJson);
  const collection = structuredClone(input), issues: SourceBindingIssue[] = [], results: SourceBindingResult['results'] = [];
  const objects = new Map(collection.objects.map(value => [value.id, value])), assertions = new Map(collection.assertions.map(value => [value.id, value])), sources = new Map(collection.sources.map(value => [value.id, value]));
  const blockedObjects = new Set<string>();
  for (const object of plan.objects) {
    const prior = objects.get(object.id);
    if (prior && stable(prior) !== stable(object)) { issues.push({ code: 'OBJECT_CONFLICT', objectId: object.id }); blockedObjects.add(object.id); continue; }
    if (!prior) { objects.set(object.id, structuredClone(object)); collection.objects.push(structuredClone(object)); }
  }
  const priorSource = sources.get(source.id);
  if (priorSource && stable({ ...priorSource, retrievedAt: '' }) !== stable({ ...source, retrievedAt: '' })) return { collection, sourceId: source.id, mappingVersion: SOURCE_BINDING_VERSION, results, issues: [...issues, { code: 'SOURCE_CONFLICT', sourceId: source.id }] };
  if (!priorSource) { collection.sources.push(source); sources.set(source.id, source); }
  for (const [ruleIndex, rule] of plan.rules.entries()) {
    const result = { ruleId: rule.id, derivedAssertionIds: [] as string[] }; results.push(result);
    const target = objects.get(rule.targetSubjectId);
    if (!target) { issues.push({ code: 'TARGET_NOT_FOUND', ruleId: rule.id, objectId: rule.targetSubjectId }); continue; }
    if (blockedObjects.has(target.id)) continue;
    if (!target.types.includes(rule.targetType)) { issues.push({ code: 'TARGET_TYPE_MISMATCH', ruleId: rule.id, objectId: target.id }); continue; }
    const sourceRecords = input.sources.filter(value => matchesBindingSource(value, rule.source));
    if (!sourceRecords.length) { const identityPresent = input.sources.some(value => value.identity.provider === rule.source.provider && value.identity.externalId === rule.source.externalId); issues.push({ code: identityPresent ? 'SOURCE_REVISION_MISMATCH' : 'SOURCE_NOT_FOUND', ruleId: rule.id }); continue; }
    const sourceIds = new Set(sourceRecords.map(value => value.id));
    let selected = input.assertions.filter(value => sourceIds.has(value.sourceSnapshotId) && value.propertyId === rule.propertyId && (!rule.subjectId || value.subjectId === rule.subjectId) && (!rule.entityValueId || value.value.kind === 'entity' && value.value.objectId === rule.entityValueId));
    if (rule.assertionIds) {
      const found = new Set(selected.map(value => value.id)), missing = rule.assertionIds.filter(value => !found.has(value));
      if (missing.length) { for (const assertionId of missing) issues.push({ code: 'UNKNOWN_ASSERTION_SELECTION', ruleId: rule.id, assertionId }); continue; }
      const included = new Set(rule.assertionIds); selected = selected.filter(value => included.has(value.id));
    }
    if (!selected.length) { issues.push({ code: 'NO_MATCHING_ASSERTIONS', ruleId: rule.id }); continue; }
    const usedIdentities = new Set<string>();
    for (const original of selected) {
      if (original.review === 'rejected') { issues.push({ code: 'REJECTED_SOURCE_CLAIM', ruleId: rule.id, assertionId: original.id }); continue; }
      if (bindingRequiresQualifiedAuthority(original, rule)) { issues.push({ code: 'AUTHORITY_BASIS_REQUIRED', ruleId: rule.id, assertionId: original.id }); continue; }
      const sourceValueId = rule.direction === 'subject' ? original.subjectId : original.value.kind === 'entity' ? original.value.objectId : undefined;
      const identity = rule.valueIdentities?.find(value => value.sourceObjectId === sourceValueId);
      if (identity) {
        usedIdentities.add(identity.sourceObjectId);
        if (!objects.get(identity.targetObjectId)?.types.includes(identity.targetType) || blockedObjects.has(identity.targetObjectId)) { issues.push({ code: 'VALUE_IDENTITY_INVALID', ruleId: rule.id, objectId: identity.targetObjectId, assertionId: original.id }); continue; }
      }
      const evidence: KnowledgeEvidence[] = [...structuredClone(original.evidence), ...[...rule.evidence, ...(identity?.evidence ?? [])].map(item => ({ sourceId: source.id, locator: `$.rules[${ruleIndex}]`, url: item.url, ...(item.citation ? { citation: item.citation } : {}) }))];
      const derived: KnowledgeAssertion = {
        ...structuredClone(original), id: `source-binding:${digest(`${plan.id}:${rule.id}:${original.id}`).slice(0, 40)}`, subjectId: target.id, propertyId: rule.targetPropertyId,
        value: identity ? { kind: 'entity', objectId: identity.targetObjectId } : rule.direction === 'subject' ? { kind: 'entity', objectId: original.subjectId } : structuredClone(original.value), review: 'unreviewed', evidence,
        qualifiers: [...structuredClone(original.qualifiers), { propertyId: 'binding:derived-from', value: { kind: 'text', value: original.id } }, { propertyId: 'binding:rule', value: { kind: 'text', value: `${plan.id}@${plan.revision}:${rule.id}` } }, { propertyId: 'binding:source-subject', value: { kind: 'entity', objectId: original.subjectId } }, ...(identity ? [{ propertyId: 'binding:value-source-identity', value: { kind: 'entity' as const, objectId: identity.sourceObjectId } }, { propertyId: 'binding:value-target-identity', value: { kind: 'entity' as const, objectId: identity.targetObjectId } }] : []), ...structuredClone(rule.qualifiers ?? [])],
      };
      const prior = assertions.get(derived.id);
      if (prior && stable(prior) !== stable(derived)) { issues.push({ code: 'ASSERTION_CONFLICT', ruleId: rule.id, assertionId: derived.id }); continue; }
      if (!prior) { collection.assertions.push(derived); assertions.set(derived.id, derived); }
      result.derivedAssertionIds.push(derived.id);
    }
    for (const identity of rule.valueIdentities ?? []) if (!usedIdentities.has(identity.sourceObjectId)) issues.push({ code: 'UNUSED_VALUE_IDENTITY', ruleId: rule.id, objectId: identity.sourceObjectId });
  }
  createKnowledgeIndex(collection);
  return { collection, sourceId: source.id, mappingVersion: SOURCE_BINDING_VERSION, results, issues };
}
