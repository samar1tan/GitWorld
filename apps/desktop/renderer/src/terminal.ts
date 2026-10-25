import type { HistoryLocale, CommandCompletion, HistoryText } from '@gitworld/domain';
import type { WorkbenchCommandExecution, WorkbenchCommandRequest, EditorialStatus, WorkbenchRecoveryAction } from '@gitworld/contracts';
import { escapeHtml as esc } from './client.ts';
import { contextCopy } from './context-copy.ts';
import { knowledgeLocalizedText } from './knowledge-labels.ts';
import { terminalCopy as copy, type TerminalPlainCopyKey } from './terminal-copy.ts';
import { replaceChildrenAround, syncElementAttributes } from './retained-dom.ts';

type Options = {
  host: HTMLElement; locale:()=>HistoryLocale;
  execute:(request:WorkbenchCommandRequest)=>Promise<WorkbenchCommandExecution>;
  complete:(input:string)=>Promise<CommandCompletion[]>;
  onResult:(result:WorkbenchCommandExecution,allowNavigation:boolean)=>Promise<void>;
  navigationVersion:()=>number;
  onNavigationError:(cause:unknown)=>void;
  onChanges:()=>void|Promise<void>;
  status:()=>EditorialStatus|null;
  storage?: Pick<Storage,'getItem'|'setItem'>;
};
type Entry = { result:WorkbenchCommandExecution; request:WorkbenchCommandRequest|null };
const key='gitworld-terminal-v1';
const quote=(value:string)=>JSON.stringify(value);
function hasResultView(result:WorkbenchCommandExecution):boolean {
  if(!result.ok)return false;
  if(result.output.kind==='scope-plan')return true;
  const effect=result.effect;
  switch(effect.type){
    case 'repository':return ['add','unstage','diff','commit','revert','abort-revert'].includes(effect.operation);
    case 'model':return effect.effect.type!=='none';
    case 'scope':case 'model-compare':case 'object-preview':case 'object-checkout':case 'object-history':case 'object-compare':return true;
    case 'none':return false;
  }
  return false;
}
/** One command surface retains its input and meaning across all workbench activities. */
export function createTerminal(options:Options) {
  let expanded=false,draft='',history:string[]=[],historyIndex=0,busy=false,entries:Entry[]=[],completions:CommandCompletion[]=[];
  let completionIndex=-1,completionSequence=0,completing=false,loaded=false,composing=false;
  let rendered=false,renderedLocale:HistoryLocale|null=null,renderedExpanded=false,renderedBusy=false,renderedEntries:Entry[]|null=null;
  let renderedCompletions:CommandCompletion[]|null=null,renderedCompletionIndex=-1,renderedList:HTMLElement|null=null;
  const t=(name:TerminalPlainCopyKey)=>copy(options.locale(),name);
  const text=(value:HistoryText)=>value[options.locale()]??value.en;
  const short=(value:string)=>value.slice(0,8);
  const button=(action:string,label:string,extra='')=>`<button type="button" data-terminal="${action}" ${extra}>${esc(label)}</button>`;
  const fill=(command:string,label=command)=>button('fill',label,`data-command="${esc(command)}" title="${esc(command)}"`);
  function persist(){try{options.storage?.setItem(key,JSON.stringify({schemaVersion:1,expanded,draft,history:history.slice(-100)}));}catch{/* The host exposes persistence failure separately. */}}
  function hydrate(){if(loaded)return;loaded=true;try{const saved=JSON.parse(options.storage?.getItem(key)??'null');if(saved?.schemaVersion===1){expanded=saved.expanded===true;draft=typeof saved.draft==='string'?saved.draft.slice(0,4096):'';history=Array.isArray(saved.history)?saved.history.filter((v:unknown):v is string=>typeof v==='string'&&v.length<=4096).slice(-100):[];historyIndex=history.length;}}catch{/* Invalid recovery text does not execute a command. */}}
  function output(result:WorkbenchCommandExecution):string {
    if(!result.ok){
      const error=result.error,actions=error.recoveryActions??[],explanation=error.code==='AMBIGUOUS_REF'?t('ambiguousRef'):error.code==='MULTIPLE_COMMON_BASES'?t('multipleBases'):error.code==='NO_COMMON_BASE'?t('noBase'):error.code==='COMMAND_MIGRATED'&&error.replacement==='CHECKED'?t('checkedMigration'):'';
      const actionLabel=(action:WorkbenchRecoveryAction)=>action.kind==='model-state'?copy(options.locale(),'inspectCandidate',{ref:action.reference.ref}):action.kind==='model-endpoints'?t('compareEndpoints'):action.command;
      return `<div class="terminal-error"><strong>${t('error')}</strong> <code>${esc(error.code)}</code>${error.subject?`<p>${esc(error.subject)}</p>`:''}${explanation?`<p>${esc(explanation)}</p>`:''}<div class="terminal-recovery-actions">${actions.map(action=>fill(action.command,actionLabel(action))).join('')}</div>${error.candidates?.length?`<details><summary>${t('candidates')} · ${error.candidates.length}</summary>${error.candidates.map(value=>`<p><code>${esc(value)}</code></p>`).join('')}</details>`:''}${error.replacement&&!actions.some(action=>action.command===error.replacement)?`<details><summary>${t('syntax')}</summary><code>${esc(error.replacement)}</code></details>`:''}</div>`;
    }
    const value=result.output;
    if(value.kind==='help')return `<div class="terminal-help">${value.commands.map(command=>fill(command)).join('')}</div>`;
    if(value.kind==='repository-status')return `<p>${t('branch')}: ${esc(value.status.branch??'—')} · ${t('revision')}: <code>${esc(short(value.status.head))}</code> · ${t('working')}: ${value.status.unstaged.length} · ${t('staged')}: ${value.status.staged.length}</p>${button('changes',t('changes'))}`;
    if(value.kind==='repository-diff')return `<p>${value.diff.offset??0}–${(value.diff.offset??0)+value.diff.entries.length} / ${value.diff.total??value.diff.entries.length} ${t('changed')}</p>${value.diff.entries.map(entry=>`<div><code>${esc(entry.path)}</code> · ${esc(entry.kind)}</div>`).join('')}${button('changes',t('changes'))}`;
    if(value.kind==='repository-log')return value.commits.map(commit=>`<div><code>${esc(short(commit.oid))}</code> ${esc(commit.message)} <small>${esc(new Intl.DateTimeFormat(options.locale(),{dateStyle:'medium'}).format(new Date(commit.authoredAt)))}</small></div>`).join('')||t('empty');
    if(value.kind==='repository-branches')return value.branches.map(branch=>`<div><code>${esc(branch.name)}</code> <code>${esc(short(branch.oid))}</code>${fill(`git switch ${quote(branch.name)}`)}</div>`).join('')||t('empty');
    if(value.kind==='repository-commit')return `<p>${t('commit')} <code>${esc(short(value.commit.oid))}</code> ${esc(value.commit.message)}</p>`;
    const navigationText=(labels:Record<string,string>)=>knowledgeLocalizedText(labels,options.locale()).text;
    if(value.kind==='scope-contexts')return value.contexts.items.map(item=>`<p><strong>${esc(navigationText(item.definition.labels))}</strong> · ${t('members')}: ${item.members} ${fill(`scope use --context ${quote(item.definition.id)}`,t('useScope'))}</p>`).join('')||t('empty');
    if(value.kind==='scope-context')return `<p><strong>${esc(navigationText(value.context.definition.labels))}</strong> · ${t('members')}: ${value.context.total} · <code>${esc(value.context.revision==='working'?t('working'):short(value.context.revision))}</code></p>`;
    if(value.kind==='scope-batches')return value.batches.items.map(item=>`<p><strong>${esc(navigationText(item.labels))}</strong> · ${contextCopy(options.locale(),'batchCounts',{objects:item.objects,direct:item.directObjects,related:item.relatedObjects})}<br><small>${contextCopy(options.locale(),item.batch.kind==='adopted-import'?'adopted':item.batch.selection==='source-claim-subjects'?'subjects':'related')}</small><details><summary>${t('details')}</summary><code>${esc(item.batchKey)}</code></details></p>`).join('')||t('empty');
    if(value.kind==='scope-plan')return `<p>${esc(contextCopy(options.locale(),'planCounts',value.plan.counts))}</p>${fill(`scope apply ${quote(value.plan.planId)}`,contextCopy(options.locale(),'confirm'))}`;
    if(value.kind==='scope-saved'||value.kind==='scope-applied')return `<p>${esc(contextCopy(options.locale(),value.kind==='scope-saved'?'definitionsSaved':'completed'))}</p><small>${contextCopy(options.locale(),'changedPaths',{count:value.result.paths.length})}</small>`;
    if(value.kind==='scope-change')return `<p>${t('scopeChanged')}</p>`;
    if(value.kind==='object-state')return `<p>${t('state')}: ${esc(value.target.objectId)} · ${value.state.year} · <code>${esc(value.target.revision==='working'?'Working':short(value.target.revision))}</code></p><div>${value.state.fields.map(field=>`<code>${esc(field.propertyId)}</code> ${esc(field.status)}`).join(' · ')}</div>`;
    if(value.kind==='object-history')return `<p>${t('observations')}: ${value.history.observations.length}</p><div class="terminal-refs">${value.history.observations.map(observation=>fill(`history --object ${quote(value.target.objectId)} --revision ${quote(value.target.revision)} show ${observation.year}`,String(observation.year))).join('')}</div>`;
    if(value.kind==='object-diff')return `<p>${t('compare')}: ${value.a.year} ↔ ${value.b.year} · ${value.diff.fields.filter(field=>field.kind==='changed').length} ${t('changed')}</p>`;
    const model=value.execution.output,target=value.target;
    const command=(action:string,reference:string)=>`history --model ${quote(target.modelId)} --revision ${quote(target.revision)} ${action} ${quote(reference)}`;
    if(model.kind==='help')return `<div class="terminal-help">${model.commands.map(syntax=>`<code>${esc(syntax.replace(/^git\s+/,'history '))}</code>`).join('')}</div>`;
    if(model.kind==='snapshot')return `<p>${t('state')}: ${fill(command('show',`commit:${model.version.commitId}`),model.version.ref)} · ${model.version.requestedYear??model.version.recordedYear} · <code>${esc(short(target.revision))}</code></p>`;
    if(model.kind==='diff')return `<p>${t('compare')}: ${esc(model.diff.a.ref)} ↔ ${esc(model.diff.b.ref)} · ${model.diff.rows.filter(row=>!['same','unknown'].includes(row.kind)).length} ${t('changed')}</p>`;
    if(model.kind==='log')return model.commits.map(commit=>fill(command('show',`commit:${commit.id}`),`${commit.year} · ${text(commit.title)}`)).join('');
    if(model.kind==='branches')return model.branches.map(branch=>fill(command('log',branch.id),text(branch.name))).join('');
    if(model.kind==='tags')return model.tags.map(tag=>fill(command('show',`tag:${tag.id}`),text(tag.name))).join('');
    if(model.kind==='search')return model.hits.map(hit=>fill(command(hit.kind==='branch'?'log':'show',`${hit.kind==='tag'?'tag:':hit.kind==='commit'?'commit:':''}${hit.id}`),text(hit.name))).join('')||t('empty');
    if(model.kind==='trace')return model.relationships.map(relation=>`<p>${esc(text(relation.summary))} ${fill(command('show',`commit:${relation.fromCommitId}`))} → ${fill(command('show',`commit:${relation.toCommitId}`))}</p>`).join('')||t('empty');
    if(model.kind==='status')return `<p>${t('state')}: ${esc(model.context.head??t('unknown'))} · ${t('revision')}: <code>${esc(short(target.revision))}</code></p>`;
    return `<p>${t('source')}: <code>${esc(model.field.fieldId)}</code> ${fill(command('show',`commit:${model.commit.id}`),`${model.commit.year} · ${text(model.commit.title)}`)}</p>`;
  }
  function render(){hydrate();const active=options.host.contains(document.activeElement),input=options.host.querySelector<HTMLInputElement>('[data-terminal-input]'),selection=input?[input.selectionStart,input.selectionEnd] as const:null;
    const locale=options.locale();
    if(rendered&&renderedLocale===locale&&renderedExpanded===expanded&&renderedBusy===busy&&renderedEntries===entries){
      if(input&&!composing&&input.value!==draft)input.value=draft;
      renderCompletions();return;
    }
    options.host.className=`terminal-dock global-terminal${expanded?' expanded':''}`;
    const markup=`${expanded?`<div class="terminal-title"><strong>${t('terminal')}</strong><small>${t('completion')}</small>${button('clear',t('clear'))}${button('toggle','⌄',`aria-label="${t('collapse')}"`)}</div><div class="terminal-output" role="log" aria-label="${t('results')}">${entries.length?entries.map((entry,index)=>`<article class="terminal-entry${entry.result.ok?'':' failed'}"><div class="terminal-command"><code>${esc(entry.result.command)}</code>${fill(entry.result.command,'↗')}</div>${output(entry.result)}${hasResultView(entry.result)?button('result',t('openResult'),`data-index="${index}"`):''}${!entry.result.ok&&entry.request?button('retry',t('retry'),`data-index="${index}" ${busy?'disabled':''}`):''}</article>`).join(''):`<div class="terminal-start">${['help','git status','history help'].map(command=>fill(command)).join('')}</div>`}</div>`:''}<form data-terminal-form class="terminal-input-row"><button type="button" data-terminal="toggle" class="terminal-label" aria-expanded="${expanded}" aria-label="${t(expanded?'collapse':'expand')}">⌘ <span>${t('terminal')}</span> ${expanded?'⌄':'⌃'}</button><span class="prompt-chevron">›</span><input data-terminal-input aria-label="${t('command')}" value="${esc(draft)}" placeholder="${t('placeholder')}" maxlength="4096" autocomplete="off" spellcheck="false"><button type="submit" class="terminal-run" ${busy?'disabled':''}>${t(busy?'busy':'run')} ↵</button></form><div class="command-completions" role="listbox" ${completions.length?'':'hidden'}>${completions.map((value,index)=>button('complete',`${value.value} · ${text(value.label)}`,`data-index="${index}" role="option" aria-selected="${index===completionIndex}"`)).join('')}</div>`;
    const form=options.host.querySelector<HTMLElement>('[data-terminal-form]');
    let retained=false;
    if(form&&input&&form.parentElement===options.host&&input.parentElement===form){
      const parsed=document.createElement('div');parsed.innerHTML=markup;
      const nextForm=parsed.querySelector<HTMLElement>('[data-terminal-form]'),nextInput=nextForm?.querySelector<HTMLInputElement>('[data-terminal-input]');
      if(nextForm&&nextInput&&replaceChildrenAround(form,nextForm,input,nextInput)){
        syncElementAttributes(form,nextForm);syncElementAttributes(input,nextInput,['value']);
        if(!composing&&input.value!==draft)input.value=draft;
        retained=replaceChildrenAround(options.host,parsed,form,nextForm);
      }
    }
    if(!retained){options.host.innerHTML=markup;if(active){const replacement=options.host.querySelector<HTMLInputElement>('[data-terminal-input]');replacement?.focus({preventScroll:true});if(selection)replacement?.setSelectionRange(selection[0],selection[1]);}}
    rendered=true;renderedLocale=locale;renderedExpanded=expanded;renderedBusy=busy;renderedEntries=entries;
    renderedList=options.host.querySelector<HTMLElement>('.command-completions');renderedCompletions=completions;renderedCompletionIndex=completionIndex;
    const log=options.host.querySelector('.terminal-output');if(log)log.scrollTop=log.scrollHeight;
  }
  function renderCompletions(){const list=options.host.querySelector<HTMLElement>('.command-completions');if(!list||list===renderedList&&completions===renderedCompletions&&completionIndex===renderedCompletionIndex)return;list.hidden=!completions.length;list.innerHTML=completions.map((value,index)=>button('complete',`${value.value} · ${text(value.label)}`,`data-index="${index}" role="option" aria-selected="${index===completionIndex}"`)).join('');renderedList=list;renderedCompletions=completions;renderedCompletionIndex=completionIndex;}
  function focus(){options.host.querySelector<HTMLInputElement>('[data-terminal-input]')?.focus({preventScroll:true});}
  function setDraft(value:string){completionSequence++;completing=false;draft=value;completions=[];completionIndex=-1;persist();render();focus();options.host.querySelector<HTMLInputElement>('[data-terminal-input]')?.setSelectionRange(draft.length,draft.length);}
  async function run(retry?:WorkbenchCommandRequest){if(composing||busy||!retry&&!draft.trim())return;const submittedDraft=draft,navigationVersion=options.navigationVersion(),input=retry?.input??{command:draft.trim()},status=options.status();const request:WorkbenchCommandRequest=retry??{input,operationId:`terminal-${crypto.randomUUID()}`,...(status?{expectedHead:status.head,expectedTree:status.stagedTree}:{})};
    let focusAfter=false;busy=true;expanded=true;completions=[];completing=false;completionSequence++;persist();render();
    try{const result=await options.execute(request);entries=[...entries,{result,request}].slice(-40);if(!retry){if(history.at(-1)!==result.command)history.push(result.command);history=history.slice(-100);historyIndex=history.length;if(result.ok&&!composing&&draft===submittedDraft)draft='';}const allowNavigation=options.navigationVersion()===navigationVersion;focusAfter=allowNavigation&&options.host.contains(document.activeElement);if(result.ok)try{await options.onResult(result,allowNavigation);}catch(cause){options.onNavigationError(cause);}}
    catch(cause){entries=[...entries,{result:{ok:false as const,command:'command' in input?input.command:'',error:{code:'IO_ERROR' as const},effect:{type:'none' as const}},request}].slice(-40);}
    finally{const retainFocus=focusAfter&&(document.activeElement===document.body||options.host.contains(document.activeElement));busy=false;persist();render();if(retainFocus)focus();}
  }
  options.host.addEventListener('submit',event=>{event.preventDefault();void run();});
  options.host.addEventListener('input',event=>{if(!(event.target as HTMLElement).matches('[data-terminal-input]'))return;draft=(event.target as HTMLInputElement).value;completionIndex=-1;completions=[];completing=false;persist();const sequence=++completionSequence,requested=draft;renderCompletions();if(!draft.trim()||(event as InputEvent).isComposing)return;completing=true;void options.complete(requested).then(found=>{if(sequence===completionSequence&&draft===requested){completing=false;completions=found.slice(0,8);renderCompletions();}},()=>{if(sequence===completionSequence)completing=false;});});
  options.host.addEventListener('compositionstart',event=>{if(!(event.target as HTMLElement).matches('[data-terminal-input]'))return;composing=true;completionSequence++;completing=false;completions=[];completionIndex=-1;renderCompletions();});
  options.host.addEventListener('compositionend',event=>{if(!(event.target as HTMLElement).matches('[data-terminal-input]'))return;composing=false;draft=(event.target as HTMLInputElement).value;persist();});
  options.host.addEventListener('click',event=>{const target=(event.target as HTMLElement).closest<HTMLElement>('[data-terminal]');if(!target)return;const action=target.dataset.terminal;if(action==='toggle'){expanded=!expanded;persist();render();if(expanded)focus();}else if(action==='clear'){entries=[];render();focus();}else if(action==='fill')setDraft(target.dataset.command??'');else if(action==='complete'){const value=completions[Number(target.dataset.index)];if(value)setDraft(value.value);}else if(action==='retry'){const value=entries[Number(target.dataset.index)]?.request;if(value)void run(value);}else if(action==='result'){const value=entries[Number(target.dataset.index)]?.result;if(value&&hasResultView(value))void options.onResult(value,true).catch(options.onNavigationError);}else if(action==='changes')void options.onChanges();});
  options.host.addEventListener('keydown',event=>{if(!(event.target as HTMLElement).matches('[data-terminal-input]')||event.isComposing||composing)return;if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();historyIndex=Math.max(0,Math.min(history.length,historyIndex+(event.key==='ArrowUp'?-1:1)));setDraft(history[historyIndex]??'');}else if(event.key==='Tab'&&(completions.length||completing)){event.preventDefault();const selected=completions[(completionIndex+1)%completions.length];if(selected)setDraft(selected.value);}else if(event.key==='Escape'){completionSequence++;completing=false;completionIndex=-1;completions=[];renderCompletions();focus();}});
  return {render,focus,fill:setDraft,record(result:WorkbenchCommandExecution){entries=[...entries,{result,request:null}].slice(-40);if(!result.ok)expanded=true;render();},beforeClose(){persist();},isBusy:()=>busy};
}
