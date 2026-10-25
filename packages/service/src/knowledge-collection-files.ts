import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { createKnowledgeIndex, KNOWLEDGE_NAVIGATION_ROLES, type KnowledgeCollection, type KnowledgeJson } from '../../domain/src/knowledge.ts';
import type { KnowledgeFieldCatalog } from '../../contracts/src/knowledge-workspace-types.ts';
import type { KnowledgeImportArtifact } from '../../contracts/src/knowledge-import-types.ts';
import { canonicalJson, validateJsonBoundary } from '../../domain/src/index.ts';

export const KNOWLEDGE_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const texts = (value: unknown) => record(value) && Object.values(value).every(item => typeof item === 'string');
const identity = (value: unknown) => record(value) && text(value.provider) && text(value.externalId);
const date = (value: unknown) => record(value) && Number.isSafeInteger(value.earliestYear) && value.earliestYear !== 0 && Number.isSafeInteger(value.latestYear) && value.latestYear !== 0 && value.earliestYear <= value.latestYear && text(value.calendar) && ['year','month','day','decade','century','millennium','broader','interval'].includes(value.precision);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const value = (input: unknown): boolean => {
  if (!record(input)) return false;
  if (['unknown', 'absent'].includes(input.kind)) return true;
  if (input.kind === 'entity') return text(input.objectId);
  if (input.kind === 'text') return typeof input.value === 'string' && (input.language === undefined || text(input.language));
  if (input.kind === 'number') return finite(input.value) && (input.unit === undefined || text(input.unit)) && (input.lowerBound === undefined || finite(input.lowerBound)) && (input.upperBound === undefined || finite(input.upperBound));
  if (input.kind === 'boolean') return typeof input.value === 'boolean';
  if (input.kind === 'time') return date(input.value);
  if (input.kind === 'coordinate') return finite(input.longitude) && Math.abs(input.longitude) <= 180 && finite(input.latitude) && Math.abs(input.latitude) <= 90 && text(input.globe);
  return input.kind === 'raw' && Object.hasOwn(input, 'value');
};
const evidence = (item: unknown) => record(item) && text(item.sourceId) && typeof item.locator === 'string' && (item.url === undefined || typeof item.url === 'string') && (item.citation === undefined || typeof item.citation === 'string');

/** A selected file is data, not a trusted seed or an authored history-model package. */
export function parseKnowledgeCollectionFile(input: string, maximumBytes = KNOWLEDGE_IMPORT_MAX_BYTES): KnowledgeCollection {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > KNOWLEDGE_IMPORT_MAX_BYTES || Buffer.byteLength(input) > maximumBytes) throw new Error('KNOWLEDGE_FILE_TOO_LARGE');
  let parsed: unknown; try { parsed = JSON.parse(input); } catch { throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE'); }
  if (!record(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.objects) || !Array.isArray(parsed.assertions) || !Array.isArray(parsed.sources)) throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE');
  if (parsed.objects.some(item => !record(item) || !text(item.id) || !Array.isArray(item.identities) || !item.identities.every(identity) || !texts(item.labels) || !texts(item.descriptions) || !Array.isArray(item.aliases) || !item.aliases.every(texts) || !Array.isArray(item.types) || !item.types.every(text))) throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE');
  if (parsed.sources.some(item => !record(item) || !text(item.id) || !identity(item.identity) || !(item.revision === null || typeof item.revision === 'string') || !text(item.contentHash) || !text(item.retrievedAt) || !text(item.url) || !text(item.adapterVersion) || !record(item.rights) || !['allowed','restricted','unknown'].includes(item.rights.redistribution))) throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE');
  if (parsed.assertions.some(item => !record(item) || !text(item.id) || !text(item.subjectId) || !text(item.propertyId) || !value(item.value) || !text(item.sourceSnapshotId) || !Array.isArray(item.evidence) || !item.evidence.every(evidence) || !Array.isArray(item.qualifiers) || !item.qualifiers.every((qualifier: unknown) => record(qualifier) && text(qualifier.propertyId) && value(qualifier.value)) || !['unreviewed','adopted','rejected'].includes(item.review) || item.rank !== undefined && !['preferred','normal','deprecated'].includes(item.rank) || item.validTime !== undefined && (!record(item.validTime) || Object.keys(item.validTime).some(key => !['start','end','point','certainty'].includes(key)) || ['start','end','point'].some(key => item.validTime[key] !== undefined && !date(item.validTime[key])) || item.validTime.certainty !== undefined && item.validTime.certainty !== 'possible'))) throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE');
  const collection = parsed as KnowledgeCollection;
  try { createKnowledgeIndex(collection); } catch { throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE'); }
  return collection;
}

export function parseKnowledgeFieldCatalog(input: string): KnowledgeFieldCatalog {
  if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('INVALID_KNOWLEDGE_FIELD_CATALOG');
  let parsed: unknown; try { parsed = JSON.parse(input); } catch { throw new Error('INVALID_KNOWLEDGE_FIELD_CATALOG'); }
  const catalogId=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=300&&!/[\x00-\x1f\x7f]/.test(value);
  const labels=(value:unknown)=>texts(value)&&Object.entries(value as Record<string,string>).every(([language,label])=>/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language)&&label.length<=8000);
  const entries = (items: unknown) => Array.isArray(items) && items.length<=10000 && items.every(item => record(item) && catalogId(item.id) && labels(item.labels)) && new Set(items.map(item => item.id)).size === items.length;
  if (!record(parsed) || parsed.schemaVersion !== 1 || parsed.kind !== 'historical-field-display-labels' || !entries(parsed.properties) || !entries(parsed.types) || parsed.types.some((item:any)=>item.navigationRole!==undefined&&!KNOWLEDGE_NAVIGATION_ROLES.includes(item.navigationRole)) || parsed.semanticNotes !== undefined && (!Array.isArray(parsed.semanticNotes) || !parsed.semanticNotes.every((item: unknown) => record(item) && Array.isArray(item.ids) && item.ids.every(text) && typeof item.en === 'string' && typeof item['zh-CN'] === 'string'))) throw new Error('INVALID_KNOWLEDGE_FIELD_CATALOG');
  if (parsed.values !== undefined && (!Array.isArray(parsed.values) || parsed.values.length>10000 || !parsed.values.every((item: unknown) => record(item) && catalogId(item.propertyId) && typeof item.value === 'string' && item.value.length<=8000 && labels(item.labels)) || new Set(parsed.values.map((item: any) => canonicalJson([item.propertyId,item.value]))).size !== parsed.values.length)) throw new Error('INVALID_KNOWLEDGE_FIELD_CATALOG');
  return parsed as KnowledgeFieldCatalog;
}

/** Explicit paired format; arbitrary source-record fields never activate a catalog. */
export function parseKnowledgeImportArtifact(input: string): KnowledgeImportArtifact {
  if (Buffer.byteLength(input) > KNOWLEDGE_IMPORT_MAX_BYTES) throw new Error('KNOWLEDGE_FILE_TOO_LARGE');
  let p: any; try { p = JSON.parse(input); } catch { throw new Error('INVALID_KNOWLEDGE_IMPORT'); }
  const invalid = () => { throw new Error('INVALID_KNOWLEDGE_IMPORT'); };
  const keys = (v: unknown, allowed: string[]) => record(v) && Object.keys(v).every(key => allowed.includes(key));
  const id = (v: unknown) => typeof v === 'string' && !!v.trim() && v.length <= 300 && !/[\x00-\x1f\x7f]/.test(v);
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  if (!keys(p, ['schemaVersion','kind','collection','vocabulary','projection','sourceRights']) || p.schemaVersion !== 1 || p.kind !== 'gitworld-knowledge-import') invalid();
  const collection = parseKnowledgeCollectionFile(JSON.stringify(p.collection));
  const pending:{value:unknown;depth:number}[]=[{value:collection,depth:0}];let nodes=0;
  while(pending.length){const current=pending.pop()!;if(++nodes>1_000_000||current.depth>40)invalid();if(current.value&&typeof current.value==='object')for(const child of Object.values(current.value))pending.push({value:child,depth:current.depth+1});else if(typeof current.value==='number'&&!Number.isFinite(current.value))invalid();}
  if (validateJsonBoundary({ ...(p.vocabulary ? {vocabulary:p.vocabulary} : {}), ...(p.projection ? {projection:p.projection} : {}), ...(p.sourceRights === undefined ? {} : {sourceRights:p.sourceRights}) }).length) invalid();
  const sources = new Map(collection.sources.map(source => [source.id,source]));
  for (const source of collection.sources) if (source.record !== undefined && createHash('sha256').update(canonicalJson(source.record)).digest('hex') !== source.contentHash) invalid();
  if (p.vocabulary !== undefined) {
    const v=p.vocabulary,o=v?.origin;
    if (!keys(v,['id','revision','catalog','origin']) || !id(v.id) || !id(v.revision) || !keys(o,['identity','url','retrievedAt','rights','evidence']) || !keys(o.identity,['provider','externalId']) || !identity(o.identity) || !id(o.identity.provider) || !id(o.identity.externalId) || !text(o.url) || o.url.length>2048 || /\s/.test(o.url) || !/^https:\/\//.test(o.url) || !text(o.retrievedAt) || !/^\d{4}-\d\d-\d\dT/.test(o.retrievedAt) || !Number.isFinite(Date.parse(o.retrievedAt)) || !keys(o.rights,['redistribution','licenseId','licenseUrl','attribution']) || !['allowed','restricted','unknown'].includes(o.rights.redistribution) || Object.values(o.rights).some(value=>typeof value!=='string'||value.length>8000) || !Array.isArray(o.evidence) || o.evidence.length > 30) invalid();
    try { const url=new URL(o.url); if(url.username||url.password) invalid(); } catch { invalid(); }
    for (const e of o.evidence) if (!keys(e,['sourceId','sourceHash','locator']) || !id(e.sourceId) || !hash(e.sourceHash) || !text(e.locator) || e.locator.length>8000 || sources.get(e.sourceId)?.contentHash!==e.sourceHash) invalid();
    p.vocabulary.catalog=parseKnowledgeFieldCatalog(JSON.stringify(v.catalog));
  }
  if(p.projection!==undefined){const v=p.projection;
    if(!keys(v,['profileId','profileVersion','libraryRevision','sourcePins','plan','exceptions'])||!id(v.profileId)||!id(v.profileVersion)||typeof v.libraryRevision!=='string'||!/^[a-f0-9]{40}$/.test(v.libraryRevision)||!Array.isArray(v.sourcePins)||v.sourcePins.length>1000||!Array.isArray(v.exceptions)||v.exceptions.length>10000||v.plan===undefined)invalid();
    if(new Set(v.sourcePins.map((pin:any)=>pin.sourceId)).size!==v.sourcePins.length)invalid();for(const pin of v.sourcePins)if(!keys(pin,['sourceId','contentHash','revision'])||!id(pin.sourceId)||!hash(pin.contentHash)||sources.get(pin.sourceId)?.contentHash!==pin.contentHash||sources.get(pin.sourceId)?.revision!==pin.revision)invalid();
    if(v.exceptions.some((e:any)=>!keys(e,['code','locator'])||!id(e.code)||typeof e.locator!=='string'||e.locator.length>8000))invalid();
  }
  if(p.sourceRights!==undefined&&Buffer.byteLength(canonicalJson(p.sourceRights))>1024*1024)invalid();
  return {...p,collection} as KnowledgeImportArtifact;
}

export type KnowledgeFilePreview = { collection: KnowledgeCollection; name: string; bytes: number; sha256: string; artifact?: KnowledgeImportArtifact; issues?:{code:string;locator:string}[] };
export function previewKnowledgeCollectionFile(input: { text: string; name: string }): KnowledgeFilePreview {
  if (!input.name || input.name.length > 240 || /[\x00-\x1f/\\]/.test(input.name)) throw new Error('INVALID_REQUEST');
  if(Buffer.byteLength(input.text)>KNOWLEDGE_IMPORT_MAX_BYTES)throw new Error('KNOWLEDGE_FILE_TOO_LARGE');
  let p: any;try{p=JSON.parse(input.text);}catch{throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE');}
  const artifact=p?.kind==='gitworld-knowledge-import'?parseKnowledgeImportArtifact(input.text):undefined;
  const issues=!artifact&&(p?.fieldCatalog!==undefined||p?.vocabulary!==undefined)?[{code:'UNPAIRED_VOCABULARY',locator:'$'}]:[];
  return { collection: artifact?.collection??parseKnowledgeCollectionFile(input.text), name: input.name, bytes: Buffer.byteLength(input.text),sha256:createHash('sha256').update(input.text).digest('hex'),...(artifact?{artifact}: {}),...(issues.length?{issues}:{}) };
}

/** Call only after resolving a host-issued import token; renderer paths are never accepted by this helper's caller. */
export async function readSelectedKnowledgeCollectionFile(selectedPath: string): Promise<KnowledgeFilePreview> {
  const handle = await open(selectedPath, 'r').catch(() => { throw new Error('KNOWLEDGE_FILE_READ_FAILED'); });
  try {
    const stat = await handle.stat(); if (!stat.isFile()) throw new Error('KNOWLEDGE_FILE_READ_FAILED');
    if (stat.size > KNOWLEDGE_IMPORT_MAX_BYTES) throw new Error('KNOWLEDGE_FILE_TOO_LARGE');
    let bytes = 0; const chunks: Buffer[] = [];
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) { bytes += chunk.length; if (bytes > KNOWLEDGE_IMPORT_MAX_BYTES) throw new Error('KNOWLEDGE_FILE_TOO_LARGE'); chunks.push(chunk); }
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new Error('INVALID_KNOWLEDGE_COLLECTION_FILE'); }
    return previewKnowledgeCollectionFile({ text, name: path.basename(selectedPath) });
  } finally { await handle.close(); }
}

export function parseKnowledgeRightsSidecar(input: string): KnowledgeJson {
  if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('INVALID_KNOWLEDGE_RIGHTS');
  let parsed: unknown; try { parsed = JSON.parse(input); } catch { throw new Error('INVALID_KNOWLEDGE_RIGHTS'); }
  if (!record(parsed) || parsed.schemaVersion !== 1) throw new Error('INVALID_KNOWLEDGE_RIGHTS');
  return parsed as KnowledgeJson;
}
