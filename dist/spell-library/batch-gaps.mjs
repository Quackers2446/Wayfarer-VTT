// Spells unlocked by new engine primitives (sleep pool, flee, temp HP retaliation, vision zones,
// tethers, counterspell, mirror images, weapon cantrips, Aid max-HP, Dragon's Breath, Misty Step).
import {spell, dmg, damage, status, tempHp, sleep, teleportSelf} from './builders.mjs';

export const batch = [
  spell('Booming Blade', 0, {source: 'TCE', range: 5, weaponAttack: true, effects: [
    damage(dmg('1d8', 'thunder', {upcast: '1d8', scaleWithCaster: true})),
  ]}),
  spell('Green-Flame Blade', 0, {source: 'TCE', range: 5, weaponAttack: true, effects: [
    damage(dmg('1d8', 'fire', {upcast: '1d8', scaleWithCaster: true})),
  ]}),

  spell('Sleep', 1, {range: 90, shape: 'circle', radius: 20, duration: 60,
    effects: [sleep('5d8', {sleepPoolUpcast: '2d8', conditionDuration: 60, excludeTypes: ['undead']})]}),
  spell('False Life', 1, {range: 0, shape: 'self', duration: 3600,
    effects: [tempHp('1d4+4', {tempHpUpcast: '5'})]}),
  spell('Armor of Agathys', 1, {range: 0, shape: 'self', duration: 3600,
    effects: [tempHp('5', {tempHpUpcast: '5', retaliation: true})]}),
  spell('Witch Bolt', 1, {range: 30, attack: 'ranged', concentration: true, duration: 60, effects: [
    damage(dmg('1d12', 'lightning', {upcast: '1d12'}), {tether: {range: 30, formula: '1d12', type: 'lightning'}}),
  ]}),
  spell('Fog Cloud', 1, {range: 120, shape: 'circle', radius: 20, scale: {radius: 20}, concentration: true, duration: 3600,
    persistent: true, blocksVision: true, zoneName: 'Fog', effects: []}),
  spell('Sanctuary', 1, {timing: 'bonus', range: 30, duration: 60, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Sanctuary', attackedBy: 'dis'})]}),

  spell('Misty Step', 2, {timing: 'bonus', range: 30, shape: 'point', effects: [teleportSelf()]}),
  spell('Aid', 2, {range: 30, duration: 28800, targets: {base: 3, side: 'ally'},
    effects: [status({name: 'Aid', maxHpBonus: 5, maxHpBonusPerSlot: 5})]}),
  spell('Darkness', 2, {range: 60, shape: 'circle', radius: 15, concentration: true, duration: 600,
    persistent: true, blocksVision: true, zoneName: 'Darkness', effects: []}),
  spell('Mirror Image', 2, {range: 0, shape: 'self', duration: 60,
    effects: [status({name: 'Mirror Image', images: 3})]}),
  spell("Dragon's Breath", 2, {source: 'XGE', timing: 'bonus', range: 5, concentration: true, duration: 60,
    targets: {base: 1, side: 'ally', self: true},
    effects: [status({name: "Dragon's Breath", exhale: {faces: 6, save: 'dex', length: 15}})]}),

  spell('Counterspell', 3, {timing: 'reaction', reactionTrigger: 'spellCast', range: 60, shape: 'self',
    effects: [status({name: 'Counterspell'})]}),
];
