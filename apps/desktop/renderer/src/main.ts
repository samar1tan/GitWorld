import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './style.css';
import './workbench-style.css';
import './desktop.css';
import './chrome.css';
import './source-browser.css';
import './knowledge-browser.css';
import './research-workspace.css';
import './changes-workspace.css';
import './onboarding.css';
import './settings-shell.css';
import './workspace-shell.css';
import './object-editor.css';
import './context-workspace.css';
import { icon } from './icons';
import { parseCommand } from '@gitworld/domain';
import { createTerminal } from './terminal';
import { replaceChildrenAround, syncElementAttributes } from './retained-dom';
import { researchKnowledgeQuery } from './research-draft';
import { modelResearchContext } from './model-research';
import { renderModelComparison,modelComparisonResearch,type ModelComparison } from './model-comparison';
import { parseKnowledgeBrowserState,initialKnowledgeBrowserState,type KnowledgeBrowserState } from './knowledge-browser-state';
import { placeMapLabels } from './map-labels';
import type { DataPackage, DatasetRef, Scope, HistoryLocale, CommandExecution } from '@gitworld/domain';
import type { WorkspaceState, BrowseState, RevisionSummary, LibrarySummary, ServiceMethods } from '@gitworld/contracts';
import { request, bridge, escapeHtml as esc, ServiceFailure } from './client';
import { copy, contentText, yearText, coverageText } from './copy';
import { createWorkbench } from './workbench-ui';
import { createManager } from './manager';
import { createSourceBrowser } from './source-browser';
import { createKnowledgeBrowser } from './knowledge-browser';
import { createContextWorkspace, type ContextWorkspaceTarget } from './context-workspace';
import { contextCopy } from './context-copy';
import { createObjectEditor, type ObjectEditorTarget } from './object-editor';
import { createResearchWorkspace } from './research-workspace';
import { createChangesWorkspace } from './changes-workspace';
import { createSettings } from './settings';
import { loadApplicationInfo, settingsShellCopy, showBundledNotices } from './settings-shell';
import { createClientStateCache } from './client-state';
import { clientStateCopy } from './client-state-copy';
import { createOnboarding, type OnboardingFocusTarget, type OnboardingSection } from './onboarding';
import { knowledgeGuideEvents, researchCompletesInvestigation } from './onboarding-observations';
import { workspaceCopy } from './workspace-copy';
import { validateWorkspace } from '@gitworld/contracts';
import type { EditorialStatus, EditorialJson, ResearchContext, SettingsSnapshot, SettingsGeneral, SettingsSection, ModelCatalog, WorkbenchCommandExecution } from '@gitworld/contracts';
import { sourceCopy } from './source-copy';
import { createWorkspacePersistence, createWorkspaceTransitions } from './workspace-persistence';
import { createClosePreparation } from './close-preparation';
import { initialWorkspace, navigate, returnOne, returnToLevel, setWindow, type Workspace, type ViewState } from './state';

const app = document.querySelector<HTMLDivElement>('#app')!;
const guidanceHost = document.createElement('section');
guidanceHost.className = 'workspace-guidance-host';
document.body.append(guidanceHost);
let state = initialWorkspace();
let data:DataPackage|null = null;
let workbench:ReturnType<typeof createWorkbench>|null = null;
let models:ModelCatalog|null=null;let modelComparison:ModelComparison|null=null;const modelPackages=new Map<string,DataPackage>();
let lastExplore:'paths'|'knowledge'|'research'='knowledge';
let researchReturn:'paths'|'knowledge'='knowledge';
let lastLibrary:'sources'|'changes'|'manager'='sources';
let sourceOrigin:{section:'paths'|'knowledge';knowledge?:KnowledgeBrowserState;paths?:WorkspaceState}|null=null;
let adoptedObjects:{id:string;label:string}[]=[];let adoptedTotal=0;
let adoptedIdentity:{inputHash:string;previewId?:string}|null=null;
const terminalHost=document.createElement('section');
let managerOpen = false;
let settingsOpen = false;
let objectEditorOpen = false;
let contextEditorOpen=false;
let settingsProfile: SettingsSnapshot | null = null;
let applicationInfo: { version:string; buildId:string } | null = null;
const settingsHost = document.createElement('div'); settingsHost.className = 'settings-host';
let navigationVersion=0,interactionVersion=0;
let sourceOpen = false;
let toolPanel:'knowledge'|'research'|'changes'|null = null;
let editingStatus:EditorialStatus|null = null;
let learningContext:ResearchContext|null = null;
let returnAfterChanges:'paths'|'knowledge'|'research' = 'knowledge';
const commitReturnIntents=new Map<string,{interaction:number;section:'paths'|'knowledge'|'research'}>();
let error = '';
let saving = false;
let saveFailed = false;
let transitioning = false;
let closePending = false;
let openingLibrary:{selected?:DatasetRef;restore?:WorkspaceState}|null = null;
let interruptedOpening:{selected?:DatasetRef;restore?:WorkspaceState}|null = null;
let interruptedTransition = false;
let clientReady = false, clientFailed = false, clientBusy = false, clientMaintenance = false, restoringLibrary = false;
let clientActionError = false;
let changesInitialized = false;
let guidanceMarkup = '';let startupReady=false;let startupProgress:{completed:number;total:number}|null=null;
const transitions = createWorkspaceTransitions();
let land = '';
let mapDragging: {x:number;y:number;view:ViewState['viewport']}|null = null;
const t = (key:Parameters<typeof copy>[1]) => copy(state.locale,key);
const text = (value:Parameters<typeof contentText>[0]) => contentText(value,state.locale);
const ref = ():DatasetRef => ({datasetId:data!.dataset.id, revisionId:data!.revision.id});
const button = (action:string,label:string,extra='') => `<button type="button" data-app="${action}" ${extra}>${label}</button>`;
const clientCache = createClientStateCache({ load:key=>request('clientState.load',{key}),save:input=>request('clientState.save',input) }, failed=>{clientFailed=failed;renderGuidance();});
function renderStartup() {
  if(startupReady)return;
  const label=workspaceCopy(state.locale,'openingLibrary');
  const progress=startupProgress?workspaceCopy(state.locale,'savedFiles',startupProgress):'';
  app.innerHTML=`<section class="startup library-startup"><div class="startup-brand">${icon('branch')}<h1>GitWorld</h1></div><p role="status">${label}</p>${startupProgress?`<progress value="${startupProgress.completed}" max="${startupProgress.total}"></progress><p class="startup-progress">${progress}</p>`:''}</section>`;
}
if(window.gitworld)bridge().onProgress(progress=>{if(progress.operationId==='library-initialize'&&progress.total&&progress.completed!==undefined){startupProgress={completed:progress.completed,total:progress.total};renderStartup();}});
const guide = createOnboarding({
  locale:()=>state.locale,context:()=>({section:currentSection(),editing:managerOpen||settingsOpen||objectEditorOpen||contextEditorOpen||!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')}),
  persist:async snapshot=>{if(!clientReady||restoringLibrary)throw new Error('CLIENT_STATE_NOT_READY');await clientCache.save('onboarding',snapshot);},
  onTipsChange:async tipsEnabled=>{const current=settingsProfile??await request('settings.get',{});acceptSettings(await request('settings.update',{section:'learning',expectedVersion:current.version,value:{tipsEnabled}}));},
  navigate:navigateGuide,focus:focusGuide,render:renderGuidance,
});

function currentSection():OnboardingSection { return objectEditorOpen||contextEditorOpen?'knowledge':sourceOpen?'sources':toolPanel??'paths'; }
function rememberSection() { if(clientReady&&!restoringLibrary)clientCache.set('workspace-section',{schemaVersion:2,section:currentSection(),explore:lastExplore,library:lastLibrary,sourceOrigin:sourceOrigin as unknown as EditorialJson}); }
function clientNotice() {
  if(!clientFailed&&!clientActionError)return '';
  const conflict=clientCache.conflict(),c=(key:Parameters<typeof clientStateCopy>[1])=>clientStateCopy(state.locale,key,conflict?.key);
  const action=(value:string,label:string)=>`<button type="button" class="onboarding-button" data-client-state="${value}" ${clientBusy||clientMaintenance?'disabled':''}>${esc(label)}</button>`;
  return `<div class="client-state-notice"><p>${esc(clientActionError?c('finishModel'):conflict?c('conflict'):c(clientReady?'saveFailed':'loadFailed'))}</p>${conflict?`<p>${esc(c('conflictDetail'))}</p><div class="onboarding-actions">${action('local',c('local'))}${action('saved',c('saved'))}</div>`:`<div class="onboarding-actions">${action('retry',c(clientReady?'retrySave':'retryLoad'))}</div>`}</div>`;
}
function updateGuideEntries() {
  if(managerOpen){const header=app.querySelector('.manager-header');if(header){header.outerHTML=titlebar()+modeNavigation();}decorateResources();}
  for(const entry of app.querySelectorAll<HTMLButtonElement>('[data-onboarding="open"]')){entry.setAttribute('aria-expanded',String(guide.snapshot().panelOpen));entry.disabled=clientMaintenance;}
}
function renderGuidance() {
  const html=clientNotice()+guide.content();
  if(guidanceMarkup!==html){
    const active=document.activeElement as HTMLElement|null,inside=!!active&&guidanceHost.contains(active);
    const action=inside?active!.dataset.onboarding:null,track=inside?active!.dataset.track:null;
    const clientAction=inside?active!.dataset.clientState:null;
    guidanceMarkup=html;guidanceHost.innerHTML=html;
    if(action){const replacement=[...guidanceHost.querySelectorAll<HTMLElement>('[data-onboarding]')].find(element=>element.dataset.onboarding===action&&(!track||element.dataset.track===track));replacement?.focus({preventScroll:true});}
    else if(clientAction)guidanceHost.querySelector<HTMLElement>(`[data-client-state="${clientAction}"]`)?.focus({preventScroll:true});
    requestAnimationFrame(alignMapPins);
  }
  guidanceHost.inert=clientMaintenance;
  updateGuideEntries();
}
async function initializeClientSettings(replaceLocal=false) {
  const legacy=replaceLocal?undefined:localStorage;
  await clientCache.initialize(legacy,replaceLocal);clientReady=true;clientFailed=false;clientActionError=false;
  const locale=clientCache.get('locale');if(locale==='en'||locale==='zh-CN')state={...state,locale};
  if(replaceLocal)await guide.restore(clientCache.get('onboarding'));else guide.hydrate(clientCache.get('onboarding'));
  try { acceptSettings(await request('settings.get',{}),false); } catch { settingsProfile=null; }
  renderGuidance();
}
async function flushClientState() { if(clientReady){await guide.flush();await clientCache.flush();} }
async function handleClientAction(action:string) {
  if(clientBusy||clientMaintenance)return;
  if(action==='saved'&&managerOpen&&manager.hasUnsavedChanges()){clientActionError=true;renderGuidance();return;}
  clientBusy=true;clientActionError=false;renderGuidance();
  try {
    if(action==='saved'){
      if(changesInitialized)await changesWorkspace.prepareClose();await persistence.pause();await clientCache.resolveConflict('saved');await clientCache.flush();
      window.location.reload();return;
    }
    if(action==='local')await clientCache.resolveConflict('local');
    if(!clientReady){await initializeClientSettings();await openLibrary();await restoreWorkspaceSection();}
    else await flushClientState();
    clientFailed=false;
  }catch{clientFailed=true;}
  finally{clientBusy=false;renderGuidance();}
}
async function restoreWorkspaceSection() {
  if(settingsProfile?.values.general.startup==='world'){const previous=parseKnowledgeBrowserState(clientCache.storage.getItem('gitworld-knowledge-view-v1'))??knowledgeBrowser.state();await openTool('knowledge',false,undefined,{...initialKnowledgeBrowserState(),queryRevision:'working',checkout:previous.checkout,a:previous.a,b:previous.b,yearDraft:previous.yearDraft});return;}
  const saved=clientCache.get('workspace-section');
  const navigation=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:null;
  const selected=navigation?.section??saved;
  if(navigation?.explore==='paths'||navigation?.explore==='knowledge'||navigation?.explore==='research')lastExplore=navigation.explore;
  if(navigation?.library==='sources'||navigation?.library==='changes'||navigation?.library==='manager')lastLibrary=navigation.library;
  const origin=navigation?.sourceOrigin;if(origin&&typeof origin==='object'&&!Array.isArray(origin)&&(origin.section==='paths'||origin.section==='knowledge')){const knowledge=parseKnowledgeBrowserState(JSON.stringify(origin.knowledge)),paths=validateWorkspace(origin.paths);sourceOrigin={section:origin.section,...(knowledge?{knowledge}:{}),...(paths.ok?{paths:paths.value}:{})};}
  if(selected==='knowledge'||selected==='research'||selected==='changes')await openTool(selected);
  else if(selected==='sources')await openSources();
  else if(selected!=='paths')await openTool('knowledge');
}
async function navigateGuide(section:OnboardingSection):Promise<boolean> {
  if(settingsOpen&&!await settingsWorkspace.close())return false;
  if(managerOpen&&!await manager.close())return false;
  if(section==='paths')return closeTool();
  if(section==='sources')return openSources();
  if(section==='research'&&toolPanel==='knowledge'&&!guide.snapshot().investigation.research){await knowledgeBrowser.click({dataset:{knowledge:'research'}} as unknown as HTMLElement);return currentSection()==='research';}
  return openTool(section);
}
async function focusGuide(target:OnboardingFocusTarget) {
  if(target==='guide-entry'){app.querySelector<HTMLElement>('[data-onboarding="open"]')?.focus({preventScroll:true});return;}
  if(target==='commit')changesWorkspace.openCommit();
  if(toolPanel==='knowledge'&&(target==='historical-state'||target==='comparison'))await knowledgeBrowser.click({dataset:{knowledge:'view',view:target==='comparison'?'compare':'state'}} as unknown as HTMLElement);
  const selectors:Record<OnboardingFocusTarget,string>={
    'guide-entry':'[data-onboarding="open"]',scope:'.sidebar [data-app="scope"],.scope-pin','object-search':'[data-knowledge-input="query"]',
    'historical-state':'[data-knowledge-input="year"],.graph-version,.process-strip',comparison:'[data-knowledge-input="a"],[data-wb="compare-open"]',
    evidence:'[data-knowledge="field"],.field-evidence summary','research-record':'[data-research-input="title"]',
    acquisition:'[data-source-input="query"]','mapping-preview':'[data-source="preview-mapping"]',adoption:'[data-source="adopt"]',staging:'[data-changes="stage-plan"]',commit:'[data-changes-input="message"]',
  };
  app.querySelector<HTMLElement>(selectors[target])?.focus({preventScroll:true});
}
function pathScopeKey(branchId?:string) { const branch=data?.history.branches.find(value=>value.id===branchId);return data?`paths:${data.dataset.id}:${branch?.scopeId??state.view.scopeId??'world'}`:''; }
function observeHistoricalExecution(execution:CommandExecution) {
  if(!execution.ok||!data)return;
  const output=execution.output;
  if(output.kind==='snapshot'&&Object.keys(output.snapshot.fields).length){const scopeKey=pathScopeKey(output.version.branchId);guide.observe({type:'scope-chosen',scopeKey});guide.observe({type:'historical-state-inspected',scopeKey,stateKey:JSON.stringify([ref(),output.version.commitId,output.version.requestedYear])});}
  else if(output.kind==='diff'&&output.diff.rows.some(row=>!['same','unknown'].includes(row.kind))){const scopeKey=guide.snapshot().investigation.scopeKey;if(scopeKey?.startsWith(`paths:${data.dataset.id}:`))guide.observe({type:'comparison-completed',scopeKey,comparisonKey:JSON.stringify([ref(),output.diff.a,output.diff.b])});}
  else if(output.kind==='blame'&&output.field.sourceIds.length){const scopeKey=guide.snapshot().investigation.scopeKey;if(scopeKey?.startsWith(`paths:${data.dataset.id}:`))guide.observe({type:'evidence-inspected',scopeKey,evidenceKey:JSON.stringify([ref(),output.version.commitId,output.field.fieldId])});}
}

function showError(cause:unknown) {
  error = cause instanceof ServiceFailure ? `${t('operationFailed')} ${cause.detail.code}${cause.detail.issues?.length?` · ${cause.detail.issues.length} ${t('errors')}`:''}` : cause instanceof Error ? cause.message : t('operationFailed');
  render();
}
function toBrowse(view:ViewState):BrowseState {
  return { panel:view.panel, scopeId:view.scopeId, processId:view.processId, eventId:view.eventId, selectedCommitId:view.selectedCommit, graphRef:view.graphRef, graphBranch:view.graphBranch, requestedYear:view.requestedYear, timeWindow:view.timeWindow, cursor:view.cursor, viewport:view.viewport };
}
function fromBrowse(view:BrowseState):ViewState {
  return { ...view, selectedCommit:view.selectedCommitId, graphBranch:view.graphBranch??null, requestedYear:view.requestedYear??null, level:view.eventId?'event':view.processId?'process':view.scopeId?'region':'world' };
}
function qualified(id:string,requestedYear:number|null,revision?:string|null) { return {...ref(),revisionId:revision??ref().revisionId,commitId:id,requestedYear}; }
function updateSaveIndicator() {
  const indicator=document.querySelector('[data-save-state]');
  if(indicator)indicator.textContent=t(saving?'saving':saveFailed?'saveFailed':'saved');
}
const persistence=createWorkspacePersistence(input=>request('workspace.save',input),status=>{
  saving=status==='saving';saveFailed=status==='failed';updateSaveIndicator();
});
function persisted():WorkspaceState {
  return {id:'primary',version:persistence.version??0,dataset:ref(),locale:state.locale,head:state.head?qualified(state.head,state.headRequestedYear,state.headRevision):null,comparison:state.comparison?state.comparison.map((id,i)=>qualified(id,state.comparisonRequestedYears?.[i]??null,state.comparisonRevisions?.[i])) as WorkspaceState['comparison']:null,view:toBrowse(state.view),trail:state.trail.map(toBrowse)};
}
async function saveWorkspace() {
  if(!data||transitioning||managerOpen||settingsOpen||objectEditorOpen||contextEditorOpen||sourceOpen||toolPanel!==null||closePending)return;
  try { await persistence.save(persisted()); }
  catch(cause) { if(!transitioning&&!managerOpen)showError(cause); }
}
function update(next:Workspace,_mode?:'push'|'replace',focus=false) {
  if(transitioning||managerOpen||settingsOpen||objectEditorOpen||contextEditorOpen||sourceOpen||toolPanel!==null||closePending||!data)return;
  navigationVersion++;state=next;if(clientReady)clientCache.set('locale',state.locale);render();void saveWorkspace();
  if(focus)document.querySelector<HTMLElement>('main h1')?.focus({preventScroll:true});
}
function freshState(packageData:DataPackage):Workspace {
  const next=initialWorkspace();next.locale=state.locale;
  next.view.timeWindow=[...packageData.catalog.defaults.timeWindow];next.view.viewport={...packageData.catalog.defaults.worldView};
  const initialScope=packageData.catalog.scopes.find(s=>s.id===packageData.catalog.defaults.scopeId);
  if(initialScope){next.view.scopeId=initialScope.id;next.view.level='region';next.view.viewport=initialScope.viewBox??next.view.viewport;}
  return next;
}
async function openLibrary(selected?:DatasetRef,restore?:WorkspaceState) {
  if((objectEditorOpen||contextEditorOpen)&&!await closeObjectEditor())return;
  navigationVersion++;
  if(closePending)return;
  openingLibrary={selected,restore};
  const sequence=transitions.begin();transitioning=true;mapDragging=null;workbench?.dispose();
  error='';app.innerHTML=`<div class="startup"><h1>GitWorld</h1><p>${t('loading')}</p></div>`;
  try {
    await persistence.pause();
    if(!transitions.current(sequence))return;
    const status=await request('library.status',{});
    models=await request('model.catalog',{revision:'working'});
    const stored=await request('workspace.load',{workspaceId:'primary'}),saved=restore??stored;
    if(!transitions.current(sequence))return;
    const target=selected??saved?.dataset??(status.datasets.find(d=>d.activeRevisionId)?{datasetId:status.datasets.find(d=>d.activeRevisionId)!.id,revisionId:status.datasets.find(d=>d.activeRevisionId)!.activeRevisionId!}:null);
    if(!target){persistence.bind(saved?.version??null);data=null;workbench=null;openingLibrary=null;transitioning=false;render();return;}
    const loaded=target.revisionId==='working'||/^[a-f0-9]{40}$/.test(target.revisionId)?(await request('model.read',{datasetId:target.datasetId,revision:target.revisionId})).package:await request('revision.get',{dataset:target});
    loaded.revision.id=target.revisionId;loaded.history.id=target.revisionId;modelPackages.set(`${target.datasetId}\0${target.revisionId}`,loaded);
    if(!transitions.current(sequence))return;
    persistence.bind(stored?.version??null);data=loaded;state=freshState(loaded);
    const restoreSaved=!!saved&&saved.dataset.datasetId===target.datasetId;const sameRevision=restoreSaved&&saved.dataset.revisionId===target.revisionId;
    if(restoreSaved){const locale=settingsProfile?.values.general.locale??(clientReady?clientCache.get('locale'):null);state={...state,locale:locale==='en'||locale==='zh-CN'?locale:saved.locale,view:fromBrowse(saved.view),trail:saved.trail.map(fromBrowse),head:saved.head?.commitId??null,headRequestedYear:saved.head?.requestedYear??null,headRevision:saved.head?.revisionId??null,comparisonRevisions:saved.comparison?.map(value=>value.revisionId) as [string,string]??null,comparison:saved.comparison?.map(r=>r.commitId) as Workspace['comparison']??null,comparisonRequestedYears:saved.comparison?.map(r=>r.requestedYear) as Workspace['comparisonRequestedYears']??null};}
    if(restoreSaved&&!sameRevision){state={...state,trail:[],view:{...state.view,panel:'browse',selectedCommit:null,graphRef:null,graphBranch:null,requestedYear:null}};if(!loaded.catalog.scopes.some(scope=>scope.id===state.view.scopeId))state.view.scopeId=null;if(!loaded.catalog.processes.some(process=>process.id===state.view.processId))state.view.processId=null;}
    for(const version of new Set([state.headRevision,...state.comparisonRevisions??[]].filter((value):value is string=>!!value&&value!==target.revisionId))){const previous=await request('model.read',{datasetId:target.datasetId,revision:version});previous.package.revision.id=version;previous.package.history.id=version;modelPackages.set(`${target.datasetId}\0${version}`,previous.package);}
    modelComparison=null;
    if(state.comparison&&state.comparisonRevisions&&state.comparisonRevisions.some(revision=>revision!==target.revisionId)){
      const a={kind:'model' as const,modelId:target.datasetId,revision:state.comparisonRevisions[0],ref:`commit:${state.comparison[0]}`},b={kind:'model' as const,modelId:target.datasetId,revision:state.comparisonRevisions[1],ref:`commit:${state.comparison[1]}`};
      const compared=await request('command.execute',{input:{intent:{family:'history',target:{kind:'model',modelId:a.modelId,revision:a.revision},intent:{type:'compare',a,b},context:{head:null}}}});
      if(!compared.ok)throw new Error(compared.error.code);
      if(compared.output.kind!=='model'||compared.output.execution.output.kind!=='diff')throw new Error('INVALID_HISTORY_RESULT');
      modelComparison={a,b,diff:compared.output.execution.output.diff,before:modelPackages.get(`${target.datasetId}\0${a.revision}`)!,after:modelPackages.get(`${target.datasetId}\0${b.revision}`)!,commonBaseStatus:compared.output.comparison?.commonBaseStatus??(a.revision===b.revision?'computed':'different-revisions')};
    }
    if(restore||!sameRevision)await persistence.save(persisted());
    if(!transitions.current(sequence))return;
    installWorkbench(sequence);openingLibrary=null;transitioning=false;render();void refreshEditingStatus().catch(()=>{});
  }catch(cause){if(transitions.current(sequence)){openingLibrary=null;persistence.resume();transitioning=false;if(data)installWorkbench(sequence);else workbench=null;showError(cause);}}
}
function installWorkbench(sequence:number) {
  if(!data)return;
  const identity=data,target=ref(),current=()=>transitions.current(sequence)&&data===identity&&!transitioning&&!managerOpen&&!settingsOpen&&!objectEditorOpen&&!contextEditorOpen&&!sourceOpen&&toolPanel===null&&!closePending;
  workbench=createWorkbench({package:identity,getState:()=>state,update:(next,mode,focus)=>{if(current())update(next,mode,focus);},render:()=>{if(current())render();},onError:cause=>{if(current())showError(cause);},onExecuted:result=>{if(current())observeHistoricalExecution(result);},onCompareChecked:compareWithChecked,onOpenChecked:()=>openModelReference({kind:'model',modelId:target.datasetId,revision:state.headRevision??target.revisionId,ref:`commit:${state.head}`}),query:async(command,context)=>{const parsed=parseCommand(command);if(!parsed.ok)throw new Error(parsed.error.code);const result=await request('command.execute',{input:{intent:{family:'history',target:{kind:'model',modelId:target.datasetId,revision:target.revisionId},intent:parsed.value,context}}});if(!current())throw new Error('STALE_RELEASE');terminal.record(result);if(result.ok&&result.output.kind==='model'&&result.output.execution.intent.type==='diff')modelComparison=null;if(!result.ok)throw new Error(result.error.code);if(result.output.kind!=='model')throw new Error('INVALID_HISTORY_RESULT');return result.output.execution;}});
}
async function openManager() {
  if((objectEditorOpen||contextEditorOpen)&&!await closeObjectEditor())return;
  if((toolPanel!==null||sourceOpen)&&!await leaveTools())return;
  if(transitioning||managerOpen||closePending)return;
  navigationVersion++;lastLibrary='manager';
  const sequence=transitions.begin();transitioning=true;mapDragging=null;workbench?.dispose();
  try { await persistence.pause();await flushClientState();if(!transitions.current(sequence))return;managerOpen=true;transitioning=false;renderGuidance();await manager.open(); }
  catch(cause){if(transitions.current(sequence)){transitioning=false;persistence.resume();if(data)installWorkbench(sequence);showError(cause);}}
}
async function beforeLibraryTransfer() {
  if(manager.hasUnsavedChanges()||settingsOpen&&settingsWorkspace.hasUnsavedChanges())throw new Error(clientStateCopy(state.locale,'finishModel'));
  clientMaintenance=true;renderGuidance();
  await persistence.pause();await flushClientState();
}
function afterLibraryTransfer() { clientMaintenance=false;renderGuidance(); }
async function afterLibraryRestored() { restoringLibrary=true;settingsProfile=null;await initializeClientSettings(true);window.location.reload(); }
const manager=createManager({locale:()=>state.locale,package:()=>data,onClose:async()=>{managerOpen=false;data=null;workbench=null;await openLibrary();rememberSection();},onError:showError,onRendered:updateGuideEntries,
  onFindData:async()=>{managerOpen=false;data=null;workbench=null;await openLibrary();await openSources();},
  beforeBackup:beforeLibraryTransfer,afterBackup:afterLibraryTransfer,beforeRestore:beforeLibraryTransfer,afterRestore:afterLibraryTransfer,
  onRestored:afterLibraryRestored,
  onPublished:async()=>{models=await request('model.catalog',{revision:'working'});await refreshEditingStatus();}});
function acceptSettings(snapshot:SettingsSnapshot,refresh=true) {
  if(settingsProfile&&snapshot.version<settingsProfile.version)return;
  const localeChanged=state.locale!==snapshot.values.general.locale;
  settingsProfile=structuredClone(snapshot);state={...state,locale:snapshot.values.general.locale};document.documentElement.lang=state.locale;
  document.documentElement.dataset.reducedMotion=snapshot.values.general.reducedMotion;
  guide.configurePreferences({tipsEnabled:snapshot.values.learning.tipsEnabled});
  if(!refresh)return;
  if(settingsOpen){
    settingsWorkspace.synchronize(snapshot);
    const header=app.querySelector('.topbar');if(header&&data)header.outerHTML=titlebar();
    const modes=app.querySelector('.workspace-modes');if(modes)modes.outerHTML=modeNavigation();
  }else if(localeChanged)render();
  renderGuidance();
}
async function saveGeneralPreference(value:Partial<SettingsGeneral>) {
  const current=settingsProfile??await request('settings.get',{});
  try {const saved=await request('settings.update',{section:'general',expectedVersion:current.version,value:{...current.values.general,...value}});error='';acceptSettings(saved);renderSettingsNotice();}
  catch(cause){const select=app.querySelector<HTMLSelectElement>('#language');if(select)select.value=state.locale;throw cause;}
}
async function openSettings(section:SettingsSection|'library'='general') {
  if(settingsOpen||transitioning||closePending||clientMaintenance)return;
  const interaction=interactionVersion,current=()=>interaction===interactionVersion&&!closePending;
  if((objectEditorOpen||contextEditorOpen)&&!await closeObjectEditor())return;
  if(!current())return;
  navigationVersion++;
  if(managerOpen&&!await manager.close())return;
  if(!current())return;
  await persistence.pause();await flushClientState();workbench?.beforeRender();workbench?.dispose();
  if(!current())return;
  error='';settingsOpen=true;render();await settingsWorkspace.open(section);
}
const settingsWorkspace=createSettings({host:settingsHost,locale:()=>state.locale,
  onClose:()=>{settingsOpen=false;if(!sourceOpen&&toolPanel===null)persistence.resume();render();},
  onApplied:acceptSettings,onJourney:async(track,mode)=>{guide.openJourney(track,mode);},
  beforeTransfer:beforeLibraryTransfer,afterTransfer:afterLibraryTransfer,onRestored:afterLibraryRestored,
  hostInfo:()=>applicationInfo??{version:settingsShellCopy(state.locale,'unavailable'),buildId:settingsShellCopy(state.locale,'unavailable')},
  onNotices:()=>showBundledNotices(state.locale),onError:showError,onRendered:updateGuideEntries,
});
const sourceBrowser=createSourceBrowser({locale:()=>state.locale,render,storage:clientCache.storage,navigationVersion:()=>interactionVersion,onObserved:event=>guide.observe(event),onAdopted:async(result,_jobId,startedInteraction)=>{const interaction=startedInteraction??interactionVersion;adoptedIdentity={inputHash:result.preview.inputHash,...(result.preview.prepared?{previewId:result.preview.prepared.id}:{})};const ids=[...new Set([...result.changedObjects,...result.unchangedObjects])];adoptedTotal=result.totalObjects??ids.length;const available=result.objects?result.objects.map(value=>value.id):ids;const labels=new Map((result.objects??[]).map(value=>[value.id,value.labels]));adoptedObjects=available.slice(0,20).map(id=>({id,label:labels.get(id)?.[state.locale]??labels.get(id)?.en??id}));await refreshEditingStatus();if(interaction!==interactionVersion||settingsOpen||managerOpen||closePending)return;if(sourceOpen&&!objectEditorOpen&&!contextEditorOpen){await openTool('knowledge');rememberSection();}else if(toolPanel==='knowledge'&&!objectEditorOpen&&!contextEditorOpen)render();},onClose:()=>{
  sourceOpen=false;persistence.resume();if(data)installWorkbench(transitions.begin());rememberSection();render();void saveWorkspace();
}});
function updateNavigationStatus() {
  for(const changes of app.querySelectorAll<HTMLElement>('[data-change-count]'))changes.textContent=workspaceCopy(state.locale,'changes')+(editingStatus?` · ${new Set([...editingStatus.staged,...editingStatus.unstaged].map(value=>value.path)).size}`:'');
  let revision=app.querySelector<HTMLElement>('.workspace-revision');
  if(!revision&&editingStatus){revision=document.createElement('span');revision.className='workspace-revision';app.querySelector('.titlebar-leading')?.append(revision);}
  if(revision&&editingStatus){revision.title=workspaceCopy(state.locale,'dataRevision')+': '+editingStatus.head;revision.innerHTML=`<span class="sr-only">${workspaceCopy(state.locale,'dataRevision')}</span>${esc(editingStatus.branch??workspaceCopy(state.locale,'detached'))} <code>${esc(editingStatus.head.slice(0,8))}</code>`;}
}
async function refreshEditingStatus() { editingStatus=await request('repository.status',{});updateNavigationStatus();return editingStatus; }
async function refreshModelCatalogForHead(head:string) {const catalog=await request('model.catalog',{revision:'working'});if(editingStatus?.head===head&&catalog.head===head){models=catalog;if(!settingsOpen&&!managerOpen&&!objectEditorOpen&&!contextEditorOpen)render();}}
const knowledgeBrowser=createKnowledgeBrowser({locale:()=>state.locale,render,repositoryStatus:refreshEditingStatus,storage:clientCache.storage,
  api:{query:params=>request('knowledge.query',params),object:params=>request('knowledge.object',params),state:params=>request('knowledge.state',params),history:params=>request('knowledge.history',params),diff:params=>request('knowledge.diff',params)},
  modelArtifacts:()=>data&&data.history.commits.length?[{id:data.dataset.id,labels:data.dataset.name,revision:data.revision.id,states:data.history.commits.length,from:Math.min(...data.history.commits.map(value=>value.year)),to:Math.max(...data.history.commits.map(value=>value.year))}]:[],onModelArtifact:async(id,revision)=>{if(await closeTool()&&(!data||data.dataset.id!==id||data.revision.id!==revision))await openLibrary({datasetId:id,revisionId:revision});},
  navigation:{list:params=>request('context.list',params),get:params=>request('context.get',params)},onContext:openContextEditor,
  onObserved:event=>{for(const observation of knowledgeGuideEvents(event,guide.snapshot(),knowledgeBrowser.state()))guide.observe(observation);},
  onFindData:async(query)=>{await openSources(query);},onOpenChanges:async()=>{await openTool('changes',false,{mode:'working'});},onEdit:openObjectEditor,onResearch:async context=>{researchReturn='knowledge';learningContext=context;if(await openTool('research'))await researchWorkspace.newRecord(context);},onClose:()=>closeTool(),
});
const objectEditor=createObjectEditor({locale:()=>state.locale,render,storage:clientCache.storage,flushDraft:()=>clientCache.flush(),
  api:{context:objectId=>request('knowledge.editContext',objectId?{objectId}:{}),save:input=>request('knowledge.saveEdit',input),query:query=>request('knowledge.query',{query,revision:'working'})},
  onClose:async()=>{await closeObjectEditor();},onSaved:async()=>{await refreshEditingStatus();},
  onResumeImport:()=>routeWorkspace('imports'),onResumeContext:()=>openContextEditor({},true),
  onOpenChanges:async paths=>{if(await closeObjectEditor())await openTool('changes',false,{mode:'working',path:paths.find(value=>value.startsWith('objects/'))??paths[0]});},
});
async function openObjectEditor(target:ObjectEditorTarget={},resume=false) {
  if(contextEditorOpen&&!await closeContextEditor())return;
  if(transitioning||closePending||clientMaintenance)return;
  const interaction=interactionVersion,current=()=>interaction===interactionVersion&&!closePending;
  if(settingsOpen&&!await settingsWorkspace.close())return;if(!current())return;
  if(managerOpen&&!await manager.close())return;if(!current())return;
  await persistence.pause();if(!current())return;workbench?.dispose();
  if(toolPanel==='knowledge')knowledgeBrowser.hide();if(sourceOpen)sourceBrowser.hide();objectEditorOpen=true;render();if(resume)await objectEditor.resume();else await objectEditor.open(target);rememberSection();
}
async function closeObjectEditor() {
  if(contextEditorOpen)return closeContextEditor();
  if(!objectEditorOpen)return true;
  const interaction=interactionVersion,result=await objectEditor.prepareClose();
  if(!result.ready||interaction!==interactionVersion)return false;
  objectEditor.hide();objectEditorOpen=false;
  if(!sourceOpen&&toolPanel===null)persistence.resume();
  if(toolPanel==='knowledge')await knowledgeBrowser.open(knowledgeBrowser.state());else if(sourceOpen)await sourceBrowser.open();
  if(interaction!==interactionVersion||objectEditorOpen)return false;
  render();return true;
}
const contextWorkspace=createContextWorkspace({locale:()=>state.locale,render,storage:clientCache.storage,flushDraft:()=>clientCache.flush(),
  api:{list:params=>request('context.list',params),get:params=>request('context.get',params),save:params=>request('context.save',params),batches:params=>request('context.batches',params),batchObjects:params=>request('context.batchObjects',params),batchSources:params=>request('context.batchSources',params),membershipPlan:params=>request('context.membershipPlan',params),plan:params=>request('context.plan',params),applyMembership:params=>request('context.applyMembership',params),pending:params=>request('context.pending',params),resume:params=>request('context.resume',params)},
  onClose:closeContextEditor,onChanged:()=>refreshEditingStatus(),onResumeImport:()=>routeWorkspace('imports'),
  onOpenChanges:async paths=>{if(await closeContextEditor())await openTool('changes',false,{mode:'working',path:paths[0]});},
  onViewContext:async contextId=>{const interaction=interactionVersion;if(await closeContextEditor()&&interaction===interactionVersion&&await openTool('knowledge')&&interaction===interactionVersion)await knowledgeBrowser.execute({type:'scope',patch:{type:'selection',selection:{mode:'contexts',contextIds:[contextId]},revision:'working'}});},
});
async function openContextEditor(target:ContextWorkspaceTarget={},resume=false){
  if(transitioning||closePending||clientMaintenance)return;
  const interaction=interactionVersion,current=()=>interaction===interactionVersion&&!closePending;
  if(objectEditorOpen&&!await closeObjectEditor())return;if(!current())return;
  if(settingsOpen&&!await settingsWorkspace.close())return;if(!current())return;
  if(managerOpen&&!await manager.close())return;if(!current())return;
  if(toolPanel==='research'&&!(await researchWorkspace.prepareClose()).ready)return;if(!current())return;
  if(toolPanel==='changes'&&!(await changesWorkspace.prepareClose()).ready)return;if(!current())return;
  await persistence.pause();if(!current())return;workbench?.dispose();
  if(toolPanel==='knowledge')knowledgeBrowser.hide();else if(toolPanel==='research')researchWorkspace.hide();else if(toolPanel==='changes')changesWorkspace.hide();
  if(sourceOpen)sourceBrowser.hide();contextEditorOpen=true;render();if(resume)await contextWorkspace.resume();else await contextWorkspace.open(target);if(current())rememberSection();
}
async function closeContextEditor(){
  if(!contextEditorOpen)return true;
  const interaction=interactionVersion,result=await contextWorkspace.prepareClose();if(!result.ready||interaction!==interactionVersion)return false;
  contextWorkspace.hide();contextEditorOpen=false;
  if(toolPanel==='knowledge')await knowledgeBrowser.open(knowledgeBrowser.state());else if(sourceOpen)await sourceBrowser.open();else if(toolPanel==='research')await researchWorkspace.open();else if(toolPanel==='changes')await changesWorkspace.open();else{persistence.resume();if(data)installWorkbench(transitions.begin());}
  if(interaction!==interactionVersion||contextEditorOpen||objectEditorOpen)return false;render();return true;
}
const researchWorkspace=createResearchWorkspace({locale:()=>state.locale,render,storage:clientCache.storage,flushDraft:()=>clientCache.flush(),
  api:{list:()=>request('research.list',{}),get:id=>request('research.get',{id}),save:(record,expectedHash)=>request('research.save',{record,expectedHash}),history:id=>request('research.history',{id}),readRevision:(id,oid)=>request('research.readRevision',{id,oid})},
  currentContext:()=>learningContext,
  onSaved:envelope=>{const snapshot=guide.snapshot();if(researchCompletesInvestigation(snapshot,envelope)&&snapshot.investigation.scopeKey)guide.observe({type:'research-saved',scopeKey:snapshot.investigation.scopeKey,recordId:envelope.record.id,contentHash:envelope.contentHash});void refreshEditingStatus().catch(()=>{});},
  onClose:()=>returnToExplore(researchReturn),onOpenChanges:async recordId=>{await openTool('changes',false,{mode:'working',path:`research/${recordId}.json`});},onExplore:async selected=>{if(selected.model){if(!await closeTool())return;await openLibrary({datasetId:selected.model.datasetId,revisionId:selected.model.repositoryRevision});if(selected.timeWindow)update(setWindow(state,...selected.timeWindow));if(selected.model.scopeId)enterScope(selected.model.scopeId);if(selected.model.processId)openProcess(selected.model.processId);return;}if(!await openTool('knowledge'))return;const previous=knowledgeBrowser.state();await knowledgeBrowser.open({...previous,query:researchKnowledgeQuery(selected),queryRevision:selected.navigation?.revision??'working',kindMode:selected.navigation?.query.typeIds?.length?'types':'all',scopeDraft:undefined,yearDraft:undefined,fieldIds:[...selected.fieldIds],selectedObjectId:selected.objectIds.length===1?selected.objectIds[0]:null,view:selected.objectIds.length===1?'state':'overview',year:selected.timeWindow?.[0]??null,objectRevision:selected.navigation?.revision??'working',preview:null,objectTrail:[]});},
  onOpenReference:async reference=>{if(reference.modelId&&reference.historicalRef){if(toolPanel==='research'&&researchWorkspace.hasUnsavedChanges()){const result=await researchWorkspace.prepareClose();if(!result.ready)return;}await closeTool();await openLibrary({datasetId:reference.modelId,revisionId:reference.repositoryRevision});lastExplore='paths';const result=await workbench?.execute(`git show ${reference.historicalRef}`);rememberSection();return;}if(reference.objectId){if(!await openTool('knowledge'))return;let year=reference.year;if(!year){const history=await request('knowledge.history',{objectId:reference.objectId,revision:reference.repositoryRevision});year=history.observations[0]?.year;}if(year)await knowledgeBrowser.execute({type:'show-version',reference:{objectId:reference.objectId,year,revision:reference.repositoryRevision,label:'label' in reference?reference.label:reference.title,includeUnreviewed:reference.includeUnreviewed??false}});else if('url' in reference&&reference.url)await bridge().openExternal(reference.url);}},
});
async function stageWithGuide(params:ServiceMethods['repository.stage']['params']) {
  const status=await request('repository.stage',params),data=guide.snapshot().data,requested=new Set(params.paths),adopted=new Set(data.adoptedPaths);
  const paths=status.staged.filter(value=>requested.has(value.path)&&adopted.has(value.path)).map(value=>value.path);
  if(paths.length)guide.observe({type:'changes-staged',tree:status.stagedTree,paths});
  return status;
}
async function commitWithGuide(params:ServiceMethods['repository.commit']['params']) {
  const intent={interaction:interactionVersion,section:returnAfterChanges};
  const stagedTree=guide.snapshot().data.stagedTree,result=await request('repository.commit',params);
  commitReturnIntents.set(result.oid,intent);
  if(stagedTree&&stagedTree===params.expectedTree)guide.observe({type:'data-committed',oid:result.oid,tree:stagedTree});
  return result;
}
const changesWorkspace=createChangesWorkspace({locale:()=>state.locale,render,storage:clientCache.storage,
  contributor:()=>settingsProfile?.values.contributor??null,onEditContributor:()=>openSettings('contributor'),
  api:{status:()=>request('repository.status',{}),changes:params=>request('repository.changes',params),diff:params=>request('repository.diff',params),stagePlan:params=>request('repository.stagePlan',params),stage:stageWithGuide,unstage:params=>request('repository.unstage',params),commit:commitWithGuide,log:params=>request('repository.log',params),branch:params=>request('repository.branch',params),switch:params=>request('repository.switch',params),checkout:params=>request('repository.checkout',params),revert:params=>request('repository.revert',params),abortRevert:()=>request('repository.abortRevert',{})},
  onClose:()=>closeTool(),onResumeImport:()=>routeWorkspace('imports'),onResumeContext:()=>openContextEditor({},true),onStatusChanged:status=>{editingStatus=status;updateNavigationStatus();if(models?.head!==status.head)void refreshModelCatalogForHead(status.head).catch(showError);},onCommitted:async commit=>{const intent=commitReturnIntents.get(commit.oid);commitReturnIntents.delete(commit.oid);models=await request('model.catalog',{revision:'working'});await refreshEditingStatus();if(intent&&intent.interaction===interactionVersion&&toolPanel==='changes'&&!settingsOpen&&!managerOpen&&!objectEditorOpen&&!contextEditorOpen&&!closePending)await returnToExplore(intent.section);},
});
async function leaveTools() {
  if((objectEditorOpen||contextEditorOpen)&&!await closeObjectEditor())return false;
  const interaction=interactionVersion,previous=toolPanel,previousSource=sourceOpen;
  if(toolPanel==='research'&&researchWorkspace.hasUnsavedChanges()) { const result=await researchWorkspace.prepareClose();if(!result.ready)return false; }
  if(toolPanel==='changes'){const result=await changesWorkspace.prepareClose();if(!result.ready)return false;}
  if(interaction!==interactionVersion||previous!==toolPanel||previousSource!==sourceOpen)return false;
  if(toolPanel==='knowledge')knowledgeBrowser.hide();
  else if(toolPanel==='research')researchWorkspace.hide();
  else if(toolPanel==='changes')changesWorkspace.hide();
  if(sourceOpen)sourceBrowser.hide();
  sourceOpen=false;toolPanel=null;return true;
}
async function closeTool() {
  if(!await leaveTools())return false;navigationVersion++;
  lastExplore='paths';persistence.resume();if(data)installWorkbench(transitions.begin());rememberSection();render();void saveWorkspace();return true;
}
async function openTool(panel:NonNullable<typeof toolPanel>,refresh=false,focus?:Parameters<typeof changesWorkspace.open>[0],knowledgeState?:KnowledgeBrowserState) {
  if((objectEditorOpen||contextEditorOpen)&&!await closeObjectEditor())return false;
  if(!refresh&&panel===toolPanel&&!sourceOpen)return true;
  if(transitioning||managerOpen||closePending)return false;
  if(!clientReady){clientFailed=true;renderGuidance();return false;}
  const previous=toolPanel,previousExplore=lastExplore,fromSources=sourceOpen,interaction=interactionVersion;
  if(panel==='research'&&previous!=='research'&&!fromSources){if(previous==='knowledge')learningContext=await knowledgeBrowser.researchContext().catch(()=>null);else if(previous===null&&data)try{learningContext=currentModelResearchContext();}catch{learningContext=null;}if(interaction!==interactionVersion)return false;}
  if(!await leaveTools())return false;
  const version=++navigationVersion;
  await persistence.pause();if(navigationVersion!==version)return false;
  if(panel==='changes'){if(previous!=='changes'&&!fromSources)returnAfterChanges=previous==='research'?'research':previous==='knowledge'?'knowledge':previousExplore;lastLibrary='changes';}
  else{if(panel==='research'&&previous!=='research')researchReturn=previousExplore==='paths'?'paths':'knowledge';lastExplore=panel;}
  workbench?.dispose();toolPanel=panel;error='';rememberSection();
  try { await refreshEditingStatus();if(navigationVersion!==version||toolPanel!==panel)return false;render();if(panel==='knowledge')await knowledgeBrowser.open(knowledgeState);else if(panel==='research')await researchWorkspace.open();else{changesInitialized=true;await changesWorkspace.open(focus);}return navigationVersion===version&&toolPanel===panel; }
  catch(cause){if(navigationVersion===version)showError(cause);return false;}
}
async function openSources(query?:import('../../../../packages/domain/src/knowledge.ts').KnowledgeQuery,destination:'default'|'imports'='default') {
  if((objectEditorOpen||contextEditorOpen)&&!await closeObjectEditor())return false;
  if(transitioning||managerOpen||closePending)return false;
  if(sourceOpen){if(destination==='imports')await sourceBrowser.openImports();return destination==='imports';}
  if(!clientReady){clientFailed=true;renderGuidance();return false;}
  const origin={section:(toolPanel==='knowledge'?'knowledge':lastExplore==='paths'?'paths':'knowledge') as 'paths'|'knowledge',knowledge:knowledgeBrowser.state(),...(!toolPanel&&data?{paths:structuredClone(persisted())}:{})};
  if(toolPanel!==null&&!await leaveTools())return false;
  sourceOrigin=origin;lastLibrary='sources';navigationVersion++;
  const sequence=transitions.begin();transitioning=true;mapDragging=null;workbench?.dispose();
  try { await persistence.pause();if(!transitions.current(sequence))return false;sourceOpen=true;rememberSection();transitioning=false;render();if(destination==='imports')await sourceBrowser.openImports();else await sourceBrowser.open(query);return true; }
  catch(cause){if(transitions.current(sequence)){sourceBrowser.hide();sourceOpen=false;transitioning=false;persistence.resume();if(data)installWorkbench(sequence);showError(cause);}return false;}
}
function modelCommandContext(){return {head:!state.headRevision||state.headRevision===data?.revision.id?state.head:null,comparison:!state.comparisonRevisions||state.comparisonRevisions.every(revision=>revision===data?.revision.id)?state.comparison:null,currentYear:state.view.cursor,scopeId:state.view.scopeId,timeWindow:state.view.timeWindow};}
const terminal=createTerminal({host:terminalHost,locale:()=>state.locale,storage:clientCache.storage,status:()=>editingStatus,navigationVersion:()=>interactionVersion,
  execute:input=>request('command.execute',{...input,scopeRevision:knowledgeBrowser.state().queryRevision??'working',...(data?{contextTarget:{kind:'model' as const,modelId:data.dataset.id,revision:data.revision.id},context:modelCommandContext()}:{})}),complete:input=>request('command.complete',{input,scopeRevision:knowledgeBrowser.state().queryRevision??'working',...(data?{contextTarget:{kind:'model' as const,modelId:data.dataset.id,revision:data.revision.id},context:modelCommandContext()}:{})}),
  onChanges:async()=>{await openTool('changes');},onNavigationError:showError,
  onResult:applyCommandResult,
});
async function applyCommandResult(result:WorkbenchCommandExecution,allowNavigation:boolean) {
    if(!result.ok)return;const interaction=interactionVersion,current=()=>!closePending&&interaction===interactionVersion;
    if(result.effect.type==='repository'){await refreshEditingStatus();models=await request('model.catalog',{revision:'working'});if(allowNavigation&&current()&&['add','unstage','diff','commit','revert','abort-revert'].includes(result.effect.operation))await openTool('changes',true);return;}
    if(result.output.kind==='scope-saved'||result.output.kind==='scope-applied')await refreshEditingStatus();
    if(!allowNavigation||!current())return;
    if(result.effect.type==='scope'){if(await openTool('knowledge')&&current())await knowledgeBrowser.execute({type:'scope',patch:result.effect.patch});return;}
    if(result.output.kind==='scope-plan'){await openContextEditor({contextId:result.output.plan.contextId,planId:result.output.plan.planId});return;}
    if(result.output.kind==='model'&&result.effect.type==='model-compare'&&result.output.execution.output.kind==='diff'){
      const effect=result.effect,diff=result.output.execution.output.diff;const [before,after]=await Promise.all([request('model.read',{datasetId:effect.a.modelId,revision:effect.a.revision}),request('model.read',{datasetId:effect.b.modelId,revision:effect.b.revision})]);
      if(!current())return;if(settingsOpen&&!await settingsWorkspace.close())return;if(!current())return;if(managerOpen&&!await manager.close())return;if(!current()||!await closeTool()||!current())return;if(!data||data.dataset.id!==effect.b.modelId||data.revision.id!==effect.b.revision)await openLibrary({datasetId:effect.b.modelId,revisionId:effect.b.revision});
      if(!current())return;modelComparison={diff,a:effect.a,b:effect.b,before:before.package,after:after.package,commonBaseStatus:result.output.comparison?.commonBaseStatus??'computed'};state={...state,comparison:[diff.a.commitId,diff.b.commitId],comparisonRequestedYears:[diff.a.requestedYear,diff.b.requestedYear],comparisonRevisions:[effect.a.revision,effect.b.revision],view:{...state.view,panel:'compare'}};render();void saveWorkspace();return;
    }
    if(result.output.kind==='model'){
      const target=result.output.target;
      if(settingsOpen&&!await settingsWorkspace.close())return;if(!current())return;
      if(managerOpen&&!await manager.close())return;if(!current())return;
      if(!await closeTool()||!current())return;
      if(!data||data.dataset.id!==target.modelId||data.revision.id!==target.revision)await openLibrary({datasetId:target.modelId,revisionId:target.revision});
      if(!current())return;workbench?.applyExecution(result.output.execution);lastExplore='paths';rememberSection();return;
    }
    const effect=result.effect;
    if(effect.type==='object-preview'||effect.type==='object-checkout'){
      if(!await openTool('knowledge')||!current())return;
      const reference={objectId:effect.reference.objectId,year:effect.reference.year,revision:effect.reference.revision,label:effect.reference.objectId,includeUnreviewed:effect.reference.includeUnreviewed??false};
      if(reference.revision==='working')await knowledgeBrowser.execute({type:'show',objectId:reference.objectId,year:reference.year,includeUnreviewed:reference.includeUnreviewed});
      else await knowledgeBrowser.execute({type:effect.type==='object-checkout'?'show-version':'preview-version',reference});
    }else if(effect.type==='object-history'){if(await openTool('knowledge')&&current())await knowledgeBrowser.execute({type:'observations-version',objectId:effect.target.objectId,revision:effect.target.revision,includeUnreviewed:effect.includeUnreviewed});}
    else if(effect.type==='object-compare'){if(await openTool('knowledge')&&current())await knowledgeBrowser.execute({type:'compare',a:{...effect.a,label:effect.a.objectId,includeUnreviewed:effect.a.includeUnreviewed??false},b:{...effect.b,label:effect.b.objectId,includeUnreviewed:effect.b.includeUnreviewed??false}});}
}
const closePreparation=createClosePreparation({
  freeze:()=>{closePending=true;interruptedOpening=openingLibrary;interruptedTransition=transitioning;if(transitioning)transitions.begin();mapDragging=null;workbench?.dispose();},
  flush:async()=>{terminal.beforeClose();if(contextEditorOpen){const result=await contextWorkspace.prepareClose();if(!result.ready)throw new Error('CONTEXT_INPUT_NOT_SAVED');}if(objectEditorOpen){const result=await objectEditor.prepareClose();if(!result.ready)throw new Error('OBJECT_INPUT_NOT_SAVED');}if(clientMaintenance)throw new Error('LIBRARY_OPERATION_IN_PROGRESS');await persistence.pause();if(toolPanel==='research'){const result=await researchWorkspace.prepareClose();if(!result.ready&&result.reason==='save-failed')throw new Error('RESEARCH_SAVE_FAILED');}if(changesInitialized)await changesWorkspace.prepareClose();await flushClientState();},
  resume:()=>{
    closePending=false;transitioning=false;
    if(managerOpen)return;
    if(sourceOpen||toolPanel!==null){render();return;}
    persistence.resume();
    const interrupted=interruptedOpening,wasTransitioning=interruptedTransition;interruptedOpening=null;interruptedTransition=false;
    if(interrupted&&persistence.status!=='failed'){void openLibrary(interrupted.selected,interrupted.restore);return;}
    openingLibrary=null;if(data&&(!workbench||wasTransitioning))installWorkbench(transitions.begin());render();
  },
  failed:showError,
  hasUnsavedInput:()=>contextEditorOpen&&contextWorkspace.hasUnsavedChanges()||objectEditorOpen&&objectEditor.hasUnsavedChanges()||managerOpen&&manager.hasUnsavedChanges()||settingsOpen&&settingsWorkspace.hasUnsavedChanges()||toolPanel==='research'&&researchWorkspace.hasUnsavedChanges()||changesWorkspace.hasUnsavedChanges(),
});
if(window.gitworld)bridge().onBeforeClose(closePreparation.prepare,closePreparation.cancel);
if(window.gitworld)bridge().onSettingsHostEvent(event=>{if(event.type==='open-settings'){interactionVersion++;void openSettings().catch(showError);}else if(!restoringLibrary)acceptSettings(event.snapshot);});

function scope() { return data?.catalog.scopes.find(s=>s.id===state.view.scopeId); }
function enterScope(id:string) {
  const target=data?.catalog.scopes.find(s=>s.id===id);if(!target)return;
  update(navigate(state,{level:'region',panel:'browse',scopeId:id,processId:null,eventId:null,selectedCommit:null,graphBranch:null,graphRef:null,requestedYear:null,viewport:target.viewBox??data!.catalog.defaults.worldView}));
  guide.observe({type:'scope-chosen',scopeKey:pathScopeKey()});
}
function openProcess(id:string) {
  const process=data?.catalog.processes.find(p=>p.id===id);if(!process)return;
  const target=data!.catalog.scopes.find(s=>s.id===process.scopeIds[0]);
  update(navigate(state,{level:'process',panel:'history',scopeId:target?.id??null,processId:id,eventId:null,selectedCommit:null,graphBranch:null,graphRef:null,requestedYear:null,...(target?.viewBox?{viewport:target.viewBox}:{})}));
  guide.observe({type:'scope-chosen',scopeKey:pathScopeKey()});
}
function timeControls() {
  return `<form id="time-form" class="desktop-time"><span>${t('period')}</span><label>${t('from')}<input name="from" type="number" value="${state.view.timeWindow[0]}" required aria-label="${t('from')}" /></label><label>${t('to')}<input name="to" type="number" value="${state.view.timeWindow[1]}" required aria-label="${t('to')}" /></label><label>${t('at')}<input name="at" type="number" value="${state.view.cursor??''}" aria-label="${t('at')}" /></label><button type="submit">${t('apply')}</button>${button('all-years',t('allYears'))}</form>`;
}
function mapView() {
  const box=state.view.viewport;
  const visible=data!.catalog.scopes.filter(s=>s.location && (!state.view.scopeId||s.id===state.view.scopeId||s.parentId===state.view.scopeId));
  return `<div class="desktop-map"><svg viewBox="${box.x} ${box.y} ${box.width} ${box.height}" role="img" aria-label="${t('scope')}" class="world-land">${land}</svg><svg class="map-label-leaders" aria-hidden="true"></svg><div class="map-scope-pins">${visible.map(s=>{const x=(s.location!.x-box.x)/box.width*100,y=(s.location!.y-box.y)/box.height*100;return x<0||x>100||y<0||y>100?'':button('scope',`<strong>${esc(text(s.name))}</strong>`, `class="scope-pin" data-id="${esc(s.id)}" data-map-x="${s.location!.x}" data-map-y="${s.location!.y}" style="left:${x}%;top:${y}%"`);}).join('')}</div><div class="map-toolbar">${button('zoom-in','+',`aria-label="${t('zoomIn')}"`)}${button('zoom-out','−',`aria-label="${t('zoomOut')}"`)}${button('fit','⌖',`aria-label="${t('fit')}"`)}</div><span class="map-attribution">${t('contextOnly')}</span></div>`;
}
function overview() {
  const current=scope();
  const processes=data!.catalog.processes.filter(p=>(!current||p.scopeIds.includes(current.id))&&p.coverage[0]<=state.view.timeWindow[1]&&p.coverage[1]>=state.view.timeWindow[0]);
  const [from,to]=state.view.timeWindow;const span=Math.max(1,to-from);
  return `<section class="overview-content"><div class="overview-heading"><div class="eyebrow">${t('scope')}</div><h1 tabindex="-1">${current?esc(text(current.name)):t('world')} <span>${yearText(from,state.locale)}–${yearText(to,state.locale)}</span></h1>${current?`<p>${esc(text(current.summary))}</p>`:''}</div>${mapView()}<section class="process-overview"><div class="section-heading"><h2>${t('processes')}</h2><span>${processes.length}</span></div>${processes.length?processes.map(p=>{const records=data!.history.commits.filter(c=>p.branchIds.includes(c.branchId)&&c.year>=from&&c.year<=to);return `<button class="process-strip" type="button" data-app="process" data-id="${esc(p.id)}"><span><strong>${esc(text(p.name))}</strong><small>${coverageText(state.locale,'process',p.branchIds.length,records.length)}</small></span><span class="process-line"><i style="left:${Math.max(0,(p.coverage[0]-from)/span*100)}%;right:${Math.max(0,(to-p.coverage[1])/span*100)}%"></i>${records.map(c=>`<b style="left:${(c.year-from)/span*100}%" title="${esc(`${yearText(c.year,state.locale)}: ${text(c.title)}`)}"></b>`).join('')}</span></button>`;}).join(''):`<p class="empty-copy">${t('noProcesses')}</p>`}</section></section>`;
}
function titlebar() {
  return `<header class="topbar"><div class="titlebar-leading" data-native-titlebar-anchor><div class="brand">${icon('branch')}<strong>GitWorld</strong></div><span class="titlebar-divider" aria-hidden="true"></span><span class="library-label">${workspaceCopy(state.locale,'localLibrary')}</span>${editingStatus?`<span class="workspace-revision" title="${workspaceCopy(state.locale,'dataRevision')}: ${esc(editingStatus.head)}"><span class="sr-only">${workspaceCopy(state.locale,'dataRevision')}</span>${esc(editingStatus.branch??workspaceCopy(state.locale,'detached'))} <code>${esc(editingStatus.head.slice(0,8))}</code></span>`:''}</div><div class="desktop-top-actions">${button('settings',settingsShellCopy(state.locale,'settings'),`class="titlebar-action" ${settingsOpen?'aria-current="page"':''}`)}</div></header>`;
}
function modeNavigation() {
  const library=contextEditorOpen||objectEditorOpen||managerOpen||sourceOpen||toolPanel==='changes';
  return `<nav class="workspace-modes" aria-label="${workspaceCopy(state.locale,'workspace')}">${button('activity-explore',workspaceCopy(state.locale,'explore'),!settingsOpen&&!library?'aria-current="page"':'')}${button('activity-library',workspaceCopy(state.locale,'library'),!settingsOpen&&library?'aria-current="page"':'')}<span class="workspace-mode-spacer"></span>${library?button('return-explore',workspaceCopy(state.locale,'returnExplore')):''}${button('changes',workspaceCopy(state.locale,'changes')+(editingStatus?` · ${new Set([...editingStatus.staged,...editingStatus.unstaged].map(value=>value.path)).size}`:''),'data-change-count')}${guide.entry()}</nav>`;
}
function resourceLinks(library=false) {
  const selected=contextEditorOpen?'context-edit':objectEditorOpen?'object-edit':managerOpen?'manager':sourceOpen?'sources':toolPanel??'paths';
  const items=library?[['sources','sources'],['changes','changes'],['manager','advanced']]:[['knowledge','objects'],['paths','paths'],['research','research']];
  return `<nav class="workspace-resources" aria-label="${workspaceCopy(state.locale,library?'library':'views')}">${items.map(([action,label])=>button(action,workspaceCopy(state.locale,label as 'objects'),selected===action?'aria-current="page"':'')).join('')}</nav>`;
}
function decorateResources() {
  const library=contextEditorOpen||objectEditorOpen||managerOpen||sourceOpen||toolPanel==='changes';
  const rail=app.querySelector('.context-editor-layout>.sidebar,.knowledge-scope,.research-sidebar,.changes-list-panel,.manager-section-rail,.sidebar,.source-nav');
  if(rail&&!rail.querySelector('.workspace-resources'))rail.insertAdjacentHTML('afterbegin',resourceLinks(library));
  if(sourceOpen)app.querySelector('[data-source="close"]')?.remove();
  if(!library&&!settingsOpen&&data&&toolPanel===null){
    const side=app.querySelector('.sidebar');
    if(side&&!side.querySelector('[data-model-picker]'))side.querySelector('.workspace-resources')?.insertAdjacentHTML('afterend',`<label class="model-picker">${workspaceCopy(state.locale,'modelPackage')}<select data-model-picker aria-label="${workspaceCopy(state.locale,'modelPackage')}">${models?.models.map(model=>`<option value="${esc(model.datasetId)}" ${model.datasetId===data!.dataset.id?'selected':''}>${esc(text(model.name))}</option>`).join('')??''}</select></label><label class="model-picker">${workspaceCopy(state.locale,'dataRevision')}<select data-model-revision aria-label="${workspaceCopy(state.locale,'dataRevision')}">${data!.revision.id!==models?.head&&data!.revision.id!=='working'?`<option value="${esc(data!.revision.id)}">${esc(data!.revision.id.slice(0,8))}</option>`:''}<option value="${esc(models?.head??data!.revision.id)}" ${data!.revision.id===models?.head?'selected':''}>${workspaceCopy(state.locale,'committed')}</option><option value="working" ${data!.revision.id==='working'?'selected':''}>${workspaceCopy(state.locale,'working')}</option></select></label>`);
    const tabs=app.querySelector('.workbench-tabs');if(tabs&&!tabs.querySelector('[data-app="research-current"]'))tabs.insertAdjacentHTML('beforeend',button('research-current',workspaceCopy(state.locale,'saveResearch'),'class="tab-action"'));
  }
  if(!objectEditorOpen&&!contextEditorOpen&&toolPanel==='knowledge'&&clientCache.get('object-input'))app.querySelector('.knowledge-scope h2')?.insertAdjacentHTML('afterend',`<div class="knowledge-filter-actions">${button('object-edit',workspaceCopy(state.locale,'resumeEdit'),'class="knowledge-button"')}</div>`);
  if(!contextEditorOpen&&toolPanel==='knowledge'&&clientCache.get('context-input'))app.querySelector('.knowledge-scope h2')?.insertAdjacentHTML('afterend',`<div class="knowledge-filter-actions">${button('context-edit',contextCopy(state.locale,'resumeEdit'),'class="knowledge-button"')}</div>`);
  if(toolPanel==='knowledge'&&adoptedObjects.length){const canvas=app.querySelector('.knowledge-canvas');if(canvas&&!canvas.querySelector('.adopted-results'))canvas.insertAdjacentHTML('afterbegin',`<details class="adopted-results"><summary>${workspaceCopy(state.locale,'adopted')} · ${adoptedTotal}</summary><p>${workspaceCopy(state.locale,'shown')} ${adoptedObjects.length} / ${adoptedTotal}</p><div>${adoptedObjects.map(value=>button('adopted-object',esc(value.label),`data-id="${esc(value.id)}"`)).join('')}</div>${adoptedIdentity?button('organize-import',contextCopy(state.locale,'addMaterial')):''}${sourceOrigin?button('return-scope',workspaceCopy(state.locale,'returnScope')):''}</details>`);}
}
async function returnToExplore(section:'paths'|'knowledge'|'research'=lastExplore) {
  if(managerOpen&&!await manager.close())return false;
  if(settingsOpen&&!await settingsWorkspace.close())return false;
  if(section==='paths')return closeTool();
  return openTool(section);
}
async function compareWithChecked(reference:string) {
  if(!data||!state.head)return;
  const interaction=interactionVersion,a={kind:'model' as const,modelId:data.dataset.id,revision:state.headRevision??data.revision.id,ref:`commit:${state.head}`},b={kind:'model' as const,modelId:data.dataset.id,revision:data.revision.id,ref:reference};
  const result=await request('command.execute',{input:{intent:{family:'history',target:{kind:'model',modelId:a.modelId,revision:a.revision},intent:{type:'compare',a,b},context:{head:null}}}});
  terminal.record(result);if(result.ok)await applyCommandResult(result,interaction===interactionVersion);
}
async function openModelReference(target:import('@gitworld/contracts').ModelHistoricalReference) {
  if(target.kind!=='model'||typeof target.modelId!=='string'||!/^[a-f0-9]{40}$/.test(target.revision)||typeof target.ref!=='string')throw new Error('INVALID_REQUEST');
  if(!await closeTool())return;
  if(!data||data.dataset.id!==target.modelId||data.revision.id!==target.revision)await openLibrary({datasetId:target.modelId,revisionId:target.revision});
  await workbench?.execute(`git show ${target.ref}`);
}
function modelReferenceStrip() {
  if(!data)return '';
  const slot=(title:string,id:string|null,revision:string|null|undefined,requestedYear:number|null)=>{const actual=revision??data!.revision.id,pkg=modelPackages.get(`${data!.dataset.id}\0${actual}`)??data!,commit=pkg.history.commits.find(value=>value.id===id),target={kind:'model',modelId:data!.dataset.id,revision:actual,ref:`commit:${id}`};return `<div class="model-reference-slot"><small>${esc(title)}</small>${id?button('model-reference',`${esc(commit?text(commit.title):id)} · ${esc(requestedYear!==null?yearText(requestedYear,state.locale):commit?yearText(commit.year,state.locale):'')}`,`data-id="${esc(JSON.stringify(target))}"`):`<span>${state.locale==='zh-CN'?'未选择':'Not selected'}</span>`}${id?`<code>${esc(actual.slice(0,8))}</code>`:''}</div>`;};
  return `<section class="model-reference-strip" aria-label="${state.locale==='zh-CN'?'固定的历史参照':'Fixed historical references'}">${slot(state.locale==='zh-CN'?'已检出状态':'Checked state',state.head,state.headRevision,state.headRequestedYear)}${slot('A',state.comparison?.[0]??null,state.comparisonRevisions?.[0],state.comparisonRequestedYears?.[0]??null)}${slot('B',state.comparison?.[1]??null,state.comparisonRevisions?.[1],state.comparisonRequestedYears?.[1]??null)}</section>`;
}
function currentModelResearchContext():ResearchContext {
  if(!data)throw new Error('REVISION_NOT_FOUND');
  const checkedBasis=state.view.panel!=='compare'&&(state.view.panel==='snapshot'||!state.view.selectedCommit)?state.headRevision:null;
  const basis=checkedBasis&&checkedBasis!==data.revision.id?modelPackages.get(`${data.dataset.id}\0${checkedBasis}`):data;
  if(!basis)throw new Error('REVISION_NOT_FOUND');
  return state.view.panel==='compare'&&modelComparison?modelComparisonResearch(modelComparison,state.locale):modelResearchContext(basis,state,checkedBasis??ref().revisionId,state.locale);
}
async function saveModelInvestigation() {
  if(!data)return;
  try{learningContext=currentModelResearchContext();researchReturn='paths';if(await openTool('research'))await researchWorkspace.newRecord(learningContext);}
  catch(cause){error=workspaceCopy(state.locale,cause instanceof Error&&cause.message==='UNCOMMITTED_MODEL'?'uncommittedModel':'selectState');render();}
}
function renderWorkspace(markup:string) {
  const workspace=terminalHost.parentElement;
  if(workspace?.parentElement===app&&workspace.classList.contains('workspace')){
    const previous=workspace.querySelector<HTMLElement>('.knowledge-shell[data-knowledge-scroll-key]');
    const scroll=previous?{key:previous.dataset.knowledgeScrollKey,top:previous.scrollTop,left:previous.scrollLeft}:null;
    const title=previous?.querySelector<HTMLElement>('.knowledge-view-heading')?.querySelector<HTMLElement>('h1');
    const focusedRegion=title===document.activeElement?'h1':previous?.querySelector('.knowledge-inspector')===document.activeElement?'.knowledge-inspector':null;
    const anchor=focusedRegion?previous?.querySelector<HTMLElement>(focusedRegion):null;
    const relativeTop=anchor&&previous?anchor.getBoundingClientRect().top-previous.getBoundingClientRect().top:null;
    const parsed=document.createElement('div');parsed.innerHTML=markup;
    const replacement=parsed.firstElementChild;
    if(replacement instanceof HTMLElement&&replaceChildrenAround(workspace,replacement,terminalHost)){
      syncElementAttributes(workspace,replacement);
      return ()=>{
        const next=workspace.querySelector<HTMLElement>('.knowledge-shell[data-knowledge-scroll-key]');
        if(next&&scroll&&next.dataset.knowledgeScrollKey===scroll.key){
          next.scrollTop=scroll.top;next.scrollLeft=scroll.left;
          const focused=focusedRegion?next.querySelector<HTMLElement>(focusedRegion):null;
          if(focused){
            if(relativeTop!==null)next.scrollTop+=focused.getBoundingClientRect().top-next.getBoundingClientRect().top-relativeTop;
            focused.setAttribute('tabindex','-1');focused.focus({preventScroll:true});
          }
        }
      };
    }
  }
  app.innerHTML=markup;
}
function render() {
  if(!startupReady){renderStartup();return;}
  if(transitioning||closePending)return;
  let restoreScroll:ReturnType<typeof renderWorkspace>;
  try {
  document.documentElement.lang=state.locale;
  if(managerOpen){manager.render();return;}
  if(settingsOpen){
    if(!settingsHost.isConnected){app.innerHTML=`<div class="workspace settings-workspace">${data?titlebar():`<header class="topbar"><div class="titlebar-leading" data-native-titlebar-anchor><div class="brand">${icon('branch')}<strong>GitWorld</strong></div></div></header>`}${modeNavigation()}</div>`;app.firstElementChild!.append(settingsHost);settingsWorkspace.render();}
    renderSettingsNotice();
    return;
  }
  if(contextEditorOpen){restoreScroll=renderWorkspace(`<div class="workspace tool-workspace context-editor-workspace">${titlebar()}${modeNavigation()}<div class="context-editor-layout"><aside class="sidebar">${resourceLinks(true)}</aside>${contextWorkspace.content()}</div></div>`);return;}
  if(objectEditorOpen){restoreScroll=renderWorkspace(`<div class="workspace tool-workspace object-workspace">${titlebar()}${modeNavigation()}<div class="object-editor-layout"><aside class="sidebar">${resourceLinks(true)}</aside>${objectEditor.content()}</div></div>`);return;}
  if(sourceOpen||toolPanel!==null){
    const content=sourceOpen?sourceBrowser.content():toolPanel==='knowledge'?knowledgeBrowser.content():toolPanel==='research'?researchWorkspace.content():changesWorkspace.content();
    restoreScroll=renderWorkspace(`<div class="workspace source-workspace tool-workspace">${data?titlebar():''}${modeNavigation()}${error?`<div class="app-notice" role="alert">${esc(error)}${button('dismiss',t('dismiss'))}</div>`:''}${content}</div>`);
    return;
  }
  workbench?.beforeRender();
  if(!data||!workbench){app.innerHTML=`<div class="startup"><h1>GitWorld</h1><p>${error?esc(error):t('noData')}</p><p>${window.gitworld?t('createData'):t('installOnly')}</p>${button('reload',t('retry'))}${window.gitworld?button('sources',sourceCopy(state.locale,'findData'))+button('settings',settingsShellCopy(state.locale,'settings'))+button('manager',t('library')):''}${guide.entry()}<select id="language" aria-label="${t('language')}"><option value="en" ${state.locale==='en'?'selected':''}>English</option><option value="zh-CN" ${state.locale==='zh-CN'?'selected':''}>简体中文</option></select></div>`;return;}
  const current=scope(),process=data.catalog.processes.find(p=>p.id===state.view.processId);
  const roots=data.catalog.scopes.filter(s=>!s.parentId);
  const related=current?data.catalog.processes.filter(p=>p.scopeIds.includes(current.id)&&p.coverage[0]<=state.view.timeWindow[1]&&p.coverage[1]>=state.view.timeWindow[0]):[];
  restoreScroll=renderWorkspace(`<div class="workspace level-${state.view.level} panel-${state.view.panel}">${titlebar()}${modeNavigation()}${error?`<div class="app-notice" role="alert">${esc(error)}${button('dismiss',t('dismiss'))}</div>`:''}<nav class="navigation-bar" aria-label="${t('menu')}"><div class="breadcrumb-trail">${button('back',icon('back'),`class="navigation-back" aria-label="${t('back')}" ${!state.trail.length?'disabled':''}`)}${button('world',t('world'))}${current?`<span class="breadcrumb-divider" aria-hidden="true">/</span>${button('scope',esc(text(current.name)),`data-id="${esc(current.id)}"`)}`:''}${process?`<span class="breadcrumb-divider" aria-hidden="true">/</span><span class="breadcrumb-current" aria-current="page" title="${esc(text(process.name))}">${esc(text(process.name))}</span>`:''}</div>${state.view.level!=='world'||workbench.active()?button('world',`${icon('globe')}<span>${t('returnWorld')}</span>`,`class="return-world" aria-label="${t('returnWorld')}"`):''}</nav><div class="workspace-body"><aside class="sidebar"><div class="sidebar-label">${t('scope')}</div>${button('world',t('world'),`class="scope-nav ${!current?'active':''}"`)}${roots.map(s=>button('scope',esc(text(s.name)),`data-id="${esc(s.id)}" class="scope-nav ${s.id===current?.id?'active':''}"`)).join('')}${related.length?`<div class="sidebar-label">${t('processes')}</div>`:''}${related.map(p=>button('process',esc(text(p.name)),`data-id="${esc(p.id)}" class="scope-nav ${p.id===process?.id?'active':''}"`)).join('')}${workbench.sidebar()}<div class="sidebar-coverage">${t('coverage')}<strong>${coverageText(state.locale,'coverage',data.catalog.scopes.length,data.history.commits.length)}</strong></div></aside><main class="main-stage">${modelReferenceStrip()}${workbench.active()?workbench.tabs():''}${state.view.panel==='compare'&&modelComparison?renderModelComparison(modelComparison,state.locale):workbench.active()?workbench.content():overview()}${timeControls()}</main>${state.view.panel==='history'?workbench.inspector():''}</div><footer class="statusbar"><span>${workspaceCopy(state.locale,'modelPackage')} · ${esc(text(data.dataset.name))} · <code>${esc(data.revision.id==='working'?workspaceCopy(state.locale,'working'):data.revision.id.slice(0,8))}</code></span><span data-save-state>${t(saving?'saving':'saved')}</span></footer></div>`);
  workbench.afterRender();
  updateSaveIndicator();
  alignMapPins();
  } finally { if(!managerOpen&&!settingsOpen)decorateResources();restoreScroll?.();if(clientReady&&!settingsOpen&&!managerOpen){const workspace=app.querySelector('.workspace');if(workspace&&terminalHost.parentElement!==workspace)workspace.append(terminalHost);terminal.render();}renderGuidance(); }
}

function renderSettingsNotice() {
  if(!settingsOpen)return;
  const root=app.querySelector('.settings-workspace');if(!root)return;
  let notice=root.querySelector<HTMLElement>('[data-settings-global-error]');
  if(!error){notice?.remove();return;}
  if(!notice){notice=document.createElement('div');notice.className='app-notice';notice.dataset.settingsGlobalError='';notice.setAttribute('role','alert');root.insertBefore(notice,settingsHost);}
  notice.innerHTML=`<span>${esc(error)}</span>${button('dismiss',t('dismiss'))}`;
}

function alignMapPins() {
  const element=document.querySelector<HTMLElement>('.desktop-map');if(!element)return;
  const bounds=element.getBoundingClientRect(),box=state.view.viewport;
  const scale=Math.min(bounds.width/box.width,bounds.height/box.height),left=(bounds.width-box.width*scale)/2,top=(bounds.height-box.height*scale)/2;
  const pins=Array.from(element.querySelectorAll<HTMLElement>('[data-map-x]'));
  const labels=placeMapLabels(bounds.width,bounds.height,pins.map((pin,index)=>({id:String(index),x:left+(Number(pin.dataset.mapX)-box.x)*scale,y:top+(Number(pin.dataset.mapY)-box.y)*scale,width:pin.offsetWidth,height:pin.offsetHeight})));
  labels.forEach(label=>{const pin=pins[Number(label.id)];pin.style.left=`${label.centerX}px`;pin.style.top=`${label.centerY}px`;});
  const leaders=element.querySelector<SVGSVGElement>('.map-label-leaders');
  if(leaders){leaders.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);leaders.innerHTML=labels.map(label=>`<path d="M${label.x} ${label.y}L${label.lineX} ${label.lineY}"/><circle cx="${label.x}" cy="${label.y}" r="3"/>`).join('');}
}
window.addEventListener('resize',alignMapPins);

async function routeWorkspace(action:string,id?:string) {
  const interaction=interactionVersion,current=()=>interaction===interactionVersion&&!closePending;
  const inLibrary=contextEditorOpen||objectEditorOpen||managerOpen||sourceOpen||toolPanel==='changes';
  if(!settingsOpen&&(action==='activity-library'&&inLibrary||action==='activity-explore'&&!inLibrary))return;
  if(action==='context-edit'){await openContextEditor({},true);return;}
  if(action==='organize-import'&&adoptedIdentity){const contextIds=knowledgeBrowser.state().query.contextIds;await openContextEditor({...(contextIds?.length===1?{contextId:contextIds[0]}:{}),importIdentity:adoptedIdentity});return;}
  if(action==='object-edit'){await openObjectEditor({},true);return;}
  if(action==='settings'){await openSettings();return;}
  if(settingsOpen&&!await settingsWorkspace.close())return;
  if(!current())return;
  if(managerOpen&&action!=='manager'&&!await manager.close())return;
  if(!current())return;
  if(action==='activity-explore'||action==='return-explore')await returnToExplore();
  else if(action==='activity-library'){if(lastLibrary==='manager')await openManager();else if(lastLibrary==='changes')await openTool('changes');else await openSources();}
  else if(action==='model-reference'&&id)await openModelReference(JSON.parse(id));
  else if(action==='research-current')await saveModelInvestigation();
  else if(action==='return-scope'&&sourceOrigin){const origin=structuredClone(sourceOrigin);if(origin.section==='paths'){if(await closeTool()&&current()&&origin.paths)await openLibrary(origin.paths.dataset,origin.paths);}else if(await openTool('knowledge')&&current()&&origin.knowledge)await knowledgeBrowser.open(origin.knowledge);}
  else if(action==='adopted-object'&&id){if(await openTool('knowledge'))await knowledgeBrowser.execute({type:'show',objectId:id});}
  else if(action==='paths')await closeTool();
  else if(action==='knowledge'||action==='research'||action==='changes')await openTool(action);
  else if(action==='sources')await openSources(!toolPanel&&data?{time:[...state.view.timeWindow],includeUndated:true,includeUnlocated:true}:undefined);
  else if(action==='imports')await openSources(undefined,'imports');
  else if(action==='manager')await openManager();
  else if(action==='release'&&id&&data)await openLibrary({datasetId:data.dataset.id,revisionId:id});
}
const fromTerminalEvent=(event:Event)=>event.composedPath().includes(terminalHost)||!!(event.target as HTMLElement)?.closest?.('.global-terminal');
for(const kind of ['click','input','change','keydown']as const)document.addEventListener(kind,event=>{
  const target=event.target as HTMLElement;
  if(!target?.closest?.('.global-terminal')||kind==='click'&&target.closest('[data-terminal="result"],[data-terminal="changes"]'))interactionVersion++;
},true);
app.addEventListener('click',event=>{
  if(fromTerminalEvent(event))return;
  if(closePending)return;
  const target=(event.target as HTMLElement).closest<HTMLElement>('button,a');if(!target)return;
  if(target.dataset.onboarding){if(!clientMaintenance)void guide.click(target);return;}
  if(target.tagName==='A'){event.preventDefault();const url=(target as HTMLAnchorElement).href;void bridge().openExternal(url).catch(showError);return;}
  const globalAction=target.dataset.app;
  if(globalAction==='dismiss'){error='';render();return;}
  if(globalAction&&['activity-explore','activity-library','return-explore','model-reference','research-current','return-scope','adopted-object','object-edit','context-edit','organize-import','paths','knowledge','research','changes','sources','manager','settings','release'].includes(globalAction)){void routeWorkspace(globalAction,target.dataset.id).catch(showError);return;}
  if(settingsOpen){void settingsWorkspace.click(target);return;}
  if(contextEditorOpen){void contextWorkspace.click(target);return;}
  if(objectEditorOpen){void objectEditor.click(target);return;}
  if(toolPanel==='knowledge'){void knowledgeBrowser.click(target);return;}
  if(toolPanel==='research'){void researchWorkspace.click(target);return;}
  if(toolPanel==='changes'){void changesWorkspace.click(target);return;}
  if(managerOpen){void manager.click(target);return;}
  if(sourceOpen){void sourceBrowser.click(target);return;}
  if(transitioning)return;
  if(target.dataset.wb){workbench?.click(target);return;}
  const action=target.dataset.app;
  if(action==='scope')enterScope(target.dataset.id!);
  else if(action==='process')openProcess(target.dataset.id!);
  else if(action==='world')update(returnToLevel(state,'world'));
  else if(action==='back')update(returnOne(state));
  else if(action==='dismiss'){error='';render();}
  else if(action==='reload')void openLibrary();
  else if(action==='release'&&data)void openLibrary({datasetId:data.dataset.id,revisionId:target.dataset.id!});
  else if(action==='manager')void openManager();
  else if(action==='sources')void openSources();
  else if(action==='all-years'&&data){const years=data.history.commits.map(c=>c.year);update(setWindow(state,Math.min(...years),Math.max(...years)));}
  else if((action==='zoom-in'||action==='zoom-out'||action==='fit')&&data){const v=state.view.viewport,f=action==='zoom-in'?.75:1.33;const next=action==='fit'?scope()?.viewBox??data.catalog.defaults.worldView:{x:v.x+(v.width-v.width*f)/2,y:v.y+(v.height-v.height*f)/2,width:Math.min(1800,Math.max(80,v.width*f)),height:Math.min(1000,Math.max(40,v.height*f))};update({...state,view:{...state.view,viewport:next}});}
});
app.addEventListener('submit',event=>{
  if(fromTerminalEvent(event))return;
  event.preventDefault();const form=event.target as HTMLFormElement;
  if(closePending)return;
  if(settingsOpen){void settingsWorkspace.submit(form);return;}
  if(contextEditorOpen){void contextWorkspace.submit(form);return;}
  if(objectEditorOpen){void objectEditor.submit(form);return;}
  if(managerOpen){void manager.submit(form);return;}
  if(sourceOpen){void sourceBrowser.submit(form);return;}
  if(toolPanel==='knowledge'){void knowledgeBrowser.submit(form);return;}
  if(toolPanel==='research'){void researchWorkspace.submit(form);return;}
  if(toolPanel==='changes'){void changesWorkspace.submit(form);return;}
  if(transitioning)return;
  if(workbench?.submit(form))return;
  if(form.id==='time-form'){const values=new FormData(form),from=Number(values.get('from')),to=Number(values.get('to')),at=String(values.get('at')??'').trim();if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from===0||to===0||from>to||at&&(!Number.isSafeInteger(Number(at))||Number(at)===0)){error=t('invalidTime');render();return;}update({...setWindow(state,from,to),view:{...setWindow(state,from,to).view,cursor:at?Number(at):null}});}
});
app.addEventListener('input',event=>{if(fromTerminalEvent(event))return;if(transitioning||closePending||settingsOpen)return;if(contextEditorOpen){contextWorkspace.input(event.target as HTMLInputElement);return;}if(objectEditorOpen){objectEditor.input(event.target as HTMLInputElement);return;}if(sourceOpen){sourceBrowser.input(event.target as HTMLInputElement);return;}if(toolPanel==='knowledge'){knowledgeBrowser.input(event.target as HTMLInputElement);return;}if(toolPanel==='research'){researchWorkspace.input(event.target as HTMLInputElement);return;}if(toolPanel==='changes'){changesWorkspace.input(event.target as HTMLInputElement);return;}if(!managerOpen)workbench?.input(event.target as HTMLInputElement);});
app.addEventListener('change',event=>{
  if(fromTerminalEvent(event))return;
  const input=event.target as HTMLSelectElement;
  if(transitioning||closePending)return;
  if(input.matches('[data-model-revision]')&&data)void openLibrary({datasetId:data.dataset.id,revisionId:input.value});
  else if(input.matches('[data-model-picker]')){const model=models?.models.find(model=>model.datasetId===input.value);if(model)void openLibrary({datasetId:model.datasetId,revisionId:model.headContentHash?models!.head:'working'});}
  else if(input.id==='language'){void saveGeneralPreference({locale:input.value as HistoryLocale}).catch(showError);}
  else if(settingsOpen)void settingsWorkspace.change(input);
  else if(contextEditorOpen)void contextWorkspace.change(input);
  else if(objectEditorOpen)void objectEditor.change(input);
  else if(managerOpen)void manager.change(input);
  else if(sourceOpen)void sourceBrowser.change(input);
  else if(toolPanel==='knowledge')void knowledgeBrowser.change(input);
  else if(toolPanel==='research')void researchWorkspace.change(input);
  else if(toolPanel==='changes')void changesWorkspace.change(input);
  else if(input.id==='release'&&data)void openLibrary({datasetId:data.dataset.id,revisionId:input.value});
});
app.addEventListener('keydown',event=>{
  if(fromTerminalEvent(event))return;
  if(closePending)return;
  if(settingsOpen){void settingsWorkspace.key(event);return;}
  if(contextEditorOpen){contextWorkspace.key(event);return;}
  if(objectEditorOpen){objectEditor.key(event);return;}
  if((event.target as HTMLElement).closest('[data-onboarding-panel]')){void guide.key(event);return;}
  if(event.key==='Escape') { const menu=app.querySelector<HTMLDetailsElement>('.release-switcher[open]');if(menu){menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus();event.preventDefault();return;} }
  if(toolPanel==='knowledge')knowledgeBrowser.key(event);
  else if(toolPanel==='research')researchWorkspace.key(event);
  else if(toolPanel==='changes')changesWorkspace.key(event);
  else if(!managerOpen&&!sourceOpen&&!transitioning)workbench?.key(event);
});
document.addEventListener('click',event=>{if(!(event.target as HTMLElement).closest('.release-switcher')){const menu=app.querySelector<HTMLDetailsElement>('.release-switcher[open]');if(menu)menu.open=false;}});
app.addEventListener('pointerdown',event=>{if((event.target as HTMLElement).closest('.desktop-map')&&!(event.target as HTMLElement).closest('button'))mapDragging={x:event.clientX,y:event.clientY,view:{...state.view.viewport}};});
window.addEventListener('pointerup',event=>{if(!mapDragging)return;const start=mapDragging;mapDragging=null;const rect=document.querySelector('.desktop-map')?.getBoundingClientRect();if(!rect||Math.abs(event.clientX-start.x)+Math.abs(event.clientY-start.y)<4)return;const scale=Math.min(rect.width/start.view.width,rect.height/start.view.height);update({...state,view:{...state.view,viewport:{...start.view,x:start.view.x-(event.clientX-start.x)/scale,y:start.view.y-(event.clientY-start.y)/scale}}});});
fetch('./world-land.svg').then(r=>{if(!r.ok)throw new Error('Map unavailable');return r.text();}).then(svg=>{const doc=new DOMParser().parseFromString(svg,'image/svg+xml');land=doc.documentElement.innerHTML;render();}).catch(()=>{land='';});
guidanceHost.addEventListener('click',event=>{if(closePending||clientMaintenance)return;const target=(event.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;if(target.dataset.clientState)void handleClientAction(target.dataset.clientState);else void guide.click(target);});
guidanceHost.addEventListener('keydown',event=>{if(!closePending)void guide.key(event);});
app.addEventListener('focusin',renderGuidance);
app.addEventListener('focusout',()=>queueMicrotask(renderGuidance));
app.addEventListener('toggle',event=>{const element=event.target as HTMLDetailsElement;if(!element.matches('.field-evidence')||!element.open||!element.dataset.evidenceVersion||!element.dataset.evidenceField||!element.querySelector('.evidence-locator,.wb-source'))return;const scopeKey=guide.snapshot().investigation.scopeKey;if(data&&scopeKey?.startsWith(`paths:${data.dataset.id}:`))guide.observe({type:'evidence-inspected',scopeKey,evidenceKey:JSON.stringify([ref(),element.dataset.evidenceVersion,element.dataset.evidenceField])});},true);
renderStartup();
void (async()=>{try{applicationInfo=await loadApplicationInfo();}catch{/* Settings displays an explicit unavailable value. */}try{await initializeClientSettings();}catch{clientFailed=true;renderGuidance();}startupReady=true;await openLibrary();if(clientReady)await restoreWorkspaceSection();})();
