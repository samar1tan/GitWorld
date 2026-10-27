import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cases, defaultCaseId, getExample, initialSelection, commandsForExample, examples } from './examples.mjs';
import { createInvestigation } from './investigation.mjs';
import { english, chinese } from './locales.mjs';
import { createHistoryEngine, executeIntent } from '../packages/domain/src/index.ts';
import { parseWorkbenchCommand } from '../packages/service/src/workbench-commands.ts';

const model = JSON.parse(await readFile(new URL('../data/seed/early-medieval.json', import.meta.url), 'utf8'));
const engine = createHistoryEngine(model.history), investigation = createInvestigation(model.history);
const commits = new Map(model.history.commits.map(commit => [commit.id, commit]));
const revision = 'a'.repeat(40);
const isAncestor = (ancestor, id) => commits.get(id).parents.some(parent => parent === ancestor || isAncestor(ancestor, parent));

test('all three cases share facts, graph identities and complete presentation keys across languages', () => {
  assert.equal(examples.en, examples['zh-CN']);
  assert.deepEqual(cases.map(item => item.id), ['frankish-partition', 'china-japan', 'abbasid-court']);
  assert.deepEqual(Object.keys(english).sort(), Object.keys(chinese).sort());
  for (const copy of [english, chinese]) for (const example of cases) {
    for (const key of [example.labelKey, example.themeKey, example.titleKey, example.yearsKey, example.insightKey, example.descriptionKey, example.noteKey, ...example.operationKeys, ...example.bodyKeys, ...example.nodes.map(node => node.labelKey), ...example.labels.map(label => label.key)]) assert.ok(copy[key], key);
    for (const node of example.nodes) if (node.yearKey) assert.ok(copy[node.yearKey]);
  }
  assert.equal(getExample('unrecognized-case').id, defaultCaseId);
  assert.equal(getExample('__proto__').id, defaultCaseId);
  assert.deepEqual(initialSelection(undefined), {caseId: 'china-japan', selected: 'japan-710', a: 'tang-ca700', b: 'japan-710'});
});

test('graphs and record selection use actual model ancestry, dates, influence and translated values', () => {
  for (const example of cases) {
    for (const node of example.nodes) {
      assert.ok(commits.has(node.id), node.id);
      const {commit, snapshot} = investigation.record(example, node.id);
      assert.equal(snapshot.commitId, node.id);
      if (node.year !== undefined) assert.equal(commit.date.earliestYear, node.year);
      for (const fieldId of example.fieldIds) {
        assert.ok(investigation.field(fieldId).name['zh-CN']);
        const value = snapshot.fields[fieldId];
        if (value) { assert.ok(value.label.en); assert.ok(value.label['zh-CN']); }
      }
    }
    for (const edge of example.edges) {
      assert.ok(example.nodes.some(node => node.id === edge.from));
      assert.ok(example.nodes.some(node => node.id === edge.to));
      if (edge.kind === 'influence') assert.ok(model.history.relationships.some(link => link.kind === 'influence' && link.fromCommitId === edge.from && link.toCommitId === edge.to));
      else if (edge.condensed) { assert.ok(isAncestor(edge.from, edge.to)); assert.ok(!commits.get(edge.to).parents.includes(edge.from)); }
      else assert.ok(commits.get(edge.to).parents.includes(edge.from), edge.from + ' -> ' + edge.to);
    }
  }
  const japanese = getExample('china-japan').nodes.filter(node => commits.get(node.id).branchId === 'japan/main').map(node => node.id);
  assert.deepEqual(new Set(japanese), new Set(model.history.branches.find(branch => branch.id === 'japan/main').commitIds));
  assert.equal(commits.get('tang-ca700').date.precision, 'approximate');
  assert.throws(() => investigation.record(getExample('abbasid-court'), 'japan-710'), /RECORD_OUTSIDE_CASE/);
});

test('Frankish siblings preserve a common modeled past and their actual differences', () => {
  const example = getExample('frankish-partition'), diff = investigation.compare(example, example.initial.a, example.initial.b);
  assert.deepEqual(diff.commonBaseIds, ['francia-840']);
  assert.equal(diff.rows.find(row => row.fieldId === 'politics.ruler').kind, 'changed');
  assert.equal(diff.rows.find(row => row.fieldId === 'politics.form').kind, 'same');
  assert.equal(diff.rows.find(row => row.fieldId === 'territory.extent').kind, 'changed');
});

test('China and Japan compare independent paths and keep planning influence out of ancestry', () => {
  const example = getExample('china-japan'), diff = investigation.compare(example, example.initial.a, example.initial.b);
  assert.deepEqual(diff.commonBaseIds, []);
  const planning = diff.rows.find(row => row.fieldId === 'culture.planning');
  assert.equal(planning.kind, 'changed'); assert.equal(planning.before.key, 'changan-walled-grid'); assert.equal(planning.after.key, 'nara-grid');
});

test('returning to Baghdad keeps intervening history and does not equate an unknown residence', () => {
  const example = getExample('abbasid-court'), diff = investigation.compare(example, example.initial.a, example.initial.b);
  assert.equal(diff.rows.find(row => row.fieldId === 'politics.capital').kind, 'same');
  assert.equal(diff.rows.find(row => row.fieldId === 'politics.condition').kind, 'changed');
  assert.deepEqual(diff.commonBaseIds, ['abbasid-762']);
  assert.ok(engine.log('abbasid/main').value.commits.some(commit => commit.id === 'abbasid-836'));
  assert.deepEqual(commits.get('abbasid-892').parents, ['abbasid-836']);
  assert.equal(investigation.compare(example, 'abbasid-750', 'abbasid-762').rows.find(row => row.fieldId === 'politics.capital').kind, 'unknown');
});

test('every selectable record and pair produces commands that execute against the shipped grammar and model', () => {
  for (const example of cases) for (const selected of example.nodes) {
    const selection = {...example.initial, selected:selected.id};
    const templates = commandsForExample(example, selection);
    const outputs = {};
    for (const [operation, template] of Object.entries(templates)) {
      const parsed = parseWorkbenchCommand(template.replaceAll('<commit-oid>', revision));
      assert.ok('intent' in parsed, JSON.stringify(parsed));
      assert.equal(parsed.intent.family, 'history'); assert.equal(parsed.intent.target.kind, 'model');
      assert.equal(parsed.intent.target.modelId, model.dataset.id); assert.equal(parsed.intent.target.revision, revision);
      const result = executeIntent(engine, parsed.intent.intent, parsed.intent.context);
      assert.ok(result.ok, JSON.stringify(result)); outputs[operation] = result.output;
    }
    assert.equal(outputs.checkout.snapshot.commitId, selected.id);
    assert.equal(outputs.compare.diff.a.commitId, selection.a);
    assert.equal(outputs.compare.diff.b.commitId, selection.b);
  }
  for (const example of cases) for (const a of example.nodes) for (const b of example.nodes) {
    const template = commandsForExample(example, {...example.initial,a:a.id,b:b.id}).compare;
    const parsed = parseWorkbenchCommand(template.replaceAll('<commit-oid>', revision));
    const result = executeIntent(engine, parsed.intent.intent, parsed.intent.context);
    assert.ok(result.ok); assert.equal(result.output.diff.a.commitId, a.id); assert.equal(result.output.diff.b.commitId, b.id);
  }
});
