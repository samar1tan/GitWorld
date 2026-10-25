import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import { auditSourceReferenceTargets, SOURCE_REFERENCE_PROPERTY, SOURCE_REFERENCE_TYPE } from '../../ingestion/src/source-reference-links.ts';
import { loadTrustedKnowledgeBundle, knowledgeCollectionFingerprint } from './trusted-bundled-knowledge.ts';

test('installed preset main-value links resolve to bilingual records without rewriting original mission claims', async () => {
  const root = new URL('../../../data/seed/east-asia/', import.meta.url), text = await fs.readFile(new URL('manifest.json', root), 'utf8');
  const bundle = await loadTrustedKnowledgeBundle({ manifestText: text, expectedManifestHash: createHash('sha256').update(text).digest('hex'), readText: file => fs.readFile(new URL(file, root), 'utf8') });
  const { collection, fieldCatalog, navigation } = bundle, audit = auditSourceReferenceTargets(collection);
  assert.deepEqual(audit.missingValues, [], 'Every preset assertion main-value link must open an object at the same revision.');
  assert.deepEqual(audit.incompleteLabels, []); assert.deepEqual(audit.opaqueLabels, []);
  const references = collection.objects.filter(value => value.types.includes(SOURCE_REFERENCE_TYPE)); assert.equal(references.length, 5);
  const ledger = bundle.supportingFiles.find(value => value.path === 'extensions/source-reference-links/reconciliation.json')!.value as { baseManifestHash: string; originalCollectionHash: string; referenceObjectIds: string[]; identityAssertionIds: string[]; sourceId: string };
  assert.equal(ledger.baseManifestHash, '3ce3a5dbac92ef5a0a937bfdc9c61abdda4ba44bfb99192ceb68bd2ee94b0e0f');
  const retained = { schemaVersion: 1 as const, objects: collection.objects.filter(value => !ledger.referenceObjectIds.includes(value.id)), assertions: collection.assertions.filter(value => !ledger.identityAssertionIds.includes(value.id)), sources: collection.sources.filter(value => value.id !== ledger.sourceId) };
  assert.equal(knowledgeCollectionFingerprint(retained), ledger.originalCollectionHash, 'Every v8 object, assertion and source retains its canonical bytes.');
  assert.deepEqual([retained.objects.length, retained.assertions.length, retained.sources.length], [1214, 4018, 23]);
  const index = createKnowledgeIndex(collection), pairs = [
    ['Empress_Saimei', 'Empress_Kōgyoku', 660, '齐明天皇'],
    ['Emperor_Mommu', 'Emperor_Monmu', 702, '文武天皇'],
    ['Emperor_Kammu', 'Emperor_Kanmu', 804, '桓武天皇'],
    ['Emperor_Tang_Wenzong', 'Emperor_Wenzong_of_Tang', 838, '唐文宗'],
    ['Emperor_Tang_Zhaozong', 'Emperor_Zhaozong_of_Tang', 894, '唐昭宗'],
  ] as const;
  for (const [alias, destination, year, chinese] of pairs) {
    const id = `wikipedia-en:${alias}`, personId = `wikipedia-en:${destination}`, object = index.object(id)!;
    assert.ok(object); assert.equal(object.labels['zh-CN'], chinese); assert.ok(object.descriptions.en && object.descriptions['zh-CN']);
    const links = index.assertions(id); assert.equal(links.length, 1); assert.equal(links[0].propertyId, SOURCE_REFERENCE_PROPERTY); assert.deepEqual(links[0].value, { kind: 'entity', objectId: personId });
    assert.equal(links[0].validTime, undefined); assert.equal(links[0].review, 'unreviewed'); assert.ok(index.object(personId)!.assertionCount > 0);
    assert.equal(index.state({ objectId: id, year, includeUnreviewed: true }).fields[0].status, 'unknown');
    const original = collection.assertions.find(value => value.value.kind === 'entity' && value.value.objectId === id)!;
    assert.ok(original.id.startsWith('wikipedia-event-claim:')); assert.equal(original.sourceSnapshotId, 'wikipedia-en-facts:24703277@6ec043a7af2c53054e5447950352ed624209839a29b5acfe7543285c1f4cd4f0');
  }
  const source = collection.sources.find(value => value.identity.provider === 'gitworld-source-references')!, presentation = navigation!.sourcePresentations!.find(value => value.sourceId === source.id)!;
  assert.ok(presentation.labels.en && presentation.labels['zh-CN']); assert.equal(presentation.contentHash, source.contentHash);
  assert.ok(fieldCatalog.properties.find(value => value.id === SOURCE_REFERENCE_PROPERTY)!.labels['zh-CN']);
  assert.equal(new Set(audit.missingQualifiers.map(value => value.objectId)).size, 98);
  assert.ok(audit.missingQualifiers.every(value => value.propertyId === 'source:context-identity'));
  assert.equal(bundle.manifest.id, 'east-asia-research-foundation-v9'); assert.deepEqual(bundle.manifest.counts, { objects: 1219, assertions: 4023, sources: 24 });
});
