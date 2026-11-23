import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadRules} from '../dist/rules-library.mjs';
import {makeActor,newBattle,startInitiative,rollStrike,rollDice,movementGroup,moveToken,moveLeft,condition} from '../dist/combat.mjs';
import {withActionEvent} from '../dist/action-events.mjs';
import {diceNotation,visualDice} from '../dist/dice-theatre.mjs';
import {createTokenMotion} from '../dist/token-motion.mjs';
import {movementEvent,cueDuration} from '../dist/combat-cues.mjs';
globalThis.fetch=async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)));await loadRules();
const map={cols:20,rows:12,size:70,width:1400,height:840,offsetX:0,offsetY:0,regions:[]};
function setup({ally=true,weapon='Rapier',bonus=10,asleep=false}={}) {
 const rogue=makeActor({name:'Rogue',side:'party',hp:50,maxHp:50,x:4,y:5,initiative:100,swings:2,classRules:{edition:'2014',traits:['Sneak Attack'],sneakDice:3},attacks:[{name:weapon,bonus,damage:'1d8+4',reach:5}]});
 const target=makeActor({name:'Enemy',hp:1000,maxHp:1000,x:5,y:5,ac:5,conditions:asleep?[{name:'Paralyzed',expires:9999}]:[]});
 const friend=makeActor({name:'Friend',side:'party',hp:50,x:6,y:5});
 const b={...newBattle(),actors:[rogue,target,...(ally?[friend]:[])]};startInitiative(b,()=>.5);return {b,rogue,target,friend};
}
let s=setup();rollStrike(s.b,s.rogue,s.target,s.rogue.attacks[0],{map},()=>.5);
assert.equal(s.b.actionEvents.at(-1).outcome,'Hit','A modified total over twenty is not a critical');assert.equal(s.target.hp,979,'Adjacent party member enables 3d6 Sneak Attack with a saved rapier lacking its finesse flag');
assert.ok(s.b.actionEvents.at(-1).rolls.some(r=>r.label==='Sneak Attack'&&r.dice.length===3));
rollStrike(s.b,s.rogue,s.target,s.rogue.attacks[0],{map},()=>.5);assert.equal(s.target.hp,970,'Sneak Attack applies only once per turn');
for(const options of [{ally:false},{weapon:'Longsword'}]) {s=setup(options);rollStrike(s.b,s.rogue,s.target,s.rogue.attacks[0],{map},()=>.5);assert.equal(s.target.hp,991);}
s=setup();s.friend.conditions=[{name:'Paralyzed',expires:9999}];rollStrike(s.b,s.rogue,s.target,s.rogue.attacks[0],{map},()=>.5);assert.equal(s.target.hp,991);
s=setup({ally:false,asleep:true,bonus:30});rollStrike(s.b,s.rogue,s.target,s.rogue.attacks[0],{map},()=>.5);assert.equal(s.b.actionEvents.at(-1).outcome,'Hit','Incapacitation does not bypass the requested natural-twenty-only rule');
s=setup();let first=true;rollStrike(s.b,s.rogue,s.target,s.rogue.attacks[0],{map},()=>{if(first){first=false;return .999;}return .5;});assert.equal(s.b.actionEvents.at(-1).outcome,'Critical hit');assert.equal(s.target.hp,962,'A kept natural twenty doubles damage dice and Sneak Attack dice, not flat bonuses');
s=setup({ally:false});const rolls=[.999,.2];rollStrike(s.b,s.rogue,s.target,s.rogue.attacks[0],{map,mode:'disadvantage'},()=>rolls.length?rolls.shift():.5);assert.equal(s.b.actionEvents.at(-1).outcome,'Hit','A discarded twenty is not a critical');
withActionEvent(s.b,s.rogue,{action:'Mixed dice'},()=>rollDice('100d6+1d4+1d8+1d10+1d12+1d20',{random:()=>.5}));
let event=s.b.actionEvents.at(-1);assert.equal(diceNotation(event.rolls[0]),'100d6 + 1d4 + 1d8 + 1d10 + 1d12 + 1d20');assert.deepEqual(new Set(visualDice(event.rolls).map(d=>d.faces)),new Set([4,6,8,10,12,20]));
const a=makeActor({name:'A',side:'party',hp:20,x:1,y:1,initiative:20}),b=makeActor({name:'B',side:'party',hp:20,x:1,y:3,initiative:10}),enemy=makeActor({name:'Foe',hp:20,x:15,y:8,initiative:0}),c=makeActor({name:'C',side:'party',hp:20,x:1,y:5,initiative:-10});
let battle={...newBattle(),actors:[a,b,enemy,c]};startInitiative(battle,()=>.5);assert.deepEqual(movementGroup(battle).map(x=>x.id),[a.id,b.id]);moveToken(battle,a,2,1,map);moveToken(battle,b,2,3,map);assert.equal(moveLeft(battle,a),25);assert.equal(moveLeft(battle,b),25);assert.throws(()=>moveToken(battle,c,2,5,map));
let time=0,raf;globalThis.requestAnimationFrame=callback=>{raf=callback;return 1;};globalThis.cancelAnimationFrame=()=>{};
const motion=createTokenMotion(()=>{},()=>time,()=>false),actor=makeActor({name:'Mover',side:'party',hp:20,x:0,y:0});battle={actors:[actor],actionEvents:[]};motion.sync('table',battle);Object.assign(actor,{x:2,y:1});battle.actionEvents=[{id:1,actor:actor.id,kind:'move',action:'Moved 15 ft',distance:15,path:[{x:1,y:0},{x:1,y:1},{x:2,y:1}]}];motion.sync('table',battle);
time=160;raf(time);assert.deepEqual(motion.positions.get(actor.id),{x:1,y:0});assert.equal(actor.x,2,'Visual animation never mutates authoritative state');
Object.assign(actor,{x:3,y:1});battle.actionEvents.push({id:2,actor:actor.id,kind:'move',action:'Moved 5 ft',distance:5,path:[{x:3,y:1}]});motion.sync('table',battle);assert.deepEqual(motion.positions.get(actor.id),{x:1,y:0},'Rapid moves continue from the current visual position');time=3000;raf(time);assert.deepEqual(motion.positions.get(actor.id),{x:3,y:1});assert.equal(motion.remaining(actor.id),0);
assert.equal(cueDuration({kind:'move'}),0);assert.ok(cueDuration({outcome:'Hit',side:'party'})>cueDuration({outcome:'Hit',side:'hostile'}));assert.ok(movementEvent({action:'Moved 10 ft'}));
console.log('Sneak Attack adjacency and once-per-turn costs, natural-twenty crits, all die types, shared movement budgets, path animation, rapid retargeting and message priorities verified.');
