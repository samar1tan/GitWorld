export type HistoryLocale = "en" | "zh-CN";
export type HistoryText = Record<HistoryLocale, string>;
export type HistorySource = { id: string; title: string; url: string; publisher: string; language: string };

export type HistoryField = {
  id: string;
  name: HistoryText;
  group: string;
  description?: HistoryText;
};
export type HistoryValue = {
  key: string | null;
  label: HistoryText;
  status: "known" | "unknown";
  sourceIds: string[];
  note?: HistoryText;
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
  branches: HistoryBranch[];
  commits: HistoryCommit[];
  fields: HistoryField[];
  sources: Record<string, HistorySource>;
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
};
export type HistoryErrorCode =
  | "UNKNOWN_COMMAND" | "INVALID_ARGUMENT" | "UNSUPPORTED_SYNTAX"
  | "UNKNOWN_REF" | "AMBIGUOUS_REF" | "DATE_REQUIRED" | "OUTSIDE_COVERAGE"
  | "NO_RECORDED_STATE" | "HEAD_UNSET" | "UNKNOWN_FIELD" | "FIELD_UNRECORDED"
  | "INVALID_DATASET" | "NO_COMMON_BASE";
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
};
export type SearchHit = { kind: "branch" | "commit"; id: string; name: HistoryText; year?: number; scopeId: string };
export type CommandIntent =
  | { type: "help"; topic?: string }
  | { type: "status" }
  | { type: "branch"; all: boolean }
  | { type: "search"; query: string }
  | { type: "log"; ref: string; graph: boolean }
  | { type: "show"; ref: string }
  | { type: "checkout"; ref: string }
  | { type: "diff"; a: string; b: string }
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
  | { kind: "search"; query: string; hits: SearchHit[] }
  | { kind: "log"; ref: string; commits: HistoryCommit[]; branchId: string }
  | { kind: "snapshot"; version: ResolvedVersion; snapshot: HistorySnapshot }
  | { kind: "diff"; diff: HistoryDiff }
  | { kind: "blame"; version: ResolvedVersion; field: SnapshotField | SnapshotAbsence; absent: boolean; commit: HistoryCommit };
export type CommandExecution =
  | { ok: true; command: string; intent: CommandIntent; output: CommandOutput; effect: CommandEffect }
  | { ok: false; command: string; error: HistoryError; effect: { type: "none" } };
export type CommandCompletion = { value: string; label: HistoryText; kind: "command" | "ref" | "field"; year?: number };
