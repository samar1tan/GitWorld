#!/usr/bin/env node
// Audit a reviewed publication set without changing the repository or printing file contents.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORIES = new Set(['source', 'test', 'configuration', 'documentation', 'localization', 'data', 'asset']);
const TEXT_EXTENSIONS = new Set(['', '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.svg', '.csv', '.tsv', '.sql', '.sh', '.py', '.rs', '.lock', '.map', '.example', '.sample']);
const PASSIVE_ASSETS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf', '.otf']);
const FORBIDDEN_EXTENSIONS = /\.(?:exe|dll|so|dylib|node|app|dmg|pkg|msi|deb|rpm|zip|tar|gz|bz2|xz|7z|rar|jar|wasm|pdf|docx?|xlsx?|pptx?|db|sqlite3?|pem|key|p12|pfx|jks|keystore|keychain(?:-db)?|mobileprovision)(?:$|-)/i;
const PRIVATE_DIRECTORIES = /(?:^|\/)(?:\.git|\.codex|\.local|private|attachments?|\.chat-attachments|screenshots?|captures?|evidence|runtime|user-data|userdata|crawl-cache|raw-crawl|release-artifacts|node_modules|dist|out|coverage)(?:\/|$)/i;
const LOCAL_WORKING_PATHS = /^(?:design\/figma\/|docs\/archive\/|docs\/research\/notes\/|docs\/GitWorld_(?:PRD|Future_Directions|UED_04_QA|UED_Review_0[2-5])\.md$|docs\/research\/(?:GitWorld_Competitive_Analysis_2026-10-25|ued05-(?:content|ui)-qa)\.md$)/;
const SECRET_PATTERNS = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['GITHUB_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['CLOUD_ACCESS_KEY', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['SERVICE_TOKEN', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/],
  ['CREDENTIAL_URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i],
  ['LOCAL_HOME_PATH', /(?:\/Users\/[^\s/'"<>]+|\/home\/[^\s/'"<>]+|[A-Z]:[\\/]Users[\\/][^\s'"<>]+)/],
  ['CHAT_REFERENCE', /(?:thread:\/\/|plugin:\/\/[^\s]*mention=tab|\.codex\/attachments\/)/],
  ['EMBEDDED_BINARY', /data:(?:image|application|font)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]{40}/i],
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const git = (cwd, args) => execFileSync('git', ['--literal-pathspecs', ...args], { cwd, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

export function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f\\*?\[\]{}]/.test(value)
    && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value)
    && value === path.posix.normalize(value) && !value.split('/').some((part) => part === '..' || part === '.')
    && !value.endsWith('/');
}

function blockedPath(name) {
  const base = path.posix.basename(name);
  return PRIVATE_DIRECTORIES.test(name) || LOCAL_WORKING_PATHS.test(name)
    || /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials(?:\..+)?|secrets(?:\.(?:json|ya?ml|toml))?)$/i.test(base)
      && !/^\.env\.(?:example|sample)$/.test(base)
    || FORBIDDEN_EXTENSIONS.test(name) || /(?:^|\/)(?:signing|provisioning)(?:\/|$)/i.test(name);
}

function inspectRights(entry, findings) {
  const add = (code) => findings.push({ path: entry.path, code });
  if (!CATEGORIES.has(entry.category)) add('CATEGORY_REQUIRED');
  if (!nonempty(entry.license) || /^(?:unknown|tbd|none|unlicensed)$/i.test(entry.license)) add('LICENSE_REQUIRED');
  const rights = entry.rights;
  if (!rights || rights.reviewed !== true || !['original', 'third-party', 'mixed'].includes(rights.origin) || !nonempty(rights.basis)) {
    add('RIGHTS_REVIEW_REQUIRED');
    return;
  }
  if (rights.origin !== 'original' || ['asset', 'data'].includes(entry.category)) {
    if (!nonempty(rights.source) || !nonempty(rights.evidence)) add('PROVENANCE_REQUIRED');
    if (!Array.isArray(rights.notices) || !rights.notices.length && !nonempty(rights.noticeNotRequired)) add('NOTICE_DECISION_REQUIRED');
  }
  if (rights.notices !== undefined && (!Array.isArray(rights.notices) || rights.notices.some((name) => !safeRelativePath(name) || blockedPath(name)))) add('INVALID_NOTICE_PATH');
}

function assetSignature(extension, bytes) {
  const start = bytes.subarray(0, 16);
  if (extension === '.png') return start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return start[0] === 255 && start[1] === 216 && start[2] === 255;
  if (extension === '.gif') return /^GIF8[79]a/.test(start.toString('ascii'));
  if (extension === '.webp') return start.toString('ascii', 0, 4) === 'RIFF' && start.toString('ascii', 8, 12) === 'WEBP';
  if (extension === '.woff') return start.toString('ascii', 0, 4) === 'wOFF';
  if (extension === '.woff2') return start.toString('ascii', 0, 4) === 'wOF2';
  if (extension === '.otf') return start.toString('ascii', 0, 4) === 'OTTO';
  if (extension === '.ttf') return start.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]));
  return false;
}

function validAssetContainer(extension, bytes) {
  if (extension === '.png') {
    if (bytes.length < 45) return false;
    let offset = 8, header = false, data = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) return false;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (!header) {
        if (type !== 'IHDR' || length !== 13 || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0) return false;
        header = true;
      } else if (type === 'IHDR') return false;
      if (type === 'IDAT') data = true;
      offset += length + 12;
      if (type === 'IEND') return length === 0 && data && offset === bytes.length;
    }
    return false;
  }
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length >= 10 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (extension === '.gif') return bytes.length >= 14 && bytes.at(-1) === 59;
  if (extension === '.webp') return bytes.length >= 20 && bytes.readUInt32LE(4) + 8 === bytes.length;
  if (extension === '.woff' || extension === '.woff2') return bytes.length >= 44 && bytes.readUInt32BE(8) === bytes.length;
  if (extension === '.ttf' || extension === '.otf') {
    if (bytes.length < 12) return false;
    const tables = bytes.readUInt16BE(4);
    if (!tables || 12 + tables * 16 > bytes.length) return false;
    for (let index = 0; index < tables; index++) {
      const position = 12 + index * 16;
      if (bytes.readUInt32BE(position + 8) + bytes.readUInt32BE(position + 12) > bytes.length) return false;
    }
    return true;
  }
  return false;
}

export function inspectContent(entry, bytes) {
  const findings = [];
  const add = (code) => findings.push({ path: entry.path, code });
  inspectRights(entry, findings);
  if (blockedPath(entry.path)) add('PRIVATE_OR_FORBIDDEN_PATH');
  if (bytes.length > 8 * 1024 * 1024) add('FILE_TOO_LARGE_FOR_SOURCE_GATE');
  const extension = path.posix.extname(entry.path).toLowerCase();
  if (PASSIVE_ASSETS.has(extension)) {
    if (entry.category !== 'asset' || entry.rights?.metadataReviewed !== true) add('ASSET_REVIEW_REQUIRED');
    if (!assetSignature(extension, bytes)) add('ASSET_SIGNATURE_MISMATCH');
    else if (!validAssetContainer(extension, bytes)) add('INVALID_ASSET_CONTAINER');
    // Structural checks do not decode pixels/fonts or prove the absence of private metadata.
    const ascii = bytes.toString('latin1');
    for (const [code, pattern] of SECRET_PATTERNS) if (pattern.test(ascii)) add(code);
    return findings;
  }
  if (!TEXT_EXTENSIONS.has(extension) && !/^\.(?:gitignore|gitattributes|editorconfig)$/.test(path.posix.basename(entry.path))) add('UNREVIEWABLE_FILE_TYPE');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { add('BINARY_CONTENT'); return findings; }
  if (content.includes('\0') || /^(?:MZ|\x7fELF|SQLite format 3)/.test(content)) add('BINARY_CONTENT');
  for (const [code, pattern] of SECRET_PATTERNS) if (pattern.test(content)) add(code);
  const assignment = /(?:api[_-]?key|api[_-]?token|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret[_-]?key)\s*[=:]\s*["'`]([^"'`\s]{8,})/gi;
  for (const match of content.matchAll(assignment)) {
    if (!/^(?:YOUR_|EXAMPLE_|REPLACE_|replace[-_]|placeholder|changeme|<|\$\{|process\.env\.|env\.)/i.test(match[1])) { add('POSSIBLE_CREDENTIAL_ASSIGNMENT'); break; }
  }
  if (extension === '.md') {
    if (entry.category !== 'documentation') add('DOCUMENT_CATEGORY_REQUIRED');
    const cjk = content.match(/[\u3400-\u9fff]/g)?.length || 0;
    if (cjk && !nonempty(entry.languageException)) add('NON_ENGLISH_DOCUMENT_REVIEW_REQUIRED');
    if (cjk / Math.max(content.length, 1) > 0.15) add('LOCAL_LANGUAGE_WORKING_DOCUMENT');
  }
  if (extension === '.svg') {
    if (entry.category !== 'asset') add('ASSET_REVIEW_REQUIRED');
    if (/<(?:script|foreignObject|iframe|image)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(content)) add('ACTIVE_OR_EXTERNAL_SVG');
  }
  return findings;
}

function readCandidate(cwd, name, mode) {
  if (mode === 'staged') {
    const records = git(cwd, ['ls-files', '--stage', '-z', '--', name]).toString('utf8').split('\0').filter(Boolean);
    if (records.length !== 1 || !records[0].startsWith('100644 ') && !records[0].startsWith('100755 ')) throw new Error('NON_REGULAR_INDEX_ENTRY');
    if (!/^[0-9]+ [a-f0-9]+ 0\t/.test(records[0])) throw new Error('UNMERGED_INDEX_ENTRY');
    return git(cwd, ['show', `:${name}`]);
  }
  const root = realpathSync(cwd);
  const full = path.resolve(root, name);
  const real = realpathSync(full);
  if (real !== full || !real.startsWith(`${root}${path.sep}`) || !lstatSync(full).isFile()) throw new Error('NON_REGULAR_WORKTREE_ENTRY');
  return readFileSync(full);
}

export function auditPublication({ cwd, mode, manifest }) {
  const findings = [];
  const add = (name, code) => findings.push({ path: name, code });
  if (!['prepared', 'staged'].includes(mode)) return { ok: false, findings: [{ path: '<manifest>', code: 'MODE_REQUIRED' }], checked: 0 };
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || !nonempty(manifest.review?.reviewer) || !nonempty(manifest.review?.scope) || !nonempty(manifest.review?.reviewedAt) || Number.isNaN(Date.parse(manifest.review.reviewedAt))) {
    return { ok: false, findings: [{ path: '<manifest>', code: 'INVALID_REVIEW_MANIFEST' }], checked: 0 };
  }
  const names = new Set();
  for (const entry of manifest.files) {
    if (!entry || !safeRelativePath(entry.path)) { add('<manifest>', 'INVALID_RELATIVE_PATH'); continue; }
    if (names.has(entry.path)) add(entry.path, 'DUPLICATE_PATH');
    names.add(entry.path);
  }
  if (findings.length) return { ok: false, findings, checked: 0 };
  let stagedStatus = new Map();
  if (mode === 'staged') {
    const tokens = git(cwd, ['diff', '--cached', '--name-status', '--no-renames', '-z']).toString('utf8').split('\0').filter(Boolean);
    for (let index = 0; index < tokens.length; index += 2) stagedStatus.set(tokens[index + 1], tokens[index]);
    if (!stagedStatus.size) add('<index>', 'NO_STAGED_CHANGES');
    for (const name of stagedStatus.keys()) if (!names.has(name)) add(name, 'UNEXPECTED_STAGED_PATH');
    for (const name of names) if (!stagedStatus.has(name)) add(name, 'MANIFEST_PATH_NOT_STAGED');
  }
  for (const entry of manifest.files) {
    const action = entry.action || 'include';
    if (!['include', 'delete'].includes(action)) { add(entry.path, 'INVALID_ACTION'); continue; }
    if (action === 'delete') {
      if (mode === 'prepared') add(entry.path, 'DELETION_REQUIRES_STAGED_MODE');
      else if (stagedStatus.get(entry.path) !== 'D') add(entry.path, 'DELETION_MISMATCH');
      if (/^(?:LICENSE|COPYING)(?:\..+)?$/i.test(path.posix.basename(entry.path))) add(entry.path, 'LICENSE_REMOVAL_REQUIRES_OWNER_REVIEW');
      continue;
    }
    if (stagedStatus.get(entry.path) === 'D') { add(entry.path, 'DELETION_MUST_BE_DECLARED'); continue; }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || '')) { add(entry.path, 'HASH_REQUIRED'); continue; }
    let bytes;
    try { bytes = readCandidate(cwd, entry.path, mode); }
    catch { add(entry.path, 'MISSING_OR_NON_REGULAR_FILE'); continue; }
    if (sha256(bytes) !== entry.sha256) add(entry.path, 'REVIEWED_HASH_MISMATCH');
    findings.push(...inspectContent(entry, bytes));
    if (Array.isArray(entry.rights?.notices)) for (const notice of entry.rights.notices) {
      if (!safeRelativePath(notice) || blockedPath(notice)) continue;
      try { readCandidate(cwd, notice, mode); } catch { add(entry.path, 'NOTICE_FILE_MISSING'); }
    }
  }
  return { ok: findings.length === 0, findings, checked: manifest.files.length };
}

export function runCli(args, cwd = process.cwd()) {
  const modeFlags = args.filter((arg) => arg === '--staged' || arg === '--prepared');
  const manifestIndex = args.indexOf('--manifest');
  if (modeFlags.length !== 1 || manifestIndex < 0 || !args[manifestIndex + 1] || args.length !== 3) {
    console.error('Usage: node scripts/publication-audit.mjs (--prepared|--staged) --manifest PATH');
    return 2;
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(path.resolve(cwd, args[manifestIndex + 1]), 'utf8')); }
  catch { console.error('FAIL INVALID_REVIEW_MANIFEST <manifest>'); return 2; }
  let result;
  try { result = auditPublication({ cwd, mode: modeFlags[0].slice(2), manifest }); }
  catch { console.error('FAIL REPOSITORY_READ_FAILED <index>'); return 2; }
  for (const finding of result.findings) console.error(`FAIL ${finding.code} ${JSON.stringify(finding.path)}`);
  if (result.ok) console.log(`PASS ${result.checked} reviewed ${modeFlags[0].slice(2)} path(s). Manual rights, privacy and history review remain required.`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
