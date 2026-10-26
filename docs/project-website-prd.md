# Project website

The GitHub Pages site is a maintained product entry point. It introduces the desktop learning workflow, connects examples to shipped capabilities, and leads visitors to the current public preview or source. Its content and visual identity must stay aligned with the app and README.

## Current iteration

Language selection translates the same Chang’an/Japanese capital case while preserving the learning scenario.

| Element | Required behavior |
| --- | --- |
| Identity | Reuse the existing GitWorld master icon in the header and its optical small variant as the browser icon. Keep assets local and derive them from the same sources as the desktop build. A keyboard symbol must not stand in for the product logo. |
| Chinese entry | Introduce China- and Japan-related material as starting research scopes. Use the Chang’an/Japanese court example for the illustration, operation descriptions and command examples. This example does not represent the extent of the collection. |
| Historical meaning | Label Chang’an as an approximate city-planning observation around 700. A dashed, explicitly labeled influence arrow connects it to Nara in 710. Solid edges continue the Japanese court’s recorded capital states; they do not make Japan a descendant of Tang. Cite the existing source/model notes. |
| English entry | Present the same Chang’an/Japanese capital case as Chinese: approximately 700–794, six Japanese observations, identical stable refs, commands and evidence. Language selection changes presentation only. |
| Actions | The public desktop preview is the primary action while verified release metadata is absent. Source and requirements remain available. Preserve the verified-release validation boundary. |
| Commands | Use supported, explicitly qualified `history` commands. Explain the commit-OID placeholder once. Examples are instructions for the desktop terminal, not simulated website controls. |

## Interaction and layout

The masthead retains a recognizable icon, name, source link and language switch. The opening section pairs the user’s starting point with one historical illustration. Three operation cards explain following a path, checking out a state and comparing two states. Local editing and evidence notes follow.

Illustrations have distinct solid and dashed relationships, readable dates and concise labels. On narrow screens, the diagram can scroll within its own labeled, keyboard-focusable region instead of shrinking labels or widening the page. Drawn nodes are illustrative, without button styling or implied click behavior.

Language selection remains available at mobile widths. Both locales must survive repeated switching and show matching text, figure, commands, page title and accessible names. This iteration does not add country-selection controls, a second app, automatic translation or new historical records.

The Chinese entry is directly addressable at `?lang=zh-CN`. Switching language updates that URL without creating extra browser-history entries; reload retains the chosen entry. The default URL remains English.

## Acceptance

- Header and browser icons load from the canonical desktop artwork; the deployed site serves the expected SVG bytes.
- Both locales present China/Japan scopes and the same sourced Chang’an–Nara relationship, dates and six Japanese capital observations. All three command descriptions and commands agree with the active case.
- Commands are checked against the shipped model and command interpreter. Approximate dates, influence and lineage remain distinct.
- Inspect the actual rendered page and operate the language switch, keyboard navigation and links in both locales at desktop and mobile widths. Check that labels, actions and diagram text remain legible without page-wide overflow.
- Verify the deployed preview link and maintain `site/release.json` as `null` until the existing full acceptance gate is satisfied. A website revision does not imply a new app release or broader installed acceptance.

## Maintenance

The website is part of normal project delivery alongside the app, README and Issues. Review affected copy, assets, examples, downloads and localization when product behavior or release status changes. Record concrete website defects in Issues, link the fixing PR, and verify the deployed result after a change.
