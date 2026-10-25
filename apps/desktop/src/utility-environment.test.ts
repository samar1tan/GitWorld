import test from 'node:test';
import assert from 'node:assert/strict';
import { utilityEnvironment } from './utility-environment.ts';

test('missing optional variables are absent keys instead of undefined native env values', () => {
  const result = utilityEnvironment({ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });
  assert.deepEqual(result, { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });
  assert.equal(Object.hasOwn(result, 'TMPDIR'), false);
  assert.ok(Object.values(result).every(value => typeof value === 'string'));
});

test('the original three-key whitelist preserves exact and deliberately empty strings', () => {
  const input = { PATH: '/usr/bin:/bin', LANG: '', TMPDIR: '/tmp/technical-fixture', HOME: '/not-forwarded', NODE_OPTIONS: '--not-forwarded', PRIVATE_FIXTURE: 'not-forwarded' };
  assert.deepEqual(utilityEnvironment(input), { PATH: input.PATH, LANG: '', TMPDIR: input.TMPDIR });
  assert.equal(input.PRIVATE_FIXTURE, 'not-forwarded');
});

test('nonstring values are omitted rather than coerced or sent to Electron', () => {
  assert.deepEqual(utilityEnvironment({ PATH: '/usr/bin:/bin', LANG: null, TMPDIR: 37 }), { PATH: '/usr/bin:/bin' });
});

test('an empty whitelist fails closed instead of triggering Electron full environment inheritance', () => {
  assert.throws(() => utilityEnvironment({}), /UTILITY_ENVIRONMENT_EMPTY/);
  assert.throws(() => utilityEnvironment({ HOME: '/not-forwarded', NODE_OPTIONS: '--not-forwarded' }), /UTILITY_ENVIRONMENT_EMPTY/);
  assert.deepEqual(utilityEnvironment({ PATH: '' }), { PATH: '' });
});
