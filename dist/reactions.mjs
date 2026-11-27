// Reaction framework.  A creature "arms" reaction spells (`actor.reactions = [{reference, slot?}]`, serializable); the engine
// calls fireReactions(...) at trigger points inside attack / damage / fall resolution.  This is the same pattern the
// app already uses for Cutting Words: no blocking prompt, the armed reaction is spent automatically when it is useful.
//
// Manual Reaction during dice theatre: after a roll is known the presentation can pause so a player picks a known
// reaction spell (Counterspell, Shield, Hellish Rebuke, …). Armed auto-fire still runs at engine time; the pause path
// casts from the sheet and, where possible, undoes committed hit/spell results (Shield miss, Counterspell interrupt).
import {castSpell, actorIsUp, armorClass, log, distanceFt, d20, addInspiration, occupies, canTakeTurn, endConcentration} from './combat.mjs';
import {canReact, modsOf} from './conditions.mjs';
import {customSpellRule} from './spell-rule-store.mjs';
import {ruleKey} from './spell-rule-schema.mjs';
import {dismissSummons} from './summons.mjs';

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

const pickSlot = (reactor, rule, armed = {}) => {
  if (!rule.level) return 0;
  const preferred = Number(armed.slot);
  if (preferred >= rule.level && reactor.slots[preferred]?.current > 0) return preferred;
  return Object.keys(reactor.slots ?? {}).map(Number).sort((a, b) => a - b).find(rank => rank >= rule.level && reactor.slots[rank]?.current > 0);
};
// Would the reaction's AC bonus turn this hit into a miss?  Avoids wasting Shield on hits it cannot stop.
// Self-shape spells (Shield) apply their status to the caster even when the block has no explicit `to`.
const acGain = rule => rule.effects.reduce((sum, block) => {
  const applies = (block.to ?? (rule.shape === 'self' ? 'self' : 'targets')) === 'self';
  return sum + (applies ? block.status?.acBonus ?? 0 : 0);
}, 0);

const spellCard = (reactor, rule, reference) =>
  reactor.spells?.find(entry => (entry.reference || entry.key) === reference) ??
  {name: rule.name, key: ruleKey(rule.name), reference: rule.reference, edition: rule.edition, level: rule.level, timing: 'reaction'};

/** Triggers that make sense for a committed action-event while the dice theatre is up. */
export function eventReactionTriggers(event) {
  if (!event) return [];
  const triggers = [];
  if (event.kind === 'spell') triggers.push('spellCast');
  if (event.kind === 'attack' || event.outcome === 'Hit' || event.outcome === 'Critical hit' || event.outcome === 'Miss') {
    if (event.outcome === 'Hit' || event.outcome === 'Critical hit') triggers.push('hit', 'damage', 'damaged');
    else if (event.outcome === 'Miss') triggers.push('hit');
  }
  if (event.kind === 'fall') triggers.push('falling');
  if (event.kind === 'spell' && /magic missile/i.test(event.action ?? '')) triggers.push('magicMissile', 'hit', 'damage', 'damaged');
  return [...new Set(triggers)];
}

function eventCaster(battle, event) {
  return battle.actors.find(actor => actor.id === event.actor) ?? null;
}
function eventTarget(battle, event) {
  const id = event.targetActor ?? event.impacts?.find(impact => !impact.healing)?.actor;
  return id ? battle.actors.find(actor => actor.id === id) ?? null : null;
}

/** Vitality before this committed event — used so Shield remains usable after a drop to 0 HP. */
function preEventActor(reactor, event) {
  const change = event?.healthChanges?.find(entry => entry.actor === reactor.id);
  if (!change?.before) return reactor;
  return {
    ...reactor,
    hp: change.before.hp,
    tempHp: change.before.tempHp ?? 0,
    dead: Boolean(change.before.dead),
    prone: Boolean(change.before.prone),
    stable: Boolean(change.before.stable),
    successes: change.before.successes ?? 0,
    failures: change.before.failures ?? 0,
  };
}

function canManualReact(battle, reactor, event) {
  const prior = preEventActor(reactor, event);
  return actorIsUp(prior) && canReact(prior) && !canTakeTurn(battle, reactor);
}

function triggerFits(rule, trigger, context) {
  if (!triggerList(rule).includes(trigger)) return false;
  if (rule.reactionDamageTypes && context.damageType && !rule.reactionDamageTypes.includes(context.damageType)) return false;
  if (trigger === 'hit' && acGain(rule) && context.reactor && context.attackTotal != null) {
    if (context.kept === 20 || context.outcome === 'Critical hit' || context.outcome === 'Miss') return false;
    if (context.attackTotal >= armorClass(context.reactor) + (context.cover ?? 0) + acGain(rule)) return false;
  }
  if (trigger === 'damaged' && (!context.source || context.source.id === context.reactor?.id || context.source.dead)) return false;
  if (trigger === 'spellCast' && (!context.source || context.source.id === context.reactor?.id || context.source.side === context.reactor?.side)) return false;
  if (trigger === 'spellCast' && rule.range && context.map && occupies(context.reactor) && occupies(context.source) &&
    distanceFt(context.reactor, context.source) > rule.range) return false;
  return true;
}

/**
 * Reaction spells a controlled character may fire during a dice pause (off their turn, reaction free, spell known).
 * Options are filtered to real sheet spells with timing:'reaction' — never invented names.
 */
export function manualReactionOptions(battle, event, {canControl = () => false, map} = {}) {
  if (!battle?.round || !event) return [];
  const triggers = eventReactionTriggers(event);
  if (!triggers.length) return [];
  const source = eventCaster(battle, event);
  const target = eventTarget(battle, event);
  const damageType = event.type || event.impacts?.find(impact => impact.type && !impact.healing)?.type;
  const options = [];
  for (const reactor of battle.actors) {
    if (!canControl(reactor) || !canManualReact(battle, reactor, event)) continue;
    for (const {spell, rule} of reactionSpells(reactor, battle.spellRules)) {
      const reference = spell.reference || spell.key || rule.reference;
      const slot = pickSlot(reactor, rule);
      if (slot === undefined) continue;
      const context = {
        reactor, source, map, damageType, attackTotal: event.total, cover: 0,
        outcome: event.outcome, kept: event.rolls?.find(roll => roll.kept != null)?.kept,
      };
      const matched = triggers.find(trigger => triggerFits(rule, trigger, context));
      if (!matched) continue;
      // Target-gated reactions: Shield/Absorb on the creature being hit; Hellish Rebuke from the damaged creature.
      if (['hit', 'damage', 'damaged', 'magicMissile'].includes(matched) && target && reactor.id !== target.id && rule.shape === 'self') continue;
      if (matched === 'damaged' && rule.shape === 'creature' && target && reactor.id !== target.id) continue;
      options.push({
        id: reactor.id + ':' + reference + ':' + matched,
        actorId: reactor.id,
        actorName: reactor.name,
        reference,
        name: rule.name,
        level: rule.level,
        slot,
        trigger: matched,
        shape: rule.shape,
        needsTarget: rule.shape === 'creature',
        targetId: rule.shape === 'creature' ? source?.id : null,
        targetName: rule.shape === 'creature' ? source?.name : null,
        note: matched === 'spellCast' ? 'Interrupt this cast' : matched === 'hit' && acGain(rule) ? 'May turn the hit into a miss' : reactionTriggerNames[matched] || matched,
      });
    }
  }
  return options;
}

export function canOfferManualReaction(battle, event, options) {
  return manualReactionOptions(battle, event, options).length > 0;
}

function restoreHealth(battle, event) {
  for (const change of event.healthChanges ?? []) {
    const actor = battle.actors.find(entry => entry.id === change.actor);
    if (!actor || !change.before) continue;
    actor.hp = change.before.hp;
    actor.tempHp = change.before.tempHp ?? 0;
    actor.dead = Boolean(change.before.dead);
    actor.prone = Boolean(change.before.prone);
    actor.stable = Boolean(change.before.stable);
    actor.successes = change.before.successes ?? 0;
    actor.failures = change.before.failures ?? 0;
  }
}

function undoSpellAftermath(battle, event) {
  restoreHealth(battle, event);
  const caster = eventCaster(battle, event);
  const reference = event.spellReference;
  if (caster?.concentration && (caster.concentration.name === event.action || (reference && caster.concentration.spell === reference))) {
    endConcentration(battle, caster);
  }
  for (const actor of battle.actors) {
    actor.conditions = (actor.conditions ?? []).filter(entry => !(entry.source === event.actor && (entry.spell === reference || entry.name && event.action === entry.name)));
  }
  battle.spellZones = (battle.spellZones ?? []).filter(zone => !(zone.caster === event.actor && (zone.rule?.reference === reference || zone.name === event.action)));
  // Non-concentration summons (e.g. Spiritual Weapon) still vanish when the cast is countered.
  if (caster && reference) {
    for (const actor of battle.actors) {
      if (actor.summoner === caster.id && actor.summonSpell === reference && !actor.dismissed) {
        dismissSummons(battle, caster.id, {only: actor.id});
      }
    }
  } else if (caster && event.action) {
    for (const actor of battle.actors) {
      if (actor.summoner === caster.id && actor.name === event.action && !actor.dismissed) {
        dismissSummons(battle, caster.id, {only: actor.id});
      }
    }
  }
}

/**
 * Cast a chosen reaction during a dice-theatre pause. Returns {ok, cancelled?, message, needsTarget?}.
 * Counterspell / Shield attempt to undo the paused event when the rules check succeeds.
 */
export function resolveManualReaction(battle, choice, event, {map, random = Math.random, target} = {}) {
  const reactor = battle.actors.find(actor => actor.id === choice.actorId);
  if (!reactor) throw new Error('That character is no longer available.');
  if (!canManualReact(battle, reactor, event)) throw new Error('That reaction is no longer available.');
  const rule = customSpellRule(choice.reference, battle.spellRules);
  if (!rule || rule.timing !== 'reaction') throw new Error('That reaction spell is not available.');
  const slot = choice.slot ?? pickSlot(reactor, rule);
  if (slot === undefined) throw new Error('No spell slot remains for that reaction.');
  const spell = spellCard(reactor, rule, choice.reference);
  const source = eventCaster(battle, event);
  const hitTarget = eventTarget(battle, event);
  const damageType = event.type || event.impacts?.find(impact => impact.type && !impact.healing)?.type;

  if (choice.trigger === 'spellCast') {
    const spellLevel = Number.isFinite(event.spellLevel) ? event.spellLevel : Math.max(0, ...Object.keys(source?.slots ?? {}).map(Number));
    let cancelled = slot >= spellLevel;
    if (!cancelled) {
      const mod = Number.isFinite(reactor.spellAbility) ? reactor.spellAbility : 0;
      const check = d20(mod, {random, label: 'Counterspell check'});
      addInspiration(reactor, check, random);
      cancelled = check.total >= 10 + spellLevel;
      log(battle, reactor.name + ' Counterspell check — ' + check.breakdown + ' = ' + check.total + ' vs DC ' + (10 + spellLevel) + (cancelled ? ', succeeds.' : ', fails.'));
    }
    castSpell(battle, reactor, source, spell, slot, {map, reaction: {trigger: 'spellCast', source, spellLevel}}, random);
    if (cancelled) {
      undoSpellAftermath(battle, event);
      log(battle, reactor.name + ' counters ' + (event.action || 'the spell') + ' with ' + rule.name + '.');
      return {ok: true, cancelled: true, message: rule.name + ' interrupts ' + (event.action || 'the spell') + '.'};
    }
    return {ok: true, cancelled: false, message: rule.name + ' fails to interrupt ' + (event.action || 'the spell') + '.'};
  }

  if (rule.shape === 'creature') {
    const foe = target || source;
    if (!foe) return {ok: false, needsTarget: true, message: 'Choose a target for ' + rule.name + '.'};
    castSpell(battle, reactor, foe, spell, slot, {
      map,
      reaction: {trigger: choice.trigger, source: foe, damageType, amount: event.damage?.damage, height: event.height},
    }, random);
    return {ok: true, message: reactor.name + ' uses ' + rule.name + '.'};
  }

  // Shield must be cast against pre-hit vitality — a drop to 0 HP otherwise blocks casting.
  const shieldInterrupt = choice.trigger === 'hit' && acGain(rule) && hitTarget?.id === reactor.id &&
    event.outcome !== 'Critical hit' && Number.isFinite(event.total);
  const selfChanges = shieldInterrupt
    ? (event.healthChanges ?? []).filter(entry => entry.actor === reactor.id && entry.before)
    : [];
  if (selfChanges.length) restoreHealth(battle, {healthChanges: selfChanges});

  castSpell(battle, reactor, null, spell, slot, {
    map,
    reaction: {trigger: choice.trigger, source, damageType, amount: event.damage?.damage, height: event.height},
  }, random);

  if (shieldInterrupt && event.total < armorClass(reactor)) {
    log(battle, rule.name + ' turns the attack into a miss.');
    return {ok: true, cancelled: true, message: rule.name + ' turns the attack into a miss.'};
  }

  // Attack still connects after the AC bonus — put the recorded damage back.
  if (selfChanges.length) {
    for (const entry of selfChanges) {
      const actor = battle.actors.find(item => item.id === entry.actor);
      if (!actor || !entry.after) continue;
      actor.hp = entry.after.hp;
      actor.tempHp = entry.after.tempHp ?? 0;
      actor.dead = Boolean(entry.after.dead);
      actor.prone = Boolean(entry.after.prone);
      actor.stable = Boolean(entry.after.stable);
      actor.successes = entry.after.successes ?? 0;
      actor.failures = entry.after.failures ?? 0;
    }
  }

  return {ok: true, message: reactor.name + ' uses ' + rule.name + '.'};
}

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
