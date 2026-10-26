# Desktop distribution requirements

Revision **v0.2** · Product scope **v0.1** · 26 October 2026

GitWorld must distinguish an available package from a verified user experience. The primary delivery remains a standalone macOS Apple Silicon application. Additional desktop targets may be distributed experimentally when their actual build, runtime, dependency and rights checks are recorded. An experimental download is not a claim that the complete installed acceptance case passed on that platform.

## User outcome and scope

Users can identify the correct architecture, see where a package was actually tested, install it without a developer checkout or system Git, and retain their local library. Release notes and the README must name the tested operating system and environment. Do not describe an untested architecture as universally supported.

- **macOS Apple Silicon:** the primary candidate requires the complete installed acceptance contract and exact-artifact review.
- **macOS Intel:** add a native Intel CI build and engineering checks using an explicit Intel runner. Publish a separately named candidate only after its contents, hashes, notices and actual runtime results are reviewed. Without the complete ordinary-user journey, label it experimental and state that limitation.
- **Linux x64:** this release may produce experimental `tar.gz` and `deb` candidates built and run natively on GitHub's Ubuntu 22.04 runner. The job must build the bundled Git, require its integration tests, and run both development and packaged Electron smoke checks under Xvfb with the Chromium sandbox enabled. This does not establish testing on another distribution, architecture, desktop session, or the complete ordinary-user GUI journey.
- **Windows:** deferred from this release. The existing Git build/runtime recipe, POSIX paths and directory-sync durability assumptions require a separately verified port. Do not publish a Windows package merely because Electron can generate one.

These declarations belong in distribution documentation. They do not add unavailable controls or future-platform entries to the application.

## Build and package contract

1. Every candidate identifies a clean, accepted source commit and immutable version tag. A source correction after tagging requires a new version; an older tag or installer must not be silently replaced.
2. Product construction uses the isolated build entry, a fresh checkout and dependency installation. Each architecture records its own toolchain, dependency tree, build ID, ASAR and installer hashes. One architecture's receipt cannot stand in for another.
3. Ship the required local runtime and exact corresponding Git source and notices. Review code injected by build tools as well as imported runtime modules; retain the applicable Vite, Rolldown and esbuild runtime-helper notices. Review the installer root as well as the application: the default DMG background is a distributed `dmg-builder` template and retains its applicable MIT notice. Do not assume an entire build tool is distributed merely because one helper or asset is emitted.
4. The declared minimum operating system must accommodate every bundled executable. The current bundled macOS Git requires macOS 14.0; matching installer metadata does not establish testing on every later macOS release.
5. A packaged engineering smoke check must execute the packaged binary and must not download an unused development Electron binary or mutate the recorded dependency tree. Its bounded overall deadline must accommodate the service's 180-second initialization budget and renderer checks; use 210 seconds and report an actual harness timeout explicitly. A late receipt cannot turn a timed-out process into a pass. This budget is an engineering check limit, not a measured user startup promise. Keep that check separate from the ordinary installed GUI journey.
6. CI builds run with read-only repository permissions and upload candidates for review. They do not automatically publish releases or create passing installation receipts. Do not expose release credentials to candidate code.
7. Signing, notarization, native installation, GUI, recovery and clean-machine results are independent facts. Report actual outcomes, including unsigned artifacts and checks that were not run. Preserve the existing user's library during testing.
8. Keep platform security claims specific. The existing macOS package applies embedded ASAR integrity validation; the Linux experiment must preserve Electron sandboxing and supported fuses without claiming the same platform-specific integrity capability. Do not disable the sandbox or alter host kernel security settings to obtain a passing CI result.

## CI and candidate construction

The [desktop checks](../.github/workflows/desktop.yml) add an explicit `macos-15-intel` native job and an Ubuntu 22.04 x64 experimental runtime job alongside the existing source and Apple Silicon checks. A source-only job that skips missing native Git tests is not runtime evidence for an additional platform.

The manual [candidate workflow](../.github/workflows/desktop-candidates.yml) must first be merged into default `main` before GitHub permits dispatch. Run it from `main` with an immutable tag already accepted into remote `main`. Each native runner uses the same isolated release entry, including a fresh clone and `npm ci`, then requires the bundled Git tests and packaged smoke. Development smoke stays in ordinary CI because importing development Electron can download files and change the recorded dependency tree. Before uploading, recompute the complete dependency-tree hash with the production provenance implementation and require it to match the installation proof. Read-only permissions and non-persisted checkout credentials remain in force. Only exact installer files and a sanitized engineering/build summary are uploaded as short-lived workflow artifacts; no user library, raw log, checkout path or installed acceptance receipt is uploaded. A failed target uploads no candidate. This workflow does not publish a Release or supply the primary macOS artifact's 63-condition acceptance.

## Public preview distribution

A reviewed Apple Silicon candidate may be made available as an explicitly marked GitHub **prerelease preview** before the complete installed acceptance matrix is closed. Its exact contents, source/build identity, rights, notices, privacy, signing status and packaged runtime must already be reviewed. The ordinary installed software-managed acquisition, adoption, editing, frozen staging, commit and complete-library recovery journey must have actual evidence; seeded examples or backstage writes cannot substitute for it.

The prerelease must include a sanitized acceptance-status record that preserves partial and not-run results, including an unperformed network-isolation test. It must not claim full acceptance, a verified stable release or completion of untested conditions. Experimental Intel/Linux scope and unsigned/not-notarized macOS status remain explicit. This preview does not change the existing 63-check passing-receipt contract: `site/release.json` stays `null`, and the verified-download/site workflow stays disabled until the complete required receipt and verification chain pass.

## Verification and delivery

For each available target, record the source/tag, operating system, architecture, build and artifact identity, test commands and results, native runtime/Git checks, signing status, and the scope of installation/GUI/recovery testing. Include an explicit untested or experimental status where appropriate. Source tests or a CI process are not a human usability study.

Verified primary macOS delivery still requires all 63 existing acceptance conditions and the source/build/installer/site verification chain. Additional experimental artifacts use their own evidence; they cannot borrow the primary artifact's installed receipt. A release may link to the verified Apple Silicon download and separately describe reviewed experimental candidates.

The [main PRD](PRD.md), [desktop build instructions](../apps/desktop/README.md), [publication policy](governance/publication-policy.md) and [current UED](UED.md) remain applicable. The shared workbench interaction does not change merely to add an architecture. Native visual changes require rendered and operational review on the affected platform before they can be described as verified.
