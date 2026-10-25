import { createHash } from 'node:crypto';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeAssertion, KnowledgeValue } from '../../domain/src/knowledge.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';

type Files = Readonly<Record<string, EditorialJson>>;
export type KnowledgeEntityReference = { assertion: KnowledgeAssertion; subjectId: string; targetId: string; slot: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const knowledgeObjectPath = (id: string) => `objects/${digest(id)}.json`;

/** Raw values are deliberately opaque; only typed entity values carry references. */
export function knowledgeEntityReferences(files: Files): KnowledgeEntityReference[] {
  const references: KnowledgeEntityReference[] = [];
  for (const [name, value] of Object.entries(files)) {
    if (!name.startsWith('objects/')) continue;
    if (!record(value) || !record(value.object) || typeof value.object.id !== 'string' || !Array.isArray(value.assertions)) throw new Error('INVALID_KNOWLEDGE_REFERENCE');
    for (const assertion of value.assertions as KnowledgeAssertion[]) {
      const add = (value: KnowledgeValue, slot: string) => {
        if (value.kind !== 'entity') return;
        if (typeof value.objectId !== 'string' || !value.objectId) throw new Error('INVALID_KNOWLEDGE_REFERENCE');
        references.push({ assertion, subjectId: assertion.subjectId, targetId: value.objectId, slot });
      };
      add(assertion.value, 'value');
      assertion.qualifiers.forEach((qualifier, index) => add(qualifier.value, `qualifier:${index}:${qualifier.propertyId}`));
    }
  }
  return references;
}

/** Manual amendments retain real prior sources, not arbitrary IDs inside raw input. */
export function knowledgeSourceReferences(source: EditorialJson | undefined): string[] {
  if (!record(source) || !record(source.identity) || source.identity.provider !== 'gitworld-local' || !record(source.record) || source.record.kind !== 'gitworld-local-amendment' || !record(source.record.amendment)) return [];
  const amendment = source.record.amendment, ids = new Set<string>();
  const add = (id: unknown) => { if (typeof id === 'string' && id) ids.add(id); };
  if (record(amendment.originalSource)) add(amendment.originalSource.id);
  if (record(source.record.reference)) add(source.record.reference.sourceId);
  if (record(amendment.originalAssertion)) {
    add(amendment.originalAssertion.sourceSnapshotId);
    if (Array.isArray(amendment.originalAssertion.evidence)) for (const evidence of amendment.originalAssertion.evidence) if (record(evidence)) add(evidence.sourceId);
  }
  return [...ids];
}

function explicitManualTarget(reference: KnowledgeEntityReference, files: Files): boolean {
  if (reference.slot !== 'value') return false;
  const source = files[`sources/${digest(reference.assertion.sourceSnapshotId)}.json`];
  if (!record(source) || !record(source.identity) || source.identity.provider !== 'gitworld-local' || !record(source.record) || source.record.kind !== 'gitworld-local-amendment') return false;
  const amendment = source.record.amendment;
  if (!record(amendment) || amendment.objectId !== reference.subjectId || amendment.assertionId !== reference.assertion.id || amendment.resultingAssertionHash !== digest(reference.assertion)) return false;
  const original = amendment.originalAssertion;
  // A correction may intentionally preserve an unresolved imported value.
  return original === null || record(original) && record(original.value) && (original.value.kind !== 'entity' || original.value.objectId !== reference.targetId);
}

/** Preserve old unresolved imports, but never newly sever a resolved or explicit manual link. */
export function brokenKnowledgeReferencePaths(previous: Files, candidate: Files, knownObjectPaths: ReadonlySet<string> = new Set()): string[] {
  const missing = new Set<string>();
  for (const reference of knowledgeEntityReferences(candidate)) {
    const target = knowledgeObjectPath(reference.targetId);
    if (candidate[target] !== undefined) continue;
    if (previous[target] !== undefined || knownObjectPaths.has(target) || explicitManualTarget(reference, candidate)) missing.add(target);
  }
  for (const [name, value] of Object.entries(candidate)) if (name.startsWith('sources/')) for (const id of knowledgeSourceReferences(value)) {
    const target = `sources/${digest(id)}.json`;
    if (candidate[target] === undefined) missing.add(target);
  }
  return [...missing].sort();
}
