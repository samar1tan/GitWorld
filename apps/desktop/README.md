# Desktop host

The desktop host runs the renderer in a sandboxed Electron window and the local
data service in a utility process. No public application server is required.
The checked-in source is not an installer; build outputs stay under ignored local
directories until a release review is complete.

## Development and checks

Use Node.js 24 or 26 with npm. Electron has an independently pinned Node runtime.

```sh
npm ci
npm run typecheck
npm run build
GITWORLD_REQUIRE_BUNDLED_GIT_TESTS=1 npm test
npm run desktop:smoke
npm run dev
```

For an isolated development library, pass an absolute path with
`--gitworld-user-data` to `electron apps/desktop`. This argument is ignored by
packaged applications. The development window identifies the profile by its
directory name. Do not point QA at a personal library.

The first window fits a 1600×960 target within the current display's work area.
The native View menu provides Command/Control plus, minus, and zero for zoom and
actual size. Window bounds and user zoom are stored in the local profile; invalid
or off-screen settings are clamped on the next launch. HiDPI rendering is left to
Chromium, with no forced device scale or initial zoom.
On macOS, the workbench shares an inset native title bar. Preload exposes only
the public platform identifier and adjusts the native control clearance when
page zoom changes; it does not counteract the user's text zoom. Dragging, title-bar
double-click behavior, and full screen remain native window behaviors.
The preload measures a marked first-row title anchor after layout and reports only
its vertical center through an internal channel. The trusted main frame is
required; the host applies its own zoom factor, fixes the horizontal position and
clamps the native vertical position to the upper window area. Full screen uses
the system's default control placement; leaving it reapplies the current anchor.

`build` bundles the main process, sandbox-compatible CommonJS preload, and utility
process. It builds `renderer/index.html` with Vite when that application exists.
An explicitly labeled internal integration page is available while the renderer
is being connected; it cannot pass the product packaging gate.
Product packaging additionally requires `renderer/build-ready.json` to declare
`{"ready":true}` after the renderer's acceptance checks pass; entry-file presence
alone does not mark an incomplete renderer as ready.

The runtime smoke launches the real Electron binary with a temporary user-data
directory. It checks `node:sqlite` inside the utility process, a database write/read,
SQLite integrity, renderer isolation, and malformed IPC rejection. Its local
receipt records the actual Electron, Node, and SQLite versions.
The check also verifies the exact exposed bridge methods and the preload's
platform and native title-bar measurements in the sandboxed renderer, then waits
for the renderer's close-preparation acknowledgement before stopping the service.
On macOS it also checks actual native button positions at 100%, 200% and 75% zoom,
then returns to actual size. These geometry checks do not replace visual review.
It also initializes the real local service in that temporary directory and checks
that the packaged seed is imported, published and active through the ordinary data
pipeline.

## Local macOS packaging

The application uses [original SVG artwork](resources/README.md), rendered to PNG
with a pinned vector renderer and assembled into ICNS by macOS `iconutil`.
`npm run desktop:icon` regenerates the previews independently of packaging.

```sh
npm run desktop:package:internal
npm run desktop:smoke:packaged
# From a clean checkout after the exact tag is published and included in main:
# Replace the example tag with the reviewed package version.
node apps/desktop/build-release.mjs --tag v0.1.1
# Run packaged smoke from the returned isolated checkout.
```

Internal builds produce a clearly named application directory for engineering
checks. Product builds additionally require a clean tagged source already included in
remote main, matching package version and installed pinned build tools. The
renderer and data service must both be connected and ready. Packaging writes to `.local/releases/`, never uploads, and disables
certificate discovery. Builds are **not Developer ID signed or notarized**.
macOS may prevent an unsigned build from opening normally. Ad-hoc signing needed
for modified Electron fuses is not publisher identity verification.
Each internal build uses a separate build-ID profile under `GitWorld Internal QA`
in the operating system's application-data directory. Reopening the same build
retains that QA library. Rebuilding does not replace a personal GitWorld library.

The packaged smoke runs the actual ASAR application, not an extracted development
entry point. It verifies that the bundled runtime supports SQLite after the
supported security fuses have been applied. Platform results must be recorded on
the actual host; a macOS smoke result cannot establish Linux or Windows behavior.

## Native CI and experimental candidates

[Desktop CI](../../.github/workflows/desktop.yml) preserves the existing macOS
checks and adds a native `macos-15-intel` job and an experimental Ubuntu 22.04 x64
job. Both build their own bundled Git and require its integration tests before
running development and packaged Electron smoke. Ubuntu uses Xvfb and the
Chromium sandbox; no sandbox-disabling argument or kernel-security change is
part of the check. Source-only tests that skip unavailable Git integration tests
do not count as native runtime verification.

The manual [candidate workflow](../../.github/workflows/desktop-candidates.yml)
must be merged into default `main` before it can be dispatched. Run it from
`main`, supplying the accepted immutable `release_tag` (for example `v0.1.1`).
The tag must already be on remote `main` and match the package version. Each
Intel macOS or Ubuntu runner uses `build-release.mjs`'s isolated production entry:
fresh clone, `npm ci`, native build and packaging. It then requires the bundled
Git tests and packaged smoke, and rechecks the complete dependency-tree hash
against the installation proof before collecting artifacts. Development smoke
stays in ordinary CI so its Electron import cannot download files into the
recorded product dependency tree. Workflow artifacts contain only exact
installers and a sanitized engineering summary, retained for 14 days. They are
review candidates, not an automatically published Release or an installed
acceptance receipt.

Linux candidates are limited to experimental x64 `tar.gz` and `deb` packages
tested on Ubuntu 22.04. Other distributions, desktop sessions and architectures
remain unverified. Windows is deferred. Intel and Linux candidates cannot borrow
the primary Apple Silicon artifact's 63-condition installed acceptance; state
the actual CI environment and remaining GUI/installation checks with each
download. See the [distribution PRD](../../docs/desktop-distribution-prd.md).

## Trust boundaries

- The renderer has no Node integration, filesystem API, generic IPC channel, or
  remote navigation. Application content is served through `gitworld://app/`.
- The preload exposes typed service requests, progress subscriptions, four native
  file-selection purposes, and explicit HTTPS link opening. Main-frame origin and
  request validation are enforced again in the host and utility service.
- Native file dialogs issue expiring, purpose-bound opaque tokens. Only the host
  and utility service see absolute paths. Selecting an export destination cannot
  authorize an import or backup operation.
- Browser permissions, downloads, popups, embedded webviews, and renderer network
  traffic are denied. Source acquisition belongs to the data service's reviewed
  acquisition pipeline.
- The host waits for the service to close on normal quit, with a bounded fallback
  if the child does not respond. Runtime stores belong in Electron's user-data
  directory; they are not packaged or published.
- Window close and application quit first wait for coalesced workspace writes.
  The preload keeps close-request identifiers private and ignores late replies
  after cancellation. A failed save or timeout keeps the window open and offers
  retry. Unsubmitted form changes require an explicit discard choice; keeping the
  editor open is the default. Only then does the host stop the local service.
- A single-instance lock is acquired for the selected profile before database
  initialization. A second launch focuses the existing window instead of opening
  another writer while a restore might replace its database.
- Run-as-Node, Node option injection, CLI inspector arguments, and extra file
  protocol privileges are disabled in packaged binaries. ASAR-only loading and
  integrity validation are enabled.

Follow [the publication policy](../../docs/governance/publication-policy.md) before
staging source or distributing builds. Automated checks do not establish content
rights, review historical claims, or authorize publication of private material.

## Source-to-installer provenance

For an actual product build, fetch `origin/main` and tags and use
`node apps/desktop/build-release.mjs --tag <reviewed-tag>`. The entry point verifies
the clean accepted source, clones the owned repository into a new ignored local
checkout, checks out the exact commit, and runs `npm ci` there before invoking
build/packaging with `GITWORLD_RELEASE_TAG`. It does not reuse the calling
checkout's node_modules. Dependency installation failure stops the pipeline. The tag must already resolve
on the owned GitHub repository to the checkout commit, which must be included in
main. A stale local `origin/main` requires a fetch; the gate does not silently
change the checkout. These ancestry checks do not replace PR review or prove
branch-protection settings. Ordinary development/internal builds need no tag.

The product build rejects staged, unstaged and non-ignored untracked changes,
hidden index flags, symlinks/submodules, mismatched package versions and installed
build-tool versions. A private install receipt records the real npm-ci command,
source/lock hashes, npm version, log hash and complete installed dependency-tree
hash. Build and packaging recheck that tree, including relative internal symlinks,
so matching version labels cannot hide changed transitive files. Absolute/private
checkout paths are removed from public build metadata. It records source commit/tree,
lockfile SHA-256 and actual build toolchain, clears generated dist, builds, then hashes every regular output
file. `.local/desktop-build-provenance.json` is a local sidecar, outside the app.
A release-ready marker is part of the reviewed source when product readiness is
established; an untracked marker cannot authorize a clean release build.

Packaging rechecks the source and exact output set before and after building the
DMG. Changed/extra output files, old dist from another commit, dirty source or a
moved tag fail closed. The packager does not rewrite build metadata to relabel an
internal build as a product. Output receipts bind the final DMG and ASAR hashes to
the prepared build, and contain no user database or machine-specific paths.
Future bundled native dependencies must add their exact source/binary/license
materials to this chain; bundled Git is not assumed implemented by this gate.

The generated build receipt is engineering evidence, not installation acceptance.
A separate post-install receipt must record the exact DMG, standalone native GUI
use of a non-preset topic, all required checks and truthful signing status. It is
published alongside the DMG only after review, never embedded in its own source
commit. See the [site release contract](../../site/README.md). `release.json` stays
null until real acceptance exists. No script fabricates passing acceptance.

Targeted checks use temporary synthetic repositories and mocked release responses:

```sh
node --test apps/desktop/src/release-provenance.test.mjs apps/desktop/src/build-release.test.mjs site/release.test.mjs site/verify-release.test.mjs
```
