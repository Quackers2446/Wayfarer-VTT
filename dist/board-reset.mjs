// Reset only the active map. The room's character ledger remains intact.
export async function resetSceneBoard(battle, map, { populate, training }) {
  if (battle.movement || battle.classReaction) throw Error('Resolve the pending reaction before resetting the board.');
  const next = structuredClone(battle);
  next.actors = next.actors.filter(actor => actor.side === 'party');
  for (const actor of next.actors) {
    delete actor.carrying; delete actor.carriedBy;
  }
  Object.assign(next, { order: [], turn: 0, round: 0, spent: 0, dash: 0, action: null,
    attacksMade: 0, bonusUsed: false, terrain: {}, markers: [], spellZones: [], sceneReady: false });
  for (const key of ['earlyMovement', 'sharedTurns', 'sharedEnded', 'combatId', 'unplacedScene', 'worldLootVersion']) delete next[key];
  if (map.module === 'training') {
    next.actors.push(...training().filter(actor => actor.side !== 'party'));
    next.sceneReady = true;
  } else await populate(map, next);
  return next;
}
