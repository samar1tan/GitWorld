import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { examples } from './examples.mjs';
import { english, chinese } from './locales.mjs';
import { createHistoryEngine, executeIntent } from '../packages/domain/src/index.ts';
import { parseWorkbenchCommand } from '../packages/service/src/workbench-commands.ts';

const model = JSON.parse(await readFile(new URL('../data/seed/early-medieval.json', import.meta.url), 'utf8'));
const engine = createHistoryEngine(model.history);
const commits = new Map(model.history.commits.map(commit => [commit.id, commit]));
const revision = 'a'.repeat(40);
test('language selection preserves case facts, commands, evidence and complete graph labels', () => {
  assert.deepEqual(examples.en, examples['zh-CN']);
  assert.deepEqual(examples.en.nodes.map(node => node.year ?? node.yearKey), ['approx700', 710, 740, 744, 745, 784, 794]);
  for (const copy of [english, chinese]) {
    for (const label of examples.en.labels) assert.ok(copy[label.key], label.key);
    assert.ok(copy.approx700);
  }
});
const isAncestor = (ancestor, id) => commits.get(id).parents.some(parent => parent === ancestor || isAncestor(ancestor, parent));

test('website example edges retain actual lineage and influence semantics from the shipped model', () => {
  for (const example of Object.values(examples)) {
    for (const node of example.nodes) assert.ok(commits.has(node.id), node.id);
    for (const edge of example.edges) {
      if (edge.kind === 'influence') assert.ok(model.history.relationships.some(link => link.kind === 'influence' && link.fromCommitId === edge.from && link.toCommitId === edge.to));
      else if (edge.condensed) assert.ok(isAncestor(edge.from, edge.to));
      else assert.ok(commits.get(edge.to).parents.includes(edge.from), `${edge.from} -> ${edge.to}`);
    }
  }
  const japanese = examples['zh-CN'].nodes.filter(node => commits.get(node.id).branchId === 'japan/main').map(node => node.id);
  assert.deepEqual(new Set(japanese), new Set(model.history.branches.find(branch => branch.id === 'japan/main').commitIds));
  assert.equal(commits.get('tang-ca700').date.precision, 'approximate');
});

test('both locale command examples route through the real history grammar and model', () => {
  const outcomes = {};
  for (const [locale, example] of Object.entries(examples)) {
    outcomes[locale] = {};
    for (const [operation, template] of Object.entries(example.commands)) {
      const parsed = parseWorkbenchCommand(template.replaceAll('<commit-oid>', revision));
      assert.ok('intent' in parsed, JSON.stringify(parsed));
      assert.equal(parsed.intent.family, 'history'); assert.equal(parsed.intent.target.kind, 'model');
      assert.equal(parsed.intent.target.modelId, model.dataset.id); assert.equal(parsed.intent.target.revision, revision);
      const result = executeIntent(engine, parsed.intent.intent, parsed.intent.context);
      assert.ok(result.ok, JSON.stringify(result)); outcomes[locale][operation] = result.output;
    }
  }
  assert.equal(outcomes['zh-CN'].checkout.snapshot.commitId, 'japan-710');
  assert.deepEqual(outcomes.en, outcomes['zh-CN']);
  const comparison = outcomes['zh-CN'].compare.diff;
  assert.equal(comparison.a.commitId, 'tang-ca700'); assert.equal(comparison.b.commitId, 'japan-710');
  assert.deepEqual(comparison.commonBaseIds, []);
  const planning = comparison.rows.find(row => row.fieldId === 'culture.planning');
  assert.equal(planning.kind, 'changed'); assert.equal(planning.before.key, 'changan-walled-grid'); assert.equal(planning.after.key, 'nara-grid');
});
