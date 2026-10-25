import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const configs = ['apps', 'packages'].flatMap((root) => existsSync(root) ? readdirSync(root).map((entry) => path.join(root, entry, 'tsconfig.json')).filter(existsSync) : []);
if (existsSync('apps/desktop/renderer/tsconfig.json')) configs.push('apps/desktop/renderer/tsconfig.json');
for (const config of configs) {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', config], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
