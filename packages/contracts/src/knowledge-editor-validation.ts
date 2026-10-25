import { isHistoricalYear, isId, isRecord, validateJsonBoundary } from '../../domain/src/index.ts';
import type { KnowledgeSaveEditRequest } from './knowledge-editor-types.ts';

const keys = (v: Record<string,unknown>, allowed: string[]) => Object.keys(v).every(key => allowed.includes(key));
const text = (v: unknown, maximum: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const id = (v: unknown) => text(v, 300) && typeof v === 'string' && !/[\x00-\x1f]/.test(v);
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const optionalText = (v: unknown, maximum: number) => v === undefined || text(v, maximum);
function time(v: unknown): boolean {
  return isRecord(v) && keys(v, ['earliestYear','latestYear','precision','calendar','raw','month','day','sourcePrecision','before','after'])
    && isHistoricalYear(v.earliestYear) && isHistoricalYear(v.latestYear) && v.earliestYear <= v.latestYear
    && typeof v.precision === 'string' && ['year','month','day','decade','century','millennium','broader','interval'].includes(v.precision) && id(v.calendar) && optionalText(v.raw,1000)
    && (v.month === undefined || Number.isInteger(v.month) && Number(v.month) >= 1 && Number(v.month) <= 12)
    && (v.day === undefined || Number.isInteger(v.day) && Number(v.day) >= 1 && Number(v.day) <= 31)
    && ['sourcePrecision','before','after'].every(key => v[key] === undefined || Number.isSafeInteger(v[key]) && Number(v[key]) >= 0);
}
export function validKnowledgeEditTime(v: unknown): boolean {
  if (v === null) return true;
  if (!isRecord(v) || !keys(v,['point','start','end','certainty']) || !['point','start','end'].some(key => v[key] !== undefined) || !['point','start','end'].every(key => v[key] === undefined || time(v[key])) || v.certainty !== undefined && v.certainty !== 'possible') return false;
  if (v.point !== undefined && (v.start !== undefined || v.end !== undefined)) return false;
  return !isRecord(v.start) || !isRecord(v.end) || Number(v.start.earliestYear) <= Number(v.end.latestYear);
}
export function validKnowledgeEditValue(v: unknown): boolean {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'unknown': case 'absent': return keys(v,['kind']);
    case 'entity': return keys(v,['kind','objectId']) && id(v.objectId);
    case 'text': return keys(v,['kind','value','language']) && typeof v.value === 'string' && v.value.length <= 100_000 && (v.language === undefined || typeof v.language === 'string' && /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(v.language));
    case 'boolean': return keys(v,['kind','value']) && typeof v.value === 'boolean';
    case 'number': return keys(v,['kind','value','unit','lowerBound','upperBound']) && finite(v.value) && optionalText(v.unit,300) && ['lowerBound','upperBound'].every(key => v[key] === undefined || finite(v[key])) && (v.lowerBound === undefined || v.upperBound === undefined || Number(v.lowerBound) <= Number(v.upperBound));
    case 'time': return keys(v,['kind','value']) && time(v.value);
    case 'coordinate': return keys(v,['kind','longitude','latitude','globe','precision']) && finite(v.longitude) && Math.abs(Number(v.longitude)) <= 180 && finite(v.latitude) && Math.abs(Number(v.latitude)) <= 90 && text(v.globe,1000) && (v.precision === undefined || finite(v.precision) && Number(v.precision) >= 0);
    case 'raw': return keys(v,['kind','value']) && Object.hasOwn(v,'value') && validateJsonBoundary(v.value).length === 0;
    default: return false;
  }
}
function evidence(v: unknown): boolean {
  if (!isRecord(v) || !text(v.locator,4000) || !optionalText(v.citation,8000)) return false;
  if (Object.hasOwn(v,'sourceId')) return keys(v,['sourceId','locator','citation']) && id(v.sourceId);
  if (!keys(v,['title','url','locator','citation']) || !text(v.title,1000) || !text(v.url,4000)) return false;
  try { const url = new URL(String(v.url)); return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname) && !/[\x00-\x20]/.test(String(v.url)); } catch { return false; }
}
export function validKnowledgeSaveEdit(v: unknown): v is KnowledgeSaveEditRequest {
  if (validateJsonBoundary(v).length || !isRecord(v) || !keys(v,['operationId','expectedHead','expectedObjectHash','objectId','assertionId','change']) || !isId(v.operationId) || typeof v.expectedHead !== 'string' || !/^[a-f0-9]{40}$/.test(v.expectedHead) || !(v.expectedObjectHash === null || typeof v.expectedObjectHash === 'string' && /^[a-f0-9]{64}$/.test(v.expectedObjectHash)) || v.objectId !== undefined && !id(v.objectId) || v.assertionId !== undefined && !id(v.assertionId) || !isRecord(v.change)) return false;
  const c = v.change;
  if (!keys(c,['mode','newObject','propertyId','value','validTime','evidence','review','reason']) || !id(c.propertyId) || typeof c.review !== 'string' || !['unreviewed','adopted'].includes(c.review) || !text(c.reason,4000) || !evidence(c.evidence) || c.validTime !== undefined && !validKnowledgeEditTime(c.validTime)) return false;
  if (c.mode === 'correct') return v.objectId !== undefined && v.assertionId !== undefined && v.expectedObjectHash !== null && c.newObject === undefined && (c.value === undefined || validKnowledgeEditValue(c.value));
  if (c.mode !== 'add' || v.assertionId !== undefined || !validKnowledgeEditValue(c.value)) return false;
  if (v.objectId !== undefined) return v.expectedObjectHash !== null && c.newObject === undefined;
  if (v.expectedObjectHash !== null || !isRecord(c.newObject) || !keys(c.newObject,['labels','types']) || !isRecord(c.newObject.labels) || !Object.keys(c.newObject.labels).length || Object.keys(c.newObject.labels).length > 10 || !Object.entries(c.newObject.labels).every(([language,label]) => /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language) && text(label,300))) return false;
  return Array.isArray(c.newObject.types) && c.newObject.types.length <= 20 && c.newObject.types.every(id) && new Set(c.newObject.types).size === c.newObject.types.length;
}
