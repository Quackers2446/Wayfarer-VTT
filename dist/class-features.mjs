import {ruleKey} from "./rules-library.mjs";

let database = {optionalFeatures:[],feats:[],spells:[]};
const idOf = (record) => record.name.toLowerCase()+"|"+record.source.toLowerCase();
const words = (text) => String(text ?? "").replace(/\{@\w+ ([^}]+)\}/g,(_,body) => body.split("|")[0]);
const unique = (values) => [...new Set(values)];

export function loadFeatureData(data) {database = data;}
export const classKey = (record) => idOf(record);
export const subclassKey = (record) => idOf(record);
export function selectedFeatNames(character) {
  const selected = new Set(Object.values(character.sheetEdits?.featureChoices ?? {}).flat());
  return database.feats.filter((feat) => selected.has(idOf(feat))).map((feat) => feat.name);
}

function progressionAt(progression,level) {
  if (Array.isArray(progression)) return progression[level-1] ?? 0;
  const levels = Object.keys(progression ?? {}).map(Number).filter((required) => required <= level).sort((a,b) => b-a);
  return progression?.[levels[0]] ?? 0;
}

function tableValues(record,level) {
  const result = {};
  for (const table of record.classTableGroups ?? record.subclassTableGroups ?? []) {
    const row = table.rows?.[level-1];
    if (!row) continue;
    for (const [index,label] of (table.colLabels ?? []).entries()) result[words(label)] = row[index];
  }
  return result;
}

function nestedEntries(entries) {
  const found = [];
  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "options") continue;
    if (entry.name) found.push(entry);
    if (Array.isArray(entry.entries)) found.push(...nestedEntries(entry.entries));
    if (Array.isArray(entry.items)) found.push(...nestedEntries(entry.items));
  }
  return found;
}

function inlineOptions(feature) {
  const result = [];
  const visit = (node,path) => {
    if (Array.isArray(node)) return node.forEach((item,index) => visit(item,path+"."+index));
    if (!node || typeof node !== "object") return;
    if (node.type === "options" && node.entries?.length && node.count) {
      const options = node.entries.filter((entry) => typeof entry === "object").map((entry,index) => ({
        id:entry.uid ?? (entry.optionalfeature ? entry.optionalfeature.toLowerCase() : feature.id+"."+path+"."+index),
        name:entry.name ?? entry.optionalfeature?.split("|")[0] ?? "Option "+(index+1),entries:entry.entries ?? [],
      }));
      if (options.length) result.push({id:feature.id+path,label:feature.name,level:feature.level,count:node.count,kind:"options",options});
    }
    for (const [key,value] of Object.entries(node)) if (key !== "data") visit(value,path+"."+key);
  };
  visit(feature.entries,"");
  return result;
}

function sourceAllowed(record,edition) {
  return edition === "2024" || !["XPHB","EFA"].includes(record.source);
}

function choiceInstruction(entries) {
  const strings = [];
  const walk = (node) => {
    if (typeof node === "string") strings.push(words(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && node.type !== "options") walk(node.entries ?? node.items);
  };
  walk(entries);
  return strings.find((text) => /\b(?:choose (?:a|an|one|two|three|four|six|any)|of your choice|select (?:a|an|one|two))\b/i.test(text) &&
    /\b(?:proficien|language|favored enemy|favored terrain|artisan|fighting style|maneuver|invocation|metamagic|musical instrument|weapon type)\b/i.test(text));
}

function optionalAllowed(record,level,rules) {
  if (!record.prerequisite?.length) return true;
  return record.prerequisite.some((prerequisite) => {
    const required = prerequisite.level;
    if (typeof required === "number") return level >= required;
    return !required?.class || required.class.name.toLowerCase() !== rules.name.toLowerCase() || level >= required.level;
  });
}

function selections(character,choice) {
  return (character.sheetEdits?.featureChoices?.[choice.id] ?? []).filter((id) => choice.options.some((option) => option.id === id));
}

function spellFilter(spell,filter) {
  return String(filter).split("|").every((piece) => {
    const [name,values] = piece.split("=");
    const options = String(values ?? "").split(";").map((value) => value.toLowerCase());
    if (name.toLowerCase() === "level") return options.includes(String(spell.level));
    if (name.toLowerCase() === "school") return options.includes(spell.school?.toLowerCase());
    if (name.toLowerCase() === "class") return Object.values(spell.classes ?? {}).some((classes) =>
      Object.keys(classes).some((name) => options.includes(name.toLowerCase())));
    return true;
  });
}

function additionalSpellChoices(character,sources,edition) {
  const choices = [], grants = [];
  const find = (reference) => {
    const [name,source] = reference.split("#")[0].split("|");
    return database.spells.find((spell) => ruleKey(spell.name) === ruleKey(name) &&
      (source ? spell.source.toLowerCase() === source.toLowerCase() : spell.edition === edition));
  };
  const catalog = database.spells.filter((spell) => sourceAllowed(spell,edition));
  const visited = new Set();
  for (const source of sources) {
    const sourceId = source.id ?? idOf(source);
    if (visited.has(sourceId)) continue;
    visited.add(sourceId);
    const branches = source.additionalSpells ?? [];
    let selected = branches;
    if (branches.length > 1) {
      const id = sourceId+"|spell-branch";
      const options = branches.map((branch,index) => ({id:String(index),name:branch.name ?? "Spell option "+(index+1)}));
      const saved = character.sheetEdits?.featureChoices?.[id] ?? [];
      choices.push({id,label:source.name+" · spell option",level:1,count:1,kind:"spell-branch",options,selected:saved,
        remaining:saved.length ? 0 : 1});
      selected = branches.filter((_,index) => saved.includes(String(index)));
    }
    for (const [index,branch] of selected.entries()) {
      const ability = branch.ability && branch.ability !== "inherit" && typeof branch.ability === "string" ? branch.ability : undefined;
      const visit = (node,path,castUsage) => {
        if (typeof node === "string") {
          const spell = find(node);
          if (spell) grants.push({...spell,castUsage,castingAbility:ability,grantedBy:source.name});
        } else if (Array.isArray(node)) node.forEach((value,index) => visit(value,path+"."+index,castUsage));
        else if (node && typeof node === "object") {
          if (node.choose) {
            const from = node.choose.from;
            const options = from ? from.map(find).filter(Boolean) : catalog.filter((spell) => spellFilter(spell,node.choose));
            const id = sourceId+"|spells|"+path;
            const selected = character.sheetEdits?.featureChoices?.[id] ?? [];
            const count = node.count ?? node.choose.count ?? 1;
            const choicesHere = options.map((spell) => ({id:idOf(spell),...spell}));
            choices.push({id,label:source.name+" · granted spells",level:1,count,kind:"granted-spells",options:choicesHere,
              selected,remaining:Math.max(0,count-selected.length)});
            for (const spell of choicesHere.filter((spell) => selected.includes(spell.id))) {
              grants.push({...spell,castUsage,castingAbility:ability,grantedBy:source.name});
            }
          } else {
            for (const [key,value] of Object.entries(node)) {
              if (key === "daily" || key === "rest") {
                for (const [uses,entries] of Object.entries(value)) {
                  const count = Number(uses.replace("e",""));
                  if (Number.isFinite(count)) visit(entries,path+"."+key+"."+uses,{maximum:count,rest:key === "rest" ? "short" : "long"});
                }
              } else visit(value,path+"."+key,castUsage);
            }
          }
        }
      };
      for (const type of ["known","prepared","innate"]) {
        for (const [required,entries] of Object.entries(branch[type] ?? {})) {
          if (/^\d+$/.test(required) && Number(required) > character.level) continue;
          if (!/^\d+$/.test(required) && required !== "_") continue;
          visit(entries,index+"."+type+"."+required,type === "innate" ? {atWill:true} : undefined);
        }
      }
    }
  }
  return {choices,grants};
}

export function buildClassFeatures(character,classes,mod,pb,edition) {
  const details = [];
  const choices = [];
  const features = [];
  const grantedSpells = [];
  const traitNames = new Set();
  const levels = {};
  const tables = {};
  const pools = {};
  for (const {rules,subclass,level} of classes) {
    const key = classKey(rules);
    details.push({id:key,name:rules.name,source:rules.source,level,subclass:subclass?.name,
      subclassId:subclass ? subclassKey(subclass) : "",subclassTitle:rules.subclassTitle ?? "Subclass",
      subclasses:rules.subclasses.map((entry) => ({id:subclassKey(entry),name:entry.name,source:entry.source})),
      tables:tableValues(rules,level)});
    if (!level) continue;
    levels[rules.name] = level;
    Object.assign(tables,tableValues(rules,level),subclass ? tableValues(subclass,level) : {});
    const unlocked = (rules.featureDetails ?? []).filter((feature) => feature.level <= level);
    const subFeatures = (subclass?.featureDetails ?? []).filter((feature) => feature.level <= level);
    for (const feature of [...unlocked,...subFeatures]) {
      const optionalId = "enable|"+feature.id;
      if (feature.optional) {
        choices.push({id:optionalId,label:feature.name,level:feature.level,count:1,optional:true,kind:"optional",
          options:[{id:feature.id,name:feature.name+" ("+feature.source+")",entries:feature.entries}]});
        if (!character.sheetEdits?.featureChoices?.[optionalId]?.includes(feature.id)) continue;
      }
      features.push({...feature,className:rules.name});
      traitNames.add(feature.name);
      for (const nested of nestedEntries(feature.entries)) traitNames.add(nested.name);
      choices.push(...inlineOptions(feature));
      if (feature.name === "Ability Score Improvement") {
        choices.push({id:feature.id,label:rules.name+" level "+feature.level+" · Ability score improvement or feat",
          level:feature.level,count:1,kind:"advancement",options:[{id:"asi",name:"Ability score improvement (already included in scores)"},
            ...database.feats.filter((record) => sourceAllowed(record,edition)).map((record) => ({id:idOf(record),...record}))]});
      } else if (feature.name === "Expertise") {
        const options = character.skills.filter((skill) => Number.isFinite(skill.bonus) &&
          skill.bonus >= (mod[skillAbility(skill.name)] ?? 0)+pb).map((skill) => ({id:ruleKey(skill.name),name:skill.name}));
        if (rules.name === "Rogue") options.push({id:"thieves tools",name:"Thieves’ tools"});
        const choice = {id:feature.id,label:rules.name+" level "+feature.level+" · Expertise",level:feature.level,count:2,kind:"expertise",options};
        const inferred = character.skills.filter((skill) => Number.isFinite(skill.bonus) &&
          skill.bonus === (mod[skillAbility(skill.name)] ?? 0)+2*pb).map((skill) => ruleKey(skill.name));
        choice.inferred = inferred.slice(feature.level >= 6 ? 2 : 0,feature.level >= 6 ? 4 : 2);
        choices.push(choice);
      } else if (!["Spellcasting","Pact Magic","Martial Arts","Ki","Monastic Tradition","Roguish Archetype","Bard College",
        "Otherworldly Patron","Arcane Tradition","Ranger Archetype","Fighting Style","Eldritch Invocations","Pact Boon"].includes(feature.name)) {
        const instruction = choiceInstruction(feature.entries);
        if (instruction && !inlineOptions(feature).length) {
          choices.push({id:feature.id+"|choice",label:feature.name+" · recorded choice",level:feature.level,count:1,kind:"record",
            options:[],instruction});
        }
      }
    }
    const skillFrom = rules.skills?.find((entry) => entry.choose)?.choose;
    if (skillFrom) {
      const count = skillFrom.count ?? skillFrom.amount ?? 1;
      const inferred = character.skills.filter((skill) => skillFrom.from.includes(ruleKey(skill.name)) &&
        Number.isFinite(skill.bonus) && skill.bonus >= (mod[skillAbility(skill.name)] ?? 0)+pb)
        .map((skill) => ruleKey(skill.name)).slice(0,count);
      choices.push({id:key+"|skills",label:rules.name+" starting skills",level:1,count,kind:"skills",
        options:skillFrom.from.map((name) => ({id:name,name})),inferred});
    }
    const fromAnySkill = rules.skills?.find((entry) => entry.any)?.any;
    if (fromAnySkill) choices.push({id:key+"|skills",label:rules.name+" starting skills",level:1,count:fromAnySkill,kind:"skills",
      options:Object.keys(skillAbilities).map((name) => ({id:name,name}))});
    for (const record of [rules,subclass].filter(Boolean)) {
      for (const progress of record.optionalfeatureProgression ?? []) {
        const count = progressionAt(progress.progression,level);
        if (!count) continue;
        const options = database.optionalFeatures.filter((entry) => sourceAllowed(entry,edition) &&
          entry.featureType?.some((type) => progress.featureType.includes(type)) && optionalAllowed(entry,level,rules))
          .map((entry) => ({id:idOf(entry),...entry}));
        choices.push({id:key+"|"+progress.name,label:progress.name,level,count,kind:"optional-features",options});
      }
      for (const addition of record.additionalSpells ?? []) {
        for (const [required,entries] of Object.entries(addition.prepared ?? {})) {
          if (/^\d+$/.test(required) && Number(required) <= level) {
            for (const name of Array.isArray(entries) ? entries : []) {
              if (typeof name === "string") grantedSpells.push(name.split("|")[0]);
            }
          }
        }
      }
    }
    const spellList = subclass?.casterProgression && !rules.casterProgression ? "Wizard" : rules.name;
    const slots = subclass?.slots?.length ? subclass.slots : rules.slots;
    const pool = slots[level-1];
    const maxRank = pool?.pact?.[0] ?? (Array.isArray(pool) ? pool.reduce((rank,count,index) => count > 0 ? index+1 : rank,0) : 0);
    const cantrips = (subclass?.cantripProgression ?? rules.cantripProgression)?.[level-1] ?? 0;
    const known = (subclass?.spellsKnownProgression ?? rules.spellsKnownProgression)?.[level-1];
    const catalog = database.spells.filter((spell) => sourceAllowed(spell,edition) &&
      (spell.classes?.[rules.source]?.[spellList] || spell.classes?.PHB?.[spellList]));
    for (const feature of [...unlocked,...subFeatures]) {
      if (!/Magical Secrets/.test(feature.name)) continue;
      choices.push({id:feature.id+"|spells",label:feature.name+" · level "+feature.level,level:feature.level,count:2,kind:"spells",
        options:database.spells.filter((spell) => sourceAllowed(spell,edition) && spell.level <= maxRank)
          .map((spell) => ({id:idOf(spell),...spell}))});
    }
    for (const [type,count] of [["cantrips",cantrips],["spells",known]]) {
      if (!count || !catalog.length) continue;
      const options = catalog.filter((spell) => type === "cantrips" ? spell.level === 0 : spell.level > 0 && spell.level <= maxRank)
        .map((entry) => ({id:idOf(entry),...entry}));
      const imported = character.spells.filter((spell) => (type === "cantrips" ? spell.level === 0 : spell.level > 0))
        .flatMap((spell) => options.find((option) => ruleKey(spell.name).startsWith(ruleKey(option.name)))?.id ?? []);
      choices.push({id:key+"|"+type,label:rules.name+" "+type+" known",level,count,kind:"spells",options,inferred:unique(imported)});
    }
    if (maxRank && !known && !subclass?.spellsKnownProgression && catalog.length) {
      const count = Math.max(1,level+(mod[rules.spellcastingAbility] ?? 0));
      choices.push({id:key+"|prepared",label:rules.name+" prepared spells",level,count,kind:"prepared",optional:true,
        options:catalog.filter((spell) => spell.level > 0 && spell.level <= maxRank).map((entry) => ({id:idOf(entry),...entry})),
        inferred:character.spells.filter((entry) => entry.prepared).flatMap((spell) =>
          catalog.find((entry) => ruleKey(spell.name).startsWith(ruleKey(entry.name))) ? idOf(catalog.find((entry) =>
            ruleKey(spell.name).startsWith(ruleKey(entry.name)))) : [])});
    }
  }
  const selectedFeatures = [];
  for (const choice of choices) {
    const saved = character.sheetEdits?.featureChoices?.[choice.id];
    choice.selected = saved ? selections(character,choice) : choice.inferred ?? [];
    choice.note = character.sheetEdits?.featureNotes?.[choice.id] ?? "";
    choice.remaining = choice.kind === "record" ? Number(!choice.note) : Math.max(0,choice.count-choice.selected.length);
    if (["optional-features","options","advancement"].includes(choice.kind)) {
      for (const option of choice.options.filter((option) => choice.selected.includes(option.id))) {
        if (option.entries) {
          selectedFeatures.push({...option,level:choice.level});
          traitNames.add(option.name);
          for (const nested of nestedEntries(option.entries)) traitNames.add(nested.name);
        }
      }
    }
  }
  const grantData = additionalSpellChoices(character,
    [...classes.flatMap(({rules,subclass}) => [rules,subclass].filter(Boolean)),...selectedFeatures],edition);
  choices.push(...grantData.choices);
  const martial = tables["Martial Arts"]?.toRoll?.[0];
  const sneak = tables["Sneak Attack"]?.toRoll?.[0];
  if (traitNames.has("Ki") && Number.isFinite(tables["Ki Points"])) pools.ki = {name:"Ki",maximum:tables["Ki Points"],rest:"short"};
  if (traitNames.has("Bardic Inspiration")) pools.inspiration = {name:"Bardic Inspiration",maximum:Math.max(1,mod.cha ?? 0),
    rest:traitNames.has("Font of Inspiration") ? "short" : "long"};
  if (traitNames.has("Second Wind")) pools.secondWind = {name:"Second Wind",maximum:1,rest:"short"};
  if (traitNames.has("Action Surge")) pools.actionSurge = {name:"Action Surge",maximum:levels.Fighter >= 17 ? 2 : 1,rest:"short"};
  if (traitNames.has("Bladesong")) pools.bladesong = {name:"Bladesong",maximum:pb,rest:"long"};
  const rage = tables["Rages"];
  if (traitNames.has("Rage") && Number.isFinite(rage)) pools.rage = {name:"Rage",maximum:rage,rest:"long"};
  for (const [label,maximum] of Object.entries(tables)) {
    if (!Number.isFinite(maximum) || maximum <= 0 || !/points|uses|superiority dice|psi dice/i.test(label) || label === "Ki Points") continue;
    const key = ruleKey(label).replaceAll(" ","-");
    pools[key] = {name:label,maximum,rest:/superiority|psi/i.test(label) ? "short" : "long"};
  }
  const extraAttack = features.some((feature) => /^Extra Attack/.test(feature.name)) ||
    features.some((feature) => nestedEntries(feature.entries).some((entry) => entry.name === "Extra Attack"));
  const fighterSwings = features.some((entry) => entry.name === "Extra Attack (3)") ? 4 :
    features.some((entry) => entry.name === "Extra Attack (2)") ? 3 : 2;
  return {classes:details,features:[...features,...selectedFeatures],choices,pools,grantedSpells,spellGrants:grantData.grants,traits:[...traitNames],
    mechanics:{levels,edition,traits:[...traitNames],martialDie:martial?.faces,sneakDice:sneak?.number,
      movement:tables["Unarmored Movement"]?.value ?? 0,swings:extraAttack ? fighterSwings : 1,
      kiDC:Number.isFinite(mod.wis) && Number.isFinite(pb) ? 8+pb+mod.wis : null,
      inspirationDie:levels.Bard >= 15 ? 12 : levels.Bard >= 10 ? 10 : levels.Bard >= 5 ? 8 : 6,
      rageDamage:tables["Rage Damage"],resources:pools,pact:classes.some(({rules}) => rules.casterProgression === "pact")}};
}

export function classChosenSpells(details) {
  const result = details.choices.filter((choice) => choice.kind === "spells" || choice.kind === "prepared")
    .flatMap((choice) => choice.options.filter((option) => choice.selected.includes(option.id)))
    .map((spell) => ({name:spell.name,level:spell.level,prepared:true,source:spell.source,grantedByClass:true}));
  for (const name of details.grantedSpells) {
    const spell = database.spells.find((record) => record.name.toLowerCase() === name.toLowerCase() && record.edition === "2014");
    if (spell) result.push({name:spell.name,level:spell.level,prepared:true,source:spell.source,grantedByClass:true});
  }
  for (const spell of details.spellGrants ?? []) {
    result.push({name:spell.name,source:spell.source,level:spell.level,prepared:true,castUsage:spell.castUsage,
      castingAbility:spell.castingAbility,grantedByClass:true,grantedBy:spell.grantedBy});
  }
  return result;
}

export function applySpellChoices(spells,details,edits) {
  const chosen = details.choices.filter((choice) => ["spells","prepared"].includes(choice.kind) && edits?.featureChoices?.[choice.id]);
  return spells.filter((spell) => {
    const candidates = chosen.filter((choice) => choice.options.some((option) => ruleKey(spell.name).startsWith(ruleKey(option.name))));
    return !candidates.length || candidates.some((choice) => choice.selected.some((id) =>
      choice.options.some((option) => option.id === id && ruleKey(spell.name).startsWith(ruleKey(option.name)))));
  });
}

const skillAbilities = {
  acrobatics:"dex","animal handling":"wis",arcana:"int",athletics:"str",deception:"cha",history:"int",
  insight:"wis",intimidation:"cha",investigation:"int",medicine:"wis",nature:"int",perception:"wis",
  performance:"cha",persuasion:"cha",religion:"int","sleight of hand":"dex",stealth:"dex",survival:"wis",
};
function skillAbility(name) {return skillAbilities[ruleKey(name)];}
