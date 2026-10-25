import { createHash } from 'node:crypto';

export const DATABASE_SCHEMA_VERSION = 3;
const VERSION_ONE_SQL = `
CREATE TABLE datasets (id TEXT PRIMARY KEY, name_json TEXT NOT NULL, active_revision_id TEXT);
CREATE TABLE revisions (dataset_id TEXT NOT NULL REFERENCES datasets(id), id TEXT NOT NULL, parent_revision_id TEXT, published_at TEXT NOT NULL, content_hash TEXT NOT NULL, header_json TEXT NOT NULL, review_json TEXT NOT NULL, PRIMARY KEY(dataset_id,id));
CREATE TABLE objects (hash TEXT PRIMARY KEY, canonical_json TEXT NOT NULL);
CREATE TABLE revision_objects (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, kind TEXT NOT NULL, object_id TEXT NOT NULL, object_hash TEXT NOT NULL REFERENCES objects(hash), ordinal INTEGER NOT NULL, PRIMARY KEY(dataset_id,revision_id,kind,object_id), FOREIGN KEY(dataset_id,revision_id) REFERENCES revisions(dataset_id,id));
CREATE TABLE commit_index (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, commit_id TEXT NOT NULL, branch_id TEXT NOT NULL, historical_year INTEGER NOT NULL CHECK(historical_year<>0), kind TEXT NOT NULL, PRIMARY KEY(dataset_id,revision_id,commit_id), FOREIGN KEY(dataset_id,revision_id) REFERENCES revisions(dataset_id,id));
CREATE TABLE parent_index (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, child_id TEXT NOT NULL, parent_id TEXT NOT NULL, relation_kind TEXT NOT NULL, PRIMARY KEY(dataset_id,revision_id,child_id,parent_id), FOREIGN KEY(dataset_id,revision_id,child_id) REFERENCES commit_index(dataset_id,revision_id,commit_id), FOREIGN KEY(dataset_id,revision_id,parent_id) REFERENCES commit_index(dataset_id,revision_id,commit_id));
CREATE TABLE branch_index (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, branch_id TEXT NOT NULL, scope_id TEXT NOT NULL, process_id TEXT NOT NULL, coverage_start INTEGER NOT NULL, coverage_end INTEGER NOT NULL, PRIMARY KEY(dataset_id,revision_id,branch_id), FOREIGN KEY(dataset_id,revision_id) REFERENCES revisions(dataset_id,id));
CREATE TABLE field_change_index (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, commit_id TEXT NOT NULL, field_id TEXT NOT NULL, knowledge_status TEXT NOT NULL CHECK(knowledge_status IN ('known','unknown','not-applicable','absent')), value_key TEXT, PRIMARY KEY(dataset_id,revision_id,commit_id,field_id), FOREIGN KEY(dataset_id,revision_id,commit_id) REFERENCES commit_index(dataset_id,revision_id,commit_id));
CREATE TABLE tag_index (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, tag_id TEXT NOT NULL, commit_id TEXT NOT NULL, PRIMARY KEY(dataset_id,revision_id,tag_id), FOREIGN KEY(dataset_id,revision_id,commit_id) REFERENCES commit_index(dataset_id,revision_id,commit_id));
CREATE TABLE relationship_index (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, relationship_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('influence','contact')), from_commit_id TEXT NOT NULL, to_commit_id TEXT NOT NULL, PRIMARY KEY(dataset_id,revision_id,relationship_id), FOREIGN KEY(dataset_id,revision_id,from_commit_id) REFERENCES commit_index(dataset_id,revision_id,commit_id), FOREIGN KEY(dataset_id,revision_id,to_commit_id) REFERENCES commit_index(dataset_id,revision_id,commit_id));
CREATE TABLE drafts (id TEXT PRIMARY KEY, version INTEGER NOT NULL, package_json TEXT NOT NULL, base_dataset_id TEXT, base_revision_id TEXT, updated_at TEXT NOT NULL, published_revision_id TEXT);
CREATE TABLE workspaces (id TEXT PRIMARY KEY, version INTEGER NOT NULL, dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, state_json TEXT NOT NULL, FOREIGN KEY(dataset_id,revision_id) REFERENCES revisions(dataset_id,id));
CREATE TABLE sources (id TEXT PRIMARY KEY, configuration_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL, completed_at TEXT NOT NULL);
CREATE TABLE audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT, action TEXT NOT NULL, object_id TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TEXT NOT NULL, details_json TEXT NOT NULL);
CREATE TABLE imports (id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, preview_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX commits_by_branch_date ON commit_index(dataset_id,revision_id,branch_id,historical_year);
CREATE INDEX revision_objects_by_hash ON revision_objects(object_hash);
CREATE TRIGGER objects_no_update BEFORE UPDATE ON objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OBJECT'); END;
CREATE TRIGGER objects_no_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OBJECT'); END;
CREATE TRIGGER revisions_no_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVISION'); END;
CREATE TRIGGER revisions_no_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVISION'); END;
CREATE TRIGGER revision_objects_no_update BEFORE UPDATE ON revision_objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVISION'); END;
CREATE TRIGGER revision_objects_no_delete BEFORE DELETE ON revision_objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVISION'); END;
`;
const TREE_INDEX_SQL = 'CREATE TABLE commit_tree_index (dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, commit_id TEXT NOT NULL, tree_hash TEXT NOT NULL REFERENCES objects(hash), PRIMARY KEY(dataset_id,revision_id,commit_id), FOREIGN KEY(dataset_id,revision_id,commit_id) REFERENCES commit_index(dataset_id,revision_id,commit_id));';
const digest = (sql: string) => createHash('sha256').update(sql).digest('hex');

export const MIGRATIONS = [
  { version: 1, sql: VERSION_ONE_SQL },
  // The application backfills this derived index from verified immutable records
  // inside the same transaction, before recording migration 2 as complete.
  { version: 2, sql: `${TREE_INDEX_SQL.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')}\n` },
  // Workspace refs can now name actual Git OIDs or Working. The owning service
  // validates those models and fixed refs; no synthetic SQL revision is inserted.
  { version: 3, sql: `ALTER TABLE workspaces RENAME TO legacy_workspaces;
CREATE TABLE workspaces (id TEXT PRIMARY KEY, version INTEGER NOT NULL, dataset_id TEXT NOT NULL, revision_id TEXT NOT NULL, state_json TEXT NOT NULL);
INSERT INTO workspaces SELECT * FROM legacy_workspaces ORDER BY rowid;
DROP TABLE legacy_workspaces;
` },
].map(migration => ({ ...migration, checksum: digest(migration.sql) }));

/** Exact pre-release schemas that reached local profiles; never a checksum bypass. */
export const VERSION_ONE_VARIANTS = [
  { sql: VERSION_ONE_SQL, hasTrees: false },
  { sql: VERSION_ONE_SQL.replace('CREATE TABLE parent_index', `${TREE_INDEX_SQL}\nCREATE TABLE parent_index`), hasTrees: true },
].map(variant => ({ ...variant, checksum: digest(variant.sql) }));

export const MIGRATION_TABLE_SQL = 'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)';
