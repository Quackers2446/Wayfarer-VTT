import {preserveSpawnMarkers} from './spawn-points.mjs';
import {seedYpHubScene} from './hub-quests.mjs';

// Reset only the active map. The room's character ledger remains intact.
export async function resetSceneBoard(battle, map, { populate, training, reviveParty = false } = {}) {
  if (battle.movement || battle.classReaction) throw Error('Resolve the pending reaction before resetting the board.');
  const next = structuredClone(battle);
  next.actors = next.actors.filter(actor => actor.side === 'party');
  for (const actor of next.actors) {
    delete actor.carrying; delete actor.carriedBy; delete actor.dragging; delete actor.draggedBy;
  }
  Object.assign(next, { order: [], turn: 0, round: 0, spent: 0, dash: 0, action: null,
    attacksMade: 0, bonusUsed: false, terrain: {}, markers: preserveSpawnMarkers(battle.markers), features: [], spellZones: [], sceneReady: false });
  for (const key of ['earlyMovement', 'sharedTurns', 'sharedEnded', 'combatId', 'unplacedScene', 'worldLootVersion']) delete next[key];
  if (reviveParty) restorePartyForRetry(next);
  if (map.module === 'training') {
    next.actors.push(...training().filter(actor => actor.side !== 'party'));
    next.sceneReady = true;
  } else await populate(map, next);
  // Hub NPCs/props are authored outside populateScene — put them back after a wipe.
  if (map.module === 'YPHub') seedYpHubScene(map, next);
  return next;
}

/** Bring player characters back to fighting shape for an encounter retry (no checkpoint system). */
export function restorePartyForRetry(battle) {
  for (const actor of battle.actors.filter((entry) => entry.side === 'party' && !entry.summoner)) {
    actor.dead = false;
    actor.hp = actor.maxHp;
    actor.tempHp = 0;
    actor.successes = 0;
    actor.failures = 0;
    actor.stable = false;
    actor.prone = false;
    actor.conditions = [];
    delete actor.concentration;
    delete actor.defeatedAt;
    delete actor.finalBlow;
  }
}
