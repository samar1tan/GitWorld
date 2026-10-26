import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOnboardingProgress, initialOnboardingSnapshot } from './onboarding.ts';
import { comparisonProgressKey, knowledgeGuideEvents, objectScopeKey, researchCompletesInvestigation } from './onboarding-observations.ts';
import type { FixedKnowledgeState } from './knowledge-browser-state.ts';
import type { ResearchRecordEnvelope } from '../../../../packages/contracts/src/research-types.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHistoryEngine, type DataPackage } from '@gitworld/domain';
import { initialWorkspace } from './state.ts';
import { modelResearchContext } from './model-research.ts';
import { modelComparisonResearch } from './model-comparison.ts';

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

const modelRevision = 'a'.repeat(40);
function modelInvestigation(fieldId = 'politics.capital') {
  // Use the installed public model and real research producer with a technical
  // revision. No installed QA library or user research record is read.
  const data = JSON.parse(readFileSync(path.join(process.cwd(), 'data/seed/early-medieval.json'), 'utf8')) as DataPackage;
  data.revision.id = modelRevision; data.history.id = modelRevision;
  const engine = createHistoryEngine(data.history), diff = engine.diff('commit:japan-740', 'commit:japan-744');
  assert.ok(diff.ok); if (!diff.ok) throw new Error(diff.error.code);
  const branch = data.history.branches.find(value => value.id === 'japan/main')!;
  const workspace = initialWorkspace(); workspace.view.panel = 'compare'; workspace.view.scopeId = branch.scopeId; workspace.view.processId = branch.processId;
  workspace.comparison = ['japan-740', 'japan-744']; workspace.comparisonRequestedYears = [null, null];
  const context = modelResearchContext(data, workspace, modelRevision, 'en');
  assert.equal(context.evidence?.length, 6); assert.deepEqual(context.scope.objectIds, []);
  const target = { datasetId: data.dataset.id, revisionId: modelRevision }, scopeKey = `paths:${data.dataset.id}:${branch.scopeId}`;
  let progress = initialOnboardingSnapshot();
  // These are the existing main/workbench successful-event payloads, using
  // the engine's actual resolved references rather than invented snapshots.
  for (const event of [
    { type: 'scope-chosen', scopeKey },
    { type: 'historical-state-inspected', scopeKey, stateKey: JSON.stringify([target, 'japan-744', null]) },
    { type: 'comparison-completed', scopeKey, comparisonKey: JSON.stringify([target, diff.value.a, diff.value.b]) },
    { type: 'evidence-inspected', scopeKey, evidenceKey: JSON.stringify([target, 'japan-744', fieldId]) },
  ] as const) progress = applyOnboardingProgress(progress, event, 'paths');
  const envelope: ResearchRecordEnvelope = { contentHash: 'd'.repeat(64), repositoryRevision: null, record: { schemaVersion: 1, id: 'model-research', title: 'Why does the court continue across the move to Naniwa?', updatedAt: '2026-10-26T00:00:00Z', scope: context.scope, evidence: context.evidence!, comparison: context.comparison!, interpretation: 'The residence changes; the court organization is inherited from the earlier recorded baseline.', openQuestions: ['Which source establishes more precise dates?'] } };
  return { data, engine, diff: diff.value, workspace, target, progress, envelope };
}

test('the real Nara model research producer completes its fixed 740/744 investigation after a successful save', () => {
  const { progress, envelope } = modelInvestigation();
  assert.equal(researchCompletesInvestigation(progress, envelope), true);
  const completed = applyOnboardingProgress(progress, { type: 'research-saved', scopeKey: progress.investigation.scopeKey!, recordId: envelope.record.id, contentHash: envelope.contentHash }, 'research');
  assert.ok(completed.investigation.research);
  assert.equal(researchCompletesInvestigation(progress, saved()), false, 'the unrelated object record cannot finish the model journey');
});

test('inherited model evidence belongs to the inspected endpoint, while another field or its origin state cannot finish it', () => {
  const { data, engine, progress, envelope, workspace } = modelInvestigation('politics.form');
  const snapshot = engine.snapshot('commit:japan-744'); assert.ok(snapshot.ok); if (!snapshot.ok) throw new Error(snapshot.error.code);
  assert.equal(snapshot.value.fields['politics.form'].changedAt, 'japan-710');
  assert.equal(researchCompletesInvestigation(progress, envelope), true);
  const wrongField = structuredClone(envelope); wrongField.record.evidence = wrongField.record.evidence.filter(value => !value.id.includes(':politics.form:'));
  assert.equal(researchCompletesInvestigation(progress, wrongField), false);
  const origin = structuredClone(workspace); origin.view.panel = 'history'; origin.view.selectedCommit = 'japan-710';
  const wrongState = structuredClone(envelope); wrongState.record.evidence = modelResearchContext(data, origin, modelRevision, 'en').evidence!;
  assert.equal(researchCompletesInvestigation(progress, wrongState), false, '710 is an origin, not the inspected 744 endpoint');
});

test('fixed-model guidance rejects exchanged scope, model, OID, endpoint, direction and evidence identities', () => {
  const { progress, envelope, target } = modelInvestigation();
  const changes: Array<[string, (value: ResearchRecordEnvelope) => void]> = [
    ['model', value => { value.record.scope.model!.datasetId = 'unrelated-model'; }],
    ['scope', value => { value.record.scope.model!.scopeId = 'unrelated-scope'; }],
    ['scope revision', value => { value.record.scope.model!.repositoryRevision = 'b'.repeat(40); }],
    ['endpoint model', value => { value.record.comparison!.a.modelId = 'unrelated-model'; }],
    ['endpoint OID', value => { value.record.comparison!.b.repositoryRevision = 'b'.repeat(40); }],
    ['working endpoint', value => { value.record.comparison!.b.repositoryRevision = 'working'; }],
    ['endpoint ref', value => { value.record.comparison!.b.historicalRef = 'commit:japan-745'; }],
    ['endpoint date', value => { value.record.comparison!.b.year = 745; }],
    ['direction', value => { value.record.comparison = { a: value.record.comparison!.b, b: value.record.comparison!.a }; }],
    ['evidence model', value => { value.record.evidence.forEach(item => { item.modelId = 'unrelated-model'; }); }],
    ['evidence OID', value => { value.record.evidence.forEach(item => { item.repositoryRevision = 'b'.repeat(40); }); }],
    ['evidence ref', value => { value.record.evidence.forEach(item => { item.historicalRef = 'commit:japan-745'; }); }],
    ['evidence identity', value => { value.record.evidence.forEach(item => { item.id = 'another-field-reference'; }); }],
    ['evidence kind', value => { value.record.evidence.forEach(item => { item.kind = 'object'; }); }],
    ['no evidence', value => { value.record.evidence = []; }],
    ['no comparison', value => { value.record.comparison = null; }],
    ['empty content', value => { value.record.interpretation = ''; value.record.openQuestions = [' ']; }],
    ['failed save', value => { value.contentHash = ''; }],
  ];
  for (const [name, change] of changes) { const value = structuredClone(envelope); change(value); assert.equal(researchCompletesInvestigation(progress, value), false, name); }
  for (const key of ['comparisonKey', 'evidenceKey', 'stateKey'] as const) {
    const value = structuredClone(progress); value.investigation[key] = null;
    assert.equal(researchCompletesInvestigation(value, envelope), false, key);
  }
  const wrongEvidence = structuredClone(progress); wrongEvidence.investigation.evidenceKey = JSON.stringify([{ ...target, revisionId: 'b'.repeat(40) }, 'japan-744', 'politics.capital']);
  assert.equal(researchCompletesInvestigation(wrongEvidence, envelope), false);
  for (const [basis, ref, field] of [
    [{ ...target, datasetId: 'unrelated-model' }, 'japan-744', 'politics.capital'],
    [target, 'japan-710', 'politics.capital'],
    [target, 'japan-744', 'uninspected-field'],
  ] as const) {
    const value = structuredClone(progress); value.investigation.evidenceKey = JSON.stringify([basis, ref, field]);
    assert.equal(researchCompletesInvestigation(value, envelope), false);
  }
  const wrongState = structuredClone(progress); wrongState.investigation.stateKey = JSON.stringify([{ ...target, revisionId: 'b'.repeat(40) }, 'japan-744', null]);
  assert.equal(researchCompletesInvestigation(wrongState, envelope), false);
});

test('the real model producer retains requested as-of dates instead of substituting recorded years', () => {
  const { data, engine, workspace, progress, envelope, target } = modelInvestigation();
  const diff = engine.diff('japan/main@742', 'japan/main@744'); assert.ok(diff.ok); if (!diff.ok) throw new Error(diff.error.code);
  workspace.comparisonRequestedYears = [742, 744];
  const context = modelResearchContext(data, workspace, modelRevision, 'en');
  envelope.record.scope = context.scope; envelope.record.evidence = context.evidence!; envelope.record.comparison = context.comparison!;
  progress.investigation.comparisonKey = JSON.stringify([target, diff.value.a, diff.value.b]);
  assert.equal(envelope.record.comparison.a.year, 742);
  assert.equal(researchCompletesInvestigation(progress, envelope), true);
  envelope.record.comparison.a.year = 740;
  assert.equal(researchCompletesInvestigation(progress, envelope), false);
});

test('the fixed model-comparison research adapter retains the same qualified references for guidance', () => {
  const { data, diff, progress } = modelInvestigation();
  const context = modelComparisonResearch({ diff, before: data, after: data, a: { kind: 'model', modelId: data.dataset.id, revision: modelRevision, ref: 'commit:japan-740' }, b: { kind: 'model', modelId: data.dataset.id, revision: modelRevision, ref: 'commit:japan-744' }, commonBaseStatus: 'computed' }, 'zh-CN');
  const { envelope } = modelInvestigation(); envelope.record.scope = context.scope; envelope.record.evidence = context.evidence!; envelope.record.comparison = context.comparison!;
  assert.equal(researchCompletesInvestigation(progress, envelope), true);
});
