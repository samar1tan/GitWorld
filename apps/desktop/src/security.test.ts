import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isApplicationUrl, resolveAsset, allowedExternalUrl, safeRequestId } from './security.ts';
import { FileTokenRegistry } from './file-tokens.ts';

test('only the packaged application main frame is an IPC origin', () => {
  assert.equal(isApplicationUrl('gitworld://app/index.html?scope=europe#history'), true);
  for (const url of ['https://app/index.html', 'gitworld://app.evil/index.html', 'gitworld://user@app/index.html', 'gitworld://app/iframe.html', 'file:///index.html']) assert.equal(isApplicationUrl(url), false);
});
test('asset resolution cannot traverse the renderer directory or request remote content', () => {
  const root = path.resolve('virtual-renderer-root');
  assert.equal(resolveAsset(root, 'gitworld://app/assets/app.js'), path.join(root, 'assets/app.js'));
  assert.equal(resolveAsset(root, 'gitworld://app/index.html?scope=europe'), path.join(root, 'index.html'));
  for (const url of ['https://app/assets/app.js', 'gitworld://app/%2f..%2fprivate.key', 'gitworld://app/%00secret', 'gitworld://app/assets%5csecret', 'gitworld://user@app/index.html']) assert.equal(resolveAsset(root, url), null);
});
test('external links permit HTTPS documents but not executable schemes or credentials', () => {
  assert.equal(allowedExternalUrl('https://example.org/evidence'), 'https://example.org/evidence');
  const syntheticCredentialUrl = ['https://', 'user', ':', 'example-password', '@example.org'].join('');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', syntheticCredentialUrl, 'http://example.org', 'https://example.org:444']) assert.equal(allowedExternalUrl(url), null);
});
test('native file tokens bind a selected path to its purpose and expiration', () => {
  const tokens = new FileTokenRegistry();
  const grant = tokens.issue('/synthetic/example.json', 'import', 100);
  assert.equal(tokens.resolve(grant.fileToken, 'import', 101), '/synthetic/example.json');
  assert.equal(tokens.resolve(grant.fileToken, 'export', 101), undefined);
  assert.equal(tokens.resolve('invented', 'import', 101), undefined);
  assert.equal(tokens.resolve(grant.fileToken, 'import', grant.expiresAt), undefined);
  const next = tokens.issue('/synthetic/backup.sqlite', 'backup', 200);
  tokens.clear();
  assert.equal(tokens.resolve(next.fileToken, 'backup', 201), undefined);
});
test('untrusted request identifiers are not echoed as arbitrary error strings', () => {
  assert.equal(safeRequestId({ requestId: 'request-123' }), 'request-123');
  assert.equal(safeRequestId({ requestId: '<private/path>' }), 'invalid-request');
});
