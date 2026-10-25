import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createContentSummaries } from './content-summary.ts';
import { validateServiceRequest } from '../../contracts/src/validation.ts';

const binary = fileURLToPath(new URL('../../../.local/bundled-git/runtime/bin/git', import.meta.url));
test('bulk changed-record metadata paginates and searches beyond the prefix-query bound', { skip: !existsSync(binary) }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-change-summary-'));
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  try {
    await repository.initialize();
    await repository.write(Array.from({ length: 150 }, (_, index) => ({ path: `sources/source-${index}.json`, value: { record: { title: `Synthetic source ${index}` } } })));
    const summaries = createContentSummaries(repository);
    const page = await summaries.changes({ mode: 'working', group: 'source', offset: 40, limit: 40 });
    assert.equal(page.total, 150); assert.equal(page.items.length, 40);
    const found = await summaries.changes({ mode: 'working', query: 'Synthetic source 149', offset: 0, limit: 40 });
    assert.equal(found.total, 1); assert.equal(found.items[0].title.en, 'Synthetic source 149');
    const selected = await repository.snapshot({ paths: ['sources/source-149.json'] });
    assert.deepEqual(Object.keys(selected.files), ['sources/source-149.json']);
  } finally { await repository.close(); await rm(directory, { recursive: true, force: true }); }
});

test('user records precede import metadata across pages and support lookup preserves distinct catalog roles', { skip: !existsSync(binary) }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-change-order-'));
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  try {
    await repository.initialize();
    const catalog = 'mappings/field-catalogs/catalog.json', baseline = 'mappings/field-catalog-baselines/catalog.json';
    await repository.write([
      ...Array.from({ length: 50 }, (_, index) => ({ path: `mappings/baseline-${String(index).padStart(64, '0')}.json`, value: { object: { id: `object-${index}`, labels: { en: `Object ${index}` } } } })),
      { path: catalog, value: { kind: 'active-field-catalog', catalogId: 'example:catalog' } },
      { path: baseline, value: { kind: 'active-field-catalog', catalogId: 'example:catalog' } },
      { path: 'sources/example.json', value: { record: { title: 'Supporting source' } } },
      { path: 'objects/subject.json', value: { object: { id: 'subject', labels: { en: 'Historical subject', 'zh-CN': '历史对象' } } } },
      { path: 'research/note.json', value: { title: 'Continuing investigation' } },
      { path: 'models/example.json', value: { dataset: { id: 'example', name: { en: 'Historical model' } } } },
    ]);
    const summaries = createContentSummaries(repository);
    const first = await summaries.changes({ mode: 'working', offset: 0, limit: 4 });
    assert.deepEqual(first.items.map(item => item.group), ['object', 'research', 'model', 'source']);
    assert.equal(first.total, 56);
    const next = await summaries.changes({ mode: 'working', offset: 4, limit: 40 });
    assert.equal(next.items.length, 40); assert.ok(next.items.every(item => item.metadataKind === 'object-baseline'));
    const selected = await summaries.changes({ mode: 'working', paths: [baseline, catalog], offset: 0, limit: 40 });
    assert.equal(selected.total, 2);
    assert.deepEqual(new Set(selected.items.map(item => item.metadataKind)), new Set(['field-catalog', 'catalog-baseline']));
    assert.ok(selected.items.every(item => item.title.en === 'example:catalog'));
    const filtered = await summaries.changes({ mode: 'working', group: 'mapping', paths: ['objects/subject.json', catalog], offset: 0, limit: 40 });
    assert.deepEqual(filtered.items.map(item => item.path), [catalog]);
    await repository.stage([{ path: catalog }, { path: baseline }]);
    const staged = await summaries.changes({ mode: 'staged', offset: 0, limit: 40 });
    assert.deepEqual(new Set(staged.items.map(item => item.metadataKind)), new Set(['field-catalog', 'catalog-baseline']));
    const request = (paths: string[]) => validateServiceRequest({ protocolVersion: 1, requestId: 'support-metadata', method: 'repository.changes', params: { mode: 'working', paths, offset: 0, limit: 40 } });
    assert.equal(request([catalog]).ok, true);
    assert.equal(request(['mappings/../../outside.json']).ok, false);
    assert.equal(request(Array.from({ length: 201 }, (_, index) => `sources/source-${index}.json`)).ok, false);
  } finally { await repository.close(); await rm(directory, { recursive: true, force: true }); }
});
