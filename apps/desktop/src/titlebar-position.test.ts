import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeTitlebarPosition} from './titlebar-position.ts';

test('native controls follow the first title row across zoom without scaling their horizontal position',()=>{
  assert.deepEqual(nativeTitlebarPosition({centerY:26},1,900),{x:16,y:18});
  assert.deepEqual(nativeTitlebarPosition({centerY:26},2,900),{x:16,y:44});
  assert.deepEqual(nativeTitlebarPosition({centerY:26/0.75},0.75,900),{x:16,y:18});
  assert.deepEqual(nativeTitlebarPosition({centerY:null},2,900),{x:16,y:18});
});

test('untrusted titlebar metrics cannot choose arbitrary native coordinates',()=>{
  for(const value of [undefined,null,[],{},{centerY:'26'},{centerY:NaN},{centerY:Infinity},{centerY:-1},{centerY:257},{centerY:26,x:900},{centerY:26,zoom:2}])assert.equal(nativeTitlebarPosition(value,1,900),undefined);
  for(const zoom of [NaN,Infinity,0,6])assert.equal(nativeTitlebarPosition({centerY:26},zoom,900),undefined);
  assert.deepEqual(nativeTitlebarPosition({centerY:200},2,900),{x:16,y:128});
  assert.deepEqual(nativeTitlebarPosition({centerY:200},2,80),{x:16,y:56});
  assert.deepEqual(nativeTitlebarPosition({centerY:0},1,900),{x:16,y:8});
});
