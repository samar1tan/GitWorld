import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHistoryEngine, executeCommand, type DataPackage, type CommandExecution } from '@gitworld/domain';
import { initialWorkspace, navigate, returnOne, setWindow } from './state.ts';
import { createWorkbench } from './workbench-ui.ts';

const dataset=JSON.parse(readFileSync(new URL('../../../../data/seed/early-medieval.json',import.meta.url),'utf8')) as DataPackage;
const storage=new Map<string,string>();
Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
const engine=createHistoryEngine(dataset.history);

test('civil-year navigation supports newly imported periods and preserves fixed versions',()=>{
  const state={...initialWorkspace(),head:'qin-221',headRequestedYear:-220,comparison:['qin-221','west-843'] as [string,string]};
  const moved=setWindow(navigate(state,{scopeId:'east-asia',level:'region'}),-300,1200);
  assert.deepEqual(moved.view.timeWindow,[-300,1200]);assert.equal(moved.head,'qin-221');assert.deepEqual(moved.comparison,state.comparison);
  const returned=returnOne(moved);assert.equal(returned.view.level,'world');assert.equal(returned.head,'qin-221');
  assert.equal(setWindow(state,0,10),state);assert.equal(setWindow(state,10,1),state);
});

test('a query completed after navigation cannot replace the newer browsing state',async()=>{
  let state=initialWorkspace();let resolve!:(value:CommandExecution)=>void;
  const result=new Promise<CommandExecution>(r=>{resolve=r;});
  const workbench=createWorkbench({package:dataset,getState:()=>state,update:next=>{state=next;},render:()=>{},onError:error=>{throw error;},query:()=>result});
  const pending=workbench.execute('git checkout francia/west@843');
  state=navigate(state,{scopeId:'east-asia',level:'region'});
  resolve(executeCommand(engine,'git checkout francia/west@843',{head:null}));await pending;
  assert.equal(state.head,null);assert.equal(state.view.scopeId,'east-asia');
});

test('only the most recent command result may affect HEAD and disposed workbenches ignore responses',async()=>{
  let state=initialWorkspace();const resolvers:((value:CommandExecution)=>void)[]=[];
  const workbench=createWorkbench({package:dataset,getState:()=>state,update:next=>{state=next;},render:()=>{},onError:error=>{throw error;},query:()=>new Promise(r=>resolvers.push(r))});
  const first=workbench.execute('git checkout francia/west@843'),second=workbench.execute('git checkout japan/main@794');
  resolvers[0](executeCommand(engine,'git checkout francia/west@843',{head:null}));await first;assert.equal(state.head,null);
  resolvers[1](executeCommand(engine,'git checkout japan/main@794',{head:null}));await second;assert.equal(state.head,'japan-794');
  const third=workbench.execute('git checkout francia/west@843');workbench.dispose();resolvers[2](executeCommand(engine,'git checkout francia/west@843',{head:null}));await third;assert.equal(state.head,'japan-794');
});

test('query errors preserve the workspace without a static-data fallback',async()=>{
  let state=initialWorkspace();const original=state;let seen:unknown;
  const workbench=createWorkbench({package:dataset,getState:()=>state,update:next=>{state=next;},render:()=>{},onError:error=>{seen=error;},query:async()=>{throw new Error('SERVICE_UNAVAILABLE');}});
  await workbench.execute('git checkout francia/west@843');assert.equal(state,original);assert.equal((seen as Error).message,'SERVICE_UNAVAILABLE');
});
