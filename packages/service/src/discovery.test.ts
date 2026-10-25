import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalService } from './index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import { validateServiceRequest } from '../../contracts/src/index.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, WorkspaceState } from '../../contracts/src/index.ts';

let sequence = 0;
async function call<M extends ServiceMethod>(service: Awaited<ReturnType<typeof createLocalService>>, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const response = await service.dispatch({ protocolVersion: 1, requestId: `discovery-${++sequence}`, method, params } as ServiceRequest);
  assert.ok(response.ok, JSON.stringify(response));
  return response.result as ServiceMethods[M]['result'];
}
// Synthetic provider transport fixtures. They are not historical records or a substitute for live-source acceptance.
const entity = (id: string) => ({ id, type: id.startsWith('P') ? 'property' : 'item', lastrevid: 17,
  labels: { en: { language: 'en', value: id === 'P17' ? 'Affiliation test field' : `Test object ${id}` }, 'zh-hans': { language: 'zh-hans', value: `测试对象 ${id}` } },
  descriptions: { en: { language: 'en', value: 'Synthetic transport fixture' } },
  claims: id.startsWith('P') ? {} : { P17: [{ id: `${id}$fixture`, rank: 'normal', type: 'statement', mainsnak: { snaktype: 'value', property: 'P17', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { id: 'Q2', 'entity-type': 'item', 'numeric-id': 2 } } }, qualifiers: { P580: [{ property: 'P580', snaktype: 'value', datavalue: { type: 'time', value: { time: '+0800-00-00T00:00:00Z', precision: 9, calendarmodel: 'http://www.wikidata.org/entity/Q1985786' } } }] }, references: [] }] } });

async function setup(t: { after(fn: () => unknown): void }, sourceFetch: typeof fetch) {
  const root = await mkdtemp(path.join(tmpdir(), 'gitworld-discovery-'));
  const seed = path.join(root, 'seed.json'); await writeFile(seed, JSON.stringify(validPackage()));
  const options = { dataDirectory: path.join(root, 'library'), seedPackagePath: seed, sourceFetch, resolveFileToken: () => undefined };
  const services: Awaited<ReturnType<typeof createLocalService>>[] = [];
  const open = async () => { const service = await createLocalService(options); services.push(service); return service; };
  t.after(async () => { for (const service of services) await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, open, service: await open() };
}

test('source IPC accepts explicit names and opaque jobs but rejects network/path overrides', () => {
  const envelope = (method: string, params: unknown) => ({ protocolVersion: 1, requestId: 'source-boundary', method, params });
  assert.equal(validateServiceRequest(envelope('source.search', { query: 'A city', language: 'en', operationId: 'lookup' })).ok, true);
  for (const params of [
    { query: 'A city', language: 'en', operationId: 'lookup', url: 'http://localhost/' },
    { query: 'A city', language: 'en', operationId: 'lookup', interactive: true },
    { query: '', language: 'en', operationId: 'lookup' },
    { query: 'A city', language: 'en', operationId: 'lookup', cursor: '10001' },
  ]) assert.equal(validateServiceRequest(envelope('source.search', params)).ok, false);
  for (const params of [{ entityIds: ['Q1', 'Q1'], operationId: 'fetch' }, { entityIds: ['Q1'], operationId: 'fetch', resumeJobId: '../private' }, { entityIds: ['Q1'], operationId: 'fetch', stagingDirectory: '/private' }]) assert.equal(validateServiceRequest(envelope('source.collect', params)).ok, false);
  assert.equal(validateServiceRequest(envelope('source.record', { jobId: '../private', externalId: 'Q1' })).ok, false);
});

test('foreground name lookup is cancellable, localized and returns actual provider results', async t => {
  const { service } = await setup(t, async input => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://www.wikidata.org');
    assert.equal(url.searchParams.get('search'), '某座城市'); assert.equal(url.searchParams.get('language'), 'zh-hans');
    assert.equal(url.searchParams.has('maxlag'), false);
    return new Response(JSON.stringify({ search: [{ id: 'Q7001', label: 'A returned city', description: 'Provider description' }] }));
  });
  const result = await call(service, 'source.search', { query: '某座城市', language: 'zh', operationId: 'user-lookup' });
  assert.ok(result.ok); assert.equal(result.value.hits[0].label, 'A returned city');
  assert.deepEqual((await call(service, 'source.jobs', {})).jobs, []);
});

test('collected source material survives restart without creating a historical branch or exposing paths', async t => {
  let fetches = 0;
  const { root, service, open } = await setup(t, async input => {
    fetches++; const url = new URL(String(input)); assert.equal(url.searchParams.get('maxlag'), '5');
    const ids = url.searchParams.get('ids')!.split('|');
    return new Response(JSON.stringify({ entities: Object.fromEntries(ids.map(id => [id, entity(id)])) }));
  });
  const params = { entityIds: ['Q7001'], operationId: 'collect-one' };
  const collected = await call(service, 'source.collect', params); assert.ok(collected.ok, JSON.stringify(collected));
  assert.equal(collected.value.receipt.status, 'complete'); assert.equal(collected.value.materials.length, 1);
  assert.equal(JSON.stringify(collected).includes(root), false);
  const detail = await call(service, 'source.record', { jobId: collected.value.id, externalId: 'Q7001' });
  assert.deepEqual((detail.snapshot.raw as any).claims, entity('Q7001').claims);
  assert.equal(detail.labels.P17.en, 'Affiliation test field');
  const data = await call(service, 'revision.get', { dataset: { datasetId: 'test-world', revisionId: 'revision-1' } });
  assert.equal(data.history.commits.length, 2); assert.equal(data.history.branches.length, 1);
  const count = fetches; await service.close(); const restarted = await open();
  const jobs = await call(restarted, 'source.jobs', {}); assert.equal(jobs.jobs.length, 1); assert.equal(jobs.issues.length, 0);
  const repeated = await call(restarted, 'source.collect', params); assert.ok(repeated.ok); assert.equal(repeated.value.id, collected.value.id); assert.equal(fetches, count);
  const changed = await call(restarted, 'source.collect', { ...params, entityIds: ['Q7002'] }); assert.equal(changed.ok, false);
});

test('collection does not block local workspace saving and cancellation preserves an inspectable job', async t => {
  let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
  const { service } = await setup(t, async (_input, options) => {
    start(); return new Promise<Response>((_resolve, reject) => {
      const stop = () => reject(new Error('aborted fixture'));
      if (options?.signal?.aborted) stop(); else options?.signal?.addEventListener('abort', stop, { once: true });
    });
  });
  const collecting = call(service, 'source.collect', { entityIds: ['Q7001'], operationId: 'long-fetch' }); await started;
  const workspace: WorkspaceState = { id: 'primary', version: 0, dataset: { datasetId: 'test-world', revisionId: 'revision-1' }, locale: 'en', head: null, comparison: null, view: { panel: 'browse', scopeId: null, processId: null, eventId: null, selectedCommitId: null, graphRef: null, timeWindow: [-100, 100], cursor: null, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [] };
  const saved = await call(service, 'workspace.save', { workspace, expectedVersion: null }); assert.equal(saved.id, 'primary');
  assert.deepEqual(await call(service, 'operation.cancel', { operationId: 'long-fetch' }), { cancelled: true });
  const stopped = await collecting; assert.ok(stopped.ok); assert.equal(stopped.value.receipt.status, 'cancelled');
  const jobs = await call(service, 'source.jobs', {}); assert.equal(jobs.jobs.length, 1); assert.equal(jobs.jobs[0].pending.length, 1);
});
