import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryEngine } from "./history-engine.ts";
import { completeCommand, executeCommand, executeIntent, parseCommand } from "./commands.ts";
import type { HistoryDataset, HistoryResult, HistoryValue } from "./history-types.ts";

const text = (value: string) => ({ en: value, "zh-CN": value });
const known = (key: string): HistoryValue => ({ key, label: text(key), status: "known", sourceIds: ["source"] });
const unknown: HistoryValue = { key: null, label: text("Unrecorded"), status: "unknown", sourceIds: [] };
const unwrap = <T>(result: HistoryResult<T>): T => {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
const fixture = (): HistoryDataset => ({
  id: "test-v1",
  sources: { source: { id: "source", title: "Test fixture", url: "https://example.com", publisher: "Test", language: "en" } },
  fields: ["ruler", "institution", "capital", "record"].map((id) => ({ id, name: text(id), group: "politics" })),
  branches: [
    { id: "realm/main", name: text("Realm"), description: text("Shared history"), scopeId: "europe", processId: "test", coverage: [800, 842], commitIds: ["root-800", "shared-814"] },
    { id: "realm/west", name: text("West"), description: text("Western path"), scopeId: "europe", processId: "test", coverage: [843, 870], commitIds: ["west-843", "west-870"], forkCommitId: "shared-814" },
    { id: "realm/east", name: text("East"), description: text("Eastern path"), scopeId: "europe", processId: "test", coverage: [843, 870], commitIds: ["east-843"], forkCommitId: "shared-814" },
    { id: "court/main", name: text("Court"), description: text("Independent path"), scopeId: "east-asia", processId: "court", coverage: [710, 794], commitIds: ["court-710", "court-794"] },
  ],
  commits: [
    { id: "root-800", branchId: "realm/main", year: 800, title: text("First"), summary: text("Initial state"), parents: [], sourceIds: ["source"], changes: { ruler: known("first"), institution: known("shared"), capital: unknown, record: known("note") } },
    { id: "shared-814", branchId: "realm/main", year: 814, title: text("Second"), summary: text("New ruler"), parents: ["root-800"], sourceIds: ["source"], changes: { ruler: known("second") } },
    { id: "west-843", branchId: "realm/west", year: 843, title: text("Western split"), summary: text("Split"), parents: ["shared-814"], sourceIds: ["source"], eventId: "split", changes: { ruler: known("west") } },
    { id: "east-843", branchId: "realm/east", year: 843, title: text("Eastern split"), summary: text("Split"), parents: ["shared-814"], sourceIds: ["source"], eventId: "split", changes: { ruler: known("east") } },
    { id: "west-870", branchId: "realm/west", year: 870, title: text("Later"), summary: text("Later change"), parents: ["west-843"], sourceIds: ["source"], changes: { ruler: known("later-west"), record: null } },
    { id: "court-710", branchId: "court/main", year: 710, title: text("Nara"), summary: text("Court"), parents: [], sourceIds: ["source"], changes: { capital: known("nara"), institution: known("court") } },
    { id: "court-794", branchId: "court/main", year: 794, title: text("Heian"), summary: text("Court moves"), parents: ["court-710"], sourceIds: ["source"], changes: { capital: known("heian") } },
  ],
});
const engine = createHistoryEngine(fixture());

test("snapshots replay parent changes and preserve field provenance without mutating the dataset", () => {
  assert.deepEqual(engine.validationErrors, []);
  const snapshot = unwrap(engine.snapshot("west-843"));
  assert.equal(snapshot.fields.institution.key, "shared");
  assert.equal(snapshot.fields.institution.changedAt, "root-800");
  assert.equal(snapshot.fields.institution.inherited, true);
  assert.equal(snapshot.fields.ruler.changedAt, "west-843");
  assert.equal(snapshot.fields.ruler.inherited, false);
  snapshot.fields.institution.key = "mutated";
  assert.equal(unwrap(engine.snapshot("west-843")).fields.institution.key, "shared");
  assert.equal(engine.commits.get("root-800")!.changes.institution!.key, "shared");
});

test("as-of references report requested and actual recorded dates and enforce coverage", () => {
  const version = unwrap(engine.resolve("realm/west@850"));
  assert.equal(version.commitId, "west-843");
  assert.equal(version.requestedYear, 850);
  assert.equal(version.recordedYear, 843);
  assert.equal(version.ref, "commit:west-843");
  assert.deepEqual(engine.resolve("realm/west@842").ok, false);
  assert.equal(engine.resolve("realm/west@871").ok, false);
  const bare = engine.resolve("realm/west");
  assert.equal(bare.ok, false);
  if (!bare.ok) assert.equal(bare.error.code, "DATE_REQUIRED");
  assert.equal(unwrap(engine.resolve("realm/west", { head: null, currentYear: 870 })).commitId, "west-870");
});

test("ambiguous event references expose explicit results and never choose a branch silently", () => {
  const result = engine.resolve("event:split");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "AMBIGUOUS_REF");
    assert.deepEqual(result.error.candidates, ["commit:west-843", "commit:east-843"]);
  }
});

test("same-year ambiguity never picks a version by ID ordering, and full branch log retains both", () => {
  const data = fixture();
  data.commits.push({ ...structuredClone(data.commits.find((commit) => commit.id === "west-870")!), id: "west-870-other", parents: ["west-843"] });
  data.branches.find((branch) => branch.id === "realm/west")!.commitIds.push("west-870-other");
  const engine = createHistoryEngine(data);
  const ambiguous = engine.resolve("realm/west@870");
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.deepEqual(ambiguous.error.candidates, ["commit:west-870", "commit:west-870-other"]);
  const log = unwrap(engine.log("realm/west"));
  assert.ok(log.commits.some((commit) => commit.id === "west-870"));
  assert.ok(log.commits.some((commit) => commit.id === "west-870-other"));
  const suggestions = completeCommand(engine, "git checkout realm/west@870", { head: null });
  assert.equal(suggestions.length, 2);
  for (const suggestion of suggestions) assert.equal(executeCommand(engine, suggestion.value, { head: null }).ok, true);
});

test("an unambiguous event alias preserves the requested reference", () => {
  const data = fixture();
  data.commits[0].eventId = "first";
  const version = unwrap(createHistoryEngine(data).resolve("event:first"));
  assert.equal(version.input, "event:first");
  assert.equal(version.commitId, "root-800");
});

test("two snapshots compare stable field values, retain common inheritance, and keep unknowns unknown", () => {
  const diff = unwrap(engine.diff("realm/west@843", "realm/east@843"));
  assert.equal(diff.rows.find((row) => row.fieldId === "ruler")!.kind, "changed");
  assert.equal(diff.rows.find((row) => row.fieldId === "institution")!.kind, "same");
  assert.equal(diff.rows.find((row) => row.fieldId === "capital")!.kind, "unknown");
  assert.deepEqual(diff.commonBaseIds, ["shared-814"]);
  assert.equal(unwrap(engine.diff("west-843", "west-870")).rows.find((row) => row.fieldId === "record")!.kind, "removed");
  assert.deepEqual(unwrap(engine.diff("west-843", "court-794")).commonBaseIds, []);
});

test("comparison equality uses stable values rather than translated prose", () => {
  const dataset = fixture();
  dataset.commits.find((commit) => commit.id === "east-843")!.changes.institution = { ...known("shared"), label: text("Different wording") };
  const diff = unwrap(createHistoryEngine(dataset).diff("west-843", "east-843"));
  assert.equal(diff.rows.find((row) => row.fieldId === "institution")!.kind, "same");
});

test("never-recorded fields remain unknown while explicit sourced absence has provenance", () => {
  const cross = unwrap(engine.diff("west-843", "court-794"));
  assert.equal(cross.rows.find((row) => row.fieldId === "ruler")!.kind, "unknown");
  assert.equal(unwrap(engine.diff("court-794", "west-843")).rows.find((row) => row.fieldId === "ruler")!.kind, "unknown");
  const removed = unwrap(engine.diff("west-843", "west-870")).rows.find((row) => row.fieldId === "record")!;
  assert.equal(removed.kind, "removed");
  assert.equal(removed.afterAbsence?.changedAt, "west-870");
  assert.deepEqual(removed.afterAbsence?.sourceIds, ["source"]);
  assert.equal(unwrap(engine.diff("west-870", "west-843")).rows.find((row) => row.fieldId === "record")!.kind, "added");
  assert.equal(unwrap(engine.diff("west-870", "court-794")).rows.find((row) => row.fieldId === "record")!.kind, "unknown");
  const dataset = fixture();
  dataset.commits.find((commit) => commit.id === "west-843")!.changes.record = null;
  delete dataset.commits.find((commit) => commit.id === "west-870")!.changes.record;
  const inherited = unwrap(createHistoryEngine(dataset).snapshot("west-870"));
  assert.equal(inherited.removedFields.record.inherited, true);
  assert.equal(inherited.removedFields.record.changedAt, "west-843");
  const absence = unwrap(engine.blame("west-870", "record"));
  assert.equal(absence.absent, true);
  assert.equal(absence.commit.id, "west-870");
  assert.deepEqual(absence.field.sourceIds, ["source"]);
  const neverRecorded = engine.blame("court-794", "record");
  assert.equal(neverRecorded.ok, false);
  if (!neverRecorded.ok) assert.equal(neverRecorded.error.code, "FIELD_UNRECORDED");
});

test("log follows parent relationships and blame locates the last recorded field change", () => {
  assert.deepEqual(unwrap(engine.log("realm/west")).commits.map((item) => item.id), ["west-870", "west-843", "shared-814", "root-800"]);
  const blame = unwrap(engine.blame("west-870", "institution"));
  assert.equal(blame.commit.id, "root-800");
  assert.equal(blame.field.inherited, true);
});

test("GUI intents and typed commands produce equal effects without altering context", () => {
  const context = { head: "west-843", comparison: ["west-843", "east-843"] as [string, string], scopeId: "east-asia", timeWindow: [710, 900] as [number, number] };
  const before = structuredClone(context);
  const gui = executeIntent(engine, { type: "checkout", ref: "court/main@794" }, context);
  const cli = executeCommand(engine, "git checkout court/main@794", context);
  assert.deepEqual(gui, cli);
  assert.equal(cli.effect.type, "checkout");
  assert.deepEqual(context, before);
  const comparison = executeCommand(engine, "git diff HEAD court/main@794", context);
  assert.equal(comparison.effect.type, "compare");
  assert.deepEqual(context, before);
  const show = executeCommand(engine, "git show court-710", context);
  assert.equal(show.effect.type, "preview");
  assert.equal(executeCommand(engine, "git status", context).effect.type, "none");
  assert.equal(executeCommand(engine, "git branch --all", context).effect.type, "none");
});

test("fixed comparison references remain unchanged after the browsing year changes", () => {
  const result = executeCommand(engine, "git diff realm/west@850 realm/east@850", { head: "court-794", currentYear: 850 });
  assert.equal(result.effect.type, "compare");
  if (result.effect.type !== "compare") return;
  const { a, b } = result.effect;
  const later = unwrap(engine.diff(a.ref, b.ref, { head: "court-794", currentYear: 870 }));
  assert.equal(later.a.commitId, "west-843");
  assert.equal(later.b.commitId, "east-843");
});

test("parser handles quoted search, optional git prefix, and two-dot endpoint syntax", () => {
  assert.deepEqual(unwrap(parseCommand('git search "Court moves"')), { type: "search", query: "Court moves" });
  assert.deepEqual(unwrap(parseCommand("diff west-843..east-843")), { type: "diff", a: "west-843", b: "east-843" });
  assert.deepEqual(unwrap(parseCommand("git blame --field capital")), { type: "blame", ref: "HEAD", fieldId: "capital" });
  assert.deepEqual(unwrap(parseCommand("git log --graph realm/west")), { type: "log", ref: "realm/west", graph: true });
});

test("invalid commands cannot mutate state or create unintended visual effects", () => {
  const context = { head: "west-843", comparison: ["west-843", "east-843"] as [string, string] };
  const before = structuredClone(context);
  for (const input of ["git checkout realm/west", "git checkout bogus", "git commit", "git help constructor", "git toString", "git log --bad", "git status extra", "git show root-800; git checkout west-843", "git show $(pwd)", 'git search "unclosed']) {
    const result = executeCommand(engine, input, context);
    assert.equal(result.ok, false, input);
    assert.equal(result.effect.type, "none", input);
    assert.deepEqual(context, before);
  }
  const noHead = executeCommand(engine, "git show HEAD", { head: null });
  if (!noHead.ok) assert.equal(noHead.error.code, "HEAD_UNSET");
  else assert.fail("HEAD must not be inferred");
});

test("completion enumerates executable references and field names from the dataset", () => {
  const suggestions = completeCommand(engine, "git checkout realm/west@", { head: null });
  assert.deepEqual(suggestions.map((item) => item.value), ["git checkout realm/west@843", "git checkout realm/west@870"]);
  for (const suggestion of suggestions) assert.equal(executeCommand(engine, suggestion.value, { head: null }).ok, true);
  assert.ok(completeCommand(engine, "git", { head: null }).length > 0);
  assert.equal(completeCommand(engine, "git blame HEAD --field cap", { head: "court-794" })[0].value, "git blame HEAD --field capital");
});

test("malformed parent graphs fail instead of fabricating a snapshot", () => {
  const cyclic = fixture();
  cyclic.commits[0].parents = ["shared-814"];
  assert.equal(createHistoryEngine(cyclic).snapshot("west-843").ok, false);
  const missing = fixture();
  missing.commits[0].changes.ruler!.sourceIds = ["missing"];
  assert.equal(createHistoryEngine(missing).resolve("west-843").ok, false);
});

test("multi-parent integration requires explicit choices for conflicting fields", () => {
  const dataset = fixture();
  dataset.commits.find((commit) => commit.id === "west-870")!.parents = ["west-843", "east-843"];
  dataset.commits.find((commit) => commit.id === "west-870")!.changes.capital = unknown;
  assert.equal(createHistoryEngine(dataset).snapshot("west-870").ok, true);
  delete dataset.commits.find((commit) => commit.id === "west-870")!.changes.ruler;
  const unresolved = createHistoryEngine(dataset).snapshot("west-870");
  assert.equal(unresolved.ok, false);
  if (!unresolved.ok) assert.equal(unresolved.error.code, "INVALID_DATASET");
});

test("multi-parent inheritance retains shared unknowns but requires a choice between distinct origins", () => {
  const data = fixture();
  const integration = data.commits.find((commit) => commit.id === "west-870")!;
  integration.parents = ["west-843", "east-843"];
  assert.equal(createHistoryEngine(data).snapshot("west-870").ok, true);
  data.commits.find((commit) => commit.id === "east-843")!.changes.institution = known("shared");
  const ambiguousOrigin = createHistoryEngine(data).snapshot("west-870");
  assert.equal(ambiguousOrigin.ok, false);
  integration.changes.institution = known("shared");
  assert.equal(createHistoryEngine(data).snapshot("west-870").ok, true);
});
