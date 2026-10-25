import type { HistoryLocale } from '@gitworld/domain';

const messages = {
  en: {
    title: 'Import records and review matches', choose: 'Choose JSON file', format: 'Collection or paired import JSON · up to 32 MiB. Historical model packages use Library → Model packages.',
    preview: 'File preview', recoveredPreview: 'Accepted import preview', objects: 'Objects', claims: 'Claims', dated: 'Dated claims', located: 'Located objects',
    review: 'Use in historical states', unreviewed: 'Retain as unreviewed claims', adopted: 'Adopt the claims after review', adopt: 'Apply to working changes',
    notice: 'Supplied claims are added or updated; omitted records are retained. Review and commit the resulting working changes separately.',
    issues: 'Mapping issues', sample: 'Objects in this file', conflicts: 'Matches requiring a decision', noConflicts: 'No unresolved matches.',
    base: 'Previous source mapping', local: 'Local working record', incoming: 'Incoming source mapping', keep: 'Keep local record', use: 'Use incoming record', details: 'Details', none: 'Not recorded',
    mergePreviewChanged: 'The object merge rules changed. Preview the selected file again before applying it. No import was accepted.', legacyMergeHeld: 'This older import cannot be resumed safely. Its pending operation is kept. Restore a complete-library backup made before this unfinished import using Library → Model packages → Restore.',
    error: 'The operation could not be completed. Check the details or retry.', retry: 'Preview again', refresh: 'Refresh matches', busy: 'Working…', applied: 'The records are in working changes.', result: 'Open imported objects',
    metadata: 'Object identity or labels differ', fileChanged: 'The file or library changed. Preview it again before applying.', selected: 'Select a file to inspect its objects, dates, sources and optional field catalog.',
    resolveNote: 'This decides the whole object. Both source versions remain in the library; inspect the working changes before committing.',
    reviewOnly:'The conflicts and their source evidence are saved. No objects were adopted in this attempt.',
    resolveWikiNote:'Your choice applies to this whole object. The Wikipedia mapping still needs a new preview and complete adoption.',
    wikiNext:'Resolve the remaining Wikipedia conflicts, then open the original page in Saved source material. Choose Edit mapping if a preview is still open, preview the same mapping again and Add to working data before staging.',
    wikiResolved:'Your choice for the Wikipedia update is saved. Open the original page in Saved source material, choose Edit mapping if needed, then Preview mapping and Add to working data before staging.',
    catalog: 'Field catalog', properties: 'Fields', types: 'Types', values: 'Values', english: 'English', chinese: 'Simplified Chinese', identifier: 'Identifier', missingName: 'Missing name',
    missing: 'Missing translations', catalogConflicts: 'Conflicting names', catalogConflict: 'Conflicting catalog names block this import. Local names have not been replaced.',
    catalogEmpty: 'No entries in this category.', origin: 'Catalog source and rights', provider: 'Provider', externalId: 'External identifier', sourceUrl: 'Source document', retrieved: 'Retrieved',
    rights: 'Redistribution', rightsAllowed: 'Allowed by the recorded terms', rightsRestricted: 'Restricted', rightsUnknown: 'Terms unknown', license: 'License', attribution: 'Attribution', sourceEvidence: 'Catalog evidence',
    sourceId: 'Source record', sourceHash: 'Source hash', locator: 'Locator', catalogIdentity: 'Catalog identity', revision: 'Revision', previewIdentity: 'Preview and base revision', baseHead: 'Reviewed data revision', noCatalogEvidence: 'No catalog evidence recorded.',
    pendingTitle: 'Imports awaiting completion', pendingNotice: 'Complete the accepted import before starting another application. Its original review choice is retained.',
    resume: 'Resume import', checkResult: 'Check import result', refreshPending: 'Check pending imports', pendingFailed: 'Pending imports could not be read. Check again before applying another file.',
    unknownResult: 'The import result is unconfirmed. Check its original receipt before applying again.', notAccepted: 'No accepted receipt was found. Preview the selected file again before applying.',
    operation: 'Import operation', frozenReview: 'Accepted claim review', resumeFailed: 'The accepted import could not be completed. Its recovery entry remains available.', resultNavigationFailed: 'The records were applied, but their view could not be opened. Open the imported objects again.', moreDifferences: 'Show more differences',
    pendingUnreviewed: 'Unreviewed claims', pendingAdopted: 'Reviewed claims',
    pendingRedirect: 'Complete the unfinished import in Library → Sources → Imports and matches before applying further changes.',
    previous: 'Previous', next: 'Next', language: 'Language', workingFiles: 'Writing files · {completed}/{total}', countRange: 'Showing {from}–{to} of {total}',
    suppliedRange: 'Showing {shown} retained entries; total reported: {total}', catalogCounts: 'Fields: {properties} · Types: {types} · Values: {values}',
    missingCount: 'Missing translations: {count}', conflictCount: 'Conflicting names: {count}', issueCount: 'Issues shown: {shown}/{total}', changedCount: 'Changed objects: {count}',
  },
  'zh-CN': {
    title: '导入记录与审阅匹配', choose: '选择 JSON 文件', format: '资料集合或配套导入 JSON，最大 32 MiB。历史模型包请到“资料库 → 模型包”中导入。',
    preview: '文件预览', recoveredPreview: '已接受的导入预览', objects: '对象', claims: '主张', dated: '带日期的主张', located: '有位置的对象',
    review: '用于历史状态', unreviewed: '保留为未审阅主张', adopted: '审阅后采用这些主张', adopt: '应用到工作变化',
    notice: '新增或更新文件提供的主张，保留文件未包含的记录。之后请单独审阅并提交工作变化。',
    issues: '映射问题', sample: '文件中的对象', conflicts: '需要决定的匹配', noConflicts: '没有待处理的匹配。',
    base: '之前的来源映射', local: '本地工作记录', incoming: '新来源映射', keep: '保留本地记录', use: '使用新来源记录', details: '详情', none: '未记录',
    mergePreviewChanged: '对象合并规则已更新。请重新预览所选文件后再采用；这次导入尚未被接受。', legacyMergeHeld: '这次旧版导入无法安全继续，待确认操作已保留。请通过“资料库 → 模型包 → 恢复”，恢复这次未完成导入开始之前的完整资料库备份。',
    error: '操作未完成，请查看详情或重试。', retry: '重新预览', refresh: '刷新匹配', busy: '正在处理…', applied: '记录已进入工作变化。', result: '查看导入的对象',
    metadata: '对象身份或名称存在差异', fileChanged: '文件或资料库已有变化，请重新预览后再应用。', selected: '选择文件后，可查看其中的对象、日期、来源及配套字段目录。',
    resolveNote: '决定针对整个对象，两份来源版本仍保留在资料库中。提交前请审阅工作变化。',
    reviewOnly:'冲突及其来源证据已保存，本次尚未采用对象。',
    resolveWikiNote:'这次决定针对整个对象，维基百科映射仍需重新预览并完整采用。',
    wikiNext:'请先决定剩余的维基百科冲突，再到“已保存的来源资料”打开原页面。若仍显示旧预览，先选“修改映射选择”，然后重新预览同一份映射并“加入工作资料”，再进行暂存。',
    wikiResolved:'维基百科更新中的对象取舍已保存。请到“已保存的来源资料”打开原页面，必要时先选“修改映射选择”，再重新预览同一份映射并“加入工作资料”，然后进行暂存。',
    catalog: '字段目录', properties: '字段', types: '类型', values: '取值', english: '英文名称', chinese: '简体中文名称', identifier: '标识', missingName: '缺少名称',
    missing: '缺少译文', catalogConflicts: '名称冲突', catalogConflict: '字段目录存在名称冲突，本次导入无法应用；本地名称未被替换。',
    catalogEmpty: '这类目录尚无条目。', origin: '目录来源与使用条件', provider: '数据提供方', externalId: '外部标识', sourceUrl: '来源文档', retrieved: '获取时间',
    rights: '再分发条件', rightsAllowed: '所记录条款允许', rightsRestricted: '受限制', rightsUnknown: '条款未知', license: '许可', attribution: '署名', sourceEvidence: '目录依据',
    sourceId: '来源记录', sourceHash: '来源校验值', locator: '定位信息', catalogIdentity: '目录身份', revision: '修订版', previewIdentity: '预览与基准版本', baseHead: '已审阅的资料版本', noCatalogEvidence: '尚无目录依据记录。',
    pendingTitle: '尚未完成的导入', pendingNotice: '请先完成已接受的导入，再应用另一份文件。恢复时沿用原来的主张审阅选择。',
    resume: '继续导入', checkResult: '核对导入结果', refreshPending: '检查未完成导入', pendingFailed: '暂时无法读取未完成导入。应用另一份文件前请重新检查。',
    unknownResult: '导入结果尚未确认。再次应用前，请先核对原操作的记录。', notAccepted: '未找到已接受的导入记录，请重新预览文件后再应用。',
    operation: '导入操作', frozenReview: '已接受的主张审阅选择', resumeFailed: '这次导入尚未完成，仍可从恢复入口重试。', resultNavigationFailed: '记录已应用，但暂时无法打开结果视图，请重新查看导入的对象。', moreDifferences: '显示更多差异',
    pendingUnreviewed: '未审阅主张', pendingAdopted: '已审阅主张',
    pendingRedirect: '请先到“资料库 → 来源 → 导入与匹配”完成尚未结束的导入，再应用其他修改。',
    previous: '上一页', next: '下一页', language: '语言', workingFiles: '正在写入 {completed}/{total} 个文件', countRange: '当前显示 {from}–{to}，共 {total} 条',
    suppliedRange: '当前显示已保留的 {shown} 条；报告总数为 {total} 条', catalogCounts: '{properties} 个字段 · {types} 个类型 · {values} 个取值',
    missingCount: '缺少 {count} 项译文', conflictCount: '{count} 项名称冲突', issueCount: '当前显示 {shown}/{total} 项问题', changedCount: '{count} 个对象有变化',
  },
} as const;
type Parameters = { workingFiles: { completed: number; total: number }; countRange: { from: number; to: number; total: number }; suppliedRange: { shown: number; total: number }; catalogCounts: { properties: number; types: number; values: number }; missingCount: { count: number }; conflictCount: { count: number }; issueCount: { shown: number; total: number }; changedCount: { count: number } };
export type KnowledgeFilesCopyKey = keyof typeof messages.en;
export type KnowledgeFilesPlainKey = Exclude<KnowledgeFilesCopyKey, keyof Parameters>;
export function knowledgeFilesCopy<K extends KnowledgeFilesCopyKey>(locale: HistoryLocale, key: K, ...args: K extends keyof Parameters ? [Parameters[K]] : []): string {
  let message: string = messages[locale][key];
  for (const [name, value] of Object.entries((args[0] ?? {}) as Record<string, string | number>)) message = message.replaceAll(`{${name}}`, typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value);
  return message;
}
