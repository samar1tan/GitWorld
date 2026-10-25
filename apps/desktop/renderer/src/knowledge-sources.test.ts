import test from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeSourceHeader } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';
import { groupKnowledgeSources, knowledgeSourceLocators, knowledgeSourceTitle } from './knowledge-sources.ts';

const source = (index: number): KnowledgeSourceHeader => ({ id: `source:${index}`, identity: { provider: 'cliopatria-frame', externalId: index.toString(16).padStart(64, '0') }, revision: 'v1', contentHash: (index + 100).toString(16).padStart(64, '0'), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/document.zip', adapterVersion: 'fixture', rights: { redistribution: 'unknown' } });

test('document folding retains every original source and uses readable provider fallback', () => {
  const sources = Array.from({ length: 20 }, (_, index) => source(index)), before = structuredClone(sources);
  const groups = groupKnowledgeSources(sources, 'a'.repeat(40));
  assert.equal(groups.length, 1); assert.equal(groups[0].sources.length, 20); assert.deepEqual(groups[0].sources, before); assert.deepEqual(sources, before);
  for (const locale of ['en', 'zh-CN'] as const) {
    assert.equal(knowledgeSourceTitle(sources[0], locale), 'Cliopatria');
    assert.equal(knowledgeSourceTitle({ ...sources[0], identity: { provider: 'unregistered-provider', externalId: sources[0].contentHash } }, locale), 'unregistered-provider');
  }
  assert.equal(knowledgeSourceTitle({ ...sources[0], title: { en: 'Actual source title' } }, 'en'), 'Actual source title');
});

test('source revisions, complete title metadata, document URLs, providers and data OIDs keep independent groups', () => {
  const base = source(0), changed = [base, { ...source(1), revision: 'v2' }, { ...source(2), title: { en: 'A title', 'zh-CN': '标题甲' } }, { ...source(3), title: { en: 'A title', 'zh-CN': '标题乙' } }, { ...source(4), url: 'https://example.invalid/other.zip' }, { ...source(5), identity: { provider: 'other-provider', externalId: '5' } }];
  const groups = groupKnowledgeSources(changed, 'a'.repeat(40)); assert.equal(groups.length, changed.length);
  const a = groupKnowledgeSources([base], 'a'.repeat(40)), b = groupKnowledgeSources([base], 'b'.repeat(40)); assert.notEqual(a[0].key, b[0].key);
  const titleA = { ...source(6), title: { en: 'A title', 'zh-CN': '标题甲' } }, titleB = { ...source(7), title: { 'zh-CN': '标题甲', en: 'A title' } };
  assert.equal(groupKnowledgeSources([titleA, titleB], 'a'.repeat(40)).length, 1);
  assert.equal(groupKnowledgeSources([{ ...source(8), url: '' }, { ...source(9), url: '' }], 'working').length, 2);
});

test('locator presentation remains attached to each source and never rewrites claim provenance', () => {
  const assertions = [0, 1].map(index => ({ id: `claim:${index}`, subjectId: 'fixture', propertyId: 'fixture:value', value: { kind: 'text' as const, value: 'Fixture' }, qualifiers: [], evidence: [{ sourceId: `source:${index}`, locator: '$.field' }, { sourceId: `source:${index}`, locator: '$.other' }], sourceSnapshotId: `source:${index}`, review: 'unreviewed' as const }));
  const before = structuredClone(assertions), locations = knowledgeSourceLocators({ assertions });
  assert.deepEqual(locations.get('source:0'), ['$.field', '$.other']); assert.deepEqual(locations.get('source:1'), ['$.field', '$.other']); assert.deepEqual(assertions, before);
});
