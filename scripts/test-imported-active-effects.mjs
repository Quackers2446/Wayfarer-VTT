import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {convertFoundrySpell} from '../dist/foundry-spell-import.mjs';
import {newBattle,makeActor,castSpell,savingThrow,advanceTime,rollStrike,spellTargetCount,startInitiative,startConcentration} from '../dist/combat.mjs';
import {ruleProblems,nativeSpellLevels} from '../dist/spell-rule-schema.mjs';
import {nativeSpellDefinitions} from '../dist/native-spell-definitions.mjs';
const catalog=JSON.parse(await readFile(new URL('../dist/rules.json',import.meta.url))).spells;
const map={cols:30,rows:20,size:25,width:750,height:500,offsetX:0,offsetY:0,regions:[]};
function imported(name){const sign=name==='Bane'?'-1d4':'1d4';return convertFoundrySpell({type:'spell',name,system:{source:'PHB',activation:{type:'action'},range:{units:'ft',value:30},target:{type:'creature',value:3},duration:{units:'minute',value:1},components:{concentration:true},save:{ability:name==='Bane'?'cha':''},damage:{parts:[]}},effects:[{disabled:true,changes:[{key:'system.bonuses.All-Attacks',mode:2,value:sign},{key:'system.bonuses.abilities.save',mode:2,value:sign}]}]},catalog);}
function setup(name){const entry=imported(name);assert.equal(entry.status,'ready');assert.deepEqual(ruleProblems(entry.rule),[]);const battle=newBattle(),caster=makeActor({id:'caster',name:'Caster',side:'party',x:1,y:1,hp:100,maxHp:100,spellDC:15,spellAbility:3,slots:{1:{current:3,maximum:3},2:{current:2,maximum:2}}}),targets=Array.from({length:4},(_,i)=>makeActor({id:'target'+i,name:'Target '+i,side:name==='Bless'?'party':'hostile',x:3+i,y:1,hp:100,maxHp:100,ac:13,saves:{cha:0,dex:0}}));battle.actors=[caster,...targets];battle.spellRules={[entry.rule.reference]:entry.rule};return {entry,battle,caster,targets,spell:{name,key:name.toLowerCase(),reference:entry.rule.reference,edition:'2014',level:1}};}
{
const {entry,battle,caster,targets,spell}=setup('Bless');
assert.equal(spellTargetCount({custom:true,definition:entry.rule,level:1},1,2),4);
assert.throws(()=>castSpell(battle,caster,targets[0],spell,1,{map,targets:targets.slice(1)},()=>.5),/Too many/);
assert.equal(caster.slots[1].current,3,'Invalid targeting never spends slots');
castSpell(battle,caster,targets[0],spell,2,{map,targets:targets.slice(1)},()=>.5);
assert.equal(caster.slots[2].current,1);
assert.ok(targets.every(target=>target.conditions.some(effect=>effect.name==='Bless')));
assert.equal(savingThrow(targets[0],'dex',{random:()=>.5}).total,14,'Bless adds rolled d4 to saves');
const enemy=makeActor({id:'enemy',name:'Enemy',x:4,y:2,hp:100,maxHp:100,ac:13});battle.actors.push(enemy);startInitiative(battle,()=>.5);battle.turn=battle.order.indexOf(targets[0].id);
rollStrike(battle,targets[0],enemy,{name:'Test sword',bonus:0,damage:'1d6',type:'slashing'},{map},()=>.5);
assert.equal(battle.actionEvents.at(-1).outcome,'Hit','Bless changes an attack that would miss into a hit');
advanceTime(battle,60);
assert.ok(targets.every(target=>!target.conditions.some(effect=>effect.name==='Bless')),'Concentration expires and removes effects on all targets');
assert.equal(savingThrow(targets[0],'dex',{random:()=>.5}).total,11);
}
{
const {battle,caster,targets,spell}=setup('Bane');
castSpell(battle,caster,targets[0],spell,1,{map,targets:targets.slice(1,3)},()=>0);
assert.equal(savingThrow(targets[0],'dex',{random:()=>.5}).total,8,'Bane subtracts its d4 after a failed CHA save');
assert.equal(savingThrow(targets[3],'dex',{random:()=>.5}).total,11,'Unselected targets are unaffected');
assert.equal(caster.slots[1].current,2);
}
{
const {battle,caster,targets,spell}=setup('Bane');castSpell(battle,caster,targets[0],spell,1,{map},()=>.99);
assert.equal(targets[0].conditions?.some(effect=>effect.name==='Bane')??false,false,'Successful CHA save prevents Bane');
}
for(const [key,level] of Object.entries(nativeSpellLevels))assert.equal(nativeSpellDefinitions[key].level??0,level);
{
const {battle,caster,targets,spell}=setup('Bless');castSpell(battle,caster,targets[0],spell,1,{map},()=>.5);
startConcentration(battle,caster,'Another spell',60);
assert.equal(targets[0].conditions.some(effect=>effect.name==='Bless'),false,'Replacing concentration removes imported effects');
}
for(const [name,random,ac,expected] of [['Bless',()=>.9,13,'Hit'],['Bane',()=>.999,100,'Critical hit']]){
const {battle,caster,targets,spell}=setup(name);castSpell(battle,caster,targets[0],spell,1,{map},()=>0);
const enemy=makeActor({id:'enemy',name:'Opponent',side:targets[0].side==='party'?'hostile':'party',x:3,y:2,hp:100,maxHp:100,ac});battle.actors.push(enemy);startInitiative(battle,()=>.5);battle.turn=battle.order.indexOf(targets[0].id);
rollStrike(battle,targets[0],enemy,{name:'Test sword',bonus:0,damage:'1d6',type:'slashing'},{map},random);
assert.equal(battle.actionEvents.at(-1).outcome,expected,'Spell modifiers never change which natural d20 values crit');
}
console.log('Imported Bless/Bane execute multi-target selection, slot costs, higher-slot targeting, saves, real attack/save modifiers and concentration expiry. Native bindings match runtime capabilities.');
