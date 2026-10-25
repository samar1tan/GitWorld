import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServiceRequest, validateWorkspace } from './index.ts';
import type { WorkspaceState } from './index.ts';

const workspace = (): WorkspaceState => ({ id: 'workspace', version: 0, dataset: { datasetId: 'world', revisionId: 'r1' }, locale: 'en', head: { datasetId: 'world', revisionId: 'r1', commitId: 'old', requestedYear: null }, comparison: null, view: { panel: 'browse', scopeId: null, processId: null, eventId: null, selectedCommitId: null, graphRef: null, timeWindow: [-100, 100], cursor: null, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] });
const request = (method: string, params: unknown) => ({ protocolVersion: 1, requestId: 'request-1', method, params });

test('IPC rejects arbitrary operations, paths, extra top-level keys and invalid protocol', () => {
  for (const value of [request('shell.exec', { command: 'pwd' }), request('backup.create', { path: '/tmp/x', operationId: 'op' }), { ...request('library.status', {}), protocolVersion: 2 }, { ...request('library.status', {}), channel: 'exec' }, request('draft.create', { package: { schemaVersion: 1 }, baseRevision: null, operationId: 'op' })]) assert.equal(validateServiceRequest(value).ok, false);
  assert.equal(validateServiceRequest(request('backup.create', { fileToken: 'selection-1', operationId: 'op' })).ok, true);
});

test('typed intent and command envelopes share explicit dataset and context boundaries', () => {
  const common = { dataset: { datasetId: 'world', revisionId: 'r1' }, context: { head: null } };
  assert.equal(validateServiceRequest(request('query.execute', { ...common, input: { command: 'git show tag:start' } })).ok, true);
  assert.equal(validateServiceRequest(request('query.execute', { ...common, input: { intent: { type: 'show', ref: 'tag:start' } } })).ok, true);
  assert.equal(validateServiceRequest(request('query.execute', { ...common, input: { intent: { type: 'checkout', ref: 42 } } })).ok, false);
  assert.equal(validateServiceRequest(request('query.execute', { ...common, context: { head: null, currentYear: 0 }, input: { command: 'help' } })).ok, false);
});

test('workspace refs cannot drift across revisions or contain historical year zero', () => {
  assert.equal(validateWorkspace(workspace()).ok, true);
  const w = workspace(); w.head!.revisionId = 'r2';
  const result = validateWorkspace(w); assert.ok(!result.ok && result.issues.some(x => x.code === 'REVISION_MISMATCH'));
  w.head!.revisionId = 'r1'; w.view.cursor = 0;
  assert.equal(validateWorkspace(w).ok, false);
});
