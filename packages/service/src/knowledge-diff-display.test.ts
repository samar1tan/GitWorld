import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { EditorialJson, EditorialRepository, EditorialSnapshot } from '../../contracts/src/editorial-types.ts';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { expandKnowledgeDiffReferences, MAX_DIFF_REFERENCE_LABELS } from './knowledge-diff-display.ts';

const objectPath = (id: string) => `objects/${createHash('sha256').update(canonicalJson(id)).digest('hex')}.json`;
const snapshot = (source: string, files: EditorialSnapshot['files']): EditorialSnapshot => ({ source, head: '1'.repeat(40), tree: source === 'working' ? null : '2'.repeat(40), files });

test('name enrichment reads bounded exact paths and ignores entity-shaped raw source content', async () => {
  const subject = objectPath('subject'), rawOnly = { kind: 'raw', value: { kind: 'entity', objectId: 'raw-is-not-a-relation' } };
  const bundle: EditorialJson = { object: { id: 'subject', labels: { en: 'Subject' } }, assertions: Array.from({ length: 400 }, (_, index) => ({ id: String(index).padStart(3, '0'), value: { kind: 'entity', objectId: `target-${index}` }, qualifiers: [{ propertyId: 'raw', value: rawOnly }] })) };
  const after = snapshot('working', { [subject]: bundle }), before = snapshot('tree:' + '2'.repeat(40), {});
  const calls: { from?: string; paths?: string[]; prefixes?: string[] }[] = [];
  const repository = { async snapshot(request: { from?: string; paths?: string[]; prefixes?: string[] }) { calls.push(request); return request.from === 'working' ? after : before; } } as EditorialRepository;
  const result = await expandKnowledgeDiffReferences(repository, { before, after, paths: [subject], beforeRevision: before.source, afterRevision: after.source });
  assert.equal(calls.length, 2); assert.ok(calls.every(call => !call.prefixes && call.paths?.length === MAX_DIFF_REFERENCE_LABELS + 1));
  assert.ok(calls.every(call => !call.paths?.includes(objectPath('raw-is-not-a-relation'))));
  assert.equal((result.after.files[subject] as { assertions: unknown[] }).assertions.length, 400, 'The label limit must never omit actual differences.');
  assert.deepEqual(result.referenceLabels, { before: {}, after: {} });
});

test('side labels come from the same expanded snapshot as the returned values, with unresolved and wrong-identity names omitted', async () => {
  const file = objectPath('subject');
  const bundle = (target: string): EditorialJson => ({ object: { id: 'subject' }, assertions: [{ id: 'claim', value: { kind: 'text', value: 'unchanged' }, qualifiers: [{ propertyId: 'relation', value: { kind: 'entity', objectId: target } }] }] });
  const before = snapshot('tree:' + '2'.repeat(40), { [file]: bundle('old') }), after = snapshot('working', { [file]: bundle('initial') });
  const changed = snapshot('working', { [file]: bundle('later'), [objectPath('initial')]: { object: { id: 'wrong-id', labels: { en: 'Must not be borrowed' } } } });
  const repository = { async snapshot(request: { from?: string }) { return request.from === 'working' ? changed : before; } } as EditorialRepository;
  const result = await expandKnowledgeDiffReferences(repository, { before, after, paths: [file], beforeRevision: before.source, afterRevision: 'working' });
  assert.deepEqual(result.after.files[file], bundle('later'));
  assert.deepEqual(result.referenceLabels, { before: {}, after: {} });
  assert.ok(!JSON.stringify(result.referenceLabels).includes('Must not be borrowed'));
});
