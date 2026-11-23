import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadRules} from '../dist/rules-library.mjs';
import {makeActor,newBattle,startInitiative,endTurn,currentActor,turnView,sharedTurnGroup,canTakeTurn,rollStrike,castSpell,turnAction,moveToken,moveLeft,deathSave,checkSpellTethers} from '../dist/combat.mjs';
import {useClassAction} from '../dist/class-actions.mjs';
import {entryReason,renderActionResources} from '../dist/action-bar.mjs';
globalThis.fetch=async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)));await loadRules();
const map={cols:20,rows:12,width:1400,height:840,size:70,offsetX:0,offsetY:0,regions:[]};
function fixture() {
 const a=makeActor({name:'Mage',side:'party',initiative:30,hp:50,x:3,y:3,spells:[],slots:{1:{current:2,maximum:2}},spellAttack:6,spellAbility:3,spellDC:14});
 const b=makeActor({name:'Monk',side:'party',initiative:20,hp:50,x:4,y:3,swings:2,attacks:[{name:'Unarmed Strike',damage:'1d6+4',bonus:8,unarmed:true,monkWeapon:true}],classRules:{edition:'2014',traits:['Flurry of Blows','Step of the Wind'],unarmoredMonk:true,martialDie:6,levels:{Monk:9}},resources:{ki:{name:'Ki',current:9,max:9}}});
 const foe=makeActor({name:'Foe',initiative:0,hp:1000,maxHp:1000,x:5,y:3,ac:10,attacks:[]});
 const later=makeActor({name:'Later',side:'party',initiative:-10,hp:50,x:2,y:6});
 const battle={...newBattle(),actors:[a,b,foe,later]};startInitiative(battle,()=>.5);return {a,b,foe,later,battle};
}
let {a,b,foe,later,battle}=fixture();
assert.deepEqual(sharedTurnGroup(battle),[a,b]);assert.equal(canTakeTurn(battle,b),true);assert.equal(canTakeTurn(battle,later),false);
assert.equal(entryReason(b,battle,{mode:'weapon',timing:'action',usable:true}),'');
rollStrike(battle,b,foe,b.attacks[0],{map},()=>.5);assert.equal(turnView(battle,b).attacksMade,1);assert.equal(battle.action,null);assert.equal(battle.attacksMade,0);
useClassAction(battle,b,'flurry',{},()=>.5);assert.equal(b.resources.ki.current,8);assert.equal(turnView(battle,b).bonusUsed,true);assert.equal(battle.bonusUsed,false);
rollStrike(battle,b,foe,b.attacks[0],{map,bonusStrike:true},()=>.5);assert.equal(turnView(battle,b).flurry,1);
assert.equal(turnView(battle,a).flurry,0);
castSpell(battle,a,foe,{name:'Magic Missile',key:'magic missile',edition:'2014',level:1},1,{map},()=>.5);
assert.equal(a.slots[1].current,1);assert.equal(battle.action,'cast');assert.equal(turnView(battle,b).action,'attack');
rollStrike(battle,b,foe,b.attacks[0],{map},()=>.5);assert.throws(()=>rollStrike(battle,b,foe,b.attacks[0],{map},()=>.5),/attacks/);
assert.match(renderActionResources(a,battle),/Action spent/);assert.match(renderActionResources(b,battle),/Bonus spent/);
assert.throws(()=>turnAction(battle,later,'dash'),/turn/);
// Ending the leader promotes the next member without restoring already-used budgets or reactions.
moveToken(battle,b,4,2,map);b.reactionUsed=true;endTurn(battle,()=>.5,a);
assert.equal(currentActor(battle),b);assert.equal(battle.attacksMade,2);assert.equal(battle.bonusUsed,true);assert.equal(battle.flurry,1);assert.equal(moveLeft(battle,b),25);assert.equal(b.reactionUsed,true);
assert.throws(()=>rollStrike(battle,b,foe,b.attacks[0],{map},()=>.5),/attacks/);
assert.throws(()=>castSpell(battle,a,foe,{name:'Magic Missile',key:'magic missile',edition:'2014',level:1},1,{map}),/turn/);
endTurn(battle,()=>.5,b);assert.equal(currentActor(battle),foe);assert.equal(canTakeTurn(battle,b),false);
endTurn(battle,()=>.5);assert.equal(currentActor(battle),later);assert.equal(canTakeTurn(battle,a),false);
endTurn(battle,()=>.5);assert.equal(battle.round,2);assert.equal(currentActor(battle),a);assert.equal(turnView(battle,b).action,null);assert.equal(turnView(battle,b).flurry,0);assert.equal(moveLeft(battle,b),30);assert.equal(b.reactionUsed,false);
// A guest may finish first, and an ended member cannot act or finish twice.
({a,b,foe,battle}=fixture());turnAction(battle,b,'dash');assert.equal(moveLeft(battle,b),60);assert.equal(moveLeft(battle,a),30);
endTurn(battle,()=>.5,b);assert.equal(currentActor(battle),a);assert.equal(canTakeTurn(battle,b),false);assert.throws(()=>endTurn(battle,()=>.5,b),/cannot end/);
turnAction(battle,a,'dodge');endTurn(battle,()=>.5,a);assert.equal(currentActor(battle),foe);
// Round-trip through shared session JSON retains each independent budget.
({a,b,battle}=fixture());turnAction(battle,b,'dash');const copy=JSON.parse(JSON.stringify(battle)),savedB=copy.actors.find(actor=>actor.id===b.id);
assert.equal(moveLeft(copy,savedB),60);assert.equal(turnView(copy,savedB).action,'dash');assert.equal(copy.action,null);
// Legacy saved battles retain early movement and partial leader turns.
delete battle.sharedTurns;delete battle.sharedEnded;battle.earlyMovement={[b.id]:10};battle.action='dodge';assert.equal(moveLeft(battle,b),20);assert.equal(turnView(battle,b).action,null);assert.equal(battle.action,'dodge');
// An older save in the middle of a party block must not reopen earlier, completed turns.
({a,b,foe,battle}=fixture());battle.turn=1;delete battle.sharedTurns;delete battle.sharedEnded;
assert.equal(canTakeTurn(battle,a),false);assert.equal(canTakeTurn(battle,b),true);
endTurn(battle,()=>.5,b);assert.equal(currentActor(battle),foe);
// A non-leader caster has their own spellcasting restrictions and slot costs.
({a,b,foe,battle}=fixture());b.slots={1:{current:2,maximum:2},2:{current:2,maximum:2}};b.spellAttack=6;b.spellAbility=3;b.spellDC=14;
castSpell(battle,b,null,{name:'Misty Step',key:'misty step',edition:'2014',level:2},2,{map,square:{x:4,y:5}},()=>.5);
assert.equal(b.slots[2].current,1);assert.equal(turnView(battle,b).bonusUsed,true);assert.equal(battle.bonusUsed,false);assert.equal(battle.cast,null);
assert.throws(()=>castSpell(battle,b,foe,{name:'Magic Missile',key:'magic missile',edition:'2014',level:1},1,{map},()=>.5),/cantrip/);
assert.equal(b.slots[1].current,2);
castSpell(battle,b,foe,{name:'Fire Bolt',key:'fire bolt',edition:'2014',level:0},0,{map},()=>.5);assert.equal(turnView(battle,b).action,'cast');assert.equal(battle.action,null);
castSpell(battle,a,foe,{name:'Magic Missile',key:'magic missile',edition:'2014',level:1},1,{map},()=>.5);assert.equal(a.slots[1].current,1);
// Ongoing spell action requirements inspect the caster's budget, even while another PC leads.
({a,b,foe,battle}=fixture());b.slots={1:{current:1,maximum:1}};b.spellAttack=7;b.classRules.traits.push('Action Surge');b.resources.actionSurge={current:1,maximum:1};
castSpell(battle,b,foe,{name:'Witch Bolt',key:'witch bolt',edition:'2014',level:1},1,{map},()=>.5);assert.ok(b.concentration?.bolt);
useClassAction(battle,b,'action-surge');turnAction(battle,b,'dodge');checkSpellTethers(battle,map);assert.equal(Boolean(b.concentration),false);
// Death saves and their end-turn requirement belong to the dying character.
({a,b,battle}=fixture());b.hp=0;b.resolveDeath=true;
assert.throws(()=>endTurn(battle,()=>.5,b),/death save/);deathSave(battle,b,()=>.5);
assert.equal(turnView(battle,b).deathRolled,true);assert.equal(battle.deathRolled,false);endTurn(battle,()=>.5,b);assert.equal(currentActor(battle),a);
// Four characters may act and finish in any order, including ended members between pending ones.
({a,b,foe,battle}=fixture());
const c=makeActor({name:'Third',side:'party',initiative:15,hp:20,x:2,y:6}),d=makeActor({name:'Fourth',side:'party',initiative:10,hp:20,x:2,y:8});
battle.round=0;battle.actors=[a,b,c,d,foe];startInitiative(battle,()=>.5);
for(const member of [d,b,a,c]) turnAction(battle,member,'dash');
for(const member of [a,b,c,d]) {assert.equal(turnView(battle,member).action,'dash');assert.equal(moveLeft(battle,member),60);}
endTurn(battle,()=>.5,b);endTurn(battle,()=>.5,d);assert.equal(currentActor(battle),a);
endTurn(battle,()=>.5,a);assert.equal(currentActor(battle),c);assert.equal(battle.action,'dash');assert.equal(battle.dash,30);
endTurn(battle,()=>.5,c);assert.equal(currentActor(battle),foe);
endTurn(battle,()=>.5);assert.equal(battle.round,2);for(const member of [a,b,c,d]) assert.equal(turnView(battle,member).action,null);
console.log('Shared attacks, spells, Ki, bonus actions, Flurry, movement, end-turn order, budget preservation, enemy barriers, next-round refresh and saved-session migration verified.');
