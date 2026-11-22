import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadRules} from "../dist/rules-library.mjs";
import {loadCharacterRules,enrichCharacter} from "../dist/character-rules.mjs";
import {partyActor} from "../dist/encounters.mjs";
import {classActions,classSkillCheck,migratePactResources,restParty,useClassAction} from "../dist/class-actions.mjs";
import {castSpell,endInitiative,endTurn,fallingDamage,makeActor,newBattle,resolveDeflection,rollStrike,savingThrow,startInitiative} from "../dist/combat.mjs";
import {runEnemyTurns} from "../dist/enemy-turn.mjs";

globalThis.fetch=async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)));
await Promise.all([loadRules(),loadCharacterRules()]);
const database=JSON.parse(await readFile(new URL('../dist/character-rules.json',import.meta.url)));
function sheet(characterClass,level,extra={}) {
  return {id:crypto.randomUUID(),name:characterClass,characterClass,level,species:"Tiefling",background:"Acolyte",hp:20,maxHp:50,ac:null,speed:null,
    abilities:[['STR',12],['DEX',16],['CON',14],['INT',18],['WIS',18],['CHA',18]].map(([abbr,score])=>({abbr,score,modifier:Math.floor((score-10)/2),save:null})),
    skills:[],spells:[],items:[],attacks:[],spellSlots:{},...extra};
}
const raw=sheet('Monk: Way of the Astral Self',9);
let monk=enrichCharacter(raw);
assert.equal(monk.resources.ki.maximum,9);
assert.equal(monk.ac,17);
assert.equal(monk.speed,'45');
assert.ok(monk.classRules.traits.includes('Visage of the Astral Self'));
assert.ok(!monk.classRules.traits.includes('Body of the Astral Self'));
assert.equal(monk.rulesDetails.classDetails.choices.filter(choice=>choice.kind==='advancement').length,2);
assert.equal(monk.rulesDetails.classDetails.choices.find(choice=>choice.kind==='tools').count,1);
const enabled={};
for(const name of ['Quickened Healing','Focused Aim','Ki-Fueled Attack','Dedicated Weapon']) {
 const choice=monk.rulesDetails.classDetails.choices.find(choice=>choice.label===name);
 enabled[choice.id]=[choice.options[0].id];
}
raw.sheetEdits={featureChoices:enabled};
monk=enrichCharacter(raw);
assert.ok(monk.rulesDetails.classDetails.choices.some(choice=>choice.kind==='dedicated-weapon'));
const actor=partyActor(raw);Object.assign(actor,{x:2,y:2,initiative:100});
const enemy=makeActor({name:'Foe',x:3,y:2,hp:1000,maxHp:1000,ac:5});
const battle=newBattle();battle.actors=[actor,enemy];startInitiative(battle,()=>.5);
assert.ok(classActions(actor,battle).some(action=>action.id==='quickened-healing'));
useClassAction(battle,actor,'quickened-healing',{},()=>.5);
assert.equal(actor.hp,28);
assert.equal(actor.resources.ki.current,7);
assert.equal(battle.kiAction,true);
rollStrike(battle,actor,enemy,actor.attacks.find(attack=>attack.unarmed),{bonusStrike:true,kiFueled:true},()=>.5);
assert.equal(battle.bonusUsed,true);
assert.throws(()=>rollStrike(battle,actor,enemy,actor.attacks[0],{bonusStrike:true,kiFueled:true}),/bonus action/);
endTurn(battle);endTurn(battle);
assert.equal(battle.kiAction,false);
const weapon=actor.attacks.find(attack=>attack.unarmed);
enemy.ac=weapon.bonus+15;
rollStrike(battle,actor,enemy,weapon,{focusedAim:3},()=>.5);
assert.equal(actor.resources.ki.current,5);
assert.equal(battle.actionEvents.at(-1).outcome,'Hit');
assert.equal(battle.kiAction,true);
actor.astralArms={expires:600};
assert.equal(savingThrow(actor,'str',{random:()=>.5}).total,19);
const athleticsBefore=actor.skillBonuses.athletics;
assert.equal(classSkillCheck(battle,actor,'athletics',{},()=>.5).total,11+athleticsBefore+3);

const lore=enrichCharacter(sheet('Bard: College of Lore',6));
const loreChoices=lore.rulesDetails.classDetails.choices;
assert.equal(loreChoices.filter(choice=>/Additional Magical Secrets/.test(choice.label)).length,1);
assert.equal(loreChoices.find(choice=>/Additional Magical Secrets/.test(choice.label)).count,2);
assert.equal(loreChoices.find(choice=>/skill proficiencies/.test(choice.label)).count,3);
const bard10=enrichCharacter(sheet('Bard: College of Valor',10));
assert.equal(bard10.rulesDetails.classDetails.choices.find(choice=>choice.label==='Bard spells known').count,12);
assert.equal(bard10.classRules.inspirationDie,10);
const paladin=enrichCharacter(sheet('Paladin: Oath of Devotion',6));
assert.equal(paladin.rulesDetails.classDetails.choices.find(choice=>choice.kind==='prepared').count,7);
const artificer=enrichCharacter(sheet('Artificer: Battle Smith',6));
assert.equal(artificer.rulesDetails.classDetails.choices.find(choice=>choice.kind==='prepared').count,7);
const multiclass=enrichCharacter(sheet('Life Domain Cleric 1 / Wizard 11',12,{startingClass:'Cleric'}));
assert.ok(multiclass.spells.some(spell=>spell.name==='Cure Wounds'));
assert.ok(!multiclass.spells.some(spell=>spell.name==='Revivify'));
assert.ok(!multiclass.rulesDetails.classDetails.choices.some(choice=>choice.label==='Wizard starting skills'));
const trickster=enrichCharacter(sheet('Rogue: Arcane Trickster',3));
assert.ok(trickster.spells.some(spell=>spell.name==='Mage Hand'));
const cantrips=trickster.rulesDetails.classDetails.choices.find(choice=>choice.label==='Rogue cantrips known');
assert.equal(cantrips.count,2);
assert.ok(!cantrips.options.some(option=>option.name==='Mage Hand'));
const warlockRaw=sheet('Warlock: The Fiend',6,{spells:[{name:'Eldritch Blast',level:0,prepared:true}]});
const warlock=enrichCharacter(warlockRaw);
const warlockChoices=warlock.rulesDetails.classDetails.choices;
assert.equal(warlockChoices.filter(choice=>choice.label==='Pact Boon').length,1);
assert.ok(warlockChoices.find(choice=>choice.label==='Warlock spells known').options.some(option=>option.name==='Fireball'));
const invocations=warlockChoices.find(choice=>choice.label==='Eldritch Invocations');
assert.ok(invocations.options.find(option=>option.name==='Thirsting Blade').disabled);
const pact=warlockChoices.find(choice=>choice.label==='Pact Boon');
warlockRaw.sheetEdits={featureChoices:{[pact.id]:['pact of the tome|phb'],[invocations.id]:['book of ancient secrets|phb']}};
const tome=enrichCharacter(warlockRaw);
const rituals=tome.rulesDetails.classDetails.choices.find(choice=>choice.label.includes('Book of Ancient Secrets') && choice.kind==='granted-spells');
assert.equal(rituals.count,2);
assert.ok(rituals.options.length>0 && rituals.options.every(spell=>spell.level===1 && spell.meta?.ritual));

const featRaw=sheet('Fighter',4);
const asi=enrichCharacter(featRaw).rulesDetails.classDetails.choices.find(choice=>choice.kind==='advancement');
featRaw.sheetEdits={featureChoices:{[asi.id]:['magic initiate|phb'],'magic initiate|phb|spell-branch':['5']}};
let feat=enrichCharacter(featRaw);
const featSpells=feat.rulesDetails.classDetails.choices.filter(choice=>choice.kind==='granted-spells');
assert.ok(featSpells.every(choice=>choice.id.includes('|spells|5.')));
assert.equal(featSpells.find(choice=>choice.options.every(spell=>spell.level===0)).count,2);

const mixed=partyActor(sheet('The Fiend Warlock 3 / Wizard 3',6,{startingClass:'Warlock',ac:13,spells:[{name:'Magic Missile',level:1,prepared:true}]}));
Object.assign(mixed,{x:2,y:2,initiative:100});
assert.equal(mixed.resources.pactMagic.slotLevel,2);
assert.equal(mixed.resources.pactMagic.maximum,2);
assert.equal(mixed.slots[2].maximum,2);
assert.equal(mixed.slots[1].maximum,4);
const mixedBattle=newBattle();mixedBattle.actors=[mixed,enemy];startInitiative(mixedBattle,()=>.5);
const missile=mixed.spells.find(spell=>spell.key==='magic missile');
castSpell(mixedBattle,mixed,enemy,missile,2,{slotPool:'pact'},()=>.5);
assert.equal(mixed.resources.pactMagic.current,1);
assert.equal(mixed.slots[2].current,2);
endTurn(mixedBattle);endTurn(mixedBattle);
castSpell(mixedBattle,mixed,enemy,missile,2,{slotPool:'spellcasting'},()=>.5);
assert.equal(mixed.resources.pactMagic.current,1);
assert.equal(mixed.slots[2].current,1);
const legacy=makeActor({classRules:{pact:true,edition:'2014',levels:{Warlock:6}},slots:{1:{current:2,maximum:2},3:{current:0,maximum:2}},resources:{}});
migratePactResources(legacy);
assert.equal(legacy.resources.pactMagic.current,0);
assert.deepEqual(legacy.slots,{});
migratePactResources(legacy);
assert.equal(legacy.resources.pactMagic.current,0,'Rejoining must not restore spent Pact slots');
endInitiative(mixedBattle);restParty(mixedBattle);
assert.equal(mixed.resources.pactMagic.current,2);
assert.equal(mixed.slots[2].current,1);

const shadow=partyActor(sheet('Monk: Way of Shadow',3));Object.assign(shadow,{x:2,y:2});
const shadowBattle=newBattle();shadowBattle.actors=[shadow];
const darkness=shadow.spells.find(spell=>spell.key==='darkness');
assert.equal(darkness.castUsage.resource,'ki');
assert.equal(darkness.castUsage.cost,2);
castSpell(shadowBattle,shadow,undefined,darkness,0,{square:{x:3,y:3},map:{cols:20,rows:20}},()=>.5);
assert.equal(shadow.resources.ki.current,1);
assert.throws(()=>castSpell(shadowBattle,shadow,undefined,darkness,0,{square:{x:3,y:3},map:{cols:20,rows:20}}),/expended/);

const resistant=makeActor({name:'Resistant foe',x:3,y:2,hp:100,maxHp:100,ac:5,resist:[{resist:['bludgeoning'],note:'from nonmagical attacks'}]});
const magicBattle=newBattle();Object.assign(actor,{x:2,y:2,initiative:100});magicBattle.actors=[actor,resistant];startInitiative(magicBattle,()=>.5);
rollStrike(magicBattle,actor,resistant,weapon,{},()=>.5);
assert.equal(100-resistant.hp,7,'Ki-Empowered Strikes bypass nonmagical attack resistance');

const defender=partyActor(raw);Object.assign(defender,{x:2,y:2,initiative:100,freeHand:true,ac:10});
const archer=makeActor({name:'Archer',x:5,y:2,hp:100,maxHp:100,ac:5,speed:0,attacks:[{name:'Shortbow',bonus:10,damage:'1d6+2',type:'piercing',normalRange:80,longRange:320}]});
const deflectBattle=newBattle();deflectBattle.actors=[defender,archer];startInitiative(deflectBattle,()=>.5);
endTurn(deflectBattle);runEnemyTurns(deflectBattle,{cols:20,rows:20},()=>.5);
assert.equal(defender.hp,20);
assert.equal(defender.reactionUsed,true);
assert.equal(deflectBattle.classReaction.actor,defender.id);
assert.equal(deflectBattle.round,1);
assert.throws(()=>endTurn(deflectBattle),/Deflect Missiles/);
resolveDeflection(deflectBattle,defender,archer,{map:{cols:20,rows:20},fits:true},()=>.5);
assert.equal(defender.resources.ki.current,8);
assert.equal(deflectBattle.classReaction,null);
assert.equal(archer.hp,93);
runEnemyTurns(deflectBattle,{cols:20,rows:20},()=>.5);
assert.equal(deflectBattle.round,2);
endInitiative(deflectBattle);defender.prone=false;
const falling=fallingDamage(deflectBattle,defender,100,{},()=>.5);
assert.equal(falling.damage,0,'Slow Fall reduces 40 damage by 45 at monk level 9');
assert.equal(defender.prone,false);
assert.equal(defender.hp,20);
const withoutSlowFall=fallingDamage(deflectBattle,defender,30,{slowFall:false},()=>.5);
assert.equal(withoutSlowFall.damage,12);
assert.equal(defender.prone,true);

for(const cls of database.classes.filter(cls=>cls.edition==='2014')) {
 for(const level of [1,3,6,9,20]) {
  const character=enrichCharacter(sheet(cls.name+' ('+cls.source+')',level));
  const choices=character.rulesDetails.classDetails.choices;
  assert.equal(new Set(choices.map(choice=>choice.id)).size,choices.length,cls.name+' has duplicate choice IDs');
  for(const choice of choices) {
   assert.ok(Number.isFinite(choice.count) && choice.count>0,cls.name+' has an invalid choice count');
   assert.equal(new Set(choice.options.map(option=>option.id)).size,choice.options.length,cls.name+' has duplicate options');
  }
 }
 for(const subclass of cls.subclasses) for(const level of [3,9,20]) {
  const raw=sheet(cls.name+' ('+cls.source+')',level,{sheetEdits:{subclasses:{[cls.name.toLowerCase()+'|'+cls.source.toLowerCase()]:subclass.name.toLowerCase()+'|'+subclass.source.toLowerCase()}}});
  const character=enrichCharacter(raw),details=character.rulesDetails.classDetails;
  assert.equal(details.classes[0].source,cls.source);
  assert.equal(details.classes[0].subclass,subclass.name);
  assert.equal(new Set(details.choices.map(choice=>choice.id)).size,details.choices.length,cls.name+' '+subclass.name+' has duplicate choices');
  assert.ok(details.features.every(feature=>feature.level<=level),subclass.name+' unlocked a future feature');
 }
}
console.log('Source-backed monk abilities, prerequisites, proficiencies, multiclass spell gates, half-caster preparation, bonus spells, ritual filters and stable spell branches verified across class progressions.');
