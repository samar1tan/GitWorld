# GitWorld product requirements

Document revision **v0.6** · Product scope **v0.1** · Updated **25 October 2026**

Target: a **macOS-first local desktop history workspace**, built with a Web interface and separated domain/storage services so other desktop platforms can follow. Current phase: the first complete development loop, including a real database and usable local data management. The [data-workspace PRD](data-workspace-prd.md) and [interaction specification](data-workspace-ued.md) replace the earlier separate schema-first manager with a unified discovery, staging and commit workflow. This document defines requirements, not completed features. Existing UED work remains design input and test evidence for its actual scope.

The current integration is undergoing a focused **UED 06 consolidation**. Review found that five peer navigation entries mixed historical views, source acquisition, research records and editorial work. Their implementation modules do not establish a coherent product hierarchy. Resolve navigation, section responsibilities, shared data context and complete journeys before further expanding the visible interface. Current desktop screens and frozen UED 05 frames do not yet pass this revision.

## 1. Purpose and audience

GitWorld helps history learners organize and investigate change through states, commits, branches, comparison and provenance. Users begin with a world-scale setting, choose a useful period and scope, follow processes into specific changes, and return with context intact. Git × World is the product's core, not a timeline with decorative hashes.

Exploring China and Japan across their histories is one starting point for this product. Their ancient-to-present histories now form the [complete v0.1 software acceptance case](acceptance/china-japan-v0.1.md), including acquisition, learning, contribution and recovery. Tang-period relations are one deep investigation within that case.

The primary capability is automatic, inspectable mapping from structured historical sources into dated assertions, states and change candidates, explored through familiar Git operation logic. Modern data revisions are an auxiliary software version system. Historical evolution and data revision history must retain distinct terminology and interface regions.

The initial audience has some programming or AI-tool experience. Git fluency is not assumed. Every core journey has a GUI route and an adaptable command route. Longer-term collaboration and new civilization branches can build on these objects; they are not automatically counterfactual or part of this release.

The first development loop must produce a useful desktop application and a sustainable content workflow. A fixed example collection, a management dashboard without editing, or a static client bundle masquerading as a database does not meet that goal.

The main repeated learning loop is **question/scope → acquire and adopt a useful collection → inspect and compare → trace evidence → save a provisional understanding → commit → return and revise**. The [learning workflow](learning-workflow.md) defines the user outcome, the role of Git and the required versioned research record. A raw archive alone does not establish useful historical coverage.

This release is a conventional, self-sufficient desktop application. Users have the installed app, not Codex, an LLM account, a development checkout or an assistant supplying missing content and operations. All core journeys must work through the shipped interface and bounded commands. Public-source discovery may require a network connection; local exploration, editing and recovery must not require model inference or a public application server. A developer script or agent intervention is engineering evidence, not proof of a usable product journey.

## 2. Goals and boundaries

Goals: world-scale orientation; meaningful before/after and cross-subject comparison; distinguish continuity, splitting, integration and influence; inspect evidence and uncertainty; freely combine supported commands; maintain and publish content without changing code; install and use the application locally with persistent, recoverable data.

Non-goals: exhaustive world history, definitive academic adjudication, precise territorial reconstruction everywhere, arbitrary shell execution, counterfactual simulation, online multiuser collaboration, accounts/payments, and AI-generated history. AI has no visible entry until it supports a working flow. The [desktop distribution PRD](desktop-distribution-prd.md) defines this release's primary Apple Silicon delivery, native Intel and Ubuntu 22.04 x64 experiments, and deferred Windows port. An experimental CI result does not establish complete installed acceptance or support on another system.

Historical queries are read-only operations over selected content. **Import, editing, staging and commit are first-class operations in the same workspace.** A commit records changes to the authored historical model and advances the sole data-repository HEAD; it does not claim that a modern edit changed past events. Stable release/export is optional distribution, not a mandatory step for each local commit.

## 3. Historical and version model

The smallest independently reviewable content unit is a historical assertion: a subject, property or relation, value or participants, temporal and other qualifiers, evidence and review status. The main exploration unit is an object's state and its changes. Objects can include polities, places, institutions, people and material objects; a modern nation-state is not the universal container. Historical paths express explicitly supported continuity, divergence or integration. Views are queries over shared content, not the unit of data ingestion. See the [data model and production-to-consumption contract](data-model.md), including current implementation gaps.

| Object | Required meaning |
| --- | --- |
| Dataset release | Immutable manifest linking historical objects, sources, coverage, tags and overview content. |
| Historical state/transition | A modeled historical state with domain parent IDs, historical time, field changes, state hash, evidence and modeling notes. |
| Editorial commit | A frozen staged content tree, editorial parent, author/time and purpose; advances the data repository HEAD/current branch. |
| Blob and tree | Immutable field/content objects and a stable path-to-object state tree. |
| Historical path/reference | A named modeled continuity path/reference. Scope groups and modern countries are not automatically ancestors. |
| Editorial branch/ref | A pointer into the data repository's commit history, distinct from a historical continuity path. |
| Tag | A stable recorded milestone; a period label does not assert complete period coverage. |
| Cross-link | A typed, dated and sourced contact/influence relation separate from ancestry. |
| Draft and publication audit | Editable content based on a release, validation state and modern editorial history. |

The world is a navigation container with multiple roots. Parent edges express an explicitly modeled continuation, split or integration, not universal biological descent or sufficient historical causation. The parent graph must be acyclic. Influence/contact may form networks; traversal is bounded and does not participate in merge-base computation.

Replaying a historical state's changes against its selected parent state must reproduce its recorded tree hash. Multiple parents require explicit field resolutions: retain from a named parent, introduce a sourced value, record supported absence, or retain an unknown. Conflicting values or origins cannot be silently resolved by parent order. A conquest/integration must not be portrayed as a voluntary merger.

Fields carry stable semantic values, knowledge status, applicability, evidence and notes. Missing entry, supported absence, inapplicability, inference and disagreement remain distinguishable. Equal endpoint values do not mean an unchanged intervening history. Inheritance is model reuse, not fresh historical confirmation.

Separate **baseline/observation** from an evidenced historical **transition**. Reaching the initial observation with blame does not identify an institution's origin. Source metadata used by an old release must remain fixed with that release; mutable source titles or rewritten overview objects must not alter past results.

Historical time is separate from editorial/Git author time. Support BCE/CE, approximate dates and intervals with explicit precision/calendar conventions. Display 1 BCE followed by 1 CE, never a historical year zero. As-of resolution returns the latest eligible unambiguous recorded state, echoes requested and recorded dates, and enforces the branch's query boundary. Overlapping uncertain candidates produce ambiguity or a supported interval result, never an invented midpoint.

Use shared field definitions where comparisons are meaningful. Do not force every polity into a singular-capital model or treat a shared field path as proof of equivalent institutions. `politics.capital` is displayed as Court residence; `politics.condition` is Recorded context.

## 4. Exploration experience

### Workbench activities and shared context

The workbench has two primary activities: **Explore / 探索** for historical investigation and **Library / 资料库** for the material and modern revisions that support it. Research records are independently reopenable documents within Explore; Find data is a contextual acquisition action and Library resource; Changes is Library's contribution workflow. Settings and Guide are utilities. The [UED06 design](UED.md) defines their stable regions, shared context and return behavior.

| Capability | Product role and relationship |
| --- | --- |
| Historical paths | A relational view of supported historical states and continuity. It shares scope, time, selection and evidence with the other historical views. |
| Objects and states | The subjects and dated knowledge being investigated. Object navigation, the map, the state inspector and comparison are parts of the historical workspace. |
| Find data | An acquisition task reached from collection maintenance or a concrete coverage gap in exploration. Preserve the originating query and provide a return to the resulting historical content. |
| Research records | User-authored questions, scope, fixed evidence/comparisons, interpretation and unresolved items. They remain accessible from the investigation and can be reopened independently. |
| Changes | Review, frozen staging and commit of modern collection edits. The global pending-change indicator leads here; it is not a historical view or a second history HEAD. |
| Settings and guidance | Supporting utilities with clear entry and return behavior. They preserve the investigation and unfinished input. |

The repeated path is **explore → identify a coverage or modeling gap → acquire or correct → review and commit → return to exploration → retain and revise understanding**. Acquiring data is optional when the local collection already supports the question. Saving a research record is useful without requiring an immediate commit.

Research scope restoration preserves explicit objects and field focus as well as the name query and time window. An empty name query does not remove a saved object restriction. The reopened scope recipe follows working data, while evidence and comparison references remain independently pinned. Restored restrictions are visible and can be widened explicitly. Current-evidence actions use the actual investigation being left; completion of an earlier background task must preserve a later navigation choice.

All these capabilities use the same local data repository and explicit historical references. An imported structured object must enter the same applicable views as installed content. Two legacy readers placed under one menu do not satisfy this requirement. Model-package import/publication must produce inspectable working changes before the same staging/commit workflow; a SQLite publication cannot silently become a Git revision. Collection changes must not replace pinned historical states or A/B.

Every visible element has a maintained purpose, name, form, relationship and interaction contract. UED covers navigation levels and context transitions as well as spacing, type and controls. A periodic deflation review exercises the complete installed journey in both locales and at target sizes, then removes accumulated visual, behavioral, code and documentation inconsistency. See the [quality loop](governance/quality-loop.md).

### Historical exploration

The first screen offers a coherent period, geographic/subject orientation, ongoing processes, coverage and a way to focus. It is neither an empty terminal nor a mandatory case chooser. A world view needs higher-level content rather than a reduced-size event graph.

Time interval, explicit time point, geographic/subject scope, thematic focus and analytical detail are separate dimensions. Changing map zoom does not silently change time. Navigation may move from overview to a cross-regional process, not only through a world/continent/country hierarchy.

The workbench distinguishes repository HEAD/current editing branch from historical browsing context, preview, checked historical state and fixed A/B. A commit advances repository HEAD. `history show` previews, `history checkout` pins a historical state, and `history diff` pins endpoints with their repository revisions. Browsing and commits do not silently re-resolve these historical references. There is no second unqualified HEAD.

Use a light, extensible editor layout: near-black canvas, dark-gray panels and blue selection accents. Do not introduce a green-led theme. A stable historical branch area, compact checked-state position, editing branch/Changes entry and discoverable terminal establish the Git model through effects. Graph/state/comparison reuse the main area; unsupported features receive no placeholder controls.

Use spatial, temporal and relational views where each is useful. Graph edges have types and explanatory evidence; unequal year spacing is explicit. Sources and detailed model notes are progressively disclosed. Both English and Simplified Chinese must work at 1440×900 and 1280×800 with keyboard access and no page-wide horizontal overflow.

## 5. Journeys and content depth

The shared journey is **overview → self-selected scope → process → state/change/relationship → evidence → return or lateral exploration**. Users can search directly when they already know a subject. Cases validate depth inside this setting; they do not substitute for the setting itself.

New users receive optional, resumable guidance and contextual tips through the real investigation and acquired-data workflows. Progress follows successful results rather than simulated clicks. [Onboarding requirements](onboarding-prd.md) define the behavior and acceptance. [Settings requirements](settings-prd.md) cover reading/learning preferences, a local contributor identity and library maintenance; these settings do not create historical events or data commits.

| Journey | Required investigation |
| --- | --- |
| Mediterranean and Europe | Distinguish Roman continuity from separately modeled Frankish history; follow Carolingian common history into the three Verdun outcomes, compare successors and return to the common parent. |
| West Asia and Iberia | Follow Abbasid change and the related Umayyad continuation in al-Andalus; retain a chosen time while comparing with Europe and following sourced external relationships. |
| East Asia | Inspect a sourced multi-parent political integration, then distinguish it from Tang/Japanese and Korean-peninsula cultural contacts; inspect field-level borrowing and modification. |

The required installed content now includes a substantive China-and-Japan collection from evidenced ancient coverage to the present, with continuity, important parallel polities, divisions, integrations and changes of political/institutional structure. The Tang-period connections with Japan are a principal semantic acceptance investigation and require depth beyond a few isolated events. An explicit coverage inventory must identify periods, subjects, relations, evidence, disputed boundaries and gaps; ancient and modern China/Japan are not assumed to be timeless nation-state entities. Political succession and cross-cultural borrowing retain distinct relation types.

This collection must enter through the same mapping, validation, version and query paths available to user-imported data. It must not require region-specific renderer code or scripted command replies. All product-authored installed presentation is bilingual. The earlier 38-version engineering seed is not sufficient evidence for this expanded requirement. Release readiness still includes meaningful before/after states, parallel comparisons, split/integration/influence cases and temporal edge cases; counts alone do not pass.

South Asia, Southeast Asia, Africa, the Americas and Oceania remain visible geographic context where content is absent. Missing coverage never means no history. No universal 1648 breakpoint or uniform nation-state ontology is imposed.

## 6. Commands and shared state

The bounded interpreter and GUI invoke typed domain operations over the same workspace. Standard Git editing operations manage the data repository; explicit `history` operations inspect modeled historical content. No pipes, redirection, command substitution or arbitrary shell execution. Results contain objects, error codes and parameters, not prose used as business identifiers.

| Required operation | Example / behavior |
| --- | --- |
| Historical help/status | Syntax, active dataset, browsing interval/point, selection, the checked historical state and fixed A/B. |
| search | Localized names resolve to stable subject/event/tag IDs. |
| branch/tag | Enumerate available references; scoped and all-branch access. |
| checkout | `history checkout francia/west@850`; show requested and recorded dates. |
| log | Bare branch means its complete recorded path; a version means that version's ancestry. Graph and output agree. |
| show | Preview a historical state/event; multi-result events return candidates without silent selection. |
| diff | `A B` and `A..B` compare endpoints; `A...B` compares a common base to B and is asymmetric. |
| blame | Trace a field's last recorded change or baseline and evidence, without claiming ultimate origin. |
| trace | Follow a typed influence/contact relation separately from ancestry. |
| scope/time/return | Documented command or typed-intent equivalents for meaningful browsing actions; layout panning does not need pixel-by-pixel commands. |

Historical refs include `branch@date`, `state:id`, `event:id`, `tag:id` and an explicit checked-state alias in the `history` command namespace. Date syntax includes `BCE:year`. A bare historical branch used as a snapshot requires an explicit point or date. A time interval is insufficient to invent one. An unset checked-state reference returns a helpful error rather than automatically selecting a sample. Repository revisions and historical identities are typed separately, and fixed historical references retain both.

Two endpoints need no common ancestor. Three-dot diff with no base returns `NO_COMMON_BASE`; multiple best bases require explanation and an endpoint-comparison alternative, not an arbitrary base choice. Only parent edges count toward ancestry.

Completion enumerates real data; history and clickable/keyboard-accessible results support iteration. GUI equivalents are labeled as GUI actions, not replayed as user input. Failed commands preserve the workspace. Requests carry dataset/revision IDs; late stale responses cannot replace newer state. Persist semantic workspace references, not ambiguous aliases or an entire terminal transcript.

Repository commands include `git status`, `git diff`, `git diff --staged`, bounded staging/unstaging, `git commit`, branch switching and editorial `git log`. Stage freezes selected content; commit advances the same branch and sole HEAD. Commands never infer their meaning from the selected panel. Conflicting UED05 aliases must show explicit migration guidance. The module PRD specifies partial staging, dependency review, historical reference pins and failure recovery.

## 7. Data acquisition and contribution loop

The [data-workspace PRD](data-workspace-prd.md) is the detailed contract: **discover → fetch a bounded scope → reconcile/map → review working changes → stage → commit → inspect → refresh/correct**. Manual additions and imported candidates use the same Changes view and typed write operations.

Users search names and scopes rather than providing external numeric IDs. The first planned structured source is Wikidata, with versioned evidence reading and later ancient-place reconciliation. Source records, candidate claims and modeled historical states are distinct; bulk metadata must not automatically generate fabricated branches. Jobs are durable, resumable and rate-aware. Ordinary CSV needs column mapping, not embedded schema JSON.

Stage freezes selected content, including visible required dependencies. Commit records a valid tree atomically and advances the sole repository HEAD; further unstaged edits remain. Local unreviewed material can be retained with explicit status without being presented as confirmed historical state. Public sharing/release adds a separate rights and evidence gate. Personal backups and local research are not public publication.

The default successful action is Commit and view: locate changed historical content or material in the same workbench. Existing fixed historical references/A/B retain their original revision. Corrections, source refresh and three-way conflict resolution must preserve user choices and reproducible older content.

A successful save that disappears after restart fails. A data manager requiring schema knowledge or preset source IDs fails. A search interface limited to installed examples fails. A backend error followed by silent fixture fallback fails. A backup button without demonstrated restore fails.

## 8. Desktop, storage and interface boundaries

The macOS artifact must include its required runtime and local service; ordinary users do not install Node, Git or a development server. Declare tested architecture/system versions and actual signing/notarization status. A local build is not evidence of execution on another machine.

Keep application resources separate from user data. Use an application-data directory, one-time initialization that never overwrites an existing library, schema/version checks, and recoverable migrations. Clean quit, abnormal restart and update paths preserve content. Core exploration and editing work offline; external original-source pages may require network access.

The current implementation uses SQLite for content-addressed objects and indices. The new editing workflow requires an integration experiment comparing an embedded standard Git implementation for the index/commits/refs with the existing store. SQLite remains suitable for query indices, jobs and caches. External Git clients are not a hard requirement; installed operation must remain self-contained. Do not decide this solely from sunk implementation cost or claim atomicity across Git refs and SQLite without a recovery protocol. Historical date metadata is independent of native Git timestamps and ref names.

The renderer owns layout and user interaction; a typed local service owns validation, querying and publishing. The accepted implementation uses typed IPC and an Electron utility service; a future transport adapter can preserve the same contract. See [ADR 0001](adr/0001-desktop-local-data.md). The renderer must not receive arbitrary SQL/shell access. HTTP write endpoints, if used, must not accept arbitrary external web-page requests; IPC uses an explicit allowed interface. Packaging, filesystem access and database drivers remain replaceable for future platforms.

Responses include dataset version, request ID, resolved refs, structured results/errors and deliberate view effects. Management interfaces cover drafts, validation, preview, publication/release selection, import/export, backup and restore. Unavailable service/data states are explicit; no competing fixture database silently answers a failed request.

## 9. Language, evidence and copy

All product-authored starter content shipped in the installer must present complete English and Simplified Chinese, with natural wording reviewed in the rendered application. This covers navigation, object/state titles, field/value labels, explanations and modeling notes. Original bibliographic titles and quotations retain their original language with appropriate translated presentation; translations must not be represented as original quotations. External records imported by users may retain their source language with an explicit fallback indication.

All interface states, administration, accessibility labels and command output support English and Simplified Chinese. Use stable semantic keys, typed interpolation and locale-aware formatting. Historical content is English-first; missing Chinese content falls back to clearly indicated English. Source titles and original language remain intact.

UI messages, historical objects/translations/evidence, and runtime state are separate. Wording-only changes do not change routing, command semantics or identifiers. Copy identifies an object, explains a specific finding, clarifies state or helps the next action. Avoid promotional slogans, redundant instructions, empty future-feature notices and repeated explanations of visible controls.

Each published historical claim/relationship needs appropriate evidence and locators; model compression is explained. Do not fabricate precise borders, civilizational scores, cultural percentages or origins. Quote source material only when appropriate and permitted; a citation is not permission to redistribute an entire work.

## 10. Priority and delivery rules

**P0 includes the complete set in §11, M01–M15 in the data-workspace PRD, J01–J06 in the onboarding PRD, S01–S06 in the settings PRD, N01–N09 in the scope-workspace PRD and C01–C12 in the China/Japan case:** the repeated learning workflow, a small versioned research record, exploration, full version/command semantics, desktop runtime, dynamic database, content management, publication, correction, persistence and recovery. The UED05 subset is not the release definition.

Every module-level change and agent-conceived product feature iteration needs a corresponding PRD. Create or update UED when the PRD does not settle the interaction, when the user requests it, or when the change is larger than a module. Apply mature-software standards to the promised v0.1 scope: a coherent independently usable installed product, clear feedback and recoverable failures. Passing a build or a subset of tests does not establish this outcome.

**P1:** broader geography/periods, richer geographic layers, semantic search, general-purpose note organization, more complex multi-base interaction, teaching-route export and richer scholarly-review workflows. The minimal question/evidence/comparison/revision record and local editorial audit are already P0.

Retain design-system and Figma alignment as the implementation evolves. Do not treat a document update as evidence that design files or code are synchronized. Ship runnable code, installation and development instructions, data/schema contracts, source notes, test results, package evidence and explicit unverified items. No unused controls should advertise missing functionality.

### Final delivery artifacts

The first development loop is delivered through the project's GitHub repository, version tag and downloadable macOS installer. Completion requires all of the following:

1. Reviewed implementation and public documentation are committed, pushed and merged into `main` through a pull request, with required project checks passing. Private working material remains excluded.
2. A release tag identifies the exact accepted source commit. Build the installer from that clean revision and record the source commit, dependency lock, target platform and build evidence; do not tag an unrelated commit after packaging local changes.
3. A published GitHub Release for that tag contains the complete DMG, its SHA-256 checksum and release notes. The DMG includes the required runtime and has passed actual installation, launch, persistence and recovery checks on the declared macOS version and architecture. State signing/notarization truthfully.
4. Installation instructions, known limitations, acceptance evidence and applicable dependency/data notices accompany the release. The project website links to the same verified release asset and checksum.

An internal build, draft PR, source push, tag alone or locally generated DMG is an intermediate artifact. The data-workspace acceptance requirements remain part of this delivery contract; creating a release does not waive unfinished product work. The final handoff supplies the merged source/PR link, tag, Release page and direct installer download.

## 11. Acceptance matrix

Apply the [acceptance evidence contract](acceptance/evidence.md): exact-installer user journeys and separately identified fault/protocol/compatibility regressions jointly establish the required results. Engineering evidence never substitutes for the standalone installed investigation.

Every row records build/revision, environment, dataset release, actual steps and evidence. These are required outcomes, not current pass claims.

| ID | Task | Pass condition |
| --- | --- | --- |
| D01 | Install and restart | Packaged app starts on the declared macOS/architecture without developer tooling; content and semantic workspace persist after restart. |
| D02 | Dynamic addition | A new source, subject, field/version and process mapping entered through management become searchable, completable and explorable after adopting and committing without a build. |
| D03 | Correct published content | A new editorial commit reflects correction; an old pinned release keeps its original states, sources and A/B results; editorial reason is retained. |
| D04 | Draft and transaction isolation | Drafts do not enter published exploration; invalid references/cycles/evidence/merge choices cannot publish; interruption leaves no partial visible release. |
| D05 | Usable administration | Routine source/value/knowledge-state/parent/link/tag/coverage editing requires no JSON authoring; imports provide preview and field/object errors. |
| D06 | Export and recovery | Restore into an empty library and verify releases/hashes/sources/drafts; reject corrupt/incompatible input without damaging existing data. |
| D07 | Genuine version model | Immutable canonical objects, deterministic replay and tree diff; sourced split, multi-parent integration ledger and separate influence case all work. |
| D08 | Complete query contract | All §6 repository/history operations, partial staging, HEAD advancement, double-/three-dot semantics, absent/multiple bases, event ambiguity and GUI/CLI equivalence are verified. |
| D09 | Time and evidence limits | BCE/CE display, approximate/interval dates, ambiguity, as-of date echo, baseline-vs-origin and missing-vs-absence behave correctly. |
| D10 | Coherent exploration | Overview → self-selected scope → process → version/relation → evidence → return works in both locales, preserving the checked historical state/A-B and recovering from errors. |
| D11 | Package and runtime boundary | Record OS/architecture/signing/notarization/data path; launch actual package; no unexpected network dependency or exposed remote writes. |
| D12 | Upgrades | Initialization never replaces existing data; schema migration has backup/failure recovery; app updates and dataset releases are distinct. |
| D13 | Unscripted investigation | Add an object absent from the delivery script, then combine its refs/fields freely; no fixed sample-ID limits or prepared-answer matching. |
| D14 | Readable desktop layout | Review both locales at ordinary, small and larger window sizes, and at 200% interface zoom. Ordinary text remains 14–15 CSS px at actual size, secondary text at least 12 px; panels reflow or scroll without hiding essential controls. Window geometry and zoom persist and adapt to a changed display. |

| D15 | Complete China/Japan case | C01–C12 pass across the full ancient-to-present coverage and installed workflow; Tang relations are one deep investigation within the case. |

Further engineering checks: snapshot/tree hash agreement; source and parent integrity; unchanged inputs during pure queries; stale-response suppression; safe bounded cross-link traversal; deterministic release/reference resolution; no shell invocation from exploration; layout and keyboard review at both target sizes.

Initial user-study target: five target users, including people less familiar with Git. At least four should orient and choose a scope without a named-event prompt, return from detail, explain a real diff, distinguish parent from influence, and distinguish browsing, the checked historical state/A-B, and repository HEAD. At least three should pursue a question outside the supplied route. These targets need calibration; no user-validation claim is made without observed participants. Automated checks, content review, desktop testing and user learning are separate evidence.

## 12. Risks and decisions still requiring evidence

- Git familiarity, learning benefit and continued engagement are hypotheses requiring observation.
- Sparse content can create false continuity. Preserve gaps, recorded dates and baseline semantics rather than filling every field.
- A common schema can flatten non-equivalent institutions. Add applicability and precise definitions before adding more fields.
- Geographic context must not imply historical control or comprehensive coverage.
- Content quantity cannot rescue an unusable editor or fragmented exploration flow.
- A same-name developer product exists; use a precise subtitle and evaluate public naming deliberately. No automatic rename or domain purchase is authorized by the research finding.
- Performance claims require measured hardware, dataset and latency distributions. Synthetic scale tests must not be displayed as historical facts.

The source-based decisions and limitations are detailed in [Product assessment](research/product-assessment-response.md). Existing sample evidence remains in [Historical sources](../prototype/HISTORY_SOURCES.md). The PRD evolves with product understanding; changes must update related requirements, designs, implementation work and acceptance evidence without introducing artificial phase gates.
