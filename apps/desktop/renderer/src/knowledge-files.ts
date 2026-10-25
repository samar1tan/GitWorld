import type { HistoryLocale } from '@gitworld/domain';
import type { KnowledgeFileImportRequest, KnowledgeFilePreviewResult, KnowledgeImportResult, KnowledgeObjectDetail, KnowledgeObjectBundle, OperationProgress, ServiceMethods } from '@gitworld/contracts';
import type { KnowledgePendingImport, KnowledgeVocabularyConflict } from '../../../../packages/contracts/src/knowledge-import-types.ts';
import type { KnowledgeAssertion } from '../../../../packages/domain/src/knowledge.ts';
import { bridge, request, operationId, escapeHtml as esc, ServiceFailure } from './client.ts';
import { knowledgeMetadataLabel } from './knowledge-labels.ts';
import { knowledgeFilesCopy as copy, type KnowledgeFilesPlainKey } from './knowledge-files-copy.ts';
import { initialVocabularyReview, vocabularyConflictHtml, vocabularyReviewHtml, type VocabularyReviewState } from './knowledge-file-vocabulary.ts';
import { preparedInputHash, type SourceObservation } from './source-observation.ts';

export type KnowledgeFilesApi = {
  preview(params: ServiceMethods['knowledge.filePreview']['params']): Promise<KnowledgeFilePreviewResult>;
  adopt(params: KnowledgeFileImportRequest): Promise<KnowledgeImportResult>;
  pending(): Promise<KnowledgePendingImport[]>;
  resume(params: ServiceMethods['knowledge.resumeImport']['params']): Promise<KnowledgeImportResult>;
  status(): Promise<ServiceMethods['repository.status']['result']>;
  conflicts(): Promise<KnowledgeImportResult['conflicts']>;
  object(params: ServiceMethods['knowledge.object']['params']): Promise<KnowledgeObjectDetail>;
  resolve(params: ServiceMethods['knowledge.resolve']['params']): Promise<unknown>;
};
type Options = {
  locale: () => HistoryLocale; render: () => void; navigationVersion?: () => number;
  api?: KnowledgeFilesApi; selectFile?: () => Promise<{ fileToken: string } | null>;
  subscribeProgress?: (listener: (value: OperationProgress) => void) => () => void;
  onAdopted?: (result: KnowledgeImportResult, jobId: string, interaction?: number) => void | Promise<void>;
  onObserved?: (event: SourceObservation) => void;
};
const defaultApi: KnowledgeFilesApi = {
  preview: params => request('knowledge.filePreview', params), adopt: params => request('knowledge.fileAdopt', params),
  pending: () => request('knowledge.pendingImports', {}), resume: params => request('knowledge.resumeImport', params),
  status: () => request('repository.status', {}), conflicts: () => request('knowledge.conflicts', {}),
  object: params => request('knowledge.object', params), resolve: params => request('knowledge.resolve', params),
};

export function createKnowledgeFiles(options: Options) {
  const api = options.api ?? defaultApi, selectFile = options.selectFile ?? (() => bridge().selectFile('import'));
  let visible = false, running = 0, preview: KnowledgeFilePreviewResult | null = null, fileToken: string | null = null, expectedHead: string | null = null, adopted: KnowledgeImportResult | null = null, review = false;
  let errorContext: 'file' | 'resume' = 'file', errorReason: string | null = null;
  let errorIssues: NonNullable<ServiceFailure['detail']['issues']> = [];
  let error: string | null = null, errorConflicts: KnowledgeVocabularyConflict[] = [], pendingImports: KnowledgePendingImport[] = [], pendingKnown = false, pendingFailed = false, conflictsFailed = false;
  let attempt: { operationId: string; previewId: string } | null = null, conflicts: KnowledgeImportResult['conflicts'] = [], details = new Map<string, KnowledgeObjectDetail>(), conflictsPage = 0;
  let continuation:KnowledgeImportResult['continuation']|null=null,resolutionSaved=false;
  let refreshSequence = 0, previewSequence = 0, issuesPage = 0, issuesOpen = false, vocabulary = initialVocabularyReview();
  const conflictLimits = new Map<string, number>();
  let activeOperation: string | null = null, progress: OperationProgress | null = null, unsubscribe: (() => void) | null = null;
  const t = (key: KnowledgeFilesPlainKey) => copy(options.locale(), key), count = (value: number) => new Intl.NumberFormat(options.locale()).format(value);
  const busy = () => running > 0, blocked = () => !pendingKnown || pendingImports.length > 0 || !!attempt;
  const currentPreview = () => preview?.preview ?? adopted?.preview ?? null;
  const jobId = (value = currentPreview()) => `file-${value?.inputHash.slice(0, 32) ?? ''}`;
  const redraw = () => { if (visible) options.render(); };
  const observed = (event: SourceObservation) => { try { options.onObserved?.(event); } catch { /* Observers cannot change an import result. */ } };
  const button = (action: string, label: string, extra = '') => `<button type="button" class="source-button" data-knowledge-file="${action}" ${extra} ${busy() ? 'disabled' : ''}>${esc(label)}</button>`;
  const name = (value: KnowledgeObjectBundle | null) => value?.object.labels[options.locale()] ?? value?.object.labels.en ?? t('none');
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const hasObjectResult=(value:KnowledgeImportResult)=>value.changedObjects.length+value.unchangedObjects.length>0;
  function fail(cause: unknown, context: 'file' | 'resume' = 'file') { errorReason = cause instanceof ServiceFailure && typeof cause.detail.parameters?.reason === 'string' ? cause.detail.parameters.reason : null; errorIssues = cause instanceof ServiceFailure ? cause.detail.issues ?? [] : []; errorContext = context; error = cause instanceof ServiceFailure ? cause.detail.code : 'IO_ERROR'; errorConflicts = cause instanceof ServiceFailure ? cause.detail.vocabularyConflicts ?? [] : []; vocabulary.conflictPage = 0; }
  function redrawCatalog(selector: string) {
    const scroll = document.querySelector<HTMLElement>('.knowledge-file-content')?.scrollTop ?? 0;
    redraw(); const next = document.querySelector<HTMLElement>('.knowledge-file-content'); if (next) next.scrollTop = scroll;
    document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }
  function rememberDisclosures() {
    const key = currentPreview()?.inputHash;
    for (const item of document.querySelectorAll<HTMLDetailsElement>('[data-file-disclosure]')) if (item.dataset.previewKey === key) {
      const field = item.dataset.fileDisclosure;
      if (field === 'catalogOpen' || field === 'originOpen' || field === 'missingOpen' || field === 'conflictsOpen') vocabulary[field] = item.open;
      else if (field === 'issuesOpen') issuesOpen = item.open;
    }
  }
  function progressText() { return progress?.stage === 'writing' && Number.isSafeInteger(progress.completed) && Number.isSafeInteger(progress.total) && progress.total! > 0 ? copy(options.locale(), 'workingFiles', { completed: progress.completed!, total: progress.total! }) : t('busy'); }
  function subscribe() {
    unsubscribe?.(); unsubscribe = null;
    if (!visible || !activeOperation) return;
    const listen = options.subscribeProgress ?? (!options.api ? (listener: (value: OperationProgress) => void) => bridge().onProgress(listener) : null);
    unsubscribe = listen?.(value => { if (value.operationId !== activeOperation) return; progress = value; const element = document.querySelector('[data-knowledge-file-progress]'); if (element) element.textContent = progressText(); }) ?? null;
  }
  async function run(operation: () => Promise<void>) { running++; redraw(); try { await operation(); } catch (cause) { fail(cause); } finally { running--; redraw(); } }
  async function refreshInfo() {
    const sequence = ++refreshSequence, results = await Promise.allSettled([api.pending(), api.conflicts()]);
    if (sequence !== refreshSequence) return;
    if (results[0].status === 'fulfilled') { pendingImports = results[0].value; pendingKnown = true; pendingFailed = false; } else { pendingKnown = false; pendingFailed = true; }
    if (results[1].status === 'fulfilled') { conflicts = results[1].value; conflictsFailed = false; conflictsPage = Math.min(conflictsPage, Math.max(0, Math.ceil(conflicts.length / 10) - 1)); } else conflictsFailed = true;
    const selected = conflicts.slice(conflictsPage * 10, conflictsPage * 10 + 10);
    const displays = await Promise.allSettled(selected.map(async value => [value.objectId, await api.object({ objectId: value.objectId, revision: 'working' })] as const));
    if (sequence === refreshSequence) details = new Map(displays.flatMap(value => value.status === 'fulfilled' ? [value.value] : []));
  }
  async function loadPreview() {
    if (!fileToken || blocked()) return;
    const sequence = ++previewSequence, token = fileToken, value = await api.preview({ fileToken: token });
    const head = value.preview.prepared?.baseHead ?? (await api.status()).head;
    if (sequence !== previewSequence || token !== fileToken) return;
    preview = value; expectedHead = head; adopted = null; continuation=null;resolutionSaved=false;issuesPage = 0; issuesOpen = false; vocabulary = initialVocabularyReview();
    if (value.preview.objects) { const inputHash = preparedInputHash(value.preview); observed({ type: 'data-acquired', jobId: jobId(value.preview) }); observed({ type: 'data-previewed', jobId: jobId(value.preview), ...(inputHash ? { inputHash } : {}) }); }
  }
  async function complete(result: KnowledgeImportResult, interaction: number | undefined) {
    adopted = result; attempt = null;continuation=result.conflicts.length?result.continuation??null:null;resolutionSaved=false;await refreshInfo();
    if (result.changedObjects.length || result.unchangedObjects.length) { const inputHash = preparedInputHash(result.preview); observed({ type: 'data-adopted', jobId: jobId(result.preview), paths: result.paths ?? [], ...(inputHash ? { inputHash } : {}) }); }
    if (!result.conflicts.length) { try { await options.onAdopted?.(result, jobId(result.preview), interaction); } catch { error = 'RESULT_NAVIGATION_FAILED'; } }
  }
  async function recover(operation: { operationId: string; previewId: string }, interaction: number | undefined) {
    activeOperation = operation.operationId; progress = null; subscribe();
    try { await complete(await api.resume(operation), interaction); }
    catch (cause) { fail(cause, 'resume'); if (cause instanceof ServiceFailure && cause.detail.code === 'NOT_FOUND' && attempt?.operationId === operation.operationId) { attempt = null; error = 'IMPORT_NOT_ACCEPTED'; expectedHead = null; } await refreshInfo(); }
    finally { activeOperation = null; unsubscribe?.(); unsubscribe = null; }
  }
  function assertion(value: KnowledgeAssertion | undefined, objectId: string) {
    if (!value) return t('none');
    const item = currentPreview()?.vocabulary?.catalog.properties.find(item => item.id === value.propertyId);
    const property = details.get(objectId)?.display?.properties[value.propertyId]?.[options.locale()] ?? item?.labels[options.locale()] ?? item?.labels.en ?? knowledgeMetadataLabel(value.propertyId, options.locale()) ?? value.propertyId;
    return `<strong>${esc(property)}</strong><pre>${esc(JSON.stringify({ value: value.value, ...(value.validTime ? { validTime: value.validTime } : {}), qualifiers: value.qualifiers, evidence: value.evidence }, null, 2))}</pre>`;
  }
  function conflictHtml(value: KnowledgeImportResult['conflicts'][number]) {
    const before = new Map(value.base?.assertions.map(item => [item.id, item]) ?? []), local = new Map(value.local?.assertions.map(item => [item.id, item]) ?? []), incoming = new Map(value.incoming.assertions.map(item => [item.id, item]));
    const ids = [...new Set([...before.keys(), ...local.keys(), ...incoming.keys()])].filter(id => changed(before.get(id), local.get(id)) || changed(before.get(id), incoming.get(id))), limit = conflictLimits.get(value.objectId) ?? 50;
    return `<article class="knowledge-file-conflict"><h3>${esc(name(value.local ?? value.incoming))}</h3><details ${limit > 50 ? 'open' : ''}><summary>${t('details')} · ${count(ids.length)}</summary>${changed(value.local?.object, value.incoming.object) ? `<p>${t('metadata')}</p><div class="knowledge-file-columns"><span>${esc(name(value.base))}</span><span>${esc(name(value.local))}</span><span>${esc(name(value.incoming))}</span></div>` : ''}<div class="knowledge-file-columns headings"><strong>${t('base')}</strong><strong>${t('local')}</strong><strong>${t('incoming')}</strong></div>${ids.slice(0, limit).map(id => `<div class="knowledge-file-columns"><div>${assertion(before.get(id), value.objectId)}</div><div>${assertion(local.get(id), value.objectId)}</div><div>${assertion(incoming.get(id), value.objectId)}</div></div>`).join('')}${ids.length > limit ? `<p>${esc(copy(options.locale(), 'suppliedRange', { shown: limit, total: ids.length }))}</p>${button('more-differences', t('moreDifferences'), `data-id="${esc(value.objectId)}"`)}` : ''}</details><p class="source-muted">${t(value.continuation?.kind==='wikipedia-mapping'?'resolveWikiNote':'resolveNote')}</p><div class="source-toolbar">${button('resolve', t('keep'), `data-id="${esc(value.objectId)}" data-choice="local" ${blocked() ? 'disabled' : ''}`)}${button('resolve', t('use'), `data-id="${esc(value.objectId)}" data-choice="incoming" ${blocked() ? 'disabled' : ''}`)}</div></article>`;
  }
  function resultHtml(){
    const next=continuation??conflicts.find(value=>value.continuation?.kind==='wikipedia-mapping')?.continuation;
    const guide=next?.kind==='wikipedia-mapping'?`<p data-wikipedia-continuation="${esc(next.jobId)}">${t(resolutionSaved?'wikiResolved':'wikiNext')}</p>`:'';
    if(!adopted)return guide?`<div role="status" class="source-notice">${guide}</div>`:'';
    const reviewOnly=adopted.conflicts.length>0&&!hasObjectResult(adopted);
    return `<div role="status" class="source-notice" data-import-result="${reviewOnly?'conflict-review':'adopted'}"><p>${reviewOnly?t('reviewOnly'):`${t('applied')} ${esc(copy(options.locale(),'changedCount',{count:adopted.changedObjects.length}))}`}</p>${guide}${hasObjectResult(adopted)&&options.onAdopted?button('results',t('result')):''}</div>`;
  }
  function pendingHtml() {
    return `${pendingFailed ? `<div role="alert" class="source-notice error">${t('pendingFailed')}${button('pending', t('refreshPending'))}</div>` : ''}${pendingImports.length ? `<section class="knowledge-file-pending"><h2>${t('pendingTitle')}</h2><p>${t('pendingNotice')}</p>${pendingImports.map(item => `<article><div class="knowledge-file-stats">${(['objects', 'assertions', 'datedAssertions'] as const).map((key, index) => `<span>${t((['objects', 'claims', 'dated'] as const)[index])}<strong>${count(item.counts[key])}</strong></span>`).join('')}</div>${item.vocabulary ? `<p>${t('catalogIdentity')} · <code>${esc(item.vocabulary.id)}</code> · ${esc(item.vocabulary.revision)}</p>` : ''}${item.review ? `<p>${t('frozenReview')} · ${t(item.review === 'adopted' ? 'pendingAdopted' : 'pendingUnreviewed')}</p>` : ''}<details><summary>${t('previewIdentity')}</summary><dl class="knowledge-file-origin"><dt>${t('operation')}</dt><dd><code>${esc(item.operationId)}</code></dd><dt>${t('preview')}</dt><dd><code>${esc(item.previewId)}</code></dd><dt>${t('baseHead')}</dt><dd><code>${esc(item.baseHead)}</code></dd></dl></details>${button('resume', t('resume'), `data-operation="${esc(item.operationId)}" data-preview="${esc(item.previewId)}"`)}</article>`).join('')}</section>` : ''}${attempt && !pendingImports.some(item => item.operationId === attempt!.operationId) ? `<div class="source-notice"><p>${t('unknownResult')}</p>${button('check-result', t('checkResult'))}</div>` : ''}`;
  }
  function content() {
    rememberDisclosures(); const selected = currentPreview(), blockedImport = blocked() || !!selected?.vocabulary?.conflictCount;
    return `<section class="source-content knowledge-file-content"><div class="source-toolbar"><h1>${t('title')}</h1>${button('choose', t('choose'), blocked() ? 'disabled' : '')}</div><p class="source-muted">${t('format')}</p>${pendingHtml()}${error ? `<div role="alert" class="source-notice error"><p>${esc(errorReason && ['paired-import-pending', 'incomplete-paired-import'].includes(errorReason) ? t('pendingRedirect') : error === 'IMPORT_NOT_ACCEPTED' ? t('notAccepted') : error === 'RESULT_NAVIGATION_FAILED' ? t('resultNavigationFailed') : errorConflicts.length ? t('catalogConflict') : errorContext === 'resume' ? t('resumeFailed') : ['CONFLICT', 'HEAD_CHANGED', 'CONTENT_CHANGED'].includes(error) ? t('fileChanged') : t('error'))}</p><details><summary>${t('details')}</summary><code>${esc(error)}</code>${errorIssues.length ? `<ul>${errorIssues.slice(0, 20).map(issue => `<li><code>${esc(issue.path)} · ${esc(issue.code)}</code></li>`).join('')}</ul>` : ''}</details>${errorConflicts.length ? vocabularyConflictHtml(options.locale(), errorConflicts, errorConflicts.length, vocabulary.conflictPage) : ''}${fileToken && !blocked() ? button('preview', t('retry')) : ''}</div>` : ''}${busy() ? `<p role="status" data-knowledge-file-progress>${esc(progressText())}</p>` : ''}${resultHtml()}
    ${selected ? `<section class="knowledge-file-preview"><h2>${preview ? `${t('preview')} · ${esc(preview.fileName)}` : t('recoveredPreview')}</h2><div class="knowledge-file-stats">${(['objects', 'assertions', 'datedAssertions', 'locatedObjects'] as const).map((key, index) => `<span>${t((['objects', 'claims', 'dated', 'located'] as const)[index])}<strong>${count(selected[key])}</strong></span>`).join('')}</div>${selected.prepared ? `<details><summary>${t('previewIdentity')}</summary><dl class="knowledge-file-origin"><dt>${t('preview')}</dt><dd><code>${esc(selected.prepared.id)}</code></dd><dt>${t('baseHead')}</dt><dd><code>${esc(selected.prepared.baseHead)}</code></dd></dl></details>` : ''}${selected.vocabulary ? vocabularyReviewHtml(selected.vocabulary, options.locale(), vocabulary, selected.inputHash) : ''}<h3>${t('sample')}</h3><ul>${selected.sample.slice(0, 20).map(value => `<li>${esc(value.labels[options.locale()] ?? value.labels.en ?? value.id)}</li>`).join('')}</ul>${selected.issueCount ? `<details data-file-disclosure="issuesOpen" data-preview-key="${esc(selected.inputHash)}" ${issuesOpen ? 'open' : ''}><summary>${t('issues')} · ${count(selected.issueCount)}</summary><p>${esc(copy(options.locale(), 'issueCount', { shown: Math.min(20, selected.issues.length - issuesPage * 20), total: selected.issueCount }))}</p>${selected.issues.slice(issuesPage * 20, issuesPage * 20 + 20).map(issue => `<p><code>${esc(issue.code)} · ${esc(issue.locator)}</code></p>`).join('')}${selected.issues.length < selected.issueCount ? `<p>${esc(copy(options.locale(), 'suppliedRange', { shown: selected.issues.length, total: selected.issueCount }))}</p>` : ''}${selected.issues.length > 20 ? `<div class="knowledge-file-pagination">${button('issues-page', t('previous'), `data-page="${issuesPage - 1}" ${issuesPage === 0 ? 'disabled' : ''}`)}<span>${esc(copy(options.locale(), 'countRange', { from: issuesPage * 20 + 1, to: Math.min(selected.issues.length, issuesPage * 20 + 20), total: selected.issues.length }))}</span>${button('issues-page', t('next'), `data-page="${issuesPage + 1}" ${(issuesPage + 1) * 20 >= selected.issues.length ? 'disabled' : ''}`)}</div>` : ''}</details>` : ''}${preview && !adopted ? `<label class="knowledge-file-review">${t('review')}<select data-knowledge-file-review ${busy() || blocked() ? 'disabled' : ''}><option value="unreviewed" ${!review ? 'selected' : ''}>${t('unreviewed')}</option><option value="adopted" ${review ? 'selected' : ''}>${t('adopted')}</option></select></label><p class="source-muted">${t('notice')}</p>${selected.vocabulary?.conflictCount ? `<p class="source-notice">${t('catalogConflict')}</p>` : ''}${button('adopt', t('adopt'), blockedImport || !selected.objects || !expectedHead ? 'disabled' : '')}` : ''}</section>` : !busy() && pendingKnown && !pendingImports.length && !attempt ? `<p class="source-empty">${t('selected')}</p>` : ''}
    <div class="source-toolbar"><h2>${t('conflicts')} · ${count(conflicts.length)}</h2>${button('refresh', t('refresh'))}</div>${conflictsFailed ? `<p class="source-notice error">${t('error')}</p>` : conflicts.slice(conflictsPage * 10, conflictsPage * 10 + 10).map(conflictHtml).join('') || `<p class="source-muted">${t('noConflicts')}</p>`}${conflicts.length > 10 ? `<div class="knowledge-file-pagination">${button('matches-page', t('previous'), `data-page="${conflictsPage - 1}" ${conflictsPage === 0 ? 'disabled' : ''}`)}<span>${esc(copy(options.locale(), 'countRange', { from: conflictsPage * 10 + 1, to: Math.min(conflicts.length, conflictsPage * 10 + 10), total: conflicts.length }))}</span>${button('matches-page', t('next'), `data-page="${conflictsPage + 1}" ${(conflictsPage + 1) * 10 >= conflicts.length ? 'disabled' : ''}`)}</div>` : ''}</section>`;
  }
  async function open() { visible = true;continuation=null;resolutionSaved=false;subscribe();await run(refreshInfo); }
  async function click(target: HTMLElement) {
    if (busy()) return;
    rememberDisclosures(); const action = target.dataset.knowledgeFile, interaction = options.navigationVersion?.();
    if (action === 'issues-page') { const page = Number(target.dataset.page); if (Number.isSafeInteger(page) && page >= 0 && page * 20 < (currentPreview()?.issues.length ?? 0)) { issuesPage = page; redrawCatalog('[data-knowledge-file="issues-page"]:not([disabled])'); } return; }
    if (action === 'catalog-kind' && ['properties', 'types', 'values'].includes(target.dataset.kind ?? '')) { vocabulary.kind = target.dataset.kind as VocabularyReviewState['kind']; vocabulary.page = 0; redrawCatalog(`[data-knowledge-file="catalog-kind"][data-kind="${vocabulary.kind}"]`); return; }
    if (action === 'catalog-page') { const page = Number(target.dataset.page), field = target.dataset.target; if (Number.isSafeInteger(page) && page >= 0 && ['page', 'missingPage', 'conflictPage', 'evidencePage'].includes(field ?? '')) { vocabulary[field as 'page' | 'missingPage' | 'conflictPage' | 'evidencePage'] = page; redrawCatalog(`[data-knowledge-file="catalog-page"][data-target="${field}"]:not([disabled])`); } return; }
    await run(async () => {
      error = null; errorConflicts = []; errorIssues = []; errorReason = null;
      if (action === 'choose' && !blocked()) { const selected = await selectFile(); if (selected) { fileToken = selected.fileToken; preview = null; expectedHead = null; adopted = null; review = false; redraw(); await loadPreview(); } }
      else if (action === 'preview' && !blocked()) await loadPreview();
      else if (action === 'refresh' || action === 'pending') await refreshInfo();
      else if (action === 'adopt' && preview && fileToken && expectedHead && !blocked() && !preview.preview.vocabulary?.conflictCount) {
        const id = operationId(), prepared = preview.preview.prepared;
        const input: KnowledgeFileImportRequest = { fileToken, expectedHead: prepared?.baseHead ?? expectedHead, expectedInputHash: preview.preview.inputHash, review: review ? 'adopted' : 'unreviewed', operationId: id, ...(prepared ? { previewId: prepared.id } : {}) };
        if (prepared) attempt = { operationId: id, previewId: prepared.id }; activeOperation = id; progress = null; subscribe();
        try { await complete(await api.adopt(input), interaction); } catch (cause) { fail(cause); if (errorReason && ['paired-import-pending', 'incomplete-paired-import'].includes(errorReason)) attempt = null; await refreshInfo(); } finally { activeOperation = null; unsubscribe?.(); unsubscribe = null; }
      }
      else if (action === 'resume') { const item = pendingImports.find(value => value.operationId === target.dataset.operation && value.previewId === target.dataset.preview); if (item) await recover({ operationId: item.operationId, previewId: item.previewId }, interaction); }
      else if (action === 'check-result' && attempt) await recover({ ...attempt }, interaction);
      else if (action === 'resolve' && !blocked() && target.dataset.id && (target.dataset.choice === 'local' || target.dataset.choice === 'incoming')) { const context=conflicts.find(value=>value.objectId===target.dataset.id)?.continuation;const status = await api.status();await api.resolve({ objectId: target.dataset.id, choice: target.dataset.choice, expectedHead: status.head });if(context?.kind==='wikipedia-mapping'){continuation=context;resolutionSaved=true;}await refreshInfo(); }
      else if (action === 'results' && adopted&&hasObjectResult(adopted)) { try { await options.onAdopted?.(adopted, jobId(adopted.preview), interaction); } catch { error = 'RESULT_NAVIGATION_FAILED'; } }
      else if (action === 'more-differences' && target.dataset.id) { const id = target.dataset.id; conflictLimits.set(id, (conflictLimits.get(id) ?? 50) + 50); }
      else if (action === 'matches-page') { const page = Number(target.dataset.page); if (Number.isSafeInteger(page) && page >= 0 && page * 10 < conflicts.length) { conflictsPage = page; await refreshInfo(); } }
    });
  }
  return { open, content, click, change(target: HTMLSelectElement) { if (!busy() && !blocked() && target.hasAttribute('data-knowledge-file-review')) review = target.value === 'adopted'; }, hide() { visible = false; unsubscribe?.(); unsubscribe = null; } };
}
