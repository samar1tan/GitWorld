import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createKnowledgeBrowser, type KnowledgeBrowserApi } from './knowledge-browser.ts';
import { createKnowledgeIndex } from '../../../../packages/domain/src/knowledge.ts';
import { loadTrustedKnowledgeBundle } from '../../../../packages/service/src/trusted-bundled-knowledge.ts';
import { createKnowledgeDisplayIndex } from '../../../../packages/service/src/knowledge-display.ts';

// Actual preset bytes exercise the shipped read model and action handlers; this is not native installer acceptance.
test('both locales follow a preset source link through untimed Evidence to the existing person and return to the mission', async t => {
  const root = new URL('../../../../data/seed/east-asia/', import.meta.url), text = await fs.readFile(new URL('manifest.json', root), 'utf8');
  const bundle = await loadTrustedKnowledgeBundle({ manifestText: text, expectedManifestHash: createHash('sha256').update(text).digest('hex'), readText: file => fs.readFile(new URL(file, root), 'utf8') });
  const { collection } = bundle, index = createKnowledgeIndex(collection), display = createKnowledgeDisplayIndex(collection, bundle.fieldCatalog, undefined, bundle.navigation?.sourcePresentations);
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  t.after(() => { if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document'); });
  const api: KnowledgeBrowserApi = {
    async query(params) { return index.query(params.query); },
    async object(params) {
      const object = index.object(params.objectId); assert.ok(object, `Linked object is absent: ${params.objectId}`);
      const assertions = index.assertions(params.objectId), sources = new Set(assertions.flatMap(value => [value.sourceSnapshotId, ...value.evidence.map(item => item.sourceId)]));
      return { object, assertions, sources: display.sourceHeaders(sources), display: display.object(params.objectId, assertions, bundle.manifest.collectionHash), revision: params.revision ?? 'working', working: !params.revision || params.revision === 'working' };
    },
    async state(params) { return index.state(params.state); },
    async history(params) { return index.history(params); },
    async diff(params) { return index.diff(params.a.state, params.b.state); },
  };
  const cases = [
    ['Empress_Saimei', 'Empress_Kōgyoku', 660, '齐明天皇', 'Empress Saimei', '88649158'],
    ['Emperor_Mommu', 'Emperor_Monmu', 702, '文武天皇', 'Emperor Mommu', '578327539'],
    ['Emperor_Kammu', 'Emperor_Kanmu', 804, '桓武天皇', 'Emperor Kammu', '578326834'],
    ['Emperor_Tang_Wenzong', 'Emperor_Wenzong_of_Tang', 838, '唐文宗', 'Emperor Tang Wenzong', '321946630'],
    ['Emperor_Tang_Zhaozong', 'Emperor_Zhaozong_of_Tang', 894, '唐昭宗', 'Emperor Tang Zhaozong', '331386807'],
  ] as const;
  const click = (browser: ReturnType<typeof createKnowledgeBrowser>, action: string, extra = {}) => browser.click({ dataset: { knowledge: action, ...extra } } as unknown as HTMLElement);
  for (const locale of ['en', 'zh-CN'] as const) for (const [alias, destination, year, chinese, english, revision] of cases) {
    const aliasId = `wikipedia-en:${alias}`, destinationId = `wikipedia-en:${destination}`;
    const original = collection.assertions.find(value => value.id.startsWith('wikipedia-event-claim:') && value.value.kind === 'entity' && value.value.objectId === aliasId)!; assert.ok(original);
    const storage = new Map<string, string>();
    const browser = createKnowledgeBrowser({ locale: () => locale, render: () => {}, api, storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } }, repositoryStatus: async () => ({ head: '1'.repeat(40), branch: 'main', stagedTree: '2'.repeat(40), staged: [], unstaged: [], conflicts: [], revert: null }), onFindData: () => {}, onOpenChanges: () => {}, onResearch: () => {} });
    await browser.open(); await browser.execute({ type: 'show', objectId: original.subjectId, year, includeUnreviewed: true });
    assert.ok(browser.content().includes(`data-id="${aliasId}"`));
    await click(browser, 'related', { id: aliasId, revision: 'working', year: String(year), unreviewed: 'true' });
    assert.equal(browser.state().selectedObjectId, aliasId); assert.equal(/<h1>(.*?)<\/h1>/s.exec(browser.content())?.[1].replace(/<[^>]+>/g, ''), locale === 'en' ? english : chinese);
    assert.ok(!browser.content().includes('This object is unavailable'));
    assert.equal(index.state({ objectId: aliasId, year, includeUnreviewed: true }).fields[0].status, 'unknown');
    await click(browser, 'field', { property: 'reference:person' });
    const html = browser.content();
    assert.ok(html.includes(locale === 'en' ? 'Other recorded claims (1)' : '其他收录主张（1）'));
    assert.match(html, /<details class="knowledge-other-assertions">/);
    assert.ok(html.includes(`class="knowledge-entity-link" data-knowledge="related" data-id="${destinationId}"`));
    assert.ok(html.includes(`oldid=${revision}`)); assert.ok(html.includes(original.evidence[0].locator));
    await click(browser, 'related', { id: destinationId, revision: 'working', year: String(year), unreviewed: 'true' });
    assert.equal(browser.state().selectedObjectId, destinationId); assert.equal(browser.state().year, year); assert.ok(index.assertions(destinationId).length > 0);
    await click(browser, 'back-related'); assert.equal(browser.state().selectedObjectId, aliasId);
    await click(browser, 'back-related'); assert.equal(browser.state().selectedObjectId, original.subjectId); assert.equal(browser.state().year, year);
  }
});
