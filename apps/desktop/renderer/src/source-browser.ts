import type { KnowledgeQuery } from '../../../../packages/domain/src/knowledge.ts';
import type { KnowledgeImportResult } from '@gitworld/contracts';
import type { HistoryLocale } from '@gitworld/domain';
import type { KnowledgeMappingPreview, OperationProgress, SourceJob, SourceLabel, SourceRecordDetail } from '@gitworld/contracts';
import type { JsonValue, SourceIssue, SourceSearchHit, WikidataSearchPage } from '../../../../packages/ingestion/src/source-types';
import { bridge, escapeHtml as esc, operationId, request, ServiceFailure } from './client';
import { sourceCopy as copy, type SourceCopyKey } from './source-copy';
import { createKnowledgeFiles } from './knowledge-files.ts';
import './knowledge-files.css';
import { createCollectionBrowser } from './collection-browser.ts';
import { collectionCopy } from './collection-copy.ts';
import type { SourceObservation } from './source-observation.ts';
import { createWikipediaBrowser } from './wikipedia-browser.ts';
import { wikipediaCopy } from './wikipedia-copy.ts';
import './collection-browser.css';
import './wikipedia-browser.css';

type Options = { locale: () => HistoryLocale; render: () => void; onClose: () => void; navigationVersion?:()=>number; onAdopted?: (result:KnowledgeImportResult,jobId:string,interaction?:number) => void | Promise<void>; onObserved?: (event: SourceObservation) => void; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> };
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const values = (value: unknown): JsonValue[] => Array.isArray(value) ? value : [];
const safeLink = (url: unknown): string | null => {
  if (typeof url !== 'string') return null;
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; }
};
const entityLink = (id: string) => /^([QP])[1-9]\d*$/.test(id) ? `https://www.wikidata.org/wiki/${id}` : null;

export function createSourceBrowser(options: Options) {
  let visible = false, tab: 'search' | 'saved' | 'collections' | 'files' = 'collections', query = '';
  let viewEpoch = 0;
  let provider: 'wikidata' | 'wikipedia' = 'wikidata', restoredNavigation = false;
  const storage = () => options.storage ?? localStorage;
  const observed = (event: SourceObservation) => { try { options.onObserved?.(event); } catch { /* Observers do not change acquired data. */ } };
  const files=createKnowledgeFiles({locale:options.locale,render:()=>{if(visible&&tab==='files')options.render();},navigationVersion:options.navigationVersion,onAdopted:options.onAdopted,onObserved:observed});
  const collections = createCollectionBrowser({ locale: options.locale, render: ()=>{if(visible&&tab==='collections')options.render();}, navigationVersion:options.navigationVersion, onAdopted: options.onAdopted, onObserved: observed });
  const wikipedia = createWikipediaBrowser({ locale: options.locale, render: () => { if (visible && provider === 'wikipedia' && (tab === 'search' || tab === 'saved')) options.render(); }, storage: options.storage, navigationVersion: options.navigationVersion, onAdopted: options.onAdopted, onObserved: observed, onResumeImport: openImports, onSection: next => { if (!visible || provider !== 'wikipedia') return; tab = next; viewEpoch++; recordSequence++; jobsSequence++; redraw(); } });
  let searchLanguage: 'en' | 'zh' = options.locale() === 'zh-CN' ? 'zh' : 'en';
  let page: WikidataSearchPage | null = null, hits: SourceSearchHit[] = [], selected = new Set<string>();
  let jobs: SourceJob[] = [], jobIssues: { jobId: string; code: string }[] = [], jobId: string | null = null;
  let recordId: string | null = null, detail: SourceRecordDetail | null = null, loadingRecord = false, loadingJobs = false;
  let active: { id: string; kind: 'search' | 'collect' } | null = null, progress: OperationProgress | null = null, cancelling = false;
  let error: SourceIssue | { code: string; retryable: boolean } | null = null, retryAction: 'search' | 'record' | null = null;
  let searched = false, attemptedCursor: string | undefined, recordSequence = 0, jobsSequence = 0;
  let propertyFilter = '', propertyLimit = 25, materialPage = 0, includeProperties = false, rawVisible = false;
  let unsubscribe: (() => void) | null = null;
  let mappingPreview:KnowledgeMappingPreview|null=null, mappingHead:string|null=null, mappingBusy=false, useInStates=false;
  const t = (key: SourceCopyKey) => copy(options.locale(), key as Exclude<SourceCopyKey, 'selected' | 'selectRecord' | 'progress' | 'pending' | 'recordsCount' | 'claimsCount' | 'rateError' | 'savedAt' | 'page' | 'range'>);
  const format = (value: number) => new Intl.NumberFormat(options.locale()).format(value);
  const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat(options.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); };
  const localized = (label: SourceLabel | undefined, fallback = '') => options.locale() === 'zh-CN' ? label?.zh ?? label?.en ?? fallback : label?.en ?? label?.zh ?? fallback;
  const localizedHtml = (label: SourceLabel | undefined, fallback = '') => `${esc(localized(label, fallback))}${options.locale() === 'zh-CN' && !label?.zh && label?.en ? '<span class="source-language">EN</span>' : ''}`;
  const button = (action: string, label: string, extra = '') => `<button type="button" class="source-button" data-source="${action}" ${extra}>${esc(label)}</button>`;
  const redraw = () => { if (visible) options.render(); };
  const currentJob = () => jobs.find(job => job.id === jobId) ?? null;
  const labelFor = (id: string) => localized(detail?.labels[id], id);
  const link = (url: unknown, label: string) => { const safe = safeLink(url); return safe ? `<a href="${esc(safe)}">${esc(label)}</a>` : esc(label); };
  function showFailure(cause: unknown, retry: typeof retryAction = null) {
    error = cause instanceof ServiceFailure ? { code: cause.detail.code, retryable: true } : { code: 'SERVICE_UNAVAILABLE', retryable: true };
    retryAction = retry;
  }
  function errorText(issue: NonNullable<typeof error>) {
    if (issue.code === 'RATE_LIMITED') return copy(options.locale(), 'rateError', { seconds: Math.max(1, Math.ceil(('retryAfterMs' in issue ? issue.retryAfterMs ?? 5000 : 5000) / 1000)) });
    const keys: Record<string, SourceCopyKey> = { NETWORK_FAILED: 'networkError', UPSTREAM_BUSY: 'busyError', CANCELLED: 'cancelledError', INVALID_REQUEST: 'invalidError', RECORD_MISSING: 'missingError', INVALID_RESPONSE: 'responseError', RESPONSE_TOO_LARGE: 'responseError', API_ERROR: 'responseError', HTTP_ERROR: 'networkError', STAGING_FAILED: 'stagingError', CHECKPOINT_INVALID: 'corruptJob', NOT_FOUND: 'notFound',HEAD_CHANGED:'mappingChanged',CONFLICT:'mappingChanged' };
    return t(keys[issue.code] ?? 'serviceError');
  }
  function errorHtml() {
    return error ? `<div class="source-notice error" role="alert"><p>${esc(errorText(error))}</p><details><summary>${t('errorCode')}</summary><code>${esc(error.code)}</code></details>${retryAction === 'search' ? button('retry-search', t('retrySearch'), active ? 'disabled' : '') : retryAction === 'record' ? button('retry-record', t('retryRecord'), loadingRecord ? 'disabled' : '') : ''}</div>` : '';
  }
  function progressText() {
    if (cancelling) return t('cancelling');
    if (active?.kind === 'search') return t('searching');
    if (progress?.stage === 'normalizing') return t('labelsProgress');
    if (progress?.completed !== undefined && progress.total !== undefined) return copy(options.locale(), 'progress', { completed: progress.completed, total: progress.total });
    return t('collecting');
  }
  function progressHtml() {
    return active ? `<div class="source-notice source-progress" role="status"><span data-source-progress-text>${esc(progressText())}</span><progress data-source-progress ${progress?.total ? `max="${progress.total}" value="${progress.completed ?? 0}"` : ''}></progress>${button('cancel', t(cancelling ? 'cancelling' : 'cancel'), cancelling ? 'disabled' : '')}</div>` : '';
  }
  function mappingHtml() {
    if(!currentJob()?.materials.length)return '';
    return `<section class="source-notice"><div class="source-toolbar">${button('preview-mapping',t('previewMapping'),mappingBusy||active?'disabled':'')}</div>${mappingPreview?`<p>${esc(copy(options.locale(),'mappingSummary',{objects:mappingPreview.objects,assertions:mappingPreview.assertions,dated:mappingPreview.datedAssertions}))}</p><p>${t('mappingHint')}</p><ul>${mappingPreview.sample.map(object=>`<li>${esc(object.labels[options.locale()]??object.labels.en??object.id)}</li>`).join('')}</ul>${mappingPreview.issueCount?`<details><summary>${t('mappingIssues')} · ${format(mappingPreview.issueCount)}</summary>${mappingPreview.issues.map(issue=>`<p><code>${esc(issue.code)} · ${esc(issue.locator)}</code></p>`).join('')}</details>`:''}<label class="source-checkbox"><input type="checkbox" data-source-change="use-states" ${useInStates?'checked':''} ${mappingBusy?'disabled':''}>${t('useInStates')}</label>${button('apply-mapping',t('applyMapping'),mappingBusy||!mappingPreview.objects?'disabled':'')}`:''}</section>`;
  }
  function updateProgress() {
    if (!visible) return;
    const text = document.querySelector('[data-source-progress-text]'); if (text) text.textContent = progressText();
    const bar = document.querySelector<HTMLProgressElement>('[data-source-progress]');
    if (bar && progress?.total) { bar.max = progress.total; bar.value = progress.completed ?? 0; }
  }
  function searchHtml() {
    return `<section class="source-content"><h1>${t('findData')}</h1><form class="source-search-form" data-source-form="search"><label class="source-query">${t('searchLabel')}<input name="query" data-source-input="query" value="${esc(query)}" placeholder="${t('queryPlaceholder')}" maxlength="200" required autocomplete="off"></label><label>${t('searchLanguage')}<select data-source-change="language" name="language"><option value="en" ${searchLanguage === 'en' ? 'selected' : ''}>English</option><option value="zh" ${searchLanguage === 'zh' ? 'selected' : ''}>简体中文</option></select></label><button class="source-button primary" type="submit" ${active ? 'disabled' : ''}>${t('search')}</button></form><p class="source-muted">${t('searchHint')}</p>${errorHtml()}${progressHtml()}${hits.length ? `<div class="source-toolbar"><h2>${t('results')}</h2><span data-source-selected>${esc(copy(options.locale(), 'selected', { count: selected.size }))}</span><span class="source-spacer"></span>${button('select-page', t('selectPage'), active ? 'disabled' : '')}${button('clear-selection', t('clearSelection'), active || !selected.size ? 'disabled' : '')}<button type="button" class="source-button primary" data-source="collect" ${active || !selected.size ? 'disabled' : ''}>${t('collect')}</button></div><div class="source-list">${hits.map(hit => `<label class="source-result"><input type="checkbox" data-source-change="select" value="${esc(hit.identity.externalId)}" ${selected.has(hit.identity.externalId) ? 'checked' : ''} ${active ? 'disabled' : ''} aria-label="${esc(copy(options.locale(), 'selectRecord', { name: hit.label }))}"><span><strong>${esc(hit.label)}</strong>${hit.description ? `<p>${esc(hit.description)}</p>` : ''}<code>${esc(hit.identity.externalId)}</code></span>${link(hit.url, 'Wikidata')}</label>`).join('')}</div>${page?.nextCursor ? `<div class="source-pagination">${button('next-search', t('nextPage'), active ? 'disabled' : '')}</div>` : ''}${page?.continuationLimitReached ? `<p class="source-notice">${t('limitReached')}</p>` : ''}` : `<p class="source-empty">${searched && !active ? t('noResults') : t('startSearch')}</p>`}</section>`;
  }
  function materialHtml() {
    const job = currentJob(), materials = (job?.materials ?? []).filter(record => includeProperties || record.kind !== 'property');
    const pages = Math.max(1, Math.ceil(materials.length / 40)); materialPage = Math.min(materialPage, pages - 1);
    const current = materials.slice(materialPage * 40, (materialPage + 1) * 40);
    return `<section class="source-content"><div class="source-toolbar"><h1>${t('saved')}</h1><span class="source-spacer"></span>${button('refresh', t('refresh'), loadingJobs ? 'disabled' : '')}</div><p class="source-muted">${t('savedNotice')}</p>${mappingHtml()}${errorHtml()}${progressHtml()}${jobIssues.length ? `<div class="source-notice error" role="alert">${t('corruptJob')}<details><summary>${t('issueDetails')}</summary>${jobIssues.map(issue => `<p><code>${esc(issue.jobId)} · ${esc(issue.code)}</code></p>`).join('')}</details></div>` : ''}${loadingJobs ? `<p role="status">${t('refreshing')}</p>` : ''}${!jobs.length ? `<p class="source-empty">${t('emptySaved')}</p>` : `<div class="source-saved-layout"><aside class="source-sidebar"><label>${t('jobs')}<select data-source-change="job">${jobs.map(entry => `<option value="${esc(entry.id)}" ${entry.id === jobId ? 'selected' : ''}>${esc(date(entry.receipt.startedAt))} · ${esc(t(entry.receipt.status))} · ${format(entry.materials.filter(record => record.kind === 'item').length)}</option>`).join('')}</select></label>${job ? `<div class="source-toolbar"><span>${esc(t(job.receipt.status))}</span><span>${esc(copy(options.locale(), 'recordsCount', { count: job.materials.filter(record => record.kind === 'item').length }))}</span></div>${job.pending.length ? `<p class="source-muted">${esc(copy(options.locale(), 'pending', { count: job.pending.length }))}</p>${button('resume', t('resume'), active ? 'disabled' : '')}` : ''}${job.labelIssues.length ? `<p class="source-notice">${t('missingLabels')}</p>` : ''}${job.receipt.issues.length ? `<details class="source-provenance"><summary>${t('issueDetails')}</summary>${job.receipt.issues.slice(0, 20).map(issue => `<p>${esc(issue.externalId ?? '')} ${esc(errorText(issue))} <code>${esc(issue.code)}</code></p>`).join('')}</details>` : ''}` : ''}<label class="source-checkbox"><input type="checkbox" data-source-change="properties" ${includeProperties ? 'checked' : ''}>${t('showProperties')}</label><div class="source-material-list">${current.map(record => `<button type="button" class="source-material" data-source="record" data-id="${esc(record.identity.externalId)}" ${record.identity.externalId === recordId ? 'aria-current="true"' : ''}><strong>${localizedHtml(record.label, record.identity.externalId)}</strong>${record.description ? `<small>${localizedHtml(record.description)}</small>` : ''}<small>${esc(record.identity.externalId)} · ${esc(copy(options.locale(), 'claimsCount', { count: record.claimCount }))}</small></button>`).join('')}</div>${pages > 1 ? `<div class="source-pagination">${button('previous-materials', t('previous'), materialPage === 0 ? 'disabled' : '')}<small>${esc(copy(options.locale(), 'page', { page: materialPage + 1, pages }))}</small>${button('next-materials', t('next'), materialPage >= pages - 1 ? 'disabled' : '')}</div>` : ''}</aside><section class="source-detail">${loadingRecord ? `<p role="status">${t('loadingRecord')}</p>` : detail ? detailHtml() : `<p class="source-empty">${t('chooseRecord')}</p>`}</section></div>`}</section>`;
  }
  function recordLabels(raw: Record<string, JsonValue>, key: 'labels' | 'descriptions'): SourceLabel {
    const dictionary = object(raw[key]) ? raw[key] : {};
    const en = object(dictionary.en) && typeof dictionary.en.value === 'string' ? dictionary.en.value : undefined;
    const zh = ['zh-hans', 'zh-cn', 'zh'].map(language => dictionary[language]).find(value => object(value) && typeof value.value === 'string');
    return { en, zh: object(zh) ? String(zh.value) : undefined };
  }
  function valueHtml(snak: JsonValue): string {
    if (!object(snak)) return esc(t('unsupported'));
    if (snak.snaktype === 'somevalue') return `<span class="source-muted">${t('sourceUnknown')}</span>`;
    if (snak.snaktype === 'novalue') return `<span class="source-muted">${t('sourceAbsent')}</span>`;
    const dataValue = object(snak.datavalue) ? snak.datavalue : null, value = dataValue?.value;
    if (value === undefined) return esc(t('unsupported'));
    if (object(value) && typeof value.id === 'string') return `${link(entityLink(value.id), labelFor(value.id))} <small>${esc(value.id)}</small>`;
    if (object(value) && typeof value.time === 'string') {
      const precision = Number(value.precision), match = value.time.match(/^([+-])(\d+)-(\d\d)-(\d\d)T/);
      let time = value.time;
      if (match && Number(match[2]) !== 0) {
        const year = match[1] === '-' ? (options.locale() === 'zh-CN' ? `公元前 ${Number(match[2])}` : `${Number(match[2])} BCE`) : String(Number(match[2]));
        time = precision <= 9 ? year : precision === 10 ? `${year}-${match[3]}` : `${year}-${match[3]}-${match[4]}${precision > 11 ? ` ${value.time.split('T')[1]}` : ''}`;
      }
      const precisions: Record<number, SourceCopyKey> = { 6: 'millennium', 7: 'century', 8: 'decade', 9: 'year', 10: 'month', 11: 'day', 12: 'hour', 13: 'minute', 14: 'second' };
      const calendar = typeof value.calendarmodel === 'string' ? value.calendarmodel : '';
      const calendarId = calendar.split('/').at(-1) ?? '';
      const calendarText = calendarId === 'Q1985727' ? t('gregorian') : calendarId === 'Q1985786' ? t('julian') : labelFor(calendarId);
      return `${esc(time)}<div class="source-value-meta">${t('precision')}: ${esc(t(precisions[precision] ?? 'broader'))} · ${t('calendar')}: ${link(calendar, calendarText)}${Number(value.before) || Number(value.after) ? ` · ${t('beforeAfter')}: ${esc(value.before)} / ${esc(value.after)}` : ''}</div>`;
    }
    if (object(value) && typeof value.text === 'string') return `${esc(value.text)} <small>${esc(value.language)}</small>`;
    if (object(value) && typeof value.amount === 'string') return `${esc(value.amount)}${value.unit && value.unit !== '1' ? ` <small>${t('unit')}: ${link(value.unit, labelFor(String(value.unit).split('/').at(-1)!))}</small>` : ''}${value.lowerBound || value.upperBound ? `<div class="source-value-meta">${t('bounds')}: ${esc(value.lowerBound)} – ${esc(value.upperBound)}</div>` : ''}`;
    if (object(value) && typeof value.latitude === 'number' && typeof value.longitude === 'number') return `${esc(value.latitude)}, ${esc(value.longitude)}<div class="source-value-meta">${t('coordinatePrecision')}: ${esc(value.precision)}${typeof value.globe === 'string' ? ` · ${t('globe')}: ${link(value.globe, labelFor(value.globe.split('/').at(-1)!))}` : ''}</div>`;
    if (typeof value === 'string') return snak.datatype === 'url' ? link(value, value) : esc(value);
    if (typeof value === 'number' || typeof value === 'boolean') return esc(value);
    return `<span>${t('unsupported')}</span><details class="source-raw"><summary>${t('raw')}</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`;
  }
  function snakGroup(group: unknown) {
    if (!object(group)) return '';
    return Object.entries(group).map(([property, snaks]) => `<div class="source-qualifier"><span class="source-qualifier-name">${esc(labelFor(property))} <small>${esc(property)}</small></span><span>${values(snaks).map(valueHtml).join('<br>')}</span></div>`).join('');
  }
  function propertyHtml(property: string, statements: JsonValue[]) {
    return `<section class="source-property"><h3>${esc(labelFor(property))} ${link(entityLink(property), property)}</h3>${statements.map(statement => {
      if (!object(statement)) return '';
      const rank = ['preferred', 'normal', 'deprecated'].includes(String(statement.rank)) ? String(statement.rank) as 'preferred' | 'normal' | 'deprecated' : 'normal';
      const references = values(statement.references);
      return `<article class="source-statement"><div class="source-statement-value">${valueHtml(statement.mainsnak)}</div><span class="source-rank ${rank}" title="${t('sourceRank')}">${t(rank)}</span>${object(statement.qualifiers) && Object.keys(statement.qualifiers).length ? `<div class="source-qualifiers"><strong>${t('qualifiers')}</strong>${snakGroup(statement.qualifiers)}</div>` : ''}${references.length ? `<details class="source-reference"><summary>${t('references')} · ${format(references.length)}</summary>${references.map(reference => object(reference) ? `<article>${snakGroup(reference.snaks)}</article>` : '').join('')}</details>` : `<p class="source-value-meta">${t('noReferences')}</p>`}</article>`;
    }).join('')}</section>`;
  }
  function propertiesHtml() {
    if (!detail || !object(detail.snapshot.raw)) return '';
    const claims = object(detail.snapshot.raw.claims) ? detail.snapshot.raw.claims : {};
    const all = Object.entries(claims).filter(([id]) => !propertyFilter || `${id} ${labelFor(id)}`.toLocaleLowerCase().includes(propertyFilter.toLocaleLowerCase()));
    return all.slice(0, propertyLimit).map(([id, statements]) => propertyHtml(id, values(statements))).join('') + (all.length > propertyLimit ? `<div class="source-pagination">${button('more-properties', t('moreProperties'))}</div>` : '') + (!all.length ? `<p class="source-empty">${t(Object.keys(claims).length ? 'noProperties' : 'noStatements')}</p>` : '');
  }
  function detailHtml() {
    const snapshot = detail!.snapshot, raw = object(snapshot.raw) ? snapshot.raw : {};
    const title = recordLabels(raw, 'labels'), description = recordLabels(raw, 'descriptions');
    return `<div class="source-detail-title"><h2>${localizedHtml(title, snapshot.identity.externalId)}</h2><code>${esc(snapshot.identity.externalId)}</code></div>${localized(description) ? `<p class="source-detail-description">${localizedHtml(description)}</p>` : ''}<div class="source-detail-actions">${link(snapshot.url, t('sourceRecord'))}${snapshot.revisionUrl ? link(snapshot.revisionUrl, t('fixedRevision')) : ''}</div><details class="source-provenance"><summary>${t('sourceDetails')}</summary><dl><dt>${t('sourceRevision')}</dt><dd>${esc(snapshot.sourceRevision)}</dd><dt>${t('retrieved')}</dt><dd>${esc(date(snapshot.retrievedAt))}</dd><dt>${t('license')}</dt><dd>${link(snapshot.rights.licenseUrl, snapshot.rights.licenseId ?? '')}</dd><dt>SHA-256</dt><dd><code>${esc(snapshot.contentHash)}</code></dd></dl></details><h3>${t('statements')}</h3><p class="source-value-meta">${t('noDateInference')}</p><label class="source-property-filter">${t('filterProperties')}<input data-source-input="property-filter" value="${esc(propertyFilter)}" autocomplete="off"></label><div data-source-properties>${propertiesHtml()}</div><section class="source-raw">${button('raw', t(rawVisible ? 'raw' : 'showRaw'))}${rawVisible ? `<pre>${esc(JSON.stringify(snapshot.raw, null, 2))}</pre>` : ''}</section>`;
  }
  async function loadJobs(preferred?: string) {
    const sequence = ++jobsSequence; loadingJobs = true; redraw();
    try {
      const result = await request('source.jobs', {}); if (sequence !== jobsSequence) return;
      jobs = result.jobs; jobIssues = result.issues;
      jobId = preferred ?? (jobs.some(job => job.id === jobId) ? jobId : jobs[0]?.id ?? null);
    } catch (cause) { if (sequence === jobsSequence) showFailure(cause); }
    finally { if (sequence === jobsSequence) { loadingJobs = false; redraw(); } }
  }
  async function search(cursor?: string) {
    if (active || !query.trim()) return;
    const id = operationId(), requestedQuery = cursor ? page?.query ?? query.trim() : query.trim(), language = cursor ? page?.language === 'zh-hans' || page?.language === 'zh' ? 'zh' : 'en' : searchLanguage;
    active = { id, kind: 'search' }; attemptedCursor = cursor; progress = null; cancelling = false; error = null; retryAction = null;
    if (!cursor) { hits = []; page = null; selected.clear(); searched = false; }
    redraw();
    try {
      const result = await request('source.search', { query: requestedQuery, language, ...(cursor === undefined ? {} : { cursor }), operationId: id });
      if (!result.ok) { error = result.error; retryAction = result.error.code === 'CANCELLED' ? null : 'search'; return; }
      page = result.value; hits = [...new Map([...hits, ...page.hits].map(hit => [hit.identity.externalId, hit])).values()]; searched = true;
    } catch (cause) { showFailure(cause, 'search'); }
    finally { if (active?.id === id) { active = null; progress = null; cancelling = false; redraw(); } }
  }
  async function collect(resume?: SourceJob) {
    if (active) return;
    const entityIds = resume ? resume.receipt.requested.map(record => record.externalId) : [...selected];
    if (!entityIds.length) return;
    const id = operationId(), epoch = viewEpoch; active = { id, kind: 'collect' }; progress = null; cancelling = false; error = null; retryAction = null; redraw();
    try {
      const result = await request('source.collect', { entityIds, operationId: id, ...(resume ? { resumeJobId: resume.id } : {}) });
      if (!result.ok) { error = result.error; return; }
      const job = result.value; jobs = [job, ...jobs.filter(entry => entry.id !== job.id)];
      if (job.materials.some(value => value.kind === 'item')) observed({ type: 'data-acquired', jobId: job.id });
      if (!visible || epoch !== viewEpoch) return;
      jobId = job.id; tab = 'saved'; materialPage = 0; selected.clear();
      detail = null; recordId = null; recordSequence++;
      const first = job.materials.find(record => record.kind === 'item'); if (first) await openRecord(first.identity.externalId);
    } catch (cause) { showFailure(cause); }
    finally { if (active?.id === id) { active = null; progress = null; cancelling = false; redraw(); } }
  }
  async function openRecord(id: string) {
    if (!jobId) return;
    const sequence = ++recordSequence, requestedJob = jobId;
    recordId = id; detail = null; loadingRecord = true; propertyFilter = ''; propertyLimit = 25; rawVisible = false; error = null; retryAction = null; redraw();
    try { const result = await request('source.record', { jobId: requestedJob, externalId: id }); if (sequence === recordSequence && jobId === requestedJob) detail = result; }
    catch (cause) { if (sequence === recordSequence) showFailure(cause, 'record'); }
    finally { if (sequence === recordSequence) { loadingRecord = false; redraw(); } }
  }
  async function open(scope?:KnowledgeQuery) {
    if(!restoredNavigation){restoredNavigation=true;const saved=wikipedia.navigation();if(saved.active){provider='wikipedia';tab=saved.section;}}
    if(scope){tab='collections';wikipedia.activate(false);}
    const epoch = ++viewEpoch; visible = true; recordSequence++; jobsSequence++; loadingRecord = false; loadingJobs = false;
    try { query = storage().getItem('gitworld-source-query') ?? ''; } catch { /* Shared configuration status handles recovery errors. */ }
    if (tab === 'collections') { files.hide();wikipedia.hide();await collections.open(scope); }
    else if(tab==='files') { collections.hide();wikipedia.hide();await files.open(); }
    else if(provider==='wikipedia'){collections.hide();files.hide();await wikipedia.open(tab);}
    else { collections.hide(); files.hide(); wikipedia.hide(); }
    if (!visible || epoch !== viewEpoch) return;
    if(provider==='wikipedia'&&(tab==='search'||tab==='saved'))return;
    if (!unsubscribe) unsubscribe = bridge().onProgress(value => { if (value.operationId === active?.id) { progress = value; updateProgress(); } });
    await loadJobs();
  }
  async function openImports() {
    restoredNavigation=true;tab = 'files';wikipedia.activate(false);collections.hide();wikipedia.hide();recordSequence++;
    await open();
  }
  function hide() { visible = false; viewEpoch++; recordSequence++; jobsSequence++; loadingRecord = false; loadingJobs = false; unsubscribe?.(); unsubscribe = null; collections.hide(); files.hide();wikipedia.hide(); }
  function providerHtml() {return `<div class="source-provider-selector"><label>${wikipediaCopy(options.locale(),'source')}<select data-source-change="provider"><option value="wikidata" ${provider==='wikidata'?'selected':''}>${wikipediaCopy(options.locale(),'wikidata')}</option><option value="wikipedia" ${provider==='wikipedia'?'selected':''}>${wikipediaCopy(options.locale(),'wikipedia')}</option></select></label></div>`;}
  function content() {
    const sourceContent=tab==='search'||tab==='saved'?`<div class="source-provider-pane">${providerHtml()}${provider==='wikipedia'?wikipedia.content():tab==='search'?searchHtml():materialHtml()}</div>`:tab==='files'?files.content():collections.content();
    return `<div class="source-shell"><nav class="source-nav" aria-label="${t('findData')}">${button('close', t('explore'), 'class="source-back source-button"')}${button('tab-search', t('search'), tab === 'search' ? 'aria-current="page"' : '')}${button('tab-saved', t('saved'), tab === 'saved' ? 'aria-current="page"' : '')}${button('tab-collections', collectionCopy(options.locale(), 'datasets'), tab === 'collections' ? 'aria-current="page"' : '')}${button('tab-files',options.locale()==='en'?'Imports and matches':'导入与匹配',tab==='files'?'aria-current="page"':'')}</nav>${sourceContent}</div>`;
  }
  async function click(target: HTMLElement) {
    if(target.dataset.wikipedia||target.dataset.knowledgeFile&&provider==='wikipedia'&&(tab==='search'||tab==='saved')){await wikipedia.click(target);return;}
    if(target.dataset.knowledgeFile){await files.click(target);return;}
    if (target.dataset.collection) { await collections.click(target); return; }
    const action = target.dataset.source;
    if (action === 'close') { hide(); options.onClose(); }
    else if (action === 'tab-search' || action === 'tab-saved' || action === 'tab-collections' || action==='tab-files') {
      const next = action === 'tab-search' ? 'search' : action === 'tab-saved' ? 'saved' : action==='tab-files'?'files':'collections';if(next===tab)return;const epoch=++viewEpoch,interaction=options.navigationVersion?.();
      tab=next;recordSequence++;jobsSequence++;loadingRecord=false;loadingJobs=false;error = null;retryAction = null;
      wikipedia.activate(provider==='wikipedia'&&(next==='search'||next==='saved'),next==='saved'?'saved':'search');
      if(next==='collections'){files.hide();wikipedia.hide();await collections.open();}
      else if(next==='files'){collections.hide();wikipedia.hide();await files.open();}
      else if(provider==='wikipedia'){collections.hide();files.hide();await wikipedia.open(next);}
      else{collections.hide();files.hide();wikipedia.hide();}
      if(visible&&epoch===viewEpoch){if(provider!=='wikipedia'||next==='collections'||next==='files')redraw();if(interaction===options.navigationVersion?.())document.querySelector<HTMLButtonElement>(`[data-source="${action}"]`)?.focus({preventScroll:true});}
    }
    else if (action === 'next-search' && page?.nextCursor) await search(page.nextCursor);
    else if (action === 'retry-search') await search(attemptedCursor);
    else if (action === 'select-page' && !active) { hits.forEach(hit => selected.add(hit.identity.externalId)); redraw(); }
    else if (action === 'clear-selection' && !active) { selected.clear(); redraw(); }
    else if (action === 'collect') await collect();
    else if (action === 'resume' && currentJob()) await collect(currentJob()!);
    else if (action === 'record' && target.dataset.id) await openRecord(target.dataset.id);
    else if (action === 'retry-record' && recordId) await openRecord(recordId);
    else if (action === 'refresh') await loadJobs();
    else if(action==='preview-mapping'&&jobId){mappingBusy=true;error=null;redraw();try{const status=await request('repository.status',{});mappingHead=status.head;mappingPreview=await request('knowledge.previewJob',{jobId});if(mappingPreview.objects)observed({type:'data-previewed',jobId});}catch(cause){showFailure(cause);}finally{mappingBusy=false;redraw();}}
    else if(action==='apply-mapping'&&jobId&&mappingPreview&&mappingHead){const interaction=options.navigationVersion?.(),selectedJob=jobId;mappingBusy=true;error=null;redraw();try{const adopted=await request('knowledge.adoptJob',{jobId,expectedHead:mappingHead,expectedInputHash:mappingPreview.inputHash,review:useInStates?'adopted':'unreviewed',operationId:operationId()});if(adopted.changedObjects.length||adopted.unchangedObjects.length)observed({type:'data-adopted',jobId:selectedJob,paths:adopted.paths??[]});if(jobId===selectedJob)mappingPreview=null;await options.onAdopted?.(adopted,selectedJob,interaction);}catch(cause){showFailure(cause);}finally{mappingBusy=false;redraw();}}
    else if (action === 'previous-materials') { materialPage = Math.max(0, materialPage - 1); redraw(); }
    else if (action === 'next-materials') { materialPage++; redraw(); }
    else if (action === 'more-properties') { propertyLimit += 25; const container = document.querySelector('[data-source-properties]'); if (container) container.innerHTML = propertiesHtml(); }
    else if (action === 'raw') { rawVisible = !rawVisible; redraw(); }
    else if (action === 'cancel' && active) {
      cancelling = true; updateProgress(); target.setAttribute('disabled', '');
      try { await request('operation.cancel', { operationId: active.id }); } catch (cause) { cancelling = false; showFailure(cause); redraw(); }
    }
  }
  async function submit(form: HTMLFormElement) { if(form.dataset.wikipediaForm!==undefined){await wikipedia.submit(form);return;}if (form.hasAttribute('data-collection-form')) { await collections.submit(); return; } if (form.dataset.sourceForm === 'search') { const fields = new FormData(form); query = String(fields.get('query') ?? ''); searchLanguage = fields.get('language') === 'zh' ? 'zh' : 'en'; await search(); } }
  async function change(target: HTMLInputElement | HTMLSelectElement) {
    if(target.dataset.wikipediaChange){wikipedia.change(target as HTMLSelectElement);return;}
    if(target.hasAttribute('data-knowledge-file-review')){files.change(target as HTMLSelectElement);return;}
    if (target.dataset.collectionInput) { collections.change(target as HTMLSelectElement); return; }
    const action = target.dataset.sourceChange;
    if(action==='provider'&&(target.value==='wikidata'||target.value==='wikipedia')){if(provider===target.value)return;provider=target.value;const epoch=++viewEpoch,interaction=options.navigationVersion?.();recordSequence++;jobsSequence++;wikipedia.activate(provider==='wikipedia',tab==='saved'?'saved':'search');if(provider==='wikipedia'&&(tab==='search'||tab==='saved'))await wikipedia.open(tab);else wikipedia.hide();if(visible&&epoch===viewEpoch){if(provider!=='wikipedia')redraw();if(interaction===options.navigationVersion?.())document.querySelector<HTMLSelectElement>('[data-source-change="provider"]')?.focus({preventScroll:true});}}
    else if (action === 'select' && target instanceof HTMLInputElement) {
      if (target.checked) selected.add(target.value); else selected.delete(target.value);
      const count = document.querySelector('[data-source-selected]'); if (count) count.textContent = copy(options.locale(), 'selected', { count: selected.size });
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-source="collect"],[data-source="clear-selection"]')) button.disabled = !!active || !selected.size;
    } else if (action === 'language') searchLanguage = target.value === 'zh' ? 'zh' : 'en';
    else if (action === 'properties' && target instanceof HTMLInputElement) { includeProperties = target.checked; materialPage = 0; redraw(); }
    else if (action === 'job') { jobId = target.value; mappingPreview=null;mappingHead=null;recordId = null; detail = null; recordSequence++; loadingRecord = false; materialPage = 0; error = null; redraw(); }
  }
  function input(target: HTMLInputElement) {
    if(target.dataset.wikipediaInput){wikipedia.input(target);return;}
    if (target.dataset.collectionInput) { collections.input(target); return; }
    if (target.dataset.sourceInput === 'query') { query = target.value; storage().setItem('gitworld-source-query', query); }
    if (target.dataset.sourceInput === 'property-filter') { propertyFilter = target.value; propertyLimit = 25; const container = document.querySelector('[data-source-properties]'); if (container) container.innerHTML = propertiesHtml(); }
  }
  return { open, openImports, content, click, submit, change, input, hide };
}
