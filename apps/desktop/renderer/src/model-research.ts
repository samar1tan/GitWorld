import { createHistoryEngine, type DataPackage, type HistoryLocale } from '@gitworld/domain';
import type { PinnedResearchEvidence, ResearchComparisonEndpoint, ResearchContext } from '@gitworld/contracts';
import type { Workspace } from './state.ts';

/** Historical identity and editorial revision stay explicit when a model becomes research evidence. */
export function modelResearchContext(data:DataPackage,workspace:Workspace,revision:string,locale:HistoryLocale):ResearchContext {
  if(!/^[a-f0-9]{40}$/.test(revision))throw new Error('UNCOMMITTED_MODEL');
  const engine=createHistoryEngine(data.history),name=(value:{en:string;'zh-CN'?:string})=>value[locale]??value.en;
  const selectedId=workspace.view.panel==='snapshot'?workspace.head:workspace.view.selectedCommit??workspace.head;
  const ids=workspace.view.panel==='compare'&&workspace.comparison?workspace.comparison:[selectedId].filter((value):value is string=>!!value);
  if(!ids.length)throw new Error('HISTORICAL_STATE_REQUIRED');
  const evidence:PinnedResearchEvidence[]=[];
  function endpoint(id:string,requestedYear:number|null):ResearchComparisonEndpoint {
    const commit=engine.commits.get(id);if(!commit)throw new Error('UNKNOWN_REF');
    const snapshot=engine.snapshot(`commit:${id}`);if(!snapshot.ok)throw new Error(snapshot.error.code);
    for(const field of Object.values(snapshot.value.fields))for(const [index,entry] of (field.evidence??[]).entries()){
      const source=data.history.sources[entry.sourceId];
      evidence.push({id:`model:${data.dataset.id}:${id}:${field.fieldId}:${index}`,kind:'historical-state',title:`${name(commit.title)} · ${name(engine.fields.get(field.fieldId)?.name??{en:field.fieldId})}`,locator:entry.locator,repositoryRevision:revision,modelId:data.dataset.id,historicalRef:`commit:${id}`,year:requestedYear??commit.year,...(source?{url:source.url,...(source.sourceRevision?{sourceRevision:source.sourceRevision}:{})}:{})});
    }
    return {label:`${name(commit.title)} · ${requestedYear??commit.year}`,repositoryRevision:revision,modelId:data.dataset.id,historicalRef:`commit:${id}`,year:requestedYear??commit.year};
  }
  const selectedYear=workspace.view.panel==='snapshot'||!workspace.view.selectedCommit?workspace.headRequestedYear:workspace.view.requestedYear;
  const a=endpoint(ids[0],workspace.view.panel==='compare'?workspace.comparisonRequestedYears?.[0]??null:selectedYear),b=ids[1]?endpoint(ids[1],workspace.comparisonRequestedYears?.[1]??null):null;
  return {scope:{query:'',timeWindow:[...workspace.view.timeWindow],objectIds:[],fieldIds:[],label:name(data.dataset.name),model:{datasetId:data.dataset.id,repositoryRevision:revision,scopeId:workspace.view.scopeId,processId:workspace.view.processId}},evidence,comparison:b?{a,b}:null};
}
