import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeFiles, type KnowledgeFilesApi } from './knowledge-files.ts';
import { ServiceFailure } from './client.ts';
import type { KnowledgeFileImportRequest, KnowledgeFilePreviewResult, KnowledgeImportResult, OperationProgress } from '@gitworld/contracts';
import type { KnowledgePendingImport } from '../../../../packages/contracts/src/knowledge-import-types.ts';

const OLD = '1'.repeat(40), NEW = '2'.repeat(40), PREVIEW = 'a'.repeat(64);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const filePreview = (): KnowledgeFilePreviewResult => ({ fileName: 'fixture-import.json', bytes: 100, preview: { inputHash: 'b'.repeat(64), objects: 1, assertions: 2, datedAssertions: 2, locatedObjects: 0, issues: [], issueCount: 0, sample: [], mappingVersions: [], prepared: { id: PREVIEW, fingerprintVersion: 2, baseHead: OLD }, vocabulary: { id: 'fixture-catalog', revision: '1', properties: 45, types: 0, values: 0, catalog: { schemaVersion: 1, kind: 'historical-field-display-labels', properties: Array.from({ length: 45 }, (_, index) => ({ id: `fixture:field:${index}`, labels: { en: `English field ${index}`, ...(index ? { 'zh-CN': `字段 ${index}` } : {}) } })), types: [] }, origin: { identity: { provider: 'fixture', externalId: 'catalog' }, url: 'https://example.invalid/catalog', retrievedAt: '2026-10-25T00:00:00Z', rights: { redistribution: 'unknown' }, evidence: [{ sourceId: 'fixture-source', sourceHash: 'c'.repeat(64), locator: '$.catalog' }] }, missing: [{ key: 'fixture:field:0', language: 'zh-CN' }], missingCount: 1, conflicts: [], conflictCount: 0 } } });
const pendingItem = (operationId = 'accepted-operation'): KnowledgePendingImport => ({ operationId, previewId: PREVIEW, baseHead: OLD, counts: { objects: 1, assertions: 2, datedAssertions: 2, locatedObjects: 0 }, vocabulary: { id: 'fixture-catalog', revision: '1' }, review: 'unreviewed' });
const click = (files: ReturnType<typeof createKnowledgeFiles>, action: string, extra = {}) => files.click({ dataset: { knowledgeFile: action, ...extra } } as unknown as HTMLElement);

function fixture(t: { after(fn: () => void): void }) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), progressText = { textContent: '' };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelectorAll: () => [], querySelector: (selector: string) => selector === '[data-knowledge-file-progress]' ? progressText : null } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); });
  let value = filePreview(), pending: KnowledgePendingImport[] = [], epoch = 10, selections = 0, statuses = 0;
  const adoptions: KnowledgeFileImportRequest[] = [], resumes: { operationId: string; previewId: string }[] = [], callbacks: { jobId: string; interaction?: number }[] = [];
  const result = (): KnowledgeImportResult => ({ preview: structuredClone(value.preview), changedObjects: ['fixture-object'], unchangedObjects: [], paths: ['objects/fixture.json'], conflicts: [] });
  const api: KnowledgeFilesApi = {
    async preview() { return structuredClone(value); }, async adopt(input) { adoptions.push(input); return result(); }, async pending() { return structuredClone(pending); }, async resume(input) { resumes.push(input); pending = []; return result(); },
    async status() { statuses++; return { head: NEW, branch: 'main', stagedTree: '3'.repeat(40), staged: [], unstaged: [], conflicts: [], revert: null }; }, async conflicts() { return []; }, async object() { throw new Error('unexpected object'); }, async resolve() {},
  };
  const create = () => createKnowledgeFiles({ locale: () => 'en', render() {}, api, selectFile: async () => { selections++; return { fileToken: 'host-token' }; }, navigationVersion: () => epoch, onAdopted: (_result, jobId, interaction) => { callbacks.push({ jobId, interaction }); } });
  return { api, create, result, adoptions, resumes, callbacks, progressText, statuses: () => statuses, selections: () => selections, preview: () => value, setPreview: (next: KnowledgeFilePreviewResult) => { value = next; }, pending: () => pending, setPending: (next: KnowledgePendingImport[]) => { pending = next; }, epoch: (next: number) => { epoch = next; } };
}

test('selecting a replacement file removes the previous rendered preview before the next preview arrives', async t => {
  const f = fixture(t), rendered: string[] = [];
  let files: ReturnType<typeof createKnowledgeFiles>;
  files = createKnowledgeFiles({ locale: () => 'en', render: () => { rendered.push(files.content()); }, api: f.api, selectFile: async () => ({ fileToken: 'host-token' }) });
  await files.open(); await click(files, 'choose'); await click(files, 'adopt');
  assert.match(rendered.at(-1)!, /fixture-import.json/);
  const gate = deferred<KnowledgeFilePreviewResult>(); let reading = false;
  f.api.preview = async () => { reading = true; return gate.promise; };
  const replacing = click(files, 'choose');
  for (let turn = 0; !reading && turn < 20; turn++) await Promise.resolve();
  assert.equal(reading, true); assert.doesNotMatch(rendered.at(-1)!, /fixture-import.json/);
  assert.match(rendered.at(-1)!, /data-knowledge-file-progress/);
  assert.doesNotMatch(rendered.at(-1)!, /Select a file to inspect/);
  gate.resolve({ ...f.preview(), fileName: 'replacement.json' }); await replacing;
  assert.match(rendered.at(-1)!, /replacement.json/);
});

test('paired adoption uses the immutable preview base and id, never a newer independent status', async t => {
  const f = fixture(t), files = f.create(); await files.open(); await click(files, 'choose'); await click(files, 'adopt');
  assert.equal(f.statuses(), 0); assert.equal(f.adoptions[0].expectedHead, OLD); assert.equal(f.adoptions[0].previewId, PREVIEW); assert.equal(f.adoptions[0].expectedInputHash, f.preview().preview.inputHash); assert.equal(f.adoptions[0].review, 'unreviewed');
  assert.equal(f.callbacks[0].interaction, 10); assert.match(files.content(), /records are in working changes/);
});

test('ordinary collection-only preview retains its existing status and token path', async t => {
  const f = fixture(t), plain = f.preview(); delete plain.preview.prepared; delete plain.preview.vocabulary; f.setPreview(plain);
  const files = f.create(); await files.open(); await click(files, 'choose'); await click(files, 'adopt');
  assert.equal(f.statuses(), 1); assert.equal(f.adoptions[0].expectedHead, NEW); assert.equal(f.adoptions[0].previewId, undefined); assert.equal(f.adoptions[0].fileToken, 'host-token');
});

test('catalog rows are paged, missing names and unknown rights stay explicit, conflicts prevent Apply', async t => {
  const f = fixture(t), files = f.create(); await files.open(); await click(files, 'choose');
  assert.equal((files.content().match(/<span lang="en">/g) ?? []).length, 20); assert.doesNotMatch(files.content(), /English field 44/); assert.match(files.content(), /Missing name/); assert.match(files.content(), /Terms unknown/);
  await click(files, 'catalog-page', { target: 'page', page: '2' }); assert.match(files.content(), /English field 44/); assert.doesNotMatch(files.content(), /English field 0/);
  const conflicting = f.preview(); conflicting.preview.vocabulary!.conflicts = [{ key: 'fixture:field:1', language: 'en', local: 'Local title', incoming: 'Incoming title' }]; conflicting.preview.vocabulary!.conflictCount = 1; f.setPreview(conflicting);
  await click(files, 'preview'); await click(files, 'adopt'); assert.equal(f.adoptions.length, 0); assert.match(files.content(), /Local title/); assert.match(files.content(), /Incoming title/);
});

test('a partial failure discovers the real pending receipt; restart resumes without choosing the file', async t => {
  const f = fixture(t); f.api.adopt = async input => { f.adoptions.push(input); f.setPending([pendingItem(input.operationId)]); throw new ServiceFailure({ code: 'IO_ERROR' }); };
  const first = f.create(); await first.open(); await click(first, 'choose'); await click(first, 'adopt'); assert.match(first.content(), /data-knowledge-file="resume"/); assert.match(first.content(), /fixture-import.json/);
  const selected = f.selections(), restarted = f.create(); await restarted.open(); const receipt = f.pending()[0];
  f.epoch(20); const gate = deferred<KnowledgeImportResult>(); f.api.resume = async input => { f.resumes.push(input); return gate.promise; };
  const resuming = click(restarted, 'resume', { operation: receipt.operationId, preview: receipt.previewId }); f.epoch(30); f.setPending([]); gate.resolve(f.result()); await resuming;
  assert.deepEqual(f.resumes[0], { operationId: receipt.operationId, previewId: receipt.previewId }); assert.equal(f.selections(), selected); assert.equal(f.callbacks.at(-1)?.interaction, 20); assert.equal(f.adoptions.length, 1); assert.match(restarted.content(), /Accepted import preview/);
});

test('pending read failure blocks a new Apply and never invents a Resume entry', async t => {
  const f = fixture(t), files = f.create(); await files.open(); await click(files, 'choose');
  f.api.pending = async () => { throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); }; await click(files, 'pending'); await click(files, 'adopt');
  assert.equal(f.adoptions.length, 0); assert.match(files.content(), /Pending imports could not be read/); assert.doesNotMatch(files.content(), /data-knowledge-file="resume"/);
});

test('late empty refresh cannot erase a newer pending recovery state', async t => {
  const f = fixture(t), a = deferred<KnowledgePendingImport[]>(), b = deferred<KnowledgePendingImport[]>(); let calls = 0; f.api.pending = () => (++calls === 1 ? a.promise : b.promise);
  const files = f.create(), first = files.open(), second = files.open(); b.resolve([pendingItem()]); await second; a.resolve([]); await first;
  assert.match(files.content(), /data-knowledge-file="resume"/); await click(files, 'choose'); assert.equal(f.selections(), 0);
});

test('uncertain result uses the same receipt check rather than silently applying a second operation', async t => {
  const f = fixture(t); f.api.adopt = async input => { f.adoptions.push(input); throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' }); };
  const files = f.create(); await files.open(); await click(files, 'choose'); await click(files, 'adopt'); await click(files, 'adopt'); assert.equal(f.adoptions.length, 1); assert.match(files.content(), /Check import result/); assert.doesNotMatch(files.content(), /data-knowledge-file="resume"/);
  await click(files, 'check-result'); assert.equal(f.resumes[0].operationId, f.adoptions[0].operationId); assert.equal(f.resumes[0].previewId, PREVIEW);
});

test('real write progress matches the current operation and subscriptions leave with the view', async t => {
  const f = fixture(t), gate = deferred<KnowledgeImportResult>(); let listener: ((event: OperationProgress) => void) | null = null, unsubscribed = 0;
  f.api.adopt = async input => { f.adoptions.push(input); return gate.promise; };
  const files = createKnowledgeFiles({ locale: () => 'en', render() {}, api: f.api, selectFile: async () => ({ fileToken: 'host-token' }), subscribeProgress: callback => { listener = callback; return () => { unsubscribed++; }; } });
  await files.open(); await click(files, 'choose'); const adopting = click(files, 'adopt');
  assert.ok(listener); (listener as (event: OperationProgress) => void)({ operationId: 'other', stage: 'writing', completed: 5, total: 10 }); assert.equal(f.progressText.textContent, '');
  (listener as (event: OperationProgress) => void)({ operationId: f.adoptions[0].operationId, stage: 'writing', completed: 5, total: 10 }); assert.equal(f.progressText.textContent, 'Writing files · 5/10');
  files.hide(); assert.ok(unsubscribed > 0); gate.resolve(f.result()); await adopting;
});

test('a concurrent catalog conflict preserves its local/incoming names and the selected preview', async t => {
  const f = fixture(t); f.api.adopt = async () => { throw new ServiceFailure({ code: 'CONFLICT', vocabularyConflicts: [{ key: 'fixture:field:1', language: 'en', local: 'Later local name', incoming: 'Imported name' }] }); };
  const files = f.create(); await files.open(); await click(files, 'choose'); await click(files, 'adopt');
  assert.match(files.content(), /Later local name/); assert.match(files.content(), /Imported name/); assert.match(files.content(), /fixture-import.json/); assert.match(files.content(), /Check import result/);
  f.api.resume = async () => { throw new ServiceFailure({ code: 'NOT_FOUND' }); }; await click(files, 'check-result');
  assert.match(files.content(), /No accepted receipt was found/); assert.doesNotMatch(files.content(), /data-knowledge-file="resume"/); assert.equal(f.preview().preview.vocabulary!.origin.rights.redistribution, 'unknown');
});

test('all supplied mapping issues remain reachable through bounded pages', async t => {
  const f = fixture(t), value = f.preview(); value.preview.issues = Array.from({ length: 31 }, (_, index) => ({ code: `ISSUE_${index}`, locator: `row:${index}` })); value.preview.issueCount = 40; f.setPreview(value);
  const files = f.create(); await files.open(); await click(files, 'choose'); assert.match(files.content(), /ISSUE_19/); assert.doesNotMatch(files.content(), /ISSUE_30/);
  await click(files, 'issues-page', { page: '1' }); assert.match(files.content(), /ISSUE_30/); assert.match(files.content(), /total reported: 40/);
});

test('an explicit existing-import barrier points to recovery without inventing a receipt for the rejected request', async t => {
  const f = fixture(t), files = f.create(); await files.open(); await click(files, 'choose');
  f.api.adopt = async () => { f.setPending([pendingItem('other-accepted-operation')]); throw new ServiceFailure({ code: 'REVIEW_REQUIRED', parameters: { reason: 'paired-import-pending' } }); };
  await click(files, 'adopt'); assert.match(files.content(), /Library → Sources → Imports and matches/); assert.match(files.content(), /other-accepted-operation/); assert.doesNotMatch(files.content(), /data-knowledge-file="check-result"/);
});
