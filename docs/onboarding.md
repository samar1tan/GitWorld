# Optional learning guide

The guide helps a new user complete one investigation with the installed application. It is a compact, non-modal companion to the historical workspace, not a setup wizard or an assessment of historical understanding. Included history works offline; imported objects follow the same tools. Acquiring new data is a separate optional recipe.

## User experience

The persistent **Guide / 使用指南** entry opens the panel. Its ordinary 120–160 CSS px dock shows the current step, a brief explanation and one workspace action. Progress and journey/preferences are secondary disclosures; extra content scrolls with the close control always reachable. Workspace actions navigate or focus existing controls; they do not simulate the operation or mark it complete.

The first investigation proceeds through scope or object selection, historical state inspection, fixed A/B comparison, evidence inspection and saving a useful research record. The optional data recipe proceeds through acquisition, mapping preview, adoption, staging and commit. Historical time and the modern data revision are explained at state inspection, comparison and commit, where the distinction affects the task.

Closing the panel dismisses the current section's tip. Pause suppresses all contextual tips until resumed. Both retain progress. Successful work can still be recorded while the guide is hidden or paused; it never reopens itself in response. Tips can be switched off independently. Restart requires an inline confirmation and resets only the selected guide, without changing historical data or research records.

Context tips are brief, section-specific and suppressed while `context().editing` is true. They do not use a live region or announce the complete guide on rerender. The module never moves focus on hydration, progress observations or context changes. Explicit workspace actions may use the injected focus callback, and explicit dismissal returns focus to the guide entry.

## Renderer contract

`createOnboarding` in `apps/desktop/renderer/src/onboarding.ts` receives:

- `locale()` and `context()` with a semantic section (`paths`, `knowledge`, `sources`, `research`, `changes`) and optional editing flag.
- `persist(snapshot)`, backed by the application's local preference store. The module does not use browser storage, a server or a language model.
- `navigate(section)`, optional `focus(target)` and `render()`.
- Optional `onTipsChange(enabled)`, which saves the shared Learning preference before Guide changes its local mirror. Failure retains the prior value and offers a retry. Without this callback, the standalone guide keeps its local preference behavior.
- Optional initial `state`. When preferences load asynchronously, call `hydrate(unknown)` exactly once instead. Before hydration, `content()` is empty. Opening the guide or observing a successful action before hydration is queued and applied after restoration.

The returned API supplies `entry()`, `content()`, `open()`, `openJourney()`, `configurePreferences()`, `hydrate()`, `restore()`, `flush()`, `observe()`, `snapshot()`, `click()` and `key()`. `configurePreferences({ tipsEnabled })` mirrors a saved Learning preference without saving the profile again or replacing progress, dismissed tips or queued writes. `openJourney(track, 'resume')` selects and opens a journey and releases pause. `openJourney(track, 'restart')` opens its existing confirmation; progress is cleared only after confirmation.

Keep the guide's DOM container stable across section changes. The integrated workbench reserves a compact bottom dock for the current section's tip or the open Guide, reducing canvas height instead of covering active controls. Escape only acts on events from the panel: it first cancels a restart confirmation or closes the secondary disclosure, then closes Guide. The Changes focus target opens its commit editor through `openCommit()` before focusing the reason.

Restoration does not represent a new operation. Progress writes are serialized, with pending snapshots coalesced so older writes cannot overwrite newer progress. A rejected write leaves progress in memory and displays a retry action; the guide does not claim that this progress has been saved. Preference persistence does not change domain-operation success.

## Semantic success observations

Only the integrator emits `OnboardingProgressEvent`, after the underlying operation succeeds. Do not infer success from route changes, clicks, input, commands being submitted or a request starting.

| Event | Required successful result |
| --- | --- |
| `scope-chosen` | A real scope or object was selected; `scopeKey` is a stable domain identifier, not a translated label. |
| `historical-state-inspected` | A historical state or observation was loaded for that scope. `stateKey` identifies its object, historical time/ref and data revision. |
| `comparison-completed` | Both A/B endpoints are fixed and their actual comparison loaded. `comparisonKey` identifies both revision-qualified references. Merely choosing a comparison tab does not count. |
| `evidence-inspected` | An actual supporting assertion/source was opened for the investigation, with a stable `evidenceKey`. |
| `research-saved` | A research record for the scope was successfully saved, identified by `recordId` and returned `contentHash`. For the guided journey, the record should retain the inspected evidence/comparison and a useful interpretation or unresolved question. Unsaved text and opening Research do not count. |
| `data-acquired` | An acquisition/import job completed with usable local records; retain its `jobId`. |
| `data-previewed` | The mapping preview for that job loaded successfully. Optional `inputHash` is taken only from its real version-2 prepared response, together with a valid prepared ID/base. |
| `data-adopted` | Claims were successfully adopted into working data. For a prepared recipe, the result's `inputHash` must match the preview previously observed. This permits shared Imports recovery to retain the original acquisition job despite its different recovery job ID. `paths` contains the changed historical object paths reported by adoption. |
| `changes-staged` | Changes from this recipe's adoption were successfully frozen in the returned staged `tree`. The confirmed staged `paths` must intersect the adopted object paths. Unrelated staged edits do not complete the recipe. |
| `data-committed` | The repository confirmed a commit `oid` containing the recipe's staged work. Its approved `tree` must match the guide's recorded frozen tree. A saved research record, unrelated commit or submitted commit request is insufficient. |

Investigation progress is ordered and associated with one scope. Choosing a different scope begins a new guided investigation; unrelated late events cannot complete it. Data progress retains one acquisition job and at most one prepared input hash. Exact hash matching can continue that job across a different recovery surface; a job match alone cannot bypass an existing hash binding. A later changed preview resets adoption/staging/commit; an identical replay is idempotent. Legacy progress lacking a hash keeps same-job behavior, without guessing a binding from an adoption event. Invalid supplied/stored hashes do not authorize dependent progress. The module stores these semantic keys and up to 20,000 validated adopted object paths, never raw queries, source records or historical content in preferences. This bound limits guidance bookkeeping, not library size or import capacity. It is a navigation aid, not evidence that the user learned a topic or that product acceptance passed.

## Integration and remaining gap

The renderer restores local library configuration before hydrating guidance, and injects the same backed recovery storage into the object, research, changes and source components. Locale and the last workspace section are library preferences. Closing, opening the model editor and taking a backup flush pending configuration. Complete restore explicitly replaces local cached preferences, replaces the guide state without saving its old snapshot, and reloads components so restored recovery input remains authoritative. A configuration conflict offers local/saved choices; choosing saved explicitly reopens the workspace. Guidance persistence updates only its own DOM host. A successful research save refreshes the Changes badge without replacing the research form.

The historical paths canvas emits successful state/comparison/evidence observations, and its published dataset revision qualifies those operations. It does not yet provide a complete bridge from its fixed domain references into a reopenable research record. The guide directs that final action through **Objects and states**, whose research references include actual Git object/time/revision endpoints. It does not attach the current repository HEAD to an older package result or count an empty research note as completion. Closing this historical-path research bridge remains a product gap before full release acceptance.

## Verification

`onboarding.test.ts` covers ordered and unrelated events, replay, job changes, delayed hydration, dismissal/pause/resume, navigation without success, selective restart and failed/serialized persistence. Native review must additionally check section placement, English and Simplified Chinese wrapping, keyboard focus and preservation of active work. Those interface checks are separate from reducer tests.
