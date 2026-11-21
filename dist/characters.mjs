const abilities = [
  ["STR", "Strength"], ["DEX", "Dexterity"], ["CON", "Constitution"],
  ["INT", "Intelligence"], ["WIS", "Wisdom"], ["CHA", "Charisma"],
];

const clean = (value) => typeof value === "string" ? value.trim() : value;
const asText = (value) => value == null ? "" : String(value).trim();

function numeric(value) {
  const match = asText(value).match(/^([+-]?\d+(?:\.\d+)?)(?:\s*(?:ft\.?|feet))?$/i);
  return match ? Number(match[1]) : null;
}

function grid(sheet) {
  return (address) => clean(sheet[address]?.t === "e" ? undefined : sheet[address]?.v);
}

function rowRange(start, end) {
  return Array.from({length: end - start + 1}, (_, index) => start + index);
}

function readAttacks(cell, start, end, name, bonus, damage) {
  return rowRange(start, end).map((row) => ({
    name: asText(cell(name + row)),
    bonus: cell(bonus + row),
    damage: asText(cell(damage + row)),
  })).filter((attack) => attack.name);
}

function readInventory(cell, layout) {
  let row = rowRange(1, 180).find((i) => /^item$/i.test(asText(cell("J" + i))));
  if (!row) return [];
  const items = [];
  for (row += 1; row < 180 && !/^equipment\s*&\s*treasure$/i.test(asText(cell("I" + row))); row++) {
    for (const [nameColumn, quantityColumn, weightColumn] of layout.inventory) {
      const name = cell(nameColumn + row);
      if (typeof name === "string" && name) {
        items.push({name, quantity: numeric(cell(quantityColumn + row)), weight: numeric(cell(weightColumn + row))});
      }
    }
  }
  return items;
}

function readSpells(cell, rightColumn) {
  const cantrips = rowRange(1, 190).find((row) => /^cantrips$/i.test(asText(cell("F" + row))));
  if (!cantrips) return [];
  const bands = [[0,3], [4,5], [10,5], [16,5], [22,4], [27,4], [32,4], [37,3], [41,3], [45,3]];
  const middle = [["N","M"], ["X","W"]];
  const right = [rightColumn, rightColumn === "AI" ? "AH" : "AG"];
  return bands.flatMap(([offset, count], level) => {
    const first = cantrips - 1 + offset;
    const columns = level % 2 ? [["D","C"], ...middle] : [...middle, right];
    return rowRange(first, first + count - 1).flatMap((row) => columns.flatMap(([column, flagColumn]) => {
      const name = cell(column + row);
      if (typeof name !== "string" || !name || /^\([^)]*\)$/.test(name)) return [];
      const marker = cell(flagColumn + row);
      return [{name, level, prepared: Boolean(marker && marker !== "0" && marker !== "FALSE")}];
    }));
  });
}

function uniqueSpells(spells) {
  const known = new Map();
  for (const spell of spells) {
    const key = spell.level + ":" + spell.name.toLowerCase();
    const previous = known.get(key);
    if (previous) previous.prepared ||= spell.prepared;
    else known.set(key, spell);
  }
  return Array.from(known.values());
}

function templateCharacter(cell, sheetName, additional) {
  const wide = cell("AM5") === "LEVEL";
  const layout = wide
    ? {level:"AM", player:"AF", alignment:"AA", speed:"AA", damage:"AD",
       spellRight:"AI", spellDC:"AC", spellAttack:"AJ", inventory:[["J","I","U"],["AB","AA","AM"]]}
    : {level:"AL", player:"AE", alignment:"Z", speed:"Z", damage:"AC",
       spellRight:"AH", spellDC:"AB", spellAttack:"AI", inventory:[["J","I","U"],["AA","Z","AL"]]};
  const name = asText(cell("C6"));
  if (!name || /^character name$/i.test(name)) return null;
  const spells = readSpells(cell, layout.spellRight);
  const attacks = readAttacks(cell, 32, 42, "R", "Y", layout.damage);
  if (additional) {
    spells.push(...readSpells(additional, "AH"));
    attacks.push(...readAttacks(additional, 3, 13, "B", "I", "M"));
    attacks.push(...readAttacks(additional, 3, 13, "W", "AD", "AH"));
  }
  const spellLabels = rowRange(1, 190).find((row) => /^(?:spell save dc|save dc)$/i.test(asText(cell(layout.spellDC + row))));
  return {
    sheetName, name,
    characterClass: asText(cell("T5")),
    species: asText(cell("T7")),
    level: numeric(cell(layout.level + "6")),
    background: asText(cell("Z5")),
    player: asText(cell(layout.player + "5")),
    alignment: asText(cell(layout.alignment + "7")),
    xp: numeric(cell(layout.player + "7")),
    ac: numeric(cell("R12")),
    initiative: numeric(cell("V12")),
    speed: asText(cell(layout.speed + "12")),
    hp: numeric(cell("R17")), maxHp: numeric(cell("U16")), tempHp: numeric(cell("R21")),
    proficiency: numeric(cell("H14")),
    passivePerception: numeric(cell("C45")),
    abilities: abilities.map(([abbr, label], index) => ({
      abbr, label,
      score: numeric(cell("C" + (15 + index * 5))),
      modifier: numeric(cell("C" + (13 + index * 5))),
      save: numeric(cell("I" + (17 + index))),
    })),
    skills: rowRange(25, 42).map((row) => ({
      name: asText(cell("J" + row)), bonus: numeric(cell("I" + row)),
    })).filter((skill) => skill.name && skill.bonus !== null),
    attacks,
    items: readInventory(cell, layout),
    spells: uniqueSpells(spells),
    spellDC: spellLabels ? numeric(cell(layout.spellDC + (spellLabels - 2))) : null,
    spellAttack: spellLabels ? numeric(cell(layout.spellAttack + (spellLabels - 2))) : null,
  };
}

const simpleLabels = {
  name: ["character name", "name"], characterClass: ["class", "character class", "class and level", "class level"],
  species: ["species", "race", "ancestry", "lineage"], level: ["level", "character level"],
  background: ["background"], player: ["player", "player name"], alignment: ["alignment"],
  xp: ["xp", "experience points"], ac: ["armor class", "ac"], initiative: ["initiative"],
  speed: ["speed", "movement speed"], hp: ["current hp", "hit points", "hp", "current hit points"],
  maxHp: ["max hp", "maximum hp", "max hit points", "hit point maximum", "maximum hit points"],
  tempHp: ["temporary hp", "temp hp", "temporary hit points"],
  proficiency: ["proficiency", "proficiency bonus"], passivePerception: ["passive perception"],
};
const normalizeLabel = (value) => asText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function simpleCharacter(sheet, sheetName, utils) {
  const rows = utils.sheet_to_json(sheet, {header: 1, blankrows: false, raw: true, defval: null, range: 0});
  const labels = new Set([...Object.values(simpleLabels).flat(), ...abilities.flat().map(normalizeLabel)]);
  const fields = new Map();
  const inline = /^([^:\n]+):\s*(.+)$/;
  const horizontal = rows.findIndex((row) => row.filter((value) => labels.has(normalizeLabel(value))).length >= 3);
  if (horizontal >= 0 && rows[horizontal + 1]) {
    rows[horizontal].forEach((title, index) => {
      const value = rows[horizontal + 1][index];
      if (labels.has(normalizeLabel(title)) && asText(value)) fields.set(normalizeLabel(title), value);
    });
  }
  for (const row of rows) {
    row.forEach((value, index) => {
      const parts = typeof value === "string" ? value.match(inline) : null;
      const key = normalizeLabel(parts?.[1] ?? value);
      if (!labels.has(key) || fields.has(key)) return;
      const next = parts?.[2] ?? row.slice(index + 1).find((entry) => asText(entry));
      if (asText(next) && !labels.has(normalizeLabel(next))) fields.set(key, next);
    });
  }
  const read = (keys) => keys.map((key) => fields.get(key)).find((value) => value != null);
  const source = Object.fromEntries(Object.entries(simpleLabels).map(([field, keys]) => [field, read(keys)]));
  if (!source.name || (!source.characterClass && !source.species && !source.level &&
      !source.ac && !source.hp && !abilities.some(([abbr, label]) => read([normalizeLabel(abbr), normalizeLabel(label)])))) {
    return null;
  }
  const classLevel = asText(source.characterClass).match(/^(.+?)\s+(?:level\s+)?(\d+)$/i);
  return {
    sheetName,
    name: asText(source.name),
    characterClass: classLevel?.[1] ?? asText(source.characterClass),
    species: asText(source.species), level: numeric(source.level ?? classLevel?.[2]),
    background: asText(source.background), player: asText(source.player), alignment: asText(source.alignment),
    speed: asText(source.speed),
    ...Object.fromEntries(["xp","ac","initiative","hp","maxHp","tempHp","proficiency","passivePerception"]
      .map((key) => [key, numeric(source[key])])),
    abilities: abilities.map(([abbr, label]) => {
      const score = numeric(read([normalizeLabel(abbr), normalizeLabel(label)]));
      return {abbr, label, score, modifier: score === null ? null : Math.floor((score - 10) / 2), save: null};
    }),
    skills: [], attacks: [], items: [], spells: [],
  };
}

export function readCharacters(bytes, workbookFiles) {
  const workbook = workbookFiles.read(bytes, {type: "array"});
  const candidates = workbook.SheetNames.filter((_, index) => !workbook.Workbook?.Sheets?.[index]?.Hidden);
  const isTemplate = (cell) => cell("T6") === "CLASS" && cell("C12") === "STR" &&
    (cell("AL5") === "LEVEL" || cell("AM5") === "LEVEL");
  const templateSheets = candidates.filter((name) => isTemplate(grid(workbook.Sheets[name])));
  if (templateSheets.length) {
    const extra = workbook.SheetNames.find((name) => /^additional$/i.test(name));
    const additional = templateSheets.length === 1 && extra ? grid(workbook.Sheets[extra]) : null;
    return templateSheets.map((name) => templateCharacter(grid(workbook.Sheets[name]), name, additional)).filter(Boolean);
  }
  return candidates.map((name) => simpleCharacter(workbook.Sheets[name], name, workbookFiles.utils)).filter(Boolean);
}
