import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, isId, isRecord } from '../../domain/src/index.ts';
import type { KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { EditorialJson, EditorialRepository, EditorialWrite } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeImportResult } from '../../contracts/src/knowledge-workspace-types.ts';
import type { NavigationApplyRequest, NavigationApplyResult, NavigationBatchObject, NavigationBatchRef, NavigationBatchSummary, NavigationContextDefinition, NavigationImportMethod, NavigationMembership, NavigationMembershipCounts, NavigationMembershipPlan, NavigationMembershipPlanRequest, NavigationMembershipShard, NavigationPageRequest, NavigationPendingOperation, NavigationResumeResult, NavigationSaveRequest, NavigationSaveResult, NavigationSourceRef } from '../../contracts/src/navigation-types.ts';
import { navigationContentId, navigationHash, navigationOid, navigationPath, navigationRevision, validNavigationBatch } from '../../contracts/src/navigation-validation.ts';
import { knowledgeCollectionFromTree, navigationDefinitionPath, navigationDigest as hash, navigationMembershipPath, navigationObjectPath, navigationPartition, navigationSourcePath, readNavigationTree, validNavigationFile } from './navigation-tree.ts';
import { knowledgeSourceHeader } from './knowledge-display.ts';
import { SOURCE_PRESENTATIONS_PATH, readSourcePresentations } from './knowledge-source-presentations.ts';
import type { ServiceError } from '../../contracts/src/index.ts';

const FILE = 'navigation.sqlite';
const json = (value: unknown) => value as EditorialJson;
export class NavigationFailure extends Error { readonly detail: ServiceError; constructor(detail: ServiceError) { super(detail.code); this.detail = detail; } }
const fail = (code: ServiceError['code'], reason?: string): never => { throw new NavigationFailure({code,...(reason?{parameters:{reason}}:{})}); };
export type NavigationImportReceipt = { operationId: string; method: NavigationImportMethod; result: unknown; previewId?: string; inputObjectIds?: string[]; sources?: KnowledgeSource[] };
type Batch = { summary: NavigationBatchSummary; searchTerms: string[]; objects: NavigationBatchObject[]; sourcePins: NavigationSourceRef[]; sourceRefs: Record<string,NavigationSourceRef[]> };
type Plan = { summary: NavigationMembershipPlan; objects: NavigationBatchObject[]; changes: EditorialWrite[]; guards: Record<string,string|null>; contextPaths: string[]; basisHash: string; hash: string };
type Prepared = {
  kind: 'save' | 'membership'; head: string; contextId: string; contextPaths: string[];
  changes: EditorialWrite[]; guards: Record<string,string|null>; result: NavigationResumeResult; planId?: string; hash: string;
};
type Row = {signature:string;prepared:string;result:string|null};
const page = <T>(values: T[], request: NavigationPageRequest) => { const offset=request.offset??0,limit=request.limit??25;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)return fail('INVALID_REQUEST');return{items:structuredClone(values.slice(offset,offset+limit)),total:values.length,offset,limit}; };
const namespace = (files: Record<string,EditorialJson>, id: string) => Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith(`navigation/contexts/${hash(id)}/`)));
const sourceRef = (source: KnowledgeSource): NavigationSourceRef => ({sourceId:source.id,revision:source.revision,contentHash:source.contentHash});
const basisHash = (files: Record<string,EditorialJson>) => hash(Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('objects/') || name.startsWith('sources/'))));
const fileHash = (files: Record<string,EditorialJson>, name: string) => files[name] === undefined ? null : hash(files[name]);
const safeGuard = (name: string) => navigationPath(name) || /^(?:objects|sources)\/[a-f0-9]{64}\.json$/.test(name);
const emptyJournal=(database:DatabaseSync)=>Number(Object.values(database.prepare('PRAGMA user_version').get()!)[0])===0&&(database.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all()).length===0;
const exactKeys=(value:object,names:string[])=>Object.keys(value).every(key=>names.includes(key));
const validCounts=(value:unknown):value is NavigationMembershipCounts=>isRecord(value)&&exactKeys(value,['selected','already','added','removed','unchanged'])&&['selected','already','added','removed','unchanged'].every(key=>Number.isSafeInteger(value[key])&&Number(value[key])>=0)&&Number(value.already)<=Number(value.selected)&&Number(value.added)+Number(value.removed)+Number(value.unchanged)===Number(value.selected);

function validateWrites(changes: EditorialWrite[], guards: Record<string,string|null>) {
  if (!Array.isArray(changes) || changes.length>40000 || new Set(changes.map(change=>change.path)).size!==changes.length || !isRecord(guards)) return fail('VALIDATION_FAILED');
  for (const change of changes) if (!navigationPath(change.path) || change.value !== null && (!validNavigationFile(change.path,change.value) || Buffer.byteLength(canonicalJson(change.value))>16*1024*1024) || !Object.hasOwn(guards,change.path)) return fail('VALIDATION_FAILED');
  if (Object.entries(guards).some(([name,digest]) => !safeGuard(name) || digest!==null&&!navigationHash(digest))) return fail('VALIDATION_FAILED');
}
function readPlan(id: string, body: string): Plan {
  if (Buffer.byteLength(body)>128*1024*1024) return fail('VALIDATION_FAILED');
  const value=JSON.parse(body) as Plan;
  if(!isRecord(value)||!exactKeys(value,['summary','objects','changes','guards','contextPaths','basisHash','hash'])||!isRecord(value.summary)||!exactKeys(value.summary,['planId','planHash','baseHead','contextId','contextHash','batch','objectSetHash','counts','mode','dependencies','paths'])||!navigationContentId(value.summary.contextId)||!validCounts(value.summary.counts)||!['add','remove'].includes(value.summary.mode)||!Array.isArray(value.summary.paths)||!Array.isArray(value.summary.dependencies)||value.summary.dependencies.some(name=>!safeGuard(name))||!Array.isArray(value.objects)||value.summary.counts.selected!==value.objects.length)return fail('VALIDATION_FAILED');
  let prior='';for(const object of value.objects){if(!object||!navigationContentId(object.id)||object.id<=prior||!['direct','related'].includes(object.basis)||!isRecord(object.labels)||Object.values(object.labels).some(label=>typeof label!=='string'))return fail('VALIDATION_FAILED');prior=object.id;}
  if (!value || value.hash!==id || hash({...value,hash:'',summary:{...value.summary,planId:'',planHash:''}})!==id || value.summary.planId!==id || value.summary.planHash!==id || !navigationOid(value.summary.baseHead) || !navigationHash(value.summary.contextHash) || !navigationHash(value.basisHash) || !validNavigationBatch(value.summary.batch) || !Array.isArray(value.objects) || value.summary.objectSetHash!==hash(value.objects.map(object=>object.id)) || value.summary.objectSetHash!==value.summary.batch.objectSetHash || !Array.isArray(value.contextPaths) || value.contextPaths.some(name=>!navigationPath(name))) return fail('VALIDATION_FAILED');
  validateWrites(value.changes,value.guards);
  if(hash(value.summary.paths)!==hash(value.changes.map(change=>change.path).sort())||value.changes.some(change=>!change.path.startsWith(`navigation/contexts/${hash(value.summary.contextId)}/`))||value.contextPaths.some(name=>!name.startsWith(`navigation/contexts/${hash(value.summary.contextId)}/`)))return fail('VALIDATION_FAILED');
  return value;
}
function readPrepared(body: string): Prepared {
  if (Buffer.byteLength(body)>128*1024*1024) return fail('VALIDATION_FAILED');
  const value=JSON.parse(body) as Prepared;
  if(!isRecord(value)||!exactKeys(value,['kind','head','contextId','contextPaths','changes','guards','result','planId','hash'])||!isRecord(value.result)||!isRecord(value.result.result)||!exactKeys(value.result,['kind','result']))return fail('VALIDATION_FAILED');
  if (!value || hash({...value,hash:''})!==value.hash || !navigationOid(value.head) || !navigationContentId(value.contextId) || !['save','membership'].includes(value.kind) || value.result.kind!==value.kind || value.result.result.contextId!==value.contextId || value.result.result.head!==value.head || !Array.isArray(value.contextPaths) || value.contextPaths.some(name=>!navigationPath(name)) || value.kind==='membership'&&(!navigationHash(value.planId)||value.result.kind!=='membership'||value.result.result.planId!==value.planId)) return fail('VALIDATION_FAILED');
  validateWrites(value.changes,value.guards);
  if(!Array.isArray(value.result.result.paths)||hash(value.result.result.paths)!==hash(value.changes.map(change=>change.path).sort())||value.changes.some(change=>!change.path.startsWith(`navigation/contexts/${hash(value.contextId)}/`))||value.contextPaths.some(name=>!name.startsWith(`navigation/contexts/${hash(value.contextId)}/`)))return fail('VALIDATION_FAILED');
  if(value.result.kind==='save'){if(!exactKeys(value.result.result,['contextId','contentHash','head','paths'])||!navigationHash(value.result.result.contentHash)||value.planId!==undefined)return fail('VALIDATION_FAILED');const definition=value.changes.find(change=>change.path===navigationDefinitionPath(value.contextId));if(definition&&hash(definition.value)!==value.result.result.contentHash)return fail('VALIDATION_FAILED');}
  else if(value.result.kind!=='membership'||!exactKeys(value.result.result,['contextId','head','paths','counts','planId'])||!validCounts(value.result.result.counts))return fail('VALIDATION_FAILED');
  return value;
}
function checkJournal(database: DatabaseSync) {
  if (Number(Object.values(database.prepare('PRAGMA user_version').get()!)[0])!==1) return fail('VALIDATION_FAILED','navigation-schema');
  const schema=database.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string;sql:string}[];
  if(hash(schema)!==hash([{name:'operations',sql:'CREATE TABLE operations(id TEXT PRIMARY KEY,signature TEXT NOT NULL,prepared TEXT NOT NULL,result TEXT)'},{name:'plans',sql:'CREATE TABLE plans(id TEXT PRIMARY KEY,body TEXT NOT NULL)'}]))return fail('VALIDATION_FAILED','navigation-schema');
  for (const row of database.prepare('SELECT id,body FROM plans').iterate() as IterableIterator<{id:string;body:string}>) readPlan(row.id,row.body);
  for (const row of database.prepare('SELECT id,signature,prepared,result FROM operations').iterate() as IterableIterator<Row&{id:string}>) {
    if (!isId(row.id)||!navigationHash(row.signature)) return fail('VALIDATION_FAILED');
    const prepared=readPrepared(row.prepared);
    if (prepared.planId) {const plan=database.prepare('SELECT body FROM plans WHERE id=?').get(prepared.planId) as {body:string}|undefined;if(!plan)return fail('VALIDATION_FAILED');const checked=readPlan(prepared.planId,plan.body);if(hash(checked.changes)!==hash(prepared.changes)||hash(checked.guards)!==hash(prepared.guards)||hash(checked.contextPaths)!==hash(prepared.contextPaths)||checked.summary.contextId!==prepared.contextId||checked.summary.baseHead!==prepared.head||prepared.result.kind!=='membership'||hash(checked.summary.counts)!==hash(prepared.result.result.counts))return fail('VALIDATION_FAILED');}
    if (row.result!==null&&hash(JSON.parse(row.result))!==hash(prepared.result)) return fail('VALIDATION_FAILED');
  }
  if(Number((database.prepare('SELECT count(*) AS count FROM operations WHERE result IS NULL').get() as {count:number}).count)>1)return fail('VALIDATION_FAILED');
}

/** Contexts are modern organization metadata; their journal never changes a facts-import receipt. */
export function createNavigationContexts(repository: EditorialRepository, options: {
  dataDirectory: string; imports: () => Promise<NavigationImportReceipt[]>;
  onFault?: (point: 'after-prepare' | 'after-write' | 'after-receipt') => void | Promise<void>;
}) {
  const file=path.join(options.dataDirectory,FILE);
  if(existsSync(file)){const check=new DatabaseSync(file,{readOnly:true});try{if(!emptyJournal(check))checkJournal(check);}finally{check.close();}}
  const database=new DatabaseSync(file);
  try {database.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,signature TEXT NOT NULL,prepared TEXT NOT NULL,result TEXT); PRAGMA user_version=1; COMMIT');}catch(error){try{database.exec('ROLLBACK');}catch{/* A failed initialization cannot leave a partially installed schema. */}database.close();throw error;}
  let closed=false,closing=false,writeGeneration=0,tail:Promise<unknown>=Promise.resolve();
  function serial<T>(task:()=>Promise<T>){if(closed||closing)return Promise.reject(new NavigationFailure({code:'SERVICE_UNAVAILABLE'}));const value=tail.then(task);tail=value.catch(()=>undefined);return value;}
  const lookup = (id: string) => {const row=database.prepare('SELECT body FROM plans WHERE id=?').get(id) as {body:string}|undefined;if(!row)return fail('NOT_FOUND');return readPlan(id,row.body);};
  const pendingRows = () => database.prepare('SELECT id,prepared FROM operations WHERE result IS NULL ORDER BY id').all() as {id:string;prepared:string}[];
  function requireReady(){if(pendingRows().length)return fail('REVIEW_REQUIRED','navigation-operation-pending');}
  async function readReady<T>(revision:string|undefined,read:()=>Promise<T>):Promise<T>{
    if(revision!==undefined&&revision!=='working')return read();
    requireReady();const generation=writeGeneration;
    try{return await read();}
    finally{
      requireReady();
      // Recovery may clear pending while this read still holds a partial snapshot.
      if(generation!==writeGeneration)return fail('CONTENT_CHANGED','navigation-read-changed');
    }
  }
  async function snapshot(revision='working') {
    if (!navigationRevision(revision)) return fail('INVALID_REQUEST');
    const current=await repository.snapshot({from:revision,prefixes:['objects/','sources/','navigation/',SOURCE_PRESENTATIONS_PATH]});
    return{...current,collection:knowledgeCollectionFromTree(current.files),navigation:readNavigationTree(current.files),sourcePresentations:new Map(readSourcePresentations(current.files).map(value=>[value.sourceId,value]))};
  }
  async function batches(current: Awaited<ReturnType<typeof snapshot>>): Promise<Batch[]> {
    const objects=new Map(current.collection.objects.map(object=>[object.id,object])),sources=new Map(current.collection.sources.map(source=>[source.id,source]));
    const bySubject=new Map<string,typeof current.collection.assertions>();for(const assertion of current.collection.assertions){const claims=bySubject.get(assertion.subjectId)??[];claims.push(assertion);bySubject.set(assertion.subjectId,claims);}
    function presentation(values:KnowledgeSource[],fallback:string){
      const headers=values.map(source=>knowledgeSourceHeader(source,current.sourcePresentations.get(source.id))),providers=[...new Set(values.map(source=>source.identity.provider))].sort();
      const labels=headers.find(header=>header.labels)?.labels??headers.find(header=>header.title)?.title??{en:providers[0]??fallback};
      return {labels,providers:providers.slice(0,30),searchTerms:[...providers,...headers.flatMap(header=>[...Object.values(header.labels??{}),...Object.values(header.title??{})])].map(value=>value.normalize('NFKC').toLocaleLowerCase())};
    }
    const result:Batch[]=[],rows=await options.imports(),paired=new Set(rows.filter(row=>row.method==='paired-import').map(row=>row.operationId));
    for(const row of rows){
      if(row.method!=='paired-import'&&paired.has(row.operationId))continue;
      const value=row.result as KnowledgeImportResult;
      if(!isId(row.operationId)||!value||!value.preview||!navigationHash(value.preview.inputHash)||!Array.isArray(value.changedObjects)||!Array.isArray(value.unchangedObjects)||!Array.isArray(value.conflicts)||![...value.changedObjects,...value.unchangedObjects].every(navigationContentId))return fail('VALIDATION_FAILED');
      const accepted=[...new Set([...value.changedObjects,...value.unchangedObjects])].sort(),conflicts=value.conflicts.map(conflict=>conflict.objectId),partition=[...value.changedObjects,...value.unchangedObjects,...conflicts];
      const manifest=value.batch;
      if(manifest&&(!isRecord(manifest)||manifest.schemaVersion!==1||!navigationHash(manifest.inputObjectSetHash)||!navigationHash(manifest.acceptedObjectSetHash)||!Array.isArray(manifest.sourceRefs)||manifest.sourceRefs.some(ref=>!navigationContentId(ref.sourceId)||!(ref.revision===null||typeof ref.revision==='string')||!navigationContentId(ref.contentHash))))return fail('VALIDATION_FAILED');
      const incomplete=new Set(partition).size!==partition.length||value.preview.objects!==partition.length||row.inputObjectIds!==undefined&&hash([...row.inputObjectIds].sort())!==hash([...partition].sort())||manifest!==undefined&&(manifest.inputObjectSetHash!==hash([...partition].sort())||manifest.acceptedObjectSetHash!==hash(accepted)||row.sources!==undefined&&hash(manifest.sourceRefs)!==hash(row.sources.map(sourceRef)));
      const batch:NavigationBatchRef={kind:'adopted-import',operationId:row.operationId,method:row.method,inputHash:value.preview.inputHash,objectSetHash:hash(accepted),...((row.previewId??value.preview.prepared?.id)?{previewId:row.previewId??value.preview.prepared!.id}:{})};
      const refs=row.sources?.map(sourceRef)??manifest?.sourceRefs??[],pins=refs.map(ref=>sources.get(ref.sourceId)).filter((source):source is KnowledgeSource=>!!source),pinIds=new Set(refs.map(ref=>ref.sourceId));
      const missing=accepted.some(id=>!objects.has(id)),missingSources=refs.some(ref=>sources.get(ref.sourceId)?.contentHash!==ref.contentHash||sources.get(ref.sourceId)?.revision!==ref.revision);
      const reason=incomplete?'incomplete-import-result':conflicts.length?'import-conflicts':missing?'missing-objects':missingSources?'incomplete-import-result':row.sources===undefined&&manifest===undefined?'import-origin-unavailable':undefined;
      const originalSources=row.sources??refs.flatMap(ref=>{const source=sources.get(ref.sourceId);return source&&ref.revision===source.revision&&ref.contentHash===source.contentHash?[source]:[];});
      const {labels,providers,searchTerms}=presentation(originalSources,row.method);
      const sourceRefs=Object.fromEntries(accepted.map(id=>[id,((bySubject.get(id)??[]).flatMap(assertion=>[assertion.sourceSnapshotId,...assertion.evidence.map(evidence=>evidence.sourceId)]))]));
      result.push({summary:{batchKey:hash(batch),batch,labels,providers,sourceRefs:structuredClone(refs.slice(0,30)),sourceRefCount:refs.length,objects:accepted.length,directObjects:accepted.length,relatedObjects:0,unresolvedObjects:conflicts.length,status:reason?'unavailable':'complete',...(reason?{reason}:{})},searchTerms,objects:accepted.map(id=>({id,labels:objects.get(id)?.labels??{},basis:'direct'})),sourcePins:refs,sourceRefs:Object.fromEntries(Object.entries(sourceRefs).map(([id,ids])=>[id,[...new Set(ids)].filter(sourceId=>pinIds.has(sourceId)).map(sourceId=>sources.get(sourceId)!).filter(Boolean).map(sourceRef)]))});
    }
    const bySource=new Map<string,typeof current.collection.assertions>();
    for(const assertion of current.collection.assertions)for(const id of new Set([assertion.sourceSnapshotId,...assertion.evidence.map(value=>value.sourceId)])){const claims=bySource.get(id)??[];claims.push(assertion);bySource.set(id,claims);}
    for(const [sourceId,claims]of bySource){const source=sources.get(sourceId);if(!source)return fail('VALIDATION_FAILED');
      const subjects=new Set(claims.map(claim=>claim.subjectId));
      for(const selection of ['source-claim-subjects','subjects-and-referenced-objects'] as const){
        const related=new Set<string>();if(selection==='subjects-and-referenced-objects')for(const claim of claims)for(const value of [claim.value,...claim.qualifiers.map(item=>item.value)])if(value.kind==='entity'&&objects.has(value.objectId)&&!subjects.has(value.objectId))related.add(value.objectId);
        const ids=[...subjects,...related].sort(),selectionHash=hash({selection,source,claims,objectIds:ids});
        const batch:NavigationBatchRef={kind:'saved-source',selection,revision:current.source,sourceId,sourceRevision:source.revision,sourceHash:hash(source),selectionHash,objectSetHash:hash(ids)};
        const {labels,providers,searchTerms}=presentation([source],source.identity.provider);
        result.push({summary:{batchKey:hash(batch),batch,labels,providers,sourceRefs:[sourceRef(source)],sourceRefCount:1,objects:ids.length,directObjects:subjects.size,relatedObjects:related.size,unresolvedObjects:0,status:'complete'},searchTerms,objects:ids.map(id=>({id,labels:objects.get(id)!.labels,basis:subjects.has(id)?'direct':'related'})),sourcePins:[sourceRef(source)],sourceRefs:Object.fromEntries(ids.map(id=>[id,[sourceRef(source)]]))});
      }
    }
    const rank=(value:Batch)=>value.summary.batch.kind==='adopted-import'?(value.summary.status==='complete'?0:1):2;
    return result.sort((a,b)=>rank(a)-rank(b)||(a.summary.batchKey<b.summary.batchKey?-1:1));
  }
  async function resolveBatch(batch:NavigationBatchRef,current:Awaited<ReturnType<typeof snapshot>>) {
    const selected=batch.kind==='saved-source'&&batch.revision!==current.source?await snapshot(batch.revision):current;
    const found=(await batches(selected)).find(value=>hash(value.summary.batch)===hash(batch));
    if(!found)return fail('CONTENT_CHANGED','navigation-batch-changed');
    if(found.summary.status!=='complete')return fail('REVIEW_REQUIRED',found.summary.reason);
    if(found.objects.some(object=>current.files[navigationObjectPath(object.id)]===undefined)||found.sourcePins.some(ref=>{const source=current.files[navigationSourcePath(ref.sourceId)] as unknown as KnowledgeSource;return !source||source.contentHash!==ref.contentHash||source.revision!==ref.revision;}))return fail('CONTENT_CHANGED','navigation-batch-changed');
    return found;
  }
  async function finish(operationId:string,prepared:Prepared):Promise<NavigationResumeResult> {
    const current=await repository.snapshot({from:'working',prefixes:['objects/','sources/','navigation/']});
    const matches=(change:EditorialWrite)=>hash(current.files[change.path]??null)===hash(change.value);
    if(!prepared.changes.every(matches)){
      if(current.head!==prepared.head)return fail('HEAD_CHANGED');
      const allowed=new Set([...prepared.contextPaths,...prepared.changes.map(change=>change.path)]);
      if(Object.keys(namespace(current.files,prepared.contextId)).some(name=>!allowed.has(name)))return fail('CONTENT_CHANGED');
      const guards={...prepared.guards};
      for(const change of prepared.changes){const digest=fileHash(current.files,change.path);if(matches(change))guards[change.path]=digest;else if(digest!==prepared.guards[change.path])return fail('CONTENT_CHANGED');}
      for(const[name,digest]of Object.entries(guards))if(fileHash(current.files,name)!==digest)return fail('CONTENT_CHANGED');
      const overlay={...current.files};for(const change of prepared.changes){if(change.value===null)delete overlay[change.path];else overlay[change.path]=change.value;}
      knowledgeCollectionFromTree(overlay);readNavigationTree(overlay);
      if(prepared.planId){const plan=lookup(prepared.planId);if(basisHash(current.files)!==plan.basisHash)return fail('CONTENT_CHANGED','navigation-batch-changed');}
      const changes=prepared.changes.filter(change=>!matches(change));if(changes.length)await repository.write(changes,{expectedHead:prepared.head,expectedContentHashes:guards});
      await options.onFault?.('after-write');
      const after=await repository.snapshot({from:'working',paths:prepared.changes.map(change=>change.path)});if(prepared.changes.some(change=>hash(after.files[change.path]??null)!==hash(change.value)))return fail('CONTENT_CHANGED');
    }
    database.prepare('UPDATE operations SET result=? WHERE id=?').run(canonicalJson(prepared.result),operationId);await options.onFault?.('after-receipt');return structuredClone(prepared.result);
  }
  async function operation(operationId:string,signature:string,prepare:()=>Promise<Prepared>):Promise<NavigationResumeResult>{
    const row=database.prepare('SELECT signature,prepared,result FROM operations WHERE id=?').get(operationId) as Row|undefined;
    if(row&&row.signature!==signature)return fail('IDEMPOTENCY_CONFLICT');
    if(row?.result){const prepared=readPrepared(row.prepared),result=JSON.parse(row.result);if(hash(result)!==hash(prepared.result))return fail('VALIDATION_FAILED');return result;}
    let prepared:Prepared;if(row)prepared=readPrepared(row.prepared);else{requireReady();prepared=await prepare();prepared.hash=hash({...prepared,hash:''});readPrepared(canonicalJson(prepared));database.prepare('INSERT INTO operations(id,signature,prepared,result) VALUES(?,?,?,NULL)').run(operationId,signature,canonicalJson(prepared));writeGeneration++;await options.onFault?.('after-prepare');}
    return finish(operationId,prepared);
  }
  async function save(input:NavigationSaveRequest):Promise<NavigationSaveResult>{
    const result=await operation(input.operationId,hash({kind:'save',input}),async()=>{
      const current=await snapshot();if(current.head!==input.expectedHead)return fail('HEAD_CHANGED');
      const contextId=input.contextId??`context:${randomUUID()}`,name=navigationDefinitionPath(contextId),before=current.navigation.definitions.get(contextId);
      if((before?.contentHash??null)!==input.expectedContentHash)return fail('CONTENT_CHANGED');
      const definition:NavigationContextDefinition={schemaVersion:1,id:contextId,labels:structuredClone(input.labels),...(input.description?{description:structuredClone(input.description)}:{}),origin:before?.definition.origin??'user-organization',...(before?.definition.profile?{profile:structuredClone(before.definition.profile)}:{})};
      const changes:EditorialWrite[]=before?.contentHash===hash(definition)?[]:[{path:name,value:json(definition)}];
      return{kind:'save',head:current.head,contextId,contextPaths:Object.keys(namespace(current.files,contextId)),changes,guards:{[name]:before?.contentHash??null},result:{kind:'save',result:{contextId,contentHash:hash(definition),head:current.head,paths:changes.map(change=>change.path)}},hash:''};
    });
    if(result.kind!=='save')return fail('VALIDATION_FAILED');return result.result;
  }
  async function membershipPlan(input:NavigationMembershipPlanRequest):Promise<NavigationMembershipPlan>{
    requireReady();const current=await snapshot();if(current.head!==input.expectedHead)return fail('HEAD_CHANGED');
    const context=current.navigation.definitions.get(input.contextId);if(!context)return fail('NOT_FOUND');if(context.contentHash!==input.expectedDefinitionHash)return fail('CONTENT_CHANGED');
    const batch=await resolveBatch(input.batch,current),members=current.navigation.members.get(input.contextId)!,next=new Map(members),recordedAt=new Date().toISOString();
    const counts:NavigationMembershipCounts={selected:batch.objects.length,already:batch.objects.filter(object=>members.has(object.id)).length,added:0,removed:0,unchanged:0};
    for(const object of batch.objects){if(input.mode==='remove'){if(next.delete(object.id))counts.removed++;else counts.unchanged++;}else if(next.has(object.id))counts.unchanged++;else{counts.added++;next.set(object.id,{contextId:input.contextId,objectId:object.id,decision:{kind:'manual',recordedAt,...(input.rationale?{rationale:input.rationale}:{})},batchRef:structuredClone(input.batch),sourceRefs:batch.sourceRefs[object.id]});}}
    const partitions=new Set(batch.objects.map(object=>navigationPartition(object.id))),changes:EditorialWrite[]=[],guards:Record<string,string|null>={};
    for(const partition of partitions){const name=navigationMembershipPath(input.contextId,partition),values=[...next.values()].filter(member=>navigationPartition(member.objectId)===partition).sort((a,b)=>a.objectId<b.objectId?-1:1),value:NavigationMembershipShard|null=values.length?{schemaVersion:1,partitionVersion:1,contextId:input.contextId,partition,members:values}:null;
      if(hash(current.files[name]??null)!==hash(value))changes.push({path:name,value:json(value)});guards[name]=fileHash(current.files,name);
    }
    const support=new Set([context.path,...batch.objects.map(object=>navigationObjectPath(object.id)),...batch.sourcePins.map(ref=>navigationSourcePath(ref.sourceId))]);
    for(const name of [...Object.keys(namespace(current.files,input.contextId)),...support])guards[name]=fileHash(current.files,name);
    const summary:NavigationMembershipPlan={planId:'',planHash:'',baseHead:current.head,contextId:input.contextId,contextHash:current.navigation.contextHash(input.contextId),batch:structuredClone(input.batch),objectSetHash:input.batch.objectSetHash,counts,mode:input.mode,dependencies:[...support].sort(),paths:changes.map(change=>change.path).sort()};
    const plan:Plan={summary,objects:batch.objects,changes,guards,contextPaths:Object.keys(namespace(current.files,input.contextId)),basisHash:basisHash(current.files),hash:''};
    const id=hash(plan);plan.hash=id;plan.summary.planId=id;plan.summary.planHash=id;readPlan(id,canonicalJson(plan));database.prepare('INSERT OR IGNORE INTO plans(id,body) VALUES(?,?)').run(id,canonicalJson(plan));return structuredClone(plan.summary);
  }
  async function apply(input:NavigationApplyRequest):Promise<NavigationApplyResult>{
    const result=await operation(input.operationId,hash({kind:'membership',input}),async()=>{
      const plan=lookup(input.planId);if(plan.hash!==input.expectedPlanHash)return fail('CONFLICT','navigation-plan-changed');
      const current=await snapshot();if(current.head!==plan.summary.baseHead)return fail('HEAD_CHANGED');if(current.navigation.contextHash(plan.summary.contextId)!==plan.summary.contextHash)return fail('CONTENT_CHANGED');
      await resolveBatch(plan.summary.batch,current);if(basisHash(current.files)!==plan.basisHash)return fail('CONTENT_CHANGED','navigation-batch-changed');
      for(const[name,digest]of Object.entries(plan.guards))if(fileHash(current.files,name)!==digest)return fail('CONTENT_CHANGED');
      return{kind:'membership',head:plan.summary.baseHead,contextId:plan.summary.contextId,contextPaths:plan.contextPaths,changes:plan.changes,guards:plan.guards,planId:plan.summary.planId,result:{kind:'membership',result:{contextId:plan.summary.contextId,head:plan.summary.baseHead,paths:plan.summary.paths,counts:plan.summary.counts,planId:plan.summary.planId}},hash:''};
    });if(result.kind!=='membership')return fail('VALIDATION_FAILED');return result.result;
  }
  return {
    requireReady,readReady,
    list:(input:NavigationPageRequest&{revision?:string;text?:string})=>readReady(input.revision,async()=>{const current=await snapshot(input.revision),needle=input.text?.trim().normalize('NFKC').toLocaleLowerCase()??'';const items=[...current.navigation.definitions.values()].filter(({definition})=>!needle||[...Object.values(definition.labels),...Object.values(definition.description??{})].some(label=>label.normalize('NFKC').toLocaleLowerCase().includes(needle))).sort((a,b)=>a.definition.id<b.definition.id?-1:1).map(value=>({definition:value.definition,contentHash:value.contentHash,members:current.navigation.members.get(value.definition.id)!.size}));return{...page(items,input),revision:current.source,head:current.head,counts:{objects:current.collection.objects.length,assigned:current.navigation.assigned.size,unassigned:current.collection.objects.length-current.navigation.assigned.size}};}),
    get:(input:NavigationPageRequest&{contextId:string;revision?:string})=>readReady(input.revision,async()=>{const current=await snapshot(input.revision),found=current.navigation.definitions.get(input.contextId);if(!found)return fail('NOT_FOUND');const members=page([...current.navigation.members.get(input.contextId)!.values()].sort((a,b)=>a.objectId<b.objectId?-1:1),input);return{definition:structuredClone(found.definition),contentHash:found.contentHash,contextHash:current.navigation.contextHash(input.contextId),revision:current.source,head:current.head,members:members.items,total:members.total,offset:members.offset,limit:members.limit};}),
    batches:(input:NavigationPageRequest&{revision?:string;batchKey?:string;inputHash?:string;previewId?:string;text?:string;kind?:NavigationBatchRef['kind']})=>readReady(input.revision,async()=>{const current=await snapshot(input.revision),needle=input.text?.trim().normalize('NFKC').toLocaleLowerCase()??'';return{...page((await batches(current)).filter(value=>(input.batchKey===undefined||value.summary.batchKey===input.batchKey)&&(input.inputHash===undefined||value.summary.batch.kind==='adopted-import'&&value.summary.batch.inputHash===input.inputHash)&&(input.previewId===undefined||value.summary.batch.kind==='adopted-import'&&value.summary.batch.previewId===input.previewId)&&(input.kind===undefined||value.summary.batch.kind===input.kind)&&(!needle||value.searchTerms.some(term=>term.includes(needle)))).map(value=>value.summary),input),revision:current.source,head:current.head};}),
    batchObjects(input:NavigationPageRequest&{batch:NavigationBatchRef}){const revision=input.batch.kind==='saved-source'?input.batch.revision:'working';return readReady(revision,async()=>{const current=await snapshot(revision),found=await resolveBatch(input.batch,current);return{...page(found.objects,input),batch:structuredClone(input.batch),objectSetHash:input.batch.objectSetHash,directObjects:found.summary.directObjects,relatedObjects:found.summary.relatedObjects};});},
    batchSources(input:NavigationPageRequest&{batch:NavigationBatchRef}){const revision=input.batch.kind==='saved-source'?input.batch.revision:'working';return readReady(revision,async()=>{const current=await snapshot(revision),found=await resolveBatch(input.batch,current);return{...page(found.sourcePins,input),batch:structuredClone(input.batch)};});},
    save:(input:NavigationSaveRequest)=>serial(()=>save(input)),membershipPlan:(input:NavigationMembershipPlanRequest)=>serial(()=>membershipPlan(input)),
    plan(input:NavigationPageRequest&{planId:string}){const plan=lookup(input.planId);return{...structuredClone(plan.summary),...page(plan.objects,input)};},
    apply:(input:NavigationApplyRequest)=>serial(()=>apply(input)),
    pending():NavigationPendingOperation[]{return pendingRows().map(row=>{const prepared=readPrepared(row.prepared);return{operationId:row.id,kind:prepared.kind,baseHead:prepared.head,contextId:prepared.contextId,...(prepared.planId?{planId:prepared.planId}:{}),...(prepared.result.kind==='membership'?{counts:prepared.result.result.counts}:{})};});},
    pendingPaths(){return[...new Set(pendingRows().flatMap(row=>readPrepared(row.prepared).changes.map(change=>change.path)))];},
    resume:(operationId:string)=>serial(async()=>{const row=database.prepare('SELECT signature,prepared,result FROM operations WHERE id=?').get(operationId) as Row|undefined;if(!row)return fail('NOT_FOUND');const prepared=readPrepared(row.prepared);if(row.result!==null){const result=JSON.parse(row.result);if(hash(result)!==hash(prepared.result))return fail('VALIDATION_FAILED');return result as NavigationResumeResult;}return finish(operationId,prepared);}),
    async close(){if(closed)return;closing=true;await tail;if(closed)return;closed=true;database.close();},
  };
}

/** Read-only candidate validation: baseline/expected checks precede validation of the completed overlay. */
export async function validateNavigationDirectory(directory:string,repository:EditorialRepository) {
  const file=path.join(directory,FILE),current=await repository.snapshot({from:'working',prefixes:['objects/','sources/','navigation/',SOURCE_PRESENTATIONS_PATH]});
  const staged=await repository.snapshot({from:'staged',prefixes:['objects/','sources/','navigation/',SOURCE_PRESENTATIONS_PATH]});
  let database:DatabaseSync|undefined;
  try {
    if(existsSync(file)){database=new DatabaseSync(file,{readOnly:true});checkJournal(database);}
    const overlay={...current.files};
    if(database)for(const row of database.prepare('SELECT prepared FROM operations WHERE result IS NULL').iterate() as IterableIterator<{prepared:string}>){
      const prepared=readPrepared(row.prepared),allowed=new Set([...prepared.contextPaths,...prepared.changes.map(change=>change.path)]);
      if(Object.keys(namespace(current.files,prepared.contextId)).some(name=>!allowed.has(name)))return fail('VALIDATION_FAILED');
      const changes=new Map(prepared.changes.map(change=>[change.path,change.value]));
      for(const[name,digest]of Object.entries(prepared.guards)){const actual=fileHash(current.files,name);if(actual!==digest&&(!changes.has(name)||hash(current.files[name]??null)!==hash(changes.get(name))))return fail('VALIDATION_FAILED');}
      const complete=prepared.changes.every(change=>hash(current.files[change.path]??null)===hash(change.value));
      if(!complete&&current.head!==prepared.head)return fail('VALIDATION_FAILED');
      if(!complete&&prepared.planId){const row=database.prepare('SELECT body FROM plans WHERE id=?').get(prepared.planId) as {body:string};if(basisHash(current.files)!==readPlan(prepared.planId,row.body).basisHash)return fail('VALIDATION_FAILED');}
      for(const change of prepared.changes){if(change.value===null)delete overlay[change.path];else overlay[change.path]=change.value;}
    }
    knowledgeCollectionFromTree(overlay);readNavigationTree(overlay);
    knowledgeCollectionFromTree(staged.files);readNavigationTree(staged.files);
  } finally {database?.close();}
}
