export type HistoryLocale = "en" | "zh-CN";
/** English is the content baseline; a missing translation remains explicit. */
export type HistoryText = { en: string; "zh-CN"?: string };
/** Civil year numbering: -1 is 1 BCE, 1 is 1 CE; zero is invalid. */
export type HistoricalDate = { earliestYear: number; latestYear: number; precision: "year" | "approximate" | "interval"; calendar: "proleptic-gregorian"; note?: HistoryText };
export type SourceRights = { status: "unreviewed" | "approved" | "restricted" | "rejected"; license: string; basis: string; redistribution: "allowed" | "citation-only" | "prohibited"; attribution?: string; reviewedBy?: string; reviewedAt?: string };
export type ClaimEvidence = { sourceId: string; locator: string; note?: HistoryText };
export type HistorySource = { id: string; title: string; url: string; publisher: string; language: string; rights?: SourceRights; retrievedAt?: string; sourceRevision?: string; content?: string };
export type HistoryTag = { id: string; name: HistoryText; commitId: string; description?: HistoryText };
export type HistoryRelationship = { id: string; kind: "influence" | "contact"; fromCommitId: string; toCommitId: string; fieldIds: string[]; summary: HistoryText; evidence: ClaimEvidence[] };
export type LineageEdge = { parentId: string; kind: "continuation" | "split" | "integration"; evidence: ClaimEvidence[] };
export type IntegrationResolution = { strategy: "retain" | "modify" | "unknown" | "not-applicable" | "absent"; parentIds: string[]; evidence: ClaimEvidence[]; note?: HistoryText };

export type HistoryField = {
  id: string;
  name: HistoryText;
  group: string;
  description?: HistoryText;
  valueType?: "concept" | "text" | "number" | "boolean" | "set";
  applicableScopeIds?: string[];
};
export type HistoryValue = {
  key: string | null;
  label: HistoryText;
  status: "known" | "unknown" | "not-applicable";
  sourceIds: string[];
  note?: HistoryText;
  evidence?: ClaimEvidence[];
  certainty?: "documented" | "inferred" | "disputed";
  value?: string | number | boolean | string[];
};
export type HistoryCommit = {
  id: string;
  branchId: string;
  year: number;
  title: HistoryText;
  summary: HistoryText;
  parents: string[];
  changes: Record<string, HistoryValue | null>;
  sourceIds: string[];
  note?: HistoryText;
  eventId?: string;
  date?: HistoricalDate;
  kind?: "baseline" | "change" | "split" | "integration";
  lineage?: LineageEdge[];
  integration?: { resolutions: Record<string, IntegrationResolution> };
  evidence?: ClaimEvidence[];
};
export type HistoryBranch = {
  id: string;
  name: HistoryText;
  description: HistoryText;
  scopeId: string;
  processId: string;
  coverage: [number, number];
  commitIds: string[];
  forkCommitId?: string;
  color?: string;
};
export type HistoryDataset = {
  id: string;
  datasetId?: string;
  branches: HistoryBranch[];
  commits: HistoryCommit[];
  fields: HistoryField[];
  sources: Record<string, HistorySource>;
  tags?: HistoryTag[];
  relationships?: HistoryRelationship[];
};
export type SnapshotField = HistoryValue & {
  fieldId: string;
  changedAt: string;
  inherited: boolean;
};
export type SnapshotAbsence = {
  fieldId: string;
  changedAt: string;
  sourceIds: string[];
  inherited: boolean;
};
export type HistorySnapshot = {
  datasetVersion: string;
  commitId: string;
  branchId: string;
  year: number;
  date?: HistoricalDate;
  fields: Record<string, SnapshotField>;
  removedFields: Record<string, SnapshotAbsence>;
};
export type ResolvedVersion = {
  input: string;
  ref: string;
  datasetVersion: string;
  commitId: string;
  branchId: string;
  recordedYear: number;
  requestedYear: number | null;
  recordedDate?: HistoricalDate;
};
export type HistoryErrorCode =
  | "UNKNOWN_COMMAND" | "INVALID_ARGUMENT" | "UNSUPPORTED_SYNTAX"
  | "UNKNOWN_REF" | "AMBIGUOUS_REF" | "DATE_REQUIRED" | "OUTSIDE_COVERAGE"
  | "NO_RECORDED_STATE" | "HEAD_UNSET" | "UNKNOWN_FIELD" | "FIELD_UNRECORDED"
  | "INVALID_DATASET" | "NO_COMMON_BASE" | "MULTIPLE_COMMON_BASES" | "DATE_UNCERTAIN";
export type HistoryError = { code: HistoryErrorCode; subject?: string; candidates?: string[]; details?: Record<string, string | number> };
export type HistoryResult<T> = { ok: true; value: T } | { ok: false; error: HistoryError };
export type HistoryContext = {
  head: string | null;
  comparison?: [string, string] | null;
  currentYear?: number | null;
  scopeId?: string | null;
  timeWindow?: [number, number];
  selectedRef?: string | null;
};
export type DiffRow = {
  fieldId: string;
  kind: "changed" | "same" | "added" | "removed" | "unknown";
  before: SnapshotField | null;
  after: SnapshotField | null;
  beforeAbsence: SnapshotAbsence | null;
  afterAbsence: SnapshotAbsence | null;
};
export type HistoryDiff = {
  a: ResolvedVersion;
  b: ResolvedVersion;
  rows: DiffRow[];
  commonBaseIds: string[];
  query?: { a: ResolvedVersion; b: ResolvedVersion; mode: 'endpoints' | 'merge-base' };
};
export type SearchHit = { kind: "branch" | "commit" | "tag"; id: string; name: HistoryText; year?: number; scopeId: string };
export type CommandIntent =
  | { type: "help"; topic?: string }
  | { type: "status" }
  | { type: "branch"; all: boolean }
  | { type: "tag" }
  | { type: "trace"; ref: string }
  | { type: "search"; query: string }
  | { type: "log"; ref: string; graph: boolean }
  | { type: "show"; ref: string }
  | { type: "checkout"; ref: string }
  | { type: "diff"; a: string; b: string; mode?: "endpoints" | "merge-base" }
  | { type: "blame"; ref: string; fieldId: string };
export type CommandEffect =
  | { type: "none" }
  | { type: "preview"; version: ResolvedVersion }
  | { type: "history"; branchId: string; commitIds: string[] }
  | { type: "checkout"; version: ResolvedVersion }
  | { type: "compare"; a: ResolvedVersion; b: ResolvedVersion }
  | { type: "blame"; version: ResolvedVersion; fieldId: string; changedAt: string };
export type CommandOutput =
  | { kind: "help"; topic: string | null; commands: string[] }
  | { kind: "status"; datasetVersion: string; context: HistoryContext }
  | { kind: "branches"; branches: HistoryBranch[] }
  | { kind: "tags"; tags: HistoryTag[] }
  | { kind: "trace"; version: ResolvedVersion; relationships: HistoryRelationship[] }
  | { kind: "search"; query: string; hits: SearchHit[] }
  | { kind: "log"; ref: string; commits: HistoryCommit[]; branchId: string }
  | { kind: "snapshot"; version: ResolvedVersion; snapshot: HistorySnapshot }
  | { kind: "diff"; diff: HistoryDiff }
  | { kind: "blame"; version: ResolvedVersion; field: SnapshotField | SnapshotAbsence; absent: boolean; commit: HistoryCommit };
export type CommandExecution =
  | { ok: true; command: string; intent: CommandIntent; output: CommandOutput; effect: CommandEffect }
  | { ok: false; command: string; error: HistoryError; effect: { type: "none" } };
export type CommandCompletion = { value: string; label: HistoryText; kind: "command" | "ref" | "field"; year?: number };
