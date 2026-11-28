import assert from 'node:assert/strict';
import {
  approachForStrike, distanceFt, makeActor, moveLeft, newBattle, resolveOpportunity, rollStrike, startInitiative,
} from '../dist/combat.mjs';

const map = {cols: 20, rows: 12, width: 1400, height: 840, size: 70, offsetX: 0, offsetY: 0, regions: []};

function battleWith(hero, foe, extras = []) {
  const battle = {...newBattle(), actors: [hero, foe, ...extras]};
  startInitiative(battle, () => 0.5);
  return battle;
}

{
  const hero = makeActor({
    name: 'Hero', side: 'party', initiative: 20, hp: 40, x: 2, y: 3,
    attacks: [{name: 'Longsword', damage: '1d8+3', bonus: 5, reach: 5}],
  });
  const foe = makeActor({
    name: 'Goblin', initiative: 10, hp: 7, maxHp: 7, x: 5, y: 3, ac: 10, attacks: [],
  });
  const battle = battleWith(hero, foe);
  assert.equal(approachForStrike(battle, hero, foe, hero.attacks[0], map), true);
  assert.equal(battle.movement, null);
  assert.ok(distanceFt(hero, foe) <= 5);
  assert.ok(moveLeft(battle, hero) < 30);
  rollStrike(battle, hero, foe, hero.attacks[0], {map}, () => 0.5);
  assert.equal(battle.action, 'attack');
  assert.equal(battle.attacksMade, 1);
}

{
  const hero = makeActor({
    name: 'Archer', side: 'party', initiative: 20, hp: 30, x: 1, y: 1,
    attacks: [{name: 'Shortbow', damage: '1d6+3', bonus: 5, normalRange: 80, longRange: 320, rangedWeapon: true}],
  });
  const foe = makeActor({
    name: 'Bandit', initiative: 5, hp: 20, maxHp: 20, x: 3, y: 1, ac: 10, attacks: [],
  });
  const battle = battleWith(hero, foe);
  assert.equal(approachForStrike(battle, hero, foe, hero.attacks[0], map), false);
  assert.equal(hero.x, 1);
  rollStrike(battle, hero, foe, hero.attacks[0], {map}, () => 0.5);
  assert.equal(battle.attacksMade, 1);
}

{
  const hero = makeActor({
    name: 'Hero', side: 'party', initiative: 20, hp: 40, x: 2, y: 3,
    attacks: [{name: 'Longsword', damage: '1d8+3', bonus: 5, reach: 5}],
  });
  const sentry = makeActor({
    name: 'Sentry', initiative: 15, hp: 20, maxHp: 20, x: 3, y: 3, ac: 10,
    attacks: [{name: 'Scimitar', damage: '1d6+2', bonus: 4, reach: 5}],
  });
  const foe = makeActor({
    name: 'Target', initiative: 5, hp: 20, maxHp: 20, x: 6, y: 3, ac: 10, attacks: [],
  });
  const battle = battleWith(hero, foe, [sentry]);
  assert.equal(approachForStrike(battle, hero, foe, hero.attacks[0], map), true);
  assert.ok(battle.movement?.foe, 'leaving the sentry’s reach should pause for an opportunity attack');
  assert.equal(battle.movement.foe, sentry.id);
  resolveOpportunity(battle, null, undefined, map);
  assert.equal(battle.movement, null);
  assert.ok(distanceFt(hero, foe) <= 5);
  rollStrike(battle, hero, foe, hero.attacks[0], {map}, () => 0.5);
  assert.equal(battle.attacksMade, 1);
}

{
  const hero = makeActor({
    name: 'Hero', side: 'party', initiative: 20, hp: 40, x: 1, y: 1,
    attacks: [{name: 'Longsword', damage: '1d8+3', bonus: 5, reach: 5}],
  });
  const foe = makeActor({
    name: 'Far', initiative: 5, hp: 20, maxHp: 20, x: 12, y: 1, ac: 10, attacks: [],
  });
  const battle = battleWith(hero, foe);
  assert.throws(() => approachForStrike(battle, hero, foe, hero.attacks[0], map), /movement|path|range/i);
}

console.log('approachForStrike: in-range move, already-in-range no-op, OA interrupt resume, and unreachable target verified.');
