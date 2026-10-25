import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalService } from './index.ts';
import { knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import type { KnowledgeCollection, KnowledgeObject } from '../../domain/src/knowledge.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const objectPath = (id: string) => `objects/${hash(id)}.json`;
const json = (value: unknown) => value as EditorialJson;
const named = (id: string, en: string, zh: string): KnowledgeObject => ({ id, labels: { en, 'zh-CN': zh }, descriptions: {}, types: [], identities: [], aliases: [] });

test('repository diff and global commands resolve both entity names at their own frozen or working basis', native, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-diff-names-'));
  const dataDirectory = path.join(directory, 'library'), seed = path.join(directory, 'seed.json');
  await writeFile(seed, JSON.stringify(validPackage()));
  const repository = await createEditorialRepository({ dataDirectory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  const source = { id: 'fixture:source', identity: { provider: 'fixture', externalId: 'source' }, contentHash: hash({ synthetic: true }), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/synthetic', adapterVersion: 'fixture', rights: { redistribution: 'allowed' as const }, record: { synthetic: true } };
  const collection: KnowledgeCollection = {
    schemaVersion: 1,
    objects: [named('fixture:subject', 'Subject', '对象'), named('fixture:a', 'Original office', '原职务'), named('fixture:b', 'Earlier name', '较早名称')],
    assertions: [{ id: 'fixture:claim', subjectId: 'fixture:subject', propertyId: 'fixture:position', value: { kind: 'entity', objectId: 'fixture:a' }, qualifiers: [], sourceSnapshotId: source.id, evidence: [{ sourceId: source.id, locator: 'Synthetic row' }], review: 'unreviewed' }],
    sources: [source],
  };
  const initial = await repository.initialize(knowledgeCollectionSeedFiles(collection));
  const subject = (id: string) => ({ object: collection.objects[0], assertions: [{ ...collection.assertions[0], value: { kind: 'entity', objectId: id } }] });
  await repository.write([
    { path: objectPath('fixture:subject'), value: json(subject('fixture:b')) },
    { path: objectPath('fixture:b'), value: json({ object: named('fixture:b', 'Frozen office B', '已暂存职务乙'), assertions: [] }) },
  ]);
  const staged = await repository.stage([{ path: objectPath('fixture:subject') }, { path: objectPath('fixture:b') }]);
  await repository.write([
    { path: objectPath('fixture:subject'), value: json(subject('fixture:c')) },
    { path: objectPath('fixture:b'), value: json({ object: named('fixture:b', 'Later working rename', '后续工作名称'), assertions: [] }) },
    { path: objectPath('fixture:c'), value: json({ object: named('fixture:c', 'Working office C', '工作职务丙'), assertions: [] }) },
  ]);
  await repository.close();
  const service = await createLocalService({ dataDirectory, seedPackagePath: seed, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), resolveFileToken: () => undefined });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  let sequence = 0;
  async function call<M extends ServiceMethod>(method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
    const result = await service.dispatch({ protocolVersion: 1, requestId: `diff-names-${++sequence}`, method, params } as ServiceRequest);
    assert.ok(result.ok, JSON.stringify(result)); return result.result as ServiceMethods[M]['result'];
  }
  const before = await call('repository.status', {});
  const frozen = await call('repository.diff', { mode: 'staged', paths: [objectPath('fixture:subject')] });
  assert.equal(frozen.entries.length, 1);
  assert.deepEqual(frozen.entries[0].referenceLabels, {
    before: { 'fixture:a': { en: 'Original office', 'zh-CN': '原职务' }, 'fixture:b': { en: 'Earlier name', 'zh-CN': '较早名称' } },
    after: { 'fixture:a': { en: 'Original office', 'zh-CN': '原职务' }, 'fixture:b': { en: 'Frozen office B', 'zh-CN': '已暂存职务乙' } },
  });
  assert.ok(!JSON.stringify(frozen).includes('Later working rename'));
  assert.ok(!JSON.stringify(frozen).includes('Working office C'));
  const working = await call('repository.diff', { mode: 'working', paths: [objectPath('fixture:subject')] });
  assert.deepEqual(working.entries[0].referenceLabels?.before['fixture:b'], { en: 'Frozen office B', 'zh-CN': '已暂存职务乙' });
  assert.deepEqual(working.entries[0].referenceLabels?.after['fixture:c'], { en: 'Working office C', 'zh-CN': '工作职务丙' });
  assert.equal(working.entries[0].referenceLabels?.before['fixture:c'], undefined);
  const command = await call('command.execute', { input: { command: `git diff --staged -- ${objectPath('fixture:subject')}` } });
  assert.ok(command.ok && command.output.kind === 'repository-diff');
  assert.deepEqual(command.output.diff.entries[0].referenceLabels, frozen.entries[0].referenceLabels);
  assert.deepEqual(await call('repository.status', {}), before);
  assert.equal(before.head, initial.head); assert.equal(before.stagedTree, staged.stagedTree);
});
