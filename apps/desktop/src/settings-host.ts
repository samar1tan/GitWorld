import { randomUUID } from 'node:crypto';
import type { ServiceRequest, ServiceResponse, SettingsSnapshot } from '@gitworld/contracts';

export type NativeZoomDirection = 'in' | 'out' | 'reset';
export type NativeZoomResult = { accepted: false; reason: 'closing' | 'maintenance' } | { accepted: true; ok: boolean };
type State = { closing: boolean; maintaining: boolean; epoch: number; version: number };
type Options = {
  request: (request: ServiceRequest) => Promise<ServiceResponse>;
  apply: (snapshot: SettingsSnapshot) => void;
  onStateChange?: (state: State) => void;
  onZoomError?: (error: unknown) => void;
};
type Transfer = { operationId: string; phase: 'draining' | 'running'; cancelled: boolean };
const failure = (request: ServiceRequest, code: 'SERVICE_UNAVAILABLE' | 'OPERATION_IN_PROGRESS' | 'CANCELLED'): ServiceResponse => ({ protocolVersion: 1, requestId: request.requestId, ok: false, error: { code } });

/** Orders local display preferences against library replacement and application shutdown. */
export function createSettingsHostCoordinator(options: Options) {
  let closing = false, maintaining = false, epoch = 0, version = -1;
  let nativeTail: Promise<void> = Promise.resolve(), transfer: Transfer | null = null;
  const pending = new Set<Promise<ServiceResponse>>();
  const state = (): State => ({ closing, maintaining, epoch, version });
  const notify = () => { try { options.onStateChange?.(state()); } catch { /* Menu observers cannot change admission or write ordering. */ } };
  function apply(snapshot: SettingsSnapshot, requestEpoch: number) {
    if (requestEpoch !== epoch || snapshot.version < version) return;
    options.apply(snapshot); version = snapshot.version;
  }
  async function readRaw(): Promise<SettingsSnapshot> {
    const response = await options.request({ protocolVersion: 1, requestId: `host-${randomUUID()}`, method: 'settings.get', params: {} });
    if (!response.ok) throw new Error(response.error.code);
    return response.result as SettingsSnapshot;
  }
  function zoom(direction: NativeZoomDirection): Promise<NativeZoomResult> {
    if (closing || maintaining) return Promise.resolve({ accepted: false, reason: closing ? 'closing' : 'maintenance' });
    // Once admitted, every action completes even if shutdown/transfer starts while it waits.
    const operation = nativeTail.then(async (): Promise<NativeZoomResult> => {
      try {
        const requestEpoch = epoch, current = await readRaw(), general = current.values.general;
        const zoomFactor = direction === 'reset' ? 1 : Math.max(0.75, Math.min(2, Math.round(general.zoomFactor * (direction === 'in' ? 1.1 : 1 / 1.1) * 100) / 100));
        const response = await options.request({ protocolVersion: 1, requestId: `host-${randomUUID()}`, method: 'settings.update', params: { section: 'general', expectedVersion: current.version, value: { ...general, zoomFactor } } });
        if (!response.ok) throw new Error(response.error.code);
        apply(response.result as SettingsSnapshot, requestEpoch);
        return { accepted: true, ok: true };
      } catch (error) {
        try { options.onZoomError?.(error); } catch { /* Notification failure cannot interrupt the queue. */ }
        return { accepted: true, ok: false };
      }
    });
    nativeTail = operation.then(() => {}); return operation;
  }
  async function run(request: ServiceRequest): Promise<ServiceResponse> {
    if (closing) return failure(request, 'SERVICE_UNAVAILABLE');
    if (request.method === 'operation.cancel' && transfer?.operationId === request.params.operationId && transfer.phase === 'draining') {
      transfer.cancelled = true;
      return { protocolVersion: 1, requestId: request.requestId, ok: true, result: { cancelled: true } };
    }
    const isTransfer = request.method === 'backup.create' || request.method === 'backup.restore';
    if (maintaining && (isTransfer || request.method === 'settings.get' || request.method === 'settings.update')) return failure(request, 'OPERATION_IN_PROGRESS');
    if (!isTransfer) {
      const requestEpoch = epoch, response = await options.request(request);
      if (requestEpoch !== epoch && (request.method === 'settings.get' || request.method === 'settings.update')) return failure(request, 'CANCELLED');
      if (response.ok && (request.method === 'settings.get' || request.method === 'settings.update')) apply(response.result as SettingsSnapshot, requestEpoch);
      return response;
    }
    const admitted: Transfer = { operationId: request.params.operationId, phase: 'draining', cancelled: false };
    transfer = admitted; maintaining = true; notify();
    try {
      await nativeTail;
      if (admitted.cancelled) return failure(request, 'CANCELLED');
      // Versions are local to a library; the next library can legitimately have a lower one.
      if (request.method === 'backup.restore') { epoch++; version = -1; }
      admitted.phase = 'running';
      return await options.request(request);
    } finally {
      try { apply(await readRaw(), epoch); } catch { /* Corrupt settings retain the explicit restore/recovery path. */ }
      transfer = null; maintaining = false; notify();
    }
  }
  function dispatch(request: ServiceRequest): Promise<ServiceResponse> {
    const operation = run(request);
    if (request.method === 'settings.get' || request.method === 'settings.update' || request.method === 'backup.create' || request.method === 'backup.restore') {
      pending.add(operation); void operation.then(() => pending.delete(operation), () => pending.delete(operation));
    }
    return operation;
  }
  return {
    dispatch, zoom, state,
    async read(): Promise<SettingsSnapshot> {
      const response = await dispatch({ protocolVersion: 1, requestId: `host-${randomUUID()}`, method: 'settings.get', params: {} });
      if (!response.ok) throw new Error(response.error.code);
      return response.result as SettingsSnapshot;
    },
    async idle(): Promise<void> { await nativeTail; await Promise.allSettled([...pending]); },
    async close(): Promise<void> { closing = true; notify(); await nativeTail; await Promise.allSettled([...pending]); },
  };
}
