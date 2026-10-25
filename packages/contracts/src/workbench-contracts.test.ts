import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServiceRequest } from './index.ts';

const oid = 'a'.repeat(40), target = { kind: 'model', modelId: 'world', revision: oid };
const valid = (method: string, params: unknown) => validateServiceRequest({ protocolVersion: 1, requestId: 'contract', method, params }).ok;
const command = (intent: unknown) => valid('command.execute', { input: { intent } });

test('new model and global command contracts retain explicit repository/target boundaries', () => {
  assert.ok(valid('model.catalog', { revision: 'working' })); assert.ok(valid('model.read', { datasetId: 'world', revision: oid }));
  for (const revision of ['HEAD','revision-1','main',undefined]) assert.ok(!valid('model.catalog', { revision }));
  assert.ok(command({ family: 'history', target, context: { head: null }, intent: { type: 'show', ref: 'state:old' } }));
  assert.ok(command({ family: 'history', target, context: { head: null }, intent: { type: 'compare', a: { ...target, ref: 'state:old' }, b: { ...target, revision: 'b'.repeat(40), ref: 'state:old' } } }));
  assert.ok(!command({ family: 'shell', intent: { type: 'exec', command: 'pwd' } }));
  assert.ok(!command({ family: 'git', intent: { type: 'reset', hard: true } }));
  assert.ok(!command({ family: 'git', intent: { type: 'add', paths: ['../outside.json'] } }));
  assert.ok(!command({ family: 'history', target, context: { head: null }, intent: { type: 'show', ref: 'x'.repeat(4097) } }));
  assert.ok(!valid('command.execute', { input: { command: 'git status', intent: { family: 'git', intent: { type: 'status' } } } }));
  assert.ok(!valid('command.execute', { input: { command: 'git status' }, contextTarget: { kind: 'object', objectId: 'other', revision: oid } }));
});

test('object intents preserve review flags and reject hidden or incomplete endpoint state', () => {
  const object = { kind: 'object', objectId: 'external:subject', revision: oid };
  assert.ok(command({ family: 'history', target: object, intent: { type: 'show', state: { year: -1, includeUnreviewed: true } } }));
  for (const state of [{ year: 0 }, { year: 10, objectId: 'hidden-other' }, { year: 10, includeUnreviewed: 'true' }, { year: 10, rawPath: '/tmp/data' }]) assert.ok(!command({ family: 'history', target: object, intent: { type: 'show', state } }));
  assert.ok(!command({ family: 'history', target: object, intent: { type: 'diff', a: { year: 10 }, b: { ...object } } }));
  assert.ok(valid('repository.diff', { mode: 'staged', offset: 1000, limit: 100 }));
  for (const limit of [0,101,-1,'25']) assert.ok(!valid('repository.diff', { mode: 'working', limit }));
});
