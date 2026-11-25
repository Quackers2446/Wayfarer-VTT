// Helpers for writing built-in spell rules as readable data.  Everything returns plain JSON objects (rule schema v2);
// nothing here has behaviour of its own.  See SPELL_ENGINE.md → "Writing a built-in spell".
import {ruleKey} from '../spell-rule-schema.mjs';

export const spellRef = (name, source = 'PHB') => source.toLowerCase() + '|' + ruleKey(name);

// spell('Bless', 1, {...fields}) → a complete v2 rule.  Anything in `fields` overrides the defaults.
// Defaults: PHB 2014, action, 30 ft, creature-targeted, instantaneous, no effects.
export function spell(name, level, fields = {}) {
  const {source = 'PHB', edition = '2014', ...rest} = fields;
  return {version: 2, name, reference: spellRef(name, source), source, edition, level, enabled: true, timing: 'action', range: 30, shape: 'creature', concentration: false, duration: 0, effects: [], ...rest};
}

// One damage / healing component: dmg('8d6','fire',{upcast:'1d6'}), dmg('1d10','fire',{upcast:'1d10',scaleWithCaster:true}).
export const dmg = (formula, type, extra = {}) => ({formula, type, ...extra});

const block = (kind, extra) => ({kind, trigger: 'cast', area: 'footprint', ...extra});
// Damage with optional save: damage([dmg(...)], {save:'dex', onSave:'half', condition:'Prone', push:{...}, status:{...}}).
export const damage = (components, extra = {}) => block('damage', {save: '', onSave: 'none', ...extra, damage: Array.isArray(components) ? components : [components]});
export const healing = (components, extra = {}) => block('healing', {...extra, damage: Array.isArray(components) ? components : [components]});
// A table condition (see conditionTable): effect('Restrained', {save:'dex', repeatSave:'end', escape:{ability:'str'}}).
export const condition = (name, extra = {}) => block('effect', {save: '', onSave: 'none', ...extra, condition: name});
// A generic buff / debuff (see "Status model"): status({acBonus:2}, {name:'Shield of Faith'}).
export const status = (spec, extra = {}) => block('effect', {...extra, status: spec});
export const tempHp = (formula, extra = {}) => block('effect', {...extra, tempHp: formula});
export const sleep = (pool, extra = {}) => block('sleep', {condition: 'Asleep', endsOnDamage: true, ...extra, sleepPool: pool});
export const pushAway = (distance, extra = {}) => ({mode: 'away', distance, ...extra});
export const teleportSelf = (extra = {}) => block('teleport', {...extra, teleport: {who: 'self', sight: true}});
export const summon = (creature, extra = {}) => block('summon', {...extra, summon: creature});
export const dispel = (level, extra = {}) => block('dispel', {...extra, dispel: {level}});

// Repeat one block for several triggers (zones): onTriggers(damage(...), ['cast','enter','start']).
export const onTriggers = (template, triggers) => triggers.map(trigger => ({...structuredClone(template), trigger}));
// Same effect for every trigger in the usual "area damage" patterns.
export const zoneTriggers = {
  casting: ['cast', 'enter', 'start'], // Web, Spike Growth-like: when made, when entered, at start of turn
  entering: ['enter', 'start'],        // Spirit Guardians, Moonbeam: no effect on creation
};
