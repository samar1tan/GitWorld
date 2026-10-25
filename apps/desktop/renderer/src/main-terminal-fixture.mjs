import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { createKnowledgeIndex } from '../../../../packages/domain/src/knowledge.ts';
import { createWorkbenchCommands } from '../../../../packages/service/src/workbench-commands.ts';
import { initialKnowledgeBrowserState } from './knowledge-browser-state.ts';

export const focusOid = 'a'.repeat(40);
export const focusLabels = { en: 'Technical fixture subject', 'zh-CN': '技术测试对象' };
export const focusReference = { objectId: 'focus-subject', year: 1336, revision: focusOid, label: focusLabels.en, labels: focusLabels, includeUnreviewed: false };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const tick = () => new Promise(setImmediate);
export async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await tick(); } throw new Error('Expected focus-fixture boundary was not reached.'); }

export async function focusBundle({ baseline, platform = 'node', outdir } = {}) {
  const directory = fileURLToPath(new URL('.', import.meta.url)), main = path.join(directory, 'main.ts');
  const hooks = '\nexport const __focusRegression={ready:()=>startupReady&&!transitioning&&toolPanel===\'knowledge\',knowledge:knowledgeBrowser,terminal,terminalHost,route:routeWorkspace,flush:flushClientState,snapshot:()=>({toolPanel,objectEditorOpen,locale:state.locale,knowledge:knowledgeBrowser.state(),terminal:clientCache.get(\'terminal-input\')})};';
  const readSource = async file => baseline ? execFileSync('git', ['show', `${baseline}:apps/desktop/renderer/src/${path.basename(file)}`], { encoding: 'utf8' }) : readFile(file, 'utf8');
  const options = { entryPoints: [main], bundle: true, write: false, platform, format: 'esm', logLevel: 'silent', plugins: [{ name: 'focus-observation-only', setup(builder) { builder.onLoad({ filter: /renderer\/src\/(main|terminal)\.ts$/ }, async args => ({ contents: await readSource(args.path) + (args.path === main ? hooks : ''), loader: 'ts', resolveDir: directory })); } }] };
  return build(platform === 'browser' ? { ...options, outdir, loader: { '.woff': 'file', '.woff2': 'file' }, assetNames: 'assets/[name]-[hash]' } : { ...options, loader: { '.css': 'empty' } });
}

// All records and service state are synthetic and in memory. Domain queries and
// command parsing are real; no installed library, Git process or source fetch runs.
export function createFocusApi(locale = 'en') {
  const source = { id: 'focus-source', identity: { provider: 'technical-fixture', externalId: 'focus-source' }, revision: 'fixture-v1', contentHash: 'c'.repeat(64), retrievedAt: '2026-10-25T00:00:00Z', url: 'https://example.invalid/technical-fixture', adapterVersion: 'technical-fixture-v1', rights: { redistribution: 'unknown' } };
  const at = year => ({ earliestYear: year, latestYear: year, precision: 'year', calendar: 'proleptic-gregorian' });
  const collection = { schemaVersion: 1, objects: [{ id: 'focus-subject', labels: focusLabels, descriptions: {}, identities: [], aliases: [], types: [] }], assertions: [{ id: 'focus-claim', subjectId: 'focus-subject', propertyId: 'polity:ruler', value: { kind: 'text', value: 'Technical ruler' }, qualifiers: [], evidence: [{ sourceId: source.id, locator: 'technical row 1' }], sourceSnapshotId: source.id, review: 'unreviewed', validTime: { start: at(1336), end: at(1392) } }], sources: [source] };
  const index = createKnowledgeIndex(collection), status = { head: focusOid, branch: 'main', stagedTree: 'b'.repeat(40), staged: [], unstaged: [], conflicts: [], revert: null };
  const view = { ...initialKnowledgeBrowserState(), kindMode: 'all', queryRevision: focusOid, selectedObjectId: 'focus-subject', objectRevision: focusOid, year: 1336, yearDraft: '1370', view: 'state', checkout: structuredClone(focusReference), a: structuredClone(focusReference), preview: structuredClone(focusReference) };
  const values = new Map([['locale', locale], ['workspace-section', 'knowledge'], ['knowledge-view', view]]), versions = new Map(), calls = [];
  let gate = null, held = 0, pending = 0, profileVersion = 1;
  const settings = () => ({ version: profileVersion, values: { schemaVersion: 1, general: { locale, zoomFactor: 1, startup: 'resume', reducedMotion: 'system' }, learning: { tipsEnabled: false }, contributor: { name: 'Technical fixture', email: 'fixture@example.invalid' } } });
  const commands = createWorkbenchCommands(async method => { if (method === 'repository.status') return structuredClone(status); if (method === 'repository.log') return []; throw new Error('Unexpected technical command operation ' + method); });
  async function dispatch(input) {
    calls.push(input); const p = input.params;
    if (gate && ['knowledge.object', 'knowledge.state', 'knowledge.history'].includes(input.method)) { const selected = gate; held++; pending++; try { await selected.promise; } finally { pending--; } }
    let result;
    switch (input.method) {
      case 'clientState.load': result = values.has(p.key) ? { key: p.key, value: structuredClone(values.get(p.key)), version: versions.get(p.key) ?? 1 } : null; break;
      case 'clientState.save': { const version = (versions.get(p.key) ?? 1) + 1; versions.set(p.key, version); values.set(p.key, structuredClone(p.value)); result = { key: p.key, version, value: structuredClone(p.value) }; break; }
      case 'settings.get': result = settings(); break;
      case 'settings.library': result = { location: '/technical-fixture/library', bytes: 0, files: 0 }; break;
      case 'library.status': result = { schemaVersion: 3, datasets: [] }; break;
      case 'model.catalog': result = { revision: 'working', head: focusOid, models: [] }; break;
      case 'repository.status': result = structuredClone(status); break;
      case 'workspace.load': result = null; break;
      case 'workspace.save': result = { ...structuredClone(p.workspace), version: 1 }; break;
      case 'knowledge.query': result = index.query(p.query); break;
      case 'knowledge.object': result = { object: index.object(p.objectId), assertions: collection.assertions, sources: collection.sources, revision: p.revision, working: p.revision === 'working' }; break;
      case 'knowledge.state': result = index.state(p.state); break;
      case 'knowledge.history': result = index.history(p.objectId, p.includeUnreviewed); break;
      case 'context.list': result = { items: [], total: 0, offset: 0, limit: 25, revision: p.revision, head: focusOid, counts: { objects: 1, assigned: 0, unassigned: 1 } }; break;
      case 'knowledge.editContext': result = { head: focusOid, objectHash: null, object: null, catalog: { schemaVersion: 1, kind: 'historical-field-display-labels', properties: [], types: [] }, sources: [] }; break;
      case 'command.complete': result = []; break;
      case 'command.execute': result = await commands.execute(p); break;
      default: throw new Error('Unexpected focus-fixture request ' + input.method);
    }
    return { protocolVersion: 1, requestId: input.requestId, ok: true, result };
  }
  return { dispatch, calls, settings, values, technicalOutput:()=>commands.execute({input:{command:'git log --limit 2'}}), arm() { gate = deferred(); held = 0; }, release() { const selected = gate; gate = null; selected?.resolve(); }, locale(value) { locale = value; profileVersion++; return settings(); }, observed() { return { held, pending, commandRequests: calls.filter(value => value.method === 'command.execute').length }; } };
}
