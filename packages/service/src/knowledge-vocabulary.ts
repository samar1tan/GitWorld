import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeNavigationRole, KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { EditorialJson, EditorialWrite } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeFieldCatalog, KnowledgeDisplayEvidence, KnowledgeLocalizedDisplay } from '../../contracts/src/knowledge-workspace-types.ts';
import type { KnowledgeImportArtifact, KnowledgeVocabulary, KnowledgeVocabularyConflict, KnowledgeVocabularyPresentation, KnowledgeVocabularySummary } from '../../contracts/src/knowledge-import-types.ts';
import { parseKnowledgeFieldCatalog, parseKnowledgeImportArtifact } from './knowledge-collection-files.ts';

export const VOCABULARY_ADAPTER = 'gitworld-field-catalog-v1';
export const vocabularyHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const vocabularySourcePath = (id: string) => `sources/${vocabularyHash(id)}.json`;
export const vocabularyPath = (id: string) => `mappings/field-catalogs/${vocabularyHash(id)}.json`;
export const vocabularyBaselinePath = (id: string) => `mappings/field-catalog-baselines/${vocabularyHash(id)}.json`;
export const emptyFieldCatalog = (): KnowledgeFieldCatalog => ({schemaVersion:1,kind:'historical-field-display-labels',properties:[],types:[]});
const record = (value: unknown): value is Record<string,any> => !!value&&typeof value==='object'&&!Array.isArray(value);
const invalid = (): never => {throw new Error('VALIDATION_FAILED');};
type Reference = {schemaVersion:1;kind:'active-field-catalog';catalogId:string;sourceId:string;sourceHash:string};
type Catalog = {path:string;baseline:string;sourcePath:string;source:KnowledgeSource;vocabulary:KnowledgeVocabulary};
type Slot = {kind:'properties'|'types'|'values';id:string;value?:string;labels:Record<string,string>;navigationRole?:KnowledgeNavigationRole};
export function vocabularySlots(catalog: KnowledgeFieldCatalog): Slot[] {
  return [...catalog.properties.map(value=>({kind:'properties' as const,...value})),...catalog.types.map(value=>({kind:'types' as const,...value})),...(catalog.values??[]).map(value=>({kind:'values' as const,id:value.propertyId,value:value.value,labels:value.labels}))];
}
const slotKey = (slot: Slot) => canonicalJson([slot.kind,slot.id,slot.value??null]);
function reference(value: unknown): Reference {
  if(!record(value)||value.schemaVersion!==1||value.kind!=='active-field-catalog'||typeof value.catalogId!=='string'||typeof value.sourceId!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceHash)||Object.keys(value).some(key=>!['schemaVersion','kind','catalogId','sourceId','sourceHash'].includes(key)))return invalid();
  return value as Reference;
}
function readCatalog(files:Record<string,EditorialJson>,name:string,value:EditorialJson):Catalog {
  const ref=reference(value),source=files[vocabularySourcePath(ref.sourceId)] as unknown as KnowledgeSource;
  const body:unknown=source?.record;
  if(name!==vocabularyPath(ref.catalogId)||!source||source.id!==ref.sourceId||source.contentHash!==ref.sourceHash||source.adapterVersion!==VOCABULARY_ADAPTER||source.identity.provider!=='gitworld-field-catalog'||!record(body)||body.kind!==VOCABULARY_ADAPTER||vocabularyHash(body)!==source.contentHash)return invalid();
  const vocabulary=body.vocabulary as unknown as KnowledgeVocabulary;
  const pins=Array.isArray(vocabulary?.origin?.evidence)?vocabulary.origin.evidence:[];
  const sources=pins.map(pin=>files[vocabularySourcePath(pin.sourceId)] as unknown as KnowledgeSource);
  if(sources.some(value=>!value))return invalid();
  const artifact=parseKnowledgeImportArtifact(JSON.stringify({schemaVersion:1,kind:'gitworld-knowledge-import',collection:{schemaVersion:1,objects:[],assertions:[],sources:[...new Map(sources.map(value=>[value.id,value])).values()]},vocabulary}));
  if(artifact.vocabulary!.id!==ref.catalogId||source.revision!==vocabulary.revision||source.identity.externalId!==vocabulary.id||source.id!==`gitworld-field-catalog:${vocabulary.id}@${source.contentHash}`||source.url!==vocabulary.origin.url||source.retrievedAt!==vocabulary.origin.retrievedAt||vocabularyHash(source.rights)!==vocabularyHash(vocabulary.origin.rights))return invalid();
  const baseline=files[vocabularyBaselinePath(ref.catalogId)];if(baseline===undefined)return invalid();
  const base=reference(baseline);if(base.catalogId!==ref.catalogId)return invalid();
  const upstream=files[vocabularySourcePath(base.sourceId)] as unknown as KnowledgeSource;
  if(!upstream||upstream.id!==base.sourceId||upstream.contentHash!==base.sourceHash||vocabularyHash(upstream.record)!==base.sourceHash||upstream.adapterVersion!==VOCABULARY_ADAPTER||upstream.identity.provider!=='gitworld-field-catalog'||upstream.identity.externalId!==ref.catalogId)return invalid();
  return{path:name,baseline:vocabularyBaselinePath(ref.catalogId),sourcePath:vocabularySourcePath(ref.sourceId),source,vocabulary:artifact.vocabulary!};
}

/** A single repository snapshot supplies both vocabulary and its evidence. */
export function resolveKnowledgeVocabulary(files:Record<string,EditorialJson>,legacy?:KnowledgeFieldCatalog) {
  const catalogs=Object.entries(files).filter(([name])=>name.startsWith('mappings/field-catalogs/')).map(([name,value])=>readCatalog(files,name,value));
  const contributions=new Map<string,{slot:Slot;sources:{source:KnowledgeSource;vocabulary:KnowledgeVocabulary;labels:Record<string,string>;navigationRole?:KnowledgeNavigationRole}[]}>();
  for(const catalog of catalogs)for(const slot of vocabularySlots(catalog.vocabulary.catalog)){const key=slotKey(slot),item=contributions.get(key)??{slot,sources:[]};item.sources.push({source:catalog.source,vocabulary:catalog.vocabulary,labels:slot.labels,...(slot.navigationRole?{navigationRole:slot.navigationRole}:{})});contributions.set(key,item);}
  const catalog=emptyFieldCatalog(),presentation:KnowledgeVocabularyPresentation={fingerprint:vocabularyHash({files:Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('mappings/field-catalogs/')||catalogs.some(value=>value.sourcePath===name))),legacy:legacy??null}),origin:catalogs.length?'git':legacy?'legacy':'none',...(legacy?{legacyFingerprint:vocabularyHash(legacy)}:{}),properties:Object.create(null),types:Object.create(null),values:Object.create(null)};
  for(const slot of vocabularySlots(legacy??emptyFieldCatalog()))if(!contributions.has(slotKey(slot)))contributions.set(slotKey(slot),{slot,sources:[]});
  const conflicts:KnowledgeVocabularyConflict[]=[];
  for(const [key,item]of contributions){
    const labels:Record<string,string>=Object.create(null),languages=new Set(item.sources.length?item.sources.flatMap(value=>Object.keys(value.labels)):Object.keys(item.slot.labels));
    for(const language of languages){const values=[...new Set(item.sources.length?item.sources.map(value=>value.labels[language]).filter(Boolean):[item.slot.labels[language]])];if(values.length===1)labels[language]=values[0];else for(const incoming of values.slice(1))conflicts.push({key,language,local:values[0],incoming});}
    const localized=Object.fromEntries((['en','zh-CN'] as const).map(language=>{
      const variants=item.sources.filter(value=>value.labels[language]),distinct=new Set(variants.map(value=>value.labels[language]));
      const provenance:KnowledgeDisplayEvidence[]=variants.map(({source,vocabulary,labels})=>({sourceId:source.id,method:'field-catalog',language,text:labels[language],evidence:vocabulary.origin.evidence.map(pin=>{const upstream=files[vocabularySourcePath(pin.sourceId)] as unknown as KnowledgeSource;return{url:upstream?.revisionUrl??upstream?.url??source.url,locator:pin.locator,sourceSnapshotHash:pin.sourceHash};})}));
      const chosen=labels[language]??labels.en??Object.values(labels)[0]??item.slot.id;
      return[language,{text:chosen,language:labels[language]?language:labels.en?'en':Object.keys(labels)[0]??'und',status:distinct.size>1?'conflict':!labels[language]?'missing':'original',origin:item.sources.length?'git':'legacy',provenance}];
    })) as KnowledgeLocalizedDisplay;
    if(item.slot.kind==='values'){(catalog.values??=[]).push({propertyId:item.slot.id,value:item.slot.value!,labels});(presentation.values[item.slot.id]??=Object.create(null))[item.slot.value!]=localized;}
    else{const roles=[...new Set(item.sources.length?item.sources.flatMap(value=>value.navigationRole?[value.navigationRole]:[]):item.slot.navigationRole?[item.slot.navigationRole]:[])];for(const incoming of roles.slice(1))conflicts.push({key,language:'und-navigation-role',local:roles[0],incoming});catalog[item.slot.kind].push({id:item.slot.id,labels,...(item.slot.kind==='types'&&roles.length===1?{navigationRole:roles[0]}:{})});presentation[item.slot.kind][item.slot.id]=localized;}
  }
  const versionedIds=new Set([...contributions.values()].filter(value=>value.sources.length).map(value=>value.slot.id));
  catalog.semanticNotes=[...new Map([...catalogs.flatMap(value=>value.vocabulary.catalog.semanticNotes??[]),...(legacy?.semanticNotes??[]).filter(note=>!note.ids.some(id=>versionedIds.has(id)))].map(note=>[canonicalJson(note),note])).values()];
  return{catalog,presentation,catalogs,conflicts};
}

export function vocabularySummary(vocabulary:KnowledgeVocabulary,conflicts:KnowledgeVocabularyConflict[]=[]):KnowledgeVocabularySummary {
  const missing=vocabularySlots(vocabulary.catalog).flatMap(slot=>(['en','zh-CN']as const).filter(language=>!slot.labels[language]?.trim()).map(language=>({key:slotKey(slot),language})));
  return{id:vocabulary.id,revision:vocabulary.revision,catalog:structuredClone(vocabulary.catalog),origin:structuredClone(vocabulary.origin),properties:vocabulary.catalog.properties.length,types:vocabulary.catalog.types.length,values:vocabulary.catalog.values?.length??0,missing:missing.slice(0,30),missingCount:missing.length,conflicts:conflicts.slice(0,30),conflictCount:conflicts.length};
}

export function planKnowledgeVocabulary(files:Record<string,EditorialJson>,artifact:KnowledgeImportArtifact,inputHash:string,legacy?:KnowledgeFieldCatalog) {
  const resolved=resolveKnowledgeVocabulary(files,legacy),v=artifact.vocabulary;
  if(!v)return{changes:[] as EditorialWrite[],guards:{} as Record<string,string|null>,conflicts:[] as KnowledgeVocabularyConflict[]};
  const body={kind:VOCABULARY_ADAPTER,vocabulary:v,inputHash,...(artifact.projection?{projection:artifact.projection}:{}),...(artifact.sourceRights===undefined?{}:{sourceRights:artifact.sourceRights})};
  const contentHash=vocabularyHash(body),source:KnowledgeSource={id:`gitworld-field-catalog:${v.id}@${contentHash}`,identity:{provider:'gitworld-field-catalog',externalId:v.id},revision:v.revision,contentHash,retrievedAt:v.origin.retrievedAt,url:v.origin.url,adapterVersion:VOCABULARY_ADAPTER,rights:structuredClone(v.origin.rights),record:body as unknown as KnowledgeSource['record']};
  const ref:Reference={schemaVersion:1,kind:'active-field-catalog',catalogId:v.id,sourceId:source.id,sourceHash:contentHash},name=vocabularyPath(v.id),baseline=vocabularyBaselinePath(v.id),sourceName=vocabularySourcePath(source.id);
  const candidate={...files,...Object.fromEntries(artifact.collection.sources.map(value=>[vocabularySourcePath(value.id),value as unknown as EditorialJson])),[sourceName]:source as unknown as EditorialJson,[name]:ref as unknown as EditorialJson,[baseline]:ref as unknown as EditorialJson};
  const conflicts=resolveKnowledgeVocabulary(candidate,legacy).conflicts;
  const previousCatalog=resolved.catalogs.find(value=>value.vocabulary.id===v.id);
  if(previousCatalog){const incoming=new Map(vocabularySlots(v.catalog).map(slot=>[slotKey(slot),slot]));for(const slot of vocabularySlots(previousCatalog.vocabulary.catalog)){for(const[language,local]of Object.entries(slot.labels))if(local&&!incoming.get(slotKey(slot))?.labels[language])conflicts.push({key:slotKey(slot),language,local,incoming:''});if(slot.navigationRole&&!incoming.get(slotKey(slot))?.navigationRole)conflicts.push({key:slotKey(slot),language:'und-navigation-role',local:slot.navigationRole,incoming:''});}}
  if(files[name]!==undefined&&files[baseline]!==undefined&&vocabularyHash(files[name])!==vocabularyHash(files[baseline])&&vocabularyHash(files[name])!==vocabularyHash(ref))conflicts.push({key:canonicalJson(['catalog',v.id]),language:'und',local:vocabularyHash(files[name]),incoming:vocabularyHash(ref)});
  const changes:EditorialWrite[]=[],guards:Record<string,string|null>={};
  for(const [file,value]of [[sourceName,source],[baseline,ref],[name,ref]] as const){const previous=files[file];if(previous!==undefined&&vocabularyHash(previous)===vocabularyHash(value))continue;if(file===sourceName&&previous!==undefined)return invalid();changes.push({path:file,value:value as unknown as EditorialJson});guards[file]=previous===undefined?null:vocabularyHash(previous);}
  return{changes,guards,conflicts};
}

const PIN='legacy-field-catalog.json';
export async function loadLegacyFieldCatalog(directory:string,fallback?:KnowledgeFieldCatalog):Promise<KnowledgeFieldCatalog|undefined>{
  const name=path.join(directory,PIN);let value:any;
  try{const handle=await open(name,constants.O_RDONLY|constants.O_NOFOLLOW);try{if((await handle.stat()).size>2*1024*1024)return invalid();value=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}}
  catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;if(!fallback)return;const catalog=parseKnowledgeFieldCatalog(JSON.stringify(fallback));value={schemaVersion:1,hash:vocabularyHash(catalog),catalog};await mkdir(directory,{recursive:true});const temporary=name+'.'+randomUUID()+'.tmp';try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(canonicalJson(value)+'\n');await handle.sync();}finally{await handle.close();}try{await link(temporary,name);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST')return await loadLegacyFieldCatalog(directory);throw error;}const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}finally{await rm(temporary,{force:true});}}
  if(!record(value)||value.schemaVersion!==1||value.hash!==vocabularyHash(value.catalog))return invalid();return parseKnowledgeFieldCatalog(JSON.stringify(value.catalog));
}

/** Validate only known optional metadata; no stores or Git refs are created during restore validation. */
export async function validateKnowledgeVocabularyDirectory(directory:string){
  const legacy=await loadLegacyFieldCatalog(directory),files:Record<string,EditorialJson>={};
  async function read(name:string){if(files[name]!==undefined)return files[name];const handle=await open(path.join(directory,'repository',name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>16*1024*1024)return invalid();return files[name]=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}}
  let entries;try{entries=await readdir(path.join(directory,'repository/mappings/field-catalogs'));}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return;throw error;}
  if(entries.length>40000)return invalid();
  for(const name of entries){if(!/^[a-f0-9]{64}\.json$/.test(name))return invalid();const ref=reference(await read('mappings/field-catalogs/'+name));const source=await read(vocabularySourcePath(ref.sourceId)) as any;const base=reference(await read(vocabularyBaselinePath(ref.catalogId)));await read(vocabularySourcePath(base.sourceId));for(const pin of source.record?.vocabulary?.origin?.evidence??[])await read(vocabularySourcePath(pin.sourceId));}
  resolveKnowledgeVocabulary(files,legacy);
}
