import type { WikipediaMappingSelection } from './wikipedia-types.ts';
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:unknown,names:string[])=>record(v)&&Object.keys(v).every(key=>names.includes(key));
const column=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<64;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const validWikipediaTitle=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=200&&!/[\x00-\x1f\x7f#|]/.test(v)&&!v.includes('://')&&!v.startsWith('//');
export function validWikipediaSelection(v:unknown):v is WikipediaMappingSelection{
  if(!record(v)||v.calendar!==undefined&&!['Gregorian','Julian'].includes(v.calendar))return false;
  if(v.profileId==='office-tenures-v1')return keys(v,['profileId','tables','calendar'])&&Array.isArray(v.tables)&&v.tables.length>0&&v.tables.length<=10&&new Set(v.tables.map((t:any)=>t?.tableIndex)).size===v.tables.length&&v.tables.every((t:any)=>keys(t,['tableIndex','headerHash','holderColumn','tenureColumn','startColumn','endColumn','firstDataRow'])&&Number.isSafeInteger(t.tableIndex)&&t.tableIndex>=0&&t.tableIndex<1000&&hash(t.headerHash)&&column(t.holderColumn)&&(t.firstDataRow===undefined||Number.isSafeInteger(t.firstDataRow)&&t.firstDataRow>=0&&t.firstDataRow<=10000)&&(t.tenureColumn!==undefined?column(t.tenureColumn)&&t.startColumn===undefined&&t.endColumn===undefined&&t.tenureColumn!==t.holderColumn:column(t.startColumn)&&column(t.endColumn)&&t.startColumn!==t.endColumn&&t.startColumn!==t.holderColumn&&t.endColumn!==t.holderColumn));
  return v.profileId==='dated-entries-v1'&&keys(v,['profileId','tableIndex','headerHash','timeColumn','columns','calendar'])&&Number.isSafeInteger(v.tableIndex)&&v.tableIndex>=0&&v.tableIndex<1000&&hash(v.headerHash)&&column(v.timeColumn)&&Array.isArray(v.columns)&&v.columns.length>0&&v.columns.length<=10&&new Set(v.columns.map((c:any)=>c?.column)).size===v.columns.length&&v.columns.every((c:any)=>keys(c,['column','kind'])&&column(c.column)&&c.column!==v.timeColumn&&['text','linked-entities'].includes(c.kind));
}
