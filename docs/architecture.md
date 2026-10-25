# GitWorld desktop architecture

Status: local implementation, 2026-10-25. Target: macOS desktop v0.1, with Windows and Linux later. Engineering checks and installed acceptance remain separate; this document is not a release receipt. [ADR 0001](adr/0001-desktop-local-data.md) establishes the desktop boundary; [ADR 0002](adr/0002-bundled-git-data-revisions.md) supersedes its SQLite-only content and publication design.

The [data-workspace requirements](data-workspace-prd.md) define frozen staging, one repository HEAD, durable source jobs and unified contribution flows. The implementation includes a bundled standard Git data repository, source-to-assertion mapping, automatic state observations, query-driven object views and research records. Git owns authored data trees, index and refs; SQLite retains drafts, legacy packages, workspace metadata, caches and operation coordination. These stores do not share an atomic transaction. Historical states and their fixed references remain distinct from modern repository revisions.

## Application boundary

GitWorld is a local history workbench. A user acquires and reviews material, adopts or corrects working records, explores states and evidence, and freezes contributions through Changes. Graphical controls and bounded commands use the same services. Existing local material remains useful offline. This is an editorial workflow on the user's machine, not a multi-user server or an authorization system between mutually untrusted local users.

Use Electron with TypeScript, the existing web renderer, a local TypeScript application service, SQLite and the bundled Git runtime. No database server, browser extension, separately installed Git, compiler or developer runtime should be required on an end user's machine. The installer includes reviewed starter data as ordinary resources. Historical records are not compiled into renderer JavaScript. See [ADR 0002](adr/0002-bundled-git-data-revisions.md) for the updated storage and packaging boundary.

The archived browser prototype established replay, snapshots, comparison, explicit absence, reference resolution and structured command effects. Its fixed samples and time bounds do not limit the desktop. The active implementation shares domain semantics and reads ordinary data resources and Git content; adding model or object coverage does not require compiling historical records into renderer code.

## Processes and responsibilities

| Component | Owns | Must not own |
| --- | --- | --- |
| Sandboxed renderer | Workbench, data-management screens, localized copy, transient selection, accessible interactions | Node access, SQL, arbitrary file access, network ingestion, source credentials |
| Narrow preload bridge | Explicit typed request methods and progress subscriptions | Generic IPC forwarding, `eval`, shell execution, arbitrary channels or paths |
| Electron main process | Window lifecycle, sender validation, native file dialogs, external-link policy, service supervision | Long parsing jobs, graph replay loops, database business rules |
| Local data service in `utilityProcess` | Repository, migrations, queries, imports, validation, editorial workflow, publication, backup/restore | UI strings or browser navigation |
| Pure domain package | Historical model, validation, command parsing, resolution, replay, Diff and provenance | Electron, DOM, SQLite, filesystem, network |

Electron's utility process supplies Node.js and message ports, so the service can remain TypeScript without an HTTP listener. The main process brokers requests from the allowed application origin to this service. A future web deployment can add an HTTP adapter to the same service contract; v0.1 does not need a dormant server. [Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)

Keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` explicit. Use a packaged application origin with a restrictive CSP; deny unsolicited navigation, new windows, permissions, and embedded remote pages. Validate the sender and payload for every privileged request. External citations open only through an allowed `https:` link method. Source HTML is inert input, never application markup. A sandboxed preload should be bundled as CommonJS; disabling the sandbox to accommodate ESM imports is not acceptable. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [preload module constraints](https://www.electronjs.org/docs/latest/tutorial/esm)

## Service contract and workspace state

Use versioned request and response envelopes containing a request ID, protocol version, method and typed parameters. Historical requests identify their model or object and requested data revision explicitly. Validate them at runtime, independently of TypeScript. Return typed results or structured error codes, parameters and validation issues; locale resources render the message. No business logic may branch on formatted command output.

The command boundary accepts typed intents and explicit context. Terminal input is parsed to the same intent that GUI controls submit. `git` operates on the modern repository, `history --model` or `history --object` names a historical target and data revision, and `scope` organizes browsing metadata. Fixed-OID reads use the named tree; Working reads use validated snapshots and must not publish partial classification statistics. Caches distinguish revision and content fingerprint, not merely a bare historical branch or record ID.

Workspace state records:

- The modern repository HEAD, an actual Git commit OID, independently of the browsing query revision.
- Browsing scope and query revision (`working` or a fixed OID), selected object, time window, unapplied year input, viewport and return context.
- A historical checkout as either an object ID/year/OID/review policy or a model ID/historical ref/OID.
- Each fixed comparison endpoint with its own qualified target and OID; A and B may come from different data revisions.

Historical show and log leave checkout and repository HEAD unchanged. Historical checkout changes the checked historical reference while retaining fixed comparison endpoints; it never switches the repository. Historical Diff changes the comparison without checking out either side. Repository `git switch` and `git checkout --detach` are explicit modern revision operations. Back navigation changes browsing context without rewriting checkout or A/B. Working content can be previewed but cannot masquerade as a fixed historical reference. Errors apply no effects. After every asynchronous read or navigation step, discard responses superseded by a newer user interaction or revision.

Persist workspace and recoverable input through versioned, compare-and-swap saves. Serialize command submissions and guard response generations so delayed results cannot overwrite a newer investigation. The service validates each saved model or object reference against its own actual tree, including historical refs and comparison endpoints. A failed save remains visible and retryable. Reload restores the recorded sources and exact refs; missing data must not silently resolve the same names against the newest HEAD. Contributor identity, learning preferences and locale use the separate backed-up settings profile.

A new data commit does not rewrite fixed historical checkout or A/B. Working browsing can follow current content; switching its data source is explicit and cannot rebind saved endpoints. Links and shared exports retain qualified revision identity; local absolute paths and imported source bodies do not belong in shared links.

## Persistent model

The [data model](data-model.md) separates source snapshots, stable objects, assertions, state projections, historical continuity and query views. Source adapters produce evidence-bearing assertions and observations. They do not create an artificial historical branch or event for each modern import. Authored model packages retain the earlier engine's explicit parent/influence semantics alongside the object/assertion model.

The application-owned Git repository is authoritative for current objects/assertions, sources, model packages, mapping/vocabulary baselines, research records and navigation metadata. Model catalog/read resolves `models/<dataset-identity-hash>.json` from Working or an actual Git OID; an embedded authored revision ID or older SQL release is not a substitute for that OID. SQL may hold drafts, compatibility releases, query caches, workspace/client state and durable operation receipts. New content enters Working, the index freezes selected bytes, and a commit records that frozen tree.

SQLite connections remain service-owned, with short transactions, bounded busy timeouts and explicit durability settings. The implementation uses the `node:sqlite` API supplied by the pinned Electron utility runtime, which must be exercised in the packaged application rather than inferred from the developer's system Node. Release checks record Electron, Node and `SELECT sqlite_version()`. Live library files stay on a local filesystem under the user-data directory, outside the application bundle; they should not be opened from a network or synchronized folder.

WAL is appropriate for local reading while imports are staged, but it does not make multiple writers or cross-database commits atomic. Require a SQLite build containing the WAL-reset fix: 3.51.3 or later, or a specifically verified patched release. Checkpoints remain service-owned. Do not copy only the main database file while it is open in WAL mode. [SQLite WAL behavior and fix](https://www.sqlite.org/wal.html)

The logical records below span validated Git JSON, compatible model packages and operational SQL stores. Tree validation enforces content identity and references; each journal enforces its own schema and transitions. Git ref updates, filesystem writes and SQLite commits are coordinated through CAS guards and durable prepared/completed receipts, not a cross-store transaction.

| Entity | Required information |
| --- | --- |
| Model package | Stable dataset ID, description, license manifest and authored revision metadata; containing Git revision remains explicit |
| Editorial revision | Actual commit OID, parent OIDs, frozen tree, contributor identity, modern timestamp and reason |
| Scope and process | Stable IDs, hierarchy, labels, descriptions, temporal coverage, geography/view hints, supported themes |
| Branch | Stable ID, scope/process references, recorded coverage, topology metadata |
| Historical commit in model content | Stable ID within its model, historical date, kind, parent refs, narrative and field changes |
| Field definition | Stable semantic path, type, comparison semantics, group, localized label |
| Field assertion/change | Stable value key, value, knowledge status, evidence links, modeling note, temporal precision |
| Relationship | Typed lineage or influence/contact link, endpoint refs, optional field and evidence refs |
| Source and claim evidence | Original title/language, URL or identifier, locator, retrieved revision/time, rights metadata, supported assertion |
| Translation | Object/field ID, locale, text, original language, translation provenance |
| Import and review | Input digest, adapter/version, transformations, validation findings, review state and decisions |
| Research record | Interpretation, query scope and evidence/comparison targets with their own model/object IDs and OIDs |
| Navigation context | Versioned definition and explicit membership basis, separate from historical assertions and dates |
| Workspace | Qualified sources/fixed references and versioned exploration/recoverable input state |

Fixed graph and object references are qualified by their data revision and validated target, rather than only a bare ref or year. A committed tree is immutable; a correction becomes a Working change that can be staged and committed as another revision. Historical identity and dates are not migration IDs or modern commit timestamps. `francia/west@850` is an as-of query inside a named model and Git revision, not a software release name.

The import format carries scopes, processes, places, branches, fields, commits, relationships, sources, translations, and default navigation metadata. It must be possible to add a new region, branch, and historical record through data management without editing TypeScript or rebuilding the application. New field kinds or genuinely new visualization algorithms can require a schema/application upgrade. Arbitrary JavaScript plugins or expressions are not part of data configuration.

## Historical semantics that survive storage

- Historical dates use an explicit signed-year convention and precision metadata, independent of Unix timestamps. State clearly how BCE years are encoded; prohibit an accidental year zero in the user-facing calendar. A year-level record must not acquire invented day precision during import.
- As-of lookup remains bounded by declared coverage. Echo the requested date and the actual record date. Sparse records do not establish that every inherited assertion remained true at every intermediate instant.
- Unknown, never recorded, known value, and explicitly absent are distinct. An absence needs evidence and provenance; missing data cannot become a historical addition or removal in Diff.
- Baseline observations are distinguishable from recorded changes. Blame identifies the last recorded assertion and its source, not necessarily a historical invention or origin.
- Parent edges express modeled continuity and integration. Influence/contact edges do not inherit whole states. Multi-parent conflicts need an explicit resolution and provenance; input order must not choose a winner.
- Comparison uses stable semantic values. Translated prose and formatting do not change equality. A shared field path enables comparison but does not establish that two societies used equivalent institutions; field definitions and modeling notes carry that limitation.

English is primary for curated historical content, with complete English and Simplified Chinese presentation for product-authored installed content. Arbitrary imported material retains its original language and an explicit English fallback where available; UI locale support does not invent a translation. Both interface locales remain complete, and translations stay separate from graph identity.

## Acquisition, review, and publication

Acquisition, validation, review, adoption/correction and Changes form one workbench. Unreviewed or unresolved material retains its status; parsing or local adoption does not approve a historical claim or its redistribution rights. The older SQLite draft/release API remains a compatibility path, not the current Git commit mechanism.

Use this lifecycle:

1. **Register the source.** Record the source's original metadata, acquisition method, rights basis, attribution requirements, allowed retention/export, and the evidence for those decisions. A source being readable on the web is not a redistribution license.
2. **Acquire into quarantine.** Prefer documented APIs, permitted downloads, or user-selected local files. Apply source-specific terms, rate limits, size limits, timeouts, and identifiable requests. Refuse executable imports and arbitrary remote URLs that can access local/private services. Keep credentials outside dataset exports.
3. **Prepare an inspectable preview.** Preserve the input digest, source revision, mapping/profile version and transformation log. Import documented declarative schemas, never SQL, scripts or executable templates. A changed input requires another preview. Model-package import can create an editable SQL draft; accepting that draft alone does not write an unvalidated package into Git.
4. **Validate and review.** Check schema, identities/references, graph cycles, coverage, date order, conflicts, value types, evidence and rights. Show proposed changes against the reviewed Working baseline. Record editorial and rights decisions separately; a successful schema check is not historical review.
5. **Adopt into Working.** Guard HEAD and exact affected file hashes. Model publication, manual edits and paired imports persist prepared/completed receipts around their validated writes; older collection routes retain their existing baseline/CAS retry behavior. The compatibility-named model `draft.publish` writes a valid package to the Git working tree; it neither stages nor advances HEAD. Reconcile uncertain writes through their original operation rather than overwriting later edits. Paired vocabulary imports and context classification retain their own immutable preview/plan and recovery boundaries.
6. **Stage and commit.** Resolve supporting dependencies, freeze selected bytes in the real Git index, validate that frozen tree, and create a modern editorial commit. If B is staged and C is edited afterward, commit records B and retains C working. Durable commit receipts recover the actual OID after interruption; SQLite does not atomically own the Git ref update.

Acquisition permission, local retention and redistribution are separate decisions. Shared data exports and releases require approved payloads and notices; a private complete-library backup also contains raw acquisition and user work, so it is not a publication artifact. Unknown rights remain unknown after local adoption or restore. For example, Wikidata distinguishes CC0 structured data from text in other namespaces; a blanket “Wikimedia content is CC0” rule would be wrong. Citation metadata can be stored without redistributing entire source articles. [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)

Starter content receives the same review as imported content. Existing prototype citations are evidence leads, not blanket authorization to copy source bodies. The supplied external assessment is useful research input, but its market-exclusivity claims and technical assertions are not a publication authority. The application must not label an import “verified” solely because an automated process generated it.

## Migrations, backup, and recovery

The legacy `library.sqlite` schema is version 3. The original version 1 migration is
frozen; version 2 backfills replayed tree hashes without rewriting historical
records, draft versions or workspaces. The one early version 1 development variant
with an existing tree index is accepted only when both its recorded checksum and
full DDL match the known variant. All other mismatches fail closed. Existing
profiles receive a consistent pre-migration backup and a transactional upgrade.
Legacy backups are upgraded only in a temporary restore copy, leaving the selected
source file untouched. Version 3 preserves workspace rows while removing their
foreign key to legacy SQL revisions. The service validates actual Git model
revisions or Working models and their references; migration does not invent a
SQL release or rebind fixed workspaces to current HEAD.

Maintain ordered, application-owned migrations with immutable IDs and checksums. Back up before an upgrade, then apply each supported migration transactionally. Reject an unexpected migration checksum or a database newer than the application supports. Never downgrade a database in place. On failure, retain the original and expose recovery/export; do not silently create an empty replacement.

The current [complete-library backup](library-backup.md) is a `.gitworld` container. It retains the repository's committed, staged and working content, models/research/navigation/vocabulary, all operational SQLite stores and receipts, settings/client recovery, and local source archives, raw responses and acquisition checkpoints. Raw material remains acquisition evidence rather than a substitute for an adopted object. Application binaries and the bundled Git executable remain installation resources, not library contents. Older `.sqlite` files contain only the legacy store and cannot silently replace a Git-backed library.

Backup drains admitted work under a maintenance barrier and requires active acquisition to finish or cancel. It snapshots SQLite with `VACUUM INTO`, including committed WAL data, rather than copying a live primary database alone. Other library files are copied into a private snapshot; a versioned manifest records every file's size/hash before the compressed container is installed at the chosen destination. A failed creation preserves the previous destination. SQLite snapshots are one part of this whole-library operation, not the complete backup format. [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)

Restore validates the complete candidate before replacing the library: paths/hashes, SQLite schemas and integrity, existing Git HEAD, model/object references, exact workspace OIDs, vocabulary and pending navigation/import state. It never repairs a candidate's missing HEAD by creating a commit. After validation, close stores, exchange whole directories, reopen and verify; a durable journal rolls back an unfinished exchange and preserves recovery directories. Frozen B and later Working C remain distinct. A compatible legacy schema is migrated only in the temporary candidate, leaving the selected backup file untouched. A corrupt or incompatible candidate does not replace healthy local data.

On utility-process failure, retain the last rendered results and report a recoverable service error. Reopen the database and replay only idempotent requests; a timed-out mutation must be reconciled by operation ID before retry. On disk-full, cancellation, or loss of network during import, published exploration remains available.

## macOS packaging and distribution

The [packaging script](../apps/desktop/package.mjs) uses `electron-builder`, producing a local architecture-specific `.app` for internal checks or a DMG for the prepared product path. It packages renderer/service assets, notices and reviewed seeds in ASAR, with the bundled Git runtime and corresponding-source material outside ASAR. Publication is disabled by the packaging command. Test each advertised architecture and both development/packaged resource paths; successful compilation does not validate another platform. No library writes may target `app.asar`, the `.app` bundle or the install volume.

Publication requires reviewed installer/application archives, SHA-256 checksums, release notes, source/data revisions, runtime versions and actual signing/notarization status. Hosting an asset in GitHub Releases does not establish Apple trust. Follow the [publication policy](governance/publication-policy.md) and the separate artifact review before uploading.

The current script explicitly disables Developer ID signing and notarization and labels artifacts unsigned. Resetting an ad-hoc signature while applying Electron fuses is not distribution signing. A test artifact cannot promise a normal Gatekeeper installation experience. Report actual signature and assessment results; do not disable Gatekeeper, remove quarantine attributes or conceal warnings in an installer. A normally trusted direct-distribution release still requires the appropriate Developer ID signing and Apple notarization path, including packaged helpers. [Apple Gatekeeper behavior](https://support.apple.com/en-us/102445)

Use manual application replacement for the initial release. Automatic macOS application updates require a signed application in Electron's updater, so an unconnected updater must not appear in the UI. Data package import and revision publication remain independent of application updates. [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)

## Acceptance evidence

Before calling desktop v0.1 complete, record results for:

- A fresh packaged install that initializes the database and explores the starter revision offline, including both interface locales.
- GUI and CLI equivalence for scope/history exploration, show, checkout, Diff and blame; repository HEAD, historical checkout and fixed comparisons remain distinct across navigation and restart.
- Importing previously absent material, reviewing/adopting it into Working, exploring it, then staging and committing without a rebuild.
- Invalid references, cycles, unresolved multi-parent conflicts, insufficient rights, and incomplete evidence being rejected before publication.
- A correction committed as a modern revision while old OID-qualified states and comparison endpoints still reproduce their original content.
- Process termination, disk-full simulation, cancellation and concurrent guarded writes preserving the last valid revision and recoverable input.
- Migration from every supported prior schema, migration failure, backup, successful restore, and refusal of a corrupt or newer backup.
- Runtime IPC validation, denied remote navigation, inert imported markup, bounded file imports, and no exposed shell or SQL interface.
- Packaged SQLite import/transaction/backup checks, actual SQLite version, architecture, signature, notarization, and Gatekeeper assessment.

Unit tests establish domain behavior; service integration tests establish persistence; packaged-app tests establish runtime and distribution behavior. Passing one layer does not stand in for the others.

## Versioned scope organization — UED 07

The [scope module](scope-workspace-prd.md#data-and-service-boundary) stores context definitions and explicit membership as navigation/organization metadata in the existing Git tree. Definitions use `navigation/contexts/<identity-hash>/definition.json`; current membership uses 256 deterministic object-hash partitions under that context's `members/` directory, with explicit schema and partition versions. These records stay outside the historical collection index: they do not become ancient country objects, assertions, events or date observations. Git bytes are authoritative. Optional model links still require a separately validated crosswalk; no identity or scope equivalence is inferred.

A query reads ordinary objects and navigation metadata at one requested revision; fixed historical references keep their own object/year/OID/review policy. Working recipes may follow the current library, while explicit OID navigation reads the corresponding tree. Preserve these distinctions in library-backed workspace and research recovery. Older no-context state remains readable without inferred memberships.

Context save and membership plan/application use service-generated IDs, expected HEAD, exact file/content hashes, a frozen complete batch-set hash and independent operation receipts. Resolve accepted import batches from their durable original results; do not remap, extend the facts receipt or assume a cross-store transaction. Classification failure leaves adopted facts intact. Staging validates referenced metadata/targets and preserves frozen B while later C remains working.

The production backend uses one optional `navigation.sqlite` journal for immutable plans and prepared/completed operation receipts, with WAL/FULL durability and atomic schema installation. A partial metadata write blocks scope statistics until the original operation is resumed. Complete-backup validation checks each partial path against its original or prepared value and validates the completed overlay before directory exchange, while preserving staged and working differences. The optional trusted-bundle bootstrap supplies reviewed initial organization only to an empty repository; opening an existing library does not invent or replace memberships. GUI and bounded `scope` commands share these validated services without a server, shell or new application activity. Real Git/service tests cover these boundaries; renderer, content and installed journey acceptance remain separate.
