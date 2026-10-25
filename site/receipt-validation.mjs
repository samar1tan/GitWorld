import { SHA256, COMMIT, isDate } from './release-validation.mjs';

export const ACCEPTANCE_CONTRACT = 'desktop-v0.1';
export const REQUIRED_CHECKS = [['D', 15], ['M', 15], ['J', 6], ['S', 6], ['N', 9], ['C', 12]].flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`));
const fail = code => { throw new Error(code); };
const text = (value, min = 1) => typeof value === 'string' && value.trim().length >= min && value.length <= 4000;
const artifactMatches = (artifact, release) => artifact?.name === new URL(release.url).pathname.split('/').at(-1) && artifact.sha256 === release.sha256 && artifact.bytes === release.bytes;

export function validateBuildReceipt(receipt, release) {
  const source = receipt?.source;
  if (receipt?.schemaVersion !== 1 || receipt.kind !== 'gitworld-build' || receipt.internal !== false || receipt.appName !== 'GitWorld' || receipt.platform !== 'darwin' || receipt.arch !== release.architecture || receipt.signing !== release.signing || !/^\d+$/.test(receipt.buildId || '') || !isDate(receipt.completedAt) || !SHA256.test(receipt.preparedSha256 || '') || !SHA256.test(receipt.asarSha256 || '') || !Array.isArray(receipt.artifacts) || !receipt.artifacts.some(artifact => artifactMatches(artifact, release))) fail('BUILD_RECEIPT_MISMATCH');
  if (source?.schemaVersion !== 1 || source.repository !== 'https://github.com/samar1tan/GitWorld' || source.tag !== release.tag || source.sourceCommit !== release.sourceCommit || !COMMIT.test(source.sourceTree || '') || !COMMIT.test(source.acceptedMainCommit || '') || !SHA256.test(source.lockfileSha256 || '') || source.toolchain?.platform !== 'darwin' || source.toolchain.architecture !== release.architecture || !text(source.toolchain.node) || !text(source.toolchain.packages?.electron)) fail('BUILD_SOURCE_MISMATCH');
  const install = source.installation;
  if (install?.schemaVersion !== 1 || install.method !== 'npm-ci' || install.isolation !== 'fresh-checkout' || install.exitCode !== 0 || install.sourceCommit !== release.sourceCommit || install.lockfileSha256 !== source.lockfileSha256 || !SHA256.test(install.dependencyTreeSha256 || '') || !SHA256.test(install.logSha256 || '') || !text(install.npmVersion) || !isDate(install.startedAt) || !isDate(install.completedAt) || Date.parse(install.completedAt) < Date.parse(install.startedAt) || Date.parse(install.completedAt) > Date.parse(receipt.completedAt) || 'checkoutRoot' in install) fail('BUILD_INSTALLATION_EVIDENCE_MISSING');
  return receipt;
}

export function validateAcceptanceReceipt(receipt, release, build) {
  if (receipt?.schemaVersion !== 1 || receipt.kind !== 'gitworld-acceptance' || receipt.contract !== ACCEPTANCE_CONTRACT || receipt.result !== 'passed' || receipt.tag !== release.tag || receipt.sourceCommit !== release.sourceCommit || receipt.buildReceiptSha256 !== release.buildReceipt.sha256 || receipt.buildId !== build.buildId || !artifactMatches(receipt.artifact, release) || receipt.platform !== 'darwin' || receipt.architecture !== release.architecture || receipt.signing !== release.signing || receipt.macOSVersion !== release.testedMacOS || receipt.testedAt !== release.validatedAt || !isDate(receipt.testedAt) || Date.parse(receipt.testedAt) < Date.parse(build.completedAt)) fail('ACCEPTANCE_RECEIPT_MISMATCH');
  if (!text(receipt.operator?.name) || !['human', 'agent'].includes(receipt.operator?.kind)) fail('ACCEPTANCE_OPERATOR_MISSING');
  const checks = receipt.checks;
  if (!Array.isArray(checks) || checks.length !== REQUIRED_CHECKS.length || new Set(checks.map(check => check.id)).size !== REQUIRED_CHECKS.length || REQUIRED_CHECKS.some(id => !checks.some(check => check.id === id && check.result === 'passed' && text(check.evidence, 20)))) fail('ACCEPTANCE_CHECKS_INCOMPLETE');
  const standalone = receipt.standalone;
  if (standalone?.result !== 'passed' || !['isolated-user-profile', 'clean-machine', 'clean-vm'].includes(standalone.environment) || standalone.codexRequired !== false || standalone.developerRuntimeRequired !== false || standalone.checkoutAccess !== false || standalone.developmentServerUsed !== false || standalone.modelServiceUsed !== false || standalone.backendEdits !== false || standalone.stateInjection !== false || standalone.interaction !== 'installed-gui' || standalone.installedFromSha256 !== release.sha256 || !Array.isArray(standalone.steps) || standalone.steps.length < 3 || !standalone.steps.every(step => text(step.action, 8) && text(step.observed, 8))) fail('ACCEPTANCE_STANDALONE_GUI_MISSING');
  const investigation = standalone.unscriptedInvestigation;
  if (!text(investigation?.topic, 3) || investigation.preparedInSeed !== false || investigation.codeChanged !== false || investigation.seedChanged !== false || !Array.isArray(investigation.steps) || investigation.steps.length < 3 || !investigation.steps.every(step => text(step.action, 8) && text(step.observed, 8))) fail('ACCEPTANCE_UNSCRIPTED_GUI_MISSING');
  if (!['passed', 'not-run'].includes(receipt.cleanMachineTest?.result) || !['human-study', 'not-run'].includes(receipt.usabilityStudy?.kind)) fail('ACCEPTANCE_EVIDENCE_LAYERS_MISSING');
  if (receipt.runtime?.electron !== build.source.toolchain.packages.electron || !text(receipt.runtime?.node) || !text(receipt.runtime?.sqlite)) fail('ACCEPTANCE_RUNTIME_MISMATCH');
  return receipt;
}
