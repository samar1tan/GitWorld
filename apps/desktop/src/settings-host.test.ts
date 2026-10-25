import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSettingsHostCoordinator } from './settings-host.ts';
import { createLocalService } from '../../../packages/service/src/index.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, SettingsSnapshot } from '@gitworld/contracts';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = () => done(); }); return { promise, resolve }; }
let sequence = 0;
const input = <M extends ServiceMethod>(method: M, params: ServiceMethods[M]['params']) => ({ protocolVersion: 1, requestId: `host-review-${++sequence}`, method, params }) as ServiceRequest;
async function setup(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'gitworld-settings-host-')), file = path.join(root, 'complete.gitworld');
  const live = await createLocalService({ dataDirectory: path.join(root, 'live'), resolveFileToken: () => file });
  const source = await createLocalService({ dataDirectory: path.join(root, 'source'), resolveFileToken: () => file });
  t.after(async () => { await live.close(); await source.close(); await rm(root, { recursive: true, force: true }); });
  async function call<M extends ServiceMethod>(service: typeof live, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
    const response = await service.dispatch(input(method, params)); assert.ok(response.ok, JSON.stringify(response)); return response.result as ServiceMethods[M]['result'];
  }
  return { live, source, file, call };
}

test('close rejects new native actions while every previously accepted zoom and settings write drains', async t => {
  const { live, call } = await setup(t), started = deferred(), release = deferred();
  let hold = true, writes = 0, closeFinished = false;
  const applied: SettingsSnapshot[] = [];
  const host = createSettingsHostCoordinator({ request: async request => {
    const response = await live.dispatch(request);
    if (request.method === 'settings.get' && hold) { hold = false; started.resolve(); await release.promise; }
    if (request.method === 'settings.update') writes++;
    return response;
  }, apply: snapshot => applied.push(snapshot) });
  const first = host.zoom('in'), second = host.zoom('in'); await started.promise;
  const closing = host.close().then(() => { closeFinished = true; });
  assert.deepEqual(await host.zoom('in'), { accepted: false, reason: 'closing' });
  assert.equal(closeFinished, false); release.resolve();
  assert.deepEqual(await first, { accepted: true, ok: true }); assert.deepEqual(await second, { accepted: true, ok: true }); await closing;
  assert.equal(writes, 2); assert.equal(closeFinished, true);
  assert.equal((await call(live, 'settings.get', {})).values.general.zoomFactor, 1.21);
  assert.equal(applied.at(-1)?.values.general.zoomFactor, 1.21);
  const refused = await host.dispatch(input('settings.update', { section: 'learning', expectedVersion: 2, value: { tipsEnabled: false } }));
  assert.ok(!refused.ok && refused.error.code === 'SERVICE_UNAVAILABLE');

  const writeStarted = deferred(), releaseWrite = deferred(); let writeClosed = false;
  const writer = createSettingsHostCoordinator({ request: async request => {
    const response = await live.dispatch(request);
    if (request.method === 'settings.update') { writeStarted.resolve(); await releaseWrite.promise; }
    return response;
  }, apply: () => {} });
  const writing = writer.dispatch(input('settings.update', { section: 'learning', expectedVersion: 2, value: { tipsEnabled: false } })); await writeStarted.promise;
  const draining = writer.close().then(() => { writeClosed = true; }); await Promise.resolve(); assert.equal(writeClosed, false);
  releaseWrite.resolve(); assert.ok((await writing).ok); await draining; assert.equal(writeClosed, true);
});

test('restore drains delayed old-library zooms before installing a same-version profile from another library', async t => {
  const { live, source, call } = await setup(t);
  await call(live, 'settings.update', { section: 'contributor', expectedVersion: 0, value: { name: 'Synthetic old author', email: 'old@local.invalid' } });
  const restored = await call(source, 'settings.update', { section: 'general', expectedVersion: 0, value: { locale: 'zh-CN', zoomFactor: 1.5, startup: 'world', reducedMotion: 'reduce' } });
  await call(source, 'backup.create', { fileToken: 'fixture', operationId: 'source-backup' });
  const started = deferred(), release = deferred(); let hold = true;
  const applied: SettingsSnapshot[] = [], changes: boolean[] = [], calls: string[] = [];
  const host = createSettingsHostCoordinator({ request: async request => {
    calls.push(request.method); const response = await live.dispatch(request);
    if (request.method === 'settings.get' && hold) { hold = false; started.resolve(); await release.promise; }
    return response;
  }, apply: snapshot => applied.push(structuredClone(snapshot)), onStateChange: state => changes.push(state.maintaining) });
  const first = host.zoom('in'), second = host.zoom('in'); await started.promise;
  const restoring = host.dispatch(input('backup.restore', { fileToken: 'fixture', operationId: 'host-restore' }));
  assert.equal(host.state().maintaining, true); assert.equal(calls.includes('backup.restore'), false);
  assert.deepEqual(await host.zoom('out'), { accepted: false, reason: 'maintenance' });
  release.resolve(); await Promise.all([first, second]); assert.ok((await restoring).ok);
  assert.ok(calls.indexOf('backup.restore') > calls.lastIndexOf('settings.update'));
  assert.deepEqual(await call(live, 'settings.get', {}), restored);
  assert.deepEqual(applied.at(-1), restored); assert.equal(host.state().epoch, 1); assert.equal(host.state().version, 1);
  assert.deepEqual(changes, [true, false]); assert.equal(host.state().maintaining, false);
});

test('cancellation during host drain prevents the undispatched transfer instead of falsely cancelling only a service job', async t => {
  const { live, file, call } = await setup(t), started = deferred(), release = deferred(); let hold = true, transfers = 0;
  const host = createSettingsHostCoordinator({ request: async request => {
    if (request.method === 'backup.create' || request.method === 'backup.restore') transfers++;
    const response = await live.dispatch(request);
    if (request.method === 'settings.get' && hold) { hold = false; started.resolve(); await release.promise; }
    return response;
  }, apply: () => {} });
  const zoom = host.zoom('in'); await started.promise;
  const backup = host.dispatch(input('backup.create', { fileToken: 'fixture', operationId: 'cancel-before-dispatch' }));
  const cancelled = await host.dispatch(input('operation.cancel', { operationId: 'cancel-before-dispatch' }));
  assert.ok(cancelled.ok); assert.deepEqual(cancelled.result, { cancelled: true }); assert.equal(transfers, 0);
  release.resolve(); await zoom; const result = await backup;
  assert.ok(!result.ok && result.error.code === 'CANCELLED'); assert.equal(transfers, 0);
  await assert.rejects(stat(file), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
  assert.equal((await call(live, 'settings.get', {})).values.general.zoomFactor, 1.1);
  assert.equal(host.state().epoch, 0); assert.equal(host.state().maintaining, false);
});

test('late responses cannot rewind a newer profile or revive a previous library after restoring a lower version', async t => {
  const { live, source, call } = await setup(t);
  const first = await call(live, 'settings.update', { section: 'contributor', expectedVersion: 0, value: { name: 'First', email: 'first@local.invalid' } });
  const restored = await call(source, 'settings.update', { section: 'learning', expectedVersion: 0, value: { tipsEnabled: false } });
  await call(source, 'backup.create', { fileToken: 'fixture', operationId: 'older-profile-backup' });
  let held: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
  const applied: SettingsSnapshot[] = [];
  const host = createSettingsHostCoordinator({ request: async request => {
    const hold = request.method === 'settings.get' ? held : null; if (hold) held = null;
    const response = await live.dispatch(request);
    if (hold) { hold.started.resolve(); await hold.release.promise; }
    return response;
  }, apply: snapshot => applied.push(structuredClone(snapshot)) });
  const old = { started: deferred(), release: deferred() }; held = old;
  const reading = host.read(); await old.started.promise;
  const changed = await host.dispatch(input('settings.update', { section: 'learning', expectedVersion: first.version, value: { tipsEnabled: false } })); assert.ok(changed.ok);
  old.release.resolve(); await reading; assert.equal(host.state().version, 2); assert.equal(applied.at(-1)?.version, 2);
  const stale = { started: deferred(), release: deferred() }; held = stale;
  const previousLibrary = host.read(); const previousRejected = assert.rejects(previousLibrary, /CANCELLED/); await stale.started.promise;
  assert.ok((await host.dispatch(input('backup.restore', { fileToken: 'fixture', operationId: 'restore-lower-version' }))).ok);
  stale.release.resolve(); await previousRejected;
  assert.equal(host.state().epoch, 1); assert.equal(host.state().version, 1); assert.deepEqual(applied.at(-1), restored);
});

test('failed writes and transfer exceptions restore admission without claiming a preference was applied', async t => {
  const { live } = await setup(t); let failWrite = true, failTransfer = true, errors = 0;
  const applied: SettingsSnapshot[] = [], changes: boolean[] = [];
  const host = createSettingsHostCoordinator({ request: async request => {
    if (request.method === 'settings.update' && failWrite) { failWrite = false; return { protocolVersion: 1, requestId: request.requestId, ok: false, error: { code: 'IO_ERROR' } }; }
    if (request.method === 'backup.restore' && failTransfer) { failTransfer = false; throw new Error('Synthetic transport failure'); }
    return live.dispatch(request);
  }, apply: snapshot => applied.push(structuredClone(snapshot)), onZoomError: () => { errors++; }, onStateChange: state => changes.push(state.maintaining) });
  assert.deepEqual(await host.zoom('in'), { accepted: true, ok: false }); assert.equal(errors, 1); assert.equal(applied.length, 0);
  await assert.rejects(host.dispatch(input('backup.restore', { fileToken: 'fixture', operationId: 'failing-transport' })), /Synthetic transport failure/);
  assert.deepEqual(changes, [true, false]); assert.equal(host.state().maintaining, false);
  assert.deepEqual(await host.zoom('in'), { accepted: true, ok: true }); assert.equal(applied.at(-1)?.values.general.zoomFactor, 1.1);
});
