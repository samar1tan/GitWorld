import type { HistoryLocale } from '@gitworld/domain';

const messages = {
  en: {
    previewMapping:'Preview mapping',applyMapping:'Add to working changes',useInStates:'Use these source statements in historical state queries',mappingSummary:'{objects} objects · {assertions} claims · {dated} dated claims',mappingHint:'Review the mapping before adopting source statements. Dates, alternatives and evidence are retained.',mappingIssues:'Fields requiring attention',mappingChanged:'The library changed. Open a new mapping preview before applying it.',
    findData: 'Find data', explore: 'Return to exploration', search: 'Search', saved: 'Saved source material',
    searchLabel: 'Name or keyword', searchHint: 'Search Wikidata names and aliases.', queryPlaceholder: 'A person, place, institution, or event',
    searchLanguage: 'Search language', english: 'English', chinese: '简体中文', searching: 'Searching Wikidata…',
    results: 'Search results', noResults: 'No matching names. Try another name or spelling.', startSearch: 'Enter a name to find source records.',
    nextPage: 'Load more results', limitReached: 'The source search limit was reached. Narrow the name or keyword.',
    selected: '{count} selected', selectRecord: 'Select {name}', selectPage: 'Select these results', clearSelection: 'Clear selection',
    collect: 'Save selected records', collecting: 'Saving source records…', cancel: 'Cancel', cancelling: 'Cancelling…',
    progress: '{completed} of {total} records saved', labelsProgress: 'Loading property names…', refreshing: 'Reading saved material…',
    savedNotice: 'These are source records. They have not been adopted into the historical model.',
    emptySaved: 'No source material has been saved yet.', jobs: 'Acquisition tasks', refresh: 'Refresh', resume: 'Retry remaining records',
    complete: 'Complete', partial: 'Partly saved', cancelled: 'Cancelled', failed: 'Failed', pending: '{count} records remaining',
    materials: 'Records', auxiliary: 'Property names', showProperties: 'Include property records', recordsCount: '{count} records',
    claimsCount: '{count} statements', inspect: 'View statements', chooseRecord: 'Select a saved record to inspect its statements and sources.',
    loadingRecord: 'Opening source record…', statements: 'Statements', filterProperties: 'Filter properties', noStatements: 'This source record has no statements.',
    noProperties: 'No properties match this filter.', moreProperties: 'Show more properties', sourceRank: 'Source rank',
    preferred: 'Preferred by source', normal: 'Normal rank', deprecated: 'Deprecated by source', qualifiers: 'Qualifiers',
    references: 'References', noReferences: 'No references on this statement.', sourceUnknown: 'Value unspecified in source',
    sourceAbsent: 'Source states no value', unsupported: 'Value available in source data', sourceRecord: 'Open Wikidata record',
    fixedRevision: 'Open source revision', sourceRevision: 'Source revision', retrieved: 'Retrieved', license: 'Structured data license',
    sourceDetails: 'Source details', raw: 'Raw source JSON', showRaw: 'Show raw JSON', field: 'Property', value: 'Value',
    calendar: 'Calendar', precision: 'Precision', bounds: 'Source bounds', beforeAfter: 'Before / after', unit: 'Unit',
    year: 'Year', month: 'Month', day: 'Day', hour: 'Hour', minute: 'Minute', second: 'Second',
    decade: 'Decade', century: 'Century', millennium: 'Millennium', broader: 'Broader date precision',
    julian: 'Julian', gregorian: 'Gregorian', coordinatePrecision: 'Coordinate precision', globe: 'Globe', language: 'Language',
    missingLabels: 'Some property names could not be loaded. Their source IDs remain available.',
    corruptJob: 'A saved task could not be read. Its files have been preserved.', issueDetails: 'Task details',
    networkError: 'Could not reach Wikidata. Check the connection and retry.', busyError: 'Wikidata is busy. Try again shortly.',
    rateError: 'Wikidata limited this request. Retry after {seconds} seconds.', cancelledError: 'The request was cancelled. Saved records remain available.',
    invalidError: 'Check the search text or selected records.', missingError: 'The source no longer returned this record.',
    responseError: 'The source returned an unreadable response. Retry or narrow the request.', stagingError: 'The records could not be saved locally. Check available disk space and retry.',
    serviceError: 'The local service could not complete the request.', retrySearch: 'Retry search', retryRecord: 'Retry opening record',
    notFound: 'No saved record was found for this selection.', errorCode: 'Error code', savedAt: 'Saved {date}',
    previous: 'Previous', next: 'Next', page: 'Page {page} of {pages}', range: 'Results {from}–{to}',
    languageFallback: 'EN', clearFilter: 'Clear filter', noDateInference: 'Dates and rankings are supplied by the source.',
  },
  'zh-CN': {
    previewMapping:'预览映射结果',applyMapping:'加入待提交内容',useInStates:'将这些来源主张用于历史状态查询',mappingSummary:'{objects} 个对象 · {assertions} 条主张 · {dated} 条带日期的主张',mappingHint:'采用来源主张前，请检查映射结果。日期、不同说法和证据会一并保留。',mappingIssues:'需要检查的字段',mappingChanged:'资料库已发生变化，请重新预览映射结果再应用。',
    findData: '查找数据', explore: '返回探索', search: '搜索', saved: '已保存的来源资料',
    searchLabel: '名称或关键词', searchHint: '搜索 Wikidata 中的名称与别名。', queryPlaceholder: '人物、地点、机构或事件',
    searchLanguage: '检索语言', english: 'English', chinese: '简体中文', searching: '正在搜索 Wikidata…',
    results: '搜索结果', noResults: '没有匹配的名称。试试其他名称或拼写。', startSearch: '输入名称，查找来源记录。',
    nextPage: '加载更多结果', limitReached: '已达到来源的检索上限，请缩小名称或关键词范围。',
    selected: '已选 {count} 条', selectRecord: '选择 {name}', selectPage: '选择这些结果', clearSelection: '清除选择',
    collect: '保存选中记录', collecting: '正在保存来源记录…', cancel: '取消', cancelling: '正在取消…',
    progress: '已保存 {completed} / {total} 条记录', labelsProgress: '正在获取属性名称…', refreshing: '正在读取已保存资料…',
    savedNotice: '这些是来源记录，尚未采用为历史模型中的内容。',
    emptySaved: '尚未保存来源资料。', jobs: '获取任务', refresh: '刷新', resume: '重试剩余记录',
    complete: '已完成', partial: '部分已保存', cancelled: '已取消', failed: '失败', pending: '还剩 {count} 条记录',
    materials: '记录', auxiliary: '属性名称', showProperties: '包括属性记录', recordsCount: '{count} 条记录',
    claimsCount: '{count} 条声明', inspect: '查看声明', chooseRecord: '选择一条已保存记录，查看声明及来源。',
    loadingRecord: '正在打开来源记录…', statements: '声明', filterProperties: '筛选属性', noStatements: '此来源记录没有声明。',
    noProperties: '没有匹配的属性。', moreProperties: '显示更多属性', sourceRank: '来源排序',
    preferred: '来源首选', normal: '普通排序', deprecated: '来源已弃用', qualifiers: '限定条件',
    references: '参考来源', noReferences: '这条声明未列参考来源。', sourceUnknown: '来源未指明具体值',
    sourceAbsent: '来源声明不存在值', unsupported: '可在源数据中查看此值', sourceRecord: '打开 Wikidata 记录',
    fixedRevision: '打开来源修订版', sourceRevision: '来源修订版', retrieved: '获取时间', license: '结构化数据许可',
    sourceDetails: '来源详情', raw: '原始来源 JSON', showRaw: '显示原始 JSON', field: '属性', value: '值',
    calendar: '历法', precision: '精度', bounds: '来源取值界限', beforeAfter: '前 / 后范围', unit: '单位',
    year: '年', month: '月', day: '日', hour: '小时', minute: '分钟', second: '秒',
    decade: '十年', century: '世纪', millennium: '千年', broader: '更宽日期精度',
    julian: '儒略历', gregorian: '公历', coordinatePrecision: '坐标精度', globe: '天体', language: '语言',
    missingLabels: '部分属性名称尚未获取，可通过来源 ID 查看。',
    corruptJob: '一项已保存任务无法读取，其文件仍保留。', issueDetails: '任务详情',
    networkError: '无法连接 Wikidata，请检查网络后重试。', busyError: 'Wikidata 当前繁忙，请稍后重试。',
    rateError: 'Wikidata 限制了这次请求，请在 {seconds} 秒后重试。', cancelledError: '请求已取消，已保存记录仍可使用。',
    invalidError: '请检查检索文字或所选记录。', missingError: '来源未再返回这条记录。',
    responseError: '来源返回了无法读取的响应，请重试或缩小请求范围。', stagingError: '无法保存记录到本机，请检查可用磁盘空间后重试。',
    serviceError: '本地服务未能完成请求。', retrySearch: '重试搜索', retryRecord: '重新打开记录',
    notFound: '找不到所选的已保存记录。', errorCode: '错误代码', savedAt: '保存于 {date}',
    previous: '上一页', next: '下一页', page: '第 {page} / {pages} 页', range: '结果 {from}–{to}',
    languageFallback: 'EN', clearFilter: '清除筛选', noDateInference: '日期和排序来自原始来源。',
  },
} as const;
export type SourceCopyKey = keyof typeof messages.en;
type Parameters = {
  mappingSummary: { objects:number; assertions:number; dated:number };
  selected: { count: number }; selectRecord: { name: string }; progress: { completed: number; total: number };
  pending: { count: number }; recordsCount: { count: number }; claimsCount: { count: number };
  rateError: { seconds: number }; savedAt: { date: string }; page: { page: number; pages: number }; range: { from: number; to: number };
};
export function sourceCopy<K extends SourceCopyKey>(locale: HistoryLocale, key: K, ...args: K extends keyof Parameters ? [Parameters[K]] : []): string {
  let message: string = messages[locale][key];
  const values = args[0] as Record<string, string | number> | undefined;
  for (const [name, value] of Object.entries(values ?? {})) message = message.replaceAll(`{${name}}`, typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value);
  return message;
}
