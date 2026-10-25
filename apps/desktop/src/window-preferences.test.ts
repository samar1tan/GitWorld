import test from 'node:test';
import assert from 'node:assert/strict';
import {fitWindow, VIEW_SHORTCUTS} from './window-preferences.ts';
test('first launch uses a readable native work area without forcing zoom',()=>{const value=fitWindow(null,{x:0,y:30,width:1920,height:1050});assert.equal(value.width,1600);assert.equal(value.height,960);assert.equal(value.zoomFactor,1);});
test('window recovery fits smaller screens and restores valid user zoom',()=>{const value=fitWindow({x:9000,y:-9000,width:1900,height:1400,zoomFactor:1.25},{x:0,y:25,width:1280,height:695});assert.deepEqual(value,{x:0,y:25,width:1280,height:695,zoomFactor:1.25});assert.equal(fitWindow({zoomFactor:NaN},{x:0,y:0,width:1280,height:800}).zoomFactor,1);});
test('native zoom shortcuts retain platform Command or Control conventions',()=>{assert.deepEqual(VIEW_SHORTCUTS,{zoomIn:'CommandOrControl+=',zoomOut:'CommandOrControl+-',resetZoom:'CommandOrControl+0'});});
