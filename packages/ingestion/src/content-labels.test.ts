import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeIndex, type KnowledgeCollection } from '../../domain/src/knowledge.ts';
import { applyContentLabels, contentValueHash, createContentTextIndex, type ContentLabelPlan } from './content-labels.ts';
const fixture = (): KnowledgeCollection => ({ schemaVersion: 1, objects: [{ id: 'object', identities: [{ provider: 'synthetic', externalId: '1' }], labels: { en: 'Source label' }, descriptions: {}, aliases: [], types: ['synthetic'] }], assertions: [], sources: [] });
const plan = (): ContentLabelPlan => ({ schemaVersion: 1, id: 'synthetic-labels', revision: '1', preparedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/source', rights: { redistribution: 'unknown' }, sourceFacts: [{ title: '來源', revision: 7, variant: 'zh-cn' }], labels: [{ objectId: 'object', language: 'zh-CN', text: '来源名称', method: 'explicit-source-variant-title', evidence: [{ url: 'https://example.invalid/source?oldid=7', locator: '$.varianttitles.zh-cn', sourceSnapshotHash: 'source-hash' }] }] });

test('content labels retain separate evidence and do not manufacture historical assertions or events', () => {
  const input = fixture(), original = structuredClone(input), selected = plan(), result = applyContentLabels(input, selected);
  assert.deepEqual(input, original); assert.equal(result.collection.objects[0].labels['zh-CN'], '来源名称'); assert.deepEqual(result.collection.assertions, input.assertions);
  assert.equal(result.collection.sources[0].rights.redistribution, 'unknown');
  assert.equal(createKnowledgeIndex(result.collection).query({ text: '来源名称' }).total, 1);
  assert.equal(createKnowledgeIndex(result.collection).history({ objectId: 'object' }).observations.length, 0);
  const again = applyContentLabels(result.collection, selected); assert.equal(again.collection.sources.length, 1); assert.equal(again.issues.length, 0);
});

test('label corrections require an exact before-value and preserve the original label as an alias', () => {
  const input = fixture(), selected = plan(); selected.labels = [{ ...selected.labels[0], language: 'en', text: 'Corrected name' }];
  const conflict = applyContentLabels(input, selected); assert.equal(conflict.issues[0].code, 'LABEL_CONFLICT'); assert.equal(conflict.collection.objects[0].labels.en, 'Source label');
  selected.labels[0].replaces = 'Source label'; const corrected = applyContentLabels(input, selected);
  assert.equal(corrected.collection.objects[0].labels.en, 'Corrected name'); assert.deepEqual(corrected.collection.objects[0].aliases, [{ en: 'Source label' }]);
  selected.labels[0].objectId = 'missing'; assert.equal(applyContentLabels(input, selected).issues[0].code, 'OBJECT_NOT_FOUND');
});

test('display translations follow unchanged derivations without changing canonical values or accepting stale text', () => {
  const input = fixture(); input.sources.push({ id: 'source', identity: { provider: 'synthetic', externalId: 'table' }, revision: '1', contentHash: 'hash', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid', adapterVersion: 'test', rights: { redistribution: 'unknown' } });
  input.assertions.push({ id: 'original', subjectId: 'object', propertyId: 'cabinet', value: { kind: 'text', value: 'First cabinet' }, qualifiers: [], evidence: [], sourceSnapshotId: 'source', review: 'unreviewed' });
  input.assertions.push({ ...structuredClone(input.assertions[0]), id: 'derived', qualifiers: [{ propertyId: 'binding:derived-from', value: { kind: 'text', value: 'original' } }] });
  const selected = plan(); selected.valueTexts = [{ assertionId: 'original', valueHash: contentValueHash(input.assertions[0].value), language: 'zh-CN', text: '第一届政府', method: 'editorial-source-value-translation', evidence: selected.labels[0].evidence }];
  const result = applyContentLabels(input, selected), text = createContentTextIndex(result.collection).value(input.assertions[1].value, ['derived'], 'zh-CN');
  assert.equal(text.status, 'translated'); assert.equal(text.text, '第一届政府'); assert.deepEqual(result.collection.assertions, input.assertions);
  assert.equal(createContentTextIndex(result.collection).value({ kind: 'text', value: 'Second cabinet' }, ['derived'], 'zh-CN').status, 'missing');
  selected.valueTexts[0].valueHash = 'stale'; assert.equal(applyContentLabels(input, selected).issues[0].code, 'VALUE_TEXT_CONFLICT');
});

test('conflicting display translations remain a conflict instead of selecting a source by order', () => {
  const input = fixture(); input.sources.push({ id: 'source', identity: { provider: 'synthetic', externalId: '1' }, revision: '1', contentHash: 'hash', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid', adapterVersion: 'test', rights: { redistribution: 'unknown' } });
  input.assertions.push({ id: 'claim', subjectId: 'object', propertyId: 'name', value: { kind: 'text', value: 'A' }, qualifiers: [], evidence: [], sourceSnapshotId: 'source', review: 'unreviewed' });
  const selected = plan(), value = { assertionId: 'claim', valueHash: contentValueHash(input.assertions[0].value), language: 'zh-CN' as const, text: '甲', method: 'synthetic', evidence: selected.labels[0].evidence };
  selected.valueTexts = [value, { ...value, text: '乙' }];
  const result = applyContentLabels(input, selected), lookup = createContentTextIndex(result.collection).value(input.assertions[0].value, ['claim'], 'zh-CN');
  assert.equal(lookup.status, 'conflict'); assert.equal(lookup.text, undefined);
});
