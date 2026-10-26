import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalJson, createHistoryEngine } from '../../domain/src/index.ts';
import type { DataPackage } from '../../domain/src/package.ts';
import { starterPresentation } from './model-presentation.ts';

const reviewed: DataPackage = JSON.parse(await readFile(new URL('../../../data/seed/early-medieval.json', import.meta.url), 'utf8'));
function legacy(): DataPackage {
  // Synthetic earlier presentation, not a recovered original .1 distribution.
  const data = JSON.parse(JSON.stringify(reviewed, (key, value) => key === 'zh-CN' ? undefined : value));
  data.revision.id = data.history.id = 'early-medieval-2026-10-25.1'; return data;
}
const hash = (data: DataPackage) => createHash('sha256').update(canonicalJson(data)).digest('hex');
test('missing starter Chinese is separate from canonical bytes and engine output', () => {
  const data = legacy(), before = canonicalJson(data), engine = createHistoryEngine(data.history);
  const result = starterPresentation(data, reviewed, hash(data));
  assert.ok(result?.zhCN.length); assert.equal(result.contentHash, hash(data));
  const index = data.history.commits.findIndex(value => value.id === 'tang-ca700');
  assert.ok(result.zhCN.some(value => value.path.join('/') === `history/commits/${index}/title` && value.text === '约 700 年的长安'));
  assert.equal(canonicalJson(data), before); assert.deepEqual(createHistoryEngine(data.history).snapshot('tang-ca700'), engine.snapshot('tang-ca700'));
});
test('user semantic edits, existing translations, identities and citation changes are never overwritten', () => {
  const data = legacy(), index = data.history.commits.findIndex(value => value.id === 'tang-ca700');
  data.history.commits[index].summary = { en: 'A user interpretation' };
  const another = data.history.commits.findIndex(value => value.id !== 'tang-ca700'); data.history.commits[another].title['zh-CN'] = '用户的中文标题';
  const result = starterPresentation(data, reviewed, hash(data)); assert.ok(result);
  assert.ok(!result.zhCN.some(value => value.path.slice(0, 3).join('/') === `history/commits/${index}`));
  assert.ok(!result.zhCN.some(value => value.path.join('/') === `history/commits/${another}/title`));
  const changedSource = legacy(), sourceId = changedSource.history.commits[index].sourceIds[0]; changedSource.history.sources[sourceId].title += ' — user annotation';
  assert.ok(!starterPresentation(changedSource, reviewed, hash(changedSource))?.zhCN.some(value => value.path.slice(0, 3).join('/') === `history/commits/${index}`));
  const unrelated = legacy(); unrelated.dataset.id = unrelated.history.datasetId = 'user-authored-copy'; assert.equal(starterPresentation(unrelated, reviewed, hash(unrelated)), undefined);
  const newer = legacy(); newer.revision.id = newer.history.id = 'user-revision'; assert.equal(starterPresentation(newer, reviewed, hash(newer)), undefined);
});
