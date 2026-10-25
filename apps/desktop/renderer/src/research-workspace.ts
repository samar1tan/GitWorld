import type { HistoryLocale } from '@gitworld/domain';
import type { ClosePreparationResult } from '@gitworld/contracts';
import type { PinnedResearchComparison, PinnedResearchEvidence, ResearchComparisonEndpoint, ResearchContext, ResearchRecord, ResearchRecordEnvelope, ResearchRecordRevision, ResearchRecordSummary, ResearchScope, ResearchWorkspaceApi } from '../../../../packages/contracts/src/research-types.ts';
import { escapeHtml as esc, ServiceFailure } from './client.ts';
import { researchCopy as copy, type ResearchCopyKey } from './research-copy.ts';
import { knowledgeLocalizedText } from './knowledge-labels.ts';
import { knowledgeCopy } from './knowledge-copy.ts';
import { emptyResearchScope, mergeResearchEvidence, newResearchRecord, parseResearchPeriod, parseResearchRecovery, researchFingerprint, type ResearchRecovery } from './research-draft.ts';

type Options = {
  locale: () => HistoryLocale;
  render: () => void;
  api: ResearchWorkspaceApi;
  currentContext?: () => ResearchContext | null;
  onClose: () => void | Promise<unknown>;
  flushDraft?: () => Promise<void>;
  onOpenChanges?: (recordId: string) => void | Promise<void>;
  onOpenReference?: (reference: PinnedResearchEvidence | ResearchComparisonEndpoint) => void | Promise<void>;
  onExplore?: (scope: ResearchScope, repositoryRevision: string | null) => void | Promise<void>;
  onSaved?: (envelope: ResearchRecordEnvelope) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
};
const RECOVERY_KEY = 'gitworld-research-input-v1';
const period = (scope: ResearchScope): [string, string] => scope.timeWindow ? scope.timeWindow.map(String) as [string, string] : ['', ''];
const short = (value: string) => value.length > 14 ? `${value.slice(0, 12)}…` : value;

export function createResearchWorkspace(options: Options) {
  const storage = () => options.storage ?? localStorage;
  let visible = false, loading = false, saving = false, loadingRevision = false, recovered = false, bufferFailed = false;
  let records: ResearchRecordSummary[] = [], record: ResearchRecord | null = null, expectedHash: string | null = null, repositoryRevision: string | null = null;
  let from = '', to = '', baseline = '', filter = '', revisions: ResearchRecordRevision[] = [];
  let oldRevision: ResearchRecordEnvelope | null = null, selectedOid: string | null = null;
  let error: string | null = null, retry: (() => Promise<unknown>) | null = null, reloadConfirmation = false;
  let draftConfirmation: { kind: 'replace' | 'discard'; proceed: () => Promise<void>; origin: string } | null = null;
  let openSequence = 0, loadSequence = 0, revisionSequence = 0;
  let savePending: Promise<boolean> | null = null;
  const evidenceLimits = { editor: 8, current: 8, old: 8 };
  const t = (key: Exclude<ResearchCopyKey, 'objects' | 'fields' | 'removeEvidence' | 'edited' | 'bce' | 'period' | 'evidenceCount' | 'evidenceShown'|'navigationContexts'>) => copy(options.locale(), key);
  const redraw = () => { if (visible) options.render(); };
  const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat(options.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); };
  const currentFingerprint = () => record ? JSON.stringify([researchFingerprint(record), from, to]) : '';
  const year = (value: number) => value < 0 ? copy(options.locale(), 'bce', { year: Math.abs(value) }) : new Intl.NumberFormat(options.locale(), { useGrouping: false }).format(value);
  const interval = (value: [number, number] | null) => value ? copy(options.locale(), 'period', { from: year(value[0]), to: year(value[1]) }) : '';
  const hasUnsavedChanges = () => !!record && currentFingerprint() !== baseline;
  const saveState = () => saving ? 'saving' : !expectedHash ? 'draft' : hasUnsavedChanges() ? 'unsaved' : 'saved';
  const button = (action: string, label: string, extra = '', primary = false) => `<button type="button" class="research-button${primary ? ' primary' : ''}" data-research="${action}" ${extra}>${esc(label)}</button>`;
  const changed = () => { cacheInput(); updateSaveState(); };
  function updateSaveState() {
    const element = document.querySelector('[data-research-save-state]');
    if (element) { element.textContent = t(saveState()); element.classList.toggle('dirty', hasUnsavedChanges()); }
    const actions = document.querySelector('[data-research-draft-actions]');
    if (actions) actions.innerHTML = draftActionHtml();
  }
  function cacheInput() {
    if (!record) return true;
    try {
      if (hasUnsavedChanges()) {
        const value: ResearchRecovery = { schemaVersion: 1, record, expectedHash, from, to, baseline };
        storage().setItem(RECOVERY_KEY, JSON.stringify(value));
      } else if (parseResearchRecovery(storage().getItem(RECOVERY_KEY))?.record.id === record.id) storage().removeItem(RECOVERY_KEY);
      bufferFailed = false; return true;
    } catch { bufferFailed = true; return false; }
  }
  function clearRecovery(id: string) {
    try { if (parseResearchRecovery(storage().getItem(RECOVERY_KEY))?.record.id === id) storage().removeItem(RECOVERY_KEY); return true; }
    catch { bufferFailed = true; return false; }
  }
  function showFailure(cause: unknown, retryOperation: (() => Promise<unknown>) | null = null) {
    error = cause instanceof ServiceFailure ? cause.detail.code : cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'IO_ERROR';
    retry = retryOperation;
  }
  function errorHtml(actions = true) {
    if (!error) return '';
    const message = error === 'TITLE_REQUIRED' ? t('titleRequired') : error === 'INVALID_TIME' ? t('invalidTime') : error === 'CONFLICT' ? t('conflict') : error === 'SERVICE_UNAVAILABLE' ? t('unavailable') : error === 'VALIDATION_FAILED' || error === 'INVALID_REQUEST' ? t('invalidRecord') : error === 'REVISION_NOT_FOUND' ? t('revisionUnavailable') : error === 'RESEARCH_REFRESH_FAILED' ? t('refreshFailed') : t('failed');
    return `<div class="research-notice" role="alert"><p>${esc(message)}</p><details><summary>${t('errorCode')}</summary><code>${esc(error)}</code></details>${!actions ? '' : error === 'CONFLICT' ? `<div class="research-notice-actions">${button('save-as-new', t('saveAsNew'))}${button('reload', t('reloadSaved'))}</div>` : retry ? `<div class="research-notice-actions">${button('retry', t('retry'))}</div>` : ''}</div>`;
  }
  function draftActionHtml() { return hasUnsavedChanges() ? button('discard', t('discardDraft'), saving ? 'disabled' : '') : ''; }
  function recoveryErrorHtml() { return bufferFailed ? `<div class="research-notice" role="alert">${t('recoveryError')}<div class="research-notice-actions">${button('retry-recovery', t('retry'), saving ? 'disabled' : '')}</div></div>` : ''; }
  function draftDialogHtml() {
    if (!draftConfirmation) return '';
    return `<div class="research-inline-dialog" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="research-draft-message"><section><p id="research-draft-message">${t(draftConfirmation.kind === 'replace' ? 'replaceDraft' : expectedHash ? 'discardEdit' : 'discardNew')}</p>${errorHtml(false)}${recoveryErrorHtml()}<div class="research-toolbar-actions">${button('cancel-draft', t('keepEditing'), saving ? 'disabled' : '')}${draftConfirmation.kind === 'replace' ? button('save-continue', t(saving ? 'saving' : 'saveContinue'), saving ? 'disabled' : '') : ''}${button('confirm-discard', t(draftConfirmation.kind === 'replace' ? 'discardContinue' : 'discardDraft'), saving ? 'disabled' : '')}</div></section></div>`;
  }
  function listHtml() {
    const values = records.filter(value => !filter || `${value.title} ${value.scope.query} ${value.scope.label ?? ''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
    return values.map(value => `<button type="button" class="research-record" data-research="open" data-id="${esc(value.id)}" ${value.id === record?.id ? 'aria-current="true"' : ''} ${saving ? 'disabled' : ''}><strong>${esc(value.title || t('untitled'))}</strong><small>${esc(copy(options.locale(), 'edited', { date: date(value.updatedAt) }))}</small>${value.scope.label || value.scope.query ? `<small>${esc(value.scope.label ?? value.scope.query)}</small>` : ''}</button>`).join('') || `<p class="research-empty">${t('noRecords')}</p>`;
  }
  function evidenceHtml(value: PinnedResearchEvidence, index: number, editable = true) {
    const kind = value.kind === 'historical-state' ? 'historicalState' : value.kind;
    return `<details class="research-evidence" data-evidence-index="${index}"><summary><strong>${esc(value.title)}</strong><small title="${esc(value.locator)}">${t(kind)}${value.year !== undefined ? ` · ${esc(year(value.year))}` : ''}${value.locator ? ` · ${esc(value.locator)}` : ''}</small></summary><div class="research-evidence-detail"><dl><dt>${t('locator')}</dt><dd>${esc(value.locator)}</dd><dt>${t('repositoryRevision')}</dt><dd><code>${esc(value.repositoryRevision)}</code></dd>${value.sourceRevision ? `<dt>${t('source')}</dt><dd>${esc(value.sourceRevision)}</dd>` : ''}</dl><div class="research-evidence-actions">${options.onOpenReference ? button('inspect-evidence', t('inspect'), `data-index="${index}" ${editable ? '' : 'data-old="true"'}`) : ''}${editable ? button('remove-evidence', t('remove'), `data-index="${index}" aria-label="${esc(copy(options.locale(), 'removeEvidence', { title: value.title }))}"`) : ''}</div></div></details>`;
  }
  function evidenceListHtml(values: PinnedResearchEvidence[], view: keyof typeof evidenceLimits) {
    const shown = Math.min(values.length, evidenceLimits[view]);
    return `<div class="research-evidence-list" data-research-evidence-list="${view}"><div class="research-evidence-count"><span>${esc(copy(options.locale(), 'evidenceCount', { count: values.length }))}</span>${shown > 8 ? button('evidence-collapse', t('collapseEvidence'), `data-evidence-view="${view}"`) : ''}</div>${values.slice(0, shown).map((value, index) => evidenceHtml(value, index, view !== 'old')).join('')}${values.length > 8 ? `<div class="research-evidence-paging"><span>${esc(copy(options.locale(), 'evidenceShown', { shown, total: values.length }))}</span><div class="research-toolbar-actions">${shown < values.length ? button('evidence-more', t('showMoreEvidence'), `data-evidence-view="${view}"`) + button('evidence-all', t('showAllEvidence'), `data-evidence-view="${view}"`) : ''}${shown > 8 ? button('evidence-collapse', t('collapseEvidence'), `data-evidence-view="${view}"`) : ''}</div></div>` : ''}</div>`;
  }
  function redrawEvidence(view: keyof typeof evidenceLimits, firstNew?: number) {
    const current = document.querySelector<HTMLElement>(`[data-research-evidence-list="${view}"]`), values = (view === 'old' ? oldRevision?.record : record)?.evidence;
    if (!current || !values) { redraw(); return; }
    const opened = [...current.querySelectorAll<HTMLDetailsElement>('.research-evidence[open]')].map(value => value.dataset.evidenceIndex);
    current.outerHTML = evidenceListHtml(values, view);
    const next = document.querySelector<HTMLElement>(`[data-research-evidence-list="${view}"]`);
    for (const id of opened) { const row = next?.querySelector<HTMLDetailsElement>(`[data-evidence-index="${id}"]`); if (row) row.open = true; }
    const focus = firstNew === undefined ? next?.querySelector<HTMLElement>('summary') : next?.querySelector<HTMLElement>(`[data-evidence-index="${firstNew}"] summary`);
    focus?.focus({ preventScroll: true }); focus?.scrollIntoView({ block: 'nearest' });
  }
  function endpointHtml(value: ResearchComparisonEndpoint, side: 'a' | 'b', old = false) {
    const selected=knowledgeLocalizedText(value.labels,options.locale(),value.label),english=options.locale()==='zh-CN'&&/^en(?:-|$)/i.test(selected.language??'');
    return `<div class="research-comparison-endpoint"><small>${t(side === 'a' ? 'endpointA' : 'endpointB')}</small><strong${selected.language?` lang="${esc(selected.language)}"`:''}>${esc(selected.text)}${english?`<span class="knowledge-language" title="${esc(knowledgeCopy(options.locale(),'englishSource'))}">EN</span>`:''}</strong>${value.year != null ? `<p class="research-endpoint-time">${t('historicalTime')} · ${esc(year(value.year))}</p>` : ''}<div class="research-meta"><span>${t('repositoryRevision')} <code>${esc(short(value.repositoryRevision))}</code></span>${value.historicalRef ? `<code>${esc(value.historicalRef)}</code>` : ''}${value.includeUnreviewed ? `<span class="research-review-policy">${t('includesUnreviewed')}</span>` : ''}</div>${options.onOpenReference ? button('inspect-endpoint', t('inspect'), `data-side="${side}" ${old ? 'data-old="true"' : ''}`) : ''}</div>`;
  }
  function comparisonHtml(value: PinnedResearchComparison | null, old = false) { return value ? `<div class="research-comparison">${endpointHtml(value.a, 'a', old)}${endpointHtml(value.b, 'b', old)}</div>` : ''; }
  function revisionFields(value: ResearchRecord, other: ResearchRecord, old: boolean) {
    const field = (label: string, content: string, differs: boolean) => `<section class="research-revision-field${differs ? ' changed' : ''}"><h4>${esc(label)}${differs ? ` · ${t('changed')}` : ''}</h4>${content}</section>`;
    const different = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    return field(t('question'), `<p>${esc(value.title)}</p>`, value.title !== other.title)
      + field(t('scope'), `<p>${esc([value.scope.label, value.scope.query, interval(value.scope.timeWindow)].filter(Boolean).join(' · ') || t('scopeEmpty'))}</p>${navigationHtml(value.scope)}`, different(value.scope, other.scope))
      + field(t('interpretation'), `<p>${esc(value.interpretation)}</p>`, value.interpretation !== other.interpretation)
      + field(t('openQuestions'), `<ul>${value.openQuestions.map(question => `<li>${esc(question)}</li>`).join('')}</ul>`, different(value.openQuestions, other.openQuestions))
      + field(t('evidence'), evidenceListHtml(value.evidence, old ? 'old' : 'current'), different(value.evidence, other.evidence))
      + field(t('fixedComparison'), comparisonHtml(value.comparison, old), different(value.comparison, other.comparison));
  }
  function historyHtml() {
    if (!record || !expectedHash) return '';
    return `<section class="research-history"><h2>${t('history')}</h2>${revisions.length ? `<div class="research-history-list">${revisions.map(value => `<button type="button" class="research-button research-history-item" data-research="revision" data-oid="${esc(value.oid)}" ${value.oid === selectedOid ? 'aria-current="true"' : ''}><span>${esc(value.message)}</span><small>${esc(date(value.authoredAt))} · ${esc(short(value.oid))}</small></button>`).join('')}</div>` : `<p class="research-muted">${t('noHistory')}</p>`}${loadingRevision ? `<p role="status">${t('loading')}</p>` : oldRevision ? `<div class="research-revision"><div class="research-revision-heading"><span>${t('previous')} · <code>${esc(short(selectedOid ?? ''))}</code></span>${button('close-revision', t('closeRevision'))}</div><div class="research-revision-grid"><div class="research-revision-column"><h3>${t('previous')}</h3>${revisionFields(oldRevision.record, record, true)}</div><div class="research-revision-column"><h3>${t('working')}</h3>${revisionFields(record, oldRevision.record, false)}</div></div></div>` : ''}</section>`;
  }
  function navigationHtml(scope:ResearchScope){
    const recipe=scope.navigation;if(!recipe)return '';
    const ids=recipe.query.contextIds??[];
    return `<div class="research-navigation"><strong>${t('navigationRecipe')}</strong><p>${esc(scope.label??(recipe.query.unassigned?t('unassignedScope'):ids.length?copy(options.locale(),'navigationContexts',{count:ids.length}):t('allMaterialScope')))} · ${recipe.revision==='working'?t('followWorking'):`${t('fixedNavigation')} <code>${esc(short(recipe.revision))}</code>`}</p>${ids.length?`<details><summary>${t('navigationIdentifiers')}</summary>${ids.map(id=>`<p><code>${esc(id)}</code></p>`).join('')}</details>`:''}</div>`;
  }
  function editorHtml() {
    if (!record) return `<p class="research-empty">${t('chooseRecord')}</p>`;
    const context = options.currentContext?.();
    return `<form class="research-editor" data-research-form="record" novalidate><fieldset ${saving ? 'disabled' : ''} style="border:0;padding:0;margin:0;min-width:0"><label class="research-field research-question">${t('question')}<input name="title" data-research-input="title" value="${esc(record.title)}" placeholder="${t('questionPlaceholder')}" maxlength="500" required ${error === 'TITLE_REQUIRED' ? 'aria-invalid="true"' : ''}></label><section class="research-section"><div class="research-section-heading"><h2>${t('scope')}</h2><div class="research-section-actions">${context ? button('use-scope', t('useScope')) : ''}${options.onExplore ? button('explore-scope', t('exploreScope')) : ''}</div></div><div class="research-scope-fields"><label class="research-field research-query">${t('query')}<input data-research-input="query" value="${esc(record.scope.query)}" maxlength="500"></label><label class="research-field">${t('from')}<input type="text" inputmode="numeric" maxlength="12" data-research-input="from" value="${esc(from)}" ${error === 'INVALID_TIME' ? 'aria-invalid="true"' : ''}></label><label class="research-field">${t('to')}<input type="text" inputmode="numeric" maxlength="12" data-research-input="to" value="${esc(to)}" ${error === 'INVALID_TIME' ? 'aria-invalid="true"' : ''}></label></div><p class="research-muted">${t('timeHint')}</p><div class="research-meta">${record.scope.label ? `<span>${esc(record.scope.label)}</span>` : ''}${record.scope.objectIds.length ? `<span>${esc(copy(options.locale(), 'objects', { count: record.scope.objectIds.length }))}</span>` : ''}${record.scope.fieldIds.length ? `<span>${esc(copy(options.locale(), 'fields', { count: record.scope.fieldIds.length }))}</span>` : ''}</div>${navigationHtml(record.scope)}</section><section class="research-section"><div class="research-section-heading"><h2>${t('evidence')}</h2>${context?.evidence?.length ? button('attach-evidence', t('addEvidence')) : ''}</div>${record.evidence.length ? evidenceListHtml(record.evidence, 'editor') : `<p class="research-muted">${t('noEvidence')}</p>`}</section>${record.comparison || context?.comparison ? `<section class="research-section"><div class="research-section-heading"><h2>${t('fixedComparison')}</h2><div class="research-section-actions">${context?.comparison ? button('attach-comparison', t('attachComparison')) : ''}${record.comparison ? button('remove-comparison', t('removeComparison')) : ''}</div></div>${comparisonHtml(record.comparison)}</section>` : ''}<section class="research-section"><label class="research-field">${t('interpretation')}<textarea data-research-input="interpretation" rows="7" maxlength="100000" placeholder="${t('interpretationPlaceholder')}">${esc(record.interpretation)}</textarea></label><label class="research-field">${t('openQuestions')}<textarea data-research-input="questions" rows="4" maxlength="20000" placeholder="${t('openQuestionsPlaceholder')}">${esc(record.openQuestions.join('\n'))}</textarea></label></section><div class="research-savebar"><button class="research-button primary" type="submit">${t(saving ? 'saving' : 'save')}</button>${options.onOpenChanges && expectedHash ? button('changes', t('reviewChanges')) : ''}<span class="research-save-state${hasUnsavedChanges() ? ' dirty' : ''}" data-research-save-state role="status">${t(saveState())}</span></div></fieldset></form>${historyHtml()}`;
  }
  function content() {
    return `<div class="research-shell"><aside class="research-sidebar"><div class="research-sidebar-header"><h2>${t('records')}</h2>${button('new', '+', `aria-label="${t('newRecord')}" ${saving ? 'disabled' : ''}`)}</div><label class="research-record-filter"><input data-research-input="filter" value="${esc(filter)}" placeholder="${t('listFilter')}" aria-label="${t('listFilter')}"></label><div class="research-record-list" data-research-list>${listHtml()}</div></aside><section class="research-main"><div class="research-toolbar"><h1>${t('research')}</h1><div class="research-toolbar-actions"><span data-research-draft-actions>${draftActionHtml()}</span>${button('close', t('returnExplore'))}${!record ? button('new', t('newRecord'), '', true) : ''}</div></div>${draftConfirmation ? '' : errorHtml()}${recovered ? `<div class="research-notice recovered" role="status">${t('recovered')}</div>` : ''}${draftConfirmation ? '' : recoveryErrorHtml()}${loading ? `<p role="status">${t('loading')}</p>` : editorHtml()}</section>${draftDialogHtml()}${reloadConfirmation ? `<div class="research-inline-dialog" role="dialog" aria-modal="true" aria-labelledby="research-reload-message"><section><p id="research-reload-message">${t('reloadConfirm')}</p><div class="research-toolbar-actions">${button('cancel-reload', t('keepEditing'))}${button('confirm-reload', t('replaceInput'))}</div></section></div>` : ''}</div>`;
  }
  async function refreshList() { records = await options.api.list(); }
  function bind(envelope: ResearchRecordEnvelope) {
    evidenceLimits.editor = evidenceLimits.current = evidenceLimits.old = 8;
    record = structuredClone(envelope.record); expectedHash = envelope.contentHash; repositoryRevision = envelope.repositoryRevision;
    [from, to] = period(record.scope); baseline = currentFingerprint(); recovered = false; bufferFailed = false;
    oldRevision = null; selectedOid = null; revisionSequence++;
  }
  async function loadRecord(id: string) {
    const sequence = ++loadSequence; loading = true; error = null; retry = null; redraw();
    try {
      const envelope = await options.api.get(id);
      const history = await options.api.history(id);
      if (sequence !== loadSequence) return;
      bind(envelope); revisions = history;
    } catch (cause) { if (sequence === loadSequence) showFailure(cause, () => loadRecord(id)); }
    finally { if (sequence === loadSequence) { loading = false; redraw(); } }
  }
  async function save(): Promise<boolean> {
    if (savePending) return savePending;
    if (!record) return true;
    if (!record.title.trim()) { error = 'TITLE_REQUIRED'; redraw(); return false; }
    if (!hasUnsavedChanges()) return true;
    const parsed = parseResearchPeriod(from, to);
    if (!parsed.ok) { error = 'INVALID_TIME'; redraw(); return false; }
    const snapshot: ResearchRecord = { ...structuredClone(record), title: record.title.trim(), scope: { ...structuredClone(record.scope), timeWindow: parsed.value }, updatedAt: new Date().toISOString() };
    const hash = expectedHash; saving = true; error = null; retry = null; redraw();
    if (draftConfirmation) document.querySelector<HTMLElement>('.research-inline-dialog')?.focus({ preventScroll: true });
    savePending = (async () => {
      try {
        const envelope = await options.api.save(snapshot, hash);
        bind(envelope); clearRecovery(snapshot.id); revisions = [];
        const refreshed = await Promise.allSettled([refreshList(), options.api.history(snapshot.id)]);
        if (refreshed[1].status === 'fulfilled') revisions = refreshed[1].value;
        if (refreshed.some(result => result.status === 'rejected')) { error = 'RESEARCH_REFRESH_FAILED'; retry = async () => { await refreshList(); revisions = await options.api.history(snapshot.id); error = null; redraw(); }; }
        try { options.onSaved?.(envelope); } catch { /* Observers cannot undo a successful save. */ }
        return true;
      } catch (cause) { showFailure(cause, save); cacheInput(); return false; }
      finally { saving = false; savePending = null; redraw(); }
    })();
    return savePending;
  }
  async function replaceInput(proceed: () => Promise<void>, origin: string) {
    if (savePending) await savePending;
    if (!hasUnsavedChanges()) { await proceed(); return; }
    draftConfirmation = { kind: 'replace', proceed, origin }; reloadConfirmation = false;
    redraw(); document.querySelector<HTMLButtonElement>('[data-research="cancel-draft"]')?.focus({ preventScroll: true });
  }
  async function discardInput(): Promise<boolean> {
    if (record && !clearRecovery(record.id)) { redraw(); return false; }
    try { await options.flushDraft?.(); }
    catch { cacheInput(); bufferFailed = true; redraw(); return false; }
    openSequence++; loadSequence++; revisionSequence++;
    record = null; expectedHash = null; repositoryRevision = null; baseline = ''; from = to = '';
    revisions = []; oldRevision = null; selectedOid = null; recovered = false; error = null; retry = null; loading = false; bufferFailed = false;
    return true;
  }
  async function beginRecord(context: ResearchContext | null) {
    evidenceLimits.editor = evidenceLimits.current = evidenceLimits.old = 8;
    openSequence++; loadSequence++; revisionSequence++;
    record = newResearchRecord(crypto.randomUUID(), context?.scope ?? emptyResearchScope(), new Date().toISOString());
    expectedHash = null; repositoryRevision = null; [from, to] = period(record.scope); baseline = currentFingerprint();
    if (context?.evidence?.length) record.evidence = mergeResearchEvidence([], context.evidence);
    if (context?.comparison) record.comparison = structuredClone(context.comparison);
    revisions = []; oldRevision = null; selectedOid = null; recovered = false; error = null; retry = null; loading = false; changed(); redraw();
  }
  async function newRecord(context = options.currentContext?.() ?? null) {
    const snapshot = context ? structuredClone(context) : null;
    await replaceInput(() => beginRecord(snapshot), '[data-research="new"]');
  }
  async function open(id?: string) {
    if (id && id === record?.id && hasUnsavedChanges()) { await open(); return; }
    if (id && record && id !== record.id && hasUnsavedChanges()) {
      visible = true;
      await replaceInput(() => open(id), '[data-research="open"][aria-current="true"]');
      return;
    }
    const sequence = ++openSequence;
    visible = true; loading = true; if (!hasUnsavedChanges()) error = null; redraw();
    try {
      const listed = await options.api.list();
      if (sequence !== openSequence) return;
      records = listed;
      if (id) { await loadRecord(id); return; }
      if (record) {
        if (!expectedHash) return;
        if (hasUnsavedChanges()) {
          const current = await options.api.get(record.id);
          if (sequence !== openSequence) return;
          if (current.contentHash !== expectedHash) error = 'CONFLICT';
          revisions = await options.api.history(record.id);
          return;
        }
        if (records.some(value => value.id === record!.id)) { await loadRecord(record.id); return; }
        record = null; expectedHash = null; repositoryRevision = null; revisions = []; oldRevision = null;
      }
      let recovery: ResearchRecovery | null = null;
      try { recovery = parseResearchRecovery(storage().getItem(RECOVERY_KEY)); } catch { /* The service still supplies saved records. */ }
      if (recovery) {
        record = structuredClone(recovery.record); expectedHash = recovery.expectedHash; repositoryRevision = null;
        from = recovery.from; to = recovery.to; baseline = recovery.baseline; recovered = true;
        if (expectedHash) {
          try {
            const current = await options.api.get(record.id);
            repositoryRevision = current.repositoryRevision;
            if (current.contentHash !== expectedHash) error = 'CONFLICT';
            revisions = await options.api.history(record.id);
          } catch (cause) {
            if (cause instanceof ServiceFailure && cause.detail.code === 'NOT_FOUND') error = 'CONFLICT';
            else throw cause;
          }
        }
      } else if (records[0]) await loadRecord(records[0].id);
    } catch (cause) { if (sequence === openSequence) showFailure(cause, () => open(id)); }
    finally { if (sequence === openSequence) { loading = false; redraw(); } }
  }
  async function showRevision(oid: string) {
    if (!record || saving) return;
    const sequence = ++revisionSequence, id = record.id; selectedOid = oid; loadingRevision = true; error = null; redraw();
    try { const envelope = await options.api.readRevision(id, oid); if (sequence === revisionSequence && record?.id === id) oldRevision = envelope; }
    catch (cause) { if (sequence === revisionSequence) showFailure(cause, () => showRevision(oid)); }
    finally { if (sequence === revisionSequence) { loadingRevision = false; redraw(); } }
  }
  function attachEvidence(values: PinnedResearchEvidence[]) {
    if (!record || saving) return;
    record.evidence = mergeResearchEvidence(record.evidence, values); error = null; changed(); redraw();
  }
  function attachComparison(value: PinnedResearchComparison) {
    if (!record || saving) return;
    record.comparison = structuredClone(value); error = null; changed(); redraw();
  }
  async function click(target: HTMLElement) {
    const action = target.dataset.research;
    if (saving && !['inspect-evidence', 'inspect-endpoint'].includes(action ?? '')) return;
    if (draftConfirmation && !['cancel-draft', 'confirm-discard', 'save-continue', 'retry-recovery'].includes(action ?? '')) return;
    try {
    if (action === 'cancel-draft' && draftConfirmation) {
      const origin = draftConfirmation.origin; draftConfirmation = null; redraw(); document.querySelector<HTMLButtonElement>(origin)?.focus({ preventScroll: true });
    }
    else if (action === 'save-continue' && draftConfirmation?.kind === 'replace') {
      const confirmed = draftConfirmation;
      if (await save()) { draftConfirmation = null; await confirmed.proceed(); }
      else document.querySelector<HTMLButtonElement>('[data-research="cancel-draft"]')?.focus({ preventScroll: true });
    }
    else if (action === 'confirm-discard' && draftConfirmation) {
      const confirmed = draftConfirmation;
      if (await discardInput()) { draftConfirmation = null; await confirmed.proceed(); }
      else document.querySelector<HTMLButtonElement>('[data-research="cancel-draft"]')?.focus({ preventScroll: true });
    }
    else if (action === 'discard' && hasUnsavedChanges()) {
      draftConfirmation = { kind: 'discard', proceed: async () => { hide(); await options.onClose(); }, origin: '[data-research="discard"]' };
      reloadConfirmation = false; redraw(); document.querySelector<HTMLButtonElement>('[data-research="cancel-draft"]')?.focus({ preventScroll: true });
    }
    else if (action === 'retry-recovery') { await prepareClose(); redraw(); }
    else if (action === 'evidence-more' || action === 'evidence-all' || action === 'evidence-collapse') {
      const view = target.dataset.evidenceView;
      if (view === 'editor' || view === 'current' || view === 'old') {
        const count = (view === 'old' ? oldRevision?.record : record)?.evidence.length ?? 0;
        const before = Math.min(count, evidenceLimits[view]); evidenceLimits[view] = action === 'evidence-collapse' ? 8 : action === 'evidence-all' ? count : Math.min(count, evidenceLimits[view] + 8); redrawEvidence(view, evidenceLimits[view] > before ? before : undefined);
      }
    }
    else if (action === 'new') await newRecord();
    else if (action === 'open' && target.dataset.id && target.dataset.id !== record?.id) { const id = target.dataset.id; await replaceInput(async () => { openSequence++; await loadRecord(id); }, '[data-research="open"][aria-current="true"]'); }
    else if (action === 'close') { if ((await prepareClose()).ready) { hide(); await options.onClose(); } }
    else if (action === 'changes' && record && (await prepareClose()).ready) await options.onOpenChanges?.(record.id);
    else if (action === 'use-scope' && record) { const context = options.currentContext?.(); if (context) { record.scope = structuredClone(context.scope); [from, to] = period(record.scope); changed(); redraw(); } }
    else if (action === 'explore-scope' && record) {
      const parsed = parseResearchPeriod(from, to);
      if (!parsed.ok) { error = 'INVALID_TIME'; redraw(); }
      else if ((await prepareClose()).ready) await options.onExplore?.({ ...structuredClone(record.scope), timeWindow: parsed.value }, repositoryRevision);
    }
    else if (action === 'attach-evidence') attachEvidence(options.currentContext?.()?.evidence ?? []);
    else if (action === 'attach-comparison') { const comparison = options.currentContext?.()?.comparison; if (comparison) attachComparison(comparison); }
    else if (action === 'remove-evidence' && record) { const index = Number(target.dataset.index); if (Number.isInteger(index) && index >= 0 && index < record.evidence.length) { record.evidence.splice(index, 1); changed(); redrawEvidence('editor', Math.min(index, record.evidence.length - 1)); } }
    else if (action === 'remove-comparison' && record) { record.comparison = null; changed(); redraw(); }
    else if (action === 'inspect-evidence') { const value = (target.dataset.old ? oldRevision?.record : record)?.evidence[Number(target.dataset.index)]; if (value) await options.onOpenReference?.(structuredClone(value)); }
    else if (action === 'inspect-endpoint') { const comparison = (target.dataset.old ? oldRevision?.record : record)?.comparison, side = target.dataset.side; if (comparison && (side === 'a' || side === 'b')) await options.onOpenReference?.(structuredClone(comparison[side])); }
    else if (action === 'revision' && target.dataset.oid) await showRevision(target.dataset.oid);
    else if (action === 'close-revision') { revisionSequence++; oldRevision = null; selectedOid = null; loadingRevision = false; redraw(); }
    else if (action === 'retry' && retry) await retry();
    else if (action === 'save-as-new' && record) { const oldId = record.id; record.id = crypto.randomUUID(); expectedHash = null; repositoryRevision = null; baseline = ''; clearRecovery(oldId); recovered = false; error = null; revisions = []; oldRevision = null; changed(); redraw(); }
    else if (action === 'reload' && record) { reloadConfirmation = true; redraw(); document.querySelector<HTMLButtonElement>('[data-research="cancel-reload"]')?.focus(); }
    else if (action === 'cancel-reload') { reloadConfirmation = false; redraw(); }
    else if (action === 'confirm-reload' && record) { const id = record.id; clearRecovery(id); reloadConfirmation = false; await loadRecord(id); }
    } catch (cause) { showFailure(cause); redraw(); }
  }
  async function submit(form: HTMLFormElement) { if (!draftConfirmation && form.dataset.researchForm === 'record') await save(); }
  function input(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    const action = target.dataset.researchInput;
    if (action === 'filter') { filter = target.value; const list = document.querySelector('[data-research-list]'); if (list) list.innerHTML = listHtml(); return; }
    if (!record || saving || draftConfirmation || reloadConfirmation) return;
    if (action === 'title') record.title = target.value;
    else if (action === 'query') record.scope.query = target.value;
    else if (action === 'from') from = target.value;
    else if (action === 'to') to = target.value;
    else if (action === 'interpretation') record.interpretation = target.value;
    else if (action === 'questions') record.openQuestions = target.value.split('\n');
    else return;
    changed();
  }
  function key(event: KeyboardEvent) {
    if (!visible) return;
    if (reloadConfirmation || draftConfirmation) {
      if (event.key === 'Escape') {
        event.preventDefault(); if (saving) return;
        const origin = draftConfirmation?.origin ?? '[data-research="reload"]'; draftConfirmation = null; reloadConfirmation = false; redraw(); document.querySelector<HTMLButtonElement>(origin)?.focus({ preventScroll: true });
      }
      else if (event.key === 'Tab') {
        const controls = [...document.querySelectorAll<HTMLElement>('.research-inline-dialog button:not([disabled]), .research-inline-dialog summary')];
        if (controls.length) {
          const first = controls[0], last = controls.at(-1)!;
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        } else { event.preventDefault(); document.querySelector<HTMLElement>('.research-inline-dialog')?.focus({ preventScroll: true }); }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  }
  async function prepareClose(): Promise<ClosePreparationResult> {
    if (savePending) await savePending;
    if (!cacheInput()) { redraw(); return { ready: false, reason: 'unsaved-input' }; }
    try { await options.flushDraft?.(); }
    catch { bufferFailed = true; redraw(); return { ready: false, reason: 'unsaved-input' }; }
    bufferFailed = false; return { ready: true };
  }
  function hide() { cacheInput(); visible = false; draftConfirmation = null; reloadConfirmation = false; openSequence++; loadSequence++; revisionSequence++; }
  return { open, newRecord, content, click, submit, input, change: input, key, save, prepareClose, hasUnsavedChanges, attachEvidence, attachComparison, hide };
}
