import { readFile, stat } from 'node:fs/promises';
import { validateDataPackage, validateJsonBoundary, isRecord, type DataPackage, type ValidationIssue, type ValidationMode } from '../../domain/src/index.ts';

export const MAX_IMPORT_BYTES = 16_000_000;
export type ImportIssue = ValidationIssue | { code: 'INVALID_JSON' | 'INVALID_CSV' | 'FILE_READ_FAILED' | 'NETWORK_FAILED' | 'SOURCE_RECORD_INVALID' | 'STAGING_FAILED'; path: string; parameters?: Record<string, string | number> };
export type ImportReport = { format: 'json' | 'csv'; mode: ValidationMode; records: number; readyForReview: boolean };
export type ImportResult = { ok: boolean; package: DataPackage | null; issues: ImportIssue[]; report: ImportReport };
const tables = ['scope', 'process', 'event', 'place', 'branch', 'commit', 'field', 'source', 'tag', 'relationship'] as const;
type Table = typeof tables[number];
const destinations: Record<Table, [string, string]> = { scope: ['catalog', 'scopes'], process: ['catalog', 'processes'], event: ['catalog', 'events'], place: ['catalog', 'places'], branch: ['history', 'branches'], commit: ['history', 'commits'], field: ['history', 'fields'], source: ['history', 'sources'], tag: ['history', 'tags'], relationship: ['history', 'relationships'] };

/** RFC 4180-style records, with strict quote recovery and physical source lines. */
function readCsv(text: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = []; let cells: string[] = [], field = '', quoted = false, closed = false, line = 1, start = 1;
  const fail = () => { throw new Error(String(line)); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else { field += c; if (c === '\n') line++; }
    } else if (c === '"') { if (field || closed) fail(); quoted = true; }
    else if (c === ',') { cells.push(field); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cells.push(field); rows.push({ cells, line: start }); cells = []; field = ''; closed = false; line++; start = line;
    } else { if (closed) fail(); field += c; }
  }
  if (quoted) fail();
  if (field || cells.length || closed) { cells.push(field); rows.push({ cells, line: start }); }
  return rows;
}

/** A package row followed by typed object rows; nested values remain JSON, never evaluated. */
function parseCsv(text: string): { value: unknown; issues: ImportIssue[] } {
  let rows: ReturnType<typeof readCsv>;
  try { rows = readCsv(text.replace(/^\uFEFF/, '')); } catch (e) { return { value: null, issues: [{ code: 'INVALID_CSV', path: `line:${(e as Error).message}`, parameters: { reason: 'quote' } }] }; }
  const issue = (line: number, reason: string): ImportIssue => ({ code: 'INVALID_CSV', path: `line:${line}`, parameters: { reason } });
  if (!rows.length || rows[0].cells.join(',') !== 'type,id,payload') return { value: null, issues: [issue(1, 'header must be type,id,payload')] };
  const issues: ImportIssue[] = []; let pkg: any = null; const objects: { type: Table; id: string; value: any; line: number }[] = []; const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const [type, id, payload] = row.cells;
    if (row.cells.length !== 3 || !id || (type !== 'package' && !tables.includes(type as Table))) { issues.push(issue(row.line, 'record type, id, or column count')); continue; }
    if (seen.has(`${type}:${id}`)) { issues.push(issue(row.line, 'duplicate record')); continue; } seen.add(`${type}:${id}`);
    let value: any;
    try { value = JSON.parse(payload); } catch { issues.push(issue(row.line, 'payload must be JSON')); continue; }
    if (validateJsonBoundary(value).length) { issues.push(issue(row.line, 'unsafe payload')); continue; }
    if (type === 'package') {
      if (pkg || !isRecord(value) || !isRecord(value.dataset) || value.dataset.id !== id || !isRecord(value.catalog) || !isRecord(value.history)) { issues.push(issue(row.line, 'package metadata')); continue; }
      // Arrays are supplied exclusively by rows; accepting both would silently discard records.
      if (Object.values(destinations).some(([owner, key]) => Object.hasOwn(value[owner] as Record<string, unknown>, key))) { issues.push(issue(row.line, 'package payload must omit object tables')); continue; }
      pkg = value;
    } else {
      if (!value || typeof value !== 'object' || value.id !== id) { issues.push(issue(row.line, 'id does not match payload')); continue; }
      objects.push({ type: type as Table, id, value, line: row.line });
    }
  }
  if (!pkg) issues.push(issue(1, 'one package row is required'));
  if (issues.length) return { value: null, issues };
  for (const [owner, key] of Object.values(destinations)) pkg[owner][key] = key === 'sources' ? Object.create(null) : [];
  for (const { type, id, value } of objects) {
    const [owner, key] = destinations[type];
    if (key === 'sources') pkg[owner][key][id] = value; else pkg[owner][key].push(value);
  }
  return { value: pkg, issues: [] };
}

export function parseImport(text: string, options: { format: 'json' | 'csv'; mode?: ValidationMode }): ImportResult {
  const report: ImportReport = { format: options.format, mode: options.mode ?? 'draft', records: 0, readyForReview: false };
  const failure = (issues: ImportIssue[]): ImportResult => ({ ok: false, package: null, issues, report });
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) return failure([{ code: 'LIMIT_EXCEEDED', path: '$' }]);
  let value: unknown;
  if (options.format === 'csv') { const parsed = parseCsv(text); if (parsed.issues.length) return failure(parsed.issues); value = parsed.value; }
  else { try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return failure([{ code: 'INVALID_JSON', path: '$' }]); } }
  const result = validateDataPackage(value, report.mode);
  if (!result.ok) return failure(result.issues);
  report.records = result.value.history.commits.length; report.readyForReview = report.mode !== 'shape' || validateDataPackage(result.value, 'draft').ok;
  return { ok: true, package: result.value, issues: [], report };
}

export function exportPackageCsv(data: DataPackage): string {
  const checked = validateDataPackage(data, 'draft'); if (!checked.ok) throw new Error('Cannot export an invalid package.');
  const metadata = structuredClone(data) as any;
  for (const [owner, key] of Object.values(destinations)) delete metadata[owner][key];
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = [['type', 'id', 'payload'], ['package', data.dataset.id, JSON.stringify(metadata)]];
  for (const type of tables) {
    const [owner, key] = destinations[type]; const values = (data as any)[owner][key];
    for (const value of key === 'sources' ? Object.values(values) : values) rows.push([type, (value as any).id, JSON.stringify(value)]);
  }
  return rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** Host-only helper. The desktop renderer supplies a host-minted token, not this path. */
export async function loadDataPackageFile(path: string, mode: ValidationMode = 'draft'): Promise<ImportResult> {
  const format = path.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
  try {
    if ((await stat(path)).size > MAX_IMPORT_BYTES) return { ok: false, package: null, issues: [{ code: 'LIMIT_EXCEEDED', path: '$' }], report: { format, mode, records: 0, readyForReview: false } };
    return parseImport(await readFile(path, 'utf8'), { format, mode });
  } catch { return { ok: false, package: null, issues: [{ code: 'FILE_READ_FAILED', path: '$' }], report: { format, mode, records: 0, readyForReview: false } }; }
}
