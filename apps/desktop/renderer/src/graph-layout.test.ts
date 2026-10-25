import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutHistoryGraph } from './graph-layout.ts';

const branch = (id: string) => ({ id });
const commit = (id: string, branchId: string, year: number, parents: string[] = []) => ({ id, branchId, year, parents });

test('same-year ancestry moves right and unrelated nodes in the same lane cannot overlap', () => {
  const commits = [commit('z-parent', 'main', 100), commit('a-child', 'main', 100, ['z-parent']), commit('b-independent', 'main', 100), commit('c-next', 'main', 101, ['a-child'])];
  const layout = layoutHistoryGraph(commits, [branch('main')]);
  const point = (id: string) => layout.positions.get(id)!;
  assert.ok(point('a-child').x - point('z-parent').x >= 136);
  const sameYear = commits.filter(c => c.year === 100).map(c => point(c.id).x).sort((a, b) => a - b);
  assert.equal(new Set(sameYear).size, 3);
  assert.ok(sameYear.slice(1).every((x, index) => x - sameYear[index] >= 136));
  assert.ok(point('c-next').x - Math.max(...sameYear) >= 136);
  assert.equal(layout.yearLabels.length, 2);
  assert.equal(layout.yearLabels[0].x, (sameYear[0] + sameYear.at(-1)!) / 2);
});

test('independent branches share a year column while same-year integrations follow every parent', () => {
  const nodes = [commit('left', 'west', -44), commit('right', 'east', -44), commit('merged', 'union', -44, ['left', 'right']), commit('later', 'union', 1, ['merged'])];
  const layout = layoutHistoryGraph(nodes, [branch('west'), branch('east'), branch('union')]);
  const point = (id: string) => layout.positions.get(id)!;
  assert.equal(point('left').x, point('right').x);
  assert.equal(point('right').y - point('left').y, 120);
  assert.ok(point('merged').x > point('left').x && point('merged').x > point('right').x);
  assert.deepEqual(layout.yearLabels.map(label => label.year), [-44, 1]);
  for (const p of layout.positions.values()) { assert.ok(p.x + 62 < layout.width); assert.ok(p.y + 90 < layout.height); }
});

test('commit order and parent order do not change positions or dimensions', () => {
  const nodes = [commit('b', 'second', 9), commit('a', 'first', 9), commit('d', 'second', 9, ['a', 'b']), commit('c', 'first', 9), commit('next', 'first', 10, ['c'])];
  const branches = [branch('first'), branch('second')];
  const expected = layoutHistoryGraph(nodes, branches);
  for (const reordered of [nodes.toReversed(), [...nodes.slice(2), ...nodes.slice(0, 2)], nodes.map(c => ({ ...c, parents: c.parents.toReversed() }))]) assert.deepEqual(layoutHistoryGraph(reordered, branches), expected);
});

test('filtered parents outside the view do not prevent layout and empty lanes remain usable', () => {
  const layout = layoutHistoryGraph([commit('visible', 'main', 200, ['outside-window'])], [branch('main'), branch('empty')]);
  assert.deepEqual(layout.positions.get('visible'), { x: 232, y: 76 });
  assert.equal(layout.lanes.get('empty'), 196);
  const empty = layoutHistoryGraph([], [branch('main')]);
  assert.equal(empty.positions.size, 0); assert.deepEqual(empty.yearLabels, []);
  assert.ok(empty.width >= 760 && empty.height >= 300);
});

test('an invalid same-year cycle fails instead of hanging the renderer', () => {
  assert.throws(() => layoutHistoryGraph([commit('one', 'main', 1, ['two']), commit('two', 'main', 1, ['one'])], [branch('main')]), /INVALID_GRAPH_LAYOUT/);
});
