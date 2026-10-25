import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.env.GITWORLD_REQUIRE_BUNDLED_GIT_TESTS === '1' && !existsSync('.local/bundled-git/runtime/bin/git')) throw new Error('Bundled Git must be built before the required desktop integration tests.');
function collect(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) return ['node_modules', 'dist', '.local'].includes(item.name) ? [] : collect(full);
    return /\.test\.(?:ts|mjs)$/.test(item.name) ? [full] : [];
  });
}
const tests = ['scripts', 'packages', 'apps/desktop/src', 'apps/desktop/renderer/src', 'site'].flatMap(collect);
if (!tests.length) throw new Error('No workspace tests found.');
// Concurrent repository fixtures compete for disk writes; keep their worker count bounded.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=60000', ...tests], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
