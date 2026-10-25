export type NativeTitlebarPosition={x:number;y:number};

/** Keep native controls within the upper window chrome; renderer input never controls x or zoom. */
export function nativeTitlebarPosition(payload:unknown,zoom:number,windowHeight:number):NativeTitlebarPosition|undefined {
  if(!payload || typeof payload!=='object' || Array.isArray(payload) || Object.keys(payload).join(',')!=='centerY')return;
  if(!Number.isFinite(zoom) || zoom<0.25 || zoom>5 || !Number.isFinite(windowHeight) || windowHeight<32)return;
  const centerY=(payload as {centerY:unknown}).centerY;
  if(centerY===null)return {x:16,y:18};
  if(typeof centerY!=='number' || !Number.isFinite(centerY) || centerY<0 || centerY>256)return;
  // The 52-point title row was visually calibrated at native y=18 (center offset 8).
  return {x:16,y:Math.round(Math.max(8,Math.min(128,windowHeight-24,centerY*zoom-8)))};
}
