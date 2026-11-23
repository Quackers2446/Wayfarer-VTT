import {gridGeometry} from './map-grid.mjs';
import {newBattle,canStand} from './combat.mjs';
import {startingRegion,regionCells} from './encounters.mjs';

// One canonical battle/character ledger belongs to a room. Scenes contain only
// physical map data; they never contain another battle, party, XP or inventory.
export const sceneFields=['terrain','markers','wallData','wallRevision','fogMemory','fogMemoryByActor','explored','alignedGrid','gridManual','gridOverlay','sceneReady','worldLootVersion','spellZones'];
const clone=value=>structuredClone(value);
const savedMap=map=>({...map,regions:map.regions.map(region=>({...region,entry:region.entry?{name:region.entry.name,entries:(region.entry.entries??[]).filter(entry=>entry?.type==='insetReadaloud')}:undefined}))});
export function roomMapChoices(state,available=[]){const choices=new Map();for(const entry of [...available,state.currentMap,...Object.values(state.world?.maps??{}).map(scene=>scene.map)])if(entry?.module===state.currentMap?.module && !choices.has(entry.key))choices.set(entry.key,entry);return [...choices.values()];}
const scenery=battle=>Object.fromEntries(sceneFields.filter(key=>battle[key]!==undefined).map(key=>[key,clone(battle[key])]));
const positions=battle=>Object.fromEntries(battle.actors.filter(actor=>actor.side==='party').map(actor=>[actor.id,{x:actor.x,y:actor.y}]));
export function commitRoomState(previous,map,battle,alignment=null){
 const state={...previous},oldKey=previous?.currentMap?.key ?? map.key;
 const elsewhere=(previous?.battle?.actors ?? []).filter(actor=>actor.side!=='party' && (actor.sceneKey ?? oldKey)!==map.key);
 state.battle={...battle,actors:[...battle.actors.filter(actor=>actor.side==='party'),...elsewhere,...battle.actors.filter(actor=>actor.side!=='party').map(actor=>({...actor,sceneKey:map.key}))]};
 state.currentMap=map;state.alignment=alignment;
 state.world={version:1,maps:{...previous?.world?.maps,[map.key]:{map:savedMap(map),partyPositions:positions(battle),alignment}}};
 return state;
}
export function roomBattle(state,map=state.currentMap){
 const key=map.key;
 return {...state.battle,actors:state.battle.actors.filter(actor=>actor.side==='party'||(actor.sceneKey ?? key)===key)};
}
export function normalizeRoomState(state,map){
 if(state.world?.version===1 && state.currentMap)return state;
 return commitRoomState(state,map,state.battle,state.alignment ?? null);
}
export function travelRoom(state,nextMap){
 state=normalizeRoomState(state,state.currentMap ?? nextMap);
 if(state.currentMap.module!==nextMap.module)throw Error('Choose a map from this room’s adventure.');
 if(state.currentMap.key===nextMap.key)return clone(state);
 if(state.battle.round || state.battle.movement || state.battle.classReaction)throw Error('Finish combat and pending reactions before changing maps.');
 if(nextMap.sourceGrid)nextMap={...nextMap,...gridGeometry(nextMap,state.world.maps[nextMap.key]?.alignment ?? nextMap.sourceGrid)};
 const next=clone(state),scene=next.world.maps[nextMap.key];
 next.world.maps[state.currentMap.key].environment=scenery(state.battle);
 for(const field of sceneFields)delete next.battle[field];
 Object.assign(next.battle,{terrain:{},markers:[]},scene?.environment ?? {});
 next.currentMap=clone(nextMap);next.alignment=scene?.alignment ?? null;
 const active=roomBattle(next),party=active.actors.filter(actor=>actor.side==='party');
 const carried=new Set(party.map(actor=>actor.carrying).filter(Boolean));
 // Carried creatures travel with their carrier rather than remaining on the old map.
 for(const body of next.battle.actors)if(carried.has(body.id)){body.sceneKey=nextMap.key;if(!active.actors.some(actor=>actor.id===body.id))active.actors.push(body);}
 for(const actor of party){actor.x=null;actor.y=null;}
 const entrance=startingRegion(nextMap),candidates=entrance?regionCells(nextMap,entrance):Array.from({length:nextMap.cols*nextMap.rows},(_,i)=>({x:i%nextMap.cols,y:Math.floor(i/nextMap.cols)}));
 for(const actor of party){
  const remembered=scene?.partyPositions?.[actor.id],cell=[...(remembered?.x!=null?[remembered]:[]),...candidates].find(cell=>canStand(active,actor,cell.x,cell.y,nextMap));
  if(!cell)throw Error('There is no open arrival space for the party on this map.');
  actor.x=cell.x;actor.y=cell.y;
  const body=active.actors.find(body=>body.id===actor.carrying);if(body){body.x=actor.x;body.y=actor.y;}
 }
 active.spellZones=(active.spellZones??[]).filter(zone=>{if(zone.custom){if(zone.expires!=null&&zone.expires<=(active.elapsed??0))return false;if(zone.concentration===false)return true;return active.actors.find(actor=>actor.id===zone.caster)?.concentration?.name===zone.name;}return !zone.caster || active.actors.find(actor=>actor.id===zone.caster)?.concentration;});
 return commitRoomState(next,nextMap,active,next.alignment);
}
