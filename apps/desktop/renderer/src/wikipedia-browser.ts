import type { HistoryLocale } from '@gitworld/domain';
import type { KnowledgeImportResult, OperationProgress, ServiceMethods } from '@gitworld/contracts';
import type { WikipediaJob, WikipediaInspection, WikipediaMappingPreview, WikipediaTableInspection, WikipediaIssuesPage } from '../../../../packages/contracts/src/wikipedia-types.ts';
import type { KnowledgePendingImport } from '../../../../packages/contracts/src/knowledge-import-types.ts';
import type { KnowledgeAssertion, KnowledgeTime, KnowledgeValue } from '../../../../packages/domain/src/knowledge.ts';
import { canonicalJson } from '../../../../packages/domain/src/canonical.ts';
import { validWikipediaTitle } from '../../../../packages/contracts/src/wikipedia-validation.ts';
import { bridge, request, operationId, escapeHtml as esc, ServiceFailure } from './client.ts';
import { knowledgeDisplayCopy, knowledgeLocalizedText, knowledgeMetadataLabel, knowledgeTimeLabel } from './knowledge-labels.ts';
import { knowledgeSourceName } from './knowledge-sources.ts';
import { initialVocabularyReview, vocabularyReviewHtml, vocabularyConflictHtml } from './knowledge-file-vocabulary.ts';
import { wikipediaCopy as copy, type WikipediaPlainKey, type WikipediaCopyKey } from './wikipedia-copy.ts';
import { blankWikipediaInput, blankWikipediaTable, parseWikipediaInput, wikipediaSelection, wikipediaSampleColumns, type WikipediaSection, type WikipediaJobDraft, type WikipediaTableDraft } from './wikipedia-form.ts';
import { preparedInputHash, type SourceObservation } from './source-observation.ts';
import { formatHistoricalDate, historicalDateRawTexts } from './historical-date.ts';

export type WikipediaBrowserApi = {
  collect(params: ServiceMethods['wikipedia.collect']['params']): Promise<WikipediaJob>;
  jobs(params: ServiceMethods['wikipedia.jobs']['params']): Promise<ServiceMethods['wikipedia.jobs']['result']>;
  inspect(params: ServiceMethods['wikipedia.inspect']['params']): Promise<WikipediaInspection>;
  preview(params: ServiceMethods['wikipedia.preview']['params']): Promise<WikipediaMappingPreview>;
  issues(params: ServiceMethods['wikipedia.issues']['params']): Promise<WikipediaIssuesPage>;
  adopt(params: ServiceMethods['wikipedia.adopt']['params']): Promise<KnowledgeImportResult>;
  pending(): Promise<KnowledgePendingImport[]>;
  resume(params: ServiceMethods['knowledge.resumeImport']['params']): Promise<KnowledgeImportResult>;
  status(): Promise<ServiceMethods['repository.status']['result']>;
  cancel(id: string): Promise<unknown>;
};
type Options = { locale: () => HistoryLocale; render: () => void; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; api?: WikipediaBrowserApi; navigationVersion?: () => number; subscribeProgress?: (listener: (event: OperationProgress) => void) => () => void; onSection: (section: WikipediaSection) => void; onResumeImport?: () => void | Promise<unknown>; onAdopted?: (result: KnowledgeImportResult, jobId: string, interaction?: number) => void | Promise<void>; onObserved?: (event: SourceObservation) => void };
const defaultApi: WikipediaBrowserApi = { collect: params => request('wikipedia.collect', params), jobs: params => request('wikipedia.jobs', params), inspect: params => request('wikipedia.inspect', params), preview: params => request('wikipedia.preview', params), issues: params => request('wikipedia.issues', params), adopt: params => request('wikipedia.adopt', params), pending: () => request('knowledge.pendingImports', {}), resume: params => request('knowledge.resumeImport', params), status: () => request('repository.status', {}), cancel: id => request('operation.cancel', { operationId: id }) };
const KEY = 'gitworld-wikipedia-input-v1', JOB_PAGE = 20, TABLE_PAGE = 10, SAMPLE_PAGE = 5, ISSUE_PAGE = 10;
const issueKeys = new Set<WikipediaCopyKey>(['OPEN_END', 'UNPARSED_TIME', 'UNCERTAIN_TIME', 'PROVISIONAL_HOLDER', 'SOURCE_CHRONOLOGY_WARNING', 'UNRESOLVED_VALUE', 'UNSUPPORTED_HEADERS']);

export function createWikipediaBrowser(options: Options) {
  const api = options.api ?? defaultApi, storage = () => options.storage ?? localStorage;
  let input = blankWikipediaInput(), loaded = false, visible = false, section: WikipediaSection = 'search', draftFailed = false;
  let viewSequence = 0, jobsSequence = 0, inspectSequence = 0, previewSequence = 0, pendingSequence = 0;
  let jobs: ServiceMethods['wikipedia.jobs']['result'] = { jobs: [], total: 0, issues: [] }, jobsOffset = 0, loadingJobs = false;
  let job: WikipediaJob | null = null, inspection: WikipediaInspection | null = null, tableCache = new Map<number, WikipediaTableInspection>(), inspecting = false, preparing = false, stale = false;
  let mapping: WikipediaMappingPreview | null = null, review: 'unreviewed' | 'adopted' = 'unreviewed', vocabulary = initialVocabularyReview(), claimsPage = 0, issuesPage = 0;
  let issuesSequence = 0, issuesReading = false, issuesError: { page: number; code: string } | null = null, issueReportHash: string | null = null;
  const issuePages = new Map<number, WikipediaIssuesPage['issues']>();
  let pending: KnowledgePendingImport[] = [], pendingKnown = false, pendingFailed = false, adopted: { result: KnowledgeImportResult; jobId: string } | null = null;
  let attempt: { operationId: string; previewId: string; jobId: string } | null = null, active: { id: string; kind: 'collect' | 'adopt' } | null = null, progress: OperationProgress | null = null, cancelling = false;
  let error: { code: string; reason?: string } | null = null, retry: (() => Promise<unknown>) | null = null, vocabularyConflicts: NonNullable<ServiceFailure['detail']['vocabularyConflicts']> = [];
  let unsubscribe: (() => void) | null = null, togglesBound = false;
  const t = (key: WikipediaPlainKey) => copy(options.locale(), key), number = (value: number) => new Intl.NumberFormat(options.locale()).format(value);
  const button = (action: string, label: string, extra = '', primary = false) => `<button type="button" class="source-button${primary ? ' primary' : ''}" data-wikipedia="${action}" ${extra}>${esc(label)}</button>`;
  const heldOperations = new Set<string>();
  const legacyMergeReason = (reason?: string) => reason === 'legacy-import-merge-review-required' || reason === 'legacy-import-merge-unverifiable';
  const legacyHeld = () => pending.some(value => heldOperations.has(value.operationId)) || !!attempt && heldOperations.has(attempt.operationId);
  const busy = () => !!active || preparing;
  const blocked = () => !pendingKnown || !!pending.length || !!attempt;
  const draft = () => input.jobs.find(value => value.jobId === input.jobId) ?? null;
  function loadInput() { if (loaded) return; loaded = true; try { input = parseWikipediaInput(storage().getItem(KEY)) ?? blankWikipediaInput(); } catch { draftFailed = true; } }
  function cache() { try { storage().setItem(KEY, JSON.stringify(input)); draftFailed = false; return true; } catch { draftFailed = true; return false; } }
  function observe(event: SourceObservation) { try { options.onObserved?.(event); } catch { /* Observers cannot change acquisition or adoption results. */ } }
  function local(labels: Record<string, string> | undefined, fallback: string): string { const value = knowledgeLocalizedText(labels, options.locale(), fallback); return `${esc(value.text)}${options.locale() === 'zh-CN' && value.language === 'en' ? '<small class="source-language">EN</small>' : ''}`; }
  function link(url: string | undefined, title: string) { try { if (url && new URL(url).protocol === 'https:') return `<a href="${esc(url)}">${esc(title)}</a>`; } catch { /* Invalid source URLs remain plain text. */ } return esc(title); }
  function rememberDisclosures() {
    const current = draft();
    for (const element of document.querySelectorAll<HTMLDetailsElement>('.wikipedia-content [data-wikipedia-sample]')) { const table = current?.tables.find(value => value.index === Number(element.dataset.wikipediaSample)); if (table && current?.jobId === element.dataset.job && current?.sourceHash === element.dataset.sourceHash) table.sampleOpen = element.open; }
    const tableList = document.querySelector<HTMLDetailsElement>('[data-wikipedia-tables]'); if (current && tableList?.dataset.job === current.jobId) current.tablesOpen = tableList.open;
    for (const element of document.querySelectorAll<HTMLDetailsElement>('.wikipedia-content [data-file-disclosure]')) { const key = element.dataset.fileDisclosure; if (['catalogOpen', 'originOpen', 'missingOpen', 'conflictsOpen'].includes(key ?? '')) vocabulary[key as 'catalogOpen' | 'originOpen' | 'missingOpen' | 'conflictsOpen'] = element.open; }
  }
  function redraw(preserve = true) {
    if (!visible) return;
    const root = document.querySelector<HTMLElement>('.wikipedia-content'), element = document.activeElement as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null;
    const attributes = preserve && root && element && root.contains(element) ? [...element.attributes].filter(value => value.name.startsWith('data-')).map(value => [value.name, value.value]) : [];
    const selection = element && 'selectionStart' in element ? [element.selectionStart, element.selectionEnd] : null, scroll = preserve ? root?.scrollTop ?? 0 : 0;
    rememberDisclosures(); options.render(); const nextRoot = document.querySelector<HTMLElement>('.wikipedia-content'); if (nextRoot) nextRoot.scrollTop = scroll;
    if (attributes.length && nextRoot) { const next = [...nextRoot.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')].find(value => !value.disabled && attributes.every(([key, text]) => value.getAttribute(key) === text)); next?.focus({ preventScroll: true }); if (!next && ['issues-next', 'issues-previous', 'issues-retry'].includes(element?.dataset.wikipedia ?? '')) nextRoot.querySelector<HTMLButtonElement>('.wikipedia-issues .source-pagination button:not(:disabled)')?.focus({ preventScroll: true }); if (selection && next instanceof HTMLInputElement && selection[0] !== null) { try { next.setSelectionRange(selection[0], selection[1]); } catch { /* Number inputs do not support text selection. */ } } }
  }
  function toggle(event: Event) { const element = event.target as HTMLElement; if (!visible || !element.closest?.('.wikipedia-content')) return; rememberDisclosures(); cache(); }
  function subscribe() {
    unsubscribe?.(); unsubscribe = null;
    if (!visible || !active) return;
    const listen = options.subscribeProgress ?? (!options.api ? (listener: (value: OperationProgress) => void) => bridge().onProgress(listener) : null);
    unsubscribe = listen?.(value => { if (value.operationId !== active?.id) return; progress = value; const node = document.querySelector('[data-wikipedia-progress]'); if (node) node.textContent = progressText(); }) ?? null;
  }
  function fail(cause: unknown, repeat?: () => Promise<unknown>) { error = cause instanceof ServiceFailure ? { code: cause.detail.code, ...(typeof cause.detail.parameters?.reason === 'string' ? { reason: cause.detail.parameters.reason } : {}) } : { code: typeof cause === 'string' ? cause : 'SERVICE_UNAVAILABLE' }; vocabularyConflicts = cause instanceof ServiceFailure ? cause.detail.vocabularyConflicts ?? [] : []; retry = repeat ?? null; }
  function focusError() { const node = document.querySelector<HTMLElement>('.wikipedia-error[role="alert"]'); node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: 'nearest' }); }
  function clearError() { error = null; retry = null; vocabularyConflicts = []; }
  function resetIssues(value?: WikipediaMappingPreview) {
    issuesSequence++; issuesPage = 0; issuesReading = false; issuesError = null; issueReportHash = null; issuePages.clear();
    if (value) for (let offset = 0; offset < value.exceptions.length; offset += ISSUE_PAGE) { const page = value.exceptions.slice(offset, offset + ISSUE_PAGE); if (page.length === Math.min(ISSUE_PAGE, value.exceptionCount - offset)) issuePages.set(offset / ISSUE_PAGE, page); }
  }
  function invalidate() { previewSequence++; mapping = null; adopted = null; claimsPage = 0; resetIssues(); vocabulary = initialVocabularyReview(); }
  async function loadPending() { const sequence = ++pendingSequence; try { const result = await api.pending(); if (sequence === pendingSequence) { pending = result; pendingKnown = true; pendingFailed = false; } } catch { if (sequence === pendingSequence) { pendingKnown = false; pendingFailed = true; } } }
  async function loadJobs() {
    const sequence = ++jobsSequence, offset = jobsOffset; loadingJobs = true; redraw();
    try { const result = await api.jobs({ offset, limit: JOB_PAGE }); if (sequence === jobsSequence) jobs = result; }
    catch (cause) { if (sequence === jobsSequence) fail(cause, loadJobs); }
    finally { if (sequence === jobsSequence) { loadingJobs = false; redraw(); } }
  }
  function ensureDraft(value: WikipediaJob): WikipediaJobDraft | null {
    if (!value.source) return null;
    let current = input.jobs.find(item => item.jobId === value.id);
    if (!current) { current = { jobId: value.id, sourceHash: value.source.contentHash, profileId: '', calendar: 'source-unspecified', offset: 0, tables: [], tablesOpen: true }; input.jobs = [current, ...input.jobs].slice(0, 10); }
    stale = current.sourceHash !== value.source.contentHash; return current;
  }
  async function inspectJob(id: string, offset?: number, keep = false) {
    const sequence = ++inspectSequence, currentView = viewSequence; preparing = false; inspecting = true; clearError();
    if (!keep) { invalidate(); input.jobId = id; job = jobs.jobs.find(value => value.id === id) ?? null; inspection = null; tableCache = new Map(); }
    cache(); redraw(keep);
    if (job?.id === id && !job.source) { inspecting = false; redraw(); return; }
    const pageOffset = offset ?? draft()?.offset ?? 0;
    try {
      const page = await api.inspect({ jobId: id, offset: pageOffset, limit: TABLE_PAGE });
      if (sequence !== inspectSequence || input.jobId !== id) return;
      job = page.job; inspection = page; page.tables.forEach(value => tableCache.set(value.index, value));
      const current = ensureDraft(job); if (current) current.offset = pageOffset;
      if (current && !stale) {
        const offsets = [...new Set(current.tables.filter(value => !tableCache.has(value.index)).map(value => value.offset))];
        const pages = await Promise.allSettled(offsets.map(value => api.inspect({ jobId: id, offset: value, limit: TABLE_PAGE })));
        if (sequence !== inspectSequence || input.jobId !== id) return;
        for (const result of pages) { if (result.status === 'fulfilled' && result.value.job.source?.contentHash === job.source?.contentHash) result.value.tables.forEach(value => tableCache.set(value.index, value)); else stale = true; }
        if (current.tables.some(value => tableCache.get(value.index)?.headerHash !== value.headerHash)) stale = true;
      }
      cache();
    } catch (cause) { if (sequence === inspectSequence) fail(cause, () => inspectJob(id, pageOffset, keep)); }
    finally { if (sequence === inspectSequence) { inspecting = false; redraw(); if (visible && currentView === viewSequence && error) focusError(); } }
  }
  async function acquire(resume?: WikipediaJob) {
    if (busy() || !cache()) { redraw(); return; }
    const title = resume?.requested.title ?? input.title.trim(), revisionText = resume ? resume.requested.revision === undefined ? '' : String(resume.requested.revision) : input.revision.trim();
    if (!validWikipediaTitle(title)) { fail('titleInvalid'); redraw(); focusError(); return; }
    if (revisionText && (!/^\d+$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText)) || Number(revisionText) < 1)) { fail('revisionInvalid'); redraw(); focusError(); return; }
    const sequence = viewSequence, id = operationId(); let openedJob: string | null = null; active = { id, kind: 'collect' }; progress = null; cancelling = false; clearError(); subscribe(); redraw();
    try {
      const value = await api.collect({ title, ...(revisionText ? { revision: Number(revisionText) } : {}), ...(resume ? { resumeJobId: resume.id } : {}), operationId: id });
      jobs = { ...jobs, jobs: [value, ...jobs.jobs.filter(item => item.id !== value.id)].slice(0, JOB_PAGE), total: jobs.jobs.some(item => item.id === value.id) ? jobs.total : jobs.total + 1 };
      if (value.source) observe({ type: 'data-acquired', jobId: value.id });
      if (visible && sequence === viewSequence) { section = 'saved'; input.section = section; input.jobId = value.id; job = value; cache(); options.onSection(section); await inspectJob(value.id); openedJob = value.id; }
    } catch (cause) { if (sequence === viewSequence) fail(cause, () => acquire(resume)); }
    finally { if (active?.id === id) { active = null; cancelling = false; unsubscribe?.(); unsubscribe = null; redraw(); if (visible && sequence === viewSequence) { if (error) focusError(); else if (openedJob === input.jobId) document.querySelector<HTMLElement>('.wikipedia-heading h1')?.focus({ preventScroll: true }); } } }
  }
  async function prepareMapping() {
    if (busy() || !job?.source || !draft() || !cache()) { redraw(); return; }
    const current = draft()!, selected = wikipediaSelection(current, tableCache); if (stale || !selected.ok) { fail(stale ? 'sourceChanged' : selected.ok ? 'sourceChanged' : selected.error); redraw(); focusError(); return; }
    const selectedJob = job, sourceHash = job.source.contentHash, sequence = ++previewSequence, currentView = viewSequence, signature = canonicalJson(selected.selection); let completed = false; preparing = true; clearError(); redraw();
    try {
      const status = await api.status(); if (sequence !== previewSequence || input.jobId !== selectedJob.id) return;
      const result = await api.preview({ jobId: selectedJob.id, sourceHash, expectedHead: status.head, selection: selected.selection });
      const latest = draft() ? wikipediaSelection(draft()!, tableCache) : null;
      if (sequence !== previewSequence || input.jobId !== selectedJob.id || !latest?.ok || canonicalJson(latest.selection) !== signature) return;
      if (result.jobId !== selectedJob.id || result.sourceHash !== sourceHash || canonicalJson(result.selection) !== signature || !preparedInputHash(result.preview) || result.preview.prepared!.baseHead !== status.head) throw new ServiceFailure({ code: 'CONFLICT', parameters: { reason: 'wikipedia-preview-changed' } });
      mapping = result; review = 'unreviewed'; vocabulary = initialVocabularyReview(); claimsPage = 0; resetIssues(result);
      if (result.exceptionCount && !issuePages.has(0)) await readIssues(0);
      if (sequence !== previewSequence || mapping !== result || input.jobId !== selectedJob.id) return;
      completed = true;
      if (result.preview.objects && result.preview.assertions) { const inputHash = preparedInputHash(result.preview); observe({ type: 'data-previewed', jobId: selectedJob.id, ...(inputHash ? { inputHash } : {}) }); }
    } catch (cause) { if (sequence === previewSequence) fail(cause, prepareMapping); }
    finally { if (sequence === previewSequence) { preparing = false; const show = completed && visible && currentView === viewSequence && section === 'saved'; redraw(!show); if (show) document.querySelector<HTMLElement>('.wikipedia-heading h1')?.focus({ preventScroll: true }); else if (visible && currentView === viewSequence && error) focusError(); } }
  }
  async function readIssues(page: number) {
    if (!mapping || issuesReading || page < 0 || page * ISSUE_PAGE >= mapping.exceptionCount) return;
    if (issuePages.has(page)) { issuesPage = page; issuesError = null; redraw(); return; }
    const selected = mapping, sequence = ++issuesSequence, currentView = viewSequence, offset = page * ISSUE_PAGE;
    issuesReading = true; issuesError = null; redraw();
    try {
      const result = await api.issues({ jobId: selected.jobId, previewId: selected.preview.prepared!.id, expectedInputHash: selected.preview.inputHash, offset, limit: ISSUE_PAGE });
      if (sequence !== issuesSequence || mapping !== selected || !visible || currentView !== viewSequence) return;
      if (result.jobId !== selected.jobId || result.previewId !== selected.preview.prepared!.id || result.inputHash !== selected.preview.inputHash || result.total !== selected.exceptionCount || result.offset !== offset || result.limit !== ISSUE_PAGE || !/^[a-f0-9]{64}$/.test(result.reportHash) || issueReportHash !== null && result.reportHash !== issueReportHash || result.issues.length !== Math.min(ISSUE_PAGE, result.total - offset)) throw new ServiceFailure({ code: 'CONFLICT' });
      issueReportHash = result.reportHash; issuePages.set(page, result.issues); if (issuePages.size > 8) issuePages.delete(issuePages.keys().next().value!); issuesPage = page;
    } catch (cause) { if (sequence === issuesSequence && mapping === selected && visible && currentView === viewSequence) issuesError = { page, code: cause instanceof ServiceFailure ? cause.detail.code : 'SERVICE_UNAVAILABLE' }; }
    finally { if (sequence === issuesSequence) { issuesReading = false; redraw(); if (issuesError && ['issues-next', 'issues-previous', 'issues-retry'].includes((document.activeElement as HTMLElement | null)?.dataset.wikipedia ?? '')) document.querySelector<HTMLElement>('.wikipedia-issue-read-error')?.scrollIntoView({ block: 'nearest' }); } }
  }
  async function complete(result: KnowledgeImportResult, selectedJob: string, interaction: number | undefined) {
    attempt = null; if (input.jobId === selectedJob) adopted = { result, jobId: selectedJob };
    await loadPending(); if (result.changedObjects.length || result.unchangedObjects.length) { const inputHash = preparedInputHash(result.preview); observe({ type: 'data-adopted', jobId: selectedJob, paths: result.paths ?? [], ...(inputHash ? { inputHash } : {}) }); }
    if (!result.conflicts.length) { try { await options.onAdopted?.(result, selectedJob, interaction); } catch { if (input.jobId === selectedJob) fail('resultNavigation'); } }
  }
  async function adoptMapping(check = false) {
    if (active || preparing || !mapping && !check || check && attempt && heldOperations.has(attempt.operationId)) return;
    const interaction = options.navigationVersion?.(), selectedJob = check ? attempt?.jobId : mapping?.jobId, sequence = viewSequence, selected = mapping;
    if (!selectedJob) return;
    if (!check) { await loadPending(); if (!visible || sequence !== viewSequence || mapping !== selected || blocked()) { redraw(); return; } }
    const operation = check ? attempt! : { operationId: operationId(), previewId: selected!.preview.prepared!.id, jobId: selectedJob };
    active = { id: operation.operationId, kind: 'adopt' }; attempt = operation; progress = null; clearError(); subscribe(); redraw();
    try { const result = check ? await api.resume({ operationId: operation.operationId, previewId: operation.previewId }) : await api.adopt({ jobId: selectedJob, previewId: operation.previewId, expectedHead: selected!.preview.prepared!.baseHead, expectedInputHash: selected!.preview.inputHash, review, operationId: operation.operationId }); await complete(result, selectedJob, interaction); }
    catch (cause) {
      if (input.jobId === selectedJob) fail(cause);
      if (!check && cause instanceof ServiceFailure && ['wikipedia-profile-version-changed', 'import-preview-merge-version-changed'].includes(String(cause.detail.parameters?.reason))) { attempt = null; mapping = null; if (input.jobId === selectedJob) retry = prepareMapping; }
      if (!check && cause instanceof ServiceFailure && cause.detail.code === 'HEAD_CHANGED' && input.jobId === selectedJob) retry = prepareMapping;
      if (cause instanceof ServiceFailure && (['HEAD_CHANGED', 'NOT_FOUND', 'INVALID_REQUEST'].includes(cause.detail.code) || ['paired-import-pending', 'incomplete-paired-import'].includes(String(cause.detail.parameters?.reason)))) { attempt = null; if (cause.detail.code === 'HEAD_CHANGED' || cause.detail.code === 'NOT_FOUND') mapping = null; }
      if (cause instanceof ServiceFailure && legacyMergeReason(String(cause.detail.parameters?.reason))) { heldOperations.add(operation.operationId); if (input.jobId === selectedJob) mapping = null; }
      await loadPending();
    } finally { if (active?.id === operation.operationId) { active = null; unsubscribe?.(); unsubscribe = null; redraw(); if (visible && sequence === viewSequence && error) focusError(); } }
  }
  function progressText() { return active?.kind === 'collect' ? t(cancelling ? 'cancelling' : 'saving') : progress?.stage === 'writing' && Number.isSafeInteger(progress.completed) && Number.isSafeInteger(progress.total) && progress.total! > 0 ? copy(options.locale(), 'filesProgress', { completed: progress.completed!, total: progress.total! }) : t('working'); }
  function issueMessage(code: string, retryAfterMs?: number) { if (code === 'RATE_LIMITED') return copy(options.locale(), 'rateError', { seconds: Math.max(1, Math.ceil((retryAfterMs ?? 5000) / 1000)) }); const key: Record<string, WikipediaPlainKey> = { NETWORK_FAILED: 'network', HTTP_ERROR: 'network', UPSTREAM_BUSY: 'sourceBusy', INVALID_RESPONSE: 'unreadable', RESPONSE_TOO_LARGE: 'tooLarge', RECORD_MISSING: 'pageMissing', CANCELLED: 'cancelled' }; return t(key[code] ?? 'genericError'); }
  function errorMessage() {
    if (!error) return '';
    const reasons: Record<string, WikipediaPlainKey> = { 'wikipedia-source-incomplete': 'sourceIncomplete', 'wikipedia-source-changed': 'sourceChanged', 'wikipedia-headers-changed': 'sourceChanged', 'wikipedia-preview-changed': 'previewChanged', 'wikipedia-profile-version-changed': 'profileChanged', 'import-preview-merge-version-changed': 'mergePreviewChanged', 'legacy-import-merge-review-required': 'legacyMergeHeld', 'legacy-import-merge-unverifiable': 'legacyMergeHeld', 'wikipedia-invalid-profile': 'profileInvalid', 'wikipedia-table-too-large': 'tooLarge', 'wikipedia-preview-budget': 'previewBudget', 'paired-import-pending': 'pending', 'incomplete-paired-import': 'pending' };
    if (reasons[error.reason ?? '']) return t(reasons[error.reason!]);
    const local = new Set<WikipediaPlainKey>(['profileRequired', 'tableRequired', 'columnsRequired', 'distinctColumns', 'rowInvalid', 'titleInvalid', 'revisionInvalid', 'tableLimit', 'columnLimit', 'sourceChanged', 'resultNavigation']);
    if (local.has(error.code as WikipediaPlainKey)) return t(error.code as WikipediaPlainKey);
    return error.code === 'HEAD_CHANGED' ? t('headChanged') : error.code === 'SERVICE_UNAVAILABLE' ? t('unavailable') : error.code === 'RECORD_MISSING' ? t('pageMissing') : t('genericError');
  }
  function errorHtml() { return `${draftFailed ? `<div class="source-notice error wikipedia-error" role="alert" tabindex="-1">${t('draftFailed')}${button('cache', t('retry'))}</div>` : ''}${error ? `<div class="source-notice error wikipedia-error" role="alert" tabindex="-1"><p>${esc(errorMessage())}</p><details><summary>${t('errorCode')}</summary><code>${esc(error.code)}${error.reason ? ` · ${esc(error.reason)}` : ''}</code></details>${vocabularyConflicts.length ? vocabularyConflictHtml(options.locale(), vocabularyConflicts, vocabularyConflicts.length) : ''}${retry && !legacyHeld() ? button('retry', t(error.code === 'HEAD_CHANGED' || ['wikipedia-profile-version-changed', 'import-preview-merge-version-changed'].includes(error.reason ?? '') ? 'preview' : 'retry'), busy() ? 'disabled' : '') : ''}</div>` : ''}`; }
  function progressHtml() { return active ? `<div class="source-notice source-progress" role="status"><span data-wikipedia-progress>${esc(progressText())}</span>${active.kind === 'collect' ? button('cancel', t(cancelling ? 'cancelling' : 'cancel'), cancelling ? 'disabled' : '') : ''}</div>` : ''; }
  function pendingHtml() {
    const held = legacyHeld(), notice = held ? legacyMergeReason(error?.reason) ? '' : `<p>${t('legacyMergeHeld')}</p>` : `<p>${t(pending.length ? 'pending' : 'uncertain')}</p>`;
    return `${pendingFailed ? `<div class="source-notice error"><p>${t('pendingFailed')}</p>${button('pending', t('retry'), active ? 'disabled' : '')}</div>` : ''}${pending.length || attempt ? `<div class="source-notice">${notice}${options.onResumeImport && pending.length ? button('imports', t('openImports')) : attempt && !held ? button('check-result', t('checkResult'), active ? 'disabled' : '') : ''}</div>` : ''}`;
  }
  function sourceHtml() {
    if (!job?.source) return '';
    const value = job.source, rights = value.rights;
    return `<section class="wikipedia-source"><div class="wikipedia-source-title">${esc(value.title)}${options.locale() === 'zh-CN' ? '<small class="source-language">EN</small>' : ''}</div><p>${link(value.url, `${t('sourceRevision')} ${value.revision}`)} · <small>${esc(value.retrievedAt.slice(0, 10))}</small></p><details><summary>${t('rights')} · ${t(rights.redistribution === 'allowed' ? 'rightsAllowed' : rights.redistribution === 'restricted' ? 'rightsRestricted' : 'rightsUnknown')}</summary><dl><dt>${t('license')}</dt><dd>${rights.licenseId ? link(rights.licenseUrl, rights.licenseId) : t('rightsUnknown')}</dd>${rights.attribution ? `<dt>${t('attribution')}</dt><dd>${esc(rights.attribution)}</dd>` : ''}</dl></details><details><summary>${t('sourceDetails')}</summary><dl><dt>${t('requestedTitle')}</dt><dd>${esc(job.requested.title)}</dd><dt>${t('sourceHash')}</dt><dd><code>${value.contentHash}</code></dd><dt>${t('jobIdentity')}</dt><dd><code>${job.id}</code></dd><dt>${t('retrieved')}</dt><dd>${esc(value.retrievedAt)}</dd></dl></details></section>`;
  }
  function selectHtml(label: string, key: string, values: [string, string][], current: string, extra = '') { return `<label>${esc(label)}<select data-wikipedia-change="${key}" ${extra} ${busy() ? 'disabled' : ''}>${values.map(([id, value]) => `<option value="${esc(id)}" ${id === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>`; }
  function columnSelect(label: string, key: string, value: string, table: WikipediaTableInspection, extra = '') { return selectHtml(label, key, [['', t('chooseColumn')], ...table.headers.map((header, index) => [String(index), copy(options.locale(), 'column', { number: index + 1, label: header || t('unnamedColumn') })] as [string, string])], value, `data-table="${table.index}" ${extra}`); }
  function tableTitle(value: WikipediaTableInspection) { return `${copy(options.locale(), 'table', { number: value.index + 1 })} · ${value.caption || value.headings.at(-1) || t('tables')}`; }
  function sampleHtml(table: WikipediaTableInspection, selected: WikipediaTableDraft, current: WikipediaJobDraft) {
    const columns = wikipediaSampleColumns(selected, current.profileId), visibleColumns = columns.length ? columns : [...new Set(table.sample.flatMap(row => row.cells.map(value => value.column)))];
    return `<details class="wikipedia-cell-sample" data-wikipedia-sample="${table.index}" data-job="${current.jobId}" data-source-hash="${current.sourceHash}" ${selected.sampleOpen ? 'open' : ''}><summary>${t('sample')}</summary><div class="wikipedia-table-scroll"><table><thead><tr><th></th>${visibleColumns.map(index => `<th>${esc(copy(options.locale(), 'column', { number: index + 1, label: table.headers[index] || t('unnamedColumn') }))}</th>`).join('')}</tr></thead><tbody>${table.sample.map(row => `<tr><th>${esc(copy(options.locale(), 'row', { number: row.row }))}</th>${visibleColumns.map(index => { const cell = row.cells.find(value => value.column === index); return `<td lang="en">${cell ? cell.text ? esc(cell.text) : `<span class="source-muted">${t('emptyCell')}</span>` : `<span class="source-muted">${t('noCell')}</span>`}${cell?.truncated ? `<small>${t('trimmed')}</small>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  }
  function bindingHtml(selected: WikipediaTableDraft, current: WikipediaJobDraft) {
    const table = tableCache.get(selected.index); if (!table) return '';
    const attrs = `data-table="${table.index}"`;
    return `<section class="wikipedia-binding"><header><strong>${esc(tableTitle(table))}</strong>${button('remove-table', t('removeTable'), attrs, false)}</header><p class="source-muted">${esc(copy(options.locale(), 'physicalRows', { count: table.rows }))} · ${esc(copy(options.locale(), 'columns', { count: table.columns }))} · EN</p><div class="wikipedia-bindings">${current.profileId === 'office-tenures-v1' ? `${columnSelect(t('holder'), 'holder', selected.holder, table)}${selectHtml(t('dateLayout'), 'dateLayout', [['split', t('split')], ['tenure', t('tenure')]], selected.dateLayout, attrs)}${selected.dateLayout === 'tenure' ? columnSelect(t('tenureColumn'), 'tenure', selected.tenure, table) : columnSelect(t('startColumn'), 'start', selected.start, table) + columnSelect(t('endColumn'), 'end', selected.end, table)}` : `${columnSelect(t('timeColumn'), 'time', selected.time, table)}${selected.attributes.map((attribute, index) => `<div class="wikipedia-attribute">${columnSelect(t('attributeColumn'), 'attribute', attribute.column, table, `data-attribute="${index}"`)}${selectHtml(t('readAs'), 'attribute-kind', [['text', t('text')], ['linked-entities', t('linked')]], attribute.kind, `${attrs} data-attribute="${index}"`)}${button('remove-attribute', t('removeColumn'), `${attrs} data-attribute="${index}"`)}</div>`).join('')}<div>${button('add-attribute', t('addColumn'), `${attrs} ${selected.attributes.length >= 10 || busy() ? 'disabled' : ''}`)}</div>`}</div>${sampleHtml(table, selected, current)}${current.profileId === 'office-tenures-v1' ? `<details><summary>${t('rowBoundary')}</summary><label>${t('firstRow')}<input data-wikipedia-input="firstRow" ${attrs} value="${esc(selected.firstRow)}" maxlength="5" inputmode="numeric" ${busy() ? 'disabled' : ''}></label></details>` : ''}<details><summary>${t('headers')} · ${number(table.columns)}</summary><ol class="wikipedia-headers">${table.headers.map(value => `<li lang="en">${esc(value || t('unnamedColumn'))}</li>`).join('')}</ol></details></section>`;
  }
  function choicesHtml() {
    const current = draft(); if (!inspection || !current) return '';
    const profile = inspection.profiles.find(value => value.id === current.profileId);
    return `<form data-wikipedia-form="preview"><fieldset ${busy() ? 'disabled' : ''}><div class="wikipedia-profile">${selectHtml(t('profile'), 'profile', [['', t('chooseProfile')], ...inspection.profiles.map(value => [value.id, value.labels[options.locale()]] as [string, string])], current.profileId)}${selectHtml(t('calendar'), 'calendar', [['source-unspecified', t('sourceUnspecified')], ['Gregorian', t('gregorian')], ['Julian', t('julian')]], current.calendar)}</div>${profile ? `<p class="wikipedia-policy">${esc(profile.semantics[options.locale()])}</p>` : ''}${stale ? `<div class="source-notice error"><p>${t('sourceChanged')}</p><details><summary>${t('oldChoices')}</summary><pre>${esc(JSON.stringify(current.tables, null, 2))}</pre></details>${button('reset', t('resetChoices'))}</div>` : current.tables.map(value => bindingHtml(value, current)).join('')}<details data-wikipedia-tables data-job="${current.jobId}" ${current.tablesOpen ? 'open' : ''}><summary>${t('tables')} · ${number(inspection.totalTables)}</summary>${!inspection.totalTables ? `<p class="source-empty">${t('noTables')}</p>` : inspection.tables.map(value => `<article class="wikipedia-table-choice"><div><strong>${esc(tableTitle(value))}</strong><p class="source-muted">${esc(copy(options.locale(), 'physicalRows', { count: value.rows }))} · ${esc(copy(options.locale(), 'columns', { count: value.columns }))}</p></div>${button(current.tables.some(item => item.index === value.index) ? 'remove-table' : 'table', t(current.tables.some(item => item.index === value.index) ? 'removeTable' : 'useTable'), `data-table="${value.index}" ${!current.profileId || stale || busy() ? 'disabled' : ''}`)}</article>`).join('')}${pager('tables', current.offset, inspection.tables.length, inspection.totalTables, TABLE_PAGE)}</details><div class="wikipedia-main-action"><button type="submit" class="source-button primary" ${busy() || stale || !inspection.totalTables ? 'disabled' : ''}>${t(preparing ? 'preparing' : 'preview')}</button></div></fieldset></form>`;
  }
  function pager(action: string, offset: number, length: number, total: number, limit: number) { return total > limit ? `<div class="source-pagination">${button(`${action}-previous`, t('previous'), offset <= 0 ? 'disabled' : '')}<span>${esc(copy(options.locale(), 'range', { from: offset + 1, to: Math.min(total, offset + length), total }))}</span>${button(`${action}-next`, t('next'), offset + limit >= total ? 'disabled' : '')}</div>` : ''; }
  const fieldLabel = (id: string) => mapping?.preview.vocabulary?.catalog.properties.find(value => value.id === id)?.labels ?? null;
  const objectLabel = (id: string) => mapping?.sample.objects.find(value => value.id === id)?.labels ?? null;
  function valueHtml(value: KnowledgeValue, propertyId: string): string {
    if (value.kind === 'entity') return `${local(objectLabel(value.objectId) ?? undefined, t('unlabelledObject'))}<details><summary>${t('identifiers')}</summary><code>${esc(value.objectId)}</code></details>`;
    if (value.kind === 'text') { const label = mapping?.preview.vocabulary?.catalog.values?.find(item => item.propertyId === propertyId && item.value === value.value)?.labels; return label ? `${local(label, value.value)}<details><summary>${t('original')}</summary>${esc(value.value)}</details>` : `<span${value.language ? ` lang="${esc(value.language)}"` : ''}>${esc(value.value)}</span>${options.locale() === 'zh-CN' && value.language === 'en' ? '<small class="source-language">EN</small>' : ''}`; }
    if (value.kind === 'number') return `${number(value.value)}${value.unit ? ` ${esc(knowledgeMetadataLabel(value.unit, options.locale()) ?? value.unit)}` : ''}`;
    if (value.kind === 'boolean') return t(value.value ? 'yes' : 'no');
    if (value.kind === 'unknown' || value.kind === 'absent') return t(value.kind);
    if (value.kind === 'time') return timeHtml(value.value);
    if (value.kind === 'coordinate') return `${number(value.latitude)}, ${number(value.longitude)}`;
    return `<details><summary>${t('original')}</summary><pre>${esc(JSON.stringify(value.value, null, 2))}</pre></details>`;
  }
  function normalizedTimeHtml(value: KnowledgeTime) {
    const label = formatHistoricalDate(value, options.locale());
    const calendar = value.calendar === 'Gregorian' ? t('gregorian') : value.calendar === 'Julian' ? t('julian') : knowledgeTimeLabel('calendar', value.calendar, options.locale());
    return `<div class="wikipedia-time"><span>${esc(label)}</span><small>${esc(knowledgeTimeLabel('precision', value.precision, options.locale()))} · ${esc(calendar)}</small></div>`;
  }
  const rawTimes = (values: KnowledgeTime[]) => { const raw = historicalDateRawTexts(values); return raw.length ? `<details class="wikipedia-time-original"><summary>${t('original')}</summary>${raw.map(value => `<p>${esc(value)}</p>`).join('')}</details>` : ''; };
  function timeHtml(value: KnowledgeTime) { return `${normalizedTimeHtml(value)}${rawTimes([value])}`; }
  function claimTime(value: KnowledgeAssertion) { if (!value.validTime) return t('noDate'); const scope = value.validTime; if (scope.point) return timeHtml(scope.point); return `<div class="wikipedia-time-range">${scope.start ? normalizedTimeHtml(scope.start) : '…'}<span aria-hidden="true">–</span>${scope.end ? normalizedTimeHtml(scope.end) : '…'}</div>${rawTimes([scope.start, scope.end].filter((value): value is KnowledgeTime => !!value))}`; }
  function claimHtml(value: KnowledgeAssertion) { return `<tr><td>${local(objectLabel(value.subjectId) ?? undefined, t('unlabelledObject'))}</td><td>${local(fieldLabel(value.propertyId) ?? undefined, knowledgeMetadataLabel(value.propertyId, options.locale()) ?? t('unlabelledField'))}<details><summary>${t('identifiers')}</summary><code>${esc(value.propertyId)}</code></details></td><td>${valueHtml(value.value, value.propertyId)}<details class="wikipedia-claim-evidence"><summary>${t('evidence')}</summary>${value.evidence.map(evidence => { const source = mapping?.sample.sources.find(item => item.id === evidence.sourceId), name = source ? knowledgeSourceName(source, options.locale()) : null; return `<dl><dt>${t('source')}</dt><dd>${link(evidence.url ?? source?.url, name?.text ?? t('sourceDetails'))}${options.locale() === 'zh-CN' && /^en(?:-|$)/i.test(name?.language ?? '') ? '<small class="source-language">EN</small>' : ''}</dd>${name?.originalTitle ? `<dt>${esc(knowledgeDisplayCopy('originalSourceTitle', options.locale()))}</dt><dd${name.originalTitle.language ? ` lang="${esc(name.originalTitle.language)}"` : ''}>${esc(name.originalTitle.text)}${options.locale() === 'zh-CN' && /^en(?:-|$)/i.test(name.originalTitle.language ?? '') ? '<small class="source-language">EN</small>' : ''}</dd>` : ''}<dt>${t('locator')}</dt><dd><code>${esc(evidence.locator)}</code></dd>${source ? `<dt>${t('sourceRevision')}</dt><dd>${esc(source.revision ?? '')}</dd><dt>${t('sourceHash')}</dt><dd><code>${source.contentHash}</code></dd>` : ''}</dl>`; }).join('')}${value.qualifiers.length ? `<details><summary>${t('qualifier')}</summary><pre>${esc(JSON.stringify(value.qualifiers, null, 2))}</pre></details>` : ''}</details></td><td>${claimTime(value)}</td></tr>`; }
  function issuesHtml(value: WikipediaMappingPreview) {
    const items = issuePages.get(issuesPage) ?? [];
    return `<section class="${value.exceptionCount ? 'wikipedia-issues' : 'wikipedia-no-issues'}" aria-busy="${issuesReading}">${value.exceptionCount ? `<h3>${esc(copy(options.locale(), 'issues', { count: value.exceptionCount }))} · ${number(value.exceptionCount)}</h3>` : `<p class="source-muted">${t('noIssues')}</p>`}${items.map(issue => `<article><p>${esc(t(issueKeys.has(issue.code as WikipediaCopyKey) ? issue.code as WikipediaPlainKey : 'otherIssue'))}</p><details><summary>${t('issueDetails')}</summary><code>${esc(issue.code)} · ${esc(issue.locator)}</code></details></article>`).join('')}${issuesReading ? `<p role="status">${t('issuesLoading')}</p>` : ''}${issuesError ? `<div class="source-notice error wikipedia-issue-read-error" role="alert"><p>${t('issuesReadFailed')}</p><details><summary>${t('errorCode')}</summary><code>${esc(issuesError.code)}</code></details>${button('issues-retry', t('retryIssues'))}</div>` : ''}${pager('issues', issuesPage * ISSUE_PAGE, items.length, value.exceptionCount, ISSUE_PAGE)}</section>`;
  }
  function mappingHtml() {
    if (!mapping) return '';
    const value = mapping, counts = value.counts, claims = value.sample.assertions.slice(claimsPage * SAMPLE_PAGE, (claimsPage + 1) * SAMPLE_PAGE);
    return `<p class="wikipedia-policy">${esc(value.profile.labels[options.locale()])} · ${esc(value.profile.semantics[options.locale()])}</p><dl class="wikipedia-counts">${(['sourceRows', 'mappedRows', 'objects', 'claims'] as const).map(key => `<div><dt>${t(key)}</dt><dd>${number(key === 'claims' ? counts.assertions : counts[key])}</dd></div>`).join('')}</dl><details><summary>${t('dateCoverage')}</summary><dl class="wikipedia-metadata">${[['dated', counts.datedAssertions], ['applicable', counts.applicableAssertions], ['timedRows', counts.timedRows]].map(([key, count]) => `<dt>${t(key as WikipediaPlainKey)}</dt><dd>${number(Number(count))}</dd>`).join('')}</dl><p class="source-muted">${t('coverageNote')}</p></details><details><summary>${t('baseHead')} · ${esc(value.preview.prepared!.baseHead.slice(0, 8))}</summary><code>${value.preview.prepared!.baseHead}</code><p>${t('prepared')} · <code>${value.preview.prepared!.id}</code></p></details>${issuesHtml(value)}<h2>${t('claimSample')}</h2>${value.sample.assertions.length < counts.assertions ? `<p class="source-muted">${esc(copy(options.locale(), 'sampleRange', { shown: value.sample.assertions.length, total: counts.assertions }))}</p>` : ''}<div class="wikipedia-table-scroll"><table class="wikipedia-claims"><thead><tr><th>${t('object')}</th><th>${t('field')}</th><th>${t('value')}</th><th>${t('applicability')}</th></tr></thead><tbody>${claims.map(claimHtml).join('')}</tbody></table></div>${pager('claims', claimsPage * SAMPLE_PAGE, claims.length, value.sample.assertions.length, SAMPLE_PAGE)}${value.preview.vocabulary ? vocabularyReviewHtml(value.preview.vocabulary, options.locale(), vocabulary, value.preview.prepared!.id) : ''}<details><summary>${t('exactPlan')}</summary><pre class="wikipedia-plan">${esc(JSON.stringify(value.plan, null, 2))}</pre></details>${!adopted ? `<label class="wikipedia-review">${t('review')}<select data-wikipedia-change="review" ${busy() || blocked() ? 'disabled' : ''}><option value="unreviewed" ${review === 'unreviewed' ? 'selected' : ''}>${t('unreviewed')}</option><option value="adopted" ${review === 'adopted' ? 'selected' : ''}>${t('reviewed')}</option></select></label><p class="source-muted">${t('adoptNotice')}</p><div class="wikipedia-main-action">${button('adopt', t('adopt'), busy() || blocked() || !value.preview.objects || !value.preview.assertions || value.preview.vocabulary?.conflictCount ? 'disabled' : '', true)}</div>` : ''}`;
  }
  function resultHtml() { return adopted ? `<div class="source-notice" role="status"><p>${t(adopted.result.conflicts.length ? 'conflicts' : 'applied')}</p>${adopted.result.conflicts.length && options.onResumeImport ? button('imports', t('openImports')) : options.onAdopted ? button('result', t('showResult')) : ''}</div>` : ''; }
  function jobHtml(value: WikipediaJob) {
    return `<button type="button" class="wikipedia-job" data-wikipedia="job" data-id="${value.id}" ${value.id === input.jobId ? 'aria-current="true"' : ''}><strong>${esc(value.source?.title ?? value.requested.title)}</strong>${value.source ? `<small>${t('sourceRevision')} ${esc(value.source.revision)}</small>` : ''}<small>${t(value.receipt.status)} · <time datetime="${esc(value.receipt.startedAt)}">${esc(value.receipt.startedAt.slice(0, 10))}</time></small></button>`;
  }
  function content() {
    if (section === 'search') return `<section class="source-content wikipedia-content"><h1>${t('saveHeading')}</h1><form data-wikipedia-form="collect" class="wikipedia-acquire"><label>${t('pageTitle')}<input data-wikipedia-input="title" value="${esc(input.title)}" maxlength="200" autocomplete="off" ${active?.kind === 'collect' ? 'disabled' : ''}></label><label>${t('revision')}<input data-wikipedia-input="revision" value="${esc(input.revision)}" maxlength="20" inputmode="numeric" ${active?.kind === 'collect' ? 'disabled' : ''}></label><button type="submit" class="source-button primary" ${busy() ? 'disabled' : ''}>${t('save')}</button></form><p class="source-muted">${t('pageHint')}</p>${errorHtml()}${progressHtml()}</section>`;
    const receiptIssues = job && !job.source ? `<div class="source-notice error">${job.receipt.issues.map(issue => `<p>${esc(issueMessage(issue.code, issue.retryAfterMs))}<details><summary>${t('errorCode')}</summary><code>${esc(issue.code)}${issue.providerCode ? ` · ${esc(issue.providerCode)}` : ''}</code></details>`).join('')}${job.receipt.issues.some(value => value.retryable || value.code === 'CANCELLED') || job.receipt.status === 'partial' || job.receipt.status === 'cancelled' ? button('retry-acquisition', t('retryAcquisition'), busy() ? 'disabled' : '') : ''}${button('edit-request', t('editRequest'), active ? 'disabled' : '')}</div>` : '';
    return `<section class="source-content wikipedia-content"><div class="wikipedia-saved-layout"><aside class="wikipedia-jobs"><header><h2>${t('savedHeading')}</h2>${button('refresh', t('refresh'), loadingJobs ? 'disabled' : '')}</header>${loadingJobs ? `<p role="status">${t('loading')}</p>` : ''}${jobs.jobs.map(jobHtml).join('')}${!jobs.jobs.length && !loadingJobs ? `<p class="source-empty">${t('noJobs')}</p>${button('new-page', t('save'))}` : ''}${pager('jobs', jobsOffset, jobs.jobs.length, jobs.total, JOB_PAGE)}${jobs.issues.length ? `<div class="source-notice error"><p>${t('jobCorrupt')}</p><details><summary>${t('errorCode')}</summary>${jobs.issues.map(value => `<p><code>${esc(value.jobId)} · ${esc(value.code)}</code></p>`).join('')}</details></div>` : ''}</aside><main class="wikipedia-detail"><header class="wikipedia-heading"><h1 tabindex="-1">${t(mapping ? 'previewHeading' : 'inspectHeading')}</h1>${mapping ? button('edit-mapping', t('editMapping'), busy() ? 'disabled' : '') : ''}</header>${errorHtml()}${progressHtml()}${pendingHtml()}${inspecting ? `<p role="status">${t('inspecting')}</p>` : ''}${sourceHtml()}${receiptIssues}${!job && !inspecting ? `<p class="source-empty">${t('chooseJob')}</p>` : mapping ? mappingHtml() : choicesHtml()}${resultHtml()}</main></div></section>`;
  }
  async function open(next: WikipediaSection) {
    loadInput(); const sequence = ++viewSequence; visible = true; section = next; input.section = next; input.active = true; cache(); subscribe();
    if (!togglesBound && typeof document.addEventListener === 'function') { document.addEventListener('toggle', toggle, true); togglesBound = true; }
    await Promise.allSettled([loadJobs(), loadPending()]);
    if (sequence !== viewSequence || !visible) return;
    if (next === 'saved' && input.jobId && (!job || job.id !== input.jobId || !inspection)) await inspectJob(input.jobId); redraw();
  }
  function hide() { if (visible) rememberDisclosures(); if (loaded) cache(); visible = false; viewSequence++; inspectSequence++; jobsSequence++; pendingSequence++; previewSequence++; issuesSequence++; issuesReading = false; inspecting = false; preparing = false; unsubscribe?.(); unsubscribe = null; if (togglesBound) { document.removeEventListener('toggle', toggle, true); togglesBound = false; } }
  async function click(element: HTMLElement) {
    const action = element.dataset.wikipedia ?? element.dataset.knowledgeFile; rememberDisclosures();
    let catalogFocus: { target: string; page: number } | null = null;
    if (action === 'imports') { await options.onResumeImport?.(); return; }
    if (action === 'cancel' && active?.kind === 'collect') { cancelling = true; redraw(); try { await api.cancel(active.id); } catch (cause) { cancelling = false; fail(cause); redraw(); } return; }
    if (action === 'job' && element.dataset.id) { viewSequence++; await inspectJob(element.dataset.id); return; }
    if (action === 'new-page' || action === 'edit-request') { if (action === 'edit-request' && job) { input.title = job.requested.title; input.revision = job.requested.revision === undefined ? '' : String(job.requested.revision); } section = 'search'; input.section = section; viewSequence++; cache(); options.onSection(section); redraw(); return; }
    if (action === 'refresh') { await Promise.allSettled([loadJobs(), loadPending()]); redraw(); return; }
    if (action === 'pending') { await loadPending(); redraw(); return; }
    if (action === 'cache') { cache(); redraw(); return; }
    if (action === 'retry' && retry && !busy()) { const operation = retry; clearError(); await operation(); redraw(); return; }
    if (action === 'retry-acquisition' && job) { await acquire(job); return; }
    if (action === 'adopt') { await adoptMapping(); return; }
    if (action === 'check-result' && attempt) { await adoptMapping(true); return; }
    if (action === 'result' && adopted) { const interaction = options.navigationVersion?.(); try { await options.onAdopted?.(adopted.result, adopted.jobId, interaction); } catch { fail('resultNavigation'); redraw(); } return; }
    if (busy()) return;
    const current = draft(), selected = current?.tables.find(value => value.index === Number(element.dataset.table));
    if (action === 'edit-mapping') { invalidate(); clearError(); redraw(); return; }
    if (action === 'reset' && current && job?.source) { current.sourceHash = job.source.contentHash; current.tables = []; current.tablesOpen = true; stale = false; invalidate(); clearError(); }
    else if (action === 'table' && current && inspection) { const table = inspection.tables.find(value => value.index === Number(element.dataset.table)); if (!table || !current.profileId || stale) return; if (current.profileId === 'office-tenures-v1' && current.tables.length >= 10) { fail('tableLimit'); redraw(); return; } if (current.profileId === 'dated-entries-v1') current.tables = []; if (!current.tables.some(value => value.index === table.index)) current.tables.push(blankWikipediaTable(table, inspection.offset)); current.tablesOpen = false; invalidate(); clearError(); }
    else if (action === 'remove-table' && current) { current.tables = current.tables.filter(value => value !== selected); if (!current.tables.length) current.tablesOpen = true; invalidate(); clearError(); }
    else if (action === 'add-attribute' && selected && selected.attributes.length < 10) { selected.attributes.push({ column: '', kind: 'text' }); invalidate(); }
    else if (action === 'remove-attribute' && selected) { selected.attributes.splice(Number(element.dataset.attribute), 1); invalidate(); }
    else if (action === 'jobs-next' || action === 'jobs-previous') { jobsOffset = Math.max(0, jobsOffset + (action.endsWith('next') ? JOB_PAGE : -JOB_PAGE)); await loadJobs(); return; }
    else if ((action === 'tables-next' || action === 'tables-previous') && current && job) { await inspectJob(job.id, Math.max(0, current.offset + (action.endsWith('next') ? TABLE_PAGE : -TABLE_PAGE)), true); return; }
    else if (action === 'claims-next' || action === 'claims-previous') claimsPage = Math.max(0, Math.min(Math.ceil((mapping?.sample.assertions.length ?? 0) / SAMPLE_PAGE) - 1, claimsPage + (action.endsWith('next') ? 1 : -1)));
    else if (action === 'issues-next' || action === 'issues-previous') { await readIssues(issuesPage + (action.endsWith('next') ? 1 : -1)); return; }
    else if (action === 'issues-retry' && issuesError) { await readIssues(issuesError.page); return; }
    else if (action === 'catalog-kind' && ['properties', 'types', 'values'].includes(element.dataset.kind ?? '')) { vocabulary.kind = element.dataset.kind as typeof vocabulary.kind; vocabulary.page = 0; }
    else if (action === 'catalog-page' && ['page', 'missingPage', 'conflictPage', 'evidencePage'].includes(element.dataset.target ?? '')) { const page = Number(element.dataset.page), target = element.dataset.target as 'page'; if (Number.isSafeInteger(page) && page >= 0) { catalogFocus = { target, page: page + (page > vocabulary[target] ? 1 : -1) }; vocabulary[target] = page; } }
    cache(); redraw();
    if (catalogFocus && visible) { const controls = [...document.querySelectorAll<HTMLButtonElement>(`[data-knowledge-file="catalog-page"][data-target="${catalogFocus.target}"]`)].filter(value => !value.disabled); (controls.find(value => Number(value.dataset.page) === catalogFocus.page) ?? controls[0])?.focus({ preventScroll: true }); }
  }
  function inputChanged(element: HTMLInputElement) {
    const key = element.dataset.wikipediaInput; if (!key || busy() && !['title', 'revision'].includes(key) || active?.kind === 'collect' && ['title', 'revision'].includes(key)) return;
    if (key === 'title') input.title = element.value.slice(0, 200); else if (key === 'revision') input.revision = element.value.slice(0, 20); else if (key === 'firstRow') { const table = draft()?.tables.find(value => value.index === Number(element.dataset.table)); if (table) { table.firstRow = element.value.slice(0, 5); invalidate(); } }
    cache();
  }
  function change(element: HTMLSelectElement) {
    const key = element.dataset.wikipediaChange; if (!key || busy()) return; rememberDisclosures();
    if (key === 'review') { review = element.value === 'adopted' ? 'adopted' : 'unreviewed'; return; }
    const current = draft(); if (!current) return;
    if (key === 'profile' && ['', 'office-tenures-v1', 'dated-entries-v1'].includes(element.value)) { if (current.profileId !== element.value) { current.profileId = element.value as WikipediaJobDraft['profileId']; current.tables = []; current.tablesOpen = true; } }
    else if (key === 'calendar' && ['source-unspecified', 'Gregorian', 'Julian'].includes(element.value)) current.calendar = element.value as WikipediaJobDraft['calendar'];
    else { const table = current.tables.find(value => value.index === Number(element.dataset.table)); if (!table) return; if (['holder', 'tenure', 'start', 'end', 'time'].includes(key)) table[key as 'holder'] = element.value; else if (key === 'dateLayout' && ['split', 'tenure'].includes(element.value)) table.dateLayout = element.value as 'split' | 'tenure'; else { const attribute = table.attributes[Number(element.dataset.attribute)]; if (attribute && key === 'attribute') attribute.column = element.value; else if (attribute && key === 'attribute-kind' && ['text', 'linked-entities'].includes(element.value)) attribute.kind = element.value as 'text' | 'linked-entities'; } }
    invalidate(); clearError(); cache(); redraw();
    if (['holder', 'tenure', 'start', 'end', 'time', 'attribute'].includes(key)) { const sample = document.querySelector<HTMLDetailsElement>(`.wikipedia-cell-sample[data-wikipedia-sample="${Number(element.dataset.table)}"]`); if (sample?.open) sample.scrollIntoView({ block: 'nearest' }); }
  }
  return { open, content, click, input: inputChanged, change, submit: async (form: HTMLFormElement) => { if (form.dataset.wikipediaForm === 'collect') await acquire(); else if (form.dataset.wikipediaForm === 'preview') await prepareMapping(); }, hide, navigation() { loadInput(); return { active: input.active, section: input.section }; }, activate(value: boolean, next: WikipediaSection = section) { loadInput(); input.active = value; input.section = next; return cache(); } };
}
