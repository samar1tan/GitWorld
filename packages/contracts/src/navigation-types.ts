import type { KnowledgeNavigationRole, KnowledgeQuery, KnowledgeText } from '../../domain/src/knowledge.ts';

export type NavigationRevision = 'working' | string;
export type NavigationContextDefinition = {
  schemaVersion: 1; id: string; labels: KnowledgeText; description?: KnowledgeText;
  origin: 'user-organization' | 'source-profile'; profile?: { id: string; version: string };
};
export type NavigationSourceRef = { sourceId: string; revision: string | null; contentHash: string; locator?: string };
export type NavigationImportMethod = 'paired-import' | 'knowledge.fileAdopt' | 'knowledge.adoptJob' | 'collection.adopt' | 'wikipedia.adopt';
export type NavigationSourceSelection = 'source-claim-subjects' | 'subjects-and-referenced-objects';
export type NavigationBatchRef =
  | { kind: 'adopted-import'; operationId: string; method: NavigationImportMethod; inputHash: string; objectSetHash: string; previewId?: string }
  | { kind: 'saved-source'; selection: NavigationSourceSelection; revision: NavigationRevision; sourceId: string; sourceRevision: string | null; sourceHash: string; selectionHash: string; objectSetHash: string };
export type NavigationMembershipBasis = NavigationBatchRef | { kind: 'trusted-bundle'; bundleId: string; manifestHash: string; objectSetHash: string };
export type NavigationMembership = {
  contextId: string; objectId: string;
  decision: { kind: 'manual' | 'profile'; recordedAt: string; rationale?: string; profile?: { id: string; version: string } };
  batchRef: NavigationMembershipBasis; sourceRefs?: NavigationSourceRef[];
};
/** A host-pinned bundle supplies data; the service attaches the verified manifest basis. */
export type NavigationBootstrapDefinition = NavigationContextDefinition & { origin: 'source-profile'; profile: { id: string; version: string } };
export type NavigationBootstrapMembership = Omit<NavigationMembership,'batchRef'|'sourceRefs'|'decision'> & { sourceRefs: NavigationSourceRef[]; decision: NavigationMembership['decision'] & { kind: 'profile'; profile: { id: string; version: string } } };
export type NavigationBootstrap = { schemaVersion: 1; definitions: NavigationBootstrapDefinition[]; memberships: NavigationBootstrapMembership[]; typeRoles?: { typeId: string; role: KnowledgeNavigationRole }[]; sourcePresentations?: import('./knowledge-workspace-types.ts').KnowledgeSourcePresentation[] };
export type NavigationMembershipShard = { schemaVersion: 1; partitionVersion: 1; contextId: string; partition: string; members: NavigationMembership[] };
export type NavigationPageRequest = { offset?: number; limit?: number };
export type NavigationPage<T> = { items: T[]; total: number; offset: number; limit: number };
export type NavigationCounts = { objects: number; assigned: number; unassigned: number };
export type NavigationContextSummary = { definition: NavigationContextDefinition; contentHash: string; members: number };
export type NavigationContextList = NavigationPage<NavigationContextSummary> & { revision: NavigationRevision; head: string; counts: NavigationCounts };
export type NavigationContextRead = {
  definition: NavigationContextDefinition; contentHash: string; contextHash: string; revision: NavigationRevision; head: string;
  members: NavigationMembership[]; total: number; offset: number; limit: number;
};
export type NavigationSaveRequest = {
  operationId: string; expectedHead: string; expectedContentHash: string | null; contextId?: string;
  labels: KnowledgeText; description?: KnowledgeText;
};
export type NavigationSaveResult = { contextId: string; contentHash: string; head: string; paths: string[] };
export type NavigationBatchSummary = {
  batchKey: string; batch: NavigationBatchRef; labels: KnowledgeText; sourceRefs: NavigationSourceRef[]; sourceRefCount: number;
  objects: number; directObjects: number; relatedObjects: number; unresolvedObjects: number;
  status: 'complete' | 'unavailable'; reason?: 'import-conflicts' | 'incomplete-import-result' | 'missing-objects' | 'import-origin-unavailable';
};
export type NavigationBatchObject = { id: string; labels: KnowledgeText; basis: 'direct' | 'related' };
export type NavigationBatchPage = NavigationPage<NavigationBatchSummary> & { revision: NavigationRevision; head: string };
export type NavigationBatchObjects = NavigationPage<NavigationBatchObject> & { batch: NavigationBatchRef; objectSetHash: string; directObjects: number; relatedObjects: number };
export type NavigationBatchSources = NavigationPage<NavigationSourceRef> & { batch: NavigationBatchRef };
export type NavigationMembershipCounts = { selected: number; already: number; added: number; removed: number; unchanged: number };
export type NavigationMembershipPlanRequest = {
  contextId: string; expectedHead: string; expectedDefinitionHash: string; batch: NavigationBatchRef;
  mode: 'add' | 'remove'; rationale?: string;
};
export type NavigationMembershipPlan = {
  planId: string; planHash: string; baseHead: string; contextId: string; contextHash: string;
  batch: NavigationBatchRef; objectSetHash: string; counts: NavigationMembershipCounts; mode: 'add' | 'remove';
  dependencies: string[]; paths: string[];
};
export type NavigationPlanPage = NavigationMembershipPlan & NavigationPage<NavigationBatchObject>;
export type NavigationApplyRequest = { operationId: string; planId: string; expectedPlanHash: string };
export type NavigationApplyResult = { contextId: string; head: string; paths: string[]; counts: NavigationMembershipCounts; planId: string };
export type NavigationPendingOperation = {
  operationId: string; kind: 'save' | 'membership'; baseHead: string; contextId: string;
  planId?: string; counts?: NavigationMembershipCounts;
};
export type NavigationResumeResult = { kind: 'save'; result: NavigationSaveResult } | { kind: 'membership'; result: NavigationApplyResult };
export type NavigationChangeSummary =
  | { kind: 'context-definition'; contextId: string; beforeLabels?: KnowledgeText; afterLabels?: KnowledgeText; fields: string[] }
  | { kind: 'context-membership'; contextId: string; labels: KnowledgeText; before: number; after: number; added: number; removed: number; modified: number; objects: { objectId: string; kind: 'added' | 'removed' | 'modified' }[]; totalObjects: number; sampleLimit: number };
export type NavigationRecipe = { schemaVersion: 1; revision: NavigationRevision; query: KnowledgeQuery };
/** Effects patch one scope dimension; applying them never changes historical fixed slots. */
export type NavigationScopePatch =
  | { type: 'selection'; selection: { mode: 'all' } | { mode: 'unassigned' } | { mode: 'contexts'; contextIds: string[] }; revision?: NavigationRevision }
  | { type: 'filters'; filters: Pick<KnowledgeQuery, 'time' | 'typeIds' | 'text' | 'includeUndated' | 'includeUnlocated' | 'review'> }
  | { type: 'reset' };
export type NavigationCommandIntent =
  | { type: 'contexts'; revision?: NavigationRevision; offset?: number; limit?: number }
  | { type: 'context'; contextId: string; revision?: NavigationRevision; offset?: number; limit?: number }
  | { type: 'create'; labels: KnowledgeText; description?: KnowledgeText }
  | { type: 'use'; selection: Extract<NavigationScopePatch, { type: 'selection' }>['selection']; revision?: NavigationRevision }
  | { type: 'filter'; filters: Extract<NavigationScopePatch, { type: 'filters' }>['filters'] }
  | { type: 'reset' }
  | { type: 'batches'; revision?: NavigationRevision; offset?: number; limit?: number }
  | { type: 'assign'; contextId: string; batchKey: string; revision?: NavigationRevision; mode?: 'add' | 'remove'; rationale?: string }
  | { type: 'apply'; planId: string; expectedPlanHash?: string };

export type NavigationServiceMethods = {
  'context.list': { params: NavigationPageRequest & { revision?: NavigationRevision; text?: string }; result: NavigationContextList };
  'context.get': { params: NavigationPageRequest & { contextId: string; revision?: NavigationRevision }; result: NavigationContextRead };
  'context.save': { params: NavigationSaveRequest; result: NavigationSaveResult };
  'context.batches': { params: NavigationPageRequest & { revision?: NavigationRevision; batchKey?: string; inputHash?: string; previewId?: string }; result: NavigationBatchPage };
  'context.batchObjects': { params: NavigationPageRequest & { batch: NavigationBatchRef }; result: NavigationBatchObjects };
  'context.batchSources': { params: NavigationPageRequest & { batch: NavigationBatchRef }; result: NavigationBatchSources };
  'context.membershipPlan': { params: NavigationMembershipPlanRequest; result: NavigationMembershipPlan };
  'context.plan': { params: NavigationPageRequest & { planId: string }; result: NavigationPlanPage };
  'context.applyMembership': { params: NavigationApplyRequest; result: NavigationApplyResult };
  'context.pending': { params: Record<string, never>; result: NavigationPendingOperation[] };
  'context.resume': { params: { operationId: string }; result: NavigationResumeResult };
};
