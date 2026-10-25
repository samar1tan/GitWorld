import type { NavigationRecipe } from './navigation-types.ts';
import type { KnowledgeText } from '../../domain/src/knowledge.ts';
/** A query is explicit scope/filter state, never an instruction to a model. */
export type ResearchScope = {
  query: string;
  timeWindow: [number, number] | null;
  objectIds: string[];
  fieldIds: string[];
  label?: string;
  navigation?: NavigationRecipe;
  model?: { datasetId: string; repositoryRevision: string; scopeId: string | null; processId: string | null };
};

export type PinnedResearchEvidence = {
  id: string;
  kind: 'source' | 'assertion' | 'object' | 'historical-state';
  title: string;
  locator: string;
  repositoryRevision: string;
  year?: number;
  includeUnreviewed?: boolean;
  objectId?: string;
  /** An authored model target always retains its package identity and exact historical ref. */
  modelId?: string;
  historicalRef?: string;
  assertionId?: string;
  sourceIdentity?: { provider: string; externalId: string };
  sourceRevision?: string;
  url?: string;
};
export type ResearchComparisonEndpoint = {
  label: string;
  labels?: KnowledgeText;
  repositoryRevision: string;
  objectId?: string;
  modelId?: string;
  historicalRef?: string;
  year?: number | null;
  includeUnreviewed?: boolean;
};
export type PinnedResearchComparison = { a: ResearchComparisonEndpoint; b: ResearchComparisonEndpoint };
export type ResearchRecord = {
  schemaVersion: 1;
  id: string;
  title: string;
  scope: ResearchScope;
  interpretation: string;
  openQuestions: string[];
  evidence: PinnedResearchEvidence[];
  comparison: PinnedResearchComparison | null;
  updatedAt: string;
};
export type ResearchRecordEnvelope = { record: ResearchRecord; contentHash: string; repositoryRevision: string | null };
export type ResearchRecordSummary = Pick<ResearchRecord, 'id' | 'title' | 'scope' | 'updatedAt'>;
export type ResearchRecordRevision = { oid: string; message: string; authoredAt: string };
export type ResearchWorkspaceApi = {
  list(): Promise<ResearchRecordSummary[]>;
  get(id: string): Promise<ResearchRecordEnvelope>;
  save(record: ResearchRecord, expectedHash: string | null): Promise<ResearchRecordEnvelope>;
  history(id: string): Promise<ResearchRecordRevision[]>;
  readRevision(id: string, oid: string): Promise<ResearchRecordEnvelope>;
};
export type ResearchContext = {
  scope: ResearchScope;
  evidence?: PinnedResearchEvidence[];
  comparison?: PinnedResearchComparison | null;
};
