# ADR 0002: bundled Git data revisions and explicit historical models

Date: 25 October 2026. Status: implemented foundation; product acceptance incomplete.

GitWorld's primary value is mapping historical structured data into states and changes that can be checked out, compared and traced. These historical relations are domain content. A modern edit to that content has a different time and meaning.

Use an application-owned standard Git repository for modern data revisions. It holds source-backed objects and assertions, modeling content, mapping baselines and lightweight research records. It has one repository HEAD and a real index. Staging B then editing C must commit B and leave C as a working change. A coherent content increment is a commit; ordinary navigation and clicks do not create commits.

The pure historical/knowledge models retain their own supported continuity, influence and temporal semantics. A data commit's parent is not a polity's ancestor. Repository timestamps cannot supply historical dates. Historical state references and A/B include their data revision and do not silently follow later commits.

## Runtime and responsibility

Build the pinned Git source with the reviewed recipe in [build-bundled-git.mjs](../../scripts/build-bundled-git.mjs). The macOS installer includes the runtime outside ASAR, its notices, exact corresponding source archive and recipe. It does not use the end user's PATH or require Xcode/Command Line Tools. Network transport is disabled in this runtime; public data acquisition uses explicit provider adapters.

The local service controls argv, configuration, allowed content paths, refs and concurrency. The renderer has semantic operations, not arbitrary process or filesystem access. External repositories and their config/hooks/filters are not imported. External Git clients are not a release requirement.

Git owns content objects, index and refs. SQLite coordinates application operations and retains the earlier package/workspace store. An operation intent and expected ref/tree checks make retries and recovery explicit; there is no claim of Git/SQLite cross-store atomicity. Derived views read immutable trees or a coordinated working snapshot. A working preview is labeled working and cannot masquerade as an already committed OID.

Full backups include SQLite, the repository, index, working content, operation receipts, acquired source material and research records. The restore format validates paths, hashes and database integrity before installation, journals directory exchange and rolls back interrupted or rejected installs. A legacy SQLite-only backup cannot silently replace a Git-backed library.

## Evidence and remaining work

The [repository tests](../../packages/storage/src/editorial.test.ts) exercise actual bundled Git, staging, concurrent ref changes, branch/detached behavior, reverse operations and process termination recovery. The [content integration tests](../../packages/service/src/content-integration.test.ts) exercise mapped state queries and research changes over committed content. These use explicitly synthetic transport fixtures; they do not establish historical coverage or user learning.

Real-source corpus checks, automatic mapping review, meaningful China/Japan content, both locales, GUI/command parity, editable Figma synchronization and actual installer acceptance remain separate requirements. Successful foundation tests do not authorize a release.
