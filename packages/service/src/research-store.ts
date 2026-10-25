import { createHash } from 'node:crypto';
import type { EditorialJson, EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { ResearchRecord, ResearchRecordEnvelope, ResearchRecordRevision, ResearchRecordSummary } from '../../contracts/src/research-types.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { validNavigationRecipe } from '../../contracts/src/navigation-validation.ts';

const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const oid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const recordObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown, max: number, length: number) => Array.isArray(value) && value.length <= max && value.every(item => text(item, length));
const year = (value: unknown) => Number.isSafeInteger(value) && value !== 0;
const labels = (value: unknown) => recordObject(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([language, label]) => /^[A-Za-z][A-Za-z0-9-]{0,34}$/.test(language) && text(label, 1000));
function endpoint(value: unknown): boolean {
  return recordObject(value) && text(value.label, 1000) && (value.labels === undefined || labels(value.labels)) && oid(value.repositoryRevision) && target(value) && (value.year === undefined || value.year === null || year(value.year)) && (value.includeUnreviewed === undefined || typeof value.includeUnreviewed === 'boolean');
}
function target(value: Record<string, any>): boolean {
  if (value.modelId !== undefined) return text(value.modelId, 1000) && value.modelId.length > 0 && text(value.historicalRef, 1000) && value.historicalRef.length > 0 && value.objectId === undefined;
  return (value.objectId === undefined || text(value.objectId, 1000) && value.objectId.length > 0) && (value.historicalRef === undefined || text(value.historicalRef, 1000));
}
export function validResearchRecord(value: unknown): value is ResearchRecord {
  if (!recordObject(value) || value.schemaVersion !== 1 || !id(value.id) || !text(value.title, 300) || !value.title.trim() || !recordObject(value.scope) || !text(value.scope.query, 1000) || !strings(value.scope.objectIds, 1000, 300) || !strings(value.scope.fieldIds, 1000, 300) || !text(value.interpretation, 30000) || !strings(value.openQuestions, 100, 3000) || !Array.isArray(value.evidence) || value.evidence.length > 1000 || !Number.isFinite(Date.parse(value.updatedAt))) return false;
  const interval = value.scope.timeWindow;
  if (!(interval === null || Array.isArray(interval) && interval.length === 2 && interval.every(year) && interval[0] <= interval[1])) return false;
  if (value.scope.label !== undefined && !text(value.scope.label, 1000)) return false;
  if (value.scope.navigation !== undefined && !validNavigationRecipe(value.scope.navigation)) return false;
  if (value.scope.model !== undefined) {
    const model=value.scope.model;
    if (!recordObject(model) || !text(model.datasetId, 1000) || !model.datasetId || !oid(model.repositoryRevision) || !(model.scopeId===null || text(model.scopeId, 1000)) || !(model.processId===null || text(model.processId, 1000))) return false;
  }
  if (!value.evidence.every((item: unknown) => recordObject(item) && text(item.id, 500) && ['source', 'assertion', 'object', 'historical-state'].includes(item.kind) && text(item.title, 1000) && text(item.locator, 4000) && oid(item.repositoryRevision) && target(item) && (item.year === undefined || year(item.year)) && (item.includeUnreviewed === undefined || typeof item.includeUnreviewed === 'boolean') && (item.url === undefined || typeof item.url === 'string' && /^https?:\/\//.test(item.url)))) return false;
  return value.comparison === null || recordObject(value.comparison) && endpoint(value.comparison.a) && endpoint(value.comparison.b);
}

/** Research records use the same working tree and staged snapshots as adopted historical data. */
export function createResearchStore(repository: EditorialRepository) {
  const file = (recordId: string) => { if (!id(recordId)) throw new Error('INVALID_REQUEST'); return `research/${recordId}.json`; };
  async function get(recordId: string, revision?: string): Promise<ResearchRecordEnvelope> {
    if (revision !== undefined && !oid(revision)) throw new Error('INVALID_REQUEST');
    const value = await repository.read(file(recordId), { from: revision ?? 'working' });
    if (value === null) throw new Error('NOT_FOUND');
    if (!validResearchRecord(value) || value.id !== recordId) throw new Error('VALIDATION_FAILED');
    return { record: value, contentHash: hash(value), repositoryRevision: revision ?? null };
  }
  return {
    get,
    async list(): Promise<ResearchRecordSummary[]> {
      const records: ResearchRecordSummary[] = [];
      for (const path of await repository.list({ prefix: 'research/', from: 'working' })) {
        if (!/^research\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(path)) continue;
        const envelope = await get(path.slice('research/'.length, -'.json'.length));
        const { id, title, scope, updatedAt } = envelope.record;
        records.push({ id, title, scope, updatedAt });
      }
      return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    },
    async save(record: ResearchRecord, expectedHash: string | null): Promise<ResearchRecordEnvelope> {
      if (!validResearchRecord(record) || !(expectedHash === null || /^[a-f0-9]{64}$/.test(expectedHash))) throw new Error('INVALID_REQUEST');
      const path = file(record.id), status = await repository.status(), before = await repository.read(path);
      if ((before === null ? null : hash(before)) !== expectedHash) throw new Error('CONFLICT');
      const stamped = { ...structuredClone(record), updatedAt: new Date().toISOString() };
      await repository.write([{ path, value: stamped as unknown as EditorialJson }], { expectedHead: status.head, expectedContentHashes: { [path]: expectedHash } });
      return { record: stamped, contentHash: hash(stamped), repositoryRevision: null };
    },
    async history(recordId: string): Promise<ResearchRecordRevision[]> {
      const path = file(recordId), commits = await repository.log(100), result: ResearchRecordRevision[] = [];
      for (const commit of commits) {
        const value = await repository.read(path, { from: commit.oid });
        if (value === null) continue;
        const parent = commit.parents[0] ? await repository.read(path, { from: commit.parents[0] }) : null;
        if (parent === null || hash(value) !== hash(parent)) result.push({ oid: commit.oid, message: commit.message, authoredAt: commit.authoredAt });
      }
      return result;
    },
    readRevision: (recordId: string, revision: string) => get(recordId, revision),
  };
}
