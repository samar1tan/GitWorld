import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalJson, createHistoryEngine, executeCommand } from '@gitworld/domain';
import { starterPresentation } from '../../../../packages/service/src/model-presentation.ts';
import { rememberModelPresentation, displayModel } from './model-presentation.ts';
import { createWorkbench } from './workbench-ui.ts';
import { initialWorkspace } from './state.ts';
import { renderModelComparison } from './model-comparison.ts';

test('real graph, state and fixed-side diff render legacy Chinese without translating a user-edited revision', async () => {
  const reviewed = JSON.parse(await readFile(new URL('../../../../data/seed/early-medieval.json', import.meta.url), 'utf8'));
  const raw = JSON.parse(JSON.stringify(reviewed, (key, value) => key === 'zh-CN' ? undefined : value)); raw.revision.id = raw.history.id = 'early-medieval-2026-10-25.1';
  const unchanged = canonicalJson(raw), contentHash = createHash('sha256').update(unchanged).digest('hex'), presentation = starterPresentation(raw, reviewed, contentHash);
  const a = 'a'.repeat(40), b = 'b'.repeat(40); raw.revision.id = raw.history.id = a;
  rememberModelPresentation({ datasetId: raw.dataset.id, revision: a, head: b, path: 'models/test.json', contentHash, package: raw, presentation });
  const storage = new Map<string, string>(); globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key), clear: () => storage.clear(), key: () => null, get length() { return storage.size; } };
  let state = initialWorkspace(); state.locale = 'zh-CN'; state.view = { ...state.view, level: 'process', panel: 'history', scopeId: 'east-asia', processId: 'east-asian-courts', graphBranch: 'china/tang', selectedCommit: 'tang-ca700', timeWindow: [580, 800] };
  const engine = createHistoryEngine(raw.history), wb = createWorkbench({ package: raw, getState: () => state, update: next => { state = next; }, render: () => {}, onError: error => { throw error; }, query: async (command, context) => executeCommand(engine, command, context) });
  // Enter through the same command execution path used by a graph node.
  await wb.execute('git show tang-ca700'); assert.match(wb.content(), /约 700 年的长安/); assert.match(wb.inspector(), /约 700 年的长安/);
  await wb.execute('git checkout tang-ca700'); assert.match(wb.content(), /长安/); assert.doesNotMatch(canonicalJson(raw.history.commits.find(value => value.id === 'tang-ca700')), /约 700 年的长安/);
  const edited = structuredClone(raw); edited.revision.id = edited.history.id = b; edited.history.commits.find(value => value.id === 'tang-ca700').title.en = 'A user title';
  const diff = engine.diff('tang-ca700', 'tang-ca700'); assert.ok(diff.ok);
  const html = renderModelComparison({ diff: diff.value, a: { kind: 'model', modelId: raw.dataset.id, revision: a, ref: 'commit:tang-ca700' }, b: { kind: 'model', modelId: raw.dataset.id, revision: b, ref: 'commit:tang-ca700' }, before: raw, after: edited, commonBaseStatus: 'different-revisions' }, 'zh-CN');
  assert.match(html, /约 700 年的长安/); assert.match(html, /A user title/); assert.equal(displayModel(edited), edited);
  state.locale = 'en'; assert.match(wb.content(), /Chang/); assert.equal(raw.history.commits.find(value => value.id === 'tang-ca700').title['zh-CN'], undefined);
  wb.dispose();
});
