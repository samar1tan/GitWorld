import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { AcquisitionReceipt, ExternalRecordIdentity, JsonValue, SnapshotReceipt, SourceIssue, SourceRecordSnapshot, SourceResult, SourceSearchHit, WikidataSearchPage } from './source-types.ts';
export type { WikidataSearchPage } from './source-types.ts';

export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
export const WIKIDATA_ADAPTER = 'wikidata-action-api-v1';
const USER_AGENT = 'GitWorld/0.1 source-ingestion (https://github.com/samar1tan/GitWorld)';
const MAX_BYTES = 16 * 1024 * 1024;
const BATCH_SIZE = 20;
const entityId = /^(Q|P)[1-9][0-9]{0,15}$/;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const identity = (externalId: string): ExternalRecordIdentity => ({ provider: 'wikidata', externalId });
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = <T>(error: SourceIssue): SourceResult<T> => ({ ok: false, error });
const invalid = (): SourceIssue => ({ code: 'INVALID_REQUEST', retryable: false });

/** Sorted object keys retain array order and every original statement property. */
export function canonicalSourceJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSourceJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalSourceJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

type Dependencies = { fetch?: typeof fetch; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => Date };
type RequestOptions = { signal?: AbortSignal; interactive?: boolean };
type ResponseRecord = { value: Record<string, JsonValue>; text: string; url: string; retrievedAt: string; responseHash: string };
export type WikidataEntityBatch = {
  snapshots: SourceRecordSnapshot[];
  records: SnapshotReceipt[];
  issues: SourceIssue[];
  response: { url: string; retrievedAt: string; contentHash: string; bytes: number };
  /** Original public API bytes for host-side staging; do not send through UI lists. */
  rawResponse: string;
};
class SourceFailure extends Error {
  readonly issue: SourceIssue;
  constructor(issue: SourceIssue) { super(issue.code); this.issue = issue; }
}
function cancelled(): SourceFailure { return new SourceFailure({ code: 'CANCELLED', retryable: true }); }
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); done(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function retryDelay(response: Response, attempt: number, now: Date): number {
  const value = response.headers.get('retry-after');
  const seconds = value && /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : NaN;
  const absolute = value ? Date.parse(value) - now.getTime() : NaN;
  return Math.max(5000 * 2 ** attempt, Number.isFinite(seconds) ? seconds : Number.isFinite(absolute) ? Math.max(0, absolute) : 0);
}
async function body(response: Response): Promise<string> {
  if (!response.body) throw new SourceFailure({ code: 'INVALID_RESPONSE', retryable: true });
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw new SourceFailure({ code: 'RESPONSE_TOO_LARGE', retryable: false }); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new SourceFailure({ code: 'RESPONSE_TOO_LARGE', retryable: false });
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function request(params: Record<string, string>, options: RequestOptions, dependencies: Dependencies): Promise<SourceResult<ResponseRecord>> {
  const url = new URL(WIKIDATA_API);
  // Only an explicitly user-initiated lookup may omit maxlag. Background jobs
  // retain it: https://www.mediawiki.org/wiki/Manual:Maxlag_parameter
  for (const [key, value] of Object.entries({ format: 'json', formatversion: '2', ...(!options.interactive ? { maxlag: '5' } : {}), ...params })) url.searchParams.set(key, value);
  const requestUrl = url.toString();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (options.signal?.aborted) return fail({ code: 'CANCELLED', retryable: true, requestUrl });
    let issue: SourceIssue, delay = 5000 * 2 ** attempt;
    try {
      const response = await (dependencies.fetch ?? fetch)(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]), headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      delay = retryDelay(response, attempt, dependencies.now?.() ?? new Date());
      if (!response.ok) {
        await response.body?.cancel();
        issue = { code: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', retryable: [429, 502, 503, 504].includes(response.status), status: response.status, requestUrl, retryAfterMs: delay };
      } else {
        const text = await body(response);
        let value: unknown;
        try { value = JSON.parse(text); } catch { throw new SourceFailure({ code: 'INVALID_RESPONSE', retryable: false }); }
        if (!object(value)) throw new SourceFailure({ code: 'INVALID_RESPONSE', retryable: false });
        if (object(value.error)) {
          const providerCode = typeof value.error.code === 'string' ? value.error.code : 'unknown';
          issue = { code: providerCode === 'maxlag' ? 'UPSTREAM_BUSY' : providerCode === 'ratelimited' ? 'RATE_LIMITED' : 'API_ERROR', retryable: ['maxlag', 'ratelimited', 'readonly'].includes(providerCode), providerCode, requestUrl, retryAfterMs: delay };
        } else return { ok: true, value: { value, text, url: requestUrl, retrievedAt: (dependencies.now?.() ?? new Date()).toISOString(), responseHash: sha256(text) } };
      }
    } catch (error) {
      issue = options.signal?.aborted ? { code: 'CANCELLED', retryable: true, requestUrl } : error instanceof SourceFailure ? { ...error.issue, requestUrl } : { code: 'NETWORK_FAILED', retryable: true, requestUrl, retryAfterMs: delay };
    }
    if (!issue.retryable || issue.code === 'CANCELLED' || attempt === 2 || delay > 30_000) return fail(issue);
    try { await (dependencies.sleep ?? wait)(delay, options.signal); } catch { return fail({ code: 'CANCELLED', retryable: true, requestUrl }); }
  }
  return fail({ code: 'NETWORK_FAILED', retryable: true, requestUrl });
}

/** Keyword/name search; no free-form historical question interpretation. */
export async function searchWikidataEntities(options: { query: string; language?: string; limit?: number; cursor?: string; entityType?: 'item' | 'property'; interactive?: boolean; signal?: AbortSignal }, dependencies: Dependencies = {}): Promise<SourceResult<WikidataSearchPage>> {
  const query = options.query.trim(), language = options.language ?? 'en', limit = options.limit ?? 20;
  if (!query || query.length > 200 || !/^[a-z][a-z0-9-]{0,20}$/.test(language) || !Number.isInteger(limit) || limit < 1 || limit > 50 || (options.cursor !== undefined && (!/^\d{1,5}$/.test(options.cursor) || Number(options.cursor) > 10_000)) || (options.entityType !== undefined && !['item', 'property'].includes(options.entityType)) || (options.interactive !== undefined && typeof options.interactive !== 'boolean')) return fail(invalid());
  const response = await request({ action: 'wbsearchentities', search: query, language, uselang: language, limit: String(limit), type: options.entityType ?? 'item', ...(options.cursor ? { continue: options.cursor } : {}) }, options, dependencies);
  if (!response.ok) return response;
  const data = response.value.value;
  if (!Array.isArray(data.search) || data.search.length > limit) return fail({ code: 'INVALID_RESPONSE', retryable: false });
  const hits: SourceSearchHit[] = [];
  for (const hit of data.search) {
    if (!object(hit) || typeof hit.id !== 'string' || !entityId.test(hit.id)) return fail({ code: 'INVALID_RESPONSE', retryable: false });
    const displayLabel = object(hit.display) && object(hit.display.label) ? hit.display.label : null;
    hits.push({ identity: identity(hit.id), label: typeof hit.label === 'string' ? hit.label : hit.id, ...(typeof hit.description === 'string' ? { description: hit.description } : {}), url: `https://www.wikidata.org/wiki/${hit.id}`, ...(displayLabel && typeof displayLabel.language === 'string' ? { language: displayLabel.language } : {}) });
  }
  const next = data['search-continue'];
  if (next !== undefined && (typeof next !== 'number' || !Number.isSafeInteger(next) || next <= Number(options.cursor ?? -1))) return fail({ code: 'INVALID_RESPONSE', retryable: false });
  const continuationLimitReached = typeof next === 'number' && next > 10_000;
  return { ok: true, value: { hits, nextCursor: next === undefined || continuationLimitReached ? null : String(next), continuationLimitReached, query, language, retrievedAt: response.value.retrievedAt, requestUrl: response.value.url, responseHash: response.value.responseHash } };
}

function validEntity(raw: JsonValue, id: string): raw is Record<string, JsonValue> {
  if (!object(raw) || raw.id !== id || !Number.isSafeInteger(raw.lastrevid) || Number(raw.lastrevid) < 1 || !object(raw.claims)) return false;
  return Object.entries(raw.claims).every(([property, statements]) => /^P[1-9]\d*$/.test(property) && Array.isArray(statements) && statements.every(statement => object(statement) && typeof statement.id === 'string' && object(statement.mainsnak) && statement.mainsnak.property === property && ['preferred', 'normal', 'deprecated'].includes(String(statement.rank))));
}

/** Fetches complete statements, including deprecated ranks and all qualifiers/references. */
export async function fetchWikidataEntities(options: { entityIds: string[]; signal?: AbortSignal }, dependencies: Dependencies = {}): Promise<SourceResult<WikidataEntityBatch>> {
  if (!options.entityIds.length || options.entityIds.length > 50 || options.entityIds.some(id => !entityId.test(id)) || new Set(options.entityIds).size !== options.entityIds.length) return fail(invalid());
  const response = await request({ action: 'wbgetentities', ids: options.entityIds.join('|'), props: 'info|labels|descriptions|aliases|claims|sitelinks', redirects: 'yes' }, { signal: options.signal }, dependencies);
  if (!response.ok) return response;
  const entities = response.value.value.entities;
  if (!object(entities)) return fail({ code: 'INVALID_RESPONSE', retryable: false });
  const redirects = new Map<string, string>();
  const rawRedirects = response.value.value.redirects;
  if (rawRedirects !== undefined) {
    if (!Array.isArray(rawRedirects)) return fail({ code: 'INVALID_RESPONSE', retryable: false });
    for (const entry of rawRedirects) {
      if (!object(entry) || typeof entry.from !== 'string' || typeof entry.to !== 'string' || !entityId.test(entry.from) || !entityId.test(entry.to)) return fail({ code: 'INVALID_RESPONSE', retryable: false });
      redirects.set(entry.from, entry.to);
    }
  }
  const snapshots: SourceRecordSnapshot[] = [], records: SnapshotReceipt[] = [], issues: SourceIssue[] = [];
  for (const requestedId of options.entityIds) {
    let id = requestedId; const visited = new Set<string>();
    while (redirects.has(id) && !visited.has(id)) { visited.add(id); id = redirects.get(id)!; }
    const raw = entities[id];
    if (raw === undefined || (object(raw) && Object.hasOwn(raw, 'missing'))) { issues.push({ code: 'RECORD_MISSING', externalId: requestedId, retryable: false }); continue; }
    if (visited.has(id) || !validEntity(raw, id)) { issues.push({ code: 'INVALID_RESPONSE', externalId: requestedId, retryable: false }); continue; }
    const contentHash = sha256(canonicalSourceJson(raw)), sourceRevision = String(raw.lastrevid);
    if (!snapshots.some(snapshot => snapshot.identity.externalId === id)) snapshots.push({ identity: identity(id), sourceRevision, retrievedAt: response.value.retrievedAt, url: `https://www.wikidata.org/wiki/${id}`, revisionUrl: `https://www.wikidata.org/wiki/Special:EntityData/${id}.json?revision=${sourceRevision}`, contentHash, mediaType: 'application/json', raw, rights: { licenseId: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'Wikidata', redistribution: 'allowed' }, adapterVersion: WIKIDATA_ADAPTER });
    records.push({ requestedIdentity: identity(requestedId), identity: identity(id), sourceRevision, contentHash, retrievedAt: response.value.retrievedAt });
  }
  return { ok: true, value: { snapshots, records, issues, response: { url: response.value.url, retrievedAt: response.value.retrievedAt, contentHash: response.value.responseHash, bytes: Buffer.byteLength(response.value.text) }, rawResponse: response.value.text } };
}

type Checkpoint = { schemaVersion: 1; receipt: AcquisitionReceipt; responses: { file: string; contentHash: string; url: string; retrievedAt: string }[] };
export type WikidataAcquisition = { receipt: AcquisitionReceipt; directory: string | null; pending: ExternalRecordIdentity[] };
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, path);
}
async function boundedFile(path: string): Promise<string> {
  const stat = await lstat(path); if (!stat.isFile() || stat.size > MAX_BYTES * 2) throw new Error('invalid staged file');
  return readFile(path, 'utf8');
}
async function stageSnapshot(directory: string, snapshot: SourceRecordSnapshot): Promise<void> {
  const path = join(directory, `snapshots/${snapshot.contentHash}.json`);
  try { await writeFile(path, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await boundedFile(path)) as SourceRecordSnapshot;
    if (existing.identity.externalId !== snapshot.identity.externalId || existing.contentHash !== snapshot.contentHash || sha256(canonicalSourceJson(existing.raw)) !== snapshot.contentHash) throw new Error('existing snapshot integrity');
  }
}
/** Hash verification makes staged records reusable without re-fetching successful batches. */
export async function readWikidataSnapshot(directory: string, record: SnapshotReceipt): Promise<SourceRecordSnapshot> {
  if (!/^[a-f0-9]{64}$/.test(record.contentHash) || record.file !== `snapshots/${record.contentHash}.json`) throw new Error('invalid snapshot receipt');
  const snapshot = JSON.parse(await boundedFile(join(directory, record.file))) as SourceRecordSnapshot;
  if (snapshot.adapterVersion !== WIKIDATA_ADAPTER || snapshot.identity.provider !== 'wikidata' || snapshot.identity.externalId !== record.identity.externalId || snapshot.sourceRevision !== record.sourceRevision || snapshot.contentHash !== record.contentHash || !validEntity(snapshot.raw, snapshot.identity.externalId) || snapshot.sourceRevision !== String(snapshot.raw.lastrevid) || sha256(canonicalSourceJson(snapshot.raw)) !== record.contentHash) throw new Error('snapshot integrity mismatch');
  // The content-addressed file retains its first envelope. Every observation has
  // its own receipt timestamp and raw-response receipt, including redirects.
  if (!Number.isFinite(Date.parse(record.retrievedAt))) throw new Error('invalid retrieval timestamp');
  return { ...snapshot, retrievedAt: record.retrievedAt };
}

/** Host-side acquisition only: never creates a DataPackage, branch, state, or adopted claim. */
export async function acquireWikidataEntities(options: { entityIds: string[]; stagingDirectory?: string; resumeDirectory?: string; dryRun?: boolean; signal?: AbortSignal; onProgress?: (value: { completed: number; total: number }) => void }, dependencies: Dependencies = {}): Promise<SourceResult<WikidataAcquisition>> {
  if (!options.entityIds.length || options.entityIds.length > 10_000 || options.entityIds.some(id => !entityId.test(id)) || new Set(options.entityIds).size !== options.entityIds.length || (options.dryRun && options.resumeDirectory)) return fail(invalid());
  const time = () => (dependencies.now?.() ?? new Date()).toISOString();
  let checkpoint: Checkpoint = { schemaVersion: 1, receipt: { id: randomUUID(), adapter: WIKIDATA_ADAPTER, startedAt: time(), completedAt: time(), status: 'partial', requested: options.entityIds.map(identity), snapshots: [], issues: [] }, responses: [] };
  let directory: string | null = null;
  if (!options.dryRun) {
    if (!options.stagingDirectory || !isAbsolute(options.stagingDirectory)) return fail(invalid());
    if (options.resumeDirectory) {
      const root = resolve(options.stagingDirectory), resumed = resolve(options.resumeDirectory);
      if (!isAbsolute(options.resumeDirectory) || !resumed.startsWith(`${root}${sep}`)) return fail(invalid());
      try {
        if (!(await lstat(resumed)).isDirectory()) throw new Error('directory');
        const loaded = JSON.parse(await boundedFile(join(resumed, 'receipt.json'))) as Checkpoint;
        if (loaded.schemaVersion !== 1 || loaded.receipt?.adapter !== WIKIDATA_ADAPTER || !Array.isArray(loaded.receipt.requested) || loaded.receipt.requested.some(r => r.provider !== 'wikidata') || !Array.isArray(loaded.receipt.snapshots) || !Array.isArray(loaded.responses) || canonicalSourceJson(loaded.receipt.requested.map(r => r.externalId).sort()) !== canonicalSourceJson([...options.entityIds].sort()) || loaded.receipt.snapshots.length > options.entityIds.length) throw new Error('manifest');
        const seen = new Set<string>();
        for (const record of loaded.receipt.snapshots) {
          if (record.requestedIdentity.provider !== 'wikidata' || !options.entityIds.includes(record.requestedIdentity.externalId) || seen.has(record.requestedIdentity.externalId)) throw new Error('entry');
          seen.add(record.requestedIdentity.externalId); await readWikidataSnapshot(resumed, record);
        }
        for (const response of loaded.responses) {
          if (!/^[a-f0-9]{64}$/.test(response.contentHash) || response.file !== `responses/${response.contentHash}.json` || sha256(await boundedFile(join(resumed, response.file))) !== response.contentHash) throw new Error('response integrity');
        }
        checkpoint = loaded; checkpoint.receipt.issues = []; directory = resumed;
      } catch { return fail({ code: 'CHECKPOINT_INVALID', retryable: false }); }
    } else {
      directory = join(options.stagingDirectory, `wikidata-${checkpoint.receipt.id}`);
      try { await mkdir(join(directory, 'snapshots'), { recursive: true, mode: 0o700 }); await mkdir(join(directory, 'responses'), { mode: 0o700 }); await atomicJson(join(directory, 'receipt.json'), checkpoint); }
      catch { return fail({ code: 'STAGING_FAILED', retryable: true }); }
    }
  }
  const completed = new Set(checkpoint.receipt.snapshots.map(record => record.requestedIdentity.externalId));
  const remaining = options.entityIds.filter(id => !completed.has(id));
  for (let offset = 0; offset < remaining.length; offset += BATCH_SIZE) {
    if (options.signal?.aborted) { checkpoint.receipt.issues.push({ code: 'CANCELLED', retryable: true }); break; }
    const batchIds = remaining.slice(offset, offset + BATCH_SIZE);
    const batch = await fetchWikidataEntities({ entityIds: batchIds, signal: options.signal }, dependencies);
    if (!batch.ok) {
      checkpoint.receipt.issues.push(...batchIds.map(externalId => ({ ...batch.error, externalId })));
      // Do not continue hammering a busy service with the remaining batches.
      if (batch.error.retryable || batch.error.code === 'CANCELLED') break;
      continue;
    }
    try {
      if (directory) {
        const file = `responses/${batch.value.response.contentHash}.json`;
        await writeFile(join(directory, file), batch.value.rawResponse, { mode: 0o600 });
        for (const snapshot of batch.value.snapshots) await stageSnapshot(directory, snapshot);
        checkpoint.responses.push({ file, contentHash: batch.value.response.contentHash, url: batch.value.response.url, retrievedAt: batch.value.response.retrievedAt });
      }
      for (const record of batch.value.records) { checkpoint.receipt.snapshots.push({ ...record, ...(directory ? { file: `snapshots/${record.contentHash}.json` } : {}) }); completed.add(record.requestedIdentity.externalId); }
      checkpoint.receipt.issues.push(...batch.value.issues); checkpoint.receipt.completedAt = time();
      if (directory) await atomicJson(join(directory, 'receipt.json'), checkpoint);
    } catch { return fail({ code: 'STAGING_FAILED', retryable: true }); }
    // UI observers do not own or roll back successful acquisition work.
    try { options.onProgress?.({ completed: completed.size, total: options.entityIds.length }); } catch { /* The persisted receipt remains authoritative. */ }
  }
  const pending = options.entityIds.filter(id => !completed.has(id)).map(identity);
  checkpoint.receipt.completedAt = time();
  checkpoint.receipt.status = checkpoint.receipt.issues.some(issue => issue.code === 'CANCELLED') ? 'cancelled' : !pending.length ? 'complete' : completed.size ? 'partial' : 'failed';
  if (directory) { try { await atomicJson(join(directory, 'receipt.json'), checkpoint); } catch { return fail({ code: 'STAGING_FAILED', retryable: true }); } }
  return { ok: true, value: { receipt: checkpoint.receipt, directory, pending } };
}
