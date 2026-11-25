// Combat cantrips (PHB + TCE) not already in migrated.mjs / exemplars.mjs.
import {spell, dmg, damage, status, pushAway} from './builders.mjs';

const cantrip = (die, type) => dmg(die, type, {upcast: die, scaleWithCaster: true});

export const batch = [
  spell('Acid Splash', 0, {range: 60, targets: {base: 2, side: 'enemy'},
    effects: [damage(cantrip('1d6', 'acid'), {save: 'dex'})]}),
  spell('Chill Touch', 0, {range: 120, attack: 'ranged', effects: [damage(cantrip('1d8', 'necrotic'))]}),
  spell('Mind Sliver', 0, {source: 'TCE', range: 60, sight: true, effects: [
    damage(cantrip('1d6', 'psychic'), {save: 'int'}),
    status({name: 'Mind Sliver', rollModifiers: {save: '-1d4'}, until: 'targetStart'}, {save: 'int'}),
  ]}),
  spell('Produce Flame', 0, {range: 30, attack: 'ranged', effects: [damage(cantrip('1d8', 'fire'))]}),
  spell('Shocking Grasp', 0, {range: 5, attack: 'melee', effects: [
    damage(cantrip('1d8', 'lightning')),
    status({name: 'Shocking Grasp', noReactions: true, until: 'targetStart'}),
  ]}),
  // 5 ft radius around the caster → 10 ft cube centered on the caster.
  spell('Sword Burst', 0, {source: 'TCE', range: 0, shape: 'cube', side: 10, origin: 'caster',
    effects: [damage(cantrip('1d6', 'force'), {save: 'dex', affects: 'enemies'})]}),
  spell('Thorn Whip', 0, {range: 30, attack: 'melee', effects: [
    damage(cantrip('1d6', 'piercing'), {push: {mode: 'toward', distance: 10}}),
  ]}),
  spell('Lightning Lure', 0, {source: 'TCE', range: 15, effects: [
    damage(cantrip('1d8', 'lightning'), {save: 'str', onSave: 'none', push: {mode: 'toward', distance: 10}}),
  ]}),
];
