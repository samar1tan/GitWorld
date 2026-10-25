import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSettingsStore, SettingsFailure } from './settings.ts';
import { createLocalService } from './index.ts';
import { createLibraryBackup } from './library-backup.ts';
import { defaultSettingsValues } from '../../contracts/src/settings-types.ts';
import { validateServiceRequest, type ResearchRecord, type ServiceMethod, type ServiceMethods, type ServiceRequest } from '../../contracts/src/index.ts';

const binary = process.env.GITWORLD_TEST_GIT ?? fileURLToPath(new URL('../../../.local/bundled-git/runtime/bin/git', import.meta.url));
const native = { skip: !existsSync(binary) && 'Build the pinned bundled Git to verify configured commit identity.' };
async function directory(t: { after(fn: () => unknown): void }) { const directory = await mkdtemp(path.join(tmpdir(), 'gitworld-settings-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test('settings migrate existing locale/tips, isolate section writes and retain versions across reopening', async t => {
  const root = await directory(t), settings = createSettingsStore(root, { legacy: async () => ({ locale: 'zh-CN', tipsEnabled: false }) });
  const initial = await settings.load(); assert.equal(initial.version, 0); assert.equal(initial.values.general.locale, 'zh-CN'); assert.equal(initial.values.learning.tipsEnabled, false);
  const contributor = { name: '张 研究者', email: 'researcher@gitworld.invalid' };
  const saved = await settings.update({ section: 'contributor', expectedVersion: 0, value: contributor });
  assert.equal(saved.version, 1); assert.deepEqual(saved.values.contributor, contributor); assert.equal(saved.values.general.locale, 'zh-CN');
  assert.deepEqual(await createSettingsStore(root).load(), saved);
  assert.equal((await settings.update({ section: 'contributor', expectedVersion: 1, value: contributor })).version, 1);
  const info = await settings.library(); assert.equal(info.location, root); assert.equal(info.files, 1); assert.ok(info.bytes > 0);
});

test('two settings editors cannot overwrite a newer contributor pair through the same base version', async t => {
  const root = await directory(t), first = createSettingsStore(root), second = createSettingsStore(root);
  const results = await Promise.allSettled([
    first.update({ section: 'contributor', expectedVersion: 0, value: { name: 'Editor A', email: 'a@gitworld.invalid' } }),
    second.update({ section: 'contributor', expectedVersion: 0, value: { name: 'Editor B', email: 'b@gitworld.invalid' } }),
  ]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected' && value.reason instanceof SettingsFailure && value.reason.code === 'CONFLICT').length, 1);
  assert.deepEqual((await first.load()).values.contributor, { name: 'Editor A', email: 'a@gitworld.invalid' });
});

test('invalid settings and Git header controls are rejected without replacing valid saved values', async t => {
  const root = await directory(t), settings = createSettingsStore(root);
  await settings.update({ section: 'learning', expectedVersion: 0, value: { tipsEnabled: false } });
  const file = path.join(root, 'library-settings.json'), before = await readFile(file, 'utf8');
  const invalid = [
    { section: 'general', expectedVersion: 1, value: { ...defaultSettingsValues().general, zoomFactor: 10 } },
    { section: 'contributor', expectedVersion: 1, value: { name: 'Name\ncommitter injected', email: 'valid@local.invalid' } },
    { section: 'contributor', expectedVersion: 1, value: { name: 'Unicode name', email: 'bad\0@local.invalid' } },
    { section: 'contributor', expectedVersion: 1, value: { name: 'Hidden\u0085header', email: 'valid@local.invalid' } },
    { section: 'contributor', expectedVersion: 1, value: { name: 'Name', email: 'two@@local.invalid' } },
    { section: 'learning', expectedVersion: 1, value: { tipsEnabled: true, path: '/private' } },
    { section: { toString: 'not an enum' }, expectedVersion: 1, value: {} },
    { section: 'general', expectedVersion: 1, value: { ...defaultSettingsValues().general, locale: { toString: 'not a locale' } } },
  ];
  for (const input of invalid) {
    const request = { protocolVersion: 1, requestId: 'invalid-settings', method: 'settings.update', params: input };
    assert.equal(validateServiceRequest(request).ok, false);
    await assert.rejects(settings.update(input as never), error => error instanceof SettingsFailure && error.code === 'INVALID_REQUEST');
  }
  assert.equal(await readFile(file, 'utf8'), before);
});

test('a failed atomic settings write preserves the previous profile and removes its temporary file', async t => {
  const root = await directory(t), stable = createSettingsStore(root);
  const saved = await stable.update({ section: 'contributor', expectedVersion: 0, value: { name: 'Previous', email: 'previous@local.invalid' } });
  const failing = createSettingsStore(root, { beforeInstall: () => { throw new Error('Synthetic write failure'); } });
  await assert.rejects(failing.update({ section: 'contributor', expectedVersion: 1, value: { name: 'New', email: 'new@local.invalid' } }), error => error instanceof SettingsFailure && error.code === 'IO_ERROR');
  assert.deepEqual(await stable.load(), saved); assert.deepEqual(await readdir(root), ['library-settings.json']);
});

test('corrupt settings are preserved rather than silently replaced by defaults', async t => {
  const root = await directory(t), file = path.join(root, 'library-settings.json'); await writeFile(file, '{broken');
  const settings = createSettingsStore(root);
  await assert.rejects(settings.load(), error => error instanceof SettingsFailure && error.code === 'SETTINGS_INVALID');
  await assert.rejects(settings.update({ section: 'learning', expectedVersion: 0, value: { tipsEnabled: false } }));
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

let sequence = 0;
async function call<M extends ServiceMethod>(service: Awaited<ReturnType<typeof createLocalService>>, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const response = await service.dispatch({ protocolVersion: 1, requestId: `settings-${++sequence}`, method, params } as ServiceRequest);
  assert.ok(response.ok, JSON.stringify(response)); return response.result as ServiceMethods[M]['result'];
}
const record = (): ResearchRecord => ({ schemaVersion: 1, id: 'settings-identity', title: 'A synthetic identity test', scope: { query: '', timeWindow: null, objectIds: [], fieldIds: [] }, interpretation: 'First interpretation', openQuestions: [], evidence: [], comparison: null, updatedAt: new Date().toISOString() });

test('configured local identity affects new commits and survives full restore without rewriting prior authors', native, async t => {
  const root = await directory(t), dataDirectory = path.join(root, 'library'), backup = path.join(root, 'complete.gitworld');
  const options = { dataDirectory, gitExecutable: binary, gitExecPath: path.resolve(binary, '../../libexec/git-core'), resolveFileToken: () => backup };
  let service = await createLocalService(options); t.after(async () => { await service.close(); });
  const initial = await call(service, 'repository.log', {}), initialHead = initial[0].oid;
  const profile = await call(service, 'settings.get', {}), author = { name: '李 研究者', email: 'local-contributor@gitworld.invalid' };
  const configured = await call(service, 'settings.update', { section: 'contributor', expectedVersion: profile.version, value: author });
  await call(service, 'settings.update', { section: 'general', expectedVersion: configured.version, value: { locale: 'zh-CN', zoomFactor: 1.25, reducedMotion: 'reduce', startup: 'world' } });
  assert.equal((await call(service, 'repository.status', {})).head, initialHead); assert.equal((await call(service, 'repository.status', {})).unstaged.length, 0);
  await call(service, 'research.save', { record: record(), expectedHash: null });
  const staged = await call(service, 'repository.stage', { paths: ['research/settings-identity.json'] });
  const input = { operationId: 'configured-author', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record the local interpretation' };
  const committed = await call(service, 'repository.commit', input); assert.deepEqual(committed.author, author);
  const beforeBackup = await call(service, 'settings.get', {});
  await call(service, 'backup.create', { fileToken: 'output', operationId: 'profile-backup' });
  await call(service, 'settings.update', { section: 'contributor', expectedVersion: beforeBackup.version, value: { name: 'Later author', email: 'later@local.invalid' } });
  assert.deepEqual((await call(service, 'repository.commit', input)).author, author);
  const history = await call(service, 'repository.log', {}); assert.deepEqual(history.find(value => value.oid === initialHead)?.author, initial[0].author);
  await call(service, 'backup.restore', { fileToken: 'input', operationId: 'profile-restore' });
  assert.deepEqual(await call(service, 'settings.get', {}), beforeBackup);
  assert.equal((await call(service, 'repository.status', {})).head, committed.oid);
  await service.close(); service = await createLocalService(options);
  assert.deepEqual(await call(service, 'settings.get', {}), beforeBackup);
  assert.deepEqual((await call(service, 'repository.log', {}))[0].author, author);
});

test('full restore rejects an invalid settings profile before replacing the active library', async t => {
  const root = await directory(t), sourceDirectory = path.join(root, 'source'), targetDirectory = path.join(root, 'target'), backup = path.join(root, 'invalid.gitworld');
  const source = await createLocalService({ dataDirectory: sourceDirectory, resolveFileToken: () => backup });
  const target = await createLocalService({ dataDirectory: targetDirectory, resolveFileToken: () => backup });
  t.after(async () => { await source.close(); await target.close(); });
  const retained = await call(target, 'settings.update', { section: 'contributor', expectedVersion: 0, value: { name: 'Keep me', email: 'keep@local.invalid' } });
  await source.close(); await writeFile(path.join(sourceDirectory, 'library-settings.json'), JSON.stringify({ schemaVersion: 1, version: 1, values: { ...defaultSettingsValues(), contributor: { name: 'Broken\nheader', email: 'valid@local.invalid' } } }));
  await createLibraryBackup({ dataDirectory: sourceDirectory, destinationPath: backup });
  const rejected = await target.dispatch({ protocolVersion: 1, requestId: 'invalid-settings-restore', method: 'backup.restore', params: { fileToken: 'input', operationId: 'invalid-profile' } });
  assert.ok(!rejected.ok && rejected.error.code === 'BACKUP_INVALID');
  assert.deepEqual(await call(target, 'settings.get', {}), retained);
});
