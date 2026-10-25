import { randomUUID } from 'node:crypto';
export type FilePurpose = 'import' | 'export' | 'backup' | 'restore';
export type FileGrant = { fileToken: string; path: string; purpose: FilePurpose; expiresAt: number };
export function isFilePurpose(value: unknown): value is FilePurpose { return ['import', 'export', 'backup', 'restore'].includes(value as string); }
export class FileTokenRegistry {
  #grants = new Map<string, FileGrant>();
  issue(filePath: string, purpose: FilePurpose, now = Date.now()): FileGrant {
    this.expire(now);
    const grant = { fileToken: randomUUID(), path: filePath, purpose, expiresAt: now + 30 * 60 * 1000 };
    this.#grants.set(grant.fileToken, grant);
    return { ...grant };
  }
  receive(grant: FileGrant): void { this.#grants.set(grant.fileToken, { ...grant }); }
  resolve(token: string, purpose: FilePurpose, now = Date.now()): string | undefined {
    this.expire(now);
    const grant = this.#grants.get(token);
    return grant?.purpose === purpose ? grant.path : undefined;
  }
  expire(now = Date.now()): void { for (const [token, grant] of this.#grants) if (grant.expiresAt <= now) this.#grants.delete(token); }
  clear(): void { this.#grants.clear(); }
}
