# Evidenced political and institutional transformations

Document v0.4 · 25 October 2026 · V5 assembled; bounded C05 content increment proposed; installed acceptance pending

## User outcome

A learner must be able to explain what changed between two historical states and inspect the evidence for the relationship. A ruler changing, an office losing its holder and a constitution changing that office's powers are different observations. A political integration needs explicit historical evidence, not a line drawn between adjacent ruler lists.

This module supports C04/C05/C06 of the [China/Japan case](acceptance/china-japan-v0.1.md) within its [coverage inventory](acceptance/china-japan-coverage.md). It builds on the existing knowledge assertions, source bindings, state/diff and entity navigation. It introduces no region-specific renderer, AI dependency, new repository HEAD or automatic Git ancestry.

## Scope and dependencies

The first content increment connects an explicitly documented integration to existing concurrent political contexts and adds comparable legal-role fields to an existing institution. The larger ancient-to-modern structure remains the inventory's responsibility. This increment does not claim comprehensive territorial control, an exhaustive political ontology, or a history of every constitutional interpretation.

Inputs are fixed source snapshots, a versioned inspectable extraction/binding plan, known target identities, and a field vocabulary. The plan separates literal source fields from authored interpretation, identifies the evidence needed for each target claim and provides complete English/Simplified Chinese labels. Raw source pages remain in the local acquisition archive. An output candidate contains selected facts, derived claims, source/interpretation provenance and exceptions.

Source fetching and mapping are separate capabilities. Existing installed Wikidata and public-collection acquisition paths must not be described as supporting a new Wikipedia infobox or official document merely because a curator fetched it. The normal acquisition, profile selection, preview and adoption path remains an explicit integration dependency.

## Typed political relationships

Represent an integration or division as a typed historical event/process object, with dated assertions linking its participants by explicit roles. A minimal vocabulary is:

| Property | Value and meaning |
| --- | --- |
| `transformation:incorporating-polity` | Entity assuming the source-stated incorporated political control; does not assert modern borders or universal recognition. |
| `transformation:incorporated-polity` | Entity explicitly identified as incorporated; does not erase people, institutions or later claims. |
| `transformation:stated-outcome` | Controlled value for the documented outcome, with source wording and interpretation kept separately. A military victory alone cannot become integration. |
| `relation:integration-event` | Entity link from a participant to the same evidenced event. Role remains a qualifier; this is an investigation link, not a parent edge. |
| `transformation:source-date` | Original dated fact with its uncertainty, precision and source calendar; activity duration and outcome date remain distinct. |

Other transformations can use different declared participant roles without frontend code. No role is inferred from source order, a predecessor/successor field, a name match or one reign ending before another begins. An infobox predecessor field can be retained as a source claim but cannot by itself create an incorporation assertion. Missing participants, conflicting identities, an outcome lacking explicit support and incompatible dates remain exceptions.

Keep an event's applicability bounded to the supported event time. A link to a past event must remain accessible in an object's source/relationship record even when that event is outside the currently selected annual state. Do not extend the event's duration indefinitely to keep a navigation edge visible. A later political state needs its own supported assertions; neither victory nor incorporation automatically copies the winner's fields to the other polity.

## Comparable institutional fields

Keep the institution's identity separate from its incumbent and its constitutional text. Initial generic fields are:

| Property | Value and meaning |
| --- | --- |
| `institution:legal-framework` | Entity identifying the applicable legal instrument/version. |
| `institution:constitutional-role` | Controlled value describing the role expressly defined by the instrument. |
| `institution:government-powers` | Boolean only where the source supports the assertion or explicit negation. This is normative authority, not a measurement of actual political power. |
| `institution:acts-basis` | Controlled rule such as ministerial countersignature or Cabinet advice/approval; no missing rule becomes `false`. |
| `institution:legislative-relationship` | Entity and controlled role where a source explicitly defines legislative participation or designation. |

Legal adoption, promulgation, enforcement and any later repeal/amendment are distinct facts. Each projected institutional field cites the relevant article and the temporal evidence for applying that article. A legal text's issue date alone cannot establish an open-ended historical state. A later source explicitly reporting an unchanged text may support a bounded continuity window; preserve that report's as-of time as an evidence limit, never as a repeal event. Outside the supported window, the field remains unknown.

An explicit replacement boundary can delimit an earlier legal version through an inspectable temporal rule. Preserve the original boundary date and whether it is inclusive/exclusive. The current state engine tests overlap with a civil year: two definite regimes in different parts of one year can produce `multiple`. Retain both dated intervals and explain this annual aggregation; do not imply simultaneous roles or select 1 January or 31 December silently. Genuinely uncertain applicability remains possible/uncertain. Sources with different or unspecified calendars remain explicit. Do not turn a date conversion or a coverage limit into a new historical event.

The same holder before and after a reform can therefore coexist with changed legal-role fields. A constitutional reform does not require inventing a new emperor, court, country or ancestry edge. Cabinet, Diet and prime-minister office remain distinct entities when separately supported.

## Provenance, review and rights

Every projected claim remains unreviewed and records its plan/rule version, original source fact locators, exact source revision or byte hash, temporal evidence and authored interpretation. A source field's text and a bilingual paraphrase have different provenance. Claims remain individually rejectable and editable. An updated source or profile must produce a before/after preview; it cannot silently replace a previously reviewed interpretation.

Selected Wikipedia-derived facts retain the fixed revision, author-history URL, CC BY-SA 4.0 attribution and modification statement. Official publication is not itself a redistribution license. Record the terms applying to the exact official page and any third-party text exception; keep unresolved rights unknown. Do not distribute raw HTML, images, long source prose, archive scans or the complete document merely because a small factual interpretation is useful. Candidate content and display vocabulary require independent exact review before bundling.

`includeText` governs retained source expression throughout a selected field, including anchor labels. With it omitted or false, projection retains link URLs, relative source locators and normalized anchor-text hashes, but no anchor text, even a short legal-article label. There is no implicit allowlist based on label length or apparent subject matter. Text can be retained only by an explicit `includeText: true` rule and an allowed source permission; an unknown/restricted source blocks that rule. Local inspection may show acquired text for review, but that inspection result is not the distributable projection. Raw-source permission and selected-fact/original-interpretation rights remain separately reviewable; omitting expression does not itself change unknown rights to allowed.

Normalization and a curator's distribution-rights decision are separate stages. The normalizer keeps aggregate rights unknown when the acquired NDL/MEXT works remain unknown. A subsequent owner-prepared selected-output scope may propose redistribution of only the reviewed factual record and original interpretation, supported by exact policy clauses and without changing those acquired snapshots. Bind that scope to the pre-promotion source-record hash, source identities/revisions/hashes, every selected fact ID/record hash, the retained/excluded fields and the authored objects/statements/vocabulary. This avoids both circular hashes and reuse of a decision for different source expression. The scope must distinguish bare legal facts from the license on original presentation or compatible adapted content; it cannot license an unknown English translation or whitepaper paragraph.

For a candidate, attach this scope as English metadata, retain the original normalization rights and source-work permissions, then rebuild the derived source hash/identifier and its assertion/evidence references. Verify each subject, value, temporal scope and historical review remains unchanged. A pending scope is not independent approval: exact content/rights review, root review and the publication/release gates still apply. This curator publication-preparation step does not add a runtime permission inference, a new acquisition provider, or an installed review control.

## First source proposals

### Integration in the Three Kingdoms/Jin setting

Use the fixed English Wikipedia [Conquest of Wu by Jin, revision 1379420937](https://en.wikipedia.org/w/index.php?oldid=1379420937). Its infobox explicitly separates belligerents, victory and territorial outcome, rather than merely listing the last Wu ruler. Extract the selected infobox fields deterministically; keep the campaign's uncertain 279/280 start distinct from its stated 280 conclusion. Bind the source's Jin participant to an existing phase only with explicit identity/context evidence; the general Jin-dynasty article identity must not silently merge Western and Eastern Jin.

The existing Wei, Shu Han, Eastern Wu and Western Jin contexts provide surrounding concurrent ruler states. This event does not complete the earlier Shu/Wei conquest or Wei/Jin transfer: those require their own evidence. It is a first connected integration investigation within the larger setting, not a substitute for all Chinese divisions and integrations.

### Japan's constitutional role before and after 1947

Use NDL's English [Empire Constitution](https://www.ndl.go.jp/constitution/e/etc/c02.html), especially Articles 4/5/55, and the [Constitution of Japan](https://www.ndl.go.jp/constitution/e/etc/c01.html), especially Articles 1/3/4/41/65. Use separate official evidence for [1890 enforcement](https://www.mext.go.jp/b_menu/hakusho/html/others/detail/1317324.htm) and [1947 enforcement](https://www.ndl.go.jp/constitution/e/outline/05outline.html). The throne's legal status can change while its incumbent remains the same.

NDL's [glossary](https://www.ndl.go.jp/constitution/e/etc/glossary.html) explicitly describes the earlier constitution's unamended history. A later dated legal-history source can bound continuity of the newer text; for example the Law Library of Congress [February 2006 report](https://tile.loc.gov/storage-services/service/ll/llglrd/2019669658/2019669658.pdf), section XI, reports no amendment to that date. This is not a claim about amendments after that report or unchanged practical powers. Prefer exact official document metadata and independently authored field labels over reproducing document prose.

NDL's current [content terms](https://www.ndl.go.jp/sitepolicy/terms) use PDL1.0 with third-party exceptions. The older English translation names Ito Miyoji, so that exact text's status requires separate review. The module may retain a local research candidate without declaring that raw translation redistributable.

### A bounded 263/266/280 political comparison and 708 coinage change

The next candidate closes two missing links around the already sourced 280 event, rather than adding another ruler list. Use fixed editions of the English Wikipedia [Conquest of Shu by Wei, revision 1373985551](https://en.wikipedia.org/w/index.php?oldid=1373985551) and [Jin dynasty (266–420), revision 1359294647](https://en.wikipedia.org/w/index.php?oldid=1359294647), together with the existing pinned *Conquest of Wu by Jin*. Inspect exact infobox and paragraph fields before binding roles. A stated fall, conquest, abdication or dynastic replacement supports different mechanisms; a date and two adjacent dynastic names alone support none of them. Preserve the campaign's approximate months and any 265/266 calendar or source ambiguity. A year-resolution comparison need not choose an unsupported day.

Add these generic fields without changing the existing integration assertions:

| Property | Value and bounded meaning |
| --- | --- |
| `transformation:outgoing-polity` | Entity whose source-stated rule ends or is displaced in this event. This is not a Git parent and says nothing about every institution or population. |
| `transformation:incoming-polity` | Entity the source explicitly identifies as assuming or replacing that rule. Binding a general dynasty article to a phase requires independent phase evidence. |
| `transformation:mechanism` | Controlled value such as `military-conquest` or `dynastic-replacement`; neither is inferred from a predecessor link or tenure boundary. |
| `relation:political-transition` | Dated entity link between a participant and the same event, qualified by its incoming/outgoing role. It does not manufacture a continuous state after the event. |

The same fields allow an ordinary state/diff comparison of the 263, 266 and 280 event objects. Participant relations connect Cao Wei across the first two events and Western Jin across the latter two. This is a sequence for investigation, not proof of a single cause, universal territorial continuity or inevitable unification. Existing polity and holder records provide concurrent context. Do not create a timeless China object or a synthetic government that silently inherits every predecessor's fields to make the comparison look complete.

For C06, use the Bank of Japan Currency Museum's English [historical currency account](https://www.imes.boj.or.jp/cm/english/history/content/index.html). It explicitly identifies the 708 Wado Kaichin issue and its Tang Kai Yuan Tong Bao model. Keep the material coin type, source-described issuing government and transmission/issuance event separate. The source's general account of contact and institutional borrowing is background, not evidence that a named mission carried the design.

| Property | Value and bounded meaning |
| --- | --- |
| `coinage:issued-type` | Coin-type entity explicitly associated with an issuance event or a documented recipient observation. The assertion applies at the supported date, not throughout the government's presumed lifetime. |
| `coinage:issuer` | Source-described authority entity. This does not bind an unnamed issuing authority to an emperor merely because that emperor held office. |
| `transmission:source-model` | Material or institutional entity that the source expressly identifies as the model; this is not an ancestor or a claim of complete copying. |
| `transmission:recipient` | Entity explicitly described as receiving or making the change, with the source's scope retained. |
| `transmission:model-context-polity` | Polity explicitly associated with the model. This does not identify an active transfer, sponsor or carrier. |
| `relation:transmission-event` | Dated participant-to-event link with the model/recipient/produced-type role retained. |
| `transmission:documented-change` | Controlled value for the source-supported change, such as a modeled coin issue, rather than a promotional description or an invented before value. |
| `coinage:production-attestation` | Source-supported production evidence, with possible period timing where the source supplies only a broad range. An archaeological discovery date remains evidence metadata. |
| `coinage:earlier-mintage-evidence` | Link to independently dated earlier production evidence; it does not assert a predecessor, common issuer or model. |

At 708 the recipient can have a documented coin issue and the produced coin can have a documented model. The recipient's specific 707 coinage state remains unknown unless separately supported. Earlier Fuhon-sen evidence prevents presenting Wado Kaichin as Japan's first coin; the museum's archaeological statement supports earlier production evidence, but does not identify the same issuer or prove a year-by-year prior regime. The proposed identification of Fuhon-sen with the 683 rescript remains a separate uncertain interpretation. No named envoy is assigned as a carrier, and no day, universal circulation, metal standard, or administrative before/after value is invented from the 708 year.

The candidate represents the source's latter half of the seventh century as the ordinal civil-century interval 651–700, retaining the source wording and possible applicability. It is not a claim of minting in every year of that interval. The reported 1998 discovery is a separate qualifier and never supplies a historical minting date.

Both increments reuse `inspectPublishedFields` and `projectEvidencedFields`; the plan contains exact source/revision/byte pins, selected-field hashes and temporal fact keys for every applicable claim. New object, field and controlled-value presentation is complete in English and Simplified Chinese. All claims remain unreviewed. Wikipedia-derived selected facts retain compatible attribution and modification notices. Museum raw HTML, images and translated prose stay local with unknown rights; any selected-fact/original-presentation rights scope is a separate exact decision, not an automatic consequence of omitting text.

Candidate acceptance requires deterministic replay through the ordinary collection parser/index, no source or field substitution, source/field-change rejection, unreviewed and unknown-rights preservation, connected entity links and meaningful generic state/diff output. It must demonstrate the unsupported before state as unknown. Candidates remain local until independent exact content/rights review and root review; a successful replay does not pass C04/C06 or the installed source-profile journey. This increment adds neither an official-page provider nor a shipped special-topic profile.

## Minimum court, office and constitutional-text observations

This C05 increment adds three connected investigations through fixed English Wikipedia evidence and the existing generic field mapper. It adds no source provider, renderer/topic branch, officeholder list or Cabinet continuity model. Its output remains a local candidate pending independent exact content/rights and root review; the v5 bundle is unchanged by this proposal.

**1392 settlement.** [Nanboku-chō period, revision 1376607470](https://en.wikipedia.org/w/index.php?oldid=1376607470), explicitly describes the Southern Court's concession, transfer of regalia and agreement for alternating succession. One year-resolution event connects the existing Southern/Northern Court imperial-claim contexts through `settlement:conceding-claim`, `settlement:receiving-claim`, `settlement:undertaking` and dated reverse `relation:political-settlement` links. The same source's 1412 breach can qualify the promise; an agreement does not prove fulfillment. Do not turn this into conquest, state merger, extinction of every later claim or a legitimacy judgment. The source's retrospective 1911 ruling is not a 1392 state. A period infobox beginning in 1336 does not set the settlement's start.

**1885 office replacement and co-dated Cabinet formation.** Use [Prime Minister of Japan, revision 1381481198](https://en.wikipedia.org/w/index.php?oldid=1381481198), for its explicit replacement sentence/formation field, and [Cabinet of Japan, revision 1380720045](https://en.wikipedia.org/w/index.php?oldid=1380720045), for the distinct formation fact. One event links the existing 1871–1885 Daijō-daijin context and prime-minister office through `institution:replaced-office`, `institution:established-office` and reverse `relation:institutional-change`. Preserve 22 December 1885 and `institution:cabinet-formation-date`. Do not infer replacement from a precursor field or tenure endpoints, create a continuous Cabinet entity, copy later appointment powers into 1885, or move the existing 1947 constitutional-role object's origin backward. Only the selected 1885 evidence is interpreted.

**Four constitutional texts.** Keep separate legal-instrument objects and dated observations at source-stated adoption dates: [1954, revision 1381716772](https://en.wikipedia.org/w/index.php?oldid=1381716772), [1975, revision 1381716802](https://en.wikipedia.org/w/index.php?oldid=1381716802), [1978, revision 1381716847](https://en.wikipedia.org/w/index.php?oldid=1381716847), and [1982 text/history, revision 1381706343](https://en.wikipedia.org/w/index.php?oldid=1381706343). Compare only two source-described provisions initially:

| Field | Bounded meaning |
| --- | --- |
| `constitution:source-listed-head-of-state-provision` | What the source comparison table lists under “Head of state”: State President or explicit None. None means no head of state is listed by that table; it does not represent an independent review of every original article, absence of all state representation, or effective political power. |
| `constitution:premier-nominator` | The separately listed premier-nomination authority: State President or CCP Central Committee. A holder's identity cannot supply this rule. |

The source table shares cells across 1975/1978 and across later columns. Pin the whole source and complete headers; retain physical cells, logical columns and spans in the plan. Reject ambiguous selectors and column drift. Preserve the distinction between original-text/amendment/current columns. The 1982 article's broad “Supersedes: Common Program” infobox cannot establish a direct 1982-to-1949 replacement.

Declared `tr` element selectors must use the same bounded inspection/projection contract as the other permitted textual elements: exact hashes, one matching row and the existing text-retention rights rules. Duplicate rows block the profile; this does not permit arbitrary tags or an unqualified first-row selection.

Only the 1975 explicit abolition sentence supports `institution:abolished-office` to the existing 1954 state-chairman object. Only the 1982 explicit restoration statement supports `institution:restored-office` to the separate 1982 president object. Reverse `relation:institutional-change` links keep those identities separate. The table's None value, a missing holder or a list gap never supplies abolition evidence.

Adoption/ratification is not automatically enforcement. These are dated text observations, with original date precision/calendar retained; they do not fill continuous legal-effect windows or extend original 1982 provisions to 2026. An unsupported before state remains unknown. A comparison may show the selected fields changed or unchanged without implying that no other constitutional changes occurred. All field/value/object labels and authored interpretation require complete EN/zh-CN presentation.

Each claim needs fixed source URLs in its primary evidence, exact snapshot/selected-field hashes, source-language citations, actual author-history links and the inspectable typed plan. Retain CC BY-SA 4.0 attribution/modification notices; raw HTML, paragraphs, anchor labels and images remain local. Demonstrate ordinary collection/paired parsing, meaningful state/diff and connected links, source/field/header-change rejection and unchanged v5 history before review. Local replay cannot pass installed C05 or supported-profile acceptance.

## Ordinary consumption and acceptance

The v5 bundled source assembly now contains the connected 263/266/280 and selected coinage outputs, alongside the earlier political and constitutional extensions. Their exact selected-output metadata, factual payloads, source bindings and ordinary bundle readback were independently checked. All v4 historical records remain unchanged. This assembly does not pass installed investigation or add a provider/profile control that the user can operate; those acceptance boundaries below remain required.

Output uses the existing `KnowledgeCollection`, field catalog and source-rights sidecar; it needs no new domain value kind. Entity values support ordinary navigation and the same state/diff/query paths. A reusable mapper accepts a fixed snapshot plus a declarative source-field profile and emits selected source facts; explicit binding rules emit the historical roles and institutional fields. A local curator script is not a shipped mapping interface.

The ingestion APIs separate `inspectPublishedFields(snapshot, requests)` from `projectEvidencedFields(collection, snapshots, plan)`. Inspection returns acquired field text, locators and hashes for review. Projection requires exact source and selected-field hashes before emitting any typed object or statement; absent or changed required evidence blocks the cohesive profile. It preserves source citation/edition/language, compatible rights, authored interpretation and temporal evidence, and never upgrades the input's review. PDF-page selectors consume an already extracted, hash-bound source snapshot with the PDF byte hash and extraction version; they do not provide or advertise an installed PDF importer.

The existing trusted bundle can carry the new collections and field-catalog overlays. The ordinary file importer currently reads a collection, so a separate vocabulary sidecar does not automatically become installed display metadata. New-source integration must validate, associate and persist that vocabulary at the same data revision as the adopted claims. A collection that parses successfully does not by itself prove bilingual field reading, source acquisition or mapping review in the installed app.

The minimum installed integration is one bounded source job: acquire an explicitly supported fixed-host source, archive its snapshot/receipt, inspect or select a source profile, and persist the exact projected collection, plan, field catalog and exceptions as one hash-bound preview. Adoption reuses that preview, the user's explicit review choice, append semantics and existing working-tree guards; it does not rerun a moving upstream source. Vocabulary must travel through the same review and repository revision as the claims, including conflicts and missing translations. Reopen/restart must reproduce both evidence and display without a developer script. This requires provider/contract and service integration; this module does not add those routes or claim PDF acquisition support.

Keep that integration bounded to the existing workflow:

1. Extend the collector/archive's provider contract for an explicitly supported fixed-host Wikipedia page/revision. Preserve raw snapshots and cancellation/backpressure/resume semantics. Do not treat the current Wikidata `entityIds` collector as that implementation or accept arbitrary renderer-supplied URLs.
2. At the job-preview boundary, select an inspectable `profileId`/version and a fixed library revision. Store the normalized collection, exact plan, field catalog and exceptions under the job; bind all of them into the preview fingerprint. Source inspection may expose original-language fields, while interpretation labels remain separate.
3. At adoption, read the stored preview rather than fetching or selecting another profile. Reuse append-observations, explicit review choice and existing HEAD/input/content guards. Persist validated field vocabulary with the claims in versioned repository content; a field-label conflict must not silently replace a local correction.
4. Read display vocabulary from the same working/staged/fixed revision as the selected claims, with missing/conflicting translations explicit. Include new vocabulary in dependency-aware staging, backup and restart checks. Arbitrary imported fields may retain honest fallback labels; product-authored bundled content still requires both locales.

The collection-only file path remains useful, but does not imply paired vocabulary adoption. A future file-sidecar choice must use host-issued file tokens and the same bounded parser/preview guards. No new control should advertise these paths until the service and actual journey work.

The first consumption increment accepts one bounded `gitworld-knowledge-import` JSON envelope containing a collection and an optional vocabulary with its own identity, revision, provenance and rights. It uses the existing file-token workflow. A version-2 preview binds the exact collection, vocabulary, projection plan, exceptions and rights metadata; adoption requires its persisted preview identifier and the reviewed HEAD. Changing the selected file after preview rejects a new adoption. Accepted retries use a durable prepared/completed receipt, preserve subsequent working edits and do not require a still-live file token. Existing collection-only files and source jobs retain their contracts.

Vocabulary is display metadata, not a historical assertion. Its immutable source record and active catalog reference enter the same Git working tree as the claims. Working and frozen-tree reads resolve both from one snapshot; fixed comparisons retain each endpoint's catalog. Dependency-aware staging includes the relevant catalog reference, source and baseline. Competing vocabulary changes conservatively block the entire paired adoption and return structured differences; this increment does not add a vocabulary editor. Missing external translations remain explicit. Legacy revisions lacking catalog bytes use a separately identified, library-pinned compatibility catalog and never acquire a fabricated historical catalog or rewritten OID.

Prepared previews, retry receipts and the legacy catalog pin belong to complete library backups and are validated before restoration replaces the current library. Partial multi-file writes remain recoverable and cannot be committed as a completed paired import. No import review choice or rights sidecar upgrades unknown redistribution rights. This backend increment still requires GUI integration and installed acceptance; fixed-host Wikipedia acquisition and profile selection remain the next separate integration step.

An accepted paired import with no confirmed receipt must be retried with its original operation identifier before another content adoption, manual correction or HEAD-changing action. Read-only exploration, recoverable form input and complete backup remain available. This prevents an unrelated commit from stranding a prepared import at an obsolete HEAD. Completed retries return the original receipt and do not replace later working content.

Ordinary users must be able to recover an accepted import after restarting the application without its original file token or hidden request state. A read-only pending-import list exposes the operation identifier, prepared-preview identifier, base HEAD, counts and vocabulary identity, excluding raw payloads. Resuming that exact pair reuses the accepted plan and CAS guards, preserves its original review choice, and never fetches, maps or selects a file again. Repeated resume returns the same completed receipt; a different preview identifier is rejected. The existing serial/maintenance barriers apply. The Imports and matches UI must expose this recovery before the installed file journey can be accepted.

The subsequent [bounded Wikipedia backend increment](source-bindings-prd.md#bounded-wikipedia-acquisition-and-mapping-increment) provides fixed English-page archival, table inspection and selected tenure/dated-entry profiles through the paired importer. This supplies a reusable acquisition boundary; it does not automatically register the curated integration, constitutional-field, authority-qualified or activity-context plans described here. Their own supported-profile registration and review remain explicit work. Wikipedia GUI integration and the ordinary installed C08 journey are still required, independently of backend and curator-script evidence.

Acceptance requires a second synthetic compatible source profile to use the same mapper; source/header/hash changes to stop with an exception; original records/review unchanged; explicit positive and negative legal rules; unknown outside supported time; a transition year retaining both dated regimes without implying simultaneity; a real integration supported independently of ruler intervals; all field/type/value labels in both locales; and merging through the normal collection parser without conflicts. Installed navigation, evidence reading, editable/staged changes and restart remain separate required checks. C04/C05 cannot pass from the existence of a source proposal or candidate JSON.
