import type { EditorialJson, EditorialRepository } from '../../contracts/src/editorial-types.ts';

export type ChangeGroup = 'object' | 'source' | 'research' | 'mapping' | 'model' | 'navigation' | 'other';
export type ChangeMetadataKind = 'object-baseline' | 'field-catalog' | 'catalog-baseline' | 'context-definition' | 'context-membership';
export type ChangeSummary = { path: string; kind: string; title: { en: string; 'zh-CN'?: string }; group: ChangeGroup; metadataKind?: ChangeMetadataKind };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const group = (path: string): ChangeGroup => ({ objects:'object',sources:'source',research:'research',mappings:'mapping',models:'model',model:'model',navigation:'navigation' } as Record<string, ChangeGroup>)[path.split('/')[0]] ?? 'other';
const groupOrder: Record<ChangeGroup, number> = { object: 0, research: 1, model: 2, navigation:3, source: 4, mapping: 5, other: 6 };
const metadataKind = (path: string): ChangeMetadataKind | undefined => path.startsWith('navigation/') ? path.endsWith('/definition.json') ? 'context-definition' : 'context-membership' : path.startsWith('mappings/baseline-') ? 'object-baseline' : path.startsWith('mappings/field-catalogs/') ? 'field-catalog' : path.startsWith('mappings/field-catalog-baselines/') ? 'catalog-baseline' : undefined;
function label(value: unknown): ChangeSummary['title'] | null {
  if (!record(value)) return null;
  if (typeof value.en === 'string') return { en: value.en, ...(typeof value['zh-CN'] === 'string' ? { 'zh-CN': value['zh-CN'] } : typeof value['zh-hans'] === 'string' ? { 'zh-CN': value['zh-hans'] } : {}) };
  if (record(value.en) && typeof value.en.value === 'string') return { en: value.en.value, ...(record(value['zh-hans']) && typeof value['zh-hans'].value === 'string' ? { 'zh-CN': value['zh-hans'].value } : record(value.zh) && typeof value.zh.value === 'string' ? { 'zh-CN': value.zh.value } : {}) };
  return null;
}
function title(path: string, value: unknown): ChangeSummary['title'] {
  if (record(value)) {
    if(path.endsWith('/definition.json')&&record(value.labels))return label(value.labels)??{en:String(Object.values(value.labels)[0]??value.id)};
    if(value.kind==='active-field-catalog'&&typeof value.catalogId==='string')return{en:value.catalogId,'zh-CN':value.catalogId};
    if (record(value.object)) return label(value.object.labels) ?? { en: String(value.object.id) };
    if (typeof value.title === 'string') return { en: value.title };
    if (record(value.dataset)) return label(value.dataset.name) ?? { en: String(value.dataset.id) };
    const source = record(value.record) ? value.record : {};
    const name = label(source.labels); if (name) return name;
    if (typeof source.title === 'string') return { en: source.title };
    if (record(value.identity)) return { en: `${value.identity.provider}: ${value.identity.externalId}` };
    if (typeof value.objectId === 'string') return { en: value.objectId };
  }
  return { en: path };
}

/** Paginate after searching the complete changed-object metadata set, not only the loaded page. */
export function createContentSummaries(repository: EditorialRepository) {
  const cache = new Map<string, ChangeSummary[]>();
  return {
    invalidate() { cache.clear(); },
    async changes(input: { mode: 'working' | 'staged'; group?: ChangeGroup; query?: string; paths?: string[]; offset: number; limit: number }) {
      const status = await repository.status(), changes = input.mode === 'staged' ? status.staged : status.unstaged;
      const key = input.mode === 'staged' ? `staged:${status.head}:${status.stagedTree}` : 'working';
      let all = cache.get(key);
      if (!all) {
        if (!changes.length) all = [];
        else {
          const from = input.mode === 'staged' ? `tree:${status.stagedTree}` : 'working';
          const paths=new Set(changes.map(value=>value.path));for(const name of [...paths])if(name.startsWith('navigation/contexts/'))paths.add(name.split('/').slice(0,3).join('/')+'/definition.json');
          const snapshot = await repository.snapshot({ from, paths: [...paths] });
          const deleted = changes.filter(value => snapshot.files[value.path] === undefined);
          const prior = deleted.length ? await repository.snapshot({ from: input.mode === 'staged' ? status.head : `tree:${status.stagedTree}`, paths: deleted.map(value => value.path) }) : null;
          all = changes.map(value => ({ ...value, group: group(value.path), title: title(value.path.startsWith('navigation/')?value.path.split('/').slice(0,3).join('/')+'/definition.json':value.path, value.path.startsWith('navigation/')?snapshot.files[value.path.split('/').slice(0,3).join('/')+'/definition.json']??snapshot.files[value.path]??prior?.files[value.path]:snapshot.files[value.path] ?? prior?.files[value.path]), ...(metadataKind(value.path) ? { metadataKind: metadataKind(value.path) } : {}) }));
          all.sort((a, b) => groupOrder[a.group] - groupOrder[b.group] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        }
        cache.set(key, all);
      }
      const query = input.query?.trim().normalize('NFKC').toLocaleLowerCase() ?? '';
      const paths = input.paths ? new Set(input.paths) : null;
      const matching = all.filter(value => (!paths || paths.has(value.path)) && (!input.group || value.group === input.group) && (!query || [value.path, ...Object.values(value.title)].some(text => text.normalize('NFKC').toLocaleLowerCase().includes(query))));
      return { items: matching.slice(input.offset, input.offset + input.limit), total: matching.length };
    },
  };
}
