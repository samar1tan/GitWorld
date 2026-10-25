import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChangesWorkspace, type ChangesWorkspaceApi } from './changes-workspace.ts';
import { semanticChanges } from './changes-diff.ts';
import { changesCopy } from './changes-copy.ts';
import { ServiceFailure } from './client.ts';
import type { EditorialCommit, EditorialJson, EditorialStatus } from '../../../../packages/contracts/src/editorial-types.ts';

const NOTE = 'research/note.json', OBJECT = 'objects/object.json', SOURCE = 'sources/source.json';
const note = (value: string): EditorialJson => ({ schemaVersion: 1, id: 'note', title: 'A research question', interpretation: value, openQuestions: [], scope: {}, evidence: [], comparison: null });
// In-memory interaction fixtures. Storage/Git correctness is covered by repository tests, not these fake transports.
function fixture(t: { after(fn: () => unknown): void }) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null, querySelectorAll: () => [] } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'document', prior); else Reflect.deleteProperty(globalThis, 'document'); });
  const buffers = new Map<string, string>(), storage = { getItem: (key: string) => buffers.get(key) ?? null, setItem: (key: string, value: string) => { buffers.set(key, value); }, removeItem: (key: string) => { buffers.delete(key); } };
  let head = '1'.repeat(40), parent: Record<string, EditorialJson> = { [NOTE]: note('A') }, index = structuredClone(parent);
  const working = { [NOTE]: note('B') } as Record<string, EditorialJson>;
  const calls: { method: string; params: any }[] = [], committed: EditorialCommit[] = [], operationCache = new Map<string, EditorialCommit>();
  const changed = (before: Record<string, EditorialJson>, after: Record<string, EditorialJson>) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => JSON.stringify(before[path]) !== JSON.stringify(after[path])).map(path => ({ path, kind: before[path] === undefined ? 'added' as const : after[path] === undefined ? 'deleted' as const : 'modified' as const }));
  const status = (): EditorialStatus => ({ head, branch: 'main', stagedTree: createHash('sha1').update(JSON.stringify(index)).digest('hex'), staged: changed(parent, index), unstaged: changed(index, working), conflicts: [], revert: null });
  const group = (path: string) => path.startsWith('objects/') ? 'object' as const : path.startsWith('sources/') ? 'source' as const : 'research' as const;
  const api: ChangesWorkspaceApi = {
    async status() { calls.push({ method: 'status', params: {} }); return status(); },
    async changes(params) {
      calls.push({ method: 'changes', params });
      const changes = params.mode === 'working' ? status().unstaged : status().staged;
      const values = params.mode === 'working' ? working : index;
      const items = changes.map(change => ({ ...change, group: group(change.path), title: { en: typeof (values[change.path] as any)?.title === 'string' ? String((values[change.path] as any).title) : change.path } })).filter(value => (!params.group || value.group === params.group) && (!params.query || `${value.path} ${value.title.en}`.includes(params.query)));
      return { items: items.slice(params.offset, params.offset + params.limit), total: items.length };
    },
    async diff(params) {
      calls.push({ method: 'diff', params }); const changes = params.mode === 'working' ? status().unstaged : status().staged;
      return { status: status(), entries: changes.filter(value => !params.paths || params.paths.includes(value.path)).map(value => ({ ...value, before: (params.mode === 'working' ? index : parent)[value.path] ?? null, after: (params.mode === 'working' ? working : index)[value.path] ?? null })) };
    },
    async stagePlan(params) { calls.push({ method: 'plan', params }); return { selected: params.paths, required: params.paths.includes(OBJECT) && !params.paths.includes(SOURCE) && index[SOURCE] === undefined ? [SOURCE] : [], missing: [] }; },
    async stage(params) { calls.push({ method: 'stage', params }); for (const path of params.paths) { if (working[path] === undefined) delete index[path]; else index[path] = structuredClone(working[path]); } return status(); },
    async unstage(params) { calls.push({ method: 'unstage', params }); for (const path of params.paths) { if (parent[path] === undefined) delete index[path]; else index[path] = structuredClone(parent[path]); } return status(); },
    async commit(params) {
      calls.push({ method: 'commit', params });
      const cached = operationCache.get(params.operationId); if (cached) return cached;
      if (params.expectedHead !== head) throw new ServiceFailure({ code: 'HEAD_CHANGED' });
      if (params.expectedTree !== status().stagedTree) throw new ServiceFailure({ code: 'STAGE_CHANGED' });
      const previous = head; head = String(committed.length + 2).repeat(40); parent = structuredClone(index);
      const commit = { oid: head, parents: [previous], message: params.message, author: { name: 'Test', email: 'test@example.invalid' }, authoredAt: '2026-10-25T00:00:00Z', branch: 'main' };
      operationCache.set(params.operationId, commit); committed.push(commit); return commit;
    },
    async log() { return [...committed]; }, async branch() { return status(); }, async switch() { return status(); }, async checkout() { return status(); }, async revert() { return status(); }, async abortRevert() { return status(); },
  };
  const notified: EditorialCommit[] = [];
  const create = (locale: 'en' | 'zh-CN' | (() => 'en' | 'zh-CN') = 'en', label?: (id: string) => string, afterCommit?: (value: EditorialCommit) => Promise<void>) => createChangesWorkspace({ locale: () => typeof locale === 'function' ? locale() : locale, render: () => {}, api, storage, label, onClose: () => {}, onCommitted: async value => { notified.push(value); await afterCommit?.(value); } });
  return { create, api, working, calls, committed, notified, status, storage, parent: () => parent, index: () => index, head: (value: string) => { head = value; } };
}
const click = (workspace: ReturnType<typeof createChangesWorkspace>, action: string, extra = {}) => workspace.click({ dataset: { changes: action, ...extra } } as unknown as HTMLElement);
const select = (workspace: ReturnType<typeof createChangesWorkspace>, path: string, checked = true) => workspace.change({ dataset: { changesChange: 'selected', path }, checked } as unknown as HTMLInputElement);
const message = (workspace: ReturnType<typeof createChangesWorkspace>, value: string) => workspace.input({ dataset: { changesInput: 'message' }, value } as unknown as HTMLTextAreaElement);
const submit = (workspace: ReturnType<typeof createChangesWorkspace>, type = 'commit') => workspace.submit({ dataset: { changesForm: type } } as unknown as HTMLFormElement);

test('a successful commit can prepare and leave its own workspace without awaiting itself', { timeout: 1000 }, async t => {
  const {create,api,status,committed}=fixture(t);let returned=false;
  const workspace=create('en',undefined,async()=>{assert.deepEqual(await workspace.prepareClose(),{ready:true});workspace.hide();returned=true;});
  await workspace.open();await api.stage({paths:[NOTE],expectedHead:status().head});await workspace.refresh();
  message(workspace,'Preserve the reviewed interpretation');await submit(workspace);
  assert.equal(committed.length,1);assert.equal(returned,true);assert.equal(status().staged.length,0);assert.deepEqual(await workspace.prepareClose(),{ready:true});
});

test('a completed commit changes language without repeating the write or replacing later input', async t => {
  const { create, api, status, committed, calls, storage } = fixture(t);
  let locale: 'en' | 'zh-CN' = 'en';
  const workspace = create(() => locale); await workspace.open();
  await api.stage({ paths: [NOTE], expectedHead: status().head }); await workspace.refresh();
  message(workspace, 'Record the reviewed interpretation'); await submit(workspace);
  assert.equal(committed.length, 1);
  const english = workspace.content(), oid = committed[0].oid;
  assert.ok(english.includes(changesCopy('en', 'committed', { oid: `${oid.slice(0, 12)}…` })));
  workspace.openCommit(); message(workspace, 'A later, uncommitted reason');
  const before = { calls: calls.length, status: status(), buffer: storage.getItem('gitworld-commit-input-v1') };
  locale = 'zh-CN';
  const chinese = workspace.content();
  assert.ok(chinese.includes(changesCopy('zh-CN', 'committed', { oid: `${oid.slice(0, 12)}…` })));
  assert.ok(!chinese.includes(changesCopy('en', 'committed', { oid: `${oid.slice(0, 12)}…` })));
  assert.match(chinese, /A later, uncommitted reason/);
  locale = 'en'; assert.ok(workspace.content().includes(changesCopy('en', 'committed', { oid: `${oid.slice(0, 12)}…` })));
  assert.equal(calls.length, before.calls); assert.deepEqual(status(), before.status);
  assert.equal(committed.length, 1); assert.equal(storage.getItem('gitworld-commit-input-v1'), before.buffer);
});

test('opening a large change set requests paged metadata and no full source differences', async t => {
  const { create, working, calls } = fixture(t);
  for (let i = 0; i < 1100; i++) working[`objects/${i}.json`] = { object: { labels: { en: `Object ${i}` } }, assertions: [] };
  const workspace = create(); await workspace.open();
  assert.equal(calls.filter(value => value.method === 'diff').length, 0);
  assert.equal(calls.find(value => value.method === 'changes')!.params.limit, 40);
  assert.equal((workspace.content().match(/class="changes-item"/g) ?? []).length, 40);
});

test('closing the commit editor preserves its reason and keeps advanced data operations reachable', async t => {
  const { create, calls } = fixture(t), workspace = create(); await workspace.open();
  assert.doesNotMatch(workspace.content(), /class="changes-commit-panel"/);
  await click(workspace, 'advanced');
  assert.match(workspace.content(), /data-changes="create-branch"/);
  workspace.openCommit(); message(workspace, 'A recoverable contribution reason');
  await click(workspace, 'close-commit');
  assert.doesNotMatch(workspace.content(), /class="changes-commit-panel"/);
  assert.match(workspace.content(), /data-changes="create-branch"/);
  assert.equal(calls.filter(value => ['stage', 'unstage', 'commit'].includes(value.method)).length, 0);
  workspace.openCommit(); assert.match(workspace.content(), /A recoverable contribution reason/);
  workspace.hide(); const reopened = create(); await reopened.open();
  assert.match(reopened.content(), /class="changes-commit-panel"/);
  assert.match(reopened.content(), /A recoverable contribution reason/);
});

test('the commit shortcut opens a closed editor for review before it can submit', async t => {
  const { create, calls, committed } = fixture(t), workspace = create(); await workspace.open();
  await select(workspace, NOTE); await click(workspace, 'stage-plan'); await click(workspace, 'confirm-stage');
  workspace.openCommit(); message(workspace, 'Reviewed contribution'); await click(workspace, 'close-commit');
  let prevented = 0;
  const event = { key: 'Enter', metaKey: true, ctrlKey: false, target: null, preventDefault() { prevented++; } } as unknown as KeyboardEvent;
  workspace.key(event);
  assert.match(workspace.content(), /class="changes-commit-panel"/);
  assert.equal(calls.filter(value => value.method === 'commit').length, 0);
  workspace.key(event); await new Promise(resolve => setImmediate(resolve));
  assert.equal(committed.length, 1); assert.equal(prevented, 2);
});

test('required supporting data is staged only after the visible plan is explicitly confirmed', async t => {
  const { create, working, calls } = fixture(t);
  working[OBJECT] = { object: { labels: { en: 'An object' } }, assertions: [] }; working[SOURCE] = { identity: { provider: 'fixture', externalId: 'source' } };
  const workspace = create(); await workspace.open(); await select(workspace, OBJECT); await click(workspace, 'stage-plan');
  assert.equal(calls.filter(value => value.method === 'stage').length, 0); assert.match(workspace.content(), /Required supporting data/);
  await click(workspace, 'confirm-stage'); assert.deepEqual(calls.find(value => value.method === 'stage')!.params.paths.sort(), [OBJECT, SOURCE].sort());
});

test('off-page supporting catalogs have distinct localized roles before staging', async t => {
  const f = fixture(t), catalog = 'mappings/field-catalogs/catalog.json', baseline = 'mappings/field-catalog-baselines/catalog.json';
  f.working[OBJECT] = { object: { labels: { en: 'An object' } }, assertions: [] };
  const entries = [
    { path: catalog, kind: 'added', group: 'mapping' as const, title: { en: 'Shared catalog', 'zh-CN': '共同目录' }, metadataKind: 'field-catalog' as const },
    { path: baseline, kind: 'added', group: 'mapping' as const, title: { en: 'Shared catalog', 'zh-CN': '共同目录' }, metadataKind: 'catalog-baseline' as const },
  ];
  const lookups: string[][] = [];
  f.api.changes = async input => {
    if (input.paths) { lookups.push(input.paths); const items = entries.filter(item => input.paths!.includes(item.path)); return { items, total: items.length }; }
    return input.group === 'mapping' ? { items: entries, total: 2 } : { items: [{ path: OBJECT, kind: 'added', group: 'object', title: { en: 'An object' } }], total: 1 };
  };
  f.api.stagePlan = async input => ({ selected: input.paths, required: [catalog, baseline], missing: [] });
  for (const locale of ['en', 'zh-CN'] as const) {
    const workspace = f.create(locale); await workspace.open(); await select(workspace, OBJECT); await click(workspace, 'stage-plan');
    const field = changesCopy(locale, 'fieldCatalog'), prior = changesCopy(locale, 'catalogBaseline');
    assert.ok(workspace.content().includes(`${locale === 'en' ? 'Shared catalog' : '共同目录'} · ${field}`));
    assert.ok(workspace.content().includes(`${locale === 'en' ? 'Shared catalog' : '共同目录'} · ${prior}`));
    assert.equal(f.calls.filter(call => call.method === 'stage').length, 0);
    await workspace.change({ dataset: { changesChange: 'group' }, value: 'mapping' } as HTMLSelectElement);
    assert.ok(workspace.content().includes(`aria-label="${changesCopy(locale, 'select', { title: `${locale === 'en' ? 'Shared catalog' : '共同目录'} · ${field}` })}"`));
    assert.ok(workspace.content().includes(`aria-label="${changesCopy(locale, 'select', { title: `${locale === 'en' ? 'Shared catalog' : '共同目录'} · ${prior}` })}"`));
    workspace.hide();
  }
  assert.equal(lookups.length, 2); assert.ok(lookups.every(paths => paths.length === 2 && paths.includes(catalog) && paths.includes(baseline)));
});

test('a new staging review refreshes off-page names changed without a new HEAD', async t => {
  const f = fixture(t), baseline = 'mappings/baseline-object.json';
  f.working[OBJECT] = { object: { labels: { en: 'An object' } }, assertions: [] };
  let name = 'Earlier import baseline', lookups = 0;
  f.api.changes = async input => {
    if (input.paths) { lookups++; return { items: [{ path: baseline, kind: 'modified', group: 'mapping', title: { en: name }, metadataKind: 'object-baseline' }], total: 1 }; }
    return { items: [{ path: OBJECT, kind: 'added', group: 'object', title: { en: 'An object' } }], total: 1 };
  };
  f.api.stagePlan = async input => ({ selected: input.paths, required: [baseline], missing: [] });
  const workspace = f.create(); await workspace.open(); await select(workspace, OBJECT); await click(workspace, 'stage-plan');
  assert.match(workspace.content(), /Earlier import baseline/); const head = f.status().head;
  await click(workspace, 'cancel-plan'); name = 'Revised import baseline'; await click(workspace, 'refresh'); await click(workspace, 'stage-plan');
  assert.equal(f.status().head, head); assert.equal(lookups, 2);
  assert.match(workspace.content(), /Revised import baseline/); assert.doesNotMatch(workspace.content(), /Earlier import baseline/);
  assert.equal(f.calls.filter(call => call.method === 'stage').length, 0);
});

test('changing a selection invalidates its earlier staging approval', async t => {
  const { create, calls } = fixture(t), workspace = create(); await workspace.open();
  await select(workspace, NOTE); await click(workspace, 'stage-plan'); await select(workspace, NOTE, false); await click(workspace, 'confirm-stage');
  assert.equal(calls.filter(value => value.method === 'stage').length, 0);
});

test('select all respects the applied group across every metadata page', async t => {
  const { create, working, calls } = fixture(t);
  for (let i = 0; i < 55; i++) working[`objects/item-${i}.json`] = { object: { labels: { en: `Object ${i}` } }, assertions: [] };
  working[SOURCE] = { identity: { provider: 'fixture', externalId: 'source' } };
  const workspace = create(); await workspace.open();
  await workspace.change({ dataset: { changesChange: 'group' }, value: 'object' } as unknown as HTMLSelectElement);
  await click(workspace, 'select-all'); await click(workspace, 'stage-plan');
  const paths = calls.findLast(value => value.method === 'plan')!.params.paths as string[];
  assert.equal(paths.length, 55); assert.ok(paths.every(value => value.startsWith('objects/'))); assert.ok(!paths.includes(NOTE)); assert.ok(!paths.includes(SOURCE));
});

test('missing required source material prevents staging rather than silently reducing the selection', async t => {
  const { create, api, calls } = fixture(t);
  api.stagePlan = async params => ({ selected: params.paths, required: [], missing: ['sources/missing.json'] });
  const workspace = create(); await workspace.open(); await select(workspace, NOTE); await click(workspace, 'stage-plan');
  assert.match(workspace.content(), /Required data is missing/); await click(workspace, 'confirm-stage');
  assert.equal(calls.filter(value => value.method === 'stage').length, 0);
});

test('stage B, edit C, commit B leaves C as an ordinary working difference', async t => {
  const { create, working, parent, committed, notified } = fixture(t), workspace = create(); await workspace.open(NOTE);
  await select(workspace, NOTE); await click(workspace, 'stage-plan'); await click(workspace, 'confirm-stage');
  (working[NOTE] as any).interpretation = 'C'; await workspace.refresh();
  assert.match(workspace.content(), /further working edits/); assert.match(workspace.content(), />B</);
  message(workspace, 'A reason for B'); await submit(workspace);
  assert.equal((parent()[NOTE] as any).interpretation, 'B'); assert.equal((working[NOTE] as any).interpretation, 'C'); assert.equal(committed.length, 1); assert.equal(notified.length, 1);
  await click(workspace, 'mode', { mode: 'working' }); await click(workspace, 'item', { path: NOTE });
  assert.match(workspace.content(), />B</); assert.match(workspace.content(), />C</);
});

test('a stale HEAD is rejected with its original tokens and preserves the commit reason', async t => {
  const { create, head, calls, committed } = fixture(t), workspace = create(); await workspace.open();
  await select(workspace, NOTE); await click(workspace, 'stage-plan'); await click(workspace, 'confirm-stage'); message(workspace, 'Keep my reason');
  head('9'.repeat(40)); await submit(workspace);
  assert.equal(committed.length, 0); assert.equal(calls.find(value => value.method === 'commit')!.params.expectedHead, '1'.repeat(40));
  assert.match(workspace.content(), /data repository changed/); assert.match(workspace.content(), /Keep my reason/);
  await submit(workspace); assert.equal(calls.filter(value => value.method === 'commit').length, 1);
});

test('a changed staged tree cannot inherit the previous review approval', async t => {
  const { create, index, calls, committed } = fixture(t), workspace = create(); await workspace.open();
  await select(workspace, NOTE); await click(workspace, 'stage-plan'); await click(workspace, 'confirm-stage'); message(workspace, 'Reviewed B');
  (index()[NOTE] as any).interpretation = 'A later staged version'; await submit(workspace);
  assert.equal(committed.length, 0); assert.match(workspace.content(), /staged content changed/);
  await submit(workspace); assert.equal(calls.filter(value => value.method === 'commit').length, 1);
});

test('an uncertain commit result is checked with the same operation after reopening', async t => {
  const { create, api, committed, calls, notified } = fixture(t), original = api.commit;
  let lost = true; api.commit = async params => { const result = await original(params); if (lost) { lost = false; throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); } return result; };
  const first = create(); await first.open(); await select(first, NOTE); await click(first, 'stage-plan'); await click(first, 'confirm-stage'); message(first, 'An idempotent reason'); await submit(first);
  assert.equal(committed.length, 1); assert.match(first.content(), /no confirmed result/); first.hide();
  const reopened = create(); await reopened.open(); await click(reopened, 'retry');
  const attempts = calls.filter(value => value.method === 'commit'); assert.equal(attempts.length, 2); assert.equal(attempts[0].params.operationId, attempts[1].params.operationId);
  assert.equal(committed.length, 1); assert.equal(notified.length, 1); assert.match(reopened.content(), /Recorded commit/);
});

test('semantic object differences include evidence, time and review instead of only raw JSON', () => {
  const before: EditorialJson = { object: { labels: { en: 'Place' }, types: [] }, assertions: [{ id: 'a', propertyId: 'geo:location', value: { kind: 'text', value: 'A' }, review: 'unreviewed', evidence: [], validTime: { start: { earliestYear: 100, latestYear: 100 } } }] };
  const after = structuredClone(before) as any; after.assertions[0].value.value = 'B'; after.assertions[0].review = 'adopted'; after.assertions[0].evidence = [{ sourceId: 's', locator: 'claim:1' }];
  const rows = semanticChanges(before, after);
  assert.deepEqual(rows.map(value => value.label).sort(), ['assertionValue', 'evidence', 'review'].sort()); assert.ok(rows.every(value => value.detail === 'geo:location'));
});

test('count messages use complete singular and plural templates in both locales', () => {
  assert.equal(changesCopy('en', 'workingCount', { count: 1 }), '1 working item');
  assert.equal(changesCopy('en', 'workingCount', { count: 0 }), '0 working items');
  assert.equal(changesCopy('en', 'stagedCount', { count: 2 }), '2 staged items');
  assert.equal(changesCopy('en', 'selectAll', { count: 1 }), 'Select 1 item');
  assert.equal(changesCopy('en', 'planSelected', { count: 1 }), '1 selected item');
  assert.equal(changesCopy('en', 'requiredCount', { count: 1 }), '1 additional item');
  assert.equal(changesCopy('en', 'commitSummary', { staged: 1, working: 1 }), 'This commit records 1 staged item. 1 working item remains outside it.');
  assert.equal(changesCopy('en', 'commitSummary', { staged: 1, working: 2 }), 'This commit records 1 staged item. 2 working items remain outside it.');
  assert.equal(changesCopy('en', 'commitSummary', { staged: 2, working: 1 }), 'This commit records 2 staged items. 1 working item remains outside it.');
  assert.equal(changesCopy('en', 'commitSummary', { staged: 2, working: 0 }), 'This commit records 2 staged items. 0 working items remain outside it.');
  const summary=changesCopy('zh-CN','commitSummary',{staged:10001,working:20002}),numbers=new Intl.NumberFormat('zh-CN');
  assert.ok(summary.includes(numbers.format(10001)));assert.ok(summary.includes(numbers.format(20002)));assert.doesNotMatch(summary,/\{(?:staged|working)\}/);
});

test('research differences show scope, evidence and A/B references with explicit empty states', async t => {
  const { create, working } = fixture(t);
  working[NOTE] = {
    ...note('B') as object,
    scope: { label: 'An investigation', query: 'Place', timeWindow: [-200, 300], objectIds: ['object-id'], fieldIds: ['field-id'] },
    evidence: [{ id: 'e', title: 'A source claim', kind: 'assertion', locator: 'claim:1', repositoryRevision: 'a'.repeat(40) }],
    comparison: { a: { label: 'Earlier state', objectId: 'object-id', year: -200, repositoryRevision: 'a'.repeat(40) }, b: { label: 'Later state', objectId: 'object-id', year: 300, repositoryRevision: 'a'.repeat(40) } },
    openQuestions: ['A follow-up question'],
  } as EditorialJson;
  const workspace = create('en', id => id === 'object-id' ? 'Object label' : id === 'field-id' ? 'Field label' : id);
  await workspace.open(NOTE);
  const table = workspace.content().match(/<table[\s\S]*?<\/table>/)![0];
  for (const text of ['An investigation', 'Name filter', '200 BCE–300', 'Field label', 'No evidence attached', 'No comparison attached', 'No open questions recorded', 'A source claim', 'claim:1', 'Data revision', 'A · Earlier state', 'B · Later state']) assert.ok(table.includes(text), text);
  assert.doesNotMatch(table,/Object label/,'A current lookup name must not be appended to a fixed endpoint.');
  assert.doesNotMatch(table, /<pre>|<code>null<\/code>|&quot;query&quot;|&quot;repositoryRevision&quot;/);
  assert.match(workspace.content(), /<details class="changes-muted"><summary>Raw data<\/summary>/);
  const chinese = create('zh-CN'); await chinese.open(NOTE);
  const translated = chinese.content().match(/<table[\s\S]*?<\/table>/)![0];
  for (const text of ['历史时间范围', '公元前 200 年–300', '尚未附上依据', '尚未附上比较', '资料版本']) assert.ok(translated.includes(text), text);
});

test('typed values, temporal scopes and qualifiers render as fields rather than JSON', async t => {
  const { create, working } = fixture(t);
  working[OBJECT] = {
    object: { labels: { en: 'An object' }, types: [], identities: [] },
    assertions: [{ id: 'a', propertyId: 'property', value: { kind: 'boolean', value: true }, validTime: { start: { earliestYear: -10, latestYear: -10 }, end: { earliestYear: 20, latestYear: 30 } }, qualifiers: [{ propertyId: 'quantity', value: { kind: 'number', value: 100, unit: 'unit-id', lowerBound: 90, upperBound: 110 } }], evidence: [{ sourceId: 'source-id', locator: 'claim:2', citation: 'Source citation' }], review: 'unreviewed' }],
  };
  const workspace = create('en', id => id === 'property' ? 'Property label' : id === 'source-id' ? 'Source label' : id); await workspace.open(OBJECT);
  const table = workspace.content().match(/<table[\s\S]*?<\/table>/)![0];
  for (const text of ['Property label', 'Yes', 'From', '10 BCE', 'Until', '20–30', 'Lower bound', '90', 'Upper bound', '110', 'Source label', 'Source citation', 'claim:2']) assert.ok(table.includes(text), text);
  assert.doesNotMatch(table, /<pre>|&quot;kind&quot;|&quot;start&quot;/);
});

test('research scope shows distinct filter counts and keeps unresolved identifiers in disclosure', async t => {
  const { create, working } = fixture(t);
  working[NOTE] = { ...note('B') as object, scope: { query: '', timeWindow: null, objectIds: ['opaque-object', 'opaque-object', 'another-object'], fieldIds: ['territory.area', 'unresolved-field', 'territory.area'] }, evidence: [{ title: 'A guessed object name must not be used', locator: 'section 1' }] };
  const workspace = create('en', id => id); await workspace.open(NOTE);
  const scopes = [...workspace.content().matchAll(/<div class="changes-scope-value">([\s\S]*?)<\/div>/g)];
  const primary = scopes.at(-1)![1].split('<details>')[0];
  assert.match(primary, /2 objects/); assert.match(primary, /2 fields/); assert.match(primary, /Recorded area/); assert.doesNotMatch(primary, /opaque-object|another-object|unresolved-field|guessed object name/);
  const disclosure = workspace.content().match(/<summary>Filter identifiers<\/summary>[\s\S]*?<\/details>/g)!.at(-1)!;
  assert.match(disclosure, /opaque-object/); assert.match(disclosure, /another-object/); assert.match(disclosure, /unresolved-field/);
});

test('pending-import recovery differs from ordinary review and preserves the commit input', async t => {
  const f = fixture(t); let reason: string | undefined = 'incomplete-paired-import', opened = 0,contextOpened=0;
  f.api.stagePlan = async () => { throw new ServiceFailure({ code: 'REVIEW_REQUIRED', ...(reason ? { parameters: { reason } } : {}) }); };
  const workspace = createChangesWorkspace({ locale: () => 'en', render() {}, api: f.api, storage: f.storage, onClose() {}, onCommitted() {}, onResumeImport: async () => { assert.deepEqual(await workspace.prepareClose(), { ready: true }); opened++; },onResumeContext:async()=>{assert.deepEqual(await workspace.prepareClose(),{ready:true});contextOpened++;} });
  await workspace.open(); workspace.input({ dataset: { changesInput: 'message' }, value: 'Retain this commit purpose' } as any);
  await workspace.change({ dataset: { changesChange: 'selected', path: NOTE }, checked: true } as any);
  await workspace.click({ dataset: { changes: 'stage-plan' } } as any);
  assert.match(workspace.content(), /unfinished import/); assert.match(workspace.content(), /data-changes="resume-import"/);
  await workspace.click({ dataset: { changes: 'resume-import' } } as any); assert.equal(opened, 1); assert.equal(f.storage.getItem('gitworld-commit-input-v1'), 'Retain this commit purpose');
  reason='navigation-operation-pending';await click(workspace,'stage-plan');assert.match(workspace.content(),/data-changes="resume-context"/);assert.doesNotMatch(workspace.content(),/data-changes="resume-import"/);await click(workspace,'resume-context');assert.equal(contextOpened,1);assert.equal(f.storage.getItem('gitworld-commit-input-v1'),'Retain this commit purpose');
  reason = undefined; await workspace.click({ dataset: { changes: 'stage-plan' } } as any); assert.doesNotMatch(workspace.content(), /data-changes="resume-import"/); assert.ok(workspace.content().includes(changesCopy('en', 'dependenciesChanged')));
});

test('fixed comparison diff names use saved snapshot labels without adding a current Working rename',async t=>{
  const {create,working}=fixture(t);working[NOTE]={...note('B') as object,comparison:{a:{label:'Original snapshot',labels:{en:'Original snapshot','zh-CN':'固定旧名称'},objectId:'fixture:old',year:1336,repositoryRevision:'a'.repeat(40)},b:{label:'Legacy saved name',objectId:'fixture:old',year:1370,repositoryRevision:'a'.repeat(40)}}};
  const workspace=create('zh-CN',()=> 'Working rename');await workspace.open(NOTE);let table=workspace.content().match(/<table[\s\S]*?<\/table>/)![0];assert.match(table,/<strong lang="zh-CN">A · 固定旧名称<\/strong>/);assert.match(table,/<strong>B · Legacy saved name<\/strong>/);assert.doesNotMatch(table,/Working rename|knowledge-language/);
  (working[NOTE] as any).comparison.b.labels={en:'Legacy saved name'};await workspace.open(NOTE);table=workspace.content().match(/<table[\s\S]*?<\/table>/)![0];assert.match(table,/<strong lang="en">B · Legacy saved name<span class="knowledge-language"[^>]*>EN<\/span>/);
});
