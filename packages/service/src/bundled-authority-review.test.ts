import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import { loadTrustedKnowledgeBundle } from './trusted-bundled-knowledge.ts';

const base = new URL('../../../data/seed/east-asia/', import.meta.url);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('fixed military-authority correction retains source facts and separates qualified periods from ordinary office tenures', async () => {
  const manifestText = await fs.readFile(new URL('manifest.json', base), 'utf8');
  const { collection, manifest, fieldCatalog, supportingFiles, navigation } = await loadTrustedKnowledgeBundle({ manifestText, expectedManifestHash: hash(manifestText), readText: file => fs.readFile(new URL(file, base), 'utf8') });
  assert.equal(manifest.id, 'east-asia-research-foundation-v8');
  const ledger = supportingFiles.find(value => value.path === 'extensions/qualified-basis-reconciliation/reconciliation.json')!.value as {
    originalSources: { id: string; contentHash: string }[];
    removed: { assertionId: string; originalAssertionId: string; originalAssertionHash: string }[];
    qualifiedAssertionIds: string[];
  };
  assert.equal(ledger.originalSources.length, 22); assert.equal(ledger.removed.length, 21); assert.equal(ledger.qualifiedAssertionIds.length, 8);
  for (const previous of ledger.originalSources) assert.equal(collection.sources.find(value => value.id === previous.id)!.contentHash, previous.contentHash);
  const newSource = collection.sources.find(value => !ledger.originalSources.some(previous => previous.id === value.id))!;
  const displayName = navigation!.sourcePresentations!.find(value => value.sourceId === newSource.id)!;
  assert.equal(displayName.contentHash, newSource.contentHash); assert.equal(displayName.revision, newSource.revision);
  assert.ok(displayName.labels.en && displayName.labels['zh-CN']); assert.equal((newSource.record as any).manifest.articleTitle, 'List of shoguns');
  for (const removed of ledger.removed) {
    assert.ok(!collection.assertions.some(value => value.id === removed.assertionId));
    assert.equal(hash(canonicalJson(collection.assertions.find(value => value.id === removed.originalAssertionId))), removed.originalAssertionHash);
  }
  assert.ok(!collection.assertions.some(value => value.subjectId.startsWith('history:') && value.propertyId === 'office:holder' && value.qualifiers.some(item => item.propertyId === 'source:tenure-text' && item.value.kind === 'text' && /\bde[\s-]+(?:jure|facto)\b/i.test(item.value.value))));
  const index = createKnowledgeIndex(collection), formal = 'office:listed-de-jure-holder', effective = 'office:listed-de-facto-authority';
  const values = (objectId: string, year: number, propertyId: string) => index.state({ objectId, year, propertyIds: [propertyId], includeUnreviewed: true }).fields.find(value => value.propertyId === propertyId)?.values ?? [];
  const person = (id: string) => ({ kind: 'entity', objectId: `wikipedia-en:${id}` });
  const tokugawa = 'history:office:tokugawa-shogun', ashikaga = 'history:office:ashikaga-shogun';
  assert.deepEqual(values(tokugawa, 1604, formal), [person('Tokugawa_Ieyasu')]); assert.deepEqual(values(tokugawa, 1604, effective), [person('Tokugawa_Ieyasu')]);
  assert.deepEqual(values(tokugawa, 1628, 'office:holder'), [person('Tokugawa_Iemitsu')]); assert.deepEqual(values(tokugawa, 1628, effective), [person('Tokugawa_Hidetada')]);
  assert.deepEqual(values(tokugawa, 1748, formal), [person('Tokugawa_Ieshige')]); assert.ok(values(tokugawa, 1748, effective).some(value => canonicalJson(value) === canonicalJson(person('Tokugawa_Yoshimune'))));
  assert.deepEqual(values(tokugawa, 1839, 'office:holder'), [person('Tokugawa_Ieyoshi')]); assert.deepEqual(values(tokugawa, 1839, effective), [person('Tokugawa_Ienari')]);
  assert.deepEqual(values(ashikaga, 1400, formal), [person('Ashikaga_Yoshimochi')]); assert.ok(values(ashikaga, 1400, effective).some(value => canonicalJson(value) === canonicalJson(person('Ashikaga_Yoshimitsu'))));
  assert.deepEqual(values(ashikaga, 1478, 'office:holder'), [person('Ashikaga_Yoshihisa')]); assert.deepEqual(values(ashikaga, 1478, effective), [person('Ashikaga_Yoshimasa')]);
  assert.ok(!collection.assertions.some(value => value.subjectId === 'history:office:azuchi-momoyama-authority' && value.propertyId === 'office:holder'));
  for (const propertyId of [formal, effective]) { const display = fieldCatalog.properties.find(value => value.id === propertyId)!; assert.ok(display.labels.en && display.labels['zh-CN']); }
  assert.ok(collection.assertions.every(value => value.review === 'unreviewed'));
});
