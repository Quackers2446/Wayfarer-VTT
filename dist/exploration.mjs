import {visionData,rememberDynamicVision} from './dynamic-fog.mjs';
import {actorIsUp, canSee, condition, distanceFt, keyAt, occupies, startInitiative} from "./combat.mjs";
import {cellCenter, regionAt} from "./encounters.mjs";
import {mapWalls} from "./map-walls.mjs";
import {actorPartyId, isAttackablePc, isCombatFoe, sameParty} from "./parties.mjs";

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
  if (!actorIsUp(actor) || !occupies(actor) || !enemy || !isCombatFoe(actor, enemy) || !actorIsUp(enemy) || !occupies(enemy)) return false;
  if (battle.round) return false;
  const pvp = isAttackablePc(actor, enemy);
  const participants = new Set();
  if (pvp) {
    participants.add(actor.id);
    participants.add(enemy.id);
    // Pull in nearby same-party members so a scrap can include the full groups.
    for (const entry of battle.actors.filter(entry => entry.side === 'party' && occupies(entry) && actorIsUp(entry))) {
      if (!sameParty(entry, actor) && !sameParty(entry, enemy)) continue;
      if (entry.id === actor.id || entry.id === enemy.id || distanceFt(entry, actor) <= 60 || distanceFt(entry, enemy) <= 60 ||
        inSight(battle, map, entry, actor, 60) || inSight(battle, map, entry, enemy, 60)) {
        participants.add(entry.id);
      }
    }
  } else {
    if (!hostile(enemy)) return false;
    const party = actorPartyId(actor);
    for (const entry of battle.actors.filter(entry => entry.side === 'party' && occupies(entry))) {
      if (actorPartyId(entry) === party) participants.add(entry.id);
    }
    const enemyRoom = roomId(map,enemy);
    for (const entry of battle.actors.filter(hostile)) {
      const sameArea = (enemyRoom && roomId(map,entry) === enemyRoom) || (enemy.origin && enemy.origin === entry.origin);
      const kennelAlert = battle.story?.kennel?.alerted && entry.origin === "034";
      if (entry.id === enemy.id || noticesEnemy(battle,map,actor,entry) || kennelAlert || (!mapWalls(map,battle) && sameArea)) participants.add(entry.id);
    }
    // Befriended kennel wolves join the scrap on the party's side.
    for (const ally of battle.actors.filter((entry) => entry.kennelAlly && entry.side === "party" && occupies(entry) && actorIsUp(entry))) {
      if (actorPartyId(ally) === party) participants.add(ally.id);
    }
  }
  startInitiative(battle,random,participants);
  return noticed
    ? enemy.name + " spotted " + actor.name + ". Initiative rolled."
    : actor.name + (pvp ? " attacked " : " engaged ") + enemy.name + ". Initiative rolled.";
}


// Keep combat while any living party still has someone near enemies.
// One party fleeing must not end the encounter for rivals still in the fight.
// PvP scraps do not auto-end by distance — players must mutually leave.
export function partyEscaped(battle) {
  if(!battle.round || battle.movement || battle.classReaction) return false;
  const enemies=battle.actors.filter(actor=>hostile(actor) && battle.order.includes(actor.id));
  if (!enemies.length) return false;
  const partyIds = new Set(battle.order.map(id => battle.actors.find(actor => actor.id === id))
    .filter(actor => actor?.side === 'party').map(actor => actorPartyId(actor)));
  if (!partyIds.size) return false;
  let sawParty = false;
  for (const partyId of partyIds) {
    const party=battle.actors.filter(actor=>actor.side==='party' && actorPartyId(actor)===partyId && !actor.dead && occupies(actor) && battle.order.includes(actor.id));
    if (!party.length) continue;
    sawParty = true;
    if (!party.every(ally => enemies.every(enemy => distanceFt(ally, enemy) > 90))) return false;
  }
  return sawParty;
}

/** True when every player character in a party is dead or at 0 HP (summons do not count). */
export function partyDefeated(battle, partyId = null) {
  const heroes = battle.actors.filter((actor) => actor.side === "party" && actor.resolveDeath && !actor.summoner &&
    (partyId == null || actorPartyId(actor) === partyId));
  return heroes.length > 0 && heroes.every((actor) => !actorIsUp(actor));
}
