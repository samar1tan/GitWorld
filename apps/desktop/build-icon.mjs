import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Resvg} from '@resvg/resvg-js';

const directory=path.dirname(fileURLToPath(import.meta.url));
const output=path.resolve(directory,'../../.local/desktop-icon');
const iconset=path.join(output,'GitWorld.iconset');
await mkdir(iconset,{recursive:true});
const full=await readFile(path.join(directory,'resources/icon.svg'),'utf8');
const small=await readFile(path.join(directory,'resources/icon-small.svg'),'utf8');
const variants=[16,32,128,256,512].flatMap(points=>[1,2].map(scale=>({points,scale,pixels:points*scale,name:`icon_${points}x${points}${scale===2?'@2x':''}.png`})));
const receipts=[];
for(const variant of variants){
  // Small logical sizes use an optical variant even on Retina displays.
  const svg=variant.points<=32?small:full;
  const bytes=new Resvg(svg,{fitTo:{mode:'width',value:variant.pixels},font:{loadSystemFonts:false}}).render().asPng();
  await writeFile(path.join(iconset,variant.name),bytes);
  receipts.push({...variant,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path.join(output,'GitWorld.png'),new Resvg(full,{font:{loadSystemFonts:false}}).render().asPng());
if(process.platform==='darwin'){
  const result=spawnSync('/usr/bin/iconutil',['--convert','icns','--output',path.join(output,'GitWorld.icns'),iconset],{stdio:'inherit'});
  if(result.status!==0)throw new Error('ICONUTIL_FAILED');
}
await writeFile(path.join(output,'manifest.json'),JSON.stringify({artwork:'Original GitWorld artwork',license:'Apache-2.0',renderer:'@resvg/resvg-js@2.6.2',sources:[{path:'apps/desktop/resources/icon.svg',sha256:createHash('sha256').update(full).digest('hex')},{path:'apps/desktop/resources/icon-small.svg',sha256:createHash('sha256').update(small).digest('hex')}],outputs:receipts},null,2));
console.log(process.platform==='darwin'?'Original application PNGs and ICNS generated.':'Original application PNGs generated; ICNS assembly requires macOS iconutil.');
