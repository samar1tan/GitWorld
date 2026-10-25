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
const hooks = '\nexport const __startupRegression={ready:()=>startupReady,transitioning:()=>transitioning,flush:()=>clientCache.flush()};';
const compiled = await build({ entryPoints: [mainPath], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'startup-observation', setup(builder) { builder.onLoad({ filter: /renderer\/src\/main\.ts$/ }, async () => ({ contents: await readFile(mainPath, 'utf8') + hooks, loader: 'ts', resolveDir: fileURLToPath(new URL('.', import.meta.url)) })); } }] });
const compiledDirectory = await mkdtemp(path.join(os.tmpdir(), 'gitworld-startup-render-'));
const compiledPath = path.join(compiledDirectory, 'main.bundle.mjs');
await writeFile(compiledPath, compiled.outputFiles[0].text);
after(() => rm(compiledDirectory, { recursive: true, force: true }));
let instance = 0;
async function fixture(t, locale) {
  const app = new Element(), body = new Element('body'), root = new Element('html');
  const info = deferred(), map = deferred(), preferences = deferred(), status = deferred();
  let mode = 'loaded', currentLocale = locale, progress, hostEvent, version = 0, statusCalls = 0;
  const calls = [], data = validPackage(), oid = 'a'.repeat(40);
  data.revision.id = data.history.id = oid;
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
        case 'workspace.load': result = null; break;
        case 'model.read': result = { datasetId: data.dataset.id, revision: oid, head: oid, package: structuredClone(data) }; break;
        case 'workspace.save': result = { ...input.params.workspace, version: ++version }; break;
        case 'repository.status': result = { head: oid, branch: 'main', stagedTree: 'b'.repeat(40), staged: [], unstaged: [], conflicts: [], revert: null }; break;
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
    app, root, calls, release, ready: () => module.__startupRegression.ready(),
    async mapFirst() { map.resolve(new Response('<svg><path d="M0 0"/></svg>')); await tick(); },
    locale(value) { currentLocale = value; hostEvent({ type: 'changed', snapshot: settings() }); },
    progress(completed, total) { progress({ operationId: 'library-initialize', stage: 'writing', completed, total }); },
    async retry(next) { mode = next; const before = statusCalls, button = new Element('button'); button.dataset.app = 'reload'; for (const callback of app.listeners.get('click') ?? []) callback({ target: button, composedPath: () => [button, app, body] }); await until(() => statusCalls > before); await tick(); },
  };
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
