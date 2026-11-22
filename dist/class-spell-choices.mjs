import {ruleKey} from "./rules-library.mjs";
import {sourceAllowed} from "./class-choice-rules.mjs";
const spellId = spell => spell.name.toLowerCase()+"|"+spell.source.toLowerCase();

export function spellFilter(spell,filter) {
  return String(filter).split('|').filter(Boolean).every(piece=>{
    const [name,values] = piece.split('=');
    const options=String(values ?? '').toLowerCase().split(';');
    switch(name.toLowerCase()) {
      case 'level': return options.includes(String(spell.level));
      case 'school': return options.includes(spell.school?.toLowerCase());
      case 'class': return Object.values(spell.classes ?? {}).some(classes=>Object.keys(classes).some(name=>options.includes(name.toLowerCase())));
      case 'components & miscellaneous': return options.every(option=>option==='ritual' && spell.meta?.ritual);
      case 'spell attack': return (spell.spellAttack ?? []).some(type=>options.includes(type.toLowerCase()));
      default: return false;
    }
  });
}

export function additionalSpellChoices(character,sources,edition,database,pb) {
  const choices=[],grants=[],expanded=[];
  const find=reference=>{
    const [name,source]=reference.split('#')[0].split('|');
    return database.spells.find(spell=>ruleKey(spell.name)===ruleKey(name) &&
      (source ? spell.source.toLowerCase()===source.toLowerCase() : spell.edition===edition));
  };
  const catalog=database.spells.filter(spell=>sourceAllowed(spell,edition));
  const visited=new Set();
  for(const source of sources) {
    const sourceId=source.id ?? spellId(source);
    if(visited.has(sourceId)) continue;
    visited.add(sourceId);
    const branches=source.additionalSpells ?? [];
    const savedChoices=character.sheetEdits?.featureChoices ?? {};
    const selectedBranches=savedChoices[sourceId+'|spell-branch'] ?? [];
    if(branches.length>1) {
      choices.push({id:sourceId+'|spell-branch',label:source.name+' · spell option',level:source.grantLevel ?? 1,count:1,
        kind:'spell-branch',options:branches.map((branch,index)=>({id:String(index),name:branch.name ?? 'Spell option '+(index+1)})),selected:selectedBranches});
    }
    for(const [branchIndex,branch] of branches.entries()) {
      if(branches.length>1 && !selectedBranches.includes(String(branchIndex))) continue;
      let ability=typeof branch.ability==='string' && branch.ability!=='inherit' ? branch.ability : source.spellcastingAbility;
      const abilityOptions=typeof branch.ability==='object' ? branch.ability.choose : branch.ability==='inherit' ?
        source.ability?.[0]?.choose?.from : null;
      if(abilityOptions?.length) {
        const id=sourceId+'|casting-ability';
        const selected=savedChoices[id] ?? [];
        choices.push({id,label:source.name+' · spellcasting ability',level:1,count:1,kind:'casting-ability',
          options:abilityOptions.map(name=>({id:name,name:name.toUpperCase()})),selected});
        ability=selected[0];
      }
      const merged=new Map();
      const grant=(spell,castUsage,type)=>{
        if(type==='expanded') expanded.push(spell);
        else if(!abilityOptions?.length || ability) grants.push({...spell,castUsage,castingAbility:ability,grantedBy:source.name});
      };
      const visit=(node,path,castUsage,type,required)=>{
        if(typeof node==='string') {const spell=find(node);if(spell)grant(spell,castUsage,type);}
        else if(Array.isArray(node)) node.forEach((value,index)=>visit(value,path+'.'+index,castUsage,type,required));
        else if(node && typeof node==='object') {
          if(Object.hasOwn(node,'choose')) {
            const from=node.choose?.from;
            const options=(from ? from.map(find).filter(Boolean) : catalog.filter(spell=>spellFilter(spell,node.choose)))
              .filter(spell=>source.maxSpellLevel==null || spell.level<=source.maxSpellLevel);
            const id=sourceId+'|spells|'+path;
            const count=node.count ?? node.choose?.count ?? 1;
            const signature=JSON.stringify([node.choose,castUsage,type,required]);
            const previous=merged.get(signature);
            const legacyId=sourceId+'|spells|'+path.replace(/^\d+\./,'0.');
            const selected=savedChoices[id] ?? (branches.length>1 && branchIndex>0 ? savedChoices[legacyId] : undefined) ?? [];
            if(previous) {
              previous.count+=count;previous.aliases.push(id);
              previous.selected=[...new Set([...previous.selected,...selected])];
            } else {
              const choice={id,aliases:[],label:(branch.name ?? source.name)+' · '+(required==='_' ? 'granted spells' : 'level '+required+' spells'),
                level:/^\d+$/.test(required) ? Number(required) : source.grantLevel ?? 1,count,kind:'granted-spells',
                options:options.map(spell=>({id:spellId(spell),...spell})),selected,castUsage,castingAbility:ability,grantedBy:source.name};
              choices.push(choice);merged.set(signature,choice);
            }
          } else if(node.all) {
            for(const spell of catalog.filter(spell=>spellFilter(spell,node.all))) grant(spell,castUsage,type);
          } else for(const [key,value] of Object.entries(node)) {
            if(key==='daily' || key==='rest') {
              for(const [uses,entries] of Object.entries(value)) {
                const maximum=uses.replace(/e$/,'')==='pb' ? pb : Number(uses.replace(/e$/,''));
                if(Number.isFinite(maximum)) visit(entries,path+'.'+key+'.'+uses,{maximum,rest:key==='rest' ? 'short' : 'long',
                  poolKey:sourceId+'|'+branchIndex+'.'+type+'.'+required+'.'+key+'.'+uses,each:uses.endsWith('e')},type,required);
              }
            } else if(key==='ritual') visit(value,path+'.ritual',{ritual:true},type,required);
            else if(key==='resource') {
              for(const [cost,entries] of Object.entries(value)) if(Number.isFinite(Number(cost))) {
                visit(entries,path+'.resource.'+cost,{resourceKey:ruleKey(branch.resourceName ?? ''),cost:Number(cost)},type,required);
              }
            }
            else if(key==='will') visit(value,path+'.will',{atWill:true},type,required);
            else visit(value,path+'.'+key,castUsage,type,required);
          }
        }
      };
      for(const type of ['known','prepared','innate','expanded']) {
        for(const [required,entries] of Object.entries(branch[type] ?? {})) {
          const rank=/^s(\d+)$/.exec(required);
          if(rank ? Number(rank[1])>(source.maxSpellLevel ?? 0) : /^\d+$/.test(required) ?
            Number(required)>(source.grantLevel ?? character.level) : required!=='_') continue;
          visit(entries,branchIndex+'.'+type+'.'+required,type==='innate' ? {atWill:true} : undefined,type,required);
        }
      }
      for(const choice of merged.values()) {
        choice.selected=choice.selected.filter(id=>choice.options.some(option=>option.id===id));
        if(choice.selected.length<=choice.count) for(const spell of choice.options.filter(option=>choice.selected.includes(option.id))) {
          grant(spell,choice.castUsage,'known');
        }
      }
    }
  }
  for(const choice of choices) {choice.remaining=Math.max(0,choice.count-choice.selected.length);choice.over=Math.max(0,choice.selected.length-choice.count);}
  return {choices,grants,expanded};
}
