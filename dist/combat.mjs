import {crossesMapWall, mapFloor, mapLineClear, mapWalls} from "./map-walls.mjs";

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

export function rollDice(expression, {doubleDice = false, random = Math.random} = {}) {
  const terms = diceTerms(expression);
  if (!terms) error("Enter a dice expression such as 2d6+3 or 1d8+1d4+4.");
  let total = 0;
  const breakdown = terms.map(({sign, count, faces, flat}, index) => {
    const values = faces ? Array.from({length:count * (doubleDice ? 2 : 1)}, () => 1 + Math.floor(random() * faces)) : [];
    const subtotal = faces ? values.reduce((sum, value) => sum + value, 0) : flat;
    total += sign * subtotal;
    const lead = sign < 0 ? "− " : index ? "+ " : "";
    return lead + (faces ? (doubleDice ? count * 2 : count) + "d" + faces + " [" + values.join(", ") + "]" : flat);
  });
  return {total, breakdown:breakdown.join(" ")};
}

export function d20(modifier, {advantage = false, disadvantage = false, random = Math.random} = {}) {
  if (!Number.isFinite(modifier)) error("Enter a numeric roll modifier.");
  const rolls = Array.from({length:advantage === disadvantage ? 1 : 2}, () => rollDice("d20", {random}).total);
  const kept = advantage && !disadvantage ? Math.max(...rolls) : Math.min(...rolls);
  const bonus = modifier >= 0 ? " + " + modifier : " − " + Math.abs(modifier);
  return {kept, total:kept + modifier, breakdown:rolls.join("/") + bonus};
}

export const distanceFt = (one, two) => Math.max(Math.abs(one.x - two.x), Math.abs(one.y - two.y)) * 5;
export const keyAt = (x, y) => x + ":" + y;
export const currentActor = (battle) => battle.actors.find(({id}) => id === battle.order[battle.turn]);
export const actorIsUp = (actor) => Boolean(actor && actor.hp > 0 && !actor.dead);
export const occupies = (actor) => !actor.dead && actor.x != null && actor.y != null;
export const modifier = (score) => score == null ? null : Math.floor((score - 10) / 2);

export function newBattle() {
  return {actors:[], order:[], turn:0, round:0, spent:0, dash:0, action:null, attacksMade:0, bonusUsed:false, log:[], terrain:{}, elapsed:0};
}

export function log(battle, text) {
  battle.log.push(text);
  if (battle.log.length > 160) battle.log.splice(0, battle.log.length - 160);
}

function monsterEvent(battle, actor, event) {
  if (actor.side !== "hostile" || !Number.isInteger(actor.x) || !Number.isInteger(actor.y)) return;
  const events = battle.monsterEvents ??= [];
  events.push({id:(events.at(-1)?.id ?? 0)+1,actor:actor.id,name:actor.name,x:actor.x,y:actor.y,...event});
  if (events.length > 48) events.shift();
}

export function makeActor(record) {
  return {
    attacks:[], spells:[], slots:{}, saves:{}, ability:{}, resist:[], immune:[], vulnerable:[],
    side:"hostile", hp:1, maxHp:1, tempHp:0, ac:10, speed:30, initiative:0, dex:10,
    successes:0, failures:0, prone:false, stable:false, dead:false, swings:1, resolveDeath:false,
    x:null, y:null, ...record, id:record.id ?? globalThis.crypto.randomUUID(),
  };
}

function advanceTime(battle, seconds) {
  battle.elapsed = (battle.elapsed ?? 0) + seconds;
  for (const creature of battle.actors) {
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
      }
      log(battle,"Aid expires for "+creature.name+".");
    }
  }
}

function resetTurn(battle) {
  const actor = currentActor(battle);
  if (!actor) return;
  actor.dodging = false;
  actor.disengaged = false;
  actor.reactionUsed = false;
  for (const creature of battle.actors) {
    if (creature.slowedBy === actor.id) creature.slowedBy = null;
  }
  battle.spent = 0;
  battle.dash = 0;
  battle.action = null;
  battle.attacksMade = 0;
  battle.bonusUsed = false;
  battle.cast = null;
  if (actor.hp === 0 && actor.resolveDeath && !actor.stable) {
    log(battle, actor.name + " must make a death saving throw.");
  }
}

export function startInitiative(battle, random = Math.random, participantIds = null) {
  if (battle.round) error("Initiative is already running.");
  const ready = battle.actors.filter((actor) => occupies(actor) && actor.side !== "neutral" &&
    (!participantIds || participantIds.has(actor.id)));
  if (ready.length < 2) error("Place at least two tokens on the grid.");
  const scores = ready.map((actor) => {
    const roll = d20(actor.initiative, {random});
    actor.initiativeRoll = roll.total;
    return actor;
  }).sort((a, b) => b.initiativeRoll - a.initiativeRoll || (b.dex ?? 0) - (a.dex ?? 0));
  battle.order = scores.map(({id}) => id);
  battle.round = 1;
  battle.turn = 0;
  battle.deathRolled = false;
  resetTurn(battle);
  log(battle, "Initiative — " + scores.map((actor) => actor.name + " " + actor.initiativeRoll).join(", ") + ".");
  return currentActor(battle);
}

export function joinInitiative(battle, actor, random = Math.random) {
  if (!battle.round || !actorIsUp(actor) || !occupies(actor) || battle.order.includes(actor.id)) return;
  actor.initiativeRoll = d20(actor.initiative,{random}).total;
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

export function endTurn(battle) {
  if (!battle.round) error("Start initiative first.");
  if (battle.movement) error("Resolve the opportunity attack before ending the turn.");
  const actor = currentActor(battle);
  if (actor?.hp === 0 && actor.resolveDeath && !actor.dead && !actor.stable && !battle.deathRolled) {
    error("Roll this character's death save before ending the turn.");
  }
  if (actor) {
    actor.mocked = false;
    for (const creature of battle.actors) {
      if (creature.sliver?.caster === actor.id && creature.sliver.round <= battle.round) creature.sliver = null;
    }
  }
  for (let checked = 0; checked < battle.order.length; checked++) {
    battle.turn += 1;
    if (battle.turn === battle.order.length) {
      battle.turn = 0;
      battle.round += 1;
      advanceTime(battle,6);
    }
    const next = currentActor(battle);
    if (next?.dead) {
      for (const entry of battle.actors) {
        if (entry.slowedBy === next.id) entry.slowedBy = null;
      }
    }
    if (next && !next.dead) {
      battle.deathRolled = false;
      resetTurn(battle);
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
  log(battle, "Initiative ended.");
}

export const speedOf = (actor) => Math.max(0, actor.speed - (actor.slowedBy ? 10 : 0));
export const moveLeft = (battle, actor) => Math.max(0, speedOf(actor) + battle.dash - battle.spent);

export function placeToken(battle, actor, x, y, board) {
  if (actor.dead) error("This token is defeated.");
  if (x < 0 || y < 0 || x >= board.cols || y >= board.rows) error("Choose a square inside the grid.");
  if (!mapFloor(board,x,y) || battle.terrain[keyAt(x,y)] === "wall") error("This square is blocked.");
  if (battle.actors.some((entry) => entry.id !== actor.id && occupies(entry) && entry.x === x && entry.y === y)) {
    error("Another token occupies that square.");
  }
  actor.x = x;
  actor.y = y;
}

function findPath(battle, actor, x, y, board, exploration = false, {goal, budget = exploration ? Infinity : moveLeft(battle,actor)} = {}) {
  const origin = keyAt(actor.x, actor.y);
  const destination = keyAt(x, y);
  const blockers = new Map(battle.actors.filter((entry) => entry.id !== actor.id && occupies(entry)).map((entry) =>
    [keyAt(entry.x, entry.y), entry]));
  if (blockers.has(destination)) error("Another token occupies that square.");
  const known = new Map([[origin, 0]]);
  const pending = [{x:actor.x, y:actor.y, cost:0, previous:null}];
  let nextUnvisited = 0;
  const blocked = (col,row) => !mapFloor(board,col,row) || battle.terrain[keyAt(col,row)] === "wall";
  while (exploration ? nextUnvisited < pending.length : pending.length) {
    if (!exploration) pending.sort((a,b) => b.cost - a.cost);
    const cell = exploration ? pending[nextUnvisited++] : pending.pop();
    const here = keyAt(cell.x, cell.y);
    if (cell.cost !== known.get(here)) continue;
    if (here === destination || (goal && !blockers.has(here) && goal(cell))) {
      const path = [];
      for (let step = cell; step.previous; step = step.previous) path.push({x:step.x,y:step.y,cost:step.cost});
      return {cost:cell.cost,path:path.reverse()};
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = cell.x + dx;
        const row = cell.y + dy;
        const next = keyAt(col,row);
        if ((!dx && !dy) || col < 0 || row < 0 || col >= board.cols || row >= board.rows || blocked(col,row)) continue;
        if (crossesMapWall(board,cell,{x:col,y:row})) continue;
        if (dx && dy && (blocked(cell.x + dx, cell.y) || blocked(cell.x, cell.y + dy))) continue;
        if (blockers.has(next) && blockers.get(next).side !== actor.side) continue;
        const difficult = battle.terrain[next] === "difficult" || blockers.has(next);
        const cost = cell.cost + (exploration ? 5 : (difficult ? 10 : 5) + (actor.prone ? 5 : 0));
        if (cost > budget || cost >= (known.get(next) ?? Infinity)) continue;
        known.set(next, cost);
        pending.push({x:col, y:row, cost, previous:cell});
      }
    }
  }
  return null;
}

export function approachPath(battle, actor, board, goal) {
  return findPath(battle,actor,null,null,board,false,{goal,budget:Math.max(90,moveLeft(battle,actor)+speedOf(actor))});
}

export function previewMovement(battle, actor, x, y, board) {
  if (!actorIsUp(actor) || !occupies(actor) || battle.movement || x < 0 || y < 0 || x >= board.cols || y >= board.rows) return null;
  try {return findPath(battle, actor, x, y, board, battle.round === 0);} catch {return null;}
}

export function exploreToken(battle, actor, x, y, board, stopAt) {
  if (battle.round || !actorIsUp(actor) || !occupies(actor)) error("Choose a party member who can explore.");
  const result = previewMovement(battle, actor, x, y, board);
  if (!result) error("That square is blocked or occupied.");
  for (const step of result.path) {
    advanceTime(battle,30/Math.max(5,speedOf(actor)));
    actor.x = step.x; actor.y = step.y;
    // A route can cross friendly squares. The token must stop in a free square.
    if (battle.actors.some((other) => other.id !== actor.id && occupies(other) && other.x === step.x && other.y === step.y)) continue;
    if (stopAt(actor)) break;
  }
}

function assertTurn(battle, actor) {
  if (battle.movement) error("Resolve the opportunity attack before continuing.");
  if (!battle.round || currentActor(battle)?.id !== actor.id) error("It is not this token’s turn.");
  if (!actorIsUp(actor)) error("This token cannot take actions at 0 hit points.");
}

function reactionWeapons(actor) {
  return actor.attacks.filter((attack) => !attack.normalRange && Number.isFinite(attack.bonus) && Boolean(diceTerms(attack.damage)));
}

function walkRemaining(battle, actor, board) {
  const walk = battle.movement;
  while (walk.index < walk.path.length && actorIsUp(actor)) {
    const next = walk.path[walk.index];
    const foe = !actor.disengaged && battle.actors.find((other) => actorIsUp(other) && occupies(other) &&
      other.side !== actor.side && other.side !== "neutral" && !other.reactionUsed && !walk.passed.includes(other.id) &&
      reactionWeapons(other).some((weapon) => {
        const reach = weapon.reach || 5;
        return distanceFt(actor,other) <= reach && distanceFt(next,other) > reach && lineClear(battle,other,actor,board,{vision:true});
      }));
    if (foe) {
      walk.foe = foe.id;
      return;
    }
    actor.x = next.x;
    actor.y = next.y;
    walk.index += 1;
    walk.passed = [];
  }
  const distance = walk.path[walk.index-1]?.cost ?? 0;
  battle.spent += distance;
  if (distance) {
    log(battle, actor.name + " moves " + distance + " ft.");
    monsterEvent(battle,actor,{action:"Moved " + distance + " ft"});
  }
  battle.movement = null;
}

export function moveToken(battle, actor, x, y, board) {
  if (!battle.round) return placeToken(battle, actor, x, y, board);
  assertTurn(battle, actor);
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
    return distanceFt(actor,foe) <= reach && distanceFt(next,foe) > reach;
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
    resolveWeaponRoll(battle,foe,actor,attack,{reaction:true},random);
  } else log(battle, foe.name + " passes the opportunity attack.");
  battle.movement.passed.push(foe.id);
  battle.movement.foe = null;
  walkRemaining(battle,actor,board);
}

export function turnAction(battle, actor, action) {
  assertTurn(battle, actor);
  if (action === "stand") {
    if (!actor.prone) error("This token is already standing.");
    const cost = speedOf(actor) / 2;
    if (!cost || moveLeft(battle, actor) < cost) error("Standing requires half the token’s speed.");
    battle.spent += cost;
    actor.prone = false;
    log(battle, actor.name + " stands up.");
    monsterEvent(battle,actor,{action:"Stood up"});
    return;
  }
  if (action === "bonus-disengage") {
    if (battle.bonusUsed || !actor.nimbleEscape) error("This token cannot use bonus-action Disengage.");
    actor.disengaged = true;
    battle.bonusUsed = true;
    log(battle, actor.name + " uses a bonus action to disengage.");
    monsterEvent(battle,actor,{action:"Disengage (bonus action)"});
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
  monsterEvent(battle,actor,{action:label});
}

export function applyDamage(battle, actor, rawDamage, type, critical = false) {
  let damage = Math.max(0, rawDamage);
  if (type && storedDamageTypes(actor.immune).includes(type)) damage = 0;
  else if (type) {
    if (storedDamageTypes(actor.resist).includes(type)) damage = Math.floor(damage / 2);
    if (storedDamageTypes(actor.vulnerable).includes(type)) damage *= 2;
  }
  const absorbed = Math.min(actor.tempHp, damage);
  actor.tempHp -= absorbed;
  if (!actor.tempHp) {actor.agathys = null; actor.tempExpires = null;}
  const remaining = damage - absorbed;
  const before = actor.hp;
  actor.hp = Math.max(0, before - remaining);
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
  return {damage, absorbed, defeated:actor.dead, unconscious:!actor.dead && actor.hp === 0 && before > 0};
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

export function deathSave(battle, actor, random = Math.random) {
  if (!battle.round || currentActor(battle)?.id !== actor.id || !actor.resolveDeath ||
      actor.hp !== 0 || actor.dead || actor.stable || battle.deathRolled) error("This character cannot make a death save right now.");
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
  if (!occupies(attacker) || !target || !occupies(target) || (!allowDown && !actorIsUp(target))) {
    error("Choose a target on the grid.");
  }
}

function recordDamage(battle, target, amount, type, breakdown, critical = false) {
  const outcome = applyDamage(battle,target,amount,type,critical);
  log(battle, target.name + " takes " + outcome.damage + (type ? " " + type : "") + " damage" +
    " (" + breakdown + (outcome.absorbed ? "; " + outcome.absorbed + " absorbed by temp HP" : "") + ")" +
    (outcome.defeated ? " and is defeated." : outcome.unconscious ? " and falls unconscious." : "."));
  return outcome;
}

function damageLog(battle, target, expression, type, critical, random) {
  const roll = rollDice(expression,{doubleDice:critical,random});
  return recordDamage(battle,target,roll.total,type,roll.breakdown,critical);
}

function savingThrow(actor, ability, {extra = 0, advantage = false, random = Math.random} = {}) {
  const result = d20((actor.saves[ability] ?? actor.ability[ability] ?? 0) + extra,{advantage,random});
  if (actor.sliver) {
    actor.sliver = null;
    const penalty = rollDice("1d4",{random});
    result.total -= penalty.total;
    result.breakdown += " − Mind Sliver " + penalty.total;
  }
  return result;
}

function attackMode(battle, attacker, target, options, ranged, distance) {
  const nearby = ranged && battle.actors.some((other) => other.side !== attacker.side && other.side !== "neutral" &&
    actorIsUp(other) && occupies(other) && distanceFt(attacker, other) <= 5);
  return {
    advantage: options.mode === "advantage" || (target.prone && distance <= 5) || target.hp === 0 ||
      (attacker.packTactics && battle.actors.some((other) => other.id !== attacker.id && other.side === attacker.side &&
        actorIsUp(other) && occupies(other) && distanceFt(target, other) <= 5)),
    disadvantage: options.mode === "disadvantage" || nearby || attacker.mocked ||
      (target.dodging && actorIsUp(target) && speedOf(target) > 0) ||
      (target.prone && distance > 5) || attacker.prone,
  };
}

export function lineClear(battle, from, to, board, {vision = false} = {}) {
  if (vision || mapWalls(board)) return mapLineClear(board,from,to,(x,y) => battle.terrain[keyAt(x,y)] === "wall",vision);
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

export function rollStrike(battle, attacker, target, weapon, options = {}, random = Math.random) {
  assertTurn(battle, attacker);
  validTarget(attacker, target);
  if (attacker.id === target.id) error("Choose a different target.");
  if (!Number.isFinite(weapon.bonus) || !diceTerms(weapon.damage)) error("This action needs a numeric attack bonus and a damage formula.");
  if (battle.action && battle.action !== "attack") error("This token has used its action.");
  if (battle.attacksMade >= attacker.swings) error("This token has used its attacks.");
  const distance = distanceFt(attacker, target);
  const ranged = !!weapon.normalRange;
  if (distance > (ranged ? weapon.longRange || weapon.normalRange : weapon.reach || 5)) error("The target is out of range.");
  if (options.cover === "full" || !lineClear(battle,attacker,target,options.map)) error("Full cover blocks the attack.");
  battle.action = "attack";
  battle.attacksMade += 1;
  return resolveWeaponRoll(battle,attacker,target,weapon,options,random);
}

function resolveWeaponRoll(battle, attacker, target, weapon, options, random) {
  const distance = distanceFt(attacker,target);
  const ranged = Boolean(weapon.normalRange);

  const mode = attackMode(battle, attacker, target, options, ranged, distance);
  mode.disadvantage ||= ranged && distance > weapon.normalRange;
  const roll = d20(weapon.bonus, {...mode, random});
  attacker.mocked = false;
  const hit = roll.kept === 20 || (roll.kept !== 1 && roll.total >= target.ac + (Number(options.cover) || 0));
  const critical = hit && (roll.kept === 20 || (target.hp === 0 && distance <= 5));
  let damage;
  let prone;
  log(battle, attacker.name + " · " + weapon.name + " vs " + target.name + " — " + roll.breakdown + " = " + roll.total +
    (critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  if (hit) {
    const retaliation = !ranged && target.tempHp > 0 ? target.agathys : null;
    damage = damageLog(battle, target, weapon.damage, weapon.type, critical, random);
    if (retaliation) recordDamage(battle,attacker,retaliation,"cold","Armor of Agathys");
    if (weapon.proneDC && actorIsUp(target)) {
      const save = savingThrow(target,"str",{random});
      if (save.total < weapon.proneDC) {
        prone = true;
        target.prone = true;
      }
      log(battle, target.name + " Strength save " + save.total + " vs DC " + weapon.proneDC + (target.prone ? " · prone." : "."));
    }
  }
  monsterEvent(battle,attacker,{
    action:weapon.name, target:target.name, roll:roll.breakdown, total:roll.total,
    outcome:critical ? "Critical hit" : hit ? "Hit" : "Miss", damage, type:weapon.type, prone, reaction:options.reaction,
  });
  return {roll, hit, critical};
}

const spellEffects = {
  "vicious mockery": {range:60, save:"wis", type:"psychic", faces:4, mock:true},
  "sacred flame": {range:60, save:"dex", type:"radiant", faces:8, ignoresCover:true},
  "poison spray": {range:10, save:"con", type:"poison", faces:12},
  "fire bolt": {range:120, attack:true, type:"fire", faces:10},
  "ray of frost": {range:60, attack:true, type:"cold", faces:8, slow:true},
  "eldritch blast": {range:120, attack:true, type:"force", faces:10, beams:true},
  "mind sliver": {range:60, save:"int", type:"psychic", faces:6, sliver:true},
  "healing word": {range:60, heal:true, level:1, faces:4, bonus:true, exploration:true},
  "cure wounds": {range:5, heal:true, level:1, faces:8, exploration:true},
  "false life": {level:1, self:true, temporary:true, exploration:true},
  "armor of agathys": {level:1, self:true, temporary:true, retaliation:true, exploration:true},
  "misty step": {level:2, range:30, bonus:true, teleport:true, exploration:true},
  "aid": {level:2, range:30, aid:true, exploration:true},
  "fireball": {level:3, range:150, area:20, save:"dex", type:"fire", faces:6},
};

export const supportedSpell = (key) => spellEffects[key];

function checkCast(battle,caster,level,slotLevel,timing) {
  if (!actorIsUp(caster)) error("This token cannot cast at 0 hit points.");
  if (!occupies(caster)) error("Place the caster on the grid first.");
  if (battle.round) {
    if (timing === "reaction") {
      if (battle.movement || caster.reactionUsed) error("This token’s reaction is unavailable.");
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
  if (level && (!Number.isInteger(slotLevel) || slotLevel < level || !(caster.slots[slotLevel]?.current > 0))) {
    error("Choose a slot of the spell’s level or higher with a use remaining.");
  }
}

function spendCast(battle,caster,level,slotLevel,timing) {
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
  if (level) caster.slots[slotLevel].current -= 1;
}

export function recordSpell(battle,caster,spell,slotLevel) {
  if (!spell.reference || spell.edition !== "2014" || spell.customUse) error("Use the table ruling for this custom or revised spell.");
  if (!["action","bonus","reaction"].includes(spell.timing)) error("Resolve the longer casting time at the table.");
  checkCast(battle,caster,spell.level,slotLevel,spell.timing);
  spendCast(battle,caster,spell.level,slotLevel,spell.timing);
  log(battle,caster.name+" casts "+spell.name+(spell.level ? " with a level "+slotLevel+" slot" : "")+" · manual effect.");
}

function spellSave(battle, caster, target, effect, options, random) {
  const dex = effect.save === "dex";
  const cover = dex && !effect.ignoresCover ? Number(options.cover) || 0 : 0;
  const result = target.hp === 0 && ["str","dex"].includes(effect.save) ? null : savingThrow(target,effect.save,{
    extra:cover, advantage:dex && target.dodging && actorIsUp(target) && speedOf(target)>0, random,
  });
  const passed = Boolean(result && result.total >= caster.spellDC);
  log(battle,target.name+" save — "+(result ? result.breakdown+" = "+result.total : "automatic failure")+
    " vs DC "+caster.spellDC+(passed ? ", succeeds." : ", fails."));
  return passed;
}

function rangedSpellAttack(battle,caster,target,effect,expression,options,random) {
  const distance = distanceFt(caster,target);
  const result = d20(caster.spellAttack,{...attackMode(battle,caster,target,options,true,distance),random});
  caster.mocked = false;
  const hit = result.kept === 20 || (result.kept !== 1 && result.total >= target.ac + (Number(options.cover) || 0));
  const critical = hit && (result.kept === 20 || (target.hp === 0 && distance <= 5));
  log(battle,"Spell attack on "+target.name+" — "+result.breakdown+" = "+result.total+(critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  if (hit) {
    damageLog(battle,target,expression,effect.type,critical,random);
    if (effect.slow && actorIsUp(target)) target.slowedBy = caster.id;
  }
}

export function areaCells(battle, origin, radius, board) {
  const queue = [{...origin,cost:0}];
  const visited = new Set([keyAt(origin.x,origin.y)]);
  const wall = (x,y) => !mapFloor(board,x,y) || battle.terrain[keyAt(x,y)] === "wall";
  for (let i=0;i<queue.length;i++) {
    const {x,y,cost} = queue[i];
    if (cost >= radius) continue;
    for (let dx=-1;dx<=1;dx++) {
      for (let dy=-1;dy<=1;dy++) {
        const col=x+dx, row=y+dy, key=keyAt(col,row);
        if (visited.has(key) || col<0 || row<0 || col>=board.cols || row>=board.rows || wall(col,row)) continue;
        if (crossesMapWall(board,{x,y},{x:col,y:row})) continue;
        if (dx && dy && wall(col,y) && wall(x,row)) continue;
        visited.add(key);
        queue.push({x:col,y:row,cost:cost+5});
      }
    }
  }
  return visited;
}

export function castSpell(battle,caster,target,spell,slotLevel,options = {},random = Math.random) {
  const effect = supportedSpell(spell.key);
  if (!effect || spell.edition !== "2014" || spell.customUse) error("This spell needs manual adjudication.");
  const {level = 0, heal:healing} = effect;
  const timing = effect.bonus ? "bonus" : "action";
  if (!battle.round && !effect.exploration) error("Enter combat to cast this spell.");
  checkCast(battle,caster,level,slotLevel,timing);
  const tier = 1 + [5,11,17].filter((threshold) => caster.level >= threshold).length;
  const square = options.square;
  const targets = effect.self ? [caster] : effect.aid ? [...new Set([target,...(options.targets ?? [])].filter(Boolean))].slice(0,3) :
    effect.beams ? Array.from({length:tier},(_,index) => index ? (options.targets?.[index-1] ?? target) : target) : [target];
  if (effect.area || effect.teleport) {
    if (!square || !options.map || square.x < 0 || square.y < 0 || square.x >= options.map.cols || square.y >= options.map.rows) {
      error("Choose a square on the map.");
    }
    if (effect.teleport && battle.actors.some((actor) => occupies(actor) && actor.x===square.x && actor.y===square.y)) error("Choose an unoccupied destination.");
    if (distanceFt(caster,square) > effect.range) error("The selected square is out of range.");
    if (!lineClear(battle,caster,square,options.map,{vision:Boolean(effect.teleport)})) error("The spell cannot reach that square.");
  } else {
    if (!targets.length) error("Choose at least one target.");
    for (const creature of targets) {
      validTarget(caster,creature);
      if (!effect.self && distanceFt(caster,creature) > effect.range) error(creature.name+" is out of range.");
      if (!effect.self && (options.cover === "full" || !lineClear(battle,caster,creature,options.map))) error("Full cover blocks the spell.");
      if (healing && ["undead","construct"].includes(creature.creatureType)) error("This spell cannot heal that target.");
    }
  }
  if (healing && !Number.isFinite(caster.spellAbility)) error("Set the spellcasting ability modifier.");
  if (effect.attack && !Number.isFinite(caster.spellAttack)) error("Set the spell attack bonus.");
  if (effect.save && !Number.isFinite(caster.spellDC)) error("Set the spell save DC.");
  spendCast(battle,caster,level,slotLevel,timing);
  const destination = effect.area || effect.teleport ? " at square "+(square.x+1)+", "+(square.y+1) :
    effect.self ? "" : " on "+[...new Set(targets)].map(({name})=>name).join(", ");
  log(battle,caster.name+" casts "+spell.name+destination+(level ? " · level "+slotLevel+" slot." : "."));
  if (effect.teleport) {
    caster.x=square.x; caster.y=square.y;
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
  } else if (effect.area) {
    const area = areaCells(battle,square,effect.area,options.map);
    const roll = rollDice((8+slotLevel-level)+"d6",{random});
    log(battle,spell.name+" damage roll — "+roll.breakdown+" = "+roll.total+".");
    for (const creature of battle.actors.filter((actor) => occupies(actor) && area.has(keyAt(actor.x,actor.y)))) {
      const passed = spellSave(battle,caster,creature,effect,{cover:0},random);
      recordDamage(battle,creature,passed ? Math.floor(roll.total/2) : roll.total,effect.type,passed ? "half on save" : "failed save");
      if (creature.side === "hostile" && creature.side !== caster.side) joinInitiative(battle,creature,random);
    }
  } else if (healing) {
    const amount = rollDice(slotLevel+"d"+effect.faces,{random});
    const restored = heal(target,amount.total+caster.spellAbility);
    log(battle,target.name+" regains "+restored+" HP ("+amount.breakdown+", modifier "+caster.spellAbility+").");
  } else if (effect.save) {
    if (!spellSave(battle,caster,target,effect,options,random)) {
      damageLog(battle,target,tier+"d"+effect.faces,effect.type,false,random);
      if (effect.mock && actorIsUp(target)) target.mocked = true;
      if (effect.sliver && actorIsUp(target)) target.sliver = {caster:caster.id,round:battle.round+1};
    }
  } else {
    if (effect.attack) {
      for (const creature of targets) {
        if (!creature.dead) rangedSpellAttack(battle,caster,creature,effect,(effect.beams ? 1 : tier)+"d"+effect.faces,options,random);
      }
    }
  }
}

export function drinkPotion(battle, actor, item, random = Math.random) {
  if (battle.round) {
    assertTurn(battle, actor);
    if (battle.action) error("This token has used its action.");
  } else if (!actorIsUp(actor)) error("This token cannot use items at 0 hit points.");
  if (!item || item.quantity <= 0 || !item.formula) error("Choose an available healing potion.");
  const amount = rollDice(item.formula, {random});
  if (battle.round) battle.action = "potion";
  item.quantity -= 1;
  const restored = heal(actor, amount.total);
  log(battle, actor.name + " uses " + item.name + " and regains " + restored + " HP (" + amount.breakdown + ").");
}
