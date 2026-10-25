import type { KnowledgeQuery } from '../../../../packages/domain/src/knowledge.ts';
import type { HistoryLocale, HistoryText } from '@gitworld/domain';
import type { CollectionCatalogEntry, CollectionJob, CollectionProvider, CollectionQuery, KnowledgeMappingPreview, OperationProgress, KnowledgeImportResult } from '@gitworld/contracts';
import { bridge, escapeHtml as esc, operationId, request, ServiceFailure } from './client.ts';
import { collectionCopy as copy, collectionIssueText, type CollectionCopyKey } from './collection-copy.ts';
import type { SourceObservation } from './source-observation.ts';
import type { CollectionIssuesPage } from '../../../../packages/contracts/src/collection-types.ts';

export function parseCollectionQuery(provider: CollectionProvider, values: { text: string; from: string; to: string; limit: string }): CollectionQuery | null {
  if (!/^\d+$/.test(values.limit) || Number(values.limit) < 1 || Number(values.limit) > 10_000) return null;
  const result: CollectionQuery = { limit: Number(values.limit), startRecord: 0, ...(values.text.trim() ? { text: values.text.trim() } : {}) };
  if (provider === 'cliopatria' && (values.from.trim() || values.to.trim())) {
    if (![values.from, values.to].every(value => /^-?[1-9]\d*$/.test(value.trim()) && Number.isSafeInteger(Number(value))) || Number(values.from) > Number(values.to)) return null;
    result.years = [Number(values.from), Number(values.to)];
  }
  return result;
}

type Options = { locale: () => HistoryLocale; render: () => void; navigationVersion?:()=>number; onAdopted?: (result:KnowledgeImportResult,jobId:string,interaction?:number) => void | Promise<void>; onObserved?: (event: SourceObservation) => void };
export function createCollectionBrowser(options: Options) {
  let visible = false, loading = false, catalog: CollectionCatalogEntry[] = [], jobs: CollectionJob[] = [], selected: string | null = null;
  let provider: CollectionProvider = 'cliopatria', text = '', from = '', to = '', limit = '1000';
  let active: string | null = null, cancelling = false, progress: OperationProgress | null = null, unsubscribe: (() => void) | null = null;
  let preview: KnowledgeMappingPreview | null = null, previewHead: string | null = null, previewing = false, adopting = false, review = false, sequence = 0;
  let error: string | null = null, adoptedMessage: { changed: number; unchanged: number; conflicts: number } | null = null;
  let issuePage: CollectionIssuesPage | null = null, issuesOpen = false, issuesLoading = false, issuesError: string | null = null, issueSequence = 0, requestedOffset = 0, rebuilding = false;
  const t = (key: Exclude<CollectionCopyKey, 'download' | 'bytes' | 'records' | 'usable' | 'scope' | 'adoptedResult' | 'issuesRange' | 'issuesTotal' | 'legacyIssues' | 'aggregateExclusions'>) => copy(options.locale(), key);
  const localized = (value: HistoryText) => value[options.locale()] ?? value.en;
  const format = (value: number) => new Intl.NumberFormat(options.locale()).format(value);
  const size = (value: number) => new Intl.NumberFormat(options.locale(), { maximumFractionDigits: 1 }).format(value / 1_000_000);
  const button = (action: string, label: string, extra = '', primary = false) => `<button type="button" class="source-button${primary ? ' primary' : ''}" data-collection="${action}" ${extra}>${esc(label)}</button>`;
  const redraw = () => { if (visible) options.render(); };
  const chosen = () => jobs.find(value => value.id === selected) ?? null;
  const observed = (event: SourceObservation) => { try { options.onObserved?.(event); } catch { /* Observers cannot invalidate saved source data. */ } };
  const code = (cause: unknown) => cause instanceof ServiceFailure ? cause.detail.code : 'IO_ERROR';
  function errorHtml() {
    if (!error) return '';
    const message = error === 'INVALID_REQUEST' ? 'invalid' : error === 'RATE_LIMITED' ? 'rate' : error === 'NETWORK_FAILED' || error === 'HTTP_ERROR' ? 'network' : error === 'HEAD_CHANGED' || error === 'CONTENT_CHANGED' || error === 'CONFLICT' ? 'changed' : error === 'REVIEW_REQUIRED' ? 'conflict' : 'error';
    return `<div class="source-notice error" role="alert"><p>${t(message)}</p><details><summary>${t('details')}</summary><code>${esc(error)}</code></details></div>`;
  }
  function progressText() {
    return cancelling ? t('cancelling') : rebuilding ? t('rebuildingIssues') : progress?.stage === 'normalizing' ? t('reading') : progress?.total ? copy(options.locale(), 'bytes', { completed: size(progress.completed ?? 0), total: size(progress.total) }) : t('acquiring');
  }
  function renderProgress() {
    const element = document.querySelector('[data-collection-progress]'); if (element) element.textContent = progressText();
    const bar = document.querySelector<HTMLProgressElement>('[data-collection-progress-bar]');
    if (bar && progress?.stage === 'acquiring' && progress.total) { bar.max = progress.total; bar.value = progress.completed ?? 0; } else bar?.removeAttribute('value');
  }
  async function loadJobs() { jobs = await request('collection.jobs', {}); }
  async function open(scope?:KnowledgeQuery) {
    if(scope&&!active){provider='cliopatria';text=scope.text??'';[from,to]=scope.time?.map(String)??['',''];}
    visible = true; loading = true; error = null; redraw();
    if (!unsubscribe) unsubscribe = bridge().onProgress(value => { if (value.operationId === active) { progress = value; renderProgress(); } });
    try { const [available, acquired] = await Promise.all([request('collection.catalog', {}), request('collection.jobs', {})]); catalog = available; jobs = acquired; }
    catch (cause) { error = code(cause); }
    finally { loading = false; redraw(); }
  }
  async function selectJob(job: CollectionJob) {
    const current = ++sequence; selected = job.id; preview = null; previewHead = null; review = false; adoptedMessage = null; error = null;
    issueSequence++; issuePage = null; issuesOpen = false; issuesLoading = false; issuesError = null; requestedOffset = 0;
    if (job.status !== 'complete') { error = job.failure?.code ?? null; redraw(); return; }
    previewing = true; redraw();
    try {
      const [mapped, status] = await Promise.all([request('collection.preview', { jobId: job.id }), request('repository.status', {})]);
      if (current !== sequence) return;
      preview = mapped; previewHead = status.head;
      if (mapped.objects) observed({ type: 'data-previewed', jobId: job.id });
    } catch (cause) { if (current === sequence) error = code(cause); }
    finally { if (current === sequence) { previewing = false; redraw(); } }
  }
  async function acquire(query: CollectionQuery, source: CollectionProvider = provider, resumeJobId?: string) {
    if (active) return;
    const id = operationId(); active = id; cancelling = false; progress = null; error = null; redraw();
    try {
      const job = await request('collection.acquire', { provider: source, query, operationId: id, ...(resumeJobId ? { resumeJobId } : {}) });
      jobs = [job, ...jobs.filter(value => value.id !== job.id)]; selected = job.id;
      if (job.status === 'complete' && job.records > 0) observed({ type: 'data-acquired', jobId: job.id });
      await selectJob(job);
    } catch (cause) { error = code(cause); }
    finally { active = null; cancelling = false; progress = null; redraw(); }
  }
  function issuesHtml(job: CollectionJob) {
    if (!job.issueCount && !issuePage) return '';
    const page = issuePage;
    return `<section class="collection-issues" data-collection-issues="${esc(job.id)}"><div class="collection-issues-heading">${button('issues-toggle', t('issues'), `aria-expanded="${issuesOpen}" aria-controls="collection-issues-body"`)}<span>${esc(copy(options.locale(), 'issuesTotal', { count: job.issueCount }))}</span></div>${issuesOpen ? `<div class="collection-issues-body" id="collection-issues-body">${issuesError ? `<div class="source-notice error" role="alert"><p>${t(issuesError === 'CONTENT_CHANGED' ? 'issuesChanged' : issuesError === 'NOT_FOUND' ? 'issuesUnavailable' : issuesError === 'CANCELLED' ? 'issuesCancelled' : 'issuesFailed')}</p><details><summary>${t('details')}</summary><code>${esc(issuesError)}</code></details>${button('issues-retry', t('retryIssues'), issuesLoading || active ? 'disabled' : '')}</div>` : ''}${rebuilding ? `<div class="collection-report-progress" role="status"><span data-collection-progress>${esc(progressText())}</span>${button('cancel', t('cancelIssues'), cancelling ? 'disabled' : '')}</div>` : ''}${issuesLoading ? `<p role="status" class="source-muted">${t('loadingIssues')}</p>` : ''}${page ? `<p class="source-muted">${t('issueCountMeaning')}</p>${page.coverage === 'legacy-partial' ? `<div class="source-notice"><p>${esc(copy(options.locale(), 'legacyIssues', { retained: page.total, total: page.reportedCount, missing: Math.max(0, page.reportedCount - page.total) }))}</p>${page.canRebuild ? `${button('issues-rebuild', t('rebuildIssues'), active ? 'disabled' : '')}<p class="source-muted">${t('rebuildNote')}</p>` : `<p class="source-muted">${t('noRebuildCache')}</p>`}</div>` : ''}${page.aggregates.map(value => `<div class="collection-aggregate"><p>${esc(copy(options.locale(), 'aggregateExclusions', { count: value.count, from: value.afterRecord + 1, to: value.throughRecord }))}</p><p class="source-muted">${t('aggregateNoDetails')}</p></div>`).join('')}${page.total ? `<div class="collection-issue-pagination"><span tabindex="-1" data-collection-issues-range>${esc(copy(options.locale(), 'issuesRange', { from: page.offset + 1, to: Math.min(page.total, page.offset + page.items.length), total: page.total, page: Math.floor(page.offset / page.limit) + 1, pages: Math.ceil(page.total / page.limit) }))}</span><div>${button('issues-previous', t('previousIssues'), issuesLoading || rebuilding || page.offset === 0 ? 'disabled' : '')}${button('issues-next', t('nextIssues'), issuesLoading || rebuilding || page.offset + page.limit >= page.total ? 'disabled' : '')}</div></div><ol class="collection-issue-list" start="${page.offset + 1}">${page.items.map(issue => `<li><p>${esc(collectionIssueText(options.locale(), issue.code))}</p><small>${t('issueLocator')} <code>${esc(issue.locator)}</code></small><details><summary>${t('details')}</summary><code>${esc(issue.code)}</code>${issue.details ? `<p><code>${esc(issue.details)}</code></p>` : ''}</details></li>`).join('')}</ol>` : `<p class="source-muted">${t('noDetailedIssues')}</p>`}` : ''}</div>` : ''}</section>`;
  }
  function redrawIssues() {
    if (!visible) return;
    const job = chosen(), element = document.querySelector<HTMLElement>('[data-collection-issues]');
    if (!job || !element || element.dataset.collectionIssues !== job.id) { redraw(); return; }
    const activeElement = document.activeElement as HTMLElement | null, inside = element.contains(activeElement), action = inside ? activeElement?.dataset.collection : null, rangeFocused = inside && activeElement?.matches('[data-collection-issues-range]');
    element.outerHTML = issuesHtml(job);
    if (action) {
      const replacement = document.querySelector<HTMLButtonElement>(`[data-collection="${action}"]`);
      if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('[data-collection-issues-range]')?.focus({ preventScroll: true });
    } else if (rangeFocused) document.querySelector<HTMLElement>('[data-collection-issues-range]')?.focus({ preventScroll: true });
  }
  function redrawReportContext() {
    const content = document.querySelector<HTMLElement>('.collection-content'), scroll = content?.scrollTop;
    const ownedFocus = document.querySelector<HTMLElement>('[data-collection-issues]')?.contains(document.activeElement);
    redraw();
    if (scroll !== undefined) { const next = document.querySelector<HTMLElement>('.collection-content'); if (next) next.scrollTop = scroll; }
    if (ownedFocus) document.querySelector<HTMLElement>(rebuilding ? '[data-collection="cancel"]' : '[data-collection-issues-range]')?.focus({ preventScroll: true });
  }
  async function loadIssues(offset = 0) {
    const job = chosen(); if (!job) return;
    const current = ++issueSequence; requestedOffset = offset; issuesLoading = true; issuesError = null; redrawIssues();
    try { const value = await request('collection.issues', { jobId: job.id, offset, limit: 40 }); if (current === issueSequence && selected === job.id) issuePage = value; }
    catch (cause) { if (current === issueSequence && selected === job.id) issuesError = code(cause); }
    finally { if (current === issueSequence && selected === job.id) { issuesLoading = false; redrawIssues(); } }
  }
  async function rebuildIssues() {
    const job = chosen(); if (!job || active) return;
    const current = ++issueSequence, id = operationId(); active = id; rebuilding = true; issuesError = null; progress = null; cancelling = false; redrawReportContext();
    try {
      const value = await request('collection.rebuildIssues', { jobId: job.id, operationId: id });
      await loadJobs();
      if (current === issueSequence && selected === job.id) { issuePage = value; requestedOffset = value.offset; }
    } catch (cause) { if (current === issueSequence && selected === job.id) issuesError = code(cause); }
    finally { active = null; rebuilding = false; cancelling = false; progress = null; redrawReportContext(); }
  }
  function content() {
    const source = catalog.find(value => value.id === provider), job = chosen();
    return `<section class="source-content collection-content"><h1>${t('title')}</h1>${loading ? `<p role="status">${t('loading')}</p>` : ''}<form class="collection-form" data-collection-form novalidate><label>${t('provider')}<select data-collection-input="provider" ${active ? 'disabled' : ''}>${catalog.map(value => `<option value="${value.id}" ${provider === value.id ? 'selected' : ''}>${esc(localized(value.title))}</option>`).join('')}</select></label>${source ? `<p class="source-muted">${esc(localized(source.description))}</p><p class="collection-download">${esc(copy(options.locale(), 'download', { size: size(source.downloadBytes), license: source.licenseId, revision: source.revision }))}</p>` : ''}<div class="collection-query"><label>${t('text')}<input data-collection-input="text" value="${esc(text)}" maxlength="200" ${active ? 'disabled' : ''}></label>${provider === 'cliopatria' ? `<label>${t('from')}<input type="number" data-collection-input="from" value="${esc(from)}" ${active ? 'disabled' : ''}></label><label>${t('to')}<input type="number" data-collection-input="to" value="${esc(to)}" ${active ? 'disabled' : ''}></label>` : ''}<label>${t('batch')}<input type="number" min="1" max="10000" data-collection-input="limit" value="${esc(limit)}" ${active ? 'disabled' : ''}></label><button class="source-button primary" type="submit" ${active || !source ? 'disabled' : ''}>${t('acquire')}</button></div><p class="source-muted">${t('coverage')}</p>${source ? `<p class="source-notice">${esc(localized(source.limitations))}</p>` : ''}</form>${errorHtml()}${active && !rebuilding ? `<div class="source-notice source-progress" role="status"><span data-collection-progress>${esc(progressText())}</span><progress data-collection-progress-bar></progress>${button('cancel', t(rebuilding ? 'cancelIssues' : 'cancel'), cancelling ? 'disabled' : '')}</div>` : ''}<div class="source-toolbar"><h2>${t('jobs')}</h2><span class="source-spacer"></span>${button('refresh', t('refresh'), active ? 'disabled' : '')}</div><div class="collection-layout"><aside class="collection-jobs">${jobs.length ? jobs.map(value => `<button type="button" class="source-material" data-collection="job" data-id="${value.id}" ${value.id === selected ? 'aria-current="true"' : ''}><strong>${esc(localized(catalog.find(item => item.id === value.provider)?.title ?? { en: value.provider }))}</strong><small>${t(value.status)} · ${format(value.records)}</small><small>${esc(value.query.text ?? '')}${value.query.years ? ` · ${value.query.years.join('–')}` : ''}</small></button>`).join('') : `<p class="source-empty">${t('noJobs')}</p>`}</aside><section class="collection-preview">${job ? `<h2>${t(job.status)}</h2><p>${esc(copy(options.locale(), 'records', { records: job.records, objects: job.objects, assertions: job.assertions }))}</p><p>${esc(copy(options.locale(), 'usable', { dated: job.datedAssertions, located: job.locatedObjects }))}</p>${job.source ? `<details><summary>${t('sourceRevision')}</summary><p>${esc(job.source.revision)}</p><code>${esc(job.source.contentHash)}</code><p><a href="${esc(job.source.url)}">${esc(job.source.url)}</a></p></details>` : ''}<p class="source-muted">${esc(copy(options.locale(), 'scope', { scanned: job.scanned, next: job.nextRecord ?? (job.status === 'complete' ? t('noNext') : '—') }))}</p>${job.truncated ? `<p class="source-notice">${t('truncated')}</p>` : ''}<div class="source-toolbar">${job.status !== 'complete' ? button('retry', t('retry'), active ? 'disabled' : '') : button('preview', t('preview'), previewing || active ? 'disabled' : '')}${job.nextRecord !== null ? button('next', t('next'), active ? 'disabled' : '') : ''}</div>${previewing ? `<p role="status">${t('previewing')}</p>` : preview ? `<p class="source-muted">${t('originalLanguage')}</p><h3>${t('sample')}</h3><ul>${preview.sample.map(value => `<li>${esc(value.labels[options.locale()] ?? value.labels.en ?? value.id)}</li>`).join('')}</ul>${issuesHtml(job)}${!preview.objects ? `<p class="source-empty">${t('empty')}</p>` : `<label class="collection-review">${t('review')}<select data-collection-input="review" ${adopting ? 'disabled' : ''}><option value="unreviewed" ${!review ? 'selected' : ''}>${t('unreviewed')}</option><option value="adopted" ${review ? 'selected' : ''}>${t('adopted')}</option></select></label><p class="source-muted">${t('reviewNote')}</p>${button('adopt', t(adopting ? 'adopting' : 'adopt'), adopting || active ? 'disabled' : '', true)}`}` : ''}${!preview && !previewing ? issuesHtml(job) : ''}${adoptedMessage ? `<p class="source-notice" role="status">${esc(copy(options.locale(), 'adoptedResult', adoptedMessage))}</p>` : ''}` : ''}</section></div></section>`;
  }
  async function click(target: HTMLElement) {
    const action = target.dataset.collection, job = chosen();
    if (action === 'job') { const value = jobs.find(value => value.id === target.dataset.id); if (value) await selectJob(value); }
    else if (action === 'refresh') { try { await loadJobs(); } catch (cause) { error = code(cause); } redraw(); }
    else if (action === 'preview' && job) await selectJob(job);
    else if (action === 'issues-toggle') { issuesOpen = !issuesOpen; redrawIssues(); if (issuesOpen && !issuePage && !issuesLoading) await loadIssues(); }
    else if (action === 'issues-next' && !rebuilding && issuePage && issuePage.offset + issuePage.limit < issuePage.total) await loadIssues(issuePage.offset + issuePage.limit);
    else if (action === 'issues-previous' && !rebuilding && issuePage) await loadIssues(Math.max(0, issuePage.offset - issuePage.limit));
    else if (action === 'issues-retry') await loadIssues(requestedOffset);
    else if (action === 'issues-rebuild') await rebuildIssues();
    else if (action === 'retry' && job) await acquire(job.query, job.provider, job.id);
    else if (action === 'next' && job && job.nextRecord !== null) await acquire({ ...job.query, startRecord: job.nextRecord }, job.provider);
    else if (action === 'cancel' && active) { cancelling = true; renderProgress(); try { await request('operation.cancel', { operationId: active }); } catch (cause) { error = code(cause); redraw(); } }
    else if (action === 'adopt' && job && preview && previewHead) {
      const interaction=options.navigationVersion?.(),selectedJob=job.id;
      adopting = true; error = null; redraw();
      try { const result = await request('collection.adopt', { jobId: job.id, expectedHead: previewHead, expectedInputHash: preview.inputHash, review: review ? 'adopted' : 'unreviewed', operationId: operationId() }); if(selected===selectedJob)adoptedMessage = { changed: result.changedObjects.length, unchanged: result.unchangedObjects.length, conflicts: result.conflicts.length }; if (result.changedObjects.length || result.unchangedObjects.length) observed({ type: 'data-adopted', jobId: job.id, paths: result.paths ?? [] }); await options.onAdopted?.(result,job.id,interaction); }
      catch (cause) { if(selected===selectedJob)error = code(cause); }
      finally { adopting = false; redraw(); }
    }
  }
  async function submit() { const query = parseCollectionQuery(provider, { text, from, to, limit }); if (!query) { error = 'INVALID_REQUEST'; redraw(); return; } await acquire(query); }
  function input(target: HTMLInputElement) { const key = target.dataset.collectionInput; if (key === 'text') text = target.value; else if (key === 'from') from = target.value; else if (key === 'to') to = target.value; else if (key === 'limit') limit = target.value; }
  function change(target: HTMLSelectElement) { if (target.dataset.collectionInput === 'provider' && ['cliopatria', 'pleiades'].includes(target.value)) { provider = target.value as CollectionProvider; error = null; redraw(); } else if (target.dataset.collectionInput === 'review') review = target.value === 'adopted'; }
  return { open, content, click, submit, input, change, hide: () => { visible = false; issueSequence++; issuesLoading = false; issuePage = null; issuesOpen = false; issuesError = null; } };
}
