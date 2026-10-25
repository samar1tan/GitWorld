import { createHash } from 'node:crypto';

// Keep the synthetic acceptance contract independent of the validator's required set.
const SYNTHETIC_CHECK_IDS = [['D', 15], ['M', 15], ['J', 6], ['S', 6], ['N', 9], ['C', 12]].flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`));

// Test-only synthetic bytes and assertions. No actual release or acceptance is represented.
export function syntheticRelease({ mutateBuild = () => {}, mutateAcceptance = () => {} } = {}) {
  const dmg = Buffer.from('synthetic installer bytes for verifier tests');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const tag = 'v0.1.0-test', base = `https://github.com/samar1tan/GitWorld/releases/download/${tag}/`;
  const artifact = { name: 'GitWorld-0.1.0-test-arm64-unsigned.dmg', sha256: hash(dmg), bytes: dmg.length };
  const sourceCommit = 'b'.repeat(40);
  const build = { schemaVersion: 1, kind: 'gitworld-build', appName: 'GitWorld', buildId: '123', internal: false, platform: 'darwin', arch: 'arm64', signing: 'unsigned', completedAt: '2026-10-25T00:00:00Z', preparedSha256: 'd'.repeat(64), asarSha256: 'e'.repeat(64), artifacts: [artifact], source: { schemaVersion: 1, repository: 'https://github.com/samar1tan/GitWorld', tag, sourceCommit, sourceTree: 'c'.repeat(40), acceptedMainCommit: sourceCommit, lockfileSha256: 'f'.repeat(64), toolchain: { node: '24.0.0', platform: 'darwin', architecture: 'arm64', packages: { electron: '45.0.0' } } } };
  build.source.installation = { schemaVersion: 1, method: 'npm-ci', isolation: 'fresh-checkout', exitCode: 0, sourceCommit, lockfileSha256: 'f'.repeat(64), npmVersion: '11.0.0', startedAt: '2026-10-24T23:00:00Z', completedAt: '2026-10-24T23:01:00Z', logSha256: '1'.repeat(64), dependencyTreeSha256: '2'.repeat(64) };
  mutateBuild(build);
  const buildBytes = Buffer.from(JSON.stringify(build));
  const steps = [{ action: 'Synthetic: open the installed application.', observed: 'Synthetic: the installed workbench opens.' }, { action: 'Synthetic: search for an unprepared topic.', observed: 'Synthetic: source results are displayed.' }, { action: 'Synthetic: stage and commit a new observation.', observed: 'Synthetic: the new state is visible after restart.' }];
  const acceptance = { schemaVersion: 1, kind: 'gitworld-acceptance', contract: 'desktop-v0.1', result: 'passed', tag, sourceCommit, buildReceiptSha256: hash(buildBytes), buildId: '123', artifact, platform: 'darwin', architecture: 'arm64', signing: 'unsigned', macOSVersion: '15.6.1', testedAt: '2026-10-25T01:00:00Z', operator: { kind: 'agent', name: 'Synthetic test operator' }, checks: SYNTHETIC_CHECK_IDS.map(id => ({ id, result: 'passed', evidence: 'Synthetic unit-test evidence; no product acceptance occurred.' })), standalone: { result: 'passed', environment: 'isolated-user-profile', codexRequired: false, developerRuntimeRequired: false, checkoutAccess: false, developmentServerUsed: false, modelServiceUsed: false, backendEdits: false, stateInjection: false, interaction: 'installed-gui', installedFromSha256: artifact.sha256, steps, unscriptedInvestigation: { topic: 'Synthetic unprepared topic', preparedInSeed: false, codeChanged: false, seedChanged: false, steps } }, cleanMachineTest: { result: 'not-run' }, usabilityStudy: { kind: 'not-run' }, runtime: { electron: '45.0.0', node: '24.0.0', sqlite: '3.50.0' } };
  mutateAcceptance(acceptance);
  const acceptanceBytes = Buffer.from(JSON.stringify(acceptance));
  const release = { tag, url: base + artifact.name, sha256: artifact.sha256, bytes: artifact.bytes, architecture: 'arm64', signing: 'unsigned', validatedAt: '2026-10-25T01:00:00Z', sourceCommit, testedMacOS: '15.6.1', buildReceipt: { url: base + 'GitWorld-build.json', sha256: hash(buildBytes), bytes: buildBytes.length }, acceptanceReceipt: { url: base + 'GitWorld-acceptance.json', sha256: hash(acceptanceBytes), bytes: acceptanceBytes.length } };
  return { release, build, acceptance, dmg, buildBytes, acceptanceBytes };
}
