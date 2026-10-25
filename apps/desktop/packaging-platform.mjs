import path from 'node:path';

/** Native targets only; experimental Linux receipts never stand in for macOS acceptance. */
export function desktopTarget(platform = process.platform, arch = process.arch, internal = false) {
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return {
    platform, arch, experimental: false, targets: ['dmg'],
    artifactName: '${productName}-${version}-${arch}-unsigned.${ext}',
    appDirectory: arch === 'arm64' ? 'mac-arm64' : 'mac',
    executable: internal ? 'GitWorld Internal' : 'GitWorld',
  };
  if (platform === 'linux' && arch === 'x64') return {
    platform, arch, experimental: true, targets: ['tar.gz', 'deb'],
    artifactName: '${productName}-${version}-linux-x64-experimental.${ext}',
    appDirectory: 'linux-unpacked', executable: internal ? 'gitworld-internal' : 'gitworld',
  };
  throw new Error('NATIVE_DESKTOP_TARGET_NOT_SUPPORTED');
}

export function packagedPaths(output, target, internal = false) {
  const appName = internal ? 'GitWorld Internal' : 'GitWorld';
  const bundle = target.platform === 'darwin' ? path.join(output, target.appDirectory, appName + '.app') : path.join(output, target.appDirectory);
  return {
    bundle,
    executable: target.platform === 'darwin' ? path.join(bundle, 'Contents/MacOS', target.executable) : path.join(bundle, target.executable),
    asar: target.platform === 'darwin' ? path.join(bundle, 'Contents/Resources/app.asar') : path.join(bundle, 'resources/app.asar'),
  };
}

export const buildReceiptName = (tag, target) => `GitWorld-${tag}-${target.experimental ? 'linux-' : ''}${target.arch}${target.experimental ? '-experimental' : ''}-build.json`;
