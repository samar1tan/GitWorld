import { compareHistorySnapshots, completeCommand, createHistoryEngine, executeIntent, parseCommand, parseYear, yearRef } from '../../domain/src/index.ts';
import type { CommandIntent, HistoryContext, HistoryDiff, HistoryEngine } from '../../domain/src/index.ts';
import { validateServiceRequest } from '../../contracts/src/index.ts';
import type { HistoricalCommandTarget, ModelCommandTarget, ModelComparisonIntent, ModelHistoricalReference, ObjectCommandTarget, ObjectHistoryIntent, ObjectStateReference, RepositoryCommandIntent, ServiceMethod, ServiceMethods, WorkbenchCommandError, WorkbenchCommandExecution, WorkbenchCommandIntent, WorkbenchCommandOutput, WorkbenchCommandRequest, WorkbenchCompletion } from '../../contracts/src/index.ts';
import { executeScopeCommand, parseScopeCommand, scopeCommandText, SCOPE_HELP } from './scope-commands.ts';

type Invoke = <M extends ServiceMethod>(method: M, params: ServiceMethods[M]['params']) => Promise<ServiceMethods[M]['result']>;
type Parsed = { intent: WorkbenchCommandIntent } | { help: true } | { error: WorkbenchCommandError };
const oid = /^[a-f0-9]{40}$/;
const quote = (value: string) => JSON.stringify(value);
const HELP = [
  ...SCOPE_HELP,
  'git status', 'git diff [--staged] [--offset <n>] [--limit 1..100] [-- <paths>]', 'git add [--] <paths>', 'git restore --staged [--] <paths>',
  'git commit -m "reason"', 'git log [--limit 1..100]', 'git branch [name]', 'git switch <name>', 'git checkout --detach <commit-oid>', 'git revert <commit-oid>|--abort',
  'history --model <model-id> --revision <commit-oid|working> show|checkout|log|diff|blame|trace|search|branch|tag|status|help ...',
  'history --model <model-id> --revision <commit-oid-A> diff <ref-A> <ref-B> --against-revision <commit-oid-B>',
  'history --object <object-id> --revision <commit-oid|working> show|checkout <year> [--field <id>] [--include-unreviewed]',
  'history --object <object-id> --revision <commit-oid|working> log [--field <id>] [--include-unreviewed]',
  'history --object <object-id> --revision <commit-oid> diff <year-A> <year-B> [--against-object <id>] [--against-revision <oid>] [--include-unreviewed] [--against-reviewed-only|--against-include-unreviewed]',
];
const invalid = (subject?: string): Parsed => ({ error: { code: 'INVALID_ARGUMENT', ...(subject ? { subject } : {}) } });
const migrated = (subject: string, replacement: string): Parsed => ({ error: { code: 'COMMAND_MIGRATED', subject, replacement } });

/** Tokenization only. Tokens are never passed to a shell or to arbitrary Git arguments. */
function tokenize(input: string): { words: string[]; quoted: boolean[] } | { error: WorkbenchCommandError } {
  const words: string[] = [], quoted: boolean[] = []; let word = '', active = false, literal = false;
  const push = () => { if (active) { words.push(word); quoted.push(literal); word = ''; active = false; literal = false; } };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      let end = index + 1;
      while (end < input.length && input[end] !== '"') { if (input[end] === '\\') end++; end++; }
      if (end >= input.length) return { error: { code: 'INVALID_ARGUMENT', subject: 'unclosed-quote' } };
      try { word += JSON.parse(input.slice(index, end + 1)) as string; }
      catch { return { error: { code: 'INVALID_ARGUMENT', subject: 'invalid-quoted-string' } }; }
      index = end; active = true; literal = true;
    } else if (char === "'") {
      let end = index + 1;
      for (; end < input.length && input[end] !== "'"; end++) {
        if (input[end] === '\\' && ["'", '\\'].includes(input[end + 1])) word += input[++end];
        else word += input[end];
      }
      if (end >= input.length) return { error: { code: 'INVALID_ARGUMENT', subject: 'unclosed-quote' } };
      index = end; active = true; literal = true;
    } else if (/[;|&`<>\x00-\x1f\x7f]/.test(char) || char === '$' && input[index + 1] === '(') return { error: { code: 'UNSUPPORTED_SYNTAX' } };
    else if (/\s/.test(char)) push();
    else { word += char; active = true; }
  }
  push(); return { words, quoted };
}
const publicModelRef = (ref: string) => ref === 'HEAD' ? 'CHECKED' : ref.replace(/^commit:/, 'state:');
const engineModelRef = (ref: string) => ref === 'CHECKED' ? 'HEAD' : ref.replace(/^state:/, 'commit:');
const boundContext = (target: ModelCommandTarget, context: HistoryContext | undefined, owner: ModelCommandTarget | undefined): HistoryContext => owner?.modelId === target.modelId && owner.revision === target.revision ? context ?? { head: null } : { head: null };
const aliasRef = (ref: string, context: HistoryContext) => ref === 'A' ? context.comparison?.[0] ?? 'A' : ref === 'B' ? context.comparison?.[1] ?? 'B' : engineModelRef(ref);
function mapRefs(intent: CommandIntent, map: (value: string) => string): CommandIntent {
  if (intent.type === 'diff') return { ...intent, a: map(intent.a), b: map(intent.b) };
  if ('ref' in intent) return { ...intent, ref: map(intent.ref) };
  return intent;
}
function checked(parsed: Parsed): Parsed {
  if (!('intent' in parsed)) return parsed;
  const result = validateServiceRequest({ protocolVersion: 1, requestId: 'command-grammar', method: 'command.execute', params: { input: { intent: parsed.intent } } });
  return result.ok ? parsed : invalid();
}

function parseGit(words: string[]): Parsed {
  const [name, ...args] = words;
  const repository = (intent: RepositoryCommandIntent): Parsed => checked({ intent: { family: 'git', intent } });
  const paths = (values: string[]) => values[0] === '--' ? values.slice(1) : values;
  switch (name) {
    case undefined: case 'help': return args.length ? invalid(name) : { help: true };
    case 'status': return args.length ? invalid(name) : repository({ type: 'status' });
    case 'diff': {
      let mode: 'staged' | 'working' = 'working', offset: number | undefined, limit: number | undefined, index = 0;
      const flags = new Set<string>();
      while (args[index]?.startsWith('--') && args[index] !== '--') {
        const flag = args[index++]; if (flags.has(flag)) return invalid(flag); flags.add(flag);
        if (flag === '--staged') mode = 'staged';
        else if (['--offset','--limit'].includes(flag) && /^\d+$/.test(args[index] ?? '')) { const value = Number(args[index++]); if (flag === '--offset') offset = value; else limit = value; }
        else return invalid(flag);
      }
      const values = args.slice(index);
      if (values.length && values[0] !== '--') return migrated('git diff <historical refs>', 'history --model <model-id> --revision <commit-oid> diff <A> <B>');
      return repository({ type: 'diff', mode, ...(values.length ? { paths: paths(values) } : {}), ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) });
    }
    case 'add': return repository({ type: 'add', paths: paths(args) });
    case 'restore': return args[0] === '--staged' ? repository({ type: 'unstage', paths: paths(args.slice(1)) }) : invalid(name);
    case 'commit': return args.length === 2 && args[0] === '-m' ? repository({ type: 'commit', message: args[1] }) : invalid(name);
    case 'log': return !args.length ? repository({ type: 'log' }) : args.length === 2 && args[0] === '--limit' && /^[1-9]\d*$/.test(args[1]) ? repository({ type: 'log', limit: Number(args[1]) }) : migrated('git log <historical ref>', 'history --model <model-id> --revision <commit-oid> log <historical-ref>');
    case 'branch': return !args.length || args.length === 1 && args[0] === '--all' ? repository({ type: 'branch' }) : args.length === 1 ? repository({ type: 'branch', name: args[0] }) : invalid(name);
    case 'switch': return args.length === 1 ? repository({ type: 'switch', name: args[0] }) : invalid(name);
    case 'checkout': return args.length === 2 && args[0] === '--detach' ? repository({ type: 'checkout', oid: args[1] }) : migrated('git checkout <historical ref>', 'history --model <model-id> --revision <commit-oid> checkout <historical-ref>');
    case 'revert': return args.length === 1 ? repository(args[0] === '--abort' ? { type: 'abort-revert' } : { type: 'revert', commitOid: args[0] }) : invalid(name);
    case 'show': case 'blame': case 'trace': case 'search': case 'tag': return migrated(`git ${name}`, `history --model <model-id> --revision <commit-oid> ${name}${args.length ? ' ' + args.map(quote).join(' ') : ''}`);
    default: return { error: { code: 'UNKNOWN_COMMAND', subject: name } };
  }
}
function parseObject(target: ObjectCommandTarget, words: string[]): Parsed {
  const [name, ...args] = words, values: string[] = [], fields: string[] = [];
  let includeUnreviewed = false, againstReview: boolean | undefined, againstObject = target.objectId, againstRevision = target.revision;
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const word = args[index];
    if (!word.startsWith('--')) { values.push(word); continue; }
    if (word !== '--field' && flags.has(word)) return invalid(name);
    flags.add(word);
    if (word === '--include-unreviewed') includeUnreviewed = true;
    else if (word === '--against-reviewed-only' || word === '--against-include-unreviewed') { if (againstReview !== undefined) return invalid(word); againstReview = word === '--against-include-unreviewed'; }
    else if (['--field','--against-object','--against-revision'].includes(word) && args[index + 1] && !args[index + 1].startsWith('--')) {
      const next = args[++index];
      if (word === '--field') fields.push(next);
      else if (word === '--against-object') againstObject = next;
      else againstRevision = next;
    } else return invalid(name);
  }
  const options = { ...(fields.length ? { propertyIds: fields } : {}), includeUnreviewed };
  let intent: ObjectHistoryIntent;
  if (name === 'log' && !values.length && !flags.has('--against-object') && !flags.has('--against-revision') && againstReview === undefined) intent = { type: 'log', ...options };
  else if ((name === 'show' || name === 'checkout') && values.length === 1 && !flags.has('--against-object') && !flags.has('--against-revision') && againstReview === undefined) {
    const year = parseYear(values[0]); if (year === null) return invalid('year'); intent = { type: name, state: { year, ...options } };
  } else if (name === 'diff' && values.length === 2) {
    const a = parseYear(values[0]), b = parseYear(values[1]); if (a === null || b === null) return invalid('year');
    intent = { type: 'diff', a: { year: a, ...options }, b: { kind: 'object', objectId: againstObject, revision: againstRevision, year: b, ...options, includeUnreviewed: againstReview ?? includeUnreviewed } };
  } else return invalid(name);
  return checked({ intent: { family: 'history', target, intent } });
}
export function parseWorkbenchCommand(input: string, context: HistoryContext = { head: null }, contextTarget?: ModelCommandTarget): Parsed {
  const parsed = tokenize(input.trim()); if ('error' in parsed) return parsed;
  const words = parsed.words, family = words.shift();
  if (!family || family === 'help' && !words.length) return { help: true };
  if (family === 'git') return parseGit(words);
  if (family === 'scope') { const scope=parseScopeCommand(words,parsed.quoted.slice(1));return 'error'in scope?scope:checked({intent:{family:'scope',intent:scope.intent}}); }
  if (family !== 'history') return migrated(family, 'git help');
  if (words.length === 1 && words[0] === 'help') return { help: true };
  let target: HistoricalCommandTarget | null = null, revision: string | null = null;
  while (words[0]?.startsWith('--')) {
    const flag = words.shift(), value = words.shift(); if (!value) return invalid(flag);
    if (flag === '--revision' && revision === null) revision = value;
    else if ((flag === '--model' || flag === '--object') && target === null) target = flag === '--model' ? { kind: 'model', modelId: value, revision: '' } : { kind: 'object', objectId: value, revision: '' };
    else return invalid(flag);
  }
  if (!target || revision === null) return { error: { code: 'TARGET_REQUIRED', candidates: ['--model <model-id> --revision <commit-oid|working>', '--object <object-id> --revision <commit-oid|working>'] } };
  target.revision = revision;
  if (target.kind === 'object') return parseObject(target, words);
  if (words.some(word => word === 'HEAD' || word.split(/\.{2,3}/).includes('HEAD'))) return migrated('historical HEAD', 'CHECKED');
  let againstRevision: string | undefined;
  const against = words.indexOf('--against-revision');
  if (against >= 0) {
    if (against !== words.length - 2) return invalid('--against-revision');
    againstRevision = words[against + 1]; words.splice(against, 2);
  }
  const model = parseCommand(words.map(quote).join(' '));
  if (!model.ok) return { error: model.error };
  const owned = boundContext(target, context, contextTarget);
  if (againstRevision !== undefined) {
    if (model.value.type !== 'diff') return invalid('--against-revision');
    return checked({ intent: { family: 'history', target, intent: { type: 'compare', a: { ...target, ref: publicModelRef(model.value.a) }, b: { ...target, revision: againstRevision, ref: publicModelRef(model.value.b) }, ...(model.value.mode ? { mode: model.value.mode } : {}) }, context: owned } });
  }
  return checked({ intent: { family: 'history', target, intent: mapRefs(model.value, publicModelRef), context: owned } });
}

function modelCommand(intent: CommandIntent): string {
  switch (intent.type) {
    case 'status': case 'tag': return intent.type;
    case 'help': return `help${intent.topic ? ' ' + quote(intent.topic) : ''}`;
    case 'branch': return `branch${intent.all ? ' --all' : ''}`;
    case 'search': return `search ${quote(intent.query)}`;
    case 'diff': return intent.mode === 'merge-base' ? `diff ${quote(`${intent.a}...${intent.b}`)}` : `diff ${quote(intent.a)} ${quote(intent.b)}`;
    case 'blame': return `blame ${quote(intent.ref)} --field ${quote(intent.fieldId)}`;
    case 'log': return `log ${quote(intent.ref)}${intent.graph ? ' --graph' : ''}`;
    default: return `${intent.type} ${quote(intent.ref)}`;
  }
}
function commandFor(intent: WorkbenchCommandIntent): string {
  if(intent.family==='scope')return scopeCommandText(intent.intent);
  if (intent.family === 'git') {
    const i = intent.intent;
    switch (i.type) {
      case 'status': return 'git status';
      case 'diff': return `git diff${i.mode === 'staged' ? ' --staged' : ''}${i.offset === undefined ? '' : ' --offset ' + i.offset}${i.limit === undefined ? '' : ' --limit ' + i.limit}${i.paths ? ' -- ' + i.paths.map(quote).join(' ') : ''}`;
      case 'add': case 'unstage': return `git ${i.type === 'add' ? 'add' : 'restore --staged'} -- ${i.paths.map(quote).join(' ')}`;
      case 'commit': return `git commit -m ${quote(i.message)}`;
      case 'log': return `git log${i.limit ? ' --limit ' + i.limit : ''}`;
      case 'branch': return `git branch${i.name ? ' ' + quote(i.name) : ''}`;
      case 'switch': return `git switch ${quote(i.name)}`;
      case 'checkout': return `git checkout --detach ${i.oid}`;
      case 'revert': return `git revert ${i.commitOid}`;
      case 'abort-revert': return 'git revert --abort';
    }
  }
  const t = intent.target, prefix = `history --${t.kind} ${quote(t.kind === 'model' ? t.modelId : t.objectId)} --revision ${t.revision}`;
  if (t.kind === 'model') {
    const i = intent.intent as CommandIntent | ModelComparisonIntent;
    return i.type === 'compare' ? `${prefix} diff ${quote(i.mode === 'merge-base' ? `${i.a.ref}...${i.b.ref}` : i.a.ref)}${i.mode === 'merge-base' ? '' : ' ' + quote(i.b.ref)} --against-revision ${i.b.revision}` : `${prefix} ${modelCommand(i)}`;
  }
  const i = intent.intent as ObjectHistoryIntent;
  const fields = (ids?: string[], unreviewed?: boolean) => `${ids?.map(id => ' --field ' + quote(id)).join('') ?? ''}${unreviewed ? ' --include-unreviewed' : ''}`;
  if (i.type === 'log') return `${prefix} log${fields(i.propertyIds, i.includeUnreviewed)}`;
  if (i.type === 'diff') {
    const propertyIds = i.a.propertyIds && i.b.propertyIds ? [...new Set([...i.a.propertyIds,...i.b.propertyIds])] : undefined;
    const against = Boolean(i.a.includeUnreviewed) === Boolean(i.b.includeUnreviewed) ? '' : i.b.includeUnreviewed ? ' --against-include-unreviewed' : ' --against-reviewed-only';
    return `${prefix} diff ${yearRef(i.a.year)} ${yearRef(i.b.year)} --against-object ${quote(i.b.objectId)} --against-revision ${i.b.revision}${fields(propertyIds, i.a.includeUnreviewed)}${against}`;
  }
  return `${prefix} ${i.type} ${yearRef(i.state.year)}${fields(i.state.propertyIds, i.state.includeUnreviewed)}`;
}
export function readOnlyWorkbenchCommand(request: WorkbenchCommandRequest): boolean {
  const parsed: Parsed = 'intent' in request.input ? { intent: request.input.intent } : parseWorkbenchCommand(request.input.command, request.context, request.contextTarget);
  if('intent'in parsed&&parsed.intent.family==='scope')return !['create','assign','apply'].includes(parsed.intent.intent.type);
  return !('intent' in parsed) || parsed.intent.family === 'history' || ['status','diff','log'].includes(parsed.intent.intent.type) || parsed.intent.intent.type === 'branch' && !parsed.intent.intent.name;
}

/** GUI intents and terminal input converge before any domain/repository operation. */
export function createWorkbenchCommands(invoke: Invoke) {
  async function execute(request: WorkbenchCommandRequest): Promise<WorkbenchCommandExecution> {
    const parsed: Parsed = 'intent' in request.input ? checked({ intent: request.input.intent }) : parseWorkbenchCommand(request.input.command, request.context, request.contextTarget);
    const command = 'command' in request.input ? request.input.command : commandFor(request.input.intent);
    const failure = (error: WorkbenchCommandError): WorkbenchCommandExecution => ({ ok: false, command, error, effect: { type: 'none' } });
    const success = (output: WorkbenchCommandOutput, effect: Extract<WorkbenchCommandExecution, { ok: true }>['effect'] = { type: 'none' }): WorkbenchCommandExecution => ({ ok: true, command, output, effect });
    if ('error' in parsed) return failure(parsed.error);
    if ('help' in parsed) return success({ kind: 'help', commands: HELP });
    const action = parsed.intent;
    if(action.family==='scope'){
      const value=await executeScopeCommand(action.intent,request,invoke);
      return 'error'in value?failure(value.error):success(value.output,value.patch?{type:'scope',patch:value.patch}:{type:'none'});
    }
    if (action.family === 'git') {
      const i = action.intent, effect = { type: 'repository' as const, operation: i.type };
      switch (i.type) {
        case 'status': return success({ kind: 'repository-status', status: await invoke('repository.status', {}) }, effect);
        case 'diff': return success({ kind: 'repository-diff', diff: await invoke('repository.diff', { mode: i.mode, ...(i.paths ? { paths: i.paths } : {}), ...(i.offset === undefined ? {} : { offset: i.offset }), ...(i.limit === undefined ? {} : { limit: i.limit }) }) }, effect);
        case 'add': case 'unstage': return success({ kind: 'repository-status', status: await invoke(i.type === 'add' ? 'repository.stage' : 'repository.unstage', { paths: i.paths }) }, effect);
        case 'log': return success({ kind: 'repository-log', commits: await invoke('repository.log', { ...(i.limit ? { limit: i.limit } : {}) }) }, effect);
        case 'branch': return i.name ? success({ kind: 'repository-status', status: await invoke('repository.branch', { name: i.name }) }, effect) : success({ kind: 'repository-branches', branches: await invoke('repository.branches', {}) });
        case 'switch': return success({ kind: 'repository-status', status: await invoke('repository.switch', { name: i.name }) }, effect);
        case 'checkout': return success({ kind: 'repository-status', status: await invoke('repository.checkout', { oid: i.oid }) }, effect);
        case 'abort-revert': return success({ kind: 'repository-status', status: await invoke('repository.abortRevert', {}) }, effect);
        case 'commit': case 'revert': {
          if (!request.operationId || !request.expectedHead || i.type === 'commit' && !request.expectedTree) return failure({ code: 'INVALID_ARGUMENT', subject: 'reviewed-repository-state' });
          if (i.type === 'commit') return success({ kind: 'repository-commit', commit: await invoke('repository.commit', { operationId: request.operationId, expectedHead: request.expectedHead, expectedTree: request.expectedTree, message: i.message }) }, effect);
          return success({ kind: 'repository-status', status: await invoke('repository.revert', { operationId: request.operationId, expectedHead: request.expectedHead, commitOid: i.commitOid }) }, effect);
        }
      }
    }
    if (action.target.kind === 'model') {
      const target = action.target, intent = action.intent as CommandIntent | ModelComparisonIntent, context = 'context' in action ? action.context : { head: null };
      if (intent.type === 'compare') {
        if (intent.a.modelId !== intent.b.modelId || target.modelId !== intent.a.modelId || target.revision !== intent.a.revision) return failure({ code: 'INVALID_ARGUMENT', subject: 'model-comparison-target' });
        if (intent.a.revision === 'working' || intent.b.revision === 'working') return failure({ code: 'COMMITTED_REVISION_REQUIRED' });
        const sameRevision = intent.a.revision === intent.b.revision;
        if (!sameRevision && intent.mode === 'merge-base') return failure({ code: 'INVALID_ARGUMENT', subject: 'cross-revision-merge-base' });
        if ([intent.a.ref,intent.b.ref].includes('HEAD')) return failure({ code: 'COMMAND_MIGRATED', subject: 'historical HEAD', replacement: 'CHECKED' });
        if (!sameRevision && [intent.a.ref,intent.b.ref].some(ref => ['CHECKED','A','B'].includes(ref))) return failure({ code: 'INVALID_ARGUMENT', subject: 'explicit-endpoint-ref' });
        const [left, right] = await Promise.all([invoke('model.read', { datasetId: intent.a.modelId, revision: intent.a.revision }), invoke('model.read', { datasetId: intent.b.modelId, revision: intent.b.revision })]);
        const engines: HistoryEngine[] = [left,right].map(model => { const history = structuredClone(model.package.history); history.id = model.revision; return createHistoryEngine(history); });
        const a = engines[0].resolve(aliasRef(intent.a.ref, context), context), b = engines[1].resolve(aliasRef(intent.b.ref, context), context);
        if (!a.ok) return failure(a.error); if (!b.ok) return failure(b.error);
        let diff: HistoryDiff;
        if (sameRevision) {
          const executed = executeIntent(engines[0], { type: 'diff', a: aliasRef(intent.a.ref, context), b: aliasRef(intent.b.ref, context), ...(intent.mode ? { mode: intent.mode } : {}) }, context);
          if (!executed.ok) return failure(executed.error);
          if (executed.output.kind !== 'diff') return failure({ code: 'INVALID_ARGUMENT' }); diff = executed.output.diff;
        } else {
          const before = engines[0].snapshot(a.value.commitId), after = engines[1].snapshot(b.value.commitId);
          if (!before.ok) return failure(before.error); if (!after.ok) return failure(after.error);
          const fields = [...new Set([...left.package.history.fields,...right.package.history.fields].map(field => field.id))];
          diff = { a: a.value, b: b.value, rows: compareHistorySnapshots(before.value, after.value, fields), commonBaseIds: [], query: { a: a.value, b: b.value, mode: 'endpoints' } };
        }
        const pinnedA: ModelHistoricalReference = { ...intent.a, ref: ['CHECKED','A','B'].includes(intent.a.ref) ? `state:${a.value.commitId}` : intent.a.ref }, pinnedB: ModelHistoricalReference = { ...intent.b, ref: ['CHECKED','A','B'].includes(intent.b.ref) ? `state:${b.value.commitId}` : intent.b.ref };
        const effect = { type: 'compare' as const, a: diff.a, b: diff.b };
        const execution = { ok: true as const, command, intent: { type: 'diff' as const, a: intent.a.ref, b: intent.b.ref, ...(intent.mode ? { mode: intent.mode } : {}) }, output: { kind: 'diff' as const, diff }, effect };
        return success({ kind: 'model', target, execution, comparison: { a: pinnedA, b: pinnedB, commonBaseStatus: sameRevision ? 'computed' : 'different-revisions' } }, { type: 'model-compare', a: pinnedA, b: pinnedB, effect });
      }
      if (('ref' in intent && intent.ref === 'HEAD') || intent.type === 'diff' && (intent.a === 'HEAD' || intent.b === 'HEAD')) return failure({ code: 'COMMAND_MIGRATED', subject: 'historical HEAD', replacement: 'CHECKED' });
      if (target.revision === 'working' && ['checkout','diff'].includes(intent.type)) return failure({ code: 'COMMITTED_REVISION_REQUIRED' });
      const model = await invoke('model.read', { datasetId: target.modelId, revision: target.revision });
      const data = structuredClone(model.package.history); data.id = target.revision; data.datasetId = target.modelId;
      const engine = createHistoryEngine(data);
      if (context.head && !engine.commits.has(context.head) || context.comparison?.some(id => !engine.commits.has(id))) return failure({ code: 'UNKNOWN_REF' });
      const refs = intent.type === 'diff' ? [intent.a,intent.b] : 'ref' in intent ? [intent.ref] : [];
      const unset = refs.find(ref => (ref === 'A' || ref === 'B') && !context.comparison?.[ref === 'A' ? 0 : 1]);
      if (unset) return failure({ code: 'UNKNOWN_REF', subject: unset });
      const result = executeIntent(engine, mapRefs(intent, ref => aliasRef(ref, context)), context);
      if (!result.ok) return failure(result.error);
      result.command = command;
      if (result.output.kind === 'help') result.output.commands = result.output.commands.map(value => value.replace(/^git /, `history --model ${quote(target.modelId)} --revision ${target.revision} `).replace(/\bHEAD\b/g, 'CHECKED'));
      return success({ kind: 'model', target, execution: result }, { type: 'model', target, effect: result.effect });
    }
    const target = action.target, intent = action.intent as ObjectHistoryIntent;
    await invoke('knowledge.object', { objectId: target.objectId, revision: target.revision });
    if (intent.type === 'log') return success({ kind: 'object-history', target, history: await invoke('knowledge.history', { objectId: target.objectId, revision: target.revision, ...(intent.propertyIds ? { propertyIds: intent.propertyIds } : {}), includeUnreviewed: intent.includeUnreviewed ?? false }) }, { type: 'object-history', target,includeUnreviewed:intent.includeUnreviewed??false });
    if (target.revision === 'working' && (intent.type === 'checkout' || intent.type === 'diff') || intent.type === 'diff' && intent.b.revision === 'working') return failure({ code: 'COMMITTED_REVISION_REQUIRED' });
    if (intent.type === 'diff') {
      await invoke('knowledge.object', { objectId: intent.b.objectId, revision: intent.b.revision });
      const a: ObjectStateReference = { ...target, year: intent.a.year, includeUnreviewed: intent.a.includeUnreviewed ?? false }, b: ObjectStateReference = { kind: 'object', objectId: intent.b.objectId, revision: intent.b.revision, year: intent.b.year, includeUnreviewed: intent.b.includeUnreviewed ?? false };
      const diff = await invoke('knowledge.diff', { a: { revision: a.revision, state: { objectId: a.objectId, ...intent.a } }, b: { revision: b.revision, state: { objectId: b.objectId, year: b.year, ...(intent.b.propertyIds ? { propertyIds: intent.b.propertyIds } : {}), includeUnreviewed: b.includeUnreviewed } } });
      return success({ kind: 'object-diff', a, b, diff }, { type: 'object-compare', a, b });
    }
    const state = await invoke('knowledge.state', { state: { objectId: target.objectId, ...intent.state }, revision: target.revision });
    return success({ kind: 'object-state', target, state }, { type: intent.type === 'checkout' ? 'object-checkout' : 'object-preview', reference: { ...target, year: intent.state.year, includeUnreviewed: intent.state.includeUnreviewed ?? false } });
  }
  async function complete(input: string, context: HistoryContext = { head: null }, contextTarget?: ModelCommandTarget,scopeRevision='working'): Promise<WorkbenchCompletion[]> {
    if (/[;|&`<>\x00-\x1f\x7f]|\$\(/.test(input)) return [];
    const label = (value: string) => ({ en: value, 'zh-CN': value });
    if(input.startsWith('scope ')){
      const reviewArg=input.match(/^(scope filter(?:\s+.*)?\s+--review\s+)([^\s]*)$/);
      if(reviewArg)return['unreviewed','adopted','rejected','none'].filter(value=>value.startsWith(reviewArg[2])).map(value=>({value:reviewArg[1]+value+' ',label:label(value),kind:'ref'}));
      const filterFlag=input.match(/^(scope filter(?:\s+.*)?\s+)(--[^\s]*)$/);
      if(filterFlag)return['--from ','--to ','--type ','--all-types ','--text ','--review ','--include-undated ','--exclude-undated ','--include-unlocated ','--exclude-unlocated '].filter(value=>value.startsWith(filterFlag[2])).map(value=>({value:filterFlag[1]+value,label:label(value.trim()),kind:'command'}));
      const typeArg=input.match(/^(scope filter .*--type\s+)([^\s]*)$/)??input.match(/^(scope filter --type\s+)([^\s]*)$/);
      if(typeArg){const result=await invoke('knowledge.query',{query:{limit:1},revision:scopeRevision}),needle=typeArg[2].normalize('NFKC').toLocaleLowerCase();return(result.typeCatalog??[]).filter(type=>type.id.startsWith(typeArg[2])||Object.values(type.labels).some(text=>text.normalize('NFKC').toLocaleLowerCase().includes(needle))).slice(0,40).map(type=>({value:typeArg[1]+quote(type.id)+' ',label:{en:type.labels.en??Object.values(type.labels)[0]??type.id,...(type.labels['zh-CN']?{'zh-CN':type.labels['zh-CN']}:{})},kind:'ref'}));}
      const contextArg=input.match(/^(scope (?:context\s+|use --context\s+|assign --context\s+))([^\s]*)$/);
      if(contextArg)return(await invoke('context.list',{revision:scopeRevision,text:contextArg[2],limit:40})).items.map(value=>({value:contextArg[1]+quote(value.definition.id)+' ',label:{en:value.definition.labels.en??Object.values(value.definition.labels)[0],...(value.definition.labels['zh-CN']?{'zh-CN':value.definition.labels['zh-CN']}:{})},kind:'ref'}));
      const batchArg=input.match(/^(scope assign .*--batch\s+)([^\s]*)$/);
      if(batchArg)return(await invoke('context.batches',{revision:scopeRevision,limit:100})).items.filter(value=>value.status==='complete'&&value.batchKey.startsWith(batchArg[2])).slice(0,40).map(value=>({value:batchArg[1]+value.batchKey+' ',label:{en:value.labels.en??Object.values(value.labels)[0]??value.batchKey,...(value.labels['zh-CN']?{'zh-CN':value.labels['zh-CN']}:{})},kind:'ref'}));
      return ['scope contexts ','scope context ','scope create --name ','scope use --context ','scope use --all','scope use --unassigned','scope filter --text ','scope filter --from ','scope filter --type ','scope reset','scope batches ','scope assign --context ','scope apply '].filter(value=>value.startsWith(input)).map(value=>({value,label:label(value.trim()),kind:'command'}));
    }
    const gitFlag = input.match(/^(git diff(?: --staged)?\s+)(--[^\s]*)$/);
    if (gitFlag) return ['--staged ','--offset ','--limit '].filter(value => value.startsWith(gitFlag[2]) && !(gitFlag[1].includes('--staged') && value === '--staged ')).map(value => ({ value: gitFlag[1] + value, label: label(value.trim()), kind: 'command' }));
    const switchName = input.match(/^(git switch\s+)([^\s]*)$/);
    if (switchName) return (await invoke('repository.branches', {})).filter(value => value.name.startsWith(switchName[2])).slice(0, 40).map(value => ({ value: switchName[1] + quote(value.name), label: label(value.name), kind: 'ref' }));
    const pathInput = input.match(/^(git (add|restore --staged|diff(?: --staged)?)\s+(?:--\s+)?)([^\s]*)$/);
    if (pathInput) {
      const status = await invoke('repository.status', {}), paths = pathInput[2].includes('--staged') ? status.staged : status.unstaged;
      const prefix = pathInput[1] + (pathInput[2].startsWith('diff') && !/\s--\s/.test(pathInput[1]) ? '-- ' : '');
      return paths.filter(value => value.path.startsWith(pathInput[3])).slice(0, 40).map(value => ({ value: prefix + value.path, label: label(value.path), kind: 'ref' }));
    }
    const option = input.match(/^(.*--(model|object)\s+)([^\s]*)$/);
    if (option?.[2] === 'model') return (await invoke('model.catalog', { revision: 'working' })).models.filter(item => item.datasetId.startsWith(option[3])).slice(0, 40).map(item => ({ value: option[1] + quote(item.datasetId) + ' ', label: item.name, kind: 'ref' }));
    if (option?.[2] === 'object') return (await invoke('knowledge.query', { query: { text: option[3], limit: 40 }, revision: 'working' })).objects.map(item => ({ value: option[1] + quote(item.id) + ' ', label: { en: item.labels.en ?? item.id, ...(item.labels['zh-CN'] || item.labels.zh ? { 'zh-CN': item.labels['zh-CN'] ?? item.labels.zh } : {}) }, kind: 'ref' }));
    if (/^history\s+/.test(input)) {
      const parsed = tokenize(input); if ('error' in parsed) return [];
      const words = parsed.words.slice(1); let modelId: string | undefined, revision: string | undefined, count = 0;
      while (words[count]?.startsWith('--') && words[count + 1]) { const flag = words[count++], value = words[count++]; if (flag === '--model') modelId = value; else if (flag === '--revision') revision = value; }
      if (modelId && revision && (revision === 'working' || oid.test(revision))) {
        const model = await invoke('model.read', { datasetId: modelId, revision }), engine = createHistoryEngine(model.package.history);
        const tail = words.slice(count).join(' ') + (/\s$/.test(input) ? ' ' : ''), prefix = `history --model ${quote(modelId)} --revision ${revision} `;
        const owned = boundContext({ kind: 'model', modelId, revision }, context, contextTarget);
        const completed = completeCommand(engine, tail.replace(/\bCHECKED\b/g, 'HEAD'), owned).map(item => ({ ...item, value: prefix + item.value.replace(/^git /, '').replace(/\bHEAD\b/g, 'CHECKED').replace(/(^|\s)commit:/g, '$1state:') }));
        const ref = tail.match(/^(show|checkout|diff|log|blame|trace)\s+(.*\s)?([^\s]*)$/);
        if (ref) for (const alias of [...(owned.head ? ['CHECKED'] : []), ...(owned.comparison ? ['A','B'] : [])]) if (alias.startsWith(ref[3])) completed.unshift({ value: prefix + ref[1] + ' ' + (ref[2] ?? '') + alias, label: label(alias), kind: 'ref' });
        return completed.filter((item, index) => completed.findIndex(other => other.value === item.value) === index).slice(0, 40);
      }
    }
    const candidates = !input.trim() || !input.includes(' ') ? ['git ', 'history --model ', 'history --object ', 'scope ', 'help'] : input.startsWith('git ') ? HELP.filter(value => value.startsWith('git ')).map(value => value.replace(/\s[<\[].*$/, '') + ' ') : ['history --model ', 'history --object ','scope '];
    return [...new Set(candidates)].filter(value => value.startsWith(input)).slice(0, 40).map(value => ({ value, label: label(value.trim()), kind: 'command' }));
  }
  return { execute, complete };
}
