import { createHash } from 'node:crypto';
import type { EditorialJson, EditorialRepository, EditorialSnapshot } from '../../contracts/src/editorial-types.ts';
import type { RepositoryDiffReferenceLabels } from '../../contracts/src/index.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';

const object = (value: unknown): value is Record<string, EditorialJson> => !!value && typeof value === 'object' && !Array.isArray(value);
const key = (value: EditorialJson | undefined) => value === undefined ? 'undefined' : canonicalJson(value);
const objectPath = (id: string) => `objects/${createHash('sha256').update(canonicalJson(id)).digest('hex')}.json`;
// This is presentation enrichment only. Every difference remains available when a name cannot be resolved.
export const MAX_DIFF_REFERENCE_LABELS = 256;

function changedReferences(before: EditorialJson | undefined, after: EditorialJson | undefined, ids: Set<string>) {
  const assertions = (value: EditorialJson | undefined) => object(value) && object(value.object) && Array.isArray(value.assertions)
    ? new Map(value.assertions.filter(object).flatMap(item => typeof item.id === 'string' ? [[item.id, item] as const] : []))
    : new Map<string, Record<string, EditorialJson>>();
  const visit = (value: EditorialJson | undefined) => {
    if (Array.isArray(value)) for (const item of value) visit(item);
    else if (object(value)) {
      if (value.kind === 'entity' && typeof value.objectId === 'string' && ids.size < MAX_DIFF_REFERENCE_LABELS) ids.add(value.objectId);
      else if (typeof value.propertyId === 'string') visit(value.value);
    }
  };
  const left = assertions(before), right = assertions(after);
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    for (const field of ['value', 'qualifiers'] as const) {
      const a = left.get(id)?.[field], b = right.get(id)?.[field];
      if (key(a) !== key(b)) { visit(a); visit(b); }
    }
  }
}

function labels(files: EditorialSnapshot['files'], ids: Set<string>): RepositoryDiffReferenceLabels {
  const result: RepositoryDiffReferenceLabels = {};
  for (const id of ids) {
    const bundle = files[objectPath(id)];
    if (!object(bundle) || !object(bundle.object) || bundle.object.id !== id || !object(bundle.object.labels)) continue;
    const names = Object.fromEntries(Object.entries(bundle.object.labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]));
    if (Object.keys(names).length) result[id] = names;
  }
  return result;
}

/** Resolve names from each difference's own basis, never a renderer's current object cache. */
export async function expandKnowledgeDiffReferences(repository: EditorialRepository, input: {
  before: EditorialSnapshot; after: EditorialSnapshot; paths: string[]; beforeRevision: string; afterRevision: string;
}) {
  const ids = new Set<string>();
  for (const file of input.paths) if (file.startsWith('objects/')) changedReferences(input.before.files[file], input.after.files[file], ids);
  if (!ids.size) return { before: input.before, after: input.after };
  const paths = [...new Set([...input.paths, ...[...ids].map(objectPath)])];
  // Re-read the selected records and their names together. Working values and names share one snapshot.
  const [before, after] = await Promise.all([
    repository.snapshot({ from: input.beforeRevision, paths }), repository.snapshot({ from: input.afterRevision, paths }),
  ]);
  return { before, after, referenceLabels: { before: labels(before.files, ids), after: labels(after.files, ids) } };
}
