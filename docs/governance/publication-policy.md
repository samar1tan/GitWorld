# Publication policy

GitWorld is intended to be freely and lawfully distributed as public source, a GitHub project website and complete local desktop packages. The current direction is macOS first, with Windows and Linux following. Running the installed product must not require a public application server. This policy controls what leaves the local workspace; it is not a claim that all planned release targets already exist.

Full filesystem access, a locally readable attachment, or permission to develop the project is not permission to publish it. Never use `git add .`, `git add -A` or a broad directory stage for publication. Stage an explicit reviewed list of files.

## Public and local material

| Material | Publication treatment |
| --- | --- |
| Original source, tests, schemas, migrations, configuration templates and English contributor documentation | Candidates for review under the project license; scrub real values and local paths |
| UI translations and original historical data | Publish with stable IDs, provenance and a declared license; English is the primary historical prose language, and translated UI/data text may use its intended language |
| Third-party code, fonts, maps, images and datasets | Review the exact work/version and applicable terms; retain required notices and record permitted uses and transformations |
| Public-domain material | Record why the exact work is public domain and the source of that conclusion; a site's availability is not proof |
| Chinese working discussions, internal PRD/UED drafts, chat transcripts/attachments, research notes, capture ledgers and QA screenshots | Local by default; prepare an independent, sanitized English public document or asset only when appropriate |
| Crawled raw pages, downloaded corpora and operational exports | Local/quarantined until terms, provenance, personal data and redistribution rights are reviewed; citation alone is insufficient |
| Live/user runtime databases, caches, user histories, logs, local preferences and backups | Never commit or bundle. Ship reviewed seeds/migrations; a pristine release seed database may be deterministically generated from licensed public inputs and reviewed as a release artifact |
| Passwords, tokens, private keys, provisioning profiles, signing credentials and private certificates | Never commit, attach to a PR, embed in a website, or bundle; use the release environment's protected credential mechanism |
| Installers and other executable binaries | Do not commit to source. Use a separate reviewed release-artifact process with contents, hashes, dependency notices and install evidence |

The Apache-2.0 repository license covers eligible project contributions. It does not relicense upstream assets, source quotations, game/mod data, proprietary databases, screenshots or fonts. Facts, editorial prose, images and database collections require distinct review. Do not import a game's historical dataset merely because its format is convenient.

## Exact publication gate

The standalone gate uses only Node.js built-ins and Git. It never stages, deletes, uploads or modifies files. It prints paths and finding codes, not detected secret values.

Prepare a local JSON manifest at `.local/publication-plan.json` after inspecting each candidate. List exact repository-relative regular-file paths, SHA-256 digests, category, license and a human-readable rights basis. Globs, traversal, duplicate paths and symlinks are rejected. A reviewer identifier names the responsible role/run; it does not certify human review.

```json
{
  "version": 1,
  "review": {
    "reviewer": "Quinn / review identifier",
    "scope": "Reviewed source change; local working documents excluded",
    "reviewedAt": "2026-10-25"
  },
  "files": [
    {
      "path": "src/example.ts",
      "sha256": "replace-with-the-64-character-sha256-of-the-reviewed-bytes",
      "category": "source",
      "license": "Apache-2.0",
      "rights": {
        "origin": "original",
        "basis": "Original implementation authored for GitWorld; no copied upstream code",
        "reviewed": true
      }
    }
  ]
}
```

Supported categories are `source`, `test`, `configuration`, `documentation`, `localization`, `data` and `asset`. Documentation must be English; source titles and short quotations in their original language need an explicit `languageException` reason when the scanner flags them. Localization resources and licensed data may contain multilingual text. For third-party or mixed-origin files, `rights.source` must identify the upstream work, `rights.evidence` must identify its permission/license evidence, and `rights.notices` lists included notice files. Asset and data entries always require these provenance fields, including for original authored data (use `original:GitWorld` as the source and explain authorship in the evidence).

For an approved passive raster/font asset, also set `rights.metadataReviewed: true` after checking for embedded metadata and private details. Text SVG is inspected for active content and remote references. Passive asset checks validate basic container structure and declared review evidence, not the safety of every decoder or the truth of a metadata review. Executable/archive/database formats are rejected even when included in a manifest. Do not relabel an asset as source to evade review.

```sh
node scripts/publication-audit.mjs --prepared --manifest .local/publication-plan.json
# Stage only the reviewed explicit file paths, then inspect the actual index.
git diff --cached --stat
git diff --cached --check
git diff --cached
node scripts/publication-audit.mjs --staged --manifest .local/publication-plan.json
node --test scripts/publication-audit.test.mjs
```

Prepared mode reads the named working files. Staged mode reads Git index blobs and verifies that the staged changed paths exactly equal the manifest, including deletions. A deletion uses `"action": "delete"` and needs no content hash. Removing a license file is separately blocked for owner review; preserve an applicable license or resolve the proposed replacement explicitly before publication. No staged changes is a failure, not a successful review. A changed hash, unexpected staged path, missing file, private material, probable credential, forbidden binary or incomplete rights entry fails closed. Review the prepared-to-staged transition; changing a worktree file after staging does not change the bytes about to be published.

The manifest is local by default and is never a credential store. Do not auto-generate a blanket “approved” manifest and call that review. A successful scan verifies mechanical conditions, not the truth of license assertions, absence of every secret, historical accuracy, Git history safety or owner authorization. Inspect previous commits before publishing a branch with an unreviewed history. Do not bypass a failed gate by editing the scanner or renaming a forbidden file; resolve the evidence or exclude the file.

## Data operations

Ingestion should retain source identity, retrieval date, transformation history, permission/terms evidence, claim-level citations and review status. Crawling access and redistribution permission are separate questions. Respect source access rules and avoid collecting personal information that is not needed for the historical product. Keep raw ingestion and runtime stores outside public source; publish original authored records or licensed distributable datasets with their notices, schema and validation results.

New accepted data must enter the same storage and query paths used by the workbench and commands. A publishing restriction must not become a reason to hardcode a few demonstrations or exclude all data from source control. Public release seeds must be reproducible from the reviewed inputs; user databases and unreviewed crawl results must not be used as seeds.

## Desktop and website release review

Before a release upload, Quinn and Morgan review the exact archive/package contents and hashes, dependency and asset notices, packaged seed-data provenance, absence of user databases/configuration/secrets, renderer/native privileges, local service exposure, and an install/launch/uninstall or recovery check on the stated platform. Signing and notarization claims require actual evidence. An unsigned local build must be labeled accurately; never claim notarization or cross-platform validation that did not occur.

The source gate intentionally rejects installers. A release workflow must have its own artifact allowlist and isolated packaging step, carry forward this rights/privacy review, and upload only the reviewed artifact hashes. Do not broaden the source gate to admit arbitrary binaries. The GitHub website contains sanitized public product information and distributable assets, not internal review notes or an exposed local data-management service.

## CI and incident handling

CI should run the audit tests and normal build/data checks on unprivileged pull requests. Add a publication check against the exact committed candidate list or reviewed artifact manifest before a release; do not expose signing credentials or write tokens to untrusted PR code. Required checks and environment protections must be configured and verified before claiming enforcement. The script alone is a local gate, not a GitHub branch-protection rule.

If a secret is discovered, stop the affected publication, notify the owner privately, rotate or revoke it using the authorized credential workflow, and assess all already-published copies. Deleting the latest file does not remove Git history, caches or release assets. See [SECURITY.md](../../SECURITY.md). Rights disputes similarly block the affected material while unrelated local work continues.
