import assert from "node:assert/strict";
import {captureImpact, recordAction, withActionEvent} from "../dist/action-events.mjs";
import {d20, log, makeActor, newBattle, rollDice, rollStrike, startInitiative} from "../dist/combat.mjs";

const battle=newBattle();
const hero=makeActor({name:"Adventurer",side:"party",x:2,y:2,hp:30,maxHp:30,initiative:100});
const foe=makeActor({name:"Armored foe",x:3,y:2,hp:50,maxHp:50,ac:14});
battle.actors=[hero,foe];
startInitiative(battle,()=>.5);
assert.equal(battle.actionEvents.filter(event=>event.kind==="initiative").length,2);
let calls=0;
const random=()=>{calls++;return .5;};
const result=rollStrike(battle,hero,foe,{name:"Longsword",bonus:5,damage:"1d6+3",type:"slashing"},{map:{cols:10,rows:10}},random);
const event=battle.actionEvents.at(-1);
assert.equal(calls,2,"Presentation must not roll the attack or damage again");
assert.equal(result.roll.total,16);
assert.equal(foe.hp,43);
assert.equal(event.side,"party");
assert.equal(event.outcome,"Hit");
assert.deepEqual(event.rolls[0].dice,[{faces:20,value:11,sign:1,discarded:false}]);
assert.equal(event.rolls[0].modifier,5);
assert.equal(event.rolls[0].total,16);
assert.equal(event.rolls[1].base,4);
assert.equal(event.rolls[1].modifier,3);
assert.equal(event.impacts[0].amount,7);
assert.ok(event.messages.some(message=>message.includes("hit.")));
assert.ok(event.messages.some(message=>message.includes("7 slashing damage")));
assert.deepEqual(JSON.parse(JSON.stringify(event)).rolls,event.rolls);
const before=battle.actionEvents.length;
assert.throws(()=>rollStrike(battle,hero,foe,{name:"Invalid",bonus:null,damage:"1d6"}),/numeric/);
assert.equal(battle.actionEvents.length,before,"Rejected actions must not create presentation events");

withActionEvent(battle,hero,{action:"Advantage"},()=>{
  const rolls=[.05,.95];
  return d20(4,{advantage:true,random:()=>rolls.shift()});
});
const advantage=battle.actionEvents.at(-1).rolls[0];
assert.equal(advantage.total,24);
assert.equal(advantage.kept,20);
assert.equal(advantage.dice[0].discarded,true);
assert.equal(advantage.dice[1].discarded,false);

withActionEvent(battle,hero,{action:"Large mixed dice pool"},()=>rollDice("100d6-1d4+3",{random:()=>.5}));
const large=battle.actionEvents.at(-1).rolls[0];
assert.equal(large.total,400);
assert.equal(large.base,397);
assert.equal(large.dice.length,24);
assert.equal(large.diceCount,101);
assert.equal(large.modifier,3);

withActionEvent(battle,hero,{action:"Nested"},()=>{
  withActionEvent(battle,foe,{action:"Reaction"},()=>d20(1,{random:()=>.5}));
  log(battle,"The hero continues.");
  captureImpact(battle,hero,{healing:true,amount:3});
});
assert.equal(battle.actionEvents.at(-2).name,"Armored foe");
assert.equal(battle.actionEvents.at(-1).messages[0],"The hero continues.");
for(let i=0;i<80;i++) recordAction(battle,hero,{action:"Movement"});
assert.equal(battle.actionEvents.length,48);
assert.ok(battle.actionEvents.every((event,i,list)=>!i || event.id>list[i-1].id));

console.log("Committed action messages, exact dice and modifiers, advantage, invalid actions, bounded history and nested reactions verified.");
