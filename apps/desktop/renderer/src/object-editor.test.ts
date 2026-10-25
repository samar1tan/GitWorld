import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectEditor, type ObjectEditorApi } from './object-editor.ts';
import { blankObjectEditForm, parseObjectEditForm, parseObjectEditRecovery } from './object-editor-form.ts';
import { ServiceFailure } from './client.ts';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection } from '../../../../packages/domain/src/knowledge.ts';
import type { KnowledgeEditContext, KnowledgeSaveEditRequest, KnowledgeSaveEditResult } from '../../../../packages/contracts/src/knowledge-editor-types.ts';

const validForm = () => ({ ...blankObjectEditForm(), nameEn: 'A subject', propertyId: 'property', text: 'An observation', from: '630', sourceTitle: 'A source', sourceUrl: 'https://example.invalid/source', locator: 'section 1', reason: 'A sourced addition' });
const context = (objectId?: string, value = 'Original value'): KnowledgeEditContext => {
  const source = { id: 'source', identity: { provider: 'fixture', externalId: 'source' }, revision: 'source-v1', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', adapterVersion: 'fixture', rights: { redistribution: 'unknown' as const } };
  const assertion: KnowledgeAssertion = { id: 'claim', subjectId: objectId ?? 'object', propertyId: 'property', value: { kind: 'text', value, language: 'en' }, qualifiers: [{ propertyId: 'qualifier', value: { kind: 'text', value: 'Keep this qualifier' } }], evidence: [{ sourceId: source.id, locator: 'section 1' }], sourceSnapshotId: source.id, review: 'adopted', validTime: { point: { earliestYear: 630, latestYear: 630, precision: 'day', calendar: 'source-calendar', month: 1, day: 20 } } };
  const collection: KnowledgeCollection = { schemaVersion: 1, objects: [{ id: objectId ?? 'object', labels: { en: objectId ?? 'Object', 'zh-CN': '对象' }, descriptions: {}, aliases: [], identities: [], types: [] }], assertions: [assertion], sources: [source] };
  return { head: '1'.repeat(40), objectHash: objectId ? '2'.repeat(64) : null, object: objectId ? { object: createKnowledgeIndex(collection).object(objectId)!, assertions: [assertion], sources: [source], revision: 'working', working: true } : null, sources: [{ ...source, title: { en: 'A source', 'zh-CN': '一份来源' } }], catalog: { schemaVersion: 1, kind: 'historical-field-display-labels', properties: [{ id: 'property', labels: { en: 'Field', 'zh-CN': '字段' } }], types: [{ id: 'type', labels: { en: 'Type', 'zh-CN': '类型' } }] } };
};
function fixture(t: { after(fn: () => unknown): void }) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document'); Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'document', prior); else Reflect.deleteProperty(globalThis, 'document'); });
  const buffers = new Map<string, string>(), storage = { getItem: (key: string) => buffers.get(key) ?? null, setItem: (key: string, value: string) => { buffers.set(key, value); }, removeItem: (key: string) => { buffers.delete(key); } };
  const calls: KnowledgeSaveEditRequest[] = [], saved = new Map<string, KnowledgeSaveEditResult>(), observed: KnowledgeSaveEditResult[] = []; let generation = 0, closed = 0, currentHead = '1'.repeat(40), currentHash = '2'.repeat(64), currentValue = 'Original value';
  const api: ObjectEditorApi = {
    async context(id) { return { ...context(id, currentValue), head: currentHead, objectHash: id ? currentHash : null }; },
    async query() { return createKnowledgeIndex({ schemaVersion: 1, objects: [], assertions: [], sources: [] }).query({}); },
    async save(request) {
      calls.push(structuredClone(request)); const prior = saved.get(request.operationId); if (prior) return prior;
      if (request.expectedHead !== currentHead) throw new ServiceFailure({ code: 'HEAD_CHANGED' });
      if (request.objectId && request.expectedObjectHash !== currentHash) throw new ServiceFailure({ code: 'CONTENT_CHANGED' });
      const result = { objectId: request.objectId ?? `created:${++generation}`, assertionId: request.assertionId ?? 'created-claim', head: currentHead, objectHash: '3'.repeat(64), paths: ['objects/changed.json', 'sources/amendment.json'] }; saved.set(request.operationId, result); return result;
    },
  };
  const create = (flushDraft?: () => Promise<void>) => createObjectEditor({ locale: () => 'en', render: () => {}, api, storage, flushDraft, onClose: () => { closed++; }, onSaved: result => { observed.push(result); } });
  return { api, storage, buffers, calls, saved, observed, create, created: () => generation, closed: () => closed, advance: () => { currentHead = '4'.repeat(40); currentHash = '5'.repeat(64); currentValue = 'A newer working value'; } };
}
const input = (editor: ReturnType<typeof createObjectEditor>, key: string, value: string) => editor.input({ dataset: { objectInput: key }, value } as unknown as HTMLInputElement);
const change = (editor: ReturnType<typeof createObjectEditor>, key: string, value: string) => editor.change({ dataset: { objectChange: key }, value } as unknown as HTMLSelectElement);
const click = (editor: ReturnType<typeof createObjectEditor>, action: string, extra = {}) => editor.click({ dataset: { objectEditor: action, ...extra } } as unknown as HTMLElement);
function fillNew(editor: ReturnType<typeof createObjectEditor>) {
  for (const key of ['nameEn', 'text', 'from', 'sourceTitle', 'sourceUrl', 'locator', 'reason'] as const) input(editor, key, validForm()[key]);
  change(editor, 'propertyId', 'property'); change(editor, 'sourceMode', 'citation');
}

test('correction patches omit untouched complex values and high-precision applicability', () => {
  const form = { ...validForm(), mode: 'correct' as const, assertionId: 'claim', valueMode: 'keep' as const, timeMode: 'keep' as const };
  const parsed = parseObjectEditForm(form, true); assert.ok(parsed.ok);
  assert.equal('value' in parsed.change, false); assert.equal('validTime' in parsed.change, false);
  const undated = parseObjectEditForm({ ...form, timeMode: 'none' }, true); assert.ok(undated.ok); assert.equal(undated.change.validTime, null);
});

test('entity text is not an object identity and date or coordinate errors do not become claims', () => {
  assert.deepEqual(parseObjectEditForm({ ...validForm(), valueKind: 'entity', entityQuery: 'A name' }, false), { ok: false, code: 'entityRequired' });
  const chosen = parseObjectEditForm({ ...validForm(), valueKind: 'entity', entityId: 'real-object' }, false); assert.ok(chosen.ok); assert.deepEqual(chosen.change.value, { kind: 'entity', objectId: 'real-object' });
  assert.deepEqual(parseObjectEditForm({ ...validForm(), from: '0' }, false), { ok: false, code: 'invalidTime' });
  assert.deepEqual(parseObjectEditForm({ ...validForm(), valueKind: 'coordinate', latitude: '91', longitude: '0' }, false), { ok: false, code: 'invalidCoordinate' });
  // Username-only userinfo exercises credential rejection without a password fixture.
  assert.deepEqual(parseObjectEditForm({ ...validForm(), sourceUrl: 'https://user@example.invalid' }, false), { ok: false, code: 'httpsRequired' });
});

test('new subject saves a structured unreviewed increment after its draft is flushed', async t => {
  const value = fixture(t), order: string[] = [], original = value.api.save;
  value.api.save = async request => { order.push('save'); assert.equal(JSON.parse(value.buffers.get('gitworld-object-input-v1')!).attemptId, request.operationId); return original(request); };
  const editor = value.create(async () => { order.push('flush'); }); await editor.open(); fillNew(editor);
  assert.equal(await editor.save(), true); assert.deepEqual(order, ['flush', 'save']); assert.equal(value.calls[0].change.review, 'unreviewed');
  assert.equal(value.calls[0].objectId, undefined); assert.deepEqual(value.calls[0].change.newObject?.labels, { en: 'A subject' }); assert.equal(value.created(), 1); assert.equal(value.observed.length, 1); assert.equal(value.buffers.size, 0);
  assert.equal(await editor.save(), true); assert.equal(value.calls.length, 1, 'Re-saving the receipt does not add a second observation');
});

test('a working correction keeps source data out of its patch and retains the supplied base guards', async t => {
  const value = fixture(t), editor = value.create(); await editor.open({ objectId: 'object', assertionId: 'claim', observedRevision: '9'.repeat(40), year: 630 }); input(editor, 'reason', 'Correct the interpretation');
  assert.equal(await editor.save(), true); const request = value.calls[0];
  assert.equal(request.expectedHead, '1'.repeat(40)); assert.equal(request.expectedObjectHash, '2'.repeat(64)); assert.equal('value' in request.change, false); assert.equal('validTime' in request.change, false); assert.equal('qualifiers' in request.change, false);
  assert.deepEqual(request.change.evidence, { sourceId: 'source', locator: 'section 1' });
});

test('a stale base retains input and requires review plus explicit adoption of the displayed current base', async t => {
  const value = fixture(t), editor = value.create(); await editor.open({ objectId: 'object', assertionId: 'claim' }); input(editor, 'reason', 'Keep this correction reason'); value.advance();
  assert.equal(await editor.save(), false); assert.match(editor.content(), /Keep this correction reason/); await click(editor, 'use-base'); assert.equal(await editor.save(), false); assert.equal(value.calls.length, 1);
  await click(editor, 'review-base'); assert.match(editor.content(), /A newer working value/); assert.equal(await editor.save(), false);
  await click(editor, 'use-base'); assert.equal(await editor.save(), true); assert.equal(value.calls.at(-1)!.expectedHead, '4'.repeat(40)); assert.equal(value.calls.at(-1)!.change.reason, 'Keep this correction reason');
});

test('an uncertain save locks its input and retries the same operation after restart without duplicating the subject', async t => {
  const value = fixture(t), original = value.api.save; let lose = true;
  value.api.save = async request => { const result = await original(request); if (lose) { lose = false; throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); } return result; };
  const first = value.create(); await first.open(); fillNew(first); assert.equal(await first.save(), false); input(first, 'reason', 'Should not replace an uncertain request'); first.hide();
  const restarted = value.create(); await restarted.open(); assert.match(restarted.content(), /Check save result/); await click(restarted, 'check-result');
  assert.equal(value.created(), 1); assert.equal(value.calls.length, 2); assert.equal(value.calls[0].operationId, value.calls[1].operationId); assert.deepEqual(value.calls[0], value.calls[1]); assert.equal(value.observed.length, 1);
});

test('failure to persist a prepared draft does not send a domain write or claim an uncertain save', async t => {
  const value = fixture(t), editor = value.create(async () => { throw new Error('PREFS_UNAVAILABLE'); }); await editor.open(); fillNew(editor);
  assert.equal(await editor.save(), false); assert.equal(value.calls.length, 0); assert.match(editor.content(), /could not be cached/); assert.doesNotMatch(editor.content(), /previous save has no confirmed result/);
  assert.deepEqual(await editor.prepareClose(), { ready: false, reason: 'unsaved-input' });
});

test('unfinished input closes into recovery without creating historical data', async t => {
  const value = fixture(t), first = value.create(); await first.open(); input(first, 'nameEn', 'An unfinished subject'); input(first, 'from', 'not a year');
  assert.deepEqual(await first.prepareClose(), { ready: true }); first.hide(); assert.equal(value.calls.length, 0);
  const second = value.create(); await second.open(); assert.match(second.content(), /An unfinished subject/); assert.match(second.content(), /not a year/); assert.equal(value.calls.length, 0);
});

test('recovery rejects invalid guards and unsupported form enums instead of executing hidden requests', () => {
  const value = { schemaVersion: 1, target: {}, form: validForm(), expectedHead: '1'.repeat(40), expectedObjectHash: null, attemptId: null, request: { method: 'something-else' } };
  const parsed = parseObjectEditRecovery(JSON.stringify(value)); assert.ok(parsed); assert.equal('request' in parsed, false);
  assert.equal(parseObjectEditRecovery(JSON.stringify({ ...value, expectedHead: 'working' })), null);
  assert.equal(parseObjectEditRecovery(JSON.stringify({ ...value, form: { ...value.form, valueKind: 'not-supported' } })), null);
});

test('discard requires confirmation and only removes the unfinished draft', async t => {
  const value = fixture(t), editor = value.create(); await editor.open(); fillNew(editor);
  await click(editor, 'discard'); assert.match(editor.content(), /Discard this unfinished edit/); assert.equal(await editor.save(), false); assert.equal(value.calls.length, 0);
  await click(editor, 'cancel-replace'); assert.match(editor.content(), /A subject/); assert.equal(editor.hasUnsavedChanges(), true);
  await click(editor, 'discard'); await click(editor, 'confirm-replace'); assert.equal(value.closed(), 1); assert.equal(value.buffers.size, 0); assert.equal(value.calls.length, 0);
  const next = value.create(); await next.open(); assert.doesNotMatch(next.content(), /A subject/); assert.equal(next.hasUnsavedChanges(), false);
});

test('an unconfirmed save cannot be discarded before its existing operation is checked', async t => {
  const value = fixture(t), original = value.api.save;
  value.api.save = async request => { await original(request); throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); };
  const editor = value.create(); await editor.open(); fillNew(editor); assert.equal(await editor.save(), false);
  await click(editor, 'discard'); await click(editor, 'confirm-replace'); assert.equal(value.closed(), 0); assert.equal(value.buffers.size, 1); assert.equal(value.created(), 1); assert.match(editor.content(), /Check save result/); assert.doesNotMatch(editor.content(), /data-object-editor="discard"/);
});

test('discard persistence failure retains the input and keeps the editor open', async t => {
  const value = fixture(t), editor = value.create(async () => { throw new Error('PREFS_UNAVAILABLE'); }); await editor.open(); fillNew(editor);
  await click(editor, 'discard'); await click(editor, 'confirm-replace'); assert.equal(value.closed(), 0); assert.equal(value.buffers.size, 1); assert.equal(editor.hasUnsavedChanges(), true); assert.match(editor.content(), /A subject/); assert.equal(value.calls.length, 0);
});

test('close preparation waits for discard persistence and its callback can prepare the closed editor', async t => {
  const value = fixture(t); let finish!: () => void, closed = 0;
  const flushing = new Promise<void>(resolve => { finish = resolve; });
  const editor = createObjectEditor({ locale: () => 'en', render: () => {}, api: value.api, storage: value.storage, flushDraft: () => flushing, onClose: async () => { assert.deepEqual(await editor.prepareClose(), { ready: true }); closed++; } });
  await editor.open(); fillNew(editor); await click(editor, 'discard');
  const discarded = click(editor, 'confirm-replace'), prepared = editor.prepareClose(); finish(); await discarded;
  assert.deepEqual(await prepared, { ready: true }); assert.equal(value.buffers.size, 0); assert.equal(closed, 1); assert.equal(value.calls.length, 0);
});

test('submitting an unrelated form cannot save the object editor', async t => {
  const value = fixture(t), editor = value.create(); await editor.open(); fillNew(editor);
  assert.equal(await editor.submit({ dataset: { terminalForm: '' } } as unknown as HTMLFormElement), false);
  assert.equal(value.calls.length, 0); assert.equal(editor.hasUnsavedChanges(), true);
  assert.equal(await editor.submit({ dataset: { objectForm: '' } } as unknown as HTMLFormElement), true); assert.equal(value.calls.length, 1);
});

test('resume reopens the recovered target without treating it as a request for a new object', async t => {
  const value = fixture(t), first = value.create(); await first.open({ objectId: 'object', assertionId: 'claim', year: 630 }); input(first, 'reason', 'Resume this correction'); await first.prepareClose(); first.hide();
  const resumed = value.create(); await resumed.resume(); assert.match(resumed.content(), /Resume this correction/); assert.match(resumed.content(), /Correct claim/); assert.doesNotMatch(resumed.content(), /Replace this unfinished edit/); assert.equal(value.calls.length, 0); resumed.hide();
  const requestedNew = value.create(); await requestedNew.open({}); assert.match(requestedNew.content(), /Replace this unfinished edit/); assert.match(requestedNew.content(), /Resume this correction/); assert.equal(value.calls.length, 0);
});

test('pending-import recovery retains the object draft and ordinary review does not offer that route', async t => {
  const f = fixture(t); let reason: string | undefined = 'paired-import-pending', resumed = 0,contextResumed=0;
  f.api.save = async () => { throw new ServiceFailure({ code: 'REVIEW_REQUIRED', ...(reason ? { parameters: { reason } } : {}) }); };
  const editor = createObjectEditor({ locale: () => 'en', render() {}, api: f.api, storage: f.storage, onClose() {}, onResumeImport: async () => { assert.deepEqual(await editor.prepareClose(), { ready: true }); resumed++; },onResumeContext:async()=>{assert.deepEqual(await editor.prepareClose(),{ready:true});contextResumed++;} });
  await editor.open(); fillNew(editor); assert.equal(await editor.save(), false); assert.match(editor.content(), /unfinished import/); assert.match(editor.content(), /data-object-editor="resume-import"/);
  await click(editor, 'resume-import'); assert.equal(resumed, 1); assert.equal(editor.hasUnsavedChanges(), true); assert.ok(f.storage.getItem('gitworld-object-input-v1')?.includes('A sourced addition')); assert.equal(f.saved.size, 0);
  reason='navigation-operation-pending';await editor.save();assert.match(editor.content(),/data-object-editor="resume-context"/);assert.doesNotMatch(editor.content(),/data-object-editor="resume-import"/);await click(editor,'resume-context');assert.equal(contextResumed,1);assert.ok(f.storage.getItem('gitworld-object-input-v1')?.includes('A sourced addition'));
  reason = undefined; await editor.save(); assert.doesNotMatch(editor.content(), /data-object-editor="resume-import"/); assert.match(editor.content(), /edit could not be saved/);
});
