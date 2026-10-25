import { build, Platform, Arch } from 'electron-builder';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BUILD_PROVENANCE_FILE, verifyPreparedBuild } from './release-provenance.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const internal = process.argv.includes('--internal');
if (process.platform !== 'darwin') throw new Error('This packaging command currently validates macOS only.');
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
const iconPath = path.join(root, '.local/desktop-icon/GitWorld.icns');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const output = path.join(root, '.local/releases');
const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const builtArtifacts = await build({ projectDir: root, targets: Platform.MAC.createTarget(internal || process.argv.includes('--dir') ? ['dir'] : ['dmg'], process.arch === 'arm64' ? Arch.arm64 : Arch.x64), publish: 'never', config: {
  appId: internal ? 'org.gitworld.internal' : 'org.gitworld.desktop',
  productName: internal ? 'GitWorld Internal' : 'GitWorld',
  electronVersion: project.devDependencies.electron,
  directories: { app: path.join(directory, 'dist'), output },
  files: ['main.cjs', 'preload.cjs', 'utility.cjs', 'renderer/**', 'resources/GitWorld.png', 'resources/icon.svg', 'package.json', 'build-info.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/**', 'data/licenses/**', 'data/seed/early-medieval.json', 'data/seed/east-asia/**'],
  extraResources: [{ from: path.join(directory, 'dist/git-runtime'), to: 'git-runtime' }, { from: path.join(directory, 'dist/git-corresponding-source'), to: 'git-corresponding-source' }, { from: path.join(directory, 'dist/git-runtime-manifest.json'), to: 'git-runtime-manifest.json' }],
  asar: true,
  npmRebuild: false,
  artifactName: '${productName}-${version}-${arch}-unsigned.${ext}',
  mac: { icon: iconPath, category: 'public.app-category.education', identity: null, notarize: false, hardenedRuntime: false, target: [internal ? 'dir' : 'dmg'] },
  dmg: { title: internal ? 'GitWorld Internal' : 'GitWorld', sign: false },
  afterPack: async (context) => {
    const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/MacOS', context.packager.appInfo.productFilename);
    await flipFuses(executable, { version: FuseVersion.V1, resetAdHocDarwinSignature: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    });
  },
} });
const receipts = [];
for (const artifact of builtArtifacts) if (artifact.endsWith('.dmg')) {
  const name = path.basename(artifact);
  const bytes = await readFile(artifact);
  receipts.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
const appName = internal ? 'GitWorld Internal' : 'GitWorld';
const asarPath = path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${appName}.app/Contents/Resources/app.asar`);
const asarSha256 = createHash('sha256').update(await readFile(asarPath)).digest('hex');
if (!internal) await verifyPreparedBuild(root, path.join(directory, 'dist'), prepared, { tag: process.env.GITWORLD_RELEASE_TAG });
const receipt = { schemaVersion: 1, kind: 'gitworld-build', appName, buildId: info.buildId, source: info.source, preparedSha256, asarSha256, completedAt: new Date().toISOString(), platform: 'darwin', arch: process.arch, internal, signing: 'unsigned', distributionSigning: 'unsigned; no Developer ID certificate or notarization', binarySigning: 'ad-hoc fuse reset where required by macOS', published: false, artifacts: receipts };
await writeFile(path.join(output, 'local-build-receipt.json'), JSON.stringify(receipt, null, 2));
if (!internal && receipts.length) await writeFile(path.join(output, `GitWorld-${info.source.tag}-${process.arch}-build.json`), JSON.stringify(receipt, null, 2));
console.log('Local package created. No upload occurred. This build is not Developer ID signed or notarized.');
