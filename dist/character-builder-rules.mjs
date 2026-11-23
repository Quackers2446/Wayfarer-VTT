import {enrichCharacter,loadCharacterRules} from './character-rules.mjs';
import {loadRules,matchWeapon} from './rules-library.mjs';
import {sourceProficiencies,sourceAllowed,skillAbilities} from './class-choice-rules.mjs';
import {additionalSpellChoices} from './class-spell-choices.mjs';
export const abilities=['str','dex','con','int','wis','cha'];
export const builderId=r=>(r.name+'|'+r.source).toLowerCase();
export const title=s=>String(s).replace(/\b\w/g,c=>c.toUpperCase());
export const plain=s=>String(s??'').replace(/\{@\w+ ([^}]+)\}/g,(_,v)=>v.split('|').at(-1)||v.split('|')[0]);
let loading;
export const loadBuilderData=()=>loading??=Promise.all([fetch('character-builder-data.json').then(r=>{if(!r.ok)throw Error('Character builder data could not be loaded.');return r.json();}),fetch('character-rules.json').then(r=>r.json()),loadCharacterRules(),loadRules()]).then(([creation,features])=>({...creation,features}));
export function newBuilderDraft(){return {id:crypto.randomUUID(),step:0,name:'',player:'',edition:'2014',level:1,classId:'fighter|phb',speciesId:'human|phb',backgroundId:'soldier|phb',subclass:'',method:'standard',baseScores:{str:15,dex:14,con:13,int:12,wis:10,cha:8},allocations:{},featureChoices:{},notes:{},equipment:{},gearChoices:{},abilityOptions:{},armor:'',shield:false};}
export function availableOrigins(db,kind,edition){return db[kind].filter(r=>r.edition===edition && !['UA','PS','WoW','AU'].some(p=>r.source.startsWith(p))).sort((a,b)=>Number(!['PHB','XPHB'].includes(a.source))-Number(!['PHB','XPHB'].includes(b.source))||a.name.localeCompare(b.name)||a.source.localeCompare(b.source));}
function abilityGroups(source,id,draft){const alternatives=source?.ability??[];if(!alternatives.length)return {fixed:{},groups:[]};const option=Math.min(alternatives.length-1,Number(draft.abilityOptions[id])||0),record=alternatives[option],fixed=Object.fromEntries(abilities.filter(a=>record[a]).map(a=>[a,record[a]])),choose=record.choose,groups=[];
 if(choose?.weighted)for(const [i,amount] of choose.weighted.weights.entries())groups.push({id:id+':'+i,from:choose.weighted.from,amount,distinct:id,max:choose.max??record.max??20,label:source.name+' +'+amount});
 else if(choose)for(let i=0;i<(choose.count??1);i++)groups.push({id:id+':'+i,from:choose.from??abilities,amount:choose.amount??1,distinct:id,max:choose.max??record.max??20,label:source.name+' +'+(choose.amount??1)});
 return {fixed,groups,alternatives,option,max:record.max??20};}
const equipmentTypeNames={weaponSimple:'Simple weapon',weaponMartial:'Martial weapon',weaponSimpleMelee:'Simple melee weapon',weaponMartialMelee:'Martial melee weapon',instrumentMusical:'Musical instrument',toolArtisan:"Artisan’s tools",setGaming:'Gaming set',focusSpellcastingHoly:'Holy symbol',focusSpellcastingDruidic:'Druidic focus',focusSpellcastingArcane:'Arcane focus'};
function gearOptions(type,edition,db){return db.equipment.filter(i=>sourceAllowed(i,edition)&&i.source===(edition==='2024'?'XPHB':'PHB') && (
 type==='weaponSimple'?i.weaponCategory==='simple':type==='weaponMartial'?i.weaponCategory==='martial':type==='weaponSimpleMelee'?i.weaponCategory==='simple'&&i.type?.split('|')[0]==='M':type==='weaponMartialMelee'?i.weaponCategory==='martial'&&i.type?.split('|')[0]==='M':type==='instrumentMusical'?i.type?.split('|')[0]==='INS':type==='toolArtisan'?i.type?.split('|')[0]==='AT':type==='setGaming'?i.type?.split('|')[0]==='GS':type.startsWith('focusSpellcasting')?i.type?.split('|')[0]==='SCF' && (i.scfType===(type.endsWith('Holy')?'holy':type.endsWith('Druidic')?'druid':'arcane')):false));}
export function startingEquipment(draft,db,cls,background){
 const groups=[],items=[],selectors=[],problems=[];let copper=0;
 const lookup=ref=>{const [name,source='PHB']=ref.split('|');return db.equipment.find(i=>i.name.toLowerCase()===name.toLowerCase()&&i.source.toLowerCase()===source.toLowerCase());};
 const add=(entry,id)=>{if(typeof entry==='string')entry={item:entry};const count=entry.quantity??1;if(entry.value)copper+=entry.value;if(entry.containsValue)copper+=entry.containsValue;
  if(entry.equipmentType){const options=gearOptions(entry.equipmentType,draft.edition,db);for(let i=0;i<count;i++){const key=id+':'+i;selectors.push({id:key,label:equipmentTypeNames[entry.equipmentType]??'Equipment',options});const picked=options.find(o=>builderId(o)===draft.gearChoices[key]);if(picked)items.push({...picked,quantity:1});else problems.push('Choose '+selectors.at(-1).label);}return;}
  if(entry.item){const item=lookup(entry.item);items.push({...item,name:entry.displayName??item?.name??title(entry.item.split('|')[0]),reference:entry.item,quantity:count});}
  else if(entry.special)items.push({name:plain(entry.special),quantity:count});
 };
 for(const [sourceId,source,data]of [['class',cls,cls?.startingEquipment?.defaultData],['background',background,background?.startingEquipment]])for(const [index,group]of (data??[]).entries()){
   const id=sourceId+':'+index,keys=Object.keys(group).filter(k=>k!=='_');for(const [i,e]of (group._??[]).entries())add(e,id+':fixed:'+i);
   if(!keys.length)continue;const selected=keys.includes(draft.equipment[id])?draft.equipment[id]:keys[0];groups.push({id,label:source.name+' · equipment '+(index+1),options:keys.map(key=>({id:key,entries:group[key]})),selected});for(const [i,e]of group[selected].entries())add(e,id+':'+selected+':'+i);
 }
 const merged=new Map();for(const item of items){const key=(item.reference??builderId({...item,source:item.source??''})).toLowerCase();const old=merged.get(key);merged.set(key,{...item,quantity:(old?.quantity??0)+item.quantity});}
 return {groups,items:[...merged.values()],selectors,problems,copper};
}
export function describeEquipment(entry){if(typeof entry==='string')return title(entry.split('|')[0]);if(entry.value)return entry.value/100+' gp';return (entry.quantity>1?entry.quantity+' × ':'')+plain(entry.displayName??entry.item?.split('|')[0]??entry.special??equipmentTypeNames[entry.equipmentType]??'Equipment');}
export function buildCharacter(draft,db){
 const cls=db.features.classes.find(c=>builderId(c)===draft.classId),recipe=db.classes.find(c=>builderId(c)===draft.classId),species=db.species.find(c=>builderId(c)===draft.speciesId),background=db.backgrounds.find(c=>builderId(c)===draft.backgroundId);
 if(!cls||!species||!background)throw Error('Choose a class, species, and background for this rules edition.');
 const choices=structuredClone(draft.featureChoices??{}),abilitySources=[['species',species],['background',background]],abilityInfo=[],scoreBonuses=Object.fromEntries(abilities.map(a=>[a,0]));
 for(const [id,source]of abilitySources){const info=abilityGroups(source,id,draft);abilityInfo.push({id,source,...info});for(const a of abilities)scoreBonuses[a]+=info.fixed[a]??0;for(const g of info.groups){const a=draft.allocations[g.id];if(g.from.includes(a))scoreBonuses[a]+=g.amount;}}
 const proficiencyDatabase={...db.features,languages:db.features.languages.filter(l=>l.source===(draft.edition==='2024'?'XPHB':'PHB'))};
 const originChoices=[],originFixed={skills:[],tools:[],languages:[],weapons:[],armor:[]};
 let raw={id:draft.id,name:draft.name.trim(),player:draft.player??'',sheetName:'Character builder',sourceName:'Character builder',rulesEditionOverride:draft.edition,characterClass:cls.name+' ('+cls.source+')',level:draft.level,species:species.name+' ('+species.source+')',background:background.name+' ('+background.source+')',abilities:[],skills:[],spells:[],items:[],attacks:[],spellSlots:{},languages:[],tools:[],feats:[],skillProficiencies:[],creation:{version:1,size:draft.size??species.size?.[0]??'M',traitChoices:[],classId:draft.classId,speciesId:draft.speciesId,backgroundId:draft.backgroundId,draft:structuredClone(draft),fixedFeats:[],featVariants:{},spellSources:[]},sheetEdits:{subclasses:{[builderId(cls)]:draft.subclass??''},featureChoices:choices,featureNotes:structuredClone(draft.notes??{}),armor:'unarmored',shield:false,fixedHp:true}};
 // Apply advancement choices to starting scores exactly once; imported sheets keep their existing behavior.
 const unlocked=(cls.featureDetails??[]).filter(f=>f.level<=draft.level&&f.name==='Ability Score Improvement');
 for(const feature of unlocked)if(choices[feature.id]?.includes('asi')){const id='asi:'+feature.id;const info={id,source:{name:'Level '+feature.level+' ability increase'},fixed:{},groups:[0,1].map(i=>({id:id+':'+i,from:abilities,amount:1,label:'Level '+feature.level+' +1'}))};abilityInfo.push(info);for(const g of info.groups){const a=draft.allocations[g.id];if(abilities.includes(a))scoreBonuses[a]++;}}
 function tables(value){if(Array.isArray(value))return value.flatMap(tables);if(value&&typeof value==='object')return [...(value.type==='table'?[value]:[]),...tables(value.entries??[]),...tables(value.items??[])];return [];}
 const ancestry=tables(species.entries).find(t=>/ancestry/i.test(t.caption??'')&&t.colLabels?.some(label=>/damage type/i.test(plain(label))));
 if(ancestry){const options=ancestry.rows.map(row=>({id:plain(row[0]).toLowerCase(),name:row.map(plain).join(' · ')}));originChoices.push({id:'creation|ancestry',kind:'options',count:1,label:ancestry.caption??'Ancestry',options});const picked=ancestry.rows.find(row=>(choices['creation|ancestry']??[]).includes(plain(row[0]).toLowerCase()));if(picked){raw.creation.traitChoices.push((ancestry.caption??'Ancestry')+': '+picked.map(plain).join(' · '));raw.resistances=[plain(picked[1]).toLowerCase()];}}
 const fixedFeatIds=[];for(const source of [species,background])for(const group of source.feats??[])for(const [id,value]of Object.entries(group)){
  if(value===true){const [name,source='phb']=id.toLowerCase().split('|'),[base,variant]=name.split(';');const ref=base.trim()+'|'+source;fixedFeatIds.push(ref);if(variant)raw.creation.featVariants[ref]=variant.trim();continue;}
  const count=typeof value==='number'?value:value?.count??0;if(!count)continue;const cats=value?.category;originChoices.push({id:'creation|'+builderId(source)+'|feats',kind:'options',count,label:source.name+' · choose a feat',level:1,options:db.features.feats.filter(f=>sourceAllowed(f,draft.edition)&&(!cats||cats.includes(f.category))).map(f=>({...f,id:builderId(f)}))});
 }
 for(const c of originChoices.filter(c=>c.id.endsWith('|feats')))for(const id of choices[c.id]??[])if(c.options.some(o=>o.id===id))fixedFeatIds.push(id);raw.creation.fixedFeats=[...new Set(fixedFeatIds)];
 // Feat score increases use the same allocation selectors as origin increases.
 for(const feat of db.features.feats.filter(f=>fixedFeatIds.includes(builderId(f))||Object.values(choices).flat().includes(builderId(f)))){const info=abilityGroups(feat,'feat:'+builderId(feat),draft);abilityInfo.push({id:'feat:'+builderId(feat),source:feat,...info});for(const a of abilities)scoreBonuses[a]+=info.fixed[a]??0;for(const g of info.groups){const a=draft.allocations[g.id];if(g.from.includes(a))scoreBonuses[a]+=g.amount;}}
 raw.abilities=abilities.map(a=>({abbr:a.toUpperCase(),label:title(a),score:Number(draft.baseScores[a])+scoreBonuses[a]}));
 const mod=Object.fromEntries(raw.abilities.map(a=>[a.abbr.toLowerCase(),Math.floor((a.score-10)/2)])),pb=2+Math.floor((draft.level-1)/4);
 for(const [id,source]of [['species',species],['background',background]]){const options={id:'creation|'+id},result=sourceProficiencies({...source,entries:[],id:options.id},proficiencyDatabase,raw,pb,mod,options),text=sourceProficiencies({name:source.name,id:options.id,entries:source.entries??[]},proficiencyDatabase,raw,pb,mod,options);for(const kind of Object.keys(originFixed)){const field={skills:'skillProficiencies',languages:'languageProficiencies',tools:'toolProficiencies',weapons:'weaponProficiencies',armor:'armorProficiencies'}[kind];if(!source[field]?.length){result.choices.push(...text.choices.filter(c=>c.kind===kind));result.fixed[kind].push(...text.fixed[kind]);}}originChoices.push(...result.choices);for(const kind of Object.keys(originFixed))originFixed[kind].push(...new Set(result.fixed[kind]));
  if(source.additionalSpells)raw.creation.spellSources.push({name:source.name,id:'creation|'+id,additionalSpells:source.additionalSpells,grantLevel:draft.level});
 }
 // 2024 characters know Common and choose two standard languages.
 if(draft.edition==='2024'){originFixed.languages.push('common');originChoices.push({id:'creation|standard-languages',kind:'languages',label:'Two additional standard languages',count:2,options:db.features.languages.filter(l=>l.source==='XPHB'&&l.type==='standard'&&l.name!=='Common').map(l=>({id:l.name.toLowerCase(),name:l.name}))});}
 const overlaps=originFixed.skills.filter((skill,index,all)=>all.indexOf(skill)!==index);
 if(overlaps.length)originChoices.push({id:'creation|replacement-skills',label:'Overlapping origin skills · choose replacements',kind:'skills',count:overlaps.length,options:Object.keys(skillAbilities).filter(name=>!originFixed.skills.includes(name)).map(name=>({id:name,name:title(name)}))});
 const fixedOrigins=structuredClone(originFixed);
 for(const c of originChoices)for(const value of choices[c.id]??[])if(c.options.some(o=>o.id===value)&&originFixed[c.kind])originFixed[c.kind].push(value);
 raw.skillProficiencies=[...new Set([...originFixed.skills,...(choices[draft.classId+'|skills']??[])])];raw.languages=[...new Set(originFixed.languages)];raw.tools=[...new Set(originFixed.tools)];
 const equipment=startingEquipment(draft,db,recipe,background);raw.items=equipment.items.map(i=>({name:i.name,quantity:i.quantity,weight:i.weight??null,reference:i.reference??builderId(i)}));raw.currency={gp:equipment.copper/100};
 const armorItems=equipment.items.filter(i=>i.armor&&i.type?.split('|')[0]!=='S');const worn=armorItems.find(i=>builderId(i)===draft.armor)??(!draft.armor?armorItems[0]:null);const shield=equipment.items.some(i=>i.type?.split('|')[0]==='S')&&Boolean(draft.shield);
 raw.sheetEdits.armor=worn?worn.name.toLowerCase().replace(/ armor$/,'').replace(/ /g,'-'):'unarmored';raw.sheetEdits.shield=shield;
 // Source armor values also cover items outside the fixed sheet-editor catalog.
 if(worn){const type=worn.type?.split('|')[0];raw.ac=worn.ac+(type==='LA'?mod.dex:type==='MA'?Math.min(2,mod.dex):0)+(shield?2:0);raw.sheetEdits.ac=raw.ac;}
 let character=enrichCharacter(raw);if(worn && character.classRules.traits.includes('Defense')){raw.ac+=1;raw.sheetEdits.ac=raw.ac;}if(!worn && cls.name==='Barbarian'){raw.ac=10+mod.dex+mod.con+(shield?2:0);raw.sheetEdits.ac=raw.ac;}if(!worn && draft.edition==='2014' && cls.name==='Sorcerer' && character.classRules.traits.includes('Draconic Resilience')){raw.ac=13+mod.dex;raw.sheetEdits.ac=raw.ac;}raw.maxHp=character.maxHp??character.rulesDetails.fixedMaximum;raw.hp=raw.maxHp;
 if(!Number.isFinite(raw.maxHp)){raw.maxHp=Math.max(1,recipe.hitDie+mod.con)+(draft.level-1)*Math.max(1,Math.floor(recipe.hitDie/2)+1+mod.con);raw.hp=raw.maxHp;}
 const training=[...(character.rulesDetails.weapons??[]),...originFixed.weapons].map(x=>x.toLowerCase());
 raw.attacks=equipment.items.filter(i=>i.weaponCategory&&i.dmg1).map(item=>{const property=(item.property??[]).map(p=>p.split('|')[0]),ranged=item.type?.split('|')[0]==='R',ability=property.includes('F')?Math.max(mod.str,mod.dex):ranged?mod.dex:mod.str,proficient=training.some(t=>t===item.weaponCategory||t===item.name.toLowerCase()||t===item.name.toLowerCase()+'s'),bonus=ability+(proficient?pb:0)+(ranged&&character.classRules.traits.includes('Archery')?2:0);return {name:item.name,bonus,damage:item.dmg1+(ability>=0?'+':'')+ability};});
 character=enrichCharacter(raw);
 const classLanguages=db.features.languages.filter(l=>(cls.features??[]).some(([level,name])=>level<=draft.level&&name.toLowerCase()===l.name.toLowerCase())).map(l=>l.name.toLowerCase());raw.languages=[...new Set([...raw.languages,...classLanguages])];
 character=enrichCharacter(raw);
 const classChoices=character.rulesDetails.classDetails.choices.filter(c=>c.id!=='creation|fixed-feats');
 for(const c of classChoices)if(c.kind==='record'){
   const feature=character.rulesDetails.classDetails.features.find(f=>c.id.startsWith(f.id));const text=(feature?.entries??[]).filter(x=>typeof x==='string').join(' ');
   const match=/Choose (?:one |a )type of favored (?:enemy|terrain): ([\s\S]+?)\./i.exec(text);
   if(match){c.kind='options';c.options=match[1].split(/,(?: or)? | or /).map(v=>plain(v).replace(/^the /,'').trim()).filter(Boolean).map(name=>({id:name.toLowerCase(),name}));const picked=c.options.filter(o=>(choices[c.id]??[]).includes(o.id));if(picked.length)raw.sheetEdits.featureNotes[c.id]=picked.map(o=>o.name).join(', ');}
 }
 const combined=[...originChoices,...classChoices].map(c=>({...c,label:c.kind==='spellbook'?c.label.replace('minimum learned','starting spells'):c.label,count:Number(c.count??1),options:c.options.map(o=>o.id==='asi'?{...o,name:'Ability score improvement (+2 or +1 / +1)'}:o),selected:(choices[c.id]??[]).filter(id=>c.options.some(o=>o.id===id)),note:draft.notes?.[c.id]??''}));
 // Starting skills cannot spend a selection on a skill granted by the background or species.
 for(const c of combined)if(['spells','spellbook','prepared','granted-spells'].includes(c.kind)){
   const rank=o=>(o.edition===draft.edition?10:0)+(['PHB','XPHB'].includes(o.source)?2:0),preferred=new Map();for(const o of c.options){const name=o.name.toLowerCase(),old=preferred.get(name);if(!old||rank(o)>rank(old))preferred.set(name,o);}c.options=[...preferred.values()];c.selected=c.selected.filter(id=>c.options.some(o=>o.id===id));
 }
 for(const c of combined)if(c.id.endsWith('|skills'))c.options=c.options.map(o=>({...o,disabled:o.disabled||originFixed.skills.includes(o.id),requires:originFixed.skills.includes(o.id)?'Already granted by your origin':o.requires}));
 for(const c of combined)if(c.kind==='skills'&&!c.id.endsWith('|skills'))c.options=c.options.map(o=>({...o,disabled:o.disabled||fixedOrigins.skills.includes(o.id),requires:fixedOrigins.skills.includes(o.id)?'Already granted by your origin':o.requires}));
 for(const c of combined)if(c.kind==='languages'){if(c.options.length>30)c.options=c.options.filter(o=>proficiencyDatabase.languages.some(l=>l.name.toLowerCase()===o.id));c.options=c.options.map(o=>({...o,disabled:o.disabled||fixedOrigins.languages.includes(o.id),requires:fixedOrigins.languages.includes(o.id)?'Already known':o.requires}));}
 return {fixedOrigins,raw,character,cls,species,background,abilityInfo,scoreBonuses,choices:combined,equipment,armorItems,mod};
}
export function builderProblems(draft,context){
 const problems=[];const invalidFeats=context.character.rulesDetails.classDetails.choices.find(c=>c.id==='creation|fixed-feats')?.invalid??[];if(invalidFeats.length)problems.push({step:3,message:'An origin feat does not meet its prerequisites.'});if(!draft.name.trim())problems.push({step:0,message:'Enter a character name.'});
 if(!Number.isInteger(draft.level)||draft.level<1||draft.level>20)problems.push({step:0,message:'Choose a level from 1 to 20.'});
 const scores=Object.values(draft.baseScores).map(Number),cost={8:0,9:1,10:2,11:3,12:4,13:5,14:7,15:9};
 if(draft.method==='standard' && scores.slice().sort((a,b)=>a-b).join(',')!=='8,10,12,13,14,15')problems.push({step:2,message:'Assign each standard-array score once.'});
 if(draft.method==='point' && (scores.some(s=>!(s in cost))||scores.reduce((n,s)=>n+(cost[s]??100),0)>27))problems.push({step:2,message:'Point buy uses at most 27 points with scores from 8 to 15.'});
 if(scores.some(s=>!Number.isInteger(s)||s<3||s>18))problems.push({step:2,message:'Base ability scores must be whole numbers from 3 to 18.'});
 for(const info of context.abilityInfo){const selected=[];for(const g of info.groups){const a=draft.allocations[g.id];if(!g.from.includes(a))problems.push({step:2,message:'Choose '+g.label+'.'});else if(g.distinct&&selected.includes(a))problems.push({step:2,message:info.source.name+' must increase different abilities.'});else selected.push(a);}}
 if(context.species.size?.length>1&&!context.species.size.includes(draft.size))problems.push({step:1,message:'Choose your character’s size.'});
 if(context.character.abilities.some(a=>a.score>Math.max(20,...context.abilityInfo.flatMap(i=>[i.max??20,...i.groups.filter(g=>draft.allocations[g.id]===a.abbr.toLowerCase()).map(g=>g.max??20)]))))problems.push({step:2,message:'An ability increase exceeds its source’s score limit.'});
 const cls=context.character.rulesDetails.classDetails.classes[0];if(cls&&draft.level>=cls.subclassLevel&&!draft.subclass)problems.push({step:1,message:'Choose your '+cls.subclassTitle+'.'});
 const chosenSkills=[];for(const c of context.choices.filter(c=>c.kind==='skills'))for(const id of c.selected){if(chosenSkills.includes(id))problems.push({step:3,message:'Choose a different skill for each skill proficiency.'});chosenSkills.push(id);}
 const languages=[];for(const c of context.choices.filter(c=>c.kind==='languages'))for(const id of c.selected){if(languages.includes(id))problems.push({step:3,message:'Choose different languages for each language selection.'});languages.push(id);}
 for(const c of context.choices){const step=['spells','spellbook','prepared','granted-spells','spell-branch','casting-ability'].includes(c.kind)?5:3,n=c.selected.length;if(c.kind==='record'){if(!c.note.trim())problems.push({step,message:'Record '+c.label+'.'});continue;}
 if(!c.optional && n!==c.count || c.optional&&n>c.count || c.kind==='prepared'&&c.count>0&&n===0)problems.push({step,message:c.label+': choose '+c.count+' ('+n+' selected).'});
 if(['spells','spellbook','prepared','granted-spells'].includes(c.kind)){const names=c.options.filter(o=>c.selected.includes(o.id)).map(o=>o.name.toLowerCase());if(new Set(names).size!==names.length)problems.push({step:5,message:c.label+': choose different spells, rather than two source versions of the same spell.'});}
 if(c.selected.some(id=>c.options.some(o=>o.id===id&&o.disabled)))problems.push({step,message:c.label+': a choice does not meet its requirements.'});}
 for(const book of context.choices.filter(c=>c.kind==='spellbook')){
   const selected=book.options.filter(o=>book.selected.includes(o.id));
   for(let rank=2;rank<=9;rank++){const capacity=(context.cls.spellsKnownProgressionFixed??[]).slice(0,draft.level).reduce((sum,count,index)=>sum+((context.cls.slots?.[index]??[]).filter(n=>n>0).length>=rank?count:0),0);if(selected.filter(s=>s.level>=rank).length>capacity)problems.push({step:5,message:'Your spellbook can contain at most '+capacity+' learned spells of level '+rank+' or higher at this character level.'});}
 }
 for(const message of context.equipment.problems)problems.push({step:4,message});return problems;
}
