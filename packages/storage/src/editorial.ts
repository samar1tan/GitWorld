import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { EditorialChange, EditorialCommit, EditorialCommitInput, EditorialFailureCode, EditorialIdentity, EditorialJson, EditorialReadSource, EditorialRepository, EditorialRevertInput, EditorialStage, EditorialStatus, EditorialWrite, EditorialWriteProgress } from '../../contracts/src/editorial-types.ts';
import { DEFAULT_EDITORIAL_IDENTITY, EDITORIAL_MAX_PATHS, validEditorialIdentity } from '../../contracts/src/editorial-types.ts';
import { navigationPath, validNavigationDefinition, validNavigationShard } from '../../contracts/src/navigation-validation.ts';

const OID = /^[a-f0-9]{40}$/;
const MAX_FILE = 16 * 1024 * 1024;
const roots = new Set(['model', 'models', 'objects', 'assertions', 'research', 'sources', 'mappings', 'views', 'navigation']);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const ZERO = '0'.repeat(40);
export class EditorialFailure extends Error {
  readonly code: EditorialFailureCode;
  constructor(code: EditorialFailureCode) { super(code); this.code = code; }
}
const fail = (code: EditorialFailureCode): never => { throw new EditorialFailure(code); };
const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
const filePath = (value: string) => {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(value) || !roots.has(value.split('/')[0]) || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || ['__proto__', 'constructor', 'prototype'].includes(part))) return fail('INVALID_PATH');
  if (value.startsWith('navigation/') && !navigationPath(value)) return fail('INVALID_PATH');
  return value;
};
function navigationBody(name: string, value: EditorialJson) {
  if (!name.startsWith('navigation/')) return;
  if (name.endsWith('/definition.json')) {
    if (!validNavigationDefinition(value) || name !== `navigation/contexts/${digest(canonicalJson(value.id))}/definition.json`) fail('INVALID_REQUEST');
  } else if (!validNavigationShard(value) || name !== `navigation/contexts/${digest(canonicalJson(value.contextId))}/members/${value.partition}.json` || value.members.some(member => digest(canonicalJson(member.objectId)).slice(0,2) !== value.partition)) fail('INVALID_REQUEST');
}
const oid = (value: string) => OID.test(value) ? value : fail('INVALID_REQUEST');
function prefixPath(value: string) {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || !roots.has(value.replace(/\/$/, '').split('/')[0]) || value.includes('..') || value.replace(/\/$/, '').split('/').some(part => !part || part.startsWith('.'))) return fail('INVALID_PATH');
  return roots.has(value) ? value + '/' : value;
}
const operationId = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value) ? value : fail('INVALID_REQUEST');
const message = (value: string) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= 16_384 && !value.includes('\0') ? value.trim() : fail('INVALID_REQUEST');
function jsonBody(value: EditorialJson) {
  let body: string; try { body = canonicalJson(value) + '\n'; } catch { return fail('INVALID_REQUEST'); }
  if (Buffer.byteLength(body) > MAX_FILE) return fail('INVALID_REQUEST');
  return body;
}
async function normalDirectory(directory: string, create = false) {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('CORRUPT_REPOSITORY');
}
async function atomicFile(destination: string, bytes: string, temporaryDirectory?: string) {
  const temporary = temporaryDirectory ? path.join(temporaryDirectory, `${randomUUID()}.tmp`) : `${destination}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, destination);
    const directory = await open(path.dirname(destination), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }); }
}

type GitResult = { code: number | null; stdout: string; stderr: string };
type PreparedOperation = { id: string; signature: string; target: string; expected: string; tree: string; oid: string; state: string };
export type EditorialRepositoryOptions = {
  dataDirectory: string;
  gitExecutable: string;
  gitExecPath?: string;
  identity?: EditorialIdentity;
  /** Trusted candidate admission: require existing history instead of initializing it. */
  requireExistingHead?: boolean;
  /** Trusted host observer; receives counts only and never controls a write. */
  onWriteProgress?: (progress: EditorialWriteProgress) => void | Promise<void>;
  /** Trusted integration-test hook; never exposed over IPC. */
  onFault?: (point: 'after-object' | 'before-ref' | 'after-ref' | 'after-receipt') => void | Promise<void>;
};

/** Manages only the application-owned local repository. Git remains the content authority. */
export async function createEditorialRepository(options: EditorialRepositoryOptions): Promise<EditorialRepository> {
  if (!path.isAbsolute(options.dataDirectory) || !path.isAbsolute(options.gitExecutable) || options.gitExecPath && !path.isAbsolute(options.gitExecPath)) fail('INVALID_REQUEST');
  await normalDirectory(options.dataDirectory, true);
  const base = await realpath(options.dataDirectory), repo = path.join(base, 'repository'), gitDir = path.join(repo, '.git');
  const temporaryDirectory = path.join(base, 'editorial-temporary');
  await normalDirectory(temporaryDirectory, true);
  const author = options.identity ?? DEFAULT_EDITORIAL_IDENTITY;
  if (!validEditorialIdentity(author)) fail('INVALID_REQUEST');
  const lock = new DatabaseSync(path.join(base, 'editorial-write-lock.sqlite'));
  lock.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS writer (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL); INSERT OR IGNORE INTO writer VALUES (1,0)');
  const operations = new DatabaseSync(path.join(base, 'editorial-operations.sqlite'));
  operations.exec("PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, signature TEXT NOT NULL, target TEXT NOT NULL, expected TEXT NOT NULL, tree TEXT NOT NULL, oid TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','complete'))); CREATE TABLE IF NOT EXISTS revert_state (id INTEGER PRIMARY KEY CHECK(id=1), operation_id TEXT NOT NULL, commit_oid TEXT NOT NULL, original_head TEXT NOT NULL)");
  let tail: Promise<unknown> = Promise.resolve(), closed = false, initialized = false;
  const environment: NodeJS.ProcessEnv = {
    PATH: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    ...(options.gitExecPath ? { GIT_EXEC_PATH: options.gitExecPath } : {}),
    GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email,
  };
  const config = ['--no-pager', '--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.fsync=all', '-c', 'core.fsyncMethod=fsync', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'core.pager=', '-c', 'core.editor=/usr/bin/false', '-c', 'sequence.editor=/usr/bin/false', '-c', 'diff.external=', '-c', 'core.quotePath=false'];
  async function git(args: string[], input?: string, allowFailure = false, initializing = false): Promise<GitResult> {
    const result = await new Promise<GitResult>((resolve, reject) => {
      const child = spawn(options.gitExecutable, [...config, ...(initializing ? [] : [`--git-dir=${gitDir}`, `--work-tree=${repo}`]), ...args], { cwd: initializing ? base : repo, env: environment, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [], stderr: Buffer[] = []; let bytes = 0, exceeded = false;
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      const append = (target: Buffer[]) => (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32 * MAX_FILE) { exceeded = true; child.kill('SIGKILL'); } else target.push(chunk); };
      child.stdout.on('data', append(stdout)); child.stderr.on('data', append(stderr));
      child.on('error', () => { clearTimeout(timer); reject(new EditorialFailure('GIT_UNAVAILABLE')); });
      child.on('close', code => { clearTimeout(timer); if (exceeded) reject(new EditorialFailure('GIT_FAILED')); else resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }); });
      child.stdin.on('error', () => {}); child.stdin.end(input);
    });
    if (!allowFailure && result.code !== 0) {
      if (result.stderr.includes('index.lock') || result.stderr.includes('Unable to create') && result.stderr.includes('.lock')) fail('REPOSITORY_BUSY');
      fail('GIT_FAILED');
    }
    return result;
  }
  const value = async (args: string[], input?: string, allowFailure = false) => (await git(args, input, allowFailure)).stdout.trim();
  async function owned() {
    await normalDirectory(repo); await normalDirectory(gitDir);
    const marker = JSON.parse(await readFile(path.join(base, 'editorial-owned.json'), 'utf8'));
    if (marker?.schemaVersion !== 1 || marker.repository !== 'repository') fail('UNOWNED_REPOSITORY');
    for (const forbidden of ['commondir', 'objects/info/alternates']) { try { await lstat(path.join(gitDir, forbidden)); fail('CORRUPT_REPOSITORY'); } catch (error) { if (!missing(error)) throw error; } }
  }
  async function coordinated<T>(fn: () => Promise<T>, allowInitialize = false): Promise<T> {
    if (closed) fail('GIT_UNAVAILABLE');
    const task = tail.then(async () => {
      if (closed) fail('GIT_UNAVAILABLE');
      try { lock.exec('BEGIN IMMEDIATE; UPDATE writer SET version=version+1 WHERE id=1'); }
      catch { fail('REPOSITORY_BUSY'); }
      try { if (!allowInitialize) { if (!initialized) fail('UNOWNED_REPOSITORY'); await owned(); } const result = await fn(); lock.exec('COMMIT'); return result; }
      catch (error) { try { lock.exec('ROLLBACK'); } catch { /* A failed coordinator commit remains a failed operation. */ } throw error; }
    });
    tail = task.catch(() => undefined); return task;
  }
  async function commitOid(ref = 'HEAD'): Promise<string> {
    const result = await git(['rev-parse', '--verify', `${ref}^{commit}`], undefined, true);
    if (result.code !== 0 || !OID.test(result.stdout.trim())) fail('NOT_FOUND');
    return result.stdout.trim();
  }
  async function activeBranch() { const result = await git(['symbolic-ref', '-q', 'HEAD'], undefined, true); return result.code === 0 ? result.stdout.trim().replace(/^refs\/heads\//, '') : null; }
  async function resolveReadSource(from: EditorialReadSource): Promise<string | null> {
    if (from === 'working') return null;
    if (from === 'staged') return value(['write-tree']);
    if (from.startsWith('tree:')) {
      const tree = oid(from.slice(5));
      if (await value(['cat-file', '-t', tree], undefined, true) !== 'tree') fail('NOT_FOUND');
      return tree;
    }
    return commitOid(oid(from));
  }
  async function names(from: EditorialReadSource) {
    const ref = await resolveReadSource(from);
    const command = ref === null ? ['ls-files', '--cached', '--others', '--exclude-standard', '-z'] : ['ls-tree', '-r', '--name-only', '-z', ref];
    return [...new Set((await git(command)).stdout.split('\0').filter(Boolean).map(filePath))].sort();
  }
  function revertState() { return operations.prepare('SELECT operation_id,commit_oid,original_head FROM revert_state WHERE id=1').get() as { operation_id: string; commit_oid: string; original_head: string } | undefined; }
  async function changes(args: string[]): Promise<EditorialChange[]> {
    const output = (await git(['diff', '--no-ext-diff', '--no-renames', '--name-status', '-z', ...args, '--'])).stdout.split('\0');
    const result: EditorialChange[] = [];
    for (let i = 0; i + 1 < output.length; i += 2) {
      if (!output[i]) continue;
      const name = filePath(output[i + 1]), kind = output[i][0];
      result.push({ path: name, kind: kind === 'A' ? 'added' : kind === 'D' ? 'deleted' : kind === 'U' ? 'conflict' : 'modified' });
    }
    return result;
  }
  async function status(): Promise<EditorialStatus> {
    const head = await commitOid(), branch = await activeBranch();
    const unmerged = (await git(['diff', '--name-only', '--diff-filter=U', '-z', '--'])).stdout.split('\0').filter(Boolean).map(filePath);
    const staged = await changes(['--cached', head]), unstaged = await changes([]);
    const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z'])).stdout.split('\0').filter(Boolean).map(filePath);
    for (const file of untracked) if (!unstaged.some(item => item.path === file)) unstaged.push({ path: file, kind: 'added' });
    const state = revertState();
    return { head, branch, stagedTree: unmerged.length ? '' : await value(['write-tree']), staged, unstaged, conflicts: unmerged,
      revert: state ? { commitOid: state.commit_oid, operationId: state.operation_id } : null };
  }
  async function workingPath(name: string, createParents = false): Promise<string> {
    const parts = filePath(name).split('/'); let current = repo;
    for (const segment of parts.slice(0, -1)) { current = path.join(current, segment); await normalDirectory(current, createParents); }
    return path.join(current, parts.at(-1)!);
  }
  async function read(name: string, from: EditorialReadSource = 'working'): Promise<EditorialJson | null> {
    filePath(name); let text: string;
    if (from === 'working') {
      try { const full = await workingPath(name); const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await file.stat(); if (!stat.isFile() || stat.size > MAX_FILE) fail('CORRUPT_REPOSITORY'); text = await file.readFile('utf8'); } finally { await file.close(); } }
      catch (error) { if (missing(error)) return null; throw error; }
    } else {
      const ref = await resolveReadSource(from);
      const result = await git(['show', `${ref}:${name}`], undefined, true);
      if (result.code !== 0) return null;
      text = result.stdout;
    }
    try { const result = JSON.parse(text); jsonBody(result); navigationBody(name,result); return result; } catch { return fail('CORRUPT_REPOSITORY'); }
  }
  async function write(changes: EditorialWrite[]) {
    if (!Array.isArray(changes) || !changes.length || changes.length > EDITORIAL_MAX_PATHS || new Set(changes.map(item => item.path)).size !== changes.length) fail('INVALID_REQUEST');
    const prepared = changes.map(item => {filePath(item.path);if(item.value!==null)navigationBody(item.path,item.value);return {path:item.path,body:item.value===null?null:jsonBody(item.value)};});
    let completed = 0, reported = 0;
    const notify = () => {
      if (completed === reported) return;
      reported = completed;
      try { const observed = options.onWriteProgress?.(Object.freeze({ completed, total: prepared.length })); if (observed) void Promise.resolve(observed).catch(() => undefined); }
      catch { /* Observer failures cannot change a durable write. */ }
    };
    try {
      for (const item of prepared) {
        const full = await workingPath(item.path, true);
        if (item.body === null) {
          await rm(full, { force: true });
          const directory = await open(path.dirname(full), 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        } else await atomicFile(full, item.body, temporaryDirectory);
        // atomicFile has completed file sync, rename and parent-directory sync.
        completed++;
        if (completed % 100 === 0 || completed === prepared.length) notify();
      }
    } catch (error) { notify(); throw error; }
  }
  async function stage(changes: EditorialStage[]) {
    if (!Array.isArray(changes) || !changes.length || changes.length > EDITORIAL_MAX_PATHS || new Set(changes.map(item => item.path)).size !== changes.length) fail('INVALID_REQUEST');
    const prepared = changes.map(change => ({ name: filePath(change.path), hash: null as string | null }));
    const maxBatchBytes = 32 * 1024 * 1024;
    let batch: { index: number; command: string; expectedHash: string }[] = [], batchBytes = 5;
    const importBatch = async () => {
      if (!batch.length) return;
      // Only literal blob/mark/data/get-mark/done commands are emitted. Raw UTF-8
      // data uses exact byte lengths; no paths, refs, filters or user commands enter the protocol.
      const hashes = (await value(['-c', 'fastimport.unpackLimit=0', 'fast-import', '--quiet', '--done'], batch.map(item => item.command).join('') + 'done\n')).split('\n');
      if (hashes.length !== batch.length || hashes.some((hash, index) => !OID.test(hash) || hash !== batch[index].expectedHash)) fail('GIT_FAILED');
      for (let index = 0; index < batch.length; index++) prepared[batch[index].index].hash = hashes[index];
      batch = []; batchBytes = 5;
    };
    for (let index = 0; index < changes.length; index++) {
      const change = changes[index], content = Object.hasOwn(change, 'value') ? change.value : await read(prepared[index].name);
      if (content === undefined) return fail('INVALID_REQUEST');
      if (content === null) continue;
      navigationBody(prepared[index].name,content);
      const body = jsonBody(content), bytes = Buffer.byteLength(body, 'utf8');
      const command = (mark: number) => `blob\nmark :${mark}\ndata ${bytes}\n${body}\nget-mark :${mark}\n`;
      let encoded = command(batch.length + 1), commandBytes = Buffer.byteLength(encoded, 'utf8');
      if (batchBytes + commandBytes > maxBatchBytes) { await importBatch(); encoded = command(1); commandBytes = Buffer.byteLength(encoded, 'utf8'); }
      const expectedHash = createHash('sha1').update(`blob ${bytes}\0`, 'utf8').update(body, 'utf8').digest('hex');
      batch.push({ index, command: encoded, expectedHash }); batchBytes += commandBytes;
    }
    await importBatch();
    const entries: string[] = [];
    for (const item of prepared) { entries.push(`0 ${ZERO}\t${item.name}\0`); if (item.hash) entries.push(`100644 ${item.hash}\t${item.name}\0`); }
    // Git durably completes every pack before one atomic replacement of the index.
    // A failed batch can leave unreferenced objects; it cannot publish a partial selection.
    await git(['update-index', '-z', '--index-info'], entries.join(''));
  }
  async function readCommit(hash: string): Promise<EditorialCommit> {
    await commitOid(oid(hash));
    const raw = (await git(['cat-file', 'commit', hash])).stdout, divider = raw.indexOf('\n\n');
    const headers = raw.slice(0, divider).split('\n'), authorLine = headers.find(line => line.startsWith('author ')) ?? '';
    const match = authorLine.match(/^author (.*) <([^<>]*)> (\d+) [+-]\d{4}$/);
    if (!match) return fail('CORRUPT_REPOSITORY');
    return { oid: hash, parents: headers.filter(line => line.startsWith('parent ')).map(line => line.slice(7)), message: raw.slice(divider + 2).trimEnd(), author: { name: match[1], email: match[2] }, authoredAt: new Date(Number(match[3]) * 1000).toISOString(), branch: null };
  }
  async function branchName(name: string) {
    if (typeof name !== 'string' || name.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || (await git(['check-ref-format', '--branch', name], undefined, true)).code !== 0) fail('INVALID_REQUEST');
    return name;
  }
  async function commit(input: EditorialCommitInput): Promise<EditorialCommit> {
    operationId(input.operationId); oid(input.expectedHead); if (input.expectedTree !== undefined) oid(input.expectedTree); const body = message(input.message);
    const key = digest(input.operationId), signature = digest(canonicalJson({ kind: 'commit', expectedHead: input.expectedHead, expectedTree: input.expectedTree, message: body }));
    let prepared = operations.prepare('SELECT * FROM operations WHERE id=?').get(key) as PreparedOperation | undefined;
    if (prepared && prepared.signature !== signature) fail('IDEMPOTENCY_CONFLICT');
    if (!prepared) {
      const current = await status();
      if (current.head !== input.expectedHead) fail('HEAD_CHANGED');
      if (input.expectedTree !== undefined && current.stagedTree !== input.expectedTree) fail('STAGE_CHANGED');
      if (!current.branch) fail('DETACHED_HEAD');
      if (current.conflicts.length) fail('REVERT_CONFLICT');
      if (!current.staged.length) fail('NOTHING_STAGED');
      const hash = await value(['commit-tree', current.stagedTree, '-p', current.head], body + '\n');
      prepared = { id: key, signature, target: `refs/heads/${current.branch}`, expected: current.head, tree: current.stagedTree, oid: hash, state: 'prepared' };
      operations.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?,?)').run(prepared.id, prepared.signature, prepared.target, prepared.expected, prepared.tree, prepared.oid, prepared.state);
      await git(['update-ref', `refs/gitworld/pending/${key}`, hash, ZERO]);
      await options.onFault?.('after-object');
    }
    const currentTarget = await commitOid(prepared.target);
    const alreadyCommitted = currentTarget === prepared.oid || (await git(['merge-base', '--is-ancestor', prepared.oid, currentTarget], undefined, true)).code === 0;
    if (!alreadyCommitted) {
      if (prepared.state === 'complete') fail('HEAD_CHANGED');
      const current = await status();
      if (`refs/heads/${current.branch}` !== prepared.target || current.head !== prepared.expected) fail('HEAD_CHANGED');
      if (current.stagedTree !== prepared.tree) fail('STAGE_CHANGED');
      await options.onFault?.('before-ref');
      const changed = await git(['update-ref', '-m', 'GitWorld local commit', prepared.target, prepared.oid, prepared.expected], undefined, true);
      if (changed.code !== 0) fail('HEAD_CHANGED');
      await options.onFault?.('after-ref');
    }
    operations.prepare("UPDATE operations SET state='complete' WHERE id=?").run(key);
    if (revertState()) { await git(['revert', '--quit'], undefined, true); operations.prepare('DELETE FROM revert_state WHERE id=1').run(); }
    await options.onFault?.('after-receipt');
    await git(['update-ref', '-d', `refs/gitworld/pending/${key}`, prepared.oid], undefined, true);
    return { ...await readCommit(prepared.oid), branch: prepared.target.replace(/^refs\/heads\//, '') };
  }
  return {
    initialize(seedFiles = {}) { return coordinated(async () => {
      if (options.requireExistingHead) {
        await owned(); await commitOid();
        initialized = true; return status();
      }
      const markerPath = path.join(base, 'editorial-owned.json');
      let marker: unknown;
      try { marker = JSON.parse(await readFile(markerPath, 'utf8')); } catch (error) { if (!missing(error)) fail('UNOWNED_REPOSITORY'); }
      if (marker === undefined) {
        try { const existing = await lstat(repo); if (existing) fail('UNOWNED_REPOSITORY'); } catch (error) { if (!missing(error)) throw error; }
        await atomicFile(markerPath, JSON.stringify({ schemaVersion: 1, repository: 'repository', id: randomUUID() }));
      }
      await normalDirectory(repo, true);
      try { await lstat(gitDir); } catch (error) { if (!missing(error)) throw error; await git(['init', '--initial-branch=main', '--template=', repo], undefined, false, true); }
      await owned();
      const initial = await git(['rev-parse', '--verify', 'HEAD'], undefined, true);
      if (initial.code !== 0) {
        const entries = Object.entries(seedFiles).map(([name, value]) => ({ path: filePath(name), value }));
        if (entries.length) { await write(entries); await stage(entries.map(item => ({ path: item.path }))); }
        const tree = await value(['write-tree']);
        const hash = await value(['commit-tree', tree], 'Initialize local history library\n');
        const changed = await git(['update-ref', 'refs/heads/main', hash, ZERO], undefined, true); if (changed.code !== 0) fail('HEAD_CHANGED');
      }
      initialized = true; return status();
    }, true); },
    status: () => coordinated(status),
    read: (name, input = {}) => coordinated(() => read(name, input.from)),
    list: (input = {}) => coordinated(async () => {
      const from = input.from ?? 'working';
      const prefix = input.prefix === undefined ? undefined : prefixPath(input.prefix);
      return (await names(from)).filter(name => !prefix || name.startsWith(prefix));
    }),
    snapshot: (input = {}) => coordinated(async () => {
      const from = input.from ?? 'working';
      const prefixes = input.prefixes?.map(prefixPath);
      if (prefixes && prefixes.length > 100) fail('INVALID_REQUEST');
      if (input.paths && input.paths.length > EDITORIAL_MAX_PATHS) fail('INVALID_REQUEST');
      const paths = input.paths ? new Set(input.paths.map(filePath)) : null;
      // A staged snapshot pins the immutable tree before reading any content.
      const ref = await resolveReadSource(from), tree = ref === null ? null : await value(['rev-parse', `${ref}^{tree}`]);
      const matches = (name: string) => (!paths || paths.has(name)) && (!prefixes || prefixes.some(prefix => name.startsWith(prefix)));
      const files: Record<string, EditorialJson> = {};
      if (ref === null) {
        for (const name of (await names('working')).filter(matches)) { const content = await read(name); if (content !== null) files[name] = content; }
      } else {
        // Resolve paths once. Repeating commit:path lookups makes large flat trees quadratic.
        const entries = (await git(['ls-tree', '-r', '-l', '-z', '--full-tree', tree!])).stdout.split('\0').filter(Boolean).map(line => {
          const match = line.match(/^100644 blob ([a-f0-9]{40}) +(\d+)\t(.+)$/);
          if (!match || Number(match[2]) > MAX_FILE) return fail('CORRUPT_REPOSITORY');
          return { oid: match[1], size: Number(match[2]), name: filePath(match[3]) };
        }).filter(entry => matches(entry.name));
        for (let first = 0; first < entries.length;) {
          const batch: typeof entries = []; let total = 0;
          do { const entry = entries[first++]; batch.push(entry); total += entry.size; } while (first < entries.length && batch.length < 1024 && total + entries[first].size <= 32 * 1024 * 1024);
          const bytes = Buffer.from((await git(['cat-file', '--batch'], batch.map(entry => `${entry.oid}\n`).join(''))).stdout, 'utf8');
          let offset = 0;
          for (const entry of batch) {
            const newline = bytes.indexOf(10, offset), header = newline < 0 ? null : bytes.subarray(offset, newline).toString('ascii').match(/^([a-f0-9]{40}) blob (\d+)$/);
            if (!header || header[1] !== entry.oid || Number(header[2]) !== entry.size) return fail('CORRUPT_REPOSITORY');
            const start = newline + 1, end = start + entry.size;
            if (end >= bytes.length || bytes[end] !== 10) fail('CORRUPT_REPOSITORY');
            try { const parsed = JSON.parse(bytes.subarray(start, end).toString('utf8')); jsonBody(parsed); navigationBody(entry.name,parsed); files[entry.name] = parsed; } catch { fail('CORRUPT_REPOSITORY'); }
            offset = end + 1;
          }
          if (offset !== bytes.length) fail('CORRUPT_REPOSITORY');
        }
      }
      return { source: from, head: OID.test(from) ? from : await commitOid(), tree, files };
    }),
    write: (changes, guards = {}) => coordinated(async () => {
      if (guards.expectedHead !== undefined && await commitOid() !== oid(guards.expectedHead)) fail('HEAD_CHANGED');
      for (const [name, expected] of Object.entries(guards.expectedContentHashes ?? {})) {
        filePath(name); if (expected !== null && !/^[a-f0-9]{64}$/.test(expected)) fail('INVALID_REQUEST');
        const current = await read(name), hash = current === null ? null : digest(canonicalJson(current));
        if (hash !== expected) fail('CONTENT_CHANGED');
      }
      await write(changes); return status();
    }),
    stage: changes => coordinated(async () => { await stage(changes); return status(); }),
    unstage: names => coordinated(async () => {
      if (!Array.isArray(names) || !names.length || names.length > EDITORIAL_MAX_PATHS || new Set(names).size !== names.length) fail('INVALID_REQUEST');
      for (const name of names) filePath(name);
      // Resolve the immutable HEAD tree once; per-path rev-parse is quadratic in flat trees.
      const blobs = new Map<string, string>();
      for (const entry of (await git(['ls-tree', '-r', '-z', '--full-tree', await commitOid()])).stdout.split('\0').filter(Boolean)) {
        const match = entry.match(/^100644 blob ([a-f0-9]{40})\t(.+)$/);
        if (!match) fail('CORRUPT_REPOSITORY');
        blobs.set(filePath(match![2]), match![1]);
      }
      const entries = names.map(name => `0 ${ZERO}\t${name}\0${blobs.has(name) ? `100644 ${blobs.get(name)}\t${name}\0` : ''}`).join('');
      // All validation and tree reads finish before Git atomically replaces its index.
      await git(['update-index', '-z', '--index-info'], entries); return status();
    }),
    commit: input => coordinated(() => commit(input)),
    setIdentity: identity => coordinated(async () => {
      if (!validEditorialIdentity(identity)) fail('INVALID_REQUEST');
      Object.assign(environment, { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email });
    }),
    log: (limit = 50) => coordinated(async () => { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_REQUEST'); const branch = await activeBranch(), hashes = (await value(['rev-list', `--max-count=${limit}`, 'HEAD'])).split('\n').filter(Boolean); return Promise.all(hashes.map(async hash => ({ ...await readCommit(hash), branch }))); }),
    findModelRevision: (name, contentHash) => coordinated(async () => {
      filePath(name);
      if (!/^models\/[a-f0-9]{64}\.json$/.test(name) || !/^[a-f0-9]{64}$/.test(contentHash)) fail('INVALID_REQUEST');
      // Search committed path changes, including other branches, without moving HEAD.
      const commits = (await value(['log', '--all', '--format=%H', '--max-count=10001', '--', name])).split('\n').filter(Boolean);
      for (const commit of commits.slice(0, 10000)) {
        oid(commit);
        const result = await git(['show', `${commit}:${name}`], undefined, true);
        if (result.code !== 0) continue; // A deletion has no package at this commit.
        let data: unknown;
        try { data = JSON.parse(result.stdout); } catch { return fail('CORRUPT_REPOSITORY'); }
        if (digest(canonicalJson(data)) === contentHash) return commit;
      }
      // A bounded search never substitutes an unrelated current revision.
      if (commits.length > 10000) fail('INVALID_REQUEST');
      return null;
    }),
    branches: () => coordinated(async () => {
      const current = await activeBranch();
      return (await value(['for-each-ref', '--format=%(refname:lstrip=2) %(objectname)', 'refs/heads/'])).split('\n').filter(Boolean).map(line => {
        const separator = line.lastIndexOf(' '), name = line.slice(0, separator), hash = line.slice(separator + 1);
        if (separator < 1 || !OID.test(hash)) return fail('CORRUPT_REPOSITORY');
        return { name, oid: hash, current: name === current };
      });
    }),
    createBranch: name => coordinated(async () => { await branchName(name); const created = await git(['update-ref', `refs/heads/${name}`, await commitOid(), ZERO], undefined, true); if (created.code !== 0) fail('BRANCH_EXISTS'); return status(); }),
    switchBranch: name => coordinated(async () => { await branchName(name); if (revertState()) fail('REVERT_IN_PROGRESS'); const target = await commitOid(`refs/heads/${name}`).catch(() => fail('BRANCH_NOT_FOUND')), current = await status(); if ((current.staged.length || current.unstaged.length) && current.head !== target) fail('DIRTY_WORKTREE'); await git(['switch', '--no-guess', name]); return status(); }),
    checkoutDetached: hash => coordinated(async () => { await commitOid(oid(hash)); const current = await status(); if (revertState()) fail('REVERT_IN_PROGRESS'); if (current.staged.length || current.unstaged.length) fail('DIRTY_WORKTREE'); await git(['switch', '--detach', hash]); return status(); }),
    revert: input => coordinated(async () => {
      operationId(input.operationId); oid(input.expectedHead); await commitOid(oid(input.commitOid));
      const prior = revertState();
      if (prior) { if (prior.operation_id === input.operationId && prior.commit_oid === input.commitOid && prior.original_head === input.expectedHead) return status(); return fail('REVERT_IN_PROGRESS'); }
      const current = await status(); if (current.head !== input.expectedHead) fail('HEAD_CHANGED'); if (!current.branch) fail('DETACHED_HEAD'); if (current.staged.length || current.unstaged.length) fail('DIRTY_WORKTREE');
      operations.prepare('INSERT INTO revert_state VALUES (1,?,?,?)').run(input.operationId, input.commitOid, current.head);
      const reverted = await git(['revert', '--no-commit', input.commitOid], undefined, true);
      const next = await status(); if (reverted.code !== 0 && !next.conflicts.length) fail('GIT_FAILED'); return next;
    }),
    abortRevert: () => coordinated(async () => { const state = revertState(); if (!state) return fail('NOT_FOUND'); if (await commitOid() !== state.original_head) fail('HEAD_CHANGED'); await git(['read-tree', '--reset', '-u', state.original_head]); await git(['revert', '--quit'], undefined, true); operations.prepare('DELETE FROM revert_state WHERE id=1').run(); return status(); }),
    async close() { if (closed) return; await tail; closed = true; operations.close(); lock.close(); },
  };
}
