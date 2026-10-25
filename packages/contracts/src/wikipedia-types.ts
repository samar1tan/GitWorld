import type { AcquisitionReceipt, SourceIssue, SourceRecordSnapshot } from '../../ingestion/src/source-types.ts';
import type { KnowledgeImportResult, KnowledgeMappingPreview, KnowledgeSourceHeader } from './knowledge-workspace-types.ts';
import type { KnowledgeAssertion, KnowledgeJson, KnowledgeObject } from '../../domain/src/knowledge.ts';

export type WikipediaCollectRequest = { title: string; revision?: number; operationId: string; resumeJobId?: string };
export type WikipediaJob = { id: string; requested: { title: string; revision?: number }; receipt: AcquisitionReceipt; source?: { pageId: string; title: string; revision: string; contentHash: string; retrievedAt: string; url: string; rights: SourceRecordSnapshot['rights'] } };
export type WikipediaJobPage = { total: number; jobs: WikipediaJob[]; issues: { jobId: string; code: 'CHECKPOINT_INVALID' }[] };
export type WikipediaProfile = { id: 'office-tenures-v1' | 'dated-entries-v1'; version: '1'; labels: { en: string; 'zh-CN': string }; semantics: { en: string; 'zh-CN': string } };
export type WikipediaTableInspection = { index: number; headers: string[]; headerHash: string; caption: string; headings: string[]; rows: number; columns: number; sample: { row: number; cells: { column: number; text: string; truncated: boolean }[] }[] };
export type WikipediaInspection = { job: WikipediaJob; profiles: WikipediaProfile[]; totalTables: number; tables: WikipediaTableInspection[]; offset: number; limit: number };
export type WikipediaTableBinding = { tableIndex: number; headerHash: string; holderColumn: number; tenureColumn?: number; startColumn?: number; endColumn?: number; firstDataRow?: number };
export type WikipediaMappingSelection =
  | { profileId: 'office-tenures-v1'; tables: WikipediaTableBinding[]; calendar?: 'Gregorian' | 'Julian' }
  | { profileId: 'dated-entries-v1'; tableIndex: number; headerHash: string; timeColumn: number; columns: { column: number; kind: 'text' | 'linked-entities' }[]; calendar?: 'Gregorian' | 'Julian' };
export type WikipediaPreviewRequest = { jobId: string; sourceHash: string; expectedHead: string; selection: WikipediaMappingSelection };
export type WikipediaMappingPreview = { jobId: string; sourceHash: string; selection: WikipediaMappingSelection; profile: WikipediaProfile; plan: KnowledgeJson; sample: { objects: KnowledgeObject[]; assertions: KnowledgeAssertion[]; sources: KnowledgeSourceHeader[] }; preview: KnowledgeMappingPreview; counts: { sourceRows: number; mappedRows: number; objects: number; assertions: number; datedAssertions: number; applicableAssertions: number; timedRows: number }; exceptions: { code: string; locator: string }[]; exceptionCount: number };
export type WikipediaIssuesRequest = { jobId: string; previewId: string; expectedInputHash: string; offset?: number; limit?: number };
export type WikipediaIssuesPage = { jobId: string; previewId: string; inputHash: string; reportHash: string; total: number; offset: number; limit: number; issues: { code: string; locator: string }[] };
export type WikipediaAdoptRequest = { jobId: string; previewId: string; expectedHead: string; expectedInputHash: string; review: 'unreviewed' | 'adopted'; operationId: string };
export type WikipediaAdoption = KnowledgeImportResult;
export type WikipediaSourceIssue = SourceIssue;
