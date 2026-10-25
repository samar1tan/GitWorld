import { build, Platform, Arch } from 'electron-builder';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BUILD_PROVENANCE_FILE, verifyPreparedBuild } from './release-provenance.mjs';
import { desktopTarget, packagedPaths, buildReceiptName } from './packaging-platform.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const internal = process.argv.includes('--internal');
const target = desktopTarget(process.platform, process.arch, internal);
const info = JSON.parse(await readFile(path.join(directory, 'dist/build-info.json'), 'utf8'));
if (!internal && info.internal) throw new Error('Product packaging is blocked: the desktop renderer and local service must both be connected. Use --internal only for a clearly marked engineering smoke build.');
let prepared = null;
let preparedSha256 = null;
if (!internal) {
  const bytes = await readFile(path.join(root, BUILD_PROVENANCE_FILE));
  prepared = JSON.parse(bytes);
  preparedSha256 = createHash('sha256').update(bytes).digest('hex');
  await verifyPreparedBuild(root, path.join(directory, 'dist'), prepared, { tag: process.env.GITWORLD_RELEASE_TAG });
} else if (info.distribution === 'product') {
  throw new Error('INTERNAL_PACKAGE_REQUIRES_INTERNAL_BUILD');
}
const iconBuild = spawnSync(process.execPath, [path.join(directory, 'build-icon.mjs')], { stdio: 'inherit' });
if (iconBuild.status !== 0) throw new Error('APPLICATION_ICON_BUILD_FAILED');
const iconPath = path.join(root, '.local/desktop-icon', process.platform === 'darwin' ? 'GitWorld.icns' : 'GitWorld.png');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const output = path.join(root, '.local/releases');
const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const nativePlatform = process.platform === 'darwin' ? Platform.MAC : Platform.LINUX;
const builtArtifacts = await build({ projectDir: root, targets: nativePlatform.createTarget(internal || process.argv.includes('--dir') ? ['dir'] : target.targets, process.arch === 'arm64' ? Arch.arm64 : Arch.x64), publish: 'never', config: {
  appId: internal ? 'org.gitworld.internal' : 'org.gitworld.desktop',
  productName: internal ? 'GitWorld Internal' : 'GitWorld',
  electronVersion: project.devDependencies.electron,
  directories: { app: path.join(directory, 'dist'), output },
  files: ['main.cjs', 'preload.cjs', 'utility.cjs', 'renderer/**', 'resources/GitWorld.png', 'resources/icon.svg', 'package.json', 'build-info.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/**', 'data/licenses/**', 'data/seed/early-medieval.json', 'data/seed/east-asia/**'],
  extraResources: [{ from: path.join(directory, 'dist/git-runtime'), to: 'git-runtime' }, { from: path.join(directory, 'dist/git-corresponding-source'), to: 'git-corresponding-source' }, { from: path.join(directory, 'dist/git-runtime-manifest.json'), to: 'git-runtime-manifest.json' }],
  asar: true,
  npmRebuild: false,
  artifactName: target.artifactName,
  mac: { icon: iconPath, category: 'public.app-category.education', minimumSystemVersion: '14.0', identity: null, notarize: false, hardenedRuntime: false, target: [internal ? 'dir' : 'dmg'] },
  dmg: { title: internal ? 'GitWorld Internal' : 'GitWorld', sign: false },
  linux: { executableName: target.executable, icon: iconPath, category: 'Education', target: target.targets, maintainer: 'GitWorld contributors', synopsis: 'Experimental local history workbench' },
  deb: { depends: ['libc6 (>= 2.35)', 'zlib1g', 'libgcc-s1', 'libstdc++6', 'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libgbm1', 'libasound2', 'libatk-bridge2.0-0', 'libcups2', 'libdrm2', 'libxkbcommon0'] },
  afterPack: async (context) => {
    const executable = process.platform === 'darwin' ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/MacOS', context.packager.appInfo.productFilename) : path.join(context.appOutDir, target.executable);
    await flipFuses(executable, { version: FuseVersion.V1, resetAdHocDarwinSignature: process.platform === 'darwin',
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: process.platform === 'darwin',
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    });
  },
} });
const receipts = [];
for (const artifact of builtArtifacts) if (target.targets.some(extension => artifact.endsWith('.' + extension))) {
  const name = path.basename(artifact);
  const bytes = await readFile(artifact);
  receipts.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
if (!internal && !process.argv.includes('--dir') && target.targets.some(extension => !receipts.some(artifact => artifact.name.endsWith('.' + extension)))) throw new Error('EXPECTED_NATIVE_ARTIFACT_MISSING');
const appName = internal ? 'GitWorld Internal' : 'GitWorld';
const asarPath = packagedPaths(output, target, internal).asar;
const asarSha256 = createHash('sha256').update(await readFile(asarPath)).digest('hex');
if (!internal) await verifyPreparedBuild(root, path.join(directory, 'dist'), prepared, { tag: process.env.GITWORLD_RELEASE_TAG });
const receipt = { schemaVersion: 1, kind: 'gitworld-build', appName, buildId: info.buildId, source: info.source, preparedSha256, asarSha256, completedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, internal, signing: 'unsigned', distributionSigning: target.experimental ? 'unsigned experimental Linux candidate; not a macOS release' : 'unsigned; no Developer ID certificate or notarization', binarySigning: target.experimental ? 'not signed' : 'ad-hoc fuse reset where required by macOS', ...(target.experimental ? { experimental: true, installedAcceptance: 'not-run', embeddedAsarIntegrity: 'unavailable-on-linux' } : {}), published: false, artifacts: receipts };
await writeFile(path.join(output, 'local-build-receipt.json'), JSON.stringify(receipt, null, 2));
if (!internal && receipts.length) await writeFile(path.join(output, buildReceiptName(info.source.tag, target)), JSON.stringify(receipt, null, 2));
console.log(target.experimental ? 'Experimental Linux candidate created. No upload occurred; complete installed GUI acceptance is not established.' : 'Local package created. No upload occurred. This build is not Developer ID signed or notarized.');
