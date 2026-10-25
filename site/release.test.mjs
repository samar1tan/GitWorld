import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease } from './release-validation.mjs';
import { syntheticRelease } from './release-fixture.mjs';
const { release: candidate } = syntheticRelease();
test('a site with no verified release has no download metadata', () => assert.equal(validateRelease(null), null));
test('all installer and receipt URLs identify the owned release and allowed file types', () => {
  assert.deepEqual(validateRelease(candidate), candidate);
  for (const url of ['https://example.org/app.dmg', candidate.url.replace('/GitWorld/', '/other/'), candidate.url.replace('/v0.1.0-test/', '/v1.0.0/'), candidate.url + '?token=example']) assert.throws(() => validateRelease({ ...candidate, url }));
  assert.throws(() => validateRelease({ ...candidate, buildReceipt: { ...candidate.buildReceipt, url: candidate.url } }));
  assert.throws(() => validateRelease({ ...candidate, acceptanceReceipt: candidate.buildReceipt }));
});
test('release publication requires exact bounded receipt hashes and actual platform metadata', () => {
  for (const patch of [{ sha256: 'unknown' }, { bytes: 0 }, { signing: 'trusted' }, { sourceCommit: 'main' }, { validatedAt: 'unknown' }, { testedMacOS: 'latest' }, { buildReceipt: null }, { acceptanceReceipt: { ...candidate.acceptanceReceipt, bytes: 600000 } }]) assert.throws(() => validateRelease({ ...candidate, ...patch }));
});
