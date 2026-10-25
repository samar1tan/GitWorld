import { createHash } from 'node:crypto';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeEvidence, type KnowledgeJson, type KnowledgeReview, type KnowledgeSource, type KnowledgeTemporalScope, type KnowledgeTime } from '../../domain/src/knowledge.ts';

export const ACTIVITY_CONTEXT_VERSION = 'source-listed-activity-contexts-v1';
type Labels = { en: string; 'zh-CN': string };
type Evidence = { url: string; locator: string; citation?: string };
export type ActivityContextSource = { provider: string; externalId: string; revision: string | null; contentHash?: string };
export type ActivityContextRule = { id: string; activityPropertyId: string; roleLabels: Labels; targetPropertyId: string; targetLabels: Labels; inversePropertyId: string; inverseLabels: Labels };
export type ActivityContextPlan = {
  schemaVersion: 1; id: string; revision: string; preparedAt: string; url: string; rights: KnowledgeSource['rights'];
  activitySources: ActivityContextSource[]; membershipSources: ActivityContextSource[]; rules: ActivityContextRule[];
  membershipProperties: string[]; contextSelector: { types: string[]; identityProviders: string[] };
  inputReviews: Exclude<KnowledgeReview,'rejected'>[]; statusProperties?: string[]; statusLabels?: {value:string;labels:Labels}[]; evidence: Evidence[]; maxJoins?: number;
};
export type ActivityContextIssue = { code: 'SOURCE_NOT_FOUND' | 'SOURCE_REVISION_MISMATCH' | 'SOURCE_HASH_MISMATCH' | 'REJECTED_INPUT' | 'REVIEW_NOT_SELECTED' | 'NON_ENTITY_ACTIVITY_VALUE' | 'UNRESOLVED_ACTOR' | 'NO_ELIGIBLE_MEMBERSHIP' | 'UNDATED_ACTIVITY' | 'UNDATED_MEMBERSHIP' | 'UNRESOLVED_TIME' | 'NO_TEMPORAL_OVERLAP' | 'MULTIPLE_CONTEXTS' | 'SOURCE_CONFLICT' | 'ASSERTION_CONFLICT'; ruleId?: string; assertionId?: string; membershipAssertionId?: string; sourceId?: string; objectId?: string };
export type ActivityContextJoin = {
  id: string; ruleId: string; activityId: string; actorId: string; contextId: string;
  activityAssertionId: string; membershipAssertionId: string; statusAssertionIds: string[];
  activitySourceId: string; membershipSourceId: string; overlap: KnowledgeTemporalScope;
  activitySnapshot: { id:string; revision:string|null; contentHash:string }; membershipSnapshot: { id:string; revision:string|null; contentHash:string };
};
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const labels = (value: Labels) => value && nonempty(value.en) && nonempty(value['zh-CN']);
const strings = (value: string[]) => Array.isArray(value) && value.length > 0 && value.every(nonempty) && new Set(value).size === value.length;
const sourceSelector = (value: ActivityContextSource) => value && nonempty(value.provider) && nonempty(value.externalId) && (nonempty(value.revision) || value.revision === null && nonempty(value.contentHash)) && (value.contentHash === undefined || /^[a-f0-9]{64}$/.test(value.contentHash));
function validate(plan: ActivityContextPlan) {
  if (plan.schemaVersion !== 1 || ![plan.id,plan.revision,plan.preparedAt,plan.url].every(nonempty) || !Number.isFinite(new Date(plan.preparedAt).getTime()) || !plan.rights || !['allowed','restricted','unknown'].includes(plan.rights.redistribution)
    || !Array.isArray(plan.activitySources) || !plan.activitySources.length || !plan.activitySources.every(sourceSelector) || !Array.isArray(plan.membershipSources) || !plan.membershipSources.length || !plan.membershipSources.every(sourceSelector)
    || !Array.isArray(plan.rules) || !plan.rules.length || new Set(plan.rules.map(rule=>rule.id)).size !== plan.rules.length || new Set(plan.rules.map(rule=>rule.activityPropertyId)).size !== plan.rules.length || !plan.rules.every(rule=>[rule.id,rule.activityPropertyId,rule.targetPropertyId,rule.inversePropertyId].every(nonempty) && labels(rule.roleLabels) && labels(rule.targetLabels) && labels(rule.inverseLabels))
    || !strings(plan.membershipProperties) || !plan.contextSelector || !strings(plan.contextSelector.types) || !strings(plan.contextSelector.identityProviders) || !Array.isArray(plan.inputReviews) || !plan.inputReviews.length || plan.inputReviews.some(value=>!['unreviewed','adopted'].includes(value))
    || plan.statusLabels !== undefined && (!Array.isArray(plan.statusLabels)||plan.statusLabels.some(value=>typeof value.value!=='string'||!labels(value.labels))||new Set(plan.statusLabels.map(value=>value.value)).size!==plan.statusLabels.length)
    || !Array.isArray(plan.evidence) || !plan.evidence.length || plan.evidence.some(item=>!nonempty(item.url)||!nonempty(item.locator)) || plan.maxJoins !== undefined && (!Number.isSafeInteger(plan.maxJoins)||plan.maxJoins<1||plan.maxJoins>20000)) throw new Error('INVALID_ACTIVITY_CONTEXT_PLAN');
}
type DateParts = [number,number,number];
type Window = { first: number; last: number; calendar: string; possible: boolean; open: boolean; dateFirst: DateParts; dateLast: DateParts };
const compareDate=(a:DateParts,b:DateParts)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
function dateBound(time:KnowledgeTime,last:boolean):DateParts {
  const month=Number.isInteger(time.month)&&time.month!>=1&&time.month!<=12?time.month!:undefined;
  const day=Number.isInteger(time.day)&&time.day!>=1&&time.day!<=31?time.day!:undefined;
  return[last?time.latestYear:time.earliestYear,month??(last?12:1),day??(last?31:1)];
}
function window(scope: KnowledgeTemporalScope | undefined): Window | null {
  if (!scope) return null;
  const times = scope.point ? [scope.point] : [scope.start,scope.end].filter((value):value is KnowledgeTime=>!!value);
  if (!times.length) return null;
  const open = !scope.point && (!scope.start || !scope.end), calendars=[...new Set(times.map(time=>time.calendar))];
  const first=scope.point?.earliestYear ?? scope.start?.earliestYear ?? scope.end!.earliestYear;
  const last=scope.point?.latestYear ?? scope.end?.latestYear ?? scope.start!.latestYear;
  return {first,last,calendar:calendars.length===1?calendars[0]:'mixed-source-calendars',open,dateFirst:dateBound(scope.point??scope.start??scope.end!,false),dateLast:dateBound(scope.point??scope.end??scope.start!,true),
    possible:scope.certainty==='possible'||open||times.some(time=>time.earliestYear!==time.latestYear||time.precision!=='year')||calendars.length>1};
}
/** Annual projection preserves source scopes separately; it never supplies an inferred day or an unbounded tenure. */
function overlap(a:Window,b:Window):KnowledgeTemporalScope|null {
  const first=Math.max(a.first,b.first),last=Math.min(a.last,b.last);if(first>last)return null;
  if(a.calendar===b.calendar&&!/unspecified|unknown|mixed/i.test(a.calendar)&&(compareDate(a.dateLast,b.dateFirst)<0||compareDate(b.dateLast,a.dateFirst)<0))return null;
  const calendar=a.calendar===b.calendar?a.calendar:'mixed-source-calendars',possible=a.possible||b.possible||a.calendar!==b.calendar;
  return {start:{earliestYear:first,latestYear:first,precision:'year',calendar},end:{earliestYear:last,latestYear:last,precision:'year',calendar},...(possible?{certainty:'possible' as const}:{})};
}
const metadata = {
  'relation:activity-assertion':{en:'Source activity assertion','zh-CN':'来源活动主张'},
  'relation:membership-assertion':{en:'Source role assertion','zh-CN':'来源任职主张'},
  'relation:listed-person':{en:'Person listed in source','zh-CN':'来源所列人物'},
  'relation:listed-role':{en:'Role in the source listing','zh-CN':'来源列名角色'},
  'relation:membership-property':{en:'Recorded role field','zh-CN':'所载任职字段'},
  'relation:activity-time':{en:'Activity time as recorded','zh-CN':'来源活动时间'},
  'relation:membership-time':{en:'Role time as recorded','zh-CN':'来源任职时间'},
  'relation:overlap-resolution':{en:'Time overlap','zh-CN':'时间交集'},
  'relation:source-status':{en:'Status stated by source','zh-CN':'来源明确状态'},
  'relation:status-assertion':{en:'Source status assertion','zh-CN':'来源状态主张'},
  'relation:modeling-semantics':{en:'Meaning of the derived context','zh-CN':'推导上下文的含义'},
  'projection:derived-from':{en:'Original assertion','zh-CN':'原始主张'},
  'projection:rule-id':{en:'Mapping rule','zh-CN':'映射规则'},
};

/** A two-sided source join creates unreviewed listing context, never participation, transmission or ancestry. */
export function projectActivityContexts(input:KnowledgeCollection,plan:ActivityContextPlan) {
  createKnowledgeIndex(input);validate(plan);
  const issues:ActivityContextIssue[]=[],objects=new Map(input.objects.map(value=>[value.id,value])),assertions=new Map(input.assertions.map(value=>[value.id,value])),sources=new Map(input.sources.map(value=>[value.id,value]));
  const select=(selectors:ActivityContextSource[])=>{
    const selected=new Set<string>();
    for(const expected of selectors){
      const identity=input.sources.filter(source=>source.identity.provider===expected.provider&&source.identity.externalId===expected.externalId);
      const revision=identity.filter(source=>source.revision===expected.revision),matching=revision.filter(source=>!expected.contentHash||source.contentHash===expected.contentHash);
      if(!matching.length)issues.push({code:!identity.length?'SOURCE_NOT_FOUND':!revision.length?'SOURCE_REVISION_MISMATCH':'SOURCE_HASH_MISMATCH',sourceId:`${expected.provider}:${expected.externalId}@${expected.revision}`});
      for(const source of matching)selected.add(source.id);
    }
    return selected;
  };
  const activitySources=select(plan.activitySources),membershipSources=select(plan.membershipSources),byActor=new Map<string,KnowledgeAssertion[]>();
  for(const claim of input.assertions){
    const context=objects.get(claim.subjectId);
    if(!membershipSources.has(claim.sourceSnapshotId)||!plan.membershipProperties.includes(claim.propertyId)||claim.value.kind!=='entity'||!context||!context.types.some(type=>plan.contextSelector.types.includes(type))||!context.identities.some(identity=>plan.contextSelector.identityProviders.includes(identity.provider)))continue;
    const entries=byActor.get(claim.value.objectId)??[];entries.push(claim);byActor.set(claim.value.objectId,entries);
  }
  const statuses=new Map<string,KnowledgeAssertion[]>();
  for(const claim of input.assertions)if(activitySources.has(claim.sourceSnapshotId)&&(plan.statusProperties??[]).includes(claim.propertyId)&&claim.review!=='rejected') {const entries=statuses.get(claim.subjectId)??[];entries.push(claim);statuses.set(claim.subjectId,entries);}
  const joins:ActivityContextJoin[]=[];
  for(const rule of plan.rules)for(const activity of input.assertions){
    if(!activitySources.has(activity.sourceSnapshotId)||activity.propertyId!==rule.activityPropertyId)continue;
    if(activity.review==='rejected'||!plan.inputReviews.includes(activity.review)){issues.push({code:activity.review==='rejected'?'REJECTED_INPUT':'REVIEW_NOT_SELECTED',ruleId:rule.id,assertionId:activity.id});continue;}
    if(activity.value.kind!=='entity'){issues.push({code:'NON_ENTITY_ACTIVITY_VALUE',ruleId:rule.id,assertionId:activity.id});continue;}
    const actorId=activity.value.objectId;
    if(!objects.has(actorId)){issues.push({code:'UNRESOLVED_ACTOR',ruleId:rule.id,assertionId:activity.id,objectId:actorId});continue;}
    const a=window(activity.validTime),memberships=byActor.get(actorId)??[];
    if(!a){issues.push({code:'UNDATED_ACTIVITY',ruleId:rule.id,assertionId:activity.id});continue;}
    if(!memberships.length){issues.push({code:'NO_ELIGIBLE_MEMBERSHIP',ruleId:rule.id,assertionId:activity.id,objectId:actorId});continue;}
    const contexts=new Set<string>();
    for(const membership of memberships){
      if(membership.review==='rejected'||!plan.inputReviews.includes(membership.review)){issues.push({code:membership.review==='rejected'?'REJECTED_INPUT':'REVIEW_NOT_SELECTED',ruleId:rule.id,assertionId:activity.id,membershipAssertionId:membership.id});continue;}
      const b=window(membership.validTime);
      if(!b){issues.push({code:'UNDATED_MEMBERSHIP',ruleId:rule.id,assertionId:activity.id,membershipAssertionId:membership.id});continue;}
      const intersection=overlap(a,b);
      if(!intersection){issues.push({code:a.open||b.open?'UNRESOLVED_TIME':'NO_TEMPORAL_OVERLAP',ruleId:rule.id,assertionId:activity.id,membershipAssertionId:membership.id});continue;}
      if(joins.length>=(plan.maxJoins??20000))throw new Error('ACTIVITY_CONTEXT_LIMIT_EXCEEDED');
      const id=hash([plan.id,rule.id,activity.id,membership.id]).slice(0,40);
      const activitySource=sources.get(activity.sourceSnapshotId)!,membershipSource=sources.get(membership.sourceSnapshotId)!;
      joins.push({id,ruleId:rule.id,activityId:activity.subjectId,actorId,contextId:membership.subjectId,activityAssertionId:activity.id,membershipAssertionId:membership.id,statusAssertionIds:(statuses.get(activity.subjectId)??[]).map(value=>value.id).sort(),activitySourceId:activity.sourceSnapshotId,membershipSourceId:membership.sourceSnapshotId,activitySnapshot:{id:activitySource.id,revision:activitySource.revision,contentHash:activitySource.contentHash},membershipSnapshot:{id:membershipSource.id,revision:membershipSource.revision,contentHash:membershipSource.contentHash},overlap:intersection});contexts.add(membership.subjectId);
    }
    if(contexts.size>1)issues.push({code:'MULTIPLE_CONTEXTS',ruleId:rule.id,assertionId:activity.id,objectId:actorId});
  }
  joins.sort((a,b)=>a.id.localeCompare(b.id));
  const usedSourceIds=new Set(joins.flatMap(join=>[join.activityAssertionId,join.membershipAssertionId,...join.statusAssertionIds].flatMap(id=>{const claim=assertions.get(id)!;return[claim.sourceSnapshotId,...claim.evidence.map(item=>item.sourceId)];})));
  const record={schemaVersion:1,mappingVersion:ACTIVITY_CONTEXT_VERSION,plan,inputSources:[...usedSourceIds].sort().map(id=>{const source=sources.get(id)!;return{id,identity:source.identity,revision:source.revision,contentHash:source.contentHash};}),joins};
  const contentHash=hash(record),source:KnowledgeSource={id:`gitworld-activity-contexts:${plan.id}@${contentHash}`,identity:{provider:'gitworld-activity-contexts',externalId:plan.id},revision:plan.revision,contentHash,retrievedAt:plan.preparedAt,url:plan.url,adapterVersion:ACTIVITY_CONTEXT_VERSION,rights:structuredClone(plan.rights),record:structuredClone(record) as unknown as KnowledgeJson};
  const collection=structuredClone(input),priorSource=sources.get(source.id),derivedAssertionIds:string[]=[];
  if(priorSource&&canonicalJson(priorSource)!==canonicalJson(source))return{collection,sourceId:source.id,mappingVersion:ACTIVITY_CONTEXT_VERSION,joins,derivedAssertionIds,issues:[...issues,{code:'SOURCE_CONFLICT' as const,sourceId:source.id}],fieldCatalog:fieldCatalog(plan)};
  if(!priorSource)collection.sources.push(source);
  for(const [index,join]of joins.entries()){
    const activity=assertions.get(join.activityAssertionId)!,membership=assertions.get(join.membershipAssertionId)!,rule=plan.rules.find(rule=>rule.id===join.ruleId)!,statusClaims=join.statusAssertionIds.map(id=>assertions.get(id)!);
    const originalEvidence=[...activity.evidence,...membership.evidence,...statusClaims.flatMap(claim=>claim.evidence)],evidence:KnowledgeEvidence[]=[...structuredClone(originalEvidence),{sourceId:source.id,locator:`$.joins[${index}]`},...plan.evidence.map(item=>({sourceId:source.id,...item}))];
    const text=(propertyId:string,value:string)=>({propertyId,value:{kind:'text' as const,value}});
    const qualifiers:KnowledgeAssertion['qualifiers']=[text('relation:activity-assertion',activity.id),text('relation:membership-assertion',membership.id),text('projection:derived-from',activity.id),text('projection:derived-from',membership.id),text('projection:rule-id',`${plan.id}@${plan.revision}:${join.ruleId}`),{propertyId:'relation:listed-person',value:{kind:'entity',objectId:join.actorId}},text('relation:listed-role',rule.activityPropertyId),text('relation:membership-property',membership.propertyId),{propertyId:'relation:activity-time',value:{kind:'raw',value:activity.validTime as unknown as KnowledgeJson}},{propertyId:'relation:membership-time',value:{kind:'raw',value:membership.validTime as unknown as KnowledgeJson}},text('relation:overlap-resolution',join.overlap.certainty==='possible'?'possible-year-overlap':'year-overlap'),text('relation:modeling-semantics','listed-person-role-context-not-proof-of-participation-or-transfer'),...statusClaims.flatMap(claim=>[{propertyId:'relation:source-status',value:structuredClone(claim.value)},text('relation:status-assertion',claim.id)])];
    for(const direction of ['forward','inverse']as const){
      const derived:KnowledgeAssertion={id:`activity-context:${join.id}:${direction}`,subjectId:direction==='forward'?join.activityId:join.contextId,propertyId:direction==='forward'?rule.targetPropertyId:rule.inversePropertyId,value:{kind:'entity',objectId:direction==='forward'?join.contextId:join.activityId},qualifiers:structuredClone(qualifiers),evidence:structuredClone(evidence),sourceSnapshotId:source.id,review:'unreviewed',validTime:structuredClone(join.overlap)};
      const prior=assertions.get(derived.id);if(prior&&canonicalJson(prior)!==canonicalJson(derived)){issues.push({code:'ASSERTION_CONFLICT',ruleId:join.ruleId,assertionId:derived.id});continue;}
      if(!prior){collection.assertions.push(derived);assertions.set(derived.id,derived);}derivedAssertionIds.push(derived.id);
    }
  }
  createKnowledgeIndex(collection);
  return{collection,sourceId:source.id,mappingVersion:ACTIVITY_CONTEXT_VERSION,joins,derivedAssertionIds,issues,fieldCatalog:fieldCatalog(plan)};
}

function fieldCatalog(plan:ActivityContextPlan){
  const properties=new Map<string,Labels>(Object.entries(metadata));
  for(const rule of plan.rules)for(const[id,display]of[[rule.targetPropertyId,rule.targetLabels],[rule.inversePropertyId,rule.inverseLabels]]as const){if(properties.has(id)&&canonicalJson(properties.get(id))!==canonicalJson(display))throw new Error('INVALID_ACTIVITY_CONTEXT_PLAN');properties.set(id,display);}
  return{schemaVersion:1 as const,kind:'historical-field-display-labels' as const,properties:[...properties].map(([id,labels])=>({id,labels})),types:[],values:[...plan.rules.map(rule=>({propertyId:'relation:listed-role',value:rule.activityPropertyId,labels:rule.roleLabels})),...(plan.statusLabels??[]).map(item=>({propertyId:'relation:source-status',value:item.value,labels:item.labels})),{propertyId:'relation:overlap-resolution',value:'year-overlap',labels:{en:'Overlap at recorded year resolution','zh-CN':'在收录年份精度上相交'}},{propertyId:'relation:overlap-resolution',value:'possible-year-overlap',labels:{en:'Possible overlap at year resolution','zh-CN':'在年份精度上可能相交'}},{propertyId:'relation:modeling-semantics',value:'listed-person-role-context-not-proof-of-participation-or-transfer',labels:{en:'Context of a source-listed person; participation and transmission need separate evidence','zh-CN':'来源所列人物的任职上下文；实际参与和传播需要独立依据'}}]};
}
