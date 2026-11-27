import assert from 'node:assert/strict';
import {buildActionBar, entryReason} from '../dist/action-bar.mjs';
import {
  addCondition, advanceTime, applyDamage, castSpell, concentrationRemaining, endConcentration,
  makeActor, newBattle, startInitiative,
} from '../dist/combat.mjs';

const map = {key: 'conc-test', cols: 40, rows: 25, width: 800, height: 500, size: 20, offsetX: 0, offsetY: 0, regions: []};
const spell = (name, reference, level) => ({name, key: name.toLowerCase(), reference, edition: '2014', level});

function setup() {
  const battle = newBattle();
  const caster = makeActor({
    id: 'c', name: 'Caster', side: 'party', x: 2, y: 10, hp: 50, maxHp: 50, initiative: 20,
    spellDC: 15, spellAttack: 7, ability: {con: 0, int: 3}, saves: {con: 0},
    slots: {1: {current: 4, maximum: 4}, 2: {current: 3, maximum: 3}},
    spells: [
      spell('Flaming Sphere', 'phb|flaming sphere', 2),
      spell('Bless', 'phb|bless', 1),
      spell('Hold Person', 'phb|hold person', 2),
    ],
  });
  const ally = makeActor({id: 'a', name: 'Ally', side: 'party', x: 3, y: 10, hp: 40, maxHp: 40, initiative: 15});
  const foe = makeActor({id: 'f', name: 'Foe', x: 8, y: 10, hp: 200, maxHp: 200, ac: 12, initiative: 5});
  battle.actors = [caster, ally, foe];
  startInitiative(battle, () => .45);
  return {battle, caster, ally, foe};
}

function castSphere(battle, caster) {
  castSpell(battle, caster, null, spell('Flaming Sphere', 'phb|flaming sphere', 2), 2, {map, square: {x: 7, y: 10}}, () => .45);
}

// 1. Concentration starts and duration is 1 minute = 10 rounds = 60 seconds.
{
  const {battle, caster} = setup();
  castSphere(battle, caster);
  assert.equal(caster.concentration?.name, 'Flaming Sphere');
  assert.equal(battle.spellZones.length, 1);
  const left = concentrationRemaining(battle, caster);
  assert.equal(left.seconds, 60);
  assert.equal(left.rounds, 10);
  advanceTime(battle, 54);
  assert.equal(concentrationRemaining(battle, caster).rounds, 1);
  assert.equal(battle.spellZones.length, 1);
  advanceTime(battle, 6);
  assert.equal(caster.concentration, undefined);
  assert.equal(battle.spellZones.length, 0, 'Zone ends when duration expires');
}

// 2. Casting another concentration spell ends the previous one (and its zone / conditions).
{
  const {battle, caster, ally} = setup();
  castSpell(battle, caster, ally, spell('Bless', 'phb|bless', 1), 1, {map, targets: []}, () => .45);
  assert.ok(ally.conditions.some(entry => entry.name === 'Bless'));
  battle.action = null;
  castSphere(battle, caster);
  assert.equal(caster.concentration?.name, 'Flaming Sphere');
  assert.ok(!ally.conditions.some(entry => entry.name === 'Bless'), 'Prior Bless ends');
  assert.equal(battle.spellZones.length, 1);
  assert.equal(battle.spellZones[0].name, 'Flaming Sphere');
}

// 3. Damage CON save: DC = max(10, floor(damage/2)); fail ends spell + zone.
{
  const {battle, caster, foe} = setup();
  castSphere(battle, caster);
  applyDamage(battle, caster, 22, 'slashing', false, () => 0, foe);
  assert.equal(caster.concentration, undefined);
  assert.equal(battle.spellZones.length, 0);
  const cue = battle.actionEvents.find(event => event.action === 'Concentration');
  assert.ok(cue, 'Concentration save emits its own action event');
  assert.equal(cue.outcome, 'Broken');
  assert.equal(cue.dc, 11);
}
{
  const {battle, caster, foe} = setup();
  castSphere(battle, caster);
  applyDamage(battle, caster, 8, 'slashing', false, () => .99, foe);
  assert.equal(caster.concentration?.name, 'Flaming Sphere');
  assert.equal(battle.spellZones.length, 1);
  const cue = [...battle.actionEvents].reverse().find(event => event.action === 'Concentration');
  assert.equal(cue.outcome, 'Maintained');
  assert.equal(cue.dc, 10, 'Small hits still use DC 10');
}

// 4. Incapacitated / 0 HP ends concentration without a save.
{
  const {battle, caster} = setup();
  castSphere(battle, caster);
  addCondition(battle, caster, 'Stunned', 60);
  assert.equal(caster.concentration, undefined);
  assert.equal(battle.spellZones.length, 0);
}
{
  const {battle, caster, foe} = setup();
  castSphere(battle, caster);
  applyDamage(battle, caster, 100, 'slashing', false, () => .99, foe);
  assert.equal(caster.hp, 0);
  assert.equal(caster.concentration, undefined);
  assert.equal(battle.spellZones.length, 0);
}

// 5. UI: HUD helper + hotbar End Concentration (free, anytime).
{
  const {battle, caster} = setup();
  castSphere(battle, caster);
  const entries = buildActionBar(caster, battle, [], {canAct: true});
  const end = entries.find(entry => entry.actionId === 'end-concentration');
  assert.ok(end, 'Hotbar shows End Concentration while concentrating');
  assert.equal(end.timing, 'free');
  assert.ok(end.stats.includes('Flaming Sphere'));
  assert.ok(end.stats.some(stat => /10 rounds left/.test(stat)));
  assert.equal(entryReason(caster, battle, end), '');
  battle.action = 'attack';
  battle.turn = battle.order.indexOf('f');
  assert.equal(entryReason(caster, battle, end), '', 'May end concentration off-turn');
  endConcentration(battle, caster);
  assert.equal(caster.concentration, undefined);
  assert.equal(battle.spellZones.length, 0);
}

// 6. Non-zone concentration (Hold Person) also cleans up conditions on break.
{
  const {battle, caster, foe} = setup();
  castSpell(battle, caster, foe, spell('Hold Person', 'phb|hold person', 2), 2, {map}, () => .45);
  assert.ok(foe.conditions.some(entry => entry.name === 'Paralyzed'));
  assert.ok(caster.concentration);
  applyDamage(battle, caster, 40, 'force', false, () => 0, foe);
  assert.equal(caster.concentration, undefined);
  assert.ok(!foe.conditions.some(entry => entry.name === 'Paralyzed'));
}

console.log('Concentration duration, replacement, CON saves, incapacitation, hotbar end-control, and condition cleanup verified.');
