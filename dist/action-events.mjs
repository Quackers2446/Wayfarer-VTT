// Presentation records travel with the committed encounter. Dice are rolled once
// by the rules engine; every connected browser displays those same results.
import {creatureSize} from './actor-space.mjs';
let capture;
function presentationDice(dice,limit=24) {
  const chosen=new Set(),types=new Set();
  for(let i=0;i<dice.length && chosen.size<limit;i++) {const key=dice[i].faces+':'+dice[i].sign;if(!types.has(key)) {types.add(key);chosen.add(i);}}
  for(let i=0;i<dice.length && chosen.size<limit;i++) chosen.add(i);
  return [...chosen].sort((a,b)=>a-b).map(i=>dice[i]);
}
function diceKinds(dice) {
  const kinds=new Map();
  for(const die of dice) {const key=die.faces+':'+(die.sign ?? 1);if(!kinds.has(key)) kinds.set(key,{faces:die.faces,sign:die.sign ?? 1,count:0});kinds.get(key).count++;}
  return [...kinds.values()];
}

export function captureRoll(result, details) {
  capture?.rolls.push({result,details});
}

export function captureMessage(battle, message) {
  if (capture?.battle === battle) capture.messages.push(message);
}

export function captureImpact(battle, actor, details) {
  if (capture?.battle === battle) capture.impacts.push({actor:actor.id,x:actor.x,y:actor.y,creatureSize:creatureSize(actor),...details});
}

function append(battle, actor, event) {
  if (!actor) return;
  const events = battle.actionEvents ??= [...(battle.monsterEvents ?? [])];
  events.push({id:(events.at(-1)?.id ?? 0)+1,actor:actor.id,name:actor.name,side:actor.side,
    x:actor.x,y:actor.y,creatureSize:creatureSize(actor),...event});
  if (events.length > 48) events.splice(0,events.length-48);
  while (events.length>1 && JSON.stringify(events).length>120000) events.shift();
}

export function recordAction(battle, actor, event) {
  if (capture?.battle === battle && capture.actor === actor) {
    Object.assign(capture.details,event);
  } else append(battle,actor,event);
}

export function withActionEvent(battle, actor, details, run) {
  const previous = capture;
  const current = {battle,actor,details:{...details},messages:[],rolls:[],impacts:[]};
  capture = current;
  try {
    const result = run();
    const rolls = current.rolls.slice(0,24).map(({result,details}) => ({...details,
      dice:presentationDice(details.dice),diceCount:details.dice.length,diceKinds:diceKinds(details.dice),
      total:result.total,breakdown:result.breakdown.slice(0,600),
      ...(result.kept != null ? {kept:result.kept,modifier:result.total-result.kept} : {}),
    }));
    append(battle,actor,{...current.details,rolls,messages:current.messages.slice(-8).map(message=>message.slice(0,700)),impacts:current.impacts.slice(0,24)});
    return result;
  } finally {capture = previous;}
}
