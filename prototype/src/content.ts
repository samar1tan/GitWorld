import { HISTORY_DATASET_VERSION } from './history-content.ts';

export type Locale = 'en' | 'zh-CN';
export type LocalizedText = Record<Locale, string>;
export type Source = { id: string; title: string; url: string; publisher: string; language: string };
export type MapBox = { x: number; y: number; width: number; height: number };
export type MapPlace = {
  id: string; name: LocalizedText; scopeIds: string[];
  longitude: number; latitude: number; location: { x: number; y: number };
};
export type HistoricalScope = {
  id: string; name: LocalizedText; summary: LocalizedText;
  location: { x: number; y: number }; viewBox: MapBox;
  processIds: string[]; sourceIds: string[];
  subjects: LocalizedText[];
};
export type HistoricalProcess = {
  id: string; scopeId: string; name: LocalizedText; summary: LocalizedText;
  start: number; end: number; eventIds: string[]; sourceIds: string[];
};
export type HistoricalEvent = {
  id: string; processId: string; year: number; title: LocalizedText; summary: LocalizedText;
  changes: { label: LocalizedText; before: LocalizedText; after: LocalizedText }[];
  sourceIds: string[]; note?: LocalizedText;
};

export const datasetVersion = HISTORY_DATASET_VERSION;
const t = (en: string, zh: string): LocalizedText => ({ en, 'zh-CN': zh });

export const sources: Record<string, Source> = {
  'met-france': { id: 'met-france', title: 'France, 500–1000 A.D.', url: 'https://www.metmuseum.org/toah/ht/06/euwf', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'ashmolean-abbasid': { id: 'ashmolean-abbasid', title: 'Abbasid Ceramics: The Historical Background', url: 'https://islamicceramics.ashmolean.org/Abbasid/history.htm', publisher: 'Ashmolean Museum, University of Oxford', language: 'en' },
  'met-abbasid': { id: 'met-abbasid', title: 'The Art of the Abbasid Period (750–1258)', url: 'https://www.metmuseum.org/essays/the-art-of-the-abbasid-period-750-1258', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'met-china': { id: 'met-china', title: 'China, 500–1000 A.D.', url: 'https://www.metmuseum.org/toah/ht/06/eac', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'met-japan': { id: 'met-japan', title: 'Japan, 500–1000 A.D.', url: 'https://www.metmuseum.org/ko/toah/ht/06/eaj', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'kcl-pepin': { id: 'kcl-pepin', title: 'Pepin 1', url: 'https://pbe.kcl.ac.uk/data/D62/F29.htm', publisher: 'Prosopography of the Byzantine Empire, King’s College London', language: 'en' },
  'wallonia-verdun': { id: 'wallonia-verdun', title: 'Le partage décisif du Regnum Francorum par le Traité de Verdun', url: 'https://connaitrelawallonie.wallonie.be/histoire/timeline/11-aout-843-le-partage-decisif-du-regnum-francorum-par-le-traite-de-verdun', publisher: 'Connaître la Wallonie / Institut Destrée; Paul Delforge', language: 'fr' },
  'wallonia-meerssen': { id: 'wallonia-meerssen', title: 'Le traité de Meerssen', url: 'https://connaitrelawallonie.wallonie.be/histoire/timeline/8-aout-870-le-traite-de-meerssen', publisher: 'Connaître la Wallonie / Institut Destrée; Paul Delforge', language: 'fr' },
  'met-iberia': { id: 'met-iberia', title: 'Iberian Peninsula, 500–1000 A.D.', url: 'https://www.metmuseum.org/ko/toah/ht/06/eusi', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'met-tang': { id: 'met-tang', title: 'Tang Dynasty (618–907)', url: 'https://www.metmuseum.org/ja/essays/tang-dynasty-618-906', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'loc-an-lushan': { id: 'loc-an-lushan', title: 'Library of Congress Subject Headings: China—History—An Lushan Rebellion, 755–763', url: 'https://www.loc.gov/aba/publications/Archived-LCSH38/C.pdf', publisher: 'Library of Congress', language: 'en' },
  'muko-capitals': { id: 'muko-capitals', title: 'Muko City: Guide to the City', url: 'https://www.city.muko.kyoto.jp/uploaded/attachment/12617.pdf', publisher: 'Muko City', language: 'en' },
  'nabunken-chronology': { id: 'nabunken-chronology', title: 'Chronology — Asuka & Nara', url: 'https://www.nabunken.go.jp/english/chronology.html', publisher: 'Nara National Research Institute for Cultural Properties', language: 'en' },
  'qatar-samarra': { id: 'qatar-samarra', title: 'Artistry in Abbasid Architecture: The Stucco Decorations from Samarra', url: 'https://qm.org.qa/en/stories/all-stories/collection-highlight-abbasid-stucco-panel/', publisher: 'Qatar Museums', language: 'en' },
};

export const scopes: HistoricalScope[] = [
  { id: 'europe', name: t('Europe', '欧洲'),
    summary: t('Frankish rulers build an imperial claim; inheritance and negotiated partitions reshape their realm.', '法兰克统治者确立帝国名号；继承与协商分割不断重塑其领地。'),
    location: { x: 518, y: 115 }, viewBox: { x: 447, y: 54, width: 167, height: 133 },
    processIds: ['carolingian-succession', 'frankish-papal-alliance'], sourceIds: ['met-france', 'wallonia-verdun', 'wallonia-meerssen'],
    subjects: [t('Carolingian rulers', '加洛林统治者'), t('Papacy in Rome', '罗马教廷'), t('Successor kingdoms', '分割后的诸王国')] },
  { id: 'west-asia', name: t('Mediterranean & West Asia', '地中海与西亚'),
    summary: t('The Abbasids take power in the east while an Umayyad ruler establishes a new base in al-Andalus.', '阿拔斯在东方掌权，一位倭马亚统治者则在安达卢斯建立新的统治中心。'),
    location: { x: 580, y: 159 }, viewBox: { x: 453, y: 101, width: 228, height: 131 },
    processIds: ['abbasid-court', 'umayyad-andalus'], sourceIds: ['ashmolean-abbasid', 'met-abbasid', 'met-iberia'],
    subjects: [t('Abbasid court', '阿拔斯宫廷'), t('Baghdad and Samarra', '巴格达与萨迈拉'), t('Umayyads in Córdoba', '科尔多瓦的倭马亚统治者')] },
  { id: 'east-asia', name: t('East Asia', '东亚'),
    summary: t('Tang rule changes through rebellion, while Japanese court capitals draw on and adapt continental planning.', '唐朝统治经历叛乱与调整；日本朝廷的都城规划吸收并改造大陆经验。'),
    location: { x: 780, y: 156 }, viewBox: { x: 686, y: 95, width: 211, height: 136 },
    processIds: ['tang-transformation', 'japan-court-capitals'], sourceIds: ['met-china', 'met-japan'],
    subjects: [t('Tang court', '唐朝朝廷'), t('Continental connections', '大陆联系'), t('Japanese court capitals', '日本朝廷的都城')] },
];

// Approximate navigation locations, not archaeological coordinates or political centers.
// Projected with geoNaturalEarth1 into the same 1000 × 520 viewport as world-land.svg.
export const mapPlaces: MapPlace[] = [
  { id: 'aachen', name: t('Aachen', '亚琛'), scopeIds: ['europe'], longitude: 6.08, latitude: 50.78, location: { x: 513.60, y: 109.45 } },
  { id: 'rome', name: t('Rome', '罗马'), scopeIds: ['europe', 'west-asia'], longitude: 12.5, latitude: 41.9, location: { x: 529.31, y: 135.30 } },
  { id: 'baghdad', name: t('Baghdad', '巴格达'), scopeIds: ['west-asia'], longitude: 44.4, latitude: 33.3, location: { x: 607.81, y: 160.86 } },
  { id: 'samarra', name: t('Samarra', '萨迈拉'), scopeIds: ['west-asia'], longitude: 43.88, latitude: 34.2, location: { x: 606.21, y: 158.17 } },
  { id: 'cordoba', name: t('Córdoba', '科尔多瓦'), scopeIds: ['west-asia'], longitude: -4.78, latitude: 37.88, location: { x: 488.59, y: 147.21 } },
  { id: 'changan', name: t('Chang’an', '长安'), scopeIds: ['east-asia'], longitude: 108.9, latitude: 34.27, location: { x: 763.53, y: 157.97 } },
  { id: 'nara', name: t('Nara', '奈良'), scopeIds: ['east-asia'], longitude: 135.78, latitude: 34.68, location: { x: 828.09, y: 156.74 } },
  { id: 'heian', name: t('Heian', '平安京'), scopeIds: ['east-asia'], longitude: 135.75, latitude: 35.02, location: { x: 827.61, y: 155.73 } },
];

export const processes: HistoricalProcess[] = [
  { id: 'carolingian-succession', scopeId: 'europe', name: t('Carolingian succession', '加洛林的继承与分割'),
    summary: t('A dynasty’s inheritance repeatedly changes the political map.', '同一王朝的继承，反复改变政治格局。'),
    start: 751, end: 870, eventIds: ['charlemagne-768', 'imperial-coronation-800', 'louis-succeeds-814', 'verdun-843', 'meerssen-870'],
    sourceIds: ['met-france', 'wallonia-verdun', 'wallonia-meerssen'] },
  { id: 'frankish-papal-alliance', scopeId: 'europe', name: t('A dynasty and the papacy', '王朝与教廷'),
    summary: t('Papal support helps secure Pippin’s new royal dynasty.', '教宗的支持帮助丕平巩固新王朝。'),
    start: 751, end: 754, eventIds: ['pepin-751', 'papal-anointing-754'], sourceIds: ['met-france', 'kcl-pepin'] },
  { id: 'abbasid-court', scopeId: 'west-asia', name: t('The Abbasid court changes its seat', '阿拔斯宫廷的迁驻'),
    summary: t('A new dynasty establishes its court in Iraq; selected records follow Baghdad, Samarra and a return to Baghdad.', '新王朝在伊拉克建立宫廷；精选记录追踪巴格达、萨迈拉，以及返回巴格达的过程。'),
    start: 750, end: 892, eventIds: ['abbasid-revolution-750', 'baghdad-762', 'samarra-836'], sourceIds: ['ashmolean-abbasid', 'met-abbasid', 'qatar-samarra'] },
  { id: 'umayyad-andalus', scopeId: 'west-asia', name: t('An Umayyad line in al-Andalus', '倭马亚在安达卢斯的延续'),
    summary: t('After the dynasty loses power in the east, Abd al-Rahman I builds an emirate in Iberia.', '失去东方的统治后，阿卜杜勒·拉赫曼一世在伊比利亚建立埃米尔国。'),
    start: 756, end: 785, eventIds: ['cordoba-emirate-756', 'cordoba-mosque-785'], sourceIds: ['met-iberia', 'ashmolean-abbasid'] },
  { id: 'tang-transformation', scopeId: 'east-asia', name: t('Tang rule through rebellion', '唐朝与安史之乱'),
    summary: t('The dynasty survives a major rebellion with its court’s authority weakened.', '王朝在大规模叛乱后延续，但朝廷的权威受到削弱。'),
    start: 618, end: 763, eventIds: ['tang-founded-618', 'an-lushan-755', 'rebellion-ends-763'], sourceIds: ['met-china', 'met-tang', 'loc-an-lushan'] },
  { id: 'japan-court-capitals', scopeId: 'east-asia', name: t('Japanese court relocations', '日本朝廷的迁都与返回'),
    summary: t('The court leaves Nara, returns, then moves through Nagaoka to Heian. A return to a city need not restore its earlier state.', '朝廷离开奈良后又返回，随后迁往长冈、平安。回到同一座城市，并不意味着恢复此前的状态。'),
    start: 710, end: 794, eventIds: ['nara-710', 'nagaoka-784', 'heian-794'], sourceIds: ['met-japan', 'muko-capitals', 'nabunken-chronology'] },
];

export const events: HistoricalEvent[] = [
  { id: 'charlemagne-768', processId: 'carolingian-succession', year: 768, title: t('Two brothers inherit', '兄弟分承王国'),
    summary: t('After Pippin’s death, Charlemagne and Carloman divide the Frankish kingdom.', '丕平去世后，查理曼与卡洛曼分承法兰克王国。'),
    changes: [{ label: t('Succession', '王位继承'), before: t('Pippin III', '丕平三世'), after: t('Charlemagne and Carloman', '查理曼与卡洛曼') }],
    sourceIds: ['met-france'], note: t('Charlemagne becomes sole ruler only after Carloman’s death in 771.', '直到 771 年卡洛曼去世后，查理曼才成为唯一统治者。') },
  { id: 'imperial-coronation-800', processId: 'carolingian-succession', year: 800, title: t('An imperial title in Rome', '在罗马加冕为帝'),
    summary: t('Pope Leo III crowns Charlemagne emperor in Rome.', '教宗利奥三世在罗马为查理曼加冕，授予皇帝称号。'),
    changes: [{ label: t('Title', '统治者称号'), before: t('King of the Franks', '法兰克国王'), after: t('King and emperor', '国王兼皇帝') }],
    sourceIds: ['met-france'], note: t('A title change is shown here; the coronation does not itself define new borders.', '此处呈现称号变化；加冕本身并不意味着疆界发生变化。') },
  { id: 'louis-succeeds-814', processId: 'carolingian-succession', year: 814, title: t('Louis succeeds Charlemagne', '虔诚者路易继位'),
    summary: t('Charlemagne dies; his surviving son Louis the Pious inherits the empire.', '查理曼去世，在世的儿子虔诚者路易继承帝国。'),
    changes: [{ label: t('Ruler', '统治者'), before: t('Charlemagne', '查理曼'), after: t('Louis the Pious', '虔诚者路易') }], sourceIds: ['met-france'] },
  { id: 'verdun-843', processId: 'carolingian-succession', year: 843, title: t('Three kingdoms at Verdun', '凡尔登：分为三个王国'),
    summary: t('Louis’s sons settle their conflict with a three-way partition at Verdun.', '路易的儿子们在凡尔登达成三分协议，结束彼此的争战。'),
    changes: [{ label: t('Political arrangement', '政治格局'), before: t('An inheritance contested by three brothers', '三兄弟争夺继承权'), after: t('West: Charles · Middle: Lothair · East: Louis', '西部：查理 · 中部：洛泰尔 · 东部：路易') }],
    sourceIds: ['met-france', 'wallonia-verdun'], note: t('These kingdoms are not modern France, Germany or Italy.', '这三个王国不等于现代法国、德国或意大利。') },
  { id: 'meerssen-870', processId: 'carolingian-succession', year: 870, title: t('Lotharingia is divided', '洛塔林吉亚被瓜分'),
    summary: t('Charles the Bald and Louis the German partition Lotharingia at Meerssen.', '秃头查理与日耳曼人路易在梅尔森瓜分洛塔林吉亚。'),
    changes: [{ label: t('Lotharingian succession', '洛塔林吉亚的继承'), before: t('Lothair II dies; Charles claims the kingdom', '洛泰尔二世去世，查理宣称继位'), after: t('Charles and Louis divide the kingdom', '查理与路易分割该王国') }],
    sourceIds: ['wallonia-meerssen'], note: t('This partitions Lotharingia, not all of Middle Francia. The intervening divisions after 843 are omitted from this selected sequence.', '被分割的是洛塔林吉亚，并非整个中法兰克。此选编序列省略了 843 年之后的中间几次分割。') },
  { id: 'pepin-751', processId: 'frankish-papal-alliance', year: 751, title: t('Pippin becomes king', '丕平成为国王'),
    summary: t('With papal support, Pippin is elected king of the Franks.', '在教宗支持下，丕平被推举为法兰克国王。'),
    changes: [{ label: t('Royal dynasty', '王朝'), before: t('Merovingian kingship', '墨洛温王朝'), after: t('Carolingian kingship', '加洛林王朝') }], sourceIds: ['met-france', 'kcl-pepin'] },
  { id: 'papal-anointing-754', processId: 'frankish-papal-alliance', year: 754, title: t('Papal anointing at Saint-Denis', '圣但尼的教宗涂油礼'),
    summary: t('Pope Stephen II anoints Pippin and his sons Charles and Carloman.', '教宗斯德望二世为丕平及其两子查理、卡洛曼施行涂油礼。'),
    changes: [{ label: t('Dynastic recognition', '王朝认可'), before: t('Pippin holds the royal office', '丕平在位为王'), after: t('Pippin and his sons receive papal anointing', '丕平与两子获得教宗涂油祝圣') }], sourceIds: ['kcl-pepin'] },
  { id: 'abbasid-revolution-750', processId: 'abbasid-court', year: 750, title: t('The Abbasids take power', '阿拔斯掌权'),
    summary: t('The Abbasid revolution overthrows Umayyad rule in the east.', '阿拔斯革命推翻倭马亚在东方的统治。'),
    changes: [{ label: t('Ruling dynasty in the east', '东方的统治王朝'), before: t('Umayyads', '倭马亚'), after: t('Abbasids', '阿拔斯') }], sourceIds: ['ashmolean-abbasid', 'met-abbasid'],
    note: t('The Umayyad line continues separately in al-Andalus from 756.', '倭马亚的一支从 756 年起在安达卢斯另建统治。') },
  { id: 'baghdad-762', processId: 'abbasid-court', year: 762, title: t('A court at Baghdad', '宫廷落脚巴格达'),
    summary: t('Al-Mansur establishes Baghdad as the Abbasid capital.', '曼苏尔将巴格达确立为阿拔斯的都城。'),
    changes: [{ label: t('Court residence', '宫廷驻地'), before: t('Early Abbasid residences in Iraq', '伊拉克的早期阿拔斯驻地'), after: t('Baghdad', '巴格达') }], sourceIds: ['ashmolean-abbasid', 'met-abbasid'] },
  { id: 'samarra-836', processId: 'abbasid-court', year: 836, title: t('The court moves to Samarra', '宫廷迁往萨迈拉'),
    summary: t('Samarra becomes the caliphal residence, a role it retains until 892.', '萨迈拉成为哈里发驻地，并保持这一地位直至 892 年。'),
    changes: [{ label: t('Caliphal residence', '哈里发驻地'), before: t('Baghdad', '巴格达'), after: t('Samarra', '萨迈拉') }], sourceIds: ['met-abbasid', 'ashmolean-abbasid'] },
  { id: 'cordoba-emirate-756', processId: 'umayyad-andalus', year: 756, title: t('An emirate at Córdoba', '科尔多瓦的埃米尔国'),
    summary: t('Abd al-Rahman I establishes Umayyad rule in al-Andalus.', '阿卜杜勒·拉赫曼一世在安达卢斯建立倭马亚统治。'),
    changes: [{ label: t('Abd al-Rahman’s position', '阿卜杜勒·拉赫曼的地位'), before: t('Survivor of the overthrown dynasty', '覆亡王朝的幸存者'), after: t('Emir based in Córdoba', '以科尔多瓦为驻地的埃米尔') }], sourceIds: ['met-iberia', 'ashmolean-abbasid'],
    note: t('This emirate does not encompass every polity in Iberia.', '该埃米尔国并不涵盖伊比利亚的所有政权。') },
  { id: 'cordoba-mosque-785', processId: 'umayyad-andalus', year: 785, title: t('A great mosque for Córdoba', '科尔多瓦大清真寺开建'),
    summary: t('Abd al-Rahman I begins the Great Mosque of Córdoba.', '阿卜杜勒·拉赫曼一世开始修建科尔多瓦大清真寺。'),
    changes: [{ label: t('Dynastic patronage', '王朝营建'), before: t('The emirate is established', '埃米尔国已经建立'), after: t('Construction of the Great Mosque begins', '大清真寺开始修建') }], sourceIds: ['met-iberia'] },
  { id: 'tang-founded-618', processId: 'tang-transformation', year: 618, title: t('Li Yuan founds the Tang', '李渊建立唐朝'),
    summary: t('Li Yuan establishes the Tang dynasty after the Sui collapse.', '隋朝瓦解后，李渊建立唐朝。'),
    changes: [{ label: t('Dynasty', '王朝'), before: t('Sui', '隋'), after: t('Tang', '唐') }], sourceIds: ['met-china'],
    note: t('A dynasty’s founding is a dated milestone, not an instant transfer of control over every region.', '建朝是时间节点，不代表所有地区在这一刻同时易手。') },
  { id: 'an-lushan-755', processId: 'tang-transformation', year: 755, title: t('An Lushan rebels', '安禄山起兵'),
    summary: t('A frontier commander turns his forces against the Tang court.', '一位边镇将领率军反叛唐朝朝廷。'),
    changes: [{ label: t('An Lushan’s relationship to the court', '安禄山与朝廷的关系'), before: t('Tang military commander', '唐朝军事将领'), after: t('Leader of a rebellion', '叛乱领袖') }], sourceIds: ['met-china', 'loc-an-lushan'] },
  { id: 'rebellion-ends-763', processId: 'tang-transformation', year: 763, title: t('The dynasty survives', '王朝延续'),
    summary: t('The rebellion ends, but the Tang court’s power remains weakened.', '叛乱结束，但唐朝朝廷的权力仍受到削弱。'),
    changes: [{ label: t('Conflict', '冲突状态'), before: t('Rebellion, 755–763', '安史之乱，755—763'), after: t('Rebellion ended; Tang rule continues', '叛乱结束，唐朝继续统治') }], sourceIds: ['loc-an-lushan', 'met-tang'] },
  { id: 'nara-710', processId: 'japan-court-capitals', year: 710, title: t('The court settles at Nara', '朝廷迁入奈良'),
    summary: t('Heijō-kyō at Nara adopts a grid inspired by Tang Chang’an, without its enclosing walls.', '奈良的平城京借鉴唐长安的棋盘格局，但没有外围城墙。'),
    changes: [{ label: t('Court capital', '朝廷都城'), before: t('Earlier court sites', '此前的都城驻地'), after: t('Heijō-kyō (Nara)', '平城京（奈良）') }], sourceIds: ['met-japan'] },
  { id: 'nagaoka-784', processId: 'japan-court-capitals', year: 784, title: t('Ten years at Nagaoka', '长冈的十年'),
    summary: t('The court leaves Heijō-kyō for Nagaoka-kyō.', '朝廷离开平城京，迁往长冈京。'),
    changes: [{ label: t('Court capital', '朝廷都城'), before: t('Heijō-kyō (Nara)', '平城京（奈良）'), after: t('Nagaoka-kyō', '长冈京') }], sourceIds: ['muko-capitals'] },
  { id: 'heian-794', processId: 'japan-court-capitals', year: 794, title: t('Heian becomes the court’s seat', '朝廷定都平安'),
    summary: t('The court moves to Heian-kyō, at present-day Kyoto.', '朝廷迁往平安京，即今天的京都。'),
    changes: [{ label: t('Court capital', '朝廷都城'), before: t('Nagaoka-kyō', '长冈京'), after: t('Heian-kyō', '平安京') }], sourceIds: ['muko-capitals', 'met-japan'] },
];
