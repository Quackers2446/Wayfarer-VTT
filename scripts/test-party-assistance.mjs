import assert from 'node:assert/strict';
import {makeActor,newBattle,startInitiative,helpUp,throwHealingPotion,castSpell,supportedSpell} from '../dist/combat.mjs';
import {partyEscaped} from '../dist/exploration.mjs';
import {createHealthPresentation} from '../dist/health-presentation.mjs';
import {buildActionBar} from '../dist/action-bar.mjs';
const map={cols:60,rows:20,regions:[]};
function fixture(){const battle=newBattle(),hero=makeActor({id:'hero',name:'Helper',side:'party',x:2,y:2,hp:30,maxHp:30,initiative:100}),ally=makeActor({id:'ally',name:'Ally',side:'party',x:3,y:2,hp:0,maxHp:20,resolveDeath:true,prone:true}),foe=makeActor({id:'foe',name:'Enemy',side:'hostile',x:5,y:2,hp:30,maxHp:30});battle.actors=[hero,ally,foe];startInitiative(battle,()=>.5);return {battle,hero,ally,foe};}
{
 const {battle,hero,ally}=fixture();ally.failures=2;ally.successes=1;
 const bar=buildActionBar(hero,battle,[]);assert(bar.some(entry=>entry.actionId==='interact'),'Body actions are grouped under Interact');
 helpUp(battle,hero,ally,map);assert.equal(ally.hp,1);assert.equal(ally.prone,false);assert.equal(ally.failures,0);assert.equal(ally.successes,0);assert.equal(battle.action,'help-up');assert.equal(battle.actionEvents.at(-1).healthChanges[0].before.hp,0);assert.throws(()=>helpUp(battle,hero,ally,map),/used its action/);
}
{
 const {battle,hero,ally}=fixture();ally.x=8;assert.throws(()=>helpUp(battle,hero,ally,map),/5 feet/);assert.equal(battle.action,null);
 const item={name:'Potion of Healing',formula:'2d4+2',quantity:2};hero.potions=[item];throwHealingPotion(battle,hero,ally,item,map,()=>.5);assert.equal(ally.hp,8);assert.equal(item.quantity,1);assert.equal(battle.action,'throw-potion');assert.equal(battle.actionEvents.at(-1).rolls[0].total,8);
}
{
 const {battle,hero,ally}=fixture(),item={name:'Potion',formula:'2d4+2',quantity:1};hero.potions=[item];ally.x=20;assert.throws(()=>throwHealingPotion(battle,hero,ally,item,map),/30 feet/);assert.equal(item.quantity,1);assert.equal(battle.action,null);
 ally.x=3;ally.dead=true;assert.throws(()=>throwHealingPotion(battle,hero,ally,item,map),/target on the grid|dead creature/);assert.equal(item.quantity,1);
}
{
 const {battle,hero,ally,foe}=fixture();hero.x=25;ally.x=3;assert.equal(partyEscaped(battle),false,'A downed ally still near enemies prevents party escape');ally.x=26;assert.equal(partyEscaped(battle),true);foe.x=7;hero.x=25;assert.equal(partyEscaped(battle),false,'Exactly 90 feet is still combat');
}
{
 const {battle,hero,ally}=fixture();hero.spellAbility=3;hero.slots={1:{current:2,max:2}};
 assert(supportedSpell('cure wounds'));castSpell(battle,hero,ally,{name:'Cure Wounds',key:'cure wounds',edition:'2014',level:1},1,{map},()=>.5);assert.equal(ally.hp,8);assert.equal(hero.slots[1].current,1);
}
{
 const {battle,hero}=fixture();battle.round=0;battle.order=[];hero.spellDC=14;hero.slots={3:{current:1,max:1}};
 castSpell(battle,hero,null,{name:'Fireball',key:'fireball',edition:'2014',level:3},3,{map,square:{x:15,y:10}},()=>.5);assert.equal(hero.slots[3].current,0,'Empty point casts spend their slot without requiring an enemy');
}
{
 const display=createHealthPresentation(),base={id:1},hit={id:2,healthChanges:[{actor:'hero',before:{hp:30,dead:false},after:{hp:20,dead:false}}]},heal={id:3,healthChanges:[{actor:'hero',before:{hp:20,dead:false},after:{hp:25,dead:false}}]};
 display.sync('room',[base]);display.sync('room',[base,hit,heal]);assert.equal(display.actor({id:'hero',hp:25}).hp,30);display.reveal(hit);assert.equal(display.actor({id:'hero',hp:25}).hp,20);display.reveal(heal);assert.equal(display.actor({id:'hero',hp:25}).hp,25);
 display.sync('other',[hit,heal]);assert.equal(display.actor({id:'hero',hp:25}).hp,25,'Historical damage does not animate when joining a room');
}
console.log('Help Up, potion action/range/consumption, allied spells, arbitrary point spells, party escape and ordered HP presentation verified.');
