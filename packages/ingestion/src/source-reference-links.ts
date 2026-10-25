import { createHash } from 'node:crypto';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeJson, type KnowledgeObject, type KnowledgeSource } from '../../domain/src/knowledge.ts';

export const SOURCE_REFERENCE_VERSION = 'published-source-reference-links-v1';
export const SOURCE_REFERENCE_TYPE = 'gitworld:source-identity-reference';
export const SOURCE_REFERENCE_PROPERTY = 'reference:person';
type Labels = { en: string; 'zh-CN': string };
export type WikipediaRedirectSnapshot = {
  provider: 'wikipedia-en'; pageId: string; title: string; revision: string; retrievedAt: string;
  contentHash: string; wikitext: string; destination: { pageId: string; title: string; revision: string };
};
export type SourceReferenceDecision = {
  id: string; sourceObjectId: string; originalAssertionId: string; originalAssertionHash: string;
  source: { id: string; revision: string; contentHash: string };
  redirect: { pageId: string; title: string; revision: string; contentHash: string; destinationPageId: string; destinationTitle: string; destinationRevision: string };
  target: { objectId: string; sha256: string; type: string };
  labels: Labels; descriptions: Labels;
};
export type SourceReferencePlan = {
  schemaVersion: 1; id: string; revision: string; preparedAt: string; url: string;
  rights: KnowledgeSource['rights']; sourceLabels: Labels; decisions: SourceReferenceDecision[];
};
const hashText = (text: string) => createHash('sha256').update(text).digest('hex');
export const sourceReferenceHash = (value: unknown) => hashText(canonicalJson(value));
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const decimal = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const labels = (value: Labels) => value && nonempty(value.en) && nonempty(value['zh-CN']);
const identity = (title: string) => `wikipedia-en:${title.replaceAll(' ', '_')}`;
const revisionUrl = (title: string, revision: string) => `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&oldid=${revision}`;

/** Accept only a complete direct article redirect; sections and ambiguous instructions are not person identity evidence. */
export function publishedRedirectTarget(wikitext: string): string | null {
  if (typeof wikitext !== 'string' || Buffer.byteLength(wikitext) > 8192) return null;
  const found = /^\s*#redirect\s*\[\[([^\[\]#|:]+)\]\]/i.exec(wikitext);
  if (!found || [...wikitext.matchAll(/#redirect\b/gi)].length !== 1) return null;
  return found[1].trim().replaceAll('_', ' ');
}

/** A finite explicit plan repairs navigation only; neither source claims nor historical time are rewritten. */
export function projectSourceReferenceLinks(input: KnowledgeCollection, snapshots: WikipediaRedirectSnapshot[], plan: SourceReferencePlan) {
  createKnowledgeIndex(input);
  if (!plan || plan.schemaVersion !== 1 || ![plan.id, plan.revision, plan.url].every(nonempty) || !Number.isFinite(Date.parse(plan.preparedAt)) || !labels(plan.sourceLabels) || !plan.rights || plan.rights.redistribution !== 'allowed' || plan.rights.licenseId !== 'CC-BY-SA-4.0' || !Array.isArray(plan.decisions) || !plan.decisions.length || plan.decisions.length > 100 || new Set(plan.decisions.map(value => value.id)).size !== plan.decisions.length || new Set(plan.decisions.map(value => value.sourceObjectId)).size !== plan.decisions.length) throw new Error('INVALID_SOURCE_REFERENCE_PLAN');
  if (!Array.isArray(snapshots) || snapshots.length !== plan.decisions.length || new Set(snapshots.map(value => value.pageId)).size !== snapshots.length) throw new Error('SOURCE_REFERENCE_SNAPSHOT_MISMATCH');
  const objects = new Map(input.objects.map(value => [value.id, value])), assertions = new Map(input.assertions.map(value => [value.id, value]));
  const prepared = plan.decisions.map((decision, index) => {
    if (![decision.id, decision.sourceObjectId, decision.originalAssertionId].every(nonempty) || !sha(decision.originalAssertionHash) || !decision.source || ![decision.source.id, decision.source.revision].every(nonempty) || !sha(decision.source.contentHash) || !decision.redirect || ![decision.redirect.pageId, decision.redirect.revision, decision.redirect.destinationPageId, decision.redirect.destinationRevision].every(decimal) || ![decision.redirect.title, decision.redirect.destinationTitle].every(nonempty) || !sha(decision.redirect.contentHash) || !decision.target || !nonempty(decision.target.objectId) || !nonempty(decision.target.type) || !sha(decision.target.sha256) || !labels(decision.labels) || !labels(decision.descriptions)) throw new Error('INVALID_SOURCE_REFERENCE_PLAN');
    const original = assertions.get(decision.originalAssertionId), source = input.sources.find(value => value.id === decision.source.id);
    if (!original || sourceReferenceHash(original) !== decision.originalAssertionHash || original.review === 'rejected' || original.value.kind !== 'entity' || original.value.objectId !== decision.sourceObjectId || original.sourceSnapshotId !== decision.source.id || !original.evidence.some(value => value.sourceId === decision.source.id)) throw new Error('SOURCE_REFERENCE_CLAIM_MISMATCH');
    if (!source || source.revision !== decision.source.revision || source.contentHash !== decision.source.contentHash || source.record && sourceReferenceHash(source.record) !== source.contentHash) throw new Error('SOURCE_REFERENCE_SOURCE_MISMATCH');
    if (source.rights.redistribution !== 'allowed' || source.rights.licenseId !== 'CC-BY-SA-4.0') throw new Error('SOURCE_REFERENCE_RIGHTS_REVIEW_REQUIRED');
    const target = objects.get(decision.target.objectId);
    if (!target || sourceReferenceHash(target) !== decision.target.sha256 || !target.types.includes(decision.target.type) || target.types.includes(SOURCE_REFERENCE_TYPE) || !labels(target.labels as Labels) || target.id === decision.sourceObjectId) throw new Error('SOURCE_REFERENCE_TARGET_MISMATCH');
    const redirect = snapshots.find(value => value.pageId === decision.redirect.pageId);
    if (!redirect || redirect.provider !== 'wikipedia-en' || redirect.title !== decision.redirect.title || redirect.revision !== decision.redirect.revision || redirect.contentHash !== decision.redirect.contentHash || hashText(redirect.wikitext) !== redirect.contentHash || !Number.isFinite(Date.parse(redirect.retrievedAt)) || redirect.destination.pageId !== decision.redirect.destinationPageId || redirect.destination.title !== decision.redirect.destinationTitle || redirect.destination.revision !== decision.redirect.destinationRevision || publishedRedirectTarget(redirect.wikitext) !== decision.redirect.destinationTitle.replaceAll('_', ' ') || identity(redirect.title) !== decision.sourceObjectId || identity(redirect.destination.title) !== target.id) throw new Error('SOURCE_REFERENCE_SNAPSHOT_MISMATCH');
    const object: KnowledgeObject = { id: decision.sourceObjectId, identities: [{ provider: 'wikipedia-en-source-link', externalId: redirect.title }], labels: structuredClone(decision.labels), descriptions: structuredClone(decision.descriptions), aliases: [], types: [SOURCE_REFERENCE_TYPE] };
    const fact = { decisionId: decision.id, originalAssertionId: original.id, originalAssertionHash: decision.originalAssertionHash, originalSource: decision.source, sourceObjectId: object.id, originalEvidence: original.evidence, redirect: { pageId: redirect.pageId, title: redirect.title, revision: redirect.revision, contentHash: redirect.contentHash, target: redirect.destination, retrievedAt: redirect.retrievedAt, permanentRevisionUrl: revisionUrl(redirect.title, redirect.revision), historyUrl: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(redirect.title)}&action=history` }, targetObjectId: target.id, targetObjectHash: decision.target.sha256 };
    return { object, original, fact, index, decision };
  });
  const record = { schemaVersion: 1, id: plan.id, revision: plan.revision, mappingVersion: SOURCE_REFERENCE_VERSION, manifest: { articleTitle: 'Published Wikipedia redirect identity references', changes: ['Selected fixed-revision redirect identities and original table-claim locators; excluded article prose, images, full HTML and operational API responses.', 'Added typed source-identity references and explicit person links. Original objects, assertions, sources and historical review states are unchanged.', 'Identity resolution is modern navigation metadata; no historical time, biography, office, mission completion, ancestry or influence is inferred.'] }, plan, facts: prepared.map(value => value.fact) };
  const contentHash = sourceReferenceHash(record), source: KnowledgeSource = { id: `gitworld-source-references:${plan.id}@${contentHash}`, identity: { provider: 'gitworld-source-references', externalId: plan.id }, revision: plan.revision, contentHash, retrievedAt: plan.preparedAt, url: plan.url, adapterVersion: SOURCE_REFERENCE_VERSION, rights: structuredClone(plan.rights), record: structuredClone(record) as unknown as KnowledgeJson };
  const links: KnowledgeAssertion[] = prepared.map(({ object, original, index, decision }) => ({ id: `source-reference:${sourceReferenceHash([plan.id, decision.id]).slice(0, 40)}`, subjectId: object.id, propertyId: SOURCE_REFERENCE_PROPERTY, value: { kind: 'entity', objectId: decision.target.objectId }, qualifiers: [{ propertyId: 'reference:source-spelling', value: { kind: 'text', value: decision.redirect.title, language: 'en' } }], evidence: [...structuredClone(original.evidence), { sourceId: source.id, locator: `$.facts[${index}].redirect`, url: revisionUrl(decision.redirect.title, decision.redirect.revision) }], sourceSnapshotId: source.id, review: 'unreviewed' }));
  const collection = structuredClone(input);
  for (const object of prepared.map(value => value.object)) { const previous = objects.get(object.id); if (previous && sourceReferenceHash(previous) !== sourceReferenceHash(object)) throw new Error('SOURCE_REFERENCE_OBJECT_CONFLICT'); if (!previous) collection.objects.push(object); }
  for (const link of links) { const previous = assertions.get(link.id); if (previous && sourceReferenceHash(previous) !== sourceReferenceHash(link)) throw new Error('SOURCE_REFERENCE_ASSERTION_CONFLICT'); if (!previous) collection.assertions.push(link); }
  const previous = input.sources.find(value => value.id === source.id);
  if (previous && sourceReferenceHash(previous) !== sourceReferenceHash(source)) throw new Error('SOURCE_REFERENCE_SOURCE_CONFLICT');
  if (!previous) collection.sources.push(source);
  createKnowledgeIndex(collection);
  return { collection, sourceId: source.id, mappingVersion: SOURCE_REFERENCE_VERSION, referenceObjectIds: prepared.map(value => value.object.id), assertionIds: links.map(value => value.id) };
}

/** Main-value navigation and raw provenance qualifiers have different boundaries; no missing target is auto-created. */
export function auditSourceReferenceTargets(collection: KnowledgeCollection) {
  const objects = new Map(collection.objects.map(value => [value.id, value]));
  const missingValues = collection.assertions.filter(value => value.value.kind === 'entity' && !objects.has(value.value.objectId)).map(value => ({ assertionId: value.id, objectId: value.value.kind === 'entity' ? value.value.objectId : '', propertyId: value.propertyId, sourceId: value.sourceSnapshotId }));
  const missingQualifiers = collection.assertions.flatMap(value => value.qualifiers.flatMap(qualifier => qualifier.value.kind === 'entity' && !objects.has(qualifier.value.objectId) ? [{ assertionId: value.id, objectId: qualifier.value.objectId, propertyId: qualifier.propertyId }] : []));
  const incompleteLabels = collection.objects.filter(value => !labels(value.labels as Labels)).map(value => value.id);
  const opaqueLabels = collection.objects.filter(value => ['en', 'zh-CN'].some(locale => value.labels[locale] === value.id || /^(?:wikipedia-en:|history:|gitworld:|wikipedia-office-scope:|chronology-candidate:)/.test(value.labels[locale] ?? ''))).map(value => value.id);
  return { missingValues, missingQualifiers, incompleteLabels, opaqueLabels };
}
