import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeObject, KnowledgeText } from '../../domain/src/knowledge.ts';
import type { KnowledgeObjectBundle } from '../../contracts/src/knowledge-workspace-types.ts';

export const APPEND_OBJECT_MERGE_VERSION = 2 as const;
export type AppendObjectMergeVersion = 1 | typeof APPEND_OBJECT_MERGE_VERSION;

/** Expand a partial upstream scope without turning current local edits into upstream data. */
export function appendKnowledgeBundle(base: KnowledgeObjectBundle | null, incoming: KnowledgeObjectBundle,
  version: AppendObjectMergeVersion = APPEND_OBJECT_MERGE_VERSION) {
  if (base && base.object.id !== incoming.object.id) throw new Error('VALIDATION_FAILED');
  const assertions = new Map((base?.assertions ?? []).map(value => [value.id, structuredClone(value)]));
  for (const assertion of incoming.assertions) assertions.set(assertion.id, structuredClone(assertion));
  const bundle: KnowledgeObjectBundle = { ...structuredClone(incoming),
    assertions: [...assertions.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  if (!base || version === 1) return { bundle, metadataConflict: false };

  let metadataConflict = false;
  const localized = (before: KnowledgeText, next: KnowledgeText) => {
    const result = new Map(Object.entries(before));
    for (const [locale, value] of Object.entries(next)) {
      if (!value.trim()) continue;
      const prior = result.get(locale);
      if (prior?.trim() && prior !== value) metadataConflict = true;
      result.set(locale, value);
    }
    return Object.fromEntries(result);
  };
  const union = <T>(before: T[], next: T[]) => {
    const values = new Map(before.map(value => [canonicalJson(value), structuredClone(value)]));
    for (const value of next) if (!values.has(canonicalJson(value))) values.set(canonicalJson(value), structuredClone(value));
    return [...values.values()];
  };
  const priorIdentities = new Map<string, Set<string>>();
  for (const value of base.object.identities) {
    const ids = priorIdentities.get(value.provider) ?? new Set<string>();
    ids.add(value.externalId); priorIdentities.set(value.provider, ids);
  }
  for (const value of incoming.object.identities) {
    const ids = priorIdentities.get(value.provider);
    if (ids && !ids.has(value.externalId)) metadataConflict = true;
  }
  const object: KnowledgeObject = { ...bundle.object,
    labels: localized(base.object.labels, incoming.object.labels),
    descriptions: localized(base.object.descriptions, incoming.object.descriptions),
    aliases: union(base.object.aliases, incoming.object.aliases),
    identities: union(base.object.identities, incoming.object.identities),
    types: union(base.object.types, incoming.object.types),
  };
  bundle.object = object;
  return { bundle, metadataConflict };
}
