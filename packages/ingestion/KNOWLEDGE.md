# Structured source data and historical state candidates

These modules implement deterministic normalization and query projections. They do not call an LLM or create a pre-authored topic page. Application/service integration and installed-GUI acceptance are separate work.

## Interfaces

The pure model lives in `packages/domain/src/knowledge.ts`:

```ts
const index = createKnowledgeIndex(collection);
index.query({ text, typeIds, time, bounds, includeUndated, includeUnlocated });
index.object(objectId);
index.assertions(objectId);
index.state({ objectId, year, propertyIds, includeUnreviewed });
index.diff(a, b);
index.history({ objectId, propertyIds, includeUnreviewed });
index.stats();
```

`query` returns a bounded page and the actual filtered count. Its single-call page budget is at most 10,000 objects; this is not a library-size cap. Undated and unlocated material is always accessible without time/spatial filters and may be included explicitly with them. Earth coordinates create map locations, not territorial polygons.

`state` defaults to adopted assertions. It retains multiple values, possible values, source assertion IDs and unknown/absent distinctions. A source rank is not confidence. Untimed claims do not silently become valid at every ancient year. A date-valued property, such as a catalog coverage boundary or birth date, can be searched on a timeline without being treated as the validity of all other properties.

`history` automatically projects supported temporal boundaries and point observations. Its first recorded observation is a baseline, not an origin. Differences are **candidates observed between two states**, not proven event dates. Unknown intervals and competing values remain visible. Coverage ends create coverage-boundary observations; they are not historical events. No political ancestry is inferred from the sequence, a name match or an upstream successor property.

The year following one claim's closed end is a coverage boundary only when no other applicable claim supports that state. When another dated claim remains active, that year is an ordinary projected observation with its active evidence retained. This allows year-level comparisons of adjacent or overlapping source intervals without suppressing the supported interval after an annual overlap. It does not identify an accession date or fill an unknown gap.

`knowledge-mapping.ts` provides:

```ts
mapSourceSnapshot(snapshot, { review, propertyMap });
combineKnowledgeCollections(collections);
```

Wikidata statements preserve source statement IDs, values, qualifiers, references and ranks. Stable source identity does not include revision. The JSON date representation uses civil BCE years; it differs from RDF/XSD export. Calendar and precision remain explicit. Unsupported calendars, nonzero before/after bounds and ambiguous multiple temporal qualifiers remain review exceptions with original values retained. [Wikidata dates](https://www.wikidata.org/wiki/Help:Dates).

Pleiades normalization supports attested/romanized names with language and source name type, published location observations and typed place connections. Their dates are source attestation ranges. Top-level place coverage, if supplied, remains a date-valued catalog property; it does not create an entity's life or an invented historical transition. A difference between location observations does not prove that a city moved, and a name-reading difference does not establish a precise renaming event.

Source payloads are retained in `KnowledgeSource.record` for offline evidence locators. A storage adapter may split that payload into a content-addressed blob as long as the source revision, hash and evidence remain reproducible. Repeated unchanged input deduplicates; conflicting stable assertion identities are returned rather than overwritten. Local review/adoption is explicit and separate from public redistribution approval.

## Pleiades bulk acquisition

`pleiades.ts` supplies trusted-host operations:

```ts
acquirePleiadesDump({ directory, version?, signal?, onProgress? });
readPleiadesDump({ file, sourceRevision, retrievedAt, sourceUrl?, startRecord?, limit?, signal?, onProgress? });
iteratePleiadesRecords(file, { signal?, maxRecordBytes? });
```

The downloader only addresses the official comprehensive JSON location linked by Pleiades. It bounds compressed input to 256 MiB, retains a byte/ETag checkpoint and uses HTTP Range with If-Range for restart. Server invalidation restarts the partial file rather than appending incompatible bytes. Dated, hash-verified cached inputs are reusable. Failed/cancelled requests preserve partial work and do not report success. Host paths must remain behind the service boundary.

The reader decompresses and parses `@graph` objects incrementally; it does not `JSON.parse` the entire dump. It enforces an individual-record limit and a 4 GiB decompression budget per pass. `limit` is a 1–10,000-record work budget with an explicit scanned-record continuation, not a product capacity. A bounded read reports truncation and does not claim a complete corpus count. A full dump is approximately 130 MB compressed in the inspected October 2026 release; the application should preview actual download size and preserve cancellation.

The preferred JSON is the comprehensive source. Pleiades marks its old legacy CSV unsuitable for new projects; its newer GIS package is a different export. The adapter uses the preferred JSON and retains contributor names, references, attribution and the source's CC BY 3.0 notice. Linked materials are not automatically covered by that license. [Official downloads and licensing](https://pleiades.stoa.org/downloads).

## Verification boundaries

Synthetic fixtures test state ambiguity, source/date distinctions, object parsing, permission exceptions, download interruption/resumption and cancellation. They are not historical content.

Local scale evidence is recorded separately using real downloaded records. A successful normalization or fast index query does not establish GUI usability, accepted historical claims, source comprehensiveness or a completed source-to-commit journey. Raw snapshots and operational QA data stay local until independently reviewed for publication.

## Political geography observations

`cliopatria.ts` provides `acquireCliopatriaRelease`, `readCliopatriaZip`, `mapCliopatriaDocument` and `unpackCliopatriaZip`. The host-side acquisition/ZIP reader accepts only the URL, revision and SHA-256 in `CLIOPATRIA_VERIFIED_RELEASE`, currently the independently inspected official v0.2.1 release. An arbitrary file cannot acquire the source's CC BY 4.0 permission by using a similar filename. The low-level mapper assumes its source envelope was verified by its caller.

```ts
const acquired = await acquireCliopatriaRelease({ directory, signal, onProgress });
if (acquired.ok) {
  const page = await readCliopatriaZip({ ...acquired.value, startRecord, limit, filter });
}
```

Acquisition returns a host-only local path plus URL, revision, SHA-256, bytes, retrieval time, cache flag and license identity. `pinned-download.ts` handles the host-owned catalog definition, bounded input, durable partial bytes, Range/If-Range restart, cancellation, invalid-cache quarantine and final size/hash verification. A verified existing cache avoids network access. Rate limits return a structured retry time. The helper's URL/filename definition must never be supplied by the renderer; production entry points supply their own reviewed catalog constants.

The adapter retains each original feature as evidence. Its composite source identities are explicitly provisional; neither a name nor a Wikidata reference establishes identity. In the inspected release, some external IDs refer to different subjects and some geography intervals disagree with canonical political chronologies. These issues require a separate reviewed identity/chronology binding rather than changes to the original source. `FromYear`/`ToYear` describe the source's geography observations, not political lifespans. Membership text remains unresolved and does not create ancestry. [Official source and license](https://github.com/Seshat-Global-History-Databank/cliopatria/tree/v0.2.1).

Shape and area fields carry source intervals. A derived representative location is explicitly a geometry calculation, not a capital or a historical relocation. Its planar centroid uses the largest polygon exterior and avoids holes; a concave/holed shape can fall back to a boundary vertex. This is a map index point, not a cartographic centroid guarantee. Raw polygon data remain available for a dedicated geometry renderer. The ZIP/JSON reader buffers a bounded archive and document; a desktop host should run it outside the UI thread. Acquisition supports cancellation, while the synchronous document parse checks cancellation before and after parsing.

## Office-holder projections

`projectOfficeTenures(collection, { listRules?, positionRules?, policy? })` in `office-projection.ts` retains the input collection and adds unreviewed `office:holder` assertions. An explicit dated Wikidata `P39` position claim is reversed; a direct `P1308` position-holder claim uses the same state path. Neither changes its original GUID, qualifiers, references or source revision. Each repeated term remains a separate assertion. A `P1001` jurisdiction forms a stable analytical office scope, so concurrent offices and jurisdictions remain distinct. This scope is not a new polity identity.

Source lists are interpreted only through declared `OfficeListRule` objects with an evidence URL. The mapper does not infer an office from a list title. Review policies are versioned data with inspectable evidence. Missing dates, ambiguous jurisdictions, open bounds, source qualifications, missing references and policy flags enter an exception queue. The projection never adopts material automatically. Month/day precision remains in the claims; a year-level view retains multiple appointments within that year rather than inventing their order. A missing end date does not establish a present-day incumbent.

`mapOfficeTenureRows(rows, source, { id, evidenceUrl })` accepts a normalized DTO from an ordinary structured-table/CSV parser: stable row ID, holder and office IDs/labels, optional jurisdiction, temporal scope, source locator, qualifiers and review flags. It retains that source's own identity and uses an explicit position rule; it does not manufacture Wikidata GUIDs or assume that a primary source needs a second citation merely because a Wikidata statement would. Distinct labels supplied for the same explicitly declared holder ID remain aliases. The host must establish the source envelope, source rights and any identity binding before importing rows.

## Period definitions

`mapPeriodODocument(document, source, { authorityIds?, spatialIds?, excludeAuthorityIds?, authorityRights?, startRecord?, limit? })` maps the official PeriodO dataset into distinct source-specific period definitions. It preserves original labels, bibliographic authorities, temporal ranges and alternative definitions. Period definitions remain a separate type from polities, offices and eras; source spatial lookup identifiers do not imply that a modern country existed throughout the defined interval. Definitions can support a reviewed chronology backbone, but require explicit identity and relationship bindings before becoming political history.

PeriodO dates use XSD astronomical numbering, including year zero. `mapPeriodOYear` converts this to the model's civil BCE numbering and preserves the raw structured date. Original boundary text remains available because the published label is authoritative and the structured range is a visualization approximation. [PeriodO technical overview](https://perio.do/technical-overview/), [dataset license](https://perio.do/license/).

An open published label paired with a closed structured catalog range is an exception. The original fields remain available, but the mapper does not use the cutoff as an automatic historical end or a definite interval for the definition label.

The dataset's CC0 declaration does not substitute for the application's independent source/rights review. Unknown authorities have unknown redistribution permission and no automatic license assignment. Known CHGIS authority content defaults to restricted permission. `authorityRights` may supply an explicit decision with its evidence URL. A preset selection may exclude authorities with known restrictions or unresolved rights. The mapper does not conceal those decisions or assert that a period definition is a polity's exact foundation or collapse.

## MediaWiki table import contract

`mediawiki-tables.ts` exports these trusted-host/pure operations:

```ts
fetchWikipediaTablePage({ title, revision?, signal? }, { fetch?, now? });
extractPublishedTables(html);
parsePublishedTenure(text, { bce?, calendar?, trailingEraNames? });
mapWikipediaOfficeTables(snapshot, { tableIndexes?, profile?, observeExplicitPresent?, calendar? });
mapWikipediaEventTable(snapshot, eventProfile, { calendar? });
createWikipediaFactsCandidate(snapshot, { profile?, eventProfile?, observeExplicitPresent?, calendar? });
```

Acquisition returns a source snapshot with explicit current-page/fixed-revision mode. Office/event profiles are host-owned mapping data pinned to a revision and exact headers. The ordinary mapping retains the local raw source archive; `createWikipediaFactsCandidate` instead returns a separate licensed fact record and manifest with permanent revision/history URLs, upstream hash, changes and source cell locators. Its diagnostic codes retain row locations while omitting narrative details. It remains unreviewed and is not publication approval.

The data-workspace structured-source flow also covers published tables. A MediaWiki table adapter must acquire a revision-qualified source snapshot through the English Wikipedia Action API with `maxlag`, bounded responses and explicit upstream errors. It must parse HTML as data with a standards parser and never execute, render or download article HTML/images in the workbench.

Table headings, captions, row/column spans, cell links, original text and citation anchors determine inspectable source scopes and row locators. Explicit reign/tenure and name columns may produce the same `OfficeTenureRow` DTO as a CSV import. Life dates, age, era lists, dynasty captions and biological succession prose must not become tenure dates or polity ancestry. Unparseable dates, uncertain/alternative chronology, speculative labels and missing identities remain review exceptions; their rows are retained.

Where a published table has unnamed start/end columns or non-header markup, an explicit column profile must pin the source revision and exact extracted header sequence. The profile is inspectable data with holder/start/end columns and optional role context; a changed revision or header fails validation. Annotation rows that span the term columns are not appointments. Such profiles are source adapters, not renderer-specific historical cases.

A profile may explicitly map additional factual columns to timed office-state fields when the row's date interval applies to that field. This supports a change of cabinet or institutional context during one person's service without inventing another accession. It must not apply a person's entire tenure to a cabinet label that changes in undated continuation rows. The exact source column and profile remain in each assertion's evidence.

An explicit profile option may retain a separate current-source-reading point when a row itself says Present/Incumbent and acquisition metadata confirms it was the current page at retrieval. That observation retains the fixed revision, retrieval date and original locator; it neither closes the open tenure nor proves uninterrupted service up to that point. A later retrieval of an old revision cannot create a new current observation.

An event-table profile may instead declare a year column and typed factual columns, including linked participants. These are source-listed event entries; a listing does not establish a successful journey, completed mission or causal influence. Explicit literal status rules may record cancellation or another stated outcome. Unknown outcomes stay unknown. Linked participants form sourced relations at the published event time, never political ancestry.

Source article links establish source-local identities. An analytical office scope attached to a table is not automatically a canonical polity, a modern nation, an era or a biological dynasty. Canonical identity and historical relationship bindings remain reviewed data. Repeated people and terms remain distinct where the table describes distinct tenures.

Wikipedia article text has different rights from Wikidata statements. Normalization must retain the revision/permalink, author-history attribution and applicable CC BY-SA notice. Images and non-free materials are outside the text-only mapping. Raw operational article snapshots stay local; a public factual subset requires independent rights and historical review. [MediaWiki parsing API](https://www.mediawiki.org/wiki/API:Parsing_wikitext), [Wikimedia content licensing](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content).
