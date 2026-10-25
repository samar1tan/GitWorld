import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquirePinnedDownload, type PinnedDownloadDefinition } from './pinned-download.ts';

const bytes = Buffer.from('abcdefgh');
const definition: PinnedDownloadDefinition = { url: 'https://example.invalid/official-archive', fileName: 'fixture.zip', bytes: bytes.length, contentHash: createHash('sha256').update(bytes).digest('hex') };
const now = () => new Date('2026-10-25T00:00:00Z');
async function directory(run: (value: string) => Promise<void>) { const value = await mkdtemp(join(tmpdir(), 'gitworld-pinned-download-')); try { await run(value); } finally { await rm(value, { recursive: true, force: true }); } }

test('pinned bytes create a verifiable receipt and an unchanged cache avoids network requests', async () => directory(async directory => {
  const first = await acquirePinnedDownload(definition, { directory }, { fetch: async () => new Response(bytes, { headers: { 'content-length': '8' } }), now });
  assert.equal(first.ok, true); if (!first.ok) return;
  assert.equal(first.value.cached, false); assert.equal(first.value.retrievedAt, now().toISOString()); assert.deepEqual(await readFile(first.value.file), bytes);
  const cached = await acquirePinnedDownload(definition, { directory }, { fetch: async () => { throw new Error('must not fetch a verified cache'); }, now });
  assert.equal(cached.ok, true); if (cached.ok) assert.equal(cached.value.cached, true);
}));

test('interrupted bytes restart through a checked HTTP range and ETag', async () => directory(async directory => {
  let pull = 0;
  const first = await acquirePinnedDownload(definition, { directory }, { fetch: async () => new Response(new ReadableStream({ pull(controller) { if (!pull++) controller.enqueue(bytes.subarray(0, 3)); else controller.error(new Error('connection interrupted')); } }), { headers: { etag: '"stable"' } }), now });
  assert.equal(first.ok, false); assert.deepEqual(await readFile(join(directory, 'fixture.zip.part')), bytes.subarray(0, 3));
  const result = await acquirePinnedDownload(definition, { directory }, { fetch: async (_url, init) => {
    const headers = new Headers(init?.headers); assert.equal(headers.get('range'), 'bytes=3-'); assert.equal(headers.get('if-range'), '"stable"');
    return new Response(bytes.subarray(3), { status: 206, headers: { 'content-range': 'bytes 3-7/8', etag: '"stable"' } });
  }, now });
  assert.equal(result.ok, true); if (result.ok) assert.deepEqual(await readFile(result.value.file), bytes);
}));

test('user cancellation preserves durable bytes and a server ignoring Range safely restarts', async () => directory(async directory => {
  const controller = new AbortController(); let pull = 0;
  const result = await acquirePinnedDownload(definition, { directory, signal: controller.signal, onProgress: () => controller.abort() }, { fetch: async () => new Response(new ReadableStream({ pull(stream) { if (!pull++) stream.enqueue(bytes.subarray(0, 3)); else stream.close(); } }), { headers: { etag: '"old"' } }), now });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'CANCELLED');
  assert.deepEqual(await readFile(join(directory, 'fixture.zip.part')), bytes.subarray(0, 3));
  const restarted = await acquirePinnedDownload(definition, { directory }, { fetch: async () => new Response(bytes), now });
  assert.equal(restarted.ok, true); if (restarted.ok) assert.deepEqual(await readFile(restarted.value.file), bytes);
}));

test('wrong hashes, range metadata, limits and rate limits never produce successful acquisition', async () => directory(async directory => {
  const invalid = await acquirePinnedDownload(definition, { directory }, { fetch: async () => new Response('wrongraw'), now });
  assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_RESPONSE');
  const limited = await acquirePinnedDownload(definition, { directory }, { fetch: async () => new Response(null, { status: 429, headers: { 'retry-after': '30' } }), now });
  assert.equal(limited.ok, false); if (!limited.ok) { assert.equal(limited.error.code, 'RATE_LIMITED'); assert.equal(limited.error.retryAfterMs, 30000); }
  const tooLarge = await acquirePinnedDownload(definition, { directory }, { fetch: async () => new Response('large', { headers: { 'content-length': '9' } }), now });
  assert.equal(tooLarge.ok, false); if (!tooLarge.ok) assert.equal(tooLarge.error.code, 'RESPONSE_TOO_LARGE');
  const range = await acquirePinnedDownload(definition, { directory }, { fetch: async () => new Response(bytes, { status: 206, headers: { 'content-range': 'bytes 1-7/8' } }), now });
  assert.equal(range.ok, false); if (!range.ok) assert.equal(range.error.code, 'INVALID_RESPONSE');
}));

test('only trusted host definitions with safe filenames and bounded public HTTPS archives are accepted', async () => directory(async directory => {
  for (const bad of [{ ...definition, url: 'file:///etc/passwd' }, { ...definition, fileName: '../escape.zip' }, { ...definition, bytes: 257 * 1024 * 1024 }]) {
    const result = await acquirePinnedDownload(bad, { directory }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'INVALID_REQUEST');
  }
}));
