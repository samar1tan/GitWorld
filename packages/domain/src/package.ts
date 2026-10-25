import type { HistoryDataset, HistoryText } from './history-types.ts';

export const DATA_PACKAGE_SCHEMA_VERSION = 1 as const;
export type DatasetRef = { datasetId: string; revisionId: string };
export type VersionRef = DatasetRef & { commitId: string; requestedYear: number | null };
export type MapBox = { x: number; y: number; width: number; height: number };
export type Scope = { id: string; parentId: string | null; name: HistoryText; summary: HistoryText; coverage: [number, number]; viewBox?: MapBox; location?: { x: number; y: number }; sourceIds: string[] };
export type Process = { id: string; scopeIds: string[]; name: HistoryText; summary: HistoryText; coverage: [number, number]; branchIds: string[]; eventIds: string[]; sourceIds: string[] };
export type Event = { id: string; title: HistoryText; summary: HistoryText; commitIds: string[]; sourceIds: string[] };
export type Place = { id: string; name: HistoryText; scopeIds: string[]; longitude: number; latitude: number };
export type RuntimeCatalog = { scopes: Scope[]; processes: Process[]; events: Event[]; places: Place[]; defaults: { timeWindow: [number, number]; scopeId: string | null; worldView: MapBox } };
export type DataPackage = {
  schemaVersion: typeof DATA_PACKAGE_SCHEMA_VERSION;
  dataset: { id: string; name: HistoryText; description: HistoryText; license: string };
  revision: { id: string; parentRevisionId: string | null; createdAt: string; notes: HistoryText };
  catalog: RuntimeCatalog;
  /** id is the revision ID; datasetId is the stable dataset identity. */
  history: HistoryDataset;
};
export type ValidationCode = 'INVALID_SHAPE' | 'UNSUPPORTED_SCHEMA' | 'INVALID_ID' | 'DUPLICATE_ID' | 'INVALID_DATE' | 'DANGLING_REFERENCE' | 'INVALID_GRAPH' | 'INVALID_VALUE' | 'MISSING_EVIDENCE' | 'RIGHTS_UNREVIEWED' | 'REDISTRIBUTION_DENIED' | 'INTEGRATION_REQUIRED' | 'REVISION_MISMATCH' | 'LIMIT_EXCEEDED';
export type ValidationIssue = { code: ValidationCode; path: string; parameters?: Record<string, string | number> };
export type ValidationResult<T> = { ok: true; value: T; issues: [] } | { ok: false; issues: ValidationIssue[] };
export type ValidationMode = 'shape' | 'draft' | 'publish';

export const sameDatasetRef = (a: DatasetRef, b: DatasetRef): boolean => a.datasetId === b.datasetId && a.revisionId === b.revisionId;
