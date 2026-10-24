# GitWorld desktop architecture

Status: implementation design, 2026-10-25. Target: macOS desktop v0.1, with Windows and Linux later. This document describes the intended system; it is not evidence that the desktop application, persistence, or distribution checks have already shipped. The decision is recorded in [ADR 0001](adr/0001-desktop-local-data.md).

## Application boundary

GitWorld is a local history workbench. A user can explore a published dataset offline, inspect states and evidence, compare versions, and use either graphical controls or the bounded Git-like command language. A separate data-management area imports, edits, reviews, and publishes local datasets. It is an editorial workflow on the user's machine, not a multi-user server or an authorization system between mutually untrusted local users.

Use Electron with TypeScript, the existing web renderer, a local TypeScript application service, and SQLite. No database server, browser extension, Git executable, or developer runtime should be required on an end user's machine. The installer includes a reviewed starter data package as an ordinary resource. First launch imports it through the same validation and publication path as later packages; historical records are not compiled into renderer JavaScript.

The existing `history-engine.ts` and `commands.ts` provide useful domain boundaries: parent replay, snapshots, stable field comparisons, explicit absence, reference resolution, and structured command results. Preserve those semantics and their tests. Today `workbench-ui.ts` imports `history-content.ts`, while `main.ts` imports a separate scope/event corpus from `content.ts`. `state.ts` and the timeline also contain fixed 600–900 bounds. All of these dataset dependencies must move behind the runtime catalog. Replacing only the commit array would leave new scopes and periods unusable.

## Processes and responsibilities

| Component | Owns | Must not own |
| --- | --- | --- |
| Sandboxed renderer | Workbench, data-management screens, localized copy, transient selection, accessible interactions | Node access, SQL, arbitrary file access, network ingestion, source credentials |
| Narrow preload bridge | Explicit typed request methods and progress subscriptions | Generic IPC forwarding, `eval`, shell execution, arbitrary channels or paths |
| Electron main process | Window lifecycle, sender validation, native file dialogs, external-link policy, service supervision | Long parsing jobs, graph replay loops, database business rules |
| Local data service in `utilityProcess` | Repository, migrations, queries, imports, validation, editorial workflow, publication, backup/restore | UI strings or browser navigation |
| Pure domain package | Historical model, validation, command parsing, resolution, replay, Diff and provenance | Electron, DOM, SQLite, filesystem, network |

Electron's utility process supplies Node.js and message ports, so the service can remain TypeScript without an HTTP listener. The main process brokers requests from the allowed application origin to this service. A future web deployment can add an HTTP adapter to the same service contract; v0.1 does not need a dormant server. [Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)

Keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` explicit. Use a packaged application origin with a restrictive CSP; deny unsolicited navigation, new windows, permissions, and embedded remote pages. Validate the sender and payload for every privileged request. External citations open only through an allowed `https:`/`http:` link method. Source HTML is inert input, never application markup. A sandboxed preload should be bundled as CommonJS; disabling the sandbox to accommodate ESM imports is not acceptable. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [preload module constraints](https://www.electronjs.org/docs/latest/tutorial/esm)

## Service contract and workspace state

Use versioned request and response envelopes containing a request ID, protocol version, dataset ID, and dataset revision ID where applicable. Validate them at runtime, independently of TypeScript. Return typed results or `{ code, parameters, recovery }`; locale resources render the message. No business logic may branch on formatted command output.

The query boundary accepts a typed intent and explicit context. Terminal input is parsed to the same intent that GUI controls submit. Operations include catalog, reference completion, branch history, show, checkout, Diff, blame, and search. Queries are evaluated against one immutable revision for their entire lifetime. A cache is keyed by dataset revision, never merely by branch or commit ID.

Workspace state records:

- Dataset and immutable revision ID.
- HEAD as a commit ID plus the requested date, if one was supplied.
- Each fixed comparison endpoint as a commit ID plus its requested date.
- Browsing scope, selected object, graph query, viewport, time window, return trail, and locale.

Show and log leave HEAD unchanged. Checkout changes HEAD without replacing fixed comparison endpoints. Diff changes the comparison without checking out either side. Back navigation changes browsing context, not the checked-out version. Errors apply no effects. Preserve these rules when operations become asynchronous: apply only the response belonging to the current request generation and revision, and discard obsolete responses after navigation or revision switches.

Persist workspace changes through a versioned, compare-and-swap save operation. Serialize command submissions; do not let two delayed responses overwrite each other's HEAD or comparison. The service checks that all saved refs belong to the pinned revision. A failed save must be visible and retryable, without claiming that restart recovery succeeded. Reload restores the saved revision and exact refs. A missing revision produces a recoverable missing-data state; it must not silently resolve the same names against the newest release.

Installing or publishing a new revision does not rewrite an open workspace. Switching revisions is an explicit action with a validated mapping or a new workspace. Links and exports include the revision ID; local absolute paths and imported source bodies do not belong in shared links.

## Persistent model

SQLite is the local system of record. Use one service-owned writer connection and short transactions, with foreign keys enabled, a bounded busy timeout, and explicit durability settings. Keep the live database on a local filesystem under the application's user-data directory, outside the application bundle. Do not encourage using a live database inside a network or synchronized folder.

Prefer the SQLite API bundled with the pinned Electron runtime, behind a small repository adapter. Node 24.22 documents `node:sqlite` as a release candidate; its API must be tested in the actual packaged utility process, not inferred from the developer's system Node. A release check records Electron, Node, and `SELECT sqlite_version()`. If the bundled API cannot pass the packaged tests, a separately evaluated `better-sqlite3` adapter is the fallback; it introduces per-Electron/per-architecture native rebuilding. [Node 24.22 SQLite API](https://nodejs.org/download/release/v24.22.0/docs/api/sqlite.html), [Electron SQLite support fix](https://releases.electronjs.org/pr/47756), [native module ABI](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

WAL is appropriate for local reading while imports are staged, but it does not make multiple writers or cross-database commits atomic. Require a SQLite build containing the WAL-reset fix: 3.51.3 or later, or a specifically verified patched release. Checkpoints remain service-owned. Do not copy only the main database file while it is open in WAL mode. [SQLite WAL behavior and fix](https://www.sqlite.org/wal.html)

The logical entities below may use validated JSON for small structured values, but their identities, references, revision ownership, and workflow transitions require database constraints and indexes.

| Entity | Required information |
| --- | --- |
| Dataset | Stable dataset ID, description, license manifest, active published revision |
| Dataset revision | Immutable revision ID, parent revision, schema version, content digest, real publication timestamp, release notes |
| Scope and process | Stable IDs, hierarchy, labels, descriptions, temporal coverage, geography/view hints, supported themes |
| Branch | Stable ID, scope/process references, recorded coverage, topology metadata |
| Historical commit | Stable ID within the dataset, historical date, kind, parent refs, narrative, field changes |
| Field definition | Stable semantic path, type, comparison semantics, group, localized label |
| Field assertion/change | Stable value key, value, knowledge status, evidence links, modeling note, temporal precision |
| Relationship | Typed lineage or influence/contact link, endpoint refs, optional field and evidence refs |
| Source and claim evidence | Original title/language, URL or identifier, locator, retrieved revision/time, rights metadata, supported assertion |
| Translation | Object/field ID, locale, text, original language, translation provenance |
| Import and review | Input digest, adapter/version, transformations, validation findings, review state and decisions |
| Workspace | Pinned revision and versioned exploration state |

All published graph references use revision-qualified foreign keys. A published revision is immutable; a correction creates another revision. Historical commit identity and historical dates are not database migration IDs or publication timestamps. `francia/west@850` is an as-of query inside a particular data revision, not a software release name.

The import format carries scopes, processes, places, branches, fields, commits, relationships, sources, translations, and default navigation metadata. It must be possible to add a new region, branch, and historical record through data management without editing TypeScript or rebuilding the application. New field kinds or genuinely new visualization algorithms can require a schema/application upgrade. Arbitrary JavaScript plugins or expressions are not part of data configuration.

## Historical semantics that survive storage

- Historical dates use an explicit signed-year convention and precision metadata, independent of Unix timestamps. State clearly how BCE years are encoded; prohibit an accidental year zero in the user-facing calendar. A year-level record must not acquire invented day precision during import.
- As-of lookup remains bounded by declared coverage. Echo the requested date and the actual record date. Sparse records do not establish that every inherited assertion remained true at every intermediate instant.
- Unknown, never recorded, known value, and explicitly absent are distinct. An absence needs evidence and provenance; missing data cannot become a historical addition or removal in Diff.
- Baseline observations are distinguishable from recorded changes. Blame identifies the last recorded assertion and its source, not necessarily a historical invention or origin.
- Parent edges express modeled continuity and integration. Influence/contact edges do not inherit whole states. Multi-parent conflicts need an explicit resolution and provenance; input order must not choose a winner.
- Comparison uses stable semantic values. Translated prose and formatting do not change equality. A shared field path enables comparison but does not establish that two societies used equivalent institutions; field definitions and modeling notes carry that limitation.

English is the required historical-content language. Chinese translations are optional per object and have an explicit English fallback. Both interface locales remain complete. The current `HistoryText` requires both languages and therefore needs to evolve without duplicating the graph.

## Acquisition, review, and publication

Data management is a working part of v0.1: source configuration, import jobs, validation results, draft editing, review decisions, revision publication, rollback to a retained release, and export. It is separate from exploration so that partially imported or unreviewed data never appears as published historical fact.

Use this lifecycle:

1. **Register the source.** Record the source's original metadata, acquisition method, rights basis, attribution requirements, allowed retention/export, and the evidence for those decisions. A source being readable on the web is not a redistribution license.
2. **Acquire into quarantine.** Prefer documented APIs, permitted downloads, or user-selected local files. Apply source-specific terms, rate limits, size limits, timeouts, and identifiable requests. Refuse executable imports and arbitrary remote URLs that can access local/private services. Keep credentials outside dataset exports.
3. **Normalize into a draft.** Preserve the input digest, source revision, mapping version, and transformation log. Import only a documented declarative schema. No imported SQL, scripts, template execution, or automatic fact invention. Duplicate inputs are idempotent; changed inputs create a new draft candidate.
4. **Validate and review.** Check schema, IDs, foreign keys, graph cycles, coverage, date order, conflict resolution, value types, evidence, and rights. Show proposed changes against the previous published revision. Record editorial and rights decisions separately. Unresolved blockers prevent publication; a successful schema check is not a historical review.
5. **Publish atomically.** Freeze an approved draft, validate every derived snapshot, compute a canonical digest, and insert the complete revision plus its publication record in one transaction. Advance the active-revision pointer only in that transaction. Publish notifications and cache activation occur after commit. A crash or validation failure leaves the prior revision usable.

Acquisition permission, local retention, and redistribution are separate decisions. Export includes only approved payloads and required notices. For example, Wikidata distinguishes CC0 structured data from text in other namespaces; a blanket “Wikimedia content is CC0” rule would be wrong. Citation metadata can be stored without redistributing entire source articles. [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)

Starter content receives the same review as imported content. Existing prototype citations are evidence leads, not blanket authorization to copy source bodies. The supplied external assessment is useful research input, but its market-exclusivity claims and technical assertions are not a publication authority. The application must not label an import “verified” solely because an automated process generated it.

## Migrations, backup, and recovery

Maintain ordered, application-owned migrations with immutable IDs and checksums. Back up before an upgrade, then apply each supported migration transactionally. Reject an unexpected migration checksum or a database newer than the application supports. Never downgrade a database in place. On failure, retain the original and expose recovery/export; do not silently create an empty replacement.

The implemented database stores source citations, rights records, import previews, publication decisions and immutable historical records. Acquisition raw responses and their hash manifests remain in a separate local quarantine directory; they are review evidence, never a substitute for a published object. The database backup currently excludes that raw acquisition cache. Preserve the quarantine directory separately when transferring acquisition evidence. If future published objects reference external assets, their manifest and payload must be included in the backup format before that feature ships. A filesystem rename and a SQLite commit are not one atomic transaction.

The repository creates backups through SQLite `VACUUM INTO` to a temporary destination, verifies schema and data, then atomically renames the result into place. It retains the previous destination until replacement succeeds. The backup includes drafts, decisions, source metadata, published revisions, and workspace state. Each published version's persisted tree hash is checked against parent-state replay during validation. [SQLite backup API](https://www.sqlite.org/backup.html), [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)

Restore is a maintenance operation: pause writes, validate the candidate's schema, integrity, foreign keys, and manifest before replacing anything; create a recovery copy of the current database; close all database handles; swap files; reopen and verify. Recover or roll back an interrupted swap using a small recovery journal. A compatible restored database may be migrated only after its own backup. A corrupt or incompatible backup never overwrites healthy local data.

On utility-process failure, retain the last rendered results and report a recoverable service error. Reopen the database and replay only idempotent requests; a timed-out mutation must be reconciled by operation ID before retry. On disk-full, cancellation, or loss of network during import, published exploration remains available.

## macOS packaging and distribution

Package the web assets, service code, runtime, licenses, and starter dataset together. Use Electron Forge with separate macOS architecture artifacts as the initial packaging path; do not advertise an architecture or minimum OS version until its packaged application has been tested. Build on macOS and test both development and packaged resource paths. No writes may target `app.asar`, the `.app` bundle, or the install volume.

Publish versioned installer/application archives, SHA-256 checksums, release notes, source revision, runtime versions, data revision, and signing/notarization status in GitHub Releases. Public repositories using standard GitHub-hosted runners can use Actions without billed execution minutes under the current policy; larger runners and storage policies require separate consideration. Releases support downloadable assets, but hosting them does not establish Apple trust. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

There is currently no assumed Developer ID certificate or notarization credential. An unsigned or ad-hoc-signed development artifact can be built and shared as an explicitly identified test build, but it is not a notarized public release and cannot promise a normal Gatekeeper installation experience. Report the actual signature and assessment results. Do not disable Gatekeeper, remove quarantine attributes, or conceal warnings in an installer. A normally trusted direct-distribution release requires the appropriate Developer ID signing and Apple notarization path, including the packaged helpers. [Apple Gatekeeper behavior](https://support.apple.com/en-us/102445), [Electron Forge macOS signing](https://www.electronforge.io/guides/code-signing/code-signing-macos)

Use manual application replacement for the initial release. Automatic macOS application updates require a signed application in Electron's updater, so an unconnected updater must not appear in the UI. Data package import and revision publication remain independent of application updates. [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)

## Acceptance evidence

Before calling desktop v0.1 complete, record results for:

- A fresh packaged install that initializes the database and explores the starter revision offline, including both interface locales.
- GUI and CLI equivalence for branch exploration, show, checkout, Diff, and blame; HEAD/comparison preservation across navigation and restart.
- Importing a previously absent scope, branch, period, and record, publishing it, then exploring it without a rebuild.
- Invalid references, cycles, unresolved multi-parent conflicts, insufficient rights, and incomplete evidence being rejected before publication.
- A correction publishing as a new revision while an old workspace still reproduces its original states and comparison.
- Process termination, disk-full simulation, cancellation, and concurrent publication attempts preserving the last valid revision.
- Migration from every supported prior schema, migration failure, backup, successful restore, and refusal of a corrupt or newer backup.
- Runtime IPC validation, denied remote navigation, inert imported markup, bounded file imports, and no exposed shell or SQL interface.
- Packaged SQLite import/transaction/backup checks, actual SQLite version, architecture, signature, notarization, and Gatekeeper assessment.

Unit tests establish domain behavior; service integration tests establish persistence; packaged-app tests establish runtime and distribution behavior. Passing one layer does not stand in for the others.
