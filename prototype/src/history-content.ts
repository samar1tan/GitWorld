import type { HistoryBranch, HistoryCommit, HistoryDataset, HistoryField, HistorySource, HistoryText, HistoryValue } from './history-types.ts';

const t = (en: string, zh: string): HistoryText => ({ en, 'zh-CN': zh });
const known = (key: string, en: string, zh: string, sourceIds: string[], note?: HistoryText): HistoryValue => ({ key, label: t(en, zh), status: 'known', sourceIds, ...(note ? { note } : {}) });
const unknown = (en = 'Not recorded in this model', zh = '本模型未收录'): HistoryValue => ({ key: null, label: t(en, zh), status: 'unknown', sourceIds: [] });

const sources: Record<string, HistorySource> = {
  'met-france': { id: 'met-france', title: 'France, 500–1000 A.D.', url: 'https://www.metmuseum.org/toah/ht/06/euwf', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'wallonia-verdun': { id: 'wallonia-verdun', title: 'Le partage décisif du Regnum Francorum par le Traité de Verdun', url: 'https://connaitrelawallonie.wallonie.be/histoire/timeline/11-aout-843-le-partage-decisif-du-regnum-francorum-par-le-traite-de-verdun', publisher: 'Connaître la Wallonie / Institut Destrée', language: 'fr' },
  'wallonia-meerssen': { id: 'wallonia-meerssen', title: 'Le traité de Meerssen', url: 'https://connaitrelawallonie.wallonie.be/histoire/timeline/8-aout-870-le-traite-de-meerssen', publisher: 'Connaître la Wallonie / Institut Destrée', language: 'fr' },
  'ndb-lothar': { id: 'ndb-lothar', title: 'Lothar I. — Neue Deutsche Biographie', url: 'https://www.deutsche-biographie.de/gnd118780514.html?language=en', publisher: 'Historische Kommission / Bayerische Staatsbibliothek', language: 'de' },
  'met-abbasid': { id: 'met-abbasid', title: 'The Art of the Abbasid Period (750–1258)', url: 'https://www.metmuseum.org/essays/the-art-of-the-abbasid-period-750-1258', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'ashmolean-abbasid': { id: 'ashmolean-abbasid', title: 'Abbasid Ceramics: The Historical Background', url: 'https://islamicceramics.ashmolean.org/Abbasid/history.htm', publisher: 'Ashmolean Museum, University of Oxford', language: 'en' },
  'qatar-samarra': { id: 'qatar-samarra', title: 'Artistry in Abbasid Architecture: The Stucco Decorations from Samarra', url: 'https://qm.org.qa/en/stories/all-stories/collection-highlight-abbasid-stucco-panel/', publisher: 'Qatar Museums', language: 'en' },
  'met-japan': { id: 'met-japan', title: 'Japan, 500–1000 A.D.', url: 'https://www.metmuseum.org/ko/toah/ht/06/eaj', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'nabunken-chronology': { id: 'nabunken-chronology', title: 'Chronology — Asuka & Nara', url: 'https://www.nabunken.go.jp/english/chronology.html', publisher: 'Nara National Research Institute for Cultural Properties', language: 'en' },
  'nabunken-palace': { id: 'nabunken-palace', title: 'Nara (Heijo) Palace Site Excavation Report XVII (2011), English Summary', url: 'https://www.nabunken.go.jp/english/monograph/84.html', publisher: 'Nara National Research Institute for Cultural Properties', language: 'en' },
  'muko-capitals': { id: 'muko-capitals', title: 'Muko City: Guide to the City', url: 'https://www.city.muko.kyoto.jp/uploaded/attachment/12617.pdf', publisher: 'Muko City', language: 'en' },
  'met-china': { id: 'met-china', title: 'China, 500–1000 A.D.', url: 'https://www.metmuseum.org/toah/ht/06/eac', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'met-tang': { id: 'met-tang', title: 'Tang Dynasty (618–907)', url: 'https://www.metmuseum.org/essays/tang-dynasty-618-906', publisher: 'The Metropolitan Museum of Art', language: 'en' },
  'loc-an-lushan': { id: 'loc-an-lushan', title: 'Library of Congress Subject Headings: China—History—An Lushan Rebellion, 755–763', url: 'https://www.loc.gov/aba/publications/Archived-LCSH38/C.pdf', publisher: 'Library of Congress', language: 'en' },
};

const fields: HistoryField[] = [
  { id: 'politics.ruler', group: 'politics', name: t('Ruler / claimants', '统治者／争位者') },
  { id: 'politics.dynasty', group: 'politics', name: t('Ruling house', '统治家族') },
  { id: 'politics.form', group: 'politics', name: t('Political organization', '政治组织') },
  { id: 'politics.capital', group: 'politics', name: t('Court residence', '宫廷驻地'), description: t('A recorded court location; not every society has one fixed capital.', '记录中的宫廷驻地；并非所有政体都有唯一固定首都。') },
  { id: 'politics.condition', group: 'politics', name: t('Recorded context', '记录背景') },
  { id: 'territory.extent', group: 'territory', name: t('Territorial description', '地域描述'), description: t('A qualitative description, not a reconstructed border.', '定性范围描述，不是复原疆界。') },
  { id: 'culture.planning', group: 'culture', name: t('Capital planning', '都城规划') },
];
const frankish = ['met-france'];
const verdun = ['met-france', 'wallonia-verdun'];
const meerssen = ['wallonia-meerssen'];
const carolingian = known('carolingian', 'Carolingian house', '加洛林家族', frankish);
const kingdom = known('frankish-kingship', 'Frankish kingship', '法兰克王权', frankish);
const selectedModel = t('Selected political records. Between dates, a query returns the latest recorded model state, not a complete reconstruction of that year.', '精选政治记录。日期之间的查询返回此前最新收录状态，不等于该年的完整历史复原。');
const geographicNote = t('The regional names describe medieval realms; they are not modern national borders.', '区域名称指中世纪的统治范围，不等于现代国界。');
const courtModel = t('This path follows selected court locations. Other rulers, institutions and intervening changes are not fully recorded.', '这条路径追踪精选宫廷驻地。历任统治者、制度和中间变化未完整收录。');

const commits: HistoryCommit[] = [
  { id: 'francia-751', branchId: 'francia/main', year: 751, title: t('Pippin takes the crown', '丕平登上王位'), summary: t('Pippin’s accession begins Carolingian kingship.', '丕平即位，加洛林家族开始掌握王权。'), parents: [], eventId: 'pepin-751', sourceIds: frankish, changes: {
    'politics.ruler': known('pippin-iii', 'Pippin III', '丕平三世', frankish), 'politics.dynasty': carolingian, 'politics.form': kingdom,
    'politics.capital': unknown('No single court residence recorded', '未收录唯一宫廷驻地'), 'politics.condition': known('carolingian-accession', 'A new royal dynasty', '新王朝即位', frankish), 'territory.extent': known('frankish-realm', 'Frankish realm', '法兰克领地', frankish),
  }, note: selectedModel },
  { id: 'francia-768', branchId: 'francia/main', year: 768, title: t('Two brothers inherit', '兄弟分承王国'), summary: t('Pippin’s sons Charles and Carloman divide the inheritance.', '丕平的儿子查理与卡洛曼分承遗产。'), parents: ['francia-751'], eventId: 'charlemagne-768', sourceIds: frankish, changes: {
    'politics.ruler': known('charles-and-carloman', 'Charles and Carloman', '查理与卡洛曼', frankish), 'politics.condition': known('divided-inheritance-768', 'Inheritance divided between brothers', '兄弟分承领地', frankish),
  }, note: t('Both brothers are kept in one selected record; their separate rule is not expanded into branches in this sample.', '本切片将两兄弟保留在同一记录中，未进一步展开各自统治分支。') },
  { id: 'francia-771', branchId: 'francia/main', year: 771, title: t('Charlemagne rules alone', '查理曼独掌王权'), summary: t('Carloman dies; Charlemagne takes over his brother’s share.', '卡洛曼去世，查理曼接掌其兄弟的领地。'), parents: ['francia-768'], sourceIds: frankish, changes: {
    'politics.ruler': known('charlemagne', 'Charlemagne', '查理曼', frankish), 'politics.condition': known('sole-frankish-rule', 'One king holds both shares', '一位国王掌握两部分领地', frankish),
  } },
  { id: 'francia-800', branchId: 'francia/main', year: 800, title: t('An imperial title', '获得皇帝称号'), summary: t('Charlemagne receives the imperial crown in Rome.', '查理曼在罗马接受皇帝冠冕。'), parents: ['francia-771'], eventId: 'imperial-coronation-800', sourceIds: frankish, changes: {
    'politics.form': known('carolingian-empire', 'Kingship with an imperial title', '具有皇帝称号的王权', frankish), 'politics.condition': known('imperial-coronation', 'Imperial coronation', '加冕为帝', frankish), 'territory.extent': unknown('Expansion since 771 is not reconstructed', '未复原 771 年之后的扩张范围'),
  }, note: t('A coronation changes the recorded title; it does not by itself redraw territory or make Rome a fixed capital.', '加冕改变记录中的称号；它本身不重划疆界，也不使罗马成为固定首都。') },
  { id: 'francia-814', branchId: 'francia/main', year: 814, title: t('Louis inherits', '路易继位'), summary: t('Louis the Pious succeeds Charlemagne.', '虔诚者路易继承查理曼。'), parents: ['francia-800'], eventId: 'louis-succeeds-814', sourceIds: frankish, changes: {
    'politics.ruler': known('louis-pious', 'Louis the Pious', '虔诚者路易', frankish), 'politics.condition': known('louis-succession', 'Succession after Charlemagne', '查理曼去世后的继承', frankish),
  } },
  { id: 'francia-840', branchId: 'francia/main', year: 840, title: t('An inheritance contested', '继承权陷入争夺'), summary: t('Louis dies; his sons’ competing claims lead towards the settlement at Verdun.', '路易去世；其子嗣争夺继承，最终走向凡尔登协议。'), parents: ['francia-814'], sourceIds: ['ndb-lothar', 'wallonia-verdun'], changes: {
    'politics.ruler': known('lothair-charles-louis', 'Lothair, Charles and Louis: rival claims', '洛泰尔、查理与路易：相互竞争的主张', ['wallonia-verdun']), 'politics.condition': known('succession-conflict', 'Succession conflict', '继承冲突', ['wallonia-verdun']),
  }, note: t('A shared pre-partition context for the three modeled outcomes. It does not collapse the civil war into a single event.', '作为三种分割结果共享的前置背景；不表示内战只发生了一次事件。') },
  { id: 'west-843', branchId: 'francia/west', year: 843, title: t('Charles receives the west', '查理取得西部'), summary: t('Verdun assigns the western kingdom to Charles the Bald.', '凡尔登协议将西部王国分配给秃头查理。'), parents: ['francia-840'], eventId: 'verdun-843', sourceIds: verdun, changes: {
    'politics.ruler': known('charles-bald', 'Charles the Bald', '秃头查理', verdun), 'politics.form': kingdom, 'politics.condition': known('verdun-settlement', 'Partition agreed at Verdun', '凡尔登协议确立分割', verdun), 'territory.extent': known('west-francia-843', 'Western portion of the Frankish realm', '法兰克领地的西部部分', verdun),
  }, note: geographicNote },
  { id: 'west-870', branchId: 'francia/west', year: 870, title: t('A share of Lotharingia', '取得部分洛塔林吉亚'), summary: t('At Meerssen, Charles and Louis divide Lotharingia.', '在梅尔森，查理与路易分割洛塔林吉亚。'), parents: ['west-843'], eventId: 'meerssen-870', sourceIds: meerssen, changes: {
    'politics.condition': known('meerssen-settlement', 'Meerssen partition', '梅尔森分割', meerssen), 'territory.extent': known('west-francia-870', 'Western kingdom plus its Meerssen share of Lotharingia', '西部王国及梅尔森分配的洛塔林吉亚份额', meerssen),
  }, note: t('Lotharingia was only one successor to Middle Francia. This record does not mean all middle lands were absorbed.', '洛塔林吉亚只是中法兰克的一部分继承区域；此记录不表示整个中部领地被吞并。') },
  { id: 'middle-843', branchId: 'francia/middle', year: 843, title: t('Lothair holds the middle', '洛泰尔取得中部'), summary: t('Lothair’s middle kingdom links northern lands with Italy.', '洛泰尔的中部王国连接北方领地与意大利。'), parents: ['francia-840'], eventId: 'verdun-843', sourceIds: verdun, changes: {
    'politics.ruler': known('lothair-i', 'Lothair I', '洛泰尔一世', verdun), 'politics.condition': known('verdun-settlement', 'Partition agreed at Verdun', '凡尔登协议确立分割', verdun), 'territory.extent': known('middle-francia-843', 'Middle kingdom, from northern Frankish lands into Italy', '从法兰克北方领地延伸至意大利的中部王国', verdun),
  }, note: geographicNote },
  { id: 'middle-855', branchId: 'francia/middle', year: 855, title: t('The middle kingdom divides', '中部王国再次分割'), summary: t('Lothair I divides his realm among Louis II, Lothair II and Charles before retiring to Prüm.', '洛泰尔一世退居普吕姆前，将领地分给路易二世、洛泰尔二世与查理。'), parents: ['middle-843'], sourceIds: ['ndb-lothar'], changes: {
    'politics.ruler': known('three-sons-lothair', 'Louis II, Lothair II and Charles', '路易二世、洛泰尔二世与查理', ['ndb-lothar']), 'politics.form': known('partitioned-successor-realms', 'Separate successor kingdoms', '分别统治的继承王国', ['ndb-lothar']), 'politics.condition': known('middle-partition-855', 'Partition before Lothair I’s death', '洛泰尔一世去世前的分割', ['ndb-lothar']), 'territory.extent': known('three-middle-successors', 'Italy; northern lands; Provence and Burgundy', '意大利；北方领地；普罗旺斯与勃艮第', ['ndb-lothar']),
  }, note: t('This branch ends with the partition. Only the northern successor is expanded below; Italy and Provence are not fully modeled.', '此分支止于分割。下方只展开北部继承区域；意大利和普罗旺斯尚未完整建模。') },
  { id: 'east-843', branchId: 'francia/east', year: 843, title: t('Louis receives the east', '路易取得东部'), summary: t('Verdun assigns the eastern kingdom to Louis the German.', '凡尔登协议将东部王国分配给日耳曼人路易。'), parents: ['francia-840'], eventId: 'verdun-843', sourceIds: verdun, changes: {
    'politics.ruler': known('louis-german', 'Louis the German', '日耳曼人路易', verdun), 'politics.form': kingdom, 'politics.condition': known('verdun-settlement', 'Partition agreed at Verdun', '凡尔登协议确立分割', verdun), 'territory.extent': known('east-francia-843', 'Eastern portion of the Frankish realm', '法兰克领地的东部部分', verdun),
  }, note: geographicNote },
  { id: 'east-870', branchId: 'francia/east', year: 870, title: t('The eastern share at Meerssen', '梅尔森的东部分配'), summary: t('Louis gains the eastern share of Lotharingia in the agreement with Charles.', '路易与查理达成协议，取得洛塔林吉亚的东部份额。'), parents: ['east-843'], eventId: 'meerssen-870', sourceIds: meerssen, changes: {
    'politics.condition': known('meerssen-settlement', 'Meerssen partition', '梅尔森分割', meerssen), 'territory.extent': known('east-francia-870', 'Eastern kingdom plus its Meerssen share of Lotharingia', '东部王国及梅尔森分配的洛塔林吉亚份额', meerssen),
  }, note: t('The shared treaty changes both branches. No parent edge is added from one kingdom to the other.', '同一条约改变两条分支；两个王国之间并不因此产生父子继承关系。') },
  { id: 'lotharingia-855', branchId: 'francia/lotharingia', year: 855, title: t('Lothair II’s northern kingdom', '洛泰尔二世的北部王国'), summary: t('Lothair II receives the northern lands of his father’s realm.', '洛泰尔二世继承父亲领地的北部。'), parents: ['middle-855'], sourceIds: ['ndb-lothar'], changes: {
    'politics.ruler': known('lothair-ii', 'Lothair II', '洛泰尔二世', ['ndb-lothar']), 'politics.form': kingdom, 'politics.condition': known('northern-successor-855', 'Northern successor kingdom', '北部继承王国', ['ndb-lothar']), 'territory.extent': known('lotharingia-855', 'Northern middle lands, including Aachen and extending to Frisia', '中部领地的北部，包括亚琛并延伸至弗里西亚', ['ndb-lothar']),
  }, note: t('Lotharingia is a successor within the former middle realm, not another name for all of Middle Francia.', '洛塔林吉亚是原中部领地内的继承王国，不是整个中法兰克的别称。') },
  { id: 'lotharingia-869', branchId: 'francia/lotharingia', year: 869, title: t('A disputed succession', '继承再起争端'), summary: t('Lothair II dies; Charles claims the kingdom and is crowned at Metz.', '洛泰尔二世去世；查理宣称继位，并在梅斯加冕。'), parents: ['lotharingia-855'], sourceIds: meerssen, changes: {
    'politics.ruler': known('charles-lotharingian-claim', 'Charles the Bald claims the crown', '秃头查理宣称继位', meerssen), 'politics.condition': known('lotharingian-dispute', 'A succession disputed by neighboring rulers', '邻近统治者争夺继承权', meerssen),
  } },
  { id: 'lotharingia-870', branchId: 'francia/lotharingia', year: 870, title: t('Partition at Meerssen', '在梅尔森被分割'), summary: t('Lotharingia is divided between Charles and Louis.', '洛塔林吉亚由查理与路易分割。'), parents: ['lotharingia-869'], eventId: 'meerssen-870', sourceIds: meerssen, changes: {
    'politics.ruler': known('charles-and-louis-870', 'Charles and Louis, over their separate shares', '查理与路易分别统治各自份额', meerssen), 'politics.form': known('partitioned-between-neighbors', 'Territory divided between neighboring kingdoms', '领地分属邻近王国', meerssen), 'politics.condition': known('meerssen-settlement', 'Meerssen partition', '梅尔森分割', meerssen), 'territory.extent': known('lotharingia-partitioned-870', 'Western and eastern shares under different kings', '西、东两份领地由不同国王统治', meerssen),
  }, note: t('The modeled succession ends here; the name and later political history of Lotharingia continue beyond this sample.', '本切片的继承路径止于此处；洛塔林吉亚的名称及后续政治史并未就此消失。') },
  { id: 'abbasid-750', branchId: 'abbasid/main', year: 750, title: t('Abbasid rule begins', '阿拔斯开始统治'), summary: t('The Abbasids replace Umayyad rule in the east.', '阿拔斯取代倭马亚在东方的统治。'), parents: [], eventId: 'abbasid-revolution-750', sourceIds: ['met-abbasid', 'ashmolean-abbasid'], changes: {
    'politics.ruler': unknown(), 'politics.dynasty': known('abbasid', 'Abbasid house', '阿拔斯家族', ['met-abbasid']), 'politics.form': known('caliphate', 'Caliphate', '哈里发政体', ['met-abbasid']), 'politics.capital': unknown('Early court sites are not resolved here', '此处未确定早期宫廷驻地'), 'politics.condition': known('abbasid-accession', 'Change of dynasty in the east', '东方统治王朝更替', ['met-abbasid']), 'territory.extent': unknown(),
  }, note: t('The Umayyad line later continues in al-Andalus. This branch concerns the Abbasid court, not every Islamic polity.', '倭马亚一支后来在安达卢斯延续。此分支关注阿拔斯宫廷，不代表所有伊斯兰政体。') },
  { id: 'abbasid-762', branchId: 'abbasid/main', year: 762, title: t('A new seat at Baghdad', '宫廷落脚巴格达'), summary: t('Baghdad becomes the Abbasid capital.', '巴格达成为阿拔斯都城。'), parents: ['abbasid-750'], eventId: 'baghdad-762', sourceIds: ['met-abbasid', 'ashmolean-abbasid'], changes: {
    'politics.capital': known('baghdad', 'Baghdad', '巴格达', ['met-abbasid', 'ashmolean-abbasid']), 'politics.condition': known('court-in-baghdad', 'Court established at Baghdad', '宫廷设于巴格达', ['met-abbasid']),
  }, note: courtModel },
  { id: 'abbasid-836', branchId: 'abbasid/main', year: 836, title: t('The court moves to Samarra', '宫廷迁往萨迈拉'), summary: t('Samarra becomes the caliphal seat.', '萨迈拉成为哈里发驻地。'), parents: ['abbasid-762'], eventId: 'samarra-836', sourceIds: ['met-abbasid', 'qatar-samarra'], changes: {
    'politics.capital': known('samarra', 'Samarra', '萨迈拉', ['met-abbasid', 'qatar-samarra']), 'politics.condition': known('court-in-samarra', 'Court established at Samarra', '宫廷设于萨迈拉', ['qatar-samarra']),
  }, note: courtModel },
  { id: 'abbasid-892', branchId: 'abbasid/main', year: 892, title: t('Back to Baghdad', '返回巴格达'), summary: t('The caliphal court returns from Samarra to Baghdad.', '哈里发宫廷从萨迈拉返回巴格达。'), parents: ['abbasid-836'], sourceIds: ['qatar-samarra'], changes: {
    'politics.capital': known('baghdad', 'Baghdad', '巴格达', ['qatar-samarra']), 'politics.condition': known('court-return-baghdad', 'Court returns to Baghdad', '宫廷返回巴格达', ['qatar-samarra']),
  }, note: t('The residence returns to an earlier value. A matching city name does not mean the political situation has reverted.', '驻地恢复为此前的值；同一城市名称不表示政治局势也恢复如初。') },
  { id: 'japan-710', branchId: 'japan/main', year: 710, title: t('The court settles at Nara', '朝廷迁入奈良'), summary: t('Heijō-kyō becomes the court’s capital.', '平城京成为朝廷都城。'), parents: [], eventId: 'nara-710', sourceIds: ['met-japan', 'nabunken-chronology'], changes: {
    'politics.ruler': unknown(), 'politics.dynasty': unknown('Dynastic labels are not modeled for this path', '本路径未建模王朝标签'), 'politics.form': known('japanese-imperial-court', 'Japanese imperial court', '日本天皇朝廷', ['met-japan']), 'politics.capital': known('heijo-kyo', 'Heijō-kyō (Nara)', '平城京（奈良）', ['nabunken-chronology']), 'politics.condition': known('nara-capital-710', 'Court relocation to Nara', '朝廷迁入奈良', ['nabunken-chronology']), 'territory.extent': unknown(), 'culture.planning': known('nara-grid', 'Grid plan drawing on Chang’an, without its enclosing walls', '借鉴长安棋盘格局，未设置同样的外围城墙', ['met-japan']),
  }, note: t('Cultural borrowing is a relationship between practices. It does not make the Japanese court a descendant version of the Tang state.', '文化借鉴是实践之间的联系；它不使日本朝廷成为唐朝国家的后代版本。') },
  { id: 'japan-740', branchId: 'japan/main', year: 740, title: t('The capital moves to Kuni', '迁都恭仁'), summary: t('The court leaves Nara for Kuni.', '朝廷离开奈良，迁往恭仁。'), parents: ['japan-710'], sourceIds: ['nabunken-chronology', 'nabunken-palace'], changes: {
    'politics.capital': known('kuni-kyo', 'Kuni-kyō', '恭仁京', ['nabunken-chronology']), 'politics.condition': known('court-in-kuni', 'Court relocation to Kuni', '朝廷迁往恭仁', ['nabunken-chronology']), 'culture.planning': unknown('The new capital’s plan is not modeled', '未建模新都城的规划'),
  }, note: t('Parts of the Nara palace were moved to Kuni; later archaeological layers preserve evidence of these changes.', '奈良宫的部分建筑迁至恭仁，后来的考古地层保留了这些变化的证据。') },
  { id: 'japan-744', branchId: 'japan/main', year: 744, title: t('Naniwa becomes the capital', '难波成为都城'), summary: t('Naniwa replaces Kuni as the capital.', '难波取代恭仁，成为都城。'), parents: ['japan-740'], sourceIds: ['nabunken-chronology'], changes: {
    'politics.capital': known('naniwa', 'Naniwa', '难波', ['nabunken-chronology']), 'politics.condition': known('court-in-naniwa', 'Court relocation to Naniwa', '朝廷迁往难波', ['nabunken-chronology']),
  } },
  { id: 'japan-745', branchId: 'japan/main', year: 745, title: t('The court returns to Nara', '朝廷返回奈良'), summary: t('After further moves, the court returns to Nara.', '经历进一步迁移后，朝廷返回奈良。'), parents: ['japan-744'], sourceIds: ['nabunken-chronology', 'nabunken-palace'], changes: {
    'politics.capital': known('heijo-kyo', 'Heijō-kyō (Nara)', '平城京（奈良）', ['nabunken-chronology']), 'politics.condition': known('court-return-nara', 'Court returns to Nara', '朝廷返回奈良', ['nabunken-palace']),
  }, note: t('The brief Shigaraki phase in 745 is described here rather than represented as a second same-year version. Rebuilt palace compounds show that returning did not simply restore the old layout.', '745 年短暂的紫香乐阶段在此说明，未另建同年版本。重建的宫殿区表明，返回并非简单复原旧布局。') },
  { id: 'japan-784', branchId: 'japan/main', year: 784, title: t('A new capital at Nagaoka', '迁往长冈新都'), summary: t('The court leaves Heijō-kyō for Nagaoka-kyō.', '朝廷离开平城京，迁往长冈京。'), parents: ['japan-745'], eventId: 'nagaoka-784', sourceIds: ['muko-capitals', 'nabunken-chronology'], changes: {
    'politics.capital': known('nagaoka-kyo', 'Nagaoka-kyō', '长冈京', ['muko-capitals']), 'politics.condition': known('court-in-nagaoka', 'Court relocation to Nagaoka', '朝廷迁往长冈', ['muko-capitals']),
  }, note: courtModel },
  { id: 'japan-794', branchId: 'japan/main', year: 794, title: t('Heian becomes the court’s seat', '朝廷定都平安'), summary: t('The court moves from Nagaoka to Heian-kyō.', '朝廷从长冈迁至平安京。'), parents: ['japan-784'], eventId: 'heian-794', sourceIds: ['muko-capitals', 'nabunken-chronology'], changes: {
    'politics.capital': known('heian-kyo', 'Heian-kyō', '平安京', ['muko-capitals']), 'politics.condition': known('court-in-heian', 'Court relocation to Heian', '朝廷迁往平安', ['muko-capitals']),
  }, note: courtModel },
  { id: 'tang-618', branchId: 'tang/main', year: 618, title: t('Tang rule begins', '唐朝建立'), summary: t('The Tang dynasty emerges after the Sui collapse.', '隋朝瓦解后，唐朝建立。'), parents: [], eventId: 'tang-founded-618', sourceIds: ['met-china', 'met-tang'], changes: {
    'politics.ruler': unknown('Ruler succession is not modeled on this path', '此路径未建模历任皇帝'), 'politics.dynasty': known('tang', 'Tang dynasty', '唐朝', ['met-china']), 'politics.form': known('tang-imperial-government', 'Tang imperial government', '唐朝帝国政体', ['met-tang']), 'politics.capital': unknown('Court locations are not reconstructed for these records', '这些记录未复原宫廷驻地'), 'politics.condition': known('tang-foundation', 'Dynastic foundation after the Sui', '隋亡后的建朝', ['met-china']), 'territory.extent': unknown(),
  }, note: t('This path samples dynastic continuity and rebellion, not every reign or the whole territory under Tang authority.', '此路径选取王朝延续与叛乱，不覆盖每任皇帝或唐朝统治的全部地域。') },
  { id: 'tang-755', branchId: 'tang/main', year: 755, title: t('An Lushan rebels', '安禄山起兵'), summary: t('A major rebellion challenges Tang rule.', '大规模叛乱挑战唐朝统治。'), parents: ['tang-618'], eventId: 'an-lushan-755', sourceIds: ['met-tang', 'loc-an-lushan'], changes: {
    'politics.condition': known('an-lushan-rebellion', 'An Lushan rebellion', '安史之乱', ['loc-an-lushan']),
  }, note: t('The long parent edge omits many intermediate changes, including the Wu Zhou interlude. It preserves only the sampled Tang context, not uninterrupted rule across every year.', '长父边省略了包括武周阶段在内的许多中间变化；它只保留选取的唐朝背景，不表示每一年统治都未中断。') },
  { id: 'tang-763', branchId: 'tang/main', year: 763, title: t('The dynasty survives', '王朝延续'), summary: t('The rebellion ends, while the court’s authority is weakened.', '叛乱结束，但朝廷权威受到削弱。'), parents: ['tang-755'], eventId: 'rebellion-ends-763', sourceIds: ['met-tang', 'loc-an-lushan'], changes: {
    'politics.condition': known('post-rebellion-tang', 'Rebellion ended; court authority weakened', '叛乱结束；朝廷权威削弱', ['met-tang', 'loc-an-lushan']),
  }, note: t('A surviving dynasty and changed political conditions can coexist. The model does not infer territorial recovery from the end of the rebellion.', '王朝延续与政治局势改变可以同时发生；模型不从叛乱结束推断领土已完全收复。') },
];

const branches: HistoryBranch[] = [
  { id: 'francia/main', name: t('Carolingian inheritance', '加洛林共同前史'), description: selectedModel, scopeId: 'europe', processId: 'carolingian-succession', coverage: [751, 842], commitIds: ['francia-751', 'francia-768', 'francia-771', 'francia-800', 'francia-814', 'francia-840'], color: '#7ea9ed' },
  { id: 'francia/west', name: t('West Francia', '西法兰克'), description: t('Charles’s western kingdom and its share of Lotharingia in 870. Later reigns are not yet covered.', '查理的西部王国及其 870 年所得洛塔林吉亚份额；尚未收录此后的统治。'), scopeId: 'europe', processId: 'carolingian-succession', coverage: [843, 870], commitIds: ['west-843', 'west-870'], forkCommitId: 'francia-840', color: '#79a9f2' },
  { id: 'francia/middle', name: t('Middle Francia', '中法兰克'), description: t('Lothair I’s middle kingdom; this path ends with the partition of 855.', '洛泰尔一世的中部王国；此路径止于 855 年的再分割。'), scopeId: 'europe', processId: 'carolingian-succession', coverage: [843, 855], commitIds: ['middle-843', 'middle-855'], forkCommitId: 'francia-840', color: '#ba9de0' },
  { id: 'francia/east', name: t('East Francia', '东法兰克'), description: t('Louis’s eastern kingdom and its share of Lotharingia in 870. Later reigns are not yet covered.', '路易的东部王国及其 870 年所得洛塔林吉亚份额；尚未收录此后的统治。'), scopeId: 'europe', processId: 'carolingian-succession', coverage: [843, 870], commitIds: ['east-843', 'east-870'], forkCommitId: 'francia-840', color: '#d0b17b' },
  { id: 'francia/lotharingia', name: t('Lotharingia', '洛塔林吉亚'), description: t('A northern successor of the middle kingdom, followed through the partition of 870. Italy and Provence remain outside this branch.', '中部王国的北部继承区域，追踪至 870 年分割；意大利与普罗旺斯不属于这条分支。'), scopeId: 'europe', processId: 'carolingian-succession', coverage: [855, 870], commitIds: ['lotharingia-855', 'lotharingia-869', 'lotharingia-870'], forkCommitId: 'middle-855', color: '#d28d9e' },
  { id: 'abbasid/main', name: t('Abbasid court', '阿拔斯宫廷'), description: courtModel, scopeId: 'west-asia', processId: 'abbasid-court', coverage: [750, 892], commitIds: ['abbasid-750', 'abbasid-762', 'abbasid-836', 'abbasid-892'], color: '#d0b17b' },
  { id: 'japan/main', name: t('Japanese court capitals', '日本朝廷都城'), description: courtModel, scopeId: 'east-asia', processId: 'japan-court-capitals', coverage: [710, 794], commitIds: ['japan-710', 'japan-740', 'japan-744', 'japan-745', 'japan-784', 'japan-794'], color: '#ba9de0' },
  { id: 'tang/main', name: t('Tang through rebellion', '叛乱中的唐朝'), description: t('Three sampled records of foundation, rebellion and survival. The intervening reigns are not reconstructed.', '选取建朝、叛乱与延续三个记录；未复原中间历任统治。'), scopeId: 'east-asia', processId: 'tang-transformation', coverage: [618, 763], commitIds: ['tang-618', 'tang-755', 'tang-763'], color: '#90a2d1' },
];

export const HISTORY_DATASET_VERSION = 'ued-workbench-2026-10-25';
export const historyDataset: HistoryDataset = { id: HISTORY_DATASET_VERSION, branches, commits, fields, sources };
