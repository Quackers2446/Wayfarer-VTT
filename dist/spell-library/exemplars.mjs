// Exemplar built-in spells: each one demonstrates a schema primitive (see the primitive → example table in SPELL_ENGINE.md).
// Phase 2 batches should copy the closest exemplar instead of starting from a blank rule.
import {spell, dmg, damage, healing, condition, status, pushAway, summon, dispel, onTriggers, zoneTriggers} from './builders.mjs';

export const exemplars = [
  // ── buffs / debuffs on several targets, scaled per slot ──
  spell('Bless', 1, {range: 30, sight: true, concentration: true, duration: 60, targets: {base: 3, perSlot: 1, side: 'ally'},
    effects: [status({name: 'Bless', rollModifiers: {attack: '1d4', save: '1d4'}})]}),
  spell('Bane', 1, {range: 30, sight: true, concentration: true, duration: 60, targets: {base: 3, perSlot: 1, side: 'enemy'},
    effects: [status({name: 'Bane', rollModifiers: {attack: '-1d4', save: '-1d4'}}, {save: 'cha'})]}),
  spell('Shield of Faith', 1, {timing: 'bonus', range: 60, sight: true, concentration: true, duration: 600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Shield of Faith', acBonus: 2})]}),
  spell('Mage Armor', 1, {range: 5, duration: 28800, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Mage Armor', acBase: {base: 13, dex: true}})]}),
  spell('Haste', 3, {range: 30, sight: true, concentration: true, duration: 60, targets: {base: 1, side: 'ally'}, effects: [condition('Hasted')]}),
  spell('Slow', 3, {range: 120, sight: true, concentration: true, duration: 60, targets: {base: 6, side: 'enemy'},
    effects: [condition('Slowed', {save: 'wis', repeatSave: 'end'})]}),

  // ── reactions ──
  // 2014: reaction when hit by an attack or targeted by Magic Missile; +5 AC and immunity to Magic Missile until your next turn.
  spell('Shield', 1, {timing: 'reaction', reactionTrigger: ['hit', 'magicMissile'], range: 0, shape: 'self', duration: 6,
    effects: [status({name: 'Shield', acBonus: 5, blockMagicMissile: true, until: 'casterStart'})]}),
  spell('Absorb Elements', 1, {source: 'XGE', timing: 'reaction', reactionTrigger: 'damage', reactionDamageTypes: ['acid', 'cold', 'fire', 'lightning', 'thunder'], range: 0, shape: 'self', duration: 6,
    effects: [status({name: 'Absorb Elements', resist: ['triggering'], until: 'casterEnd',
      riders: [{formula: '1d6', type: 'triggering', upcast: '1d6', when: 'melee', consume: true}]})]}),
  spell('Hellish Rebuke', 1, {timing: 'reaction', reactionTrigger: 'damaged', range: 60, sight: true,
    effects: [damage(dmg('2d10', 'fire', {upcast: '1d10'}), {save: 'dex', onSave: 'half'})]}),

  // ── area shapes ──
  spell('Thunderwave', 1, {range: 0, shape: 'cube', side: 15, origin: 'caster',
    effects: [damage(dmg('2d8', 'thunder', {upcast: '1d8'}), {save: 'con', onSave: 'half', push: pushAway(10)})]}),
  spell('Lightning Bolt', 3, {range: 0, shape: 'line', length: 100, width: 5,
    effects: [damage(dmg('8d6', 'lightning', {upcast: '1d6'}), {save: 'dex', onSave: 'half'})]}),
  spell('Faerie Fire', 1, {range: 60, sight: true, shape: 'cube', side: 20, concentration: true, duration: 60,
    effects: [status({name: 'Faerie Fire', attackedBy: 'adv'}, {save: 'dex'})]}),

  // ── spell attacks ──
  spell('Scorching Ray', 2, {range: 120, attack: 'ranged', targets: {base: 3, perSlot: 1, repeat: true}, effects: [damage(dmg('2d6', 'fire'))]}),
  spell('Guiding Bolt', 1, {range: 120, attack: 'ranged', duration: 6, effects: [
    damage(dmg('4d6', 'radiant', {upcast: '1d6'})),
    status({name: 'Guiding Bolt', attackedBy: 'adv', until: 'casterEnd', ends: {onAttacked: true}}),
  ]}),

  // ── marks: a rider on every hit that the caster lands on one creature; recasting moves it after the target drops ──
  spell('Hex', 1, {timing: 'bonus', range: 90, sight: true, concentration: true, duration: 3600, transfer: true, effects: [
    status({name: 'Hex', markRiders: [
      {formula: '1d6', type: 'necrotic', when: 'weapon'},
      {formula: '1d6', type: 'necrotic', when: 'spell'},
    ]}),
  ]}),
  spell("Hunter's Mark", 1, {timing: 'bonus', range: 90, sight: true, concentration: true, duration: 3600, transfer: true, effects: [
    status({name: "Hunter's Mark", markRiders: [{formula: '1d6', type: 'weapon', when: 'weapon'}]}),
  ]}),

  // ── summons ──
  spell('Spiritual Weapon', 2, {timing: 'bonus', range: 60, shape: 'point', duration: 60, effects: [
    summon({name: 'Spiritual Weapon', hp: 1000, ac: 40, speed: 20, size: 'M', creatureType: 'construct',
      attacks: [{name: 'Spectral Weapon', bonus: 'spell', damage: '1d8', type: 'force', addAbility: true, upcast: '1d8', upcastStep: 2, reach: 5}]}),
  ]}),

  // ── zones ──
  spell('Spike Growth', 2, {range: 150, shape: 'circle', radius: 20, persistent: true, difficult: true, concentration: true, duration: 600, effects: [
    damage(dmg('2d4', 'piercing'), {trigger: 'step'}),
  ]}),
  spell('Moonbeam', 2, {range: 120, shape: 'circle', radius: 5, persistent: true, concentration: true, duration: 60,
    effects: onTriggers(damage(dmg('2d10', 'radiant', {upcast: '1d10'}), {save: 'con', onSave: 'half'}), zoneTriggers.entering)}),
  spell('Spirit Guardians', 3, {range: 0, shape: 'aura', radius: 15, persistent: true, difficult: true, concentration: true, duration: 600,
    effects: onTriggers(damage(dmg('3d8', 'radiant', {upcast: '1d8'}), {save: 'wis', onSave: 'half', affects: 'enemies'}), zoneTriggers.entering)}),
  spell('Web', 2, {range: 60, shape: 'cube', side: 20, persistent: true, difficult: true, concentration: true, duration: 3600,
    effects: onTriggers(condition('Restrained', {save: 'dex', escape: {ability: 'str'}}), zoneTriggers.casting)}),

  // ── dispel ──
  spell('Dispel Magic', 3, {range: 120, sight: true, effects: [dispel(3)]}),
];
