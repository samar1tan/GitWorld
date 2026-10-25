import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, readlink, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

export const SOURCE_REPOSITORY = 'https://github.com/samar1tan/GitWorld';
export const BUILD_PROVENANCE_FILE = '.local/desktop-build-provenance.json';
export const CLEAN_INSTALL_FILE = '.local/desktop-clean-install.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const git = (root, args) => {
  try { return execFileSync('git', ['-c', 'core.fsmonitor=false', '--no-pager', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim(); }
  catch { fail('RELEASE_GIT_CHECK_FAILED'); }
};

export async function captureAcceptedSource(root, { tag, remoteRefs = (directory, refs) => git(directory, ['ls-remote', 'origin', ...refs]) } = {}) {
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag || '')) fail('RELEASE_TAG_REQUIRED');
  // Check before network access; unpublished work must never become a release build.
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=all'])) fail('RELEASE_SOURCE_DIRTY');
  const indexFlags = git(root, ['ls-files', '-v']).split('\n');
  if (indexFlags.some(line => line && (line[0] === 'S' || line[0] === line[0].toLowerCase()))) fail('RELEASE_SOURCE_HIDDEN_CHANGES');
  if (git(root, ['ls-files', '--stage']).split('\n').some(line => line && !/^100(?:644|755) /.test(line))) fail('RELEASE_SOURCE_NONREGULAR');
  const origin = git(root, ['remote', 'get-url', 'origin']);
  if (!['https://github.com/samar1tan/GitWorld', 'https://github.com/samar1tan/GitWorld.git', 'git@github.com:samar1tan/GitWorld.git'].includes(origin)) fail('RELEASE_SOURCE_REPOSITORY_MISMATCH');
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  const sourceTree = git(root, ['rev-parse', 'HEAD^{tree}']);
  if (git(root, ['rev-parse', `refs/tags/${tag}^{commit}`]) !== sourceCommit) fail('RELEASE_TAG_SOURCE_MISMATCH');
  const refs = new Map(String(await remoteRefs(root, ['refs/heads/main', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])).trim().split('\n').filter(Boolean).map(line => {
    const [sha, ref] = line.split(/\s+/); return [ref, sha];
  }));
  const acceptedMainCommit = refs.get('refs/heads/main');
  const remoteTag = refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`);
  if (remoteTag !== sourceCommit) fail('RELEASE_REMOTE_TAG_MISMATCH');
  if (!/^[a-f0-9]{40}$/.test(acceptedMainCommit || '') || git(root, ['rev-parse', 'refs/remotes/origin/main']) !== acceptedMainCommit) fail('RELEASE_MAIN_REF_STALE');
  if (git(root, ['merge-base', sourceCommit, acceptedMainCommit]) !== sourceCommit) fail('RELEASE_SOURCE_NOT_ON_MAIN');
  const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (`v${project.version}` !== tag) fail('RELEASE_VERSION_TAG_MISMATCH');
  return { schemaVersion: 1, repository: SOURCE_REPOSITORY, tag, sourceCommit, sourceTree, acceptedMainCommit,
    lockfileSha256: hash(await readFile(path.join(root, 'package-lock.json'))) };
}

export async function dependencyTreeHash(root) {
  return hash(JSON.stringify(await directoryManifest(path.join(root, 'node_modules'), { repositoryRoot: await realpath(root) })));
}

export async function captureReleaseSource(root, options = {}) {
  const source = await captureAcceptedSource(root, options);
  const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const tools = {};
  for (const name of ['electron', 'electron-builder', 'esbuild', 'vite', '@electron/fuses', '@resvg/resvg-js']) {
    const installed = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    if (project.devDependencies?.[name] !== installed) fail('RELEASE_INSTALLED_TOOL_MISMATCH');
    tools[name] = installed;
  }
  let install;
  try { install = JSON.parse(await readFile(path.join(root, CLEAN_INSTALL_FILE), 'utf8')); } catch { fail('RELEASE_CLEAN_INSTALL_REQUIRED'); }
  if (install?.schemaVersion !== 1 || install.method !== 'npm-ci' || install.isolation !== 'fresh-checkout' || install.exitCode !== 0 || install.checkoutRoot !== await realpath(root) || install.sourceCommit !== source.sourceCommit || install.lockfileSha256 !== source.lockfileSha256 || !/^[a-f0-9]{64}$/.test(install.logSha256 || '') || !/^\d+\.\d+\.\d+/.test(install.npmVersion || '') || !Number.isFinite(Date.parse(install.startedAt)) || !Number.isFinite(Date.parse(install.completedAt)) || Date.parse(install.completedAt) < Date.parse(install.startedAt)) fail('RELEASE_CLEAN_INSTALL_MISMATCH');
  if (install.dependencyTreeSha256 !== await dependencyTreeHash(root)) fail('RELEASE_DEPENDENCY_TREE_CHANGED');
  const { checkoutRoot, ...installation } = install;
  return { ...source, installation,
    toolchain: { node: process.versions.node, platform: process.platform, architecture: process.arch, osRelease: os.release(), packages: tools } };
}

export async function directoryManifest(directory, { repositoryRoot } = {}) {
  const files = [];
  async function visit(relative = '') {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const file = relative ? `${relative}/${name}` : name;
      const full = path.join(directory, file);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        if (!repositoryRoot) fail('RELEASE_DIST_NONREGULAR');
        const target = await readlink(full), resolved = await realpath(full);
        if (path.isAbsolute(target) || !resolved.startsWith(repositoryRoot + path.sep)) fail('RELEASE_DEPENDENCY_LINK_ESCAPE');
        files.push({ path: file, link: target });
        continue;
      }
      if (!stat.isFile() && !stat.isDirectory()) fail('RELEASE_DIST_NONREGULAR');
      if (stat.isDirectory()) await visit(file);
      else files.push({ path: file, bytes: stat.size, sha256: hash(await readFile(full)) });
    }
  }
  await visit();
  return files;
}

export async function prepareBuildProvenance(root, directory, source, buildId) {
  return { schemaVersion: 1, kind: 'gitworld-prepared-build', buildId, source, files: await directoryManifest(directory) };
}

export async function verifyPreparedBuild(root, directory, prepared, options = {}) {
  if (prepared?.schemaVersion !== 1 || prepared?.kind !== 'gitworld-prepared-build' || !prepared.source || !Array.isArray(prepared.files)) fail('RELEASE_PREPARED_BUILD_REQUIRED');
  const current = await captureReleaseSource(root, options);
  // Main can advance between build and packaging; the source must still be its ancestor.
  for (const key of ['repository', 'tag', 'sourceCommit', 'sourceTree', 'lockfileSha256', 'installation', 'toolchain']) {
    if (JSON.stringify(current[key]) !== JSON.stringify(prepared.source[key])) fail('RELEASE_STALE_BUILD_SOURCE');
  }
  if (JSON.stringify(await directoryManifest(directory)) !== JSON.stringify(prepared.files)) fail('RELEASE_DIST_MISMATCH');
  const info = JSON.parse(await readFile(path.join(directory, 'build-info.json'), 'utf8'));
  if (info.buildId !== prepared.buildId || info.internal || info.distribution !== 'product' || !info.rendererReady || !info.service || JSON.stringify(info.source) !== JSON.stringify(prepared.source)) fail('RELEASE_BUILD_INFO_MISMATCH');
  return current;
}
