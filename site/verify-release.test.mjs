import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyReleasedInstaller } from './verify-release.mjs';
import { syntheticRelease } from './release-fixture.mjs';

function fixture(overrides = {}) {
  const data = syntheticRelease(overrides), { release } = data, calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === release.url) return new Response(overrides.dmg ?? data.dmg);
    if (url === release.buildReceipt.url) return new Response(overrides.buildBytes ?? data.buildBytes);
    if (url === release.acceptanceReceipt.url) return new Response(overrides.acceptanceBytes ?? data.acceptanceBytes);
    if (url.includes('/releases/tags/')) return Response.json(overrides.published ?? { tag_name: release.tag, draft: false, assets: [release, release.buildReceipt, release.acceptanceReceipt].map(asset => ({ browser_download_url: asset.url, size: asset.bytes })) });
    if (url.includes('/git/ref/tags/')) return Response.json(overrides.reference ?? { ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: overrides.commit ?? release.sourceCommit } });
    if (url.includes('/git/tags/')) return Response.json(overrides.annotatedTag);
    if (url.includes('/commits/')) return Response.json({ sha: release.sourceCommit, commit: { tree: { sha: 'c'.repeat(40) } } });
    if (url.includes('/compare/')) return Response.json({ merge_base_commit: { sha: overrides.mainBase ?? release.sourceCommit } });
    throw new Error('Unexpected request');
  };
  return { ...data, fetcher, calls };
}
test('release verification binds source, build and independent installed-GUI receipt to the exact DMG', async () => {
  const f = fixture();
  assert.deepEqual(await verifyReleasedInstaller(f.release, { ...f, token: 'synthetic-test-token', requestedTag: f.release.tag }), f.release);
  assert.equal(f.calls.length, 7);
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer synthetic-test-token');
  for (const call of f.calls.slice(4)) assert.equal(call.options.headers, undefined);
  assert.ok(f.calls.every(call => !call.url.includes('/contents/')));
});
test('tag resolution handles annotated tags and rejects branch aliases, object targets and cycles', async () => {
  const { release } = syntheticRelease(), tagSha = 'e'.repeat(40);
  const reference = { ref: `refs/tags/${release.tag}`, object: { type: 'tag', sha: tagSha } };
  const valid = fixture({ reference, annotatedTag: { sha: tagSha, object: { type: 'commit', sha: release.sourceCommit } } });
  await verifyReleasedInstaller(valid.release, valid);
  assert.ok(valid.calls.some(call => call.url.endsWith(`/commits/${release.sourceCommit}`)));
  assert.ok(valid.calls.every(call => !call.url.endsWith(`/commits/${release.tag}`)));
  for (const override of [
    { reference: { ref: `refs/heads/${release.tag}`, object: { type: 'commit', sha: release.sourceCommit } } },
    { reference: { ...reference, object: { type: 'tree', sha: release.sourceCommit } } },
    { reference, annotatedTag: { sha: tagSha, object: reference.object } },
    { reference, annotatedTag: { sha: 'd'.repeat(40), object: { type: 'commit', sha: release.sourceCommit } } },
  ]) {
    const f = fixture(override);
    await assert.rejects(verifyReleasedInstaller(f.release, f), /RELEASE_SOURCE_MISMATCH/);
    assert.ok(f.calls.every(call => call.url !== f.release.url));
  }
});
test('wrong tag target, unmerged source, draft or missing receipt assets fail before downloading the DMG', async () => {
  for (const [override, code] of [[{ commit: 'c'.repeat(40) }, 'RELEASE_SOURCE_MISMATCH'], [{ mainBase: 'c'.repeat(40) }, 'RELEASE_SOURCE_NOT_ON_MAIN'], [{ published: { draft: true } }, 'RELEASE_ASSET_MISMATCH'], [{ published: { tag_name: 'v0.1.0-test', draft: false, assets: [] } }, 'RELEASE_ASSET_MISMATCH']]) {
    const f = fixture(override); await assert.rejects(verifyReleasedInstaller(f.release, f), new RegExp(code)); assert.ok(f.calls.every(call => call.url !== f.release.url));
  }
});
test('internal or mismatched source build receipts cannot authorize installation acceptance', async () => {
  for (const mutateBuild of [b => { b.internal = true; }, b => { b.source.sourceCommit = 'c'.repeat(40); }, b => { b.arch = 'x64'; }, b => { b.artifacts = []; }]) {
    const f = fixture({ mutateBuild }); await assert.rejects(verifyReleasedInstaller(f.release, f), /BUILD_(RECEIPT|SOURCE)_MISMATCH/); assert.ok(f.calls.every(call => call.url !== f.release.url));
  }
});
test('a passing-looking receipt for another DMG, build, platform or time is rejected', async () => {
  for (const mutateAcceptance of [a => { a.artifact = { ...a.artifact, sha256: '0'.repeat(64) }; }, a => { a.buildReceiptSha256 = '0'.repeat(64); }, a => { a.sourceCommit = 'c'.repeat(40); }, a => { a.buildId = '999'; }, a => { a.macOSVersion = '14.0'; }, a => { a.testedAt = '2026-10-24T00:00:00Z'; }, a => { a.signing = 'signed-notarized'; }]) {
    const f = fixture({ mutateAcceptance }); await assert.rejects(verifyReleasedInstaller(f.release, f), /ACCEPTANCE_RECEIPT_MISMATCH/);
  }
});
test('clean-install evidence and the actual source tree are checked, not merely claimed tool versions', async () => {
  for (const [mutateBuild, code] of [[b => { delete b.source.installation; }, 'BUILD_INSTALLATION_EVIDENCE_MISSING'], [b => { b.source.installation.exitCode = 1; }, 'BUILD_INSTALLATION_EVIDENCE_MISSING'], [b => { b.source.sourceTree = '0'.repeat(40); }, 'RELEASE_SOURCE_TREE_MISMATCH']]) {
    const f = fixture({ mutateBuild }); await assert.rejects(verifyReleasedInstaller(f.release, f), new RegExp(code));
  }
});
test('failed, incomplete and duplicate acceptance checks are never a release pass', async () => {
  for (const mutateAcceptance of [a => { a.result = 'failed'; }, a => { a.checks.pop(); }, a => { a.checks[0].result = 'failed'; }, a => { a.checks[0] = a.checks[1]; }, a => { a.checks[0].evidence = ''; }]) {
    const f = fixture({ mutateAcceptance }); await assert.rejects(verifyReleasedInstaller(f.release, f), /ACCEPTANCE_(RECEIPT_MISMATCH|CHECKS_INCOMPLETE)/);
  }
});
test('a legacy 53-check acceptance receipt cannot omit Guide J06 and navigation acceptance', async () => {
  const f = fixture({ mutateAcceptance: a => { a.checks = a.checks.filter(check => check.id !== 'J06' && !check.id.startsWith('N')); } });
  assert.equal(f.acceptance.checks.length, 53);
  await assert.rejects(verifyReleasedInstaller(f.release, f), /ACCEPTANCE_CHECKS_INCOMPLETE/);
  assert.ok(f.calls.every(call => call.url !== f.release.url));
});
test('Guide J06 and every Scope check require their own installed acceptance evidence', async () => {
  const ids = ['J06', 'N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09'];
  for (const id of ids) {
    const f = fixture({ mutateAcceptance: a => { a.checks = a.checks.filter(check => check.id !== id); } });
    await assert.rejects(verifyReleasedInstaller(f.release, f), /ACCEPTANCE_CHECKS_INCOMPLETE/, id);
    assert.ok(f.calls.every(call => call.url !== f.release.url), id);
  }
});
test('Settings checks cannot substitute for Scope acceptance identifiers', async () => {
  const f = fixture({ mutateAcceptance: a => { a.checks = a.checks.map(check => check.id === 'N01' ? { ...check, id: 'S07' } : check); } });
  assert.ok(['S01', 'S02', 'S03', 'S04', 'S05', 'S06'].every(id => f.acceptance.checks.some(check => check.id === id)));
  await assert.rejects(verifyReleasedInstaller(f.release, f), /ACCEPTANCE_CHECKS_INCOMPLETE/);
  assert.ok(f.calls.every(call => call.url !== f.release.url));
});
test('smoke-only or agent-assisted backend mutations cannot substitute for standalone unscripted GUI use', async () => {
  for (const mutateAcceptance of [a => { delete a.standalone; }, a => { a.standalone.backendEdits = true; }, a => { a.standalone.checkoutAccess = true; }, a => { a.standalone.modelServiceUsed = true; }, a => { a.standalone.steps = []; }, a => { a.standalone.unscriptedInvestigation.preparedInSeed = true; }, a => { a.standalone.unscriptedInvestigation.seedChanged = true; }, a => { a.standalone.unscriptedInvestigation.steps = []; }]) {
    const f = fixture({ mutateAcceptance }); await assert.rejects(verifyReleasedInstaller(f.release, f), /ACCEPTANCE_(STANDALONE|UNSCRIPTED)_GUI_MISSING/);
  }
});
test('changed receipt bytes and changed DMG bytes fail their independently reviewed hashes', async () => {
  for (const [override, code] of [[{ acceptanceBytes: Buffer.from('{}') }, 'RELEASE_SIZE_MISMATCH'], [{ buildBytes: Buffer.from('{}') }, 'RELEASE_SIZE_MISMATCH'], [{ dmg: Buffer.alloc(syntheticRelease().dmg.length) }, 'RELEASE_HASH_MISMATCH'], [{ dmg: Buffer.alloc(syntheticRelease().dmg.length + 1) }, 'RELEASE_SIZE_MISMATCH']]) {
    const f = fixture(override); await assert.rejects(verifyReleasedInstaller(f.release, f), new RegExp(code));
  }
});
test('null metadata and mismatched dispatch tags cannot trigger network requests', async () => {
  const fetcher = () => { throw new Error('Network must not run'); }, { release } = fixture();
  await assert.rejects(verifyReleasedInstaller(null, { fetcher }), /SITE_DEPLOY_BLOCKED_NO_VERIFIED_RELEASE/);
  await assert.rejects(verifyReleasedInstaller(release, { fetcher, requestedTag: 'v1.0.0' }), /SITE_DEPLOY_TAG_MISMATCH/);
});
