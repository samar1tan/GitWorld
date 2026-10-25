import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildContentManifest, canonicalJson, isRecord, validateDataPackage } from '../../domain/src/index.ts';
import type { DataPackage } from '../../domain/src/package.ts';
import type { Draft, ModelCatalog, ModelRead, ModelWorkingReceipt, RevisionSummary, ServiceError, ServiceMethods } from '../../contracts/src/index.ts';
import type { EditorialJson, EditorialRepository } from '../../contracts/src/editorial-types.ts';

const oid = /^[a-f0-9]{40}$/;
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const modelPath = (datasetId: string) => `models/${createHash('sha256').update(datasetId).digest('hex')}.json`;
export class ModelFailure extends Error {
  readonly detail: ServiceError;
  constructor(detail: ServiceError) { super(detail.code); this.detail = detail; }
}
const fail = (code: ServiceError['code']): never => { throw new ModelFailure({ code }); };
type PublishInput = ServiceMethods['draft.publish']['params'];
type PublishResult = RevisionSummary & { working: ModelWorkingReceipt };
type Prepared = { package: DataPackage; result: PublishResult };
type Row = { signature: string; prepared_json: string; result_json: string | null };

/** SQL contains draft/retry metadata; every runnable current model is read from Git. */
export function createModelStore(repository: EditorialRepository, options: {
  dataDirectory: string; getDraft(id: string): Promise<Draft>;
  /** Trusted recovery-test hook, never renderer-supplied. */
  onFault?: (point: 'after-prepare' | 'after-write' | 'after-receipt') => void | Promise<void>;
}) {
  const operations = new DatabaseSync(path.join(options.dataDirectory, 'model-operations.sqlite'));
  try { operations.exec("PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS model_writes (id TEXT PRIMARY KEY, signature TEXT NOT NULL, prepared_json TEXT NOT NULL, result_json TEXT)"); }
  catch { operations.close(); return fail('IO_ERROR'); }
  let tail: Promise<unknown> = Promise.resolve(), closed = false;
  const validRevision = (revision: string) => { if (revision !== 'working' && !oid.test(revision)) fail('INVALID_REQUEST'); return revision; };
  function checked(value: EditorialJson, file: string): DataPackage {
    const result = validateDataPackage(value, 'draft');
    if (!result.ok || file !== modelPath(result.value.dataset.id)) return fail('VALIDATION_FAILED');
    return result.value;
  }
  async function read(datasetId: string, revision: string): Promise<ModelRead> {
    validRevision(revision);
    const file = modelPath(datasetId), snapshot = await repository.snapshot({ from: revision, paths: [file] }), raw = snapshot.files[file];
    if (raw === undefined) return fail('REVISION_NOT_FOUND');
    const data = checked(raw, file);
    return { datasetId, revision, head: snapshot.head, path: file, contentHash: digest(raw), package: data };
  }
  async function catalog(revision: string): Promise<ModelCatalog> {
    validRevision(revision);
    const snapshot = await repository.snapshot({ from: revision, prefixes: ['models/'] });
    const committed = revision === 'working' ? await repository.snapshot({ from: snapshot.head, prefixes: ['models/'] }) : snapshot;
    return { revision, head: snapshot.head, models: Object.entries(snapshot.files).map(([file, raw]) => {
      const data = checked(raw, file), contentHash = digest(raw), base = committed.files[file];
      const headContentHash = base === undefined ? null : digest(base);
      return { datasetId: data.dataset.id, name: data.dataset.name, path: file, contentHash, authoredRevisionId: data.revision.id, headContentHash, working: contentHash !== headContentHash };
    }).sort((a, b) => a.datasetId.localeCompare(b.datasetId)) };
  }
  async function saved(row: Row, input: PublishInput): Promise<Prepared> {
    try {
      const value: unknown = JSON.parse(row.prepared_json);
      if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.result.working)) return fail('IO_ERROR');
      const data = validateDataPackage(value.package, 'publish'); if (!data.ok) return fail('IO_ERROR');
      const result = value.result, expected = { path: modelPath(data.value.dataset.id), head: input.expectedHead, contentHash: digest(data.value) };
      if (canonicalJson(result.working) !== canonicalJson(expected) || result.datasetId !== data.value.dataset.id || result.revisionId !== data.value.revision.id || result.parentRevisionId !== data.value.revision.parentRevisionId || canonicalJson(result.notes) !== canonicalJson(data.value.revision.notes) || typeof result.publishedAt !== 'string' || !Number.isFinite(Date.parse(result.publishedAt)) || result.contentHash !== (await buildContentManifest(data.value)).contentHash) return fail('IO_ERROR');
      if (row.result_json !== null && canonicalJson(JSON.parse(row.result_json)) !== canonicalJson(result)) return fail('IO_ERROR');
      return value as unknown as Prepared;
    } catch { return fail('IO_ERROR'); }
  }
  async function publish(input: PublishInput): Promise<PublishResult> {
    const signature = digest(input);
    let row = operations.prepare('SELECT signature,prepared_json,result_json FROM model_writes WHERE id=?').get(input.operationId) as Row | undefined;
    if (row && row.signature !== signature) return fail('IDEMPOTENCY_CONFLICT');
    if (row?.result_json) return (await saved(row, input)).result;
    if (!row) {
      if (!input.review.evidenceReviewed || !input.review.rightsReviewed) return fail('REVIEW_REQUIRED');
      const draft = await options.getDraft(input.draftId);
      if (draft.version !== input.expectedVersion) return fail('CONFLICT');
      const parsed = validateDataPackage(draft.package, 'publish');
      if (!parsed.ok) throw new ModelFailure({ code: 'VALIDATION_FAILED', issues: parsed.issues });
      const data = parsed.value, file = modelPath(data.dataset.id), status = await repository.status();
      if (status.head !== input.expectedHead) return fail('HEAD_CHANGED');
      const previous = await repository.read(file);
      if ((previous === null ? null : digest(previous)) !== input.expectedModelHash) return fail('CONTENT_CHANGED');
      const contentHash = digest(data), manifest = await buildContentManifest(data);
      const prepared: Prepared = { package: data, result: {
        datasetId: data.dataset.id, revisionId: data.revision.id, parentRevisionId: data.revision.parentRevisionId,
        publishedAt: new Date().toISOString(), notes: data.revision.notes, contentHash: manifest.contentHash,
        working: { head: input.expectedHead, path: file, contentHash },
      } };
      operations.prepare('INSERT OR IGNORE INTO model_writes VALUES (?,?,?,NULL)').run(input.operationId, signature, canonicalJson(prepared));
      row = operations.prepare('SELECT signature,prepared_json,result_json FROM model_writes WHERE id=?').get(input.operationId) as Row;
      if (row.signature !== signature) return fail('IDEMPOTENCY_CONFLICT');
      if (row.result_json) return (await saved(row, input)).result;
      await options.onFault?.('after-prepare');
    }
    const prepared = await saved(row, input), receipt = prepared.result.working;
    // A crash may leave the one atomic model write complete but its receipt pending.
    // Accept those exact bytes on retry; any subsequent C edit still fails the CAS.
    const previous = await repository.read(receipt.path), previousHash = previous === null ? null : digest(previous);
    const expected = previousHash === receipt.contentHash ? receipt.contentHash : input.expectedModelHash;
    await repository.write([{ path: receipt.path, value: prepared.package as unknown as EditorialJson }], { expectedHead: input.expectedHead, expectedContentHashes: { [receipt.path]: expected } });
    await options.onFault?.('after-write');
    operations.prepare('UPDATE model_writes SET result_json=? WHERE id=?').run(canonicalJson(prepared.result), input.operationId);
    await options.onFault?.('after-receipt');
    return prepared.result;
  }
  return {
    read, catalog,
    publish(input: PublishInput) { const next = tail.then(() => publish(input)); tail = next.catch(() => undefined); return next; },
    async close() { if (closed) return; await tail; if (closed) return; closed = true; operations.close(); },
  };
}
