import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModelWorkspace } from './model-loading.ts';
import { validPackage } from '../../../../packages/storage/src/test-fixtures.ts';
import type { ModelRead, WorkspaceState } from '@gitworld/contracts';

const a = 'a'.repeat(40), b = 'b'.repeat(40);
const read = (revision: string): ModelRead => ({ datasetId: 'test-world', revision, head: b, path: 'models/test.json', contentHash: 'c'.repeat(64), package: validPackage() });
const workspace = (): WorkspaceState => ({ id: 'primary', version: 2, dataset: { datasetId: 'test-world', revisionId: 'revision-1' }, locale: 'zh-CN', head: { datasetId: 'test-world', revisionId: 'revision-1', commitId: 'old', requestedYear: -100 }, comparison: [{ datasetId: 'test-world', revisionId: a, commitId: 'old', requestedYear: -100 }, { datasetId: 'test-world', revisionId: b, commitId: 'new', requestedYear: 100 }], view: { panel: 'history', scopeId: 'region', processId: 'courts', eventId: null, selectedCommitId: 'new', graphRef: null, timeWindow: [-100, 100], cursor: 100, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] });
test('legacy loading normalizes only legacy bases and retains independent A/B OIDs and browse state', async () => {
  const original = workspace(), calls: string[] = [];
  const result = await loadModelWorkspace(original.dataset, original, { read: async ref => { calls.push(ref.revisionId); return read(ref.revisionId); }, resolveLegacy: async ref => { calls.push(ref.revisionId); return { ...read(a), legacyAuthoredRevisionId: ref.revisionId }; } });
  assert.equal(result.target.revisionId, a); assert.equal(result.saved!.head!.revisionId, a); assert.deepEqual(result.saved!.comparison, original.comparison);
  assert.deepEqual(result.saved!.view, original.view); assert.equal(original.dataset.revisionId, 'revision-1'); assert.equal(result.normalized, true);
  assert.equal(calls.filter(value => value === 'revision-1').length, 1);
  const again = await loadModelWorkspace(result.target, result.saved, { read: async ref => read(ref.revisionId), resolveLegacy: async () => { throw new Error('Legacy path was not expected on restart'); } }); assert.equal(again.normalized, false);
});
test('an unavailable exact legacy basis rejects rather than reopening current HEAD', async () => {
  let explicitReads = 0;
  await assert.rejects(loadModelWorkspace(workspace().dataset, workspace(), { read: async () => { explicitReads++; return read(b); }, resolveLegacy: async () => { throw new Error('REVISION_NOT_FOUND'); } }), /REVISION_NOT_FOUND/);
  assert.equal(explicitReads, 0);
});
