import type { HistoryLocale } from '@gitworld/domain';
import type { KnowledgeTime } from '../../../../packages/domain/src/knowledge.ts';
import { historicalDateCopy as copy, historicalEnglishMonths } from './historical-date-copy.ts';

/** Formats recorded scalar components without converting calendars, dates or applicability. */
export function formatHistoricalDate(value: KnowledgeTime, locale: HistoryLocale): string {
  const number = (input: number) => new Intl.NumberFormat(locale, { useGrouping: false }).format(input);
  const endpoint = (input: number) => {
    const year = input < 0 ? copy(locale, 'bce', { year: number(-input) }) : number(input);
    if (!['month', 'day'].includes(value.precision) || value.month === undefined || !Number.isInteger(value.month) || value.month < 1 || value.month > 12) return year;
    const month = locale === 'en' ? historicalEnglishMonths[value.month - 1] : number(value.month);
    return value.precision === 'day' && value.day !== undefined
      ? copy(locale, 'day', { year, month, day: number(value.day) })
      : copy(locale, 'month', { year, month });
  };
  return value.earliestYear === value.latestYear ? endpoint(value.earliestYear) : copy(locale, 'range', { from: endpoint(value.earliestYear), to: endpoint(value.latestYear) });
}

export function historicalDateRawTexts(values: readonly (KnowledgeTime | undefined)[]): string[] {
  return [...new Set(values.flatMap(value => value?.raw ? [value.raw] : []))];
}
