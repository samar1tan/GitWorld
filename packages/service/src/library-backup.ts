import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import type { BackupReceipt } from '../../contracts/src/index.ts';
import { DATABASE_SCHEMA_VERSION } from '../../storage/src/migrations.ts';

export const LIBRARY_BACKUP_MAGIC = Buffer.from('GITWORLD-LIBRARY-1\n', 'ascii');
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii');
const SHA = /^[a-f0-9]{64}$/;
type Limits = { maxFiles: number; maxTotalBytes: number; maxFileBytes: number; maxHeaderBytes: number };
const DEFAULT_LIMITS: Limits = { maxFiles: 100_000, maxTotalBytes: 8 * 1024 ** 3, maxFileBytes: 2 * 1024 ** 3, maxHeaderBytes: 64 * 1024 ** 2 };
type Entry = { path: string; bytes: number; sha256: string; mode: number };
type Manifest = { format: 'gitworld-library-v1'; schemaVersion: 1; databaseSchemaVersion: number; id: string; createdAt: string; totalBytes: number; files: Entry[] };
export type FullBackupReceipt = BackupReceipt & { format: 'gitworld-library-v1'; files: number; bytes: number };
export type LibraryBackupProgress = { phase: 'snapshot' | 'archive' | 'validate' | 'install'; completed: number; total?: number };
const progress = (observer: ((value: LibraryBackupProgress) => void) | undefined, value: LibraryBackupProgress) => { try { observer?.(value); } catch { /* Observers do not control backup durability. */ } };
export class LibraryBackupFailure extends Error {
  readonly code: 'BACKUP_INVALID' | 'IO_ERROR' | 'RECOVERY_REQUIRED' | 'CANCELLED';
  constructor(code: 'BACKUP_INVALID' | 'IO_ERROR' | 'RECOVERY_REQUIRED' | 'CANCELLED') { super(code); this.code = code; }
}
const fail = (code: LibraryBackupFailure['code']): never => { throw new LibraryBackupFailure(code); };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const missing = (value: unknown) => object(value) && value.code === 'ENOENT';
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function settings(overrides?: Partial<Limits>): Limits {
  const result = { ...DEFAULT_LIMITS, ...overrides };
  if (Object.values(result).some(value => !Number.isSafeInteger(value) || value <= 0)) fail('BACKUP_INVALID');
  return result;
}
function relative(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || path.isAbsolute(value) || /[\\:\x00-\x1f\x7f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) return fail('BACKUP_INVALID');
  return value;
}
async function directory(value: string) { const stat = await lstat(value); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('BACKUP_INVALID'); }
async function syncDirectory(value: string) { const handle = await open(value, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file); await syncDirectory(path.dirname(file));
}
type RestoreJournal = { schemaVersion: 1; destination: string; stage: string; previous: string; failed: string; phase: 'prepared' | 'installed' | 'committed' };
async function presentDirectory(file: string) { try { await directory(file); return true; } catch (error) { if (missing(error)) return false; throw error; } }
async function clearJournal(file: string) { await rm(file, { force: true }); await syncDirectory(path.dirname(file)); }
/** Run before opening any database or creating a missing library directory. */
export async function recoverLibraryRestore(options: { dataDirectory: string }): Promise<{ recovered: boolean; state?: 'rolled-back' | 'committed' }> {
  if (!path.isAbsolute(options.dataDirectory)) fail('BACKUP_INVALID');
  const destination = path.resolve(options.dataDirectory), parent = path.dirname(destination), name = path.basename(destination), file = `${destination}.restore-journal.json`;
  let journal: RestoreJournal;
  try { const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { if ((await handle.stat()).size > 16_384) fail('RECOVERY_REQUIRED'); journal = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); } }
  catch (error) { if (missing(error)) return { recovered: false }; return fail('RECOVERY_REQUIRED'); }
  const uuid = '[a-f0-9-]{36}';
  if (!object(journal) || journal.schemaVersion !== 1 || journal.destination !== name || !['prepared','installed','committed'].includes(journal.phase) || !['stage','previous','failed'].every(key => typeof journal[key as keyof RestoreJournal] === 'string') || !/^\.gitworld-restore-[A-Za-z0-9]{6}$/.test(journal.stage) || !journal.previous.startsWith(`${name}.before-restore-`) || !new RegExp(`^${uuid}$`).test(journal.previous.slice(`${name}.before-restore-`.length)) || !journal.failed.startsWith(`${name}.failed-restore-`) || !new RegExp(`^${uuid}$`).test(journal.failed.slice(`${name}.failed-restore-`.length)) || [journal.previous,journal.failed].some(value => value.includes('/') || value.includes('\\'))) fail('RECOVERY_REQUIRED');
  const stage = path.join(parent, journal.stage), previous = path.join(parent, journal.previous), failed = path.join(parent, journal.failed);
  try {
    const hasDestination = await presentDirectory(destination), hasPrevious = await presentDirectory(previous);
    if (journal.phase === 'committed') { if (!hasDestination) fail('RECOVERY_REQUIRED'); await clearJournal(file); return { recovered: true, state: 'committed' }; }
    if (hasPrevious) {
      if (hasDestination) { if (await presentDirectory(failed)) fail('RECOVERY_REQUIRED'); await rename(destination, failed); }
      await rename(previous, destination); await syncDirectory(parent);
    } else if (!hasDestination) fail('RECOVERY_REQUIRED');
    await rm(stage, { recursive: true, force: true }); await clearJournal(file); return { recovered: true, state: 'rolled-back' };
  } catch { return fail('RECOVERY_REQUIRED'); }
}
async function fileHash(value: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(value)) hash.update(chunk); return hash.digest('hex'); }
async function prefix(value: string, length: number) {
  const file = await open(value, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await file.stat(); if (!stat.isFile()) fail('BACKUP_INVALID'); const bytes = Buffer.alloc(length); const read = await file.read(bytes, 0, length, 0); return bytes.subarray(0, read.bytesRead); }
  finally { await file.close(); }
}
async function sqliteIntegrity(value: string) {
  let database: DatabaseSync | undefined;
  try { database = new DatabaseSync(value, { readOnly: true }); const rows = database.prepare('PRAGMA integrity_check').all(); if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') fail('BACKUP_INVALID'); }
  catch { return fail('BACKUP_INVALID'); } finally { database?.close(); }
}
async function snapshotSqlite(source: string, destination: string) {
  const database = new DatabaseSync(source, { readOnly: true });
  try { database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); }
  finally { database.close(); }
  await sqliteIntegrity(destination);
}
async function copyFile(source: string, destination: string) {
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const destinationHandle = await open(destination, 'wx', 0o600);
  try { for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) await destinationHandle.writeFile(chunk); await destinationHandle.sync(); }
  finally { await sourceHandle.close(); await destinationHandle.close(); }
}
function validateManifest(value: unknown, limits: Limits): Manifest {
  if (!object(value) || value.format !== 'gitworld-library-v1' || value.schemaVersion !== 1 || !Number.isSafeInteger(value.databaseSchemaVersion) || value.databaseSchemaVersion < 1 || value.databaseSchemaVersion > DATABASE_SCHEMA_VERSION || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > limits.maxFiles) return fail('BACKUP_INVALID');
  let total = 0; const seen = new Set<string>();
  for (const entry of value.files) {
    if (!object(entry) || Object.keys(entry).some(key => !['path','bytes','sha256','mode'].includes(key))) fail('BACKUP_INVALID');
    const name = relative(entry.path), collision = name.normalize('NFC').toLowerCase();
    if (seen.has(collision) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > limits.maxFileBytes || typeof entry.sha256 !== 'string' || !SHA.test(entry.sha256) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) fail('BACKUP_INVALID');
    seen.add(collision); total += entry.bytes;
    if (total > limits.maxTotalBytes) fail('BACKUP_INVALID');
  }
  if (total !== value.totalBytes || !value.files.some((entry: Entry) => entry.path === 'library.sqlite')) fail('BACKUP_INVALID');
  return value as Manifest;
}

export async function detectLibraryBackup(sourcePath: string): Promise<'full' | 'sqlite' | 'unknown'> {
  const start = await prefix(sourcePath, LIBRARY_BACKUP_MAGIC.length);
  return start.equals(LIBRARY_BACKUP_MAGIC) ? 'full' : start.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC) ? 'sqlite' : 'unknown';
}

/** Caller must hold its mutation barrier and finish/cancel source jobs before taking the snapshot. */
export async function createLibraryBackup(options: { dataDirectory: string; destinationPath: string; sqliteSnapshot?: (destination: string) => Promise<unknown>; limits?: Partial<Limits>; onProgress?: (value: LibraryBackupProgress) => void; signal?: AbortSignal }): Promise<FullBackupReceipt> {
  const limits = settings(options.limits), source = path.resolve(options.dataDirectory), destination = path.resolve(options.destinationPath);
  if (!path.isAbsolute(options.dataDirectory) || !path.isAbsolute(options.destinationPath) || destination === source || destination.startsWith(source + path.sep)) fail('BACKUP_INVALID');
  await directory(source); await directory(path.dirname(destination));
  const stage = await mkdtemp(path.join(path.dirname(source), '.gitworld-backup-'));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const files: Entry[] = [];
    async function visit(relativeDirectory = '') {
      for (const entry of (await readdir(path.join(source, relativeDirectory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (options.signal?.aborted) fail('CANCELLED');
        const name = relative(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name), input = path.join(source, name), output = path.join(stage, name), stat = await lstat(input);
        if (stat.isSymbolicLink() || stat.nlink > 1 && !stat.isDirectory() || !stat.isDirectory() && !stat.isFile()) fail('BACKUP_INVALID');
        if (stat.isDirectory()) { await mkdir(output, { recursive: true, mode: 0o700 }); await visit(name); continue; }
        if (name.endsWith('-wal') || name.endsWith('-shm')) {
          const primary = input.slice(0, -4); try { if ((await prefix(primary, SQLITE_MAGIC.length)).equals(SQLITE_MAGIC)) continue; } catch (error) { if (!missing(error)) throw error; }
        }
        if (stat.size > limits.maxFileBytes || files.length >= limits.maxFiles) fail('BACKUP_INVALID');
        await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        if (name === 'library.sqlite' && options.sqliteSnapshot) { await options.sqliteSnapshot(output); await sqliteIntegrity(output); }
        else if ((await prefix(input, SQLITE_MAGIC.length)).equals(SQLITE_MAGIC)) await snapshotSqlite(input, output);
        else await copyFile(input, output);
        const saved = await lstat(output); files.push({ path: name, bytes: saved.size, sha256: await fileHash(output), mode: stat.mode & 0o777 });
        progress(options.onProgress, { phase: 'snapshot', completed: files.length });
        if (files.length > limits.maxFiles || saved.size > limits.maxFileBytes) fail('BACKUP_INVALID');
      }
    }
    await visit();
    const manifest = validateManifest({ format: 'gitworld-library-v1', schemaVersion: 1, databaseSchemaVersion: DATABASE_SCHEMA_VERSION, id: randomUUID(), createdAt: new Date().toISOString(), totalBytes: files.reduce((count, file) => count + file.bytes, 0), files }, limits);
    const header = Buffer.from(JSON.stringify(manifest) + '\n'); if (header.length > limits.maxHeaderBytes) fail('BACKUP_INVALID');
    async function* content() { yield header; let completed = 0; for (const entry of files) { for await (const chunk of createReadStream(path.join(stage, entry.path))) { if (options.signal?.aborted) fail('CANCELLED'); yield chunk; } progress(options.onProgress, { phase: 'archive', completed: ++completed, total: files.length }); } }
    const target = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    target.write(LIBRARY_BACKUP_MAGIC);
    await pipeline(Readable.from(content()), createGzip({ level: 6 }), target);
    const saved = await open(temporary, 'r'); try { await saved.sync(); } finally { await saved.close(); }
    const contentHash = await fileHash(temporary), bytes = (await lstat(temporary)).size;
    await rename(temporary, destination); await syncDirectory(path.dirname(destination));
    return { id: manifest.id, createdAt: manifest.createdAt, contentHash, schemaVersion: DATABASE_SCHEMA_VERSION, format: manifest.format, files: files.length, bytes };
  } catch (error) { if (error instanceof LibraryBackupFailure) throw error; return fail(options.signal?.aborted ? 'CANCELLED' : 'IO_ERROR'); }
  finally { await rm(stage, { recursive: true, force: true }); await rm(temporary, { force: true }); }
}

class ByteReader {
  private iterator: AsyncIterator<Buffer>;
  private chunk = Buffer.alloc(0);
  private offset = 0;
  private total = 0;
  readonly maximum: number;
  constructor(stream: AsyncIterable<Buffer>, maximum: number) { this.iterator = stream[Symbol.asyncIterator](); this.maximum = maximum; }
  async available(): Promise<boolean> {
    while (this.offset >= this.chunk.length) {
      const next = await this.iterator.next(); if (next.done) return false;
      this.chunk = Buffer.from(next.value); this.offset = 0; this.total += this.chunk.length;
      if (this.total > this.maximum) fail('BACKUP_INVALID');
    }
    return true;
  }
  async line(maximum: number) {
    const chunks: Buffer[] = []; let bytes = 0;
    while (await this.available()) {
      const newline = this.chunk.indexOf(10, this.offset), end = newline < 0 ? this.chunk.length : newline;
      const part = this.chunk.subarray(this.offset, end); bytes += part.length; if (bytes > maximum) fail('BACKUP_INVALID'); chunks.push(part); this.offset = end + (newline < 0 ? 0 : 1);
      if (newline >= 0) return Buffer.concat(chunks).toString('utf8');
    }
    return fail('BACKUP_INVALID');
  }
  async file(entry: Entry, destination: string, signal?: AbortSignal) {
    const file = await open(destination, 'wx', 0o600), hash = createHash('sha256'); let remaining = entry.bytes;
    try {
      while (remaining > 0) {
        if (signal?.aborted) fail('CANCELLED');
        if (!await this.available()) fail('BACKUP_INVALID');
        const chunk = this.chunk.subarray(this.offset, this.offset + Math.min(remaining, this.chunk.length - this.offset));
        await file.writeFile(chunk); hash.update(chunk); remaining -= chunk.length; this.offset += chunk.length;
      }
      await file.sync();
    } finally { await file.close(); }
    if (hash.digest('hex') !== entry.sha256) fail('BACKUP_INVALID');
  }
}

/** Validation finishes before the caller closes live services or any directory is replaced. */
export async function restoreLibraryBackup(options: {
  dataDirectory: string; sourcePath: string; limits?: Partial<Limits>;
  validateSnapshot?: (stagedDirectory: string) => Promise<void>;
  onProgress?: (value: LibraryBackupProgress) => void;
  signal?: AbortSignal;
  /** Trusted process-death integration hook; never exposed over IPC. */
  onFault?: (point: 'after-old-rename' | 'after-install-rename' | 'after-restore-commit') => void | Promise<void>;
  beforeInstall?: () => Promise<void>; afterInstall?: () => Promise<void>;
  beforeRollback?: () => Promise<void>; afterRollback?: () => Promise<void>;
}): Promise<{ manifest: Manifest; beforeRestorePath: string }> {
  const limits = settings(options.limits), destination = path.resolve(options.dataDirectory);
  if (!path.isAbsolute(options.dataDirectory) || !path.isAbsolute(options.sourcePath) || destination === path.dirname(destination)) fail('BACKUP_INVALID');
  await directory(destination); await directory(path.dirname(destination));
  if (await detectLibraryBackup(options.sourcePath) !== 'full') fail('BACKUP_INVALID');
  const stage = await mkdtemp(path.join(path.dirname(destination), '.gitworld-restore-'));
  const previous = `${destination}.before-restore-${randomUUID()}`, failed = `${destination}.failed-restore-${randomUUID()}`;
  const journalFile = `${destination}.restore-journal.json`;
  try { await lstat(journalFile); fail('RECOVERY_REQUIRED'); } catch (error) { if (!missing(error)) throw error; }
  const journal: RestoreJournal = { schemaVersion: 1, destination: path.basename(destination), stage: path.basename(stage), previous: path.basename(previous), failed: path.basename(failed), phase: 'prepared' };
  let installed = false, movedOld = false, keepStage = false, preparing = false;
  const sourceHandle = await open(options.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  const input = sourceHandle.createReadStream({ start: LIBRARY_BACKUP_MAGIC.length, autoClose: false }), unzip = createGunzip();
  input.on('error', error => unzip.destroy(error)); input.pipe(unzip);
  try {
    const reader = new ByteReader(unzip, limits.maxTotalBytes + limits.maxHeaderBytes + 1);
    let parsed: unknown; try { parsed = JSON.parse(await reader.line(limits.maxHeaderBytes)); } catch { return fail('BACKUP_INVALID'); }
    const manifest = validateManifest(parsed, limits);
    const space = await statfs(path.dirname(destination));
    if (BigInt(space.bavail) * BigInt(space.bsize) < BigInt(manifest.totalBytes) + 16n * 1024n * 1024n) fail('IO_ERROR');
    let completed = 0;
    for (const entry of manifest.files) { if (options.signal?.aborted) fail('CANCELLED'); const output = path.join(stage, entry.path); await mkdir(path.dirname(output), { recursive: true, mode: 0o700 }); await reader.file(entry, output, options.signal); progress(options.onProgress, { phase: 'validate', completed: ++completed, total: manifest.files.length }); }
    if (await reader.available()) fail('BACKUP_INVALID');
    await sqliteIntegrity(path.join(stage, 'library.sqlite'));
    for (const entry of manifest.files) if (entry.path !== 'library.sqlite' && (await prefix(path.join(stage, entry.path), SQLITE_MAGIC.length)).equals(SQLITE_MAGIC)) await sqliteIntegrity(path.join(stage, entry.path));
    await options.validateSnapshot?.(stage);
    if (options.signal?.aborted) fail('CANCELLED');
    await atomicJson(journalFile, journal);
    progress(options.onProgress, { phase: 'install', completed: 0, total: 1 });
    preparing = true; await options.beforeInstall?.();
    await rename(destination, previous); movedOld = true;
    await options.onFault?.('after-old-rename');
    await rename(stage, destination); installed = true; await syncDirectory(path.dirname(destination));
    journal.phase = 'installed'; await atomicJson(journalFile, journal);
    await options.onFault?.('after-install-rename');
    await options.afterInstall?.();
    journal.phase = 'committed'; await atomicJson(journalFile, journal);
    await options.onFault?.('after-restore-commit');
    await clearJournal(journalFile);
    progress(options.onProgress, { phase: 'install', completed: 1, total: 1 });
    return { manifest, beforeRestorePath: previous };
  } catch (error) {
    if (movedOld) {
      try {
        await options.beforeRollback?.();
        if (installed) { await rename(destination, failed); installed = false; }
        await rename(previous, destination); movedOld = false; await syncDirectory(path.dirname(destination));
        await options.afterRollback?.(); preparing = false;
        await clearJournal(journalFile);
      }
      catch { keepStage = true; return fail('RECOVERY_REQUIRED'); }
    } else if (preparing) {
      try { await options.beforeRollback?.(); await options.afterRollback?.(); await clearJournal(journalFile); }
      catch { return fail('RECOVERY_REQUIRED'); }
    }
    if (error instanceof LibraryBackupFailure) throw error;
    return fail(installed ? 'RECOVERY_REQUIRED' : 'BACKUP_INVALID');
  } finally { input.destroy(); unzip.destroy(); await sourceHandle.close(); if (!keepStage) await rm(stage, { recursive: true, force: true }); }
}
