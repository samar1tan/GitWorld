import test from 'node:test';
import assert from 'node:assert/strict';
import { gitBuildTarget, requireLinuxBaseline, linuxGitDependencies } from './git-runtime-platform.mjs';
import { mkdtemp, mkdir, copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const header = 'Class:                             ELF64\n  Machine:                           Advanced Micro Devices X86-64';
const ldd = 'linux-vdso.so.1 (0x00007ffe12340000)\nlibz.so.1 => /lib/x86_64-linux-gnu/libz.so.1 (0x00007abc12340000)\nlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007abc12350000)\n/lib64/ld-linux-x86-64.so.2 (0x00007abc12360000)';
let nativeRecipeSupported = process.platform === 'darwin' && ['arm64','x64'].includes(process.arch);
if (process.platform === 'linux' && process.arch === 'x64') {
  try { requireLinuxBaseline(await readFile('/etc/os-release','utf8')); nativeRecipeSupported = true; } catch { /* Other distributions are outside this recipe's build baseline. */ }
}

test('delivered corresponding-source recipe resolves its adjacent helper without a repository scripts directory', { skip: !nativeRecipeSupported && 'The native recipe requires macOS or Ubuntu22.04 x64.' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitworld-flat-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const delivered = path.join(root, 'corresponding-source');
  await mkdir(delivered);
  for (const name of ['build-bundled-git.mjs','git-runtime-platform.mjs']) await copyFile(new URL('./' + name, import.meta.url), path.join(delivered,name));
  const result = spawnSync(process.execPath, [path.join(delivered,'build-bundled-git.mjs'),'--verify-only'], { cwd: root, env: { PATH:'/nonexistent' }, encoding:'utf8', timeout:5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BUNDLED_GIT_PROVENANCE_INVALID/);
  assert.doesNotMatch(result.stderr, /ENOENT|ERR_MODULE_NOT_FOUND/);
  assert.deepEqual(await readdir(root), ['corresponding-source']);
});

test('Linux ELF inspection accepts only declared system dependencies and the baseline ABI', () => {
  const result = linuxGitDependencies(ldd, header, 'Name: GLIBC_2.2.5 Name: GLIBC_2.34');
  assert.deepEqual(result.sonames, ['libz.so.1','libc.so.6','ld-linux-x86-64.so.2']);
  assert.deepEqual(result.glibcVersions, ['2.2.5','2.34']);
  for (const bad of [ldd + '\nlibprivate.so => /lib/x86_64-linux-gnu/libprivate.so (0x1234)', ldd.replace('/lib/x86_64-linux-gnu/libz.so.1','/tmp/untrusted/libz.so.1'), ldd.replace('/lib/x86_64-linux-gnu/libz.so.1 (0x00007abc12340000)','not found'), ldd.replace('/lib64/ld-linux-x86-64.so.2','/tmp/ld-linux-x86-64.so.2')]) assert.throws(() => linuxGitDependencies(bad, header, 'GLIBC_2.35'), /BUNDLED_GIT_EXTERNAL_DEPENDENCY/);
  assert.throws(() => linuxGitDependencies(ldd, header, 'GLIBC_2.36'), /GLIBC_TOO_NEW/);
  assert.throws(() => linuxGitDependencies(ldd, header.replace('Advanced Micro Devices X86-64','AArch64'), 'GLIBC_2.35'), /ARCHITECTURE_MISMATCH/);
});

test('Linux builds require the native Ubuntu22.04 x64 baseline and never inherit macOS compiler flags', () => {
  requireLinuxBaseline('ID=ubuntu\nVERSION_ID="22.04"\n');
  for (const os of ['ID=ubuntu\nVERSION_ID="24.04"\n','ID=debian\nVERSION_ID="22.04"\n','ID=ubuntu\n']) assert.throws(() => requireLinuxBaseline(os), /BASELINE_REQUIRED/);
  const target = gitBuildTarget('linux','x64');
  assert.equal(target.compiler, '/usr/bin/gcc');
  assert.doesNotMatch(target.configuration, /-arch|-mmacosx|MACOSX/);
  assert.match(target.configuration, /NO_CURL = YesPlease/);
  assert.throws(() => gitBuildTarget('linux','arm64'), /PLATFORM_NOT_SUPPORTED/);
  assert.throws(() => gitBuildTarget('win32','x64'), /PLATFORM_NOT_SUPPORTED/);
});

test('macOS compiler and deployment configuration remain unchanged', () => {
  for (const [arch,cpu] of [['arm64','arm64'],['x64','x86_64']]) {
    const target = gitBuildTarget('darwin',arch);
    assert.ok(target.configuration.startsWith(`prefix = /gitworld-runtime\nCC = /usr/bin/clang\nCFLAGS = -O2 -arch ${cpu} -mmacosx-version-min=14.0\nLDFLAGS = -arch ${cpu} -mmacosx-version-min=14.0\n`));
    assert.equal(target.environment.MACOSX_DEPLOYMENT_TARGET, '14.0');
  }
});
