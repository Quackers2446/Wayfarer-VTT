import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
globalThis.fetch=async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)));
const {loadBuilderData,newBuilderDraft,buildCharacter,builderProblems,builderId}=await import('../dist/character-builder-rules.mjs');
const {partyActor}=await import('../dist/encounters.mjs');const db=await loadBuilderData();
function complete(d){
 for(let pass=0;pass<15;pass++){
 const c=buildCharacter(d,db);if(c.species.size?.length>1&&!d.size)d.size=c.species.size[0];const cls=c.character.rulesDetails.classDetails.classes[0];if(d.level>=cls.subclassLevel&&!d.subclass)d.subclass=cls.subclasses[0].id;
 for(const i of c.abilityInfo){const used=[];for(const g of i.groups){if(!g.from.includes(d.allocations[g.id]))d.allocations[g.id]=g.from.find(a=>!g.distinct||!used.includes(a));used.push(d.allocations[g.id]);}}
 for(const s of c.equipment.selectors)if(!d.gearChoices[s.id]){assert(s.options.length,'Equipment options exist: '+s.label);d.gearChoices[s.id]=builderId(s.options[0]);}
 const usedLanguages=new Set();for(const choice of c.choices){if(choice.kind==='record'){d.notes[choice.id]='Chosen from source rules';continue;}if(choice.optional&&choice.kind!=='prepared')continue;
 const old=d.featureChoices[choice.id]??[];for(const id of old)if(choice.kind==='languages')usedLanguages.add(id);
 if(old.length===choice.count&&old.every(id=>choice.options.some(o=>o.id===id&&!o.disabled)))continue;
 const options=choice.options.filter(o=>!o.disabled&&(choice.kind!=='languages'||!usedLanguages.has(o.id)));
 const picked=choice.kind==='advancement'?['asi']:options.slice(0,choice.count).map(o=>o.id);d.featureChoices[choice.id]=picked;if(choice.kind==='languages')picked.forEach(id=>usedLanguages.add(id));
 }
 }
 return buildCharacter(d,db);
}
for(const name of ['fighter','wizard','rogue','monk','cleric','druid','barbarian','bard','warlock','paladin','ranger','sorcerer','artificer']){
 const draft=newBuilderDraft();draft.name='Builder '+name;draft.classId=name+'|'+(name==='artificer'?'tce':'phb');const c=complete(draft);const issues=builderProblems(draft,c);assert.deepEqual(issues,[],name+': '+JSON.stringify(issues));const actor=partyActor(c.raw);assert(actor.maxHp>0);assert(actor.ac>0);assert.equal(actor.level,1);assert.equal(c.character.abilities[0].score,16,'Human gains source +1');if(c.equipment.items.some(i=>i.weaponCategory))assert(actor.attacks.length>0,name+' gets usable weapon attacks');if(name==='wizard'){assert(c.character.spells.length>=6);assert(actor.slots[1].maximum===2);assert(actor.spells.some(s=>s.prepared));}
}
const monk=newBuilderDraft();Object.assign(monk,{name:'Level Nine',classId:'monk|phb',level:9});const high=complete(monk);assert.deepEqual(builderProblems(monk,high),[]);assert.equal(high.character.resources.ki.maximum,9);assert.equal(high.character.abilities[0].score,20,'Two ASIs apply once');assert.equal(partyActor(high.raw).resources.ki.current,9);
const revised=newBuilderDraft();Object.assign(revised,{name:'Revised acolyte',edition:'2024',classId:'cleric|xphb',speciesId:'human|xphb',backgroundId:'acolyte|xphb'});const r=complete(revised);assert.deepEqual(builderProblems(revised,r),[]);assert.equal(r.raw.creation.fixedFeats.includes('magic initiate|xphb'),true);assert(r.choices.some(c=>c.kind==='granted-spells'));assert(r.character.rulesDetails.languages.includes('Common'));
const invalid=newBuilderDraft();invalid.name='Bad points';invalid.method='point';invalid.baseScores={str:15,dex:15,con:15,int:15,wis:15,cha:15};assert(builderProblems(invalid,buildCharacter(invalid,db)).some(p=>p.message.includes('27 points')));
console.log('All 13 core classes create usable level-1 actors; Wizard learning/preparation, starting weapons/armor, Human ability increases, level-9 Monk ASIs/Ki, revised origin feats/languages, and invalid point buy verified.');

for(const name of ['fighter','wizard','rogue','monk','cleric','druid','barbarian','bard','warlock','paladin','ranger','sorcerer','artificer']){
 const d=newBuilderDraft();Object.assign(d,{name:'Revised '+name,edition:'2024',classId:name+'|'+(name==='artificer'?'efa':'xphb'),speciesId:'human|xphb',backgroundId:'soldier|xphb'});const c=complete(d);assert.deepEqual(builderProblems(d,c),[],name+' revised');assert(partyActor(c.raw).maxHp>0);
}
const elf=newBuilderDraft();Object.assign(elf,{name:'Elven sailor',speciesId:'high elf|phb',backgroundId:'sailor|phb'});const e=complete(elf);assert(e.choices.some(c=>c.id==='creation|replacement-skills'));assert.deepEqual(builderProblems(elf,e),[]);
const dragon=newBuilderDraft();Object.assign(dragon,{name:'Dragonborn',speciesId:'dragonborn|phb'});const dc=complete(dragon);assert.deepEqual(builderProblems(dragon,dc),[]);assert.equal(dc.character.resistances.includes('acid'),true);assert(dc.raw.creation.traitChoices.some(s=>s.includes('Black')));
console.log('All 13 revised classes, duplicate skill replacement, source ancestry selection and resistance verified.');
const wizard24=newBuilderDraft();Object.assign(wizard24,{name:'Revised wizard',edition:'2024',classId:'wizard|xphb',speciesId:'human|xphb',backgroundId:'soldier|xphb'});const w24=complete(wizard24);const acid=partyActor(w24.raw).spells.find(s=>s.name==='Acid Splash');assert.equal(acid?.reference,'xphb|acid splash','Selected revised spells retain their actual source in play');
const bookDraft=newBuilderDraft();Object.assign(bookDraft,{name:'Learning limits',classId:'wizard|phb',level:5});const bookContext=complete(bookDraft),book=bookContext.choices.find(c=>c.kind==='spellbook');const highSpells=book.options.filter(s=>s.level===3).slice(0,3),lowSpells=book.options.filter(s=>s.level===1).slice(0,book.count-3);bookDraft.featureChoices[book.id]=[...highSpells,...lowSpells].map(s=>s.id);assert(builderProblems(bookDraft,buildCharacter(bookDraft,db)).some(p=>p.message.includes('level 3 or higher')));
console.log('Revised spell source fidelity and cumulative wizard spellbook learning limits verified.');
