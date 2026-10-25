import { createHash } from 'node:crypto';
import type { JsonValue, SourceRecordSnapshot, SourceResult } from './source-types.ts';
import { canonicalSourceJson } from './wikidata.ts';

export const WIKIPEDIA_LABEL_ADAPTER = 'wikipedia-source-labels-v1';
export type WikipediaLanguageLink = { requestedTitle: string; title: string; pageId?: number; revision?: number; chineseTitle?: string; status: 'found' | 'missing-page' | 'missing-language-link' };
export type WikipediaVariantTitle = { requestedTitle: string; title: string; pageId?: number; revision?: number; simplifiedTitle?: string; status: 'found' | 'missing-page' | 'missing-variant' };
export type WikipediaLabelBatch<T> = { records: T[]; snapshot: SourceRecordSnapshot; continuation: Record<string, JsonValue> | null };
type Options = { titles: string[]; signal?: AbortSignal };
type Dependencies = { fetch?: typeof fetch; now?: () => Date };
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const validTitles = (titles: string[]) => Array.isArray(titles) && titles.length > 0 && titles.length <= 20 && new Set(titles).size === titles.length && titles.every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[|\u0000-\u001f]/.test(value) && !/^(?:File|Category|Special|Template|Help|Wikipedia|Talk|文件|分类|模板|帮助|维基百科|特殊|讨论):/i.test(value));

async function acquire(language: 'en' | 'zh' | 'ja', options: Options, params: Record<string, string>, dependencies: Dependencies): Promise<SourceResult<SourceRecordSnapshot>> {
  if (!validTitles(options.titles)) return { ok: false, error: { code: 'INVALID_REQUEST', retryable: false } };
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  for (const [key, value] of Object.entries({ action: 'query', titles: options.titles.join('|'), format: 'json', formatversion: '2', redirects: '1', maxlag: '5', ...params })) url.searchParams.set(key, value);
  if (String(url).length > 7000) return { ok: false, error: { code: 'INVALID_REQUEST', retryable: false } };
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    if (options.signal?.aborted) return { ok: false, error: { code: 'CANCELLED', retryable: true } };
    const response = await (dependencies.fetch ?? fetch)(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20000), ...(options.signal ? [options.signal] : [])]), headers: { Accept: 'application/json', 'User-Agent': 'GitWorld/0.1 source-ingestion (https://github.com/samar1tan/GitWorld)' } });
    const retry = response.headers.get('retry-after'), retryDate = retry ? Date.parse(retry) : NaN;
    const retryAfterMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - (dependencies.now?.() ?? new Date()).getTime()) : undefined;
    if (!response.ok) { await response.body?.cancel(); return { ok: false, error: { code: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', retryable: [429, 502, 503, 504].includes(response.status), status: response.status, requestUrl: String(url), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) } }; }
    if (!response.body || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) { await response.body?.cancel(); return { ok: false, error: { code: 'RESPONSE_TOO_LARGE', retryable: false } }; }
    reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 2 * 1024 * 1024) return { ok: false, error: { code: 'RESPONSE_TOO_LARGE', retryable: false } }; chunks.push(next.value); }
    let raw: unknown; try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } }; }
    if (!object(raw)) return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } };
    if (object(raw.error)) { const providerCode = String(raw.error.code); return { ok: false, error: { code: providerCode === 'maxlag' ? 'UPSTREAM_BUSY' : providerCode === 'ratelimited' ? 'RATE_LIMITED' : 'API_ERROR', retryable: ['maxlag', 'ratelimited', 'readonly'].includes(providerCode), providerCode, requestUrl: String(url), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) } }; }
    if (!object(raw.query) || !Array.isArray(raw.query.pages) || raw.query.pages.some(value => !object(value) || typeof value.title !== 'string')) return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } };
    return { ok: true, value: { identity: { provider: `wikipedia-${language}-label-query`, externalId: digest(options.titles.join('\n')) }, sourceRevision: null, retrievedAt: (dependencies.now?.() ?? new Date()).toISOString(), url: String(url), contentHash: digest(canonicalSourceJson(raw)), mediaType: 'application/json', raw, rights: { licenseId: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: `Selected page metadata and names from ${{ en: 'English', zh: 'Chinese', ja: 'Japanese' }[language]} Wikipedia contributors. Individual page revision and author-history links must accompany reused labels; no article prose or images are acquired.`, redistribution: 'allowed' }, adapterVersion: WIKIPEDIA_LABEL_ADAPTER } };
  } catch { return { ok: false, error: { code: options.signal?.aborted ? 'CANCELLED' : 'NETWORK_FAILED', retryable: true, requestUrl: String(url) } }; }
  finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
}

function resolvePage(raw: JsonValue, requestedTitle: string): Record<string, JsonValue> | undefined {
  if (!object(raw) || !object(raw.query) || !Array.isArray(raw.query.pages)) return undefined;
  const query = raw.query, pages = raw.query.pages, redirects = new Map<string, string>();
  for (const kind of ['normalized', 'converted', 'redirects']) if (Array.isArray(query[kind])) for (const item of query[kind]) if (object(item) && typeof item.from === 'string' && typeof item.to === 'string') redirects.set(item.from, item.to);
  let title = requestedTitle.replaceAll('_', ' '); const seen = new Set<string>();
  while (redirects.has(title)) { if (seen.has(title) || seen.size > 40) return undefined; seen.add(title); title = redirects.get(title)!; }
  return pages.find((value): value is Record<string, JsonValue> => object(value) && value.title === title);
}
const continuation = (raw: JsonValue) => object(raw) && object(raw.continue) ? raw.continue : null;

/** A language link is an explicit source association; caller-side batches stop on upstream backpressure. */
export async function fetchWikipediaLanguageLinks(options: Options & { language?: 'en' | 'ja' }, dependencies: Dependencies = {}): Promise<SourceResult<WikipediaLabelBatch<WikipediaLanguageLink>>> {
  if (options.language !== undefined && !['en', 'ja'].includes(options.language)) return { ok: false, error: { code: 'INVALID_REQUEST', retryable: false } };
  const result = await acquire(options.language ?? 'en', options, { prop: 'langlinks|info', lllang: 'zh', lllimit: 'max' }, dependencies); if (!result.ok) return result;
  const records: WikipediaLanguageLink[] = [];
  for (const requestedTitle of options.titles) {
    const page = resolvePage(result.value.raw, requestedTitle);
    if (!page || page.missing !== undefined || !Number.isSafeInteger(page.pageid) || !Number.isSafeInteger(page.lastrevid)) { records.push({ requestedTitle, title: typeof page?.title === 'string' ? page.title : requestedTitle, status: 'missing-page' }); continue; }
    const links = Array.isArray(page.langlinks) ? page.langlinks.filter(value => object(value) && value.lang === 'zh' && typeof value.title === 'string') : [];
    if (links.length > 1) return { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } };
    records.push({ requestedTitle, title: String(page.title), pageId: Number(page.pageid), revision: Number(page.lastrevid), ...(links.length ? { chineseTitle: String((links[0] as Record<string, JsonValue>).title) } : {}), status: links.length ? 'found' : 'missing-language-link' });
  }
  return { ok: true, value: { records, snapshot: result.value, continuation: continuation(result.value.raw) } };
}

/** Uses the provider's explicit mainland Simplified Chinese title, never a relabeled traditional string. */
export async function fetchWikipediaVariantTitles(options: Options, dependencies: Dependencies = {}): Promise<SourceResult<WikipediaLabelBatch<WikipediaVariantTitle>>> {
  const result = await acquire('zh', options, { prop: 'info', inprop: 'varianttitles', converttitles: '1', variant: 'zh-cn', uselang: 'zh-cn' }, dependencies); if (!result.ok) return result;
  const records: WikipediaVariantTitle[] = [];
  for (const requestedTitle of options.titles) {
    const page = resolvePage(result.value.raw, requestedTitle);
    if (!page || page.missing !== undefined || !Number.isSafeInteger(page.pageid) || !Number.isSafeInteger(page.lastrevid)) { records.push({ requestedTitle, title: typeof page?.title === 'string' ? page.title : requestedTitle, status: 'missing-page' }); continue; }
    const simplified = object(page.varianttitles) ? page.varianttitles['zh-cn'] : undefined;
    records.push({ requestedTitle, title: String(page.title), pageId: Number(page.pageid), revision: Number(page.lastrevid), ...(typeof simplified === 'string' && simplified.trim() ? { simplifiedTitle: simplified } : {}), status: typeof simplified === 'string' && simplified.trim() ? 'found' : 'missing-variant' });
  }
  return { ok: true, value: { records, snapshot: result.value, continuation: continuation(result.value.raw) } };
}
