import type { WikipediaMappingSelection, WikipediaTableInspection } from '../../../../packages/contracts/src/wikipedia-types.ts';
import { validWikipediaSelection } from '../../../../packages/contracts/src/wikipedia-validation.ts';

export type WikipediaSection = 'search' | 'saved';
export type WikipediaTableDraft = { index: number; offset: number; headerHash: string; holder: string; dateLayout: 'split' | 'tenure'; tenure: string; start: string; end: string; firstRow: string; time: string; attributes: { column: string; kind: 'text' | 'linked-entities' }[]; sampleOpen: boolean };
export type WikipediaJobDraft = { jobId: string; sourceHash: string; profileId: '' | WikipediaMappingSelection['profileId']; calendar: 'source-unspecified' | 'Gregorian' | 'Julian'; offset: number; tables: WikipediaTableDraft[]; tablesOpen: boolean };
export type WikipediaInput = { schemaVersion: 1; active: boolean; section: WikipediaSection; title: string; revision: string; jobId: string | null; jobs: WikipediaJobDraft[] };
export type WikipediaFormError = 'profileRequired' | 'tableRequired' | 'columnsRequired' | 'distinctColumns' | 'rowInvalid' | 'sourceChanged';
export const blankWikipediaInput = (): WikipediaInput => ({ schemaVersion: 1, active: false, section: 'search', title: '', revision: '', jobId: null, jobs: [] });
export const blankWikipediaTable = (table: WikipediaTableInspection, offset: number): WikipediaTableDraft => ({ index: table.index, offset, headerHash: table.headerHash, holder: '', dateLayout: 'split', tenure: '', start: '', end: '', firstRow: '', time: '', attributes: [], sampleOpen: true });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const column = (value: string) => /^\d{1,2}$/.test(value) && Number(value) < 64 ? Number(value) : null;
export function parseWikipediaInput(value: string | null): WikipediaInput | null {
  if (!value || value.length > 160_000) return null;
  try {
    const input: unknown = JSON.parse(value);
    if (!record(input) || input.schemaVersion !== 1 || typeof input.active !== 'boolean' || !['search', 'saved'].includes(String(input.section)) || typeof input.title !== 'string' || input.title.length > 200 || typeof input.revision !== 'string' || input.revision.length > 20 || !(input.jobId === null || hash(input.jobId)) || !Array.isArray(input.jobs) || input.jobs.length > 10) return null;
    if (!input.jobs.every(job => record(job) && hash(job.jobId) && hash(job.sourceHash) && ['', 'office-tenures-v1', 'dated-entries-v1'].includes(String(job.profileId)) && ['source-unspecified', 'Gregorian', 'Julian'].includes(String(job.calendar)) && integer(job.offset, 10_000) && typeof job.tablesOpen === 'boolean' && Array.isArray(job.tables) && job.tables.length <= 10 && new Set(job.tables.map(table => record(table) ? table.index : null)).size === job.tables.length && job.tables.every(table => record(table) && integer(table.index, 999) && integer(table.offset, 10_000) && hash(table.headerHash) && ['split', 'tenure'].includes(String(table.dateLayout)) && typeof table.sampleOpen === 'boolean' && ['holder', 'tenure', 'start', 'end', 'firstRow', 'time'].every(key => typeof table[key] === 'string' && (table[key] as string).length <= 8) && Array.isArray(table.attributes) && table.attributes.length <= 10 && table.attributes.every(attribute => record(attribute) && typeof attribute.column === 'string' && attribute.column.length <= 2 && ['text', 'linked-entities'].includes(String(attribute.kind)))))) return null;
    if (new Set(input.jobs.map(job => (job as WikipediaJobDraft).jobId)).size !== input.jobs.length) return null;
    // Copy only recognized form fields; recovery is not a raw payload or operation journal.
    return { schemaVersion: 1, active: input.active, section: input.section as WikipediaSection, title: input.title, revision: input.revision, jobId: input.jobId as string | null, jobs: input.jobs.map(value => { const job = value as WikipediaJobDraft; return { jobId: job.jobId, sourceHash: job.sourceHash, profileId: job.profileId, calendar: job.calendar, offset: job.offset, tablesOpen: job.tablesOpen, tables: job.tables.map(table => ({ index: table.index, offset: table.offset, headerHash: table.headerHash, holder: table.holder, dateLayout: table.dateLayout, tenure: table.tenure, start: table.start, end: table.end, firstRow: table.firstRow, time: table.time, sampleOpen: table.sampleOpen, attributes: table.attributes.map(value => ({ column: value.column, kind: value.kind })) })) }; }) };
  } catch { return null; }
}
export function wikipediaSelection(draft: WikipediaJobDraft, tables: ReadonlyMap<number, WikipediaTableInspection>): { ok: true; selection: WikipediaMappingSelection } | { ok: false; error: WikipediaFormError } {
  const bad = (error: WikipediaFormError) => ({ ok: false as const, error });
  if (!draft.profileId) return bad('profileRequired');
  if (!draft.tables.length || draft.profileId === 'dated-entries-v1' && draft.tables.length !== 1) return bad('tableRequired');
  if (draft.tables.some(value => !tables.has(value.index) || tables.get(value.index)!.headerHash !== value.headerHash)) return bad('sourceChanged');
  const validColumn = (value: string, table: WikipediaTableDraft) => { const index = column(value); return index !== null && index < tables.get(table.index)!.columns ? index : null; };
  if (draft.profileId === 'office-tenures-v1') {
    const selected = [];
    for (const table of draft.tables) {
      const holder = validColumn(table.holder, table), first = validColumn(table.dateLayout === 'tenure' ? table.tenure : table.start, table), last = table.dateLayout === 'tenure' ? undefined : validColumn(table.end, table);
      if (holder === null || first === null || last === null) return bad('columnsRequired');
      const values = [holder, first, ...(last === undefined ? [] : [last])]; if (new Set(values).size !== values.length) return bad('distinctColumns');
      if (table.firstRow && (!/^\d{1,5}$/.test(table.firstRow) || Number(table.firstRow) > 10000)) return bad('rowInvalid');
      selected.push({ tableIndex: table.index, headerHash: table.headerHash, holderColumn: holder, ...(table.dateLayout === 'tenure' ? { tenureColumn: first } : { startColumn: first, endColumn: last! }), ...(table.firstRow ? { firstDataRow: Number(table.firstRow) } : {}) });
    }
    const selection: WikipediaMappingSelection = { profileId: draft.profileId, ...(draft.calendar === 'source-unspecified' ? {} : { calendar: draft.calendar }), tables: selected };
    return validWikipediaSelection(selection) ? { ok: true, selection } : bad('columnsRequired');
  }
  const table = draft.tables[0], time = validColumn(table.time, table), columns = table.attributes.map(value => ({ column: validColumn(value.column, table), kind: value.kind }));
  if (time === null || !columns.length || columns.some(value => value.column === null)) return bad('columnsRequired');
  if (new Set([time, ...columns.map(value => value.column)]).size !== columns.length + 1) return bad('distinctColumns');
  const selection: WikipediaMappingSelection = { profileId: draft.profileId, ...(draft.calendar === 'source-unspecified' ? {} : { calendar: draft.calendar }), tableIndex: table.index, headerHash: table.headerHash, timeColumn: time, columns: columns.map(value => ({ column: value.column!, kind: value.kind })) };
  return validWikipediaSelection(selection) ? { ok: true, selection } : bad('columnsRequired');
}
export function wikipediaSampleColumns(draft: WikipediaTableDraft, profile: WikipediaJobDraft['profileId']): number[] {
  const values = profile === 'office-tenures-v1' ? [draft.holder, ...(draft.dateLayout === 'tenure' ? [draft.tenure] : [draft.start, draft.end])] : [draft.time, ...draft.attributes.map(value => value.column)];
  return [...new Set(values.flatMap(value => column(value) === null ? [] : [Number(value)]))];
}
