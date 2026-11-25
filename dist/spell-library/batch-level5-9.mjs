// Level 5 combat spells, plus Wall of Ice (6th). Higher levels stay deferred.
import {spell, dmg, damage, healing, condition, status, onTriggers} from './builders.mjs';

export const batch = [
  spell('Cone of Cold', 5, {range: 0, shape: 'cone', length: 60,
    effects: [damage(dmg('8d8', 'cold', {upcast: '1d8'}), {save: 'con', onSave: 'half'})]}),
  spell('Flame Strike', 5, {range: 60, shape: 'circle', radius: 10,
    effects: [damage([dmg('4d6', 'fire', {upcast: '1d6'}), dmg('4d6', 'radiant')], {save: 'dex', onSave: 'half'})]}),
  spell('Cloudkill', 5, {range: 120, shape: 'circle', radius: 20, concentration: true, duration: 600, persistent: true, difficult: true,
    effects: onTriggers(damage(dmg('5d8', 'poison', {upcast: '1d8'}), {save: 'con', onSave: 'half'}), ['cast', 'enter', 'start'])}),
  spell('Insect Plague', 5, {range: 300, shape: 'circle', radius: 20, concentration: true, duration: 600, persistent: true, difficult: true,
    effects: onTriggers(damage(dmg('4d10', 'piercing', {upcast: '1d10'}), {save: 'con', onSave: 'half'}), ['cast', 'enter', 'start'])}),
  spell('Destructive Wave', 5, {range: 0, shape: 'cube', side: 60, origin: 'caster',
    effects: [damage([dmg('5d6', 'thunder'), dmg('5d6', 'radiant')], {save: 'con', onSave: 'half', affects: 'enemies'}),
      condition('Prone', {save: 'con'})]}),
  spell('Hold Monster', 5, {range: 90, sight: true, concentration: true, duration: 60, targets: {base: 1, perSlot: 1, side: 'enemy'},
    effects: [condition('Paralyzed', {save: 'wis', repeatSave: 'end'})]}),
  // dominated marks thralls for the telepathic command / total-control UI; damage grants a new Wis save.
  spell('Dominate Person', 5, {range: 60, sight: true, concentration: true, duration: 60, targets: {base: 1, side: 'enemy', types: ['humanoid']},
    effects: [condition('Charmed', {save: 'wis', repeatSave: 'damaged', dominated: true})]}),
  spell('Mass Cure Wounds', 5, {range: 60, shape: 'circle', radius: 30,
    effects: [healing(dmg('3d8', 'radiant', {upcast: '1d8', addAbility: true}), {excludeTypes: ['undead', 'construct'], affects: 'allies'})]}),
  spell('Banishing Smite', 5, {timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Banishing Smite', riders: [{formula: '5d10', type: 'force', when: 'weapon', consume: true}]})]}),
  spell('Circle of Power', 5, {range: 0, shape: 'aura', radius: 30, concentration: true, duration: 600, persistent: true,
    effects: [status({name: 'Circle of Power', save: {all: 'adv'}})]}),
  spell('Synaptic Static', 5, {source: 'XGE', range: 120, shape: 'circle', radius: 20,
    effects: [damage(dmg('8d6', 'psychic'), {save: 'int', onSave: 'half'}),
      status({name: 'Synaptic Static', attack: 'dis', check: 'dis', rollModifiers: {save: '-1d6'}}, {save: 'int'})]}),
  // PHB Wall of Ice (6th): solid panels, cast damage when it appears, blocks sight/movement/projectiles.
  spell('Wall of Ice', 6, {range: 120, shape: 'wall', length: 100, width: 5, concentration: true, duration: 600, persistent: true,
    blocksVision: true, blocksMovement: true, blocksRanged: true,
    effects: [
      {...damage(dmg('10d6', 'cold', {upcast: '2d6'}), {save: 'dex', onSave: 'half'}), trigger: 'cast'},
    ]}),
];
