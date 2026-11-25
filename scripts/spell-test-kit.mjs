// Test helpers for spell rules.  Usage (see scripts/test-spell-engine.mjs for many examples):
//
//   import {setup, natural, fixed, sequence, nextRound} from './spell-test-kit.mjs';
//   const s = setup('phb|bless', {allies: [{id: 'ally', x: 4, y: 10}]});
//   s.cast(s.byId.ally, {targets: []});               // cast at the ally with the default slot (the spell's level)
//   assert(s.byId.ally.conditions[0].name === 'Bless');
//
// A headless battle: no DOM, no network, deterministic dice.  Pass `rule` to test a rule that is not in the built-in library.
import {builtinRule} from '../dist/spell-library/index.mjs';
import {customSpellRule} from '../dist/spell-rule-store.mjs';
import {ruleKey, ruleProblems, migrateRule} from '../dist/spell-rule-schema.mjs';
import {makeActor, newBattle, startInitiative, castSpell, endTurn, turnView} from '../dist/combat.mjs';

export const map = {key: 'spell-kit', cols: 40, rows: 25, width: 800, height: 500, size: 20, offsetX: 0, offsetY: 0, regions: []};

// ── random sources ──
// A d20 shows `n` when the generator returns natural(n); a dN shows k when it returns face(k, N).
export const natural = n => (n - 1) / 20 + .001;
export const face = (k, sides) => (k - 1) / sides + .001;
export const fixed = value => () => value;
// Returns the values in order, then `rest` forever:  sequence([natural(20), natural(1)], .45)
export const sequence = (values, rest = .45) => { const queue = [...values]; return () => queue.length ? queue.shift() : rest; };

export const spellObject = rule => ({name: rule.name, key: ruleKey(rule.name), reference: rule.reference, edition: rule.edition, level: rule.level, source: rule.source});

// setup(reference, options) → {battle, caster, rule, spell, byId, targets, allies, map, random, cast(target, options?, slot?), actor(id)}
// options: rule, caster:{…actor fields}, targets:[{…}] (hostile; default one at 8,10), allies:[{…}] (party), combat (default true),
//          random (default ()=>.45), slots (default 4 of each level 1-9)
export function setup(reference, options = {}) {
  const found = options.rule ?? customSpellRule(reference, {}) ?? builtinRule(reference);
  if (!found) throw Error('No built-in spell ' + reference + '.');
  const rule = migrateRule(found), problems = ruleProblems(rule);
  if (problems.length) throw Error(rule.name + ' is not a valid rule: ' + problems.join(' '));
  const slots = options.slots ?? Object.fromEntries(Array.from({length: 9}, (_, index) => [index + 1, {current: 4, maximum: 4}]));
  const battle = newBattle();
  const caster = makeActor({id: 'caster', name: 'Caster', side: 'party', x: 2, y: 10, hp: 100, maxHp: 100, ac: 12, level: 5, initiative: 100, spellDC: 15, spellAttack: 7, spellAbility: 3, saves: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}, slots, ...options.caster});
  const targets = (options.targets ?? [{}]).map((record, index) => makeActor({id: index ? 'target' + (index + 1) : 'target', name: index ? 'Target ' + (index + 1) : 'Target', side: 'hostile', x: 8 + index, y: 10, hp: 200, maxHp: 200, ac: 12, initiative: 10 - index, saves: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}, ...record}));
  const allies = (options.allies ?? []).map((record, index) => makeActor({id: 'ally' + (index ? index + 1 : ''), name: 'Ally' + (index ? ' ' + (index + 1) : ''), side: 'party', x: 4, y: 12 + index, hp: 100, maxHp: 100, ac: 14, initiative: 50 - index, saves: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}, ...record}));
  battle.actors = [caster, ...allies, ...targets];
  if (!rule.nativeKey && !builtinRule(rule.reference)) battle.spellRules = {[rule.reference]: found};
  const kit = {battle, caster, rule, spell: spellObject(rule), targets, allies, map, random: options.random ?? (() => .45),
    byId: Object.fromEntries(battle.actors.map(actor => [actor.id, actor])), actor: id => battle.actors.find(actor => actor.id === id)};
  if (options.combat !== false) startInitiative(battle, () => .45);
  // Give an actor a fresh action / bonus action / reaction (casts below do this unless {keepTurn: true} is passed).
  kit.fresh = (actor = caster) => {
    if (!battle.round) return;
    Object.assign(turnView(battle, actor), {action: null, bonusUsed: false, cast: null, attacksMade: 0});
    actor.reactionUsed = false;
  };
  const run = (actor, target, {keepTurn, ...castOptions}, slot) => { if (!keepTurn) kit.fresh(actor); return castSpell(battle, actor, target, kit.spell, slot, {map, ...castOptions}, kit.random); };
  kit.cast = (target, castOptions = {}, slot = rule.level) => run(caster, target, castOptions, slot);
  // Cast as another actor (for reactions and monster-style casters).
  kit.castAs = (actor, target, castOptions = {}, slot = rule.level) => run(actor, target, castOptions, slot);
  return kit;
}

// Add another spell's rule to the same battle (for tests that combine spells, e.g. Hex then Eldritch Blast).
export function addRule(kit, reference) {
  const rule = builtinRule(reference);
  return {rule, spell: spellObject(rule), cast: (target, {keepTurn, ...options} = {}, slot = rule.level, caster = kit.caster) => {
    if (!keepTurn) kit.fresh(caster);
    return castSpell(kit.battle, caster, target, spellObject(rule), slot, {map, ...options}, kit.random);
  }};
}

// End turns until a new round begins (zones, durations and repeat saves run on the way).
export function nextRound(kit, random = kit.random) {
  const round = kit.battle.round;
  for (let guard = 0; guard < 40 && kit.battle.round === round; guard++) endTurn(kit.battle, random);
}
// End turns until it is `actorId`'s turn.
export function passUntil(kit, actorId, random = kit.random) {
  for (let guard = 0; guard < 40 && kit.battle.order[kit.battle.turn] !== actorId; guard++) endTurn(kit.battle, random);
}
export const hasStatus = (actor, name) => (actor.conditions ?? []).some(entry => entry.name === name);
export const place = (actor, x, y) => { actor.x = x; actor.y = y; return actor; };
