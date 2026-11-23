import {visionData,rememberDynamicVision} from './dynamic-fog.mjs';
import {actorIsUp, canSee, condition, distanceFt, keyAt, occupies, startInitiative} from "./combat.mjs";
import {cellCenter, regionAt} from "./encounters.mjs";
import {mapWalls} from "./map-walls.mjs";

const roomGrids = new WeakMap();
const roomNeighbors = [[-1,0],[1,0],[0,-1],[0,1]];
const mapGeometry = (map) => [map.cols,map.rows,map.offsetX,map.offsetY,map.cellWidth ?? map.size,map.cellHeight ?? map.size].join(":");

function roomId(map,cell) {
  const geometry = mapGeometry(map);
  let grid = roomGrids.get(map);
  if (grid?.geometry !== geometry) {
    grid = {geometry,cells:new Map()};
    roomGrids.set(map,grid);
  }
  const key = keyAt(cell.x,cell.y);
  if (!grid.cells.has(key)) {
    const region = regionAt(map,...cellCenter(map,cell));
    grid.cells.set(key,region?.key ?? region?.id);
  }
  return grid.cells.get(key);
}
const hostile = (actor) => actor?.side === "hostile" && actorIsUp(actor) && occupies(actor);

export function inSight(battle, map, partyMember, target, maxDistance = 30) {
  if (!actorIsUp(partyMember) || !occupies(partyMember)) return false;
  const distance = distanceFt(partyMember,target);
  if (distance > maxDistance || !canSee(battle,partyMember,target,map)) return false;
  if (mapWalls(map,battle) || !map.regions.length || distance <= 5) return true;
  const friendRoom = roomId(map,partyMember);
  const enemyRoom = roomId(map,target);
  if (friendRoom === enemyRoom) return true;
  if (!friendRoom || !enemyRoom) return distance <= 15;
  // Reveal the first row of an adjoining area when the ray to it is clear.
  return roomNeighbors.some(([dx,dy]) => roomId(map,{x:target.x+dx,y:target.y+dy}) === friendRoom);
}

export function partyVision(battle,map) {return visionData(battle,map).all;}
export function rememberVision(battle,map) {rememberDynamicVision(battle,map);}

export function noticesEnemy(battle,map,partyMember,enemy) {
  return hostile(enemy) && inSight(battle,map,partyMember,enemy,condition(partyMember,"Invisible") ? 5 : enemy.sight ?? 30);
}

export function enemyInSight(battle, map, actor) {
  return battle.actors.find((entry) => noticesEnemy(battle,map,actor,entry));
}

export function engageEnemy(battle, map, actor, enemy, noticed = false, random = Math.random) {
  if (!hostile(enemy) || !actorIsUp(actor)) return false;
  if (battle.round) return false;
  const enemyRoom = roomId(map,enemy);
  const participants = new Set(battle.actors.filter((entry) => entry.side === "party" && occupies(entry)).map(({id}) => id));
  for (const entry of battle.actors.filter(hostile)) {
    const sameArea = (enemyRoom && roomId(map,entry) === enemyRoom) || (enemy.origin && enemy.origin === entry.origin);
    if (entry.id === enemy.id || noticesEnemy(battle,map,actor,entry) || (!mapWalls(map,battle) && sameArea)) participants.add(entry.id);
  }
  startInitiative(battle,random,participants);
  return noticed
    ? enemy.name + " spotted " + actor.name + ". Initiative rolled."
    : actor.name + " engaged " + enemy.name + ". Initiative rolled.";
}


// Keep the party in combat while anyone (including a downed ally) is still nearby.
export function partyEscaped(battle) {
  if(!battle.round || battle.movement || battle.classReaction) return false;
  const party=battle.actors.filter(actor=>actor.side==='party' && !actor.dead && occupies(actor));
  const enemies=battle.actors.filter(actor=>hostile(actor) && battle.order.includes(actor.id));
  return party.length>0 && enemies.length>0 && party.every(ally=>enemies.every(enemy=>distanceFt(ally,enemy)>90));
}
