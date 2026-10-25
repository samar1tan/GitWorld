import test from 'node:test';
import assert from 'node:assert/strict';
import { createClosePreparation } from './close-preparation.ts';
import { createWorkspacePersistence } from './workspace-persistence.ts';
import type { WorkspaceState } from '@gitworld/contracts';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function state(id: string): WorkspaceState {
  return { id: 'primary', version: 0, dataset: { datasetId: 'world', revisionId: id }, locale: 'en', head: null, comparison: null, view: { panel: 'browse', scopeId: null, processId: null, eventId: null, selectedCommitId: null, graphRef: null, cursor: null, timeWindow: [1, 100], viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] };
}

test('close acknowledges only after the last coalesced workspace has reached storage', async () => {
  const writes: { data: WorkspaceState; complete: ReturnType<typeof deferred<WorkspaceState>> }[] = [];
  const writer = createWorkspacePersistence(input => { const complete = deferred<WorkspaceState>(); writes.push({ data: input.workspace, complete }); return complete.promise; });
  writer.bind(2); const first = writer.save(state('first')); const latest = writer.save(state('latest'));
  let frozen = false, ready = false;
  const close = createClosePreparation({ freeze: () => { frozen = true; }, flush: () => writer.pause(), resume: () => { frozen = false; writer.resume(); }, failed: error => { throw error; }, hasUnsavedInput: () => false });
  const preparing = close.prepare().then(result => { ready = result.ready; return result; });
  assert.equal(frozen, true); assert.equal(ready, false);
  writes[0].complete.resolve({ ...writes[0].data, version: 3 }); await Promise.resolve();
  assert.equal(writes.length, 2); assert.equal(ready, false); assert.equal(writes[1].data.dataset.revisionId, 'latest');
  writes[1].complete.resolve({ ...writes[1].data, version: 4 }); await Promise.all([first, latest]);
  assert.deepEqual(await preparing, { ready: true }); assert.equal(writer.version, 4);
  await assert.rejects(writer.save(state('late-input')), /WORKSPACE_SUSPENDED/);
});

test('failed flushing keeps the window editable and a retry can complete', async () => {
  let attempts = 0, frozen = false, observed: unknown;
  const close = createClosePreparation({ freeze: () => { frozen = true; }, flush: async () => { if (++attempts === 1) throw new Error('save rejected'); }, resume: () => { frozen = false; }, failed: error => { observed = error; }, hasUnsavedInput: () => false });
  assert.deepEqual(await close.prepare(), { ready: false, reason: 'save-failed' });
  assert.equal(frozen, false); assert.equal((observed as Error).message, 'save rejected');
  assert.deepEqual(await close.prepare(), { ready: true }); assert.equal(frozen, true);
});

test('cancelled or timed-out close ignores a late successful flush and supports a new attempt', async () => {
  const flush = deferred<void>(); let resumes = 0;
  const close = createClosePreparation({ freeze: () => {}, flush: () => flush.promise, resume: () => { resumes++; }, failed: () => {}, hasUnsavedInput: () => false });
  const old = close.prepare(); close.cancel(); close.cancel(); assert.equal(resumes, 1);
  const retry = close.prepare(); flush.resolve();
  assert.deepEqual(await old, { ready: false, reason: 'save-failed' });
  assert.deepEqual(await retry, { ready: true });
});

test('unsaved form input is reported after draining and is not saved or discarded by preparation', async () => {
  const flush = deferred<void>(); let checked = false, resumes = 0;
  const input = { title: 'Typed but not submitted' };
  const close = createClosePreparation({ freeze: () => {}, flush: () => flush.promise, resume: () => { resumes++; }, failed: () => {}, hasUnsavedInput: () => { checked = true; return !!input.title; } });
  const preparing = close.prepare(); assert.equal(checked, false); flush.resolve();
  assert.deepEqual(await preparing, { ready: false, reason: 'unsaved-input' });
  close.cancel(); assert.equal(resumes, 1); assert.equal(input.title, 'Typed but not submitted');
});
