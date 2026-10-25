# Source ingestion

This package provides host-side import and provider transport functions. The Wikidata adapter described here returns source records, not adopted assertions, historical states, branches or a `DataPackage`. This README describes its transport contract. Wikidata search/acquisition and the separate Wikipedia table/profile adapter are connected through the local service and Sources workbench; see [the source-binding contract](../../docs/source-bindings-prd.md). Running a development script does not establish installed-user acceptance.

## Wikidata integration contract

Exports are available from `src/index.ts`:

| Export | Input | Result |
| --- | --- | --- |
| `searchWikidataEntities` | A name/keyword, language, optional item/property type, page limit and continuation cursor | Search hits with stable provider identities and a next cursor. This is lexical search, not arbitrary question answering or a complete historical range query. |
| `fetchWikidataEntities` | Up to 50 unique Q/P identifiers and an optional cancellation signal | Complete entity snapshots, explicit redirect matching, missing-record issues and an original-response receipt. No historical mapping occurs. |
| `acquireWikidataEntities` | Chosen identifiers, an absolute host-owned staging root, optional cancellation/progress and resume directory | A persisted acquisition receipt, snapshot references and pending identifiers; partial and cancelled work can resume. |
| `readWikidataSnapshot` | An acquisition directory and its snapshot receipt | A verified source snapshot, without network access. Invalid paths or content hashes fail verification. |
| `canonicalSourceJson` | A JSON value | Deterministic JSON for hashing: object keys are sorted, array order and original values are preserved. |

All three network functions return `SourceResult<T>`. A successful acquisition call can have receipt status `partial`, `cancelled` or `failed`; callers must inspect the receipt, not just the outer `ok`. A malformed request or staging/checkpoint failure uses the outer structured error. Successful records remain in the host staging directory when a later request fails.

```ts
const page = await searchWikidataEntities({ query: userText, language: 'en', limit: 20, signal });
if (!page.ok) return showSourceError(page.error);
// Present actual hits and let the user select. Do not silently acquire all hits.
const selectedIds = selectedHits.map(hit => hit.identity.externalId);
const result = await acquireWikidataEntities({
  entityIds: selectedIds,
  stagingDirectory: hostOwnedDirectory,
  signal,
  onProgress: ({ completed, total }) => reportProgress(completed, total),
});
// Persist the directory/receipt in the host job record and inspect its status.
```

The example shows the call sequence, not a shipped UI. Production service code must retain the selected IDs, continuation cursor and job/receipt association. The renderer should receive paged summaries and structured errors, not the entire raw response or an arbitrary filesystem path. Reuse the same typed results for GUI and commands.

## Identity, fidelity and provenance

- Stable record identity is `{ provider: 'wikidata', externalId }`. A new `lastrevid` does not create a new historical object. Redirects keep both the requested and returned identities so reconciliation remains inspectable.
- Each snapshot preserves the complete returned entity: labels, descriptions, aliases, sitelinks and all statements, including `mainsnak`, qualifiers, rank and references. Unknown/absent snaks, time precision, calendar and deprecated statements are retained; none are promoted to historical truth.
- `sourceRevision` is the string form of `lastrevid`. `contentHash` hashes canonical **entity JSON**. Each raw-response receipt separately hashes original HTTP response bytes. These hashes serve different purposes.
- Content-addressed snapshot files retain the first observed envelope for that content in an acquisition. Each `SnapshotReceipt.retrievedAt` and response receipt records its own retrieval, including later aliases/redirects to the same content. `readWikidataSnapshot` returns the requested receipt's retrieval time; repeated content never overwrites the first file.
- Rights metadata identifies Wikidata structured data as CC0. This does not license the external text or media linked from statements. The adapter fetches neither linked pages nor images. Acquiring a record does not establish evidence review, identity reconciliation or permission to distribute unrelated source material.

## Batching and recovery

Search accepts 1–50 results per page. Its continuation token is an upstream search offset, not a frozen catalog snapshot or total count; consumers must deduplicate stable IDs and preserve the query. Search results may change while paging. The provider currently limits the search continuation offset to 10,000; `continuationLimitReached` reports truncation rather than pretending the query was exhausted. The matched alias's language is not assumed to be the returned label's language. Structured period/region queries, saved query jobs, assertion mapping and model adoption are not implemented here.

Acquisition sends sequential batches of 20 entities. The 10,000-ID validation bound is a **single-call work budget**, not the dataset's maximum size or a claim that 10,000 records have been tested live. A service can schedule additional bounded jobs. Each job writes source bytes, snapshots and an atomic receipt after completed batches. Cancellation leaves completed batches available; a resume verifies existing snapshots and response hashes and fetches pending IDs only. The host must persist the acquisition directory to resume after restart. Durable pause/scheduling and database adoption belong to the service and are not implied by this library.

Search defaults to `maxlag=5`. An explicitly user-initiated lookup may pass `interactive: true` to omit it, as allowed by the official maxlag guidance; background enumeration must not use that flag. Entity fetching and acquisition always retain `maxlag=5`. Interactive lookup still obeys HTTP/API errors and rate limits and has no success guarantee. HTTP 200 API errors are inspected. Transient failures have at most three attempts, cancellation-aware backoff and Retry-After handling; delays above 30 seconds are returned to the caller for later resumption. A maxlag error is not an empty result. Requests use the fixed official HTTPS endpoint, reject redirects and bound each response to 16 MiB. A response-size failure requires smaller requests or a different access method, not truncation. A failing progress observer cannot change a successfully persisted batch into a storage failure.

The API does not run arbitrary SPARQL, interpret natural-language history questions, fetch a whole dump, infer historical parents or publish anything. Complete name discovery → acquisition → inspection → adoption → commit remains an application acceptance task.

## Verification

```sh
node --test packages/ingestion/src/*.test.ts
node_modules/.bin/tsc --project packages/ingestion/tsconfig.json
```

Transport fixtures are explicitly synthetic and separate from historical content. Tests cover continuation, statement fidelity, HTTP-200 business errors, rate limits, cancellation, redirect identity, partial batches, resume/integrity and retrieval receipts. On 25 October 2026, a real name query for `Tokugawa shogunate` returned `UPSTREAM_BUSY` after bounded retries because the API reported `maxlag`; it did not complete entity acquisition. No live 1,000-record ingestion or GUI acceptance is claimed.

Official references: [Wikidata access methods](https://www.wikidata.org/wiki/Wikidata:Data_access), [Wikibase data model](https://www.mediawiki.org/wiki/Wikibase/DataModel), [maxlag behavior](https://www.mediawiki.org/wiki/Manual:Maxlag_parameter), [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).
