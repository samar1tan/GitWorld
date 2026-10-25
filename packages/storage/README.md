# Local SQLite repository

`@gitworld/storage` implements the shared `HistoryRepository` contract with
`node:sqlite`. It belongs in the Electron utility process, never the renderer.

```ts
const repository = createSqliteRepository({ dataDirectory });
const status = await repository.initialize();
// Handle structured failures before issuing normal repository operations.
await repository.close();
```

The host supplies an absolute application data directory. The repository creates
`library.sqlite`, enables foreign keys and WAL with full synchronous durability,
and verifies migration checksums. A failed or newer schema is reported rather
than replaced with an empty library. SQLite must contain the upstream WAL-reset
fix; the packaged Electron runtime is tested separately from development Node.

## Records and publication

Published revisions contain immutable, SHA-256 addressed historical and catalog
objects. Relational indexes record parents, branches, field changes, tags and
cross-links. Each historical version also has a tree hash produced by replaying
parent inheritance and explicit changes. Reads verify object, package and replay
tree hashes. An editorial revision date is independent of historical dating.

Drafts may contain graph problems while editors repair them, but must satisfy the
safe package shape. Publication checks the full graph, source rights metadata,
claim evidence and the supplied review decision. These checks enforce recorded
policy; they do not certify historical truth or grant legal rights.

One transaction writes a publication's objects, indexes, review, active pointer,
draft marker, audit record and idempotency receipt. Existing revisions and their
sources remain immutable. Workspace references include dataset and revision IDs;
changing the active release does not silently move a saved workspace. Draft and
workspace writes use explicit optimistic concurrency versions.

## Backup and recovery

The legacy SQLite repository backup interface uses `VACUUM INTO` to make a consistent standalone snapshot of a WAL
database, then verify it before replacing the selected destination. Copying an
open database file alone is not a supported backup procedure.

Restore verifies the candidate's schema, checksums, foreign keys, packages,
replayed trees, workspaces and drafts before replacement. It writes a recovery
snapshot and durable journal, swaps the database, then records the restore
operation in the restored database. Repeating that operation ID returns its
original result instead of overwriting later changes. A different request using
the same ID is rejected. Startup recovers interrupted replacement from the
journal. A failed initialization can still be repaired by restoring a valid
backup; the unavailable original is preserved as a recovery copy.

Only the operation that acquired the maintenance lock may release it. Requests
that arrive during maintenance fail with `OPERATION_IN_PROGRESS`; service writes
are additionally serialized. Recovery copies are retained locally and are not
part of the source repository.

That SQLite-only backup contains the database, including import previews and source metadata.
Raw network responses and manifests in the separate `quarantine` directory are
not included; preserve that directory separately when moving acquisition evidence.
Published historical records do not depend on those cache files for replay.

The application's full library backup is a separate archive operation: it also
includes Git history, index and Working files, operation receipts, acquired
source archives and research/navigation records. Its candidate validation and
directory exchange cover the complete library; a SQLite-only restore cannot
replace a Git-backed library. See [the full backup contract](../../docs/library-backup.md).

## Verification

The storage tests exercise real SQLite files, concurrent edits, transactional
fault injection, immutable revision replay, backup equality, invalid backups,
migration rollback, and child processes terminated during publication and
restore. Test fixtures are synthetic. Run through the root test command, or:

```sh
node --test --test-timeout=15000 packages/storage/src/storage.test.ts
```

The current database schema is version 3. Migration 1 is frozen at its original
checksum. Migration 2 builds and backfills the tree index from verified immutable
objects in one transaction, after a consistent `.before-migration` backup. It
preserves draft versions, workspace references, publications and source records.
The earlier development schema that added trees while still reporting version 1
has one explicit compatibility entry; both its exact checksum and complete DDL
must match. Arbitrary checksum or DDL differences are rejected. The original
migration receipt is retained, and version 2 receives its own receipt.

Migration 3 preserves workspace rows while removing their foreign key to the
legacy SQL revisions table. The service validates a workspace's actual Git model
revision or Working model and its references; the migration does not insert a
synthetic SQL release or rebind an older fixed workspace to current HEAD.

Known version 1 backups can also be restored: the service verifies the source,
upgrades a temporary copy, then verifies that copy before replacing the current
library. The supplied backup is never migrated in place. Future changes require
a new migration; changing an old checksum is not an upgrade procedure.
