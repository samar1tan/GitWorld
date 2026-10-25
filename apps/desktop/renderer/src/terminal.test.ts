import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminal } from './terminal.ts';
import type { EditorialStatus, WorkbenchCommandExecution, WorkbenchCommandRequest } from '../../../../packages/contracts/src/index.ts';
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};};
const status:EditorialStatus={head:'a'.repeat(40),branch:'main',stagedTree:'b'.repeat(40),staged:[],unstaged:[],conflicts:[],revert:null};
const result:WorkbenchCommandExecution={ok:true,command:'git status',effect:{type:'repository',operation:'status'},output:{kind:'repository-status',status}};
type Completions=Awaited<ReturnType<Parameters<typeof createTerminal>[0]['complete']>>;
function fixture(t:{after(fn:()=>unknown):void},execute:(request:WorkbenchCommandRequest)=>Promise<WorkbenchCommandExecution>,complete:Parameters<typeof createTerminal>[0]['complete']=async()=>[]){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),external={},body={},document={activeElement:body as unknown,body};
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');});
  let focuses=0,version=0;const buffers=new Map<string,string>(),listeners=new Map<string,(event:any)=>void>(),effects:boolean[]=[],errors:unknown[]=[];
  const input={selectionStart:0,selectionEnd:0,value:'',matches:()=>true,focus(){document.activeElement=input;focuses++;},setSelectionRange(start:number,end:number){input.selectionStart=start;input.selectionEnd=end;}};
  const picker={innerHTML:'',hidden:true};
  const host={innerHTML:'',className:'',contains:(target:unknown)=>target===input,querySelector:(selector:string)=>selector==='[data-terminal-input]'?input:selector==='.command-completions'?picker:null,addEventListener:(name:string,listener:(event:any)=>void)=>listeners.set(name,listener)};
  const terminal=createTerminal({host:host as unknown as HTMLElement,locale:()=> 'en',execute,complete,status:()=>status,navigationVersion:()=>version,onResult:async(_result,allow)=>{effects.push(allow);},onNavigationError:cause=>errors.push(cause),onChanges:()=>{},storage:{getItem:key=>buffers.get(key)??null,setItem:(key,value)=>{buffers.set(key,value);}}});
  const submit=()=>listeners.get('submit')!({preventDefault(){}});
  const enter=(value:string,isComposing=false)=>{input.value=value;document.activeElement=input;listeners.get('input')!({target:input,isComposing});};
  const press=(key:string)=>{let prevented=false;listeners.get('keydown')!({target:input,key,preventDefault(){prevented=true;}});return prevented;};
  return{terminal,host,input,picker,submit,enter,press,effects,errors,focuses:()=>focuses,stored:()=>JSON.parse(buffers.get('gitworld-terminal-v1')!),leave(){version++;document.activeElement=external;},openResult(){listeners.get('click')!({target:{closest:()=>({dataset:{terminal:'result',index:'0'}})}});}};
}
test('a late command keeps the next draft and cannot navigate or refocus a newer investigation',async t=>{
  const response=deferred<WorkbenchCommandExecution>(),f=fixture(t,()=>response.promise);f.terminal.fill('git status');f.submit();assert.equal(f.terminal.isBusy(),true);
  f.enter('history --object "another" show 800');f.leave();const focuses=f.focuses();response.resolve(result);await new Promise(setImmediate);
  assert.deepEqual(f.effects,[false]);assert.equal(f.focuses(),focuses);assert.equal(f.stored().draft,'history --object "another" show 800');assert.match(f.host.innerHTML,/Open result/);
  f.openResult();await new Promise(setImmediate);assert.deepEqual(f.effects,[false,true]);
});
test('a successful response clears only its submitted draft while unchanged input can be reused after restart',async t=>{
  const response=deferred<WorkbenchCommandExecution>(),requests:WorkbenchCommandRequest[]=[],f=fixture(t,async input=>{requests.push(input);return response.promise;});
  f.terminal.fill('git status');f.submit();response.resolve(result);await new Promise(setImmediate);
  assert.equal(f.stored().draft,'');assert.equal(requests[0].expectedHead,status.head);assert.equal(requests[0].expectedTree,status.stagedTree);assert.ok(requests[0].operationId);
  f.enter('git diff --staged');f.terminal.beforeClose();assert.equal(f.stored().draft,'git diff --staged');assert.deepEqual(f.stored().history,['git status']);
});

test('Tab waits for the current prefix instead of accepting stale candidates and appends after the completed argument',async t=>{
  const first=deferred<Completions>(),second=deferred<Completions>(),f=fixture(t,async()=>result,input=>input.endsWith('Roman')?second.promise:first.promise);
  f.terminal.fill('history');f.enter('history --object R');first.resolve([{value:'history --object "old" ',label:{en:'Old'},kind:'ref'}]);await new Promise(setImmediate);
  assert.equal(f.picker.hidden,false);
  f.enter('history --object Roman');const inputMarkup=f.host.innerHTML;
  assert.equal(f.picker.hidden,true);assert.equal(f.press('Tab'),true);assert.equal(f.stored().draft,'history --object Roman');
  const value='history --object "new-roman-object" ';second.resolve([{value,label:{en:'Roman Republic'},kind:'ref'}]);await new Promise(setImmediate);
  assert.equal(f.host.innerHTML,inputMarkup);assert.equal(f.picker.hidden,false);f.press('Tab');
  assert.equal(f.stored().draft,value);assert.equal(f.input.selectionStart,value.length);assert.equal(f.input.selectionEnd,value.length);
});

test('Escape and explicit command replacement cancel pending completion replies',async t=>{
  const first=deferred<Completions>(),second=deferred<Completions>();let calls=0;
  const f=fixture(t,async()=>result,()=>++calls===1?first.promise:second.promise);f.terminal.fill('history');
  f.enter('history --object Tang');f.press('Escape');first.resolve([{value:'obsolete',label:{en:'Obsolete'},kind:'ref'}]);await new Promise(setImmediate);
  assert.equal(f.picker.hidden,true);assert.equal(f.stored().draft,'history --object Tang');
  f.enter('history --object Japan');f.terminal.fill('git status');second.resolve([{value:'obsolete-japan',label:{en:'Obsolete Japan'},kind:'ref'}]);await new Promise(setImmediate);
  assert.equal(f.picker.hidden,true);assert.equal(f.stored().draft,'git status');
});

test('input composition is retained without candidate requests or command-input replacement',async t=>{
  let calls=0;const response=deferred<Completions>(),f=fixture(t,async()=>result,()=>{calls++;return response.promise;});f.terminal.fill('history');
  const markup=f.host.innerHTML;f.enter('history --object 唐',true);assert.equal(calls,0);assert.equal(f.stored().draft,'history --object 唐');
  f.enter('history --object 唐');response.resolve([{value:'history --object "tang" ',label:{en:'Tang'},kind:'ref'}]);await new Promise(setImmediate);
  assert.equal(calls,1);assert.equal(f.host.innerHTML,markup);assert.equal(f.picker.hidden,false);
});
