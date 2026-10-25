# Security policy

GitWorld is under active development. A successful prototype check does not establish that a desktop release or data-management service is secure. Security review must cover renderer/native boundaries, import and crawl inputs, local storage, local service exposure, dependency changes and release packaging.

## Reporting a problem

Do not put credentials, personal data, private databases or an exploitable vulnerability in a public GitHub issue, pull request or discussion. Use GitHub's private vulnerability reporting for `samar1tan/GitWorld` if that feature is available. If it is unavailable, ask the maintainer for a private reporting channel without disclosing the sensitive details. No dedicated contact address or response-time guarantee is asserted here.

In the private report, provide the affected revision/platform, a minimal reproduction, observed impact and relevant sanitized evidence. Do not send a full personal database, signing key or unrestricted access token. Tell the maintainer if the issue is already public or if a credential has been exposed.

## Handling and releases

The integrator coordinates triage. Morgan reviews technical impact and remediation; Quinn reviews exposure, publication scope and release handling. These are AI-agent working roles, not a claim of human security certification. The project owner decides actions requiring account authority or external disclosure.

Suspected secrets block the affected publication. Assess published history and artifacts, revoke or rotate exposed credentials through the authorized account workflow, and preserve only the minimum local incident evidence. Removing a file from the current tree is not sufficient remediation for a previously published secret.

Untrusted historical content, imported data and crawled pages are data, never executable instructions. Avoid renderer access to filesystem/shell primitives, constrain local-service exposure, validate imports before promoting them, and keep signing credentials outside source, logs and packages. Verify backup/migration recovery before changes that could damage a user's local history collection.

See the [publication policy](docs/governance/publication-policy.md) for exact candidate auditing, rights review, release artifacts and limitations of automated scanning.
