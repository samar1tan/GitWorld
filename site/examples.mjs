// Public website illustrations and terminal examples, tied to the shipped model.
const qualify = command => `history --model gitworld-curated-history --revision <commit-oid> ${command}`;
const capitalExample = {
    evidence: 'https://github.com/samar1tan/GitWorld/blob/main/data/README.md#scope-and-modeling-decisions',
    height: 310,
    nodes: [
      { id: 'tang-ca700', x: 260, y: 78, yearKey: 'approx700' },
      { id: 'japan-710', x: 70, y: 244, year: 710, selected: true },
      { id: 'japan-740', x: 150, y: 244, year: 740 },
      { id: 'japan-744', x: 230, y: 244, year: 744 },
      { id: 'japan-745', x: 310, y: 244, year: 745 },
      { id: 'japan-784', x: 390, y: 244, year: 784 },
      { id: 'japan-794', x: 470, y: 244, year: 794 },
    ],
    edges: [
      { from: 'tang-ca700', to: 'japan-710', kind: 'influence', d: 'M260 86C260 148 12 128 12 214Q12 244 58 244' },
      { from: 'japan-710', to: 'japan-740', kind: 'lineage', d: 'M70 244H150' },
      { from: 'japan-740', to: 'japan-744', kind: 'lineage', d: 'M150 244H230' },
      { from: 'japan-744', to: 'japan-745', kind: 'lineage', d: 'M230 244H310' },
      { from: 'japan-745', to: 'japan-784', kind: 'lineage', d: 'M310 244H390' },
      { from: 'japan-784', to: 'japan-794', kind: 'lineage', d: 'M390 244H470' },
    ],
    labels: [
      { key: 'tangRecord', x: 28, y: 30, className: 'graph-path-label' },
      { key: 'changan', x: 280, y: 83 },
      { key: 'changanPlanning', x: 280, y: 106, className: 'graph-detail' },
      { key: 'planningInfluence', x: 126, y: 154, className: 'graph-influence-label' },
      { key: 'japanPath', x: 28, y: 194, className: 'graph-path-label' },
      { key: 'nara', x: 70, y: 277, anchor: 'middle' },
      { key: 'kuni', x: 150, y: 277, anchor: 'middle' },
      { key: 'naniwa', x: 230, y: 277, anchor: 'middle' },
      { key: 'returnNara', x: 310, y: 277, anchor: 'middle' },
      { key: 'nagaoka', x: 390, y: 277, anchor: 'middle' },
      { key: 'heian', x: 470, y: 277, anchor: 'middle' },
    ],
    commands: {
      follow: qualify('log japan/main --graph'),
      checkout: qualify('checkout japan/main@710'),
      compare: qualify('diff tang/main@700 japan/main@710'),
    },
};

// Language changes presentation, never historical identity or command targets.
export const examples = { en: capitalExample, 'zh-CN': capitalExample };
