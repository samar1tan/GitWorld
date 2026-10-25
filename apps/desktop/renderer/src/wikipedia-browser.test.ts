import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikipediaBrowser, type WikipediaBrowserApi } from './wikipedia-browser.ts';
import { blankWikipediaInput, parseWikipediaInput } from './wikipedia-form.ts';
import { ServiceFailure } from './client.ts';
import { createKnowledgeFiles, type KnowledgeFilesApi } from './knowledge-files.ts';
import { createOnboarding, onboardingProgress, type OnboardingSnapshot } from './onboarding.ts';
import type { SourceObservation } from './source-observation.ts';
import type { WikipediaJob, WikipediaMappingPreview, WikipediaTableInspection } from '../../../../packages/contracts/src/wikipedia-types.ts';
import type { KnowledgeImportResult, KnowledgePendingImport } from '../../../../packages/contracts/src/index.ts';

const A = 'a'.repeat(64), B = 'b'.repeat(64), SOURCE = 'c'.repeat(64), HEAD = '1'.repeat(40), NEXT = '2'.repeat(40), PREPARED = 'd'.repeat(64);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const job = (id = A): WikipediaJob => ({ id, requested: { title: id === A ? 'A source page' : 'Another source page', revision: 77 }, receipt: { id, adapter: 'fixture', startedAt: '2026-10-25T00:00:00Z', completedAt: '2026-10-25T00:00:01Z', status: 'complete', requested: [{ provider: 'wikipedia-en-title', externalId: 'A source page' }], snapshots: [], issues: [] }, source: { pageId: '31', title: 'A source page', revision: '77', contentHash: SOURCE, retrievedAt: '2026-10-25T00:00:00Z', url: 'https://en.wikipedia.org/w/index.php?oldid=77', rights: { redistribution: 'unknown' } } });
const table = (index = 0): WikipediaTableInspection => ({ index, headers: ['Holder', 'Lifespan', 'Term start', 'Term end'], headerHash: (index ? 'f' : 'e').repeat(64), caption: `Generic table ${index}`, headings: ['Source heading'], rows: 3, columns: 4, sample: [{ row: 2, cells: [{ column: 0, text: 'Source person', truncated: false }, { column: 1, text: '1800–1880', truncated: false }, { column: 2, text: '1850', truncated: false }, { column: 3, text: '1860', truncated: false }] }] });
const profiles = [{ id: 'office-tenures-v1' as const, version: '1' as const, labels: { en: 'Recorded holder and tenure', 'zh-CN': '来源记载的任职' }, semantics: { en: 'Source table grouping.', 'zh-CN': '来源年表分组。' } }, { id: 'dated-entries-v1' as const, version: '1' as const, labels: { en: 'Dated source entries', 'zh-CN': '带日期的来源条目' }, semantics: { en: 'Source dates and selected attributes.', 'zh-CN': '来源日期与选定属性。' } }];
function preview(input: Parameters<WikipediaBrowserApi['preview']>[0]): WikipediaMappingPreview {
  return { jobId: input.jobId, sourceHash: input.sourceHash, selection: input.selection, profile: profiles.find(value => value.id === input.selection.profileId)!, plan: { profileId: input.selection.profileId }, counts: { sourceRows: 3, mappedRows: 2, objects: 2, assertions: 2, datedAssertions: 2, applicableAssertions: 2, timedRows: 2 }, exceptions: [{ code: 'OPEN_END', locator: 'table[0].row[4]' }], exceptionCount: 1, sample: { objects: [{ id: 'object', labels: { en: 'Source table grouping', 'zh-CN': '来源年表分组' }, descriptions: {}, aliases: [], types: [], identities: [] }], assertions: [{ id: 'claim', subjectId: 'object', propertyId: 'office:holder', value: { kind: 'text', value: 'Source person', language: 'en' }, qualifiers: [], evidence: [{ sourceId: 'source', locator: '$.facts[0]' }], sourceSnapshotId: 'source', review: 'unreviewed', validTime: { start: { earliestYear: 1850, latestYear: 1850, precision: 'year', calendar: 'Gregorian' } } }], sources: [{ id: 'source', identity: { provider: 'fixture', externalId: 'source' }, contentHash: SOURCE, retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', revision: '77', rights: { redistribution: 'unknown' }, adapterVersion: 'fixture' }] }, preview: { inputHash: '9'.repeat(64), prepared: { id: PREPARED, fingerprintVersion: 2, baseHead: input.expectedHead }, objects: 2, assertions: 2, datedAssertions: 2, locatedObjects: 0, sample: [], issues: [], issueCount: 0, mappingVersions: [], vocabulary: { id: 'fixture-vocabulary', revision: '1', properties: 45, types: 0, values: 0, catalog: { schemaVersion: 1, kind: 'historical-field-display-labels', properties: Array.from({ length: 45 }, (_, index) => ({ id: `field:${index}`, labels: { en: `Field ${index}`, 'zh-CN': `字段 ${index}` } })), types: [] }, origin: { identity: { provider: 'fixture', externalId: 'vocabulary' }, url: 'https://example.invalid/catalog', retrievedAt: '2026-10-25T00:00:00Z', rights: { redistribution: 'unknown' }, evidence: [] }, missing: [], missingCount: 0, conflicts: [], conflictCount: 0 } } };
}
function fixture(t: { after(fn: () => unknown): void }, locale: 'en' | 'zh-CN' = 'en') {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), progressText = { textContent: '' };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null, querySelector: (selector: string) => selector === '[data-wikipedia-progress]' ? progressText : null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); });
  const buffers = new Map<string, string>(), calls: { method: string; params: any }[] = [], observations: unknown[] = [], adopted: { result: KnowledgeImportResult; jobId: string; interaction?: number }[] = [], sections: string[] = [];
  let pending: KnowledgePendingImport[] = [], head = HEAD, epoch = 10, latest: WikipediaMappingPreview | null = null, imported = 0;
  const result = (): KnowledgeImportResult => ({ preview: latest!.preview, changedObjects: ['object'], unchangedObjects: [], paths: ['objects/imported.json'], conflicts: [] });
  const api: WikipediaBrowserApi = {
    async collect(params) { calls.push({ method: 'collect', params }); return job(); },
    async jobs(params) { calls.push({ method: 'jobs', params }); return { jobs: [job(), job(B)].slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 20)), total: 2, issues: [] }; },
    async inspect(params) { calls.push({ method: 'inspect', params }); return { job: job(params.jobId), profiles, totalTables: 2, tables: [table(), table(1)].slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)), offset: params.offset ?? 0, limit: params.limit ?? 10 }; },
    async preview(params) { calls.push({ method: 'preview', params }); latest = preview(params); return latest; },
    async issues(params) { calls.push({ method: 'issues', params }); return { jobId: params.jobId, previewId: params.previewId, inputHash: params.expectedInputHash, reportHash: '6'.repeat(64), total: latest!.exceptionCount, offset: params.offset ?? 0, limit: params.limit ?? 10, issues: latest!.exceptions.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)) }; },
    async adopt(params) { calls.push({ method: 'adopt', params }); imported++; return result(); },
    async resume(params) { calls.push({ method: 'resume', params }); return result(); },
    async pending() { return pending; }, async status() { calls.push({ method: 'status', params: {} }); return { head, branch: 'main', stagedTree: HEAD, staged: [], unstaged: [], conflicts: [], revert: null }; },
    async cancel(id) { calls.push({ method: 'cancel', params: id }); },
  };
  const create = (extra: Partial<Parameters<typeof createWikipediaBrowser>[0]> = {}) => createWikipediaBrowser({ locale: () => locale, render() {}, storage: { getItem: key => buffers.get(key) ?? null, setItem: (key, value) => { buffers.set(key, value); }, removeItem: key => { buffers.delete(key); } }, api, navigationVersion: () => epoch, onSection: section => sections.push(section), onObserved: value => observations.push(value), onResumeImport: async () => { imported++; }, onAdopted: (result, jobId, interaction) => { adopted.push({ result, jobId, interaction }); }, ...extra });
  return { create, api, calls, buffers, progressText, observations, adopted, sections, result, pending: (value: KnowledgePendingImport[]) => { pending = value; }, epoch: (value: number) => { epoch = value; }, head: (value: string) => { head = value; }, latest: () => latest, imported: () => imported };
}
const click = (browser: ReturnType<typeof createWikipediaBrowser>, action: string, extra = {}) => browser.click({ dataset: { wikipedia: action, ...extra } } as unknown as HTMLElement);
const change = (browser: ReturnType<typeof createWikipediaBrowser>, key: string, value: string, extra = {}) => browser.change({ dataset: { wikipediaChange: key, ...extra }, value } as unknown as HTMLSelectElement);
const input = (browser: ReturnType<typeof createWikipediaBrowser>, key: string, value: string, extra = {}) => browser.input({ dataset: { wikipediaInput: key, ...extra }, value } as unknown as HTMLInputElement);
const submit = (browser: ReturnType<typeof createWikipediaBrowser>, form: string) => browser.submit({ dataset: { wikipediaForm: form } } as unknown as HTMLFormElement);
async function choose(browser: ReturnType<typeof createWikipediaBrowser>) { await browser.open('saved'); await click(browser, 'job', { id: A }); change(browser, 'profile', 'office-tenures-v1'); await click(browser, 'table', { table: '0' }); change(browser, 'holder', '0', { table: '0' }); change(browser, 'start', '2', { table: '0' }); change(browser, 'end', '3', { table: '0' }); }

test('page acquisition is explicit, cancellable and keeps an incomplete durable job instead of claiming a source exists', async t => {
  const f = fixture(t), gate = deferred<WikipediaJob>(), browser = f.create(); await browser.open('search'); input(browser, 'title', 'https://other.invalid'); await submit(browser, 'collect'); assert.equal(f.calls.filter(value => value.method === 'collect').length, 0);
  input(browser, 'title', 'A source page'); input(browser, 'revision', '77'); f.api.collect = async params => { f.calls.push({ method: 'collect', params }); return gate.promise; };
  const saving = submit(browser, 'collect'); await click(browser, 'cancel'); assert.equal(f.calls.find(value => value.method === 'cancel')!.params, f.calls.find(value => value.method === 'collect')!.params.operationId);
  const incomplete = job(); delete incomplete.source; incomplete.receipt.status = 'cancelled'; incomplete.receipt.issues = [{ code: 'CANCELLED', retryable: true }]; gate.resolve(incomplete); await saving;
  assert.deepEqual(f.sections, ['saved']); assert.match(browser.content(), /data-wikipedia="retry-acquisition"/); assert.doesNotMatch(browser.content(), /data-wikipedia-change="profile"/); assert.equal(f.observations.length, 0);
});

test('column samples follow selected roles, source choices survive restart, and a changed header cannot silently rebind them', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser);
  const sample = browser.content().match(/<details class="wikipedia-cell-sample"[\s\S]*?<\/table>/)![0]; assert.match(sample, /open/); assert.match(sample, /Source person/); assert.match(sample, /1850/); assert.doesNotMatch(sample, /1800–1880/); browser.hide();
  const restarted = f.create(); await restarted.open('saved'); await submit(restarted, 'preview'); const selection = f.calls.find(value => value.method === 'preview')!.params.selection; assert.deepEqual(selection.tables[0], { tableIndex: 0, headerHash: 'e'.repeat(64), holderColumn: 0, startColumn: 2, endColumn: 3 });
  restarted.hide(); const prior = f.api.inspect; f.api.inspect = async params => { const result = await prior(params); result.tables[0].headerHash = '0'.repeat(64); return result; };
  const changed = f.create(); await changed.open('saved'); await submit(changed, 'preview'); assert.equal(f.calls.filter(value => value.method === 'preview').length, 1); assert.match(changed.content(), /Previous column choices/); assert.match(changed.content(), /data-wikipedia="reset"/);
});

test('both profiles use explicit ordinary tables and distinct selected columns without page-title branches', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser); await click(browser, 'table', { table: '1' }); change(browser, 'holder', '0', { table: '1' }); change(browser, 'dateLayout', 'tenure', { table: '1' }); change(browser, 'tenure', '1', { table: '1' }); await submit(browser, 'preview');
  assert.equal(f.latest()!.selection.profileId, 'office-tenures-v1'); assert.equal((f.latest()!.selection as any).tables.length, 2); await click(browser, 'edit-mapping'); change(browser, 'profile', 'dated-entries-v1'); await click(browser, 'table', { table: '1' }); change(browser, 'time', '2', { table: '1' }); await click(browser, 'add-attribute', { table: '1' }); change(browser, 'attribute', '0', { table: '1', attribute: '0' }); change(browser, 'attribute-kind', 'linked-entities', { table: '1', attribute: '0' }); await submit(browser, 'preview');
  assert.deepEqual(f.latest()!.selection, { profileId: 'dated-entries-v1', tableIndex: 1, headerHash: 'f'.repeat(64), timeColumn: 2, columns: [{ column: 0, kind: 'linked-entities' }] });
  await click(browser, 'edit-mapping'); change(browser, 'attribute', '2', { table: '1', attribute: '0' }); await submit(browser, 'preview'); assert.equal(f.calls.filter(value => value.method === 'preview').length, 2); assert.match(browser.content(), /different column/);
});

test('a preview for a different acquisition job cannot expose adoption or advance Guide despite identical source and selection', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser); f.api.preview = async params => ({ ...preview(params), jobId: B }); await submit(browser, 'preview');
  assert.match(browser.content(), /prepared mapping or source no longer matches/); assert.doesNotMatch(browser.content(), /data-wikipedia="adopt"/); assert.deepEqual(f.observations, []);
  await click(browser, 'adopt'); assert.equal(f.imported(), 0);
});

test('new drafts keep an unspecified source calendar while saved explicit choices and a later user override survive recovery', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser); assert.match(browser.content(), /value="source-unspecified" selected/); await submit(browser, 'preview');
  assert.equal('calendar' in f.latest()!.selection, false); await click(browser, 'edit-mapping'); change(browser, 'calendar', 'Gregorian'); browser.hide();
  const recovered = f.create(); await recovered.open('saved'); assert.match(recovered.content(), /value="Gregorian" selected/); await submit(recovered, 'preview'); assert.equal(f.latest()!.selection.calendar, 'Gregorian');
  await click(recovered, 'edit-mapping'); change(recovered, 'calendar', 'Julian'); await submit(recovered, 'preview'); assert.equal(f.latest()!.selection.calendar, 'Julian');
  await click(recovered, 'edit-mapping'); change(recovered, 'calendar', 'source-unspecified'); await submit(recovered, 'preview'); assert.equal('calendar' in f.latest()!.selection, false);
});

test('missing source pages or revisions have a specific bilingual explanation and retain the exact request for correction', async t => {
  for (const locale of ['en', 'zh-CN'] as const) {
    const f = fixture(t, locale), browser = f.create(); f.api.collect = async () => { const value = job(); delete value.source; value.receipt.status = 'failed'; value.receipt.issues = [{ code: 'RECORD_MISSING', retryable: false }]; return value; };
    await browser.open('search'); input(browser, 'title', 'A source page'); input(browser, 'revision', '77'); await submit(browser, 'collect');
    assert.match(browser.content(), locale === 'en' ? /requested page or revision was not found/ : /未找到请求的页面或修订版本/); assert.doesNotMatch(browser.content(), /data-wikipedia-change="profile"|data-wikipedia="adopt"/);
    await click(browser, 'edit-request'); assert.match(browser.content(), /data-wikipedia-input="title" value="A source page"/); assert.match(browser.content(), /data-wikipedia-input="revision" value="77"/);
  }
});

test('claim samples retain day/month/range precision and source calendars in both locales without timezone conversion', async t => {
  for (const locale of ['en', 'zh-CN'] as const) {
    const f = fixture(t, locale), browser = f.create(); await choose(browser); f.api.preview = async params => { const result = preview(params), claim = result.sample.assertions[0];
      claim.validTime = { start: { earliestYear: 1900, latestYear: 1900, precision: 'day', calendar: 'Julian', month: 1, day: 1, raw: '1 January – 31 December 1900 (Julian)' }, end: { earliestYear: 1900, latestYear: 1900, precision: 'day', calendar: 'Julian', month: 12, day: 31, raw: '1 January – 31 December 1900 (Julian)' } };
      claim.value = { kind: 'time', value: { earliestYear: 1900, latestYear: 1900, precision: 'month', calendar: 'source-unspecified', month: 2, raw: 'February 1900' } };
      result.sample.assertions.push({ ...claim, id: 'interval', value: { kind: 'time', value: { earliestYear: -44, latestYear: -40, precision: 'interval', calendar: 'source-unspecified' } }, validTime: undefined }); return result;
    }; await submit(browser, 'preview'); const table = browser.content().match(/<table class="wikipedia-claims">[\s\S]*?<\/table>/)![0];
    assert.match(table, locale === 'en' ? /Jan 1, 1900/ : /1900年1月1日/); assert.match(table, locale === 'en' ? /Dec 31, 1900/ : /1900年12月31日/); assert.match(table, locale === 'en' ? /Day · Julian/ : /日 · 儒略历/);
    assert.match(table, locale === 'en' ? /Feb 1900/ : /1900年2月/); assert.match(table, locale === 'en' ? /Calendar unspecified/ : /来源未注明历法/); assert.match(table, locale === 'en' ? /44 BCE–40 BCE/ : /公元前 44–公元前 40/);
    assert.doesNotMatch(table, /1900–1900/); assert.equal(table.match(/1 January – 31 December 1900 \(Julian\)/g)?.length, 1);
  }
});

test('the complete saved issue report reaches records after thirty with bounded reads and a failed next page keeps the current page', async t => {
  const f = fixture(t); let rendered = '', failed = true;
  const browser = f.create({ render() { rendered = browser.content(); } }); await choose(browser);
  const issues = Array.from({ length: 45 }, (_, index) => ({ code: 'UNPARSED_TIME', locator: `source-row-${index}` }));
  f.api.preview = async params => { const value = preview(params); value.exceptionCount = issues.length; value.exceptions = issues.slice(0, 30); return value; };
  f.api.issues = async params => { f.calls.push({ method: 'issues', params }); if (params.offset === 40 && failed) throw new ServiceFailure({ code: 'IO_ERROR' }); return { jobId: params.jobId, previewId: params.previewId, inputHash: params.expectedInputHash, reportHash: '6'.repeat(64), total: issues.length, offset: params.offset!, limit: params.limit!, issues: issues.slice(params.offset, params.offset! + params.limit!) }; };
  await submit(browser, 'preview'); await click(browser, 'issues-next'); await click(browser, 'issues-next'); assert.equal(f.calls.filter(value => value.method === 'issues').length, 0);
  await click(browser, 'issues-next'); assert.match(rendered, /source-row-30/); assert.match(rendered, /source-row-39/); assert.doesNotMatch(rendered, /source-row-29/); assert.match(rendered, /31–40 of 45/);
  assert.deepEqual(f.calls.find(value => value.method === 'issues')!.params, { jobId: A, previewId: PREPARED, expectedInputHash: '9'.repeat(64), offset: 30, limit: 10 });
  await click(browser, 'issues-next'); assert.match(rendered, /source-row-30/); assert.doesNotMatch(rendered, /source-row-40/); assert.match(rendered, /data-wikipedia="issues-retry"/); assert.match(rendered, /data-wikipedia="adopt"/);
  failed = false; await click(browser, 'issues-retry'); assert.match(rendered, /source-row-44/); assert.match(rendered, /41–45 of 45/); assert.doesNotMatch(rendered, /data-wikipedia="issues-retry"/);
});

test('issue responses must retain all snapshot identities and a stable report; late reads cannot replace a later job', async t => {
  const f = fixture(t), browser = f.create(), issues = Array.from({ length: 60 }, (_, index) => ({ code: 'UNPARSED_TIME', locator: `pinned-issue-${index}` })); await choose(browser);
  f.api.preview = async params => ({ ...preview(params), exceptions: issues.slice(0, 30), exceptionCount: issues.length });
  const correct = (params: Parameters<WikipediaBrowserApi['issues']>[0]) => ({ jobId: A, previewId: PREPARED, inputHash: '9'.repeat(64), reportHash: '6'.repeat(64), total: issues.length, offset: params.offset!, limit: params.limit!, issues: issues.slice(params.offset, params.offset! + params.limit!) });
  f.api.issues = async params => correct(params); await submit(browser, 'preview'); await click(browser, 'issues-next'); await click(browser, 'issues-next'); await click(browser, 'issues-next');
  for (const wrong of [{ jobId: B }, { previewId: '7'.repeat(64) }, { inputHash: '8'.repeat(64) }, { total: 61 }, { reportHash: '7'.repeat(64) }, { offset: 50 }, { limit: 100 }]) {
    f.api.issues = async params => ({ ...correct(params), ...wrong }); await click(browser, 'issues-next'); assert.match(browser.content(), /pinned-issue-30/); assert.doesNotMatch(browser.content(), /pinned-issue-40/); assert.match(browser.content(), /data-wikipedia="issues-retry"/);
  }
  const gate = deferred<Awaited<ReturnType<WikipediaBrowserApi['issues']>>>(); let request: Parameters<WikipediaBrowserApi['issues']>[0] | null = null;
  f.api.issues = params => { request = params; return gate.promise; }; const reading = click(browser, 'issues-retry'); await click(browser, 'job', { id: B }); gate.resolve(correct(request!)); await reading;
  assert.match(browser.content(), new RegExp(`data-id="${B}" aria-current="true"`)); assert.doesNotMatch(browser.content(), /pinned-issue-40|data-wikipedia="issues-retry"/);
});

test('a later job selection cancels a delayed status/preview intent and does not record false preview progress', async t => {
  const f = fixture(t), browser = f.create(), status = deferred<Awaited<ReturnType<WikipediaBrowserApi['status']>>>(); await choose(browser); f.api.status = () => status.promise;
  const preparing = submit(browser, 'preview'); await click(browser, 'job', { id: B }); status.resolve({ head: HEAD, branch: 'main', stagedTree: HEAD, staged: [], unstaged: [], conflicts: [], revert: null }); await preparing;
  assert.equal(f.calls.filter(value => value.method === 'preview').length, 0); assert.equal(f.observations.length, 0); assert.match(browser.content(), new RegExp(`data-id="${B}" aria-current="true"`));
});

test('a late mapping result cannot replace a later selected job', async t => {
  const f = fixture(t), browser = f.create(), gate = deferred<WikipediaMappingPreview>(); await choose(browser); let request: any;
  f.api.preview = async params => { request = params; return gate.promise; }; const preparing = submit(browser, 'preview'); await new Promise(setImmediate); await click(browser, 'job', { id: B }); gate.resolve(preview(request)); await preparing;
  assert.match(browser.content(), new RegExp(`data-id="${B}" aria-current="true"`)); assert.doesNotMatch(browser.content(), /Proposed claim sample/); assert.equal(f.observations.length, 0);
});

test('background source acquisition retains its result without selecting it over a later job', async t => {
  const f = fixture(t), browser = f.create(), gate = deferred<WikipediaJob>(); await browser.open('search'); input(browser, 'title', 'A source page'); f.api.collect = () => gate.promise;
  const collecting = submit(browser, 'collect'); await browser.open('saved'); await click(browser, 'job', { id: B }); gate.resolve(job()); await collecting;
  assert.deepEqual(f.sections, []); assert.deepEqual(f.observations, [{ type: 'data-acquired', jobId: A }]); assert.match(browser.content(), new RegExp(`data-id="${B}" aria-current="true"`));
});

test('adoption uses the prepared base and preview identity, then reports actual paths with the original navigation epoch', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser); await submit(browser, 'preview'); f.head(NEXT); const gate = deferred<KnowledgeImportResult>(); f.api.adopt = async params => { f.calls.push({ method: 'adopt', params }); return gate.promise; };
  const adopting = click(browser, 'adopt'); await new Promise(setImmediate); const params = f.calls.find(value => value.method === 'adopt')!.params; assert.equal(params.expectedHead, HEAD); assert.equal(params.previewId, PREPARED); assert.equal('fileToken' in params, false); f.epoch(20); gate.resolve(f.result()); await adopting;
  assert.equal(f.adopted[0].interaction, 10); assert.equal(f.adopted[0].jobId, A); assert.deepEqual(f.observations.at(-1), { type: 'data-adopted', jobId: A, paths: ['objects/imported.json'], inputHash: f.latest()!.preview.inputHash });
});

for(const locale of ['en','zh-CN']as const)test(`conflict review keeps the saved mapping choices for an explicit new preview and complete adoption (${locale})`,async t=>{
  const f=fixture(t,locale);let imports=0,attempts=0;
  const browser=f.create({onResumeImport:()=>{imports++;}});await choose(browser);await submit(browser,'preview');const selection=structuredClone(f.latest()!.selection);let currentPreview=f.latest()!.preview;
  const bundle={schemaVersion:1 as const,object:f.latest()!.sample.objects[0],assertions:f.latest()!.sample.assertions};
  f.api.adopt=async params=>{f.calls.push({method:'adopt',params});return attempts++?{...f.result(),preview:currentPreview}:{...f.result(),changedObjects:[],unchangedObjects:[],objects:[],totalObjects:0,continuation:{kind:'wikipedia-mapping',jobId:A},conflicts:[{objectId:bundle.object.id,base:bundle,local:bundle,incoming:bundle}]};};
  await click(browser,'adopt');assert.match(browser.content(),/data-wikipedia="imports"/);assert.doesNotMatch(browser.content(),/data-wikipedia="result"/);assert.equal(f.adopted.length,0);assert.equal(f.observations.some((value:any)=>value.type==='data-adopted'),false);
  await click(browser,'imports');assert.equal(imports,1);browser.hide();await browser.open('saved');await click(browser,'edit-mapping');
  f.api.preview=async params=>{f.calls.push({method:'preview',params});const value=preview(params);value.preview.prepared!.id='f'.repeat(64);currentPreview=value.preview;return value;};
  await submit(browser,'preview');const fresh=f.calls.filter(value=>value.method==='preview').at(-1)!;assert.deepEqual(fresh.params.selection,selection);await click(browser,'adopt');
  assert.equal(f.calls.filter(value=>value.method==='adopt').at(-1)!.params.previewId,'f'.repeat(64));assert.equal(f.adopted.length,1);assert.equal(f.observations.filter((value:any)=>value.type==='data-adopted').length,1);
});

test('actual Wikipedia preview and adoption observations bind Guide to the successful prepared input', async t => {
  const f = fixture(t), path = `objects/${'3'.repeat(64)}.json`;
  const guide = createOnboarding({ locale: () => 'en', context: () => ({ section: 'sources' }), render() {}, persist() {}, navigate() {} }); guide.hydrate(undefined);
  const browser = f.create({ onObserved: event => guide.observe(event) }); await browser.open('search'); input(browser, 'title', 'A source page'); await submit(browser, 'collect');
  assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, false, false, false, false]);
  await choose(browser); await submit(browser, 'preview');
  assert.equal(guide.snapshot().data.inputHash, f.latest()!.preview.inputHash); assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, true, false, false, false]);
  f.api.adopt = async () => ({ ...f.result(), paths: [path] }); await click(browser, 'adopt');
  assert.equal(guide.snapshot().data.jobId, A); assert.deepEqual(guide.snapshot().data.adoptedPaths, [path]); assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, true, true, false, false]);
  guide.observe({ type: 'changes-staged', tree: HEAD, paths: [path] }); guide.observe({ type: 'data-committed', oid: NEXT, tree: HEAD });
  assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, true, true, true, true]); await guide.flush();
});

test('shared Imports recovery after restart advances the original Wikipedia recipe only after a matching successful result', async t => {
  const f = fixture(t), path = `objects/${'4'.repeat(64)}.json`; let saved: OnboardingSnapshot | undefined;
  const guide = createOnboarding({ locale: () => 'en', context: () => ({ section: 'sources' }), render() {}, persist(value) { saved = value; }, navigate() {} }); guide.hydrate(undefined);
  const browser = f.create({ onObserved: event => guide.observe(event) }); await browser.open('search'); input(browser, 'title', 'A source page'); await submit(browser, 'collect'); await choose(browser); await submit(browser, 'preview');
  f.api.adopt = async params => { f.pending([{ operationId: params.operationId, previewId: params.previewId, baseHead: HEAD, counts: { objects: 2, assertions: 2, datedAssertions: 2, locatedObjects: 0 }, review: params.review }]); throw new ServiceFailure({ code: 'IO_ERROR' }); };
  await click(browser, 'adopt'); await guide.flush(); browser.hide(); assert.deepEqual(onboardingProgress(saved!, 'data'), [true, true, false, false, false]);
  const restored = createOnboarding({ locale: () => 'zh-CN', context: () => ({ section: 'sources' }), render() {}, persist() {}, navigate() {} }); restored.hydrate(saved);
  const observed: SourceObservation[] = []; let failed = true;
  const unused = async (): Promise<never> => { throw new Error('Recovery must not reopen or remap a source file.'); };
  const api: KnowledgeFilesApi = { preview: unused, adopt: unused, pending: f.api.pending, status: f.api.status, conflicts: async () => [], object: unused, resolve: unused, resume: async params => { f.calls.push({ method: 'shared-resume', params }); if (failed) throw new ServiceFailure({ code: 'IO_ERROR' }); f.pending([]); return { ...f.result(), paths: [path] }; } };
  const files = createKnowledgeFiles({ locale: () => 'zh-CN', render() {}, api, selectFile: unused, onObserved: event => { observed.push(event); restored.observe(event); } }); await files.open();
  assert.deepEqual(onboardingProgress(restored.snapshot(), 'data'), [true, true, false, false, false]);
  const pending = (await f.api.pending())[0], target = { dataset: { knowledgeFile: 'resume', operation: pending.operationId, preview: pending.previewId } } as unknown as HTMLElement;
  await files.click(target); assert.equal(observed.length, 0); assert.deepEqual(onboardingProgress(restored.snapshot(), 'data'), [true, true, false, false, false]);
  failed = false; await files.click(target); const event = observed.at(-1)!;
  assert.equal(event.type, 'data-adopted'); assert.notEqual(event.jobId, A); assert.equal('inputHash' in event && event.inputHash, f.latest()!.preview.inputHash);
  assert.equal(restored.snapshot().data.jobId, A); assert.deepEqual(restored.snapshot().data.adoptedPaths, [path]); assert.deepEqual(onboardingProgress(restored.snapshot(), 'data'), [true, true, true, false, false]);
  const before = restored.snapshot(); restored.observe(event); assert.deepEqual(restored.snapshot(), before); assert.equal(f.calls.filter(value => value.method === 'shared-resume').length, 2); files.hide(); await restored.flush();
});

test('a failed accepted import exposes shared recovery and restart cannot apply a second mapping', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser); await submit(browser, 'preview'); f.api.adopt = async params => { f.pending([{ operationId: params.operationId, previewId: params.previewId, baseHead: HEAD, counts: { objects: 2, assertions: 2, datedAssertions: 2, locatedObjects: 0 }, review: params.review }]); throw new ServiceFailure({ code: 'IO_ERROR' }); };
  await click(browser, 'adopt'); assert.match(browser.content(), /data-wikipedia="imports"/); assert.equal(f.imported(), 0); await click(browser, 'imports'); assert.equal(f.imported(), 1); browser.hide();
  const restarted = f.create(); await restarted.open('saved'); await submit(restarted, 'preview'); assert.match(restarted.content(), /data-wikipedia="adopt" disabled/); assert.match(restarted.content(), /Finish the accepted import/); assert.equal(f.calls.filter(value => value.method === 'collect').length, 0);
});

test('uncertain adoption checks the same operation rather than creating a second import', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser); await submit(browser, 'preview'); let accepted: any;
  f.api.adopt = async params => { accepted = params; throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); }; await click(browser, 'adopt'); assert.match(browser.content(), /data-wikipedia="check-result"/); await click(browser, 'adopt'); assert.equal(f.adopted.length, 0);
  await click(browser, 'check-result'); assert.deepEqual(f.calls.find(value => value.method === 'resume')!.params, { operationId: accepted.operationId, previewId: accepted.previewId }); assert.equal(f.adopted.length, 1);
});

test('an unaccepted obsolete profile keeps choices and requests a local new preview instead of import recovery', async t => {
  const f = fixture(t), browser = f.create(); await choose(browser); await submit(browser, 'preview'); f.api.adopt = async () => { throw new ServiceFailure({ code: 'REVIEW_REQUIRED', parameters: { reason: 'wikipedia-profile-version-changed' } }); };
  await click(browser, 'adopt'); assert.match(browser.content(), /mapping rule changed/); assert.doesNotMatch(browser.content(), /data-wikipedia="imports"|data-wikipedia="check-result"/); assert.match(browser.content(), /data-wikipedia-change="start"[\s\S]*value="2" selected/);
  await click(browser, 'retry'); assert.equal(f.calls.filter(value => value.method === 'preview').length, 2); assert.equal(f.calls.filter(value => value.method === 'collect').length, 0);
  f.head(NEXT); f.api.adopt = async () => { throw new ServiceFailure({ code: 'HEAD_CHANGED' }); }; await click(browser, 'adopt'); assert.doesNotMatch(browser.content(), /data-wikipedia="check-result"/); await click(browser, 'retry'); assert.equal(f.calls.filter(value => value.method === 'preview').at(-1)!.params.expectedHead, NEXT); assert.equal(f.calls.filter(value => value.method === 'collect').length, 0);
});

test('only matching real write progress is shown and leaving removes its subscription', async t => {
  const f = fixture(t), gate = deferred<KnowledgeImportResult>(); let listener: ((value: any) => void) | null = null, unsubscribed = 0;
  const browser = f.create({ subscribeProgress: value => { listener = value; return () => { unsubscribed++; }; } }); await choose(browser); await submit(browser, 'preview'); f.api.adopt = async params => { f.calls.push({ method: 'adopt', params }); return gate.promise; };
  const adopting = click(browser, 'adopt'); await new Promise(setImmediate); assert.ok(listener); (listener as (value: any) => void)({ operationId: 'another-operation', stage: 'writing', completed: 9, total: 10 }); assert.equal(f.progressText.textContent, '');
  (listener as (value: any) => void)({ operationId: f.calls.find(value => value.method === 'adopt')!.params.operationId, stage: 'writing', completed: 3, total: 10 }); assert.equal(f.progressText.textContent, '3 of 10 files written'); browser.hide(); assert.ok(unsubscribed > 0); gate.resolve(f.result()); await adopting;
});

test('a single honest issue is concise and vocabulary review stays bounded in both locales', async t => {
  for (const locale of ['en', 'zh-CN'] as const) {
    const f = fixture(t, locale), browser = f.create(); await choose(browser); await submit(browser, 'preview'); const html = browser.content();
    assert.match(html, locale === 'en' ? /No end date recorded/ : /来源未给出结束日期/); assert.doesNotMatch(html, /Showing 1 supplied issues|提供其中 1 条问题/); assert.equal((html.match(/<span lang="en">Field /g) ?? []).length, 20); assert.doesNotMatch(html, /Field 44/);
    await browser.click({ dataset: { knowledgeFile: 'catalog-page', target: 'page', page: '2' } } as any); assert.match(browser.content(), /Field 44/); browser.hide();
  }
});

test('input recovery is bounded and strips non-form payloads', () => {
  const input = blankWikipediaInput(); const value = parseWikipediaInput(JSON.stringify({ ...input, raw: '<html>not retained</html>', operationId: 'not-a-form-field' })); assert.deepEqual(value, input); assert.equal(parseWikipediaInput(JSON.stringify({ ...input, jobs: Array(11).fill({}) })), null); assert.equal(parseWikipediaInput('x'.repeat(160_001)), null);
});


test('source display names label preview evidence while original titles and fixed links remain inspectable', async t => {
  const names = { en: 'Display collection', 'zh-CN': '显示集合' }, originalTitle = 'Original source heading';
  for (const locale of ['en', 'zh-CN'] as const) {
    const f = fixture(t, locale), browser = f.create(); await choose(browser);
    f.api.preview = async params => { const result = preview(params); result.sample.sources[0] = { ...result.sample.sources[0], labels: names, title: { en: originalTitle } }; return result; };
    await submit(browser, 'preview'); const html = browser.content(); assert.ok(html.includes(names[locale])); assert.ok(html.includes(originalTitle)); assert.match(html, /https:\/\/example.invalid\/source/); assert.match(html, /lang="en"/); assert.equal(f.calls.filter(value => value.method === 'adopt').length, 0);
  }
});
