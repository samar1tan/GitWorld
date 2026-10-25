import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { desktopTarget, packagedPaths } from './packaging-platform.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const packaged = process.argv.includes('--packaged');
if (process.platform === 'linux' && process.getuid?.() === 0) throw new Error('LINUX_SMOKE_REQUIRES_NONROOT_SANDBOX');
const receipt = packaged ? JSON.parse(await readFile(path.join(root, '.local/releases/local-build-receipt.json'), 'utf8')) : null;
const target = desktopTarget(process.platform, process.arch, receipt?.internal === true);
const electron = packaged ? null : (await import('electron')).default;
const paths = packagedPaths(path.join(root, '.local/releases'), target, receipt?.internal === true);
const executable = packaged ? paths.executable : electron;
if (packaged && (receipt.platform !== process.platform || receipt.arch !== process.arch || receipt.asarSha256 !== createHash('sha256').update(await readFile(paths.asar)).digest('hex'))) throw new Error('PACKAGED_RECEIPT_MISMATCH');
if (!executable || !existsSync(executable)) throw new Error('No local packaged application found.');
const { runSmokeProcess, evaluateSmokeProcess, SMOKE_DEADLINE_MS } = await import('./smoke-process.mjs');
const sandbox = await mkdtemp(path.join(tmpdir(), 'gitworld-desktop-smoke-'));
const env = { ...process.env, GITWORLD_SMOKE_USER_DATA: sandbox };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
try {
  const observed = await runSmokeProcess(executable, [...(packaged ? [] : [directory]), '--gitworld-smoke'], { env, deadlineMs: SMOKE_DEADLINE_MS });
  const decision = evaluateSmokeProcess(observed, packaged), result = decision.record;
  if (!decision.ok) {
    process.exitCode = 1;
    console.error(result.timedOut ? `Desktop smoke timed out (deadline ${result.deadlineMs} ms; elapsed ${Math.round(result.durationMs)} ms).` : `Desktop smoke failed (exit ${result.exitCode}). ${result.startupPhase ? `Application startup failed during ${result.startupPhase}.` : 'No valid successful runtime receipt was produced.'}`);
  }
  console.log(JSON.stringify(result, null, 2));
  await mkdir(path.join(root, '.local'), { recursive: true });
  // A failed attempt replaces stale engineering output with an explicit failure, never child ok:true.
  await writeFile(path.join(root, '.local', packaged ? 'desktop-packaged-smoke.json' : 'desktop-runtime-smoke.json'), JSON.stringify(result, null, 2));
} finally { await rm(sandbox, { recursive: true, force: true }); }
