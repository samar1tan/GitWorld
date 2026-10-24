# GitWorld

Explore world history through the lens of Git.

After a political system splits, what do its successors keep, and what do they change? What is happening elsewhere at the same time? Can you trace a particular institution back through the changes that shaped it?

GitWorld is an interactive history workspace built around states, commits, branches, and diffs. It is designed for history learners and enthusiasts with some programming or AI-tool experience.

It is also the first major foundation of a broader world-history series. Git's model of collaboration and branch development could eventually let contributors extend historical coverage and develop new civilization branches together. The initial exploration experience establishes the shared objects and operations for that work.

**Status:** Product and interaction design. There is no runnable application yet; the experience below describes what we are building.

## Explore a world of branches

The planned workspace combines a world-history graph, a state file tree, a comparison view, and an in-app terminal. Graph actions and commands operate on the same selection and historical state.

One exploration might start at the division of the Carolingian realm:

1. Expand the split to see the successor branches and their shared starting point.
2. Check out two branches at the same date.
3. Compare their political centers, institutions, and regions of control.
4. Follow a changed field to its recorded event and supporting source.
5. Keep the date fixed and look at a contemporary society in another region.

Proposed in-app commands for part of that flow:

```text
git checkout francia/west@850
git diff francia/west@850 francia/east@850
git blame HEAD --field politics.capital
```

These are design examples; the first curated dataset will define the available references. The terminal will interpret a bounded set of exploration commands inside GitWorld.

Guided questions provide starting points; users can leave the route and follow their own interests.

## What Git brings to history

Git provides the model and operations behind the workspace:

| Concept | Role in GitWorld |
| --- | --- |
| Commit | A recorded historical change that produces a new modeled state. |
| Tree and snapshot | The fields describing a subject at a particular version. |
| Parent and branch | Continuity and divergence between historical paths. |
| Multi-parent integration | An explicit account of which fields were retained, changed, or left unknown during an integration. |
| Checkout, diff, log, blame | Inspect a state, compare states, follow a path, and trace a field's last recorded change. |

Influence and contact connect paths through separate relationships. A borrowed practice can help explain a field change without making one society a descendant of another. The world graph can have multiple starting points.

We use educational simplification and game-like rules to make selected historical changes easy to explore. Those rules must be consistent and explainable. Important claims and relationships need evidence; modeling choices and uncertainty should be inspectable where they matter. A field's last recorded change is not necessarily its historical origin.

## The first milestone

We are starting with a desktop Web prototype built around three journeys:

- **Mediterranean and Europe:** continuity, political splits, and comparison between successor branches.
- **West Asia and Iberia:** political change, continuation in another region, and exploration of contemporaries.
- **East Asia:** political integration and cross-branch institutional or cultural influence.

The prototype will use roughly 12–18 representative event nodes and clearly identified fixtures. This is selected Eurasian coverage within a world navigation model; uncovered regions will remain visible as gaps in the dataset.

We will first refine one complete exploration flow, then expand it across the three journeys. Review will cover what users discover, the evidence behind the content, visual and interaction quality, and whether the graph and terminal behave as one workspace. Interface copy must identify something, explain something, or help the user act.

The initial scope is read-only exploration. Collaborative editing and tools for developing new civilization branches will be scoped separately.

## Technical direction and languages

- **Platform:** Web, with desktop layouts first.
- **Language:** TypeScript across the frontend and backend. Frameworks and storage choices remain open.
- **Interface:** English and Simplified Chinese from the first prototype.
- **Historical content:** English first, with reliable sources in other languages retained in their original form. Chinese content translations can grow separately from UI localization; untranslated content will fall back to labeled English text.
- **Collaboration:** English for repository documentation, code comments, issues, and pull requests.

Development will use GitHub Issues, pull requests, and GitHub Actions. Application setup instructions and executable CI checks will be added with the initial codebase.

## Contributing

At this stage, useful contributions include a historical question worth exploring, a well-sourced example of a split or integration, or feedback on how a Git operation could make a relationship easier to understand.

Use [Issues](https://github.com/samar1tan/GitWorld/issues) to discuss a concrete proposal. For historical examples, include the source and explain what the user should be able to learn or do with it. Larger implementation proposals should start with a discussion of scope and interaction.

## License

[Apache License 2.0](LICENSE).
