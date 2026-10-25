import { randomUUID } from 'node:crypto';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { OperationProgress, ServiceRequest, ServiceResponse } from '@gitworld/contracts';
import type { FileGrant } from './file-tokens.ts';
export type RuntimeProbe = { node: string; electron: string; sqlite: string; roundTrip: boolean; integrity: boolean; serviceImplemented: boolean };
export class UtilityBridge {
  readonly ready: Promise<RuntimeProbe>;
  #child: UtilityProcess;
  #pending = new Map<string, { resolve: (response: ServiceResponse) => void; timer: NodeJS.Timeout; requestId: string }>();
  #stopped = false;
  #closing: Promise<void> | null = null;
  constructor(modulePath: string, dataDirectory: string, options: { smoke?: boolean; gitExecutable?: string; gitExecPath?: string; onProgress: (progress: OperationProgress) => void }) {
    this.#child = utilityProcess.fork(modulePath, [], { serviceName: 'GitWorld local data service', stdio: 'pipe', env: { PATH: process.env.PATH, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR } });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#child.kill(); reject(new Error('SERVICE_START_TIMEOUT')); }, 180_000);
      this.#child.on('message', (message) => {
        if (message?.type === 'ready') this.#child.postMessage({ type: 'initialize', dataDirectory, smoke: options.smoke, gitExecutable: options.gitExecutable, gitExecPath: options.gitExecPath });
        if (message?.type === 'initialized') { clearTimeout(timer); resolve(message.runtime); }
        if (message?.type === 'startup-error') { clearTimeout(timer); reject(new Error('SERVICE_UNAVAILABLE')); }
        if (message?.type === 'progress') options.onProgress(message.progress);
        if (message?.type === 'response' && typeof message.id === 'string') {
          const pending = this.#pending.get(message.id);
          if (pending) { clearTimeout(pending.timer); this.#pending.delete(message.id); pending.resolve(message.response); }
        }
      });
      this.#child.on('exit', () => { clearTimeout(timer); this.#stopped = true; reject(new Error('SERVICE_EXITED')); this.failPending(); });
    });
    // Child logs may contain paths or source content; do not forward them to renderer or release logs.
    this.#child.stdout?.resume();
    this.#child.stderr?.resume();
  }
  async request(request: ServiceRequest): Promise<ServiceResponse> {
    try { await this.ready; } catch { return this.failure(request.requestId); }
    if (this.#stopped || this.#closing || this.#pending.size >= 64) return this.failure(request.requestId);
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        if (['source.acquire', 'source.collect', 'source.search', 'collection.acquire', 'wikipedia.collect'].includes(request.method) && 'operationId' in request.params && !this.#stopped) this.#child.postMessage({ type: 'request', id: randomUUID(), request: { protocolVersion: 1, requestId: `cancel-${randomUUID()}`, method: 'operation.cancel', params: { operationId: request.params.operationId } } });
        resolve(this.failure(request.requestId));
      }, ['source.acquire', 'source.collect', 'collection.acquire', 'collection.rebuildIssues', 'knowledge.adoptJob', 'knowledge.fileAdopt', 'knowledge.resumeImport', 'collection.adopt', 'wikipedia.collect', 'wikipedia.preview', 'wikipedia.adopt', 'context.save', 'context.membershipPlan', 'context.applyMembership', 'context.resume', 'repository.stage', 'repository.unstage', 'command.execute', 'backup.create', 'backup.restore'].includes(request.method) ? 600_000 : 120_000);
      this.#pending.set(id, { resolve, timer, requestId: request.requestId });
      this.#child.postMessage({ type: 'request', id, request });
    });
  }
  grant(grant: FileGrant): void { if (!this.#stopped) this.#child.postMessage({ type: 'grant-file', grant }); }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.failPending();
    if (this.#stopped) return Promise.resolve();
    this.#closing = new Promise((resolve) => {
      const timer = setTimeout(() => { this.#child.kill(); resolve(); }, 5000);
      this.#child.once('exit', () => { clearTimeout(timer); resolve(); });
      this.#child.postMessage({ type: 'shutdown' });
    });
    return this.#closing;
  }
  private failure(requestId: string): ServiceResponse { return { protocolVersion: 1, requestId, ok: false, error: { code: 'SERVICE_UNAVAILABLE' } }; }
  private failPending(): void { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.resolve(this.failure(pending.requestId)); } this.#pending.clear(); }
}
