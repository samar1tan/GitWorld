import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SourceJob, SourceJobList, SourceLabel, SourceMaterialSummary, SourceRecordDetail } from '../../contracts/src/index.ts';
import { acquireWikidataEntities, canonicalSourceJson, fetchWikidataEntities, readWikidataSnapshot, WIKIDATA_ADAPTER } from '../../ingestion/src/index.ts';
import type { AcquisitionReceipt, JsonValue, SourceIssue, SourceRecordSnapshot, SourceResult } from '../../ingestion/src/index.ts';

type Dependencies = { fetch?: typeof fetch };
type CollectInput = { entityIds: string[]; operationId: string; resumeJobId?: string };
type CollectOptions = { signal?: AbortSignal; onProgress?: (progress: { completed: number; total: number; stage?: 'acquiring' | 'normalizing' }) => void };
type RequestRecord = { schemaVersion: 1; id: string; entityIds: string[]; createdAt: string };
type OperationRecord = { schemaVersion: 1; jobId: string; signature: string; complete: boolean };
type Checkpoint = { schemaVersion: 1; receipt: AcquisitionReceipt; responses: { file: string; contentHash: string; url: string; retrievedAt: string }[] };
type SummaryCache = { schemaVersion: 1; checkpointHash: string; materials: SourceMaterialSummary[]; labelIssues: SourceIssue[] };
const opaqueId = /^[a-f0-9]{64}$/;
const entityId = /^(Q|P)[1-9][0-9]{0,15}$/;
const propertyId = /^P[1-9][0-9]{0,15}$/;
const acquisitionName = /^wikidata-[a-f0-9-]{36}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function error(code: string): never { throw new Error(code); }
const invalid = <T>(): SourceResult<T> => ({ ok: false, error: { code: 'INVALID_REQUEST', retryable: false } });
const isMissing = (value: unknown) => object(value) && value.code === 'ENOENT';
const isoDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

async function directory(path: string, create = false): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) error('CHECKPOINT_INVALID');
}
async function json(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) error('CHECKPOINT_INVALID');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function optionalJson(path: string): Promise<unknown | undefined> {
  try { return await json(path); } catch (caught) { if (isMissing(caught)) return undefined; throw caught; }
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
    const parent = await open(dirname(path), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } catch (caught) { await rm(temporary, { force: true }); throw caught; }
}
const sameIds = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
function labels(raw: unknown, field = 'labels'): SourceLabel {
  const values = object(raw) && object(raw[field]) ? raw[field] : {};
  const text = (key: string) => object(values[key]) && typeof values[key].value === 'string' ? values[key].value : undefined;
  const en = text('en'), zh = text('zh-hans') ?? text('zh-cn') ?? text('zh');
  return { ...(en ? { en } : {}), ...(zh ? { zh } : {}) };
}
function material(snapshot: SourceRecordSnapshot): SourceMaterialSummary {
  const raw = object(snapshot.raw) ? snapshot.raw : {};
  const claims = object(raw.claims) ? raw.claims : {};
  const description = labels(raw, 'descriptions');
  return { identity: snapshot.identity, label: labels(raw), ...(Object.keys(description).length ? { description } : {}),
    sourceRevision: snapshot.sourceRevision, claimCount: Object.values(claims).reduce<number>((count, values) => count + (Array.isArray(values) ? values.length : 0), 0),
    kind: snapshot.identity.externalId.startsWith('P') ? 'property' : 'item' };
}
/** Traverse statements and qualifiers, never schedule entity-valued Q IDs. */
function statementProperties(snapshot: SourceRecordSnapshot): string[] {
  const found = new Set<string>(), stack: unknown[] = [object(snapshot.raw) ? snapshot.raw.claims : null];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) stack.push(...current);
    else if (object(current)) for (const [key, value] of Object.entries(current)) {
      if (propertyId.test(key)) found.add(key);
      if (key === 'property' && typeof value === 'string' && propertyId.test(value)) found.add(value);
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [...found].sort();
}
function validIssue(value: unknown): value is SourceIssue {
  const codes = ['INVALID_REQUEST', 'NETWORK_FAILED', 'HTTP_ERROR', 'RATE_LIMITED', 'UPSTREAM_BUSY', 'API_ERROR', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE', 'RECORD_MISSING', 'CANCELLED', 'STAGING_FAILED', 'CHECKPOINT_INVALID'];
  return object(value) && typeof value.code === 'string' && codes.includes(value.code) && typeof value.retryable === 'boolean';
}
function cleanIssue(issue: SourceIssue): SourceIssue {
  return { code: issue.code, retryable: issue.retryable,
    ...(typeof issue.externalId === 'string' ? { externalId: issue.externalId } : {}),
    ...(typeof issue.providerCode === 'string' ? { providerCode: issue.providerCode } : {}),
    ...(typeof issue.status === 'number' ? { status: issue.status } : {}),
    ...(typeof issue.retryAfterMs === 'number' ? { retryAfterMs: issue.retryAfterMs } : {}) };
}
function cleanLabel(value: unknown): SourceLabel | null {
  if (!object(value) || Object.keys(value).some(key => !['en', 'zh'].includes(key)) || Object.values(value).some(text => typeof text !== 'string')) return null;
  return { ...(typeof value.en === 'string' ? { en: value.en } : {}), ...(typeof value.zh === 'string' ? { zh: value.zh } : {}) };
}

/** Source material persistence is separate from adopted claims and historical states. */
export async function createSourceArchive(dataDirectory: string, dependencies: Dependencies = {}) {
  const proposed = resolve(dataDirectory, 'source-archive');
  await directory(proposed, true);
  const root = await realpath(proposed);
  await directory(join(root, 'operations'), true); await directory(join(root, 'properties'), true);
  const running = new Map<string, { signature: string; promise: Promise<SourceResult<SourceJob>> }>();
  const activeJobs = new Set<string>();

  async function requestRecord(id: string): Promise<RequestRecord> {
    if (!opaqueId.test(id)) error('INVALID_REQUEST');
    const path = join(root, id); await directory(path);
    const value = await json(join(path, 'request.json'));
    if (!object(value) || value.schemaVersion !== 1 || value.id !== id || !Array.isArray(value.entityIds) || !value.entityIds.length || value.entityIds.length > 10_000 || value.entityIds.some(x => typeof x !== 'string' || !entityId.test(x)) || new Set(value.entityIds).size !== value.entityIds.length || !isoDate(value.createdAt)) error('CHECKPOINT_INVALID');
    return value as RequestRecord;
  }

  async function acquisition(id: string): Promise<string | null> {
    const path = join(root, id, 'materials'); await directory(path, true);
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.some(entry => !acquisitionName.test(entry.name) || !entry.isDirectory()) || entries.length > 1) error('CHECKPOINT_INVALID');
    if (!entries.length) return null;
    const selected = join(path, entries[0].name); await directory(selected);
    await directory(join(selected, 'snapshots')); await directory(join(selected, 'responses'));
    return selected;
  }

  async function loadCheckpoint(id: string, request: RequestRecord): Promise<{ path: string | null; checkpoint: Checkpoint; hash: string }> {
    const path = await acquisition(id);
    if (!path) {
      const receipt: AcquisitionReceipt = { id, adapter: WIKIDATA_ADAPTER, startedAt: request.createdAt, completedAt: request.createdAt, status: 'partial', requested: request.entityIds.map(externalId => ({ provider: 'wikidata', externalId })), snapshots: [], issues: [] };
      const checkpoint: Checkpoint = { schemaVersion: 1, receipt, responses: [] };
      return { path, checkpoint, hash: digest(JSON.stringify(checkpoint)) };
    }
    const value = await json(join(path, 'receipt.json'));
    if (!object(value) || value.schemaVersion !== 1 || !object(value.receipt) || !Array.isArray(value.responses)) error('CHECKPOINT_INVALID');
    const receipt = value.receipt;
    if (typeof receipt.id !== 'string' || receipt.adapter !== WIKIDATA_ADAPTER || !isoDate(receipt.startedAt) || !isoDate(receipt.completedAt) || !['complete', 'partial', 'cancelled', 'failed'].includes(String(receipt.status)) || !Array.isArray(receipt.requested) || !Array.isArray(receipt.snapshots) || !Array.isArray(receipt.issues) || !receipt.issues.every(validIssue)) error('CHECKPOINT_INVALID');
    if (!sameIds(receipt.requested.map(item => object(item) && item.provider === 'wikidata' && typeof item.externalId === 'string' ? item.externalId : '').sort(), request.entityIds)) error('CHECKPOINT_INVALID');
    const seen = new Set<string>();
    for (const item of receipt.snapshots) {
      if (!object(item) || !object(item.identity) || !object(item.requestedIdentity) || item.identity.provider !== 'wikidata' || item.requestedIdentity.provider !== 'wikidata' || typeof item.identity.externalId !== 'string' || !entityId.test(item.identity.externalId) || typeof item.requestedIdentity.externalId !== 'string' || !request.entityIds.includes(item.requestedIdentity.externalId) || seen.has(item.requestedIdentity.externalId) || typeof item.contentHash !== 'string' || !opaqueId.test(item.contentHash) || item.file !== `snapshots/${item.contentHash}.json` || (item.sourceRevision !== null && typeof item.sourceRevision !== 'string') || !isoDate(item.retrievedAt)) error('CHECKPOINT_INVALID');
      seen.add(item.requestedIdentity.externalId);
    }
    if (receipt.status === 'complete' && seen.size !== request.entityIds.length) error('CHECKPOINT_INVALID');
    for (const item of value.responses) if (!object(item) || typeof item.contentHash !== 'string' || !opaqueId.test(item.contentHash) || item.file !== `responses/${item.contentHash}.json` || typeof item.url !== 'string' || !isoDate(item.retrievedAt)) error('CHECKPOINT_INVALID');
    return { path, checkpoint: value as unknown as Checkpoint, hash: digest(JSON.stringify(value)) };
  }

  async function propertySnapshot(id: string): Promise<SourceRecordSnapshot | null> {
    if (!propertyId.test(id)) error('INVALID_REQUEST');
    await directory(join(root, 'properties'));
    const envelope = await optionalJson(join(root, 'properties', `${id}.json`));
    if (envelope === undefined) return null;
    if (!object(envelope) || envelope.schemaVersion !== 1 || envelope.requestedId !== id) error('CHECKPOINT_INVALID');
    const value = envelope.snapshot;
    if (!object(value) || !object(value.identity) || value.identity.provider !== 'wikidata' || typeof value.identity.externalId !== 'string' || !propertyId.test(value.identity.externalId) || value.adapterVersion !== WIKIDATA_ADAPTER || typeof value.contentHash !== 'string' || !object(value.raw) || value.raw.id !== value.identity.externalId || value.sourceRevision !== String(value.raw.lastrevid) || digest(canonicalSourceJson(value.raw as JsonValue)) !== value.contentHash) error('CHECKPOINT_INVALID');
    return value as SourceRecordSnapshot;
  }

  async function summarize(id: string, extraLabelIssues?: SourceIssue[]): Promise<SourceJob> {
    const request = await requestRecord(id), loaded = await loadCheckpoint(id, request);
    const stored = await optionalJson(join(root, id, 'summary.json'));
    let cache: SummaryCache | undefined;
    if (object(stored) && stored.schemaVersion === 1 && stored.checkpointHash === loaded.hash && Array.isArray(stored.materials) && Array.isArray(stored.labelIssues) && stored.labelIssues.every(validIssue)) {
      const values: SourceMaterialSummary[] = [];
      const expected = new Map(loaded.checkpoint.receipt.snapshots.map(item => [item.identity.externalId, item.sourceRevision]));
      for (const item of stored.materials) {
        if (!object(item) || !object(item.identity) || item.identity.provider !== 'wikidata' || typeof item.identity.externalId !== 'string' || !expected.has(item.identity.externalId) || item.sourceRevision !== expected.get(item.identity.externalId) || !cleanLabel(item.label) || (item.description !== undefined && !cleanLabel(item.description)) || !Number.isInteger(item.claimCount) || Number(item.claimCount) < 0 || item.kind !== (item.identity.externalId.startsWith('P') ? 'property' : 'item')) break;
        values.push({ identity: { provider: 'wikidata', externalId: item.identity.externalId }, sourceRevision: item.sourceRevision as string | null, label: cleanLabel(item.label)!, ...(item.description ? { description: cleanLabel(item.description)! } : {}), claimCount: Number(item.claimCount), kind: item.identity.externalId.startsWith('P') ? 'property' : 'item' });
      }
      if (values.length === stored.materials.length && values.length === expected.size && new Set(values.map(item => item.identity.externalId)).size === expected.size) cache = { schemaVersion: 1, checkpointHash: loaded.hash, materials: values, labelIssues: stored.labelIssues.map(cleanIssue) };
    }
    if (!cache) {
      const materials = new Map<string, SourceMaterialSummary>();
      for (const entry of loaded.checkpoint.receipt.snapshots) {
        if (!loaded.path) error('CHECKPOINT_INVALID');
        const snapshot = await readWikidataSnapshot(loaded.path, entry);
        materials.set(snapshot.identity.externalId, material(snapshot));
      }
      cache = { schemaVersion: 1, checkpointHash: loaded.hash, materials: [...materials.values()], labelIssues: [] };
    }
    if (extraLabelIssues) cache.labelIssues = extraLabelIssues.map(cleanIssue);
    await atomicJson(join(root, id, 'summary.json'), cache);
    const receipt = loaded.checkpoint.receipt;
    const completed = new Set(receipt.snapshots.map(item => item.requestedIdentity.externalId));
    return { id, receipt: { id: receipt.id, adapter: receipt.adapter, startedAt: receipt.startedAt, completedAt: receipt.completedAt, status: receipt.status,
      requested: receipt.requested.map(item => ({ provider: item.provider, externalId: item.externalId })),
      snapshots: receipt.snapshots.map(item => ({ requestedIdentity: { provider: item.requestedIdentity.provider, externalId: item.requestedIdentity.externalId }, identity: { provider: item.identity.provider, externalId: item.identity.externalId }, sourceRevision: item.sourceRevision, contentHash: item.contentHash, retrievedAt: item.retrievedAt, file: item.file })),
      issues: receipt.issues.map(cleanIssue) }, pending: request.entityIds.filter(id => !completed.has(id)).map(externalId => ({ provider: 'wikidata', externalId })), materials: cache.materials, labelIssues: cache.labelIssues };
  }

  async function fetchLabels(id: string, options: CollectOptions): Promise<SourceIssue[]> {
    await directory(join(root, 'properties'));
    const request = await requestRecord(id), loaded = await loadCheckpoint(id, request), properties = new Set<string>();
    for (const entry of loaded.checkpoint.receipt.snapshots) {
      if (!loaded.path) error('CHECKPOINT_INVALID');
      const snapshot = await readWikidataSnapshot(loaded.path, entry);
      for (const property of statementProperties(snapshot)) properties.add(property);
      if (propertyId.test(snapshot.identity.externalId)) await atomicJson(join(root, 'properties', `${snapshot.identity.externalId}.json`), { schemaVersion: 1, requestedId: snapshot.identity.externalId, snapshot });
    }
    const missing: string[] = [], issues: SourceIssue[] = [];
    for (const id of [...properties].sort()) {
      try { const snapshot = await propertySnapshot(id); if (!snapshot || !Object.keys(labels(snapshot.raw)).length) missing.push(id); }
      catch { missing.push(id); }
    }
    for (let offset = 0; offset < missing.length; offset += 50) {
      if (options.signal?.aborted) { issues.push({ code: 'CANCELLED', retryable: true }); break; }
      const ids = missing.slice(offset, offset + 50);
      const result = await fetchWikidataEntities({ entityIds: ids, signal: options.signal }, dependencies);
      if (!result.ok) { issues.push(...ids.map(externalId => ({ ...cleanIssue(result.error), externalId }))); break; }
      issues.push(...result.value.issues.map(cleanIssue));
      for (const record of result.value.records) {
        const snapshot = result.value.snapshots.find(item => item.identity.externalId === record.identity.externalId);
        if (!snapshot || !propertyId.test(record.requestedIdentity.externalId) || !propertyId.test(snapshot.identity.externalId)) continue;
        await atomicJson(join(root, 'properties', `${record.requestedIdentity.externalId}.json`), { schemaVersion: 1, requestedId: record.requestedIdentity.externalId, snapshot });
        if (!Object.keys(labels(snapshot.raw)).length) issues.push({ code: 'RECORD_MISSING', externalId: record.requestedIdentity.externalId, retryable: true });
      }
      try { options.onProgress?.({ stage: 'normalizing', completed: Math.min(offset + 50, missing.length), total: missing.length }); } catch { /* Observers cannot discard acquired records. */ }
    }
    return issues;
  }

  async function perform(input: CollectInput, options: CollectOptions, signature: string): Promise<SourceResult<SourceJob>> {
    const operationKey = digest(input.operationId), id = input.resumeJobId ?? operationKey;
    if (activeJobs.has(id)) return { ok: false, error: { code: 'STAGING_FAILED', retryable: true } };
    activeJobs.add(id);
    try {
      await directory(join(root, 'operations'));
      const operationPath = join(root, 'operations', `${operationKey}.json`);
      const existing = await optionalJson(operationPath);
      let operation: OperationRecord;
      if (existing !== undefined) {
        if (!object(existing) || existing.schemaVersion !== 1 || typeof existing.jobId !== 'string' || !opaqueId.test(existing.jobId) || typeof existing.signature !== 'string' || typeof existing.complete !== 'boolean') error('CHECKPOINT_INVALID');
        if (existing.signature !== signature || existing.jobId !== id) return invalid();
        operation = existing as OperationRecord;
      } else {
        if (!input.resumeJobId) {
          await directory(join(root, id), true);
          const prior = await optionalJson(join(root, id, 'request.json'));
          if (prior === undefined) await atomicJson(join(root, id, 'request.json'), { schemaVersion: 1, id, entityIds: input.entityIds, createdAt: new Date().toISOString() } satisfies RequestRecord);
        }
        const request = await requestRecord(id);
        if (!sameIds(request.entityIds, input.entityIds)) return invalid();
        operation = { schemaVersion: 1, jobId: id, signature, complete: false };
        await atomicJson(operationPath, operation);
      }
      const request = await requestRecord(id);
      if (!sameIds(request.entityIds, input.entityIds)) return invalid();
      const loaded = await loadCheckpoint(id, request);
      if (operation.complete && loaded.checkpoint.receipt.status === 'complete') return { ok: true, value: await summarize(id) };
      if (loaded.checkpoint.receipt.status !== 'complete') {
        const acquired = await acquireWikidataEntities({ entityIds: input.entityIds, stagingDirectory: join(root, id, 'materials'), ...(loaded.path ? { resumeDirectory: loaded.path } : {}), signal: options.signal,
          onProgress: progress => { try { options.onProgress?.({ ...progress, stage: 'acquiring' }); } catch { /* Persisted acquisition owns progress. */ } } }, dependencies);
        if (!acquired.ok) return acquired;
      }
      const labelIssues = await fetchLabels(id, options);
      const job = await summarize(id, labelIssues);
      operation.complete = true; await atomicJson(operationPath, operation);
      return { ok: true, value: job };
    } catch (caught) {
      const code = isMissing(caught) ? 'CHECKPOINT_INVALID' : caught instanceof Error && ['INVALID_REQUEST', 'CHECKPOINT_INVALID'].includes(caught.message) ? caught.message as 'INVALID_REQUEST' | 'CHECKPOINT_INVALID' : 'STAGING_FAILED';
      return { ok: false, error: { code, retryable: code === 'STAGING_FAILED' } };
    } finally { activeJobs.delete(id); }
  }

  return {
    async *snapshots(jobId: string): AsyncGenerator<SourceRecordSnapshot> {
      if (!opaqueId.test(jobId)) error('INVALID_REQUEST');
      const request = await requestRecord(jobId), loaded = await loadCheckpoint(jobId, request);
      const seen = new Set<string>();
      for (const entry of loaded.checkpoint.receipt.snapshots) {
        if (!loaded.path) error('CHECKPOINT_INVALID');
        if (seen.has(entry.contentHash)) continue;
        seen.add(entry.contentHash);
        yield await readWikidataSnapshot(loaded.path, entry);
      }
    },
    collect(input: CollectInput, options: CollectOptions = {}): Promise<SourceResult<SourceJob>> {
      if (!Array.isArray(input.entityIds) || !input.entityIds.length || input.entityIds.length > 10_000 || input.entityIds.some(id => typeof id !== 'string' || !entityId.test(id)) || new Set(input.entityIds).size !== input.entityIds.length || typeof input.operationId !== 'string' || !input.operationId.length || input.operationId.length > 200 || (input.resumeJobId !== undefined && !opaqueId.test(input.resumeJobId))) return Promise.resolve(invalid());
      const normalized = { ...input, entityIds: [...input.entityIds].sort() };
      const key = digest(input.operationId), signature = digest(JSON.stringify({ entityIds: normalized.entityIds, resumeJobId: input.resumeJobId ?? null }));
      const previous = running.get(key);
      if (previous) return previous.signature === signature ? previous.promise : Promise.resolve(invalid());
      const promise = perform(normalized, options, signature).finally(() => running.delete(key));
      running.set(key, { signature, promise }); return promise;
    },
    async list(): Promise<SourceJobList> {
      const result: SourceJobList = { jobs: [], issues: [] };
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!opaqueId.test(entry.name)) continue;
        try { result.jobs.push(await summarize(entry.name)); }
        catch { result.issues.push({ jobId: entry.name, code: 'CHECKPOINT_INVALID' }); }
      }
      result.jobs.sort((a, b) => b.receipt.startedAt.localeCompare(a.receipt.startedAt) || a.id.localeCompare(b.id));
      return result;
    },
    async record(input: { jobId: string; externalId: string }): Promise<SourceRecordDetail> {
      if (!opaqueId.test(input.jobId) || !entityId.test(input.externalId)) error('INVALID_REQUEST');
      let request: RequestRecord;
      try { request = await requestRecord(input.jobId); } catch (caught) { if (isMissing(caught)) return error('NOT_FOUND'); throw caught; }
      const loaded = await loadCheckpoint(input.jobId, request);
      const entry = loaded.checkpoint.receipt.snapshots.find(item => item.identity.externalId === input.externalId || item.requestedIdentity.externalId === input.externalId);
      if (!entry || !loaded.path) error('NOT_FOUND');
      let snapshot: SourceRecordSnapshot;
      try { snapshot = await readWikidataSnapshot(loaded.path, entry); } catch { return error('CHECKPOINT_INVALID'); }
      const job = await summarize(input.jobId), result: Record<string, SourceLabel> = {};
      for (const item of job.materials) result[item.identity.externalId] = item.label;
      for (const id of statementProperties(snapshot)) { try { const cached = await propertySnapshot(id); if (cached) result[id] = labels(cached.raw); } catch { /* Raw property IDs remain usable when the label cache is damaged. */ } }
      return { snapshot, labels: result };
    },
  };
}
