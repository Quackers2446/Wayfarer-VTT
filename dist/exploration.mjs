import {actorIsUp, distanceFt, lineClear, occupies, startInitiative} from "./combat.mjs";
import {cellCenter, regionAt} from "./encounters.mjs";

const roomId = (map, cell) => regionAt(map,...cellCenter(map,cell))?.id;
const hostile = (actor) => actor?.side === "hostile" && actorIsUp(actor) && occupies(actor);

export function noticesEnemy(battle, map, partyMember, enemy) {
  if (!actorIsUp(partyMember) || !occupies(partyMember) || !hostile(enemy)) return false;
  const distance = distanceFt(partyMember,enemy);
  if (distance > (enemy.sight ?? 30) || !lineClear(battle,partyMember,enemy)) return false;
  if (!map.regions.length || distance <= 5) return true;
  const friendRoom = roomId(map,partyMember);
  const enemyRoom = roomId(map,enemy);
  // The source provides room areas, while manually marked walls govern the grid.
  // Keep encounters in their source room until the party reaches its boundary.
  return Boolean(friendRoom && friendRoom === enemyRoom) || ((!friendRoom || !enemyRoom) && distance <= 15);
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
    if (entry.id === enemy.id || noticesEnemy(battle,map,actor,entry) ||
        (enemyRoom && roomId(map,entry) === enemyRoom) ||
        (enemy.origin && enemy.origin === entry.origin)) participants.add(entry.id);
  }
  startInitiative(battle,random,participants);
  return noticed
    ? enemy.name + " spotted " + actor.name + ". Initiative rolled."
    : actor.name + " engaged " + enemy.name + ". Initiative rolled.";
}
