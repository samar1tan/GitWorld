import type { KnowledgeTemporalScope, KnowledgeValue } from '../../domain/src/knowledge.ts';
import type { KnowledgeFieldCatalog, KnowledgeObjectDetail, KnowledgeSourceHeader } from './knowledge-workspace-types.ts';

export type KnowledgeEditContext = {
  head: string; object: KnowledgeObjectDetail | null; objectHash: string | null;
  catalog: KnowledgeFieldCatalog; sources: KnowledgeSourceHeader[];
};
export type KnowledgeEditEvidence =
  | { sourceId: string; locator: string; citation?: string }
  | { title: string; url: string; locator: string; citation?: string };
type KnowledgeEditFields = {
  propertyId: string;
  /** Correct: omitted preserves the original scope; null explicitly removes it. */
  validTime?: KnowledgeTemporalScope | null;
  evidence: KnowledgeEditEvidence; review: 'unreviewed' | 'adopted'; reason: string;
};
export type KnowledgeEditChange = KnowledgeEditFields & (
  | { mode: 'add'; value: KnowledgeValue; newObject?: { labels: Record<string, string>; types: string[] } }
  | { mode: 'correct'; value?: KnowledgeValue; newObject?: never }
);
export type KnowledgeSaveEditRequest = {
  operationId: string; expectedHead: string; expectedObjectHash: string | null;
  objectId?: string; assertionId?: string; change: KnowledgeEditChange;
};
export type KnowledgeSaveEditResult = { objectId: string; assertionId: string; objectHash: string; head: string; paths: string[] };
