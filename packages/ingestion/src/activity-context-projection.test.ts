import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex, type KnowledgeCollection, type KnowledgeTemporalScope } from '../../domain/src/knowledge.ts';
import { projectActivityContexts, type ActivityContextPlan } from './activity-context-projection.ts';
const year=(value:number)=>({earliestYear:value,latestYear:value,precision:'year' as const,calendar:'synthetic-calendar'});
const scope=(start:number,end:number):KnowledgeTemporalScope=>({start:year(start),end:year(end)});
function fixture(){
  const input:KnowledgeCollection={schemaVersion:1,objects:[{id:'activity',identities:[],labels:{en:'Synthetic listing'},descriptions:{},aliases:[],types:['source-activity']},{id:'person',identities:[],labels:{en:'Listed actor'},descriptions:{},aliases:[],types:['person']},{id:'context',identities:[{provider:'declared-context',externalId:'context'}],labels:{en:'Recorded council'},descriptions:{},aliases:[],types:['institution']}],assertions:[
    {id:'activity-role',subjectId:'activity',propertyId:'listing:sender',value:{kind:'entity',objectId:'person'},qualifiers:[],evidence:[{sourceId:'list-source',locator:'row 1 sender'}],sourceSnapshotId:'list-source',review:'adopted',validTime:scope(100,110)},
    {id:'role-tenure',subjectId:'context',propertyId:'institution:holder',value:{kind:'entity',objectId:'person'},qualifiers:[],evidence:[{sourceId:'role-source',locator:'term 1'}],sourceSnapshotId:'role-source',review:'adopted',validTime:scope(105,120)},
    {id:'cancelled',subjectId:'activity',propertyId:'listing:status',value:{kind:'text',value:'cancelled'},qualifiers:[],evidence:[{sourceId:'list-source',locator:'row 1 status'}],sourceSnapshotId:'list-source',review:'adopted',validTime:scope(100,110)}
  ],sources:['list','role'].map(id=>({id:`${id}-source`,identity:{provider:'synthetic',externalId:id},revision:'revision-1',contentHash:(id==='list'?'a':'b').repeat(64),retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/source',adapterVersion:'synthetic',rights:{redistribution:'unknown'}}))};
  const plan:ActivityContextPlan={schemaVersion:1,id:'synthetic-context-rule',revision:'1',preparedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/rule',rights:{redistribution:'unknown'},activitySources:[{provider:'synthetic',externalId:'list',revision:'revision-1',contentHash:'a'.repeat(64)}],membershipSources:[{provider:'synthetic',externalId:'role',revision:'revision-1',contentHash:'b'.repeat(64)}],rules:[{id:'sender',activityPropertyId:'listing:sender',roleLabels:{en:'Listed sender','zh-CN':'所列派遣者'},targetPropertyId:'listing:sender-context',targetLabels:{en:'Listed sender context','zh-CN':'所列派遣者的上下文'},inversePropertyId:'institution:listed-activity',inverseLabels:{en:'Activity listing','zh-CN':'活动列名'}}],membershipProperties:['institution:holder'],contextSelector:{types:['institution'],identityProviders:['declared-context']},inputReviews:['adopted'],statusProperties:['listing:status'],evidence:[{url:'https://example.invalid/rule',locator:'rule 1'}]};
  return{input,plan};
}
test('two-sided joins preserve exact evidence, overlap, cancellation and original records without upgrading review',()=>{
  const{input,plan}=fixture(),before=structuredClone(input),result=projectActivityContexts(input,plan);assert.deepEqual(input,before);assert.equal(result.joins.length,1);assert.equal(result.derivedAssertionIds.length,2);assert.equal(result.issues.length,0);
  assert.deepEqual(result.joins[0].overlap,scope(105,110));assert.deepEqual(result.joins[0].statusAssertionIds,['cancelled']);
  for(const id of result.derivedAssertionIds){const derived=result.collection.assertions.find(value=>value.id===id)!;assert.equal(derived.review,'unreviewed');assert.deepEqual(derived.qualifiers.filter(value=>value.propertyId==='projection:derived-from').map(value=>value.value),[{kind:'text',value:'activity-role'},{kind:'text',value:'role-tenure'}]);assert.ok(derived.evidence.some(value=>value.sourceId==='list-source'));assert.ok(derived.evidence.some(value=>value.sourceId==='role-source'));assert.ok(derived.qualifiers.some(value=>value.propertyId==='relation:source-status'&&value.value.kind==='text'&&value.value.value==='cancelled'));}
  const record=result.collection.sources.at(-1)!.record as any;assert.equal(record.inputSources.length,2);assert.equal(record.inputSources.find((source:any)=>source.id==='role-source').revision,'revision-1');assert.equal(record.joins[0].membershipAssertionId,'role-tenure');
  assert.equal(result.collection.sources.at(-1)!.rights.redistribution,'unknown');
});
test('multiple contexts and original source scopes remain distinct rather than selecting by name or table type',()=>{
  const{input,plan}=fixture();input.objects.push({...structuredClone(input.objects[2]),id:'other-context'});input.assertions.push({...structuredClone(input.assertions[1]),id:'other-role',subjectId:'other-context',validTime:scope(108,115)});
  input.objects.push({...structuredClone(input.objects[2]),id:'raw-scope',identities:[{provider:'source-table-scope',externalId:'raw'}]});input.assertions.push({...structuredClone(input.assertions[1]),id:'raw-role',subjectId:'raw-scope'});
  const result=projectActivityContexts(input,plan);assert.equal(result.joins.length,2);assert.ok(result.issues.some(value=>value.code==='MULTIPLE_CONTEXTS'));assert.ok(result.joins.every(join=>join.contextId!=='raw-scope'));
  const state=createKnowledgeIndex(result.collection).state({objectId:'activity',year:109,includeUnreviewed:true});assert.equal(state.fields.find(field=>field.propertyId==='listing:sender-context')?.values.length,2);
});
test('missing identity and same-name people cannot produce a context match',()=>{
  const{input,plan}=fixture();input.objects.push({...structuredClone(input.objects[1]),id:'same-name-person'});input.assertions[0].value={kind:'entity',objectId:'same-name-person'};
  let result=projectActivityContexts(input,plan);assert.equal(result.joins.length,0);assert.ok(result.issues.some(value=>value.code==='NO_ELIGIBLE_MEMBERSHIP'));
  input.assertions[0].value={kind:'entity',objectId:'unresolved-source-identity'};result=projectActivityContexts(input,plan);assert.equal(result.joins.length,0);assert.ok(result.issues.some(value=>value.code==='UNRESOLVED_ACTOR'));
});
test('source dates and lifetimes do not establish a dated office; open roles are not extrapolated',()=>{
  const{input,plan}=fixture();delete input.assertions[0].validTime;input.assertions.push({...structuredClone(input.assertions[2]),id:'date-value',propertyId:'listing:date',value:{kind:'time',value:year(108)}});
  let result=projectActivityContexts(input,plan);assert.equal(result.joins.length,0);assert.ok(result.issues.some(value=>value.code==='UNDATED_ACTIVITY'));
  input.assertions[0].validTime={point:year(108)};input.assertions[1].validTime={start:year(105)};result=projectActivityContexts(input,plan);assert.equal(result.joins.length,0);assert.ok(result.issues.some(value=>value.code==='UNRESOLVED_TIME'));
  input.assertions[1].propertyId='person:lifespan';input.assertions[1].validTime=scope(80,130);result=projectActivityContexts(input,plan);assert.equal(result.joins.length,0);
});
test('possible dates and incompatible date precision retain complete candidate intervals rather than inventing a point',()=>{
  const{input,plan}=fixture();input.assertions[0].validTime={point:{...year(105),latestYear:108,precision:'interval'}};
  let result=projectActivityContexts(input,plan);assert.deepEqual(result.joins[0].overlap,{...scope(105,108),certainty:'possible'});assert.equal(createKnowledgeIndex(result.collection).state({objectId:'activity',year:106,includeUnreviewed:true}).fields.find(field=>field.propertyId==='listing:sender-context')?.status,'uncertain');
  input.assertions[0].validTime={point:{...year(109),precision:'day',month:1,day:1}};result=projectActivityContexts(input,plan);assert.equal(result.joins[0].overlap.certainty,'possible');assert.deepEqual(result.collection.assertions.find(value=>value.id===result.derivedAssertionIds[0])!.qualifiers.find(value=>value.propertyId==='relation:activity-time')!.value,{kind:'raw',value:input.assertions[0].validTime});
});
test('exact dates in one identified calendar can rule out an overlap inside the same year',()=>{
  const{input,plan}=fixture();const day=(month:number,date:number)=>({...year(109),precision:'day' as const,month,day:date});
  input.assertions[0].validTime={point:day(1,1)};input.assertions[1].validTime={start:day(6,1),end:day(12,31)};
  const result=projectActivityContexts(input,plan);assert.equal(result.joins.length,0);assert.ok(result.issues.some(value=>value.code==='NO_TEMPORAL_OVERLAP'));
});
test('repeated mapping is stable; rejected inputs, mismatched revisions and edited derived records are not overwritten',()=>{
  const{input,plan}=fixture(),first=projectActivityContexts(input,plan),again=projectActivityContexts(first.collection,plan);assert.equal(again.collection.sources.length,first.collection.sources.length);assert.equal(again.collection.assertions.length,first.collection.assertions.length);assert.deepEqual(again.derivedAssertionIds,first.derivedAssertionIds);
  const edited=structuredClone(first.collection);edited.assertions.find(value=>value.id===first.derivedAssertionIds[0])!.review='adopted';const conflict=projectActivityContexts(edited,plan);assert.ok(conflict.issues.some(value=>value.code==='ASSERTION_CONFLICT'));assert.equal(conflict.collection.assertions.find(value=>value.id===first.derivedAssertionIds[0])!.review,'adopted');
  input.assertions[1].review='rejected';assert.equal(projectActivityContexts(input,plan).joins.length,0);input.assertions[1].review='adopted';plan.membershipSources[0].revision='different';assert.ok(projectActivityContexts(input,plan).issues.some(value=>value.code==='SOURCE_REVISION_MISMATCH'));
});
test('field vocabulary is bilingual and a join bound fails instead of returning a silent partial projection',()=>{
  const{input,plan}=fixture();input.objects.push({...structuredClone(input.objects[2]),id:'other'});input.assertions.push({...structuredClone(input.assertions[1]),id:'other',subjectId:'other'});plan.maxJoins=1;assert.throws(()=>projectActivityContexts(input,plan),/ACTIVITY_CONTEXT_LIMIT_EXCEEDED/);
  delete plan.maxJoins;const result=projectActivityContexts(input,plan);assert.ok(result.fieldCatalog.properties.every(value=>value.labels.en&&value.labels['zh-CN']));assert.ok(result.fieldCatalog.values.every(value=>value.labels.en&&value.labels['zh-CN']));
});
