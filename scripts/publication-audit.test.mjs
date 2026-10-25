import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPublication, inspectContent, safeRelativePath } from './publication-audit.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const original = { origin: 'original', basis: 'Original authored test content for this repository.', reviewed: true };
const entry = (name, bytes, patch = {}) => ({ path: name, sha256: hash(bytes), category: 'source', license: 'Apache-2.0', rights: original, ...patch });
const manifest = (files) => ({ version: 1, review: { reviewer: 'Quinn / test', scope: 'Test fixture publication only', reviewedAt: '2026-10-25' }, files });
const codes = (result) => result.findings.map((finding) => finding.code);
function repo(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'gitworld-publication-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Publication audit test');
  git('config', 'user.email', 'test@example.invalid');
  const write = (name, bytes) => { mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true }); writeFileSync(path.join(cwd, name), bytes); };
  write('LICENSE', 'Apache License, Version 2.0\n');
  git('add', '--', 'LICENSE');
  git('commit', '-qm', 'Initialize isolated test repository');
  return { cwd, git, write };
}

test('prepared audit accepts reviewed text without staging or changing it', (t) => {
  const { cwd, write, git } = repo(t);
  const text = 'export const answer = 42;\n';
  write('src/a.ts', text);
  const before = git('status', '--porcelain').toString();
  const result = auditPublication({ cwd, mode: 'prepared', manifest: manifest([entry('src/a.ts', text)]) });
  assert.equal(result.ok, true);
  assert.equal(git('status', '--porcelain').toString(), before);
});

test('staged audit scans index bytes rather than a substituted working copy', (t) => {
  const { cwd, write, git } = repo(t);
  const sensitive = ['gh', 'p_', 'A'.repeat(36)].join('');
  write('src/a.ts', `export const token = '${sensitive}';`);
  git('add', '--', 'src/a.ts');
  const clean = 'export const token = null;';
  write('src/a.ts', clean);
  const result = auditPublication({ cwd, mode: 'staged', manifest: manifest([entry('src/a.ts', clean)]) });
  assert.ok(codes(result).includes('REVIEWED_HASH_MISMATCH'));
  assert.ok(codes(result).includes('GITHUB_TOKEN'));
});

test('staged audit requires exact candidates and rejects empty or unexpected staging', (t) => {
  const { cwd, write, git } = repo(t);
  write('src/a.ts', 'export {};');
  const plan = manifest([entry('src/a.ts', 'export {};')]);
  assert.ok(codes(auditPublication({ cwd, mode: 'staged', manifest: plan })).includes('NO_STAGED_CHANGES'));
  write('extra.txt', 'Unreviewed');
  git('add', '--', 'src/a.ts', 'extra.txt');
  assert.ok(codes(auditPublication({ cwd, mode: 'staged', manifest: plan })).includes('UNEXPECTED_STAGED_PATH'));
});

test('review hashes, duplicate paths and invalid review records fail closed', (t) => {
  const { cwd, write } = repo(t);
  write('src/a.ts', 'changed');
  assert.ok(codes(auditPublication({ cwd, mode: 'prepared', manifest: manifest([entry('src/a.ts', 'before')]) })).includes('REVIEWED_HASH_MISMATCH'));
  const one = entry('src/a.ts', 'changed');
  assert.ok(codes(auditPublication({ cwd, mode: 'prepared', manifest: manifest([one, one]) })).includes('DUPLICATE_PATH'));
  assert.ok(codes(auditPublication({ cwd, mode: 'prepared', manifest: { files: [one] } })).includes('INVALID_REVIEW_MANIFEST'));
});

test('traversal, globs, absolute paths and symlinks cannot expand the allowlist', (t) => {
  for (const name of ['../outside.ts', '/tmp/outside.ts', 'a/../b.ts', '*.ts', 'a\\b.ts', 'a\n.ts']) assert.equal(safeRelativePath(name), false);
  const { cwd, write, git } = repo(t);
  write('src/real.ts', 'export {};');
  symlinkSync('real.ts', path.join(cwd, 'src/link.ts'));
  const plan = manifest([entry('src/link.ts', 'export {};')]);
  assert.ok(codes(auditPublication({ cwd, mode: 'prepared', manifest: plan })).includes('MISSING_OR_NON_REGULAR_FILE'));
  git('add', '--', 'src/link.ts');
  assert.ok(codes(auditPublication({ cwd, mode: 'staged', manifest: plan })).includes('MISSING_OR_NON_REGULAR_FILE'));
});

test('local notes, attachments, operational databases and signing files cannot be approved by manifest', () => {
  const names = ['docs/GitWorld_PRD.md', 'attachments/report.txt', 'docs/research/evidence/capture.png', 'runtime/seed.json', 'backup.sqlite3', 'keys/release.p12', 'signing/cert.txt', '.env.production'];
  for (const name of names) assert.ok(inspectContent(entry(name, 'data'), Buffer.from('data')).some((finding) => finding.code === 'PRIVATE_OR_FORBIDDEN_PATH'), name);
});

test('renamed executable and binary payloads are rejected', () => {
  for (const bytes of [Buffer.from([0, 1, 2, 255]), Buffer.from('MZ executable payload'), Buffer.from('SQLite format 3\0')]) {
    assert.ok(inspectContent(entry('src/innocent.txt', bytes), bytes).some((finding) => finding.code === 'BINARY_CONTENT'));
  }
});

test('literal secrets and private home paths are findings without returning their values', () => {
  const secret = 'password' + ' = "' + 'private-value-123456' + '"';
  const localPath = '/' + ['Users', 'private-person', 'documents'].join('/');
  const bytes = Buffer.from(`${secret}\n${localPath}`);
  const findings = inspectContent(entry('config.ts', bytes), bytes);
  assert.ok(findings.some((f) => f.code === 'POSSIBLE_CREDENTIAL_ASSIGNMENT'));
  assert.ok(findings.some((f) => f.code === 'LOCAL_HOME_PATH'));
  assert.ok(!JSON.stringify(findings).includes('private-value'));
  assert.ok(!JSON.stringify(findings).includes('private-person'));
});

test('safe environment templates are allowed but real credentials are not', () => {
  const bytes = Buffer.from('API_KEY="YOUR_API_KEY"\n');
  const good = inspectContent(entry('.env.example', bytes, { category: 'configuration' }), bytes);
  assert.equal(good.length, 0);
});

test('Chinese working documents are blocked while localized product data remains eligible', () => {
  const bytes = Buffer.from('这是内部工作讨论，不是公开文档。');
  assert.ok(inspectContent(entry('docs/working.md', bytes, { category: 'documentation' }), bytes).some((f) => f.code === 'LOCAL_LANGUAGE_WORKING_DOCUMENT'));
  const localized = inspectContent(entry('src/zh-CN.json', bytes, { category: 'localization' }), bytes);
  assert.equal(localized.length, 0);
});

test('data is not blanket-excluded, but provenance and notice decisions are mandatory', () => {
  const bytes = Buffer.from('{"id":"west-843","title":"Original authored summary"}');
  const rights = { ...original, source: 'original:GitWorld', evidence: 'Original authored summaries with separately cited historical evidence.', notices: [], noticeNotRequired: 'Original project prose is covered by the repository license.' };
  assert.equal(inspectContent(entry('data/curated/seed.json', bytes, { category: 'data', rights }), bytes).length, 0);
  assert.ok(inspectContent(entry('data/curated/seed.json', bytes, { category: 'data' }), bytes).some((f) => f.code === 'PROVENANCE_REQUIRED'));
});

test('passive assets require provenance and metadata review; active SVG is rejected', () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEFsAAAAASUVORK5CYII=', 'base64');
  const rights = { ...original, source: 'original:GitWorld', evidence: 'Authored diagram; exact metadata inspected.', notices: [], noticeNotRequired: 'Original work.', metadataReviewed: true };
  assert.equal(inspectContent(entry('assets/diagram.png', bytes, { category: 'asset', rights }), bytes).length, 0);
  assert.ok(inspectContent(entry('assets/diagram.png', bytes, { category: 'asset' }), bytes).some((f) => f.code === 'ASSET_REVIEW_REQUIRED'));
  for (const content of ['<svg><script>alert(1)</script></svg>', '<svg><image href="https://example.invalid/pixel"/></svg>', '<svg onload="alert(1)"/>']) {
    assert.ok(inspectContent(entry('assets/map.svg', content, { category: 'asset', rights }), Buffer.from(content)).some((f) => f.code === 'ACTIVE_OR_EXTERNAL_SVG'));
  }
});

test('referenced notices must exist in the same publication source', (t) => {
  const { cwd, write, git } = repo(t);
  const body = 'export {};';
  const rights = { origin: 'third-party', reviewed: true, basis: 'Reviewed upstream source.', source: 'https://example.invalid/source', evidence: 'Upstream MIT license', notices: ['NOTICE'] };
  write('src/vendor.ts', body);
  write('NOTICE', 'Notice exists only in the working tree');
  git('add', '--', 'src/vendor.ts');
  const plan = manifest([entry('src/vendor.ts', body, { license: 'MIT', rights })]);
  assert.equal(auditPublication({ cwd, mode: 'prepared', manifest: plan }).ok, true);
  assert.ok(codes(auditPublication({ cwd, mode: 'staged', manifest: plan })).includes('NOTICE_FILE_MISSING'));
});

test('deletions require an explicit staged deletion entry and need no content hash', (t) => {
  const { cwd, git, write } = repo(t);
  write('obsolete.txt', 'Old public description');
  git('add', '--', 'obsolete.txt');
  git('commit', '-qm', 'Add public text fixture');
  git('rm', '--', 'obsolete.txt');
  const plan = manifest([{ path: 'obsolete.txt', action: 'delete' }]);
  assert.equal(auditPublication({ cwd, mode: 'staged', manifest: plan }).ok, true);
  assert.ok(codes(auditPublication({ cwd, mode: 'prepared', manifest: plan })).includes('DELETION_REQUIRES_STAGED_MODE'));
  git('rm', '--', 'LICENSE');
  const removal = manifest([...plan.files, { path: 'LICENSE', action: 'delete' }]);
  assert.ok(codes(auditPublication({ cwd, mode: 'staged', manifest: removal })).includes('LICENSE_REMOVAL_REQUIRES_OWNER_REVIEW'));
});

test('CLI fails for missing scope and never echoes a detected credential', (t) => {
  const { cwd, write } = repo(t);
  const script = fileURLToPath(new URL('./publication-audit.mjs', import.meta.url));
  assert.equal(spawnSync(process.execPath, [script], { cwd }).status, 2);
  const credential = ['gh', 'p_', 'B'.repeat(36)].join('');
  write('src/a.ts', credential);
  write('plan.json', JSON.stringify(manifest([entry('src/a.ts', credential)])));
  const result = spawnSync(process.execPath, [script, '--prepared', '--manifest', 'plan.json'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('GITHUB_TOKEN'));
  assert.ok(!result.stderr.includes(credential));
});


test('truncated or appended raster payloads cannot pass with a signature alone', () => {
  const valid = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEFsAAAAASUVORK5CYII=', 'base64');
  const rights = { ...original, source: 'original:GitWorld', evidence: 'Test-only image fixture', notices: [], noticeNotRequired: 'Original fixture', metadataReviewed: true };
  for (const bytes of [valid.subarray(0, 8), Buffer.concat([valid, Buffer.from('MZ appended payload')])]) {
    assert.ok(inspectContent(entry('assets/image.png', bytes, { category: 'asset', rights }), bytes).some((finding) => finding.code === 'INVALID_ASSET_CONTAINER'));
  }
});
