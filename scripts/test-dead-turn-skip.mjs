import assert from 'node:assert/strict';
import {makeActor, newBattle, startInitiative, currentActor, endTurn, canTakeTurn, deathSave} from '../dist/combat.mjs';
import {enemyTurnPending, runEnemyTurns} from '../dist/enemy-turn.mjs';

const map = {cols: 40, rows: 20, width: 2800, height: 1400, size: 70, offsetX: 0, offsetY: 0, regions: []};

function fixture() {
  const hero = makeActor({
    name: 'Dying', side: 'party', partyId: 'party-1', resolveDeath: true,
    hp: 0, maxHp: 20, x: 2, y: 2, initiative: 20, dex: 14,
  });
  const ally = makeActor({
    name: 'Far Ally', side: 'party', partyId: 'party-1', resolveDeath: true,
    hp: 20, maxHp: 20, x: 30, y: 2, initiative: 15, dex: 12,
  });
  const foe = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 3, y: 2, initiative: 5});
  const battle = {...newBattle(), actors: [hero, ally, foe]};
  startInitiative(battle, () => .5);
  return {battle, hero, ally, foe};
}

// Final death save used to leave a dead PC on the cursor with no way to End turn.
{
  const {battle, hero, ally} = fixture();
  assert.equal(currentActor(battle), hero);
  // Force a killing death save (natural 1 → two failures; start near the limit).
  hero.failures = 2;
  deathSave(battle, hero, () => 0.01); // kept 1
  assert.equal(hero.dead, true, 'failed death save marks the character dead');
  assert.equal(canTakeTurn(battle, hero), false, 'dead characters leave the shared turn group');
  assert.equal(enemyTurnPending(battle), true, 'dead cursor is treated as an auto-advance turn');
  // endTurn must be allowed so the cursor can move on.
  endTurn(battle, () => .5, hero);
  assert.equal(currentActor(battle), ally, 'initiative advances to the living ally');
  assert.equal(canTakeTurn(battle, ally), true);
}

// Reload-style stale state: dead lead already on the cursor, living ally far away.
{
  const {battle, hero, ally, foe} = fixture();
  hero.dead = true;
  hero.hp = 0;
  assert.equal(currentActor(battle), hero);
  assert.equal(enemyTurnPending(battle), true);
  const message = runEnemyTurns(battle, map, () => .5);
  assert.notEqual(currentActor(battle), hero, 'runEnemyTurns skips the dead cursor');
  assert.ok(
    currentActor(battle) === ally || currentActor(battle) === foe || !battle.round,
    'combat reaches the living ally, an enemy, or ends'
  );
  assert.ok(message === '' || typeof message === 'string');
}

// Dead initiative lead with a living shared-turn ally still pending.
{
  const {battle, hero, ally, foe} = fixture();
  hero.dead = true;
  hero.hp = 0;
  assert.equal(canTakeTurn(battle, ally), true, 'living ally can still act while lead is dead');
  endTurn(battle, () => .5, ally);
  assert.equal(currentActor(battle), foe, 'finishing the living ally advances past the dead lead');
}

console.log('Dead initiative cursor skip and shared-turn advance verified.');
