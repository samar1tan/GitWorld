<img src="apps/desktop/resources/icon.svg" width="72" height="72" alt="GitWorld logo">

# GitWorld

A local history workbench built around Git’s states, branches and diffs.

Import structured historical material, follow changes across time, compare states, and trace claims to their sources. Save an interpretation and return to it as your library grows.

**Local desktop · English and Simplified Chinese**

[Preview for macOS (Apple silicon)](https://github.com/samar1tan/GitWorld/releases/download/v0.1.9/GitWorld-0.1.9-arm64-unsigned.dmg) · [Other preview packages](https://github.com/samar1tan/GitWorld/releases/tag/v0.1.9)

This prerelease is unsigned and not notarized; Intel and Linux builds are experimental.

![GitWorld: Japanese court relocations, fixed comparison states and a Tang–Nara influence link](docs/media/v0.1.6/branch-workbench.png)

## A learning workflow

1. **Choose a question and scope.** Move from a wider setting to a useful context, period and set of objects.
2. **Build your collection.** Acquire public data or import local material, inspect the mapping, and adopt the records you need.
3. **Compare states.** Follow a historical path or inspect an object at a year. Keep A and B fixed while you explore elsewhere.
4. **Follow the evidence.** Open the supporting claims and citations. Save your question, interpretation and unresolved points as an investigation.
5. **Revise and revisit.** Review your data changes, stage a selection and commit a reason. Return to earlier investigations with their original evidence intact.

Historical branches model continuity, divergence and integration. Influence links describe connections without inventing ancestry. Git commits record your present-day contributions to the library; their timestamps remain separate from historical dates.

Use the interface or enter supported `git`, `history` and `scope` commands in the built-in terminal. Both operate on the same local workspace.

<details>
<summary>View the workbench walkthrough</summary>

![World overview, historical path, source mapping and state comparison](docs/media/v0.1.6/walkthrough-still-frames.gif)

Four captured screens in a still-frame walkthrough. [Capture details and attribution](docs/media/README.md).

</details>

## Data you can work with

Sources include **Wikidata, fixed Wikipedia revisions, Cliopatria and Pleiades**, alongside supported local imports. Newly adopted records enter the same search, state, comparison and evidence tools as bundled material. Acquiring new sources needs connectivity; local exploration needs no application server or AI account.

The starting collection centers on China and Japan. Source language, uncertainty and review status remain visible; see the [data guide](data/README.md) for coverage and attribution, and the [learning guide](docs/learning-workflow.md) for a complete investigation.

<a id="run-the-desktop-source"></a>

## Run from source

With Node.js 24:

```sh
npm ci
npm run dev
```

See the [desktop guide](apps/desktop/README.md) for development and packaging.

## Contribute

Bring a historical question, a sourced correction or an interaction problem to [Issues](https://github.com/samar1tan/GitWorld/issues). The [PRD](docs/PRD.md), [UED](docs/UED.md) and [contribution guide](CONTRIBUTING.md) describe the project and its working agreements.

Code is licensed under [Apache-2.0](LICENSE). Data and other assets retain their own terms: [third-party notices](THIRD_PARTY_NOTICES.md) · [media attribution](docs/media/README.md).
