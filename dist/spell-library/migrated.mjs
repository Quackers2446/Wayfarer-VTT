// Spells that used to be hard-coded in combat.mjs (native-spell-definitions.mjs), re-expressed as data.
// The engine reproduces their behaviour, so they live here now.  Spells that still need native code are listed in
// SPELL_ENGINE.md → "Native spells that are not data yet".
import {spell, dmg, damage, healing, status} from './builders.mjs';

const cantrip = (name, die, type, upcast = die) => dmg(die, type, {upcast, scaleWithCaster: true});

export const migrated = [
  spell('Fire Bolt', 0, {range: 120, attack: 'ranged', effects: [damage(cantrip('Fire Bolt', '1d10', 'fire'))]}),
  spell('Ray of Frost', 0, {range: 60, attack: 'ranged', effects: [
    damage(cantrip('Ray of Frost', '1d8', 'cold')),
    status({name: 'Ray of Frost', speedBonus: -10, until: 'casterStart'}),
  ]}),
  spell('Sacred Flame', 0, {range: 60, sight: true, effects: [damage(cantrip('Sacred Flame', '1d8', 'radiant'), {save: 'dex'})]}),
  spell('Vicious Mockery', 0, {range: 60, sight: true, hearing: true, effects: [
    damage(cantrip('Vicious Mockery', '1d4', 'psychic'), {save: 'wis'}),
    status({name: 'Vicious Mockery', attack: 'dis', until: 'targetEnd', ends: {onAttack: true}}, {save: 'wis'}),
  ]}),
  spell('Poison Spray', 0, {range: 10, effects: [damage(cantrip('Poison Spray', '1d12', 'poison'), {save: 'con'})]}),
  spell('Eldritch Blast', 0, {range: 120, attack: 'ranged', targets: {base: 1, perTier: 1, repeat: true}, effects: [damage(dmg('1d10', 'force'))]}),
  spell('Cure Wounds', 1, {range: 5, effects: [healing(dmg('1d8', 'radiant', {upcast: '1d8', addAbility: true}), {excludeTypes: ['undead', 'construct']})]}),
  spell('Healing Word', 1, {timing: 'bonus', range: 60, effects: [healing(dmg('1d4', 'radiant', {upcast: '1d4', addAbility: true}), {excludeTypes: ['undead', 'construct']})]}),
  spell('Magic Missile', 1, {range: 120, sight: true, targets: {base: 3, perSlot: 1, repeat: true, sharedRoll: true}, effects: [damage(dmg('1d4+1', 'force'))]}),
  spell('Burning Hands', 1, {range: 0, shape: 'cone', length: 15, effects: [damage(dmg('3d6', 'fire', {upcast: '1d6'}), {save: 'dex', onSave: 'half'})]}),
];
