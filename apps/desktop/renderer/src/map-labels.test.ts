import test from 'node:test';
import assert from 'node:assert/strict';
import { placeMapLabels } from './map-labels.ts';

test('nearby geography keeps readable labels separate and attached to its anchors',()=>{
  const labels=[{id:'a',x:460,y:120,width:100,height:36},{id:'b',x:480,y:135,width:230,height:36},{id:'c',x:560,y:135,width:90,height:36}];
  const placed=placeMapLabels(1000,340,labels);
  for(const a of placed){
    assert.ok(a.centerX-a.width/2>=8&&a.centerX+a.width/2<=992);
    assert.ok(a.centerY-a.height/2>=8&&a.centerY+a.height/2<=332);
    assert.equal(a.x,labels.find(x=>x.id===a.id)!.x);
    assert.ok(a.lineX>=a.centerX-a.width/2&&a.lineX<=a.centerX+a.width/2);
    for(const b of placed.filter(x=>x.id!==a.id))assert.ok(Math.abs(a.centerX-b.centerX)>=(a.width+b.width)/2||Math.abs(a.centerY-b.centerY)>=(a.height+b.height)/2);
  }
  assert.deepEqual(placeMapLabels(1000,340,[...labels].reverse()),placed);
});
test('edge anchors keep labels inside a narrow map without changing geography',()=>{
  const result=placeMapLabels(360,240,[{id:'a',x:0,y:0,width:100,height:36},{id:'b',x:358,y:238,width:160,height:44}]);
  assert.equal(result[0].x,0);assert.equal(result[1].x,358);
  for(const x of result)assert.ok(x.centerX-x.width/2>=8&&x.centerX+x.width/2<=352&&x.centerY-x.height/2>=8&&x.centerY+x.height/2<=232);
});
