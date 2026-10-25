import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildContentManifest, canonicalJson, createHistoryEngine, snapshotTree, validateDataPackage } from '../../domain/src/index.ts';
import type { DataPackage, DatasetRef } from '../../domain/src/index.ts';
import { validateWorkspace } from '../../contracts/src/index.ts';
import type { BackupReceipt, Draft, DraftSummary, HistoryRepository, ImportPreview, LibrarySummary, RevisionSummary, ServiceError, ServiceMethods, ServiceResult, SourceConfiguration, WorkspaceState } from '../../contracts/src/index.ts';
import { DATABASE_SCHEMA_VERSION, MIGRATIONS, MIGRATION_TABLE_SQL, VERSION_ONE_VARIANTS } from './migrations.ts';

type Row = Record<string, string | number | bigint | Uint8Array | null>;
type FaultPoint = 'publish:objects' | 'publish:activate' | 'restore:installed' | 'migration:applied';
export type RepositoryOptions = { dataDirectory: string; fault?: (point: FaultPoint) => void };
/** Trusted complete-library context; never supplied by a renderer or a SQLite-only backup. */
export type BackupPackageResolver = (reference: DatasetRef) => Promise<DataPackage>;
class RepositoryError extends Error { readonly detail: ServiceError; constructor(detail: ServiceError) { super(detail.code); this.detail = detail; } }
const fail = (code: ServiceError['code'], parameters?: ServiceError['parameters']): never => { throw new RepositoryError({ code, ...(parameters ? { parameters } : {}) }); };
const hash = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const now = () => new Date().toISOString();
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const resultError = (error: unknown): ServiceResult<never> => ({ ok: false, error: error instanceof RepositoryError ? error.detail : { code: 'IO_ERROR' } });
const syncFile = (file: string) => { const fd = openSync(file, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };
const syncDirectory = (directory: string) => { const fd = openSync(directory, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };
/** VACUUM INTO provides a consistent SQLite snapshot without copying a live WAL file. */
function snapshotTo(db: DatabaseSync, destination: string): void {
  const temporary = `${destination}.${randomUUID()}.snapshot`;
  try { db.prepare('VACUUM INTO ?').run(temporary); chmodSync(temporary, 0o600); syncFile(temporary); renameSync(temporary, destination); syncDirectory(path.dirname(destination)); }
  finally { rmSync(temporary, { force: true }); }
}

function schemaDescription(db: DatabaseSync): string {
  return canonicalJson(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all());
}
function expectedSchema(statements = MIGRATIONS.map(m => m.sql)): string {
  const db = new DatabaseSync(':memory:');
  try { db.exec(MIGRATION_TABLE_SQL); for (const sql of statements) db.exec(sql); return schemaDescription(db); }
  finally { db.close(); }
}
const PREVIOUS_SCHEMAS = new Map(MIGRATIONS.map(migration => [migration.version, expectedSchema(MIGRATIONS.filter(item => item.version <= migration.version).map(item => item.sql))]));
const VERSION_ONE_SCHEMAS = new Map(VERSION_ONE_VARIANTS.map(variant => [variant.checksum, { schema: expectedSchema([variant.sql]), hasTrees: variant.hasTrees }]));

export class SqliteHistoryRepository implements HistoryRepository {
  readonly databasePath: string;
  private db: DatabaseSync | null = null;
  private maintenance = false;
  private initialized = false;
  private readonly recoveryJournal: string;
  private readonly options: RepositoryOptions;

  constructor(options: RepositoryOptions) {
    this.options = options;
    this.databasePath = path.join(path.resolve(options.dataDirectory), 'library.sqlite');
    this.recoveryJournal = path.join(path.resolve(options.dataDirectory), 'restore-journal.json');
  }
  private connection(): DatabaseSync {
    if (!this.db || !this.initialized) return fail('SERVICE_UNAVAILABLE');
    if (this.maintenance) return fail('OPERATION_IN_PROGRESS');
    return this.db;
  }
  private async run<T>(fn: (db: DatabaseSync) => Promise<T> | T): Promise<ServiceResult<T>> {
    try { return { ok: true, value: await fn(this.connection()) }; } catch (error) { return resultError(error); }
  }
  private atomic<T>(db: DatabaseSync, fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  private open(): DatabaseSync {
    const db = new DatabaseSync(this.databasePath, { allowExtension: false });
    try { db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;'); chmodSync(this.databasePath, 0o600); return db; }
    catch (error) { db.close(); throw error; }
  }
  private checkSchema(db: DatabaseSync, allowLegacy = false): { version: number; hasTrees: boolean } {
    const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
    if (version > DATABASE_SCHEMA_VERSION) fail('DATABASE_TOO_NEW');
    if (version < 1 || version !== DATABASE_SCHEMA_VERSION && !allowLegacy) fail('BACKUP_INVALID');
    const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as Row[];
    const original = VERSION_ONE_SCHEMAS.get(String(rows[0]?.checksum));
    if (!original) return fail('MIGRATION_FAILED');
    if (rows.length !== version || rows.some((row, index) => row.version !== MIGRATIONS[index]?.version || index > 0 && row.checksum !== MIGRATIONS[index].checksum)) fail('MIGRATION_FAILED');
    if (schemaDescription(db) !== (version === 1 ? original.schema : PREVIOUS_SCHEMAS.get(version))) fail('BACKUP_INVALID');
    return { version, hasTrees: version >= 2 || original.hasTrees };
  }
  private applyMigrations(db: DatabaseSync, version: number): void {
    this.atomic(db, () => {
      if (version === 0) {
        const userTables = db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
        if (userTables.length) fail('MIGRATION_FAILED');
        db.exec(MIGRATION_TABLE_SQL);
      }
      for (const migration of MIGRATIONS.filter(x => x.version > version)) {
        db.exec(migration.sql);
        if (migration.version === 2) this.backfillTrees(db);
        db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(migration.version, migration.checksum, now());
        db.exec(`PRAGMA user_version=${migration.version}`);
        this.options.fault?.('migration:applied');
      }
      this.checkSchema(db);
    });
  }
  private backfillTrees(db: DatabaseSync): void {
    for (const row of db.prepare('SELECT dataset_id,id FROM revisions').all() as Row[]) {
      const data = this.readPackage(db, { datasetId: String(row.dataset_id), revisionId: String(row.id) }, false);
      if (!validateDataPackage(data, 'publish').ok) fail('BACKUP_INVALID');
      const engine = createHistoryEngine(data.history);
      for (const commit of data.history.commits) {
        const snapshot = engine.snapshot(commit.id); if (!snapshot.ok) return fail('BACKUP_INVALID');
        const canonical = canonicalJson(snapshotTree(snapshot.value)), treeHash = hash(canonical);
        const existing = db.prepare('SELECT tree_hash FROM commit_tree_index WHERE dataset_id=? AND revision_id=? AND commit_id=?').get(data.dataset.id, data.revision.id, commit.id) as Row | undefined;
        if (existing && existing.tree_hash !== treeHash) fail('BACKUP_INVALID');
        db.prepare('INSERT INTO objects VALUES (?,?) ON CONFLICT(hash) DO NOTHING').run(treeHash, canonical);
        if (!existing) db.prepare('INSERT INTO commit_tree_index VALUES (?,?,?,?)').run(data.dataset.id, data.revision.id, commit.id, treeHash);
      }
    }
  }
  private recoverInterruptedRestore(): void {
    if (!existsSync(this.recoveryJournal)) return;
    const marker = parse<{ recovery: string; hadOriginal?: boolean }>(readFileSync(this.recoveryJournal, 'utf8'));
    const expected = `${this.databasePath}.before-restore`;
    if (marker.recovery !== expected || marker.hadOriginal !== false && !existsSync(expected)) fail('BACKUP_INVALID');
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${this.databasePath}${suffix}`, { force: true });
    if (marker.hadOriginal !== false) for (const suffix of ['', '-wal', '-shm']) if (existsSync(`${expected}${suffix}`)) renameSync(`${expected}${suffix}`, `${this.databasePath}${suffix}`);
    rmSync(this.recoveryJournal); syncDirectory(path.dirname(this.databasePath));
  }
  async initialize(): Promise<ServiceResult<LibrarySummary>> {
    if (this.initialized) return this.run(db => this.summary(db));
    try {
      mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
      this.recoverInterruptedRestore();
      const existed = existsSync(this.databasePath);
      this.db = this.open(); const db = this.db;
      const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
      if (version > DATABASE_SCHEMA_VERSION) fail('DATABASE_TOO_NEW');
      if (version > 0) this.checkSchema(db, true);
      if (version < DATABASE_SCHEMA_VERSION) {
        if (existed) snapshotTo(db, `${this.databasePath}.before-migration`);
        this.applyMigrations(db, version);
      }
      this.checkSchema(db);
      const sqlite = String((db.prepare('SELECT sqlite_version() AS version').get() as Row).version);
      const [major, minor, patch] = sqlite.split('.').map(Number);
      const patched = major > 3 || major === 3 && (minor > 51 || minor === 51 && patch >= 3 || minor === 50 && patch >= 7 || minor === 44 && patch >= 6);
      if (!patched) fail('SERVICE_UNAVAILABLE', { sqlite });
      this.initialized = true;
      return { ok: true, value: this.summary(db) };
    } catch (error) { this.db?.close(); this.db = null; return error instanceof RepositoryError ? resultError(error) : { ok: false, error: { code: 'MIGRATION_FAILED' } }; }
  }
  private summary(db: DatabaseSync): LibrarySummary {
    return { schemaVersion: DATABASE_SCHEMA_VERSION, recovering: false, runtime: { ...(process.versions.electron ? { electron: process.versions.electron } : {}), node: process.versions.node, sqlite: String((db.prepare('SELECT sqlite_version() AS version').get() as Row).version) }, datasets: (db.prepare('SELECT id,name_json,active_revision_id FROM datasets ORDER BY id').all() as Row[]).map(row => ({ id: String(row.id), name: parse(row.name_json), activeRevisionId: row.active_revision_id as string | null })) };
  }
  private audit(db: DatabaseSync, action: string, objectId: string, details: unknown, actor = 'local-user', operationId?: string): void {
    db.prepare('INSERT INTO audit(operation_id,action,object_id,actor,recorded_at,details_json) VALUES (?,?,?,?,?,?)').run(operationId ?? null, action, objectId, actor, now(), canonicalJson(details));
  }
  private cachedOperation<T>(db: DatabaseSync, id: string, kind: string, input: unknown): T | undefined {
    const found = db.prepare('SELECT kind,request_hash,result_json FROM operations WHERE id=?').get(id) as Row | undefined;
    if (!found) return undefined;
    if (found.kind !== kind || found.request_hash !== hash(canonicalJson(input))) fail('CONFLICT', { operationId: id });
    return parse<T>(found.result_json);
  }
  private recordOperation(db: DatabaseSync, id: string, kind: string, input: unknown, result: unknown): void {
    db.prepare('INSERT INTO operations VALUES (?,?,?,?,?)').run(id, kind, hash(canonicalJson(input)), canonicalJson(result), now());
  }
  private revisionSummary(row: Row): RevisionSummary {
    const header = parse<DataPackage>(row.header_json);
    return { datasetId: String(row.dataset_id), revisionId: String(row.id), publishedAt: String(row.published_at), contentHash: String(row.content_hash), parentRevisionId: row.parent_revision_id as string | null, notes: header.revision.notes };
  }
  async listRevisions(datasetId: string): Promise<ServiceResult<RevisionSummary[]>> { return this.run(db => (db.prepare('SELECT * FROM revisions WHERE dataset_id=? ORDER BY published_at,id').all(datasetId) as Row[]).map(row => this.revisionSummary(row))); }
  private readPackage(db: DatabaseSync, ref: DatasetRef, verifyTrees = true): DataPackage {
    const row = db.prepare('SELECT header_json,content_hash FROM revisions WHERE dataset_id=? AND id=?').get(ref.datasetId, ref.revisionId) as Row | undefined;
    if (!row) return fail('REVISION_NOT_FOUND');
    const data = parse<DataPackage>(row.header_json);
    const items = db.prepare('SELECT ro.kind,ro.object_id,ro.object_hash,o.canonical_json FROM revision_objects ro JOIN objects o ON o.hash=ro.object_hash WHERE ro.dataset_id=? AND ro.revision_id=? ORDER BY ro.kind,ro.ordinal').all(ref.datasetId, ref.revisionId) as Row[];
    for (const item of items) {
      const raw = String(item.canonical_json); if (hash(raw) !== item.object_hash) fail('BACKUP_INVALID');
      const obj = JSON.parse(raw);
      if (obj.id !== item.object_id) fail('BACKUP_INVALID');
      switch (item.kind) {
        case 'scope': data.catalog.scopes.push(obj); break;
        case 'process': data.catalog.processes.push(obj); break;
        case 'event': data.catalog.events.push(obj); break;
        case 'place': data.catalog.places.push(obj); break;
        case 'branch': data.history.branches.push(obj); break;
        case 'commit': data.history.commits.push(obj); break;
        case 'field': data.history.fields.push(obj); break;
        case 'source': data.history.sources[obj.id] = obj; break;
        case 'tag': data.history.tags!.push(obj); break;
        case 'relationship': data.history.relationships!.push(obj); break;
        default: fail('BACKUP_INVALID');
      }
    }
    if (hash(canonicalJson(data)) !== row.content_hash) fail('BACKUP_INVALID');
    if (!verifyTrees) return data;
    const trees = db.prepare('SELECT c.commit_id,c.tree_hash,o.canonical_json FROM commit_tree_index c JOIN objects o ON c.tree_hash=o.hash WHERE c.dataset_id=? AND c.revision_id=?').all(ref.datasetId, ref.revisionId) as Row[];
    const engine = createHistoryEngine(data.history);
    if (trees.length !== data.history.commits.length) fail('BACKUP_INVALID');
    for (const tree of trees) { const state = engine.snapshot(String(tree.commit_id)); if (!state.ok || hash(String(tree.canonical_json)) !== tree.tree_hash || hash(canonicalJson(snapshotTree(state.value))) !== tree.tree_hash) fail('BACKUP_INVALID'); }
    return data;
  }
  async getPublishedPackage(ref: DatasetRef): Promise<ServiceResult<DataPackage>> { return this.run(db => this.readPackage(db, ref)); }
  async activateRevision(ref: DatasetRef, operationId: string): Promise<ServiceResult<RevisionSummary>> {
    return this.run(db => this.atomic(db, () => {
      const cached = this.cachedOperation<RevisionSummary>(db, operationId, 'activate', ref); if (cached) return cached;
      const row = db.prepare('SELECT * FROM revisions WHERE dataset_id=? AND id=?').get(ref.datasetId, ref.revisionId) as Row | undefined;
      if (!row) return fail('REVISION_NOT_FOUND');
      db.prepare('UPDATE datasets SET active_revision_id=? WHERE id=?').run(ref.revisionId, ref.datasetId);
      const result = this.revisionSummary(row); this.audit(db, 'revision.activate', ref.revisionId, ref, 'local-user', operationId); this.recordOperation(db, operationId, 'activate', ref, result); return result;
    }));
  }
  private draft(row: Row): Draft { return { id: String(row.id), version: Number(row.version), package: parse(row.package_json), baseRevision: row.base_revision_id ? { datasetId: String(row.base_dataset_id), revisionId: String(row.base_revision_id) } : null, updatedAt: String(row.updated_at) }; }
  async listDrafts(datasetId?: string): Promise<ServiceResult<DraftSummary[]>> { return this.run(db => (db.prepare('SELECT * FROM drafts WHERE published_revision_id IS NULL ORDER BY updated_at,id').all() as Row[]).map(row => this.draft(row)).filter(d => !datasetId || d.package.dataset.id === datasetId).map(({ package: data, ...draft }) => ({ ...draft, datasetId: data.dataset.id, datasetName: data.dataset.name, revisionId: data.revision.id }))); }
  async createDraft(input: ServiceMethods['draft.create']['params']): Promise<ServiceResult<Draft>> {
    return this.run(db => this.atomic(db, () => {
      const cached = this.cachedOperation<Draft>(db, input.operationId, 'draft.create', input); if (cached) return cached;
      const parsed = validateDataPackage(input.package, 'shape'); if (!parsed.ok) throw new RepositoryError({ code: 'VALIDATION_FAILED', issues: parsed.issues });
      // Actual Git base revisions are resolved by the owning local service.
      if (input.baseRevision && !/^[a-f0-9]{40}$/.test(input.baseRevision.revisionId)) this.readPackage(db, input.baseRevision);
      const draft: Draft = { id: randomUUID(), version: 1, package: parsed.value, baseRevision: input.baseRevision ? { datasetId: input.baseRevision.datasetId, revisionId: input.baseRevision.revisionId } : null, updatedAt: now() };
      db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?,?,NULL)').run(draft.id, draft.version, canonicalJson(draft.package), draft.baseRevision?.datasetId ?? null, draft.baseRevision?.revisionId ?? null, draft.updatedAt);
      this.audit(db, 'draft.create', draft.id, { revisionId: draft.package.revision.id }, 'local-user', input.operationId); this.recordOperation(db, input.operationId, 'draft.create', input, draft); return draft;
    }));
  }
  async getDraft(id: string): Promise<ServiceResult<Draft>> { return this.run(db => { const row = db.prepare('SELECT * FROM drafts WHERE id=?').get(id) as Row | undefined; return row ? this.draft(row) : fail('NOT_FOUND'); }); }
  async saveDraft(input: ServiceMethods['draft.save']['params']): Promise<ServiceResult<Draft>> {
    return this.run(db => this.atomic(db, () => {
      const parsed = validateDataPackage(input.package, 'shape'); if (!parsed.ok) throw new RepositoryError({ code: 'VALIDATION_FAILED', issues: parsed.issues });
      const row = db.prepare('SELECT * FROM drafts WHERE id=?').get(input.draftId) as Row | undefined; if (!row) return fail('NOT_FOUND');
      if (row.version !== input.expectedVersion || row.published_revision_id !== null) fail('CONFLICT');
      const draft = this.draft(row); draft.package = parsed.value; draft.version++; draft.updatedAt = now();
      db.prepare('UPDATE drafts SET version=?,package_json=?,updated_at=? WHERE id=?').run(draft.version, canonicalJson(draft.package), draft.updatedAt, draft.id);
      this.audit(db, 'draft.save', draft.id, { version: draft.version }); return draft;
    }));
  }
  async publishDraft(input: Omit<ServiceMethods['draft.publish']['params'], 'expectedHead' | 'expectedModelHash'>): Promise<ServiceResult<RevisionSummary>> {
    return this.run(async db => {
      const cached = this.cachedOperation<RevisionSummary>(db, input.operationId, 'publish', input); if (cached) return cached;
      if (!input.review.evidenceReviewed || !input.review.rightsReviewed) return fail('REVIEW_REQUIRED');
      const row = db.prepare('SELECT * FROM drafts WHERE id=?').get(input.draftId) as Row | undefined; if (!row) return fail('NOT_FOUND');
      if (row.version !== input.expectedVersion || row.published_revision_id !== null) fail('CONFLICT');
      const data = parse<DataPackage>(row.package_json), parsed = validateDataPackage(data, 'publish');
      if (!parsed.ok) throw new RepositoryError({ code: 'VALIDATION_FAILED', issues: parsed.issues });
      const manifest = await buildContentManifest(data);
      return this.atomic(db, () => {
        const prior = this.cachedOperation<RevisionSummary>(db, input.operationId, 'publish', input); if (prior) return prior;
        const current = db.prepare('SELECT version,published_revision_id FROM drafts WHERE id=?').get(input.draftId) as Row | undefined;
        if (current?.version !== input.expectedVersion || current.published_revision_id !== null) fail('CONFLICT');
        if (db.prepare('SELECT 1 FROM revisions WHERE dataset_id=? AND id=?').get(data.dataset.id, data.revision.id)) fail('CONFLICT');
        if (data.revision.parentRevisionId && !db.prepare('SELECT 1 FROM revisions WHERE dataset_id=? AND id=?').get(data.dataset.id, data.revision.parentRevisionId)) fail('REVISION_NOT_FOUND');
        const header: DataPackage = { ...data, catalog: { ...data.catalog, scopes: [], processes: [], events: [], places: [] }, history: { ...data.history, branches: [], commits: [], fields: [], sources: {}, tags: [], relationships: [] } };
        db.prepare('INSERT INTO datasets(id,name_json,active_revision_id) VALUES (?,?,NULL) ON CONFLICT(id) DO NOTHING').run(data.dataset.id, canonicalJson(data.dataset.name));
        const publishedAt = now();
        db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?,?)').run(data.dataset.id, data.revision.id, data.revision.parentRevisionId, publishedAt, manifest.contentHash, canonicalJson(header), canonicalJson(input.review));
        for (const obj of manifest.objects) {
          db.prepare('INSERT INTO objects VALUES (?,?) ON CONFLICT(hash) DO NOTHING').run(obj.hash, obj.canonical);
          // Preserve each source array's order independently of canonical manifest ordering.
          const lists: Record<string, { id: string }[]> = { scope: data.catalog.scopes, process: data.catalog.processes, event: data.catalog.events, place: data.catalog.places, branch: data.history.branches, commit: data.history.commits, field: data.history.fields, source: Object.values(data.history.sources), tag: data.history.tags!, relationship: data.history.relationships! };
          const ordinal = lists[obj.kind].findIndex(x => x.id === obj.id);
          db.prepare('INSERT INTO revision_objects VALUES (?,?,?,?,?,?)').run(data.dataset.id, data.revision.id, obj.kind, obj.id, obj.hash, ordinal);
        }
        this.options.fault?.('publish:objects');
        for (const c of data.history.commits) db.prepare('INSERT INTO commit_index VALUES (?,?,?,?,?,?)').run(data.dataset.id, data.revision.id, c.id, c.branchId, c.year, c.kind!);
        for (const tree of manifest.trees) { db.prepare('INSERT INTO objects VALUES (?,?) ON CONFLICT(hash) DO NOTHING').run(tree.hash, tree.canonical); db.prepare('INSERT INTO commit_tree_index VALUES (?,?,?,?)').run(data.dataset.id, data.revision.id, tree.commitId, tree.hash); }
        for (const c of data.history.commits) {
          for (const edge of c.lineage!) db.prepare('INSERT INTO parent_index VALUES (?,?,?,?,?)').run(data.dataset.id, data.revision.id, c.id, edge.parentId, edge.kind);
          for (const [fieldId, change] of Object.entries(c.changes)) db.prepare('INSERT INTO field_change_index VALUES (?,?,?,?,?,?)').run(data.dataset.id, data.revision.id, c.id, fieldId, change?.status ?? 'absent', change?.key ?? null);
        }
        for (const b of data.history.branches) db.prepare('INSERT INTO branch_index VALUES (?,?,?,?,?,?,?)').run(data.dataset.id, data.revision.id, b.id, b.scopeId, b.processId, b.coverage[0], b.coverage[1]);
        for (const t of data.history.tags!) db.prepare('INSERT INTO tag_index VALUES (?,?,?,?)').run(data.dataset.id, data.revision.id, t.id, t.commitId);
        for (const link of data.history.relationships!) db.prepare('INSERT INTO relationship_index VALUES (?,?,?,?,?,?)').run(data.dataset.id, data.revision.id, link.id, link.kind, link.fromCommitId, link.toCommitId);
        this.options.fault?.('publish:activate');
        db.prepare('UPDATE datasets SET active_revision_id=?,name_json=? WHERE id=?').run(data.revision.id, canonicalJson(data.dataset.name), data.dataset.id);
        db.prepare('UPDATE drafts SET published_revision_id=?,version=version+1 WHERE id=?').run(data.revision.id, input.draftId);
        const result: RevisionSummary = { datasetId: data.dataset.id, revisionId: data.revision.id, publishedAt, contentHash: manifest.contentHash, parentRevisionId: data.revision.parentRevisionId, notes: data.revision.notes };
        this.audit(db, 'revision.publish', data.revision.id, { contentHash: manifest.contentHash, draftId: input.draftId, review: input.review }, input.review.reviewer, input.operationId); this.recordOperation(db, input.operationId, 'publish', input, result); return result;
      });
    });
  }
  async deleteDraft(input: ServiceMethods['draft.delete']['params']): Promise<ServiceResult<{ deleted: true }>> {
    return this.run(db => this.atomic(db, () => {
      const row = db.prepare('SELECT version,published_revision_id FROM drafts WHERE id=?').get(input.draftId) as Row | undefined;
      if (!row) return fail('NOT_FOUND');
      if (row.version !== input.expectedVersion || row.published_revision_id !== null) fail('CONFLICT');
      db.prepare('DELETE FROM drafts WHERE id=?').run(input.draftId); this.audit(db, 'draft.delete', input.draftId, { version: input.expectedVersion }); return { deleted: true as const };
    }));
  }
  async loadWorkspace(id: string): Promise<ServiceResult<WorkspaceState | null>> { return this.run(db => { const row = db.prepare('SELECT state_json FROM workspaces WHERE id=?').get(id) as Row | undefined; return row ? parse<WorkspaceState>(row.state_json) : null; }); }
  async saveWorkspace(input: ServiceMethods['workspace.save']['params'], gitModel?: DataPackage, referencePackages: DataPackage[] = []): Promise<ServiceResult<WorkspaceState>> {
    return this.run(db => this.atomic(db, () => {
      // Only the trusted service can supply Git-resolved packages; renderer params have no such field.
      const data = gitModel ?? this.readPackage(db, input.workspace.dataset), checked = validateWorkspace(input.workspace, data, referencePackages);
      if (!checked.ok) throw new RepositoryError({ code: 'VALIDATION_FAILED', issues: checked.issues });
      const row = db.prepare('SELECT version FROM workspaces WHERE id=?').get(input.workspace.id) as Row | undefined;
      if (row ? input.expectedVersion !== row.version : input.expectedVersion !== null) fail('CONFLICT');
      if (input.workspace.version !== (input.expectedVersion ?? 0)) fail('CONFLICT');
      const saved = { ...checked.value, version: Number(row?.version ?? 0) + 1 };
      db.prepare('INSERT INTO workspaces VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,dataset_id=excluded.dataset_id,revision_id=excluded.revision_id,state_json=excluded.state_json').run(saved.id, saved.version, saved.dataset.datasetId, saved.dataset.revisionId, canonicalJson(saved)); return saved;
    }));
  }
  async listSources(): Promise<ServiceResult<SourceConfiguration[]>> { return this.run(db => (db.prepare('SELECT configuration_json FROM sources ORDER BY id').all() as Row[]).map(row => parse<SourceConfiguration>(row.configuration_json))); }
  async saveSource(source: SourceConfiguration): Promise<ServiceResult<SourceConfiguration>> { return this.run(db => this.atomic(db, () => { db.prepare('INSERT INTO sources VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET configuration_json=excluded.configuration_json,updated_at=excluded.updated_at').run(source.id, canonicalJson(source), now()); this.audit(db, 'source.configure', source.id, { adapter: source.adapter, enabled: source.enabled }); return structuredClone(source); })); }
  async saveImport(preview: ImportPreview, operation?: { id: string; method: string; input: unknown }): Promise<ServiceResult<ImportPreview>> {
    return this.run(db => this.atomic(db, () => {
      if (operation) { const prior = this.cachedOperation<ImportPreview>(db, operation.id, operation.method, operation.input); if (prior) return prior; }
      const existing = db.prepare('SELECT input_hash,preview_json FROM imports WHERE id=?').get(preview.importId) as Row | undefined;
      if (existing && (existing.input_hash !== preview.inputHash || existing.preview_json !== canonicalJson(preview))) fail('CONFLICT');
      if (!existing) db.prepare('INSERT INTO imports VALUES (?,?,?,?)').run(preview.importId, preview.inputHash, canonicalJson(preview), now());
      if (operation) this.recordOperation(db, operation.id, operation.method, operation.input, preview);
      return structuredClone(preview);
    }));
  }
  async getImport(id: string): Promise<ServiceResult<ImportPreview>> { return this.run(db => { const row = db.prepare('SELECT preview_json FROM imports WHERE id=?').get(id) as Row | undefined; return row ? parse(row.preview_json) : fail('NOT_FOUND'); }); }
  async getOperation<T>(id: string, kind: string, input: unknown): Promise<ServiceResult<T | null>> { return this.run(db => this.cachedOperation<T>(db, id, kind, input) ?? null); }
  async completeOperation<T>(id: string, kind: string, input: unknown, value: T): Promise<ServiceResult<T>> { return this.run(db => this.atomic(db, () => { const prior = this.cachedOperation<T>(db, id, kind, input); if (prior !== undefined) return prior; this.recordOperation(db, id, kind, input, value); this.audit(db, kind, id, { completed: true }, 'local-user', id); return value; })); }
  /** Read completed fact-adoption receipts only; navigation never extends or rewrites them. */
  async knowledgeImportOperations(): Promise<ServiceResult<{ operationId: string; method: string; result: unknown }[]>> {
    return this.run(db => (db.prepare("SELECT id,kind,result_json FROM operations WHERE kind IN ('knowledge.fileAdopt','knowledge.adoptJob','collection.adopt','wikipedia.adopt') ORDER BY id").all() as Row[]).map(row => ({operationId:String(row.id),method:String(row.kind),result:parse(row.result_json)})));
  }
  private async verifyBackup(file: string, allowLegacy = false, resolvePackage?: BackupPackageResolver): Promise<void> {
    if (!existsSync(file) || statSync(file).size > 512 * 1024 * 1024) fail('BACKUP_INVALID');
    const check = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    try {
      const schema = this.checkSchema(check, allowLegacy);
      const integrity = check.prepare('PRAGMA quick_check').all() as Row[];
      if (integrity.length !== 1 || integrity[0].quick_check !== 'ok' || check.prepare('PRAGMA foreign_key_check').all().length) fail('BACKUP_INVALID');
      for (const row of check.prepare('SELECT dataset_id,id FROM revisions').all() as Row[]) {
        const data = this.readPackage(check, { datasetId: String(row.dataset_id), revisionId: String(row.id) }, schema.hasTrees);
        if (!validateDataPackage(data, 'publish').ok) fail('BACKUP_INVALID');
      }
      for (const row of check.prepare('SELECT state_json FROM workspaces').all() as Row[]) {
        const state = parse<WorkspaceState>(row.state_json);
        if (!validateWorkspace(state).ok) fail('BACKUP_INVALID');
        const refs = [state.head, ...(state.comparison ?? [])].filter(value => value !== null);
        if (refs.some(value => value.revisionId === 'working')) fail('BACKUP_INVALID');
        const read = (reference: DatasetRef) => resolvePackage && (reference.revisionId === 'working' || /^[a-f0-9]{40}$/.test(reference.revisionId))
          ? resolvePackage(reference) : Promise.resolve(this.readPackage(check, reference, schema.hasTrees));
        const data = await read(state.dataset), referenced: DataPackage[] = [];
        for (const revisionId of new Set(refs.map(value => value.revisionId))) if (revisionId !== state.dataset.revisionId) referenced.push(await read({ datasetId: state.dataset.datasetId, revisionId }));
        if (!validateWorkspace(state, data, referenced).ok) fail('BACKUP_INVALID');
      }
      for (const row of check.prepare('SELECT package_json FROM drafts').all() as Row[]) if (!validateDataPackage(parse(row.package_json), 'shape').ok) fail('BACKUP_INVALID');
      for (const row of check.prepare('SELECT id,active_revision_id FROM datasets').all() as Row[]) if (row.active_revision_id && !check.prepare('SELECT 1 FROM revisions WHERE dataset_id=? AND id=?').get(row.id, row.active_revision_id)) fail('BACKUP_INVALID');
    } finally { check.close(); }
  }
  async validateBackup(sourcePath: string, resolvePackage?: BackupPackageResolver): Promise<ServiceResult<void>> {
    try { await this.verifyBackup(sourcePath, true, resolvePackage); return { ok: true, value: undefined }; }
    catch (error) { return resultError(error); }
  }
  async backup(destinationPath: string, resolvePackage?: BackupPackageResolver): Promise<ServiceResult<BackupReceipt>> {
    let temporary: string | undefined;
    let acquiredMaintenance = false;
    try {
      const db = this.connection(), destination = path.join(realpathSync(path.dirname(path.resolve(destinationPath))), path.basename(destinationPath));
      const liveDatabase = path.join(realpathSync(path.dirname(this.databasePath)), path.basename(this.databasePath));
      if (destination.startsWith(liveDatabase) || destination === path.join(path.dirname(liveDatabase), path.basename(this.recoveryJournal))) fail('BACKUP_INVALID');
      this.maintenance = true; acquiredMaintenance = true;
      temporary = `${destination}.${randomUUID()}.tmp`;
      snapshotTo(db, temporary); await this.verifyBackup(temporary, false, resolvePackage); syncFile(temporary);
      const digest = hash(readFileSync(temporary));
      renameSync(temporary, destination); syncDirectory(path.dirname(destination));
      return { ok: true, value: { id: randomUUID(), createdAt: now(), contentHash: digest, schemaVersion: DATABASE_SCHEMA_VERSION } };
    } catch (error) { if (temporary) rmSync(temporary, { force: true }); return resultError(error); }
    finally { if (acquiredMaintenance) this.maintenance = false; }
  }
  async restore(sourcePath: string, operation?: { id: string; input: unknown }): Promise<ServiceResult<LibrarySummary>> {
    let staged: string | undefined;
    let acquiredMaintenance = false;
    const recovery = `${this.databasePath}.before-restore`;
    try {
      if (this.maintenance) fail('OPERATION_IN_PROGRESS');
      const db = this.initialized ? this.connection() : null;
      if (operation && db) { const previous = this.cachedOperation<LibrarySummary>(db, operation.id, 'backup.restore', operation.input); if (previous) return { ok: true, value: previous }; }
      this.maintenance = true; acquiredMaintenance = true;
      const liveDatabase = path.join(realpathSync(path.dirname(this.databasePath)), path.basename(this.databasePath));
      if (realpathSync(sourcePath).startsWith(liveDatabase)) fail('BACKUP_INVALID');
      await this.verifyBackup(sourcePath, true);
      staged = `${this.databasePath}.${randomUUID()}.restore`;
      const source = new DatabaseSync(sourcePath, { readOnly: true, allowExtension: false });
      try { snapshotTo(source, staged); } finally { source.close(); }
      const stagedDatabase = new DatabaseSync(staged, { allowExtension: false });
      try { const schema = this.checkSchema(stagedDatabase, true); if (schema.version < DATABASE_SCHEMA_VERSION) { stagedDatabase.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;'); this.applyMigrations(stagedDatabase, schema.version); } }
      finally { stagedDatabase.close(); }
      await this.verifyBackup(staged); syncFile(staged);
      const hadOriginal = existsSync(this.databasePath);
      for (const suffix of ['-wal', '-shm']) rmSync(`${recovery}${suffix}`, { force: true });
      if (db) snapshotTo(db, recovery);
      else if (hadOriginal) for (const suffix of ['', '-wal', '-shm']) if (existsSync(`${this.databasePath}${suffix}`)) { copyFileSync(`${this.databasePath}${suffix}`, `${recovery}${suffix}`); syncFile(`${recovery}${suffix}`); }
      if (hadOriginal) syncFile(recovery);
      writeFileSync(this.recoveryJournal, JSON.stringify({ recovery, hadOriginal }), { mode: 0o600 }); syncFile(this.recoveryJournal); syncDirectory(path.dirname(this.databasePath));
      db?.close(); this.db = null;
      for (const suffix of ['-wal', '-shm']) rmSync(`${this.databasePath}${suffix}`, { force: true });
      renameSync(staged, this.databasePath); this.options.fault?.('restore:installed');
      this.db = this.open(); this.checkSchema(this.db); this.initialized = true;
      const restored = this.summary(this.db);
      if (operation) this.atomic(this.db, () => { this.recordOperation(this.db!, operation.id, 'backup.restore', operation.input, restored); this.audit(this.db!, 'backup.restore', operation.id, { completed: true }, 'local-user', operation.id); });
      rmSync(this.recoveryJournal); syncDirectory(path.dirname(this.databasePath));
      return { ok: true, value: restored };
    } catch (error) {
      if (acquiredMaintenance && existsSync(this.recoveryJournal)) {
        this.db?.close(); this.db = null;
        try { this.recoverInterruptedRestore(); this.db = this.open(); this.checkSchema(this.db); this.initialized = true; } catch { this.db?.close(); this.db = null; this.initialized = false; }
      }
      if (staged) rmSync(staged, { force: true });
      return error instanceof RepositoryError ? resultError(error) : { ok: false, error: { code: 'BACKUP_INVALID' } };
    } finally { if (acquiredMaintenance) this.maintenance = false; }
  }
  async close(): Promise<void> { this.db?.close(); this.db = null; this.initialized = false; }
}

export const createSqliteRepository = (options: RepositoryOptions): SqliteHistoryRepository => new SqliteHistoryRepository(options);
export { DATABASE_SCHEMA_VERSION };
