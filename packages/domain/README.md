# Historical domain

`@gitworld/domain` is the canonical TypeScript model and pure query implementation. It has no renderer, filesystem, database, network, or Electron dependency. The frozen UED prototype still has its earlier implementation; desktop code must import this package instead of introducing another model.

The public entry point is `src/index.ts`. Build tools must bundle/transpile its TypeScript for Electron; do not assume that every Electron process runs TypeScript source directly.

- `DataPackage` schema version 1 contains dataset identity, editorial revision metadata, the runtime scope/process/event/place catalog, and the historical graph.
- `validateDataPackage(input, mode)` returns a cloned typed value or structured `{ code, path, parameters }` findings. `shape` admits incomplete draft relationships but enforces the structural contract. `draft` validates relationships and replay. `publish` also requires claim locators, reviewed source rights, and an explicit integration ledger. Validation records a review decision; it does not prove the source true or provide legal certification.
- `createHistoryEngine(package.history)` exposes resolve, snapshot, log, Diff, blame, search, and common bases. The engine only consumes a validated published package in the application.
- `executeCommand` and `executeIntent` return the same structured output/effect model. Neither mutates workspace state. The service associates each request/result with `DatasetRef`.
- `buildContentManifest` produces canonical per-object JSON and SHA-256 hashes plus a complete package digest for immutable storage. Object IDs remain human-readable and are qualified by revision; object hashes identify exact content.

Historical years use civil numbering: `-1` means 1 BCE and is followed by `1` (1 CE). Zero is invalid. Each runtime commit has `date` with earliest/latest years and precision. Its `year` equals the latest bound for deterministic ordering. An as-of query inside an unresolved date range returns `DATE_UNCERTAIN` and exact commit candidates. The original precision remains available; no midpoint or exact day is invented.

`parents` and `lineage` govern inheritance. Influence/contact relationships never create ancestors. Multi-parent commits require explicit resolutions for changed fields, and unresolved inherited conflicts are rejected. Unknown and never-recorded values remain distinct from sourced absence. A baseline commit is an observation boundary, not an assertion of historical origin.

Commands support `tag:id`, `event:id`, `commit:id`, `branch@year`, `branch@BCE:year`, and established `HEAD`. Bare branches are complete path queries for log; snapshot operations require an explicit date/context point. `A B` and `A..B` compare endpoints. `A...B` compares the unique best common base to B; no or multiple bases return structured errors. Diff includes its original requested endpoints and mode for presentation.

Run the package's independent type check with `tsc -p packages/domain/tsconfig.json`; run its tests with `node --test packages/domain/src/*.test.ts packages/contracts/src/*.test.ts` on Node 24.
