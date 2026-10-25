import { createHash, randomUUID } from 'node:crypto';
import { open, rename, rm, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { buildContentManifest, canonicalJson, completeCommand, contentHash, createHistoryEngine, executeCommand, executeIntent, validateDataPackage } from '../../domain/src/index.ts';
import { createKnowledgeIndex } from '../../domain/src/knowledge.ts';
import type { DataPackage, DatasetRef, HistoryEngine } from '../../domain/src/index.ts';
import { validateServiceRequest } from '../../contracts/src/index.ts';
import type { DraftPreview, ImportPreview, LocalService, OperationProgress, ReviewDecision, ServiceError, ServiceRequest, ServiceResponse, ServiceResult } from '../../contracts/src/index.ts';
import { createSqliteRepository } from '../../storage/src/index.ts';
import { acquireMetObjects, exportPackageCsv, loadDataPackageFile, searchWikidataEntities } from '../../ingestion/src/index.ts';
import { createSourceArchive } from './source-archive.ts';
import { createEditorialRepository, EditorialFailure } from '../../storage/src/editorial.ts';
import type { EditorialJson, EditorialRepository } from '../../contracts/src/editorial-types.ts';
import { createResearchStore, validResearchRecord } from './research-store.ts';
import { createKnowledgeStore, knowledgeCollectionSeedFiles } from './knowledge-store.ts';
import { createKnowledgeEditor, KnowledgeEditorFailure } from './knowledge-editor.ts';
import { loadTrustedKnowledgeBundle } from './trusted-bundled-knowledge.ts';
import { readSelectedKnowledgeCollectionFile } from './knowledge-collection-files.ts';
import { createContentSummaries } from './content-summary.ts';
import { createLibraryBackup, restoreLibraryBackup, detectLibraryBackup, recoverLibraryRestore, LibraryBackupFailure } from './library-backup.ts';
import { createClientStateStore } from './client-state.ts';
import { createCollectionAcquisition, CollectionAcquisitionFailure, COLLECTION_CATALOG } from './collection-acquisition.ts';
import { createSettingsStore, SettingsFailure } from './settings.ts';
import { createModelStore, modelPath, ModelFailure } from './model-store.ts';
import { createWorkbenchCommands, readOnlyWorkbenchCommand } from './workbench-commands.ts';
import { createKnowledgeImports, KnowledgeImportFailure, knowledgeArtifactHash, validateKnowledgeImportDirectory } from './knowledge-imports.ts';
import { loadLegacyFieldCatalog, planKnowledgeVocabulary, resolveKnowledgeVocabulary, validateKnowledgeVocabularyDirectory } from './knowledge-vocabulary.ts';
import { createWikipediaWorkspace, validateWikipediaWorkspaceDirectory, WikipediaWorkspaceFailure } from './wikipedia-workspace.ts';
import { createNavigationContexts, NavigationFailure, validateNavigationDirectory, type NavigationImportReceipt } from './navigation-contexts.ts';
import { navigationBootstrapSeedFiles, navigationChangeSummary, navigationDependencies } from './navigation-tree.ts';

export type LocalServiceOptions = {
  dataDirectory: string;
  resolveFileToken: (token: string, purpose: 'import' | 'export' | 'backup' | 'restore') => string | undefined;
  onProgress?: (progress: OperationProgress) => void;
  seedPackagePath?: string;
  seedKnowledgeBundle?: { manifestPath: string; expectedManifestHash: string };
  /** Trusted host/test dependency only; callers cannot choose a network transport over IPC. */
  sourceFetch?: typeof fetch;
  gitExecutable?: string;
  gitExecPath?: string;
};
class ServiceFailure extends Error { readonly detail: ServiceError; constructor(detail: ServiceError) { super(detail.code); this.detail = detail; } }
function unwrap<T>(result: ServiceResult<T>): T { if (!result.ok) throw new ServiceFailure(result.error); return result.value; }
const failure = (code: ServiceError['code']): never => { throw new ServiceFailure({ code }); };
async function writeAtomic(destination: string, body: string): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { const file = await open(temporary, 'wx', 0o600); try { await file.writeFile(body); await file.sync(); } finally { await file.close(); } await rename(temporary, destination); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

/** Trusted host factory; no path or adapter code is supplied by renderer messages. */
export async function createLocalService(options: LocalServiceOptions): Promise<LocalService & { close(): Promise<void> }> {
  const bundledKnowledge = options.seedKnowledgeBundle ? await loadTrustedKnowledgeBundle({
    manifestText: await readFile(options.seedKnowledgeBundle.manifestPath, 'utf8'),
    expectedManifestHash: options.seedKnowledgeBundle.expectedManifestHash,
    readText: relativePath => readFile(path.join(path.dirname(options.seedKnowledgeBundle!.manifestPath), relativePath), 'utf8'),
  }) : null;
  await recoverLibraryRestore({ dataDirectory: options.dataDirectory });
  let repository = createSqliteRepository({ dataDirectory: options.dataDirectory });
  let sourceArchive = await createSourceArchive(options.dataDirectory, { fetch: options.sourceFetch });
  const clientState = createClientStateStore(options.dataDirectory);
  const settings = createSettingsStore(options.dataDirectory, { legacy: async () => {
    const locale = await clientState.load('locale'), onboarding = await clientState.load('onboarding');
    return { locale: locale?.value, tipsEnabled: onboarding?.value && typeof onboarding.value === 'object' && !Array.isArray(onboarding.value) ? onboarding.value.tipsEnabled : undefined };
  } });
  const collectionAcquisition = createCollectionAcquisition(options.dataDirectory, { fetch: options.sourceFetch });
  const engines = new Map<string, HistoryEngine>();
  const controllers = new Map<string, AbortController>();
  const running = new Set<string>();
  const pendingRequests = new Set<Promise<ServiceResponse>>();
  let mutationTail: Promise<unknown> = Promise.resolve();
  let acquisitionPending = false;
  let sourceCollectionPending = false;
  let maintenancePending = false;
  let sourceCollectionTail: Promise<unknown> = Promise.resolve();
  let closed = false;let writeOperationId='library-initialize';
  let initialization = await repository.initialize();
  let editorial: EditorialRepository | null = null;
  let editorialFailure: ServiceError['code'] = 'GIT_UNAVAILABLE';
  let research: ReturnType<typeof createResearchStore> | null = null;
  let knowledge: ReturnType<typeof createKnowledgeStore> | null = null;
  let knowledgeEditor: ReturnType<typeof createKnowledgeEditor> | null = null;
  let knowledgeImports:ReturnType<typeof createKnowledgeImports>|null=null;
  let navigation:ReturnType<typeof createNavigationContexts>|null=null;
  let wikipedia:Awaited<ReturnType<typeof createWikipediaWorkspace>>|null=null;
  let summaries: ReturnType<typeof createContentSummaries> | null = null;
  let models: ReturnType<typeof createModelStore> | null = null;
  const emit = (progress: OperationProgress) => { try { options.onProgress?.(progress); } catch { /* Observers do not control a transaction. */ } };

  if (initialization.ok && !initialization.value.datasets.length && options.seedPackagePath) {
    const drafts = await repository.listDrafts();
    if (drafts.ok && !drafts.value.length) {
      const imported = await loadDataPackageFile(options.seedPackagePath, 'publish');
      if (!imported.ok || !imported.package) initialization = { ok: false, error: { code: 'VALIDATION_FAILED' } };
      else {
        const data = imported.package;
        const created = await repository.createDraft({ package: data, baseRevision: null, operationId: `seed-create-${data.revision.id}` });
        if (!created.ok) initialization = created;
        else {
          const review: ReviewDecision = { reviewer: 'GitWorld packaged dataset', reviewedAt: data.revision.createdAt, evidenceReviewed: true, rightsReviewed: true, note: 'Import the reviewed dataset bundled with this application through the normal publication validator.' };
          const published = await repository.publishDraft({ draftId: created.value.id, expectedVersion: created.value.version, operationId: `seed-publish-${data.revision.id}`, review });
          initialization = published.ok ? await repository.initialize() : published;
        }
      }
    }
  }

  async function openEditorialStores() {
    wikipedia=null;research = null; knowledge = null; knowledgeEditor = null; summaries = null; models = null;
    if (!options.gitExecutable || !initialization.ok) return;
    try {
      editorial = await createEditorialRepository({ dataDirectory: options.dataDirectory, gitExecutable: options.gitExecutable, identity: (await settings.load()).values.contributor, onWriteProgress:progress=>emit({operationId:writeOperationId,stage:'writing',...progress}), ...(options.gitExecPath ? { gitExecPath: options.gitExecPath } : {}) });
      const seeds: Record<string, EditorialJson> = bundledKnowledge ? knowledgeCollectionSeedFiles(bundledKnowledge.collection) : {};
      const legacyCatalog=await loadLegacyFieldCatalog(options.dataDirectory,bundledKnowledge?.legacyFieldCatalog);
      if(bundledKnowledge){
        const artifact={schemaVersion:1 as const,kind:'gitworld-knowledge-import' as const,collection:bundledKnowledge.collection,
          vocabulary:{id:`bundled:${bundledKnowledge.manifest.id}`,revision:options.seedKnowledgeBundle!.expectedManifestHash,catalog:bundledKnowledge.fieldCatalog,
            origin:{identity:{provider:'gitworld-bundled-catalog',externalId:bundledKnowledge.manifest.id},url:'https://github.com/samar1tan/GitWorld',retrievedAt:new Date().toISOString(),rights:{redistribution:'unknown' as const},evidence:[]}}};
        for(const change of planKnowledgeVocabulary(seeds,artifact,knowledgeArtifactHash(artifact)).changes)if(change.value!==null)seeds[change.path]=change.value;
      }
      for (const dataset of initialization.value.datasets) if (dataset.activeRevisionId) seeds[modelPath(dataset.id)] = unwrap(await repository.getPublishedPackage({ datasetId: dataset.id, revisionId: dataset.activeRevisionId })) as unknown as EditorialJson;
      if(bundledKnowledge?.navigation)Object.assign(seeds,navigationBootstrapSeedFiles(bundledKnowledge.navigation,{id:bundledKnowledge.manifest.id,manifestHash:options.seedKnowledgeBundle!.expectedManifestHash},seeds));
      await editorial.initialize(seeds);
      research = createResearchStore(editorial); knowledge = createKnowledgeStore(editorial, { fieldCatalog: legacyCatalog }); summaries = createContentSummaries(editorial);
      knowledgeEditor = createKnowledgeEditor(editorial, { dataDirectory: options.dataDirectory, catalog: legacyCatalog });
      knowledgeImports=createKnowledgeImports(editorial,knowledge,{dataDirectory:options.dataDirectory,legacy:legacyCatalog});
      navigation=createNavigationContexts(editorial,{dataDirectory:options.dataDirectory,imports:async()=>[...importStore().completedBatches(),...unwrap(await repository.knowledgeImportOperations()) as NavigationImportReceipt[]]});
      wikipedia=await createWikipediaWorkspace({dataDirectory:options.dataDirectory,repository:editorial,imports:knowledgeImports,fetch:options.sourceFetch});
      models = createModelStore(editorial, { dataDirectory: options.dataDirectory, getDraft: async id => unwrap(await repository.getDraft(id)) });
    } catch (error) { wikipedia=null;editorialFailure = error instanceof EditorialFailure ? error.code : 'IO_ERROR';await navigation?.close();navigation=null;await knowledgeImports?.close();knowledgeImports=null;await knowledgeEditor?.close();knowledgeEditor=null;await models?.close();models=null; await editorial?.close(); editorial = null;research=null;knowledge=null;summaries=null; }
  }
  await openEditorialStores();
  async function closeStores() { wikipedia=null;await navigation?.close();navigation=null;await knowledgeImports?.close();knowledgeImports=null;await models?.close(); models = null; await knowledgeEditor?.close(); knowledgeEditor = null; await editorial?.close(); editorial = null; research = null; knowledge = null; summaries = null; await repository.close(); }
  async function reopenStores() {
    repository = createSqliteRepository({ dataDirectory: options.dataDirectory });
    initialization = await repository.initialize(); if (!initialization.ok) throw new ServiceFailure(initialization.error);
    sourceArchive = await createSourceArchive(options.dataDirectory, { fetch: options.sourceFetch });
    await openEditorialStores(); if (options.gitExecutable && !editorial) return failure(editorialFailure);
    engines.clear();
  }
  const editing = () => editorial ?? failure(editorialFailure);
  const researchStore = () => research ?? failure(editorialFailure);
  const knowledgeStore = () => knowledge ?? failure(editorialFailure);
  const objectEditor = () => knowledgeEditor ?? failure(editorialFailure);
  const summaryStore = () => summaries ?? failure(editorialFailure);
  const modelStore = () => models ?? failure(editorialFailure);
  const importStore=()=>knowledgeImports??failure(editorialFailure);
  const navigationStore=()=>navigation??failure(editorialFailure);
  const invalidateContent = () => { knowledge?.invalidate(); summaries?.invalidate(); engines.clear(); };
  async function stageDependencies(paths:string[]) {
    const [knowledgePlan,working,staged]=await Promise.all([knowledgeStore().dependencies(paths),editing().snapshot({from:'working',prefixes:['objects/','sources/','navigation/']}),editing().snapshot({from:'staged',prefixes:['objects/','sources/','navigation/']})]);
    const contextPlan=navigationDependencies(working.files,staged.files,paths);
    return{selected:paths,required:[...new Set([...knowledgePlan.required,...contextPlan.required])],missing:[...new Set([...knowledgePlan.missing,...contextPlan.missing])]};
  }

  const file = (token: string, purpose: 'import' | 'export' | 'backup' | 'restore') => options.resolveFileToken(token, purpose) ?? failure('INVALID_REQUEST');
  async function knowledgeFile(token: string) {
    try { return await readSelectedKnowledgeCollectionFile(file(token, 'import')); }
    catch (error) {
      if (error instanceof ServiceFailure) throw error;
      const code = error instanceof Error ? error.message : '';
      throw new ServiceFailure({ code: code === 'KNOWLEDGE_FILE_READ_FAILED' ? 'IO_ERROR' : 'VALIDATION_FAILED', parameters: { reason: ['INVALID_KNOWLEDGE_COLLECTION_FILE','INVALID_KNOWLEDGE_IMPORT','INVALID_KNOWLEDGE_FIELD_CATALOG','KNOWLEDGE_FILE_TOO_LARGE','KNOWLEDGE_FILE_READ_FAILED'].includes(code) ? code : 'INVALID_KNOWLEDGE_COLLECTION_FILE' } });
    }
  }
  const getData = async (ref: DatasetRef): Promise<DataPackage> => {
    if ((ref.revisionId === 'working' || /^[a-f0-9]{40}$/.test(ref.revisionId)) && options.gitExecutable) {
      const data = structuredClone((await modelStore().read(ref.datasetId, ref.revisionId)).package);
      data.revision.id = ref.revisionId; data.history.id = ref.revisionId;
      return data;
    }
    return unwrap(await repository.getPublishedPackage(ref));
  };
  const engineFor = async (ref: DatasetRef): Promise<HistoryEngine> => {
    const key = `${ref.datasetId}\0${ref.revisionId}`;
    let engine = engines.get(key); if (!engine) { engine = createHistoryEngine((await getData(ref)).history); engines.set(key, engine); }
    return engine;
  };
  async function idempotent<T>(operationId: string, method: string, params: unknown, fn: () => Promise<T>): Promise<T> {
    const previous = unwrap(await repository.getOperation<T>(operationId, method, params)); if (previous !== null) return previous;
    if (running.has(operationId)) return failure('OPERATION_IN_PROGRESS');
    running.add(operationId); emit({ operationId, stage: 'queued' });
    try { const value = await fn(); const saved = unwrap(await repository.completeOperation(operationId, method, params, value)); emit({ operationId, stage: 'complete' }); return saved; }
    catch (error) { emit({ operationId, stage: 'failed', error: error instanceof ServiceFailure ? error.detail : { code: 'IO_ERROR' } }); throw error; }
    finally { running.delete(operationId); }
  }

  const commands = createWorkbenchCommands(async (method, params) => {
    const checked = validateServiceRequest({ protocolVersion: 1, requestId: 'workbench-operation', method, params });
    if (!checked.ok) return failure('INVALID_REQUEST');
    return await handle(checked.value) as never;
  });

  async function currentLibrarySummary() {
    const value = unwrap(await repository.initialize());
    if (!options.gitExecutable) return value;
    if (!editorial) return failure(editorialFailure);
    const catalog = await modelStore().catalog('working');
    return { ...value, datasets: catalog.models.map(model => ({ id: model.datasetId, name: model.name, activeRevisionId: model.headContentHash === null ? null : catalog.head })) };
  }
  async function handle(request: ServiceRequest): Promise<unknown> {
    // Recheck inside the serial mutation queue, including operations routed by commands.
    const pendingImports=knowledgeImports?.pendingOperationIds()??[];
    if(pendingImports.length&&['repository.commit','repository.switch','repository.checkout','repository.revert','repository.abortRevert','draft.publish','knowledge.saveEdit','knowledge.resolve','knowledge.adoptJob','collection.adopt','knowledge.fileAdopt','wikipedia.adopt','context.save','context.membershipPlan','context.applyMembership','context.resume'].includes(request.method)&&!((request.method==='knowledge.fileAdopt'||request.method==='wikipedia.adopt')&&pendingImports.includes(request.params.operationId)))throw new ServiceFailure({code:'REVIEW_REQUIRED',parameters:{reason:'paired-import-pending'}});
    const pendingNavigation=navigation?.pending()??[];
    if(pendingNavigation.length&&['repository.commit','repository.switch','repository.checkout','repository.revert','repository.abortRevert','draft.publish','knowledge.saveEdit','knowledge.resolve','knowledge.adoptJob','collection.adopt','knowledge.fileAdopt','wikipedia.adopt','knowledge.resumeImport','context.save','context.applyMembership'].includes(request.method)&&!((request.method==='context.save'||request.method==='context.applyMembership')&&pendingNavigation.some(value=>value.operationId===request.params.operationId)))throw new ServiceFailure({code:'REVIEW_REQUIRED',parameters:{reason:'navigation-operation-pending'}});
    const p = request.params;
    switch (request.method) {
      case 'context.list':return navigationStore().list(request.params);
      case 'context.get':return navigationStore().get(request.params);
      case 'context.save':{try{return await navigationStore().save(request.params);}finally{invalidateContent();}}
      case 'context.batches':return navigationStore().batches(request.params);
      case 'context.batchObjects':return navigationStore().batchObjects(request.params);
      case 'context.batchSources':return navigationStore().batchSources(request.params);
      case 'context.membershipPlan':return navigationStore().membershipPlan(request.params);
      case 'context.plan':return navigationStore().plan(request.params);
      case 'context.applyMembership':{try{return await navigationStore().apply(request.params);}finally{invalidateContent();}}
      case 'context.pending':return navigationStore().pending();
      case 'context.resume':{try{return await navigationStore().resume(request.params.operationId);}finally{invalidateContent();}}
      case 'library.status': return currentLibrarySummary();
      case 'model.catalog': return modelStore().catalog(request.params.revision);
      case 'model.read': return modelStore().read(request.params.datasetId, request.params.revision);
      case 'command.execute': return commands.execute(request.params);
      case 'command.complete': return commands.complete(request.params.input, request.params.context, request.params.contextTarget,request.params.scopeRevision);
      case 'revision.list': return unwrap(await repository.listRevisions(request.params.datasetId));
      case 'revision.get': return getData(request.params.dataset);
      case 'revision.activate': return unwrap(await repository.activateRevision(request.params.dataset, request.params.operationId));
      case 'query.execute': {
        const { dataset, context, input } = request.params;
        const engine = await engineFor(dataset);
        if (context.head && !engine.commits.has(context.head) || context.comparison?.some(id => !engine.commits.has(id))) return failure('UNKNOWN_REF');
        return 'command' in input ? executeCommand(engine, input.command, context) : executeIntent(engine, input.intent, context);
      }
      case 'query.complete': { const { dataset, input, context } = request.params; return completeCommand(await engineFor(dataset), input, context); }
      case 'workspace.load': return unwrap(await repository.loadWorkspace(request.params.workspaceId));
      case 'workspace.save': {
        const workspace = request.params.workspace;
        if (workspace.dataset.revisionId !== 'working' && !/^[a-f0-9]{40}$/.test(workspace.dataset.revisionId)) return unwrap(await repository.saveWorkspace(request.params));
        const refs = [workspace.head, ...(workspace.comparison ?? [])].filter(value => value !== null);
        if (refs.some(value => value.revisionId === 'working')) return failure('COMMITTED_REVISION_REQUIRED');
        const data = await getData(workspace.dataset), referenced: DataPackage[] = [];
        for (const revisionId of new Set(refs.map(value => value.revisionId))) if (revisionId !== workspace.dataset.revisionId) referenced.push(await getData({ datasetId: workspace.dataset.datasetId, revisionId }));
        return unwrap(await repository.saveWorkspace(request.params, data, referenced));
      }
      case 'clientState.load': return clientState.load(request.params.key);
      case 'clientState.save': return clientState.save(request.params);
      case 'settings.get': return settings.load();
      case 'settings.update': return settings.update(request.params);
      case 'settings.library': return settings.library();
      case 'collection.catalog': return structuredClone(COLLECTION_CATALOG);
      case 'collection.issues':return collectionAcquisition.issues(request.params);
      case 'collection.rebuildIssues':{const params=request.params;return idempotent(params.operationId,request.method,params,()=>collectionAcquisition.rebuildIssues({jobId:params.jobId,signal:controllers.get(params.operationId)?.signal,onProgress:progress=>emit({operationId:params.operationId,...progress})}));}
      case 'collection.jobs': return collectionAcquisition.list();
      case 'collection.acquire': return collectionAcquisition.acquire({ ...request.params, signal: controllers.get(request.params.operationId)?.signal, onProgress: value => emit({ operationId: request.params.operationId, ...value }) });
      case 'collection.preview': {
        const job = (await collectionAcquisition.list()).find(value => value.id === request.params.jobId); if (!job) return failure('NOT_FOUND');
        return knowledgeStore().previewCollection(await collectionAcquisition.read(job.id), { issues: job.issues, issueCount: job.issueCount }).preview;
      }
      case 'collection.adopt': {
        const params = request.params;
        return idempotent(params.operationId, request.method, params, async () => {
          const job = (await collectionAcquisition.list()).find(value => value.id === params.jobId); if (!job) return failure('NOT_FOUND');
          const result = await knowledgeStore().adopt({ collection: await collectionAcquisition.read(job.id), issues: job.issues, mode: job.provider === 'cliopatria' ? 'append-observations' : 'replace-object', review: params.review, expectedHead: params.expectedHead, expectedInputHash: params.expectedInputHash }); invalidateContent(); return result;
        });
      }
      case 'draft.list': return unwrap(await repository.listDrafts(request.params.datasetId));
      case 'draft.create': {
        if (request.params.baseRevision && /^[a-f0-9]{40}$/.test(request.params.baseRevision.revisionId)) await getData(request.params.baseRevision);
        return unwrap(await repository.createDraft(request.params));
      }
      case 'draft.get': return unwrap(await repository.getDraft(request.params.draftId));
      case 'draft.save': return unwrap(await repository.saveDraft(request.params));
      case 'draft.delete': return unwrap(await repository.deleteDraft(request.params));
      case 'draft.validate': { const draft = unwrap(await repository.getDraft(request.params.draftId)); return validateDataPackage(draft.package, 'publish').issues; }
      case 'draft.preview': {
        const draft = unwrap(await repository.getDraft(request.params.draftId));
        const result = validateDataPackage(draft.package, 'draft');
        const preview: DraftPreview = { before: draft.baseRevision, after: { datasetId: draft.package.dataset.id, revisionId: draft.package.revision.id }, added: [], changed: [], removed: [], issues: result.issues };
        if (!result.ok) return preview;
        const next = await buildContentManifest(result.value), previous = draft.baseRevision ? await buildContentManifest(await getData(draft.baseRevision)) : null;
        const before = new Map(previous?.objects.map(o => [`${o.kind}:${o.id}`, o.hash]) ?? []), after = new Map(next.objects.map(o => [`${o.kind}:${o.id}`, o.hash]));
        preview.added = [...after.keys()].filter(key => !before.has(key)); preview.removed = [...before.keys()].filter(key => !after.has(key)); preview.changed = [...after.keys()].filter(key => before.has(key) && before.get(key) !== after.get(key)); return preview;
      }
      case 'draft.publish': {
        if (!options.gitExecutable) return unwrap(await repository.publishDraft(request.params));
        const value = await modelStore().publish(request.params); invalidateContent(); return value;
      }
      case 'source.list': return unwrap(await repository.listSources());
      case 'repository.status': return editing().status();
      case 'repository.changes': return summaryStore().changes(request.params);
      case 'repository.diff': {
        const repo = editing(), status = await repo.status();
        const changes = request.params.mode === 'staged' ? status.staged : status.unstaged;
        const paths = request.params.paths ? new Set(request.params.paths) : null;
        const selected = paths ? changes.filter(value => paths.has(value.path)) : changes;
        const offset = request.params.offset ?? 0, limit = request.params.limit ?? 25, page = selected.slice(offset, offset + limit);
        if (!page.length) return { status, entries: [], total: selected.length, offset, limit };
        const names = [...new Set(page.flatMap(change => [change.path,...(change.path.startsWith('navigation/')?[change.path.split('/').slice(0,3).join('/')+'/definition.json']:[])]))], staged = `tree:${status.stagedTree}`;
        const [before, after] = await Promise.all([
          repo.snapshot({ from: request.params.mode === 'staged' ? status.head : staged, paths: names }),
          repo.snapshot({ from: request.params.mode === 'staged' ? staged : 'working', paths: names }),
        ]);
        return { status, entries: page.map(change => {const left=before.files[change.path]??null,right=after.files[change.path]??null,navigation=navigationChangeSummary(change.path,left,right,after.files[change.path.split('/').slice(0,3).join('/')+'/definition.json']??before.files[change.path.split('/').slice(0,3).join('/')+'/definition.json']);return{...change,before:left,after:right,...(navigation?{navigation}:{})};}), total: selected.length, offset, limit };
      }
      case 'repository.stagePlan': {const incomplete=[...importStore().pendingPaths(),...navigationStore().pendingPaths()].filter(path=>request.params.paths.includes(path));if(incomplete.length)return{selected:request.params.paths,required:[],missing:[],incomplete};return stageDependencies(request.params.paths);}
      case 'repository.stage': {
        if(importStore().pendingPaths().some(path=>request.params.paths.includes(path)))throw new ServiceFailure({code:'REVIEW_REQUIRED',parameters:{reason:'incomplete-paired-import'}});
        if(navigationStore().pendingPaths().some(path=>request.params.paths.includes(path)))throw new ServiceFailure({code:'REVIEW_REQUIRED',parameters:{reason:'navigation-operation-pending'}});
        const plan = await stageDependencies(request.params.paths);
        if (plan.required.length || plan.missing.length) throw new ServiceFailure({ code: 'REVIEW_REQUIRED', issues: [...plan.required, ...plan.missing].map(path => ({ code: 'DANGLING_REFERENCE', path, parameters: { reason: 'stage-dependency' } })) });
        const value = await editing().stage(request.params.paths.map(path => ({ path }))); summaries?.invalidate(); return value;
      }
      case 'repository.unstage': { const value = await editing().unstage(request.params.paths); summaries?.invalidate(); return value; }
      case 'repository.commit': {
        const repo = editing();
        // Validate the exact frozen staged objects, never the live working forms.
        const status = await repo.status(), staged = `tree:${status.stagedTree}`;
        if(importStore().pendingPaths().some(path=>status.staged.some(change=>change.path===path)))throw new ServiceFailure({code:'REVIEW_REQUIRED',parameters:{reason:'incomplete-paired-import'}});
        if (request.params.expectedTree !== undefined && request.params.expectedTree !== status.stagedTree) return failure('STAGE_CHANGED');
        try { await knowledgeStore().read(staged);const frozen=await repo.snapshot({from:staged,prefixes:['sources/','mappings/field-catalogs/','mappings/field-catalog-baselines/']});if(resolveKnowledgeVocabulary(frozen.files).conflicts.length)return failure('REVIEW_REQUIRED'); }
        catch { return failure('VALIDATION_FAILED'); }
        const conflicts = await knowledgeStore().conflicts();
        const conflictedObjects = new Set(conflicts.map(value => `objects/${createHash('sha256').update(canonicalJson(value.objectId)).digest('hex')}.json`));
        if (status.staged.some(value => value.path.startsWith('mappings/conflict-') || conflictedObjects.has(value.path))) return failure('REVIEW_REQUIRED');
        for (const path of await repo.list({ from: staged, prefix: 'models/' })) {
          const model = await repo.read(path, { from: staged });
          if (!validateDataPackage(model, 'draft').ok) return failure('VALIDATION_FAILED');
        }
        for (const path of await repo.list({ from: staged, prefix: 'research/' })) {
          const record = await repo.read(path, { from: staged });
          if (!record || !validResearchRecord(record)) return failure('VALIDATION_FAILED');
        }
        await repo.setIdentity((await settings.load()).values.contributor);
        const commit = await repo.commit({ ...request.params, expectedTree: status.stagedTree }); invalidateContent(); return commit;
      }
      case 'repository.log': return editing().log(request.params.limit);
      case 'repository.branch': return editing().createBranch(request.params.name);
      case 'repository.branches': return editing().branches();
      case 'repository.switch': { const value = await editing().switchBranch(request.params.name); invalidateContent(); return value; }
      case 'repository.checkout': { const value = await editing().checkoutDetached(request.params.oid); invalidateContent(); return value; }
      case 'repository.revert': { const value = await editing().revert(request.params); invalidateContent(); return value; }
      case 'repository.abortRevert': { const value = await editing().abortRevert(); invalidateContent(); return value; }
      case 'research.list': return researchStore().list();
      case 'research.get': return researchStore().get(request.params.id);
      case 'research.save': { const value = await researchStore().save(request.params.record, request.params.expectedHash); summaries?.invalidate(); return value; }
      case 'research.history': return researchStore().history(request.params.id);
      case 'research.readRevision': return researchStore().readRevision(request.params.id, request.params.oid);
      case 'knowledge.previewJob': return (await knowledgeStore().map(sourceArchive.snapshots(request.params.jobId))).preview;
      case 'knowledge.editContext': return objectEditor().editContext(request.params);
      case 'knowledge.saveEdit': {
        try { return await objectEditor().saveEdit(request.params); }
        finally { invalidateContent(); }
      }
      case 'knowledge.adoptJob': { const params=request.params;return idempotent(params.operationId,request.method,params,async()=>{const value=await knowledgeStore().adopt({...params,snapshots:sourceArchive.snapshots(params.jobId)});invalidateContent();return value;}); }
      case 'knowledge.filePreview': {
        const input=await knowledgeFile(request.params.fileToken);
        return {fileName:input.name,bytes:input.bytes,preview:input.artifact?await importStore().preview(input):knowledgeStore().previewCollection(input.collection,{issues:input.issues}).preview};
      }
      case 'knowledge.fileAdopt': {
        const params=request.params;
        return idempotent(params.operationId,request.method,params,async()=>{
          if(params.previewId){try{return await importStore().adopt(params,()=>knowledgeFile(params.fileToken));}finally{invalidateContent();}}
          const input=await knowledgeFile(params.fileToken);
          if(input.artifact)throw new ServiceFailure({code:'REVIEW_REQUIRED',parameters:{reason:'paired-preview-required'}});
          const value=await knowledgeStore().adopt({...params,collection:input.collection,mode:'append-observations'});
          invalidateContent();return value;
        });
      }
      case 'knowledge.pendingImports':return importStore().pending();
      case 'knowledge.resumeImport':{
        // The original file-adoption identity belongs to its import receipt, not a second generic method.
        try{return await importStore().resume(request.params);}finally{invalidateContent();}
      }
      case 'knowledge.query': {
        return navigationStore().readReady(request.params.revision,async()=>
          (await knowledgeStore().index(request.params.revision)).index.query(request.params.query));
      }
      case 'knowledge.object': return knowledgeStore().objectDetail(request.params.objectId,request.params.revision);
      case 'knowledge.state': return (await knowledgeStore().index(request.params.revision)).index.state(request.params.state);
      case 'knowledge.history': return (await knowledgeStore().index(request.params.revision)).index.history(request.params);
      case 'knowledge.diff': {
        const before = (await knowledgeStore().index(request.params.a.revision)).index, after = (await knowledgeStore().index(request.params.b.revision)).index;
        const a = before.state(request.params.a.state), b = after.state(request.params.b.state);
        const properties = [...new Set([...a.fields, ...b.fields].map(field => field.propertyId))].sort();
        const left = before.state({ ...request.params.a.state, propertyIds: properties }), right = after.state({ ...request.params.b.state, propertyIds: properties });
        return { a: left, b: right, fields: properties.map((propertyId, i) => { const before = left.fields[i], after = right.fields[i]; return { propertyId, before, after, kind: ['unknown','uncertain'].includes(before.status) || ['unknown','uncertain'].includes(after.status) ? 'unknown' : canonicalJson(before.values) === canonicalJson(after.values) ? 'same' : 'changed' }; }) };
      }
      case 'knowledge.conflicts': return importStore().annotateConflicts(await knowledgeStore().conflicts());
      case 'knowledge.resolve': { await knowledgeStore().resolve(request.params.objectId, request.params.choice, request.params.expectedHead); invalidateContent(); return editing().status(); }
      case 'source.search': {
        const { query, language, cursor, operationId } = request.params;
        const controller = controllers.get(operationId);
        if (!controller || controller.signal.aborted) return { ok: false, error: { code: 'CANCELLED', retryable: true } };
        // This route is an explicit foreground lookup, not a background crawler.
        return searchWikidataEntities({ query, language: language === 'zh' ? 'zh-hans' : 'en', cursor, interactive: true, signal: controller.signal }, { fetch: options.sourceFetch });
      }
      case 'source.jobs': return sourceArchive.list();
      case 'wikipedia.jobs':return (wikipedia??failure(editorialFailure)).jobs(request.params);
      case 'wikipedia.inspect':return (wikipedia??failure(editorialFailure)).inspect(request.params);
      case 'wikipedia.preview':return (wikipedia??failure(editorialFailure)).preview(request.params);
      case 'wikipedia.issues':return (wikipedia??failure(editorialFailure)).issues(request.params);
      case 'wikipedia.adopt':{try{return await(wikipedia??failure(editorialFailure)).adopt(request.params);}finally{invalidateContent();}}
      case 'wikipedia.collect':{
        const params=request.params,controller=controllers.get(params.operationId);if(!controller)return failure('CANCELLED');
        emit({operationId:params.operationId,stage:'acquiring',completed:0,total:1});
        const job=await(wikipedia??failure(editorialFailure)).collect(params,controller.signal);
        emit({operationId:params.operationId,stage:job.receipt.status==='complete'?'complete':'failed',completed:job.source?1:0,total:1});return job;
      }
      case 'source.record': {
        try { return await sourceArchive.record(request.params); }
        catch (error) {
          if (error instanceof Error && error.message === 'INVALID_REQUEST') return failure('INVALID_REQUEST');
          if (error instanceof Error && error.message === 'NOT_FOUND') return failure('NOT_FOUND');
          if (error instanceof Error && error.message === 'CHECKPOINT_INVALID') return failure('VALIDATION_FAILED');
          throw error;
        }
      }
      case 'source.collect': {
        const params = request.params, controller = controllers.get(params.operationId);
        if (!controller || controller.signal.aborted) return { ok: false, error: { code: 'CANCELLED', retryable: true } };
        emit({ operationId: params.operationId, stage: 'acquiring', completed: 0, total: params.entityIds.length });
        const result = await sourceArchive.collect(params, { signal: controller.signal, onProgress: progress => emit({ operationId: params.operationId, stage: progress.stage ?? 'acquiring', completed: progress.completed, total: progress.total }) });
        emit({ operationId: params.operationId, stage: result.ok && result.value.receipt.status === 'complete' ? 'complete' : 'failed' });
        return result;
      }
      case 'source.save': {
        const { source } = request.params;
        if (source.adapter !== 'met-open-access-v1' || Object.keys(source.settings).some(k => k !== 'objectIds') || typeof source.settings.objectIds !== 'string' || !/^\d+(?:\s*,\s*\d+)*$/.test(source.settings.objectIds)) return failure('INVALID_REQUEST');
        return unwrap(await repository.saveSource(source));
      }
      case 'source.acquire': {
        const params = request.params;
        return idempotent(params.operationId, request.method, params, async () => {
          const source = unwrap(await repository.listSources()).find(x => x.id === params.sourceId);
          if (!source || !source.enabled || source.adapter !== 'met-open-access-v1') return failure('NOT_FOUND');
          const controller = controllers.get(params.operationId);
          if (!controller || controller.signal.aborted) return failure('CANCELLED');
          emit({ operationId: params.operationId, stage: 'acquiring' });
          const acquired = await acquireMetObjects({ objectIds: String(source.settings.objectIds).split(',').map(x => Number(x.trim())), stagingDirectory: path.join(options.dataDirectory, 'quarantine'), signal: controller.signal });
          if (controller.signal.aborted) return failure('CANCELLED');
          const preview: ImportPreview = { importId: params.operationId, inputHash: await contentHash(acquired.package ?? acquired.report), package: acquired.package, issues: [...acquired.report.issues, ...acquired.report.publicationIssues] };
          return unwrap(await repository.saveImport(preview, { id: params.operationId, method: request.method, input: params }));
        });
      }
      case 'import.preview': {
        const params = request.params;
        return idempotent(params.operationId, request.method, params, async () => {
          emit({ operationId: params.operationId, stage: 'validating' });
          const imported = await loadDataPackageFile(file(params.fileToken, 'import'), 'shape');
          const preview: ImportPreview = { importId: params.operationId, inputHash: await contentHash(imported.package ?? imported.issues), package: imported.package, issues: [...imported.issues, ...(imported.package ? validateDataPackage(imported.package, 'publish').issues : [])] };
          return unwrap(await repository.saveImport(preview, { id: params.operationId, method: request.method, input: params }));
        });
      }
      case 'import.accept': {
        const params = request.params, preview = unwrap(await repository.getImport(params.importId));
        if (!preview.package) return failure('VALIDATION_FAILED');
        return unwrap(await repository.createDraft({ package: preview.package, baseRevision: preview.package.revision.parentRevisionId ? { datasetId: preview.package.dataset.id, revisionId: preview.package.revision.parentRevisionId } : null, operationId: params.operationId }));
      }
      case 'export.revision': {
        const params = request.params;
        return idempotent(params.operationId, request.method, params, async () => {
          const data = await getData(params.dataset), destination = file(params.fileToken, 'export');
          const checked = validateDataPackage(data, 'publish'); if (!checked.ok) throw new ServiceFailure({ code: 'VALIDATION_FAILED', issues: checked.issues });
          const text = destination.toLowerCase().endsWith('.csv') ? exportPackageCsv(data) : `${JSON.stringify(data, null, 2)}\n`;
          await writeAtomic(destination, text); return { contentHash: await contentHash(data) };
        });
      }
      case 'backup.create': {
        const params = request.params;
        return idempotent(params.operationId, request.method, params, async () => { await clientState.load('locale'); await settings.load(); return createLibraryBackup({
          dataDirectory: options.dataDirectory, destinationPath: file(params.fileToken, 'backup'), signal: controllers.get(params.operationId)?.signal,
          sqliteSnapshot: async destination => unwrap(await repository.backup(destination, getData)),
          onProgress: value => emit({ operationId: params.operationId, stage: 'writing', completed: value.completed, ...(value.total === undefined ? {} : { total: value.total }) }),
        }); });
      }
      case 'backup.restore': {
        const params = request.params;
        if (initialization.ok) { const previous = unwrap(await repository.getOperation<unknown>(params.operationId, request.method, params)); if (previous !== null) return previous; }
        const source = file(params.fileToken, 'restore'), format = await detectLibraryBackup(source);
        if (format === 'sqlite') {
          if (editorial) throw new ServiceFailure({ code: 'REVIEW_REQUIRED', parameters: { reason: 'legacy-sqlite-import-required' } });
          const restored = unwrap(await repository.restore(source, { id: params.operationId, input: params })); engines.clear(); initialization = { ok: true, value: restored }; return restored;
        }
        if (format !== 'full') return failure('BACKUP_INVALID');
        let restored: unknown;
        await restoreLibraryBackup({
          dataDirectory: options.dataDirectory, sourcePath: source, signal: controllers.get(params.operationId)?.signal,
          validateSnapshot: async candidate => {
            const candidateStores: { git?: EditorialRepository } = {};
            try {
              const gitPresent = (await Promise.all(['editorial-owned.json', 'repository'].map(async name => {
                try { await lstat(path.join(candidate, name)); return true; }
                catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error; }
              }))).some(Boolean);
              if (gitPresent) {
                if (!options.gitExecutable) return failure('BACKUP_INVALID');
                candidateStores.git = await createEditorialRepository({ dataDirectory: candidate, gitExecutable: options.gitExecutable, ...(options.gitExecPath ? { gitExecPath: options.gitExecPath } : {}), requireExistingHead: true });
                await candidateStores.git.initialize();
              }
              await createClientStateStore(candidate).load('locale'); await createSettingsStore(candidate).load();validateKnowledgeImportDirectory(candidate);await validateKnowledgeVocabularyDirectory(candidate);await validateWikipediaWorkspaceDirectory(candidate);
              if(candidateStores.git)await validateNavigationDirectory(candidate,candidateStores.git);
              else {try{await lstat(path.join(candidate,'navigation.sqlite'));return failure('BACKUP_INVALID');}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}}
              const resolvePackage = async (reference: DatasetRef): Promise<DataPackage> => {
                if (!candidateStores.git) return failure('BACKUP_INVALID');
                const file = modelPath(reference.datasetId), snapshot = await candidateStores.git.snapshot({ from: reference.revisionId, paths: [file] });
                const checked = validateDataPackage(snapshot.files[file], 'draft');
                if (!checked.ok || checked.value.dataset.id !== reference.datasetId) return failure('BACKUP_INVALID');
                const data = structuredClone(checked.value); data.revision.id = reference.revisionId; data.history.id = reference.revisionId; return data;
              };
              const candidateDatabase = createSqliteRepository({ dataDirectory: candidate });
              unwrap(await candidateDatabase.validateBackup(path.join(candidate, 'library.sqlite'), resolvePackage));
            } catch { return failure('BACKUP_INVALID'); }
            finally { await candidateStores.git?.close(); }
          },
          beforeInstall: closeStores, beforeRollback: closeStores,
          afterInstall: async () => {
            await reopenStores();
            if (!initialization.ok) throw new ServiceFailure(initialization.error);
            restored = unwrap(await repository.completeOperation(params.operationId, request.method, params, await currentLibrarySummary()));
          },
          afterRollback: reopenStores,
          onProgress: value => emit({ operationId: params.operationId, stage: 'writing', completed: value.completed, ...(value.total === undefined ? {} : { total: value.total }) }),
        });
        emit({ operationId: params.operationId, stage: 'complete' });
        return restored;
      }
      case 'operation.cancel': { const controller = controllers.get(request.params.operationId); controller?.abort(); return { cancelled: !!controller }; }
    }
  }

  async function dispatch(input: ServiceRequest): Promise<ServiceResponse> {
      const checked = validateServiceRequest(input);
      const requestId = typeof input?.requestId === 'string' && input.requestId.length <= 128 ? input.requestId : 'invalid-request';
      if (!checked.ok) return { protocolVersion: 1, requestId, ok: false, error: { code: 'INVALID_REQUEST', issues: checked.issues } };
      if (closed) return { protocolVersion: 1, requestId, ok: false, error: { code: 'SERVICE_UNAVAILABLE' } };
      if (maintenancePending && checked.value.method !== 'operation.cancel') return { protocolVersion: 1, requestId, ok: false, error: { code: 'OPERATION_IN_PROGRESS' } };
      if (!initialization.ok && checked.value.method !== 'backup.restore') return { protocolVersion: 1, requestId, ok: false, error: initialization.error };
      try {
        const isMaintenance = checked.value.method === 'backup.create' || checked.value.method === 'backup.restore';
        if (isMaintenance && (acquisitionPending || sourceCollectionPending || controllers.size)) return { protocolVersion: 1, requestId, ok: false, error: { code: 'OPERATION_IN_PROGRESS' } };
        const maintenanceBarrier = isMaintenance ? Promise.allSettled([...pendingRequests]) : null;
        const readonly = ['library.status', 'revision.list', 'revision.get', 'model.catalog', 'model.read', 'command.complete', 'context.list','context.get','context.batches','context.batchObjects','context.batchSources','context.plan','context.pending','knowledge.query','knowledge.object','knowledge.state','knowledge.history','knowledge.diff', 'collection.issues', 'knowledge.filePreview', 'knowledge.pendingImports', 'wikipedia.jobs','wikipedia.inspect','wikipedia.preview','wikipedia.issues','query.execute', 'query.complete', 'workspace.load', 'draft.list', 'draft.get', 'draft.validate', 'draft.preview', 'source.list', 'source.search', 'source.jobs', 'source.record', 'operation.cancel'].includes(checked.value.method) || checked.value.method === 'command.execute' && readOnlyWorkbenchCommand(checked.value.params);
        if (!readonly && acquisitionPending) return { protocolVersion: 1, requestId, ok: false, error: { code: 'OPERATION_IN_PROGRESS' } };
        const isCollection = checked.value.method === 'source.collect' || checked.value.method === 'collection.acquire' || checked.value.method === 'collection.rebuildIssues'||checked.value.method==='wikipedia.collect';
        if (sourceCollectionPending && (isCollection || checked.value.method === 'backup.restore')) return { protocolVersion: 1, requestId, ok: false, error: { code: 'OPERATION_IN_PROGRESS' } };
        const acquisitionId = checked.value.method === 'source.acquire' || checked.value.method === 'source.search' || checked.value.method === 'source.collect' || checked.value.method === 'collection.acquire' || checked.value.method === 'collection.rebuildIssues'||checked.value.method==='wikipedia.collect' || checked.value.method === 'backup.create' || checked.value.method === 'backup.restore' ? checked.value.params.operationId : null;
        if (acquisitionId) {
          if (controllers.has(acquisitionId)) return { protocolVersion: 1, requestId, ok: false, error: { code: 'OPERATION_IN_PROGRESS' } };
          if (checked.value.method === 'source.acquire') acquisitionPending = true;
          if (isCollection) sourceCollectionPending = true;
          if (isMaintenance) maintenancePending = true;
          controllers.set(acquisitionId, new AbortController());
        }
        // Public-source fetching must not block local exploration/workspace persistence.
        const runMutation = async () => { if (maintenanceBarrier) await maintenanceBarrier;if(closed)return failure('CANCELLED');if(isCollection)return handle(checked.value);const previous=writeOperationId;writeOperationId='operationId' in checked.value.params?String(checked.value.params.operationId):'local-edit';try{return await handle(checked.value);}finally{writeOperationId=previous;} };
        const result = isCollection ? sourceCollectionTail.then(runMutation) : readonly ? handle(checked.value) : mutationTail.then(runMutation);
        if (isCollection) sourceCollectionTail = result.catch(() => undefined);
        else if (!readonly) mutationTail = result.catch(() => undefined);
        try { return structuredClone({ protocolVersion: 1, requestId, ok: true, result: await result }) as ServiceResponse; }
        finally { if (acquisitionId) { if (checked.value.method === 'source.acquire') acquisitionPending = false; if (isCollection) sourceCollectionPending = false; if (isMaintenance) maintenancePending = false; controllers.delete(acquisitionId); } }
      }
      catch (error) { return { protocolVersion: 1, requestId, ok: false, error: error instanceof ServiceFailure || error instanceof ModelFailure || error instanceof CollectionAcquisitionFailure || error instanceof KnowledgeEditorFailure ||error instanceof KnowledgeImportFailure||error instanceof WikipediaWorkspaceFailure||error instanceof NavigationFailure ? error.detail : error instanceof SettingsFailure ? { code: error.code } : error instanceof EditorialFailure ? { code: error.code } : error instanceof LibraryBackupFailure ? { code: error.code === 'RECOVERY_REQUIRED' ? 'IO_ERROR' : error.code } : error instanceof Error && ['INVALID_REQUEST','NOT_FOUND','VALIDATION_FAILED','CONFLICT','REVIEW_REQUIRED','OPERATION_IN_PROGRESS'].includes(error.message) ? { code: error.message as ServiceError['code'] } : { code: 'IO_ERROR' } }; }
  }
  return {
    dispatch(input: ServiceRequest): Promise<ServiceResponse> { const pending = dispatch(input); pendingRequests.add(pending); void pending.finally(() => pendingRequests.delete(pending)); return pending; },
    async close(): Promise<void> { closed = true; for (const controller of controllers.values()) controller.abort(); await Promise.allSettled([...pendingRequests]); await closeStores(); },
  };
}
