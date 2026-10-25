import type { HistoryLocale } from '@gitworld/domain';
const messages = {
  en: {
    datasets: 'Public datasets', title: 'Acquire a source collection', provider: 'Source', text: 'Source name contains', from: 'From year', to: 'To year', batch: 'Records per batch', acquire: 'Download and map',
    coverage: 'The download is cached locally. Filters select a batch from that source snapshot; they do not establish complete historical coverage.',
    download: '{size} MB download · {license} · {revision}', loading: 'Loading source collections…', jobs: 'Acquired batches', noJobs: 'No collection batches yet.',
    acquiring: 'Acquiring', complete: 'Mapped', interrupted: 'Interrupted', failed: 'Failed', cancelled: 'Cancelled', cancel: 'Cancel acquisition', cancelling: 'Cancelling…', retry: 'Retry batch', next: 'Acquire next batch',
    bytes: 'Downloading {completed} of {total} MB', reading: 'Mapping source records…', records: 'Source records: {records} · Objects: {objects} · Claims: {assertions}', usable: 'Dated claims: {dated} · Objects with locations: {located}',
    scope: 'Source records scanned: {scanned} · Next source position: {next}', noNext: 'End of the source scan', truncated: 'The batch limit was reached. More source records may match.',
    preview: 'Preview mapping', previewing: 'Preparing mapping preview…', sample: 'Sample objects', issues: 'Mapping issues', review: 'Claim review', unreviewed: 'Keep claims unreviewed', adopted: 'Use reviewed claims in historical states',
    issuesTotal: 'Reported: {count}', loadingIssues: 'Loading mapping details…', retryIssues: 'Retry report',
    issuesRange: 'Details {from}–{to} of {total} · page {page}/{pages}', previousIssues: 'Previous', nextIssues: 'Next', issueLocator: 'Source locator:',
    issueCountMeaning: 'Several issues can refer to the same source record. Excluded-record counts are listed separately.',
    legacyIssues: 'This older checkpoint retained {retained} details for {total} reported findings. The other {missing} have no saved detail.',
    rebuildIssues: 'Rebuild report', rebuildingIssues: 'Rebuilding mapping report…', cancelIssues: 'Cancel rebuild', rebuildNote: 'Uses the same cached snapshot and query. Adopted data and commits stay unchanged.',
    noRebuildCache: 'The matching cached snapshot is unavailable. Retained details are still readable.',
    aggregateExclusions: 'Excluded source records: {count} · source positions {from}–{to}', aggregateNoDetails: 'These records were not checked against every filter, and no per-record locators were retained.', noDetailedIssues: 'No detailed mapping issues were recorded for this batch.',
    issuesFailed: 'The mapping report could not be loaded. The batch and its retained details are kept.', issuesUnavailable: 'The report or matching cached snapshot is unavailable. The batch is kept.', issuesCancelled: 'Rebuilding was cancelled. The earlier report is kept.', issuesChanged: 'The current mapper produces different batch content. The earlier report is kept; acquire a new batch to review the new mapping.',
    reviewNote: 'Check the source, dates and exclusions before marking claims reviewed. Unreviewed claims remain searchable and can be included explicitly in a state preview.',
    adopt: 'Adopt into working data', adopting: 'Adopting…', adoptedResult: 'Changed objects: {changed} · Unchanged: {unchanged} · Conflicts: {conflicts}', empty: 'No records matched this batch. Change the filters or source position.',
    invalid: 'Enter a batch size from 1 to 10,000. A date filter needs both years in order; historical year zero is not valid.',
    network: 'The source could not be reached. Your existing local data is available; retry this batch when the connection returns.',
    rate: 'The source is limiting requests. The download checkpoint is retained; retry later.',
    changed: 'The working data changed after this preview. Preview the batch again before adopting it.',
    conflict: 'An earlier source conflict needs review before this batch can be adopted. The downloaded batch is retained.',
    error: 'This batch could not be completed. Its saved source data and download checkpoint are retained.', details: 'Details', refresh: 'Refresh batches', sourceRevision: 'Source snapshot', originalLanguage: 'Source labels use their original language.',
  },
  'zh-CN': {
    datasets: '公开数据集', title: '获取来源数据集', provider: '来源', text: '来源名称包含', from: '起始年份', to: '结束年份', batch: '每批记录数', acquire: '下载并映射',
    coverage: '下载内容会缓存在本地。筛选条件从这份来源快照中选取一批记录，不代表已覆盖该范围的全部历史。',
    download: '下载 {size} MB · {license} · {revision}', loading: '正在读取来源数据集…', jobs: '已获取的批次', noJobs: '还没有获取数据集批次。',
    acquiring: '获取中', complete: '已映射', interrupted: '已中断', failed: '失败', cancelled: '已取消', cancel: '取消获取', cancelling: '正在取消…', retry: '重试本批', next: '获取下一批',
    bytes: '已下载 {completed}/{total} MB', reading: '正在映射来源记录…', records: '{records} 条来源记录 · {objects} 个对象 · {assertions} 条主张', usable: '{dated} 条有日期的主张 · {located} 个有位置的对象',
    scope: '已扫描来源记录：{scanned} · 下一来源位置：{next}', noNext: '已扫描到来源末尾', truncated: '已达到本批数量限制，后面可能还有符合条件的来源记录。',
    preview: '预览映射', previewing: '正在准备映射预览…', sample: '对象样本', issues: '映射问题', review: '主张审阅状态', unreviewed: '保留为未审阅', adopted: '将已审阅主张用于历史状态',
    issuesTotal: '报告总数：{count}', loadingIssues: '正在读取映射明细…', retryIssues: '重试读取',
    issuesRange: '明细 {from}–{to}/{total} · 第 {page}/{pages} 页', previousIssues: '上一页', nextIssues: '下一页', issueLocator: '来源定位：',
    issueCountMeaning: '一条来源记录可能对应多个问题，排除的记录数另列。',
    legacyIssues: '旧批次曾报告 {total} 项问题，仅保留 {retained} 项明细；其余 {missing} 项没有已保存的逐条记录。',
    rebuildIssues: '重建报告', rebuildingIssues: '正在重建映射报告…', cancelIssues: '取消重建', rebuildNote: '使用同一份缓存快照和筛选条件，不改变已采用资料或提交。',
    noRebuildCache: '同一份来源缓存暂不可用，仍可查看已保留的明细。',
    aggregateExclusions: '排除的来源记录：{count} 条 · 来源位置 {from}–{to}', aggregateNoDetails: '不能据此判断这些记录是否符合筛选条件，也没有保留逐条来源定位。', noDetailedIssues: '本批没有已记录的具体映射问题。',
    issuesFailed: '映射报告暂未读取，批次和已有明细仍保留。', issuesUnavailable: '报告或对应的来源缓存暂不可用，批次仍保留。', issuesCancelled: '重建已取消，原报告仍保留。', issuesChanged: '当前映射器生成的批次内容已有变化，原报告仍保留。请重新获取一批资料，再审阅新的映射结果。',
    reviewNote: '标记为已审阅前，请检查来源、日期和未纳入的内容。未审阅主张仍可检索，也可在状态预览中明确选择纳入。',
    adopt: '采用为工作资料', adopting: '正在采用…', adoptedResult: '{changed} 个对象已变更 · {unchanged} 个未变 · {conflicts} 个冲突', empty: '本批没有符合条件的记录，请调整筛选条件或来源位置。',
    invalid: '每批数量须为 1 至 10,000。日期筛选须同时填写起止年份并按先后排列；历史纪年没有公元 0 年。',
    network: '暂时无法连接来源。已有本地资料仍可使用，网络恢复后可重试本批。',
    rate: '来源暂时限制了请求。下载进度已保留，请稍后重试。',
    changed: '预览后工作资料发生了变化，请重新预览本批，再采用结果。',
    conflict: '本批涉及的对象已有来源冲突，须先处理。下载的批次仍然保留。',
    error: '本批未能完成，已保存的来源资料与下载进度仍然保留。', details: '详情', refresh: '刷新批次', sourceRevision: '来源快照', originalLanguage: '来源标签保留原文语种。',
  },
} as const;
export type CollectionCopyKey = keyof typeof messages.en;
type Params = { download: { size: string; license: string; revision: string }; bytes: { completed: string; total: string }; records: { records: number; objects: number; assertions: number }; usable: { dated: number; located: number }; scope: { scanned: number; next: number | string }; adoptedResult: { changed: number; unchanged: number; conflicts: number }; issuesTotal: { count: number }; issuesRange: { from: number; to: number; total: number; page: number; pages: number }; legacyIssues: { retained: number; total: number; missing: number }; aggregateExclusions: { count: number; from: number; to: number } };
export function collectionCopy<K extends CollectionCopyKey>(locale: HistoryLocale, key: K, ...args: K extends keyof Params ? [Params[K]] : []): string {
  let value: string = messages[locale][key];
  for (const [key, part] of Object.entries(args[0] ?? {})) value = value.replaceAll(`{${key}}`, typeof part === 'number' ? new Intl.NumberFormat(locale).format(part) : String(part));
  return value;
}

const issueMessages: Record<string, { en: string; 'zh-CN': string }> = {
  PROVISIONAL_IDENTITY: { en: 'The source grouping is provisional; a matching name does not establish historical identity.', 'zh-CN': '对象按来源暂定归组；名称相同不能证明历史身份相同。' },
  SHARED_EXTERNAL_REFERENCE: { en: 'The source reuses an external ID. These objects have not been merged.', 'zh-CN': '来源重复使用了外部标识；这些对象没有被自动合并。' },
  OVERLAPPING_SOURCE_FRAMES: { en: 'Source observation ranges overlap. Competing values are retained.', 'zh-CN': '来源的观测范围重叠；不同值都会保留。' },
  INVALID_GEOMETRY: { en: 'This record has no usable geometry. Other supported claims are retained.', 'zh-CN': '这条记录没有可用的地理形状；其他有据的信息仍保留。' },
  INVALID_TIME: { en: 'The date range could not be mapped. It has not become a dated state.', 'zh-CN': '这条日期范围无法映射，没有被当作带日期的状态。' },
  INVALID_FEATURE: { en: 'The source row could not be mapped to an object.', 'zh-CN': '这条来源记录无法映射为对象。' },
  EXACT_DUPLICATE: { en: 'An identical source frame was skipped.', 'zh-CN': '已跳过完全相同的来源观测。' },
  INVALID_SOURCE: { en: 'This source record could not be mapped to an object.', 'zh-CN': '这条来源记录无法映射为对象。' },
  INVALID_STATEMENT: { en: 'This statement could not be mapped. Other supported claims are retained.', 'zh-CN': '这条陈述无法映射，其他有据的主张仍保留。' },
  UNMAPPED_TIME: { en: 'The source date could not be mapped to a supported historical time.', 'zh-CN': '这条来源日期无法映射为支持的历史时间。' },
  UNMAPPED_COORDINATE: { en: 'This coordinate could not be mapped to a usable location. Other supported claims are retained.', 'zh-CN': '这组坐标无法映射为可用位置，其他有据的信息仍保留。' },
  UNSUPPORTED_PROVIDER: { en: 'This source record has no supported mapping.', 'zh-CN': '这条来源记录没有可用的映射规则。' },
};
export const collectionIssueText = (locale: HistoryLocale, code: string) => issueMessages[code]?.[locale] ?? code;
