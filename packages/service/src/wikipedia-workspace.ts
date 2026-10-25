import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { ServiceError } from '../../contracts/src/index.ts';
import type { WikipediaAdoptRequest, WikipediaCollectRequest, WikipediaInspection, WikipediaJob, WikipediaJobPage, WikipediaMappingPreview, WikipediaPreviewRequest, WikipediaIssuesRequest, WikipediaIssuesPage } from '../../contracts/src/wikipedia-types.ts';
import { validWikipediaSelection, validWikipediaTitle } from '../../contracts/src/wikipedia-validation.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { fetchWikipediaTablePage, WIKIPEDIA_API, WIKIPEDIA_TABLE_ADAPTER, type WikipediaTableSnapshot } from '../../ingestion/src/mediawiki-tables.ts';
import { inspectWikipediaTables, mapWikipediaProfile, WIKIPEDIA_PROFILES, WIKIPEDIA_PROFILE_VERSION, wikipediaHash as hash } from '../../ingestion/src/wikipedia-profiles.ts';
import type { AcquisitionReceipt, JsonValue, SourceIssue, SourceRecordSnapshot, SourceResult } from '../../ingestion/src/source-types.ts';
import { createKnowledgeImports, knowledgeArtifactHash } from './knowledge-imports.ts';
import { parseKnowledgeImportArtifact, previewKnowledgeCollectionFile } from './knowledge-collection-files.ts';
import { knowledgeSourceHeader } from './knowledge-display.ts';

const DIRECTORY='wikipedia-workspace',idPattern=/^[a-f0-9]{64}$/;
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const missing=(e:unknown)=>record(e)&&e.code==='ENOENT';
const title=(value:string)=>value.trim().replaceAll('_',' ').replace(/ +/g,' ').normalize('NFC');
export class WikipediaWorkspaceFailure extends Error{readonly detail:ServiceError;constructor(code:ServiceError['code'],reason?:string){super(code);this.detail={code,...(reason?{parameters:{reason}}:{})};}}
const fail=(code:ServiceError['code']='VALIDATION_FAILED',reason='wikipedia-checkpoint-invalid'):never=>{throw new WikipediaWorkspaceFailure(code,reason);};
type Request={schemaVersion:1;id:string;title:string;revision?:number;createdAt:string};
type Resolved={schemaVersion:1;metadata:JsonValue;selectedRevision:number;retrievedAt:string;requestUrl:string};
type Envelope<T>={schemaVersion:1;hash:string;value:T};
const envelope=<T>(value:T):Envelope<T>=>({schemaVersion:1,hash:hash(value),value});
async function directory(name:string,create=false){if(create)await mkdir(name,{recursive:true,mode:0o700});const s=await lstat(name);if(!s.isDirectory()||s.isSymbolicLink())fail();}
async function read(name:string,optional=false):Promise<any>{try{const h=await open(name,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();if(!s.isFile()||s.size>32*1024*1024)fail();const parsed=JSON.parse(await h.readFile('utf8'));if(!record(parsed)||parsed.schemaVersion!==1||parsed.hash!==hash(parsed.value))fail();return parsed.value;}finally{await h.close();}}catch(e){if(optional&&missing(e))return;if(e instanceof SyntaxError)return fail();throw e;}}
async function save(name:string,value:unknown){
  await directory(path.dirname(name),true);const temporary=name+'.'+randomUUID()+'.tmp';
  try{const h=await open(temporary,'wx',0o600);try{const body=canonicalJson(envelope(value))+'\n';if(Buffer.byteLength(body)>32*1024*1024)fail('VALIDATION_FAILED','wikipedia-record-too-large');await h.writeFile(body);await h.sync();}finally{await h.close();}try{await link(temporary,name);}catch(e){if(record(e)&&e.code==='EEXIST'){if(hash(await read(name))!==hash(value))fail('CONFLICT','wikipedia-immutable-record');return;}throw e;}const parent=await open(path.dirname(name),'r');try{await parent.sync();}finally{await parent.close();}}finally{await rm(temporary,{force:true});}
}
function page(resolved:Resolved){const query=(resolved.metadata as any)?.query,pages=query?.pages;if(!Array.isArray(pages)||pages.length!==1)return fail();const p=pages[0];if(!record(p)||!Number.isSafeInteger(p.pageid)||p.pageid<1||typeof p.title!=='string'||!Number.isSafeInteger(resolved.selectedRevision)||resolved.selectedRevision<1)fail();return p;}
function rights(resolved:Resolved):SourceRecordSnapshot['rights']{
  const info=(resolved.metadata as any)?.query?.rightsinfo,url=typeof info?.url==='string'?info.url.replace(/^\/\//,'https://'):'';
  return /^https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/?$/.test(url)?{redistribution:'allowed',licenseId:'CC-BY-SA-4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'}:{redistribution:'unknown'};
}
const safeApi=(input:string|URL)=>{const u=new URL(input);if(u.origin!=='https://en.wikipedia.org'||u.pathname!=='/w/api.php'||u.username||u.password||u.hash)throw Error('INVALID_WIKIPEDIA_HOST');return u;};
const cleanIssue=(issue:SourceIssue):SourceIssue=>({code:issue.code,retryable:issue.retryable,...(issue.status===undefined?{}:{status:issue.status}),...(issue.providerCode?{providerCode:issue.providerCode}:{}),...(issue.retryAfterMs===undefined?{}:{retryAfterMs:issue.retryAfterMs})});
function validateRequest(value:any,id:string):Request{if(!record(value)||value.schemaVersion!==1||value.id!==id||!validWikipediaTitle(value.title)||value.title!==title(value.title)||value.revision!==undefined&&(!Number.isSafeInteger(value.revision)||value.revision<1)||!Number.isFinite(Date.parse(value.createdAt)))return fail();return value as Request;}
function validateResolved(value:any,request:Request):Resolved{const p=page(value);safeApi(value.requestUrl);if(value.schemaVersion!==1||!Number.isFinite(Date.parse(value.retrievedAt))||request.revision!==undefined&&value.selectedRevision!==request.revision||request.revision===undefined&&p.revisions?.[0]?.revid!==value.selectedRevision)return fail();return value as Resolved;}
function validateSnapshot(source:any,pin:Resolved):WikipediaTableSnapshot{
  const p=page(pin),raw=source?.raw,expected=rights(pin);
  if(!record(source)||source.identity?.provider!=='wikipedia-en'||source.identity.externalId!==String(p.pageid)||source.sourceRevision!==String(pin.selectedRevision)||raw?.title!==p.title||raw?.pageid!==p.pageid||String(raw?.revid)!==source.sourceRevision||hash(raw)!==source.contentHash||source.rights?.redistribution!==expected.redistribution||source.rights?.licenseId!==expected.licenseId||source.rights?.licenseUrl!==expected.licenseUrl||source.adapterVersion!==WIKIPEDIA_TABLE_ADAPTER||source.mediaType!=='application/json'||!Number.isFinite(Date.parse(source.retrievedAt))||!['current-page','fixed-revision'].includes(source.retrievalMode))return fail();
  try{const url=new URL(source.url),fixed=new URL(source.revisionUrl);if(url.origin!=='https://en.wikipedia.org'||url.username||url.password||!url.pathname.startsWith('/wiki/')||fixed.origin!=='https://en.wikipedia.org'||fixed.pathname!=='/w/index.php'||fixed.username||fixed.password||fixed.searchParams.get('oldid')!==String(pin.selectedRevision))return fail();}catch{return fail();}
  if(typeof raw.text!=='string'||Buffer.byteLength(raw.text)>8*1024*1024)return fail();return source as WikipediaTableSnapshot;
}
function artifactMatchesSource(artifact:ReturnType<typeof parseKnowledgeImportArtifact>,source:WikipediaTableSnapshot):boolean{
  const sourceId=`wikipedia-en:${source.identity.externalId}@${source.contentHash}`;const plan:unknown=artifact.projection?.plan;
  const expected={id:sourceId,identity:source.identity,revision:source.sourceRevision,contentHash:source.contentHash,retrievedAt:source.retrievedAt,url:source.url,revisionUrl:source.revisionUrl,adapterVersion:source.adapterVersion,rights:source.rights};
  const upstream=artifact.collection.sources.find(value=>value.id===sourceId);
  return !!upstream&&hash(upstream)===hash(expected)&&record(plan)&&record(plan.source)&&hash(plan.source)===hash({identity:source.identity,revision:source.sourceRevision,contentHash:source.contentHash})&&!!artifact.projection?.sourcePins.some(value=>value.sourceId===sourceId&&value.contentHash===source.contentHash&&value.revision===source.sourceRevision);
}
function validateReceipt(value:any,request:Request,source?:WikipediaTableSnapshot):AcquisitionReceipt{
  const codes=['INVALID_REQUEST','NETWORK_FAILED','HTTP_ERROR','RATE_LIMITED','UPSTREAM_BUSY','API_ERROR','INVALID_RESPONSE','RESPONSE_TOO_LARGE','RECORD_MISSING','CANCELLED','STAGING_FAILED','CHECKPOINT_INVALID'];
  if(!record(value)||value.id!==request.id||value.adapter!=='english-wikipedia-fixed-page-v1'||value.startedAt!==request.createdAt||!Number.isFinite(Date.parse(value.completedAt))||!['complete','failed','partial','cancelled'].includes(value.status)||!Array.isArray(value.issues)||value.issues.some((i:any)=>!record(i)||!codes.includes(i.code)||typeof i.retryable!=='boolean')||hash(value.requested)!==hash([{provider:'wikipedia-en-title',externalId:request.title}])||!Array.isArray(value.snapshots)||value.snapshots.length>1||value.snapshots.some((s:any)=>!source||s.contentHash!==source.contentHash||s.sourceRevision!==source.sourceRevision||s.identity?.externalId!==source.identity.externalId)||value.status==='complete'&&value.snapshots.length!==1)return fail();return value as AcquisitionReceipt;
}

/** One fixed-host archive and the existing paired importer share the ordinary repository authority. */
export async function createWikipediaWorkspace(options:{dataDirectory:string;repository:EditorialRepository;imports:ReturnType<typeof createKnowledgeImports>;fetch?:typeof fetch;now?:()=>Date}){
  const root=path.join(options.dataDirectory,DIRECTORY);await directory(root,true);
  const now=()=> (options.now?.()??new Date()).toISOString();
  const transport:typeof fetch=async(input,init)=>{const url=safeApi(typeof input==='string'||input instanceof URL?input:input.url);const response=await(options.fetch??fetch)(url,{...init,redirect:'error'});if(response.redirected)throw Error('INVALID_WIKIPEDIA_REDIRECT');if(response.url)safeApi(response.url);return response;};
  async function requested(id:string):Promise<Request>{if(!idPattern.test(id))fail('INVALID_REQUEST');try{await directory(path.join(root,id));}catch(e){if(missing(e))return fail('NOT_FOUND');throw e;}return validateRequest(await read(path.join(root,id,'request.json')),id);}
  async function resolved(id:string,r:Request):Promise<Resolved|undefined>{const value=await read(path.join(root,id,'resolved.json'),true);return value?validateResolved(value,r):undefined;}
  async function snapshot(id:string,r:Request):Promise<WikipediaTableSnapshot|undefined>{const source=await read(path.join(root,id,'snapshot.json'),true);if(!source)return;const pin=await resolved(id,r);if(!pin)return fail();return validateSnapshot(source,pin);}
  async function summary(id:string):Promise<WikipediaJob>{
    const r=await requested(id),source=await snapshot(id,r),attempts=await readdir(path.join(root,id));const receipts=attempts.filter(n=>/^attempt-[a-f0-9]{64}\.json$/.test(n)).sort();let receipt:AcquisitionReceipt={id,adapter:'english-wikipedia-fixed-page-v1',startedAt:r.createdAt,completedAt:r.createdAt,status:'partial',requested:[{provider:'wikipedia-en-title',externalId:r.title}],snapshots:[],issues:[]};
    for(const name of receipts){const attempt=validateReceipt(await read(path.join(root,id,name)),r,source);if(attempt.completedAt>=receipt.completedAt)receipt=attempt;}
    if(source){if(receipt.snapshots.some(s=>s.contentHash!==source.contentHash||s.sourceRevision!==source.sourceRevision))fail();receipt={...receipt,status:'complete',issues:[],snapshots:[{requestedIdentity:{provider:'wikipedia-en-title',externalId:r.title},identity:source.identity,sourceRevision:source.sourceRevision,contentHash:source.contentHash,retrievedAt:source.retrievedAt,file:'snapshot.json'}]};}
    return{id,requested:{title:r.title,...(r.revision===undefined?{}:{revision:r.revision})},receipt,...(source?{source:{pageId:source.identity.externalId,title:String((source.raw as any).title),revision:source.sourceRevision!,contentHash:source.contentHash,retrievedAt:source.retrievedAt,url:source.revisionUrl??source.url,rights:source.rights}}:{})};
  }
  async function acquireMetadata(r:Request,signal?:AbortSignal):Promise<SourceResult<Resolved>>{
    const url=new URL(WIKIPEDIA_API);for(const[key,value]of Object.entries({action:'query',titles:r.title,redirects:'1',prop:'info|revisions',rvprop:'ids',meta:'siteinfo',siprop:'rightsinfo',format:'json',formatversion:'2',maxlag:'5'}))url.searchParams.set(key,value);
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try{const response=await transport(url,{signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]),headers:{Accept:'application/json','User-Agent':'GitWorld/0.1 source-ingestion (https://github.com/samar1tan/GitWorld)'}});
      if(!response.ok){await response.body?.cancel();return{ok:false,error:{code:response.status===429?'RATE_LIMITED':'HTTP_ERROR',status:response.status,retryable:[429,502,503,504].includes(response.status),...(/^\d+$/.test(response.headers.get('retry-after')??'')?{retryAfterMs:Number(response.headers.get('retry-after'))*1000}:{})}};}
      if(!response.body||Number(response.headers.get('content-length'))>512*1024){await response.body?.cancel();return{ok:false,error:{code:'RESPONSE_TOO_LARGE',retryable:false}};}
      reader=response.body.getReader();const parts:Uint8Array[]=[];let bytes=0;for(;;){const p=await reader.read();if(p.done)break;if((bytes+=p.value.byteLength)>512*1024)return{ok:false,error:{code:'RESPONSE_TOO_LARGE',retryable:false}};parts.push(p.value);}
      let metadata:any;try{metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{return{ok:false,error:{code:'INVALID_RESPONSE',retryable:false}};}if(!record(metadata))return{ok:false,error:{code:'INVALID_RESPONSE',retryable:false}};
      if(metadata.error){const code=metadata.error.code;return{ok:false,error:{code:code==='maxlag'?'UPSTREAM_BUSY':code==='ratelimited'?'RATE_LIMITED':'API_ERROR',providerCode:String(code),retryable:['maxlag','ratelimited','readonly'].includes(code)}};}
      const p=metadata.query?.pages?.[0];if(!p||p.missing||p.invalid||!Number.isSafeInteger(p.pageid)||p.pageid<1||!Number.isSafeInteger(p.revisions?.[0]?.revid)||p.revisions[0].revid<1||typeof p.title!=='string')return{ok:false,error:{code:'RECORD_MISSING',retryable:false}};
      const result:Resolved={schemaVersion:1,metadata,selectedRevision:r.revision??p.revisions[0].revid,retrievedAt:now(),requestUrl:String(url)};page(result);return{ok:true,value:result};
    }catch{return{ok:false,error:{code:signal?.aborted?'CANCELLED':'NETWORK_FAILED',retryable:true}};}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  }
  const running=new Map<string,{signature:string;promise:Promise<WikipediaJob>}>();
  async function collect(input:WikipediaCollectRequest,signal?:AbortSignal):Promise<WikipediaJob>{
    if(!validWikipediaTitle(input.title)||typeof input.operationId!=='string'||!input.operationId||input.operationId.length>200||input.revision!==undefined&&(!Number.isSafeInteger(input.revision)||input.revision<1)||input.resumeJobId!==undefined&&!idPattern.test(input.resumeJobId))fail('INVALID_REQUEST');
    const id=input.resumeJobId??hash(input.operationId),signature=hash({title:title(input.title),revision:input.revision??null}),operationPath=path.join(root,'operations',hash(input.operationId)+'.json');
    await directory(path.join(root,'operations'),true);await save(operationPath,{schemaVersion:1,id,signature});
    const active=running.get(id);if(active){if(active.signature!==signature)fail('CONFLICT','different-wikipedia-request');return active.promise;}
    const task=(async()=>{
      await directory(path.join(root,id),true);const requestPath=path.join(root,id,'request.json');let r=await read(requestPath,true) as Request|undefined;
      if(r){if(r.title!==title(input.title)||r.revision!==input.revision)fail('CONFLICT','different-wikipedia-request');}else{r={schemaVersion:1,id,title:title(input.title),...(input.revision===undefined?{}:{revision:input.revision}),createdAt:now()};await save(requestPath,r);}
      if(await snapshot(id,r))return summary(id);
      let pin=await resolved(id,r),issue:SourceIssue|undefined;
      if(signal?.aborted)issue={code:'CANCELLED',retryable:true};
      if(!issue&&!pin){const result=await acquireMetadata(r,signal);if(result.ok){await save(path.join(root,id,'resolved.json'),result.value);pin=result.value;}else issue=result.error;}
      if(!issue&&pin){const result=await fetchWikipediaTablePage({title:page(pin).title,revision:pin.selectedRevision,signal},{fetch:transport,now:()=>new Date(now())});if(result.ok){if(result.value.identity.externalId!==String(page(pin).pageid)||String((result.value.raw as any).title)!==page(pin).title)issue={code:'INVALID_RESPONSE',retryable:false,providerCode:'revision-page-mismatch'};else{const inherited=rights(pin);const source:WikipediaTableSnapshot={...result.value,rights:{...inherited,attribution:result.value.rights.attribution},retrievalMode:r.revision===undefined?'current-page':'fixed-revision'};await save(path.join(root,id,'snapshot.json'),source);}}else issue=result.error;}
      const accepted=await snapshot(id,r);const receipt:AcquisitionReceipt={id,adapter:'english-wikipedia-fixed-page-v1',startedAt:r.createdAt,completedAt:now(),status:issue?(issue.code==='CANCELLED'?'cancelled':issue.retryable?'partial':'failed'):'complete',requested:[{provider:'wikipedia-en-title',externalId:r.title}],snapshots:accepted?[{requestedIdentity:{provider:'wikipedia-en-title',externalId:r.title},identity:accepted.identity,sourceRevision:accepted.sourceRevision,contentHash:accepted.contentHash,retrievedAt:accepted.retrievedAt,file:'snapshot.json'}]:[],issues:issue?[cleanIssue(issue)]:[]};
      await save(path.join(root,id,'attempt-'+hash([now(),randomUUID()])+'.json'),receipt);return summary(id);
    })().finally(()=>running.delete(id));running.set(id,{signature,promise:task});return task;
  }
  async function inspect(input:{jobId:string;offset?:number;limit?:number}):Promise<WikipediaInspection>{const r=await requested(input.jobId),source=await snapshot(input.jobId,r);if(!source)return fail('REVIEW_REQUIRED','wikipedia-source-incomplete');return{job:await summary(input.jobId),profiles:structuredClone(WIKIPEDIA_PROFILES),...inspectWikipediaTables(source,input.offset??0,input.limit??30)};}
  async function preview(input:WikipediaPreviewRequest):Promise<WikipediaMappingPreview>{
    if(!idPattern.test(input.jobId)||!idPattern.test(input.sourceHash)||!/^[a-f0-9]{40}$/.test(input.expectedHead)||!validWikipediaSelection(input.selection))fail('INVALID_REQUEST');
    const r=await requested(input.jobId),source=await snapshot(input.jobId,r);if(!source)return fail('REVIEW_REQUIRED','wikipedia-source-incomplete');if(source.contentHash!==input.sourceHash)fail('CONFLICT','wikipedia-source-changed');if((await options.repository.status()).head!==input.expectedHead)fail('HEAD_CHANGED');
    const pin=await resolved(input.jobId,r);if(!pin)return fail();const info=(pin.metadata as any)?.query?.rightsinfo,observation=record(info)?Object.fromEntries(['text','url'].filter(key=>typeof info[key]==='string').map(key=>[key,String(info[key]).slice(0,8000)])):null;
    const permissionEvidence={kind:'mediawiki-siteinfo-rightsinfo',metadataHash:hash(pin.metadata),observationHash:hash(info??null),observation,retrievedAt:pin.retrievedAt,requestUrl:pin.requestUrl};
    let mapped:ReturnType<typeof mapWikipediaProfile>;try{mapped=mapWikipediaProfile({...source,permissionEvidence},input.selection,input.expectedHead);}catch(e){if(e instanceof Error&&e.message==='WIKIPEDIA_HEADERS_CHANGED')return fail('CONFLICT','wikipedia-headers-changed');if(e instanceof Error&&e.message==='INVALID_WIKIPEDIA_PROFILE')return fail('INVALID_REQUEST','wikipedia-invalid-profile');return fail('VALIDATION_FAILED',e instanceof Error&&e.message==='WIKIPEDIA_TABLE_TOO_LARGE'?'wikipedia-table-too-large':'wikipedia-source-invalid');}
    let file:ReturnType<typeof previewKnowledgeCollectionFile>;try{file=previewKnowledgeCollectionFile({name:'wikipedia-mapping.json',text:canonicalJson(mapped.artifact)});}catch{return fail('VALIDATION_FAILED','wikipedia-preview-budget');}const prepared=await options.imports.preview(file);
    const assertions=mapped.artifact.collection.assertions.slice(0,30),objectIds=new Set(assertions.flatMap(a=>[a.subjectId,...(a.value.kind==='entity'?[a.value.objectId]:[])]));
    const result:WikipediaMappingPreview={jobId:input.jobId,sourceHash:input.sourceHash,selection:input.selection,profile:mapped.profile,plan:mapped.artifact.projection!.plan,sample:{objects:mapped.artifact.collection.objects.filter(o=>objectIds.has(o.id)).slice(0,40),assertions,sources:mapped.artifact.collection.sources.map(source=>knowledgeSourceHeader(source))},preview:prepared,counts:mapped.counts,exceptions:mapped.exceptions.slice(0,30),exceptionCount:mapped.exceptions.length};
    await save(path.join(root,input.jobId,'previews',prepared.prepared!.id+'.json'),{schemaVersion:1,result,artifact:mapped.artifact});return result;
  }
  async function issues(input:WikipediaIssuesRequest):Promise<WikipediaIssuesPage>{
    const offset=input.offset??0,limit=input.limit??30;
    if(!idPattern.test(input.jobId)||!idPattern.test(input.previewId)||!idPattern.test(input.expectedInputHash)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_REQUEST');
    const request=await requested(input.jobId),source=await snapshot(input.jobId,request);
    let saved:any;
    try{saved=await read(path.join(root,input.jobId,'previews',input.previewId+'.json'));}catch(error){if(missing(error))return fail('NOT_FOUND','wikipedia-preview-not-found');throw error;}
    if(!record(saved)||!record(saved.result)||!record(saved.artifact)||!Array.isArray(saved.result.exceptions))fail();
    const selected=options.imports.preparedPreview(input.previewId,input.expectedInputHash),artifact=selected.artifact,inputHash=selected.preview.inputHash,exceptions=artifact.projection?.exceptions;
    if(!exceptions)return fail('CONFLICT','wikipedia-preview-changed');
    if(!source||!artifactMatchesSource(artifact,source)||saved.result?.jobId!==input.jobId||saved.result.sourceHash!==source.contentHash||saved.result.preview?.prepared?.id!==input.previewId||hash(saved.artifact)!==hash(artifact)||hash(saved.result.preview)!==hash(selected.preview)||artifact.projection?.libraryRevision!==saved.result.preview.prepared.baseHead||saved.result.exceptionCount!==exceptions.length||hash(saved.result.exceptions)!==hash(exceptions.slice(0,30)))fail('CONFLICT','wikipedia-preview-changed');
    return{jobId:input.jobId,previewId:input.previewId,inputHash,reportHash:hash({jobId:input.jobId,previewId:input.previewId,inputHash,exceptions}),total:exceptions.length,offset,limit,issues:exceptions.slice(offset,offset+limit)};
  }
  return{collect,inspect,preview,issues,
    async jobs(input:{offset?:number;limit?:number}={}):Promise<WikipediaJobPage>{const entries=(await readdir(root,{withFileTypes:true})).filter(e=>idPattern.test(e.name));if(entries.length>10000)fail();const jobs:WikipediaJob[]=[],issues:WikipediaJobPage['issues']=[];for(const entry of entries.slice().sort((a,b)=>a.name.localeCompare(b.name)).slice(input.offset??0,(input.offset??0)+(input.limit??30))){try{jobs.push(await summary(entry.name));}catch{issues.push({jobId:entry.name,code:'CHECKPOINT_INVALID'});}}return{total:entries.length,jobs,issues};},
    async adopt(input:WikipediaAdoptRequest){if(!idPattern.test(input.jobId)||!idPattern.test(input.previewId))fail('INVALID_REQUEST');return options.imports.adopt({...input,fileToken:`wikipedia:${input.jobId}`},async()=>{const r=await requested(input.jobId),source=await snapshot(input.jobId,r);const saved=await read(path.join(root,input.jobId,'previews',input.previewId+'.json'));const artifact=parseKnowledgeImportArtifact(canonicalJson(saved.artifact));if(!source||!artifactMatchesSource(artifact,source)||saved.result?.jobId!==input.jobId||saved.result.sourceHash!==source.contentHash||saved.result.preview?.prepared?.id!==input.previewId||knowledgeArtifactHash(artifact)!==input.expectedInputHash)fail('CONFLICT','wikipedia-preview-changed');if(artifact.projection?.profileVersion!==WIKIPEDIA_PROFILE_VERSION)fail('REVIEW_REQUIRED','wikipedia-profile-version-changed');return previewKnowledgeCollectionFile({name:'wikipedia-mapping.json',text:canonicalJson(artifact)});});},
  };
}

/** Validate optional archive inputs without creating a store during complete backup restoration. */
export async function validateWikipediaWorkspaceDirectory(dataDirectory:string){
  const root=path.join(dataDirectory,DIRECTORY);try{await directory(root);}catch(e){if(missing(e))return;throw e;}
  const entries=await readdir(root,{withFileTypes:true});if(entries.length>10001)fail();let database:DatabaseSync|undefined;
  try{for(const entry of entries){await directory(path.join(root,entry.name));if(entry.name==='operations'){for(const operation of await readdir(path.join(root,entry.name))){if(!/^[a-f0-9]{64}\.json$/.test(operation))fail();const value=await read(path.join(root,entry.name,operation));if(!idPattern.test(value?.id)||!idPattern.test(value?.signature))fail();}continue;}if(!idPattern.test(entry.name))fail();
    const job=path.join(root,entry.name),request=validateRequest(await read(path.join(job,'request.json')),entry.name),rawPin=await read(path.join(job,'resolved.json'),true),pin=rawPin?validateResolved(rawPin,request):undefined,rawSource=await read(path.join(job,'snapshot.json'),true),source=rawSource?(pin?validateSnapshot(rawSource,pin):fail()):undefined;
    const contents=await readdir(job,{withFileTypes:true});if(contents.length>10000)fail();for(const item of contents){if(['request.json','resolved.json','snapshot.json'].includes(item.name))continue;if(/^attempt-[a-f0-9]{64}\.json$/.test(item.name)){validateReceipt(await read(path.join(job,item.name)),request,source);continue;}if(item.name!=='previews'||!item.isDirectory())fail();await directory(path.join(job,'previews'));const previews=await readdir(path.join(job,'previews'));if(previews.length>10000)fail();for(const name of previews){if(!/^[a-f0-9]{64}\.json$/.test(name))fail();const value=await read(path.join(job,'previews',name)),artifact=parseKnowledgeImportArtifact(canonicalJson(value.artifact));if(!source||!artifactMatchesSource(artifact,source)||value.result?.jobId!==entry.name||value.result?.sourceHash!==source.contentHash||value.result?.preview?.prepared?.id!==name.slice(0,-5)||value.result.preview.inputHash!==knowledgeArtifactHash(artifact)||!validWikipediaSelection(value.result.selection)||artifact.projection?.libraryRevision!==value.result.preview.prepared.baseHead)fail();
      database??=new DatabaseSync(path.join(dataDirectory,'knowledge-imports.sqlite'),{readOnly:true});const saved=database.prepare('SELECT body FROM previews WHERE id=?').get(name.slice(0,-5)) as {body:string}|undefined;if(!saved)fail();const preview=JSON.parse(saved!.body);if(hash(preview.artifact)!==hash(artifact)||hash(preview.preview)!==hash(value.result.preview))fail();
    }}
  }}finally{database?.close();}
}
