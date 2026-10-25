import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createClientStateStore } from './client-state.ts';
import { createLocalService } from './index.ts';
import { createLibraryBackup } from './library-backup.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest } from '../../contracts/src/index.ts';

test('local interface state survives reopening without entering authored history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-client-state-'));
  try {
    const store = createClientStateStore(directory);
    assert.equal(await store.load('onboarding'), null);
    const entry = await store.save({ key: 'onboarding', expectedVersion: null, value: { paused: true, completed: ['scope'] } });
    assert.deepEqual(await createClientStateStore(directory).load('onboarding'), entry);
    assert.equal((await store.save({ key: 'onboarding', expectedVersion: 1, value: entry.value })).version, 1);
    await assert.rejects(store.save({ key: 'onboarding', expectedVersion: null, value: {} }), /CONFLICT/);
    const recovery = await store.save({ key: 'research-input', expectedVersion: null, value: { text: '未完成的研究' } });
    assert.equal(recovery.version, 1);
    assert.deepEqual(await store.load('onboarding'), entry);
    assert.equal((await store.save({ key: 'research-input', expectedVersion: 1, value: null })).value, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid or corrupted preferences cannot silently erase existing input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-client-state-'));
  try {
    const store = createClientStateStore(directory);
    await store.save({ key: 'research-input', expectedVersion: null, value: 'draft' });
    const before = await readFile(path.join(directory, 'client-state.json'), 'utf8');
    await assert.rejects(store.save({ key: '../private' as never, expectedVersion: null, value: {} }), /INVALID_REQUEST/);
    await assert.rejects(store.save({ key: 'research-input', expectedVersion: 1, value: 'x'.repeat(2_100_001) }), /INVALID_REQUEST/);
    assert.equal(await readFile(path.join(directory, 'client-state.json'), 'utf8'), before);
    await writeFile(path.join(directory, 'client-state.json'), '{broken');
    await assert.rejects(store.save({ key: 'onboarding', expectedVersion: null, value: {} }));
    assert.equal(await readFile(path.join(directory, 'client-state.json'), 'utf8'), '{broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('complete restore validates configuration before replacing a usable library', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-client-restore-'));
  const sourcePath = path.join(directory, 'source'), targetPath = path.join(directory, 'target'), backupPath = path.join(directory, 'saved.gitworld');
  const source = await createLocalService({ dataDirectory: sourcePath, resolveFileToken: () => backupPath });
  const target = await createLocalService({ dataDirectory: targetPath, resolveFileToken: () => backupPath });
  let sequence = 0;
  async function call<M extends ServiceMethod>(service: typeof source, method: M, params: ServiceMethods[M]['params']) {
    return service.dispatch({ protocolVersion: 1, requestId: `client-test-${++sequence}`, method, params } as ServiceRequest);
  }
  try {
    assert.equal((await call(source, 'clientState.save', { key: 'onboarding', expectedVersion: null, value: { paused: true } })).ok, true);
    assert.equal((await call(target, 'clientState.save', { key: 'locale', expectedVersion: null, value: 'zh-CN' })).ok, true);
    await source.close();
    const original = await readFile(path.join(sourcePath, 'client-state.json'), 'utf8');
    await writeFile(path.join(sourcePath, 'client-state.json'), '{broken');
    await createLibraryBackup({ dataDirectory: sourcePath, destinationPath: backupPath });
    const rejected = await call(target, 'backup.restore', { fileToken: 'restore-token', operationId: 'invalid-client-state' });
    assert.equal(rejected.ok, false); if (!rejected.ok) assert.equal(rejected.error.code, 'BACKUP_INVALID');
    const retained = await call(target, 'clientState.load', { key: 'locale' }); assert.equal(retained.ok, true);
    if (retained.ok) assert.equal((retained.result as { value: string }).value, 'zh-CN');
    await writeFile(path.join(sourcePath, 'client-state.json'), original);
    await createLibraryBackup({ dataDirectory: sourcePath, destinationPath: backupPath });
    assert.equal((await call(target, 'backup.restore', { fileToken: 'restore-token', operationId: 'valid-client-state' })).ok, true);
    const recovered = await call(target, 'clientState.load', { key: 'onboarding' }); assert.equal(recovered.ok, true);
    if (recovered.ok) assert.deepEqual((recovered.result as { value: unknown }).value, { paused: true });
  } finally { await source.close(); await target.close(); await rm(directory, { recursive: true, force: true }); }
});
