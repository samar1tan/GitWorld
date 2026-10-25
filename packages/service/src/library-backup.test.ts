import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createLibraryBackup, restoreLibraryBackup, detectLibraryBackup, LIBRARY_BACKUP_MAGIC, LibraryBackupFailure } from './library-backup.ts';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { spawn } from 'node:child_process';
import { recoverLibraryRestore } from './library-backup.ts';
import { createLocalService } from './index.ts';
import { validPackage } from '../../storage/src/test-fixtures.ts';
import type { ServiceMethod, ServiceMethods, ServiceRequest, ResearchRecord, WorkspaceState } from '../../contracts/src/index.ts';
import type { EditorialJson } from '../../contracts/src/editorial-types.ts';
import { modelPath } from './model-store.ts';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const binary = process.env.GITWORLD_TEST_GIT ?? fileURLToPath(new URL('../../../.local/bundled-git/runtime/bin/git', import.meta.url));
async function setup(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'gitworld-full-backup-')), data = path.join(root, 'library'); await mkdir(data);
  const database = new DatabaseSync(path.join(data, 'library.sqlite'));
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE observations(id TEXT PRIMARY KEY, value TEXT); INSERT INTO observations VALUES ('item','Original local state')");
  const dbs = [database];
  t.after(async () => { for (const db of dbs) if (db.isOpen) db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, data, database, dbs, destination: path.join(root, 'library.gitworld') };
}
async function dbValue(file: string) { const database = new DatabaseSync(file, { readOnly: true }); try { return database.prepare('SELECT value FROM observations').get()!.value; } finally { database.close(); } }
function archive(entries: { path: string; body: Buffer; sha256?: string; bytes?: number }[], change: Record<string, unknown> = {}, extra = Buffer.alloc(0)) {
  const files = entries.map(entry => ({ path: entry.path, bytes: entry.bytes ?? entry.body.length, sha256: entry.sha256 ?? sha(entry.body), mode: 0o600 }));
  const manifest = { format: 'gitworld-library-v1', schemaVersion: 1, databaseSchemaVersion: 2, id: randomUUID(), createdAt: new Date().toISOString(), totalBytes: files.reduce((count, file) => count + file.bytes, 0), files, ...change };
  return Buffer.concat([LIBRARY_BACKUP_MAGIC, gzipSync(Buffer.concat([Buffer.from(JSON.stringify(manifest) + '\n'), ...entries.map(entry => entry.body), extra]))]);
}
const invalid = (error: unknown) => error instanceof LibraryBackupFailure && error.code === 'BACKUP_INVALID';
const gitWorkspace = (revisionId: string, id = 'git-workspace'): WorkspaceState => ({
  id, version: 0, dataset: { datasetId: 'test-world', revisionId }, locale: 'en',
  head: { datasetId: 'test-world', revisionId, commitId: 'old', requestedYear: null }, comparison: null,
  view: { panel: 'browse', scopeId: null, processId: null, eventId: null, selectedCommitId: 'old', graphRef: null, timeWindow: [-100, 100], cursor: null, viewport: { x: 0, y: 0, width: 1000, height: 500 } }, trail: [],
});
let requestSequence = 0;
async function call<M extends ServiceMethod>(service: Awaited<ReturnType<typeof createLocalService>>, method: M, params: ServiceMethods[M]['params']): Promise<ServiceMethods[M]['result']> {
  const response = await service.dispatch({ protocolVersion: 1, requestId: `backup-${++requestSequence}`, method, params } as ServiceRequest); assert.ok(response.ok, JSON.stringify(response)); return response.result as ServiceMethods[M]['result'];
}

test('full backup consistently captures active WAL databases and source bytes, without sidecars', async t => {
  const { data, database, root, destination } = await setup(t);
  await mkdir(path.join(data, 'source-archive/job/raw'), { recursive: true }); await writeFile(path.join(data, 'source-archive/job/raw/record.json'), '{"source":"Unmodified input 🌍"}');
  const receipt = await createLibraryBackup({ dataDirectory: data, destinationPath: destination }); assert.equal(receipt.format, 'gitworld-library-v1'); assert.ok(receipt.files >= 2); assert.equal(await detectLibraryBackup(destination), 'full');
  database.exec("UPDATE observations SET value='Changes after backup'");
  const empty = path.join(root, 'empty'); await mkdir(empty); await writeFile(path.join(empty, 'keep-before-restore.txt'), 'Original target contents');
  const restored = await restoreLibraryBackup({ dataDirectory: empty, sourcePath: destination });
  assert.equal(await dbValue(path.join(empty, 'library.sqlite')), 'Original local state');
  assert.equal(await readFile(path.join(empty, 'source-archive/job/raw/record.json'), 'utf8'), '{"source":"Unmodified input 🌍"}');
  assert.equal(await readFile(path.join(restored.beforeRestorePath, 'keep-before-restore.txt'), 'utf8'), 'Original target contents');
  assert.equal(restored.manifest.files.some(entry => /-wal$|-shm$/.test(entry.path)), false);
  assert.equal(receipt.contentHash, sha(await readFile(destination)));
});

test('Git HEAD, frozen index B, working C, operation receipts and research records survive full restore', { skip: !existsSync(binary) && 'Build bundled Git first.' }, async t => {
  const { data, root, destination } = await setup(t);
  const repository = await createEditorialRepository({ dataDirectory: data, gitExecutable: binary }); t.after(() => repository.close());
  await repository.initialize({ 'research/one.json': { title: 'A' } });
  await repository.write([{ path: 'objects/prior.json', value: { note: 'A previously committed research increment' } }]);
  const priorStage = await repository.stage([{ path: 'objects/prior.json' }]);
  const priorInput = { operationId: 'prior-operation', expectedHead: priorStage.head, expectedTree: priorStage.stagedTree, message: 'Record prior object' };
  const priorCommit = await repository.commit(priorInput), original = await repository.status();
  await repository.write([{ path: 'research/one.json', value: { title: 'B' } }]); await repository.stage([{ path: 'research/one.json' }]); await repository.write([{ path: 'research/one.json', value: { title: 'C' } }]);
  await createLibraryBackup({ dataDirectory: data, destinationPath: destination });
  const recoveredDirectory = path.join(root, 'recovered'); await mkdir(recoveredDirectory);
  await restoreLibraryBackup({ dataDirectory: recoveredDirectory, sourcePath: destination });
  const recovered = await createEditorialRepository({ dataDirectory: recoveredDirectory, gitExecutable: binary }); t.after(() => recovered.close());
  const status = await recovered.initialize(); assert.equal(status.head, original.head); assert.equal(status.staged.length, 1); assert.equal(status.unstaged.length, 1);
  assert.equal((await recovered.commit(priorInput)).oid, priorCommit.oid); assert.equal((await recovered.status()).head, original.head); assert.equal((await recovered.status()).staged.length, 1);
  assert.deepEqual(await recovered.read('research/one.json', { from: 'staged' }), { title: 'B' }); assert.deepEqual(await recovered.read('research/one.json'), { title: 'C' });
  const commit = await recovered.commit({ operationId: 'restored-commit', expectedHead: status.head, expectedTree: status.stagedTree, message: 'Record restored staged B' });
  assert.deepEqual(await recovered.read('research/one.json', { from: commit.oid }), { title: 'B' }); assert.deepEqual(await recovered.read('research/one.json'), { title: 'C' });
});

test('source symlinks and hardlinks cannot include files outside the library', async t => {
  const { data, root, destination } = await setup(t), outside = path.join(root, 'outside.json'); await writeFile(outside, '{"outside":true}');
  await symlink(outside, path.join(data, 'linked.json')); await assert.rejects(createLibraryBackup({ dataDirectory: data, destinationPath: destination }), invalid); await rm(path.join(data, 'linked.json'));
  await link(outside, path.join(data, 'hardlinked.json')); await assert.rejects(createLibraryBackup({ dataDirectory: data, destinationPath: destination }), invalid);
});

test('traversal, absolute paths, backslashes, duplicate and case-colliding entries fail before install', async t => {
  const { data, database, root } = await setup(t); database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); const sqlite = await readFile(path.join(data, 'library.sqlite'));
  const badNames = ['../outside.sqlite', '/absolute.sqlite', '..\\outside.sqlite', 'folder/../outside.sqlite'];
  for (const name of badNames) {
    const file = path.join(root, randomUUID()); await writeFile(file, archive([{ path: 'library.sqlite', body: sqlite }, { path: name, body: Buffer.from('bad') }]));
    await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: file }), invalid);
  }
  for (const name of ['library.sqlite', 'LIBRARY.SQLITE']) {
    const file = path.join(root, randomUUID()); await writeFile(file, archive([{ path: 'library.sqlite', body: sqlite }, { path: name, body: sqlite }]));
    await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: file }), invalid);
  }
  assert.equal(await dbValue(path.join(data, 'library.sqlite')), 'Original local state');
});

test('hash mismatch, corrupt SQLite, truncated gzip and trailing decompressed payload preserve the library', async t => {
  const { data, database, root } = await setup(t); database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); const sqlite = await readFile(path.join(data, 'library.sqlite'));
  const valid = archive([{ path: 'library.sqlite', body: sqlite }]);
  const candidates = [archive([{ path: 'library.sqlite', body: sqlite, sha256: '0'.repeat(64) }]), archive([{ path: 'library.sqlite', body: Buffer.from('not SQLite') }]), valid.subarray(0, valid.length - 4), archive([{ path: 'library.sqlite', body: sqlite }], {}, Buffer.from('unexpected trailing data'))];
  let installCalls = 0;
  for (const bytes of candidates) { const file = path.join(root, randomUUID()); await writeFile(file, bytes); await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: file, beforeInstall: async () => { installCalls++; } }), invalid); }
  assert.equal(installCalls, 0); assert.equal(await dbValue(path.join(data, 'library.sqlite')), 'Original local state');
});

test('declared file counts, lengths, header size and expansion budgets are bounded', async t => {
  const { data, database, root } = await setup(t); database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); const sqlite = await readFile(path.join(data, 'library.sqlite'));
  const file = path.join(root, 'large.backup'); await writeFile(file, archive([{ path: 'library.sqlite', body: sqlite }]));
  for (const limits of [{ maxTotalBytes: 100 }, { maxFileBytes: 100 }, { maxHeaderBytes: 20 }]) await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: file, limits }), invalid);
  const truncated = path.join(root, 'length.backup'); await writeFile(truncated, archive([{ path: 'library.sqlite', body: sqlite, bytes: sqlite.length + 1 }])); await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: truncated }), invalid);
});

test('failed application reopen rolls the complete directory back and retains the failed restore', async t => {
  const { data, database, root, destination } = await setup(t); await createLibraryBackup({ dataDirectory: data, destinationPath: destination });
  database.exec("UPDATE observations SET value='Newer local state'");
  const calls: string[] = [];
  await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: destination,
    beforeInstall: async () => { calls.push('close'); database.close(); }, afterInstall: async () => { calls.push('reopen-failed'); throw new Error('Simulated service migration failure'); },
    beforeRollback: async () => { calls.push('close-failed'); }, afterRollback: async () => { calls.push('reopen-original'); },
  }), invalid);
  assert.deepEqual(calls, ['close', 'reopen-failed', 'close-failed', 'reopen-original']);
  assert.equal(await dbValue(path.join(data, 'library.sqlite')), 'Newer local state');
  assert.ok((await readdir(root)).some(name => name.startsWith('library.failed-restore-')));
});

test('a failure while preparing installation reopens the original services without replacing data', async t => {
  const { data, database, destination } = await setup(t); await createLibraryBackup({ dataDirectory: data, destinationPath: destination }); let reopened = false;
  await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: destination, beforeInstall: async () => { database.close(); throw new Error('Preparation stopped'); }, afterRollback: async () => { reopened = true; } }), invalid);
  assert.equal(reopened, true); assert.equal(await dbValue(path.join(data, 'library.sqlite')), 'Original local state');
});

test('format detection distinguishes legacy SQLite and unknown input without installing either', async t => {
  const { data, root } = await setup(t); assert.equal(await detectLibraryBackup(path.join(data, 'library.sqlite')), 'sqlite');
  const file = path.join(root, 'unknown'); await writeFile(file, 'not a backup'); assert.equal(await detectLibraryBackup(file), 'unknown');
  await assert.rejects(restoreLibraryBackup({ dataDirectory: data, sourcePath: file }), invalid);
});

for (const point of ['after-old-rename','after-install-rename','after-restore-commit'] as const) test(`startup recovers complete library directories after process death at ${point}`, async t => {
  const { data, database, destination } = await setup(t); await createLibraryBackup({ dataDirectory: data, destinationPath: destination });
  database.exec("UPDATE observations SET value='Newer local state'"); database.close();
  const module = fileURLToPath(new URL('./library-backup.ts', import.meta.url));
  const code = `import {restoreLibraryBackup} from ${JSON.stringify(module)}; await restoreLibraryBackup({dataDirectory:process.env.TEST_DATA,sourcePath:process.env.TEST_SOURCE,onFault:point=>{if(point===process.env.TEST_POINT)process.kill(process.pid,'SIGKILL')}})`;
  const result = await new Promise<NodeJS.Signals | null>((resolve, reject) => { const processHandle = spawn(process.execPath, ['--input-type=module','--eval',code], { env: { ...process.env, TEST_DATA: data, TEST_SOURCE: destination, TEST_POINT: point }, stdio: 'ignore' }); processHandle.on('error',reject); processHandle.on('exit',(_code,signal)=>resolve(signal)); });
  assert.equal(result, 'SIGKILL');
  const recovered = await recoverLibraryRestore({ dataDirectory: data }); assert.equal(recovered.recovered, true);
  assert.equal(await dbValue(path.join(data, 'library.sqlite')), point === 'after-restore-commit' ? 'Original local state' : 'Newer local state');
  assert.equal((await recoverLibraryRestore({ dataDirectory: data })).recovered, false);
});

test('LocalService full restore retains adopted states, research pins, frozen B/C and idempotent restore receipts', { skip: !existsSync(binary) && 'Build bundled Git first.' }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'gitworld-backup-service-')), seed = path.join(root, 'seed.json'), backup = path.join(root, 'complete.gitworld'); await writeFile(seed, JSON.stringify(validPackage()));
  const services: Awaited<ReturnType<typeof createLocalService>>[] = [];
  const tokens = new Map([['backup', { purpose: 'backup', path: backup }], ['restore', { purpose: 'restore', path: backup }]]);
  // Synthetic source transport only, not real corpus or installed-GUI evidence.
  const sourceFetch: typeof fetch = async input => {
    const ids = new URL(String(input)).searchParams.get('ids')!.split('|');
    const entities = Object.fromEntries(ids.map(id => [id, { id, lastrevid: 1, labels: { en: { language: 'en', value: `Synthetic ${id}` } }, descriptions: {}, aliases: {}, claims: id.startsWith('P') ? {} : { P17: [{ id: `${id}$dated`, rank: 'normal', mainsnak: { property: 'P17', snaktype: 'value', datavalue: { value: { id: 'Q2' } } }, qualifiers: { P585: [{ property: 'P585', snaktype: 'value', datavalue: { value: { time: '+0825-00-00T00:00:00Z', precision: 9, calendarmodel: 'http://www.wikidata.org/entity/Q1985786' } } }] }, references: [] }] } }]));
    return new Response(JSON.stringify({ entities }));
  };
  const options = { dataDirectory: path.join(root, 'library'), seedPackagePath: seed, gitExecutable: binary, sourceFetch, resolveFileToken: (token: string, purpose: string) => tokens.get(token)?.purpose === purpose ? tokens.get(token)!.path : undefined };
  const open = async () => { const service = await createLocalService(options); services.push(service); return service; };
  t.after(async () => { for (const service of services) await service.close(); await rm(root, { recursive: true, force: true }); });
  const service = await open(), acquired = await call(service, 'source.collect', { entityIds: ['Q7001'], operationId: 'fetch' }); assert.ok(acquired.ok);
  const preview = await call(service, 'knowledge.previewJob', { jobId: acquired.value.id }), initial = await call(service, 'repository.status', {});
  await call(service, 'knowledge.adoptJob', { jobId: acquired.value.id, expectedHead: initial.head, expectedInputHash: preview.inputHash, review: 'adopted', operationId: 'adopt' });
  let status = await call(service, 'repository.status', {}); status = await call(service, 'repository.stage', { paths: status.unstaged.map(value => value.path) });
  const material = await call(service, 'repository.commit', { operationId: 'material', expectedHead: status.head, expectedTree: status.stagedTree, message: 'Adopt source material' });
  const note: ResearchRecord = { schemaVersion: 1, id: 'record', title: 'An investigation', scope: { query: 'Synthetic object', objectIds: ['wikidata:Q7001'], fieldIds: ['wikidata:P17'], timeWindow: [800,900] }, interpretation: 'B', openQuestions: [], evidence: [{ id:'evidence',kind:'object',title:'Object',locator:'$',repositoryRevision:material.oid,objectId:'wikidata:Q7001' }], comparison:null,updatedAt:new Date().toISOString() };
  const b = await call(service, 'research.save', { record: note, expectedHash: null }); const staged = await call(service, 'repository.stage', { paths: ['research/record.json'] });
  const c = await call(service, 'research.save', { record: { ...b.record, interpretation:'C' }, expectedHash:b.contentHash });
  const savedWorkspace = await call(service, 'workspace.save', { workspace: gitWorkspace(material.oid), expectedVersion: null });
  await call(service, 'backup.create', { fileToken:'backup',operationId:'backup-full' });
  const later = await call(service, 'repository.commit', { operationId:'later',expectedHead:staged.head,expectedTree:staged.stagedTree,message:'Record B after backup' });
  await call(service, 'research.save', { record:{...c.record,interpretation:'D'},expectedHash:c.contentHash });
  await call(service, 'backup.restore', { fileToken:'restore',operationId:'restore-full' });
  const restored = await call(service, 'repository.status', {}); assert.equal(restored.head,material.oid); assert.equal(restored.staged.length,1); assert.equal(restored.unstaged.length,1);
  assert.equal((await call(service,'research.get',{id:'record'})).record.interpretation,'C');
  assert.equal((await call(service,'knowledge.state',{state:{objectId:'wikidata:Q7001',year:825},revision:material.oid})).fields[0].status,'known');
  assert.equal((await call(service,'source.jobs',{})).jobs.length,1);
  assert.deepEqual(await call(service,'workspace.load',{workspaceId:savedWorkspace.id}),savedWorkspace);
  const committed = await call(service,'repository.commit',{operationId:'after-restore',expectedHead:restored.head,expectedTree:restored.stagedTree,message:'Record restored B'});
  assert.equal((await call(service,'research.readRevision',{id:'record',oid:committed.oid})).record.interpretation,'B');
  await call(service,'backup.restore',{fileToken:'restore',operationId:'restore-full'}); assert.equal((await call(service,'repository.status',{})).head,committed.oid); assert.notEqual(committed.oid,later.oid);
  const payload = gunzipSync((await readFile(backup)).subarray(LIBRARY_BACKUP_MAGIC.length)), newline = payload.indexOf(10), manifest = JSON.parse(payload.subarray(0,newline).toString()); let offset = newline+1;
  const entries = manifest.files.map((entry: {path:string;bytes:number}) => { const body=payload.subarray(offset,offset+entry.bytes);offset+=entry.bytes;return {path:entry.path,body:entry.path==='editorial-owned.json'?Buffer.from('{"schemaVersion":999,"repository":"repository"}'):body}; });
  const invalidOwned=path.join(root,'invalid-owned.gitworld');await writeFile(invalidOwned,archive(entries));tokens.set('invalid-owned',{purpose:'restore',path:invalidOwned});
  const refused=await service.dispatch({protocolVersion:1,requestId:'invalid-owned',method:'backup.restore',params:{fileToken:'invalid-owned',operationId:'reject-unowned-backup'}});assert.equal(refused.ok,false);
  assert.equal((await call(service,'repository.status',{})).head,committed.oid);assert.equal((await call(service,'research.get',{id:'record'})).record.interpretation,'C');
  await service.close(); const restarted=await open(); assert.equal((await call(restarted,'research.get',{id:'record'})).record.evidence[0].repositoryRevision,material.oid);
});

test('maintenance rejects active acquisition, drains prior requests and blocks source cache writes until complete', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'gitworld-maintenance-')),seed=path.join(root,'seed.json'),backup=path.join(root,'complete.gitworld');await writeFile(seed,JSON.stringify(validPackage()));
  let begin!:()=>void;const started=new Promise<void>(resolve=>{begin=resolve;});
  const sourceFetch:typeof fetch=async (_url,options)=>{begin();return new Promise((_resolve,reject)=>{const abort=()=>reject(new Error('Cancelled synthetic request'));if(options?.signal?.aborted)abort();else options?.signal?.addEventListener('abort',abort,{once:true});});};
  const service=await createLocalService({dataDirectory:path.join(root,'library'),seedPackagePath:seed,sourceFetch,resolveFileToken:(token,purpose)=>token==='output'&&purpose==='backup'?backup:undefined});
  t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
  const search=call(service,'source.search',{query:'A source name',language:'en',operationId:'active-search'});await started;
  const blocked=await service.dispatch({protocolVersion:1,requestId:'backup-blocked',method:'backup.create',params:{fileToken:'output',operationId:'deferred-backup'}});assert.ok(!blocked.ok&&blocked.error.code==='OPERATION_IN_PROGRESS');
  await call(service,'operation.cancel',{operationId:'active-search'});const cancelled=await search;assert.ok(!cancelled.ok&&cancelled.error.code==='CANCELLED');
  const saving=call(service,'backup.create',{fileToken:'output',operationId:'deferred-backup'});
  const cacheWrite=await service.dispatch({protocolVersion:1,requestId:'cache-during-maintenance',method:'source.jobs',params:{}});assert.ok(!cacheWrite.ok&&cacheWrite.error.code==='OPERATION_IN_PROGRESS');
  await saving;assert.equal(await detectLibraryBackup(backup),'full');assert.deepEqual((await call(service,'source.jobs',{})).jobs,[]);
});

test('legacy SQLite restore cannot leave an existing Git HEAD attached to unrelated restored data', {skip:!existsSync(binary)&&'Build bundled Git first.'},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'gitworld-legacy-guard-')),data=path.join(root,'library'),seed=path.join(root,'seed.json'),legacy=path.join(root,'legacy.sqlite');await writeFile(seed,JSON.stringify(validPackage()));
  const service=await createLocalService({dataDirectory:data,seedPackagePath:seed,gitExecutable:binary,resolveFileToken:(token,purpose)=>token==='legacy'&&purpose==='restore'?legacy:undefined});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
  const snapshot=new DatabaseSync(path.join(data,'library.sqlite'),{readOnly:true});try{snapshot.exec(`VACUUM INTO '${legacy.replaceAll("'","''")}'`);}finally{snapshot.close();}
  const before=await call(service,'repository.status',{});const rejected=await service.dispatch({protocolVersion:1,requestId:'legacy-restore',method:'backup.restore',params:{fileToken:'legacy',operationId:'legacy'}});
  assert.ok(!rejected.ok&&rejected.error.code==='REVIEW_REQUIRED'&&rejected.error.parameters?.reason==='legacy-sqlite-import-required');assert.equal((await call(service,'repository.status',{})).head,before.head);
});

test('a non-Git complete library retains SQLite-only workspace restoration without Git admission',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'gitworld-backup-no-git-')),seed=path.join(root,'seed.json'),backup=path.join(root,'complete.gitworld');await writeFile(seed,JSON.stringify(validPackage()));
  const source=await createLocalService({dataDirectory:path.join(root,'source'),seedPackagePath:seed,resolveFileToken:(token,purpose)=>token==='backup'&&purpose==='backup'?backup:undefined});
  const target=await createLocalService({dataDirectory:path.join(root,'target'),resolveFileToken:(token,purpose)=>token==='restore'&&purpose==='restore'?backup:undefined});
  t.after(async()=>{await source.close();await target.close();await rm(root,{recursive:true,force:true});});
  const saved=await call(source,'workspace.save',{workspace:gitWorkspace('revision-1','sqlite-only'),expectedVersion:null});
  await call(source,'backup.create',{fileToken:'backup',operationId:'backup-no-git'});await call(target,'backup.restore',{fileToken:'restore',operationId:'restore-no-git'});
  assert.deepEqual(await call(target,'workspace.load',{workspaceId:saved.id}),saved);assert.equal((await call(target,'library.status',{})).datasets[0].activeRevisionId,'revision-1');
  assert.equal(existsSync(path.join(root,'target','repository')),false);
});

test('full backup resolves exact Git workspace packages and rejects invalid candidate references before replacement', {skip:!existsSync(binary)&&'Build bundled Git first.'},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'gitworld-backup-git-workspace-')),library=path.join(root,'library'),seed=path.join(root,'seed.json'),backup=path.join(root,'complete.gitworld');
  await writeFile(seed,JSON.stringify(validPackage()));
  const tokens=new Map([['backup',{purpose:'backup',path:backup}],['restore',{purpose:'restore',path:backup}]]),services:Awaited<ReturnType<typeof createLocalService>>[]=[];
  const options={dataDirectory:library,seedPackagePath:seed,gitExecutable:binary,resolveFileToken:(token:string,purpose:string)=>tokens.get(token)?.purpose===purpose?tokens.get(token)!.path:undefined};
  const open=async(dataDirectory=library)=>{const service=await createLocalService({...options,dataDirectory});services.push(service);return service;};
  t.after(async()=>{for(const service of services)await service.close();await rm(root,{recursive:true,force:true});});
  let service=await open();const old=await call(service,'repository.status',{});
  let pinned=await call(service,'workspace.save',{workspace:gitWorkspace(old.head),expectedVersion:null});
  await service.close();
  const editorial=await createEditorialRepository({dataDirectory:library,gitExecutable:binary});await editorial.initialize();
  const changed=JSON.parse(JSON.stringify(validPackage()).replaceAll('"old"','"later-old"').replaceAll('"new"','"later-new"'));
  await editorial.write([{path:modelPath('test-world'),value:changed as EditorialJson}]);await editorial.stage([{path:modelPath('test-world')}]);const staged=await editorial.status();
  const later=await editorial.commit({operationId:'different-current-model',message:'Change the current historical model',expectedHead:staged.head,expectedTree:staged.stagedTree});await editorial.close();
  service=await open();
  const reference={datasetId:'test-world',revisionId:later.oid,commitId:'later-new',requestedYear:null};
  pinned=await call(service,'workspace.save',{workspace:{...pinned,comparison:[pinned.head!,reference]},expectedVersion:pinned.version});
  const working=await call(service,'workspace.save',{workspace:{...gitWorkspace('working','working-workspace'),head:null,view:{...gitWorkspace('working').view,selectedCommitId:'later-old'}},expectedVersion:null});
  assert.notDeepEqual((await call(service,'model.read',{datasetId:'test-world',revision:old.head})).package.history.commits,(await call(service,'model.read',{datasetId:'test-world',revision:later.oid})).package.history.commits);
  await call(service,'backup.create',{fileToken:'backup',operationId:'backup-exact-workspace'});await service.close();
  const target=await open(path.join(root,'empty-target'));
  await call(target,'backup.restore',{fileToken:'restore',operationId:'restore-exact-workspace'});
  assert.deepEqual(await call(target,'workspace.load',{workspaceId:pinned.id}),pinned);assert.deepEqual(await call(target,'workspace.load',{workspaceId:working.id}),working);
  assert.equal((await call(target,'model.read',{datasetId:'test-world',revision:pinned.dataset.revisionId})).package.history.commits[0].id,'old');
  assert.equal((await call(target,'model.read',{datasetId:'test-world',revision:'working'})).package.history.commits[0].id,'later-old');
  const before=await call(target,'repository.status',{});
  async function unbornCandidate(directory:string,workspaces:'working'|'none'|'sqlite'){
    const db=new DatabaseSync(path.join(directory,'library.sqlite'));try{
      if(workspaces==='none')db.exec('DELETE FROM workspaces');
      else if(workspaces==='working')db.prepare('DELETE FROM workspaces WHERE id<>?').run(working.id);
      else for(const row of db.prepare('SELECT id,state_json FROM workspaces').all()){const state=JSON.parse(String(row.state_json));state.dataset={datasetId:'test-world',revisionId:'revision-1'};state.head={...state.dataset,commitId:'old',requestedYear:null};state.comparison=null;state.view=gitWorkspace('revision-1').view;db.prepare('UPDATE workspaces SET dataset_id=?,revision_id=?,state_json=? WHERE id=?').run(state.dataset.datasetId,state.dataset.revisionId,JSON.stringify(state),row.id);}
    }finally{db.close();}
    const gitDir=path.join(directory,'repository','.git'),head=await readFile(path.join(gitDir,'HEAD'),'utf8');assert.ok(head.startsWith('ref: refs/heads/'));
    await mkdir(path.join(gitDir,'refs','tags'),{recursive:true});await writeFile(path.join(gitDir,'refs','tags','preserved'),before.head+'\n');await rm(path.join(gitDir,head.slice(5).trim()));
  }
  type Corruption={name:string;workspace?:string;change?:(value:WorkspaceState)=>WorkspaceState;file?:(directory:string)=>Promise<void>};
  const corruptions:Corruption[]=[
    {name:'missing-git-oid',change:value=>({...value,dataset:{...value.dataset,revisionId:'f'.repeat(40)},head:null,comparison:null})},
    {name:'wrong-dataset',change:value=>({...value,dataset:{...value.dataset,datasetId:'another-dataset'},head:null,comparison:null})},
    {name:'dangling-historical-ref',change:value=>({...value,head:{...value.head!,commitId:'missing-historical-commit'}})},
    {name:'missing-comparison-oid',change:value=>({...value,comparison:[value.comparison![0],{...value.comparison![1],revisionId:'e'.repeat(40)}]})},
    {name:'malformed-workspace',change:value=>({...value,view:null}as unknown as WorkspaceState)},
    {name:'working-head-ref',workspace:working.id,change:value=>({...value,head:{datasetId:'test-world',revisionId:'working',commitId:'later-old',requestedYear:null}})},
    {name:'missing-working-model',file:directory=>rm(path.join(directory,'repository',modelPath('test-world')))},
    {name:'wrong-model-identity',file:async directory=>{const file=path.join(directory,'repository',modelPath('test-world')),value=JSON.parse(await readFile(file,'utf8'));value.dataset.id='other';value.history.datasetId='other';await writeFile(file,JSON.stringify(value));}},
    {name:'missing-git-history',file:directory=>rm(path.join(directory,'repository','.git','HEAD'))},
    {name:'unborn-with-tag-working-workspace',file:directory=>unbornCandidate(directory,'working')},
    {name:'unborn-with-tag-no-workspaces',file:directory=>unbornCandidate(directory,'none')},
    {name:'unborn-with-tag-sqlite-workspaces',file:directory=>unbornCandidate(directory,'sqlite')},
  ];
  for(const corruption of corruptions)await t.test(corruption.name,async()=>{
    const candidate=path.join(root,'candidate-'+corruption.name),badBackup=path.join(root,corruption.name+'.gitworld');await cp(library,candidate,{recursive:true});
    if(corruption.change){const db=new DatabaseSync(path.join(candidate,'library.sqlite'));try{const id=corruption.workspace??pinned.id,row=db.prepare('SELECT state_json FROM workspaces WHERE id=?').get(id)!;db.prepare('UPDATE workspaces SET state_json=? WHERE id=?').run(JSON.stringify(corruption.change(JSON.parse(String(row.state_json)))),id);}finally{db.close();}}
    await corruption.file?.(candidate);
    await createLibraryBackup({dataDirectory:candidate,destinationPath:badBackup});tokens.set(corruption.name,{purpose:'restore',path:badBackup});
    const rejected=await target.dispatch({protocolVersion:1,requestId:corruption.name,method:'backup.restore',params:{fileToken:corruption.name,operationId:'reject-'+corruption.name}});
    assert.ok(!rejected.ok&&rejected.error.code==='BACKUP_INVALID',JSON.stringify(rejected));
    assert.deepEqual(await call(target,'repository.status',{}),before);assert.deepEqual(await call(target,'workspace.load',{workspaceId:pinned.id}),pinned);
  });
});
