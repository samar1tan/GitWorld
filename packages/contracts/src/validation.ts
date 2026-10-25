import { isCoverage, isHistoricalYear, isId, isMapBox, isRecord, isString, isTimestamp, validateDataPackage, validateJsonBoundary } from '../../domain/src/index.ts';
import { createHistoryEngine } from '../../domain/src/history-engine.ts';
import { yearRef } from '../../domain/src/dates.ts';
import type { DataPackage, DatasetRef, ValidationIssue, ValidationResult } from '../../domain/src/package.ts';
import type { ServiceRequest, WorkspaceState } from './index.ts';
import { CLIENT_STATE_KEYS } from './client-state-types.ts';
import { EDITORIAL_MAX_PATHS } from './editorial-types.ts';
import { validSettingsUpdate } from './settings-types.ts';
import { validKnowledgeSaveEdit } from './knowledge-editor-validation.ts';
import { validWikipediaSelection, validWikipediaTitle } from './wikipedia-validation.ts';
import { validKnowledgeQuery } from './knowledge-query-validation.ts';
import { navigationPath, navigationRequestChecks, validNavigationCommand } from './navigation-validation.ts';

const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const externalEntity = (v: unknown) => typeof v === 'string' && /^(Q|P)[1-9][0-9]{0,15}$/.test(v);
const sourceJobId = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const gitOid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const revision = (v: unknown) => v === undefined || v === 'working' || gitOid(v);
const researchId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
const contentId = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 300 && !/[\x00-\x1f]/.test(v);
const stringIds = (v: unknown) => Array.isArray(v) && v.length <= 1000 && v.every(contentId);
const repositoryPaths = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= EDITORIAL_MAX_PATHS && new Set(v).size === v.length && v.every(path => typeof path === 'string' && (navigationPath(path) || /^(models|model|objects|assertions|research|sources|mappings|views)\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(path)) && !path.split('/').some(part => !part || part.startsWith('.')) && !path.includes('..'));
const branchName = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(v) && !v.includes('..');
function knowledgeQuery(v: unknown): boolean {
  return validKnowledgeQuery(v);
}
const stateRequest = (v: unknown) => isRecord(v) && Object.keys(v).every(key => ['objectId','year','propertyIds','includeUnreviewed'].includes(key)) && contentId(v.objectId) && isHistoricalYear(v.year) && (v.propertyIds === undefined || stringIds(v.propertyIds)) && (v.includeUnreviewed === undefined || typeof v.includeUnreviewed === 'boolean');
const nullableId = (v: unknown) => v === null || isId(v);
const datasetRef = (v: unknown): v is DatasetRef => isRecord(v) && isId(v.datasetId) && isId(v.revisionId) && Object.keys(v).length === 2;
const versionRef = (v: unknown) => isRecord(v) && isId(v.datasetId) && isId(v.revisionId) && isId(v.commitId) && (v.requestedYear === null || isHistoricalYear(v.requestedYear));
const view = (v: unknown) => isRecord(v) && ['browse', 'history', 'snapshot', 'compare'].includes(String(v.panel)) && ['scopeId', 'processId', 'eventId', 'selectedCommitId'].every(k => nullableId(v[k])) && (v.graphRef === null || isString(v.graphRef)) && (v.graphBranch === undefined || nullableId(v.graphBranch)) && (v.requestedYear === undefined || v.requestedYear === null || isHistoricalYear(v.requestedYear)) && isCoverage(v.timeWindow) && (v.cursor === null || isHistoricalYear(v.cursor)) && isMapBox(v.viewport);

export function validateWorkspace(input: unknown, data?: DataPackage, referencePackages: DataPackage[] = []): ValidationResult<WorkspaceState> {
  const issues = validateJsonBoundary(input);
  if (issues.length) return { ok: false, issues };
  if (!isRecord(input) || !isId(input.id) || !integer(input.version) || !datasetRef(input.dataset) || !['en', 'zh-CN'].includes(String(input.locale)) || !(input.head === null || versionRef(input.head)) || !(input.comparison === null || Array.isArray(input.comparison) && input.comparison.length === 2 && input.comparison.every(versionRef)) || !view(input.view) || !Array.isArray(input.trail) || input.trail.length > 100 || !input.trail.every(view)) return { ok: false, issues: [{ code: 'INVALID_SHAPE', path: '$.workspace' }] };
  const w = input as unknown as WorkspaceState;
  const refs = [w.head, ...(w.comparison ?? [])].filter(x => x !== null);
  for (const ref of refs) if (ref.datasetId !== w.dataset.datasetId || ref.revisionId !== w.dataset.revisionId && !gitOid(ref.revisionId)) issues.push({ code: 'REVISION_MISMATCH', path: '$.workspace' });
  if (data) {
    if (data.dataset.id !== w.dataset.datasetId || data.revision.id !== w.dataset.revisionId) issues.push({ code: 'REVISION_MISMATCH', path: '$.workspace.dataset' });
    const engine = createHistoryEngine(data.history);
    for (const ref of refs) {
      const referenceData = ref.revisionId === data.revision.id ? data : referencePackages.find(value => value.dataset.id === ref.datasetId && value.revision.id === ref.revisionId);
      if (!referenceData) { issues.push({ code: 'REVISION_MISMATCH', path: '$.workspace.refs' }); continue; }
      const referenceEngine = referenceData === data ? engine : createHistoryEngine(referenceData.history);
      const commit = referenceEngine.commits.get(ref.commitId);
      if (!commit) issues.push({ code: 'DANGLING_REFERENCE', path: '$.workspace.refs' });
      else if (ref.requestedYear !== null) {
        const resolved = referenceEngine.resolve(`${commit.branchId}@${yearRef(ref.requestedYear)}`);
        if (!resolved.ok || resolved.value.commitId !== commit.id) issues.push({ code: 'INVALID_DATE', path: '$.workspace.refs.requestedYear' });
      }
    }
    for (const item of [w.view, ...w.trail]) {
      if (item.scopeId && !data.catalog.scopes.some(x => x.id === item.scopeId) || item.processId && !data.catalog.processes.some(x => x.id === item.processId) || item.eventId && !data.catalog.events.some(x => x.id === item.eventId) || item.selectedCommitId && !engine.commits.has(item.selectedCommitId)) issues.push({ code: 'DANGLING_REFERENCE', path: '$.workspace.view' });
      if (item.graphRef && !engine.log(item.graphRef, { head: w.head?.commitId ?? null, currentYear: item.cursor }).ok) issues.push({ code: 'DANGLING_REFERENCE', path: '$.workspace.view.graphRef' });
      if (item.graphBranch && !engine.branches.has(item.graphBranch)) issues.push({ code: 'DANGLING_REFERENCE', path: '$.workspace.view.graphBranch' });
      if (item.requestedYear != null && item.selectedCommitId) { const c = engine.commits.get(item.selectedCommitId); const resolved = c && engine.resolve(`${c.branchId}@${yearRef(item.requestedYear)}`); if (!resolved?.ok || resolved.value.commitId !== c?.id) issues.push({ code: 'INVALID_DATE', path: '$.workspace.view.requestedYear' }); }
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: structuredClone(w), issues: [] };
}

function context(v: unknown): boolean {
  return isRecord(v) && nullableId(v.head) && (v.comparison === undefined || v.comparison === null || Array.isArray(v.comparison) && v.comparison.length === 2 && v.comparison.every(isId)) && (v.currentYear === undefined || v.currentYear === null || isHistoricalYear(v.currentYear)) && (v.scopeId === undefined || nullableId(v.scopeId)) && (v.selectedRef === undefined || nullableId(v.selectedRef)) && (v.timeWindow === undefined || isCoverage(v.timeWindow));
}
function intent(v: unknown): boolean {
  if (!isRecord(v)) return false;
  switch (v.type) {
    case 'status': case 'tag': return Object.keys(v).length === 1;
    case 'help': return (v.topic === undefined || isString(v.topic)) && Object.keys(v).every(k => ['type', 'topic'].includes(k));
    case 'branch': return typeof v.all === 'boolean' && Object.keys(v).length === 2;
    case 'search': return isString(v.query) && v.query.length <= 4096 && Object.keys(v).length === 2;
    case 'show': case 'checkout': case 'trace': return isString(v.ref) && Object.keys(v).length === 2;
    case 'log': return isString(v.ref) && typeof v.graph === 'boolean' && Object.keys(v).length === 3;
    case 'blame': return isString(v.ref) && isId(v.fieldId) && Object.keys(v).length === 3;
    case 'diff': return isString(v.a) && isString(v.b) && (v.mode === undefined || ['endpoints', 'merge-base'].includes(String(v.mode))) && Object.keys(v).every(k => ['type', 'a', 'b', 'mode'].includes(k));
    default: return false;
  }
}

const explicitRevision = (v: unknown) => v === 'working' || gitOid(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(key => keys.includes(key));
const modelTarget = (v: unknown) => isRecord(v) && exactKeys(v, ['kind','modelId','revision']) && v.kind === 'model' && isId(v.modelId) && explicitRevision(v.revision);
function repositoryIntent(v: unknown): boolean {
  if (!isRecord(v)) return false;
  switch (v.type) {
    case 'status': case 'abort-revert': return exactKeys(v, ['type']);
    case 'diff': return exactKeys(v, ['type','mode','paths','offset','limit']) && ['working','staged'].includes(String(v.mode)) && (v.paths === undefined || repositoryPaths(v.paths)) && (v.offset === undefined || integer(v.offset)) && (v.limit === undefined || integer(v.limit) && Number(v.limit) >= 1 && Number(v.limit) <= 100);
    case 'add': case 'unstage': return exactKeys(v, ['type','paths']) && repositoryPaths(v.paths);
    case 'commit': return exactKeys(v, ['type','message']) && typeof v.message === 'string' && v.message.trim().length > 0 && v.message.length <= 16000;
    case 'log': return exactKeys(v, ['type','limit']) && (v.limit === undefined || integer(v.limit) && Number(v.limit) >= 1 && Number(v.limit) <= 100);
    case 'branch': return exactKeys(v, ['type','name']) && (v.name === undefined || branchName(v.name));
    case 'switch': return exactKeys(v, ['type','name']) && branchName(v.name);
    case 'checkout': return exactKeys(v, ['type','oid']) && gitOid(v.oid);
    case 'revert': return exactKeys(v, ['type','commitOid']) && gitOid(v.commitOid);
    default: return false;
  }
}
function workbenchIntent(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (v.family === 'scope') return exactKeys(v,['family','intent']) && validNavigationCommand(v.intent);
  if (v.family === 'git') return exactKeys(v, ['family','intent']) && repositoryIntent(v.intent);
  if (v.family !== 'history' || !isRecord(v.target) || !explicitRevision(v.target.revision)) return false;
  const t = v.target;
  if (t.kind === 'model') {
    const i = v.intent;
    const endpoint = (value: unknown) => isRecord(value) && exactKeys(value, ['kind','modelId','revision','ref']) && value.kind === 'model' && isId(value.modelId) && explicitRevision(value.revision) && isString(value.ref) && value.ref.length <= 4096;
    const compare = isRecord(i) && i.type === 'compare' && exactKeys(i, ['type','a','b','mode']) && endpoint(i.a) && endpoint(i.b) && (i.mode === undefined || i.mode === 'endpoints' || i.mode === 'merge-base');
    const bounded = isRecord(i) && ['ref','a','b','topic'].every(key => i[key] === undefined || typeof i[key] === 'string' && i[key].length <= 4096);
    return exactKeys(v, ['family','target','intent','context']) && exactKeys(t, ['kind','modelId','revision']) && isId(t.modelId) && (intent(i) && bounded || compare) && context(v.context);
  }
  if (t.kind !== 'object' || !exactKeys(v, ['family','target','intent']) || !exactKeys(t, ['kind','objectId','revision']) || !contentId(t.objectId) || !isRecord(v.intent)) return false;
  const i = v.intent, state = (value: unknown) => isRecord(value) && exactKeys(value, ['year','propertyIds','includeUnreviewed']) && stateRequest({ ...value, objectId: t.objectId });
  switch (i.type) {
    case 'show': case 'checkout': return exactKeys(i, ['type','state']) && state(i.state);
    case 'log': return exactKeys(i, ['type','propertyIds','includeUnreviewed']) && (i.propertyIds === undefined || stringIds(i.propertyIds)) && (i.includeUnreviewed === undefined || typeof i.includeUnreviewed === 'boolean');
    case 'diff': return exactKeys(i, ['type','a','b']) && state(i.a) && isRecord(i.b) && exactKeys(i.b, ['kind','objectId','revision','year','propertyIds','includeUnreviewed']) && i.b.kind === 'object' && contentId(i.b.objectId) && explicitRevision(i.b.revision) && stateRequest({ objectId: i.b.objectId, year: i.b.year, ...(i.b.propertyIds === undefined ? {} : { propertyIds: i.b.propertyIds }), ...(i.b.includeUnreviewed === undefined ? {} : { includeUnreviewed: i.b.includeUnreviewed }) });
    default: return false;
  }
}

export function validateServiceRequest(input: unknown): ValidationResult<ServiceRequest> {
  const issues = validateJsonBoundary(input);
  if (issues.length) return { ok: false, issues };
  if (!isRecord(input) || input.protocolVersion !== 1 || !isId(input.requestId) || typeof input.method !== 'string' || !isRecord(input.params) || Object.keys(input).some(k => !['protocolVersion', 'requestId', 'method', 'params'].includes(k))) return { ok: false, issues: [{ code: 'INVALID_SHAPE', path: '$.request' }] };
  const p = input.params;
  const checks: Record<string, { keys: string[]; valid: () => boolean }> = {
    ...navigationRequestChecks(p),
    'library.status': { keys: [], valid: () => true },
    'revision.list': { keys: ['datasetId'], valid: () => isId(p.datasetId) },
    'revision.get': { keys: ['dataset'], valid: () => datasetRef(p.dataset) },
    'revision.activate': { keys: ['dataset', 'operationId'], valid: () => datasetRef(p.dataset) && isId(p.operationId) },
    'model.catalog': { keys: ['revision'], valid: () => explicitRevision(p.revision) },
    'model.read': { keys: ['datasetId','revision'], valid: () => isId(p.datasetId) && explicitRevision(p.revision) },
    'command.execute': { keys: ['input','context','contextTarget','scopeRevision','operationId','expectedHead','expectedTree'], valid: () => isRecord(p.input) && Object.keys(p.input).length === 1 && (typeof p.input.command === 'string' && p.input.command.length <= 4096 || workbenchIntent(p.input.intent)) && (p.context === undefined || context(p.context)) && (p.contextTarget === undefined || modelTarget(p.contextTarget)) && (p.scopeRevision===undefined||explicitRevision(p.scopeRevision)) && (p.operationId === undefined || isId(p.operationId)) && (p.expectedHead === undefined || gitOid(p.expectedHead)) && (p.expectedTree === undefined || gitOid(p.expectedTree)) },
    'command.complete': { keys: ['input','context','contextTarget','scopeRevision'], valid: () => typeof p.input === 'string' && p.input.length <= 4096 && (p.context === undefined || context(p.context)) && (p.contextTarget === undefined || modelTarget(p.contextTarget)) && (p.scopeRevision===undefined||explicitRevision(p.scopeRevision)) },
    'query.execute': { keys: ['dataset', 'input', 'context'], valid: () => datasetRef(p.dataset) && context(p.context) && isRecord(p.input) && Object.keys(p.input).length === 1 && (typeof p.input.command === 'string' && p.input.command.length <= 4096 || intent(p.input.intent)) },
    'query.complete': { keys: ['dataset', 'input', 'context'], valid: () => datasetRef(p.dataset) && context(p.context) && typeof p.input === 'string' && p.input.length <= 4096 },
    'workspace.load': { keys: ['workspaceId'], valid: () => isId(p.workspaceId) },
    'workspace.save': { keys: ['workspace', 'expectedVersion'], valid: () => validateWorkspace(p.workspace).ok && (p.expectedVersion === null || integer(p.expectedVersion)) },
    'clientState.load': { keys: ['key'], valid: () => CLIENT_STATE_KEYS.includes(p.key as never) },
    'clientState.save': { keys: ['key', 'expectedVersion', 'value'], valid: () => CLIENT_STATE_KEYS.includes(p.key as never) && (p.expectedVersion === null || integer(p.expectedVersion) && Number(p.expectedVersion) >= 1) && p.value !== undefined && JSON.stringify(p.value).length <= 2_100_000 },
    'settings.get': { keys: [], valid: () => true },
    'settings.update': { keys: ['section', 'expectedVersion', 'value'], valid: () => validSettingsUpdate(p) },
    'settings.library': { keys: [], valid: () => true },
    'draft.list': { keys: ['datasetId'], valid: () => p.datasetId === undefined || isId(p.datasetId) },
    // Drafts may retain validation errors; publication is the stricter boundary.
    'draft.create': { keys: ['package', 'baseRevision', 'operationId'], valid: () => validateDataPackage(p.package, 'shape').ok && (p.baseRevision === null || datasetRef(p.baseRevision)) && isId(p.operationId) },
    'draft.get': { keys: ['draftId'], valid: () => isId(p.draftId) },
    'draft.save': { keys: ['draftId', 'expectedVersion', 'package'], valid: () => isId(p.draftId) && integer(p.expectedVersion) && validateDataPackage(p.package, 'shape').ok },
    'draft.delete': { keys: ['draftId', 'expectedVersion'], valid: () => isId(p.draftId) && integer(p.expectedVersion) },
    'draft.validate': { keys: ['draftId'], valid: () => isId(p.draftId) },
    'draft.preview': { keys: ['draftId'], valid: () => isId(p.draftId) },
    'draft.publish': { keys: ['draftId', 'expectedVersion', 'review', 'operationId','expectedHead','expectedModelHash'], valid: () => isId(p.draftId) && integer(p.expectedVersion) && isId(p.operationId) && gitOid(p.expectedHead) && (p.expectedModelHash === null || sourceJobId(p.expectedModelHash)) && isRecord(p.review) && isString(p.review.reviewer) && isTimestamp(p.review.reviewedAt) && typeof p.review.evidenceReviewed === 'boolean' && typeof p.review.rightsReviewed === 'boolean' && isString(p.review.note) },
    'source.list': { keys: [], valid: () => true },
    'source.save': { keys: ['source'], valid: () => isRecord(p.source) && isId(p.source.id) && isId(p.source.adapter) && typeof p.source.enabled === 'boolean' && isString(p.source.rightsBasis) && isRecord(p.source.settings) && Object.values(p.source.settings).every(x => ['string', 'number', 'boolean'].includes(typeof x)) },
    'source.acquire': { keys: ['sourceId', 'operationId'], valid: () => isId(p.sourceId) && isId(p.operationId) },
    'source.search': { keys: ['query', 'language', 'cursor', 'operationId'], valid: () => typeof p.query === 'string' && p.query.trim().length > 0 && p.query.length <= 200 && ['en', 'zh'].includes(String(p.language)) && (p.cursor === undefined || typeof p.cursor === 'string' && /^\d{1,5}$/.test(p.cursor) && Number(p.cursor) <= 10000) && isId(p.operationId) },
    'source.collect': { keys: ['entityIds', 'operationId', 'resumeJobId'], valid: () => Array.isArray(p.entityIds) && p.entityIds.length > 0 && p.entityIds.length <= 10000 && p.entityIds.every(externalEntity) && new Set(p.entityIds).size === p.entityIds.length && isId(p.operationId) && (p.resumeJobId === undefined || sourceJobId(p.resumeJobId)) },
    'source.jobs': { keys: [], valid: () => true },
    'source.record': { keys: ['jobId', 'externalId'], valid: () => sourceJobId(p.jobId) && externalEntity(p.externalId) },
    'wikipedia.collect': { keys: ['title','revision','operationId','resumeJobId'], valid: () => validWikipediaTitle(p.title) && (p.revision===undefined || Number.isSafeInteger(p.revision) && Number(p.revision)>0) && isId(p.operationId) && (p.resumeJobId===undefined || sourceJobId(p.resumeJobId)) },
    'wikipedia.jobs': { keys: ['offset','limit'], valid: () => (p.offset===undefined || integer(p.offset)) && (p.limit===undefined || integer(p.limit) && Number(p.limit)>=1 && Number(p.limit)<=100) },
    'wikipedia.inspect': { keys: ['jobId','offset','limit'], valid: () => sourceJobId(p.jobId) && (p.offset===undefined || integer(p.offset)) && (p.limit===undefined || integer(p.limit) && Number(p.limit)>=1 && Number(p.limit)<=100) },
    'wikipedia.preview': { keys: ['jobId','sourceHash','expectedHead','selection'], valid: () => sourceJobId(p.jobId) && sourceJobId(p.sourceHash) && gitOid(p.expectedHead) && validWikipediaSelection(p.selection) },
    'wikipedia.issues': { keys: ['jobId','previewId','expectedInputHash','offset','limit'], valid: () => sourceJobId(p.jobId) && sourceJobId(p.previewId) && sourceJobId(p.expectedInputHash) && (p.offset===undefined || integer(p.offset)) && (p.limit===undefined || integer(p.limit) && Number(p.limit)>=1 && Number(p.limit)<=100) },
    'wikipedia.adopt': { keys: ['jobId','previewId','expectedHead','expectedInputHash','review','operationId'], valid: () => sourceJobId(p.jobId) && sourceJobId(p.previewId) && gitOid(p.expectedHead) && sourceJobId(p.expectedInputHash) && ['unreviewed','adopted'].includes(String(p.review)) && isId(p.operationId) },
    'collection.catalog': { keys: [], valid: () => true },
    'collection.issues':{keys:['jobId','offset','limit'],valid:()=>sourceJobId(p.jobId)&&integer(p.offset)&&integer(p.limit)&&Number(p.limit)>=1&&Number(p.limit)<=100},
    'collection.rebuildIssues':{keys:['jobId','operationId'],valid:()=>sourceJobId(p.jobId)&&isId(p.operationId)},
    'collection.jobs': { keys: [], valid: () => true },
    'collection.acquire': { keys: ['provider', 'query', 'operationId', 'resumeJobId'], valid: () => ['cliopatria', 'pleiades'].includes(String(p.provider)) && isRecord(p.query) && Object.keys(p.query).every(key => ['text', 'years', 'limit', 'startRecord'].includes(key)) && (p.query.text === undefined || typeof p.query.text === 'string' && p.query.text.length <= 200) && (p.query.years === undefined || p.provider === 'cliopatria' && isCoverage(p.query.years)) && integer(p.query.startRecord) && Number(p.query.startRecord) <= 1_000_000 && integer(p.query.limit) && Number(p.query.limit) >= 1 && Number(p.query.limit) <= 10_000 && isId(p.operationId) && (p.resumeJobId === undefined || sourceJobId(p.resumeJobId)) },
    'collection.preview': { keys: ['jobId'], valid: () => sourceJobId(p.jobId) },
    'collection.adopt': { keys: ['jobId', 'expectedHead', 'expectedInputHash', 'review', 'operationId'], valid: () => sourceJobId(p.jobId) && gitOid(p.expectedHead) && sourceJobId(p.expectedInputHash) && ['unreviewed', 'adopted'].includes(String(p.review)) && isId(p.operationId) },
    'repository.status': { keys: [], valid: () => true },
    'repository.diff': { keys: ['mode','paths','offset','limit'], valid: () => ['working','staged'].includes(String(p.mode)) && (p.paths === undefined || repositoryPaths(p.paths)) && (p.offset === undefined || integer(p.offset)) && (p.limit === undefined || integer(p.limit) && Number(p.limit) >= 1 && Number(p.limit) <= 100) },
    'repository.changes': { keys: ['mode','group','query','paths','offset','limit'], valid: () => (p.paths === undefined || Array.isArray(p.paths) && p.paths.length <= 200 && repositoryPaths(p.paths)) && ['working','staged'].includes(String(p.mode)) && (p.group === undefined || ['object','source','research','mapping','model','navigation','other'].includes(String(p.group))) && (p.query === undefined || typeof p.query === 'string' && p.query.length <= 1000) && integer(p.offset) && integer(p.limit) && Number(p.limit) > 0 && Number(p.limit) <= 200 },
    'repository.stage': { keys: ['paths'], valid: () => repositoryPaths(p.paths) },
    'repository.stagePlan': { keys: ['paths'], valid: () => repositoryPaths(p.paths) },
    'repository.unstage': { keys: ['paths'], valid: () => repositoryPaths(p.paths) },
    'repository.commit': { keys: ['operationId','expectedHead','expectedTree','message'], valid: () => isId(p.operationId) && gitOid(p.expectedHead) && (p.expectedTree === undefined || gitOid(p.expectedTree)) && typeof p.message === 'string' && p.message.trim().length > 0 && p.message.length <= 16000 },
    'repository.log': { keys: ['limit'], valid: () => p.limit === undefined || integer(p.limit) && Number(p.limit) >= 1 && Number(p.limit) <= 100 },
    'repository.branch': { keys: ['name'], valid: () => branchName(p.name) },
    'repository.branches': { keys: [], valid: () => true },
    'repository.switch': { keys: ['name'], valid: () => branchName(p.name) },
    'repository.checkout': { keys: ['oid'], valid: () => gitOid(p.oid) },
    'repository.revert': { keys: ['operationId','expectedHead','commitOid'], valid: () => isId(p.operationId) && gitOid(p.expectedHead) && gitOid(p.commitOid) },
    'repository.abortRevert': { keys: [], valid: () => true },
    'research.list': { keys: [], valid: () => true },
    'research.get': { keys: ['id'], valid: () => researchId(p.id) },
    'research.save': { keys: ['record','expectedHash'], valid: () => isRecord(p.record) && p.record.schemaVersion === 1 && researchId(p.record.id) && (p.expectedHash === null || sourceJobId(p.expectedHash)) },
    'research.history': { keys: ['id'], valid: () => researchId(p.id) },
    'research.readRevision': { keys: ['id','oid'], valid: () => researchId(p.id) && gitOid(p.oid) },
    'knowledge.previewJob': { keys: ['jobId'], valid: () => sourceJobId(p.jobId) },
    'knowledge.adoptJob': { keys: ['jobId','expectedHead','expectedInputHash','review','operationId'], valid: () => sourceJobId(p.jobId) && gitOid(p.expectedHead) && sourceJobId(p.expectedInputHash) && ['unreviewed','adopted'].includes(String(p.review)) && isId(p.operationId) },
    'knowledge.filePreview': { keys: ['fileToken'], valid: () => isId(p.fileToken) },
    'knowledge.fileAdopt': { keys: ['fileToken','expectedHead','expectedInputHash','review','operationId','previewId'], valid: () => isId(p.fileToken) && gitOid(p.expectedHead) && sourceJobId(p.expectedInputHash) && ['unreviewed','adopted'].includes(String(p.review)) && isId(p.operationId) && (p.previewId === undefined || sourceJobId(p.previewId)) },
    'knowledge.pendingImports': { keys: [], valid: () => true },
    'knowledge.resumeImport': { keys: ['operationId','previewId'], valid: () => isId(p.operationId) && sourceJobId(p.previewId) },
    'knowledge.editContext': { keys: ['objectId'], valid: () => p.objectId === undefined || contentId(p.objectId) },
    'knowledge.saveEdit': { keys: ['operationId','expectedHead','expectedObjectHash','objectId','assertionId','change'], valid: () => validKnowledgeSaveEdit(p) },
    'knowledge.query': { keys: ['query','revision'], valid: () => knowledgeQuery(p.query) && revision(p.revision) },
    'knowledge.object': { keys: ['objectId','revision'], valid: () => contentId(p.objectId) && revision(p.revision) },
    'knowledge.state': { keys: ['state','revision'], valid: () => stateRequest(p.state) && revision(p.revision) },
    'knowledge.history': { keys: ['objectId','propertyIds','includeUnreviewed','revision'], valid: () => contentId(p.objectId) && (p.propertyIds === undefined || stringIds(p.propertyIds)) && (p.includeUnreviewed === undefined || typeof p.includeUnreviewed === 'boolean') && revision(p.revision) },
    'knowledge.diff': { keys: ['a','b'], valid: () => ['a','b'].every(key => isRecord(p[key]) && Object.keys(p[key]).length === 2 && stateRequest(p[key].state) && revision(p[key].revision) && p[key].revision !== undefined) },
    'knowledge.conflicts': { keys: [], valid: () => true },
    'knowledge.resolve': { keys: ['objectId','choice','expectedHead'], valid: () => contentId(p.objectId) && ['local','incoming'].includes(String(p.choice)) && gitOid(p.expectedHead) },
    'import.preview': { keys: ['fileToken', 'operationId'], valid: () => isId(p.fileToken) && isId(p.operationId) },
    'import.accept': { keys: ['importId', 'operationId'], valid: () => isId(p.importId) && isId(p.operationId) },
    'export.revision': { keys: ['dataset', 'fileToken', 'operationId'], valid: () => datasetRef(p.dataset) && isId(p.fileToken) && isId(p.operationId) },
    'backup.create': { keys: ['fileToken', 'operationId'], valid: () => isId(p.fileToken) && isId(p.operationId) },
    'backup.restore': { keys: ['fileToken', 'operationId'], valid: () => isId(p.fileToken) && isId(p.operationId) },
    'operation.cancel': { keys: ['operationId'], valid: () => isId(p.operationId) },
  };
  const rule = checks[input.method];
  if (!rule || Object.keys(p).some(k => !rule.keys.includes(k)) || !rule.valid()) return { ok: false, issues: [{ code: 'INVALID_SHAPE', path: '$.request.params' }] };
  return { ok: true, value: structuredClone(input) as ServiceRequest, issues: [] };
}
