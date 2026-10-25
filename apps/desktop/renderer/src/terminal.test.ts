import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminal } from './terminal.ts';
import { createWorkbenchCommands } from '../../../../packages/service/src/workbench-commands.ts';
import { validPackage } from '../../../../packages/storage/src/test-fixtures.ts';
import { terminalCopy } from './terminal-copy.ts';
import type { EditorialStatus, NavigationMembershipPlan, WorkbenchCommandExecution, WorkbenchCommandRequest } from '../../../../packages/contracts/src/index.ts';
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};};
const status:EditorialStatus={head:'a'.repeat(40),branch:'main',stagedTree:'b'.repeat(40),staged:[],unstaged:[],conflicts:[],revert:null};
const result:WorkbenchCommandExecution={ok:true,command:'git status',effect:{type:'repository',operation:'status'},output:{kind:'repository-status',status}};
const viewResult:WorkbenchCommandExecution={ok:true,command:'git diff',effect:{type:'repository',operation:'diff'},output:{kind:'repository-diff',diff:{status,entries:[],total:0,offset:0,limit:40}}};
type Completions=Awaited<ReturnType<Parameters<typeof createTerminal>[0]['complete']>>;
function fixture(t:{after(fn:()=>unknown):void},execute:(request:WorkbenchCommandRequest)=>Promise<WorkbenchCommandExecution>,complete:Parameters<typeof createTerminal>[0]['complete']=async()=>[],locale:'en'|'zh-CN'='en'){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),external={},body={},document={activeElement:body as unknown,body};
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');});
  let focuses=0,version=0,changes=0;const buffers=new Map<string,string>(),listeners=new Map<string,(event:any)=>void>(),effects:boolean[]=[],outputs:WorkbenchCommandExecution[]=[],executions:WorkbenchCommandExecution[]=[],errors:unknown[]=[];
  const input={selectionStart:0,selectionEnd:0,value:'',matches:()=>true,focus(){document.activeElement=input;focuses++;},setSelectionRange(start:number,end:number){input.selectionStart=start;input.selectionEnd=end;}};
  const picker={innerHTML:'',hidden:true};
  const host={innerHTML:'',className:'',contains:(target:unknown)=>target===input,querySelector:(selector:string)=>selector==='[data-terminal-input]'?input:selector==='.command-completions'?picker:null,addEventListener:(name:string,listener:(event:any)=>void)=>listeners.set(name,listener)};
  const terminal=createTerminal({host:host as unknown as HTMLElement,locale:()=>locale,execute:async request=>{const value=await execute(request);executions.push(value);return value;},complete,status:()=>status,navigationVersion:()=>version,onResult:async(_result,allow)=>{effects.push(allow);outputs.push(_result);},onNavigationError:cause=>errors.push(cause),onChanges:()=>{changes++;},storage:{getItem:key=>buffers.get(key)??null,setItem:(key,value)=>{buffers.set(key,value);}}});
  const submit=()=>listeners.get('submit')!({preventDefault(){}});
  const enter=(value:string,isComposing=false)=>{input.value=value;document.activeElement=input;listeners.get('input')!({target:input,isComposing});};
  const press=(key:string)=>{let prevented=false;listeners.get('keydown')!({target:input,key,preventDefault(){prevented=true;}});return prevented;};
  const click=(action:string,index=0)=>listeners.get('click')!({target:{closest:()=>({dataset:{terminal:action,index:String(index)}})}});
  return{terminal,host,input,picker,submit,enter,press,effects,outputs,executions,errors,compose(start:boolean){listeners.get(start?'compositionstart':'compositionend')!({target:input});},clickCommand(command:string){listeners.get('click')!({target:{closest:()=>({dataset:{terminal:'fill',command}})}});},focuses:()=>focuses,stored:()=>JSON.parse(buffers.get('gitworld-terminal-v1')!),leave(){version++;document.activeElement=external;},openResult(index=0){click('result',index);},reviewChanges(){click('changes');},changes:()=>changes};
}
test('a late command keeps the next draft and cannot navigate or refocus a newer investigation',async t=>{
  const response=deferred<WorkbenchCommandExecution>(),f=fixture(t,()=>response.promise);f.terminal.fill('git diff');f.submit();assert.equal(f.terminal.isBusy(),true);
  f.enter('history --object "another" show 800');f.leave();const focuses=f.focuses();response.resolve(viewResult);await new Promise(setImmediate);
  assert.deepEqual(f.effects,[false]);assert.equal(f.focuses(),focuses);assert.equal(f.stored().draft,'history --object "another" show 800');assert.match(f.host.innerHTML,/Open result/);
  f.openResult();await new Promise(setImmediate);assert.deepEqual(f.effects,[false,true]);
  assert.equal(f.stored().draft,'history --object "another" show 800');
});

const settle=async(f:ReturnType<typeof fixture>)=>{for(let i=0;f.terminal.isBusy()&&i<30;i++)await new Promise(setImmediate);assert.equal(f.terminal.isBusy(),false);};
const latestEntry=(html:string)=>html.split('<article class="terminal-entry').at(-1)!;
function repositoryExecutor(){
  const calls:{method:string;params:unknown}[]=[],commits=[1,2].map(index=>({oid:String(index).repeat(40),parents:[],message:`Synthetic revision ${index}`,author:{name:'Test',email:'test@example.invalid'},authoredAt:'2026-10-25T00:00:00.000Z',branch:'main'}));
  const workbench=createWorkbenchCommands(async(method,params)=>{
    calls.push({method,params});
    if(method==='repository.log')return commits.slice(0,(params as {limit:number}).limit) as any;
    if(method==='repository.branches')return[{name:'main',oid:status.head,current:true}] as any;
    if(method==='repository.diff')return viewResult.ok&&viewResult.output.kind==='repository-diff'?structuredClone(viewResult.output.diff) as any:null;
    if(method==='repository.commit')return structuredClone(commits[0]) as any;
    assert.ok(['repository.status','repository.stage','repository.unstage','repository.branch','repository.switch','repository.checkout','repository.revert','repository.abortRevert'].includes(method));
    return structuredClone(status) as any;
  });
  return{workbench,calls};
}
test('status and editorial log render their real parser results without a dead Open result action in either locale',async t=>{
  for(const locale of ['en','zh-CN'] as const){
    const engine=repositoryExecutor(),f=fixture(t,request=>engine.workbench.execute(request),async()=>[],locale);
    f.terminal.fill('git status');f.submit();await settle(f);
    assert.equal(f.outputs[0].ok&&f.outputs[0].output.kind,'repository-status');
    assert.doesNotMatch(latestEntry(f.host.innerHTML),/data-terminal="result"/);assert.ok(f.host.innerHTML.includes(terminalCopy(locale,'changes')));
    f.enter('history --object "next" show 630');f.reviewChanges();assert.equal(f.changes(),1);assert.equal(engine.calls.length,1);assert.equal(f.stored().draft,'history --object "next" show 630');
    const callbacks=f.outputs.length;f.openResult();assert.equal(f.outputs.length,callbacks);
    f.terminal.fill('git log --limit 2');f.submit();await settle(f);
    const logged=f.executions.at(-1)!;assert.ok(logged.ok&&logged.output.kind==='repository-log');
    const entry=latestEntry(f.host.innerHTML);assert.doesNotMatch(entry,/data-terminal="result"|data-terminal="changes"/);assert.match(entry,/Synthetic revision 1/);assert.match(entry,/Synthetic revision 2/);
    assert.deepEqual(engine.calls.at(-1),{method:'repository.log',params:{limit:2}});f.openResult(1);assert.equal(f.outputs.length,callbacks+1);
  }
});
test('only repository commands with an existing Changes destination retain explicit result navigation',async t=>{
  for(const locale of ['en','zh-CN'] as const){
    const engine=repositoryExecutor(),f=fixture(t,request=>engine.workbench.execute(request),async()=>[],locale);
    const cases:[string,boolean][]=[['git branch',false],['git branch study',false],['git switch study',false],[`git checkout --detach ${status.head}`,false],['git add objects/record.json',true],['git restore --staged objects/record.json',true],['git diff --staged',true],['git commit -m "Synthetic review"',true],[`git revert ${status.head}`,true],['git revert --abort',true]];
    for(const [index,[command,actionable]] of cases.entries()){
      f.terminal.fill(command);f.submit();await settle(f);const value=f.executions.at(-1)!;assert.equal(value.ok,true,command);
      assert.equal(/data-terminal="result"/.test(latestEntry(f.host.innerHTML)),actionable,command);
      f.enter('help');const calls=engine.calls.length,callbacks=f.outputs.length;f.openResult(index);
      assert.equal(engine.calls.length,calls,command);assert.equal(f.outputs.length,callbacks+Number(actionable),command);assert.equal(f.stored().draft,'help');
      if(actionable){assert.equal(f.outputs.at(-1),value);assert.equal(f.effects.at(-1),true);}
    }
  }
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

test('a command response cannot clear a newly composing draft or submit it before composition ends',async t=>{
  const response=deferred<WorkbenchCommandExecution>();let calls=0;const f=fixture(t,()=>{calls++;return response.promise;});
  f.terminal.fill('git status');f.enter('git status');f.submit();assert.equal(calls,1);
  f.compose(true);response.resolve(result);await new Promise(setImmediate);
  assert.equal(f.stored().draft,'git status');f.submit();await new Promise(setImmediate);assert.equal(calls,1);
  assert.equal(f.press('ArrowUp'),false);assert.equal(f.stored().draft,'git status');
  f.compose(false);f.submit();await new Promise(setImmediate);assert.equal(calls,2);assert.equal(f.stored().draft,'');
});


function recoveryExecutor() {
  const data=validPackage(),revision='e'.repeat(40);data.dataset.id=data.history.datasetId='terminal-recovery-model';
  data.catalog.events=[{id:'split',title:{en:'Synthetic event'},summary:{en:'Technical fixture'},commitIds:['old','new'],sourceIds:['source']}];data.catalog.processes[0].eventIds=['split'];data.history.commits.forEach(value=>{value.eventId='split';});
  const independent=structuredClone(data.history.commits[0]);independent.id='independent';independent.year=50;independent.date={earliestYear:50,latestYear:50,precision:'year',calendar:'proleptic-gregorian'};independent.branchId='realm/independent';delete independent.eventId;
  data.history.commits.push(independent);data.history.branches.push({...data.history.branches[0],id:'realm/independent',commitIds:['independent'],coverage:[50,50]});data.catalog.processes[0].branchIds.push('realm/independent');
  const workbench=createWorkbenchCommands(async(method,params)=>{assert.equal(method,'model.read');const p=params as {datasetId:string;revision:string};assert.equal(p.datasetId,data.dataset.id);return{package:structuredClone(data),datasetId:data.dataset.id,revision:p.revision,head:status.head,path:'models/fixture.json',contentHash:'c'.repeat(64)} as any;});
  const prefix=`history --model ${data.dataset.id} --revision ${revision}`;
  return{workbench,prefix,revision,modelId:data.dataset.id};
}

test('historical model results expose view actions but direct help, status and listings do not',async t=>{
  for(const locale of ['en','zh-CN'] as const){
    const engine=recoveryExecutor(),f=fixture(t,request=>engine.workbench.execute(request),async()=>[],locale);
    const cases:[string,boolean][]=[['help',false],['status',false],['branch --all',false],['tag',false],['search Realm',false],['trace state:old',true],['log realm/main',true],['show state:old',true],['checkout state:old',true],['diff state:old..state:new',true],['blame state:new --field capital',true]];
    for(const [index,[suffix,actionable]] of cases.entries()){
      const command=engine.prefix+' '+suffix;f.terminal.fill(command);f.submit();await settle(f);const value=f.executions.at(-1)!;
      assert.equal(value.ok,true,command);assert.equal(/data-terminal="result"/.test(latestEntry(f.host.innerHTML)),actionable,command);
      f.enter('git status');const callbacks=f.outputs.length;f.openResult(index);assert.equal(f.outputs.length,callbacks+Number(actionable),command);assert.equal(f.stored().draft,'git status');
    }
    const compared=await engine.workbench.execute({input:{intent:{family:'history',target:{kind:'model',modelId:engine.modelId,revision:engine.revision},context:{head:null},intent:{type:'compare',a:{kind:'model',modelId:engine.modelId,revision:engine.revision,ref:'state:old'},b:{kind:'model',modelId:engine.modelId,revision:engine.revision,ref:'state:new'}}}}});
    assert.equal(compared.ok&&compared.effect.type,'model-compare');f.terminal.record(compared);assert.match(latestEntry(f.host.innerHTML),/data-terminal="result"/);
    const callbacks=f.outputs.length;f.openResult(cases.length);assert.equal(f.outputs.length,callbacks+1);assert.equal(f.outputs.at(-1),compared);assert.equal(f.stored().draft,'git status');
  }
});

test('object views, scope changes and membership plans keep their real destination while scope summaries stay inline',async t=>{
  const target={kind:'object' as const,objectId:'synthetic-object',revision:status.head},state={objectId:target.objectId,year:100,fields:[],untimedAssertionIds:[],unreviewedAssertionIds:[]};
  const batch={kind:'adopted-import' as const,method:'paired-import' as const,operationId:'synthetic-import',inputHash:'1'.repeat(64),objectSetHash:'2'.repeat(64)},batchKey='3'.repeat(64);
  const definition={schemaVersion:1 as const,id:'synthetic-context',labels:{en:'Synthetic context','zh-CN':'测试背景'},origin:'user-organization' as const};
  const plan:NavigationMembershipPlan={planId:'7'.repeat(64),planHash:'4'.repeat(64),baseHead:status.head,contextId:definition.id,contextHash:'5'.repeat(64),batch,objectSetHash:batch.objectSetHash,counts:{selected:1,already:0,added:1,removed:0,unchanged:0},mode:'add',dependencies:[],paths:['navigation/contexts/test.json']};
  const workbench=createWorkbenchCommands(async(method)=>{
    if(method==='knowledge.object')return{} as any;
    if(method==='knowledge.state')return structuredClone(state) as any;
    if(method==='knowledge.history')return{objectId:target.objectId,observations:[],changes:[],exceptions:[]} as any;
    if(method==='knowledge.diff')return{a:state,b:{...state,year:200},fields:[]} as any;
    if(method==='context.list')return{items:[{definition,contentHash:'6'.repeat(64),members:1}],total:1,offset:0,limit:40,revision:'working',head:status.head,counts:{objects:1,assigned:1,unassigned:0}} as any;
    if(method==='context.get')return{definition,contentHash:'6'.repeat(64),contextHash:plan.contextHash,revision:'working',head:status.head,members:[],total:1,offset:0,limit:1} as any;
    if(method==='context.batches')return{items:[{batchKey,batch,labels:{en:'Synthetic batch'},sourceRefs:[],sourceRefCount:0,objects:1,directObjects:1,relatedObjects:0,unresolvedObjects:0,status:'complete'}],total:1,offset:0,limit:1,revision:'working',head:status.head} as any;
    if(method==='context.membershipPlan'||method==='context.plan')return structuredClone(plan) as any;
    if(method==='context.save')return{contextId:definition.id,contentHash:'6'.repeat(64),head:status.head,paths:plan.paths} as any;
    if(method==='context.applyMembership')return{contextId:definition.id,head:status.head,paths:plan.paths,counts:plan.counts,planId:plan.planId} as any;
    throw Error(`Unexpected method ${method}`);
  });
  const prefix=`history --object ${target.objectId} --revision ${target.revision}`;
  const cases:[string,boolean][]=[['help',false],[prefix+' show 100',true],[prefix+' checkout 100',true],[prefix+' log',true],[prefix+' diff 100 200',true],['scope contexts',false],[`scope context ${definition.id}`,false],['scope batches',false],['scope use --all',true],['scope filter --from 100 --to 200',true],['scope reset',true],[`scope assign --context ${definition.id} --batch ${batchKey}`,true],['scope create --name "Synthetic context" --language en',false],[`scope apply ${plan.planId}`,false]];
  for(const locale of ['en','zh-CN'] as const){
    const f=fixture(t,request=>workbench.execute(request),async()=>[],locale);
    for(const [index,[command,actionable]] of cases.entries()){
      f.terminal.fill(command);f.submit();await settle(f);const value=f.executions.at(-1)!;assert.equal(value.ok,true,command);
      assert.equal(/data-terminal="result"/.test(latestEntry(f.host.innerHTML)),actionable,command);
      f.enter('git status');const callbacks=f.outputs.length;f.openResult(index);assert.equal(f.outputs.length,callbacks+Number(actionable),command);assert.equal(f.stored().draft,'git status');
    }
  }
});

test('error recovery clicks only fill a bound command; explicit Run executes the actual model parser in both locales',async t=>{
  for(const locale of ['en','zh-CN'] as const){
    const engine=recoveryExecutor(),failed=await engine.workbench.execute({input:{command:engine.prefix+' show event:split'}});assert.equal(failed.ok,false);if(failed.ok)throw Error('Expected ambiguity');
    const action=failed.error.recoveryActions![0];assert.equal(action.kind,'model-state');if(action.kind!=='model-state')throw Error('Wrong recovery');
    const requests:WorkbenchCommandRequest[]=[],f=fixture(t,async request=>{requests.push(request);return engine.workbench.execute(request);},async()=>[],locale);f.terminal.record(failed);
    assert.ok(f.host.innerHTML.includes(terminalCopy(locale,'inspectCandidate',{ref:action.reference.ref})));assert.doesNotMatch(f.host.innerHTML,/data-command="commit:/);
    f.clickCommand(action.command);assert.equal(requests.length,0);assert.deepEqual(f.effects,[]);assert.equal(f.stored().draft,action.command);assert.ok(f.stored().draft.includes(engine.revision));assert.ok(!f.stored().draft.includes(status.head));
    f.submit();for(let i=0;f.terminal.isBusy()&&i<20;i++)await new Promise(setImmediate);
    assert.equal(requests.length,1);assert.deepEqual(f.effects,[true]);const shown=f.outputs[0];assert.ok(shown.ok&&shown.output.kind==='model'&&shown.output.execution.output.kind==='snapshot');assert.equal(shown.output.target.modelId,engine.modelId);assert.equal(shown.output.target.revision,engine.revision);assert.equal(shown.output.execution.effect.type,'preview');
  }
});

test('endpoint recovery retains its A to B operation and bare aliases/templates never become command buttons',async t=>{
  for(const locale of ['en','zh-CN'] as const){
    const engine=recoveryExecutor(),failed=await engine.workbench.execute({input:{command:engine.prefix+' diff state:new...state:independent'}});assert.equal(failed.ok,false);if(failed.ok)throw Error('Expected no base');
    const action=failed.error.recoveryActions![0];assert.equal(action.kind,'model-endpoints');if(action.kind!=='model-endpoints')throw Error('Wrong recovery');
    const requests:WorkbenchCommandRequest[]=[],f=fixture(t,async request=>{requests.push(request);return engine.workbench.execute(request);},async()=>[],locale);f.terminal.record(failed);assert.ok(f.host.innerHTML.includes(terminalCopy(locale,'compareEndpoints')));
    f.clickCommand(action.command);assert.equal(requests.length,0);assert.deepEqual(f.effects,[]);f.submit();for(let i=0;f.terminal.isBusy()&&i<20;i++)await new Promise(setImmediate);
    const compared=f.outputs[0];assert.ok(compared.ok&&compared.output.kind==='model'&&compared.output.execution.output.kind==='diff');assert.equal(compared.output.execution.output.diff.a.commitId,'new');assert.equal(compared.output.execution.output.diff.b.commitId,'independent');assert.equal(compared.output.execution.output.diff.query?.mode,'endpoints');
    const checked=await engine.workbench.execute({input:{command:engine.prefix+' show HEAD'}}),template=await engine.workbench.execute({input:{command:'git show state:old'}});f.terminal.record(checked);f.terminal.record(template);
    assert.doesNotMatch(f.host.innerHTML,/data-command="CHECKED"/);assert.doesNotMatch(f.host.innerHTML,/data-command="history --model &lt;model-id&gt;/);assert.ok(f.host.innerHTML.includes('CHECKED'));assert.ok(f.host.innerHTML.includes('&lt;model-id&gt;'));
  }
});
