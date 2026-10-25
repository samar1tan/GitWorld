import type { EditorialJson } from '../../../../packages/contracts/src/editorial-types.ts';
import type { ChangesCopyKey } from './changes-copy.ts';
export type SemanticChange = { id: string; label: ChangesCopyKey | null; detail: string; before: EditorialJson | undefined; after: EditorialJson | undefined; raw?: boolean };
const object = (value: unknown): value is Record<string, EditorialJson> => !!value && typeof value === 'object' && !Array.isArray(value);
const stable = (value: unknown): string => value === undefined ? 'undefined' : Array.isArray(value) ? `[${value.map(stable).join(',')}]` : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const record = (value: EditorialJson | null | undefined) => object(value) ? value : {};

/** Produces semantic rows without requiring a full source record to be printed in the interface. */
export function semanticChanges(before: EditorialJson | null, after: EditorialJson | null): SemanticChange[] {
  const left = record(before), right = record(after), rows: SemanticChange[] = [];
  const add = (id: string, label: ChangesCopyKey | null, a: EditorialJson | undefined, b: EditorialJson | undefined, detail = '', raw = false) => { if (!same(a, b)) rows.push({ id, label, detail, before: a, after: b, ...(raw ? { raw } : {}) }); };
  if(['user-organization','source-profile'].includes(String(left.origin??right.origin))){
    for(const[field,label]of [['labels','name'],['description','description']]as const){const a=record(left[field]),b=record(right[field]);for(const language of[...new Set([...Object.keys(a),...Object.keys(b)])].sort())add(`${field}:${language}`,label,a[language],b[language],language);}
    add('origin','organizationDecision',left.origin,right.origin);add('profile','contextProfile',left.profile,right.profile);return rows;
  }
  if (object(left.object) || object(right.object)) {
    const a = record(left.object), b = record(right.object);
    for (const [field, label] of [['labels', 'name'], ['descriptions', 'description']] as const) {
      const namesA = record(a[field]), namesB = record(b[field]);
      for (const language of [...new Set([...Object.keys(namesA), ...Object.keys(namesB)])].sort()) add(`${field}:${language}`, label, namesA[language], namesB[language], language);
    }
    add('types', 'types', a.types, b.types); add('identities', 'identities', a.identities, b.identities); add('aliases', 'aliases', a.aliases, b.aliases);
    const assertions = (value: EditorialJson | undefined) => new Map((Array.isArray(value) ? value : []).filter(object).flatMap(item => typeof item.id === 'string' ? [[item.id, item] as const] : []));
    const assertionsA = assertions(left.assertions), assertionsB = assertions(right.assertions);
    for (const id of [...new Set([...assertionsA.keys(), ...assertionsB.keys()])].sort()) {
      const x = assertionsA.get(id), y = assertionsB.get(id), property = String(y?.propertyId ?? x?.propertyId ?? id);
      for (const [field, label] of [['value', 'assertionValue'], ['validTime', 'temporalScope'], ['review', 'review'], ['qualifiers', 'qualifiers'], ['evidence', 'evidence'], ['rank', 'sourceRank'], ['sourceSnapshotId', 'sourceSnapshot']] as const) add(`${id}:${field}`, label, x?.[field], y?.[field], property);
    }
    return rows;
  }
  if (typeof left.interpretation === 'string' || typeof right.interpretation === 'string') {
    for (const [field, label] of [['title', 'question'], ['scope', 'scope'], ['interpretation', 'interpretation'], ['openQuestions', 'openQuestions'], ['evidence', 'evidence'], ['comparison', 'fixedComparison']] as const) add(field, label, left[field], right[field]);
    return rows;
  }
  const known: Record<string, ChangesCopyKey> = { labels:'name', description:'description', origin:'organizationDecision', title: 'title', revision: 'sourceRevision', retrievedAt: 'retrieved', rights: 'license', identity: 'identities' };
  for (const field of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (field === 'schemaVersion' || field === 'id') continue;
    add(field, field === 'record' || field === 'raw' ? 'sourceRecord' : known[field] ?? null, left[field], right[field], field in known || field === 'record' || field === 'raw' ? '' : field, field === 'record' || field === 'raw');
  }
  if (!rows.length && !same(before, after)) add('value', 'assertionValue', before === null ? undefined : before, after === null ? undefined : after);
  return rows;
}

export function semanticTitle(before: EditorialJson | null, after: EditorialJson | null): { en: string; 'zh-CN'?: string } | null {
  const value = record(after ?? before);
  if (object(value.object) && object(value.object.labels)) {
    const labels = value.object.labels, en = typeof labels.en === 'string' ? labels.en : Object.values(labels).find(value => typeof value === 'string');
    const zh = labels['zh-CN'] ?? labels['zh-hans'] ?? labels.zh;
    if (typeof en === 'string') return { en, ...(typeof zh === 'string' ? { 'zh-CN': zh } : {}) };
  }
  if (typeof value.title === 'string') return { en: value.title };
  if (object(value.identity) && typeof value.identity.provider === 'string' && typeof value.identity.externalId === 'string') return { en: `${value.identity.provider} ${value.identity.externalId}` };
  return null;
}
