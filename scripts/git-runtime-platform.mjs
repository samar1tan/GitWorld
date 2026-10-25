const fail = () => { throw new Error('BUNDLED_GIT_PLATFORM_NOT_SUPPORTED'); };
export function gitBuildTarget(platform, arch) {
  const darwin = platform === 'darwin' && ['arm64', 'x64'].includes(arch), linux = platform === 'linux' && arch === 'x64';
  if (!darwin && !linux) return fail();
  const cpu = arch === 'x64' ? 'x86_64' : 'arm64';
  const flags = darwin ? `-O2 -arch ${cpu} -mmacosx-version-min=14.0` : '-O2';
  const configuration = `prefix = /gitworld-runtime\nCC = /usr/bin/${darwin ? 'clang' : 'gcc'}\nCFLAGS = ${flags}\nLDFLAGS = ${darwin ? `-arch ${cpu} -mmacosx-version-min=14.0` : ''}\nRUNTIME_PREFIX = YesPlease\nNO_HOMEBREW = YesPlease\nNO_DARWIN_PORTS = YesPlease\nNO_CURL = YesPlease\nNO_OPENSSL = YesPlease\nNO_EXPAT = YesPlease\nNO_GETTEXT = YesPlease\nNO_TCLTK = YesPlease\nNO_PERL = YesPlease\nNO_PYTHON = YesPlease\nNO_INSTALL_HARDLINKS = YesPlease\nNO_GITWEB = YesPlease\nNO_RUST = YesPlease\n`;
  return { platform, arch, configuration, compiler: `/usr/bin/${darwin ? 'clang' : 'gcc'}`, deploymentTarget: darwin ? '14.0' : 'Ubuntu 22.04 x64 / glibc 2.35 (experimental)', environment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C', ...(darwin ? { MACOSX_DEPLOYMENT_TARGET: '14.0' } : {}) } };
}

export function requireLinuxBaseline(osRelease) {
  const read = key => new RegExp(`^${key}=(?:"([^"]*)"|([^\\n]*))$`, 'm').exec(osRelease)?.slice(1).find(value => value !== undefined);
  if (read('ID') !== 'ubuntu' || read('VERSION_ID') !== '22.04') throw new Error('BUNDLED_GIT_LINUX_BASELINE_REQUIRED');
}

const linuxLibraries = new Set(['libz.so.1', 'libc.so.6', 'libpthread.so.0', 'libdl.so.2', 'librt.so.1', 'libresolv.so.2', 'libgcc_s.so.1', 'ld-linux-x86-64.so.2']);
export function linuxGitDependencies(ldd, header, versions) {
  if (!/Class:\s+ELF64/.test(header) || !/Machine:\s+Advanced Micro Devices X86-64/.test(header)) throw new Error('BUNDLED_GIT_ARCHITECTURE_MISMATCH');
  const dependencies = [], sonames = [];
  for (const line of ldd.split('\n').map(value => value.trim()).filter(Boolean)) {
    if (/^linux-vdso\.so\.1 \(0x[\da-f]+\)$/.test(line)) continue;
    const match = /^(?:(\S+) => )?(\/(?:usr\/)?lib(?:64)?\/\S+) \(0x[\da-f]+\)$/.exec(line);
    if (!match) throw new Error('BUNDLED_GIT_EXTERNAL_DEPENDENCY');
    const name = match[1] ?? match[2].split('/').at(-1);
    if (!linuxLibraries.has(name) || match[2].split('/').includes('..')) throw new Error('BUNDLED_GIT_EXTERNAL_DEPENDENCY');
    sonames.push(name); dependencies.push(match[2]);
  }
  if (!sonames.includes('libc.so.6') || !sonames.includes('ld-linux-x86-64.so.2')) throw new Error('BUNDLED_GIT_EXTERNAL_DEPENDENCY');
  const glibcVersions = [...new Set([...versions.matchAll(/\bGLIBC_(\d+)\.(\d+)(?:\.(\d+))?\b/g)].map(match => match.slice(1).filter(Boolean).join('.')))];
  if (!glibcVersions.length || glibcVersions.some(value => { const [major, minor] = value.split('.').map(Number); return major > 2 || major === 2 && minor > 35; })) throw new Error('BUNDLED_GIT_LINUX_GLIBC_TOO_NEW');
  return { dependencies, sonames, glibcVersions };
}
