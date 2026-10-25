import { createHash } from 'node:crypto';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex, KNOWLEDGE_NAVIGATION_ROLES, type KnowledgeCollection, type KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeObjectBundle } from '../../contracts/src/knowledge-workspace-types.ts';
import type { NavigationBootstrap, NavigationChangeSummary, NavigationContextDefinition, NavigationMembership, NavigationMembershipShard } from '../../contracts/src/navigation-types.ts';
import { navigationPath, validNavigationDefinition, validNavigationShard } from '../../contracts/src/navigation-validation.ts';

export const navigationDigest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const navigationDefinitionPath = (id: string) => `navigation/contexts/${navigationDigest(id)}/definition.json`;
export const navigationPartition = (objectId: string) => navigationDigest(objectId).slice(0,2);
export const navigationMembershipPath = (id: string, partition: string) => `navigation/contexts/${navigationDigest(id)}/members/${partition}.json`;
export const navigationObjectPath = (id: string) => `objects/${navigationDigest(id)}.json`;
export const navigationSourcePath = (id: string) => `sources/${navigationDigest(id)}.json`;
const invalid = (): never => { throw new Error('VALIDATION_FAILED'); };

export function validNavigationFile(name: string, value: unknown): boolean {
  if (!navigationPath(name)) return false;
  if (name.endsWith('/definition.json')) return validNavigationDefinition(value) && name === navigationDefinitionPath(value.id);
  return validNavigationShard(value) && name === navigationMembershipPath(value.contextId,value.partition) && value.members.every(member => navigationPartition(member.objectId) === value.partition);
}

export function parseNavigationBootstrap(text:string):NavigationBootstrap {
  if(Buffer.byteLength(text)>8*1024*1024)return invalid();let value:any;try{value=JSON.parse(text);}catch{return invalid();}
  if(!value||value.schemaVersion!==1||Object.keys(value).some(key=>!['schemaVersion','definitions','memberships','typeRoles'].includes(key))||!Array.isArray(value.definitions)||!Array.isArray(value.memberships)||value.definitions.length>10000||value.memberships.length>100000||value.definitions.some((definition:any)=>!validNavigationDefinition(definition)||definition.origin!=='source-profile')||new Set(value.definitions.map((definition:any)=>definition.id)).size!==value.definitions.length)return invalid();
  if(value.typeRoles!==undefined&&(!Array.isArray(value.typeRoles)||value.typeRoles.length>10000||value.typeRoles.some((item:any)=>!item||Object.keys(item).some(key=>!['typeId','role'].includes(key))||typeof item.typeId!=='string'||!item.typeId||item.typeId.length>300||!KNOWLEDGE_NAVIGATION_ROLES.includes(item.role))||new Set(value.typeRoles.map((item:any)=>item.typeId)).size!==value.typeRoles.length))return invalid();
  const definitions=new Map<string,NavigationContextDefinition>(value.definitions.map((definition:NavigationContextDefinition)=>[definition.id,definition]));
  const seen=new Set<string>();
  for(const member of value.memberships){const definition=definitions.get(member?.contextId),key=canonicalJson([member?.contextId??null,member?.objectId??null]);if(!definition||seen.has(key)||Object.hasOwn(member,'batchRef')||member.decision?.kind!=='profile'||canonicalJson(member.decision?.profile??null)!==canonicalJson(definition.profile??null)||!Array.isArray(member.sourceRefs)||!member.sourceRefs.length)return invalid();seen.add(key);const synthetic={...member,batchRef:{kind:'trusted-bundle',bundleId:'validation',manifestHash:'0'.repeat(64),objectSetHash:'0'.repeat(64)}};const shard={schemaVersion:1,partitionVersion:1,contextId:member.contextId,partition:'00',members:[synthetic]};if(!validNavigationShard(shard))return invalid();}
  return value;
}

export function navigationBootstrapSeedFiles(input:NavigationBootstrap,bundle:{id:string;manifestHash:string},prospective:Record<string,EditorialJson>):Record<string,EditorialJson> {
  const value=parseNavigationBootstrap(canonicalJson(input)),files:Record<string,EditorialJson>={};
  const batchRef={kind:'trusted-bundle' as const,bundleId:bundle.id,manifestHash:bundle.manifestHash,objectSetHash:navigationDigest([...new Set(value.memberships.map(member=>member.objectId))].sort())};
  const shards=new Map<string,NavigationMembershipShard>();
  for(const definition of value.definitions)files[navigationDefinitionPath(definition.id)]=definition as unknown as EditorialJson;
  for(const member of value.memberships){const partition=navigationPartition(member.objectId),name=navigationMembershipPath(member.contextId,partition),shard=shards.get(name)??{schemaVersion:1,partitionVersion:1,contextId:member.contextId,partition,members:[]};shard.members.push({...structuredClone(member),batchRef});shards.set(name,shard);}
  for(const[name,shard]of shards){shard.members.sort((a,b)=>a.objectId<b.objectId?-1:1);files[name]=shard as unknown as EditorialJson;}
  knowledgeCollectionFromTree(prospective);readNavigationTree({...prospective,...files});return files;
}

/** The caller supplies one Git snapshot; no second HEAD or working read can enter this view. */
export function knowledgeCollectionFromTree(files: Record<string,EditorialJson>): KnowledgeCollection {
  const collection: KnowledgeCollection = {schemaVersion:1,objects:[],assertions:[],sources:[]};
  for (const [name,value] of Object.entries(files)) {
    if (name.startsWith('objects/')) {
      const bundle = value as unknown as KnowledgeObjectBundle;
      if (!bundle || bundle.schemaVersion !== 1 || !bundle.object || !Array.isArray(bundle.assertions) || name !== navigationObjectPath(bundle.object.id) || bundle.assertions.some(assertion => assertion.subjectId !== bundle.object.id)) return invalid();
      collection.objects.push(bundle.object); collection.assertions.push(...bundle.assertions);
    } else if (name.startsWith('sources/')) {
      const source = value as unknown as KnowledgeSource;
      if (!source || name !== navigationSourcePath(source.id)) return invalid();
      collection.sources.push(source);
    }
  }
  createKnowledgeIndex(collection);
  return collection;
}

export function readNavigationTree(files: Record<string,EditorialJson>) {
  const definitions = new Map<string,{definition:NavigationContextDefinition;contentHash:string;path:string}>();
  const shards = new Map<string,NavigationMembershipShard>();
  for (const [name,value] of Object.entries(files)) {
    if (!name.startsWith('navigation/')) continue;
    if (!validNavigationFile(name,value)) return invalid();
    if (name.endsWith('/definition.json')) {
      const definition = value as unknown as NavigationContextDefinition;
      if (definitions.has(definition.id)) return invalid();
      definitions.set(definition.id,{definition,contentHash:navigationDigest(definition),path:name});
    } else shards.set(name,value as unknown as NavigationMembershipShard);
  }
  const members = new Map<string,Map<string,NavigationMembership>>([...definitions.keys()].map(id => [id,new Map()]));
  const assigned = new Set<string>();
  for (const shard of shards.values()) {
    const context = members.get(shard.contextId); if (!context) return invalid();
    for (const member of shard.members) {
      const object = files[navigationObjectPath(member.objectId)] as unknown as KnowledgeObjectBundle;
      if (!object || object.object?.id !== member.objectId || context.has(member.objectId)) return invalid();
      for (const ref of member.sourceRefs ?? []) {
        const source = files[navigationSourcePath(ref.sourceId)] as unknown as KnowledgeSource;
        if (!source || source.id !== ref.sourceId || source.contentHash !== ref.contentHash || source.revision !== ref.revision) return invalid();
      }
      if (member.batchRef.kind === 'saved-source') {
        const source = files[navigationSourcePath(member.batchRef.sourceId)] as unknown as KnowledgeSource;
        if (!source || source.id !== member.batchRef.sourceId || navigationDigest(source) !== member.batchRef.sourceHash || source.revision !== member.batchRef.sourceRevision) return invalid();
      }
      context.set(member.objectId,member); assigned.add(member.objectId);
    }
  }
  return {
    definitions,shards,members,assigned,
    contextHash(id: string) {
      const values = Object.entries(files).filter(([name]) => name.startsWith(`navigation/contexts/${navigationDigest(id)}/`)).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
      return navigationDigest(Object.fromEntries(values));
    },
    queryMemberships: new Map([...members].map(([id,values]) => [id,new Set(values.keys())])),
  };
}

/** Existing staged support is sufficient; unrelated working edits never force a dependency refresh. */
export function navigationDependencies(working: Record<string,EditorialJson>, staged: Record<string,EditorialJson>, paths: string[]) {
  const selected = new Set(paths), required = new Set<string>(), missing = new Set<string>();
  for (const name of paths) {
    if (!name.startsWith('navigation/') || working[name] === undefined) continue;
    if (!validNavigationFile(name,working[name])) return invalid();
    if (name.endsWith('/definition.json')) continue;
    const shard = working[name] as unknown as NavigationMembershipShard;
    const dependencies = new Set([navigationDefinitionPath(shard.contextId)]);
    for (const member of shard.members) {
      dependencies.add(navigationObjectPath(member.objectId));
      for (const ref of member.sourceRefs ?? []) dependencies.add(navigationSourcePath(ref.sourceId));
      if (member.batchRef.kind === 'saved-source') dependencies.add(navigationSourcePath(member.batchRef.sourceId));
    }
    for (const dependency of dependencies) {
      if (selected.has(dependency)) { if (working[dependency] === undefined) missing.add(dependency); continue; }
      if (staged[dependency] !== undefined) continue;
      if (working[dependency] === undefined) missing.add(dependency); else required.add(dependency);
    }
  }
  return {selected:[...selected],required:[...required].sort(),missing:[...missing].sort()};
}

export function navigationChangeSummary(name:string,before:EditorialJson|null,after:EditorialJson|null,definition?:EditorialJson):NavigationChangeSummary|undefined {
  if(!name.startsWith('navigation/'))return;
  for(const value of [before,after])if(value!==null&&!validNavigationFile(name,value))return invalid();
  if(name.endsWith('/definition.json')){
    const a=before as unknown as NavigationContextDefinition|null,b=after as unknown as NavigationContextDefinition|null;
    return{kind:'context-definition',contextId:(b??a)!.id,...(a?{beforeLabels:a.labels}:{}),...(b?{afterLabels:b.labels}:{}),fields:['labels','description','origin','profile'].filter(key=>canonicalJson((a as any)?.[key]??null)!==canonicalJson((b as any)?.[key]??null))};
  }
  const a=before as unknown as NavigationMembershipShard|null,b=after as unknown as NavigationMembershipShard|null,left=new Map((a?.members??[]).map(member=>[member.objectId,member])),right=new Map((b?.members??[]).map(member=>[member.objectId,member]));
  const changes:[string,'added'|'removed'|'modified'][]=[];
  for(const[id,member]of right)if(!left.has(id))changes.push([id,'added']);else if(navigationDigest(left.get(id))!==navigationDigest(member))changes.push([id,'modified']);
  for(const id of left.keys())if(!right.has(id))changes.push([id,'removed']);changes.sort(([a],[b])=>a<b?-1:1);
  const contextId=(b??a)!.contextId,labels=(definition as unknown as NavigationContextDefinition|undefined)?.labels??{en:contextId};
  return{kind:'context-membership',contextId,labels,before:left.size,after:right.size,added:changes.filter(([,kind])=>kind==='added').length,removed:changes.filter(([,kind])=>kind==='removed').length,modified:changes.filter(([,kind])=>kind==='modified').length,objects:changes.slice(0,25).map(([objectId,kind])=>({objectId,kind})),totalObjects:changes.length,sampleLimit:25};
}
