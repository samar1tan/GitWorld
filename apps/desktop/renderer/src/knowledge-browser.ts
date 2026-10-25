import { geoNaturalEarth1 } from 'd3-geo';
import type { HistoryLocale } from '@gitworld/domain';
import type { ServiceMethods, NavigationContextList, NavigationContextRead, NavigationScopePatch } from '@gitworld/contracts';
import type { ContextWorkspaceTarget } from './context-workspace.ts';
import type { EditorialStatus } from '../../../../packages/contracts/src/editorial-types.ts';
import type { KnowledgeDisplayText, KnowledgeObjectDetail, KnowledgeSourceHeader } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';
import type { PinnedResearchEvidence, ResearchContext } from '../../../../packages/contracts/src/research-types.ts';
import type { KnowledgeAssertion, KnowledgeHistory, KnowledgeObjectResult, KnowledgeQuery, KnowledgeQueryResult, KnowledgeState, KnowledgeStateDiff, KnowledgeStateField, KnowledgeText, KnowledgeTime, KnowledgeValue } from '../../../../packages/domain/src/knowledge.ts';
import { bridge, escapeHtml as esc, ServiceFailure } from './client.ts';
import { knowledgeCopy as copy, type KnowledgeCopyKey } from './knowledge-copy.ts';
import { initialKnowledgeBrowserState, isFixedKnowledgeState, parseKnowledgeBrowserState, applyNavigationScopePatch, type FixedKnowledgeState, type KnowledgeBrowserState, type KnowledgeBrowserView,type KnowledgeKindMode } from './knowledge-browser-state.ts';
import { parseResearchPeriod } from './research-draft.ts';
import { knowledgeDisplayCopy, knowledgeLocalizedText, knowledgeMetadataLabel, knowledgeQualifierLabel, knowledgeTimeLabel, knowledgeTypeLabel, knowledgeValueDisplay } from './knowledge-labels.ts';
import { groupKnowledgeSources, knowledgeSourceLocators, knowledgeSourceTitle } from './knowledge-sources.ts';
import { formatHistoricalDate, historicalDateRawTexts } from './historical-date.ts';

export type KnowledgeBrowserApi = {
  query(params: ServiceMethods['knowledge.query']['params']): Promise<KnowledgeQueryResult>;
  object(params: ServiceMethods['knowledge.object']['params']): Promise<KnowledgeObjectDetail>;
  state(params: ServiceMethods['knowledge.state']['params']): Promise<KnowledgeState>;
  history(params: ServiceMethods['knowledge.history']['params']): Promise<KnowledgeHistory>;
  diff(params: ServiceMethods['knowledge.diff']['params']): Promise<KnowledgeStateDiff>;
};
type Options = {
  locale: () => HistoryLocale; render: () => void; api: KnowledgeBrowserApi;
  repositoryStatus: () => Promise<EditorialStatus>;
  onFindData: (query?: KnowledgeQuery) => void | Promise<void>;
  onOpenChanges: () => void | Promise<void>;
  onResearch: (context: ResearchContext) => void | Promise<void>;
  onEdit?: (target: { objectId?: string; assertionId?: string; year?: number; observedRevision?: string }) => void | Promise<void>;
  onClose?: () => void;
  navigation?: { list(input: ServiceMethods['context.list']['params']): Promise<NavigationContextList>; get(input: ServiceMethods['context.get']['params']): Promise<NavigationContextRead> };
  onContext?: (target?: ContextWorkspaceTarget, resume?: boolean) => void | Promise<unknown>;
  modelArtifacts?:()=>{id:string;labels:KnowledgeText;revision:string;states:number;from:number;to:number}[];
  onModelArtifact?:(id:string,revision:string)=>void|Promise<unknown>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  onStateChange?: (state: KnowledgeBrowserState) => void;
  onObserved?: (event: KnowledgeBrowserObservation) => void;
};
export type KnowledgeBrowserObservation =
  | { type: 'object'; objectId: string }
  | { type: 'state'; objectId: string; year: number; revision: string }
  | { type: 'comparison'; a: FixedKnowledgeState; b: FixedKnowledgeState }
  | { type: 'evidence'; objectId: string; propertyId: string; assertionIds: string[]; revision: string };
export type KnowledgeBrowserIntent =
  | { type: 'scope'; patch: NavigationScopePatch }
  | { type: 'search'; query: KnowledgeQuery }
  | { type: 'show'; objectId: string; year?: number;includeUnreviewed?:boolean }
  | { type:'observations-version';objectId:string;revision:string;includeUnreviewed:boolean }
  | { type: 'checkout'; objectId: string; year: number }
  | { type: 'show-version'; reference: FixedKnowledgeState }
  | { type: 'preview-version'; reference: FixedKnowledgeState }
  | { type: 'compare'; a: FixedKnowledgeState; b: FixedKnowledgeState };
const STORAGE_KEY = 'gitworld-knowledge-view-v1';
const projection = geoNaturalEarth1().fitExtent([[20, 20], [980, 500]], { type: 'Sphere' });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const civil = (value: number) => Number.isSafeInteger(value) && value !== 0;
const short = (value: string) => value.length > 14 ? `${value.slice(0, 12)}…` : value;
const failure = (code: string): never => { throw { code }; };
export const knowledgeMapPoint = (longitude: number, latitude: number): [number, number] | null => {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return projection([longitude, latitude]);
};

export function createKnowledgeBrowser(options: Options) {
  let visible = false, openingView = false, loading = false, loadingObject = false, loadingState = false, loadingDiff = false;
  let view = initialKnowledgeBrowserState(), result: KnowledgeQueryResult | null = null, detail: KnowledgeObjectDetail | null = null;
  let history: KnowledgeHistory | null = null, state: KnowledgeState | null = null, difference: KnowledgeStateDiff | null = null;
  let stateDetail: KnowledgeObjectDetail | null = null, aDetail: KnowledgeObjectDetail | null = null, bDetail: KnowledgeObjectDetail | null = null;
  let repo: EditorialStatus | null = null, stateReference: FixedKnowledgeState | null = null;
  let inspectedProperty: string | null = null, inspectedSide: 'preview' | 'a' | 'b' = 'preview', fieldFilter = '';
  let queryText = '', from = '', to = '', yearInput = '', includeUndated = true, includeUnlocated = true;
  let bounds = { west: '', south: '', east: '', north: '' };
  let error: string | null = null, retry: (() => Promise<unknown>) | null = null;
  let committedNotice = false;
  let navigation: NavigationContextList | null = null, selectedContext: NavigationContextRead | null = null;
  let kindMode:KnowledgeKindMode='auto',typeCatalog:NonNullable<KnowledgeQueryResult['typeCatalog']>=[];
  let contextIds: string[] = [], unassigned = false, typeIds: string[] = [], navigationReason: string | null = null;
  let openSequence=0,querySequence = 0, objectSequence = 0, stateSequence = 0, diffSequence = 0;
  const pinSequence={checkout:0,a:0,b:0};
  let mapBox = { x: 0, y: 0, width: 1000, height: 520 };
  const labels = new Map<string, KnowledgeText>();
  const referenceLabels = new Map<string, KnowledgeText>();
  const storage = () => options.storage ?? localStorage;
  const t = (key: Exclude<KnowledgeCopyKey, 'count' | 'claims' | 'datedClaims' | 'sourceRecords' | 'sourceRecordNumber' | 'range' | 'changeCandidate' | 'bce' | 'period' | 'fixedAt' | 'referencesUnreviewed' | 'untimedCount' | 'coverageTotal' | 'coverageStats' | 'coverageValidTime' | 'coverageSourceDates' | 'coverageRemainingTypes' | 'coverageTypeCount' | 'coverageTimeCount' | 'otherAssertions' | 'unassignedCount' | 'contextsCount' | 'contextMembers' | 'libraryObjects' | 'displayedYear' | 'modelCoverage'>) => copy(options.locale(), key);
  const text = (value: KnowledgeText | undefined, fallback = '') => knowledgeLocalizedText(value, options.locale(), fallback).text;
  const currentContext = () => view.view === 'compare' ? inspectedSide === 'b' ? bDetail : aDetail : stateDetail ?? detail;
  const label = (id: string, kind?: 'type', context: KnowledgeObjectDetail | null = currentContext()) => {
    if (context?.display?.objects[id]) return text(context.display.objects[id].labels, id);
    return (kind === 'type' ? knowledgeTypeLabel(id, options.locale(), context?.display?.types) : knowledgeMetadataLabel(id, options.locale(), context?.display?.properties)) ?? text(labels.get(id), id);
  };
  const englishBadge = (value: KnowledgeText | undefined) => options.locale() === 'zh-CN' && /^en(?:-|$)/i.test(knowledgeLocalizedText(value, options.locale()).language ?? '') ? `<span class="knowledge-language" title="${t('englishSource')}" aria-label="${t('englishSource')}">EN</span>` : '';
  const localizedHtml = (value: KnowledgeText | undefined, fallback = '') => { const selected = knowledgeLocalizedText(value, options.locale(), fallback); return `<span${selected.language ? ` lang="${esc(selected.language)}"` : ''}>${esc(selected.text)}</span>${englishBadge(value)}`; };
  const year = (value: number) => value < 0 ? copy(options.locale(), 'bce', { year: Math.abs(value) }) : new Intl.NumberFormat(options.locale(), { useGrouping: false }).format(value);
  const time = (value: KnowledgeTime) => formatHistoricalDate(value, options.locale());
  const rawTimesHtml = (values: (KnowledgeTime | undefined)[]) => { const raw = historicalDateRawTexts(values); return raw.length ? `<details class="knowledge-time-original"><summary>${t('sourceText')}</summary>${raw.map(value => `<p>${esc(value)}</p>`).join('')}</details>` : ''; };
  const timeMetadataHtml = (value: KnowledgeTime) => `<div class="knowledge-meta">${t('precision')}: ${esc(knowledgeTimeLabel('precision', value.precision, options.locale()))} · ${t('calendar')}: ${esc(knowledgeTimeLabel('calendar', value.calendar, options.locale()))}</div>`;
  const button = (action: string, title: string, extra = '', primary = false) => `<button type="button" class="knowledge-button${primary ? ' primary' : ''}" data-knowledge="${action}" ${extra}>${esc(title)}</button>`;
  const redraw = () => { if (visible) options.render(); };
  const observed = (event: KnowledgeBrowserObservation) => { try { options.onObserved?.(event); } catch { /* Observers cannot alter successful domain operations. */ } };
  function persist() {
    view.yearDraft = yearInput;
    view.scopeDraft = {text:queryText,from,to,includeUndated,includeUnlocated,bounds:{...bounds},contextIds:[...contextIds],unassigned,typeIds:[...typeIds],kindMode};
    const value = structuredClone(view);
    try { storage().setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Navigation failure does not alter committed historical content. */ }
    try { options.onStateChange?.(value); } catch { /* Observers do not control a query or checkout. */ }
  }
  function showFailure(cause: unknown, action: (() => Promise<unknown>) | null = null) {
    navigationReason = cause instanceof ServiceFailure && typeof cause.detail.parameters?.reason === 'string' ? cause.detail.parameters.reason : null;
    error = cause instanceof ServiceFailure ? cause.detail.code : object(cause) && typeof cause.code === 'string' ? cause.code : 'IO_ERROR'; retry = action; redraw();
  }
  function remember(value: KnowledgeObjectDetail | KnowledgeObjectResult) {
    if ('object' in value) {
      labels.set(value.object.id, value.object.labels);
      referenceLabels.set(`${value.revision}\0${value.object.id}`, value.object.labels);
      const extra = (value as KnowledgeObjectDetail & { labels?: Record<string, KnowledgeText> }).labels;
      for (const [id, localized] of Object.entries(extra ?? {})) labels.set(id, localized);
      for (const [id, item] of Object.entries(value.display?.objects ?? {})) labels.set(id, item.labels);
    } else labels.set(value.id, value.labels);
  }
  function syncQueryInputs() {
    const draft = view.scopeDraft;
    queryText = draft?.text ?? view.query.text ?? ''; [from, to] = draft ? [draft.from,draft.to] : view.query.time?.map(String) ?? ['', ''];
    includeUndated = draft?.includeUndated ?? view.query.includeUndated ?? true; includeUnlocated = draft?.includeUnlocated ?? view.query.includeUnlocated ?? true;
    bounds = draft?.bounds ? {...draft.bounds} : view.query.bounds ? Object.fromEntries(Object.entries(view.query.bounds).map(([key,value])=>[key,String(value)])) as typeof bounds : {west:'',south:'',east:'',north:''};
    contextIds = [...draft?.contextIds ?? view.query.contextIds ?? []]; unassigned = draft?.unassigned ?? view.query.unassigned ?? false; typeIds=[...draft?.typeIds ?? view.query.typeIds ?? []];kindMode=draft?.kindMode??view.kindMode??'all';
    yearInput = view.yearDraft ?? (view.year === null ? '' : String(view.year));
  }
  function errorHtml() {
    if (!error) return '';
    const message = error==='TOO_MANY_STRUCTURE_TYPES'?t('tooManyStructureTypes'):error==='STRUCTURE_METADATA_UNAVAILABLE'?t('noStructureMetadata'):navigationReason === 'navigation-operation-pending' ? t('navigationPending') : error === 'MISSING_CONTEXT' ? t('missingContext') : error === 'UNCOMMITTED_OBJECT' ? t('uncommittedObject') : error === 'DIRTY_WORKTREE' ? t('dirtyPin') : error === 'INVALID_YEAR' ? t('invalidYear') : error === 'INVALID_SCOPE' ? t('invalidScope') : error === 'SERVICE_UNAVAILABLE' ? t('unavailable') : error === 'NOT_FOUND' ? t('notFound') : t('operationFailed');
    return `<div class="knowledge-notice" role="alert">${esc(message)}<details><summary>${t('errorCode')}</summary><code>${esc(error)}</code></details><div class="knowledge-notice-actions">${error==='TOO_MANY_STRUCTURE_TYPES'||error==='STRUCTURE_METADATA_UNAVAILABLE'?button('all-kinds',t('allKinds')):navigationReason === 'navigation-operation-pending' && options.onContext ? button('resume-context',t('resumeContext')) : error === 'DIRTY_WORKTREE' || error === 'UNCOMMITTED_OBJECT' ? button('changes', t('reviewChanges')) : retry ? button('retry', t('retry')) : ''}</div></div>`;
  }
  function refSlot(title: string, value: FixedKnowledgeState | null, action: string, clear?: string) {
    const localized = value ? referenceLabels.get(`${value.revision}\0${value.objectId}`)??value.labels : undefined;
    return `<div class="knowledge-ref-slot"><small>${esc(title)}</small><button class="knowledge-ref-title" type="button" data-knowledge="${action}" ${value ? '' : 'disabled'}>${value ? esc(copy(options.locale(), 'fixedAt', { label: text(localized, value.label), year: year(value.year) })) + englishBadge(localized) : t(action === 'show-checkout' ? 'noCheckout' : 'unset')}</button>${value ? `<div class="knowledge-ref-actions"><code>${esc(short(value.revision))}</code>${clear ? `<button class="knowledge-clear" data-knowledge="${clear}" type="button" aria-label="${t(clear === 'clear-a' ? 'clearA' : 'clearB')}">×</button>` : ''}</div>` : ''}</div>`;
  }
  function objectButtons() {
    return result?.objects.map(value => `<button type="button" class="knowledge-object" data-knowledge="object" data-id="${esc(value.id)}" ${value.id === view.selectedObjectId ? 'aria-current="true"' : ''}><strong>${localizedHtml(value.labels, value.id)}</strong><small>${esc(copy(options.locale(),'claims',{count:value.assertionCount}))} · ${esc(copy(options.locale(),'datedClaims',{count:value.datedAssertionCount}))}</small>${!value.observedTimes.length ? `<small>${t('noDate')}</small>` : ''}</button>`).join('') ?? '';
  }
  function objectPages() { return result?.total ? `<div class="knowledge-pagination">${button('previous',t('previous'),result.offset===0?'disabled':'')}<span>${esc(copy(options.locale(),'range',{from:result.offset+1,to:Math.min(result.total,result.offset+result.objects.length),total:result.total}))}</span>${button('next',t('next'),result.offset+result.limit>=result.total?'disabled':'')}</div>` : ''; }
  function scopeSelectionHtml() {
    if(!options.navigation)return '';
    const selected=contextIds.length===1?contextIds[0]:null;
    const definitions=navigation?.items??[];
    return `<label class="knowledge-field">${t('researchContext')}<select data-knowledge-input="context"><option value="all" data-mode="all" ${!contextIds.length&&!unassigned?'selected':''}>${t('allMaterial')}</option>${navigation?.counts.unassigned||unassigned?`<option value="unassigned" data-mode="unassigned" ${unassigned?'selected':''}>${t('unassignedMaterial')}</option>`:''}${contextIds.length>1?`<option value="current" data-mode="contexts" selected>${copy(options.locale(),'contextsCount',{count:contextIds.length})}</option>`:''}${selected&&!definitions.some(value=>value.definition.id===selected)?`<option value="selected" data-mode="context" data-id="${esc(selected)}" selected>${selectedContext?esc(text(selectedContext.definition.labels)):t('missingContext')}</option>`:''}${definitions.map(value=>`<option value="${esc(value.definition.id)}" data-mode="context" data-id="${esc(value.definition.id)}" ${selected===value.definition.id?'selected':''}>${esc(text(value.definition.labels))}</option>`).join('')}</select></label>`;
  }
  function scopeHtml() {
    const types=typeCatalog.length?typeCatalog.map(value=>({typeId:value.id,labels:value.labels,navigationRole:value.navigationRole})):result?.coverage?.typeCounts??[];
    const structureTypes=typeCatalog.filter(value=>value.navigationRole==='structure');
    return `<aside class="knowledge-scope"><h2>${t('scope')}</h2>${options.onContext?`<div class="knowledge-filter-actions">${button('new-context',t('newContext'))}</div>`:''}
      <form data-knowledge-form="scope" novalidate>${scopeSelectionHtml()}
        <div class="knowledge-pair"><label class="knowledge-field">${t('from')}<input type="number" name="from" data-knowledge-input="from" value="${esc(from)}"></label><label class="knowledge-field">${t('to')}<input type="number" name="to" data-knowledge-input="to" value="${esc(to)}"></label></div>
        <label class="knowledge-field">${t('objectKinds')}<select data-knowledge-input="type"><option value="all" data-mode="all" ${kindMode==='all'||kindMode==='auto'&&!structureTypes.length?'selected':''}>${t('allKinds')}</option>${structureTypes.length?`<option value="structures" data-mode="structures" ${kindMode==='structures'||kindMode==='auto'?'selected':''}>${t('structures')}</option>`:''}${kindMode==='types'&&typeIds.length>1?`<option value="current" data-mode="current" selected>${t('types')} · ${typeIds.length}</option>`:''}${typeIds.length===1&&kindMode==='types'&&!types.some(v=>v.typeId===typeIds[0])?`<option selected data-mode="type" data-id="${esc(typeIds[0])}" value="${esc(typeIds[0])}">${esc(label(typeIds[0],'type'))}</option>`:''}${[...types].sort((a,b)=>Number(b.navigationRole==='structure')-Number(a.navigationRole==='structure')).map(value=>`<option value="${esc(value.typeId)}" data-mode="type" data-id="${esc(value.typeId)}" ${kindMode==='types'&&typeIds.length===1&&typeIds[0]===value.typeId?'selected':''}>${esc(text(value.labels,knowledgeTypeLabel(value.typeId,options.locale())??value.typeId))}</option>`).join('')}</select></label>${view.query.typeIds?.length?button('all-kinds',t('allKinds')):''}
        <label class="knowledge-field">${t('search')}<input name="query" data-knowledge-input="query" value="${esc(queryText)}" maxlength="500"></label>
        <label class="knowledge-check"><input type="checkbox" data-knowledge-input="undated" ${includeUndated?'checked':''}>${t('undated')}</label>
        <details><summary>${t('geographicBounds')}</summary><label class="knowledge-check"><input type="checkbox" data-knowledge-input="unlocated" ${includeUnlocated?'checked':''}>${t('unlocated')}</label><div class="knowledge-pair">${(['west','east','south','north'] as const).map(side=>`<label class="knowledge-field">${t(side)}<input type="number" step="any" data-knowledge-input="${side}" value="${esc(bounds[side])}"></label>`).join('')}</div></details>
        ${view.query.objectIds ? `<div class="knowledge-filter-actions"><span>${t('objectFocus')} · ${new Intl.NumberFormat(options.locale()).format(view.query.objectIds.length)}</span>${button('clear-objects',t('clearObjectFocus'))}</div>` : ''}
        <div class="knowledge-filter-actions"><button class="knowledge-button primary" type="submit" ${loading?'disabled':''}>${t('apply')}</button>${button('reset-scope',t('resetScope'),loading?'disabled':'')}</div>
      </form>
      ${selectedContext?`<details class="knowledge-context-basis"><summary>${t('contextBasis')}</summary><p>${esc(text(selectedContext.definition.description))}</p><p>${t('contextOrganization')}</p><p>${copy(options.locale(),'contextMembers',{count:selectedContext.total})}</p>${options.onContext?button('edit-context',t('editContext'),`data-id="${esc(selectedContext.definition.id)}"`):''}<code>${esc(selectedContext.revision)}</code></details>`:''}
      ${options.onEdit?`<div class="knowledge-filter-actions">${button('new-object',t('newObject'))}</div>`:''}${view.view!=='overview'?`<div class="knowledge-total">${result?copy(options.locale(),'count',{count:result.total}):t('loading')}</div><div class="knowledge-object-list">${objectButtons()}</div>${objectPages()}`:''}
    </aside>`;
  }
  function contextsHtml() {
    if(!navigation)return '';
    return `<section class="knowledge-context-overview">${!view.query.contextIds?.length&&!view.query.unassigned&&navigation.items.length?`<div class="knowledge-context-cards">${navigation.items.map(value=>`<button type="button" data-knowledge="context" data-id="${esc(value.definition.id)}"><strong>${localizedHtml(value.definition.labels)}</strong><small>${copy(options.locale(),'contextMembers',{count:value.members})}</small></button>`).join('')}</div>${navigation.total>navigation.limit?`<div class="knowledge-filter-actions">${button('contexts-page',t('contextPrevious'),`data-offset="${Math.max(0,navigation.offset-navigation.limit)}" ${navigation.offset===0?'disabled':''}`)}${button('contexts-page',t('contextNext'),`data-offset="${navigation.offset+navigation.limit}" ${navigation.offset+navigation.limit>=navigation.total?'disabled':''}`)}</div>`:''}<p>${t('contextOrganization')}</p>`:''}${navigation.counts.unassigned&&!view.query.unassigned?`<div class="knowledge-organization-row"><span>${copy(options.locale(),'unassignedCount',{count:navigation.counts.unassigned})}</span>${button('unassigned',t('viewUnassigned'))}</div>`:''}${options.onContext&&view.query.contextIds?.length===1?`<div class="knowledge-filter-actions">${button('add-material',t('addMaterial'),`data-id="${esc(view.query.contextIds[0])}"`)}</div>`:''}</section>`;
  }
  function overviewObjectsHtml(){return `${result?.total?`<section class="knowledge-matching-objects"><h3>${t('scopeObjects')}</h3><div class="knowledge-overview-objects">${objectButtons()}</div>${objectPages()}</section>`:''}`;}
  function modelArtifactsHtml(){return `${options.modelArtifacts?.().length?`<section class="knowledge-artifacts"><h3>${t('modelArtifacts')}</h3><p>${t('modelScopeIndependent')}</p>${options.modelArtifacts().map(model=>`<div class="knowledge-artifact"><strong>${localizedHtml(model.labels)}</strong><p>${copy(options.locale(),'modelCoverage',{states:model.states,from:year(model.from),to:year(model.to)})} · <code>${esc(model.revision==='working'?t('working'):short(model.revision))}</code></p>${button('model-artifact',t('inspectModel'),`data-id="${esc(model.id)}" data-revision="${esc(model.revision)}"`)}</div>`).join('')}</section>`:''}`;}
  function overviewHtml() {
    if(!result)return `<p class="knowledge-empty" role="status">${t(error?'operationFailed':'loading')}</p>`;
    const coverage = result?.coverage;
    if (!result?.total) return `${contextsHtml()}<section class="knowledge-coverage"><p>${t(result && (view.query.text || view.query.time || view.query.bounds || view.query.typeIds?.length) ? 'noResults' : 'noCollection')}</p>${button('find-data', t('findData'))}</section>`;
    if (!coverage) return `${contextsHtml()}<section class="knowledge-coverage"><strong>${copy(options.locale(), 'coverageTotal', {count:result.total})}</strong>${overviewObjectsHtml()}${modelArtifactsHtml()}</section>`;
    const largest = Math.max(1,...coverage.buckets.map(value => value.objects));
    const interval = (from:number,to:number) => from === to ? year(from) : copy(options.locale(),'period',{from:year(from),to:year(to)});
    return `${contextsHtml()}<section class="knowledge-coverage"><strong>${esc(copy(options.locale(),'coverageTotal',{count:coverage.matchedObjects}))}</strong>${overviewObjectsHtml()}<details class="knowledge-coverage-details"><summary>${t('coverageDetails')}</summary>${navigation?`<p>${copy(options.locale(),'libraryObjects',{count:navigation.counts.objects})}</p>`:''}<p>${esc(copy(options.locale(),'coverageStats',{dated:coverage.datedObjects,undated:coverage.undatedObjects,located:coverage.locatedObjects,unlocated:coverage.unlocatedObjects}))}</p><p>${t('coverageNotEvents')}</p><h3>${t('coverageTypes')}</h3><p>${t('coverageTypesNote')}</p><div class="knowledge-coverage-types">${[...coverage.typeCounts].sort((a,b)=>Number(b.navigationRole==='structure')-Number(a.navigationRole==='structure')).map(value => button('type',copy(options.locale(),'coverageTypeCount',{label:text(value.labels,knowledgeTypeLabel(value.typeId,options.locale()) ?? value.typeId),count:value.count}),`data-id="${esc(value.typeId)}" title="${esc(value.typeId)}"`)).join('')}</div>${coverage.remainingTypes ? `<p>${copy(options.locale(),'coverageRemainingTypes',{count:coverage.remainingTypes})}</p>` : ''}<h3>${t('coverageTime')}</h3><p>${t('coverageFullRanges')}</p><p>${copy(options.locale(),'coverageValidTime',{count:coverage.validTimeObjects})}${coverage.validTimeRange ? ` · ${esc(interval(...coverage.validTimeRange))}` : ''}</p><p>${copy(options.locale(),'coverageSourceDates',{count:coverage.sourceDateObjects})}${coverage.sourceDateRange ? ` · ${esc(interval(...coverage.sourceDateRange))}` : ''}</p>${coverage.buckets.length ? `<p>${t('coverageTimeNote')}</p><div class="knowledge-coverage-times">${coverage.buckets.map(value => `<button type="button" data-knowledge="coverage-time" data-from="${value.from}" data-to="${value.to}" ${value.objects ? '' : 'disabled'}><span>${esc(copy(options.locale(),'coverageTimeCount',{range:interval(value.from,value.to),count:value.objects}))}</span><progress value="${value.objects}" max="${largest}" aria-hidden="true"></progress></button>`).join('')}</div>` : `<p>${t('coverageNoTime')}</p>`}</details>${modelArtifactsHtml()}</section>`;
  }
  function mapHtml() {
    if(!result)return `<p class="knowledge-empty" role="status">${t(error?'operationFailed':'loading')}</p>`;
    const points = (result?.objects ?? []).flatMap(value => value.coordinates.map(coordinate => ({ object: value, coordinate, point: knowledgeMapPoint(coordinate.longitude, coordinate.latitude) })).filter(value => value.point));
    return `<div class="knowledge-map-title"><span>${t('pageMap')}</span><span>${t('mapNote')}</span></div><div class="knowledge-map"><svg viewBox="${mapBox.x} ${mapBox.y} ${mapBox.width} ${mapBox.height}" role="img" aria-label="${t('pageMap')}"><image href="./world-land.svg" x="0" y="0" width="1000" height="520"/></svg>${points.filter(value => value.point![0] >= mapBox.x && value.point![0] <= mapBox.x + mapBox.width && value.point![1] >= mapBox.y && value.point![1] <= mapBox.y + mapBox.height).map(value => `<button type="button" class="knowledge-map-point ${value.object.id === view.selectedObjectId ? 'selected' : ''}" style="left:${(value.point![0] - mapBox.x) / mapBox.width * 100}%;top:${(value.point![1] - mapBox.y) / mapBox.height * 100}%" data-knowledge="map-object" data-id="${esc(value.object.id)}" title="${esc(text(value.object.labels, value.object.id))}" aria-label="${esc(text(value.object.labels, value.object.id))}"></button>`).join('')}<div class="knowledge-map-controls">${button('zoom-in', '+', `aria-label="${t('zoomIn')}"`)}${button('zoom-out', '−', `aria-label="${t('zoomOut')}"`)}${button('world', t('world'))}</div></div>${!points.length ? `<p class="knowledge-empty">${t('noMapPoints')}</p>` : ''}`;
  }
  function displayEvidenceHtml(display: KnowledgeDisplayText | undefined | null) {
    return display?.provenance.length ? `<details class="knowledge-translation-evidence"><summary>${esc(knowledgeDisplayCopy('displayEvidence', options.locale()))}</summary>${display.provenance.map(item => `<div><span lang="${esc(item.language)}">${esc(item.text)}</span>${item.evidence.map(evidence => `<p>${sourceLink(evidence.url, evidence.citation ?? knowledgeDisplayCopy('translationSource', options.locale()))}<br><code>${esc(evidence.locator)}</code></p>`).join('')}<details><summary>${esc(knowledgeDisplayCopy('translationMethod', options.locale()))}</summary><code>${esc(item.method)}</code></details></div>`).join('')}</details>` : '';
  }
  function valueHtml(value: KnowledgeValue, propertyId?: string, assertionIds: string[] = [], context: KnowledgeObjectDetail | null = currentContext(), includeRaw = true): string {
    if (value.kind === 'entity') { const shown = context?.display?.objects[value.objectId], display = shown?.display[options.locale()], reference = view.view === 'compare' ? context === bDetail ? view.b : view.a : stateReference; return `<button type="button" class="knowledge-entity-link" data-knowledge="related" data-id="${esc(value.objectId)}" data-revision="${esc(context?.revision ?? 'working')}" data-year="${reference?.year ?? view.year ?? ''}" data-unreviewed="${reference?.includeUnreviewed ?? view.includeUnreviewed}">${localizedHtml(shown?.labels ?? labels.get(value.objectId), label(value.objectId, undefined, context))}</button>${display?.status === 'conflict' ? `<small class="knowledge-display-conflict">${esc(knowledgeDisplayCopy('translationConflict',options.locale()))}</small>` : ''}${displayEvidenceHtml(display)}<details class="knowledge-meta"><summary>${t('identifiers')}</summary><code>${esc(value.objectId)}</code></details>`; }
    if (value.kind === 'text') {
      const display = knowledgeValueDisplay(value, assertionIds, context, options.locale()), catalogValues = propertyId ? context?.display?.vocabulary?.values[propertyId]?.[value.value] : null, catalogDisplay = catalogValues?.[options.locale()];
      const labels = propertyId ? context?.display?.qualifierValues[propertyId]?.[value.value] : null, metadata = propertyId ? knowledgeQualifierLabel(propertyId, value.value, options.locale(), context?.display?.qualifierValues) : null;
      const metadataLanguage = labels ? knowledgeLocalizedText(labels, options.locale()).language : metadata !== null ? options.locale() : null;
      const catalogText = catalogDisplay?.language && catalogDisplay.language !== 'und' ? catalogDisplay.text ?? metadata : metadata;
      const conflict = display?.status === 'conflict' || catalogDisplay?.status === 'conflict', translated = display?.status === 'translated';
      const shown = conflict ? value.value : translated ? display.text ?? value.value : catalogText ?? display?.text ?? value.value;
      const language = conflict ? value.language : translated ? display.language : catalogText !== null ? catalogDisplay?.language ?? metadataLanguage ?? value.language : display?.language ?? value.language;
      const status = conflict ? `<small class="knowledge-display-conflict">${esc(knowledgeDisplayCopy('translationConflict', options.locale()))}</small>` : language && language !== options.locale() && language !== 'und' ? `<small class="knowledge-language" lang="${esc(language)}">${esc(language)}</small>` : '';
      const original = shown !== value.value ? `<details class="knowledge-meta"><summary>${esc(knowledgeDisplayCopy('originalValue', options.locale()))}</summary><span${value.language ? ` lang="${esc(value.language)}"` : ''}>${esc(value.value)}</span></details>` : '';
      const catalogProof = catalogDisplay?.provenance.length ? catalogDisplay.provenance : catalogDisplay?.language === 'en' ? catalogValues?.en.provenance ?? [] : [];
      const proof = displayEvidenceHtml(display || catalogDisplay ? { ...(display ?? catalogDisplay!), provenance: [...(display?.provenance ?? []), ...catalogProof] } : null);
      return `<span${language ? ` lang="${esc(language)}"` : ''}>${esc(shown)}</span>${status}${original}${proof}`;
    }
    if (value.kind === 'time') return `<span>${esc(time(value.value))}</span>${timeMetadataHtml(value.value)}${includeRaw ? rawTimesHtml([value.value]) : ''}`;
    if (value.kind === 'coordinate') return `${esc(new Intl.NumberFormat(options.locale(), { maximumFractionDigits: 6 }).format(value.latitude))}, ${esc(new Intl.NumberFormat(options.locale(), { maximumFractionDigits: 6 }).format(value.longitude))}`;
    if (value.kind === 'number') return `${esc(new Intl.NumberFormat(options.locale()).format(value.value))}${value.unit ? ` <small>${esc(label(value.unit))}</small>` : ''}${value.lowerBound !== undefined || value.upperBound !== undefined ? `<div class="knowledge-meta">${esc(value.lowerBound ?? '')}–${esc(value.upperBound ?? '')}</div>` : ''}`;
    if (value.kind === 'boolean') return t(value.value ? 'yes' : 'no');
    if (value.kind === 'unknown') return t('unknown');
    if (value.kind === 'absent') return t('absent');
    return `<details><summary>${t('sourceText')}</summary><pre>${esc(JSON.stringify(value.value, null, 2))}</pre></details>`;
  }
  function fieldHtml(field: KnowledgeStateField, context: KnowledgeObjectDetail | null = currentContext()) {
    return `<span class="knowledge-status ${field.status}">${t(field.status)}</span>${field.values.map(value => `<div class="knowledge-value">${valueHtml(value, field.propertyId, field.assertionIds, context)}</div>`).join('')}${field.possibleValues.length ? `<div class="knowledge-meta">${t('possible')}</div>${field.possibleValues.map(value => `<div class="knowledge-value">${valueHtml(value, field.propertyId, field.possibleAssertionIds, context)}</div>`).join('')}` : ''}`;
  }
  function stateControlsHtml() {
    return `<form class="knowledge-state-controls" data-knowledge-form="year" novalidate><label class="knowledge-field">${t('year')}<input name="year" data-knowledge-input="year" type="number" step="1" value="${esc(yearInput)}"${loadingObject || loadingState ? ' disabled' : ''}></label><button class="knowledge-button" type="submit"${loadingObject || loadingState ? ' disabled' : ''}>${t('showState')}</button><label class="knowledge-check"><input type="checkbox" data-knowledge-input="unreviewed" ${(stateReference?.includeUnreviewed ?? view.includeUnreviewed) ? 'checked' : ''}${loadingObject || loadingState ? ' disabled' : ''}>${t('includeUnreviewed')}</label></form>${state?`<p class="knowledge-meta" data-knowledge-actual-year>${copy(options.locale(),'displayedYear',{year:year(state.year)})}</p>${yearInput.trim()!==String(state.year)?`<p class="knowledge-year-pending" role="status">${t('unappliedYear')}</p>`:''}`:''}`;
  }
  function fieldFilterHtml() { return `${view.fieldIds?.length ? `<div class="knowledge-filter-actions"><span>${t('fieldFocus')} · ${view.fieldIds.map(id=>esc(label(id))).join(' · ')}</span>${button('clear-fields',t('clearFieldFocus'))}</div>` : ''}<label class="knowledge-field-filter">${t('fieldFilter')}<input data-knowledge-input="field-filter" value="${esc(fieldFilter)}"></label>`; }
  function visibleField(id: string) { return (!view.fieldIds?.length||view.fieldIds.includes(id))&&(!fieldFilter || `${id} ${label(id)}`.toLocaleLowerCase().includes(fieldFilter.toLocaleLowerCase())); }
  function stateRowsHtml() {
    if (!state) return `<p class="knowledge-empty">${t('noStateSelected')}</p>`;
    const fields = state.fields.filter(value => visibleField(value.propertyId));
    return `<table class="knowledge-state-table"><thead><tr><th>${t('field')}</th><th>${t('value')}</th></tr></thead><tbody>${fields.map(value => `<tr><td><button type="button" class="knowledge-field-row" data-knowledge="field" data-property="${esc(value.propertyId)}" data-side="preview" title="${esc(value.propertyId)}">${esc(label(value.propertyId))}</button></td><td>${fieldHtml(value)}</td></tr>`).join('')}</tbody></table>${!fields.length ? `<p class="knowledge-empty">${t('noFields')}</p>` : ''}`;
  }
  function stateHtml() {
    return `${stateControlsHtml()}<p class="knowledge-muted">${t('stateNote')}</p>${stateDetail ?? detail ? `<div class="knowledge-state-actions">${button('checkout', t('setCheckout'),!state||loadingState?'disabled':'')}${button('set-a', t('chooseA'),!state||loadingState?'disabled':'')}${button('set-b', t('chooseB'),!state||loadingState?'disabled':'')}${button('research', t('saveResearch'))}${stateReference ? button('show-working', t('workingPreview')) : ''}</div>` : ''}${stateReference ? `<p class="knowledge-meta">${t('fixedState')} · ${localizedHtml(referenceLabels.get(`${stateReference.revision}\0${stateReference.objectId}`)??stateReference.labels,stateReference.label)} · ${esc(year(stateReference.year))} · <code>${esc(short(stateReference.revision))}</code></p>` : `<p class="knowledge-meta">${t('preview')} · ${t('working')}</p>`}${loadingState ? `<p role="status">${t('loading')}</p>` : `${fieldFilterHtml()}<div data-knowledge-fields>${stateRowsHtml()}</div>`}${state?.untimedAssertionIds.length ? `<p class="knowledge-muted">${esc(copy(options.locale(), 'untimedCount', { count: state.untimedAssertionIds.length }))}</p>` : ''}`;
  }
  function observationsHtml() {
    if (!detail) return loadingObject ? '' : `<p class="knowledge-empty">${t('noStateSelected')}</p>`;
    const emptyMessage = !view.includeUnreviewed && detail.assertions.some(value => value.review === 'unreviewed') ? 'observationsAwaitReview' : 'noObservations';
    return `${stateControlsHtml()}<p class="knowledge-muted">${t('intervalNote')}</p><div class="knowledge-observations">${history?.observations.map(observation => `<button type="button" class="knowledge-observation ${observation.kind === 'coverage-boundary' ? 'boundary' : ''}" data-knowledge="observation" data-year="${observation.year}"><strong>${esc(year(observation.year))}</strong><small>${t(observation.kind === 'baseline' ? 'baseline' : observation.kind === 'coverage-boundary' ? 'coverageBoundary' : 'observation')} · ${esc(copy(options.locale(), 'claims', { count: observation.sourceAssertionIds.length }))}</small></button>`).join('') || `<p class="knowledge-empty">${t(emptyMessage)}</p>`}</div>${history?.changes.map((change, index) => `<section class="knowledge-change-candidate"><p>${esc(copy(options.locale(), 'changeCandidate', { from: year(change.observedBetween[0]), to: year(change.observedBetween[1]) }))}</p><p class="knowledge-meta">${change.propertyIds.map(id => esc(label(id))).join(' · ')}</p>${button('compare-interval', t('compareInterval'), `data-index="${index}"`)}</section>`).join('') ?? ''}${history?.exceptions.length ? `<details><summary>${t('exceptions')} · ${history.exceptions.length}</summary>${history.exceptions.slice(0, 100).map(value => `<p class="knowledge-meta">${t(value.reason === 'undated' ? 'undatedReason' : value.reason === 'open-boundary' ? 'openBoundary' : value.reason === 'uncertain-time' ? 'uncertainTime' : 'unreviewed')} · <code>${esc(value.assertionId)}</code></p>`).join('')}</details>` : ''}`;
  }
  function comparisonRowsHtml() {
    if (!difference) return `<p class="knowledge-empty">${t('chooseBoth')}</p>`;
    return `<table class="knowledge-state-table"><thead><tr><th>${t('field')}</th><th>${t('before')}</th><th>${t('after')}</th></tr></thead><tbody>${difference.fields.filter(value => visibleField(value.propertyId)).map(value => `<tr><td>${esc(label(value.propertyId))}<br><span class="knowledge-status ${value.kind}">${t(value.kind)}</span></td><td><button type="button" class="knowledge-field-row" data-knowledge="field" data-property="${esc(value.propertyId)}" data-side="a">${t('evidence')}</button>${fieldHtml(value.before, aDetail)}</td><td><button type="button" class="knowledge-field-row" data-knowledge="field" data-property="${esc(value.propertyId)}" data-side="b">${t('evidence')}</button>${fieldHtml(value.after, bDetail)}</td></tr>`).join('')}</tbody></table>`;
  }
  function compareHtml() { return `${loadingDiff ? `<p role="status">${t('loading')}</p>` : ''}${fieldFilterHtml()}<div data-knowledge-fields>${comparisonRowsHtml()}</div>${difference ? `<div class="knowledge-state-actions">${button('research', t('saveResearch'))}</div>` : ''}`; }
  function sourceLink(url: string, title: string) {
    try { const parsed = new URL(url); if (parsed.protocol !== 'https:') return esc(title); return `<a href="${esc(parsed.href)}">${esc(title)}</a>`; }
    catch { return esc(title); }
  }
  function sourceIdentityHtml(source: KnowledgeSourceHeader | undefined, sourceId: string, repositoryRevision: string) {
    const field = (label: string, value: string) => `<dt>${esc(label)}</dt><dd><code>${esc(value)}</code></dd>`;
    return `<dl class="knowledge-source-metadata">${field(t('sourceId'), sourceId)}${source ? field(t('sourceProvider'), source.identity.provider) + field(t('externalIdentifier'), source.identity.externalId) + field(t('sourceRevision'), source.revision ?? t('notRecorded')) + field(t('contentHash'), source.contentHash) + field(t('retrieved'), source.retrievedAt) + field(t('mappingVersion'), source.adapterVersion) : ''}${field(t('revision'), repositoryRevision === 'working' ? t('working') : repositoryRevision)}</dl>`;
  }
  function fieldNameEvidenceHtml(context: KnowledgeObjectDetail, propertyId: string) {
    const catalog = context.display?.vocabulary, localized = catalog?.properties[propertyId], entry = localized?.[options.locale()];
    if (!entry) return '';
    const origin = entry.origin ?? (catalog?.origin === 'legacy' ? 'legacy' : null);
    const proof = entry.provenance.length ? entry.provenance : entry.language === 'en' ? localized?.en.provenance ?? [] : [];
    return `<details class="knowledge-field-names"><summary>${t('fieldNames')}</summary><p>${esc(entry.text ?? label(propertyId))}${entry.language && entry.language !== options.locale() ? ` <span class="knowledge-language">${esc(entry.language)}</span>` : ''}</p><p class="knowledge-meta">${t(origin === 'git' ? 'fieldNamesVersioned' : origin === 'legacy' ? 'fieldNamesLegacy' : 'fieldNamesUnavailable')}</p>${entry.status === 'missing' || entry.status === 'conflict' ? `<p>${t(entry.status === 'missing' ? 'fieldNamesMissing' : 'fieldNamesConflict')}</p>` : ''}${origin === 'legacy' && catalog?.legacyFingerprint ? `<dl class="knowledge-source-metadata"><dt>${t('catalogFingerprint')}</dt><dd><code>${esc(catalog.legacyFingerprint)}</code></dd></dl>` : origin === 'git' ? `<dl class="knowledge-source-metadata"><dt>${t('revision')}</dt><dd><code>${esc(context.revision === 'working' ? t('working') : context.revision)}</code></dd></dl>` : ''}${proof.map(item => `<details><summary><span lang="${esc(item.language)}">${esc(item.text)}</span></summary><code>${esc(item.sourceId)}</code>${item.evidence.map(evidence => `<p>${sourceLink(evidence.url, t('fieldNameSource'))}</p><dl class="knowledge-source-metadata"><dt>${t('locator')}</dt><dd><code>${esc(evidence.locator)}</code></dd>${evidence.sourceSnapshotHash ? `<dt>${t('contentHash')}</dt><dd><code>${esc(evidence.sourceSnapshotHash)}</code></dd>` : ''}</dl>`).join('')}</details>`).join('')}</details>`;
  }
  function sourcesHtml(context: KnowledgeObjectDetail) {
    const locations = knowledgeSourceLocators(context);
    return `<div class="knowledge-source-groups">${groupKnowledgeSources(context.sources, context.revision).map((group, groupIndex) => {
      const first = group.sources[0];
      return `<details class="knowledge-source-group" data-source-group="${groupIndex}"><summary><strong>${esc(knowledgeSourceTitle(first, options.locale()))}</strong><small>${esc(copy(options.locale(), 'sourceRecords', { count: group.sources.length }))}${first.revision ? ` · ${t('sourceRevision')} ${esc(short(first.revision))}` : ''}</small></summary><div class="knowledge-source-group-body">${group.documentUrl ? `<p>${sourceLink(group.documentUrl, t('openSourceDocument'))}</p>` : ''}${group.sources.map((source, index) => `<details class="knowledge-source-record" data-source-id="${esc(source.id)}"><summary>${esc(copy(options.locale(), 'sourceRecordNumber', { number: index + 1 }))}</summary>${sourceIdentityHtml(source, source.id, group.repositoryRevision)}<p>${sourceLink(source.revisionUrl ?? source.url, t('openSourceRecord'))}</p><h4>${t('locator')}</h4>${locations.get(source.id)?.length ? `<ul class="knowledge-source-locators">${locations.get(source.id)!.map(locator => `<li><code>${esc(locator)}</code></li>`).join('')}</ul>` : `<p>${t('noSourceLocators')}</p>`}${source.rights.licenseId ? `<p>${t('license')} · ${source.rights.licenseUrl ? sourceLink(source.rights.licenseUrl, source.rights.licenseId) : esc(source.rights.licenseId)}</p>` : ''}${source.historyUrl ? `<p>${sourceLink(source.historyUrl, knowledgeDisplayCopy('authorHistory', options.locale()))}</p>` : ''}${source.rights.attribution ? `<details><summary>${esc(knowledgeDisplayCopy('attribution', options.locale()))}</summary><p>${esc(source.rights.attribution)}</p></details>` : ''}${source.changes?.length ? `<details><summary>${esc(knowledgeDisplayCopy('changes', options.locale()))}</summary><ul>${source.changes.map(change => `<li>${esc(change)}</li>`).join('')}</ul></details>` : ''}</details>`).join('')}</div></details>`;
    }).join('')}</div>`;
  }
  function assertionHtml(assertion: KnowledgeAssertion, context: KnowledgeObjectDetail) {
    const sourceLinks=new Set<string>();
    const scope = assertion.validTime;
    const scopedTime = (prefix: string, value: KnowledgeTime) => `<div class="knowledge-meta">${esc(prefix)} ${esc(time(value))}</div>${timeMetadataHtml(value)}`;
    const applicabilityHtml = scope ? `<div class="knowledge-applicability">${scope.point ? scopedTime(t('atTime'), scope.point) : [scope.start ? scopedTime(t('fromTime'), scope.start) : '', scope.end ? scopedTime(t('toTime'), scope.end) : ''].join('')}</div>` : `<p class="knowledge-meta">${t('untimed')}</p>`;
    const field = inspectedSide === 'a' && view.view === 'compare' ? difference?.a.fields.find(value => value.propertyId === assertion.propertyId) : inspectedSide === 'b' && view.view === 'compare' ? difference?.b.fields.find(value => value.propertyId === assertion.propertyId) : state?.fields.find(value => value.propertyId === assertion.propertyId);
    const applicability = field?.possibleAssertionIds.includes(assertion.id) ? t('possible') : field?.assertionIds.includes(assertion.id) ? '' : scope ? t('outsideTime') : t('untimed');
    return `<article class="knowledge-assertion">${options.onEdit ? `<div class="knowledge-assertion-actions">${button('correct-assertion',t('correctAssertion'),`data-id="${esc(assertion.id)}"`)}</div>` : ''}<span class="knowledge-status ${assertion.review}">${t(assertion.review)}</span>${applicability ? `<p class="knowledge-meta">${esc(applicability)}</p>` : ''}<div class="knowledge-value">${valueHtml(assertion.value, assertion.propertyId, [assertion.id], context, false)}</div>${applicabilityHtml}${rawTimesHtml([assertion.value.kind === 'time' ? assertion.value.value : undefined, scope?.point, scope?.start, scope?.end])}${assertion.rank ? `<div class="knowledge-meta">${t('sourceRank')}: ${t(assertion.rank)}</div>` : ''}${assertion.qualifiers.length ? `<details><summary>${t('qualifiers')}</summary>${assertion.qualifiers.map(value => `<div class="knowledge-qualifier"><strong>${esc(label(value.propertyId))}</strong><div>${valueHtml(value.value, value.propertyId, [], context)}</div></div>`).join('')}</details>` : ''}${assertion.evidence.map(evidence => { const source = context.sources.find(value => value.id === evidence.sourceId),headerUrl=source?.revisionUrl??source?.url,showHeader=!!headerUrl&&!sourceLinks.has(headerUrl);if(headerUrl)sourceLinks.add(headerUrl);const showCited=!!evidence.url&&!sourceLinks.has(evidence.url);if(evidence.url)sourceLinks.add(evidence.url); return `<dl><dt>${t('source')}</dt><dd>${source ? showHeader?sourceLink(source.revisionUrl ?? source.url, knowledgeSourceTitle(source, options.locale())):esc(knowledgeSourceTitle(source,options.locale())) : t('sourceUnavailable')}</dd>${showCited&&evidence.url?`<dt>${t('citedSource')}</dt><dd>${sourceLink(evidence.url,t('openCitedSource'))}</dd>`:''}<dt>${t('locator')}</dt><dd><code>${esc(evidence.locator)}</code></dd>${evidence.citation ? `<dt>${t('sourceReferences')}</dt><dd><details><summary>${t('sourceText')}</summary>${esc(evidence.citation)}</details></dd>` : ''}${source?.revision ? `<dt>${t('sourceRevision')}</dt><dd>${esc(source.revision)}</dd>` : ''}${source?.rights.licenseId ? `<dt>${t('license')}</dt><dd>${source.rights.licenseUrl ? sourceLink(source.rights.licenseUrl, source.rights.licenseId) : esc(source.rights.licenseId)}</dd>` : ''}${source?.historyUrl ? `<dt>${esc(knowledgeDisplayCopy('authorHistory', options.locale()))}</dt><dd>${sourceLink(source.historyUrl, knowledgeDisplayCopy('authorHistory', options.locale()))}</dd>` : ''}</dl><details class="knowledge-source-identity"><summary>${t('sourceIdentity')}</summary>${sourceIdentityHtml(source, evidence.sourceId, context.revision)}</details>${source?.rights.attribution ? `<details><summary>${esc(knowledgeDisplayCopy('attribution', options.locale()))}</summary><p lang="en">${esc(source.rights.attribution)}</p></details>` : ''}${source?.changes?.length ? `<details><summary>${esc(knowledgeDisplayCopy('changes', options.locale()))}</summary><ul lang="en">${source.changes.map(change => `<li>${esc(change)}</li>`).join('')}</ul></details>` : ''}`; }).join('')}</article>`;
  }
  function inspectorHtml() {
    const context = view.view === 'overview' ? null : view.view === 'map' ? detail : view.view === 'compare' ? inspectedSide === 'b' ? bDetail : aDetail : stateDetail ?? detail;
    if (!context) return '';
    const assertions = inspectedProperty ? context.assertions.filter(value => value.propertyId === inspectedProperty) : [];
    const unreviewed = context.assertions.filter(value => value.review === 'unreviewed').length;
    const selectedField = (view.view === 'compare' ? inspectedSide === 'b' ? difference?.b : difference?.a : state)?.fields.find(value => value.propertyId === inspectedProperty);
    const selectedIds = new Set([...(selectedField?.assertionIds ?? []),...(selectedField?.possibleAssertionIds ?? [])]);
    const supporting = assertions.filter(value => selectedIds.has(value.id)), other = assertions.filter(value => !selectedIds.has(value.id));
    return `<aside class="knowledge-inspector"><h2>${t(inspectedProperty ? 'evidence' : 'details')}</h2>${options.onEdit ? `<div class="knowledge-state-actions">${button('edit-object',t('addAssertion'))}</div>` : ''}<p>${localizedHtml(context.object.labels, context.object.id)}</p>${displayEvidenceHtml(context.display?.objects[context.object.id]?.display[options.locale()])}<details class="knowledge-meta"><summary>${t('identifiers')}</summary><code>${esc(context.object.id)}</code>${inspectedProperty ? `<br><code>${esc(inspectedProperty)}</code>` : ''}${context.object.types.map(id => `<br><code>${esc(id)}</code>`).join('')}</details>${inspectedProperty ? `<h3>${esc(label(inspectedProperty))}</h3>${fieldNameEvidenceHtml(context, inspectedProperty)}${context.display?.notes.filter(note => note.ids.includes(inspectedProperty!)).map(note => `<p class="knowledge-meta">${esc(note[options.locale()])}</p>`).join('') ?? ''}${supporting.length ? supporting.map(value => assertionHtml(value, context)).join('') : `<p>${t('noSupportingAssertion')}</p>`}${other.length ? `<details class="knowledge-other-assertions"><summary>${esc(copy(options.locale(),'otherAssertions',{count:other.length}))}</summary>${other.map(value => assertionHtml(value, context)).join('')}</details>` : ''}` : `<p>${localizedHtml(context.object.descriptions)}</p><div class="knowledge-meta">${esc(copy(options.locale(), 'claims', { count: context.object.assertionCount }))} · ${esc(copy(options.locale(), 'datedClaims', { count: context.object.datedAssertionCount }))}</div>${unreviewed ? `<p class="knowledge-notice">${esc(copy(options.locale(), 'referencesUnreviewed', { count: unreviewed }))}</p>` : ''}${context.object.types.length ? `<h3>${t('types')}</h3>${context.object.types.map(id => `<button type="button" class="knowledge-type" data-knowledge="type" data-id="${esc(id)}" title="${esc(id)}">${esc(label(id, 'type'))}</button>`).join('')}` : ''}<h3>${t('sourceReferences')}</h3>${sourcesHtml(context)}${!context.object.coordinates.length ? `<p>${t('noLocation')}</p>` : ''}${!context.object.observedTimes.length ? `<p>${t('noDate')}</p>` : ''}`}</aside>`;
  }
  function content() {
    if (!visible || openingView) return `<div class="knowledge-shell" aria-busy="true"><aside class="knowledge-scope"><h2>${t('scope')}</h2></aside><section class="knowledge-body"><div class="knowledge-context">${refSlot(t('checkout'), view.checkout, 'show-checkout')}${refSlot(t('endpointA'), view.a, 'show-a', 'clear-a')}${refSlot(t('endpointB'), view.b, 'show-b', 'clear-b')}</div><main class="knowledge-canvas"><p class="knowledge-empty" role="status">${t('loading')}</p></main></section></div>`;
    const context = view.view === 'overview' ? null : view.view === 'map' ? detail : view.view === 'compare' ? inspectedSide === 'b' ? bDetail : aDetail : stateDetail ?? detail;
    const fixed = view.view === 'state' || view.view === 'observations' ? stateReference : null;
    const displayedRevision=fixed?.revision??context?.revision??view.queryRevision??'working';
    return `<div class="knowledge-shell">${scopeHtml()}<section class="knowledge-body"><div class="knowledge-context">${refSlot(t('checkout'), view.checkout, 'show-checkout')}${refSlot(t('endpointA'), view.a, 'show-a', 'clear-a')}${refSlot(t('endpointB'), view.b, 'show-b', 'clear-b')}</div><nav class="knowledge-scope-crumb" aria-label="${t('scope')}">${button('all-material',t('allMaterial'))}${view.query.unassigned?`<span aria-current="page">› ${t('unassignedMaterial')}</span>`:view.query.contextIds?.length?`<span aria-current="page">› ${selectedContext?esc(text(selectedContext.definition.labels)):copy(options.locale(),'contextsCount',{count:view.query.contextIds.length})}</span>`:''}${view.view!=='overview'?button('back-scope',t('backScope')):''}</nav><header class="knowledge-view-heading">${view.objectTrail?.length ? button('back-related', t('returnObject')) : ''}<div><h1>${view.view === 'overview' ? t('coverageTitle') : view.view === 'compare' ? t('compare') : context ? localizedHtml(context.object.labels, context.object.id) : view.selectedObjectId ? localizedHtml(labels.get(view.selectedObjectId),stateReference?.label??t('objects')) : t('objects')}</h1><small>${view.view === 'compare' ? t('fixedStates') : displayedRevision!=='working'?`${t('revision')} · ${esc(short(displayedRevision))}`:`${t('working')}${repo ? ` · ${esc(short(repo.head))}` : ''}`}</small></div></header><nav class="knowledge-tabs" role="tablist" aria-label="${t('objects')}">${(['overview', 'map', 'observations', 'state', 'compare'] as const).map(mode => `<button type="button" role="tab" aria-selected="${view.view === mode}" data-knowledge="view" data-view="${mode}">${t(mode)}</button>`).join('')}</nav><div class="knowledge-content${context ? ' has-inspector' : ''}"><main class="knowledge-canvas">${errorHtml()}${committedNotice ? `<p class="knowledge-notice" role="status">${t('committedNotice')}</p>` : ''}${loadingObject ? `<p role="status">${t('loading')}</p>` : view.view === 'overview' ? overviewHtml() : view.view === 'map' ? mapHtml() : view.view === 'observations' ? observationsHtml() : view.view === 'state' ? stateHtml() : compareHtml()}</main>${context ? inspectorHtml() : ''}</div></section></div>`;
  }
  async function refreshRepository() { repo = await options.repositoryStatus(); return repo; }
  async function loadQuery(clearSelection = false) {
    const sequence = ++querySequence; loading = true; error = null; retry = null;
    if (clearSelection) { view.view='overview';view.objectTrail=[];objectSequence++; stateSequence++; view.selectedObjectId = null; detail = null; stateDetail = null; history = null; state = null; stateReference = null; view.preview = null; inspectedProperty = null; result = null; }
    redraw();
    try {
      const revision=view.queryRevision??'working';
      const query=structuredClone(view.query),automatic=view.kindMode==='auto'||view.kindMode==='structures';if(automatic)delete query.typeIds;
      const [initial,nav,selected]=await Promise.all([options.api.query({query,revision}),options.navigation?.list({revision,offset:0,limit:25}),view.query.contextIds?.length===1&&options.navigation?options.navigation.get({contextId:view.query.contextIds[0],revision,limit:10}).catch(cause=>{if(object(cause)&&('code'in cause&&cause.code==='NOT_FOUND'||cause instanceof ServiceFailure&&cause.detail.code==='NOT_FOUND'))throw {code:'MISSING_CONTEXT'};throw cause;}):null]);
      if(sequence!==querySequence)return;
      typeCatalog=initial.typeCatalog??[];let found=initial;
      if(automatic){const ids=typeCatalog.filter(value=>value.navigationRole==='structure').map(value=>value.id);if(ids.length>1000)throw {code:'TOO_MANY_STRUCTURE_TYPES'};if(ids.length){view.query.typeIds=ids;found=await options.api.query({query:structuredClone(view.query),revision});}else{if(view.kindMode==='structures')throw {code:'STRUCTURE_METADATA_UNAVAILABLE'};delete view.query.typeIds;}if(kindMode===view.kindMode)typeIds=[...view.query.typeIds??[]];}
      if (sequence !== querySequence) return;
      result = found; navigation=nav??null; selectedContext=selected??null; for (const value of found.objects) remember(value); persist();
    } catch (cause) { if (sequence === querySequence) showFailure(cause, () => loadQuery(clearSelection)); }
    finally { if (sequence === querySequence) { loading = false; redraw(); } }
  }
  async function loadState(yearValue: number, reference: FixedKnowledgeState | null = stateReference) {
    const objectId=reference?.objectId??view.selectedObjectId;
    if(!objectId||!civil(yearValue))return failure('INVALID_YEAR');
    const sequence=++stateSequence, inputBefore=yearInput, fixed=reference?{...reference,year:yearValue}:null;
    loadingState=true;error=null;redraw();
    try {
      const value=await options.api.state({state:{objectId,year:yearValue,includeUnreviewed:fixed?.includeUnreviewed??view.includeUnreviewed},revision:fixed?.revision??'working'});
      if(sequence!==stateSequence)return;
      state=value;view.year=value.year;stateReference=fixed;view.preview=fixed?structuredClone(fixed):null;
      if(yearInput===inputBefore)yearInput=String(value.year);
      if(!fixed)stateDetail=detail;
      persist();
      if(value.fields.some(field=>field.assertionIds.length>0))observed({type:'state',objectId,year:value.year,revision:fixed?.revision??'working'});
    }catch(cause){if(sequence===stateSequence)showFailure(cause,()=>loadState(yearValue,reference));}
    finally{if(sequence===stateSequence){loadingState=false;redraw();}}
  }
  async function selectObject(objectId: string, requestedYear?: number,revision=view.queryRevision??'working') {
    const sequence = ++objectSequence; stateSequence++; loadingObject = true; loadingState = false;
    if (view.view === 'overview') view.view = 'observations';
    view.objectRevision=revision;view.selectedObjectId = objectId; detail = null; stateDetail = null; state = null; history = null; stateReference = null; view.preview = null; inspectedProperty = null; committedNotice = false; error = null; redraw();
    try {
      const [objectDetail, historyResult] = await Promise.all([
        options.api.object({ objectId, revision }),
        options.api.history({ objectId, includeUnreviewed: view.includeUnreviewed, revision }),
      ]);
      if (sequence !== objectSequence) return;
      detail = objectDetail; stateDetail = objectDetail; history = historyResult; remember(objectDetail);
      observed({ type: 'object', objectId });
      const withinScope=view.year!==null&&(!view.query.time||view.year>=view.query.time[0]&&view.year<=view.query.time[1])?view.year:view.query.time?.[0];
      const candidateYear = requestedYear ?? withinScope ?? historyResult.observations.find(value => value.kind !== 'coverage-boundary')?.year ?? objectDetail.object.observedTimes[0]?.time.earliestYear;
      if (candidateYear !== undefined && candidateYear !== null && civil(candidateYear)) { loadingObject = false; await loadState(candidateYear,revision==='working'?null:{objectId,year:candidateYear,revision,label:text(objectDetail.object.labels,objectId),includeUnreviewed:view.includeUnreviewed}); }
      else { view.year = null; yearInput = ''; }
      persist();
    } catch (cause) { if (sequence === objectSequence) showFailure(cause, () => selectObject(objectId, requestedYear,revision)); }
    finally { if (sequence === objectSequence) { loadingObject = false; redraw(); } }
  }
  async function fixedCurrent(): Promise<FixedKnowledgeState> {
    if(!view.selectedObjectId||!state||state.objectId!==view.selectedObjectId||loadingState||loadingObject)return failure('INVALID_YEAR');
    const actualYear=state.year;
    if(stateReference)return {...structuredClone(stateReference),year:actualYear};
    return committedReference(view.selectedObjectId,actualYear);
  }
  async function committedReference(objectId: string, yearValue: number): Promise<FixedKnowledgeState> {
    if (!civil(yearValue)) return failure('INVALID_YEAR');
    const includeUnreviewed=view.includeUnreviewed;
    const status = await refreshRepository();
    let objectDetail: KnowledgeObjectDetail;
    try { objectDetail = await options.api.object({ objectId, revision: status.head }); }
    catch (cause) {
      if (cause instanceof ServiceFailure && cause.detail.code === 'NOT_FOUND' || object(cause) && cause.code === 'NOT_FOUND') {
        if (detail?.object.id === objectId) return failure('UNCOMMITTED_OBJECT');
        try { await options.api.object({ objectId, revision: 'working' }); }
        catch { return failure('NOT_FOUND'); }
        return failure('UNCOMMITTED_OBJECT');
      }
      throw cause;
    }
    await options.api.state({state:{objectId,year:yearValue,includeUnreviewed},revision:status.head});
    committedNotice = !!detail && JSON.stringify([detail.object, detail.assertions, detail.sources]) !== JSON.stringify([objectDetail.object, objectDetail.assertions, objectDetail.sources]);
    remember(objectDetail);
    return { objectId: objectDetail.object.id, year: yearValue, revision: status.head, label: text(objectDetail.object.labels, objectDetail.object.id),labels:structuredClone(objectDetail.object.labels), includeUnreviewed };
  }
  async function showFixed(reference: FixedKnowledgeState) {
    const sequence = ++objectSequence; stateSequence++; loadingObject = true; loadingState=false; error = null; state = null; stateDetail = null; detail = null; history = null; inspectedProperty = null; committedNotice = false;
    view.objectRevision=reference.revision;view.selectedObjectId = reference.objectId; view.year = reference.year; yearInput = String(reference.year); stateReference = structuredClone(reference); view.preview = structuredClone(reference); view.view = 'state'; redraw();
    try {
      const [committed, value, historical, working] = await Promise.all([
        options.api.object({ objectId: reference.objectId, revision: reference.revision }),
        options.api.state({ state: { objectId: reference.objectId, year: reference.year, includeUnreviewed: reference.includeUnreviewed }, revision: reference.revision }),
        options.api.history({ objectId: reference.objectId, includeUnreviewed: reference.includeUnreviewed, revision: reference.revision }),
        options.api.object({ objectId: reference.objectId, revision: 'working' }).catch(() => null),
      ]);
      if (sequence !== objectSequence) return;
      stateDetail = committed; detail = working; state = value; history = historical; committedNotice = !!working && JSON.stringify([committed.object,committed.assertions,committed.sources]) !== JSON.stringify([working.object,working.assertions,working.sources]); remember(committed); if (working) remember(working); persist();
      observed({ type: 'object', objectId: reference.objectId });
      if (value.fields.some(field => field.assertionIds.length > 0)) observed({ type: 'state', objectId: reference.objectId, year: reference.year, revision: reference.revision });
    } catch (cause) { if (sequence === objectSequence) showFailure(cause, () => showFixed(reference)); }
    finally { if (sequence === objectSequence) { loadingObject = false; redraw(); } }
  }
  async function fix(target: 'checkout' | 'a' | 'b') {
    const sequence=++pinSequence[target],origin={object:objectSequence,state:stateSequence,diff:diffSequence,query:querySequence,view:view.view};
    const reference = await fixedCurrent();
    if(sequence!==pinSequence[target]||!visible)return;
    view[target] = structuredClone(reference); persist();
    if(origin.object!==objectSequence||origin.state!==stateSequence||origin.diff!==diffSequence||origin.query!==querySequence||origin.view!==view.view){redraw();return;}
    if (target === 'checkout') {const retainedYear=yearInput;await showFixed(reference);yearInput=retainedYear;persist();redraw();}
    else if (view.a && view.b) { view.view = 'compare'; await loadDifference(); }
    else redraw();
  }
  async function loadDifference() {
    if (!view.a || !view.b) { difference = null; return; }
    const sequence = ++diffSequence, a = structuredClone(view.a), b = structuredClone(view.b);
    loadingDiff = true; difference = null; inspectedProperty = null; error = null; redraw();
    try {
      const [value, before, after] = await Promise.all([
        options.api.diff({ a: { state: { objectId: a.objectId, year: a.year, includeUnreviewed: a.includeUnreviewed }, revision: a.revision }, b: { state: { objectId: b.objectId, year: b.year, includeUnreviewed: b.includeUnreviewed }, revision: b.revision } }),
        options.api.object({ objectId: a.objectId, revision: a.revision }), options.api.object({ objectId: b.objectId, revision: b.revision }),
      ]);
      if (sequence !== diffSequence) return;
      difference = value; aDetail = before; bDetail = after; remember(before); remember(after); inspectedSide = 'a'; persist();
      if (JSON.stringify(a) !== JSON.stringify(b) && value.fields.some(field => field.kind === 'changed')) observed({ type: 'comparison', a, b });
    } catch (cause) { if (sequence === diffSequence) showFailure(cause, loadDifference); }
    finally { if (sequence === diffSequence) { loadingDiff = false; redraw(); } }
  }
  async function compareInterval(index: number) {
    const change = history?.changes[index]; if (!change) return;
    const base = await fixedCurrent();
    view.a = { ...base, year: change.observedBetween[0] }; view.b = { ...base, year: change.observedBetween[1] }; view.view = 'compare'; persist(); await loadDifference();
  }
  function researchEvidence(context: KnowledgeObjectDetail, reference: FixedKnowledgeState, fields: KnowledgeStateField[], property?: string | null): PinnedResearchEvidence[] {
    const supportedIds = new Set(fields.filter(field => !property || field.propertyId === property).flatMap(field => [...field.assertionIds, ...field.possibleAssertionIds]));
    const assertions = context.assertions.filter(value => supportedIds.has(value.id));
    return assertions.flatMap(assertion => assertion.evidence.map((evidence, index) => {
      const source = context.sources.find(value => value.id === evidence.sourceId);
      return { id: `${assertion.id}:${reference.year}:${index}`, kind: 'assertion' as const, title: `${text(context.object.labels, context.object.id)} · ${label(assertion.propertyId)} · ${year(reference.year)}`, locator: evidence.locator,
        repositoryRevision: reference.revision, objectId: context.object.id, assertionId: assertion.id, year: reference.year, includeUnreviewed: reference.includeUnreviewed,
        ...(source ? { sourceIdentity: source.identity, ...(source.revision ? { sourceRevision: source.revision } : {}) } : {}),...((evidence.url??source?.revisionUrl??source?.url)?{url:evidence.url??source?.revisionUrl??source?.url}:{}) };
    }));
  }
  async function researchContext(): Promise<ResearchContext> {
    if (view.view === 'compare' && view.a && view.b && aDetail && bDetail && difference) {
      const endpoint = (reference: FixedKnowledgeState) => {const localized=referenceLabels.get(`${reference.revision}\0${reference.objectId}`)??reference.labels;return { label: reference.label,...(localized?{labels:structuredClone(localized)}:{}), repositoryRevision: reference.revision, objectId: reference.objectId, year: reference.year, includeUnreviewed: reference.includeUnreviewed };};
      return { scope: { ...(selectedContext?{label:text(selectedContext.definition.labels)}:view.query.unassigned?{label:t('unassignedMaterial')}:{}),navigation:{schemaVersion:1,revision:view.queryRevision??'working',query:structuredClone(view.query)}, query: view.query.text ?? '', timeWindow: view.query.time ?? [view.a.year, view.b.year].sort((a, b) => a - b) as [number, number], objectIds: [...new Set([view.a.objectId, view.b.objectId])], fieldIds: inspectedProperty ? [inspectedProperty] : difference?.fields.filter(value => value.kind === 'changed').map(value => value.propertyId) ?? [] }, evidence: [...researchEvidence(aDetail, view.a, difference.a.fields, inspectedProperty), ...researchEvidence(bDetail, view.b, difference.b.fields, inspectedProperty)], comparison: { a: endpoint(view.a), b: endpoint(view.b) } };
    }
    const reference = await fixedCurrent();
    const [committed, resolved] = await Promise.all([options.api.object({ objectId: reference.objectId, revision: reference.revision }), options.api.state({ state: { objectId: reference.objectId, year: reference.year, includeUnreviewed: reference.includeUnreviewed }, revision: reference.revision })]);
    return { scope: { ...(selectedContext?{label:text(selectedContext.definition.labels)}:view.query.unassigned?{label:t('unassignedMaterial')}:{}),navigation:{schemaVersion:1,revision:view.queryRevision??'working',query:structuredClone(view.query)}, query: view.query.text ?? '', timeWindow: view.query.time ?? [reference.year, reference.year], objectIds: [reference.objectId], fieldIds: inspectedProperty ? [inspectedProperty] : [] }, evidence: researchEvidence(committed, reference, resolved.fields, inspectedProperty), comparison: null };
  }
  async function saveLearning() { await options.onResearch(await researchContext()); }
  function parseScope(): KnowledgeQuery {
    const temporal = parseResearchPeriod(from, to); if (!temporal.ok) return failure('INVALID_SCOPE');
    const pieces = Object.values(bounds), hasBounds = pieces.some(value => value.trim());
    let geographic: KnowledgeQuery['bounds'];
    if (hasBounds) {
      if (pieces.some(value => !value.trim()) || pieces.some(value => !Number.isFinite(Number(value)))) return failure('INVALID_SCOPE');
      geographic = { west: Number(bounds.west), south: Number(bounds.south), east: Number(bounds.east), north: Number(bounds.north) };
      if (Math.abs(geographic.west) > 180 || Math.abs(geographic.east) > 180 || Math.abs(geographic.south) > 90 || Math.abs(geographic.north) > 90 || geographic.south > geographic.north) return failure('INVALID_SCOPE');
    }
    return { ...(contextIds.length?{contextIds:[...contextIds]}:unassigned?{unassigned:true}:{}), ...(queryText.trim() ? { text: queryText.trim() } : {}), ...(temporal.value ? { time: temporal.value } : {}), ...(geographic ? { bounds: geographic } : {}), ...(typeIds.length ? { typeIds: [...typeIds] } : {}),...(view.query.review?{review:[...view.query.review]}:{}), ...(view.query.objectIds?{objectIds:[...view.query.objectIds]}:{}), includeUndated, includeUnlocated, offset: 0, limit: 40 };
  }
  async function open(savedState?: KnowledgeBrowserState) {
    const opening=++openSequence;visible = true;openingView=true;
    if (savedState) {result=null;navigation=null;selectedContext=null; view = parseKnowledgeBrowserState(JSON.stringify(savedState)) ?? initialKnowledgeBrowserState(); stateReference = view.preview ?? null; }
    else if (!result) { try { view = parseKnowledgeBrowserState(storage().getItem(STORAGE_KEY)) ?? initialKnowledgeBrowserState(); } catch { view = initialKnowledgeBrowserState(); } }
    syncQueryInputs();
    const restoredDraft=yearInput,restoredObject=view.selectedObjectId;
    redraw();
    try {
      await refreshRepository();if(opening!==openSequence||!visible)return;await loadQuery();if(opening!==openSequence||!visible||error)return;
      if (view.view === 'compare' && view.a && view.b) await loadDifference();
      else if ((view.view === 'state' || view.view === 'observations') && view.preview && view.preview.objectId === view.selectedObjectId) { const intendedView = view.view; await showFixed(view.preview); view.view = intendedView; persist(); }
      else if (view.selectedObjectId && view.view !== 'overview') await selectObject(view.selectedObjectId, view.year ?? undefined,view.objectRevision??'working');
    } catch (cause) {if(opening===openSequence&&visible) showFailure(cause, () => open()); }
    finally {
      if(opening===openSequence&&visible){
        openingView=false;
        if(restoredObject&&view.selectedObjectId===restoredObject){yearInput=restoredDraft;persist();}
        redraw();
      }
    }
  }
  async function click(target: HTMLElement) {
    const action = target.dataset.knowledge;
    try {
      if(action==='model-artifact'&&target.dataset.id&&target.dataset.revision)await options.onModelArtifact?.(target.dataset.id,target.dataset.revision);
      else if(action==='new-context')await options.onContext?.({});
      else if(action==='edit-context'||action==='add-material')await options.onContext?.({contextId:target.dataset.id});
      else if(action==='resume-context')await options.onContext?.({},true);
      else if(action==='context'&&target.dataset.id)await applyScope({type:'selection',selection:{mode:'contexts',contextIds:[target.dataset.id]}});
      else if(action==='all-material')await applyScope({type:'selection',selection:{mode:'all'}});
      else if(action==='unassigned')await applyScope({type:'selection',selection:{mode:'unassigned'}});
      else if(action==='all-kinds'){view.kindMode='all';kindMode='all';typeIds=[];delete view.query.typeIds;view.query.offset=0;persist();await loadQuery(true);}
      else if(action==='reset-scope')await applyScope({type:'reset'});
      else if(action==='back-scope'){view.view='overview';persist();redraw();}
      else if(action==='contexts-page'&&options.navigation){const q=querySequence,value=await options.navigation.list({revision:view.queryRevision??'working',offset:Number(target.dataset.offset),limit:25});if(q===querySequence){navigation=value;redraw();}}
      else if (action === 'new-object') await options.onEdit?.({});
      else if (action === 'edit-object' || action === 'correct-assertion') {
        const context = currentContext();
        if (context) await options.onEdit?.({objectId:context.object.id,...(action==='correct-assertion'&&target.dataset.id?{assertionId:target.dataset.id}:{}),...(view.year!==null?{year:view.view==='compare'?(inspectedSide==='b'?view.b?.year:view.a?.year)??view.year:view.year}:{}),observedRevision:context.revision});
      }
      else if (action === 'related' && target.dataset.id) {
        const objectId = target.dataset.id, revision = target.dataset.revision ?? 'working', yearValue = target.dataset.year ? Number(target.dataset.year) : undefined, sequence = objectSequence;
        if (revision !== 'working' && !/^[a-f0-9]{40}$/.test(revision) || yearValue !== undefined && !civil(yearValue)) return failure('INVALID_REQUEST');
        await options.api.object({ objectId, revision });
        if (sequence !== objectSequence) return;
        const { objectTrail, ...previous } = structuredClone(view);
        view.objectTrail = [...objectTrail ?? [], previous].slice(-20);
        view.includeUnreviewed = target.dataset.unreviewed === 'true'; view.view = yearValue === undefined ? 'observations' : 'state';
        await selectObject(objectId, yearValue, revision);
      }
      else if (action === 'back-related' && view.objectTrail?.length) {
        const trail = [...view.objectTrail], previous = trail.pop()!;
        await open({ ...previous, checkout: view.checkout, a: view.a, b: view.b, objectTrail: trail });
      }
      else if ((action === 'object' || action === 'map-object') && target.dataset.id) await selectObject(target.dataset.id);
      else if (action === 'view' && ['overview', 'map', 'observations', 'state', 'compare'].includes(target.dataset.view ?? '')) { view.view = target.dataset.view as KnowledgeBrowserView; persist(); if (view.view === 'compare' && view.a && view.b) await loadDifference(); else redraw(); }
      else if (action === 'refresh') { await refreshRepository(); await loadQuery(); if (view.selectedObjectId && !stateReference) await selectObject(view.selectedObjectId, view.year ?? undefined); }
      else if (action === 'previous' && result) { view.query.offset = Math.max(0, result.offset - result.limit); await loadQuery(); }
      else if (action === 'next' && result && result.offset + result.limit < result.total) { view.query.offset = result.offset + result.limit; await loadQuery(); }
      else if (action === 'type' && target.dataset.id) { view.kindMode='types';kindMode='types';view.query.typeIds = [target.dataset.id]; typeIds=[target.dataset.id];view.query.offset = 0; view.view = 'overview'; await loadQuery(true); }
      else if (action === 'coverage-time' && target.dataset.from && target.dataset.to) { const interval: [number,number] = [Number(target.dataset.from),Number(target.dataset.to)]; if (!interval.every(civil) || interval[0] > interval[1]) return failure('INVALID_SCOPE'); view.query.time = interval; view.query.offset = 0; view.view = 'overview';from=String(interval[0]);to=String(interval[1]);persist(); await loadQuery(true); }
      else if(action==='clear-objects'){delete view.query.objectIds;view.query.offset=0;await loadQuery();}
      else if(action==='clear-fields'){delete view.fieldIds;persist();redraw();}
      else if (action === 'clear-types') { delete view.query.typeIds;typeIds=[];view.kindMode='all';kindMode='all'; await loadQuery(true); }
      else if (action === 'find-data') await options.onFindData(structuredClone(view.query));
      else if (action === 'changes') await options.onOpenChanges();
      else if (action === 'retry' && retry) await retry();
      else if (action === 'checkout') await fix('checkout');
      else if (action === 'show-working' && view.selectedObjectId) await selectObject(view.selectedObjectId, view.year ?? undefined);
      else if (action === 'set-a') await fix('a');
      else if (action === 'set-b') await fix('b');
      else if (action === 'show-checkout' && view.checkout) await showFixed(view.checkout);
      else if (action === 'show-a' && view.a) await showFixed(view.a);
      else if (action === 'show-b' && view.b) await showFixed(view.b);
      else if (action === 'clear-a' || action === 'clear-b') { view[action === 'clear-a' ? 'a' : 'b'] = null; diffSequence++; difference = null; aDetail = null; bDetail = null; loadingDiff = false; persist(); redraw(); }
      else if (action === 'observation' && target.dataset.year) { view.view = 'state'; await loadState(Number(target.dataset.year)); }
      else if (action === 'compare-interval' && target.dataset.index) await compareInterval(Number(target.dataset.index));
      else if (action === 'field' && target.dataset.property) {
        inspectedProperty = target.dataset.property; inspectedSide = target.dataset.side === 'a' || target.dataset.side === 'b' ? target.dataset.side : 'preview'; redraw();
        const context = view.view === 'compare' ? inspectedSide === 'b' ? bDetail : aDetail : stateDetail ?? detail;
        const shownField=(view.view==='compare'?(inspectedSide==='b'?difference?.b:difference?.a):state)?.fields.find(value=>value.propertyId===inspectedProperty),shownIds=new Set([...(shownField?.assertionIds??[]),...(shownField?.possibleAssertionIds??[])]);
        const supporting = context?.assertions.filter(value => shownIds.has(value.id)&&value.evidence.some(evidence => context.sources.some(source => source.id === evidence.sourceId))) ?? [];
        if (context && supporting.length) observed({ type: 'evidence', objectId: context.object.id, propertyId: inspectedProperty, assertionIds: supporting.map(value => value.id), revision: context.revision });
      }
      else if (action === 'research') await saveLearning();
      else if (action === 'world') { mapBox = { x: 0, y: 0, width: 1000, height: 520 }; redraw(); }
      else if (action === 'zoom-in' || action === 'zoom-out') {
        const factor = action === 'zoom-in' ? .65 : 1.54, nextWidth = Math.max(80, Math.min(1000, mapBox.width * factor)), nextHeight = nextWidth * .52;
        const coordinate = detail?.object.coordinates[0], center = coordinate ? knowledgeMapPoint(coordinate.longitude, coordinate.latitude) : null;
        const x = center?.[0] ?? mapBox.x + mapBox.width / 2, y = center?.[1] ?? mapBox.y + mapBox.height / 2;
        mapBox = { x: Math.max(0, Math.min(1000 - nextWidth, x - nextWidth / 2)), y: Math.max(0, Math.min(520 - nextHeight, y - nextHeight / 2)), width: nextWidth, height: nextHeight }; redraw();
      }
    } catch (cause) { showFailure(cause); }
  }
  async function submit(form: HTMLFormElement) {
    try {
      if (form.dataset.knowledgeForm === 'scope') { view.query = parseScope();view.kindMode=kindMode;await loadQuery(true); }
      else if (form.dataset.knowledgeForm === 'year') { if (!yearInput.trim() || !civil(Number(yearInput))) return failure('INVALID_YEAR'); view.view = 'state'; await loadState(Number(yearInput)); }
    } catch (cause) { showFailure(cause); }
  }
  function input(target: HTMLInputElement) {
    const action = target.dataset.knowledgeInput;
    if (action === 'query') queryText = target.value;
    else if (action === 'from') from = target.value;
    else if (action === 'to') to = target.value;
    else if (action === 'west' || action === 'east' || action === 'south' || action === 'north') bounds[action] = target.value;
    else if (action === 'year') {yearInput=target.value;const activeYear=document.querySelector('[data-knowledge-actual-year]');if(activeYear&&state){let notice=activeYear.nextElementSibling;if(yearInput.trim()!==String(state.year)){if(!notice?.classList.contains('knowledge-year-pending')){notice=document.createElement('p');notice.className='knowledge-year-pending';activeYear.after(notice);}notice.textContent=t('unappliedYear');}else if(notice?.classList.contains('knowledge-year-pending'))notice.remove();}}
    else if (action === 'field-filter') { fieldFilter = target.value; const fields = document.querySelector('[data-knowledge-fields]'); if (fields) fields.innerHTML = view.view === 'compare' ? comparisonRowsHtml() : stateRowsHtml(); }
    persist();
  }
  async function change(target: HTMLInputElement | HTMLSelectElement) {
    if(target.dataset.knowledgeInput==='context'&&target instanceof HTMLSelectElement){const option=target.selectedOptions[0];if(option.dataset.mode==='all'){contextIds=[];unassigned=false;}else if(option.dataset.mode==='unassigned'){contextIds=[];unassigned=true;}else if(option.dataset.mode==='context'&&option.dataset.id){contextIds=[option.dataset.id];unassigned=false;}persist();return;}
    if(target.dataset.knowledgeInput==='type'&&target instanceof HTMLSelectElement){const option=target.selectedOptions[0];if(option.dataset.mode==='all'){kindMode='all';typeIds=[];}else if(option.dataset.mode==='structures'){kindMode='structures';typeIds=typeCatalog.filter(value=>value.navigationRole==='structure').map(value=>value.id);}else if(option.dataset.mode==='type'&&option.dataset.id){kindMode='types';typeIds=[option.dataset.id];}persist();return;}
    if (!('checked' in target)) return;
    if (target.dataset.knowledgeInput === 'undated') includeUndated = target.checked;
    else if (target.dataset.knowledgeInput === 'unlocated') includeUnlocated = target.checked;
    else if (target.dataset.knowledgeInput === 'unreviewed') { const retainedYear=yearInput;view.includeUnreviewed = target.checked; persist(); if (stateReference) await showFixed({ ...stateReference, includeUnreviewed: target.checked }); else if (view.selectedObjectId) await selectObject(view.selectedObjectId, view.year ?? undefined,view.objectRevision??'working');yearInput=retainedYear;persist();redraw(); }
    persist();
  }
  function key(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if ((event.key === 'Enter' || event.key === ' ') && target?.dataset?.knowledge === 'map-object') { event.preventDefault(); void click(target); }
  }
  async function applyScope(patch:NavigationScopePatch){persist();view=applyNavigationScopePatch(view,patch);syncQueryInputs();await loadQuery(true);}
  async function execute(intent: KnowledgeBrowserIntent): Promise<{ ok: true } | { ok: false; code: string }> {
    try {
      if(intent.type==='scope')await applyScope(intent.patch);
      else if (intent.type === 'search') { view.query = structuredClone(intent.query);view.kindMode=intent.query.typeIds?.length?'types':'all';delete view.scopeDraft;syncQueryInputs(); await loadQuery(true); }
      else if(intent.type==='observations-version'){if(intent.revision!=='working'&&!/^[a-f0-9]{40}$/.test(intent.revision))return failure('INVALID_REQUEST');view.view='observations';view.includeUnreviewed=intent.includeUnreviewed;await selectObject(intent.objectId,undefined,intent.revision);}
      else if (intent.type === 'show') { if(intent.includeUnreviewed!==undefined)view.includeUnreviewed=intent.includeUnreviewed;view.view = 'state'; await selectObject(intent.objectId, intent.year); }
      else if (intent.type === 'checkout') { const reference = await committedReference(intent.objectId, intent.year); view.checkout = reference; persist(); await showFixed(reference); }
      else if (intent.type === 'show-version') { if(!isFixedKnowledgeState(intent.reference))return failure('INVALID_REQUEST');view.checkout=structuredClone(intent.reference);persist();await showFixed(intent.reference); }
      else if (intent.type === 'preview-version') { if(!isFixedKnowledgeState(intent.reference))return failure('INVALID_REQUEST'); await showFixed(intent.reference); }
      else { if (!isFixedKnowledgeState(intent.a) || !isFixedKnowledgeState(intent.b)) return failure('INVALID_REQUEST'); view.a = structuredClone(intent.a); view.b = structuredClone(intent.b); view.view = 'compare'; persist(); await loadDifference(); }
      return error ? { ok: false, code: error } : { ok: true };
    } catch (cause) { showFailure(cause); return { ok: false, code: error ?? 'IO_ERROR' }; }
  }
  return { open, content, click, submit, input, change, key, execute, researchContext, state: () => structuredClone(view), hide: () => { persist(); visible = false;openingView=false;openSequence++; querySequence++; objectSequence++; stateSequence++; diffSequence++;pinSequence.checkout++;pinSequence.a++;pinSequence.b++; } };
}
