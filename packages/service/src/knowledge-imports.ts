import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { EditorialJson, EditorialRepository, EditorialWrite } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeFileImportRequest, KnowledgeFieldCatalog, KnowledgeImportContinuation, KnowledgeImportResult, KnowledgeMappingPreview, KnowledgeObjectBundle } from '../../contracts/src/knowledge-workspace-types.ts';
import type { KnowledgeImportArtifact, KnowledgePendingImport, KnowledgeResumeImportRequest } from '../../contracts/src/knowledge-import-types.ts';
import type { ServiceError } from '../../contracts/src/index.ts';
import { parseKnowledgeImportArtifact, type KnowledgeFilePreview } from './knowledge-collection-files.ts';
import { createKnowledgeStore } from './knowledge-store.ts';
import { planKnowledgeVocabulary, vocabularyBaselinePath, vocabularyHash as hash, vocabularyPath, vocabularySummary, vocabularySourcePath } from './knowledge-vocabulary.ts';
import { knowledgeCollectionFromTree } from './navigation-tree.ts';
import { APPEND_OBJECT_MERGE_VERSION, appendKnowledgeBundle } from './knowledge-append.ts';

const FILE='knowledge-imports.sqlite';
export class KnowledgeImportFailure extends Error {readonly detail:ServiceError;constructor(detail:ServiceError){super(detail.code);this.detail=detail;}}
const fail=(code:ServiceError['code'],reason?:string):never=>{throw new KnowledgeImportFailure({code,...(reason?{parameters:{reason}}:{})});};
type Preview={artifact:KnowledgeImportArtifact;fileHash:string;head:string;catalogHash:string;guards:Record<string,string|null>;preview:KnowledgeMappingPreview;objectMergeVersion?:typeof APPEND_OBJECT_MERGE_VERSION};
type ReviewReference={operationId:string;preparedHash:string};
type Prepared={previewId:string;head:string;catalogPaths:string[];changes:EditorialWrite[];guards:Record<string,string|null>;result:KnowledgeImportResult;review?:'unreviewed'|'adopted';supersedes?:ReviewReference[];objectMergeVersion?:typeof APPEND_OBJECT_MERGE_VERSION;appendBases?:Record<string,KnowledgeObjectBundle|null>;hash:string};
const metadata=(files:Record<string,EditorialJson>)=>Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('mappings/field-catalogs/')||name.startsWith('mappings/field-catalog-baselines/')));
export function knowledgeArtifactHash(artifact:KnowledgeImportArtifact){return hash({...artifact,fingerprintVersion:2,collection:{...artifact.collection,assertions:artifact.collection.assertions.map(value=>({...value,review:'unreviewed'}))}});}
const safePath=(name:string)=>/^(?:objects|sources)\/[a-f0-9]{64}\.json$/.test(name)||/^mappings\/(?:baseline-|conflict-)[a-f0-9]{64}\.json$/.test(name)||/^mappings\/field-catalog(?:s|-baselines)\/[a-f0-9]{64}\.json$/.test(name);
// The self-reference is excluded only from the preview record identifier.
const previewId=(value:Preview)=>hash({...value,preview:{...value.preview,prepared:{...value.preview.prepared,id:''}}});
const objectPath=(id:string)=>`objects/${hash(id)}.json`;
const baselinePath=(id:string)=>`mappings/baseline-${hash(id)}.json`;
const conflictPath=(id:string)=>`mappings/conflict-${hash(id)}.json`;
// Re-previewing after a resolution changes the library guard, not the reviewed source selection.
const selectionIdentity=(artifact:KnowledgeImportArtifact)=>knowledgeArtifactHash({...artifact,...(artifact.projection?{projection:{...artifact.projection,libraryRevision:'0'.repeat(40)}}:{})});
const reviewKey=(operationId:string,preparedHash:string)=>canonicalJson([operationId,preparedHash]);
const validContinuation=(value:KnowledgeImportContinuation)=>value?.kind==='wikipedia-mapping'&&typeof value.jobId==='string'&&/^[a-f0-9]{64}$/.test(value.jobId)&&Object.keys(value).length===2;
function validatePreparedPreview(prepared:Prepared,selected:Preview){
  if(prepared.head!==selected.head||hash(prepared.result.preview)!==hash(selected.preview))return fail('VALIDATION_FAILED');
  if(prepared.objectMergeVersion!==selected.objectMergeVersion)return fail('VALIDATION_FAILED');
  if(prepared.objectMergeVersion===APPEND_OBJECT_MERGE_VERSION){
    const bases=prepared.appendBases;
    if(!bases||hash(Object.keys(bases).sort())!==hash(selected.artifact.collection.objects.map(value=>value.id).sort()))return fail('VALIDATION_FAILED');
    for(const object of selected.artifact.collection.objects){const base=bases[object.id];if((base===null?null:hash(base))!==selected.guards[baselinePath(object.id)]||base!==null&&base.object.id!==object.id)return fail('VALIDATION_FAILED');}
  }else if(prepared.appendBases!==undefined)return fail('VALIDATION_FAILED');
  if(prepared.result.continuation!==undefined&&(!validContinuation(prepared.result.continuation)||!prepared.result.conflicts.length))return fail('VALIDATION_FAILED');
  if(Object.entries(selected.guards).some(([name,digest])=>prepared.guards[name]!==digest))return fail('VALIDATION_FAILED');
  const catalogPaths=Object.entries(selected.guards).filter(([name,digest])=>digest!==null&&(name.startsWith('mappings/field-catalogs/')||name.startsWith('mappings/field-catalog-baselines/'))).map(([name])=>name).sort();
  if(hash([...prepared.catalogPaths].sort())!==hash(catalogPaths)||prepared.result.paths!==undefined&&hash(prepared.result.paths)!==hash(prepared.changes.map(value=>value.path)))return fail('VALIDATION_FAILED');
  const bySubject=new Map<string,KnowledgeImportArtifact['collection']['assertions']>();
  for(const assertion of selected.artifact.collection.assertions){const values=bySubject.get(assertion.subjectId)??[];values.push(assertion);bySubject.set(assertion.subjectId,values);}
  if(!prepared.result.conflicts.length){
    const accepted=[...prepared.result.changedObjects,...prepared.result.unchangedObjects].sort();
    if(new Set(accepted).size!==accepted.length||hash(accepted)!==hash(selected.artifact.collection.objects.map(value=>value.id).sort()))return fail('VALIDATION_FAILED');
    if(prepared.objectMergeVersion===APPEND_OBJECT_MERGE_VERSION){
      const candidates=new Map<string,KnowledgeObjectBundle>();
      for(const object of selected.artifact.collection.objects){
        const incoming:KnowledgeObjectBundle={schemaVersion:1,object,assertions:(bySubject.get(object.id)??[]).map(value=>({...value,review:prepared.review??value.review}))};
        const expanded=appendKnowledgeBundle(prepared.appendBases![object.id],incoming).bundle;
        candidates.set(objectPath(object.id),expanded);candidates.set(baselinePath(object.id),expanded);
      }
      const writes=new Map(prepared.changes.map(value=>[value.path,value.value]));
      for(const id of prepared.result.changedObjects)for(const name of [objectPath(id),baselinePath(id)])if(!writes.has(name)||hash(writes.get(name))!==hash(candidates.get(name)))return fail('VALIDATION_FAILED');
      for(const change of prepared.changes)if(change.path.startsWith('objects/')||change.path.startsWith('mappings/baseline-')){const expected=candidates.get(change.path);if(!expected||hash(expected)!==hash(change.value))return fail('VALIDATION_FAILED');}
      if(prepared.changes.some(value=>value.path.startsWith('mappings/conflict-')))return fail('VALIDATION_FAILED');
    }
    return;
  }
  if(prepared.result.changedObjects.length||prepared.result.unchangedObjects.length||prepared.result.objects?.length||prepared.result.totalObjects) return fail('VALIDATION_FAILED');
  if(prepared.result.conflicts.some(value=>value.continuation!==undefined))return fail('VALIDATION_FAILED');
  const objects=new Map(selected.artifact.collection.objects.map(value=>[value.id,value]));
  const sources=new Map(selected.artifact.collection.sources.map(value=>[vocabularySourcePath(value.id),value]));
  const conflicts=new Map(prepared.result.conflicts.map(value=>[conflictPath(value.objectId),value]));
  const changes=new Map(prepared.changes.map(value=>[value.path,value.value]));
  if(conflicts.size!==prepared.result.conflicts.length)return fail('VALIDATION_FAILED');
  for(const conflict of conflicts.values()){
    const object=objects.get(conflict.objectId),base=conflict.base,local=conflict.local;
    if(!object||!local||hash(local)!==selected.guards[objectPath(conflict.objectId)]||(base===null?null:hash(base))!==selected.guards[baselinePath(conflict.objectId)])return fail('VALIDATION_FAILED');
    const expanded=appendKnowledgeBundle(base,{schemaVersion:1,object,assertions:(bySubject.get(object.id)??[]).map(assertion=>({...assertion,review:prepared.review??assertion.review}))},prepared.objectMergeVersion??1),incoming=expanded.bundle;
    if(hash(incoming)!==hash(conflict.incoming)||hash(local)===hash(incoming)||!expanded.metadataConflict&&base!==null&&(hash(local)===hash(base)||hash(incoming)===hash(base)))return fail('VALIDATION_FAILED');
  }
  for(const change of prepared.changes){
    const expected=sources.get(change.path)??conflicts.get(change.path);
    if(!expected||hash(expected)!==hash(change.value)||!Object.hasOwn(prepared.guards,change.path))return fail('VALIDATION_FAILED');
  }
  for(const[name,value]of conflicts)if(!changes.has(name)||hash(changes.get(name))!==hash(value))return fail('VALIDATION_FAILED');
  for(const name of sources.keys())if(selected.guards[name]===null&&!changes.has(name))return fail('VALIDATION_FAILED');
}
function reviewPaths(prepared:Prepared,selected:Preview){
  const artifact=selected.artifact;
  return [...prepared.changes.map(value=>value.path),...artifact.collection.objects.flatMap(value=>[objectPath(value.id),baselinePath(value.id),conflictPath(value.id)]),...artifact.collection.sources.map(value=>vocabularySourcePath(value.id)),...(artifact.vocabulary?[vocabularyPath(artifact.vocabulary.id),vocabularyBaselinePath(artifact.vocabulary.id)]:[])];
}
function readPreview(id:string,text:string):Preview{
  if(text.length>64*1024*1024)return fail('VALIDATION_FAILED');const value=JSON.parse(text) as Preview;
  if(!value||value.objectMergeVersion!==undefined&&value.objectMergeVersion!==APPEND_OBJECT_MERGE_VERSION)return fail('VALIDATION_FAILED');
  if(previewId(value)!==id||value.preview.prepared?.id!==id||value.preview.prepared.baseHead!==value.head||value.preview.prepared.fingerprintVersion!==2||value.preview.inputHash!==knowledgeArtifactHash(parseKnowledgeImportArtifact(JSON.stringify(value.artifact)))||!/^[a-f0-9]{40}$/.test(value.head)||!/^[a-f0-9]{64}$/.test(value.fileHash)||!/^[a-f0-9]{64}$/.test(value.catalogHash)||Object.entries(value.guards).some(([name,digest])=>!safePath(name)||digest!==null&&!/^[a-f0-9]{64}$/.test(digest)))return fail('VALIDATION_FAILED');
  return value;
}
function readPrepared(text:string):Prepared{
  if(text.length>128*1024*1024)return fail('VALIDATION_FAILED');const value=JSON.parse(text) as Prepared;
  if(!value||value.objectMergeVersion!==undefined&&value.objectMergeVersion!==APPEND_OBJECT_MERGE_VERSION)return fail('VALIDATION_FAILED');
  if(!value||hash({...value,hash:''})!==value.hash||!/^[a-f0-9]{40}$/.test(value.head)||value.review!==undefined&&!['unreviewed','adopted'].includes(value.review)||!Array.isArray(value.catalogPaths)||!value.result||!Array.isArray(value.result.conflicts)||!Array.isArray(value.result.changedObjects)||!Array.isArray(value.result.unchangedObjects)||!Array.isArray(value.changes)||value.changes.length>40000||new Set(value.changes.map(change=>change.path)).size!==value.changes.length||value.changes.some(change=>!safePath(change.path)||Buffer.byteLength(canonicalJson(change.value))>16*1024*1024)||Object.entries(value.guards).some(([name,digest])=>!safePath(name)||digest!==null&&!/^[a-f0-9]{64}$/.test(digest)))return fail('VALIDATION_FAILED');
  if(value.supersedes!==undefined&&(!Array.isArray(value.supersedes)||value.supersedes.length>10000||value.result.conflicts.length||value.supersedes.some(ref=>!ref||typeof ref.operationId!=='string'||!ref.operationId||ref.operationId.length>200||typeof ref.preparedHash!=='string'||!/^[a-f0-9]{64}$/.test(ref.preparedHash)||Object.keys(ref).length!==2)||new Set(value.supersedes.map(ref=>ref.operationId)).size!==value.supersedes.length))return fail('VALIDATION_FAILED');
  return value;
}
function validateSupersedes(prepared:Prepared,selected:Preview,operation:(id:string)=>{prepared:string;result:string|null}|undefined,preview:(id:string)=>Preview){
  for(const ref of prepared.supersedes??[]){
    const row=operation(ref.operationId);if(!row||row.result===null)return fail('VALIDATION_FAILED');
    const reviewed=readPrepared(row.prepared),original=preview(reviewed.previewId);validatePreparedPreview(reviewed,original);
    if(!reviewed.result.conflicts.length||reviewed.hash!==ref.preparedHash||hash(JSON.parse(row.result))!==hash(reviewed.result)||selectionIdentity(original.artifact)!==selectionIdentity(selected.artifact))return fail('VALIDATION_FAILED');
  }
}

/** Immutable previews and a small durable write receipt; Git remains the content authority. */
export function createKnowledgeImports(repository:EditorialRepository,store:ReturnType<typeof createKnowledgeStore>,options:{dataDirectory:string;legacy?:KnowledgeFieldCatalog;onFault?:(point:'after-prepare'|'after-write'|'after-receipt')=>void|Promise<void>}){
  validateKnowledgeImportDirectory(options.dataDirectory);
  const database=new DatabaseSync(path.join(options.dataDirectory,FILE));
  try{database.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, signature TEXT NOT NULL, prepared TEXT NOT NULL, result TEXT)');}catch(error){database.close();throw error;}
  let tail:Promise<unknown>=Promise.resolve(),closed=false;
  function lookup(id:string){const row=database.prepare('SELECT body FROM previews WHERE id=?').get(id) as {body:string}|undefined;if(!row)return fail('NOT_FOUND');return readPreview(id,row.body);}
  const operation=(id:string)=>database.prepare('SELECT prepared,result FROM operations WHERE id=?').get(id) as {prepared:string;result:string|null}|undefined;
  function checked(prepared:Prepared){const selected=lookup(prepared.previewId);validatePreparedPreview(prepared,selected);validateSupersedes(prepared,selected,operation,lookup);return selected;}
  function priorReviews(selected:Preview):ReviewReference[]{
    const identity=selectionIdentity(selected.artifact),refs:ReviewReference[]=[];
    for(const row of database.prepare("SELECT id,prepared,result FROM operations WHERE result IS NOT NULL AND json_array_length(result,'$.conflicts')>0 ORDER BY id").all() as {id:string;prepared:string;result:string}[]){
      const prepared=readPrepared(row.prepared),original=checked(prepared);if(hash(JSON.parse(row.result))!==hash(prepared.result))return fail('VALIDATION_FAILED');
      if(selectionIdentity(original.artifact)===identity)refs.push({operationId:row.id,preparedHash:prepared.hash});
    }
    return refs;
  }
  function blockedPlans(){
    const rows=database.prepare("SELECT id,prepared,result FROM operations WHERE result IS NULL OR json_array_length(result,'$.conflicts')>0").all() as {id:string;prepared:string;result:string|null}[];
    const active=rows.map(row=>{const prepared=readPrepared(row.prepared),selected=checked(prepared);if(row.result!==null&&hash(JSON.parse(row.result))!==hash(prepared.result))return fail('VALIDATION_FAILED');return{id:row.id,prepared,selected,pending:row.result===null};});
    const completed=new Set<string>();
    if(active.some(value=>value.prepared.result.conflicts.length))for(const row of database.prepare("SELECT prepared,result FROM operations WHERE result IS NOT NULL AND json_array_length(result,'$.conflicts')=0").all() as {prepared:string;result:string}[]){
      const prepared=readPrepared(row.prepared);checked(prepared);if(hash(JSON.parse(row.result))!==hash(prepared.result))return fail('VALIDATION_FAILED');
      for(const ref of prepared.supersedes??[])completed.add(reviewKey(ref.operationId,ref.preparedHash));
    }
    return active.filter(value=>value.pending||value.prepared.result.conflicts.length&&!completed.has(reviewKey(value.id,value.prepared.hash)));
  }
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
    const value:Preview={artifact,fileHash:input.sha256,head:snapshot.head,catalogHash:hash(metadata(snapshot.files)),guards,objectMergeVersion:APPEND_OBJECT_MERGE_VERSION,preview:{...summary,inputHash,prepared:{id:'',fingerprintVersion:2,baseHead:snapshot.head},...(artifact.vocabulary?{vocabulary:vocabularySummary(artifact.vocabulary,catalog.conflicts)}:{})}};
    const id=previewId(value);value.preview.prepared!.id=id;
    database.prepare('INSERT OR IGNORE INTO previews(id,body) VALUES(?,?)').run(id,canonicalJson(value));
    return structuredClone(lookup(id).preview);
  }
  async function adopt(input:KnowledgeFileImportRequest,read:()=>Promise<KnowledgeFilePreview>,reviewContext?:KnowledgeImportContinuation):Promise<KnowledgeImportResult>{
    if(closed)return fail('SERVICE_UNAVAILABLE');const signature=hash(input);
    if(reviewContext!==undefined&&!validContinuation(reviewContext))return fail('INVALID_REQUEST');
    let row=database.prepare('SELECT signature,prepared,result FROM operations WHERE id=?').get(input.operationId) as {signature:string;prepared:string;result:string|null}|undefined;
    if(row&&row.signature!==signature)return fail('IDEMPOTENCY_CONFLICT');
    if(row?.result){const prepared=readPrepared(row.prepared),result=JSON.parse(row.result);checked(prepared);if(hash(result)!==hash(prepared.result))return fail('VALIDATION_FAILED');return result;}
    let prepared:Prepared;
    if(row){prepared=readPrepared(row.prepared);const selected=lookup(prepared.previewId);if(prepared.previewId!==input.previewId||prepared.head!==input.expectedHead||selected.preview.inputHash!==input.expectedInputHash||hash(prepared.result.preview)!==hash(selected.preview))return fail('VALIDATION_FAILED');}
    else{
      if(!input.previewId)return fail('REVIEW_REQUIRED','paired-preview-required');const selected=lookup(input.previewId);
      if(selected.objectMergeVersion!==APPEND_OBJECT_MERGE_VERSION)return fail('REVIEW_REQUIRED','import-preview-merge-version-changed');
      if(selected.head!==input.expectedHead||selected.preview.inputHash!==input.expectedInputHash)return fail('CONFLICT');
      const file=await read();if(file.sha256!==selected.fileHash||!file.artifact||knowledgeArtifactHash(file.artifact)!==input.expectedInputHash)return fail('CONFLICT','selected-file-changed');
      const snapshot=await repository.snapshot({from:'working',prefixes:['objects/','sources/','mappings/']});
      if(snapshot.head!==input.expectedHead)return fail('HEAD_CHANGED');
      if(hash(metadata(snapshot.files))!==selected.catalogHash)return fail('CONTENT_CHANGED');
      for(const[name,expected]of Object.entries(selected.guards))if((snapshot.files[name]===undefined?null:hash(snapshot.files[name]))!==expected)return fail('CONTENT_CHANGED');
      const catalog=planKnowledgeVocabulary(snapshot.files,selected.artifact,input.expectedInputHash,options.legacy);
      if(catalog.conflicts.length)throw new KnowledgeImportFailure({code:'CONFLICT',parameters:{reason:'vocabulary-conflict'},vocabularyConflicts:catalog.conflicts.slice(0,30)});
      const plan=await store.planAdoption({collection:selected.artifact.collection,mode:'append-observations',review:input.review,expectedHead:input.expectedHead,expectedInputHash:store.previewCollection(selected.artifact.collection).preview.inputHash});
      const complete=[...plan.changes.filter(change=>change.path.startsWith('sources/')),...catalog.changes,...plan.changes.filter(change=>!change.path.startsWith('sources/'))];
      const candidate={...snapshot.files,...Object.fromEntries(complete.map(change=>[change.path,change.value])),...Object.fromEntries(plan.result.conflicts.map(value=>[objectPath(value.objectId),value.incoming as unknown as EditorialJson]))};
      knowledgeCollectionFromTree(candidate);
      if(plan.result.conflicts.length&&!reviewContext)return fail('CONFLICT','paired-object-conflict');
      const reviewing=plan.result.conflicts.length>0,changes=reviewing?plan.changes.filter(change=>change.path.startsWith('sources/')||change.path.startsWith('mappings/conflict-')):complete;
      const result:KnowledgeImportResult={...plan.result,...(reviewing?{changedObjects:[],unchangedObjects:[],objects:[],totalObjects:0,continuation:structuredClone(reviewContext!),...(plan.result.batch?{batch:{...plan.result.batch,acceptedObjectSetHash:hash([])}}:{})}:{}),preview:selected.preview,paths:changes.map(change=>change.path)};
      const supersedes=reviewing?[]:priorReviews(selected);
      const appendBases=Object.fromEntries(selected.artifact.collection.objects.map(object=>[object.id,(snapshot.files[baselinePath(object.id)]??null) as unknown as KnowledgeObjectBundle|null]));
      prepared={previewId:input.previewId,head:input.expectedHead,catalogPaths:Object.keys(metadata(snapshot.files)),changes,guards:{...selected.guards,...catalog.guards,...plan.guards},result,review:input.review,objectMergeVersion:APPEND_OBJECT_MERGE_VERSION,appendBases,...(supersedes.length?{supersedes}:{}),hash:''};
      prepared.hash=hash(prepared);readPrepared(canonicalJson(prepared));checked(prepared);
      database.prepare('INSERT INTO operations(id,signature,prepared,result) VALUES(?,?,?,NULL)').run(input.operationId,signature,canonicalJson(prepared));await options.onFault?.('after-prepare');
    }
    return finish(prepared,input.operationId);
  }
  async function finish(prepared:Prepared,operationId:string):Promise<KnowledgeImportResult>{
    checked(prepared);
    const current=await repository.snapshot({from:'working',prefixes:['objects/','sources/','mappings/']});
    if(prepared.objectMergeVersion===undefined)await checkLegacyPending(prepared,current);
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
  async function checkLegacyPending(prepared:Prepared,current:Awaited<ReturnType<EditorialRepository['snapshot']>>){
    if(current.head!==prepared.head)return fail('HEAD_CHANGED');
    const selected=lookup(prepared.previewId),names=selected.artifact.collection.objects.map(object=>baselinePath(object.id));
    const bySubject=new Map<string,KnowledgeImportArtifact['collection']['assertions']>();
    for(const assertion of selected.artifact.collection.assertions){const values=bySubject.get(assertion.subjectId)??[];values.push(assertion);bySubject.set(assertion.subjectId,values);}
    const candidates=new Map<string,KnowledgeObjectBundle>();
    let committed:Record<string,EditorialJson>|undefined;
    for(const object of selected.artifact.collection.objects){
      const name=baselinePath(object.id),expected=selected.guards[name];let base=(current.files[name]??null) as unknown as KnowledgeObjectBundle|null;
      if((base===null?null:hash(base))!==expected){
        committed??=(await repository.snapshot({from:prepared.head,paths:names})).files;
        base=(committed[name]??null) as unknown as KnowledgeObjectBundle|null;
        if((base===null?null:hash(base))!==expected)return fail('REVIEW_REQUIRED','legacy-import-merge-unverifiable');
      }
      const incoming:KnowledgeObjectBundle={schemaVersion:1,object,assertions:(bySubject.get(object.id)??[]).map(value=>({...value,review:prepared.review??value.review}))};
      const legacy=appendKnowledgeBundle(base,incoming,1).bundle,expanded=appendKnowledgeBundle(base,incoming);
      if(hash(legacy)!==hash(expanded.bundle)||expanded.metadataConflict&&prepared.result.changedObjects.includes(object.id))return fail('REVIEW_REQUIRED','legacy-import-merge-review-required');
      candidates.set(objectPath(object.id),legacy);candidates.set(baselinePath(object.id),legacy);
    }
    for(const change of prepared.changes)if(change.path.startsWith('objects/')||change.path.startsWith('mappings/baseline-')){const candidate=candidates.get(change.path);if(!candidate||hash(candidate)!==hash(change.value))return fail('VALIDATION_FAILED');}
  }
  async function resume(input:KnowledgeResumeImportRequest):Promise<KnowledgeImportResult>{
    if(closed)return fail('SERVICE_UNAVAILABLE');
    const row=database.prepare('SELECT prepared,result FROM operations WHERE id=?').get(input.operationId) as {prepared:string;result:string|null}|undefined;
    if(!row)return fail('NOT_FOUND');
    const prepared=readPrepared(row.prepared);
    if(prepared.previewId!==input.previewId)return fail('CONFLICT','different-prepared-preview');
    checked(prepared);
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
    // Only a retained source workspace can reopen its exact mapping after conflict resolution.
    adopt:(input:KnowledgeFileImportRequest,read:()=>Promise<KnowledgeFilePreview>,options?:{reviewConflicts:KnowledgeImportContinuation})=>serial(()=>adopt(input,read,options?.reviewConflicts)),
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
        checked(prepared);if(hash(result)!==hash(prepared.result)||hash(selected.preview)!==hash(result.preview))return fail('VALIDATION_FAILED');
        return{operationId:row.id,method:'paired-import' as const,previewId:prepared.previewId,result,inputObjectIds:selected.artifact.collection.objects.map(object=>object.id),sources:selected.artifact.collection.sources};
      });
    },
    pendingPaths(){return [...new Set(blockedPlans().flatMap(({prepared,selected})=>prepared.result.conflicts.length?reviewPaths(prepared,selected):prepared.changes.map(change=>change.path)))];},
    annotateConflicts(conflicts:KnowledgeImportResult['conflicts']){
      const contexts=new Map<string,KnowledgeImportContinuation>();
      for(const {prepared}of blockedPlans())if(prepared.result.continuation)for(const value of prepared.result.conflicts)contexts.set(hash(value),prepared.result.continuation);
      return conflicts.map(value=>{const continuation=contexts.get(hash(value));return continuation?{...value,continuation:structuredClone(continuation)}:value;});
    },
    async close(){if(closed)return;await tail;closed=true;database.close();},
  };
}

/** Called on a backup candidate before directory exchange; opening is strictly read-only. */
export function validateKnowledgeImportDirectory(directory:string){
  const file=path.join(directory,FILE);if(!existsSync(file))return;
  const database=new DatabaseSync(file,{readOnly:true});try{
    const operation=(id:string)=>database.prepare('SELECT prepared,result FROM operations WHERE id=?').get(id) as {prepared:string;result:string|null}|undefined;
    const preview=(id:string)=>{const row=database.prepare('SELECT body FROM previews WHERE id=?').get(id) as {body:string}|undefined;if(!row)return fail('VALIDATION_FAILED');return readPreview(id,row.body);};
    for(const row of database.prepare('SELECT id,body FROM previews').iterate() as IterableIterator<{id:string;body:string}>)readPreview(row.id,row.body);
    for(const row of database.prepare('SELECT prepared,result FROM operations').iterate() as IterableIterator<{prepared:string;result:string|null}>){const prepared=readPrepared(row.prepared),selected=preview(prepared.previewId);validatePreparedPreview(prepared,selected);validateSupersedes(prepared,selected,operation,preview);if(row.result!==null&&hash(JSON.parse(row.result))!==hash(prepared.result))return fail('VALIDATION_FAILED');}
  }finally{database.close();}
}
