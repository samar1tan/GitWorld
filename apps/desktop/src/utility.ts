import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { validateServiceRequest, type LocalService, type ServiceRequest } from '@gitworld/contracts';
import { FileTokenRegistry, type FileGrant } from './file-tokens.ts';
import { createService, SERVICE_IMPLEMENTED } from './service-adapter.ts';

type Port = { on(event: 'message', handler: (event: { data: unknown }) => void): void; postMessage(value: unknown): void };
const port = (process as NodeJS.Process & { parentPort?: Port }).parentPort;
if (!port) throw new Error('The local service requires an Electron utility-process parent.');
const grants = new FileTokenRegistry();
let service: (LocalService & { close?: () => Promise<void> }) | null = null;
let initialized = false;
let stopping = false;
const activeRequests = new Set<Promise<unknown>>();
const probeDatabase = () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE runtime_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO runtime_probe(value) VALUES (\'sqlite-operational\');');
    const sqlite = database.prepare('SELECT sqlite_version() AS version').get()!;
    const row = database.prepare('SELECT value FROM runtime_probe WHERE id = 1').get()!;
    const integrity = database.prepare('PRAGMA integrity_check').get()!;
    return { node: process.versions.node, electron: process.versions.electron, sqlite: String(sqlite.version), roundTrip: row.value === 'sqlite-operational', integrity: Object.values(integrity)[0] === 'ok', serviceImplemented: SERVICE_IMPLEMENTED };
  } finally { database.close(); }
};
port.on('message', async ({ data }) => {
  if (!data || typeof data !== 'object' || !('type' in data)) return;
  const message = data as { type: string; id?: string; dataDirectory?: string; gitExecutable?: string; gitExecPath?: string; grant?: FileGrant; request?: ServiceRequest; smoke?: boolean };
  try {
    if (message.type === 'initialize' && !initialized && typeof message.dataDirectory === 'string') {
      initialized = true;
      const runtime = probeDatabase();
      service = await createService({ dataDirectory: message.dataDirectory, seedPackagePath: path.join(__dirname, 'data/seed/early-medieval.json'), seedKnowledgeBundle:{manifestPath:path.join(__dirname,'data/seed/east-asia/manifest.json'),expectedManifestHash:'2d191dd348484fbbad0f0e55f23427fbf76201a00c5f68e4a71863836146826e'}, ...(message.gitExecutable ? { gitExecutable: message.gitExecutable } : {}), ...(message.gitExecPath ? { gitExecPath: message.gitExecPath } : {}), resolveFileToken: (token, purpose) => grants.resolve(token, purpose), onProgress: (progress) => port.postMessage({ type: 'progress', progress }) });
      port.postMessage({ type: 'initialized', runtime });
    } else if (message.type === 'grant-file' && message.grant) {
      grants.receive(message.grant);
    } else if (message.type === 'request' && typeof message.id === 'string') {
      const checked = validateServiceRequest(message.request);
      const requestId = message.request?.requestId || 'invalid-request';
      const response = !checked.ok
        ? { protocolVersion: 1, requestId, ok: false, error: { code: 'INVALID_REQUEST' } }
        : service && !stopping ? await dispatch(checked.value) : { protocolVersion: 1, requestId, ok: false, error: { code: 'SERVICE_UNAVAILABLE' } };
      port.postMessage({ type: 'response', id: message.id, response });
    } else if (message.type === 'shutdown') {
      stopping = true;
      await service?.close?.();
      await Promise.allSettled(activeRequests);
      grants.clear();
      process.exit(0);
    }
  } catch {
    if (message.type === 'initialize') port.postMessage({ type: 'startup-error', code: 'SERVICE_UNAVAILABLE' });
    else if (message.id) port.postMessage({ type: 'response', id: message.id, response: { protocolVersion: 1, requestId: message.request?.requestId || 'invalid-request', ok: false, error: { code: 'IO_ERROR' } } });
  }
});
async function dispatch(request: ServiceRequest) {
  const operation = service!.dispatch(request);
  activeRequests.add(operation);
  try { return await operation; }
  finally { activeRequests.delete(operation); }
}
port.postMessage({ type: 'ready' });
