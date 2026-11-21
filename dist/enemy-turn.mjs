import {
  actorIsUp, approachPath, currentActor, diceTerms, distanceFt, endInitiative, endTurn, lineClear,
  log, moveLeft, moveToken, occupies, opportunity, resolveOpportunity, rollStrike, speedOf, turnAction,
} from "./combat.mjs";

const canAct = (actor) => actorIsUp(actor) && occupies(actor);
const weaponRange = (weapon) => weapon.normalRange || weapon.reach || 5;
const attackRange = (weapon) => weapon.longRange || weaponRange(weapon);
const waitingForSave = (actor) => actor?.resolveDeath && !actor.dead && !actor.stable && actor.hp === 0;

export function enemyTurnPending(battle) {
  if (!battle.round) return false;
  const reaction = opportunity(battle);
  if (reaction) return reaction.foe.side === "hostile";
  const actor = currentActor(battle);
  return actor?.side === "hostile" || (actor?.side === "party" && actor.stable && !actorIsUp(actor));
}

function attackTarget(battle, map, actor, targets, weapons, normalRangeOnly = false) {
  for (const weapon of weapons.toSorted((a,b) => Number(Boolean(a.normalRange)) - Number(Boolean(b.normalRange)))) {
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
  const step = path.path.findLast((cell) => cell.cost <= moveLeft(battle,actor) &&
    !battle.actors.some((other) => occupies(other) && other.x === cell.x && other.y === cell.y));
  if (!step) return;
  if (actor.nimbleEscape && !battle.bonusUsed && targets.some((target) =>
    distanceFt(actor,target) <= 5 && distanceFt(step,target) > 5)) turnAction(battle,actor,"bonus-disengage");
  moveToken(battle,actor,step.x,step.y,map);
}

function enemyTurn(battle, map, actor, heroes, random) {
  if (!canAct(actor)) return;
  if (actor.prone && speedOf(actor) && moveLeft(battle,actor) >= speedOf(actor)/2) {
    turnAction(battle,actor,"stand");
  }
  const weapons = actor.attacks.filter((weapon) => Number.isFinite(weapon.bonus) && diceTerms(weapon.damage))
    .flatMap((weapon) => weapon.thrown ? [weapon,{...weapon,...weapon.thrown,name:weapon.name+" (thrown)"}] : [weapon]);
  const targets = heroes.filter(canAct).sort((a,b) => distanceFt(actor,a)-distanceFt(actor,b));
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
    const reaction = opportunity(battle);
    if (reaction) {
      if (reaction.foe.side !== "hostile") break;
      lastEnemy = reaction.foe.name;
      resolveOpportunity(battle,reaction.attacks.length ? 0 : null,random,map);
      continue;
    }
    const heroes = battle.actors.filter(({side}) => side === "party");
    if (heroes.length && !heroes.some((actor) => actorIsUp(actor) || waitingForSave(actor))) {
      endInitiative(battle);
      log(battle,"The party can no longer continue.");
      return "The party can no longer continue.";
    }
    if (!battle.actors.some((actor) => actor.side === "hostile" && battle.order.includes(actor.id) && canAct(actor))) break;
    const actor = currentActor(battle);
    if (actor?.side === "hostile") {
      enemyTurn(battle,map,actor,heroes,random);
      lastEnemy = actor.name;
      if (battle.movement) break;
    } else if (!actor?.stable || actorIsUp(actor)) break;
    endTurn(battle);
  }
  return lastEnemy && battle.log.at(-1) !== before ? lastEnemy + " acted. See the combat log for rolls." : "";
}
