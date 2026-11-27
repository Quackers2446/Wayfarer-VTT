// Summoned creatures: ordinary battle actors with extra bookkeeping fields.
//   summoner (caster id), summonSpell (rule reference), summonExpires (elapsed seconds), summonConcentration (bool)
// They join initiative right after the caster, so for party casters they act in the caster's shared-turn group.
import {makeActor, log} from './combat.mjs';
import {extraSlots} from './spell-scaling.mjs';

export function summonedBy(battle, casterId) {
  return battle.actors.filter(actor => actor.summoner === casterId && !actor.dismissed);
}

function summonAttack(spec, rule, caster, slot) {
  const extra = Math.floor(extraSlots(rule, slot) / (spec.upcastStep ?? 1)), term = spec.upcast ? spec.upcast.replace(/\s+/g, '') : '';
  let damage = spec.damage + (term ? Array.from({length: extra}, () => /^[+-]/.test(term) ? term : '+' + term).join('') : '');
  const ability = spec.addAbility && Number.isFinite(caster.spellAbility) ? caster.spellAbility : 0;
  if (ability) damage += (ability > 0 ? '+' : '') + ability;
  const attack = {name: spec.name, bonus: spec.bonus === 'spell' ? caster.spellAttack ?? 0 : spec.bonus, damage, type: spec.type, magical: true, spellAttack: spec.bonus === 'spell'};
  if (spec.normalRange) {attack.normalRange = spec.normalRange; attack.longRange = spec.longRange ?? spec.normalRange;}
  else attack.reach = spec.reach ?? 5;
  return attack;
}

// Place `block.summon` creatures near `square`.  Returns the new actors.
export function spawnSummons(battle, caster, rule, spec, square, slot, {map, canStand}) {
  const count = (spec.count?.base ?? 1) + extraSlots(rule, slot) * (spec.count?.perSlot ?? 0);
  const created = [];
  const taken = new Set();
  const spots = [square];
  for (let radius = 1; radius <= 3; radius++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === radius) spots.push({x: square.x + dx, y: square.y + dy});
  for (let index = 0; index < count; index++) {
    const hp = spec.hp + extraSlots(rule, slot) * (spec.hpPerSlot ?? 0);
    const actor = makeActor({
      name: count > 1 ? spec.name + ' ' + (index + 1) : spec.name, side: caster.side, hp, maxHp: hp, ac: spec.ac, speed: spec.speed,
      attacks: (spec.attacks ?? []).map(attack => summonAttack(attack, rule, caster, slot)), swings: spec.swings ?? 1,
      creatureSize: spec.size ?? 'M', creatureType: spec.creatureType ?? 'construct', initiative: caster.initiative ?? 0, initiativeRoll: caster.initiativeRoll,
      summoner: caster.id, summonSpell: rule.reference, summonConcentration: Boolean(rule.concentration),
      summonExpires: rule.duration ? (battle.elapsed ?? 0) + rule.duration : null, conditionImmune: ['charmed', 'frightened', 'poisoned'],
    });
    const spot = spots.find(candidate => !taken.has(candidate.x + ':' + candidate.y) && map && candidate.x >= 0 && candidate.y >= 0 && candidate.x < map.cols && candidate.y < map.rows && canStand(battle, actor, candidate.x, candidate.y, map));
    if (!spot) {log(battle, 'There is no room for ' + actor.name + '.'); continue;}
    taken.add(spot.x + ':' + spot.y);
    actor.x = spot.x; actor.y = spot.y;
    battle.actors.push(actor);
    if (battle.round && battle.order.includes(caster.id)) {
      const at = battle.order.indexOf(caster.id) + 1 + created.length;
      battle.order.splice(at, 0, actor.id);
      if (at <= battle.turn) battle.turn += 1;
    }
    created.push(actor);
    log(battle, actor.name + ' appears.');
  }
  return created;
}

// Dismiss summons.  Marked, not removed, while combat runs so initiative indices stay valid; pruneDismissed removes them later.
export function dismissSummons(battle, casterId, {concentrationOnly = false, only = null} = {}) {
  for (const actor of battle.actors) {
    if (actor.dismissed || !actor.summoner) continue;
    if (only ? actor.id !== only : actor.summoner !== casterId || concentrationOnly && !actor.summonConcentration) continue;
    log(battle, actor.name + ' vanishes.');
    actor.dismissed = true; actor.dead = true; actor.hp = 0; actor.x = null; actor.y = null; actor.conditions = [];
    if (actor.carrying) {const body = battle.actors.find(other => other.id === actor.carrying); if (body) body.carriedBy = null; actor.carrying = null;}
    if (actor.dragging) {const body = battle.actors.find(other => other.id === actor.dragging); if (body) body.draggedBy = null; actor.dragging = null;}
  }
  pruneDismissed(battle);
}

export function pruneDismissed(battle) {
  if (battle.round || !battle.actors.some(actor => actor.dismissed)) return;
  const gone = new Set(battle.actors.filter(actor => actor.dismissed).map(actor => actor.id));
  battle.actors = battle.actors.filter(actor => !gone.has(actor.id));
  battle.order = (battle.order ?? []).filter(id => !gone.has(id));
}
