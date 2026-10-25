# Data operations

Authored history models use a schema-1 `DataPackage`. JSON/CSV model import and the reviewed model seed use `validateDataPackage` from the shared domain package. Ordinary object/assertion collections use the separate `KnowledgeCollection` contract. Both enter the same application-owned Git repository; the renderer does not own the corpus. Accepting a model preview creates an editable draft, including one with outstanding validation issues. Reviewed model adoption writes a validated `models/<dataset-hash>.json` working file, which uses the same staging and commit path as object/assertion changes. It does not advance HEAD or stage content automatically.

The current ingestion package provides JSON/CSV parsing and a working official Met Open Access metadata adapter. It does not write the application database, authorize publication, run arbitrary shell commands or make every website a supported source. Local-service and desktop integration have their own acceptance checks; passing the commands below does not claim those UI checks passed.

## Package identity and review

The model contract is defined in [`packages/domain/src/package.ts`](../packages/domain/src/package.ts) and [`history-types.ts`](../packages/domain/src/history-types.ts). A package contains dataset metadata, an authored revision identifier, a runtime catalog (scopes, processes, events, places and navigation defaults), and the historical graph (fields, branches, commits, tags, relationships and sources). The actual Git commit OID is the immutable editorial revision; an authored package identifier is not a second repository HEAD.

- `history.datasetId` must equal `dataset.id`; `history.id` must equal `revision.id`.
- Historical dates use signed civil years, with no year zero. Editorial timestamps and retrieval dates are ISO timestamps. They are not historical event dates.
- Parents describe recorded continuation, split or integration. Influence/contact are separate relationships. Multiple parents require explicit field decisions; validation must not resolve conflicting states by parent order.
- Known values carry evidence locators. Unknown means unrecorded or unresolved; explicit absence uses a distinct representation and needs evidence.
- Source rights describe allowed redistribution separately from historical evidence. A citation does not license copying an article. A review identifier may identify an automated editorial role; it must not imply human approval.
- `draft` validates graph integrity and allows outstanding evidence/rights review. `publish` also requires evidence locators and reviewed rights. The service's `shape` mode is only for saving an incomplete but structurally editable draft; it does not make the draft review-ready or publishable.

The initial seed is [`data/seed/early-medieval.json`](../data/seed/early-medieval.json). It contains 38 versions and 9 processes, including independently sourced integration, influence, approximate/alternative dates and BCE examples. [Content notes](../data/README.md) describe the limits and source decisions. These are selected records, not a complete timeline. The database initializes from the seed only when appropriate for an empty installation; normal startup must not overwrite edits or published revisions.

## Import API

`packages/ingestion/src/index.ts` exports:

```ts
parseImport(text, { format: 'json' | 'csv', mode?: 'draft' | 'publish' | 'shape' })
// { ok, package: DataPackage | null, issues, report }

loadDataPackageFile(hostPath, mode = 'draft')
// Same result; bounded host-side file read with structured failure.

exportPackageCsv(dataPackage)
// Full package CSV, with quoted cells and preserved nested JSON.

acquireMetObjects({ objectIds, stagingDirectory?, dryRun?, signal? })
// Promise<{ ok, package, report }>

replayMetStaging(hostDirectory)
// Hash-check and remap an acquisition without network or writes.
```

The renderer must use host-minted file tokens and configured sources. Do not expose these filesystem paths or dependency injection hooks as arbitrary renderer-controlled file/network access. Parse and validation errors return stable codes, paths and optional parameters; the UI supplies localized messages. A failed parse returns no package. The importer has a 16 MB input limit and inherits the domain's JSON depth/object limits.

A successful preview is not a commit. The local service records the preview input hash, binds an accepted draft to it, and preserves incomplete edits in that draft. `draft.publish` compares the reviewed draft version, repository HEAD and prior working model hash before writing the reviewed package to working content. Durable prepared/completed receipts allow recovery and idempotent retries without overwriting a later edit. SQL publication snapshots remain readable through the legacy revision API; they are not the default model catalog. Fixed workspaces and historical comparisons retain their actual repository OIDs until explicitly changed.

## Repository and historical commands

The [scope contract](scope-workspace-prd.md) adds explicit, versioned navigation contexts. New knowledge-adoption results carry an additive `batch` manifest with schema version, full input and accepted object-set hashes, and source pins captured during that adoption. The accepted set is the complete changed/reused object set, not the result's display sample. A prepared paired artifact independently proves its original set. Existing completed receipts are never backfilled or relabeled from later working claims; an older generic result without source evidence cannot claim original-batch provenance. Explicit saved-source selection remains available for a new, reviewed organization decision. Classification writes its own navigation receipt and never extends the facts-adoption operation.

The bounded `scope` command family calls the same context services as the GUI: `contexts`, `context`, `create`, `use`, `filter`, `reset`, `batches`, `assign` and `apply`. Assignment resolves a fixed batch key and prepares a durable whole-set plan; `apply <plan-id>` explicitly writes only navigation working changes. Creating a definition and applying a plan require a stable operation ID. New definitions and plans also use the reviewed working HEAD; updates guard the exact definition and membership baseline. A current browsing revision is explicit command context (`scopeRevision`), independent of the open activity. `use` changes only context selection, `filter` patches explicit filters, and `reset` clears filters without touching the data revision or historical checkout/A-B. Name and keyword search reads labels, aliases and descriptions; opaque IDs remain available through direct references and `history --object`.

Ordinary collection files remain supported. A paired `gitworld-knowledge-import` envelope can additionally carry a field catalog, provenance and optional projection/rights metadata within the same 32 MiB file; its catalog is bounded at 1 MiB. The service persists a versioned preview before adoption and compares the selected file, preview hash, repository HEAD and participating working content. Claims and vocabulary become working changes together, without automatic staging or commit. A vocabulary conflict blocks the paired adoption with structured differences. Unknown rights remain unknown.

Catalog sources and active references are ordinary versioned repository content. Fixed OIDs and frozen staged trees use their own catalog, including field/type/value labels; later working labels do not relabel an earlier comparison. Object staging requires the catalog files used by those fields. Durable import receipts protect interrupted writes and late retries. Revisions predating versioned catalogs retain an explicitly identified library-pinned compatibility fallback; the application does not invent missing historical metadata. GUI consumption and source-profile acquisition require their own acceptance evidence.

The paired envelope and catalog-origin fields are defined in [`knowledge-import-types.ts`](../packages/contracts/src/knowledge-import-types.ts). `knowledge.filePreview({fileToken})` returns the existing counts/sample plus `preview.prepared = {id, fingerprintVersion: 2, baseHead}` and a bounded vocabulary summary. Pass that ID as `previewId` to `knowledge.fileAdopt`, retaining `expectedHead = baseHead`, `expectedInputHash`, the explicit review choice and a stable `operationId`. A pending accepted operation must be checked with the same request before another content adoption or HEAD-changing action. Read-only exploration, recoverable inputs and full backup remain available. `repository.stagePlan.incomplete` identifies paths awaiting that confirmation. The old collection-only path does not require `previewId`; unattached vocabulary-like extensions report `UNPAIRED_VOCABULARY` and retain their prior collection-only meaning.

After restart, `knowledge.pendingImports({})` lists only bounded recovery summaries. `knowledge.resumeImport({operationId, previewId})` resumes the exact accepted receipt without a file token or a new operation identity. It retains the accepted review choice and original guards, and repeated resume returns the same result even after subsequent working edits. This route uses the import receipt directly, rather than registering the original operation identifier under another generic idempotency method. A mismatched preview is rejected and unrelated content writes remain blocked while an import is pending.

The backend file slice has dedicated real-Git/service tests for preview binding, conflicting catalogs, frozen/working versions, interrupted writes and complete restore. Its vocabulary-conflict behavior is conservative rejection, without a new editing route. The installed GUI and fixed-host profile workflow remain unaccepted until their separate journeys pass.

`model.catalog` and `model.read` read Working or an explicit commit OID. Their envelopes keep the actual repository source, base HEAD and canonical content hash separate from the authored package revision. A working-only package can be previewed; historical checkout and fixed comparisons require committed content.

The global bounded interpreter uses `git` for modern repository edits and `history` for explicit model/object inspection. Typed GUI intents use the same handlers. Representative forms are:

```text
git status
git diff --staged --offset 0 --limit 25
git add -- <paths>
git restore --staged -- <paths>
git commit -m "reason"
history --model <model-id> --revision <commit-oid> show state:<state-id>
history --model <model-id> --revision <oid-A> diff <ref-A> <ref-B> --against-revision <oid-B>
history --object <object-id> --revision <commit-oid> show <year>
history --object <object-id> --revision <commit-oid> diff <year-A> <year-B>
```

Repository diffs return an explicit page and total, defaulting to 25 files and bounded at 100. Staging and unstaging share the 40,000-path request budget. Historical aliases such as CHECKED and A/B use only context bound to the same explicit model and repository revision. Each cross-revision model endpoint resolves in its own committed tree; comparison does not infer a common historical base across editorial trees or align different model identities. Conflicting prototype `git` aliases return migration guidance, and no system shell is executed.

## JSON and CSV

From the repository root with the project's supported Node.js version:

```sh
node packages/ingestion/src/cli.ts validate data/seed/early-medieval.json
node packages/ingestion/src/cli.ts validate data/seed/early-medieval.json --publish
node packages/ingestion/src/cli.ts csv data/seed/early-medieval.json .local/history.csv
node packages/ingestion/src/cli.ts validate .local/history.csv --publish
```

CSV is a **full-package interchange format**, not an arbitrary spreadsheet importer or a replacement for the data editor. It uses exactly three columns: `type,id,payload`. Each payload is a JSON object in a quoted CSV cell. This avoids silently flattening evidence arrays, translations, dates and integration decisions.

| Type | Payload |
| --- | --- |
| `package` | Exactly one row. Package metadata with `schemaVersion`, `dataset`, `revision`, `catalog.defaults`, `history.id` and `history.datasetId`; omit all object tables. Row ID equals dataset ID. |
| `scope`, `process`, `event`, `place` | One catalog object per row; row ID equals payload `id`. |
| `branch`, `commit`, `field`, `source`, `tag`, `relationship` | One historical object per row; row ID equals payload `id`. |

Use the exporter for a complete template, then edit its cells. Embedded quotes are doubled by CSV rules; multiline cells and UTF-8 translations are supported. A UTF-8 BOM is accepted. Duplicate rows, missing package metadata, malformed quotes, inconsistent IDs, unsupported record types, unsafe JSON keys and dangling graph references fail with a line or object path. Unknown tables are rejected rather than discarded. Formula text is never executed; JSON payloads are data, never code. Review spreadsheet application behavior separately if opening an exported file outside GitWorld.

Correct an import in the input file or the draft editor and preview again. An old failed preview must not be treated as a partial successful import. Schema validation does not compare a statement against its cited source: claim review remains necessary.

## Official Met Open Access acquisition

The adapter calls only `https://collectionapi.metmuseum.org/public/collection/v1/objects/<positive-integer-id>`. It uses the [official API](https://metmuseum.github.io/), requires no API key, rejects redirects and limits each request to 20 seconds and 2 MB. A run takes 1–25 unique IDs sequentially. Object IDs come from the museum's collection catalog or official search; the adapter does not crawl arbitrary links.

Basic collection metadata is offered under CC0 under the [museum's Open Access policy](https://www.metmuseum.org/hubs/open-access). The adapter fetches JSON only and selects title, source date label/bounds, medium, culture, period and department. It never fetches image URLs, essays or linked resources. Open Access metadata terms must not be generalized to the museum's historical essays or all artwork images. See [third-party notices](../THIRD_PARTY_NOTICES.md).

```sh
# Network preview; no directories, raw files or packages are written.
node packages/ingestion/src/cli.ts met --ids 436535 --dry-run

# Fetch, quarantine raw JSON, map fields, validate and write a review package.
node packages/ingestion/src/cli.ts met --ids 436535 --staging .local/ingestion

# Use the exact stageDirectory returned by the preceding command.
node packages/ingestion/src/cli.ts replay .local/ingestion/met-<run-id>
node packages/ingestion/src/cli.ts validate .local/ingestion/met-<run-id>/review-package.json
```

Object 436535 is the Met's catalog record for *Wheat Field with Cypresses*. It is an operational example, not part of the medieval seed. Imported objects become independent artifact observations in a collection scope. A museum department or culture label is not treated as a political territory, and no parent edge to a historical polity is invented. Missing metadata stays unknown. Invalid/zero date bounds stop review-package creation; the adapter does not guess a date from prose.

Each staged run contains raw `<object-id>.json`, `manifest.json`, `report.json` and, only on success, `review-package.json`. The manifest records requested IDs, retrieval time, filenames and SHA-256 hashes. The package's source revisions retain those hashes. Mapping preserves the source's date label; catalog bounds represent dating, not necessarily an event duration. Approximate single-year labels remain approximate. Metadata review must resolve qualifications that the generic mapper cannot interpret.

Each acquisition is a complete selection of the requested objects in a new revision, not an append operation. A later run may contain a different selection. Earlier published revisions remain available, and an existing exploration stays pinned to its chosen revision. To retain an earlier corpus while adding records, create a draft from that release and make an explicit editorial merge; the adapter does not guess historical or editorial parents.

Every acquired source begins `unreviewed`. Successful draft validation produces `readyForReview: true` and separately reports the publication findings. A reviewer must verify the selected fields, dates, evidence and the exact redistribution basis in a draft. Acquisitions never auto-approve rights or publish data. Raw staging, operational reports and runtime databases stay local under the [publication policy](governance/publication-policy.md).

## Recovering failures

| Finding | Recovery |
| --- | --- |
| `NETWORK_FAILED` with object ID / HTTP status | Check the ID, connectivity and upstream status; retry the requested set. The adapter does not disclose arbitrary response text or credentials. |
| `SOURCE_RECORD_INVALID` | Inspect the local raw record and mapping requirement. Preserve raw bytes. Correct a separate draft with a documented editorial decision, or repair the adapter and replay. |
| `STAGING_FAILED` | Choose a writable local staging directory and retry; a package whose evidence could not be saved is not review-ready. |
| Hash mismatch, incomplete manifest or missing staged object | Do not edit raw evidence to make validation pass. Reacquire the requested set; replay fails closed and never silently drops a failed object. |
| `INVALID_CSV` / `INVALID_JSON` | Repair the reported line/payload; use a freshly exported complete template when necessary. |
| `DANGLING_REFERENCE`, `INVALID_GRAPH`, `INTEGRATION_REQUIRED` | Repair the graph and explicit field decisions in the draft; schema-only save is not publish approval. |
| `MISSING_EVIDENCE`, `RIGHTS_UNREVIEWED`, `REDISTRIBUTION_DENIED` | Add a meaningful locator or complete an evidence-based rights review; exclude content that cannot be redistributed. |

Replay verifies hashes before mapping and does not overwrite staging or contact the network. Corrected mappings therefore remain reproducible from the same raw bytes. Revision identity includes retrieval time and input hashes, so a fresh acquisition does not silently reuse an immutable revision ID with new source timestamps.

## Verification

```sh
node --test packages/ingestion/src/ingestion.test.ts
node node_modules/typescript/bin/tsc --project packages/ingestion/tsconfig.json
```

Tests exercise the real curated seed, integration and date semantics; JSON/CSV roundtrips; corrupt/hostile inputs; absent metadata; rights gating; bounded network responses; staged replay; tamper detection; and partial acquisition failure. Transport mocks are synthetic and explicitly separate from historical data. Live acquisition is an additional manual check, not a network-dependent CI test. These checks do not certify scholarly completeness, desktop acceptance or legal rights beyond the recorded review scope.
