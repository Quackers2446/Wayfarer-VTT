import assert from 'node:assert/strict';
import {makeActor, newBattle, startInitiative, endInitiative, sharedTurnGroup, canTakeTurn, requestTruce, currentActor} from '../dist/combat.mjs';
import {engageEnemy, partyDefeated, partyEscaped} from '../dist/exploration.mjs';
import {actorPartyId, createParty, ensureParties, isAttackablePc, isCombatFoe, isPvpCombat, partyFull, sameParty} from '../dist/parties.mjs';

const map = {cols: 20, rows: 12, width: 1400, height: 840, size: 70, offsetX: 0, offsetY: 0, regions: []};

function hero(name, partyId, x, y, initiative = 10) {
  return makeActor({name, side: 'party', partyId, resolveDeath: true, hp: 20, maxHp: 20, x, y, initiative, dex: 12,
    attacks: [{name: 'Sword', damage: '1d8+3', bonus: 5, reach: 5}]});
}

// Membership defaults and rival detection
{
  const a = hero('Ann', undefined, 1, 1);
  const b = hero('Ben', 'party-2', 2, 1);
  assert.equal(actorPartyId(a), 'party-1');
  assert.equal(sameParty(a, b), false);
  assert.equal(isAttackablePc(a, b), true);
  assert.equal(isCombatFoe(a, b), true);
}

// Two parties of four on one battle; createParty caps at two
{
  const battle = newBattle();
  ensureParties(battle);
  createParty(battle, 'Rivals');
  assert.equal(battle.parties.length, 2);
  assert.throws(() => createParty(battle), /two parties|party slots|already has/i);
  for (let i = 0; i < 4; i++) battle.actors.push(hero('A' + i, 'party-1', i, 1));
  for (let i = 0; i < 4; i++) battle.actors.push(hero('B' + i, 'party-2', i, 3));
  assert.equal(partyFull(battle, 'party-1'), true);
  assert.equal(partyFull(battle, 'party-2'), true);
  assert.equal(battle.actors.filter(a => a.side === 'party').length, 8);
}

// Shared turns stay within one party when rivals are interleaved
{
  const a1 = hero('A1', 'party-1', 1, 1, 30);
  const b1 = hero('B1', 'party-2', 2, 1, 25);
  const a2 = hero('A2', 'party-1', 3, 1, 20);
  const battle = {...newBattle(), actors: [a1, b1, a2]};
  startInitiative(battle, () => .5);
  assert.equal(currentActor(battle).id, a1.id);
  assert.deepEqual(sharedTurnGroup(battle).map(a => a.id), [a1.id]);
  assert.equal(canTakeTurn(battle, a2), false);
  assert.equal(canTakeTurn(battle, b1), false);
}

// Attacking a rival PC outside combat enters PvP initiative
{
  const a = hero('Ann', 'party-1', 2, 2);
  const b = hero('Ben', 'party-2', 3, 2);
  const battle = {...newBattle(), actors: [a, b]};
  const reason = engageEnemy(battle, map, a, b, false, () => .5);
  assert.match(reason, /attacked|Initiative/i);
  assert.equal(battle.round, 1);
  assert.equal(isPvpCombat(battle), true);
  assert.ok(battle.order.includes(a.id) && battle.order.includes(b.id));
  assert.equal(partyEscaped(battle), false, 'PvP does not auto-escape');
}

// Mutual leave / truce ends PvP; one vote is not enough
{
  const a = hero('Ann', 'party-1', 2, 2);
  const b = hero('Ben', 'party-2', 3, 2);
  const battle = {...newBattle(), actors: [a, b]};
  engageEnemy(battle, map, a, b, false, () => .5);
  assert.equal(requestTruce(battle, a), 'pending');
  assert.equal(battle.round, 1);
  assert.equal(requestTruce(battle, b), 'ended');
  assert.equal(battle.round, 0);
  assert.equal(battle.truceVotes, undefined);
}

// Monster fights still auto-clear; truce refused while hostiles remain
{
  const a = hero('Ann', 'party-1', 2, 2);
  const foe = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 4, y: 2, initiative: 0});
  const battle = {...newBattle(), actors: [a, foe]};
  engageEnemy(battle, map, a, foe, false, () => .5);
  assert.equal(isPvpCombat(battle), false);
  assert.throws(() => requestTruce(battle, a), /player vs player|truce/i);
  foe.hp = 0; foe.dead = true;
  endInitiative(battle);
  assert.equal(battle.round, 0);
}

// Two party members who never fought each other must leave combat when the last foe dies
{
  const a = hero('Ann', 'party-1', 2, 2);
  const b = hero('Ben', 'party-1', 3, 2);
  const foe = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 4, y: 2, initiative: 0});
  const battle = {...newBattle(), actors: [a, b, foe]};
  engageEnemy(battle, map, a, foe, false, () => .5);
  assert.equal(battle.combatKind, 'encounter');
  assert.equal(isPvpCombat(battle), false);
  foe.hp = 0; foe.dead = true;
  assert.equal(isPvpCombat(battle), false, 'cleared encounter is not PvP just because two PCs remain');
  // Mirror play.mjs advanceCombat auto-clear gate.
  if (battle.round && !battle.movement && !isPvpCombat(battle) &&
    !battle.actors.some((actor) => actor.side === 'hostile' && battle.order.includes(actor.id) && actor.hp > 0 && !actor.dead && actor.x != null)) {
    endInitiative(battle);
  }
  assert.equal(battle.round, 0);
}

// Defeat is scoped to one party
{
  const a = hero('Ann', 'party-1', 1, 1);
  const b = hero('Ben', 'party-2', 5, 5);
  a.hp = 0;
  const battle = {...newBattle(), actors: [a, b]};
  assert.equal(partyDefeated(battle, 'party-1'), true);
  assert.equal(partyDefeated(battle, 'party-2'), false);
  assert.equal(partyDefeated(battle), false);
}

// One party fleeing must not end combat for another still fighting the monster
{
  const a = hero('Ann', 'party-1', 1, 1);
  const b = hero('Ben', 'party-2', 2, 1);
  const foe = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 0, y: 1, initiative: 0});
  const battle = {...newBattle(), actors: [a, b, foe]};
  startInitiative(battle, () => .5, new Set([a.id, b.id, foe.id]));
  a.x = 19; // 19 squares × 5 ft = 95 ft from a Medium foe at x=0
  assert.equal(partyEscaped(battle), false, 'Rival party still next to the monster keeps combat going');
  b.x = 19;
  assert.equal(partyEscaped(battle), true, 'All living parties beyond 90 ft escape together');
}

console.log('Multi-party membership, shared turns, PvP engage, mutual truce, and party-scoped defeat verified.');
