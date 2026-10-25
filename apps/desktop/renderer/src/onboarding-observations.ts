import type { ResearchRecordEnvelope } from '../../../../packages/contracts/src/research-types.ts';
import type { KnowledgeBrowserObservation } from './knowledge-browser.ts';
import type { FixedKnowledgeState } from './knowledge-browser-state.ts';
import type { OnboardingProgressEvent, OnboardingSnapshot } from './onboarding.ts';

export const objectScopeKey = (objectId: string) => `object:${objectId}`;
const endpointKey = (value: { objectId?: string; year?: number | null; revision?: string; repositoryRevision?: string; includeUnreviewed?: boolean; historicalRef?: string }) => [value.objectId ?? null, value.year ?? null, value.revision ?? value.repositoryRevision ?? null, value.includeUnreviewed ?? false, value.historicalRef ?? null];
export const comparisonProgressKey = (a: Parameters<typeof endpointKey>[0], b: Parameters<typeof endpointKey>[0]) => JSON.stringify([endpointKey(a), endpointKey(b)]);

/** Map successful domain observations without treating navigation as completed work. */
export function knowledgeGuideEvents(event: KnowledgeBrowserObservation, snapshot: OnboardingSnapshot, comparison: { a: FixedKnowledgeState | null; b: FixedKnowledgeState | null }): OnboardingProgressEvent[] {
  if (event.type === 'object') return [{ type: 'scope-chosen', scopeKey: objectScopeKey(event.objectId) }];
  if (event.type === 'state') return [{ type: 'scope-chosen', scopeKey: objectScopeKey(event.objectId) }, { type: 'historical-state-inspected', scopeKey: objectScopeKey(event.objectId), stateKey: JSON.stringify([event.objectId, event.year, event.revision]) }];
  const scopeKey = snapshot.investigation.scopeKey;
  if (!scopeKey?.startsWith('object:')) return [];
  if (event.type === 'comparison') {
    if (![event.a.objectId, event.b.objectId].some(id => objectScopeKey(id) === scopeKey)) return [];
    return [{ type: 'comparison-completed', scopeKey, comparisonKey: comparisonProgressKey(event.a, event.b) }];
  }
  const matchingComparison = comparison.a && comparison.b && snapshot.investigation.comparisonKey === comparisonProgressKey(comparison.a, comparison.b)
    && [comparison.a.objectId, comparison.b.objectId].includes(event.objectId);
  if (!event.assertionIds.length || objectScopeKey(event.objectId) !== scopeKey && !matchingComparison) return [];
  return [{ type: 'evidence-inspected', scopeKey, evidenceKey: JSON.stringify([event.objectId, event.propertyId, [...event.assertionIds].sort(), event.revision]) }];
}

/** A guided save keeps the comparison and inspected evidence, rather than an unrelated empty note. */
export function researchCompletesInvestigation(snapshot: OnboardingSnapshot, envelope: ResearchRecordEnvelope): boolean {
  const { record, contentHash } = envelope, progress = snapshot.investigation;
  if (!contentHash || !record.title.trim() || !record.interpretation.trim() && !record.openQuestions.some(value => value.trim()) || !record.comparison || !record.evidence.length) return false;
  if (!record.scope.objectIds.some(id => objectScopeKey(id) === progress.scopeKey)) return false;
  if (progress.comparisonKey !== comparisonProgressKey(record.comparison.a, record.comparison.b)) return false;
  if (![record.comparison.a, record.comparison.b].every(endpoint => /^[a-f0-9]{40}$/.test(endpoint.repositoryRevision))) return false;
  try {
    const [objectId, , assertionIds, revision] = JSON.parse(progress.evidenceKey ?? 'null');
    return Array.isArray(assertionIds) && record.evidence.some(value => value.objectId === objectId && value.repositoryRevision === revision && value.assertionId && assertionIds.includes(value.assertionId));
  } catch { return false; }
}
