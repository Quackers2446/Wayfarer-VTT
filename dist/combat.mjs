import {attackVisual} from './attack-visuals.mjs';
import {hasHestiasFury,hestiaName} from './hestias-fury.mjs';
import {nativeSpellDefinitions} from './native-spell-definitions.mjs';
import {weaponProperties} from './weapon-properties.mjs';
import {customSpellEffect} from './spell-rule-store.mjs';
import {castCustomSpell,customZoneTriggers,expireCustomZones,refreshFollowZones,flushPendingDamage} from './custom-spells.mjs';
import {defaultSpellAnimation,resolveSpellAnimation,breathAnimation,spellVisualEvent,formRule} from './spell-animation-library.mjs';
import {needsEndpoint,isCenterlineVisionZone,visionSegmentsForZone} from './spell-shapes.mjs';
import {awardDefeatXP} from "./encounter-rewards.mjs";
import {crossesMapWall, mapFloor, mapLineClear, mapWalls} from "./map-walls.mjs";
import {segmentIntersection,segmentEnds} from './wall-geometry.mjs';
import {tokenSize,sizeRank,actorCells,containsCell,overlaps,spaceDistance,touchesArea,creatureSize} from './actor-space.mjs';
import {captureImpact, captureMessage, captureRoll, recordAction, withActionEvent} from "./action-events.mjs";
import {modsOf, canReact, autoFailsSave, saveMode, expireTurnStatuses, endStatuses, syncStatusHp, conditionTable} from "./conditions.mjs";
import {fireReactions} from "./reactions.mjs";
import {dismissSummons, pruneDismissed} from "./summons.mjs";
import {scaledTargets} from "./spell-scaling.mjs";
export {modsOf, canReact, autoFailsSave, conditionTable};

const storedDamageTypes = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const error = (message) => {throw new Error(message);};

export function diceTerms(expression) {
  const cleaned = String(expression ?? "").trim().toLowerCase().replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(cleaned)) {
    return null;
  }
  const terms = [...cleaned.matchAll(/([+-]?)(\d*d\d+|\d+)/g)].map(([, sign, term]) => {
    const [count, faces] = term.split("d");
    return faces ? {sign:sign === "-" ? -1 : 1, count:Number(count || "1"), faces:Number(faces)} :
      {sign:sign === "-" ? -1 : 1, flat:Number(count)};
  });
  if (terms.length > 24 || terms.some(({count, faces, flat}) => {
    return faces != null ? count < 1 || count > 100 || faces < 2 || faces > 1000 : flat > 100000;
  })) return null;
  return terms;
}

export function rollDice(expression, {doubleDice = false, random = Math.random, label = expression, capture = true} = {}) {
  const terms = diceTerms(expression);
  if (!terms) error("Enter a dice expression such as 2d6+3 or 1d8+1d4+4.");
  let total = 0;
  const dice = [];
  const breakdown = terms.map(({sign, count, faces, flat}, index) => {
    const values = faces ? Array.from({length:count * (doubleDice ? 2 : 1)}, () => 1 + Math.floor(random() * faces)) : [];
    if (faces) dice.push(...values.map((value) => ({faces,value,sign})));
    const subtotal = faces ? values.reduce((sum, value) => sum + value, 0) : flat;
    total += sign * subtotal;
    const lead = sign < 0 ? "− " : index ? "+ " : "";
    return lead + (faces ? (doubleDice ? count * 2 : count) + "d" + faces + " [" + values.join(", ") + "]" : flat);
  });
  const result = {total, breakdown:breakdown.join(" ")};
  if (capture) captureRoll(result,{label,dice,base:dice.reduce((sum,die) => sum+die.sign*die.value,0),modifier:total-dice.reduce((sum,die) => sum+die.sign*die.value,0)});
  return result;
}

export function d20(modifier, {advantage = false, disadvantage = false, random = Math.random, label = "D20 roll"} = {}) {
  if (!Number.isFinite(modifier)) error("Enter a numeric roll modifier.");
  const rolls = Array.from({length:advantage === disadvantage ? 1 : 2}, () => rollDice("d20", {random,capture:false}).total);
  const kept = advantage && !disadvantage ? Math.max(...rolls) : Math.min(...rolls);
  const bonus = modifier >= 0 ? " + " + modifier : " − " + Math.abs(modifier);
  const result = {kept, total:kept + modifier, breakdown:rolls.join("/") + bonus};
  let used = false;
  const dice = rolls.map((value) => {
    const discarded = value !== kept || used;
    if (!discarded) used = true;
    return {faces:20,value,sign:1,discarded};
  });
  captureRoll(result,{label,dice,advantage:advantage && !disadvantage,disadvantage:disadvantage && !advantage});
  return result;
}

export const distanceFt = spaceDistance;
export const keyAt = (x, y) => x + ":" + y;
const initiativeActor = battle => battle.actors.find(({id}) => id === battle.order[battle.turn]);
export const currentActor = battle => battle.actors.find(({id}) => id === (battle.actingActorId ?? battle.order[battle.turn]));
const turnFields=['spent','dash','action','attacksMade','bonusUsed','cast','martialAttack','kiAction','flurry','actionSurged','deathRolled'];
const freshTurn=(spent=0)=>({spent,dash:0,action:null,attacksMade:0,bonusUsed:false,cast:null,martialAttack:false,kiAction:false,flurry:0,actionSurged:false,deathRolled:false});
const turnViews=new WeakMap(),viewRoots=new WeakMap();
export function sharedTurnGroup(battle) {
  if(!battle.round || initiativeActor(battle)?.side!=='party') return [];
  const lead=initiativeActor(battle);
  const leadParty=lead?.partyId || 'party-1';
  let start=battle.turn,end=battle.turn;
  const partyAt=index=>{
    const actor=battle.actors.find(a=>a.id===battle.order[index]);
    // Kennel pack allies are AI-controlled and keep their own initiative slots.
    return actor?.side==='party' && !actor.kennelAlly && (actor.partyId || 'party-1')===leadParty;
  };
  // Older saves already finished characters before the cursor; do not reopen those turns.
  while(battle.sharedEnded && start>0 && partyAt(start-1)) start--;
  while(end+1<battle.order.length && partyAt(end+1)) end++;
  return battle.order.slice(start,end+1).map(id=>battle.actors.find(a=>a.id===id)).filter(a=>a && !a.dead && !a.kennelAlly);
}
export const canTakeTurn=(battle,actor)=>Boolean(actor && battle.round && !battle.sharedEnded?.[actor.id] &&
  (actor.side==='party' ? sharedTurnGroup(battle).includes(actor) : initiativeActor(battle)?.id===actor.id));
// A rules view redirects only turn budgets; actors, events and the initiative cursor remain shared.
export function turnView(battle,actor) {
  battle=viewRoots.get(battle) ?? battle;
  if(!actor || actor.side!=='party' || !sharedTurnGroup(battle).includes(actor) || initiativeActor(battle)?.id===actor.id) return battle;
  const states=battle.sharedTurns ??= {};
  states[actor.id] ??= freshTurn(battle.earlyMovement?.[actor.id] ?? 0);
  let views=turnViews.get(battle);if(!views) turnViews.set(battle,views=new Map());
  if(!views.has(actor.id)) {
    const view=new Proxy(battle,{
      get(target,key) {
        if(key==='actingActorId') return actor.id;
        return turnFields.includes(key) && initiativeActor(target)?.id!==actor.id ? (target.sharedTurns[actor.id] ??= freshTurn())[key] : Reflect.get(target,key);
      },
      set(target,key,value) {
        if(turnFields.includes(key) && initiativeActor(target)?.id!==actor.id) {
          (target.sharedTurns[actor.id] ??= freshTurn())[key]=value;
          if(key==='spent') (target.earlyMovement ??= {})[actor.id]=value;
          return true;
        }
        return Reflect.set(target,key,value);
      },
    });
    views.set(actor.id,view);viewRoots.set(view,battle);
  }
  return views.get(actor.id);
}
export const turnBudgetStamp=(battle,actor)=>{const view=turnView(battle,actor);return JSON.stringify(turnFields.map(key=>view[key]));};
export const actorIsUp = (actor) => Boolean(actor && actor.hp > 0 && !actor.dead);
export const occupies = (actor) => !actor.dead && !actor.carriedBy && !actor.draggedBy && actor.x != null && actor.y != null;
/** Dragging occupies both hands (weapon attacks, somatic/material spells, object use). */
export const handsOccupied = (actor) => Boolean(actor?.dragging);
/** True when the spell needs a free hand (Somatic or Material). Verbal-only spells return false. */
export function spellNeedsHands(spell) {
  const components = spell?.components;
  if (!components || typeof components !== 'object') return true;
  return Boolean(components.s || components.m);
}
export const modifier = (score) => score == null ? null : Math.floor((score - 10) / 2);
export const hasFeature = (actor,name) => actor.classRules?.edition === "2014" && actor.classRules.traits.includes(name);
export const condition = (actor,name) => actor?.conditions?.find((effect) => effect.name === name);
export const incapacitated = (actor) => modsOf(actor).incapacitated;

export function movementGroup(battle) {
  const first=initiativeActor(battle);
  if(!battle.round || !first) return [];
  if(first.side!=='party') return [first];
  return sharedTurnGroup(battle).filter(actor=>!battle.sharedEnded?.[actor.id] && actorIsUp(actor) && occupies(actor) && !incapacitated(actor));
}

export function newBattle() {
  return {actors:[], order:[], turn:0, round:0, spent:0, dash:0, action:null, attacksMade:0, bonusUsed:false, log:[], terrain:{}, elapsed:0};
}

export function log(battle, text) {
  battle.log.push(text);
  captureMessage(battle,text);
  if (battle.log.length > 160) battle.log.splice(0, battle.log.length - 160);
}

export function makeActor(record) {
  return {
    attacks:[], spells:[], slots:{}, saves:{}, ability:{}, resist:[], immune:[], vulnerable:[],
    side:"hostile", hp:1, maxHp:1, tempHp:0, ac:10, speed:30, initiative:0, dex:10,
    successes:0, failures:0, prone:false, stable:false, dead:false, swings:1, resolveDeath:false,
    x:null, y:null, ...record, id:record.id ?? globalThis.crypto.randomUUID(),
  };
}

export function removeCondition(actor,effect) {
  if (actor.conditions) actor.conditions = actor.conditions.filter((entry) => entry !== effect);
  if (effect?.dominated) {
    delete actor.dominateOrder;
    delete actor.dominateControl;
  }
}

export function endConcentration(battle,caster) {
  if (!caster.concentration) return;
  log(battle,caster.name + " loses concentration on " + caster.concentration.name + ".");
  for (const actor of battle.actors) {
    if (actor.conditions?.some((effect) => effect.concentration === caster.id && effect.dominated)) {
      delete actor.dominateOrder;
      delete actor.dominateControl;
    }
    if (actor.conditions) actor.conditions = actor.conditions.filter((effect) => effect.concentration !== caster.id);
  }
  if (battle.spellZones) battle.spellZones = battle.spellZones.filter((zone) => zone.caster !== caster.id || zone.concentration===false);
  dismissSummons(battle,caster.id,{concentrationOnly:true});
  delete caster.concentration;
  for (const actor of battle.actors) syncStatusHp(actor);
}

export function startConcentration(battle,caster,name,duration) {
  endConcentration(battle,caster);
  caster.concentration = {name,expires:(battle.elapsed ?? 0)+duration};
}

/** Seconds / round budget still left on the caster's concentration spell (6 seconds = 1 round). */
export function concentrationRemaining(battle,actor) {
  if (!actor?.concentration) return null;
  const seconds = Math.max(0,(actor.concentration.expires ?? 0) - (battle?.elapsed ?? 0));
  return {seconds, rounds: Math.max(0, Math.ceil(seconds / 6)), name: actor.concentration.name};
}

export function addCondition(battle,actor,name,duration,properties = {}) {
  if (storedDamageTypes(actor.conditionImmune).includes(name.toLowerCase())) {
    log(battle,actor.name + " is immune to " + name.toLowerCase() + ".");
    return;
  }
  const effects = actor.conditions ??= [];
  effects.push({name,expires:(battle.elapsed ?? 0)+duration,...properties});
  log(battle,actor.name + (properties.rollModifiers || properties.mods ? " gains "+name+"." : name === "Dragon’s Breath" ? " gains Dragon’s Breath." : " is " + name.toLowerCase() + "."));
  syncStatusHp(actor);
  if (incapacitated(actor)) endConcentration(battle,actor);
}

export function advanceTime(battle, seconds) {
  battle.elapsed = (battle.elapsed ?? 0) + seconds;
  expireCustomZones(battle);
  for (const creature of battle.actors) {
    if (creature.astralArms?.expires <= battle.elapsed || incapacitated(creature) || !actorIsUp(creature)) delete creature.astralArms;
    if (creature.astralVisage?.expires <= battle.elapsed || incapacitated(creature) || !actorIsUp(creature)) delete creature.astralVisage;
    if (creature.inspiration?.expires <= battle.elapsed) delete creature.inspiration;
    if (creature.bladesong?.expires <= battle.elapsed || incapacitated(creature)) delete creature.bladesong;
    if (creature.concentration?.expires <= battle.elapsed) endConcentration(battle,creature);
    if (creature.conditions) creature.conditions = creature.conditions.filter((effect) => effect.expires > battle.elapsed);
    syncStatusHp(creature);
    if (creature.summonExpires != null && creature.summonExpires <= battle.elapsed) dismissSummons(battle,null,{only:creature.id});
    if (creature.tempExpires && creature.tempExpires <= battle.elapsed) {
      creature.tempHp = 0;
      creature.agathys = null;
      creature.tempExpires = null;
    }
    if (creature.aidExpires && creature.aidExpires <= battle.elapsed) {
      creature.maxHp -= creature.aid;
      creature.hp = Math.max(0,creature.hp-creature.aid);
      creature.aid = 0;
      creature.aidExpires = null;
      if (!creature.hp) {
        creature.prone = true;
        if (!creature.resolveDeath) creature.dead = true;
        endConcentration(battle,creature);
      }
      log(battle,"Aid expires for "+creature.name+".");
    }
  }
  if (!battle.round) pruneDismissed(battle);
}

// Repeat saving throws declared by conditions: `repeatSave` (ability) with `repeatWhen` 'end' (default), 'start' or 'damaged'.
export function repeatConditionSaves(battle,actor,when,random = Math.random) {
  for (const effect of [...(actor.conditions ?? [])]) {
    if (!effect.repeatSave || (effect.repeatWhen ?? "end") !== when || !actorIsUp(actor)) continue;
    const passed = withActionEvent(battle,actor,{action:effect.name+" saving throw",kind:"save"},() => {
      const save = savingThrow(actor,effect.repeatSave,{random});
      const passed = save.total >= effect.dc;
      log(battle,actor.name + " repeats the save against " + effect.name + " — " + save.total + " vs DC " +
        effect.dc + (passed ? ", succeeds." : ", fails."));
      return passed;
    });
    if (passed) removeCondition(actor,effect);
  }
}

function resetActorTurn(battle,actor,random = Math.random) {
  actor.dodging=false;actor.disengaged=false;actor.reactionUsed=false;actor.steadyAim=false;
  flushPendingDamage(battle,actor,'start',random);
  if (expireTurnStatuses(battle.actors,actor,'start',battle.round)) for (const creature of battle.actors) syncStatusHp(creature);
  customZoneTriggers(battle,actor,'start',undefined,random);
  repeatConditionSaves(battle,actor,'start',random);
  for(const creature of battle.actors) {
    if(creature.slowedBy===actor.id) creature.slowedBy=null;
    if(creature.helped?.helper===actor.id) delete creature.helped;
  }
}
function resetTurn(battle,random = Math.random) {
  const actor=initiativeActor(battle);if(!actor) return;
  Object.assign(battle,freshTurn(battle.earlyMovement?.[actor.id] ?? 0));
  battle.sharedTurns={};battle.sharedEnded={};
  resetActorTurn(battle,actor,random);
  for(const member of sharedTurnGroup(battle)) if(member.id!==actor.id) {
    resetActorTurn(battle,member,random);
    battle.sharedTurns[member.id]=freshTurn(battle.earlyMovement?.[member.id] ?? 0);
  }
  delete battle.earlyMovement;
  if(actor.hp===0 && actor.resolveDeath && !actor.stable) log(battle,actor.name+' must make a death saving throw.');
}

export function startInitiative(battle, random = Math.random, participantIds = null) {
  if (battle.round) error("Initiative is already running.");
  const ready = battle.actors.filter((actor) => occupies(actor) && actor.side !== "neutral" &&
    (!participantIds || participantIds.has(actor.id)));
  if (ready.length < 2) error("Place at least two tokens on the grid.");
  battle.combatId=crypto.randomUUID();
  const scores = ready.map((actor) => {
    const roll = withActionEvent(battle,actor,{action:"Initiative",kind:"initiative"},
      () => d20(actor.initiative, {random,label:"Initiative"}));
    actor.initiativeRoll = roll.total;
    return actor;
  }).sort((a, b) => b.initiativeRoll - a.initiativeRoll || (b.dex ?? 0) - (a.dex ?? 0));
  battle.order = scores.map(({id}) => id);
  battle.encounterParticipants=ready.filter(actor=>actor.side==='party').map(actor=>actor.id);
  battle.round = 1;
  battle.turn = 0;
  battle.deathRolled = false;
  delete battle.earlyMovement;delete battle.truceVotes;
  const pcs=ready.filter(actor=>actor.side==='party');
  const hostiles=ready.filter(actor=>actor.side==='hostile');
  battle.combatKind=pcs.length>=2 && !hostiles.length ? 'pvp' : hostiles.length ? 'encounter' : 'pvp';
  resetTurn(battle,random);
  log(battle, "Initiative — " + scores.map((actor) => actor.name + " " + actor.initiativeRoll).join(", ") + ".");
  return currentActor(battle);
}

export function joinInitiative(battle, actor, random = Math.random) {
  if (!battle.round || !actorIsUp(actor) || !occupies(actor) || battle.order.includes(actor.id)) return;
  if(actor.side==='party' && !(battle.encounterParticipants ??= []).includes(actor.id))battle.encounterParticipants.push(actor.id);
  actor.initiativeRoll = withActionEvent(battle,actor,{action:"Join initiative",kind:"initiative"},
    () => d20(actor.initiative,{random,label:"Initiative"})).total;
  const index = battle.order.findIndex((id) => {
    const other = battle.actors.find((entry) => entry.id === id);
    return other && (other.initiativeRoll < actor.initiativeRoll ||
      (other.initiativeRoll === actor.initiativeRoll && (other.dex ?? 0) < (actor.dex ?? 0)));
  });
  if (index < 0) battle.order.push(actor.id);
  else {
    battle.order.splice(index,0,actor.id);
    if (index <= battle.turn) battle.turn += 1;
  }
  log(battle,actor.name+" joins initiative with "+actor.initiativeRoll+".");
}

export function endTurn(battle, random = Math.random, selected = currentActor(battle)) {
  battle=viewRoots.get(battle) ?? battle;
  if (!battle.round) error("Start initiative first.");
  if (battle.movement) error("Resolve the opportunity attack before ending the turn.");
  if (battle.classReaction) error("Resolve Deflect Missiles before ending the turn.");
  const actor=selected;
  // Defeated tokens can still hold the initiative cursor after a final death save; skip them.
  const skippingDead = Boolean(actor?.dead);
  if (!skippingDead && !canTakeTurn(battle, actor)) error('This character cannot end a turn at the current initiative.');
  const budget = skippingDead ? battle : turnView(battle, actor);
  if (!skippingDead && actor?.hp === 0 && actor.resolveDeath && !actor.dead && !actor.stable && !budget.deathRolled) {
    error("Roll this character's death save before ending the turn.");
  }
  if (actor && !skippingDead) {
    customZoneTriggers(battle,actor,'end',undefined,random);
    for (const creature of battle.actors) {
      if (creature.conditions) creature.conditions = creature.conditions.filter((effect) =>
        effect.untilTurn !== actor.id || effect.untilRound > battle.round);
      if (creature.dominateControl?.untilActor === actor.id && creature.dominateControl.untilRound <= battle.round) {
        delete creature.dominateControl;
        log(battle, "Total control over " + creature.name + " ends.");
      }
    }
    repeatConditionSaves(battle,actor,"end",random);
    flushPendingDamage(battle,actor,'end',random);
    if (expireTurnStatuses(battle.actors,actor,'end',battle.round)) for (const creature of battle.actors) syncStatusHp(creature);
    if (actor.concentration?.bolt && budget.action && budget.action !== "witch-bolt") endConcentration(battle,actor);
    actor.mocked = false;
    for (const creature of battle.actors) {
      if (creature.sliver?.caster === actor.id && creature.sliver.round <= battle.round) creature.sliver = null;
    }
  }
  if (actor?.side === 'party') {
    battle.sharedEnded ??= Object.fromEntries(battle.order.slice(0,battle.turn).map(id=>[id,true]));
    battle.sharedEnded[actor.id]=true;
    // A dead initiative lead never took an end-turn; treat them as finished so living allies can advance.
    const lead = initiativeActor(battle);
    if (lead?.dead) battle.sharedEnded[lead.id] = true;
    const pending=sharedTurnGroup(battle).filter(member=>!battle.sharedEnded[member.id]);
    if(pending.length) {
      if (battle.sharedEnded[initiativeActor(battle)?.id] || initiativeActor(battle)?.dead) {
        const next=pending[0],nextBudget=Object.fromEntries(turnFields.map(key=>[key,turnView(battle,next)[key]]));
        battle.sharedTurns ??= {};
        const leadNow = initiativeActor(battle);
        if (leadNow) battle.sharedTurns[leadNow.id]=Object.fromEntries(turnFields.map(key=>[key,battle[key]]));
        battle.turn=battle.order.indexOf(next.id);Object.assign(battle,nextBudget);
        delete battle.sharedTurns[next.id];
        if(battle.earlyMovement) delete battle.earlyMovement[next.id];
      }
      return initiativeActor(battle);
    }
  }
  for (let checked = 0; checked < battle.order.length; checked++) {
    battle.turn += 1;
    if (battle.turn === battle.order.length) {
      battle.turn = 0;
      battle.round += 1;
      delete battle.earlyMovement;delete battle.sharedEnded;delete battle.sharedTurns;
      advanceTime(battle,6);
    }
    const next = currentActor(battle);
    if (next?.dead) {
      for (const entry of battle.actors) {
        if (entry.slowedBy === next.id) entry.slowedBy = null;
      }
    }
    if (next && !next.dead && !battle.sharedEnded?.[next.id]) {
      battle.deathRolled = false;
      resetTurn(battle,random);
      log(battle, "Round " + battle.round + " · " + next.name + "’s turn.");
      return next;
    }
  }
  battle.round = 0;
  battle.order = [];
  log(battle, "Initiative ended.");
  return null;
}

export function endInitiative(battle) {
  if (battle.movement) error("Resolve the opportunity attack first.");
  battle.order = [];
  battle.round = 0;
  battle.turn = 0;
  delete battle.earlyMovement;delete battle.sharedTurns;delete battle.sharedEnded;
  delete battle.truceVotes;delete battle.combatKind;delete battle.encounterParticipants;
  log(battle, "Initiative ended.");
}

/** Opt into ending a pure PvP scrap. Combat ends when every living PC in initiative has opted in. */
export function requestTruce(battle, actor) {
  if (!battle.round) error("No combat is running.");
  if (battle.movement) error("Resolve the opportunity attack first.");
  if (battle.classReaction) error("Resolve the pending reaction first.");
  if (!actor || actor.side !== 'party' || actor.dead) error("Only player characters in the fight can call a truce.");
  if (!battle.order.includes(actor.id)) error("This character is not in the fight.");
  const participants = battle.order.map(id => battle.actors.find(entry => entry.id === id))
    .filter(entry => entry && entry.side === 'party' && !entry.dead);
  const hostiles = battle.order.map(id => battle.actors.find(entry => entry.id === id))
    .filter(entry => entry && entry.side === 'hostile' && entry.hp > 0 && !entry.dead);
  if (hostiles.length) error("Leave combat / truce is only available during player vs player fights.");
  if (participants.length < 2) error("Truce needs at least two player characters in the fight.");
  (battle.truceVotes ??= {})[actor.id] = true;
  battle.combatKind = 'pvp';
  const pending = participants.filter(entry => !battle.truceVotes[entry.id]);
  if (pending.length) {
    log(battle, actor.name + " offers a truce. Waiting on " + pending.map(entry => entry.name).join(", ") + ".");
    return 'pending';
  }
  endInitiative(battle);
  log(battle, "All players agree to leave combat. Free movement restored.");
  return 'ended';
}

export function speedOf(actor) {
  const mods = modsOf(actor);
  // Kennel wolves stay fixed while tethered to the rock.
  if (actor?.chained) return 0;
  if (mods.incapacitated || mods.speedZero || actor.steadyAim) return 0;
  let speed = Math.max(0, actor.speed+(actor.bladesong ? 10 : 0)-(actor.slowedBy ? 10 : 0)+mods.speedBonus);
  if (mods.speedMultiplier !== 1) speed = Math.floor(speed*mods.speedMultiplier/5)*5;
  return speed*(actor.carrying || actor.dragging ? .5 : 1);
}
export function armorClass(actor) {
  const mods = modsOf(actor);
  return Math.max(actor.ac,mods.acBase)+(actor.bladesong ? Math.max(1,actor.ability.int ?? 0) : 0)+mods.acBonus;
}
export const movementBudget=(battle,actor)=>speedOf(actor)+(canTakeTurn(battle,actor) ? turnView(battle,actor).dash : 0);
export const moveLeft=(battle,actor)=>battle.sharedEnded?.[actor.id] ? 0 : Math.max(0,movementBudget(battle,actor)-
  (canTakeTurn(battle,actor) ? turnView(battle,actor).spent : battle.earlyMovement?.[actor.id] ?? 0));

export function placeToken(battle, actor, x, y, board) {
  if (actor.dead) error("This token is defeated.");
  if(!canStand(battle,actor,x,y,board)) error("The token's full space must fit inside the grid without walls or other creatures.");
  actor.x = x;
  actor.y = y;
}

function footprintClear(battle,actor,x,y,board) {
  const cells=actorCells({...actor,x,y});
  return cells.every(c=>c.x>=0 && c.y>=0 && c.x<board.cols && c.y<board.rows && mapFloor(board,c.x,c.y,battle) && battle.terrain[keyAt(c.x,c.y)]!=='wall' &&
    !battle.spellZones?.some(zone=>zone.blocksMovement&&zone.cells?.includes(keyAt(c.x,c.y))) &&
    (c.x===x || !crossesMapWall(board,{x:c.x-1,y:c.y},c,battle)) && (c.y===y || !crossesMapWall(board,{x:c.x,y:c.y-1},c,battle)));
}
export function canStand(battle,actor,x,y,board) {
  return footprintClear(battle,actor,x,y,board) && !battle.actors.some(other=>other.id!==actor.id && occupies(other) && overlaps({...actor,x,y},other));
}

function findPath(battle, actor, x, y, board, exploration = false, {goal, score, budget = exploration ? Infinity : moveLeft(battle,actor)} = {}) {
  const origin = keyAt(actor.x, actor.y);
  const destination = keyAt(x, y);
  const blockers = new Map();
  const others=battle.actors.filter(entry=>entry.id!==actor.id && occupies(entry));
  for(const entry of others) for(const cell of actorCells(entry)) blockers.set(keyAt(cell.x,cell.y),entry);
  const occupied=(col,row)=>others.some(other=>overlaps({...actor,x:col,y:row},other));
  if(x!=null && y!=null && !canStand(battle,actor,x,y,board)) error('That space is blocked or occupied.');
  if (blockers.has(destination)) error("Another token occupies that square.");
  // Spend the fewest feet first. At equal cost, favor cardinal steps and fewer bends.
  const compare=(a,b)=>a.cost-b.cost||a.diagonals-b.diagonals||a.bends-b.bends;
  const start={x:actor.x,y:actor.y,cost:0,diagonals:0,bends:0,dx:0,dy:0,previous:null};
  const known = new Map([[origin,start]]);
  const pending = [start];
  let best = pending[0];
  const trace = (cell) => {
    const path = [];
    for (let step = cell; step.previous; step = step.previous) path.push({x:step.x,y:step.y,cost:step.cost});
    return {cost:cell.cost,path:path.reverse()};
  };
  let nextUnvisited = 0;
  while (exploration ? nextUnvisited < pending.length : pending.length) {
    if (!exploration) pending.sort((a,b) => compare(b,a));
    const cell = exploration ? pending[nextUnvisited++] : pending.pop();
    const here = keyAt(cell.x, cell.y);
    if (cell !== known.get(here)) continue;
    if (here === destination || (goal && !occupied(cell.x,cell.y) && goal({...actor,...cell}))) return trace(cell);
    if (score && !occupied(cell.x,cell.y) && score({...actor,...cell}) > score({...actor,...best})) best = cell;
    for (const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const col = cell.x + dx;
        const row = cell.y + dy;
        const next = keyAt(col,row);
        if ((!dx && !dy) || !footprintClear(battle,actor,col,row,board)) continue;
        if (actorCells({...actor,...cell}).some(c=>crossesMapWall(board,c,{x:c.x+dx,y:c.y+dy},battle))) continue;
        if (dx && dy && (!footprintClear(battle,actor,cell.x+dx,cell.y,board) || !footprintClear(battle,actor,cell.x,cell.y+dy,board))) continue;
        const crossed=others.filter(other=>overlaps({...actor,x:col,y:row},other));
        if (crossed.some(other=>other.side!==actor.side && Math.abs(sizeRank(other)-sizeRank(actor))<2)) continue;
        const difficult = actorCells({...actor,x:col,y:row}).some(c=>battle.terrain[keyAt(c.x,c.y)]==='difficult'||battle.spellZones?.some(zone=>zone.difficult&&zone.cells.includes(keyAt(c.x,c.y)))) || crossed.length>0;
        const cost = cell.cost + (exploration ? 5 : (difficult ? 10 : 5) + (actor.prone ? 5 : 0));
        const step={x:col,y:row,cost,diagonals:cell.diagonals+(dx&&dy?1:0),bends:cell.bends+(cell.previous&&(cell.dx!==dx||cell.dy!==dy)?1:0),dx,dy,previous:cell};
        if (cost > budget || known.has(next)&&compare(step,known.get(next))>=0) continue;
        known.set(next,step);
        pending.push(step);
    }
  }
  return score ? trace(best) : null;
}

export function approachPath(battle, actor, board, goal) {
  return findPath(battle,actor,null,null,board,false,{goal,budget:Math.max(90,moveLeft(battle,actor)+speedOf(actor))});
}

/** Preferred attack range (melee reach or normal ranged). */
export function preferredStrikeRange(weapon) {
  return weapon?.normalRange || weapon?.reach || 5;
}

/** Maximum attack range (melee reach or long ranged). */
export function strikeRange(weapon) {
  return weapon?.normalRange ? (weapon.longRange || weapon.normalRange) : (weapon?.reach || 5);
}

/**
 * If the target is beyond strike range, move into the nearest square in range.
 * Returns true when a move was started/completed. Opportunity attacks may leave
 * battle.movement set — callers should queue the strike until movement clears.
 */
export function approachForStrike(battle, attacker, target, weapon, map) {
  battle = turnView(battle, attacker);
  assertTurn(battle, attacker);
  if (!occupies(attacker) || !occupies(target)) error("Choose a target on the board.");
  if (attacker.id === target.id) error("Choose a different target.");
  const max = strikeRange(weapon);
  const inRange = (from, range) => distanceFt(from, target) <= range && lineClear(battle, from, target, map);
  if (inRange(attacker, max)) return false;
  if (!moveLeft(battle, attacker)) error("The target is out of range.");
  const preferred = preferredStrikeRange(weapon);
  let path = approachPath(battle, attacker, map, (cell) => inRange(cell, preferred));
  if ((!path || !path.cost) && preferred < max) {
    path = approachPath(battle, attacker, map, (cell) => inRange(cell, max));
  }
  if (!path?.cost) error("No path into attack range.");
  const budget = moveLeft(battle, attacker);
  if (path.cost > budget) error("Not enough movement to get into attack range.");
  const step = path.path.slice().reverse().find((cell) =>
    cell.cost <= budget &&
    !battle.actors.some((other) => other.id !== attacker.id && occupies(other) && overlaps({ ...attacker, ...cell }, other)));
  if (!step) error("Not enough movement to get into attack range.");
  moveToken(battle, attacker, step.x, step.y, map);
  return true;
}

export function previewMovement(battle, actor, x, y, board) {
  battle=turnView(battle,actor);
  if (!actorIsUp(actor) || !occupies(actor) || incapacitated(actor) || battle.movement || x < 0 || y < 0 || x >= board.cols || y >= board.rows) return null;
  if (battle.round && !movementGroup(battle).includes(actor)) return null;
  try {return findPath(battle, actor, x, y, board, battle.round === 0);} catch {return null;}
}

export function exploreToken(battle, actor, x, y, board, stopAt) {
  if (battle.round || !actorIsUp(actor) || !occupies(actor)) error("Choose a party member who can explore.");
  const result = previewMovement(battle, actor, x, y, board);
  if (!result) error("That square is blocked or occupied.");
  const from={x:actor.x,y:actor.y},travelled=[];
  let distance = 0;
  for (const step of result.path) {
    advanceTime(battle,30/Math.max(5,speedOf(actor)));
    const previousSquare={x:actor.x,y:actor.y};actor.x = step.x; actor.y = step.y;syncCarriedBody(battle,actor,previousSquare);
    travelled.push({x:step.x,y:step.y});
    distance = step.cost;
    customZoneTriggers(battle,actor,'enter',previousSquare);refreshFollowZones(battle,actor,board);if(!actorIsUp(actor))break;
    // A route can cross friendly squares. The token must stop in a free square.
    if (battle.actors.some((other) => other.id !== actor.id && occupies(other) && overlaps({...actor,...step},other))) continue;
    if (stopAt(actor)) break;
  }
  if (distance) {
    log(battle,actor.name+" moves "+distance+" ft.");
    recordAction(battle,actor,{action:"Moved "+distance+" ft",kind:"move",distance,from,path:travelled});
  }
}

function assertTurn(battle, actor) {
  if (battle.movement) error("Resolve the opportunity attack before continuing.");
  if (battle.classReaction) error("Resolve Deflect Missiles before continuing.");
  if (!canTakeTurn(battle,actor)) error("It is not this token’s turn.");
  if (!actorIsUp(actor)) error("This token cannot take actions at 0 hit points.");
  if (incapacitated(actor)) error("This character is incapacitated.");
}

export const charmedBy = (actor,target) => Boolean(target && actor.conditions?.some((effect) =>
  effect.name === "Charmed" && effect.source === target.id));

function reactionWeapons(actor) {
  return actor.attacks.filter((attack) => !attack.normalRange && Number.isFinite(attack.bonus) && Boolean(diceTerms(attack.damage)));
}

function walkRemaining(battle, actor, board) {
  battle=turnView(battle,actor);
  const walk = battle.movement;
  const start=walk.index,from={x:actor.x,y:actor.y};
  const recordMovement=()=>{
    if(walk.index<=start) return;
    const distance=(walk.path[walk.index-1]?.cost ?? 0)-(walk.path[start-1]?.cost ?? 0);
    recordAction(battle,actor,{action:'Moved '+distance+' ft',kind:'move',distance,from,path:walk.path.slice(start,walk.index).map(({x,y})=>({x,y}))});
  };
  while (walk.index < walk.path.length && actorIsUp(actor)) {
    const next = walk.path[walk.index];
    const disengaged = currentActor(battle)?.id === actor.id && actor.disengaged;
    const foe = !disengaged && !walk.noOpportunity && battle.actors.find((other) => actorIsUp(other) && occupies(other) &&
      !incapacitated(other) && !charmedBy(other,actor) && !condition(actor,"Invisible") &&
      other.side !== actor.side && other.side !== "neutral" && canReact(other) && !walk.passed.includes(other.id) &&
      reactionWeapons(other).some((weapon) => {
        const reach = weapon.reach || 5;
        return distanceFt(actor,other) <= reach && distanceFt({...actor,...next},other) > reach && canSee(battle,other,actor,board);
      }));
    if (foe) {
      walk.foe = foe.id;
      recordMovement();
      return;
    }
    const previousSquare={x:actor.x,y:actor.y};actor.x = next.x;
    actor.y = next.y;customZoneTriggers(battle,actor,'enter',previousSquare);syncCarriedBody(battle,actor,previousSquare);refreshFollowZones(battle,actor,board);
    walk.index += 1;
    walk.passed = [];
    checkSpellTethers(battle,board);
    if(!actorIsUp(actor))break;
  }
  const distance = walk.path[walk.index-1]?.cost ?? 0;
  if (distance) {
    if (!walk.forced && currentActor(battle)?.id === actor.id) battle.spent += distance;
    else if (!walk.forced) {
      const movement = battle.earlyMovement ??= {};
      movement[actor.id] = (movement[actor.id] ?? 0)+distance;
    }
    log(battle, actor.name + " moves " + distance + " ft.");
    recordMovement();
  }
  battle.movement = null;
}

export function moveToken(battle, actor, x, y, board) {
  battle=turnView(battle,actor);
  if (!battle.round) return placeToken(battle, actor, x, y, board);
  if (battle.movement) error("Resolve the opportunity attack before continuing.");
  if (battle.classReaction) error("Resolve Deflect Missiles before moving.");
  if (!movementGroup(battle).includes(actor)) error("This character cannot move at the current initiative.");
  if (!actorIsUp(actor) || !occupies(actor)) error("This character cannot move.");
  const result = findPath(battle, actor, x, y, board);
  if (!result) error("That square is blocked or beyond the token’s remaining movement.");
  if (!result.cost) return;
  battle.movement = {actor:actor.id,path:result.path,index:0,passed:[]};
  walkRemaining(battle,actor,board);
}

export function opportunity(battle) {
  if (!battle.movement?.foe) return null;
  const actor = battle.actors.find(({id}) => id === battle.movement.actor);
  const foe = battle.actors.find(({id}) => id === battle.movement.foe);
  const next = battle.movement.path[battle.movement.index];
  const attacks = reactionWeapons(foe).filter((weapon) => {
    const reach = weapon.reach || 5;
    return distanceFt(actor,foe) <= reach && distanceFt({...actor,...next},foe) > reach;
  });
  return {actor, foe, attacks};
}

export function resolveOpportunity(battle, attackIndex, random = Math.random, board) {
  const offer = opportunity(battle);
  if (!offer) error("There is no opportunity attack to resolve.");
  const {actor, foe, attacks} = offer;
  if (attackIndex != null) {
    const attack = attacks[attackIndex];
    if (!attack) error("Select a melee attack.");
    foe.reactionUsed = true;
    resolveWeaponRoll(battle,foe,actor,attack,{reaction:true,map:board},random);
  } else {
    log(battle, foe.name + " passes the opportunity attack.");
    recordAction(battle,foe,{action:"Pass opportunity attack",reaction:true});
  }
  battle.movement.passed.push(foe.id);
  battle.movement.foe = null;
  walkRemaining(battle,actor,board);
}

// Spend the action to break free of a condition that declares `escape: {ability, dc}` (Web, Entangle, grapples).
export function escapeCondition(battle,actor,random = Math.random) {
  const effect = (actor.conditions ?? []).find((entry) => entry.escape);
  if (!effect) error("Nothing is holding this character.");
  return withActionEvent(battle,actor,{action:"Break free · "+effect.name,kind:"save"},() => {
    const ability = effect.escape.ability ?? "str";
    const roll = d20(actor.ability?.[ability] ?? 0,{random,label:actor.name+" · "+ability.toUpperCase()+" check"});
    const freed = roll.total >= effect.escape.dc;
    log(battle,actor.name+" tries to break free of "+effect.name+" — "+roll.total+" vs DC "+effect.escape.dc+(freed ? ", succeeds." : ", fails."));
    if (freed) removeCondition(actor,effect);
    return freed;
  });
}

export function turnAction(battle, actor, action, random = Math.random) {
  battle=turnView(battle,actor);
  assertTurn(battle, actor);
  if (action === "escape") {
    if (battle.action) error("This token has used its action.");
    battle.action = "escape";
    escapeCondition(battle,actor,random);
    return;
  }
  if (action === "stand") {
    if (!actor.prone) error("This token is already standing.");
    const cost = speedOf(actor) / 2;
    if (!cost || moveLeft(battle, actor) < cost) error("Standing requires half the token’s speed.");
    battle.spent += cost;
    actor.prone = false;
    log(battle, actor.name + " stands up.");
    recordAction(battle,actor,{action:"Stood up"});
    return;
  }
  if (action === "bonus-disengage") {
    if (battle.bonusUsed || !(actor.nimbleEscape || hasFeature(actor,"Cunning Action"))) error("This token cannot use bonus-action Disengage.");
    actor.disengaged = true;
    battle.bonusUsed = true;
    log(battle, actor.name + " uses a bonus action to disengage.");
    recordAction(battle,actor,{action:"Disengage (bonus action)"});
    return;
  }
  if (battle.action) error("This token has used its action.");
  if (action === "dash") battle.dash += speedOf(actor);
  else if (action === "dodge") actor.dodging = true;
  else if (action === "disengage") actor.disengaged = true;
  else error("Choose an action.");
  battle.action = action;
  const label = action.charAt(0).toUpperCase() + action.slice(1);
  log(battle, actor.name + " takes the " + label + " action.");
  recordAction(battle,actor,{action:label});
}

function damageTrait(records,type,properties) {
  return (records ?? []).some(record=>{
    if(typeof record==='string') return record===type;
    if(!record || typeof record!=='object') return false;
    const note=String(record.note ?? '').toLowerCase();
    if(note.includes('attacks') && !properties.attack) return false;
    if(note.includes('nonmagical') && properties.magical) return false;
    if(note.includes('silver') && properties.silvered) return false;
    if(note.includes('adamantine') && properties.adamantine) return false;
    if(note.includes('from spells') && !properties.spell) return false;
    if(note && !/nonmagical|silver|adamantine|from spells/.test(note)) return false;
    return damageTrait(record.resist ?? record.immune ?? record.vulnerable,type,properties);
  });
}

export function applyDamage(battle, actor, rawDamage, type, critical = false, random = Math.random, source, properties = {}) {
  let damage = Math.max(0, rawDamage);
  // A reaction such as Absorb Elements may change the creature's resistances before the damage lands.
  if (damage > 0 && actor.reactions?.length && !properties.noReaction) fireReactions(battle,'damage',{reactor:actor,source,damageType:type,amount:damage,properties,map:properties.map},random);
  const mods = modsOf(actor);
  if (type && (damageTrait(actor.immune,type,properties) || mods.immune.includes(type) || String(type).toLowerCase() === "fire" && actor.side === "party" && hasHestiasFury(actor))) damage = 0;
  else if (type) {
    if (damageTrait(actor.resist,type,properties) || mods.resist.includes(type) || mods.resistAll) damage = Math.floor(damage / 2);
    if (damageTrait(actor.vulnerable,type,properties) || mods.vulnerable.includes(type)) damage *= 2;
  }
  const absorbed = Math.min(actor.tempHp, damage);
  actor.tempHp -= absorbed;
  if (!actor.tempHp) {actor.agathys = null; actor.tempExpires = null;}
  const remaining = damage - absorbed;
  const before = actor.hp;
  actor.hp = Math.max(0, before - remaining);
  if (!actor.hp) {delete actor.astralArms;delete actor.astralVisage;}
  if (actor.hp === 0 && remaining > 0) {
    actor.stable = false;
    if (!actor.resolveDeath || remaining - before >= actor.maxHp) actor.dead = true;
    else if (before === 0) {
      actor.failures += critical ? 2 : 1;
      actor.dead = actor.failures >= 3;
    } else {
      actor.prone = true;
    }
  }
  if (damage) {
    const asleep = condition(actor,"Asleep");
    if (asleep) removeCondition(actor,asleep);
    endStatuses(actor,'onDamaged');
    if (source) {
      for (const effect of actor.conditions ?? []) {
        // Dominate-style charms use repeatWhen:'damaged' for a Wis save; leave those to repeatConditionSaves.
        if (effect.name === "Charmed" && effect.repeatWhen !== "damaged" && battle.actors.find(({id}) => id === effect.source)?.side === source.side) {
          removeCondition(actor,effect);
        }
      }
    }
    if (actor.concentration) {
      if (!actorIsUp(actor) || incapacitated(actor)) endConcentration(battle,actor);
      else {
        // DC = 10 or half the damage taken (after resist/vuln), whichever is higher. Nested event so the
        // concentrator gets a clear Maintained/Broken cue even when damage came from another creature's action.
        const dc = Math.max(10,Math.floor(damage/2));
        withActionEvent(battle,actor,{action:"Concentration",kind:"save"},() => {
          const save = savingThrow(actor,"con",{random,extra:actor.bladesong ? actor.ability.int ?? 0 : 0});
          const kept = save.total >= dc;
          log(battle,actor.name + " concentration save — " + save.total + " vs DC " + dc + ".");
          recordAction(battle,actor,{outcome:kept ? "Maintained" : "Broken",total:save.total,dc});
          if (!kept) endConcentration(battle,actor);
        });
      }
    }
  }
  if (damage && actorIsUp(actor)) repeatConditionSaves(battle,actor,'damaged',random);
  if(actor.dead && before>0){actor.defeatedAt=Date.now();actor.finalBlow=source?.id;awardDefeatXP(battle,actor,source,log);}
  if((actor.dead || actor.hp===0) && actor.carrying){const body=battle.actors.find(body=>body.id===actor.carrying);if(body){body.carriedBy=null;body.x=actor.x;body.y=actor.y;}actor.carrying=null;}
  if((actor.dead || actor.hp===0) && actor.dragging){const body=battle.actors.find(body=>body.id===actor.dragging);if(body){body.draggedBy=null;body.x=actor.x;body.y=actor.y;}actor.dragging=null;}
  const outcome={damage,absorbed,defeated:actor.dead,unconscious:!actor.dead && actor.hp===0 && before>0};
  captureImpact(battle,actor,{amount:damage,type,critical,defeated:outcome.defeated,absorbed});
  if (damage > 0 && actor.reactions?.length && source && !properties.noReaction) fireReactions(battle,'damaged',{reactor:actor,source,damageType:type,amount:damage,properties,map:properties.map},random);
  // Party harm to a befriended kennel wolf — play layer resolves the pack betrayal.
  if (damage > 0 && actor.kennelAlly && source?.side === "party" && !source.kennelAlly) {
    battle.kennelBetrayal = { attackerId: source.id, victimId: actor.id };
  }
  return outcome;
}

export function heal(actor, amount) {
  if (actor.dead) error("This token is defeated.");
  const restored = Math.min(actor.maxHp - actor.hp, Math.max(0, amount));
  actor.hp += restored;
  if (actor.hp > 0) {
    actor.successes = 0;
    actor.failures = 0;
    actor.stable = false;
  }
  return restored;
}

export function fallingDamage(battle,actor,height,{slowFall=true}={},random=Math.random) {
  if(!Number.isFinite(height) || height<0 || height>10000) error("Enter a fall height between 0 and 10,000 feet.");
  if(!actorIsUp(actor)) error("Choose a conscious creature.");
  if(battle.movement || battle.classReaction) error("Resolve the pending reaction first.");
  return withActionEvent(battle,actor,{action:"Fall · "+height+" ft",kind:"fall"},()=>{
    if (actor.reactions?.length) fireReactions(battle,'falling',{reactor:actor,height},random);
    if (modsOf(actor).negateFall) {log(battle,actor.name+" falls gently and takes no damage.");return {damage:0};}
    const dice=Math.min(20,Math.floor(height/10));
    if(!dice) {log(battle,actor.name+" falls less than 10 ft without falling damage.");return {damage:0};}
    const roll=rollDice(dice+"d6",{random,label:"Falling damage"});
    const available=!battle.round || !actor.reactionUsed;
    const reduction=slowFall && available && hasFeature(actor,"Slow Fall") && !incapacitated(actor) ? 5*actor.classRules.levels.Monk : 0;
    if(reduction) {actor.reactionUsed=true;log(battle,actor.name+" uses Slow Fall to reduce falling damage by "+reduction+".");}
    const outcome=recordDamage(battle,actor,Math.max(0,roll.total-reduction),"bludgeoning",roll.breakdown+(reduction ? " − Slow Fall "+reduction : ""),false,random);
    if(outcome.damage>0) actor.prone=true;
    return outcome;
  });
}

export function resolveDeflection(battle,actor,target,{map,fits=false}={},random=Math.random) {
  const reaction=battle.classReaction;
  if(!reaction || reaction.actor!==actor?.id) error("There is no deflected missile to return.");
  if(!target) {
    battle.classReaction=null;
    log(battle,actor.name+" finishes the Deflect Missiles reaction.");
    recordAction(battle,actor,{action:"Finish Deflect Missiles",reaction:true});
    return;
  }
  if(!actorIsUp(actor) || incapacitated(actor) || !actor.freeHand || !(actor.resources?.ki?.current>=1)) error("Returning a missile requires a free hand and 1 ki point.");
  if(!fits) error("Confirm that the missile fits in one hand.");
  validTarget(actor,target,false);
  if(target.id===actor.id || distanceFt(actor,target)>60 || !lineClear(battle,actor,target,map)) error("Choose a target within 60 ft and a clear line of fire.");
  const terms=diceTerms(reaction.weapon.damage)?.filter(term=>term.faces) ?? [];
  const expected=terms.reduce((sum,term)=>sum+term.sign*term.count*(term.faces+1)/2,0);
  const martial=actor.classRules?.unarmoredMonk ? actor.classRules.martialDie : null;
  const dice=martial && (martial+1)/2>expected ? "1d"+martial : terms.map((term,index)=>(term.sign<0 ? "-" : index ? "+" : "")+term.count+"d"+term.faces).join('') || "1";
  const dexterity=actor.ability.dex ?? 0;
  actor.resources.ki.current-=1;
  battle.classReaction=null;
  log(battle,actor.name+" spends 1 ki to return the deflected missile.");
  return resolveWeaponRoll(battle,actor,target,{name:"Deflect Missiles · return",bonus:dexterity+(actor.proficiency ?? 0),
    damage:dice+(dexterity>=0 ? "+" : "")+dexterity,type:reaction.weapon.type,normalRange:20,longRange:60,monkWeapon:true},
    {reaction:true,map},random);
}

export function deathSave(battle, actor, random = Math.random) {
  battle=turnView(battle,actor);
  return withActionEvent(battle,actor,{action:"Death saving throw",kind:"save"},() => resolveDeathSave(battle,actor,random));
}

function resolveDeathSave(battle, actor, random) {
  if (!battle.round || currentActor(battle)?.id !== actor.id || !actor.resolveDeath ||
      actor.hp !== 0 || actor.dead || actor.stable || !canTakeTurn(battle,actor) || battle.deathRolled) error("This character cannot make a death save right now.");
  const result = savingThrow(actor,null,{random});
  battle.deathRolled = true;
  if (result.kept === 20) heal(actor, 1);
  else if (result.kept === 1) actor.failures += 2;
  else if (result.total >= 10) actor.successes += 1;
  else actor.failures += 1;
  if (actor.failures >= 3) actor.dead = true;
  if (actor.successes >= 3) {
    actor.stable = true;
    actor.successes = 0;
    actor.failures = 0;
  }
  log(battle, actor.name + " death save — " + result.kept +
    (actor.dead ? ", dies." : actor.stable ? ", stabilizes." : actor.hp ? ", regains 1 HP." : " (" + actor.successes + " successes, " + actor.failures + " failures)."));
  return result;
}

function validTarget(attacker, target, allowDown = true) {
  if (!occupies(attacker) || !target || target.dead || target.x==null || target.y==null || (!allowDown && !actorIsUp(target))) {
    error("Choose a target on the grid.");
  }
}

function recordDamage(battle, target, amount, type, breakdown, critical = false, random = Math.random, source, properties = {}) {
  const outcome = applyDamage(battle,target,amount,type,critical,random,source,properties);
  log(battle, target.name + " takes " + outcome.damage + (type ? " " + type : "") + " damage" +
    " (" + breakdown + (outcome.absorbed ? "; " + outcome.absorbed + " absorbed by temp HP" : "") + ")" +
    (outcome.defeated ? " and is defeated." : outcome.unconscious ? " and falls unconscious." : "."));
  return outcome;
}

function damageLog(battle, target, expression, type, critical, random, source) {
  const roll = rollDice(expression,{doubleDice:critical,random});
  return recordDamage(battle,target,roll.total,type,roll.breakdown,critical,random,source,{magical:true,spell:true});
}

export function savingThrow(actor, ability, {extra = 0, advantage = false, disadvantage = false, random = Math.random} = {}) {
  let bonus = actor.saves[ability] ?? actor.ability[ability] ?? 0;
  if (ability === "str" && actor.astralArms) bonus += Math.max(0,(actor.ability.wis ?? 0)-(actor.ability.str ?? 0));
  const mods = modsOf(actor), mode = ability ? saveMode(actor,ability,mods) : {};
  bonus += mods.saveBonus[ability] ?? 0;
  const result = d20(bonus + extra,{advantage:advantage || Boolean(mode.advantage),disadvantage:disadvantage || Boolean(mode.disadvantage),random,label:actor.name+" · "+(ability ? ability.toUpperCase()+" save" : "Death save")});
  addInspiration(actor,result,random);
  addSpellRollModifiers(actor,result,'save',random);
  if (actor.sliver) {
    actor.sliver = null;
    const penalty = rollDice("1d4",{random});
    result.total -= penalty.total;
    result.breakdown += " − Mind Sliver " + penalty.total;
  }
  return result;
}

export function addSpellRollModifiers(actor,result,kind,random=Math.random){
  const applied=new Set();
  for(const effect of actor.conditions??[]){
    if(!effect.rollModifiers?.[kind]||applied.has(effect.name))continue;
    applied.add(effect.name);
    const roll=rollDice(effect.rollModifiers[kind],{random,label:effect.name+' · '+kind+' modifier'});
    result.total+=roll.total;result.breakdown+=' '+(roll.total<0?'−':'+')+' '+effect.name+' '+Math.abs(roll.total);
  }
  return result;
}

export function addInspiration(actor,result,random = Math.random) {
  if (!actor.inspirationArmed || !actor.inspiration) return;
  const die = rollDice("1d"+actor.inspiration.faces,{random});
  result.total += die.total;
  result.breakdown += " + Bardic Inspiration "+die.total;
  delete actor.inspiration;
  delete actor.inspirationArmed;
}

export function attackMode(battle, attacker, target, options, ranged, distance) {
  const obscured = battle.spellZones?.length > 0 && options.map;
  const nearby = ranged && battle.actors.some((other) => other.side !== attacker.side && other.side !== "neutral" &&
    actorIsUp(other) && !incapacitated(other) && !condition(attacker,"Invisible") && occupies(other) && distanceFt(attacker, other) <= 5 &&
    (!obscured || canSee(battle,other,attacker,options.map)));
  const own = modsOf(attacker), theirs = modsOf(target);
  return {
    // Auto-crits against paralyzed / unconscious targets are implemented but opt-in (battle.houseRules.autoCrit): the app's default is natural-20-only crits.
    autoCrit: Boolean(battle.houseRules?.autoCrit) && distance <= 5 && theirs.autoCritNear,
    advantage: Boolean(options.mode === "advantage" || attacker.steadyAim || target.helped?.side === attacker.side ||
      condition(attacker,"Invisible") || incapacitated(target) || condition(target,"Stunned") || target.hp === 0 ||
      own.attackAdv || theirs.attackedAdv || distance <= 5 && theirs.attackedNearAdv || distance > 5 && theirs.attackedFarAdv ||
      (obscured && !canSee(battle,target,attacker,options.map)) ||
      ((target.prone || target.hp === 0) && distance <= 5) ||
      (attacker.packTactics && battle.actors.some((other) => other.id !== attacker.id && other.side === attacker.side &&
        actorIsUp(other) && !incapacitated(other) && occupies(other) && distanceFt(target, other) <= 5))),
    disadvantage: Boolean(options.mode === "disadvantage" || nearby || attacker.mocked || condition(target,"Invisible") ||
      (obscured && !canSee(battle,attacker,target,options.map)) ||
      (target.dodging && actorIsUp(target) && speedOf(target) > 0) ||
      ((target.prone || target.hp === 0 || condition(target,"Asleep")) && distance > 5) || attacker.prone ||
      own.attackDis || theirs.attackedDis || distance <= 5 && theirs.attackedNearDis || distance > 5 && theirs.attackedFarDis),
  };
}

export function lineClear(battle, from, to, board, {vision = false} = {}) {
  if(tokenSize(from)>1 || tokenSize(to)>1) return actorCells(from).some(a=>actorCells(to).some(b=>lineClear(battle,a,b,board,{vision})));
  if (vision || mapWalls(board,battle)) return mapLineClear(board,from,to,(x,y) => battle.terrain[keyAt(x,y)] === "wall",vision,battle);
  let {x,y} = from;
  const dx = Math.abs(to.x-x), dy = -Math.abs(to.y-y);
  const signX = x < to.x ? 1 : -1, signY = y < to.y ? 1 : -1;
  let residual = dx + dy;
  while (x !== to.x || y !== to.y) {
    const step = residual * 2;
    if (step >= dy) {residual += dy; x += signX;}
    if (step <= dx) {residual += dx; y += signY;}
    if (battle.terrain[keyAt(x,y)] === "wall") return false;
  }
  return true;
}

const obscuredSets = new WeakMap();

function obscuredCells(zones) {
  if (!obscuredSets.has(zones)) obscuredSets.set(zones,new Set(zones.flatMap((zone) => zone.cells)));
  return obscuredSets.get(zones);
}

export function canSee(battle,from,to,map) {
  if (from.id !== to.id && (condition(to,"Invisible") || condition(to,"Hidden") && from.side !== to.side)) return false;
  if(tokenSize(from)>1 || tokenSize(to)>1) return actorCells(from).some(a=>actorCells(to).some(b=>canSee(battle,{...from,...a,creatureSize:'M'},{...to,...b,creatureSize:'M'},map)));
  if (!lineClear(battle,from,to,map,{vision:true})) return false;
  if (!battle.spellZones?.length || from.x === to.x && from.y === to.y) return true;
  const sightZones=battle.spellZones.filter(zone=>zone.blocksVision!==false);
  const zones = (from.astralVisage || hasFeature(from,"Devil's Sight")) && distanceFt(from,to) <= 120 ? sightZones.filter((zone) => zone.name !== "Darkness") : sightZones;
  const areaZones = zones.filter((zone) => !isCenterlineVisionZone(zone));
  const wallZones = zones.filter(isCenterlineVisionZone);
  // Fog/darkness still hide whole tiles. Wall/ring tiles stay seeable; occlusion is the centerline.
  const obscured = obscuredCells(areaZones);
  if (obscured.has(keyAt(from.x, from.y))) return false;
  let {x,y} = from;
  const dx = Math.abs(to.x-x), dy = -Math.abs(to.y-y);
  const sx = Math.sign(to.x-x), sy = Math.sign(to.y-y);
  let error = dx+dy;
  while (x !== to.x || y !== to.y) {
    const next = 2*error;
    if (next >= dy) {error += dy; x += sx;}
    if (next <= dx) {error += dx; y += sy;}
    if (obscured.has(keyAt(x,y))) return false;
  }
  if (!wallZones.length) return true;
  const origin = {x: from.x + 0.5, y: from.y + 0.5};
  const target = {x: to.x + 0.5, y: to.y + 0.5};
  for (const zone of wallZones) {
    for (const segment of visionSegmentsForZone(zone)) {
      const hit = segmentIntersection(origin, target, ...segmentEnds(segment));
      if (!hit) continue;
      // Hitting the wall face at the destination still counts as seeing that wall tile.
      if (Math.hypot(hit.x - target.x, hit.y - target.y) <= 0.51) continue;
      if (hit.t > 1e-7 && (hit.endT ?? hit.t) < 1 - 1e-7) return false;
    }
  }
  return true;
}

/** First spell zone whose cells the line from→to enters, matching `predicate`, or null. */
export function zoneAlongLine(battle, from, to, predicate) {
  if (!battle.spellZones?.length || from.x === to.x && from.y === to.y) return null;
  const zones = battle.spellZones.filter(predicate);
  if (!zones.length) return null;
  const blocked = obscuredCells(zones);
  let {x, y} = from;
  const dx = Math.abs(to.x - x), dy = -Math.abs(to.y - y);
  const sx = Math.sign(to.x - x), sy = Math.sign(to.y - y);
  let error = dx + dy;
  while (x !== to.x || y !== to.y) {
    const next = 2 * error;
    if (next >= dy) { error += dy; x += sx; }
    if (next <= dx) { error += dx; y += sy; }
    const here = keyAt(x, y);
    if (blocked.has(here)) return zones.find((zone) => zone.cells?.includes(here)) ?? null;
  }
  return null;
}

/** Wind Wall and similar: ordinary ranged weapon projectiles through the zone auto-miss. */
export function rangedBlockedByZone(battle, from, to) {
  return zoneAlongLine(battle, from, to, (zone) => zone.blocksRanged);
}

export function rollStrike(battle, attacker, target, weapon, options = {}, random = Math.random) {
  battle=turnView(battle,attacker);
  assertTurn(battle, attacker);
  validTarget(attacker, target);
  if (attacker.id === target.id) error("Choose a different target.");
  if (charmedBy(attacker,target)) error("This character is charmed by the target.");
  if (handsOccupied(attacker)) error("Dragging occupies your hands. Weapon attacks need a free hand — Drop the creature first.");
  if (!Number.isFinite(weapon.bonus) || !diceTerms(weapon.damage)) error("This action needs a numeric attack bonus and a damage formula.");
  const bonusStrike = options.bonusStrike;
  if (bonusStrike) {
    if (options.kiFueled) {
      if(!hasFeature(attacker,"Ki-Fueled Attack") || !battle.kiAction) error("Spend ki as part of your action before using Ki-Fueled Attack.");
      if(!weapon.unarmed && !weapon.monkWeapon) error("Choose an unarmed strike or monk weapon.");
      if(battle.bonusUsed) error("This token has used its bonus action.");
    } else {
      if (!weapon.unarmed) error("Choose an unarmed strike.");
      if (!battle.flurry && (!attacker.classRules?.unarmoredMonk || !battle.martialAttack)) error("Use the Attack action with a monk weapon first.");
    }
    if (!battle.flurry && battle.bonusUsed) error("This token has used its bonus action.");
  } else {
    if (battle.action && battle.action !== "attack") error("This token has used its action.");
    if (battle.attacksMade >= attacker.swings) error("This token has used its attacks.");
  }
  if (options.stun && (!hasFeature(attacker,"Stunning Strike") || weapon.normalRange || !(attacker.resources?.ki?.current > 0))) {
    error("Stunning Strike needs a melee attack and a ki point.");
  }
  const distance = distanceFt(attacker, target);
  const ranged = !!weapon.normalRange;
  if (distance > (ranged ? weapon.longRange || weapon.normalRange : weapon.reach || 5)) error("The target is out of range.");
  if (options.cover === "full" || !lineClear(battle,attacker,target,options.map) ||
      zoneAlongLine(battle,attacker,target,(zone)=>zone.blocksMovement)) error("Full cover blocks the attack.");
  if (bonusStrike) {
    if (battle.flurry && !options.kiFueled) battle.flurry -= 1;
    else battle.bonusUsed = true;
  } else {
    battle.action = "attack";
    battle.attacksMade += 1;
    if (weapon.monkWeapon || weapon.unarmed) battle.martialAttack = true;
  }
  return resolveWeaponRoll(battle,attacker,target,weapon,options,random);
}

function resolveWeaponRoll(battle, attacker, target, weapon, options, random) {
  weapon=weaponProperties(weapon);
  if(attacker.classRules?.unarmoredMonk && (weapon.monkWeapon || weapon.unarmed)) {
    const dice=diceTerms(weapon.damage)?.filter(term=>term.faces);
    if(dice?.length===1 && dice[0].count===1 && dice[0].sign===1 && attacker.classRules.martialDie>dice[0].faces) {
      weapon={...weapon,damage:weapon.damage.replace(/\d*d\d+/i,'1d'+attacker.classRules.martialDie)};
    }
  }
  return withActionEvent(battle,attacker,{action:weapon.name,kind:"attack",target:target.name,targetActor:target.id,...attackVisual(weapon,attacker,target,distanceFt(attacker,target))},
    () => weaponRoll(battle,attacker,target,weapon,options,random));
}

export function sneakAttackStatus(battle,attacker,target,weapon,options={},mode){
  weapon=weaponProperties(weapon);
  const dice=attacker.classRules?.sneakDice??Math.ceil((attacker.classRules?.levels?.Rogue??0)/2);
  const turnKey=(battle.combatId?battle.combatId+'|':'')+battle.round+'|'+(options.reaction?initiativeActor(battle)?.id:currentActor(turnView(battle,attacker))?.id);
  const allyParty=attacker.side==='party'?(attacker.partyId||'party-1'):null;
  const allyNearby=Boolean(target&&battle.actors.some(ally=>{
    if(ally.id===attacker.id||ally.id===target.id||!actorIsUp(ally)||incapacitated(ally)||!occupies(ally)||distanceFt(ally,target)>5) return false;
    if(attacker.side==='party' && ally.side==='party') return (ally.partyId||'party-1')===allyParty && (target.side!=='party' || (target.partyId||'party-1')!==allyParty);
    return ally.side===attacker.side && ally.side!==target.side;
  }));
  const ranged=Boolean(weapon.normalRange);
  mode??=target?attackMode(battle,attacker,target,options,ranged,distanceFt(attacker,target)):{};
  const reason=!dice?'This character has no Sneak Attack.':!target?'Choose a target.':weapon.spellAttack||!(weapon.finesse||weapon.rangedWeapon||ranged&&!weapon.thrown)?'Requires a finesse weapon or ranged weapon.':attacker.sneakTurn===turnKey?'Already used on this turn.':mode.disadvantage&&!mode.advantage?'Disadvantage prevents Sneak Attack.':!allyNearby&&!(mode.advantage&&!mode.disadvantage)?'Needs advantage or an active ally within 5 ft of the target.':'';
  return {eligible:!reason,reason,dice,turnKey,allyNearby};
}

// Extra damage declared by statuses: Divine Favor / smites (`riders` on the attacker) and Hex / Hunter's Mark (`markRiders` on the target).
export function applyAttackRiders(battle,attacker,target,{weapon,ranged=false,spell=false},critical,random) {
  const kind = spell ? "spell" : ranged ? "ranged" : "melee";
  const riders = [...modsOf(attacker).riders.map((rider) => ({rider,holder:attacker})),
    ...modsOf(target).markRiders.filter(({entry}) => entry.source === attacker.id).map((rider) => ({rider,holder:target}))];
  for (const {rider,holder} of riders) {
    const when = rider.when ?? "weapon";
    if (when === "weapon" && spell || when === "melee" && kind !== "melee" || when === "spell" && !spell || !actorIsUp(target)) continue;
    const type = rider.type === "weapon" ? weapon?.type : rider.type === "triggering" ? rider.entry.triggerType ?? weapon?.type : rider.type;
    const roll = rollDice(rider.formula,{doubleDice:critical,random,label:rider.entry.name+" damage"});
    recordDamage(battle,target,roll.total,type,rider.entry.name+" "+roll.breakdown,critical,random,attacker,{magical:true,spell:true});
    if (rider.consume) removeCondition(holder,rider.entry);
  }
}

function weaponRoll(battle, attacker, target, weapon, options, random) {
  const distance = distanceFt(attacker,target);
  const ranged = Boolean(weapon.normalRange);

  // Wind Wall etc.: ordinary projectiles through the wall are deflected (auto-miss).
  const deflect = ranged && !weapon.spellAttack && rangedBlockedByZone(battle, attacker, target);
  if (deflect) {
    breakInvisibility(battle, attacker);
    attacker.steadyAim = false;
    attacker.mocked = false;
    log(battle, attacker.name + " · " + weapon.name + " vs " + target.name + " — deflected by " + deflect.name + ".");
    recordAction(battle, attacker, {
      action: weapon.name, target: target.name, outcome: "Miss", blocked: true,
      messages: [deflect.name + " deflects the projectile."],
    });
    return {hit: false, critical: false, roll: {total: 0, breakdown: "deflected", kept: 0}, damage: null};
  }

  const mode = attackMode(battle, attacker, target, options, ranged, distance);
  mode.disadvantage ||= ranged && distance > weapon.normalRange;
  const roll = d20(weapon.bonus, {...mode, random,label:"Attack roll"});
  addInspiration(attacker,roll,random);
  addSpellRollModifiers(attacker,roll,'attack',random);
  if (hasFeature(attacker,"Focused Aim") && roll.kept!==1 && roll.kept!==20 && options.focusedAim>0) {
    const needed=Math.ceil((armorClass(target)+(Number(options.cover)||0)-roll.total)/2);
    const maximum=Math.min(3,Number(options.focusedAim),attacker.resources?.ki?.current ?? 0);
    if(needed>0 && needed<=maximum) {
      attacker.resources.ki.current-=needed;roll.total+=2*needed;
      roll.breakdown+=" + Focused Aim "+2*needed;
      if(!options.bonusStrike && !options.reaction) battle.kiAction=true;
      log(battle,attacker.name+" spends "+needed+" ki on Focused Aim, adding "+2*needed+" to the attack.");
    }
  }
  const bard = roll.kept !== 20 && roll.total >= armorClass(target) && battle.actors.find((ally) =>
    ally.side === target.side && ally.side !== attacker.side && ally.cuttingWords && hasFeature(ally,"Cutting Words") &&
    actorIsUp(ally) && !incapacitated(ally) && !ally.reactionUsed && ally.resources?.inspiration?.current > 0 &&
    distanceFt(ally,attacker) <= 60 && !condition(attacker,"Deafened") &&
    !storedDamageTypes(attacker.conditionImmune).includes("charmed") && canSee(battle,ally,attacker,options.map));
  if (bard) {
    const reduction = rollDice("1d"+bard.classRules.inspirationDie,{random});
    roll.total -= reduction.total;
    roll.breakdown += " − Cutting Words "+reduction.total;
    bard.resources.inspiration.current -= 1;
    bard.reactionUsed = true;
    log(battle,bard.name+" uses Cutting Words, reducing the attack by "+reduction.total+".");
  }
  if (target.helped?.side === attacker.side) delete target.helped;
  attacker.steadyAim = false;
  breakInvisibility(battle,attacker);
  attacker.mocked = false;
  let hit = roll.kept === 20 || (roll.kept !== 1 && roll.total >= armorClass(target) + (Number(options.cover) || 0));
  // Reactions such as Shield can turn a hit into a miss before damage is rolled.
  if (hit && roll.kept !== 20 && target.reactions?.length) {
    fireReactions(battle,'hit',{reactor:target,source:attacker,attackTotal:roll.total,cover:Number(options.cover) || 0,map:options.map,weapon},random);
    hit = roll.kept === 20 || (roll.kept !== 1 && roll.total >= armorClass(target) + (Number(options.cover) || 0));
  }
  if (hit && roll.kept !== 20 && deflectMirrorImage(battle,target,random)) hit = false;
  endStatuses(target,'onAttacked');endStatuses(attacker,'onAttack');
  const critical = hit && (roll.kept === 20 || Boolean(mode.autoCrit));
  let damage;
  let prone;
  log(battle, attacker.name + " · " + weapon.name + " vs " + target.name + " — " + roll.breakdown + " = " + roll.total +
    (critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  if (hit) {
    const retaliation = !ranged && target.tempHp > 0 ? target.agathys : null;
    const raw = rollDice(weapon.damage,{doubleDice:critical,random,label:"Damage"});
    let totalDamage = raw.total;
    let breakdown = raw.breakdown;
    const sneakStatus=sneakAttackStatus(battle,attacker,target,weapon,options,mode);
    if (sneakStatus.eligible) {
      const sneak = rollDice(sneakStatus.dice+"d6",{doubleDice:critical,random,label:"Sneak Attack"});
      totalDamage += sneak.total;
      breakdown += " + Sneak Attack "+sneak.breakdown;
      attacker.sneakTurn = sneakStatus.turnKey;
      log(battle,attacker.name+" adds Sneak Attack"+(sneakStatus.allyNearby ? " — an ally is within 5 ft of "+target.name : " with advantage")+".");
    }else if(sneakStatus.dice)log(battle,'Sneak Attack not applied: '+sneakStatus.reason);
    if (ranged && !weapon.spellAttack && hasFeature(target,"Deflect Missiles") && !target.reactionUsed && !incapacitated(target)) {
      const bonus=(target.ability.dex ?? 0)+(target.classRules.levels.Monk ?? 0);
      const reduction = rollDice("1d10"+(bonus>=0 ? "+" : "")+bonus,{random,label:"Deflect Missiles"}).total;
      totalDamage = Math.max(0,totalDamage-reduction);
      target.reactionUsed = true;
      log(battle,target.name+" uses Deflect Missiles, reducing damage by "+reduction+".");
      if(totalDamage===0 && target.freeHand) {
        log(battle,target.name+" can catch the missile if it fits in one hand.");
        if(target.resources?.ki?.current>=1 && target.side==="party") battle.classReaction={kind:"deflect-return",actor:target.id,source:attacker.id,weapon:{damage:weapon.damage,type:weapon.type}};
      }
    } else if (hasFeature(target,"Uncanny Dodge") && !target.reactionUsed && !incapacitated(target) && canSee(battle,target,attacker,options.map)) {
      totalDamage = Math.floor(totalDamage/2);
      target.reactionUsed = true;
      log(battle,target.name+" uses Uncanny Dodge to halve the attack’s damage.");
    }
    damage = recordDamage(battle,target,totalDamage,weapon.type,breakdown,critical,random,attacker,
      {attack:true,magical:weapon.magical || weapon.spellAttack || weapon.unarmed && hasFeature(attacker,"Ki-Empowered Strikes"),silvered:weapon.silvered,adamantine:weapon.adamantine,map:options.map});
    applyAttackRiders(battle,attacker,target,{weapon,ranged},critical,random);
    if (options.stun && actorIsUp(target) && attacker.resources.ki.current>=1) {
      attacker.resources.ki.current -= 1;
      if(!options.bonusStrike && !options.reaction) battle.kiAction=true;
      const save = savingThrow(target,"con",{random});
      const dc = attacker.classRules.kiDC;
      log(battle,target.name+" Constitution save "+save.total+" vs Ki DC "+dc+".");
      if (save.total < dc) addCondition(battle,target,"Stunned",60,{untilTurn:attacker.id,untilRound:battle.round+1});
    }
    if (retaliation) recordDamage(battle,attacker,retaliation,"cold","Armor of Agathys",false,random,target);
    if (weapon.proneDC && actorIsUp(target)) {
      const save = savingThrow(target,"str",{random});
      if (save.total < weapon.proneDC) {
        prone = true;
        target.prone = true;
      }
      log(battle, target.name + " Strength save " + save.total + " vs DC " + weapon.proneDC + (target.prone ? " · prone." : "."));
    }
  }
  recordAction(battle,attacker,{
    action:weapon.name, target:target.name, roll:roll.breakdown, total:roll.total,blocked:!hit && armorClass(target)>=16,
    outcome:critical ? "Critical hit" : hit ? "Hit" : "Miss", damage, type:weapon.type, prone, reaction:options.reaction,
  });
  return {roll, hit, critical};
}

const spellEffects = nativeSpellDefinitions;

export const breathTypes = ["acid","cold","fire","lightning","poison"];
export const supportedSpell = (key,rules) => customSpellEffect(key,rules) ?? (Object.hasOwn(spellEffects,String(key).split('|').at(-1)) ? spellEffects[String(key).split('|').at(-1)] : undefined);
export const spellTargetCount = (effect,casterLevel,rank) => effect.custom ? scaledTargets(effect.definition,casterLevel,rank) : effect.moreTargets ? 1+Math.max(0,rank-effect.level) :
  effect.missiles ? 2+rank : effect.beams ? 1+[5,11,17].filter((limit) => casterLevel >= limit).length : effect.aid ? 3 : 1;

export function breakInvisibility(battle,actor) {
  removeCondition(actor,condition(actor,"Hidden"));
  const effect = condition(actor,"Invisible");
  if (!effect) return;
  removeCondition(actor,effect);
  const caster = battle.actors.find(({id}) => id === effect.concentration);
  if (caster && !battle.actors.some((entry) => entry.conditions?.some((other) =>
      other.name === "Invisible" && other.concentration === caster.id))) endConcentration(battle,caster);
}

export const slotRank = value => value==null || value==="" ? 0 : Number(String(value).split(':').at(-1));

function castingPool(caster,slotLevel,slotPool) {
  const pact=caster.resources?.pactMagic;
  if(slotPool==="pact") return pact?.slotLevel===slotLevel ? pact : undefined;
  if(slotPool==="spellcasting") return caster.slots[slotLevel];
  if(!(caster.slots[slotLevel]?.current>0) && pact?.slotLevel===slotLevel) return pact;
  return caster.slots[slotLevel];
}

export function checkCast(battle,caster,level,slotLevel,timing,usage,slotPool) {
  if (!actorIsUp(caster)) error("This token cannot cast at 0 hit points.");
  if (incapacitated(caster)) error("This character is incapacitated.");
  if (!occupies(caster)) error("Place the caster on the grid first.");
  if (battle.round) {
    if (timing === "reaction") {
      if (battle.movement || !canReact(caster)) error("This token’s reaction is unavailable.");
    } else {
      assertTurn(battle,caster);
      if (timing === "bonus") {
        if (battle.bonusUsed || battle.cast?.level || battle.cast?.bonus || battle.cast?.reaction) error("This spell’s bonus action is unavailable.");
      } else if (battle.action) error("This token has used its action.");
      if (timing !== "bonus" && level && battle.cast?.bonus) error("After a bonus-action spell, this action can only cast a cantrip.");
    }
    if (timing === "reaction" && battle.cast?.bonus && caster.id === currentActor(battle)?.id) {
      error("After a bonus-action spell, another spell on this turn must be a one-action cantrip.");
    }
  }
  if (usage?.resource && !(caster.resources?.[usage.resource]?.current >= (usage.cost ?? 1))) error("This feature’s spell use is expended.");
  if (level && !usage && (!Number.isInteger(slotLevel) || slotLevel < level || !(castingPool(caster,slotLevel,slotPool)?.current > 0))) {
    error("Choose a slot of the spell’s level or higher with a use remaining.");
  }
}

export function spendCast(battle,caster,level,slotLevel,timing,usage,slotPool) {
  if (battle.round) {
    if (timing === "bonus") battle.bonusUsed = true;
    else if (timing === "reaction") caster.reactionUsed = true;
    else battle.action = "cast";
    if (caster.id === currentActor(battle)?.id) {
      battle.cast = {
        bonus:timing === "bonus" || battle.cast?.bonus,
        reaction:timing === "reaction" || battle.cast?.reaction,
        level:Math.max(level,battle.cast?.level ?? 0),
      };
    }
  }
  if (usage?.resource) {
    caster.resources[usage.resource].current -= usage.cost ?? 1;
    if (usage.resource === "ki" && battle.round && timing === "action") battle.kiAction = true;
  }
  else if (level && !usage) castingPool(caster,slotLevel,slotPool).current -= 1;
}

export function recordSpell(battle,caster,spell,slotLevel,options={}) {
  battle=turnView(battle,caster);
  if (!spell.reference || spell.edition !== "2014" || spell.customUse) error("Use the table ruling for this custom or revised spell.");
  if (!["action","bonus","reaction"].includes(spell.timing)) error("Resolve the longer casting time at the table.");
  const usage = spell.castUsage && slotLevel === 0 ? spell.castUsage : undefined;
  checkCast(battle,caster,spell.level,slotLevel,spell.timing,usage,options.slotPool);
  spendCast(battle,caster,spell.level,slotLevel,spell.timing,usage,options.slotPool);
  breakInvisibility(battle,caster);
  log(battle,caster.name+" casts "+spell.name+(usage ? " using "+(spell.grantedBy ?? "a class feature") :
    spell.level ? " with a level "+slotLevel+" slot" : "")+" · manual effect.");
  recordAction(battle,caster,{action:spell.name,kind:"spell",messages:[battle.log.at(-1)]});
}

function spellSave(battle, caster, target, effect, options, random) {
  const dex = effect.save === "dex";
  const cover = dex && !effect.ignoresCover ? Number(options.cover) || 0 : 0;
  const result = (target.hp === 0 || autoFailsSave(target,effect.save)) && ["str","dex"].includes(effect.save) ? null : savingThrow(target,effect.save,{
    extra:cover, advantage:effect.condition === "Charmed" && battle.round > 0 && target.side !== caster.side ||
      dex && target.dodging && actorIsUp(target) && speedOf(target)>0, random,
  });
  const passed = Boolean(result && result.total >= caster.spellDC);
  log(battle,target.name+" save — "+(result ? result.breakdown+" = "+result.total : "automatic failure")+
    " vs DC "+caster.spellDC+(passed ? ", succeeds." : ", fails."));
  return passed;
}

function rangedSpellAttack(battle,caster,target,effect,expression,options,random) {
  const distance = distanceFt(caster,target);
  const mode = attackMode(battle,caster,target,options,true,distance);
  const result = d20(caster.spellAttack,{...mode,random,label:"Spell attack"});
  addInspiration(caster,result,random);
  addSpellRollModifiers(caster,result,'attack',random);
  if (target.helped?.side === caster.side) delete target.helped;
  breakInvisibility(battle,caster);
  caster.mocked = false;
  let hit = result.kept === 20 || (result.kept !== 1 && result.total >= armorClass(target) + (Number(options.cover) || 0));
  if (hit && result.kept !== 20 && target.reactions?.length) {
    fireReactions(battle,'hit',{reactor:target,source:caster,attackTotal:result.total,cover:Number(options.cover) || 0,map:options.map,spell:true},random);
    hit = result.kept === 20 || (result.kept !== 1 && result.total >= armorClass(target) + (Number(options.cover) || 0));
  }
  endStatuses(target,'onAttacked');
  const critical = hit && (result.kept === 20 || Boolean(mode.autoCrit));
  log(battle,"Spell attack on "+target.name+" — "+result.breakdown+" = "+result.total+(critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  recordAction(battle,caster,{outcome:critical ? "Critical hit" : hit ? "Hit" : "Miss",roll:result.breakdown,total:result.total});
  if (hit) {
    damageLog(battle,target,expression,effect.type,critical,random,caster);
    if (effect.slow && actorIsUp(target)) target.slowedBy = caster.id;
  }
  return hit;
}

export function areaCells(battle, origin, radius, board) {
  const queue = [{...origin,cost:0}];
  const visited = new Set([keyAt(origin.x,origin.y)]);
  const wall = (x,y) => !mapFloor(board,x,y,battle) || battle.terrain[keyAt(x,y)] === "wall";
  for (let i=0;i<queue.length;i++) {
    const {x,y,cost} = queue[i];
    if (cost >= radius) continue;
    for (let dx=-1;dx<=1;dx++) {
      for (let dy=-1;dy<=1;dy++) {
        const col=x+dx, row=y+dy, key=keyAt(col,row);
        if (visited.has(key) || col<0 || row<0 || col>=board.cols || row>=board.rows || wall(col,row)) continue;
        if (crossesMapWall(board,{x,y},{x:col,y:row},battle)) continue;
        if (dx && dy && wall(col,y) && wall(x,row)) continue;
        visited.add(key);
        queue.push({x:col,y:row,cost:cost+5});
      }
    }
  }
  return visited;
}

export function spellCells(battle,caster,square,effect,board,rank = effect.level) {
  if (!effect.cone) return areaCells(battle,square,effect.area+(effect.areaPerSlot ?? 0)*Math.max(0,rank-effect.level),board);
  const dx = square.x-caster.x, dy = square.y-caster.y;
  const length = Math.hypot(dx,dy);
  const cells = new Set();
  if (!length) return cells;
  const reach = Math.ceil(effect.cone/5);
  for (let y = Math.max(0,caster.y-reach); y <= Math.min(board.rows-1,caster.y+reach); y++) {
    for (let x = Math.max(0,caster.x-reach); x <= Math.min(board.cols-1,caster.x+reach); x++) {
      const u = x-caster.x, v = y-caster.y;
      const forward = (u*dx+v*dy)/length;
      const side = Math.abs(u*dy-v*dx)/length;
      if (forward > 0 && forward*5 <= effect.cone && side <= forward/2 &&
          mapFloor(board,x,y,battle) && lineClear(battle,caster,{x,y},board)) cells.add(keyAt(x,y));
    }
  }
  return cells;
}

export function fleeFrom(battle,caster,target,board) {
  if (!board || !actorIsUp(target) || incapacitated(target) || target.reactionUsed) return;
  target.reactionUsed = true;
  const path = findPath(battle,target,null,null,board,false,{budget:speedOf(target),score:(cell) => distanceFt(cell,caster)});
  if (!path.cost) return;
  battle.movement = {actor:target.id,path:path.path,index:0,passed:[],forced:true};
  log(battle,target.name+" uses its reaction to flee.");
  walkRemaining(battle,target,board);
}

function boltTarget(battle,caster,map) {
  const range = caster.concentration?.boltRange || 30;
  const target = battle.actors.find(({id}) => id === caster.concentration?.bolt);
  return target && occupies(target) && distanceFt(caster,target) <= range && lineClear(battle,caster,target,map) ? target : null;
}

// Melee weapon attack used by Booming Blade–style cantrips: the spell already spent the action.
export function weaponAttackForSpell(battle,attacker,target,weapon,options={},random=Math.random) {
  weapon = weaponProperties(weapon);
  if (!Number.isFinite(weapon.bonus) || !diceTerms(weapon.damage)) error("This cantrip needs a weapon with an attack bonus and damage.");
  if (weapon.normalRange) error("Choose a melee weapon.");
  const distance = distanceFt(attacker,target);
  if (distance > (weapon.reach || 5)) error("The target is out of reach.");
  if (options.cover === "full" || !lineClear(battle,attacker,target,options.map)) error("Full cover blocks the attack.");
  return weaponRoll(battle,attacker,target,weapon,{...options,spellWeapon:true},random);
}

// Mirror Image: chance the attack strikes a duplicate instead of the creature.
function deflectMirrorImage(battle,target,random) {
  const entry = (target.conditions ?? []).find((effect) => (effect.mods?.images ?? effect.images) > 0);
  if (!entry) return false;
  const count = entry.mods?.images ?? entry.images;
  const threshold = count >= 3 ? 6 : count === 2 ? 8 : 11;
  const roll = d20(0,{random,label:"Mirror Image"});
  if (roll.kept < threshold) {log(battle,target.name+"'s mirror image is missed ("+roll.total+" vs "+threshold+").");return false;}
  const next = count - 1;
  if (entry.mods) entry.mods.images = next; else entry.images = next;
  log(battle,"An image of "+target.name+" is destroyed ("+roll.total+").");
  if (next <= 0) removeCondition(target,entry);
  return true;
}

export function checkSpellTethers(battle,map) {
  for (const caster of battle.actors) {
    if (caster.concentration?.bolt &&
        (!boltTarget(battle,caster,map) || canTakeTurn(battle,caster) && turnView(battle,caster).action && turnView(battle,caster).action !== "witch-bolt")) {
      endConcentration(battle,caster);
    }
  }
}

export function sustainWitchBolt(battle,caster,map,random = Math.random) {
  battle=turnView(battle,caster);
  const target=boltTarget(battle,caster,map);
  return withActionEvent(battle,caster,{action:"Sustain Witch Bolt",kind:"spell",
    ...spellVisualEvent(customSpellEffect('phb|witch bolt',battle.spellRules)?.definition?.visual??defaultSpellAnimation('witch bolt'),caster,target)},() => resolveWitchBolt(battle,caster,map,random));
}

function resolveWitchBolt(battle,caster,map,random) {
  assertTurn(battle,caster);
  const target = boltTarget(battle,caster,map);
  if (!target || battle.action) error("Witch Bolt’s action is unavailable.");
  battle.action = "witch-bolt";
  log(battle,caster.name+" sustains Witch Bolt on "+target.name+".");
  damageLog(battle,target,caster.concentration?.boltDice||"1d12",caster.concentration?.boltType||"lightning",false,random,caster);
}

export function wakeCreature(battle,actor,target) {
  battle=turnView(battle,actor);
  assertTurn(battle,actor);
  const sleep = condition(target,"Asleep");
  const hypnotic = condition(target,"Hypnotic Pattern");
  if ((!sleep && !hypnotic) || !occupies(target) || distanceFt(actor,target) > 5 || battle.action) error("Choose a sleeping or hypnotized creature within reach and use your action.");
  battle.action = "wake";
  if (sleep) removeCondition(target,sleep);
  if (hypnotic) removeCondition(target,hypnotic);
  log(battle,actor.name+" wakes "+target.name+".");
  recordAction(battle,actor,{action:"Wake "+target.name,kind:"ability"});
}

function areaDamage(battle,caster,source,square,effect,map,dice,random) {
  const area = spellCells(battle,caster,square,effect,map);
  const roll = rollDice(dice+"d"+effect.faces,{random});
  log(battle,effect.name+" damage roll — "+roll.breakdown+" = "+roll.total+".");
  for (const creature of battle.actors.filter((actor) => occupies(actor) && touchesArea(actor,area))) {
    const passed = spellSave(battle,source,creature,effect,{cover:0},random);
    const evasion = effect.save === "dex" && hasFeature(creature,"Evasion") && !incapacitated(creature);
    const amount = evasion && passed ? 0 : passed || evasion ? Math.floor(roll.total/2) : roll.total;
    recordDamage(battle,creature,amount,effect.type,evasion ? "Evasion" : passed ? "half on save" : "failed save",false,random,caster);
    if (creature.side === "hostile" && creature.side !== caster.side) joinInitiative(battle,creature,random);
  }
}

function exhaleBreath(battle,caster,options,random) {
  assertTurn(battle,caster);
  const breath = condition(caster,"Dragon’s Breath");
  const {square,map} = options;
  if (!breath || battle.action) error("The Dragon’s Breath action is unavailable.");
  if (!square || !map || !Number.isInteger(square.x) || !Number.isInteger(square.y) ||
      square.x < 0 || square.y < 0 || square.x >= map.cols || square.y >= map.rows || !distanceFt(caster,square)) {
    error("Choose the direction of the cone.");
  }
  battle.action = "breath";
  log(battle,caster.name+" exhales "+breath.type+" with Dragon’s Breath.");
  areaDamage(battle,caster,{spellDC:breath.dc},square,{name:"Dragon’s Breath",cone:15,save:"dex",faces:6,type:breath.type},map,breath.dice,random);
}

export function castSpell(battle,caster,target,spell,slotLevel,options = {},random = Math.random) {
  if(spell.castUsage?.itemOnly && (slotLevel!==0 || !hasHestiasFury(caster))) error("Cast this spell through "+hestiaName+".");
  if (handsOccupied(caster) && spellNeedsHands(spell)) error("Dragging occupies your hands. Spells with Somatic or Material components cannot be cast — verbal-only spells still work.");
  battle=turnView(battle,caster);
  const usage = spell.castUsage && slotLevel === 0 ? spell.castUsage : undefined;
  const original = {spellAbility:caster.spellAbility,spellDC:caster.spellDC,spellAttack:caster.spellAttack};
  const ability = caster.ability[spell.castingAbility];
  if (Number.isFinite(ability) && Number.isFinite(caster.proficiency)) {
    caster.spellAbility = ability;
    caster.spellDC = 8+caster.proficiency+ability;
    caster.spellAttack = caster.proficiency+ability;
  }
  try {
    const custom=customSpellEffect(spell.reference ?? spell.key,battle.spellRules);
    const definition=custom?.definition;
    const runtime=custom?.custom?custom:custom?.importedNative?nativeSpellDefinitions[custom.nativeKey]:spellEffects[spell.key];
    const rank=usage?spell.level:slotLevel;
    const shaped=formRule(definition,options.form);
    const aim=options.square??target;
    const shotFeet=aim&&Number.isFinite(caster.x)&&Number.isFinite(aim.x)?distanceFt(caster,aim):undefined;
    const visual=runtime?.exhale?breathAnimation(condition(caster,"Dragon’s Breath")?.type):
      resolveSpellAnimation(spell.name,shaped,{distanceFt:shotFeet});
    const length=['cone','line','wall'].includes(shaped?.shape)&&shaped.version===2?shaped.length/5:shaped?.shape==='cone'?shaped.radius/5:runtime?.cone?runtime.cone/5:visual?.length;
    const diameter=shaped&&['circle','ring','sphere','movable','aura'].includes(shaped.shape)
      ? Math.max(1,(shaped.radius>0?shaped.radius*2:5)/5)
      : shaped?.shape==='cube' ? Math.max(1,shaped.side/5)
      : runtime?.area&&!custom?.custom?(runtime.area+(runtime.areaPerSlot??0)*Math.max(0,rank-runtime.level))*2/5:undefined;
    const count=runtime?spellTargetCount(runtime,caster.level,rank):1;
    const targets=[...new Set((options.targets??[]).filter(Boolean))].filter(entry=>entry!==target).slice(0,count-1);
    const wallEnd=shaped&&needsEndpoint(shaped)?options.end:undefined;
    return withActionEvent(battle,caster,{action:runtime?.exhale?"Exhale Dragon’s Breath":spell.name,kind:"spell",target:target?.name,targetActor:target?.id,
      spellLevel:usage ? spell.level : slotLevel,spellReference:spell.reference || spell.key,
      ...spellVisualEvent(visual,caster,target,{square:runtime?.self?null:options.square,end:wallEnd,length,diameter,targets}),
      ...(Number.isFinite(shotFeet)?{attackDistance:shotFeet}:{}),
      ...(runtime?.teleport&&visual?.url?{visualDeparture:{x:caster.x,y:caster.y,creatureSize:creatureSize(caster)}}:{})},
      () => resolveSpell(battle,caster,target,spell,usage ? spell.level : slotLevel,options,random,usage));
  } finally {Object.assign(caster,original);}
}

function resolveSpell(battle,caster,target,spell,slotLevel,options,random,usage) {
  const custom=customSpellEffect(spell.reference ?? spell.key,battle.spellRules);
  if(custom?.custom)return castCustomSpell(battle,caster,target,spell,usage ? 0 : slotLevel,options,random);
  const effect = custom?.importedNative ? nativeSpellDefinitions[custom.nativeKey] : spellEffects[spell.key];
  if (!effect || spell.edition !== "2014" || spell.customUse) error("This spell needs manual adjudication.");
  if (effect.exhale) return exhaleBreath(battle,caster,options,random);
  const {level = 0, heal:healing} = effect;
  const timing = effect.bonus ? "bonus" : "action";
  checkCast(battle,caster,level,slotLevel,timing,usage,options.slotPool);
  const tier = 1 + [5,11,17].filter((threshold) => caster.level >= threshold).length;
  const square = options.square;
  const aimed = effect.area || effect.cone || effect.teleport;
  const count = spellTargetCount(effect,caster.level,slotLevel);
  const individual = [target,...(options.targets ?? [])];
  const targets = effect.self ? [caster] : effect.aid || effect.moreTargets ? [...new Set(individual.filter(Boolean))].slice(0,count) :
    effect.beams || effect.missiles ? Array.from({length:count},(_,index) => individual[index] ?? target) : [target];
  if (aimed) {
    if (!square || !options.map || !Number.isInteger(square.x) || !Number.isInteger(square.y) ||
        square.x < 0 || square.y < 0 || square.x >= options.map.cols || square.y >= options.map.rows) {
      error("Choose a square on the map.");
    }
    if (effect.teleport && !canStand(battle,caster,square.x,square.y,options.map)) error("Choose an unoccupied destination that fits the caster.");
    if (effect.cone) {
      if (!distanceFt(caster,square)) error("Choose the direction of the cone.");
    } else {
      if (distanceFt(caster,square) > effect.range) error("The selected square is out of range.");
      if (effect.teleport ? !canSee(battle,caster,square,options.map) : !lineClear(battle,caster,square,options.map)) {
        error("The spell cannot reach that square.");
      }
    }
  } else {
    if (!targets.length) error("Choose at least one target.");
    for (const creature of targets) {
      validTarget(caster,creature);
      if (effect.humanoid && creature.creatureType && creature.creatureType !== "humanoid") error(creature.name+" is not a humanoid.");
      if ((effect.attack || effect.save || effect.missiles) && charmedBy(caster,creature)) error("This character is charmed by "+creature.name+".");
      if (!effect.self && distanceFt(caster,creature) > effect.range) error(creature.name+" is out of range.");
      if (!effect.self && (options.cover === "full" || !lineClear(battle,caster,creature,options.map))) error("Full cover blocks the spell.");
      if (effect.sight && !canSee(battle,caster,creature,options.map)) error("You must be able to see " + creature.name + ".");
      if (healing && ["undead","construct"].includes(creature.creatureType)) error("This spell cannot heal that target.");
    }
    if (effect.cluster && targets.some((creature) => targets.some((other) => distanceFt(creature,other) > effect.cluster))) {
      error("The targets must be within "+effect.cluster+" ft of each other.");
    }
  }
  if (healing && !Number.isFinite(caster.spellAbility)) error("Set the spellcasting ability modifier.");
  if (effect.attack && !Number.isFinite(caster.spellAttack)) error("Set the spell attack bonus.");
  if (effect.save && !Number.isFinite(caster.spellDC)) error("Set the spell save DC.");
  if (effect.breath) {
    if (target.side !== 'party' || caster.side !== 'party' || (target.partyId||'party-1')!==(caster.partyId||'party-1') || !actorIsUp(target) || incapacitated(target)) error("Choose a willing, conscious ally.");
    if (!breathTypes.includes(options.damageType)) error("Choose a damage type for Dragon’s Breath.");
    if (!Number.isFinite(caster.spellDC)) error("Set the spell save DC.");
  }
  spendCast(battle,caster,level,slotLevel,timing,usage,options.slotPool);
  if (!effect.attack) breakInvisibility(battle,caster);
  if (effect.concentration) startConcentration(battle,caster,spell.name,effect.concentration);
  const destination = aimed ? " at square "+(square.x+1)+", "+(square.y+1) :
    effect.self ? "" : " on "+[...new Set(targets)].map(({name})=>name).join(", ");
  log(battle,caster.name+" casts "+spell.name+destination+(usage ? " · "+(spell.grantedBy ?? "class feature")+"." :
    level ? " · level "+slotLevel+" slot." : "."));
  if (effect.teleport) {
    caster.x=square.x; caster.y=square.y;
    checkSpellTethers(battle,options.map);
  } else if (effect.zone) {
    const cells = [...spellCells(battle,caster,square,effect,options.map,slotLevel)];
    battle.spellZones = [...(battle.spellZones ?? []),{caster:caster.id,name:effect.zone,cells}];
  } else if (effect.breath) {
    addCondition(battle,target,"Dragon’s Breath",effect.concentration,
      {concentration:caster.id,type:options.damageType,dc:caster.spellDC,dice:3+slotLevel-level});
  } else if (effect.temporary) {
    const amount = effect.retaliation ? slotLevel*5 : rollDice("1d4+"+(4+5*(slotLevel-1)),{random}).total;
    if (!caster.tempHp || !options.keepTemp) {
      caster.tempHp = amount;
      caster.agathys = effect.retaliation ? amount : null;
      caster.tempExpires = (battle.elapsed ?? 0) + 3600;
    }
    log(battle,caster.name+" has "+caster.tempHp+" temporary HP.");
  } else if (effect.aid) {
    for (const creature of targets) {
      const bonus = Math.max(0,5*(slotLevel-1)-(creature.aid ?? 0));
      creature.aid = (creature.aid ?? 0)+bonus;
      creature.maxHp += bonus;
      if (bonus) heal(creature,bonus);
      if (creature.aid === 5*(slotLevel-1)) creature.aidExpires=(battle.elapsed ?? 0)+28800;
      log(battle,creature.name+" gains "+bonus+" current and maximum HP from Aid.");
    }
  } else if (effect.area || effect.cone) {
    if (effect.sleep) {
      const area = spellCells(battle,caster,square,effect,options.map);
      const caught = battle.actors.filter((actor) => occupies(actor) && touchesArea(actor,area));
      const roll = rollDice((5+2*(slotLevel-level))+"d8",{random});
      let pool = roll.total;
      log(battle,spell.name+" HP pool — "+roll.breakdown+" = "+pool+".");
      for (const creature of caught.filter((actor) => actorIsUp(actor) && !condition(actor,"Asleep") && !actor.sleepImmune &&
          actor.creatureType !== "undead" && !storedDamageTypes(actor.conditionImmune).includes("charmed")).sort((a,b) => a.hp-b.hp)) {
        if (creature.hp > pool) break;
        pool -= creature.hp;
        addCondition(battle,creature,"Asleep",60);
      }
    } else {
      areaDamage(battle,caster,caster,square,{...effect,name:spell.name},options.map,(effect.dice ?? 8)+slotLevel-level,random);
    }
  } else if (healing) {
    const amount = rollDice(slotLevel+"d"+effect.faces+(caster.spellAbility>=0 ? "+" : "")+caster.spellAbility,{random,label:"Healing"});
    const restored = heal(target,amount.total);
    captureImpact(battle,target,{amount:restored,healing:true});
    log(battle,target.name+" regains "+restored+" HP ("+amount.breakdown+").");
  } else if (effect.condition) {
    for (const creature of targets) {
      if (effect.save && spellSave(battle,caster,creature,effect,options,random)) continue;
      addCondition(battle,creature,effect.condition,effect.duration ?? effect.concentration,
        {source:caster.id,concentration:effect.concentration ? caster.id : null,
          repeatSave:effect.repeat ? effect.save : null,dc:caster.spellDC});
    }
    if (effect.concentration && !battle.actors.some((actor) => actor.conditions?.some((entry) => entry.concentration === caster.id))) {
      endConcentration(battle,caster);
    }
  } else if (effect.missiles) {
    const roll = rollDice("1d4+1",{random});
    // Darts strike together, so group the damage by target.
    for (const creature of new Set(targets)) {
      const darts = targets.filter((entry) => entry === creature).length;
      recordDamage(battle,creature,darts*roll.total,effect.type,darts+" darts × "+roll.total,false,random,caster);
    }
  } else if (effect.half) {
    const passed = condition(target,"Deafened") || spellSave(battle,caster,target,effect,options,random);
    const roll = rollDice((effect.dice+slotLevel-level)+"d"+effect.faces,{random});
    recordDamage(battle,target,passed ? Math.floor(roll.total/2) : roll.total,effect.type,roll.breakdown,false,random,caster);
    if (effect.flee && !passed) fleeFrom(battle,caster,target,options.map);
  } else if (effect.save) {
    if (effect.mock && condition(target,"Deafened")) return;
    if (!spellSave(battle,caster,target,effect,options,random)) {
      damageLog(battle,target,tier+"d"+effect.faces,effect.type,false,random,caster);
      if (effect.mock && actorIsUp(target)) target.mocked = true;
      if (effect.sliver && actorIsUp(target)) target.sliver = {caster:caster.id,round:battle.round+1};
    }
  } else {
    if (effect.attack) {
      for (const creature of targets) {
        if (creature.dead) continue;
        const dice = effect.bolt ? slotLevel : effect.beams ? 1 : tier;
        const hit = rangedSpellAttack(battle,caster,creature,effect,dice+"d"+effect.faces,options,random);
        if (effect.bolt && caster.concentration) {
          if (hit && occupies(creature)) {
            caster.concentration.bolt = creature.id;
            battle.action = "witch-bolt";
          } else endConcentration(battle,caster);
        }
      }
    }
  }
}

export function drinkPotion(battle, actor, item, random = Math.random) {
  battle=turnView(battle,actor);
  return withActionEvent(battle,actor,{action:item?.name ?? "Use item",kind:"heal"},() => resolvePotion(battle,actor,item,random));
}

function resolvePotion(battle, actor, item, random) {
  if (battle.round) {
    assertTurn(battle, actor);
    if (battle.action) error("This token has used its action.");
  } else if (!actorIsUp(actor)) error("This token cannot use items at 0 hit points.");
  if (handsOccupied(actor)) error("Dragging occupies your hands. Drop the creature before using items.");
  if (!item || item.quantity <= 0 || !item.formula) error("Choose an available healing potion.");
  const amount = rollDice(item.formula, {random});
  if (battle.round) battle.action = "potion";
  item.quantity -= 1;consumePotionInventory(actor,item);
  const restored = heal(actor, amount.total);
  captureImpact(battle,actor,{amount:restored,healing:true});
  log(battle, actor.name + " uses " + item.name + " and regains " + restored + " HP (" + amount.breakdown + ").");
}


// BG3-style Help Up deliberately restores 1 HP rather than stabilizing at zero.
export function helpUp(battle,actor,target,map) {
  battle=turnView(battle,actor);
  if(battle.round) {assertTurn(battle,actor);if(battle.action) error("This token has used its action.");}
  else if(!actorIsUp(actor) || incapacitated(actor)) error("Choose a conscious helper.");
  if (handsOccupied(actor)) error("Dragging occupies your hands. Drop the creature before helping someone up.");
  validTarget(actor,target);
  if(target.side!=='party' || actor.side!=='party' || (target.partyId||'party-1')!==(actor.partyId||'party-1') || target.dead || target.hp!==0) error("Choose a living, unconscious ally.");
  if(distanceFt(actor,target)>5 || !lineClear(battle,actor,target,map)) error("Move within 5 feet of your ally with a clear path.");
  return withActionEvent(battle,actor,{action:"Help Up",kind:"heal",target:target.name,targetActor:target.id},()=>{
    if(battle.round) battle.action="help-up";
    const restored=heal(target,1);target.prone=false;captureImpact(battle,target,{amount:restored,healing:true});
    log(battle,actor.name+" helps "+target.name+" up to 1 HP.");
  });
}

export function throwHealingPotion(battle,actor,target,item,map,random=Math.random) {
  battle=turnView(battle,actor);
  if(battle.round) {assertTurn(battle,actor);if(battle.action) error("This token has used its action.");}
  else if(!actorIsUp(actor) || incapacitated(actor)) error("Choose a conscious thrower.");
  if (handsOccupied(actor)) error("Dragging occupies your hands. Drop the creature before throwing items.");
  validTarget(actor,target);
  if(target.dead) error("Healing cannot revive a dead creature.");
  if(distanceFt(actor,target)>30 || !lineClear(battle,actor,target,map)) error("Choose a target within 30 feet with a clear throwing path.");
  if(!item || !(actor.potions ?? []).includes(item) || item.quantity<=0 || !item.formula) error("Choose an available healing potion.");
  return withActionEvent(battle,actor,{action:"Throw "+item.name,kind:"heal",target:target.name,targetActor:target.id},()=>{
    const amount=rollDice(item.formula,{random});if(battle.round) battle.action="throw-potion";item.quantity--;consumePotionInventory(actor,item);
    const restored=heal(target,amount.total);captureImpact(battle,target,{amount:restored,healing:true});
    log(battle,actor.name+" throws "+item.name+" to "+target.name+", restoring "+restored+" HP ("+amount.breakdown+").");
  });
}


export function spendObjectAction(battle,actor,name){
  battle=turnView(battle,actor);
  if(battle.round){assertTurn(battle,actor);if(battle.action)error("This token has used its action.");battle.action=name;}
  else if(!actorIsUp(actor)||incapacitated(actor))error("Choose a conscious character.");
}
function syncCarriedBody(battle,actor,previousSquare){
  const carried=actor.carrying && battle.actors.find(body=>body.id===actor.carrying);
  if(carried){carried.x=actor.x;carried.y=actor.y;}
  const dragged=actor.dragging && battle.actors.find(body=>body.id===actor.dragging);
  // Dragged bodies stay on the ground one square behind the mover.
  if(dragged && previousSquare && (previousSquare.x!==actor.x || previousSquare.y!==actor.y)){
    dragged.x=previousSquare.x;dragged.y=previousSquare.y;
  }
}

function consumePotionInventory(actor,item){const stored=actor.items?.find(entry=>entry.name.toLowerCase()===item.name.toLowerCase());if(stored)stored.quantity=Math.max(0,(stored.quantity??0)-1);}
