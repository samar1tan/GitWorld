import type { HistoryEngine } from "./history-engine.ts";
import type {
  CommandCompletion, CommandExecution, CommandIntent, HistoryContext, HistoryError,
  HistoryResult,
} from "./history-types.ts";
import { yearRef } from './dates.ts';

export const COMMAND_HELP: Record<string, string> = {
  help: "git help [command]",
  status: "git status",
  branch: "git branch [--all]",
  tag: "git tag",
  trace: "git trace <version>",
  search: "git search <text>",
  log: "git log <branch|version> [--graph]",
  show: "git show <version>",
  checkout: "git checkout <branch@year|commit:id>",
  diff: "git diff <version-A> <version-B>",
  blame: "git blame <version> --field <field>",
};
const fail = <T>(code: HistoryError["code"], subject?: string, candidates?: string[]): HistoryResult<T> => ({ ok: false, error: { code, ...(subject ? { subject } : {}), ...(candidates ? { candidates } : {}) } });
const ok = <T>(value: T): HistoryResult<T> => ({ ok: true, value });

function tokenize(input: string): HistoryResult<string[]> {
  if (/[;|&`\n\r<>]|\$\(/.test(input)) return fail("UNSUPPORTED_SYNTAX", input);
  const words: string[] = [];
  let word = "", quote: string | null = null, active = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && input[i + 1] === quote) word += input[++i];
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      active = true;
    } else if (/\s/.test(char)) {
      if (active) { words.push(word); word = ""; active = false; }
    } else { word += char; active = true; }
  }
  if (quote) return fail("INVALID_ARGUMENT", "unclosed quote");
  if (active) words.push(word);
  return ok(words);
}

export function parseCommand(input: string): HistoryResult<CommandIntent> {
  const parsed = tokenize(input.trim());
  if (!parsed.ok) return parsed;
  const words = parsed.value;
  if (words[0] === "git") words.shift();
  const name = words.shift() ?? "help";
  const invalid = () => fail<CommandIntent>("INVALID_ARGUMENT", name, [COMMAND_HELP[name]]);
  if (!Object.hasOwn(COMMAND_HELP, name)) return fail("UNKNOWN_COMMAND", name, Object.keys(COMMAND_HELP));
  switch (name) {
    case "help":
      if (words.length > 1) return invalid();
      if (words[0] && !Object.hasOwn(COMMAND_HELP, words[0])) return fail("UNKNOWN_COMMAND", words[0], Object.keys(COMMAND_HELP));
      return ok({ type: "help", ...(words[0] ? { topic: words[0] } : {}) });
    case "status": return words.length ? invalid() : ok({ type: "status" });
    case "tag": return words.length ? invalid() : ok({ type: "tag" });
    case "trace": return words.length === 1 && !words[0].startsWith('-') ? ok({ type: 'trace', ref: words[0] }) : invalid();
    case "branch": return words.length === 0 || (words.length === 1 && words[0] === "--all") ? ok({ type: "branch", all: words[0] === "--all" }) : invalid();
    case "search": return words.length && words.every((word) => !word.startsWith("--")) && words.join(" ").trim() ? ok({ type: "search", query: words.join(" ") }) : invalid();
    case "log": {
      const graph = words.includes("--graph");
      const refs = words.filter((word) => word !== "--graph");
      if (words.filter((word) => word === "--graph").length > 1 || refs.length > 1 || refs.some((word) => word.startsWith("-"))) return invalid();
      return ok({ type: "log", ref: refs[0] || "HEAD", graph });
    }
    case "show": return words.length <= 1 && !words[0]?.startsWith("-") ? ok({ type: "show", ref: words[0] || "HEAD" }) : invalid();
    case "checkout": return words.length === 1 && !words[0].startsWith("-") ? ok({ type: "checkout", ref: words[0] }) : invalid();
    case "diff": {
      if (words.length === 1 && words[0].includes('...')) {
        const endpoints = words[0].split('...');
        return endpoints.length === 2 && endpoints.every(word => word && !word.startsWith('-') && !word.includes('..')) ? ok({ type: 'diff', a: endpoints[0], b: endpoints[1], mode: 'merge-base' }) : invalid();
      }
      const endpoints = words.length === 1 ? words[0].split("..") : words;
      return endpoints.length === 2 && endpoints.every((word) => word && !word.startsWith("-")) ? ok({ type: "diff", a: endpoints[0], b: endpoints[1] }) : invalid();
    }
    case "blame": {
      const fieldIndex = words.indexOf("--field");
      if (fieldIndex < 0 || fieldIndex === words.length - 1 || words.length < 2 || words.length > 3) return invalid();
      const fieldId = words[fieldIndex + 1];
      const rest = words.filter((_, index) => index !== fieldIndex && index !== fieldIndex + 1);
      if (rest.length > 1 || rest.some((word) => word.startsWith("-")) || fieldId.startsWith("-")) return invalid();
      return ok({ type: "blame", ref: rest[0] || "HEAD", fieldId });
    }
    default: return invalid();
  }
}

export function commandForIntent(intent: CommandIntent): string {
  switch (intent.type) {
    case "help": return `git help${intent.topic ? ` ${intent.topic}` : ""}`;
    case "status": return "git status";
    case "tag": return "git tag";
    case "trace": return `git trace ${intent.ref}`;
    case "branch": return `git branch${intent.all ? " --all" : ""}`;
    case "search": return `git search ${JSON.stringify(intent.query)}`;
    case "log": return `git log ${intent.ref}${intent.graph ? " --graph" : ""}`;
    case "show": return `git show ${intent.ref}`;
    case "checkout": return `git checkout ${intent.ref}`;
    case "diff": return intent.mode === 'merge-base' ? `git diff ${intent.a}...${intent.b}` : `git diff ${intent.a} ${intent.b}`;
    case "blame": return `git blame ${intent.ref} --field ${intent.fieldId}`;
  }
}

export function executeIntent(engine: HistoryEngine, intent: CommandIntent, context: HistoryContext): CommandExecution {
  const command = commandForIntent(intent);
  const failure = (error: HistoryError): CommandExecution => ({ ok: false, command, error, effect: { type: "none" } });
  // Validate GUI intents through the same grammar as typed commands.
  const checked = parseCommand(command);
  if (!checked.ok) return failure(checked.error);
  switch (intent.type) {
    case "help": return { ok: true, command, intent, output: { kind: "help", topic: intent.topic ?? null, commands: intent.topic ? [COMMAND_HELP[intent.topic]] : Object.values(COMMAND_HELP) }, effect: { type: "none" } };
    case "status": return { ok: true, command, intent, output: { kind: "status", datasetVersion: engine.dataset.id, context: structuredClone(context) }, effect: { type: "none" } };
    case "branch": return { ok: true, command, intent, output: { kind: "branches", branches: engine.dataset.branches.filter((branch) => intent.all || !context.scopeId || branch.scopeId === context.scopeId) }, effect: { type: "none" } };
    case 'tag': return { ok: true, command, intent, output: { kind: 'tags', tags: structuredClone(engine.dataset.tags ?? []) }, effect: { type: 'none' } };
    case 'trace': {
      const version = engine.resolve(intent.ref, context);
      if (!version.ok) return failure(version.error);
      const relationships = (engine.dataset.relationships ?? []).filter(link => link.fromCommitId === version.value.commitId || link.toCommitId === version.value.commitId);
      return { ok: true, command, intent, output: { kind: 'trace', version: version.value, relationships: structuredClone(relationships) }, effect: { type: 'preview', version: version.value } };
    }
    case "search": return { ok: true, command, intent, output: { kind: "search", query: intent.query, hits: engine.search(intent.query) }, effect: { type: "none" } };
    case "log": {
      const result = engine.log(intent.ref, context);
      if (!result.ok) return failure(result.error);
      return { ok: true, command, intent, output: { kind: "log", ref: intent.ref, ...result.value }, effect: { type: "history", branchId: result.value.branchId, commitIds: result.value.commits.map((commit) => commit.id) } };
    }
    case "show":
    case "checkout": {
      const version = engine.resolve(intent.ref, context);
      if (!version.ok) return failure(version.error);
      const snapshot = engine.snapshot(version.value.commitId);
      if (!snapshot.ok) return failure(snapshot.error);
      return { ok: true, command, intent, output: { kind: "snapshot", version: version.value, snapshot: snapshot.value }, effect: { type: intent.type === "checkout" ? "checkout" : "preview", version: version.value } };
    }
    case "diff": {
      let a = intent.a;
      if (intent.mode === 'merge-base') {
        const av = engine.resolve(intent.a, context), bv = engine.resolve(intent.b, context);
        if (!av.ok) return failure(av.error);
        if (!bv.ok) return failure(bv.error);
        const bases = engine.commonBases(av.value.commitId, bv.value.commitId);
        if (!bases.length) return failure({ code: 'NO_COMMON_BASE' });
        if (bases.length > 1) return failure({ code: 'MULTIPLE_COMMON_BASES', candidates: bases.map(id => `commit:${id}`) });
        a = `commit:${bases[0]}`;
      }
      const result = engine.diff(a, intent.b, context);
      if (!result.ok) return failure(result.error);
      const requestedA = engine.resolve(intent.a, context), requestedB = engine.resolve(intent.b, context);
      if (requestedA.ok && requestedB.ok) result.value.query = { a: requestedA.value, b: requestedB.value, mode: intent.mode ?? 'endpoints' };
      return { ok: true, command, intent, output: { kind: "diff", diff: result.value }, effect: { type: "compare", a: result.value.a, b: result.value.b } };
    }
    case "blame": {
      const result = engine.blame(intent.ref, intent.fieldId, context);
      if (!result.ok) return failure(result.error);
      return { ok: true, command, intent, output: { kind: "blame", ...result.value }, effect: { type: "blame", version: result.value.version, fieldId: intent.fieldId, changedAt: result.value.field.changedAt } };
    }
  }
}

export function executeCommand(engine: HistoryEngine, input: string, context: HistoryContext): CommandExecution {
  const parsed = parseCommand(input);
  if (!parsed.ok) return { ok: false, command: input, error: parsed.error, effect: { type: "none" } };
  return executeIntent(engine, parsed.value, context);
}

export function completeCommand(engine: HistoryEngine, input: string, context: HistoryContext): CommandCompletion[] {
  const prefix = input.trimStart();
  const commandPrefix = prefix === "git" ? "git " : prefix.startsWith("git ") ? prefix : `git ${prefix}`;
  const words = commandPrefix.split(/\s+/);
  if (words.length < 3) {
    const fragment = words[1] ?? "";
    return Object.keys(COMMAND_HELP).filter((name) => name.startsWith(fragment)).map((name) => ({ value: `git ${name} `, label: { en: COMMAND_HELP[name], "zh-CN": COMMAND_HELP[name] }, kind: "command" }));
  }
  const command = words[1];
  const fragment = words.at(-1) ?? "";
  const base = commandPrefix.slice(0, commandPrefix.length - fragment.length);
  if (command === "help") return Object.keys(COMMAND_HELP).filter((name) => name.startsWith(fragment)).map((name) => ({ value: `${base}${name}`, label: { en: COMMAND_HELP[name], "zh-CN": COMMAND_HELP[name] }, kind: "command" }));
  if (command === "blame" && words.at(-2) === "--field") return engine.dataset.fields.filter((field) => field.id.startsWith(fragment)).map((field) => ({ value: `${base}${field.id}`, label: field.name, kind: "field" }));
  if (!["show", "checkout", "diff", "log", "blame", "trace"].includes(command)) return [];
  const refs: CommandCompletion[] = [];
  if (context.head && "HEAD".startsWith(fragment)) refs.push({ value: `${base}HEAD`, label: { en: "HEAD", "zh-CN": "HEAD" }, kind: "ref" });
  for (const branch of engine.dataset.branches) {
    if (command === "log" && branch.id.startsWith(fragment)) refs.push({ value: `${base}${branch.id}`, label: branch.name, kind: "ref" });
    for (const id of branch.commitIds) {
      const commit = engine.commits.get(id);
      if (!commit) continue;
      const datedRef = `${branch.id}@${yearRef(commit.year)}`;
      const ambiguousDate = branch.commitIds.filter((candidate) => engine.commits.get(candidate)?.year === commit.year).length > 1;
      const ref = fragment.startsWith("commit:") || ambiguousDate ? `commit:${id}` : datedRef;
      if (ref.startsWith(fragment) || (ambiguousDate && datedRef.startsWith(fragment))) refs.push({ value: `${base}${ref}`, label: branch.name, kind: "ref", year: commit.year });
    }
  }
  for (const tag of engine.dataset.tags ?? []) if (`tag:${tag.id}`.startsWith(fragment)) refs.push({ value: `${base}tag:${tag.id}`, label: tag.name, kind: 'ref' });
  return refs.slice(0, 40);
}
