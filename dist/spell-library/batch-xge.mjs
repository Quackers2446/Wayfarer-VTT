// Xanathar's Guide combat spells (2014), cantrips through level 5.
// Absorb Elements, Dragon's Breath, and Synaptic Static already live in exemplars / gaps / level5.
// Complex summons, minute-cast rituals, and pure utility (Control Flames, Ceremony, …) stay deferred.
import {spell, dmg, damage, healing, condition, status, onTriggers, zoneTriggers, teleportSelf} from './builders.mjs';
// teleportSelf() keeps sight:true; Thunder Step uses an inline teleport block for sight:false.

const cantrip = (die, type) => dmg(die, type, {upcast: die, scaleWithCaster: true});
const xge = (name, level, fields) => spell(name, level, {source: 'XGE', ...fields});

export const batch = [
  // ─── cantrips ───
  xge('Frostbite', 0, {range: 60, effects: [
    damage(cantrip('1d6', 'cold'), {save: 'con'}),
    status({name: 'Frostbite', attack: 'dis', until: 'targetStart'}, {save: 'con'}),
  ]}),
  xge('Toll the Dead', 0, {range: 60, effects: [
    // Simplified: uses the larger die (missing-HP case). Full branching stays deferred.
    damage(cantrip('1d12', 'necrotic'), {save: 'wis'}),
  ]}),
  xge('Thunderclap', 0, {range: 0, shape: 'cube', side: 10, origin: 'caster',
    effects: [damage(cantrip('1d6', 'thunder'), {save: 'con', affects: 'enemies'})]}),
  xge('Word of Radiance', 0, {range: 0, shape: 'cube', side: 10, origin: 'caster',
    effects: [damage(cantrip('1d6', 'radiant'), {save: 'con', affects: 'enemies'})]}),
  xge('Infestation', 0, {range: 30, effects: [
    damage(cantrip('1d6', 'poison'), {save: 'con'}),
  ]}),
  xge('Primal Savagery', 0, {range: 5, attack: 'melee',
    effects: [damage(cantrip('1d10', 'acid'))]}),
  xge('Create Bonfire', 0, {range: 60, shape: 'cube', side: 5, concentration: true, duration: 60, persistent: true,
    effects: onTriggers(damage(cantrip('1d8', 'fire'), {save: 'dex'}), ['cast', 'enter', 'start'])}),

  // ─── level 1 ───
  xge('Ice Knife', 1, {range: 60, attack: 'ranged', effects: [
    // Primary knife hit; 5-ft cold splash around the target is deferred (same class as GFB splash).
    damage([dmg('1d10', 'piercing'), dmg('2d6', 'cold', {upcast: '1d6'})]),
  ]}),
  xge('Chaos Bolt', 1, {range: 120, attack: 'ranged', effects: [
    // Random damage type + bounce deferred; force stands in for the rolled type.
    damage([dmg('2d8', 'force'), dmg('1d8', 'force', {upcast: '1d6'})]),
  ]}),
  xge('Catapult', 1, {range: 60, effects: [
    damage(dmg('3d8', 'bludgeoning', {upcast: '1d8'}), {save: 'dex'}),
  ]}),
  xge('Cause Fear', 1, {range: 60, sight: true, concentration: true, duration: 60,
    targets: {base: 1, perSlot: 1, side: 'enemy'},
    effects: [condition('Frightened', {save: 'wis', repeatSave: 'end'})]}),
  xge('Earth Tremor', 1, {range: 0, shape: 'cube', side: 20, origin: 'caster',
    effects: [
      damage(dmg('1d6', 'bludgeoning', {upcast: '1d6'}), {save: 'dex', onSave: 'half', affects: 'enemies'}),
      condition('Prone', {save: 'dex', affects: 'enemies'}),
    ]}),
  xge('Zephyr Strike', 1, {timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Zephyr Strike', attack: 'adv',
      riders: [{formula: '1d8', type: 'force', when: 'weapon', consume: true}]})]}),

  // ─── level 2 ───
  xge("Aganazzar's Scorcher", 2, {range: 0, shape: 'line', length: 30, width: 5,
    effects: [damage(dmg('3d8', 'fire', {upcast: '1d8'}), {save: 'dex', onSave: 'half'})]}),
  xge("Snilloc's Snowball Swarm", 2, {range: 90, shape: 'circle', radius: 5,
    effects: [damage(dmg('3d6', 'cold', {upcast: '1d6'}), {save: 'dex', onSave: 'half'})]}),
  xge('Mind Spike', 2, {range: 60, concentration: true, duration: 3600, effects: [
    damage(dmg('3d8', 'psychic', {upcast: '1d8'}), {save: 'wis'}),
  ]}),
  xge("Maximilian's Earthen Grasp", 2, {range: 30, concentration: true, duration: 60, targets: {base: 1, side: 'enemy'},
    effects: [
      condition('Restrained', {save: 'str', escape: {ability: 'str'}}),
      damage(dmg('2d6', 'bludgeoning'), {save: 'str', onSave: 'half'}),
    ]}),
  xge('Earthbind', 2, {range: 300, concentration: true, duration: 60, targets: {base: 1, side: 'enemy'},
    effects: [status({name: 'Earthbind', speedZero: true}, {save: 'str'})]}),
  xge('Warding Wind', 2, {range: 0, shape: 'aura', radius: 10, concentration: true, duration: 600, persistent: true,
    effects: [status({name: 'Warding Wind', attackedBy: 'dis'})]}),
  xge('Shadow Blade', 2, {timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Shadow Blade',
      riders: [{formula: '2d8', type: 'psychic', upcast: '1d8', when: 'weapon'}]})]}),
  xge('Dust Devil', 2, {range: 60, shape: 'movable', radius: 0, nearby: 5, move: 30, concentration: true, duration: 60, persistent: true,
    effects: [
      {...damage(dmg('1d8', 'bludgeoning', {upcast: '1d8'}), {save: 'str', onSave: 'half', area: 'nearby'}), trigger: 'end'},
      {...damage(dmg('1d8', 'bludgeoning', {upcast: '1d8'}), {save: 'str', onSave: 'half'}), trigger: 'ram'},
    ]}),
  xge('Healing Spirit', 2, {timing: 'bonus', range: 60, shape: 'movable', radius: 0, nearby: 0, move: 30, concentration: true, duration: 60, persistent: true,
    effects: onTriggers(healing(dmg('1d6', 'radiant', {upcast: '1d6'}), {excludeTypes: ['undead', 'construct']}), ['cast', 'enter', 'start'])}),

  // ─── level 3 ───
  xge('Erupting Earth', 3, {range: 120, shape: 'cube', side: 20, persistent: true, difficult: true, endNextTurn: true, duration: 6,
    effects: [damage(dmg('3d12', 'bludgeoning', {upcast: '1d12'}), {save: 'dex', onSave: 'half'})]}),
  xge('Tidal Wave', 3, {range: 120, shape: 'cube', side: 30,
    effects: [
      damage(dmg('4d8', 'bludgeoning'), {save: 'dex', onSave: 'half'}),
      condition('Prone', {save: 'dex'}),
    ]}),
  xge('Thunder Step', 3, {range: 90, shape: 'point',
    // Departure thunder (10 ft) deferred; teleport matches Misty Step at longer range.
    effects: [{kind: 'teleport', trigger: 'cast', teleport: {who: 'self', sight: false}}]}),
  xge('Life Transference', 3, {range: 30, targets: {base: 1, side: 'ally'}, effects: [
    damage(dmg('4d8', 'necrotic', {upcast: '1d8'}), {to: 'self', always: true}),
    healing(dmg('8d8', 'radiant', {upcast: '2d8'}), {excludeTypes: ['undead', 'construct']}),
  ]}),
  xge('Enemies Abound', 3, {range: 120, sight: true, concentration: true, duration: 60, targets: {base: 1, side: 'enemy'},
    effects: [condition('Charmed', {save: 'int', repeatSave: 'end'})]}),
  xge('Flame Arrows', 3, {range: 5, concentration: true, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Flame Arrows', riders: [{formula: '1d6', type: 'fire', when: 'weapon'}]})]}),
  xge("Melf's Minute Meteors", 3, {range: 0, shape: 'self', concentration: true, duration: 60,
    // Full meteor volley UI deferred; grants a reusable fire burst rider while concentrating.
    effects: [status({name: "Minute Meteors",
      riders: [{formula: '2d6', type: 'fire', when: 'spell'}]})]}),

  // ─── level 4 ───
  xge('Vitriolic Sphere', 4, {range: 150, shape: 'circle', radius: 20, effects: [
    damage(dmg('10d4', 'acid', {upcast: '2d4'}), {save: 'dex', onSave: 'half',
      pendingDamage: {formula: '5d4', type: 'acid', upcast: '1d4'}}),
  ]}),
  xge('Sickening Radiance', 4, {range: 120, shape: 'circle', radius: 30, concentration: true, duration: 600, persistent: true,
    effects: onTriggers(damage(dmg('4d10', 'radiant'), {save: 'con'}), zoneTriggers.entering).concat([
      {...condition('Poisoned', {save: 'con'}), trigger: 'start'},
    ])}),
  xge('Storm Sphere', 4, {range: 150, shape: 'movable', radius: 20, nearby: 0, move: 30, concentration: true, duration: 60, persistent: true, difficult: true,
    effects: [
      {...damage(dmg('2d6', 'bludgeoning'), {save: 'str', onSave: 'half'}), trigger: 'cast'},
      {...damage(dmg('2d6', 'bludgeoning'), {save: 'str', onSave: 'half'}), trigger: 'enter'},
      {...damage(dmg('4d6', 'lightning', {upcast: '1d6'}), {save: 'dex', onSave: 'half'}), trigger: 'ram'},
    ]}),
  xge('Charm Monster', 4, {range: 30, sight: true, duration: 3600, targets: {base: 1, perSlot: 1, side: 'enemy'},
    effects: [condition('Charmed', {save: 'wis'})]}),
  xge('Elemental Bane', 4, {range: 90, concentration: true, duration: 60, targets: {base: 1, perSlot: 1, side: 'enemy'},
    effects: [
      status({name: 'Elemental Bane', vulnerable: ['fire']}, {save: 'con'}),
      damage(dmg('2d6', 'fire'), {save: 'con'}),
    ]}),
  xge('Guardian of Nature', 4, {timing: 'bonus', range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Guardian of Nature', attack: 'adv',
      riders: [{formula: '1d6', type: 'force', when: 'weapon'}]})]}),
  xge('Shadow of Moil', 4, {range: 0, shape: 'self', concentration: true, duration: 60,
    effects: [status({name: 'Shadow of Moil', attackedBy: 'dis', resist: ['radiant'],
      riders: [{formula: '2d8', type: 'necrotic', when: 'melee'}]})]}),

  // ─── level 5 ───
  xge('Dawn', 5, {range: 60, shape: 'circle', radius: 30, concentration: true, duration: 60, persistent: true,
    effects: onTriggers(damage(dmg('4d10', 'radiant'), {save: 'con', onSave: 'half'}), ['cast', 'enter', 'start'])}),
  xge('Enervation', 5, {range: 60, attack: 'ranged', concentration: true, duration: 60, effects: [
    damage(dmg('4d8', 'necrotic'), {healFraction: 0.5, tether: {range: 60, formula: '4d8', type: 'necrotic'}}),
  ]}),
  xge('Far Step', 5, {timing: 'bonus', range: 60, shape: 'point', concentration: true, duration: 60,
    effects: [teleportSelf()]}),
  xge('Holy Weapon', 5, {timing: 'bonus', range: 5, concentration: true, duration: 3600, targets: {base: 1, side: 'ally'},
    effects: [status({name: 'Holy Weapon',
      riders: [{formula: '2d8', type: 'radiant', when: 'weapon'}]})]}),
  xge('Immolation', 5, {range: 90, sight: true, concentration: true, duration: 60, targets: {base: 1, side: 'enemy'},
    effects: [damage(dmg('8d6', 'fire'), {save: 'dex', onSave: 'half',
      tether: {range: 90, formula: '4d6', type: 'fire'}})]}),
  xge('Steel Wind Strike', 5, {range: 30, attack: 'melee', targets: {base: 5, side: 'enemy', repeat: true},
    effects: [damage(dmg('6d10', 'force'))]}),
  xge('Maelstrom', 5, {range: 120, shape: 'circle', radius: 30, concentration: true, duration: 60, persistent: true, difficult: true,
    effects: onTriggers(damage(dmg('6d6', 'bludgeoning'), {save: 'str', onSave: 'half'}), ['cast', 'enter', 'start'])}),
  xge('Negative Energy Flood', 5, {range: 60, effects: [
    damage(dmg('5d12', 'necrotic'), {save: 'con', onSave: 'half'}),
  ]}),
  xge('Wall of Light', 5, {range: 120, shape: 'wall', length: 60, concentration: true, duration: 600, persistent: true, blocksVision: true,
    effects: [
      {...damage(dmg('4d8', 'radiant', {upcast: '1d8'}), {save: 'con', onSave: 'half'}), trigger: 'cast'},
      {...condition('Blinded', {save: 'con', repeatSave: 'end', conditionDuration: 60}), trigger: 'cast'},
      {...damage(dmg('4d8', 'radiant', {upcast: '1d8'})), trigger: 'end'},
      {...damage(dmg('4d8', 'radiant', {upcast: '1d8'})), trigger: 'beam'},
    ]}),
];
