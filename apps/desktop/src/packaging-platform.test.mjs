import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopTarget, packagedPaths, buildReceiptName } from '../packaging-platform.mjs';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { validateBuildReceipt } from '../../../site/receipt-validation.mjs';
import { syntheticRelease } from '../../../site/release-fixture.mjs';

test('native macOS paths and receipt names retain their established identity', () => {
  for (const arch of ['arm64', 'x64']) {
    const target = desktopTarget('darwin', arch);
    const paths = packagedPaths('/output', target);
    assert.equal(target.artifactName, '${productName}-${version}-${arch}-unsigned.${ext}');
    assert.deepEqual(target.targets, ['dmg']);
    assert.equal(paths.asar, `/output/${arch === 'arm64' ? 'mac-arm64' : 'mac'}/GitWorld.app/Contents/Resources/app.asar`);
    assert.equal(buildReceiptName('v0.1.1', target), `GitWorld-v0.1.1-${arch}-build.json`);
  }
});

test('Linux candidates carry explicit experimental names and resolve the actual unpacked executable', () => {
  const target = desktopTarget('linux', 'x64');
  assert.equal(target.experimental, true);
  assert.deepEqual(target.targets, ['tar.gz', 'deb']);
  assert.equal(target.artifactName, '${productName}-${version}-linux-x64-experimental.${ext}');
  assert.equal(buildReceiptName('v0.1.1', target), 'GitWorld-v0.1.1-linux-x64-experimental-build.json');
  assert.deepEqual(packagedPaths('/output', target), { bundle: '/output/linux-unpacked', executable: '/output/linux-unpacked/gitworld', asar: '/output/linux-unpacked/resources/app.asar' });
  assert.equal(packagedPaths('/output', desktopTarget('linux', 'x64', true), true).executable, '/output/linux-unpacked/gitworld-internal');
});

test('unimplemented targets are rejected instead of choosing a cross-build default', () => {
  for (const [platform, arch] of [['win32','x64'], ['linux','arm64'], ['linux','ia32'], ['darwin','ia32']]) assert.throws(() => desktopTarget(platform, arch), /NATIVE_DESKTOP_TARGET_NOT_SUPPORTED/);
});

test('an otherwise matching Linux build cannot satisfy the primary macOS receipt validator', () => {
  const fixture = syntheticRelease();
  validateBuildReceipt(fixture.build, fixture.release);
  fixture.build.platform = 'linux';
  fixture.build.experimental = true;
  fixture.build.source.toolchain.platform = 'linux';
  assert.throws(() => validateBuildReceipt(fixture.build, fixture.release), /BUILD_RECEIPT_MISMATCH/);
});

test('packaged smoke rejects a foreign receipt without importing or downloading development Electron', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitworld-platform-smoke-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'apps/desktop'), { recursive: true });
  await mkdir(path.join(root, '.local/releases'), { recursive: true });
  for (const name of ['smoke.mjs','packaging-platform.mjs']) await copyFile(new URL('../' + name, import.meta.url), path.join(root, 'apps/desktop', name));
  await writeFile(path.join(root, '.local/releases/local-build-receipt.json'), JSON.stringify({ platform: 'foreign', arch: process.arch, internal: false }));
  const result = spawnSync(process.execPath, [path.join(root, 'apps/desktop/smoke.mjs'), '--packaged'], { encoding: 'utf8', timeout: 5000, env: { PATH: '/nonexistent' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, process.platform === 'linux' && process.getuid?.() === 0 ? /LINUX_SMOKE_REQUIRES_NONROOT_SANDBOX/ : /PACKAGED_RECEIPT_MISMATCH/);
  assert.doesNotMatch(result.stdout + result.stderr, /Downloading Electron|ERR_MODULE_NOT_FOUND/);
});
