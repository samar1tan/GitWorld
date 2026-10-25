import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, Menu, screen, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateServiceRequest, type LibrarySummary, type ServiceResponse, type SettingsSnapshot } from '@gitworld/contracts';
import { IPC } from './channels.ts';
import { APPLICATION_URL, CONTENT_SECURITY_POLICY, allowedExternalUrl, isApplicationUrl, resolveAsset, safeRequestId } from './security.ts';
import { FileTokenRegistry, isFilePurpose } from './file-tokens.ts';
import { UtilityBridge } from './utility-bridge.ts';
import { hostMessages, settingsHostMessages } from './host-messages.ts';
import { fitWindow, VIEW_SHORTCUTS } from './window-preferences.ts';
import { CloseHandshake } from './close-handshake.ts';
import { nativeTitlebarPosition } from './titlebar-position.ts';
import { createSettingsHostCoordinator, type NativeZoomDirection } from './settings-host.ts';

app.setName('GitWorld');
app.enableSandbox();
const buildMetadata = JSON.parse(readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')) as { internal?: boolean; buildId?: string; distribution?: string; renderer?:boolean };
if (app.isPackaged && (buildMetadata.distribution === 'internal' || buildMetadata.internal === true)) {
  app.setName('GitWorld Internal');
  const profileId = /^\d+$/.test(buildMetadata.buildId || '') ? buildMetadata.buildId! : 'internal';
  app.setPath('userData', path.join(app.getPath('appData'), 'GitWorld Internal QA', profileId));
}
const smoke = process.argv.includes('--gitworld-smoke');
if (smoke && process.env.GITWORLD_SMOKE_USER_DATA) app.setPath('userData', process.env.GITWORLD_SMOKE_USER_DATA);
const developmentProfileArgument = !app.isPackaged ? process.argv.find(argument => argument.startsWith('--gitworld-user-data='))?.slice('--gitworld-user-data='.length) : undefined;
const developmentProfile = developmentProfileArgument && path.isAbsolute(developmentProfileArgument) ? developmentProfileArgument : undefined;
if (!smoke && developmentProfile) app.setPath('userData', developmentProfile);
const developmentLabel = developmentProfile ? `GitWorld — ${path.basename(developmentProfile)}` : app.getName();
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
protocol.registerSchemesAsPrivileged([{ scheme: 'gitworld', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let mainWindow: BrowserWindow | null = null;
let bridge: UtilityBridge | null = null;
let closing = false;
let closeAttempt:Promise<void>|null=null;
let titlebarMetrics:unknown={centerY:null};
function updateWindowButtons(payload:unknown):void {
  if(process.platform!=='darwin' || !mainWindow || mainWindow.isDestroyed())return;
  const position=nativeTitlebarPosition(payload,mainWindow.webContents.getZoomFactor(),mainWindow.getContentBounds().height);
  if(!position)return;
  titlebarMetrics=payload;
  if(!mainWindow.isFullScreen())mainWindow.setWindowButtonPosition(position);
}
const closeHandshake=new CloseHandshake((kind,id)=>{
  if(!mainWindow || mainWindow.isDestroyed())throw new Error('WINDOW_UNAVAILABLE');
  mainWindow.webContents.send(kind==='prepare'?IPC.closePrepare:IPC.closeCancel,id);
});
let startupStage = 'utility-start';
let isolation = { sandbox: false, contextIsolation: false };
let preferenceSave = Promise.resolve();
let saveWindowPreferences: () => Promise<void> = () => preferenceSave;
let interfaceLocale: 'en' | 'zh-CN' = 'en';
let settingsHost: ReturnType<typeof createSettingsHostCoordinator> | null = null;
async function readSettings(): Promise<SettingsSnapshot> {
  if (!settingsHost) throw new Error('SERVICE_UNAVAILABLE');
  return settingsHost.read();
}
function applyHostSettings(snapshot: SettingsSnapshot, notify = true) {
  const localeChanged = interfaceLocale !== snapshot.values.general.locale;
  interfaceLocale = snapshot.values.general.locale;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(snapshot.values.general.zoomFactor);
    if (notify) mainWindow.webContents.send(IPC.settingsHost, { type: 'changed', snapshot });
  }
  if (localeChanged) installApplicationMenu();
}
function queueNativeZoom(direction: NativeZoomDirection) {
  return settingsHost?.zoom(direction) ?? Promise.resolve({ accepted: false as const, reason: 'closing' as const });
}
function installApplicationMenu() {
  const copy = hostMessages[interfaceLocale], settingsCopy = settingsHostMessages[interfaceLocale];
  const settingsItem = { id: 'open-settings', label: settingsCopy.settings, accelerator: 'CommandOrControl+,', click: () => { if (!closing && !settingsHost?.state().closing && !settingsHost?.state().maintaining && mainWindow) mainWindow.webContents.send(IPC.settingsHost, { type: 'open-settings' }); } };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.getName(), submenu: [{ role: 'about' as const }, { type: 'separator' as const }, settingsItem, { type: 'separator' as const }, { role: 'services' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : [{ label: app.getName(), submenu: [settingsItem, { role: 'quit' as const }] }]),
    { role: 'editMenu' },
    { label: copy.view, submenu: [{ id: 'view-zoom-in', label: settingsCopy.zoomIn, accelerator: VIEW_SHORTCUTS.zoomIn, click: () => { void queueNativeZoom('in'); } }, { id: 'view-zoom-out', label: settingsCopy.zoomOut, accelerator: VIEW_SHORTCUTS.zoomOut, click: () => { void queueNativeZoom('out'); } }, { id: 'view-zoom-reset', label: settingsCopy.resetZoom, accelerator: VIEW_SHORTCUTS.resetZoom, click: () => { void queueNativeZoom('reset'); } }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  updateMaintenanceMenus();
}
function updateMaintenanceMenus() {
  const state = settingsHost?.state();
  for (const id of ['open-settings', 'view-zoom-in', 'view-zoom-out', 'view-zoom-reset']) {
    const item=Menu.getApplicationMenu()?.getMenuItemById(id);if(item)item.enabled=!closing&&!state?.closing&&!state?.maintaining;
  }
}
const files = new FileTokenRegistry();
const rendererRoot = path.join(__dirname, 'renderer');
const mediaTypes: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const failure = (payload: unknown, code: 'INVALID_REQUEST' | 'SERVICE_UNAVAILABLE' | 'OPERATION_IN_PROGRESS'): ServiceResponse => ({ protocolVersion: 1, requestId: safeRequestId(payload), ok: false, error: { code } });
function trustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return Boolean(mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && isApplicationUrl(event.senderFrame?.url || ''));
}
function boundedPayload(payload: unknown): boolean { try { return JSON.stringify(payload).length <= 16 * 1024 * 1024; } catch { return false; } }
function registerIpc() {
  ipcMain.on(IPC.titlebarMetrics,(event,payload)=>{if(trustedSender(event))updateWindowButtons(payload);});
  ipcMain.on(IPC.closeAck,(event,payload)=>{if(trustedSender(event))closeHandshake.acknowledge(payload);});
  ipcMain.on(IPC.isolation, (event, result) => {
    if (trustedSender(event)) isolation = { sandbox: result?.sandbox === true, contextIsolation: result?.contextIsolation === true };
  });
  ipcMain.handle(IPC.request, async (event, payload: unknown) => {
    if (!trustedSender(event) || !boundedPayload(payload)) return failure(payload, 'INVALID_REQUEST');
    if (closing) return failure(payload, 'SERVICE_UNAVAILABLE');
    const checked = validateServiceRequest(payload);
    if (!checked.ok) return failure(payload, 'INVALID_REQUEST');
    return settingsHost ? settingsHost.dispatch(checked.value) : failure(payload, 'SERVICE_UNAVAILABLE');
  });
  ipcMain.handle(IPC.selectFile, async (event, purpose: unknown) => {
    if (!trustedSender(event) || !isFilePurpose(purpose) || !mainWindow || !bridge) return null;
    const copy = hostMessages[interfaceLocale];
    const backup = purpose === 'backup' || purpose === 'restore';
    const filters = [{ name: backup ? copy.database : copy.dataPackage, extensions: backup ? purpose === 'backup' ? ['gitworld'] : ['gitworld', 'sqlite', 'db'] : ['json', 'csv'] }];
    let selected: string | undefined;
    if (purpose === 'import' || purpose === 'restore') {
      const result = await dialog.showOpenDialog(mainWindow, { title: copy[purpose], properties: ['openFile'], filters });
      if (!result.canceled) selected = result.filePaths[0];
    } else {
      const result = await dialog.showSaveDialog(mainWindow, { title: copy[purpose], defaultPath: backup ? 'gitworld-backup.gitworld' : 'gitworld-data.json', filters, properties: ['showOverwriteConfirmation', 'createDirectory'] });
      if (!result.canceled) selected = result.filePath;
    }
    if (!selected || !trustedSender(event)) return null;
    const grant = files.issue(selected, purpose);
    bridge.grant(grant);
    return { fileToken: grant.fileToken, name: path.basename(selected) };
  });
  ipcMain.handle(IPC.openExternal, async (event, input: unknown) => {
    if (!trustedSender(event)) return;
    const url = allowedExternalUrl(input);
    if (url) await shell.openExternal(url);
  });
}
async function createWindow(options:{deferSettings?:boolean}={}) {
  const applicationIcon = path.join(__dirname, 'resources/GitWorld.png');
  if (process.platform === 'darwin') app.dock?.setIcon(applicationIcon);
  let saved: unknown = null;
  const preferenceFile = path.join(app.getPath('userData'), 'window-preferences.json');
  try { saved = JSON.parse(await readFile(preferenceFile, 'utf8')); } catch { /* First launch and malformed UI preferences use safe defaults. */ }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const preferences = fitWindow(saved, area);
  let displayZoom = preferences.zoomFactor;
  try { if(!options.deferSettings){const profile = await readSettings(); displayZoom = profile.values.general.zoomFactor; applyHostSettings(profile, false);} } catch { /* Settings keeps its own explicit recovery surface. */ }
  installApplicationMenu();
  const isolatedSession = session.fromPartition('gitworld-workbench');
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.on('will-download', (event) => event.preventDefault());
  isolatedSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('gitworld://app/') && !details.url.startsWith('devtools://') }));
  isolatedSession.protocol.handle('gitworld', async (request) => {
    const candidate = resolveAsset(rendererRoot, request.url);
    if (!candidate) return new Response('Not found', { status: 404 });
    try {
      const actual = await realpath(candidate), root = await realpath(rendererRoot);
      if (!actual.startsWith(`${root}${path.sep}`)) return new Response('Not found', { status: 404 });
      const data = await readFile(actual);
      return new Response(data, { headers: { 'Content-Type': mediaTypes[path.extname(actual)] || 'application/octet-stream', 'Content-Security-Policy': CONTENT_SECURITY_POLICY, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  mainWindow = new BrowserWindow({ ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : {}), x: preferences.x, y: preferences.y, width: preferences.width, height: preferences.height, minWidth: Math.min(1060, area.width), minHeight: Math.min(700, area.height), backgroundColor: '#171c24', icon: applicationIcon, show: !smoke, title: developmentLabel, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), zoomFactor: displayZoom, contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false, devTools: !app.isPackaged, session: isolatedSession } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if(process.platform==='darwin'){
    mainWindow.on('enter-full-screen',()=>mainWindow?.setWindowButtonPosition(null));
    mainWindow.on('leave-full-screen',()=>updateWindowButtons(titlebarMetrics));
  }
  mainWindow.webContents.on('will-navigate', (event) => {
    // Restoring a library replaces renderer caches by reloading this exact page.
    if (event.url !== APPLICATION_URL) event.preventDefault();
  });
  mainWindow.webContents.on('will-frame-navigate', (event) => { if (!isApplicationUrl(event.url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (developmentProfile) mainWindow.on('page-title-updated', event => { event.preventDefault(); mainWindow?.setTitle(developmentLabel); });
  saveWindowPreferences = () => {
    if (!mainWindow || mainWindow.isDestroyed() || smoke) return preferenceSave;
    const next = { ...mainWindow.getNormalBounds(), zoomFactor: mainWindow.webContents.getZoomFactor() };
    preferenceSave = preferenceSave.then(() => writeFile(`${preferenceFile}.tmp`, JSON.stringify(next), { mode: 0o600 })).then(() => rename(`${preferenceFile}.tmp`, preferenceFile)).catch(() => { /* UI preferences must not prevent a safe service shutdown. */ });
    return preferenceSave;
  };
  mainWindow.on('close', event => {event.preventDefault();if(!closing)void requestApplicationClose();});
  mainWindow.on('closed', () => {closeHandshake.cancel();mainWindow = null;files.clear();});
  await mainWindow.loadURL(APPLICATION_URL);
  return mainWindow;
}
function requestApplicationClose():Promise<void> {
  if(closeAttempt)return closeAttempt;
  closeAttempt=(async()=>{
    while(mainWindow && !mainWindow.isDestroyed()){
      const result=await closeHandshake.request();
      if(result.ready)break;
      if(!mainWindow || mainWindow.isDestroyed())return;
      const copy=hostMessages[interfaceLocale];
      try{
        if(result.reason==='unsaved-input'){
          const answer=await dialog.showMessageBox(mainWindow,{type:'warning',title:copy.closeDirtyTitle,message:copy.closeDirtyTitle,detail:copy.closeDirtyBody,buttons:[copy.keepEditing,copy.discardQuit],defaultId:0,cancelId:0,noLink:true});
          if(answer.response!==1)return;
          break;
        }
        const answer=await dialog.showMessageBox(mainWindow,{type:'warning',title:copy.closeSaveTitle,message:copy.closeSaveTitle,detail:copy.closeSaveBody,buttons:[copy.keepOpen,copy.retrySave],defaultId:0,cancelId:0,noLink:true});
        if(answer.response!==1)return;
      }catch{return;}
    }
    closing=true;
    files.clear();
    await settingsHost?.close();
    await saveWindowPreferences();
    await bridge?.close();
    app.exit(0);
  })().finally(()=>{closeAttempt=null;});
  return closeAttempt;
}
app.whenReady().then(async () => {
  if (!ownsProfile) return;
  const dataDirectory = path.join(app.getPath('userData'), 'library');
  await mkdir(dataDirectory, { recursive: true });
  const gitRuntime = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'git-runtime');
  bridge = new UtilityBridge(path.join(__dirname, 'utility.cjs'), dataDirectory, { smoke, gitExecutable: path.join(gitRuntime, 'bin/git'), gitExecPath: path.join(gitRuntime, 'libexec/git-core'), onProgress: (progress) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.progress, progress); } });
  const runtimeResult=bridge.ready.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  settingsHost = createSettingsHostCoordinator({
    request: request => bridge!.request(request), apply: applyHostSettings, onStateChange: updateMaintenanceMenus,
    onZoomError: () => { const copy = settingsHostMessages[interfaceLocale]; if (!smoke && !closing && mainWindow && !mainWindow.isDestroyed()) void dialog.showMessageBox(mainWindow, { type: 'warning', message: copy.saveTitle, detail: copy.saveBody }); },
  });
  startupStage = 'renderer-load';
  registerIpc();
  const window = await createWindow({deferSettings:true});
  startupStage='library-initialize';
  const initialized=await runtimeResult;if(!initialized.ok)throw initialized.error;const runtime=initialized.value;
  await readSettings();
  if (smoke) {
    startupStage = 'renderer-smoke';
    const rendererReloaded = await new Promise<boolean>(resolve => {
      const loaded = () => { clearTimeout(timer); resolve(window.webContents.getURL() === APPLICATION_URL); };
      const timer = setTimeout(() => { window.webContents.removeListener('did-finish-load', loaded); resolve(false); }, 5_000);
      window.webContents.once('did-finish-load', loaded);
      void window.webContents.executeJavaScript('window.location.reload(); true').catch(() => {});
    });
    const renderer = await window.webContents.executeJavaScript(`(async()=>({nodeHidden:typeof process==='undefined'&&typeof require==='undefined',bridgeMethods:Object.keys(window.gitworld||{}).sort(),nativePlatform:document.documentElement.dataset.platform,nativeTitlebarGutter:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-titlebar-gutter')),nativeTitlebarHeight:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-titlebar-height')),viewport:{width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth},invalidResponse:window.gitworld?await window.gitworld.request({protocolVersion:1,requestId:'smoke-invalid',method:'not-a-method',params:{}}):null}))()`);
    const libraryResponse = await bridge.request({ protocolVersion: 1, requestId: 'smoke-library', method: 'library.status', params: {} });
    const summary = libraryResponse.ok ? libraryResponse.result as LibrarySummary : null;
    const library = { ok: libraryResponse.ok, datasetCount: summary?.datasets.length ?? 0, activeRevisionCount: summary?.datasets.filter(item => item.activeRevisionId).length ?? 0, schemaVersion: summary?.schemaVersion ?? null, error: libraryResponse.ok ? null : libraryResponse.error.code };
    const zoom = window.webContents.getZoomFactor();
    const nativeTitlebar = renderer.nativePlatform === process.platform && (process.platform !== 'darwin' || Math.abs(renderer.nativeTitlebarGutter * zoom - 88) < 0.1 && Math.abs(renderer.nativeTitlebarHeight * zoom - 52) < 0.1);
    const platformLayout = { platform: process.platform, viewport: renderer.viewport, ok: renderer.viewport.width > 0 && renderer.viewport.height > 0 && renderer.viewport.scrollWidth <= renderer.viewport.clientWidth + 1 };
    const narrowBridge = JSON.stringify(renderer.bridgeMethods) === JSON.stringify(['onBeforeClose', 'onProgress', 'onSettingsHostEvent', 'openExternal', 'request', 'selectFile']);
    const titlebarZoomChecks:Array<{zoom:number;centerY:number|null;nativeButtons:{x:number;y:number}|null;ok:boolean}>=[];
    if(process.platform==='darwin')for(const factor of [1,2,0.75,1]){
      window.webContents.setZoomFactor(factor);
      let check={zoom:factor,centerY:null as number|null,nativeButtons:null as {x:number;y:number}|null,ok:false};
      for(let attempt=0;attempt<30;attempt++){
        await new Promise(resolve=>setTimeout(resolve,50));
        const metrics=await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[data-native-titlebar-anchor]')?.getBoundingClientRect();return{centerY:r?r.top+r.height/2:null,gutter:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-titlebar-gutter'))}})()`);
        const expected=nativeTitlebarPosition({centerY:metrics.centerY},factor,window.getContentBounds().height);
        const actual=window.getWindowButtonPosition();
        check={zoom:factor,centerY:metrics.centerY,nativeButtons:actual,ok:(!buildMetadata.renderer || metrics.centerY!==null) && Math.abs(metrics.gutter*factor-88)<0.1 && actual?.x===expected?.x && actual?.y===expected?.y};
        if(check.ok)break;
      }
      titlebarZoomChecks.push(check);
    }
    const nativeSettingsChecks:Array<{action:string;enabled:boolean;consistent:boolean;directionCorrect:boolean;otherPreferencesPreserved:boolean}>=[];
    const beforeMenus=await readSettings();
    for(const action of ['reset','in','out','reset'] as const){
      const item=Menu.getApplicationMenu()?.getMenuItemById(action==='in'?'view-zoom-in':action==='out'?'view-zoom-out':'view-zoom-reset');
      const previousZoom=window.webContents.getZoomFactor(),enabled=!!item?.enabled;
      if(enabled)item!.click(item,window,{triggeredByAccelerator:false});
      await settingsHost.idle();
      // Read directly for verification so the read cannot itself repair a missing native apply.
      const stored=await bridge.request({protocolVersion:1,requestId:`smoke-menu-${nativeSettingsChecks.length}`,method:'settings.get',params:{}});
      const actualZoom=window.webContents.getZoomFactor(),snapshot=stored.ok?stored.result as SettingsSnapshot:null;
      const otherPreferencesPreserved=!!snapshot&&snapshot.values.general.locale===beforeMenus.values.general.locale&&snapshot.values.general.startup===beforeMenus.values.general.startup&&snapshot.values.general.reducedMotion===beforeMenus.values.general.reducedMotion&&snapshot.values.learning.tipsEnabled===beforeMenus.values.learning.tipsEnabled&&snapshot.values.contributor.name===beforeMenus.values.contributor.name&&snapshot.values.contributor.email===beforeMenus.values.contributor.email;
      nativeSettingsChecks.push({action,enabled,consistent:!!snapshot&&Math.abs(actualZoom-snapshot.values.general.zoomFactor)<1e-9,directionCorrect:action==='reset'?actualZoom===1:action==='in'?actualZoom>previousZoom:actualZoom<previousZoom,otherPreferencesPreserved});
    }
    const bundledSettingsAssets=await window.webContents.executeJavaScript(`(async()=>{const info=await fetch('./app-info.json'),notices=await fetch('./notices.txt');const value=info.ok?await info.json():null,text=notices.ok?await notices.text():'';return{appInfo:!!value&&typeof value.version==='string'&&typeof value.buildId==='string',notices:notices.ok&&text.includes('THIRD_PARTY_NOTICES.md')&&text.includes('Bundled Git / COPYING'),noticeCharacters:text.length}})()`);
    const closePreparation=await closeHandshake.request();
    const ok = runtime.roundTrip && runtime.integrity && rendererReloaded && renderer.nodeHidden && nativeTitlebar && platformLayout.ok && titlebarZoomChecks.every(check=>check.ok) && nativeSettingsChecks.every(check=>check.enabled&&check.consistent&&check.directionCorrect&&check.otherPreferencesPreserved) && bundledSettingsAssets.appInfo && bundledSettingsAssets.notices && narrowBridge && closePreparation.ready && renderer.invalidResponse?.error?.code === 'INVALID_REQUEST' && isolation.sandbox === true && isolation.contextIsolation === true && library.ok && library.activeRevisionCount > 0;
    console.log(`GITWORLD_SMOKE_RESULT ${JSON.stringify({ ok, packaged: app.isPackaged, platform: process.platform, arch: process.arch, runtime, rendererReloaded, renderer, library, platformLayout, titlebarZoomChecks, nativeSettingsChecks, bundledSettingsAssets, closePreparation, ...isolation, signing: 'unsigned-development-build' })}`);
    await settingsHost.close();
    await bridge.close();
    app.exit(ok ? 0 : 1);
  }
}).catch(async () => {
  if (smoke) console.error(`GITWORLD_SMOKE_ERROR ${startupStage}`);
  else { const copy = hostMessages[app.getLocale().startsWith('zh') ? 'zh-CN' : 'en']; dialog.showErrorBox(copy.startupTitle, copy.startupBody); }
  await bridge?.close();
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.on('before-quit', (event) => {
  event.preventDefault();
  if(!closing)void requestApplicationClose();
});
