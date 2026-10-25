import type { HistoryLocale } from '@gitworld/domain';
const messages = {
  en: {
    pendingContext:'Resume the unfinished context write before changing repository data.',resumeContext:'Resume context operation',
    pendingImport: 'Complete the unfinished import in Library → Sources → Imports and matches before continuing.', resumeImport: 'Open Imports and matches',
    add: 'Add claim', correct: 'Correct claim', newObject: 'New object', close: 'Return to exploration', action: 'Action', claim: 'Claim to correct', chooseClaim: 'Choose a claim',
    working: 'Editing current working data', base: 'Data revision', historicalContext: 'Historical context: {year} · {revision}', noHistoricalTime: 'Time not fixed', loading: 'Loading the current record…',
    nameEn: 'English name', nameZh: 'Simplified Chinese name', type: 'Type', noType: 'No type selected', field: 'Field', chooseField: 'Choose a field', currentValue: 'Current value',
    keepValue: 'Keep existing value', replaceValue: 'Replace value', preserveValue: 'The full source value and metadata will be kept.', complexValue: 'Structured source value',
    valueKind: 'Value type', text: 'Text', entity: 'Object', number: 'Number', boolean: 'Yes or no', time: 'Date in years', coordinate: 'Location', unknown: 'Unknown value', absent: 'Source states no value',
    textValue: 'Value', language: 'Text language', numericValue: 'Value', unit: 'Unit', unitless: 'Unitless', squareKilometres: 'km²', noUnit: 'No unit', lower: 'Lower bound', upper: 'Upper bound',
    entityQuery: 'Find an object by name', search: 'Search', searching: 'Searching…', noEntities: 'No matching objects.', chooseEntity: 'Select a result to use it as the value.', yes: 'Yes', no: 'No', earliest: 'Earliest year', latest: 'Latest year (optional)', longitude: 'Longitude', latitude: 'Latitude', yearPrecision: 'New dates use year precision. Negative years indicate BCE; year zero is not used.',
    applicability: 'When does this claim apply?', timeMode: 'Date scope', currentTime: 'Current applicability', valueChange: 'Value change', keepTime: 'Keep existing applicability', noTime: 'No applicability date', pointTime: 'At a year', rangeTime: 'During a year range', from: 'Year / from year', to: 'Until year', possible: 'Applicability is uncertain',
    evidence: 'Evidence', evidenceMode: 'Source choice', existingSource: 'Existing source', newCitation: 'New citation', source: 'Source', chooseSource: 'Choose a source', sourceTitle: 'Source title', sourceUrl: 'HTTPS URL', locator: 'Page, section or record locator', citation: 'Citation note (optional)',
    reason: 'Reason for this addition or correction', review: 'Claim review', unreviewed: 'Keep unreviewed', reviewed: 'Use as reviewed evidence', save: 'Save to working data', saving: 'Saving…', saved: 'Saved to working data', changes: 'Review Changes', savedDetail: 'Review this increment in Changes before committing.',
    recovered: 'Unfinished edit restored', draftFailed: 'This draft could not be cached. Keep the editor open and retry.', retry: 'Retry', details: 'Details', unavailable: 'The local service is unavailable. Your input is retained.', failed: 'The edit could not be saved. Your input is retained.',
    changed: 'The working record or data revision changed. Review the current record before using it as the edit base.', reviewBase: 'Review current record', useBase: 'Use this working base', reload: 'Reload current record', uncertain: 'The previous save has no confirmed result. Check it before making another edit.', checkResult: 'Check save result', refreshFailed: 'The edit was saved, but the workspace could not refresh. You can review the saved increment in Changes.',
    replacePrompt: 'Replace this unfinished edit?', replaceDraft: 'Replace draft', keepDraft: 'Keep editing', discard: 'Discard draft', discardPrompt: 'Discard this unfinished edit and return to exploration? This draft has not been saved to working data.', claimMissing: 'This claim is no longer in the working record. Choose an available claim or add a claim.',
    nameRequired: 'Enter an English or Simplified Chinese name.', claimRequired: 'Choose the claim to correct.', fieldRequired: 'Choose a field.', valueRequired: 'Enter a value.', entityRequired: 'Search for an object and select a result.', invalidNumber: 'Enter a finite number with bounds containing that value.', invalidCoordinate: 'Enter longitude from −180 to 180 and latitude from −90 to 90.', invalidTime: 'Enter historical years in order. Year zero is not valid.', sourceRequired: 'Choose an existing source or enter a citation title.', httpsRequired: 'Enter an HTTPS citation URL without embedded credentials.', locatorRequired: 'Enter a source locator.', reasonRequired: 'Explain the addition or correction.', bce: '{year} BCE',
  },
  'zh-CN': {
    pendingContext:'请先恢复尚未完成的背景写入，再修改仓库资料。',resumeContext:'恢复背景操作',
    pendingImport: '请先到“资料库 → 来源 → 导入与匹配”完成尚未结束的导入，再继续当前操作。', resumeImport: '前往导入与匹配',
    add: '增补主张', correct: '纠正主张', newObject: '新对象', close: '返回探索', action: '操作', claim: '要纠正的主张', chooseClaim: '选择主张',
    working: '正在编辑当前工作资料', base: '资料版本', historicalContext: '历史上下文：{year} · {revision}', noHistoricalTime: '未固定时间', loading: '正在读取当前记录…',
    nameEn: '英文名称', nameZh: '简体中文名称', type: '类型', noType: '未选择类型', field: '字段', chooseField: '选择字段', currentValue: '当前取值',
    keepValue: '保留已有取值', replaceValue: '替换取值', preserveValue: '将完整保留来源取值及其元数据。', complexValue: '结构化来源取值',
    valueKind: '取值类型', text: '文本', entity: '对象', number: '数值', boolean: '是或否', time: '日期（年份）', coordinate: '位置', unknown: '取值未知', absent: '来源声明无值',
    textValue: '取值', language: '文本语种', numericValue: '数值', unit: '单位', unitless: '无量纲', squareKilometres: '平方千米', noUnit: '未指定单位', lower: '下限', upper: '上限',
    entityQuery: '按名称查找对象', search: '查找', searching: '正在查找…', noEntities: '没有匹配的对象。', chooseEntity: '选择一条结果，作为此字段的取值。', yes: '是', no: '否', earliest: '最早年份', latest: '最晚年份（可留空）', longitude: '经度', latitude: '纬度', yearPrecision: '新日期精确到年份。负数表示公元前，历史纪年不使用公元 0 年。',
    applicability: '这条主张适用于何时？', timeMode: '日期范围', currentTime: '当前适用时间', valueChange: '取值修改', keepTime: '保留已有适用时间', noTime: '未注明适用日期', pointTime: '某一年', rangeTime: '一段年份', from: '年份／起始年份', to: '结束年份', possible: '适用时间尚不确定',
    evidence: '依据', evidenceMode: '来源选择', existingSource: '已有来源', newCitation: '新增引用', source: '来源', chooseSource: '选择来源', sourceTitle: '来源标题', sourceUrl: 'HTTPS 链接', locator: '页码、章节或记录定位', citation: '引用说明（可选）',
    reason: '增补或纠正的理由', review: '主张审阅状态', unreviewed: '保留为未审阅', reviewed: '作为已审阅依据使用', save: '保存为工作资料', saving: '正在保存…', saved: '已保存为工作资料', changes: '审阅待提交内容', savedDetail: '到待提交区域审阅本次变化，再记录提交。',
    recovered: '已恢复未完成的编辑', draftFailed: '草稿暂时无法缓存，请保持编辑器打开并重试。', retry: '重试', details: '详情', unavailable: '本地服务暂不可用，当前输入仍保留。', failed: '编辑未能保存，当前输入仍保留。',
    changed: '工作记录或资料版本已经变化。请先查看当前记录，再将它作为编辑基底。', reviewBase: '查看当前记录', useBase: '采用这个工作基底', reload: '重新读取当前记录', uncertain: '上次保存尚未确认结果，请先检查，再进行新的修改。', checkResult: '检查保存结果', refreshFailed: '编辑已保存，但工作区暂未刷新。可到待提交区域审阅已保存的变化。',
    replacePrompt: '替换这份未完成的编辑？', replaceDraft: '替换草稿', keepDraft: '继续编辑', discard: '丢弃草稿', discardPrompt: '丢弃这份未完成的编辑并返回探索？此草稿尚未保存为资料主张。', claimMissing: '工作记录中已没有这条主张。请选择其他主张，或增补主张。',
    nameRequired: '请填写英文或简体中文名称。', claimRequired: '请选择要纠正的主张。', fieldRequired: '请选择字段。', valueRequired: '请填写取值。', entityRequired: '请按名称查找并选择对象。', invalidNumber: '请填写有限数值，且上下限须包含该值。', invalidCoordinate: '经度须在 −180 至 180 之间，纬度须在 −90 至 90 之间。', invalidTime: '请按先后填写历史年份，年份不能为零。', sourceRequired: '请选择已有来源，或填写新增引用的标题。', httpsRequired: '请填写不含账号信息的 HTTPS 引用链接。', locatorRequired: '请填写来源定位。', reasonRequired: '请说明增补或纠正的理由。', bce: '公元前 {year} 年',
  },
} as const;
export type ObjectEditorCopyKey = keyof typeof messages.en;
type Params = { historicalContext: { year: string; revision: string }; bce: { year: number } };
export function objectEditorCopy<K extends ObjectEditorCopyKey>(locale: HistoryLocale, key: K, ...args: K extends keyof Params ? [Params[K]] : []): string {
  let text: string = messages[locale][key]; for (const [name, value] of Object.entries(args[0] ?? {})) text = text.replaceAll(`{${name}}`, typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value); return text;
}
