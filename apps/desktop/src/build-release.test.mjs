import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIsolatedRelease } from '../build-release.mjs';
import { CLEAN_INSTALL_FILE } from '../release-provenance.mjs';

async function fixture(t, failInstall = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitworld-build-entry-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [], inspected = [];
  const inspectSource = async directory => { inspected.push(directory); return { sourceCommit: 'a'.repeat(40), lockfileSha256: 'b'.repeat(64) }; };
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git' && args[0] === 'clone') await mkdir(args.at(-1));
    if (command === 'npm' && args[0] === 'ci' && failInstall) throw new Error('SYNTHETIC_INSTALL_FAILED');
    return { stdout: command === 'npm' && args[0] === '--version' ? '11.0.0\n' : 'Synthetic successful command', stderr: '' };
  };
  return { root, calls, inspected, options: { tag: 'v0.1.0-test', run, inspectSource, hashDependencies: async () => 'c'.repeat(64) } };
}

test('release entry clones an isolated source and actually invokes npm ci before any build or package command', async t => {
  const f = await fixture(t), result = await buildIsolatedRelease(f.root, f.options);
  assert.notEqual(result.checkout, f.root);
  assert.equal(f.inspected.length, 2);
  assert.deepEqual(f.calls.map(call => [call.command === process.execPath ? 'node' : call.command, call.args[0]]), [['git', 'clone'], ['git', 'checkout'], ['npm', '--version'], ['npm', 'ci'], ['node', 'apps/desktop/build.mjs'], ['node', 'apps/desktop/package.mjs']]);
  assert.ok(f.calls.every(call => call.options.shell === false));
  assert.ok(f.calls.slice(1).every(call => call.options.cwd === result.checkout));
  const proof = JSON.parse(await readFile(path.join(result.checkout, CLEAN_INSTALL_FILE), 'utf8'));
  assert.equal(proof.method, 'npm-ci'); assert.equal(proof.isolation, 'fresh-checkout'); assert.equal(proof.sourceCommit, 'a'.repeat(40)); assert.equal(proof.dependencyTreeSha256, 'c'.repeat(64));
});

test('a failed dependency install never creates installation proof or invokes build/packaging', async t => {
  const f = await fixture(t, true);
  await assert.rejects(buildIsolatedRelease(f.root, f.options), /SYNTHETIC_INSTALL_FAILED/);
  assert.ok(f.calls.every(call => call.command !== process.execPath));
  const checkout = f.inspected[1];
  await assert.rejects(readFile(path.join(checkout, CLEAN_INSTALL_FILE)), { code: 'ENOENT' });
});
