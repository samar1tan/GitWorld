# New-user journey and contextual tips requirements

Document revision **v0.1** · Product scope **v0.1** · 25 October 2026

Status: implementation in progress, installed review pending. This module supports the [main learning workflow](learning-workflow.md); it does not replace data coverage, usable controls or independent installed acceptance.

## User outcome

A new user can identify the workbench's stable sections, choose a useful scope and complete an investigation through actual states, comparison and evidence. They can continue with their own acquired data. The interface explains the difference between historical change and modern data revisions where a decision depends on it.

A cold start shows the existing local-library opening state and actual initialization progress until the initial library and workspace selection resolve. Early asset or locale updates must not present an uninitialized library as empty. A confirmed empty library retains its discovery/import actions; a failed read retains its error and retry rather than remaining in loading indefinitely.

## Scope

- A concise, optional first-use invitation; no mandatory account, questionnaire, case selection or setup wizard.
- A persistent Guide entry, a resumable first-investigation journey and an acquired-data journey.
- Contextual tips for the current section. One relevant tip at a time; never repeat every visible label or block normal work.
- English and Simplified Chinese, complete message templates and keyboard-accessible controls.
- Pause/close, resume, deliberately restart, and turn tips off. [Settings](settings-prd.md) exposes the same preferences rather than a second progress system.

## Journeys and progress

| Journey | Successful actions that establish progress |
| --- | --- |
| First investigation | Choose a scope/object; inspect a historical state; compare fixed A/B; inspect supporting evidence; save a research record linked to that investigation. |
| Work with acquired data | Acquire actual records; inspect a real mapping preview; adopt selected results; review and stage changes; commit the frozen selection. |

Use the installed historical content or objects acquired through ordinary application controls. There are no tutorial-only objects, fixed object IDs, scripted command replies, hidden developer steps or synthetic successes. The user can choose a subject and can leave the journey at any point. Missing time, evidence or usable data is a real result with an actionable explanation, not an automatic completed step.

Progress is recorded after a successful application response/rendered result, not a click or opening a tab. Link state/comparison/evidence/research steps to the investigation's stable scope/object identifier; do not complete a different investigation from unrelated actions. Repeated success events are idempotent. A preview that has no supported state cannot satisfy state inspection. A failed commit cannot satisfy commit completion.

### Prepared-import identity across recovery

A data recipe retains its acquisition job and, after a successful version-2 prepared mapping preview, that preview's actual `inputHash`. Only a successful API response containing a valid prepared identifier/base and input hash can supply this binding. Do not derive it from a job ID, displayed label, source title, locale or command text. Preferences retain at most one 64-character hash for the active recipe; raw source data, previews and receipt journals remain outside Guide state.

Normal adoption and shared Imports recovery must report the successful result's prepared input hash. When it matches the preview already observed by Guide, adoption continues the original recipe even if the shared recovery surface uses a different job identifier. Keep the original recipe job; opening recovery, discovering pending work or submitting Resume does not count as success. A different/missing/malformed hash cannot complete a hash-bound recipe, including when the job ID happens to match. Changed input in a later successful preview clears that recipe's adoption, staged tree and commit progress; an identical replay is idempotent. Stage paths and the confirmed frozen tree are still required before commit completion.

Existing stored progress without a hash remains readable and keeps its prior same-job behavior. It cannot acquire a guessed hash from adoption alone or authorize cross-job recovery. A new real preview establishes the new binding. Malformed stored hash data cannot retain dependent progress as though it were a valid prepared preview. Restart, backup/restore and locale changes preserve a valid binding without generating a new successful operation.

Do not require new users to commit merely to browse existing history. The data journey explains a commit as a recorded change to their library. The historical journey shows that a fixed state contains an object, historical time and data revision, and that an influence link is distinct from historical ancestry where applicable.

## Attention and layout

The ordinary open Guide shows the current step, one short explanation and one workspace action in a roughly 120–160 CSS px bottom dock. Progress and journey/preferences are secondary disclosures. Extra content scrolls while the close control remains reachable; narrowing or zooming never shrinks text to fit. Escape first cancels a restart confirmation or closes a secondary disclosure, then closes Guide. These layout targets require rendered and operational checks in both locales.

Keep global library/revision context above, scope/object navigation left, the investigation central and evidence in the contextual region. Guidance uses a compact bottom dock for the current section's tip or the open Guide. It reserves canvas height, leaves essential actions visible and preserves the workbench's section positions. Opening Guide is explicit; progress updates do not capture focus, repeatedly reopen a closed guide or announce the whole panel to screen readers.

Tips identify the next useful action or clarify a state. Avoid motivational slogans, feature inventories, generic congratulations and unsupported future capabilities. When an action cannot yet run, explain the actual prerequisite through the working UI. Do not add a disconnected Next button that simulates application progress.

## Persistence and recovery

Guide state is versioned local configuration outside the data repository. Pause/dismiss/tips preferences survive restart and full-library backup/restore. Resetting guidance never changes imported data, historical state, A/B, research records or commits. Failed persistence retains progress in memory, shows an actionable retry and cannot claim that progress was saved. Invalid stored state is validated before hydration.

Settings and Guide share one Learning preference for contextual tips. Applying that saved preference only updates the guide's local mirror; it does not reset progress, dismissed tips or pending progress writes, and does not save the contributor/settings profile again. A tips change initiated in Guide first awaits the connected Learning-settings save. Failure keeps the prior value and offers a retry; only success updates and persists the guide mirror. The optional callback preserves standalone guide operation.

Settings opens a journey through an explicit API with a track and `resume` or `restart` mode. Resume selects that journey, opens Guide and clears its paused flag while retaining progress. Restart selects and opens the journey's existing confirmation area; progress is cleared only after the user confirms there. Neither opening a journey nor synchronizing preferences counts as a successful learning operation.

## Acceptance

| ID | Required evidence |
| --- | --- |
| J01 | Fresh installed profile sees optional help while normal exploration remains available; Guide can be opened and closed using keyboard controls. |
| J02 | Complete the investigation through actual content, including meaningful A/B and supporting evidence; success advances only the corresponding steps. Repeat with a different object without renderer changes. |
| J03 | Failed acquisition, empty state, unrelated evidence and failed commit do not complete steps. Repeated actions and restart do not duplicate progress or reopen dismissed guidance. |
| J04 | Pause/resume/restart/tips-off work in both languages, at 1440×900 and 1280×800, while research input and application context remain intact. |
| J05 | A full backup/restore preserves progress, preferences and recoverable input together. No developer script, LLM or external tutor is required. |
| J06 | A real prepared Wikipedia preview followed by normal adoption or shared Imports recovery advances the same data recipe after restart. Different/missing/invalid hashes, failed resume and unrelated jobs do not complete it; changed previews invalidate downstream progress, repeated identical results are idempotent, and legacy progress remains compatible. |

Casey owns the guidance component; root integrates actual result events and independently reviews installed behavior. The [interaction notes](onboarding.md) specify the component's concrete behavior. The existing [UED](UED.md) records its relationship with the global shell; Figma synchronization is an outstanding deliverable until checked.
