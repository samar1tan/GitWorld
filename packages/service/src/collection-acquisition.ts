import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex, type KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { acquireCliopatriaRelease, readCliopatriaZip, CLIOPATRIA_VERIFIED_RELEASE } from '../../ingestion/src/cliopatria.ts';
import { readPleiadesDump, PLEIADES_JSON_BASE, PLEIADES_LICENSE } from '../../ingestion/src/pleiades.ts';
import { acquirePinnedDownload } from '../../ingestion/src/pinned-download.ts';
import { combineKnowledgeCollections, mapSourceSnapshot } from '../../ingestion/src/knowledge-mapping.ts';
import type { SourceIssue } from '../../ingestion/src/source-types.ts';
import type { CollectionCatalogEntry, CollectionIssueAggregate, CollectionIssuesPage, CollectionJob, CollectionMappingIssue, CollectionProvider, CollectionQuery } from '../../contracts/src/collection-types.ts';
import type { ServiceError } from '../../contracts/src/index.ts';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const PLEIADES_RELEASE = { version: '20261024', bytes: 135_794_599, hash: '3fe750c7981940c996d69ea37f665b3d44f64a9526ed7c3ae0a510e1ec6b99e4' };
export const COLLECTION_CATALOG: CollectionCatalogEntry[] = [
  { id: 'cliopatria', title: { en: 'Cliopatria · historical geography', 'zh-CN': 'Cliopatria · 历史地理' },
    description: { en: 'Acquire dated polity and geographic observation frames from a public dataset.', 'zh-CN': '从公开数据集获取带日期的政体与地理观测记录。' },
    limitations: { en: 'Names form provisional source objects. Frame dates are geographic observations, not polity lifetimes; external IDs may be inconsistent.', 'zh-CN': '对象按来源暂定归组。日期描述地理观测范围，不代表政体存续时间；外部标识可能有误。' },
    revision: CLIOPATRIA_VERIFIED_RELEASE.tag, downloadBytes: CLIOPATRIA_VERIFIED_RELEASE.bytes, licenseId: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', filters: ['text', 'years'] },
  { id: 'pleiades', title: { en: 'Pleiades · ancient places', 'zh-CN': 'Pleiades · 古代地名与地点' },
    description: { en: 'Acquire place records, attested names, locations and dated connections.', 'zh-CN': '获取古代地点、地名见证、位置与带日期的关联。' },
    limitations: { en: 'Attestation and source coverage do not establish a place’s foundation, renaming or political history.', 'zh-CN': '地名见证与来源覆盖范围不能直接证明建城、改名或政治沿革。' },
    revision: PLEIADES_RELEASE.version, downloadBytes: PLEIADES_RELEASE.bytes, licenseId: 'CC-BY-3.0', licenseUrl: PLEIADES_LICENSE, filters: ['text'] },
];
type Document = { schemaVersion: 1; signature: string; summary: CollectionJob; collectionHash: string | null; issuesHash?: string };
type IssueLedger = { schemaVersion: 1; jobId: string; sourceContentHash: string; collectionHash: string; items: CollectionMappingIssue[]; aggregates: CollectionIssueAggregate[] };
type Dependencies = { fetch?: typeof fetch };
export class CollectionAcquisitionFailure extends Error {
  readonly detail: ServiceError;
  constructor(code: ServiceError['code']) { super(code); this.detail = { code }; }
}
const validId = (id: string) => /^[a-f0-9]{64}$/.test(id);
const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
async function atomicJson(destination: string, value: unknown) {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { const file = await open(temporary, 'wx', 0o600); try { await file.writeFile(canonicalJson(value)); await file.sync(); } finally { await file.close(); } await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
}
async function boundedJson(file: string, maxBytes: number): Promise<unknown> {
  const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > maxBytes) throw new Error('VALIDATION_FAILED');
  return JSON.parse(await readFile(file, 'utf8'));
}
async function verifyCachedBytes(file: string, expected: { bytes: number; hash: string }, signal?: AbortSignal) {
  const hash = createHash('sha256'); let bytes = 0;
  try {
    for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024, signal })) {
      if (signal?.aborted) throw new CollectionAcquisitionFailure('CANCELLED');
      bytes += chunk.length; if (bytes > expected.bytes) throw new CollectionAcquisitionFailure('VALIDATION_FAILED');
      hash.update(chunk);
    }
  } catch (cause) { if (signal?.aborted) throw new CollectionAcquisitionFailure('CANCELLED'); throw cause; }
  if (bytes !== expected.bytes || hash.digest('hex') !== expected.hash) throw new CollectionAcquisitionFailure('VALIDATION_FAILED');
}

/** Host-owned catalog acquisition. Raw downloads and completed batches stay in the backed-up library. */
export function createCollectionAcquisition(dataDirectory: string, dependencies: Dependencies = {}) {
  const root = path.join(path.resolve(dataDirectory), 'collections'), active = new Set<string>();
  const jobPath = (id: string) => { if (!validId(id)) throw new Error('INVALID_REQUEST'); return path.join(root, 'jobs', `${id}.json`); };
  const collectionPath = (id: string) => { jobPath(id); return path.join(root, 'batches', `${id}.json`); };
  const issuesPath = (id: string, hash: string) => { jobPath(id); if (!validId(hash)) throw new CollectionAcquisitionFailure('VALIDATION_FAILED'); return path.join(root, 'issues', id, `${hash}.json`); };
  const validIssue = (value: CollectionMappingIssue) => !!value && typeof value.code === 'string' && value.code.length > 0 && value.code.length <= 100 && typeof value.locator === 'string' && value.locator.length > 0 && value.locator.length <= 2048 && (value.details === undefined || typeof value.details === 'string' && value.details.length <= 4096);
  const validAggregate = (value: CollectionIssueAggregate) => !!value && value.code === 'SKIPPED_INVALID_RECORDS' && Number.isSafeInteger(value.count) && value.count > 0 && Number.isSafeInteger(value.afterRecord) && value.afterRecord >= 0 && Number.isSafeInteger(value.throughRecord) && value.throughRecord >= value.afterRecord;
  async function document(id: string): Promise<Document> {
    const value = await boundedJson(jobPath(id), 256 * 1024) as Document;
    if (value.schemaVersion !== 1 || value.summary?.id !== id || !COLLECTION_CATALOG.some(entry => entry.id === value.summary.provider) || typeof value.signature !== 'string' || !(value.collectionHash === null || validId(value.collectionHash)) || value.issuesHash !== undefined && !validId(value.issuesHash) || !Array.isArray(value.summary.issues) || !value.summary.issues.every(validIssue) || !Number.isSafeInteger(value.summary.issueCount) || value.summary.issueCount < value.summary.issues.length) throw new Error('VALIDATION_FAILED');
    return value;
  }
  async function read(id: string): Promise<KnowledgeCollection> {
    const job = await document(id); if (job.summary.status !== 'complete' || !job.collectionHash) throw new Error('REVIEW_REQUIRED');
    const value = await boundedJson(collectionPath(id), 512 * 1024 * 1024) as KnowledgeCollection;
    if (digest(canonicalJson(value)) !== job.collectionHash) throw new Error('VALIDATION_FAILED');
    createKnowledgeIndex(value); return value;
  }
  function cacheDefinition(job: CollectionJob) {
    if (!job.source) return null;
    const release = CLIOPATRIA_VERIFIED_RELEASE, fileName = job.provider === 'cliopatria' ? `cliopatria-${release.tag}.zip` : `pleiades-places-${PLEIADES_RELEASE.version}.json.gz`;
    const expected = job.provider === 'cliopatria' ? { url: release.url, hash: release.contentHash, bytes: release.bytes, revisions: [release.tag, release.commit, release.revision] as string[] } : { url: `${PLEIADES_JSON_BASE}${fileName}`, hash: PLEIADES_RELEASE.hash, bytes: PLEIADES_RELEASE.bytes, revisions: [`${PLEIADES_RELEASE.version}@${PLEIADES_RELEASE.hash}`] };
    if (job.source.url !== expected.url || job.source.contentHash !== expected.hash || job.source.bytes !== expected.bytes || !expected.revisions.includes(job.source.revision)) return null;
    return { ...expected, file: path.join(root, 'downloads', job.provider, fileName) };
  }
  async function cached(job: CollectionJob) {
    const definition = cacheDefinition(job); if (!definition) return null;
    try { const info = await lstat(definition.file); return info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size === definition.bytes ? definition : null; }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  async function saveIssues(saved: Document, items: CollectionMappingIssue[], aggregates: CollectionIssueAggregate[]) {
    if (!saved.collectionHash || !saved.summary.source || !items.every(validIssue) || !aggregates.every(validAggregate)) throw new CollectionAcquisitionFailure('VALIDATION_FAILED');
    const ledger: IssueLedger = { schemaVersion: 1, jobId: saved.summary.id, sourceContentHash: saved.summary.source.contentHash, collectionHash: saved.collectionHash, items, aggregates };
    const json = canonicalJson(ledger); if (Buffer.byteLength(json) > 128 * 1024 * 1024) throw new CollectionAcquisitionFailure('VALIDATION_FAILED');
    const hash = digest(json);
    await atomicJson(issuesPath(saved.summary.id, hash), ledger); saved.issuesHash = hash;
    saved.summary.issues = items.slice(0, 30); saved.summary.issueCount = items.length + aggregates.reduce((sum, value) => sum + value.count, 0);
  }
  async function issues(input: { jobId: string; offset: number; limit: number }): Promise<CollectionIssuesPage> {
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 1_000_000 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new CollectionAcquisitionFailure('INVALID_REQUEST');
    let saved: Document; try { saved = await document(input.jobId); } catch (error) { if (missing(error)) throw new CollectionAcquisitionFailure('NOT_FOUND'); throw error; }
    let items = saved.summary.issues, aggregates: CollectionIssueAggregate[] = [], coverage: CollectionIssuesPage['coverage'] = saved.summary.issueCount > items.length ? 'legacy-partial' : 'complete';
    if (saved.issuesHash) {
      const ledger = await boundedJson(issuesPath(input.jobId, saved.issuesHash), 128 * 1024 * 1024) as IssueLedger;
      if (digest(canonicalJson(ledger)) !== saved.issuesHash || ledger.schemaVersion !== 1 || ledger.jobId !== input.jobId || ledger.sourceContentHash !== saved.summary.source?.contentHash || ledger.collectionHash !== saved.collectionHash || !Array.isArray(ledger.items) || !ledger.items.every(validIssue) || !Array.isArray(ledger.aggregates) || !ledger.aggregates.every(validAggregate) || ledger.items.length + ledger.aggregates.reduce((sum, value) => sum + value.count, 0) !== saved.summary.issueCount) throw new CollectionAcquisitionFailure('VALIDATION_FAILED');
      items = ledger.items; aggregates = ledger.aggregates; coverage = 'complete';
    }
    return { jobId: input.jobId, items: structuredClone(items.slice(input.offset, input.offset + input.limit)), offset: input.offset, limit: input.limit, total: items.length, coverage, reportedCount: saved.summary.issueCount, aggregates: structuredClone(aggregates), canRebuild: coverage === 'legacy-partial' && saved.summary.status === 'complete' && !!await cached(saved.summary) };
  }
  async function rebuildIssues(input: { jobId: string; signal?: AbortSignal; onProgress?: (progress: { stage: 'normalizing'; completed: number; total?: number }) => void }): Promise<CollectionIssuesPage> {
    if (active.has(input.jobId)) throw new CollectionAcquisitionFailure('OPERATION_IN_PROGRESS');
    active.add(input.jobId);
    try {
      if (input.signal?.aborted) throw new CollectionAcquisitionFailure('CANCELLED');
      let saved: Document; try { saved = await document(input.jobId); } catch (cause) { if (missing(cause)) throw new CollectionAcquisitionFailure('NOT_FOUND'); throw cause; }
      const job = saved.summary;
      if (job.status !== 'complete' || !job.source) throw new CollectionAcquisitionFailure('REVIEW_REQUIRED');
      const snapshot = await cached(job); if (!snapshot) throw new CollectionAcquisitionFailure('NOT_FOUND');
      if (input.signal?.aborted) throw new CollectionAcquisitionFailure('CANCELLED');
      await verifyCachedBytes(snapshot.file, snapshot, input.signal);
      const original = await read(input.jobId), retrievedAt = original.sources[0]?.retrievedAt ?? job.startedAt;
      const progress = (completed: number) => { try { input.onProgress?.({ stage: 'normalizing', completed, total: job.records }); } catch { /* Report observers cannot change a retained batch. */ } };
      progress(0);
      let collection: KnowledgeCollection, details: CollectionMappingIssue[], aggregates: CollectionIssueAggregate[] = [];
      if (job.provider === 'cliopatria') {
        const parsed = await readCliopatriaZip({ file: snapshot.file, url: job.source.url, revision: job.source.revision, retrievedAt, startRecord: job.query.startRecord, limit: job.query.limit, filter: { ...(job.query.text ? { text: job.query.text } : {}), ...(job.query.years ? { years: job.query.years } : {}) }, signal: input.signal });
        if (!parsed.ok) throw new CollectionAcquisitionFailure(parsed.error.code === 'CANCELLED' ? 'CANCELLED' : 'VALIDATION_FAILED');
        collection = parsed.value.collection; details = parsed.value.issues.map(value => ({ code: value.code, locator: `feature[${value.record}]`, ...(value.details ? { details: value.details } : {}) }));
      } else {
        const parsed = await readPleiadesDump({ file: snapshot.file, sourceRevision: job.source.revision, retrievedAt, sourceUrl: job.source.url, startRecord: job.query.startRecord, limit: job.query.limit, ...(job.query.text ? { filter: { text: job.query.text } } : {}), signal: input.signal, onProgress: value => progress(value.completed) });
        if (!parsed.ok) throw new CollectionAcquisitionFailure(parsed.error.code === 'CANCELLED' ? 'CANCELLED' : 'VALIDATION_FAILED');
        const mapped = parsed.value.snapshots.map(value => mapSourceSnapshot(value)), combined = combineKnowledgeCollections(mapped.map(value => value.collection));
        if (combined.conflicts.length) throw new CollectionAcquisitionFailure('CONFLICT');
        collection = combined.collection; details = mapped.flatMap((value, index) => value.issues.map(issue => ({ ...issue, locator: `${parsed.value.snapshots[index].url}#${issue.locator}` })));
        if (parsed.value.report.skippedInvalid) aggregates = [{ code: 'SKIPPED_INVALID_RECORDS', count: parsed.value.report.skippedInvalid, afterRecord: job.query.startRecord, throughRecord: parsed.value.report.scanned }];
      }
      if (input.signal?.aborted) throw new CollectionAcquisitionFailure('CANCELLED');
      if (digest(canonicalJson(collection)) !== saved.collectionHash) throw new CollectionAcquisitionFailure('CONTENT_CHANGED');
      await saveIssues(saved, details, aggregates);
      if (input.signal?.aborted) throw new CollectionAcquisitionFailure('CANCELLED');
      saved.summary.updatedAt = new Date().toISOString(); await atomicJson(jobPath(input.jobId), saved); progress(job.records);
      return issues({ jobId: input.jobId, offset: 0, limit: 40 });
    } finally { active.delete(input.jobId); }
  }
  return {
    read, issues, rebuildIssues,
    async list(): Promise<CollectionJob[]> {
      let entries: string[]; try { entries = await readdir(path.join(root, 'jobs')); } catch (error) { if (missing(error)) return []; throw error; }
      const summaries: CollectionJob[] = [];
      for (const entry of entries.filter(entry => /^[a-f0-9]{64}\.json$/.test(entry))) {
        const value = (await document(entry.slice(0, -5))).summary;
        summaries.push(value.status === 'acquiring' && !active.has(value.id) ? { ...value, status: 'interrupted' } : value);
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async acquire(input: { provider: CollectionProvider; query: CollectionQuery; operationId: string; resumeJobId?: string; signal?: AbortSignal; onProgress?: (progress: { stage: 'acquiring' | 'normalizing'; completed: number; total?: number }) => void }): Promise<CollectionJob> {
      const signature = digest(canonicalJson({ provider: input.provider, query: input.query }));
      const id = input.resumeJobId ?? digest(input.operationId); let prior: Document | null = null;
      if (active.has(id)) throw new Error('OPERATION_IN_PROGRESS');
      try { prior = await document(id); } catch (error) { if (!missing(error)) throw error; }
      if (input.resumeJobId && !prior || prior && prior.signature !== signature) throw new Error('INVALID_REQUEST');
      if (prior?.summary.status === 'complete') return structuredClone(prior.summary);
      const now = new Date().toISOString(), summary: CollectionJob = { id, provider: input.provider, query: structuredClone(input.query), startedAt: prior?.summary.startedAt ?? now, updatedAt: now, status: 'acquiring', source: null, records: 0, objects: 0, assertions: 0, datedAssertions: 0, locatedObjects: 0, scanned: 0, nextRecord: null, truncated: false, issues: [], issueCount: 0, failure: null };
      const saved: Document = { schemaVersion: 1, signature, summary, collectionHash: null }; active.add(id);
      const progress = (value: Parameters<NonNullable<typeof input.onProgress>>[0]) => { try { input.onProgress?.(value); } catch { /* Observers cannot alter acquired content. */ } };
      const fail = async (failure: SourceIssue) => { summary.failure = failure; summary.status = failure.code === 'CANCELLED' ? 'cancelled' : 'failed'; summary.updatedAt = new Date().toISOString(); await atomicJson(jobPath(id), saved); return structuredClone(summary); };
      try {
        await atomicJson(jobPath(id), saved); let collection: KnowledgeCollection, details: CollectionMappingIssue[] = [], aggregates: CollectionIssueAggregate[] = [];
        if (input.provider === 'cliopatria') {
          const downloaded = await acquireCliopatriaRelease({ directory: path.join(root, 'downloads', 'cliopatria'), signal: input.signal, onProgress: value => progress({ stage: 'acquiring', completed: value.bytes, total: value.totalBytes }) }, dependencies);
          if (!downloaded.ok) return await fail(downloaded.error);
          const receipt = downloaded.value;
          summary.source = { url: receipt.url, revision: receipt.revision, contentHash: receipt.contentHash, bytes: receipt.bytes, cached: receipt.cached, licenseId: receipt.licenseId, licenseUrl: receipt.licenseUrl };
          progress({ stage: 'normalizing', completed: 0 });
          const parsed = await readCliopatriaZip({ ...receipt, startRecord: input.query.startRecord, limit: input.query.limit, filter: { ...(input.query.text ? { text: input.query.text } : {}), ...(input.query.years ? { years: input.query.years } : {}) }, signal: input.signal });
          if (!parsed.ok) return await fail(parsed.error);
          collection = parsed.value.collection;
          summary.records = parsed.value.report.selected; summary.scanned = parsed.value.report.scanned; summary.nextRecord = parsed.value.report.nextRecord; summary.truncated = parsed.value.report.truncated;
          details = parsed.value.issues.map(value => ({ code: value.code, locator: `feature[${value.record}]`, ...(value.details ? { details: value.details } : {}) }));
        } else {
          if (input.query.years) throw new Error('INVALID_REQUEST');
          const fileName = `pleiades-places-${PLEIADES_RELEASE.version}.json.gz`;
          const downloaded = await acquirePinnedDownload({ url: `${PLEIADES_JSON_BASE}${fileName}`, fileName, bytes: PLEIADES_RELEASE.bytes, contentHash: PLEIADES_RELEASE.hash }, { directory: path.join(root, 'downloads', 'pleiades'), signal: input.signal, onProgress: value => progress({ stage: 'acquiring', completed: value.bytes, total: value.totalBytes }) }, dependencies);
          if (!downloaded.ok) return await fail(downloaded.error);
          const receipt = downloaded.value;
          summary.source = { url: receipt.url, revision: `${PLEIADES_RELEASE.version}@${receipt.contentHash}`, contentHash: receipt.contentHash, bytes: receipt.bytes, cached: receipt.cached, licenseId: 'CC-BY-3.0', licenseUrl: PLEIADES_LICENSE };
          const parsed = await readPleiadesDump({ file: receipt.file, sourceRevision: summary.source.revision, retrievedAt: receipt.retrievedAt, sourceUrl: receipt.url, startRecord: input.query.startRecord, limit: input.query.limit, ...(input.query.text ? { filter: { text: input.query.text } } : {}), signal: input.signal, onProgress: value => progress({ stage: 'normalizing', completed: value.completed }) });
          if (!parsed.ok) return await fail(parsed.error);
          const mapped = parsed.value.snapshots.map(snapshot => mapSourceSnapshot(snapshot));
          const combined = combineKnowledgeCollections(mapped.map(value => value.collection)); if (combined.conflicts.length) throw new Error('CONFLICT');
          collection = combined.collection;
          details = mapped.flatMap((value, index) => value.issues.map(issue => ({ ...issue, locator: `${parsed.value.snapshots[index].url}#${issue.locator}` })));
          if (parsed.value.report.skippedInvalid) aggregates = [{ code: 'SKIPPED_INVALID_RECORDS', count: parsed.value.report.skippedInvalid, afterRecord: input.query.startRecord, throughRecord: parsed.value.report.scanned }];
          summary.records = parsed.value.report.selected; summary.scanned = parsed.value.report.scanned; summary.nextRecord = parsed.value.report.nextRecord; summary.truncated = parsed.value.report.truncated;
        }
        if (input.signal?.aborted) return await fail({ code: 'CANCELLED', retryable: true });
        const stats = createKnowledgeIndex(collection).stats();
        Object.assign(summary, { objects: stats.objects, assertions: stats.assertions, datedAssertions: stats.datedAssertions, locatedObjects: stats.locatedObjects, status: 'complete', updatedAt: new Date().toISOString() });
        saved.collectionHash = digest(canonicalJson(collection));
        await saveIssues(saved, details, aggregates); await atomicJson(collectionPath(id), collection); await atomicJson(jobPath(id), saved);
        progress({ stage: 'normalizing', completed: summary.records, total: summary.records }); return structuredClone(summary);
      } catch (error) { return await fail({ code: input.signal?.aborted ? 'CANCELLED' : 'STAGING_FAILED', retryable: true }); }
      finally { active.delete(id); }
    },
  };
}
