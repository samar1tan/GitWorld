import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryEngine, executeCommand, type DataPackage } from '../../domain/src/index.ts';
import { parseImport, exportPackageCsv, loadDataPackageFile, acquireMetObjects, replayMetStaging, MET_API } from './index.ts';
const seedPath = new URL('../../../data/seed/early-medieval.json', import.meta.url);
const seedText = await readFile(seedPath, 'utf8');
const seed = JSON.parse(seedText) as DataPackage;
const unbox = (result: any) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
// These API-shaped records are synthetic transport fixtures, never historical seed records.
const fakeRecord = (objectID = 42) => ({ objectID, title: 'Synthetic test vessel', objectDate: 'ca. 500–450 B.C.', objectBeginDate: -500, objectEndDate: -450, medium: 'Clay', culture: '', period: 'Synthetic period', department: 'Synthetic test department', primaryImage: 'https://example.invalid/do-not-fetch.jpg' });
const fakeFetch: typeof fetch = async () => new Response(JSON.stringify(fakeRecord()), { headers: { 'Content-Type': 'application/json' } });

test('curated seed publishes with complete evidence, rights and graph; every version replays', () => {
  const result = parseImport(seedText, { format: 'json', mode: 'publish' });
  assert.equal(result.ok, true, JSON.stringify(result.issues)); assert.equal(result.report.records, 38);
  const engine = createHistoryEngine(result.package!.history);
  for (const commit of seed.history.commits) assert.equal(engine.snapshot(commit.id).ok, true, commit.id);
  assert.equal(seed.catalog.processes.length, 9); assert.equal(seed.history.branches.length, 14);
});

test('curated integration explicitly retains Sui authority and leaves unsupported fields unknown', () => {
  const engine = createHistoryEngine(seed.history), snapshot = unbox(engine.snapshot('sui-589'));
  assert.equal(snapshot.fields['politics.dynasty'].key, 'sui');
  assert.equal(snapshot.fields['politics.capital'].status, 'unknown');
  const log = unbox(engine.log('sui/main'));
  assert.ok(log.commits.some((x: any) => x.id === 'chen-557'));
  const broken = structuredClone(seed); delete broken.history.commits.find(c => c.id === 'sui-589')!.integration!.resolutions['politics.dynasty'];
  assert.equal(parseImport(JSON.stringify(broken), { format: 'json', mode: 'publish' }).ok, false);
});

test('influence is not ancestry; uncertain and BCE dates keep their distinct semantics', () => {
  const engine = createHistoryEngine(seed.history);
  assert.equal(seed.history.relationships![0].kind, 'influence');
  assert.deepEqual(unbox(engine.diff('tang-ca700', 'japan-710')).commonBaseIds, []);
  assert.equal(unbox(engine.resolve('qin/main@BCE:221')).commitId, 'qin-221-bce');
  assert.equal(unbox(engine.resolve('tang/main@700')).recordedDate.precision, 'approximate');
  assert.equal(engine.resolve('japan/buddhism@540').ok, false);
  assert.equal(unbox(engine.snapshot('japan-buddhism-538-552')).date.latestYear, 552);
  assert.equal(executeCommand(engine, 'git show tag:sui-integration-589', { head: null }).ok, true);
});

test('JSON and quoted CSV roundtrip preserve every object, newlines, translations and evidence', () => {
  const changed = structuredClone(seed); changed.dataset.description.en = 'A "quoted", multiline\nvalue';
  const csv = exportPackageCsv(changed), parsed = parseImport(csv, { format: 'csv', mode: 'publish' });
  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues)); assert.deepEqual(parsed.package, changed);
});

test('imports report malformed rows and deny hostile keys, invalid JSON and missing refs', () => {
  for (const text of ['type,id,payload\ncommit,x,"unterminated', 'type,id,payload\ncommit,x,not-json']) {
    const result = parseImport(text, { format: 'csv' }); assert.equal(result.ok, false); assert.match(result.issues[0].path, /line:2/);
  }
  for (const text of ['{', '{"__proto__":{"polluted":true}}', '{"schemaVersion":2}']) assert.equal(parseImport(text, { format: 'json' }).ok, false);
  const broken = structuredClone(seed); broken.history.tags![0].commitId = 'does-not-exist';
  const result = parseImport(JSON.stringify(broken), { format: 'json' }); assert.ok(result.issues.some(x => x.code === 'DANGLING_REFERENCE'));
  assert.equal(({} as any).polluted, undefined);
});

test('file errors are structured; invalid imports do not leak source contents', async () => {
  const result = await loadDataPackageFile('/not/a/gitworld/file.json'); assert.equal(result.ok, false); assert.equal(result.issues[0].code, 'FILE_READ_FAILED');
});

test('Met dry-run uses an allowlisted endpoint, maps missing values to unknown, and cannot publish unreviewed rights', async () => {
  let calls = 0;
  const result = await acquireMetObjects({ objectIds: [42], dryRun: true }, { fetch: async (url, init) => { calls++; assert.equal(url, `${MET_API}42`); assert.equal(init?.redirect, 'error'); return fakeFetch(url, init); } });
  assert.equal(result.ok, true, JSON.stringify(result.report)); assert.equal(calls, 1); assert.equal(result.report.stageDirectory, null);
  assert.equal(result.package!.history.commits[0].changes['object.culture']!.status, 'unknown');
  assert.equal(result.package!.history.commits[0].year, -450); assert.ok(!JSON.stringify(result.package).includes('do-not-fetch'));
  assert.ok(result.report.publicationIssues.some(x => x.code === 'RIGHTS_UNREVIEWED'));
});

test('Met staging replays by hash without network; tampering and incomplete acquisitions cannot yield a package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gitworld-ingestion-'));
  try {
    const result = await acquireMetObjects({ objectIds: [42], stagingDirectory: directory }, { fetch: fakeFetch });
    assert.equal(result.ok, true, JSON.stringify(result.report)); const stage = result.report.stageDirectory!;
    assert.deepEqual((await replayMetStaging(stage)).package, result.package);
    assert.deepEqual((await readdir(stage)).sort(), ['42.json', 'manifest.json', 'report.json', 'review-package.json']);
    await writeFile(join(stage, '42.json'), '{}');
    const tampered = await replayMetStaging(stage); assert.equal(tampered.ok, false); assert.equal(tampered.package, null);
    const partial = await acquireMetObjects({ objectIds: [42, 43], stagingDirectory: directory }, { fetch: async (url) => String(url).endsWith('/42') ? fakeFetch(url) : new Response('{}', { status: 404 }) });
    assert.equal(partial.ok, false); assert.equal((await replayMetStaging(partial.report.stageDirectory!)).ok, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('acquisition fails closed for wrong IDs, undated records, oversize input and upstream errors', async () => {
  let calls = 0;
  const illegal = await acquireMetObjects({ objectIds: [NaN, -1], dryRun: true }, { fetch: async () => { calls++; return new Response('{}'); } });
  assert.equal(illegal.ok, false); assert.equal(calls, 0);
  for (const response of [new Response('{}', { status: 429 }), new Response(JSON.stringify({ ...fakeRecord(), objectBeginDate: 0 })), new Response('x'.repeat(2_000_001)), new Response(JSON.stringify(fakeRecord(41)))]) {
    const result = await acquireMetObjects({ objectIds: [42], dryRun: true }, { fetch: async () => response });
    assert.equal(result.ok, false); assert.equal(result.package, null); assert.ok(result.report.issues.length);
  }
});
