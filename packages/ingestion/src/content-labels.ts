import { createHash } from 'node:crypto';
import { createKnowledgeIndex, type KnowledgeCollection, type KnowledgeJson, type KnowledgeSource, type KnowledgeValue } from '../../domain/src/knowledge.ts';
import { canonicalSourceJson } from './wikidata.ts';
import type { JsonValue } from './source-types.ts';

export const CONTENT_LABEL_VERSION = 'provenanced-content-labels-v1';
export type ContentLabelRecord = {
  objectId: string; language: 'en' | 'zh-CN'; text: string; method: string;
  evidence: { url: string; locator: string; sourceSnapshotHash?: string; citation?: string }[];
  original?: { language: string; text: string }; derivedFrom?: { objectId: string; language: string }[];
  /** An explicit before-value is required to replace an existing different label. */
  replaces?: string;
};
export type ContentLabelPlan = {
  schemaVersion: 1; id: string; revision: string; preparedAt: string; url: string;
  rights: KnowledgeSource['rights']; labels: ContentLabelRecord[];
  /** Selected source page/revision/variant facts, excluding raw operational responses. */
  sourceFacts: KnowledgeJson[];
  valueTexts?: { assertionId: string; valueHash: string; language: 'en' | 'zh-CN'; text: string; method: string; evidence: ContentLabelRecord['evidence'] }[];
};
export type ContentLabelIssue = { code: 'OBJECT_NOT_FOUND' | 'LABEL_CONFLICT' | 'SOURCE_CONFLICT' | 'VALUE_TEXT_CONFLICT'; objectId?: string; language?: string; assertionId?: string };
export const contentValueHash = (value: KnowledgeValue) => createHash('sha256').update(canonicalSourceJson(value as unknown as JsonValue)).digest('hex');

/** Content translations are metadata with their own evidence, never ancient assertions or editorial-time events. */
export function applyContentLabels(input: KnowledgeCollection, plan: ContentLabelPlan) {
  createKnowledgeIndex(input);
  if (plan.schemaVersion !== 1 || !plan.id || !plan.revision || !plan.url || !Number.isFinite(new Date(plan.preparedAt).getTime()) || !['allowed', 'restricted', 'unknown'].includes(plan.rights.redistribution) || !Array.isArray(plan.sourceFacts) || !Array.isArray(plan.labels) || new Set(plan.labels.map(value => `${value.objectId}\0${value.language}`)).size !== plan.labels.length || plan.labels.some(value => !value.objectId || !['en', 'zh-CN'].includes(value.language) || !value.text.trim() || !value.method || !value.evidence.length || value.evidence.some(item => !item.url || !item.locator))) throw new Error('INVALID_CONTENT_LABEL_PLAN');
  if (plan.valueTexts?.some(value => !value.assertionId || !value.valueHash || !['en', 'zh-CN'].includes(value.language) || !value.text.trim() || !value.method || !value.evidence.length)) throw new Error('INVALID_CONTENT_LABEL_PLAN');
  const record = { schemaVersion: 1, id: plan.id, revision: plan.revision, mappingVersion: CONTENT_LABEL_VERSION, labels: plan.labels, sourceFacts: plan.sourceFacts, ...(plan.valueTexts ? { valueTexts: plan.valueTexts } : {}) }, contentHash = createHash('sha256').update(canonicalSourceJson(JSON.parse(JSON.stringify(record)) as JsonValue)).digest('hex');
  const source: KnowledgeSource = { id: `gitworld-content-labels:${plan.id}@${contentHash}`, identity: { provider: 'gitworld-content-labels', externalId: plan.id }, revision: plan.revision, contentHash, retrievedAt: plan.preparedAt, url: plan.url, adapterVersion: CONTENT_LABEL_VERSION, rights: structuredClone(plan.rights), record: structuredClone(record) as unknown as KnowledgeJson };
  const collection = structuredClone(input), objects = new Map(collection.objects.map(value => [value.id, value])), issues: ContentLabelIssue[] = [], applied: { objectId: string; language: string }[] = [];
  const priorSource = collection.sources.find(value => value.id === source.id), stable = (value: unknown) => canonicalSourceJson(JSON.parse(JSON.stringify(value)) as JsonValue);
  if (priorSource && stable({ ...priorSource, retrievedAt: '' }) !== stable({ ...source, retrievedAt: '' })) return { collection, sourceId: source.id, mappingVersion: CONTENT_LABEL_VERSION, applied, issues: [{ code: 'SOURCE_CONFLICT' as const }] };
  for (const label of plan.labels) {
    const object = objects.get(label.objectId);
    if (!object) { issues.push({ code: 'OBJECT_NOT_FOUND', objectId: label.objectId, language: label.language }); continue; }
    const current = object.labels[label.language];
    if (current && current !== label.text && label.replaces !== current) { issues.push({ code: 'LABEL_CONFLICT', objectId: label.objectId, language: label.language }); continue; }
    if (current && current !== label.text && !object.aliases.some(value => value[label.language] === current)) object.aliases.push({ [label.language]: current });
    object.labels[label.language] = label.text; applied.push({ objectId: label.objectId, language: label.language });
  }
  const assertions = new Map(collection.assertions.map(value => [value.id, value]));
  for (const text of plan.valueTexts ?? []) { const assertion = assertions.get(text.assertionId); if (!assertion || contentValueHash(assertion.value) !== text.valueHash) issues.push({ code: 'VALUE_TEXT_CONFLICT', assertionId: text.assertionId, language: text.language }); }
  if (!priorSource) collection.sources.push(source);
  createKnowledgeIndex(collection);
  return { collection, sourceId: source.id, mappingVersion: CONTENT_LABEL_VERSION, applied, issues };
}

/** A display-only lookup: state values, identifiers and comparisons stay in the domain's canonical form. */
export function createContentTextIndex(collection: KnowledgeCollection) {
  const assertions = new Map(collection.assertions.map(value => [value.id, value])), records: { sourceId: string; text: NonNullable<ContentLabelPlan['valueTexts']>[number] }[] = [];
  for (const source of collection.sources) {
    if (source.adapterVersion !== CONTENT_LABEL_VERSION || !source.record || typeof source.record !== 'object' || Array.isArray(source.record)) continue;
    const valueTexts = source.record.valueTexts;
    if (!Array.isArray(valueTexts)) continue;
    for (const text of valueTexts) if (text && typeof text === 'object' && !Array.isArray(text) && typeof text.assertionId === 'string' && typeof text.valueHash === 'string' && typeof text.language === 'string' && typeof text.text === 'string' && typeof text.method === 'string' && Array.isArray(text.evidence) && text.evidence.every(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.url === 'string' && typeof item.locator === 'string')) records.push({ sourceId: source.id, text: text as unknown as NonNullable<ContentLabelPlan['valueTexts']>[number] });
  }
  return {
    value(value: KnowledgeValue, assertionIds: string[], language: string) {
      const hash = contentValueHash(value), relevant = new Set<string>(), queue = [...assertionIds];
      while (queue.length && relevant.size < 10000) {
        const id = queue.pop()!; if (relevant.has(id)) continue;
        const assertion = assertions.get(id); if (!assertion || contentValueHash(assertion.value) !== hash) continue;
        relevant.add(id);
        for (const qualifier of assertion.qualifiers) if (['binding:derived-from', 'projection:derived-from'].includes(qualifier.propertyId) && qualifier.value.kind === 'text') queue.push(qualifier.value.value);
      }
      const matches = records.filter(value => relevant.has(value.text.assertionId) && value.text.valueHash === hash && value.text.language === language), texts = [...new Set(matches.map(value => value.text.text))];
      return { status: texts.length > 1 ? 'conflict' as const : texts.length === 1 ? 'translated' as const : 'missing' as const, ...(texts.length === 1 ? { text: texts[0] } : {}), sourceIds: [...new Set(matches.map(value => value.sourceId))],
        provenance: matches.map(({ sourceId, text }) => ({ sourceId, assertionId: text.assertionId, language: text.language, text: text.text, method: text.method, evidence: structuredClone(text.evidence) })) };
    },
  };
}
