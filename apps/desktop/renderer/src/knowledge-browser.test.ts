import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeBrowser, knowledgeMapPoint, type KnowledgeBrowserApi } from './knowledge-browser.ts';
import { ServiceFailure } from './client.ts';
import { initialKnowledgeBrowserState, parseKnowledgeBrowserState, applyNavigationScopePatch } from './knowledge-browser-state.ts';
import { createKnowledgeIndex, type KnowledgeCollection } from '../../../../packages/domain/src/knowledge.ts';
import type { EditorialStatus } from '../../../../packages/contracts/src/editorial-types.ts';
import type { KnowledgeObjectDetail } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';
import type { ResearchContext } from '../../../../packages/contracts/src/research-types.ts';
import { createKnowledgeDisplayIndex } from '../../../../packages/service/src/knowledge-display.ts';
import { applyContentLabels, contentValueHash, type ContentLabelPlan } from '../../../../packages/ingestion/src/content-labels.ts';
import { createHash } from 'node:crypto';
import { projectEvidencedFields, type EvidencedFieldPlan } from '../../../../packages/ingestion/src/evidenced-field-projection.ts';
import { canonicalSourceJson } from '../../../../packages/ingestion/src/wikidata.ts';
import type { SourceRecordSnapshot } from '../../../../packages/ingestion/src/source-types.ts';

const OLD = '1'.repeat(40), NEW = '2'.repeat(40);
// Synthetic transport/domain fixtures, not historical source content or an installed dataset.
function collection(version = 'old', count = 2): KnowledgeCollection {
  const time = (year: number) => ({ earliestYear: year, latestYear: year, precision: 'year' as const, calendar: 'source-unspecified' });
  const objects = Array.from({ length: count }, (_, i) => ({ id: `fixture:${i}`, identities: [{ provider: 'fixture', externalId: String(i) }], labels: { en: i === 0 ? 'Alpha object' : `Other object ${i}` }, descriptions: { en: 'Synthetic test object' }, aliases: [], types: ['fixture:type'] }));
  const assertions: KnowledgeCollection['assertions'] = objects.flatMap(subject => [
    { id: `${subject.id}:early`, subjectId: subject.id, propertyId: 'fixture:seat', value: { kind: 'text', value: version === 'old' ? 'Earlier seat' : 'Corrected earlier seat' }, qualifiers: [], evidence: [{ sourceId: 'source', locator: `${subject.id}.early` }], sourceSnapshotId: 'source', review: 'adopted', validTime: { start: time(100), end: time(199) } },
    { id: `${subject.id}:later`, subjectId: subject.id, propertyId: 'fixture:seat', value: { kind: 'text', value: 'Later seat' }, qualifiers: [], evidence: [{ sourceId: 'source', locator: `${subject.id}.later` }], sourceSnapshotId: 'source', review: 'adopted', validTime: { start: time(200), end: time(299) } },
  ]);
  assertions.push({ id: 'location', subjectId: 'fixture:0', propertyId: 'geo:location', value: { kind: 'coordinate', longitude: 20, latitude: 40, globe: 'earth' }, qualifiers: [], evidence: [{ sourceId: 'source', locator: 'location' }], sourceSnapshotId: 'source', review: 'adopted' });
  return { schemaVersion: 1, objects, assertions, sources: [{ id: 'source', identity: { provider: 'fixture', externalId: 'source' }, revision: '17', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', adapterVersion: 'fixture-v1', rights: { redistribution: 'unknown' } }] };
}
function fixture(t: { after(fn: () => unknown): void }, count = 2) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'document', prior); else Reflect.deleteProperty(globalThis, 'document'); });
  const old = createKnowledgeIndex(collection('old', count)), newer = createKnowledgeIndex(collection('new', count));
  const indices = new Map([[OLD, old], [NEW, newer]]);
  let head = OLD, dirty = false;
  const index = (revision?: string) => indices.get(!revision || revision === 'working' ? head : revision)!;
  const calls: { method: string; params: unknown }[] = [];
  const validate = (params: unknown): void => { if (params && typeof params === 'object') for (const value of Object.values(params)) { assert.notEqual(value, undefined); validate(value); } };
  const api: KnowledgeBrowserApi = {
    async query(params) { validate(params); calls.push({ method: 'query', params }); return index(params.revision).query(params.query); },
    async object(params) { validate(params); calls.push({ method: 'object', params }); const at = index(params.revision), object = at.object(params.objectId); assert.ok(object); return { object, assertions: at.assertions(params.objectId), sources: collection().sources, revision: params.revision ?? 'working', working: !params.revision || params.revision === 'working' }; },
    async state(params) { validate(params); calls.push({ method: 'state', params }); return index(params.revision).state(params.state); },
    async history(params) { validate(params); calls.push({ method: 'history', params }); return index(params.revision).history(params); },
    async diff(params) { validate(params); calls.push({ method: 'diff', params }); const a = index(params.a.revision).state(params.a.state), b = index(params.b.revision).state(params.b.state); return { a, b, fields: index(params.a.revision).diff(params.a.state, params.b.state).fields }; },
  };
  const buffers = new Map<string, string>(), storage = { getItem: (key: string) => buffers.get(key) ?? null, setItem: (key: string, value: string) => { buffers.set(key, value); }, removeItem: (key: string) => { buffers.delete(key); } };
  const status = (): EditorialStatus => ({ head, branch: 'main', stagedTree: '3'.repeat(40), staged: [], unstaged: dirty ? [{ path: 'objects/changed.json', kind: 'modified' }] : [], conflicts: [], revert: null });
  const learning: ResearchContext[] = [];
  const create = (extra:Partial<Parameters<typeof createKnowledgeBrowser>[0]>={}) => createKnowledgeBrowser({ locale: () => 'en', render: () => {}, api, repositoryStatus: async () => status(), storage, onFindData: () => {}, onOpenChanges: () => {}, onResearch: context => { learning.push(context); },...extra });
  return { api, create, calls, storage, learning, status, head: (value: string) => { head = value; }, dirty: (value: boolean) => { dirty = value; } };
}
const click = (browser: ReturnType<typeof createKnowledgeBrowser>, action: string, extra = {}) => browser.click({ dataset: { knowledge: action, ...extra } } as unknown as HTMLElement);
const input = (browser: ReturnType<typeof createKnowledgeBrowser>, field: string, value: string) => browser.input({ dataset: { knowledgeInput: field }, value } as unknown as HTMLInputElement);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('unapplied historical year survives review and reopen; pins use only the displayed successful state',async t=>{
  const f=fixture(t),browser=f.create();await browser.open();await browser.execute({type:'show',objectId:'fixture:0',year:100});
  input(browser,'year','200');await browser.change({dataset:{knowledgeInput:'unreviewed'},checked:true} as unknown as HTMLInputElement);
  assert.equal(browser.state().year,100);assert.equal(browser.state().yearDraft,'200');assert.match(browser.content(),/Displayed state · 100/);assert.match(browser.content(),/Year input has not been applied/);
  await click(browser,'set-a');assert.equal(browser.state().a!.year,100);assert.equal(browser.state().a!.includeUnreviewed,true);browser.hide();
  const reopened=f.create();await reopened.open();assert.equal(reopened.state().yearDraft,'200');assert.equal(reopened.state().year,100);
  await reopened.submit({dataset:{knowledgeForm:'year'}} as HTMLFormElement);await click(reopened,'set-b');assert.equal(reopened.state().b!.year,200);assert.equal(reopened.state().a!.year,100);
});

test('failed Show preserves the actual state and does not let an unapplied year become a fixed reference',async t=>{
  const f=fixture(t),browser=f.create();await browser.open();await browser.execute({type:'show',objectId:'fixture:0',year:100});const original=f.api.state;
  f.api.state=p=>p.state.year===200?Promise.reject(new ServiceFailure({code:'IO_ERROR'})):original(p);
  input(browser,'year','200');await browser.submit({dataset:{knowledgeForm:'year'}} as HTMLFormElement);assert.equal(browser.state().year,100);assert.equal(browser.state().yearDraft,'200');await click(browser,'set-a');assert.equal(browser.state().a!.year,100);
});

test('ordinary object selection starts inside its numeric scope while explicit historical targets retain their year',async t=>{
  const f=fixture(t),browser=f.create();await browser.open();await browser.execute({type:'scope',patch:{type:'filters',filters:{time:[150,160]}}});await click(browser,'object',{id:'fixture:0'});assert.equal(browser.state().year,150);
  input(browser,'year','200');await click(browser,'checkout');assert.equal(browser.state().checkout!.year,150);assert.equal(browser.state().yearDraft,'200');
  await browser.execute({type:'scope',patch:{type:'filters',filters:{time:[200,220]}}});await click(browser,'object',{id:'fixture:1'});assert.equal(browser.state().year,200);await browser.execute({type:'preview-version',reference:{objectId:'fixture:0',year:150,revision:OLD,label:'Alpha',includeUnreviewed:false}});assert.equal(browser.state().year,150);assert.deepEqual(browser.state().query.time,[200,220]);
});

test('late pin validation fixes the original slot without replacing a newer displayed state',async t=>{
  const f=fixture(t),gate=deferred<EditorialStatus>();let delayed=false;
  const browser=f.create({repositoryStatus:()=>delayed?gate.promise:Promise.resolve(f.status())});await browser.open();await browser.execute({type:'show',objectId:'fixture:0',year:100});
  delayed=true;const pin=click(browser,'checkout');await new Promise(setImmediate);
  input(browser,'year','200');await browser.submit({dataset:{knowledgeForm:'year'}} as HTMLFormElement);assert.equal(browser.state().year,200);
  gate.resolve(f.status());await pin;assert.equal(browser.state().checkout!.year,100);assert.equal(browser.state().year,200);assert.equal(browser.state().preview,null);assert.match(browser.content(),/Displayed state · 200/);assert.doesNotMatch(browser.content(),/data-knowledge="set-a" disabled/);
});

test('following a fixed reference clears superseded state loading and rejects the late Show response',async t=>{
  const f=fixture(t),browser=f.create();await browser.open();await browser.execute({type:'show',objectId:'fixture:0',year:100});await click(browser,'set-a');
  const gate=deferred<Awaited<ReturnType<KnowledgeBrowserApi['state']>>>(),original=f.api.state;f.api.state=p=>p.state.year===200?gate.promise:original(p);
  input(browser,'year','200');const showing=browser.submit({dataset:{knowledgeForm:'year'}} as HTMLFormElement);await new Promise(setImmediate);await click(browser,'show-a');
  assert.equal(browser.state().year,100);assert.doesNotMatch(browser.content(),/data-knowledge="set-a" disabled/);gate.resolve(await original({state:{objectId:'fixture:0',year:200,includeUnreviewed:false},revision:'working'}));await showing;assert.equal(browser.state().year,100);assert.equal(browser.state().preview?.year,100);
});

test('new fixed references retain bilingual snapshot labels across an overview restart',async t=>{
  const f=fixture(t),read=f.api.object;f.api.object=async input=>{const result=await read(input);return{...result,object:{...result.object,labels:{en:'Snapshot name','zh-CN':'快照名称'}}};};
  const browser=f.create();await browser.open();await browser.execute({type:'show',objectId:'fixture:0',year:100});await click(browser,'set-a');await browser.execute({type:'scope',patch:{type:'reset'}});browser.hide();
  const reopened=f.create({locale:()=> 'zh-CN'});await reopened.open();assert.match(reopened.content(),/快照名称 · 100/);assert.equal(reopened.state().a!.revision,OLD);assert.equal(reopened.state().a!.year,100);
});

test('scope dimension patches preserve other filters, unapplied input and historical references',()=>{
  const state=initialKnowledgeBrowserState();state.query={time:[1336,1392],text:'court',typeIds:['court'],includeUndated:false};state.queryRevision=OLD;
  state.scopeDraft={text:'Pending keyword',from:'1350',to:'1400',includeUndated:false,includeUnlocated:true,bounds:{west:'',east:'',south:'',north:''},contextIds:[],unassigned:false,typeIds:['court']};state.a={objectId:'a',year:1370,revision:OLD,label:'A',includeUnreviewed:true};state.checkout=state.a;
  const selected=applyNavigationScopePatch(state,{type:'selection',selection:{mode:'contexts',contextIds:['context:a']}});assert.deepEqual(selected.query.time,[1336,1392]);assert.equal(selected.scopeDraft!.text,'Pending keyword');assert.deepEqual(selected.a,state.a);
  const unassigned=applyNavigationScopePatch(selected,{type:'selection',selection:{mode:'unassigned'}});assert.equal(unassigned.query.unassigned,true);assert.equal(unassigned.query.contextIds,undefined);assert.equal(unassigned.scopeDraft!.unassigned,true);
  const filtered=applyNavigationScopePatch(unassigned,{type:'filters',filters:{time:[1350,1400]}});assert.equal(filtered.scopeDraft!.text,'Pending keyword');assert.equal(filtered.scopeDraft!.from,'1350');
  const reset=applyNavigationScopePatch(filtered,{type:'reset'});assert.equal(reset.query.text,undefined);assert.equal(reset.queryRevision,OLD);assert.deepEqual(reset.a,state.a);assert.deepEqual(reset.checkout,state.checkout);
});

test('new workspaces start with the complete declared structure types; All kinds and old saved views remain explicit',async t=>{
  const f=fixture(t,3),data=collection('old',3);data.objects.forEach((object,index)=>{object.types=[index===2?'fixture:structure':'fixture:person'];});const index=createKnowledgeIndex(data),catalog=[{id:'fixture:person',labels:{en:'Person'},navigationRole:'person' as const},{id:'fixture:structure',labels:{en:'Council'},navigationRole:'structure' as const}];
  const queries:any[]=[];f.api.query=async p=>{queries.push(structuredClone(p));return {...index.query(p.query),typeCatalog:catalog};};
  const browser=f.create();await browser.open();assert.deepEqual(browser.state().query.typeIds,['fixture:structure']);assert.equal((browser.content().match(/class="knowledge-object"/g)??[]).length,1);assert.match(browser.content(),/data-mode="structures" selected/);
  await click(browser,'all-kinds');assert.equal(browser.state().query.typeIds,undefined);assert.equal(browser.state().kindMode,'all');assert.equal((browser.content().match(/class="knowledge-object"/g)??[]).length,3);
  await click(browser,'type',{id:'fixture:person'});assert.equal((browser.content().match(/class="knowledge-object"/g)??[]).length,2);assert.match(browser.content(),/data-id="fixture:structure"/);
  const legacy=initialKnowledgeBrowserState();delete legacy.kindMode;const restored=f.create();await restored.open(legacy);assert.equal(restored.state().query.typeIds,undefined);assert.equal(restored.state().kindMode,'all');assert.equal((restored.content().match(/class="knowledge-object"/g)??[]).length,3);
  assert.ok(queries.every(value=>value.revision==='working'));
});

test('context selection queries the same revision and exposes complete counts separately from filtered matches',async t=>{
  const f=fixture(t,55),definition={schemaVersion:1 as const,id:'context:one',labels:{en:'A context'},origin:'user-organization' as const};const reads:any[]=[];
  const index=createKnowledgeIndex(collection('old',55),new Map([[definition.id,new Set(Array.from({length:50},(_,i)=>'fixture:'+i))]]));f.api.query=async p=>{f.calls.push({method:'query',params:p});return index.query(p.query);};
  const browser=f.create({navigation:{async list(p){reads.push(p);return {head:OLD,revision:p.revision??'working',items:[{definition,contentHash:'a'.repeat(64),members:50}],total:1,offset:0,limit:25,counts:{objects:55,assigned:50,unassigned:5}};},async get(p){reads.push(p);return {head:OLD,revision:p.revision??'working',definition,contentHash:'a'.repeat(64),contextHash:'b'.repeat(64),members:[],total:50,offset:0,limit:10};}}});
  await browser.open();input(browser,'from','100');input(browser,'to','199');await browser.submit({dataset:{knowledgeForm:'scope'}} as HTMLFormElement);
  await browser.execute({type:'scope',patch:{type:'selection',selection:{mode:'contexts',contextIds:[definition.id]},revision:OLD}});
  const queried=f.calls.filter(v=>v.method==='query').at(-1)!.params as any;assert.equal(queried.revision,OLD);assert.deepEqual(queried.query.contextIds,[definition.id]);assert.deepEqual(queried.query.time,[100,199]);assert.ok(reads.some(p=>p.contextId===definition.id&&p.revision===OLD));assert.match(browser.content(),/55 objects in this data revision/);assert.match(browser.content(),/50 members in this context/);
  await click(browser,'unassigned');assert.equal(browser.state().query.unassigned,true);assert.equal(browser.state().query.contextIds,undefined);assert.match(browser.content(),/data-mode="unassigned" selected/);
});

test('a real projection DTO exposes its distinct cited permalink and retains the derived snapshot in fixed research',async t=>{
  const f=fixture(t),hash=(value:string)=>createHash('sha256').update(value).digest('hex'),raw={html:'<p id="role">A published role</p><p id="date">100</p>'},upstream='https://example.invalid/upstream?oldid=17',mapping='https://example.invalid/field-profile';
  const snapshot:SourceRecordSnapshot={identity:{provider:'synthetic-published-source',externalId:'document'},sourceRevision:'17',retrievedAt:'2026-10-25T00:00:00Z',url:'https://example.invalid/upstream',revisionUrl:upstream,raw,contentHash:hash(canonicalSourceJson(raw)),mediaType:'text/html',rights:{redistribution:'allowed',licenseId:'CC0-1.0'},adapterVersion:'test'};
  const profile={id:'published-role',identity:snapshot.identity,revision:snapshot.sourceRevision,contentHash:snapshot.contentHash,citation:{title:'Synthetic published document',language:'en',creator:'GitWorld test authors',rightsEvidence:['https://example.invalid/license'],rightsNote:'Original technical fixture.'},facts:[{id:'role',selector:{kind:'element' as const,tag:'p',id:'role'},textHash:hash('A published role')},{id:'date',selector:{kind:'element' as const,tag:'p',id:'date'},textHash:hash('100')}]};
  const plan:EvidencedFieldPlan={schemaVersion:1,id:'field-profile',revision:'profile-v1',preparedAt:'2026-10-25T00:00:00Z',url:mapping,rights:{redistribution:'allowed',licenseId:'CC0-1.0'},profiles:[profile],objects:[],statements:[{id:'role',subjectId:'subject',propertyId:'fixture:role',value:{kind:'text',value:'A role',language:'en'},validTime:{point:{earliestYear:100,latestYear:100,precision:'year',calendar:'source-unspecified'}},factKeys:['published-role:role'],timeFactKeys:['published-role:date'],interpretation:{en:'Explicit source-field interpretation.','zh-CN':'依据来源字段的明确解释。'}}],fieldCatalog:{schemaVersion:1,kind:'historical-field-display-labels',properties:[{id:'fixture:role',labels:{en:'Role','zh-CN':'职责'}}],types:[],values:[]}};
  const mapped=projectEvidencedFields({schemaVersion:1,objects:[{id:'subject',identities:[],labels:{en:'Subject','zh-CN':'对象'},descriptions:{},aliases:[],types:[]}],assertions:[],sources:[]},[snapshot],plan);assert.equal(mapped.status,'mapped');assert.equal(mapped.collection.assertions[0].evidence[0].url,upstream);
  let index=createKnowledgeIndex(mapped.collection);
  f.api.query=async p=>index.query(p.query);f.api.object=async p=>({object:index.object(p.objectId)!,assertions:index.assertions(p.objectId),sources:mapped.collection.sources,revision:p.revision??'working',working:p.revision==='working'});f.api.state=async p=>index.state(p.state);f.api.history=async p=>index.history(p);
  for(const locale of ['en','zh-CN'] as const){
    const browser=f.create({locale:()=>locale});await browser.open();await browser.execute({type:'show',objectId:'subject',year:100,includeUnreviewed:true});await click(browser,'field',{property:'fixture:role'});
    const fragment=browser.content().split('<article class="knowledge-assertion">')[1].split('</article>')[0];assert.equal((fragment.match(/href="https:\/\/example.invalid\/upstream\?oldid=17"/g)??[]).length,1);assert.match(fragment,/href="https:\/\/example.invalid\/field-profile"/);assert.match(fragment,locale==='en'?/Cited source/:/引用来源/);
    const learning=await browser.researchContext();assert.equal(learning.evidence![0].url,upstream);assert.deepEqual(learning.evidence![0].sourceIdentity,mapped.collection.sources[0].identity);assert.equal(learning.evidence![0].repositoryRevision,OLD);
  }
  for(const evidence of mapped.collection.assertions[0].evidence)evidence.url=mapping;index=createKnowledgeIndex(mapped.collection);const same=f.create();await same.open();await same.execute({type:'show',objectId:'subject',year:100,includeUnreviewed:true});await click(same,'field',{property:'fixture:role'});const fragment=same.content().split('<article class="knowledge-assertion">')[1].split('</article>')[0];assert.doesNotMatch(fragment,/Cited source/);assert.equal((fragment.match(/href="https:\/\/example.invalid\/field-profile"/g)??[]).length,1);
  for(const evidence of mapped.collection.assertions[0].evidence)delete evidence.url;index=createKnowledgeIndex(mapped.collection);await same.execute({type:'show',objectId:'subject',year:100,includeUnreviewed:true});assert.equal((await same.researchContext()).evidence![0].url,mapping);
});

test('ordinary state, same-year comparison and Evidence retain full source dates in both locales',async t=>{
  const f=fixture(t),data=collection(),at=(day:number)=>({earliestYear:512,latestYear:512,month:5,day,precision:'day' as const,calendar:'published-source-calendar-unspecified',raw:`512-05-${day}`});
  data.assertions=data.objects.map((object,index)=>({id:`date:${index}`,subjectId:object.id,propertyId:'fixture:date',value:{kind:'time' as const,value:at(21+index)},validTime:{point:at(21+index)},review:'adopted' as const,qualifiers:[],evidence:[{sourceId:'source',locator:`date[${index}]`}],sourceSnapshotId:'source'}));
  const index=createKnowledgeIndex(data);f.api.query=async p=>index.query(p.query);f.api.state=async p=>index.state(p.state);f.api.history=async p=>index.history(p);f.api.diff=async p=>index.diff(p.a.state,p.b.state);f.api.object=async p=>({object:index.object(p.objectId)!,assertions:index.assertions(p.objectId),sources:data.sources,revision:p.revision??'working',working:p.revision===undefined});
  for(const locale of ['en','zh-CN'] as const){
    const browser=createKnowledgeBrowser({locale:()=>locale,render(){},api:f.api,repositoryStatus:async()=>f.status(),storage:f.storage,onFindData(){},onResearch(){}}),reference={objectId:'fixture:0',year:512,revision:OLD,label:'Alpha',includeUnreviewed:false};await browser.open();await browser.execute({type:'preview-version',reference});
    let table=browser.content().match(/<table class="knowledge-state-table">[\s\S]*?<\/table>/)![0];assert.match(table,locale==='en'?/May 21, 512/:/512年5月21日/);assert.match(table,locale==='en'?/Day/:/日/);assert.match(table,locale==='en'?/Calendar unspecified by source/:/来源未注明历法/);
    await click(browser,'field',{property:'fixture:date'});let evidence=browser.content().split('<article class="knowledge-assertion">')[1].split('</article>')[0];assert.match(evidence,locale==='en'?/At May 21, 512/:/在 512年5月21日/);assert.equal(evidence.match(/512-05-21/g)?.length,1);assert.match(evidence,/date\[0\]/);
    await browser.execute({type:'compare',a:reference,b:{...reference,objectId:'fixture:1',label:'Other'}});table=browser.content().match(/<table class="knowledge-state-table">[\s\S]*?<\/table>/)![0];assert.match(table,locale==='en'?/May 21, 512/:/512年5月21日/);assert.match(table,locale==='en'?/May 22, 512/:/512年5月22日/);assert.match(table,/knowledge-status changed/);
    await click(browser,'field',{property:'fixture:date',side:'b'});evidence=browser.content().split('<article class="knowledge-assertion">')[1].split('</article>')[0];assert.match(evidence,locale==='en'?/At May 22, 512/:/在 512年5月22日/);assert.doesNotMatch(evidence,/512-05-21/);assert.equal(evidence.match(/512-05-22/g)?.length,1);
    assert.equal(browser.state().a?.year,512);assert.equal(browser.state().b?.year,512);assert.equal(browser.state().a?.revision,OLD);assert.equal(browser.state().b?.revision,OLD);
  }
});

test('bulk source groups preserve individual records and field Evidence uses the exact original source', async t => {
  const { create, api } = fixture(t), original = api.object;
  api.object = async params => {
    const context = await original(params), base = context.sources[0];
    return { ...context, sources: Array.from({ length: 20 }, (_, index) => ({ ...base, id: index ? `source:${index}` : 'source', identity: { provider: 'cliopatria-frame', externalId: index.toString(16).padStart(64, '0') }, revision: 'v1', contentHash: (index + 100).toString(16).padStart(64, '0') })) };
  };
  const browser = create(); await browser.open(); await click(browser, 'object', { id: 'fixture:0' });
  let inspector = browser.content().split('<aside class="knowledge-inspector">')[1];
  assert.equal((inspector.match(/class="knowledge-source-group"/g) ?? []).length, 1); assert.equal((inspector.match(/class="knowledge-source-record"/g) ?? []).length, 20);
  const summary = inspector.match(/class="knowledge-source-group"[^>]*><summary>([\s\S]*?)<\/summary>/)![1].replace(/<[^>]+>/g, ' ');
  assert.match(summary, /Cliopatria/); assert.match(summary, /20 source records/); assert.doesNotMatch(summary, /[a-f0-9]{64}/);
  await browser.execute({ type: 'show-version', reference: { objectId: 'fixture:0', year: 150, revision: OLD, label: 'Alpha object', includeUnreviewed: false } });
  await click(browser, 'field', { property: 'fixture:seat' }); inspector = browser.content().split('<aside class="knowledge-inspector">')[1];
  assert.match(inspector, /<a href="https:\/\/example.invalid\/source">Cliopatria<\/a>/); assert.match(inspector, /fixture:0.early/); assert.match(inspector, /<code>source<\/code>/); assert.ok(inspector.includes(`<code>${'0'.repeat(64)}</code>`)); assert.ok(inspector.includes(`<code>${OLD}</code>`));
});

test('selected field names distinguish a compatibility catalog from data-pinned provenance in each locale', async t => {
  const f = fixture(t), original = f.api.object;
  f.api.object = async params => {
    const context = await original(params);
    return { ...context, display: { fingerprint: 'display', objects: {}, properties: {}, types: {}, values: {}, qualifierValues: {}, notes: [], vocabulary: {
      fingerprint: 'vocabulary', origin: 'git', legacyFingerprint: 'f'.repeat(64), types: {}, values: {}, properties: { 'fixture:seat': {
        en: { text: 'Compatibility seat name', language: 'en', status: 'original', origin: 'legacy', provenance: [] },
        'zh-CN': { text: '目录席位名称', language: 'zh-CN', status: 'original', origin: 'git', provenance: [{ sourceId: 'catalog-source', method: 'field-catalog', language: 'zh-CN', text: '目录席位名称', evidence: [{ url: 'https://example.invalid/catalog', locator: '$.catalog.properties', sourceSnapshotHash: 'c'.repeat(64) }] }] },
      } } } } };
  };
  const en = f.create(); await en.open(); await en.execute({ type: 'show-version', reference: { objectId: 'fixture:0', year: 150, revision: OLD, label: 'Alpha', includeUnreviewed: false } }); await click(en, 'field', { property: 'fixture:seat' });
  const english = en.content().split('<details class="knowledge-field-names">')[1].split('<article class="knowledge-assertion">')[0];
  assert.match(english, /not frozen by the selected data revision/); assert.ok(english.includes('f'.repeat(64))); assert.doesNotMatch(english, /Names from the selected data revision/);
  const zh = createKnowledgeBrowser({ locale: () => 'zh-CN', render() {}, api: f.api, repositoryStatus: async () => f.status(), storage: f.storage, onFindData() {}, onResearch() {} });
  await zh.open(); await zh.execute({ type: 'show-version', reference: { objectId: 'fixture:0', year: 150, revision: OLD, label: 'Alpha', includeUnreviewed: false } }); await click(zh, 'field', { property: 'fixture:seat' });
  const chinese = zh.content().split('<details class="knowledge-field-names">')[1].split('<article class="knowledge-assertion">')[0];
  assert.match(chinese, /名称来自所选资料版本/); assert.ok(chinese.includes(OLD)); assert.ok(chinese.includes('c'.repeat(64))); assert.match(chinese, /catalog-source/); assert.match(zh.content(), /fixture:0.early/);
});

test('real display DTO keeps enum labels above raw fallback while explicit translations and conflicts retain priority', async t => {
  const f = fixture(t), base = collection('old', 1), raw = { kind: 'text' as const, value: 'coded:alpha', language: 'und' };
  base.assertions[0].value = raw;
  for (const locale of ['en', 'zh-CN'] as const) for (const mode of ['enum', 'translated', 'conflict', 'catalog-conflict'] as const) {
    let data = structuredClone(base);
    const plan = (id: string, text: string): ContentLabelPlan => ({ schemaVersion: 1, id, revision: '1', preparedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/labels', rights: { redistribution: 'unknown' }, labels: [], sourceFacts: [], valueTexts: [{ assertionId: data.assertions[0].id, valueHash: contentValueHash(raw), language: locale, text, method: 'fixture', evidence: [{ url: 'https://example.invalid/value', locator: '$.value' }] }] });
    if (mode !== 'enum') data = applyContentLabels(data, plan('first', 'Claim-specific text')).collection;
    if (mode === 'conflict') data = applyContentLabels(data, plan('second', 'Different claim text')).collection;
    const index = createKnowledgeIndex(data), displayIndex = createKnowledgeDisplayIndex(data, { schemaVersion: 1, kind: 'historical-field-display-labels', properties: [], types: [], values: [{ propertyId: 'fixture:seat', value: raw.value, labels: { en: 'Catalog alpha', 'zh-CN': '目录甲类' } }] }, mode === 'catalog-conflict' ? { fingerprint: 'catalog-conflict', origin: 'git', properties: {}, types: {}, values: { 'fixture:seat': { [raw.value]: { en: { text: raw.value, language: 'en', status: 'conflict', provenance: [] }, 'zh-CN': { text: raw.value, language: 'zh-CN', status: 'conflict', provenance: [] } } } } } : undefined);
    const dto = displayIndex.object('fixture:0', data.assertions, 'display-fingerprint');
    assert.equal(dto.values[data.assertions[0].id][locale].status, mode === 'enum' ? 'missing' : mode === 'conflict' ? 'conflict' : 'translated');
    f.api.query = async p => index.query(p.query); f.api.state = async p => index.state(p.state); f.api.history = async p => index.history(p);
    f.api.object = async p => ({ object: index.object(p.objectId)!, assertions: data.assertions, sources: displayIndex.sourceHeaders(new Set(data.sources.map(item => item.id))), revision: p.revision ?? 'working', working: true, display: dto });
    const browser = createKnowledgeBrowser({ locale: () => locale, render() {}, api: f.api, storage: f.storage, repositoryStatus: async () => f.status(), onFindData() {}, onResearch() {} });
    await browser.open(); await browser.execute({ type: 'show-version', reference: { objectId: 'fixture:0', year: 150, revision: OLD, label: 'Alpha', includeUnreviewed: false } });
    const html = browser.content(), primary = html.match(/<div class="knowledge-value"><span(?: lang="[^"]*")?>([^<]*)<\/span>/)?.[1];
    assert.equal(primary, mode === 'enum' ? locale === 'en' ? 'Catalog alpha' : '目录甲类' : mode === 'translated' ? 'Claim-specific text' : raw.value);
    if (mode === 'conflict' || mode === 'catalog-conflict') assert.match(html, /knowledge-display-conflict/);
    assert.deepEqual(data.assertions[0].value, raw);
  }
});

test('restored research object and field focus survives filters and can be widened without moving fixed references',async t=>{
  const {create,calls}=fixture(t),browser=create();await browser.open();
  await browser.execute({type:'checkout',objectId:'fixture:0',year:150});const fixed=browser.state().checkout;
  await browser.open({...browser.state(),query:{text:'',objectIds:['fixture:0'],time:[100,250],includeUndated:true},fieldIds:['fixture:seat'],selectedObjectId:'fixture:0',view:'state',year:150,preview:null,objectRevision:'working'});
  assert.equal((browser.content().match(/class="knowledge-object"/g)??[]).length,1);
  assert.match(browser.content(),/Objects from research/);assert.match(browser.content(),/Fields from research/);
  const rows=browser.content().split('data-knowledge-fields')[1];assert.ok(rows);assert.doesNotMatch(rows!.split('</table>')[0],/data-property="geo:location"/);
  await browser.submit({dataset:{knowledgeForm:'scope'}} as unknown as HTMLFormElement);
  assert.deepEqual((calls.filter(value=>value.method==='query').at(-1)!.params as any).query.objectIds,['fixture:0']);
  browser.hide();await browser.open();assert.deepEqual(browser.state().fieldIds,['fixture:seat']);
  await click(browser,'clear-fields');assert.equal(browser.state().fieldIds,undefined);
  await click(browser,'clear-objects');assert.equal((browser.content().match(/class="knowledge-object"/g)??[]).length,2);
  assert.deepEqual(browser.state().checkout,fixed);
});

test('the geographic canvas uses the basemap projection and rejects fabricated locations', () => {
  const center = knowledgeMapPoint(0, 0)!; assert.ok(Math.abs(center[0] - 500) < .01); assert.ok(Math.abs(center[1] - 260) < .01);
  assert.ok(knowledgeMapPoint(0, 40)![1] < center[1]);
  assert.equal(knowledgeMapPoint(200, 20), null); assert.equal(knowledgeMapPoint(Number.NaN, 20), null);
});

test('scope results are paged and objects without coordinates remain available in the list', async t => {
  const { create, calls } = fixture(t, 55), browser = create(); await browser.open();
  assert.equal((calls.find(value => value.method === 'query')!.params as any).query.limit, 40);
  assert.equal((browser.content().match(/class="knowledge-object"/g) ?? []).length, 40);
  assert.match(browser.content(), /54 without coordinates/);assert.match(browser.content(),/data-id="fixture:1"/); await click(browser, 'view', {view:'map'}); assert.equal((browser.content().match(/class="knowledge-map-point/g) ?? []).length, 1);
  await click(browser, 'next'); assert.equal((browser.content().match(/class="knowledge-object"/g) ?? []).length, 15);
});

test('objects absent from committed data cannot be mislabeled as a fixed historical checkout', async t => {
  const { create, dirty, api } = fixture(t), original = api.object, browser = create(); await browser.open(); dirty(true);
  api.object = async params => params.revision === OLD ? Promise.reject(new ServiceFailure({ code: 'NOT_FOUND' })) : original(params);
  const result = await browser.execute({ type: 'checkout', objectId: 'fixture:0', year: 100 });
  assert.deepEqual(result, { ok: false, code: 'UNCOMMITTED_OBJECT' }); assert.equal(browser.state().checkout, null);
  assert.match(browser.content(), /only in working data/);
});

test('unrelated working research changes do not block checkout of a committed historical object', async t => {
  const { create, dirty } = fixture(t), browser = create(); await browser.open(); dirty(true);
  assert.deepEqual(await browser.execute({ type: 'checkout', objectId: 'fixture:0', year: 100 }), { ok: true });
  assert.equal(browser.state().checkout!.revision, OLD);
});

test('committed checkout leaves a later working value available as a separately labeled preview', async t => {
  const { create, head, dirty, api } = fixture(t), originalObject = api.object, originalState = api.state;
  head(NEW); dirty(true);
  api.object = async params => {
    const value = await originalObject(params);
    if (params.revision === 'working') value.assertions.find(item => item.id === 'fixture:0:early')!.value = { kind: 'text', value: 'Uncommitted C' };
    return value;
  };
  api.state = async params => {
    const value = await originalState(params);
    if (params.revision === 'working') value.fields.find(item => item.propertyId === 'fixture:seat')!.values = [{ kind: 'text', value: 'Uncommitted C' }];
    return value;
  };
  const browser = create(); await browser.open();
  await browser.execute({ type: 'show', objectId: 'fixture:0', year: 100 }); assert.match(browser.content(), /Uncommitted C/);
  assert.deepEqual(await browser.execute({ type: 'checkout', objectId: 'fixture:0', year: 100 }), { ok: true });
  assert.equal(browser.state().checkout!.revision, NEW); assert.match(browser.content(), /Corrected earlier seat/); assert.match(browser.content(), /reference uses committed data/);
  await click(browser, 'show-working'); assert.match(browser.content(), /Uncommitted C/); assert.equal(browser.state().checkout!.revision, NEW);
});

test('checkout and A/B retain their own committed revision while browsing and HEAD advance', async t => {
  const { create, head, calls } = fixture(t), browser = create(); await browser.open();
  await browser.execute({ type: 'checkout', objectId: 'fixture:0', year: 100 }); await click(browser, 'set-a');
  assert.equal(browser.state().checkout!.revision, OLD); assert.equal(browser.state().a!.revision, OLD);
  head(NEW); await browser.execute({ type: 'show', objectId: 'fixture:1', year: 200 }); await click(browser, 'set-b');
  assert.equal(browser.state().b!.revision, NEW); assert.equal(browser.state().a!.objectId, 'fixture:0');
  const compared = calls.findLast(value => value.method === 'diff')!.params as any;
  assert.equal(compared.a.revision, OLD); assert.equal(compared.b.revision, NEW);
  await browser.execute({ type: 'search', query: { text: 'Alpha', offset: 0, limit: 40 } });
  assert.equal(browser.state().checkout!.objectId, 'fixture:0'); assert.equal(browser.state().a!.revision, OLD); assert.equal(browser.state().b!.revision, NEW);
  browser.hide(); const reopened = create(); await reopened.open(); assert.equal(reopened.state().a!.revision, OLD); assert.equal(reopened.state().b!.revision, NEW);
});

test('following an entity keeps its source revision and supports a return without resetting newer pins', async t => {
  const { create, head, calls } = fixture(t), browser = create(); await browser.open();
  await browser.execute({ type: 'preview-version', reference: { objectId:'fixture:0',year:100,revision:OLD,label:'Alpha object',includeUnreviewed:true } });
  head(NEW);
  await click(browser,'related',{id:'fixture:1',revision:OLD,year:'200',unreviewed:'true'});
  assert.equal(browser.state().selectedObjectId,'fixture:1');assert.equal(browser.state().preview!.revision,OLD);
  assert.equal(browser.state().year,200);assert.equal(browser.state().objectTrail!.length,1);
  await click(browser,'set-b');const fixedB=browser.state().b;
  browser.hide();const reopened=create();await reopened.open();
  await click(reopened,'back-related');
  assert.equal(reopened.state().selectedObjectId,'fixture:0');assert.equal(reopened.state().preview!.revision,OLD);
  assert.equal(reopened.state().year,100);assert.deepEqual(reopened.state().b,fixedB);
  assert.ok(calls.some(value=>value.method==='object'&&(value.params as any).objectId==='fixture:1'&&(value.params as any).revision===OLD));
});

test('late object responses cannot replace a more recent historical selection', async t => {
  const { create, api } = fixture(t), original = api.object;
  const late = deferred<KnowledgeObjectDetail>();
  api.object = async params => params.objectId === 'fixture:0' ? late.promise : original(params);
  const browser = create(); await browser.open();
  const first = browser.execute({ type: 'show', objectId: 'fixture:0', year: 100 });
  await browser.execute({ type: 'show', objectId: 'fixture:1', year: 200 });
  late.resolve(await original({ objectId: 'fixture:0', revision: 'working' })); await first;
  assert.equal(browser.state().selectedObjectId, 'fixture:1'); assert.equal(browser.state().year, 200);
  assert.match(browser.content(), /Later seat/);
});

test('loading another fixed object does not display the previous object evidence under its new reference',async t=>{
  const {create,api}=fixture(t),browser=create();await browser.open();await browser.execute({type:'checkout',objectId:'fixture:0',year:100});
  const original=api.object,held=deferred<KnowledgeObjectDetail>();
  api.object=params=>params.objectId==='fixture:1'&&params.revision===OLD?held.promise:original(params);
  const pending=browser.execute({type:'preview-version',reference:{objectId:'fixture:1',year:200,revision:OLD,label:'Other object 1',includeUnreviewed:false}});
  assert.match(browser.content(),/<h1><span[^>]*>Other object 1/);assert.doesNotMatch(browser.content(),/knowledge-inspector|Earlier seat|Select an object and a historical year/);
  held.resolve(await original({objectId:'fixture:1',revision:OLD}));await pending;
  assert.match(browser.content(),/Later seat/);assert.equal(browser.state().checkout!.objectId,'fixture:0');
});

test('learning references are fixed to committed evidence rather than the live working view', async t => {
  const { create, learning } = fixture(t), browser = create(); await browser.open();
  await browser.execute({ type: 'show', objectId: 'fixture:0', year: 100 }); await click(browser, 'research');
  assert.equal(learning.length, 1); assert.ok(learning[0].evidence!.length > 0);
  assert.ok(learning[0].evidence!.every(value => value.repositoryRevision === OLD));
  assert.deepEqual(learning[0].scope.timeWindow, [100, 100]);
  assert.deepEqual(learning[0].evidence!.map(value => value.assertionId), ['fixture:0:early']);
});

test('comparison research includes only assertions supporting each endpoint, not the entire object chronology', async t => {
  const { create, learning } = fixture(t), browser = create(); await browser.open();
  await browser.execute({ type: 'show', objectId: 'fixture:0', year: 100 }); await click(browser, 'set-a');
  await browser.execute({ type: 'show', objectId: 'fixture:0', year: 200 }); await click(browser, 'set-b');
  await click(browser, 'research');
  assert.deepEqual(learning[0].evidence!.map(value => [value.assertionId, value.year]), [['fixture:0:early', 100], ['fixture:0:later', 200]]);
  assert.ok(learning[0].evidence!.every(value => value.repositoryRevision === OLD));
});

test('invalid saved references cannot restore a working tree as a committed state', () => {
  const value = initialKnowledgeBrowserState();
  assert.equal(parseKnowledgeBrowserState(JSON.stringify(value))?.schemaVersion, 1);
  value.checkout = { objectId: 'fixture:0', label: 'Alpha', year: 100, revision: 'working', includeUnreviewed: false };
  assert.equal(parseKnowledgeBrowserState(JSON.stringify(value)), null);
});

test('comparison research retains the unreviewed-claim policy of both fixed endpoints', async t => {
  const { create, learning } = fixture(t), browser = create(), saved = initialKnowledgeBrowserState();
  saved.includeUnreviewed = true; saved.view = 'compare';
  saved.a = { objectId: 'fixture:0', year: 100, revision: OLD, label: 'Earlier', includeUnreviewed: true };
  saved.b = { objectId: 'fixture:0', year: 200, revision: OLD, label: 'Later', includeUnreviewed: true };
  await browser.open(saved); await click(browser, 'research');
  assert.equal(learning.length, 1); assert.equal(learning[0].comparison?.a.includeUnreviewed, true); assert.equal(learning[0].comparison?.b.includeUnreviewed, true);
  assert.ok(learning[0].evidence?.every(value => value.includeUnreviewed === true));
});

test('a fixed preview is retained across reopen and restoration without changing historical checkout', async t => {
  const {create,calls,head}=fixture(t),browser=create();await browser.open();
  await browser.execute({type:'checkout',objectId:'fixture:0',year:150});
  const checkout=browser.state().checkout;
  const preview={objectId:'fixture:0',year:250,revision:OLD,label:'Alpha object',includeUnreviewed:false};
  assert.deepEqual(await browser.execute({type:'preview-version',reference:preview}),{ok:true});
  assert.deepEqual(browser.state().checkout,checkout);assert.deepEqual(browser.state().preview,preview);
  head(NEW);browser.hide();calls.length=0;await browser.open();
  assert.deepEqual(browser.state().checkout,checkout);assert.deepEqual(browser.state().preview,preview);
  assert.ok(calls.some(call=>call.method==='state'&&(call.params as any).revision===OLD&&(call.params as any).state.year===250));
  const restored=create();await restored.open();assert.deepEqual(restored.state().preview,preview);assert.deepEqual(restored.state().checkout,checkout);
  await click(restored,'view',{view:'overview'});restored.hide();await restored.open();assert.equal(restored.state().view,'overview');assert.deepEqual(restored.state().preview,preview);assert.deepEqual(restored.state().checkout,checkout);
});

test('an old saved year alone does not invent a fixed preview reference',async t=>{
  const {create,storage}=fixture(t),saved=initialKnowledgeBrowserState();saved.selectedObjectId='fixture:0';saved.year=150;saved.view='state';delete saved.preview;
  storage.setItem('gitworld-knowledge-view-v1',JSON.stringify(saved));const browser=create();await browser.open();assert.equal(browser.state().preview,null);assert.equal(browser.state().checkout,null);
});

test('the initial overview uses full-match coverage and type/time drill-down retains fixed references',async t=>{
  const {create,calls}=fixture(t,55),browser=create();await browser.open();assert.equal(browser.state().view,'overview');
  assert.match(browser.content(),/All 55 matching objects/);assert.match(browser.content(),/data-knowledge="coverage-time"/);assert.doesNotMatch(browser.content(),/<div class="knowledge-map">/);
  await browser.execute({type:'checkout',objectId:'fixture:0',year:150});const fixed=browser.state().checkout;
  await click(browser,'view',{view:'overview'});await click(browser,'coverage-time',{from:'100',to:'149'});
  assert.deepEqual(browser.state().query.time,[100,149]);assert.deepEqual(browser.state().checkout,fixed);assert.equal(browser.state().view,'overview');
  await click(browser,'type',{id:'fixture:type'});assert.deepEqual(browser.state().query.typeIds,['fixture:type']);assert.deepEqual(browser.state().query.time,[100,149]);assert.deepEqual(browser.state().checkout,fixed);
  assert.ok(calls.some(call=>call.method==='query'&&(call.params as any).query.time?.[0]===100));
});

test('A and B header labels belong to each pinned data revision rather than the last loaded object',async t=>{
  const {create,api}=fixture(t),original=api.object;api.object=async params=>{const detail=await original(params);detail.object.labels.en=params.revision===OLD?'Original name':'Corrected name';return detail;};
  const browser=create();await browser.open();await browser.execute({type:'compare',a:{objectId:'fixture:0',year:150,revision:OLD,label:'Original name',includeUnreviewed:false},b:{objectId:'fixture:0',year:250,revision:NEW,label:'Corrected name',includeUnreviewed:false}});
  const html=browser.content();assert.match(html,/data-knowledge="show-a"[^>]*>Original name/);assert.match(html,/data-knowledge="show-b"[^>]*>Corrected name/);
});

test('loading a new scope does not claim that the existing library is empty',async t=>{
  const {create,api}=fixture(t),response=deferred<Awaited<ReturnType<KnowledgeBrowserApi['query']>>>(),original=api.query;
  api.query=()=>response.promise;const browser=create(),opening=browser.open();await new Promise(setImmediate);
  assert.match(browser.content(),/role="status"/);assert.doesNotMatch(browser.content(),/No structured objects have been adopted|0 objects/);
  response.resolve(await original({query:{},revision:'working'}));await opening;assert.match(browser.content(),/All 2 matching objects/);
});

test('saved navigation waits for readiness before exposing inputs, while retaining fixed references',async t=>{
  const {create,api}=fixture(t),response=deferred<Awaited<ReturnType<KnowledgeBrowserApi['query']>>>(),original=api.query;
  const saved=initialKnowledgeBrowserState();saved.query.time=[100,199];saved.query.text='Alpha';saved.a={objectId:'fixture:0',label:'Pinned Alpha',year:100,revision:OLD,includeUnreviewed:false};
  api.query=()=>response.promise;const browser=create();assert.doesNotMatch(browser.content(),/<input|<select/);const opening=browser.open(saved);await new Promise(setImmediate);
  assert.match(browser.content(),/aria-busy="true"/);assert.match(browser.content(),/Pinned Alpha/);assert.doesNotMatch(browser.content(),/<input|<select|data-knowledge-form="scope"/);
  response.resolve(await original({query:saved.query,revision:'working'}));await opening;
  assert.match(browser.content(),/data-knowledge-input="from" value="100"/);assert.match(browser.content(),/data-knowledge-input="query" value="Alpha"/);assert.doesNotMatch(browser.content(),/aria-busy="true"/);
});

test('matching objects lead collapsed coverage without losing type and time drill-down',async t=>{
  const {create}=fixture(t),browser=create();await browser.open();
  const html=browser.content(),objects=html.indexOf('class="knowledge-overview-objects"'),coverage=html.indexOf('class="knowledge-coverage-details"');
  assert.ok(objects>=0&&coverage>objects);assert.match(html,/<details class="knowledge-coverage-details"><summary>Type and time coverage/);assert.match(html,/data-knowledge="type"/);assert.match(html,/data-knowledge="coverage-time"/);assert.match(html,/complete records/);
  await click(browser,'coverage-time',{from:'100',to:'149'});assert.deepEqual(browser.state().query.time,[100,149]);
});

test('historical log visualization and later year changes keep the command revision and review policy',async t=>{
  const {create,calls,head}=fixture(t),browser=create();head(NEW);await browser.open();calls.length=0;
  await browser.execute({type:'observations-version',objectId:'fixture:0',revision:OLD,includeUnreviewed:true});
  assert.equal(browser.state().view,'observations');assert.equal(browser.state().objectRevision,OLD);assert.equal(browser.state().checkout,null);
  assert.ok(calls.some(call=>call.method==='history'&&(call.params as any).revision===OLD&&(call.params as any).includeUnreviewed===true));
  await click(browser,'observation',{year:'150'});assert.match(browser.content(),/Earlier seat/);assert.doesNotMatch(browser.content(),/Corrected earlier seat/);
  browser.hide();await browser.open();assert.equal(browser.state().objectRevision,OLD);assert.equal(browser.state().preview?.revision,OLD);assert.equal(browser.state().checkout,null);
});

test('fixed-state caption follows locale using its pinned snapshot labels and keeps the unapplied year',async t=>{
  const f=fixture(t),read=f.api.object;let locale:'en'|'zh-CN'='en';f.head(NEW);
  f.api.object=async p=>{const result=await read(p);return{...result,object:{...result.object,labels:p.revision===OLD?{en:'Original snapshot','zh-CN':'旧快照名称'}:{en:'Working rename','zh-CN':'工作资料新名称'}}};};
  const browser=f.create({locale:()=>locale});await browser.open();await browser.execute({type:'show-version',reference:{objectId:'fixture:0',year:100,revision:OLD,label:'Original snapshot',includeUnreviewed:false}});input(browser,'year','200');await click(browser,'set-a');
  assert.match(browser.content(),/Fixed historical state · <span lang="en">Original snapshot<\/span>/);locale='zh-CN';const html=browser.content();
  assert.match(html,/固定历史状态 · <span lang="zh-CN">旧快照名称<\/span> · 100/);assert.doesNotMatch(html,/固定历史状态 · (?:Original snapshot|[^<]*工作资料新名称)/);assert.equal(browser.state().yearDraft,'200');assert.equal(browser.state().year,100);assert.equal(browser.state().checkout!.revision,OLD);assert.equal(browser.state().a!.revision,OLD);
});

test('comparison research carries only the names read at each fixed snapshot',async t=>{
  const f=fixture(t),read=f.api.object;f.head(NEW);f.api.object=async p=>{const result=await read(p);return{...result,object:{...result.object,labels:p.revision===OLD?{en:'Old snapshot','zh-CN':'固定旧名称'}:{en:'Working rename','zh-CN':'工作资料新名称'}}};};
  const browser=f.create();await browser.open();await browser.execute({type:'compare',a:{objectId:'fixture:0',year:100,revision:OLD,label:'Old snapshot',includeUnreviewed:false},b:{objectId:'fixture:0',year:200,revision:OLD,label:'Old snapshot',includeUnreviewed:true}});await click(browser,'research');
  const comparison=f.learning[0].comparison!;assert.deepEqual(comparison.a.labels,{en:'Old snapshot','zh-CN':'固定旧名称'});assert.deepEqual(comparison.b.labels,comparison.a.labels);assert.equal(comparison.a.repositoryRevision,OLD);assert.equal(comparison.b.year,200);assert.equal(comparison.b.includeUnreviewed,true);assert.equal(browser.state().a!.revision,OLD);
});


test('snapshot source display names remain fixed across a Working rename and locale change', async t => {
  const f = fixture(t), original = f.api.object; let locale: 'en' | 'zh-CN' = 'en';
  const names = { en: 'Fixed collection name', 'zh-CN': '固定集合名称' }, workingNames = { en: 'Later working collection', 'zh-CN': '后来的工作集合' };
  f.api.object = async params => { const value = await original(params); return { ...value, sources: value.sources.map(source => ({ ...source, labels: params.revision === OLD ? names : workingNames, title: { en: 'Original source heading' } })) }; };
  f.head(NEW); const browser = f.create({ locale: () => locale }); await browser.open(); await browser.execute({ type: 'preview-version', reference: { objectId: 'fixture:0', label: 'Alpha object', year: 100, revision: OLD, includeUnreviewed: false } });
  assert.ok(browser.content().includes(names.en)); assert.ok(!browser.content().includes(workingNames.en));
  const reads = f.calls.length; locale = 'zh-CN'; const html = browser.content(); assert.ok(html.includes(names['zh-CN'])); assert.ok(!html.includes(workingNames['zh-CN'])); assert.ok(html.includes('Original source heading')); assert.match(html, /lang="en"/); assert.equal(f.calls.length, reads);
  await click(browser, 'field', { property: 'fixture:seat' }); assert.ok(browser.content().includes(names['zh-CN'])); assert.match(browser.content(), /https:\/\/example.invalid\/source/);
});
