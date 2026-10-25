import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditorialRepository } from '../../storage/src/editorial.ts';
import { createResearchStore, validResearchRecord } from './research-store.ts';
import type { ResearchRecord } from '../../contracts/src/research-types.ts';
const binary=process.env.GITWORLD_TEST_GIT??fileURLToPath(new URL('../../../.local/bundled-git/runtime/bin/git',import.meta.url));
const record=(id:string):ResearchRecord=>({schemaVersion:1,id,title:'Technical fixed-label persistence fixture',scope:{query:'',timeWindow:[1336,1370],objectIds:['fixture:old'],fieldIds:[]},interpretation:'',openQuestions:[],evidence:[],comparison:{a:{label:'Original snapshot',objectId:'fixture:old',repositoryRevision:'1'.repeat(40),year:1336,includeUnreviewed:false},b:{label:'Later snapshot',objectId:'fixture:old',repositoryRevision:'2'.repeat(40),year:1370,includeUnreviewed:true}},updatedAt:'2026-10-25T00:00:00Z'});

test('optional snapshot names validate without changing scalar-only research records',()=>{
  const legacy=record('legacy');assert.equal(validResearchRecord(legacy),true);const value=record('labels');value.comparison!.a.labels={en:'Original snapshot','zh-CN':'固定旧名称'};assert.equal(validResearchRecord(value),true);
  for(const invalid of [[],{en:3},{en:'x'.repeat(1001)},{'not a language':'name'}]){const malformed=structuredClone(value);Object.assign(malformed.comparison!.a,{labels:invalid});assert.equal(validResearchRecord(malformed),false);}
});

test('snapshot name maps survive real working-tree save and repository restart with old scalar records intact',{skip:!existsSync(binary)&&'Build the pinned Git runtime.'},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gitworld-research-labels-'));let repository=await createEditorialRepository({dataDirectory:directory,gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core')});t.after(async()=>{await repository.close();await rm(directory,{recursive:true,force:true});});await repository.initialize();let store=createResearchStore(repository);
  const legacy=record('legacy'),labeled=record('labeled');labeled.comparison!.a.labels={en:'Original snapshot','zh-CN':'固定旧名称'};labeled.comparison!.b.labels={en:'Later snapshot'};await store.save(legacy,null);await store.save(labeled,null);await repository.close();
  repository=await createEditorialRepository({dataDirectory:directory,gitExecutable:binary,gitExecPath:path.resolve(binary,'../../libexec/git-core')});await repository.initialize();store=createResearchStore(repository);const saved=(await store.get('labeled')).record;assert.deepEqual(saved.comparison,labeled.comparison);assert.equal((await store.get('legacy')).record.comparison!.a.labels,undefined);assert.equal((await repository.status()).staged.length,0);
});
