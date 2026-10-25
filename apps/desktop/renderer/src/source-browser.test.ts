import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { SourceJob, SourceRecordDetail } from '../../../../packages/contracts/src/index.ts';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
// Bundle the actual module only to remove CSS imports and resolve browser extensionless paths.
const sourcePath = new URL('./source-browser.ts', import.meta.url);
const compiled = (async () => {
  const contents = await readFile(process.env.GITWORLD_SOURCE_BROWSER_SNAPSHOT ?? sourcePath, 'utf8');
  const result = await build({ stdin: { contents, sourcefile: fileURLToPath(sourcePath), resolveDir: fileURLToPath(new URL('./', sourcePath)), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.css': 'empty' } });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')) as Promise<typeof import('./source-browser.ts')>;
})();
const job = (id = 'job-a', entity = 'Q1'): SourceJob => ({ id, receipt: { id, adapter: 'fixture', startedAt: '2026-10-25T00:00:00Z', completedAt: '2026-10-25T00:00:01Z', status: 'complete', requested: [{ provider: 'wikidata', externalId: entity }], snapshots: [], issues: [] }, pending: [{ provider: 'wikidata', externalId: entity }], materials: [{ identity: { provider: 'wikidata', externalId: entity }, label: { en: `Material ${entity}` }, sourceRevision: '1', claimCount: 0, kind: 'item' }], labelIssues: [] });
const record = (title: string): SourceRecordDetail => ({ snapshot: { identity: { provider: 'wikidata', externalId: 'Q1' }, sourceRevision: '1', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', contentHash: 'a'.repeat(64), mediaType: 'application/json', raw: { labels: { en: { value: title } }, claims: {} }, rights: { redistribution: 'unknown' }, adapterVersion: 'fixture' }, labels: {} });
async function fixture(t: { after(fn: () => unknown): void }) {
  const previous = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const calls: { method: string; params: any }[] = [], observations: unknown[] = [], buffers = new Map<string, string>();
  const handlers: Record<string, (params: any) => unknown | Promise<unknown>> = { 'knowledge.pendingImports': () => [], 'knowledge.conflicts': () => [], 'source.jobs': () => ({ jobs: [job()], issues: [] }), 'source.record': () => record('Original material'), 'collection.catalog': () => [], 'collection.jobs': () => [] };
  let renders = 0, subscriptions = 0, unsubscriptions = 0, editorInput: string | null = null;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null, querySelectorAll: () => [] } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { gitworld: { onProgress() { subscriptions++; return () => { unsubscriptions++; }; }, async request(input: { method: string; params: any; requestId: string }) { calls.push({ method: input.method, params: input.params }); const handler = handlers[input.method]; if (!handler) throw Error('Unexpected request ' + input.method); return { protocolVersion: 1, requestId: input.requestId, ok: true, result: await handler(input.params) }; } } } });
  const { createSourceBrowser } = await compiled;
  const browser = createSourceBrowser({ locale: () => 'en', render() { renders++; editorInput = null; }, onClose() {}, onObserved: event => observations.push(event), storage: { getItem: key => buffers.get(key) ?? null, setItem: (key, value) => { buffers.set(key, value); }, removeItem: key => { buffers.delete(key); } } });
  const click = (action: string, extra = {}) => browser.click({ dataset: { source: action, ...extra } } as unknown as HTMLElement);
  return { browser, handlers, calls, click, observations, renders: () => renders, subscriptions: () => subscriptions, unsubscriptions: () => unsubscriptions, replaceWithEditor: (value: string) => { editorInput = value; }, editorInput: () => editorInput };
}

test('a slow pending read cannot reactivate a hidden source view or redraw a newer editor', async t => {
  const f = await fixture(t), pending = deferred<[]>(); f.handlers['knowledge.pendingImports'] = () => pending.promise;
  const opening = f.browser.openImports(); f.browser.hide(); f.replaceWithEditor('Continue typing this correction'); const renders = f.renders();
  pending.resolve([]); await opening;
  assert.equal(f.renders(), renders); assert.equal(f.editorInput(), 'Continue typing this correction'); assert.equal(f.calls.filter(value => value.method === 'source.jobs').length, 0); assert.equal(f.subscriptions(), 0);
  await f.browser.openImports(); assert.equal(f.calls.filter(value => value.method === 'source.jobs').length, 1); assert.equal(f.subscriptions(), 1);
  f.browser.hide(); assert.equal(f.unsubscriptions(), 1);
});

test('switching source sections invalidates an older import initialization', async t => {
  const f = await fixture(t), pending = deferred<[]>(); f.handlers['knowledge.pendingImports'] = () => pending.promise;
  const opening = f.browser.openImports(); await f.click('tab-search'); f.replaceWithEditor('Keep current section input'); const renders = f.renders();
  pending.resolve([]); await opening;
  assert.equal(f.renders(), renders); assert.equal(f.editorInput(), 'Keep current section input'); assert.match(f.browser.content(), /data-source-form="search"/); assert.equal(f.calls.filter(value => value.method === 'source.jobs').length, 0);
});

test('leaving invalidates an outstanding record read instead of caching it as the current detail', async t => {
  const f = await fixture(t); await f.browser.openImports(); await f.click('tab-saved'); const detail = deferred<SourceRecordDetail>(); f.handlers['source.record'] = () => detail.promise;
  const reading = f.click('record', { id: 'Q1' }); f.browser.hide(); f.replaceWithEditor('An unrelated object edit'); const renders = f.renders();
  detail.resolve(record('LATE_RECORD_SHOULD_NOT_BECOME_SELECTED')); await reading;
  assert.equal(f.renders(), renders); assert.equal(f.editorInput(), 'An unrelated object edit'); assert.doesNotMatch(f.browser.content(), /LATE_RECORD_SHOULD_NOT_BECOME_SELECTED/);
});

test('a late job refresh cannot replace the selected saved-material context after leaving', async t => {
  const f = await fixture(t); await f.browser.openImports(); await f.click('tab-saved'); const jobs = deferred<unknown>(); f.handlers['source.jobs'] = () => jobs.promise;
  const refreshing = f.click('refresh'); f.browser.hide(); f.replaceWithEditor('Preserve a later question'); const renders = f.renders();
  jobs.resolve({ jobs: [job('job-b', 'Q2')], issues: [] }); await refreshing;
  assert.equal(f.renders(), renders); assert.equal(f.editorInput(), 'Preserve a later question'); assert.match(f.browser.content(), /value="job-a" selected/); assert.doesNotMatch(f.browser.content(), /value="job-b"/);
});

test('background acquisition keeps its saved result without selecting it over a later source section', async t => {
  const f = await fixture(t); await f.browser.openImports(); await f.click('tab-saved'); const collected = deferred<unknown>(); f.handlers['source.collect'] = () => collected.promise;
  const acquiring = f.click('resume'); await f.click('tab-files'); collected.resolve({ ok: true, value: job('job-b', 'Q2') }); await acquiring;
  assert.match(f.browser.content(), /class="source-content knowledge-file-content"/); assert.deepEqual(f.observations, [{ type: 'data-acquired', jobId: 'job-b' }]); assert.equal(f.calls.filter(value => value.method === 'source.record').length, 0);
  await f.click('tab-saved'); assert.match(f.browser.content(), /value="job-b"/); assert.match(f.browser.content(), /value="job-a" selected/);
});

test('Wikipedia stays inside Search and Saved material and its title input uses backed recovery', async t => {
  const f = await fixture(t); f.handlers['wikipedia.jobs'] = () => ({ jobs: [], total: 0, issues: [] }); await f.browser.openImports(); await f.click('tab-search');
  await f.browser.change({ dataset: { sourceChange: 'provider' }, value: 'wikipedia', hasAttribute: () => false } as any);
  assert.equal((f.browser.content().match(/data-source="tab-/g) ?? []).length, 4); assert.match(f.browser.content(), /data-wikipedia-form="collect"/); assert.ok(f.calls.some(value => value.method === 'wikipedia.jobs'));
  f.browser.input({ dataset: { wikipediaInput: 'title' }, value: 'An ordinary source page' } as any); await f.click('tab-saved'); assert.match(f.browser.content(), /No Wikipedia pages have been saved/);
  await f.click('tab-search'); assert.match(f.browser.content(), /value="An ordinary source page"/); assert.equal(f.calls.filter(value => value.method === 'wikipedia.collect').length, 0);
});
