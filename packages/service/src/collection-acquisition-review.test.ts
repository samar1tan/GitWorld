import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCollectionAcquisition } from './collection-acquisition.ts';
import { createLocalService } from './index.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';

test('a hash-rejected Pleiades response cannot become a permanent successful download cache', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-collection-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let requests = 0;
  const fetch: typeof globalThis.fetch = async () => { requests++; return new Response('A synthetic wrong upstream response'); };
  const acquisition = createCollectionAcquisition(directory, { fetch });
  const query = { limit: 1, startRecord: 0 };
  const first = await acquisition.acquire({ provider: 'pleiades', query, operationId: 'first-rejected-response' });
  assert.equal(first.status, 'failed'); assert.equal(first.failure?.code, 'INVALID_RESPONSE');
  const restarted = createCollectionAcquisition(directory, { fetch });
  const second = await restarted.acquire({ provider: 'pleiades', query, operationId: 'resume-rejected-response', resumeJobId: first.id });
  assert.equal(second.status, 'failed');
  assert.equal(requests, 2, 'Retry after a rejected pin must re-fetch rather than reuse the rejected bytes');
});

test('catalog download keeps local operations available, blocks backup and persists cancellation across restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-collection-review-'));
  let started!: () => void;
  const didStart = new Promise<void>(resolve => { started = resolve; });
  const fetch: typeof globalThis.fetch = async (_url, input) => {
    started();
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('Synthetic cancellation', 'AbortError'));
      if (input?.signal?.aborted) abort(); else input?.signal?.addEventListener('abort', abort, { once: true });
    });
  };
  const options = { dataDirectory: directory, sourceFetch: fetch, resolveFileToken: () => path.join(tmpdir(), 'unused-review-backup.gitworld') };
  let service = await createLocalService(options);
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  let sequence = 0;
  const request = <M extends ServiceMethod>(method: M, params: ServiceMethods[M]['params']) => service.dispatch({ protocolVersion: 1, requestId: `collection-review-${++sequence}`, method, params } as ServiceRequest);
  const operationId = 'cancel-background-catalog';
  const acquiring = request('collection.acquire', { provider: 'cliopatria', query: { limit: 1, startRecord: 0 }, operationId });
  await didStart;
  const local = await Promise.race([
    Promise.all([request('library.status', {}), request('clientState.save', { key: 'research-input', expectedVersion: null, value: 'Recoverable local input during download' })]),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Local operations are blocked behind source download')), 1000)),
  ]);
  assert.ok(local.every(response => response.ok));
  const maintenance = await request('backup.create', { fileToken: 'unused', operationId: 'refuse-during-download' });
  assert.ok(!maintenance.ok && maintenance.error.code === 'OPERATION_IN_PROGRESS');
  const cancelled = await request('operation.cancel', { operationId }); assert.ok(cancelled.ok);
  const stopped = await acquiring; assert.ok(stopped.ok);
  const job = stopped.result as ServiceMethods['collection.acquire']['result']; assert.equal(job.status, 'cancelled');
  await service.close(); service = await createLocalService(options);
  const jobs = await request('collection.jobs', {}); assert.ok(jobs.ok);
  assert.equal((jobs.result as ServiceMethods['collection.jobs']['result']).find(value => value.id === job.id)?.status, 'cancelled');
  const input = await request('clientState.load', { key: 'research-input' }); assert.ok(input.ok);
  assert.equal((input.result as ServiceMethods['clientState.load']['result'])?.value, 'Recoverable local input during download');
});
