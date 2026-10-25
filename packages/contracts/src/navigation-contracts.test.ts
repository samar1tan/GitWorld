import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServiceRequest } from './index.ts';

const oid='a'.repeat(40),hash='b'.repeat(64),id='context:fixture';
const source={kind:'saved-source',selection:'source-claim-subjects',revision:'working',sourceId:'source:fixture',sourceRevision:'1',sourceHash:hash,selectionHash:hash,objectSetHash:hash};
const valid=(method:string,params:unknown)=>validateServiceRequest({protocolVersion:1,requestId:'navigation-contract',method,params}).ok;
test('navigation writes use service-created identity and exact reviewed guards rather than paths or renderer member arrays',()=>{
  const create={operationId:'create-context',expectedHead:oid,expectedContentHash:null,labels:{en:'A name'}};
  assert.equal(valid('context.save',create),true);assert.equal(valid('context.save',{...create,contextId:id}),false);assert.equal(valid('context.save',{...create,labels:{en:' '}}),false);
  assert.equal(valid('context.save',{...create,contextId:id,expectedContentHash:hash}),true);assert.equal(valid('context.save',{...create,expectedHead:'HEAD'}),false);
  const plan={contextId:id,expectedHead:oid,expectedDefinitionHash:hash,batch:source,mode:'add'};
  assert.equal(valid('context.membershipPlan',plan),true);assert.equal(valid('context.membershipPlan',{...plan,objectIds:['chosen-by-the-renderer']}),false);
  assert.equal(valid('context.membershipPlan',{...plan,batch:{kind:'trusted-bundle',bundleId:'forged',manifestHash:hash,objectSetHash:hash}}),false);
  assert.equal(valid('context.applyMembership',{operationId:'apply-plan',planId:hash,expectedPlanHash:hash}),true);assert.equal(valid('context.applyMembership',{operationId:'apply-plan',planId:hash}),false);
  assert.equal(valid('context.resume',{operationId:'apply-plan',batch:source}),false);
  assert.equal(valid('repository.stage',{paths:[`navigation/contexts/${hash}/definition.json`]}),true);assert.equal(valid('repository.stage',{paths:['navigation/arbitrary.json']}),false);
});
test('scope queries and whole-batch readers are bounded and keep explicit selection semantics',()=>{
  assert.equal(valid('knowledge.query',{query:{contextIds:[id],text:'1267',time:[1200,1300]}}),true);assert.equal(valid('knowledge.query',{query:{contextIds:[id],unassigned:true}}),false);
  assert.equal(valid('context.batchObjects',{batch:source,offset:1000,limit:100}),true);assert.equal(valid('context.batchSources',{batch:source,offset:30,limit:100}),true);assert.equal(valid('context.batchSources',{batch:source,limit:101}),false);
  assert.equal(valid('context.batchObjects',{batch:{...source,selection:'infer-by-country-name'}}),false);
  assert.equal(valid('command.execute',{input:{intent:{family:'scope',intent:{type:'use',selection:{mode:'contexts',contextIds:[id]}}}},scopeRevision:oid}),true);
  assert.equal(valid('command.execute',{input:{intent:{family:'scope',intent:{type:'use',selection:{mode:'all',text:''}}}}}),false);
});
