import { canonicalJson, isRecord } from '../../domain/src/index.ts';
import type { DataPackage } from '../../domain/src/package.ts';
import type { ModelPresentation } from '../../contracts/src/workbench-types.ts';

const identity = 'gitworld-curated-history';
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'zh-CN').map(([key, item]) => [key, semantic(item)]));
}

/** A reviewed starter translation can supplement matching records, never change their substance. */
export function starterPresentation(data: DataPackage, reviewed: DataPackage | null, contentHash: string): ModelPresentation | undefined {
  if (!reviewed || data.dataset.id !== identity || reviewed.dataset.id !== identity || data.revision.id !== 'early-medieval-2026-10-25.1' || reviewed.revision.id !== 'early-medieval-2026-10-25.2') return;
  const basis = reviewed;
  const zhCN: ModelPresentation['zhCN'] = [];
  function collect(a: unknown, b: unknown, at: string[]) {
    if (Array.isArray(a) && Array.isArray(b)) { a.forEach((value, index) => collect(value, b[index], [...at, String(index)])); return; }
    if (!isRecord(a) || !isRecord(b)) return;
    if (typeof a.en === 'string' && a['zh-CN'] === undefined && typeof b['zh-CN'] === 'string') zhCN.push({ path: at, text: b['zh-CN'] });
    for (const key of Object.keys(a)) collect(a[key], b[key], [...at, key]);
  }
  function matched(a: unknown, b: unknown, at: string[]) {
    if (b !== undefined && canonicalJson(semantic(a)) === canonicalJson(semantic(b))) collect(a, b, at);
  }
  matched(data.dataset, reviewed.dataset, ['dataset']);
  function records(a: { id: string }[], b: { id: string }[], at: string[]) {
    const byId = new Map(b.map(value => [value.id, value]));
    a.forEach((record, index) => {
      const sourceIds = new Set<string>();
      const visit = (value: unknown) => { if (Array.isArray(value)) { value.forEach(visit); return; } if (!isRecord(value)) return; if (Array.isArray(value.sourceIds)) for (const id of value.sourceIds) if (typeof id === 'string') sourceIds.add(id); if (typeof value.sourceId === 'string') sourceIds.add(value.sourceId); Object.values(value).forEach(visit); };
      visit(record);
      // Citation edits are part of the semantic basis, not a translation opportunity.
      if ([...sourceIds].some(id => canonicalJson(data.history.sources[id] ?? null) !== canonicalJson(basis.history.sources[id] ?? null))) return;
      matched(record, byId.get(record.id), [...at, String(index)]);
    });
  }
  for (const key of ['scopes', 'processes', 'events', 'places'] as const) records(data.catalog[key], reviewed.catalog[key], ['catalog', key]);
  for (const key of ['branches', 'commits', 'fields', 'tags', 'relationships'] as const) records(data.history[key] ?? [], reviewed.history[key] ?? [], ['history', key]);
  return zhCN.length ? { contentHash, sourceRevisionId: reviewed.revision.id, zhCN } : undefined;
}
