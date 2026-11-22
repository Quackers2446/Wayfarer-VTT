import {monsterSizes} from './monster-sizes.mjs';
const codes={tiny:'T',small:'S',medium:'M',large:'L',huge:'H',gargantuan:'G'};
export function creatureSize(actor) {
  const name=actor?.statName ?? (actor?.side!=='party' ? actor?.name?.replace(/\s\d+$/,'') : '');
  const value=actor?.creatureSize ?? actor?.size ?? monsterSizes[String(name).toLowerCase()+'|'+String(actor?.source ?? 'MM').toLowerCase()] ?? 'M',raw=Array.isArray(value) ? value[0] : value;
  const code=codes[String(raw).toLowerCase()] ?? String(raw).toUpperCase();
  return 'TSMLHG'.includes(code) && code.length===1 ? code : 'M';
}
export const tokenSize=actor=>({L:2,H:3,G:4}[creatureSize(actor)] ?? 1);
export const sizeRank=actor=>'TSMLHG'.indexOf(creatureSize(actor));
export function actorCells(actor) {
  const cells=[],n=tokenSize(actor);
  for(let dy=0;dy<n;dy++) for(let dx=0;dx<n;dx++) cells.push({x:actor.x+dx,y:actor.y+dy});
  return cells;
}
export const containsCell=(actor,x,y)=>x>=actor.x && y>=actor.y && x<actor.x+tokenSize(actor) && y<actor.y+tokenSize(actor);
export const overlaps=(a,b)=>a.x<b.x+tokenSize(b) && b.x<a.x+tokenSize(a) && a.y<b.y+tokenSize(b) && b.y<a.y+tokenSize(a);
export const spaceDistance=(a,b)=>Math.max(0,a.x-(b.x+tokenSize(b)-1),b.x-(a.x+tokenSize(a)-1),a.y-(b.y+tokenSize(b)-1),b.y-(a.y+tokenSize(a)-1))*5;
export const touchesArea=(actor,area)=>actorCells(actor).some(({x,y})=>area.has(x+':'+y));
export const tokenRadius=(map,actor)=>map.size*(creatureSize(actor)==='T' ? .21 : tokenSize(actor)/2-.08);
