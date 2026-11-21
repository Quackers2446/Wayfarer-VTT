import {actorIsUp, distanceFt, keyAt, lineClear, occupies, startInitiative} from "./combat.mjs";
import {cellCenter, regionAt} from "./encounters.mjs";
import {mapFloor, mapWalls} from "./map-walls.mjs";

function roomId(map,cell) {
  const region = regionAt(map,...cellCenter(map,cell));
  return region?.key ?? region?.id;
}
const hostile = (actor) => actor?.side === "hostile" && actorIsUp(actor) && occupies(actor);

export function inSight(battle, map, partyMember, target, maxDistance = 30) {
  if (!actorIsUp(partyMember) || !occupies(partyMember)) return false;
  const distance = distanceFt(partyMember,target);
  if (distance > maxDistance || !lineClear(battle,partyMember,target,map,{vision:true})) return false;
  if (mapWalls(map) || !map.regions.length || distance <= 5) return true;
  const friendRoom = roomId(map,partyMember);
  const enemyRoom = roomId(map,target);
  // The source provides room areas, while manually marked walls govern the grid.
  // Keep encounters in their source room until the party reaches its boundary.
  return Boolean(friendRoom && friendRoom === enemyRoom) || ((!friendRoom || !enemyRoom) && distance <= 15);
}

export function partyVision(battle,map) {
  if (!mapWalls(map)) return null;
  const visible = new Set();
  for (const actor of battle.actors) {
    if (actor.side !== "party" || !actorIsUp(actor) || !occupies(actor)) continue;
    const distance = Number.isFinite(actor.darkvision) ? Math.max(30,Math.min(120,actor.darkvision)) : 30;
    const cells = Math.ceil(distance/5);
    for (let y = Math.max(0,actor.y-cells); y <= Math.min(map.rows-1,actor.y+cells); y++) {
      for (let x = Math.max(0,actor.x-cells); x <= Math.min(map.cols-1,actor.x+cells); x++) {
        if (mapFloor(map,x,y) && inSight(battle,map,actor,{x,y},distance)) visible.add(keyAt(x,y));
      }
    }
  }
  return visible;
}

export function rememberVision(battle,map) {
  const visible = partyVision(battle,map);
  if (visible?.size) battle.explored = [...new Set([...exploredCells(battle),...visible])];
}

export const exploredCells = (battle) => Array.isArray(battle.explored) ? battle.explored : [];

export function noticesEnemy(battle,map,partyMember,enemy) {
  return hostile(enemy) && inSight(battle,map,partyMember,enemy,enemy.sight ?? 30);
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
    if (entry.id === enemy.id || noticesEnemy(battle,map,actor,entry) || (!mapWalls(map) && sameArea)) participants.add(entry.id);
  }
  startInitiative(battle,random,participants);
  return noticed
    ? enemy.name + " spotted " + actor.name + ". Initiative rolled."
    : actor.name + " engaged " + enemy.name + ". Initiative rolled.";
}
