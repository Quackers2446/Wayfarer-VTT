import {tokenSize} from './actor-space.mjs';
import {actorIsUp,condition,hasFeature,occupies,keyAt,canSee} from './combat.mjs';
import {getWallData,mapWalls,mapFloor} from './map-walls.mjs';
import {segmentIntersection,segmentEnds} from './wall-geometry.mjs';
import {exploredCells,rememberCells,saveExplored} from './fog-memory.mjs';
const cache=new WeakMap(),holders=new WeakMap(),combined=new WeakMap();
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export const fogSettings=b=>({sharedVision:true,remember:true,opacity:1,exploredOpacity:.65,softness:1,blockMovement:true,...b.fogSettings});
export function visionSettings(actor) {
  const range=actor.astralVisage || hasFeature(actor,"Devil's Sight") ? 120 : Number.isFinite(actor.darkvision) ? Math.max(30,Math.min(120,actor.darkvision)) : 30;
  return {enabled:true,range,angle:360,facing:0,...actor.vision};
}
export function visionActors(battle,controller) {
  return battle.actors.filter(actor=>actor.side==='party' && actorIsUp(actor) && occupies(actor) && !condition(actor,'Asleep') && visionSettings(actor).enabled &&
    (controller==null || fogSettings(battle).sharedVision || !battle.controllers?.[actor.id] || battle.controllers[actor.id]===controller));
}
export function blockingSegments(battle,map) {
  const data=getWallData(map,battle),walls=mapWalls(map,battle),segments=[];
  if(data && (data.manual || data.walls?.length || data.doors?.length)) {
    segments.push(...(data.walls ?? []).filter(s=>s.blocksVision!==false),...(data.doors ?? []).filter(s=>s.state!=='open' && s.blocksVision!==false));
  } else if(walls?.rows) {
    for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++) if(mapFloor(map,x,y,battle)) {
      for(const [dx,dy,a,b] of [[-1,0,[x,y],[x,y+1]],[1,0,[x+1,y],[x+1,y+1]],[0,-1,[x,y],[x+1,y]],[0,1,[x,y+1],[x+1,y+1]]])
        if(!mapFloor(map,x+dx,y+dy,battle))segments.push({x1:a[0],y1:a[1],x2:b[0],y2:b[1]});
    }
    for(const edge of [...walls.edges,...walls.screen]) {
      const [a,b]=edge.split('/').map(p=>p.split(':').map(Number));
      if(a[0]===b[0])segments.push({x1:a[0],y1:Math.max(a[1],b[1]),x2:a[0]+1,y2:Math.max(a[1],b[1])});
      else segments.push({x1:Math.max(a[0],b[0]),y1:a[1],x2:Math.max(a[0],b[0]),y2:a[1]+1});
    }
  }
  for(const [key,type] of Object.entries(battle.terrain??{}))if(type==='wall') {
    const [x,y]=key.split(':').map(Number);segments.push({x1:x,y1:y,x2:x+1,y2:y},{x1:x+1,y1:y,x2:x+1,y2:y+1},{x1:x+1,y1:y+1,x2:x,y2:y+1},{x1:x,y1:y+1,x2:x,y2:y});
  }
  return segments;
}
function memoryHolder(battle,id) {
  let map=holders.get(battle);if(!map)holders.set(battle,map=new Map());
  let holder=map.get(id);if(!holder)map.set(id,holder={});
  holder.fogMemory=battle.fogMemoryByActor?.[id];return holder;
}
function visibilityKey(battle,map) {
  return [map.key,map.cols,map.rows,battle.wallRevision,JSON.stringify(getWallData(map,battle)),JSON.stringify(battle.terrain),JSON.stringify(battle.spellZones),
    ...visionActors(battle).map(a=>[a.id,a.x,a.y,tokenSize(a),a.astralVisage,JSON.stringify(a.vision),a.darkvision].join(':'))].join('/');
}
function polygonFor(actor,segments,map) {
  const settings=visionSettings(actor),radius=clamp(Number(settings.range)||0,0,300)/5;
  if(!radius)return [];
  const size=tokenSize(actor);
  const origin={x:actor.x+size/2,y:actor.y+size/2},facing=(Number(settings.facing)||0)*Math.PI/180,half=clamp(Number(settings.angle)||360,1,360)*Math.PI/360;
  const angles=[];
  for(let i=0;i<=128;i++)angles.push(-half+i*half*2/128);
  for(const segment of segments)for(const p of segmentEnds(segment)) {
    if(Math.hypot(p.x-origin.x,p.y-origin.y)>radius+1)continue;
    const angle=Math.atan2(p.y-origin.y,p.x-origin.x)-facing;
    for(const offset of [-.00001,0,.00001]) {let a=Math.atan2(Math.sin(angle+offset),Math.cos(angle+offset));if(Math.abs(a)<=half)angles.push(a);}
  }
  angles.sort((a,b)=>a-b);
  const points=angles.map(angle=>{
    const to={x:origin.x+Math.cos(angle+facing)*radius,y:origin.y+Math.sin(angle+facing)*radius};let best=to,distance=1;
    for(const wall of segments) {const hit=segmentIntersection(origin,to,...segmentEnds(wall));if(hit && hit.t>1e-7 && hit.t<distance){distance=hit.t;best=hit;}}
    return {x:best.x,y:best.y};
  });
  return half<Math.PI ? [origin,...points] : points;
}
function inside(point,polygon) {
  let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;
}
export function visionData(battle,map) {
  const key=visibilityKey(battle,map),old=cache.get(battle);if(old?.key===key)return old;
  const segments=blockingSegments(battle,map),perActor=new Map(),all=new Set();
  // Include map edges so no visibility ray escapes the artwork.
  segments.push({x1:0,y1:0,x2:map.cols,y2:0},{x1:map.cols,y1:0,x2:map.cols,y2:map.rows},{x1:map.cols,y1:map.rows,x2:0,y2:map.rows},{x1:0,y1:map.rows,x2:0,y2:0});
  for(const actor of visionActors(battle)) {
    const zones=(battle.spellZones??[]).filter(z=>z.blocksVision!==false).filter(z=>z.name!=='Darkness' || !(actor.astralVisage || hasFeature(actor,"Devil's Sight")));
    const zoneSegments=[];for(const zone of zones)for(const cell of zone.cells){const [x,y]=cell.split(':').map(Number);zoneSegments.push({x1:x,y1:y,x2:x+1,y2:y},{x1:x+1,y1:y,x2:x+1,y2:y+1},{x1:x+1,y1:y+1,x2:x,y2:y+1},{x1:x,y1:y+1,x2:x,y2:y});}
    const inZone=zones.some(z=>z.cells.includes(keyAt(actor.x,actor.y)));
    const polygon=inZone ? [{x:actor.x,y:actor.y},{x:actor.x+1,y:actor.y},{x:actor.x+1,y:actor.y+1},{x:actor.x,y:actor.y+1}] : polygonFor(actor,[...segments,...zoneSegments],map),visible=new Set(),r=Math.ceil(clamp(Number(visionSettings(actor).range)||0,0,300)/5)+4;
    for(let y=Math.max(0,actor.y-r);y<Math.min(map.rows,actor.y+r+1);y++)for(let x=Math.max(0,actor.x-r);x<Math.min(map.cols,actor.x+r+1);x++)
      if(mapFloor(map,x,y,battle) && inside({x:x+.5,y:y+.5},polygon) && canSee(battle,actor,{x,y},map)) {visible.add(keyAt(x,y));all.add(keyAt(x,y));}
    // A token's own square is visible even if it is exactly on a wall endpoint.
    if(polygon.length){visible.add(keyAt(actor.x,actor.y));all.add(keyAt(actor.x,actor.y));}
    perActor.set(actor.id,{polygon,visible});
  }
  const data={key,perActor,all,views:new Map()};cache.set(battle,data);return data;
}
export function viewerVision(battle,map,controller) {
  const data=visionData(battle,map),actors=visionActors(battle,controller),key=actors.map(a=>a.id).join('|');
  if(!data.views.has(key)) {
    const visible=new Set(),polygons=[];
    for(const actor of actors) {const view=data.perActor.get(actor.id);if(view){polygons.push(view.polygon);for(const cell of view.visible)visible.add(cell);}}
    data.views.set(key,{visible,polygons});
  }
  return data.views.get(key);
}
export function rememberDynamicVision(battle,map) {
  for(const id of Object.keys(battle.fogMemoryByActor??{}))if(!battle.actors.some(a=>a.id===id && a.side==='party'))delete battle.fogMemoryByActor[id];
  if(!fogSettings(battle).remember)return;
  const data=visionData(battle,map);rememberCells(exploredCells(battle,map),data.all);
  for(const [id,view] of data.perActor) {
    const holder=memoryHolder(battle,id);rememberCells(exploredCells(holder,map),view.visible);saveExplored(holder,map);
    if(holder.fogMemory)(battle.fogMemoryByActor ??= {})[id]=holder.fogMemory;
  }
}
export function viewerMemory(battle,map,controller) {
  if(fogSettings(battle).remember && (controller==null || fogSettings(battle).sharedVision))return exploredCells(battle,map);
  const actors=battle.actors.filter(a=>a.side==='party' && (controller==null || fogSettings(battle).sharedVision || !battle.controllers?.[a.id] || battle.controllers[a.id]===controller)),keys=actors.map(a=>battle.fogMemoryByActor?.[a.id]?.data || ''),signature=[fogSettings(battle).remember,map.cols,map.rows,...actors.map(a=>a.id),...keys].join('|');
  const old=combined.get(battle);if(old?.signature===signature)return old.memory;
  const bytes=new Uint8Array(Math.ceil(map.cols*map.rows/8));
  if(fogSettings(battle).remember)for(const actor of actors){const m=exploredCells(memoryHolder(battle,actor.id),map);for(let i=0;i<bytes.length;i++)bytes[i]|=m.bytes[i];}
  const memory={cols:map.cols,rows:map.rows,bytes,revision:0};combined.set(battle,{signature,memory});return memory;
}
