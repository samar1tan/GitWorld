import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWikipediaLanguageLinks, fetchWikipediaVariantTitles } from './mediawiki-labels.ts';

test('source language links resolve normalized titles and explicit redirects while preserving actual page revisions', async () => {
  const raw = { batchcomplete: true, query: { normalized: [{ from: 'Synthetic_Ada', to: 'Synthetic Ada' }], redirects: [{ from: 'Synthetic Ada', to: 'Ada' }], pages: [{ pageid: 7, title: 'Ada', lastrevid: 70, langlinks: [{ lang: 'zh', title: '甲' }] }, { pageid: 8, title: 'Bea', lastrevid: 80 }, { title: 'Missing', missing: true }] } };
  const result = await fetchWikipediaLanguageLinks({ titles: ['Synthetic_Ada', 'Bea', 'Missing'] }, { fetch: async request => { const url = new URL(String(request)); assert.equal(url.hostname, 'en.wikipedia.org'); assert.equal(url.searchParams.get('maxlag'), '5'); assert.equal(url.searchParams.get('prop'), 'langlinks|info'); return Response.json(raw); } });
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.value.records[0].chineseTitle, '甲'); assert.equal(result.value.records[0].revision, 70);
  assert.deepEqual(result.value.records.map(value => value.status), ['found', 'missing-language-link', 'missing-page']);
  assert.deepEqual(result.value.snapshot.raw, raw); assert.equal(result.value.snapshot.sourceRevision, null);
});

test('only the explicit zh-cn variant is Simplified Chinese completion; missing variants remain exceptions', async () => {
  const result = await fetchWikipediaVariantTitles({ titles: ['後醍醐天皇', 'OnlyTraditional'] }, { fetch: async request => { const url = new URL(String(request)); assert.equal(url.hostname, 'zh.wikipedia.org'); assert.equal(url.searchParams.get('inprop'), 'varianttitles'); return Response.json({ query: { pages: [{ pageid: 9, title: '後醍醐天皇', lastrevid: 90, varianttitles: { 'zh-cn': '后醍醐天皇', 'zh-hant': '後醍醐天皇' } }, { pageid: 10, title: 'OnlyTraditional', lastrevid: 100, varianttitles: { 'zh-hant': '傳統' } }] } }); } });
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.value.records[0].simplifiedTitle, '后醍醐天皇'); assert.equal(result.value.records[1].status, 'missing-variant'); assert.equal(result.value.records[1].simplifiedTitle, undefined);
});

test('a source-linked Japanese article uses the same explicit language-link path without accepting arbitrary hosts', async () => {
  const result = await fetchWikipediaLanguageLinks({ titles: ['多治比県守'], language: 'ja' }, { fetch: async request => { assert.equal(new URL(String(request)).hostname, 'ja.wikipedia.org'); return Response.json({ query: { pages: [{ pageid: 9, title: '多治比県守', lastrevid: 99, langlinks: [{ lang: 'zh', title: '多治比縣守' }] }] } }); } });
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.records[0].chineseTitle, '多治比縣守');
  assert.equal((await fetchWikipediaLanguageLinks({ titles: ['Ada'], language: 'unknown' as any })).ok, false);
});

test('bounded metadata acquisition stops on rate limits, maxlag, cancellation and oversized responses', async () => {
  let requests = 0;
  const busy = await fetchWikipediaLanguageLinks({ titles: ['Ada'] }, { fetch: async () => { requests++; return Response.json({ error: { code: 'maxlag' } }, { headers: { 'retry-after': '10' } }); } }); assert.equal(requests, 1); assert.equal(busy.ok, false); if (!busy.ok) { assert.equal(busy.error.code, 'UPSTREAM_BUSY'); assert.equal(busy.error.retryAfterMs, 10000); }
  const rate = await fetchWikipediaVariantTitles({ titles: ['甲'] }, { fetch: async () => new Response(null, { status: 429, headers: { 'retry-after': '30' } }) }); assert.equal(rate.ok, false); if (!rate.ok) assert.equal(rate.error.code, 'RATE_LIMITED');
  const datedRate = await fetchWikipediaVariantTitles({ titles: ['甲'] }, { now: () => new Date('2026-10-25T00:00:00Z'), fetch: async () => new Response(null, { status: 429, headers: { 'retry-after': 'Sun, 25 Oct 2026 00:01:00 GMT' } }) }); assert.equal(datedRate.ok, false); if (!datedRate.ok) assert.equal(datedRate.error.retryAfterMs, 60000);
  const oversized = await fetchWikipediaLanguageLinks({ titles: ['Ada'] }, { fetch: async () => new Response('', { headers: { 'content-length': '3000000' } }) }); assert.equal(oversized.ok, false); if (!oversized.ok) assert.equal(oversized.error.code, 'RESPONSE_TOO_LARGE');
  const controller = new AbortController(); controller.abort(); assert.equal((await fetchWikipediaVariantTitles({ titles: ['甲'], signal: controller.signal })).ok, false);
  assert.equal((await fetchWikipediaLanguageLinks({ titles: Array.from({ length: 21 }, (_, n) => String(n)) })).ok, false);
});

test('bad JSON, redirect cycles and malformed provider responses cannot manufacture a localized label', async () => {
  const bad = await fetchWikipediaLanguageLinks({ titles: ['Ada'] }, { fetch: async () => new Response('not-json') }); assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.error.code, 'INVALID_RESPONSE');
  const cycle = await fetchWikipediaLanguageLinks({ titles: ['Ada'] }, { fetch: async () => Response.json({ query: { redirects: [{ from: 'Ada', to: 'Bea' }, { from: 'Bea', to: 'Ada' }], pages: [{ pageid: 7, title: 'Ada', lastrevid: 70, langlinks: [{ lang: 'zh', title: '甲' }] }] } }) }); assert.equal(cycle.ok, true); if (cycle.ok) assert.equal(cycle.value.records[0].status, 'missing-page');
  const missing = await fetchWikipediaVariantTitles({ titles: ['甲'] }, { fetch: async () => Response.json({ query: {} }) }); assert.equal(missing.ok, false);
});
