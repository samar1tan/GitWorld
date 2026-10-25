import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKnowledgeIndex, type KnowledgeCollection, type KnowledgeObject } from '../../domain/src/knowledge.ts';
import { canonicalSourceJson } from './wikidata.ts';
import type { SourceRecordSnapshot } from './source-types.ts';
import { inspectPublishedFields, projectEvidencedFields, type EvidencedFieldPlan, type EvidencedSourceProfile } from './evidenced-field-projection.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const object = (id: string, type = 'institution'): KnowledgeObject => ({ id, types: [type], identities: [], labels: { en: id, 'zh-CN': `${id}测试对象` }, descriptions: {}, aliases: [] });
const input = (): KnowledgeCollection => ({ schemaVersion: 1, objects: [object('institution'), object('incorporator', 'polity'), object('incorporated', 'polity')], assertions: [], sources: [] });
function snapshot(id: string, html: string, revision = '1'): SourceRecordSnapshot {
  const raw = { html };
  return { identity: { provider: 'synthetic-published-source', externalId: id }, sourceRevision: revision, retrievedAt: '2026-10-25T00:00:00Z', url: `https://example.invalid/${id}`, revisionUrl: `https://example.invalid/${id}?revision=${revision}`, raw, contentHash: hash(canonicalSourceJson(raw)), mediaType: 'text/html', rights: { licenseId: 'CC0-1.0', redistribution: 'allowed', attribution: 'Original synthetic test fixture.' }, adapterVersion: 'test' };
}
function profile(source: SourceRecordSnapshot, facts: EvidencedSourceProfile['facts']): EvidencedSourceProfile {
  return { id: `${source.identity.externalId}-${source.sourceRevision}`, identity: source.identity, revision: source.sourceRevision, contentHash: source.contentHash, citation: { title: 'Synthetic source', language: 'en', creator: 'GitWorld test authors', rightsEvidence: ['https://example.invalid/license'], rightsNote: 'Original synthetic fixture, not copied historical material.' }, facts };
}
function plan(profiles: EvidencedSourceProfile[]): EvidencedFieldPlan {
  return { schemaVersion: 1, id: 'synthetic-evidenced-fields', revision: '1', preparedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/profile', rights: { licenseId: 'CC0-1.0', redistribution: 'allowed' }, profiles, objects: [], statements: [], fieldCatalog: { schemaVersion: 1, kind: 'historical-field-display-labels', properties: [{ id: 'institution:role', labels: { en: 'Legal role', 'zh-CN': '法定职责' } }], types: [], values: [] } };
}
const interpretation = { en: 'Explicit source-field interpretation; no ancestry inferred.', 'zh-CN': '依据来源字段的明确建模解释；不推导继承关系。' };

test('another source uses the same field and section selectors with explicit role/outcome evidence', () => {
  const source = snapshot('integration', '<script>SHOULD_NOT_RUN</script><table class="infobox"><tr><th>Outcome</th><td>Political integration</td></tr><tr><th>Participants</th></tr><tr><td>Receiving polity</td><td>Incorporated polity</td></tr><tr><th>Date</th><td>280<sup class="reference"><a href="#cite_note-date">[1]</a></sup></td></tr></table>');
  source.raw = { text: (source.raw as any).html }; source.contentHash = hash(canonicalSourceJson(source.raw));
  const selected = profile(source, [
    { id: 'outcome', selector: { kind: 'table-field', tableClass: 'infobox', tableIndex: 0, header: 'Outcome' }, textHash: hash('Political integration'), includeText: true },
    { id: 'receiver', selector: { kind: 'section-cell', tableClass: 'infobox', tableIndex: 0, heading: 'Participants', rowOffset: 1, column: 0 }, textHash: hash('Receiving polity') },
    { id: 'target', selector: { kind: 'section-cell', tableClass: 'infobox', tableIndex: 0, heading: 'Participants', rowOffset: 1, column: 1 }, textHash: hash('Incorporated polity') },
    { id: 'date', selector: { kind: 'table-field', tableClass: 'infobox', tableIndex: 0, header: 'Date' }, textHash: hash('280') },
  ]);
  const rules = plan([selected]); rules.objects = [object('integration-event', 'political-integration')];
  const inspected = inspectPublishedFields(source, selected.facts.map(value => ({ id: value.id, selector: value.selector })));
  assert.equal(inspected[0].matches[0].text, 'Political integration'); assert.equal(inspected[0].matches[0].textHash, selected.facts[0].textHash);
  rules.statements = [{ id: 'receiver', subjectId: 'integration-event', propertyId: 'transformation:incorporating-polity', value: { kind: 'entity', objectId: 'incorporator' }, factKeys: [`${selected.id}:receiver`, `${selected.id}:outcome`], timeFactKeys: [`${selected.id}:date`], validTime: { point: { earliestYear: 280, latestYear: 280, precision: 'year', calendar: 'source-unspecified' } }, interpretation }];
  const before = input(), original = structuredClone(before), result = projectEvidencedFields(before, [source], rules);
  assert.equal(result.status, 'mapped'); assert.deepEqual(before, original); assert.equal(result.collection.assertions[0].review, 'unreviewed');
  assert.equal(result.collection.assertions[0].evidence.length, 3); assert.ok(result.facts.some(fact => fact.text === 'Political integration'));
  assert.deepEqual(result.facts.find(fact => fact.factId === 'date')!.referenceAnchors, ['#cite_note-date']);
  assert.ok(result.facts.every(fact => fact.locator.startsWith('$.text;')));
  assert.equal(JSON.stringify(result.collection.sources).includes('SHOULD_NOT_RUN'), false); assert.ok(!result.collection.assertions.some(claim => /parent|successor/.test(claim.propertyId)));
});

test('missing or changed outcome blocks the entire event rather than creating an unsupported typed shell', () => {
  const source = snapshot('outcome', '<table class="infobox"><tr><th>Result</th><td>Military victory</td></tr></table>');
  const selected = profile(source, [{ id: 'outcome', selector: { kind: 'table-field', tableClass: 'infobox', tableIndex: 0, header: 'Territorial changes' }, textHash: hash('Political integration') }]);
  const rules = plan([selected]); rules.objects = [object('event', 'political-integration')]; rules.statements = [{ id: 'outcome', subjectId: 'event', propertyId: 'outcome', value: { kind: 'text', value: 'integration' }, factKeys: [`${selected.id}:outcome`], interpretation }];
  const before = input(), result = projectEvidencedFields(before, [source], rules); assert.equal(result.status, 'blocked'); assert.deepEqual(result.collection, before); assert.equal(result.issues[0].code, 'FACT_MISSING');
  selected.facts[0].selector = { kind: 'table-field', tableClass: 'infobox', tableIndex: 0, header: 'Result' };
  assert.equal(projectEvidencedFields(before, [source], rules).issues[0].code, 'FACT_CHANGED');
});

test('legal fields change with the same institution; annual overlap retains both regimes without extending evidence limits', () => {
  const source = snapshot('laws', '<p id="before">Earlier legal instrument, effective 1900 to 3 May 1950.</p><p id="after">Later legal instrument, effective 3 May 1950; unchanged through February 2006.</p>');
  const selected = profile(source, [
    { id: 'before', selector: { kind: 'element', tag: 'p', id: 'before' }, textHash: hash('Earlier legal instrument, effective 1900 to 3 May 1950.') },
    { id: 'after', selector: { kind: 'element', tag: 'p', id: 'after' }, textHash: hash('Later legal instrument, effective 3 May 1950; unchanged through February 2006.') },
  ]), rules = plan([selected]);
  rules.statements = [
    { id: 'earlier-role', subjectId: 'institution', propertyId: 'institution:role', value: { kind: 'text', value: 'sovereign-legal-role' }, factKeys: [`${selected.id}:before`], timeFactKeys: [`${selected.id}:before`], validTime: { start: { earliestYear: 1900, latestYear: 1900, precision: 'year', calendar: 'gregorian' }, end: { earliestYear: 1950, latestYear: 1950, month: 5, day: 2, precision: 'day', calendar: 'gregorian' } }, interpretation },
    { id: 'later-role', subjectId: 'institution', propertyId: 'institution:role', value: { kind: 'text', value: 'symbolic-legal-role' }, factKeys: [`${selected.id}:after`], timeFactKeys: [`${selected.id}:after`], validTime: { start: { earliestYear: 1950, latestYear: 1950, month: 5, day: 3, precision: 'day', calendar: 'gregorian' }, end: { earliestYear: 2006, latestYear: 2006, month: 2, precision: 'month', calendar: 'gregorian' } }, interpretation },
  ];
  const result = projectEvidencedFields(input(), [source], rules), index = createKnowledgeIndex(result.collection);
  assert.equal(index.state({ objectId: 'institution', year: 1940, includeUnreviewed: true }).fields[0].status, 'known');
  assert.equal(index.state({ objectId: 'institution', year: 1950, includeUnreviewed: true }).fields[0].status, 'multiple');
  assert.deepEqual(result.collection.assertions.map(claim => [claim.validTime?.start?.day, claim.validTime?.end?.day]), [[undefined, 2], [3, undefined]]);
  assert.equal(index.state({ objectId: 'institution', year: 1960, includeUnreviewed: true }).fields[0].status, 'known');
  assert.equal(index.state({ objectId: 'institution', year: 2010, includeUnreviewed: true }).fields[0].status, 'unknown');
  assert.equal(index.diff({ objectId: 'institution', year: 1940, includeUnreviewed: true }, { objectId: 'institution', year: 1960, includeUnreviewed: true }).fields[0].kind, 'changed');
});

test('exact revision/hash checks, ambiguous fields and unsafe text retention fail closed', () => {
  const source = snapshot('document', '<p id="rule">A legal rule.</p>'), selected = profile(source, [{ id: 'rule', selector: { kind: 'element', tag: 'p', id: 'rule' }, textHash: hash('A legal rule.'), includeText: true }]), rules = plan([selected]);
  rules.statements = [{ id: 'rule', subjectId: 'institution', propertyId: 'institution:role', value: { kind: 'boolean', value: false }, factKeys: [`${selected.id}:rule`], interpretation }];
  const unknown = structuredClone(source); unknown.rights.redistribution = 'unknown';
  assert.equal(projectEvidencedFields(input(), [unknown], rules).issues[0].code, 'TEXT_RIGHTS_UNREVIEWED');
  selected.facts[0].includeText = false; const result = projectEvidencedFields(input(), [unknown], rules);
  assert.equal(result.collection.sources[0].rights.redistribution, 'unknown'); assert.equal(JSON.stringify(result.collection.sources).includes('A legal rule.'), false);
  const wrong = structuredClone(source); wrong.sourceRevision = '2'; assert.equal(projectEvidencedFields(input(), [wrong], rules).issues[0].code, 'SOURCE_MISMATCH');
  const corrupt = structuredClone(source); (corrupt.raw as any).html = '<p>changed</p>'; assert.equal(projectEvidencedFields(input(), [corrupt], rules).issues[0].code, 'SOURCE_MISMATCH');
  const repeated = snapshot('duplicate', '<p class="x">Rule</p><p class="x">Rule</p>'); const duplicateProfile = profile(repeated, [{ id: 'duplicate', selector: { kind: 'element', tag: 'p', startsWith: 'Rule' }, textHash: hash('Rule') }]);
  const duplicated = plan([duplicateProfile]); duplicated.statements = [{ ...rules.statements[0], factKeys: [`${duplicateProfile.id}:duplicate`] }];
  assert.equal(projectEvidencedFields(input(), [repeated], duplicated).issues[0].code, 'FACT_AMBIGUOUS');
});

test('non-text projections exclude long and short anchor labels while retaining exact URLs, locations and hashes', () => {
  const anchor = 'UNLICENSED_ANCHOR_PROSE ' + Array.from({ length: 67 }, (_, index) => `sourceword${index}`).join(' ');
  const source = snapshot('anchor-prose', `<p id="rule"><a href="https://example.invalid/evidence">${anchor}</a> <a href="https://example.invalid/law#Article73">Article 73</a></p>`);
  source.rights.redistribution = 'unknown';
  const selected = profile(source, [{ id: 'rule', selector: { kind: 'element', tag: 'p', id: 'rule' }, textHash: hash(`${anchor} Article 73`), includeText: false }]), rules = plan([selected]);
  rules.statements = [{ id: 'rule', subjectId: 'institution', propertyId: 'institution:role', value: { kind: 'boolean', value: false }, factKeys: [`${selected.id}:rule`], interpretation }];
  const inspected = inspectPublishedFields(source, [{ id: 'rule', selector: selected.facts[0].selector }]);
  assert.equal(inspected[0].matches[0].links[0].text, anchor);
  const result = projectEvidencedFields(input(), [source], rules);
  assert.equal(result.status, 'mapped'); assert.equal(result.collection.sources[0].rights.redistribution, 'unknown');
  const retained = result.facts[0].links;
  assert.deepEqual(retained.map(link => link.href), ['https://example.invalid/evidence', 'https://example.invalid/law#Article73']);
  assert.ok(retained.every(link => !Object.hasOwn(link, 'text')));
  assert.deepEqual(retained.map(link => link.textHash), [hash(anchor), hash('Article 73')]);
  assert.ok(retained.every(link => link.locator.startsWith(result.facts[0].locator)));
  assert.equal(JSON.stringify(result.collection).includes('UNLICENSED_ANCHOR_PROSE'), false);
  assert.equal(JSON.stringify(result.collection).includes('Article 73'), false);
  selected.facts[0].includeText = true;
  assert.equal(projectEvidencedFields(input(), [source], rules).status, 'blocked');
  source.rights.redistribution = 'allowed';
  const allowed = projectEvidencedFields(input(), [source], rules); assert.equal(allowed.facts[0].links[0].text, anchor);
});

test('two revisions of one source keep their exact evidence URLs and repeated projection preserves local review', () => {
  const first = snapshot('same', '<p id="rule">Earlier rule.</p>', '1'), second = snapshot('same', '<p id="rule">Later rule.</p>', '2');
  const profiles = [first, second].map((source, index) => profile(source, [{ id: 'rule', selector: { kind: 'element', tag: 'p', id: 'rule' }, textHash: hash(index ? 'Later rule.' : 'Earlier rule.') }]));
  const rules = plan(profiles); rules.statements = profiles.map((value, index) => ({ id: String(index), subjectId: 'institution', propertyId: `role-${index}`, value: { kind: 'number', value: index }, factKeys: [`${value.id}:rule`], interpretation }));
  const result = projectEvidencedFields(input(), [first, second], rules); assert.equal(result.collection.assertions[0].evidence[0].url, first.revisionUrl); assert.equal(result.collection.assertions[1].evidence[0].url, second.revisionUrl);
  assert.equal(projectEvidencedFields(result.collection, [first, second], rules).collection.assertions.length, 2);
  result.collection.assertions[0].review = 'adopted'; const reviewed = projectEvidencedFields(result.collection, [first, second], rules); assert.equal(reviewed.collection.assertions[0].review, 'adopted'); assert.ok(reviewed.issues.some(value => value.code === 'ASSERTION_CONFLICT'));
});

test('page text is source-pinned and located, while report upload time cannot supply historical applicability', () => {
  const source = snapshot('report', ''); source.raw = { publicationDate: '2006-02', pdfHash: 'a'.repeat(64), pages: [{ number: 31, text: 'Header.\nThe legal instrument has never been\namended. Later discussion.' }] }; source.contentHash = hash(canonicalSourceJson(source.raw));
  const selected = profile(source, [{ id: 'continuity', selector: { kind: 'page-passage', page: 31, start: 'The legal instrument', end: 'amended.' }, textHash: hash('The legal instrument has never been amended.') }]), rules = plan([selected]);
  rules.statements = [{ id: 'reading', subjectId: 'institution', propertyId: 'institution:role', value: { kind: 'text', value: 'document-reading' }, factKeys: [`${selected.id}:continuity`], interpretation }];
  const result = projectEvidencedFields(input(), [source], rules); assert.equal(result.status, 'mapped'); assert.match(result.collection.assertions[0].evidence[0].locator, /pages\[number=31\]/); assert.equal(result.collection.assertions[0].validTime, undefined);
  assert.equal(createKnowledgeIndex(result.collection).state({ objectId: 'institution', year: 2006, includeUnreviewed: true }).fields[0].status, 'unknown');
});

test('invalid fact references or time-free evidence cannot masquerade as dated projected states', () => {
  const source = snapshot('simple', '<p id="rule">Rule</p>'), selected = profile(source, [{ id: 'rule', selector: { kind: 'element', tag: 'p', id: 'rule' }, textHash: hash('Rule') }]), rules = plan([selected]);
  rules.statements = [{ id: 'bad-time', subjectId: 'institution', propertyId: 'role', value: { kind: 'text', value: 'rule' }, factKeys: [`${selected.id}:rule`], validTime: { point: { earliestYear: 1947, latestYear: 1947, precision: 'year', calendar: 'gregorian' } }, interpretation }];
  assert.throws(() => projectEvidencedFields(input(), [source], rules), /INVALID_EVIDENCED_FIELD_PLAN/);
  rules.statements[0].validTime = undefined; rules.statements[0].factKeys = ['other:missing']; assert.throws(() => projectEvidencedFields(input(), [source], rules), /INVALID_EVIDENCED_FIELD_REFERENCE/);
});

test('inert inspection handles deeply nested formatting without recursive text traversal', () => {
  const source = snapshot('nested', `<p id="rule">${'<span>'.repeat(12000)}A rule${'</span>'.repeat(12000)}<img src="https://example.invalid/unrequested"><script>unexecuted()</script></p>`);
  const result = inspectPublishedFields(source, [{ id: 'rule', selector: { kind: 'element', tag: 'p', id: 'rule' } }]);
  assert.equal(result[0].matches[0].text, 'A rule'); assert.equal(result[0].matches[0].textHash, hash('A rule'));
});

test('declared table-row evidence projects through the same inspection contract without retaining row prose', () => {
  const source = snapshot('comparison-row', '<table><tr><th>Version</th> <th>Earlier</th> <th>Later</th></tr><tr><td>Nomination</td> <td colspan="2"><a href="https://example.invalid/council">Council</a></td></tr></table>');
  source.rights.redistribution = 'unknown';
  const selector = { kind: 'element' as const, tag: 'tr', startsWith: 'Nomination' };
  const inspected = inspectPublishedFields(source, [{ id: 'row', selector }]);
  assert.equal(inspected[0].matches.length, 1); assert.equal(inspected[0].matches[0].text, 'Nomination Council');
  const selected = profile(source, [{ id: 'row', selector, textHash: hash('Nomination Council') }]), rules = plan([selected]);
  rules.statements = [{ id: 'source-listing', subjectId: 'institution', propertyId: 'institution:role', value: { kind: 'text', value: 'source-listed-council' }, factKeys: [`${selected.id}:row`], interpretation }];
  const before = input(), result = projectEvidencedFields(before, [source], rules);
  assert.equal(result.status, 'mapped'); assert.equal(result.collection.assertions[0].review, 'unreviewed');
  assert.equal(result.collection.assertions[0].evidence[0].url, source.revisionUrl);
  assert.match(result.facts[0].locator, /;tr\[document-index=\d+\]/);
  assert.equal(result.collection.sources[0].rights.redistribution, 'unknown');
  assert.equal(Object.hasOwn(result.facts[0], 'text'), false); assert.equal(Object.hasOwn(result.facts[0].links[0], 'text'), false);
  assert.equal(result.facts[0].links[0].textHash, hash('Council'));
  assert.equal(JSON.stringify(result.collection.sources).includes('Nomination Council'), false);
  assert.deepEqual(before, input());
  const changed = structuredClone(rules); changed.profiles[0].facts[0].textHash = hash('Nomination Another council');
  const mismatch = projectEvidencedFields(before, [source], changed);
  assert.equal(mismatch.status, 'blocked'); assert.equal(mismatch.issues[0].code, 'FACT_CHANGED'); assert.deepEqual(mismatch.collection, before);
  for (const tag of ['script', 'iframe', 'body']) {
    const unsupported = structuredClone(rules); unsupported.profiles[0].facts[0].selector = { kind: 'element', tag, startsWith: 'Nomination' };
    assert.throws(() => projectEvidencedFields(before, [source], unsupported), /INVALID_PUBLISHED_FIELD_SELECTOR/);
  }
});

test('duplicate table-row evidence blocks the cohesive projection rather than choosing a matching row', () => {
  const source = snapshot('duplicate-comparison-row', '<table><tr><td>Nomination</td> <td>Council</td></tr><tr><td>Nomination</td> <td>Council</td></tr></table>');
  const selector = { kind: 'element' as const, tag: 'tr', startsWith: 'Nomination' };
  assert.equal(inspectPublishedFields(source, [{ id: 'row', selector }])[0].matches.length, 2);
  const selected = profile(source, [{ id: 'row', selector, textHash: hash('Nomination Council') }]), rules = plan([selected]);
  rules.objects = [object('unsupported-shell')];
  rules.statements = [{ id: 'source-listing', subjectId: 'unsupported-shell', propertyId: 'institution:role', value: { kind: 'text', value: 'council' }, factKeys: [`${selected.id}:row`], interpretation }];
  const before = input(), result = projectEvidencedFields(before, [source], rules);
  assert.equal(result.status, 'blocked'); assert.equal(result.issues[0].code, 'FACT_AMBIGUOUS');
  assert.deepEqual(result.collection, before); assert.equal(result.derivedAssertionIds.length, 0);
});
