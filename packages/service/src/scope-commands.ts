import { parseYear, yearRef } from '../../domain/src/dates.ts';
import { validNavigationCommand } from '../../contracts/src/navigation-validation.ts';
import type { NavigationCommandIntent, NavigationScopePatch } from '../../contracts/src/navigation-types.ts';
import type { ServiceMethod, ServiceMethods, WorkbenchCommandError, WorkbenchCommandOutput, WorkbenchCommandRequest } from '../../contracts/src/index.ts';

type Invoke = <M extends ServiceMethod>(method:M,params:ServiceMethods[M]['params'])=>Promise<ServiceMethods[M]['result']>;
type Parsed = {intent:NavigationCommandIntent}|{error:WorkbenchCommandError};
const invalid=(subject='scope'):Parsed=>({error:{code:'INVALID_ARGUMENT',subject}});
export const SCOPE_HELP=[
  'scope contexts [--revision <working|oid>] [--offset <n>] [--limit 1..100]',
  'scope context <context-id> [--revision <working|oid>]',
  'scope create --name "name" --language <tag> [--name "name" --language <tag> ...] [--purpose "purpose" --purpose-language <tag> ...]',
  'scope use --context <context-id> [--revision <working|oid>] | --all | --unassigned',
  'scope filter [--from <year> --to <year>] [--type <type-id> | --all-types] [--text "literal"] [--review <unreviewed|adopted|rejected|none>]',
  'scope filter [--include-undated | --exclude-undated] [--include-unlocated | --exclude-unlocated] | scope reset',
  'scope batches [--revision <working|oid>] [--offset <n>] [--limit 1..100]',
  'scope assign --context <context-id> --batch <batch-key> [--revision <working|oid>] [--remove] [--reason "reason"]',
  'scope apply <plan-id>',
];
export function parseScopeCommand(words:string[],quoted:boolean[]=[]):Parsed {
  const [type,...args]=words,checked=(intent:unknown):Parsed=>validNavigationCommand(intent)?{intent}:invalid();
  const flags=new Map<string,string[]>(),positional:string[]=[];
  for(let i=0;i<args.length;i++){
    const flag=args[i];if(!flag.startsWith('--')){positional.push(flag);continue;}
    if(['--all','--unassigned','--remove','--all-types','--include-undated','--exclude-undated','--include-unlocated','--exclude-unlocated'].includes(flag)){if(flags.has(flag))return invalid(flag);flags.set(flag,[]);continue;}
    if(i+1>=args.length||args[i+1].startsWith('--')&&!quoted[i+2])return invalid(flag);
    const values=flags.get(flag)??[];values.push(args[++i]);flags.set(flag,values);
  }
  const allowed=(names:string[])=>[...flags.keys()].every(flag=>names.includes(flag));
  const one=(name:string)=>flags.get(name)?.length===1?flags.get(name)![0]:undefined;
  const single=(names:string[])=>names.every(name=>!flags.has(name)||flags.get(name)!.length===1);
  const revision=one('--revision'),offset=one('--offset'),limit=one('--limit');
  const pagination=()=>({...(revision?{revision}:{}),...(offset===undefined?{}:{offset:Number(offset)}),...(limit===undefined?{}:{limit:Number(limit)})});
  switch(type){
    case 'contexts':case 'batches':return positional.length||!allowed(['--revision','--offset','--limit'])||!single(['--revision','--offset','--limit'])?invalid():checked({type,...pagination()});
    case 'context':return positional.length!==1||!allowed(['--revision','--offset','--limit'])||!single(['--revision','--offset','--limit'])?invalid():checked({type,contextId:positional[0],...pagination()});
    case 'create':{
      const names=flags.get('--name')??[],languages=flags.get('--language')??[],purposes=flags.get('--purpose')??[];
      if(positional.length||!allowed(['--name','--language','--purpose','--purpose-language'])||!names.length||names.length!==languages.length||new Set(languages).size!==languages.length)return invalid();
      let purposeLanguages=flags.get('--purpose-language');
      if(purposeLanguages===undefined){if(purposes.length>1||purposes.length&&languages.length!==1)return invalid();purposeLanguages=purposes.length?[languages[0]]:[];}
      if(purposes.length!==purposeLanguages.length||new Set(purposeLanguages).size!==purposeLanguages.length)return invalid();
      return checked({type,labels:Object.fromEntries(languages.map((language,index)=>[language,names[index]])),...(purposes.length?{description:Object.fromEntries(purposeLanguages.map((language,index)=>[language,purposes[index]]))}:{})});
    }
    case 'use':{if(positional.length||!allowed(['--context','--all','--unassigned','--revision'])||!single(['--revision']))return invalid();const modes=Number(flags.has('--context'))+Number(flags.has('--all'))+Number(flags.has('--unassigned'));if(modes!==1)return invalid();return checked({type,selection:flags.has('--context')?{mode:'contexts',contextIds:flags.get('--context')}:flags.has('--unassigned')?{mode:'unassigned'}:{mode:'all'},...(revision?{revision}:{})});}
    case 'filter':{
      if(positional.length||!allowed(['--from','--to','--type','--all-types','--text','--review','--include-undated','--exclude-undated','--include-unlocated','--exclude-unlocated'])||!single(['--from','--to','--text'])||flags.has('--from')!==flags.has('--to')||flags.has('--type')&&flags.has('--all-types')||flags.has('--include-undated')&&flags.has('--exclude-undated')||flags.has('--include-unlocated')&&flags.has('--exclude-unlocated'))return invalid();
      const from=one('--from'),to=one('--to'),text=one('--text'),review=flags.get('--review');
      const a=from===undefined?undefined:parseYear(from),b=to===undefined?undefined:parseYear(to);if(a===null||b===null)return invalid('year');
      if(review?.includes('none')&&(review.length!==1||review[0]!=='none'))return invalid('--review');
      return checked({type,filters:{...(a!==undefined&&b!==undefined?{time:[a,b]}:{}),...(flags.has('--type')?{typeIds:flags.get('--type')}:flags.has('--all-types')?{typeIds:[]}:{}),...(text===undefined?{}:{text}),...(review?{review:review[0]==='none'?[]:review}:{}),...(flags.has('--include-undated')?{includeUndated:true}:flags.has('--exclude-undated')?{includeUndated:false}:{}),...(flags.has('--include-unlocated')?{includeUnlocated:true}:flags.has('--exclude-unlocated')?{includeUnlocated:false}:{})}});
    }
    case 'reset':return args.length?invalid():checked({type});
    case 'assign':return positional.length||!allowed(['--context','--batch','--revision','--remove','--reason'])||!single(['--context','--batch','--revision','--reason'])?invalid():checked({type,contextId:one('--context'),batchKey:one('--batch'),...(revision?{revision}:{}),...(flags.has('--remove')?{mode:'remove'}:{}),...(one('--reason')?{rationale:one('--reason')}:{})});
    case 'apply':return positional.length!==1||flags.size?invalid():checked({type,planId:positional[0]});
    default:return invalid(type);
  }
}
const quote=(value:string)=>JSON.stringify(value);
export function scopeCommandText(intent:NavigationCommandIntent):string {
  const rev=(value?:string)=>value?` --revision ${value}`:'';
  switch(intent.type){
    case 'contexts':case 'batches':return`scope ${intent.type}${rev(intent.revision)}${intent.offset===undefined?'':` --offset ${intent.offset}`}${intent.limit===undefined?'':` --limit ${intent.limit}`}`;
    case 'context':return`scope context ${quote(intent.contextId)}${rev(intent.revision)}${intent.offset===undefined?'':` --offset ${intent.offset}`}${intent.limit===undefined?'':` --limit ${intent.limit}`}`;
    case 'create':return`scope create ${Object.entries(intent.labels).map(([language,name])=>`--name ${quote(name)} --language ${language}`).join(' ')}${Object.entries(intent.description??{}).map(([language,purpose])=>` --purpose ${quote(purpose)} --purpose-language ${language}`).join('')}`;
    case 'use':return`scope use ${intent.selection.mode==='contexts'?intent.selection.contextIds.map(id=>`--context ${quote(id)}`).join(' '):intent.selection.mode==='unassigned'?'--unassigned':'--all'}${rev(intent.revision)}`;
    case 'filter':{
      const filters=intent.filters;
      return`scope filter${filters.time?` --from ${yearRef(filters.time[0])} --to ${yearRef(filters.time[1])}`:''}${filters.typeIds===undefined?'':filters.typeIds.length?filters.typeIds.map(id=>` --type ${quote(id)}`).join(''):' --all-types'}${filters.text===undefined?'':` --text ${quote(filters.text)}`}${filters.review===undefined?'':filters.review.length?filters.review.map(review=>` --review ${review}`).join(''):' --review none'}${filters.includeUndated===undefined?'':filters.includeUndated?' --include-undated':' --exclude-undated'}${filters.includeUnlocated===undefined?'':filters.includeUnlocated?' --include-unlocated':' --exclude-unlocated'}`;
    }
    case 'reset':return'scope reset';
    case 'assign':return`scope assign --context ${quote(intent.contextId)} --batch ${intent.batchKey}${rev(intent.revision)}${intent.mode==='remove'?' --remove':''}${intent.rationale?` --reason ${quote(intent.rationale)}`:''}`;
    case 'apply':return`scope apply ${intent.planId}`;
  }
}
export async function executeScopeCommand(intent:NavigationCommandIntent,request:WorkbenchCommandRequest,invoke:Invoke):Promise<{output:WorkbenchCommandOutput;patch?:NavigationScopePatch}|{error:WorkbenchCommandError}> {
  const revision=('revision'in intent?intent.revision:undefined)??request.scopeRevision??'working';
  switch(intent.type){
    case 'contexts':return{output:{kind:'scope-contexts',contexts:await invoke('context.list',{revision,...(intent.offset===undefined?{}:{offset:intent.offset}),...(intent.limit===undefined?{}:{limit:intent.limit})})}};
    case 'context':return{output:{kind:'scope-context',context:await invoke('context.get',{contextId:intent.contextId,revision,...(intent.offset===undefined?{}:{offset:intent.offset}),...(intent.limit===undefined?{}:{limit:intent.limit})})}};
    case 'batches':return{output:{kind:'scope-batches',batches:await invoke('context.batches',{revision,...(intent.offset===undefined?{}:{offset:intent.offset}),...(intent.limit===undefined?{}:{limit:intent.limit})})}};
    case 'create':{if(!request.operationId||!request.expectedHead)return{error:{code:'INVALID_ARGUMENT',subject:'reviewed-repository-state'}};return{output:{kind:'scope-saved',result:await invoke('context.save',{operationId:request.operationId,expectedHead:request.expectedHead,expectedContentHash:null,labels:intent.labels,...(intent.description?{description:intent.description}:{})})}};}
    case 'use':{if(intent.selection.mode==='contexts')for(const contextId of intent.selection.contextIds)await invoke('context.get',{contextId,revision,limit:1});else await invoke('context.list',{revision,limit:1});const patch:NavigationScopePatch={type:'selection',selection:intent.selection,...(intent.revision?{revision:intent.revision}:{})};return{output:{kind:'scope-change',patch},patch};}
    case 'filter':{const patch:NavigationScopePatch={type:'filters',filters:intent.filters};return{output:{kind:'scope-change',patch},patch};}
    case 'reset':{const patch:NavigationScopePatch={type:'reset'};return{output:{kind:'scope-change',patch},patch};}
    case 'assign':{if(!request.expectedHead)return{error:{code:'INVALID_ARGUMENT',subject:'reviewed-repository-state'}};const [context,batches]=await Promise.all([invoke('context.get',{contextId:intent.contextId,limit:1}),invoke('context.batches',{revision,batchKey:intent.batchKey,limit:1})]);const selected=batches.items[0];if(!selected)return{error:{code:'NOT_FOUND',subject:intent.batchKey}};return{output:{kind:'scope-plan',plan:await invoke('context.membershipPlan',{contextId:intent.contextId,expectedHead:request.expectedHead,expectedDefinitionHash:context.contentHash,batch:selected.batch,mode:intent.mode??'add',...(intent.rationale?{rationale:intent.rationale}:{})})}};}
    case 'apply':{if(!request.operationId)return{error:{code:'INVALID_ARGUMENT',subject:'operation-id'}};const plan=await invoke('context.plan',{planId:intent.planId,limit:1});if(intent.expectedPlanHash&&intent.expectedPlanHash!==plan.planHash)return{error:{code:'CONFLICT',subject:'navigation-plan-changed'}};return{output:{kind:'scope-applied',result:await invoke('context.applyMembership',{operationId:request.operationId,planId:intent.planId,expectedPlanHash:intent.expectedPlanHash??plan.planHash})}};}
  }
}
