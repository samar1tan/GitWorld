# Curated starting data

The installed library includes the separately licensed [East Asia source collections](seed/east-asia/README.md): 1,214 bilingual objects and 4,018 source-based claims in twenty-two ordinary `KnowledgeCollection` shards. The pinned v8 bundle retains six source-specific archaeological definitions, a 1392 divided-court settlement, an 1885 office replacement and four Chinese constitutional-text observations alongside the connected political and coinage investigations. Two editable research contexts organize selected sources and explicit links; their membership is modern navigation metadata, not national identity or a historical lifespan. Eleven derived-source collections also have original bilingual display names bound to their exact source records, separately from original citation titles. The classification record separates 98 source table groupings from eleven declared offices. The v8 authority-basis correction separates formal tenure from effective authority while retaining the original source claims and prior revisions. Historical claims remain unreviewed. The collection notice records exact source rights and coverage limits; counts do not establish historical completeness or installed acceptance.

Both content forms initialize an empty Git repository using the same object/source/model files read during ordinary operation. Existing libraries are retained. User-selected KnowledgeCollection JSON files use bounded preview and adoption; historical model packages use the authoring draft/review workflow and enter working changes before staging and commit. Authored package revision labels remain metadata; actual repository OIDs qualify fixed historical references.

## Authored historical models

[`seed/early-medieval.json`](seed/early-medieval.json) is an independent schema-1 `DataPackage`, not a renderer fixture. It is a lawful, editable starting corpus: 38 historical versions, 14 paths, 9 processes, 7 fields, 18 cited sources, 4 tags and 1 influence relationship. The desktop initializes an empty store through the normal validation/import path; later edits and imports must use the same storage and query model. Do not regenerate users' databases from this file on startup.

The 28 earlier UED versions and six overview processes have been migrated. Three additional processes and ten versions add usable context and exercise real historical modeling questions. No synthetic test record belongs to this seed. Adapter tests use explicitly synthetic records in `packages/ingestion/src/ingestion.test.ts`.

Dataset identity is `gitworld-curated-history`; the bundled authored revision is `early-medieval-2026-10-25.2`. This pre-publication localization revision is a standalone starting package: it does not require the unpublished `.1` package or replace content in existing libraries. The file's historical `date` values are separate from editorial `revision.createdAt`, source retrieval timestamps and content hashes. The older UED dataset remains an archived prototype input; it is not a second source of desktop runtime facts.

## Scope and modeling decisions

| Paths / records | What is represented | What is not asserted |
| --- | --- | --- |
| Carolingian main, west, middle, east and Lotharingia, 751–870 | Shared states, Verdun's separate outcomes, the 855 division and Meerssen's changes | Exhaustive rulers, complete borders or a direct identity between Middle Francia and Lotharingia |
| `francia/papacy`, 754 | A thematic continuation of Pippin's 751 state to the papal anointing | A territorial split or new sovereign polity; branch names are exploration routes |
| Abbasid court, 750–892 | Selected residence changes and the return from Samarra to Baghdad | Complete succession or a claim that the same ruler persisted between records |
| `andalus/main`, 756 and 785 | An Umayyad emirate and the Great Mosque's construction | Descent from the Abbasid court or uniform control over Iberia |
| Japan court, 710–794 | Six relocations/returns and selected planning characteristics | A complete political history; returning to Nara does not reset all other fields |
| Tang, 618–763, including `tang-ca700` | Selected dynasty/context changes and an approximate Chang'an planning observation | An exact event in 700 or a quantified confidence interval |
| `sui-581`, `chen-557` → `sui-589` | A conquest-related north–south integration with an explicit field-resolution ledger | Peaceful merger, equal sovereignty, or automatic transfer of every Chen institution |
| `japan-buddhism-538-552` | Competing traditional dates for a Baekje royal gift associated with Buddhism's formal introduction | A continuous 14-year event, the first private practice of Buddhism, or certainty before the latest bound |
| Qin, 221 and 213 BCE | Imperial title after the conquests; a recorded policy of destroying texts | Direct ancestry from Qin to the medieval paths or a complete account of the destruction |

The Tang–Nara planning link uses `kind: influence`, separate from parents. Sui integration retains the Sui ruler/house, retains the shared abstract political form, changes territorial/context descriptions, and explicitly leaves residence and planning unresolved. It is an editorial abstraction of cited history. Fields not established by the available evidence stay unknown; they are not absent merely because the source omits them.

A branch's coverage is the query envelope for selected records, not proof of continuous historical completeness. Between dates, `as-of` returns the latest recorded model with both requested and recorded dates. An inherited field's last changed record is visible. `politics.condition` means recorded context: a note about a record should not be read as a continuously true condition of every intervening year. Point dates marked approximate retain that qualification. Alternative dates are bounded conservatively; direct commit inspection remains possible before an interval's latest bound.

English is the content baseline; Simplified Chinese text is GitWorld's translation. Every GitWorld-authored `HistoryText` map in this bundled historical model supplies both `en` and `zh-CN`. Bibliographic source metadata and evidence locators retain their citation language and are not localized content maps. Other imported packages may omit translations and fall back to explicitly identified English. Stable IDs, source titles, refs and field keys do not depend on locale.

## Evidence and editorial review

Each known field, commit, parent edge, integration decision and influence link has a source and a locator. The package carries bibliographic citations, not copied articles. The rights review identifier describes AI-assisted editorial preparation and the redistribution boundary; it does not certify expert peer review. A successful validator checks structure and provenance presence, not whether an interpretation is historically correct.

The prior 28-record claim map is available in [historical sources](../prototype/HISTORY_SOURCES.md). New or expanded claims were checked against these institutional sources on 25 October 2026:

- **Sui and Chen:** [Met, China 500–1000](https://www.metmuseum.org/toah/ht/06/eac), timeline and the 581 entry, supports the dynasty dates and north–south integration by 589. The multi-parent ledger is our model, not a source claim about Git-like ancestry.
- **Chang'an and Nara:** the same chronology's *circa 700* entry and [Met, Japan 500–1000](https://www.metmuseum.org/ko/toah/ht/06/eaj), entry 710, distinguish the walled grid at Chang'an from its adaptation at Nara.
- **Alternative Buddhist introduction dates:** [Nara Prefecture's Man'yo encyclopedia, entry 1](https://manyo-hyakka.pref.nara.jp/db/detail?cls=db_yougo3&pkey=1), explicitly preserves the 538 and 552 traditions and the possibility of earlier private practice. The source is Japanese; the seed summary is an original English paraphrase.
- **Qin:** [Met, Qin Dynasty](https://www.metmuseum.org/essays/qin-dynasty-221-206-b-c), dynasty date in the title and the paragraph identifying 213 BCE. The [separate chronology](https://www.metmuseum.org/toah/ht/04/eac) labels its Qin foundation entry 206 BCE; that inconsistent label is not adopted.
- **Papal anointing:** [King's College London, Pepin 1](https://pbe.kcl.ac.uk/data/D62/F29.htm), passages discussing the *Liber Pontificalis* and the Saint-Denis note, distinguishes 751 from 754. We do not adopt that page's disputed title conventions wholesale.
- **Córdoba:** [Met, Iberian Peninsula](https://www.metmuseum.org/ko/toah/ht/06/eusi), 756–929 entry, identifies Abd al-Rahman I and the mosque's 785 date. Broad claims of cultural harmony or uniform rule elsewhere on the page are not imported.

Scope boxes and city coordinates are navigation aids. They are not historical territorial polygons. The place data, original summaries and schema records may be distributed under the declared project contribution license; third-party works retain their own rights. See [notices](../THIRD_PARTY_NOTICES.md) and [data operations](../docs/data-operations.md) before adding source material.

## Reproducibility

The JSON file is the reviewed, distributable input. Import preview and the shared validator establish its schema and references. Content manifests in the domain layer hash each canonical object when a revision is persisted; they are computed from the exact imported bytes/objects, not from a display string. A future revision must receive a new revision ID and parent revision, preserving the earlier published snapshot.

```sh
node packages/ingestion/src/cli.ts validate data/seed/early-medieval.json --publish
node --test packages/ingestion/src/ingestion.test.ts
```
