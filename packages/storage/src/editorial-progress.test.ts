import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createEditorialRepository } from './editorial.ts';
import type { EditorialWriteProgress } from '../../contracts/src/editorial-types.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)), binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git runtime.' };
test('write progress follows durable seed/working files and ignores throwing or rejecting observers', native, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-write-progress-')), events: EditorialWriteProgress[] = [];
  let reject = false;
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), onWriteProgress: value => {
    assert.deepEqual(Object.keys(value).sort(), ['completed','total']);
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'repository', `models/file-${value.completed - 1}.json`), 'utf8')), { saved: true });
    events.push(value);
    if (reject) return Promise.reject(new Error('Observer promise rejection'));
    throw new Error('Observer exception');
  } });
  t.after(async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); });
  const seed = Object.fromEntries(Array.from({ length: 202 }, (_, index) => [`models/file-${index}.json`, { saved: true }]));
  const initial = await repository.initialize(seed);
  assert.deepEqual(events.map(value => [value.completed,value.total]), [[100,202],[200,202],[202,202]]); assert.equal(initial.staged.length, 0);
  reject = true; events.length = 0;
  await repository.write(Object.entries(seed).map(([path,value]) => ({ path, value })));
  assert.deepEqual(events.map(value => value.completed), [100,200,202]);
  assert.equal((await repository.status()).head, initial.head);
  events.length = 0; await assert.rejects(repository.write([{ path: 'models/file-0.json', value: { invalid: true } }], { expectedHead: '0'.repeat(40) }), { message: 'HEAD_CHANGED' }); assert.deepEqual(events, []);
});

test('failed writes report only completed paths; deletion progress follows the actual removal', native, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-write-progress-failure-')), events: EditorialWriteProgress[] = [], removedAtProgress: boolean[] = [];
  let inject = true, deleting = false;
  const blocked = path.join(directory, 'repository/models/file-149.json');
  const repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), onWriteProgress: value => {
    events.push(value);
    if (deleting) removedAtProgress.push(!existsSync(path.join(directory, 'repository/models/file-0.json')));
    if (inject && value.completed === 100) { inject = false; mkdirSync(blocked); }
  } });
  t.after(async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); });
  const initial = await repository.initialize();
  const changes = Array.from({ length: 202 }, (_, index) => ({ path: `models/file-${index}.json`, value: { saved: true } }));
  await assert.rejects(repository.write(changes), { code: 'EISDIR' });
  assert.deepEqual(events.map(value => [value.completed,value.total]), [[100,202],[149,202]]);
  assert.ok(existsSync(path.join(directory, 'repository/models/file-148.json'))); assert.equal(existsSync(path.join(directory, 'repository/models/file-150.json')), false);
  await rm(blocked, { recursive: true }); events.length = 0;
  await repository.write(changes); assert.deepEqual(events.map(value => value.completed), [100,200,202]);
  events.length = 0; deleting = true;
  await repository.write([{ path: 'models/file-0.json', value: null }]); assert.deepEqual(events, [{ completed: 1, total: 1 }]);
  assert.deepEqual(removedAtProgress, [true]);
  assert.equal((await repository.status()).head, initial.head); assert.equal((await repository.status()).staged.length, 0);
});
