import type { HistoryLocale } from '@gitworld/domain';
import type { ClosePreparationResult, NavigationApplyResult, NavigationBatchObjects, NavigationBatchSources, NavigationBatchPage, NavigationBatchRef, NavigationBatchSummary, NavigationContextList, NavigationContextRead, NavigationMembershipPlan, NavigationPendingOperation, NavigationPlanPage, NavigationResumeResult, NavigationSaveResult, ServiceMethods } from '@gitworld/contracts';
import { escapeHtml as esc, ServiceFailure } from './client.ts';
import { contextCopy as copy, type ContextCopyKey } from './context-copy.ts';
import { knowledgeLocalizedText } from './knowledge-labels.ts';

export type ContextWorkspaceTarget = { contextId?: string; batch?: NavigationBatchRef; planId?: string; mode?: 'add' | 'remove'; importIdentity?:{inputHash:string;previewId?:string} };
export type ContextWorkspaceApi = { [K in 'list' | 'get' | 'save' | 'batches' | 'batchObjects' | 'batchSources' | 'membershipPlan' | 'plan' | 'applyMembership' | 'pending' | 'resume']: (input: ServiceMethods[`context.${K}`]['params']) => Promise<ServiceMethods[`context.${K}`]['result']> };
type Options = { locale: () => HistoryLocale; render: () => void; api: ContextWorkspaceApi; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; flushDraft?: () => Promise<void>; onClose: () => void | Promise<unknown>; onChanged?: (result: NavigationSaveResult | NavigationApplyResult) => void | Promise<unknown>; onViewContext?: (contextId: string) => void | Promise<unknown>; onOpenChanges?: (paths: string[]) => void | Promise<unknown>; onResumeImport?: () => void | Promise<unknown> };
type Draft = { schemaVersion: 1; target: ContextWorkspaceTarget; language: HistoryLocale; name: string; purpose: string; rationale: string; mode: 'add' | 'remove'; selectedBatch: NavigationBatchRef | null; planId: string | null; attemptId: string | null; baseline?:string };
const KEY = 'gitworld-context-input-v1';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function parseContextInput(raw: string | null): Draft | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const v = JSON.parse(raw);
    if (!object(v) || v.schemaVersion !== 1 || !object(v.target) || !['en', 'zh-CN'].includes(String(v.language)) || typeof v.name !== 'string' || v.name.length > 500 || typeof v.purpose !== 'string' || v.purpose.length > 5000 || typeof v.rationale !== 'string' || v.rationale.length > 5000 || !['add', 'remove'].includes(String(v.mode)) || !(v.planId === null || typeof v.planId === 'string') || !(v.attemptId === null || typeof v.attemptId === 'string')) return null;
    if (v.target.contextId !== undefined && (typeof v.target.contextId !== 'string' || v.target.contextId.length > 1000)) return null;
    if (v.selectedBatch !== null && (!object(v.selectedBatch) || !['saved-source', 'adopted-import'].includes(String(v.selectedBatch.kind)) || typeof v.selectedBatch.objectSetHash !== 'string')) return null;
    return v as Draft;
  } catch { return null; }
}

export function createContextWorkspace(options: Options) {
  const blank = (target: ContextWorkspaceTarget = {}): Draft => ({ schemaVersion: 1, target: structuredClone(target), language: options.locale(), name: '', purpose: '', rationale: '', mode: target.mode ?? 'add', selectedBatch: target.batch ?? null, planId: target.planId ?? null, attemptId: null });
  let draft = blank(), baseline = JSON.stringify([options.locale(), '', '', '']), visible = false, busy = false, loading = false, bufferFailed = false;
  let contexts: NavigationContextList | null = null, current: NavigationContextRead | null = null, batches: NavigationBatchPage | null = null;
  let pins:NavigationBatchSources|null=null;
  let plan: NavigationMembershipPlan | null = null, members: NavigationPlanPage | NavigationBatchObjects | null = null;
  let pendingOperations: NavigationPendingOperation[] = [], saved: NavigationSaveResult | NavigationApplyResult | null = null;
  let error: string | null = null, reason: string | null = null, retry: (() => Promise<unknown>) | null = null, search = '';
  let sequence = 0, contextSequence=0,batchSequence=0,pinsSequence=0,memberSequence = 0, pendingWrite: Promise<void> | null = null;
  let confirmation: { kind: 'discard' } | { kind: 'replace'; target: ContextWorkspaceTarget } | null = null;
  const text = (labels: Record<string, string>, fallback = '') => { const value = knowledgeLocalizedText(labels, options.locale(), fallback); return value.text + (options.locale() === 'zh-CN' && /^en(?:-|$)/i.test(value.language ?? '') ? ' · EN' : ''); };
  const t = (key: Exclude<ContextCopyKey, 'batchCounts' | 'unresolved' | 'planCounts' | 'page' | 'changedPaths'|'member'|'sourcePinCount'>) => copy(options.locale(), key);
  const button = (action: string, label: string, extra = '', primary = false) => `<button type="button" class="context-button${primary ? ' primary' : ''}" data-context="${action}" ${extra}>${esc(label)}</button>`;
  function redraw() {
    if (!visible) return;
    const root = document.querySelector<HTMLElement>('.context-workspace'), active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    const key = root && active && root.contains(active) ? active.dataset.contextInput ?? active.dataset.context : undefined;
    const opened=[...root?.querySelectorAll<HTMLDetailsElement>('[data-context-disclosure][open]')??[]].map(value=>value.dataset.contextDisclosure);
    const start = active && 'selectionStart' in active ? active.selectionStart : null, end = active && 'selectionEnd' in active ? active.selectionEnd : null, scroll = root?.querySelector<HTMLElement>('.context-workspace-body')?.scrollTop ?? 0;
    options.render();
    const next = document.querySelector<HTMLElement>('.context-workspace');if(next){for(const id of opened){const node=[...next.querySelectorAll<HTMLDetailsElement>('[data-context-disclosure]')].find(value=>value.dataset.contextDisclosure===id);if(node)node.open=true;}const body=next.querySelector<HTMLElement>('.context-workspace-body');if(body)body.scrollTop=scroll;}
    if (key && next) {
      const node = [...next.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-context-input],[data-context]')].find(value => (value.dataset.contextInput ?? value.dataset.context) === key && !value.disabled);
      node?.focus({ preventScroll: true });
      if (node && 'setSelectionRange' in node && start !== null) try { node.setSelectionRange(start, end); } catch { /* Select controls do not have text ranges. */ }
    }
  }
  const hasUnsavedChanges = () => !!draft.attemptId || JSON.stringify([draft.language, draft.name, draft.purpose, draft.rationale]) !== baseline;
  function cacheInput() {
    try {
      draft.baseline=baseline;
      if (hasUnsavedChanges() || draft.selectedBatch || draft.planId) options.storage.setItem(KEY, JSON.stringify(draft));
      else options.storage.removeItem(KEY);
      bufferFailed = false; return true;
    } catch { bufferFailed = true; return false; }
  }
  function failure(cause: unknown, action?: () => Promise<unknown>) {
    const detail = cause instanceof ServiceFailure ? cause.detail : object(cause) ? cause : {};
    error = typeof detail.code === 'string' ? detail.code : cause instanceof Error ? cause.message : 'IO_ERROR';
    reason = object(detail.parameters) && typeof detail.parameters.reason === 'string' ? detail.parameters.reason : null;
    retry = action ?? (['CONFLICT','CONTENT_CHANGED','HEAD_CHANGED','STALE_REVISION'].includes(error)&&draft.target.contextId?async()=>{await chooseContext(draft.target.contextId!,true);await loadContexts();invalidatePlan();error=null;reason=null;redraw();}:null); redraw();
  }
  const blockedImport = () => ['paired-import-pending', 'incomplete-paired-import'].includes(reason ?? '');
  const blockedNavigation = () => reason === 'navigation-operation-pending' || pendingOperations.length > 0;
  function errorHtml() {
    if (!error && !bufferFailed && (!draft.attemptId || busy) && !pendingOperations.length) return '';
    const key = bufferFailed||error==='INPUT_NOT_SAVED' ? 'inputFailed' : draft.attemptId && !busy ? 'unknownResult' : blockedImport() ? 'importPending' : blockedNavigation() ? 'pending' : ['CONFLICT','CONTENT_CHANGED', 'STALE_REVISION', 'HEAD_CHANGED'].includes(error ?? '') ? 'stale' : error === 'nameRequired' || error === 'targetRequired' || error === 'batchRequired' ? error : error==='REFRESH_FAILED'?'refreshFailed':'failed';
    return `<section class="context-notice" role="alert" tabindex="-1"><p>${t(key)}</p>${error ? `<details class="context-meta"><summary>${t('errorCode')}</summary><code>${esc(error)}${reason ? ` · ${esc(reason)}` : ''}</code></details>` : ''}<div class="context-actions">${draft.attemptId ? button('check', t('check'), busy ? 'disabled' : '') : retry ? button('retry', t('retry'), busy ? 'disabled' : '') : bufferFailed||error==='INPUT_NOT_SAVED' ? button('flush', t('retry')) : ''}${blockedImport() && options.onResumeImport ? button('imports', t('imports')) : ''}</div>${pendingOperations.map(operation => `<div class="context-actions"><span>${t(operation.kind === 'save' ? 'pendingSave' : 'pendingMembership')}</span>${button('resume', t('resume'), `data-operation="${esc(operation.operationId)}" ${busy ? 'disabled' : ''}`)}</div>`).join('')}</section>`;
  }
  function definitionHtml() {
    return `<form class="context-definition" data-context-form="definition" novalidate><label class="context-field compact">${t('language')}<select data-context-input="language" ${busy || loading || draft.attemptId || confirmation ? 'disabled' : ''}><option value="en" ${draft.language === 'en' ? 'selected' : ''}>English</option><option value="zh-CN" ${draft.language === 'zh-CN' ? 'selected' : ''}>简体中文</option></select></label><label class="context-field">${t('name')}<input data-context-input="name" value="${esc(draft.name)}" maxlength="300" ${busy || loading || draft.attemptId || confirmation ? 'disabled' : ''}></label><label class="context-field">${t('purpose')}<textarea data-context-input="purpose" maxlength="4000" ${busy || loading || draft.attemptId || confirmation ? 'disabled' : ''}>${esc(draft.purpose)}</textarea></label><div class="context-actions"><button class="context-button primary" type="submit" ${busy || loading || draft.attemptId || pendingOperations.length ? 'disabled' : ''}>${t(current ? 'save' : 'create')}</button></div></form>`;
  }
  function pages(action: string, value: { offset: number; limit: number; total: number; items?: unknown[] }, count = value.items?.length ?? 0) {
    if (!value.total||value.total<=value.limit&&value.offset===0) return '';
    return `<div class="context-pages">${button(action, t('previous'), `data-offset="${Math.max(0, value.offset - value.limit)}" ${value.offset === 0 || busy ? 'disabled' : ''}`)}<span>${copy(options.locale(), 'page', { from: value.offset + 1, to: Math.min(value.total, value.offset + count), total: value.total })}</span>${button(action, t('next'), `data-offset="${value.offset + value.limit}" ${value.offset + value.limit >= value.total || busy ? 'disabled' : ''}`)}</div>`;
  }
  const selectionName = (batch: NavigationBatchRef) => t(batch.kind === 'adopted-import' ? 'adopted' : batch.selection === 'source-claim-subjects' ? 'subjects' : 'related');
  function batchDetails(batch: NavigationBatchRef) {
    return `<details class="context-meta"><summary>${t('details')}</summary><p>${selectionName(batch)}</p><dl>${Object.entries(batch).map(([key, value]) => `<dt>${esc(key)}</dt><dd><code>${esc(String(value))}</code></dd>`).join('')}</dl></details>`;
  }
  function membershipHtml() {
    if (!current) return '';
    return `<section><h2>${t('membership')}</h2><p>${t('organization')}</p><div class="context-actions">${button('mode-add', t('addMaterial'), `aria-pressed="${draft.mode === 'add'}" ${busy ? 'disabled' : ''}`)}${button('mode-remove', t('removeMaterial'), `aria-pressed="${draft.mode === 'remove'}" ${busy ? 'disabled' : ''}`)}</div><h2>${t('batches')}</h2>${batches?.items.length ? `<div class="context-batches">${batches.items.map((value, index) => `<button type="button" class="context-batch" data-context="batch" data-index="${index}" aria-pressed="${same(value.batch, draft.selectedBatch)}" ${busy || loading || draft.attemptId || value.status !== 'complete' ? 'disabled' : ''}><strong>${esc(text(value.labels))}</strong><small>${selectionName(value.batch)}</small><small>${copy(options.locale(), 'batchCounts', { objects: value.objects, direct: value.directObjects, related: value.relatedObjects })}</small><small>${copy(options.locale(),'sourcePinCount',{count:value.sourceRefCount})}</small>${value.unresolvedObjects ? `<small>${copy(options.locale(), 'unresolved', { count: value.unresolvedObjects })}</small>` : ''}${value.status === 'unavailable' ? `<small>${t(value.reason === 'missing-objects' ? 'missingObjects' : value.reason === 'import-conflicts' ? 'importConflicts' : value.reason === 'incomplete-import-result' ? 'incompleteResult' : 'originUnavailable')}</small>` : ''}</button>`).join('')}</div>${pages('batches-page', batches)}` : `<p>${t(loading ? 'working' : 'noBatches')}</p>`}${draft.selectedBatch ? `${batchDetails(draft.selectedBatch)}${button('source-pins',t('sourcePins'))}${pinsHtml()}<p>${t('completeSet')}</p><label class="context-field">${t('rationale')}<textarea data-context-input="rationale" maxlength="4000" ${busy || loading || draft.attemptId || confirmation ? 'disabled' : ''}>${esc(draft.rationale)}</textarea></label><div class="context-actions">${button('preview', t('preview'), busy || loading || draft.attemptId || pendingOperations.length ? 'disabled' : '', true)}${button('batch-objects', t('batchObjects'), busy ? 'disabled' : '')}</div>` : ''}${planHtml()}</section>`;
  }
  function planHtml() {
    const objects = members?.items ?? [];
    return `${plan ? `<section class="context-plan" tabindex="-1"><h2>${t('plan')}</h2><p>${copy(options.locale(), 'planCounts', plan.counts)}</p><p class="context-meta"><code>${esc(plan.baseHead.slice(0, 8))}</code></p>${plan.dependencies.length ? `<details class="context-meta"><summary>${t('details')} · ${plan.dependencies.length}</summary>${plan.dependencies.map(value => `<p><code>${esc(value)}</code></p>`).join('')}</details>` : ''}<div class="context-actions">${plan.counts.added + plan.counts.removed ? button('apply', t('confirm'), busy || loading || draft.attemptId || pendingOperations.length ? 'disabled' : '', true) : `<span>${t('noMembershipChanges')}</span>`}</div></section>` : ''}${members ? `<section><h2>${t('members')}</h2><ul class="context-object-list">${objects.map(value => `<li>${esc(text(value.labels, value.id))}<small> · ${t(value.basis === 'direct' ? 'directObject' : 'relatedObject')}</small></li>`).join('')}</ul>${pages('members-page', members)}</section>` : ''}`;
  }
  function pinsHtml(){return pins?`<details class="context-meta" open data-context-disclosure="pins"><summary>${t('sourcePins')} · ${new Intl.NumberFormat(options.locale()).format(pins.total)}</summary>${pins.items.map(value=>`<p><code>${esc(value.sourceId)}</code><br><code>${esc(value.revision??'')} · ${esc(value.contentHash)}</code>${value.locator?`<br><code>${esc(value.locator)}</code>`:''}</p>`).join('')}${pages('pins-page',pins)}</details>`:'';}
  async function loadPins(offset=0){if(!draft.selectedBatch)return;const batch=structuredClone(draft.selectedBatch),read=++pinsSequence;try{const value=await options.api.batchSources({batch,offset,limit:10});if(visible&&read===pinsSequence&&same(batch,draft.selectedBatch)){pins=value;redraw();}}catch(cause){if(read===pinsSequence)failure(cause,()=>loadPins(offset));}}
  function membershipBasisHtml(){
    if(!current?.total)return '';
    return `<details class="context-meta" data-context-disclosure="members"><summary>${t('membershipBasis')} · ${new Intl.NumberFormat(options.locale()).format(current.total)}</summary>${current.members.map((value,index)=>`<article class="context-membership-basis"><strong>${copy(options.locale(),'member',{number:current!.offset+index+1})}</strong><p>${t(value.decision.kind==='manual'?'userOrganization':'sourceProfile')}${value.decision.rationale?` · ${esc(value.decision.rationale)}`:''}</p><p>${value.batchRef.kind==='trusted-bundle'?t('bundledBasis'):selectionName(value.batchRef)}</p><details><summary>${t('details')}</summary><code>${esc(value.objectId)}</code><p>${esc(value.decision.recordedAt)}</p>${value.decision.profile?`<p><code>${esc(value.decision.profile.id)} · ${esc(value.decision.profile.version)}</code></p>`:''}${batchDetailsForMembership(value.batchRef)}${(value.sourceRefs??[]).map(source=>`<p><code>${esc(source.sourceId)}</code><br><code>${esc(source.revision??'')} · ${esc(source.contentHash)}</code>${source.locator?`<br><code>${esc(source.locator)}</code>`:''}</p>`).join('')}</details></article>`).join('')}${pages('basis-page',{...current,items:current.members})}</details>`;
  }
  function batchDetailsForMembership(value:NonNullable<typeof current>['members'][number]['batchRef']){return `<dl>${Object.entries(value).map(([key,item])=>`<dt>${esc(key)}</dt><dd><code>${esc(String(item))}</code></dd>`).join('')}</dl>`;}
  async function loadBasis(offset:number){if(!current)return;const s=sequence,id=current.definition.id;try{const page=await options.api.get({contextId:id,revision:current.revision,offset,limit:10});if(s===sequence&&visible&&current?.definition.id===id){current=page;redraw();}}catch(cause){if(s===sequence)failure(cause,()=>loadBasis(offset));}}
  function targetPickerHtml(){
    if(!current&&!contexts?.total)return '';
    const picker=`<section><div class="context-actions"><h2>${t('target')}</h2>${button('new-target',t('newTarget'),busy||loading||draft.attemptId?'disabled':'')}</div><form class="context-actions" data-context-form="search"><label class="context-field"><span>${t('findContext')}</span><input data-context-input="search" value="${esc(search)}" maxlength="300"></label><button class="context-button" type="submit">${t('search')}</button></form><label class="context-field">${t('chooseContext')}<select data-context-input="target" ${busy || loading || draft.attemptId || confirmation ? 'disabled' : ''}><option value="">${t('chooseContext')}</option>${current && !contexts?.items.some(value => value.definition.id === current!.definition.id) ? `<option value="${esc(current.definition.id)}" selected>${esc(text(current.definition.labels))}</option>` : ''}${contexts?.items.map(value => `<option value="${esc(value.definition.id)}" ${current?.definition.id === value.definition.id ? 'selected' : ''}>${esc(text(value.definition.labels))} (${new Intl.NumberFormat(options.locale()).format(value.members)})</option>`).join('') ?? ''}</select></label>${contexts ? pages('contexts-page', contexts) : ''}</section>`;
    return current?`<details class="context-meta context-target-picker" data-context-disclosure="target"><summary>${t('target')} · ${esc(text(current.definition.labels))}</summary>${picker}</details>`:picker;
  }
  function focusResult(selector:string){const element=document.querySelector<HTMLElement>(selector);element?.focus({preventScroll:true});element?.scrollIntoView({block:'nearest'});}
  function content() {
    if (!visible) return '';
    return `<main class="context-workspace"><header><div><h1>${current ? esc(text(current.definition.labels)) : t('newContext')}</h1>${hasUnsavedChanges() || saved ? `<small>${hasUnsavedChanges() ? t('draft') : t('saved')}</small>` : ''}</div><div class="context-actions">${hasUnsavedChanges() && !draft.attemptId ? button('discard', t('discard'), busy ? 'disabled' : '') : ''}${button('close', t('close'))}</div></header><div class="context-workspace-body">${confirmation ? `<section class="context-notice context-confirmation" role="alertdialog" aria-modal="false" aria-labelledby="context-confirm-title"><h2 id="context-confirm-title">${t(confirmation.kind === 'replace' ? 'replace' : 'discardTitle')}</h2><p>${t(confirmation.kind === 'replace' ? 'replaceBody' : 'discardBody')}</p><div class="context-actions">${button('keep', t('keep'))}${button('discard-confirm', t(confirmation.kind === 'replace' ? 'continue' : 'confirmDiscard'))}</div></section>` : ''}${errorHtml()}${busy || loading ? `<p role="status">${t('working')}</p>` : ''}${saved ? `<section class="context-notice" role="status" tabindex="-1"><p>${t('counts' in saved ? 'completed' : 'definitionsSaved')}</p><div class="context-actions">${button('view', t('viewContext'), `data-id="${esc(saved.contextId)}"`)}${options.onOpenChanges ? button('changes', t('reviewChanges')) : ''}</div><small>${copy(options.locale(), 'changedPaths', { count: saved.paths.length })}</small></section>` : ''}${current ? `<details class="context-meta" data-context-disclosure="definition"><summary>${t('existingName')}</summary>${definitionHtml()}</details>` : definitionHtml()}${targetPickerHtml()}${membershipBasisHtml()}${membershipHtml()}</div></main>`;
  }
  async function loadContexts(offset = 0) { const s = sequence,read=++contextSequence, value = await options.api.list({ revision: 'working', offset, limit: 25, ...(search.trim() ? { text: search.trim() } : {}) }); if (s === sequence && read===contextSequence&& visible) { contexts = value; redraw(); } }
  async function loadBatches(offset = 0) { const s = sequence,read=++batchSequence, value = await options.api.batches({ revision: 'working', offset, limit: 10,...draft.target.importIdentity }); if (s === sequence && read===batchSequence&& visible) { batches = value; redraw(); } }
  async function chooseContext(id: string, preserve = false) {
    const s = ++sequence; loading = true; error = null; redraw();
    try {
      const value = await options.api.get({ contextId: id, revision: 'working', limit: 10 });
      if (s !== sequence || !visible) return;
      current = value; draft.target.contextId = id;
      if (!preserve) { const labels = value.definition.labels; draft.language = labels[options.locale()] ? options.locale() : labels.en ? 'en' : options.locale(); draft.name = labels[draft.language] ?? Object.values(labels)[0] ?? ''; draft.purpose = value.definition.description?.[draft.language] ?? ''; }
      baseline = JSON.stringify([draft.language,value.definition.labels[draft.language]??Object.values(value.definition.labels)[0]??'',value.definition.description?.[draft.language]??'','']); cacheInput();
    } catch (cause) { if (s === sequence) failure(cause, () => chooseContext(id, preserve)); }
    finally { if (s === sequence) { loading = false; redraw(); } }
  }
  async function loadMembers(offset = 0) {
    const s = ++memberSequence, planId = plan?.planId, selected = structuredClone(draft.selectedBatch);
    if (!planId && !selected) return;
    try { const value = planId ? await options.api.plan({ planId, offset, limit: 10 }) : await options.api.batchObjects({ batch: selected!, offset, limit: 10 }); if (s === memberSequence && visible && planId === plan?.planId && same(selected, draft.selectedBatch)) { members = value; redraw(); } }
    catch (cause) { if (s === memberSequence) failure(cause, () => loadMembers(offset)); }
  }
  async function initialize(target: ContextWorkspaceTarget, recovered?: Draft) {
    const s = ++sequence; visible = true; loading = true; draft = recovered ?? blank(target); contexts=null;batches=null;current = null;pins=null;pinsSequence++; plan = null; members = null; saved = null; pendingOperations=[];error = null; reason = null; confirmation = null; baseline = JSON.stringify([draft.language, '', '', '']);const ownedDraft=draft; redraw();
    try {
      const pending = await options.api.pending({}); if (s !== sequence || !visible) return; pendingOperations = pending;
      if (pending.length || draft.attemptId) return;
      const list = await options.api.list({ revision: 'working', offset: 0, limit: 25 }); if (s !== sequence || !visible) return; contexts = list;
      const batchList = await options.api.batches({ revision: 'working', offset: 0, limit: 10,...draft.target.importIdentity }); if (s !== sequence || !visible) return; batches = batchList;
      if (draft.target.contextId) await chooseContext(draft.target.contextId, !!recovered);
      if (!visible) return;
      if (draft.planId) { const value = await options.api.plan({ planId: draft.planId, offset: 0, limit: 10 }); if (!visible || draft.planId !== value.planId) return; plan = value; members = value; }
    } catch (cause) { if (visible&&draft===ownedDraft) failure(cause, () => initialize(target, draft)); }
    finally { if(draft===ownedDraft){loading = false; redraw();} }
  }
  async function open(target: ContextWorkspaceTarget = {}) {
    if (busy) return;
    const recovery = parseContextInput(options.storage.getItem(KEY));
    if(draft.attemptId||recovery?.attemptId){const original=draft.attemptId?draft:recovery!;await initialize(original.target,original);return;}
    if (hasUnsavedChanges() && !same(draft.target, target) || recovery && !same(recovery.target, target) && (recovery.attemptId||recovery.baseline!==JSON.stringify([recovery.language,recovery.name,recovery.purpose,recovery.rationale]))) { if (!visible && recovery) await initialize(recovery.target,recovery); visible = true; confirmation = { kind: 'replace', target }; redraw();document.querySelector<HTMLButtonElement>('[data-context=keep]')?.focus(); return; }
    await initialize(target, recovery && same(recovery.target, target) ? recovery : undefined);
  }
  async function resume() { const value = parseContextInput(options.storage.getItem(KEY)); await initialize(value?.target ?? {}, value ?? undefined); }
  async function run(action: () => Promise<void>) {
    if (busy) return; busy = true; error = null; reason = null; redraw();
    pendingWrite = (async () => { try { await action(); } catch (cause) { failure(cause); } finally { busy = false; pendingWrite = null; cacheInput(); redraw(); } })();
    await pendingWrite;
  }
  async function recordResult(value: NavigationSaveResult | NavigationApplyResult) {
    saved = value; draft.attemptId = null; pendingOperations = []; error = null; reason = null;
    if (!('counts' in value)) { draft.target.contextId = value.contextId; baseline=JSON.stringify([draft.language,draft.name,draft.purpose,draft.rationale]); }
    else { plan = null; draft.planId = null; members = null; draft.rationale = ''; }
    cacheInput();try{await options.onChanged?.(value);}catch{failure({code:'REFRESH_FAILED'},async()=>{await options.onChanged?.(value);error=null;redraw();});}
    try{const refreshed=await options.api.get({contextId:value.contextId,revision:'working',limit:10});current=refreshed;draft.target.contextId=value.contextId;if(!draft.name){draft.language=refreshed.definition.labels[options.locale()]?options.locale():'en';draft.name=refreshed.definition.labels[draft.language]??Object.values(refreshed.definition.labels)[0]??'';draft.purpose=refreshed.definition.description?.[draft.language]??'';baseline=JSON.stringify([draft.language,draft.name,draft.purpose,'']);}cacheInput();}
    catch{failure({code:'REFRESH_FAILED'},()=>chooseContext(value.contextId,true));}
  }
  async function saveDefinition() {
    if (!draft.name.trim()) { failure({ code: 'nameRequired' }); return; }
    if (!contexts || draft.attemptId || pendingOperations.length) return;
    const description={...current?.definition.description};if(draft.purpose.trim())description[draft.language]=draft.purpose.trim();else delete description[draft.language];
    const input = { operationId: crypto.randomUUID(), expectedHead: contexts.head, expectedContentHash: current?.contentHash ?? null, ...(current ? { contextId: current.definition.id } : {}), labels: { ...current?.definition.labels, [draft.language]: draft.name.trim() }, ...(Object.keys(description).length?{description}:{}) };
    await run(async () => {
      draft.attemptId = input.operationId; if(!cacheInput()){draft.attemptId=null;throw new Error('INPUT_NOT_SAVED');}try{await options.flushDraft?.();}catch(cause){draft.attemptId=null;bufferFailed=true;throw {code:'INPUT_NOT_SAVED'};}
      try { await recordResult(await options.api.save(input)); }
      catch (cause) { if (cause instanceof ServiceFailure && ['VALIDATION_FAILED','HEAD_CHANGED','CONTENT_CHANGED', 'CONFLICT', 'REVIEW_REQUIRED', 'INVALID_REQUEST'].includes(cause.detail.code)) draft.attemptId = null; throw cause; }
    });if(saved)focusResult('.context-notice[role=status]');
  }
  async function preview() {
    if (!current || !contexts) { failure({ code: 'targetRequired' }); return; }
    if (!draft.selectedBatch) { failure({ code: 'batchRequired' }); return; }
    await run(async () => { const value = await options.api.membershipPlan({ contextId: current!.definition.id, expectedHead: contexts!.head, expectedDefinitionHash: current!.contentHash, batch: draft.selectedBatch!, mode: draft.mode, ...(draft.rationale.trim() ? { rationale: draft.rationale.trim() } : {}) }); plan = value; draft.planId = value.planId; members = null; cacheInput(); await loadMembers(); });if(plan)focusResult('.context-plan');
  }
  async function apply() {
    if (!plan || draft.attemptId || pendingOperations.length) return;
    const selected = plan, operationId = crypto.randomUUID();
    await run(async () => { draft.attemptId = operationId;if(!cacheInput()){draft.attemptId=null;throw new Error('INPUT_NOT_SAVED');}try{await options.flushDraft?.();}catch(cause){draft.attemptId=null;bufferFailed=true;throw {code:'INPUT_NOT_SAVED'};} try { await recordResult(await options.api.applyMembership({ operationId, planId: selected.planId, expectedPlanHash: selected.planHash })); } catch (cause) { if (cause instanceof ServiceFailure && ['VALIDATION_FAILED','HEAD_CHANGED','CONTENT_CHANGED', 'CONFLICT', 'REVIEW_REQUIRED', 'INVALID_REQUEST'].includes(cause.detail.code)) draft.attemptId = null; throw cause; } });if(saved)focusResult('.context-notice[role=status]');
  }
  async function resumeOperation(operationId: string) { await run(async () => {try{const value:NavigationResumeResult=await options.api.resume({operationId});await recordResult(value.result);await loadContexts();await loadBatches();}catch(cause){if(cause instanceof ServiceFailure&&cause.detail.code==='NOT_FOUND'&&draft.attemptId===operationId)draft.attemptId=null;throw cause;} }); }
  function invalidatePlan() { pins=null;pinsSequence++;plan = null; members = null; draft.planId = null; memberSequence++; saved = null; }
  async function click(target: HTMLElement) {
    const action = target.dataset.context;
    try {
      if (action === 'close') { if ((await prepareClose()).ready) await options.onClose(); }
      else if (busy || confirmation && !['keep', 'discard-confirm'].includes(action ?? '')) return;
      else if (action === 'discard') { confirmation = { kind: 'discard' }; redraw(); document.querySelector<HTMLButtonElement>('[data-context="keep"]')?.focus(); }
      else if (action === 'keep') { confirmation = null; redraw(); }
      else if (action === 'discard-confirm' && confirmation && !draft.attemptId) { const next = confirmation.kind === 'replace' ? confirmation.target : {}; options.storage.removeItem(KEY); confirmation = null; await initialize(next); }
      else if(action==='new-target'){const target={...draft.target,batch:draft.selectedBatch??undefined};delete target.contextId;delete target.planId;await open(target);}
      else if (action === 'batch' && target.dataset.index) { const value = batches?.items[Number(target.dataset.index)]; if (value?.status === 'complete') { draft.selectedBatch = structuredClone(value.batch); invalidatePlan(); cacheInput(); redraw(); } }
      else if (action === 'mode-add' || action === 'mode-remove') { draft.mode = action === 'mode-add' ? 'add' : 'remove'; invalidatePlan(); cacheInput(); redraw(); }
      else if (action === 'preview') await preview();
      else if (action === 'apply') await apply();
      else if(action==='source-pins')await loadPins();
      else if(action==='pins-page')await loadPins(Number(target.dataset.offset));
      else if(action==='basis-page')await loadBasis(Number(target.dataset.offset));
      else if (action === 'contexts-page') await loadContexts(Number(target.dataset.offset));
      else if (action === 'batches-page') await loadBatches(Number(target.dataset.offset));
      else if (action === 'members-page') await loadMembers(Number(target.dataset.offset));
      else if (action === 'batch-objects') { plan = null; draft.planId = null; await loadMembers(); }
      else if (action === 'resume' && target.dataset.operation) await resumeOperation(target.dataset.operation);
      else if (action === 'check' && draft.attemptId) await resumeOperation(draft.attemptId);
      else if (action === 'retry' && retry) await retry();
      else if (action === 'flush') { if(!cacheInput())return;await options.flushDraft?.();bufferFailed=false;error=null;reason=null;redraw(); }
      else if (action === 'imports') { if ((await prepareClose()).ready) await options.onResumeImport?.(); }
      else if (action === 'changes' && saved) await options.onOpenChanges?.(saved.paths);
      else if (action === 'view' && target.dataset.id) { if ((await prepareClose()).ready) await options.onViewContext?.(target.dataset.id); }
    } catch (cause) { failure(cause); }
  }
  function input(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    if (busy || loading || draft.attemptId || confirmation) return;
    const key = target.dataset.contextInput;
    if (key === 'search') { search = target.value; return; }
    if (key === 'name' || key === 'purpose' || key === 'rationale') { draft[key] = target.value; if (key === 'rationale') invalidatePlan(); saved = null; cacheInput(); }
  }
  async function change(target: HTMLInputElement | HTMLSelectElement) {
    if (busy || loading || draft.attemptId || confirmation) return;
    if (target.dataset.contextInput === 'target' && target.value) { if(hasUnsavedChanges()&&draft.target.contextId!==target.value){confirmation={kind:'replace',target:{contextId:target.value,batch:draft.selectedBatch??undefined,mode:draft.mode}};redraw();return;}invalidatePlan(); await chooseContext(target.value); }
    else if (target.dataset.contextInput === 'language' && (target.value === 'en' || target.value === 'zh-CN')) { draft.language = target.value; cacheInput(); }
  }
  async function submit(form: HTMLFormElement) { if (confirmation || busy) return; if (form.dataset.contextForm === 'definition') await saveDefinition(); else if (form.dataset.contextForm === 'search') await loadContexts(); }
  async function prepareClose(): Promise<ClosePreparationResult> { if (pendingWrite) await pendingWrite; if (!cacheInput()) return { ready: false, reason: 'save-failed' }; try { await options.flushDraft?.(); return { ready: true }; } catch (cause) { bufferFailed = true; failure(cause); return { ready: false, reason: 'save-failed' }; } }
  function key(event: KeyboardEvent) { if (event.key === 'Escape' && confirmation) { event.preventDefault(); confirmation = null; redraw(); } }
  return { open, resume, content, click, input, change, submit, key, hasUnsavedChanges, prepareClose, hide: () => { cacheInput(); visible = false; sequence++;pinsSequence++; memberSequence++; }, target: () => structuredClone(draft.target) };
}
