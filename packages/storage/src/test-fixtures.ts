import type { DataPackage, HistoryCommit, HistoryValue } from '../../domain/src/index.ts';
import { yearDate } from '../../domain/src/index.ts';
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
