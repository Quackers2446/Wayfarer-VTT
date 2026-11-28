import assert from 'node:assert/strict';
import {makeActor,newBattle,startInitiative,applyDamage,endInitiative,exploreToken,speedOf,heal,canStand,previewMovement,occupies} from '../dist/combat.mjs';
import {takeLoot,carryBody,dragBody,dropBody,placeBody,lootContents,syncRewardSheets,releaseRevivedBodies} from '../dist/world-interactions.mjs';
import {rollStrike,castSpell,handsOccupied,spellNeedsHands} from '../dist/combat.mjs';
import {xpForCR} from '../dist/encounter-rewards.mjs';
import {automaticRoom} from '../dist/scene-data.mjs';
const map={key:'qa',cols:40,rows:20,width:400,height:200,size:10,offsetX:0,offsetY:0,regions:[]};
function fixture(){const battle=newBattle(),hero=makeActor({id:'party:a',name:'Hero',side:'party',x:2,y:2,hp:30,maxHp:30,ability:{str:2},initiative:100,items:[],potions:[]}),ally=makeActor({id:'party:b',name:'Ally',side:'party',x:2,y:3,hp:20,maxHp:20}),foe=makeActor({id:'foe',name:'Goblin',side:'hostile',creatureSize:'S',x:3,y:2,hp:7,maxHp:7,cr:'1/4',loot:[{name:'Scimitar',quantity:1,reference:'phb|scimitar'}]});battle.actors=[hero,ally,foe];return {battle,hero,ally,foe};}
{
 const {battle,hero,ally,foe}=fixture();startInitiative(battle,()=>.5);applyDamage(battle,foe,10,'slashing',false,()=>.5,hero);assert.equal(hero.xp,30);assert.equal(ally.xp,25);assert.equal(foe.xpAwards[0].bonus,5);applyDamage(battle,foe,5,'fire',false,()=>.5,hero);assert.equal(hero.xp,30,'A corpse cannot award XP twice');assert(foe.dead);assert.equal(foe.x,3);
 endInitiative(battle);battle.sheets={[hero.id]:{items:[],xp:0}};takeLoot(battle,hero,foe,map);assert.equal(hero.items[0].name,'Scimitar');assert.equal(foe.loot[0].quantity,0);assert.equal(battle.sheets[hero.id].items[0].quantity,1);assert.equal(battle.sheets[hero.id].xp,30);assert.throws(()=>takeLoot(battle,hero,foe,map),/Nothing remains/);
}
{
 const {battle,hero,foe}=fixture();foe.dead=true;foe.hp=0;carryBody(battle,hero,foe,map);assert.equal(hero.carrying,foe.id);assert.equal(speedOf(hero),15);exploreToken(battle,hero,5,2,map,()=>false);assert.equal(foe.x,5);assert.equal(foe.y,2);placeBody(battle,hero,foe,{x:6,y:2},map);assert.equal(foe.carriedBy,null);assert.equal(hero.carrying,null);assert(foe.dead);assert.equal(speedOf(hero),30);
 carryBody(battle,hero,foe,map);placeBody(battle,hero,foe,{x:8,y:2},map,{thrown:true},()=>.5);assert.equal(foe.x,8);assert(foe.dead);
}
{
 const {battle,hero,foe}=fixture();foe.hp=0;foe.resolveDeath=true;foe.creatureSize='H';assert.throws(()=>carryBody(battle,hero,foe,map),/heavy/);foe.creatureSize='S';carryBody(battle,hero,foe,map);assert.throws(()=>placeBody(battle,hero,foe,{x:30,y:2},map,{thrown:true}),/20 feet/);assert.equal(hero.carrying,foe.id);placeBody(battle,hero,foe,{x:5,y:2},map,{thrown:true},()=>.5);assert.equal(foe.failures,1);assert(!foe.dead);
}
{
 const {battle,hero}=fixture(),source={name:'Chest',x:3,y:3,items:[{name:'Potion of Healing',quantity:2}],lootCurrency:{gp:35,sp:7}};takeLoot(battle,hero,source,map);assert.equal(hero.potions[0].quantity,2);assert.equal(hero.currency.gp,35);assert.equal(hero.currency.sp,7);assert(source.looted);
}
{
 const {battle,hero,foe}=fixture();foe.dead=true;foe.hp=0;startInitiative(battle,()=>.5);battle.round=1;carryBody(battle,hero,foe,map);assert.equal(battle.action,'carry-body');assert.throws(()=>placeBody(battle,hero,foe,{x:6,y:2},map,{thrown:true}),/used its action/);assert.equal(foe.carriedBy,hero.id);
}
{
 const room=automaticRoom({entry:{name:'Room',entries:[{type:'entries',name:'Treasure',entries:['The chest holds two {@item potion of healing|DMG}, 60 sp and 20 gp.','A silver comb worth 100 gp lies here.']}] }},new Set());
 const potion=room.markers.find(m=>m.items?.[0]?.name==='potion of healing');assert(potion);assert.equal(potion.items[0].quantity,2);const coins=room.markers.filter(m=>m.lootCurrency);assert.equal(coins[0].lootCurrency.sp,60);assert.equal(coins[0].lootCurrency.gp,20);assert.equal(coins.length,1,'An item valuation is not loose currency');assert(room.markers.some(marker=>marker.items?.some(item=>item.name==='silver comb')));
 assert.equal(xpForCR('1/8'),25);assert.equal(xpForCR({cr:'0',xp:0}),0);
}
{
 const {battle,hero,ally,foe}=fixture();foe.dead=true;foe.hp=0;carryBody(battle,hero,foe,map);
 const target=makeActor({id:'target',name:'Enemy',side:'hostile',x:5,y:2,hp:1,maxHp:1,ac:10,cr:'1/4'});battle.actors.push(target);startInitiative(battle,()=>.5);
 placeBody(battle,hero,foe,{x:5,y:2},map,{thrown:true},()=>.95);assert(target.dead);assert.equal(battle.action,'throw-body');assert.equal(hero.xp,30);assert.equal(ally.xp,25);assert.equal(battle.actionEvents.at(-1).outcome,'Critical hit');assert.equal(foe.carriedBy,null);
}
{
 const {battle,hero,foe}=fixture();foe.hp=0;foe.resolveDeath=true;carryBody(battle,hero,foe,map);heal(foe,3);releaseRevivedBodies(battle,map);assert.equal(foe.carriedBy,null);assert.equal(hero.carrying,null);assert.equal(foe.hp,3);
}
{
 const {battle,hero,foe}=fixture();foe.hp=0;foe.resolveDeath=true;foe.creatureSize='H';
 assert.throws(()=>carryBody(battle,hero,foe,map),/Drag instead|heavy/);
 dragBody(battle,hero,foe,map);assert.equal(hero.dragging,foe.id);assert.equal(foe.draggedBy,hero.id);assert.equal(speedOf(hero),15);assert(handsOccupied(hero));
 assert.equal(foe.x,3);assert.equal(foe.y,2,'Drag leaves the body on its square until you move');
 exploreToken(battle,hero,5,2,map,()=>false);assert.equal(hero.x,5);assert.equal(hero.y,2);
 assert.equal(foe.x,4);assert.equal(foe.y,2,'Dragged body trails one square behind');
 const dummy=makeActor({id:'dummy',name:'Dummy',side:'hostile',x:6,y:2,hp:5,maxHp:5,ac:10});battle.actors.push(dummy);
 startInitiative(battle,()=>.5);battle.round=1;battle.order=[hero.id,dummy.id];battle.turn=0;
 assert.throws(()=>rollStrike(battle,hero,dummy,{name:'Sword',bonus:5,damage:'1d8+2'},{map}),/Dragging|hands/);
 assert.throws(()=>castSpell(battle,hero,dummy,{name:'Fire Bolt',key:'fire bolt',edition:'2014',level:0,components:{v:true,s:true}},0,{map}),/Dragging|Somatic/);
 assert.equal(spellNeedsHands({components:{v:true}}),false);
 assert.equal(spellNeedsHands({components:{v:true,s:true}}),true);
 endInitiative(battle);
 dropBody(battle,hero,foe,map);assert.equal(hero.dragging,null);assert.equal(foe.draggedBy,null);assert.equal(speedOf(hero),30);assert(!handsOccupied(hero));
 assert(Math.abs(foe.x-hero.x)<=1&&Math.abs(foe.y-hero.y)<=1);
}
{
 const {battle,hero,foe}=fixture();foe.dead=true;foe.hp=0;
 assert.equal(occupies(foe),false);
 assert.equal(canStand(battle,hero,foe.x,foe.y,map),true,'Dead bodies do not block standing');
 assert.ok(previewMovement(battle,hero,foe.x,foe.y,map),'Dead bodies do not block pathing');
 exploreToken(battle,hero,foe.x,foe.y,map,()=>false);
 assert.equal(hero.x,foe.x);assert.equal(hero.y,foe.y);
 takeLoot(battle,hero,foe,map);assert.equal(hero.items[0].name,'Scimitar');
}
console.log('CR XP and final-blow shares; once-only rewards; persistent item/coin loot; potion pickup; body carry/move/place/throw; drag/drop with half speed and hand locks; walk-over corpses with underfoot loot; weight, range and action limits; source treasure parsing verified.');
