// Level 2 combat spells (PHB + TCE). Scorching Ray, Moonbeam, Spike Growth, Spiritual Weapon, Web are exemplars.
// Misty Step, Aid, Darkness, Mirror Image, Dragon's Breath live in batch-gaps.mjs.
import {spell, dmg, damage, condition, status, onTriggers, zoneTriggers} from './builders.mjs';

export const batch = [
  spell('Shatter', 2, {range: 60, shape: 'circle', radius: 10,
    effects: [damage(dmg('3d8', 'thunder', {upcast: '1d8'}), {save: 'con', onSave: 'half'})]}),
  spell('Cloud of Daggers', 2, {range: 60, shape: 'cube', side: 5, concentration: true, duration: 60, persistent: true,
    effects: onTriggers(damage(dmg('4d4', 'slashing', {upcast: '2d4'})), ['cast', 'enter', 'start'])}),
  spell("Melf's Acid Arrow", 2, {range: 90, attack: 'ranged', effects: [
    damage(dmg('4d4', 'acid', {upcast: '1d4'}), {pendingDamage: {formula: '2d4', type: 'acid', upcast: '1d4'}}),
  ]}),
  spell('Flaming Sphere', 2, {range: 60, shape: 'movable', radius: 0, nearby: 5, move: 30, concentration: true, duration: 60, persistent: true,
    effects: [
      {...damage(dmg('2d6', 'fire', {upcast: '1d6'}), {save: 'dex', onSave: 'half', area: 'nearby'}), trigger: 'end'},
      {...damage(dmg('2d6', 'fire', {upcast: '1d6'}), {save: 'dex', onSave: 'half'}), trigger: 'ram'},
    ]}),
  spell('Blindness/Deafness', 2, {range: 30, duration: 60, targets: {base: 1, perSlot: 1, side: 'enemy'},
    effects: [condition('Blinded', {save: 'con', repeatSave: 'end'})]}),
  spell('Hold Person', 2, {range: 60, sight: true, concentration: true, duration: 60, targets: {base: 1, perSlot: 1, side: 'enemy', types: ['humanoid']},
    effects: [condition('Paralyzed', {save: 'wis', repeatSave: 'end'})]}),
  spell('Invisibility', 2, {range: 5, concentration: true, duration: 3600, targets: {base: 1, perSlot: 1, side: 'ally'},
    effects: [condition('Invisible', {endsOnDamage: false})]}), // ends on attack handled via Invisible breakInvisibility in combat
  spell('Barkskin', 2, {range: 5, concentration: true, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Barkskin', acBase: {base: 16, dex: false}})]}),
  spell('Blur', 2, {range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Blur', attackedBy: 'dis'})]}),
  spell('Enhance Ability', 2, {range: 5, concentration: true, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Enhance Ability', check: 'adv'})]}),
  spell('Pass without Trace', 2, {range: 0, shape: 'self', concentration: true, duration: 3600,
    effects: [status({name: 'Pass without Trace', rollModifiers: {check: '10'}})]}),
  spell("Tasha's Mind Whip", 2, {source: 'TCE', range: 90, effects: [
    damage(dmg('3d6', 'psychic', {upcast: '1d6'}), {save: 'int', onSave: 'half'}),
    status({name: "Mind Whip", noReactions: true, speedMultiplier: 0, until: 'targetStart'}, {save: 'int'}),
  ]}),
  spell('Suggestion', 2, {range: 30, sight: true, concentration: true, duration: 28800, targets: {base: 1, side: 'enemy'},
    effects: [condition('Charmed', {save: 'wis'})]}),
  spell('Silence', 2, {range: 120, shape: 'circle', radius: 20, concentration: true, duration: 600, persistent: true,
    effects: onTriggers(condition('Deafened'), zoneTriggers.casting)}),
  spell('Warding Bond', 2, {range: 5, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Warding Bond', acBonus: 1, saveBonus: {str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1}})]}),
  spell('Protection from Poison', 2, {range: 5, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Protection from Poison', resist: ['poison']})]}),
];
