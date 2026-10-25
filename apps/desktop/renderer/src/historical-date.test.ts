import test from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeTime } from '../../../../packages/domain/src/knowledge.ts';
import { formatHistoricalDate, historicalDateRawTexts } from './historical-date.ts';

const time = (overrides: Partial<KnowledgeTime> = {}): KnowledgeTime => ({ earliestYear: 512, latestYear: 512, month: 5, day: 21, precision: 'day', calendar: 'published-source-calendar-unspecified', raw: '512-05-21', ...overrides });
test('scalar source dates distinguish same-year days and retain month/BCE/range components in both locales', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    assert.equal(formatHistoricalDate(time(), locale), locale === 'en' ? 'May 21, 512' : '512年5月21日');
    assert.notEqual(formatHistoricalDate(time(), locale), formatHistoricalDate(time({ day: 22 }), locale));
    assert.equal(formatHistoricalDate(time({ month: 2, day: undefined, precision: 'month' }), locale), locale === 'en' ? 'Feb 512' : '512年2月');
    assert.equal(formatHistoricalDate(time({ earliestYear: -44, latestYear: -44, month: 3, day: 15 }), locale), locale === 'en' ? 'Mar 15, 44 BCE' : '公元前 44年3月15日');
    assert.equal(formatHistoricalDate(time({ latestYear: 513 }), locale), locale === 'en' ? 'May 21, 512–May 21, 513' : '512年5月21日–513年5月21日');
    assert.equal(formatHistoricalDate(time({ earliestYear: -44, latestYear: -40, precision: 'interval', month: undefined, day: undefined }), locale), locale === 'en' ? '44 BCE–40 BCE' : '公元前 44–公元前 40');
  }
});
test('presentation does not convert Julian dates, infer missing components, pad years or change source records', () => {
  const source = time({ earliestYear: 1900, latestYear: 1900, month: 2, day: 29, calendar: 'Julian', raw: '29 February 1900 (Julian)' }), before = structuredClone(source);
  assert.equal(formatHistoricalDate(source, 'en'), 'Feb 29, 1900');assert.deepEqual(source, before);
  assert.equal(formatHistoricalDate(time({ earliestYear: 5, latestYear: 5 }), 'en'), 'May 21, 5');
  assert.equal(formatHistoricalDate(time({ month: undefined, day: undefined }), 'en'), '512');
  assert.equal(formatHistoricalDate(time({ month: 13 }), 'en'), '512');
  assert.equal(formatHistoricalDate(time({ calendar: 'unrecognized-source-calendar' }), 'en'), 'May 21, 512');
});
test('original date text is returned unchanged and deduplicated across a value and applicability endpoints', () => {
  const source = time({ raw: '1 January – 31 December 1900 <source>' });
  assert.deepEqual(historicalDateRawTexts([source, undefined, source, { ...source, raw: 'different original wording' }]), [source.raw, 'different original wording']);
});
