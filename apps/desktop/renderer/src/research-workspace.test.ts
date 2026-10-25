import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchWorkspace } from './research-workspace.ts';
import { emptyResearchScope, newResearchRecord } from './research-draft.ts';
import { ServiceFailure } from './client.ts';
import type { ResearchRecord, ResearchRecordEnvelope, ResearchWorkspaceApi } from '../../../../packages/contracts/src/research-types.ts';

function fixture(t: { after(fn: () => unknown): void }) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'document', prior); else Reflect.deleteProperty(globalThis, 'document'); });
  const buffers = new Map<string, string>();
  const storage = { getItem: (key: string) => buffers.get(key) ?? null, setItem: (key: string, value: string) => { buffers.set(key, value); }, removeItem: (key: string) => { buffers.delete(key); } };
  const records = new Map<string, ResearchRecordEnvelope>(); let saves = 0;
  const api: ResearchWorkspaceApi = {
    async list() { return [...records.values()].map(value => structuredClone(value.record)); },
    async get(id) { const value = records.get(id); if (!value) throw new ServiceFailure({ code: 'NOT_FOUND' }); return structuredClone(value); },
    async save(record, expectedHash) {
      if ((records.get(record.id)?.contentHash ?? null) !== expectedHash) throw new ServiceFailure({ code: 'CONFLICT' });
      const value = { record: structuredClone(record), contentHash: `hash-${++saves}`, repositoryRevision: 'repo-current' };
      records.set(record.id, value); return structuredClone(value);
    },
    async history() { return []; },
    async readRevision() { throw new ServiceFailure({ code: 'REVISION_NOT_FOUND' }); },
  };
  const create = () => createResearchWorkspace({ locale: () => 'en', render: () => {}, api, storage, onClose: () => {} });
  return { api, storage, records, create, saves: () => saves };
}
const input = (workspace: ReturnType<typeof createResearchWorkspace>, field: string, value: string) => workspace.input({ dataset: { researchInput: field }, value } as unknown as HTMLInputElement);
const click = (workspace: ReturnType<typeof createResearchWorkspace>, action: string, extra = {}) => workspace.click({ dataset: { research: action, ...extra } } as unknown as HTMLElement);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const withEvidence = (id: string, count: number) => {
  const record = newResearchRecord(id, emptyResearchScope(), '2026-10-25T00:00:00Z'); record.title = 'An investigation';
  record.evidence = Array.from({ length: count }, (_, index) => ({ id: `${id}:${index}`, kind: 'assertion', title: 'Subject · field', locator: `claim:${index}`, repositoryRevision: '1'.repeat(40), year: 600 + index }));
  return record;
};

test('evidence folding changes presentation without deleting or saving attached references', async t => {
  const { create, records, saves } = fixture(t), record = withEvidence('many', 100); records.set(record.id, { record, contentHash: 'initial', repositoryRevision: null });
  const workspace = create(); await workspace.open(record.id);
  const shown = () => (workspace.content().match(/<details class="research-evidence"/g) ?? []).length;
  assert.equal(shown(), 8); assert.match(workspace.content(), /Attached references: 100/);
  await click(workspace, 'evidence-more', { evidenceView: 'editor' }); assert.equal(shown(), 16);
  await click(workspace, 'evidence-all', { evidenceView: 'editor' }); assert.equal(shown(), 100);
  await click(workspace, 'evidence-collapse', { evidenceView: 'editor' }); assert.equal(shown(), 8);
  assert.equal(workspace.hasUnsavedChanges(), false); assert.equal(saves(), 0); assert.equal(records.get(record.id)!.record.evidence.length, 100);
  await click(workspace, 'remove-evidence', { index: '7' }); await workspace.save();
  assert.equal(records.get(record.id)!.record.evidence.length, 99); assert.equal(records.get(record.id)!.record.evidence.some(value => value.id === 'many:7'), false);
});

test('old revision evidence expands independently and keeps its original inspected reference', async t => {
  const { api, storage, records } = fixture(t), current = withEvidence('current', 24), old = withEvidence('old', 40), inspected: string[] = [];
  records.set(current.id, { record: current, contentHash: 'current', repositoryRevision: '2'.repeat(40) });
  api.readRevision = async () => ({ record: old, contentHash: 'old', repositoryRevision: '1'.repeat(40) });
  const workspace = createResearchWorkspace({ locale: () => 'en', render: () => {}, api, storage, onClose: () => {}, onOpenReference: value => { if ('id' in value) inspected.push(value.id); } });
  await workspace.open(current.id); await click(workspace, 'revision', { oid: '1'.repeat(40) });
  assert.equal((workspace.content().match(/<details class="research-evidence"/g) ?? []).length, 24);
  await click(workspace, 'evidence-all', { evidenceView: 'old' });
  assert.equal((workspace.content().match(/<details class="research-evidence"/g) ?? []).length, 56);
  await click(workspace, 'inspect-evidence', { index: '19', old: 'true' }); assert.deepEqual(inspected, ['old:19']);
  assert.equal(workspace.hasUnsavedChanges(), false); assert.equal(records.get(current.id)!.record.evidence.length, 24);
});

test('a new empty record remains an unsaved draft until the service saves it', async t => {
  const { create, records } = fixture(t), workspace = create();
  await workspace.open(); await workspace.newRecord();
  assert.match(workspace.content(), /Unsaved draft/); assert.doesNotMatch(workspace.content(), /Saved to working changes/); assert.equal(records.size, 0);
  input(workspace, 'title', 'A question'); assert.match(workspace.content(), /Unsaved draft/);
  assert.equal(await workspace.save(), true); assert.match(workspace.content(), /Saved to working changes/);
  input(workspace, 'interpretation', 'A changed understanding'); assert.match(workspace.content(), /Unsaved input/);
});

test('save uses the expected content hash; a conflict preserves the edited interpretation', async t => {
  const { create, records, saves } = fixture(t), workspace = create();
  await workspace.open(); await workspace.newRecord();
  input(workspace, 'title', 'A question'); input(workspace, 'interpretation', 'Initial understanding');
  assert.equal(await workspace.save(), true); assert.equal(workspace.hasUnsavedChanges(), false); assert.equal(saves(), 1);
  const value = [...records.values()][0]; records.set(value.record.id, { ...value, contentHash: 'changed-elsewhere' });
  input(workspace, 'interpretation', 'Revised understanding'); assert.equal(await workspace.save(), false);
  assert.equal(workspace.hasUnsavedChanges(), true); assert.match(workspace.content(), /Revised understanding/); assert.match(workspace.content(), /Keep draft as new investigation/);
  assert.equal(records.get(value.record.id)!.record.interpretation, 'Initial understanding');
  await click(workspace, 'save-as-new'); assert.equal(await workspace.save(), true); assert.equal(records.size, 2);
});

test('successful working save stays successful when the secondary list refresh fails', async t => {
  const { create, api, saves } = fixture(t), workspace = create();
  await workspace.open(); await workspace.newRecord(); input(workspace, 'title', 'A question');
  api.list = async () => { throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); };
  assert.equal(await workspace.save(), true); assert.equal(saves(), 1); assert.equal(workspace.hasUnsavedChanges(), false);
  assert.match(workspace.content(), /working record was saved/);
  assert.deepEqual(await workspace.prepareClose(), { ready: true });
});

test('raw input recovers after reopening and remains visibly separate from saved content', async t => {
  const { create, records } = fixture(t), first = create();
  await first.open(); await first.newRecord(); input(first, 'title', 'Unsaved question'); input(first, 'interpretation', '<not markup>');
  assert.equal(records.size, 0);
  const reopened = create(); await reopened.open();
  assert.equal(reopened.hasUnsavedChanges(), true); assert.match(reopened.content(), /Recovered unsaved input/); assert.match(reopened.content(), /&lt;not markup&gt;/);
  assert.equal(await reopened.save(), true); assert.equal(records.size, 1);
});

test('a stale historical read cannot replace the more recently selected committed data revision', async t => {
  const { create, api, records } = fixture(t), original = newResearchRecord('record-a', emptyResearchScope(), '2026-10-25T00:00:00Z');
  original.title = 'Current question'; records.set(original.id, { record: original, contentHash: 'current-hash', repositoryRevision: 'current' });
  const a = deferred<ResearchRecordEnvelope>(), b = deferred<ResearchRecordEnvelope>();
  api.history = async () => [{ oid: 'a', message: 'Earlier A', authoredAt: '2026-10-23T00:00:00Z' }, { oid: 'b', message: 'Earlier B', authoredAt: '2026-10-24T00:00:00Z' }];
  api.readRevision = async (_id, oid) => oid === 'a' ? a.promise : b.promise;
  const workspace = create(); await workspace.open();
  const first = click(workspace, 'revision', { oid: 'a' }), second = click(workspace, 'revision', { oid: 'b' });
  const historical = (title: string): ResearchRecordEnvelope => ({ record: { ...structuredClone(original), title }, contentHash: title, repositoryRevision: title });
  b.resolve(historical('Selected B')); await second;
  a.resolve(historical('Stale A')); await first;
  assert.match(workspace.content(), /Selected B/); assert.doesNotMatch(workspace.content(), /Stale A/); assert.match(workspace.content(), /Current question/);
});

test('close preparation retains raw dates without creating a working record; explicit save still validates them', async t => {
  const { create, records } = fixture(t), workspace = create();
  await workspace.open(); await workspace.newRecord(); input(workspace, 'title', 'A question'); input(workspace, 'from', '0'); input(workspace, 'to', '800');
  assert.deepEqual(await workspace.prepareClose(), { ready: true }); assert.equal(records.size, 0);
  assert.equal(await workspace.save(), false); assert.equal(records.size, 0);
  workspace.hide(); const recovered = create(); await recovered.open();
  assert.match(recovered.content(), /value="0"/); assert.match(recovered.content(), /value="800"/);
  input(recovered, 'from', '-221'); assert.equal(await recovered.save(), true); assert.equal(records.size, 1);
  assert.deepEqual([...records.values()][0].record.scope.timeWindow, [-221, 800]);
});

test('an unnamed comparison draft can leave and recover without a placeholder record', async t => {
  const { api, storage, records } = fixture(t), evidence = withEvidence('draft', 2).evidence; let closes = 0, flushes = 0;
  const create = () => createResearchWorkspace({ locale: () => 'en', render: () => {}, api, storage, flushDraft: async () => { flushes++; }, onClose: () => { closes++; } });
  const workspace = create(); await workspace.open(); await workspace.newRecord({ scope: emptyResearchScope(), evidence });
  assert.equal(workspace.hasUnsavedChanges(), true); assert.equal(await workspace.save(), false);
  await click(workspace, 'close'); assert.equal(closes, 1); assert.equal(flushes, 1); assert.equal(records.size, 0);
  const resumed = create(); await resumed.open(); assert.match(resumed.content(), /value=""/); assert.match(resumed.content(), /Attached references: 2/); assert.equal(resumed.hasUnsavedChanges(), true);
  input(resumed, 'title', 'A deliberate question'); assert.equal(await resumed.save(), true); assert.equal(records.size, 1);
});

test('discard requires confirmation and leaves an existing saved record intact', async t => {
  const { api, storage, records } = fixture(t); let closes = 0;
  const saved = withEvidence('saved', 1); saved.interpretation = 'Saved understanding'; records.set(saved.id, { record: saved, contentHash: 'initial', repositoryRevision: 'a' });
  const workspace = createResearchWorkspace({ locale: () => 'en', render: () => {}, api, storage, onClose: () => { closes++; } });
  await workspace.open(saved.id); input(workspace, 'interpretation', 'Unfinished revision');
  await click(workspace, 'discard'); assert.match(workspace.content(), /role="dialog"/); assert.equal(closes, 0); assert.equal(workspace.hasUnsavedChanges(), true);
  await click(workspace, 'cancel-draft'); assert.doesNotMatch(workspace.content(), /role="dialog"/); assert.match(workspace.content(), /Unfinished revision/);
  await click(workspace, 'discard'); await click(workspace, 'confirm-discard'); assert.equal(closes, 1); assert.equal(workspace.hasUnsavedChanges(), false); assert.equal(records.get(saved.id)?.record.interpretation, 'Saved understanding');
  const reopened = createResearchWorkspace({ locale: () => 'en', render: () => {}, api, storage, onClose: () => {} }); await reopened.open(); assert.match(reopened.content(), /Saved understanding/); assert.doesNotMatch(reopened.content(), /Unfinished revision/);
});

test('replacing a draft requires a decision; failed save does not replace its question or evidence', async t => {
  const { create, records } = fixture(t), workspace = create(), other = withEvidence('other', 1); other.title = 'Another investigation'; records.set(other.id, { record: other, contentHash: 'other', repositoryRevision: 'a' });
  await workspace.open(); await workspace.newRecord(); input(workspace, 'interpretation', 'A question still being formed'); workspace.attachEvidence(withEvidence('draft', 2).evidence);
  await click(workspace, 'open', { id: other.id }); assert.match(workspace.content(), /role="dialog"/); assert.equal(records.size, 1);
  await click(workspace, 'save-continue'); assert.match(workspace.content(), /role="dialog"/); assert.match(workspace.content(), /Enter a research question/); assert.match(workspace.content(), /A question still being formed/);
  await click(workspace, 'cancel-draft'); input(workspace, 'title', 'A new question');
  await click(workspace, 'open', { id: other.id }); await click(workspace, 'save-continue'); assert.equal(records.size, 2); assert.match(workspace.content(), /value="Another investigation"/); assert.doesNotMatch(workspace.content(), /role="dialog"/);
  const first = [...records.values()].find(value => value.record.id !== other.id)!; assert.equal(first.record.evidence.length, 2);
});

test('discard and continue can start a new investigation without saving the old draft', async t => {
  const { create, records } = fixture(t), workspace = create(); await workspace.open(); await workspace.newRecord(); input(workspace, 'title', 'Unwanted draft');
  await workspace.newRecord({ scope: { ...emptyResearchScope(), query: 'New focus' } }); assert.match(workspace.content(), /role="dialog"/); assert.match(workspace.content(), /value="Unwanted draft"/);
  await click(workspace, 'confirm-discard'); assert.match(workspace.content(), /value="New focus"/); assert.doesNotMatch(workspace.content(), /Unwanted draft/); assert.equal(records.size, 0);
});

test('a recovery write or durable flush failure blocks leaving and keeps retryable input', async t => {
  const { api, storage, records } = fixture(t); let failWrite = true, failFlush = false, closes = 0;
  const workspace = createResearchWorkspace({ locale: () => 'en', render: () => {}, api, storage: { ...storage, setItem: (key, value) => { if (failWrite) throw new Error('disk full'); storage.setItem(key, value); } }, flushDraft: async () => { if (failFlush) throw new Error('unavailable'); }, onClose: () => { closes++; } });
  await workspace.open(); await workspace.newRecord(); input(workspace, 'interpretation', 'Retain this input'); await click(workspace, 'close'); assert.equal(closes, 0); assert.match(workspace.content(), /draft could not be stored/); assert.match(workspace.content(), /Retain this input/);
  failWrite = false; failFlush = true; await click(workspace, 'close'); assert.equal(closes, 0); assert.equal(records.size, 0);
  failFlush = false; await click(workspace, 'retry-recovery'); assert.doesNotMatch(workspace.content(), /draft could not be stored/); await click(workspace, 'close'); assert.equal(closes, 1); assert.equal(records.size, 0);
});

test('failed saves remain visible after leaving and reopening the same investigation', async t => {
  const { create, api, records } = fixture(t), workspace = create(); await workspace.open(); await workspace.newRecord(); input(workspace, 'title', 'Keep the question');
  api.save = async () => { throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); }; assert.equal(await workspace.save(), false); assert.match(workspace.content(), /local service is unavailable/);
  assert.deepEqual(await workspace.prepareClose(), { ready: true }); workspace.hide(); await workspace.open(); assert.match(workspace.content(), /Keep the question/); assert.match(workspace.content(), /local service is unavailable/); assert.equal(records.size, 0);
});

test('opening the current record by id resumes rather than replaces its unfinished input', async t => {
  const { create, records } = fixture(t), saved = withEvidence('same-record', 1); records.set(saved.id, { record: saved, contentHash: 'base', repositoryRevision: 'a' });
  const workspace = create(); await workspace.open(saved.id); input(workspace, 'interpretation', 'An unfinished conclusion');
  await workspace.open(saved.id); assert.equal(workspace.hasUnsavedChanges(), true); assert.match(workspace.content(), /An unfinished conclusion/); assert.equal(records.get(saved.id)?.record.interpretation, '');
});

test('reopening after an external commit refreshes data revisions without losing an unsaved interpretation', async t => {
  const { create, api, records } = fixture(t), workspace = create();
  await workspace.open(); await workspace.newRecord(); input(workspace, 'title', 'A question'); await workspace.save();
  const record = [...records.values()][0].record;
  api.history = async () => [{ oid: 'new-commit', message: 'Committed research', authoredAt: '2026-10-25T00:00:00Z' }];
  workspace.hide(); await workspace.open(); assert.match(workspace.content(), /Committed research/);
  input(workspace, 'interpretation', 'Unfinished interpretation');
  records.set(record.id, { record: { ...record, interpretation: 'External edit' }, contentHash: 'changed-elsewhere', repositoryRevision: 'new-commit' });
  workspace.hide(); await workspace.open();
  assert.match(workspace.content(), /Unfinished interpretation/); assert.match(workspace.content(), /Keep draft as new investigation/);
});

test('late record-list results cannot reopen an older selection', async t => {
  const { create, api, records } = fixture(t);
  for (const id of ['a', 'b']) { const record = newResearchRecord(id, emptyResearchScope(), '2026-10-25T00:00:00Z'); record.title = `Question ${id}`; records.set(id, { record, contentHash: id, repositoryRevision: 'current' }); }
  const firstList = deferred<ResearchRecord[]>(), secondList = deferred<ResearchRecord[]>(); let requests = 0;
  api.list = async () => (++requests === 1 ? firstList.promise : secondList.promise);
  const workspace = create(), first = workspace.open('a'), second = workspace.open('b');
  secondList.resolve([...records.values()].map(value => value.record)); await second;
  firstList.resolve([...records.values()].map(value => value.record)); await first;
  assert.match(workspace.content(), /value="Question b"/); assert.doesNotMatch(workspace.content(), /value="Question a"/);
});

test('saved snapshot endpoint names follow locale, mark an English fallback and leave legacy labels unchanged',async t=>{
  const {records,api,storage}=fixture(t),record=withEvidence('snapshot-labels',0);let locale:'en'|'zh-CN'='en';
  record.comparison={a:{label:'Original snapshot',labels:{en:'Original snapshot','zh-CN':'固定旧名称'},objectId:'object:old',repositoryRevision:'1'.repeat(40),year:1336,includeUnreviewed:false},b:{label:'English source name',labels:{en:'English source name'},objectId:'object:old',repositoryRevision:'1'.repeat(40),year:1370,includeUnreviewed:true}};
  const before=JSON.stringify(record);records.set(record.id,{record,contentHash:'before',repositoryRevision:null});const workspace=createResearchWorkspace({locale:()=>locale,render:()=>{},api,storage,onClose:()=>{}});await workspace.open(record.id);assert.match(workspace.content(),/<strong lang="en">Original snapshot/);
  locale='zh-CN';const html=workspace.content();assert.match(html,/<strong lang="zh-CN">固定旧名称/);assert.match(html,/<strong lang="en">English source name<span class="knowledge-language"[^>]*>EN<\/span>/);assert.equal(workspace.hasUnsavedChanges(),false);assert.equal(JSON.stringify(records.get(record.id)!.record),before);
  const legacy=structuredClone(record);legacy.id='legacy-labels';delete legacy.comparison!.a.labels;delete legacy.comparison!.b.labels;records.set(legacy.id,{record:legacy,contentHash:'legacy',repositoryRevision:null});await workspace.open(legacy.id);assert.match(workspace.content(),/<strong>Original snapshot<\/strong>/);assert.doesNotMatch(workspace.content(),/knowledge-language/);
});
