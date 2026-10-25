import { createHash } from 'node:crypto';
import type { EditorialJson, EditorialRepository, EditorialSnapshot, EditorialWrite } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeCollectionRead, KnowledgeFieldCatalog, KnowledgeImportResult, KnowledgeMappingPreview, KnowledgeObjectBundle, KnowledgeObjectDetail } from '../../contracts/src/knowledge-workspace-types.ts';
import { createKnowledgeIndex, type KnowledgeCollection, type KnowledgeReview } from '../../domain/src/knowledge.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { combineKnowledgeCollections, mapSourceSnapshot } from '../../ingestion/src/knowledge-mapping.ts';
import type { SourceRecordSnapshot } from '../../ingestion/src/source-types.ts';
import { createKnowledgeDisplayIndex } from './knowledge-display.ts';
import { resolveKnowledgeVocabulary, vocabularySlots, vocabularySourcePath } from './knowledge-vocabulary.ts';
import { knowledgeCollectionFromTree, readNavigationTree } from './navigation-tree.ts';
import { SOURCE_PRESENTATIONS_PATH, readSourcePresentations } from './knowledge-source-presentations.ts';
import { APPEND_OBJECT_MERGE_VERSION, appendKnowledgeBundle } from './knowledge-append.ts';
import { EDITORIAL_MAX_PATHS } from '../../contracts/src/editorial-types.ts';
import { brokenKnowledgeReferencePaths, knowledgeEntityReferences, knowledgeSourceReferences } from './knowledge-staging.ts';

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const json = (value: unknown) => value as EditorialJson;
const empty = (): KnowledgeCollection => ({ schemaVersion: 1, objects: [], assertions: [], sources: [] });
const objectPath = (id: string) => `objects/${digest(id)}.json`;
const sourcePath = (id: string) => `sources/${digest(id)}.json`;
const baselinePath = (id: string) => `mappings/baseline-${digest(id)}.json`;
const conflictPath = (id: string) => `mappings/conflict-${digest(id)}.json`;
const validRevision = (value: string) => value === 'working' || /^(tree:)?[a-f0-9]{40}$/.test(value);
type MappingIssue = { code: string; locator: string };
type AdoptInput = ({ snapshots: AsyncIterable<SourceRecordSnapshot> } | { collection: KnowledgeCollection; issues?: MappingIssue[]; mode?: 'replace-object' | 'append-observations' }) & { review: Exclude<KnowledgeReview, 'rejected'>; expectedHead: string; expectedInputHash: string };

/** Maps source assertions into the ordinary data tree; views consume the same tree at an explicit revision. */
export function createKnowledgeStore(repository: EditorialRepository, options: { fieldCatalog?: KnowledgeFieldCatalog } = {}) {
  const cached = new Map<string, KnowledgeCollectionRead>();
  const indices = new Map<string, ReturnType<typeof createKnowledgeIndex>>();
  const displays = new Map<string, ReturnType<typeof createKnowledgeDisplayIndex>>();
  const navigations = new Map<string, ReturnType<typeof readNavigationTree>>();
  function invalidate() { cached.clear(); indices.clear(); displays.clear(); navigations.clear(); }
  async function read(revision = 'working'): Promise<KnowledgeCollectionRead> {
    if (!validRevision(revision)) throw new Error('INVALID_REQUEST');
    const found = cached.get(revision); if (found && revision !== 'working') return found;
    const snapshot = await repository.snapshot({ from: revision, prefixes: ['objects/', 'sources/','mappings/field-catalogs/','mappings/field-catalog-baselines/','navigation/',SOURCE_PRESENTATIONS_PATH] });
    const fingerprint = digest({files:snapshot.files,legacy:options.fieldCatalog??null});
    if (found?.fingerprint === fingerprint) return found;
    const collection = knowledgeCollectionFromTree(snapshot.files);
    navigations.set(revision,readNavigationTree(snapshot.files));
    const vocabulary=resolveKnowledgeVocabulary(snapshot.files,options.fieldCatalog);
    const result = { collection, revision, working: revision === 'working', fingerprint,catalog:vocabulary.catalog,vocabulary:vocabulary.presentation,sourcePresentations:readSourcePresentations(snapshot.files) };
    indices.delete(revision); displays.delete(revision);
    cached.set(revision, result); return result;
  }
  async function map(snapshots: AsyncIterable<SourceRecordSnapshot>, review: Exclude<KnowledgeReview, 'rejected'> = 'unreviewed') {
    const parts: KnowledgeCollection[] = [], issues: { code: string; locator: string }[] = [], versions = new Set<string>();
    let issueCount = 0;
    for await (const snapshot of snapshots) {
      const mapped = mapSourceSnapshot(snapshot, { review }); parts.push(mapped.collection); versions.add(mapped.mappingVersion);
      issueCount += mapped.issues.length; if (issues.length < 30) issues.push(...mapped.issues.slice(0, 30 - issues.length));
    }
    const merged = combineKnowledgeCollections(parts);
    if (merged.conflicts.length) throw new Error('CONFLICT');
    return describe(merged.collection, { issues, issueCount, mappingVersions: [...versions] });
  }
  function describe(input: KnowledgeCollection, options: { review?: Exclude<KnowledgeReview, 'rejected'>; issues?: MappingIssue[]; issueCount?: number; mappingVersions?: string[] } = {}) {
    const collection = structuredClone(input);
    if (options.review) for (const assertion of collection.assertions) assertion.review = options.review;
    const index = createKnowledgeIndex(collection), stats = index.stats();
    // Review choice is local adoption state; it does not change the identity of the input preview.
    const inputHash = digest({ objectMergeVersion: APPEND_OBJECT_MERGE_VERSION, objects: collection.objects, assertions: collection.assertions.map(value => ({ ...value, review: 'unreviewed' })), sources: collection.sources.map(value => ({ ...value, retrievedAt: '' })) });
    const preview: KnowledgeMappingPreview = { inputHash, objects: stats.objects, assertions: stats.assertions, datedAssertions: stats.datedAssertions, locatedObjects: stats.locatedObjects, issues: (options.issues ?? []).slice(0, 30), issueCount: options.issueCount ?? options.issues?.length ?? 0, sample: index.query({ limit: 12 }).objects, mappingVersions: (options.mappingVersions ?? [...new Set(collection.sources.map(value => value.adapterVersion))]).sort() };
    return { collection, preview };
  }
  const store = {
    read, map, invalidate, previewCollection: describe,
    async objectDetail(objectId: string, revision = 'working'): Promise<KnowledgeObjectDetail> {
      const view = await read(revision);
      let index = indices.get(revision); if (!index) { index = createKnowledgeIndex(view.collection,navigations.get(revision)?.queryMemberships); indices.set(revision, index); }
      const object = index.object(objectId); if (!object) throw new Error('NOT_FOUND');
      const assertions = index.assertions(objectId);
      let formatter = displays.get(revision); if (!formatter) { formatter = createKnowledgeDisplayIndex(view.collection, view.catalog,view.vocabulary,view.sourcePresentations); displays.set(revision, formatter); }
      const display = formatter.object(objectId, assertions, view.fingerprint!);
      const sourceIds = new Set(assertions.flatMap(value => [value.sourceSnapshotId, ...value.evidence.map(item => item.sourceId)]));
      for (const item of [...Object.values(display.values), ...Object.values(display.objects).map(value => value.display)]) for (const text of Object.values(item)) for (const evidence of text.provenance) sourceIds.add(evidence.sourceId);
      for(const item of [...Object.values(display.vocabulary?.properties??{}),...Object.values(display.vocabulary?.types??{}),...Object.values(display.vocabulary?.values??{}).flatMap(value=>Object.values(value))])for(const text of Object.values(item))for(const evidence of text.provenance)sourceIds.add(evidence.sourceId);
      return { object, assertions, sources: formatter.sourceHeaders(sourceIds), revision, working: view.working, display };
    },
    async index(revision = 'working') {
      const view = await read(revision);
      let index = indices.get(revision);
      if (!index) { index = createKnowledgeIndex(view.collection,navigations.get(revision)?.queryMemberships); indices.set(revision, index); }
      const base = index;
      return { view, index: { ...base, query(query: Parameters<typeof base.query>[0]) {
        for(const contextId of query?.contextIds??[])if(!navigations.get(revision)?.definitions.has(contextId))throw new Error('NOT_FOUND');
        const result = base.query(query);
        if(view.catalog)result.typeCatalog=structuredClone(view.catalog.types);
        if (result.coverage && view.catalog) { const types = new Map(view.catalog.types.map(value => [value.id,value])); for (const type of result.coverage.typeCounts) { const metadata=types.get(type.typeId);if(metadata){type.labels=structuredClone(metadata.labels);if(metadata.navigationRole)type.navigationRole=metadata.navigationRole;} } }
        return result;
      } } };
    },
    async dependencies(paths: string[], basis?: { working: EditorialSnapshot; staged: EditorialSnapshot }) {
      const selected = new Set(paths), required = new Set<string>(), missing = new Set<string>();
      if (selected.size > EDITORIAL_MAX_PATHS) throw new Error('INVALID_REQUEST');
      const [working, staged] = basis ? [basis.working, basis.staged] : await Promise.all([
        repository.snapshot({ from: 'working', prefixes: ['objects/', 'sources/', 'mappings/'] }),
        repository.snapshot({ from: 'staged', prefixes: ['objects/', 'sources/', 'mappings/'] }),
      ]);
      if (working.head !== staged.head) throw new Error('HEAD_CHANGED');
      const workingFiles = working.files, stagedFiles = staged.files;
      const headObjects = new Set(working.head ? await repository.list({ from: working.head, prefix: 'objects/' }) : []);
      const closure = new Set(selected), queue = [...selected];
      const dependency = (name: string) => {
        if (closure.has(name)) return;
        const current = workingFiles[name] ?? null, frozen = stagedFiles[name] ?? null;
        if (name.startsWith('objects/')) {
          // Existing frozen B is sufficient; an unrelated Working C is not a dependency.
          if (frozen !== null) return;
          // An explicit staged deletion must not be silently undone by dependency expansion.
          if (headObjects.has(name)) { missing.add(name); return; }
          if (current === null) return; // Genuine unresolved imported references remain readable.
        } else if (current === null && frozen === null) { missing.add(name); return; }
        else if (frozen !== null && (current === null || digest(current) === digest(frozen))) return;
        required.add(name); closure.add(name); queue.push(name);
        if (closure.size > EDITORIAL_MAX_PATHS) throw new Error('INVALID_REQUEST');
      };
      const vocabulary=resolveKnowledgeVocabulary(workingFiles,options.fieldCatalog);
      const catalogProperties=new Map<string,Set<typeof vocabulary.catalogs[number]>>(),catalogTypes=new Map<string,Set<typeof vocabulary.catalogs[number]>>();
      for(const catalog of vocabulary.catalogs)for(const slot of vocabularySlots(catalog.vocabulary.catalog)){const index=slot.kind==='types'?catalogTypes:catalogProperties,values=index.get(slot.id)??new Set();values.add(catalog);index.set(slot.id,values);}
      for (let index = 0; index < queue.length; index++) {
        const path = queue[index];
        if (path.startsWith('sources/')) for (const id of knowledgeSourceReferences(workingFiles[path])) dependency(sourcePath(id));
        if(path.startsWith('mappings/field-catalogs/')){const catalog=vocabulary.catalogs.find(value=>value.path===path);if(catalog)for(const name of [catalog.sourcePath,catalog.baseline,...catalog.vocabulary.origin.evidence.map(pin=>vocabularySourcePath(pin.sourceId))])dependency(name);}
        if(path===SOURCE_PRESENTATIONS_PATH)for(const entry of readSourcePresentations(workingFiles))dependency(sourcePath(entry.sourceId));
        if (!path.startsWith('objects/')) continue;
        const bundle = workingFiles[path] as unknown as KnowledgeObjectBundle | undefined;
        if (!bundle) continue;
        for (const reference of knowledgeEntityReferences({ [path]: json(bundle) })) dependency(objectPath(reference.targetId));
        const dependencies = new Set(bundle.assertions.flatMap(value => [value.sourceSnapshotId, ...value.evidence.map(item => item.sourceId)]).map(sourcePath));
        const claimIds = new Set(bundle.assertions.flatMap(value => [value.id, ...value.qualifiers.filter(item => ['binding:derived-from','projection:derived-from'].includes(item.propertyId) && item.value.kind === 'text').map(item => item.value.kind === 'text' ? item.value.value : '')]));
        for (const [candidatePath, value] of Object.entries(workingFiles)) {
          if (!candidatePath.startsWith('sources/')) continue;
          const source = value as unknown as KnowledgeCollection['sources'][number], body = source.record as any;
          if (source.identity.provider === 'gitworld-content-labels' && body && (Array.isArray(body.labels) && body.labels.some((item: any) => item.objectId === bundle.object.id) || Array.isArray(body.valueTexts) && body.valueTexts.some((item: any) => claimIds.has(item.assertionId)))) dependencies.add(candidatePath);
        }
        const baseline = baselinePath(bundle.object.id);
        if (workingFiles[baseline] !== undefined) dependencies.add(baseline);
        const propertyIds=new Set(bundle.assertions.flatMap(value=>[value.propertyId,...value.qualifiers.map(item=>item.propertyId)]));
        const usedCatalogs=new Set([...propertyIds].flatMap(id=>[...catalogProperties.get(id)??[]]).concat(bundle.object.types.flatMap(id=>[...catalogTypes.get(id)??[]])));
        for(const catalog of usedCatalogs){dependencies.add(catalog.path);dependencies.add(catalog.baseline);dependencies.add(catalog.sourcePath);for(const pin of catalog.vocabulary.origin.evidence)dependencies.add(vocabularySourcePath(pin.sourceId));}
        for (const name of dependencies) dependency(name);
      }
      const candidate = { ...stagedFiles };
      for (const name of closure) if (workingFiles[name] === undefined) delete candidate[name]; else candidate[name] = workingFiles[name];
      for (const name of brokenKnowledgeReferencePaths(stagedFiles, candidate, headObjects)) missing.add(name);
      return { selected: [...selected], required: [...required].sort(), missing: [...missing].sort() };
    },
    async planAdoption(input: AdoptInput) {
      const mapped = 'collection' in input ? describe(input.collection, { review: input.review, issues: input.issues }) : await map(input.snapshots, input.review);
      if (mapped.preview.inputHash !== input.expectedInputHash) throw new Error('CONFLICT');
      const changes: EditorialWrite[] = [], guards: Record<string, string | null> = {}, result: KnowledgeImportResult = { preview: mapped.preview, changedObjects: [], unchangedObjects: [], conflicts: [] };
      const navigation = new Map<string, Record<string,string>>();
      const bySubject = new Map<string, KnowledgeCollection['assertions']>();
      for (const assertion of mapped.collection.assertions) { const group = bySubject.get(assertion.subjectId) ?? []; group.push(assertion); bySubject.set(assertion.subjectId, group); }
      for (const source of mapped.collection.sources) {
        const path = sourcePath(source.id), previous = await repository.read(path);
        if (previous !== null && digest({ ...(previous as any), retrievedAt: '' }) === digest({ ...source, retrievedAt: '' })) continue;
        if (previous !== null) throw new Error('CONFLICT');
        changes.push({ path, value: json(source) }); guards[path] = null;
      }
      for (const object of mapped.collection.objects) {
        if (await repository.read(conflictPath(object.id)) !== null) throw new Error('REVIEW_REQUIRED');
        let incoming: KnowledgeObjectBundle = { schemaVersion: 1, object, assertions: bySubject.get(object.id) ?? [] };
        const path = objectPath(object.id), baseline = baselinePath(object.id);
        const local = await repository.read(path) as unknown as KnowledgeObjectBundle | null;
        const base = await repository.read(baseline) as unknown as KnowledgeObjectBundle | null;
        let metadataConflict = false;
        if ('collection' in input && input.mode === 'append-observations') {
          const expanded = appendKnowledgeBundle(base, incoming);
          incoming = expanded.bundle; metadataConflict = expanded.metadataConflict;
        }
        if (local !== null && digest(local) === digest(incoming)) {
          // A prior write may have made the object durable before its baseline.
          // Advance only to the exact upstream candidate, guarding both reads.
          if (base === null || digest(base) !== digest(incoming)) {
            changes.push({ path: baseline, value: json(incoming) });
            guards[path] = digest(local); guards[baseline] = base === null ? null : digest(base);
          }
          result.unchangedObjects.push(object.id); navigation.set(object.id, local.object.labels); continue;
        }
        if (local !== null && (metadataConflict || base !== null && digest(local) !== digest(base) && digest(incoming) !== digest(base) || base === null)) {
          const conflict = { objectId: object.id, base, local, incoming }; result.conflicts.push(conflict);
          const pending=conflictPath(object.id);
          changes.push({ path: pending, value: json(conflict) });
          guards[path]=digest(local);guards[baseline]=base===null?null:digest(base);guards[pending]=null;continue;
        }
        if (base !== null && digest(incoming) === digest(base)) { result.unchangedObjects.push(object.id); if (local !== null) navigation.set(object.id, local.object.labels); continue; }
        changes.push({ path, value: json(incoming) }, { path: baseline, value: json(incoming) });
        guards[path] = local === null ? null : digest(local); guards[baseline] = base === null ? null : digest(base);
        result.changedObjects.push(object.id);
        navigation.set(object.id, incoming.object.labels);
      }
      result.paths = result.changedObjects.map(objectPath);
      result.objects = [...navigation].slice(0,40).map(([id,labels]) => ({id,labels:structuredClone(labels)})); result.totalObjects = navigation.size;
      result.batch={schemaVersion:1,inputObjectSetHash:digest(mapped.collection.objects.map(object=>object.id).sort()),acceptedObjectSetHash:digest([...result.changedObjects,...result.unchangedObjects].sort()),sourceRefs:mapped.collection.sources.map(source=>({sourceId:source.id,revision:source.revision,contentHash:source.contentHash}))};
      return {changes,guards,result};
    },
    async adopt(input:AdoptInput):Promise<KnowledgeImportResult>{const plan=await store.planAdoption(input);if(plan.changes.length)await repository.write(plan.changes,{expectedHead:input.expectedHead,expectedContentHashes:plan.guards});invalidate();return plan.result;},
    async conflicts() {
      const result: KnowledgeImportResult['conflicts'] = [];
      for (const path of await repository.list({ prefix: 'mappings/conflict-' })) {
        const value = await repository.read(path) as unknown as KnowledgeImportResult['conflicts'][number];
        if (!value || path !== conflictPath(value.objectId)) throw new Error('VALIDATION_FAILED'); result.push(value);
      }
      return result;
    },
    async resolve(objectId: string, choice: 'local' | 'incoming', expectedHead: string) {
      const path = conflictPath(objectId), value = await repository.read(path) as unknown as KnowledgeImportResult['conflicts'][number] | null;
      if (!value || value.objectId !== objectId) throw new Error('NOT_FOUND');
      const selected = choice === 'local' ? value.local : value.incoming;
      await repository.write([{ path: objectPath(objectId), value: json(selected) }, { path: baselinePath(objectId), value: json(value.incoming) }, { path, value: null }], { expectedHead, expectedContentHashes: { [path]: digest(value), [objectPath(objectId)]: value.local === null ? null : digest(value.local), [baselinePath(objectId)]: value.base === null ? null : digest(value.base) } });
      invalidate();
    },
  };
  return store;
}

/** Trusted startup data uses the same per-object/source representation as ordinary adoption. */
export function knowledgeCollectionSeedFiles(collection: KnowledgeCollection): Record<string, EditorialJson> {
  createKnowledgeIndex(collection);
  const files: Record<string, EditorialJson> = {}, bySubject = new Map<string, KnowledgeCollection['assertions']>();
  for (const assertion of collection.assertions) { const group = bySubject.get(assertion.subjectId) ?? []; group.push(assertion); bySubject.set(assertion.subjectId, group); }
  for (const source of collection.sources) files[sourcePath(source.id)] = json(structuredClone(source));
  for (const object of collection.objects) {
    const bundle: KnowledgeObjectBundle = { schemaVersion: 1, object: structuredClone(object), assertions: structuredClone(bySubject.get(object.id) ?? []) };
    files[objectPath(object.id)] = json(bundle); files[baselinePath(object.id)] = json(structuredClone(bundle));
  }
  return files;
}
