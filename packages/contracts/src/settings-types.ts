import { DEFAULT_EDITORIAL_IDENTITY, validEditorialIdentity, type EditorialIdentity } from './editorial-types.ts';

export type SettingsGeneral = { locale: 'en' | 'zh-CN'; zoomFactor: number; startup: 'resume' | 'world'; reducedMotion: 'system' | 'reduce' };
export type SettingsLearning = { tipsEnabled: boolean };
export type SettingsValues = { general: SettingsGeneral; learning: SettingsLearning; contributor: EditorialIdentity };
export type SettingsSection = keyof SettingsValues;
export type SettingsSnapshot = { schemaVersion: 1; version: number; values: SettingsValues };
export type SettingsUpdate = { [Section in SettingsSection]: { section: Section; expectedVersion: number; value: SettingsValues[Section] } }[SettingsSection];
export type SettingsField = 'general.locale' | 'general.zoomFactor' | 'general.startup' | 'general.reducedMotion' | 'learning.tipsEnabled' | 'contributor.name' | 'contributor.email';
export type SettingsValidationIssue = { field: SettingsField; reason: 'locale' | 'zoom' | 'startup' | 'motion' | 'boolean' | 'name' | 'email' | 'shape' };
export type SettingsLibraryInfo = { location: string; bytes: number; files: number; measuredAt: string };
export type SettingsJourney = 'investigation' | 'data';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: unknown, names: string[]) => record(value) && Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key));
export const validSettingsVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function defaultSettingsValues(): SettingsValues {
  return { general: { locale: 'en', zoomFactor: 1, startup: 'resume', reducedMotion: 'system' }, learning: { tipsEnabled: true }, contributor: { ...DEFAULT_EDITORIAL_IDENTITY } };
}
export function settingsSectionIssues(section: SettingsSection, input: unknown): SettingsValidationIssue[] {
  const value = record(input) ? input : {}, issues: SettingsValidationIssue[] = [];
  if (section === 'general') {
    if (!keys(input, ['locale', 'zoomFactor', 'startup', 'reducedMotion'])) issues.push({ field: 'general.locale', reason: 'shape' });
    if (typeof value.locale !== 'string' || !['en', 'zh-CN'].includes(value.locale)) issues.push({ field: 'general.locale', reason: 'locale' });
    if (typeof value.zoomFactor !== 'number' || !Number.isFinite(value.zoomFactor) || value.zoomFactor < 0.75 || value.zoomFactor > 2) issues.push({ field: 'general.zoomFactor', reason: 'zoom' });
    if (typeof value.startup !== 'string' || !['resume', 'world'].includes(value.startup)) issues.push({ field: 'general.startup', reason: 'startup' });
    if (typeof value.reducedMotion !== 'string' || !['system', 'reduce'].includes(value.reducedMotion)) issues.push({ field: 'general.reducedMotion', reason: 'motion' });
  } else if (section === 'learning') {
    if (!keys(input, ['tipsEnabled'])) issues.push({ field: 'learning.tipsEnabled', reason: 'shape' });
    if (typeof value.tipsEnabled !== 'boolean') issues.push({ field: 'learning.tipsEnabled', reason: 'boolean' });
  } else if (section === 'contributor') {
    if (!keys(input, ['name', 'email'])) issues.push({ field: 'contributor.name', reason: 'shape' });
    if (!validEditorialIdentity({ name: value.name, email: DEFAULT_EDITORIAL_IDENTITY.email })) issues.push({ field: 'contributor.name', reason: 'name' });
    if (!validEditorialIdentity({ name: DEFAULT_EDITORIAL_IDENTITY.name, email: value.email })) issues.push({ field: 'contributor.email', reason: 'email' });
  }
  return issues;
}
export function validSettingsValues(input: unknown): input is SettingsValues {
  return keys(input, ['general', 'learning', 'contributor']) && (['general', 'learning', 'contributor'] as const).every(section => !settingsSectionIssues(section, (input as Record<string, unknown>)[section]).length);
}
export function validSettingsUpdate(input: unknown): input is SettingsUpdate {
  if (!keys(input, ['section', 'expectedVersion', 'value']) || !record(input) || typeof input.section !== 'string' || !['general', 'learning', 'contributor'].includes(input.section) || !validSettingsVersion(input.expectedVersion) || input.expectedVersion === Number.MAX_SAFE_INTEGER) return false;
  return settingsSectionIssues(input.section as SettingsSection, input.value).length === 0;
}
