import './settings.css';
import type { SettingsGeneral, SettingsLearning, SettingsSnapshot, SettingsSection, SettingsUpdate, SettingsValues, SettingsLibraryInfo, SettingsJourney, SettingsValidationIssue } from '../../../../packages/contracts/src/settings-types.ts';
import { settingsSectionIssues } from '../../../../packages/contracts/src/settings-types.ts';
import { bridge, request, operationId, escapeHtml as esc, ServiceFailure } from './client';
import { settingsCopy, settingsStorageText, type SettingsCopyKey } from './settings-copy';

export type SettingsOptions = {
  locale: () => SettingsGeneral['locale'];
  onClose: () => void | Promise<void>;
  onApplied: (snapshot: SettingsSnapshot) => void | Promise<void>;
  onJourney: (track: SettingsJourney, action: 'resume' | 'restart') => Promise<void>;
  beforeTransfer: () => Promise<void>;
  afterTransfer: () => void;
  onRestored: () => Promise<void>;
  onError?: (error: unknown) => void;
  onRendered?: () => void;
  hostInfo?: () => { version: string; buildId: string };
  onNotices?: () => void | Promise<void>;
  host?: HTMLElement;
};

/** Standalone workbench section. The shell owns navigation, guide and native display effects. */
export function createSettings(options: SettingsOptions) {
  const host = () => options.host ?? document.querySelector<HTMLElement>('#app');
  let active = false, busy = false, section: SettingsSection | 'library' = 'general';
  let profile: SettingsSnapshot | null = null, library: SettingsLibraryInfo | null = null;
  let general: SettingsGeneral | null = null, learning: SettingsLearning | null = null, contributor = { name: '', email: '' };
  let issues: SettingsValidationIssue[] = [], error: SettingsCopyKey | null = null, message: SettingsCopyKey | null = null;
  let storageFailed = false, conflict: SettingsUpdate | null = null, applyFailed = false, closeConfirmation = false;
  let restoreFile: { fileToken: string; name: string } | null = null;
  let activeOperation: string | null = null, unsubscribe: (() => void) | null = null;
  let focusTarget: { form?: string; name?: string; action?: string; section?: string; track?: string } | null = null;
  const locale = () => profile?.values.general.locale ?? options.locale();
  const t = (key: SettingsCopyKey) => settingsCopy(locale(), key);
  const button = (key: SettingsCopyKey, action: string, extra = '', primary = false) => `<button type="button" class="settings-action${primary ? ' settings-primary' : ''}" data-settings="${action}" ${busy && action !== 'cancel-operation' ? 'disabled' : ''} ${extra}>${esc(t(key))}</button>`;
  function retainContributor() {
    const form = host()?.querySelector<HTMLFormElement>('form[data-settings-form="contributor"]');
    if (form) contributor = {
      name: (form.elements.namedItem('name') as HTMLInputElement).value,
      email: (form.elements.namedItem('email') as HTMLInputElement).value,
    };
  }
  function hasUnsavedChanges() {
    if (!active) return false;
    retainContributor();
    return !!profile && (contributor.name !== profile.values.contributor.name || contributor.email !== profile.values.contributor.email);
  }
  function errorFor(cause: unknown, libraryOperation = false): SettingsCopyKey {
    const code = cause instanceof ServiceFailure ? cause.detail.code : cause instanceof Error ? cause.message : '';
    if (code === 'CONFLICT') return 'conflict';
    if (code === 'SETTINGS_INVALID') return 'loadFailed';
    if (code === 'OPERATION_IN_PROGRESS') return 'operationBusy';
    if (code === 'CANCELLED') return 'operationCancelled';
    return libraryOperation ? 'operationFailed' : 'saveFailed';
  }
  async function run(task: () => Promise<void>, libraryOperation = false) {
    if (busy) return;
    retainContributor(); busy = true; error = null; message = null; render();
    try { await task(); }
    catch (cause) { error = errorFor(cause, libraryOperation); }
    finally { busy = false; activeOperation = null; render(); }
  }
  async function apply(snapshot: SettingsSnapshot, resetContributor = false) {
    const dirty = hasUnsavedChanges();
    profile = structuredClone(snapshot); general = { ...snapshot.values.general }; learning = { ...snapshot.values.learning };
    if (resetContributor || !dirty) contributor = { ...snapshot.values.contributor };
    // Replace the form before the shell changes locale/zoom, keeping every input in this module.
    if (resetContributor) { const form = host()?.querySelector<HTMLFormElement>('form[data-settings-form="contributor"]'); if (form) { (form.elements.namedItem('name') as HTMLInputElement).value = contributor.name; (form.elements.namedItem('email') as HTMLInputElement).value = contributor.email; } }
    render();
    try { await options.onApplied(snapshot); applyFailed = false; }
    catch { applyFailed = true; error = 'applyFailed'; }
  }
  async function save(section: SettingsSection, value: SettingsValues[SettingsSection], retry = false) {
    issues = settingsSectionIssues(section, value); if (issues.length || !profile) { render(); return; }
    const desired = structuredClone(value);
    if (retry) profile = await request('settings.get', {});
    const input = { section, value: desired, expectedVersion: profile.version } as SettingsUpdate;
    try {
      const snapshot = await request('settings.update', input);
      if (profile && snapshot.version < profile.version) {
        conflict = input; error = 'conflict';
        if (section === 'general') general = desired as SettingsGeneral;
        else if (section === 'learning') learning = desired as SettingsLearning;
        return;
      }
      conflict = null; issues = []; await apply(snapshot, section === 'contributor');
      if (!applyFailed) message = 'saved';
    } catch (cause) {
      if (cause instanceof ServiceFailure && cause.detail.code === 'CONFLICT') conflict = input;
      throw cause;
    }
  }
  function fieldError(field: SettingsValidationIssue['field']) {
    const issue = issues.find(issue => issue.field === field); if (!issue) return '';
    const messages: Record<SettingsValidationIssue['reason'], SettingsCopyKey> = { locale: 'invalidLocale', zoom: 'invalidZoom', startup: 'invalidStartup', motion: 'invalidMotion', boolean: 'invalidBoolean', name: 'invalidName', email: 'invalidEmail', shape: 'invalidShape' };
    return `<span class="settings-field-error" id="settings-error-${field}" role="alert">${esc(t(messages[issue.reason]))}</span>`;
  }
  const invalid = (field: SettingsValidationIssue['field']) => issues.some(issue => issue.field === field) ? `aria-invalid="true" aria-describedby="settings-error-${field}"` : '';
  function generalHtml() {
    if (!general) return '';
    return `<h2>${esc(t('general'))}</h2><form class="settings-form" data-settings-form="general"><label class="settings-field">${esc(t('language'))}<select name="locale" ${busy ? 'disabled' : ''} ${invalid('general.locale')}><option value="en" ${general.locale === 'en' ? 'selected' : ''}>English</option><option value="zh-CN" ${general.locale === 'zh-CN' ? 'selected' : ''}>简体中文</option></select>${fieldError('general.locale')}</label><label class="settings-field">${esc(t('zoom'))}<span class="settings-zoom-row"><input name="zoom" type="number" min="75" max="200" step="1" value="${Number((general.zoomFactor * 100).toFixed(2))}" ${busy ? 'disabled' : ''} ${invalid('general.zoomFactor')}>${button('resetZoom', 'reset-zoom')}</span>${fieldError('general.zoomFactor')}</label><label class="settings-field">${esc(t('startup'))}<select name="startup" ${busy ? 'disabled' : ''} ${invalid('general.startup')}><option value="resume" ${general.startup === 'resume' ? 'selected' : ''}>${esc(t('resume'))}</option><option value="world" ${general.startup === 'world' ? 'selected' : ''}>${esc(t('world'))}</option></select>${fieldError('general.startup')}</label><label class="settings-field">${esc(t('motion'))}<select name="reducedMotion" ${busy ? 'disabled' : ''} ${invalid('general.reducedMotion')}><option value="system" ${general.reducedMotion === 'system' ? 'selected' : ''}>${esc(t('systemMotion'))}</option><option value="reduce" ${general.reducedMotion === 'reduce' ? 'selected' : ''}>${esc(t('reduceMotion'))}</option></select>${fieldError('general.reducedMotion')}</label><p class="settings-hint">${esc(t('displayHint'))}</p></form>`;
  }
  function learningHtml() {
    if (!learning) return '';
    return `<h2>${esc(t('learning'))}</h2><form data-settings-form="learning"><label class="settings-checkbox"><input name="tipsEnabled" type="checkbox" ${learning.tipsEnabled ? 'checked' : ''} ${busy ? 'disabled' : ''} ${invalid('learning.tipsEnabled')}>${esc(t('tips'))}</label>${fieldError('learning.tipsEnabled')}<p class="settings-hint">${esc(t('guideHint'))}</p></form>${(['investigation', 'data'] as const).map(track => `<section class="settings-journey"><h3>${esc(t(track === 'investigation' ? 'firstJourney' : 'acquiredJourney'))}</h3><div class="settings-actions">${button('resumeJourney', 'resume-journey', `data-track="${track}"`, true)}${button('restartJourney', 'restart-journey', `data-track="${track}"`)}</div></section>`).join('')}`;
  }
  function contributorHtml() {
    const emailInvalid = issues.some(issue => issue.field === 'contributor.email');
    const savedAuthor = profile?.values.contributor ?? contributor;
    return `<h2>${esc(t('contributor'))}</h2><form class="settings-form" data-settings-form="contributor" novalidate><label class="settings-field">${esc(t('name'))}<input name="name" value="${esc(contributor.name)}" maxlength="200" autocomplete="off" ${busy ? 'disabled' : ''} ${invalid('contributor.name')}>${fieldError('contributor.name')}</label><label class="settings-field">${esc(t('email'))}<input name="email" type="email" value="${esc(contributor.email)}" maxlength="254" autocomplete="off" spellcheck="false" ${busy ? 'disabled' : ''} aria-invalid="${emailInvalid}" aria-describedby="settings-email-hint${emailInvalid ? ' settings-error-contributor.email' : ''}">${fieldError('contributor.email')}</label><p id="settings-email-hint" class="settings-hint">${esc(t('emailHint'))}</p><div><h3>${esc(t('authorPreview'))}</h3><output class="settings-author">${esc(`${savedAuthor.name} <${savedAuthor.email}>`)}</output></div>${profile?.values.contributor.name === 'Local researcher' && profile.values.contributor.email === 'local@gitworld.invalid' ? `<p class="settings-hint">${esc(t('placeholder'))}</p>` : ''}<p class="settings-hint">${esc(t('identityHint'))}</p><footer><button type="submit" class="settings-action settings-primary" ${busy ? 'disabled' : ''}>${esc(t('saveIdentity'))}</button>${button('discard', 'discard-contributor')}</footer></form>`;
  }
  function libraryHtml() {
    const info = options.hostInfo?.();
    let measured = library?.measuredAt ?? ''; try { if (library) measured = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(library.measuredAt)); } catch { /* The validated service timestamp remains readable. */ }
    return `<h2>${esc(t('library'))}</h2>${storageFailed ? `<p class="settings-error">${esc(t('storageFailed'))}</p>` : ''}${library ? `<dl class="settings-facts"><dt>${esc(t('location'))}</dt><dd class="settings-path">${esc(library.location)}</dd><dt>${esc(t('storage'))}</dt><dd>${esc(settingsStorageText(locale(), library.files, library.bytes))}</dd><dt>${esc(t('measured'))}</dt><dd>${esc(measured)}</dd>${info ? `<dt>${esc(t('version'))}</dt><dd>${esc(info.version)}</dd><dt>${esc(t('build'))}</dt><dd>${esc(info.buildId)}</dd>` : ''}</dl>` : ''}<p class="settings-hint">${esc(t('libraryHint'))}</p><div class="settings-actions">${button('backup', 'backup', '', true)}${button('restore', 'restore')}${button('refresh', 'refresh-library')}${options.onNotices ? button('notices', 'notices') : ''}</div>`;
  }
  function render() {
    if (!active) return; const root = host(); if (!root) return; retainContributor();
    const focused = document.activeElement as HTMLElement | null;
    if (focused && root.contains(focused)) {
      if (focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement) focusTarget = { form: focused.closest<HTMLFormElement>('form[data-settings-form]')?.dataset.settingsForm, name: focused.name };
      else if (focused.dataset.settings) focusTarget = { action: focused.dataset.settings, section: focused.dataset.section, track: focused.dataset.track };
    }
    const errorNotice = error ? `<div class="settings-error" role="alert">${esc(t(error))}${conflict ? `<div class="settings-actions">${button('useSaved', 'use-saved')}${button('keepLocal', 'keep-local')}</div>` : error === 'loadFailed' ? `<div class="settings-actions">${button('retry', 'reload-settings')}${button('library', 'section', 'data-section="library"')}</div>` : ''}${applyFailed ? button('applyAgain', 'apply-again') : ''}</div>` : '';
    const closeDialog = closeConfirmation ? `<section class="settings-confirm" role="alertdialog" aria-labelledby="settings-close-title"><h3 id="settings-close-title">${esc(t('unsavedTitle'))}</h3><p>${esc(t('unsavedBody'))}</p><div class="settings-actions">${button('keepEditing', 'keep-editing', '', true)}${button('discardClose', 'discard-close')}</div></section>` : '';
    const restoreDialog = restoreFile ? `<section class="settings-confirm" role="alertdialog" aria-labelledby="settings-restore-title"><h3 id="settings-restore-title">${esc(t('restoreTitle'))}</h3><p>${esc(restoreFile.name)}</p><p>${esc(t('restoreBody'))}</p><div class="settings-actions">${button('restoreConfirm', 'confirm-restore', '', true)}${button('cancel', 'cancel-restore')}</div></section>` : '';
    root.innerHTML = `<section class="settings-shell"><header class="settings-header"><h1 data-native-titlebar-anchor>${esc(t('title'))}</h1>${button('back', 'close')}</header><div class="settings-layout"><nav class="settings-nav" aria-label="${esc(t('title'))}">${(['general', 'learning', 'contributor', 'library'] as const).map(value => button(value, 'section', `data-section="${value}" aria-current="${value === section ? 'page' : 'false'}"`)).join('')}</nav><main class="settings-content">${errorNotice}${message ? `<p class="settings-success" role="status">${esc(t(message))}</p>` : ''}${closeDialog}${restoreDialog}${busy ? `<p class="settings-busy" data-settings-progress role="status">${esc(t(profile ? 'busy' : 'loading'))}</p>${activeOperation ? button('cancelOperation', 'cancel-operation') : ''}` : ''}${section === 'library' ? libraryHtml() : profile ? section === 'general' ? generalHtml() : section === 'learning' ? learningHtml() : contributorHtml() : ''}</main></div></section>`;
    if (!busy && focusTarget) {
      const focus = focusTarget;
      const replacement = focus.name ? root.querySelector<HTMLElement>(`form[data-settings-form="${CSS.escape(focus.form ?? '')}"] [name="${CSS.escape(focus.name)}"]`) : [...root.querySelectorAll<HTMLElement>('[data-settings]')].find(element => element.dataset.settings === focus.action && element.dataset.section === focus.section && element.dataset.track === focus.track);
      if (replacement && !replacement.hasAttribute('disabled')) replacement.focus({ preventScroll: true });
    }
    options.onRendered?.();
  }
  async function load() {
    const next = await request('settings.get', {}); await apply(next, true); error = null; conflict = null;
  }
  async function loadLibrary() { try { library = await request('settings.library', {}); storageFailed = false; } catch { storageFailed = true; } }
  async function open(initial?: SettingsSection | 'library') {
    if (active) { if (initial) section = initial; render(); return; }
    active = true; section = initial ?? section; closeConfirmation = false; restoreFile = null;
    unsubscribe?.(); unsubscribe = bridge().onProgress(progress => {
      if (progress.operationId !== activeOperation) return;
      const status = host()?.querySelector<HTMLElement>('[data-settings-progress]');
      if (status) status.textContent = progress.total === undefined ? t('busy') : `${t('busy')} ${new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(Math.min(1, (progress.completed ?? 0) / Math.max(1, progress.total)))}`;
    });
    await run(async () => { try { await load(); } catch { error = 'loadFailed'; } await loadLibrary(); });
  }
  async function close(discard = false): Promise<boolean> {
    if (busy) return false;
    if (!discard && hasUnsavedChanges()) { closeConfirmation = true; render(); return false; }
    active = false; unsubscribe?.(); unsubscribe = null; await options.onClose(); return true;
  }
  async function journey(track: SettingsJourney, action: 'resume' | 'restart') {
    if (hasUnsavedChanges()) { closeConfirmation = true; render(); return; }
    active = false; unsubscribe?.(); unsubscribe = null; await options.onClose();
    try { await options.onJourney(track, action); } catch (cause) { options.onError?.(cause); }
  }
  async function click(target: HTMLElement) {
    const action = target.dataset.settings; if (!action) return;
    if (action === 'cancel-operation' && activeOperation) { await request('operation.cancel', { operationId: activeOperation }); return; }
    if (busy) return;
    retainContributor();
    if (['backup', 'restore', 'confirm-restore'].includes(action) && hasUnsavedChanges()) { section = 'contributor'; error = 'saveBeforeTransfer'; closeConfirmation = false; render(); return; }
    if (action === 'close') { await close(); return; }
    if (action === 'discard-close') { await close(true); return; }
    if (action === 'keep-editing') { closeConfirmation = false; render(); return; }
    if (action === 'section' && ['general', 'learning', 'contributor', 'library'].includes(target.dataset.section ?? '')) { section = target.dataset.section as typeof section; render(); return; }
    if (action === 'cancel-restore') { restoreFile = null; render(); return; }
    if ((action === 'resume-journey' || action === 'restart-journey') && (target.dataset.track === 'investigation' || target.dataset.track === 'data')) { await journey(target.dataset.track, action === 'restart-journey' ? 'restart' : 'resume'); return; }
    await run(async () => {
      if (action === 'reload-settings') await load();
      else if (action === 'refresh-library') await loadLibrary();
      else if (action === 'reset-zoom' && general) { general.zoomFactor = 1; await save('general', general); }
      else if (action === 'discard-contributor' && profile) { contributor = { ...profile.values.contributor }; const form = host()?.querySelector<HTMLFormElement>('form[data-settings-form="contributor"]'); if (form) { (form.elements.namedItem('name') as HTMLInputElement).value = contributor.name; (form.elements.namedItem('email') as HTMLInputElement).value = contributor.email; } issues = []; }
      else if (action === 'use-saved') { const latest = await request('settings.get', {}); await apply(latest, conflict?.section === 'contributor'); conflict = null; issues = []; }
      else if (action === 'keep-local' && conflict) await save(conflict.section, conflict.value, true);
      else if (action === 'apply-again' && profile) await apply(profile);
      else if (action === 'notices') await options.onNotices?.();
      else if (action === 'backup') {
        const file = await bridge().selectFile('backup'); if (!file) return;
        try { await options.beforeTransfer(); activeOperation = operationId(); render(); await request('backup.create', { fileToken: file.fileToken, operationId: activeOperation }); message = 'backupDone'; }
        finally { options.afterTransfer(); } await loadLibrary();
      } else if (action === 'restore') restoreFile = await bridge().selectFile('restore');
      else if (action === 'confirm-restore' && restoreFile) {
        try { await options.beforeTransfer(); activeOperation = operationId(); render(); await request('backup.restore', { fileToken: restoreFile.fileToken, operationId: activeOperation }); restoreFile = null; await load(); await loadLibrary(); message = 'restoreDone'; await options.onRestored(); }
        finally { options.afterTransfer(); }
      }
    }, ['backup', 'restore', 'confirm-restore'].includes(action));
  }
  async function change(target: HTMLInputElement | HTMLSelectElement) {
    const form = target.closest<HTMLFormElement>('form[data-settings-form]'); if (!form || busy) return;
    const values = new FormData(form);
    if (form.dataset.settingsForm === 'general' && general) {
      general = { locale: String(values.get('locale')) as SettingsGeneral['locale'], zoomFactor: Number(values.get('zoom')) / 100, startup: String(values.get('startup')) as SettingsGeneral['startup'], reducedMotion: String(values.get('reducedMotion')) as SettingsGeneral['reducedMotion'] };
      await run(() => save('general', general!));
    } else if (form.dataset.settingsForm === 'learning') { learning = { tipsEnabled: values.has('tipsEnabled') }; await run(() => save('learning', learning!)); }
    else if (form.dataset.settingsForm === 'contributor') retainContributor();
  }
  async function submit(form: HTMLFormElement) {
    if (busy) return;
    if (form.dataset.settingsForm === 'general') { const zoom = form.querySelector<HTMLInputElement>('input[name="zoom"]'); if (zoom) await change(zoom); return; }
    if (form.dataset.settingsForm !== 'contributor') return;
    retainContributor(); const desired = { name: contributor.name.trim(), email: contributor.email.trim() };
    await run(() => save('contributor', desired));
  }
  function synchronize(snapshot: SettingsSnapshot) {
    if (profile && snapshot.version < profile.version) return;
    const dirty = hasUnsavedChanges(); profile = structuredClone(snapshot); general = { ...snapshot.values.general }; learning = { ...snapshot.values.learning };
    if (!dirty) contributor = { ...snapshot.values.contributor }; render();
  }
  async function key(event: KeyboardEvent): Promise<boolean> {
    if (!active || event.key !== 'Escape') return false;
    event.preventDefault();
    if (busy) return true;
    if (restoreFile) { restoreFile = null; render(); }
    else if (closeConfirmation) { closeConfirmation = false; render(); }
    else await close();
    return true;
  }
  return { open, close, render, click, change, submit, key, synchronize, hasUnsavedChanges, snapshot: () => profile ? structuredClone(profile) : null };
}
