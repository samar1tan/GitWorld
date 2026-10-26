import type { DatasetRef } from '@gitworld/domain';
import type { LegacyModelRead, ModelRead, WorkspaceState } from '@gitworld/contracts';

const explicit = (revision: string) => revision === 'working' || /^[a-f0-9]{40}$/.test(revision);
type Reader = { read(ref: DatasetRef): Promise<ModelRead>; resolveLegacy(ref: DatasetRef): Promise<LegacyModelRead> };

/** Resolve legacy identities once, while retaining every independently pinned endpoint. */
export async function loadModelWorkspace(target: DatasetRef, saved: WorkspaceState | null, reader: Reader) {
  const reads = new Map<string, Promise<ModelRead>>();
  const load = (ref: DatasetRef) => {
    const key = `${ref.datasetId}\0${ref.revisionId}`;
    let result = reads.get(key);
    if (!result) { result = explicit(ref.revisionId) ? reader.read(ref) : reader.resolveLegacy(ref); reads.set(key, result); }
    return result;
  };
  const loaded = await load(target), resolvedTarget = { datasetId: target.datasetId, revisionId: loaded.revision };
  if (loaded.datasetId !== target.datasetId || !explicit(loaded.revision)) throw new Error('REVISION_NOT_FOUND');
  let normalized = saved;
  if (saved?.dataset.datasetId === target.datasetId) {
    normalized = structuredClone(saved);
    const references = [normalized.dataset, normalized.head, ...normalized.comparison ?? []].filter((ref): ref is DatasetRef => ref !== null);
    for (const ref of references) {
      if (ref.datasetId !== target.datasetId) throw new Error('REVISION_NOT_FOUND');
      const result = await load(ref);
      if (result.datasetId !== ref.datasetId || !explicit(result.revision)) throw new Error('REVISION_NOT_FOUND');
      ref.revisionId = result.revision;
    }
  }
  return { target: resolvedTarget, loaded, saved: normalized, normalized: !!saved && JSON.stringify(saved) !== JSON.stringify(normalized), packages: await Promise.all(reads.values()) };
}
