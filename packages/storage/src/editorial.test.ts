import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createEditorialRepository, EditorialFailure } from './editorial.ts';
import type { EditorialRepository } from '../../contracts/src/editorial-types.ts';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const candidates = [process.env.GITWORLD_TEST_GIT, path.join(project, '.local/bundled-git/runtime/bin/git'), path.join(project, '.local/git-spike/relocated/GitWorld Resources/git/bin/git')].filter((value): value is string => !!value);
const binary = candidates.find(existsSync);
const options = { skip: !binary && 'Build the pinned bundled Git before running native repository integration tests.' };
const source = fileURLToPath(new URL('./editorial.ts', import.meta.url));
const failed = (code: string) => (error: unknown) => error instanceof EditorialFailure && error.code === code;
async function setup(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'gitworld-editorial-'));
  const opened: EditorialRepository[] = [];
  const open = async (extra = {}) => { const repo = await createEditorialRepository({ dataDirectory: root, gitExecutable: binary!, ...extra }); opened.push(repo); return repo; };
  t.after(async () => { for (const repo of opened) await repo.close(); await rm(root, { recursive: true, force: true }); });
  const repo = await open(); await repo.initialize({ 'research/one.json': { title: 'A', note: 'Original' } });
  return { root, repo, open };
}
async function save(repo: EditorialRepository, title: string, operationId: string, name = 'research/one.json') {
  await repo.write([{ path: name, value: { title, note: 'Original' } }]);
  const staged = await repo.stage([{ path: name }]);
  return repo.commit({ operationId, expectedHead: staged.head, expectedTree: staged.stagedTree, message: `Record ${title}` });
}

test('candidate admission requires an existing HEAD commit and never fabricates refs from an unborn branch', options, async t => {
  const {root,repo,open}=await setup(t),original=await repo.status();await repo.close();
  const admitted=await open({requireExistingHead:true});assert.equal((await admitted.initialize()).head,original.head);await admitted.close();
  const gitDir=path.join(root,'repository','.git'),head=await readFile(path.join(gitDir,'HEAD'),'utf8');assert.ok(head.startsWith('ref: refs/heads/'));
  await mkdir(path.join(gitDir,'refs','tags'),{recursive:true});await writeFile(path.join(gitDir,'refs','tags','preserved'),original.head+'\n');await rm(path.join(gitDir,head.slice(5).trim()));
  async function refs(directory=path.join(gitDir,'refs'),prefix=''):Promise<{path:string;text:string}[]>{const result:{path:string;text:string}[]=[];for(const entry of(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(directory,entry.name),name=prefix+entry.name;if(entry.isDirectory())result.push(...await refs(file,name+'/'));else result.push({path:name,text:await readFile(file,'utf8')});}return result;}
  const before=await refs(),candidate=await open({requireExistingHead:true});
  await assert.rejects(candidate.initialize(),failed('NOT_FOUND'));
  assert.equal(await readFile(path.join(gitDir,'HEAD'),'utf8'),head);assert.deepEqual(await refs(),before);assert.equal(existsSync(path.join(gitDir,head.slice(5).trim())),false);
});
function child(code: string, environment: Record<string, string> = {}) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }>((resolve, reject) => {
    const processHandle = spawn(process.execPath, ['--input-type=module', '--eval', code], { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; processHandle.stdout.on('data', chunk => chunks.push(chunk)); processHandle.stderr.resume();
    processHandle.on('error', reject); processHandle.on('exit', (code, signal) => resolve({ code, signal, stdout: Buffer.concat(chunks).toString() }));
  });
}

test('real Git index freezes B while working C survives the commit and restart', options, async t => {
  const { repo, open } = await setup(t);
  await repo.write([{ path: 'research/one.json', value: { title: 'B', note: 'Original' } }]);
  const staged = await repo.stage([{ path: 'research/one.json' }]);
  await repo.write([{ path: 'research/one.json', value: { title: 'C', note: 'Still working' } }]);
  const commit = await repo.commit({ operationId: 'stage-B', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Adopt the selected evidence' });
  assert.deepEqual(await repo.read('research/one.json', { from: commit.oid }), { title: 'B', note: 'Original' });
  assert.deepEqual(await repo.read('research/one.json'), { title: 'C', note: 'Still working' });
  assert.equal((await repo.status()).staged.length, 0); assert.equal((await repo.status()).unstaged.length, 1);
  await repo.close(); const restarted = await open(); await restarted.initialize({ 'research/one.json': { title: 'MUST NOT OVERWRITE' } });
  assert.deepEqual(await restarted.read('research/one.json'), { title: 'C', note: 'Still working' });
  assert.equal((await restarted.status()).head, commit.oid);
});

test('selected JSON fields can be frozen independently of subsequent working edits', options, async t => {
  const { repo } = await setup(t);
  await repo.write([{ path: 'research/one.json', value: { title: 'B', note: 'New working note' } }]);
  const staged = await repo.stage([{ path: 'research/one.json', value: { title: 'B', note: 'Original' } }]);
  const commit = await repo.commit({ operationId: 'title-only', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Record only the title' });
  assert.deepEqual(await repo.read('research/one.json', { from: commit.oid }), { title: 'B', note: 'Original' });
  assert.deepEqual(await repo.read('research/one.json'), { title: 'B', note: 'New working note' });
  assert.deepEqual(await repo.list({ from: commit.oid, prefix: 'research' }), ['research/one.json']);
});

test('batched snapshots pin a staged tree and preserve multibyte JSON across later index changes', options, async t => {
  const { repo } = await setup(t);
  await repo.write([{ path: 'objects/one.json', value: { label: '研究对象 🌍\n第二行', quoted: '"text"' } }, { path: 'research/one.json', value: { title: 'B' } }]);
  const staged = await repo.stage([{ path: 'objects/one.json' }, { path: 'research/one.json' }]);
  const pinned = await repo.snapshot({ from: 'staged', prefixes: ['research/', 'objects/'] });
  assert.equal(pinned.tree, staged.stagedTree); assert.equal(pinned.head, staged.head);
  assert.deepEqual(pinned.files['objects/one.json'], { label: '研究对象 🌍\n第二行', quoted: '"text"' });
  await repo.stage([{ path: 'research/one.json', value: { title: 'D' } }]);
  const older = await repo.snapshot({ from: `tree:${staged.stagedTree}`, prefixes: ['research/'] });
  assert.deepEqual(older.files['research/one.json'], { title: 'B' });
  assert.deepEqual(await repo.read('research/one.json', { from: `tree:${staged.stagedTree}` }), { title: 'B' });
  await assert.rejects(repo.read('research/one.json', { from: staged.stagedTree }), failed('NOT_FOUND'));
  assert.deepEqual(await repo.list({ prefix: 'objects/o' }), ['objects/one.json']);
});

test('unstaging a new object preserves the working file and excludes it from a commit', options, async t => {
  const { repo } = await setup(t);
  await repo.write([{ path: 'objects/new.json', value: { id: 'A new object' } }]); await repo.stage([{ path: 'objects/new.json' }]);
  const status = await repo.unstage(['objects/new.json']);
  assert.equal(status.staged.length, 0); assert.equal(status.unstaged[0].path, 'objects/new.json');
  assert.deepEqual(await repo.read('objects/new.json'), { id: 'A new object' });
  assert.equal(await repo.read('objects/new.json', { from: 'staged' }), null);
  await assert.rejects(repo.commit({ operationId: 'empty', expectedHead: status.head, message: 'Empty' }), failed('NOTHING_STAGED'));
});

test('a failed batch selection does not partially replace the Git index', options, async t => {
  const { repo } = await setup(t); await repo.write([{ path: 'research/one.json', value: { title: 'B' } }]);
  await assert.rejects(repo.stage([{ path: 'research/one.json' }, { path: '../unsafe.json', value: { title: 'Unsafe' } }]), failed('INVALID_PATH'));
  assert.equal((await repo.status()).staged.length, 0);
  assert.deepEqual(await repo.read('research/one.json', { from: 'staged' }), { title: 'A', note: 'Original' });
});

test('content compare-and-swap is checked within the repository writer coordination', options, async t => {
  const { repo } = await setup(t), expected = createHash('sha256').update('{"note":"Original","title":"A"}').digest('hex');
  const results = await Promise.allSettled([
    repo.write([{ path: 'research/one.json', value: { title: 'B' } }], { expectedContentHashes: { 'research/one.json': expected } }),
    repo.write([{ path: 'research/one.json', value: { title: 'C' } }], { expectedContentHashes: { 'research/one.json': expected } }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && failed('CONTENT_CHANGED')(result.reason)).length, 1);
  assert.deepEqual(await repo.read('research/one.json'), { title: 'B' });
});

test('stale HEAD and staged-tree guards cannot overwrite or commit changed selections', options, async t => {
  const { repo } = await setup(t);
  const original = await repo.status(); await save(repo, 'B', 'B');
  await repo.write([{ path: 'research/one.json', value: { title: 'C' } }]); const staged = await repo.stage([{ path: 'research/one.json' }]);
  await assert.rejects(repo.commit({ operationId: 'old-base', expectedHead: original.head, message: 'Old base' }), failed('HEAD_CHANGED'));
  await repo.stage([{ path: 'research/one.json', value: { title: 'D' } }]);
  await assert.rejects(repo.commit({ operationId: 'old-selection', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Old selection' }), failed('STAGE_CHANGED'));
});

test('idempotent commit retries retain their OID and do not rewind newer revisions', options, async t => {
  const { repo } = await setup(t);
  await repo.write([{ path: 'research/one.json', value: { title: 'B' } }]); const staged = await repo.stage([{ path: 'research/one.json' }]);
  const input = { operationId: 'repeat', expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'A literal $(command); `text`\nwith a second line' };
  const first = await repo.commit(input); const newer = await save(repo, 'C', 'newer');
  assert.equal((await repo.commit(input)).oid, first.oid); assert.equal((await repo.status()).head, newer.oid);
  await assert.rejects(repo.commit({ ...input, message: 'Another operation' }), failed('IDEMPOTENCY_CONFLICT'));
  assert.equal((await repo.log())[1].message, input.message);
});

test('editorial branches are independent and detached commits require an explicit new branch', options, async t => {
  const { repo } = await setup(t), original = await repo.status();
  await repo.createBranch('research/alternate'); await repo.switchBranch('research/alternate'); const other = await save(repo, 'B', 'branch-B');
  await repo.switchBranch('main'); assert.equal((await repo.status()).head, original.head);
  await repo.checkoutDetached(other.oid); assert.equal((await repo.status()).branch, null);
  await repo.write([{ path: 'research/one.json', value: { title: 'C' } }]); const staged = await repo.stage([{ path: 'research/one.json' }]);
  await assert.rejects(repo.commit({ operationId: 'detached', expectedHead: staged.head, message: 'Detached' }), failed('DETACHED_HEAD'));
  await repo.createBranch('research/continued'); await repo.switchBranch('research/continued');
  assert.equal((await repo.commit({ operationId: 'attached', expectedHead: staged.head, message: 'Continue research' })).branch, 'research/continued');
});

test('revert stages an inverse while preserving later independent objects and can be committed', options, async t => {
  const { repo } = await setup(t); const changed = await save(repo, 'B', 'B'); await save(repo, 'Later independent object', 'independent', 'objects/later.json');
  const current = await repo.status(); const reverted = await repo.revert({ operationId: 'undo-B', expectedHead: current.head, commitOid: changed.oid });
  assert.equal(reverted.head, current.head); assert.equal(reverted.staged.length, 1); assert.equal(reverted.revert?.commitOid, changed.oid);
  const committed = await repo.commit({ operationId: 'commit-undo', expectedHead: current.head, expectedTree: reverted.stagedTree, message: 'Revise earlier interpretation' });
  assert.deepEqual(await repo.read('research/one.json', { from: committed.oid }), { title: 'A', note: 'Original' });
  assert.deepEqual(await repo.read('objects/later.json'), { title: 'Later independent object', note: 'Original' });
  assert.equal((await repo.status()).revert, null);
});

test('overlapping revert conflicts keep HEAD fixed and abort restores the original clean tree', options, async t => {
  const { repo } = await setup(t); const changed = await save(repo, 'B', 'B'); await save(repo, 'C', 'C'); const before = await repo.status();
  const conflicted = await repo.revert({ operationId: 'conflicting-revert', expectedHead: before.head, commitOid: changed.oid });
  assert.deepEqual(conflicted.conflicts, ['research/one.json']); assert.equal(conflicted.head, before.head);
  await assert.rejects(repo.commit({ operationId: 'unresolved', expectedHead: before.head, message: 'Cannot commit conflict' }), failed('REVERT_CONFLICT'));
  const aborted = await repo.abortRevert(); assert.equal(aborted.head, before.head); assert.equal(aborted.staged.length, 0); assert.equal(aborted.unstaged.length, 0);
  assert.deepEqual(await repo.read('research/one.json'), { title: 'C', note: 'Original' });
});

test('a resolved revert replaces unmerged index stages with the explicit selected JSON', options, async t => {
  const { repo } = await setup(t); const changed = await save(repo, 'B', 'B'); await save(repo, 'C', 'C'); const before = await repo.status();
  await repo.revert({ operationId: 'resolve-revert', expectedHead: before.head, commitOid: changed.oid });
  await repo.write([{ path: 'research/one.json', value: { title: 'Explicit resolution' } }]); const staged = await repo.stage([{ path: 'research/one.json' }]);
  assert.deepEqual(staged.conflicts, []);
  const committed = await repo.commit({ operationId: 'commit-resolution', expectedHead: before.head, expectedTree: staged.stagedTree, message: 'Resolve the interpretation explicitly' });
  assert.deepEqual(await repo.read('research/one.json', { from: committed.oid }), { title: 'Explicit resolution' });
});

test('unknown repositories, traversal, non-JSON paths and filesystem symlinks fail closed', options, async t => {
  const { root, repo } = await setup(t);
  for (const name of ['../outside.json', '.git/config.json', 'research/../outside.json', 'notes/shell.sh', 'research/.hidden.json']) await assert.rejects(repo.read(name), failed('INVALID_PATH'));
  const external = path.join(root, 'external.json'); await writeFile(external, '{"private":"outside"}'); await mkdir(path.join(root, 'repository/objects'), { recursive: true }); await symlink(external, path.join(root, 'repository/objects/link.json'));
  await assert.rejects(repo.read('objects/link.json'));
  const another = path.join(root, 'unowned'); await mkdir(path.join(another, 'repository'), { recursive: true });
  const foreign = await createEditorialRepository({ dataDirectory: another, gitExecutable: binary! }); t.after(() => foreign.close());
  await assert.rejects(foreign.initialize(), failed('UNOWNED_REPOSITORY'));
});

for (const point of ['after-object', 'before-ref', 'after-ref', 'after-receipt'] as const) {
  test(`process death at ${point} resumes one commit and retains the unstaged edit`, options, async t => {
    const { root, repo, open } = await setup(t);
    await repo.write([{ path: 'research/one.json', value: { title: 'B' } }]); const staged = await repo.stage([{ path: 'research/one.json' }]); await repo.write([{ path: 'research/one.json', value: { title: 'C' } }]);
    await repo.close();
    const input = { operationId: `crash-${point}`, expectedHead: staged.head, expectedTree: staged.stagedTree, message: 'Frozen B' };
    const code = `import {createEditorialRepository} from ${JSON.stringify(source)}; const repo=await createEditorialRepository({dataDirectory:process.env.TEST_ROOT,gitExecutable:process.env.TEST_GIT,onFault:point=>{if(point===process.env.TEST_POINT)process.kill(process.pid,'SIGKILL')}}); await repo.initialize(); await repo.commit(JSON.parse(process.env.TEST_INPUT));`;
    const result = await child(code, { TEST_ROOT: root, TEST_GIT: binary!, TEST_POINT: point, TEST_INPUT: JSON.stringify(input) }); assert.equal(result.signal, 'SIGKILL');
    const restarted = await open(); await restarted.initialize(); const committed = await restarted.commit(input);
    assert.equal((await restarted.log()).length, 2); assert.deepEqual(await restarted.read('research/one.json', { from: committed.oid }), { title: 'B' }); assert.deepEqual(await restarted.read('research/one.json'), { title: 'C' });
    assert.equal((await restarted.status()).unstaged.length, 1);
  });
}

test('two real processes cannot both commit against the same repository HEAD', options, async t => {
  const { root, repo, open } = await setup(t); await repo.write([{ path: 'research/one.json', value: { title: 'B' } }]); const staged = await repo.stage([{ path: 'research/one.json' }]); await repo.close();
  const code = `import {createEditorialRepository} from ${JSON.stringify(source)}; const repo=await createEditorialRepository({dataDirectory:process.env.TEST_ROOT,gitExecutable:process.env.TEST_GIT}); await repo.initialize(); try{const result=await repo.commit(JSON.parse(process.env.TEST_INPUT));console.log(result.oid)}catch(error){console.log(error.code);process.exitCode=2}finally{await repo.close()}`;
  const results = await Promise.all(['one', 'two'].map(id => child(code, { TEST_ROOT: root, TEST_GIT: binary!, TEST_INPUT: JSON.stringify({ operationId: id, expectedHead: staged.head, expectedTree: staged.stagedTree, message: `Concurrent ${id}` }) })));
  assert.equal(results.filter(result => result.code === 0).length, 1); assert.equal(results.filter(result => result.code === 2 && result.stdout.includes('HEAD_CHANGED')).length, 1);
  const restarted = await open(); await restarted.initialize(); assert.equal((await restarted.log()).length, 2);
});
