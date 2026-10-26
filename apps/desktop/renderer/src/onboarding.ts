import type { HistoryLocale } from '@gitworld/domain';
import { escapeHtml as esc } from './client.ts';
import { onboardingCopy as copy, type OnboardingCopyKey } from './onboarding-copy.ts';
import { isSourceInputHash } from './source-observation.ts';

export type OnboardingSection = 'paths' | 'knowledge' | 'sources' | 'research' | 'changes';
export type OnboardingTrack = 'investigation' | 'data';
export type OnboardingFocusTarget = 'guide-entry' | 'scope' | 'object-search' | 'historical-state' | 'comparison' | 'evidence' | 'research-record' | 'acquisition' | 'mapping-preview' | 'adoption' | 'staging' | 'commit';
export type OnboardingProgressEvent =
  | { type: 'scope-chosen'; scopeKey: string }
  | { type: 'historical-state-inspected'; scopeKey: string; stateKey: string }
  | { type: 'comparison-completed'; scopeKey: string; comparisonKey: string }
  | { type: 'evidence-inspected'; scopeKey: string; evidenceKey: string }
  | { type: 'research-saved'; scopeKey: string; recordId: string; contentHash: string }
  | { type: 'data-acquired'; jobId: string }
  | { type: 'data-previewed'; jobId: string; inputHash?: string }
  | { type: 'data-adopted'; jobId: string; paths?: string[]; inputHash?: string }
  | { type: 'changes-staged'; tree: string; paths: string[] }
  | { type: 'data-committed'; oid: string; tree: string };
export type OnboardingSnapshot = {
  schemaVersion: 1;
  panelOpen: boolean;
  paused: boolean;
  tipsEnabled: boolean;
  dismissedTips: OnboardingSection[];
  track: OnboardingTrack;
  investigation: {
    scopeKey: string | null;
    surface: 'paths' | 'knowledge';
    stateKey: string | null;
    comparisonKey: string | null;
    evidenceKey: string | null;
    research: { recordId: string; contentHash: string } | null;
  };
  data: { jobId: string | null; inputHash: string | null; previewed: boolean; adopted: boolean; adoptedPaths: string[]; stagedTree: string | null; commitOid: string | null };
};
export type OnboardingContext = { section: OnboardingSection; editing?: boolean };
export type OnboardingOptions = {
  state?: unknown;
  persist: (snapshot: OnboardingSnapshot) => void | Promise<void>;
  locale: () => HistoryLocale;
  context: () => OnboardingContext;
  navigate: (section: OnboardingSection) => void | boolean | Promise<void | boolean>;
  focus?: (target: OnboardingFocusTarget) => void | Promise<void>;
  onTipsChange?: (enabled: boolean) => Promise<void>;
  render: () => void;
};
type Step = { title: OnboardingCopyKey; detail: OnboardingCopyKey; action: OnboardingCopyKey; section: OnboardingSection | 'exploration'; target: OnboardingFocusTarget };
type PlainCopyKey = Exclude<OnboardingCopyKey, 'progress' | 'progressSummary'>;
const sections: OnboardingSection[] = ['paths', 'knowledge', 'sources', 'research', 'changes'];
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const key = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
const blankInvestigation = (): OnboardingSnapshot['investigation'] => ({ scopeKey: null, surface: 'knowledge', stateKey: null, comparisonKey: null, evidenceKey: null, research: null });
const adoptedPaths = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && /^objects\/[a-f0-9]{64}\.json$/.test(item)))].sort().slice(0, 20_000) : [];
const blankData = (): OnboardingSnapshot['data'] => ({ jobId: null, inputHash: null, previewed: false, adopted: false, adoptedPaths: [], stagedTree: null, commitOid: null });
export const initialOnboardingSnapshot = (): OnboardingSnapshot => ({ schemaVersion: 1, panelOpen: false, paused: false, tipsEnabled: true, dismissedTips: [], track: 'investigation', investigation: blankInvestigation(), data: blankData() });

/** Restored preferences describe prior successes; restoring them never emits progress events. */
export function parseOnboardingSnapshot(value: unknown): OnboardingSnapshot {
  const result = initialOnboardingSnapshot();
  if (!isObject(value) || value.schemaVersion !== 1) return result;
  result.panelOpen = value.panelOpen === true; result.paused = value.paused === true; result.tipsEnabled = value.tipsEnabled !== false;
  const dismissedTips = value.dismissedTips;
  result.dismissedTips = Array.isArray(dismissedTips) ? sections.filter(section => dismissedTips.includes(section)) : [];
  result.track = value.track === 'data' ? 'data' : 'investigation';
  const investigation = value.investigation;
  if (isObject(investigation) && key(investigation.scopeKey)) {
    const next = result.investigation; next.scopeKey = investigation.scopeKey; next.surface = investigation.surface === 'paths' ? 'paths' : 'knowledge';
    if (key(investigation.stateKey)) {
      next.stateKey = investigation.stateKey;
      if (key(investigation.comparisonKey)) {
        next.comparisonKey = investigation.comparisonKey;
        if (key(investigation.evidenceKey)) {
          next.evidenceKey = investigation.evidenceKey;
          if (isObject(investigation.research) && key(investigation.research.recordId) && key(investigation.research.contentHash)) next.research = { recordId: investigation.research.recordId, contentHash: investigation.research.contentHash };
        }
      }
    }
  }
  const data = value.data;
  if (isObject(data) && key(data.jobId)) {
    const malformedHash = data.inputHash !== undefined && data.inputHash !== null && !isSourceInputHash(data.inputHash);
    result.data.jobId = data.jobId; result.data.previewed = data.previewed === true && !malformedHash; result.data.adopted = result.data.previewed && data.adopted === true;
    result.data.inputHash = result.data.previewed && isSourceInputHash(data.inputHash) ? data.inputHash : null;
    result.data.adoptedPaths = result.data.adopted ? adoptedPaths(data.adoptedPaths) : [];
    result.data.stagedTree = result.data.adoptedPaths.length && key(data.stagedTree) ? data.stagedTree : null;
    result.data.commitOid = result.data.stagedTree && key(data.commitOid) ? data.commitOid : null;
  }
  return result;
}

/** Only successful semantic observations advance steps, in a single scope or acquisition job. */
export function applyOnboardingProgress(state: OnboardingSnapshot, event: OnboardingProgressEvent, section: OnboardingSection = 'knowledge'): OnboardingSnapshot {
  const next = structuredClone(state), investigation = next.investigation, data = next.data;
  switch (event.type) {
    case 'scope-chosen':
      if (!key(event.scopeKey)) break;
      if (investigation.scopeKey !== event.scopeKey) next.investigation = { ...blankInvestigation(), scopeKey: event.scopeKey, surface: section === 'paths' ? 'paths' : 'knowledge' };
      break;
    case 'historical-state-inspected':
      if (investigation.scopeKey === event.scopeKey && key(event.stateKey)) investigation.stateKey = event.stateKey;
      break;
    case 'comparison-completed':
      if (investigation.scopeKey === event.scopeKey && investigation.stateKey && key(event.comparisonKey)) investigation.comparisonKey = event.comparisonKey;
      break;
    case 'evidence-inspected':
      if (investigation.scopeKey === event.scopeKey && investigation.comparisonKey && key(event.evidenceKey)) investigation.evidenceKey = event.evidenceKey;
      break;
    case 'research-saved':
      if (investigation.scopeKey === event.scopeKey && investigation.evidenceKey && key(event.recordId) && key(event.contentHash)) investigation.research = { recordId: event.recordId, contentHash: event.contentHash };
      break;
    case 'data-acquired':
      if (key(event.jobId) && data.jobId !== event.jobId) next.data = { ...blankData(), jobId: event.jobId };
      break;
    case 'data-previewed':
      if (data.jobId === event.jobId && key(event.jobId) && (event.inputHash === undefined || isSourceInputHash(event.inputHash))) {
        const inputHash = event.inputHash ?? null;
        if (data.inputHash !== inputHash) next.data = { ...blankData(), jobId: data.jobId, inputHash, previewed: true };
        else data.previewed = true;
      }
      break;
    case 'data-adopted':
      if (data.previewed && key(event.jobId) && (event.inputHash === undefined || isSourceInputHash(event.inputHash)) && (data.inputHash ? event.inputHash === data.inputHash : data.jobId === event.jobId)) { data.adopted = true; data.adoptedPaths = adoptedPaths([...data.adoptedPaths, ...(event.paths ?? [])]); }
      break;
    case 'changes-staged': {
      const adopted = new Set(data.adoptedPaths);
      if (data.adopted && key(event.tree) && event.paths.some(path => adopted.has(path))) data.stagedTree = event.tree;
      break;
    }
    case 'data-committed':
      if (data.stagedTree && event.tree === data.stagedTree && key(event.oid)) data.commitOid = event.oid;
      break;
  }
  return next;
}

const investigationSteps: Step[] = [
  { title: 'scopeTitle', detail: 'scopeDetail', action: 'scopeAction', section: 'paths', target: 'scope' },
  { title: 'stateTitle', detail: 'stateDetail', action: 'stateAction', section: 'exploration', target: 'historical-state' },
  { title: 'compareTitle', detail: 'compareDetail', action: 'compareAction', section: 'exploration', target: 'comparison' },
  { title: 'evidenceTitle', detail: 'evidenceDetail', action: 'evidenceAction', section: 'exploration', target: 'evidence' },
  { title: 'researchTitle', detail: 'researchDetail', action: 'researchAction', section: 'research', target: 'research-record' },
];
const dataSteps: Step[] = [
  { title: 'acquireTitle', detail: 'acquireDetail', action: 'acquireAction', section: 'sources', target: 'acquisition' },
  { title: 'previewTitle', detail: 'previewDetail', action: 'previewAction', section: 'sources', target: 'mapping-preview' },
  { title: 'adoptTitle', detail: 'adoptDetail', action: 'adoptAction', section: 'sources', target: 'adoption' },
  { title: 'stageTitle', detail: 'stageDetail', action: 'stageAction', section: 'changes', target: 'staging' },
  { title: 'commitTitle', detail: 'commitDetail', action: 'commitAction', section: 'changes', target: 'commit' },
];
export function onboardingProgress(state: OnboardingSnapshot, track: OnboardingTrack = state.track): boolean[] {
  const a = state.investigation, b = state.data;
  return track === 'investigation' ? [!!a.scopeKey, !!a.stateKey, !!a.comparisonKey, !!a.evidenceKey, !!a.research] : [!!b.jobId, b.previewed, b.adopted, !!b.stagedTree, !!b.commitOid];
}

export function createOnboarding(options: OnboardingOptions) {
  let state = parseOnboardingSnapshot(options.state), hydrated = options.state !== undefined, requestedOpen = false;
  let persistFailed = false, navigationFailed = false, restartConfirmation = false;
  let disclosure: 'progress' | 'options' | null = null;
  let queued: OnboardingSnapshot | null = null, writing: Promise<void> | null = null;
  let pendingEvents: { event: OnboardingProgressEvent; section: OnboardingSection }[] = [];
  let tipsPreference: boolean | null = null, tipsFailed: boolean | null = null, tipsSaving = false;
  let tipsPending: Promise<void> | null = null, pendingJourney: { track: OnboardingTrack; mode: 'resume' | 'restart' } | null = null;
  const t = (key: PlainCopyKey) => copy(options.locale(), key);
  const button = (action: string, title: string, extra = '', primary = false) => `<button type="button" class="onboarding-button${primary ? ' primary' : ''}" data-onboarding="${action}" ${extra}>${esc(title)}</button>`;
  const redraw = () => options.render();
  const snapshot = () => structuredClone(state);
  function savePreferences() {
    queued = snapshot();
    return flushPreferences();
  }
  function flushPreferences(): Promise<void> {
    if (writing) return writing;
    writing = (async () => {
      while (queued) {
        const value = queued; queued = null;
        try { await options.persist(value); persistFailed = false; }
        catch { persistFailed = true; }
      }
    })().finally(() => { writing = null; redraw(); if (queued) return flushPreferences(); });
    return writing;
  }
  function change(update: (next: OnboardingSnapshot) => void): boolean {
    if (!hydrated) return false;
    const next = snapshot(); update(next);
    if (JSON.stringify(next) === JSON.stringify(state)) return false;
    state = next; void savePreferences(); redraw(); return true;
  }
  function configurePreferences(preferences: { tipsEnabled: boolean }) {
    if (typeof preferences.tipsEnabled !== 'boolean') return;
    const changed = state.tipsEnabled !== preferences.tipsEnabled || tipsFailed === preferences.tipsEnabled;
    tipsPreference = preferences.tipsEnabled; state.tipsEnabled = preferences.tipsEnabled;
    if (tipsFailed === preferences.tipsEnabled) tipsFailed = null;
    if (hydrated && changed) redraw();
  }
  function openJourney(track: OnboardingTrack, mode: 'resume' | 'restart') {
    if (!['investigation', 'data'].includes(track) || !['resume', 'restart'].includes(mode)) return;
    if (!hydrated) { pendingJourney = { track, mode }; requestedOpen = true; return; }
    navigationFailed = false; restartConfirmation = mode === 'restart'; disclosure = null;
    change(next => { next.panelOpen = true; next.track = track; if (mode === 'resume') next.paused = false; });
    redraw();
  }
  function hydrate(value: unknown) {
    if (hydrated) return;
    state = parseOnboardingSnapshot(value); hydrated = true;
    if (tipsPreference !== null) state.tipsEnabled = tipsPreference;
    const restored = JSON.stringify(state);
    for (const pending of pendingEvents) state = applyOnboardingProgress(state, pending.event, pending.section);
    pendingEvents = [];
    if (requestedOpen) state.panelOpen = true;
    if (pendingJourney) { state.track = pendingJourney.track; if (pendingJourney.mode === 'resume') state.paused = false; restartConfirmation = pendingJourney.mode === 'restart'; pendingJourney = null; }
    if (JSON.stringify(state) !== restored) void savePreferences();
    redraw();
  }
  async function flush() {
    if (tipsPending) await tipsPending;
    if (writing) await writing;
    if (persistFailed && hydrated) await savePreferences();
    if (persistFailed) throw new Error('CLIENT_STATE_SAVE_FAILED');
  }
  async function restore(value: unknown) {
    if (tipsPending) await tipsPending;
    if (writing) await writing.catch(() => {});
    queued = null; pendingEvents = []; requestedOpen = false; pendingJourney = null; tipsPreference = null; tipsFailed = null; state = parseOnboardingSnapshot(value); hydrated = true;
    persistFailed = false; navigationFailed = false; restartConfirmation = false; disclosure = null; redraw();
  }
  function open() {
    if (!hydrated) { requestedOpen = true; pendingJourney = null; return; }
    navigationFailed = false; restartConfirmation = false; disclosure = null;
    change(next => { next.panelOpen = true; });
    redraw();
  }
  function observe(event: OnboardingProgressEvent) {
    if (!hydrated) { pendingEvents.push({ event: structuredClone(event), section: options.context().section }); return; }
    const next = applyOnboardingProgress(state, event, options.context().section);
    if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; void savePreferences(); redraw(); }
  }
  function entry() { return button('open', t('guide'), `aria-controls="onboarding-panel" aria-expanded="${hydrated && state.panelOpen}"`); }
  function saveErrorHtml() { return persistFailed ? `<div class="onboarding-save-error"><p>${t('saveFailed')}</p>${button('retry-save', t('retrySave'))}</div>` : ''; }
  function tipsErrorHtml() { return tipsFailed !== null ? `<div class="onboarding-save-error"><p>${t('tipsSaveFailed')}</p>${button('retry-tips', t(tipsFailed ? 'retryTipsOn' : 'retryTipsOff'), tipsSaving ? 'disabled' : '')}</div>` : ''; }
  function requestTipsChange(enabled: boolean): Promise<void> {
    if (tipsPending) return tipsPending;
    tipsSaving = true; tipsFailed = null; redraw();
    tipsPending = (async () => {
      try {
        await options.onTipsChange?.(enabled);
        tipsPreference = enabled;
        if (!change(next => { next.tipsEnabled = enabled; if (enabled) next.dismissedTips = []; })) void savePreferences();
      } catch { tipsFailed = enabled; }
    })().finally(() => { tipsPending = null; tipsSaving = false; redraw(); });
    return tipsPending;
  }
  function panelHtml() {
    const done = onboardingProgress(state), steps = state.track === 'investigation' ? investigationSteps : dataSteps;
    const next = done.indexOf(false), step = steps[next], completed = next < 0;
    const progress = { completed: done.filter(Boolean).length, total: steps.length };
    return `<aside class="onboarding-panel" id="onboarding-panel" data-onboarding-panel aria-labelledby="onboarding-title"><header class="onboarding-heading"><h2 id="onboarding-title">${t('guide')}<span>${t(state.track === 'investigation' ? 'firstInvestigation' : 'dataRecipe')}</span></h2><div class="onboarding-actions">${button('progress', copy(options.locale(), 'progressSummary', progress), `aria-expanded="${disclosure === 'progress'}" aria-controls="onboarding-progress" aria-label="${esc(copy(options.locale(), 'progress', progress))}"`)}${button('options', t('options'), `aria-expanded="${disclosure === 'options'}" aria-controls="onboarding-options"`)}${button('close', '×', `aria-label="${t('close')}"`)}</div></header>
      ${restartConfirmation ? `<section class="onboarding-restart"><p>${t('restartPrompt')}</p><div class="onboarding-actions">${button('confirm-restart', t('confirmRestart'))}${button('cancel-restart', t('keepProgress'))}</div></section>` : state.paused ? `<section class="onboarding-current"><div><h3>${t('paused')}</h3><p>${t('pausedDetail')}</p></div>${button('resume', t('resume'), '', true)}</section>` : `<section class="onboarding-current"><div><h3>${t(completed ? state.track === 'investigation' ? 'investigationComplete' : 'dataComplete' : step.title as PlainCopyKey)}</h3><p>${t(completed ? state.track === 'investigation' ? 'investigationCompleteDetail' : 'dataCompleteDetail' : step.detail as PlainCopyKey)}</p></div>${button(completed ? state.track === 'investigation' ? 'research' : 'objects' : 'next', t(completed ? state.track === 'investigation' ? 'researchAction' : 'exploreAction' : step.action as PlainCopyKey), '', true)}</section>`}
      ${saveErrorHtml()}${tipsErrorHtml()}${navigationFailed ? `<p class="onboarding-error">${t('navigationFailed')}</p>` : ''}
      ${disclosure === 'progress' ? `<section class="onboarding-steps" id="onboarding-progress" aria-label="${t('steps')}"><ol>${steps.map((item, index) => `<li${!done[index] && index === next ? ' aria-current="step"' : ''}><span class="onboarding-step-mark" aria-label="${t(done[index] ? 'completed' : 'pending')}">${done[index] ? '✓' : index + 1}</span><span>${t(item.title as PlainCopyKey)}</span></li>`).join('')}</ol></section>` : ''}
      ${disclosure === 'options' ? `<section class="onboarding-options" id="onboarding-options" aria-label="${t('options')}"><nav class="onboarding-tracks" aria-label="${t('guide')}">${(['investigation', 'data'] as const).map(track => `<button type="button" aria-pressed="${state.track === track}" data-onboarding="track" data-track="${track}">${t(track === 'investigation' ? 'firstInvestigation' : 'dataRecipe')}${track === 'data' ? `<small>${t('optional')}</small>` : ''}</button>`).join('')}</nav><div class="onboarding-settings"><button type="button" class="onboarding-button" data-onboarding="tips" aria-pressed="${state.tipsEnabled}" aria-label="${t(state.tipsEnabled ? 'turnTipsOff' : 'turnTipsOn')}" ${tipsSaving ? 'disabled aria-busy="true"' : ''}>${t(tipsSaving ? 'tipsSaving' : state.tipsEnabled ? 'tipsOn' : 'tipsOff')}</button>${!state.paused ? button('pause', t('pause')) : ''}${button('restart', t('restart'))}</div></section>` : ''}</aside>`;
  }
  function content() {
    if (!hydrated) return '';
    if (state.panelOpen) return panelHtml();
    const context = options.context();
    if (!state.tipsEnabled || state.paused || context.editing || state.dismissedTips.includes(context.section)) return saveErrorHtml() + tipsErrorHtml();
    const tips: Record<OnboardingSection, PlainCopyKey> = { paths: 'pathsTip', knowledge: 'knowledgeTip', sources: 'sourcesTip', research: 'researchTip', changes: 'changesTip' };
    return `<aside class="onboarding-tip" data-onboarding-tip aria-label="${t('guide')}"><div><p>${t(tips[context.section])}</p>${button('open', t('guide'))}</div>${button('dismiss-tip', '×', `aria-label="${t('dismissTip')}"`)}</aside>${saveErrorHtml()}${tipsErrorHtml()}`;
  }
  async function go(section: OnboardingSection, target: OnboardingFocusTarget) {
    navigationFailed = false;
    try { if (await options.navigate(section) === false) return; }
    catch { navigationFailed = true; redraw(); return; }
    try { await options.focus?.(target); } catch { /* A focus target may be unavailable after successful navigation. */ }
  }
  async function returnToEntry() { try { await options.focus?.('guide-entry'); } catch { /* Closing help cannot alter the editing workflow. */ } }
  async function closePanel(paused = false) {
    disclosure = null; restartConfirmation = false;
    const section = options.context().section;
    change(next => { next.panelOpen = false; if (paused) next.paused = true; if (!next.dismissedTips.includes(section)) next.dismissedTips.push(section); });
    await returnToEntry();
  }
  function focusDisclosure(action: 'progress' | 'options') {
    if (typeof document !== 'undefined') document.querySelector<HTMLButtonElement>(`[data-onboarding="${action}"]`)?.focus({ preventScroll: true });
  }
  async function click(element: HTMLElement): Promise<boolean> {
    const action = element.dataset.onboarding;
    if (!action) return false;
    if (action === 'open') { open(); return true; }
    if (!hydrated) return true;
    if (action === 'close' || action === 'pause') await closePanel(action === 'pause');
    else if (action === 'progress' || action === 'options') { disclosure = disclosure === action ? null : action; redraw(); }
    else if (action === 'dismiss-tip') { const section = options.context().section; change(next => { if (!next.dismissedTips.includes(section)) next.dismissedTips.push(section); }); await returnToEntry(); }
    else if (action === 'resume') change(next => { next.paused = false; });
    else if (action === 'tips') await requestTipsChange(!state.tipsEnabled);
    else if (action === 'retry-tips' && tipsFailed !== null) await requestTipsChange(tipsFailed);
    else if (action === 'track' && (element.dataset.track === 'data' || element.dataset.track === 'investigation')) { restartConfirmation = false; change(next => { next.track = element.dataset.track as OnboardingTrack; }); }
    else if (action === 'restart') { disclosure = null; restartConfirmation = true; redraw(); }
    else if (action === 'cancel-restart') { restartConfirmation = false; redraw(); }
    else if (action === 'confirm-restart') { restartConfirmation = false; change(next => { if (next.track === 'data') next.data = blankData(); else next.investigation = blankInvestigation(); next.paused = false; }); redraw(); }
    else if (action === 'retry-save') await savePreferences();
    else if (action === 'objects') await go('knowledge', 'object-search');
    else if (action === 'research') await go('research', 'research-record');
    else if (action === 'next') {
      const steps = state.track === 'investigation' ? investigationSteps : dataSteps, step = steps[onboardingProgress(state).indexOf(false)];
      if (step?.target === 'scope' && options.context().section === 'knowledge') await go('knowledge', 'object-search');
      else if (step) await go(step.section === 'exploration' ? state.investigation.surface : step.section, step.target);
    }
    return true;
  }
  async function keyEvent(event: KeyboardEvent): Promise<boolean> {
    const target = event.target as Element | null;
    if (event.key !== 'Escape' || !state.panelOpen || !target || typeof target.closest !== 'function' || !target.closest('[data-onboarding-panel]')) return false;
    event.preventDefault();
    if (restartConfirmation) { restartConfirmation = false; redraw(); focusDisclosure('options'); }
    else if (disclosure) { const prior = disclosure; disclosure = null; redraw(); focusDisclosure(prior); }
    else await closePanel();
    return true;
  }
  return { entry, content, open, openJourney, configurePreferences, hydrate, restore, flush, observe, snapshot, click, key: keyEvent };
}
