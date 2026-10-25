import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOnboardingProgress, createOnboarding, initialOnboardingSnapshot, onboardingProgress, parseOnboardingSnapshot, type OnboardingContext, type OnboardingProgressEvent, type OnboardingSnapshot } from './onboarding.ts';

const investigation: OnboardingProgressEvent[] = [
  { type: 'scope-chosen', scopeKey: 'scope:A' },
  { type: 'historical-state-inspected', scopeKey: 'scope:A', stateKey: 'object:A/year:100/revision:A' },
  { type: 'comparison-completed', scopeKey: 'scope:A', comparisonKey: 'A@revision:A/B@revision:A' },
  { type: 'evidence-inspected', scopeKey: 'scope:A', evidenceKey: 'source:A/claim:A/revision:A' },
  { type: 'research-saved', scopeKey: 'scope:A', recordId: 'research:A', contentHash: 'hash:A' },
];
const objectPath = `objects/${'a'.repeat(64)}.json`;
const data: OnboardingProgressEvent[] = [
  { type: 'data-acquired', jobId: 'job:A' }, { type: 'data-previewed', jobId: 'job:A' }, { type: 'data-adopted', jobId: 'job:A', paths: [objectPath] },
  { type: 'changes-staged', tree: 'tree:A', paths: [objectPath] }, { type: 'data-committed', oid: 'commit:A', tree: 'tree:A' },
];
const apply = (events: OnboardingProgressEvent[], state = initialOnboardingSnapshot()) => events.reduce((current, event) => applyOnboardingProgress(current, event, 'paths'), state);
const tick = () => new Promise(resolve => setImmediate(resolve));
const click = (guide: ReturnType<typeof createOnboarding>, action: string, extra = {}) => guide.click({ dataset: { onboarding: action, ...extra } } as unknown as HTMLElement);
function fixture(persist?: (snapshot: OnboardingSnapshot) => void | Promise<void>, onTipsChange?: (enabled: boolean) => Promise<void>) {
  let context: OnboardingContext = { section: 'paths' }, renders = 0;
  const saves: OnboardingSnapshot[] = [], moves: string[] = [], focuses: string[] = [];
  const guide = createOnboarding({ locale: () => 'en', context: () => context, render: () => { renders++; }, persist: async snapshot => { saves.push(structuredClone(snapshot)); await persist?.(snapshot); }, navigate: section => { moves.push(section); }, focus: target => { focuses.push(target); }, onTipsChange });
  return { guide, saves, moves, focuses, context: (next: OnboardingContext) => { context = next; }, renders: () => renders };
}

test('a coherent investigation advances only after ordered successes in its own scope', () => {
  const outOfOrder = apply([investigation[2], investigation[4]]);
  assert.deepEqual(onboardingProgress(outOfOrder), [false, false, false, false, false]);
  let state = apply(investigation.slice(0, 2));
  state = apply([{ type: 'comparison-completed', scopeKey: 'scope:unrelated', comparisonKey: 'unrelated' }], state);
  assert.deepEqual(onboardingProgress(state), [true, true, false, false, false]);
  state = apply(investigation.slice(2), state);
  assert.deepEqual(onboardingProgress(state), [true, true, true, true, true]);
  assert.deepEqual(apply(investigation, state), state);
  const next = apply([{ type: 'scope-chosen', scopeKey: 'scope:B' }], state);
  assert.deepEqual(onboardingProgress(next), [true, false, false, false, false]);
  assert.deepEqual(onboardingProgress(state), [true, true, true, true, true]);
});

test('the optional data recipe keeps acquisition jobs separate and requires staging before a commit', () => {
  let state = apply([data[1], data[2], data[4]]);
  assert.deepEqual(onboardingProgress(state, 'data'), [false, false, false, false, false]);
  state = apply([data[0], { type: 'data-previewed', jobId: 'job:B' }, data[2], data[3], data[4]], state);
  assert.deepEqual(onboardingProgress(state, 'data'), [true, false, false, false, false]);
  state = apply(data, state); assert.deepEqual(onboardingProgress(state, 'data'), [true, true, true, true, true]);
  assert.deepEqual(apply(data, state), state);
  state = apply([{ type: 'data-acquired', jobId: 'job:B' }], state);
  assert.deepEqual(onboardingProgress(state, 'data'), [true, false, false, false, false]);
});

test('restoration waits for hydrate, preserves real progress and creates no new successful operation', async () => {
  const { guide, saves, moves, focuses } = fixture(), restored = apply(investigation.slice(0, 3));
  assert.equal(guide.content(), ''); guide.hydrate(restored); await tick();
  assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, false, false]);
  assert.equal(saves.length, 0); assert.equal(moves.length, 0); assert.equal(focuses.length, 0);
  assert.match(guide.content(), /onboarding-tip/); assert.doesNotMatch(guide.content(), /aria-modal|role="dialog"|aria-live/);
  guide.hydrate(initialOnboardingSnapshot()); assert.deepEqual(guide.snapshot(), restored);
});

test('a requested opening and actual successes arriving before hydration are replayed once', async () => {
  const { guide, saves, focuses } = fixture();
  guide.open(); guide.observe(investigation[0]); guide.observe(investigation[1]);
  assert.equal(guide.content(), ''); assert.equal(saves.length, 0);
  guide.hydrate(undefined); await tick();
  assert.equal(guide.snapshot().panelOpen, true); assert.equal(guide.snapshot().investigation.surface, 'paths');
  assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, false, false, false]); assert.equal(saves.length, 1); assert.equal(focuses.length, 0);
});

test('closing and pausing retain progress without reopening the guide on later successes', async () => {
  const { guide, saves, context } = fixture(); guide.hydrate(undefined); guide.observe(investigation[0]); guide.open();
  await click(guide, 'close'); guide.observe(investigation[1]);
  assert.equal(guide.snapshot().panelOpen, false); assert.equal(guide.content(), '');
  context({ section: 'knowledge' }); assert.match(guide.content(), /onboarding-tip/);
  guide.open(); await click(guide, 'pause'); guide.observe(investigation[2]);
  assert.equal(guide.snapshot().paused, true); assert.equal(guide.snapshot().panelOpen, false); assert.equal(guide.content(), '');
  guide.open(); assert.match(guide.content(), /Guide paused/); await click(guide, 'resume');
  assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, false, false]);
  await tick(); const restored = parseOnboardingSnapshot(saves.at(-1)); assert.equal(restored.paused, false); assert.equal(restored.panelOpen, true);
});

test('tips can be disabled while guide navigation never pretends a task is complete', async () => {
  const { guide, moves, focuses, context } = fixture(); guide.hydrate(undefined); guide.open();
  await click(guide, 'next'); assert.deepEqual(moves, ['paths']); assert.deepEqual(focuses, ['scope']);
  assert.deepEqual(onboardingProgress(guide.snapshot()), [false, false, false, false, false]);
  await click(guide, 'options');
  await click(guide, 'tips'); await click(guide, 'close'); context({ section: 'sources' }); assert.equal(guide.content(), '');
  guide.open(); await click(guide, 'options'); await click(guide, 'tips'); await click(guide, 'close'); context({ section: 'research', editing: true }); assert.equal(guide.content(), '');
  context({ section: 'research', editing: false }); assert.match(guide.content(), /onboarding-tip/);
});

test('restart clears only the selected guide after an explicit confirmation', async () => {
  const { guide } = fixture(); const prior = apply([...investigation, ...data]); guide.hydrate(prior); guide.open();
  await click(guide, 'restart'); assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, true, true]);
  await click(guide, 'cancel-restart'); assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, true, true]);
  await click(guide, 'restart'); await click(guide, 'confirm-restart');
  assert.deepEqual(onboardingProgress(guide.snapshot()), [false, false, false, false, false]); assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, true, true, true, true]);
});

test('failed persistence has a retry path and serialized writes cannot replace newer progress with an old snapshot', async () => {
  let release!: () => void, fail = false;
  const first = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const { guide, saves } = fixture(async () => { if (++calls === 1) await first; if (fail) throw new Error('unavailable'); });
  guide.hydrate(undefined); guide.observe(investigation[0]); guide.observe(investigation[1]); guide.observe(investigation[2]);
  assert.equal(saves.length, 1); release(); await tick(); assert.equal(saves.length, 2);
  assert.deepEqual(onboardingProgress(saves[1]), [true, true, true, false, false]);
  fail = true; guide.observe(investigation[3]); await tick();
  assert.match(guide.content(), /Guide progress could not be saved/); assert.match(guide.content(), /Retry saving progress/);
  assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, true, false]);
  fail = false; await click(guide, 'retry-save'); assert.doesNotMatch(guide.content(), /could not be saved/);
  assert.deepEqual(onboardingProgress(saves.at(-1)!), [true, true, true, true, false]);
});

test('invalid restored progress cannot skip missing prerequisites or retain unsupported preferences', () => {
  const state = parseOnboardingSnapshot({ schemaVersion: 1, dismissedTips: ['paths', 'unknown', 'paths'], investigation: { scopeKey: 'scope:A', comparisonKey: 'comparison:A', evidenceKey: 'evidence:A', research: { recordId: 'r', contentHash: 'h' } }, data: { jobId: 'job:A', adopted: true, stagedTree: 'tree:A', commitOid: 'oid:A' } });
  assert.deepEqual(onboardingProgress(state), [true, false, false, false, false]); assert.deepEqual(onboardingProgress(state, 'data'), [true, false, false, false, false]);
  assert.deepEqual(state.dismissedTips, ['paths']);
  assert.deepEqual(parseOnboardingSnapshot({ schemaVersion: 2 }), initialOnboardingSnapshot());
});

test('adoption ownership survives restart while unrelated paths and a changed frozen tree cannot finish the data recipe', () => {
  const state = parseOnboardingSnapshot(apply(data.slice(0, 3)));
  assert.deepEqual(state.data.adoptedPaths, [objectPath]);
  const unrelated = apply([{ type: 'changes-staged', tree: 'unrelated-tree', paths: ['research/note.json'] }], state);
  assert.equal(unrelated.data.stagedTree, null);
  const staged = apply([{ type: 'changes-staged', tree: 'tree:A', paths: [objectPath] }], unrelated);
  assert.equal(apply([{ type: 'data-committed', oid: 'another-commit', tree: 'different-tree' }], staged).data.commitOid, null);
  assert.equal(apply([{ type: 'data-committed', oid: 'actual-commit', tree: 'tree:A' }], staged).data.commitOid, 'actual-commit');
  const invalid = apply([{ type: 'data-adopted', jobId: 'job:A', paths: ['../private.json', 'objects/../bad.json', objectPath, objectPath] }], state);
  assert.deepEqual(invalid.data.adoptedPaths, [objectPath]);
});

test('prepared hash recovery continues the original recipe without trusting a matching job label or identity alone', () => {
  const hash = 'b'.repeat(64), other = 'c'.repeat(64);
  let state = apply([{ type: 'data-acquired', jobId: 'wikipedia:original' }, { type: 'data-previewed', jobId: 'wikipedia:original', inputHash: hash }]);
  state = parseOnboardingSnapshot(state);
  for (const event of [
    { type: 'data-adopted' as const, jobId: 'wikipedia:original', paths: [objectPath] },
    { type: 'data-adopted' as const, jobId: 'wikipedia:original', inputHash: other, paths: [objectPath] },
    { type: 'data-adopted' as const, jobId: 'wikipedia:original', inputHash: 'not-a-hash', paths: [objectPath] },
    { type: 'data-adopted' as const, jobId: 'file:unrelated', inputHash: other, paths: [objectPath] },
  ]) assert.deepEqual(apply([event], state), state);
  const success: OnboardingProgressEvent = { type: 'data-adopted', jobId: 'file:recovery', inputHash: hash, paths: [objectPath] };
  state = apply([success], state); assert.equal(state.data.jobId, 'wikipedia:original'); assert.equal(state.data.inputHash, hash); assert.deepEqual(onboardingProgress(state, 'data'), [true, true, true, false, false]); assert.deepEqual(apply([success], state), state);
  state = apply([{ type: 'changes-staged', tree: 'frozen', paths: [objectPath] }, { type: 'data-committed', tree: 'frozen', oid: 'actual-commit' }], state); assert.equal(state.data.commitOid, 'actual-commit');
});

test('a changed prepared preview clears downstream ownership while an identical replay preserves it', () => {
  const hash = 'b'.repeat(64), changed = 'c'.repeat(64);
  const events: OnboardingProgressEvent[] = [{ type: 'data-acquired', jobId: 'job:A' }, { type: 'data-previewed', jobId: 'job:A', inputHash: hash }, { type: 'data-adopted', jobId: 'job:A', inputHash: hash, paths: [objectPath] }, data[3], data[4]];
  const complete = apply(events); assert.deepEqual(onboardingProgress(complete, 'data'), [true, true, true, true, true]);
  assert.deepEqual(apply([{ type: 'data-previewed', jobId: 'job:A', inputHash: hash }], complete), complete);
  const next = apply([{ type: 'data-previewed', jobId: 'job:A', inputHash: changed }], complete); assert.equal(next.data.inputHash, changed); assert.deepEqual(onboardingProgress(next, 'data'), [true, true, false, false, false]); assert.deepEqual(next.data.adoptedPaths, []);
  assert.deepEqual(apply([{ type: 'data-adopted', jobId: 'job:A', inputHash: hash, paths: [objectPath] }], next), next);
  const acquired = apply([{ type: 'data-acquired', jobId: 'job:B' }, { type: 'data-previewed', jobId: 'job:B', inputHash: changed }], next);
  assert.deepEqual(apply([{ type: 'data-adopted', jobId: 'file:old', inputHash: hash, paths: [objectPath] }], acquired), acquired);
});

test('legacy guidance remains readable while malformed hashes cannot masquerade as prepared progress', () => {
  const legacy = apply(data), stored = structuredClone(legacy) as any; delete stored.data.inputHash;
  const restored = parseOnboardingSnapshot(stored); assert.equal(restored.data.inputHash, null); assert.deepEqual(onboardingProgress(restored, 'data'), [true, true, true, true, true]);
  assert.deepEqual(apply([{ type: 'data-adopted', jobId: 'file:another', inputHash: 'b'.repeat(64), paths: [objectPath] }], restored), restored);
  const invalid = parseOnboardingSnapshot({ ...stored, data: { ...stored.data, inputHash: 'b'.repeat(65) } }); assert.deepEqual(onboardingProgress(invalid, 'data'), [true, false, false, false, false]); assert.equal(invalid.data.inputHash, null);
  const notPreviewed = parseOnboardingSnapshot({ ...stored, data: { ...stored.data, previewed: false, inputHash: 'b'.repeat(64) } }); assert.equal(notPreviewed.data.inputHash, null); assert.deepEqual(onboardingProgress(notPreviewed, 'data'), [true, false, false, false, false]);
});

test('explicit library restoration replaces the guide without writing old progress into the restored preferences', async () => {
  const { guide, saves } = fixture(); guide.hydrate(undefined); guide.observe(investigation[0]); await guide.flush();
  const count = saves.length, restored = initialOnboardingSnapshot(); restored.tipsEnabled = false; restored.paused = true;
  await guide.restore(restored); assert.deepEqual(guide.snapshot(), restored); assert.equal(guide.content(), '');
  await guide.flush(); assert.equal(saves.length, count);
});

test('Settings preference synchronization preserves learning progress, dismissals and pending writes without saving a profile again', async () => {
  let release!: () => void, profileWrites = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { guide, saves } = fixture(async () => { await gate; }, async () => { profileWrites++; });
  const restored = apply(investigation.slice(0, 3)); restored.dismissedTips = ['paths', 'research'];
  guide.hydrate(restored); guide.observe(investigation[3]); guide.observe(investigation[4]);
  assert.equal(saves.length, 1);
  guide.configurePreferences({ tipsEnabled: false });
  assert.equal(guide.snapshot().tipsEnabled, false); assert.deepEqual(guide.snapshot().dismissedTips, ['paths', 'research']);
  assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, true, true]);
  assert.equal(profileWrites, 0); assert.equal(saves.length, 1);
  release(); await guide.flush();
  assert.equal(saves.length, 2); assert.deepEqual(onboardingProgress(saves[1]), [true, true, true, true, true]);
  assert.equal(guide.snapshot().tipsEnabled, false); assert.equal(profileWrites, 0);
});

test('a saved Learning preference can arrive before guide hydration without resetting restored progress', async () => {
  const { guide, saves } = fixture(), restored = apply(investigation.slice(0, 3)); restored.dismissedTips = ['paths'];
  guide.configurePreferences({ tipsEnabled: false }); assert.equal(guide.content(), '');
  guide.hydrate(restored); await guide.flush();
  assert.equal(guide.snapshot().tipsEnabled, false); assert.deepEqual(guide.snapshot().dismissedTips, ['paths']);
  assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, false, false]); assert.equal(saves.length, 0);
});

test('Settings journey APIs resume the selected track and require the Guide confirmation before clearing it', async () => {
  const { guide } = fixture(), restored = apply([...investigation, ...data]); restored.paused = true;
  guide.openJourney('data', 'restart'); guide.hydrate(restored);
  assert.equal(guide.snapshot().panelOpen, true); assert.equal(guide.snapshot().track, 'data'); assert.equal(guide.snapshot().paused, true);
  assert.match(guide.content(), /Clear the steps in this guide/); assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, true, true, true, true]);
  await click(guide, 'cancel-restart'); assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, true, true, true, true]);
  guide.openJourney('data', 'resume'); assert.equal(guide.snapshot().paused, false); assert.doesNotMatch(guide.content(), /Clear the steps in this guide/);
  guide.openJourney('investigation', 'restart'); assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, true, true]);
  await click(guide, 'confirm-restart'); assert.deepEqual(onboardingProgress(guide.snapshot()), [false, false, false, false, false]);
  assert.deepEqual(onboardingProgress(guide.snapshot(), 'data'), [true, true, true, true, true]);
});

test('a failed Learning-settings save keeps the old tip preference and retries without losing concurrent investigation progress', async () => {
  let reject!: (cause: unknown) => void, fail = true, profileValue = true;
  const gate = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }), writes: boolean[] = [];
  const { guide, saves } = fixture(undefined, async enabled => {
    writes.push(enabled); if (fail) await gate;
    profileValue = enabled; guide.configurePreferences({ tipsEnabled: enabled });
  });
  guide.hydrate(apply(investigation.slice(0, 2))); guide.open(); await click(guide, 'options'); await guide.flush();
  const attempt = click(guide, 'tips');
  assert.equal(guide.snapshot().tipsEnabled, true); assert.match(guide.content(), /Saving tip preference/);
  guide.observe(investigation[2]); reject(new Error('SERVICE_UNAVAILABLE')); await attempt;
  assert.equal(profileValue, true); assert.equal(guide.snapshot().tipsEnabled, true); assert.match(guide.content(), /previous setting is kept/);
  assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, false, false]); assert.ok(saves.every(value => value.tipsEnabled));
  fail = false; await click(guide, 'retry-tips'); await guide.flush();
  assert.deepEqual(writes, [false, false]); assert.equal(profileValue, false); assert.equal(guide.snapshot().tipsEnabled, false);
  assert.equal(saves.at(-1)!.tipsEnabled, false); assert.doesNotMatch(guide.content(), /previous setting is kept/);
});

test('secondary guide views preserve progress and the first action uses the current object context', async () => {
  const { guide, saves, context, moves, focuses } = fixture(); context({ section: 'knowledge' }); guide.hydrate(undefined); guide.open(); await guide.flush();
  const writes = saves.length;
  await click(guide, 'options'); await click(guide, 'progress'); await guide.flush();
  assert.equal(saves.length, writes); assert.equal(guide.snapshot().panelOpen, true);
  await click(guide, 'next'); assert.deepEqual(moves, ['knowledge']); assert.deepEqual(focuses, ['object-search']);
  assert.deepEqual(onboardingProgress(guide.snapshot()), [false, false, false, false, false]);
});

test('Escape cancels guide restart or secondary controls before dismissing the guide', async () => {
  const { guide, focuses } = fixture(); guide.hydrate(apply(investigation.slice(0, 3))); guide.open();
  const event = { key: 'Escape', target: { closest: () => ({}) }, preventDefault() {} } as unknown as KeyboardEvent;
  await click(guide, 'options'); await guide.key(event);
  assert.equal(guide.snapshot().panelOpen, true); assert.doesNotMatch(guide.content(), /id="onboarding-options"/);
  await click(guide, 'restart'); await guide.key(event);
  assert.equal(guide.snapshot().panelOpen, true); assert.deepEqual(onboardingProgress(guide.snapshot()), [true, true, true, false, false]);
  assert.doesNotMatch(guide.content(), /Clear the steps in this guide/);
  await guide.key(event); assert.equal(guide.snapshot().panelOpen, false); assert.equal(focuses.at(-1), 'guide-entry');
});
