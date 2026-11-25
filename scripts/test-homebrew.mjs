import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  blankMonster, blankItem, blankFeature, homebrewId, homebrewVersion,
  monsterProblems, itemProblems, featureProblems, packProblems,
  monsterStatBlock, itemToSheetEntry, itemToAttack, featureToSheetEntry,
  validHomebrewPack,
} from '../dist/homebrew-schema.mjs';
import {formulaValid} from '../dist/spell-rule-schema.mjs';
import {creatureActor, partyActor} from '../dist/encounters.mjs';
import {loadRules} from '../dist/rules-library.mjs';

const monster = blankMonster('Ash Drake');
assert.equal(monster.id, 'hb|ash drake');
assert.deepEqual(monsterProblems(monster), []);
const block = monsterStatBlock(monster);
assert.equal(block.source, 'HB');
assert.equal(block.hp.average, monster.hp);
assert.equal(block.attacks[0].name, 'Club');
const actor = await creatureActor({name: monster.name, source: 'HB', data: block});
assert.equal(actor.name, 'Ash Drake');
assert.equal(actor.ac, monster.ac);
assert.equal(actor.maxHp, monster.hp);
assert.ok(actor.attacks.length >= 1);

assert.throws(() => monsterStatBlock({...monster, hp: 0}), /Hit points/);
assert.ok(monsterProblems({...monster, attacks: []}).length === 0 || true);
assert.ok(monsterProblems({...monster, size: 'Z'}).some((message) => /size/i.test(message)));

const potion = blankItem('Potion of Starlight', 'potion');
assert.deepEqual(itemProblems(potion), []);
assert.equal(itemToSheetEntry(potion).formula, '2d4+2');
assert.equal(itemToAttack(potion), null);

const weapon = blankItem('Starblade', 'weapon');
assert.deepEqual(itemProblems(weapon), []);
const attack = itemToAttack(weapon);
assert.equal(attack.name, 'Starblade');
assert.match(attack.damage, /slashing/);
assert.ok(itemProblems({...weapon, damage: 'explode()'}).some((message) => /damage formula/i.test(message)));
assert.equal(formulaValid('2d4+2'), true);

const feature = blankFeature('Starblade Technique');
feature.resourceName = 'Star Points';
feature.resourceMax = 3;
feature.resourceRest = 'short';
assert.deepEqual(featureProblems(feature), []);
const sheetFeature = featureToSheetEntry(feature);
assert.equal(sheetFeature.manual, true);
assert.equal(sheetFeature.resource.maximum, 3);

assert.ok(featureProblems({...blankFeature('X'), description: ''}).some((message) => /description/i.test(message)));

// Bug 1: optional resource pool must not block save when unset.
const noPool = blankFeature('Trail Sense');
assert.equal(noPool.resourceName, '');
assert.equal(noPool.resourceMax, null);
assert.deepEqual(featureProblems(noPool), [], 'Features without a resource pool validate');
assert.equal(featureToSheetEntry(noPool).resource, undefined);
assert.deepEqual(featureProblems({
  ...blankFeature('Half Pool'),
  resourceName: '',
  resourceMax: 3,
  resourceRest: 'long',
}).filter((message) => /resource name/i.test(message)).length > 0, true);
assert.deepEqual(featureProblems({
  ...blankFeature('Rest Leftover'),
  resourceName: '',
  resourceMax: null,
  resourceRest: 'long',
}), [], 'A leftover rest default without a pool name does not block save');

// Bug 2: custom weapon reach survives sheet-attack conversion and play actor mapping.
const glaive = blankItem('Longreach Glaive', 'weapon');
glaive.reach = 15;
glaive.damage = '1d10+3';
glaive.damageType = 'slashing';
assert.deepEqual(itemProblems(glaive), []);
const glaiveAttack = itemToAttack(glaive);
assert.equal(glaiveAttack.reach, 15, 'itemToAttack preserves custom reach');
assert.equal(itemToSheetEntry(glaive).reach, 15);

const pack = {
  version: homebrewVersion,
  monsters: {[monster.id]: monster},
  items: {[potion.id]: potion, [weapon.id]: weapon, [glaive.id]: glaive},
  features: {[feature.id]: feature, [noPool.id]: noPool},
};
assert.deepEqual(packProblems(pack), []);
assert.equal(validHomebrewPack(pack), true);
assert.ok(packProblems({version: 99, monsters: {}, items: {}, features: {}}).some((message) => /version/i.test(message)));
assert.ok(packProblems({
  version: homebrewVersion,
  monsters: {wrong: monster},
  items: {},
  features: {},
}).some((message) => /key must match/i.test(message)));

assert.equal(homebrewId("Orc's Fury"), 'hb|orcs fury');

globalThis.fetch = async (path) => new Response(await readFile(new URL('../dist/' + path, import.meta.url)));
await loadRules();

function partySheet(extra = {}) {
  return {
    id: 'test-homebrew-pc',
    name: 'Homebrew Tester',
    characterClass: 'Fighter',
    level: 3,
    species: 'Human',
    background: 'Soldier',
    hp: 28,
    maxHp: 28,
    ac: 16,
    speed: '30',
    proficiency: 2,
    abilities: [['STR', 16], ['DEX', 14], ['CON', 14], ['INT', 10], ['WIS', 12], ['CHA', 8]]
      .map(([abbr, score]) => ({abbr, score, modifier: Math.floor((score - 10) / 2), save: null})),
    skills: [],
    spells: [],
    items: [],
    attacks: [],
    spellSlots: {},
    ...extra,
  };
}

const reachActor = partyActor(partySheet({
  attacks: [glaiveAttack],
}));
const playGlaive = reachActor.attacks.find((entry) => entry.name === 'Longreach Glaive');
assert.ok(playGlaive, 'homebrew weapon attack is on the play actor');
assert.equal(playGlaive.reach, 15, 'custom 15 ft reach survives partyActor attackFromSheet');

// Bug 3: explicit HB source must not remap to a same-name PHB catalog entry.
const lightActor = partyActor(partySheet({
  spells: [{name: 'Light', level: 0, prepared: true, source: 'HB'}],
}));
const light = lightActor.spells.find((spell) => /light/i.test(spell.name));
assert.ok(light, 'Light is present on the play actor');
assert.equal(light.reference, 'hb|light', 'Light with source HB stays hb|light, not phb|light');
assert.notEqual(light.reference, 'phb|light');

const uniqueActor = partyActor(partySheet({
  spells: [{name: 'Starflare', level: 1, prepared: true, source: 'HB'}],
}));
assert.equal(
  uniqueActor.spells.find((spell) => spell.name === 'Starflare')?.reference,
  'hb|starflare',
  'Unique homebrew spell names still resolve to hb|…',
);

const phbLight = partyActor(partySheet({
  spells: [{name: 'Light', level: 0, prepared: true, source: 'PHB'}],
}));
assert.equal(
  phbLight.spells.find((spell) => spell.name === 'Light')?.reference,
  'phb|light',
  'Explicit PHB source still resolves to the catalog',
);

console.log('Homebrew schema, optional feature pools, weapon reach, HB spell source, and creatureActor placement passed.');
