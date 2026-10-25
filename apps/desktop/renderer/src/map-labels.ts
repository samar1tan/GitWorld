export type MapLabel = { id:string; x:number; y:number; width:number; height:number };
export type PlacedMapLabel = MapLabel & { centerX:number; centerY:number; lineX:number; lineY:number };

/** Keep labels near their geographic anchor without hiding neighboring subjects. */
export function placeMapLabels(width:number,height:number,labels:MapLabel[]):PlacedMapLabel[] {
  const placed:PlacedMapLabel[]=[];
  const margin=8;
  const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
  const overlap=(x:number,y:number,w:number,h:number,b:PlacedMapLabel)=>Math.max(0,Math.min(x+w/2,b.centerX+b.width/2+margin)-Math.max(x-w/2,b.centerX-b.width/2-margin))*Math.max(0,Math.min(y+h/2,b.centerY+b.height/2+margin)-Math.max(y-h/2,b.centerY-b.height/2-margin));
  for(const label of [...labels].sort((a,b)=>a.y-b.y||a.x-b.x||a.id.localeCompare(b.id))) {
    const candidates:{x:number;y:number;cost:number}[]=[];
    for(let ring=0;ring<8;ring++) {
      const dx=label.width/2+16+ring*22,dy=label.height/2+16+ring*22;
      for(const [ox,oy] of [[0,-dy],[0,dy],[dx,0],[-dx,0],[dx,-dy],[-dx,-dy],[dx,dy],[-dx,dy]]) {
        const x=clamp(label.x+ox,margin+label.width/2,width-margin-label.width/2);
        const y=clamp(label.y+oy,margin+label.height/2,height-margin-label.height/2);
        const penalty=placed.reduce((sum,b)=>sum+overlap(x,y,label.width,label.height,b),0);
        candidates.push({x,y,cost:penalty*10000+(x-label.x)**2+(y-label.y)**2});
      }
    }
    const best=candidates.sort((a,b)=>a.cost-b.cost)[0];
    placed.push({...label,centerX:best.x,centerY:best.y,lineX:clamp(label.x,best.x-label.width/2,best.x+label.width/2),lineY:clamp(label.y,best.y-label.height/2,best.y+label.height/2)});
  }
  return placed;
}
