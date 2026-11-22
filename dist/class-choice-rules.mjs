const key = value => String(value ?? "").toLowerCase().replace(/’/g,"'").trim();
const numberWords = {a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6};
const countOf = text => numberWords[key(text)] ?? Number(text);
export const sourceAllowed = (record,edition) => edition==="2024" || (record.edition!=="2024" && !["XPHB","EFA"].includes(record.source));
export const skillAbilities = {acrobatics:"dex","animal handling":"wis",arcana:"int",athletics:"str",deception:"cha",history:"int",
  insight:"wis",intimidation:"cha",investigation:"int",medicine:"wis",nature:"int",perception:"wis",
  performance:"cha",persuasion:"cha",religion:"int","sleight of hand":"dex",stealth:"dex",survival:"wis"};

export function choiceValues(character,choice) {
  const saved=character.sheetEdits?.featureChoices ?? {};
  const value=saved[choice.id] ?? choice.aliases?.map(id=>saved[id]).find(Boolean);
  return value?.filter(id=>choice.options.some(option=>option.id===id));
}

// Only the arithmetic used by the source's prepared-spells formula is accepted.
export function preparedCount(record,level,mod) {
  if (record.preparedSpellsProgression) return record.preparedSpellsProgression[level-1] ?? 0;
  const formula=record.preparedSpells;
  if (!formula) return null;
  const match=/^<\$level\$>(?:\s*\/\s*(\d+))?\s*\+\s*<\$(\w+)_mod\$>$/.exec(formula);
  if (!match || !Number.isFinite(mod[match[2]])) return null;
  return Math.max(1,Math.floor(level/Number(match[1] || 1))+mod[match[2]]);
}

export function prerequisiteProblems(record,context) {
  if (!record.prerequisite?.length) return [];
  const alternatives=record.prerequisite.map(required=>{
    const problems=[];
    const hasName=(actual,name)=>key(actual).replace(/[^a-z\d]+/g,' ').includes(key(name).replace(/[^a-z\d]+/g,' '));
    if (required.level) {
      const level=typeof required.level==='number' ? required.level : required.level.level;
      const cls=typeof required.level==='object' ? required.level.class?.name : null;
      if ((cls ? context.levels[cls] ?? 0 : context.level) < level) problems.push((cls ? cls+" level " : "Level ")+level);
    }
    if (required.pact && !context.traits.some(name=>key(name)===key("Pact of the "+required.pact))) problems.push("Pact of the "+required.pact);
    if(required.ability && !required.ability.some(alternative=>Object.entries(alternative).every(([ability,minimum])=>
      (context.scores?.[ability] ?? 0)>=minimum))) problems.push(required.ability.map(alternative=>Object.entries(alternative).map(([ability,minimum])=>ability.toUpperCase()+" "+minimum).join(" and ")).join(" or "));
    if(required.race && !required.race.some(race=>hasName(context.species,race.name))) problems.push(required.race.map(race=>race.name).join(" or "));
    if(required.background && !required.background.some(background=>hasName(context.background,background.name ?? background))) problems.push(required.background.map(background=>background.name ?? background).join(" or "));
    for(const feat of required.feat ?? []) {
      const name=feat.split('|')[0];
      if(!context.feats?.some(feat=>key(feat.name ?? feat)===key(name))) problems.push(name);
    }
    for(const feature of required.feature ?? []) if(!context.traits.some(name=>hasName(name,feature))) problems.push(feature);
    if((required.spellcasting || required.spellcasting2020 || required.spellcastingFeature) && !context.canCast) problems.push("Spellcasting");
    if(required.proficiency && !required.proficiency.some(alternative=>Object.entries(alternative).every(([kind,name])=>
      (context.proficiencies?.[kind==='armor' ? 'armor' : 'weapons'] ?? []).some(actual=>hasName(actual,name))))) {
      problems.push(required.proficiency.map(alternative=>Object.values(alternative).join(" and ")).join(" or ")+" proficiency");
    }
    for (const reference of required.spell ?? []) {
      const name=reference.split(/[|#]/)[0];
      if (!context.spells.some(spell=>key(spell.name).replace(/ \(.*/,"")===key(name))) problems.push(name);
    }
    for (const reference of required.optionalfeature ?? []) {
      const name=reference.split('|')[0];
      if (!context.traits.some(trait=>key(trait)===key(name))) problems.push(name);
    }
    for (const reference of required.item ?? []) {
      const name=reference.split('|')[0];
      if (!context.items.some(item=>key(item.name)===key(name))) problems.push(name);
    }
    if (required.otherSummary) problems.push(required.otherSummary.summary ?? required.otherSummary.entry ?? "See source prerequisite");
    return problems;
  });
  return alternatives.some(problems=>!problems.length) ? [] : alternatives.sort((a,b)=>a.length-b.length)[0];
}

export function sourceProficiencies(source,database,character,pb,mod,{level=1,id=source.id,starting=false}={}) {
  const choices=[],fixed={skills:[],tools:[],languages:[],weapons:[],armor:[]};
  const allSkills=Object.keys(skillAbilities);
  const equipment=(database.equipment ?? []).filter(item=>item.edition!=="2024" || source.edition==="2024");
  const categories={anyArtisansTool:"AT",anyMusicalInstrument:"INS",anyGamingSet:"GS"};
  const itemOptions=type=>equipment.filter(item=>item.type?.split('|')[0]===type).map(item=>({id:key(item.name),name:item.name,source:item.source}));
  const languageOptions=(database.languages ?? []).filter(item=>["standard","exotic"].includes(item.type))
    .map(item=>({id:key(item.name),name:item.name,source:item.source}));
  const make=(suffix,label,count,kind,options)=>{
    if (!options.length || !count) return;
    const dedup=[...new Map(options.map(option=>[option.id,option])).values()];
    const inferred=kind==="skills" ? character.skills.filter(skill=>dedup.some(option=>option.id===key(skill.name)) &&
      Number.isFinite(skill.bonus) && skill.bonus >= (mod[skillAbilities[key(skill.name)]] ?? Infinity)+pb).map(skill=>key(skill.name)) : [];
    choices.push({id:id+"|"+suffix,label:source.name+" · "+label,count,kind,level,options:dedup,
      inferred:inferred.length===count ? inferred : []});
  };
  for(const group of ['weapons','armor']) for(const entry of source[group] ?? []) {
    const value=typeof entry==='string' ? entry : entry.proficiency;
    if(value && !/choice|choose/i.test(value)) fixed[group].push(value.replace(/\{@\w+ ([^}]+)\}/g,(_,body)=>body.split('|')[0]));
  }
  for (const [field,kind,group] of [["skillProficiencies","skills","skills"],["toolProficiencies","tools","tools"],
    ["languageProficiencies","languages","languages"],["expertise","expertise","skills"]]) {
    const records=source[field] ?? [];
    const alternativeTools=records.length>1 && records.every(record=>Object.keys(record).length===1 && categories[Object.keys(record)[0]]);
    if(alternativeTools) {
      make(field,"tool proficiency",Object.values(records[0])[0],kind,records.flatMap(record=>itemOptions(categories[Object.keys(record)[0]])));
      continue;
    }
    for (const [index,record] of records.entries()) {
      const suffix=field+"."+index;
      for (const [name,value] of Object.entries(record)) {
        if (value===true && !name.startsWith('any')) fixed[group].push(key(name));
        else if (name==='choose') {
          for (const [which,entry] of (Array.isArray(value) ? value : [value]).entries()) {
            make(suffix+"."+which,"choose "+kind,entry.count ?? entry.amount ?? 1,kind,(entry.from ?? []).map(name=>({id:key(name),name})));
          }
        } else if (categories[name]) make(suffix,"tool proficiency",value,kind,itemOptions(categories[name]));
        else if (name==='any' || name==='anyStandard' || name==='anyProficientSkill') {
          const options=kind==='languages' ? languageOptions.filter(item=>name!=='anyStandard' ||
            database.languages.some(language=>key(language.name)===item.id && language.type==='standard')) : allSkills.map(name=>({id:name,name}));
          make(suffix,"choose "+kind,value,kind,options.filter(option=>name!=='anyProficientSkill' || character.skills.some(skill=>
            key(skill.name)===option.id && Number.isFinite(skill.bonus) && skill.bonus >= (mod[skillAbilities[option.id]] ?? Infinity)+pb)));
        }
      }
    }
  }

  const nodes=[];
  function visit(node,identity) {
    if(Array.isArray(node)) return node.forEach(item=>visit(item,identity));
    if(!node || typeof node!=="object" || node.type==='options') return;
    const next=node.uid ? {...node,id:node.uid} : identity;
    if(node.uid) nodes.push(next);
    visit(node.entries,next);
    visit(node.items,next);
  }
  nodes.push(source);visit(source.entries,source);
  // Text-only source features still contain explicit skill/tool/language grants.
  for(const node of nodes) {
    const strings=[];
    const plain=value=>{
      if(typeof value==='string') strings.push(value);
      else if(Array.isArray(value)) value.forEach(plain);
      else if(value && typeof value==='object' && !value.uid && value.type!=='options') plain(value.entries ?? value.items);
    };
    plain(node.entries);
    for(const text of strings) {
      const label=text.replace(/\{@\w+ ([^}]+)\}/g,(_,body)=>body.split('|')[0]);
      const skillChoice=/proficien(?:cy|t)\s+(?:in|with)\s+(one|two|three|four|\d+)\s+(?:additional\s+)?skills? of your choice/i.exec(label);
      if(skillChoice) {
        const old=id;id=node.id;
        make("skill-choice","skill proficiencies",countOf(skillChoice[1]),"skills",allSkills.map(name=>({id:name,name})));id=old;
      }
      const languageChoice=/learn\s+(one|two|three|four|\d+)\s+(?:additional\s+)?languages? of your choice/i.exec(label);
      if(languageChoice) {const old=id;id=node.id;make("language-choice","languages",countOf(languageChoice[1]),"languages",languageOptions);id=old;}
      const skillTags=[...text.matchAll(/\{@skill ([^}|]+)[^}]*\}/g)].map(match=>key(match[1]));
      if(/gain proficiency in/i.test(text) && skillTags.length) {
        if(/(?:your choice|choose)/i.test(text)) {
          const old=id;id=node.id;make("skill-choice","skill proficiency",1,"skills",skillTags.map(name=>({id:name,name})));id=old;
        } else fixed.skills.push(...skillTags);
      }
      if(/gain proficiency (?:with|in)/i.test(text)) {
        for(const item of [...text.matchAll(/\{@item ([^}]+)\}/g)]) {
          const name=key(item[1].split('|')[0]);
          const record=equipment.find(record=>key(record.name)===name);
          if(record) fixed[record.weaponCategory ? 'weapons' : 'tools'].push(name);
        }
        for(const category of ['light','medium','heavy']) if(new RegExp(category+' armor','i').test(label)) fixed.armor.push(category);
        if(/\bshields\b/i.test(label)) fixed.armor.push('shield');
        for(const category of ['simple','martial']) if(new RegExp(category+' weapons','i').test(label)) fixed.weapons.push(category);
      }
      if(/one (?:type of )?one-handed melee weapon of your choice/i.test(label)) {
        const old=id;id=node.id;
        make('weapon-choice','weapon proficiency',1,'weapons',equipment.filter(item=>item.weaponCategory && item.type?.split('|')[0]==='M' && !item.property?.includes('2H')).map(item=>({id:key(item.name),name:item.name,source:item.source})));id=old;
      }
      const namedTools=[["artisan","AT"],["musical instrument","INS"],["gaming set","GS"]].filter(([word])=>label.toLowerCase().includes(word));
      if(!starting && /(?:of your choice|choose)/i.test(text) && namedTools.length) {
        const old=id;id=node.id;
        make("tool-choice","tool proficiency",1,"tools",namedTools.flatMap(([,type])=>itemOptions(type)));id=old;
      }
    }
  }
  return {choices:[...new Map(choices.map(choice=>[choice.id,choice])).values()],fixed};
}
