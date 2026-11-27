import assert from 'node:assert/strict';
import {makeActor, newBattle, startInitiative, currentActor, canTakeTurn} from '../dist/combat.mjs';
import {enemyTurnPending, runEnemyTurns} from '../dist/enemy-turn.mjs';

const map = {cols: 40, rows: 20, width: 2800, height: 1400, size: 70, offsetX: 0, offsetY: 0, regions: []};

function fixture() {
  const hero = makeActor({
    name: 'Unclaimed', side: 'party', partyId: 'party-1',
    hp: 20, maxHp: 20, x: 2, y: 2, initiative: 20, dex: 14,
  });
  const ally = makeActor({
    name: 'Claimed Ally', side: 'party', partyId: 'party-1',
    hp: 20, maxHp: 20, x: 4, y: 2, initiative: 15, dex: 12,
  });
  const foe = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 6, y: 2, initiative: 5});
  const battle = {
    ...newBattle(),
    actors: [hero, ally, foe],
    controllers: {[ally.id]: 'player-online'},
  };
  startInitiative(battle, () => .5);
  return {battle, hero, ally, foe};
}

{
  const {battle, hero, ally} = fixture();
  assert.equal(currentActor(battle), hero);
  assert.equal(Boolean(battle.controllers[hero.id]), false);
  assert.equal(enemyTurnPending(battle), true, 'unclaimed PC turn is auto-pending');
  runEnemyTurns(battle, map, () => .5);
  assert.notEqual(currentActor(battle), hero, 'unclaimed lead is skipped');
  assert.ok(
    currentActor(battle) === ally || canTakeTurn(battle, ally),
    'claimed ally can act after the unclaimed skip'
  );
}

{
  // Solo / no controllers map must not auto-skip party turns.
  const hero = makeActor({name: 'Solo', side: 'party', hp: 20, maxHp: 20, x: 2, y: 2, initiative: 20});
  const foe = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 4, y: 2, initiative: 5});
  const battle = {...newBattle(), actors: [hero, foe]};
  startInitiative(battle, () => .5);
  assert.equal(enemyTurnPending(battle), false, 'solo play without controllers does not skip PCs');
}

{
  // Death save pending on an unclaimed character still waits for a claim.
  const hero = makeActor({
    name: 'Dying', side: 'party', resolveDeath: true,
    hp: 0, maxHp: 20, x: 2, y: 2, initiative: 20,
  });
  const foe = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 4, y: 2, initiative: 5});
  const battle = {...newBattle(), actors: [hero, foe], controllers: {}};
  startInitiative(battle, () => .5);
  assert.equal(enemyTurnPending(battle), false, 'unclaimed death saves are not auto-skipped');
}

console.log('Unclaimed party turn skip verified.');
