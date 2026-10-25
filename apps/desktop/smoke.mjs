import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import electron from 'electron';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const packaged = process.argv.includes('--packaged');
const receipt = packaged ? JSON.parse(await readFile(path.join(root, '.local/releases/local-build-receipt.json'), 'utf8')) : null;
const appName = receipt?.internal ? 'GitWorld Internal' : 'GitWorld';
const bundle = path.join(root, '.local/releases', process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${appName}.app`);
const executable = packaged ? path.join(bundle, 'Contents/MacOS', appName) : electron;
if (packaged && receipt.asarSha256 !== createHash('sha256').update(await readFile(path.join(bundle, 'Contents/Resources/app.asar'))).digest('hex')) throw new Error('PACKAGED_RECEIPT_MISMATCH');
if (!executable || !existsSync(executable)) throw new Error('No local packaged application found.');
const sandbox = await mkdtemp(path.join(tmpdir(), 'gitworld-desktop-smoke-'));
const env = { ...process.env, GITWORLD_SMOKE_USER_DATA: sandbox };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(executable, [...(packaged ? [] : [directory]), '--gitworld-smoke'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { errors += data; });
const timer = setTimeout(() => child.kill('SIGTERM'), 45_000);
const code = await new Promise(resolve => { child.on('error', () => resolve(-1)); child.on('close', resolve); });
clearTimeout(timer);
try {
  const line = output.split('\n').find(line => line.startsWith('GITWORLD_SMOKE_RESULT '));
  if (!line) { const phase = errors.match(/GITWORLD_SMOKE_ERROR ([a-z-]+)/)?.[1]; console.error(`Desktop smoke failed (exit ${code}). ${phase ? `Application startup failed during ${phase}.` : 'No valid runtime receipt was produced.'}`); process.exitCode = 1; }
  else {
    const result = JSON.parse(line.slice('GITWORLD_SMOKE_RESULT '.length));
    if (code !== 0 || !result.ok || result.packaged !== packaged) process.exitCode = 1;
    console.log(JSON.stringify(result, null, 2));
    await mkdir(path.join(root, '.local'), { recursive: true });
    await writeFile(path.join(root, '.local', packaged ? 'desktop-packaged-smoke.json' : 'desktop-runtime-smoke.json'), JSON.stringify(result, null, 2));
  }
} finally { await rm(sandbox, { recursive: true, force: true }); }
