import type { PinnedResearchEvidence, ResearchRecord, ResearchScope } from '../../../../packages/contracts/src/research-types.ts';
import type { KnowledgeQuery } from '../../../../packages/domain/src/knowledge.ts';

export type ResearchPeriod = { ok: true; value: [number, number] | null } | { ok: false };
export function parseResearchPeriod(from: string, to: string): ResearchPeriod {
  if (!from.trim() && !to.trim()) return { ok: true, value: null };
  const valid = (value: string) => /^-?[1-9]\d*$/.test(value.trim()) && Number.isSafeInteger(Number(value));
  if (!valid(from) || !valid(to) || Number(from) > Number(to)) return { ok: false };
  return { ok: true, value: [Number(from), Number(to)] };
}

export const evidenceKey = (evidence: PinnedResearchEvidence) => JSON.stringify([evidence.kind, evidence.id, evidence.repositoryRevision, evidence.locator]);
export function mergeResearchEvidence(before: PinnedResearchEvidence[], incoming: PinnedResearchEvidence[]): PinnedResearchEvidence[] {
  const all = new Map(before.map(value => [evidenceKey(value), structuredClone(value)]));
  for (const value of incoming) if (!all.has(evidenceKey(value))) all.set(evidenceKey(value), structuredClone(value));
  return [...all.values()];
}

/** Editorial timestamps do not turn an otherwise unchanged note into a new edit. */
export function researchFingerprint(record: ResearchRecord): string {
  const { updatedAt: _updatedAt, ...content } = record;
  return JSON.stringify(content);
}

export function emptyResearchScope(): ResearchScope { return { query: '', timeWindow: null, objectIds: [], fieldIds: [] }; }
/** Editable research filters override the saved navigation recipe without rebasing evidence. */
export function researchKnowledgeQuery(scope: ResearchScope): KnowledgeQuery {
  const query={...structuredClone(scope.navigation?.query??{}),offset:0,limit:40};
  if(scope.query.trim())query.text=scope.query.trim();else delete query.text;
  if(scope.timeWindow)query.time=[...scope.timeWindow];else delete query.time;
  if(scope.objectIds.length)query.objectIds=[...scope.objectIds];else delete query.objectIds;
  query.includeUndated??=true;query.includeUnlocated??=true;
  return query;
}
export function newResearchRecord(id: string, scope: ResearchScope, now: string): ResearchRecord {
  return { schemaVersion: 1, id, title: '', scope: structuredClone(scope), interpretation: '', openQuestions: [], evidence: [], comparison: null, updatedAt: now };
}

export type ResearchRecovery = { schemaVersion: 1; record: ResearchRecord; expectedHash: string | null; from: string; to: string; baseline: string };
/** Recovery input is still uncommitted form input and is revalidated by the service on save. */
export function parseResearchRecovery(text: string | null): ResearchRecovery | null {
  if (!text || text.length > 2_000_000) return null;
  try {
    const value = JSON.parse(text) as ResearchRecovery;
    const record = value?.record;
    if (value.schemaVersion !== 1 || !(value.expectedHash === null || typeof value.expectedHash === 'string') || typeof value.from !== 'string' || typeof value.to !== 'string' || typeof value.baseline !== 'string' || !record || record.schemaVersion !== 1 || typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.interpretation !== 'string' || !Array.isArray(record.openQuestions) || !record.openQuestions.every(line => typeof line === 'string') || !Array.isArray(record.evidence) || !record.scope || typeof record.scope.query !== 'string' || !Array.isArray(record.scope.objectIds) || !record.scope.objectIds.every(id => typeof id === 'string') || !Array.isArray(record.scope.fieldIds) || !record.scope.fieldIds.every(id => typeof id === 'string') || !(record.scope.timeWindow === null || Array.isArray(record.scope.timeWindow) && record.scope.timeWindow.length === 2 && record.scope.timeWindow.every(Number.isSafeInteger)) || !(record.comparison === null || typeof record.comparison === 'object')) return null;
    for (const item of record.evidence) if (!item || typeof item.id !== 'string' || !['source', 'assertion', 'object', 'historical-state'].includes(item.kind) || typeof item.title !== 'string' || typeof item.locator !== 'string' || typeof item.repositoryRevision !== 'string') return null;
    for (const endpoint of record.comparison ? [record.comparison.a, record.comparison.b] : []) {
      if (!endpoint || typeof endpoint.label !== 'string' || typeof endpoint.repositoryRevision !== 'string') return null;
      if(endpoint.labels!==undefined&&(!endpoint.labels||typeof endpoint.labels!=='object'||Array.isArray(endpoint.labels)||Object.keys(endpoint.labels).length>100||!Object.entries(endpoint.labels).every(([language,label])=>/^[A-Za-z][A-Za-z0-9-]{0,34}$/.test(language)&&typeof label==='string'&&label.length<=1000)))return null;
    }
    return value;
  } catch { return null; }
}
