import type { HistoryLocale } from '@gitworld/domain';
import type { KnowledgeText } from '../../../../packages/domain/src/knowledge.ts';
import type { KnowledgeDisplayText, KnowledgeObjectDetail } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';

type Label = { en: string; 'zh-CN': string };
// Presentation metadata for identifiers emitted by the implemented source mappers.
// These labels do not create historical content, relations, or routing identifiers.
const labels: Record<string, Label> = {
  'geo:location': { en: 'Recorded location', 'zh-CN': '收录位置' },
  'geo:representative-location': { en: 'Representative map point', 'zh-CN': '地图代表点' },
  'polity.source-name': { en: 'Name in source', 'zh-CN': '来源名称' },
  'territory.area': { en: 'Recorded area', 'zh-CN': '收录面积' },
  'territory.geometry': { en: 'Territory shape in source', 'zh-CN': '来源疆域形状' },
  'relation.source-member-of': { en: 'Membership recorded by source', 'zh-CN': '来源记载的隶属' },
  'relation.source-components': { en: 'Components recorded by source', 'zh-CN': '来源记载的组成部分' },
  'cliopatria:source-entity-status': { en: 'Source identity status', 'zh-CN': '来源身份状态' },
  'cliopatria:temporal-semantics': { en: 'Meaning of the date range', 'zh-CN': '日期范围含义' },
  'cliopatria:unverified-wikidata-reference': { en: 'Unverified Wikidata reference', 'zh-CN': '待核实的 Wikidata 引用' },
  'geo:area-projection': { en: 'Area calculation projection', 'zh-CN': '面积计算投影' },
  'geo:derivation-method': { en: 'Map point calculation', 'zh-CN': '地图点计算方法' },
  'geo:semantic-role': { en: 'Meaning of the map point', 'zh-CN': '地图点含义' },
  'relation:resolution-status': { en: 'Relation review status', 'zh-CN': '关联解析状态' },
  'cliopatria:POLITY': { en: 'Polity (source classification)', 'zh-CN': '政权（来源分类）' },
  'cliopatria:UNSPECIFIED': { en: 'Unspecified source type', 'zh-CN': '来源未注明类型' },
  'periodo:period-definition': { en: 'Period definition', 'zh-CN': '时期定义' },
  'periodo:definition-start': { en: 'Defined period begins', 'zh-CN': '时期定义的起点' },
  'periodo:definition-stop': { en: 'Defined period ends', 'zh-CN': '时期定义的终点' },
  'periodo:definition-label': { en: 'Period name in source', 'zh-CN': '来源时期名称' },
  'periodo:definition-spatial-scope': { en: 'Defined geographic scope', 'zh-CN': '时期定义的地域范围' },
  'periodo:broader-definition': { en: 'Broader period definition', 'zh-CN': '更宽的时期定义' },
  'periodo:source-spatial-description': { en: 'Geographic description in source', 'zh-CN': '来源地域描述' },
  'periodo:authority': { en: 'Bibliographic authority', 'zh-CN': '定义所依据的文献' },
  'periodo:dataset-hash': { en: 'Source dataset fingerprint', 'zh-CN': '来源数据集指纹' },
  'periodo:temporal-semantics': { en: 'Meaning of the date range', 'zh-CN': '日期范围含义' },
  'periodo:authority-rights-status': { en: 'Authority reuse status', 'zh-CN': '原始文献再使用状态' },
  'periodo:authority-rights-evidence': { en: 'Authority reuse terms', 'zh-CN': '原始文献再使用依据' },
  'periodo:source-start-label': { en: 'Start date as written', 'zh-CN': '来源起始日期原文' },
  'periodo:source-stop-label': { en: 'End date as written', 'zh-CN': '来源结束日期原文' },
  'periodo:spatial-semantics': { en: 'Meaning of the geographic scope', 'zh-CN': '地域范围含义' },
  'pleiades:coverage-start': { en: 'Earliest period covered', 'zh-CN': '资料覆盖的最早年代' },
  'pleiades:coverage-end': { en: 'Latest period covered', 'zh-CN': '资料覆盖的最晚年代' },
  'pleiades:attestations': { en: 'Attestations', 'zh-CN': '见证记录' },
  'pleiades:associationCertainty': { en: 'Association certainty', 'zh-CN': '关联确定性' },
  'pleiades:locationType': { en: 'Location type', 'zh-CN': '位置类型' },
  'pleiades:accuracy': { en: 'Location accuracy', 'zh-CN': '位置准确度' },
  'pleiades:locationPrecision': { en: 'Location precision', 'zh-CN': '位置精度' },
  'pleiades:nameType': { en: 'Name type', 'zh-CN': '名称类型' },
  'pleiades:romanized': { en: 'Romanized form', 'zh-CN': '拉丁字母转写' },
  'pleiades:transcriptionAccuracy': { en: 'Transcription accuracy', 'zh-CN': '转写准确度' },
  'pleiades:transcriptionCompleteness': { en: 'Transcription completeness', 'zh-CN': '转写完整度' },
  'pleiades-type:settlement': { en: 'Settlement', 'zh-CN': '聚落' },
  'pleiades-connection:capital': { en: 'Capital relation in source', 'zh-CN': '来源中的首都关联' },
  'office:holder': { en: 'Officeholder', 'zh-CN': '任职者' },
  'office:held-position': { en: 'Position held', 'zh-CN': '所任职务' },
  'office:position': { en: 'Office', 'zh-CN': '职务' },
  'office:jurisdiction': { en: 'Jurisdiction', 'zh-CN': '管辖范围' },
  'gitworld:office': { en: 'Office', 'zh-CN': '职务' },
  'gitworld:office-in-jurisdiction': { en: 'Office within a jurisdiction', 'zh-CN': '特定辖区的职务' },
  'gitworld:office-holder': { en: 'Officeholder', 'zh-CN': '任职者' },
  'gitworld:jurisdiction-scope': { en: 'Jurisdiction scope', 'zh-CN': '管辖范围' },
  'projection:version': { en: 'Office mapping version', 'zh-CN': '任职映射版本' },
  'projection:rule-id': { en: 'Office mapping rule', 'zh-CN': '任职映射规则' },
  'projection:derived-from': { en: 'Original assertion', 'zh-CN': '原始主张' },
  'projection:rule-evidence': { en: 'Rule evidence', 'zh-CN': '规则依据' },
  'projection:policy-version': { en: 'Review policy version', 'zh-CN': '审阅规则版本' },
  'projection:review-flag': { en: 'Review flag', 'zh-CN': '待审阅标记' },
  'projection:review-evidence': { en: 'Review evidence', 'zh-CN': '审阅依据' },
  'source:review-flag': { en: 'Source qualification', 'zh-CN': '来源限定' },
  'wikidata:P31': { en: 'Instance of', 'zh-CN': '所属类型' },
  'wikidata:P39': { en: 'Position held', 'zh-CN': '所任职务' },
  'wikidata:P1001': { en: 'Applies to jurisdiction', 'zh-CN': '适用辖区' },
  'wikidata:P1308': { en: 'Officeholder', 'zh-CN': '任职者' },
  'wikidata:P580': { en: 'Start time', 'zh-CN': '起始时间' },
  'wikidata:P582': { en: 'End time', 'zh-CN': '结束时间' },
  'wikidata:P585': { en: 'Point in time', 'zh-CN': '时间点' },
  // Canonical property names: https://www.wikidata.org/wiki/Property:P1480 and Property:P5102.
  'wikidata:P1480': { en: 'Sourcing circumstances', 'zh-CN': '来源限定情况' },
  'wikidata:P5102': { en: 'Nature of statement', 'zh-CN': '主张性质' },
  km2: { en: 'km²', 'zh-CN': '平方千米' },
  '1': { en: 'unitless', 'zh-CN': '无量纲' },
};
const patterns: Record<string, Label> = {
  attestedName: { en: 'Attested name ({language})', 'zh-CN': '见于来源的名称（{language}）' },
  sourceType: { en: '{provider} type: {value}', 'zh-CN': '{provider} 来源类型：{value}' },
  sourceConnection: { en: 'Source connection: {value}', 'zh-CN': '来源关联：{value}' },
};
const precisions: Record<string, Label> = {
  year: { en: 'Year', 'zh-CN': '年' }, month: { en: 'Month', 'zh-CN': '月' }, day: { en: 'Day', 'zh-CN': '日' },
  decade: { en: 'Decade', 'zh-CN': '十年' }, century: { en: 'Century', 'zh-CN': '世纪' }, millennium: { en: 'Millennium', 'zh-CN': '千年' },
  broader: { en: 'Coarser than a millennium', 'zh-CN': '粗于千年的精度' }, interval: { en: 'Range', 'zh-CN': '区间' },
};
const calendars: Record<string, Label> = {
  'source-unspecified': { en: 'Calendar unspecified', 'zh-CN': '来源未注明历法' },
  'source-civil-year': { en: 'Source year numbering', 'zh-CN': '来源纪年' },
  'published-source-calendar-unspecified': { en: 'Calendar unspecified by source', 'zh-CN': '来源未注明历法' },
  'proleptic-gregorian-utc-observation': { en: 'Gregorian retrieval date (UTC)', 'zh-CN': '格里历获取日期（UTC）' },
  'source-anno-domini-year': { en: 'Source CE year numbering', 'zh-CN': '来源公元纪年' },
  'proleptic-gregorian-xsd-gYear': { en: 'Proleptic Gregorian (XSD years)', 'zh-CN': '推算格里历（XSD 年份）' },
  'wikidata:Q1985786': { en: 'Gregorian calendar', 'zh-CN': '格里历' },
  'wikidata:Q1985727': { en: 'Julian calendar', 'zh-CN': '儒略历' },
};
const qualifierValues: Record<string, Record<string, Label>> = {
  'cliopatria:source-entity-status': { provisional: { en: 'Provisional identity', 'zh-CN': '暂定身份' } },
  'cliopatria:temporal-semantics': { 'geography-observation-interval-not-polity-lifespan': { en: 'Territory observation interval; no polity lifespan inferred', 'zh-CN': '疆域观测区间，未推断政权存续期' } },
  'geo:derivation-method': {
    'planar-centroid-of-largest-polygon': { en: 'Planar centroid of the largest polygon', 'zh-CN': '最大多边形的平面质心' },
    'boundary-vertex-of-largest-polygon': { en: 'Boundary vertex of the largest polygon', 'zh-CN': '最大多边形的边界顶点' },
  },
  'geo:semantic-role': { 'geometry-derived-location-not-capital': { en: 'Derived from the shape; no capital location inferred', 'zh-CN': '由形状计算，未推断首都位置' } },
  'relation:resolution-status': { 'unresolved-source-reference-not-ancestry': { en: 'Unresolved source reference; no ancestry inferred', 'zh-CN': '尚未解析的来源引用，未推断继承关系' } },
  'periodo:temporal-semantics': { 'published-period-definition-not-polity-lifespan': { en: 'Published period definition; no polity lifespan inferred', 'zh-CN': '文献中的时期定义，未推断政权存续期' } },
  'periodo:spatial-semantics': { 'source-spatial-lookup-not-ancient-polity-membership': { en: 'Source geographic reference; no ancient polity membership inferred', 'zh-CN': '来源地域引用，未推断古代政权归属' } },
  'periodo:authority-rights-status': {
    allowed: { en: 'Reuse allowed', 'zh-CN': '允许再使用' }, restricted: { en: 'Reuse restricted', 'zh-CN': '再使用受限' }, unknown: { en: 'Reuse terms need review', 'zh-CN': '再使用条件待审阅' },
  },
};

export function knowledgeLocalizedText(value: KnowledgeText | undefined, locale: HistoryLocale, fallback = ''): { text: string; language: string | null } {
  const preferred = locale === 'zh-CN' ? ['zh-CN', 'zh-hans', 'zh-cn', 'zh', 'en'] : ['en'];
  for (const language of [...preferred, ...Object.keys(value ?? {})]) if (value?.[language]?.trim()) return { text: value[language], language };
  return { text: fallback, language: null };
}

export function knowledgeMetadataLabel(id: string, locale: HistoryLocale, catalog?: Record<string, KnowledgeText>): string | null {
  if (catalog?.[id]) return knowledgeLocalizedText(catalog[id], locale, id).text;
  if (Object.hasOwn(labels, id)) return labels[id][locale];
  if (id.startsWith('pleiades:attested-name:')) {
    const code = id.slice('pleiades:attested-name:'.length); let language = code;
    try { language = new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code; } catch { /* Preserve an unrecognized source language code. */ }
    return patterns.attestedName[locale].replace('{language}', language);
  }
  if (id.startsWith('pleiades-connection:')) return patterns.sourceConnection[locale].replace('{value}', id.slice('pleiades-connection:'.length));
  return null;
}
export function knowledgeTypeLabel(id: string, locale: HistoryLocale, catalog?: Record<string, KnowledgeText>): string | null {
  const fixed = knowledgeMetadataLabel(id, locale, catalog); if (fixed) return fixed;
  for (const [prefix, provider] of [['cliopatria:', 'Cliopatria'], ['pleiades-type:', 'Pleiades']] as const) if (id.startsWith(prefix)) return patterns.sourceType[locale].replace('{provider}', provider).replace('{value}', id.slice(prefix.length));
  return null;
}

const displayCopy = {
  originalSourceTitle: { en: 'Original source title', 'zh-CN': '来源原题' },
  originalValue: { en: 'Original value', 'zh-CN': '原始值' },
  displayEvidence: { en: 'Display text sources', 'zh-CN': '显示译文来源' },
  translationConflict: { en: 'Conflicting display translations', 'zh-CN': '显示译文有冲突' },
  missingTranslation: { en: 'Source language', 'zh-CN': '来源原文' },
  translationMethod: { en: 'Transformation', 'zh-CN': '转换方式' },
  translationSource: { en: 'Translation evidence', 'zh-CN': '译文依据' },
  authorHistory: { en: 'Author history', 'zh-CN': '作者历史' },
  attribution: { en: 'Attribution', 'zh-CN': '署名' },
  changes: { en: 'Source transformations', 'zh-CN': '来源转换说明' },
};
export const knowledgeDisplayCopy = (key: keyof typeof displayCopy, locale: HistoryLocale): string => displayCopy[key][locale];
const providers: Record<string, Label> = {
  'cliopatria-frame': { en: 'Cliopatria', 'zh-CN': 'Cliopatria' },
  wikidata: { en: 'Wikidata', 'zh-CN': '维基数据' },
  'wikipedia-en': { en: 'English Wikipedia', 'zh-CN': '英语维基百科' },
  pleiades: { en: 'Pleiades', 'zh-CN': 'Pleiades' },
  periodo: { en: 'PeriodO', 'zh-CN': 'PeriodO' },
  'gitworld-local': { en: 'Local amendment', 'zh-CN': '本地修订依据' },
  'gitworld-source-binding': { en: 'Interpretation record', 'zh-CN': '解释记录' },
  'gitworld-content-labels': { en: 'Display text evidence', 'zh-CN': '显示译文依据' },
  'gitworld-field-catalog': { en: 'Field catalog', 'zh-CN': '字段目录' },
  'wikipedia-table-selection': { en: 'Wikipedia table mapping', 'zh-CN': '维基百科表格映射' },
  'gitworld-wikipedia-profile': { en: 'Wikipedia mapping vocabulary', 'zh-CN': '维基百科映射词汇' },
};
export const knowledgeSourceProviderLabel = (provider: string, locale: HistoryLocale): string => providers[provider]?.[locale] ?? provider;

/** Values stay canonical. Only the service's matching assertion display metadata can supply a translation. */
export function knowledgeValueDisplay(value: import('../../../../packages/domain/src/knowledge.ts').KnowledgeValue, assertionIds: string[], context: KnowledgeObjectDetail | null, locale: HistoryLocale): KnowledgeDisplayText | null {
  if (value.kind !== 'text' || !context?.display) return null;
  const eligible = new Set(context.assertions.filter(assertion => assertionIds.includes(assertion.id) && assertion.value.kind === 'text' && assertion.value.value === value.value && assertion.value.language === value.language).map(assertion => assertion.id));
  const displays = [...eligible].map(id => context.display!.values[id]?.[locale]).filter((item): item is KnowledgeDisplayText => !!item);
  if (!displays.length) return null;
  const translated = displays.filter(item => item.status === 'translated'), variants = new Set(translated.map(item => item.text));
  const provenance = displays.flatMap(item => item.provenance);
  if (displays.some(item => item.status === 'conflict') || variants.size > 1) return { text: value.value, language: value.language ?? 'und', status: 'conflict', provenance };
  if (translated.length) return { ...translated[0], provenance };
  return displays[0];
}
export const knowledgeQualifierLabel = (propertyId: string, value: string, locale: HistoryLocale, catalog?: Record<string, Record<string, KnowledgeText>>): string | null => catalog?.[propertyId]?.[value] ? knowledgeLocalizedText(catalog[propertyId][value], locale, value).text : qualifierValues[propertyId]?.[value]?.[locale] ?? null;
export function knowledgeTimeLabel(kind: 'precision' | 'calendar', value: string, locale: HistoryLocale): string {
  if (kind === 'precision') return precisions[value]?.[locale] ?? value;
  const wikidata = value.match(/^https?:\/\/www\.wikidata\.org\/entity\/(Q1985786|Q1985727)$/);
  return calendars[wikidata ? `wikidata:${wikidata[1]}` : value]?.[locale] ?? value;
}
