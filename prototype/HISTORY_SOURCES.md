# Historical version sample: scope, evidence and modeling decisions

Dataset: `ued-workbench-2026-10-25`. Checked on 25 October 2026. The executable data is in `src/history-content.ts`.

This review slice contains **8 branches, 28 recorded versions, 7 field definitions and 14 sources**. It supports computed snapshots, ancestry, field provenance and comparisons over authored historical records. It is not a complete chronology, territorial reconstruction or production historical database.

English is the primary authored language. Simplified Chinese values are translations of the authored content. Source titles and languages are retained. The following summaries paraphrase evidence; they are not source quotations.

## Version coverage

| Branch | Recorded years | Resolution window | Focus |
| --- | --- | --- | --- |
| `francia/main` | 751, 768, 771, 800, 814, 840 | 751–842 | Selected Carolingian succession and imperial title |
| `francia/west` | 843, 870 | 843–870 | Western outcome of Verdun and the Meerssen territorial change |
| `francia/middle` | 843, 855 | 843–855 | Middle kingdom and its division among Lothair I's sons |
| `francia/east` | 843, 870 | 843–870 | Eastern outcome of Verdun and the Meerssen territorial change |
| `francia/lotharingia` | 855, 869, 870 | 855–870 | Northern successor, disputed succession and partition |
| `abbasid/main` | 750, 762, 836, 892 | 750–892 | Selected dynasty and court-residence changes |
| `japan/main` | 710, 740, 744, 745, 784, 794 | 710–794 | Court relocations, including a return to an earlier capital |
| `tang/main` | 618, 755, 763 | 618–763 | Sampled foundation, rebellion and dynastic survival |

**A resolution window is a query boundary, not a claim of complete annual coverage.** A reference such as `francia/west@850` returns the latest authored record at or before 850, namely the record dated 843. The UI must show both the requested year and the recorded year. It must not relabel that record as independently verified in 850. Dates before or after the branch's window are rejected instead of silently inventing or extending history.

All fields describe the recorded model. An inherited value means that no later change to that field was authored along the selected parent path; it is not fresh historical evidence that the condition persisted in every intervening year. The engine retains the last-changing commit. Unknown values identify material **not recorded in this model**, rather than asserting that historians do not know it or that the thing did not exist.

## Claim and source mapping

| Records / fields | Evidence used |
| --- | --- |
| `francia-751`, `francia-768`, `francia-771`: rulers and Carolingian succession | [Met, France chronology](https://www.metmuseum.org/toah/ht/06/euwf), entry headed 751: Pippin's accession, divided inheritance and Charlemagne's sole rule |
| `francia-800`, `francia-814`: imperial title and Louis's succession | [Met, France chronology](https://www.metmuseum.org/toah/ht/06/euwf), entries 800 and 843–ca. 900 |
| `francia-840`: death and disputed inheritance | [Neue Deutsche Biographie, Lothar I](https://www.deutsche-biographie.de/gnd118780514.html?language=en), genealogical date and life section; [Wallonia, Verdun](https://connaitrelawallonie.wallonie.be/histoire/timeline/11-aout-843-le-partage-decisif-du-regnum-francorum-par-le-traite-de-verdun), succession conflict |
| `west-843`, `middle-843`, `east-843`: named rulers and three territorial outcomes | [Met, France chronology](https://www.metmuseum.org/toah/ht/06/euwf), entry 843–ca. 900; [Wallonia, Verdun](https://connaitrelawallonie.wallonie.be/histoire/timeline/11-aout-843-le-partage-decisif-du-regnum-francorum-par-le-traite-de-verdun) |
| `middle-855`, `lotharingia-855`: three successors and the northern share | [Neue Deutsche Biographie, Lothar I](https://www.deutsche-biographie.de/gnd118780514.html?language=en), Theodor Schieffer's NDB biography, final account of the 855 division: Italy to Louis II, northern lands to Lothair II, Provence/Burgundy to Charles |
| `lotharingia-869`: death of Lothair II and Charles's coronation claim | [Wallonia, Meerssen](https://connaitrelawallonie.wallonie.be/histoire/timeline/8-aout-870-le-traite-de-meerssen), first paragraph |
| `west-870`, `east-870`, `lotharingia-870`: territorial division | [Wallonia, Meerssen](https://connaitrelawallonie.wallonie.be/histoire/timeline/8-aout-870-le-traite-de-meerssen), settlement and the two shares |
| `abbasid-750`, `abbasid-762`, `abbasid-836`: dynasty and recorded residences | [Met, Abbasid period](https://www.metmuseum.org/essays/the-art-of-the-abbasid-period-750-1258); [Ashmolean, Historical Background](https://islamicceramics.ashmolean.org/Abbasid/history.htm), A.1–A.3 |
| `abbasid-892`: return from Samarra to Baghdad | [Qatar Museums, Stucco Decorations from Samarra](https://qm.org.qa/en/stories/all-stories/collection-highlight-abbasid-stucco-panel/), opening account of Samarra's capital role |
| `japan-710`: Nara location and planning | [Nara National Research Institute chronology](https://www.nabunken.go.jp/english/chronology.html), 710; [Met, Japan chronology](https://www.metmuseum.org/ko/toah/ht/06/eaj), 710 |
| `japan-740`, `japan-744`, `japan-745`: Kuni, Naniwa, return to Nara | [Nara National Research Institute chronology](https://www.nabunken.go.jp/english/chronology.html), corresponding entries; [Nara Palace Excavation Report XVII, English Summary](https://www.nabunken.go.jp/english/monograph/84.html), subphases 1-3 and 1-4 |
| `japan-784`, `japan-794`: Nagaoka and Heian | [Muko City guide](https://www.city.muko.kyoto.jp/uploaded/attachment/12617.pdf), Nagaoka Palace section; [Nara National Research Institute chronology](https://www.nabunken.go.jp/english/chronology.html) |
| `tang-618`: dynastic foundation | [Met, China chronology](https://www.metmuseum.org/toah/ht/06/eac), 618 |
| `tang-755`, `tang-763`: rebellion period and weakened court authority | [Library of Congress subject headings](https://www.loc.gov/aba/publications/Archived-LCSH38/C.pdf), China—History—An Lushan Rebellion, 755–763; [Met, Tang Dynasty](https://www.metmuseum.org/essays/tang-dynasty-618-906), account of the rebellion's impact |

## What the parent edges mean

- `francia-840` is the shared pre-settlement context for three outcomes of the same 843 settlement. The result is a pedagogical state graph, not three unrelated events or three children of a geographic region.
- `francia/main` compresses earlier succession. The 768 division is recorded within a shared context instead of expanding both brothers into separate branches. The 800 coronation changes the recorded title, not a territorial boundary.
- Middle Francia ends as one modeled political unit in 855. Only its northern successor is expanded; the unexpanded Italian and Provençal successors are named explicitly. Lotharingia is not synonymous with all of Middle Francia.
- Meerssen modifies both western and eastern states. Those versions inherit their respective branch histories; neither becomes the other's parent. Lotharingia's terminal record has a separate parent path. A shared event identifier links the records without claiming a state merge.
- The Lotharingia branch ends its **sample** at 870. The region's name and subsequent political history continue. Its terminal record must not be displayed as historical extinction.
- The Abbasid, Japanese and Tang paths have independent roots in this sample. Comparing them needs no common ancestor. Nara's use of continental planning is described as borrowing, not an ancestral relation between entire polities.
- No multi-parent integration or counterfactual authoring is supplied in this slice. Those remain separate product requirements; the existing data must not be described as covering every PRD relation type.

## Field-level decisions

- `politics.ruler` records individuals or explicit competing claims where the selected evidence supports them. It is deliberately unrecorded for the Abbasid, Japanese and Tang samples to avoid carrying one ruler through decades of unmodeled successions.
- `politics.dynasty` uses stable identities such as `carolingian`, independent of displayed prose. This makes a comparison reveal a shared ruling house even when rulers and territorial allocations differ.
- `politics.capital` is labeled **Court residence**. No single fixed Carolingian capital is invented. Rome's coronation site is not turned into a capital. Court-location samples for Japan and the Abbasids do not reconstruct every residence or coexisting political center.
- `territory.extent` provides qualitative descriptions only. The product's map remains geographic context, without historical territorial polygons. A geographical description inherited from a record is not a newly drawn border.
- `politics.condition` is labeled **Recorded context**. It records the context selected for that version: a succession dispute, a settlement, a court's relocation or return, or the aftermath of rebellion. In the court-location samples, a different value describes the recorded move; it does not independently establish a broader change in political institutions or power.
- `culture.planning` is recorded for Nara in 710, then set to unrecorded at the move to Kuni. Returning to Nara in 745 does not automatically restore the old planning value: the archaeological source describes altered palace arrangements.
- The Baghdad residence has the same stable key in 762 and 892; its recorded-context field distinguishes establishing a residence from returning to it. The Japanese Nara records in 710 and 745 work similarly. Equal endpoint values do not imply an unchanged location throughout the intervening period, and returning to a location does not establish that an entire past state was restored.

## Remaining limits and source cautions

- The sample contains long gaps. The Carolingian record omits conflicts during Louis the Pious's reign. The Abbasid record omits other residences and civil-war episodes (including Harun al-Rashid's residence near Raqqa described by the Ashmolean). The Tang path omits intermediate reigns and the Wu Zhou interruption. The as-of result must remain labeled as a recorded model, not verified year-by-year history.
- The 745 Japanese record represents the return to Nara. The brief Shigaraki phase is stated in the note rather than represented as another version in the same year. The Nara institute's chronology is used only for the relevant Japanese entries; its unrelated English An Lushan date is not adopted.
- The Met China chronology uses a narrower 755–759 event heading. The rebellion's overall 755–763 span follows the Library of Congress heading; the court's reduced authority follows the Met's separate Tang essay.
- The Met Japan chronology's sweeping civilizational language is not adopted. Only the specific dated capital and planning claims are used.
- The Deutsche Biographie page includes both NDB and an older ADB article. The model uses the NDB account of succession and partition, without adopting evaluative language about Lothair's personality or national destiny. Its page chrome can be English while the article is German.
- These institutional sources support the review slice. A production corpus requires richer specialist review and more granular source references. Source inclusion does not endorse every interpretation on its page.

## Suggested investigations

These are examples using the same generic query engine, not separate scripted answers:

- Compare `francia/west@843` with `francia/east@843`: rulers and territorial descriptions differ; the ruling house remains shared.
- Compare `francia/west@843` with `francia/west@870`: follow the changed territorial description back to Meerssen.
- Follow `francia/lotharingia@870` backwards: identify the 855 division before the 869 succession dispute.
- Compare `japan/main@710` with `japan/main@745`: the capital's name returns, while other recorded conditions differ and planning is no longer assumed.
- Compare `abbasid/main@762` with `abbasid/main@892`: residence returns to Baghdad through a different recorded path.
- Compare `abbasid/main@762` with `japan/main@794`: independent paths can be compared by shared fields without inventing a common ancestor.
