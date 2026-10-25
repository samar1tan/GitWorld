import { isCoverage, isRecord } from '../../domain/src/index.ts';
import type { KnowledgeQuery } from '../../domain/src/knowledge.ts';

const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\x00-\x1f\x7f]/.test(value);
const ids = (value: unknown, maximum = 1000) => Array.isArray(value) && value.length <= maximum && value.every(id);
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
export function validKnowledgeQuery(value: unknown): value is KnowledgeQuery {
  return isRecord(value) && Object.keys(value).every(key => ['text','typeIds','objectIds','contextIds','unassigned','time','bounds','includeUndated','includeUnlocated','review','offset','limit'].includes(key))
    && (value.text === undefined || typeof value.text === 'string' && value.text.length <= 1000)
    && (value.typeIds === undefined || ids(value.typeIds)) && (value.objectIds === undefined || ids(value.objectIds))
    && (value.contextIds === undefined || ids(value.contextIds,100)) && (value.unassigned === undefined || typeof value.unassigned === 'boolean')
    && !(value.contextIds !== undefined && value.unassigned === true)
    && (value.time === undefined || isCoverage(value.time))
    && (value.bounds === undefined || isRecord(value.bounds) && [value.bounds.west,value.bounds.east,value.bounds.south,value.bounds.north].every(item => typeof item === 'number' && Number.isFinite(item)) && Math.abs(Number(value.bounds.west)) <= 180 && Math.abs(Number(value.bounds.east)) <= 180 && Number(value.bounds.south) >= -90 && Number(value.bounds.north) <= 90 && Number(value.bounds.south) <= Number(value.bounds.north))
    && ['includeUndated','includeUnlocated'].every(key => value[key] === undefined || typeof value[key] === 'boolean')
    && (value.review === undefined || Array.isArray(value.review) && value.review.every(item => ['unreviewed','adopted','rejected'].includes(String(item))))
    && (value.offset === undefined || integer(value.offset)) && (value.limit === undefined || integer(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 1000);
}
