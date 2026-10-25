import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { focusBundle, createFocusApi, until, tick, focusOid } from './main-terminal-fixture.mjs';

// A small DOM host models connected nodes, destructive replacement, focus,
// selection and ordinary single-line form submission. It runs the complete main
// and real components; browser layout and native IME behavior are separate checks.
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, word => ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'" })[word]);
let currentDocument;
class TextNode {
  constructor(value) { this.nodeType = 3; this.textContent = value; this.parentNode = null; }
  get parentElement() { return this.parentNode; }
  remove() { this.parentNode?.removeChild(this); }
}
class Element {
  constructor(name = 'div') { this.nodeType = 1; this.tagName = name.toUpperCase(); this.parentNode = null; this.childNodes = []; this.attrs = new Map(); this.dataset = {}; this.listeners = new Map(); this.style = { setProperty() {} }; this.value = ''; this.checked = false; this.disabled = false; this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = 'none'; this.scrollTop = this.scrollHeight = 0; }
  get parentElement() { return this.parentNode; }
  get isConnected() { return this === currentDocument?.documentElement || !!this.parentNode?.isConnected; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstElementChild() { return this.children[0] ?? null; }
  get attributes() { return [...this.attrs].map(([name,value]) => ({name,value})); }
  get className() { return this.attrs.get('class') ?? ''; }
  set className(value) { this.attrs.set('class',value); }
  get id() { return this.attrs.get('id') ?? ''; }
  get classList() { const element=this;return { contains:name=>element.className.split(/\s+/).includes(name), add(...names){element.className=[...new Set([...element.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove(...names){element.className=element.className.split(/\s+/).filter(value=>!names.includes(value)).join(' ');},toggle(name,on){const include=on??!this.contains(name);if(include)this.add(name);else this.remove(name);} }; }
  get textContent() { return this.childNodes.map(node=>node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(new TextNode(value)); }
  get innerHTML() { return this.childNodes.map(node=>node.nodeType===3?node.textContent:`<${node.tagName.toLowerCase()} ${node.attributes.map(value=>`${value.name}="${value.value}"`).join(' ')}>${node.innerHTML}</${node.tagName.toLowerCase()}>`).join(''); }
  set innerHTML(value) { this.replaceChildren(...parse(value).childNodes); }
  set outerHTML(value) { const parent=this.parentNode;if(!parent)return;for(const node of [...parse(value).childNodes])parent.insertBefore(node,this);this.remove(); }
  setAttribute(name,value) { this.attrs.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);if(name==='value')this.value=String(value);if(name==='checked')this.checked=true;if(name==='disabled')this.disabled=true; }
  getAttribute(name) { return this.attrs.get(name)??null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name);if(name==='disabled')this.disabled=false;if(name==='checked')this.checked=false; }
  contains(node) { return node===this||this.childNodes.some(child=>child===node||child.nodeType===1&&child.contains(node)); }
  removeChild(node) { if(node.nodeType===1&&node.contains(currentDocument?.activeElement))currentDocument.activeElement=currentDocument.body;this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;return node; }
  remove() { this.parentNode?.removeChild(this); }
  append(...nodes) { for(let node of nodes){if(typeof node==='string')node=new TextNode(node);node.parentNode?.removeChild(node);this.childNodes.push(node);node.parentNode=this;} }
  appendChild(node) { this.append(node);return node; }
  insertBefore(node,before) { if(node===before)return;node.parentNode?.removeChild(node);const index=before?this.childNodes.indexOf(before):this.childNodes.length;this.childNodes.splice(index,0,node);node.parentNode=this;return node; }
  replaceChildren(...nodes) { for(const node of [...this.childNodes])this.removeChild(node);this.append(...nodes); }
  insertAdjacentHTML(position,value) { const nodes=[...parse(value).childNodes];if(position==='afterbegin'){for(const node of nodes)this.insertBefore(node,this.childNodes[0]);}else this.append(...nodes); }
  matches(selector) { return selector.split(',').some(option=>{let value=option.trim();const forbidden=[...value.matchAll(/:not\(([^)]+)\)/g)].map(match=>match[1]);value=value.replace(/:not\([^)]+\)/g,'');if(forbidden.some(item=>this.matches(item)))return false;if(value===':scope')return true;const tag=value.match(/^[\w-]+/);if(tag&&tag[0].toUpperCase()!==this.tagName)return false;const id=value.match(/#([\w-]+)/);if(id&&this.id!==id[1])return false;for(const match of value.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(match[1]))return false;for(const match of value.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g))if(!this.hasAttribute(match[1])||match[2]!==undefined&&this.getAttribute(match[1])!==match[2])return false;return true;}); }
  querySelectorAll(selector) { const output=[];for(const node of this.children){if(node.matches(selector))output.push(node);output.push(...node.querySelectorAll(selector));}return output; }
  querySelector(selector) { return this.querySelectorAll(selector)[0]??null; }
  closest(selector) { return this.matches(selector)?this:this.parentElement?.closest(selector)??null; }
  focus() { if(this.isConnected)currentDocument.activeElement=this; }
  setSelectionRange(start,end,direction='none') { this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction; }
  addEventListener(name,fn,capture=false) { this.listeners.set(name,[...this.listeners.get(name)??[],{fn,capture}]); }
  dispatch(name,extra={}) { const chain=[];for(let node=this;node;node=node.parentElement)chain.push(node);chain.push(currentDocument);let prevented=false;const event={target:this,...extra,composedPath:()=>chain,preventDefault(){prevented=true;}};for(const node of [...chain].reverse())for(const item of node.listeners?.get(name)??[])if(item.capture)item.fn(event);for(const node of chain)for(const item of node.listeners?.get(name)??[])if(!item.capture)item.fn(event);return prevented; }
  getBoundingClientRect() { return {x:0,y:0,width:1440,height:900,top:0,left:0,right:1440,bottom:900}; }
  scrollIntoView() {}
}
function parse(html) {
  const root=new Element('div'),stack=[root],voids=new Set(['input','img','br','hr','meta','link','source','area','base','col','embed','param','track','wbr']);
  for(const token of html.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+/g)??[]){if(token.startsWith('<!--'))continue;if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}if(token.startsWith('<')){const name=token.match(/^<([\w:-]+)/)[1],node=new Element(name);const rest=token.slice(name.length+1,-1);for(const value of rest.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(value[1],decode(value[2]??value[3]??value[4]??''));stack.at(-1).append(node);if(!voids.has(name.toLowerCase())&&!token.endsWith('/>'))stack.push(node);}else stack.at(-1).append(new TextNode(decode(token)));}
  return root;
}
const directory=await mkdtemp(path.join(os.tmpdir(),'gitworld-terminal-dom-')),entry=path.join(directory,'main.mjs'),built=await focusBundle({baseline:process.env.GITWORLD_FOCUS_BASELINE});await writeFile(entry,built.outputFiles[0].text);after(()=>rm(directory,{recursive:true,force:true}));let instance=0;
async function fixture(t,locale){
  const api=createFocusApi(locale),root=new Element('html'),body=new Element('body'),app=new Element('div');app.setAttribute('id','app');root.append(body);body.append(app);
  const document={documentElement:root,body,activeElement:body,listeners:new Map(),createElement:name=>new Element(name),querySelector:selector=>root.querySelector(selector),querySelectorAll:selector=>root.querySelectorAll(selector),addEventListener:Element.prototype.addEventListener};currentDocument=document;
  let settingsListener;
  const bridge={request:input=>api.dispatch(input),onProgress(){return()=>{};},onSettingsHostEvent(fn){settingsListener=fn;return()=>{};},onBeforeClose(){return()=>{};},selectFile:async()=>null,openExternal:async()=>{}};
  const storage=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size;},key:index=>[...values.keys()][index]};};
  const globals={document,HTMLElement:Element,HTMLInputElement:Element,HTMLSelectElement:Element,HTMLTextAreaElement:Element,window:{gitworld:bridge,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),innerWidth:1440,innerHeight:900,location:{href:'gitworld://technical-fixture/index.html'}},localStorage:storage(),sessionStorage:storage(),requestAnimationFrame:()=>0,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},DOMParser:class{parseFromString(){return{documentElement:{innerHTML:'<path d="M0 0"/>'}};}},fetch:async url=>new Response(url==='./world-land.svg'?'<svg><path d="M0 0"/></svg>':JSON.stringify({version:'technical-fixture',buildId:'focus'}))};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const module=await import(pathToFileURL(entry).href+'?fixture='+ ++instance),view=module.__focusRegression;
  await until(()=>view.ready()&&document.querySelector('[data-knowledge-input="year"]')?.value==='1370');
  t.after(async()=>{api.release();await until(()=>api.observed().pending===0);await view.flush();await tick();for(const[key,value]of previous){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  return{api,view,document,app,body,async pauseReads(){api.arm();const checkbox=new Element('input');checkbox.dataset.knowledgeInput='unreviewed';checkbox.checked=true;const result=view.knowledge.change(checkbox);await until(()=>api.observed().held===4);return{release:async()=>{api.release();await result;await tick();}};},type(value,composing=false){const input=document.querySelector('[data-terminal-input]');input.focus();if(composing)input.dispatch('compositionstart');input.value=value;input.dispatch('input',{isComposing:composing});return input;},enter(){const active=document.activeElement,prevented=active.dispatch('keydown',{key:'Enter'});if(!prevented&&active.tagName==='INPUT')active.closest('form')?.dispatch('submit');},locale(value){settingsListener({type:'changed',snapshot:api.locale(value)});}};
}
for(const locale of ['en','zh-CN']){
 test(`object reads retain the connected terminal, caret and Enter submission (${locale})`,async t=>{const f=await fixture(t,locale),pending=await f.pauseReads(),input=f.type('git status');input.setSelectionRange(4,10,'backward');await pending.release();const current=f.document.querySelector('[data-terminal-input]'),before={value:current.value,selection:[current.selectionStart,current.selectionEnd,current.selectionDirection],draft:f.view.snapshot().terminal.draft};f.enter();await tick();assert.equal(f.api.observed().commandRequests,1,'Enter did not reach the real terminal submit handler.');assert.deepEqual(before,{value:'git status',selection:[4,10,'backward'],draft:'git status'});assert.ok(current===input,'Background reads replaced the input.');assert.ok(f.document.activeElement===input,'Terminal focus changed.');assert.equal(input.isConnected,true);assert.equal(f.view.snapshot().knowledge.yearDraft,'1370');assert.equal(f.view.snapshot().knowledge.year,1336);assert.equal(f.view.snapshot().knowledge.a.revision,focusOid);});
 test(`locale and result updates preserve a composing terminal node and selection (${locale})`,async t=>{const f=await fixture(t,locale);f.view.terminalHost.querySelector('[data-terminal="toggle"]').dispatch('click');const input=f.type('git s唐',true);input.setSelectionRange(2,6,'backward');f.locale(locale==='en'?'zh-CN':'en');f.view.terminal.record(await f.api.technicalOutput());await tick();assert.ok(f.document.querySelector('[data-terminal-input]')===input,'The terminal input node was replaced.');assert.ok(f.document.activeElement===input,'Terminal focus changed.');assert.deepEqual([input.selectionStart,input.selectionEnd,input.selectionDirection],[2,6,'backward']);assert.equal(input.value,'git s唐');assert.equal(f.view.snapshot().terminal.draft,'git s唐');assert.equal(f.api.observed().commandRequests,0);assert.equal(f.view.terminalHost.querySelectorAll('.terminal-entry').length,1);assert.equal(f.view.snapshot().locale,locale==='en'?'zh-CN':'en');assert.equal(input.dispatch('keydown',{key:'ArrowUp',isComposing:true}),false);f.enter();await tick();assert.equal(f.api.observed().commandRequests,0,'A composing form submit executed a command.');input.dispatch('compositionend');f.type('git status');f.enter();await tick();assert.equal(f.api.observed().commandRequests,1);});
 test(`a late object result does not reclaim focus from another input (${locale})`,async t=>{const f=await fixture(t,locale),pending=await f.pauseReads();f.type('git status');const other=new Element('input');f.body.append(other);other.value='Another question';other.focus();await pending.release();assert.ok(f.document.activeElement===other,'The newer input lost focus.');assert.equal(other.value,'Another question');assert.equal(f.view.snapshot().terminal.draft,'git status');assert.equal(f.api.observed().commandRequests,0);});
 test(`a later object-editor investigation retains its input when the old read finishes (${locale})`,async t=>{const f=await fixture(t,locale),pending=await f.pauseReads();f.type('git status');await f.view.knowledge.click({dataset:{knowledge:'new-object'}});const other=f.document.querySelector('[data-object-input="nameEn"]');assert.ok(other);other.value='A different investigation';other.focus();other.dispatch('input');await pending.release();assert.equal(f.view.snapshot().objectEditorOpen,true);assert.ok(f.document.activeElement===other,'The newer input lost focus.');assert.equal(other.value,'A different investigation');assert.equal(f.api.observed().commandRequests,0);});
}
