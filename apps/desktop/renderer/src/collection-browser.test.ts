import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionBrowser } from './collection-browser.ts';
import type { CollectionIssueAggregate, CollectionIssuesPage, CollectionJob } from '../../../../packages/contracts/src/collection-types.ts';

const idA = 'a'.repeat(64), idB = 'b'.repeat(64);
const page = (jobId: string, offset: number, total = 564, aggregates: CollectionIssueAggregate[] = []): CollectionIssuesPage => ({ jobId, offset, limit: 40, total, reportedCount: total + aggregates.reduce((sum, value) => sum + value.count, 0), coverage: 'complete', aggregates, canRebuild: false, items: Array.from({ length: Math.max(0, Math.min(40, total - offset)) }, (_, index) => ({ code: 'INVALID_TIME', locator: `feature[${offset + index}]` })) });
const job = (id: string): CollectionJob => ({ id, provider: 'cliopatria', query: { limit: 1000, startRecord: 0 }, startedAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', status: 'complete', source: null, records: 1000, objects: 252, assertions: 4276, datedAssertions: 4276, locatedObjects: 252, scanned: 1000, nextRecord: 1000, truncated: true, issues: [], issueCount: 564, failure: null });

// In-memory transports exercise component state; they are not source-acquisition acceptance.
function fixture(t: { after(fn: () => unknown): void }, locale: 'en' | 'zh-CN' = 'en') {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { for (const [name, previous] of [['window', previousWindow], ['document', previousDocument]] as const) { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); } });
  const calls: { method: string; params: any }[] = [], adopted: string[] = [];
  const transport = {
    issues: async (params: { jobId: string; offset: number; limit: number }) => page(params.jobId, params.offset),
    rebuild: async (params: { jobId: string }) => page(params.jobId, 0),
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { gitworld: {
    onProgress: () => () => {},
    request: async (input: { method: string; params: any; requestId: string }) => {
      calls.push({ method: input.method, params: input.params });
      try {
        const result = input.method === 'collection.catalog' ? [{ id: 'cliopatria', title: { en: 'Source fixture' }, description: { en: 'Fixture' }, limitations: { en: 'Fixture' }, revision: 'v1', downloadBytes: 1, licenseId: 'CC0', licenseUrl: 'https://example.invalid', filters: ['text', 'years'] }] : input.method === 'collection.jobs' ? [job(idA), job(idB)] : input.method === 'collection.preview' ? { inputHash: 'input-hash', objects: 252, assertions: 4276, sample: [{ id: 'object', labels: { en: 'Object fixture' } }], issues: [], issueCount: 564 } : input.method === 'repository.status' ? { head: '1'.repeat(40) } : input.method === 'collection.issues' ? await transport.issues(input.params) : input.method === 'collection.rebuildIssues' ? await transport.rebuild(input.params) : input.method === 'collection.adopt' ? { changedObjects: ['object'], unchangedObjects: [], conflicts: [], paths: [] } : undefined;
        return { protocolVersion: 1, requestId: input.requestId, ok: true, result };
      } catch (cause) { return { protocolVersion: 1, requestId: input.requestId, ok: false, error: { code: cause instanceof Error ? cause.message : 'IO_ERROR' } }; }
    },
  } } });
  const browser = createCollectionBrowser({ locale: () => locale, render: () => {}, onAdopted: (_result, jobId) => { adopted.push(jobId); } });
  const click = (action: string, id?: string) => browser.click({ dataset: { collection: action, ...(id ? { id } : {}) } } as unknown as HTMLElement);
  return { browser, click, calls, transport, adopted };
}

test('the full mapping report reaches the last page without resetting the preview or claim review choice', async t => {
  const { browser, click, calls, adopted } = fixture(t); await browser.open(); await click('job', idA);
  browser.change({ dataset: { collectionInput: 'review' }, value: 'adopted' } as unknown as HTMLSelectElement);
  await click('issues-toggle');
  for (let index = 0; index < 14; index++) await click('issues-next');
  assert.match(browser.content(), /feature\[563\]/); assert.match(browser.content(), /561–564 of 564/);
  assert.equal(calls.filter(value => value.method === 'collection.preview').length, 1);
  assert.equal(calls.filter(value => value.method === 'collection.adopt').length, 0);
  assert.ok(calls.filter(value => value.method === 'collection.issues').every(value => value.params.limit === 40));
  await click('adopt'); assert.equal(calls.find(value => value.method === 'collection.adopt')!.params.review, 'adopted'); assert.deepEqual(adopted, [idA]);
});

test('legacy partial details remain visible when rebuilding is cancelled', async t => {
  const { browser, click, transport } = fixture(t);
  transport.issues = async params => ({ ...page(params.jobId, 0, 30), reportedCount: 564, coverage: 'legacy-partial', canRebuild: true });
  transport.rebuild = async () => { throw new Error('CANCELLED'); };
  await browser.open(); await click('job', idA); await click('issues-toggle');
  assert.match(browser.content(), /retained 30 details for 564/); assert.match(browser.content(), /other 534/);
  await click('issues-rebuild'); assert.match(browser.content(), /Rebuilding was cancelled/); assert.match(browser.content(), /feature\[29\]/);
});

test('aggregate exclusions are separate from the pageable detail total in the Chinese interface', async t => {
  const { browser, click, transport } = fixture(t, 'zh-CN');
  transport.issues = async params => page(params.jobId, 0, 2, [{ code: 'SKIPPED_INVALID_RECORDS', count: 534, afterRecord: 100, throughRecord: 1000 }]);
  await browser.open(); await click('job', idA); await click('issues-toggle');
  assert.match(browser.content(), /排除的来源记录：534 条/); assert.match(browser.content(), /来源位置 101–1,000/); assert.match(browser.content(), /明细 1–2\/2/);
  assert.equal((browser.content().match(/<li>/g) ?? []).length, 3, 'One sample object and two concrete issues are rendered; aggregates add no fake row');
});

test('late issue pages cannot replace the report for a newly selected source job', async t => {
  const { browser, click, transport } = fixture(t); let resolve!: (value: CollectionIssuesPage) => void;
  transport.issues = () => new Promise(value => { resolve = value; });
  await browser.open(); await click('job', idA); const loading = click('issues-toggle');
  await click('job', idB); resolve({ ...page(idA, 0, 1), items: [{ code: 'INVALID_TIME', locator: 'old-job-only' }] }); await loading;
  assert.doesNotMatch(browser.content(), /old-job-only/); assert.match(browser.content(), new RegExp(`data-collection-issues="${idB}"`));
});

test('a failed next page keeps the previous details and retries the requested offset', async t => {
  const { browser, click, transport, calls } = fixture(t); let fail = false;
  transport.issues = async params => { if (fail) throw new Error('IO_ERROR'); return page(params.jobId, params.offset); };
  await browser.open(); await click('job', idA); await click('issues-toggle'); fail = true; await click('issues-next');
  assert.match(browser.content(), /feature\[39\]/); assert.match(browser.content(), /could not be loaded/);
  fail = false; await click('issues-retry'); assert.match(browser.content(), /feature\[79\]/);
  assert.equal(calls.findLast(value => value.method === 'collection.issues')!.params.offset, 40);
});
