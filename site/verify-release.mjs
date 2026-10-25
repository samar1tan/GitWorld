import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { COMMIT, validateRelease } from './release-validation.mjs';
import { validateBuildReceipt, validateAcceptanceReceipt } from './receipt-validation.mjs';

class VerificationError extends Error {}
const fail = code => { throw new VerificationError(code); };

export async function verifyReleasedInstaller(input, { fetcher = fetch, token, requestedTag } = {}) {
  const release = validateRelease(input);
  if (!release) fail('SITE_DEPLOY_BLOCKED_NO_VERIFIED_RELEASE');
  if (requestedTag && requestedTag !== release.tag) fail('SITE_DEPLOY_TAG_MISMATCH');
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const api = 'https://api.github.com/repos/samar1tan/GitWorld';
  const get = endpoint => fetcher(`${api}/${endpoint}`, { headers, signal: AbortSignal.timeout(30_000) });
  const response = await get(`releases/tags/${release.tag}`);
  if (!response.ok) fail('RELEASE_NOT_AVAILABLE');
  const published = await response.json();
  if (published.draft || published.tag_name !== release.tag) fail('RELEASE_ASSET_MISMATCH');
  for (const asset of [release, release.buildReceipt, release.acceptanceReceipt]) {
    const matches = published.assets?.filter(item => item.browser_download_url === asset.url);
    if (matches?.length !== 1 || matches[0].size !== asset.bytes) fail('RELEASE_ASSET_MISMATCH');
  }
  // Resolve the tag namespace explicitly; a same-named branch is not a release tag.
  const referenceResponse = await get(`git/ref/tags/${release.tag}`);
  if (!referenceResponse.ok) fail('RELEASE_SOURCE_MISMATCH');
  const reference = await referenceResponse.json();
  if (reference.ref !== `refs/tags/${release.tag}`) fail('RELEASE_SOURCE_MISMATCH');
  let target = reference.object;
  const visited = new Set();
  while (target?.type === 'tag') {
    if (!COMMIT.test(target.sha ?? '') || visited.has(target.sha) || visited.size >= 8) fail('RELEASE_SOURCE_MISMATCH');
    visited.add(target.sha);
    const tagResponse = await get(`git/tags/${target.sha}`);
    if (!tagResponse.ok) fail('RELEASE_SOURCE_MISMATCH');
    const annotatedTag = await tagResponse.json();
    if (annotatedTag.sha !== target.sha) fail('RELEASE_SOURCE_MISMATCH');
    target = annotatedTag.object;
  }
  if (target?.type !== 'commit' || target.sha !== release.sourceCommit) fail('RELEASE_SOURCE_MISMATCH');
  const commitResponse = await get(`commits/${release.sourceCommit}`);
  if (!commitResponse.ok) fail('RELEASE_SOURCE_MISMATCH');
  const sourceCommit = await commitResponse.json();
  if (sourceCommit.sha !== release.sourceCommit) fail('RELEASE_SOURCE_MISMATCH');
  const mainResponse = await get(`compare/${release.sourceCommit}...main`);
  if (!mainResponse.ok || (await mainResponse.json()).merge_base_commit?.sha !== release.sourceCommit) fail('RELEASE_SOURCE_NOT_ON_MAIN');

  async function downloadAsset(asset, retain = false) {
    // Public asset downloads never receive an API token, including redirects.
    const response = await fetcher(asset.url, { signal: AbortSignal.timeout(retain ? 30_000 : 600_000) });
    if (!response.ok || !response.body) fail('RELEASE_DOWNLOAD_FAILED');
    const hash = createHash('sha256'); let bytes = 0; const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > asset.bytes) fail('RELEASE_SIZE_MISMATCH');
      hash.update(chunk);
      if (retain) chunks.push(chunk);
    }
    if (bytes !== asset.bytes) fail('RELEASE_SIZE_MISMATCH');
    if (hash.digest('hex') !== asset.sha256) fail('RELEASE_HASH_MISMATCH');
    if (retain) { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('RELEASE_RECEIPT_INVALID_JSON'); } }
  }
  const build = validateBuildReceipt(await downloadAsset(release.buildReceipt, true), release);
  if (sourceCommit.commit?.tree?.sha !== build.source.sourceTree) fail('RELEASE_SOURCE_TREE_MISMATCH');
  validateAcceptanceReceipt(await downloadAsset(release.acceptanceReceipt, true), release, build);
  await downloadAsset(release);
  return release;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'));
    await verifyReleasedInstaller(input, { token: process.env.GH_TOKEN, requestedTag: process.env.RELEASE_TAG });
    console.log('Release tag, accepted source, build receipt, installed-GUI acceptance and downloaded DMG hashes agree.');
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'RELEASE_VERIFICATION_FAILED';
    console.error(code);
    process.exitCode = 1;
  }
}
