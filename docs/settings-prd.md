# Settings module requirements

Document revision **v0.1** · Product scope **v0.1** · 25 October 2026

Status: the configuration service, identity path, standalone settings interface and host coordination are implemented. Overall workbench design convergence and installed acceptance remain pending. Module tests do not establish that the controls are available in a delivered package. This document accompanies the [main PRD](PRD.md) and [onboarding requirements](onboarding-prd.md).

## Purpose

A learner can make GitWorld comfortable to read, control guidance, identify their own contributions and maintain their local library without finding internal files. Settings remain part of the installed workbench. No account, GitHub connection, system Git configuration or developer checkout is required.

The contributor profile identifies the person making a modern data revision. It never identifies the author of a historical source, a historical ruler or the owner of a historical branch. The application's maintainers are not the default identity of installed users.

## Entry and organization

Provide a persistent Settings entry and the macOS Settings menu command (`Command+,`). Keep the same global library/revision context. On narrow windows the category list collapses without hiding Save, validation or return navigation. Opening Settings preserves the previous investigation, checked historical state and A/B. Closing returns to that context.

Use four categories with specific responsibilities:

| Category | v0.1 controls and information | Default and behavior |
| --- | --- | --- |
| General | Interface language; interface zoom; startup behavior; reduced motion | English/Simplified Chinese; 100% zoom with reset; resume the last workspace; follow the OS motion preference. Apply display changes immediately without losing form input. |
| Learning | Contextual tips; resume/restart the first-investigation journey; acquired-data journey | Tips initially on, journeys optional. Restart affects guidance progress only. Turning tips off leaves the Guide entry available. |
| Contributor | Display/author name and commit email; current author preview | Local placeholder `Local researcher <local@gitworld.invalid>` is explicit and editable. Changes apply to future commits. No existing commit or historical content is rewritten. |

“Open all-material overview” opens the current Working collection's Scope overview, with the data-driven initial kind choice defined by the [scope contract](scope-workspace-prd.md). It resets navigation filters while retaining fixed historical checkout/A/B, rather than opening an independently covered model artifact. The previous stored `world` identifier remains compatible; resume is still the default.
| Library | Location and storage summary; complete backup and restore; application version/build and dependency notices | Existing library remains local. Reuse the real backup/restore service and native file chooser. Show accurate state and a way back to the investigation. |

Settings labels and inline messages must be complete in English and Simplified Chinese. A category is visible only when it has working content. Do not add empty Accounts, Sync, AI, Plugins or future-theme sections.

The v0.1 appearance follows the accepted near-black/gray/blue workbench. A theme gallery, arbitrary font stack and rearrangeable preference schema are outside this delivery. Existing native zoom shortcuts and the Settings zoom value must agree.

Learning controls use the guide's explicit preference and journey APIs. Synchronizing saved tip preferences preserves progress, dismissed tips and pending guide writes without issuing another profile save. Guide-originated tip changes use the same Learning-settings save operation and retain their old value on failure. Resume selects and opens the requested journey and releases pause; Restart opens its confirmation in Guide, so one Settings click never clears progress. Settings and Guide must not simulate button events to operate each other.

## Required journeys

1. **Make the workspace readable.** Open Settings while a comparison is selected, change language and zoom, return to the same comparison, then restart. Labels, layout and persisted preferences agree. Display changes cannot erase unsaved research input or move comparison endpoints.
2. **Control help.** Pause the journey, turn contextual tips off and return to exploration. Guidance stays closed after restart. Reopen it through Guide or Learning; resume at the observed progress. Restart the journey deliberately and retain all historical/research data.
3. **Set a contributor identity.** Inspect the author preview, enter a name and email and save. Commit a real selected change. The new commit contains that identity; an earlier commit keeps its original author. No network authentication is implied. The commit form links to this setting when the author needs changing.
4. **Maintain the library.** Inspect the actual library location and measured storage summary, create a full `.gitworld` backup, then restore with a clear description of what will be replaced. Validate before replacement, preserve recovery on failure and return to a coherent restored workspace. Preferences, journey progress and recoverable research input belong to that full-library backup.
5. **Recover from an invalid change.** Reject invalid identity or unsupported setting values beside the affected field, retain the user's input and offer a clear correction. A failed write cannot display Saved or silently reset other settings.

The library recovery case must also cover an exploration workspace pinned to a real Git model revision, committed acquired-source records and distinct staged B/working C research. A new native Save destination must produce a full backup, and restoration into an empty library must recover the exact model/references and both forms of research. Validate Git-qualified workspace references against the requested revision in the backed-up candidate, rather than requiring a matching SQLite release or substituting current HEAD. An invalid candidate must preserve the previous library. A failed backup must retain the source data, clear the operation state and permit retry; source and desktop-runtime tests remain separate from native acceptance.

## Identity contract

- A local author name and email are metadata, not proof of ownership or a verified identity. The interface must not display a verified-account badge.
- Explain beside the email field that its value is recorded in future commits and is included when those commits are shared. A synthetic local address is allowed; a public email is not required.
- Validate name length and control characters using the same contract as the embedded Git layer. Validate email shape/length without claiming deliverability. Preserve Unicode names. Reject line breaks and values that could become Git header content.
- Use only the application-owned repository. Never read or mutate global/system Git identity as a side effect.
- When saving, apply the complete name/email pair atomically. A concurrent edit produces a recoverable conflict. A commit captures one valid identity; a later settings change cannot alter a pending or completed retry's author.
- A local identity is part of the selected library's configuration. A future multiple-library profile model requires a new requirement revision. Restoring a complete library restores its contributor profile and explicitly states this in the restore summary.

## Persistence and application boundary

Settings, guidance progress and recoverable interface input are local configuration outside the authored data repository. Changing zoom or completing a tutorial never adds a data commit or a historical event. Use typed, bounded service operations; the renderer cannot choose configuration paths, SQL, Git environment variables or arbitrary shell commands.

Use stable keys and a versioned configuration schema. Writes are atomic and protect newer edits from stale values. Invalid/corrupt configuration must produce a recoverable error while preserving the file; do not silently erase it. Keep credentials and signing material out of settings exports. No credentials are required for the v0.1 local author profile.

Window geometry and per-display placement remain machine preferences. Full-library backups include learning preferences, navigation/research recovery and contributor identity, while imported geometry is fitted to the current display. Resetting a category affects that category alone; no Reset everything or library deletion is necessary for v0.1.

## Data acquisition settings

The source workflow retains its explicit scope, batch and review choices. Provider-required retry/backoff limits are enforced by the service; a settings control cannot disable them. Acquired claims remain unreviewed by default. Offline local reading/editing stays available when acquisition is unavailable.

Proxy management, credential storage, source scheduling, arbitrary provider endpoints and cache deletion are deferred until they have complete supported workflows and their own requirements. Supported source details and active jobs belong to Find data, with links from Library where useful. Do not add a settings page of inert provider switches.

## Acceptance

| ID | Required evidence |
| --- | --- |
| S01 | Settings is discoverable through the UI and native shortcut; return preserves investigation, checked state, A/B and unfinished input. |
| S02 | Change language and zoom in the installed app, check both target window sizes/locales, restart and verify the result and matching native shortcut state. |
| S03 | Pause, resume, restart and disable tips; restart and full-library restore retain the chosen behavior without modifying content. |
| S04 | Save a Unicode contributor name and valid local email, create a commit, inspect its author and an unchanged prior commit; reject malformed input without losing edits. |
| S05 | Back up and restore preferences, guide progress, navigation, research input and content together; a failed restore/write preserves the previous usable library. |
| S06 | Verify no network/account/system-Git dependency, no unimplemented controls, no settings values in public source/release receipts and no misleading success state. |

Root owns integration and requirements; Casey independently reviews discoverability, copy and complete journeys, and Morgan reviews persistence/identity/recovery. Installed evidence remains required before these rows are marked passed.

## Design work threshold

The entry, categories, apply/save behavior and return path above are sufficiently concrete for a first implementation review. A separate Settings UED artifact is not required at this point. Update the existing workbench UED if implementation exposes unresolved focus/navigation questions or changes the global shell. Explicit user requests and changes larger than a module always require corresponding UED work.

## Implementation boundary

The versioned `library-settings.json` profile is outside the authored repository and is included in full-library backup/restore. It contains General, Learning and Contributor sections. Section updates compare the expected profile version and preserve unrelated sections; malformed files are retained and rejected. Existing locale/tips values supply first-use defaults when no profile exists. Journey progress remains in the backed-up client-state document. The shared identity validator rejects control characters and header delimiters; a new commit captures the saved identity, while an already prepared operation retains its existing commit object and author.

The standalone settings module provides typed callbacks for applying locale/display preferences, continuing or restarting guidance, transfer coordination and shell return. The current shell connects the native Settings command, View zoom synchronization, startup/motion behavior, Guide/tips entry, build/notices information and the commit form's identity link. Overall workbench design review and the complete installed journeys above remain required. No S row is passed by this implementation note.

The desktop host admits native zoom actions through a tested coordinator. Closing and library transfer reject new actions while completing actions already accepted. Backup starts after those writes; restore then changes the library epoch before dispatch, allowing a restored profile to have a lower version without accepting late callbacks from the previous library. Cancellation while the host is draining prevents the transfer from reaching the service and reports that outcome. Failed operations restore maintenance/menu state. Regression tests use real local services and complete backups with delayed replies; native menu smoke additionally compares the stored zoom with the actual window factor. These are engineering checks, separate from the installed journeys and design review.
