import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex, type KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { combineKnowledgeCollections } from '../../ingestion/src/knowledge-mapping.ts';
import { parseKnowledgeCollectionFile, parseKnowledgeFieldCatalog, parseKnowledgeRightsSidecar } from './knowledge-collection-files.ts';
import type { KnowledgeFieldCatalog } from '../../contracts/src/knowledge-workspace-types.ts';
import { navigationBootstrapSeedFiles, parseNavigationBootstrap } from './navigation-tree.ts';
import { knowledgeCollectionSeedFiles } from './knowledge-store.ts';

export const KNOWLEDGE_PUBLIC_FILE_MAX_BYTES = 8 * 1024 * 1024;
export type KnowledgeBundleFile = { path: string; bytes: number; sha256: string };
export type KnowledgeBundleManifest = {
  schemaVersion: 1; kind: 'gitworld-knowledge-bundle'; id: string; labels: { en: string; 'zh-CN': string };
  shards: KnowledgeBundleFile[]; fieldCatalog: KnowledgeBundleFile; sourceRights: KnowledgeBundleFile;
  fieldCatalogOverlays?: KnowledgeBundleFile[]; supportingFiles?: KnowledgeBundleFile[];
  navigation?: KnowledgeBundleFile;
  collectionHash: string; counts: { objects: number; assertions: number; sources: number };
  sourceHashes: { id: string; contentHash: string }[];
};
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const empty = (): KnowledgeCollection => ({ schemaVersion: 1, objects: [], assertions: [], sources: [] });
export function knowledgeCollectionFingerprint(collection: KnowledgeCollection): string {
  return sha256(canonicalJson({ schemaVersion: 1, objects: [...collection.objects].sort((a,b) => a.id.localeCompare(b.id)), assertions: [...collection.assertions].sort((a,b) => a.id.localeCompare(b.id)), sources: [...collection.sources].sort((a,b) => a.id.localeCompare(b.id)) }));
}
const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const safePath = (value: string) => /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.json$/.test(value) && !value.split('/').some(part => part === '.' || part === '..');

/** Curator-side partitioning by source and whole subject bundles; every output is an ordinary collection. */
export function partitionKnowledgeCollection(collection: KnowledgeCollection, maximumBytes = KNOWLEDGE_PUBLIC_FILE_MAX_BYTES) {
  createKnowledgeIndex(collection);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > KNOWLEDGE_PUBLIC_FILE_MAX_BYTES) throw new Error('INVALID_REQUEST');
  const files: { path: string; text: string; collection: KnowledgeCollection }[] = [], objects = new Map(collection.objects.map(value => [value.id, value])), sources = new Map(collection.sources.map(value => [value.id, value]));
  const add = (path: string, part: KnowledgeCollection) => { const text = serialize(part); if (Buffer.byteLength(text) > maximumBytes) throw new Error('KNOWLEDGE_SUBJECT_TOO_LARGE'); createKnowledgeIndex(part); files.push({ path, text, collection: part }); };
  // A catalog preserves objects without assertions and source-only interpretation/translation records.
  let catalog = empty(), catalogNumber = 1;
  const flushCatalog = () => { if (catalog.objects.length || catalog.sources.length) add(`collections/catalog-${catalogNumber++}.json`, catalog); catalog = empty(); };
  for (const key of ['objects','sources'] as const) for (const item of collection[key]) {
    const candidate = structuredClone(catalog); (candidate[key] as any[]).push(item);
    if (Buffer.byteLength(serialize(candidate)) > maximumBytes) { flushCatalog(); (catalog[key] as any[]).push(item); if (Buffer.byteLength(serialize(catalog)) > maximumBytes) throw new Error('KNOWLEDGE_RECORD_TOO_LARGE'); }
    else catalog = candidate;
  }
  flushCatalog();
  const grouped = new Map<string, Map<string, KnowledgeCollection['assertions']>>();
  for (const assertion of collection.assertions) { const subjects = grouped.get(assertion.sourceSnapshotId) ?? new Map(), claims = subjects.get(assertion.subjectId) ?? []; claims.push(assertion); subjects.set(assertion.subjectId, claims); grouped.set(assertion.sourceSnapshotId, subjects); }
  for (const [sourceId, subjects] of grouped) {
    const source = sources.get(sourceId)!, stem = `${source.identity.provider}-${source.identity.externalId}`.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').slice(0,70) + `-${sha256(sourceId).slice(0,8)}`;
    let assertions: KnowledgeCollection['assertions'] = [], number = 1;
    const part = (claims: KnowledgeCollection['assertions']): KnowledgeCollection => {
      const sourceIds = new Set(claims.flatMap(value => [value.sourceSnapshotId, ...value.evidence.map(item => item.sourceId)]));
      return { schemaVersion: 1, objects: [...new Set(claims.map(value => value.subjectId))].map(id => objects.get(id)!), assertions: claims, sources: [...sourceIds].map(id => sources.get(id)!) };
    };
    const flush = () => { if (assertions.length) add(`collections/${stem}-${number++}.json`, part(assertions)); assertions = []; };
    for (const claims of subjects.values()) { if (assertions.length && Buffer.byteLength(serialize(part([...assertions,...claims]))) > maximumBytes) flush(); assertions.push(...claims); if (Buffer.byteLength(serialize(part(assertions))) > maximumBytes) throw new Error('KNOWLEDGE_SUBJECT_TOO_LARGE'); }
    flush();
  }
  const merged = combineKnowledgeCollections(files.map(file => file.collection));
  if (merged.conflicts.length || knowledgeCollectionFingerprint(merged.collection) !== knowledgeCollectionFingerprint(collection)) throw new Error('KNOWLEDGE_BUNDLE_MISMATCH');
  return files.map(({path,text}) => ({ path, text, bytes: Buffer.byteLength(text), sha256: sha256(text) }));
}

/** The host pins the manifest hash and supplies a reader restricted to the installed bundle directory. */
export async function loadTrustedKnowledgeBundle(input: { manifestText: string; expectedManifestHash: string; readText: (relativePath: string) => Promise<string> }) {
  if (!/^[a-f0-9]{64}$/.test(input.expectedManifestHash) || Buffer.byteLength(input.manifestText) > 1024 * 1024 || sha256(input.manifestText) !== input.expectedManifestHash) throw new Error('KNOWLEDGE_BUNDLE_HASH_MISMATCH');
  let manifest: KnowledgeBundleManifest; try { manifest = JSON.parse(input.manifestText); } catch { throw new Error('INVALID_KNOWLEDGE_BUNDLE'); }
  const validFile = (file: KnowledgeBundleFile) => file && typeof file.path === 'string' && safePath(file.path) && Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= KNOWLEDGE_PUBLIC_FILE_MAX_BYTES && /^[a-f0-9]{64}$/.test(file.sha256);
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'gitworld-knowledge-bundle' || typeof manifest.id !== 'string' || !manifest.labels || typeof manifest.labels.en !== 'string' || typeof manifest.labels['zh-CN'] !== 'string' || !Array.isArray(manifest.shards) || !manifest.shards.length || manifest.shards.length > 1000 || !manifest.shards.every(validFile) || !validFile(manifest.fieldCatalog) || !validFile(manifest.sourceRights) || !/^[a-f0-9]{64}$/.test(manifest.collectionHash) || !manifest.counts || !['objects','assertions','sources'].every(key => Number.isSafeInteger((manifest.counts as any)[key]) && (manifest.counts as any)[key] >= 0) || !Array.isArray(manifest.sourceHashes) || manifest.sourceHashes.some(value => !value || typeof value.id !== 'string' || typeof value.contentHash !== 'string')) throw new Error('INVALID_KNOWLEDGE_BUNDLE');
  for (const extra of [manifest.fieldCatalogOverlays,manifest.supportingFiles]) if (extra !== undefined && (!Array.isArray(extra) || extra.length > 100 || !extra.every(validFile))) throw new Error('INVALID_KNOWLEDGE_BUNDLE');
  if(manifest.navigation!==undefined&&!validFile(manifest.navigation))throw new Error('INVALID_KNOWLEDGE_BUNDLE');
  const entries = [...manifest.shards, manifest.fieldCatalog, manifest.sourceRights,...manifest.fieldCatalogOverlays??[],...manifest.supportingFiles??[],...(manifest.navigation?[manifest.navigation]:[])]; if (new Set(entries.map(value => value.path)).size !== entries.length) throw new Error('INVALID_KNOWLEDGE_BUNDLE');
  let totalBytes = 0;
  const read = async (file: KnowledgeBundleFile) => { totalBytes += file.bytes; if (totalBytes > 128 * 1024 * 1024) throw new Error('KNOWLEDGE_BUNDLE_TOO_LARGE'); const text = await input.readText(file.path); if (Buffer.byteLength(text) !== file.bytes || sha256(text) !== file.sha256) throw new Error('KNOWLEDGE_BUNDLE_HASH_MISMATCH'); return text; };
  const parts: KnowledgeCollection[] = []; for (const file of manifest.shards) parts.push(parseKnowledgeCollectionFile(await read(file), KNOWLEDGE_PUBLIC_FILE_MAX_BYTES));
  const merged = combineKnowledgeCollections(parts); if (merged.conflicts.length) throw new Error('KNOWLEDGE_BUNDLE_CONFLICT');
  const collection = merged.collection;
  if (collection.sources.some(source => source.record !== undefined && sha256(canonicalJson(source.record)) !== source.contentHash)) throw new Error('KNOWLEDGE_BUNDLE_MISMATCH');
  if (knowledgeCollectionFingerprint(collection) !== manifest.collectionHash || collection.objects.length !== manifest.counts.objects || collection.assertions.length !== manifest.counts.assertions || collection.sources.length !== manifest.counts.sources || manifest.sourceHashes.length !== collection.sources.length || new Set(manifest.sourceHashes.map(value => value.id)).size !== collection.sources.length || manifest.sourceHashes.some(value => collection.sources.find(item => item.id === value.id)?.contentHash !== value.contentHash)) throw new Error('KNOWLEDGE_BUNDLE_MISMATCH');
  const fieldCatalog = parseKnowledgeFieldCatalog(await read(manifest.fieldCatalog)), sourceRights = parseKnowledgeRightsSidecar(await read(manifest.sourceRights));
  const merge = <T>(before:T[],after:T[],key:(value:T)=>string) => {
    const values=new Map(before.map(value=>[key(value),value]));
    for(const value of after){const id=key(value),previous=values.get(id);if(previous&&canonicalJson(previous)!==canonicalJson(value))throw new Error('KNOWLEDGE_BUNDLE_CONFLICT');values.set(id,value);}
    return [...values.values()];
  };
  for(const file of manifest.fieldCatalogOverlays??[]) {
    const overlay=parseKnowledgeFieldCatalog(await read(file));
    fieldCatalog.properties=merge(fieldCatalog.properties,overlay.properties,value=>value.id);
    fieldCatalog.types=merge(fieldCatalog.types,overlay.types,value=>value.id);
    fieldCatalog.values=merge(fieldCatalog.values??[],overlay.values??[],value=>`${value.propertyId}\0${value.value}`);
    fieldCatalog.semanticNotes=merge(fieldCatalog.semanticNotes??[],overlay.semanticNotes??[],canonicalJson);
  }
  const supportingFiles:{path:string;value:unknown}[]=[];
  for(const file of manifest.supportingFiles??[]){const text=await read(file);try{supportingFiles.push({path:file.path,value:JSON.parse(text)});}catch{throw new Error('INVALID_KNOWLEDGE_SUPPORTING_FILE');}}
  const navigation=manifest.navigation?parseNavigationBootstrap(await read(manifest.navigation)):undefined;
  const legacyFieldCatalog=structuredClone(fieldCatalog);
  for(const item of navigation?.typeRoles??[]){const type=fieldCatalog.types.find(type=>type.id===item.typeId);if(!type||type.navigationRole!==undefined&&type.navigationRole!==item.role)throw new Error('KNOWLEDGE_BUNDLE_CONFLICT');type.navigationRole=item.role;}
  if(navigation)navigationBootstrapSeedFiles(navigation,{id:manifest.id,manifestHash:input.expectedManifestHash},knowledgeCollectionSeedFiles(collection));
  return { manifest, collection, fieldCatalog:fieldCatalog as KnowledgeFieldCatalog, legacyFieldCatalog, sourceRights, supportingFiles,...(navigation?{navigation}:{}) };
}
