import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { acquirePleiadesDump, iteratePleiadesRecords, readPleiadesDump, PLEIADES_JSON_BASE } from './pleiades.ts';

// Synthetic transport data exercises parsing and recovery, never historical acceptance.
const place = (id: number) => ({ id: String(id), title: `Synthetic place ${id} — Α`, uri: `https://pleiades.stoa.org/places/${id}`, rights: 'Copyright © The Contributors. Sharing and remixing permitted under terms of the Creative Commons Attribution 3.0 License (cc-by).', reprPoint: [20, 30], placeTypes: ['settlement'], description: 'A quoted "brace { in text }" survives \\ escaping.', creators: [{ name: 'Synthetic contributor' }], history: [] });
const document = (values: unknown[]) => gzipSync(JSON.stringify({ '@context': { description: 'dcterms:description' }, '@graph': values }));
async function temporary(t: { after(fn: () => unknown): void }) { const directory = await mkdtemp(join(tmpdir(), 'gitworld-pleiades-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test('the comprehensive graph streams complete objects with Unicode, escaped braces and unknown attributes', async t => {
  const directory = await temporary(t), file = join(directory, 'input.json.gz'), values = [place(1), place(2)];
  await writeFile(file, document(values));
  const found = []; for await (const value of iteratePleiadesRecords(file)) found.push(value);
  assert.deepEqual(found, values);
});

test('bounded reading preserves attribution and explicit continuation rather than inventing a complete count', async t => {
  const directory = await temporary(t), file = join(directory, 'input.json.gz'); await writeFile(file, document([place(1), place(2), place(3)]));
  const first = await readPleiadesDump({ file, sourceRevision: 'synthetic-v1', retrievedAt: '2026-10-25T00:00:00Z', limit: 2 });
  assert.ok(first.ok); assert.equal(first.value.snapshots.length, 2); assert.equal(first.value.report.truncated, true); assert.equal(first.value.report.nextRecord, 2);
  assert.match(first.value.snapshots[0].rights.attribution!, /Synthetic contributor/); assert.equal(first.value.snapshots[0].rights.licenseId, 'CC-BY-3.0');
  const next = await readPleiadesDump({ file, sourceRevision: 'synthetic-v1', retrievedAt: '2026-10-25T00:00:00Z', startRecord: first.value.report.nextRecord!, limit: 2 });
  assert.ok(next.ok); assert.equal(next.value.snapshots.length, 1); assert.equal(next.value.snapshots[0].identity.externalId, '3'); assert.equal(next.value.report.truncated, false);
});

test('inconsistent IDs and unknown permissions stay in the exception count', async t => {
  const directory = await temporary(t), file = join(directory, 'input.json.gz');
  await writeFile(file, document([{ ...place(1), rights: 'Unknown' }, { ...place(2), uri: 'https://pleiades.stoa.org/places/99' }, place(3)]));
  const result = await readPleiadesDump({ file, sourceRevision: 'synthetic', retrievedAt: '2026-10-25T00:00:00Z', limit: 10 });
  assert.ok(result.ok); assert.equal(result.value.report.skippedInvalid, 2); assert.equal(result.value.snapshots.length, 1);
});

test('an interrupted download resumes its bytes only with the matching source and ETag', async t => {
  const directory = await temporary(t), data = document([place(1), place(2)]), split = Math.floor(data.length / 2); let calls = 0;
  const fixtureFetch: typeof fetch = async (input, init) => {
    calls++; assert.equal(String(input), `${PLEIADES_JSON_BASE}pleiades-places-20261024.json.gz`);
    const headers = init!.headers as Record<string, string>;
    if (calls === 1) {
      assert.equal(headers.Range, undefined);
      let count = 0; return new Response(new ReadableStream({ pull(controller) { if (!count++) controller.enqueue(data.subarray(0, split)); else controller.error(new Error('synthetic transport interruption')); } }), { headers: { 'Content-Length': String(data.length), ETag: '"source-1"' } });
    }
    assert.equal(headers.Range, `bytes=${split}-`); assert.equal(headers['If-Range'], '"source-1"');
    return new Response(data.subarray(split), { status: 206, headers: { 'Content-Range': `bytes ${split}-${data.length - 1}/${data.length}`, 'Content-Length': String(data.length - split), ETag: '"source-1"' } });
  };
  const interrupted = await acquirePleiadesDump({ directory, version: '20261024' }, { fetch: fixtureFetch }); assert.ok(!interrupted.ok && interrupted.error.code === 'NETWORK_FAILED');
  const resumed = await acquirePleiadesDump({ directory, version: '20261024' }, { fetch: fixtureFetch }); assert.ok(resumed.ok); assert.equal(resumed.value.bytes, data.length); assert.deepEqual(await readFile(resumed.value.file), data);
  const cached = await acquirePleiadesDump({ directory, version: '20261024' }, { fetch: async () => { throw new Error('a dated, verified cache must be reused'); } }); assert.ok(cached.ok); assert.equal(calls, 2);
});

test('rate limits, cancellation and invalid versions are explicit without partial success', async t => {
  const directory = await temporary(t); let calls = 0;
  const invalid = await acquirePleiadesDump({ directory, version: '../../private' }, { fetch: async () => { calls++; throw new Error(); } }); assert.equal(invalid.ok, false); assert.equal(calls, 0);
  const limited = await acquirePleiadesDump({ directory, version: '20261024' }, { fetch: async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }) });
  assert.ok(!limited.ok && limited.error.code === 'RATE_LIMITED'); assert.equal(limited.error.retryAfterMs, 60_000);
  const controller = new AbortController(); controller.abort();
  const cancelled = await acquirePleiadesDump({ directory, version: '20261024', signal: controller.signal }, { fetch: async () => { calls++; throw new Error(); } }); assert.ok(!cancelled.ok && cancelled.error.code === 'CANCELLED'); assert.equal(calls, 0);
});

test('truncated gzip and incomplete graph records fail instead of producing a valid import', async t => {
  const directory = await temporary(t), file = join(directory, 'input.json.gz');
  await writeFile(file, gzipSync('{"@graph":[{"id":"1"'));
  const result = await readPleiadesDump({ file, sourceRevision: 'synthetic', retrievedAt: '2026-10-25T00:00:00Z' }); assert.ok(!result.ok && result.error.code === 'INVALID_RESPONSE');
});
