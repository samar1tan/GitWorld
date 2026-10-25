# Workbench interaction design

UED **07** · Product scope **v0.1** · 25 October 2026

This is the current design contract for the [PRD](PRD.md), including the [scope-navigation requirements](scope-workspace-prd.md). UED07 adds collection-wide orientation, versioned research contexts and precise draft/state/reference behavior to the retained workbench contract. UED05 remains historical prototype evidence; its five peer desktop module entries and historical use of bare HEAD are superseded. Implementation, editable Figma, rendered review and installed operation have separate verification status below.

## The user's work

A learner explores the past, supplements or corrects the supporting collection, and preserves an understanding that can be revisited. The workbench has two primary activities:

| Activity | Purpose | Resources within it |
| --- | --- | --- |
| **Explore / 探索** | Choose a scope; inspect historical objects, states, relationships, comparisons and evidence | Scope/object navigation, applicable historical views and saved research documents |
| **Library / 资料库** | Maintain the local material and its modern revisions | Sources and acquisition tasks, Changes, and advanced model-package authoring |

Research records are documents within an investigation and can also be reopened independently. Find data is a contextual action and a Library source task. Changes belongs to the contribution workflow; a global pending-change count links to it. Settings and Guide are utilities. These roles do not become peer activities because they have separate implementation modules.

No project setup or topic template is required. Opening a research document retains the current scope and a return to the historical canvas. Its saved working state and its inclusion in an editorial commit are different statuses.

## Stable regions

| Region | Responsibility | Interaction contract |
| --- | --- | --- |
| Global top | Library, editing branch and the sole repository HEAD; two activities; pending changes and utilities | A commit updates the repository context. It never replaces a fixed historical reference. Settings has its own current state rather than leaving a background activity marked current. |
| Left | Resources and scope for the current activity | Explore holds scope, objects and research access; Library holds sources/tasks, Changes and model tools. Selection is not checkout. Undated and unlocated objects remain findable. |
| Central context | Current historical subject/path, historical time, checked state and A/B | Keep browsing scope distinct from fixed references. Show target, historical time and data revision; expand full identifiers on demand. |
| Main canvas | Map, observations, state, comparison, supported evolution graph, or research document | Applicable views retain selection, scope, time and fixed references. Do not invent ancestry, dates or positions to fill a view. |
| Context panel | Evidence for an actual selection, or an explicitly opened commit editor | No permanent empty inspector. Evidence is historical; a commit editor describes modern collection edits. |
| Bottom tools | Global bounded terminal and compact optional Guide | Commands keep their meaning across activities and update the corresponding visual workspace. The dock reserves layout space and remains dismissible. |

A return restores semantic context: query, interval/point, selection, applicable view, fixed references and current research document. It does not rely on scroll coordinates. Library offers a return to the retained investigation; failures retain inputs and that return target.

Reopening a research scope retains its explicit object set and field focus, even when its name query is empty. Its recipe may follow Working data or retain an explicit query revision; evidence and comparison endpoints keep their own fixed revisions. Show the restored object/field restrictions beside the existing filters, with an explicit way to widen them. Attaching current evidence uses the investigation from which the document was opened. An already-current activity preserves its open document; a background task may update counts, but cannot navigate over a later user action.

## Complete investigation and contribution loop

1. **Orient.** Explore opens the actual collection's All-material overview and declared structures where available. Contexts, types, recorded time coverage and gaps offer a starting point without a named-object prompt. A geographic overview is useful where coordinates exist; it does not establish accurate historical boundaries or complete coverage. A paginated sample is not the world's full distribution.
2. **Focus.** Choose a research context, numeric period or literal name/keyword and combine explicit filters. Time, location/subject scope, field focus and analytical detail are separate dimensions, not a mandatory questionnaire. Returning to the overview retains checkout and A/B; widening context does not silently clear time or text.
3. **Inspect.** Open an object or supported historical path. State views distinguish applicable claims, uncertainty, absence and unknown coverage. An observation is not automatically a known transition or historical origin.
4. **Checkout and compare.** Explicitly fix a historical target or A/B with its data revision. Compare across time or subjects in the same position. A new editorial commit does not silently refresh these endpoints.
5. **Trace evidence.** Select a field or relation to open its assertions, qualifiers, locators and source revisions. Inherited values retain their original evidence. Equal endpoints do not establish uninterrupted continuity.
6. **Fill a gap.** Find data carries the supported structured scope into Library. Only filters actually supported by the provider are sent; an editable research question does not imply natural-language query interpretation.
7. **Preview and adopt.** Show source rows, resulting objects, dated assertions, located objects and excluded/ambiguous material separately. Acquire, map, review and adopt have real persisted results. Batch actions do not silently turn exceptions into reliable history.
8. **Review an increment.** Working content is previewable. Open Changes, inspect semantic differences and required supporting material, then freeze a coherent selection. If B is staged and edited again to C, committing records B and leaves C working.
9. **Commit and return.** State the frozen count, reason and contributor identity together. Validate the reviewed HEAD/tree, retry safely, and return to the prior investigation with links to the actual adopted objects. Previously fixed historical references remain fixed.
10. **Retain and revise understanding.** Save a research record containing the question, scope, fixed evidence/comparison, interpretation and open questions. Reopen it after restart; inspect older evidence and revise the interpretation against a newer data revision. No model, developer script or backstage operator supplies a missing step.

Acquiring and committing are optional when existing local material supports the question. Saving a research document does not require committing immediately.

## Scope, time and fixed states

Scope is an organization of the available collection, not a fixed country page. A research context has explicit, versioned membership in the same Git tree as the historical objects. It is not an ancient nation, border, lifetime, political parent or historical claim. Membership can overlap; name matches do not establish membership. Period definitions remain evidenced objects with their own interpretations and possible dates. Absent period data is a coverage gap, not an empty permanent picker or a boundary inferred from a ruler list.

| Element | Purpose and interaction |
| --- | --- |
| **All material / 全部资料** and context selection | Show the actual collection or an explicit context. The form's dropdown edits a draft; Apply scope applies it. A context card or All-material crumb directly changes only the context dimension, preserving time/text and recoverable input. Reset scope explicitly clears filters while retaining query revision and historical slots. |
| **Object kinds / 对象类别** | New workspaces begin with the complete exact set of types declared as structures. The full type catalog comes from the same revision and remains available when current matches hide a type. All kinds is one action away; people, documents, source groups and period definitions remain reachable. No declared roles means All kinds, not a name-based guess. |
| Scope results and coverage | Matching objects lead the canvas, with pagination. Complete type/time coverage follows in a disclosure. Full recorded ranges describe the objects' records; they do not replace the selected numeric window or assert a continuous history. Loading saved navigation withholds editable placeholder filters until restoration finishes. |
| **Historical year / 历史年份** | Input is a draft, shown beside the actual resolved year. Only a successful Inspect year applies it. Review-policy and locale changes retain unapplied input. Entering 1370 while 1336 is displayed leaves Checkout/A/B at the displayed 1336 until inspection succeeds. Ordinary object selection starts within the applied numeric window; an explicit historical reference retains its requested year. |
| Checkout and A/B | Persistent slots identify the target, actual year and fixed repository OID; review policy remains inspectable. Fixing a Working preview revalidates and reads its committed counterpart. Working-only material requires a commit; an unrelated dirty record does not block an existing committed target. When both A and B are fixed, a successful pin opens comparison automatically. A late validation cannot reopen an older view over newer navigation. |
| Return and saved research | Entity return, Back to scope and research recipes retain their semantic context and fixed slots. Modern commits or context reassignment do not refresh old endpoints. Snapshot names follow their own revision and saved language map, not a Working rename; legacy scalar names remain readable without guessing their language. |

Users can create a context and assign a complete adopted-import or fixed saved-source object set through Library. Review whole-set counts, deduplication and membership/source basis before confirmation; visible pages never define the batch. Assignment is a separate modern working change, not another facts import or historical event. Success retains the active investigation and offers an explicit View context action. Unassigned material remains an ordinary scope and can be explored without first assigning it.

Historical paths is an explicit authored model artifact with its own identity, revision and actual coverage. Sharing repository HEAD does not make its scope equivalent to the generic collection. Without a validated crosswalk, inspect it independently and preserve return to the retained object investigation; a narrow model cannot stand in for the whole collection.

## Historical representations

The graph represents supported continuation, division and integration. Column spacing is ordinal unless explicitly labeled otherwise. A path can continue after a fork. Multi-parent integration exposes field-level resolutions and evidence; conquest is not labeled voluntary merger. Contact and influence have separate typed links and do not become ancestry or participate in merge-base computation.

State and comparison views show requested and resolved historical dates, compatible field definitions, recorded/possible/unknown values and evidence. Recorded applicability does not approve an unreviewed claim. Uncertain overlapping candidates require a supported interval or explicit choice. No invented midpoint, universal nation-state container or automatic name-based identity merge is permitted.

Map, observation, state and comparison remain useful without ancestry. Imported content enters the same applicable views as installed content. No region-specific renderer or prewritten command result is an acceptable bridge.

## One content and reference contract

Model packages and generic object/assertion collections share the same data repository. SQLite may maintain drafts, jobs and indices; it does not provide a second publication base hidden behind the Git HEAD. Importing or publishing an authored model produces real working changes that use the same staging and commit path.

Internal historical adapters may differ. Their public references retain the target kind, stable target ID, required package/time information and actual repository OID. A bare historical ref or display name cannot infer an object's identity. Models are read from the corresponding committed tree; an unrelated SQL publication cannot be presented as that OID.

Acquisition returns its actual changed/unchanged object IDs and job, together with the originating investigation context. The user can open those results and return to the prior scope. Working-only targets are labeled Working; fixing a reference requires committed content, without blocking unrelated existing references because another document is dirty.

Sources includes bounded local-file import and a review of unresolved matches. A standard KnowledgeCollection file is distinct from an authored model package. Preview counts describe its actual objects and claims; adopting a partial collection retains omitted assertions. Conflicts expose previous, local and incoming records before a whole-object decision. Complete mapping-issue pages and aggregate exclusions have distinct counts; older partial checkpoints are labeled and can be rebuilt only from the matching verified local snapshot.

Entity values open the referenced object at the originating data revision and historical year, retaining the assertion-review policy. A bounded Back action restores the preceding object/view and scope while retaining subsequently fixed checkout/A/B. Missing targets remain explicit errors; following an old reference never substitutes current working content. Research captures only assertions that support or possibly support its actual fixed endpoint fields, rather than attaching the object's entire chronology. Both endpoint dates and review policy stay visible in the saved comparison.

The evidence inspector uses readable source titles, with registered provider names for untitled records and literal provider names for unknown adapters. Do not use a raw hash as a fallback link title. Object-level source headers with the same exact document URL, provider, source revision and supplied title metadata may share a collapsed document group inside one data-repository revision. Its summary shows the source name and exact source-record count. Expanding it exposes every original source record; each retains its identity, content hash, retrieval/adapter metadata and actual evidence locators. Differing source titles/revisions and differing repository OIDs cannot be folded into a single provenance record. Field Evidence preserves its exact source and locator instead of substituting a document-level aggregate.

The global terminal routes **`git` to modern data edits** and **`history` to historical inspection, checkout and comparison**. These meanings never depend on the open activity. GUI and CLI use the same typed operations. Conflicting old aliases provide migration guidance. Completion, history, clickable results and actionable errors support free adaptation; no system shell, pipes or command substitution is executed. A late result cannot replace a newer investigation.

Completion refreshes the candidate list without recreating the command input. A pending lookup cannot offer an older prefix, reopen after Escape or replace a subsequently selected command. Tab waits for the current lookup when necessary; accepting a completion places the caret at the end for the next argument. Candidate updates do not interrupt text composition.

### Proposal: readable command candidates

This is a design proposal for a subsequent bounded completion refinement, not an implemented or installed acceptance claim. An object candidate leads with its supplied display name; the exact command remains secondary and is inserted unchanged. Never lead a row with an opaque object ID, generate numbered aliases for same-name records or infer a historical identity from its name. When a command's label is already identical to its syntax, show it once rather than repeating it.

| Candidate element | Proposed purpose and form |
| --- | --- |
| Name | Primary 14px text, using the selected locale's actual content label and an English-language indication where appropriate. Preserve separate records even when their names match. |
| Recorded context | Compact secondary 12px metadata can distinguish same-name objects by supplied source/provider, actual recorded applicability coverage and exact claim/source-record counts. A source date value is distinct from historical applicability; coverage does not assert a lifetime, continuous rule or canonical identity. Omit unavailable metadata rather than inventing a region, date or source. |
| Command | Secondary 12px monospace syntax, wrapping within the candidate. Selection fills this exact value; execution remains a separate action. Identity, revision and routing never depend on the rendered name or metadata. |

Use a bounded scrolling list in the existing terminal location, without reserving empty metadata rows or expanding the dock over the investigation. Keep current text composition, pending-query cancellation, caret and Escape behavior. Same-name records with identical available metadata must remain honestly ambiguous; their exact commands retain their distinct identifiers for inspection.

The current completion DTO supplies only `value`, `label`, `kind` and optional `year`. Label-first layout can use those fields; source/coverage/count context requires a bounded structured extension from the actual query snapshot. It must not be reconstructed from command strings, displayed prose, a different repository revision or editorial timestamps. Existing object queries have claim counts and qualified observed times; source-record counts or provider summaries require their own actual evidence. Review two same-name imported records, absent coverage, English fallback, long commands, both locales and keyboard lookup races after implementation before accepting this proposal.

## Changes and guidance density

Changes uses a compact local Working/Staged switch with accurate counts; the Chinese labels are 未暂存/已暂存. Stage is 暂存 and remains distinct from context membership or source adoption. Search, type filters and selection form one group. Page/all-filtered/clear selection actions stay together, with keyboard and Escape behavior if disclosed as a menu. The main pane prioritizes field, date and evidence differences; raw JSON and internal paths are secondary.

Do not permanently display a large empty commit form. A stable commit entry opens the editor when useful; the reason, frozen count and identity are together. Keep the author caption and Edit author action on one row, with the potentially long identity below. Branches, revision log, checkout and revert remain reachable as advanced data operations. Closing the context panel gives space to the difference rather than preserving an empty third column.

Guide is a utility. Its open bottom dock shows the current step, one short reason, one action and expandable progress. Track selection, pause, tips and restart are secondary controls. The ordinary expanded target is roughly 120–160 CSS px; additional content scrolls. Progress follows actual successful results and matching scope/job/staged content. Tips use the single Learning preference; a failed save retains its previous value. Restart has one confirmation. Dismissal never blocks ordinary work.

## Shared element contracts

Every visual element must have a purpose, name, form, relationship and interaction. Shared controls inherit a maintained contract; each instance still needs a meaningful workflow position.

- Navigation identifies one actual current activity or resource. It does not mix views, tasks, documents and utilities at one level.
- Buttons use short task-specific verbs, consistent heights, focus/hover states and aligned groups. Allow groups to wrap; avoid breaking a short label merely to make unrelated buttons equal width.
- References expose readable targets and historical time before technical detail. Repository HEAD and historical checkout have distinct names and locations.
- Errors appear beside the failed operation with a valid recovery; success cannot overwrite failure. Empty states explain actual coverage and a useful action.
- Interface messages, historical content/translations and structured state remain separate. Both locales are maintained; external original-language content is identified honestly.
- New unconnected capability controls, empty AI panels and promotional filler do not enter the interface.

Run the [deflation review](governance/quality-loop.md) after meaningful batches and before delivery, covering information architecture, operation, code and documentation as well as appearance. Unresolved structure triggers a dedicated UED phase before further expansion.

## Reading scale and native chrome

Use 14–15 CSS px ordinary text, at least 12 px secondary text, near-black/gray surfaces and blue accents. Target 1440×900 and 1280×800 in both languages at 100%. At insufficient effective width, preserve the canvas: disclose scope through its existing left entry, and place evidence below or in a contextual panel. At 150%/200%, stack and scroll rather than shrink text or create page-wide horizontal overflow. Long graphs/tables can scroll within their own regions.

The compact title bar shares a dark surface with native macOS controls. Reserve unused space for dragging; interactive controls never overlap it. Preserve traffic lights, full-screen, remembered geometry fitted to the current display, native zoom/reset, accessible names and keyboard focus. Settings returns to the retained work; closing waits for persistence and protects unfinished input.

During first initialization, show the local-library window before the data service is ready. Display actual durable file-write progress without calling those files historical events or promising an estimated completion time. Service startup has a bounded initialization budget; it must accommodate the shipped corpus, retain recovery data after failure and never silently reset a user's library.

## Verification and artifact status

UED07 is the current design contract, **not an installed acceptance result**. Required checks still include the complete loop above, one supported relation model and an arbitrary acquired object, fixed A/B after new commits, B-stage/C-edit, restart, recovery, GUI/CLI equivalence, both locales at both target windows and 150%/200% zoom. Record exact build, conditions, interventions and failures. Scope checks N01–N09, content quality, native operation and Figma editability require their own evidence.

The [editable Figma design](https://www.figma.com/design/WcI3meWMnwjZKhJgNhlxKW?node-id=38-4), page `38:4`, has a cloud-saved named version **“UED07 — Scope, checkout and comparison”**. It contains 20 editable English/Simplified Chinese text/vector frames, two shared Workbench chrome main components (English `47:8`, Chinese `47:144`) and 18 actual instances. The two flows contain 18 links in total; all nine arrows in each locale were traversed in Present mode to their expected nodes. Entry frames are [English `45:11937`](https://www.figma.com/design/WcI3meWMnwjZKhJgNhlxKW?node-id=45-11937) and [Simplified Chinese `45:13502`](https://www.figma.com/design/WcI3meWMnwjZKhJgNhlxKW?node-id=45-13502). This verifies these bounded design routes and chrome reuse, not componentization of every primitive or complete token reconciliation.

The static flow has four explicit composition boundaries:

- **01 → 01a:** illustrates selecting a context and filling numeric years. Apply scope is the following separate action.
- **02 → 02a:** combines opening the object, choosing Historical state and explicitly including unreviewed claims. Runtime object opening first selects Observations; this link does not change the default review policy.
- **02c → 03:** illustrates entering 1370 without applying it; actual 1336 and fixed references remain unchanged.
- **Set B → 04:** in this story A is already fixed, so successful Set B automatically opens comparison; the destination also shows the subsequently opened A-side field Evidence. It is a composite presentation of those two actions.

Figma provides editable static design navigation, not arbitrary input or every intermediate tab/checkbox simulation. Dynamic step-by-step behavior belongs to the runnable application/prototype. The UED07 story uses one recorded v6 collection/repository basis; subsequent native commits are separate evidence and cannot be spliced into its fixed-reference story.

Retained history is counted separately: UED06 has **44** text/vector frames; the ten older UED05 frames are on the earlier pages and are not added to the UED07 count. The frozen UED05 prototype's earlier 24-test/browser result covers its fixed-content scope only. These older artifacts do not establish the current release's coverage or acceptance.

At the earlier source checkpoint `2e375eb`, 676 tests and six CI checks passed. Bounded macOS native checks exercised a Unicode contributor identity, committing staged B while C remained Working and older historical references stayed fixed, and locale changes on a new research record's saved snapshot names. A context-editor header occlusion was repaired and the bounded workflow passed English and Simplified Chinese native replay on macOS build `1792904777113`: adding six period-definition memberships and removing those memberships kept the historical objects intact, the result and View context action reachable, and the earlier checkout/A/B fixed.

Development build `1792906736277` then initialized an empty profile with the v7 collection and `.2` authored model. Native English and Simplified Chinese checks confirmed the simplified idle header and readable, localized authored source-collection names; original external titles retained their language indication. Restoring the earlier v6 full-library backup through Settings preserved its original data HEAD, 775-member custom context, 245 Working paths, contributor and preferences, research interpretation C and historical checkout/A/B at the older fixed OID. Normal quit and restart retained the restored research and references. The newer bootstrap did not overlay that existing library.

The integration suite passed 686 of 687 tests; its sole failure was an outdated exact-markup assertion for the source-group title. A reviewed test-only correction checks the visible group name and exact source-record count while retaining individual evidence assertions; all 39 tests in that file then passed. This is not a claim of a subsequent complete-suite rerun. The full 63-check installed-acceptance receipt, clean installation and DMG acceptance are still pending; neither these development checks nor the Figma flow closes them.
