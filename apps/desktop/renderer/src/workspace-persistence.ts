import type { WorkspaceState } from '@gitworld/contracts';

export type PersistenceStatus = 'idle' | 'saving' | 'failed';
type Save = (input: { workspace: WorkspaceState; expectedVersion: number | null }) => Promise<WorkspaceState>;

/** One CAS writer. Session changes must pause and drain before binding a DB version. */
export function createWorkspacePersistence(write: Save, changed: (status: PersistenceStatus) => void = () => {}) {
  let version: number | null = null;
  let accepting = false;
  let pending: WorkspaceState | null = null;
  let running: Promise<void> | null = null;
  let status: PersistenceStatus = 'idle';
  const notify = (next: PersistenceStatus) => { status = next; try { changed(next); } catch { /* Observers cannot change write ordering. */ } };

  function flush(): Promise<void> {
    if (running) return running;
    if (!pending) return Promise.resolve();
    notify('saving');
    const drain = async () => {
      while (pending) {
        const snapshot = pending; pending = null;
        try {
          const saved = await write({ workspace: { ...snapshot, version: version ?? 0 }, expectedVersion: version });
          version = saved.version;
        } catch (error) {
          // Keep the newest unsaved state available for an explicit retry.
          pending ??= snapshot;
          notify('failed');
          throw error;
        }
      }
      notify('idle');
    };
    running = drain().finally(() => { running = null; });
    return running;
  }
  return {
    get version() { return version; },
    get status() { return status; },
    bind(savedVersion: number | null) {
      if (running || pending) throw new Error('WORKSPACE_WRITES_PENDING');
      version = savedVersion; accepting = true; notify('idle');
    },
    save(snapshot: WorkspaceState): Promise<void> {
      if (!accepting) return Promise.reject(new Error('WORKSPACE_SUSPENDED'));
      pending = structuredClone(snapshot);
      return flush();
    },
    pause(): Promise<void> { accepting = false; return flush(); },
    resume() { accepting = true; },
    flush,
  };
}

/** A load may commit only while its token is current, including after any save. */
export function createWorkspaceTransitions() {
  let sequence = 0;
  return { begin: () => ++sequence, current: (token: number) => token === sequence };
}
