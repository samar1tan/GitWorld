# GitWorld product requirements

Document revision **v0.3** · Product scope **v0.1** · Updated **25 October 2026**

Target: a **macOS-first local desktop history workspace**, built with a Web interface and separated domain/storage services so other desktop platforms can follow. Current phase: the first complete development loop, including a real database and usable local data management. This document defines requirements, not completed features. Existing UED work remains design input and test evidence for its actual scope.

## 1. Purpose and audience

GitWorld helps history learners organize and investigate change through states, commits, branches, comparison and provenance. Users begin with a world-scale setting, choose a useful period and scope, follow processes into specific changes, and return with context intact. Git × World is the product's core, not a timeline with decorative hashes.

The initial audience has some programming or AI-tool experience. Git fluency is not assumed. Every core journey has a GUI route and an adaptable command route. Longer-term collaboration and new civilization branches can build on these objects; they are not automatically counterfactual or part of this release.

The first development loop must produce a useful desktop application and a sustainable content workflow. A fixed example collection, a management dashboard without editing, or a static client bundle masquerading as a database does not meet that goal.

## 2. Goals and boundaries

Goals: world-scale orientation; meaningful before/after and cross-subject comparison; distinguish continuity, splitting, integration and influence; inspect evidence and uncertainty; freely combine supported commands; maintain and publish content without changing code; install and use the application locally with persistent, recoverable data.

Non-goals: exhaustive world history, definitive academic adjudication, precise territorial reconstruction everywhere, arbitrary shell execution, counterfactual simulation, online multiuser collaboration, accounts/payments, and AI-generated history. AI has no visible entry until it supports a working flow. Windows/Linux are future distribution targets, not claimed supported platforms before testing.

Exploration is read-only. **Local content management is writable and in scope.** Historical editing updates authored knowledge; it does not let a learner rewrite the past through `git commit` or `git merge` commands.

## 3. Historical and version model

| Object | Required meaning |
| --- | --- |
| Dataset release | Immutable manifest linking historical objects, sources, coverage, tags and overview content. |
| Commit | A recorded modeled state with parent IDs, historical time, change set, resulting tree hash, evidence and modeling notes. |
| Blob and tree | Immutable field/content objects and a stable path-to-object state tree. |
| Branch/ref | A named historical reading path/reference. Scope groups and modern countries are not automatically ancestors. |
| Tag | A stable recorded milestone; a period label does not assert complete period coverage. |
| Cross-link | A typed, dated and sourced contact/influence relation separate from ancestry. |
| Draft and publication audit | Editable content based on a release, validation state and modern editorial history. |

The world is a navigation container with multiple roots. Parent edges express an explicitly modeled continuation, split or integration, not universal biological descent or sufficient historical causation. The parent graph must be acyclic. Influence/contact may form networks; traversal is bounded and does not participate in merge-base computation.

Replaying a commit's changes against its selected parent state must reproduce its recorded tree hash. Multiple parents require explicit field resolutions: retain from a named parent, introduce a sourced value, record supported absence, or retain an unknown. Conflicting values or origins cannot be silently resolved by parent order. A conquest/integration must not be portrayed as a voluntary merger.

Fields carry stable semantic values, knowledge status, applicability, evidence and notes. Missing entry, supported absence, inapplicability, inference and disagreement remain distinguishable. Equal endpoint values do not mean an unchanged intervening history. Inheritance is model reuse, not fresh historical confirmation.

Separate **baseline/observation** from an evidenced historical **transition**. Reaching the initial observation with blame does not identify an institution's origin. Source metadata used by an old release must remain fixed with that release; mutable source titles or rewritten overview objects must not alter past results.

Historical time is separate from editorial/Git author time. Support BCE/CE, approximate dates and intervals with explicit precision/calendar conventions. Display 1 BCE followed by 1 CE, never a historical year zero. As-of resolution returns the latest eligible unambiguous recorded state, echoes requested and recorded dates, and enforces the branch's query boundary. Overlapping uncertain candidates produce ambiguity or a supported interval result, never an invented midpoint.

Use shared field definitions where comparisons are meaningful. Do not force every polity into a singular-capital model or treat a shared field path as proof of equivalent institutions. `politics.capital` is displayed as Court residence; `politics.condition` is Recorded context.

## 4. Exploration experience

The first screen offers a coherent period, geographic/subject orientation, ongoing processes, coverage and a way to focus. It is neither an empty terminal nor a mandatory case chooser. A world view needs higher-level content rather than a reduced-size event graph.

Time interval, explicit time point, geographic/subject scope, thematic focus and analytical detail are separate dimensions. Changing map zoom does not silently change time. Navigation may move from overview to a cross-regional process, not only through a world/continent/country hierarchy.

The workbench distinguishes browsing context, preview selection, checked-out **HEAD**, and fixed comparison endpoints **A/B**. Preview changes selection; checkout changes HEAD; comparison resolves A/B without moving HEAD. Browsing, time changes and return navigation preserve fixed endpoints. Publishing a release does not silently re-resolve a saved workspace.

Use a light, extensible editor layout: near-black canvas, dark-gray panels and blue selection accents. Do not introduce a green-led theme. A stable branch area, compact HEAD position and discoverable terminal establish the Git model through effects. Graph/state/comparison reuse the main area; unsupported features receive no placeholder controls.

Use spatial, temporal and relational views where each is useful. Graph edges have types and explanatory evidence; unequal year spacing is explicit. Sources and detailed model notes are progressively disclosed. Both English and Simplified Chinese must work at 1440×900 and 1280×800 with keyboard access and no page-wide horizontal overflow.

## 5. Journeys and content depth

The shared journey is **overview → self-selected scope → process → state/change/relationship → evidence → return or lateral exploration**. Users can search directly when they already know a subject. Cases validate depth inside this setting; they do not substitute for the setting itself.

| Journey | Required investigation |
| --- | --- |
| Mediterranean and Europe | Distinguish Roman continuity from separately modeled Frankish history; follow Carolingian common history into the three Verdun outcomes, compare successors and return to the common parent. |
| West Asia and Iberia | Follow Abbasid change and the related Umayyad continuation in al-Andalus; retain a chosen time while comparing with Europe and following sourced external relationships. |
| East Asia | Inspect a sourced multi-parent political integration, then distinguish it from Tang/Japanese and Korean-peninsula cultural contacts; inspect field-level borrowing and modification. |

The proposed engineering seed budget is approximately 18 subjects/branch references and 36–48 event versions across these journeys. This is planning guidance, not a quota, current completion claim or permanent cap. Initial migration may start with the existing 8 branches/28 versions. Release readiness requires coherent investigations, a real split, a real multi-parent integration, a separate influence case, concurrent comparison and temporal edge cases; counts alone do not pass.

South Asia, Southeast Asia, Africa, the Americas and Oceania remain visible geographic context where content is absent. Missing coverage never means no history. No universal 1648 breakpoint or uniform nation-state ontology is imposed.

## 6. Commands and shared state

The bounded interpreter and GUI invoke one typed domain executor. It accepts historical queries, not shell commands. No pipes, redirection, command substitution or arbitrary writes. Results contain objects, error codes and parameters, not prose used as business identifiers.

| Required operation | Example / behavior |
| --- | --- |
| help/status | Syntax, active dataset, browsing interval/point, selection, HEAD and fixed A/B. |
| search | Localized names resolve to stable subject/event/tag IDs. |
| branch/tag | Enumerate available references; scoped and all-branch access. |
| checkout | `git checkout francia/west@850`; show requested and recorded dates. |
| log | Bare branch means its complete recorded path; a version means that version's ancestry. Graph and output agree. |
| show | Preview a commit/event; multi-result events return candidates without silent selection. |
| diff | `A B` and `A..B` compare endpoints; `A...B` compares a common base to B and is asymmetric. |
| blame | Trace a field's last recorded change or baseline and evidence, without claiming ultimate origin. |
| trace | Follow a typed influence/contact relation separately from ancestry. |
| scope/time/return | Documented command or typed-intent equivalents for meaningful browsing actions; layout panning does not need pixel-by-pixel commands. |

Refs include `branch@date`, `commit:id`, `event:id`, `tag:id` and an established `HEAD`; date syntax includes `BCE:year`. A bare branch used as a snapshot requires an explicit current point or a date. A time interval is insufficient to invent one. No HEAD means a helpful unset-state result, not automatic checkout of a sample.

Two endpoints need no common ancestor. Three-dot diff with no base returns `NO_COMMON_BASE`; multiple best bases require explanation and an endpoint-comparison alternative, not an arbitrary base choice. Only parent edges count toward ancestry.

Completion enumerates real data; history and clickable/keyboard-accessible results support iteration. GUI equivalents are labeled as GUI actions, not replayed as user input. Failed commands preserve the workspace. Requests carry dataset/revision IDs; late stale responses cannot replace newer state. Persist semantic workspace references, not ambiguous aliases or an entire terminal transcript.

## 7. Local data-management workflow

The local manager must support routine work through forms and selectors, with a structured import/export path for bulk work. A raw JSON textarea alone is insufficient.

1. **Create/import a draft** based on a published dataset or a new library. Persist drafts independently of normal exploration.
2. **Edit** sources, subjects, field definitions/applicability, values, historical dates, commits/parents, integration choices, influence/contact links, tags, coverage and overview/process mappings. Source records retain original language, attribution, URL and specific locator/checking notes; record applicable reuse terms for imported material.
3. **Validate** stable IDs, references, parent cycles, time constraints, required evidence, merge resolutions, schema versions and overview consistency. Errors identify objects/fields and block publication. Editorial judgments need reasons; automated validation is not scholarly review.
4. **Preview** reconstructed states and publication differences using the same domain engine as exploration. Mark draft previews explicitly.
5. **Publish atomically** with a release note and frozen manifest/objects. Stale-base edits or failed writes preserve the previous release. Normal queries cannot observe half a publication.
6. **Explore the new release** without source edits, application rebuilding or reseeding. Search, completion, graphs, snapshots and source panels all query that release. Existing workspaces remain pinned until the user explicitly changes release.
7. **Correct and recover** through a new draft/release, modern editorial audit, structured export and consistent backup. Restore into an empty library and verify data. Restoring a default-release pointer does not rewrite immutable history. Prevent deletion of objects still referenced by retained releases.

A successful save that disappears after restart fails. A dashboard that cannot add a new subject fails. A backend error followed by silent static-data fallback fails. A backup button without a demonstrated restore fails.

## 8. Desktop, storage and interface boundaries

The macOS artifact must include its required runtime and local service; ordinary users do not install Node, Git or a development server. Declare tested architecture/system versions and actual signing/notarization status. A local build is not evidence of execution on another machine.

Keep application resources separate from user data. Use an application-data directory, one-time initialization that never overwrites an existing library, schema/version checks, and recoverable migrations. Clean quit, abnormal restart and update paths preserve content. Core exploration and editing work offline; external original-source pages may require network access.

Default storage recommendation: SQLite with immutable content-addressed objects, manifests, parent/ref/tag indices, editable drafts and audit records. Native Git remains technically possible; the SQLite preference follows local transaction and operations needs. Historical date metadata is independent of native Git timestamps and ref names.

The renderer owns layout and user interaction; a typed local service owns validation, querying and publishing. The accepted implementation uses typed IPC and an Electron utility service; a future transport adapter can preserve the same contract. See [ADR 0001](adr/0001-desktop-local-data.md). The renderer must not receive arbitrary SQL/shell access. HTTP write endpoints, if used, must not accept arbitrary external web-page requests; IPC uses an explicit allowed interface. Packaging, filesystem access and database drivers remain replaceable for future platforms.

Responses include dataset version, request ID, resolved refs, structured results/errors and deliberate view effects. Management interfaces cover drafts, validation, preview, publication/release selection, import/export, backup and restore. Unavailable service/data states are explicit; no competing fixture database silently answers a failed request.

## 9. Language, evidence and copy

All interface states, administration, accessibility labels and command output support English and Simplified Chinese. Use stable semantic keys, typed interpolation and locale-aware formatting. Historical content is English-first; missing Chinese content falls back to clearly indicated English. Source titles and original language remain intact.

UI messages, historical objects/translations/evidence, and runtime state are separate. Wording-only changes do not change routing, command semantics or identifiers. Copy identifies an object, explains a specific finding, clarifies state or helps the next action. Avoid promotional slogans, redundant instructions, empty future-feature notices and repeated explanations of visible controls.

Each published historical claim/relationship needs appropriate evidence and locators; model compression is explained. Do not fabricate precise borders, civilizational scores, cultural percentages or origins. Quote source material only when appropriate and permitted; a citation is not permission to redistribute an entire work.

## 10. Priority and delivery rules

**P0 is the complete set in §11:** exploration, full version/command semantics, desktop runtime, dynamic database, content management, publication, correction, persistence and recovery. The UED05 subset is not the release definition.

**P1:** broader geography/periods, richer geographic layers, semantic search, personal notes, more complex multi-base interaction, teaching-route export and richer scholarly-review workflows. Basic local editorial audit is already P0.

Retain design-system and Figma alignment as the implementation evolves. Do not treat a document update as evidence that design files or code are synchronized. Ship runnable code, installation and development instructions, data/schema contracts, source notes, test results, package evidence and explicit unverified items. No unused controls should advertise missing functionality.

## 11. Acceptance matrix

Every row records build/revision, environment, dataset release, actual steps and evidence. These are required outcomes, not current pass claims.

| ID | Task | Pass condition |
| --- | --- | --- |
| D01 | Install and restart | Packaged app starts on the declared macOS/architecture without developer tooling; content and semantic workspace persist after restart. |
| D02 | Dynamic addition | A new source, subject, field/version and process mapping entered through management become searchable, completable and explorable after publication without a build. |
| D03 | Correct published content | New release reflects correction; an old pinned release keeps its original states, sources and A/B results; editorial reason is retained. |
| D04 | Draft and transaction isolation | Drafts do not enter published exploration; invalid references/cycles/evidence/merge choices cannot publish; interruption leaves no partial visible release. |
| D05 | Usable administration | Routine source/value/knowledge-state/parent/link/tag/coverage editing requires no JSON authoring; imports provide preview and field/object errors. |
| D06 | Export and recovery | Restore into an empty library and verify releases/hashes/sources/drafts; reject corrupt/incompatible input without damaging existing data. |
| D07 | Genuine version model | Immutable canonical objects, deterministic replay and tree diff; sourced split, multi-parent integration ledger and separate influence case all work. |
| D08 | Complete query contract | All §6 operations, double-/three-dot semantics, absent/multiple bases, event ambiguity and GUI/CLI equivalence are verified. |
| D09 | Time and evidence limits | BCE/CE display, approximate/interval dates, ambiguity, as-of date echo, baseline-vs-origin and missing-vs-absence behave correctly. |
| D10 | Coherent exploration | Overview → self-selected scope → process → version/relation → evidence → return works in both locales, preserving HEAD/A-B and recovering from errors. |
| D11 | Package and runtime boundary | Record OS/architecture/signing/notarization/data path; launch actual package; no unexpected network dependency or exposed remote writes. |
| D12 | Upgrades | Initialization never replaces existing data; schema migration has backup/failure recovery; app updates and dataset releases are distinct. |
| D13 | Unscripted investigation | Add an object absent from the delivery script, then combine its refs/fields freely; no fixed sample-ID limits or prepared-answer matching. |
| D14 | Readable desktop layout | Review both locales at ordinary, small and larger window sizes, and at 200% interface zoom. Ordinary text remains 14–15 CSS px at actual size, secondary text at least 12 px; panels reflow or scroll without hiding essential controls. Window geometry and zoom persist and adapt to a changed display. |

Further engineering checks: snapshot/tree hash agreement; source and parent integrity; unchanged inputs during pure queries; stale-response suppression; safe bounded cross-link traversal; deterministic release/reference resolution; no shell invocation from exploration; layout and keyboard review at both target sizes.

Initial user-study target: five target users, including people less familiar with Git. At least four should orient and choose a scope without a named-event prompt, return from detail, explain a real diff, distinguish parent from influence, and distinguish browsing from HEAD/A-B. At least three should pursue a question outside the supplied route. These targets need calibration; no user-validation claim is made without observed participants. Automated checks, content review, desktop testing and user learning are separate evidence.

## 12. Risks and decisions still requiring evidence

- Git familiarity, learning benefit and continued engagement are hypotheses requiring observation.
- Sparse content can create false continuity. Preserve gaps, recorded dates and baseline semantics rather than filling every field.
- A common schema can flatten non-equivalent institutions. Add applicability and precise definitions before adding more fields.
- Geographic context must not imply historical control or comprehensive coverage.
- Content quantity cannot rescue an unusable editor or fragmented exploration flow.
- A same-name developer product exists; use a precise subtitle and evaluate public naming deliberately. No automatic rename or domain purchase is authorized by the research finding.
- Performance claims require measured hardware, dataset and latency distributions. Synthetic scale tests must not be displayed as historical facts.

The source-based decisions and limitations are detailed in [Product assessment](research/product-assessment-response.md). Existing sample evidence remains in [Historical sources](../prototype/HISTORY_SOURCES.md). The PRD evolves with product understanding; changes must update related requirements, designs, implementation work and acceptance evidence without introducing artificial phase gates.
