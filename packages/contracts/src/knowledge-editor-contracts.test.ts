import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServiceRequest } from './index.ts';
const oid='a'.repeat(40),hash='b'.repeat(64);
const request=(params:unknown)=>validateServiceRequest({protocolVersion:1,requestId:'manual-contract',method:'knowledge.saveEdit',params}).ok;
const addition=()=>({operationId:'add',expectedHead:oid,expectedObjectHash:null,change:{mode:'add',newObject:{labels:{'zh-CN':'新对象'},types:[]},propertyId:'fixture:value',value:{kind:'text',value:'Value'},evidence:{title:'Citation',url:'https://example.invalid/source',locator:'p. 4'},review:'unreviewed',reason:'Record the observation'}});
test('manual contract keeps add/correct patch semantics explicit and validates citation alternatives',()=>{
  const add=addition();assert.ok(request(add));
  const correct={operationId:'correct',expectedHead:oid,expectedObjectHash:hash,objectId:'fixture:subject',assertionId:'fixture:claim',change:{mode:'correct',propertyId:'fixture:value',evidence:{sourceId:'fixture:source',locator:'row'},review:'adopted',reason:'Correct the citation'}};
  assert.ok(request(correct));assert.ok(request({...correct,change:{...correct.change,validTime:null}}));
  // Username-only userinfo exercises credential rejection without a password fixture.
  for(const change of [{...add.change,value:undefined},{...add.change,evidence:{...add.change.evidence,sourceId:'mixed'}},{...add.change,evidence:{...add.change.evidence,url:'http://example.invalid/source'}},{...add.change,evidence:{...add.change.evidence,url:'https://user@example.invalid/source'}},{...add.change,evidence:{...add.change.evidence,locator:' '}},{...add.change,newObject:{labels:{},types:[]}},{...add.change,review:['adopted']},{...add.change,propertyId:42}])assert.ok(!request({...add,change}));
  assert.ok(!request({...correct,expectedObjectHash:null}));assert.ok(!request({...correct,assertionId:undefined}));
});
test('manual replacement values and times reject malformed and ambiguous metadata',()=>{
  const add=addition(),time={earliestYear:100,latestYear:100,precision:'year',calendar:'proleptic-gregorian'};
  assert.ok(request({...add,change:{...add.change,validTime:{point:time}}}));
  for(const validTime of [{},{point:{...time,earliestYear:0}},{point:{...time,precision:['year']}},{point:time,start:time},{start:{...time,earliestYear:200,latestYear:200},end:time},{point:time,certainty:'certain'}])assert.ok(!request({...add,change:{...add.change,validTime}}));
  for(const value of [{kind:'coordinate',longitude:181,latitude:0,globe:'earth'},{kind:'number',value:Infinity},{kind:'number',value:1,lowerBound:3,upperBound:2},{kind:'text',value:'x',language:'en\n'},{kind:'unknown',url:'https://example.invalid'}])assert.ok(!request({...add,change:{...add.change,value}}));
});
