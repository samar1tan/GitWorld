import type { HistoryText } from '../../domain/src/history-types.ts';
import type { SourceIssue } from '../../ingestion/src/source-types.ts';

export type CollectionProvider = 'cliopatria' | 'pleiades';
export type CollectionCatalogEntry = {
  id: CollectionProvider; title: HistoryText; description: HistoryText; limitations: HistoryText;
  revision: string; downloadBytes: number; licenseId: string; licenseUrl: string;
  filters: ('text' | 'years')[];
};
export type CollectionQuery = { text?: string; years?: [number, number]; limit: number; startRecord: number };
export type CollectionMappingIssue = { code: string; locator: string; details?: string };
/** An exclusion count has a scan boundary, never an invented per-record locator. */
export type CollectionIssueAggregate = { code: 'SKIPPED_INVALID_RECORDS'; count: number; afterRecord: number; throughRecord: number };
export type CollectionIssuesPage = {
  jobId: string; items: CollectionMappingIssue[]; offset: number; limit: number;
  /** Number of retained concrete issues available through pagination. */
  total: number;
  coverage: 'complete' | 'legacy-partial';
  /** Earlier summaries counted mapping issues and aggregate exclusions together. */
  reportedCount: number;
  aggregates: CollectionIssueAggregate[];
  /** The matching local snapshot may be used to rebuild; integrity is checked before use. */
  canRebuild: boolean;
};
export type CollectionJob = {
  id: string; provider: CollectionProvider; query: CollectionQuery;
  startedAt: string; updatedAt: string; status: 'acquiring' | 'complete' | 'interrupted' | 'failed' | 'cancelled';
  source: { url: string; revision: string; contentHash: string; bytes: number; cached: boolean; licenseId: string; licenseUrl: string } | null;
  records: number; objects: number; assertions: number; datedAssertions: number; locatedObjects: number;
  scanned: number; nextRecord: number | null; truncated: boolean;
  /** Compatibility preview only. The complete mapping report is read through collection.issues. */
  issues: CollectionMappingIssue[]; issueCount: number; failure: SourceIssue | null;
};
