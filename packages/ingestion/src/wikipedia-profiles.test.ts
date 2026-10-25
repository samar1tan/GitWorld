import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import { parseKnowledgeImportArtifact } from '../../service/src/knowledge-collection-files.ts';
import { inspectWikipediaTables, mapWikipediaProfile, wikipediaHash as hash } from './wikipedia-profiles.ts';
import type { WikipediaTableSnapshot } from './mediawiki-tables.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadTrustedKnowledgeBundle } from '../../service/src/trusted-bundled-knowledge.ts';
import { knowledgeCollectionSeedFiles } from '../../service/src/knowledge-store.ts';
import { knowledgeArtifactHash } from '../../service/src/knowledge-imports.ts';
import { planKnowledgeVocabulary } from '../../service/src/knowledge-vocabulary.ts';

const oid='a'.repeat(40);
function source(html:string,id=31):WikipediaTableSnapshot{const raw={pageid:id,revid:77,title:'A source-selected table',text:html};return{identity:{provider:'wikipedia-en',externalId:String(id)},sourceRevision:'77',retrievedAt:'2026-10-25T00:00:00Z',url:'https://en.wikipedia.org/wiki/A_source-selected_table',revisionUrl:'https://en.wikipedia.org/w/index.php?oldid=77',contentHash:hash(raw),raw,mediaType:'application/json',adapterVersion:'fixture',retrievalMode:'fixed-revision',rights:{redistribution:'unknown'}};}
const person='<a href="/wiki/Recorded_A" title="Recorded A">Recorded A</a>';
test('generic source columns map a tenure and keep source scopes, evidence and unknown rights',()=>{
  const snapshot=source(`<h2>River commission</h2><table class="wikitable"><tr><th>Name</th><th>Reign</th></tr><tr><td>${person}</td><td>1900–1902</td></tr></table>`);
  const table=inspectWikipediaTables(snapshot).tables[0],selection={profileId:'office-tenures-v1' as const,tables:[{tableIndex:0,headerHash:table.headerHash,holderColumn:0,tenureColumn:1}]};
  const mapped=mapWikipediaProfile(snapshot,selection,oid),artifact=parseKnowledgeImportArtifact(JSON.stringify(mapped.artifact));
  assert.equal(mapped.counts.sourceRows,1);assert.equal(mapped.counts.mappedRows,1);assert.equal(mapped.counts.timedRows,1);assert.equal(mapped.counts.objects,2);assert.equal(mapped.counts.assertions,2);
  const scope=artifact.collection.objects.find(o=>o.types.includes('gitworld:source-tenure-scope'))!;assert.ok(scope);assert.ok(!artifact.collection.objects.some(o=>o.types.includes('gitworld:office')));
  const state=createKnowledgeIndex(artifact.collection).state({objectId:scope.id,year:1901,includeUnreviewed:true});assert.equal(state.fields.find(f=>f.propertyId==='office:holder')?.status,'known');
  assert.ok(artifact.collection.sources.every(s=>s.rights.redistribution==='unknown'));assert.ok(artifact.collection.assertions.every(a=>a.review==='unreviewed'));
  assert.ok(!JSON.stringify(artifact).includes('<table'));assert.ok(artifact.collection.sources[1].record);assert.equal(hash(artifact.collection.sources[1].record),artifact.collection.sources[1].contentHash);
  assert.deepEqual(mapWikipediaProfile(snapshot,selection,oid),mapped);
  const policy=mapWikipediaProfile({...snapshot,permissionEvidence:{observation:'Different retained permission observation'}},selection,oid);assert.notEqual(knowledgeArtifactHash(policy.artifact),knowledgeArtifactHash(mapped.artifact));assert.ok(policy.artifact.collection.sources.every(s=>s.rights.redistribution==='unknown'));
  assert.throws(()=>mapWikipediaProfile(snapshot,{...selection,tables:[{...selection.tables[0],headerHash:'0'.repeat(64)}]},oid),/HEADERS_CHANGED/);
});
test('a second compatible profile obeys selected tenure instead of unrelated automatically detected endpoints',()=>{
  const snapshot=source(`<table class="wikitable"><tr><th>Recorded individual</th><th>From</th><th>Until</th><th>Chosen interval</th></tr><tr><td>${person}</td><td>1800</td><td>1801</td><td>1905–1909</td></tr></table>`,32),table=inspectWikipediaTables(snapshot).tables[0];
  const mapped=mapWikipediaProfile(snapshot,{profileId:'office-tenures-v1',tables:[{tableIndex:0,headerHash:table.headerHash,holderColumn:0,tenureColumn:3}]},oid),scope=mapped.artifact.collection.objects.find(o=>o.types.includes('gitworld:source-tenure-scope'))!,index=createKnowledgeIndex(mapped.artifact.collection);
  assert.equal(index.state({objectId:scope.id,year:1907,includeUnreviewed:true}).fields.find(f=>f.propertyId==='office:holder')?.status,'known');
  assert.equal(index.state({objectId:scope.id,year:1800,includeUnreviewed:true}).fields.find(f=>f.propertyId==='office:holder')?.status,'unknown');
});
test('selected start/end columns with actual month-first source dates produce historical state',()=>{
  const snapshot=source(`<table class="wikitable"><tr><th>Portrait</th><th>Number</th><th>Party</th><th>Governor</th><th>Start</th><th>End</th><th>Election</th><th>Note</th></tr><tr><td></td><td>1</td><td></td><td>${person}</td><td>May 3, 1947</td><td>April 18, 1959</td><td></td><td></td></tr></table>`),table=inspectWikipediaTables(snapshot).tables[0];
  const result=mapWikipediaProfile(snapshot,{profileId:'office-tenures-v1',calendar:'Gregorian',tables:[{tableIndex:0,headerHash:table.headerHash,holderColumn:3,startColumn:4,endColumn:5}]},oid);parseKnowledgeImportArtifact(JSON.stringify(result.artifact));
  assert.equal(result.counts.mappedRows,1);assert.equal(result.counts.timedRows,1);assert.equal(result.counts.applicableAssertions,2);assert.equal(result.counts.assertions,2);assert.ok(!result.exceptions.some(e=>e.code==='UNPARSED_TIME'));
  const scope=result.artifact.collection.objects.find(o=>o.types.includes('gitworld:source-tenure-scope'))!,state=createKnowledgeIndex(result.artifact.collection).state({objectId:scope.id,year:1950,includeUnreviewed:true});assert.equal(state.fields.find(f=>f.propertyId==='office:holder')?.status,'known');
  assert.ok(result.artifact.collection.assertions.every(a=>a.review==='unreviewed'));assert.ok(result.artifact.collection.assertions.some(a=>a.validTime?.start?.raw==='May 3, 1947 – April 18, 1959'));
});
test('dated entries retain explicit attributes/links, unresolved dates and a distinct inspectable profile',()=>{
  const snapshot=source('<table class="wikitable"><tr><th>When</th><th>Record</th><th>Related</th></tr><tr><td>630</td><td>Recorded activity</td><td><a href="/wiki/Recorded_B">Recorded B</a></td></tr><tr><td>Unknown</td><td>Undated activity</td><td>Unidentified</td></tr></table>',33),table=inspectWikipediaTables(snapshot).tables[0];
  const mapped=mapWikipediaProfile(snapshot,{profileId:'dated-entries-v1',tableIndex:0,headerHash:table.headerHash,timeColumn:0,columns:[{column:1,kind:'text'},{column:2,kind:'linked-entities'}]},oid),collection=mapped.artifact.collection;
  parseKnowledgeImportArtifact(JSON.stringify(mapped.artifact));assert.equal(mapped.counts.sourceRows,2);assert.equal(mapped.counts.timedRows,1);assert.ok(mapped.exceptions.some(e=>e.code==='UNPARSED_TIME'));assert.ok(mapped.exceptions.some(e=>e.code==='UNRESOLVED_VALUE'));
  const linked=collection.assertions.find(a=>a.value.kind==='entity')!;assert.equal(linked.value.kind,'entity');if(linked.value.kind==='entity')assert.ok(collection.objects.some(o=>o.id===linked.value.objectId));
  assert.ok(!collection.assertions.some(a=>/successor|completed|caused/.test(a.propertyId)));assert.ok(collection.assertions.every(a=>a.review==='unreviewed'));
});
test('dated-entry source columns accept numeric historical dates while approximate entries remain unresolved',()=>{
  const snapshot=source('<table class="wikitable"><tr><th>When</th><th>Location</th></tr><tr><td>512-05-21</td><td>Recorded location</td></tr><tr><td>1038-01-09</td><td>Another location</td></tr><tr><td>c. 1920 BC</td><td>Approximate entry</td></tr></table>',34),table=inspectWikipediaTables(snapshot).tables[0];
  const result=mapWikipediaProfile(snapshot,{profileId:'dated-entries-v1',calendar:'Gregorian',tableIndex:0,headerHash:table.headerHash,timeColumn:0,columns:[{column:1,kind:'text'}]},oid);parseKnowledgeImportArtifact(JSON.stringify(result.artifact));
  assert.equal(result.counts.sourceRows,3);assert.equal(result.counts.mappedRows,3);assert.equal(result.counts.timedRows,2);assert.equal(result.counts.applicableAssertions,4);assert.equal(result.counts.assertions,5);assert.deepEqual(result.exceptions.map(e=>e.code),['UNCERTAIN_TIME']);
  const first=result.artifact.collection.assertions.find(a=>a.propertyId==='event:listed-time'&&a.value.kind==='time'&&a.value.value.earliestYear===512)!;assert.ok(first);assert.equal(first.validTime?.point?.precision,'day');assert.equal(first.validTime?.point?.month,5);assert.equal(first.validTime?.point?.day,21);assert.equal(first.validTime?.point?.raw,'512-05-21');
  const state=createKnowledgeIndex(result.artifact.collection).state({objectId:first.subjectId,year:512,includeUnreviewed:true});assert.ok(state.fields.some(f=>f.status==='known'));assert.ok(result.artifact.collection.assertions.every(a=>a.review==='unreviewed'));assert.ok(result.artifact.collection.assertions.some(a=>!a.validTime&&a.qualifiers.some(q=>q.propertyId==='source:tenure-text'&&q.value.kind==='text'&&q.value.value==='c. 1920 BC')));
});
test('full profile artifacts retain selected-only provisional identity and invalid-date exceptions without applicability',()=>{
  const snapshot=source('<table class="wikitable"><tr><th>Selected holder</th><th>Tenure</th><th>Temple name</th></tr><tr><td>Selected Person A</td><td>1900–1902</td><td><a href="/wiki/Unselected_Person_B">Unselected Person B</a></td></tr></table>'),table=inspectWikipediaTables(snapshot).tables[0],selection={profileId:'office-tenures-v1' as const,calendar:'Gregorian' as const,tables:[{tableIndex:0,headerHash:table.headerHash,holderColumn:0,tenureColumn:1}]};
  const mapped=mapWikipediaProfile(snapshot,selection,oid);parseKnowledgeImportArtifact(JSON.stringify(mapped.artifact));assert.ok(!mapped.artifact.collection.objects.some(o=>o.id==='wikipedia-en:Unselected_Person_B'));assert.ok(mapped.exceptions.some(e=>e.code==='PROVISIONAL_HOLDER'));
  const choices=source('<table class="wikitable"><tr><th>Holder A</th><th>Tenure</th><th>Holder B</th></tr><tr><td>Unlinked A</td><td>1900–1902</td><td>Unlinked B</td></tr></table>'),headers=inspectWikipediaTables(choices).tables[0].headerHash;
  const provisional=(input:WikipediaTableSnapshot,column:number)=>mapWikipediaProfile(input,{profileId:'office-tenures-v1',tables:[{tableIndex:0,headerHash:headers,holderColumn:column,tenureColumn:1}]},oid).artifact.collection.objects.find(o=>o.id.startsWith('wikipedia-provisional:'))!.id;
  assert.notEqual(provisional(choices,0),provisional(choices,2),'Different selected holder cells must not merge by row position');
  const changed=source((choices.raw as any).text.replace('Unlinked A','Another unlinked name'));assert.notEqual(provisional(choices,0),provisional(changed,0),'A changed source snapshot does not establish that its same row is the same unlinked person');
  for(const invalid of ['31 February 1900–1 March 1900','31 December 1900–1 January 1900']){
    const row=source(`<table class="wikitable"><tr><th>Selected holder</th><th>Tenure</th><th>Temple name</th></tr><tr><td>Selected Person A</td><td>${invalid}</td><td>Unselected</td></tr></table>`),result=mapWikipediaProfile(row,selection,oid);parseKnowledgeImportArtifact(JSON.stringify(result.artifact));assert.ok(result.artifact.collection.assertions.every(a=>!a.validTime),invalid);assert.ok(result.exceptions.some(e=>e.code==='UNPARSED_TIME'),invalid);assert.ok(result.artifact.collection.assertions.some(a=>a.qualifiers.some(q=>q.propertyId==='source:tenure-text'&&q.value.kind==='text'&&q.value.value===invalid)));
  }
});
test('profile vocabulary composes with the actual bundled catalog without erasing its semantics or translations',async()=>{
  const directory=new URL('../../../data/seed/east-asia/',import.meta.url),manifestText=await readFile(new URL('manifest.json',directory),'utf8');
  const bundle=await loadTrustedKnowledgeBundle({manifestText,expectedManifestHash:createHash('sha256').update(manifestText).digest('hex'),readText:relative=>readFile(new URL(relative,directory),'utf8')});
  const snapshot=source(`<table class="wikitable"><tr><th>Name</th><th>Reign</th></tr><tr><td>${person}</td><td>1900–1902</td></tr></table>`),table=inspectWikipediaTables(snapshot).tables[0],mapped=mapWikipediaProfile(snapshot,{profileId:'office-tenures-v1',tables:[{tableIndex:0,headerHash:table.headerHash,holderColumn:0,tenureColumn:1}]},oid);
  const seed={schemaVersion:1 as const,kind:'gitworld-knowledge-import' as const,collection:bundle.collection,vocabulary:{id:'review:actual-bundled-vocabulary',revision:'fixture',catalog:bundle.fieldCatalog,origin:{identity:{provider:'fixture',externalId:'fixture'},url:'https://example.invalid/catalog',retrievedAt:'2026-10-25T00:00:00Z',rights:{redistribution:'unknown' as const},evidence:[]}}};
  const files=knowledgeCollectionSeedFiles(bundle.collection);for(const change of planKnowledgeVocabulary(files,seed,knowledgeArtifactHash(seed)).changes)files[change.path]=change.value!;
  const next=planKnowledgeVocabulary(files,mapped.artifact,knowledgeArtifactHash(mapped.artifact));assert.deepEqual(next.conflicts,[]);
});
