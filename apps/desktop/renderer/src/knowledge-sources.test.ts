import test from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeSourceHeader } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';
import { groupKnowledgeSources, knowledgeSourceLocators, knowledgeSourceName, knowledgeSourceTitle } from './knowledge-sources.ts';

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


test('source display names select snapshot labels without replacing the original title or inventing a fallback language', () => {
  const header = { ...source(1), labels: { en: 'Curated source collection', 'zh-CN': '整理后的来源集合' }, title: { en: 'Original source heading' } }, before = structuredClone(header);
  assert.deepEqual(knowledgeSourceName(header, 'zh-CN'), { text: header.labels['zh-CN'], language: 'zh-CN', originalTitle: { text: header.title.en, language: 'en' } });
  assert.equal(knowledgeSourceName(header, 'en').text, header.labels.en);
  assert.equal(knowledgeSourceName({ ...header, labels: { en: header.labels.en } }, 'zh-CN').language, 'en');
  assert.deepEqual(knowledgeSourceName({ ...header, labels: undefined }, 'zh-CN'), { text: header.title.en, language: 'en', originalTitle: null });
  assert.equal(knowledgeSourceName({ ...header, labels: { en: header.title.en } }, 'en').originalTitle, null);
  assert.equal(knowledgeSourceName(source(2), 'zh-CN').language, null);
  assert.deepEqual(header, before);
});

test('source display labels participate in grouping independently of original citation titles and key order', () => {
  const one = { ...source(1), labels: { en: 'Collection', 'zh-CN': '集合甲' }, title: { en: 'Original title' } };
  const different = { ...source(2), labels: { en: 'Collection', 'zh-CN': '集合乙' }, title: one.title };
  const reordered = { ...source(3), labels: { 'zh-CN': '集合甲', en: 'Collection' }, title: one.title };
  const groups = groupKnowledgeSources([one, different, reordered], 'a'.repeat(40));
  assert.equal(groups.length, 2); assert.deepEqual(groups[0].sources.map(value => value.id), [one.id, reordered.id]); assert.equal(groups[1].sources[0].id, different.id);
  assert.equal(groups.flatMap(value => value.sources).length, 3);
});
