// Validation-only homebrew pack schema. No code execution from imported JSON.
import {formulaValid, damageTypes, ruleKey} from './spell-rule-schema.mjs';

export const homebrewVersion = 1;
export const homebrewSizes = ['T', 'S', 'M', 'L', 'H', 'G'];
export const homebrewCreatureTypes = [
  'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey',
  'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead',
];
export const homebrewItemKinds = ['gear', 'weapon', 'potion'];
export const homebrewRests = ['short', 'long'];

const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const range = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const optionalText = (value, max) => value == null || value === '' || (typeof value === 'string' && value.length <= max);

export const homebrewId = (name) => 'hb|' + ruleKey(name);

function attackProblems(attack, label) {
  const problems = [];
  if (!object(attack)) return [label + ' is invalid.'];
  if (!text(attack.name, 80)) problems.push(label + ' needs a name.');
  if (!int(attack.bonus, -10, 40)) problems.push(label + ' needs an attack bonus from −10 to 40.');
  if (!formulaValid(String(attack.damage ?? ''))) problems.push(label + ' needs a damage formula such as 1d8+3.');
  if (!damageTypes.includes(attack.type)) problems.push(label + ' needs a damage type.');
  if (attack.reach != null && !int(attack.reach, 5, 30)) problems.push(label + ' reach must be 5–30 ft.');
  if (attack.normalRange != null && !int(attack.normalRange, 5, 600)) problems.push(label + ' range must be 5–600 ft.');
  if (attack.longRange != null && !int(attack.longRange, 5, 1200)) problems.push(label + ' long range must be 5–1200 ft.');
  return problems;
}

export function monsterProblems(monster) {
  const problems = [];
  if (!object(monster)) return ['Choose a creature.'];
  if (!text(monster.name, 120)) problems.push('Enter a creature name up to 120 characters.');
  if (typeof monster.id !== 'string' || monster.id !== homebrewId(monster.name) || monster.id.length > 180) {
    problems.push('Creature id must be hb| plus the normalized name.');
  }
  if (!homebrewSizes.includes(monster.size)) problems.push('Choose a creature size.');
  if (!homebrewCreatureTypes.includes(monster.creatureType)) problems.push('Choose a creature type.');
  if (!int(monster.ac, 1, 40)) problems.push('Armor Class must be 1–40.');
  if (!int(monster.hp, 1, 2000)) problems.push('Hit points must be 1–2000.');
  if (!int(monster.speed, 0, 120)) problems.push('Speed must be 0–120 ft.');
  for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    if (!int(monster[ability], 1, 30)) problems.push(ability.toUpperCase() + ' must be 1–30.');
  }
  if (monster.cr != null && !(typeof monster.cr === 'string' && monster.cr.length <= 12 || range(Number(monster.cr), 0, 30))) {
    problems.push('CR must be a short label such as 1/2 or 5.');
  }
  if (!Array.isArray(monster.attacks) || monster.attacks.length > 8) problems.push('Use up to 8 attacks.');
  else monster.attacks.forEach((attack, index) => problems.push(...attackProblems(attack, 'Attack ' + (index + 1))));
  if (!optionalText(monster.traits, 4000)) problems.push('Traits notes are limited to 4,000 characters.');
  if (!optionalText(monster.notes, 1000)) problems.push('Notes are limited to 1,000 characters.');
  if (monster.side != null && !['hostile', 'neutral'].includes(monster.side)) problems.push('Disposition must be hostile or neutral.');
  return [...new Set(problems)];
}

export function itemProblems(item) {
  const problems = [];
  if (!object(item)) return ['Choose an item.'];
  if (!text(item.name, 140)) problems.push('Enter an item name up to 140 characters.');
  if (typeof item.id !== 'string' || item.id !== homebrewId(item.name) || item.id.length > 180) {
    problems.push('Item id must be hb| plus the normalized name.');
  }
  if (!homebrewItemKinds.includes(item.kind)) problems.push('Choose gear, weapon, or potion.');
  if (item.weight != null && !range(item.weight, 0, 99999)) problems.push('Weight must be 0 or greater.');
  if (!optionalText(item.note, 2000)) problems.push('Notes are limited to 2,000 characters.');
  if (item.kind === 'potion') {
    if (!formulaValid(String(item.formula ?? ''))) problems.push('Potions need a healing formula such as 2d4+2.');
  }
  if (item.kind === 'weapon') {
    if (item.bonus != null && !int(item.bonus, -10, 40)) problems.push('Weapon attack bonus must be −10 to 40.');
    if (!formulaValid(String(item.damage ?? ''))) problems.push('Weapons need a damage formula such as 1d8+3.');
    if (!damageTypes.includes(item.damageType)) problems.push('Weapons need a damage type.');
    if (item.finesse != null && typeof item.finesse !== 'boolean') problems.push('Finesse must be a checkbox.');
    if (item.reach != null && !int(item.reach, 5, 30)) problems.push('Reach must be 5–30 ft.');
    if (item.normalRange != null && !int(item.normalRange, 5, 600)) problems.push('Range must be 5–600 ft.');
  }
  if (item.kind === 'gear' && item.formula != null && item.formula !== '' && !formulaValid(String(item.formula))) {
    problems.push('Optional gear formula must be valid dice.');
  }
  return [...new Set(problems)];
}

export function featureProblems(feature) {
  const problems = [];
  if (!object(feature)) return ['Choose a feature.'];
  if (!text(feature.name, 120)) problems.push('Enter a feature name up to 120 characters.');
  if (typeof feature.id !== 'string' || feature.id !== homebrewId(feature.name) || feature.id.length > 180) {
    problems.push('Feature id must be hb| plus the normalized name.');
  }
  if (!optionalText(feature.className, 80)) problems.push('Class name is limited to 80 characters.');
  if (feature.level != null && !int(feature.level, 1, 20)) problems.push('Feature level must be 1–20.');
  if (!text(feature.description, 6000)) problems.push('Enter a feature description up to 6,000 characters.');
  const hasResource = Boolean(typeof feature.resourceName === 'string' ? feature.resourceName.trim() : feature.resourceName);
  if (hasResource) {
    if (!text(feature.resourceName, 80)) problems.push('Resource name is required when a pool is used.');
    if (!int(feature.resourceMax, 1, 99)) problems.push('Resource maximum must be 1–99.');
    if (!homebrewRests.includes(feature.resourceRest ?? 'long')) problems.push('Choose short or long rest for the resource.');
  } else if (feature.resourceMax != null) {
    // Optional pool: a bare rest default must not block save when no pool name/max is set.
    problems.push('Provide a resource name with its maximum and rest.');
  }
  return [...new Set(problems)];
}

export function blankMonster(name = 'Custom Creature') {
  return {
    id: homebrewId(name), name, size: 'M', creatureType: 'humanoid', ac: 12, hp: 11, speed: 30,
    str: 10, dex: 12, con: 11, int: 10, wis: 10, cha: 10, cr: '1/8',
    attacks: [{name: 'Club', bonus: 2, damage: '1d4', type: 'bludgeoning', reach: 5}],
    traits: '', notes: '', side: 'hostile',
  };
}

export function blankItem(name = 'Custom Item', kind = 'gear') {
  const item = {id: homebrewId(name), name, kind, weight: 0, note: ''};
  if (kind === 'potion') item.formula = '2d4+2';
  if (kind === 'weapon') Object.assign(item, {bonus: 3, damage: '1d8+1', damageType: 'slashing', finesse: false, reach: 5});
  return item;
}

export function blankFeature(name = 'Custom Feature') {
  return {
    id: homebrewId(name), name, className: '', level: 1,
    description: 'Describe what this feature does at the table. Wayfarer treats homebrew features as manual rulings unless a resource pool is set.',
    resourceName: '', resourceMax: null, resourceRest: null,
  };
}

export function monsterStatBlock(monster) {
  const problems = monsterProblems(monster);
  if (problems.length) throw Error(problems.join(' '));
  return {
    name: monster.name,
    source: 'HB',
    size: [monster.size],
    type: monster.creatureType,
    ac: [monster.ac],
    hp: {average: monster.hp},
    speed: {walk: monster.speed},
    str: monster.str, dex: monster.dex, con: monster.con,
    int: monster.int, wis: monster.wis, cha: monster.cha,
    cr: monster.cr ?? null,
    attacks: monster.attacks.map((attack) => ({
      name: attack.name,
      bonus: attack.bonus,
      damage: attack.damage,
      type: attack.type,
      reach: attack.reach ?? 5,
      ...(attack.normalRange ? {normalRange: attack.normalRange, longRange: attack.longRange ?? attack.normalRange} : {}),
    })),
    trait: monster.traits?.trim()
      ? [{name: 'Homebrew notes', entries: [monster.traits.trim()]}]
      : [],
    hasToken: false,
    homebrew: true,
  };
}

export function itemToSheetEntry(item, quantity = 1) {
  const problems = itemProblems(item);
  if (problems.length) throw Error(problems.join(' '));
  const entry = {
    name: item.name,
    quantity,
    weight: item.weight ?? null,
    note: item.note ?? '',
    homebrewId: item.id,
    kind: item.kind,
  };
  if (item.kind === 'potion' || item.formula) entry.formula = item.formula;
  if (item.kind === 'weapon') {
    entry.bonus = item.bonus;
    entry.damage = item.damage + (item.damageType ? ' ' + item.damageType : '');
    entry.finesse = Boolean(item.finesse);
    entry.reach = item.reach;
    entry.normalRange = item.normalRange ?? null;
    entry.weapon = true;
  }
  return entry;
}

export function itemToAttack(item) {
  if (item.kind !== 'weapon') return null;
  const problems = itemProblems(item);
  if (problems.length) throw Error(problems.join(' '));
  return {
    name: item.name,
    bonus: item.bonus ?? null,
    damage: item.damage + (item.damageType ? ' ' + item.damageType : ''),
    finesse: Boolean(item.finesse),
    note: item.note ?? '',
    weaponPropertiesEdited: true,
    rangedWeapon: Boolean(item.normalRange),
    reach: item.reach ?? 5,
    ...(item.normalRange ? {normalRange: item.normalRange, longRange: item.longRange ?? item.normalRange} : {}),
  };
}

export function featureToSheetEntry(feature) {
  const problems = featureProblems(feature);
  if (problems.length) throw Error(problems.join(' '));
  const entry = {
    id: feature.id,
    name: feature.name,
    className: feature.className || '',
    level: feature.level ?? null,
    description: feature.description,
    manual: true,
  };
  if (feature.resourceName) {
    entry.resource = {
      name: feature.resourceName,
      maximum: feature.resourceMax,
      current: feature.resourceMax,
      rest: feature.resourceRest ?? 'long',
    };
  }
  return entry;
}

export function packProblems(pack) {
  if (!object(pack)) return ['Choose a homebrew JSON pack.'];
  if (pack.version !== homebrewVersion) return ['Unsupported homebrew pack version.'];
  const problems = [];
  for (const [kind, validate] of [
    ['monsters', monsterProblems],
    ['items', itemProblems],
    ['features', featureProblems],
  ]) {
    const group = pack[kind];
    if (group == null) continue;
    if (!object(group) || Object.keys(group).length > 200) {
      problems.push('Use up to 200 ' + kind + '.');
      continue;
    }
    for (const [id, entry] of Object.entries(group)) {
      if (id !== entry?.id) problems.push(kind.slice(0, -1) + ' key must match its id.');
      problems.push(...validate(entry));
    }
  }
  return [...new Set(problems)];
}

export function validHomebrewPack(pack) {
  return !packProblems(pack).length;
}
