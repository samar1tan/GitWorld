import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalService } from './index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, ResearchRecord } from '../../contracts/src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.GITWORLD_TEST_GIT ?? path.join(root, '.local/bundled-git/runtime/bin/git');
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git to run the content-to-commit integration.' };
let sequence = 0;
async function response<M extends ServiceMethod>(service: Awaited<ReturnType<typeof createLocalService>>, method: M, params: ServiceMethods[M]['params']) {
  return service.dispatch({ protocolVersion: 1, requestId: `content-${++sequence}`, method, params } as ServiceRequest);
}
async function call<M extends ServiceMethod>(service: Awaited<ReturnType<typeof createLocalService>>, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const result = await response(service, method, params); assert.ok(result.ok, JSON.stringify(result)); return result.result as ServiceMethods[M]['result'];
}
// These are synthetic provider transport fixtures; they never establish live-source or GUI acceptance.
const time = (year: number) => ({ time: `+${String(year).padStart(4, '0')}-00-00T00:00:00Z`, precision: 9, calendarmodel: 'http://www.wikidata.org/entity/Q1985786' });
const qualifier = (property: string, year: number) => ({ snaktype: 'value', property, datatype: 'time', datavalue: { type: 'time', value: time(year) } });
function entity(id: string, revision = 1, firstValue = 'Q2') {
  return { id, type: id.startsWith('P') ? 'property' : 'item', lastrevid: revision,
    labels: { en: { language: 'en', value: id === 'Q7001' ? 'Synthetic coastal city' : `Test ${id}` } }, descriptions: {}, aliases: {},
    claims: id.startsWith('P') ? {} : { P17: [
      { id: `${id}$first`, rank: 'normal', mainsnak: { property: 'P17', snaktype: 'value', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { id: firstValue } } }, qualifiers: { P580: [qualifier('P580', 800)], P582: [qualifier('P582', 850)] }, references: [] },
      { id: `${id}$second`, rank: 'normal', mainsnak: { property: 'P17', snaktype: 'value', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { id: 'Q3' } } }, qualifiers: { P580: [qualifier('P580', 851)], P582: [qualifier('P582', 900)] }, references: [] },
    ] } };
}
async function setup(t: { after(fn: () => unknown): void }) {
  const data = await mkdtemp(path.join(tmpdir(), 'gitworld-content-')), seed = path.join(data, 'seed.json'); await writeFile(seed, JSON.stringify(validPackage()));
  const input = { revision: 1, firstValue: 'Q2' }, services: Awaited<ReturnType<typeof createLocalService>>[] = [];
  const sourceFetch: typeof fetch = async url => { const ids = new URL(String(url)).searchParams.get('ids')!.split('|'); return new Response(JSON.stringify({ entities: Object.fromEntries(ids.map(id => [id, entity(id, input.revision, input.firstValue)])) })); };
  const options = { dataDirectory: path.join(data, 'library'), seedPackagePath: seed, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), sourceFetch, resolveFileToken: () => undefined };
  const open = async () => { const service = await createLocalService(options); services.push(service); return service; };
  t.after(async () => { for (const service of services) await service.close(); await rm(data, { recursive: true, force: true }); });
  return { service: await open(), open, input };
}
async function acquire(service: Awaited<ReturnType<typeof createLocalService>>, id: string) {
  const fetched = await call(service, 'source.collect', { entityIds: ['Q7001'], operationId: `fetch-${id}` }); assert.ok(fetched.ok, JSON.stringify(fetched));
  const preview = await call(service, 'knowledge.previewJob', { jobId: fetched.value.id }), before = await call(service, 'repository.status', {});
  const adopted = await call(service, 'knowledge.adoptJob', { jobId: fetched.value.id, expectedHead: before.head, expectedInputHash: preview.inputHash, review: 'adopted', operationId: `adopt-${id}` });
  return { fetched: fetched.value, preview, adopted };
}
async function commitAll(service: Awaited<ReturnType<typeof createLocalService>>, id: string) {
  const status = await call(service, 'repository.status', {}), staged = await call(service, 'repository.stage', { paths: status.unstaged.map(value => value.path) });
  return call(service, 'repository.commit', { operationId: id, expectedHead: staged.head, expectedTree: staged.stagedTree, message: `Record ${id}` });
}
function record(revision: string): ResearchRecord {
  return { schemaVersion: 1, id: 'coastal-study', title: 'Coastal-city changes', scope: { query: 'Synthetic coastal city', objectIds: ['wikidata:Q7001'], fieldIds: ['wikidata:P17'], timeWindow: [800, 900] }, interpretation: 'Interpretation B', openQuestions: ['What explains the gap?'],
    evidence: [{ id: 'evidence-one', kind: 'assertion', title: 'Dated affiliation', locator: '$.claims.P17[0]', repositoryRevision: revision, objectId: 'wikidata:Q7001', assertionId: 'wikidata:Q7001$first' }],
    comparison: { a: { label: 'Earlier observation', repositoryRevision: revision, objectId: 'wikidata:Q7001', year: 825 }, b: { label: 'Later observation', repositoryRevision: revision, objectId: 'wikidata:Q7001', year: 875 } }, updatedAt: new Date().toISOString() };
}

test('source claims become ordinary dated states, then frozen research B commits while C stays working', native, async t => {
  const { service, open, input } = await setup(t);
  const acquired = await acquire(service, 'initial'); assert.equal(acquired.preview.objects, 1); assert.equal(acquired.preview.assertions, 2);
  const materialCommit = await commitAll(service, 'adopt-dated-material');
  const query = await call(service, 'knowledge.query', { query: { text: 'coastal', time: [810, 890] }, revision: materialCommit.oid }); assert.equal(query.total, 1);
  const state = await call(service, 'knowledge.state', { state: { objectId: 'wikidata:Q7001', year: 825, propertyIds: ['wikidata:P17'] }, revision: materialCommit.oid }); assert.equal(state.fields[0].status, 'known');
  const comparison = await call(service, 'knowledge.diff', { a: { state: { objectId: 'wikidata:Q7001', year: 825 }, revision: materialCommit.oid }, b: { state: { objectId: 'wikidata:Q7001', year: 875 }, revision: materialCommit.oid } }); assert.equal(comparison.fields[0].kind, 'changed');
  const original = record(materialCommit.oid), saved = await call(service, 'research.save', { record: original, expectedHash: null });
  const staged = await call(service, 'repository.stage', { paths: ['research/coastal-study.json'] });
  await call(service, 'research.save', { record: { ...saved.record, interpretation: 'Still-working interpretation C' }, expectedHash: saved.contentHash });
  const committed = await call(service, 'repository.commit', { operationId: 'record-interpretation-B', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Relate the dated observations' });
  assert.equal((await call(service, 'research.readRevision', { id: original.id, oid: committed.oid })).record.interpretation, 'Interpretation B');
  assert.equal((await call(service, 'research.get', { id: original.id })).record.interpretation, 'Still-working interpretation C');
  assert.equal((await call(service, 'repository.status', {})).unstaged[0].path, 'research/coastal-study.json');
  input.revision = 2; input.firstValue = 'Q4'; const updated = await acquire(service, 'updated'); assert.equal(updated.adopted.conflicts.length, 0);
  const workingState = await call(service, 'knowledge.state', { state: { objectId: 'wikidata:Q7001', year: 825, propertyIds: ['wikidata:P17'] } }); assert.deepEqual(workingState.fields[0].values, [{ kind: 'entity', objectId: 'wikidata:Q4' }]);
  const older = await call(service, 'knowledge.state', { state: { objectId: 'wikidata:Q7001', year: 825, propertyIds: ['wikidata:P17'] }, revision: materialCommit.oid }); assert.deepEqual(older.fields[0].values, [{ kind: 'entity', objectId: 'wikidata:Q2' }]);
  await service.close(); const restarted = await open();
  const recovered = await call(restarted, 'research.get', { id: original.id }); assert.equal(recovered.record.interpretation, 'Still-working interpretation C'); assert.equal(recovered.record.comparison?.a.repositoryRevision, materialCommit.oid);
});

test('a partial staged object without its source dependencies cannot become a runnable committed tree', native, async t => {
  const { service } = await setup(t); await acquire(service, 'dependency'); const before = await call(service, 'repository.status', {});
  const objects = before.unstaged.filter(value => value.path.startsWith('objects/')).map(value => value.path); assert.equal(objects.length, 1);
  const selection = await response(service, 'repository.stage', { paths: objects });
  if (!selection.ok) {
    assert.ok(['REVIEW_REQUIRED', 'VALIDATION_FAILED'].includes(selection.error.code));
    assert.equal((await call(service, 'repository.status', {})).head, before.head);
    assert.equal((await call(service, 'repository.status', {})).staged.length, 0);
    return;
  }
  const staged = selection.result as ServiceMethods['repository.stage']['result'];
  const result = await response(service, 'repository.commit', { operationId: 'missing-source', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Must include source evidence' });
  assert.equal(result.ok, false, 'Dangling source evidence must fail exact-tree validation');
  assert.equal((await call(service, 'repository.status', {})).head, before.head);
});
