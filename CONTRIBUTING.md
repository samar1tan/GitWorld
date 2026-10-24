# Contributing to GitWorld

GitWorld is a history workbench built around branches, recorded states, comparison and provenance. The delivery direction is a self-contained local desktop application: macOS first, with Windows and Linux to follow. The existing browser prototype is one development artifact, not the completed desktop product.

Use GitHub Issues for reproducible problems and scoped proposals, pull requests for changes, and GitHub Actions for executable checks. Public issues, documentation, commits, reviews and code comments use English. UI resources support English and Simplified Chinese; historical data uses English as its primary authored language with translations kept separate from stable identifiers.

## Before changing code or data

Read [AGENTS.md](AGENTS.md), the public product documentation and [the team review model](docs/governance/agent-team.md). Agree on the object, behavior and acceptance evidence for a substantial change. Programming familiarity does not imply Git expertise: core journeys need both discoverable graphical actions and equivalent supported commands. Do not introduce disconnected AI controls or future-feature placeholders.

Keep interface messages, historical prose/citations and domain state separate. Domain APIs return structured results and error codes. New data must be discoverable through the ordinary workbench and command paths after validation; avoid branches of UI code tied to a particular demo record.

Historical contributions must identify sources, explain modeling choices and uncertainty, and distinguish a last recorded change from a historical origin. Inherited values are model carry-forward, not new historical confirmation. A citation establishes evidence for a claim, not permission to redistribute a source's prose, images or dataset.

## Validation

For the current prototype:

```sh
npm --prefix prototype ci
npm --prefix prototype test
npm --prefix prototype run build
node --test scripts/publication-audit.test.mjs
```

Add focused tests for meaningful behavior and failure recovery. Inspect UI changes in both languages at representative desktop sizes. Report the checks that actually ran, including platform and packaging limits. A passing build is not evidence that a desktop installer works. Follow the current package's documented commands as the implementation expands.

## Pull requests and licensing

Describe the concrete problem and resulting behavior, with relevant validation and remaining limitations. Include data and dependency provenance where applicable. Do not paste private conversations, attachments, local paths, raw operational logs, credentials or user databases into issues or PRs. State material AI assistance and who or what reviewed the change without inventing human reviewers.

Project contributions are submitted under [Apache-2.0](LICENSE), unless an explicitly approved file-specific license applies. Preserve third-party notices and do not claim ownership of upstream works. Do not add a dependency, asset or dataset without checking the exact version's distribution terms.

Follow the [publication policy](docs/governance/publication-policy.md): inspect and stage exact files, prepare a reviewed hash-bound manifest, and run the gate against the staged bytes. Never stage the workspace wholesale. The policy intentionally allows licensed data, schema and seed contributions while excluding local operational data. Maintainers must also inspect the branch history and public release contents.

Report possible vulnerabilities through [the security process](SECURITY.md), not a public issue containing exploit details or secrets.
