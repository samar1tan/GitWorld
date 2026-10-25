import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { defaultSettingsValues, validSettingsUpdate, validSettingsValues, validSettingsVersion, type SettingsLibraryInfo, type SettingsSnapshot, type SettingsUpdate, type SettingsValues } from '../../contracts/src/settings-types.ts';

export class SettingsFailure extends Error {
  readonly code: 'SETTINGS_INVALID' | 'INVALID_REQUEST' | 'CONFLICT' | 'IO_ERROR';
  constructor(code: SettingsFailure['code']) { super(code); this.code = code; }
}
const missing = (value: unknown) => !!value && typeof value === 'object' && 'code' in value && value.code === 'ENOENT';
const queues = new Map<string, Promise<unknown>>();
type Options = { legacy?: () => Promise<{ locale?: unknown; tipsEnabled?: unknown }>; /** Trusted failure fixture, never an IPC option. */ beforeInstall?: () => void | Promise<void> };

/** One local-library profile, outside authored history. The service owns all writes. */
export function createSettingsStore(dataDirectory: string, options: Options = {}) {
  if (!path.isAbsolute(dataDirectory)) throw new SettingsFailure('INVALID_REQUEST');
  const directory = path.resolve(dataDirectory), destination = path.join(directory, 'library-settings.json');
  async function load(): Promise<SettingsSnapshot> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 65536) throw new SettingsFailure('SETTINGS_INVALID');
      const document = JSON.parse(await handle.readFile('utf8'));
      if (!document || typeof document !== 'object' || Array.isArray(document) || Object.keys(document).length !== 3 || document.schemaVersion !== 1 || !validSettingsVersion(document.version) || document.version < 1 || !validSettingsValues(document.values)) throw new SettingsFailure('SETTINGS_INVALID');
      return document;
    } catch (error) {
      if (!missing(error)) throw error instanceof SettingsFailure ? error : new SettingsFailure('SETTINGS_INVALID');
      const values = defaultSettingsValues(), legacy = await options.legacy?.();
      if (legacy?.locale === 'en' || legacy?.locale === 'zh-CN') values.general.locale = legacy.locale;
      if (typeof legacy?.tipsEnabled === 'boolean') values.learning.tipsEnabled = legacy.tipsEnabled;
      return { schemaVersion: 1, version: 0, values };
    } finally { await handle?.close(); }
  }
  async function update(input: SettingsUpdate): Promise<SettingsSnapshot> {
    if (!validSettingsUpdate(input)) throw new SettingsFailure('INVALID_REQUEST');
    const previous = queues.get(destination) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const current = await load();
      if (current.version !== input.expectedVersion) throw new SettingsFailure('CONFLICT');
      if (canonicalJson(current.values[input.section]) === canonicalJson(input.value)) return current;
      const values = { ...current.values, [input.section]: structuredClone(input.value) } as SettingsValues;
      const saved: SettingsSnapshot = { schemaVersion: 1, version: current.version + 1, values };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new SettingsFailure('IO_ERROR');
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(canonicalJson(saved) + '\n'); await file.sync(); } finally { await file.close(); }
        await options.beforeInstall?.();
        await rename(temporary, destination);
        const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
        return structuredClone(saved);
      } catch (error) { throw error instanceof SettingsFailure ? error : new SettingsFailure('IO_ERROR'); }
      finally { await rm(temporary, { force: true }); }
    });
    const settled = operation.catch(() => {}); queues.set(destination, settled);
    void settled.finally(() => { if (queues.get(destination) === settled) queues.delete(destination); });
    return operation;
  }
  async function library(): Promise<SettingsLibraryInfo> {
    let bytes = 0, files = 0;
    async function visit(current: string) {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw new SettingsFailure('IO_ERROR');
      if (info.isFile()) { bytes += info.size; files++; if (!Number.isSafeInteger(bytes)) throw new SettingsFailure('IO_ERROR'); }
      else for (const name of await readdir(current)) await visit(path.join(current, name));
    }
    try { await visit(directory); return { location: directory, bytes, files, measuredAt: new Date().toISOString() }; }
    catch (error) { throw error instanceof SettingsFailure ? error : new SettingsFailure('IO_ERROR'); }
  }
  return { load, update, library };
}
