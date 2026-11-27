import assert from 'node:assert/strict';
import {canOfferManualReaction, eventReactionTriggers, manualReactionOptions, resolveManualReaction} from '../dist/reactions.mjs';
import {setup, passUntil, spellObject} from './spell-test-kit.mjs';
import {builtinRule} from '../dist/spell-library/index.mjs';

console.log('Testing manual reaction pause helpers...');

assert.deepEqual(eventReactionTriggers({kind: 'spell', action: 'Fireball'}).sort(), ['spellCast']);
assert.ok(eventReactionTriggers({kind: 'attack', outcome: 'Hit'}).includes('hit'));
assert.ok(eventReactionTriggers({kind: 'attack', outcome: 'Hit'}).includes('damaged'));
assert.ok(eventReactionTriggers({kind: 'attack', outcome: 'Miss'}).includes('hit'));
assert.ok(!eventReactionTriggers({kind: 'attack', outcome: 'Miss'}).includes('damaged'));

const shieldRule = builtinRule('phb|shield');
const counterRule = builtinRule('phb|counterspell');
assert.ok(shieldRule && counterRule);

const s = setup('phb|fire bolt', {
  caster: {
    ac: 12,
    spells: [spellObject(shieldRule), spellObject(counterRule)],
    slots: Object.fromEntries(Array.from({length: 9}, (_, i) => [i + 1, {current: 4, maximum: 4}])),
  },
  targets: [{x: 5, y: 10}],
});
passUntil(s, 'target');

const foe = s.targets[0];
const attackEvent = {
  kind: 'attack',
  actor: foe.id,
  name: foe.name,
  action: 'Scimitar',
  outcome: 'Hit',
  total: 14, // AC 12 + Shield 5 = 17 would miss
  targetActor: s.caster.id,
  type: 'slashing',
  healthChanges: [{
    actor: s.caster.id,
    before: {hp: s.caster.hp, tempHp: 0, dead: false, prone: false, stable: false, successes: 0, failures: 0},
    after: {hp: s.caster.hp - 4, tempHp: 0, dead: false, prone: false, stable: false, successes: 0, failures: 0},
  }],
};
s.caster.hp -= 4;

const canControl = actor => actor.id === s.caster.id;
const shieldOptions = manualReactionOptions(s.battle, attackEvent, {canControl, map: s.map});
assert.ok(shieldOptions.some(option => option.reference === 'phb|shield'), 'Shield offered when hit can still be stopped');
assert.ok(canOfferManualReaction(s.battle, attackEvent, {canControl, map: s.map}));

const shieldChoice = shieldOptions.find(option => option.reference === 'phb|shield');
const hpBeforeShield = s.caster.hp;
const shieldResult = resolveManualReaction(s.battle, shieldChoice, attackEvent, {map: s.map, random: () => 0.99});
assert.equal(shieldResult.ok, true);
assert.ok(s.caster.reactionUsed, 'Shield spends the reaction');
assert.equal(shieldResult.cancelled, true);
assert.equal(s.caster.hp, hpBeforeShield + 4, 'Late Shield restores the hit damage when AC would miss');

// Drop to 0 HP must still offer Shield against the pre-hit vitality.
s.caster.reactionUsed = false;
s.caster.hp = 0;
s.caster.prone = true;
const lethalEvent = {
  ...attackEvent,
  healthChanges: [{
    actor: s.caster.id,
    before: {hp: 4, tempHp: 0, dead: false, prone: false, stable: false, successes: 0, failures: 0},
    after: {hp: 0, tempHp: 0, dead: false, prone: true, stable: false, successes: 0, failures: 0},
  }],
};
const lethalOptions = manualReactionOptions(s.battle, lethalEvent, {canControl, map: s.map});
assert.ok(lethalOptions.some(option => option.reference === 'phb|shield'), 'Shield offered after a drop to 0 HP');
const lethalChoice = lethalOptions.find(option => option.reference === 'phb|shield');
const lethalResult = resolveManualReaction(s.battle, lethalChoice, lethalEvent, {map: s.map, random: () => 0.99});
assert.equal(lethalResult.cancelled, true);
assert.equal(s.caster.hp, 4, 'Shield prevents the drop to 0 HP');

s.caster.reactionUsed = false;
s.caster.prone = false;
const castEvent = {
  kind: 'spell',
  actor: foe.id,
  name: foe.name,
  action: 'Fireball',
  spellLevel: 3,
  spellReference: 'phb|fireball',
  healthChanges: [],
};
const counterOptions = manualReactionOptions(s.battle, castEvent, {canControl, map: s.map});
assert.ok(counterOptions.some(option => option.reference === 'phb|counterspell'), 'Counterspell offered on enemy cast');
const counterChoice = counterOptions.find(option => option.reference === 'phb|counterspell');
const counterResult = resolveManualReaction(s.battle, counterChoice, castEvent, {map: s.map, random: () => 0.99});
assert.equal(counterResult.ok, true);
assert.equal(counterResult.cancelled, true, '3rd-level Counterspell cancels a 3rd-level Fireball');

// Counterspell must dismiss non-concentration summons such as Spiritual Weapon.
{
  const enemy = s.targets[0];
  s.caster.reactionUsed = false;
  // Ensure the reactor is off-turn so the manual reaction window is available.
  s.battle.turn = s.battle.order.indexOf(enemy.id);
  const summoned = {
    id: 'spiritual-weapon',
    name: 'Spiritual Weapon',
    side: enemy.side,
    hp: 1000,
    maxHp: 1000,
    x: 6,
    y: 10,
    summoner: enemy.id,
    summonSpell: 'phb|spiritual weapon',
    summonConcentration: false,
  };
  s.battle.actors.push(summoned);
  const swEvent = {
    kind: 'spell',
    actor: enemy.id,
    name: enemy.name,
    action: 'Spiritual Weapon',
    spellLevel: 2,
    spellReference: 'phb|spiritual weapon',
    healthChanges: [],
  };
  const swOptions = manualReactionOptions(s.battle, swEvent, {canControl, map: s.map});
  const swChoice = swOptions.find(option => option.reference === 'phb|counterspell');
  assert.ok(swChoice, 'Counterspell offered against Spiritual Weapon');
  const swResult = resolveManualReaction(s.battle, swChoice, swEvent, {map: s.map, random: () => 0.99});
  assert.equal(swResult.cancelled, true);
  assert.ok(summoned.dismissed || summoned.dead || summoned.x == null, 'Countered Spiritual Weapon leaves the board');
}

// On your own turn, the Reaction button withholds options for that character.
const own = setup('phb|fire bolt', {
  caster: {
    spells: [spellObject(counterRule)],
    slots: Object.fromEntries(Array.from({length: 9}, (_, i) => [i + 1, {current: 4, maximum: 4}])),
  },
});
const ownEvent = {kind: 'spell', actor: own.targets[0].id, name: 'Goblin', action: 'Fire Bolt', spellLevel: 0};
assert.equal(
  manualReactionOptions(own.battle, ownEvent, {canControl: actor => actor.id === own.caster.id, map: own.map}).length,
  0,
  'No manual reaction while it is the reactor’s turn'
);

console.log('Manual reaction helpers passed.');
