export type EditorialJson = null | boolean | number | string | EditorialJson[] | { [key: string]: EditorialJson };
/** Covers a 10,000-record batch with source, object and baseline files, while remaining bounded. */
export const EDITORIAL_MAX_PATHS = 40_000;
export type EditorialReadSource = 'working' | 'staged' | string;
export type EditorialIdentity = { name: string; email: string };
export const DEFAULT_EDITORIAL_IDENTITY: Readonly<EditorialIdentity> = Object.freeze({ name: 'Local researcher', email: 'local@gitworld.invalid' });
export function validEditorialIdentity(value: unknown): value is EditorialIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Partial<EditorialIdentity>;
  return Object.keys(value).every(key => key === 'name' || key === 'email') && typeof identity.name === 'string' && identity.name.trim().length > 0 && identity.name === identity.name.trim() && identity.name.length <= 200 && !/[\p{Cc}\p{Zl}\p{Zp}<>]/u.test(identity.name) && typeof identity.email === 'string' && identity.email.length <= 254 && !/[\p{Cc}]/u.test(identity.email) && /^[^\s<>@]+@[^\s<>@]+$/.test(identity.email);
}
export type EditorialChange = { path: string; kind: 'added' | 'modified' | 'deleted' | 'conflict' };
export type EditorialStatus = {
  head: string;
  branch: string | null;
  stagedTree: string;
  staged: EditorialChange[];
  unstaged: EditorialChange[];
  conflicts: string[];
  revert: { commitOid: string; operationId: string } | null;
};
export type EditorialCommit = { oid: string; parents: string[]; message: string; author: EditorialIdentity; authoredAt: string; branch: string | null };
export type EditorialBranch = { name: string; oid: string; current: boolean };
export type EditorialWrite = { path: string; value: EditorialJson | null };
/** Counts paths whose actual file/directory durability step has completed. */
export type EditorialWriteProgress = { completed: number; total: number };
export type EditorialWriteGuards = { expectedHead?: string; expectedContentHashes?: Record<string, string | null> };
export type EditorialSnapshot = { source: EditorialReadSource; head: string; tree: string | null; files: Record<string, EditorialJson> };
/** Omitting value stages working bytes; supplying it freezes that exact JSON in the index. */
export type EditorialStage = { path: string; value?: EditorialJson | null };
export type EditorialCommitInput = { operationId: string; expectedHead: string; expectedTree?: string; message: string };
export type EditorialRevertInput = { operationId: string; expectedHead: string; commitOid: string };
export type EditorialFailureCode = 'INVALID_REQUEST' | 'INVALID_PATH' | 'NOT_FOUND' | 'UNOWNED_REPOSITORY' | 'REPOSITORY_BUSY' | 'HEAD_CHANGED' | 'CONTENT_CHANGED' | 'STAGE_CHANGED' | 'NOTHING_STAGED' | 'DIRTY_WORKTREE' | 'DETACHED_HEAD' | 'BRANCH_EXISTS' | 'BRANCH_NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' | 'REVERT_CONFLICT' | 'REVERT_IN_PROGRESS' | 'GIT_UNAVAILABLE' | 'GIT_FAILED' | 'CORRUPT_REPOSITORY';
export type EditorialRepository = {
  initialize(seedFiles?: Record<string, EditorialJson>): Promise<EditorialStatus>;
  status(): Promise<EditorialStatus>;
  read(path: string, options?: { from?: EditorialReadSource }): Promise<EditorialJson | null>;
  list(options?: { from?: EditorialReadSource; prefix?: string }): Promise<string[]>;
  snapshot(options?: { from?: EditorialReadSource; prefixes?: string[]; paths?: string[] }): Promise<EditorialSnapshot>;
  write(changes: EditorialWrite[], guards?: EditorialWriteGuards): Promise<EditorialStatus>;
  stage(changes: EditorialStage[]): Promise<EditorialStatus>;
  unstage(paths: string[]): Promise<EditorialStatus>;
  commit(input: EditorialCommitInput): Promise<EditorialCommit>;
  /** Trusted local configuration; changes only the author of a future new commit. */
  setIdentity(identity: EditorialIdentity): Promise<void>;
  log(limit?: number): Promise<EditorialCommit[]>;
  /** Read-only exact-content lookup for legacy model references; never substitutes HEAD. */
  findModelRevision(path: string, contentHash: string): Promise<string | null>;
  branches(): Promise<EditorialBranch[]>;
  createBranch(name: string): Promise<EditorialStatus>;
  switchBranch(name: string): Promise<EditorialStatus>;
  checkoutDetached(oid: string): Promise<EditorialStatus>;
  revert(input: EditorialRevertInput): Promise<EditorialStatus>;
  abortRevert(): Promise<EditorialStatus>;
  close(): Promise<void>;
};
