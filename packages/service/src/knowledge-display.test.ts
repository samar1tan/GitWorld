import test from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeCollection } from '../../domain/src/knowledge.ts';
import type { KnowledgeFieldCatalog } from '../../contracts/src/knowledge-workspace-types.ts';
import { applyContentLabels, contentValueHash, type ContentLabelPlan } from '../../ingestion/src/content-labels.ts';
import { createKnowledgeDisplayIndex } from './knowledge-display.ts';
import { knowledgeValueDisplay } from '../../../apps/desktop/renderer/src/knowledge-labels.ts';

function fixture() {
  const collection: KnowledgeCollection = { schemaVersion: 1,
    objects: [{id:'subject',identities:[],labels:{en:'Synthetic object'},descriptions:{},aliases:[],types:['test:type']},{id:'related',identities:[],labels:{en:'Another object','zh-CN':'另一个对象'},descriptions:{},aliases:[],types:[]}],
    assertions: [{id:'original',subjectId:'subject',propertyId:'test:property',value:{kind:'text',value:'Source value',language:'en'},qualifiers:[],evidence:[{sourceId:'source',locator:'row 1'}],sourceSnapshotId:'source',review:'unreviewed'}],
    sources:[{id:'source',identity:{provider:'test',externalId:'source'},revision:'1',contentHash:'test',retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/source',adapterVersion:'test',rights:{redistribution:'unknown'},record:{manifest:{articleTitle:'Original source title',historyUrl:'https://example.invalid/history',changes:['Selected one synthetic fact']},secretBody:'not part of a view DTO'}}] };
  collection.assertions.push({...structuredClone(collection.assertions[0]),id:'derived',qualifiers:[{propertyId:'binding:derived-from',value:{kind:'text',value:'original'}}]});
  collection.assertions.push({...structuredClone(collection.assertions[0]),id:'relation',value:{kind:'entity',objectId:'related'}});
  const plan: ContentLabelPlan = {schemaVersion:1,id:'test-labels',revision:'1',preparedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/labels',rights:{redistribution:'unknown'},sourceFacts:[],labels:[{objectId:'subject',language:'zh-CN',text:'测试对象',method:'synthetic-translation',evidence:[{url:'https://example.invalid/name',locator:'name'}]}],valueTexts:[{assertionId:'original',valueHash:contentValueHash(collection.assertions[0].value),language:'zh-CN',text:'来源值',method:'synthetic-value-translation',evidence:[{url:'https://example.invalid/value',locator:'value'}]}]};
  const catalog: KnowledgeFieldCatalog = {schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'test:property',labels:{en:'Test field','zh-CN':'测试字段'}}],types:[{id:'test:type',labels:{en:'Test type','zh-CN':'测试类型'}}],values:[],semanticNotes:[]};
  return { collection, plan, catalog };
}

test('object display is bilingual, follows unchanged derivations and exposes translation provenance without source bodies', () => {
  const {collection,plan,catalog}=fixture();(collection.sources[0] as any).unexpectedOperationalBody='must stay local';
  const localized=applyContentLabels(collection,plan).collection, formatter=createKnowledgeDisplayIndex(localized,catalog), display=formatter.object('subject',localized.assertions,'working-fingerprint');
  assert.equal(display.objects.subject.display['zh-CN'].text,'测试对象'); assert.equal(display.objects.related.labels['zh-CN'],'另一个对象');
  assert.equal(display.properties['test:property']['zh-CN'],'测试字段'); assert.equal(display.types['test:type']['zh-CN'],'测试类型');
  assert.equal(display.values.derived['zh-CN'].text,'来源值'); assert.equal(display.values.derived['zh-CN'].provenance[0].assertionId,'original');
  assert.equal(display.values.derived.en.status,'original');
  const headers=formatter.sourceHeaders(new Set(['source'])); assert.equal(headers[0].title?.en,'Original source title'); assert.equal(headers[0].historyUrl,'https://example.invalid/history'); assert.equal('record' in headers[0],false); assert.equal(JSON.stringify(headers).includes('secretBody'),false);assert.equal('unexpectedOperationalBody' in headers[0],false);
  assert.deepEqual(localized.assertions,collection.assertions);
});

test('arbitrary legal identifiers do not become object prototype mutations in a display DTO',()=>{
  const {collection,catalog}=fixture();collection.objects[0].id='__proto__';for(const assertion of collection.assertions)assertion.subjectId='__proto__';
  collection.assertions[0].id='__proto__';collection.assertions[0].propertyId='__proto__';catalog.values=[{propertyId:'__proto__',value:'polluted',labels:{en:'Safe label','zh-CN':'安全标签'}}];
  const display=createKnowledgeDisplayIndex(collection,catalog).object('__proto__',collection.assertions,'test');
  assert.ok(Object.hasOwn(display.objects,'__proto__'));assert.ok(Object.hasOwn(display.values,'__proto__'));assert.equal((Object.prototype as any).polluted,undefined);
  assert.equal(display.qualifierValues.__proto__.polluted.en,'Safe label');assert.ok(JSON.stringify(display).includes('"__proto__"'));
});

test('missing and conflicting translations retain source values; stale translation cannot be applied to a correction', () => {
  const {collection,plan}=fixture(); plan.valueTexts!.push({...plan.valueTexts![0],text:'冲突译文'});
  const conflict=applyContentLabels(collection,plan).collection, translated=createKnowledgeDisplayIndex(conflict).object('subject',conflict.assertions,'a');
  assert.equal(translated.values.derived['zh-CN'].status,'conflict'); assert.equal(translated.values.derived['zh-CN'].text,'Source value'); assert.equal(translated.values.derived['zh-CN'].provenance.length,2);
  conflict.assertions.find(value=>value.id==='derived')!.value={kind:'text',value:'Corrected source value',language:'en'};
  const stale=createKnowledgeDisplayIndex(conflict).object('subject',conflict.assertions,'b'); assert.equal(stale.values.derived['zh-CN'].status,'missing'); assert.equal(stale.values.derived['zh-CN'].text,'Corrected source value'); assert.equal(stale.values.derived['zh-CN'].provenance.length,0);
});

test('renderer combines only display metadata for the canonical value being rendered', () => {
  const {collection,plan}=fixture(), localized=applyContentLabels(collection,plan).collection, display=createKnowledgeDisplayIndex(localized).object('subject',localized.assertions,'a');
  const detail={object:{...localized.objects[0],assertionCount:3,datedAssertionCount:0,coordinates:[],reviewCounts:{unreviewed:3,adopted:0,rejected:0},observedTimes:[]},assertions:localized.assertions,sources:[],revision:'working',working:true,display};
  assert.equal(knowledgeValueDisplay(localized.assertions[0].value,['original','derived'],detail,'zh-CN')?.text,'来源值');
  assert.equal(knowledgeValueDisplay({kind:'text',value:'Different value',language:'en'},['original'],detail,'zh-CN'),null);
});
