import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, completeCommand, contentHash, createHistoryEngine, executeCommand, localizedText, nextYear, parseYear, validateDataPackage, yearDate } from './index.ts';
import type { DataPackage, HistoryCommit, HistoryValue } from './index.ts';

const evidence = [{ sourceId: 'source', locator: 'Test assertion 1' }];
const value = (key: string): HistoryValue => ({ key, label: { en: key }, status: 'known', sourceIds: ['source'], evidence });
const commit = (id: string, year: number, parents: string[], branchId = 'realm/main'): HistoryCommit => ({ id, branchId, year, date: yearDate(year), title: { en: id }, summary: { en: id }, kind: parents.length ? 'change' : 'baseline', parents, lineage: parents.map(parentId => ({ parentId, kind: 'continuation', evidence })), changes: { capital: value(id) }, sourceIds: ['source'], evidence });
export function validPackage(): DataPackage {
  return {
    schemaVersion: 1,
    dataset: { id: 'test-world', name: { en: 'Test world' }, description: { en: 'Synthetic test data' }, license: 'CC0-1.0' },
    revision: { id: 'revision-1', parentRevisionId: null, createdAt: '2026-10-25T00:00:00.000Z', notes: { en: 'First test revision' } },
    catalog: {
      scopes: [{ id: 'region', parentId: null, name: { en: 'Region' }, summary: { en: 'Region' }, coverage: [-100, 100], sourceIds: ['source'] }],
      processes: [{ id: 'courts', name: { en: 'Courts' }, summary: { en: 'Courts' }, scopeIds: ['region'], coverage: [-100, 100], branchIds: ['realm/main'], eventIds: [], sourceIds: ['source'] }],
      events: [], places: [], defaults: { scopeId: null, timeWindow: [-100, 100], worldView: { x: 0, y: 0, width: 1000, height: 500 } },
    },
    history: { id: 'revision-1', datasetId: 'test-world', branches: [{ id: 'realm/main', name: { en: 'Realm' }, description: { en: 'Realm' }, scopeId: 'region', processId: 'courts', coverage: [-100, 100], commitIds: ['old', 'new'] }], commits: [commit('old', -100, []), commit('new', 100, ['old'])], fields: [{ id: 'capital', name: { en: 'Capital' }, group: 'politics' }], sources: { source: { id: 'source', title: 'Synthetic', publisher: 'Tests', language: 'en', url: 'https://example.invalid/source', rights: { status: 'approved', license: 'CC0-1.0', basis: 'Synthetic assertions', redistribution: 'citation-only', reviewedBy: 'Test reviewer', reviewedAt: '2026-10-25T00:00:00.000Z' } } }, tags: [{ id: 'start', name: { en: 'Start' }, commitId: 'old' }], relationships: [] },
  };
}

test('runtime package accepts an unrelated BCE scope without translations or fixture IDs', () => {
  const p = validPackage();
  const result = validateDataPackage(p, 'publish');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(localizedText({ en: 'Evidence' }, 'zh-CN'), { text: 'Evidence', language: 'en', fallback: true });
  if (result.ok) result.value.history.commits[0].title.en = 'changed';
  assert.equal(p.history.commits[0].title.en, 'old');
});

test('historical years reject zero and uncertain as-of queries never invent a midpoint', () => {
  assert.equal(parseYear('BCE:44'), -44); assert.equal(parseYear('0'), null); assert.equal(parseYear('BCE:0'), null); assert.equal(nextYear(-1), 1);
  const p = validPackage();
  p.history.commits[1].date = { earliestYear: 80, latestYear: 100, precision: 'interval', calendar: 'proleptic-gregorian' };
  const e = createHistoryEngine(p.history);
  assert.equal(e.resolve('realm/main@90').ok, false);
  const uncertain = e.resolve('realm/main@90'); if (!uncertain.ok) assert.equal(uncertain.error.code, 'DATE_UNCERTAIN');
  const before = e.resolve('realm/main@BCE:50'); assert.ok(before.ok && before.value.commitId === 'old' && before.value.recordedYear === -100);
  assert.ok(completeCommand(e, 'git show realm/main@BCE:', { head: null }).some(x => x.value.includes('BCE:100')));
});

test('tag refs resolve stable commits and influence does not alter ancestry or inheritance', () => {
  const p = validPackage();
  p.history.relationships!.push({ id: 'link', kind: 'influence', fromCommitId: 'new', toCommitId: 'old', fieldIds: ['capital'], summary: { en: 'A synthetic link' }, evidence });
  const e = createHistoryEngine(p.history);
  const tagged = e.resolve('tag:start'); assert.ok(tagged.ok && tagged.value.commitId === 'old');
  const trace = executeCommand(e, 'git trace tag:start', { head: 'new' });
  assert.ok(trace.ok && trace.output.kind === 'trace' && trace.output.relationships.length === 1);
  assert.deepEqual(e.commonBases('old', 'new'), ['old']);
  const snapshot = e.snapshot('old'); assert.ok(snapshot.ok && snapshot.value.fields.capital.key === 'old');
});

test('three-dot comparison is asymmetric and two-dot compares the actual endpoints', () => {
  const p = validPackage();
  p.history.branches.push({ ...p.history.branches[0], id: 'realm/side', commitIds: ['side'] });
  p.history.commits.push(commit('side', 90, ['old'], 'realm/side'));
  const e = createHistoryEngine(p.history);
  const result = executeCommand(e, 'git diff new...side', { head: 'new', comparison: ['new', 'side'] });
  assert.ok(result.ok && result.output.kind === 'diff' && result.output.diff.a.commitId === 'old' && result.output.diff.b.commitId === 'side');
  const endpoints = executeCommand(e, 'git diff new..side', { head: null });
  assert.ok(endpoints.ok && endpoints.output.kind === 'diff' && endpoints.output.diff.a.commitId === 'new');
});

test('publication checks evidence and rights independently of draft structure', () => {
  const p = validPackage();
  p.history.sources.source.rights!.status = 'unreviewed';
  p.history.commits[0].changes.capital!.evidence = [];
  assert.equal(validateDataPackage(p, 'draft').ok, true);
  const result = validateDataPackage(p, 'publish');
  assert.ok(!result.ok && result.issues.some(x => x.code === 'RIGHTS_UNREVIEWED') && result.issues.some(x => x.code === 'MISSING_EVIDENCE'));
  p.history.sources.source.rights!.status = 'approved';
  p.history.sources.source.content = 'Restricted body';
  const restricted = validateDataPackage(p, 'publish');
  assert.ok(!restricted.ok && restricted.issues.some(x => x.code === 'REDISTRIBUTION_DENIED'));
});

test('bad shape, non-JSON values, revision mismatches and missing scope links fail closed', () => {
  for (const input of [null, {}, { schemaVersion: 999 }, { schemaVersion: 1, dataset: null }, JSON.parse('{"__proto__":{}}')]) assert.equal(validateDataPackage(input).ok, false);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.equal(validateDataPackage(cycle).ok, false);
  const p = validPackage(); p.history.id = 'other'; p.history.branches[0].scopeId = 'missing';
  const result = validateDataPackage(p);
  assert.ok(!result.ok && result.issues.some(x => x.code === 'REVISION_MISMATCH') && result.issues.some(x => x.code === 'DANGLING_REFERENCE'));
});

test('integration requires an explicit ledger and retained values must match selected parents', () => {
  const p = validPackage();
  const base = p.history.commits[0];
  p.history.commits.splice(1, 0, commit('side', 90, [base.id]));
  p.history.branches[0].commitIds.splice(1, 0, 'side');
  const merged = p.history.commits.at(-1)!;
  merged.parents = ['old', 'side']; merged.kind = 'integration';
  merged.lineage = merged.parents.map(parentId => ({ parentId, kind: 'integration', evidence }));
  assert.equal(validateDataPackage(p).ok, false);
  merged.integration = { resolutions: { capital: { strategy: 'retain', parentIds: ['side'], evidence } } };
  assert.equal(validateDataPackage(p).ok, false);
  merged.changes.capital = value('side');
  assert.equal(validateDataPackage(p, 'publish').ok, true);
  merged.changes.capital = { status: 'not-applicable', key: null, label: { en: 'Not applicable' }, sourceIds: [], evidence: [], note: { en: 'The integrated subject has no applicable capital field in this model.' } };
  assert.equal(validateDataPackage(p, 'publish').ok, false);
  merged.integration.resolutions.capital.strategy = 'not-applicable';
  assert.equal(validateDataPackage(p, 'publish').ok, true);
  merged.changes.capital = value('side');
  assert.equal(validateDataPackage(p, 'publish').ok, false);
});

test('canonical hashes ignore object key insertion order but retain value changes', async () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(await contentHash({ a: 1, b: 2 }), await contentHash({ b: 2, a: 1 }));
  assert.notEqual(await contentHash({ a: 1 }), await contentHash({ a: 2 }));
});

test('text values use JavaScript strings and a stable key cannot disguise changed typed data', () => {
  const p = validPackage(); p.history.fields[0].valueType = 'text';
  for (const c of p.history.commits) c.changes.capital!.value = c.id;
  assert.equal(validateDataPackage(p, 'publish').ok, true);
  p.history.commits[1].changes.capital!.value = 42;
  assert.equal(validateDataPackage(p).ok, false);
  p.history.commits[1].changes.capital!.value = 'different';
  p.history.commits[1].changes.capital!.key = 'old';
  assert.equal(validateDataPackage(p).ok, false);
});

test('inapplicability is explicit and cannot be confused with a known value or historical absence', () => {
  const p = validPackage(); p.history.commits[1].changes.capital = { status: 'not-applicable', key: null, label: { en: 'Not applicable' }, sourceIds: [], evidence: [], note: { en: 'This model does not apply the capital field to this subject.' } };
  assert.equal(validateDataPackage(p, 'publish').ok, true);
  const diff = createHistoryEngine(p.history).diff('old', 'new'); assert.ok(diff.ok && diff.value.rows[0].kind === 'unknown' && diff.value.rows[0].after?.status === 'not-applicable');
  delete p.history.commits[1].changes.capital.note; assert.equal(validateDataPackage(p).ok, false);
});
