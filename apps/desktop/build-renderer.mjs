import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
// This platform-neutral check does not build or claim a desktop installer.
await build({ root: path.join(directory, 'renderer'), base: './', build: { outDir: path.resolve(directory, '../../.local/renderer-check'), emptyOutDir: true }, configFile: false, logLevel: 'warn' });
