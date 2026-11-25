// Level 3 combat spells. Haste, Slow, Lightning Bolt, Spirit Guardians, Dispel Magic are exemplars.
// Counterspell lives in batch-gaps.mjs. Call Lightning sustain and rich conjurations stay deferred.
import {spell, dmg, damage, healing, condition, status, onTriggers, zoneTriggers} from './builders.mjs';

export const batch = [
  spell('Fireball', 3, {range: 150, shape: 'circle', radius: 20,
    effects: [damage(dmg('8d6', 'fire', {upcast: '1d6'}), {save: 'dex', onSave: 'half'})]}),
  spell('Fear', 3, {range: 0, shape: 'cone', length: 30, concentration: true, duration: 60,
    effects: [condition('Frightened', {save: 'wis', repeatSave: 'end'})]}),
  spell('Hypnotic Pattern', 3, {range: 120, shape: 'cube', side: 30, concentration: true, duration: 60,
    effects: [status({name: 'Hypnotic Pattern', incapacitated: true, speedZero: true, ends: {onDamaged: true}}, {save: 'wis'})]}),
  spell('Hunger of Hadar', 3, {range: 150, shape: 'circle', radius: 20, concentration: true, duration: 60, persistent: true, difficult: true, blocksVision: true,
    effects: [
      {...damage(dmg('2d6', 'cold')), trigger: 'start'},
      {...damage(dmg('2d6', 'acid'), {save: 'dex', onSave: 'none'}), trigger: 'end'},
    ]}),
  spell('Sleet Storm', 3, {range: 150, shape: 'circle', radius: 40, concentration: true, duration: 60, persistent: true, difficult: true, blocksVision: true,
    effects: onTriggers(condition('Prone', {save: 'dex'}), ['cast', 'enter'])}),
  spell('Stinking Cloud', 3, {range: 90, shape: 'circle', radius: 20, concentration: true, duration: 60, persistent: true, blocksVision: true,
    effects: onTriggers(status({name: 'Stinking Cloud', incapacitated: true}, {save: 'con'}), ['start'])}),
  spell('Vampiric Touch', 3, {range: 5, attack: 'melee', concentration: true, duration: 60,
    effects: [damage(dmg('3d6', 'necrotic', {upcast: '1d6'}), {healFraction: 0.5})]}),
  spell('Mass Healing Word', 3, {timing: 'bonus', range: 60, targets: {base: 6, side: 'ally'},
    effects: [healing(dmg('1d4', 'radiant', {upcast: '1d4', addAbility: true}), {excludeTypes: ['undead', 'construct']})]}),
  spell('Fly', 3, {range: 5, concentration: true, duration: 600, targets: {base: 1, perSlot: 1, side: 'ally'},
    effects: [status({name: 'Fly', speedBonus: 60})]}),
  spell('Protection from Energy', 3, {range: 5, concentration: true, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Protection from Energy', resist: ['fire']})]}), // type chosen at cast — fire default
  spell('Crusader\'s Mantle', 3, {range: 0, shape: 'aura', radius: 30, concentration: true, duration: 60, persistent: true,
    effects: [status({name: "Crusader's Mantle", riders: [{formula: '1d4', type: 'radiant', when: 'weapon'}]})]}),
  spell('Spirit Shroud', 3, {source: 'TCE', timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Spirit Shroud', riders: [{formula: '1d8', type: 'radiant', upcast: '1d8', upcastStep: 2, when: 'weapon'}, {formula: '1d8', type: 'radiant', upcast: '1d8', upcastStep: 2, when: 'spell'}]})]}),
  spell('Bestow Curse', 3, {range: 5, concentration: true, duration: 60, targets: {base: 1, side: 'enemy'},
    effects: [status({name: 'Bestow Curse', attack: 'dis', check: 'dis'}, {save: 'wis'})]}),
  spell('Wind Wall', 3, {range: 120, shape: 'wall', length: 50, width: 5, concentration: true, duration: 60, persistent: true, blocksRanged: true,
    effects: [damage(dmg('3d8', 'bludgeoning'), {save: 'str', onSave: 'half', trigger: 'cast'})]}),
  spell('Lightning Arrow', 3, {timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Lightning Arrow', riders: [{formula: '4d8', type: 'lightning', upcast: '1d8', when: 'weapon', consume: true}]})]}),
  spell('Blinding Smite', 3, {timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Blinding Smite', riders: [{formula: '3d8', type: 'radiant', when: 'weapon', consume: true}]})]}),
  spell('Elemental Weapon', 3, {range: 5, concentration: true, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Elemental Weapon', riders: [{formula: '1d4', type: 'fire', when: 'weapon'}], acBonus: 0})]}),
];
