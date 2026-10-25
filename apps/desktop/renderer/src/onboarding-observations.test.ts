import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOnboardingProgress, initialOnboardingSnapshot } from './onboarding.ts';
import { comparisonProgressKey, knowledgeGuideEvents, objectScopeKey, researchCompletesInvestigation } from './onboarding-observations.ts';
import type { FixedKnowledgeState } from './knowledge-browser-state.ts';
import type { ResearchRecordEnvelope } from '../../../../packages/contracts/src/research-types.ts';

const revision = 'a'.repeat(40);
const a: FixedKnowledgeState = { objectId: 'arbitrary-A', year: -100, revision, label: 'A', includeUnreviewed: true };
const b: FixedKnowledgeState = { objectId: 'arbitrary-B', year: 100, revision, label: 'B', includeUnreviewed: true };

function investigation() {
  let progress = initialOnboardingSnapshot();
  for (const event of [
    { type: 'object', objectId: b.objectId } as const,
    { type: 'state', objectId: b.objectId, year: b.year, revision } as const,
    { type: 'comparison', a, b } as const,
    { type: 'evidence', objectId: a.objectId, propertyId: 'arbitrary-field', assertionIds: ['assertion-A'], revision } as const,
  ]) for (const observation of knowledgeGuideEvents(event, progress, { a, b })) progress = applyOnboardingProgress(progress, observation);
  return progress;
}
function saved(): ResearchRecordEnvelope {
  return { contentHash: 'saved-hash', repositoryRevision: null, record: {
    schemaVersion: 1, id: 'record-A', title: 'A self-selected question', updatedAt: '2026-10-25T00:00:00Z',
    scope: { query: 'a name', timeWindow: [-100, 100], objectIds: [a.objectId, b.objectId], fieldIds: ['arbitrary-field'] },
    interpretation: 'A provisional interpretation', openQuestions: [],
    comparison: { a: { objectId: a.objectId, year: a.year, repositoryRevision: revision, label: a.label, includeUnreviewed: true }, b: { objectId: b.objectId, year: b.year, repositoryRevision: revision, label: b.label, includeUnreviewed: true } },
    evidence: [{ id: 'evidence-A', kind: 'assertion', title: 'A claim', locator: 'claim:A', objectId: a.objectId, assertionId: 'assertion-A', repositoryRevision: revision }],
  } };
}

test('cross-object evidence belongs to the fixed comparison without changing the investigation scope', () => {
  const progress = investigation();
  assert.equal(progress.investigation.scopeKey, objectScopeKey(b.objectId));
  assert.equal(progress.investigation.comparisonKey, comparisonProgressKey(a, b));
  assert.ok(progress.investigation.evidenceKey);
  assert.deepEqual(knowledgeGuideEvents({ type: 'evidence', objectId: 'unrelated', propertyId: 'field', assertionIds: ['assertion'], revision }, progress, { a, b }), []);
  assert.deepEqual(knowledgeGuideEvents({ type: 'evidence', objectId: a.objectId, propertyId: 'field', assertionIds: [], revision }, progress, { a, b }), []);
});

test('a successful research save completes the journey only with its actual comparison and inspected evidence', () => {
  const progress = investigation(), envelope = saved();
  assert.equal(researchCompletesInvestigation(progress, envelope), true);
  const changed = structuredClone(envelope); changed.record.comparison!.a.includeUnreviewed = false;
  assert.equal(researchCompletesInvestigation(progress, changed), false);
  changed.record.comparison!.a.includeUnreviewed = true; changed.record.evidence[0].assertionId = 'another-claim';
  assert.equal(researchCompletesInvestigation(progress, changed), false);
  changed.record.evidence[0].assertionId = 'assertion-A'; changed.record.interpretation = '';
  assert.equal(researchCompletesInvestigation(progress, changed), false);
  changed.record.openQuestions = ['An unresolved point']; assert.equal(researchCompletesInvestigation(progress, changed), true);
  changed.contentHash = ''; assert.equal(researchCompletesInvestigation(progress, changed), false);
});

test('working or unrelated references cannot masquerade as a saved fixed investigation', () => {
  const progress = investigation(), envelope = saved();
  envelope.record.scope.objectIds = ['unrelated']; assert.equal(researchCompletesInvestigation(progress, envelope), false);
  envelope.record.scope.objectIds = [b.objectId]; envelope.record.comparison!.a.repositoryRevision = 'working';
  assert.equal(researchCompletesInvestigation(progress, envelope), false);
});
