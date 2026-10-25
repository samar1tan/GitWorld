import type { HistoryLocale } from '@gitworld/domain';

const messages = {
  en: { settings: 'Settings', notices: 'Licenses and notices', noticesFailed: 'The bundled notices could not be opened. Try again from Settings.', close: 'Close', unavailable: 'Unavailable', author: 'Author for new commits', editAuthor: 'Edit author', pendingAuthor: 'A pending retry keeps the author recorded when it was prepared.' },
  'zh-CN': { settings: '设置', notices: '许可与声明', noticesFailed: '未能打开随附的许可声明。请从“设置”重试。', close: '关闭', unavailable: '无法读取', author: '新提交的署名', editAuthor: '修改署名', pendingAuthor: '重试已有提交时，沿用该提交准备时记录的署名。' },
} as const;
export const settingsShellCopy = (locale: HistoryLocale, key: keyof typeof messages.en) => messages[locale][key];

export async function loadApplicationInfo() {
  const response = await fetch('./app-info.json');
  if (!response.ok) throw new Error('APPLICATION_INFO_UNAVAILABLE');
  const value = await response.json();
  if (typeof value.version !== 'string' || typeof value.buildId !== 'string') throw new Error('APPLICATION_INFO_UNAVAILABLE');
  return { version: value.version, buildId: value.buildId };
}
export async function showBundledNotices(locale: HistoryLocale) {
  const response = await fetch('./notices.txt');
  if (!response.ok) throw new Error(settingsShellCopy(locale, 'noticesFailed'));
  const content = await response.text();
  const dialog = document.createElement('dialog'); dialog.className = 'bundled-notices';
  const heading = document.createElement('h2'); heading.textContent = settingsShellCopy(locale, 'notices');
  const body = document.createElement('pre'); body.textContent = content;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = settingsShellCopy(locale, 'close'); close.onclick = () => dialog.close();
  dialog.setAttribute('aria-label', heading.textContent); dialog.append(heading, body, close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal(); close.focus();
}
