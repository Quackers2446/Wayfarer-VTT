import {ruleKey} from './rules-library.mjs';

export const hestiaName = 'Hestia’s Fury';
export const hestiaWallPool = 'spell:hestias fury:wall of fire';

export function hasHestiasFury(record) {
  return [record.attacks, record.items].some(entries => entries?.some(entry =>
    entry.quantity !== 0 && /^hestias fury\b/.test(ruleKey(entry.name))));
}

const grants = [
  {name:'Fireball', key:'fireball', level:3, usage:{atWill:true}},
  {name:'Wall of Fire', key:'wall of fire', level:4, usage:{maximum:3, rest:'long', resource:hestiaWallPool}},
];

export function hestiaSpells(record) {
  if (!hasHestiasFury(record)) return record.spells;
  const spells = [...(record.spells ?? [])];
  for (const {name, key, level, usage} of grants) {
    const index = spells.findIndex(spell => ruleKey(spell.name.split(' (')[0]) === key);
    const spell = {
      ...spells[index], name:spells[index]?.name??name, key, level, prepared:true, source:'PHB', edition:'2014',
      reference:'phb|'+key, timing:'action', customUse:false, grantedBy:hestiaName,
      castUsage:{...usage, itemOnly:true},
    };
    if(index===-1)spells.push(spell);
    else spells[index]=spell;
  }
  return spells;
}

export function applyHestiasFury(actor) {
  if (actor.side !== 'party' || !hasHestiasFury(actor)) return actor;
  actor.spells = hestiaSpells(actor);
  actor.resources ??= {};
  const legacy = actor.slots?.[4];
  // Older exports put the item's charges in the level-four row without a slot maximum.
  const remaining = legacy?.maximum == null && Number.isInteger(legacy?.current) && legacy.current >= 0 && legacy.current <= 3 ? legacy.current : null;
  actor.resources[hestiaWallPool] ??= {name:hestiaName+' · Wall of Fire',current:remaining??3,maximum:3,rest:'long'};
  if (remaining !== null) delete actor.slots[4];
  return actor;
}
