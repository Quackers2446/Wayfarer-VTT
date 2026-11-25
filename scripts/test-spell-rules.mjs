import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {buildActionBar,entryReason} from '../dist/action-bar.mjs';
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
 const {rule,battle,caster,target,spell}=setup('Flaming Sphere');castSpell(battle,caster,target,spell,2,{map,square:{x:7,y:10}},()=>.45);assert.equal(target.hp,200,'A sphere does not damage on creation');const entries=buildActionBar(caster,battle,[{mode:'spell',data:spell,usable:true}],{canAct:true});assert.equal(entries.filter(entry=>entry.mode==='spell').length,1);assert(!entries.some(entry=>entry.id.startsWith('zone:')));assert.equal(entryReason(caster,battle,entries.find(entry=>entry.mode==='spell')),'','One spell icon remains usable for bonus-action sphere control after casting');moveCustomSphere(battle,caster,battle.spellZones[0].id,{x:8,y:10},map,()=>.45);assert.equal(target.hp,194);assert(battle.bonusUsed);assert.equal(caster.slots[2].current,2);assert.throws(()=>moveCustomSphere(battle,caster,battle.spellZones[0].id,{x:9,y:10},map),/bonus action/);customZoneTriggers(battle,target,'end',undefined,()=>.45);assert.equal(target.hp,188);
 advanceTime(battle,61);assert.equal(battle.spellZones.length,0,'Duration cleanup removes expired spheres');
}
{
 const {rule,battle,caster,target,spell}=setup('Ice Storm');const invalid=structuredClone(rule);invalid.effects[0].damage[0].formula='globalThis.bad=1';assert(ruleProblems(invalid).length);assert(!validRuleSet({[rule.reference]:invalid}));
 const snapshot=JSON.parse(JSON.stringify(battle.spellRules));rule.effects[0].damage[0].formula='40d20';assert.equal(snapshot[rule.reference].effects[0].damage[0].formula,'2d8','Saved room rules do not follow dashboard edits');
}
{
 const setupCase=setup('Wall of Fire'),{rule,battle,caster,target}=setupCase;
 Object.assign(rule,{shape:'target',persistent:false,concentration:false,blocksVision:false,attack:true,effects:[{trigger:'cast',area:'footprint',save:'',onSave:'none',condition:'',damage:[{formula:'1d6',type:'fire',upcast:''}]}]});
 const rolls=[0,.95,.45,.45];castSpell(battle,caster,target,setupCase.spell,4,{map,mode:'advantage'},()=>rolls.shift()??.45);assert.equal(battle.actionEvents.at(-1).outcome,'Critical hit');assert.equal(battle.actionEvents.at(-1).rolls[0].dice.length,2,'Configured spell attacks honor advantage');
}
console.log('Spell schema, source starters, casting/slots, mixed damage, saves, wall vision/entry limits/concentration, Ice Storm terrain/expiry, sphere controls/bonus actions/duration and rule snapshots verified.');
// Healing uses the same resource checks, with explicit creature exclusions and ability scaling.
{
 const {rule,battle,caster,target,spell}=setup('Cure Wounds');
 Object.assign(rule,{range:30,effects:[{kind:'healing',excludeUndeadConstructs:true,trigger:'cast',area:'footprint',save:'',onSave:'none',condition:'',damage:[{formula:'1d8',type:'force',upcast:'1d8',addAbility:true}]}]});
 caster.spellAbility=3;caster.slots[2]={current:2,maximum:2};target.hp=0;target.dead=false;target.failures=2;target.successes=1;
 assert.deepEqual(ruleProblems(rule),[]);castSpell(battle,caster,target,spell,2,{map},()=>.45);
 assert.equal(target.hp,11,'Higher-slot healing includes extra dice and the ability modifier once');assert.equal(target.failures,0);assert.equal(target.successes,0);assert.equal(caster.slots[2].current,1);
 battle.action=null;target.creatureType='undead';assert.throws(()=>castSpell(battle,caster,target,spell,2,{map}),/excludes/);assert.equal(caster.slots[2].current,1,'Invalid healing targets do not spend a slot');
 target.creatureType='humanoid';target.hp=199;castSpell(battle,caster,target,spell,2,{map},()=>.45);assert.equal(target.hp,200,'Healing is capped at maximum HP');
 const malformed=structuredClone(rule);malformed.effects[0].damage=[null];assert(ruleProblems(malformed).length);malformed.effects={};assert(ruleProblems(malformed).length);
}
for(const [level,dice] of [[1,1],[5,2],[11,3],[17,4]]){
 const {rule,battle,caster,target,spell}=setup('Fire Bolt');
 Object.assign(rule,{range:120,attack:true,effects:[{kind:'damage',trigger:'cast',area:'footprint',save:'',onSave:'none',condition:'',damage:[{formula:'1d10',type:'fire',upcast:'1d10',scaleWithCaster:true}]}]});caster.level=level;
 assert.deepEqual(ruleProblems(rule),[]);castSpell(battle,caster,target,spell,0,{map},()=>.6);assert.equal(target.hp,200-7*dice,'Cantrip scales at level '+level);assert.equal(caster.slots[0].current,3,'Cantrips spend no slot');
}
console.log('Healing, ability modifiers, upcasting, cantrip tiers and malformed rule validation verified.');
{
 const {rule,battle,caster,target,spell}=setup('Flaming Sphere');caster.spellAbility=3;rule.effects.forEach(block=>block.damage.forEach(component=>component.addAbility=true));
 castSpell(battle,caster,target,spell,2,{map,square:{x:7,y:10}},()=>.45);caster.spellAbility=9;customZoneTriggers(battle,target,'end',undefined,()=>.45);assert.equal(target.hp,191,'Persistent effects retain the casting ability at creation');
}
{
 const {rule,battle,caster,target,spell}=setup('Cure Wounds');Object.assign(rule,{range:30,effects:[{kind:'healing',trigger:'cast',area:'footprint',save:'',onSave:'none',condition:'',damage:[{formula:'1d8',type:'force',upcast:'',addAbility:true}]}]});caster.spellAbility=-2;target.hp=10;castSpell(battle,caster,target,spell,1,{map},()=>.45);assert.equal(target.hp,12,'Negative ability modifiers reduce healing');battle.action=null;target.dead=true;assert.throws(()=>castSpell(battle,caster,target,spell,1,{map}),/Choose a creature/);assert.equal(caster.slots[1].current,2,'Ordinary healing cannot resurrect a dead character or spend a slot trying');
}

for (const shape of ['circle', 'point']) {
 const {rule,battle,caster,target,spell}=setup('Fireball');
 const square={x:9,y:10};
 rule.shape=shape;
 assert.deepEqual(ruleProblems(rule),[]);
 assert.throws(()=>castSpell(battle,caster,target,spell,3,{map},()=>.45),/Choose a point/);
 assert.throws(()=>castSpell(battle,caster,null,spell,3,{map,square:{x:34,y:10}},()=>.45),/in range/);
 assert.equal(caster.slots[3].current,3);
 castSpell(battle,caster,null,spell,3,{map,square},()=>.45);
 assert.equal(caster.slots[3].current,2);
 assert.equal(target.hp,shape==='circle'?176:200,'An empty point is valid and only the selected footprint affects creatures');
}
console.log('Fireball and single-square point casts use map coordinates, validate range before spending slots, and apply the selected footprint.');
