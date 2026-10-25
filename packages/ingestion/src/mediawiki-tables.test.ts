import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import type { JsonValue, SourceRecordSnapshot } from './source-types.ts';
import { canonicalSourceJson } from './wikidata.ts';
import { createWikipediaFactsCandidate, extractPublishedTables, fetchWikipediaTablePage, mapWikipediaEventTable, mapWikipediaOfficeTables, parsePublishedTenure } from './mediawiki-tables.ts';

const html = `<script>globalThis.__sourceExecuted = true</script><h2>Source survey</h2><table class="wikitable"><caption><b><a href="/wiki/North_realm" title="North realm">North</a></b> and <a href="/wiki/South_realm" title="South realm">South</a></caption>
<tr><th>Personal name</th><th>Reign</th><th>Life details</th></tr>
<tr><td colspan="3"><h3>Early North</h3><div>See also: unrelated navigation.</div></td></tr>
<tr><td><b><a href="/wiki/Synthetic_Ada" title="Synthetic Ada">Ada</a></b> <span lang="zh-Hant">甲</span></td><td>10 May 100<br>–<br>12 June 110<br>(10 years)<div>Era(s) Not-a-tenure 700–900</div><sup class="reference"><a href="#cite_note-one">[1]</a></sup></td><td>20–120. Source life dates must not become tenure dates. <img src="https://example.invalid/portrait.jpg"></td></tr>
<tr><td><a href="/wiki/Synthetic_Bea" title="Synthetic Bea">Bea</a></td><td>111–120</td><td>50–150</td></tr>
<tr><td colspan="3"><h3>North restoration</h3></td></tr>
<tr><td><a href="/wiki/Synthetic_Ada" title="Synthetic Ada">Ada</a></td><td>121–130</td><td>20–150</td></tr>
</table>`;
function snapshot(text = html): SourceRecordSnapshot {
  const raw = { title: 'Synthetic office survey', pageid: 1001, revid: 5001, text };
  return { identity: { provider: 'wikipedia-en', externalId: '1001' }, sourceRevision: '5001', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://en.wikipedia.org/wiki/Synthetic_office_survey', revisionUrl: 'https://en.wikipedia.org/w/index.php?oldid=5001', contentHash: createHash('sha256').update(canonicalSourceJson(raw)).digest('hex'), mediaType: 'application/json', raw, rights: { licenseId: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', redistribution: 'allowed' }, adapterVersion: 'synthetic-fixture-only' };
}

test('inert HTML tables preserve names, source groups, citations and repeated terms without reading life or era dates', () => {
  const input = snapshot(), original = structuredClone(input), result = mapWikipediaOfficeTables(input);
  assert.deepEqual(input, original); assert.equal((globalThis as any).__sourceExecuted, undefined);
  assert.equal(result.report.mappedRows, 3); assert.equal(result.report.timedRows, 3);
  const ada = result.collection.objects.find(value => value.id === 'wikipedia-en:Synthetic_Ada')!; assert.equal(ada.labels['zh-Hant'], '甲');
  const adaTerms = result.collection.assertions.filter(value => value.subjectId === ada.id); assert.equal(adaTerms.length, 2);
  assert.deepEqual(adaTerms.map(value => value.validTime!.start!.earliestYear), [100, 121]);
  assert.equal(new Set(adaTerms.map(value => (value.value as any).objectId)).size, 1);
  assert.ok(adaTerms[0].qualifiers.some(value => value.propertyId === 'source:citation-anchors' && (value.value as any).value.includes('#cite_note-one')));
  assert.ok(result.collection.assertions.every(value => value.review === 'unreviewed'));
  assert.ok(!JSON.stringify(result.collection.objects).includes('unrelated navigation'));
  const officeId = (adaTerms[0].value as any).objectId, index = createKnowledgeIndex(result.collection);
  assert.equal(index.diff({ objectId: officeId, year: 105, includeUnreviewed: true }, { objectId: officeId, year: 115, includeUnreviewed: true }).fields[0].kind, 'changed');
  assert.ok(!JSON.stringify(result.collection.objects).includes('portrait.jpg')); assert.ok(!('parents' in ada));
});

test('split date lines and shared month/year syntax retain original precision and open bounds', () => {
  const range = parsePublishedTenure('18 July – 14 August 74 BCE\n(27 days)');
  assert.equal(range.validTime!.start!.earliestYear, -74); assert.equal(range.validTime!.start!.month, 7); assert.equal(range.validTime!.end!.month, 8);
  const days = parsePublishedTenure('1–12 July 1917'); assert.equal(days.validTime!.start!.day, 1); assert.equal(days.validTime!.start!.earliestYear, 1917);
  const split = parsePublishedTenure('1 May 2019\n–\npresent\n(7 years)\nEra name');
  assert.equal(split.issue, 'OPEN_END'); assert.equal(split.validTime!.start!.earliestYear, 2019); assert.equal(split.validTime!.end, undefined);
  assert.equal(parsePublishedTenure('c. 100–200').validTime, undefined);
  assert.equal(parsePublishedTenure('4 January 1975 – 8 January 1976†').validTime!.end!.earliestYear, 1976);
  assert.equal(parsePublishedTenure('1568 – abdicated 1588').validTime!.end!.earliestYear, 1588);
  assert.equal(parsePublishedTenure('907–912\n(4–5 years)\nEras\nOther name 900–1000').validTime!.end!.earliestYear, 912);
  assert.equal(parsePublishedTenure('100–110 (first term)\n120–130 (second term)').validTime, undefined);
  assert.equal(parsePublishedTenure("1318–1339\n(21 years)\nBunpō, Genkō (1321–24)", { trailingEraNames: true }).validTime!.end!.earliestYear, 1339);
  assert.equal(parsePublishedTenure('100–110 (first term)\n120–130 (second term)', { trailingEraNames: true }).validTime, undefined);
  assert.equal(parsePublishedTenure('100–110 (10 years)\n120–130 (10 years)', { trailingEraNames: true }).validTime, undefined);
});

test('civil dates validate month lengths, leap rules, open starts and within-year order without changing calendars', () => {
  for (const input of ['31 February 1900–1 March 1900','31 April 1900–1 May 1900','29 February 1900','29 February 2100','31 December 1900–1 January 1900','10 May 1900–1 May 1900','December 1900–January 1900','31 February 1900–present','0 January 1900','32 January 1900']) {
    const parsed=parsePublishedTenure(input,{calendar:'Gregorian'});assert.equal(parsed.validTime,undefined,input);assert.equal(parsed.issue,'UNPARSED_TIME',input);assert.equal(parsed.raw,input);
  }
  for(const year of [1600,1904,2000,2400]){const parsed=parsePublishedTenure(`29 February ${year}`,{calendar:'Gregorian'});assert.equal(parsed.validTime?.start?.day,29);assert.equal(parsed.validTime?.start?.calendar,'Gregorian');}
  const julian=parsePublishedTenure('29 February 1900–1 March 1900',{calendar:'Julian'});assert.equal(julian.validTime?.start?.day,29);assert.equal(julian.validTime?.start?.month,2);assert.equal(julian.validTime?.start?.calendar,'Julian');assert.equal(julian.validTime?.start?.earliestYear,1900);
  assert.equal(parsePublishedTenure('29 February 1901',{calendar:'Julian'}).validTime,undefined);
  assert.equal(parsePublishedTenure('29 February 1900–present',{calendar:'Julian'}).issue,'OPEN_END');
  assert.equal(parsePublishedTenure('29 February 1 BCE',{calendar:'Gregorian'}).validTime?.start?.earliestYear,-1);
  assert.equal(parsePublishedTenure('29 February 5 BCE',{calendar:'Julian'}).validTime?.start?.earliestYear,-5);
  assert.equal(parsePublishedTenure('29 February 4 BCE',{calendar:'Julian'}).validTime,undefined);
  assert.equal(parsePublishedTenure('31 December 1 BCE–1 January 1 CE',{calendar:'Gregorian'}).validTime?.end?.earliestYear,1);
  assert.equal(parsePublishedTenure('29 February 1900').issue,'UNCERTAIN_TIME');assert.equal(parsePublishedTenure('29 February 1900').validTime,undefined);
  assert.equal(parsePublishedTenure('29 February 2000').validTime?.start?.calendar,'published-source-calendar-unspecified');
  assert.equal(parsePublishedTenure('1900–1902',{calendar:'source-unspecified'}).validTime?.start?.calendar,'source-unspecified');
  assert.equal(parsePublishedTenure('1 May 1900',{calendar:'unsupported-calendar'}).validTime,undefined);
  assert.equal(parsePublishedTenure('1900–1902',{calendar:'unsupported-calendar'}).issue,'UNCERTAIN_TIME');
});

test('month-first English dates retain raw source precision and the existing civil validation',()=>{
  for(const text of ['May 3, 1947–April 18, 1959','May 3 1947–April 18 1959','May 3,\n1947 – April 18,\n1959']){
    const result=parsePublishedTenure(text,{calendar:'Gregorian'});assert.equal(result.issue,undefined);assert.equal(result.raw,text);assert.deepEqual([result.validTime?.start?.earliestYear,result.validTime?.start?.month,result.validTime?.start?.day],[1947,5,3]);assert.deepEqual([result.validTime?.end?.earliestYear,result.validTime?.end?.month,result.validTime?.end?.day],[1959,4,18]);assert.equal(result.validTime?.start?.calendar,'Gregorian');
  }
  for(const text of ['February 31, 1900–March 1, 1900','February 29, 1900','December 31, 1900–January 1, 1900','May 0, 1900','May 3rd, 1947']){const result=parsePublishedTenure(text,{calendar:'Gregorian'});assert.equal(result.validTime,undefined,text);assert.equal(result.issue,'UNPARSED_TIME',text);assert.equal(result.raw,text);}
  const julian=parsePublishedTenure('February 29, 1900–March 1, 1900',{calendar:'Julian'});assert.equal(julian.validTime?.start?.day,29);assert.equal(julian.validTime?.start?.month,2);assert.equal(julian.validTime?.start?.calendar,'Julian');
  assert.equal(parsePublishedTenure('February 29, 1900').issue,'UNCERTAIN_TIME');assert.equal(parsePublishedTenure('February 29, 1 BCE',{calendar:'Gregorian'}).validTime?.start?.earliestYear,-1);
  assert.equal(parsePublishedTenure('May 3, 1947–present',{calendar:'Gregorian'}).issue,'OPEN_END');assert.equal(parsePublishedTenure('February 31, 1900–present',{calendar:'Gregorian'}).validTime,undefined);
});

test('explicit numeric historical dates preserve internal hyphens, source precision and civil constraints',()=>{
  for(const text of ['512-05-21','1038-01-09','1290-09-27','1303-09-25']){
    const result=parsePublishedTenure(text,{calendar:'Gregorian'}),[year,month,day]=text.split('-').map(Number);assert.equal(result.issue,undefined,text);assert.equal(result.raw,text);assert.deepEqual([result.validTime?.start?.earliestYear,result.validTime?.start?.month,result.validTime?.start?.day],[year,month,day]);assert.equal(result.validTime?.start?.precision,'day');assert.equal(result.validTime?.start?.calendar,'Gregorian');
  }
  for(const text of ['1900-02-31','1900-02-29','1900-13-01','1900-01-00','0000-01-01','1900-12-31–1900-01-01','512-5-21']){const result=parsePublishedTenure(text,{calendar:'Gregorian'});assert.equal(result.validTime,undefined,text);assert.equal(result.issue,'UNPARSED_TIME',text);assert.equal(result.raw,text);}
  assert.equal(parsePublishedTenure('1900-02-29',{calendar:'Julian'}).validTime?.start?.day,29);assert.equal(parsePublishedTenure('1900-02-29').issue,'UNCERTAIN_TIME');assert.equal(parsePublishedTenure('1-02-29 BCE',{calendar:'Gregorian'}).validTime?.start?.earliestYear,-1);
  for(const separator of ['–',' - ','-']){const result=parsePublishedTenure(`512-05-21${separator}513-05-21`,{calendar:'Gregorian'});assert.equal(result.validTime?.start?.earliestYear,512);assert.equal(result.validTime?.end?.earliestYear,513);}
  assert.equal(parsePublishedTenure('1900-01-01–present',{calendar:'Gregorian'}).issue,'OPEN_END');assert.equal(parsePublishedTenure('1900-02-31–present',{calendar:'Gregorian'}).validTime,undefined);assert.equal(parsePublishedTenure('c. 1920 BC',{calendar:'Gregorian'}).issue,'UNCERTAIN_TIME');assert.equal(parsePublishedTenure('512-05-21',{calendar:'unsupported-calendar'}).issue,'UNCERTAIN_TIME');
});

test('explicit holder columns cannot borrow an unselected name or linked identity',()=>{
  const headers=['Selected holder','Tenure','Temple name'],source=snapshot('<table class="wikitable"><tr><th>Selected holder</th><th>Tenure</th><th>Temple name</th></tr><tr><td>Selected Person A</td><td>1900–1902</td><td><a href="/wiki/Unselected_Person_B">Unselected Person B</a></td></tr></table>');
  const profile={id:'selected-holder-only',revision:'5001',tables:[{index:0,expectedHeaders:headers,holderColumn:0,tenureColumn:1}]},mapped=mapWikipediaOfficeTables(source,{profile});
  assert.ok(!mapped.collection.objects.some(o=>o.id==='wikipedia-en:Unselected_Person_B'));assert.ok(mapped.collection.objects.some(o=>o.id.startsWith('wikipedia-provisional:')&&o.labels.en==='Selected Person A'));assert.ok(mapped.issues.some(i=>i.code==='PROVISIONAL_HOLDER'));
  const empty=snapshot('<table class="wikitable"><tr><th>Selected holder</th><th>Tenure</th><th>Temple name</th></tr><tr><td></td><td>1900–1902</td><td><a href="/wiki/Unselected_Person_B">Unselected Person B</a></td></tr></table>'),unresolved=mapWikipediaOfficeTables(empty,{profile});assert.equal(unresolved.report.mappedRows,0);assert.ok(unresolved.issues.some(i=>i.code==='PROVISIONAL_HOLDER'));
});

test('rowspans retain real separate dates but election continuation rows do not invent additional terms', () => {
  const source = snapshot(`<table class="wikitable"><caption>Office survey</caption><tr><th rowspan="2">Name (Birth–Death)</th><th colspan="2">Term of office</th><th rowspan="2">Election</th></tr><tr><th>Start</th><th>End</th></tr>
<tr><td rowspan="2"><a href="/wiki/Kazoku#Count">Count</a><br><b><a href="/wiki/Synthetic_Ada" title="Synthetic Ada">Ada</a></b><br>(20–150)</td><td rowspan="2">1 May<br>100</td><td rowspan="2">2 June<br>110</td><td>100</td></tr><tr><td>105</td></tr>
<tr><td><a href="/wiki/Synthetic_Ada" title="Synthetic Ada">Ada</a></td><td>120</td><td>130</td><td>120</td></tr></table>`);
  const tables = extractPublishedTables((source.raw as any).text); assert.equal(tables[0].headers[1], 'Term of office / Start');
  const result = mapWikipediaOfficeTables(source); assert.equal(result.report.sourceRows, 3); assert.equal(result.report.mappedRows, 2); assert.equal(result.report.timedRows, 2);
  assert.ok(!result.collection.objects.some(value => value.id.includes('Kazoku')));
  assert.equal(result.collection.objects.filter(value => value.types.includes('gitworld:office-holder')).length, 1);
});

test('alternative chronologies and speculative reign lengths stay searchable without becoming precise dated states', () => {
  const source = snapshot(`<h2>Traditional chronology</h2><table class="wikitable"><tr><th>Name</th><th colspan="2">Tentative reign (BCE)</th></tr><tr><th></th><th>Source A</th><th>Source B</th></tr><tr><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td>600–500</td><td>580–480</td></tr></table>
<table class="wikitable"><tr><th>Name</th><th>Speculative reign length</th></tr><tr><td><a href="/wiki/Synthetic_Bea">Bea</a></td><td>45</td></tr></table>`);
  const result = mapWikipediaOfficeTables(source); assert.equal(result.report.mappedRows, 2); assert.equal(result.report.timedRows, 0);
  assert.ok(result.issues.some(value => value.code === 'SOURCE_CHRONOLOGY_WARNING'));
  assert.ok(result.collection.assertions.some(value => value.qualifiers.some(value => value.propertyId === 'source:alternative-tenure-columns')));
  assert.equal(createKnowledgeIndex(result.collection).query({ text: 'Ada', includeUndated: true }).total, 1);
  const warned = snapshot(`<table class="wikitable"><tr><th>Name</th><th>Reign</th><th>Life details</th></tr><tr><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td>100–110</td><td>Legendary. A source narrative that stays in the raw archive.</td></tr></table>`);
  assert.ok(mapWikipediaOfficeTables(warned).issues.some(value => value.details?.includes('source narrative')));
  assert.ok(!JSON.stringify(createWikipediaFactsCandidate(warned)).includes('source narrative'));
});

test('de jure and de facto source claims retain distinct authority semantics', () => {
  const source = snapshot(`<table class="wikitable"><tr><th>Name (Birth–Death)</th><th>Office from</th><th>Office until</th></tr><tr><td rowspan="2"><a href="/wiki/Synthetic_Ada">Ada</a></td><td rowspan="2">100</td><td>de jure<br>110</td></tr><tr><td>de facto<br>120</td></tr></table>`);
  const result = mapWikipediaOfficeTables(source); assert.equal(result.report.timedRows, 2);
  const terms = result.collection.assertions.filter(value => value.propertyId === 'office:held-position');
  assert.deepEqual(terms.map(value => value.qualifiers.find(value => value.propertyId === 'office:authority-basis')!.value), [{ kind: 'text', value: 'de-jure' }, { kind: 'text', value: 'de-facto' }]);
});

test('publication candidates contain fact cells and executable attribution links, with separate hashes and no raw article', () => {
  const input = snapshot(), result = createWikipediaFactsCandidate(input), serialized = JSON.stringify(result.collection);
  assert.equal(result.manifest.licenseId, 'CC-BY-SA-4.0'); assert.ok(result.manifest.historyUrl.endsWith('&action=history')); assert.ok(result.manifest.permanentRevisionUrl.endsWith('&oldid=5001'));
  assert.equal(result.manifest.upstreamSnapshotHash, input.contentHash);
  assert.ok(!/<(?:img|table|script)\b/i.test(serialized)); assert.ok(!serialized.includes('Source life dates must not become tenure dates'));
  assert.notEqual(result.collection.sources[0].contentHash, input.contentHash);
  assert.equal(result.collection.sources[0].contentHash, createHash('sha256').update(canonicalSourceJson(result.collection.sources[0].record as JsonValue)).digest('hex'));
  assert.ok(result.collection.assertions.every(value => /^\$\.facts\[\d+\]$/.test(value.evidence[0].locator)));
  createKnowledgeIndex(result.collection);
  assert.throws(() => createWikipediaFactsCandidate({ ...input, rights: { ...input.rights, redistribution: 'unknown' } }), /WIKIPEDIA_FACTS_LICENSE_REQUIRED/);
});

test('acquisition preserves real revision identity, maxlag and full raw source while refusing a revision mismatch', async () => {
  const raw = snapshot().raw;
  const fetcher = async (request: RequestInfo | URL) => { const url = new URL(String(request)); assert.equal(url.searchParams.get('maxlag'), '5'); assert.equal(url.searchParams.has('page'), !url.searchParams.has('oldid')); return Response.json({ parse: raw }); };
  const result = await fetchWikipediaTablePage({ title: 'Synthetic office survey', revision: 5001 }, { fetch: fetcher });
  assert.equal(result.ok, true); if (result.ok) { assert.deepEqual(result.value.raw, raw); assert.equal(result.value.sourceRevision, '5001'); assert.ok(result.value.rights.attribution!.includes('&action=history')); }
  const mismatch = await fetchWikipediaTablePage({ title: 'Synthetic office survey', revision: 6001 }, { fetch: fetcher }); assert.equal(mismatch.ok, false); if (!mismatch.ok) assert.equal(mismatch.error.code, 'INVALID_RESPONSE');
});

test('backpressure, bad responses, limits and cancellation are explicit without a substitute success', async () => {
  let calls = 0;
  const busy = await fetchWikipediaTablePage({ title: 'Synthetic' }, { fetch: async () => { calls++; return Response.json({ error: { code: 'maxlag' } }); } });
  assert.equal(calls, 1); assert.equal(busy.ok, false); if (!busy.ok) assert.equal(busy.error.code, 'UPSTREAM_BUSY');
  const rate = await fetchWikipediaTablePage({ title: 'Synthetic' }, { fetch: async () => new Response(null, { status: 429, headers: { 'retry-after': '30' } }) }); assert.equal(rate.ok, false); if (!rate.ok) assert.equal(rate.error.retryAfterMs, 30000);
  const bad = await fetchWikipediaTablePage({ title: 'Synthetic' }, { fetch: async () => new Response('not JSON') }); assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.error.code, 'INVALID_RESPONSE');
  const large = await fetchWikipediaTablePage({ title: 'Synthetic' }, { fetch: async () => new Response('', { headers: { 'content-length': String(9 * 1024 * 1024) } }) }); assert.equal(large.ok, false); if (!large.ok) assert.equal(large.error.code, 'RESPONSE_TOO_LARGE');
  const controller = new AbortController(); controller.abort(); const cancelled = await fetchWikipediaTablePage({ title: 'Synthetic', signal: controller.signal }); assert.equal(cancelled.ok, false); if (!cancelled.ok) assert.equal(cancelled.error.code, 'CANCELLED');
});

test('explicit column profiles pin revision and headers while excluding spanning commentary from appointment facts', () => {
  const input = snapshot(`<table class="wikitable"><tr><th>Name</th><th colspan="2">Term of office</th></tr><tr><td rowspan="2"><a href="/wiki/Synthetic_Ada">Ada</a></td><td>100</td><td>110</td></tr><tr><td colspan="2">A long editorial account of unrelated changes in the regime.</td></tr></table>`);
  const tables = extractPublishedTables((input.raw as any).text), profile = { id: 'synthetic-columns-v1', revision: '5001', tables: [{ index: 0, expectedHeaders: tables[0].headers, holderColumn: 0, startColumn: 1, endColumn: 2, context: { id: 'synthetic:office', label: 'Synthetic office' } }] };
  const mapped = mapWikipediaOfficeTables(input, { profile }); assert.equal(mapped.report.mappedRows, 1); assert.equal(mapped.report.timedRows, 1);
  const candidate = createWikipediaFactsCandidate(input, { profile }); assert.ok(!JSON.stringify(candidate.collection).includes('long editorial account'));
  assert.throws(() => mapWikipediaOfficeTables(input, { profile: { ...profile, revision: '6001' } }), /INVALID_WIKIPEDIA_TABLE_PROFILE/);
  assert.throws(() => mapWikipediaOfficeTables(input, { profile: { ...profile, tables: [{ ...profile.tables[0], expectedHeaders: ['wrong'] }] } }), /INVALID_WIKIPEDIA_TABLE_PROFILE/);
});

test('a profiled institutional field can change during one holder\'s service through the ordinary state diff', () => {
  const input = snapshot(`<table class="wikitable"><tr><th>Name</th><th>Start</th><th>End</th><th>Cabinet</th></tr><tr><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td>100</td><td>110</td><td>First cabinet</td></tr><tr><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td>111</td><td>120</td><td>Second cabinet</td></tr></table>`);
  const profile = { id: 'synthetic-institution-field-v1', revision: '5001', tables: [{ index: 0, expectedHeaders: ['Name', 'Start', 'End', 'Cabinet'], holderColumn: 0, startColumn: 1, endColumn: 2, context: { id: 'synthetic:office', label: 'Synthetic office' }, stateColumns: [{ column: 3, propertyId: 'office:listed-cabinet' }] }] };
  const result = createWikipediaFactsCandidate(input, { profile }), office = result.collection.objects.find(value => value.types.includes('gitworld:office'))!;
  const diff = createKnowledgeIndex(result.collection).diff({ objectId: office.id, year: 105, includeUnreviewed: true }, { objectId: office.id, year: 115, includeUnreviewed: true });
  assert.equal(diff.fields.find(value => value.propertyId === 'office:holder')!.kind, 'same');
  assert.equal(diff.fields.find(value => value.propertyId === 'office:listed-cabinet')!.kind, 'changed');
  assert.equal(result.manifest.factRows, 2); assert.equal(result.manifest.factRecords, 4);
  assert.ok(result.collection.assertions.every(value => !value.evidence[0].locator.includes('-1')));
});

test('explicit current readings add one observation while old revisions and bare open dates do not invent incumbency', () => {
  const current = { ...snapshot('<table class="wikitable"><tr><th>Name</th><th>Reign</th></tr><tr><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td>1 May 2019<br>–<br>present<br>(7 years)</td></tr></table>'), retrievalMode: 'current-page' as const };
  const result = createWikipediaFactsCandidate(current, { observeExplicitPresent: true }), office = result.collection.objects.find(value => value.types.includes('gitworld:office'))!;
  const sourceTerm = result.collection.assertions.find(value => value.propertyId === 'office:held-position')!; assert.equal(sourceTerm.validTime!.end, undefined);
  const point = result.collection.assertions.find(value => value.qualifiers.some(value => value.propertyId === 'observation:kind'))!;
  assert.equal(point.validTime!.point!.raw, current.retrievedAt); assert.equal(point.validTime!.point!.earliestYear, 2026);
  const index = createKnowledgeIndex(result.collection); assert.equal(index.state({ objectId: office.id, year: 2026, includeUnreviewed: true }).fields[0].status, 'known'); assert.equal(index.state({ objectId: office.id, year: 2027, includeUnreviewed: true }).fields[0].status, 'unknown');
  const historical = mapWikipediaOfficeTables({ ...current, retrievalMode: 'fixed-revision' }, { observeExplicitPresent: true }); assert.equal(historical.collection.assertions.some(value => value.qualifiers.some(value => value.propertyId === 'observation:kind')), false);
  const bare = { ...snapshot('<table class="wikitable"><tr><th>Name</th><th>Reign</th></tr><tr><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td>2019–<div>Era(s) current era</div></td></tr></table>'), retrievalMode: 'current-page' as const };
  assert.equal(mapWikipediaOfficeTables(bare, { observeExplicitPresent: true }).collection.assertions.some(value => value.qualifiers.some(value => value.propertyId === 'observation:kind')), false);
  const cabinet = { ...snapshot('<table class="wikitable"><tr><th>Name</th><th>Start</th><th>End</th><th>Cabinet</th></tr><tr><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td>2023</td><td>Incumbent</td><td>Third cabinet</td></tr></table>'), retrievalMode: 'current-page' as const };
  const profile = { id: 'synthetic-current-cabinet-v1', revision: '5001', tables: [{ index: 0, expectedHeaders: ['Name', 'Start', 'End', 'Cabinet'], holderColumn: 0, startColumn: 1, endColumn: 2, stateColumns: [{ column: 3, propertyId: 'office:listed-cabinet' }] }] };
  const fields = createWikipediaFactsCandidate(cabinet, { profile, observeExplicitPresent: true });
  const currentFields = fields.collection.assertions.filter(value => value.qualifiers.some(value => value.propertyId === 'observation:kind'));
  assert.deepEqual(currentFields.map(value => value.propertyId).sort(), ['office:holder', 'office:listed-cabinet']);
  assert.ok(currentFields.every(value => value.validTime?.point?.earliestYear === 2026));
});

test('declared event tables retain dated participant links and explicit cancellation without inventing successful journeys', () => {
  const input = snapshot(`<table class="wikitable"><tr><th>Year</th><th>Sender</th><th>Counterpart</th><th>Comments</th></tr><tr><td>630</td><td><a href="/wiki/Synthetic_Ada">Ada</a></td><td><a href="/wiki/Synthetic_Bea">Bea</a></td><td>Outcome not stated here.</td></tr><tr><td>894</td><td><a href="/wiki/Synthetic_Cora">Cora</a></td><td><a href="/wiki/Synthetic_Dara">Dara</a></td><td>The mission was cancelled. This paragraph must not be copied into the factual subset.</td></tr></table>`);
  const profile = { id: 'synthetic-event-table-v1', revision: '5001', tableIndex: 0, expectedHeaders: ['Year', 'Sender', 'Counterpart', 'Comments'], timeColumn: 0, labels: { en: 'Source mission entry', 'zh-CN': '来源使团记录' }, columns: [{ column: 1, propertyId: 'contact:listed-sender', kind: 'linked-entities' as const }, { column: 2, propertyId: 'contact:listed-counterpart', kind: 'linked-entities' as const }], statusRules: [{ column: 3, contains: 'cancelled', status: 'cancelled' }] };
  const result = mapWikipediaEventTable(input, profile); assert.equal(result.report.mappedRows, 2); assert.equal(result.report.timedRows, 2);
  const statuses = result.collection.assertions.filter(value => value.propertyId === 'event:listed-status'); assert.equal(statuses.length, 1); assert.deepEqual(statuses[0].value, { kind: 'text', value: 'cancelled' });
  assert.ok(result.collection.assertions.some(value => value.propertyId === 'contact:listed-counterpart' && value.value.kind === 'entity' && value.value.objectId === 'wikipedia-en:Synthetic_Bea'));
  assert.equal(createKnowledgeIndex(result.collection).query({ time: [630, 630] }).total, 1);
  const candidate = createWikipediaFactsCandidate(input, { eventProfile: profile });
  assert.ok(!JSON.stringify(candidate.collection).includes('This paragraph must not be copied')); assert.ok(!('parents' in candidate.collection.objects[0]));
  assert.ok(!candidate.collection.assertions.some(value => value.value.kind === 'text' && value.value.value === 'completed'));
});
