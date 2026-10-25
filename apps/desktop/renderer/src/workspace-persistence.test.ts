import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkspaceState } from '@gitworld/contracts';
import { createWorkspacePersistence, createWorkspaceTransitions } from './workspace-persistence.ts';

function snapshot(revision = 'release-one', head = 'state-one'): WorkspaceState {
  const dataset = { datasetId: 'world', revisionId: revision };
  return { id: 'primary', version: 0, dataset, locale: 'en', head: { ...dataset, commitId: head, requestedYear: 50 }, comparison: [{ ...dataset, commitId: 'left', requestedYear: null }, { ...dataset, commitId: 'right', requestedYear: null }], view: { panel: 'compare', scopeId: 'scope', processId: null, eventId: null, selectedCommitId: head, graphRef: null, timeWindow: [1, 100], cursor: 50, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function controlled() {
  const calls: { workspace: WorkspaceState; expectedVersion: number | null; result: ReturnType<typeof deferred<WorkspaceState>> }[] = [];
  const writer = createWorkspacePersistence(input => { const result = deferred<WorkspaceState>(); calls.push({ ...input, result }); return result.promise; });
  return { writer, calls, complete(index: number) { const call = calls[index]; call.result.resolve({ ...call.workspace, version: (call.expectedVersion ?? 0) + 1 }); } };
}

test('coalesced saves are immutable and every caller awaits the final pending snapshot', async () => {
  const { writer, calls, complete } = controlled(); writer.bind(4);
  const initial = snapshot(); const first = writer.save(initial);
  initial.head!.commitId = 'mutated-after-queue';
  const obsolete = writer.save(snapshot('release-one', 'second'));
  const latest = snapshot('release-one', 'third'); const final = writer.save(latest);
  latest.comparison![0].commitId = 'mutated-after-queue';
  let finished = false; void final.then(() => { finished = true; });
  complete(0); await Promise.resolve();
  assert.equal(finished, false); assert.equal(calls.length, 2);
  assert.equal(calls[0].workspace.head!.commitId, 'state-one');
  assert.equal(calls[1].workspace.head!.commitId, 'third');
  assert.equal(calls[1].workspace.comparison![0].commitId, 'left');
  assert.equal(calls[1].expectedVersion, 5); assert.equal(calls[1].workspace.version, 5);
  complete(1); await Promise.all([first, obsolete, final]);
  assert.equal(writer.version, 6); assert.equal(writer.status, 'idle');
});

test('release switching drains old writes before binding the next version', async () => {
  const { writer, calls, complete } = controlled(); writer.bind(10);
  const saving = writer.save(snapshot('old-release'));
  const draining = writer.pause(); let drained = false; void draining.then(() => { drained = true; });
  assert.throws(() => writer.bind(20), /WORKSPACE_WRITES_PENDING/);
  await assert.rejects(writer.save(snapshot('stale-event')), /WORKSPACE_SUSPENDED/);
  assert.equal(drained, false); complete(0); await Promise.all([saving, draining]);
  writer.bind(11); const fresh = writer.save(snapshot('new-release', 'new-head'));
  assert.equal(calls[1].expectedVersion, 11); assert.equal(calls[1].workspace.dataset.revisionId, 'new-release');
  complete(1); await fresh; assert.equal(writer.version, 12); assert.equal(calls.length, 2);
});

test('manager publication preserves the saved pin and restoration cannot replay pre-restore state', async () => {
  const { writer, calls, complete } = controlled(); writer.bind(30);
  const saving = writer.save(snapshot('pinned-release', 'fixed-head'));
  const enterManager = writer.pause(); complete(0); await Promise.all([saving, enterManager]);
  const pin = structuredClone(calls[0].workspace);
  await assert.rejects(writer.save(snapshot('newly-published-default')), /WORKSPACE_SUSPENDED/);
  assert.equal(calls.length, 1); assert.equal(pin.dataset.revisionId, 'pinned-release'); assert.equal(pin.head!.commitId, 'fixed-head');
  // Restore has replaced the DB while the workbench is suspended. Only the newly
  // loaded workspace may bind its (possibly lower) concurrency version.
  const restored = snapshot('restored-release', 'restored-head');
  writer.bind(2); const next = writer.save(restored);
  assert.equal(calls[1].expectedVersion, 2); assert.deepEqual(calls[1].workspace.comparison, restored.comparison);
  assert.equal(calls[1].workspace.head!.commitId, 'restored-head'); complete(1); await next;
  assert.equal(calls.length, 2);
});

test('a save failure blocks rebinding and keeps the latest unsaved state for retry', async () => {
  const { writer, calls, complete } = controlled(); writer.bind(7);
  const first = writer.save(snapshot('release-one', 'first'));
  const last = writer.save(snapshot('release-one', 'last'));
  const failures = Promise.all([assert.rejects(first, /disk failure/), assert.rejects(last, /disk failure/)]);
  calls[0].result.reject(new Error('disk failure')); await failures;
  assert.equal(writer.status, 'failed'); assert.equal(writer.version, 7);
  assert.throws(() => writer.bind(99), /WORKSPACE_WRITES_PENDING/);
  const retry = writer.pause(); assert.equal(calls[1].workspace.head!.commitId, 'last'); assert.equal(calls[1].expectedVersion, 7);
  complete(1); await retry; writer.bind(8); assert.equal(writer.status, 'idle');
});

test('overlapping loads cannot commit an older release after a newer selection', async () => {
  const transitions = createWorkspaceTransitions();
  const oldLoad = deferred<WorkspaceState>(), newLoad = deferred<WorkspaceState>();
  let visible: WorkspaceState | null = null;
  const load = async (result: Promise<WorkspaceState>) => { const token = transitions.begin(); const next = await result; if (transitions.current(token)) visible = next; };
  const first = load(oldLoad.promise), second = load(newLoad.promise);
  newLoad.resolve(snapshot('new-release')); await second;
  oldLoad.resolve(snapshot('old-release')); await first;
  assert.equal((visible as WorkspaceState | null)?.dataset.revisionId, 'new-release');
});

test('a fresh first-open pin is durable before a manager can change the active release', async () => {
  const { writer, calls, complete } = controlled(); writer.bind(null);
  let managerEntered = false;
  const firstPin = writer.save(snapshot('original-active'));
  const enter = writer.pause().then(() => { managerEntered = true; });
  await Promise.resolve(); assert.equal(managerEntered, false); assert.equal(calls[0].expectedVersion, null);
  complete(0); await Promise.all([firstPin, enter]);
  assert.equal(managerEntered, true); assert.equal(writer.version, 1);
  assert.equal(calls[0].workspace.dataset.revisionId, 'original-active');
});
