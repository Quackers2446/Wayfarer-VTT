import {
  validHomebrewPack, packProblems, monsterProblems, itemProblems, featureProblems,
  homebrewVersion, homebrewId, blankMonster, blankItem, blankFeature,
} from './homebrew-schema.mjs';

const storageKey = 'wayfarer-homebrew-v1';
const empty = () => ({version: homebrewVersion, monsters: {}, items: {}, features: {}});

function read() {
  try {
    const pack = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!pack) return empty();
    if (!validHomebrewPack(pack)) return empty();
    return pack;
  } catch {
    return empty();
  }
}

function write(pack) {
  if (!validHomebrewPack(pack)) throw Error(packProblems(pack).join(' ') || 'Invalid homebrew pack.');
  const encoded = JSON.stringify(pack);
  if (new TextEncoder().encode(encoded).length > 1_500_000) throw Error('The homebrew library is too large for this browser.');
  localStorage.setItem(storageKey, encoded);
  globalThis.document?.dispatchEvent(new Event('wayfarer:homebrew-saved'));
  return pack;
}

export function loadHomebrew() {
  return structuredClone(read());
}

export function listHomebrew(kind) {
  return Object.values(read()[kind] ?? {}).sort((a, b) => a.name.localeCompare(b.name));
}

export function getHomebrew(kind, id) {
  return structuredClone(read()[kind]?.[id] ?? null);
}

function saveEntry(kind, entry, validate) {
  const problems = validate(entry);
  if (problems.length) throw Error(problems.join(' '));
  const pack = read();
  pack[kind][entry.id] = structuredClone(entry);
  if (Object.keys(pack[kind]).length > 200) throw Error('Use up to 200 ' + kind + '.');
  write(pack);
  return entry;
}

export function saveHomebrewMonster(monster) {
  return saveEntry('monsters', {...monster, id: homebrewId(monster.name)}, monsterProblems);
}

export function saveHomebrewItem(item) {
  return saveEntry('items', {...item, id: homebrewId(item.name)}, itemProblems);
}

export function saveHomebrewFeature(feature) {
  return saveEntry('features', {...feature, id: homebrewId(feature.name)}, featureProblems);
}

export function removeHomebrew(kind, id) {
  const pack = read();
  delete pack[kind][id];
  write(pack);
}

export function importHomebrewPack(value, {replace = false} = {}) {
  const problems = packProblems(value);
  if (problems.length) throw Error(problems.join(' '));
  const current = replace ? empty() : read();
  const next = {
    version: homebrewVersion,
    monsters: {...current.monsters, ...structuredClone(value.monsters ?? {})},
    items: {...current.items, ...structuredClone(value.items ?? {})},
    features: {...current.features, ...structuredClone(value.features ?? {})},
  };
  for (const kind of ['monsters', 'items', 'features']) {
    if (Object.keys(next[kind]).length > 200) throw Error('Use up to 200 ' + kind + '.');
  }
  return write(next);
}

export function exportHomebrewPack() {
  return loadHomebrew();
}

export {blankMonster, blankItem, blankFeature, homebrewId};
