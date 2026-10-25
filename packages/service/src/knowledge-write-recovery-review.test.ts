import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createKnowledgeStore } from './knowledge-store.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeObject, KnowledgeSource } from '../../domain/src/knowledge.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)), binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
const object = (index: number): KnowledgeObject => ({ id: `fixture:${index}`, identities: [], labels: { en: `Synthetic ${index}` }, descriptions: {}, aliases: [], types: [] });
const source = (id: string): KnowledgeSource => ({ id: `source:${id}`, identity: { provider: 'fixture', externalId: id }, revision: id, contentHash: 'synthetic', retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid', adapterVersion: 'fixture', rights: { redistribution: 'unknown' } });
const assertion = (index: number, id: string, year: number): KnowledgeAssertion => ({ id: `claim:${index}:${id}`, subjectId: `fixture:${index}`, propertyId: 'fixture:value', value: { kind: 'text', value: id }, qualifiers: [], evidence: [{ sourceId: `source:${id}`, locator: `row ${index}` }], sourceSnapshotId: `source:${id}`, review: 'unreviewed', validTime: { point: { earliestYear: year, latestYear: year, precision: 'year', calendar: 'test' } } });

test('retry repairs an interrupted upstream baseline before the next append batch without losing either state', native, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-knowledge-write-recovery-'));
  const id = 'fixture:49', baseline = `mappings/baseline-${createHash('sha256').update(canonicalJson(id)).digest('hex')}.json`;
  let inject = true;
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), onWriteProgress: progress => {
    // The source and object 49 are durable; its paired baseline is the next write.
    if (inject && progress.completed === 100) { inject = false; mkdirSync(path.join(directory, 'repository', baseline)); }
  } });
  t.after(async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); });
  const initial = await repository.initialize(), store = createKnowledgeStore(repository);
  const first: KnowledgeCollection = { schemaVersion: 1, objects: Array.from({ length: 200 }, (_, index) => object(index)), assertions: Array.from({ length: 200 }, (_, index) => assertion(index, 'first', 100)), sources: [source('first')] };
  const input = { collection: first, mode: 'append-observations' as const, review: 'unreviewed' as const, expectedHead: initial.head, expectedInputHash: store.previewCollection(first).preview.inputHash };
  await assert.rejects(store.adopt(input), { code: 'EISDIR' });
  await rm(path.join(directory, 'repository', baseline), { recursive: true });
  const retried = await store.adopt(input); assert.equal(retried.conflicts.length, 0);
  assert.notEqual(await repository.read(baseline), null, 'An unchanged object still needs its missing upstream baseline repaired.');
  const next: KnowledgeCollection = { schemaVersion: 1, objects: [object(49)], assertions: [assertion(49, 'second', 200)], sources: [source('second')] };
  const adopted = await store.adopt({ collection: next, mode: 'append-observations', review: 'unreviewed', expectedHead: initial.head, expectedInputHash: store.previewCollection(next).preview.inputHash });
  assert.equal(adopted.conflicts.length, 0);
  const index = (await store.index()).index;
  assert.deepEqual(index.state({ objectId: id, year: 100, includeUnreviewed: true }).fields[0].values, [{ kind: 'text', value: 'first' }]);
  assert.deepEqual(index.state({ objectId: id, year: 200, includeUnreviewed: true }).fields[0].values, [{ kind: 'text', value: 'second' }]);
});
