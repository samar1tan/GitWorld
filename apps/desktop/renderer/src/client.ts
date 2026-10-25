import type { DesktopBridge, ServiceMethod, ServiceMethods, ServiceResponse, ServiceError } from '@gitworld/contracts';

declare global { interface Window { gitworld?: DesktopBridge } }
export class ServiceFailure extends Error {
  readonly detail: ServiceError;
  constructor(detail: ServiceError) { super(detail.code); this.detail = detail; }
}
export function bridge(): DesktopBridge {
  if (!window.gitworld) throw new ServiceFailure({ code: 'SERVICE_UNAVAILABLE' });
  return window.gitworld;
}
export async function request<M extends ServiceMethod>(method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const response = await bridge().request({ protocolVersion: 1, requestId: crypto.randomUUID(), method, params } as Parameters<DesktopBridge['request']>[0]) as ServiceResponse<M>;
  if (!response.ok) throw new ServiceFailure(response.error);
  return response.result;
}
export const operationId = () => crypto.randomUUID();
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
