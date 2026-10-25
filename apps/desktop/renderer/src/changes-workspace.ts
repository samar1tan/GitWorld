import type { HistoryLocale } from '@gitworld/domain';
import type { ClosePreparationResult, RepositoryDiff, ServiceMethods } from '@gitworld/contracts';
import type { EditorialCommit, EditorialCommitInput, EditorialIdentity, EditorialJson, EditorialStatus } from '../../../../packages/contracts/src/editorial-types.ts';
import { escapeHtml as esc, ServiceFailure } from './client.ts';
import { changesCopy as copy, type ChangesCopyKey } from './changes-copy.ts';
import { semanticChanges, semanticTitle } from './changes-diff.ts';
import { knowledgeLocalizedText, knowledgeMetadataLabel } from './knowledge-labels.ts';
import { knowledgeCopy } from './knowledge-copy.ts';
import { settingsShellCopy } from './settings-shell.ts';

type ChangePage = ServiceMethods['repository.changes']['result'];
type ChangeItem = ChangePage['items'][number];
type ChangeGroup = ChangeItem['group'];
type Mode = 'working' | 'staged';
type StagePlan = ServiceMethods['repository.stagePlan']['result'];
export type ChangesWorkspaceApi = {
  status(): Promise<EditorialStatus>;
  changes(params: ServiceMethods['repository.changes']['params']): Promise<ChangePage>;
  diff(params: ServiceMethods['repository.diff']['params']): Promise<RepositoryDiff>;
  stagePlan(params: ServiceMethods['repository.stagePlan']['params']): Promise<StagePlan>;
  stage(params: ServiceMethods['repository.stage']['params']): Promise<EditorialStatus>;
  unstage(params: ServiceMethods['repository.unstage']['params']): Promise<EditorialStatus>;
  commit(params: EditorialCommitInput): Promise<EditorialCommit>;
  log(params: ServiceMethods['repository.log']['params']): Promise<EditorialCommit[]>;
  branch(params: ServiceMethods['repository.branch']['params']): Promise<EditorialStatus>;
  switch(params: ServiceMethods['repository.switch']['params']): Promise<EditorialStatus>;
  checkout(params: ServiceMethods['repository.checkout']['params']): Promise<EditorialStatus>;
  revert(params: ServiceMethods['repository.revert']['params']): Promise<EditorialStatus>;
  abortRevert(): Promise<EditorialStatus>;
};
type Options = {
  locale: () => HistoryLocale; render: () => void; api: ChangesWorkspaceApi;
  onClose: () => void; onCommitted: (commit: EditorialCommit) => void | Promise<void>;
  onStatusChanged?: (status: EditorialStatus) => void;
  contributor?: () => EditorialIdentity | null;
  onEditContributor?: () => void | Promise<void>;
  onResumeImport?: () => void | Promise<unknown>; onResumeContext?:()=>void|Promise<unknown>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  label?: (id: string) => string;
};
const object = (value: unknown): value is Record<string, EditorialJson> => !!value && typeof value === 'object' && !Array.isArray(value);
const SHORT = (value: string) => value.length > 14 ? `${value.slice(0, 12)}…` : value;
const MESSAGE_KEY = 'gitworld-commit-input-v1';
const ATTEMPT_KEY = 'gitworld-commit-attempt-v1';
const groups: ChangeGroup[] = ['object', 'source', 'research', 'mapping', 'model', 'navigation', 'other'];
const groupFor = (path: string): ChangeGroup => path.startsWith('objects/') ? 'object' : path.startsWith('sources/') ? 'source' : path.startsWith('research/') ? 'research' : path.startsWith('mappings/') ? 'mapping' : path.startsWith('models/') ? 'model' : path.startsWith('navigation/') ? 'navigation' : 'other';

export function createChangesWorkspace(options: Options) {
  let visible = false, loading = false, loadingDiff = false, busy = false, bufferFailed = false, stale = false;
  let status: EditorialStatus | null = null, mode: Mode = 'working', page: ChangePage = { items: [], total: 0 };
  let group: ChangeGroup | 'all' = 'all', query = '', offset = 0, message = '', branchName = '';
  let activePath: string | null = null, activeMode: Mode = 'working', difference: RepositoryDiff['entries'][number] | null = null, fieldLimit = 60;
  let plan: StagePlan | null = null, commits: EditorialCommit[] = [], advancedOpen = false, abortConfirmation = false, supportingLimit = 40;
  let opened = false, commitOpen = false;
  let pageFilter: { mode: Mode; group: ChangeGroup | 'all'; query: string } = { mode: 'working', group: 'all', query: '' };
  let errorReason: string | null = null;
  let error: string | null = null, success: { kind: 'committed'; params: { oid: string } } | null = null, retry: (() => Promise<unknown>) | null = null;
  let pageSequence = 0, diffSequence = 0, refreshSequence = 0;
  let pending: Promise<unknown> | null = null, commitAttempt: EditorialCommitInput | null = null;
  const selected = { working: new Set<string>(), staged: new Set<string>() };
  const metadata = new Map<string, ChangeItem>();
  const storage = () => options.storage ?? localStorage;
  const t = (key: Exclude<ChangesCopyKey, 'select' | 'selectAll' | 'selected' | 'stagedCount' | 'workingCount' | 'commitCount' | 'range' | 'planSelected' | 'requiredCount' | 'commitSummary' | 'committed' | 'bce' | 'period' | 'scopeObjectCount' | 'scopeFieldCount'>) => copy(options.locale(), key);
  const count = (value: number) => new Intl.NumberFormat(options.locale()).format(value);
  const title = (item: ChangeItem) => options.locale() === 'zh-CN' ? item.title['zh-CN'] ?? item.title.en : item.title.en;
  const titleHtml = (item: ChangeItem) => `${esc(title(item))}${options.locale() === 'zh-CN' && !item.title['zh-CN'] && ['object', 'model'].includes(item.group) ? '<span class="changes-language">EN</span>' : ''}`;
  const itemKind = (item: ChangeItem) => item.metadataKind === 'context-definition' ? t('contextDefinition') : item.metadataKind === 'context-membership' ? t('contextMembership') : item.metadataKind === 'object-baseline' ? t('objectBaseline') : item.metadataKind === 'field-catalog' ? t('fieldCatalog') : item.metadataKind === 'catalog-baseline' ? t('catalogBaseline') : t(groups.includes(item.group) ? item.group : 'other');
  const selectionTitle = (item: ChangeItem) => item.metadataKind ? `${title(item)} · ${itemKind(item)}` : title(item);
  const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat(options.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); };
  const button = (action: string, label: string, extra = '', primary = false) => `<button type="button" class="changes-button${primary ? ' primary' : ''}" data-changes="${action}" ${extra}>${esc(label)}</button>`;
  const redraw = () => { if (visible) options.render(); };
  const itemFor = (path: string, at: Mode = mode): ChangeItem => metadata.get(`${at}:${path}`) ?? { path, kind: 'modified', title: { en: path }, group: groupFor(path) };
  function notifyStatus() { if (status) { try { options.onStatusChanged?.(structuredClone(status)); } catch { /* Observer errors cannot undo repository operations. */ } } }
  function cacheMessage() {
    try { storage().setItem(MESSAGE_KEY, message); bufferFailed = false; }
    catch { bufferFailed = true; }
  }
  function cacheAttempt() {
    try { if (commitAttempt) storage().setItem(ATTEMPT_KEY, JSON.stringify(commitAttempt)); else storage().removeItem(ATTEMPT_KEY); }
    catch { bufferFailed = true; }
  }
  function code(cause: unknown): string { return cause instanceof ServiceFailure ? cause.detail.code : cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'IO_ERROR'; }
  const navigationBlocked=()=>!!error&&errorReason==='navigation-operation-pending';
  const importBlocked = () => !!error && ['paired-import-pending', 'incomplete-paired-import'].includes(errorReason ?? '');
  function fail(cause: unknown, action: (() => Promise<unknown>) | null = null) { errorReason = cause instanceof ServiceFailure && typeof cause.detail.parameters?.reason === 'string' ? cause.detail.parameters.reason : null; error = typeof cause === 'string' ? cause : code(cause); retry = action; success = null; redraw(); }
  function errorHtml() {
    if (!error) return '';
    const message = navigationBlocked()?t('pendingContext'):importBlocked() ? t('pendingImport') : error === 'COMMIT_UNCERTAIN' ? t('uncertainCommit') : error === 'HEAD_CHANGED' ? t('headChanged') : error === 'STAGE_CHANGED' ? t('stageChanged') : error === 'VALIDATION_FAILED' ? t('validationFailed') : error === 'REVIEW_REQUIRED' ? t('dependenciesChanged') : error === 'SERVICE_UNAVAILABLE' ? t('unavailable') : error === 'MESSAGE_REQUIRED' ? t('messageRequired') : error === 'DIRTY_WORKTREE' ? t('workingBlock') : error === 'BRANCH_EXISTS' ? t('branchExists') : error === 'INVALID_BRANCH' ? t('invalidBranch') : error === 'REPOSITORY_BUSY' || error === 'OPERATION_IN_PROGRESS' ? t('operationBusy') : error === 'REFRESH_FAILED' ? t('refreshFailed') : t('failed');
    return `<div class="changes-notice" role="alert"><p>${esc(message)}</p><details><summary>${t('errorCode')}</summary><code>${esc(error)}</code></details>${navigationBlocked()&&options.onResumeContext?`<div class="changes-toolbar">${button('resume-context',t('resumeContext'),busy?'disabled':'')}</div>`:importBlocked() && options.onResumeImport ? `<div class="changes-toolbar">${button('resume-import', t('resumeImport'), busy ? 'disabled' : '')}</div>` : retry ? `<div class="changes-toolbar">${button('retry', t('retry'), busy ? 'disabled' : '')}</div>` : ''}</div>`;
  }
  function listHtml() {
    return `<aside class="changes-list-panel"><nav class="changes-list-tabs" role="tablist" aria-label="${t('changes')}">${(['working', 'staged'] as const).map(value => `<button type="button" role="tab" aria-selected="${mode === value}" data-changes="mode" data-mode="${value}">${t(value)} · ${count(value === 'working' ? status?.unstaged.length ?? 0 : status?.staged.length ?? 0)}</button>`).join('')}</nav>
      <div class="changes-list-controls"><form class="changes-filter" data-changes-form="filter"><label class="changes-field changes-filter-query">${t('search')}<input data-changes-input="query" value="${esc(query)}" maxlength="500"></label><select data-changes-change="group" aria-label="${t('changeType')}"><option value="all">${t('all')}</option>${groups.map(value => `<option value="${value}" ${group === value ? 'selected' : ''}>${t(value)}</option>`).join('')}</select><button class="changes-button" type="submit" ${busy || loading ? 'disabled' : ''}>${t('applyFilter')}</button></form>
      <div class="changes-selection"><details data-changes-selection><summary class="changes-button">${t('selection')}</summary><div class="changes-selection-actions">${button('select-page', t('selectPage'), busy || loading || !page.items.length ? 'disabled' : '')}${button('select-all', copy(options.locale(), 'selectAll', { count: page.total }), busy || loading || !page.total ? 'disabled' : '')}${button('clear', t('clear'), busy || !selected[mode].size ? 'disabled' : '')}</div></details><span class="changes-count">${esc(copy(options.locale(), 'selected', { count: selected[mode].size }))}</span>${button(mode === 'working' ? 'stage-plan' : 'unstage', t(mode === 'working' ? 'stage' : 'unstage'), busy || !selected[mode].size ? 'disabled' : '', true)}</div></div>
      ${loading ? `<p role="status" class="changes-muted">${t('loading')}</p>` : ''}<div>${page.items.map(item => `<div class="changes-item" ${item.path === activePath && mode === activeMode ? 'aria-current="true"' : ''}><input type="checkbox" data-changes-change="selected" data-path="${esc(item.path)}" ${selected[mode].has(item.path) ? 'checked' : ''} ${busy ? 'disabled' : ''} aria-label="${esc(copy(options.locale(), 'select', { title: selectionTitle(item) }))}"><button type="button" class="changes-item-open" data-changes="item" data-path="${esc(item.path)}"><strong>${titleHtml(item)}</strong><small>${itemKind(item)} · ${['added', 'modified', 'deleted', 'conflict'].includes(item.kind) ? t(item.kind as 'added' | 'modified' | 'deleted' | 'conflict') : esc(item.kind)}</small></button></div>`).join('')}</div>${!page.items.length && !loading ? `<p class="changes-empty">${t('noChanges')}</p>` : ''}
      ${page.total ? `<div class="changes-page">${button('previous', t('previous'), offset === 0 || loading ? 'disabled' : '')}<span>${esc(copy(options.locale(), 'range', { from: offset + 1, to: Math.min(page.total, offset + page.items.length), total: page.total }))}</span>${button('next', t('next'), offset + 40 >= page.total || loading ? 'disabled' : '')}</div>` : ''}</aside>`;
  }
  const year = (value: number) => value < 0 ? copy(options.locale(), 'bce', { year: Math.abs(value) }) : new Intl.NumberFormat(options.locale(), { useGrouping: false }).format(value);
  const idLabel = (value: string) => options.label?.(value) ?? value;
  const valueList = (entries: [string, string][]) => `<dl class="changes-value-fields">${entries.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${value}</dd>`).join('')}</dl>`;
  const rawValue = (value: EditorialJson, label: string = t('raw')) => `<details><summary>${esc(label)}</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`;
  function scopeHtml(value: Record<string, EditorialJson>): string {
    const ids = (input: EditorialJson | undefined) => Array.isArray(input) ? [...new Set(input.filter((item): item is string => typeof item === 'string' && !!item))] : [];
    const navigation=object(value.navigation)?value.navigation:null;
    const objectIds = ids(value.objectIds), fieldIds = ids(value.fieldIds);
    const fieldNames = fieldIds.flatMap(id => { const supplied = options.label?.(id), name = supplied && supplied !== id ? supplied : knowledgeMetadataLabel(id, options.locale()); return name && name !== id ? [name] : []; });
    const period = Array.isArray(value.timeWindow) && value.timeWindow.length === 2 && value.timeWindow.every(item => typeof item === 'number') ? copy(options.locale(), 'period', { from: year(value.timeWindow[0] as number), to: year(value.timeWindow[1] as number) }) : t('noDateFilter');
    return `<div class="changes-scope-value">${valueList([
      ...(navigation?[[t('navigationRecipe'),`${esc(String(navigation.revision))}${rawValue(navigation,t('raw'))}`] as [string,string]]:[]),
      ...(typeof value.label === 'string' && value.label ? [[t('scopeName'), esc(value.label)] as [string, string]] : []),
      [t('scopeQuery'), typeof value.query === 'string' && value.query ? esc(value.query) : t('noNameFilter')],
      [t('scopePeriod'), esc(period)],
      [t('scopeObjects'), objectIds.length ? esc(copy(options.locale(), 'scopeObjectCount', { count: objectIds.length })) : t('noObjectFilter')],
      [t('scopeFields'), fieldIds.length ? esc(copy(options.locale(), 'scopeFieldCount', { count: fieldIds.length })) + (fieldNames.length ? `<div class="changes-scope-labels">${fieldNames.map(esc).join('<br>')}</div>` : '') : t('noFieldFilter')],
    ])}${objectIds.length || fieldIds.length ? `<details><summary>${t('scopeIdentifiers')}</summary>${valueList([[t('scopeObjects'), objectIds.length ? objectIds.map(id => `<code>${esc(id)}</code>`).join('<br>') : t('noObjectFilter')], [t('scopeFields'), fieldIds.length ? fieldIds.map(id => `<code>${esc(id)}</code>`).join('<br>') : t('noFieldFilter')]])}</details>` : ''}</div>`;
  }
  function endpointHtml(value: EditorialJson | undefined, side: 'endpointA' | 'endpointB'): string {
    if (!object(value)) return `<div class="changes-value-block"><strong>${t(side)}</strong>${t('notSet')}</div>`;
    const fallback = typeof value.label === 'string' && value.label ? value.label : t('notSet');
    const labels=object(value.labels)&&Object.values(value.labels).every(label=>typeof label==='string')?value.labels as Record<string,string>:undefined,selected=knowledgeLocalizedText(labels,options.locale(),fallback),english=options.locale()==='zh-CN'&&/^en(?:-|$)/i.test(selected.language??'');
    return `<div class="changes-value-block"><strong${selected.language?` lang="${esc(selected.language)}"`:''}>${t(side)} · ${esc(selected.text)}${english?`<span class="knowledge-language" title="${esc(knowledgeCopy(options.locale(),'englishSource'))}">EN</span>`:''}</strong>${typeof value.year === 'number' ? `<span>${esc(year(value.year))}</span>` : ''}${typeof value.historicalRef === 'string' ? `<small>${t('historicalRef')} · ${esc(value.historicalRef)}</small>` : ''}${typeof value.repositoryRevision === 'string' ? `<small>${t('dataRevision')} · <code title="${esc(value.repositoryRevision)}">${esc(SHORT(value.repositoryRevision))}</code></small>` : ''}</div>`;
  }
  function valueHtml(value: EditorialJson | undefined, raw = false, context: ChangesCopyKey | null = null, depth = 0): string {
    if (value === undefined) return `<span class="changes-muted">${t('notPresent')}</span>`;
    if (raw) return rawValue(value, t('sourceRecord'));
    if (value === null) return `<span class="changes-muted">${t(context === 'fixedComparison' ? 'noComparison' : 'notSet')}</span>`;
    if (typeof value === 'string') return context==='organizationDecision'&&['user-organization','source-profile'].includes(value)?t(value==='user-organization'?'userOrganization':'sourceProfile'):value ? esc(value) : `<span class="changes-muted">${t('notSet')}</span>`;
    if (typeof value === 'number') return esc(new Intl.NumberFormat(options.locale(), { maximumFractionDigits: 12 }).format(value));
    if (typeof value === 'boolean') return t(value ? 'yes' : 'no');
    if (Array.isArray(value)) return value.length ? value.map(item => `<div class="changes-value-block">${valueHtml(item, false, null, depth + 1)}</div>`).join('') : `<span class="changes-muted">${t(context === 'evidence' ? 'noEvidence' : context === 'openQuestions' ? 'noOpenQuestions' : 'noneRecorded')}</span>`;
    if(context==='contextProfile')return rawValue(value,t('contextProfile'));
    if (context === 'scope') return scopeHtml(value);
    if (context === 'fixedComparison') return endpointHtml(value.a, 'endpointA') + endpointHtml(value.b, 'endpointB');
    if (value.kind === 'text' && typeof value.value === 'string') return esc(value.value);
    if (value.kind === 'entity' && typeof value.objectId === 'string') return esc(idLabel(value.objectId));
    if (value.kind === 'boolean' && typeof value.value === 'boolean') return t(value.value ? 'yes' : 'no');
    if (value.kind === 'unknown') return t('unknownValue');
    if (value.kind === 'absent') return t('absentValue');
    if (value.kind === 'coordinate') return `${esc(value.latitude)}, ${esc(value.longitude)}`;
    if (value.kind === 'number') return `${valueHtml(value.value)}${typeof value.unit === 'string' ? ` · ${esc(idLabel(value.unit))}` : ''}${value.lowerBound !== undefined || value.upperBound !== undefined ? valueList([[t('lowerBound'), valueHtml(value.lowerBound)], [t('upperBound'), valueHtml(value.upperBound)]]) : ''}`;
    if (value.kind === 'time' && object(value.value)) return valueHtml(value.value, false, 'temporalScope', depth + 1);
    if (value.kind === 'raw') return rawValue(value.value, t('sourceRecord'));
    if (typeof value.earliestYear === 'number' && typeof value.latestYear === 'number') {
      return esc(value.earliestYear === value.latestYear ? year(value.earliestYear) : copy(options.locale(), 'period', { from: year(value.earliestYear), to: year(value.latestYear) }));
    }
    if (object(value.point) || object(value.start) || object(value.end)) return valueList([
      ...(object(value.point) ? [[t('temporalScope'), valueHtml(value.point, false, null, depth + 1)] as [string, string]] : []),
      ...(object(value.start) ? [[t('start'), valueHtml(value.start, false, null, depth + 1)] as [string, string]] : []),
      ...(object(value.end) ? [[t('end'), valueHtml(value.end, false, null, depth + 1)] as [string, string]] : []),
    ]);
    if (typeof value.propertyId === 'string' && value.value !== undefined) return valueList([[idLabel(value.propertyId), valueHtml(value.value, false, null, depth + 1)]]);
    if (typeof value.title === 'string' || typeof value.sourceId === 'string') {
      const label = typeof value.title === 'string' ? value.title : idLabel(String(value.sourceId));
      return `<strong>${esc(label)}</strong>${typeof value.citation === 'string' ? `<span>${esc(value.citation)}</span>` : ''}${typeof value.locator === 'string' ? `<small>${t('locator')} · ${esc(value.locator)}</small>` : ''}${typeof value.repositoryRevision === 'string' ? `<small>${t('dataRevision')} · <code title="${esc(value.repositoryRevision)}">${esc(SHORT(value.repositoryRevision))}</code></small>` : ''}${object(value.sourceIdentity) ? `<small>${valueHtml(value.sourceIdentity, false, null, depth + 1)}</small>` : ''}`;
    }
    if (typeof value.provider === 'string' && typeof value.externalId === 'string') return `${esc(value.provider)} · ${esc(value.externalId)}`;
    const fields = Object.entries(value);
    if (!fields.length) return `<span class="changes-muted">${t('noneRecorded')}</span>`;
    if (depth >= 2) return rawValue(value, t('structuredValue'));
    const labels: Record<string, string> = { title: t('title'), description: t('description'), locator: t('locator'), citation: t('citation'), repositoryRevision: t('dataRevision'), sourceRevision: t('sourceRevision'), precision: t('precision'), lowerBound: t('lowerBound'), upperBound: t('upperBound'), unit: t('unit') };
    return valueList(fields.slice(0, 8).map(([key, item]) => [labels[key] ?? idLabel(key), valueHtml(item, key === 'raw' || key === 'record', null, depth + 1)])) + (fields.length > 8 ? rawValue(value) : '');
  }
  function fieldDetail(value: string) {
    if (!value) return '';
    const known = value === 'geo:location' ? t('location') : value === 'geo:representative-location' ? t('representativeLocation') : value.startsWith('pleiades:attested-name:') ? `${t('attestedName')} · ${value.split(':').at(-1)}` : value === 'pleiades:coverage-start' ? t('coverageStart') : value === 'pleiades:coverage-end' ? t('coverageEnd') : options.label?.(value) ?? value;
    return `<small>${esc(known)}</small>`;
  }
  function diffHtml() {
    if (loadingDiff) return `<p role="status">${t('loading')}</p>`;
    if (!activePath || !difference) return `<p class="changes-empty">${t('chooseItem')}</p>`;
    const item = itemFor(activePath, activeMode), navigation=difference.navigation, rows = navigation?.kind==='context-membership'?[]:semanticChanges(difference.before, difference.after);
    const navigationHtml=navigation?.kind==='context-membership'?`<section class="changes-navigation-summary"><h3>${t('contextMembership')}</h3>${valueList([[t('membershipBefore'),count(navigation.before)],[t('membershipAfter'),count(navigation.after)],[t('membershipAdded'),count(navigation.added)],[t('membershipRemoved'),count(navigation.removed)],[t('membershipModified'),count(navigation.modified)]])}<details><summary>${t('membershipIdentifiers')} · ${count(navigation.totalObjects)}</summary>${navigation.objects.map(value=>`<p><code>${esc(value.objectId)}</code> · ${t(value.kind==='removed'?'deleted':value.kind)}</p>`).join('')}<small>${count(navigation.objects.length)} / ${count(navigation.totalObjects)}</small></details></section>`:'';
    return `<section><header class="changes-diff-heading"><h2>${titleHtml(item)}</h2><p>${t(activeMode === 'staged' ? 'stagedBasis' : 'workingBasis')}</p>${status?.staged.some(change => change.path === activePath) && status.unstaged.some(change => change.path === activePath) ? `<p class="changes-notice">${t('alsoWorking')}</p>` : ''}<details><summary>${t('path')}</summary><code>${esc(activePath)}</code></details></header>${navigationHtml}${rows.length ? `<table class="changes-diff-table"><thead><tr><th>${t('field')}</th><th>${t('before')}</th><th>${t('after')}</th></tr></thead><tbody>${rows.slice(0, fieldLimit).map(row => `<tr><td>${row.label ? t(row.label as Exclude<ChangesCopyKey, 'select' | 'selectAll' | 'selected' | 'stagedCount' | 'workingCount' | 'commitCount' | 'range' | 'planSelected' | 'requiredCount' | 'commitSummary' | 'committed' | 'bce' | 'period' | 'scopeObjectCount' | 'scopeFieldCount'>) : ''}${fieldDetail(row.detail)}</td><td class="changes-diff-value">${valueHtml(row.before, row.raw, row.label)}</td><td class="changes-diff-value">${valueHtml(row.after, row.raw, row.label)}</td></tr>`).join('')}</tbody></table>${rows.length > fieldLimit ? `<div class="changes-toolbar">${button('more-fields', t('showMore'))}</div>` : ''}` : navigationHtml?'':`<p class="changes-empty">${t('noDifference')}</p>`}<details class="changes-muted"><summary>${t('raw')}</summary><div class="changes-diff-value"><h3>${t('before')}</h3><pre>${esc(JSON.stringify(difference.before, null, 2))}</pre><h3>${t('after')}</h3><pre>${esc(JSON.stringify(difference.after, null, 2))}</pre></div></details></section>`;
  }
  function planHtml() {
    if (!plan) return '';
    const counts = new Map<ChangeGroup, number>(); for (const path of plan.required) { const key = groupFor(path); counts.set(key, (counts.get(key) ?? 0) + 1); }
    return `<section class="changes-plan"><h2>${t('stagingPlan')}</h2><p>${esc(copy(options.locale(), 'planSelected', { count: plan.selected.length }))}</p>${plan.required.length ? `<h3>${t('required')} · ${esc(copy(options.locale(), 'requiredCount', { count: plan.required.length }))}</h3><p>${[...counts].map(([group, count]) => `${t(group)} ${count}`).join(' · ')}</p><ul class="changes-plan-list">${plan.required.slice(0, supportingLimit).map(path => `<li><button type="button" data-changes="dependency" data-path="${esc(path)}">${esc(selectionTitle(itemFor(path, 'working')))}</button></li>`).join('')}</ul>` : `<p>${t('noExtra')}</p>`}${plan.missing.length ? `<p class="changes-notice">${t('missing')}</p><ul class="changes-plan-list">${plan.missing.slice(0, supportingLimit).map(path => `<li><code>${esc(path)}</code></li>`).join('')}</ul>` : ''}${plan.required.length > supportingLimit || plan.missing.length > supportingLimit ? button('more-supporting', t('moreSupporting')) : ''}<div class="changes-toolbar">${button('confirm-stage', t(plan.required.length ? 'includeRequired' : 'confirmStage'), busy || plan.missing.length ? 'disabled' : '', true)}${button('cancel-plan', t('cancelPlan'), busy ? 'disabled' : '')}</div></section>`;
  }
  function advancedHtml() {
    const expanded = advancedOpen || status?.branch === null || !!status?.revert;
    return `<section class="changes-data-tools">${button('advanced', t('advanced'), `aria-expanded="${expanded}" aria-controls="changes-advanced"`)}${expanded ? `<div class="changes-advanced" id="changes-advanced" data-changes-advanced><details><summary>${t('revisionDetails')}</summary><dl><dt>${t('branch')}</dt><dd>${esc(status?.branch ?? t('detached'))}</dd><dt>${t('head')}</dt><dd><code>${esc(status?.head ?? '')}</code></dd><dt>${t('tree')}</dt><dd><code>${esc(status?.stagedTree ?? '')}</code></dd></dl></details><form data-changes-form="branch"><label class="changes-field">${t('branchName')}<input data-changes-input="branch" value="${esc(branchName)}" maxlength="120" ${busy ? 'disabled' : ''}></label><div class="changes-toolbar">${button('create-branch', t('createBranch'), busy ? 'disabled' : '')}${button('switch-branch', t('switchBranch'), busy ? 'disabled' : '')}</div></form><h3>${t('dataRevisions')}</h3><div class="changes-log">${commits.map(commit => `<article><strong>${esc(commit.message)}</strong><small>${esc(date(commit.authoredAt))}</small><details><summary>${t('revisionDetails')}</summary><dl><dt>${t('author')}</dt><dd>${esc(commit.author.name)}</dd><dt>${t('head')}</dt><dd><code>${esc(commit.oid)}</code></dd></dl></details><div class="changes-toolbar">${button('checkout-revision', t('checkoutRevision'), `data-oid="${esc(commit.oid)}" ${busy ? 'disabled' : ''}`)}${button('reverse', t('reverse'), `data-oid="${esc(commit.oid)}" ${busy || status?.revert ? 'disabled' : ''}`)}</div></article>`).join('') || `<p class="changes-muted">${t('noHistory')}</p>`}</div></div>` : ''}</section>`;
  }
  function authorHtml() {
    const author=options.contributor?.();if(!author)return '';
    const text=(key:'author'|'editAuthor'|'pendingAuthor')=>settingsShellCopy(options.locale(),key);
    return `<div class="changes-author"><small>${text('author')}</small><code>${esc(`${author.name} <${author.email}>`)}</code>${options.onEditContributor?button('edit-author',text('editAuthor'),busy?'disabled':''):''}${commitAttempt?`<p class="changes-muted">${text('pendingAuthor')}</p>`:''}</div>`;
  }
  function commitHtml() {
    if (!commitOpen) return '';
    return `<aside class="changes-commit-panel" id="changes-commit-editor" aria-labelledby="changes-commit-title"><header class="changes-commit-heading"><h2 id="changes-commit-title">${t('commit')}</h2>${button('close-commit', '×', `aria-label="${t('closeCommit')}" ${busy ? 'disabled' : ''}`)}</header><p class="changes-commit-summary">${esc(copy(options.locale(), 'commitSummary', { staged: status?.staged.length ?? 0, working: status?.unstaged.length ?? 0 }))}</p>${authorHtml()}<form data-changes-form="commit" novalidate><label class="changes-field">${t('purpose')}<textarea data-changes-input="message" maxlength="2000" rows="4" placeholder="${t('purposePlaceholder')}" ${busy ? 'disabled' : ''}>${esc(message)}</textarea></label><button class="changes-button primary" type="submit" ${busy || loading || stale || plan || !status?.staged.length || status.branch === null || status.conflicts.length ? 'disabled' : ''}>${t('commit')}</button></form>${!status?.staged.length ? `<p class="changes-muted">${t('noStaged')}</p>` : ''}${bufferFailed ? `<p class="changes-notice">${t('bufferedMessage')}</p>` : ''}</aside>`;
  }
  function content() {
    return `<div class="changes-shell${commitOpen ? ' has-commit-editor' : ''}">${listHtml()}<main class="changes-main"><header class="changes-heading"><h1>${t('changes')}</h1><div class="changes-heading-actions">${button('refresh', t('refresh'), busy ? 'disabled' : '')}${button('open-commit', copy(options.locale(), 'commitCount', { count: status?.staged.length ?? 0 }), `aria-controls="changes-commit-editor" aria-expanded="${commitOpen}" ${busy || (!status?.staged.length && !message.trim() && !commitAttempt && !status?.revert) ? 'disabled' : ''}`, true)}</div></header>${errorHtml()}${success ? `<p class="changes-notice success" role="status">${esc(copy(options.locale(), success.kind, { oid: SHORT(success.params.oid) }))}</p>` : ''}${status?.branch === null ? `<p class="changes-notice">${t('detachedNotice')}</p>` : ''}${status?.revert ? `<div class="changes-notice"><p>${t(status.conflicts.length ? 'reverseConflict' : 'reversing')}</p><div class="changes-toolbar">${button('ask-abort', t('abortReverse'), busy ? 'disabled' : '')}</div></div>` : ''}${planHtml()}${diffHtml()}${advancedHtml()}</main>${commitHtml()}${abortConfirmation ? `<div class="changes-inline-dialog" role="dialog" aria-modal="true" aria-labelledby="changes-abort-question"><section><p id="changes-abort-question">${t('abortConfirm')}</p><div class="changes-toolbar">${button('cancel-abort', t('keep'))}${button('confirm-abort', t('abort'))}</div></section></div>` : ''}</div>`;
  }
  function openCommit() {
    commitOpen = true; redraw();
    document.querySelector<HTMLTextAreaElement>('[data-changes-input="message"]')?.focus({ preventScroll: true });
  }
  function closeCommit() {
    cacheMessage(); commitOpen = false; redraw();
    document.querySelector<HTMLButtonElement>('[data-changes="open-commit"]')?.focus({ preventScroll: true });
  }
  async function loadPage() {
    const sequence = ++pageSequence, requestedMode = mode, requestedGroup = group, requestedQuery = query.trim(); loading = true; redraw();
    try {
      const value = await options.api.changes({ mode: requestedMode, ...(requestedGroup !== 'all' ? { group: requestedGroup } : {}), ...(requestedQuery ? { query: requestedQuery } : {}), offset, limit: 40 });
      if (sequence !== pageSequence || requestedMode !== mode) return;
      page = value; pageFilter = { mode: requestedMode, group: requestedGroup, query: requestedQuery }; for (const item of value.items) metadata.set(`${requestedMode}:${item.path}`, item);
    } catch (cause) { if (sequence === pageSequence) fail(cause, loadPage); }
    finally { if (sequence === pageSequence) { loading = false; redraw(); } }
  }
  async function loadDiff(path: string, at: Mode = mode) {
    const sequence = ++diffSequence; activePath = path; activeMode = at; difference = null; loadingDiff = true; fieldLimit = 60; redraw();
    try {
      const value = await options.api.diff({ mode: at, paths: [path] });
      if (sequence !== diffSequence || activePath !== path || activeMode !== at) return;
      difference = value.entries.find(entry => entry.path === path) ?? null;
      const readable = difference ? semanticTitle(difference.before, difference.after) : null;
      if (readable) { const old = itemFor(path, at); metadata.set(`${at}:${path}`, { ...old, title: readable }); }
      if (status && value.status.head !== status.head) { stale = true; fail('HEAD_CHANGED', refresh); }
      else if (status && value.status.stagedTree !== status.stagedTree) { stale = true; fail('STAGE_CHANGED', refresh); }
      else { status = value.status; notifyStatus(); }
    } catch (cause) { if (sequence === diffSequence) fail(cause, () => loadDiff(path, at)); }
    finally { if (sequence === diffSequence) { loadingDiff = false; redraw(); } }
  }
  async function refresh() {
    const sequence = ++refreshSequence; error = null; retry = null; plan = null; pageSequence++; diffSequence++; difference = null; loadingDiff = false; loading = true; redraw();
    try {
      const [current, history] = await Promise.all([options.api.status(), options.api.log({ limit: 20 })]);
      if (sequence !== refreshSequence) return;
      if (status?.head !== current.head) metadata.clear();
      status = current; commits = history; stale = false; if (current.revert) commitOpen = true; notifyStatus();
      const working = new Set(current.unstaged.map(value => value.path)), staged = new Set(current.staged.map(value => value.path));
      selected.working = new Set([...selected.working].filter(path => working.has(path))); selected.staged = new Set([...selected.staged].filter(path => staged.has(path)));
      const activeStillExists = activePath && (activeMode === 'working' ? working : staged).has(activePath);
      if (!activeStillExists) { activePath = null; difference = null; diffSequence++; }
      await loadPage();
      if (sequence === refreshSequence && activePath) await loadDiff(activePath, activeMode);
    } catch (cause) { if (sequence === refreshSequence) fail(cause, refresh); }
    finally { if (sequence === refreshSequence) { loading = false; redraw(); } }
  }
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    busy = true; error = null; retry = null; success = null; redraw();
    pending = (async () => {
      try { await operation(); }
      catch (cause) { fail(cause); }
      finally { busy = false; pending = null; redraw(); }
    })();
    await pending;
  }
  async function loadSupportingMetadata() {
    const currentPlan = plan;
    const paths = currentPlan?.required.slice(0, supportingLimit).filter(path => !metadata.has(`working:${path}`)) ?? [];
    if (!paths.length) return;
    for (let offset = 0; offset < paths.length; offset += 200) {
      const selectedPaths = paths.slice(offset, offset + 200);
      const page = await options.api.changes({ mode: 'working', paths: selectedPaths, offset: 0, limit: 200 });
      if (plan !== currentPlan) return;
      for (const item of page.items) if (selectedPaths.includes(item.path)) metadata.set(`working:${item.path}`, item);
    }
  }
  async function reviewStaging() {
    if (!selected.working.size) return;
    await run(async () => { plan = await options.api.stagePlan({ paths: [...selected.working].sort() }); supportingLimit = 40; for (const path of plan.required) metadata.delete(`working:${path}`); try { await loadSupportingMetadata(); } catch (cause) { plan = null; throw cause; } });
  }
  async function stage() {
    if (!plan || plan.missing.length) return;
    const paths = [...new Set([...plan.selected, ...plan.required])].sort();
    await run(async () => {
      try { status = await options.api.stage({ paths }); }
      catch (cause) { if (code(cause) === 'REVIEW_REQUIRED') { plan = null; fail(cause, reviewStaging); return; } throw cause; }
      selected.working.clear(); plan = null; mode = 'staged'; offset = 0; activeMode = 'staged'; notifyStatus(); await refresh(); if (error) { error = 'REFRESH_FAILED'; retry = refresh; }
    });
  }
  async function unstage() {
    if (!selected.staged.size) return;
    const paths = [...selected.staged].sort();
    await run(async () => { status = await options.api.unstage({ paths }); selected.staged.clear(); mode = 'working'; activeMode = 'working'; offset = 0; notifyStatus(); await refresh(); if (error) { error = 'REFRESH_FAILED'; retry = refresh; } });
  }
  async function recordCommit(useAttempt = false) {
    if (busy) return;
    if (!status) { await refresh(); return; }
    if (!useAttempt && (loading || !status.staged.length || status.conflicts.length || !status.branch || stale || plan)) return;
    commitOpen = true;
    if (!useAttempt && !message.trim()) { fail('MESSAGE_REQUIRED'); return; }
    if (!useAttempt) { commitAttempt = { operationId: crypto.randomUUID(), expectedHead: status.head, expectedTree: status.stagedTree, message: message.trim() }; cacheAttempt(); }
    if (!commitAttempt) return;
    const attempt = structuredClone(commitAttempt);
    let completed: EditorialCommit | null = null;
    await run(async () => {
      let committed: EditorialCommit;
      try { committed = await options.api.commit(attempt); }
      catch (cause) {
        const value = code(cause);
        if (['HEAD_CHANGED', 'STAGE_CHANGED'].includes(value)) { stale = true; commitAttempt = null; cacheAttempt(); fail(cause, refresh); }
        else if (value === 'SERVICE_UNAVAILABLE' || value === 'IO_ERROR') fail('COMMIT_UNCERTAIN', () => recordCommit(true));
        else { commitAttempt = null; cacheAttempt(); fail(cause); }
        return;
      }
      commitAttempt = null; cacheAttempt(); message = ''; cacheMessage(); commitOpen = false;
      await refresh();
      success = { kind: 'committed', params: { oid: committed.oid } }; if (error) { error = 'REFRESH_FAILED'; retry = refresh; }
      completed = committed;
    });
    if (completed) {
      try { await options.onCommitted(completed); }
      catch { error = 'REFRESH_FAILED'; retry = refresh; redraw(); }
    }
  }
  async function dataOperation(operation: () => Promise<EditorialStatus>) {
    await run(async () => { status = await operation(); notifyStatus(); plan = null; await refresh(); if (error) { error = 'REFRESH_FAILED'; retry = refresh; } });
  }
  async function open(focus?: string | { path?: string; mode?: Mode }) {
    visible = true;
    if (!opened) {
      opened = true;
      try {
        message = storage().getItem(MESSAGE_KEY) ?? '';
        const value = JSON.parse(storage().getItem(ATTEMPT_KEY) ?? 'null') as EditorialCommitInput | null;
        if (value && typeof value.operationId === 'string' && typeof value.expectedHead === 'string' && /^[a-f0-9]{40}$/.test(value.expectedHead) && typeof value.expectedTree === 'string' && /^[a-f0-9]{40}$/.test(value.expectedTree) && typeof value.message === 'string') commitAttempt = value;
      } catch { /* Invalid cached input cannot authorize a repository operation. */ }
    }
    if (typeof focus === 'object' && focus.mode) mode = focus.mode;
    await refresh();
    const path = typeof focus === 'string' ? focus : focus?.path;
    if (path) await loadDiff(path, mode);
    if (message.trim() || commitAttempt) commitOpen = true;
    if (commitAttempt) { error = 'COMMIT_UNCERTAIN'; retry = () => recordCommit(true); }
    redraw();
  }
  async function click(target: HTMLElement) {
    const action = target.dataset.changes;
    if (busy) return;
    try {
      if(action==='resume-context'&&navigationBlocked())await options.onResumeContext?.();
      else if (action === 'resume-import' && importBlocked()) await options.onResumeImport?.();
      else if (action === 'open-commit') openCommit();
      else if (action === 'close-commit') closeCommit();
      else if (action === 'advanced') { advancedOpen = !advancedOpen; redraw(); }
      else if (action === 'edit-author') await options.onEditContributor?.();
      else if (action === 'mode' && (target.dataset.mode === 'working' || target.dataset.mode === 'staged')) {
        mode = target.dataset.mode; offset = 0; pageSequence++; plan = null; await loadPage();
        if (activePath && (mode === 'working' ? status?.unstaged : status?.staged)?.some(value => value.path === activePath)) await loadDiff(activePath, mode);
        else { activePath = null; difference = null; diffSequence++; redraw(); }
      }
      else if ((action === 'item' || action === 'dependency') && target.dataset.path) await loadDiff(target.dataset.path, action === 'dependency' ? 'working' : mode);
      else if (action === 'refresh') await refresh();
      else if (action === 'retry' && retry) await retry();
      else if (action === 'select-page') { page.items.forEach(value => selected[mode].add(value.path)); plan = null; redraw(); }
      else if (action === 'select-all') {
        const filter = { ...pageFilter }; plan = null;
        await run(async () => {
          for (let start = 0; ; start += 200) {
            const found = await options.api.changes({ mode: filter.mode, ...(filter.group !== 'all' ? { group: filter.group } : {}), ...(filter.query ? { query: filter.query } : {}), offset: start, limit: 200 });
            for (const item of found.items) { selected[filter.mode].add(item.path); metadata.set(`${filter.mode}:${item.path}`, item); }
            if (!found.items.length || start + found.items.length >= found.total) break;
          }
        });
      }
      else if (action === 'clear') { selected[mode].clear(); plan = null; redraw(); }
      else if (action === 'stage-plan') await reviewStaging();
      else if (action === 'confirm-stage') await stage();
      else if (action === 'cancel-plan') { plan = null; redraw(); }
      else if (action === 'more-supporting') await run(async () => { supportingLimit += 40; await loadSupportingMetadata(); });
      else if (action === 'unstage') await unstage();
      else if (action === 'more-fields') { fieldLimit += 60; redraw(); }
      else if (action === 'previous') { offset = Math.max(0, offset - 40); await loadPage(); }
      else if (action === 'next' && offset + 40 < page.total) { offset += 40; await loadPage(); }
      else if (action === 'create-branch' || action === 'switch-branch') {
        if (!branchName.trim()) { fail('INVALID_BRANCH'); return; }
        advancedOpen = true; await dataOperation(() => action === 'create-branch' ? options.api.branch({ name: branchName.trim() }) : options.api.switch({ name: branchName.trim() }));
      }
      else if (action === 'checkout-revision' && target.dataset.oid) { advancedOpen = true; await dataOperation(() => options.api.checkout({ oid: target.dataset.oid! })); }
      else if (action === 'reverse' && target.dataset.oid && status) { const expectedHead = status.head; advancedOpen = true; await dataOperation(() => options.api.revert({ commitOid: target.dataset.oid!, expectedHead, operationId: crypto.randomUUID() })); }
      else if (action === 'ask-abort') { abortConfirmation = true; redraw(); document.querySelector<HTMLButtonElement>('[data-changes="cancel-abort"]')?.focus(); }
      else if (action === 'cancel-abort') { abortConfirmation = false; redraw(); }
      else if (action === 'confirm-abort') { abortConfirmation = false; await dataOperation(() => options.api.abortRevert()); }
    } catch (cause) { fail(cause); }
  }
  async function submit(form: HTMLFormElement) {
    if (form.dataset.changesForm === 'commit') await recordCommit();
    else if (form.dataset.changesForm === 'filter') { offset = 0; await loadPage(); }
  }
  function input(target: HTMLInputElement | HTMLTextAreaElement) {
    if (busy) return;
    if (target.dataset.changesInput === 'query') query = target.value;
    else if (target.dataset.changesInput === 'branch') branchName = target.value;
    else if (target.dataset.changesInput === 'message') { message = target.value; commitOpen = true; if (commitAttempt) { commitAttempt = null; cacheAttempt(); } cacheMessage(); }
  }
  async function change(target: HTMLInputElement | HTMLSelectElement) {
    if (busy) return;
    if (target.dataset.changesChange === 'group' && (target.value === 'all' || groups.includes(target.value as ChangeGroup))) { group = target.value as ChangeGroup | 'all'; offset = 0; await loadPage(); }
    else if (target.dataset.changesChange === 'selected' && 'checked' in target && target.dataset.path) { if (target.checked) selected[mode].add(target.dataset.path); else selected[mode].delete(target.dataset.path); plan = null; redraw(); }
  }
  function key(event: KeyboardEvent) {
    if (!visible) return;
    if (abortConfirmation) {
      if (event.key === 'Escape') { event.preventDefault(); abortConfirmation = false; redraw(); }
      else if (event.key === 'Tab') {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('.changes-inline-dialog button')];
        if (buttons.length && event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)!.focus(); }
        else if (buttons.length && !event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
      return;
    }
    const target = event.target as Element | null;
    const selection = target?.closest<HTMLDetailsElement>('[data-changes-selection]');
    if (event.key === 'Escape' && selection?.open) { event.preventDefault(); selection.open = false; selection.querySelector<HTMLElement>('summary')?.focus(); return; }
    if (event.key === 'Escape' && commitOpen && target?.closest('.changes-commit-panel')) { event.preventDefault(); if (!busy) closeCommit(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (commitOpen) void recordCommit(); else openCommit(); }
  }
  function hasUnsavedChanges() { return !!message.trim() && bufferFailed; }
  async function prepareClose(): Promise<ClosePreparationResult> { if (pending) await pending; cacheMessage(); return hasUnsavedChanges() ? { ready: false, reason: 'unsaved-input' } : { ready: true }; }
  return { open, openCommit, refresh, content, click, submit, input, change, key, hasUnsavedChanges, prepareClose, hide: () => { cacheMessage(); visible = false; pageSequence++; diffSequence++; refreshSequence++; }, close: async () => { const ready = await prepareClose(); if (ready.ready) { visible = false; options.onClose(); } } };
}
