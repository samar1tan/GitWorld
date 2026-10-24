# Prototype content and map provenance

Dataset: `ued-workbench-2026-10-25` (overview records; version-state evidence is documented in [Historical sources](HISTORY_SOURCES.md)). Source pages checked on 25 October 2026.

This is a curated UED fixture: three available scopes, six processes and eighteen selected milestones within a 600–900 CE exploration window. It is not a survey of every region or process in world history. The broad scope labels are navigation areas; their two selected processes do not represent everything that happened there. The initial European path focuses on Carolingian succession.

English is the primary content language. Chinese text is our translation of the authored English summaries, not a quotation or an official translation of the sources. Source titles and original languages are retained. No source prose has been copied as a historical quotation.

## Historical content model

`src/content.ts` keeps historical prose, translations and provenance separate from interface messages and application state. Stable IDs identify scopes, processes, events, places and sources. Scope summaries link to processes; processes link to the events below. Each summary and event has `sourceIds` for inspection.

An event's `changes` are editorial before-and-after summaries supported by the cited sources. They are not results produced by a historical state engine. Process start/end dates delimit the selected story, not the entire lifetime of a dynasty or institution. The sequence does not imply that each event caused the next or that nothing happened between milestones.

| Scope / process | Stable event IDs | Claims used | Sources |
| --- | --- | --- | --- |
| Europe / Carolingian succession | `charlemagne-768`, `imperial-coronation-800`, `louis-succeeds-814` | Divided succession after Pippin; Charlemagne's imperial coronation; Louis's succession | [Met: France](https://www.metmuseum.org/toah/ht/06/euwf) |
| Europe / Carolingian succession | `verdun-843` | Negotiated partition into western, middle and eastern kingdoms | [Met: France](https://www.metmuseum.org/toah/ht/06/euwf), [Wallonia: Verdun](https://connaitrelawallonie.wallonie.be/histoire/timeline/11-aout-843-le-partage-decisif-du-regnum-francorum-par-le-traite-de-verdun) |
| Europe / Carolingian succession | `meerssen-870` | Charles and Louis partition Lotharingia after Lothair II's death | [Wallonia: Meerssen](https://connaitrelawallonie.wallonie.be/histoire/timeline/8-aout-870-le-traite-de-meerssen) |
| Europe / A dynasty and the papacy | `pepin-751`, `papal-anointing-754` | Pippin's accession and papal anointing of him and his sons | [Met: France](https://www.metmuseum.org/toah/ht/06/euwf), [KCL: Pepin 1](https://pbe.kcl.ac.uk/data/D62/F29.htm) |
| Mediterranean & West Asia / The Abbasid court moves east | `abbasid-revolution-750`, `baghdad-762`, `samarra-836` | Change of dynasty in the east; Baghdad as the capital; move of the court to Samarra | [Ashmolean: Historical background](https://islamicceramics.ashmolean.org/Abbasid/history.htm), [Met: Abbasid period](https://www.metmuseum.org/essays/the-art-of-the-abbasid-period-750-1258) |
| Mediterranean & West Asia / An Umayyad line in al-Andalus | `cordoba-emirate-756`, `cordoba-mosque-785` | Abd al-Rahman I's emirate and the beginning of the Great Mosque | [Met: Iberian Peninsula](https://www.metmuseum.org/ko/toah/ht/06/eusi), [Ashmolean](https://islamicceramics.ashmolean.org/Abbasid/history.htm) |
| East Asia / Tang rule through rebellion | `tang-founded-618`, `an-lushan-755`, `rebellion-ends-763` | Tang foundation; rebellion's beginning and end; continued dynasty with weakened court power | [Met: China](https://www.metmuseum.org/toah/ht/06/eac), [Met: Tang dynasty](https://www.metmuseum.org/ja/essays/tang-dynasty-618-906), [Library of Congress subject heading](https://www.loc.gov/aba/publications/Archived-LCSH38/C.pdf) |
| East Asia / Three Japanese court capitals | `nara-710`, `nagaoka-784`, `heian-794` | Nara's planning relationship to Chang'an; transfers to Nagaoka and Heian | [Met: Japan](https://www.metmuseum.org/ko/toah/ht/06/eaj), [Muko City guide](https://www.city.muko.kyoto.jp/uploaded/attachment/12617.pdf) |

## Editorial boundaries and source cautions

- The selected institutions are not interchangeable with modern nation-states. The prototype draws no historical borders or ancestry lines between medieval realms and modern countries.
- In 768 Charlemagne shares the inheritance with Carloman. His sole rule begins in 771; the event note exposes that omitted milestone.
- The 800 coronation changes a title. It is not presented as an automatic territorial change or a merger with ancient Rome.
- Verdun's three kingdoms are a useful abstract grouping. Meerssen divides Lotharingia, **not all of Middle Francia**. The changes between 843 and 870 are explicitly omitted rather than silently treating the 843 middle kingdom as unchanged.
- The Abbasid and Umayyad processes overlap: the Umayyad line in al-Andalus prevents the simplified dynasty change in 750 from implying that the lineage vanished everywhere. Neither scope implies uniform control across Iberia or the Mediterranean.
- The Ashmolean account distinguishes earlier construction at Baghdad from the court taking up residence in 762. The fixture says that Baghdad becomes the capital, without dating its first construction.
- The Met China chronology labels an An Lushan entry 755–759. The fixture uses the Library of Congress's established subject heading **755–763** for the overall rebellion and the separate Met Tang essay for the court's weakened authority afterwards. It does not rely on the chronology's narrower entry for the end date.
- The KCL Pepin entry distinguishes accession in 751 from the papal ceremony in 754. The fixture follows that distinction and makes no claim that his sons were already ruling independently in 754.
- The Japanese sequence is about court locations and city planning. It does not equate the extent of court authority with the modern Japanese state's borders. The Met's dated and sometimes sweeping cultural descriptions are not reproduced.
- The `met-japan`, `met-iberia` and `met-tang` URLs contain `/ko/` or `/ja/`, but their cited article bodies were served in English when checked. `language: 'en'` describes the inspected content. The Wallonia sources are French; the other selected historical sources are English.
- These institutional secondary sources support a UED review, not a completed historical corpus. Production curation still needs specialist review and richer claim-level citations, including pagination where applicable. A source reference is not a claim that every interpretation on its page has been adopted.

## Geographic asset

`public/world-land.svg` is an offline land outline derived from **Natural Earth, 1:110 million**, as distributed in [`world-atlas@2.0.2/land-110m.json`](https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json). [world-atlas](https://github.com/topojson/world-atlas) provides the TopoJSON conversion. Only the `land` object is used: there are no modern administrative or political borders.

The SVG uses the Natural Earth I projection in a `0 0 1000 520` viewport. The sphere is fitted to `[[20, 20], [980, 500]]`; resulting scale is `168.73003501102286`, translation `[500, 260]`. Land paths are rounded to two decimal places. The scope locations and `mapPlaces` use this same projection.

The coastline is a generalized modern geographic reference, not a reconstruction of 600–900 shorelines. Place coordinates are approximate navigation points around present-day city locations, not archaeological site coordinates. A point does not claim a single political center for a region. Closely situated Japanese court locations need grouped or displaced labels at this scale.

To regenerate the path with the pinned build dependencies:

```js
import { geoNaturalEarth1, geoPath } from 'd3-geo'; // 3.1.1
import { feature } from 'topojson-client'; // 3.1.0
// Load world-atlas 2.0.2 / land-110m.json as topology.
const projection = geoNaturalEarth1()
  .fitExtent([[20, 20], [980, 500]], { type: 'Sphere' });
const land = feature(topology, topology.objects.land);
const d = geoPath(projection).digits(2)(land);
```

Only the resulting SVG is needed at runtime. No map service, map API key, package download or external image request is required to display it.

### Licensing

Natural Earth map data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). Attribution retained here: **Made with Natural Earth.**

The `world-atlas` distribution supplies this ISC license, retained for provenance:

```text
Copyright 2013-2019 Michael Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```
