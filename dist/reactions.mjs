// Reaction framework.  A creature "arms" reaction spells (`actor.reactions = [{reference, slot?}]`, serializable); the engine
// calls fireReactions(...) at trigger points inside attack / damage / fall resolution.  This is the same pattern the
// app already uses for Cutting Words: no blocking prompt, the armed reaction is spent automatically when it is useful.
import {castSpell, actorIsUp, armorClass, log, distanceFt, d20, addInspiration, occupies} from './combat.mjs';
import {canReact, modsOf} from './conditions.mjs';
import {customSpellRule} from './spell-rule-store.mjs';
import {ruleKey} from './spell-rule-schema.mjs';

const running = new WeakSet();
export const reactionTriggerNames = {hit: 'when hit by an attack', damage: 'when about to take damage', damaged: 'after taking damage', falling: 'when falling', spellCast: 'when a creature casts a spell', magicMissile: 'when targeted by Magic Missile'};
const triggerList = rule => Array.isArray(rule.reactionTrigger) ? rule.reactionTrigger : rule.reactionTrigger != null ? [rule.reactionTrigger] : [];

export function armReaction(actor, reference, {slot} = {}) {
  const list = (actor.reactions ??= []).filter(entry => entry.reference !== reference);
  list.push(slot ? {reference, slot} : {reference});
  actor.reactions = list;
}
export function disarmReaction(actor, reference) {
  actor.reactions = (actor.reactions ?? []).filter(entry => entry.reference !== reference);
  if (!actor.reactions.length) delete actor.reactions;
}
export const isArmed = (actor, reference) => (actor.reactions ?? []).some(entry => entry.reference === reference);

// Reaction spells a character could arm: spells on the sheet whose rule has timing 'reaction'.
export function reactionSpells(actor, rules) {
  return (actor.spells ?? []).map(spell => ({spell, rule: customSpellRule(spell.reference || spell.key, rules)})).filter(({rule}) => rule?.timing === 'reaction');
}

const pickSlot = (reactor, rule, armed) => {
  if (!rule.level) return 0;
  const preferred = Number(armed.slot);
  if (preferred >= rule.level && reactor.slots[preferred]?.current > 0) return preferred;
  return Object.keys(reactor.slots).map(Number).sort((a, b) => a - b).find(rank => rank >= rule.level && reactor.slots[rank]?.current > 0);
};
// Would the reaction's AC bonus turn this hit into a miss?  Avoids wasting Shield on hits it cannot stop.
// Self-shape spells (Shield) apply their status to the caster even when the block has no explicit `to`.
const acGain = rule => rule.effects.reduce((sum, block) => {
  const applies = (block.to ?? (rule.shape === 'self' ? 'self' : 'targets')) === 'self';
  return sum + (applies ? block.status?.acBonus ?? 0 : 0);
}, 0);

export function fireReactions(battle, trigger, context, random = Math.random) {
  const reactor = context.reactor;
  if (!reactor?.reactions?.length || running.has(reactor) || !actorIsUp(reactor) || !canReact(reactor)) return false;
  for (const armed of [...reactor.reactions]) {
    const rule = customSpellRule(armed.reference, battle.spellRules);
    if (!rule || rule.timing !== 'reaction' || !triggerList(rule).includes(trigger)) continue;
    if (battle.round && battle.cast?.bonus && reactor.id === battle.actors.find(actor => actor.id === battle.order[battle.turn])?.id) continue;
    if (rule.reactionDamageTypes && !rule.reactionDamageTypes.includes(context.damageType)) continue;
    if (trigger === 'hit' && context.attackTotal != null && !(context.attackTotal < armorClass(reactor) + context.cover + acGain(rule))) continue;
    if (trigger === 'damaged' && (!context.source || context.source.id === reactor.id || context.source.dead)) continue;
    if (trigger === 'magicMissile' && modsOf(reactor).blockMagicMissile) continue;
    const slot = pickSlot(reactor, rule, armed);
    if (slot === undefined) continue;
    const spell = reactor.spells.find(entry => (entry.reference || entry.key) === armed.reference) ?? {name: rule.name, key: ruleKey(rule.name), reference: rule.reference, edition: rule.edition, level: rule.level, timing: 'reaction'};
    running.add(reactor);
    try {
      castSpell(battle, reactor, rule.shape === 'creature' ? context.source : null, spell, slot, {map: context.map, reaction: {trigger, source: context.source, damageType: context.damageType, amount: context.amount, height: context.height}}, random);
      return true;
    } catch (error) {
      log(battle, reactor.name + ' cannot use ' + rule.name + ': ' + error.message);
    } finally {running.delete(reactor);}
  }
  return false;
}

// Counterspell: an armed reaction within 60 ft can cancel a spell before it takes effect.  Uses a slot ≥ the
// incoming spell's level, or an ability check (DC 10 + spell level) with a lower slot.  Returns true if cancelled.
export function tryCounterspell(battle, caster, rule, spellLevel, map, random = Math.random) {
  if (!rule.level && rule.level !== 0) return false;
  for (const reactor of battle.actors) {
    if (reactor === caster || reactor.side === caster.side || !reactor.reactions?.length || !actorIsUp(reactor) || !canReact(reactor)) continue;
    if (map && occupies(reactor) && occupies(caster) && distanceFt(reactor, caster) > 60) continue;
    for (const armed of [...reactor.reactions]) {
      const counter = customSpellRule(armed.reference, battle.spellRules);
      if (!counter || counter.timing !== 'reaction' || counter.reactionTrigger !== 'spellCast') continue;
      const slot = pickSlot(reactor, counter, armed);
      if (slot === undefined) continue;
      let cancelled = slot >= spellLevel;
      if (!cancelled) {
        const mod = Number.isFinite(reactor.spellAbility) ? reactor.spellAbility : 0;
        const check = d20(mod, {random, label: 'Counterspell check'});
        addInspiration(reactor, check, random);
        cancelled = check.total >= 10 + spellLevel;
        log(battle, reactor.name + ' Counterspell check — ' + check.breakdown + ' = ' + check.total + ' vs DC ' + (10 + spellLevel) + (cancelled ? ', succeeds.' : ', fails.'));
      }
      // The reaction and slot are spent whether or not the check succeeds (PHB Counterspell).
      const spell = reactor.spells?.find(entry => (entry.reference || entry.key) === armed.reference) ?? {name: counter.name, key: ruleKey(counter.name), reference: counter.reference, edition: counter.edition, level: counter.level, timing: 'reaction'};
      running.add(reactor);
      try {
        castSpell(battle, reactor, caster, spell, slot, {map, reaction: {trigger: 'spellCast', source: caster, spellLevel}}, random);
        reactor.reactionUsed = true;
        if (cancelled) {
          log(battle, reactor.name + ' counters ' + rule.name + ' with ' + counter.name + '.');
          return true;
        }
        log(battle, reactor.name + ' fails to counter ' + rule.name + '.');
        return false;
      } catch (error) {
        log(battle, reactor.name + ' cannot use ' + counter.name + ': ' + error.message);
      } finally {running.delete(reactor);}
    }
  }
  return false;
}
