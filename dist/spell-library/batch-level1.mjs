// Level 1 combat spells (PHB + TCE). Spells already in exemplars/migrated/gaps are omitted.
import {spell, dmg, damage, condition, status, onTriggers, zoneTriggers} from './builders.mjs';

export const batch = [
  spell('Chromatic Orb', 1, {range: 90, attack: 'ranged',
    effects: [damage(dmg('3d8', 'fire', {upcast: '1d8'}))]}),
  spell('Inflict Wounds', 1, {range: 5, attack: 'melee',
    effects: [damage(dmg('3d10', 'necrotic', {upcast: '1d10'}))]}),
  spell('Ray of Sickness', 1, {range: 60, attack: 'ranged', duration: 6, effects: [
    damage(dmg('2d8', 'poison', {upcast: '1d8'})),
    condition('Poisoned', {save: 'con', conditionDuration: 6, always: true}),
  ]}),
  spell('Dissonant Whispers', 1, {range: 60, hearing: true, effects: [
    damage(dmg('3d6', 'psychic', {upcast: '1d6'}), {save: 'wis', onSave: 'half', flee: true}),
  ]}),
  spell('Arms of Hadar', 1, {range: 0, shape: 'cube', side: 20, origin: 'caster', effects: [
    damage(dmg('2d6', 'necrotic', {upcast: '1d6'}), {save: 'str', onSave: 'half'}),
    status({name: "Arms of Hadar", noReactions: true, until: 'targetStart'}, {save: 'str'}),
  ]}),
  spell("Tasha's Caustic Brew", 1, {source: 'TCE', range: 0, shape: 'line', length: 30, width: 5, concentration: true, duration: 60,
    effects: [damage(dmg('2d4', 'acid', {upcast: '2d4'}), {save: 'dex'})]}),

  spell('Charm Person', 1, {range: 30, sight: true, duration: 3600, targets: {base: 1, perSlot: 1, side: 'enemy', types: ['humanoid']},
    effects: [condition('Charmed', {save: 'wis'})]}),
  spell('Command', 1, {range: 60, sight: true, duration: 6, targets: {base: 1, perSlot: 1, side: 'enemy'},
    effects: [condition('Prone', {save: 'wis'})]}),
  spell("Tasha's Hideous Laughter", 1, {range: 30, sight: true, concentration: true, duration: 60, targets: {base: 1, side: 'enemy'},
    effects: [
      condition('Prone', {save: 'wis', repeatSave: 'end', endsOnDamage: true}),
      status({name: "Hideous Laughter", incapacitated: true, speedZero: true}, {save: 'wis'}),
    ]}),
  spell('Entangle', 1, {range: 90, shape: 'cube', side: 20, concentration: true, duration: 60, persistent: true, difficult: true,
    effects: onTriggers(condition('Restrained', {save: 'str', escape: {ability: 'str'}}), zoneTriggers.casting)}),
  spell('Grease', 1, {range: 60, shape: 'cube', side: 10, duration: 60, persistent: true, difficult: true,
    effects: onTriggers(condition('Prone', {save: 'dex'}), ['cast', 'enter'])}),

  spell('Divine Favor', 1, {timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Divine Favor', riders: [{formula: '1d4', type: 'radiant', when: 'weapon'}]})]}),
  spell('Heroism', 1, {range: 5, concentration: true, duration: 60, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Heroism'})]}),
  spell('Longstrider', 1, {range: 5, duration: 3600, targets: {base: 1, perSlot: 1, side: 'ally'},
    effects: [status({name: 'Longstrider', speedBonus: 10})]}),
  spell('Protection from Evil and Good', 1, {range: 5, concentration: true, duration: 600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Protection from Evil and Good', attackedBy: 'dis'})]}),
];
