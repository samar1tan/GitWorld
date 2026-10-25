import type {
  HistoryBranch, HistoryCommit, HistoryContext, HistoryDataset, HistoryDiff,
  HistoryError, HistoryField, HistoryResult, HistorySnapshot, HistoryValue,
  ResolvedVersion, SearchHit, SnapshotAbsence, SnapshotField,
} from "./history-types.ts";
import { isHistoricalDate, isHistoricalYear, parseYear, yearRef } from "./dates.ts";

const success = <T>(value: T): HistoryResult<T> => ({ ok: true, value });
const failure = <T>(code: HistoryError["code"], subject?: string, candidates?: string[], details?: HistoryError["details"]): HistoryResult<T> =>
  ({ ok: false, error: { code, ...(subject ? { subject } : {}), ...(candidates ? { candidates } : {}), ...(details ? { details } : {}) } });
const clone = <T>(value: T): T => structuredClone(value);
const sameValue = (a: HistoryValue | undefined | null, b: HistoryValue | undefined | null) =>
  !a && !b ? true : Boolean(a && b && a.status === "known" && b.status === "known" && a.key === b.key);

export type HistoryEngine = ReturnType<typeof createHistoryEngine>;

/** Endpoint comparison does not infer ancestry across editorial revisions. */
export function compareHistorySnapshots(a: HistorySnapshot, b: HistorySnapshot, fieldIds: string[]): HistoryDiff['rows'] {
  return fieldIds.map(id => {
    const before = a.fields[id] ?? null, after = b.fields[id] ?? null;
    const beforeAbsence = a.removedFields[id] ?? null, afterAbsence = b.removedFields[id] ?? null;
    // A missing record is not evidence of historical absence.
    const kind = before?.status === 'known' && after?.status === 'known' ? (sameValue(before, after) ? 'same' : 'changed')
      : beforeAbsence && after?.status === 'known' ? 'added'
      : before?.status === 'known' && afterAbsence ? 'removed'
      : beforeAbsence && afterAbsence ? 'same' : 'unknown';
    return { fieldId: id, kind, before, after, beforeAbsence, afterAbsence };
  });
}

export function createHistoryEngine(input: HistoryDataset) {
  const dataset = clone(input);
  const branches = new Map<string, HistoryBranch>(dataset.branches.map((item) => [item.id, item]));
  const commits = new Map<string, HistoryCommit>(dataset.commits.map((item) => [item.id, item]));
  const fields = new Map<string, HistoryField>(dataset.fields.map((item) => [item.id, item]));
  const validationErrors: HistoryError[] = [];
  const invalid = (subject: string) => validationErrors.push({ code: "INVALID_DATASET", subject });
  if (branches.size !== dataset.branches.length) invalid("duplicate branch ID");
  if (commits.size !== dataset.commits.length) invalid("duplicate commit ID");
  if (fields.size !== dataset.fields.length) invalid("duplicate field ID");
  for (const branch of dataset.branches) {
    if (branch.coverage[0] > branch.coverage[1] || !branch.coverage.every(isHistoricalYear)) invalid(branch.id);
    if (!branch.commitIds.length || new Set(branch.commitIds).size !== branch.commitIds.length) invalid(branch.id);
    for (const id of branch.commitIds) {
      const commit = commits.get(id);
      if (!commit || commit.branchId !== branch.id || commit.year < branch.coverage[0] || commit.year > branch.coverage[1]) invalid(`${branch.id}:${id}`);
    }
    if (branch.forkCommitId && !commits.has(branch.forkCommitId)) invalid(`${branch.id}:fork`);
  }
  for (const commit of dataset.commits) {
    if (!branches.get(commit.branchId)?.commitIds.includes(commit.id) || !isHistoricalYear(commit.year)) invalid(commit.id);
    if (commit.date && (!isHistoricalDate(commit.date) || commit.year !== commit.date.latestYear)) invalid(`${commit.id}:date`);
    if (new Set(commit.parents).size !== commit.parents.length) invalid(`${commit.id}:duplicate-parent`);
    for (const parentId of commit.parents) {
      const parent = commits.get(parentId);
      if (!parent || parent.year > commit.year) invalid(`${commit.id}:parent:${parentId}`);
    }
    for (const [fieldId, value] of Object.entries(commit.changes)) {
      if (!fields.has(fieldId)) invalid(`${commit.id}:field:${fieldId}`);
      if (value && ((value.status === "known" && value.key === null) || (value.status !== "known" && value.key !== null))) invalid(`${commit.id}:value:${fieldId}`);
      if (value) for (const source of value.sourceIds) if (!dataset.sources[source]) invalid(`${commit.id}:source:${source}`);
    }
    for (const source of commit.sourceIds) if (!dataset.sources[source]) invalid(`${commit.id}:source:${source}`);
  }
  const visited = new Set<string>();
  for (const start of commits.keys()) {
    const visiting = new Set<string>();
    const stack: { id: string; leaving: boolean }[] = [{ id: start, leaving: false }];
    while (stack.length) {
      const { id, leaving } = stack.pop()!;
      if (leaving) { visiting.delete(id); visited.add(id); continue; }
      if (visiting.has(id)) { invalid(`${id}:cycle`); continue; }
      if (visited.has(id)) continue;
      visiting.add(id); stack.push({ id, leaving: true });
      for (const parent of commits.get(id)?.parents ?? []) stack.push({ id: parent, leaving: false });
    }
  }

  const byDate = (branch: HistoryBranch) => branch.commitIds.map((id) => commits.get(id)!).filter(Boolean).sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  const refCandidates = (branch: HistoryBranch) => {
    const records = byDate(branch);
    return records.map((commit) => records.filter((item) => item.year === commit.year).length > 1 ? `commit:${commit.id}` : `${branch.id}@${yearRef(commit.year)}`);
  };
  const dataError = <T>(): HistoryResult<T> | null => validationErrors.length ? { ok: false, error: clone(validationErrors[0]) } : null;

  function resolve(ref: string, context: HistoryContext = { head: null }): HistoryResult<ResolvedVersion> {
    const error = dataError<ResolvedVersion>();
    if (error) return error;
    const original = ref.trim();
    let target = original;
    if (target === "HEAD") {
      if (!context.head) return failure("HEAD_UNSET", "HEAD");
      target = context.head;
    }
    const exact = commits.get(target) ?? commits.get(target.replace(/^commit:/, ""));
    if (exact) return success({ input: original, ref: `commit:${exact.id}`, datasetVersion: dataset.id, commitId: exact.id, branchId: exact.branchId, recordedYear: exact.year, requestedYear: null, ...(exact.date ? { recordedDate: clone(exact.date) } : {}) });
    if (target.startsWith('tag:')) {
      const tag = dataset.tags?.find(item => item.id === target.slice(4));
      if (tag) { const result = resolve(`commit:${tag.commitId}`, context); return result.ok ? success({ ...result.value, input: original }) : result; }
    }
    if (target.startsWith("event:")) {
      const matches = dataset.commits.filter((item) => item.eventId === target.slice(6));
      if (matches.length > 1) return failure("AMBIGUOUS_REF", target, matches.map((item) => `commit:${item.id}`));
      if (matches.length === 1) {
        const resolved = resolve(`commit:${matches[0].id}`, context);
        return resolved.ok ? success({ ...resolved.value, input: original }) : resolved;
      }
    }
    const split = target.lastIndexOf("@");
    const branchId = split < 0 ? target : target.slice(0, split);
    const branch = branches.get(branchId);
    if (!branch) return failure("UNKNOWN_REF", original, [...branches.keys()].filter((id) => id.includes(branchId)).slice(0, 8));
    const dateText = split < 0 ? null : target.slice(split + 1);
    const requestedYear: number | null = dateText === null ? (context.currentYear ?? null) : parseYear(dateText);
    if (dateText !== null && (requestedYear === null || requestedYear === 0)) return failure("INVALID_ARGUMENT", original, refCandidates(branch));
    if (requestedYear === null) return failure("DATE_REQUIRED", branch.id, refCandidates(branch));
    if (!isHistoricalYear(requestedYear) || requestedYear < branch.coverage[0] || requestedYear > branch.coverage[1]) return failure("OUTSIDE_COVERAGE", branch.id, refCandidates(branch), { from: branch.coverage[0], to: branch.coverage[1], requestedYear });
    const uncertain = byDate(branch).filter(commit => commit.date && commit.date.earliestYear <= requestedYear && requestedYear < commit.date.latestYear);
    if (uncertain.length) return failure('DATE_UNCERTAIN', original, uncertain.map(commit => `commit:${commit.id}`));
    const matches = byDate(branch).filter((commit) => commit.year <= requestedYear!);
    const latest = matches.at(-1);
    if (!latest) return failure("NO_RECORDED_STATE", original, refCandidates(branch));
    const sameDate = matches.filter((commit) => commit.year === latest.year);
    if (sameDate.length > 1) return failure("AMBIGUOUS_REF", original, sameDate.map((commit) => `commit:${commit.id}`));
    return success({ input: original, ref: `commit:${latest.id}`, datasetVersion: dataset.id, commitId: latest.id, branchId: branch.id, recordedYear: latest.year, requestedYear, ...(latest.date ? { recordedDate: clone(latest.date) } : {}) });
  }

  const snapshotCache = new Map<string, HistorySnapshot>();
  function snapshot(commitId: string): HistoryResult<HistorySnapshot> {
    const error = dataError<HistorySnapshot>();
    if (error) return error;
    const id = commitId.replace(/^commit:/, '');
    if (!commits.has(id)) return failure('UNKNOWN_REF', commitId);
    if (snapshotCache.has(id)) return success(clone(snapshotCache.get(id)!));
    const stack: { id: string; leaving: boolean }[] = [{ id, leaving: false }];
    while (stack.length) {
      const item = stack.pop()!;
      if (snapshotCache.has(item.id)) continue;
      if (item.leaving) { const result = snapshotOne(item.id); if (!result.ok) return result; }
      else { stack.push({ id: item.id, leaving: true }); for (const parent of commits.get(item.id)!.parents) stack.push({ id: parent, leaving: false }); }
    }
    return success(clone(snapshotCache.get(id)!));
  }
  function snapshotOne(commitId: string): HistoryResult<HistorySnapshot> {
    const error = dataError<HistorySnapshot>();
    if (error) return error;
    const id = commitId.replace(/^commit:/, "");
    const cached = snapshotCache.get(id);
    if (cached) return success(clone(cached));
    const commit = commits.get(id);
    if (!commit) return failure("UNKNOWN_REF", commitId);
    const state: Record<string, SnapshotField> = {};
    const removedFields: Record<string, SnapshotAbsence> = {};
    const parentStates: HistorySnapshot[] = [];
    for (const parentId of commit.parents) {
      const parent = snapshot(parentId);
      if (!parent.ok) return parent;
      parentStates.push(parent.value);
    }
    for (const parent of parentStates) {
      for (const [fieldId, field] of Object.entries(parent.fields)) {
        if (!(fieldId in state)) state[fieldId] = clone(field);
      }
      for (const [fieldId, absence] of Object.entries(parent.removedFields)) {
        if (!(fieldId in removedFields)) removedFields[fieldId] = clone(absence);
      }
    }
    if (parentStates.length > 1) {
      for (const fieldId of new Set([...Object.keys(state), ...Object.keys(removedFields)])) {
        const first = parentStates[0];
        const agreement = parentStates.every((parent) => {
          const a = first.removedFields[fieldId], b = parent.removedFields[fieldId];
          if (a || b) return Boolean(a && b && a.changedAt === b.changedAt);
          const firstValue = first.fields[fieldId], nextValue = parent.fields[fieldId];
          if (!firstValue || !nextValue) return !firstValue && !nextValue;
          // Shared inherited records have one unambiguous origin. Independent
          // confirmations require an explicit choice even if the value matches.
          return firstValue.changedAt === nextValue.changedAt && (sameValue(firstValue, nextValue) || (firstValue.status !== "known" && firstValue.status === nextValue.status));
        });
        if (!agreement && !(fieldId in commit.changes)) return failure("INVALID_DATASET", `${id}:unresolved-merge:${fieldId}`);
      }
    }
    for (const [fieldId, change] of Object.entries(commit.changes)) {
      if (change === null) {
        if (!commit.sourceIds.length) return failure("INVALID_DATASET", `${id}:unsourced-absence:${fieldId}`);
        delete state[fieldId];
        removedFields[fieldId] = { fieldId, changedAt: id, sourceIds: [...commit.sourceIds], inherited: false };
      } else {
        state[fieldId] = { ...clone(change), fieldId, changedAt: id, inherited: false };
        delete removedFields[fieldId];
      }
    }
    for (const value of Object.values(state)) value.inherited = value.changedAt !== id;
    for (const absence of Object.values(removedFields)) absence.inherited = absence.changedAt !== id;
    const result: HistorySnapshot = { datasetVersion: dataset.id, commitId: id, branchId: commit.branchId, year: commit.year, ...(commit.date ? { date: clone(commit.date) } : {}), fields: state, removedFields };
    snapshotCache.set(id, clone(result));
    return success(result);
  }

  function ancestors(id: string): Set<string> {
    const result = new Set<string>();
    const pending = [id];
    while (pending.length) { const node = pending.pop()!; if (result.has(node)) continue; result.add(node); pending.push(...(commits.get(node)?.parents ?? [])); }
    return result;
  }
  function commonBases(a: string, b: string): string[] {
    const aa = ancestors(a.replace(/^commit:/, "")), bb = ancestors(b.replace(/^commit:/, ""));
    const common = [...aa].filter((id) => bb.has(id));
    return common.filter((candidate) => !common.some((other) => other !== candidate && ancestors(other).has(candidate)));
  }
  function diff(a: string, b: string, context: HistoryContext = { head: null }): HistoryResult<HistoryDiff> {
    const ar = resolve(a, context), br = resolve(b, context);
    if (!ar.ok) return ar;
    if (!br.ok) return br;
    const as = snapshot(ar.value.commitId), bs = snapshot(br.value.commitId);
    if (!as.ok) return as;
    if (!bs.ok) return bs;
    const rows = compareHistorySnapshots(as.value, bs.value, dataset.fields.map(field => field.id));
    return success({ a: ar.value, b: br.value, rows, commonBaseIds: commonBases(ar.value.commitId, br.value.commitId) });
  }
  function log(ref: string, context: HistoryContext = { head: null }): HistoryResult<{ branchId: string; commits: HistoryCommit[] }> {
    const error = dataError<{ branchId: string; commits: HistoryCommit[] }>();
    if (error) return error;
    // A bare branch requests its full recorded path, not a checkout at an inferred date.
    // resolve() still requires a date for bare branches used by show, checkout, or diff.
    const bareBranch = branches.get(ref);
    if (bareBranch) {
      const ids = new Set(bareBranch.commitIds.flatMap((id) => [...ancestors(id)]));
      const items = [...ids].map((id) => commits.get(id)!).filter(Boolean).sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
      return success({ branchId: bareBranch.id, commits: clone(items) });
    }
    const resolved = resolve(ref, context);
    if (!resolved.ok) return resolved;
    const items = [...ancestors(resolved.value.commitId)].map((id) => commits.get(id)!).filter(Boolean).sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
    return success({ branchId: resolved.value.branchId, commits: clone(items) });
  }
  function blame(ref: string, fieldId: string, context: HistoryContext = { head: null }): HistoryResult<{ version: ResolvedVersion; field: SnapshotField | SnapshotAbsence; absent: boolean; commit: HistoryCommit }> {
    if (!fields.has(fieldId)) return failure("UNKNOWN_FIELD", fieldId, [...fields.keys()]);
    const resolved = resolve(ref, context);
    if (!resolved.ok) return resolved;
    const state = snapshot(resolved.value.commitId);
    if (!state.ok) return state;
    const field = state.value.fields[fieldId] ?? state.value.removedFields[fieldId];
    if (!field) return failure("FIELD_UNRECORDED", fieldId);
    return success({ version: resolved.value, field, absent: Boolean(state.value.removedFields[fieldId]), commit: clone(commits.get(field.changedAt)!) });
  }
  function search(query: string): SearchHit[] {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const hits: SearchHit[] = [];
    for (const branch of dataset.branches) {
      if ([branch.id, ...Object.values(branch.name), ...Object.values(branch.description)].some((text) => typeof text === "string" && text.toLocaleLowerCase().includes(needle))) hits.push({ kind: "branch", id: branch.id, name: clone(branch.name), scopeId: branch.scopeId });
    }
    for (const commit of dataset.commits) {
      if ([commit.id, String(commit.year), ...Object.values(commit.title), ...Object.values(commit.summary)].some((text) => typeof text === "string" && text.toLocaleLowerCase().includes(needle))) hits.push({ kind: "commit", id: commit.id, name: clone(commit.title), year: commit.year, scopeId: branches.get(commit.branchId)?.scopeId ?? "" });
    }
    for (const tag of dataset.tags ?? []) {
      const commit = commits.get(tag.commitId);
      if ([tag.id, ...Object.values(tag.name)].some(text => typeof text === 'string' && text.toLocaleLowerCase().includes(needle))) hits.push({ kind: 'tag', id: tag.id, name: clone(tag.name), year: commit?.year, scopeId: commit ? branches.get(commit.branchId)?.scopeId ?? '' : '' });
    }
    return hits;
  }
  return { dataset, branches, commits, fields, validationErrors, resolve, snapshot, diff, log, blame, search, commonBases };
}
