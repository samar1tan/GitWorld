import type { HistoricalDate, HistoryLocale, HistoryText } from './history-types.ts';

export const isHistoricalYear = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0 && Math.abs(value) <= 1_000_000;
export function yearDate(year: number): HistoricalDate {
  if (!isHistoricalYear(year)) throw new RangeError('INVALID_HISTORICAL_YEAR');
  return { earliestYear: year, latestYear: year, precision: 'year', calendar: 'proleptic-gregorian' };
}
export function isHistoricalDate(value: unknown): value is HistoricalDate {
  if (!value || typeof value !== 'object') return false;
  const d = value as HistoricalDate;
  return isHistoricalYear(d.earliestYear) && isHistoricalYear(d.latestYear) && d.earliestYear <= d.latestYear
    && d.calendar === 'proleptic-gregorian' && ['year', 'approximate', 'interval'].includes(d.precision)
    && (d.precision !== 'year' || d.earliestYear === d.latestYear);
}
export function parseYear(input: string): number | null {
  const match = /^(?:(BCE):)?([1-9]\d{0,6})$/.exec(input);
  if (!match) return null;
  const year = Number(match[2]) * (match[1] ? -1 : 1);
  return isHistoricalYear(year) ? year : null;
}
export const yearRef = (year: number): string => year < 0 ? `BCE:${-year}` : String(year);
/** Consecutive civil years cross directly from 1 BCE to 1 CE. */
export const nextYear = (year: number): number => year === -1 ? 1 : year + 1;
export function localizedText(value: HistoryText, locale: HistoryLocale): { text: string; language: HistoryLocale; fallback: boolean } {
  const translated = value[locale];
  return translated ? { text: translated, language: locale, fallback: false } : { text: value.en, language: 'en', fallback: locale !== 'en' };
}
