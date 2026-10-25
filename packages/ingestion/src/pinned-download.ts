import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { SourceIssue, SourceResult } from './source-types.ts';

/** Definitions are host-owned catalog entries, never renderer-supplied URLs or license claims. */
export type PinnedDownloadDefinition = { url: string; fileName: string; bytes: number; contentHash: string };
export type PinnedDownloadReceipt = { file: string; url: string; bytes: number; contentHash: string; retrievedAt: string; cached: boolean; etag?: string };
type Checkpoint = { url: string; expectedHash: string; bytes: number; etag?: string };
const active = new Set<string>();
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
class Failure extends Error { readonly issue: SourceIssue; constructor(issue: SourceIssue) { super(issue.code); this.issue = issue; } }
const cancelled = () => new Failure({ code: 'CANCELLED', retryable: true });
async function regular(path: string): Promise<number | null> {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Failure({ code: 'CHECKPOINT_INVALID', retryable: false }); return info.size; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
const validDefinition = (definition: PinnedDownloadDefinition) => {
  try { const url = new URL(definition.url); return url.protocol === 'https:' && !url.username && !url.password && /^[a-z0-9][a-z0-9._-]{0,100}$/i.test(definition.fileName) && Number.isSafeInteger(definition.bytes) && definition.bytes > 0 && definition.bytes <= 256 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(definition.contentHash); } catch { return false; }
};

/** Bounded, hash-pinned public-source download with persisted Range/ETag restart. */
export async function acquirePinnedDownload(definition: PinnedDownloadDefinition, options: { directory: string; signal?: AbortSignal; onProgress?: (value: { bytes: number; totalBytes: number }) => void }, dependencies: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<SourceResult<PinnedDownloadReceipt>> {
  if (!validDefinition(definition) || !isAbsolute(options.directory)) return { ok: false, error: { code: 'INVALID_REQUEST', retryable: false } };
  const directory = resolve(options.directory), file = join(directory, definition.fileName), partial = `${file}.part`, checkpointPath = `${partial}.json`, receiptPath = `${file}.receipt.json`;
  if (active.has(file)) return { ok: false, error: { code: 'STAGING_FAILED', retryable: true } };
  active.add(file);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let responseBody: ReadableStream<Uint8Array> | null = null;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    if (options.signal?.aborted) throw cancelled();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Failure({ code: 'STAGING_FAILED', retryable: false });
    const cachedBytes = await regular(file);
    if (cachedBytes !== null) {
      if (cachedBytes === definition.bytes && sha256(await readFile(file)) === definition.contentHash) {
        let retrievedAt = (await lstat(file)).mtime.toISOString();
        const receiptBytes = await regular(receiptPath);
        if (receiptBytes !== null && receiptBytes <= 4096) {
          try { const receipt = JSON.parse(await readFile(receiptPath, 'utf8')); if (receipt.url === definition.url && receipt.contentHash === definition.contentHash && Number.isFinite(Date.parse(receipt.retrievedAt))) retrievedAt = receipt.retrievedAt; } catch { /* The content hash remains authoritative. */ }
        }
        return { ok: true, value: { file, url: definition.url, bytes: definition.bytes, contentHash: definition.contentHash, retrievedAt, cached: true } };
      }
      await rename(file, `${file}.invalid-${randomUUID()}`);
    }
    let offset = await regular(partial) ?? 0, checkpoint: Checkpoint = { url: definition.url, expectedHash: definition.contentHash, bytes: 0 };
    if (offset) {
      try { const bytes = await regular(checkpointPath); if (bytes === null || bytes > 4096) throw new Error('checkpoint'); checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')); }
      catch { checkpoint = { url: '', expectedHash: '', bytes: -1 }; }
      if (checkpoint.url !== definition.url || checkpoint.expectedHash !== definition.contentHash || checkpoint.bytes !== offset || offset > definition.bytes || checkpoint.etag !== undefined && typeof checkpoint.etag !== 'string') {
        await rename(partial, `${partial}.invalid-${randomUUID()}`); offset = 0; checkpoint = { url: definition.url, expectedHash: definition.contentHash, bytes: 0 };
      }
    }
    if (offset === definition.bytes) {
      if (sha256(await readFile(partial)) !== definition.contentHash) { await rename(partial, `${partial}.invalid-${randomUUID()}`); offset = 0; }
      else {
        await rename(partial, file); await unlink(checkpointPath).catch(() => {});
        const receipt = { file, url: definition.url, bytes: definition.bytes, contentHash: definition.contentHash, retrievedAt: (dependencies.now?.() ?? new Date()).toISOString(), cached: false };
        await atomicJson(receiptPath, receipt); return { ok: true, value: receipt };
      }
    }
    const response = await (dependencies.fetch ?? fetch)(definition.url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(120000), ...(options.signal ? [options.signal] : [])]), headers: { Accept: 'application/octet-stream', 'User-Agent': 'GitWorld/0.1 source-ingestion (https://github.com/samar1tan/GitWorld)', ...(offset ? { Range: `bytes=${offset}-`, ...(checkpoint.etag ? { 'If-Range': checkpoint.etag } : {}) } : {}) } });
    responseBody = response.body;
    if (!response.ok) {
      await response.body?.cancel();
      const retryAfter = response.headers.get('retry-after'), seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : NaN;
      throw new Failure({ code: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', status: response.status, retryable: [429, 502, 503, 504].includes(response.status), ...(Number.isFinite(seconds) ? { retryAfterMs: seconds } : {}), requestUrl: definition.url });
    }
    const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (response.status === 206) {
      if (!range || Number(range[1]) !== offset || Number(range[2]) !== definition.bytes - 1 || Number(range[3]) !== definition.bytes || checkpoint.etag && response.headers.get('etag') && checkpoint.etag !== response.headers.get('etag')) throw new Failure({ code: 'INVALID_RESPONSE', retryable: true });
    } else if (response.status === 200) offset = 0;
    else throw new Failure({ code: 'INVALID_RESPONSE', retryable: true });
    if (Number(response.headers.get('content-length')) > definition.bytes - offset) throw new Failure({ code: 'RESPONSE_TOO_LARGE', retryable: false });
    if (!response.body) throw new Failure({ code: 'INVALID_RESPONSE', retryable: true });
    handle = await open(partial, offset ? 'r+' : 'w', 0o600);
    checkpoint = { url: definition.url, expectedHash: definition.contentHash, bytes: offset, ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}) };
    await atomicJson(checkpointPath, checkpoint);
    reader = response.body.getReader();
    for (;;) {
      if (options.signal?.aborted) throw cancelled();
      const next = await reader.read(); if (next.done) break;
      if (offset + next.value.byteLength > definition.bytes) throw new Failure({ code: 'RESPONSE_TOO_LARGE', retryable: false });
      let written = 0;
      while (written < next.value.byteLength) { const result = await handle.write(next.value, written, next.value.byteLength - written, offset + written); if (!result.bytesWritten) throw new Failure({ code: 'STAGING_FAILED', retryable: true }); written += result.bytesWritten; }
      offset += written; await handle.sync(); checkpoint.bytes = offset; await atomicJson(checkpointPath, checkpoint);
      try { options.onProgress?.({ bytes: offset, totalBytes: definition.bytes }); } catch { /* Observers do not own the persisted acquisition. */ }
    }
    await handle.close(); handle = null;
    if (offset !== definition.bytes || sha256(await readFile(partial)) !== definition.contentHash) throw new Failure({ code: 'INVALID_RESPONSE', retryable: true });
    await rename(partial, file); await unlink(checkpointPath).catch(() => {});
    const receipt: PinnedDownloadReceipt = { file, url: definition.url, bytes: definition.bytes, contentHash: definition.contentHash, retrievedAt: (dependencies.now?.() ?? new Date()).toISOString(), cached: false, ...(checkpoint.etag ? { etag: checkpoint.etag } : {}) };
    await atomicJson(receiptPath, receipt); return { ok: true, value: receipt };
  } catch (error) { return { ok: false, error: options.signal?.aborted ? { code: 'CANCELLED', retryable: true } : error instanceof Failure ? error.issue : error instanceof Error && 'code' in error && /^E[A-Z]+$/.test(String(error.code)) ? { code: 'STAGING_FAILED', retryable: true } : { code: 'NETWORK_FAILED', retryable: true, requestUrl: definition.url } }; }
  finally { await handle?.close().catch(() => {}); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } else await responseBody?.cancel().catch(() => {}); active.delete(file); }
}
