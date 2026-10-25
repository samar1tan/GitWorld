import type { HistoryLocale } from '@gitworld/domain';
import type { ClientStateKey } from '../../../../packages/contracts/src/client-state-types.ts';

const messages = {
  en: {
    saveFailed: 'Workspace preferences or recovery input could not be saved. Keep this window open and retry.',
    loadFailed: 'Local preferences could not be loaded. Retry, or restore a complete library in Settings.',
    retrySave: 'Retry saving', retryLoad: 'Retry loading', conflict: 'The saved {item} changed elsewhere.',
    conflictDetail: 'Keep this window’s version, or use the saved version and reopen the workspace. Using saved replaces the current {item}; other pending input is saved first.',
    local: 'Keep this window’s version', saved: 'Use saved and reopen', busy: 'Saving local state…',
    finishModel: 'Save the model form or return from it before reopening or transferring the library.',
    onboarding: 'guide progress', 'knowledge-view': 'object workspace', 'research-input': 'research input', locale: 'interface language', 'workspace-section': 'workspace section', 'commit-input': 'commit message', 'commit-attempt': 'pending commit', 'source-query': 'source search', 'terminal-input':'terminal input', 'object-input':'object input', 'wikipedia-input':'Wikipedia page and mapping input', 'context-input':'context input',
  },
  'zh-CN': {
    saveFailed: '工作区偏好或恢复输入暂未保存，请保持窗口打开并重试。',
    loadFailed: '本地偏好暂未读取，可重试，或到“设置”中恢复完整资料库。',
    retrySave: '重试保存', retryLoad: '重试读取', conflict: '已保存的{item}在其他位置发生了变化。',
    conflictDetail: '可以保留当前窗口的版本，或采用已保存版本并重新打开工作区。采用已保存版本会替换当前的{item}，其他待保存输入会先保存。',
    local: '保留当前窗口的版本', saved: '采用已保存版本并重新打开', busy: '正在保存本地状态…',
    finishModel: '请先保存模型表单或从中返回，再重新打开或备份、恢复资料库。',
    onboarding: '指南进度', 'knowledge-view': '对象工作区', 'research-input': '研究输入', locale: '界面语言', 'workspace-section': '工作区位置', 'commit-input': '提交理由', 'commit-attempt': '未确认的提交', 'source-query': '来源搜索', 'terminal-input':'命令行输入', 'object-input':'对象编辑输入', 'wikipedia-input':'维基百科页面与映射输入', 'context-input':'背景输入',
  },
} as const;
type Key = keyof typeof messages.en;
export const clientStateCopy = (locale: HistoryLocale, key: Key, item?: ClientStateKey): string => messages[locale][key].replaceAll('{item}', item ? messages[locale][item] : '');
