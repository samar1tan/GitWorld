import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { captureAcceptedSource, captureReleaseSource, dependencyTreeHash, CLEAN_INSTALL_FILE, prepareBuildProvenance, verifyPreparedBuild } from '../release-provenance.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitworld-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Synthetic Release Test'); git('config', 'user.email', 'release-test@example.invalid');
  const tools = ['electron', 'electron-builder', 'esbuild', 'vite', '@electron/fuses', '@resvg/resvg-js'];
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\ndist/\n.local/\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0-test', devDependencies: Object.fromEntries(tools.map(name => [name, '1.0.0'])) }));
  await writeFile(path.join(root, 'package-lock.json'), '{"synthetic":true}\n');
  await writeFile(path.join(root, 'source.txt'), 'source one\n');
  for (const name of tools) { await mkdir(path.join(root, 'node_modules', name), { recursive: true }); await writeFile(path.join(root, 'node_modules', name, 'package.json'), '{"version":"1.0.0"}'); }
  git('add', '.gitignore', 'package.json', 'package-lock.json', 'source.txt'); git('commit', '-m', 'Synthetic source');
  git('tag', '-a', 'v0.1.0-test', '-m', 'Synthetic tag');
  git('remote', 'add', 'origin', 'https://github.com/samar1tan/GitWorld.git');
  let remoteMain = git('rev-parse', 'HEAD'), remoteTag = remoteMain;
  git('update-ref', 'refs/remotes/origin/main', remoteMain);
  const options = { tag: 'v0.1.0-test', remoteRefs: async () => `${remoteMain}\trefs/heads/main\n${git('rev-parse', 'refs/tags/v0.1.0-test')}\trefs/tags/v0.1.0-test\n${remoteTag}\trefs/tags/v0.1.0-test^{}` };
  const dist = path.join(root, 'dist'); await mkdir(dist);
  async function installEvidence() {
    const source = await captureAcceptedSource(root, options);
    await mkdir(path.join(root, '.local'), { recursive: true });
    await writeFile(path.join(root, CLEAN_INSTALL_FILE), JSON.stringify({ schemaVersion: 1, method: 'npm-ci', isolation: 'fresh-checkout', exitCode: 0, checkoutRoot: await import('node:fs/promises').then(fs => fs.realpath(root)), sourceCommit: source.sourceCommit, lockfileSha256: source.lockfileSha256, npmVersion: '11.0.0', startedAt: '2026-10-25T00:00:00Z', completedAt: '2026-10-25T00:01:00Z', logSha256: 'a'.repeat(64), dependencyTreeSha256: await dependencyTreeHash(root) }));
  }
  await installEvidence();
  async function prepare() {
    const source = await captureReleaseSource(root, options);
    await writeFile(path.join(dist, 'main.cjs'), 'synthetic bundled output\n');
    await writeFile(path.join(dist, 'build-info.json'), JSON.stringify({ buildId: '123', internal: false, distribution: 'product', rendererReady: true, service: true, source }));
    return prepareBuildProvenance(root, dist, source, '123');
  }
  return { root, dist, git, options, prepare, installEvidence, setRemote: (main, tag = main) => { remoteMain = main; remoteTag = tag; } };
}

test('clean tagged source, pinned tools and exact prepared bytes form a verifiable build', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  assert.equal(prepared.source.sourceCommit, f.git('rev-parse', 'HEAD'));
  assert.equal(prepared.source.tag, 'v0.1.0-test');
  assert.equal(prepared.files.length, 2);
  assert.equal((await verifyPreparedBuild(f.root, f.dist, prepared, f.options)).sourceTree, f.git('rev-parse', 'HEAD^{tree}'));
});

test('unstaged, staged and untracked source changes fail before remote access', async t => {
  const f = await fixture(t);
  const options = { ...f.options, remoteRefs: () => { throw new Error('Network must not run'); } };
  await writeFile(path.join(f.root, 'source.txt'), 'dirty\n');
  await assert.rejects(captureReleaseSource(f.root, options), /RELEASE_SOURCE_DIRTY/);
  f.git('add', 'source.txt');
  await assert.rejects(captureReleaseSource(f.root, options), /RELEASE_SOURCE_DIRTY/);
  f.git('reset', '--hard', 'HEAD');
  await writeFile(path.join(f.root, 'unexpected.txt'), 'unreviewed input\n');
  await assert.rejects(captureReleaseSource(f.root, options), /RELEASE_SOURCE_DIRTY/);
});

test('a matching local tag is insufficient when the remote tag or accepted main differs', async t => {
  const f = await fixture(t), sha = f.git('rev-parse', 'HEAD');
  f.setRemote(sha, 'a'.repeat(40));
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_REMOTE_TAG_MISMATCH/);
  f.setRemote('b'.repeat(40), sha);
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_MAIN_REF_STALE/);
  await writeFile(path.join(f.root, 'source.txt'), 'unmerged source\n'); f.git('add', 'source.txt'); f.git('commit', '-m', 'Synthetic unmerged change');
  f.git('tag', '-f', 'v0.1.0-test'); f.setRemote(sha, f.git('rev-parse', 'HEAD'));
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_SOURCE_NOT_ON_MAIN/);
});

test('old dist cannot be relabeled with a newer clean source or forced tag', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  await writeFile(path.join(f.root, 'source.txt'), 'source two\n'); f.git('add', 'source.txt'); f.git('commit', '-m', 'Synthetic next source');
  const sha = f.git('rev-parse', 'HEAD'); f.git('tag', '-f', 'v0.1.0-test'); f.git('update-ref', 'refs/remotes/origin/main', sha); f.setRemote(sha);
  await f.installEvidence();
  await assert.rejects(verifyPreparedBuild(f.root, f.dist, prepared, f.options), /RELEASE_STALE_BUILD_SOURCE/);
});

test('modified, extra and symlinked dist files are rejected before packaging', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  const main = await readFile(path.join(f.dist, 'main.cjs'));
  await writeFile(path.join(f.dist, 'main.cjs'), 'changed output');
  await assert.rejects(verifyPreparedBuild(f.root, f.dist, prepared, f.options), /RELEASE_DIST_MISMATCH/);
  await writeFile(path.join(f.dist, 'main.cjs'), main); await writeFile(path.join(f.dist, 'extra.js'), 'stale file');
  await assert.rejects(verifyPreparedBuild(f.root, f.dist, prepared, f.options), /RELEASE_DIST_MISMATCH/);
  await rm(path.join(f.dist, 'extra.js')); await symlink(path.join(f.root, 'source.txt'), path.join(f.dist, 'link'));
  await assert.rejects(verifyPreparedBuild(f.root, f.dist, prepared, f.options), /RELEASE_DIST_NONREGULAR/);
});

test('hidden index flags, mismatched tools and package versions cannot authorize a release', async t => {
  const f = await fixture(t);
  f.git('update-index', '--assume-unchanged', 'source.txt');
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_SOURCE_HIDDEN_CHANGES/);
  f.git('update-index', '--no-assume-unchanged', 'source.txt');
  await writeFile(path.join(f.root, 'node_modules/electron/package.json'), '{"version":"9.0.0"}');
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_INSTALLED_TOOL_MISMATCH/);
  await assert.rejects(captureReleaseSource(f.root, { ...f.options, tag: '' }), /RELEASE_TAG_REQUIRED/);
  await writeFile(path.join(f.root, 'node_modules/electron/package.json'), '{"version":"1.0.0"}');
  const project = JSON.parse(await readFile(path.join(f.root, 'package.json'), 'utf8')); project.version = '0.2.0';
  await writeFile(path.join(f.root, 'package.json'), JSON.stringify(project)); f.git('add', 'package.json'); f.git('commit', '-m', 'Synthetic version mismatch');
  const sha = f.git('rev-parse', 'HEAD'); f.git('tag', '-f', 'v0.1.0-test'); f.git('update-ref', 'refs/remotes/origin/main', sha); f.setRemote(sha);
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_VERSION_TAG_MISMATCH/);
});

test('same-version dependency tampering and missing clean-install evidence fail closed', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'node_modules/electron/unexpected.cjs'), 'same package version, different contents');
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_DEPENDENCY_TREE_CHANGED/);
  await rm(path.join(f.root, CLEAN_INSTALL_FILE));
  await assert.rejects(captureReleaseSource(f.root, f.options), /RELEASE_CLEAN_INSTALL_REQUIRED/);
});
