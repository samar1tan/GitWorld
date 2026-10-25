import { createHash } from 'node:crypto';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeSourcePresentation, KnowledgeSourcePresentations } from '../../contracts/src/knowledge-workspace-types.ts';

export const SOURCE_PRESENTATIONS_PATH = 'mappings/source-presentations.json';
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x1f]/.test(value);
const invalid = (): never => { throw new Error('VALIDATION_FAILED'); };
const sourcePath = (id: string) => `sources/${createHash('sha256').update(canonicalJson(id)).digest('hex')}.json`;

export function sourcePresentationEntries(value: unknown): KnowledgeSourcePresentation[] {
  if (!Array.isArray(value) || value.length > 10000) return invalid();
  const seen = new Set<string>();
  for (const item of value) {
    if (!record(item) || !keys(item, ['sourceId','revision','contentHash','labels']) || !text(item.sourceId,300) || !(item.revision === null || text(item.revision,300)) || typeof item.contentHash!=='string' || !/^[a-f0-9]{64}$/.test(item.contentHash) || !record(item.labels) || !keys(item.labels,['en','zh-CN']) || !text(item.labels.en,400) || !text(item.labels['zh-CN'],400) || seen.has(item.sourceId)) return invalid();
    seen.add(item.sourceId);
  }
  return structuredClone(value);
}

/** Optional metadata is accepted only against the sources in this exact Git snapshot. */
export function readSourcePresentations(files: Record<string, EditorialJson>): KnowledgeSourcePresentation[] {
  const value: unknown = files[SOURCE_PRESENTATIONS_PATH];
  if (value === undefined) return [];
  if (!record(value) || !keys(value,['schemaVersion','kind','sources']) || value.schemaVersion !== 1 || value.kind !== 'gitworld-source-presentations') return invalid();
  const entries = sourcePresentationEntries(value.sources);
  for (const entry of entries) {
    const source = files[sourcePath(entry.sourceId)] as unknown as KnowledgeSource | undefined;
    if (!source || source.id !== entry.sourceId || source.revision !== entry.revision || source.contentHash !== entry.contentHash) return invalid();
  }
  return entries;
}

export function sourcePresentationsFile(sources: KnowledgeSourcePresentation[]): KnowledgeSourcePresentations {
  return { schemaVersion:1, kind:'gitworld-source-presentations', sources:sourcePresentationEntries(sources) };
}
