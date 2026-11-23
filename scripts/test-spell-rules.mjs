import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {starterRule,ruleProblems,validRuleSet,ruleId} from '../dist/spell-rule-schema.mjs';
import {makeActor,newBattle,startInitiative,castSpell,endTurn,previewMovement,applyDamage,advanceTime,canSee} from '../dist/combat.mjs';
import {customZoneTriggers,moveCustomSphere} from '../dist/custom-spells.mjs';
const records=JSON.parse(await readFile(new URL('../dist/rules.json',import.meta.url),'utf8')).spells;
const map={key:'spell-test',cols:40,rows:25,width:800,height:500,size:20,offsetX:0,offsetY:0,regions:[]};
function setup(name){const source=records.find(spell=>spell.name===name&&spell.source==='PHB'),rule=starterRule(source),battle=newBattle(),caster=makeActor({id:'caster',name:'Caster',side:'party',x:2,y:10,hp:100,maxHp:100,initiative:100,spellDC:15,spellAttack:7,slots:{[rule.level]:{current:3,maximum:3}}}),target=makeActor({id:'target',name:'Target',x:8,y:10,hp:200,maxHp:200,ac:12,saves:{dex:0}});battle.actors=[caster,target];battle.spellRules={[rule.reference]:rule};startInitiative(battle,()=>.45);return {source,rule,battle,caster,target,spell:{name,key:name.toLowerCase(),reference:rule.reference,edition:'2014',level:rule.level}};}
{
 const {rule,battle,caster,target,spell}=setup('Wall of Fire');assert.deepEqual(ruleProblems(rule),[]);castSpell(battle,caster,target,spell,4,{map,square:{x:8,y:6},end:{x:8,y:16},hotSide:'left'},()=>.45);assert.equal(caster.slots[4].current,2);assert.equal(target.hp,180);assert(caster.concentration);assert.equal(battle.spellZones.length,1);assert.equal(canSee(battle,caster,{x:10,y:10},map),false);
 const first=target.hp;customZoneTriggers(battle,target,'enter',{x:7,y:10},()=>.45);assert.equal(target.hp,first-20);customZoneTriggers(battle,target,'enter',{x:7,y:10},()=>.45);assert.equal(target.hp,first-20,'First-entry damage occurs once per turn');
 applyDamage(battle,caster,100,'force',false,()=>.45,target);assert.equal(battle.spellZones.length,0,'Loss of concentration removes the wall');
}
{
 const {rule,battle,caster,target,spell}=setup('Ice Storm');castSpell(battle,caster,target,spell,4,{map,square:{x:8,y:10}},()=>.45);assert.equal(target.hp,180,'Both damage types apply');assert(!caster.concentration);assert.equal(battle.spellZones[0].blocksVision,false);assert(canSee(battle,caster,target,map));
 const route=previewMovement(battle,caster,5,10,map);assert(route.cost>15,'Ice terrain affects movement');endTurn(battle,()=>.45);endTurn(battle,()=>.45);assert.equal(battle.spellZones.length,1,'Terrain remains until the end of the caster’s next turn');endTurn(battle,()=>.45);assert.equal(battle.spellZones.length,0);
}
{
 const {rule,battle,caster,target,spell}=setup('Flaming Sphere');castSpell(battle,caster,target,spell,2,{map,square:{x:7,y:10}},()=>.45);assert.equal(target.hp,200,'A sphere does not damage on creation');moveCustomSphere(battle,caster,battle.spellZones[0].id,{x:8,y:10},map,()=>.45);assert.equal(target.hp,194);assert(battle.bonusUsed);assert.equal(caster.slots[2].current,2);assert.throws(()=>moveCustomSphere(battle,caster,battle.spellZones[0].id,{x:9,y:10},map),/bonus action/);customZoneTriggers(battle,target,'end',undefined,()=>.45);assert.equal(target.hp,188);
 advanceTime(battle,61);assert.equal(battle.spellZones.length,0,'Duration cleanup removes expired spheres');
}
{
 const {rule,battle,caster,target,spell}=setup('Ice Storm');const invalid=structuredClone(rule);invalid.effects[0].damage[0].formula='globalThis.bad=1';assert(ruleProblems(invalid).length);assert(!validRuleSet({[rule.reference]:invalid}));
 const snapshot=JSON.parse(JSON.stringify(battle.spellRules));rule.effects[0].damage[0].formula='40d20';assert.equal(snapshot[rule.reference].effects[0].damage[0].formula,'2d8','Saved room rules do not follow dashboard edits');
}
console.log('Spell schema, source starters, casting/slots, mixed damage, saves, wall vision/entry limits/concentration, Ice Storm terrain/expiry, sphere controls/bonus actions/duration and rule snapshots verified.');
