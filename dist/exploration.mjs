import {actorIsUp, distanceFt, keyAt, lineClear, occupies, startInitiative} from "./combat.mjs";
import {cellCenter, regionAt} from "./encounters.mjs";
import {exploredCells, rememberCells} from "./fog-memory.mjs";
import {mapFloor, mapWalls} from "./map-walls.mjs";

const roomGrids = new WeakMap();
const cachedVision = new WeakMap();
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
  if (distance > maxDistance || !lineClear(battle,partyMember,target,map,{vision:true})) return false;
  if (mapWalls(map) || !map.regions.length || distance <= 5) return true;
  const friendRoom = roomId(map,partyMember);
  const enemyRoom = roomId(map,target);
  if (friendRoom === enemyRoom) return true;
  if (!friendRoom || !enemyRoom) return distance <= 15;
  // Reveal the first row of an adjoining area when the ray to it is clear.
  return roomNeighbors.some(([dx,dy]) => roomId(map,{x:target.x+dx,y:target.y+dy}) === friendRoom);
}

export function partyVision(battle,map) {
  const heroes = battle.actors.filter((actor) => actor.side === "party" && actorIsUp(actor) && occupies(actor));
  const signature = [mapGeometry(map),...heroes.map((actor) => `${actor.x}:${actor.y}:${actor.darkvision}`),
    ...Object.keys(battle.terrain).filter((cell) => battle.terrain[cell] === "wall")].join("/");
  const cached = cachedVision.get(battle);
  if (cached?.map === map && cached.signature === signature) return cached.visible;
  const visible = new Set();
  for (const actor of heroes) {
    const distance = Number.isFinite(actor.darkvision) ? Math.max(30,Math.min(120,actor.darkvision)) : 30;
    const cells = Math.ceil(distance/5);
    for (let y = Math.max(0,actor.y-cells); y <= Math.min(map.rows-1,actor.y+cells); y++) {
      for (let x = Math.max(0,actor.x-cells); x <= Math.min(map.cols-1,actor.x+cells); x++) {
        if (mapFloor(map,x,y) && inSight(battle,map,actor,{x,y},distance)) visible.add(keyAt(x,y));
      }
    }
  }
  cachedVision.set(battle,{map,signature,visible});
  return visible;
}

export function rememberVision(battle,map) {
  const visible = partyVision(battle,map);
  if (visible.size) rememberCells(exploredCells(battle,map),visible);
}

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
