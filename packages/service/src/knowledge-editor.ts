import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, isRecord } from '../../domain/src/index.ts';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeObject, type KnowledgeSource } from '../../domain/src/knowledge.ts';
import type { EditorialJson, EditorialRepository } from '../../contracts/src/editorial-types.ts';
import type { KnowledgeEditContext, KnowledgeSaveEditRequest, KnowledgeSaveEditResult } from '../../contracts/src/knowledge-editor-types.ts';
import type { KnowledgeFieldCatalog, KnowledgeObjectBundle } from '../../contracts/src/knowledge-workspace-types.ts';
import type { ServiceError } from '../../contracts/src/index.ts';
import { validKnowledgeSaveEdit } from '../../contracts/src/knowledge-editor-validation.ts';
import { createKnowledgeDisplayIndex, knowledgeSourceHeader } from './knowledge-display.ts';
import { resolveKnowledgeVocabulary } from './knowledge-vocabulary.ts';
import { SOURCE_PRESENTATIONS_PATH, readSourcePresentations } from './knowledge-source-presentations.ts';

export const MANUAL_KNOWLEDGE_ADAPTER = 'gitworld-local-amendment-v1';
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const objectPath = (id: string) => `objects/${digest(id)}.json`;
const sourcePath = (id: string) => `sources/${digest(id)}.json`;
const json = (value: unknown) => value as EditorialJson;
const contentId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\x00-\x1f]/.test(value);
export class KnowledgeEditorFailure extends Error {
  readonly detail: ServiceError;
  constructor(detail: ServiceError) { super(detail.code); this.detail = detail; }
}
const fail = (code: ServiceError['code'], field?: string): never => { throw new KnowledgeEditorFailure({ code, ...(field ? { parameters: { field } } : {}) }); };
type Prepared = { signature: string; object: KnowledgeObjectBundle; source: KnowledgeSource; expectedSources: Record<string,string>; result: KnowledgeSaveEditResult };
type Row = { signature: string; prepared_json: string; result_json: string | null };

/** Local edits use the ordinary object/source tree; imported baselines remain upstream-only. */
export function createKnowledgeEditor(repository: EditorialRepository, options: {
  dataDirectory: string; catalog?: KnowledgeFieldCatalog;
  /** Trusted fault injection for recovery tests; never an IPC option. */
  onFault?: (point: 'after-prepare' | 'after-write' | 'after-receipt') => void | Promise<void>;
}) {
  if (!path.isAbsolute(options.dataDirectory)) return fail('INVALID_REQUEST');
  const operations = new DatabaseSync(path.join(options.dataDirectory, 'knowledge-editor-operations.sqlite'));
  try { operations.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, signature TEXT NOT NULL, prepared_json TEXT NOT NULL, result_json TEXT)'); }
  catch { operations.close(); return fail('IO_ERROR'); }
  let tail: Promise<unknown> = Promise.resolve(), closed = false;
  async function snapshot() {
    const snapshot = await repository.snapshot({ from: 'working', prefixes: ['objects/','sources/','mappings/field-catalogs/','mappings/field-catalog-baselines/',SOURCE_PRESENTATIONS_PATH] });
    const collection: KnowledgeCollection = { schemaVersion: 1, objects: [], assertions: [], sources: [] };
    const bundles = new Map<string, KnowledgeObjectBundle>();
    for (const [file, value] of Object.entries(snapshot.files)) {
      if (file.startsWith('objects/')) {
        const bundle = value as unknown as KnowledgeObjectBundle;
        if (!bundle || bundle.schemaVersion !== 1 || !bundle.object || !Array.isArray(bundle.assertions) || file !== objectPath(bundle.object.id)) return fail('VALIDATION_FAILED');
        bundles.set(bundle.object.id, bundle); collection.objects.push(bundle.object); collection.assertions.push(...bundle.assertions);
      } else if(file.startsWith('sources/')) {
        const source = value as unknown as KnowledgeSource;
        if (!source || file !== sourcePath(source.id)) return fail('VALIDATION_FAILED'); collection.sources.push(source);
      }
    }
    const vocabulary=resolveKnowledgeVocabulary(snapshot.files,options.catalog);
    const index = createKnowledgeIndex(collection), catalog = structuredClone(vocabulary.catalog);
    const labels = new Map(collection.objects.map(object => [object.id, object.labels]));
    const properties = new Map(catalog.properties.map(value => [value.id, value])), types = new Map(catalog.types.map(value => [value.id, value]));
    for (const assertion of collection.assertions) if (!properties.has(assertion.propertyId)) properties.set(assertion.propertyId, { id: assertion.propertyId, labels: labels.get(assertion.propertyId) ?? { en: assertion.propertyId } });
    for (const object of collection.objects) for (const type of object.types) if (!types.has(type)) types.set(type, { id: type, labels: labels.get(type) ?? { en: type } });
    catalog.properties = [...properties.values()]; catalog.types = [...types.values()];
    return { ...snapshot, collection, bundles, index, catalog,vocabulary:vocabulary.presentation,sourcePresentations:readSourcePresentations(snapshot.files) };
  }
  async function editContext(input: { objectId?: string } = {}): Promise<KnowledgeEditContext> {
    if (input.objectId !== undefined && !contentId(input.objectId)) return fail('INVALID_REQUEST');
    const current = await snapshot(), formatter = createKnowledgeDisplayIndex(current.collection, current.catalog,current.vocabulary,current.sourcePresentations);
    const sources = formatter.sourceHeaders(new Set(current.collection.sources.map(source => source.id)));
    if (!input.objectId) return { head: current.head, object: null, objectHash: null, catalog: current.catalog, sources };
    const bundle = current.bundles.get(input.objectId), object = current.index.object(input.objectId);
    if (!bundle || !object) return fail('NOT_FOUND', 'objectId');
    const assertions = current.index.assertions(input.objectId), display = formatter.object(input.objectId, assertions, digest(current.files));
    const sourceIds = new Set(assertions.flatMap(assertion => [assertion.sourceSnapshotId, ...assertion.evidence.map(value => value.sourceId)]));
    for (const item of [...Object.values(display.values),...Object.values(display.objects).map(value => value.display)]) for (const text of Object.values(item)) for (const evidence of text.provenance) sourceIds.add(evidence.sourceId);
    return { head: current.head, objectHash: digest(bundle), catalog: current.catalog, sources,
      object: { object, assertions, display, sources: formatter.sourceHeaders(sourceIds), revision: 'working', working: true } };
  }
  async function prepare(input: KnowledgeSaveEditRequest): Promise<Prepared> {
    const current = await snapshot();
    if (current.head !== input.expectedHead) return fail('HEAD_CHANGED');
    const previous = input.objectId ? current.bundles.get(input.objectId) : undefined;
    if (input.objectId && !previous) return fail('NOT_FOUND', 'objectId');
    if ((previous ? digest(previous) : null) !== input.expectedObjectHash) return fail('CONTENT_CHANGED');
    if (!current.catalog.properties.some(value => value.id === input.change.propertyId)) return fail('VALIDATION_FAILED', 'propertyId');
    const c = input.change, original = c.mode === 'correct' ? previous!.assertions.find(assertion => assertion.id === input.assertionId) : undefined;
    if (c.mode === 'correct' && !original) return fail('NOT_FOUND', 'assertionId');
    const value = c.value === undefined ? structuredClone(original!.value) : structuredClone(c.value);
    if (c.value !== undefined && value.kind === 'entity' && !current.index.object(value.objectId)) return fail('NOT_FOUND', 'value.objectId');
    const selectedSourceId = 'sourceId' in c.evidence ? c.evidence.sourceId : null;
    const selectedSource = selectedSourceId ? current.collection.sources.find(source => source.id === selectedSourceId) : undefined;
    if ('sourceId' in c.evidence && !selectedSource) return fail('NOT_FOUND', 'evidence.sourceId');
    const objectUuid = randomUUID(), assertionId = original?.id ?? `local-assertion:${randomUUID()}`, sourceUuid = randomUUID(), sourceId = `local-amendment:${sourceUuid}`;
    const subject: KnowledgeObject = previous ? structuredClone(previous.object) : { id: `local-object:${objectUuid}`, identities: [{ provider: 'gitworld-local', externalId: objectUuid }], labels: structuredClone(c.mode === 'add' ? c.newObject!.labels : {}), descriptions: {}, aliases: [], types: c.mode === 'add' ? [...c.newObject!.types] : [] };
    if (!previous && subject.types.some(type => !current.catalog.types.some(entry => entry.id === type))) return fail('VALIDATION_FAILED', 'newObject.types');
    const assertion: KnowledgeAssertion = { ...(original ? structuredClone(original) : { qualifiers: [] }), id: assertionId, subjectId: subject.id, propertyId: c.propertyId, value, sourceSnapshotId: sourceId, review: c.review,
      evidence: [{ sourceId, locator: '$.amendment', citation: c.reason }, ...('sourceId' in c.evidence ? [{ sourceId: c.evidence.sourceId, locator: c.evidence.locator, ...(c.evidence.citation ? { citation: c.evidence.citation } : {}) }] : [{ sourceId, locator: c.evidence.locator, url: c.evidence.url, citation: c.evidence.citation ?? c.evidence.title }])] };
    if (c.validTime === null) delete assertion.validTime;
    else if (c.validTime !== undefined) assertion.validTime = structuredClone(c.validTime);
    const bundle: KnowledgeObjectBundle = { schemaVersion: 1, object: subject, assertions: previous ? previous.assertions.map(value => value.id === assertionId ? assertion : structuredClone(value)) : [] };
    if (!original) bundle.assertions.push(assertion);
    const originalSource = original ? current.collection.sources.find(source => source.id === original.sourceSnapshotId)! : undefined;
    const now = new Date().toISOString(), originalHeader = selectedSource ? knowledgeSourceHeader(selectedSource) : undefined;
    const record = { schemaVersion: 1, kind: 'gitworld-local-amendment', operationId: input.operationId, recordedAt: now,
      amendment: { mode: c.mode, objectId: subject.id, assertionId, reason: c.reason, review: c.review, originalObjectHash: input.expectedObjectHash, originalAssertion: original ? structuredClone(original) : null, originalAssertionHash: original ? digest(original) : null, originalSource: originalSource ? { id: originalSource.id, contentHash: originalSource.contentHash, revision: originalSource.revision } : null, resultingAssertionHash: digest(assertion) },
      reference: { ...structuredClone(c.evidence), ...(selectedSource ? { sourceSnapshotHash: selectedSource.contentHash } : {}) },
      manifest: { articleTitle: 'title' in c.evidence ? c.evidence.title : originalHeader?.title?.en ?? c.reason },
    };
    const source: KnowledgeSource = { id: sourceId, identity: { provider: 'gitworld-local', externalId: sourceUuid }, revision: input.operationId, contentHash: digest(record), retrievedAt: now, url: 'url' in c.evidence ? c.evidence.url : selectedSource!.url, adapterVersion: MANUAL_KNOWLEDGE_ADAPTER, rights: { redistribution: 'unknown' }, record };
    // Validate the runnable increment before any source/object file becomes visible.
    createKnowledgeIndex({ schemaVersion: 1, objects: [...current.collection.objects.filter(value => value.id !== subject.id), subject], assertions: [...current.collection.assertions.filter(value => value.subjectId !== subject.id), ...bundle.assertions], sources: [...current.collection.sources, source] });
    const supportingSources = new Set([...(selectedSource ? [selectedSource.id] : []), ...(original ? [original.sourceSnapshotId,...original.evidence.map(value => value.sourceId)] : [])]);
    const expectedSources = Object.fromEntries([...supportingSources].map(id => { const file = sourcePath(id), value = current.files[file]; if (value === undefined) return fail('VALIDATION_FAILED'); return [file,digest(value)]; }));
    return { signature: digest(input), object: bundle, source, expectedSources, result: { objectId: subject.id, assertionId, objectHash: digest(bundle), head: input.expectedHead, paths: [sourcePath(sourceId),objectPath(subject.id)] } };
  }
  function decode(row: Row, input: KnowledgeSaveEditRequest): Prepared {
    try {
      const value = JSON.parse(row.prepared_json) as Prepared;
      if (!value || value.signature !== digest(input) || !value.object || value.object.schemaVersion !== 1 || !value.object.object || !Array.isArray(value.object.assertions) || !value.source || !isRecord(value.source.record) || !isRecord(value.source.record.amendment) || value.source.record.kind !== 'gitworld-local-amendment' || value.source.record.operationId !== input.operationId || value.source.contentHash !== digest(value.source.record) || value.source.adapterVersion !== MANUAL_KNOWLEDGE_ADAPTER || !value.result || value.result.objectId !== value.object.object.id || value.result.head !== input.expectedHead || value.result.objectHash !== digest(value.object) || canonicalJson(value.result.paths) !== canonicalJson([sourcePath(value.source.id),objectPath(value.object.object.id)])) return fail('IO_ERROR');
      const assertion = value.object.assertions.find(assertion => assertion.id === value.result.assertionId);
      if (!assertion || assertion.sourceSnapshotId !== value.source.id || digest(assertion) !== value.source.record.amendment.resultingAssertionHash || !isRecord(value.expectedSources) || !Object.entries(value.expectedSources).every(([file,hash]) => /^sources\/[a-f0-9]{64}\.json$/.test(file) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) || row.result_json !== null && canonicalJson(JSON.parse(row.result_json)) !== canonicalJson(value.result)) return fail('IO_ERROR');
      return value;
    } catch { return fail('IO_ERROR'); }
  }
  async function save(input: KnowledgeSaveEditRequest): Promise<KnowledgeSaveEditResult> {
    if (closed) return fail('SERVICE_UNAVAILABLE');
    if (!validKnowledgeSaveEdit(input)) return fail('INVALID_REQUEST');
    const signature = digest(input);
    let row = operations.prepare('SELECT signature,prepared_json,result_json FROM edits WHERE id=?').get(input.operationId) as Row | undefined;
    if (row && row.signature !== signature) return fail('IDEMPOTENCY_CONFLICT');
    if (row?.result_json) return decode(row,input).result;
    if (!row) {
      const prepared = await prepare(input);
      operations.prepare('INSERT OR IGNORE INTO edits VALUES (?,?,?,NULL)').run(input.operationId, signature, canonicalJson(prepared));
      row = operations.prepare('SELECT signature,prepared_json,result_json FROM edits WHERE id=?').get(input.operationId) as Row;
      if (row.signature !== signature) return fail('IDEMPOTENCY_CONFLICT');
      if (row.result_json) return decode(row,input).result;
      await options.onFault?.('after-prepare');
    }
    const prepared = decode(row,input), [sourceFile,objectFile] = prepared.result.paths;
    const actual = await repository.snapshot({ from: 'working', paths: [sourceFile,objectFile] });
    const currentObject = actual.files[objectFile], currentSource = actual.files[sourceFile];
    const alreadyApplied = currentObject !== undefined && digest(currentObject) === prepared.result.objectHash && currentSource !== undefined && digest(currentSource) === digest(prepared.source);
    if (!alreadyApplied) {
      if (actual.head !== input.expectedHead) return fail('HEAD_CHANGED');
      if ((currentObject === undefined ? null : digest(currentObject)) !== input.expectedObjectHash) return fail('CONTENT_CHANGED');
      if (currentSource !== undefined && digest(currentSource) !== digest(prepared.source)) return fail('CONTENT_CHANGED');
      const changes = [...(currentSource === undefined ? [{ path: sourceFile, value: json(prepared.source) }] : []), { path: objectFile, value: json(prepared.object) }];
      await repository.write(changes, { expectedHead: input.expectedHead, expectedContentHashes: { ...prepared.expectedSources, [objectFile]: input.expectedObjectHash, [sourceFile]: currentSource === undefined ? null : digest(currentSource) } });
      await options.onFault?.('after-write');
    }
    operations.prepare('UPDATE edits SET result_json=? WHERE id=?').run(canonicalJson(prepared.result), input.operationId);
    await options.onFault?.('after-receipt');
    return prepared.result;
  }
  return {
    editContext,
    saveEdit(input: KnowledgeSaveEditRequest) { const next = tail.then(() => save(input)); tail = next.catch(() => undefined); return next; },
    async close() { if (closed) return; await tail; if (closed) return; closed = true; operations.close(); },
  };
}
