import test from 'node:test';
import assert from 'node:assert/strict';
import {CloseHandshake} from './close-handshake.ts';

test('close requests coalesce and only the current exact acknowledgement releases the caller',async()=>{
  const sent:Array<{kind:string;id:string}>=[];
  const gate=new CloseHandshake((kind,id)=>sent.push({kind,id}));
  const pending=gate.request();
  assert.equal(gate.request(),pending);
  assert.equal(sent.length,1);
  assert.equal(gate.acknowledge({requestId:'stale',ready:true}),false);
  assert.equal(gate.acknowledge({requestId:sent[0].id,ready:'yes'}),false);
  assert.equal(gate.acknowledge({requestId:sent[0].id,ready:true,unexpected:true}),false);
  assert.equal(gate.acknowledge({requestId:sent[0].id,ready:true}),true);
  assert.deepEqual(await pending,{ready:true});
  assert.equal(sent.length,1);
});

test('a failed flush cancels its renderer attempt and a retry rejects late acknowledgements',async()=>{
  const sent:Array<{kind:string;id:string}>=[];
  const gate=new CloseHandshake((kind,id)=>sent.push({kind,id}));
  const first=gate.request(), oldId=sent[0].id;
  gate.acknowledge({requestId:oldId,ready:false,reason:'save-failed'});
  assert.deepEqual(await first,{ready:false,reason:'save-failed'});
  assert.deepEqual(sent[1],{kind:'cancel',id:oldId});
  const second=gate.request(), newId=sent[2].id;
  assert.notEqual(newId,oldId);
  assert.equal(gate.acknowledge({requestId:oldId,ready:true}),false);
  gate.acknowledge({requestId:newId,ready:true});
  assert.deepEqual(await second,{ready:true});
});

test('timeout or a destroyed renderer never counts as saved state',async()=>{
  const sent:Array<{kind:string;id:string}>=[];
  const gate=new CloseHandshake((kind,id)=>sent.push({kind,id}),5);
  assert.deepEqual(await gate.request(),{ready:false,reason:'save-failed'});
  assert.equal(sent[1].kind,'cancel');
  assert.equal(gate.acknowledge({requestId:sent[0].id,ready:true}),false);
  const pending=gate.request();
  gate.cancel();
  assert.deepEqual(await pending,{ready:false,reason:'save-failed'});
  assert.deepEqual(await new CloseHandshake(()=>{throw new Error('Destroyed');}).request(),{ready:false,reason:'save-failed'});
});

test('only an explicit unsaved-input outcome can offer discarding form edits',async()=>{
  const sent:Array<{kind:string;id:string}>=[];
  const gate=new CloseHandshake((kind,id)=>sent.push({kind,id}));
  const pending=gate.request(),id=sent[0].id;
  for(const payload of [{requestId:id,ready:false},{requestId:id,ready:false,reason:'unknown'},{requestId:id,ready:true,reason:'unsaved-input'}])assert.equal(gate.acknowledge(payload),false);
  assert.equal(gate.acknowledge({requestId:id,ready:false,reason:'unsaved-input'}),true);
  assert.deepEqual(await pending,{ready:false,reason:'unsaved-input'});
  assert.deepEqual(sent[1],{kind:'cancel',id});
});
