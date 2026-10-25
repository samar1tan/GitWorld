import type { KnowledgeCollection, KnowledgeJson, KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { KnowledgeFieldCatalog, KnowledgeLocalizedDisplay } from './knowledge-workspace-types.ts';

export type KnowledgeVocabularyOrigin = {
  identity: { provider: string; externalId: string }; url: string; retrievedAt: string;
  rights: KnowledgeSource['rights'];
  evidence: { sourceId: string; sourceHash: string; locator: string }[];
};
export type KnowledgeVocabulary = { id: string; revision: string; catalog: KnowledgeFieldCatalog; origin: KnowledgeVocabularyOrigin };
export type KnowledgeImportArtifact = {
  schemaVersion: 1; kind: 'gitworld-knowledge-import'; collection: KnowledgeCollection;
  vocabulary?: KnowledgeVocabulary;
  projection?: {
    profileId: string; profileVersion: string; libraryRevision: string;
    sourcePins: { sourceId: string; contentHash: string; revision: string | null }[];
    plan: KnowledgeJson; exceptions: { code: string; locator: string }[];
  };
  sourceRights?: KnowledgeJson;
};
export type KnowledgeVocabularyConflict = { key: string; language: string; local: string; incoming: string };
export type KnowledgeVocabularySummary = { id: string; revision: string; catalog: KnowledgeFieldCatalog; origin: KnowledgeVocabularyOrigin; properties: number; types: number; values: number; missing: { key: string; language: 'en' | 'zh-CN' }[]; missingCount: number; conflicts: KnowledgeVocabularyConflict[]; conflictCount: number };
export type KnowledgeVocabularyPresentation = {
  fingerprint: string; origin: 'git' | 'legacy' | 'none';
  legacyFingerprint?: string;
  properties: Record<string, KnowledgeLocalizedDisplay>; types: Record<string, KnowledgeLocalizedDisplay>;
  values: Record<string, Record<string, KnowledgeLocalizedDisplay>>;
};
export type KnowledgePendingImport = {
  operationId: string; previewId: string; baseHead: string;
  counts: { objects: number; assertions: number; datedAssertions: number; locatedObjects: number };
  vocabulary?: { id: string; revision: string };
  review?: 'unreviewed' | 'adopted';
};
export type KnowledgeResumeImportRequest = { operationId: string; previewId: string };
