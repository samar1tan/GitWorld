// Case identity and historical references remain independent of presentation language.
const qualify = command => 'history --model gitworld-curated-history --revision <commit-oid> ' + command;

export const defaultCaseId = 'china-japan';
export const cases = [
  {
    id: 'frankish-partition', labelKey: 'frankishTab', themeKey: 'frankishTheme',
    titleKey: 'frankishQuestion', yearsKey: 'frankishYears', insightKey: 'frankishInsight',
    descriptionKey: 'frankishDescription', noteKey: 'frankishNote',
    operationKeys: ['frankishFollow', 'frankishCheckout', 'frankishCompare'],
    bodyKeys: ['frankishFollowBody', 'frankishCheckoutBody', 'frankishCompareBody'],
    fieldIds: ['politics.ruler', 'politics.form', 'territory.extent'],
    evidence: 'https://github.com/samar1tan/GitWorld/blob/main/data/README.md#scope-and-modeling-decisions',
    height: 330, follow: 'francia/west',
    initial: { selected: 'west-843', a: 'west-843', b: 'east-843' },
    nodes: [
      { id: 'francia-751', ref: 'francia/main@751', x: 60, y: 70, year: 751, labelKey: 'pippin' },
      { id: 'francia-800', ref: 'francia/main@800', x: 185, y: 70, year: 800, labelKey: 'charlemagne' },
      { id: 'francia-840', ref: 'francia/main@840', x: 310, y: 70, year: 840, labelKey: 'successionConflict' },
      { id: 'west-843', ref: 'francia/west@843', x: 465, y: 70, year: 843, labelKey: 'westFrancia' },
      { id: 'middle-843', ref: 'francia/middle@843', x: 465, y: 165, year: 843, labelKey: 'middleFrancia' },
      { id: 'east-843', ref: 'francia/east@843', x: 465, y: 260, year: 843, labelKey: 'eastFrancia' },
      { id: 'west-870', ref: 'francia/west@870', x: 595, y: 70, year: 870, labelKey: 'westernShare' },
      { id: 'east-870', ref: 'francia/east@870', x: 595, y: 260, year: 870, labelKey: 'easternShare' },
    ],
    edges: [
      { from: 'francia-751', to: 'francia-800', kind: 'lineage', condensed: true, d: 'M60 70H185' },
      { from: 'francia-800', to: 'francia-840', kind: 'lineage', condensed: true, d: 'M185 70H310' },
      { from: 'francia-840', to: 'west-843', kind: 'lineage', d: 'M310 70H465' },
      { from: 'francia-840', to: 'middle-843', kind: 'lineage', d: 'M310 70C370 70 365 165 465 165' },
      { from: 'francia-840', to: 'east-843', kind: 'lineage', d: 'M310 70C350 70 345 260 465 260' },
      { from: 'west-843', to: 'west-870', kind: 'lineage', d: 'M465 70H595' },
      { from: 'east-843', to: 'east-870', kind: 'lineage', d: 'M465 260H595' },
    ], labels: [],
  },
  {
    id: 'china-japan', labelKey: 'chinaJapanTab', themeKey: 'chinaJapanTheme',
    titleKey: 'chinaJapanQuestion', yearsKey: 'chinaJapanYears', insightKey: 'chinaJapanInsight',
    descriptionKey: 'chinaJapanDescription', noteKey: 'chinaJapanNote',
    operationKeys: ['chinaJapanFollow', 'chinaJapanCheckout', 'chinaJapanCompare'],
    bodyKeys: ['chinaJapanFollowBody', 'chinaJapanCheckoutBody', 'chinaJapanCompareBody'],
    fieldIds: ['politics.capital', 'culture.planning'],
    evidence: 'https://github.com/samar1tan/GitWorld/blob/main/data/README.md#scope-and-modeling-decisions',
    height: 330, follow: 'japan/main',
    initial: { selected: 'japan-710', a: 'tang-ca700', b: 'japan-710' },
    nodes: [
      { id: 'tang-ca700', ref: 'tang/main@700', x: 260, y: 75, yearKey: 'approx700', labelKey: 'changan', labelX: 285, labelY: 80, anchor: 'start' },
      { id: 'japan-710', ref: 'japan/main@710', x: 80, y: 245, year: 710, labelKey: 'nara' },
      { id: 'japan-740', ref: 'japan/main@740', x: 180, y: 245, year: 740, labelKey: 'kuni' },
      { id: 'japan-744', ref: 'japan/main@744', x: 280, y: 245, year: 744, labelKey: 'naniwa' },
      { id: 'japan-745', ref: 'japan/main@745', x: 380, y: 245, year: 745, labelKey: 'returnNara' },
      { id: 'japan-784', ref: 'japan/main@784', x: 480, y: 245, year: 784, labelKey: 'nagaoka' },
      { id: 'japan-794', ref: 'japan/main@794', x: 580, y: 245, year: 794, labelKey: 'heian' },
    ],
    edges: [
      { from: 'tang-ca700', to: 'japan-710', kind: 'influence', d: 'M260 84C260 144 22 132 22 215Q22 245 67 245' },
      { from: 'japan-710', to: 'japan-740', kind: 'lineage', d: 'M80 245H180' },
      { from: 'japan-740', to: 'japan-744', kind: 'lineage', d: 'M180 245H280' },
      { from: 'japan-744', to: 'japan-745', kind: 'lineage', d: 'M280 245H380' },
      { from: 'japan-745', to: 'japan-784', kind: 'lineage', d: 'M380 245H480' },
      { from: 'japan-784', to: 'japan-794', kind: 'lineage', d: 'M480 245H580' },
    ],
    labels: [
      { key: 'tangRecord', x: 28, y: 30, className: 'graph-path-label' },
      { key: 'changanPlanning', x: 285, y: 104, className: 'graph-detail' },
      { key: 'planningInfluence', x: 140, y: 152, className: 'graph-influence-label' },
      { key: 'japanPath', x: 28, y: 195, className: 'graph-path-label' },
    ],
  },
  {
    id: 'abbasid-court', labelKey: 'abbasidTab', themeKey: 'abbasidTheme',
    titleKey: 'abbasidQuestion', yearsKey: 'abbasidYears', insightKey: 'abbasidInsight',
    descriptionKey: 'abbasidDescription', noteKey: 'abbasidNote',
    operationKeys: ['abbasidFollow', 'abbasidCheckout', 'abbasidCompare'],
    bodyKeys: ['abbasidFollowBody', 'abbasidCheckoutBody', 'abbasidCompareBody'],
    fieldIds: ['politics.capital', 'politics.form', 'politics.condition'],
    evidence: 'https://github.com/samar1tan/GitWorld/blob/main/data/README.md#scope-and-modeling-decisions',
    height: 260, follow: 'abbasid/main',
    initial: { selected: 'abbasid-836', a: 'abbasid-762', b: 'abbasid-892' },
    nodes: [
      { id: 'abbasid-750', ref: 'abbasid/main@750', x: 75, y: 125, year: 750, labelKey: 'abbasidAccession' },
      { id: 'abbasid-762', ref: 'abbasid/main@762', x: 245, y: 125, year: 762, labelKey: 'baghdad' },
      { id: 'abbasid-836', ref: 'abbasid/main@836', x: 410, y: 125, year: 836, labelKey: 'samarra' },
      { id: 'abbasid-892', ref: 'abbasid/main@892', x: 575, y: 125, year: 892, labelKey: 'baghdadAgain' },
    ],
    edges: [
      { from: 'abbasid-750', to: 'abbasid-762', kind: 'lineage', d: 'M75 125H245' },
      { from: 'abbasid-762', to: 'abbasid-836', kind: 'lineage', d: 'M245 125H410' },
      { from: 'abbasid-836', to: 'abbasid-892', kind: 'lineage', d: 'M410 125H575' },
    ], labels: [],
  },
];

export function getExample(id) { return cases.find(item => item.id === id) ?? cases.find(item => item.id === defaultCaseId); }
export function initialSelection(id) { return { caseId: getExample(id).id, ...getExample(id).initial }; }
export function commandsForExample(example, selection = example.initial) {
  const ref = id => example.nodes.find(node => node.id === id)?.ref;
  return { follow: qualify('log ' + example.follow + ' --graph'), checkout: qualify('checkout ' + ref(selection.selected)), compare: qualify('diff ' + ref(selection.a) + ' ' + ref(selection.b)) };
}
// Both locales point to the same case definitions; display text lives in locales.mjs.
export const examples = { en: cases, 'zh-CN': cases };
