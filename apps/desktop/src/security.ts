import path from 'node:path';

export const APPLICATION_URL = 'gitworld://app/index.html';
export const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
export function isApplicationUrl(input: string): boolean {
  try { const url = new URL(input); return url.protocol === 'gitworld:' && url.host === 'app' && !url.username && !url.password && ['/', '/index.html'].includes(url.pathname); }
  catch { return false; }
}
export function resolveAsset(root: string, input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'gitworld:' || url.host !== 'app' || url.username || url.password) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return null;
    const result = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
    return result.startsWith(`${path.resolve(root)}${path.sep}`) ? result : null;
  } catch { return null; }
}
export function allowedExternalUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 4096) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port && url.port !== '443') return null;
    return url.href;
  } catch { return null; }
}
export function safeRequestId(input: unknown): string {
  if (input && typeof input === 'object' && 'requestId' in input && typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) return input.requestId;
  return 'invalid-request';
}
