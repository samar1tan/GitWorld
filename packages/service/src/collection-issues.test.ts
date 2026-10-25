import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { CLIOPATRIA_VERIFIED_RELEASE } from '../../ingestion/src/cliopatria.ts';
import type { CollectionIssueAggregate, CollectionJob, CollectionMappingIssue } from '../../contracts/src/collection-types.ts';
import { createCollectionAcquisition } from './collection-acquisition.ts';

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const items = (count: number): CollectionMappingIssue[] => Array.from({ length: count }, (_, index) => ({ code: 'PROVISIONAL_IDENTITY', locator: `feature[${index}]`, details: `object:${index}` }));

// Completed-checkpoint fixtures test report persistence, pagination and migration, not upstream acquisition.
async function fixture(t: { after(fn: () => unknown): void }, details: CollectionMappingIssue[], options: { legacy?: boolean; aggregates?: CollectionIssueAggregate[]; reportedCount?: number } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-issue-ledger-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = 'a'.repeat(64), root = path.join(directory, 'collections'), collectionHash = digest({ schemaVersion: 1, objects: [], assertions: [], sources: [] });
  const aggregates = options.aggregates ?? [];
  const job: CollectionJob = { id, provider: 'cliopatria', query: { limit: 1000, startRecord: 0 }, startedAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', status: 'complete', source: { url: CLIOPATRIA_VERIFIED_RELEASE.url, revision: CLIOPATRIA_VERIFIED_RELEASE.revision, contentHash: CLIOPATRIA_VERIFIED_RELEASE.contentHash, bytes: CLIOPATRIA_VERIFIED_RELEASE.bytes, cached: false, licenseId: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }, records: 0, objects: 0, assertions: 0, datedAssertions: 0, locatedObjects: 0, scanned: 1000, nextRecord: 1000, truncated: true, issues: details.slice(0, 30), issueCount: options.reportedCount ?? details.length + aggregates.reduce((sum, value) => sum + value.count, 0), failure: null };
  const ledger = { schemaVersion: 1, jobId: id, sourceContentHash: job.source!.contentHash, collectionHash, items: details, aggregates }, hash = digest(ledger);
  const saved = { schemaVersion: 1, signature: digest({ provider: job.provider, query: job.query }), summary: job, collectionHash, ...(!options.legacy ? { issuesHash: hash } : {}) };
  const jobFile = path.join(root, 'jobs', `${id}.json`), ledgerFile = path.join(root, 'issues', id, `${hash}.json`);
  await mkdir(path.dirname(jobFile), { recursive: true }); await writeFile(jobFile, canonicalJson(saved));
  if (!options.legacy) { await mkdir(path.dirname(ledgerFile), { recursive: true }); await writeFile(ledgerFile, canonicalJson(ledger)); }
  return { directory, id, jobFile, ledgerFile, ledger, saved, acquisition: createCollectionAcquisition(directory) };
}

test('all 564 retained issues remain pageable after restart, including the final item beyond the old sample', async t => {
  const value = await fixture(t, items(564)), acquisition = createCollectionAcquisition(value.directory);
  const retained: CollectionMappingIssue[] = [];
  for (let offset = 0; offset < 564; offset += 40) {
    const page = await acquisition.issues({ jobId: value.id, offset, limit: 40 });
    assert.equal(page.total, 564); assert.equal(page.reportedCount, 564); assert.equal(page.coverage, 'complete'); assert.ok(page.items.length <= 40); retained.push(...page.items);
  }
  assert.equal(retained.length, 564); assert.equal(new Set(retained.map(value => value.locator)).size, 564);
  assert.equal(retained.at(-1)!.locator, 'feature[563]'); assert.equal(retained.at(-1)!.details, 'object:563');
  assert.equal((await acquisition.issues({ jobId: value.id, offset: 600, limit: 40 })).items.length, 0);
  assert.equal((await acquisition.list())[0].issues.length, 30, 'List metadata stays bounded without truncating the retained ledger');
});

test('a legacy 30-of-564 checkpoint stays explicitly partial and a missing cache cannot replace it', async t => {
  const value = await fixture(t, items(30), { legacy: true, reportedCount: 564 }), before = await readFile(value.jobFile, 'utf8');
  const page = await value.acquisition.issues({ jobId: value.id, offset: 0, limit: 40 });
  assert.equal(page.coverage, 'legacy-partial'); assert.equal(page.total, 30); assert.equal(page.reportedCount, 564); assert.equal(page.canRebuild, false); assert.deepEqual(page.aggregates, []);
  await assert.rejects(value.acquisition.rebuildIssues({ jobId: value.id }), /NOT_FOUND/);
  assert.equal(await readFile(value.jobFile, 'utf8'), before); assert.equal((await value.acquisition.issues({ jobId: value.id, offset: 0, limit: 40 })).total, 30);
});

test('aggregate invalid-record exclusions have scan bounds and do not become fake detailed rows', async t => {
  const aggregates: CollectionIssueAggregate[] = [{ code: 'SKIPPED_INVALID_RECORDS', count: 534, afterRecord: 100, throughRecord: 1000 }];
  const value = await fixture(t, items(2), { aggregates }), page = await value.acquisition.issues({ jobId: value.id, offset: 0, limit: 40 });
  assert.equal(page.coverage, 'complete'); assert.equal(page.total, 2); assert.equal(page.reportedCount, 536); assert.equal(page.items.length, 2); assert.deepEqual(page.aggregates, aggregates);
  assert.equal('locator' in page.aggregates[0], false);
});

test('a damaged complete ledger fails integrity checks instead of silently falling back to its sample', async t => {
  const value = await fixture(t, items(40));
  await writeFile(value.ledgerFile, canonicalJson({ ...value.ledger, items: items(30) }));
  await assert.rejects(value.acquisition.issues({ jobId: value.id, offset: 0, limit: 40 }), /VALIDATION_FAILED/);
});

test('bounded issue pages reject invalid limits, offsets and job paths', async t => {
  const value = await fixture(t, items(50));
  for (const [offset, limit] of [[-1, 40], [0, 0], [0, 101], [1.5, 40], [1_000_001, 40]]) await assert.rejects(value.acquisition.issues({ jobId: value.id, offset, limit }), /INVALID_REQUEST/);
  await assert.rejects(value.acquisition.issues({ jobId: '../outside', offset: 0, limit: 40 }), /INVALID_REQUEST/);
  await assert.rejects(value.acquisition.rebuildIssues({ jobId: 'b'.repeat(64) }), /NOT_FOUND/);
});

test('cancelling a report rebuild preserves the old checkpoint and its retained details', async t => {
  const value = await fixture(t, items(30), { legacy: true, reportedCount: 564 }), before = await readFile(value.jobFile, 'utf8'), controller = new AbortController(); controller.abort();
  await assert.rejects(value.acquisition.rebuildIssues({ jobId: value.id, signal: controller.signal }), /CANCELLED/);
  assert.equal(await readFile(value.jobFile, 'utf8'), before);
  assert.equal((await value.acquisition.issues({ jobId: value.id, offset: 0, limit: 40 })).coverage, 'legacy-partial');
});

test('rebuilding verifies cached binary bytes without fetching or replacing a completed batch', async t => {
  const value = await fixture(t, items(30), { legacy: true, reportedCount: 564 }), before = await readFile(value.jobFile, 'utf8');
  const file = path.join(value.directory, 'collections', 'downloads', 'cliopatria', `cliopatria-${CLIOPATRIA_VERIFIED_RELEASE.tag}.zip`);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, new Uint8Array(CLIOPATRIA_VERIFIED_RELEASE.bytes));
  let fetched = 0;
  const acquisition = createCollectionAcquisition(value.directory, { fetch: async () => { fetched++; throw new Error('Report rebuilding must stay offline'); } });
  assert.equal((await acquisition.issues({ jobId: value.id, offset: 0, limit: 40 })).canRebuild, true);
  await assert.rejects(acquisition.rebuildIssues({ jobId: value.id }), /VALIDATION_FAILED/);
  assert.equal(fetched, 0); assert.equal(await readFile(value.jobFile, 'utf8'), before);
});
