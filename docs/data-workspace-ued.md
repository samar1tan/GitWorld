# Data workspace interaction specification

UED proposal v0.2.1 · Product scope v0.1 · 25 October 2026 · Implementation and rendered review tracked separately

This specification accompanies the [module requirements](data-workspace-prd.md). The existing Figma UED05 file remains an exploration baseline; this document does not claim that the new data workflow is already present there.

## Shared workbench

The organizing journey is the [repeated learning workflow](learning-workflow.md). Keep a research record accessible alongside exploration: the learner's question, explicit scope/query, selected evidence/comparisons, provisional note and open questions. These are ordinary editable local records, not prompts to an AI. A person can save, reopen, extend and inspect their revisions without assembling a topic page or mastering schema tables.

Keep Explore and Library inside one shell with the same library, editing branch and retained historical context. Find data and Changes are Library resources, reached directly from exploration when relevant; research records remain investigation documents. The [UED06 workbench contract](UED.md) defines the navigation hierarchy and supersedes older peer-module layouts. The historical graph remains a central domain view. Data work must not require entering a separate administrator application.

Use the current near-black/gray/blue direction and native macOS chrome. The title bar identifies the library and editing branch; historical breadcrumbs and the checked historical state belong to the content context. There is one repository HEAD. Show an active acquisition task only while it exists, and retain the terminal as an equivalent interaction path.

Entry points use the user's task: Find data for this scope, Add state, Correct record and Add evidence. Schema tables, source IDs and raw JSON are advanced inspection tools, not the first screen.

Design for a person with only the installed application. Every action needs actual application behavior and recoverable feedback; a developer, Codex or model must not supply a missing step. Use a name search field and explicit type/time/place filters where supported. Do not offer an open-ended question box that implies unimplemented language understanding. Unknown source properties remain readable material, not a request to edit JSON.

An object inspector separates its identity, dated assertions, recorded states and source material. A place or polity can participate in multiple views without copying its records. Opening an object does not require a pre-authored topic page. The map shows only supported locations, the timeline shows actual dated observations, and the historical graph shows supported continuity relations. Records without these properties remain available through search and the material list, with a concrete explanation of the missing property rather than an invented point, date or edge.

Historical year controls retain their annual scope; date values in state/comparison rows and Evidence retain the source's month/day and precision. A day-precision record such as `512-05-21` reads as `May 21, 512` / `512年5月21日`, with its recorded calendar and precision available alongside it. Applicability point/start/end rows follow the same rule, so two dates within 512 remain distinguishable. Keep each endpoint's metadata, preserve open intervals and BCE/range meanings, and offer the escaped original date text through the existing source-text disclosure rather than replacing the normalized date or repeating identical raw text within one assertion. Preview and ordinary consumption share this date-label rule; no localized label changes the source calendar or the selected historical year.

## Model editor section navigation

This is a limited layout refinement of the existing advanced editor, linked to the [module requirements](data-workspace-prd.md#model-editor-navigation-refinement).

| Region | Content and behavior |
| --- | --- |
| Native title bar | Model editor title, Return to exploration and the existing Guide entry. Leave the center free of page-selection buttons; preserve the native drag area. |
| Content, upper left | A persistent local navigation rail. Group Drafts and releases under Model packages; show the open package name with Model objects and, for an editable draft, Publication review. Put Met source configuration under Source tools. |
| Selected section | Blue background and a left accent, with `aria-current="page"`. Every rendered main view, including a read-only published package, has a matching selected navigation item. Selecting it again is a no-op. |
| Content operation band | Refresh and Import model package on one side; Full-library backup and Restore on the other. Keep these distinct from page navigation. They retain their existing validation and unfinished-input guards. |
| Source handoff | A connected Find data action leaves for the workbench source workspace after the same dirty-form decision used by Return. The Met configuration heading and request description remain specific to Met. |

At narrower widths, keep the section rail compact and let operation groups wrap without shrinking text. The inner object-kind list remains specific to the open model, while the outer rail retains the page-level meaning. Keep page navigation, operation controls and actual form content in that order. This written layout update does not claim a synchronized Figma frame or a reviewed installer.

## Find and acquire

Name search comes first. Show a source's supported filters and explain what they mean. Results expose name, type, time, place, available information and relation to local content. External IDs appear in details. Unknown dates and missing translations remain explicit; no fake total or implied complete coverage.

Preview the query boundary, sample records, field coverage, limitations and resulting content types before fetching. Fetch into the workspace, not directly into a published history graph. Persistent progress describes completed/failed batches, pause/resume and retry. Users can continue local exploration while a task runs.

## Reconcile and model

Group results by clear matches, possible matches and conflicts. The central view shows readable source claims; the inspector shows identity evidence, provenance and proposed local use. Names alone cannot trigger a merge.

Records that lack enough evidence to form a historical state can remain useful searchable material. Mapping rules are previewed on real examples and saved for reuse. Batch-adopt repeated safe decisions, then handle exceptions individually. Show precisely which claims support a proposed historical observation or transition.

The batch preview opens a Mapping issues report with an exact retained-detail total and bounded previous/next pages. Show readable issue meaning and the real source locator; technical codes and mapper details remain secondary. Aggregate exclusions have a separate count and scan boundary, with an explicit absence of per-record detail. An older truncated checkpoint says how many details remain and what its original report counted, and offers Rebuild report only when a matching local snapshot is available. Rebuilding is cancellable, does not change claim review/adoption or the Git tree, and preserves the old report on failure. Report paging/retry stays in the selected batch and does not reset its mapping preview or review choice. Both locales, the final issue beyond the earlier sample, partial recovery and source-job switching races require operational checks.

## Review changes and commit

| Region | Content |
| --- | --- |
| Change list | Meaningful object groups, added/modified/conflicting status, staged selection and dependencies. |
| Main view | Before/after fields with historical time, knowledge status, relations and sources; optional graph/map impact preview. |
| Inspector | Evidence locators, matching decisions, affected descendants and actionable issues; raw source properties are secondary. |
| Commit area | Frozen staged count, purpose of the commit and specific blockers; Commit and view. |

In All changes, show user records first (objects, research, models), followed by sources, mapping metadata and other paths. This is one stable list ordered before pagination; a type filter preserves the order within its group. Keep the existing row shape: the primary name identifies the record, while its subtitle distinguishes an object import baseline, active field catalog or catalog baseline and its added/modified status. Metadata remains inspectable and selectable, with exact paths secondary. Selecting an object can include its required sources/catalog/baselines only after the existing dependency review; ordering and naming never alter the frozen staged content.

The commit entry stays in the Changes heading; the empty editor is not a permanent third column. Opening it shows the frozen count, reason and two-line contributor block. Closing it preserves the reason and returns focus to its entry. A recovered reason, uncertain request or active reverse operation reopens it. Working/Staged counts use locale formatting. Page/all-filtered/clear selection share a compact disclosure; Escape closes it and restores its trigger. Advanced branch and revision operations live in the main pane and remain available when the editor is closed. The [UED06 contract](UED.md) defines the wider shell and responsive behavior.

In Simplified Chinese, use 纳入本次提交 and 取消纳入, with stage/unstage available in command help. Do not require terminology mastery to complete the flow.

If a staged field is edited again, show staged and unstaged differences separately. Required dependencies are visible before selection expands. Closing or navigating preserves recoverable unfinished work. Only frozen staged content becomes committed; subsequent working edits remain unstaged. Material-only commits locate the material/evidence rather than inventing a historical node. Commit advances the repository HEAD and opens the affected result; it does not silently replace a previously pinned historical state or A/B.

## Add or correct from the graph

Add claim opens an explicit editor document; Correct claim starts from an actual selected claim. New object asks for a name/type and its first claim. The header identifies the object and current working edit base. A historical selection supplies context without silently changing that base or treating a modern correction as a past event. Claim names the editable source-backed assertion; observation names the automatically derived historical state observation.

Choose a catalog field, then use structured controls for its value and historical applicability. Entity values search real objects by name and require a selected result. Existing complex values and unsupported metadata are preserved; replacing them is explicit. Select an existing source from readable headers or enter a new HTTPS citation, title and locator. Keep the reason beside the review choice, defaulting to unreviewed. A correction retains the original source and records the local amendment separately.

Save to working data returns the affected object and offers its normal state and Changes paths. It does not stage automatically. Field changes preserve form scroll and keyboard focus; name search focuses the result or the query when empty. Stale HEAD/object content keeps the form and offers a deliberate reload/review; recoverable input survives navigation/restart. Resume edit reopens the saved draft target directly; an explicit Add object request may instead offer to replace a different unfinished edit. Neither action writes the draft. Discard draft opens an inline confirmation with Keep editing as the initial focus; Escape cancels and restores focus to Discard draft. Confirming removes only the unfinished form and returns to exploration. An unconfirmed save exposes Check save result instead of discard. Save failure, empty entity search, unsupported existing value, new baseline and correction after a fixed checkout require bilingual rendered and operational review.

The editor separately identifies the repository branch/base and the historical parent; starting from an older fixed historical reference does not silently change the editing base. Add state offers two relevant paths: extend a selected historical parent, or create a first recorded observation for an unmodeled subject with no invented parent. The latter is labeled a baseline/coverage start, not a historical origin. Both ask what is established, when and on what evidence, then enter the same Changes and commit workflow. Unchanged fields retain their provenance; unknowns are not filled to make a card look complete. Preview the uncommitted state beside its parent and on the graph.

Research documents initially show up to eight compact evidence rows with their attached total. Each row expands its actual reference details and actions; Show more/Show all and Collapse control presentation only. Older revision comparisons use the same bounded presentation independently. Repeated titles are distinguished by known historical time and source locator, without inventing missing values or an A/B grouping that the reference does not establish. Folding never removes stored evidence or changes the comparison. In Changes, the research scope shows its saved name/query/time and distinct object/field counts; known semantic field labels can accompany the count. Filter identifiers remain in a collapsed detail. Object names require an explicit revision-qualified display result; do not guess them from identifiers or evidence titles.

Bulk-mapped object sources use the same progressive disclosure. A document group starts collapsed and shows a readable supplied title or provider fallback plus its exact source-record count. Group only matching document URL, provider, source revision and supplied title metadata within the same repository revision; missing or invalid document URLs do not justify combining unrelated records. Each record expands to its original identifiers, hash, retrieval/adapter metadata and evidence locators. Keyboard toggling must keep focus on the chosen disclosure. Field Evidence remains bound to the original individual source; a grouped document title does not imply that its records are independent sources or approved claims. Both locale layouts must keep long identifiers inside details without overflowing the inspector.

The file path in Imports and matches accepts both an ordinary collection and the paired import envelope. A paired preview identifies its persisted preview ID and base HEAD; applying uses that exact base and preview, even if a separate later status read has advanced. Vocabulary starts as counts and a collapsed review: page through field, type and value names in English and Simplified Chinese, with explicit missing names and conflicts. Origin, rights and evidence remain inspectable separately. Never render an entire bounded-megabyte catalog or raw origin payload by default. Claim review is a separate choice and cannot upgrade unknown redistribution rights. A catalog conflict blocks the paired application and displays the actual local/incoming names; no vocabulary editor is implied.

Entering Imports and matches refreshes the backend's pending-import summaries. A real pending operation exposes Resume with its frozen counts, review choice and vocabulary identity, while new application is unavailable. Resume sends the original operation/preview pair without a file token, new operation ID or fresh mapping. Failed application or recovery refreshes that list, preserves the selected preview/error and offers an explicit retry/check path. If pending state cannot be read, do not imply that starting another import is safe. No renderer preference journal duplicates the durable receipt. Adoption, recovery and result navigation pass the interaction version captured at that action's start so a late result cannot replace a newer investigation. Actual write progress may display completed/total files for that operation; otherwise show Working without an invented percentage, event count or estimate.

Source initialization has a view lifetime distinct from a background operation. Declare the current visible view before awaiting its child; leaving or selecting another child invalidates that view's pending initialization, record/job reads and redraw callbacks. A slow pending-import response must not reactivate a hidden source view or rebuild a newer editor and disturb its input focus. Acquisition may finish and retain saved material while hidden, but selecting its result requires the original view context to remain current. Reopening reads current summaries rather than reviving the earlier initialization.

The existing Changes and object-edit actions preserve the structured reasons `paired-import-pending` and `incomplete-paired-import`. Those errors explain the Library → Sources → Imports and matches recovery path and offer an explicit link when its navigation callback is connected. Ordinary REVIEW_REQUIRED keeps its dependency/review meaning. The link never redirects automatically or discards an edit: the normal leave/cache guards run before opening the existing imports view, and the commit message or object-edit draft remains recoverable. This adds no peer Tasks activity, placeholder center or permanent global badge.

Selected-field Evidence also identifies the origin of its display name separately from historical claim evidence. A label from the Git vocabulary uses that record's revision-qualified provenance; a library-pinned compatibility label is explicitly marked as such and does not imply that the process catalog was frozen by the old OID. Missing/conflicting names remain explicit. Keep this disclosure local to the selected field rather than a permanent workbench warning.

The domain status `known` is presented as Recorded / 有记录: the selected data records an applicable value, which may still be unreviewed. This label does not claim historical certainty or change review, multiple-value, unknown or explicitly absent semantics.

For coded text values, a service's ordinary original/missing-text fallback does not suppress an available vocabulary/enum name. An explicit translation attached to the matching claim takes precedence over a generic enum label. A reported conflict in either matching claim translations or the selected enum names takes precedence over both: retain the canonical source value, show the conflict and keep the actual display evidence inspectable. Canonical values, comparisons and queries never change when a display name changes.

### Wikipedia within Sources

This consumes the [existing bounded profile requirements](source-bindings-prd.md#bounded-wikipedia-acquisition-and-mapping-increment), rather than adding a new activity or provider-specific historical page. In Sources → Search, a Source selector chooses Wikidata or English Wikipedia. Wikipedia uses Page title and an optional revision number with Save source page / 保存来源页; it does not imply name search results, arbitrary URLs or language understanding. A successful acquisition selects that job in the existing Saved material section only while the original view remains current. Saved material has the same source selector, a bounded job list on the left of its content and the selected job's inspection/mapping on the right. Public datasets remains the normal bulk entry; Imports and matches remains the recovery location for accepted imports.

| Element | Purpose and form | Relationship and interaction |
| --- | --- | --- |
| Source selector | A compact labelled select within Search / Saved material | Changes the supported source form/list, not Explore/Library or the selected historical reference. Re-selecting the same source is a no-op. |
| Page input / Save source page | One title field, optional numeric revision and one main action | Saves a durable acquisition job. While fetching, the same band shows real operation state and Cancel. No profile or adopt action appears before a fixed snapshot exists. |
| Saved job list | Readable page title, source revision and receipt state; bounded pages | Selecting a job reads archived metadata offline. Job IDs and hashes stay in details. A failed/incomplete job exposes its actual issue and Retry acquisition, without a fake completed snapshot. |
| Fixed source header | Original title/language, source revision link and compact rights disclosure | Source revision is separate from the global library HEAD. Preserve normalized/requested title differences, source hash and attribution in details. |
| Mapping profile | Named profile select, one concise semantics sentence, calendar choice | The two service-supplied profiles describe source-defined holder/tenure rows or dated entries. They do not establish canonical institutions or infer ancestry. A new draft starts with Source unspecified and omits a calendar override; Gregorian or Julian is sent only after an explicit choice. Existing saved choices survive recovery. A changed profile clears incompatible bindings and invalidates the preview. |
| Table and column binding | Table caption/headings, physical row count, complete headers and a bounded original-language cell sample | Selection is explicit. Holder/tenure accepts up to ten chosen tables, with either a tenure column or separate start/end columns. Dated entries uses one table, one time column and selected text/link columns. Duplicate header text remains distinguishable by its displayed column number; IDs/hash are secondary. |
| Preview / Add to working | A main action that changes only after a real preview succeeds | Preview reads the selected source hash/profile/columns at the actual library HEAD. Validate the response job, source hash, exact selection and prepared base before displaying it or recording progress. Add uses the persisted prepared ID/base; it never remaps or substitutes a later HEAD. Editing choices returns the main action to Preview mapping. |
| Counts / exceptions / vocabulary | Compact summary followed by separate disclosures | Distinguish physical source rows, mapped rows, objects, claims, claims bearing date values and claims with historical applicability. Exception pages contain ten records and expose the complete saved report through `wikipedia.issues`, pinned to job/preview/input hash and stable report hash/total. The initial thirty supplied records are only a cache, not a complete ledger. Reuse bounded vocabulary, missing/conflict and origin review. |

The selected columns' first three supplied source rows start expanded beside the binding controls and update when roles change. Keep the user's folded/unfolded choice with that source-pinned draft; missing sampled cells and truncated text stay explicit. Full headers remain a separate disclosure. The OPEN_END exception says No end date recorded / 来源未给出结束日期; it does not ask the learner to invent an end date. A single issue needs its meaningful description and secondary locator/code, without a repeated “showing all one” count. Long or partially supplied reports retain their exact range/total.

The claim sample retains source date precision: year/month/day or a returned year range, followed by the actual precision and calendar. Gregorian and Julian dates are never converted through the host's timezone, and a source-unspecified calendar stays unspecified. Original date text remains available beside these normalized details. A same-year start/end with different days must remain distinguishable. These are reviewable source statements, not inferred change dates.

Next/Previous report actions keep the current page visible during a bounded read. Only a response with the same job, prepared preview, input hash, total and report hash can replace it; changing the mapping clears that cache. A failed read leaves the page and selection intact with a local Retry page action. Long reports show the actual visible range and exact total. No extra section, automatic mapping retry or pending-import redirect is introduced for a report read.

The context has separate lifetimes:

- Acquisition request, accepted source identity/revision/hash and receipt are durable in the source archive. Cancellation preserves the job; Retry acquisition uses its original title/revision and resume job rather than silently requesting a new source version.
- Page input, selected source/job, table page and at most ten bounded per-job profile/column drafts use library-backed preferences, excluding raw HTML, complete vocabulary and operation receipts. Restore validates draft source/header pins against a fresh inspection before enabling preview; mismatches retain input for review rather than silently rebinding columns.
- A prepared preview owns its exact profile/version, source/header hashes, collection, plan, vocabulary, exceptions and base HEAD. Selection changes invalidate the active preview. An advanced library HEAD causes an explicit new-preview requirement without discarding the column choices.
- Fixed historical checkout and A/B stay untouched throughout source acquisition, preview and adoption. Successful adoption offers/returns to the ordinary working object paths; it does not pin working material as an old historical reference or commit automatically. Preserve the previous investigation as the return destination.

The ordinary path is Search → Save source page → Saved material → inspect table → choose profile/columns → Preview mapping → review → Add to working → ordinary objects/Changes. Back to columns preserves their draft; selecting another job preserves its bounded draft separately. The preview keeps its source header and an Edit mapping action rather than becoming a second navigation level. After adoption, use the existing result labels/return behavior, not a new provider-specific page.

Acquisition errors and cancellation belong to the selected job and retain a Retry acquisition action. Inspection/preview failures stay beside the choices with retry or a new-preview action as appropriate. Mapping is local and does not expose an unsupported cancellation control. Adoption shows real matching operation progress; an uncertain/partial result exposes the shared Imports and matches recovery link after refreshing actual pending summaries. Recovery does not create a second job, fetch, mapping or renderer receipt journal. A late response cannot replace a newer job, section, editor focus or investigation. Errors never clear typed page/column input.

`RECORD_MISSING` explains that the requested page or revision was not found, rather than showing only a generic operation error. Edit request restores the original title/revision for correction; a failed receipt does not expose profile or adoption controls as though it contained a source snapshot.

An unaccepted preview rejected with `REVIEW_REQUIRED` / `wikipedia-profile-version-changed` keeps the column choices and offers a new preview from the archived source. It is a mapping-rule update, not an unfinished-import error; no network refetch or pending-import redirect is implied. Already accepted receipts continue to recover their original bytes through the shared import route.

Before UI implementation, render the acquisition, selected-table/profile and preview states in both locales with actual bounded inspection/preview DTOs; mark simulated design transitions separately from service/native evidence. Check 1440×900, 1280×800 and increased text scale, long original headings, duplicate column labels, missing titles, zero tables/zero mapped claims, interrupted acquisition, stale HEAD, limited exceptions and pending recovery. The editable Figma synchronization and installed journey remain explicit unpassed checks until performed.

Return to exploration and other ordinary navigation preserve an unfinished research form without saving it into working data. This applies equally to a new unnamed investigation and an edited saved record. Opening Research again resumes its form; Save remains an explicit operation and shows validation, service and conflict failures without dropping input. Discard draft opens an inline confirmation that explains whether an existing saved record will remain. Keep editing receives initial focus; Escape cancels and restores the initiating control. Confirming discard removes the recovery input and returns to exploration. When a new investigation or another record would replace the active form, the same confirmation offers Save and continue, Discard and continue, and Keep editing; a failed save keeps the form and confirmation. No destructive action is the default. Cache or durable-preference failure blocks the attempted leave and exposes retry. These states require both locale, keyboard and operational review alongside the saved-document flow.

Correct record edits the existing historical identity and creates an editorial revision. It does not create an invented historical successor. Integration and influence have distinct interactions and relation types. Multi-parent integration presents the field choices and their evidence.

## Commands and visible state

| Intent | GUI | Planned command family |
| --- | --- | --- |
| Review working content | Changes | `git status`, `git diff` |
| Inspect selected content | Staged changes | `git diff --staged` |
| Select content | Stage / Unstage | Bounded `git add` / `git restore --staged` intents |
| Record the contribution | Commit and view | `git commit`, advancing the current branch and HEAD |
| Inspect editorial ancestry | Commit history | `git log` |
| Switch editorial work | Editing branch | `git switch` |
| Preview a historical object | Graph selection/details | `history show` |
| Fix a historical reference | Checkout historical state | `history checkout`, pinned to its repository revision |
| Compare historical states | Comparison A/B | `history diff`, separately pinned endpoints |

The parser does not infer command meaning from the selected panel. Historical queries and Git operations share one domain/content workspace, with explicit object types. Prototype aliases that conflict with this contract show migration guidance instead of silently changing behavior.

## Failure and update states

Rate limits retain completed work and offer a retry time. Partial results state their actual boundary. Repeated import reports unchanged matches. Upstream/local conflicts show base, incoming and local values. Missing evidence identifies the specific object/field and offers correction, deferral or retaining material. Failed commits preserve work and retry safely. An upstream removed statement is a reviewable change, not automatic deletion of historical knowledge.

### Historical command recovery

A failed command remains in the existing terminal log. Show its concise error meaning and retain candidate refs or migration syntax in a secondary disclosure. Those raw strings are information, never an executable control. Render only typed, complete recovery actions as buttons: **Inspect state / 查看状态** identifies an exact candidate; **Compare endpoints / 比较端点** keeps the original A→B and each model/OID. The full generated command remains inspectable with the action. A multi-base or no-base error offers endpoint comparison, not a base-choice button. Cross-revision B ambiguity offers inspection of that B snapshot. Bare aliases such as `CHECKED`, target placeholders and unsupported syntax do not become fill buttons.

Clicking an action replaces only the recoverable command draft and focuses it. It must not query, navigate, change checkout/A/B or advance data HEAD. Run executes that complete bounded command through the same service/parser as freely typed input. Failures retain the investigation and permit correction or retry. Verify click→parser/execution, both locales, a newer open model than the failed command, A/B at different OIDs, and failure/no-action states; do not substitute a handwritten recovery for testing the actual action.

## Design delivery and review

The current workbench design, editable Figma inventory and evidence boundaries are maintained in [UED.md](UED.md); synchronize affected designs while preserving the complete bilingual data journey and conflict, restart, recovery and direct-edit checks above.

A design prototype must identify its simulated data. Production acceptance uses real sources and persistence; fixed mock results cannot establish working ingestion. Review whether a newcomer can start without internal IDs, locate adopted material, understand what a commit will change and verify the result in exploration. Complete both structural editability and rendered interaction checks before claiming Figma synchronization.

## Scope organization — UED 07

The [scope interaction and reference contract](scope-workspace-prd.md#interaction-contract) extends the existing Overview/Scope layout. It introduces no new activity, settings section or topic page.

| Element | Purpose and form | Relationship and interaction |
| --- | --- | --- |
| Research context / 研究背景 | A data-driven selection in Scope, with definition/member basis in existing details | Independent of literal keyword and numeric time filters. Context change and All material preserve time/text; only Reset scope explicitly clears filters. No membership is inferred from names or modern borders. |
| New context / 新建背景 | A small name/purpose editor; service-generated identity | Reopening preserves input. Create saves organization metadata; Cancel creates no partial definition. User text retains its original language. |
| Add material / 归入资料 | Whole saved-source/adoption batch, exact count/dependency preview, explicit confirmation | Assignment is a separate working change with source/batch provenance. Failure preserves adopted facts; completion retains the active scope and offers View context. Unassigned material stays ordinarily usable. |
| Displayed state and fixed slots | Actual resolved year/revision/policy beside the year input draft and permanent checkout/A-B | Review/locale changes retain unapplied input. Pins use displayed state; Show succeeds before the actual year changes. Entity/scope return preserves context and fixed refs. |
| Model artifact | Explicit model identity, OID and real coverage with a retained return target | Shared HEAD does not imply shared scope. Only validated crosswalk data enables transfer; no name-based link or empty future control. |

Within a selected scope, the central overview leads with matching historical objects and their pagination. Coverage details follow in a compact disclosure containing the complete type/time entry points and counts. Label full recorded ranges as record coverage, not the active numeric filter. During saved-view initialization, keep section positions and fixed references visible, but withhold editable placeholder filters until restoration finishes.

Period definitions must come from evidence. When absent, explain the coverage gap in existing details rather than a permanent empty period control. The module's required bilingual, keyboard, draft/return, batch, CAS and backup checks remain unpassed until implemented and exercised. This addition does not revise the existing source/date contracts above.
