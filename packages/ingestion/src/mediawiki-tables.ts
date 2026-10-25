import { createHash } from 'node:crypto';
import { parseFragment, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import type { KnowledgeCollection, KnowledgeJson, KnowledgeQualifier, KnowledgeSource, KnowledgeTemporalScope, KnowledgeText, KnowledgeTime, KnowledgeValue } from '../../domain/src/knowledge.ts';
import { mapOfficeTenureRows, type OfficeTenureRow } from './office-projection.ts';
import type { SourceIssue, SourceRecordSnapshot, SourceResult, JsonValue } from './source-types.ts';
import { canonicalSourceJson } from './wikidata.ts';

export const WIKIPEDIA_TABLE_ADAPTER = 'english-wikipedia-office-tables-v1';
export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
export type PublishedLink = { href: string; text: string; title?: string; primary?: boolean };
export type PublishedCell = { text: string; tag: 'th' | 'td'; row: number; column: number; rowSpan: number; colSpan: number; links: PublishedLink[]; references: string[]; localized: KnowledgeText };
export type PublishedTable = { index: number; caption: string; captionLinks: PublishedLink[]; headings: { level: number; text: string; links: PublishedLink[] }[]; headers: string[]; rows: { index: number; cells: PublishedCell[]; grid: (PublishedCell | null)[]; group?: { text: string; links: PublishedLink[] } }[] };
export type TableMappingIssue = { code: 'UNSUPPORTED_HEADERS' | 'UNPARSED_TIME' | 'UNCERTAIN_TIME' | 'OPEN_END' | 'PROVISIONAL_HOLDER' | 'SOURCE_CHRONOLOGY_WARNING' | 'UNRESOLVED_VALUE'; table: number; row?: number; details?: string };
export type WikipediaTableMapping = { collection: KnowledgeCollection; tables: PublishedTable[]; issues: TableMappingIssue[]; report: { totalTables: number; selectedTables: number; sourceRows: number; mappedRows: number; timedRows: number; mappingVersion: typeof WIKIPEDIA_TABLE_ADAPTER } };
export type PublishedOfficeProfile = { id: string; revision: string; tables: { index: number; expectedHeaders: string[]; holderColumn: number; startColumn?: number; endColumn?: number; tenureColumn?: number; firstDataRow?: number; context?: { id: string; label: string }; reviewFlags?: string[]; stateColumns?: { column: number; propertyId: string }[] }[] };
export type WikipediaTableSnapshot = SourceRecordSnapshot & { retrievalMode: 'current-page' | 'fixed-revision' };
export type PublishedEventProfile = { id: string; revision: string; tableIndex: number; expectedHeaders: string[]; timeColumn: number; labels: KnowledgeText; columns: { column: number; propertyId: string; kind: 'text' | 'linked-entities' }[]; statusRules?: { column: number; contains: string; status: string }[]; reviewFlags?: string[] };
export type WikipediaOfficeOptions = { tableIndexes?: number[]; calendar?: string; warningTerms?: string[]; profile?: PublishedOfficeProfile; observeExplicitPresent?: boolean; eventProfile?: PublishedEventProfile };
export type WikipediaFactsManifest = {
  schemaVersion: 1; provider: 'wikipedia-en'; articleTitle: string; pageId: string; revision: string;
  permanentRevisionUrl: string; historyUrl: string; upstreamSnapshotHash: string; hashSemantics: string;
  retrievedAt: string; retrievalMode: 'current-page' | 'fixed-revision' | 'unknown';
  licenseId: 'CC-BY-SA-4.0'; licenseUrl: string; attribution: string; changes: string[]; factRows: number; factRecords: number; review: 'unreviewed';
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const element = (node: Tree.Node): node is Tree.Element => 'tagName' in node;
const attrs = (node: Tree.Element, key: string) => node.attrs.find(value => value.name === key)?.value;
const children = (node: Tree.Node): Tree.ChildNode[] => 'childNodes' in node ? node.childNodes : [];
const classes = (node: Tree.Element) => (attrs(node, 'class') ?? '').split(/\s+/);
const ignored = (node: Tree.Element) => ['script', 'style', 'svg', 'math', 'img', 'noscript'].includes(node.tagName) || classes(node).some(value => ['reference', 'mw-editsection', 'mw-cite-backlink'].includes(value));
function plain(node: Tree.Node, multiline = false): string {
  const parts: string[] = [], stack: { node: Tree.Node; close?: boolean }[] = [{ node }];
  while (stack.length) {
    const current = stack.pop()!;
    if (element(current.node) && ignored(current.node)) continue;
    if (current.node.nodeName === '#text' && 'value' in current.node) { parts.push(current.node.value); continue; }
    const block = element(current.node) && ['br', 'p', 'div', 'li'].includes(current.node.tagName);
    if (current.close) { if (block) parts.push('\n'); continue; }
    if (block) parts.push('\n'); stack.push({ node: current.node, close: true });
    for (const child of [...children(current.node)].reverse()) stack.push({ node: child });
  }
  return multiline ? parts.join('').replace(/[\t \r\f]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim() : parts.join('').replace(/\s+/g, ' ').trim();
}
function descendants(node: Tree.Node, skipNestedTables = false): Tree.Element[] {
  const result: Tree.Element[] = [], stack: Tree.Node[] = [...children(node)].reverse();
  while (stack.length) { const current = stack.pop()!; if (!element(current)) continue; if (skipNestedTables && current.tagName === 'table') continue; result.push(current); if (result.length > 250000) throw new Error('TABLE_STRUCTURE_LIMIT'); stack.push(...[...children(current)].reverse()); }
  return result;
}
function links(node: Tree.Node): PublishedLink[] {
  return descendants(node).filter(value => value.tagName === 'a' && !!attrs(value, 'href')).map(value => {
    let parent = value.parentNode, primary = false;
    while (parent && parent !== node) { if (element(parent) && ['b', 'strong'].includes(parent.tagName)) primary = true; parent = 'parentNode' in parent ? parent.parentNode : null; }
    return { href: attrs(value, 'href')!, text: plain(value), ...(attrs(value, 'title') ? { title: attrs(value, 'title')! } : {}), ...(primary ? { primary: true } : {}) };
  });
}
function span(value: string | undefined, remaining: number, row = false) { if (row && value === '0') return remaining; const number = value === undefined ? 1 : Number(value); if (!Number.isSafeInteger(number) || number < 1 || number > 1000) throw new Error('TABLE_STRUCTURE_LIMIT'); return number; }
function readTable(table: Tree.Element, index: number, headings: PublishedTable['headings']): PublishedTable {
  const nodes = descendants(table, true), captionNode = nodes.find(value => value.tagName === 'caption'), tr = nodes.filter(value => value.tagName === 'tr');
  if (tr.length > 10000) throw new Error('TABLE_STRUCTURE_LIMIT');
  const grid: (PublishedCell | null)[][] = [], rows: PublishedTable['rows'] = [], headers: string[] = [];
  let inHeader = true, group: PublishedTable['rows'][number]['group'];
  for (const [rowIndex, row] of tr.entries()) {
    const cells: PublishedCell[] = []; grid[rowIndex] ??= []; let column = 0;
    const sourceCells = children(row).filter((value): value is Tree.Element => element(value) && ['td', 'th'].includes(value.tagName));
    // Full-width annotation/section rows are not holder rows. They can overlap
    // visual rowspans in upstream HTML; no tenure is inferred from that layout.
    if (!inHeader && sourceCells.length === 1 && span(attrs(sourceCells[0], 'colspan'), 1) >= Math.max(2, headers.length)) {
      const heading = descendants(sourceCells[0]).find(value => /^h[1-6]$/.test(value.tagName));
      if (heading) group = { text: plain(heading), links: links(heading) };
      continue;
    }
    for (const cell of sourceCells) {
      while (grid[rowIndex][column]) column++;
      const rowSpan = span(attrs(cell, 'rowspan'), tr.length - rowIndex, true), colSpan = span(attrs(cell, 'colspan'), 1), localized: KnowledgeText = {};
      if (column + colSpan > 64) throw new Error('TABLE_STRUCTURE_LIMIT');
      for (const node of descendants(cell)) { const language = attrs(node, 'lang'); if (language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) && !localized[language] && plain(node)) localized[language] = plain(node); }
      const value: PublishedCell = { text: plain(cell, true), tag: cell.tagName as 'td' | 'th', row: rowIndex, column, rowSpan, colSpan, links: links(cell), references: links(cell).filter(value => value.href.startsWith('#cite_note')).map(value => value.href), localized };
      cells.push(value);
      for (let r = rowIndex; r < Math.min(tr.length, rowIndex + rowSpan); r++) { grid[r] ??= []; for (let c = column; c < column + colSpan; c++) { if (grid[r][c]) throw new Error(`TABLE_SPAN_OVERLAP:${index}:${rowIndex}:${column}:${r}:${c}:${grid[r][c]!.text.slice(0, 60)}`); grid[r][c] = value; } }
      column += colSpan;
    }
    if (inHeader && cells.length > 1 && cells.every(value => value.tag === 'th')) {
      for (const [c, cell] of grid[rowIndex].entries()) if (cell) headers[c] = [...new Set([...(headers[c] ? headers[c].split(' / ') : []), cell.text.replace(/\n/g, ' ')])].join(' / ');
      continue;
    }
    inHeader = false;
    if (cells.length === 1 && cells[0].colSpan >= Math.max(2, headers.length)) { group = { text: cells[0].text.replace(/\n/g, ' '), links: cells[0].links }; continue; }
    if (!cells.length) continue;
    rows.push({ index: rowIndex, cells, grid: grid[rowIndex], ...(group ? { group: structuredClone(group) } : {}) });
  }
  return { index, caption: captionNode ? plain(captionNode) : '', captionLinks: captionNode ? links(captionNode) : [], headings: structuredClone(headings), headers, rows };
}

/** Parses source HTML as inert data; scripts, images and article rendering are outside this adapter. */
export function extractPublishedTables(html: string): PublishedTable[] {
  if (Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error('TABLE_RESPONSE_TOO_LARGE');
  const document = parseFragment(html), stack: Tree.Node[] = [...document.childNodes].reverse(), headings = new Map<number, PublishedTable['headings'][number]>(), tables: PublishedTable[] = [];
  let count = 0;
  while (stack.length) {
    const node = stack.pop()!; if (++count > 500000) throw new Error('TABLE_STRUCTURE_LIMIT');
    if (element(node) && /^h[1-6]$/.test(node.tagName)) { const level = Number(node.tagName[1]); for (const key of headings.keys()) if (key >= level) headings.delete(key); headings.set(level, { level, text: plain(node), links: links(node) }); }
    if (element(node) && node.tagName === 'table') { if (classes(node).includes('wikitable')) { if (tables.length >= 200) throw new Error('TABLE_STRUCTURE_LIMIT'); tables.push(readTable(node, tables.length, [...headings.values()])); } continue; }
    stack.push(...[...children(node)].reverse());
  }
  return tables;
}

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
type DatePart = { year: number; era?: string; month?: number; day?: number };
function datePart(value: string): DatePart | null {
  const cleaned=value.trim().replace(/[†‡§*]+$/g, '').replace(/^(?:abdicated|died|deposed|retired|resigned)\s*:?\s+/i, '').trim();
  const numeric=cleaned.match(/^(\d{1,4})-(\d{2})-(\d{2})\s*(BCE?|CE|AD)?$/i);
  if(numeric){if(Number(numeric[1])===0)return null;return{year:Number(numeric[1]),month:Number(numeric[2]),day:Number(numeric[3]),...(numeric[4]?{era:numeric[4].toUpperCase()}:{})};}
  const monthFirst=cleaned.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{1,4})\s*(BCE?|CE|AD)?$/i);
  if(monthFirst){if(Number(monthFirst[3])===0)return null;return{year:Number(monthFirst[3]),month:months.indexOf(monthFirst[1].toLowerCase())+1,day:Number(monthFirst[2]),...(monthFirst[4]?{era:monthFirst[4].toUpperCase()}:{})};}
  const match = cleaned.match(/^(?:(\d{1,2})\s+)?(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{1,4})\s*(BCE?|CE|AD)?$/i);
  if (!match || Number(match[3]) === 0 || match[1] && !match[2]) return null;
  return { year: Number(match[3]), ...(match[4] ? { era: match[4].toUpperCase() } : {}), ...(match[2] ? { month: months.indexOf(match[2].toLowerCase()) + 1 } : {}), ...(match[1] ? { day: Number(match[1]) } : {}) };
}
function intervalParts(value:string):string[]{
  const dateHyphens=new Set<number>();
  for(const match of value.matchAll(/\b\d{1,4}-\d{2}-\d{2}(?!\d)/g)){dateHyphens.add(match.index!+match[0].indexOf('-'));dateHyphens.add(match.index!+match[0].lastIndexOf('-'));}
  const parts:string[]=[];let start=0;
  for(let index=0;index<value.length;index++)if(/[–—−-]/.test(value[index])&&!dateHyphens.has(index)){parts.push(value.slice(start,index).trim());start=index+1;}
  parts.push(value.slice(start).trim());return parts;
}
function civilDateIssue(value: KnowledgeTime): 'UNPARSED_TIME' | 'UNCERTAIN_TIME' | undefined {
  const calendar=value.calendar.trim().toLowerCase(),gregorian=/^(?:proleptic[-_ ]+)?gregorian$/.test(calendar),julian=/^(?:proleptic[-_ ]+)?julian$/.test(calendar),unspecified=/^(?:published-)?source-(?:calendar-)?unspecified$/.test(calendar);
  if(!gregorian&&!julian&&!unspecified)return 'UNCERTAIN_TIME';
  if(value.month===undefined)return;
  if(!Number.isInteger(value.month)||value.month<1||value.month>12)return 'UNPARSED_TIME';
  if(value.day===undefined)return;
  if(!Number.isInteger(value.day)||value.day<1)return 'UNPARSED_TIME';
  // Historical BCE has no year zero; astronomical numbering is used only for leap arithmetic.
  const year=value.earliestYear<0?value.earliestYear+1:value.earliestYear;
  const julianLeap=year%4===0,gregorianLeap=julianLeap&&(year%100!==0||year%400===0),lengths=[31,28,31,30,31,30,31,31,30,31,30,31];
  const valid=(leap:boolean)=>value.day!<=(value.month===2&&leap?29:lengths[value.month!-1]);
  if(gregorian)return valid(gregorianLeap)?undefined:'UNPARSED_TIME';
  if(julian)return valid(julianLeap)?undefined:'UNPARSED_TIME';
  const g=valid(gregorianLeap),j=valid(julianLeap);return g&&j?undefined:g||j?'UNCERTAIN_TIME':'UNPARSED_TIME';
}
export function parsePublishedTenure(value: string, options: { bce?: boolean; calendar?: string; trailingEraNames?: boolean } = {}): { validTime?: KnowledgeTemporalScope; raw: string; issue?: 'UNPARSED_TIME' | 'UNCERTAIN_TIME' | 'OPEN_END' } {
  const raw = value, beforeEra = value.split(/\bEra(?:\(s\)|s)?(?:\s|$)/i)[0], leading = beforeEra.split('(')[0].replace(/\s+/g, ' ').trim();
  const trailing = beforeEra.slice(beforeEra.indexOf(')') + 1).trim();
  const eraMetadata = options.trailingEraNames && !/^(?:\d|January|February|March|April|May|June|July|August|September|October|November|December)/i.test(trailing) && /^\d+\s*(?:years?|months?|days?)(?:\s*,\s*\d+\s*(?:years?|months?|days?))*$/i.test(beforeEra.slice(beforeEra.indexOf('(') + 1, beforeEra.indexOf(')')).trim());
  if (beforeEra.includes(')') && /\d[^\n]{0,40}[–—-][^\n]{0,40}\d/.test(trailing) && !eraMetadata) return { raw, issue: 'UNPARSED_TIME' };
  if (/\b(?:circa|about|early|late|before|after|or|possibly|tentative)\b|\bc\.|\?/i.test(leading)) return { raw, issue: 'UNCERTAIN_TIME' };
  const pieces = intervalParts(leading);
  if (!leading || pieces.length > 2) return { raw, issue: 'UNPARSED_TIME' };
  let start = datePart(pieces[0]), end = pieces.length === 2 ? datePart(pieces[1]) : start;
  const open = pieces.length === 2 && (!pieces[1] || /^(present|incumbent|current)$/i.test(pieces[1]));
  if (pieces.length === 2 && /^\d{1,2}$/.test(pieces[0]) && end?.month) start = { ...end, day: Number(pieces[0]) };
  if (!start && end && pieces.length === 2) {
    const incomplete = pieces[0].match(/^(?:(\d{1,2})\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)$/i);
    if (incomplete) start = { year: end.year, month: months.indexOf(incomplete[2].toLowerCase()) + 1, ...(end.era ? { era: end.era } : {}), ...(incomplete[1] ? { day: Number(incomplete[1]) } : {}) };
  }
  if (!start || !end && !open) return { raw, issue: 'UNPARSED_TIME' };
  const time = (part: DatePart, inheritedEra?: string): KnowledgeTime => {
    const year = (part.era ?? inheritedEra ?? (options.bce ? 'BCE' : 'CE')).startsWith('BC') ? -part.year : part.year;
    return { earliestYear: year, latestYear: year, precision: part.day !== undefined ? 'day' : part.month !== undefined ? 'month' : 'year', calendar: options.calendar ?? 'published-source-calendar-unspecified', raw, ...(part.month !== undefined ? { month: part.month } : {}), ...(part.day !== undefined ? { day: part.day } : {}) };
  };
  const first=time(start,end?.era),firstIssue=civilDateIssue(first);if(firstIssue)return{raw,issue:firstIssue};
  if (open) return { raw, validTime: { start: first }, issue: 'OPEN_END' };
  const last = time(end!, start.era),lastIssue=civilDateIssue(last);if(lastIssue)return{raw,issue:lastIssue};
  const reversedWithinYear=first.earliestYear===last.latestYear&&first.month!==undefined&&last.month!==undefined&&(first.month>last.month||first.month===last.month&&first.day!==undefined&&last.day!==undefined&&first.day>last.day);
  if (first.earliestYear > last.latestYear || reversedWithinYear) return { raw, issue: 'UNPARSED_TIME' };
  return { raw, validTime: { start: first, end: last } };
}

function article(link: PublishedLink): { id: string; label: string; url: string } | null {
  try { const url = new URL(link.href, 'https://en.wikipedia.org/'); if (url.origin !== 'https://en.wikipedia.org' || !url.pathname.startsWith('/wiki/') || url.search || url.hash) return null; const title = decodeURIComponent(url.pathname.slice(6)); if (!title || /^(File|Category|Help|Template|Special|Wikipedia|Talk):/i.test(title)) return null; return { id: `wikipedia-en:${title}`, label: link.title ?? link.text, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replaceAll('%20', '_')}` }; } catch { return null; }
}
function labels(cell: PublishedCell): KnowledgeText {
  const first = cell.text.split(/\n|Other names/)[0].trim(), chinese = first.search(/\p{Script=Han}/u), english = (chinese > 0 ? first.slice(0, chinese) : first).trim();
  return { ...(english && chinese !== 0 ? { en: english } : {}), ...Object.fromEntries(Object.entries(cell.localized).filter(([language]) => language !== 'en')) };
}

/** Generic header/row mapping; historical identity binding and adoption remain explicit review work. */
export function mapWikipediaOfficeTables(snapshot: SourceRecordSnapshot, options: WikipediaOfficeOptions = {}): WikipediaTableMapping {
  const raw = snapshot.raw;
  if (snapshot.identity.provider !== 'wikipedia-en' || !object(raw) || typeof raw.text !== 'string' || typeof raw.title !== 'string' || !Number.isSafeInteger(raw.revid) || String(raw.revid) !== snapshot.sourceRevision || String(raw.pageid) !== snapshot.identity.externalId || digest(canonicalSourceJson(raw)) !== snapshot.contentHash) throw new Error('INVALID_WIKIPEDIA_TABLE_SOURCE');
  const tables = extractPublishedTables(raw.text), issues: TableMappingIssue[] = [], rows: OfficeTenureRow[] = [], additionalStates: { rowId: string; officeId: string; propertyId: string; value: string; locator: string; qualifiers: KnowledgeQualifier[]; validTime?: KnowledgeTemporalScope }[] = [];
  if (options.profile && (!options.profile.id || options.profile.revision !== snapshot.sourceRevision || new Set(options.profile.tables.map(value => value.index)).size !== options.profile.tables.length || options.profile.tables.some(profile => !Number.isSafeInteger(profile.index) || !tables[profile.index] || JSON.stringify(tables[profile.index].headers) !== JSON.stringify(profile.expectedHeaders) || [profile.holderColumn, profile.startColumn, profile.endColumn, profile.tenureColumn, profile.firstDataRow, ...(profile.stateColumns ?? []).map(value => value.column)].some(value => value !== undefined && (!Number.isInteger(value) || value < 0)) || profile.stateColumns?.some(value => !value.propertyId || value.propertyId === 'office:holder') || profile.context && (!profile.context.id || !profile.context.label)))) throw new Error('INVALID_WIKIPEDIA_TABLE_PROFILE');
  let selectedTables = 0, sourceRows = 0, timedRows = 0;
  for (const table of tables) {
    if (options.tableIndexes && !options.tableIndexes.includes(table.index)) continue;
    const profile = options.profile?.tables.find(value => value.index === table.index);
    if (options.profile && !profile) continue;
    const keys = table.headers.map(value => value.toLowerCase().replace(/\s+/g, ' ').trim()), tenures = keys.flatMap((value, index) => /^(?:(?:tentative|speculative)\s+)?(?:reign|term|tenure|term of office)(?:\s|$)/.test(value) && !/duration/.test(value) ? [index] : []), name = keys.findIndex(value => value === 'personal name');
    const startColumn = profile?.startColumn ?? (profile?.tenureColumn !== undefined ? -1 : keys.findIndex(value => /(?:^|\s|\/)(?:start|from|took office|entered office)$/.test(value))), endColumn = profile?.endColumn ?? (profile?.tenureColumn !== undefined ? -1 : keys.findIndex(value => /(?:^|\s|\/)(?:end|until|to|left office)$/.test(value))), paired = startColumn >= 0 && endColumn >= 0 && startColumn !== endColumn, tenure = paired ? startColumn : profile?.tenureColumn ?? tenures[0] ?? -1;
    const fallbackName = keys.findIndex(value => /^(name|monarch|emperor|prime minister)(?:\s|$|\()/.test(value) || /\((?:lifespan|birth[–-]death)\)$/.test(value)), nameColumn = profile?.holderColumn ?? (name >= 0 ? name : fallbackName);
    if (tenure < 0 || nameColumn < 0) { issues.push({ code: 'UNSUPPORTED_HEADERS', table: table.index, details: table.headers.join(' | ') }); continue; }
    selectedTables++; sourceRows += table.rows.length;
    const seenTermCells = new Set<string>();
    for (const row of table.rows) {
      if (profile?.firstDataRow !== undefined && row.index < profile.firstDataRow) continue;
      const preferredName = row.grid[nameColumn], alternatives = profile ? [] : keys.flatMap((key, index) => /^(?:posthumous|dynastic|temple|era) name/.test(key) ? [row.grid[index]] : []);
      const personCell = [preferredName, ...alternatives].find(value => value && value.text.trim() && !/^[–—-]$|^(?:unknown|not recorded)$/i.test(value.text.trim())), reignCell = row.grid[tenure]; if (!personCell || !reignCell) {if(profile&&!personCell)issues.push({code:'PROVISIONAL_HOLDER',table:table.index,row:row.index});continue;}
      if (paired && row.grid[startColumn] === row.grid[endColumn] && reignCell.colSpan > 1) continue;
      const personLinks = [personCell, ...alternatives].flatMap(cell => cell ? cell.links.filter(link => link.text && cell.text.split('Other names')[0].replace(/\s+/g, ' ').includes(link.text)).sort((a, b) => Number(!!b.primary) - Number(!!a.primary)) : []);
      const person = personLinks.map(article).find(value => !!value), context = row.group ?? { text: table.caption || table.headings.at(-1)?.text || raw.title, links: table.captionLinks.length ? table.captionLinks : table.headings.at(-1)?.links ?? [] };
      const captionMatches = row.group ? table.captionLinks.filter(link => link.text.trim() && context.text.toLowerCase().includes(link.text.toLowerCase().trim())).map(article).filter(value => !!value) : [];
      const contextArticle = context.links.map(article).find(value => !!value) ?? (captionMatches.length === 1 ? captionMatches[0] : null), scope = profile?.context?.id ?? contextArticle?.id ?? `${snapshot.identity.externalId}:table:${table.index}:group:${digest(context.text).slice(0, 16)}`;
      const tenureText = paired ? `${reignCell.text.replace(/\n/g, ' ')} – ${row.grid[endColumn]?.text.replace(/\n/g, ' ') ?? ''}` : reignCell.text;
      const termCells = JSON.stringify([scope, personCell.row, personCell.column, reignCell.row, reignCell.column, paired ? row.grid[endColumn]?.row : null, paired ? row.grid[endColumn]?.column : null]);
      if (seenTermCells.has(termCells)) continue;
      seenTermCells.add(termCells);
      const bases = [...new Set(`${tenureText} ${keys[tenure]} ${paired ? keys[endColumn] : ''}`.match(/\bde[ -]+(?:facto|jure)\b/gi)?.map(value => value.toLowerCase().replace(/[ -]+/, '-')) ?? [])];
      const normalizedTenure = bases.length <= 1 ? tenureText.replace(/\bde[ -]+(?:facto|jure)\s*/gi, '') : tenureText;
      const parsed = !paired && profile?.tenureColumn === undefined && (tenures.length !== 1 || /length|tentative|speculative/.test(keys[tenure] ?? '')) ? { raw: tenureText, issue: 'UNCERTAIN_TIME' as const } : parsePublishedTenure(normalizedTenure, { bce: /\bBCE?\b/i.test(keys[tenure] ?? ''), calendar: options.calendar, trailingEraNames: /\bera names\b/.test(keys[tenure] ?? '') });
      for (const time of [parsed.validTime?.start, parsed.validTime?.end, parsed.validTime?.point]) if (time) time.raw = tenureText;
      if (parsed.issue) issues.push({ code: parsed.issue, table: table.index, row: row.index, details: tenureText });
      const warningText = [...table.headings.map(value => value.text), table.caption, row.group?.text ?? '', table.headers.join(' '), ...keys.flatMap((key, column) => key === 'life details' && /mytholog|legend|speculativ|tentativ|traditional|historicity/i.test(row.grid[column]?.text ?? '') ? [row.grid[column]?.text ?? ''] : [])].join(' ');
      const warning = /mytholog|legend|speculativ|tentativ|traditional/i.test(warningText.replace(/\bnon[ -]legendary\b/gi, '')) || options.warningTerms?.some(term => warningText.toLowerCase().includes(term.toLowerCase()));
      if (warning) issues.push({ code: 'SOURCE_CHRONOLOGY_WARNING', table: table.index, row: row.index, details: warningText });
      if (!person) issues.push({ code: 'PROVISIONAL_HOLDER', table: table.index, row: row.index });
      const holderId = person?.id ?? (profile ? `wikipedia-provisional:${snapshot.identity.externalId}:${snapshot.contentHash}:${table.index}:${personCell.row}:${personCell.column}` : `wikipedia-provisional:${snapshot.identity.externalId}:${table.index}:${row.index}`), officeId = `wikipedia-office-scope:${digest(scope).slice(0, 32)}`;
      const qualifiers: KnowledgeQualifier[] = [
        { propertyId: 'source:table-context', value: { kind: 'text', value: context.text } },
        { propertyId: 'source:context-identity', value: { kind: 'entity', objectId: scope } },
        ...(contextArticle ? [{ propertyId: 'source:context-url', value: { kind: 'text' as const, value: contextArticle.url } }] : []),
        { propertyId: 'source:tenure-text', value: { kind: 'text', value: tenureText } },
        ...(!paired && tenures.length > 1 ? [{ propertyId: 'source:alternative-tenure-columns', value: { kind: 'raw' as const, value: tenures.map(column => ({ header: table.headers[column], text: row.grid[column]?.text ?? '', column })) } }] : []),
        { propertyId: 'source:table-locator', value: { kind: 'text', value: `table:${table.index};row:${row.index};name-column:${nameColumn};tenure-column:${tenure}${paired ? `;end-column:${endColumn}` : ''}` } },
        { propertyId: 'source:citation-anchors', value: { kind: 'raw', value: [...new Set([...personCell.references, ...reignCell.references, ...row.cells.flatMap(value => value.references)])] } },
        { propertyId: 'source:scope-semantics', value: { kind: 'text', value: 'published-rulership-table-scope-not-canonical-polity-or-ancestry' } },
        ...(bases.length === 1 ? [{ propertyId: 'office:authority-basis', value: { kind: 'text' as const, value: bases[0] } }] : []),
        ...(tenureText.match(/[†‡§*]/g)?.length ? [{ propertyId: 'source:date-markers', value: { kind: 'text' as const, value: [...new Set(tenureText.match(/[†‡§*]/g))].join('') } }] : []),
        ...(tenureText.match(/\b(?:abdicated|died|deposed|retired|resigned)\b/gi)?.length ? [{ propertyId: 'source:tenure-end-marker', value: { kind: 'text' as const, value: tenureText.match(/\b(?:abdicated|died|deposed|retired|resigned)\b/gi)!.join(', ') } }] : []),
        ...(options.profile ? [{ propertyId: 'source:column-profile', value: { kind: 'text' as const, value: options.profile.id } }] : []),
      ];
      if (parsed.validTime) timedRows++;
      const rowId = digest(JSON.stringify([scope, holderId, tenureText, row.index])).slice(0, 32);
      rows.push({ id: rowId, holder: { id: holderId, labels: { ...labels(personCell), ...(person?.label ? { en: person.label } : {}) } }, office: { id: officeId, labels: { en: profile?.context?.label ?? contextArticle?.label ?? context.text } }, locator: `$.text;table[${table.index}].row[${row.index}].cell[${reignCell.column}]`, qualifiers,
        ...(parsed.validTime ? { validTime: parsed.validTime } : {}), reviewFlags: ['UNREVIEWED_PUBLISHED_TABLE_MAPPING', ...(!options.calendar ? ['SOURCE_CALENDAR_UNSPECIFIED'] : []), ...(profile?.reviewFlags ?? []), ...(parsed.issue ? [parsed.issue] : []), ...(warning ? ['SOURCE_CHRONOLOGY_WARNING'] : []), ...(!person ? ['PROVISIONAL_HOLDER'] : [])] });
      for (const column of profile?.stateColumns ?? []) {
        const cell = row.grid[column.column]; if (!cell || !cell.text || cell.colSpan > 1) continue;
        additionalStates.push({ rowId, officeId, propertyId: column.propertyId, value: cell.text.replace(/\n/g, ' '), locator: `$.text;table[${table.index}].row[${row.index}].cell[${cell.column}]`, qualifiers: [...structuredClone(qualifiers), { propertyId: 'source:column-heading', value: { kind: 'text', value: table.headers[column.column] ?? String(column.column) } }], ...(parsed.validTime ? { validTime: structuredClone(parsed.validTime) } : {}) });
      }
    }
  }
  const source: KnowledgeSource = { id: `${snapshot.identity.provider}:${snapshot.identity.externalId}@${snapshot.contentHash}`, identity: snapshot.identity, revision: snapshot.sourceRevision, contentHash: snapshot.contentHash, retrievedAt: snapshot.retrievedAt, url: snapshot.url, ...(snapshot.revisionUrl ? { revisionUrl: snapshot.revisionUrl } : {}), adapterVersion: WIKIPEDIA_TABLE_ADAPTER, rights: snapshot.rights, record: snapshot.raw as KnowledgeJson };
  const collection = rows.length ? mapOfficeTenureRows(rows, source, { id: WIKIPEDIA_TABLE_ADAPTER, evidenceUrl: snapshot.revisionUrl ?? snapshot.url }).collection : { schemaVersion: 1 as const, objects: [], assertions: [], sources: [] };
  for (const state of additionalStates) collection.assertions.push({ id: `wikipedia-table-field:${snapshot.identity.externalId}:${state.rowId}:${state.propertyId}`, subjectId: state.officeId, propertyId: state.propertyId, value: { kind: 'text', value: state.value }, qualifiers: state.qualifiers, evidence: [{ sourceId: source.id, locator: state.locator }], sourceSnapshotId: source.id, review: 'unreviewed', ...(state.validTime ? { validTime: state.validTime } : {}) });
  if (options.observeExplicitPresent && 'retrievalMode' in snapshot && snapshot.retrievalMode === 'current-page') {
    const observedAt = new Date(snapshot.retrievedAt);
    if (!Number.isFinite(observedAt.getTime())) throw new Error('INVALID_WIKIPEDIA_OBSERVATION_DATE');
    for (const claim of collection.assertions.filter(value => (value.propertyId === 'office:held-position' && value.value.kind === 'entity' || value.id.startsWith('wikipedia-table-field:')) && value.validTime?.start && !value.validTime.end && value.qualifiers.some(qualifier => qualifier.propertyId === 'source:tenure-text' && qualifier.value.kind === 'text' && /\b(?:present|incumbent|current)\b/i.test(qualifier.value.value.split(/\bEra(?:\(s\)|s)?(?:\s|$)/i)[0].split('(')[0])))) {
      const heldPosition = claim.propertyId === 'office:held-position';
      collection.assertions.push({ ...structuredClone(claim), id: `wikipedia-current-reading:${digest(`${claim.id}:${snapshot.sourceRevision}:${snapshot.retrievedAt}`).slice(0, 32)}`, subjectId: heldPosition ? (claim.value as { kind: 'entity'; objectId: string }).objectId : claim.subjectId, propertyId: heldPosition ? 'office:holder' : claim.propertyId, value: heldPosition ? { kind: 'entity', objectId: claim.subjectId } : structuredClone(claim.value),
        qualifiers: [...structuredClone(claim.qualifiers), { propertyId: 'projection:derived-from', value: { kind: 'text', value: claim.id } }, { propertyId: 'observation:kind', value: { kind: 'text', value: 'current-source-reading' } }, { propertyId: 'observation:acquisition-mode', value: { kind: 'text', value: 'current-page' } }, { propertyId: 'observation:observed-at', value: { kind: 'text', value: snapshot.retrievedAt } }, { propertyId: 'observation:semantics', value: { kind: 'text', value: 'explicit-current-marker-read-at-retrieval-not-a-political-event-or-tenure-end' } }],
        validTime: { point: { earliestYear: observedAt.getUTCFullYear(), latestYear: observedAt.getUTCFullYear(), month: observedAt.getUTCMonth() + 1, day: observedAt.getUTCDate(), precision: 'day', calendar: 'proleptic-gregorian-utc-observation', raw: snapshot.retrievedAt } } });
    }
  }
  return { collection, tables, issues, report: { totalTables: tables.length, selectedTables, sourceRows, mappedRows: rows.length, timedRows, mappingVersion: WIKIPEDIA_TABLE_ADAPTER } };
}

/** A declared event table yields dated participants/attributes without claiming completion or causation. */
export function mapWikipediaEventTable(snapshot: SourceRecordSnapshot, profile: PublishedEventProfile, options: { calendar?: string } = {}): WikipediaTableMapping {
  const parsed = mapWikipediaOfficeTables(snapshot, { tableIndexes: [] }), table = parsed.tables[profile.tableIndex];
  if (!profile.id || profile.revision !== snapshot.sourceRevision || !table || JSON.stringify(table.headers) !== JSON.stringify(profile.expectedHeaders) || !Number.isInteger(profile.timeColumn) || profile.timeColumn < 0 || !Object.keys(profile.labels).length || profile.columns.some(value => !Number.isInteger(value.column) || value.column < 0 || !value.propertyId || !['text', 'linked-entities'].includes(value.kind)) || profile.statusRules?.some(value => !Number.isInteger(value.column) || value.column < 0 || !value.contains || value.contains.length > 120 || !value.status)) throw new Error('INVALID_WIKIPEDIA_EVENT_PROFILE');
  const source: KnowledgeSource = { id: `${snapshot.identity.provider}:${snapshot.identity.externalId}@${snapshot.contentHash}`, identity: snapshot.identity, revision: snapshot.sourceRevision, contentHash: snapshot.contentHash, retrievedAt: snapshot.retrievedAt, url: snapshot.url, ...(snapshot.revisionUrl ? { revisionUrl: snapshot.revisionUrl } : {}), adapterVersion: WIKIPEDIA_TABLE_ADAPTER, rights: snapshot.rights, record: snapshot.raw as KnowledgeJson };
  const collection: KnowledgeCollection = { schemaVersion: 1, objects: [], assertions: [], sources: [source] }, issues: TableMappingIssue[] = []; let timedRows = 0;
  for (const row of table.rows) {
    const yearCell = row.grid[profile.timeColumn]; if (!yearCell || !yearCell.text.trim()) continue;
    const time = parsePublishedTenure(yearCell.text, { calendar: options.calendar });
    if (time.issue) issues.push({ code: time.issue, table: table.index, row: row.index, details: yearCell.text });
    let scope = time.validTime;
    if (scope?.start && scope.end && scope.start.earliestYear === scope.end.latestYear && scope.start.month === scope.end.month && scope.start.day === scope.end.day) scope = { point: scope.start };
    if (scope) timedRows++;
    const objectId = `wikipedia-event:${snapshot.identity.externalId}:${digest(JSON.stringify([profile.id, row.index, yearCell.text])).slice(0, 32)}`;
    collection.objects.push({ id: objectId, identities: [{ provider: 'wikipedia-event-row', externalId: `${snapshot.identity.externalId}:${table.index}:${row.index}` }], labels: Object.fromEntries(Object.entries(profile.labels).map(([language, label]) => [language, `${label} · ${yearCell.text.replace(/\n/g, ' ')}`])), descriptions: {}, aliases: [], types: ['gitworld:source-event-entry'] });
    const qualifiers: KnowledgeQualifier[] = [
      { propertyId: 'source:column-profile', value: { kind: 'text', value: profile.id } },
      { propertyId: 'source:tenure-text', value: { kind: 'text', value: yearCell.text } },
      { propertyId: 'source:listing-semantics', value: { kind: 'text', value: 'published-event-entry-not-automatic-completion-causation-or-ancestry' } },
      { propertyId: 'source:citation-anchors', value: { kind: 'raw', value: [...new Set(row.cells.flatMap(value => value.references))] } },
      ...(profile.reviewFlags ?? []).map(value => ({ propertyId: 'source:review-flag', value: { kind: 'text' as const, value } })),
    ];
    const add = (propertyId: string, value: KnowledgeValue, column: number, extra: KnowledgeQualifier[] = []) => collection.assertions.push({ id: `wikipedia-event-claim:${digest(JSON.stringify([objectId, propertyId, value, column])).slice(0, 32)}`, subjectId: objectId, propertyId, value, qualifiers: [...structuredClone(qualifiers), ...extra], evidence: [{ sourceId: source.id, locator: `$.text;table[${table.index}].row[${row.index}].cell[${row.grid[column]?.column ?? column}]` }], sourceSnapshotId: source.id, review: 'unreviewed', ...(scope ? { validTime: structuredClone(scope) } : {}) });
    if (scope?.point) add('event:listed-time', { kind: 'time', value: scope.point }, profile.timeColumn);
    for (const mapping of profile.columns) {
      const cell = row.grid[mapping.column]; if (!cell || !cell.text.trim()) continue;
      if (mapping.kind === 'text') add(mapping.propertyId, { kind: 'text', value: cell.text.replace(/\n/g, ' ') }, mapping.column);
      else {
        const values = [...new Map(cell.links.map(article).filter((value): value is NonNullable<typeof value> => !!value).map(value => [value.id, value])).values()];
        if (!values.length) { issues.push({ code: 'UNRESOLVED_VALUE', table: table.index, row: row.index, details: cell.text }); add(mapping.propertyId, { kind: 'text', value: cell.text.replace(/\n/g, ' ') }, mapping.column); }
        else for (const value of values) add(mapping.propertyId, { kind: 'entity', objectId: value.id }, mapping.column, [{ propertyId: 'source:linked-label', value: { kind: 'text', value: value.label } }, { propertyId: 'source:linked-url', value: { kind: 'text', value: value.url } }]);
      }
    }
    for (const status of profile.statusRules ?? []) if (row.grid[status.column]?.text.toLowerCase().includes(status.contains.toLowerCase())) add('event:listed-status', { kind: 'text', value: status.status }, status.column, [{ propertyId: 'source:status-marker', value: { kind: 'text', value: status.contains } }]);
  }
  return { collection, tables: parsed.tables, issues, report: { totalTables: parsed.tables.length, selectedTables: 1, sourceRows: table.rows.length, mappedRows: collection.objects.length, timedRows, mappingVersion: WIKIPEDIA_TABLE_ADAPTER } };
}

/**
 * Separates an inspectable factual publication candidate from the local raw archive.
 * This is not historical review or approval to publish the candidate.
 */
export function createWikipediaFactsCandidate(snapshot: SourceRecordSnapshot, options: Parameters<typeof mapWikipediaOfficeTables>[1] = {}): { collection: KnowledgeCollection; manifest: WikipediaFactsManifest; report: WikipediaTableMapping['report']; issues: TableMappingIssue[] } {
  if (snapshot.rights.licenseId !== 'CC-BY-SA-4.0' || snapshot.rights.redistribution !== 'allowed') throw new Error('WIKIPEDIA_FACTS_LICENSE_REQUIRED');
  const mapped = options.eventProfile ? mapWikipediaEventTable(snapshot, options.eventProfile, options) : mapWikipediaOfficeTables(snapshot, options), raw = snapshot.raw as Record<string, JsonValue>, title = String(raw.title);
  const permanentRevisionUrl = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&oldid=${snapshot.sourceRevision}`, historyUrl = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=history`;
  const originalClaims = mapped.collection.assertions.filter(value => !value.qualifiers.some(value => value.propertyId === 'projection:derived-from'));
  const changes = ['Selected table-linked names and primary date facts; excluded article prose, portraits, image tags and HTML.', 'Retained source table/row/cell locators, citation anchors, competing chronology flags and original date precision.', options.eventProfile ? 'Normalized dated source-event entries and listed participant links; inferred no completion, causation or political ancestry. Profile display labels are editorial labels rather than original quotations.' : 'Normalized source facts into unreviewed office-holder assertions and analytical source scopes; inferred no polity ancestry.', ...(mapped.collection.assertions.some(value => value.qualifiers.some(value => value.propertyId === 'observation:kind')) ? ['Explicit Present/Incumbent source rows also have a current-source-reading point at retrieval; this is neither a political event nor an inferred tenure endpoint.'] : [])];
  const manifest: WikipediaFactsManifest = { schemaVersion: 1, provider: 'wikipedia-en', articleTitle: title, pageId: snapshot.identity.externalId, revision: snapshot.sourceRevision!, permanentRevisionUrl, historyUrl, upstreamSnapshotHash: snapshot.contentHash,
    hashSemantics: 'SHA-256 of the canonical original Action API parse record; raw record remains in the local acquisition archive.', retrievedAt: snapshot.retrievedAt, retrievalMode: 'retrievalMode' in snapshot && ['current-page', 'fixed-revision'].includes(String(snapshot.retrievalMode)) ? snapshot.retrievalMode as WikipediaFactsManifest['retrievalMode'] : 'unknown', licenseId: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: `${title}, English Wikipedia contributors. Source: ${permanentRevisionUrl}. Author history: ${historyUrl}. GitWorld selected and normalized table facts; changes are recorded in this manifest. No official endorsement.`, changes, factRows: mapped.report.mappedRows, factRecords: originalClaims.length, review: 'unreviewed' };
  const primary = (value: string) => {
    const text = value.split(/\bEra(?:\(s\)|s)?(?:\s|$)/i)[0].split('(')[0].replace(/[†‡§*]/g, '').replace(/\b(?:abdicated|died|deposed|retired|resigned)\s*:?\s*/gi, '').replace(/\s+/g, ' ').trim();
    const residue = text.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|BCE?|CE|AD|de|facto|jure|circa|c|early|late|before|after|or|present|incumbent|current|since|unknown|not|known|spring|summer|autumn|fall|winter|century|centuries)\b/gi, '').replace(/[0-9\s.,:;/–—−?*\-]/g, '');
    return text.length <= 160 && !residue ? text : '';
  };
  const facts = originalClaims.map(assertion => ({ id: assertion.id, subjectId: assertion.subjectId, propertyId: assertion.propertyId, value: assertion.value,
    upstreamLocator: assertion.evidence[0]?.locator ?? '', primaryTenureText: primary(assertion.qualifiers.find(value => value.propertyId === 'source:tenure-text' && value.value.kind === 'text')?.value.kind === 'text' ? (assertion.qualifiers.find(value => value.propertyId === 'source:tenure-text')!.value as { kind: 'text'; value: string }).value : ''),
    citationAnchors: assertion.qualifiers.find(value => value.propertyId === 'source:citation-anchors')?.value ?? { kind: 'raw', value: [] } }));
  const record = { manifest, facts }, contentHash = digest(canonicalSourceJson(record as unknown as JsonValue)), sourceId = `wikipedia-en-facts:${snapshot.identity.externalId}@${contentHash}`, factIndex = new Map(originalClaims.map((value, index) => [value.id, index]));
  const collection = structuredClone(mapped.collection);
  collection.sources = [{ id: sourceId, identity: { provider: 'wikipedia-en-facts', externalId: snapshot.identity.externalId }, revision: snapshot.sourceRevision, contentHash, retrievedAt: snapshot.retrievedAt, url: snapshot.url, revisionUrl: permanentRevisionUrl, adapterVersion: 'english-wikipedia-fact-subset-v1', rights: { licenseId: manifest.licenseId, licenseUrl: manifest.licenseUrl, attribution: manifest.attribution, redistribution: 'allowed' }, record: record as unknown as KnowledgeJson }];
  for (const assertion of collection.assertions) {
    const parent = assertion.qualifiers.find(value => value.propertyId === 'projection:derived-from' && value.value.kind === 'text') ?? assertion.id;
    const originalId = typeof parent === 'string' ? parent : parent?.value.kind === 'text' ? parent.value.value : '';
    const index = factIndex.get(originalId); if (index === undefined) throw new Error('INVALID_WIKIPEDIA_FACT_DERIVATION');
    assertion.sourceSnapshotId = sourceId; assertion.evidence = [{ sourceId, locator: `$.facts[${index}]`, url: permanentRevisionUrl }];
    for (const qualifier of assertion.qualifiers) {
      if (qualifier.propertyId === 'source:tenure-text' && qualifier.value.kind === 'text') qualifier.value.value = primary(qualifier.value.value);
      if (qualifier.propertyId === 'source:alternative-tenure-columns' && qualifier.value.kind === 'raw' && Array.isArray(qualifier.value.value)) qualifier.value.value = qualifier.value.value.map(value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' ? { ...value, text: primary(value.text) } : value);
    }
    if (!assertion.qualifiers.some(value => value.propertyId === 'observation:kind')) for (const time of [assertion.validTime?.start, assertion.validTime?.end, assertion.validTime?.point]) if (time?.raw) time.raw = primary(time.raw);
  }
  return { collection, manifest, report: mapped.report, issues: mapped.issues.map(({ details: _details, ...issue }) => issue) };
}

/** Acquires one complete revision-qualified source page; batch orchestration must stop on backpressure. */
export async function fetchWikipediaTablePage(options: { title: string; revision?: number; signal?: AbortSignal }, dependencies: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<SourceResult<WikipediaTableSnapshot>> {
  const title = options.title.trim();
  if (!title || title.length > 200 || options.revision !== undefined && (!Number.isSafeInteger(options.revision) || options.revision < 1)) return { ok: false, error: { code: 'INVALID_REQUEST', retryable: false } };
  const url = new URL(WIKIPEDIA_API); for (const [key, value] of Object.entries({ action: 'parse', ...(options.revision ? { oldid: String(options.revision) } : { page: title }), redirects: '1', prop: 'text|revid|displaytitle', format: 'json', formatversion: '2', maxlag: '5' })) url.searchParams.set(key, value);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    if (options.signal?.aborted) return { ok: false, error: { code: 'CANCELLED', retryable: true } };
    const response = await (dependencies.fetch ?? fetch)(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20000), ...(options.signal ? [options.signal] : [])]), headers: { Accept: 'application/json', 'User-Agent': 'GitWorld/0.1 source-ingestion (https://github.com/samar1tan/GitWorld)' } });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, error: { code: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', retryable: [429, 502, 503, 504].includes(response.status), status: response.status, requestUrl: String(url), ...(response.headers.get('retry-after') && /^\d+$/.test(response.headers.get('retry-after')!) ? { retryAfterMs: Number(response.headers.get('retry-after')) * 1000 } : {}) } }; }
    if (!response.body || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) { await response.body?.cancel(); return { ok: false, error: { code: 'RESPONSE_TOO_LARGE', retryable: false } }; }
    reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 8 * 1024 * 1024) return { ok: false, error: { code: 'RESPONSE_TOO_LARGE', retryable: false } }; chunks.push(next.value); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } }; }
    if (!object(raw)) return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } };
    if (object(raw.error)) { const providerCode = String(raw.error.code); return { ok: false, error: { code: providerCode === 'maxlag' ? 'UPSTREAM_BUSY' : providerCode === 'ratelimited' ? 'RATE_LIMITED' : 'API_ERROR', retryable: ['maxlag', 'ratelimited', 'readonly'].includes(providerCode), providerCode, requestUrl: String(url) } }; }
    const parsed = raw.parse;
    if (!object(parsed) || typeof parsed.title !== 'string' || !Number.isSafeInteger(parsed.pageid) || !Number.isSafeInteger(parsed.revid) || typeof parsed.text !== 'string' || options.revision !== undefined && options.revision !== parsed.revid) return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } };
    const revisionUrl = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(parsed.title)}&oldid=${parsed.revid}`;
    return { ok: true, value: { identity: { provider: 'wikipedia-en', externalId: String(parsed.pageid) }, sourceRevision: String(parsed.revid), retrievedAt: (dependencies.now?.() ?? new Date()).toISOString(), url: `https://en.wikipedia.org/wiki/${encodeURIComponent(parsed.title).replaceAll('%20', '_')}`, revisionUrl, contentHash: digest(canonicalSourceJson(parsed)), mediaType: 'application/json', raw: parsed,
      rights: { licenseId: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: `${parsed.title}, English Wikipedia contributors; ${revisionUrl}; author history: https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(parsed.title)}&action=history. GitWorld extracts and normalizes table facts; images and article rendering are excluded.`, redistribution: 'allowed' }, adapterVersion: WIKIPEDIA_TABLE_ADAPTER, retrievalMode: options.revision ? 'fixed-revision' : 'current-page' } };
  } catch { const error: SourceIssue = options.signal?.aborted ? { code: 'CANCELLED', retryable: true } : { code: 'NETWORK_FAILED', retryable: true, requestUrl: String(url) }; return { ok: false, error }; }
  finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
}
