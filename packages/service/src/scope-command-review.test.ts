import test from 'node:test';
import assert from 'node:assert/strict';
import type { NavigationCommandIntent } from '../../contracts/src/navigation-types.ts';
import { createWorkbenchCommands, parseWorkbenchCommand } from './workbench-commands.ts';
import { scopeCommandText } from './scope-commands.ts';

const commands = createWorkbenchCommands(async () => { throw new Error('Filter commands must not write or infer a target.'); });
test('scope filter literal roundtrips distinguish flags, JSON escapes and quoted operator data', async () => {
  for (const text of ['--include-undated', 'Council\nA', 'Council; A', 'Court & council | source <entry> `note` $(literal)', 'Council "A" \\ archive', 'Literal \\n and \\u4e2d', '\t\b\f\r\u0001', '中文\u2028Name']) {
    const intent = { family: 'scope' as const, intent: { type: 'filter' as const, filters: { text } } };
    const structured = await commands.execute({ input: { intent } }); assert.ok(structured.ok);
    const replay = await commands.execute({ input: { command: structured.command } }); assert.ok(replay.ok, JSON.stringify(replay));
    assert.deepEqual(replay.effect, structured.effect, structured.command);
  }
  const singleQuoted = await commands.execute({ input: { command: "scope filter --text '--include-undated; $(data) \\n'" } });
  assert.ok(singleQuoted.ok);
  assert.deepEqual(singleQuoted.effect, { type: 'scope', patch: { type: 'filters', filters: { text: '--include-undated; $(data) \\n' } } });
  const escaped = await commands.execute({ input: { command: 'scope filter --text "\\u002d\\u002dinclude-undated\\u003b\\u0024(x)"' } });
  assert.ok(escaped.ok);
  assert.deepEqual(escaped.effect, { type: 'scope', patch: { type: 'filters', filters: { text: '--include-undated;$(x)' } } });
});

test('quoted scope names, purposes and assignment rationale retain every localized value', () => {
  const intents: NavigationCommandIntent[] = [
    { type: 'create', labels: { en: '--include-undated; council', 'zh-CN': '议事会\n甲 & 乙' }, description: { 'zh-CN': '--purpose $(literal) \\n', en: 'First line\nSecond "line"' } },
    { type: 'create', labels: { en: 'A name' }, description: { 'zh-CN': '仅中文用途; 文本' } },
    { type: 'create', labels: { en: '--name' }, description: { en: '--purpose' } },
    { type: 'assign', contextId: 'context:fixture', batchKey: 'a'.repeat(64), rationale: '--reason\nCouncil; A & B $(literal)' },
  ];
  for (const intent of intents) assert.deepEqual(parseWorkbenchCommand(scopeCommandText(intent)), { intent: { family: 'scope', intent } }, scopeCommandText(intent));
  assert.deepEqual(parseWorkbenchCommand('scope create --name "Original" --language en --purpose "Original purpose"'), { intent: { family: 'scope', intent: { type: 'create', labels: { en: 'Original' }, description: { en: 'Original purpose' } } } });
});

test('localized create literals reach the same validated service parameters after command replay', async () => {
  const captures: unknown[] = [], head = 'a'.repeat(40);
  const bridge = createWorkbenchCommands(async (method, params) => {
    assert.equal(method, 'context.save'); captures.push(structuredClone(params));
    return { contextId: 'context:created', contentHash: 'b'.repeat(64), head, paths: [] } as never;
  });
  const intent = { family: 'scope' as const, intent: { type: 'create' as const, labels: { en: '--name; Council', 'zh-CN': '议事会 & 文档' }, description: { en: 'Line one\nLine two \\n', 'zh-CN': '用途 $(literal)' } } };
  const guards = { operationId: 'literal-create', expectedHead: head };
  const structured = await bridge.execute({ input: { intent }, ...guards }); assert.ok(structured.ok);
  const replay = await bridge.execute({ input: { command: structured.command }, ...guards }); assert.ok(replay.ok);
  assert.equal(captures.length, 2); assert.deepEqual(captures[1], captures[0]);
  assert.deepEqual(captures[0], { ...guards, expectedContentHash: null, labels: intent.intent.labels, description: intent.intent.description });
});

test('unquoted operators, substitutions and malformed quotes never invoke a service operation', async () => {
  for (const suffix of ['; git status', '& echo x', '| cat', '> file', '< file', '`id`', '$(id)', '\nhelp', '\rhelp', '\tstatus', '\u0000']) {
    for (const prefix of ['scope filter --text word ', 'scope filter --text "word" ']) {
      const rejected = await commands.execute({ input: { command: prefix + suffix } });
      assert.ok(!rejected.ok && rejected.error.code === 'UNSUPPORTED_SYNTAX', JSON.stringify(rejected));
    }
  }
  for (const command of ['scope filter --text "unclosed', 'scope filter --text "bad\\q"', 'scope filter --text "raw\nnewline"', 'scope create --name A --language en --name B --language en', 'scope create --name A --language en --name B', 'scope create --name A --language en --purpose one --purpose two', 'scope create --name A --language en --purpose one --purpose-language en --purpose two --purpose-language en']) {
    const rejected = await commands.execute({ input: { command } }); assert.ok(!rejected.ok && rejected.effect.type === 'none', command);
  }
  const quoted = await commands.execute({ input: { command: 'scope filter --text "word; git status"' } });
  assert.ok(quoted.ok && quoted.effect.type === 'scope');
});

test('structured scope filters retain their complete dimension patch in the reusable command', async () => {
  const filters: Extract<NavigationCommandIntent, { type: 'filter' }>['filters'][] = [
    { review: ['adopted'], includeUndated: false, includeUnlocated: false },
    { review: ['unreviewed', 'rejected'], includeUndated: true, includeUnlocated: true },
    { typeIds: [], review: [], text: '' },
    { time: [-3, 2], typeIds: ['fixture:person', 'fixture:structure'], text: 'Council "A" \\ archive', review: ['adopted', 'unreviewed'], includeUndated: false, includeUnlocated: true },
    {},
  ];
  for (const filter of filters) {
    const intent = { family: 'scope' as const, intent: { type: 'filter' as const, filters: filter } };
    const structured = await commands.execute({ input: { intent } });
    assert.ok(structured.ok); assert.deepEqual(structured.effect, { type: 'scope', patch: { type: 'filters', filters: filter } });
    const replay = await commands.execute({ input: { command: structured.command } });
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.deepEqual(replay.effect, structured.effect, structured.command);
    assert.deepEqual(replay.output, structured.output, structured.command);
  }
});

test('scope filter syntax rejects conflicting inclusion modes and invalid explicit sets', () => {
  for (const command of [
    'scope filter --include-undated --exclude-undated',
    'scope filter --include-unlocated --exclude-unlocated',
    'scope filter --exclude-undated --exclude-undated',
    'scope filter --all-types --type fixture:person',
    'scope filter --review none --review adopted',
    'scope filter --review future',
    'scope filter --include-unlocated false',
  ]) assert.ok('error' in parseWorkbenchCommand(command), command);
});

test('scope context equivalent commands retain the explicit bounded page', () => {
  const intent = { type: 'context' as const, contextId: 'context:fixture', revision: 'a'.repeat(40), offset: 100, limit: 50 };
  assert.deepEqual(parseWorkbenchCommand(scopeCommandText(intent)), { intent: { family: 'scope', intent } });
});

test('scope completion exposes the supported filter flags and review choices', async () => {
  assert.ok((await commands.complete('scope filter --ex')).some(value => value.value === 'scope filter --exclude-undated '));
  assert.ok((await commands.complete('scope filter --ex')).some(value => value.value === 'scope filter --exclude-unlocated '));
  assert.ok((await commands.complete('scope filter --review a')).some(value => value.value === 'scope filter --review adopted '));
  assert.ok((await commands.complete('scope filter --review n')).some(value => value.value === 'scope filter --review none '));
});
