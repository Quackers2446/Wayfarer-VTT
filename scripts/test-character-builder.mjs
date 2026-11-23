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

// Verify Shifter ERLW subrace selection and player choice ability increases
const shifterBase = db.species.find(s => builderId(s) === 'shifter|erlw');
assert(shifterBase, 'Shifter (ERLW) base species exists');
assert.equal(shifterBase.subraces?.length, 4, 'Shifter (ERLW) has 4 subraces');
assert.deepEqual(shifterBase.subraces.map(s => s.id), ['beasthide', 'longtooth', 'swiftstride', 'wildhunt']);

// Verify Swiftstride Shifter has player choice ability increases (no automatic fixed bonuses)
const swiftDraft = newBuilderDraft();
Object.assign(swiftDraft, {name: 'Swift Shifter', speciesId: 'shifter|erlw', subraceId: 'swiftstride'});
swiftDraft.abilityOptions['species'] = 0;
swiftDraft.allocations['species:0'] = 'dex'; // +2 DEX
swiftDraft.allocations['species:1'] = 'cha'; // +1 CHA
const swiftChar = complete(swiftDraft);
assert.deepEqual(builderProblems(swiftDraft, swiftChar), []);
assert.equal(swiftChar.species.name, 'Swiftstride Shifter');
assert.deepEqual(swiftChar.abilityInfo.find(i => i.id === 'species').fixed, {}, 'No automatic fixed ability increases');
assert.equal(swiftChar.character.abilities.find(a => a.abbr === 'DEX').score, 16); // base 14 + 2
assert.equal(swiftChar.character.abilities.find(a => a.abbr === 'CHA').score, 9);  // base 8 + 1

// Verify Swiftstride Shifter with alternate player choice (+2 CON, +1 STR)
swiftDraft.allocations['species:0'] = 'con';
swiftDraft.allocations['species:1'] = 'str';
const swiftAlt = buildCharacter(swiftDraft, db);
assert.equal(swiftAlt.character.abilities.find(a => a.abbr === 'CON').score, 15); // base 13 + 2
assert.equal(swiftAlt.character.abilities.find(a => a.abbr === 'STR').score, 16); // base 15 + 1

// Verify all 4 Shifter ERLW variants have player choice and complete cleanly
for (const subId of ['beasthide', 'longtooth', 'swiftstride', 'wildhunt']) {
  const d = newBuilderDraft();
  Object.assign(d, {name: 'Shifter ' + subId, speciesId: 'shifter|erlw', subraceId: subId});
  const c = complete(d);
  assert.deepEqual(builderProblems(d, c), []);
  assert(c.species.name.toLowerCase().includes(subId));
  assert.deepEqual(c.abilityInfo.find(i => i.id === 'species').fixed, {}, 'Subrace has no automatic fixed abilities');
}
console.log('Shifter (ERLW) 4 subrace variants and player choice ability increases verified.');

// Verify Shifter MPMM also has 4 subraces and flexible ability score increases (+2/+1 or +1/+1/+1)
const shifterMpmm = newBuilderDraft();
Object.assign(shifterMpmm, {name: 'MPMM Shifter', speciesId: 'shifter|mpmm', subraceId: 'swiftstride'});
const sm = complete(shifterMpmm);
assert.equal(sm.species.subraces.length, 4, 'MPMM Shifter has 4 subraces');
assert.deepEqual(sm.species.subraces.map(s => s.id), ['beasthide', 'longtooth', 'swiftstride', 'wildhunt']);
assert.equal(sm.abilityInfo[0].alternatives.length, 2, 'MPMM Shifter has 2 ASI options');
assert.deepEqual(sm.abilityInfo[0].fixed, {}, 'MPMM Shifter has no automatic fixed increases');

// Option 0: +2 and +1
shifterMpmm.abilityOptions['species'] = 0;
shifterMpmm.allocations['species:0'] = 'str';
shifterMpmm.allocations['species:1'] = 'dex';
const smOpt0 = buildCharacter(shifterMpmm, db);
assert.equal(smOpt0.character.abilities.find(a => a.abbr === 'STR').score, 17); // 15 + 2
assert.equal(smOpt0.character.abilities.find(a => a.abbr === 'DEX').score, 15); // 14 + 1
// Reject duplicate pick on distinct weighted ASI
shifterMpmm.allocations['species:1'] = 'str';
assert(builderProblems(shifterMpmm, buildCharacter(shifterMpmm, db)).some(p => p.message.includes('different abilities')));

// Option 1: +1 to 3 different abilities
shifterMpmm.abilityOptions['species'] = 1;
shifterMpmm.allocations['species:0'] = 'str';
shifterMpmm.allocations['species:1'] = 'dex';
shifterMpmm.allocations['species:2'] = 'con';
const smOpt1 = buildCharacter(shifterMpmm, db);
assert.equal(smOpt1.character.abilities.find(a => a.abbr === 'STR').score, 16); // 15 + 1
assert.equal(smOpt1.character.abilities.find(a => a.abbr === 'DEX').score, 15); // 14 + 1
assert.equal(smOpt1.character.abilities.find(a => a.abbr === 'CON').score, 14); // 13 + 1
assert.deepEqual(builderProblems(shifterMpmm, smOpt1), []);
console.log('Post-Tasha flexible ASIs (+2/+1 and +1/+1/+1) and duplicate protection verified.');

// Verify base race + subrace combined ability increases (Mountain Dwarf, High Elf, Wood Elf)
const dwarf = newBuilderDraft();
Object.assign(dwarf, {name: 'Mountain Dwarf', speciesId: 'dwarf|phb', subraceId: 'mountain-dwarf'});
const dw = complete(dwarf);
assert.equal(dw.character.abilities.find(a => a.abbr === 'CON').score, 15); // 13 + 2
assert.equal(dw.character.abilities.find(a => a.abbr === 'STR').score, 17); // 15 + 2

const woodElf = newBuilderDraft();
Object.assign(woodElf, {name: 'Wood Elf', speciesId: 'elf|phb', subraceId: 'wood-elf'});
const we = complete(woodElf);
assert.equal(we.character.abilities.find(a => a.abbr === 'DEX').score, 16); // 14 + 2
assert.equal(we.character.abilities.find(a => a.abbr === 'WIS').score, 11); // 10 + 1
assert.equal(partyActor(we.raw).speed, 35, 'Wood Elf speed 35');
console.log('Combined base + subrace ability scores (Mountain Dwarf, Wood Elf) and traits verified.');


// Verify prepared spells metadata, level grouping, and filtering
const cleric3Draft = newBuilderDraft();
Object.assign(cleric3Draft, {name: 'Level 3 Cleric', classId: 'cleric|phb', level: 3});
const c3 = complete(cleric3Draft);
const prepChoice = c3.choices.find(c => c.kind === 'prepared');
assert(prepChoice, 'Cleric 3 has prepared spells choice');
assert(prepChoice.options.length > 20, 'Cleric 3 has rich spell list');

// Verify metadata enrichment
const sampleSpell = prepChoice.options.find(s => s.name === 'Bless');
assert(sampleSpell, 'Bless exists in options');
assert.equal(sampleSpell.level, 1, 'Bless is level 1');
assert.equal(sampleSpell.school, 'E', 'Bless is Enchantment');
assert.equal(sampleSpell.concentration, true, 'Bless has concentration');
assert.equal(sampleSpell.castingCategory, 'action', 'Bless is 1 action');
assert(sampleSpell.entries?.length > 0, 'Bless has entries rules text');

const sampleBonus = prepChoice.options.find(s => s.name === 'Healing Word');
assert(sampleBonus, 'Healing Word exists in options');
assert.equal(sampleBonus.castingCategory, 'bonus', 'Healing Word is bonus action');

const sampleRitual = prepChoice.options.find(s => s.name === 'Augury' || s.name === 'Detect Magic' || s.name === 'Purify Food and Drink');
assert(sampleRitual, 'Ritual spell exists in cleric options');
assert.equal(sampleRitual.ritual, true, 'Spell has ritual property');

// Verify level grouping
const distinctLevels = [...new Set(prepChoice.options.map(o => o.level))].sort((a,b) => a - b);
assert.deepEqual(distinctLevels, [1, 2], 'Cleric 3 has level 1 and level 2 prepared spells grouped');
const level1Spells = prepChoice.options.filter(o => o.level === 1);
const level2Spells = prepChoice.options.filter(o => o.level === 2);
assert(level1Spells.length >= 10, 'Level 1 spells present');
assert(level2Spells.length >= 10, 'Level 2 spells present');

// Verify preparation selection applies to character sheet
cleric3Draft.featureChoices[prepChoice.id] = [sampleSpell.id, sampleBonus.id];
const c3Updated = buildCharacter(cleric3Draft, db);
const clericActor = partyActor(c3Updated.raw);
assert(clericActor.spells.some(s => s.name === 'Bless' && s.prepared), 'Bless is marked prepared on actor');
assert(clericActor.spells.some(s => s.name === 'Healing Word' && s.prepared), 'Healing Word is marked prepared on actor');
// Verify non-PHB expanded spell lists (XGE/TCE classVariant spells such as Shape Water, Ice Knife, Healing Spirit for Druid)
{
  const druidCls = db.classes.find(c => c.name === 'Druid' && c.source === 'PHB');
  const humanSpecies = db.species.find(s => s.name === 'Human' && s.source === 'PHB');
  const acolyteBg = db.backgrounds.find(b => b.name === 'Acolyte' && b.source === 'PHB');

  const druidDraft = newBuilderDraft();
  druidDraft.classId = builderId(druidCls);
  druidDraft.speciesId = builderId(humanSpecies);
  druidDraft.backgroundId = builderId(acolyteBg);
  druidDraft.level = 3;
  druidDraft.edition = '2014';

  const druidChar = buildCharacter(druidDraft, db);
  const cantripsChoice = druidChar.choices.find(c => c.id.includes('cantrips'));
  const preparedChoice = druidChar.choices.find(c => c.id.includes('prepared'));

  assert.ok(cantripsChoice?.options?.some(o => o.name === 'Shape Water'), 'Druid cantrips must include Shape Water (XGE)');
  assert.ok(preparedChoice?.options?.some(o => o.name === 'Ice Knife'), 'Druid prepared spells must include Ice Knife (XGE)');
  assert.ok(preparedChoice?.options?.some(o => o.name === 'Healing Spirit'), 'Druid prepared spells must include Healing Spirit (XGE)');
  assert.ok(preparedChoice?.options?.some(o => o.name === 'Absorb Elements'), 'Druid prepared spells must include Absorb Elements (XGE)');
}

// Verify title and describeEquipment do not capitalize possessive 's
import {describeEquipment} from '../dist/character-builder-rules.mjs';
assert.equal(describeEquipment("dungeoneer's pack|phb"), "Dungeoneer's Pack", 'Possessive s must remain lowercase in Dungeoneer\'s Pack');
assert.equal(describeEquipment("explorer's pack|phb"), "Explorer's Pack", 'Possessive s must remain lowercase in Explorer\'s Pack');
assert.equal(describeEquipment({item: "dungeoneer's pack|phb"}), "Dungeoneer's Pack");
assert.equal(describeEquipment("thieves' tools|phb"), "Thieves' Tools");

console.log('Prepared spells metadata enrichment, level grouping (tabs), tags, and actor preparation verified.');
