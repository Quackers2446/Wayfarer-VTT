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
  return {actors:[], order:[], turn:0, round:0, spent:0, dash:0, action:null, attacksMade:0, bonusUsed:false, log:[], terrain:{}};
}

export function log(battle, text) {
  battle.log.push(text);
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

export function startInitiative(battle, random = Math.random) {
  if (battle.round) error("Initiative is already running.");
  const ready = battle.actors.filter((actor) => occupies(actor) && actor.side !== "neutral");
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

export function endTurn(battle) {
  if (!battle.round) error("Start initiative first.");
  if (battle.movement) error("Resolve the opportunity attack before ending the turn.");
  const actor = currentActor(battle);
  if (actor?.hp === 0 && actor.resolveDeath && !actor.dead && !actor.stable && !battle.deathRolled) {
    error("Roll this character's death save before ending the turn.");
  }
  if (actor) actor.mocked = false;
  for (let checked = 0; checked < battle.order.length; checked++) {
    battle.turn += 1;
    if (battle.turn === battle.order.length) {
      battle.turn = 0;
      battle.round += 1;
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
  if (battle.terrain[keyAt(x,y)] === "wall") error("This square is blocked.");
  if (battle.actors.some((entry) => entry.id !== actor.id && occupies(entry) && entry.x === x && entry.y === y)) {
    error("Another token occupies that square.");
  }
  actor.x = x;
  actor.y = y;
}

function findPath(battle, actor, x, y, board) {
  const origin = keyAt(actor.x, actor.y);
  const destination = keyAt(x, y);
  const blockers = new Map(battle.actors.filter((entry) => entry.id !== actor.id && occupies(entry)).map((entry) =>
    [keyAt(entry.x, entry.y), entry]));
  if (blockers.has(destination)) error("Another token occupies that square.");
  const budget = moveLeft(battle, actor);
  const known = new Map([[origin, 0]]);
  const pending = [{x:actor.x, y:actor.y, cost:0, path:[]}];
  const blocked = (col,row) => battle.terrain[keyAt(col,row)] === "wall";
  while (pending.length) {
    pending.sort((a,b) => b.cost - a.cost);
    const cell = pending.pop();
    const here = keyAt(cell.x, cell.y);
    if (cell.cost !== known.get(here)) continue;
    if (here === destination) return cell;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = cell.x + dx;
        const row = cell.y + dy;
        const next = keyAt(col,row);
        if ((!dx && !dy) || col < 0 || row < 0 || col >= board.cols || row >= board.rows || blocked(col,row)) continue;
        if (dx && dy && (blocked(cell.x + dx, cell.y) || blocked(cell.x, cell.y + dy))) continue;
        if (blockers.has(next) && blockers.get(next).side !== actor.side) continue;
        const difficult = battle.terrain[next] === "difficult" || blockers.has(next);
        const cost = cell.cost + (difficult ? 10 : 5) + (actor.prone ? 5 : 0);
        if (cost > budget || cost >= (known.get(next) ?? Infinity)) continue;
        known.set(next, cost);
        pending.push({x:col, y:row, cost, path:[...cell.path, {x:col,y:row,cost}]});
      }
    }
  }
  return null;
}

function assertTurn(battle, actor) {
  if (battle.movement) error("Resolve the opportunity attack before continuing.");
  if (!battle.round || currentActor(battle)?.id !== actor.id) error("It is not this token’s turn.");
  if (!actorIsUp(actor)) error("This token cannot take actions at 0 hit points.");
}

function reactionWeapons(actor) {
  return actor.attacks.filter((attack) => !attack.normalRange && Number.isFinite(attack.bonus) && Boolean(diceTerms(attack.damage)));
}

function walkRemaining(battle, actor) {
  const walk = battle.movement;
  while (walk.index < walk.path.length && actorIsUp(actor)) {
    const next = walk.path[walk.index];
    const foe = !actor.disengaged && battle.actors.find((other) => actorIsUp(other) && occupies(other) &&
      other.side !== actor.side && other.side !== "neutral" && !other.reactionUsed && !walk.passed.includes(other.id) &&
      reactionWeapons(other).some((weapon) => {
        const reach = weapon.reach || 5;
        return distanceFt(actor,other) <= reach && distanceFt(next,other) > reach && lineClear(battle,other,actor);
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
  if (distance) log(battle, actor.name + " moves " + distance + " ft.");
  battle.movement = null;
}

export function moveToken(battle, actor, x, y, board) {
  if (!battle.round) return placeToken(battle, actor, x, y, board);
  assertTurn(battle, actor);
  const result = findPath(battle, actor, x, y, board);
  if (!result) error("That square is blocked or beyond the token’s remaining movement.");
  if (!result.cost) return;
  battle.movement = {actor:actor.id,path:result.path,index:0,passed:[]};
  walkRemaining(battle,actor);
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

export function resolveOpportunity(battle, attackIndex, random = Math.random) {
  const offer = opportunity(battle);
  if (!offer) error("There is no opportunity attack to resolve.");
  const {actor, foe, attacks} = offer;
  if (attackIndex != null) {
    const attack = attacks[attackIndex];
    if (!attack) error("Select a melee attack.");
    foe.reactionUsed = true;
    resolveWeaponRoll(battle,foe,actor,attack,{},random);
  } else log(battle, foe.name + " passes the opportunity attack.");
  battle.movement.passed.push(foe.id);
  battle.movement.foe = null;
  walkRemaining(battle,actor);
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
    return;
  }
  if (action === "bonus-disengage") {
    if (battle.bonusUsed || !actor.nimbleEscape) error("This token cannot use bonus-action Disengage.");
    actor.disengaged = true;
    battle.bonusUsed = true;
    log(battle, actor.name + " uses a bonus action to disengage.");
    return;
  }
  if (battle.action) error("This token has used its action.");
  if (action === "dash") battle.dash += speedOf(actor);
  else if (action === "dodge") actor.dodging = true;
  else if (action === "disengage") actor.disengaged = true;
  else error("Choose an action.");
  battle.action = action;
  log(battle, actor.name + " takes the " + action.charAt(0).toUpperCase() + action.slice(1) + " action.");
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
  const result = d20(0, {random});
  battle.deathRolled = true;
  if (result.kept === 20) heal(actor, 1);
  else if (result.kept >= 10) actor.successes += 1;
  else actor.failures += result.kept === 1 ? 2 : 1;
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

function damageLog(battle, target, expression, type, critical, random) {
  const roll = rollDice(expression, {doubleDice:critical, random});
  const outcome = applyDamage(battle, target, roll.total, type, critical);
  log(battle, target.name + " takes " + outcome.damage + (type ? " " + type : "") + " damage" +
    " (" + roll.breakdown + (outcome.absorbed ? "; " + outcome.absorbed + " absorbed by temp HP" : "") + ")" +
    (outcome.defeated ? " and is defeated." : outcome.unconscious ? " and falls unconscious." : "."));
  return outcome;
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

function lineClear(battle, from, to) {
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
  if (options.cover === "full" || !lineClear(battle,attacker,target)) error("Full cover blocks the attack.");
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
  log(battle, attacker.name + " · " + weapon.name + " vs " + target.name + " — " + roll.breakdown + " = " + roll.total +
    (critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  if (hit) {
    damageLog(battle, target, weapon.damage, weapon.type, critical, random);
    if (weapon.proneDC && actorIsUp(target)) {
      const save = d20(target.saves.str ?? target.ability.str ?? 0, {random});
      if (save.total < weapon.proneDC) target.prone = true;
      log(battle, target.name + " Strength save " + save.total + " vs DC " + weapon.proneDC + (target.prone ? " · prone." : "."));
    }
  }
  return {roll, hit, critical};
}

const spellEffects = {
  "vicious mockery": {range:60, save:"wis", type:"psychic", faces:4, mock:true},
  "sacred flame": {range:60, save:"dex", type:"radiant", faces:8, ignoresCover:true},
  "poison spray": {range:10, save:"con", type:"poison", faces:12},
  "fire bolt": {range:120, attack:true, type:"fire", faces:10},
  "ray of frost": {range:60, attack:true, type:"cold", faces:8, slow:true},
  "healing word": {range:60, heal:true, level:1, faces:4, bonus:true},
  "cure wounds": {range:5, heal:true, level:1, faces:8},
};

export const supportedSpell = (key) => spellEffects[key];

export function castSpell(battle, caster, target, spell, slotLevel, options = {}, random = Math.random) {
  assertTurn(battle, caster);
  validTarget(caster, target);
  const effect = supportedSpell(spell.key);
  if (!effect || spell.edition !== "2014") error("This spell needs manual adjudication.");
  const {bonus, heal:healing, attack, type, faces, level = 0} = effect;
  if (distanceFt(caster, target) > effect.range) error("The target is out of range.");
  if (options.cover === "full" || !lineClear(battle,caster,target)) error("Full cover blocks the spell.");
  if (bonus ? battle.bonusUsed || (battle.cast && (battle.cast.level > 0 || battle.cast.bonus)) : battle.action) {
    error("This spell’s action or bonus action is unavailable.");
  }
  if (!bonus && level && battle.cast?.bonus) error("After a bonus-action spell, this action can only cast a cantrip.");
  if (level && (!Number.isInteger(slotLevel) || slotLevel < level || !caster.slots[slotLevel]?.current)) {
    error("Choose a slot of the spell’s level or higher with a use remaining.");
  }
  if (healing && (target.dead || ["undead","construct"].includes(target.creatureType))) error("This spell cannot heal that target.");
  if (healing && !Number.isFinite(caster.spellAbility)) error("Set the spellcasting ability modifier.");
  if (attack && !Number.isFinite(caster.spellAttack)) error("Set the spell attack bonus.");
  if (effect.save && !Number.isFinite(caster.spellDC)) error("Set the spell save DC.");
  const dice = level ? slotLevel : 1 + [5,11,17].filter((threshold) => caster.level >= threshold).length;
  const expression = dice + "d" + faces;
  if (bonus) battle.bonusUsed = true;
  else battle.action = "cast";
  battle.cast = {bonus:bonus || battle.cast?.bonus, level:Math.max(level, battle.cast?.level ?? 0)};
  if (level) caster.slots[slotLevel].current -= 1;
  log(battle, caster.name + " casts " + spell.name + " on " + target.name + ".");
  if (healing) {
    const amount = rollDice(expression, {random});
    const restored = heal(target, amount.total + caster.spellAbility);
    log(battle, target.name + " regains " + restored + " HP (" + amount.breakdown + ", modifier " + caster.spellAbility + ").");
    return;
  }
  if (effect.save) {
    const dexCover = effect.save === "dex" && !effect.ignoresCover ? Number(options.cover) || 0 : 0;
    const failedAutomatically = target.hp === 0 && ["str","dex"].includes(effect.save);
    const result = failedAutomatically ? null : d20((target.saves[effect.save] ?? target.ability[effect.save] ?? 0) + dexCover,
      {advantage:effect.save === "dex" && target.dodging && actorIsUp(target) && speedOf(target) > 0, random});
    const passed = result && result.total >= caster.spellDC;
    log(battle, target.name + " save — " + (result ? result.breakdown + " = " + result.total : "automatic failure") +
      " vs DC " + caster.spellDC + (passed ? ", succeeds." : ", fails."));
    if (!passed) {
      damageLog(battle, target, expression, type, false, random);
      if (effect.mock && actorIsUp(target)) target.mocked = true;
    }
    return;
  }
  const distance = distanceFt(caster, target);
  const result = d20(caster.spellAttack, {...attackMode(battle, caster, target, options, true, distance), random});
  caster.mocked = false;
  const hit = result.kept === 20 || (result.kept !== 1 && result.total >= target.ac + (Number(options.cover) || 0));
  const critical = hit && (result.kept === 20 || (target.hp === 0 && distance <= 5));
  log(battle, "Spell attack — " + result.breakdown + " = " + result.total + (critical ? ", critical hit." : hit ? ", hit." : ", miss."));
  if (hit) {
    damageLog(battle, target, expression, type, critical, random);
    if (effect.slow && actorIsUp(target)) target.slowedBy = caster.id;
  }
}

export function drinkPotion(battle, actor, item, random = Math.random) {
  assertTurn(battle, actor);
  if (battle.action) error("This token has used its action.");
  if (!item || item.quantity <= 0 || !item.formula) error("Choose an available healing potion.");
  const amount = rollDice(item.formula, {random});
  battle.action = "potion";
  item.quantity -= 1;
  const restored = heal(actor, amount.total);
  log(battle, actor.name + " uses " + item.name + " and regains " + restored + " HP (" + amount.breakdown + ").");
}
