# Research contexts and scope navigation

Document revision **v0.2** · Product scope **v0.1** · 25 October 2026

Status: UED 07 direction and typed boundary accepted; repository-backed services and the renderer slice are implemented, with integration review and installed acceptance incomplete. This extends the [data workspace](data-workspace-prd.md), its [interaction contract](data-workspace-ued.md) and the [learning workflow](learning-workflow.md). It does not establish China/Japan [C01–C06 acceptance](acceptance/china-japan-v0.1.md).

## User outcome and boundary

A newcomer can move from the library's actual coverage to a research context, a time window and concurrent structures, inspect states and relationships, compare and return. They can create a context and assign an entire adopted source/import batch without JSON, an LLM, internal IDs or row-by-row tagging. Unassigned material remains usable through ordinary object, time, evidence and command paths.

Keep Explore and Library. Scope navigation is part of the existing workbench; context creation and membership are contextual editing tasks, not a new activity, settings section or dedicated country page. English and Simplified Chinese share stable IDs and behavior. User-authored names retain their language; do not fabricate translations.

## Meanings that must remain separate

| Concept | Meaning and limit |
| --- | --- |
| Research context | A versioned organization of material. Membership can overlap. It is neither an ancient country, a boundary, a lifespan nor a political parent. |
| Time window | An explicit numeric filter over recorded historical dates, including the stated treatment of possible and undated material. It is independent of context and name search. |
| Period definition | An evidenced historical object with its own definition and sources. A source heading, ruler sequence or coverage bucket does not supply one. |
| Historical structure | An ordinary polity, court, office, institution or other declared type. Source table groupings and chronology candidates retain their distinct types. |
| Model artifact | A runnable authored model with a model ID, data revision and actual coverage. Shared repository HEAD does not imply a shared object scope. |
| Historical reference | A fixed object/year/OID/review-policy tuple, or an explicit model/ref/OID target. Changing navigation metadata or browsing scope does not rewrite it. |

Context definitions, membership and explicit model links are **navigation/organization metadata in the same Git tree**. They are not `KnowledgeObject` or `KnowledgeAssertion` records and do not increase historical object/event/date statistics. Manual membership records a user's organization decision. Source/profile membership retains its rule version, fixed sources and batch basis. Neither approves historical claims nor generates ancestry.

Claim citations remain separate from a mapping/profile source header. When a claim records a distinct evidence URL, Evidence exposes it as Cited source while retaining the derived source's identity, hash, revision and locator. Equal URLs appear once. Saved research uses the claim's recorded URL first and the source-header link as fallback; it never relabels an upstream permalink as the derived snapshot.

## Interaction contract

The default central Scope overview presents actual context/type/time coverage. The left Scope holds context, numeric years, object kinds and literal name/keyword filters. Structure types lead broad investigation; people, documents, source groupings and uncertain chronology remain reachable. Data supplies context definitions and navigation roles; the renderer has no country-specific routes or ID checks. Without coordinates, use coverage and structure lists. Without period definitions, state the gap inside existing coverage/definition details, not an empty period control.

The matching historical objects lead a selected scope's central content. Complete coverage statistics and type/time drill-down remain available in a secondary disclosure, after the results. Full recorded ranges describe those objects' records, not the user's active numeric window. Collection-wide totals must not displace a small parallel structure set below the initial viewport. While saved navigation is being restored, show a loading shell and known fixed references; do not expose editable default filters that the asynchronous restore would replace.

At narrow effective widths or short viewports, including 200% interface zoom, the Objects investigation must provide a continuous reachable scroll path through Scope, fixed checkout/A/B, the selected view, comparison fields and evidence. Stacked references and global Terminal/Guide must not leave the canvas clipped outside a non-scrolling parent or reduce it to an unreachable strip. Keyboard focus on a lower field scrolls the investigation, without moving global chrome through the reference slots. Preserve text size, scope inputs, unapplied year, fixed references and pagination; verify both locales and the target window/zoom combinations under D14 and N09. This is a reachability requirement, not a requirement that all regions fit at once.

Redrawing the same investigation retains its live scroll position through read completion, language or review-display changes and read-only repository output. Explicitly opening field Evidence in the single-flow layout brings the selected evidence region into view and gives it keyboard focus, scrolling only the investigation. A new applied scope, object, view or fixed comparison target does not inherit another investigation's offset. Unrelated late responses cannot reclaim a later editor or Terminal focus. This transient presentation continuity is separate from persisted semantic navigation and return state; translated labels and unapplied drafts do not identify the investigation.

In that natural-flow layout, an explicit object, map object, historical view or observation navigation starts at its main heading, immediately when loading begins; it does not send the learner back through the Scope form and fixed-reference strip. Back to scope and a newly applied scope start at Scope. A completion can retain an already focused heading but cannot reclaim focus after the learner moves elsewhere. Command-driven historical results bring the main content into view without taking Terminal focus; opening Evidence remains an explicit action. Wide desktop layouts keep their existing panel behavior.

Completing a load keeps that selected heading visible even when preceding Scope content changes height. Continuity uses the complete rendered layout, including its resource navigation, rather than an intermediate loading layout.

On a new workspace, declared structure roles select the complete exact type-ID set as the initial kind filter; sorting type labels alone is insufficient. Show Structures as the active choice and provide one-click All kinds. The complete same-revision type catalog is independent of current matches and the largest-40 coverage summary. With no declared roles, first use honestly presents All kinds. Existing explicit filters and older saved workspaces retain their behavior. Reset scope explicitly selects All kinds; selecting a different context preserves the current kind choice. Period definitions and people remain reachable through their ordinary declared types.

A context change or All material crumb changes only context selection. It preserves applied time/text and recoverable form input. Reset scope explicitly clears filters while retaining the current query revision and fixed historical slots. Entity return and scope return preserve their respective semantic context; map extent is not a scope reset.

The same Scope selector explicitly represents All material, Unassigned material or a selected context, with the active mode repeated in the breadcrumb. Unassigned is a classification filter, not a fabricated context ID. When a context is selected, its Add material action appears once; a separate unassigned-count notice links to that view without duplicating the current context's editing action.

Historical-year input is a draft. Toggling review or locale preserves it without applying it. Show state succeeds before the displayed/resolved year changes. Checkout/A/B use the displayed state, never unapplied input. For example, entering 1370 while 1336 is displayed and then including unreviewed claims retains both facts distinctly; pinning still fixes 1336 until Show succeeds.

A slow pin validation may finish the originally requested fixed slot, but must not reopen that older state or comparison after a newer state, object or scope interaction. A newer request for the same slot supersedes its older request. Following a fixed reference also ends superseded state loading; a late response cannot leave the current controls indefinitely busy.

Ordinary object selection uses the current year when it is inside the selected numeric time window, otherwise that window's start. It does not jump to an earlier source observation outside the user's chosen scope. Explicit entity, command and fixed-reference targets retain their requested year. Checking out the displayed state also preserves an unapplied year draft. Fixed references retain their snapshot labels for both locales across recovery; changing a display label never changes object/year/OID identity.

An explicitly committed preview retains its OID when fixed. Fixing a working preview revalidates HEAD and reads the committed target/state there; if working C differs from committed B, identify the committed state being fixed rather than attaching HEAD to C. A working-only target requires a commit through Changes. Unrelated dirty research or metadata does not block an existing committed target.

Name/keyword search covers readable labels, aliases and descriptions, not opaque IDs/hashes. Numeric text remains literal text rather than an inferred year or region. Exact stable IDs remain reachable through direct references and explicit bounded commands.

### Create, assign and continue

1. **New context / 新建背景:** enter a name and optional purpose in a small workspace editor. The service generates a stable ID. Reopening that editor preserves input; Cancel creates no half-definition.
2. **Add material / 归入资料:** choose a complete saved-source selection, or use the actual complete object set returned by successful source/file adoption. Select an existing context or create one through the same editor.
3. Review distinct objects, already-in-this-context objects and added/removed memberships, together with fixed batch/source identity. Exploration filters, visible pages and preview samples must not truncate the batch. Confirm the reviewed plan explicitly.
4. Keep the active investigation after completion. Update counts, then offer View context as explicit navigation. A late result cannot change a newer scope, editor or focus.
5. Unassigned material is computed across the whole selected collection/revision. It remains searchable and explorable. If current filters hide it, retain those filters, show the actual boundary and offer Reset scope.

Membership is an independent modern working change, reviewed/staged/committed through Changes. It does not extend or rewrite the original facts-import receipt. Cancel/failure leaves already adopted facts intact. An incomplete facts import first uses existing Imports recovery; a failed classification retries only classification. Defining or assigning a context never commits automatically.

The compact context editor belongs to Library and returns to the investigation underneath it. Its selected target and definition are secondary disclosures once known; the batch selection, reviewed plan and explicit confirmation form the main flow. Preview reveals and focuses the actual plan. Close remains reachable while scrolling. Leaving retains unsaved names/purpose/selection in library-backed recovery input; Discard requires confirmation and clears only that input. A different requested target cannot silently replace an unfinished draft. Unconfirmed writes must be checked/resumed before editing or discarding their request. Normal ongoing writes show progress, not an unconfirmed-result warning.

Historical paths opens an explicit model artifact with its own scope/time coverage. Only a validated identity/scope crosswalk can transfer an object/context into that representation. Without it, show the independent artifact and preserve return to the original investigation. Do not infer a crosswalk from matching names or advertise a narrow model as the entire collection.

## Data and service boundary

The registered typed boundary is maintained in [`navigation-types.ts`](../packages/contracts/src/navigation-types.ts). Registering a type does not establish a working service or installed acceptance. Avoid collision with the existing `ResearchContext` DTO that carries research scope/evidence. The abbreviated shapes below describe the persisted meanings; the TypeScript contract defines complete request and result fields.

```ts
type DataRevision = 'working' | GitOid;
type NavigationContextDefinition = {
  schemaVersion: 1; id: string; labels: Record<string, string>;
  description?: Record<string, string>;
  origin: 'user-organization' | 'source-profile';
  profile?: { id: string; version: string };
};
type NavigationBatchRef =
  | { kind: 'adopted-import'; operationId: string; method: NavigationImportMethod;
      previewId?: string; inputHash: string; objectSetHash: string }
  | { kind: 'saved-source'; revision: DataRevision;
      selection: 'source-claim-subjects' | 'subjects-and-referenced-objects';
      sourceId: string; sourceRevision: string | null;
      sourceHash: string; selectionHash: string; objectSetHash: string };
type NavigationMembership = {
  contextId: string; objectId: string;
  decision: { kind: 'manual' | 'profile'; recordedAt: string;
    rationale?: string; profile?: { id: string; version: string } };
  batchRef: NavigationBatchRef;
  sourceRefs?: { sourceId: string; revision: string | null;
    contentHash: string; locator?: string }[];
};
```

Decision timestamps are editorial audit data, excluded from historical dates. Source/profile proposals are not effective memberships until explicitly adopted. Persist enough fixed decision/batch/source information for later reading without rerunning a mapper or retaining a renderer journal.

A saved-source batch explicitly distinguishes subjects with claims from that source from those subjects plus one hop of typed entity references. Show the selection and direct/related counts before planning; the latter is not an inferred historical or geographical membership. Batch counts come from the fixed complete set, not a prototype count, visible sample or the current exploration filters. Unavailable batches expose their structured reason rather than silently omitting missing members.

Batch summaries carry a bounded source-reference sample and a separate complete `sourceRefCount`. Source pins are reviewed on demand through `context.batchSources`, paginated against that same fixed batch reference. The interface reports the actual displayed range and full count, preserves the current page on failure, and ignores late replies after selecting another batch. Stored membership provenance is also inspectable in bounded pages; no sample is represented as the complete source or object set.

The production slice freezes the `context.*` contracts in `packages/contracts/src/navigation-types.ts`. Saved sources expose two explicit selections: `source-claim-subjects` includes subjects of claims citing that source; `subjects-and-referenced-objects` also includes existing objects reached through one typed entity value or qualifier on those claims. Counts distinguish direct subjects and related objects. Neither selection infers identity, ancestry or political scope. A successful adoption batch uses its complete accepted/reused object set, independently checked against the original prepared input where available; conflicts or an incomplete result cannot be silently classified. Visible result samples are never batch manifests.

New fact-adoption results bind an additive `batch` manifest at adoption time: schema version, complete input-object-set hash, accepted-object-set hash and the actual source IDs/revisions/content hashes. This does not change the preview fingerprint. Completed older receipts retain their original bytes and shape. Paired imports can prove their set and source pins from their existing frozen artifact; an older generic receipt without that evidence is listed as unavailable for original-batch classification. A user can explicitly review a saved-source selection instead. Current working claims or labels must never be used to reconstruct the old import's sources.

Type display metadata may supply an optional versioned navigation role (`structure`, `person`, `document`, `source-group`, `chronology-candidate`, `period-definition` or `other`). The role follows the same Git revision and field-catalog conflict rules as its labels. An absent role remains absent; neither the renderer nor a name heuristic supplies it. A role is navigation metadata, not approval of historical claims.

A host-pinned knowledge bundle may declare one optional, hash/size-checked navigation file. Its typed bootstrap contains source-profile definitions and memberships with profile decisions and fixed source references. The service supplies a stored `trusted-bundle` basis using the verified bundle ID/manifest hash and full object-set hash, then validates it against the complete prospective seed tree. This basis is readable provenance, not a user-assignable batch reference. It enters Git only during empty-repository initialization; opening or restoring an existing library does not migrate or overwrite its navigation. Older manifests without the optional file retain All material.

The same bootstrap may declare unique `typeRoles` entries for IDs already present in the final bundled field catalog. The loader rejects unknown IDs or conflicting roles and annotates only its validated in-memory catalog copy before creating the initial Git vocabulary source. Original collection shards, source records, prior field files and paired-import artifacts keep their bytes and hashes. The classification belongs to the pinned navigation input; it is not attributed to an external source that did not supply it.

| Service boundary | Required result/guard |
| --- | --- |
| `context.list/get` | Bounded definitions, hashes, members/explanations and complete-set counts at one `DataRevision`; count before pagination. Missing definitions are explicit diagnostics. |
| `context.save` | Create when ID is absent and expected hash is null; update requires ID and expected content hash. Generate IDs in the service. Guard expected HEAD and exact changed-file hashes; stable operation ID makes an uncertain retry recover the original result. |
| `context.batches/batchObjects/batchSources` | Read bounded pages from a complete fixed set. Object and source totals remain independent of the current page. |
| `context.membershipPlan` | Resolve the fixed full batch server-side, validate targets, calculate add/remove/unchanged counts and dependencies. Return durable plan ID/hash, base HEAD, metadata hashes and object-set hash. Never trust renderer counts or infer members from names. |
| `context.applyMembership` | Apply that plan with its own operation ID and CAS guards. Repeat returns the original result; it cannot overwrite a later edit. Stale input requires explicit re-review. Facts adoption is not replayed or rolled back. |
| `context.plan/pending/resume` | Read the frozen plan or recover the original typed operation. Recovery does not create a replacement facts import or membership request. |
| `knowledge.query` extension | `contextIds?` is an independent stable-ID filter: OR within contexts, AND with text/time/type filters. `unassigned?` is mutually exclusive with context IDs. Read objects and navigation metadata from the same requested revision. |
| Model artifact descriptor | The renderer derives real artifact coverage from the loaded model. A future validated context/object crosswalk may add explicit model ID/OID links; none is implemented by this slice. |

Queries and plans must remain bounded without turning a page size or the existing explicit-object query limit into a batch-size cap. Resolve full batch sets from durable accepted results or fixed saved-source selection. Do not refetch, remap with a newer profile, or treat changed/unchanged samples as the full import. GUI and commands invoke these same structured operations.

The batch manifest identifies the complete set actually adopted or reused, with unresolved matching/partial results reported separately. Unaccepted candidates do not silently become memberships; an unfinished import retains its existing recovery route. An import-result reference remains a reference to that original result, not permission to extend its receipt with classification writes.

## Persistence, revisions and CAS

Use a dedicated namespace such as `navigation/contexts/<identity-hash>/definition.json` and bounded, deterministically partitioned current-membership shards. Store the partition/schema version; paths derive from stable identity, never translated names. A disposable index may accelerate membership/counts but Git bytes remain authoritative. Incompatible records fail validation; they are not silently widened into All material.

Definition and membership writes use repository coordination, expected HEAD and exact content hashes. A prepared classification plan/operation receipt is operational state outside the Git tree; its completion writes one coherent metadata increment. Preserve it through restart and complete backup. There is no assumed filesystem/SQLite transaction spanning facts adoption and later organization.

The implementation uses one optional `navigation.sqlite` journal for immutable plans and prepared/completed definition or membership operations. The context hash covers the definition and all its membership shards. Pending operations have a typed definition/membership summary and an explicit resume route that reuses the frozen request. During an unconfirmed or partial metadata write, context and scope queries return `REVIEW_REQUIRED` with `navigation-operation-pending`; they do not present partial counts. A Working metadata read checks pending state and the write generation both before and after its complete asynchronous computation, including batch resolution. A read crossing a prepare boundary must not publish a partial snapshot even when recovery completes before the read returns. If no operation remains pending, that invalidated read returns `CONTENT_CHANGED` with `navigation-read-changed` and can be retried without suggesting a recovery operation. Fixed-OID reads remain independent of Working metadata recovery. Pending summaries, plan review, recovery, explicit object history and complete-library backup remain available. Restore must validate every partial path against its recorded baseline or expected bytes and validate the completed overlay before replacing the library. These are implementation contracts; installed acceptance remains outstanding.

Changes needs readable definition/membership summaries and semantic diffs, with IDs/raw JSON secondary. New membership targets and supporting definitions/sources must exist in the prospective staged tree. Show missing dependencies before staging; do not silently stage unrelated facts. If B is staged and the user edits metadata to C, committing records B and leaves C working. Existing committed objects need not be restaged merely because their unrelated working values changed.

A browsing recipe includes `contextIds`, query revision, time/type/text filters and return state. `working` follows current objects **and** current navigation metadata. An explicit OID reads both from that tree. Fixed historical checkout/A/B and research evidence keep their own OIDs, years and review policies independently; context rename/reassignment cannot refresh them.

Extend research scope with an optional versioned navigation recipe. Older records without it retain their existing explicit query semantics. A saved recipe may deliberately follow working data; evidence/comparison remains pinned. If a referenced context disappears, explain it and offer explicit widening or an available old revision; do not silently remove the restriction. Preserve unapplied form input and actual displayed state separately in library-backed recovery preferences.

## Commands, backup and compatibility

The bounded `scope` command family covers context list/show/create, scope selection/filter/reset, membership planning and explicit plan application. `scope use --context <id>` and `scope use --all` preserve other filters; `scope reset` explicitly clears them without changing query revision or fixed historical slots. The registered parser and help define exact syntax. Existing explicit `history --object … --revision … show|checkout|log|diff` retains its meaning; show does not checkout, and no command infers a target from the open page. No shell execution is introduced.

| Command intent | GUI equivalent and effect |
| --- | --- |
| `scope contexts [--revision <working-or-oid>]` / `scope context <id>` | List contexts / open the definition and member basis. |
| `scope create --name <text> --language <tag> [--purpose <text> --purpose-language <tag>]` | Create a definition with a service-generated ID and guarded working write. Repeat name/language pairs and purpose/purpose-language pairs to retain localized values; the older single-language purpose form remains valid. |
| `scope use --context <id> [--revision <working-or-oid>]` / `scope use --all` / `scope use --unassigned` | Change the context dimension; retain time/text/type. Revision changes are explicit. |
| `scope filter [--from <year> --to <year>] [--type <id> \| --all-types] [--text <literal>] [--review <unreviewed\|adopted\|rejected\|none>] [--include-undated \| --exclude-undated] [--include-unlocated \| --exclude-unlocated]` / `scope reset` | Apply explicit filters / deliberately clear them. Repeated type/review flags retain their explicit sets; `--all-types` and `--review none` express empty sets. Explicit false inclusion flags remain in reusable equivalent commands. No country, year or target inference from text. |
| `scope batches` / `scope assign --context <id> --batch <batch-key>` | Inspect actual available batch identities / prepare the exact membership plan. A batch key resolves to the structured fixed reference above, not an arbitrary file or source title. |
| `scope apply <plan-id>` | Confirm the displayed plan as an independent working change. Repeated/uncertain execution uses the same guarded operation, not another facts import. |

These commands are registered in `scope-commands.ts` and the existing workbench terminal. Services return structured IDs/counts/diagnostics for both interfaces; localized output is never a parser input. Read-only terminal results do not silently open a Working editor or change the browsing scope. Only an explicit scope effect patches the investigation; save/apply updates modern data without automatic navigation.

Within the existing command-size bounds, scope command literals retain quoted token identity: double quotes decode JSON string escapes, including escaped newlines/backslashes; single quotes retain text with only escaped apostrophes/backslashes decoded. Quoted flag-like values and operator characters are data passed through the same typed validation, not options or shell instructions; unquoted operators and substitutions remain unsupported. Equivalent create commands retain every localized name/purpose, and assignment rationale follows the same literal rules. The older model-domain parser retains its own supported grammar.

Complete-library backup includes committed/staged/working navigation metadata, schema/index inputs, classification plans/receipts and recoverable scope/editor state. Restore validates the new metadata before replacement and retains fixed old references. Old libraries/backups with no contexts open as All material with existing filters; migration does not invent memberships from names, language or current country boundaries. Preserve old workspace/research records rather than rewriting their historical basis. Feature/schema gates must reject unsupported newer formats before mutation; do not claim older app builds already enforce this new feature. Derived indexes can rebuild from validated data, not replace missing authoritative metadata.

The existing startup preference for opening an overview opens the current Working collection's All-material scope overview, with the initial kind choice above. It deliberately resets navigation filters and preserves historical checkout/A/B. It does not open the independently covered legacy model artifact. Resume remains the default and preserves the saved investigation. The stored legacy preference identifier is retained for compatibility.

## Required evidence before delivery

Scope acceptance uses N01–N09. Settings retains S01–S06; those checks cannot substitute for navigation evidence. The release receipt requires all nine N checks alongside the other product contracts, including Guide J06. Renaming these IDs records no passing result.

| ID | Acceptance |
| --- | --- |
| N01 | First use: choose a context, numeric period and concurrent structures without a named-object prompt; deepen and return. Period/source-group/polity types and sparse coverage remain distinct. |
| N02 | Create a context without JSON, assign an entire real adoption batch larger than visible pages, verify exact deduplicated counts and provenance. Cancel/retry classification preserves successful facts and current scope. |
| N03 | Unassigned adopted records remain in ordinary name/time/state/relationship/evidence/command paths. A different source/context works without renderer changes or a new topic page. |
| N04 | Enter 1370 while 1336 is displayed, then toggle review/locale: input survives, actual state and pins stay 1336 until Show succeeds. Test entity and scope returns too. |
| N05 | Context change/All material preserves time/text; Reset scope explicitly clears filters. Rename/reassignment, new facts and a modern commit do not change fixed historical refs. Old context/OID reads remain reproducible. |
| N06 | Stale HEAD/shards/batch sets, missing targets, failure and restart exercise CAS, exact retry and recovery. Semantic Changes shows dependencies and B-stage/C-edit correctly. |
| N07 | Complete backup/restore retains metadata, working/staged states, research/navigation recipes and pending classification. Older no-context libraries retain behavior; unsupported metadata is not silently ignored. |
| N08 | Read explicit model coverage and return; absent crosswalk never becomes implicit scope transfer. GUI/CLI agree, literal digits do not match opaque IDs, and exact-ID access remains available. |
| N09 | Render and operate both locales at target sizes/zoom with keyboard access. Review shared-element purpose, naming, hierarchy, focus and copy; synchronize editable Figma after the design is adopted. |

The local design prototype demonstrates selected interactions and exposed a year-draft defect corrected there and in the ordinary renderer. Repository-backed context editing, complete-batch classification, pending recovery, semantic Changes, research recipes and terminal scope effects now have implementation and targeted checks. A full renderer/service/Git journey using synthetic technical records establishes interaction and persistence evidence only; separate local candidate-content checks exercise real context/type/time/state/evidence. Neither replaces installed acceptance, complete backup/restore review, editable Figma synchronization or historical-content C02–C06 and release gates. No model crosswalk or complete historical coverage is claimed.
