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
export const hasFeature = (actor,name) => actor.classRules?.edition === "2014" && actor.classRules.traits.includes(name);
export const condition = (actor,name) => actor?.conditions?.find((effect) => effect.name === name);
export const incapacitated = (actor) => Boolean(condition(actor,"Paralyzed") || condition(actor,"Asleep") || condition(actor,"Stunned"));

export function movementGroup(battle) {
  const first = currentActor(battle);
  if (!battle.round || !first) return [];
  const group = [first];
  if (first.side === "party" && Number.isFinite(first.initiativeRoll)) {
    for (const id of battle.order.slice(battle.turn+1)) {
      const actor = battle.actors.find((entry) => entry.id === id);
      if (actor?.side !== "party" || actor.initiativeRoll !== first.initiativeRoll) break;
      if (actorIsUp(actor) && occupies(actor) && !incapacitated(actor)) group.push(actor);
    }
  }
  return group;
}

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

function removeCondition(actor,effect) {
  if (actor.conditions) actor.conditions = actor.conditions.filter((entry) => entry !== effect);
}

function endConcentration(battle,caster) {
  if (!caster.concentration) return;
  log(battle,caster.name + " loses concentration on " + caster.concentration.name + ".");
  for (const actor of battle.actors) {
    if (actor.conditions) actor.conditions = actor.conditions.filter((effect) => effect.concentration !== caster.id);
  }
  if (battle.spellZones) battle.spellZones = battle.spellZones.filter((zone) => zone.caster !== caster.id);
  delete caster.concentration;
}

function startConcentration(battle,caster,name,duration) {
  endConcentration(battle,caster);
  caster.concentration = {name,expires:(battle.elapsed ?? 0)+duration};
}

export function addCondition(battle,actor,name,duration,properties = {}) {
  if (storedDamageTypes(actor.conditionImmune).includes(name.toLowerCase())) {
    log(battle,actor.name + " is immune to " + name.toLowerCase() + ".");
    return;
  }
  const effects = actor.conditions ??= [];
  effects.push({name,expires:(battle.elapsed ?? 0)+duration,...properties});
  log(battle,actor.name + (name === "Dragon’s Breath" ? " gains Dragon’s Breath." : " is " + name.toLowerCase() + "."));
  if (incapacitated(actor)) endConcentration(battle,actor);
}

export function advanceTime(battle, seconds) {
  battle.elapsed = (battle.elapsed ?? 0) + seconds;
  for (const creature of battle.actors) {
    if (creature.astralArms?.expires <= battle.elapsed || incapacitated(creature) || !actorIsUp(creature)) delete creature.astralArms;
    if (creature.astralVisage?.expires <= battle.elapsed || incapacitated(creature) || !actorIsUp(creature)) delete creature.astralVisage;
    if (creature.inspiration?.expires <= battle.elapsed) delete creature.inspiration;
    if (creature.bladesong?.expires <= battle.elapsed || incapacitated(creature)) delete creature.bladesong;
    if (creature.concentration?.expires <= battle.elapsed) endConcentration(battle,creature);
    if (creature.conditions) creature.conditions = creature.conditions.filter((effect) => effect.expires > battle.elapsed);
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
}

function resetTurn(battle) {
  const actor = currentActor(battle);
  if (!actor) return;
  actor.dodging = false;
  actor.disengaged = false;
  actor.reactionUsed = false;
  for (const creature of battle.actors) {
    if (creature.slowedBy === actor.id) creature.slowedBy = null;
    if (creature.helped?.helper === actor.id) delete creature.helped;
  }
  battle.spent = battle.earlyMovement?.[actor.id] ?? 0;
  if (battle.earlyMovement) delete battle.earlyMovement[actor.id];
  battle.dash = 0;
  battle.action = null;
  battle.attacksMade = 0;
  battle.bonusUsed = false;
  battle.cast = null;
  battle.martialAttack = false;
  battle.flurry = 0;
  battle.actionSurged = false;
  actor.steadyAim = false;
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
  delete battle.earlyMovement;
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

export function endTurn(battle, random = Math.random) {
  if (!battle.round) error("Start initiative first.");
  if (battle.movement) error("Resolve the opportunity attack before ending the turn.");
  const actor = currentActor(battle);
  if (actor?.hp === 0 && actor.resolveDeath && !actor.dead && !actor.stable && !battle.deathRolled) {
    error("Roll this character's death save before ending the turn.");
  }
  if (actor) {
    for (const creature of battle.actors) {
      if (creature.conditions) creature.conditions = creature.conditions.filter((effect) =>
        effect.untilTurn !== actor.id || effect.untilRound > battle.round);
    }
    for (const effect of actor.conditions ?? []) {
      if (!effect.repeatSave || !actorIsUp(actor)) continue;
      const save = savingThrow(actor,effect.repeatSave,{random});
      const passed = save.total >= effect.dc;
      log(battle,actor.name + " repeats the save against " + effect.name + " — " + save.total + " vs DC " +
        effect.dc + (passed ? ", succeeds." : ", fails."));
      if (passed) removeCondition(actor,effect);
    }
    if (actor.concentration?.bolt && battle.action && battle.action !== "witch-bolt") endConcentration(battle,actor);
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
      delete battle.earlyMovement;
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
  delete battle.earlyMovement;
  log(battle, "Initiative ended.");
}

export const speedOf = (actor) => incapacitated(actor) || actor.steadyAim ? 0 :
  Math.max(0, actor.speed+(actor.bladesong ? 10 : 0)-(actor.slowedBy ? 10 : 0));
export const armorClass = (actor) => actor.ac+(actor.bladesong ? Math.max(1,actor.ability.int ?? 0) : 0);
export const movementBudget = (battle,actor) => speedOf(actor) + (currentActor(battle)?.id === actor.id ? battle.dash : 0);
export const moveLeft = (battle, actor) => Math.max(0, movementBudget(battle,actor) -
  (currentActor(battle)?.id === actor.id ? battle.spent : (battle.earlyMovement?.[actor.id] ?? 0)));

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

function findPath(battle, actor, x, y, board, exploration = false, {goal, score, budget = exploration ? Infinity : moveLeft(battle,actor)} = {}) {
  const origin = keyAt(actor.x, actor.y);
  const destination = keyAt(x, y);
  const blockers = new Map(battle.actors.filter((entry) => entry.id !== actor.id && occupies(entry)).map((entry) =>
    [keyAt(entry.x, entry.y), entry]));
  if (blockers.has(destination)) error("Another token occupies that square.");
  const known = new Map([[origin, 0]]);
  const pending = [{x:actor.x, y:actor.y, cost:0, previous:null}];
  let best = pending[0];
  const trace = (cell) => {
    const path = [];
    for (let step = cell; step.previous; step = step.previous) path.push({x:step.x,y:step.y,cost:step.cost});
    return {cost:cell.cost,path:path.reverse()};
  };
  let nextUnvisited = 0;
  const blocked = (col,row) => !mapFloor(board,col,row) || battle.terrain[keyAt(col,row)] === "wall";
  while (exploration ? nextUnvisited < pending.length : pending.length) {
    if (!exploration) pending.sort((a,b) => b.cost - a.cost);
    const cell = exploration ? pending[nextUnvisited++] : pending.pop();
    const here = keyAt(cell.x, cell.y);
    if (cell.cost !== known.get(here)) continue;
    if (here === destination || (goal && !blockers.has(here) && goal(cell))) return trace(cell);
    if (score && !blockers.has(here) && score(cell) > score(best)) best = cell;
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
  return score ? trace(best) : null;
}

export function approachPath(battle, actor, board, goal) {
  return findPath(battle,actor,null,null,board,false,{goal,budget:Math.max(90,moveLeft(battle,actor)+speedOf(actor))});
}

export function previewMovement(battle, actor, x, y, board) {
  if (!actorIsUp(actor) || !occupies(actor) || incapacitated(actor) || battle.movement || x < 0 || y < 0 || x >= board.cols || y >= board.rows) return null;
  if (battle.round && !movementGroup(battle).includes(actor)) return null;
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
  if (incapacitated(actor)) error("This character is incapacitated.");
}

export const charmedBy = (actor,target) => Boolean(target && actor.conditions?.some((effect) =>
  effect.name === "Charmed" && effect.source === target.id));

function reactionWeapons(actor) {
  return actor.attacks.filter((attack) => !attack.normalRange && Number.isFinite(attack.bonus) && Boolean(diceTerms(attack.damage)));
}

function walkRemaining(battle, actor, board) {
  const walk = battle.movement;
  while (walk.index < walk.path.length && actorIsUp(actor)) {
    const next = walk.path[walk.index];
    const disengaged = currentActor(battle)?.id === actor.id && actor.disengaged;
    const foe = !disengaged && !walk.noOpportunity && battle.actors.find((other) => actorIsUp(other) && occupies(other) &&
      !incapacitated(other) && !charmedBy(other,actor) && !condition(actor,"Invisible") &&
      other.side !== actor.side && other.side !== "neutral" && !other.reactionUsed && !walk.passed.includes(other.id) &&
      reactionWeapons(other).some((weapon) => {
        const reach = weapon.reach || 5;
        return distanceFt(actor,other) <= reach && distanceFt(next,other) > reach && canSee(battle,other,actor,board);
      }));
    if (foe) {
      walk.foe = foe.id;
      return;
    }
    actor.x = next.x;
    actor.y = next.y;
    walk.index += 1;
    walk.passed = [];
    checkSpellTethers(battle,board);
  }
  const distance = walk.path[walk.index-1]?.cost ?? 0;
  if (distance) {
    if (!walk.forced && currentActor(battle)?.id === actor.id) battle.spent += distance;
    else if (!walk.forced) {
      const movement = battle.earlyMovement ??= {};
      movement[actor.id] = (movement[actor.id] ?? 0)+distance;
    }
    log(battle, actor.name + " moves " + distance + " ft.");
    monsterEvent(battle,actor,{action:"Moved " + distance + " ft"});
  }
  battle.movement = null;
}

export function moveToken(battle, actor, x, y, board) {
  if (!battle.round) return placeToken(battle, actor, x, y, board);
  if (battle.movement) error("Resolve the opportunity attack before continuing.");
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
    resolveWeaponRoll(battle,foe,actor,attack,{reaction:true,map:board},random);
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
    if (battle.bonusUsed || !(actor.nimbleEscape || hasFeature(actor,"Cunning Action"))) error("This token cannot use bonus-action Disengage.");
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

export function applyDamage(battle, actor, rawDamage, type, critical = false, random = Math.random, source) {
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
    if (source) {
      for (const effect of actor.conditions ?? []) {
        if (effect.name === "Charmed" && battle.actors.find(({id}) => id === effect.source)?.side === source.side) {
          removeCondition(actor,effect);
        }
      }
    }
    if (actor.concentration) {
      if (!actorIsUp(actor) || incapacitated(actor)) endConcentration(battle,actor);
      else {
        const dc = Math.max(10,Math.floor(damage/2));
        const save = savingThrow(actor,"con",{random,extra:actor.bladesong ? actor.ability.int ?? 0 : 0});
        log(battle,actor.name + " concentration save — " + save.total + " vs DC " + dc + ".");
        if (save.total < dc) endConcentration(battle,actor);
      }
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

function recordDamage(battle, target, amount, type, breakdown, critical = false, random = Math.random, source) {
  const outcome = applyDamage(battle,target,amount,type,critical,random,source);
  log(battle, target.name + " takes " + outcome.damage + (type ? " " + type : "") + " damage" +
    " (" + breakdown + (outcome.absorbed ? "; " + outcome.absorbed + " absorbed by temp HP" : "") + ")" +
    (outcome.defeated ? " and is defeated." : outcome.unconscious ? " and falls unconscious." : "."));
  return outcome;
}

function damageLog(battle, target, expression, type, critical, random, source) {
  const roll = rollDice(expression,{doubleDice:critical,random});
  return recordDamage(battle,target,roll.total,type,roll.breakdown,critical,random,source);
}

export function savingThrow(actor, ability, {extra = 0, advantage = false, random = Math.random} = {}) {
  let bonus = actor.saves[ability] ?? actor.ability[ability] ?? 0;
  if (ability === "str" && actor.astralArms) bonus = Math.max(bonus,actor.ability.wis ?? 0);
  const result = d20(bonus + extra,{advantage,random});
  addInspiration(actor,result,random);
  if (actor.sliver) {
    actor.sliver = null;
    const penalty = rollDice("1d4",{random});
    result.total -= penalty.total;
    result.breakdown += " − Mind Sliver " + penalty.total;
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

function attackMode(battle, attacker, target, options, ranged, distance) {
  const obscured = battle.spellZones?.length > 0 && options.map;
  const nearby = ranged && battle.actors.some((other) => other.side !== attacker.side && other.side !== "neutral" &&
    actorIsUp(other) && !incapacitated(other) && !condition(attacker,"Invisible") && occupies(other) && distanceFt(attacker, other) <= 5 &&
    (!obscured || canSee(battle,other,attacker,options.map)));
  return {
    advantage: Boolean(options.mode === "advantage" || attacker.steadyAim || target.helped?.side === attacker.side ||
      condition(attacker,"Invisible") || incapacitated(target) || condition(target,"Stunned") || target.hp === 0 ||
      (obscured && !canSee(battle,target,attacker,options.map)) ||
      ((target.prone || target.hp === 0) && distance <= 5) ||
      (attacker.packTactics && battle.actors.some((other) => other.id !== attacker.id && other.side === attacker.side &&
        actorIsUp(other) && !incapacitated(other) && occupies(other) && distanceFt(target, other) <= 5))),
    disadvantage: Boolean(options.mode === "disadvantage" || nearby || attacker.mocked || condition(target,"Invisible") ||
      (obscured && !canSee(battle,attacker,target,options.map)) ||
      (target.dodging && actorIsUp(target) && speedOf(target) > 0) ||
      ((target.prone || target.hp === 0 || condition(target,"Asleep")) && distance > 5) || attacker.prone),
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

const obscuredSets = new WeakMap();

function obscuredCells(zones) {
  if (!obscuredSets.has(zones)) obscuredSets.set(zones,new Set(zones.flatMap((zone) => zone.cells)));
  return obscuredSets.get(zones);
}

export function canSee(battle,from,to,map) {
  if (from.id !== to.id && (condition(to,"Invisible") || condition(to,"Hidden") && from.side !== to.side)) return false;
  if (!lineClear(battle,from,to,map,{vision:true})) return false;
  if (!battle.spellZones?.length || from.x === to.x && from.y === to.y) return true;
  const zones = from.astralVisage && distanceFt(from,to) <= 120 ? battle.spellZones.filter((zone) => zone.name !== "Darkness") : battle.spellZones;
  const obscured = obscuredCells(zones);
  let {x,y} = from;
  const dx = Math.abs(to.x-x), dy = -Math.abs(to.y-y);
  const sx = Math.sign(to.x-x), sy = Math.sign(to.y-y);
  let error = dx+dy;
  while (!obscured.has(keyAt(x,y))) {
    if (x === to.x && y === to.y) return true;
    const next = 2*error;
    if (next >= dy) {error += dy; x += sx;}
    if (next <= dx) {error += dx; y += sy;}
  }
  return false;
}

export function rollStrike(battle, attacker, target, weapon, options = {}, random = Math.random) {
  assertTurn(battle, attacker);
  validTarget(attacker, target);
  if (attacker.id === target.id) error("Choose a different target.");
  if (charmedBy(attacker,target)) error("This character is charmed by the target.");
  if (!Number.isFinite(weapon.bonus) || !diceTerms(weapon.damage)) error("This action needs a numeric attack bonus and a damage formula.");
  const bonusStrike = options.bonusStrike;
  if (bonusStrike) {
    if (!weapon.unarmed) error("Choose an unarmed strike.");
    if (!battle.flurry && (!attacker.classRules?.unarmoredMonk || !battle.martialAttack)) error("Use the Attack action with a monk weapon first.");
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
  if (options.cover === "full" || !lineClear(battle,attacker,target,options.map)) error("Full cover blocks the attack.");
  if (bonusStrike) {
    if (battle.flurry) battle.flurry -= 1;
    else battle.bonusUsed = true;
  } else {
    battle.action = "attack";
    battle.attacksMade += 1;
    if (weapon.monkWeapon || weapon.unarmed) battle.martialAttack = true;
  }
  return resolveWeaponRoll(battle,attacker,target,weapon,options,random);
}

function resolveWeaponRoll(battle, attacker, target, weapon, options, random) {
  const distance = distanceFt(attacker,target);
  const ranged = Boolean(weapon.normalRange);

  const mode = attackMode(battle, attacker, target, options, ranged, distance);
  mode.disadvantage ||= ranged && distance > weapon.normalRange;
  const roll = d20(weapon.bonus, {...mode, random});
  addInspiration(attacker,roll,random);
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
  const hit = roll.kept === 20 || (roll.kept !== 1 && roll.total >= armorClass(target) + (Number(options.cover) || 0));
  const critical = hit && (roll.kept === 20 || ((target.hp === 0 || incapacitated(target)) && distance <= 5));
  let damage;
  let prone;
  log(battle, attacker.name + " · " + weapon.name + " vs " + target.name + " — " + roll.breakdown + " = " + roll.total +
    (critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  if (hit) {
    const retaliation = !ranged && target.tempHp > 0 ? target.agathys : null;
    const raw = rollDice(weapon.damage,{doubleDice:critical,random});
    let totalDamage = raw.total;
    let breakdown = raw.breakdown;
    const turnKey = battle.round+"|"+currentActor(battle)?.id;
    const allyNearby = battle.actors.some((ally) => ally.id !== attacker.id && ally.side !== target.side && ally.side !== "neutral" &&
      actorIsUp(ally) && !incapacitated(ally) && occupies(ally) && distanceFt(ally,target) <= 5);
    const disadvantaged = mode.disadvantage && !mode.advantage;
    const sneakEligible = attacker.classRules?.sneakDice && (weapon.finesse || ranged) && attacker.sneakTurn !== turnKey &&
      !disadvantaged && (mode.advantage && !mode.disadvantage || allyNearby);
    if (sneakEligible) {
      const sneak = rollDice(attacker.classRules.sneakDice+"d6",{doubleDice:critical,random});
      totalDamage += sneak.total;
      breakdown += " + Sneak Attack "+sneak.breakdown;
      attacker.sneakTurn = turnKey;
    }
    if (ranged && hasFeature(target,"Deflect Missiles") && !target.reactionUsed && !incapacitated(target)) {
      const reduction = rollDice("1d10",{random}).total+(target.ability.dex ?? 0)+(target.classRules.levels.Monk ?? 0);
      totalDamage = Math.max(0,totalDamage-reduction);
      target.reactionUsed = true;
      log(battle,target.name+" uses Deflect Missiles, reducing damage by "+reduction+".");
    } else if (hasFeature(target,"Uncanny Dodge") && !target.reactionUsed && !incapacitated(target) && canSee(battle,target,attacker,options.map)) {
      totalDamage = Math.floor(totalDamage/2);
      target.reactionUsed = true;
      log(battle,target.name+" uses Uncanny Dodge to halve the attack’s damage.");
    }
    damage = recordDamage(battle,target,totalDamage,weapon.type,breakdown,critical,random,attacker);
    if (options.stun && actorIsUp(target)) {
      attacker.resources.ki.current -= 1;
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
  monsterEvent(battle,attacker,{
    action:weapon.name, target:target.name, roll:roll.breakdown, total:roll.total,
    outcome:critical ? "Critical hit" : hit ? "Hit" : "Miss", damage, type:weapon.type, prone, reaction:options.reaction,
  });
  return {roll, hit, critical};
}

const spellEffects = {
  "vicious mockery": {range:60, save:"wis", type:"psychic", faces:4, mock:true, sight:true},
  "sacred flame": {range:60, save:"dex", type:"radiant", faces:8, ignoresCover:true, sight:true},
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
  "burning hands": {level:1, cone:15, save:"dex", type:"fire", faces:6, dice:3},
  "dissonant whispers": {level:1, range:60, save:"wis", type:"psychic", faces:6, dice:3, half:true, flee:true},
  "sleep": {level:1, range:90, area:20, sleep:true, exploration:true},
  "hold person": {level:2, range:60, save:"wis", humanoid:true, condition:"Paralyzed", concentration:60, repeat:true, moreTargets:true, sight:true, cluster:30},
  "charm person": {level:1, range:30, save:"wis", humanoid:true, condition:"Charmed", duration:3600, moreTargets:true, exploration:true, sight:true, cluster:30},
  "invisibility": {level:2, range:5, condition:"Invisible", concentration:3600, moreTargets:true, exploration:true},
  "witch bolt": {level:1, range:30, attack:true, type:"lightning", faces:12, concentration:60, bolt:true},
  "magic missile": {level:1, range:120, missiles:true, type:"force", sight:true},
  "fog cloud": {level:1, range:120, area:20, areaPerSlot:20, zone:"Fog", concentration:3600, exploration:true},
  "darkness": {level:2, range:60, area:15, zone:"Darkness", concentration:600, exploration:true},
  "dragons breath": {level:2, range:5, breath:true, bonus:true, concentration:60, exploration:true},
  "exhale dragons breath": {cone:15, exhale:true},
};

export const breathTypes = ["acid","cold","fire","lightning","poison"];
export const supportedSpell = (key) => Object.hasOwn(spellEffects,key) ? spellEffects[key] : undefined;
export const spellTargetCount = (effect,casterLevel,rank) => effect.moreTargets ? 1+Math.max(0,rank-effect.level) :
  effect.missiles ? 2+rank : effect.beams ? 1+[5,11,17].filter((limit) => casterLevel >= limit).length : effect.aid ? 3 : 1;

function breakInvisibility(battle,actor) {
  removeCondition(actor,condition(actor,"Hidden"));
  const effect = condition(actor,"Invisible");
  if (!effect) return;
  removeCondition(actor,effect);
  const caster = battle.actors.find(({id}) => id === effect.concentration);
  if (caster && !battle.actors.some((entry) => entry.conditions?.some((other) =>
      other.name === "Invisible" && other.concentration === caster.id))) endConcentration(battle,caster);
}

function checkCast(battle,caster,level,slotLevel,timing,usage) {
  if (!actorIsUp(caster)) error("This token cannot cast at 0 hit points.");
  if (incapacitated(caster)) error("This character is incapacitated.");
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
  if (usage?.resource && !(caster.resources?.[usage.resource]?.current > 0)) error("This feature’s spell use is expended.");
  if (level && !usage && (!Number.isInteger(slotLevel) || slotLevel < level || !(caster.slots[slotLevel]?.current > 0))) {
    error("Choose a slot of the spell’s level or higher with a use remaining.");
  }
}

function spendCast(battle,caster,level,slotLevel,timing,usage) {
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
  if (usage?.resource) caster.resources[usage.resource].current -= 1;
  else if (level && !usage) caster.slots[slotLevel].current -= 1;
}

export function recordSpell(battle,caster,spell,slotLevel) {
  if (!spell.reference || spell.edition !== "2014" || spell.customUse) error("Use the table ruling for this custom or revised spell.");
  if (!["action","bonus","reaction"].includes(spell.timing)) error("Resolve the longer casting time at the table.");
  const usage = spell.castUsage && slotLevel === 0 ? spell.castUsage : undefined;
  checkCast(battle,caster,spell.level,slotLevel,spell.timing,usage);
  spendCast(battle,caster,spell.level,slotLevel,spell.timing,usage);
  breakInvisibility(battle,caster);
  log(battle,caster.name+" casts "+spell.name+(usage ? " using "+(spell.grantedBy ?? "a class feature") :
    spell.level ? " with a level "+slotLevel+" slot" : "")+" · manual effect.");
}

function spellSave(battle, caster, target, effect, options, random) {
  const dex = effect.save === "dex";
  const cover = dex && !effect.ignoresCover ? Number(options.cover) || 0 : 0;
  const result = (target.hp === 0 || incapacitated(target)) && ["str","dex"].includes(effect.save) ? null : savingThrow(target,effect.save,{
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
  const result = d20(caster.spellAttack,{...attackMode(battle,caster,target,options,true,distance),random});
  addInspiration(caster,result,random);
  if (target.helped?.side === caster.side) delete target.helped;
  breakInvisibility(battle,caster);
  caster.mocked = false;
  const hit = result.kept === 20 || (result.kept !== 1 && result.total >= armorClass(target) + (Number(options.cover) || 0));
  const critical = hit && (result.kept === 20 || ((target.hp === 0 || incapacitated(target)) && distance <= 5));
  log(battle,"Spell attack on "+target.name+" — "+result.breakdown+" = "+result.total+(critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  if (hit) {
    damageLog(battle,target,expression,effect.type,critical,random,caster);
    if (effect.slow && actorIsUp(target)) target.slowedBy = caster.id;
  }
  return hit;
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
          mapFloor(board,x,y) && lineClear(battle,caster,{x,y},board)) cells.add(keyAt(x,y));
    }
  }
  return cells;
}

function fleeFrom(battle,caster,target,board) {
  if (!board || !actorIsUp(target) || incapacitated(target) || target.reactionUsed) return;
  target.reactionUsed = true;
  const path = findPath(battle,target,null,null,board,false,{budget:speedOf(target),score:(cell) => distanceFt(cell,caster)});
  if (!path.cost) return;
  battle.movement = {actor:target.id,path:path.path,index:0,passed:[],forced:true};
  log(battle,target.name+" uses its reaction to flee.");
  walkRemaining(battle,target,board);
}

function boltTarget(battle,caster,map) {
  const target = battle.actors.find(({id}) => id === caster.concentration?.bolt);
  return target && occupies(target) && distanceFt(caster,target) <= 30 && lineClear(battle,caster,target,map) ? target : null;
}

export function checkSpellTethers(battle,map) {
  for (const caster of battle.actors) {
    if (caster.concentration?.bolt &&
        (!boltTarget(battle,caster,map) || currentActor(battle) === caster && battle.action && battle.action !== "witch-bolt")) {
      endConcentration(battle,caster);
    }
  }
}

export function sustainWitchBolt(battle,caster,map,random = Math.random) {
  assertTurn(battle,caster);
  const target = boltTarget(battle,caster,map);
  if (!target || battle.action) error("Witch Bolt’s action is unavailable.");
  battle.action = "witch-bolt";
  log(battle,caster.name+" sustains Witch Bolt on "+target.name+".");
  damageLog(battle,target,"1d12","lightning",false,random,caster);
}

export function wakeCreature(battle,actor,target) {
  assertTurn(battle,actor);
  const sleep = condition(target,"Asleep");
  if (!sleep || !occupies(target) || distanceFt(actor,target) > 5 || battle.action) error("Choose a sleeping creature within reach and use your action.");
  battle.action = "wake";
  removeCondition(target,sleep);
  log(battle,actor.name+" wakes "+target.name+".");
}

function areaDamage(battle,caster,source,square,effect,map,dice,random) {
  const area = spellCells(battle,caster,square,effect,map);
  const roll = rollDice(dice+"d"+effect.faces,{random});
  log(battle,effect.name+" damage roll — "+roll.breakdown+" = "+roll.total+".");
  for (const creature of battle.actors.filter((actor) => occupies(actor) && area.has(keyAt(actor.x,actor.y)))) {
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
  const usage = spell.castUsage && slotLevel === 0 ? spell.castUsage : undefined;
  const original = {spellAbility:caster.spellAbility,spellDC:caster.spellDC,spellAttack:caster.spellAttack};
  const ability = caster.ability[spell.castingAbility];
  if (Number.isFinite(ability) && Number.isFinite(caster.proficiency)) {
    caster.spellAbility = ability;
    caster.spellDC = 8+caster.proficiency+ability;
    caster.spellAttack = caster.proficiency+ability;
  }
  try {
    return resolveSpell(battle,caster,target,spell,usage ? spell.level : slotLevel,options,random,usage);
  } finally {Object.assign(caster,original);}
}

function resolveSpell(battle,caster,target,spell,slotLevel,options,random,usage) {
  const effect = supportedSpell(spell.key);
  if (!effect || spell.edition !== "2014" || spell.customUse) error("This spell needs manual adjudication.");
  if (effect.exhale) return exhaleBreath(battle,caster,options,random);
  const {level = 0, heal:healing} = effect;
  const timing = effect.bonus ? "bonus" : "action";
  if (!battle.round && !effect.exploration) error("Enter combat to cast this spell.");
  checkCast(battle,caster,level,slotLevel,timing,usage);
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
    if (effect.teleport && (!mapFloor(options.map,square.x,square.y) || battle.terrain[keyAt(square.x,square.y)] === "wall" ||
        battle.actors.some((actor) => occupies(actor) && actor.x===square.x && actor.y===square.y))) error("Choose an unoccupied destination.");
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
    if (target.side !== caster.side || !actorIsUp(target) || incapacitated(target)) error("Choose a willing, conscious ally.");
    if (!breathTypes.includes(options.damageType)) error("Choose a damage type for Dragon’s Breath.");
    if (!Number.isFinite(caster.spellDC)) error("Set the spell save DC.");
  }
  spendCast(battle,caster,level,slotLevel,timing,usage);
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
      const caught = battle.actors.filter((actor) => occupies(actor) && area.has(keyAt(actor.x,actor.y)));
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
    const amount = rollDice(slotLevel+"d"+effect.faces,{random});
    const restored = heal(target,amount.total+caster.spellAbility);
    log(battle,target.name+" regains "+restored+" HP ("+amount.breakdown+", modifier "+caster.spellAbility+").");
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
