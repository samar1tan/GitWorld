import type { HistoryLocale } from '@gitworld/domain';

const messages = {
  en: { bce: '{year} BCE', range: '{from}–{to}', month: '{month} {year}', day: '{month} {day}, {year}' },
  'zh-CN': { bce: '公元前 {year}', range: '{from}–{to}', month: '{year}年{month}月', day: '{year}年{month}月{day}日' },
};
export const historicalEnglishMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
type Parameters = { bce: { year: string }; range: { from: string; to: string }; month: { year: string; month: string }; day: { year: string; month: string; day: string } };
export function historicalDateCopy<K extends keyof Parameters>(locale: HistoryLocale, key: K, parameters: Parameters[K]): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String((parameters as Record<string, string>)[name]));
}
