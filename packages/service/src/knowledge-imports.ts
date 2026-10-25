import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { EditorialJson, EditorialRepository, EditorialWrite } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeFileImportRequest, KnowledgeFieldCatalog, KnowledgeImportResult, KnowledgeMappingPreview } from '../../contracts/src/knowledge-workspace-types.ts';
import type { KnowledgeImportArtifact, KnowledgePendingImport, KnowledgeResumeImportRequest } from '../../contracts/src/knowledge-import-types.ts';
import type { ServiceError } from '../../contracts/src/index.ts';
import { parseKnowledgeImportArtifact, type KnowledgeFilePreview } from './knowledge-collection-files.ts';
import { createKnowledgeStore } from './knowledge-store.ts';
import { planKnowledgeVocabulary, vocabularyHash as hash, vocabularySummary, vocabularySourcePath } from './knowledge-vocabulary.ts';

const FILE='knowledge-imports.sqlite';
export class KnowledgeImportFailure extends Error {readonly detail:ServiceError;constructor(detail:ServiceError){super(detail.code);this.detail=detail;}}
const fail=(code:ServiceError['code'],reason?:string):never=>{throw new KnowledgeImportFailure({code,...(reason?{parameters:{reason}}:{})});};
type Preview={artifact:KnowledgeImportArtifact;fileHash:string;head:string;catalogHash:string;guards:Record<string,string|null>;preview:KnowledgeMappingPreview};
type Prepared={previewId:string;head:string;catalogPaths:string[];changes:EditorialWrite[];guards:Record<string,string|null>;result:KnowledgeImportResult;review?:'unreviewed'|'adopted';hash:string};
const metadata=(files:Record<string,EditorialJson>)=>Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('mappings/field-catalogs/')||name.startsWith('mappings/field-catalog-baselines/')));
export function knowledgeArtifactHash(artifact:KnowledgeImportArtifact){return hash({...artifact,fingerprintVersion:2,collection:{...artifact.collection,assertions:artifact.collection.assertions.map(value=>({...value,review:'unreviewed'}))}});}
const safePath=(name:string)=>/^(?:objects|sources)\/[a-f0-9]{64}\.json$/.test(name)||/^mappings\/(?:baseline-|conflict-)[a-f0-9]{64}\.json$/.test(name)||/^mappings\/field-catalog(?:s|-baselines)\/[a-f0-9]{64}\.json$/.test(name);
// The self-reference is excluded only from the preview record identifier.
const previewId=(value:Preview)=>hash({...value,preview:{...value.preview,prepared:{...value.preview.prepared,id:''}}});
function readPreview(id:string,text:string):Preview{
  if(text.length>64*1024*1024)return fail('VALIDATION_FAILED');const value=JSON.parse(text) as Preview;
  if(previewId(value)!==id||value.preview.prepared?.id!==id||value.preview.prepared.baseHead!==value.head||value.preview.prepared.fingerprintVersion!==2||value.preview.inputHash!==knowledgeArtifactHash(parseKnowledgeImportArtifact(JSON.stringify(value.artifact)))||!/^[a-f0-9]{40}$/.test(value.head)||!/^[a-f0-9]{64}$/.test(value.fileHash)||!/^[a-f0-9]{64}$/.test(value.catalogHash)||Object.entries(value.guards).some(([name,digest])=>!safePath(name)||digest!==null&&!/^[a-f0-9]{64}$/.test(digest)))return fail('VALIDATION_FAILED');
  return value;
}
function readPrepared(text:string):Prepared{
  if(text.length>128*1024*1024)return fail('VALIDATION_FAILED');const value=JSON.parse(text) as Prepared;
  if(!value||hash({...value,hash:''})!==value.hash||!/^[a-f0-9]{40}$/.test(value.head)||value.review!==undefined&&!['unreviewed','adopted'].includes(value.review)||!Array.isArray(value.changes)||value.changes.length>40000||new Set(value.changes.map(change=>change.path)).size!==value.changes.length||value.changes.some(change=>!safePath(change.path)||Buffer.byteLength(canonicalJson(change.value))>16*1024*1024)||Object.entries(value.guards).some(([name,digest])=>!safePath(name)||digest!==null&&!/^[a-f0-9]{64}$/.test(digest)))return fail('VALIDATION_FAILED');
  return value;
}

/** Immutable previews and a small durable write receipt; Git remains the content authority. */
export function createKnowledgeImports(repository:EditorialRepository,store:ReturnType<typeof createKnowledgeStore>,options:{dataDirectory:string;legacy?:KnowledgeFieldCatalog;onFault?:(point:'after-prepare'|'after-write'|'after-receipt')=>void|Promise<void>}){
  validateKnowledgeImportDirectory(options.dataDirectory);
  const database=new DatabaseSync(path.join(options.dataDirectory,FILE));
  try{database.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, signature TEXT NOT NULL, prepared TEXT NOT NULL, result TEXT)');}catch(error){database.close();throw error;}
  let tail:Promise<unknown>=Promise.resolve(),closed=false;
  function lookup(id:string){const row=database.prepare('SELECT body FROM previews WHERE id=?').get(id) as {body:string}|undefined;if(!row)return fail('NOT_FOUND');return readPreview(id,row.body);}
  async function preview(input:KnowledgeFilePreview){
    if(closed)return fail('SERVICE_UNAVAILABLE');
    if(!input.artifact)return fail('INVALID_REQUEST');const artifact=parseKnowledgeImportArtifact(canonicalJson(input.artifact));
    const snapshot=await repository.snapshot({from:'working',prefixes:['objects/','sources/','mappings/']});
    if(artifact.projection&&artifact.projection.libraryRevision!==snapshot.head)return fail('HEAD_CHANGED');
    const inputHash=knowledgeArtifactHash(artifact),catalog=planKnowledgeVocabulary(snapshot.files,artifact,inputHash,options.legacy);
    const names=new Set<string>(Object.keys(metadata(snapshot.files)));
    for(const object of artifact.collection.objects){names.add(`objects/${hash(object.id)}.json`);names.add(`mappings/baseline-${hash(object.id)}.json`);names.add(`mappings/conflict-${hash(object.id)}.json`);}
    for(const source of artifact.collection.sources)names.add(vocabularySourcePath(source.id));
    for(const change of catalog.changes)names.add(change.path);
    const guards=Object.fromEntries([...names].map(name=>[name,snapshot.files[name]===undefined?null:hash(snapshot.files[name])]));
    const summary=store.previewCollection(artifact.collection,{issues:artifact.projection?.exceptions}).preview;
    const value:Preview={artifact,fileHash:input.sha256,head:snapshot.head,catalogHash:hash(metadata(snapshot.files)),guards,preview:{...summary,inputHash,prepared:{id:'',fingerprintVersion:2,baseHead:snapshot.head},...(artifact.vocabulary?{vocabulary:vocabularySummary(artifact.vocabulary,catalog.conflicts)}:{})}};
    const id=previewId(value);value.preview.prepared!.id=id;
    database.prepare('INSERT OR IGNORE INTO previews(id,body) VALUES(?,?)').run(id,canonicalJson(value));
    return structuredClone(lookup(id).preview);
  }
  async function adopt(input:KnowledgeFileImportRequest,read:()=>Promise<KnowledgeFilePreview>):Promise<KnowledgeImportResult>{
    if(closed)return fail('SERVICE_UNAVAILABLE');const signature=hash(input);
    let row=database.prepare('SELECT signature,prepared,result FROM operations WHERE id=?').get(input.operationId) as {signature:string;prepared:string;result:string|null}|undefined;
    if(row&&row.signature!==signature)return fail('IDEMPOTENCY_CONFLICT');
    if(row?.result){const prepared=readPrepared(row.prepared),result=JSON.parse(row.result);if(hash(result)!==hash(prepared.result))return fail('VALIDATION_FAILED');return result;}
    let prepared:Prepared;
    if(row){prepared=readPrepared(row.prepared);const selected=lookup(prepared.previewId);if(prepared.previewId!==input.previewId||prepared.head!==input.expectedHead||selected.preview.inputHash!==input.expectedInputHash||hash(prepared.result.preview)!==hash(selected.preview))return fail('VALIDATION_FAILED');}
    else{
      if(!input.previewId)return fail('REVIEW_REQUIRED','paired-preview-required');const selected=lookup(input.previewId);
      if(selected.head!==input.expectedHead||selected.preview.inputHash!==input.expectedInputHash)return fail('CONFLICT');
      const file=await read();if(file.sha256!==selected.fileHash||!file.artifact||knowledgeArtifactHash(file.artifact)!==input.expectedInputHash)return fail('CONFLICT','selected-file-changed');
      const snapshot=await repository.snapshot({from:'working',prefixes:['objects/','sources/','mappings/']});
      if(snapshot.head!==input.expectedHead)return fail('HEAD_CHANGED');
      if(hash(metadata(snapshot.files))!==selected.catalogHash)return fail('CONTENT_CHANGED');
      for(const[name,expected]of Object.entries(selected.guards))if((snapshot.files[name]===undefined?null:hash(snapshot.files[name]))!==expected)return fail('CONTENT_CHANGED');
      const catalog=planKnowledgeVocabulary(snapshot.files,selected.artifact,input.expectedInputHash,options.legacy);
      if(catalog.conflicts.length)throw new KnowledgeImportFailure({code:'CONFLICT',parameters:{reason:'vocabulary-conflict'},vocabularyConflicts:catalog.conflicts.slice(0,30)});
      const plan=await store.planAdoption({collection:selected.artifact.collection,mode:'append-observations',review:input.review,expectedHead:input.expectedHead,expectedInputHash:store.previewCollection(selected.artifact.collection).preview.inputHash});
      if(plan.result.conflicts.length)return fail('CONFLICT','paired-object-conflict');
      const changes=[...plan.changes.filter(change=>change.path.startsWith('sources/')),...catalog.changes,...plan.changes.filter(change=>!change.path.startsWith('sources/'))];
      prepared={previewId:input.previewId,head:input.expectedHead,catalogPaths:Object.keys(metadata(snapshot.files)),changes,guards:{...selected.guards,...catalog.guards,...plan.guards},result:{...plan.result,preview:selected.preview,paths:changes.map(change=>change.path)},review:input.review,hash:''};
      prepared.hash=hash(prepared);readPrepared(canonicalJson(prepared));
      database.prepare('INSERT INTO operations(id,signature,prepared,result) VALUES(?,?,?,NULL)').run(input.operationId,signature,canonicalJson(prepared));await options.onFault?.('after-prepare');
    }
    return finish(prepared,input.operationId);
  }
  async function finish(prepared:Prepared,operationId:string):Promise<KnowledgeImportResult>{
    const current=await repository.snapshot({from:'working',prefixes:['objects/','sources/','mappings/']});
    const matches=(change:EditorialWrite)=>hash(current.files[change.path]??null)===hash(change.value);
    if(!prepared.changes.every(matches)){
      if(current.head!==prepared.head)return fail('HEAD_CHANGED');
      const allowed=new Set([...prepared.catalogPaths,...prepared.changes.map(change=>change.path)]);if(Object.keys(metadata(current.files)).some(name=>!allowed.has(name)))return fail('CONTENT_CHANGED');
      const expected:Record<string,string|null>={...prepared.guards};
      for(const change of prepared.changes){const value=current.files[change.path]??null,digest=value===null?null:hash(value);if(matches(change))expected[change.path]=digest;else if(digest!==prepared.guards[change.path])return fail('CONTENT_CHANGED');}
      for(const[name,digest]of Object.entries(expected))if((current.files[name]===undefined?null:hash(current.files[name]))!==digest)return fail('CONTENT_CHANGED');
      const changes=prepared.changes.filter(change=>!matches(change));if(changes.length)await repository.write(changes,{expectedHead:prepared.head,expectedContentHashes:expected});
      store.invalidate();await options.onFault?.('after-write');
      const after=await repository.snapshot({from:'working',paths:prepared.changes.map(change=>change.path)});if(prepared.changes.some(change=>hash(after.files[change.path]??null)!==hash(change.value)))return fail('CONTENT_CHANGED');
    }
    database.prepare('UPDATE operations SET result=? WHERE id=?').run(canonicalJson(prepared.result),operationId);await options.onFault?.('after-receipt');return structuredClone(prepared.result);
  }
  async function resume(input:KnowledgeResumeImportRequest):Promise<KnowledgeImportResult>{
    if(closed)return fail('SERVICE_UNAVAILABLE');
    const row=database.prepare('SELECT prepared,result FROM operations WHERE id=?').get(input.operationId) as {prepared:string;result:string|null}|undefined;
    if(!row)return fail('NOT_FOUND');
    const prepared=readPrepared(row.prepared);
    if(prepared.previewId!==input.previewId)return fail('CONFLICT','different-prepared-preview');
    const selected=lookup(input.previewId);
    if(selected.head!==prepared.head||hash(selected.preview)!==hash(prepared.result.preview))return fail('VALIDATION_FAILED');
    if(row.result!==null){const result=JSON.parse(row.result);if(hash(result)!==hash(prepared.result))return fail('VALIDATION_FAILED');return result;}
    return finish(prepared,input.operationId);
  }
  function serial<T>(task:()=>Promise<T>){const pending=tail.then(task);tail=pending.catch(()=>undefined);return pending;}
  return{
    preview,
    preparedPreview(id:string,expectedInputHash:string){
      if(closed)return fail('SERVICE_UNAVAILABLE');
      if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(expectedInputHash))return fail('INVALID_REQUEST');
      const selected=lookup(id);if(selected.preview.inputHash!==expectedInputHash)return fail('CONFLICT','different-prepared-preview');
      return structuredClone({artifact:selected.artifact,preview:selected.preview});
    },
    adopt:(input:KnowledgeFileImportRequest,read:()=>Promise<KnowledgeFilePreview>)=>serial(()=>adopt(input,read)),
    resume:(input:KnowledgeResumeImportRequest)=>serial(()=>resume(input)),
    pending():KnowledgePendingImport[]{
      if(closed)return fail('SERVICE_UNAVAILABLE');
      return(database.prepare('SELECT id,prepared FROM operations WHERE result IS NULL ORDER BY id LIMIT 100').all() as {id:string;prepared:string}[]).map(row=>{
        const prepared=readPrepared(row.prepared),preview=prepared.result.preview;
        return{operationId:row.id,previewId:prepared.previewId,baseHead:prepared.head,counts:{objects:preview.objects,assertions:preview.assertions,datedAssertions:preview.datedAssertions,locatedObjects:preview.locatedObjects},...(preview.vocabulary?{vocabulary:{id:preview.vocabulary.id,revision:preview.vocabulary.revision}}:{}),...(prepared.review?{review:prepared.review}:{})};
      });
    },
    pendingOperationIds(){return(database.prepare('SELECT id FROM operations WHERE result IS NULL').all() as {id:string}[]).map(row=>row.id);},
    completedBatches(){
      return(database.prepare('SELECT id,prepared,result FROM operations WHERE result IS NOT NULL ORDER BY id').all() as {id:string;prepared:string;result:string}[]).map(row=>{
        const prepared=readPrepared(row.prepared),selected=lookup(prepared.previewId),result=JSON.parse(row.result) as KnowledgeImportResult;
        if(hash(result)!==hash(prepared.result)||hash(selected.preview)!==hash(result.preview))return fail('VALIDATION_FAILED');
        return{operationId:row.id,method:'paired-import' as const,previewId:prepared.previewId,result,inputObjectIds:selected.artifact.collection.objects.map(object=>object.id),sources:selected.artifact.collection.sources};
      });
    },
    pendingPaths(){return[...new Set((database.prepare('SELECT prepared FROM operations WHERE result IS NULL').all() as {prepared:string}[]).flatMap(row=>readPrepared(row.prepared).changes.map(change=>change.path)))];},
    async close(){if(closed)return;await tail;closed=true;database.close();},
  };
}

/** Called on a backup candidate before directory exchange; opening is strictly read-only. */
export function validateKnowledgeImportDirectory(directory:string){
  const file=path.join(directory,FILE);if(!existsSync(file))return;
  const database=new DatabaseSync(file,{readOnly:true});try{
    for(const row of database.prepare('SELECT id,body FROM previews').iterate() as IterableIterator<{id:string;body:string}>)readPreview(row.id,row.body);
    for(const row of database.prepare('SELECT prepared,result FROM operations').iterate() as IterableIterator<{prepared:string;result:string|null}>){const prepared=readPrepared(row.prepared),preview=database.prepare('SELECT body FROM previews WHERE id=?').get(prepared.previewId) as {body:string}|undefined;if(!preview||hash(readPreview(prepared.previewId,preview.body).preview)!==hash(prepared.result.preview))return fail('VALIDATION_FAILED');if(row.result!==null&&hash(JSON.parse(row.result))!==hash(prepared.result))return fail('VALIDATION_FAILED');}
  }finally{database.close();}
}
