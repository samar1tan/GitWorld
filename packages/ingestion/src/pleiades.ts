import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';
import type { JsonValue, SourceIssue, SourceRecordSnapshot, SourceResult } from './source-types.ts';
import { canonicalSourceJson } from './wikidata.ts';

export const PLEIADES_DOWNLOAD_PAGE = 'https://pleiades.stoa.org/downloads';
export const PLEIADES_JSON_BASE = 'https://atlantides.org/downloads/pleiades/json/';
export const PLEIADES_LICENSE = 'https://creativecommons.org/licenses/by/3.0/';
export const PLEIADES_ADAPTER = 'pleiades-comprehensive-json-v1';
const MAX_COMPRESSED = 256 * 1024 * 1024, MAX_UNCOMPRESSED = 4 * 1024 * 1024 * 1024, MAX_RECORD = 16 * 1024 * 1024;
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = <T>(code: SourceIssue['code'], retryable = false): SourceResult<T> => ({ ok: false, error: { code, retryable } });
type Dependencies = { fetch?: typeof fetch };
export type PleiadesDumpReceipt = { sourceUrl: string; version: string; retrievedAt: string; etag: string | null; bytes: number; sha256: string; file: string; licenseId: 'CC-BY-3.0'; licenseUrl: string; compressed: true; cached?: boolean };
type DownloadCheckpoint = { schemaVersion: 1; sourceUrl: string; version: string; etag: string | null; bytes: number; total: number | null; retrievedAt: string };
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`; const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
}
async function fileHash(path: string) { const value = createHash('sha256'); for await (const chunk of createReadStream(path)) value.update(chunk); return value.digest('hex'); }
function observer(callback: ((value: { completed: number; total?: number; stage: 'downloading' | 'reading' }) => void) | undefined, value: { completed: number; total?: number; stage: 'downloading' | 'reading' }) { try { callback?.(value); } catch { /* Observers cannot discard a download. */ } }

/** Trusted-host download. The directory is not accepted from renderer messages. */
export async function acquirePleiadesDump(options: { directory: string; version?: string; signal?: AbortSignal; onProgress?: (value: { completed: number; total?: number; stage: 'downloading' | 'reading' }) => void }, dependencies: Dependencies = {}): Promise<SourceResult<PleiadesDumpReceipt>> {
  const version = options.version ?? 'latest';
  if (!isAbsolute(options.directory) || version !== 'latest' && !/^\d{8}$/.test(version)) return fail('INVALID_REQUEST');
  const sourceUrl = `${PLEIADES_JSON_BASE}pleiades-places-${version}.json.gz`, partial = join(options.directory, `places-${version}.json.gz.part`), destination = partial.slice(0, -5), checkpointPath = `${partial}.receipt.json`, receiptPath = `${destination}.receipt.json`;
  try {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    if (options.signal?.aborted) return fail('CANCELLED', true);
    // A dated dump is immutable input for repeated local investigations; latest is deliberately refreshed.
    if (version !== 'latest') {
      try { const prior = JSON.parse(await readFile(receiptPath, 'utf8')) as PleiadesDumpReceipt; if (prior.sourceUrl === sourceUrl && prior.file === destination && prior.sha256 === await fileHash(destination)) return { ok: true, value: { ...prior, cached: true } }; } catch { /* An absent cache starts a new checked download. */ }
    }
    let checkpoint: DownloadCheckpoint = { schemaVersion: 1, sourceUrl, version, etag: null, bytes: 0, total: null, retrievedAt: new Date().toISOString() };
    try {
      const prior = JSON.parse(await readFile(checkpointPath, 'utf8')) as DownloadCheckpoint;
      const size = (await stat(partial)).size;
      if (prior.schemaVersion !== 1 || prior.sourceUrl !== sourceUrl || !Number.isSafeInteger(prior.bytes) || prior.bytes < 0 || prior.bytes > MAX_COMPRESSED || size < prior.bytes || prior.etag !== null && typeof prior.etag !== 'string') return fail('CHECKPOINT_INVALID');
      checkpoint = prior;
      const file = await open(partial, 'r+'); try { await file.truncate(prior.bytes); } finally { await file.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail('CHECKPOINT_INVALID'); }
    const response = await (dependencies.fetch ?? fetch)(sourceUrl, { redirect: 'error', headers: { 'User-Agent': 'GitWorld/0.1 (https://github.com/samar1tan/GitWorld)', Accept: 'application/gzip', ...(checkpoint.bytes && checkpoint.etag ? { Range: `bytes=${checkpoint.bytes}-`, 'If-Range': checkpoint.etag } : {}) }, signal: options.signal });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, error: { code: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', retryable: [429, 502, 503, 504].includes(response.status), status: response.status, requestUrl: sourceUrl, ...(Number.isFinite(Number(response.headers.get('retry-after'))) ? { retryAfterMs: Number(response.headers.get('retry-after')) * 1000 } : {}) } }; }
    if (!response.body) return fail('INVALID_RESPONSE', true);
    const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (response.status === 206 && (!range || Number(range[1]) !== checkpoint.bytes)) { await response.body.cancel(); return fail('INVALID_RESPONSE'); }
    if (response.status !== 206) checkpoint.bytes = 0;
    checkpoint.etag = response.headers.get('etag'); checkpoint.retrievedAt = new Date().toISOString();
    checkpoint.total = range ? Number(range[3]) : response.headers.has('content-length') ? Number(response.headers.get('content-length')) : null;
    if (checkpoint.total !== null && (!Number.isSafeInteger(checkpoint.total) || checkpoint.total < 1 || checkpoint.total > MAX_COMPRESSED)) { await response.body.cancel(); return fail('RESPONSE_TOO_LARGE'); }
    const file = await open(partial, checkpoint.bytes ? 'r+' : 'w', 0o600), reader = response.body.getReader();
    let checkpointBytes = checkpoint.bytes;
    try {
      await atomicJson(checkpointPath, checkpoint);
      for (;;) {
        if (options.signal?.aborted) throw new Error('CANCELLED');
        const next = await reader.read(); if (next.done) break;
        if (checkpoint.bytes + next.value.length > MAX_COMPRESSED) throw new Error('RESPONSE_TOO_LARGE');
        let written = 0;
        while (written < next.value.length) {
          const result = await file.write(next.value, written, next.value.length - written, checkpoint.bytes + written);
          if (!result.bytesWritten) throw new Error('WRITE_FAILED');
          written += result.bytesWritten;
        }
        checkpoint.bytes += written;
        if (checkpoint.bytes - checkpointBytes >= 4 * 1024 * 1024) { await file.sync(); await atomicJson(checkpointPath, checkpoint); checkpointBytes = checkpoint.bytes; observer(options.onProgress, { completed: checkpoint.bytes, ...(checkpoint.total ? { total: checkpoint.total } : {}), stage: 'downloading' }); }
      }
      await file.sync(); await atomicJson(checkpointPath, checkpoint);
    } catch (error) {
      await file.sync(); await atomicJson(checkpointPath, checkpoint);
      const code = options.signal?.aborted || (error as Error).message === 'CANCELLED' ? 'CANCELLED' : (error as Error).message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'NETWORK_FAILED';
      return fail(code, code !== 'RESPONSE_TOO_LARGE');
    } finally { await file.close(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (checkpoint.total !== null && checkpoint.total !== checkpoint.bytes) return fail('NETWORK_FAILED', true);
    await rename(partial, destination);
    const receipt: PleiadesDumpReceipt = { sourceUrl, version, retrievedAt: checkpoint.retrievedAt, etag: checkpoint.etag, bytes: checkpoint.bytes, sha256: await fileHash(destination), file: destination, licenseId: 'CC-BY-3.0', licenseUrl: PLEIADES_LICENSE, compressed: true, cached: false };
    await atomicJson(receiptPath, receipt);
    observer(options.onProgress, { completed: checkpoint.bytes, total: checkpoint.bytes, stage: 'downloading' });
    return { ok: true, value: receipt };
  } catch { return fail(options.signal?.aborted ? 'CANCELLED' : 'STAGING_FAILED', true); }
}

/** A lexical object stream avoids loading the comprehensive JSON graph into memory. */
export async function* iteratePleiadesRecords(path: string, options: { signal?: AbortSignal; maxRecordBytes?: number } = {}): AsyncGenerator<Record<string, JsonValue>> {
  const file = createReadStream(path), gunzip = createGunzip(), decoder = new StringDecoder('utf8'); file.on('error', error => gunzip.destroy(error)); file.pipe(gunzip);
  const abort = () => { file.destroy(new Error('CANCELLED')); gunzip.destroy(new Error('CANCELLED')); };
  options.signal?.addEventListener('abort', abort, { once: true });
  let header = '', started = false, ended = false, depth = 0, quoted = false, escaped = false, record = '', bytes = 0;
  const maxRecord = options.maxRecordBytes ?? MAX_RECORD;
  try {
    if (options.signal?.aborted) throw new Error('CANCELLED');
    for await (const buffer of gunzip) {
      bytes += buffer.length; if (bytes > MAX_UNCOMPRESSED) throw new Error('RESPONSE_TOO_LARGE');
      let chunk = decoder.write(buffer);
      if (!started) { header += chunk; const match = /"@graph"\s*:\s*\[/.exec(header); if (!match) { if (header.length > 1024 * 1024) throw new Error('INVALID_PLEIADES_GRAPH'); continue; } chunk = header.slice(match.index + match[0].length); header = ''; started = true; }
      for (const character of chunk) {
        if (ended) continue;
        if (!depth) {
          if (/\s|,/.test(character)) continue;
          if (character === ']') { ended = true; continue; }
          if (character !== '{') throw new Error('INVALID_PLEIADES_GRAPH');
          depth = 1; record = '{'; quoted = false; escaped = false; continue;
        }
        record += character;
        if (record.length > maxRecord) throw new Error('RESPONSE_TOO_LARGE');
        if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; }
        else if (character === '"') quoted = true;
        else if (character === '{') depth++;
        else if (character === '}') { depth--; if (!depth) { const value: unknown = JSON.parse(record); if (!object(value)) throw new Error('INVALID_PLEIADES_RECORD'); yield value; record = ''; } }
      }
    }
    if (!started || !ended || depth) throw new Error('INCOMPLETE_PLEIADES_GRAPH');
  } finally { options.signal?.removeEventListener('abort', abort); file.unpipe(gunzip); file.destroy(); gunzip.destroy(); }
}

export type PleiadesReadReport = { sourceUrl: string; sourceRevision: string; retrievedAt: string; scanned: number; selected: number; skippedInvalid: number; nextRecord: number | null; truncated: boolean; records: { externalId: string; contentHash: string }[] };
export async function readPleiadesDump(options: { file: string; sourceRevision: string; retrievedAt: string; sourceUrl?: string; startRecord?: number; limit?: number; filter?: { text: string }; signal?: AbortSignal; onProgress?: (value: { completed: number; stage: 'reading' }) => void }): Promise<SourceResult<{ snapshots: SourceRecordSnapshot[]; report: PleiadesReadReport }>> {
  const limit = options.limit ?? 1000, start = options.startRecord ?? 0;
  if (!isAbsolute(options.file) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000 || !Number.isSafeInteger(start) || start < 0 || !options.sourceRevision || !Number.isFinite(Date.parse(options.retrievedAt))) return fail('INVALID_REQUEST');
  const report: PleiadesReadReport = { sourceUrl: options.sourceUrl ?? PLEIADES_DOWNLOAD_PAGE, sourceRevision: options.sourceRevision, retrievedAt: options.retrievedAt, scanned: 0, selected: 0, skippedInvalid: 0, nextRecord: null, truncated: false, records: [] }, snapshots: SourceRecordSnapshot[] = [];
  try {
    for await (const raw of iteratePleiadesRecords(options.file, { signal: options.signal })) {
      report.scanned++;
      if (report.scanned <= start) continue;
      if ((typeof raw.id !== 'string' && typeof raw.id !== 'number') || !/^\d+$/.test(String(raw.id)) || typeof raw.title !== 'string' || typeof raw.uri !== 'string' || !/^https?:\/\/pleiades\.stoa\.org\/places\/\d+\/?$/.test(raw.uri) || typeof raw.rights !== 'string' || !(/creativecommons\.org\/licenses\/by\/3\.0/.test(raw.rights) || /Creative Commons Attribution 3\.0 License \(cc-by\)/i.test(raw.rights))) { report.skippedInvalid++; continue; }
      if (options.filter?.text) {
        const names = (Array.isArray(raw.names) ? raw.names : []).flatMap(value => object(value) ? [value.attested, value.romanized].filter(value => typeof value === 'string') : []);
        const searchable = [raw.title, raw.description, ...names].filter(value => typeof value === 'string').join(' ').toLocaleLowerCase();
        if (!searchable.includes(options.filter.text.toLocaleLowerCase())) continue;
      }
      const externalId = String(raw.id);
      if (raw.uri.replace(/\/$/, '').split('/').at(-1) !== externalId) { report.skippedInvalid++; continue; }
      const contentHash = hash(canonicalSourceJson(raw));
      const contributors = [...(Array.isArray(raw.creators) ? raw.creators : []), ...(Array.isArray(raw.contributors) ? raw.contributors : [])].flatMap(value => object(value) && typeof value.name === 'string' ? [value.name] : []);
      snapshots.push({ identity: { provider: 'pleiades', externalId }, sourceRevision: options.sourceRevision, retrievedAt: options.retrievedAt, url: `https://pleiades.stoa.org/places/${externalId}`, contentHash, mediaType: 'application/json', raw, adapterVersion: PLEIADES_ADAPTER, rights: { licenseId: 'CC-BY-3.0', licenseUrl: PLEIADES_LICENSE, redistribution: 'allowed', attribution: `Pleiades, ${raw.title}; ${[...new Set(contributors)].join(', ')}. Source ${raw.uri}. Changes: normalized by GitWorld; original record retained.` } });
      report.records.push({ externalId, contentHash }); report.selected++;
      if (report.selected % 100 === 0) { try { options.onProgress?.({ completed: report.selected, stage: 'reading' }); } catch { /* Progress observers cannot discard parsed records. */ } }
      if (report.selected >= limit) { report.truncated = true; report.nextRecord = report.scanned; break; }
    }
    return { ok: true, value: { snapshots, report } };
  } catch (error) { return fail(options.signal?.aborted ? 'CANCELLED' : (error as Error).message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'INVALID_RESPONSE', !!options.signal?.aborted); }
}
