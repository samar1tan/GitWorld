import { historyDataset } from './history-content';
import { createHistoryEngine } from './history-engine';
import { executeCommand, completeCommand, parseCommand, commandForIntent } from './commands';
import type { CommandExecution, HistoryBranch, HistoryCommit, HistoryContext, HistoryText, HistoryDiff, SnapshotField, SnapshotAbsence } from './history-types';
import type { Workspace } from './state';
import { navigate, setWindow } from './state';
import { scopes } from './content';
import { workbenchMessages, type WorkbenchMessageKey } from './workbench-locales';

export const historyEngine = createHistoryEngine(historyDataset);
const esc = (v: string | number) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const commandButton = (command: string, label: string, cls = '', name = '') => `<button type="button" class="${cls}" data-wb="command" data-command="${esc(command)}" ${name ? `data-figma-name="${esc(name)}"` : ''}>${label}</button>`;
const btn = (action: string, label: string, extra = '') => `<button type="button" data-wb="${action}" ${extra}>${label}</button>`;
const branchColor = (b: HistoryBranch) => b.color || ['#88adf5','#c6a7e8','#c0ac86','#83b6c8'][historyDataset.branches.indexOf(b) % 4];

type Entry = { execution: CommandExecution; origin: 'gui' | 'command' };
type Options = { getState: () => Workspace; update: (next: Workspace, mode?: 'push' | 'replace', focus?: boolean) => void; render: () => void };
export function createWorkbench(options: Options) {
  const state = () => options.getState();
  const text = (v: HistoryText) => v[state().locale];
  const t = (key: WorkbenchMessageKey) => workbenchMessages[state().locale][key];
  const fmt = (key: 'versionCount' | 'diffSummary' | 'sourceCount' | 'earlierCount', values: Record<string, number>) => Object.entries(values).reduce((s,[k,v]) => s.replaceAll(`{${k}}`, new Intl.NumberFormat(state().locale).format(v)), t(key) as string);
  const branch = (id: string | null | undefined) => id ? historyEngine.branches.get(id) : undefined;
  const commit = (id: string | null | undefined) => id ? historyEngine.commits.get(id) : undefined;
  const ctx = (): HistoryContext => ({ head: state().head, comparison: state().comparison, currentYear: state().view.cursor, scopeId: state().view.scopeId, timeWindow: state().view.timeWindow, selectedRef: state().view.selectedCommit });
  const ref = (c: HistoryCommit) => `${c.branchId}@${c.year}`;
  const refLabel = (id: string) => { const c = commit(id); return c ? `${text(branch(c.branchId)!.name)} · ${c.year}` : id; };
  let terminalOpen = sessionStorage.getItem('gitworld-terminal-open') === 'true';
  let entries: Entry[] = [];
  let commandHistory: string[] = [];
  try { const saved = JSON.parse(sessionStorage.getItem('gitworld-command-history') || '[]'); if (Array.isArray(saved)) commandHistory = saved.filter((entry): entry is string => typeof entry === 'string'); } catch { /* Invalid browser storage must not block exploration. */ }
  let historyIndex = commandHistory.length;
  let inputDraft = '';
  let completionIndex = -1;
  let graphExpanded = false;
  let graphRelated = true;
  let diffFilter: 'all' | 'changed' | 'same' = 'all';
  let compareDraft: [string, string] | null = null;
  let tracedField: string | null = null;
  let graphScroll = { left: 0, top: 0, process: '', selected: '' };
  let completionSeed = '';
  const versionCount = (count: number, branches: number) => state().locale === 'en'
    ? `${count} ${t(count === 1 ? 'versionWordOne' : 'versionWord')} · ${branches} ${t(branches === 1 ? 'branchWordOne' : 'branchWord')}`
    : fmt('versionCount', { count, branches });

  function moveToCommit(next: Workspace, c: HistoryCommit, panel: Workspace['view']['panel']) {
    const b = branch(c.branchId)!;
    const s = scopes.find(x => x.id === b.scopeId);
    return navigate(next, { level: 'process', panel, scopeId: b.scopeId, processId: b.processId,
      eventId: null, graphBranch: b.id, selectedCommit: c.id, graphRef: next.view.graphRef && (()=>{const path=historyEngine.log(next.view.graphRef,ctx());return path.ok&&path.value.commits.some(item=>item.id===c.id);})() ? next.view.graphRef : null,
      ...(s && next.view.scopeId !== s.id ? { viewport: { ...s.viewBox } } : {}) });
  }
  function execute(input: string, origin: 'gui' | 'command' = 'gui') {
    const result = executeCommand(historyEngine, input, ctx());
    entries.push({ execution: result, origin });
    entries = entries.slice(-40);
    if (origin === 'command') {
      if (commandHistory.at(-1) !== input.trim()) commandHistory.push(input.trim());
      commandHistory = commandHistory.slice(-100);
      sessionStorage.setItem('gitworld-command-history', JSON.stringify(commandHistory));
      historyIndex = commandHistory.length;
      inputDraft = '';
      terminalOpen = true;
      sessionStorage.setItem('gitworld-terminal-open', 'true');
    }
    completionIndex = -1;
    if (!result.ok) { terminalOpen = true; options.render(); focusInput(); return; }
    let next = state();
    const effect = result.effect;
    if (effect.type === 'history') {
      const b = branch(effect.branchId)!;
      const s = scopes.find(x => x.id === b.scopeId);
      next = navigate(next, { level: 'process', panel: 'history', scopeId: b.scopeId, processId: b.processId,
        eventId: null, graphBranch: b.id, graphRef: result.intent.type==='log'?result.intent.ref:null, selectedCommit: null, requestedYear: null,
        ...(s && next.view.scopeId !== s.id ? { viewport: {...s.viewBox} } : {}) });
    } else if (effect.type === 'preview' || effect.type === 'checkout') {
      const c = commit(effect.version.commitId)!;
      next = moveToCommit(next, c, effect.type === 'checkout' ? 'snapshot' : 'history');
      next.view.requestedYear = effect.version.requestedYear;
      if (effect.type === 'checkout') next = { ...next, head: c.id, headRequestedYear: effect.version.requestedYear };
      tracedField = null;
    } else if (effect.type === 'compare') {
      next = { ...next, comparison: [effect.a.commitId, effect.b.commitId], comparisonRequestedYears: [effect.a.requestedYear, effect.b.requestedYear] };
      next = navigate(next, { panel: 'compare' });
      compareDraft = [`${effect.a.branchId}@${effect.a.requestedYear??effect.a.recordedYear}`, `${effect.b.branchId}@${effect.b.requestedYear??effect.b.recordedYear}`];
      diffFilter = 'all';
      tracedField = null;
    } else if (effect.type === 'blame') {
      next = moveToCommit(next, commit(effect.changedAt)!, 'history');
      next.view.requestedYear = null;
      tracedField = effect.fieldId;
    }
    if (next !== state()) options.update(next); else options.render();
    if (origin === 'command') focusInput();
  }
  function focusInput() { requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#history-command')?.focus({ preventScroll: true })); }
  function sourceLinks(ids: string[]) {
    return [...new Set(ids)].map(id => historyDataset.sources[id]).filter(Boolean).map(s => `<a class="wb-source" href="${esc(s.url)}" target="_blank" rel="noreferrer"><strong>${esc(s.title)}</strong><small>${esc(s.publisher)} ↗</small></a>`).join('');
  }
  function resolutionNote(c: HistoryCommit, requestedYear: number | null | undefined) {
    return requestedYear != null && requestedYear !== c.year ? `<div class="resolution-note"><strong>${t('requested')} ${requestedYear} → ${t('recorded')} ${c.year}</strong><span>${t('asOf')}</span></div>` : '';
  }
  function versionActions(c: HistoryCommit) {
    return `<div class="version-actions">${commandButton(`git checkout ${ref(c)}`, t('checkout'), 'primary-action', `Checkout / ${c.id}`)}${state().head && state().head !== c.id ? commandButton(`git diff ${state().head} ${c.id}`, t('compareHead'), 'secondary-action', `Compare HEAD / ${c.id}`) : ''}${c.parents.length ? commandButton(`git diff ${c.parents[0]} ${c.id}`, t('compareParent'), 'secondary-action', `Compare parent / ${c.id}`) : ''}</div>`;
  }
  function sidebar() {
    const relevant = historyDataset.branches.filter(b => !state().view.scopeId || b.scopeId === state().view.scopeId);
    return `<section class="branch-explorer" data-figma-name="Branch explorer"><div class="sidebar-label">${t('branches')}<span>${relevant.length}</span></div>${relevant.map(b => `<div class="branch-nav-wrap">${commandButton(`git log ${b.id} --graph`, `<span class="branch-dot" style="--branch-color:${branchColor(b)}"></span><span><strong>${esc(text(b.name))}</strong><code>${esc(b.id)}</code></span>${commit(state().head)?.branchId === b.id ? '<span class="head-mini">HEAD</span>' : ''}`, `branch-nav ${state().view.graphBranch === b.id ? 'active' : ''}`, `Branch / ${b.id}`)}</div>`).join('')}</section>`;
  }
  function tabs() {
    const p = state().view.panel;
    return `<div class="workbench-tabs" role="tablist" aria-label="${t('history')}" data-figma-name="Workbench view tabs">${btn('history', t('history'), `role="tab" aria-selected="${p === 'history'}" class="${p === 'history' ? 'active' : ''}"`)}${state().head ? btn('snapshot', `${t('snapshot')} <span>HEAD</span>`, `role="tab" aria-selected="${p === 'snapshot'}" class="${p === 'snapshot' ? 'active' : ''}"`) : ''}${state().comparison ? btn('comparison', t('compare'), `role="tab" aria-selected="${p === 'compare'}" class="${p === 'compare' ? 'active' : ''}"`) : ''}<div class="tabs-spacer"></div>${btn('compare-open', t('compareVersions'), 'class="tab-action"')}</div>`;
  }
  function graph() {
    const v = state().view;
    let branches = historyDataset.branches.filter(b => v.processId ? b.processId === v.processId : !v.scopeId || b.scopeId === v.scopeId);
    if (!branches.length && v.scopeId) branches = historyDataset.branches.filter(b => b.scopeId === v.scopeId);
    let commits = historyDataset.commits.filter(c => branches.some(b => b.id === c.branchId));
    const restrictedQuery = Boolean(v.graphRef && !historyEngine.branches.has(v.graphRef));
    if ((restrictedQuery || !graphRelated) && (v.graphRef || v.graphBranch)) {
      const path = historyEngine.log(v.graphRef || v.graphBranch!, ctx());
      if (path.ok) { commits = path.value.commits; branches = historyDataset.branches.filter(b => commits.some(c => c.branchId === b.id)); }
    }
    const full = commits;
    const hiddenEarlier = !graphExpanded && branches.length > 2 ? commits.filter(c => c.year < 800 && c.branchId === 'francia/main' && c.id !== v.selectedCommit) : [];
    commits = commits.filter(c => !hiddenEarlier.includes(c) && ((c.year >= v.timeWindow[0] && c.year <= v.timeWindow[1]) || c.id === v.selectedCommit));
    const years = [...new Set(commits.map(c => c.year))].sort((a,b) => a-b);
    const width = Math.max(640, years.length * 94 + 148);
    const height = Math.max(260, branches.length * 86 + 78);
    const px = (c: HistoryCommit) => 151 + years.indexOf(c.year) * 94;
    const py = (c: HistoryCommit) => 67 + branches.findIndex(b => b.id === c.branchId) * 86;
    const pathIds = v.graphRef || v.graphBranch ? historyEngine.log(v.graphRef || v.graphBranch!, ctx()) : null;
    const pathSet = new Set(pathIds?.ok ? pathIds.value.commits.map(c => c.id) : []);
    const edges = commits.flatMap(c => c.parents.map(parentId => {
      const parent = commits.find(x => x.id === parentId);
      if (!parent) return '';
      const x1=px(parent), y1=py(parent), x2=px(c), y2=py(c), color=branchColor(branch(c.branchId)!);
      const bend = Math.min(35, (x2-x1)/2);
      return `<path d="M${x1} ${y1} H${x2-bend} Q${x2} ${y1} ${x2} ${y1 + Math.sign(y2-y1)*Math.min(24,Math.abs(y2-y1))} V${y2}" fill="none" stroke="${color}" stroke-width="${pathSet.has(c.id) ? 2.4 : 1.5}" opacity="${pathSet.size && !pathSet.has(c.id) ? '.35' : '.85'}"/>`;
    })).join('');
    return `<section class="version-graph-section" data-figma-name="History graph"><div class="graph-toolbar"><span>${versionCount(full.length,branches.length)}${restrictedQuery?` · <code>${esc(v.graphRef!)}</code>`:''}</span><div>${v.graphBranch && !restrictedQuery && historyDataset.branches.filter(b=>b.processId===v.processId).length>1 ? btn('graph-related', graphRelated ? t('graphAll') : t('graphSingle'), `class="graph-toggle ${graphRelated?'active':''}" aria-pressed="${graphRelated}"`) : ''}${hiddenEarlier.length ? btn('graph-earlier', fmt('earlierCount',{count:hiddenEarlier.length}), 'class="graph-toggle"') : graphExpanded && branches.length > 2 ? btn('graph-earlier', t('compact'), 'class="graph-toggle"') : ''}</div></div>
    <div class="graph-scroll" data-figma-name="Version graph viewport"><div class="version-graph" style="width:${width}px;height:${height}px"><svg class="graph-lines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${branches.map((b,i)=>`<path d="M126 ${67+i*86}H${width-20}" stroke="#29323e" stroke-dasharray="3 5"/>`).join('')}${edges}</svg><div class="graph-years">${years.map((y,i)=>`<span style="left:${151+i*94}px">${y}</span>`).join('')}</div>${branches.map((b,i)=>`<div class="graph-lane" style="top:${48+i*86}px;--branch-color:${branchColor(b)}">${commandButton(`git log ${b.id} --graph`, `<strong>${esc(text(b.name))}</strong><code>${esc(b.id.replace('francia/',''))}</code>`, '', `Graph branch / ${b.id}`)}</div>`).join('')}
    ${commits.map(c=>`<button type="button" class="graph-version ${v.selectedCommit===c.id?'selected':''} ${state().head===c.id?'is-head':''} ${pathSet.size && !pathSet.has(c.id)?'off-path':''}" style="left:${px(c)}px;top:${py(c)}px;--branch-color:${branchColor(branch(c.branchId)!)}" data-wb="command" data-command="git show ${esc(c.id)}" data-figma-name="Version / ${c.id}" aria-label="${esc(`${text(branch(c.branchId)!.name)} ${c.year}: ${text(c.title)}`)}" title="${esc(text(c.title))}"><span class="version-dot"></span>${state().head===c.id?'<span class="graph-head">HEAD</span>':''}<span class="version-title">${esc(text(c.title))}</span></button>`).join('')}${!commits.length ? `<div class="graph-empty">${t('noVersions')}${btn('include-versions',t('includeVersions'),'class="text-button"')}</div>`:''}</div></div><div class="graph-caption">${t('graphSpacing')}</div></section>`;
  }
  function fieldEvidence(value: SnapshotField | SnapshotAbsence, versionId: string) {
    if ('status' in value && value.status === 'unknown') return '';
    if (!value.sourceIds.length) return `<span class="no-source">${t('noSource')}</span>`;
    const last = commit(value.changedAt);
    return `<details class="field-evidence"><summary>${t('evidence')} · ${value.sourceIds.length}</summary><p>${value.inherited?t('inheritedNote'):t('changedHere')}</p>${last ? `<div class="field-origin">${t('lastChanged')}: ${commandButton(`git show ${last.id}`, `${last.year} · ${esc(text(last.title))}`,'inline-ref')}</div>`:''}${'note' in value && value.note?`<p>${esc(text(value.note))}</p>`:''}${sourceLinks(value.sourceIds)}${commandButton(`git blame ${versionId} --field ${value.fieldId}`,t('trace'),'trace-button')}</details>`;
  }
  function snapshotView() {
    const c = commit(state().head);
    if (!c) return `<div class="wb-empty">${t('noHead')}</div>`;
    const result = historyEngine.snapshot(c.id);
    if (!result.ok) return `<div class="wb-empty">${t('error_INVALID_DATASET')}</div>`;
    const b = branch(c.branchId)!;
    return `<section class="snapshot-view" data-figma-name="Checked out state"><div class="version-heading"><div><div class="eyebrow">HEAD · ${esc(b.id)}</div><h1>${esc(text(b.name))}<span>${c.year}</span></h1><p>${esc(text(c.title))}</p></div>${btn('history',t('returnHistory'),'class="secondary-action"')}</div>${resolutionNote(c,state().headRequestedYear)}<p class="snapshot-summary">${esc(text(c.summary))}</p>${c.note?`<p class="version-note">${esc(text(c.note))}</p>`:''}<div class="state-fields">${historyDataset.fields.map(f=>{
      const value=result.value.fields[f.id];
      if (!value) { const absence=result.value.removedFields[f.id]; return `<article class="state-field"><div class="state-field-label"><strong>${esc(text(f.name))}</strong><code>${esc(f.id)}</code></div><div class="state-field-value"><p class="not-recorded">${absence?t('explicitlyRemoved'):t('notRecorded')}</p>${absence?fieldEvidence(absence,c.id):''}</div></article>`; }
      return `<article class="state-field" data-figma-name="State field / ${f.id}"><div class="state-field-label"><strong>${esc(text(f.name))}</strong><code>${esc(f.id)}</code></div><div class="state-field-value"><p>${esc(text(value.label))}</p>${value.status==='known'?`<span class="provenance">${value.inherited?`${t('inherited')} · ${commit(value.changedAt)?.year??''}`:t('changedHere')}</span>`:''}${fieldEvidence(value,c.id)}</div></article>`;
    }).join('')}</div><div class="snapshot-actions">${c.parents.length?commandButton(`git diff ${c.parents[0]} ${c.id}`,t('compareParent'),'secondary-action'):''}${btn('compare-open',t('compareVersions'),'primary-action')}</div></section>`;
  }
  function compareView() {
    const pair = state().comparison;
    const result = pair ? historyEngine.diff(pair[0],pair[1],ctx()) : null;
    const diff = result?.ok && (!compareDraft || compareDraft.every(Boolean)) ? result.value : null;
    const draft = compareDraft || (pair ? pair.map((id,index)=>`${commit(id)!.branchId}@${state().comparisonRequestedYears?.[index]??commit(id)!.year}`) as [string,string] : [state().head ? ref(commit(state().head)!) : '', '']);
    return `<section class="comparison-view" data-figma-name="Version comparison"><div class="comparison-heading"><div><div class="eyebrow">DIFF</div><h1>${t('compareVersions')}</h1></div>${btn('history',t('returnHistory'),'class="secondary-action"')}</div><form id="compare-form" class="compare-form"><label>${t('beforeA')}<input id="compare-a" name="a" aria-label="${t('beforeA')}" list="version-refs" value="${esc(draft[0])}" placeholder="francia/west@843" autocomplete="off" spellcheck="false" required /></label>${btn('swap', '⇄', `class="swap-button" aria-label="${t('swap')}"`)}<label>${t('afterB')}<input id="compare-b" name="b" aria-label="${t('afterB')}" list="version-refs" value="${esc(draft[1])}" placeholder="francia/east@870" autocomplete="off" spellcheck="false" required /></label><button type="submit" class="primary-action" data-figma-name="Run comparison">${t('compare')}</button></form><datalist id="version-refs">${historyDataset.commits.map(c=>`<option value="${esc(ref(c))}">${esc(text(c.title))}</option>`).join('')}</datalist>${diff?diffTable(diff):`<div class="compare-selection-grid">${historyDataset.branches.map(b=>`<section><strong>${esc(text(b.name))}</strong>${b.commitIds.map(id=>{const c=commit(id)!;return `<div><span>${c.year}</span>${btn('endpoint-a','A',`data-ref="${esc(ref(c))}" class="endpoint-choice" aria-label="${t('beforeA')} ${esc(ref(c))}"`)}${btn('endpoint-b','B',`data-ref="${esc(ref(c))}" class="endpoint-choice" aria-label="${t('afterB')} ${esc(ref(c))}"`)}<small>${esc(text(c.title))}</small></div>`;}).join('')}</section>`).join('')}</div>`}</section>`;
  }
  function diffTable(diff: HistoryDiff) {
    const a=commit(diff.a.commitId)!,b=commit(diff.b.commitId)!;
    const counts={changed:diff.rows.filter(r=>['changed','added','removed'].includes(r.kind)).length,same:diff.rows.filter(r=>r.kind==='same').length,unknown:diff.rows.filter(r=>r.kind==='unknown').length};
    const rows=diff.rows.filter(r=>diffFilter==='all'||diffFilter==='same'&&r.kind==='same'||diffFilter==='changed'&&['changed','added','removed'].includes(r.kind));
    const cell=(value:SnapshotField|null,absence:SnapshotAbsence|null|undefined,id:string)=>value?`<div><p>${esc(text(value.label))}</p>${value.status==='known'&&value.inherited?`<span class="provenance">${t('inherited')} · ${commit(value.changedAt)?.year??''}</span>`:''}${fieldEvidence(value,id)}</div>`:absence?`<div><p class="not-recorded">${t('explicitlyRemoved')}</p>${fieldEvidence(absence,id)}</div>`:`<span class="not-recorded">${t('notRecorded')}</span>`;
    return `<div class="diff-context">${diff.commonBaseIds.length?`<span>${t('commonBase')}</span>${diff.commonBaseIds.map(id=>commandButton(`git show ${id}`,esc(refLabel(id)),'inline-ref',`Common base / ${id}`)).join('')}`:`<span>${t('noCommonBase')}</span>`}</div><div class="diff-summary"><span>${fmt('diffSummary',counts)}</span><div class="diff-filters">${(['all','changed','same'] as const).map(f=>btn('diff-filter',t(f==='all'?'allFields':f==='changed'?'changedFields':'sameFields'),`class="${diffFilter===f?'active':''}" data-filter="${f}" aria-pressed="${diffFilter===f}"`)).join('')}</div></div><div class="diff-table" role="table"><div class="diff-row diff-header" role="row"><div role="columnheader">${t('field')}</div><div role="columnheader"><span>A</span>${esc(text(branch(a.branchId)!.name))}<strong>${a.year}</strong>${resolutionNote(a,state().comparisonRequestedYears?.[0])}</div><div role="columnheader"><span>B</span>${esc(text(branch(b.branchId)!.name))}<strong>${b.year}</strong>${resolutionNote(b,state().comparisonRequestedYears?.[1])}</div></div>${!rows.length?`<div class="diff-empty">${t('noDifferences')}</div>`:''}${rows.map(r=>`<div class="diff-row diff-${r.kind}" role="row" data-figma-name="Diff field / ${r.fieldId}"><div class="diff-field" role="rowheader"><strong>${esc(text(historyEngine.fields.get(r.fieldId)!.name))}</strong><code>${esc(r.fieldId)}</code><span class="diff-kind">${t(r.kind)}</span></div><div class="diff-cell" role="cell">${cell(r.before,r.beforeAbsence,a.id)}</div><div class="diff-cell" role="cell">${cell(r.after,r.afterAbsence,b.id)}</div></div>`).join('')}</div>`;
  }
  function content() { return state().view.panel==='snapshot'?snapshotView():state().view.panel==='compare'?compareView():graph(); }
  function inspector() {
    const c=commit(state().view.selectedCommit);
    const b=c?branch(c.branchId):branch(state().view.graphBranch);
    if (!c) return `<aside class="inspector version-inspector" data-figma-name="Branch context"><div class="inspector-heading">${t('branchHistory')}</div><div class="inspector-body">${b?`<h2>${esc(text(b.name))}</h2><code class="branch-ref">${esc(b.id)}</code><p>${esc(text(b.description))}</p><div class="branch-coverage">${t('branchCoverage')}<strong>${b.coverage[0]}–${b.coverage[1]}</strong></div>`:''}<p class="graph-inspect-hint">${t('noSelection')}</p></div></aside>`;
    const child=historyDataset.commits.filter(x=>x.parents.includes(c.id));
    return `<aside class="inspector version-inspector" data-figma-name="Version preview"><div class="inspector-heading"><span>${t('preview')}</span>${state().head===c.id?'<span class="head-mini">HEAD</span>':''}</div><div class="inspector-body"><div class="version-date">${c.year}</div><h2>${esc(text(c.title))}</h2><code class="branch-ref">${esc(ref(c))}</code>${resolutionNote(c,state().view.requestedYear)}${c.year<state().view.timeWindow[0]||c.year>state().view.timeWindow[1]?`<div class="resolution-note"><span>${t('outsideWindow')}</span>${btn('include-selected',t('includeDate'),'class="inline-ref"')}</div>`:''}<p>${esc(text(c.summary))}</p>${tracedField?`<div class="trace-context">${t('fieldHistory')}<strong>${esc(text(historyEngine.fields.get(tracedField)!.name))}</strong></div>`:''}${versionActions(c)}<div class="version-change-list"><h3>${t('changes')}</h3>${Object.entries(c.changes).map(([f,value])=>`<div><strong>${esc(text(historyEngine.fields.get(f)!.name))}</strong><span>${value?esc(text(value.label)):t('removed')}</span></div>`).join('')}</div>${c.note?`<p class="version-note">${esc(text(c.note))}</p>`:''}${c.parents.length?`<div class="version-relations"><h3>${t('parent')}</h3>${c.parents.map(id=>commandButton(`git show ${id}`,esc(refLabel(id)),'version-relation')).join('')}</div>`:''}${child.length?`<div class="version-relations"><h3>${t('children')}</h3>${child.map(x=>commandButton(`git show ${x.id}`,`${esc(text(branch(x.branchId)!.name))} · ${x.year}`,'version-relation')).join('')}</div>`:''}<div class="version-relations"><h3>${t('sources')}</h3>${sourceLinks(c.sourceIds)}</div></div></aside>`;
  }
  function recoveryCommand(result: Extract<CommandExecution,{ok:false}>, candidate: string) {
    if (candidate.startsWith('git ')) return candidate;
    if (result.error.code === 'UNKNOWN_COMMAND') return `git ${candidate}`;
    const parsed = parseCommand(result.command);
    if (!parsed.ok) return candidate;
    const intent = parsed.value;
    if (intent.type === 'diff') {
      const invalidA = !historyEngine.resolve(intent.a, ctx()).ok;
      return commandForIntent({ ...intent, [invalidA ? 'a' : 'b']: candidate });
    }
    if (intent.type === 'blame') return commandForIntent({ ...intent, [result.error.code === 'UNKNOWN_FIELD' ? 'fieldId' : 'ref']: candidate });
    if (intent.type === 'log' || intent.type === 'show' || intent.type === 'checkout') return commandForIntent({ ...intent, ref: candidate });
    return candidate;
  }
  function resultOutput(result: CommandExecution) {
    if (!result.ok) return `<div class="terminal-error"><span>${esc(t(`error_${result.error.code}` as WorkbenchMessageKey))}</span>${result.error.subject?`<code>${esc(result.error.subject)}</code>`:''}${result.error.candidates?.length?`<div class="terminal-refs">${result.error.candidates.slice(0,12).map(c=>btn('fill-command',esc(c),`data-command="${esc(recoveryCommand(result,c))}" class="terminal-ref"`)).join('')}</div>`:''}</div>`;
    const o=result.output;
    if(o.kind==='help') {
      const examples:Record<string,string>={help:'git help diff',status:'git status',branch:'git branch --all',search:'git search capital',log:'git log francia/west --graph',show:'git show francia/west@843',checkout:'git checkout japan/main@794',diff:'git diff japan/main@710 japan/main@745',blame:'git blame japan/main@794 --field politics.capital'};
      return `<div class="terminal-help"><p>${t('referenceHelp')}</p>${o.commands.map(syntax=>{const name=syntax.split(' ')[1];return `<div class="help-command"><code>${esc(syntax)}</code><span>${t(`help_${name}` as WorkbenchMessageKey)}</span>${btn('fill-command',esc(examples[name]),`data-command="${esc(examples[name])}" class="terminal-command-help" aria-label="${t('inputCommand')}: ${esc(examples[name])}"`)}</div>`;}).join('')}</div>`;
    }
    if(o.kind==='status')return `<div class="terminal-status"><span>${t('currentScope')}: ${esc(o.context.scopeId||'world')} · ${o.context.timeWindow?.join('–')||''}</span><span>HEAD: ${o.context.head?commandButton(`git show ${o.context.head}`,esc(refLabel(o.context.head)),'terminal-ref'):t('noHead')}</span>${o.context.comparison?`<span>Diff: ${o.context.comparison.map(id=>esc(refLabel(id))).join(' ↔ ')}</span>`:''}<code>${esc(o.datasetVersion)}</code></div>`;
    if(o.kind==='branches')return `<div class="terminal-refs">${o.branches.map(b=>commandButton(`git log ${b.id} --graph`,`${esc(b.id)} <span>${esc(text(b.name))}</span>`,'terminal-ref')).join('')}</div>`;
    if(o.kind==='search')return `<div class="terminal-refs">${o.hits.length?o.hits.map(h=>commandButton(h.kind==='branch'?`git log ${h.id} --graph`:`git show ${h.id}`,`${h.year||''} ${esc(text(h.name))} <code>${esc(h.id)}</code>`,'terminal-ref')).join(''):t('noMatches')}</div>`;
    if(o.kind==='log')return `<div class="terminal-result-line">${t('graphResult')} · ${o.commits.length} ${t(o.commits.length===1?'versionWordOne':'versionWord')}</div><div class="terminal-refs">${o.commits.map(c=>commandButton(`git show ${c.id}`,`${c.year} ${esc(text(c.title))}`,'terminal-ref')).join('')}</div>`;
    if(o.kind==='snapshot'){const c=commit(o.version.commitId)!;return `<div class="terminal-result-line">${result.intent.type==='checkout'?t('checkoutSuccess'):t('stateResult')} ${commandButton(`git show ${c.id}`,esc(refLabel(c.id)),'terminal-ref')}<code>${esc(c.id)}</code></div>${resolutionNote(c,o.version.requestedYear)}`;}
    if(o.kind==='diff')return `<div class="terminal-result-line">${t('diffResult')}: ${esc(refLabel(o.diff.a.commitId))} ↔ ${esc(refLabel(o.diff.b.commitId))}<span>${fmt('diffSummary',{changed:o.diff.rows.filter(r=>['changed','added','removed'].includes(r.kind)).length,same:o.diff.rows.filter(r=>r.kind==='same').length,unknown:o.diff.rows.filter(r=>r.kind==='unknown').length})}</span></div>`;
    return `<div class="terminal-result-line">${esc(text(historyEngine.fields.get(o.field.fieldId)!.name))}: ${commandButton(`git show ${o.commit.id}`,`${o.commit.year} ${esc(text(o.commit.title))}`,'terminal-ref')}</div>`;
  }
  function terminal() {
    return `<section class="terminal-dock ${terminalOpen?'expanded':''}" data-figma-name="Command terminal" aria-label="${t('terminal')}">${terminalOpen?`<div class="terminal-title"><span>${t('terminal')}</span><span class="terminal-shortcuts">${t('completionHint')}</span>${btn('terminal-clear',t('clearTerminal'),'class="terminal-tool"')}${btn('terminal-toggle','⌄',`class="terminal-tool" aria-label="${t('collapseTerminal')}"`)}</div><div class="terminal-output" role="log" aria-label="${t('queryResults')}">${entries.length?entries.map(({execution,origin})=>`<article class="terminal-entry ${execution.ok?'':'failed'}"><div class="terminal-command"><span class="command-origin">${t(origin==='gui'?'uiAction':'commandAction')}</span><code>${esc(execution.command)}</code>${btn('fill-command','↗',`data-command="${esc(execution.command)}" aria-label="${t('inputCommand')}"`)}</div>${resultOutput(execution)}</article>`).join(''):`<div class="terminal-start">${['git branch --all','git help','git status'].map(c=>btn('fill-command',esc(c),`data-command="${esc(c)}" class="terminal-ref"`)).join('')}</div>`}</div>`:''}<form id="terminal-form" class="terminal-input-row"><button type="button" data-wb="terminal-toggle" class="terminal-label" aria-label="${terminalOpen?t('collapseTerminal'):t('expandTerminal')}" aria-expanded="${terminalOpen}">⌘ <span>${t('terminal')}</span><span>${terminalOpen?'⌄':'⌃'}</span></button><span class="prompt-chevron">›</span><input id="history-command" aria-label="${t('terminalLabel')}" value="${esc(inputDraft)}" placeholder="${t('terminalPlaceholder')}" autocomplete="off" spellcheck="false" data-figma-name="Terminal input" /><button type="submit" class="terminal-run">${t('run')} ↵</button></form><div class="command-completions" id="command-completions" role="listbox" hidden></div></section>`;
  }
  function status() {
    const c=commit(state().head);
    return `<span class="head-status" data-figma-name="Workbench HEAD"><span class="status-label">${t('currentVersion')}</span>${c?`${commandButton(`git show ${c.id}`,`<strong>HEAD</strong> ${esc(refLabel(c.id))}`,'head-link')}${state().headRequestedYear!=null&&state().headRequestedYear!==c.year?`<span class="head-request">${t('requested')} ${state().headRequestedYear}</span>`:''}`:`<span>${t('noHead')}</span>`}</span><span class="status-right">${state().comparison?btn('comparison',`${t('retainedComparison')} · ${esc(refLabel(state().comparison![0]))} ↔ ${esc(refLabel(state().comparison![1]))}`,'class="status-compare"'):''}<span class="dataset-label">${t('data')}</span></span>`;
  }
  function completions() {
    const input=document.querySelector<HTMLInputElement>('#history-command');
    const popup=document.querySelector<HTMLElement>('#command-completions');
    if(!input||!popup)return;
    inputDraft=input.value;
    const list=inputDraft.trim()?completeCommand(historyEngine,inputDraft,ctx()).slice(0,8):[];
    popup.hidden=!list.length;
    popup.innerHTML=list.map((c,i)=>btn('complete',`<code>${esc(c.value)}</code><span>${esc(text(c.label))}${c.year?` · ${c.year}`:''}</span>`,`role="option" aria-selected="${i===completionIndex}" data-command="${esc(c.value)}" class="${i===completionIndex?'active':''}"`)).join('');
  }
  function setDraft(command: string) { inputDraft=command; completionIndex=-1; const input=document.querySelector<HTMLInputElement>('#history-command'); if(input){input.value=command;input.focus();input.setSelectionRange(command.length,command.length);completions();} }
  function click(target: HTMLElement): boolean {
    const action=target.dataset.wb;
    if(!action)return false;
    if(action==='command')execute(target.dataset.command!);
    else if(action==='terminal-toggle'){terminalOpen=!terminalOpen;sessionStorage.setItem('gitworld-terminal-open',String(terminalOpen));options.render();if(terminalOpen)focusInput();}
    else if(action==='terminal-clear'){entries=[];options.render();focusInput();}
    else if(action==='fill-command'||action==='complete')setDraft(target.dataset.command!);
    else if(action==='graph-earlier'){graphExpanded=!graphExpanded;options.render();}
    else if(action==='graph-related'){graphRelated=!graphRelated;options.render();}
    else if(action==='history')options.update(navigate(state(),{panel:'history'}));
    else if(action==='snapshot'&&state().head){const c=commit(state().head)!;options.update(moveToCommit(state(),c,'snapshot'));}
    else if(action==='comparison') { compareDraft=null;options.update(navigate(state(),{panel:'compare'})); }
    else if(action==='compare-open'){compareDraft=[state().head?ref(commit(state().head)!):state().view.selectedCommit?ref(commit(state().view.selectedCommit)!):'','']; options.update(navigate(state(),{panel:'compare'}));}
    else if(action==='swap'){const a=document.querySelector<HTMLInputElement>('#compare-a')!,b=document.querySelector<HTMLInputElement>('#compare-b')!;compareDraft=[b.value,a.value];a.value=compareDraft[0];b.value=compareDraft[1];if(a.value&&b.value)execute(`git diff ${a.value} ${b.value}`);}
    else if(action==='endpoint-a'||action==='endpoint-b'){const a=document.querySelector<HTMLInputElement>('#compare-a')!,b=document.querySelector<HTMLInputElement>('#compare-b')!;if(action==='endpoint-a')a.value=target.dataset.ref!;else b.value=target.dataset.ref!;compareDraft=[a.value,b.value];}
    else if(action==='diff-filter'){diffFilter=target.dataset.filter as typeof diffFilter;options.render();}
    else if(action==='include-versions'){const relevant=historyDataset.commits.filter(c=>!state().view.scopeId||branch(c.branchId)?.scopeId===state().view.scopeId);if(relevant.length)options.update(setWindow(state(),Math.min(...relevant.map(c=>c.year)),Math.max(...relevant.map(c=>c.year))),'replace');}
    else if(action==='include-selected'){const c=commit(state().view.selectedCommit);if(c)options.update(setWindow(state(),Math.min(state().view.timeWindow[0],c.year),Math.max(state().view.timeWindow[1],c.year)),'replace');}
    return true;
  }
  function submit(form: HTMLFormElement) { if(form.id==='terminal-form'){const input=document.querySelector<HTMLInputElement>('#history-command')!;if(input.value.trim())execute(input.value,'command');return true;}if(form.id==='compare-form'){const a=(form.querySelector('#compare-a') as HTMLInputElement).value.trim(),b=(form.querySelector('#compare-b') as HTMLInputElement).value.trim();compareDraft=[a,b];execute(`git diff ${a} ${b}`);return true;}return false; }
  function input(target: HTMLInputElement){if(target.id==='history-command'){completionIndex=-1;completionSeed='';completions();}if(target.id==='compare-a'||target.id==='compare-b')compareDraft=[document.querySelector<HTMLInputElement>('#compare-a')!.value,document.querySelector<HTMLInputElement>('#compare-b')!.value];}
  function key(event: KeyboardEvent) {
    const input=event.target as HTMLInputElement;
    if(input.id!=='history-command')return false;
    if(event.key==='Tab'){if(completionIndex<0)completionSeed=input.value;const list=completeCommand(historyEngine,completionSeed,ctx());if(list.length){event.preventDefault();const nextIndex=(completionIndex+1)%list.length;setDraft(list[nextIndex].value);completionIndex=nextIndex;document.querySelector<HTMLElement>('#command-completions')!.hidden=true;}return true;}
    if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();historyIndex=Math.max(0,Math.min(commandHistory.length,historyIndex+(event.key==='ArrowUp'?-1:1)));setDraft(commandHistory[historyIndex]||'');return true;}
    if(event.key==='Escape'){document.querySelector<HTMLElement>('#command-completions')!.hidden=true;return true;}
    return false;
  }
  function beforeRender(){
    const graph=document.querySelector<HTMLElement>('.graph-scroll');
    if(graph)graphScroll={...graphScroll,left:graph.scrollLeft,top:graph.scrollTop};
  }
  function afterRender(){
    const output=document.querySelector<HTMLElement>('.terminal-output');if(output)output.scrollTop=output.scrollHeight;
    const graph=document.querySelector<HTMLElement>('.graph-scroll');
    if(graph){
      const selected=document.querySelector<HTMLElement>('.graph-version.selected');
      const process=state().view.processId||'', selectedId=state().view.selectedCommit||'';
      graph.scrollLeft=graphScroll.process===process?graphScroll.left:0;
      graph.scrollTop=graphScroll.process===process?graphScroll.top:0;
      if(selected&&graphScroll.selected!==selectedId){graph.scrollLeft=Math.max(0,selected.offsetLeft-graph.clientWidth/2);graph.scrollTop=Math.max(0,selected.offsetTop-graph.clientHeight/2);}
      graphScroll={left:graph.scrollLeft,top:graph.scrollTop,process,selected:selectedId};
    }
  }
  return {sidebar,tabs,content,inspector,terminal,status,click,submit,input,key,execute,beforeRender,afterRender,
    hasProcess:(id:string)=>historyDataset.branches.some(b=>b.processId===id),
    active:()=>state().view.panel!=='browse',
    data:historyDataset,
    validCommit:(id:string|null)=>Boolean(commit(id)),
  };
}
