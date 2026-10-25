import { createHash } from 'node:crypto';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { createKnowledgeIndex, type KnowledgeAssertion, type KnowledgeCollection, type KnowledgeJson, type KnowledgeSource, type KnowledgeTime } from '../../domain/src/knowledge.ts';
import { extractPublishedTables, parsePublishedTenure, type PublishedCell } from './mediawiki-tables.ts';
import { canonicalSourceJson } from './wikidata.ts';
import type { SourceRecordSnapshot } from './source-types.ts';

export const QUALIFIED_OFFICE_VERSION='qualified-office-endpoints-v1';
type Basis='de-jure'|'de-facto';
type Labels={en:string;'zh-CN':string};
export type QualifiedOfficeProfile={
  id:string;tableIndex:number;expectedHeaders:string[];holderColumn:number;startColumn:number;endColumn:number;
  contextId:string;contextType:string;fields:Record<Basis,{propertyId:string;labels:Labels}>;
};
export type QualifiedOfficePlan={
  schemaVersion:1;id:string;revision:string;url:string;source:{provider:'wikipedia-en';externalId:string;revision:string;upstreamSnapshotHash:string};
  tables:QualifiedOfficeProfile[];evidence:{url:string;locator:string;citation?:string}[];
};
export type QualifiedOfficeIssue={code:'HEADER_MISMATCH'|'CONTEXT_NOT_FOUND'|'CONTEXT_TYPE_MISMATCH'|'AMBIGUOUS_HOLDER'|'HOLDER_NOT_FOUND'|'UNQUALIFIED_BASIS'|'AMBIGUOUS_BASIS'|'UNPARSED_ENDPOINT'|'MISSING_ENDPOINT'|'AMBIGUOUS_ENDPOINTS'|'REVERSED_INTERVAL'|'SOURCE_CONFLICT'|'ASSERTION_CONFLICT';table?:number;holderCell?:string;basis?:Basis;cell?:string;assertionId?:string};
type Assignment='explicit-cell'|'column-heading'|'shared-rowspan'|'opposite-row-endpoint';
type Endpoint={side:'start'|'end';cell:PublishedCell;time:KnowledgeTime;basis?:Basis;assignment?:Assignment};
type FactCell={row:number;column:number;rowSpan:number;text:string;references:string[]};
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const anchor=(cell:Pick<PublishedCell,'row'|'column'>)=>`${cell.row}:${cell.column}`;
const fact=(cell:PublishedCell):FactCell=>({row:cell.row,column:cell.column,rowSpan:cell.rowSpan,text:cell.text,references:[...cell.references]});
function basis(text:string):Basis|'ambiguous'|undefined{
  const values=[...new Set([...text.matchAll(/\bde[\s-]+(jure|facto)\b/gi)].map(value=>`de-${value[1].toLowerCase()}`as Basis))];return values.length>1?'ambiguous':values[0];
}
function identity(cell:PublishedCell,known:Set<string>):{id:string|null;ambiguous:boolean}{
  const links=cell.links.some(link=>link.primary)?cell.links.filter(link=>link.primary):cell.links;
  const ids=new Set<string>();
  for(const link of links){try{const url=new URL(link.href,'https://en.wikipedia.org/');if(url.origin!=='https://en.wikipedia.org'||url.search||url.hash||!url.pathname.startsWith('/wiki/'))continue;const title=decodeURIComponent(url.pathname.slice(6));if(!title||title.includes(':'))continue;const id=`wikipedia-en:${title}`;if(known.has(id))ids.add(id);}catch{/* An unsupported source link is not an identity match. */}}
  return{id:ids.size===1?[...ids][0]:null,ambiguous:ids.size>1};
}
const compare=(a:KnowledgeTime,b:KnowledgeTime)=>a.earliestYear-b.earliestYear||(a.month??1)-(b.month??12)||(a.day??1)-(b.day??31);

/** Pairs explicitly qualified endpoints inside one source holder cell; names and physical row order do not pair terms. */
export function projectQualifiedOfficeEndpoints(input:KnowledgeCollection,snapshot:SourceRecordSnapshot,plan:QualifiedOfficePlan){
  createKnowledgeIndex(input);
  if(!plan||plan.schemaVersion!==1||!plan.id||!plan.revision||!plan.url||!plan.source||plan.source.provider!=='wikipedia-en'||!plan.source.externalId||!plan.source.revision||!/^[a-f0-9]{64}$/.test(plan.source.upstreamSnapshotHash)||!Array.isArray(plan.tables)||!plan.tables.length||new Set(plan.tables.map(value=>value.id)).size!==plan.tables.length||!Array.isArray(plan.evidence)||!plan.evidence.length||plan.evidence.some(item=>!item.url||!item.locator)||plan.tables.some(profile=>!profile.id||!Array.isArray(profile.expectedHeaders)||!profile.expectedHeaders.every(value=>typeof value==='string')||!Number.isInteger(profile.tableIndex)||profile.tableIndex<0||![profile.holderColumn,profile.startColumn,profile.endColumn].every(column=>Number.isInteger(column)&&column>=0)||profile.startColumn===profile.endColumn||!profile.contextId||!profile.contextType||!profile.fields||!['de-jure','de-facto'].every(key=>{const field=profile.fields[key as Basis];return field?.propertyId&&field.labels?.en&&field.labels['zh-CN'];})))throw new Error('INVALID_QUALIFIED_OFFICE_PLAN');
  const rawHash=createHash('sha256').update(canonicalSourceJson(snapshot.raw)).digest('hex');
  if(snapshot.identity.provider!==plan.source.provider||snapshot.identity.externalId!==plan.source.externalId||snapshot.sourceRevision!==plan.source.revision||snapshot.contentHash!==plan.source.upstreamSnapshotHash||rawHash!==snapshot.contentHash)throw new Error('SOURCE_SNAPSHOT_MISMATCH');
  if(snapshot.rights.redistribution!=='allowed'||snapshot.rights.licenseId!=='CC-BY-SA-4.0')throw new Error('SOURCE_RIGHTS_REVIEW_REQUIRED');
  const raw=snapshot.raw as any,parsed=raw.parse??raw,html=typeof parsed.text==='string'?parsed.text:parsed.text?.['*'];if(typeof html!=='string')throw new Error('INVALID_WIKIPEDIA_SOURCE');
  const tables=extractPublishedTables(html),objects=new Map(input.objects.map(value=>[value.id,value])),known=new Set(objects.keys()),issues:QualifiedOfficeIssue[]=[],facts:{profileId:string;table:number;holderId:string;holder:FactCell;endpoints:(FactCell&{side:'start'|'end';basis?:Basis;assignment?:Assignment;time:KnowledgeTime})[]}[]=[],terms:{profileId:string;table:number;holderId:string;contextId:string;basis:Basis;start:KnowledgeTime;end:KnowledgeTime;startCell:string;endCell:string;factIndex:number}[]=[];
  for(const profile of plan.tables){
    const table=tables.find(value=>value.index===profile.tableIndex),context=objects.get(profile.contextId);
    if(!table||canonicalJson(table.headers)!==canonicalJson(profile.expectedHeaders)){issues.push({code:'HEADER_MISMATCH',table:profile.tableIndex});continue;}
    if(!context){issues.push({code:'CONTEXT_NOT_FOUND',table:table.index});continue;}if(!context.types.includes(profile.contextType)){issues.push({code:'CONTEXT_TYPE_MISMATCH',table:table.index});continue;}
    const groups=new Map<string,{holder:PublishedCell;rows:typeof table.rows}>();
    for(const row of table.rows){const holder=row.grid[profile.holderColumn];if(!holder)continue;const key=anchor(holder),group=groups.get(key)??{holder,rows:[]};group.rows.push(row);groups.set(key,group);}
    for(const[holderCell,group]of groups){
      const match=identity(group.holder,known),holderId=match.id;if(!holderId){issues.push({code:match.ambiguous?'AMBIGUOUS_HOLDER':'HOLDER_NOT_FOUND',table:table.index,holderCell});continue;}
      const endpoints:Endpoint[]=[],seen=new Set<string>();
      for(const row of group.rows)for(const[side,column]of[['start',profile.startColumn],['end',profile.endColumn]]as const){
        const cell=row.grid[column];if(!cell||seen.has(`${side}:${anchor(cell)}`))continue;seen.add(`${side}:${anchor(cell)}`);
        const explicit=basis(cell.text),header=basis(table.headers[column]);
        if(explicit==='ambiguous'||!explicit&&header==='ambiguous'){issues.push({code:'AMBIGUOUS_BASIS',table:table.index,holderCell,cell:anchor(cell)});continue;}
        const cleaned=cell.text.replace(/\bde[\s-]+(?:jure|facto)\b/gi,'').trim(),parsed=parsePublishedTenure(cleaned);
        const time=parsed.validTime?.start,until=parsed.validTime?.end;
        if(parsed.issue||!time||!until||time.earliestYear!==until.latestYear||time.month!==until.month||time.day!==until.day){issues.push({code:'UNPARSED_ENDPOINT',table:table.index,holderCell,cell:anchor(cell)});continue;}
        time.raw=cell.text;
        endpoints.push({side,cell,time,...(explicit?{basis:explicit as Basis,assignment:'explicit-cell' as const}:header?{basis:header as Basis,assignment:'column-heading' as const}:{})});
      }
      const declared=endpoints.filter(value=>value.basis),assigned:Endpoint[]=[...declared];
      for(const endpoint of endpoints.filter(value=>!value.basis)){
        const covered=group.rows.filter(row=>row.index>=endpoint.cell.row&&row.index<endpoint.cell.row+endpoint.cell.rowSpan),opposite=declared.filter(value=>value.side!==endpoint.side&&covered.some(row=>row.index>=value.cell.row&&row.index<value.cell.row+value.cell.rowSpan));
        const bases=[...new Set(opposite.map(value=>value.basis!))];
        if(endpoint.cell.rowSpan>1&&bases.length||endpoint.cell.rowSpan===1&&bases.length===1){for(const value of bases)assigned.push({...endpoint,basis:value,assignment:endpoint.cell.rowSpan>1?'shared-rowspan':'opposite-row-endpoint'});}
        else issues.push({code:'UNQUALIFIED_BASIS',table:table.index,holderCell,cell:anchor(endpoint.cell)});
      }
      const factIndex=facts.length;facts.push({profileId:profile.id,table:table.index,holderId,holder:fact(group.holder),endpoints:assigned.map(value=>({...fact(value.cell),side:value.side,basis:value.basis,assignment:value.assignment,time:value.time}))});
      for(const value of['de-jure','de-facto']as const){
        const starts=assigned.filter(endpoint=>endpoint.basis===value&&endpoint.side==='start'),ends=assigned.filter(endpoint=>endpoint.basis===value&&endpoint.side==='end');if(!starts.length&&!ends.length)continue;
        if(starts.length!==1||ends.length!==1){issues.push({code:starts.length>1||ends.length>1?'AMBIGUOUS_ENDPOINTS':'MISSING_ENDPOINT',table:table.index,holderCell,basis:value});continue;}
        if(compare(starts[0].time,ends[0].time)>0){issues.push({code:'REVERSED_INTERVAL',table:table.index,holderCell,basis:value});continue;}
        terms.push({profileId:profile.id,table:table.index,holderId,contextId:context.id,basis:value,start:starts[0].time,end:ends[0].time,startCell:anchor(starts[0].cell),endCell:anchor(ends[0].cell),factIndex});
      }
    }
  }
  const title=String(parsed.title??snapshot.identity.externalId),permanent=snapshot.revisionUrl??`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&oldid=${snapshot.sourceRevision}`,history=`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=history`;
  const attribution=`${title}, English Wikipedia contributors. Permanent revision: ${permanent}. Author history: ${history}. GitWorld selected holder identities and authority-qualified endpoint cells; matched explicit bases across rowspans; retained precision and unresolved endpoints; inferred no political succession or office from a person's name. Article HTML, images and prose are excluded. No official endorsement.`;
  const record={schemaVersion:1,mappingVersion:QUALIFIED_OFFICE_VERSION,manifest:{provider:snapshot.identity.provider,externalId:snapshot.identity.externalId,revision:snapshot.sourceRevision,upstreamSnapshotHash:snapshot.contentHash,retrievedAt:snapshot.retrievedAt,permanentRevisionUrl:permanent,historyUrl:history,articleTitle:title,licenseId:'CC-BY-SA-4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',attribution,changes:['Selected linked holder identity and endpoint text/locators; excluded article HTML, prose and images.','Grouped only the same source holder cell; paired explicit authority bases rather than physical rows.','Produced separate unreviewed fields; retained unknown or competing endpoints.']},plan,facts};
  const contentHash=hash(record),source:KnowledgeSource={id:`wikipedia-qualified-office-facts:${snapshot.identity.externalId}@${contentHash}`,identity:{provider:'wikipedia-qualified-office-facts',externalId:snapshot.identity.externalId},revision:snapshot.sourceRevision,contentHash,retrievedAt:snapshot.retrievedAt,url:snapshot.url,revisionUrl:permanent,adapterVersion:QUALIFIED_OFFICE_VERSION,rights:{licenseId:'CC-BY-SA-4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',attribution,redistribution:'allowed'},record:structuredClone(record)as unknown as KnowledgeJson};
  const collection=structuredClone(input),priorSource=input.sources.find(value=>value.id===source.id),existing=new Map(input.assertions.map(value=>[value.id,value])),derivedAssertionIds:string[]=[];
  if(priorSource&&canonicalJson(priorSource)!==canonicalJson(source))issues.push({code:'SOURCE_CONFLICT'});else{
    if(!priorSource)collection.sources.push(source);
    for(const term of terms){const profile=plan.tables.find(value=>value.id===term.profileId)!,id=`qualified-office:${hash([plan.id,profile.id,snapshot.identity.externalId,term.holderId,term.startCell,term.endCell,term.basis]).slice(0,40)}`;
      const assertion:KnowledgeAssertion={id,subjectId:term.contextId,propertyId:profile.fields[term.basis].propertyId,value:{kind:'entity',objectId:term.holderId},qualifiers:[{propertyId:'office:authority-basis',value:{kind:'text',value:term.basis}},{propertyId:'qualified:source-holder-cell',value:{kind:'text',value:`table:${term.table};cell:${anchor(facts[term.factIndex].holder)}`}},{propertyId:'qualified:start-cell',value:{kind:'text',value:`table:${term.table};cell:${term.startCell}`}},{propertyId:'qualified:end-cell',value:{kind:'text',value:`table:${term.table};cell:${term.endCell}`}},{propertyId:'qualified:profile',value:{kind:'text',value:`${plan.id}@${plan.revision}:${term.profileId}`}}],evidence:[{sourceId:source.id,locator:`$.facts[${term.factIndex}]`,url:permanent},...plan.evidence.map(item=>({sourceId:source.id,...item}))],sourceSnapshotId:source.id,review:'unreviewed',validTime:{start:structuredClone(term.start),end:structuredClone(term.end)}};
      const prior=existing.get(id);if(prior&&canonicalJson(prior)!==canonicalJson(assertion)){issues.push({code:'ASSERTION_CONFLICT',assertionId:id});continue;}if(!prior){collection.assertions.push(assertion);existing.set(id,assertion);}derivedAssertionIds.push(id);
    }
  }
  createKnowledgeIndex(collection);
  const properties=new Map<string,Labels>();for(const profile of plan.tables)for(const field of Object.values(profile.fields))properties.set(field.propertyId,field.labels);
  for(const[id,display]of Object.entries({'office:authority-basis':{en:'Basis of authority','zh-CN':'权力依据'},'qualified:source-holder-cell':{en:'Source holder cell','zh-CN':'来源任职者单元格'},'qualified:start-cell':{en:'Source start cell','zh-CN':'来源起点单元格'},'qualified:end-cell':{en:'Source end cell','zh-CN':'来源终点单元格'},'qualified:profile':{en:'Endpoint mapping profile','zh-CN':'端点映射规则'}}))properties.set(id,display);
  return{collection,sourceId:source.id,mappingVersion:QUALIFIED_OFFICE_VERSION,derivedAssertionIds,terms,issues,fieldCatalog:{schemaVersion:1 as const,kind:'historical-field-display-labels' as const,properties:[...properties].map(([id,labels])=>({id,labels})),types:[],values:[{propertyId:'office:authority-basis',value:'de-jure',labels:{en:'De jure','zh-CN':'法理职衔'}},{propertyId:'office:authority-basis',value:'de-facto',labels:{en:'De facto','zh-CN':'实际行使职权'}}],semanticNotes:[{ids:plan.tables.flatMap(profile=>Object.values(profile.fields).map(field=>field.propertyId)),en:'These fields preserve the source’s authority classification. They do not establish an institution’s lifetime or political ancestry.','zh-CN':'这些字段保留来源的权力分类，不据此确定机构存续期或政治继承关系。'}]}};
}
