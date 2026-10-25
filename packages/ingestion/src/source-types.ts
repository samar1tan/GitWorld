/** Provider transport objects are not adopted claims or historical model nodes. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ExternalRecordIdentity = { provider: string; externalId: string };
export type SourceSearchHit = { identity: ExternalRecordIdentity; label: string; description?: string; url: string; language?: string };
export type WikidataSearchPage = {
  hits: SourceSearchHit[];
  nextCursor: string | null;
  continuationLimitReached: boolean;
  query: string;
  language: string;
  retrievedAt: string;
  requestUrl: string;
  /** One search page, not an estimate of all relevant historical entities. */
  responseHash: string;
};
export type SourceRecordSnapshot = {
  identity: ExternalRecordIdentity;
  sourceRevision: string | null;
  retrievedAt: string;
  url: string;
  revisionUrl?: string;
  /** SHA-256 of canonical JSON for raw, not the original HTTP response bytes. */
  contentHash: string;
  mediaType: string;
  raw: JsonValue;
  rights: { licenseId?: string; licenseUrl?: string; attribution?: string; redistribution: 'allowed' | 'restricted' | 'unknown' };
  adapterVersion: string;
};
export type SourceIssue = {
  code: 'INVALID_REQUEST' | 'NETWORK_FAILED' | 'HTTP_ERROR' | 'RATE_LIMITED' | 'UPSTREAM_BUSY' | 'API_ERROR' | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'RECORD_MISSING' | 'CANCELLED' | 'STAGING_FAILED' | 'CHECKPOINT_INVALID';
  retryable: boolean;
  externalId?: string;
  requestUrl?: string;
  providerCode?: string;
  status?: number;
  retryAfterMs?: number;
};
export type SourceResult<T> = { ok: true; value: T } | { ok: false; error: SourceIssue };
export type SnapshotReceipt = { requestedIdentity: ExternalRecordIdentity; identity: ExternalRecordIdentity; sourceRevision: string | null; contentHash: string; retrievedAt: string; file?: string };
export type AcquisitionReceipt = {
  id: string;
  adapter: string;
  startedAt: string;
  completedAt: string;
  status: 'complete' | 'partial' | 'cancelled' | 'failed';
  requested: ExternalRecordIdentity[];
  snapshots: SnapshotReceipt[];
  issues: SourceIssue[];
};
