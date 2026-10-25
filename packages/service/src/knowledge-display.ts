import type { KnowledgeDisplayEvidence, KnowledgeDisplayText, KnowledgeFieldCatalog, KnowledgeLocalizedDisplay, KnowledgeObjectPresentation, KnowledgeSourceHeader } from '../../contracts/src/knowledge-workspace-types.ts';
import type { KnowledgeAssertion, KnowledgeCollection, KnowledgeObject, KnowledgeSource, KnowledgeText } from '../../domain/src/knowledge.ts';
import { CONTENT_LABEL_VERSION, createContentTextIndex } from '../../ingestion/src/content-labels.ts';
import type { KnowledgeVocabularyPresentation } from '../../contracts/src/knowledge-import-types.ts';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const locales = ['en', 'zh-CN'] as const;
function fallback(texts: KnowledgeText, locale: string): { text?: string; language?: string } {
  for (const language of [locale, 'en', ...Object.keys(texts)]) if (texts[language]?.trim()) return { text: texts[language], language };
  return {};
}
function validEvidence(value: unknown): value is KnowledgeDisplayEvidence['evidence'][number] {
  return record(value) && typeof value.url === 'string' && typeof value.locator === 'string';
}
const displayEvidence = (items: KnowledgeDisplayEvidence['evidence']): KnowledgeDisplayEvidence['evidence'] => items.map(item => ({ url: item.url, locator: item.locator,
  ...(typeof item.sourceSnapshotHash === 'string' ? {sourceSnapshotHash:item.sourceSnapshotHash} : {}), ...(typeof item.citation === 'string' ? {citation:item.citation} : {}) }));

/** Source bodies remain in the local repository. The inspection response contains attribution headers only. */
export function knowledgeSourceHeader(source: KnowledgeSource): KnowledgeSourceHeader {
  const body: unknown = source.record, manifest = record(body) && record(body.manifest) ? body.manifest : null;
  const header: KnowledgeSourceHeader = { id:source.id, identity:{provider:source.identity.provider,externalId:source.identity.externalId}, revision:source.revision, contentHash:source.contentHash, retrievedAt:source.retrievedAt, url:source.url,
    ...(source.revisionUrl ? {revisionUrl:source.revisionUrl} : {}), adapterVersion:source.adapterVersion,
    rights:{redistribution:source.rights.redistribution,...(source.rights.licenseId ? {licenseId:source.rights.licenseId} : {}),...(source.rights.licenseUrl ? {licenseUrl:source.rights.licenseUrl} : {}),...(source.rights.attribution ? {attribution:source.rights.attribution} : {})} };
  return { ...structuredClone(header), ...(typeof manifest?.articleTitle === 'string' ? { title: { en: manifest.articleTitle } } : {}),
    ...(typeof manifest?.historyUrl === 'string' ? { historyUrl: manifest.historyUrl } : {}),
    ...(Array.isArray(manifest?.changes) && manifest.changes.every((value: unknown) => typeof value === 'string') ? { changes: [...manifest.changes] } : {}) };
}

/** Hashing and derivation lookups stay in the service; both locales share this serializable presentation. */
export function createKnowledgeDisplayIndex(collection: KnowledgeCollection, catalog?: KnowledgeFieldCatalog,vocabulary?:KnowledgeVocabularyPresentation) {
  const objects = new Map(collection.objects.map(value => [value.id, value])), textIndex = createContentTextIndex(collection);
  const properties = new Map(catalog?.properties.map(value => [value.id, value.labels]) ?? []), types = new Map(catalog?.types.map(value => [value.id, value.labels]) ?? []);
  const labels = new Map<string, KnowledgeDisplayEvidence[]>();
  for (const source of collection.sources) {
    const body: unknown = source.record;
    if (source.adapterVersion !== CONTENT_LABEL_VERSION || !record(body) || !Array.isArray(body.labels)) continue;
    for (const item of body.labels) {
      if (!record(item) || typeof item.objectId !== 'string' || typeof item.language !== 'string' || typeof item.text !== 'string' || typeof item.method !== 'string' || !Array.isArray(item.evidence) || !item.evidence.every(validEvidence)) continue;
      const key = `${item.objectId}\0${item.language}`, entries = labels.get(key) ?? [];
      entries.push({ sourceId: source.id, objectId: item.objectId, language: item.language, text: item.text, method: item.method, evidence: displayEvidence(item.evidence) }); labels.set(key, entries);
    }
  }
  function objectDisplay(value: KnowledgeObject): KnowledgeLocalizedDisplay {
    return Object.fromEntries(locales.map(locale => {
      const selected = fallback(value.labels, locale), provenance = labels.get(`${value.id}\0${locale}`) ?? [], variants = new Set(provenance.map(item => item.text));
      const matching = provenance.filter(item => item.text === selected.text);
      const status = variants.size > 1 ? 'conflict' : !value.labels[locale] ? 'missing' : matching.length ? 'translated' : 'original';
      return [locale, { ...selected, status, provenance: structuredClone(variants.size > 1 ? provenance : matching) }];
    })) as KnowledgeLocalizedDisplay;
  }
  return {
    object(objectId: string, assertions: KnowledgeAssertion[], fingerprint: string): KnowledgeObjectPresentation {
      const ids = new Set([objectId]), propertyIds = new Set<string>(), typeIds = new Set<string>(), values: Record<string, KnowledgeLocalizedDisplay> = Object.create(null);
      for (const assertion of assertions) {
        propertyIds.add(assertion.propertyId);
        if (assertion.value.kind === 'entity') ids.add(assertion.value.objectId);
        for (const qualifier of assertion.qualifiers) { propertyIds.add(qualifier.propertyId); if (qualifier.value.kind === 'entity') ids.add(qualifier.value.objectId); }
        if (assertion.value.kind !== 'text') continue;
        const original = assertion.value;
        values[assertion.id] = Object.fromEntries(locales.map(locale => {
          const translated = textIndex.value(original, [assertion.id], locale), sourceLanguage = original.language ?? 'und';
          const provenance = translated.provenance.map(item => ({...item,evidence:displayEvidence(item.evidence)}));
          const display: KnowledgeDisplayText = translated.status === 'translated' ? { text: translated.text, language: locale, status: 'translated', provenance }
            : { text: original.value, language: sourceLanguage, status: translated.status === 'conflict' ? 'conflict' : sourceLanguage === locale ? 'original' : 'missing', provenance };
          return [locale, display];
        })) as KnowledgeLocalizedDisplay;
      }
      const selected: KnowledgeObjectPresentation['objects'] = Object.create(null), qualifierValues: KnowledgeObjectPresentation['qualifierValues'] = Object.create(null);
      for (const entry of catalog?.values ?? []) if (propertyIds.has(entry.propertyId)) (qualifierValues[entry.propertyId] ??= Object.create(null))[entry.value] = structuredClone(entry.labels);
      for (const id of ids) { const value = objects.get(id); if (!value) continue; selected[id] = { labels: structuredClone(value.labels), display: objectDisplay(value) }; for (const type of value.types) typeIds.add(type); }
      return { fingerprint, objects: selected, properties: Object.fromEntries([...propertyIds].filter(id => properties.has(id)).map(id => [id, structuredClone(properties.get(id)!)])),
        types: Object.fromEntries([...typeIds].filter(id => types.has(id)).map(id => [id, structuredClone(types.get(id)!)])), values, qualifierValues,
        notes: structuredClone((catalog?.semanticNotes ?? []).filter(note => note.ids.some(id => propertyIds.has(id)))),...(vocabulary?{vocabulary:structuredClone({fingerprint:vocabulary.fingerprint,origin:vocabulary.origin,...(vocabulary.legacyFingerprint?{legacyFingerprint:vocabulary.legacyFingerprint}:{}),properties:Object.fromEntries(Object.entries(vocabulary.properties).filter(([id])=>propertyIds.has(id))),types:Object.fromEntries(Object.entries(vocabulary.types).filter(([id])=>typeIds.has(id))),values:Object.fromEntries(Object.entries(vocabulary.values).filter(([id])=>propertyIds.has(id)))})}:{}) };
    },
    sourceHeaders(ids: Set<string>) { return collection.sources.filter(value => ids.has(value.id)).map(knowledgeSourceHeader); },
  };
}
