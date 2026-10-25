import { createHistoryEngine } from './history-engine.ts';
import { isHistoricalDate, isHistoricalYear } from './dates.ts';
import { canonicalJson } from './canonical.ts';
import type { DataPackage, ValidationIssue, ValidationMode, ValidationResult } from './package.ts';

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(v) && !v.split(/[/.]/).some(x => ['__proto__', 'constructor', 'prototype', '..'].includes(x)) && !v.includes('//') && !v.endsWith('/');
export const isText = (v: unknown): boolean => isRecord(v) && typeof v.en === 'string' && !!v.en.trim() && (v['zh-CN'] === undefined || typeof v['zh-CN'] === 'string' && !!v['zh-CN'].trim()) && Object.keys(v).every(k => ['en', 'zh-CN'].includes(k));
export const isString = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 1_000_000;
export const isTimestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
export const isCoverage = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(isHistoricalYear) && v[0] <= v[1];
export const isMapBox = (v: unknown): boolean => isRecord(v) && ['x', 'y', 'width', 'height'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k])) && Number(v.width) > 0 && Number(v.height) > 0;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(isId) && new Set(v).size === v.length;
const evidence = (v: unknown): boolean => Array.isArray(v) && v.every(e => isRecord(e) && isId(e.sourceId) && typeof e.locator === 'string' && (e.note === undefined || isText(e.note)));
const optional = (v: unknown, check: (value: unknown) => boolean) => v === undefined || check(v);

/** Reject hostile or non-JSON values before traversal, cloning, or domain evaluation. */
export function validateJsonBoundary(input: unknown): ValidationIssue[] {
  const seen = new Set<object>(); let nodes = 0; let bytes = 0;
  const walk = (v: unknown, depth: number): boolean => {
    if (++nodes > 200_000 || depth > 40) return false;
    if (typeof v === 'string') { bytes += v.length; return bytes <= 16_000_000; }
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (!Array.isArray(v) && !isRecord(v)) return false;
    if (seen.has(v)) return false;
    seen.add(v);
    if (!Array.isArray(v) && Object.keys(v).some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) return false;
    const valid = Object.values(v).every(x => walk(x, depth + 1));
    seen.delete(v); return valid;
  };
  return walk(input, 0) ? [] : [{ code: 'LIMIT_EXCEEDED', path: '$' }];
}

export function validateDataPackage(input: unknown, mode: ValidationMode = 'draft'): ValidationResult<DataPackage> {
  const issues = validateJsonBoundary(input);
  const add = (code: ValidationIssue['code'], path: string, parameters?: ValidationIssue['parameters']) => issues.push({ code, path, ...(parameters ? { parameters } : {}) });
  const shape = (condition: boolean, path: string) => { if (!condition) add('INVALID_SHAPE', path); };
  if (issues.length) return { ok: false, issues };
  if (!isRecord(input)) return { ok: false, issues: [{ code: 'INVALID_SHAPE', path: '$' }] };
  if (input.schemaVersion !== 1) return { ok: false, issues: [{ code: 'UNSUPPORTED_SCHEMA', path: '$.schemaVersion' }] };
  const d = input.dataset, r = input.revision, c = input.catalog, h = input.history;
  if (!isRecord(d) || !isRecord(r) || !isRecord(c) || !isRecord(h)) return { ok: false, issues: [{ code: 'INVALID_SHAPE', path: '$' }] };
  shape(isId(d.id) && isText(d.name) && isText(d.description) && isString(d.license), '$.dataset');
  shape(isId(r.id) && (r.parentRevisionId === null || isId(r.parentRevisionId)) && isTimestamp(r.createdAt) && isText(r.notes), '$.revision');
  shape(isId(h.id) && isId(h.datasetId), '$.history');
  const arrayAt = (owner: Record<string, unknown>, key: string, path: string): Record<string, unknown>[] => {
    const value = owner[key];
    if (!Array.isArray(value) || !value.every(isRecord)) { add('INVALID_SHAPE', `${path}.${key}`); return []; }
    return value;
  };
  const scopes = arrayAt(c, 'scopes', '$.catalog'), processes = arrayAt(c, 'processes', '$.catalog'), events = arrayAt(c, 'events', '$.catalog'), places = arrayAt(c, 'places', '$.catalog');
  const branches = arrayAt(h, 'branches', '$.history'), commits = arrayAt(h, 'commits', '$.history'), fields = arrayAt(h, 'fields', '$.history'), tags = arrayAt(h, 'tags', '$.history'), relationships = arrayAt(h, 'relationships', '$.history');
  const sources = isRecord(h.sources) && Object.values(h.sources).every(isRecord) ? Object.values(h.sources) as Record<string, unknown>[] : [];
  shape(isRecord(h.sources) && Object.values(h.sources).every(isRecord), '$.history.sources');
  for (const [name, list] of Object.entries({ scopes, processes, events, places, branches, commits, fields, tags, relationships, sources })) {
    const unique = new Set();
    for (const [i, row] of list.entries()) {
      if (!isId(row.id) || row.id === 'HEAD') add('INVALID_ID', `${name}[${i}].id`);
      if (unique.has(row.id)) add('DUPLICATE_ID', `${name}[${i}].id`);
      unique.add(row.id);
    }
  }
  for (const s of scopes) shape(isText(s.name) && isText(s.summary) && (s.parentId === null || isId(s.parentId)) && isCoverage(s.coverage) && ids(s.sourceIds) && optional(s.viewBox, isMapBox) && optional(s.location, v => isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number'), `scope:${s.id}`);
  for (const p of processes) shape(isText(p.name) && isText(p.summary) && ids(p.scopeIds) && (p.scopeIds as string[])?.length > 0 && isCoverage(p.coverage) && ids(p.branchIds) && ids(p.eventIds) && ids(p.sourceIds), `process:${p.id}`);
  for (const e of events) shape(isText(e.title) && isText(e.summary) && ids(e.commitIds) && ids(e.sourceIds), `event:${e.id}`);
  for (const p of places) shape(isText(p.name) && ids(p.scopeIds) && typeof p.longitude === 'number' && Math.abs(p.longitude) <= 180 && typeof p.latitude === 'number' && Math.abs(p.latitude) <= 90, `place:${p.id}`);
  for (const b of branches) shape(isText(b.name) && isText(b.description) && isId(b.scopeId) && isId(b.processId) && isCoverage(b.coverage) && ids(b.commitIds) && (b.commitIds as string[])?.length > 0 && optional(b.forkCommitId, isId) && optional(b.color, v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)), `branch:${b.id}`);
  for (const f of fields) shape(isText(f.name) && isId(f.group) && optional(f.description, isText) && optional(f.valueType, v => ['concept', 'text', 'number', 'boolean', 'set'].includes(String(v))) && optional(f.applicableScopeIds, ids), `field:${f.id}`);
  for (const s of sources) {
    let urlValid = false;
    try { const url = new URL(String(s.url)); urlValid = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Invalid URLs produce a structured finding. */ }
    shape(isString(s.title) && isString(s.publisher) && isString(s.language) && urlValid && optional(s.content, isString) && optional(s.retrievedAt, isTimestamp), `source:${s.id}`);
    if (s.rights !== undefined) {
      const q = s.rights;
      shape(isRecord(q) && ['unreviewed', 'approved', 'restricted', 'rejected'].includes(String(q.status)) && isString(q.license) && isString(q.basis) && ['allowed', 'citation-only', 'prohibited'].includes(String(q.redistribution)) && optional(q.reviewedAt, isTimestamp) && optional(q.reviewedBy, isString), `source:${s.id}.rights`);
    }
  }
  for (const t of tags) shape(isText(t.name) && isId(t.commitId) && optional(t.description, isText), `tag:${t.id}`);
  for (const link of relationships) shape(['influence', 'contact'].includes(String(link.kind)) && isId(link.fromCommitId) && isId(link.toCommitId) && ids(link.fieldIds) && isText(link.summary) && evidence(link.evidence), `relationship:${link.id}`);
  for (const commit of commits) {
    shape(isId(commit.branchId) && isHistoricalYear(commit.year) && isText(commit.title) && isText(commit.summary) && ids(commit.parents) && ids(commit.sourceIds) && isRecord(commit.changes) && optional(commit.eventId, isId) && optional(commit.note, isText), `commit:${commit.id}`);
    if (!isHistoricalDate(commit.date) || commit.year !== commit.date.latestYear) add('INVALID_DATE', `commit:${commit.id}.date`);
    shape(['baseline', 'change', 'split', 'integration'].includes(String(commit.kind)), `commit:${commit.id}.kind`);
    shape(Array.isArray(commit.lineage) && commit.lineage.every(l => isRecord(l) && isId(l.parentId) && ['continuation', 'split', 'integration'].includes(String(l.kind)) && evidence(l.evidence)), `commit:${commit.id}.lineage`);
    shape(evidence(commit.evidence), `commit:${commit.id}.evidence`);
    if (isRecord(commit.changes)) for (const [fieldId, value] of Object.entries(commit.changes)) {
      if (!isId(fieldId)) add('INVALID_ID', `commit:${commit.id}.changes`);
      if (value === null) continue;
      shape(isRecord(value) && (value.key === null || isString(value.key)) && ['known', 'unknown', 'not-applicable'].includes(String(value.status)) && isText(value.label) && ids(value.sourceIds) && evidence(value.evidence) && optional(value.note, isText) && optional(value.certainty, v => ['documented', 'inferred', 'disputed'].includes(String(v))), `commit:${commit.id}.changes.${fieldId}`);
    }
    if (commit.integration !== undefined) {
      shape(isRecord(commit.integration) && isRecord(commit.integration.resolutions) && Object.values(commit.integration.resolutions).every(x => isRecord(x) && ['retain', 'modify', 'unknown', 'not-applicable', 'absent'].includes(String(x.strategy)) && ids(x.parentIds) && evidence(x.evidence) && optional(x.note, isText)), `commit:${commit.id}.integration`);
    }
  }
  shape(isRecord(c.defaults) && isCoverage(c.defaults.timeWindow) && (c.defaults.scopeId === null || isId(c.defaults.scopeId)) && isMapBox(c.defaults.worldView), '$.catalog.defaults');
  if (issues.length) return { ok: false, issues };
  const data = input as unknown as DataPackage;
  if (mode === 'shape') return { ok: true, value: structuredClone(data), issues: [] };
  if (mode === 'publish' && (!data.history.commits.length || !data.catalog.scopes.length || !data.catalog.processes.length)) add('INVALID_GRAPH', '$.history');
  if (data.history.id !== data.revision.id || data.history.datasetId !== data.dataset.id || data.revision.parentRevisionId === data.revision.id) add('REVISION_MISMATCH', '$.revision');
  const scopeMap = new Map(data.catalog.scopes.map(x => [x.id, x]));
  const processMap = new Map(data.catalog.processes.map(x => [x.id, x]));
  const eventMap = new Map(data.catalog.events.map(x => [x.id, x]));
  const commitMap = new Map(data.history.commits.map(x => [x.id, x]));
  const branchMap = new Map(data.history.branches.map(x => [x.id, x]));
  const fieldMap = new Map(data.history.fields.map(x => [x.id, x]));
  const checkRefs = (values: string[], exists: (id: string) => boolean, path: string) => { for (const id of values) if (!exists(id)) add('DANGLING_REFERENCE', path, { id }); };
  const checkEvidence = (list: { sourceId: string; locator: string }[], path: string, required: boolean) => {
    checkRefs(list.map(x => x.sourceId), id => Object.hasOwn(data.history.sources, id), path);
    if (mode === 'publish' && (required && !list.length || list.some(x => !x.locator.trim()))) add('MISSING_EVIDENCE', path);
  };
  for (const scope of data.catalog.scopes) {
    if (scope.parentId) checkRefs([scope.parentId], id => scopeMap.has(id), `scope:${scope.id}.parentId`);
    const seen = new Set<string>(); let current: typeof scope | undefined = scope;
    while (current) { if (seen.has(current.id)) { add('INVALID_GRAPH', `scope:${scope.id}.parentId`); break; } seen.add(current.id); current = current.parentId ? scopeMap.get(current.parentId) : undefined; }
    checkRefs(scope.sourceIds, id => Object.hasOwn(data.history.sources, id), `scope:${scope.id}.sourceIds`);
  }
  if (data.catalog.defaults.scopeId) checkRefs([data.catalog.defaults.scopeId], id => scopeMap.has(id), '$.catalog.defaults.scopeId');
  for (const p of data.catalog.processes) {
    checkRefs(p.scopeIds, id => scopeMap.has(id), `process:${p.id}.scopeIds`);
    checkRefs(p.branchIds, id => branchMap.has(id), `process:${p.id}.branchIds`);
    checkRefs(p.eventIds, id => eventMap.has(id), `process:${p.id}.eventIds`);
    checkRefs(p.sourceIds, id => Object.hasOwn(data.history.sources, id), `process:${p.id}.sourceIds`);
    if (p.branchIds.some(id => branchMap.get(id)?.processId !== p.id)) add('DANGLING_REFERENCE', `process:${p.id}.branchIds`);
  }
  for (const e of data.catalog.events) {
    checkRefs(e.commitIds, id => commitMap.has(id), `event:${e.id}.commitIds`);
    checkRefs(e.sourceIds, id => Object.hasOwn(data.history.sources, id), `event:${e.id}.sourceIds`);
    if (e.commitIds.some(id => commitMap.get(id)?.eventId !== e.id)) add('DANGLING_REFERENCE', `event:${e.id}.commitIds`);
  }
  for (const p of data.catalog.places) checkRefs(p.scopeIds, id => scopeMap.has(id), `place:${p.id}.scopeIds`);
  for (const b of data.history.branches) {
    checkRefs([b.scopeId], id => scopeMap.has(id), `branch:${b.id}.scopeId`);
    checkRefs([b.processId], id => processMap.has(id), `branch:${b.id}.processId`);
    const p = processMap.get(b.processId);
    if (p && (!p.branchIds.includes(b.id) || !p.scopeIds.includes(b.scopeId) || b.coverage[0] < p.coverage[0] || b.coverage[1] > p.coverage[1])) add('INVALID_GRAPH', `branch:${b.id}.processId`);
  }
  for (const f of data.history.fields) checkRefs(f.applicableScopeIds ?? [], id => scopeMap.has(id), `field:${f.id}.applicableScopeIds`);
  for (const [id, s] of Object.entries(data.history.sources)) {
    if (id !== s.id) add('INVALID_ID', `source:${id}`);
    if (mode === 'publish' && (s.rights?.status !== 'approved' || !s.rights.reviewedBy || !s.rights.reviewedAt)) add('RIGHTS_UNREVIEWED', `source:${id}.rights`);
    if (mode === 'publish' && (s.rights?.redistribution === 'prohibited' || s.content && s.rights?.redistribution !== 'allowed')) add('REDISTRIBUTION_DENIED', `source:${id}`);
  }
  for (const tag of data.history.tags!) checkRefs([tag.commitId], id => commitMap.has(id), `tag:${tag.id}.commitId`);
  for (const link of data.history.relationships!) {
    checkRefs([link.fromCommitId, link.toCommitId], id => commitMap.has(id), `relationship:${link.id}`);
    checkRefs(link.fieldIds, id => fieldMap.has(id), `relationship:${link.id}.fieldIds`);
    if (link.fromCommitId === link.toCommitId) add('INVALID_GRAPH', `relationship:${link.id}`);
    checkEvidence(link.evidence, `relationship:${link.id}.evidence`, true);
  }
  for (const commit of data.history.commits) {
    if (commit.eventId && !eventMap.get(commit.eventId)?.commitIds.includes(commit.id)) add('DANGLING_REFERENCE', `commit:${commit.id}.eventId`);
    const lineage = commit.lineage!;
    if (new Set(lineage.map(x => x.parentId)).size !== lineage.length || lineage.length !== commit.parents.length || lineage.some(x => !commit.parents.includes(x.parentId))) add('INVALID_GRAPH', `commit:${commit.id}.lineage`);
    if ((commit.parents.length === 0) !== (commit.kind === 'baseline')) add('INVALID_GRAPH', `commit:${commit.id}.kind`);
    if (commit.parents.length > 1 && (commit.kind !== 'integration' || !commit.integration || lineage.some(x => x.kind !== 'integration'))) add('INTEGRATION_REQUIRED', `commit:${commit.id}`);
    if (commit.kind === 'integration' && commit.parents.length < 2) add('INVALID_GRAPH', `commit:${commit.id}.kind`);
    for (const edge of lineage) checkEvidence(edge.evidence, `commit:${commit.id}.lineage.${edge.parentId}`, true);
    checkEvidence(commit.evidence!, `commit:${commit.id}.evidence`, true);
    if (mode === 'publish' && commit.sourceIds.some(id => !commit.evidence!.some(e => e.sourceId === id))) add('MISSING_EVIDENCE', `commit:${commit.id}.sourceIds`);
    for (const [fieldId, value] of Object.entries(commit.changes)) {
      if (value === null) continue;
      checkEvidence(value.evidence!, `commit:${commit.id}.changes.${fieldId}.evidence`, value.status === 'known');
      if (value.evidence!.some(e => !value.sourceIds.includes(e.sourceId)) || mode === 'publish' && value.status === 'known' && value.sourceIds.some(id => !value.evidence!.some(e => e.sourceId === id))) add('MISSING_EVIDENCE', `commit:${commit.id}.changes.${fieldId}`);
      const type = fieldMap.get(fieldId)?.valueType ?? 'concept';
      if (value.status === 'known' && type !== 'concept' && (type === 'set' ? !Array.isArray(value.value) || !value.value.every(x => typeof x === 'string') : typeof value.value !== (type === 'text' ? 'string' : type))) add('INVALID_VALUE', `commit:${commit.id}.changes.${fieldId}.value`);
      if (value.status !== 'known' && (value.value !== undefined || value.key !== null)) add('INVALID_VALUE', `commit:${commit.id}.changes.${fieldId}.value`);
      if (value.status === 'not-applicable' && !value.note) add('INVALID_VALUE', `commit:${commit.id}.changes.${fieldId}.note`);
      const applicable = fieldMap.get(fieldId)?.applicableScopeIds;
      if (value.status === 'known' && applicable?.length && !applicable.includes(branchMap.get(commit.branchId)?.scopeId ?? '')) add('INVALID_VALUE', `commit:${commit.id}.changes.${fieldId}`);
    }
    for (const [fieldId, resolution] of Object.entries(commit.integration?.resolutions ?? {})) {
      if (!Object.hasOwn(commit.changes, fieldId) || !resolution.parentIds.length || resolution.parentIds.some(id => !commit.parents.includes(id))) add('INTEGRATION_REQUIRED', `commit:${commit.id}.integration.${fieldId}`);
      const change = commit.changes[fieldId];
      if (resolution.strategy === 'absent' && change !== null || resolution.strategy === 'unknown' && change?.status !== 'unknown' || resolution.strategy === 'not-applicable' && change?.status !== 'not-applicable' || ['retain', 'modify'].includes(resolution.strategy) && change?.status !== 'known') add('INVALID_VALUE', `commit:${commit.id}.integration.${fieldId}`);
      checkEvidence(resolution.evidence, `commit:${commit.id}.integration.${fieldId}.evidence`, true);
    }
    if (commit.parents.length > 1) for (const fieldId of Object.keys(commit.changes)) if (!commit.integration?.resolutions[fieldId]) add('INTEGRATION_REQUIRED', `commit:${commit.id}.integration.${fieldId}`);
  }
  const stableValues = new Map<string, string>();
  for (const commit of data.history.commits) for (const [fieldId, value] of Object.entries(commit.changes)) if (value?.status === 'known' && value.value !== undefined) {
    const id = `${fieldId}:${value.key}`, encoded = canonicalJson(value.value);
    if (stableValues.has(id) && stableValues.get(id) !== encoded) add('INVALID_VALUE', `commit:${commit.id}.changes.${fieldId}.key`);
    stableValues.set(id, encoded);
  }
  if (issues.length) return { ok: false, issues };
  const engine = createHistoryEngine(data.history);
  for (const error of engine.validationErrors) add('INVALID_GRAPH', error.subject ?? '$.history');
  if (!engine.validationErrors.length) for (const commit of data.history.commits) {
    const snapshot = engine.snapshot(commit.id);
    if (!snapshot.ok) add('INVALID_GRAPH', snapshot.error.subject ?? `commit:${commit.id}`);
    for (const [fieldId, resolution] of Object.entries(commit.integration?.resolutions ?? {})) if (resolution.strategy === 'retain') {
      const value = commit.changes[fieldId];
      const matches = resolution.parentIds.every(parentId => { const parent = engine.snapshot(parentId); return parent.ok && parent.value.fields[fieldId]?.key === value?.key && parent.value.fields[fieldId]?.status === 'known'; });
      if (!matches) add('INVALID_VALUE', `commit:${commit.id}.integration.${fieldId}`);
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: structuredClone(data), issues: [] };
}
