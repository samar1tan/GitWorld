# Learning with GitWorld

Product contract · 25 October 2026 · Required for v0.1; implementation is incomplete

GitWorld should help a learner turn a historical question into an investigation that can be checked, extended and revised. Its lasting output is a local body of sources, adopted assertions, comparisons and research records. Opening a prepared example or collecting more source rows does not establish this learning workflow.

## The learner's repeated workflow

1. **Choose a question and scope.** Begin with the world overview or a name search, then choose a period, region, subject types and comparison dimensions. A question is the learner's own editable title/note. Explicit filters control retrieval; typing a question does not ask a model to generate an answer.
2. **Build a useful local collection.** Acquire a reproducible, bounded public-data subset or import a larger local file. Preview the actual types, dates, places, claim coverage and limitations. Reusable mappings and batch adoption handle repeated structure; an exception queue holds ambiguities. A new subject must not require a new page, code change or developer intervention.
3. **Inspect the setting and focus.** Maps, time views, object lists and typed relations come from the shared local collection. The learner narrows a broad setting to particular objects and observations, then returns or follows a lateral connection. Undated/unlocated records remain accessible without invented dates or coordinates.
4. **Compare and trace.** Inspect one object's recorded states over time or compare applicable dimensions across contemporary objects. Distinguish observed change, model inheritance, unknown coverage and incompatible concepts. Follow a field or relationship to the assertions and source revision supporting it. An ordering in a source is not automatically a historical ancestry chain.
5. **Record a provisional understanding.** Save the question, scope/query recipe, selected evidence, fixed comparison endpoints, a short interpretation and unresolved questions as a research record. The interpretation is the learner's note; it does not silently become an adopted historical fact. No essay, quiz or teaching script must be generated to make the app useful.
6. **Commit a meaningful increment.** Inspect the changes to adopted material, model and research record, stage a coherent increment and write a reason. The commit records what the learner added or revised and which evidence they used. Its date is editorial, distinct from the historical time being studied.
7. **Return with new evidence.** Reopen the investigation after restart, refresh sources or extend the scope, inspect the incoming difference and revise the interpretation. Revisit the older record and its evidence. The learner should be able to explain what changed in the model or their understanding and why.

The same person can read, curate and contribute. They should not need to enter a separate schema-administration mode to advance an investigation.

## Two useful kinds of change

| Question | Operation and result |
| --- | --- |
| What is recorded as changing in the past? | Historical state comparison and trace, using dated assertions and supported continuity relations. |
| What have I added or revised in this investigation? | Repository diff/log over sources, adopted model content and research records, with editorial reasons and reproducible prior revisions. |

Historical paths and editorial branches retain different meanings. A historical split requires evidence about the past. A working branch can hold an alternative modeling decision or a separate contribution. A beginner can complete the main learning loop on one working branch; branch creation is not mandatory ceremony for each question.

## Data volume must create usable coverage

A large raw archive is insufficient. The imported subset must produce ordinary searchable objects and adopted, dated assertions where justified. It must participate in applicable map/time/relation/state/comparison views through reusable rules. Show counts of source records, objects, dated assertions and modeled states separately. Inspect sampling and missing fields; do not advertise the raw row count as historical coverage.

The initial scale acceptance includes at least 1,000 real source records and a separate controlled 10,000-record performance test. These are test workloads, not a product cap or permission to ship a thousand unusable rows. The real subset must exercise several self-selected investigations, including a region/period absent from the seed. Bulk discovery/import must work through the application. Users must not gather thousands of external IDs or repeat a form for every row.

Sources will not automatically supply every institution, continuity relation or interpretation. Where a reusable mapping cannot establish a state or ancestry, retain the source material and explicit gap. Provide usable editors and batch review for justified additions. Do not replace missing evidence with model-generated facts, a prewritten topic page or an arbitrary sequence of branches.

## Minimum research record

The persisted record needs stable identity, title/question, explicit scope/query settings, evidence references, fixed comparisons, a short editable note and unresolved items. Evidence and comparison references include their data-repository revision. A saved query can deliberately follow the current library; fixed evidence and comparisons stay pinned. Refreshing data must not silently rewrite the basis of a past conclusion.

New fixed comparison endpoints retain available names from their exact snapshot as an optional language map. Changing interface language selects only those saved snapshot names, with an explicit English marker when applicable; it never fetches a Working rename. Older records containing only a scalar label remain readable without guessing its language or rewriting their stored basis.

An unfinished form is recoverable input, including a new investigation with no question yet. Leaving preserves it without creating working changes; explicit Save creates or updates the record. Replacing that form with another investigation requires a choice to save or explicitly discard it, and discard never deletes a previously saved record. Recovery failures retain the form and block leaving rather than imply that input was saved.

This is a small versioned investigation record, not a general-purpose notes application. Sharing, flashcards, automated assessment and AI explanation are outside this requirement.

## Proof before release

Use only the installed app's shipped controls/commands and documented file selection. Begin with a topic not prepared in the seed. Acquire/adopt a substantial subset, locate objects in applicable views, compare, inspect evidence, save a research record, commit, restart, refresh or correct, and explain a changed conclusion against the older record. Record failures and interventions. Agent operation is interface testing, not a human learning study.

The current source browser is only the discovery/acquisition/material-inspection portion. The old package manager and fixed starter journeys do not satisfy this contract. See [module acceptance](data-workspace-prd.md#acceptance) and [the data model](data-model.md).
