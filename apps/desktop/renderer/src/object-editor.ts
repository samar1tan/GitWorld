import type { HistoryLocale } from '@gitworld/domain';
import type { KnowledgeAssertion, KnowledgeQuery, KnowledgeQueryResult, KnowledgeValue } from '../../../../packages/domain/src/knowledge.ts';
import type { ClosePreparationResult, KnowledgeEditContext, KnowledgeSaveEditRequest, KnowledgeSaveEditResult } from '@gitworld/contracts';
import { escapeHtml as esc, ServiceFailure } from './client.ts';
import { knowledgeDisplayCopy, knowledgeLocalizedText, knowledgeMetadataLabel, knowledgeTimeLabel, knowledgeValueDisplay } from './knowledge-labels.ts';
import { knowledgeSourceName } from './knowledge-sources.ts';
import { objectEditorCopy as copy, type ObjectEditorCopyKey } from './object-editor-copy.ts';
import { blankObjectEditForm, parseObjectEditForm, parseObjectEditRecovery, type ObjectEditForm } from './object-editor-form.ts';

export type ObjectEditorTarget = { objectId?: string; assertionId?: string; year?: number; observedRevision?: string };
export type ObjectEditorApi = { context(objectId?: string): Promise<KnowledgeEditContext>; save(input: KnowledgeSaveEditRequest): Promise<KnowledgeSaveEditResult>; query(query: KnowledgeQuery): Promise<KnowledgeQueryResult> };
type Options = { locale: () => HistoryLocale; render: () => void; api: ObjectEditorApi; onClose: () => void | Promise<void>; onSaved?: (result: KnowledgeSaveEditResult) => void | Promise<void>; onOpenChanges?: (paths: string[]) => void | Promise<void>; onResumeImport?: () => void | Promise<unknown>; onResumeContext?:()=>void|Promise<unknown>; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; flushDraft?: () => Promise<void> };
const RECOVERY = 'gitworld-object-input-v1';
const sameTarget = (a: ObjectEditorTarget, b: ObjectEditorTarget) => JSON.stringify([a.objectId, a.assertionId, a.year, a.observedRevision]) === JSON.stringify([b.objectId, b.assertionId, b.year, b.observedRevision]);
const localErrors = new Set(['nameRequired', 'claimRequired', 'fieldRequired', 'valueRequired', 'entityRequired', 'invalidNumber', 'invalidCoordinate', 'invalidTime', 'sourceRequired', 'httpsRequired', 'locatorRequired', 'reasonRequired']);

export function createObjectEditor(options: Options) {
  let visible = false, loading = false, busy = false, recovered = false, bufferFailed = false, stale = false, baseReviewed = false, searching = false;
  let context: KnowledgeEditContext | null = null, target: ObjectEditorTarget = {}, form = blankObjectEditForm(), baseline = '';
  let errorReason: string | null = null;
  let expectedHead = '', expectedObjectHash: string | null = null, attemptId: string | null = null, error: string | null = null;
  let saved: KnowledgeSaveEditResult | null = null, openSequence = 0, querySequence = 0, searched = false;
  let results: KnowledgeQueryResult['objects'] = [], pending: Promise<boolean> | null = null;
  let confirmation: { kind: 'open'; target: ObjectEditorTarget } | { kind: 'claim'; id: string } | { kind: 'mode'; mode: 'add' | 'correct' } | { kind: 'discard' } | null = null;
  const storage = () => options.storage ?? localStorage;
  const t = (key: Exclude<ObjectEditorCopyKey, 'historicalContext' | 'bce'>) => copy(options.locale(), key);
  const text = (labels: Record<string, string> | undefined, fallback = '') => { const value = knowledgeLocalizedText(labels, options.locale(), fallback); return value.text + (options.locale() === 'zh-CN' && value.language === 'en' ? ' · EN' : ''); };
  const year = (value: number) => value < 0 ? copy(options.locale(), 'bce', { year: -value }) : String(value);
  const fieldName = (id: string) => text(context?.object?.display?.properties[id] ?? context?.catalog.properties.find(value => value.id === id)?.labels) || knowledgeMetadataLabel(id, options.locale()) || id;
  const assertion = () => context?.object?.assertions.find(value => value.id === form.assertionId) ?? null;
  function redraw(preserve = true) {
    if (!visible) return;
    const previous = preserve ? document.querySelector<HTMLElement>('.object-editor') : null;
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement | null;
    const key = previous && active && previous.contains(active) ? ['objectInput', 'objectChange', 'objectEditor'].find(value => value in active.dataset) : undefined;
    const value = key ? active?.dataset[key] : undefined, scroll = previous?.scrollTop ?? 0;
    const selection = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] as const : null;
    options.render();
    const next = document.querySelector<HTMLElement>('.object-editor'); if (next) next.scrollTop = scroll;
    if (key && value && next) {
      const attribute = key === 'objectInput' ? 'data-object-input' : key === 'objectChange' ? 'data-object-change' : 'data-object-editor';
      const control = [...next.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(`[${attribute}]`)].find(element => element.dataset[key] === value && !element.disabled);
      control?.focus({ preventScroll: true });
      if (selection && control && 'setSelectionRange' in control && selection[0] !== null) { try { control.setSelectionRange(selection[0], selection[1]); } catch { /* Numeric inputs do not expose a text selection. */ } }
    }
  }
  const fingerprint = () => JSON.stringify(form);
  const hasUnsavedChanges = () => !saved && (fingerprint() !== baseline || !!attemptId);
  const button = (action: string, label: string, extra = '', primary = false) => `<button type="button" class="object-editor-button${primary ? ' primary' : ''}" data-object-editor="${action}" ${extra}>${esc(label)}</button>`;
  const input = (key: keyof ObjectEditForm, label: string, type = 'text', extra = '') => `<label class="object-editor-field">${esc(label)}<input type="${type}" data-object-input="${key}" value="${esc(form[key])}" ${extra}></label>`;
  const select = (key: keyof ObjectEditForm, label: string, values: [string, string][]) => `<label class="object-editor-field">${esc(label)}<select data-object-change="${key}">${values.map(([id, name]) => `<option value="${esc(id)}" ${form[key] === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
  function cacheInput() {
    if (saved || !expectedHead || !hasUnsavedChanges()) return true;
    try { storage().setItem(RECOVERY, JSON.stringify({ schemaVersion: 1, target, form, expectedHead, expectedObjectHash, attemptId })); bufferFailed = false; return true; }
    catch { bufferFailed = true; return false; }
  }
  function clearRecovery() { try { storage().removeItem(RECOVERY); return true; } catch { bufferFailed = true; return false; } }
  function focusNotice() { const notice = document.querySelector<HTMLElement>('.object-editor-notice[role="alert"]'); notice?.focus({ preventScroll: true }); notice?.scrollIntoView({ block: 'nearest' }); }
  const navigationBlocked=()=>!!error&&errorReason==='navigation-operation-pending';
  const importBlocked = () => !!error && ['paired-import-pending', 'incomplete-paired-import'].includes(errorReason ?? '');
  const failureReason = (cause: unknown) => cause instanceof ServiceFailure && typeof cause.detail.parameters?.reason === 'string' ? cause.detail.parameters.reason : null;
  function fail(cause: unknown) { errorReason = failureReason(cause); error = cause instanceof ServiceFailure ? cause.detail.code : cause instanceof Error ? cause.message : 'IO_ERROR'; redraw(); focusNotice(); }
  function draftActionHtml() { return context && !saved && !loading && !attemptId && hasUnsavedChanges() ? button('discard', t('discard'), busy ? 'disabled' : '') : ''; }
  function updateDraftActions() { const actions = document.querySelector('[data-object-draft-actions]'); if (actions) actions.innerHTML = draftActionHtml(); }
  function valueText(value: KnowledgeValue, id?: string): string {
    const display = id ? knowledgeValueDisplay(value, [id], context?.object ?? null, options.locale()) : null;
    if (display?.text) return display.text;
    if (value.kind === 'text') return value.value;
    if (value.kind === 'entity') return text(context?.object?.display?.objects[value.objectId]?.labels, value.objectId);
    if (value.kind === 'number') return `${new Intl.NumberFormat(options.locale()).format(value.value)}${value.unit ? ` ${knowledgeMetadataLabel(value.unit, options.locale()) ?? value.unit}` : ''}`;
    if (value.kind === 'boolean') return t(value.value ? 'yes' : 'no');
    if (value.kind === 'time') return `${year(value.value.earliestYear)}${value.value.latestYear !== value.value.earliestYear ? `–${year(value.value.latestYear)}` : ''} · ${knowledgeTimeLabel('precision', value.value.precision, options.locale())}${value.value.month ? ` · ${value.value.month}${value.value.day ? `/${value.value.day}` : ''}` : ''}`;
    if (value.kind === 'coordinate') return `${value.latitude}, ${value.longitude}`;
    return t(value.kind === 'raw' ? 'complexValue' : value.kind);
  }
  function claimLabel(value: KnowledgeAssertion) {
    const time = value.validTime?.point ?? value.validTime?.start;
    return `${fieldName(value.propertyId)} · ${valueText(value.value, value.id).slice(0, 90)}${time ? ` · ${year(time.earliestYear)}` : ''}`;
  }
  function currentTimeHtml(value: KnowledgeAssertion | null) {
    if (!value || form.timeMode !== 'keep') return '';
    const scope = value.validTime, part = (time: NonNullable<typeof scope>['point']) => time ? valueText({ kind: 'time', value: time }) : '';
    return `<div class="object-editor-current"><small>${t('currentTime')}</small><p>${esc(scope?.point ? part(scope.point) : [part(scope?.start), part(scope?.end)].filter(Boolean).join(' – ') || t('noTime'))}${scope?.certainty === 'possible' ? ` · ${t('possible')}` : ''}</p></div>`;
  }
  function initialize(mode: 'add' | 'correct', id = '') {
    form = blankObjectEditForm(); form.mode = mode; form.assertionId = id; results = []; searched = false;
    if (target.year !== undefined) form.from = String(target.year);
    const current = assertion();
    if (current) {
      form.propertyId = current.propertyId; form.valueMode = 'keep'; form.timeMode = 'keep';
      const evidence = current.evidence[0]; form.sourceId = evidence?.sourceId ?? current.sourceSnapshotId; form.locator = evidence?.locator ?? ''; form.citation = evidence?.citation ?? '';
    }
    if (context?.sources.length) form.sourceMode = 'existing';
    baseline = fingerprint(); error = current || mode === 'add' || !id ? null : 'CLAIM_MISSING';
  }
  function seedReplacement() {
    const value = assertion()?.value; if (!value || value.kind === 'raw') return;
    form.valueKind = value.kind;
    if (value.kind === 'text') { form.text = value.value.length <= 10_000 ? value.value : ''; form.language = value.language ?? ''; }
    else if (value.kind === 'entity') { form.entityId = value.objectId; form.entityLabel = valueText(value); form.entityQuery = form.entityLabel; }
    else if (value.kind === 'number') { form.number = String(value.value); form.unit = value.unit ?? ''; form.lower = value.lowerBound === undefined ? '' : String(value.lowerBound); form.upper = value.upperBound === undefined ? '' : String(value.upperBound); }
    else if (value.kind === 'boolean') form.boolean = String(value.value) as 'true' | 'false';
    else if (value.kind === 'coordinate') { form.longitude = String(value.longitude); form.latitude = String(value.latitude); }
    else if (value.kind === 'time' && ['year', 'interval'].includes(value.value.precision)) { form.earliest = String(value.value.earliestYear); form.latest = String(value.value.latestYear); }
  }
  async function openTarget(requested: ObjectEditorTarget, resume: boolean): Promise<boolean> {
    if (busy) return false;
    if (visible && (resume || sameTarget(target, requested))) return true;
    if (visible && hasUnsavedChanges()) { if (!attemptId) confirmation = { kind: 'open', target: requested }; redraw(); return false; }
    let recovery: ReturnType<typeof parseObjectEditRecovery> = null;
    try { recovery = parseObjectEditRecovery(storage().getItem(RECOVERY)); } catch { bufferFailed = true; }
    const selected = recovery?.target ?? requested, sequence = ++openSequence; target = structuredClone(selected); visible = true; loading = true; saved = null; error = null; context = null; recovered = !!recovery; stale = false; baseReviewed = false; attemptId = recovery?.attemptId ?? null; confirmation = null;
    form = recovery?.form ?? blankObjectEditForm(); expectedHead = recovery?.expectedHead ?? ''; expectedObjectHash = recovery?.expectedObjectHash ?? null; baseline = recovery ? '' : fingerprint(); redraw(false);
    try {
      const current = await options.api.context(target.objectId); if (sequence !== openSequence) return false;
      context = current; expectedHead = current.head; expectedObjectHash = current.objectHash; initialize(target.assertionId ? 'correct' : 'add', target.assertionId);
      if (recovery) {
        form = recovery.form; expectedHead = recovery.expectedHead; expectedObjectHash = recovery.expectedObjectHash; attemptId = recovery.attemptId; baseline = '';
        stale = current.head !== expectedHead || current.objectHash !== expectedObjectHash;
        if (stale && !attemptId) { error = 'CONTENT_CHANGED'; baseReviewed = true; }
        if (!resume && !sameTarget(selected, requested) && !attemptId) confirmation = { kind: 'open', target: requested };
      }
      return true;
    } catch (cause) {
      if (sequence === openSequence) { if (recovery) { form = recovery.form; expectedHead = recovery.expectedHead; expectedObjectHash = recovery.expectedObjectHash; attemptId = recovery.attemptId; baseline = ''; } fail(cause); }
      return false;
    } finally { if (sequence === openSequence) { loading = false; redraw(); } }
  }
  function open(requested: ObjectEditorTarget = {}) { return openTarget(requested, false); }
  function resume() { return openTarget({}, true); }
  function errorHtml() {
    const key = navigationBlocked()?'pendingContext':importBlocked() ? 'pendingImport' : attemptId && !busy ? 'uncertain' : localErrors.has(error ?? '') ? error as Exclude<ObjectEditorCopyKey, 'historicalContext' | 'bce'> : error === 'CONTENT_CHANGED' || error === 'HEAD_CHANGED' ? 'changed' : error === 'CLAIM_MISSING' ? 'claimMissing' : error === 'REFRESH_FAILED' ? 'refreshFailed' : error === 'SERVICE_UNAVAILABLE' ? 'unavailable' : error ? 'failed' : null;
    return key ? `<div class="object-editor-notice" role="alert" tabindex="-1"><p>${t(key)}</p>${error ? `<details><summary>${t('details')}</summary><code>${esc(error)}</code></details>` : ''}<div class="object-editor-actions">${navigationBlocked()?options.onResumeContext?button('resume-context',t('resumeContext'),busy?'disabled':''):'':importBlocked() ? options.onResumeImport ? button('resume-import', t('resumeImport'), busy ? 'disabled' : '') : '' : attemptId ? button('check-result', t('checkResult'), busy ? 'disabled' : '', true) : stale ? button(baseReviewed ? 'use-base' : 'review-base', t(baseReviewed ? 'useBase' : 'reviewBase'), !context || busy ? 'disabled' : '') : error && !saved && !localErrors.has(error) ? button('retry-load', t('reload'), busy ? 'disabled' : '') : ''}</div></div>` : '';
  }
  function valueFields() {
    if (form.mode === 'correct' && form.valueMode === 'keep') return `<p class="object-editor-muted">${t('preserveValue')}</p>`;
    const units = [...new Set(['', '1', 'km2', ...((context?.object?.assertions ?? []).flatMap(value => value.value.kind === 'number' && value.value.unit ? [value.value.unit] : []))])];
    const kind = select('valueKind', t('valueKind'), ['text', 'entity', 'number', 'boolean', 'time', 'coordinate', 'unknown', 'absent'].map(value => [value, t(value as 'text')]));
    if (form.valueKind === 'text') return kind + `<label class="object-editor-field">${t('textValue')}<textarea data-object-input="text" rows="3" maxlength="10000">${esc(form.text)}</textarea></label>` + input('language', t('language'), 'text', 'maxlength="35"');
    if (form.valueKind === 'number') return kind + `<div class="object-editor-row">${input('number', t('numericValue'), 'number', 'step="any"')}${select('unit', t('unit'), units.map(id => [id, id ? knowledgeMetadataLabel(id, options.locale()) ?? id : t('noUnit')]))}${input('lower', t('lower'), 'number', 'step="any"')}${input('upper', t('upper'), 'number', 'step="any"')}</div>`;
    if (form.valueKind === 'boolean') return kind + select('boolean', t('boolean'), [['true', t('yes')], ['false', t('no')]]);
    if (form.valueKind === 'time') return kind + `<div class="object-editor-row">${input('earliest', t('earliest'), 'text', 'inputmode="numeric" maxlength="12"')}${input('latest', t('latest'), 'text', 'inputmode="numeric" maxlength="12"')}</div><p class="object-editor-muted">${t('yearPrecision')}</p>`;
    if (form.valueKind === 'coordinate') return kind + `<div class="object-editor-row">${input('longitude', t('longitude'), 'number', 'step="any" min="-180" max="180"')}${input('latitude', t('latitude'), 'number', 'step="any" min="-90" max="90"')}</div>`;
    if (form.valueKind === 'entity') return kind + `<div class="object-editor-search">${input('entityQuery', t('entityQuery'), 'text', 'maxlength="500"')}${button('search-entity', t(searching ? 'searching' : 'search'), searching ? 'disabled' : '')}</div>${form.entityId ? `<p>${esc(form.entityLabel)}</p>` : `<p class="object-editor-muted">${t('chooseEntity')}</p>`}<div class="object-editor-results">${results.map(value => button('entity', text(value.labels, value.id), `data-id="${esc(value.id)}"`)).join('')}${searched && !results.length && !searching ? `<p>${t('noEntities')}</p>` : ''}</div>`;
    return kind;
  }
  function sourceChoiceHtml() {
    const source = context?.sources.find(value => value.id === form.sourceId), original = source ? knowledgeSourceName(source, options.locale()).originalTitle : null;
    const choices = (context?.sources ?? []).map(value => { const name = knowledgeSourceName(value, options.locale()); return [value.id, name.text + (options.locale() === 'zh-CN' && /^en(?:-|$)/i.test(name.language ?? '') ? ' · EN' : '')] as [string, string]; });
    return select('sourceId', t('source'), [['', t('chooseSource')], ...choices]) + (original ? `<details class="object-editor-source-title"><summary>${esc(knowledgeDisplayCopy('originalSourceTitle', options.locale()))}</summary><p${original.language ? ` lang="${esc(original.language)}"` : ''}>${esc(original.text)}${options.locale() === 'zh-CN' && /^en(?:-|$)/i.test(original.language ?? '') ? ' · EN' : ''}</p></details>` : '');
  }
  function formHtml() {
    const fields = new Map((context?.catalog.properties ?? []).map(value => [value.id, text(value.labels, value.id)])); if (form.propertyId && !fields.has(form.propertyId)) fields.set(form.propertyId, fieldName(form.propertyId));
    for (const [id, labels] of Object.entries(context?.object?.display?.properties ?? {})) fields.set(id, text(labels, id));
    for (const claim of context?.object?.assertions ?? []) if (!fields.has(claim.propertyId)) fields.set(claim.propertyId, fieldName(claim.propertyId));
    const current = assertion(), claims = context?.object?.assertions ?? [];
    const claimSelector = form.mode === 'correct' ? select('assertionId', t('claim'), [['', t('chooseClaim')], ...claims.map(value => [value.id, claimLabel(value)] as [string, string])]) : '';
    return `<form data-object-form novalidate><fieldset ${busy || attemptId ? 'disabled' : ''}>${context?.object && claims.length ? select('mode', t('action'), [['add', t('add')], ['correct', t('correct')]]) : ''}${!context?.object ? `<section class="object-editor-section"><h2>${t('newObject')}</h2><div class="object-editor-row">${input('nameEn', t('nameEn'), 'text', 'maxlength="500"')}${input('nameZh', t('nameZh'), 'text', 'maxlength="500"')}</div>${select('typeId', t('type'), [['', t('noType')], ...(context?.catalog.types ?? []).map(value => [value.id, text(value.labels, value.id)] as [string, string])])}</section>` : ''}${claimSelector}${form.mode === 'correct' && !current ? `<p>${t('chooseClaim')}</p>` : `<section class="object-editor-section">${select('propertyId', t('field'), [['', t('chooseField')], ...fields])}${current ? `<div class="object-editor-current"><small>${t('currentValue')}</small><p>${esc(valueText(current.value, current.id))}</p></div>${select('valueMode', t('valueChange'), [['keep', t('keepValue')], ['replace', t('replaceValue')]])}` : ''}${valueFields()}</section><section class="object-editor-section"><h2>${t('applicability')}</h2>${select('timeMode', t('timeMode'), [...(form.mode === 'correct' ? [['keep', t('keepTime')] as [string, string]] : []), ['none', t('noTime')], ['point', t('pointTime')], ['range', t('rangeTime')]])}${currentTimeHtml(current)}${form.timeMode === 'point' || form.timeMode === 'range' ? `<div class="object-editor-row">${input('from', t('from'), 'text', 'inputmode="numeric" maxlength="12"')}${form.timeMode === 'range' ? input('to', t('to'), 'text', 'inputmode="numeric" maxlength="12"') : ''}</div><label class="object-editor-checkbox"><input type="checkbox" data-object-change="possible" ${form.possible ? 'checked' : ''}>${t('possible')}</label><p class="object-editor-muted">${t('yearPrecision')}</p>` : ''}</section><section class="object-editor-section"><h2>${t('evidence')}</h2>${select('sourceMode', t('evidenceMode'), [...(context?.sources.length ? [['existing', t('existingSource')] as [string, string]] : []), ['citation', t('newCitation')]])}${form.sourceMode === 'existing' ? sourceChoiceHtml() : `${input('sourceTitle', t('sourceTitle'), 'text', 'maxlength="500"')}${input('sourceUrl', t('sourceUrl'), 'url', 'maxlength="2000"')}`}${input('locator', t('locator'), 'text', 'maxlength="2000"')}<label class="object-editor-field">${t('citation')}<textarea data-object-input="citation" rows="2" maxlength="2000">${esc(form.citation)}</textarea></label></section><section class="object-editor-section"><label class="object-editor-field">${t('reason')}<textarea data-object-input="reason" rows="3" maxlength="2000">${esc(form.reason)}</textarea></label>${select('review', t('review'), [['unreviewed', t('unreviewed')], ['adopted', t('reviewed')]])}</section><div class="object-editor-actions"><button type="submit" class="object-editor-button primary" ${stale ? 'disabled' : ''}>${t(busy ? 'saving' : 'save')}</button></div>`}</fieldset></form>`;
  }
  function content() {
    const title = loading ? t('loading') : context?.object ? text(context.object.object.labels, target.objectId) : t('newObject');
    const mode = loading && target.assertionId ? 'correct' : form.mode;
    return `<section class="object-editor"><header class="object-editor-heading"><div><h1>${t(mode === 'correct' ? 'correct' : 'add')} · ${esc(title)}</h1><p>${t('working')}${expectedHead ? ` · <code>${esc(expectedHead.slice(0, 8))}</code>` : ''}</p>${target.observedRevision && target.observedRevision !== 'working' ? `<p>${esc(copy(options.locale(), 'historicalContext', { year: target.year !== undefined ? year(target.year) : t('noHistoricalTime'), revision: target.observedRevision.slice(0, 8) }))}</p>` : ''}</div><div class="object-editor-actions"><span data-object-draft-actions>${draftActionHtml()}</span>${button('close', t('close'), busy ? 'disabled' : '')}</div></header>${recovered && !saved ? `<p class="object-editor-muted">${t('recovered')}</p>` : ''}${bufferFailed ? `<div class="object-editor-notice" role="alert" tabindex="-1">${t('draftFailed')}${button('cache-retry', t('retry'))}</div>` : ''}${errorHtml()}${confirmation ? `<div class="object-editor-notice" role="dialog" aria-labelledby="object-confirm-message"><p id="object-confirm-message">${t(confirmation.kind === 'discard' ? 'discardPrompt' : 'replacePrompt')}</p><div class="object-editor-actions">${button('confirm-replace', t(confirmation.kind === 'discard' ? 'discard' : 'replaceDraft'), busy ? 'disabled' : '')}${button('cancel-replace', t('keepDraft'), busy ? 'disabled' : '')}</div></div>` : ''}${loading ? `<p role="status">${t('loading')}</p>` : saved ? `<section class="object-editor-saved"><h2>${t('saved')}</h2><p>${t('savedDetail')}</p><div class="object-editor-actions">${options.onOpenChanges ? button('changes', t('changes'), '', true) : ''}${button('close', t('close'))}</div></section>` : context ? formHtml() : ''}</section>`;
  }
  async function searchEntities() {
    const query = form.entityQuery.trim(); if (!query) { results = []; searched = true; redraw(); return; }
    const sequence = ++querySequence; searching = true; searched = true; redraw();
    try { const found = await options.api.query({ text: query, includeUndated: true, includeUnlocated: true, limit: 20 }); if (sequence === querySequence && query === form.entityQuery.trim()) results = found.objects; }
    catch (cause) { if (sequence === querySequence) fail(cause); }
    finally { if (sequence === querySequence) { searching = false; redraw(); document.querySelector<HTMLElement>(results.length ? '[data-object-editor="entity"]' : '[data-object-input="entityQuery"]')?.focus({ preventScroll: true }); } }
  }
  async function save(): Promise<boolean> {
    if (pending) return pending; if (saved) return true; if (confirmation || stale && !attemptId) return false;
    errorReason = null;
    const parsed = parseObjectEditForm(form, !!target.objectId); if (!parsed.ok) { error = parsed.code; redraw(); focusNotice(); return false; }
    if (!expectedHead) return false;
    const newAttempt = !attemptId; attemptId ??= crypto.randomUUID(); if (!cacheInput()) { if (newAttempt) attemptId = null; redraw(); return false; }
    const request: KnowledgeSaveEditRequest = { operationId: attemptId, expectedHead, expectedObjectHash, ...(target.objectId ? { objectId: target.objectId } : {}), ...(form.mode === 'correct' ? { assertionId: form.assertionId } : {}), change: parsed.change };
    busy = true; error = null; redraw();
    pending = (async () => {
      try {
        try { await options.flushDraft?.(); } catch { if (newAttempt) { attemptId = null; cacheInput(); } bufferFailed = true; return false; }
        const result = await options.api.save(request); saved = result; attemptId = null; clearRecovery(); baseline = fingerprint(); recovered = false;
        try { await options.onSaved?.(result); } catch { error = 'REFRESH_FAILED'; }
        return true;
      } catch (cause) {
        const code = cause instanceof ServiceFailure ? cause.detail.code : cause instanceof Error ? cause.message : 'IO_ERROR';
        if (!['IO_ERROR', 'SERVICE_UNAVAILABLE'].includes(code)) attemptId = null;
        if (code === 'HEAD_CHANGED' || code === 'CONTENT_CHANGED') { stale = true; baseReviewed = false; }
        errorReason = failureReason(cause); error = code; cacheInput(); return false;
      } finally { busy = false; pending = null; redraw(); if (error || bufferFailed) focusNotice(); }
    })(); return pending;
  }
  async function click(element: HTMLElement) {
    const action = element.dataset.objectEditor; if (busy) return;
    if(action==='resume-context'&&navigationBlocked()){try{await options.onResumeContext?.();}catch(cause){fail(cause);}}
    else if (action === 'resume-import' && importBlocked()) { try { await options.onResumeImport?.(); } catch (cause) { fail(cause); } }
    else if (action === 'close') await close();
    else if (action === 'discard' && !attemptId && hasUnsavedChanges()) { confirmation = { kind: 'discard' }; redraw(); const cancel = document.querySelector<HTMLButtonElement>('[data-object-editor="cancel-replace"]'); cancel?.focus({ preventScroll: true }); cancel?.scrollIntoView({ block: 'nearest' }); }
    else if (action === 'check-result') await save();
    else if (action === 'search-entity') await searchEntities();
    else if (action === 'entity') { const value = results.find(value => value.id === element.dataset.id); if (value) { form.entityId = value.id; form.entityLabel = text(value.labels, value.id); form.entityQuery = form.entityLabel; results = []; searched = false; cacheInput(); redraw(); document.querySelector<HTMLElement>('[data-object-input="entityQuery"]')?.focus({ preventScroll: true }); } }
    else if (action === 'changes' && saved) await options.onOpenChanges?.(saved.paths);
    else if (action === 'cache-retry') { if (cacheInput()) { try { await options.flushDraft?.(); bufferFailed = false; } catch { bufferFailed = true; } } redraw(); }
    else if (action === 'review-base' && !attemptId) {
      try { context = await options.api.context(target.objectId); baseReviewed = true; redraw(); } catch (cause) { fail(cause); }
    } else if (action === 'use-base' && !attemptId && context && baseReviewed) {
      if (form.mode === 'correct' && !assertion()) { error = 'CLAIM_MISSING'; redraw(); return; }
      expectedHead = context.head; expectedObjectHash = context.objectHash; stale = false; baseReviewed = false; error = null; cacheInput(); redraw();
    } else if (action === 'retry-load' && !attemptId) { confirmation = { kind: 'open', target }; redraw(); }
    else if (action === 'cancel-replace') dismissConfirmation();
    else if (action === 'confirm-replace' && confirmation && !attemptId) {
      const chosen = confirmation; confirmation = null;
      if (chosen.kind === 'open') { clearRecovery(); baseline = fingerprint(); visible = false; await open(chosen.target); }
      else if (chosen.kind === 'discard') {
        if (!clearRecovery()) { redraw(); focusNotice(); return; }
        busy = true; redraw();
        pending = (async () => {
          try { await options.flushDraft?.(); baseline = fingerprint(); recovered = false; hide(); return true; }
          catch { cacheInput(); bufferFailed = true; return false; }
          finally { busy = false; pending = null; redraw(); if (bufferFailed) focusNotice(); }
        })();
        if (await pending) await options.onClose();
      }
      else { initialize(chosen.kind === 'mode' ? chosen.mode : 'correct', chosen.kind === 'claim' ? chosen.id : ''); cacheInput(); redraw(); }
    }
  }
  function inputChanged(element: HTMLInputElement | HTMLTextAreaElement) {
    if (busy || attemptId || saved) return;
    const key = element.dataset.objectInput as keyof ObjectEditForm;
    if (!key || !(key in form) || typeof form[key] !== 'string') return;
    (form as unknown as Record<string, unknown>)[key] = element.value;
    if (key === 'entityQuery') { form.entityId = ''; form.entityLabel = ''; querySequence++; results = []; searching = false; }
    cacheInput(); updateDraftActions();
  }
  function change(element: HTMLInputElement | HTMLSelectElement) {
    if (busy || attemptId || saved) return;
    const key = element.dataset.objectChange as keyof ObjectEditForm;
    if (key === 'mode' || key === 'assertionId') {
      if (hasUnsavedChanges()) confirmation = key === 'mode' ? { kind: 'mode', mode: element.value === 'correct' ? 'correct' : 'add' } : { kind: 'claim', id: element.value };
      else initialize(key === 'mode' ? element.value === 'correct' ? 'correct' : 'add' : 'correct', key === 'assertionId' ? element.value : '');
    } else if (key === 'possible' && 'checked' in element) { form.possible = element.checked; cacheInput(); }
    else if (key && key in form && typeof form[key] === 'string') { (form as unknown as Record<string, unknown>)[key] = element.value; if (key === 'valueMode' && form.valueMode === 'replace') seedReplacement(); cacheInput(); }
    redraw();
  }
  async function prepareClose(): Promise<ClosePreparationResult> { if (pending) await pending; if (!cacheInput()) return { ready: false, reason: 'unsaved-input' }; try { await options.flushDraft?.(); } catch { bufferFailed = true; redraw(); return { ready: false, reason: 'unsaved-input' }; } return { ready: true }; }
  async function close() { const result = await prepareClose(); if (result.ready) { hide(); await options.onClose(); } }
  function dismissConfirmation() { const kind = confirmation?.kind; confirmation = null; redraw(); const selector = kind === 'discard' ? '[data-object-editor="discard"]' : kind === 'claim' ? '[data-object-change="assertionId"]' : kind === 'mode' ? '[data-object-change="mode"]' : '[data-object-editor="close"]'; document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }); }
  function hide() { cacheInput(); visible = false; openSequence++; querySequence++; }
  function key(event: KeyboardEvent) { if (event.key === 'Enter' && (event.target as HTMLElement | null)?.dataset.objectInput === 'entityQuery') { event.preventDefault(); if (!confirmation && !busy && !attemptId) void searchEntities(); } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!confirmation) void save(); } else if (event.key === 'Escape') { event.preventDefault(); if (confirmation) dismissConfirmation(); else if (!busy) void close(); } }
  return { open, resume, content, click, input: inputChanged, change, submit: (submitted?: HTMLFormElement) => submitted && submitted.dataset.objectForm === undefined ? Promise.resolve(false) : save(), key, save, hasUnsavedChanges, prepareClose, hide };
}
