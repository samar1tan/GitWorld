# Workbench interaction design

Design baseline: UED 05, 25 October 2026. The [PRD](PRD.md) defines the full desktop release. This document distinguishes the verified exploration prototype from the desktop and data-management work being implemented.

## Orientation and persistent context

The workbench opens on a world-scale setting with a time interval and recorded processes. A geographic overview helps choose a scope; it does not imply precise historical borders or complete coverage. Users can enter through a region, process, branch, search result or command. Returning to the world restores orientation without undoing version operations.

The visual direction is a light editor interface: near-black canvas, dark-gray panels and blue selection accents. The left area separates browsing scope from historical branches. The central area changes between overview, history graph, state and comparison. A version preview provides evidence and onward paths. The terminal and a compact current-version area remain discoverable. No AI entry appears until it supports an implemented flow.

| State | How it changes | What it does not change |
| --- | --- | --- |
| Browsing scope and interval | Navigation, map, time controls | Fixed HEAD and A/B |
| Preview | Select a recorded version or use `show` | HEAD |
| HEAD | Explicit checkout of a resolvable version | Existing comparison |
| A/B | Choose or exchange comparison endpoints | HEAD |
| Dataset release | Explicit release selection | Immutable content of earlier releases |

## Investigation loop

Follow a common history into a split, preview a successor, checkout its recorded state, compare it with another version, inspect a field's provenance, then investigate another branch through the command line. Results must point back to usable visual objects. The route is a starting point for self-directed questions, not a prepared click script.

The graph shows recorded versions and parent relationships. Column spacing is explicitly ordinal rather than a continuous time scale. A branch can continue after its fork. Multi-parent integration needs a visible field-resolution record. Contact and influence have their own type and evidence; they do not become ancestry merely because an arrow can be drawn.

State views show values, last recorded changes, inherited fields and evidence. Inheritance does not establish a new observation. Equal endpoints do not establish uninterrupted continuity. Missing information, supported absence and inapplicability are different outcomes. An as-of request displays both requested and resolved dates; uncertain candidates require a choice.

The terminal accepts adaptable references and parameters, supports completion and history, and provides clickable results and specific recovery choices. GUI actions and commands share domain semantics. A late response must not replace a newer view. Errors preserve the current workspace. The interpreter does not execute a system shell.

## Local content management

The desktop manager is a separate working area with ordinary forms and bulk import/export. A draft can edit sources, subjects, fields, values, dates, ancestry, integration decisions, influence, tags and overview mappings. Publication requires validation, a difference preview and editorial review. Publishing makes a new immutable release available without rebuilding the application; it does not silently move an existing investigation to that release.

Backup and restore, failed imports, stale drafts and service failures are part of this flow. A successful message must correspond to persisted data. Source acquisition produces reviewable drafts, not automatically trusted history. Interface text is maintained independently in English and Simplified Chinese; historical content has an explicit English fallback.

## Reading scale and window behavior

Design-frame dimensions are review fixtures, not application resolution limits. Render text and vectors at the display's native scale. Use 14–15 CSS px for ordinary interface and historical text, at least 12 px for secondary information, and readable line spacing and contrast in both languages. Narrow windows must not reduce font sizes to preserve the number of visible panels.

Wide windows can show the branch list, graph and version inspector together. At narrower effective widths, place the inspector below the graph; at high interface zoom, stack the main regions and allow page scrolling. Long graphs and comparison tables retain readable labels and scroll within their regions. Expanding command output must leave useful room for its visual result. Evidence remains available through disclosure controls.

Provide native interface zoom, reset-to-actual-size and full-screen controls. Remember the user's window geometry and zoom, and fit restored windows to the current display's usable area. Review ordinary and larger windows, reduced window sizes and 200% interface zoom; inspect both languages, command results, state and comparison tables, and management forms. A build check cannot establish this acceptance result.

## Verification status

The frozen [prototype](../prototype/README.md) implements branch exploration, checkout, field comparison, typed commands, evidence and return navigation over its recorded dataset. Its 24 tests and TypeScript/build checks passed. Browser review covered multiple historical routes, both interface languages, 1440×900 and 1280×800 layouts, date ambiguity, command recovery and retained HEAD/A/B.

The editable design artifact contains ten native text/vector keyframes and twenty links for the English and Simplified Chinese core routes. Both routes were exercised in presentation mode. It is a fixed-frame design review; arbitrary input is tested in the runnable prototype. The design is not a claim that every screen is a finished Auto Layout component system. Private synchronization records and review captures are not included in the public repository.

The desktop implementation has a subsequent reading-scale revision. Its larger text and responsive panel rules supersede the compact typography in the frozen UED 05 frames and prototype. Those frozen artifacts have not yet been synchronized to the desktop reading-scale revision; they continue to document the exploration semantics, not final display-size acceptance.

The desktop application must meet the complete PRD acceptance matrix, including runtime data addition and recovery. Prototype success alone does not satisfy that matrix, and agent review is not a claim of observed user-study results.
