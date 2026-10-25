import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClientStateCache, type ClientStateApi } from './client-state.ts';
import type { ClientStateEntry, ClientStateKey } from '../../../../packages/contracts/src/index.ts';

function fixture() {
  const saved = new Map<ClientStateKey, ClientStateEntry>(); let fail = false;
  const writes: ClientStateEntry[] = [];
  const api: ClientStateApi = {
    async load(key) { return saved.get(key) ?? null; },
    async save(input) {
      if (fail) throw new Error('IO_ERROR');
      if ((saved.get(input.key)?.version ?? null) !== input.expectedVersion) throw new Error('CONFLICT');
      const entry = { key: input.key, version: (input.expectedVersion ?? 0) + 1, value: structuredClone(input.value) };
      saved.set(entry.key, entry); writes.push(entry); return entry;
    },
  };
  return { api, saved, writes, fail(value: boolean) { fail = value; } };
}

test('typing is coalesced and flush persists the final recovery input before close', async () => {
  const f = fixture(), cache = createClientStateCache(f.api); await cache.initialize();
  for (const text of ['A', 'AB', 'ABC']) cache.storage.setItem('gitworld-research-input-v1', JSON.stringify({ text }));
  assert.equal(f.writes.length, 0);
  assert.equal(cache.storage.getItem('gitworld-research-input-v1'), '{"text":"ABC"}');
  await cache.flush(); assert.equal(f.writes.length, 1);
  const restarted = createClientStateCache(f.api); await restarted.initialize();
  assert.equal(restarted.storage.getItem('gitworld-research-input-v1'), '{"text":"ABC"}');
  restarted.storage.removeItem('gitworld-research-input-v1'); await restarted.flush();
  assert.equal(f.saved.get('research-input')?.value, null);
});

test('failed writes are retained for retry and never reported as successful flushes', async () => {
  const f = fixture(), statuses: boolean[] = [], cache = createClientStateCache(f.api, value => statuses.push(value)); await cache.initialize();
  f.fail(true); cache.set('onboarding', { paused: true }); await assert.rejects(cache.flush(), /IO_ERROR/);
  assert.equal(statuses.at(-1), true); assert.equal(f.saved.size, 0);
  cache.set('onboarding', { paused: false }); f.fail(false); await cache.flush();
  assert.deepEqual(f.saved.get('onboarding')?.value, { paused: false }); assert.equal(statuses.at(-1), false);
});

test('browser-only recovery is migrated once without replacing backed-up library state', async () => {
  const f = fixture(), legacy = { getItem: (key: string) => key === 'gitworld-research-input-v1' ? '{"text":"old input"}' : null };
  const first = createClientStateCache(f.api); await first.initialize(legacy);
  assert.deepEqual(f.saved.get('research-input')?.value, { text: 'old input' });
  first.storage.removeItem('gitworld-research-input-v1'); await first.flush();
  const second = createClientStateCache(f.api); await second.initialize(legacy);
  assert.equal(second.storage.getItem('gitworld-research-input-v1'), null);
});

test('an empty initial migration does not prevent later preferences from saving', async () => {
  const f = fixture(), cache = createClientStateCache(f.api); await cache.initialize({ getItem: () => null });
  await cache.save('locale', 'zh-CN');
  assert.equal(f.saved.get('locale')?.value, 'zh-CN');
});

test('a stale window retains input and resolves a conflict only after an explicit choice', async () => {
  const f = fixture(), first = createClientStateCache(f.api), stale = createClientStateCache(f.api);
  await Promise.all([first.initialize(), stale.initialize()]);
  await first.save('research-input', { text: 'saved in another window' });
  await assert.rejects(stale.save('research-input', { text: 'this window input' }), /CONFLICT/);
  assert.deepEqual(stale.conflict()?.local, { text: 'this window input' });
  assert.deepEqual(stale.conflict()?.saved?.value, { text: 'saved in another window' });
  await stale.resolveConflict('local');
  assert.deepEqual(f.saved.get('research-input')?.value, { text: 'this window input' });
  await assert.rejects(first.save('research-input', { text: 'later input' }), /CONFLICT/);
  await first.resolveConflict('saved');
  assert.deepEqual(first.get('research-input'), { text: 'this window input' });
  assert.equal(first.conflict(), null);
});
