import type { CommandCompletion, CommandEffect, CommandExecution, CommandIntent, HistoryContext, HistoryText } from '../../domain/src/history-types.ts';
import type { DataPackage } from '../../domain/src/package.ts';
import type { KnowledgeHistory, KnowledgeState, KnowledgeStateDiff, KnowledgeStateRequest } from '../../domain/src/knowledge.ts';
import type { EditorialBranch, EditorialCommit, EditorialStatus } from './editorial-types.ts';
import type { RepositoryDiff, ServiceError } from './index.ts';
import type { NavigationApplyResult, NavigationBatchPage, NavigationCommandIntent, NavigationContextList, NavigationContextRead, NavigationMembershipPlan, NavigationSaveResult, NavigationScopePatch } from './navigation-types.ts';

/** Validators accept only Working or an actual 40-hex repository commit OID. */
export type ModelRevision = 'working' | string;
export type ModelWorkingReceipt = { path: string; contentHash: string; head: string };
export type ModelCatalogEntry = {
  datasetId: string; name: HistoryText; path: string; contentHash: string;
  authoredRevisionId: string; headContentHash: string | null; working: boolean;
};
export type ModelCatalog = { revision: ModelRevision; head: string; models: ModelCatalogEntry[] };
export type ModelRead = ModelWorkingReceipt & { datasetId: string; revision: ModelRevision; package: DataPackage };
export type ModelWriteGuards = { expectedHead: string; expectedModelHash: string | null };

export type ModelCommandTarget = { kind: 'model'; modelId: string; revision: ModelRevision };
export type ModelHistoricalReference = ModelCommandTarget & { ref: string };
export type ModelComparisonIntent = { type: 'compare'; a: ModelHistoricalReference; b: ModelHistoricalReference; mode?: 'endpoints' | 'merge-base' };
export type ObjectCommandTarget = { kind: 'object'; objectId: string; revision: ModelRevision };
export type HistoricalCommandTarget = ModelCommandTarget | ObjectCommandTarget;
export type ObjectStateReference = ObjectCommandTarget & { year: number; includeUnreviewed?: boolean };
export type RepositoryCommandIntent =
  | { type: 'status' }
  | { type: 'diff'; mode: 'working' | 'staged'; paths?: string[]; offset?: number; limit?: number }
  | { type: 'add' | 'unstage'; paths: string[] }
  | { type: 'commit'; message: string }
  | { type: 'log'; limit?: number }
  | { type: 'branch'; name?: string }
  | { type: 'switch'; name: string }
  | { type: 'checkout'; oid: string }
  | { type: 'revert'; commitOid: string }
  | { type: 'abort-revert' };
export type ObjectHistoryIntent =
  | { type: 'show' | 'checkout'; state: Omit<KnowledgeStateRequest, 'objectId'> }
  | { type: 'log'; propertyIds?: string[]; includeUnreviewed?: boolean }
  | { type: 'diff'; a: Omit<KnowledgeStateRequest, 'objectId'>; b: ObjectStateReference & { propertyIds?: string[]; includeUnreviewed?: boolean } };
export type WorkbenchCommandIntent =
  | { family: 'git'; intent: RepositoryCommandIntent }
  | { family: 'scope'; intent: NavigationCommandIntent }
  | { family: 'history'; target: ModelCommandTarget; intent: CommandIntent | ModelComparisonIntent; context: HistoryContext }
  | { family: 'history'; target: ObjectCommandTarget; intent: ObjectHistoryIntent };
export type WorkbenchCommandRequest = {
  input: { command: string } | { intent: WorkbenchCommandIntent };
  /** Model command context is explicit semantic state, independent of the open activity. */
  context?: HistoryContext;
  contextTarget?: ModelCommandTarget;
  /** Explicit scope-query revision for commands that preserve the current revision. */
  scopeRevision?: import('./navigation-types.ts').NavigationRevision;
  /** Required by textual/typed commit and revert, carrying the user's reviewed repository state. */
  operationId?: string; expectedHead?: string; expectedTree?: string;
};
export type WorkbenchCommandEffect =
  | { type: 'none' }
  | { type: 'scope'; patch: NavigationScopePatch }
  | { type: 'repository'; operation: RepositoryCommandIntent['type'] }
  | { type: 'model'; target: ModelCommandTarget; effect: CommandEffect }
  | { type: 'model-compare'; a: ModelHistoricalReference; b: ModelHistoricalReference; effect: Extract<CommandEffect, { type: 'compare' }> }
  | { type: 'object-preview' | 'object-checkout'; reference: ObjectStateReference }
  | { type: 'object-history'; target: ObjectCommandTarget; includeUnreviewed: boolean }
  | { type: 'object-compare'; a: ObjectStateReference; b: ObjectStateReference };
export type WorkbenchCommandOutput =
  | { kind: 'help'; commands: string[] }
  | { kind: 'scope-contexts'; contexts: NavigationContextList }
  | { kind: 'scope-context'; context: NavigationContextRead }
  | { kind: 'scope-batches'; batches: NavigationBatchPage }
  | { kind: 'scope-plan'; plan: NavigationMembershipPlan }
  | { kind: 'scope-saved'; result: NavigationSaveResult }
  | { kind: 'scope-applied'; result: NavigationApplyResult }
  | { kind: 'scope-change'; patch: NavigationScopePatch }
  | { kind: 'repository-status'; status: EditorialStatus }
  | { kind: 'repository-diff'; diff: RepositoryDiff }
  | { kind: 'repository-log'; commits: EditorialCommit[] }
  | { kind: 'repository-branches'; branches: EditorialBranch[] }
  | { kind: 'repository-commit'; commit: EditorialCommit }
  | { kind: 'model'; target: ModelCommandTarget; execution: Extract<CommandExecution, { ok: true }>; comparison?: { a: ModelHistoricalReference; b: ModelHistoricalReference; commonBaseStatus: 'computed' | 'different-revisions' } }
  | { kind: 'object-state'; target: ObjectCommandTarget; state: KnowledgeState }
  | { kind: 'object-history'; target: ObjectCommandTarget; history: KnowledgeHistory }
  | { kind: 'object-diff'; a: ObjectStateReference; b: ObjectStateReference; diff: KnowledgeStateDiff };
export type WorkbenchCommandError = ServiceError & { subject?: string; candidates?: string[]; replacement?: string };
export type WorkbenchCommandExecution =
  | { ok: true; command: string; output: WorkbenchCommandOutput; effect: WorkbenchCommandEffect }
  | { ok: false; command: string; error: WorkbenchCommandError; effect: { type: 'none' } };
export type WorkbenchCompletion = CommandCompletion;
