# Periodic deflation review

The team's deflation pass (“消肿”) catches clutter and inconsistency that accumulate across individually reasonable changes. It applies to the application, its implementation and its documentation. It is a working habit, not another product feature or an excuse to postpone finishing a journey.

Run a pass after a meaningful batch of related changes, when modules are integrated and before a release or user review. Routine wording fixes do not each require a new review ceremony. Assign an owner and a different reviewer; inspect the current artifacts rather than copying an earlier pass result.

For each visual element, maintain its purpose, name, form, relationship to surrounding content and interaction contract. Shared components can define these together; this does not require a document per icon or button. Review navigation levels and the user's mental model alongside spacing and appearance. Views, actions, saved artifacts and workflow states do not become peer navigation categories merely because each has an implementation module.

If a pass exposes unresolved information architecture or behavior, run a focused UED phase before expanding the interface. Resolve the complete journey and section responsibilities, update the PRD where product understanding changes, and align editable Figma, the runnable prototype and implementation. Record any artifact that is still unsynchronized. This is normal iteration, with the same authorization as the ongoing task.

## Use the application

Start as an installed user and complete a relevant journey, including the return path. Check English and Simplified Chinese at the target window sizes and supported zoom. Exercise new controls with the mouse and keyboard, and revisit loading, empty, error and recovery states where the change affects them.

Review the whole screen as stable regions. Labels must remain readable; action text must not break awkwardly or be clipped. Related buttons need consistent height, padding, alignment and spacing. Give paired action groups visual balance without forcing every unrelated action to the same width. Use concise labels, appropriate wrapping of the group and real layout constraints rather than shrinking text or hiding overflow.

Remove redundant navigation, repeated explanations, unnecessary borders and competing emphasis. Check that guidance, time controls, the command area and native window controls leave enough room for the actual investigation. Preserve input, focus and historical context when opening and closing another section.

Every added visual element needs both rendered inspection and an operational regression. Static inspection can find defects; it cannot establish that an installed journey works. Screenshots alone do not establish keyboard access, correct action results or preserved state.

## Revisit the code and documents

Look for duplicated state, overlapping controls or services, obsolete compatibility paths and small CSS overrides that now fight one another. Simplify within the authorized scope while preserving data and tested behavior. Use relevant existing checks; add tests only where they verify a meaningful failure or invariant.

Read the affected PRD, UED, help and acceptance notes together. Remove stale instructions, repeated prose and contradictory names or status claims. Keep requirements, implementation evidence and remaining gaps distinguishable. A successful build does not turn an untested requirement into an accepted one.

## Close the pass

Record the exact build or revision, journey, locales and sizes actually inspected; concrete findings and fixes; checks performed; and anything still unpassed. Local working notes remain local. Publish concise English evidence only after the normal publication review. Repeat relevant operations after a fix, without rerunning unrelated checks solely to increase a test count.
