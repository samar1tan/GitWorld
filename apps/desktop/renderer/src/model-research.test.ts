import test from 'node:test';
import assert from 'node:assert/strict';
import { validPackage } from '../../../../packages/storage/src/test-fixtures.ts';
import { initialWorkspace } from './state.ts';
import { modelResearchContext } from './model-research.ts';
const revision='a'.repeat(40);
test('a direct preview retains its own date rather than the previous checkout request',()=>{
  const state=initialWorkspace();state.head='old';state.headRequestedYear=-99;state.view.selectedCommit='new';state.view.requestedYear=null;
  const context=modelResearchContext(validPackage(),state,revision,'en');
  assert.ok(context.evidence.length);assert.ok(context.evidence.every(value=>value.year===100));
  assert.ok(context.evidence.every(value=>value.modelId==='test-world'&&value.historicalRef==='commit:new'&&value.repositoryRevision===revision));
});
test('a comparison preserves both explicit historical requests and the repository OID',()=>{
  const state=initialWorkspace();state.view.panel='compare';state.comparison=['old','new'];state.comparisonRequestedYears=[-99,100];
  const context=modelResearchContext(validPackage(),state,revision,'en');
  assert.equal(context.comparison?.a.year,-99);assert.equal(context.comparison?.b.year,100);assert.equal(context.comparison?.a.modelId,'test-world');assert.equal(context.comparison?.b.repositoryRevision,revision);
  assert.throws(()=>modelResearchContext(validPackage(),state,'working','en'),/UNCOMMITTED_MODEL/);
});
