import { createHistoryEngine } from '../packages/domain/src/history-engine.ts';

// The read-only website and desktop use the same snapshot and comparison rules.
export function createInvestigation(history) {
  const engine = createHistoryEngine(history);
  const commits = new Map(history.commits.map(commit => [commit.id, commit]));
  const fields = new Map(history.fields.map(field => [field.id, field]));
  function requireNode(example, id) {
    if (!example.nodes.some(node => node.id === id)) throw new Error('RECORD_OUTSIDE_CASE');
    const commit = commits.get(id), result = engine.snapshot(id);
    if (!commit || !result.ok) throw new Error('INVALID_CASE_RECORD');
    return { commit, snapshot: result.value };
  }
  return {
    record: requireNode,
    compare(example, a, b) {
      requireNode(example, a); requireNode(example, b);
      const result = engine.diff('commit:' + a, 'commit:' + b);
      if (!result.ok) throw new Error('INVALID_CASE_COMPARISON');
      return { ...result.value, rows: result.value.rows.filter(row => example.fieldIds.includes(row.fieldId)) };
    },
    field: id => fields.get(id),
    source: id => history.sources[id],
  };
}
