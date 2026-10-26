import type { ResearchComparisonEndpoint, ResearchRecord, ResearchRecordEnvelope } from '../../../../packages/contracts/src/research-types.ts';
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

const oid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function progressParts(value: string | null): unknown[] | null {
  try { const parsed: unknown = JSON.parse(value ?? 'null'); return Array.isArray(parsed) && parsed.length === 3 ? parsed : null; } catch { return null; }
}
function modelResearchMatches(progress: OnboardingSnapshot['investigation'], record: ResearchRecord): boolean {
  const model = record.scope.model, compared = progressParts(progress.comparisonKey), inspected = progressParts(progress.stateKey), evidence = progressParts(progress.evidenceKey);
  if (!model || record.scope.objectIds.length || !oid(model.repositoryRevision) || !compared || !inspected || !evidence || !record.comparison
    || !progress.scopeKey?.startsWith(`paths:${model.datasetId}:`) || model.scopeId && progress.scopeKey !== `paths:${model.datasetId}:${model.scopeId}`) return false;
  const [basis, before, after] = compared;
  if (!object(basis) || basis.datasetId !== model.datasetId || !oid(basis.revisionId) || !object(before) || !object(after)) return false;
  const pairs = [[record.comparison.a, before], [record.comparison.b, after]] as const;
  for (const [endpoint, resolved] of pairs) {
    if (!oid(resolved.datasetVersion) || typeof resolved.commitId !== 'string' || !resolved.commitId || typeof resolved.recordedYear !== 'number'
      || resolved.requestedYear !== null && typeof resolved.requestedYear !== 'number'
      || endpoint.objectId !== undefined || endpoint.modelId !== model.datasetId || endpoint.repositoryRevision !== resolved.datasetVersion
      || endpoint.historicalRef !== `commit:${resolved.commitId}` || endpoint.year !== (resolved.requestedYear ?? resolved.recordedYear)) return false;
  }
  if (model.repositoryRevision !== record.comparison.a.repositoryRevision || !pairs.some(([endpoint]) => endpoint.repositoryRevision === basis.revisionId)) return false;
  const [stateBasis, stateId, stateYear] = inspected, [sourceBasis, versionId, fieldId] = evidence;
  if (!object(stateBasis) || stateBasis.datasetId !== model.datasetId || !oid(stateBasis.revisionId)
    || typeof stateId !== 'string' || stateYear !== null && typeof stateYear !== 'number'
    || !pairs.some(([endpoint]) => endpoint.repositoryRevision === stateBasis.revisionId && endpoint.historicalRef === `commit:${stateId}` && (stateYear === null || endpoint.year === stateYear))) return false;
  if (!object(sourceBasis) || sourceBasis.datasetId !== model.datasetId || !oid(sourceBasis.revisionId) || typeof versionId !== 'string' || typeof fieldId !== 'string' || !fieldId) return false;
  const endpoint: ResearchComparisonEndpoint | undefined = pairs.map(([value]) => value).find(value => value.repositoryRevision === sourceBasis.revisionId && value.historicalRef === `commit:${versionId}`);
  if (!endpoint) return false;
  // The real model research producer qualifies field evidence by the inspected
  // state. An inherited field keeps its earlier source without becoming that
  // origin state, and a source shared by another field cannot satisfy this one.
  const fieldPrefix = `model:${model.datasetId}:${versionId}:${fieldId}:`;
  return record.evidence.some(value => value.kind === 'historical-state' && value.objectId === undefined && value.modelId === model.datasetId
    && value.repositoryRevision === endpoint.repositoryRevision && value.historicalRef === endpoint.historicalRef && value.year === endpoint.year
    && value.locator.trim() && value.id.startsWith(fieldPrefix) && /^\d+$/.test(value.id.slice(fieldPrefix.length)));
}

/** A guided save keeps the comparison and inspected evidence, rather than an unrelated empty note. */
export function researchCompletesInvestigation(snapshot: OnboardingSnapshot, envelope: ResearchRecordEnvelope): boolean {
  const { record, contentHash } = envelope, progress = snapshot.investigation;
  if (!contentHash || !record.title.trim() || !record.interpretation.trim() && !record.openQuestions.some(value => value.trim()) || !record.comparison || !record.evidence.length) return false;
  if (progress.scopeKey?.startsWith('paths:')) return modelResearchMatches(progress, record);
  if (!record.scope.objectIds.some(id => objectScopeKey(id) === progress.scopeKey)) return false;
  if (progress.comparisonKey !== comparisonProgressKey(record.comparison.a, record.comparison.b)) return false;
  if (![record.comparison.a, record.comparison.b].every(endpoint => /^[a-f0-9]{40}$/.test(endpoint.repositoryRevision))) return false;
  try {
    const [objectId, , assertionIds, revision] = JSON.parse(progress.evidenceKey ?? 'null');
    return Array.isArray(assertionIds) && record.evidence.some(value => value.objectId === objectId && value.repositoryRevision === revision && value.assertionId && assertionIds.includes(value.assertionId));
  } catch { return false; }
}
