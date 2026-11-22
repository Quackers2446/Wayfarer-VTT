import {sheetOverrides, wornArmorClass} from "./sheet-editor.mjs";
import {applySpellChoices, buildClassFeatures, classChosenSpells, classKey, loadFeatureData, selectedFeatNames, subclassKey} from "./class-features.mjs";
import {ruleKey} from "./rules-library.mjs";

const skills = {
  acrobatics:"dex","animal handling":"wis",arcana:"int",athletics:"str",deception:"cha",history:"int",
  insight:"wis",intimidation:"cha",investigation:"int",medicine:"wis",nature:"int",perception:"wis",
  performance:"cha",persuasion:"cha",religion:"int","sleight of hand":"dex",stealth:"dex",survival:"wis",
};
const abilityNames = {str:"Strength",dex:"Dexterity",con:"Constitution",int:"Intelligence",wis:"Wisdom",cha:"Charisma"};
const sizeNames = {T:"Tiny",S:"Small",M:"Medium",L:"Large",H:"Huge",G:"Gargantuan"};
const sources = ["PHB","XPHB","TCE","EFA","MPMM","XGE","SCAG","VGM","DMG"];
const normalize = (value) => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"").replace(/[^a-z\d]+/g," ").trim();
const unique = (values) => [...new Set(values.filter(Boolean))];
const filled = (value) => value != null && value !== "";
const levelNumber = (value) => Number.isInteger(value) && value >= 1 && value <= 20;
const title = (value) => value.replace(/(^|[\s(-])([a-z])/g,(_,prefix,letter) => prefix+letter.toUpperCase());
export const sheetSkills = Object.keys(skills).map((skill) => [skill,title(skill)]);

let library = {species:new Map(),backgrounds:new Map(),classes:new Map()};
let loading;

function index(records) {
  const lookup = new Map();
  for (const record of records) {
    for (const name of unique([record.name,...(record.aliases ?? [])])) {
      const key = normalize(name);
      const entries = lookup.get(key) ?? [];
      entries.push(record);
      lookup.set(key,entries);
    }
  }
  return lookup;
}

export function loadCharacterRules() {
  return loading ??= fetch("character-rules.json").then((response) => {
    if (!response.ok) throw new Error("Character rules unavailable.");
    return response.json();
  }).then((data) => {
    const {species,backgrounds,classes} = data;
    library = {species:index(species),backgrounds:index(backgrounds),classes:index(classes)};
    loadFeatureData(data);
  });
}

function candidates(value, records) {
  const exact = records.get(normalize(value));
  if (exact) return exact;
  const tagged = String(value ?? "").match(/^(.*?)\s*[([]\s*([A-Z0-9]{2,8})\s*[)\]]$/);
  return tagged ? (records.get(normalize(tagged[1])) ?? []).filter(({source}) => source === tagged[2]) : [];
}

function pick(records, edition) {
  const rank = (source) => sources.includes(source) ? sources.indexOf(source) : sources.length;
  return records.filter((record) => edition === "2024" || record.edition === edition).sort((a,b) =>
    Number(b.edition === edition)-Number(a.edition === edition) || rank(a.source)-rank(b.source))[0];
}

function editionOf(value) {
  const key = normalize(value);
  if (/\b(2024|revised|xphb)\b/.test(key) || key === "5 2") return "2024";
  if (/\b(2014|classic|phb)\b/.test(key) || key === "5 1") return "2014";
  return "";
}

function parseClasses(character, edition) {
  const parts = String(character.characterClass ?? "").split(/\s*[/+|,]\s*|\s+and\s+/i).filter(Boolean);
  return parts.map((part) => {
    const name = normalize(part);
    const options = [...library.classes.entries()].filter(([key]) => ` ${name} `.includes(` ${key} `));
    if (options.length !== 1) return null;
    const rules = pick(options[0][1],edition);
    if (!rules) return null;
    const selectedSubclass = character.sheetEdits?.subclasses?.[classKey(rules)];
    const subclass = rules.subclasses.find((entry) => selectedSubclass ? subclassKey(entry) === selectedSubclass : [entry.name,entry.shortName].some((value) => {
        const key = normalize(value);
        return key.length > 2 && ` ${name} `.includes(` ${key} `);
    }));
    const explicit = Number(name.match(/(?:^| )(\d+)$/)?.[1]);
    const chosenLevel = character.sheetEdits?.classLevels?.[classKey(rules)];
    const level = chosenLevel ?? (parts.length === 1 && levelNumber(character.level) ? character.level : levelNumber(explicit) ? explicit : null);
    return {rules,subclass,level};
  });
}

function commonFlags(groups, accept = () => true) {
  if (!groups?.length) return [];
  return Object.entries(groups[0]).filter(([key,value]) => value === true && accept(key) &&
    groups.every((group) => group[key] === true)).map(([key]) => key);
}

function fixed(record, field) {
  return commonFlags(record?.[field],(key) => !/^any[A-Z]|^(any|choose|other|special|custom)$/.test(key));
}

function describeChoice(record, field, label) {
  const entries = record?.[field];
  if (!entries?.length) return "";
  const options = unique(entries.flatMap((group) => Object.entries(group).flatMap(([key,value]) => {
    if (key === "choose" && value?.from?.length) return `Choose ${value.count ?? value.amount ?? 1} from ${value.from.map(displayName).join(", ")}`;
    if (/^any[A-Z]|^any$/.test(key) && (value === true || Number.isInteger(value))) {
      const kind = key.slice(3).replace(/[A-Z]/g,(letter) => " "+letter.toLowerCase()).trim();
      return `Choose ${value === true ? 1 : value}${kind ? " " + kind : ""}`;
    }
    return [];
  })));
  return options.length ? `${label} · ${options.join(" or ")}` : "";
}

function displayName(value) {
  const [name,variant] = value.split("|")[0].split(";");
  return title(name) + (variant ? ` (${title(variant.trim())})` : "");
}

function standardPools(classes, verified, edition) {
  if (!verified) return {};
  if (classes.length === 1) {
    const [first] = classes;
    const row = (first.subclass?.slots?.length ? first.subclass.slots : first.rules.slots)[first.level-1];
    return row?.pact ? {pact:row.pact} : {slots:row ?? []};
  }
  const progressions = classes.map(({rules,subclass,level}) => {
    const options = subclass?.casterProgression ?? rules.casterProgression;
    if (!options && !subclass && level >= 3 && ["Rogue","Fighter"].includes(rules.name)) return "unknown";
    return options ?? "none";
  });
  if (progressions.includes("unknown") || progressions.includes("pact")) return {};
  const casting = classes.filter((_,i) => progressions[i] !== "none");
  if (casting.length < 2) return casting.length ? standardPools(casting,true,edition) : {};
  const effectiveLevel = classes.reduce((sum,{level},i) => {
    switch (progressions[i]) {
      case "full": return sum+level;
      case "1/2": return sum+(edition === "2024" ? Math.ceil(level/2) : Math.floor(level/2));
      case "artificer": return sum+Math.ceil(level/2);
      case "1/3": return sum+Math.floor(level/3);
      default: return sum;
    }
  },0);
  return {slots:pick(library.classes.get("wizard") ?? [],edition)?.slots[effectiveLevel-1] ?? []};
}

export function enrichCharacter(record) {
  const raw = sheetOverrides(record);
  const character = {...raw};
  const speciesOptions = candidates(raw.species,library.species);
  const backgroundOptions = candidates(raw.background,library.backgrounds);
  const edition = editionOf(raw.rulesEditionOverride ?? raw.rulesEdition) ||
    ([speciesOptions,backgroundOptions].some((group) => group.length && group.every((record) => record.edition === "2024")) ? "2024" : "2014");
  const species = pick(speciesOptions,edition);
  const background = pick(backgroundOptions,edition);
  const classes = parseClasses(raw,edition);
  const qualified = classes.filter(Boolean);
  const single = classes.length === 1 ? classes[0] : null;
  const total = qualified.reduce((sum,{level}) => sum+(level ?? 0),0);
  const verified = classes.length > 0 && qualified.length === classes.length && qualified.every(({level}) => levelNumber(level)) &&
    levelNumber(total) && (!filled(raw.level) || raw.level === total) && new Set(qualified.map(({rules}) => rules.name)).size === qualified.length;
  const importedStartingClass = qualified.find(({rules}) => normalize(rules.name) === normalize(raw.startingClass));
  const starting = single ?? importedStartingClass;
  const derived = new Set();
  const fill = (key, value, label) => {
    if (!filled(character[key]) && filled(value)) {character[key] = value; derived.add(label);}
  };
  if (verified) fill("level",total,"Character level");
  const level = character.level;
  fill("proficiency",levelNumber(level) ? 2 + Math.floor((level-1)/4) : null,"Proficiency bonus");
  const pb = character.proficiency;
  const walk = typeof species?.speed === "number" ? species.speed : species?.speed?.walk;
  if (Number.isFinite(walk)) fill("speed",String(walk),"Walking speed");

  const featRefs = fixed(background,"feats");
  const feats = unique([...featRefs.map(displayName),...(raw.feats ?? []),...selectedFeatNames(raw)]);
  const speciesTraits = species?.traits ?? [];
  character.abilities = (raw.abilities ?? []).map((ability) => {
    const modifier = ability.modifier ?? (Number.isFinite(ability.score) ? Math.floor((ability.score-10)/2) : null);
    if (modifier != null && ability.modifier == null) derived.add("Ability modifiers");
    const proficient = starting?.rules.proficiency?.includes(ability.abbr.toLowerCase());
    const save = ability.save ?? (modifier != null && starting && (!proficient || Number.isFinite(pb)) ? modifier + (proficient ? pb : 0) : null);
    if (save != null && ability.save == null) derived.add("Saving throws");
    return {...ability,modifier,save};
  });
  const mod = Object.fromEntries(character.abilities.map((ability) => [ability.abbr.toLowerCase(),ability.modifier]));
  const wornAC = wornArmorClass(raw.sheetEdits?.armor,mod.dex,raw.sheetEdits?.shield);
  if (raw.sheetEdits?.armor && raw.sheetEdits.ac == null && wornAC !== null) {
    character.ac = wornAC;
    derived.add("Armor Class from worn equipment");
  }
  if (Number.isFinite(mod.dex)) {
    const jack = edition === "2014" && qualified.some(({rules,level}) => rules.name === "Bard" && level >= 2);
    const alert = edition === "2024" && feats.some((name) => normalize(name) === "alert");
    if ((!jack && !alert) || Number.isFinite(pb)) {
      fill("initiative",mod.dex + (jack ? Math.floor(pb/2) : 0) + (alert ? pb : 0),"Initiative");
    }
  }

  const skillChoices = raw.sheetEdits?.training ?? {};
  const skillTraining = unique([...fixed(species,"skillProficiencies"),...fixed(background,"skillProficiencies"),
    ...commonFlags(starting?.rules.skills,(key) => key in skills),...(raw.skillProficiencies ?? []).map(normalize),
    ...Object.keys(skillChoices)]).filter((skill) => skillChoices[skill] !== 0);
  const importedSkills = new Map((raw.skills ?? []).map((skill) => [normalize(skill.name),skill]));
  for (const [name, ability] of Object.entries(skills)) {
    const imported = importedSkills.get(name);
    const base = mod[ability];
    const choice = skillChoices[name];
    if (choice == null && Number.isFinite(imported?.bonus)) continue;
    if (choice == null && !Number.isFinite(base) && !skillTraining.includes(name)) continue;
    const rank = choice ?? (skillTraining.includes(name) ? 1 : null);
    const bonus = rank != null && Number.isFinite(base) && (rank === 0 || Number.isFinite(pb)) ? base + (rank ? rank*pb : 0) : null;
    if (bonus != null) derived.add(choice == null ? "Fixed skill bonuses" : "Chosen skill bonuses");
    importedSkills.set(name,{...imported,name:imported?.name ?? title(name),bonus,base:rank == null ? base : null});
  }
  character.skills = [...importedSkills.values()].sort((a,b) => a.name.localeCompare(b.name));
  const perception = importedSkills.get("perception")?.bonus;
  if (Number.isFinite(perception)) fill("passivePerception",10+perception,"Passive Perception");

  const {slots = [],pact} = standardPools(classes,verified,edition);
  const spellLevels = pact ? {[pact[0]]:pact[1]} : Object.fromEntries(slots.map((count,i) => [i+1,count]).filter(([,count]) => count > 0));
  const spellSlots = {...raw.spellSlots};
  for (const [rank,maximum] of Object.entries(spellLevels)) {
    const imported = spellSlots[rank] ?? {};
    if (imported.maximum == null && (raw.sheetEdits?.slots?.[rank]?.current != null || !Number.isFinite(imported.current) || imported.current <= maximum)) {
      spellSlots[rank] = {current:imported.current ?? null,maximum};
      derived.add(pact ? "Pact slot capacity" : "Spell slot capacity");
    }
  }
  character.spellSlots = spellSlots;
  const casterAbilities = unique(qualified.filter(({rules,subclass,level}) => level &&
    (subclass?.slots?.[level-1]?.some?.((count) => count > 0) || rules.slots[level-1]?.pact || rules.slots[level-1]?.some?.((count) => count > 0)))
    .map(({rules,subclass}) => subclass?.spellcastingAbility ?? rules.spellcastingAbility));
  if (verified && casterAbilities.length === 1) fill("spellcastingAbility",abilityNames[casterAbilities[0]],"Spellcasting ability");
  const ability = normalize(character.spellcastingAbility).slice(0,3);
  const castingMod = typeof character.spellcastingAbility === "number" ? character.spellcastingAbility : mod[ability];
  if (Number.isFinite(castingMod) && Number.isFinite(pb)) {
    fill("spellDC",8+castingMod+pb,"Spell save DC");
    fill("spellAttack",castingMod+pb,"Spell attack bonus");
  }

  const hitDice = {};
  if (verified) for (const {rules,level} of classes) hitDice[rules.hitDie] = (hitDice[rules.hitDie] ?? 0) + level;
  const resistances = unique(raw.resistances?.length ? raw.resistances : (species?.resist ?? []).filter((entry) => typeof entry === "string"));
  character.resistances = resistances;
  const extraSpeeds = Object.entries(typeof species?.speed === "object" ? species.speed : {}).filter(([mode]) => mode !== "walk")
    .map(([mode,value]) => `${title(mode)} ${value === true ? "equal to walking speed" : Number.isFinite(value) ? value+" ft" :
      value && Number.isFinite(value.number) ? value.number+" ft (conditional)" : "see species trait"}`);
  const unspecifiedToughness = species?.name === "Dwarf" && species.source === "PHB" ||
    qualified.some(({rules,subclass}) => rules.name === "Sorcerer" && rules.edition === "2014" && !subclass);
  let fixedMaximum = null;
  if (verified && starting && Number.isFinite(mod.con) && !unspecifiedToughness) {
    fixedMaximum = Math.max(1,starting.rules.hitDie+mod.con);
    for (const entry of classes) {
      const gains = entry.level-Number(entry === starting);
      fixedMaximum += gains*Math.max(1,Math.floor(entry.rules.hitDie/2)+1+mod.con);
      if (entry.subclass?.features.some(([required,name]) => required <= entry.level && name === "Draconic Resilience")) {
        fixedMaximum += entry.level;
      }
    }
    if (speciesTraits.includes("Dwarven Toughness")) fixedMaximum += level;
    if (feats.some((name) => normalize(name) === "tough")) fixedMaximum += 2*level;
    if (raw.sheetEdits?.fixedHp && raw.sheetEdits.maxHp == null) {
      character.maxHp = fixedMaximum;
      derived.add("Fixed hit point maximum");
    } else if (single && level === 1 && species && background) fill("maxHp",fixedMaximum,"Starting hit point maximum");
  }
  const sourceNames = unique([species,background,...qualified.map(({rules}) => rules)].filter(Boolean).map(({name,source}) => `${name} (${source})`));
  const classTools = (starting?.rules.tools ?? []).filter((value) => typeof value === "string");
  const toolChoice = (value) => /\b(choice|choose)\b/i.test(value);
  character.rulesDetails = {
    edition,derived:[...derived],sources:sourceNames,wornAC,fixedMaximum,
    size:species?.size?.map((size) => sizeNames[size]).filter(Boolean).join(" or ") || "",
    darkvision:species?.darkvision,extraSpeeds,hitDice,
    baseAC:Number.isFinite(mod.dex) ? 10+mod.dex : null,
    basePerception:character.passivePerception == null && Number.isFinite(mod.wis) ? 10+mod.wis : null,
    resistances,skillTraining:skillTraining.map(title),feats,pact:Boolean(pact),
    speciesSpells:(species?.spells ?? []).filter(([required]) => levelNumber(level) && required <= level),
    languages:unique([...fixed(species,"languageProficiencies"),...fixed(background,"languageProficiencies"),
      ...(edition === "2024" ? ["common"] : []),...(raw.languages ?? [])]).map(displayName),
    tools:unique([...fixed(species,"toolProficiencies"),...fixed(background,"toolProficiencies"),...classTools.filter((value) => !toolChoice(value)),...(raw.tools ?? [])]).map(displayName),
    armor:unique([...fixed(species,"armorProficiencies"),...(starting?.rules.armor ?? []).filter((value) => typeof value === "string")]).map(displayName),
    weapons:unique([...fixed(species,"weaponProficiencies"),...(starting?.rules.weapons ?? []).filter((value) => typeof value === "string")]).map(displayName),
    choices:unique([describeChoice(species,"skillProficiencies","Species skills"),describeChoice(species,"toolProficiencies","Species tools"),
      describeChoice(species,"languageProficiencies","Species languages"),describeChoice(background,"toolProficiencies","Background tools"),
      describeChoice(background,"languageProficiencies","Background languages"),describeChoice(starting?.rules,"skills","Class skills"),
      ...classTools.filter(toolChoice).map((value) => "Class tools · " + value)]),
    features:[
      {name:species?.name,entries:speciesTraits}, {name:background?.name,entries:background?.traits ?? []},
      ...qualified.flatMap(({rules,subclass,level}) => [rules,subclass].filter(Boolean).map((record) => ({
        name:record.name,entries:level == null ? [] : unique(record.features.filter(([required]) => required <= level).map(([,name]) => name)),
      }))),
    ].filter(({entries}) => entries.length),
  };
  const classDetails = buildClassFeatures(character,qualified,mod,pb,edition);
  character.rulesDetails.classDetails = classDetails;
  character.classRules = classDetails.mechanics;
  character.resources = Object.fromEntries(Object.entries(classDetails.pools).map(([key,pool]) =>
    [key,{...pool,current:Math.min(pool.maximum,raw.sheetEdits?.resources?.[key] ?? pool.maximum)}]));
  const unarmoredMonk = classDetails.traits.includes("Unarmored Defense") && classDetails.mechanics.levels.Monk &&
    (!raw.sheetEdits?.armor || raw.sheetEdits.armor === "unarmored") && !raw.sheetEdits?.shield;
  if (unarmoredMonk && Number.isFinite(mod.dex) && Number.isFinite(mod.wis)) {
    if (!filled(raw.ac) || raw.sheetEdits?.armor === "unarmored" && raw.sheetEdits.ac == null) {
      character.ac = 10+mod.dex+mod.wis;
      derived.add("Monk Unarmored Defense");
    }
  }
  if (!filled(raw.speed) && Number.isFinite(walk) && unarmoredMonk) character.speed = String(walk+classDetails.mechanics.movement);
  character.classRules.unarmoredMonk = Boolean(unarmoredMonk);
  character.classRules.bladesongAllowed = !raw.sheetEdits?.shield && !["hide","chain-shirt","scale-mail","breastplate","half-plate","ring-mail","chain-mail","splint","plate"].includes(raw.sheetEdits?.armor);
  character.rulesDetails.derived = [...derived];
  for (const choice of classDetails.choices) {
    if (!["skills","expertise"].includes(choice.kind) || !raw.sheetEdits?.featureChoices?.[choice.id]) continue;
    for (const name of choice.selected) {
      if (!(name in skills) || !Number.isFinite(mod[skills[name]]) || !Number.isFinite(pb)) continue;
      const skill = character.skills.find((entry) => normalize(entry.name) === name);
      if (skill) {skill.bonus = mod[skills[name]]+(choice.kind === "expertise" ? 2 : 1)*pb;skill.base=null;}
    }
  }
  for (const skill of character.skills) {
    if (Number.isFinite(skill.bonus) || !Number.isFinite(skill.base)) continue;
    if (classDetails.traits.includes("Jack of All Trades")) skill.bonus = skill.base+Math.floor(pb/2);
  }
  if (raw.passivePerception == null) {
    const trained = character.skills.find((skill) => normalize(skill.name) === "perception")?.bonus;
    if (Number.isFinite(trained)) character.passivePerception = 10+trained;
  }
  character.spells = applySpellChoices(character.spells,classDetails,raw.sheetEdits);
  for (const grant of classChosenSpells(classDetails)) {
    const existing = character.spells.find((spell) => ruleKey(spell.name.split(" (")[0]) === ruleKey(grant.name));
    if (!existing) character.spells.push(grant);
    else if (grant.castUsage) Object.assign(existing,{castUsage:grant.castUsage,castingAbility:grant.castingAbility,grantedBy:grant.grantedBy});
  }
  return character;
}
