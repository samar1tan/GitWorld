import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rename, rm, lstat, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.56.0';
const SOURCE_SHA256 = '26c56c296b38c0695b26fa95f475f1d01704d2d38e73465ca30b0b2f5dc789d3';
const SOURCE_URL = `https://www.kernel.org/pub/software/scm/git/git-${VERSION}.tar.xz`;
const LGPL_URL = 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/LGPL-2.1-or-later.txt';
const LGPL_SHA256 = '5749785c8bdefafcb5d798270ed0a967036fe2ca63dcedade1627565dfef81d2';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(project, '.local/bundled-git');
const runtime = path.join(output, 'runtime');
const sourceArchive = path.join(output, `corresponding-source/git-${VERSION}.tar.xz`);
const lgplText = path.join(output, 'corresponding-source/LGPL-2.1-or-later.txt');
const recipe = fileURLToPath(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) fail('BUNDLED_GIT_PLATFORM_NOT_SUPPORTED');
if (process.argv.slice(2).some(arg => !['--force', '--verify-only'].includes(arg))) fail('BUNDLED_GIT_UNKNOWN_OPTION');
const architecture = process.arch === 'x64' ? 'x86_64' : 'arm64';
const configuration = `prefix = /gitworld-runtime\nCC = /usr/bin/clang\nCFLAGS = -O2 -arch ${architecture} -mmacosx-version-min=14.0\nLDFLAGS = -arch ${architecture} -mmacosx-version-min=14.0\nRUNTIME_PREFIX = YesPlease\nNO_HOMEBREW = YesPlease\nNO_DARWIN_PORTS = YesPlease\nNO_CURL = YesPlease\nNO_OPENSSL = YesPlease\nNO_EXPAT = YesPlease\nNO_GETTEXT = YesPlease\nNO_TCLTK = YesPlease\nNO_PERL = YesPlease\nNO_PYTHON = YesPlease\nNO_INSTALL_HARDLINKS = YesPlease\nNO_GITWEB = YesPlease\nNO_RUST = YesPlease\n`;
const environment = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C', MACOSX_DEPLOYMENT_TARGET: '14.0' };
function run(program, args, { cwd, log, env = environment } = {}) {
  const result = spawnSync(program, args, { cwd, env, shell: false, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000 });
  if (log) log.push(result.stdout ?? '', result.stderr ?? '');
  if (result.status !== 0) fail('BUNDLED_GIT_COMMAND_FAILED');
  return result.stdout.trim();
}
async function inventory(directory, relative = '') {
  const result = [];
  for (const name of (await readdir(path.join(directory, relative))).sort()) {
    const file = relative ? `${relative}/${name}` : name, full = path.join(directory, file), stat = await lstat(full);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('BUNDLED_GIT_NONREGULAR_FILE');
    if (stat.isDirectory()) result.push(...await inventory(directory, file));
    else {
      const bytes = await readFile(full);
      if (bytes.includes(Buffer.from('/Users/')) || bytes.includes(Buffer.from('/opt/homebrew/'))) fail('BUNDLED_GIT_PRIVATE_BUILD_PATH');
      result.push({ path: file, bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o777 });
    }
  }
  return result;
}
const recipeSha256 = hash(await readFile(recipe));
async function correspondingInventory() {
  const folder = path.dirname(sourceArchive);
  const expected = [`git-${VERSION}.tar.xz`, 'build-bundled-git.mjs', 'config.mak', 'LGPL-2.1-or-later.txt'].sort();
  if (JSON.stringify((await readdir(folder)).sort()) !== JSON.stringify(expected)) fail('BUNDLED_GIT_CORRESPONDING_SOURCE_UNEXPECTED');
  const files = [];
  for (const name of expected) {
    const full = path.join(folder, name), stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('BUNDLED_GIT_NONREGULAR_FILE');
    files.push({ path: name, bytes: stat.size, sha256: hash(await readFile(full)) });
  }
  return files;
}
async function validExisting() {
  try {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.version !== VERSION || manifest.architecture !== process.arch || manifest.source.sha256 !== SOURCE_SHA256 || manifest.recipe.sha256 !== recipeSha256 || manifest.configuration !== configuration || hash(await readFile(sourceArchive)) !== SOURCE_SHA256 || hash(await readFile(lgplText)) !== LGPL_SHA256 || JSON.stringify(await inventory(runtime)) !== JSON.stringify(manifest.files)) return false;
    if (hash(await readFile(path.join(path.dirname(sourceArchive), 'build-bundled-git.mjs'))) !== recipeSha256 || await readFile(path.join(path.dirname(sourceArchive), 'config.mak'), 'utf8') !== configuration || JSON.stringify(await correspondingInventory()) !== JSON.stringify(manifest.correspondingSourceFiles)) return false;
    const version = run(path.join(runtime, 'bin/git'), ['--version'], { env: { PATH: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    return version === `git version ${VERSION}`;
  } catch { return false; }
}
if (!process.argv.includes('--force') && await validExisting()) {
  console.log(JSON.stringify({ version: VERSION, architecture: process.arch, cached: true, runtime: '.local/bundled-git/runtime', manifest: '.local/bundled-git/manifest.json' }));
  process.exit(0);
}
if (process.argv.includes('--verify-only')) fail('BUNDLED_GIT_PROVENANCE_INVALID');
await mkdir(path.dirname(sourceArchive), { recursive: true });
try { if (hash(await readFile(lgplText)) !== LGPL_SHA256) fail('BUNDLED_GIT_LICENSE_HASH_MISMATCH'); }
catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  const response = await fetch(LGPL_URL, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) fail('BUNDLED_GIT_LICENSE_DOWNLOAD_FAILED');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000 || hash(bytes) !== LGPL_SHA256) fail('BUNDLED_GIT_LICENSE_HASH_MISMATCH');
  await writeFile(lgplText, bytes);
}
try {
  const present = await readFile(sourceArchive); if (hash(present) !== SOURCE_SHA256) fail('BUNDLED_GIT_SOURCE_HASH_MISMATCH');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  // This exact official source archive is also distributed with the runtime.
  const response = await fetch(SOURCE_URL, { redirect: 'error', signal: AbortSignal.timeout(120_000), headers: { 'User-Agent': 'GitWorld build (https://github.com/samar1tan/GitWorld)' } });
  if (!response.ok || Number(response.headers.get('content-length')) > 32 * 1024 * 1024) fail('BUNDLED_GIT_SOURCE_DOWNLOAD_FAILED');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 32 * 1024 * 1024) { await reader.cancel(); fail('BUNDLED_GIT_SOURCE_TOO_LARGE'); } chunks.push(next.value); }
  const bytes = Buffer.concat(chunks); if (hash(bytes) !== SOURCE_SHA256) fail('BUNDLED_GIT_SOURCE_HASH_MISMATCH');
  await writeFile(`${sourceArchive}.tmp`, bytes, { mode: 0o600 }); await rename(`${sourceArchive}.tmp`, sourceArchive);
}
const build = path.join(output, 'build');
await rm(build, { recursive: true, force: true }); await mkdir(build, { recursive: true });
const entries = run('/usr/bin/tar', ['-tJf', sourceArchive]).split('\n');
if (entries.some(entry => !entry.startsWith(`git-${VERSION}/`) || entry.startsWith('/') || entry.split('/').includes('..'))) fail('BUNDLED_GIT_SOURCE_PATH_INVALID');
run('/usr/bin/tar', ['-xJf', sourceArchive, '-C', build]);
const source = path.join(build, `git-${VERSION}`), logs = [];
await writeFile(path.join(source, 'config.mak'), configuration);
try { run('/usr/bin/make', ['-j4', 'git'], { cwd: source, log: logs }); }
finally { await writeFile(path.join(output, 'build.log'), logs.join('\n')); }
await rm(runtime, { recursive: true, force: true });
await mkdir(path.join(runtime, 'bin'), { recursive: true }); await mkdir(path.join(runtime, 'libexec/git-core'), { recursive: true });
await cp(path.join(source, 'git'), path.join(runtime, 'bin/git')); await cp(path.join(source, 'git'), path.join(runtime, 'libexec/git-core/git'));
const licenses = path.join(runtime, 'share/licenses/git'); await mkdir(licenses, { recursive: true });
for (const [input, name] of [['COPYING', 'COPYING'], ['sha1dc/LICENSE.txt', 'sha1dc-LICENSE.txt'], ['reftable/LICENSE', 'reftable-LICENSE']]) await cp(path.join(source, input), path.join(licenses, name));
await cp(lgplText, path.join(licenses, 'LGPL-2.1-or-later.txt'));
const noticeBlocks = [];
async function sourceNotices(relative = '') {
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await sourceNotices(name);
    else if (entry.isFile() && /\.[ch]$/.test(name)) {
      const handle = await open(path.join(source, name), 'r'), bytes = Buffer.alloc(8192);
      let text; try { const read = await handle.read(bytes, 0, bytes.length, 0); text = bytes.subarray(0, read.bytesRead).toString('utf8'); } finally { await handle.close(); }
      const blocks = [...text.matchAll(/\/\*[\s\S]*?\*\//g)].map(value => value[0]).filter(value => /copyright|licen[sc]e|public domain|GNU C Library|by Mike Haertel/i.test(value));
      if (blocks.length) noticeBlocks.push(`\n--- ${name} ---\n${blocks.join('\n')}`);
    }
  }
}
await sourceNotices();
await writeFile(path.join(licenses, 'SOURCE-NOTICES.txt'), 'Notice blocks preserved from the pinned upstream source distribution. This includes source files not selected by this runtime recipe; the complete corresponding source remains authoritative.\n' + noticeBlocks.sort().join('\n'));
await writeFile(path.join(licenses, 'CORRESPONDING-SOURCE.txt'), `Git ${VERSION}\nSource: ${SOURCE_URL}\nSHA-256: ${SOURCE_SHA256}\nThe exact source archive, unmodified source notices, configuration and build recipe accompany this distribution in the installer resources directory git-corresponding-source/ (development output: corresponding-source/). Git is separately licensed; the GitWorld Apache-2.0 license does not relicense Git.\n`);
await cp(recipe, path.join(output, 'corresponding-source/build-bundled-git.mjs'));
await writeFile(path.join(output, 'corresponding-source/config.mak'), configuration);
const dependencies = run('/usr/bin/otool', ['-L', path.join(runtime, 'bin/git')]).split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean);
if (dependencies.some(name => !name.startsWith('/usr/lib/') && !name.startsWith('/System/Library/'))) fail('BUNDLED_GIT_EXTERNAL_DEPENDENCY');
const version = run(path.join(runtime, 'bin/git'), ['--version'], { env: { PATH: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
if (version !== `git version ${VERSION}`) fail('BUNDLED_GIT_RUNTIME_VERSION_MISMATCH');
const compiledObjects = [...logs.join('\n').matchAll(/^\s+CC (.+\.o)$/gm)].map(value => value[1]).sort();
const manifest = { schemaVersion: 1, version: VERSION, architecture: process.arch, platform: process.platform, deploymentTarget: '14.0', source: { url: SOURCE_URL, sha256: SOURCE_SHA256, archive: `corresponding-source/git-${VERSION}.tar.xz`, patches: [] }, recipe: { path: 'corresponding-source/build-bundled-git.mjs', sha256: recipeSha256 }, configuration, compiler: run('/usr/bin/clang', ['--version']), dependencies, compiledObjects, licenseAssets: [{ component: 'Git', license: 'GPL-2.0-only', file: 'share/licenses/git/COPYING' }, { component: 'SHA1DC', license: 'MIT', file: 'share/licenses/git/sha1dc-LICENSE.txt' }, { component: 'reftable', license: 'BSD-3-Clause', file: 'share/licenses/git/reftable-LICENSE' }, { component: 'xdiff and applicable GNU compatibility code', license: 'LGPL-2.1-or-later', file: 'share/licenses/git/LGPL-2.1-or-later.txt', textUrl: LGPL_URL, textSha256: LGPL_SHA256 }, { component: 'upstream source notice blocks', file: 'share/licenses/git/SOURCE-NOTICES.txt' }], networkTransport: 'disabled', runtimeDependencies: 'macOS system libraries; no installed Git or language runtime', bitForBitReproducible: 'not-tested', files: await inventory(runtime), correspondingSourceFiles: await correspondingInventory() };
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ version: VERSION, architecture: process.arch, cached: false, runtime: '.local/bundled-git/runtime', manifest: '.local/bundled-git/manifest.json' }));
