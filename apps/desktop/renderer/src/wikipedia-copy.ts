import type { HistoryLocale } from '@gitworld/domain';
const messages = {
  en: {
    source: 'Source', wikidata: 'Wikidata', wikipedia: 'English Wikipedia', saveHeading: 'Save a Wikipedia source page',
    pageTitle: 'Page title', revision: 'Revision number (optional)', pageHint: 'Use an exact English Wikipedia page title. Leave the revision empty to pin the version returned by the source.',
    save: 'Save source page', saving: 'Saving source page…', cancel: 'Cancel', cancelling: 'Cancelling…', working: 'Working…',
    savedHeading: 'Saved Wikipedia pages', noJobs: 'No Wikipedia pages have been saved.', chooseJob: 'Select a saved page to inspect its tables.', refresh: 'Refresh', previous: 'Previous', next: 'Next',
    complete: 'Complete', partial: 'Partly saved', cancelled: 'Cancelled', failed: 'Failed', loading: 'Reading saved pages…', inspecting: 'Reading source tables…',
    inspectHeading: 'Inspect and map source tables', previewHeading: 'Review the mapping', sourceRevision: 'Source revision', retrieved: 'Retrieved', requestedTitle: 'Requested title',
    sourceDetails: 'Source details', rights: 'Rights and attribution', rightsUnknown: 'Redistribution rights unknown', rightsAllowed: 'Redistribution recorded as allowed', rightsRestricted: 'Redistribution recorded as restricted',
    attribution: 'Attribution', license: 'License', sourceHash: 'Source snapshot hash', jobIdentity: 'Acquisition job', retryAcquisition: 'Retry acquisition', editRequest: 'Edit request',
    profile: 'Mapping profile', chooseProfile: 'Choose a mapping profile', calendar: 'Calendar', sourceUnspecified: 'Source unspecified', gregorian: 'Gregorian', julian: 'Julian', tables: 'Source tables',
    noTables: 'This saved page has no inspectable tables.', useTable: 'Map this table', removeTable: 'Remove table', table: 'Table {number}', physicalRows: { one: '{count} source row', other: '{count} source rows' }, columns: { one: '{count} column', other: '{count} columns' },
    chooseColumn: 'Choose a source column', column: '{number} · {label}', unnamedColumn: 'Untitled column', holder: 'Holder column', dateLayout: 'Tenure columns', split: 'Separate start and end', tenure: 'One tenure column',
    tenureColumn: 'Tenure column', startColumn: 'Start column', endColumn: 'End column', timeColumn: 'Time column', attributeColumn: 'Attribute column', readAs: 'Read as', text: 'Source text', linked: 'Linked subjects', addColumn: 'Add attribute column', removeColumn: 'Remove column',
    rowBoundary: 'Row boundary', firstRow: 'Start at source row index (optional)', headers: 'All source headers', sample: 'Selected column sample', row: 'Source row {number}', emptyCell: 'Empty cell', noCell: 'No cell supplied in this sample', trimmed: 'Sample text shortened',
    preview: 'Preview mapping', preparing: 'Preparing mapping preview…', editMapping: 'Edit mapping', profileRequired: 'Choose a mapping profile.', tableRequired: 'Choose the table or tables for this profile.', columnsRequired: 'Choose the required source columns.', distinctColumns: 'Use a different column for each role.', rowInvalid: 'Use a source row index from 0 to 10,000.',
    titleInvalid: 'Enter an English Wikipedia page title, without a URL.', revisionInvalid: 'Use a positive revision number or leave it empty.', tableLimit: 'A tenure profile can use up to ten tables.', columnLimit: 'A dated-entry profile can use up to ten attribute columns.',
    sourceChanged: 'The saved source or headers differ from these choices. Review the old choices before resetting them.', resetChoices: 'Reset mapping choices', oldChoices: 'Previous column choices',
    sourceRows: 'Source rows', mappedRows: 'Mapped rows', objects: 'Objects', claims: 'Claims', dateCoverage: 'Dates and historical applicability', dated: 'Claims bearing dates', applicable: 'Claims with historical applicability', timedRows: 'Mapped rows with dates',
    coverageNote: 'Table rows and mapped records are separate counts. A date value does not by itself establish historical applicability.', baseHead: 'Library data revision used by this preview', prepared: 'Prepared preview', exactPlan: 'Exact mapping plan',
    issues: { one: 'Mapping issue', other: 'Mapping issues' }, noIssues: 'No mapping issues were reported.', issueRange: 'Showing {shown} supplied issues of {total} reported.', issueDetails: 'Issue details', issuesLoading: 'Reading issue page…', issuesReadFailed: 'This issue page could not be read. The current page and mapping choices remain here.', retryIssues: 'Retry page',
    OPEN_END: 'No end date recorded', UNPARSED_TIME: 'Date could not be read', UNCERTAIN_TIME: 'Date remains uncertain', PROVISIONAL_HOLDER: 'Holder has no resolved source identity', SOURCE_CHRONOLOGY_WARNING: 'Source chronology needs review', UNRESOLVED_VALUE: 'Linked subject could not be resolved', UNSUPPORTED_HEADERS: 'Table headers are not supported by this mapping', otherIssue: 'Mapping exception',
    claimSample: 'Proposed claim sample', sampleRange: { one: '{shown} supplied claim of {total} proposed', other: '{shown} supplied claims of {total} proposed' }, object: 'Object', field: 'Field', value: 'Value', applicability: 'Historical applicability', evidence: 'Evidence', locator: 'Locator', qualifier: 'Source qualifiers', unlabelledObject: 'Object without a supplied name', unlabelledField: 'Field without a supplied name', identifiers: 'Identifiers', original: 'Original source value', unknown: 'Unspecified in source', absent: 'Source states absence', yes: 'Yes', no: 'No',
    review: 'Claim review', unreviewed: 'Keep claims unreviewed', reviewed: 'Mark source claims reviewed', adopt: 'Add to working data', adoptNotice: 'Adds the proposed objects, claims, evidence and field names to working data. Staging and commit remain separate.',
    applied: 'The mapped records are in working data.', showResult: 'Open imported objects', conflicts: 'Source evidence was saved, but this mapping is not adopted. Resolve the conflicts in Imports and matches, then return here: Edit mapping → Preview mapping → Add to working data.', pending: 'Finish the accepted import in Imports and matches before applying another mapping.', pendingFailed: 'Pending imports could not be read. Retry before applying this mapping.', openImports: 'Open Imports and matches', checkResult: 'Check import result', uncertain: 'The import result is unconfirmed. Check the original operation before applying again.',
    mergePreviewChanged: 'The object merge rules changed. Prepare a new preview from the saved source before adopting it. No import was accepted.', legacyMergeHeld: 'This older import cannot be resumed safely. Its pending operation is kept. Restore a complete-library backup made before this unfinished import using Library → Model packages → Restore.',
    headChanged: 'The library changed. Keep these column choices and prepare a new preview.', profileChanged: 'The mapping rule changed. Keep these choices and prepare a new preview from the saved source.', previewChanged: 'The prepared mapping or source no longer matches. Prepare a new preview.', sourceIncomplete: 'The source page has not been saved completely. Retry acquisition first.',
    profileInvalid: 'Check the selected tables and columns.', tooLarge: 'The selected tables exceed the supported mapping size. Narrow the selection.', previewBudget: 'This mapping exceeds the import size limit. Select fewer or smaller tables.',
    unavailable: 'The local service is unavailable. Your input remains here.', network: 'The source could not be reached. Saved material remains available.', sourceBusy: 'Wikipedia is busy. Retry this acquisition later.', rateError: 'Wikipedia limited this request. Retry after {seconds} seconds.', unreadable: 'The source returned an unreadable response.', pageMissing: 'The requested page or revision was not found. Check the page title and revision number.',
    genericError: 'The operation could not be completed. Your input has been retained.', errorCode: 'Error details', retry: 'Retry', draftFailed: 'These choices could not be retained. Retry before starting another operation.', jobCorrupt: 'A saved page could not be read. Its files remain preserved.', resultNavigation: 'The import completed, but its objects could not be opened. Try opening the result again.',
    range: '{from}–{to} of {total}', filesProgress: '{completed} of {total} files written', bce: '{year} BCE', dateRange: '{from}–{to}', monthDate: '{month} {year}', dayDate: '{month} {day}, {year}', noDate: 'No applicable time recorded',
  },
  'zh-CN': {
    source: '来源', wikidata: 'Wikidata', wikipedia: '英文维基百科', saveHeading: '保存维基百科来源页',
    pageTitle: '页面标题', revision: '修订号（可选）', pageHint: '输入英文维基百科的准确页面标题。修订号留空时，会固定来源返回的版本。',
    save: '保存来源页', saving: '正在保存来源页…', cancel: '取消', cancelling: '正在取消…', working: '正在处理…',
    savedHeading: '已保存的维基百科页面', noJobs: '尚未保存维基百科页面。', chooseJob: '选择一个已保存的页面，检查其中的表格。', refresh: '刷新', previous: '上一页', next: '下一页',
    complete: '已完成', partial: '部分已保存', cancelled: '已取消', failed: '失败', loading: '正在读取已保存页面…', inspecting: '正在读取来源表格…',
    inspectHeading: '检查来源表格并映射', previewHeading: '检查映射结果', sourceRevision: '来源修订号', retrieved: '获取时间', requestedTitle: '请求的标题',
    sourceDetails: '来源详情', rights: '权利与署名', rightsUnknown: '再分发权利未知', rightsAllowed: '来源记录允许再分发', rightsRestricted: '来源记录限制再分发',
    attribution: '署名', license: '许可', sourceHash: '来源快照哈希', jobIdentity: '获取任务', retryAcquisition: '重试获取', editRequest: '修改请求',
    profile: '映射方式', chooseProfile: '选择映射方式', calendar: '历法', sourceUnspecified: '来源未注明', gregorian: '公历', julian: '儒略历', tables: '来源表格',
    noTables: '这个已保存页面没有可检查的表格。', useTable: '映射这张表', removeTable: '移除表格', table: '表格 {number}', physicalRows: '{count} 行来源数据', columns: '{count} 列',
    chooseColumn: '选择来源列', column: '{number} · {label}', unnamedColumn: '未命名列', holder: '任职者列', dateLayout: '任期列格式', split: '起止日期分列', tenure: '单列任期',
    tenureColumn: '任期列', startColumn: '开始日期列', endColumn: '结束日期列', timeColumn: '时间列', attributeColumn: '属性列', readAs: '读取方式', text: '来源原文', linked: '链接对象', addColumn: '添加属性列', removeColumn: '移除列',
    rowBoundary: '来源行边界', firstRow: '从来源行索引开始（可选）', headers: '全部来源列标题', sample: '所选列的样本', row: '来源行 {number}', emptyCell: '空单元格', noCell: '样本未提供此单元格', trimmed: '样本文字已缩短',
    preview: '预览映射', preparing: '正在准备映射预览…', editMapping: '修改映射选择', profileRequired: '请选择映射方式。', tableRequired: '请选择这种映射所用的表格。', columnsRequired: '请选择必要的来源列。', distinctColumns: '不同用途请分别选用不同的列。', rowInvalid: '请填写 0 至 10,000 的来源行索引。',
    titleInvalid: '请输入英文维基百科的页面标题，不要填写网址。', revisionInvalid: '请填写正整数修订号，或留空。', tableLimit: '任职映射最多选择十张表。', columnLimit: '来源条目映射最多选择十个属性列。',
    sourceChanged: '已保存来源或列标题与这些选择不一致。请先检查旧选择，再重置映射。', resetChoices: '重置映射选择', oldChoices: '此前的列选择',
    sourceRows: '原表行', mappedRows: '已映射行', objects: '对象', claims: '主张', dateCoverage: '日期与历史适用时段', dated: '包含日期的主张', applicable: '有历史适用时段的主张', timedRows: '带日期的已映射行',
    coverageNote: '原表行与映射后的记录分别计数。取值中含有日期，不一定代表具有历史适用时段。', baseHead: '本次预览采用的资料库版本', prepared: '已准备的预览', exactPlan: '精确映射方案',
    issues: '映射问题', noIssues: '没有报告映射问题。', issueRange: '共报告 {total} 条问题；这里提供其中 {shown} 条。', issueDetails: '问题详情', issuesLoading: '正在读取问题页…', issuesReadFailed: '未能读取这一页问题，当前页面和映射选择仍保留。', retryIssues: '重试读取',
    OPEN_END: '来源未给出结束日期', UNPARSED_TIME: '日期未能解析', UNCERTAIN_TIME: '日期仍不确定', PROVISIONAL_HOLDER: '尚未确定任职者的来源身份', SOURCE_CHRONOLOGY_WARNING: '来源纪年待核对', UNRESOLVED_VALUE: '尚未解析出链接对象', UNSUPPORTED_HEADERS: '这种映射不支持这些列标题', otherIssue: '映射异常',
    claimSample: '拟写入主张样本', sampleRange: '共拟写入 {total} 条主张；这里提供其中 {shown} 条', object: '对象', field: '字段', value: '取值', applicability: '历史适用时段', evidence: '依据', locator: '定位', qualifier: '来源限定条件', unlabelledObject: '来源未提供名称的对象', unlabelledField: '来源未提供名称的字段', identifiers: '标识符', original: '来源原值', unknown: '来源未指明', absent: '来源明确记为不存在', yes: '是', no: '否',
    review: '主张审阅', unreviewed: '保留为未审阅主张', reviewed: '将来源主张标为已审阅', adopt: '加入工作资料', adoptNotice: '将拟写入的对象、主张、证据和字段名称加入工作资料。暂存与提交是后续的独立操作。',
    applied: '映射后的记录已加入工作资料。', showResult: '查看导入的对象', conflicts: '来源证据已保存，本次尚未采用映射。先到“导入与匹配”决定冲突，再回到这里修改映射选择、重新预览并加入工作资料。', pending: '请先到“导入与匹配”完成已接受的导入，再采用另一份映射。', pendingFailed: '未能读取尚未完成的导入。采用映射前请重试。', openImports: '前往导入与匹配', checkResult: '检查导入结果', uncertain: '尚未确认这次导入的结果。再次采用前，请先检查原操作。',
    mergePreviewChanged: '对象合并规则已更新。请基于已保存的来源重新预览后再采用；这次导入尚未被接受。', legacyMergeHeld: '这次旧版导入无法安全继续，待确认操作已保留。请通过“资料库 → 模型包 → 恢复”，恢复这次未完成导入开始之前的完整资料库备份。',
    headChanged: '资料库已发生变化。列选择会保留，请重新准备预览。', profileChanged: '映射规则已更新。列选择会保留，请用已保存来源重新预览。', previewChanged: '已准备的映射或来源已不匹配，请重新准备预览。', sourceIncomplete: '来源页尚未完整保存，请先重试获取。',
    profileInvalid: '请检查选中的表格与列。', tooLarge: '所选表格超过支持的映射规模，请缩小选择。', previewBudget: '这份映射超过导入大小上限，请减少表格或选择较小的表格。',
    unavailable: '本地服务当前不可用，输入仍保留。', network: '无法连接来源，已保存资料仍可使用。', sourceBusy: '维基百科当前繁忙，请稍后重试获取。', rateError: '维基百科限制了这次请求，请在 {seconds} 秒后重试。', unreadable: '来源返回了无法读取的响应。', pageMissing: '未找到请求的页面或修订版本。请检查页面标题和修订号。',
    genericError: '未能完成这次操作，输入已保留。', errorCode: '错误详情', retry: '重试', draftFailed: '未能保留这些选择。开始另一项操作前请重试保存。', jobCorrupt: '一个已保存页面无法读取，其文件仍保留。', resultNavigation: '导入已经完成，但未能打开对象，请重试查看结果。',
    range: '{total} 个中的 {from}–{to}', filesProgress: '已写入 {completed} / {total} 个文件', bce: '公元前 {year}', dateRange: '{from}–{to}', monthDate: '{year}年{month}月', dayDate: '{year}年{month}月{day}日', noDate: '尚未收录适用时段',
  },
} as const;
export type WikipediaCopyKey = keyof typeof messages.en;
type Parameters = { table: { number: number }; physicalRows: { count: number }; columns: { count: number }; column: { number: number; label: string }; row: { number: number }; issues: { count: number }; issueRange: { shown: number; total: number }; sampleRange: { shown: number; total: number }; range: { from: number; to: number; total: number }; filesProgress: { completed: number; total: number }; rateError: { seconds: number }; bce: { year: number }; dateRange: { from: string; to: string }; monthDate: { year: string; month: string }; dayDate: { year: string; month: string; day: number } };
export type WikipediaPlainKey = Exclude<WikipediaCopyKey, keyof Parameters>;
export function wikipediaCopy<K extends WikipediaCopyKey>(locale: HistoryLocale, key: K, ...args: K extends keyof Parameters ? [Parameters[K]] : []): string {
  const values = (args[0] ?? {}) as Record<string, string | number>, template = messages[locale][key];
  let message: string = typeof template === 'string' ? template : template[new Intl.PluralRules(locale).select(Number(values.count ?? values.shown)) === 'one' ? 'one' : 'other'];
  for (const [name, value] of Object.entries(values)) message = message.replaceAll(`{${name}}`, typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value);
  return message;
}
