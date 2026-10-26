import type { DataPackage, HistoryText, SnapshotField } from '@gitworld/domain';
import type { ModelRead } from '@gitworld/contracts';

const projections = new WeakMap<DataPackage, DataPackage>();
const texts = new WeakMap<HistoryText, HistoryText>();

/** Keep translated display copies outside the canonical package and history engine. */
export function rememberModelPresentation(read: ModelRead) {
  const data = read.package, overlay = read.presentation;
  if (!overlay) return;
  if (overlay.contentHash !== read.contentHash) throw new Error('CONTENT_CHANGED');
  const display = structuredClone(data);
  for (const entry of overlay.zhCN) {
    let raw: unknown = data, shown: unknown = display;
    for (const key of entry.path) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !raw || !shown || typeof raw !== 'object' || typeof shown !== 'object') throw new Error('INVALID_PRESENTATION');
      raw = (raw as Record<string, unknown>)[key]; shown = (shown as Record<string, unknown>)[key];
    }
    if (!raw || !shown || typeof raw !== 'object' || typeof shown !== 'object' || typeof (raw as HistoryText).en !== 'string' || (raw as HistoryText)['zh-CN'] !== undefined || typeof entry.text !== 'string') throw new Error('INVALID_PRESENTATION');
    (shown as HistoryText)['zh-CN'] = entry.text; texts.set(raw as HistoryText, shown as HistoryText);
  }
  projections.set(data, display);
}
export const displayModel = (data: DataPackage) => projections.get(data) ?? data;
export const displayModelText = (text: HistoryText) => texts.get(text) ?? text;
export function displayModelField(data: DataPackage, field: SnapshotField): SnapshotField {
  const value = displayModel(data).history.commits.find(commit => commit.id === field.changedAt)?.changes[field.fieldId];
  return value ? { ...field, label: value.label, ...(value.note ? { note: value.note } : {}), ...(value.evidence ? { evidence: value.evidence } : {}) } : field;
}
