import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeJson, type KnowledgeObject, type KnowledgeSource } from '../../domain/src/knowledge.ts';
import { canonicalSourceJson } from './wikidata.ts';
import type { SourceRecordSnapshot } from './source-types.ts';

export const EVIDENCED_FIELD_VERSION = 'evidenced-published-fields-v2';
type Labels = { en: string; 'zh-CN': string };
type TableSelection = { tableClass: string; tableIndex: number };
export type PublishedFactSelector =
  | ({ kind: 'table-field'; header: string; column?: number } & TableSelection)
  | ({ kind: 'section-cell'; heading: string; rowOffset: number; column: number } & TableSelection)
  | { kind: 'element'; tag: string; id?: string; startsWith?: string; contains?: string }
  | { kind: 'page-passage'; page: number; start: string; end: string };
export type PublishedFactRule = { id: string; selector: PublishedFactSelector; textHash: string; includeText?: boolean };
export type EvidencedSourceProfile = {
  id: string; identity: SourceRecordSnapshot['identity']; revision: string | null; contentHash: string;
  citation: { title: string; language: string; creator: string; rightsEvidence: string[]; rightsNote: string };
  facts: PublishedFactRule[];
};
export type EvidencedFieldStatement = Pick<KnowledgeAssertion, 'subjectId' | 'propertyId' | 'value' | 'validTime'> & {
  id: string; factKeys: string[]; timeFactKeys?: string[]; qualifiers?: KnowledgeAssertion['qualifiers'];
  interpretation: Labels;
};
export type EvidencedFieldPlan = {
  schemaVersion: 1; id: string; revision: string; preparedAt: string; url: string;
  rights: KnowledgeSource['rights']; profiles: EvidencedSourceProfile[];
  objects: KnowledgeObject[]; statements: EvidencedFieldStatement[];
  fieldCatalog: { schemaVersion: 1; kind: 'historical-field-display-labels'; properties: { id: string; labels: Labels }[]; types: { id: string; labels: Labels }[]; values: { propertyId: string; value: string; labels: Labels }[]; semanticNotes?: { ids: string[]; en: string; 'zh-CN': string }[] };
};
export type EvidencedFieldIssue = { code: 'SOURCE_MISSING' | 'SOURCE_MISMATCH' | 'FACT_MISSING' | 'FACT_AMBIGUOUS' | 'FACT_CHANGED' | 'TEXT_RIGHTS_UNREVIEWED' | 'OBJECT_CONFLICT' | 'SOURCE_CONFLICT' | 'ASSERTION_CONFLICT'; profileId?: string; factId?: string; objectId?: string; assertionId?: string };
type AcquiredLink = { href: string; text: string; relativeLocator: string };
type RetainedLink = { href: string; locator: string; textHash: string; text?: string };
type SelectedFact = { key: string; profileId: string; factId: string; locator: string; textHash: string; text?: string; links: RetainedLink[]; referenceAnchors: string[] };
const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const textHash = (value: string) => createHash('sha256').update(value).digest('hex');
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const hashPattern = /^[a-f0-9]{64}$/;
const isElement = (node: Tree.Node): node is Tree.Element => 'tagName' in node;
const children = (node: Tree.Node): Tree.ChildNode[] => 'childNodes' in node ? node.childNodes : [];
const attribute = (node: Tree.Element, name: string) => node.attrs.find(item => item.name === name)?.value;
const classNames = (node: Tree.Element) => (attribute(node, 'class') ?? '').split(/\s+/);
const ignored = (node: Tree.Node) => isElement(node) && (['script', 'style', 'img', 'svg', 'math', 'noscript'].includes(node.tagName) || classNames(node).some(value => ['reference', 'mw-editsection', 'mw-cite-backlink'].includes(value)));
function plain(node: Tree.Node): string {
  const result: string[] = [], stack: { node: Tree.Node; close?: boolean }[] = [{ node }];
  while (stack.length) {
    const current = stack.pop()!; if (ignored(current.node)) continue;
    if (current.node.nodeName === '#text' && 'value' in current.node) { result.push(current.node.value); continue; }
    const block = isElement(current.node) && ['br', 'p', 'li', 'div'].includes(current.node.tagName);
    if (current.close) { if (block) result.push(' '); continue; }
    if (block) result.push(' '); stack.push({ node: current.node, close: true });
    stack.push(...[...children(current.node)].reverse().map(node => ({ node })));
  }
  return result.join('');
}
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
function nodes(root: Tree.Node): Tree.Element[] {
  const result: Tree.Element[] = [], stack: Tree.Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!; if (ignored(node)) continue;
    if (isElement(node)) result.push(node);
    if (result.length > 250000) throw new Error('PUBLISHED_FIELD_STRUCTURE_LIMIT');
    stack.push(...[...children(node)].reverse());
  }
  return result;
}
function links(node: Tree.Node, base: string) {
  const result: AcquiredLink[] = [];
  for (const value of nodes(node).filter(value => value.tagName === 'a')) {
    const href = attribute(value, 'href'); if (!href || href.startsWith('#')) continue;
    try { const url = new URL(href, base); if (url.protocol === 'https:') result.push({ href: url.href, text: normalize(plain(value)), relativeLocator: `a[eligible-link-index=${result.length}]` }); } catch { /* An unsupported link is not an identity. */ }
  }
  return result;
}
function references(root: Tree.Node): string[] {
  const result = new Set<string>(), stack: Tree.Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (isElement(node) && ['script', 'style', 'img', 'svg', 'math', 'noscript'].includes(node.tagName)) continue;
    if (isElement(node) && node.tagName === 'a') { const href = attribute(node, 'href'); if (href?.startsWith('#cite_note')) result.add(href); }
    stack.push(...children(node));
  }
  return [...result];
}
function select(snapshot: SourceRecordSnapshot, selector: PublishedFactSelector, documents: Map<SourceRecordSnapshot, Tree.Element[]>) {
  const raw = snapshot.raw as any;
  if (selector.kind === 'page-passage') {
    const page = Array.isArray(raw.pages) ? raw.pages.filter((value: any) => value.number === selector.page && typeof value.text === 'string') : [];
    const result: { text: string; locator: string; links: AcquiredLink[]; referenceAnchors: string[] }[] = [];
    for (const value of page) {
      const text = normalize(value.text), first = text.indexOf(selector.start), last = first < 0 ? -1 : text.indexOf(selector.end, first + selector.start.length);
      if (first < 0 || last < 0) continue;
      if (text.indexOf(selector.start, first + 1) >= 0) return [{ text: '', locator: '', links: [], referenceAnchors: [] }, { text: '', locator: '', links: [], referenceAnchors: [] }];
      result.push({ text: text.slice(first, last + selector.end.length), locator: `$.pages[number=${selector.page}];normalized-text[${first}:${last + selector.end.length}]`, links: [], referenceAnchors: [] });
    }
    return result;
  }
  const field = typeof raw.html === 'string' ? { path: '$.html', text: raw.html } : typeof raw.text === 'string' ? { path: '$.text', text: raw.text } : { path: '$.parse.text', text: raw.parse?.text };
  const html = field.text;
  if (typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error('INVALID_PUBLISHED_FIELD_SOURCE');
  let all = documents.get(snapshot); if (!all) { all = nodes(parse(html)); documents.set(snapshot, all); }
  if (selector.kind === 'element') {
    return all.filter(node => node.tagName === selector.tag && (!selector.id || attribute(node, 'id') === selector.id) && (!selector.startsWith || normalize(plain(node)).startsWith(selector.startsWith)) && (!selector.contains || normalize(plain(node)).includes(selector.contains)))
      .map(node => ({ text: normalize(plain(node)), locator: `${field.path};${node.tagName}[document-index=${all.indexOf(node)}]${selector.id ? `#${selector.id}` : ''}`, links: links(node, snapshot.url), referenceAnchors: references(node) }));
  }
  const table = all.filter(node => node.tagName === 'table' && classNames(node).includes(selector.tableClass))[selector.tableIndex];
  if (!table) return [];
  const rows = nodes(table).filter(node => node.tagName === 'tr');
  const cells = (row: Tree.Element) => children(row).filter((node): node is Tree.Element => isElement(node) && ['td', 'th'].includes(node.tagName));
  const result: { text: string; locator: string; links: AcquiredLink[]; referenceAnchors: string[] }[] = [];
  for (const [index, row] of rows.entries()) {
    const rowCells = cells(row);
    const header = selector.kind === 'table-field' ? selector.header : selector.heading;
    if (rowCells[0]?.tagName !== 'th' || normalize(plain(rowCells[0])) !== header) continue;
    const targetRow = selector.kind === 'section-cell' ? index + selector.rowOffset : index;
    const targetColumn = selector.kind === 'section-cell' ? selector.column : selector.column ?? 1;
    const cell = rows[targetRow] && cells(rows[targetRow])[targetColumn]; if (!cell) continue;
    result.push({ text: normalize(plain(cell)), locator: `${field.path};table.${selector.tableClass}[${selector.tableIndex}].tr[${targetRow}].cell[${targetColumn}]`, links: links(cell, snapshot.url), referenceAnchors: references(cell) });
  }
  return result;
}

/** Local source inspection returns acquired text, not an adopted claim or redistribution decision. */
export function inspectPublishedFields(snapshot: SourceRecordSnapshot, requests: { id: string; selector: PublishedFactSelector }[]) {
  if (!Array.isArray(requests) || !requests.length || requests.length > 500 || new Set(requests.map(value => value.id)).size !== requests.length || requests.some(value => !nonempty(value.id) || !value.selector)) throw new Error('INVALID_PUBLISHED_FIELD_INSPECTION');
  if (createHash('sha256').update(canonicalSourceJson(snapshot.raw)).digest('hex') !== snapshot.contentHash) throw new Error('SOURCE_SNAPSHOT_MISMATCH');
  const documents = new Map<SourceRecordSnapshot, Tree.Element[]>();
  return requests.map(request => ({ id: request.id, matches: select(snapshot, request.selector, documents).map(fact => ({ ...fact, textHash: textHash(fact.text) })) }));
}

function validate(plan: EvidencedFieldPlan) {
  const display = (value: Labels) => value && nonempty(value.en) && nonempty(value['zh-CN']);
  if (!plan || plan.schemaVersion !== 1 || ![plan.id, plan.revision, plan.preparedAt, plan.url].every(nonempty) || !Number.isFinite(Date.parse(plan.preparedAt)) || !plan.rights || !['allowed', 'restricted', 'unknown'].includes(plan.rights.redistribution)
    || !Array.isArray(plan.profiles) || !plan.profiles.length || plan.profiles.length > 100 || new Set(plan.profiles.map(value => value.id)).size !== plan.profiles.length
    || plan.profiles.some(profile => !nonempty(profile.id) || !profile.identity || !nonempty(profile.identity.provider) || !nonempty(profile.identity.externalId) || !(profile.revision === null || nonempty(profile.revision)) || !hashPattern.test(profile.contentHash) || !profile.citation || ![profile.citation.title, profile.citation.language, profile.citation.creator, profile.citation.rightsNote].every(nonempty) || !Array.isArray(profile.citation.rightsEvidence) || !profile.citation.rightsEvidence.length || !profile.citation.rightsEvidence.every(nonempty) || !Array.isArray(profile.facts) || !profile.facts.length || profile.facts.length > 500 || new Set(profile.facts.map(value => value.id)).size !== profile.facts.length || profile.facts.some(fact => !nonempty(fact.id) || !hashPattern.test(fact.textHash) || !fact.selector))
    || !Array.isArray(plan.objects) || !Array.isArray(plan.statements) || !plan.statements.length || plan.statements.length > 2000 || new Set(plan.statements.map(value => value.id)).size !== plan.statements.length
    || plan.objects.some(value => !display(value.labels as Labels) || !value.types.length)
    || plan.statements.some(value => !nonempty(value.id) || !display(value.interpretation) || !value.factKeys.length || value.validTime && !value.timeFactKeys?.length)
    || !plan.fieldCatalog || plan.fieldCatalog.schemaVersion !== 1 || plan.fieldCatalog.kind !== 'historical-field-display-labels' || ![...plan.fieldCatalog.properties, ...plan.fieldCatalog.types, ...plan.fieldCatalog.values].every(value => display(value.labels))) throw new Error('INVALID_EVIDENCED_FIELD_PLAN');
  const keys = new Set(plan.profiles.flatMap(profile => profile.facts.map(fact => `${profile.id}:${fact.id}`)));
  if (keys.size !== plan.profiles.reduce((count, profile) => count + profile.facts.length, 0)) throw new Error('INVALID_EVIDENCED_FIELD_REFERENCE');
  if (plan.statements.some(statement => [...statement.factKeys, ...statement.timeFactKeys ?? []].some(key => !keys.has(key)))) throw new Error('INVALID_EVIDENCED_FIELD_REFERENCE');
  for (const profile of plan.profiles) for (const { selector } of profile.facts) {
    if (selector.kind === 'element') {
      if (!['p', 'li', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'td', 'th', 'tr'].includes(selector.tag) || ![selector.id, selector.startsWith, selector.contains].some(nonempty)) throw new Error('INVALID_PUBLISHED_FIELD_SELECTOR');
    } else if (selector.kind === 'page-passage') {
      if (!Number.isSafeInteger(selector.page) || selector.page < 1 || !nonempty(selector.start) || !nonempty(selector.end)) throw new Error('INVALID_PUBLISHED_FIELD_SELECTOR');
    } else if (!['table-field', 'section-cell'].includes(selector.kind) || !/^[a-z][a-z0-9-]*$/i.test(selector.tableClass) || !Number.isInteger(selector.tableIndex) || selector.tableIndex < 0 || selector.tableIndex > 200 || selector.kind === 'table-field' && (!nonempty(selector.header) || selector.column !== undefined && (!Number.isInteger(selector.column) || selector.column < 0 || selector.column > 64)) || selector.kind === 'section-cell' && (!nonempty(selector.heading) || !Number.isInteger(selector.rowOffset) || selector.rowOffset < 1 || selector.rowOffset > 20 || !Number.isInteger(selector.column) || selector.column < 0 || selector.column > 64)) throw new Error('INVALID_PUBLISHED_FIELD_SELECTOR');
  }
}

/** Explicit evidence profiles project facts; they cannot infer ancestry or authority from dates or names. */
export function projectEvidencedFields(input: KnowledgeCollection, snapshots: SourceRecordSnapshot[], plan: EvidencedFieldPlan) {
  createKnowledgeIndex(input); validate(plan);
  const issues: EvidencedFieldIssue[] = [], facts: SelectedFact[] = [], used: SourceRecordSnapshot[] = [], documents = new Map<SourceRecordSnapshot, Tree.Element[]>();
  for (const profile of plan.profiles) {
    const matches = snapshots.filter(snapshot => canonicalJson(snapshot.identity) === canonicalJson(profile.identity));
    const snapshot = matches.find(snapshot => snapshot.sourceRevision === profile.revision && snapshot.contentHash === profile.contentHash);
    if (!snapshot) { issues.push({ code: matches.length ? 'SOURCE_MISMATCH' : 'SOURCE_MISSING', profileId: profile.id }); continue; }
    if (createHash('sha256').update(canonicalSourceJson(snapshot.raw)).digest('hex') !== snapshot.contentHash) { issues.push({ code: 'SOURCE_MISMATCH', profileId: profile.id }); continue; }
    used.push(snapshot);
    for (const rule of profile.facts) {
      const selected = select(snapshot, rule.selector, documents);
      if (selected.length !== 1) { issues.push({ code: selected.length ? 'FACT_AMBIGUOUS' : 'FACT_MISSING', profileId: profile.id, factId: rule.id }); continue; }
      const fact = selected[0];
      if (textHash(fact.text) !== rule.textHash) { issues.push({ code: 'FACT_CHANGED', profileId: profile.id, factId: rule.id }); continue; }
      if (rule.includeText && snapshot.rights.redistribution !== 'allowed') { issues.push({ code: 'TEXT_RIGHTS_UNREVIEWED', profileId: profile.id, factId: rule.id }); continue; }
      const retainedLinks: RetainedLink[] = fact.links.map(link => ({ href: link.href, locator: `${fact.locator};${link.relativeLocator}`, textHash: textHash(link.text), ...(rule.includeText ? { text: link.text } : {}) }));
      facts.push({ key: `${profile.id}:${rule.id}`, profileId: profile.id, factId: rule.id, locator: fact.locator, textHash: rule.textHash, ...(rule.includeText ? { text: fact.text } : {}), links: retainedLinks, referenceAnchors: fact.referenceAnchors });
    }
  }
  const collection = structuredClone(input), derivedAssertionIds: string[] = [];
  // A cohesive evidence profile fails closed before adding even a typed event shell.
  if (issues.length) return { status: 'blocked' as const, collection, sourceId: null, mappingVersion: EVIDENCED_FIELD_VERSION, facts, derivedAssertionIds, issues, fieldCatalog: structuredClone(plan.fieldCatalog) };
  const objects = new Map(collection.objects.map(value => [value.id, value]));
  for (const object of plan.objects) {
    const previous = objects.get(object.id);
    if (previous && canonicalJson(previous) !== canonicalJson(object)) issues.push({ code: 'OBJECT_CONFLICT', objectId: object.id });
    else if (!previous) { collection.objects.push(structuredClone(object)); objects.set(object.id, object); }
  }
  if (issues.length) return { status: 'blocked' as const, collection: structuredClone(input), sourceId: null, mappingVersion: EVIDENCED_FIELD_VERSION, facts, derivedAssertionIds, issues, fieldCatalog: structuredClone(plan.fieldCatalog) };
  const permissions = [plan.rights.redistribution, ...used.map(value => value.rights.redistribution)];
  const redistribution = permissions.includes('restricted') ? 'restricted' : permissions.includes('unknown') ? 'unknown' : 'allowed';
  const record = { schemaVersion: 1, mappingVersion: EVIDENCED_FIELD_VERSION, plan, inputSources: used.map(snapshot => ({ identity: snapshot.identity, revision: snapshot.sourceRevision, contentHash: snapshot.contentHash, url: snapshot.url, ...(snapshot.revisionUrl ? { revisionUrl: snapshot.revisionUrl } : {}), retrievedAt: snapshot.retrievedAt, rights: snapshot.rights })), facts };
  const contentHash = sha256(record), source: KnowledgeSource = { id: `gitworld-evidenced-fields:${plan.id}@${contentHash}`, identity: { provider: 'gitworld-evidenced-fields', externalId: plan.id }, revision: plan.revision, contentHash, retrievedAt: plan.preparedAt, url: plan.url, adapterVersion: EVIDENCED_FIELD_VERSION, rights: { ...structuredClone(plan.rights), redistribution }, record: record as unknown as KnowledgeJson };
  const priorSource = input.sources.find(value => value.id === source.id);
  if (priorSource && canonicalJson(priorSource) !== canonicalJson(source)) return { status: 'blocked' as const, collection: structuredClone(input), sourceId: null, mappingVersion: EVIDENCED_FIELD_VERSION, facts, derivedAssertionIds, issues: [{ code: 'SOURCE_CONFLICT' as const }], fieldCatalog: structuredClone(plan.fieldCatalog) };
  else if (!priorSource) collection.sources.push(source);
  if (!issues.length) for (const statement of plan.statements) {
    if (!objects.has(statement.subjectId)) throw new Error('INVALID_EVIDENCED_FIELD_SUBJECT');
    const keys = [...new Set([...statement.factKeys, ...statement.timeFactKeys ?? []])];
    const assertion: KnowledgeAssertion = {
      id: `evidenced-field:${sha256([plan.id, statement.id]).slice(0, 40)}`, subjectId: statement.subjectId, propertyId: statement.propertyId, value: structuredClone(statement.value),
      qualifiers: [...structuredClone(statement.qualifiers ?? []), { propertyId: 'projection:rule-id', value: { kind: 'text', value: `${plan.id}@${plan.revision}:${statement.id}` } }, ...keys.map(key => ({ propertyId: 'projection:source-fact', value: { kind: 'text' as const, value: key } }))],
      evidence: keys.map(key => { const index = facts.findIndex(value => value.key === key), profile = plan.profiles.find(value => value.id === facts[index].profileId)!, snapshot = used.find(value => canonicalJson(value.identity) === canonicalJson(profile.identity) && value.sourceRevision === profile.revision && value.contentHash === profile.contentHash)!; return { sourceId: source.id, locator: `$.facts[${index}];${facts[index].locator}`, url: snapshot.revisionUrl ?? snapshot.url }; }),
      sourceSnapshotId: source.id, review: 'unreviewed', ...(statement.validTime ? { validTime: structuredClone(statement.validTime) } : {}),
    };
    const previous = input.assertions.find(value => value.id === assertion.id);
    if (previous && canonicalJson(previous) !== canonicalJson(assertion)) issues.push({ code: 'ASSERTION_CONFLICT', assertionId: assertion.id });
    else { if (!previous) collection.assertions.push(assertion); derivedAssertionIds.push(assertion.id); }
  }
  createKnowledgeIndex(collection);
  return { status: issues.length ? 'conflicts' as const : 'mapped' as const, collection, sourceId: source.id, mappingVersion: EVIDENCED_FIELD_VERSION, facts, derivedAssertionIds, issues, fieldCatalog: structuredClone(plan.fieldCatalog) };
}
