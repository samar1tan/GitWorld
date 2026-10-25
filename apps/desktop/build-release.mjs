import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { captureAcceptedSource, dependencyTreeHash, CLEAN_INSTALL_FILE, SOURCE_REPOSITORY } from './release-provenance.mjs';

const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runCommand = async (command, args, options) => {
  try { return await execute(command, args, { ...options, shell: false, timeout: 20 * 60_000, maxBuffer: 32 * 1024 * 1024 }); }
  catch { throw new Error('ISOLATED_RELEASE_COMMAND_FAILED'); }
};

export async function buildIsolatedRelease(root, { tag, run = runCommand, inspectSource = captureAcceptedSource, hashDependencies = dependencyTreeHash } = {}) {
  const accepted = await inspectSource(root, { tag });
  await mkdir(path.join(root, '.local'), { recursive: true });
  const job = await mkdtemp(path.join(root, '.local/release-build-'));
  const checkout = path.join(job, 'checkout');
  const env = { ...process.env, CI: '1', GITWORLD_RELEASE_TAG: tag };
  for (const key of Object.keys(env)) if (/^(?:GIT_|NPM_CONFIG_|npm_config_)/.test(key) || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
  // Private user configuration must not redirect dependency resolution or Git behavior.
  const npmUserConfig = path.join(job, 'npm-user.config'), npmGlobalConfig = path.join(job, 'npm-global.config');
  await writeFile(npmUserConfig, ''); await writeFile(npmGlobalConfig, '');
  env.NPM_CONFIG_USERCONFIG = npmUserConfig; env.NPM_CONFIG_GLOBALCONFIG = npmGlobalConfig;
  env.GIT_CONFIG_NOSYSTEM = '1'; env.GIT_CONFIG_GLOBAL = '/dev/null';
  const invoke = (command, args, cwd = checkout) => run(command, args, { cwd, env, shell: false });
  await invoke('git', ['clone', '--no-checkout', '--origin', 'origin', `${SOURCE_REPOSITORY}.git`, checkout], job);
  await invoke('git', ['checkout', '--detach', accepted.sourceCommit]);
  const cloned = await inspectSource(checkout, { tag });
  if (cloned.sourceCommit !== accepted.sourceCommit || cloned.lockfileSha256 !== accepted.lockfileSha256) throw new Error('ISOLATED_RELEASE_SOURCE_MISMATCH');
  const startedAt = new Date().toISOString();
  const npmVersion = (await invoke('npm', ['--version'])).stdout.trim();
  const installation = await invoke('npm', ['ci', '--no-audit', '--no-fund']);
  const completedAt = new Date().toISOString();
  const log = `${installation.stdout || ''}\n${installation.stderr || ''}`;
  await writeFile(path.join(job, 'npm-ci.log'), log);
  await mkdir(path.join(checkout, '.local'), { recursive: true });
  await writeFile(path.join(checkout, CLEAN_INSTALL_FILE), JSON.stringify({ schemaVersion: 1, method: 'npm-ci', isolation: 'fresh-checkout', exitCode: 0, checkoutRoot: await realpath(checkout), sourceCommit: cloned.sourceCommit, lockfileSha256: cloned.lockfileSha256, npmVersion, startedAt, completedAt, logSha256: hash(log), dependencyTreeSha256: await hashDependencies(checkout) }, null, 2));
  await invoke(process.execPath, ['apps/desktop/build.mjs']);
  await invoke(process.execPath, ['apps/desktop/package.mjs']);
  return { output: path.join(checkout, '.local/releases'), checkout };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    if (process.platform !== 'darwin') throw new Error('RELEASE_BUILD_REQUIRES_MACOS');
    const tagIndex = process.argv.indexOf('--tag');
    const result = await buildIsolatedRelease(root, { tag: tagIndex === -1 ? undefined : process.argv[tagIndex + 1] });
    console.log(`Local release candidate: ${result.output}`);
    console.log('No upload or passing acceptance receipt was created. Install and review this exact DMG before release.');
  } catch (error) {
    console.error(error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'ISOLATED_RELEASE_FAILED');
    process.exitCode = 1;
  }
}
