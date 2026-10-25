import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, validateJsonBoundary } from '../../domain/src/index.ts';
import { CLIENT_STATE_KEYS, type ClientStateEntry, type ClientStateKey } from '../../contracts/src/client-state-types.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';

type Document = { schemaVersion: 1; entries: Partial<Record<ClientStateKey, ClientStateEntry>> };
const MAX_VALUE = 2_100_000;
const validKey = (key: unknown): key is ClientStateKey => CLIENT_STATE_KEYS.includes(key as ClientStateKey);
const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The service serializes saves. Atomic replacement keeps backup/readers on complete documents. */
export function createClientStateStore(dataDirectory: string) {
  const directory = path.resolve(dataDirectory), destination = path.join(directory, 'client-state.json');
  async function read(): Promise<Document> {
    try {
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > 16_000_000) throw new Error('IO_ERROR');
      const value: unknown = JSON.parse(await readFile(destination, 'utf8'));
      if (validateJsonBoundary(value).length || !record(value) || value.schemaVersion !== 1 || !record(value.entries) || Object.keys(value).some(key => !['schemaVersion', 'entries'].includes(key))) throw new Error('IO_ERROR');
      for (const [key, entry] of Object.entries(value.entries)) if (!validKey(key) || !record(entry) || entry.key !== key || !Number.isSafeInteger(entry.version) || Number(entry.version) < 1 || !('value' in entry) || JSON.stringify(entry.value).length > MAX_VALUE || Object.keys(entry).some(name => !['key', 'version', 'value'].includes(name))) throw new Error('IO_ERROR');
      return value as Document;
    } catch (error) { if (missing(error)) return { schemaVersion: 1, entries: {} }; throw error; }
  }
  return {
    async load(key: ClientStateKey): Promise<ClientStateEntry | null> {
      if (!validKey(key)) throw new Error('INVALID_REQUEST');
      return structuredClone((await read()).entries[key] ?? null);
    },
    async save(input: { key: ClientStateKey; expectedVersion: number | null; value: EditorialJson }): Promise<ClientStateEntry> {
      if (!validKey(input.key) || !(input.expectedVersion === null || Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 1) || validateJsonBoundary(input.value).length || JSON.stringify(input.value).length > MAX_VALUE) throw new Error('INVALID_REQUEST');
      const document = await read(), previous = document.entries[input.key];
      if ((previous?.version ?? null) !== input.expectedVersion) throw new Error('CONFLICT');
      if (previous && canonicalJson(previous.value) === canonicalJson(input.value)) return structuredClone(previous);
      const saved: ClientStateEntry = { key: input.key, version: (previous?.version ?? 0) + 1, value: structuredClone(input.value) };
      document.entries[input.key] = saved;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(canonicalJson(document)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, destination);
      } finally { await rm(temporary, { force: true }); }
      return structuredClone(saved);
    },
  };
}
