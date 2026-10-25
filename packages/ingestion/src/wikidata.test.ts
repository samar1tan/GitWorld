import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireWikidataEntities, canonicalSourceJson, fetchWikidataEntities, readWikidataSnapshot, searchWikidataEntities, WIKIDATA_API, type JsonValue, type SourceResult } from './index.ts';

const unwrap = <T>(result: SourceResult<T>): T => { assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) throw new Error(result.error.code); return result.value; };
const json = (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...init });
const noWait = async () => {};
// Synthetic protocol fixtures test transport fidelity, not historical assertions.
const entity = (id: string): JsonValue => ({ id, type: 'item', lastrevid: 123, labels: { en: { language: 'en', value: 'Synthetic test entity' } }, claims: {
  P39: [{ id: `${id}$test-guid`, type: 'statement', rank: 'deprecated', mainsnak: { property: 'P39', snaktype: 'somevalue', datatype: 'wikibase-item' }, qualifiers: { P580: [{ property: 'P580', snaktype: 'value', datavalue: { type: 'time', value: { time: '+1600-00-00T00:00:00Z', precision: 9, calendarmodel: 'http://www.wikidata.org/entity/Q1985727', before: 0, after: 0, timezone: 0 } } }] }, 'qualifiers-order': ['P580'], references: [{ hash: 'source-hash', snaks: { P248: [{ property: 'P248', snaktype: 'novalue' }] }, 'snaks-order': ['P248'] }] }]
} });
const batchFetch: typeof fetch = async input => {
  const url = new URL(String(input)); const ids = url.searchParams.get('ids')!.split('|');
  return json({ entities: Object.fromEntries(ids.map(id => [id, entity(id)])) });
};

test('ordinary name search follows explicit continuation without claiming total coverage', async () => {
  const requests: URL[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.origin + url.pathname, WIKIDATA_API); assert.equal(init?.redirect, 'error');
    assert.equal(url.searchParams.get('search'), 'Tokugawa'); assert.equal(url.searchParams.get('maxlag'), '5');
    assert.match(String(new Headers(init?.headers).get('User-Agent')), /GitWorld.*github/);
    return json(requests.length === 1 ? { search: [{ id: 'Q1', label: 'Synthetic office', description: 'Fixture', match: { language: 'en' } }], 'search-continue': 1 } : { search: [{ id: 'Q2' }] });
  };
  const first = unwrap(await searchWikidataEntities({ query: ' Tokugawa ', limit: 1 }, { fetch: fake }));
  const second = unwrap(await searchWikidataEntities({ query: 'Tokugawa', limit: 1, cursor: first.nextCursor! }, { fetch: fake }));
  assert.equal(first.hits[0].identity.externalId, 'Q1'); assert.equal(first.nextCursor, '1');
  assert.equal(requests[1].searchParams.get('continue'), '1'); assert.equal(second.nextCursor, null); assert.equal(second.hits[0].label, 'Q2');
});

test('complete claim structure, calendar, precision, rank and unknown/absence snaks survive unchanged', async () => {
  const result = unwrap(await fetchWikidataEntities({ entityIds: ['Q1'] }, { fetch: batchFetch }));
  assert.deepEqual(result.snapshots[0].raw, entity('Q1')); assert.equal(result.snapshots[0].sourceRevision, '123');
  assert.equal(result.snapshots[0].identity.externalId, 'Q1'); assert.match(result.snapshots[0].revisionUrl!, /revision=123$/);
  assert.equal(result.snapshots[0].rights.licenseId, 'CC0-1.0'); assert.equal(result.records.length, 1);
  assert.equal('package' in result, false); assert.equal('history' in result.snapshots[0], false);
  assert.notEqual(result.snapshots[0].contentHash, result.response.contentHash);
});

test('HTTP 200 maxlag is retried as upstream busy and never shown as zero search results', async () => {
  let calls = 0; const waits: number[] = [];
  const result = await searchWikidataEntities({ query: 'test' }, { fetch: async () => { calls++; return json({ error: { code: 'maxlag', info: 'fixture' } }); }, sleep: async ms => { waits.push(ms); } });
  assert.equal(result.ok, false); if (result.ok) return;
  assert.equal(result.error.code, 'UPSTREAM_BUSY'); assert.equal(result.error.providerCode, 'maxlag'); assert.equal(result.error.retryable, true);
  assert.equal(calls, 3); assert.deepEqual(waits, [5000, 10000]);
});

test('429 respects Retry-After and excessive delay is returned for later resumption', async () => {
  let calls = 0; const waits: number[] = [];
  const result = unwrap(await searchWikidataEntities({ query: 'test' }, { fetch: async () => ++calls === 1 ? json({}, { status: 429, headers: { 'Retry-After': '7' } }) : json({ search: [] }), sleep: async ms => { waits.push(ms); } }));
  assert.deepEqual(waits, [7000]); assert.equal(result.hits.length, 0);
  const limited = await searchWikidataEntities({ query: 'test' }, { fetch: async () => json({}, { status: 429, headers: { 'Retry-After': '120' } }), sleep: async () => { assert.fail('must return resumable delay instead of blocking'); } });
  assert.equal(limited.ok, false); if (!limited.ok) assert.equal(limited.error.retryAfterMs, 120000);
});

test('business errors, malformed responses and oversized responses are actionable failures', async () => {
  for (const fixture of [{ error: { code: 'invalidparammix' } }, { search: [{ id: 'not-an-id' }] }, { search: [], 'search-continue': 0 }]) {
    const result = await searchWikidataEntities({ query: 'test', cursor: '0' }, { fetch: async () => json(fixture) }); assert.equal(result.ok, false);
  }
  const large = await searchWikidataEntities({ query: 'test' }, { fetch: async () => new Response('{}', { headers: { 'content-length': '17000000' } }) });
  assert.equal(large.ok, false); if (!large.ok) assert.equal(large.error.code, 'RESPONSE_TOO_LARGE');
});

test('cancellation during backoff stops all further requests', async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await searchWikidataEntities({ query: 'test', signal: controller.signal }, { fetch: async () => { calls++; return json({}, { status: 503 }); }, sleep: async () => { controller.abort(); throw new Error('cancelled'); } });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'CANCELLED'); assert.equal(calls, 1);
});

test('redirect identities remain explicit and missing entities do not erase successful records', async () => {
  const result = unwrap(await fetchWikidataEntities({ entityIds: ['Q1', 'Q2', 'Q3'] }, { fetch: async () => json({ redirects: [{ from: 'Q1', to: 'Q2' }], entities: { Q2: entity('Q2'), Q3: { id: 'Q3', missing: true } } }) }));
  assert.equal(result.snapshots.length, 1); assert.equal(result.records.length, 2);
  assert.equal(result.records[0].requestedIdentity.externalId, 'Q1'); assert.equal(result.records[0].identity.externalId, 'Q2');
  assert.equal(result.issues[0].externalId, 'Q3'); assert.equal(result.issues[0].code, 'RECORD_MISSING');
});

test('cancelled multi-batch acquisition resumes only remaining IDs and verifies saved source bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitworld-wikidata-')); const controller = new AbortController();
  const ids = Array.from({ length: 23 }, (_, i) => `Q${i + 1}`); const fetched: string[] = [];
  const fake: typeof fetch = async (input, init) => { fetched.push(new URL(String(input)).searchParams.get('ids')!); return batchFetch(input, init); };
  try {
    const cancelled = unwrap(await acquireWikidataEntities({ entityIds: ids, stagingDirectory: root, signal: controller.signal, onProgress: () => controller.abort() }, { fetch: fake, sleep: noWait }));
    assert.equal(cancelled.receipt.status, 'cancelled'); assert.equal(cancelled.receipt.snapshots.length, 20); assert.equal(cancelled.pending.length, 3);
    const resumed = unwrap(await acquireWikidataEntities({ entityIds: ids, stagingDirectory: root, resumeDirectory: cancelled.directory! }, { fetch: fake, sleep: noWait }));
    assert.equal(resumed.receipt.status, 'complete'); assert.equal(resumed.receipt.snapshots.length, 23); assert.equal(fetched.length, 2); assert.equal(fetched[1], 'Q21|Q22|Q23');
    const snapshot = await readWikidataSnapshot(resumed.directory!, resumed.receipt.snapshots[0]); assert.deepEqual(snapshot.raw, entity('Q1'));
    const checkpoint = JSON.parse(await readFile(join(resumed.directory!, 'receipt.json'), 'utf8'));
    await writeFile(join(resumed.directory!, checkpoint.responses[0].file), '{}');
    const tampered = await acquireWikidataEntities({ entityIds: ids, stagingDirectory: root, resumeDirectory: resumed.directory! }, { fetch: async () => { assert.fail('tampered inputs must not trigger network'); } });
    assert.equal(tampered.ok, false); if (!tampered.ok) assert.equal(tampered.error.code, 'CHECKPOINT_INVALID');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('partial acquisition can retry missing records without fetching completed IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitworld-wikidata-'));
  try {
    const partial = unwrap(await acquireWikidataEntities({ entityIds: ['Q1', 'Q2'], stagingDirectory: root }, { fetch: async () => json({ entities: { Q1: entity('Q1'), Q2: { id: 'Q2', missing: true } } }) }));
    assert.equal(partial.receipt.status, 'partial'); assert.deepEqual(partial.pending.map(x => x.externalId), ['Q2']);
    const resumed = unwrap(await acquireWikidataEntities({ entityIds: ['Q1', 'Q2'], stagingDirectory: root, resumeDirectory: partial.directory! }, { fetch: async (input, init) => { assert.equal(new URL(String(input)).searchParams.get('ids'), 'Q2'); return batchFetch(input, init); } }));
    assert.equal(resumed.receipt.status, 'complete'); assert.deepEqual(resumed.receipt.issues, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid input does not make network calls; canonical hashing ignores object key ordering only', async () => {
  const noFetch: typeof fetch = async () => { assert.fail('invalid inputs must not reach network'); };
  assert.equal((await searchWikidataEntities({ query: ' ' }, { fetch: noFetch })).ok, false);
  assert.equal((await searchWikidataEntities({ query: 'test', cursor: 'https://evil.invalid' }, { fetch: noFetch })).ok, false);
  assert.equal((await fetchWikidataEntities({ entityIds: ['Q1', 'Q1'] }, { fetch: noFetch })).ok, false);
  assert.equal((await acquireWikidataEntities({ entityIds: ['Q1'], stagingDirectory: '/tmp', resumeDirectory: '/elsewhere' }, { fetch: noFetch })).ok, false);
  assert.equal(canonicalSourceJson({ b: 2, a: [3, 1] }), canonicalSourceJson({ a: [3, 1], b: 2 }));
  assert.notEqual(canonicalSourceJson([3, 1]), canonicalSourceJson([1, 3]));
});

test('a failing progress observer cannot turn persisted source acquisition into a storage error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitworld-wikidata-'));
  try {
    const result = unwrap(await acquireWikidataEntities({ entityIds: ['Q1'], stagingDirectory: root, onProgress: () => { throw new Error('observer failed'); } }, { fetch: batchFetch }));
    assert.equal(result.receipt.status, 'complete'); assert.deepEqual(result.receipt.issues, []);
    assert.deepEqual((await readWikidataSnapshot(result.directory!, result.receipt.snapshots[0])).raw, entity('Q1'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('repeated redirected content keeps its first immutable file and separate retrieval receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitworld-wikidata-')); let calls = 0, tick = 0;
  try {
    const result = unwrap(await acquireWikidataEntities({ entityIds: Array.from({ length: 21 }, (_, i) => `Q${i + 1}`), stagingDirectory: root }, {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
      fetch: async (input, init) => ++calls === 1 ? batchFetch(input, init) : json({ redirects: [{ from: 'Q21', to: 'Q1' }], entities: { Q1: entity('Q1') } })
    }));
    const first = result.receipt.snapshots[0], last = result.receipt.snapshots.at(-1)!;
    assert.equal(first.file, last.file); assert.notEqual(first.retrievedAt, last.retrievedAt);
    const stored = JSON.parse(await readFile(join(result.directory!, first.file!), 'utf8'));
    assert.equal(stored.retrievedAt, first.retrievedAt);
    assert.equal((await readWikidataSnapshot(result.directory!, last)).retrievedAt, last.retrievedAt);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('interactive lookup may omit maxlag but still respects rate limits; entity acquisition cannot opt out', async () => {
  let calls = 0; const waits: number[] = [];
  unwrap(await searchWikidataEntities({ query: 'test', interactive: true }, { fetch: async input => {
    assert.equal(new URL(String(input)).searchParams.has('maxlag'), false);
    return ++calls === 1 ? json({}, { status: 429, headers: { 'Retry-After': '6' } }) : json({ search: [] });
  }, sleep: async ms => { waits.push(ms); } }));
  assert.deepEqual(waits, [6000]);
  unwrap(await fetchWikidataEntities({ entityIds: ['Q1'] }, { fetch: async (input, init) => {
    assert.equal(new URL(String(input)).searchParams.get('maxlag'), '5'); return batchFetch(input, init);
  } }));
});

test('source search truncation and label fallback are explicit rather than inferred from the matched alias', async () => {
  const page = unwrap(await searchWikidataEntities({ query: 'test', language: 'zh-hans', cursor: '10000' }, { fetch: async () => json({ search: [{ id: 'Q1', label: 'English fallback', match: { language: 'zh-hans' } }], 'search-continue': 10020 }) }));
  assert.equal(page.continuationLimitReached, true); assert.equal(page.nextCursor, null); assert.equal(page.hits[0].language, undefined);
});
