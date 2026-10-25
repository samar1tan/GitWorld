# GitWorld

A desktop world-history workspace built around Git’s state and version abstractions.

GitWorld is a macOS-first local desktop project built around historical states, commits, branches, and diffs. Follow a historical path, check out a recorded state, compare it with another, and trace a field back to its evidence. It is designed for history learners and enthusiasts with some programming or AI-tool experience.

GitWorld is also the first major foundation of a broader world-history series. Git's model of collaboration and branch development could eventually let contributors extend historical coverage and develop new civilization branches together. The initial experience establishes the objects and operations for that work.

The intended [learning workflow](docs/learning-workflow.md) is to choose a question, build a useful local collection, compare recorded states, inspect evidence, save an interpretation and return to revise it. Git records changes to both the adopted model and the learner's research record. This complete loop is still under implementation; fixed examples and a large raw archive do not establish it.

The delivery target is a self-sufficient desktop application: no Codex, model subscription or developer environment is required for normal installed use. Public data discovery uses source APIs; exploration and editing use local records. Reusable queries and views must work on newly imported subjects, not only on prepared examples. The [data model](docs/data-model.md) separates source records, assertions, historical objects, states, continuity paths and views, and identifies the remaining implementation gaps.

**Status:** The desktop source implements local acquisition/import, reviewed working changes, frozen staging and commit in one workbench; see the [module requirements](docs/data-workspace-prd.md) and [interaction design](docs/data-workspace-ued.md). A bundled standard Git repository owns current objects, model packages, research and navigation metadata; SQLite retains drafts, legacy releases, workspace state and operation coordination. A retained historical model contains **14 branches and 38 recorded versions**, including a split, multi-parent integration, separate influence links, uncertain dates and BCE records. Newly adopted objects and valid model content use the ordinary local exploration paths without an application rebuild. See the [public PRD](docs/PRD.md) for the acceptance contract and [desktop guide](apps/desktop/README.md) for development and runtime checks. Implementation does not establish complete content or installed acceptance.

Installer acceptance and distribution are still in progress. No Developer ID signing, notarization, Windows/Linux validation or completed user study is claimed. The [frozen browser prototype](prototype/README.md) remains available as an earlier UED baseline; its 8 branches and 28 versions do not define the desktop's content or feature limits.

China and Japan across their histories are a product starting point and the [complete v0.1 acceptance case](docs/acceptance/china-japan-v0.1.md). The case covers independent exploration, data acquisition, comparison, contribution and recovery; it remains unpassed until the installed workflow is verified.

Release evidence must cover [desktop D01–D15](docs/PRD.md#11-acceptance-matrix), [data-workspace M01–M15](docs/data-workspace-prd.md), [Guide J01–J06](docs/onboarding-prd.md), [Settings S01–S06](docs/settings-prd.md), [Scope N01–N09](docs/scope-workspace-prd.md#required-evidence-before-delivery) and [China/Japan C01–C12](docs/acceptance/china-japan-v0.1.md). Settings and Scope have distinct acceptance IDs; source tests do not supply installed-app receipt results.

## Find your bearings, then follow a path

Start with available local material, choose a research context, kinds and time window, then deepen into an object or historical model. The workbench connects that wider setting to recorded states, evidence, comparison endpoints and an in-app terminal. A browsing context organizes material; it does not invent an ancient polity or historical event.

Keep four pieces of context distinct:

- **Browsing scope:** the context, filters and Working or fixed data revision being queried. Opening an object or previewing a state does not check it out.
- **Repository HEAD:** the actual Git commit for modern data contributions. Working files and the frozen index can differ from it.
- **Historical checkout:** an object/year or model/ref pinned to a data commit; model states replay parents and recorded changes, while object states project sourced assertions. Checking it out leaves repository HEAD unchanged.
- **Comparison A and B:** two qualified historical endpoints, each with its own data OID. Browsing elsewhere, changing Working content or checking out another state does not silently replace them.

The Carolingian path starts in 751. Its shared history leads to three branches at Verdun in 843, then later territorial changes. Compare west and east: the rulers and territories differ, while the ruling house remains shared. Follow the middle kingdom into its 855 division and the northern successor's disputed inheritance.

The terminal uses `git` for repository operations, `history --model` or `history --object` for an explicit historical target, and `scope` for browsing organization. GUI controls use the same typed services; older historical `git` aliases return a migration hint. The examples below target the retained `gitworld-curated-history` model. Replace `<commit-oid>` with the actual commit shown by `git status` or `git log`; terminal completion lists available model IDs. Fixed checkout and comparison require a committed revision; Working remains available for preview.

```text
git status
git log --limit 5
history --model gitworld-curated-history --revision <commit-oid> branch --all
history --model gitworld-curated-history --revision <commit-oid> log francia/main --graph
history --model gitworld-curated-history --revision <commit-oid> checkout francia/west@843
history --model gitworld-curated-history --revision <commit-oid> diff CHECKED francia/east@843
history --model gitworld-curated-history --revision <commit-oid> blame francia/west@870 --field territory.extent
```

These are examples of generic operations over the dataset. References and fields can be combined freely within the available coverage. Visual actions use the same command execution layer; the terminal is not a collection of scripted demo answers.

## Compare more than different names

A return to the same city does not restore an earlier state. These two comparisons test that distinction:

```text
history --model gitworld-curated-history --revision <commit-oid> diff japan/main@710 japan/main@745
history --model gitworld-curated-history --revision <commit-oid> diff abbasid/main@762 abbasid/main@892
```

The Japanese court returns to Nara after intervening relocations. The Abbasid court returns to Baghdad after Samarra. In each comparison, the recorded residence matches while other fields describe a different situation. Unrecorded fields remain unknown; the engine does not manufacture continuity to complete a table.

You can also compare independent paths, without inventing a common ancestor:

```text
history --model gitworld-curated-history --revision <commit-oid> diff abbasid/main@762 japan/main@794
history --model gitworld-curated-history --revision <commit-oid> log japan/main --graph
history --model gitworld-curated-history --revision <commit-oid> blame japan/main@794 --field politics.capital
```

The field identifier `politics.capital` is displayed as **Court residence**. The model does not assume that every polity had one fixed capital. Use `help` for the supported command families and model-qualified `history ... branch --all` for historical paths. Repository branches and historical model branches have different meanings.

## What Git brings to history

The implementation separates **editorial commits and repository HEAD** from **historical observations, continuity paths and checked states**; see the [data model](docs/data-model.md). These are connected layers, not interchangeable meanings of a commit or date.

| Concept | Role in GitWorld |
| --- | --- |
| Editorial commit and HEAD | A modern contribution and its frozen data tree, with an author, reason and actual Git OID. Its timestamp is not a historical date. |
| Working tree and index | Current edits and the exact selection frozen for the next data commit. Staging B then editing C commits B and retains C working. |
| Historical state | A sourced object state or a model snapshot replayed from parent changes, qualified by its data revision. |
| Historical parent and branch | Modeled continuity, divergence and explicit integration choices, including the three outcomes of Verdun. |
| Influence link | A sourced connection separate from ancestry and state inheritance. |
| Historical checkout | Fix an object/year or model/ref at a data OID without moving repository HEAD or replacing A/B. |
| Historical Diff | Compare stable field values at explicit endpoints, retaining shared values and exposing unknowns. |
| History log and blame | Inspect dated observations or modeled ancestry and trace recorded changes to evidence. |

Git supplies useful abstractions, not a claim that history behaves exactly like software. Influence is not ancestry: borrowing a practice does not make one society a descendant of another. A field's last recorded change is not necessarily its historical origin.

The starter package concentrates on histories around 600–900 CE and includes a Qin BCE case; it does not claim complete coverage. A query such as `francia/west@850` resolves to the latest eligible recorded state at or before 850: **843**. The interface distinguishes requested and recorded dates. Branch coverage limits prevent unsupported extrapolation, and inheritance means that no later change was authored along that path. Uncertain intervals require an explicit choice when a query is ambiguous.

The [data guide](data/README.md) describes the current seed, provenance and modeling limits. Earlier [historical notes](prototype/HISTORY_SOURCES.md) and [overview/map sources](prototype/CONTENT_SOURCES.md) document the prototype baseline. The basemap has no political borders and does not depict historical territorial control.

## Local data workflow

The data workflow connects **acquire/import → preview and review → adopt or correct Working content → explore → stage and commit → back up and restore**. New records participate in ordinary search, states, comparison and evidence paths. Model-package import can first create an editable draft; only a valid reviewed package is written to Working. The compatibility API name `draft.publish` does not mean an automatic Git commit. The [data-operations guide](docs/data-operations.md) explains the workflow and recovery boundaries.

Historical queries do not edit data. Bounded repository commands support status, diff, staging, commit and explicit revision operations through the same services as GUI controls. Corrections become modern working changes; old OID-qualified historical checkout and A/B retain their original content. Git owns current authored content; SQLite coordinates drafts, workspace/cache state and durable retries, with older release APIs retained for compatibility. A current `.gitworld` backup includes the full local library: Git working/index/history, SQL stores, settings/recoverable input, research and acquired raw material. It is a private recovery artifact, not a redistributable data export. See the [backup contract](docs/library-backup.md).

The shared domain engine implements multi-parent integration, influence links, tags, three-dot comparison, BCE/uncertain time and scope commands. Source checks, real runtime checks, native interaction review and installation acceptance are distinct gates; passing one does not establish the others. AI and online multiuser collaboration remain future work.

Historical evidence and redistribution permission are separate. Original curated records and appropriately licensed data can be released; raw acquisitions, user databases and private working material require separate handling. See the [publication policy](docs/governance/publication-policy.md) and [source-based product assessment](docs/research/product-assessment-response.md).

## Run the desktop source

Use **Node.js 24**, the version configured in CI:

```sh
npm ci
npm run dev
```

This starts the local Electron application and its data service. Normal packaged use includes its own runtime; these are contributor commands. The interface supports English and Simplified Chinese. Explore available local material or enter `help` in the terminal for `git`, `history` and `scope` commands.

From the repository root:

```sh
npm run typecheck
npm test
npm run build
npm run desktop:smoke
```

The runtime smoke starts the real Electron binary with an isolated temporary library and checks SQLite, the seed publication path, renderer isolation and malformed IPC rejection. [Desktop CI](.github/workflows/desktop.yml) also packages an internal macOS build and runs its actual ASAR. Neither command substitutes for native interaction or installation acceptance. Packaging and profile-isolation instructions are in the [desktop guide](apps/desktop/README.md).

For the frozen UED prototype, use `npm --prefix prototype ci --legacy-peer-deps` and `npm --prefix prototype run dev`, then open [http://127.0.0.1:4173](http://127.0.0.1:4173). Its fixed dataset, compact typography and browser-only storage are historical design artifacts. The desktop is the active implementation.

The application exposes bounded commands, never a system shell.

## Technical direction and languages

- **Distribution:** macOS desktop first; Windows and Linux are later targets.
- **Implementation:** Electron and TypeScript, a restricted renderer, typed IPC to a local service, bundled Git for authored content and SQLite for operational/legacy state. `electron-builder` packages the macOS application; current artifacts are unsigned and unnotarized. The earlier prototype uses Vite and DOM/SVG rendering.
- **Interface:** English and Simplified Chinese from the first prototype.
- **Historical content:** English first, preserving sources in their original languages. Content translations remain separate from historical identities and UI messages.
- **Collaboration:** English for repository documentation, code comments, issues, and pull requests.

Development uses GitHub Issues, pull requests, and GitHub Actions. Requirements, design, code, historical content and release evidence evolve together. The [PRD](docs/PRD.md), [interaction design](docs/UED.md), [architecture decision](docs/adr/0001-desktop-local-data.md), [contribution guide](CONTRIBUTING.md), and [review responsibilities](docs/governance/agent-team.md) describe that work.

## Contributing

Useful contributions include a historical question worth exploring, a well-sourced example of continuity or divergence, or feedback on how an operation makes a relationship easier to understand.

Use [Issues](https://github.com/samar1tan/GitWorld/issues) to discuss a concrete proposal. For historical examples, include the source and explain what a user should be able to learn or do with it. Larger implementation proposals should start with a discussion of scope and interaction.

## License

[Apache License 2.0](LICENSE).
