import { CLIENT_STATE_KEYS } from '../../../../packages/contracts/src/client-state-types.ts';
import type { ClientStateEntry, ClientStateKey, EditorialJson } from '../../../../packages/contracts/src/index.ts';

export type ClientStateApi = {
  load(key: ClientStateKey): Promise<ClientStateEntry | null>;
  save(input: { key: ClientStateKey; expectedVersion: number | null; value: EditorialJson }): Promise<ClientStateEntry>;
};
const keys = CLIENT_STATE_KEYS;
const storageKeys: Record<string, ClientStateKey> = { 'gitworld-knowledge-view-v1': 'knowledge-view', 'gitworld-research-input-v1': 'research-input', 'gitworld-commit-input-v1': 'commit-input', 'gitworld-commit-attempt-v1': 'commit-attempt', 'gitworld-source-query': 'source-query', 'gitworld-terminal-v1': 'terminal-input', 'gitworld-object-input-v1': 'object-input', 'gitworld-wikipedia-input-v1': 'wikipedia-input', 'gitworld-context-input-v1':'context-input' };
const textKeys = new Set<ClientStateKey>(['commit-input', 'source-query']);
export type ClientStateConflict = { key: ClientStateKey; local: EditorialJson; saved: ClientStateEntry | null };

/** Synchronous form recovery cache with coalesced, awaited persistence in the local library. */
export function createClientStateCache(api: ClientStateApi, onStatus: (failed: boolean) => void = () => {}) {
  const values = new Map<ClientStateKey, EditorialJson>(), versions = new Map<ClientStateKey, number | null>(), pending = new Map<ClientStateKey, EditorialJson>();
  let conflict: ClientStateConflict | null = null;
  let initialized = false, writing: Promise<void> | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  const get = (key: ClientStateKey) => structuredClone(values.get(key) ?? null);
  function set(key: ClientStateKey, value: EditorialJson) {
    if (!initialized) throw new Error('CLIENT_STATE_NOT_READY');
    const snapshot = structuredClone(value);
    if (JSON.stringify(values.get(key) ?? null) === JSON.stringify(snapshot)) return;
    values.set(key, snapshot); pending.set(key, snapshot);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush().catch(() => {}); }, 250);
  }
  function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (writing) return writing;
    if (!pending.size) return Promise.resolve();
    writing = (async () => {
      try {
        while (pending.size) {
          const [key, value] = pending.entries().next().value!; pending.delete(key);
          try {
            const saved = await api.save({ key, expectedVersion: versions.get(key) ?? null, value });
            versions.set(key, saved.version);
          } catch (cause) {
            if (!pending.has(key)) pending.set(key, value);
            const code = cause && typeof cause === 'object' && 'detail' in cause ? (cause.detail as { code?: unknown })?.code : cause instanceof Error ? cause.message : null;
            if (code === 'CONFLICT') conflict = { key, local: structuredClone(pending.get(key)!), saved: await api.load(key) };
            throw cause;
          }
        }
        onStatus(false);
      } catch (cause) { onStatus(true); throw cause; }
      finally { writing = null; }
    })();
    return writing;
  }
  return {
    async initialize(legacy?: Pick<Storage, 'getItem'>, replaceLocal = false) {
      if (!replaceLocal && (writing || pending.size)) await flush();
      else if (writing) await writing.catch(() => {});
      const loaded = await Promise.all(keys.map(key => api.load(key)));
      values.clear(); versions.clear(); pending.clear(); conflict = null;
      loaded.forEach((entry, index) => { const key = keys[index]; values.set(key, entry?.value ?? null); versions.set(key, entry?.version ?? null); });
      initialized = true;
      if (legacy) {
        for (const [oldKey, key] of Object.entries(storageKeys)) if (!loaded[keys.indexOf(key)]) {
          const old = legacy.getItem(oldKey); if (old) { try { set(key, textKeys.has(key) ? old : JSON.parse(old)); } catch { /* Invalid browser recovery input is not migrated. */ } }
        }
        if (!loaded[keys.indexOf('locale')]) { const locale = legacy.getItem('gitworld-locale'); if (locale === 'en' || locale === 'zh-CN') set('locale', locale); }
        await flush();
      }
    },
    get, set, flush,
    conflict: () => conflict ? structuredClone({ ...conflict, local: pending.get(conflict.key) ?? conflict.local }) : null,
    async resolveConflict(choice: 'local' | 'saved') {
      if (!conflict) return;
      const current = conflict, latest = await api.load(current.key);
      versions.set(current.key, latest?.version ?? null);
      if (choice === 'saved') { pending.delete(current.key); values.set(current.key, latest?.value ?? null); }
      conflict = null;
      await flush();
    },
    async save(key: ClientStateKey, value: EditorialJson) { set(key, value); await flush(); },
    storage: {
      getItem(key: string) { const mapped = storageKeys[key]; if (!mapped) return null; const value = get(mapped); return value === null ? null : textKeys.has(mapped) ? String(value) : JSON.stringify(value); },
      setItem(key: string, value: string) { const mapped = storageKeys[key]; if (!mapped) throw new Error('INVALID_CLIENT_STATE_KEY'); set(mapped, textKeys.has(mapped) ? value : JSON.parse(value)); },
      removeItem(key: string) { const mapped = storageKeys[key]; if (!mapped) throw new Error('INVALID_CLIENT_STATE_KEY'); set(mapped, null); },
    },
  };
}
