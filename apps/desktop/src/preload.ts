import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ClosePreparationResult, DesktopBridge, OperationProgress, SettingsHostEvent } from '@gitworld/contracts';
import { IPC } from './channels.ts';

let observedTitlebarAnchor:Element|null=null;
let titlebarReportScheduled=false;
let lastTitlebarMetric='';
const titlebarResizeObserver=new ResizeObserver(scheduleTitlebarReport);
const titlebarMutationObserver=new MutationObserver(scheduleTitlebarReport);
function scheduleTitlebarReport() {
  if(titlebarReportScheduled || process.platform!=='darwin')return;
  titlebarReportScheduled=true;
  queueMicrotask(()=>{
    titlebarReportScheduled=false;
    const anchor=document.querySelector('[data-native-titlebar-anchor]');
    if(anchor!==observedTitlebarAnchor){
      titlebarResizeObserver.disconnect();observedTitlebarAnchor=anchor;
      if(anchor){titlebarResizeObserver.observe(anchor);const header=anchor.closest('header');if(header)titlebarResizeObserver.observe(header);}
    }
    const bounds=anchor?.getBoundingClientRect();
    const centerY=bounds && bounds.width>0 && bounds.height>0?bounds.top+bounds.height/2:null;
    const key=`${centerY}:${webFrame.getZoomFactor()}`;
    if(key===lastTitlebarMetric)return;
    lastTitlebarMetric=key;
    ipcRenderer.send(IPC.titlebarMetrics,{centerY});
  });
}
function updateNativeTitlebarMetrics() {
  const root = document.documentElement;
  const zoom = webFrame.getZoomFactor();
  root.dataset.platform = process.platform;
  // Native window controls keep their physical size when page content is zoomed.
  root.style.setProperty('--native-titlebar-gutter', `${88 / zoom}px`);
  root.style.setProperty('--native-titlebar-height', `${52 / zoom}px`);
  scheduleTitlebarReport();
}
window.addEventListener('DOMContentLoaded', ()=>{updateNativeTitlebarMetrics();titlebarMutationObserver.observe(document.documentElement,{childList:true,subtree:true});}, { once: true });
window.addEventListener('resize', updateNativeTitlebarMetrics);

type ClosePreparation = {prepare:()=>Promise<ClosePreparationResult>; cancelled:()=>void};
let closePreparation:ClosePreparation|null=null;
let pendingCloseId:string|null=null;
ipcRenderer.on(IPC.closePrepare, (_event, id:unknown)=>{
  if(typeof id!=='string' || !/^[a-f0-9-]{36}$/.test(id))return;
  pendingCloseId=id;
  const handler=closePreparation;
  if(!handler){ipcRenderer.send(IPC.closeAck,{requestId:id,ready:false,reason:'save-failed'});return;}
  void Promise.resolve().then(()=>handler.prepare()).then(result=>{
    if(pendingCloseId===id && closePreparation===handler)ipcRenderer.send(IPC.closeAck,result?.ready===true?{requestId:id,ready:true}:{requestId:id,ready:false,reason:result?.reason==='unsaved-input'?'unsaved-input':'save-failed'});
  }).catch(()=>{
    if(pendingCloseId===id && closePreparation===handler)ipcRenderer.send(IPC.closeAck,{requestId:id,ready:false,reason:'save-failed'});
  });
});
ipcRenderer.on(IPC.closeCancel, (_event, id:unknown)=>{
  if(id!==pendingCloseId)return;
  pendingCloseId=null;
  try{closePreparation?.cancelled();}catch{/* Cancellation cannot authorize a close. */}
});

// Expose data-only operations, never ipcRenderer, native events, filesystem or shell APIs.
const bridge: DesktopBridge = {
  request: (request) => ipcRenderer.invoke(IPC.request, request),
  onProgress: (listener: (progress: OperationProgress) => void) => {
    if (typeof listener !== 'function') throw new TypeError('A progress listener is required.');
    const handler = (_event: unknown, progress: OperationProgress) => listener(progress);
    ipcRenderer.on(IPC.progress, handler);
    return () => ipcRenderer.removeListener(IPC.progress, handler);
  },
  selectFile: (purpose) => ipcRenderer.invoke(IPC.selectFile, purpose),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  onBeforeClose:(prepare,cancelled)=>{
    if(typeof prepare!=='function' || typeof cancelled!=='function')throw new TypeError('Close preparation and cancellation callbacks are required.');
    if(pendingCloseId){
      ipcRenderer.send(IPC.closeAck,{requestId:pendingCloseId,ready:false,reason:'save-failed'});
      pendingCloseId=null;
      try{closePreparation?.cancelled();}catch{/* Replacing a callback cannot authorize a close. */}
    }
    const handler={prepare,cancelled};
    closePreparation=handler;
    return ()=>{
      if(closePreparation!==handler)return;
      closePreparation=null;
      if(pendingCloseId){ipcRenderer.send(IPC.closeAck,{requestId:pendingCloseId,ready:false,reason:'save-failed'});pendingCloseId=null;}
      try{handler.cancelled();}catch{/* Disposal cannot authorize a close. */}
    };
  },
  onSettingsHostEvent:listener=>{
    if(typeof listener!=='function')throw new TypeError('A settings listener is required.');
    const handler=(_event:unknown,event:SettingsHostEvent)=>listener(event);
    ipcRenderer.on(IPC.settingsHost,handler);
    return ()=>ipcRenderer.removeListener(IPC.settingsHost,handler);
  },
};
contextBridge.exposeInMainWorld('gitworld', Object.freeze(bridge));
// This attestation is sent from the isolated preload and is not exposed to page scripts.
ipcRenderer.send(IPC.isolation, { sandbox: process.sandboxed, contextIsolation: process.contextIsolated });
