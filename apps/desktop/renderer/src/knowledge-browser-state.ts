import type { KnowledgeQuery,KnowledgeText } from '../../../../packages/domain/src/knowledge.ts';
import type { NavigationScopePatch } from '@gitworld/contracts';

export type FixedKnowledgeState = { objectId: string; year: number; revision: string; label: string; includeUnreviewed: boolean;labels?:KnowledgeText };
export type KnowledgeKindMode='auto'|'structures'|'all'|'types';
export type KnowledgeBrowserView = 'overview' | 'map' | 'observations' | 'state' | 'compare';
export type KnowledgeBrowserState = {
  schemaVersion: 1; query: KnowledgeQuery; selectedObjectId: string | null; year: number | null;
  view: KnowledgeBrowserView; includeUnreviewed: boolean;
  checkout: FixedKnowledgeState | null; a: FixedKnowledgeState | null; b: FixedKnowledgeState | null;
  preview?: FixedKnowledgeState | null;
  objectRevision?:string;
  fieldIds?:string[];
  queryRevision?: string;
  kindMode?:KnowledgeKindMode;
  yearDraft?: string;
  scopeDraft?: { text: string; from: string; to: string; includeUndated: boolean; includeUnlocated: boolean; bounds: { west: string; east: string; south: string; north: string }; contextIds: string[]; unassigned: boolean; typeIds: string[];kindMode?:KnowledgeKindMode };
  objectTrail?: Omit<KnowledgeBrowserState, 'objectTrail'>[];
};
const civil = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isFixedKnowledgeState(value: unknown): value is FixedKnowledgeState {
  return object(value) && (value.labels===undefined||object(value.labels)&&Object.keys(value.labels).length<=30&&Object.values(value.labels).every(label=>typeof label==='string'&&label.length<=1000)) && typeof value.objectId === 'string' && value.objectId.length > 0 && value.objectId.length <= 1000 && civil(value.year) && typeof value.revision === 'string' && /^[a-f0-9]{40}$/.test(value.revision) && typeof value.label === 'string' && typeof value.includeUnreviewed === 'boolean';
}
export function initialKnowledgeBrowserState(): KnowledgeBrowserState {
  return { schemaVersion: 1, kindMode:'auto',query: { offset: 0, limit: 40, includeUndated: true, includeUnlocated: true }, selectedObjectId: null, year: null, view: 'overview', includeUnreviewed: false, checkout: null, a: null, b: null, preview: null };
}
export function parseKnowledgeBrowserState(text: string | null): KnowledgeBrowserState | null {
  if (!text || text.length > 100_000) return null;
  try {
    const value = JSON.parse(text) as KnowledgeBrowserState;
    if (!object(value) || value.schemaVersion !== 1 || !object(value.query) || !['overview', 'map', 'observations', 'state', 'compare'].includes(String(value.view)) || !(value.selectedObjectId === null || typeof value.selectedObjectId === 'string') || !(value.year === null || civil(value.year)) || typeof value.includeUnreviewed !== 'boolean') return null;
    for (const ref of [value.checkout, value.a, value.b]) if (!(ref === null || isFixedKnowledgeState(ref))) return null;
    if(value.objectRevision!==undefined&&value.objectRevision!=='working'&&!/^[a-f0-9]{40}$/.test(value.objectRevision))return null;
    if(value.kindMode!==undefined&&!['auto','structures','all','types'].includes(value.kindMode))return null;
    if(value.queryRevision!==undefined&&value.queryRevision!=='working'&&!/^[a-f0-9]{40}$/.test(value.queryRevision))return null;
    if(value.yearDraft!==undefined&&(typeof value.yearDraft!=='string'||value.yearDraft.length>30))return null;
    if(value.scopeDraft!==undefined){const d=value.scopeDraft;if(!object(d)||typeof d.text!=='string'||d.text.length>500||typeof d.from!=='string'||d.from.length>30||typeof d.to!=='string'||d.to.length>30||typeof d.includeUndated!=='boolean'||typeof d.includeUnlocated!=='boolean'||typeof d.unassigned!=='boolean'||!Array.isArray(d.contextIds)||d.contextIds.length>100||!d.contextIds.every(id=>typeof id==='string'&&id.length<=1000)||!Array.isArray(d.typeIds)||!d.typeIds.every(id=>typeof id==='string'&&id.length<=1000)||!object(d.bounds)||!(['west','east','north','south'] as const).every(key=>typeof d.bounds[key]==='string'&&(d.bounds[key] as string).length<=50)||d.unassigned&&d.contextIds.length||d.kindMode!==undefined&&!['auto','structures','all','types'].includes(d.kindMode))return null;}
    if (value.preview !== undefined && value.preview !== null && !isFixedKnowledgeState(value.preview)) return null;
    if (value.objectTrail !== undefined && (!Array.isArray(value.objectTrail) || value.objectTrail.length > 20 || !value.objectTrail.every(item => object(item) && !('objectTrail' in item) && parseKnowledgeBrowserState(JSON.stringify(item)) !== null))) return null;
    const query = value.query;
    if(value.fieldIds!==undefined&&(!Array.isArray(value.fieldIds)||value.fieldIds.length>1000||!value.fieldIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=300)))return null;
    if(query.objectIds!==undefined&&(!Array.isArray(query.objectIds)||query.objectIds.length>1000||!query.objectIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=300)))return null;
    if(query.contextIds!==undefined&&(!Array.isArray(query.contextIds)||query.contextIds.length>100||!query.contextIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=1000))||query.unassigned!==undefined&&typeof query.unassigned!=='boolean'||query.unassigned&&query.contextIds?.length)return null;
    if (query.text !== undefined && typeof query.text !== 'string' || query.time && (!Array.isArray(query.time) || query.time.length !== 2 || !query.time.every(civil) || query.time[0] > query.time[1]) || query.typeIds && (!Array.isArray(query.typeIds) || !query.typeIds.every(id => typeof id === 'string')) || query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0) || query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)) return null;
    if (query.bounds && (!Object.values(query.bounds).every(Number.isFinite) || query.bounds.south > query.bounds.north || Math.abs(query.bounds.west) > 180 || Math.abs(query.bounds.east) > 180 || Math.abs(query.bounds.south) > 90 || Math.abs(query.bounds.north) > 90)) return null;
    value.kindMode??=value.query.typeIds?.length?'types':'all';
    return structuredClone(value);
  } catch { return null; }
}
export function sameFixedKnowledgeState(a: FixedKnowledgeState | null, b: FixedKnowledgeState | null): boolean {
  return a === null || b === null ? a === b : a.objectId === b.objectId && a.year === b.year && a.revision === b.revision && a.includeUnreviewed === b.includeUnreviewed;
}
/** Scope patches never rewrite a historical checkout or either comparison endpoint. */
export function applyNavigationScopePatch(value: KnowledgeBrowserState, patch: NavigationScopePatch): KnowledgeBrowserState {
  const next=structuredClone(value);
  if(patch.type==='reset'){next.query={offset:0,limit:40,includeUndated:true,includeUnlocated:true};delete next.fieldIds;delete next.scopeDraft;next.kindMode='all';}
  else if(patch.type==='filters'){if('typeIds'in patch.filters)next.kindMode=patch.filters.typeIds?.length?'types':'all';next.query={...next.query,...structuredClone(patch.filters),offset:0};if(next.scopeDraft){const d=next.scopeDraft,f=patch.filters;if('time'in f)[d.from,d.to]=f.time?.map(String)??['',''];if('text'in f)d.text=f.text??'';if('typeIds'in f){d.typeIds=[...f.typeIds??[]];d.kindMode=next.kindMode;}if('includeUndated'in f)d.includeUndated=f.includeUndated??true;if('includeUnlocated'in f)d.includeUnlocated=f.includeUnlocated??true;}}
  else{delete next.query.contextIds;delete next.query.unassigned;if(patch.selection.mode==='contexts')next.query.contextIds=[...patch.selection.contextIds];else if(patch.selection.mode==='unassigned')next.query.unassigned=true;if(patch.revision)next.queryRevision=patch.revision;if(next.scopeDraft){next.scopeDraft.contextIds=patch.selection.mode==='contexts'?[...patch.selection.contextIds]:[];next.scopeDraft.unassigned=patch.selection.mode==='unassigned';}next.query.offset=0;}
  next.view='overview';next.selectedObjectId=null;next.preview=null;next.objectTrail=[];
  return next;
}
