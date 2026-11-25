// Dominate Person / Dominate Beast: telepathic commands (free) and total control (action).
import {
  actorIsUp, approachPath, canTakeTurn, diceTerms, distanceFt, incapacitated, lineClear,
  log, moveLeft, moveToken, occupies, rollStrike, speedOf, turnAction, turnView,
} from './combat.mjs';
import {recordAction} from './action-events.mjs';
import {overlaps} from './actor-space.mjs';

export const DOMINATE_ORDERS = [
  {id: 'attack', label: 'Attack', needsTarget: true},
  {id: 'approach', label: 'Approach', needsTarget: true},
  {id: 'flee', label: 'Flee from', needsTarget: true},
  {id: 'dodge', label: 'Dodge', needsTarget: false},
  {id: 'dash', label: 'Dash toward', needsTarget: true},
];

const orderOf = (id) => DOMINATE_ORDERS.find((entry) => entry.id === id);
const canAct = (actor) => actorIsUp(actor) && occupies(actor) && !incapacitated(actor);
const weaponRange = (weapon) => weapon.normalRange || weapon.reach || 5;
const attackRange = (weapon) => weapon.longRange || weaponRange(weapon);

export function dominateSource(actor) {
  return actor?.conditions?.find((effect) => effect.name === 'Charmed' && effect.dominated)?.source ?? null;
}

export function isDominated(actor) {
  return Boolean(dominateSource(actor));
}

export function thrallsOf(battle, caster) {
  if (!caster) return [];
  return battle.actors.filter((actor) => dominateSource(actor) === caster.id && canAct(actor));
}

function requireThrall(caster, thrall) {
  if (!thrall || dominateSource(thrall) !== caster.id) throw new Error('That creature is not dominated by this caster.');
  if (!canAct(thrall)) throw new Error(thrall.name + ' cannot act.');
}

function describeOrder(order, target) {
  const entry = orderOf(order);
  if (!entry) return order;
  return entry.needsTarget && target ? entry.label.toLowerCase() + ' ' + target.name : entry.label.toLowerCase();
}

export function issueDominateCommand(battle, caster, thrall, order, targetId) {
  requireThrall(caster, thrall);
  const entry = orderOf(order);
  if (!entry) throw new Error('Choose a dominate command.');
  const target = targetId ? battle.actors.find((actor) => actor.id === targetId) : null;
  if (entry.needsTarget) {
    if (!target || !canAct(target)) throw new Error('Choose a living target for that command.');
    if (order === 'attack' && target.id === caster.id) throw new Error('A dominated creature cannot attack its charmer.');
  }
  thrall.dominateOrder = {kind: order, targetId: entry.needsTarget ? target.id : null, from: caster.id, issued: battle.round ?? 0};
  log(battle, caster.name + ' telepathically commands ' + thrall.name + ' to ' + describeOrder(order, target) + '.');
  recordAction(battle, caster, {action: 'Command ' + thrall.name, kind: 'dominate', messages: [battle.log.at(-1)]});
}

export function seizeDominateControl(battle, caster, thrall, order, targetId) {
  requireThrall(caster, thrall);
  if (!battle.round || !canTakeTurn(battle, caster)) throw new Error('Total control requires your action on your turn.');
  const budget = turnView(battle, caster);
  if (budget.action) throw new Error('This token has used its action.');
  budget.action = 'dominate-control';
  thrall.dominateControl = {from: caster.id, untilActor: caster.id, untilRound: battle.round + 1};
  log(battle, caster.name + ' takes total control of ' + thrall.name + ' until the end of ' + caster.name + '’s next turn.');
  recordAction(battle, caster, {action: 'Total control · ' + thrall.name, kind: 'dominate', messages: [battle.log.at(-1)]});
  if (order) issueDominateCommand(battle, caster, thrall, order, targetId);
}

function weaponsOf(actor) {
  return actor.attacks.filter((weapon) => Number.isFinite(weapon.bonus) && diceTerms(weapon.damage))
    .flatMap((weapon) => weapon.thrown ? [weapon, {...weapon, ...weapon.thrown, name: weapon.name + ' (thrown)'}] : [weapon])
    .sort((a, b) => Number(Boolean(a.normalRange)) - Number(Boolean(b.normalRange)));
}

function attackOne(battle, map, actor, target, weapons, random) {
  for (const weapon of weapons) {
    if (distanceFt(actor, target) > attackRange(weapon) || !lineClear(battle, actor, target, map)) continue;
    rollStrike(battle, actor, target, weapon, {map}, random);
    return true;
  }
  return false;
}

function moveToward(battle, map, actor, target, weapons = []) {
  if (!moveLeft(battle, actor) || !target) return;
  const path = approachPath(battle, actor, map, (cell) =>
    weapons.length
      ? weapons.some((weapon) => distanceFt(cell, target) <= weaponRange(weapon) && lineClear(battle, cell, target, map))
      : distanceFt(cell, target) <= 5);
  if (!path?.cost) return;
  const canDash = !battle.action && speedOf(actor) > 0;
  if (path.cost > moveLeft(battle, actor) && canDash) turnAction(battle, actor, 'dash');
  const step = path.path.slice().reverse().find((cell) => cell.cost <= moveLeft(battle, actor) &&
    !battle.actors.some((other) => other.id !== actor.id && occupies(other) && overlaps({...actor, ...cell}, other)));
  if (step) moveToken(battle, actor, step.x, step.y, map);
}

function moveAway(battle, map, actor, from) {
  if (!moveLeft(battle, actor) || !from) return;
  const start = distanceFt(actor, from);
  const path = approachPath(battle, actor, map, (cell) => distanceFt(cell, from) >= start + 20);
  if (!path?.cost) {
    // Fall back: dash and step toward any farther square.
    if (!battle.action && speedOf(actor) > 0) turnAction(battle, actor, 'dash');
    const fallback = approachPath(battle, actor, map, (cell) => distanceFt(cell, from) > start);
    if (!fallback?.cost) return;
    const step = fallback.path.slice().reverse().find((cell) => cell.cost <= moveLeft(battle, actor) &&
      !battle.actors.some((other) => other.id !== actor.id && occupies(other) && overlaps({...actor, ...cell}, other)));
    if (step) moveToken(battle, actor, step.x, step.y, map);
    return;
  }
  if (path.cost > moveLeft(battle, actor) && !battle.action && speedOf(actor) > 0) turnAction(battle, actor, 'dash');
  const step = path.path.slice().reverse().find((cell) => cell.cost <= moveLeft(battle, actor) &&
    !battle.actors.some((other) => other.id !== actor.id && occupies(other) && overlaps({...actor, ...cell}, other)));
  if (step) moveToken(battle, actor, step.x, step.y, map);
}

function executeOrder(battle, map, actor, order, random) {
  const target = order.targetId ? battle.actors.find((entry) => entry.id === order.targetId) : null;
  const weapons = weaponsOf(actor);
  if (actor.prone && speedOf(actor) && moveLeft(battle, actor) >= speedOf(actor) / 2) turnAction(battle, actor, 'stand');
  if (order.kind === 'dodge') {
    if (!battle.action) turnAction(battle, actor, 'dodge');
    return;
  }
  if (order.kind === 'flee') {
    moveAway(battle, map, actor, target);
    if (!battle.action && canAct(actor)) turnAction(battle, actor, 'dash');
    moveAway(battle, map, actor, target);
    return;
  }
  if (order.kind === 'approach' || order.kind === 'dash') {
    if (order.kind === 'dash' && !battle.action && speedOf(actor) > 0) turnAction(battle, actor, 'dash');
    moveToward(battle, map, actor, target, []);
    return;
  }
  if (order.kind === 'attack' && target && canAct(target)) {
    if (!attackOne(battle, map, actor, target, weapons, random)) {
      moveToward(battle, map, actor, target, weapons);
      if (battle.movement) return;
      attackOne(battle, map, actor, target, weapons, random);
    }
    while (canAct(actor) && (!battle.action || battle.action === 'attack') && battle.attacksMade < actor.swings) {
      if (!attackOne(battle, map, actor, target, weapons, random)) break;
      if (battle.classReaction) return;
    }
    if (!battle.action && canAct(actor)) turnAction(battle, actor, 'dodge');
  }
}

// Returns true when this hostile’s turn was handled as a dominated thrall (skip normal AI).
export function runDominatedTurn(battle, map, actor, random = Math.random) {
  const sourceId = dominateSource(actor);
  if (!sourceId) return false;
  const caster = battle.actors.find((entry) => entry.id === sourceId);
  if (!caster || caster.side !== 'party') return false;
  if (!canAct(actor)) return true;
  const order = actor.dominateOrder;
  if (!order || order.from !== caster.id) {
    // No standing order: idle safely rather than attacking the party.
    if (!battle.action) turnAction(battle, actor, 'dodge');
    return true;
  }
  delete actor.dominateOrder;
  log(battle, actor.name + ' obeys ' + caster.name + '’s command.');
  executeOrder(battle, map, actor, order, random);
  return true;
}
