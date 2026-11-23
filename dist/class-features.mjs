import {ruleKey} from "./rules-library.mjs";
import {choiceValues, preparedCount, prerequisiteProblems, sourceAllowed, sourceProficiencies} from "./class-choice-rules.mjs";
import {additionalSpellChoices} from "./class-spell-choices.mjs";

let database = {optionalFeatures:[],feats:[],spells:[]};
const idOf = (record) => record.name.toLowerCase()+"|"+record.source.toLowerCase();
const words = (text) => String(text ?? "").replace(/\{@\w+ ([^}]+)\}/g,(_,body) => body.split("|")[0]);
const unique = (values) => [...new Set(values)];
const sameSpell = (spell,option) => ruleKey(spell.name.split(" (")[0]) === ruleKey(option.name);

export function loadFeatureData(data) {database = data;}
export const classKey = (record) => idOf(record);
export const subclassKey = (record) => idOf(record);
export function pactMagicResource(level,edition="2014") {
  const rules=database.classes?.find(record=>record.name==="Warlock" && record.edition===edition);
  const pact=rules?.slots[level-1]?.pact;
  return pact ? {name:"Pact Magic · level "+pact[0],maximum:pact[1],rest:"short",slotLevel:pact[0]} : null;
}
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
        ...entry,id:entry.uid ?? (entry.optionalfeature ? entry.optionalfeature.toLowerCase() : feature.id+"."+path+"."+index),
        name:entry.name ?? entry.optionalfeature?.split("|")[0] ?? "Option "+(index+1),entries:entry.entries ?? [],
      }));
      if (options.length) result.push({id:feature.id+path,label:feature.name,level:feature.level,count:node.count,kind:"options",options});
      return;
    }
    for (const [key,value] of Object.entries(node)) if (key !== "data") visit(value,path+"."+key);
  };
  visit(feature.entries,"");
  return result;
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

export function buildClassFeatures(character,classes,mod,pb,edition) {
  const details = [];
  const choices = [];
  const features = [];
  const grantedSpells = [];
  const traitNames = new Set();
  const levels = {};
  const tables = {};
  const pools = {};
  const grantSources = [...(character.creation?.spellSources ?? [])];
  if(character.creation?.fixedFeats?.length){
    const records=database.feats.filter(f=>character.creation.fixedFeats.includes(idOf(f))).map(f=>{const variant=character.creation.featVariants?.[idOf(f)];return variant?{...f,additionalSpells:f.additionalSpells?.filter(b=>b.name?.toLowerCase().includes(variant))}:f;});
    choices.push({id:'creation|fixed-feats',label:'Origin feats',kind:'options',count:records.length,level:1,options:records.map(f=>({...f,id:idOf(f)})),selected:records.map(idOf),inferred:records.map(idOf)});
  }
  const fixedProficiencies = {skills:[],tools:[],languages:[],weapons:[],armor:[]};
  const starting = classes.length === 1 ? classes[0] : classes.find(({rules}) =>
    ruleKey(rules.name) === ruleKey(character.startingClass ?? ""));
  const collectProficiencies = (source,options) => {
    const result = sourceProficiencies(source,database,character,pb,mod,options);
    choices.push(...result.choices);
    for (const key of Object.keys(fixedProficiencies)) fixedProficiencies[key].push(...result.fixed[key]);
  };
  for (const {rules,subclass,level} of classes) {
    const key = classKey(rules);
    details.push({id:key,name:rules.name,source:rules.source,level,subclass:subclass?.name,
      subclassId:subclass ? subclassKey(subclass) : "",subclassTitle:rules.subclassTitle ?? "Subclass",
      subclassLevel:Math.min(...(rules.subclasses.flatMap(entry=>entry.featureDetails.map(feature=>feature.level)))),
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
      const progressNames = [rules,subclass].filter(Boolean).flatMap(record=>(record.optionalfeatureProgression ?? []).map(progress=>progress.name));
      const progressTypes=[rules,subclass].filter(Boolean).flatMap(record=>(record.optionalfeatureProgression ?? []).flatMap(progress=>progress.featureType));
      choices.push(...inlineOptions(feature).filter(choice=>!progressNames.some(name=>choice.label.endsWith(name)) &&
        !choice.options.every(option=>option.featureType?.some(type=>progressTypes.includes(type)))));
      collectProficiencies(feature,{level:feature.level,id:feature.id});
      grantSources.push({...feature,grantLevel:level});
      if (feature.name === "Ability Score Improvement") {
        choices.push({id:feature.id,label:rules.name+" level "+feature.level+" · Ability score improvement or feat",
          level:feature.level,count:1,kind:"advancement",options:[{id:"asi",name:"Ability score improvement (already included in scores)"},
            ...database.feats.filter((record) => sourceAllowed(record,edition)).map((record) => ({id:idOf(record),...record}))]});
      } else if (feature.name === "Expertise") {
        const startingSkills=character.sheetEdits?.featureChoices?.[classKey(rules)+'|skills']??[];
        const options = character.skills.filter((skill) => startingSkills.includes(ruleKey(skill.name)) || Number.isFinite(skill.bonus) &&
          skill.bonus >= (mod[skillAbility(skill.name)] ?? 0)+pb).map((skill) => ({id:ruleKey(skill.name),name:skill.name}));
        if (rules.name === "Rogue") options.push({id:"thieves tools",name:"Thieves’ tools"});
        const choice = {id:feature.id,label:rules.name+" level "+feature.level+" · Expertise",level:feature.level,count:2,kind:"expertise",options};
        const inferred = character.skills.filter((skill) => Number.isFinite(skill.bonus) &&
          skill.bonus === (mod[skillAbility(skill.name)] ?? 0)+2*pb).map((skill) => ruleKey(skill.name));
        choice.inferred = inferred.length === choice.count ? inferred : [];
        choices.push(choice);
      } else if (!["Spellcasting","Pact Magic","Martial Arts","Ki","Monastic Tradition","Roguish Archetype","Bard College",
        "Otherworldly Patron","Arcane Tradition","Ranger Archetype","Fighting Style","Eldritch Invocations","Pact Boon"].includes(feature.name)) {
        const instruction = choiceInstruction(feature.entries);
        if (instruction && !inlineOptions(feature).length && (/favored enemy|favored terrain|weapon type|maneuver|metamagic/i.test(instruction) ||
          !choices.some(choice=>choice.id.startsWith(feature.id+"|") && ["skills","tools","languages"].includes(choice.kind)))) {
          choices.push({id:feature.id+"|choice",label:feature.name+" · recorded choice",level:feature.level,count:1,kind:"record",
            options:[],instruction});
        }
      }
    }
    const gained = starting === classes.find(entry=>entry.rules===rules) ? rules : starting ? rules.multiclassing?.proficienciesGained : null;
    const skillFrom = gained?.skills?.find((entry) => entry.choose)?.choose;
    if (skillFrom) {
      const count = skillFrom.count ?? skillFrom.amount ?? 1;
      const inferred = character.skills.filter((skill) => skillFrom.from.includes(ruleKey(skill.name)) &&
        Number.isFinite(skill.bonus) && skill.bonus >= (mod[skillAbility(skill.name)] ?? 0)+pb)
        .map((skill) => ruleKey(skill.name));
      choices.push({id:key+"|skills",label:rules.name+(gained===rules ? " starting skills" : " multiclass skill"),level:1,count,kind:"skills",
        options:skillFrom.from.map((name) => ({id:name,name})),inferred:inferred.length===count ? inferred : []});
    }
    const fromAnySkill = gained?.skills?.find((entry) => entry.any)?.any;
    if (fromAnySkill) choices.push({id:key+"|skills",label:rules.name+" starting skills",level:1,count:fromAnySkill,kind:"skills",
      options:Object.keys(skillAbilities).map((name) => ({id:name,name}))});
    if (gained) collectProficiencies({...gained,name:rules.name,id:key,edition:rules.edition},{level:1,id:key,starting:true});
    for (const record of [rules,subclass].filter(Boolean)) {
      for (const progress of record.optionalfeatureProgression ?? []) {
        const count = progressionAt(progress.progression,level);
        if (!count) continue;
        const options = database.optionalFeatures.filter((entry) => sourceAllowed(entry,edition) &&
          entry.featureType?.some((type) => progress.featureType.includes(type)) && optionalAllowed(entry,level,rules))
          .map((entry) => ({id:idOf(entry),...entry}));
        const aliases=[...unlocked,...subFeatures].filter(feature=>feature.name===progress.name).flatMap(feature=>inlineOptions(feature).map(choice=>choice.id));
        const id=key+"|"+progress.name;
        const previous=choices.find(choice=>choice.id===id);
        if(previous) {previous.count+=count;previous.aliases=unique([...previous.aliases,...aliases]);previous.options=[...new Map([...previous.options,...options].map(option=>[option.id,option])).values()];}
        else choices.push({id,aliases,label:progress.name,level,count,kind:"optional-features",options});
      }
    }
    const spellList = subclass?.casterProgression && !rules.casterProgression ? "Wizard" : rules.name;
    const slots = subclass?.slots?.length ? subclass.slots : rules.slots;
    const pool = slots[level-1];
    const maxRank = pool?.pact?.[0] ?? (Array.isArray(pool) ? pool.reduce((rank,count,index) => count > 0 ? index+1 : rank,0) : 0);
    const sourceGrants=[rules,subclass].filter(Boolean).map(record=>({...record,id:idOf(record),grantLevel:level,maxSpellLevel:maxRank,
      spellcastingAbility:record.spellcastingAbility ?? rules.spellcastingAbility}));
    grantSources.push(...sourceGrants);
    const additional = additionalSpellChoices(character,sourceGrants,edition,database,pb);
    const expandedIds = new Set(additional.expanded.map(idOf));
    const bonusSpellIds = new Set(additional.grants.map(idOf));
    const cantrips = (subclass?.cantripProgression ?? rules.cantripProgression)?.[level-1] ?? 0;
    const known = (subclass?.spellsKnownProgression ?? rules.spellsKnownProgression)?.[level-1];
    const catalog = database.spells.filter((spell) => sourceAllowed(spell,edition) &&
      (spell.classes?.[rules.source]?.[spellList] || spell.classes?.PHB?.[spellList] || expandedIds.has(idOf(spell))));
    for (const feature of [...unlocked,...subFeatures]) {
      if (!/Magical Secrets/.test(feature.name)) continue;
      if ([rules,subclass].some(record=>record?.additionalSpells?.some(addition=>addition.name===feature.name))) continue;
      choices.push({id:feature.id+"|spells",label:feature.name+" · level "+feature.level,level:feature.level,count:2,kind:"spells",
        options:database.spells.filter((spell) => sourceAllowed(spell,edition) && spell.level <= maxRank)
          .map((spell) => ({id:idOf(spell),...spell}))});
    }
    const secretsCount=rules.name==="Bard" ? additional.choices.filter(choice=>choice.grantedBy===rules.name).reduce((sum,choice)=>sum+choice.count,0) : 0;
    for (const [type,count] of [["cantrips",cantrips],["spells",known-secretsCount]]) {
      if (!count || !catalog.length) continue;
      const options = catalog.filter((spell) => !bonusSpellIds.has(idOf(spell)) && (type === "cantrips" ? spell.level === 0 : spell.level > 0 && spell.level <= maxRank))
        .map((entry) => ({id:idOf(entry),...entry}));
      const imported = character.spells.filter((spell) => !spell.grantedBy && (type === "cantrips" ? spell.level === 0 : spell.level > 0))
        .flatMap((spell) => options.find((option) => sameSpell(spell,option))?.id ?? []);
      choices.push({id:key+"|"+type,label:rules.name+" "+type+" known",level,count,kind:"spells",options,inferred:unique(imported),
        castingAbility:subclass?.spellcastingAbility ?? rules.spellcastingAbility});
    }
    const bookMinimum=rules.spellsKnownProgressionFixed?.slice(0,level).reduce((sum,count)=>sum+count,0);
    let book;
    if(bookMinimum && catalog.length) {
      const options=catalog.filter(spell=>spell.level>0 && spell.level<=maxRank).map(spell=>({id:idOf(spell),...spell}));
      const inferred=character.spells.filter(spell=>spell.level>0).flatMap(spell=>options.find(option=>ruleKey(spell.name.split(" (")[0])===ruleKey(option.name))?.id ?? []);
      book={id:key+"|spellbook",label:rules.name+" spellbook · minimum learned",level,count:bookMinimum,minimum:true,kind:"spellbook",options,inferred:unique(inferred),
        castingAbility:rules.spellcastingAbility};
      choices.push(book);
    }
    if (maxRank && !known && !subclass?.spellsKnownProgression && catalog.length) {
      const count = preparedCount(subclass ?? {},level,mod) ?? preparedCount(rules,level,mod);
      if (count == null) continue;
      const learned=book && choiceValues(character,book);
      const options=catalog.filter(spell=>spell.level>0 && spell.level<=maxRank && !bonusSpellIds.has(idOf(spell)) && (!learned || learned.includes(idOf(spell))));
      choices.push({id:key+"|prepared",label:rules.name+" prepared spells",level,count,kind:"prepared",optional:true,
        castingAbility:subclass?.spellcastingAbility ?? rules.spellcastingAbility,
        options:options.map((entry) => ({id:idOf(entry),...entry})),
        inferred:character.spells.filter((entry) => entry.prepared).flatMap((spell) =>
          options.find((entry) => sameSpell(spell,entry)) ? idOf(options.find((entry) =>
            sameSpell(spell,entry))) : [])});
    }
  }
  const selectedFeatures = [];
  const selectedIds=new Set();
  const baseTraits = new Set(traitNames);
  for (const choice of choices) {
    choice.selected = choiceValues(character,choice) ?? choice.inferred ?? [];
    choice.note = character.sheetEdits?.featureNotes?.[choice.id] ?? "";
    choice.remaining = choice.kind === "record" ? Number(!choice.note) : Math.max(0,choice.count-choice.selected.length);
    choice.over = choice.minimum ? 0 : Math.max(0,choice.selected.length-choice.count);
    if (["optional-features","options","advancement"].includes(choice.kind)) {
      for (const option of choice.options.filter((option) => !choice.over && choice.selected.includes(option.id))) {
        if (option.entries && !selectedIds.has(option.id)) {
          selectedIds.add(option.id);
          const selectedFeature={...option,level:choice.level,choiceKind:choice.kind,parentFeature:choice.parentFeature};
          selectedFeatures.push(selectedFeature);
          for(const nestedChoice of inlineOptions(selectedFeature)) if(!choices.some(choice=>choice.id===nestedChoice.id)) choices.push({...nestedChoice,parentFeature:option.id});
          traitNames.add(option.name);
          for (const nested of nestedEntries(option.entries)) traitNames.add(nested.name);
        }
      }
    }
  }
  if (traitNames.has("Dedicated Weapon")) {
    const training=[...(character.rulesDetails?.weapons ?? []),...fixedProficiencies.weapons].map(ruleKey);
    const options=(database.equipment ?? []).filter(item=>sourceAllowed(item,edition) && item.weaponCategory &&
      !item.property?.some(property=>["H","S"].includes(property)) &&
      (training.includes(item.weaponCategory) || training.some(name=>ruleKey(item.name)===name || ruleKey(item.name)+"s"===name)))
      .map(item=>({id:idOf(item),name:item.name,source:item.source}));
    const id="monk|dedicated-weapon";
    const choice={id,label:"Dedicated Weapon · weapon",level:2,count:1,kind:"dedicated-weapon",options};
    choice.selected=choiceValues(character,choice) ?? [];choice.remaining=1-choice.selected.length;choice.note="";
    choices.push(choice);
  }
  const prerequisiteContext={levels,level:character.level,traits:[...traitNames],spells:character.spells,items:character.items ?? [],
    species:character.species,background:character.background,feats:character.rulesDetails?.feats ?? character.feats ?? [],
    scores:Object.fromEntries(character.abilities.map(ability=>[ability.abbr.toLowerCase(),ability.score])),
    canCast:classes.some(({rules,subclass})=>rules.casterProgression || subclass?.casterProgression),
    proficiencies:character.rulesDetails};
  let validSelected=[...selectedFeatures];
  for(let pass=0;pass<=selectedFeatures.length;pass++) {
    prerequisiteContext.traits=[...baseTraits,...validSelected.flatMap(feature=>[feature.name,...nestedEntries(feature.entries).map(entry=>entry.name)])];
    const next=validSelected.filter(feature=>(!feature.parentFeature || validSelected.some(parent=>parent.id===feature.parentFeature)) &&
      !prerequisiteProblems(feature,feature.choiceKind==="advancement" && classes.length===1 ? {...prerequisiteContext,level:feature.level} : prerequisiteContext).length);
    if(next.length===validSelected.length) break;
    validSelected=next;
  }
  traitNames.clear();
  for(const name of [...baseTraits,...validSelected.flatMap(feature=>[feature.name,...nestedEntries(feature.entries).map(entry=>entry.name)])]) traitNames.add(name);
  prerequisiteContext.traits=[...traitNames];
  for (const choice of choices) {
    for (const option of choice.options) {
      const problems=prerequisiteProblems(option,choice.kind==="advancement" && classes.length===1 ? {...prerequisiteContext,level:choice.level} : prerequisiteContext);
      if (problems.length) {option.disabled=true;option.requires=problems.join(", ");}
    }
    choice.invalid=choice.selected.filter(id=>choice.options.some(option=>option.id===id && option.disabled));
  }
  for(const feature of validSelected) collectProficiencies(feature,{level:feature.level,id:feature.id});
  const grantData = additionalSpellChoices(character,[...grantSources,...validSelected],edition,database,pb);
  choices.push(...grantData.choices);
  for (const choice of choices) {
    if (choice.selected) continue;
    choice.selected=choiceValues(character,choice) ?? choice.inferred ?? [];
    choice.remaining=Math.max(0,choice.count-choice.selected.length);choice.over=Math.max(0,choice.selected.length-choice.count);choice.note="";
  }
  const martial = tables["Martial Arts"]?.toRoll?.[0];
  const sneak = tables["Sneak Attack"]?.toRoll?.[0];
  if (traitNames.has("Ki") && Number.isFinite(tables["Ki Points"])) pools.ki = {name:"Ki",maximum:tables["Ki Points"],rest:"short"};
  const pactRow=classes.find(({rules})=>rules.casterProgression==="pact");
  const pact=pactRow?.rules.slots[pactRow.level-1]?.pact;
  if(pact) pools.pactMagic={name:"Pact Magic · level "+pact[0],maximum:pact[1],rest:"short",slotLevel:pact[0]};
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
  const dedicated=choices.find(choice=>choice.kind==="dedicated-weapon");
  const featureCosts=Object.fromEntries([...features,...validSelected].flatMap(feature=>[feature,...nestedEntries(feature.entries)])
    .filter(feature=>feature.consumes).map(feature=>[feature.name,{name:feature.consumes.name,cost:feature.consumes.amount ?? 1}]));
  const inspirationDice=features.filter(feature=>/^Bardic Inspiration/.test(feature.name)).map(feature=>{
    const die=feature.name.match(/\bd(6|8|10|12)\b/) ?? feature.entries.find(entry=>typeof entry==='string' && /\bd6\b/.test(entry))?.match(/\bd(6)\b/);
    return Number(die?.[1] ?? 6);
  });
  return {classes:details,needsStartingClass:classes.length>1 && !starting,features:[...features,...validSelected],choices,pools,grantedSpells,spellGrants:grantData.grants,traits:[...traitNames],fixedProficiencies,
    mechanics:{levels,edition,traits:[...traitNames],martialDie:martial?.faces,sneakDice:sneak?.number,
      movement:tables["Unarmored Movement"]?.value ?? 0,swings:extraAttack ? fighterSwings : 1,
      kiDC:Number.isFinite(mod.wis) && Number.isFinite(pb) ? 8+pb+mod.wis : null,
      inspirationDie:Math.max(6,...inspirationDice),featureCosts,
      dedicatedWeapon:dedicated?.options.find(option=>dedicated.selected.includes(option.id))?.name,
      rageDamage:tables["Rage Damage"],resources:pools,pact:classes.some(({rules}) => rules.casterProgression === "pact")}};
}

export function classChosenSpells(details) {
  const result = details.choices.filter((choice) => ["spells","prepared","spellbook"].includes(choice.kind) && !choice.over)
    .flatMap((choice) => choice.options.filter((option) => choice.selected.includes(option.id)).map(spell=>({name:spell.name,level:spell.level,
      prepared:choice.kind!=="spellbook",source:spell.source,grantedByClass:true,castingAbility:choice.castingAbility})));
  for (const name of details.grantedSpells) {
    const spell = database.spells.find((record) => record.name.toLowerCase() === name.toLowerCase() && record.edition === "2014");
    if (spell) result.push({name:spell.name,level:spell.level,prepared:true,source:spell.source,grantedByClass:true});
  }
  for (const spell of details.spellGrants ?? []) {
    result.push({name:spell.name,source:spell.source,level:spell.level,prepared:true,castUsage:spell.castUsage,
      castingAbility:spell.castingAbility,grantedByClass:true,grantedBy:spell.grantedBy});
  }
  const merged=new Map();
  for(const spell of result) {
    const previous=merged.get(ruleKey(spell.name));
    merged.set(ruleKey(spell.name),previous ? {...previous,...spell,prepared:previous.prepared || spell.prepared} : spell);
  }
  return [...merged.values()];
}

export function applySpellChoices(spells,details,edits) {
  const chosen = details.choices.filter(choice=>["spells","prepared","spellbook"].includes(choice.kind) && edits?.featureChoices?.[choice.id]);
  return spells.flatMap(spell=>{
    const candidates=chosen.filter(choice=>choice.options.some(option=>sameSpell(spell,option)));
    const learned=candidates.filter(choice=>choice.kind!=="prepared");
    const selected=choice=>choice.options.some(option=>choice.selected.includes(option.id) && sameSpell(spell,option));
    if(learned.length && !learned.some(selected)) return [];
    const prepared=candidates.filter(choice=>choice.kind==="prepared");
    return [{...spell,...(prepared.length ? {prepared:prepared.some(selected)} : {})}];
  });
}

const skillAbilities = {
  acrobatics:"dex","animal handling":"wis",arcana:"int",athletics:"str",deception:"cha",history:"int",
  insight:"wis",intimidation:"cha",investigation:"int",medicine:"wis",nature:"int",perception:"wis",
  performance:"cha",persuasion:"cha",religion:"int","sleight of hand":"dex",stealth:"dex",survival:"wis",
};
function skillAbility(name) {return skillAbilities[ruleKey(name)];}
