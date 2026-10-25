import type { HistoryLocale } from '@gitworld/domain';
import type { KnowledgeObjectDetail, KnowledgeSourceHeader } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';
import { knowledgeLocalizedText, knowledgeSourceProviderLabel } from './knowledge-labels.ts';

export type KnowledgeSourceGroup = { key: string; documentUrl: string; repositoryRevision: string; sources: KnowledgeSourceHeader[] };

export function knowledgeSourceTitle(source: KnowledgeSourceHeader, locale: HistoryLocale): string {
  const title = knowledgeLocalizedText(source.title, locale).text.trim();
  return title || knowledgeSourceProviderLabel(source.identity.provider, locale);
}

/** Folding source headers never changes their identities, hashes, or evidence references. */
export function groupKnowledgeSources(sources: readonly KnowledgeSourceHeader[], repositoryRevision: string): KnowledgeSourceGroup[] {
  const groups = new Map<string, KnowledgeSourceGroup>();
  sources.forEach((source, index) => {
    let documentUrl = '';
    try { if (new URL(source.url).protocol === 'https:') documentUrl = source.url; } catch { /* An absent document cannot establish a shared source. */ }
    const titles = Object.entries(source.title ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify(documentUrl ? [repositoryRevision, documentUrl, source.identity.provider, source.revision, titles] : [repositoryRevision, 'individual', index, source.id]);
    const group = groups.get(key) ?? { key, documentUrl, repositoryRevision, sources: [] };
    group.sources.push(source); groups.set(key, group);
  });
  return [...groups.values()];
}

/** Distinct locator labels remain attached to each original source, within this exact object revision. */
export function knowledgeSourceLocators(context: Pick<KnowledgeObjectDetail, 'assertions'>): Map<string, string[]> {
  const locations = new Map<string, Set<string>>();
  for (const assertion of context.assertions) for (const evidence of assertion.evidence) {
    const values = locations.get(evidence.sourceId) ?? new Set<string>(); values.add(evidence.locator); locations.set(evidence.sourceId, values);
  }
  return new Map([...locations].map(([id, values]) => [id, [...values]]));
}
