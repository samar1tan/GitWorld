import type { KnowledgeTemporalScope, KnowledgeTime, KnowledgeValue } from '../../../../packages/domain/src/knowledge.ts';
import type { KnowledgeEditChange } from '../../../../packages/contracts/src/knowledge-editor-types.ts';

export type ObjectEditForm = {
  mode: 'add' | 'correct'; assertionId: string; nameEn: string; nameZh: string; typeId: string; propertyId: string;
  valueMode: 'keep' | 'replace'; valueKind: 'text' | 'entity' | 'number' | 'boolean' | 'time' | 'coordinate' | 'unknown' | 'absent';
  text: string; language: string; number: string; unit: string; lower: string; upper: string;
  entityQuery: string; entityId: string; entityLabel: string; boolean: 'true' | 'false'; earliest: string; latest: string; longitude: string; latitude: string;
  timeMode: 'keep' | 'none' | 'point' | 'range'; from: string; to: string; possible: boolean;
  sourceMode: 'existing' | 'citation'; sourceId: string; sourceTitle: string; sourceUrl: string; locator: string; citation: string;
  review: 'unreviewed' | 'adopted'; reason: string;
};
export type ObjectEditValidation = 'nameRequired' | 'claimRequired' | 'fieldRequired' | 'valueRequired' | 'entityRequired' | 'invalidNumber' | 'invalidCoordinate' | 'invalidTime' | 'sourceRequired' | 'httpsRequired' | 'locatorRequired' | 'reasonRequired';
export const blankObjectEditForm = (): ObjectEditForm => ({ mode: 'add', assertionId: '', nameEn: '', nameZh: '', typeId: '', propertyId: '', valueMode: 'replace', valueKind: 'text', text: '', language: 'en', number: '', unit: '1', lower: '', upper: '', entityQuery: '', entityId: '', entityLabel: '', boolean: 'true', earliest: '', latest: '', longitude: '', latitude: '', timeMode: 'point', from: '', to: '', possible: false, sourceMode: 'citation', sourceId: '', sourceTitle: '', sourceUrl: '', locator: '', citation: '', review: 'unreviewed', reason: '' });
const year = (value: string) => /^-?[1-9]\d*$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const time = (value: number): KnowledgeTime => ({ earliestYear: value, latestYear: value, precision: 'year', calendar: 'source-civil-year' });
const finite = (value: string) => !!value.trim() && Number.isFinite(Number(value));

/** Omitted correction fields stay on the service's guarded original assertion. */
export function parseObjectEditForm(form: ObjectEditForm, existingObject: boolean): { ok: true; change: KnowledgeEditChange } | { ok: false; code: ObjectEditValidation } {
  const bad = (code: ObjectEditValidation) => ({ ok: false as const, code });
  if (!existingObject && !form.nameEn.trim() && !form.nameZh.trim()) return bad('nameRequired');
  if (form.mode === 'correct' && !form.assertionId) return bad('claimRequired');
  if (!form.propertyId) return bad('fieldRequired');
  let value: KnowledgeValue | undefined;
  if (form.mode === 'add' || form.valueMode === 'replace') {
    if (form.valueKind === 'text') { if (!form.text.trim()) return bad('valueRequired'); value = { kind: 'text', value: form.text, ...(form.language.trim() ? { language: form.language.trim() } : {}) }; }
    else if (form.valueKind === 'entity') { if (!form.entityId) return bad('entityRequired'); value = { kind: 'entity', objectId: form.entityId }; }
    else if (form.valueKind === 'number') {
      if (!finite(form.number) || form.lower.trim() && !finite(form.lower) || form.upper.trim() && !finite(form.upper)) return bad('invalidNumber');
      const number = Number(form.number), lower = form.lower.trim() ? Number(form.lower) : undefined, upper = form.upper.trim() ? Number(form.upper) : undefined;
      if (lower !== undefined && lower > number || upper !== undefined && upper < number) return bad('invalidNumber');
      value = { kind: 'number', value: number, ...(form.unit ? { unit: form.unit } : {}), ...(lower !== undefined ? { lowerBound: lower } : {}), ...(upper !== undefined ? { upperBound: upper } : {}) };
    } else if (form.valueKind === 'boolean') value = { kind: 'boolean', value: form.boolean === 'true' };
    else if (form.valueKind === 'time') {
      const first = year(form.earliest), last = form.latest.trim() ? year(form.latest) : first;
      if (first === null || last === null || first > last) return bad('invalidTime');
      value = { kind: 'time', value: { ...time(first), latestYear: last, precision: first === last ? 'year' : 'interval' } };
    } else if (form.valueKind === 'coordinate') {
      if (!finite(form.longitude) || !finite(form.latitude) || Math.abs(Number(form.longitude)) > 180 || Math.abs(Number(form.latitude)) > 90) return bad('invalidCoordinate');
      value = { kind: 'coordinate', longitude: Number(form.longitude), latitude: Number(form.latitude), globe: 'earth' };
    } else value = { kind: form.valueKind };
  }
  let validTime: KnowledgeTemporalScope | null | undefined;
  if (form.mode === 'correct' && form.timeMode === 'keep') validTime = undefined;
  else if (form.timeMode === 'none') validTime = null;
  else {
    const from = year(form.from), to = form.timeMode === 'range' ? year(form.to) : from;
    if (from === null || to === null || from > to) return bad('invalidTime');
    validTime = { ...(form.timeMode === 'range' ? { start: time(from), end: time(to) } : { point: time(from) }), ...(form.possible ? { certainty: 'possible' as const } : {}) };
  }
  if (!form.locator.trim()) return bad('locatorRequired');
  let evidence: KnowledgeEditChange['evidence'];
  if (form.sourceMode === 'existing') {
    if (!form.sourceId) return bad('sourceRequired');
    evidence = { sourceId: form.sourceId, locator: form.locator.trim(), ...(form.citation.trim() ? { citation: form.citation.trim() } : {}) };
  } else {
    if (!form.sourceTitle.trim()) return bad('sourceRequired');
    try { const url = new URL(form.sourceUrl); if (url.protocol !== 'https:' || url.username || url.password) return bad('httpsRequired'); } catch { return bad('httpsRequired'); }
    evidence = { title: form.sourceTitle.trim(), url: form.sourceUrl.trim(), locator: form.locator.trim(), ...(form.citation.trim() ? { citation: form.citation.trim() } : {}) };
  }
  if (!form.reason.trim()) return bad('reasonRequired');
  const common = { propertyId: form.propertyId, evidence, reason: form.reason.trim(), review: form.review, ...(validTime !== undefined ? { validTime } : {}) };
  if (form.mode === 'correct') return { ok: true, change: { ...common, mode: 'correct', ...(value ? { value } : {}) } };
  if (!value) return bad('valueRequired');
  return { ok: true, change: { ...common, mode: 'add', value, ...(!existingObject ? { newObject: { labels: { ...(form.nameEn.trim() ? { en: form.nameEn.trim() } : {}), ...(form.nameZh.trim() ? { 'zh-CN': form.nameZh.trim() } : {}) }, types: form.typeId ? [form.typeId] : [] } } : {}) } };
}

export function parseObjectEditRecovery(value: string | null): { form: ObjectEditForm; target: { objectId?: string; assertionId?: string; year?: number; observedRevision?: string }; expectedHead: string; expectedObjectHash: string | null; attemptId: string | null } | null {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null'); if (!parsed || typeof parsed !== 'object') return null;
    const saved = parsed as Record<string, unknown>; if (saved.schemaVersion !== 1 || !saved.form || typeof saved.form !== 'object' || !saved.target || typeof saved.target !== 'object' || typeof saved.expectedHead !== 'string' || !/^[a-f0-9]{40}$/.test(saved.expectedHead) || !(saved.expectedObjectHash === null || typeof saved.expectedObjectHash === 'string' && /^[a-f0-9]{64}$/.test(saved.expectedObjectHash))) return null;
    const form = blankObjectEditForm(), source = saved.form as Record<string, unknown>;
    for (const key of Object.keys(form) as (keyof ObjectEditForm)[]) { const value = source[key]; if (typeof form[key] !== typeof value || typeof value === 'string' && value.length > 20_000) return null; (form as unknown as Record<string, unknown>)[key] = value; }
    if (!['add', 'correct'].includes(form.mode) || !['keep', 'replace'].includes(form.valueMode) || !['text', 'entity', 'number', 'boolean', 'time', 'coordinate', 'unknown', 'absent'].includes(form.valueKind) || !['keep', 'none', 'point', 'range'].includes(form.timeMode) || !['existing', 'citation'].includes(form.sourceMode) || !['unreviewed', 'adopted'].includes(form.review) || !['true', 'false'].includes(form.boolean)) return null;
    const target = saved.target as Record<string, unknown>;
    if (Object.keys(target).some(key => !['objectId', 'assertionId', 'year', 'observedRevision'].includes(key)) || ['objectId', 'assertionId', 'observedRevision'].some(key => target[key] !== undefined && (typeof target[key] !== 'string' || (target[key] as string).length > 500)) || target.year !== undefined && (!Number.isSafeInteger(target.year) || target.year === 0)) return null;
    if (!(saved.attemptId === null || typeof saved.attemptId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(saved.attemptId))) return null;
    return { form, target: target as { objectId?: string; assertionId?: string; year?: number; observedRevision?: string }, expectedHead: saved.expectedHead, expectedObjectHash: saved.expectedObjectHash as string | null, attemptId: saved.attemptId };
  } catch { return null; }
}
