# GitWorld historical workbench prototype

UED iteration 05 connects world-scale browsing with a historical branch graph, checked-out states, computed comparisons, field provenance, and an interactive command terminal. It follows the [current PRD](../docs/PRD.md). The historical engine runs locally over a curated sample; it is not the production backend or a complete Git implementation.

The [interaction design baseline](../docs/UED.md) tracks interaction, browser, and Figma review status. The checks below describe executable verification, not user acceptance or completion of visual review.

## Run locally

Use **Node.js 24** and npm. From the repository root:

```sh
cd prototype
npm ci --legacy-peer-deps
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Dependency installation requires network access; the running prototype serves its data, fonts, and map locally. Opening historical source links requires network access. No API key or backend service is required.

## Explore the workbench

The initial window is **600–900 CE**. The world overview contains selected processes in Europe, the Mediterranean and West Asia, and East Asia. Its six processes and eighteen overview events provide orientation; the version model below contains the states available for checkout and comparison. An overview event is not necessarily a version, and one event can produce versions on multiple branches.

1. Choose a scope and open a process, such as **Europe → Carolingian succession**.
2. Follow parent edges from the shared Carolingian path to the western, middle, and eastern outcomes of 843. Previewing a node leaves `HEAD` unchanged.
3. Check out a version to inspect the state computed from its parent history. Fields expose their sources and last recorded changes.
4. Compare two versions: successive states, sibling branches, or independent paths. A and B remain fixed when you browse elsewhere or check out another state.
5. Trace a field's recorded change, then return to the wider scope. The browsing context is separate from `HEAD` and the comparison.
6. Repeat an operation through the terminal, adapting its references or field ID. Visual actions and typed commands use the same execution layer.

English and Simplified Chinese share the same historical identities, command syntax, and state. Navigation URLs record the workspace view; language changes do not create another historical graph.

## Available versions

Dataset `ued-workbench-2026-10-25` contains **8 branches, 28 versions, 7 field definitions, and 14 sources**.

| Branch | Recorded years | Query window |
| --- | --- | --- |
| `francia/main` | 751, 768, 771, 800, 814, 840 | 751–842 |
| `francia/west` | 843, 870 | 843–870 |
| `francia/middle` | 843, 855 | 843–855 |
| `francia/east` | 843, 870 | 843–870 |
| `francia/lotharingia` | 855, 869, 870 | 855–870 |
| `abbasid/main` | 750, 762, 836, 892 | 750–892 |
| `japan/main` | 710, 740, 744, 745, 784, 794 | 710–794 |
| `tang/main` | 618, 755, 763 | 618–763 |

The query window bounds **as-of resolution**, not annual historical coverage. For example, `francia/west@850` resolves to the record dated 843 and retains 850 as the requested year. Outside-window requests are rejected. A snapshot inherits unmodified model fields from its parents; inheritance is not fresh evidence for every intervening year. Missing or explicitly unknown values do not imply absence or equality.

Middle Francia's 855 division is represented explicitly; Lotharingia is only its northern successor. The Abbasid, Japanese, and Tang paths have independent roots. No influence relationship is converted into a parent edge.

## Commands and investigations

Enter these commands in the **in-app terminal**, one at a time. They do not run in your system shell. `git help` lists supported syntax, and completion offers actual references and field IDs.

| Command | Effect |
| --- | --- |
| `git status` | Inspect browsing context, `HEAD`, and comparison endpoints. |
| `git branch --all` | List all branches; omit `--all` to use the current scope. |
| `git search "Nara"` | Search historical branch and version records. |
| `git log francia/lotharingia@870 --graph` | Follow the version's parent history in the graph. |
| `git show commit:middle-855` | Preview a recorded version without checking it out. |
| `git checkout francia/west@843` | Set `HEAD` and display the computed snapshot. |
| `git diff HEAD francia/east@843` | Set comparison A/B without moving `HEAD`. |
| `git blame francia/west@870 --field territory.extent` | Locate the last recorded change to the field and its sources. |

Supported operations are `help`, `status`, `branch`, `search`, `log`, `show`, `checkout`, `diff`, and `blame`. Use `branch@year`, `commit:id`, or an established `HEAD` as a version reference. `log` also accepts a bare branch. Unsupported commands or invalid references report an error without applying a workspace change.

The examples are starting points for free queries, not separate scripted answers:

```text
git log francia/main --graph
git checkout francia/west@843
git diff HEAD francia/east@843
git diff francia/west@843 francia/west@870
git blame francia/west@870 --field territory.extent
```

These reveal shared Carolingian ancestry, divergent rulers and territories, then a later change within the western branch. Try swapping A and B or following the middle kingdom's 855 division.

```text
git diff japan/main@710 japan/main@745
git log japan/main --graph
git diff abbasid/main@762 abbasid/main@892
git log abbasid/main --graph
```

Both comparisons return to an earlier residence: Nara and Baghdad. The matching place name does not make the full states equal. Japan's planning field becomes unrecorded after the move to Kuni and is not automatically restored on the return to Nara; the court's recorded situation also changes. The Abbasid path shows Samarra between the two Baghdad records.

```text
git diff abbasid/main@762 japan/main@794
git checkout japan/main@794
git blame HEAD --field politics.capital
```

Independent paths can be compared by shared fields without a common ancestor. `politics.capital` is labeled **Court residence**; source and modeling notes explain what that field means for each path.

## Check and build

Run these commands inside `prototype/`:

```sh
npm test
npm run build
```

`npm test` uses Node's built-in test runner. It covers navigation restoration and URL state, reference resolution and coverage, parent-state replay, field provenance, stable-value comparison, unknowns, command parsing, and equivalent GUI/CLI effects. `npm run build` checks TypeScript and creates the production bundle in `dist/`.

To serve that bundle locally:

```sh
npm run preview
```

The preview server also uses port 4173; stop the development server first. Browser walkthroughs and bilingual visual checks are separate review work.

## File responsibilities

| File | Responsibility |
| --- | --- |
| `src/main.ts` | World/scope rendering and application interaction wiring |
| `src/workbench-ui.ts` | Branch graph, snapshots, comparisons, provenance, and terminal rendering |
| `src/state.ts` | Browsing state, checked-out version, fixed comparison endpoints, navigation history, and URLs |
| `src/history-types.ts` | Typed historical objects, query results, and command effects |
| `src/history-content.ts` | Curated versions, parent relations, field changes, translations, and sources |
| `src/history-engine.ts` | Reference resolution, snapshot replay, diff, log, search, and blame |
| `src/commands.ts` | Command grammar, completion, and shared execution for GUI/CLI |
| `src/locales.ts`, `src/workbench-locales.ts` | English and Simplified Chinese interface messages |
| `src/content.ts` | Overview scopes, processes, events, and related source references |
| `src/style.css`, `src/workbench-style.css` | Overview and workbench layout and styling |
| `src/*.test.ts` | State, engine, and command checks |
| `public/world-land.svg` | Locally served geographic land outline |
| `HISTORY_SOURCES.md` | Version-level evidence, model boundaries, and omissions |
| `CONTENT_SOURCES.md` | Overview-event evidence, map provenance, and licensing |

## Model and map boundaries

Snapshots and diffs are computed from authored data. This validates the exploration model; it does not provide a production historical database, backend persistence, arbitrary Git commands, or editing of history. Multi-parent integration workflows, new-branch authoring, collaboration, and AI integration are outside this iteration. The sample is intentionally sparse, with specific omissions documented in [Historical sources](HISTORY_SOURCES.md).

The offline SVG uses **Natural Earth** land geometry via `world-atlas`, with no modern political borders. Generalized modern coastlines locate a scope; they do not reconstruct medieval coastlines or territorial control. Natural Earth data is public domain. Asset provenance and the retained license notice are in [Content sources](CONTENT_SOURCES.md).
