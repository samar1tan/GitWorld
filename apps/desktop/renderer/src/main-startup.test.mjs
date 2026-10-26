import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { validPackage } from '../../../../packages/storage/src/test-fixtures.ts';
import { copy } from './copy.ts';
import { workspaceCopy } from './workspace-copy.ts';
import { createWorkbenchCommands } from '../../../../packages/service/src/workbench-commands.ts';
import { onboardingProgress } from './onboarding.ts';
import { validateServiceRequest } from '../../../../packages/contracts/src/index.ts';
import { execFileSync } from 'node:child_process';

// The complete entry runs with its real renderer. This small DOM host records
// #app replacements; it does not simulate browser layout or installed acceptance.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase(); this.dataset = {}; this.children = [];
    this.listeners = new Map(); this.style = { setProperty() {} }; this.classList = { add() {}, remove() {}, toggle() {} };
    this.className = ''; this.isConnected = true; this.html = ''; this.writes = [];
  }
  set innerHTML(value) { this.html = value; this.writes.push(value); }
  get innerHTML() { return this.html; }
  get firstElementChild() { return this; }
  addEventListener(name, listener) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); }
  contains(node) { return node === this || this.children.includes(node); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  setAttribute() {} removeAttribute() {} remove() {} focus() {} replaceChildren() {}
  matches() { return false; }
  closest(selector) { return selector === 'button,a' && this.tagName === 'BUTTON' ? this : null; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, width: 1440, height: 900, right: 1440, bottom: 900 }; }
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);
async function until(check) { for (let turn = 0; turn < 100; turn++) { if (check()) return; await tick(); } assert.fail('The expected startup boundary was not reached.'); }
const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const hooks = '\nexport const __startupRegression={ready:()=>startupReady,transitioning:()=>transitioning,flush:()=>clientCache.flush(),guide,workbench:()=>workbench,research:researchWorkspace,enterScope};';
const compiled = await build({ entryPoints: [mainPath], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'startup-observation', setup(builder) { builder.onLoad({ filter: /renderer\/src\/main\.ts$/ }, async () => ({ contents: (process.env.GITWORLD_LEGACY_MAIN_BASELINE ? execFileSync('git', ['show', `${process.env.GITWORLD_LEGACY_MAIN_BASELINE}:apps/desktop/renderer/src/main.ts`], { encoding: 'utf8' }) : await readFile(mainPath, 'utf8')) + hooks, loader: 'ts', resolveDir: fileURLToPath(new URL('.', import.meta.url)) })); } }] });
const compiledDirectory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-startup-render-'));
const compiledPath = path.join(compiledDirectory, 'main.bundle.mjs');
await writeFile(compiledPath, compiled.outputFiles[0].text);
after(() => rm(compiledDirectory, { recursive: true, force: true }));
let instance = 0;
async function fixture(t, locale, suppliedPackage = validPackage(), legacyWorkspace = null) {
  const app = new Element(), body = new Element('body'), root = new Element('html');
  const info = deferred(), map = deferred(), preferences = deferred(), status = deferred();
  let mode = 'loaded', currentLocale = locale, progress, hostEvent, version = 0, statusCalls = 0;
  const calls = [], data = structuredClone(suppliedPackage), oid = 'a'.repeat(40);
  data.revision.id = data.history.id = oid;
  const oldRecord = { schemaVersion: 1, id: 'unrelated-record', title: 'An unrelated saved investigation', scope: { query: '', timeWindow: null, objectIds: ['unrelated-object'], fieldIds: [] }, interpretation: 'Keep this existing record.', openQuestions: [], evidence: [], comparison: null, updatedAt: '2026-10-25T00:00:00Z' };
  const research = new Map([[oldRecord.id, { record: oldRecord, contentHash: 'c'.repeat(64), repositoryRevision: null }]]);
  const commands = createWorkbenchCommands(async method => {
    if (method === 'model.read') return { datasetId: data.dataset.id, revision: oid, head: oid, package: structuredClone(data) };
    throw new Error('Unexpected model-guide command operation ' + method);
  });
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), get length() { return values.size; }, key: index => [...values.keys()][index] }; };
  const settings = () => ({ schemaVersion: 1, version: 1, values: { general: { locale: currentLocale, zoomFactor: 1, startup: 'resume', reducedMotion: 'system' }, learning: { tipsEnabled: false }, contributor: { name: 'Technical fixture', email: 'fixture@example.invalid' } } });
  const bridge = {
    async request(input) {
      calls.push(input);
      let result;
      switch (input.method) {
        case 'clientState.load': await preferences.promise; result = input.params.key === 'workspace-section' ? { key: input.params.key, version: 1, value: 'paths' } : null; break;
        case 'clientState.save': result = { ...input.params, version: ++version }; break;
        case 'settings.get': result = settings(); break;
        case 'library.status': statusCalls++; await status.promise; if (mode === 'failed') return { protocolVersion: 1, requestId: input.requestId, ok: false, error: { code: 'IO_ERROR' } }; result = { schemaVersion: 3, datasets: mode === 'empty' ? [] : [{ id: data.dataset.id, name: data.dataset.name, activeRevisionId: oid }] }; break;
        case 'model.catalog': result = { revision: 'working', head: oid, models: [] }; break;
        case 'workspace.load': result = legacyWorkspace; break;
        case 'revision.get': result = structuredClone(suppliedPackage); break;
        case 'model.resolveLegacy': result = { datasetId: data.dataset.id, revision: oid, head: oid, package: structuredClone(data), legacyAuthoredRevisionId: suppliedPackage.revision.id }; break;
        case 'model.read': result = { datasetId: data.dataset.id, revision: oid, head: oid, package: structuredClone(data) }; break;
        case 'workspace.save': result = { ...input.params.workspace, version: ++version }; break;
        case 'repository.status': result = { head: oid, branch: 'main', stagedTree: 'b'.repeat(40), staged: [], unstaged: [], conflicts: [], revert: null }; break;
        case 'command.execute': { const checked=validateServiceRequest(input);if(!checked.ok)return {protocolVersion:1,requestId:input.requestId,ok:false,error:checked.error};result = await commands.execute(input.params); break; }
        case 'research.list': result = [...research.values()].map(value => value.record); break;
        case 'research.get': result = research.get(input.params.id); break;
        case 'research.history': result = []; break;
        case 'research.save': result = { record: structuredClone(input.params.record), contentHash: 'd'.repeat(64), repositoryRevision: null }; research.set(result.record.id, result); break;
        default: throw new Error(`Unexpected startup request: ${input.method}`);
      }
      return { protocolVersion: 1, requestId: input.requestId, ok: true, result };
    },
    onProgress(callback) { progress = callback; return () => {}; },
    onSettingsHostEvent(callback) { hostEvent = callback; return () => {}; },
    onBeforeClose() { return () => {}; }, openExternal: async () => {}, selectFile: async () => null,
  };
  const values = {
    HTMLElement: Element, document: { body, documentElement: root, activeElement: body, querySelector: selector => selector === '#app' ? app : null, querySelectorAll: () => [], createElement: name => new Element(name), addEventListener() {} },
    window: { gitworld: bridge, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { href: 'gitworld://app/index.html' }, innerWidth: 1440, innerHeight: 900 },
    localStorage: storage(), sessionStorage: storage(), requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    ResizeObserver: class { observe() {} disconnect() {} }, DOMParser: class { parseFromString() { return { documentElement: { innerHTML: '<path d="M0 0"/>' } }; } },
    fetch: input => input === './world-land.svg' ? map.promise : input === './app-info.json' ? info.promise : Promise.reject(new Error(`Unexpected asset: ${input}`)),
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const module = await import(pathToFileURL(compiledPath).href + '?instance=' + ++instance);
  const release = async (next = 'loaded') => { mode = next; info.resolve(new Response(JSON.stringify({ version: '0.1.2', buildId: 'technical-startup' }))); preferences.resolve(); await until(() => statusCalls > 0); status.resolve(); await until(() => module.__startupRegression.ready() && !module.__startupRegression.transitioning()); await tick(); };
  t.after(async () => {
    map.resolve(new Response('<svg><path d="M0 0"/></svg>'));
    await release(mode); await module.__startupRegression.flush(); await tick();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  return {
    app, root, calls, release, hooks: module.__startupRegression, research, ready: () => module.__startupRegression.ready(),
    async mapFirst() { map.resolve(new Response('<svg><path d="M0 0"/></svg>')); await tick(); },
    locale(value) { currentLocale = value; hostEvent({ type: 'changed', snapshot: settings() }); },
    progress(completed, total) { progress({ operationId: 'library-initialize', stage: 'writing', completed, total }); },
    async retry(next) { mode = next; const before = statusCalls, button = new Element('button'); button.dataset.app = 'reload'; for (const callback of app.listeners.get('click') ?? []) callback({ target: button, composedPath: () => [button, app, body] }); await until(() => statusCalls > before); await tick(); },
  };
}

test('complete main opens an authored-ID workspace then nodes, checkout and comparison use actual OIDs', async t => {
  const data=validPackage(),ref=commitId=>({datasetId:data.dataset.id,revisionId:data.revision.id,commitId,requestedYear:commitId==='old'?-100:100});
  const saved={id:'primary',version:4,dataset:{datasetId:data.dataset.id,revisionId:data.revision.id},locale:'zh-CN',view:{panel:'history',scopeId:'region',processId:'courts',eventId:null,selectedCommitId:'new',graphRef:null,graphBranch:'realm/main',requestedYear:100,timeWindow:[-100,100],cursor:100,viewport:{x:0,y:0,width:1000,height:500}},trail:[],head:ref('old'),comparison:[ref('old'),ref('new')]};
  const f=await fixture(t,'zh-CN',data,saved);await f.release();await f.mapFirst();
  for(const command of ['git show new','git checkout old','git diff old new'])await f.hooks.workbench().execute(command);
  const calls=f.calls.filter(value=>value.method==='command.execute');assert.equal(calls.length,3);assert.ok(calls.every(value=>value.params.input.intent.target.revision==='a'.repeat(40)));
  assert.doesNotMatch(f.app.innerHTML,/INVALID_REQUEST/);
  const normalized=f.calls.find(value=>value.method==='workspace.save');assert.ok(normalized);assert.equal(normalized.params.expectedVersion,4);assert.equal(normalized.params.workspace.dataset.revisionId,'a'.repeat(40));assert.ok(normalized.params.workspace.comparison.every(value=>value.revisionId==='a'.repeat(40)));
});

for (const locale of ['en', 'zh-CN']) {
  test(`the complete model Guide opens a related fixed investigation and completes only after its real save (${locale})`, async t => {
    const data = JSON.parse(await readFile(new URL('../../../../data/seed/early-medieval.json', import.meta.url), 'utf8'));
    const f = await fixture(t, locale, data); await f.release(); await f.mapFirst();
    f.hooks.enterScope('east-asia');
    await f.hooks.workbench().execute('git show japan-744');
    await f.hooks.workbench().execute('git diff japan-744 japan-744');
    assert.deepEqual(onboardingProgress(f.hooks.guide.snapshot()), [true, true, false, false, false], 'An unchanged comparison is not a completed investigation step.');
    await f.hooks.workbench().execute('git diff japan-740 japan-744');
    assert.deepEqual(onboardingProgress(f.hooks.guide.snapshot()), [true, true, true, false, false]);
    assert.match(f.app.innerHTML, /data-evidence-version="japan-744" data-evidence-field="politics.capital"/);
    const inspected = { matches: selector => selector === '.field-evidence', open: true, dataset: { evidenceVersion: 'japan-744', evidenceField: 'politics.capital' }, querySelector: () => ({}) };
    for (const listener of f.app.listeners.get('toggle') ?? []) listener({ target: inspected });
    assert.deepEqual(onboardingProgress(f.hooks.guide.snapshot()), [true, true, true, true, false]);
    f.hooks.guide.open(); await f.hooks.guide.click({ dataset: { onboarding: 'next' } });
    const form = f.hooks.research.content();
    assert.match(form, /data-research-input="title" value=""/);
    assert.match(form, /commit:japan-740/); assert.match(form, /commit:japan-744/);
    assert.deepEqual(onboardingProgress(f.hooks.guide.snapshot()), [true, true, true, true, false]);
    f.hooks.research.input({ dataset: { researchInput: 'title' }, value: 'Why does the court continue across the move to Naniwa?' });
    f.hooks.research.input({ dataset: { researchInput: 'interpretation' }, value: 'The capital changes while the political organization retains its earlier source.' });
    await f.hooks.research.save();
    assert.deepEqual(onboardingProgress(f.hooks.guide.snapshot()), [true, true, true, true, true]);
    const saved = f.calls.find(value => value.method === 'research.save').params.record;
    assert.equal(saved.scope.model.datasetId, data.dataset.id); assert.equal(saved.evidence.length, 6);
    assert.equal(saved.comparison.a.historicalRef, 'commit:japan-740'); assert.equal(saved.comparison.b.historicalRef, 'commit:japan-744');
    assert.ok(saved.evidence.every(value => value.repositoryRevision === 'a'.repeat(40)));
    assert.equal(f.research.get('unrelated-record').record.interpretation, 'Keep this existing record.');
  });
}
function notEmpty(html) { for (const locale of ['en', 'zh-CN']) { assert.ok(!html.includes(copy(locale, 'noData')), 'An uninitialized library was rendered as empty.'); assert.ok(!html.includes(copy(locale, 'createData')), 'Import instructions appeared before the library was read.'); } }

for (const locale of ['en', 'zh-CN']) {
  test(`cold startup keeps real rendering pending through early assets, locale and progress (${locale})`, async t => {
    const f = await fixture(t, locale);
    await f.mapFirst(); notEmpty(f.app.innerHTML);
    f.locale(locale); assert.ok(f.app.innerHTML.includes(workspaceCopy(locale, 'openingLibrary'))); notEmpty(f.app.innerHTML);
    f.progress(2600, 2895); assert.ok(f.app.innerHTML.includes(workspaceCopy(locale, 'savedFiles', { completed: 2600, total: 2895 }))); notEmpty(f.app.innerHTML);
    const pendingWrites = [...f.app.writes]; await f.release();
    for (const html of [...pendingWrites, ...f.app.writes]) notEmpty(html);
    assert.match(f.app.innerHTML, /class="workspace /);
    const ready = f.app.innerHTML; f.progress(2895, 2895); assert.equal(f.app.innerHTML, ready, 'Late startup progress replaced the resolved workspace.');
  });
  test(`a confirmed empty library retains its actual discovery and retry controls (${locale})`, async t => {
    const f = await fixture(t, locale); f.locale(locale); await f.mapFirst(); notEmpty(f.app.innerHTML);
    await f.release('empty'); assert.ok(f.app.innerHTML.includes(copy(locale, 'noData'))); assert.ok(f.app.innerHTML.includes(copy(locale, 'createData')));
    assert.match(f.app.innerHTML, /data-app="reload"/); assert.match(f.app.innerHTML, /data-app="sources"/); assert.match(f.app.innerHTML, /data-app="settings"/);
  });
  test(`failed initial reads show an error and the real Retry can recover (${locale})`, async t => {
    const f = await fixture(t, locale); f.locale(locale); await f.mapFirst(); notEmpty(f.app.innerHTML);
    await f.release('failed'); assert.match(f.app.innerHTML, /IO_ERROR/); assert.ok(!f.app.innerHTML.includes(copy(locale, 'noData'))); assert.match(f.app.innerHTML, /data-app="reload"/);
    await f.retry('empty'); assert.ok(f.app.innerHTML.includes(copy(locale, 'noData'))); assert.doesNotMatch(f.app.innerHTML, /IO_ERROR/);
  });
}
