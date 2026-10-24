# GitWorld

A desktop world-history workspace built around Git’s state and version abstractions.

GitWorld is a macOS-first local desktop project built around historical states, commits, branches, and diffs. Follow a historical path, check out a recorded state, compare it with another, and trace a field back to its evidence. It is designed for history learners and enthusiasts with some programming or AI-tool experience.

GitWorld is also the first major foundation of a broader world-history series. Git's model of collaboration and branch development could eventually let contributors extend historical coverage and develop new civilization branches together. The initial experience establishes the objects and operations for that work.

**Status:** The repository contains a runnable browser workbench prototype with **8 branches and 28 recorded versions**, parent-state replay, computed comparisons, and a bounded command interpreter. The first desktop development loop now targets a packaged macOS app, a persistent local database, and usable content management. Those requirements are not completed merely by the existing prototype. See the [public PRD](docs/PRD.md) for the full acceptance contract and the [architecture decision](docs/adr/0001-desktop-local-data.md) for Electron, typed IPC, and SQLite.

Windows and Linux are future targets. No completed desktop installer, signing/notarization, or cross-platform validation is claimed here. The initial records are a migration seed, not a permanent content limit or comprehensive historical coverage.

## Find your bearings, then follow a path

Start with the world overview, choose a region and period, then enter a historical process. The workbench connects that wider setting to a branch graph, a checked-out state, comparison endpoints, and an in-app terminal.

Three pieces of context stay distinct:

- **Browsing scope:** where and when you are looking. Opening a branch or previewing a version does not check it out.
- **HEAD:** the version you explicitly checked out. Its fields are reconstructed from parent states and recorded changes.
- **Comparison A and B:** two resolved versions. Browsing elsewhere or checking out another version does not silently replace them.

The Carolingian path starts in 751. Its shared history leads to three branches at Verdun in 843, then later territorial changes. Compare west and east: the rulers and territories differ, while the ruling house remains shared. Follow the middle kingdom into its 855 division and the northern successor's disputed inheritance.

The following commands run in the existing prototype’s terminal, with results reflected in the workspace:

```text
git branch --all
git log francia/main --graph
git checkout francia/west@843
git diff HEAD francia/east@843
git diff francia/west@843 francia/west@870
git blame francia/west@870 --field territory.extent
```

These are examples of generic operations over the dataset. References and fields can be combined freely within the available coverage. Visual actions use the same command execution layer; the terminal is not a collection of scripted demo answers.

## Compare more than different names

A return to the same city does not restore an earlier state. These two comparisons test that distinction:

```text
git diff japan/main@710 japan/main@745
git diff abbasid/main@762 abbasid/main@892
```

The Japanese court returns to Nara after intervening relocations. The Abbasid court returns to Baghdad after Samarra. In each comparison, the recorded residence matches while other fields describe a different situation. Unrecorded fields remain unknown; the engine does not manufacture continuity to complete a table.

You can also compare independent paths, without inventing a common ancestor:

```text
git diff abbasid/main@762 japan/main@794
git log japan/main --graph
git blame japan/main@794 --field politics.capital
```

The field identifier `politics.capital` is displayed as **Court residence**. The model does not assume that every polity had one fixed capital. See the [prototype guide](prototype/README.md) for all available branches and command syntax.

## What Git brings to history

| Concept | Role in this prototype |
| --- | --- |
| Commit | A recorded change with parents, field changes, and sources. |
| Snapshot | A modeled state computed by replaying changes along its parent path. |
| Parent and branch | Continuity and divergence, including the three outcomes of Verdun. |
| Checkout | Make a particular recorded version the current `HEAD`. |
| Diff | Compare stable field values, retaining shared values and exposing unknowns. |
| Log and blame | Follow ancestry and locate a field's last recorded change and evidence. |

Git supplies useful abstractions, not a claim that history behaves exactly like software. Influence is not ancestry: borrowing a practice does not make one society a descendant of another. A field's last recorded change is not necessarily its historical origin.

The sample contains selected histories within 600–900 CE, not complete coverage of those centuries. A query such as `francia/west@850` resolves to the latest authored record at or before 850: **843**. The interface distinguishes the requested year from the record's year. Branch coverage limits prevent extrapolation outside the sample, and an inherited value means only that no later change was authored along that path.

The [historical sources and modeling notes](prototype/HISTORY_SOURCES.md) document the 28 versions, claim-level evidence, omissions, and query boundaries. The [overview and map sources](prototype/CONTENT_SOURCES.md) cover the broader geographic presentation and original overview records. The basemap has no political borders and does not depict historical territorial control.

## Required desktop data workflow

The desktop application must support **enter/import → validate → preview → publish → explore → correct → back up and restore**. Routine editing belongs in forms for sources, subjects, fields, states, relationships, tags, and coverage. New published content must appear in search, completion, graphs and comparisons without changing TypeScript or rebuilding the app.

Exploration commands remain read-only. A separate local management workspace must edit drafts and publish immutable dataset releases. Corrections create a new release; old workspaces keep their pinned data and fixed comparisons. The local database must persist across restarts, with a tested restore path for the library.

The first complete release also retains the PRD requirements for multi-parent integration, separate influence relationships, tags, three-dot comparison, BCE/uncertain time, and scope commands. The prototype's current command subset is not the definition of a complete v0.1. AI and online multiuser collaboration remain future work.

Historical evidence and redistribution permission are separate. Original curated records and appropriately licensed data can be released; raw acquisitions, user databases and private working material require separate handling. See the [publication policy](docs/governance/publication-policy.md) and [source-based product assessment](docs/research/product-assessment-response.md).

## Run the existing prototype

Use **Node.js 24**, the version configured in CI:

```sh
cd prototype
npm ci
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The interface supports English and Simplified Chinese. Try a branch from the visual explorer or enter `git help` in the in-app terminal.

Run the automated checks and production build from `prototype/`:

```sh
npm test
npm run build
```

The prototype uses TypeScript, Vite, and native DOM/SVG rendering. [GitHub Actions](.github/workflows/prototype.yml) runs installation, tests, and the build. Tests cover state/navigation, reference resolution, parent-state replay, comparison, provenance, and command behavior; they do not replace visual review or user validation.

These commands run the existing browser prototype, not a packaged desktop application. Its historical model and query engine run in the browser over curated data. The target desktop version moves runtime data to a local service and persistent library. GitWorld interprets bounded exploration commands; it is not a complete Git implementation or a system shell. Desktop build and install instructions must accompany an actually verified artifact.

## Technical direction and languages

- **Distribution:** macOS desktop first; Windows and Linux are later targets.
- **Implementation direction:** Electron and TypeScript, a restricted renderer, typed IPC to a local data service, and SQLite behind a storage adapter. The existing prototype uses Vite and DOM/SVG rendering.
- **Interface:** English and Simplified Chinese from the first prototype.
- **Historical content:** English first, preserving sources in their original languages. Content translations remain separate from historical identities and UI messages.
- **Collaboration:** English for repository documentation, code comments, issues, and pull requests.

Development uses GitHub Issues, pull requests, and GitHub Actions. Requirements, design, code, historical content and release evidence evolve together. The [PRD](docs/PRD.md), [interaction design](docs/UED.md), [architecture decision](docs/adr/0001-desktop-local-data.md), [contribution guide](CONTRIBUTING.md), and [review responsibilities](docs/governance/agent-team.md) describe that work.

## Contributing

Useful contributions include a historical question worth exploring, a well-sourced example of continuity or divergence, or feedback on how an operation makes a relationship easier to understand.

Use [Issues](https://github.com/samar1tan/GitWorld/issues) to discuss a concrete proposal. For historical examples, include the source and explain what a user should be able to learn or do with it. Larger implementation proposals should start with a discussion of scope and interaction.

## License

[Apache License 2.0](LICENSE).
