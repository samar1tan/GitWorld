# Historical data: production and consumption

Design contract · 25 October 2026 · Implementation is incomplete

GitWorld's smallest independently reviewable semantic unit is an **assertion with evidence and qualifiers**. Its main exploration unit is an **object's recorded state and changes**. A historical continuity path connects supported states. A view selects and presents shared records. Neither a modern nation-state nor a pre-authored topic page is the universal data container.

This contract extends the [data-workspace requirements](data-workspace-prd.md). It describes the required model, not capabilities already present in the application.

Automatic mapping into historical state is the primary value. Versioned rules should materialize supported observations and change candidates without requiring a curator to hand-author every row or page. Manual review addresses ambiguity, missing evidence and modeling choices. Data revisions record modern imports, corrections and research edits; they are auxiliary and must not be mistaken for the modeled evolution of historical subjects.

## Distinct units

| Unit | Meaning | Identity and review boundary |
| --- | --- | --- |
| Source record and snapshot | What a provider supplied at a particular revision/retrieval. | Provider plus external ID identifies the record; revision/content hash identifies the snapshot. Refreshing does not invent another entity. |
| Historical object | A referent such as a polity, place, person, institution, event or artifact. | Stable local ID, typed descriptions and inspectable external matches. Names, present-day countries and coordinates alone cannot establish identity. |
| Assertion | A subject, property or relation, value/participants, temporal and other qualifiers, sources and review status. | Assertions can be independently supported, disputed or corrected. A relation may have multiple participants and roles; it need not be flattened into an unqualified triple. |
| Recorded state | An explicit combination of applicable assertions for an object, time and modeled dimensions. | Retains supporting assertion IDs, unresolved alternatives, applicability and the selection/mapping rule. A snapshot is not proof of complete knowledge. |
| Historical continuity path | Supported continuation, divergence or integration between recorded states. | Relation type, evidence and modeling choice are explicit. Shared geography, names or source categories do not establish ancestry. |
| View | A selection of objects, assertions, states and relations, presented as a map, timeline, table, graph or comparison. | Stores query/scope and display settings, not a separate copy of the subject matter. An authored explanation can supplement it. |
| Editorial commit | A frozen content change in the local data repository. | Its date records the edit. It does not create an ancient event or change the historical date of an existing assertion. |

The provider's statement rank is not GitWorld's historical certainty. In particular, a current preferred value does not automatically apply to an earlier century. Wikidata's statement and qualifier models illustrate why values, context and competing statements must survive acquisition. [Statements](https://www.wikidata.org/wiki/Help:Statements), [qualifiers](https://www.wikidata.org/wiki/Help:Qualifiers).

## Temporal applicability

An assertion's `validTime` retains its source start/end or point, precision and calendar. The optional `validTime.certainty: "possible"` means that applicability throughout that temporal scope is possible rather than definite. It does not judge the truth of the whole claim, replace historical review or assign a probability. An omitted value preserves the existing interval/point rules. Source rank never sets this field.

A competing chronology can therefore retain its complete published start/end while contributing to `possibleValues` and an uncertain state, including a one-year candidate. Outside its supplied range the field remains unknown unless other evidence applies. Possible and definite claims can coexist; no candidate silently overrides a supported value. Unknown or unsupported dates remain source material rather than receiving invented boundaries.

This field is part of the first, unreleased v1 model contract. Invalid values are rejected. A reader that does not implement this temporal-applicability rule must reject collections using it rather than silently treating possible scopes as definite. An optional field is not permission for an older reader to discard the semantics.

## From a source to a usable object

1. **Discover:** a person searches names and uses supported filters. Results describe their actual source, type, available dates/places and incomplete coverage. No natural-language reasoning is implied.
2. **Acquire:** the app saves stable source identity, immutable input snapshots, rights metadata and recoverable job progress. Fetching is not historical validation.
3. **Reconcile:** matching rules propose local identities and preserve ambiguity. The user inspects uncertain matches in the application; names alone never merge records.
4. **Adopt assertions:** versioned mappings transform supported properties while preserving source values, qualifiers, precision, calendar, evidence and alternatives. Repeated straightforward mappings can be reviewed in batches; exceptions remain visible. Unmapped properties stay readable material.
5. **Model states and continuity when supported:** the user adopts or authors state observations and evidence-backed transitions. A material record needs no historical parent. An observation is not automatically a transition; two observations alone do not locate the date of a change between them.
6. **Commit:** working changes, frozen staging and commit are the same workflow for imported and manually authored content. Local unreviewed material may be committed with its status; committing does not confirm its claims or authorize redistribution.
7. **Explore and update:** query indices project the selected repository revision into reusable views. Refresh compares previous source, incoming source and local edits. Corrections appear in all views using the new revision while pinned older comparisons remain reproducible.

The pipeline supports both source-only material and modeled history. It must not turn every input row into a historical branch merely to reuse an existing renderer.

## What the user can ask of each representation

A person researching cities and political centers can begin with a period and region, inspect available places, open one city's object record, examine dated relations and compare supported observations. The same city can appear in a regional view, a political-center view and an individual object's history. Adding a sourced relation updates these selections through the shared content model; it does not require another page or frontend code.

The representation must follow the available evidence:

- A supported coordinate permits a map location; it does not establish a historical territory, boundary or sovereignty.
- A dated observation permits a timeline entry; an undated record remains accessible in search and the material list.
- Applicable dated assertions permit a state inspection and comparison, including unknown or disputed fields.
- Explicit supported continuity relations permit a historical branch graph. An upstream successor field is a candidate for review, not automatic field inheritance.
- A statement that two places participated in a trade network does not by itself establish the direction, intensity or historical causation of exchange.

Unknown location, unknown time and unresolved identity are query states, not grounds to discard material or fabricate display coordinates. Counts distinguish source records, assertions and modeled states.

## Automation without an LLM

Ordinary application code can search names, traverse typed relations, apply versioned mappings, index intervals, filter a collection, compare states and render results. These operations do not require a prewritten page for each topic. Saved views are parameterized queries; curated narratives are optional content built on the same records.

Software cannot reliably infer an institution's evolution, a contested historical identity or a rich explanatory narrative from missing source data. Human contribution remains necessary for those interpretations and must be supported by usable editors. An LLM is neither a runtime dependency nor a way to hide missing evidence. The release must offer explicit lookup, filters, mapping rules, review and editing controls, not arbitrary question answering.

## Developer boundaries and current gaps

Adapters acquire provider records; they do not manufacture historical states. Reconciliation and assertion mappings are separately versioned domain operations. Query/view code consumes the content model rather than branching on example IDs. A renderer change is appropriate for a new reusable representation, not for each new city, polity or period.

The current runtime already replays historical changes and loads additional validated packages without rebuilding. However, its `HistoryValue` is a state field, not a standalone assertion store; `HistoryBranch` requires one scope and process; and the legacy Met adapter creates a branch for each artifact. Independent entities, source snapshots, conflicting assertions and query-generated views require further implementation. Existing graph tests do not prove those requirements.

Acceptance must include an unprepared subject acquired and edited through the installed application's controls, visible in two applicable views, followed by refresh, restart and restore. No code/seed edit, developer command, hidden data injection, Codex intervention or LLM call may repair the journey. An agent may operate the shipped interface as a tester; it may not act as missing product functionality. Such testing also does not constitute a human usability study.
