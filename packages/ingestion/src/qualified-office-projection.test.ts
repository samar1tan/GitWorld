import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKnowledgeIndex, type KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { canonicalSourceJson } from './wikidata.ts';
import type { SourceRecordSnapshot } from './source-types.ts';
import { projectQualifiedOfficeEndpoints, type QualifiedOfficePlan } from './qualified-office-projection.ts';
const holder='<a href="/wiki/Fixture_Leader">Source leader</a> (1500–1700)';
function fixture(rows:string,headers=['Holder','From','Until']){
  const raw={title:'Synthetic authority table',text:`<p>RAW_PROSE_NOT_FOR_OUTPUT</p><table class="wikitable"><tr>${headers.map(value=>`<th>${value}</th>`).join('')}</tr>${rows}</table>`};
  const snapshot:SourceRecordSnapshot={identity:{provider:'wikipedia-en',externalId:'synthetic-page'},sourceRevision:'1',retrievedAt:'2026-10-25T00:00:00Z',url:'https://en.wikipedia.org/wiki/Synthetic',revisionUrl:'https://en.wikipedia.org/w/index.php?oldid=1',contentHash:createHash('sha256').update(canonicalSourceJson(raw)).digest('hex'),mediaType:'application/json',raw,rights:{licenseId:'CC-BY-SA-4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',redistribution:'allowed'},adapterVersion:'synthetic'};
  const input:KnowledgeCollection={schemaVersion:1,objects:[{id:'context',identities:[],labels:{en:'Synthetic office','zh-CN':'测试职务'},descriptions:{},aliases:[],types:['office']},{id:'wikipedia-en:Fixture_Leader',identities:[],labels:{en:'Source leader','zh-CN':'测试人物'},descriptions:{},aliases:[],types:['person']}],assertions:[],sources:[]};
  const plan:QualifiedOfficePlan={schemaVersion:1,id:'synthetic-qualified-endpoints',revision:'1',url:'https://example.invalid/profile',source:{provider:'wikipedia-en',externalId:'synthetic-page',revision:'1',upstreamSnapshotHash:snapshot.contentHash},tables:[{id:'qualified',tableIndex:0,expectedHeaders:headers,holderColumn:0,startColumn:1,endColumn:2,contextId:'context',contextType:'office',fields:{'de-jure':{propertyId:'office:formal-holder',labels:{en:'Formal holder','zh-CN':'法理任职者'}},'de-facto':{propertyId:'office:effective-authority',labels:{en:'Effective authority','zh-CN':'实际权力持有者'}}}}],evidence:[{url:'https://example.invalid/profile',locator:'qualified endpoints'}]};
  return{input,snapshot,plan};
}
const crossed=()=>fixture(`<tr><td rowspan="2">${holder}</td><td>de facto 1600</td><td>de jure 1605</td></tr><tr><td>de jure 1603</td><td>de facto 1616</td></tr>`);
test('crossed physical rows pair by explicit basis with exact endpoint locators and preserved source facts',()=>{
  const{input,snapshot,plan}=crossed(),before=structuredClone(input),result=projectQualifiedOfficeEndpoints(input,snapshot,plan);assert.deepEqual(input,before);assert.equal(result.terms.length,2);assert.equal(result.issues.length,0);
  const formal=result.terms.find(term=>term.basis==='de-jure')!,effective=result.terms.find(term=>term.basis==='de-facto')!;
  assert.deepEqual([formal.start.earliestYear,formal.end.latestYear],[1603,1605]);assert.deepEqual([effective.start.earliestYear,effective.end.latestYear],[1600,1616]);assert.equal(formal.startCell,'2:1');assert.equal(formal.endCell,'1:2');assert.equal(formal.start.raw,'de jure 1603');
  assert.ok(result.derivedAssertionIds.every(id=>result.collection.assertions.find(claim=>claim.id===id)!.review==='unreviewed'));
  const source=result.collection.sources[0],record=source.record as any;assert.equal(record.manifest.upstreamSnapshotHash,snapshot.contentHash);assert.ok(record.manifest.historyUrl);assert.equal(source.rights.licenseId,'CC-BY-SA-4.0');assert.equal(JSON.stringify(record).includes('RAW_PROSE_NOT_FOR_OUTPUT'),false);
  const state=createKnowledgeIndex(result.collection).state({objectId:'context',year:1604,includeUnreviewed:true});assert.ok(state.fields.every(field=>field.status==='known'));
});
test('a source cell shared across explicitly qualified rows supplies each supported start without using life dates',()=>{
  const{input,snapshot,plan}=fixture(`<tr><td rowspan="2">${holder}</td><td rowspan="2">1605</td><td>de jure 1623</td></tr><tr><td>de facto 1632</td></tr>`),result=projectQualifiedOfficeEndpoints(input,snapshot,plan);
  assert.equal(result.terms.length,2);assert.ok(result.terms.every(term=>term.start.earliestYear===1605));assert.deepEqual(result.terms.map(term=>term.end.latestYear),[1623,1632]);
  assert.ok((result.collection.sources[0].record as any).facts[0].endpoints.some((value:any)=>value.assignment==='shared-rowspan'));
});
test('a source authority survey stays a survey and a heading basis cannot invent an incompatible formal interval',()=>{
  const{input,snapshot,plan}=fixture(`<tr><td rowspan="2">${holder}</td><td rowspan="2">1568</td><td>de jure 1575</td></tr><tr><td>de facto 1582</td></tr>`,['Holder','de facto authority from','de facto authority until']);
  input.objects[0].types=['authority-survey'];plan.tables[0].contextType='authority-survey';plan.tables[0].fields['de-facto']={propertyId:'authority:listed-effective-holder',labels:{en:'Effective holder in source survey','zh-CN':'来源记录中的实际权力持有者'}};
  const result=projectQualifiedOfficeEndpoints(input,snapshot,plan);assert.equal(result.terms.length,1);assert.equal(result.terms[0].basis,'de-facto');assert.deepEqual(result.collection.objects[0].types,['authority-survey']);assert.ok(result.issues.some(value=>value.code==='MISSING_ENDPOINT'&&value.basis==='de-jure'));
});
test('repeated terms use different holder-cell anchors and never merge by the shared person name',()=>{
  const{input,snapshot,plan}=fixture(`<tr><td>${holder}</td><td>de jure 1603</td><td>de jure 1605</td></tr><tr><td>${holder}</td><td>de jure 1610</td><td>de jure 1612</td></tr>`),result=projectQualifiedOfficeEndpoints(input,snapshot,plan);
  assert.equal(result.terms.length,2);assert.equal(new Set(result.derivedAssertionIds).size,2);assert.equal(createKnowledgeIndex(result.collection).state({objectId:'context',year:1608,includeUnreviewed:true}).fields[0].status,'unknown');
});
test('competing endpoints, ambiguous labels and unqualified dates remain exceptions',()=>{
  let f=fixture(`<tr><td rowspan="2">${holder}</td><td>de jure 1600</td><td>de jure 1605</td></tr><tr><td>de jure 1601</td><td>de jure 1606</td></tr>`),result=projectQualifiedOfficeEndpoints(f.input,f.snapshot,f.plan);assert.equal(result.terms.length,0);assert.ok(result.issues.some(value=>value.code==='AMBIGUOUS_ENDPOINTS'));
  f=fixture(`<tr><td>${holder}</td><td>de jure / de facto 1600</td><td>de jure 1605</td></tr>`);result=projectQualifiedOfficeEndpoints(f.input,f.snapshot,f.plan);assert.equal(result.terms.length,0);assert.ok(result.issues.some(value=>value.code==='AMBIGUOUS_BASIS'));
  f=fixture(`<tr><td>${holder}</td><td>1600</td><td>1605</td></tr>`);result=projectQualifiedOfficeEndpoints(f.input,f.snapshot,f.plan);assert.equal(result.terms.length,0);assert.ok(result.issues.some(value=>value.code==='UNQUALIFIED_BASIS'));
});
test('day/month precision survives and mismatched source, headers or rights cannot silently map',()=>{
  const{input,snapshot,plan}=fixture(`<tr><td>${holder}</td><td>de jure 1 January 1603</td><td>de jure June 1605</td></tr>`),result=projectQualifiedOfficeEndpoints(input,snapshot,plan);assert.equal(result.terms[0].start.precision,'day');assert.equal(result.terms[0].end.precision,'month');
  const changed=structuredClone(plan);changed.tables[0].expectedHeaders[1]='Different header';assert.equal(projectQualifiedOfficeEndpoints(input,snapshot,changed).terms.length,0);
  const wrong=structuredClone(snapshot);wrong.sourceRevision='2';assert.throws(()=>projectQualifiedOfficeEndpoints(input,wrong,plan),/SOURCE_SNAPSHOT_MISMATCH/);
  const rights=structuredClone(snapshot);rights.rights.redistribution='unknown';assert.throws(()=>projectQualifiedOfficeEndpoints(input,rights,plan),/SOURCE_RIGHTS_REVIEW_REQUIRED/);
});
test('unchanged mappings deduplicate, preserve prior review choices and provide complete bilingual field vocabulary',()=>{
  const{input,snapshot,plan}=crossed(),first=projectQualifiedOfficeEndpoints(input,snapshot,plan),again=projectQualifiedOfficeEndpoints(first.collection,snapshot,plan);assert.equal(again.collection.assertions.length,2);assert.equal(again.collection.sources.length,1);assert.deepEqual(again.derivedAssertionIds,first.derivedAssertionIds);assert.ok(first.fieldCatalog.properties.every(value=>value.labels.en&&value.labels['zh-CN']));
  const edited=structuredClone(first.collection);edited.assertions[0].review='adopted';const conflict=projectQualifiedOfficeEndpoints(edited,snapshot,plan);assert.ok(conflict.issues.some(value=>value.code==='ASSERTION_CONFLICT'));assert.equal(conflict.collection.assertions[0].review,'adopted');
});
