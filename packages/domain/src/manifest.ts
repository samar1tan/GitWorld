import { canonicalJson, contentHash } from './canonical.ts';
import type { DataPackage } from './package.ts';
import type { HistorySnapshot } from './history-types.ts';
import { createHistoryEngine } from './history-engine.ts';

export type ContentObjectKind = 'scope' | 'process' | 'event' | 'place' | 'branch' | 'commit' | 'field' | 'source' | 'tag' | 'relationship';
export type ContentObject = { kind: ContentObjectKind; id: string; hash: string; canonical: string };
export type TreeObject = { commitId: string; hash: string; canonical: string };
export type ContentManifest = { schemaVersion: 1; datasetId: string; revisionId: string; contentHash: string; objects: ContentObject[]; trees: TreeObject[] };

/** Inherited flags and the selected revision/date are view context, not tree content. */
export function snapshotTree(snapshot: HistorySnapshot): { fields: Record<string, unknown>; removedFields: Record<string, unknown> } {
  const withoutInherited = (value: Record<string, unknown>) => { const { inherited: _inherited, ...record } = value; return record; };
  return { fields: Object.fromEntries(Object.entries(snapshot.fields).map(([id, value]) => [id, withoutInherited(value)])), removedFields: Object.fromEntries(Object.entries(snapshot.removedFields).map(([id, value]) => [id, withoutInherited(value)])) };
}

/** Object hashes support shared immutable storage; the package digest covers its complete metadata. */
export async function buildContentManifest(data: DataPackage): Promise<ContentManifest> {
  const groups: [ContentObjectKind, { id: string }[]][] = [['scope', data.catalog.scopes], ['process', data.catalog.processes], ['event', data.catalog.events], ['place', data.catalog.places], ['branch', data.history.branches], ['commit', data.history.commits], ['field', data.history.fields], ['source', Object.values(data.history.sources)], ['tag', data.history.tags ?? []], ['relationship', data.history.relationships ?? []]];
  const objects: ContentObject[] = [];
  for (const [kind, rows] of groups) for (const row of rows) objects.push({ kind, id: row.id, hash: await contentHash(row), canonical: canonicalJson(row) });
  objects.sort((a, b) => a.kind.localeCompare(b.kind, 'en') || a.id.localeCompare(b.id, 'en'));
  const engine = createHistoryEngine(data.history), trees: TreeObject[] = [];
  for (const commit of data.history.commits) {
    const state = engine.snapshot(commit.id); if (!state.ok) throw new TypeError('INVALID_GRAPH');
    const tree = snapshotTree(state.value); trees.push({ commitId: commit.id, hash: await contentHash(tree), canonical: canonicalJson(tree) });
  }
  return { schemaVersion: 1, datasetId: data.dataset.id, revisionId: data.revision.id, contentHash: await contentHash(data), objects, trees };
}
