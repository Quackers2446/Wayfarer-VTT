import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {makeActor,newBattle} from '../dist/combat.mjs';import {restParty,shortRestsLeft} from '../dist/class-actions.mjs';import {takeDungeonRest,loadRestEncounters} from '../dist/dungeon-rests.mjs';import {adventureRestPolicies} from '../dist/rest-tables.mjs';
const source=JSON.parse(await readFile(new URL('../dist/rest-encounters.json',import.meta.url)));
const sunless=Object.values(source.policies).find(p=>p.id.startsWith('tftyp-tsc:'));
assert(sunless);assert.equal(sunless.intervalHours,12);assert.equal(sunless.minArea,13);assert.equal(sunless.chance,null);
const hourly={id:'hourly',caption:'Dungeon wandering monsters',faces:20,intervalHours:1,authoredInterval:false,chance:{faces:6,min:1,max:1,authored:false},rows:[{min:1,max:20,text:'{@dice 1d4} {@creature Goblin||goblins}',creatures:[{name:'Goblin',source:'MM',count:'1d4'}]}]};
const data={...source,maps:{...source.maps,'qa|danger':{policies:['hourly'],selection:'hourly'},'qa|sunless':{policies:[sunless.id],selection:sunless.id}},policies:{...source.policies,hourly}};
globalThis.fetch=async()=>new Response(JSON.stringify(data));await loadRestEncounters();
const map={module:'QA',id:'danger',key:'qa:danger',width:900,height:600,size:50,offsetX:0,offsetY:0,cols:18,rows:12,regions:[{id:'area13',points:[[0,0],[900,0],[900,600],[0,600]],entry:{name:'13. Hallway'}}]};
function setup(){const hero=makeActor({id:'hero',name:'Hero',side:'party',x:5,y:5,hp:10,maxHp:57,resources:{ki:{current:0,maximum:5,rest:'short'},rage:{current:0,maximum:3,rest:'long'}},slots:{1:{current:0,maximum:4}}}),battle=newBattle();battle.actors=[hero];return {battle,hero};}
{
 const {battle}=setup();let result=await takeDungeonRest(battle,map,false,{random:()=>.99});assert(result.completed);assert.equal(result.checks,1);assert.equal(battle.actors[0].hp,38);assert.equal(battle.actors[0].resources.ki.current,5);assert.equal(battle.actors[0].resources.rage.current,0);assert.equal(battle.actors[0].slots[1].current,0);assert.equal(shortRestsLeft(battle),1);
 await takeDungeonRest(battle,map,false,{random:()=>.99});assert.equal(shortRestsLeft(battle),0);const before=JSON.stringify(battle);await assert.rejects(takeDungeonRest(battle,map,false),/Both short rests/);assert.equal(JSON.stringify(battle),before);
 result=await takeDungeonRest(battle,map,true,{random:()=>.99});assert.equal(result.checks,8);assert.equal(shortRestsLeft(battle),2);assert.equal(battle.actors[0].hp,57);assert.equal(battle.actors[0].slots[1].current,4);assert.equal(battle.actors[0].resources.rage.current,3);assert.equal(battle.elapsed,36000);
}
{
 const {battle}=setup();const result=await takeDungeonRest(battle,map,true,{random:()=>0});assert(!result.completed);assert.equal(result.elapsed,3600);assert.equal(battle.actors[0].hp,10);assert.equal(battle.actors[0].slots[1].current,0);assert.equal(battle.actors[0].resources.ki.current,0);assert.equal(shortRestsLeft(battle),2);assert.equal(battle.actors.filter(a=>a.side==='hostile').length,1);assert.equal(battle.round,1);assert.equal(battle.actors.at(-1).maxHp,7);assert(battle.actors.at(-1).tokenArt);const before=JSON.stringify(battle);await assert.rejects(takeDungeonRest(battle,map,true),/out of combat/);assert.equal(JSON.stringify(battle),before);
}
{
 const {battle}=setup(),m={...map,id:'sunless',key:'qa:sunless'};
 assert.equal((await takeDungeonRest(battle,m,true,{random:()=>.99})).checks,0);assert.equal((await takeDungeonRest(battle,m,false,{random:()=>.99})).checks,0);assert.equal((await takeDungeonRest(battle,m,false,{random:()=>.99})).checks,0);
 assert.equal((await takeDungeonRest(battle,m,true,{random:()=>.99})).checks,1);assert.equal(battle.rest.encounterProgress[sunless.id],6*3600);
 const safe={...m,regions:[{...m.regions[0],entry:{name:'12. Safe room'}}]};assert.equal((await takeDungeonRest(battle,safe,true,{random:()=>0})).checks,0,'Authored area restrictions are respected');
}
{
 const {battle}=setup();await takeDungeonRest(battle,{...map,id:'safe'},false,{random:()=>{throw Error('Safe maps do not roll.');}});assert.equal(battle.actors[0].hp,38);
}
{
 const {battle}=setup(),before=JSON.stringify(battle);await assert.rejects(takeDungeonRest(battle,map,true,{random:()=>0,loadMonster:async()=>{throw Error('Missing data');}}),/Missing data/);assert.equal(JSON.stringify(battle),before,'Failed encounter preparation never spends rest resources or rerolls committed state');
}
{
 const {battle}=setup();battle.round=1;assert.throws(()=>restParty(battle),/combat/);assert.equal(battle.rest,undefined);
}
console.log('Two short rests, BG3 HP recovery, slot/resource rules, long-rest reset, combat gating, authored timing/area restrictions, eight-vs-one fallback checks, interruption/spawning/initiative and atomic failures verified.');
