import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditorialRepository } from '../packages/storage/src/editorial.ts';

// Synthetic capacity evidence for the file/version pipeline, not real-source or GUI acceptance.
const count = Number(process.argv[2] ?? 10000);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('Record count must be between 1 and 10000.');
const root = fileURLToPath(new URL('../', import.meta.url)), directory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-editorial-benchmark-'));
const started = performance.now(), timings = {}; let repository;
async function phase(name, operation) { const start = performance.now(); console.error(`Starting ${name}`); const result = await operation(); timings[name] = Math.round((performance.now() - start) * 100) / 100; console.error(`${name}: ${timings[name]} ms`); return result; }
try {
  repository = await createEditorialRepository({ dataDirectory: directory, gitExecutable: path.join(root, '.local/bundled-git/runtime/bin/git'), gitExecPath: path.join(root, '.local/bundled-git/runtime/libexec/git-core') });
  await repository.initialize();
  const files = Array.from({ length: count }, (_, index) => ['objects', 'sources', 'mappings'].map(kind => ({ path: `${kind}/benchmark-${index}.json`, value: { schemaVersion: 1, fixture: 'synthetic capacity workload', record: index, kind, value: 'B' } }))).flat();
  await phase('writeMs', () => repository.write(files));
  const staged = await phase('stageMs', () => repository.stage(files.map(file => ({ path: file.path }))));
  await repository.write([{ path: files[0].path, value: { ...files[0].value, value: 'C' } }]);
  const committed = await phase('commitMs', () => repository.commit({ operationId: 'synthetic-bulk-capacity', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record the synthetic bulk capacity workload' }));
  const snapshot = await phase('snapshotMs', () => repository.snapshot({ from: committed.oid }));
  assert.equal(Object.keys(snapshot.files).length, count * 3);
  assert.equal(snapshot.files[files[0].path].value, 'B');
  assert.equal((await repository.read(files[0].path)).value, 'C');
  assert.equal((await repository.status()).unstaged.length, 1);
  console.log(JSON.stringify({ kind: 'synthetic-editorial-capacity', records: count, files: files.length, platform: process.platform, architecture: process.arch, node: process.versions.node, cpu: os.cpus()[0]?.model, memoryGiB: os.totalmem() / 1024 ** 3, timings, totalMs: Math.round(performance.now() - started), assertions: 'All files present; committed B and working C remain distinct. Not a real-source or installed-app measurement.' }, null, 2));
} finally { await repository?.close(); await rm(directory, { recursive: true, force: true }); }
