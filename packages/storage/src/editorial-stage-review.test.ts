import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EditorialStage } from '../../contracts/src/editorial-types.ts';
import { createEditorialRepository, EditorialFailure } from './editorial.ts';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.GITWORLD_TEST_GIT ?? path.join(project, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git before running pack staging review.' };
async function setup(t: { after(fn: () => unknown): void }, truncateImport = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld pack review 研究-'));
  const dataDirectory = path.join(directory, 'library'), marker = path.join(directory, 'truncate-next-import');
  let executable = binary;
  if (truncateImport) {
    const observer = path.join(directory, 'transport.mjs'), launcher = path.join(directory, 'git-observer');
    // The trusted transport fixture truncates the real protocol, never application data.
    await writeFile(observer, `import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2); let input = readFileSync(0);
if (args.includes('fast-import') && existsSync(${JSON.stringify(marker)})) {
  const remaining = Number(readFileSync(${JSON.stringify(marker)}, 'utf8'));
  writeFileSync(${JSON.stringify(marker)}, String(remaining - 1));
  if (remaining <= 1) input = input.subarray(0, Math.max(0, input.length - 5));
}
const result = spawnSync(${JSON.stringify(binary)}, args, { input, env: process.env, maxBuffer: 64 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`);
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(observer)} "$@"\n`);
    await chmod(launcher, 0o700); executable = launcher;
  }
  const repository = await createEditorialRepository({ dataDirectory, gitExecutable: executable, gitExecPath: path.resolve(binary, '../../libexec/git-core') });
  await repository.initialize({ 'research/one.json': { title: 'A' } });
  t.after(async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); });
  const packs = async () => (await readdir(path.join(dataDirectory, 'repository/.git/objects/pack'))).filter(name => name.endsWith('.pack'));
  return { repository, directory, marker, packs };
}

test('one thousand frozen blobs enter one pack without adding a commit or changing working C', native, async t => {
  const { repository, packs } = await setup(t), before = await repository.status(), previousPacks = (await packs()).length;
  await repository.write([{ path: 'research/one.json', value: { title: 'C', note: 'Working correction' } }]);
  const hostileText = '研究 🌍\nblob\nmark :999\ndata 0\nreset refs/heads/injected\ndone\n';
  const selection: EditorialStage[] = [{ path: 'research/one.json', value: { title: 'B', note: hostileText } }, ...Array.from({ length: 1000 }, (_, index) => ({ path: `objects/packed-${index}.json`, value: { id: index, label: `Object ${index} — 历史 🌍`, text: hostileText } }))];
  const started = performance.now(), staged = await repository.stage(selection);
  t.diagnostic(`Stage 1,001 explicit JSON blobs: ${Math.round(performance.now() - started)} ms; not a full-data import benchmark.`);
  assert.equal(staged.head, before.head); assert.equal((await repository.log()).length, 1);
  assert.equal(staged.staged.length, selection.length); assert.equal((await packs()).length - previousPacks, 1);
  const snapshot = await repository.snapshot({ from: 'staged' });
  for (const item of selection) assert.deepEqual(snapshot.files[item.path], item.value);
  const committed = await repository.commit({ operationId: 'record-packed-selection', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record frozen packed evidence' });
  assert.deepEqual(await repository.read('research/one.json', { from: committed.oid }), selection[0].value);
  assert.deepEqual(await repository.read('research/one.json'), { title: 'C', note: 'Working correction' });
});

test('payloads crossing the 32 MiB batch budget remain separate complete packs with exact UTF-8 content', native, async t => {
  const { repository, packs } = await setup(t), previousPacks = (await packs()).length;
  const payload = 'x'.repeat(11 * 1024 * 1024), selection = [1, 2, 3].map(index => ({ path: `objects/large-${index}.json`, value: { id: index, content: `${index}:${payload}:研究 🌍\nget-mark :999\ndone` } }));
  const staged = await repository.stage(selection);
  assert.equal(staged.staged.length, 3); assert.equal((await packs()).length - previousPacks, 2);
  const snapshot = await repository.snapshot({ from: 'staged', paths: selection.map(item => item.path) });
  for (const item of selection) assert.deepEqual(snapshot.files[item.path], item.value);
});

test('a later truncated real fast-import batch cannot replace any part of the existing index', native, async t => {
  const { repository, marker, packs } = await setup(t, true);
  await repository.write([{ path: 'research/one.json', value: { title: 'C' } }]);
  const before = await repository.status(), previousPacks = (await packs()).length; await writeFile(marker, '2');
  const payload = 'y'.repeat(11 * 1024 * 1024);
  const selection: EditorialStage[] = [{ path: 'research/one.json', value: { title: 'B' } }, ...[1, 2, 3].map(index => ({ path: `objects/partial-${index}.json`, value: { id: index, label: `Must remain unreferenced: ${payload}` } }))];
  await assert.rejects(repository.stage(selection), error => error instanceof EditorialFailure && error.code === 'GIT_FAILED');
  const after = await repository.status();
  assert.ok((await packs()).length > previousPacks, 'An earlier completed pack must still leave the selected index unchanged');
  assert.equal(after.head, before.head); assert.equal(after.stagedTree, before.stagedTree); assert.deepEqual(after.staged, before.staged);
  assert.deepEqual(await repository.read('research/one.json', { from: 'staged' }), { title: 'A' });
  for (const item of selection.slice(1)) assert.equal(await repository.read(item.path, { from: 'staged' }), null);
  assert.deepEqual(await repository.read('research/one.json'), { title: 'C' });
  await rm(marker);
  const retried = await repository.stage([{ path: 'research/one.json', value: { title: 'B' } }]);
  assert.equal(retried.staged.length, 1); assert.deepEqual(await repository.read('research/one.json', { from: 'staged' }), { title: 'B' });
});
