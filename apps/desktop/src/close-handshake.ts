import {randomUUID} from 'node:crypto';
import type {ClosePreparationResult} from '@gitworld/contracts';

export type CloseDecision = ClosePreparationResult;
type PendingClose = {id:string; promise:Promise<CloseDecision>; resolve:(result:CloseDecision)=>void; timer:ReturnType<typeof setTimeout>};

export class CloseHandshake {
  #pending:PendingClose|null=null;
  private send:(kind:'prepare'|'cancel',id:string)=>void;
  private timeoutMs:number;
  constructor(send:(kind:'prepare'|'cancel',id:string)=>void, timeoutMs=15_000) {this.send=send;this.timeoutMs=timeoutMs;}

  request():Promise<CloseDecision> {
    if(this.#pending)return this.#pending.promise;
    const id=randomUUID();
    let resolve!:(result:CloseDecision)=>void;
    const promise=new Promise<CloseDecision>(done=>{resolve=done;});
    const timer=setTimeout(()=>this.finish({ready:false,reason:'save-failed'}),this.timeoutMs);
    this.#pending={id,promise,resolve,timer};
    try {this.send('prepare',id);} catch {this.finish({ready:false,reason:'save-failed'});}
    return promise;
  }

  acknowledge(payload:unknown):boolean {
    if(!payload || typeof payload!=='object' || Array.isArray(payload))return false;
    const value=payload as Record<string,unknown>;
    if(!this.#pending || value.requestId!==this.#pending.id)return false;
    const keys=Object.keys(value).sort().join(',');
    if(value.ready===true && keys==='ready,requestId')this.finish({ready:true});
    else if(value.ready===false && keys==='ready,reason,requestId' && (value.reason==='unsaved-input' || value.reason==='save-failed'))this.finish({ready:false,reason:value.reason});
    else return false;
    return true;
  }

  cancel():void {this.finish({ready:false,reason:'save-failed'});}

  private finish(result:CloseDecision):void {
    const pending=this.#pending;
    if(!pending)return;
    this.#pending=null;
    clearTimeout(pending.timer);
    if(!result.ready){try{this.send('cancel',pending.id);}catch{/* A destroyed window cannot receive cancellation. */}}
    pending.resolve(result);
  }
}
