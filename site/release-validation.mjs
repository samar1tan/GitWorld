export const SHA256 = /^[a-f0-9]{64}$/;
export const COMMIT = /^[a-f0-9]{40}$/;
export const TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

export function validateAsset(input, tag, extension) {
  if (!input || !SHA256.test(input.sha256 || '') || !Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > (extension === 'json' ? 512 * 1024 : 1024 * 1024 * 1024)) throw new Error('INVALID_RELEASE_ASSET');
  const parsed = new URL(input.url);
  const prefix = `/samar1tan/GitWorld/releases/download/${tag}/`;
  if (parsed.protocol !== 'https:' || parsed.host !== 'github.com' || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.pathname.startsWith(prefix) || !new RegExp(`^GitWorld[-A-Za-z0-9.]+\\.${extension}$`).test(parsed.pathname.slice(prefix.length))) throw new Error('INVALID_RELEASE_URL');
  return { url: parsed.href, sha256: input.sha256, bytes: input.bytes };
}

export function validateRelease(input) {
  if (input === null) return null;
  if (!input || typeof input !== 'object') throw new Error('INVALID_RELEASE');
  const { tag, architecture, signing, validatedAt, sourceCommit, testedMacOS } = input;
  if (!TAG.test(tag || '') || !['arm64', 'x64'].includes(architecture) || !['unsigned', 'signed-notarized'].includes(signing) || !COMMIT.test(sourceCommit || '') || !isDate(validatedAt) || typeof testedMacOS !== 'string' || !/^\d{2}\.\d+(?:\.\d+)?$/.test(testedMacOS)) throw new Error('INVALID_RELEASE');
  const artifact = validateAsset(input, tag, 'dmg');
  const buildReceipt = validateAsset(input.buildReceipt, tag, 'json');
  const acceptanceReceipt = validateAsset(input.acceptanceReceipt, tag, 'json');
  if (buildReceipt.url === acceptanceReceipt.url) throw new Error('INVALID_RELEASE_RECEIPTS');
  return { tag, ...artifact, architecture, signing, validatedAt, sourceCommit, testedMacOS, buildReceipt, acceptanceReceipt };
}
