import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { isHistoricalYear, validateDataPackage, type DataPackage, type HistoryCommit, type HistorySource, type HistoryValue } from '../../domain/src/index.ts';
import type { ImportIssue } from './import.ts';

export const MET_API = 'https://collectionapi.metmuseum.org/public/collection/v1/objects/';
export const MET_LICENSE = 'https://www.metmuseum.org/hubs/open-access';
const MAX_RESPONSE_BYTES = 2_000_000;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export type AcquisitionReport = { adapter: 'met-open-access-v1'; runId: string; requestedObjectIds: number[]; dryRun: boolean; retrievedAt: string; sourceUrl: string; license: string; licenseEvidence: string; stageDirectory: string | null; steps: { step: string; status: 'ok' | 'failed'; objectId?: number; sha256?: string; bytes?: number }[]; issues: ImportIssue[]; publicationIssues: ImportIssue[]; readyForReview: boolean };
export type AcquisitionResult = { ok: boolean; package: DataPackage | null; report: AcquisitionReport };
type RawRecord = { objectId: number; text: string; sha256: string };
type Manifest = { adapter: 'met-open-access-v1'; retrievedAt: string; requestedObjectIds: number[]; records: { objectId: number; sha256: string; file: string }[] };
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 1_000_000_000;
const issue = (code: ImportIssue['code'], path: string, reason: string): ImportIssue => ({ code, path, parameters: { reason } });
const textField = (value: unknown): string => typeof value === 'string' ? value.normalize('NFC').trim() : '';

function mapMetRecords(records: RawRecord[], retrievedAt: string): { package: DataPackage | null; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [], commits: HistoryCommit[] = [], sources: Record<string, HistorySource> = {};
  for (const raw of records) {
    let r: any; try { r = JSON.parse(raw.text); } catch { issues.push(issue('SOURCE_RECORD_INVALID', `object:${raw.objectId}`, 'json')); continue; }
    if (r?.objectID !== raw.objectId || !textField(r.title) || !textField(r.objectDate) || !isHistoricalYear(r.objectBeginDate) || !isHistoricalYear(r.objectEndDate) || r.objectBeginDate > r.objectEndDate) {
      issues.push(issue('SOURCE_RECORD_INVALID', `object:${raw.objectId}`, 'id/title/date: zero, absent or invalid dates need editorial repair')); continue;
    }
    const sourceId = `met-object-${raw.objectId}`;
    sources[sourceId] = { id: sourceId, title: `The Met Collection API: object ${raw.objectId}`, url: `${MET_API}${raw.objectId}`, publisher: 'The Metropolitan Museum of Art', language: 'en', retrievedAt, sourceRevision: `sha256:${raw.sha256}`, rights: { status: 'unreviewed', license: 'CC0-1.0', redistribution: 'allowed', basis: `Basic collection metadata is offered under CC0: ${MET_LICENSE}. The adapter selects metadata fields only; image URLs, essays and images are not redistributed. Editorial review is still required.`, attribution: 'The Metropolitan Museum of Art, Open Access Collection API' } };
    const changes: Record<string, HistoryValue> = {};
    for (const [field, inputKey] of Object.entries({ 'object.title': 'title', 'object.dateLabel': 'objectDate', 'object.medium': 'medium', 'object.culture': 'culture', 'object.period': 'period', 'object.department': 'department' })) {
      const value = textField(r[inputKey]);
      changes[field] = value ? { key: `met:${inputKey}:${digest(value).slice(0, 24)}`, label: { en: value }, status: 'known', sourceIds: [sourceId], evidence: [{ sourceId, locator: `JSON $.${inputKey}` }], value, certainty: 'documented' } : { key: null, label: { en: 'Not provided in the source record' }, status: 'unknown', sourceIds: [], evidence: [] };
    }
    commits.push({ id: `met-${raw.objectId}`, branchId: `met/object-${raw.objectId}`, year: r.objectEndDate, title: { en: textField(r.title) }, summary: { en: `Collection record ${raw.objectId}; source dating: ${textField(r.objectDate)}.` }, parents: [], kind: 'baseline', lineage: [], changes, sourceIds: [sourceId], evidence: [{ sourceId, locator: 'JSON $.objectID, $.objectDate, $.objectBeginDate, $.objectEndDate' }], date: { earliestYear: r.objectBeginDate, latestYear: r.objectEndDate, precision: r.objectBeginDate !== r.objectEndDate ? 'interval' : /\b(ca\.?|circa|about|probably|possibly)\b/i.test(r.objectDate) ? 'approximate' : 'year', calendar: 'proleptic-gregorian', note: { en: 'Bounds are the museum’s catalog dating, not a claim that production lasted throughout the interval. Review qualifiers in the source date label.' } }, note: { en: 'An artifact catalog observation, not a political state or a claim of causal descent. Missing metadata stays unknown. No artwork image is included.' } });
  }
  if (issues.length || !commits.length) return { package: null, issues: issues.length ? issues : [issue('SOURCE_RECORD_INVALID', '$', 'no records')] };
  const coverage: [number, number] = [Math.min(...commits.map(c => c.date!.earliestYear)), Math.max(...commits.map(c => c.year))];
  const revisionId = `met-${digest(retrievedAt + '\n' + records.map(r => `${r.objectId}:${r.sha256}`).sort().join('\n')).slice(0,24)}`;
  const data: DataPackage = { schemaVersion: 1, dataset: { id: 'met-selected-objects', name: { en: 'Selected Met collection records' }, description: { en: 'Imported collection metadata for review. Objects are independent records; dates and catalog classifications require editorial assessment.' }, license: 'CC0-1.0 (selected Met metadata); Apache-2.0 (GitWorld adapter annotations)' }, revision: { id: revisionId, parentRevisionId: null, createdAt: retrievedAt, notes: { en: 'Imported from the official Met Open Access API. Raw hashes identify inputs; no automatic publication or integration with a political branch.' } }, catalog: { scopes: [{ id: 'met-collection', parentId: null, name: { en: 'Met collection' }, summary: { en: 'A collection scope, not a historical territory or place of production.' }, coverage, sourceIds: Object.keys(sources) }], processes: [{ id: 'met-records', scopeIds: ['met-collection'], name: { en: 'Cataloged objects' }, summary: { en: 'Selected independently dated collection records.' }, coverage, branchIds: commits.map(c => c.branchId), eventIds: [], sourceIds: Object.keys(sources) }], events: [], places: [], defaults: { timeWindow: coverage, scopeId: 'met-collection', worldView: { x: 0, y: 0, width: 1000, height: 520 } } }, history: { id: revisionId, datasetId: 'met-selected-objects', branches: commits.map(c => ({ id: c.branchId, name: c.title, description: { en: 'One artifact catalog observation. No political or institutional ancestry is asserted.' }, scopeId: 'met-collection', processId: 'met-records', coverage: [c.date!.earliestYear, c.date!.latestYear], commitIds: [c.id] })), commits, fields: Object.entries({ 'object.title': 'Object title', 'object.dateLabel': 'Source dating', 'object.medium': 'Medium', 'object.culture': 'Catalog culture', 'object.period': 'Catalog period', 'object.department': 'Museum department' }).map(([id, name]) => ({ id, name: { en: name }, group: 'object', valueType: 'text', description: { en: id === 'object.department' ? 'The department recorded by the museum at retrieval; not historical ownership or a political institution.' : 'A source catalog description; review its wording and date qualification before publication.' } })), sources, tags: [], relationships: [] } };
  const validated = validateDataPackage(data, 'draft'); return validated.ok ? { package: validated.value, issues: [] } : { package: null, issues: validated.issues };
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) throw new Error('missing body');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > MAX_RESPONSE_BYTES) throw new Error('response limit'); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function newReport(dryRun: boolean, retrievedAt = new Date().toISOString()): AcquisitionReport {
  return { adapter: 'met-open-access-v1', runId: randomUUID(), requestedObjectIds: [], dryRun, retrievedAt, sourceUrl: MET_API, license: 'CC0-1.0', licenseEvidence: MET_LICENSE, stageDirectory: null, steps: [], issues: [], publicationIssues: [], readyForReview: false };
}
async function finish(records: RawRecord[], report: AcquisitionReport): Promise<AcquisitionResult> {
  const mapped = report.issues.length ? { package: null, issues: [] } : mapMetRecords(records, report.retrievedAt);
  report.issues.push(...mapped.issues); report.readyForReview = !!mapped.package;
  report.steps.push({ step: 'map-and-validate', status: mapped.package ? 'ok' : 'failed' });
  if (mapped.package) { const publication = validateDataPackage(mapped.package, 'publish'); if (!publication.ok) report.publicationIssues = publication.issues; }
  if (report.stageDirectory) {
    try {
      const manifest: Manifest = { adapter: 'met-open-access-v1', retrievedAt: report.retrievedAt, requestedObjectIds: report.requestedObjectIds, records: records.map(r => ({ objectId: r.objectId, sha256: r.sha256, file: `${r.objectId}.json` })) };
      await writeFile(join(report.stageDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      if (mapped.package) await writeFile(join(report.stageDirectory, 'review-package.json'), JSON.stringify(mapped.package, null, 2) + '\n');
      await writeFile(join(report.stageDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    } catch { report.issues.push(issue('STAGING_FAILED', '$', 'unable to write manifest/package/report')); report.readyForReview = false; }
  }
  return { ok: report.readyForReview, package: report.readyForReview ? mapped.package : null, report };
}

/** Host-side adapter. Dry runs still fetch official metadata, but write no files. */
export async function acquireMetObjects(options: { objectIds: number[]; stagingDirectory?: string; dryRun?: boolean; signal?: AbortSignal }, dependencies: { fetch?: typeof fetch } = {}): Promise<AcquisitionResult> {
  const report = newReport(options.dryRun ?? false), records: RawRecord[] = [];
  report.requestedObjectIds = [...options.objectIds];
  if (!options.objectIds.length || options.objectIds.length > 25 || !options.objectIds.every(validId) || new Set(options.objectIds).size !== options.objectIds.length) { report.issues.push(issue('SOURCE_RECORD_INVALID', '$.objectIds', '1–25 unique positive integer IDs required')); return finish(records, report); }
  if (!report.dryRun) {
    if (!options.stagingDirectory) { report.issues.push(issue('STAGING_FAILED', '$.stagingDirectory', 'host staging directory required')); return finish(records, report); }
    const directory = join(options.stagingDirectory, `met-${report.runId}`);
    try { await mkdir(directory, { recursive: true, mode: 0o700 }); report.stageDirectory = directory; } catch { report.issues.push(issue('STAGING_FAILED', '$', 'unable to create staging directory')); return finish(records, report); }
  }
  for (const objectId of options.objectIds) {
    try {
      const response = await (dependencies.fetch ?? fetch)(`${MET_API}${objectId}`, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]), headers: { Accept: 'application/json', 'User-Agent': 'GitWorld/0.1 (Open Access metadata ingestion)' } });
      if (!response.ok) { report.issues.push(issue('NETWORK_FAILED', `object:${objectId}`, `HTTP ${response.status}`)); report.steps.push({ step: 'fetch', status: 'failed', objectId }); continue; }
      const raw = await boundedBody(response); const record = { objectId, text: raw, sha256: digest(raw) }; records.push(record);
      if (report.stageDirectory) await writeFile(join(report.stageDirectory, `${objectId}.json`), raw, { mode: 0o600 });
      report.steps.push({ step: report.dryRun ? 'fetch' : 'fetch-and-stage', status: 'ok', objectId, sha256: record.sha256, bytes: Buffer.byteLength(raw) });
    } catch { report.issues.push(issue('NETWORK_FAILED', `object:${objectId}`, 'request, bounded response, cancellation, or raw staging failed; retry this ID')); report.steps.push({ step: 'fetch-and-stage', status: 'failed', objectId }); }
  }
  return finish(records, report);
}

/** Retry mapping from immutable staged bytes without network or overwriting the acquisition. */
export async function replayMetStaging(directory: string): Promise<AcquisitionResult> {
  const report = newReport(true), records: RawRecord[] = [];
  try {
    const manifestStat = await lstat(join(directory, 'manifest.json'));
    if (!manifestStat.isFile() || manifestStat.size > 100_000) throw new Error('manifest');
    const manifest: Manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.adapter !== report.adapter || !Array.isArray(manifest.records) || manifest.records.length > 25 || !Number.isFinite(Date.parse(manifest.retrievedAt))) throw new Error('manifest');
    report.retrievedAt = manifest.retrievedAt;
    if (!Array.isArray(manifest.requestedObjectIds) || !manifest.requestedObjectIds.length || manifest.requestedObjectIds.length > 25 || !manifest.requestedObjectIds.every(validId) || new Set(manifest.requestedObjectIds).size !== manifest.requestedObjectIds.length || manifest.records.length !== manifest.requestedObjectIds.length || manifest.records.some(r => !manifest.requestedObjectIds.includes(r.objectId))) throw new Error('incomplete acquisition; retry requested IDs');
    report.requestedObjectIds = [...manifest.requestedObjectIds];
    const seen = new Set<number>();
    for (const entry of manifest.records) {
      if (!validId(entry.objectId) || seen.has(entry.objectId) || entry.file !== `${entry.objectId}.json` || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('entry'); seen.add(entry.objectId);
      const rawStat = await lstat(join(directory, entry.file));
      if (!rawStat.isFile() || rawStat.size > MAX_RESPONSE_BYTES) throw new Error('raw file');
      const raw = await readFile(join(directory, entry.file), 'utf8');
      if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES || digest(raw) !== entry.sha256) { report.issues.push(issue('SOURCE_RECORD_INVALID', `object:${entry.objectId}`, 'staged hash mismatch or size exceeded; do not edit raw evidence')); continue; }
      records.push({ objectId: entry.objectId, text: raw, sha256: entry.sha256 });
    }
    report.steps.push({ step: 'verify-staged-hashes', status: report.issues.length ? 'failed' : 'ok' });
  } catch { report.issues.push(issue('SOURCE_RECORD_INVALID', '$.manifest', 'invalid or unreadable staging manifest')); }
  return finish(records, report);
}
