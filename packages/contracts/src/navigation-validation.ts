import { isId, isRecord, isTimestamp } from '../../domain/src/index.ts';
import type { NavigationBatchRef, NavigationCommandIntent, NavigationContextDefinition, NavigationMembershipShard, NavigationRecipe } from './navigation-types.ts';
import { validKnowledgeQuery } from './knowledge-query-validation.ts';

const keys = (value: Record<string,unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export const navigationContentId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 300 && !/[\x00-\x1f\x7f]/.test(value);
export const navigationHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const navigationOid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const navigationRevision = (value: unknown): value is string => value === 'working' || navigationOid(value);
const optionalRevision = (value: unknown) => value === undefined || navigationRevision(value);
export const navigationPath = (value: unknown): value is string => typeof value === 'string' && /^navigation\/contexts\/[a-f0-9]{64}\/(?:definition\.json|members\/[a-f0-9]{2}\.json)$/.test(value);
const text = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const localized = (value: unknown, maximum: number) => isRecord(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 30 && Object.entries(value).every(([language,label]) => /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language) && text(label,maximum));
const profile = (value: unknown) => isRecord(value) && keys(value,['id','version']) && navigationContentId(value.id) && navigationContentId(value.version);
export function validNavigationDefinition(value: unknown): value is NavigationContextDefinition {
  return isRecord(value) && keys(value,['schemaVersion','id','labels','description','origin','profile']) && value.schemaVersion === 1 && navigationContentId(value.id) && localized(value.labels,300) && (value.description === undefined || localized(value.description,4000)) && (value.origin === 'user-organization' && value.profile === undefined || value.origin === 'source-profile' && profile(value.profile));
}
export function validNavigationBatch(value: unknown): value is NavigationBatchRef {
  if (!isRecord(value) || !navigationHash(value.objectSetHash)) return false;
  if (value.kind === 'adopted-import') return keys(value,['kind','operationId','method','inputHash','objectSetHash','previewId']) && isId(value.operationId) && ['paired-import','knowledge.fileAdopt','knowledge.adoptJob','collection.adopt','wikipedia.adopt'].includes(String(value.method)) && navigationHash(value.inputHash) && (value.previewId === undefined || navigationHash(value.previewId));
  return value.kind === 'saved-source' && keys(value,['kind','selection','revision','sourceId','sourceRevision','sourceHash','selectionHash','objectSetHash']) && ['source-claim-subjects','subjects-and-referenced-objects'].includes(String(value.selection)) && navigationRevision(value.revision) && navigationContentId(value.sourceId) && (value.sourceRevision === null || navigationContentId(value.sourceRevision)) && navigationHash(value.sourceHash) && navigationHash(value.selectionHash);
}
const storedBasis = (value: unknown) => validNavigationBatch(value) || isRecord(value) && keys(value,['kind','bundleId','manifestHash','objectSetHash']) && value.kind==='trusted-bundle' && navigationContentId(value.bundleId) && navigationHash(value.manifestHash) && navigationHash(value.objectSetHash);
export function validNavigationShard(value: unknown): value is NavigationMembershipShard {
  if (!isRecord(value) || !keys(value,['schemaVersion','partitionVersion','contextId','partition','members']) || value.schemaVersion !== 1 || value.partitionVersion !== 1 || !navigationContentId(value.contextId) || typeof value.partition !== 'string' || !/^[a-f0-9]{2}$/.test(value.partition) || !Array.isArray(value.members) || !value.members.length || value.members.length > 100_000) return false;
  let prior = '';
  return value.members.every(member => {
    if (!isRecord(member) || !keys(member,['contextId','objectId','decision','batchRef','sourceRefs']) || member.contextId !== value.contextId || !navigationContentId(member.objectId) || member.objectId <= prior || !isRecord(member.decision) || !keys(member.decision,['kind','recordedAt','rationale','profile']) || !isTimestamp(member.decision.recordedAt) || member.decision.rationale !== undefined && !text(member.decision.rationale,4000) || !(member.decision.kind === 'manual' && member.decision.profile === undefined || member.decision.kind === 'profile' && profile(member.decision.profile)) || !storedBasis(member.batchRef)) return false;
    prior = member.objectId;
    return member.sourceRefs === undefined || Array.isArray(member.sourceRefs) && member.sourceRefs.length <= 100000 && new Set(member.sourceRefs.map(item => isRecord(item) ? item.sourceId : '')).size === member.sourceRefs.length && member.sourceRefs.every(item => isRecord(item) && keys(item,['sourceId','revision','contentHash','locator']) && navigationContentId(item.sourceId) && (item.revision === null || navigationContentId(item.revision)) && navigationHash(item.contentHash) && (item.locator === undefined || text(item.locator,4000)));
  });
}
export function validNavigationRecipe(value: unknown): value is NavigationRecipe {
  return isRecord(value) && keys(value,['schemaVersion','revision','query']) && value.schemaVersion === 1 && navigationRevision(value.revision) && validKnowledgeQuery(value.query);
}
export function validNavigationSelection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.mode === 'all' || value.mode === 'unassigned') return keys(value,['mode']);
  return value.mode === 'contexts' && keys(value,['mode','contextIds']) && Array.isArray(value.contextIds) && value.contextIds.length > 0 && value.contextIds.length <= 100 && value.contextIds.every(navigationContentId) && new Set(value.contextIds).size === value.contextIds.length;
}
export function validNavigationFilters(value: unknown): boolean {
  return isRecord(value) && keys(value,['time','typeIds','text','includeUndated','includeUnlocated','review']) && validKnowledgeQuery(value);
}
export function validNavigationCommand(value: unknown): value is NavigationCommandIntent {
  if (!isRecord(value)) return false;
  const page = () => (value.offset === undefined || Number.isSafeInteger(value.offset) && Number(value.offset) >= 0) && (value.limit === undefined || Number.isSafeInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 100);
  switch (value.type) {
    case 'contexts': case 'batches': return keys(value,['type','revision','offset','limit']) && optionalRevision(value.revision) && page();
    case 'context': return keys(value,['type','contextId','revision','offset','limit']) && navigationContentId(value.contextId) && optionalRevision(value.revision) && page();
    case 'create': return keys(value,['type','labels','description']) && localized(value.labels,300) && (value.description === undefined || localized(value.description,4000));
    case 'use': return keys(value,['type','selection','revision']) && validNavigationSelection(value.selection) && optionalRevision(value.revision);
    case 'filter': return keys(value,['type','filters']) && validNavigationFilters(value.filters);
    case 'reset': return keys(value,['type']);
    case 'assign': return keys(value,['type','contextId','batchKey','revision','mode','rationale']) && navigationContentId(value.contextId) && navigationHash(value.batchKey) && optionalRevision(value.revision) && (value.mode === undefined || value.mode === 'add' || value.mode === 'remove') && (value.rationale === undefined || text(value.rationale,4000));
    case 'apply': return keys(value,['type','planId','expectedPlanHash']) && navigationHash(value.planId) && (value.expectedPlanHash === undefined || navigationHash(value.expectedPlanHash));
    default: return false;
  }
}
export function navigationRequestChecks(p: Record<string,unknown>) {
  const page = () => (p.offset === undefined || Number.isSafeInteger(p.offset) && Number(p.offset) >= 0) && (p.limit === undefined || Number.isSafeInteger(p.limit) && Number(p.limit) >= 1 && Number(p.limit) <= 100);
  return {
    'context.list': { keys:['revision','offset','limit','text'], valid:() => optionalRevision(p.revision) && page() && (p.text === undefined || typeof p.text === 'string' && p.text.length <= 1000) },
    'context.get': { keys:['contextId','revision','offset','limit'], valid:() => navigationContentId(p.contextId) && optionalRevision(p.revision) && page() },
    'context.save': { keys:['operationId','expectedHead','expectedContentHash','contextId','labels','description'], valid:() => isId(p.operationId) && navigationOid(p.expectedHead) && (p.contextId === undefined ? p.expectedContentHash === null : navigationContentId(p.contextId) && navigationHash(p.expectedContentHash)) && localized(p.labels,300) && (p.description === undefined || localized(p.description,4000)) },
    'context.batches': { keys:['revision','offset','limit','batchKey','inputHash','previewId','text','kind'], valid:() => optionalRevision(p.revision) && page() && ['batchKey','inputHash','previewId'].every(key=>p[key]===undefined||navigationHash(p[key])) && (p.text===undefined||typeof p.text==='string'&&p.text.length<=300&&!/[\x00-\x1f\x7f]/.test(p.text)) && (p.kind===undefined||p.kind==='adopted-import'||p.kind==='saved-source') },
    'context.batchObjects': { keys:['batch','offset','limit'], valid:() => validNavigationBatch(p.batch) && page() },
    'context.batchSources': { keys:['batch','offset','limit'], valid:() => validNavigationBatch(p.batch) && page() },
    'context.membershipPlan': { keys:['contextId','expectedHead','expectedDefinitionHash','batch','mode','rationale'], valid:() => navigationContentId(p.contextId) && navigationOid(p.expectedHead) && navigationHash(p.expectedDefinitionHash) && validNavigationBatch(p.batch) && (p.mode === 'add' || p.mode === 'remove') && (p.rationale === undefined || text(p.rationale,4000)) },
    'context.plan': { keys:['planId','offset','limit'], valid:() => navigationHash(p.planId) && page() },
    'context.applyMembership': { keys:['operationId','planId','expectedPlanHash'], valid:() => isId(p.operationId) && navigationHash(p.planId) && navigationHash(p.expectedPlanHash) },
    'context.pending': { keys:[], valid:() => true },
    'context.resume': { keys:['operationId'], valid:() => isId(p.operationId) },
  };
}
