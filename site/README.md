# Project website

This is a small static project site, separate from the installed desktop application.
English is the initial language. Both locales offer Frankish partition, China/Japan
planning influence and Abbasid court moves. China/Japan is the initial case in both
languages. `?lang=zh-CN&case=abbasid-court` opens that Chinese case directly.
Language switching preserves the active case, selected record and comparison pair.

The graph's record buttons update a source-backed inspector; A/B controls compare
actual modeled fields. The build bundles the reviewed seed and the same snapshot/
comparison engine used by the desktop app through the existing esbuild dependency.
These are bounded read-only examples, not a writable collection or a simulated Git
repository. Desktop commands follow the selected record and pair. No new records,
LLM call or application server is needed. See the
[website requirements](../docs/project-website-prd.md).

The header and footer reuse the desktop icon sources in `apps/desktop/resources`;
the build copies their master and optical small variants to local website assets.
Keep those canonical sources aligned rather than introducing a separate placeholder.
Artwork is original SVG. Inter is local with its OFL notice. No analytics,
external font service or remote application code is loaded.

```sh
node site/build.mjs
python3 -m http.server 4180 --directory site/dist
node --test site/examples.test.mjs site/release.test.mjs site/verify-release.test.mjs
```

`release.json` stays `null` until an actual installer passes acceptance and its
reviewed assets are published. The null state has useful source and documentation
links and no invented download. Internal builds and runtime smoke cannot authorize
release metadata. A site build checks metadata shape; deployment additionally
runs the online verifier. No push event deploys the site.

## Non-circular release evidence

Three independent assets belong to the same owned GitHub Release:

1. The DMG, built from the clean, tagged source already included in `main`.
2. `GitWorld-<tag>-<arch>-build.json`, written by the product packager after the DMG.
   It binds source commit/tree, remote main observed at build, lockfile/tool versions,
   fresh-checkout npm-ci evidence, installed dependency-tree hash, prepared output
   manifest hash, ASAR hash, architecture and final DMG bytes/hash.
3. A reviewed `GitWorld-<tag>-<arch>-acceptance.json`, recorded **after installing that
   exact DMG**. It binds the build receipt's SHA-256 and the same source/tag/DMG.

The final acceptance receipt is not embedded in the source commit or DMG. This
avoids requiring the artifact's future hash inside its own build inputs. Publish
sanitized evidence only after rights/privacy review; local profiles, raw captures
and machine paths are not required public evidence. Receipt validation cannot
establish that a person actually performed the recorded actions, and hashes are
not signatures or a substitute for independent review.

The site metadata is a JSON object with `tag`, `sourceCommit`, installer `url`,
`sha256`, `bytes`, `architecture`, `signing`, `testedMacOS`, `validatedAt`, plus
`buildReceipt` and `acceptanceReceipt`. Each receipt descriptor has its exact
owned Release asset `url`, `sha256` and `bytes`. Both JSON receipts are capped at
512 KiB. `signing` is `unsigned` or `signed-notarized`; it must match both receipts.
The current packager only produces unsigned, unnotarized builds.

The online verifier rejects draft releases, missing or ambiguous assets, tag/source
mismatches, a source tree differing from GitHub and a source not contained in
current `main`. It resolves the exact `refs/tags/` reference and bounded annotated
tag chains; a same-named branch cannot substitute for the release tag. It downloads
and hashes both receipts, validates their content, then streams and hashes the DMG. GitHub API
credentials are never sent to asset hosts. It does not execute downloaded code.
The public evidence link points at the acceptance receipt, not a pre-build promise.

## Acceptance receipt contract

`receipt-validation.mjs` defines schema version 1 and contract `desktop-v0.1`.
A receipt contains:

- `kind: "gitworld-acceptance"`, `result`, `tag`, `sourceCommit`, `buildId`, and
  `buildReceiptSha256`.
- `artifact: {name, sha256, bytes}` identifying the tested DMG; `platform: "darwin"`,
  `architecture`, `signing`, `macOSVersion`, `testedAt` and actual `runtime`
  (`electron`, `node`, `sqlite`). The test occurs after the build completes.
- `operator: {kind: "human" | "agent", name}`. Agent GUI operation is not a human
  usability study, professional certification or independent human approval.
- One check for every D01–D15, M01–M15, J01–J06, S01–S06, N01–N09 and C01–C12 requirement, each with `id`, `result` and
  concrete `evidence`. A missing, duplicated, failed or unrun check blocks release.
- `standalone` with a passing installed-GUI investigation: `environment` is an
  `isolated-user-profile`, `clean-machine` or `clean-vm`; `interaction` is
  `installed-gui`; `installedFromSha256` matches the DMG. `codexRequired`,
  `developerRuntimeRequired`, `checkoutAccess`, `developmentServerUsed`,
  `modelServiceUsed`, `backendEdits` and `stateInjection` must all be false.
  Its `steps` record ordinary app actions and observed results, not hidden scripts.
- `standalone.unscriptedInvestigation` records the actual `topic` and app `steps`;
  `preparedInSeed`, `codeChanged` and `seedChanged` must be false. An operator must
  complete a topic not prepared in the seed through shipped controls. No agent
  editing JSON, adding fixtures, calling a hidden service or injecting UI state
  can substitute for this journey.
- Separate `cleanMachineTest.result` (`passed` or `not-run`) and
  `usabilityStudy.kind` (`human-study` or `not-run`) disclose evidence not supplied
  by ordinary native GUI testing. An installed Codex or developer tool on the host
  is not itself a failure: the application must operate without depending on it.

Every step is `{action, observed}` with enough detail for another operator to
repeat it. The automated schema checks completeness and consistency, not truth.
Settings uses S01–S06; Scope uses N01–N09. The unreleased `desktop-v0.1`
contract requires 63 distinct checks, including Guide J06 and all nine Scope
checks. A receipt containing only the earlier 53 IDs is incomplete; Settings
results cannot stand in for Scope results. This synchronization keeps schema
version 1 and supplies no acceptance evidence.
Keep unperformed checks `not-run`; do not fill them from a unit test or smoke run.
Synthetic records in test modules test rejection behavior and are never real
acceptance receipts. No actual receipt or release is supplied by this source.

The verified-release workflow fails closed while metadata is absent. The separate,
manual preview workflow requires null metadata and links to the public preview
without claiming complete installation acceptance. Both publish only `site/dist`
through `github-pages`.
Repository/environment protections must be separately configured and verified;
these files do not establish that review policies are enforced remotely.
