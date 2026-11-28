import {
  actorIsUp, approachPath, charmedBy, currentActor, diceTerms, distanceFt, endInitiative, endTurn, incapacitated, lineClear,
  log, moveLeft, moveToken, occupies, opportunity, resolveOpportunity, rollStrike, speedOf, turnAction,
} from "./combat.mjs";
import {runDominatedTurn} from "./dominate.mjs";
import {overlaps} from './actor-space.mjs';

const canAct = (actor) => actorIsUp(actor) && occupies(actor);
const weaponRange = (weapon) => weapon.normalRange || weapon.reach || 5;
const attackRange = (weapon) => weapon.longRange || weaponRange(weapon);
const waitingForSave = (actor) => actor?.resolveDeath && !actor.dead && !actor.stable && actor.hp === 0;
/** Shared rooms track controllers{}; solo play deletes the map. Unclaimed PCs auto-skip. */
const unclaimedParty = (battle, actor) => Boolean(
  actor?.side === "party" &&
  battle.controllers &&
  !battle.controllers[actor.id] &&
  !(waitingForSave(actor) && !battle.deathRolled)
);

export function enemyTurnPending(battle) {
  if (!battle.round) return false;
  if (battle.classReaction) return false;
  const reaction = opportunity(battle);
  if (reaction) return reaction.foe.side === "hostile";
  const actor = currentActor(battle);
  // Dead PCs must not freeze initiative — auto-skip their cursor slot.
  if (actor?.dead) return true;
  // Befriended kennel wolves act automatically on the party's side.
  if (actor?.kennelAlly) return true;
  if (unclaimedParty(battle, actor)) return true;
  return actor?.side === "hostile" || (actor?.side === "party" &&
    (incapacitated(actor) && (!waitingForSave(actor) || battle.deathRolled) || actor.stable && !actorIsUp(actor)));
}

function attackTarget(battle, map, actor, targets, weapons, normalRangeOnly = false) {
  for (const weapon of weapons) {
    for (const target of targets) {
      const range = normalRangeOnly ? weaponRange(weapon) : attackRange(weapon);
      if (distanceFt(actor,target) <= range && lineClear(battle,actor,target,map)) return {target,weapon};
    }
  }
  return null;
}

function approach(battle, map, actor, targets, weapons) {
  if (!moveLeft(battle,actor) || !targets.length || !weapons.length) return;
  const path = approachPath(battle,actor,map,(cell) =>
    targets.some((target) => weapons.some((weapon) =>
      distanceFt(cell,target) <= weaponRange(weapon) && lineClear(battle,cell,target,map))));
  if (!path?.cost) return;

  const canDash = !battle.action && speedOf(actor) > 0;
  if (path.cost > moveLeft(battle,actor) && canDash && !attackTarget(battle,map,actor,targets,weapons)) {
    turnAction(battle,actor,"dash");
  }
  const step = path.path.slice().reverse().find((cell) => cell.cost <= moveLeft(battle,actor) &&
    !battle.actors.some((other) => other.id!==actor.id && occupies(other) && overlaps({...actor,...cell},other)));
  if (!step) return;
  if (actor.nimbleEscape && !battle.bonusUsed && targets.some((target) =>
    distanceFt(actor,target) <= 5 && distanceFt({...actor,...step},target) > 5)) turnAction(battle,actor,"bonus-disengage");
  moveToken(battle,actor,step.x,step.y,map);
}

function enemyTurn(battle, map, actor, heroes, random) {
  if (!canAct(actor) || incapacitated(actor)) return;
  if (runDominatedTurn(battle, map, actor, random)) return;
  if (actor.prone && speedOf(actor) && moveLeft(battle,actor) >= speedOf(actor)/2) {
    turnAction(battle,actor,"stand");
  }
  const weapons = actor.attacks.filter((weapon) => Number.isFinite(weapon.bonus) && diceTerms(weapon.damage))
    .flatMap((weapon) => weapon.thrown ? [weapon,{...weapon,...weapon.thrown,name:weapon.name+" (thrown)"}] : [weapon])
    .sort((a,b) => Number(Boolean(a.normalRange)) - Number(Boolean(b.normalRange)));
  const targets = heroes.filter((target) => canAct(target) && !charmedBy(actor,target)).sort((a,b) => distanceFt(actor,a)-distanceFt(actor,b));
  if (!battle.action && !attackTarget(battle,map,actor,targets,weapons,true)) {
    approach(battle,map,actor,targets,weapons);
    if (battle.movement) return;
  }
  while (canAct(actor) && (!battle.action || battle.action === "attack") && battle.attacksMade < actor.swings) {
    // Imported multiattack can restrict the weapons used for each strike.
    const routine = actor.multiattack?.[battle.attacksMade];
    const attack = attackTarget(battle,map,actor,targets.filter(canAct),
      routine ? weapons.filter(({name}) => name === routine.name) : weapons) ??
      (!battle.action && routine ? attackTarget(battle,map,actor,targets.filter(canAct),weapons) : null);
    if (!attack) break;
    const {weapon,target} = attack;
    rollStrike(battle,actor,target,weapon,{map,mode:routine?.name === weapon.name && routine.disadvantage ? "disadvantage" : ""},random);
    if(battle.classReaction) return;
    if (routine && routine.name !== weapon.name) break;
  }
  if (!battle.action && canAct(actor)) turnAction(battle,actor,"dodge");
}

export function runEnemyTurns(battle, map, random = Math.random) {
  const before = battle.log.at(-1);
  let lastEnemy = null;
  // One sweep reaches another playable turn, a reaction, or the end of the encounter.
  const maximum = battle.order.length + battle.actors.length + 1;
  for (let step = 0; battle.round && step < maximum; step++) {
    if(battle.classReaction) break;
    const reaction = opportunity(battle);
    if (reaction) {
      if (reaction.foe.side !== "hostile") break;
      lastEnemy = reaction.foe.name;
      resolveOpportunity(battle,reaction.attacks.length ? 0 : null,random,map);
      continue;
    }
    const heroes = battle.actors.filter(({side}) => side === "party");
    if (!heroes.some((actor) => occupies(actor) && (actorIsUp(actor) || waitingForSave(actor)))) {
      endInitiative(battle);
      const message = heroes.length ? "The party can no longer continue." : "Add a party member to start combat.";
      log(battle,message);
      return message;
    }
    if (!battle.actors.some((actor) => actor.side === "hostile" && battle.order.includes(actor.id) && canAct(actor))) break;
    const actor = currentActor(battle);
    if (actor?.dead) {
      endTurn(battle, random, actor);
      continue;
    }
    if (actor?.kennelAlly && actor.side === "party") {
      const foes = battle.actors.filter((entry) => entry.side === "hostile" && canAct(entry));
      enemyTurn(battle, map, actor, foes, random);
      lastEnemy = actor.name;
      if (battle.movement || battle.classReaction) break;
      endTurn(battle, random);
      continue;
    }
    if (unclaimedParty(battle, actor)) {
      log(battle, actor.name + "’s turn was skipped (unclaimed).");
      endTurn(battle, random, actor);
      continue;
    }
    if (actor?.side === "hostile") {
      enemyTurn(battle,map,actor,heroes,random);
      lastEnemy = actor.name;
      if (battle.movement || battle.classReaction) break;
    } else if (!incapacitated(actor) && (!actor?.stable || actorIsUp(actor))) break;
    if (waitingForSave(actor) && !battle.deathRolled) break;
    endTurn(battle,random);
  }
  return lastEnemy && battle.log.at(-1) !== before ? lastEnemy + " acted. See the combat log for rolls." : "";
}
