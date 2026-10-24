# ADR 0001: A local desktop service and versioned SQLite data

- Status: accepted for implementation
- Date: 2026-10-25
- Scope: macOS desktop v0.1; Windows and Linux are later targets

## Context

GitWorld has a working TypeScript exploration prototype with a pure historical query engine and bounded command parser. Its historical corpus, scope catalog, and time limits are currently bundled into the renderer. That is useful for UED review, but does not satisfy the desktop delivery requirement: persistent local data, migrations, a data-management workflow, acquisition and cleaning, reviewed publication, backup/restore, and downloadable application packages.

The desktop application must remain useful offline. Adding a region, branch, or historical version must be a data operation. Published exploration must not see a partially edited draft, and a correction must not silently change an existing workspace's HEAD or fixed comparison.

The source assessment's recommendation to compile static JSON/YAML into the UI is not selected for this scope. Its useful modeling recommendations—separate inheritance from influence, preserve uncertainty, and distinguish baseline observations from origins—can be implemented independently of its storage proposal. No market-exclusivity claim is required to justify the architecture.

## Decision

1. **Use Electron and TypeScript.** Reuse the existing web renderer and pure domain engine. Keep the main process small and run the data service in an Electron utility process.
2. **Use typed, validated IPC rather than a listening HTTP service.** The renderer has no Node, database, arbitrary filesystem, or shell access. GUI and terminal inputs converge on the same structured intent contract.
3. **Persist in SQLite, with one service-owned writer.** Prefer the runtime's `node:sqlite` through a repository adapter, subject to packaged-app compatibility and durability tests. Pin the Electron runtime. Record the embedded SQLite version and require the applicable WAL-reset fix before release.
4. **Keep published dataset revisions immutable.** Historical commits and dates describe modeled history; dataset revisions and publication times describe our editorial changes. Workspaces pin a dataset revision and exact commit IDs.
5. **Separate acquisition, drafts, review, and publication.** Import declarative packages or configured source adapters into quarantine. Track transformations, evidence, and rights. Validate and review before atomically activating a complete revision.
6. **Ship data as runtime resources and importable packages.** Scope definitions, branch definitions, field metadata, geography hints, translations, and navigation defaults come from the data model. No historical corpus is a renderer source-code dependency.
7. **Support migrations and tested recovery from the start.** Back up before schema changes. Use SQLite-aware backups and validate restores before replacement. Keep compatible old revisions for reproducible exploration.
8. **Distribute through GitHub Releases with truthful trust status.** Manual application updates are sufficient for v0.1. Developer ID signing and notarization are external release prerequisites for a normal trusted macOS distribution; they are not assumed credentials.

Detailed boundaries and acceptance evidence are in [architecture.md](../architecture.md).

## Alternatives considered

| Option | Advantage | Reason not selected for v0.1 |
| --- | --- | --- |
| Tauri with a Rust service | Small application footprint through the system webview; explicit native capabilities | Introduces Rust and a webview/runtime boundary while the domain and planned backend are TypeScript. Keeping a Node sidecar adds another runtime and packaging boundary. Reconsider if measured size or memory costs outweigh this tradeoff. |
| Electron with all services in main | Fewer processes and simpler initial wiring | Synchronous database work and import/validation jobs could block window lifecycle and expand the main process's responsibilities. A utility process gives a distinct failure and scheduling boundary. |
| Electron with localhost HTTP | Reusable browser/server transport | Adds port lifecycle, origin/authentication, and local network attack-surface concerns without serving a v0.1 requirement. A transport adapter remains possible later. |
| Static files compiled into renderer | Simple UED preview and deployment | Requires rebuilding to extend content, provides no durable editorial workflow, and couples the product to fixtures. |
| Native Git repository as the primary database | Familiar objects, tooling, and content history | Git storage alone does not implement our field evidence, review states, partial coverage, or historical as-of resolution. Use explicit domain semantics instead of treating software commit timestamps as historical dates. Export to Git may be added later. |
| `better-sqlite3` immediately | Established synchronous SQLite interface | Adds a native addon build for each Electron ABI and target architecture. Keep it as a fallback if the embedded API fails the actual packaging checks. |
| Browser database or remote PostgreSQL | Browser deployment or multi-user server support | Neither is the simplest fit for a durable, offline, locally installed editorial workbench. Multi-user collaboration is not required for v0.1. |

Tauri's official architecture uses Rust and the OS webview, and its development prerequisites include Rust. The tradeoff above is specific to this project's TypeScript code and delivery scope, not a claim that Tauri is unsuitable for serious desktop applications. [Tauri architecture](https://v2.tauri.app/concept/architecture/), [prerequisites](https://v2.tauri.app/start/prerequisites/)

Electron's stable release table at review time lists 45.0.0 with Node 24.22.0. This is a research observation, not an instruction to update dependencies without testing. Node's versioned SQLite API is still labeled release candidate, so the implementation must isolate it and prove behavior in the chosen Electron artifact. [Electron releases](https://releases.electronjs.org/release?channel=stable), [Node 24.22 SQLite](https://nodejs.org/download/release/v24.22.0/docs/api/sqlite.html)

## Consequences

The application will be larger than an equivalent system-webview shell and needs ongoing Electron security updates. A separate service adds a protocol, startup/recovery handling, and asynchronous UI states. Those costs buy a TypeScript backend, predictable renderer behavior, and a testable storage boundary.

The pure historical engine remains storage-independent. SQLite stores data and editorial state; it does not turn every historical claim into a proven fact. Publication checks must evaluate model validity, evidence, and redistribution rights separately. Explicit unknowns and reviewed modeling choices remain valid outcomes.

One local service is not a multi-user access-control boundary. The owner of the local machine can edit its files. Collaboration, account roles, synchronization, and distributed conflict resolution require a separate decision.

An unsigned or ad-hoc-signed test package is not equivalent to a notarized application. GitHub can host downloads, but cannot provide Apple Developer ID identity or substitute for notarization. Without credentials, delivery can include tested local builds and clearly labeled test artifacts; the trusted-installation release criterion remains unmet. The application must not work around OS security settings. [Apple distribution checks](https://support.apple.com/en-us/102445)

## Evidence required before finalizing the implementation

- The selected Electron build can open SQLite, transact, back up, and reopen from its packaged utility process on every advertised architecture.
- A new dataset scope and historical branch can be imported, reviewed, published, and explored without rebuilding.
- Published revision activation is atomic under injected interruption; previous revision workspaces remain reproducible.
- Backup restoration and migration failure recover without replacing valid data with an empty database.
- The UI preserves command semantics when service responses are delayed or fail.
- Distribution records include the actual signature, notarization, Gatekeeper assessment, runtime versions, and tested OS/architecture. Missing credentials are reported as a concrete release limitation.

Revisit this decision if product requirements introduce shared concurrent editing, a hosted service, mobile distribution, or measured desktop resource costs that justify another runtime.
