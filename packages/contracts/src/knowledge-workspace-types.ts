import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeNavigationRole, KnowledgeObject, KnowledgeObjectResult, KnowledgeReview, KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { KnowledgeVocabularyPresentation, KnowledgeVocabularySummary } from './knowledge-import-types.ts';
export type KnowledgeObjectBundle = { schemaVersion: 1; object: KnowledgeObject; assertions: KnowledgeAssertion[] };
export type KnowledgeMappingPreview = {
  inputHash: string; objects: number; assertions: number; datedAssertions: number; locatedObjects: number;
  issues: { code: string; locator: string }[]; issueCount: number;
  sample: KnowledgeObjectResult[]; mappingVersions: string[];
  prepared?: { id: string; fingerprintVersion: 2; baseHead: string };
  vocabulary?: KnowledgeVocabularySummary;
};
export type KnowledgeImportContinuation = { kind: 'wikipedia-mapping'; jobId: string };
export type KnowledgeImportConflict = { objectId: string; base: KnowledgeObjectBundle | null; local: KnowledgeObjectBundle | null; incoming: KnowledgeObjectBundle; continuation?: KnowledgeImportContinuation };
export type KnowledgeImportResult = { preview: KnowledgeMappingPreview; changedObjects: string[]; unchangedObjects: string[]; paths?: string[]; objects?: { id: string; labels: Record<string,string> }[]; totalObjects?: number; continuation?: KnowledgeImportContinuation; batch?: { schemaVersion: 1; inputObjectSetHash: string; acceptedObjectSetHash: string; sourceRefs: { sourceId: string; revision: string | null; contentHash: string }[] }; conflicts: KnowledgeImportConflict[] };
/** Collection names are separate from original source titles and exact source identity. */
export type KnowledgeSourcePresentation = { sourceId: string; revision: string | null; contentHash: string; labels: { en: string; 'zh-CN': string } };
export type KnowledgeSourcePresentations = { schemaVersion: 1; kind: 'gitworld-source-presentations'; sources: KnowledgeSourcePresentation[] };
export type KnowledgeSourceHeader = Omit<KnowledgeSource, 'record'> & { labels?: Record<string, string>; title?: Record<string, string>; historyUrl?: string; changes?: string[] };
export type KnowledgeDisplayEvidence = {
  sourceId: string; method: string; language: string; text: string; assertionId?: string; objectId?: string;
  evidence: { url: string; locator: string; sourceSnapshotHash?: string; citation?: string }[];
};
export type KnowledgeDisplayText = {
  text?: string; language?: string; status: 'original' | 'translated' | 'missing' | 'conflict'; provenance: KnowledgeDisplayEvidence[];
  origin?: 'git' | 'legacy';
};
export type KnowledgeLocalizedDisplay = Record<'en' | 'zh-CN', KnowledgeDisplayText>;
export type KnowledgeFieldCatalog = {
  schemaVersion: 1; kind: 'historical-field-display-labels';
  properties: { id: string; labels: Record<string, string> }[]; types: { id: string; labels: Record<string, string>; navigationRole?: KnowledgeNavigationRole }[];
  values?: { propertyId: string; value: string; labels: Record<string, string> }[];
  semanticNotes?: { ids: string[]; en: string; 'zh-CN': string }[];
};
/** Display-only metadata for the selected object and referenced entities, never the complete source ledger. */
export type KnowledgeObjectPresentation = {
  fingerprint: string;
  objects: Record<string, { labels: Record<string, string>; display: KnowledgeLocalizedDisplay }>;
  properties: Record<string, Record<string, string>>; types: Record<string, Record<string, string>>;
  values: Record<string, KnowledgeLocalizedDisplay>;
  qualifierValues: Record<string, Record<string, Record<string, string>>>;
  notes: { ids: string[]; en: string; 'zh-CN': string }[];
  vocabulary?: KnowledgeVocabularyPresentation;
};
export type KnowledgeObjectDetail = { object: KnowledgeObjectResult; assertions: KnowledgeAssertion[]; sources: KnowledgeSourceHeader[]; revision: string; working: boolean; display?: KnowledgeObjectPresentation };
export type KnowledgeImportRequest = { jobId: string; expectedHead: string; expectedInputHash: string; review: Exclude<KnowledgeReview, 'rejected'>; operationId: string };
export type KnowledgeFilePreviewRequest = { fileToken: string };
export type KnowledgeFilePreviewResult = { fileName: string; bytes: number; preview: KnowledgeMappingPreview };
export type KnowledgeFileImportRequest = KnowledgeFilePreviewRequest & Omit<KnowledgeImportRequest, 'jobId'> & { previewId?: string };
export type KnowledgeCollectionRead = { collection: KnowledgeCollection; revision: string; working: boolean; fingerprint?: string; catalog?: KnowledgeFieldCatalog; vocabulary?: KnowledgeVocabularyPresentation; sourcePresentations?: KnowledgeSourcePresentation[] };
