import test from 'node:test';
import assert from 'node:assert/strict';
import { preparedInputHash } from './source-observation.ts';
import type { KnowledgeMappingPreview } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';

test('only an actual structurally valid version-2 prepared response supplies the progress hash', () => {
  const value: KnowledgeMappingPreview = { inputHash: 'a'.repeat(64), objects: 1, assertions: 1, datedAssertions: 1, locatedObjects: 0, issues: [], issueCount: 0, sample: [], mappingVersions: [] };
  assert.equal(preparedInputHash(value), undefined);
  value.prepared = { id: 'b'.repeat(64), fingerprintVersion: 2, baseHead: 'c'.repeat(40) };
  assert.equal(preparedInputHash(value), value.inputHash);
  for (const broken of [{ ...value, inputHash: 'A'.repeat(64) }, { ...value, inputHash: 'from-display-label' }, { ...value, prepared: { ...value.prepared, id: '' } }, { ...value, prepared: { ...value.prepared, baseHead: 'HEAD' } }, { ...value, prepared: { ...value.prepared, fingerprintVersion: 1 } }]) assert.equal(preparedInputHash(broken as KnowledgeMappingPreview), undefined);
});
