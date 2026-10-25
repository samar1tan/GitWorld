import test from 'node:test';
import assert from 'node:assert/strict';
import { researchKnowledgeQuery, emptyResearchScope, mergeResearchEvidence, newResearchRecord, parseResearchPeriod, parseResearchRecovery, researchFingerprint } from './research-draft.ts';
import type { PinnedResearchEvidence } from '../../../../packages/contracts/src/research-types.ts';

test('scope dates retain BCE and reject partial, inverted or year-zero filters', () => {
  assert.deepEqual(parseResearchPeriod('', ''), { ok: true, value: null });
  assert.deepEqual(parseResearchPeriod('-221', '14'), { ok: true, value: [-221, 14] });
  for (const [from, to] of [['', '800'], ['800', ''], ['0', '800'], ['800', '799'], ['1.5', '800'], ['1e2', '800'], ['-9007199254740992', '800']]) assert.deepEqual(parseResearchPeriod(from, to), { ok: false });
});

test('fixed evidence versions coexist and attachment cannot mutate an earlier record', () => {
  const a: PinnedResearchEvidence = { id: 'claim-a', kind: 'assertion', title: 'A sourced assertion', locator: 'statement:a', repositoryRevision: 'revision-old' };
  const old = [a], incoming = [{ ...a, repositoryRevision: 'revision-new' }, { ...a }];
  const result = mergeResearchEvidence(old, incoming);
  assert.equal(result.length, 2); assert.equal(result[0].repositoryRevision, 'revision-old');
  result[0].title = 'Edited locally'; assert.equal(old[0].title, 'A sourced assertion');
  assert.equal(incoming[1].title, 'A sourced assertion');
});

test('dirty state tracks research content, not timestamps, and copied scope is independent', () => {
  const scope = emptyResearchScope(); scope.objectIds.push('object-a');
  const record = newResearchRecord('record-a', scope, '2026-10-25T00:00:00Z');
  const original = researchFingerprint(record); record.updatedAt = '2026-10-26T00:00:00Z';
  assert.equal(researchFingerprint(record), original);
  record.interpretation = 'A provisional conclusion'; assert.notEqual(researchFingerprint(record), original);
  scope.objectIds.push('object-b'); assert.deepEqual(record.scope.objectIds, ['object-a']);
});

test('recovery retains fixed references and invalid raw input without treating it as a saved record', () => {
  const record = newResearchRecord('record-a', emptyResearchScope(), '2026-10-25T00:00:00Z');
  record.title = '<not markup>'; record.comparison = { a: { label: 'Earlier', repositoryRevision: 'old', historicalRef: 'path@1' }, b: { label: 'Later', repositoryRevision: 'new', historicalRef: 'path@2' } };
  const recovery = { schemaVersion: 1 as const, record, expectedHash: 'content-hash', from: '0', to: '', baseline: researchFingerprint(record) };
  assert.deepEqual(parseResearchRecovery(JSON.stringify(recovery)), recovery);
  assert.equal(parseResearchRecovery('{'), null);
  assert.equal(parseResearchRecovery(JSON.stringify({ ...recovery, record: { ...record, evidence: [{ id: 'unqualified' }] } })), null);
  assert.equal(parseResearchRecovery(JSON.stringify({ ...recovery, record: { ...record, comparison: { a: { label: 'A' } } } })), null);
});

test('clearing research time and name filters overrides its navigation recipe without replacing membership or evidence',()=>{
  const scope=emptyResearchScope();scope.navigation={schemaVersion:1,revision:'a'.repeat(40),query:{contextIds:['context:one'],time:[630,650],text:'Old keyword',typeIds:['court'],objectIds:['previous-object'],includeUndated:false}};
  const record=newResearchRecord('record',scope,'2026-10-25T00:00:00Z');record.evidence=[{id:'e',kind:'assertion',title:'Fixed evidence',locator:'row 1',repositoryRevision:'b'.repeat(40)}];
  const query=researchKnowledgeQuery(record.scope);assert.deepEqual(query.contextIds,['context:one']);assert.equal(query.time,undefined);assert.equal(query.text,undefined);assert.equal(query.objectIds,undefined);assert.deepEqual(query.typeIds,['court']);assert.equal(query.includeUndated,false);assert.equal(record.evidence[0].repositoryRevision,'b'.repeat(40));assert.deepEqual(record.scope.navigation!.query.time,[630,650]);
});

test('comparison snapshot names remain recoverable and malformed names cannot reach rendering',()=>{
  const record=newResearchRecord('fixed-labels',emptyResearchScope(),'2026-10-25T00:00:00Z');record.comparison={a:{label:'Old',labels:{en:'Old','zh-CN':'旧名称'},repositoryRevision:'1'.repeat(40),year:1336},b:{label:'Later',repositoryRevision:'1'.repeat(40),year:1370}};
  const recovery={schemaVersion:1,record,expectedHash:null,from:'1336',to:'1370',baseline:''};assert.deepEqual(parseResearchRecovery(JSON.stringify(recovery))?.record.comparison,record.comparison);
  Object.assign(record.comparison.a,{labels:{en:3}});assert.equal(parseResearchRecovery(JSON.stringify(recovery)),null);delete record.comparison.a.labels;assert.ok(parseResearchRecovery(JSON.stringify(recovery)));
});
