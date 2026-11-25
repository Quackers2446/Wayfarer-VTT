// Central conditions + temporary-status model.  Pure data and pure functions: no DOM, no imports.
//
// Everything that changes a creature's numbers for a while (a 5e condition, a BG3-style spell status such as
// Hasted, or a spell effect such as Bless / Mage Armor / Hex) is one entry in `actor.conditions`:
//
//   {name, expires, source, concentration, mods?, rollModifiers?, until?, spell?, level?, ...}
//
// `mods` is the *mechanical status model* (documented in SPELL_ENGINE.md, "Status model").  An entry's effective
// mods are the preset from `conditionTable[name]` (if the name is a table condition) merged with `entry.mods`.
// combat.mjs asks `modsOf(actor)` for the merged result, so UI and AI can render everything from one list.

export const advantageModes = ['adv', 'dis'];
export const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// Mechanical presets.  Keys use the same vocabulary as `status` blocks in spell rules.
export const conditionTable = {
  Blinded: {summary: 'Attacks against you have advantage; your attacks have disadvantage.', mods: {attack: 'dis', attackedBy: 'adv'}},
  Charmed: {summary: 'You cannot attack or target your charmer with harmful effects.', mods: {}},
  Deafened: {summary: 'You cannot hear.', mods: {}},
  Frightened: {summary: 'Disadvantage on attacks and ability checks while the source is in sight.', mods: {attack: 'dis', check: 'dis'}},
  Grappled: {summary: 'Your speed is 0.', mods: {speedZero: true}},
  Incapacitated: {summary: 'You cannot take actions or reactions.', mods: {incapacitated: true, noReactions: true}},
  Invisible: {summary: 'Your attacks have advantage; attacks against you have disadvantage.', mods: {attack: 'adv', attackedBy: 'dis'}},
  Paralyzed: {summary: 'Incapacitated, cannot move; fails STR/DEX saves; attacks against have advantage and crit within 5 ft.',
    mods: {incapacitated: true, noReactions: true, speedZero: true, autoFail: ['str', 'dex'], attackedBy: 'adv', autoCritNear: true}},
  Petrified: {summary: 'Incapacitated, cannot move; fails STR/DEX saves; resistance to all damage.',
    mods: {incapacitated: true, noReactions: true, speedZero: true, autoFail: ['str', 'dex'], attackedBy: 'adv', resistAll: true}},
  Poisoned: {summary: 'Disadvantage on attack rolls and ability checks.', mods: {attack: 'dis', check: 'dis'}},
  Prone: {summary: 'Disadvantage on attacks; attacks against you have advantage within 5 ft, disadvantage beyond.',
    mods: {attack: 'dis', attackedNear: 'adv', attackedFar: 'dis'}},
  Restrained: {summary: 'Speed 0; disadvantage on attacks and DEX saves; attacks against have advantage.',
    mods: {speedZero: true, attack: 'dis', attackedBy: 'adv', save: {dex: 'dis'}}},
  Stunned: {summary: 'Incapacitated, cannot move; fails STR/DEX saves; attacks against have advantage.',
    mods: {incapacitated: true, noReactions: true, speedZero: true, autoFail: ['str', 'dex'], attackedBy: 'adv'}},
  Unconscious: {summary: 'Incapacitated and prone; fails STR/DEX saves; attacks against have advantage and crit within 5 ft.',
    mods: {incapacitated: true, noReactions: true, speedZero: true, autoFail: ['str', 'dex'], attackedBy: 'adv', autoCritNear: true}},
  // Existing app condition for the Sleep spell: unconscious until damaged or woken.  The app deliberately keeps
  // natural-20-only critical hits against sleepers (scripts/test-play-feedback.mjs), so there is no autoCritNear here.
  Asleep: {summary: 'Unconscious until damaged or woken.',
    mods: {incapacitated: true, noReactions: true, speedZero: true, autoFail: ['str', 'dex'], attackedBy: 'adv'}},
  // Spell statuses with a fixed mechanical shape (BG3-style).
  Hasted: {summary: 'Speed doubled, +2 AC, advantage on DEX saves, one extra limited action.',
    mods: {speedMultiplier: 2, acBonus: 2, save: {dex: 'adv'}, extraAction: true}},
  Slowed: {summary: 'Speed halved, -2 AC and DEX saves, no reactions.',
    mods: {speedMultiplier: .5, acBonus: -2, saveBonus: {dex: -2}, noReactions: true}},
  Hidden: {summary: 'Not seen by enemies.', mods: {}},
};
// Names a spell rule may put in `condition` (the player-visible table).  '' means no condition.
export const ruleConditionNames = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Hasted', 'Slowed'];

const sizeOrder = 'TSMLHG';
export const sizeAtMost = (actorSize, limit) => sizeOrder.indexOf(actorSize) <= sizeOrder.indexOf(limit);

const asArray = value => Array.isArray(value) ? value : [];
const merge = (target, mods) => {
  if (!mods) return;
  if (mods.incapacitated) target.incapacitated = true;
  if (mods.noReactions) target.noReactions = true;
  if (mods.speedZero) target.speedZero = true;
  if (mods.autoCritNear) target.autoCritNear = true;
  if (mods.resistAll) target.resistAll = true;
  if (mods.negateFall) target.negateFall = true;
  if (mods.extraAction) target.extraAction = true;
  if (mods.blockMagicMissile) target.blockMagicMissile = true;
  if (Number.isFinite(mods.speedBonus)) target.speedBonus += mods.speedBonus;
  if (Number.isFinite(mods.speedMultiplier)) target.speedMultiplier *= mods.speedMultiplier;
  if (Number.isFinite(mods.acBonus)) target.acBonus += mods.acBonus;
  if (Number.isFinite(mods.maxHpBonus)) target.maxHpBonus += mods.maxHpBonus;
  if (mods.acBase) target.acBases.push(mods.acBase);
  for (const ability of asArray(mods.autoFail)) target.autoFail.add(ability);
  for (const [key, field] of [['attack', 'attack'], ['attackedBy', 'attacked'], ['check', 'check']]) {
    if (mods[key] === 'adv') target[field + 'Adv'] = true;
    if (mods[key] === 'dis') target[field + 'Dis'] = true;
  }
  if (mods.attackedNear === 'adv') target.attackedNearAdv = true;
  if (mods.attackedNear === 'dis') target.attackedNearDis = true;
  if (mods.attackedFar === 'adv') target.attackedFarAdv = true;
  if (mods.attackedFar === 'dis') target.attackedFarDis = true;
  for (const [ability, mode] of Object.entries(mods.save ?? {})) {
    if (mode === 'adv') (target.saveAdv[ability] = true);
    if (mode === 'dis') (target.saveDis[ability] = true);
  }
  for (const [ability, value] of Object.entries(mods.saveBonus ?? {})) target.saveBonus[ability] = (target.saveBonus[ability] ?? 0) + value;
  for (const key of ['resist', 'immune', 'vulnerable']) target[key].push(...asArray(mods[key]));
};

export const emptyMods = () => ({
  incapacitated: false, noReactions: false, speedZero: false, speedBonus: 0, speedMultiplier: 1, acBonus: 0, acBases: [], acBase: 0,
  autoFail: new Set(), autoCritNear: false, resistAll: false, negateFall: false, extraAction: false, blockMagicMissile: false, maxHpBonus: 0,
  attackAdv: false, attackDis: false, attackedAdv: false, attackedDis: false, checkAdv: false, checkDis: false,
  attackedNearAdv: false, attackedNearDis: false, attackedFarAdv: false, attackedFarDis: false,
  saveAdv: {}, saveDis: {}, saveBonus: {}, resist: [], immune: [], vulnerable: [], riders: [], markRiders: [],
});

export const conditionEntry = (actor, name) => actor?.conditions?.find(entry => entry.name === name);
export const entryMods = entry => {
  const preset = Object.hasOwn(conditionTable, entry.name) && !entry.statusOnly ? conditionTable[entry.name].mods : null;
  return [preset, entry.mods];
};

// Aggregate every effect currently on `actor` (conditions list, prone flag) into one flat structure.
export function modsOf(actor) {
  const result = emptyMods();
  if (!actor) return result;
  for (const entry of actor.conditions ?? []) {
    for (const mods of entryMods(entry)) merge(result, mods);
    for (const rider of asArray(entry.mods?.riders)) result.riders.push({...rider, entry});
    for (const rider of asArray(entry.mods?.markRiders)) result.markRiders.push({...rider, entry});
  }
  if (actor.prone) merge(result, conditionTable.Prone.mods);
  for (const base of result.acBases) {
    const value = (base.base ?? 0) + (base.dex ? actor.ability?.dex ?? 0 : 0);
    if (value > result.acBase) result.acBase = value;
  }
  return result;
}

export const conditionFlag = (actor, flag) => Boolean(modsOf(actor)[flag]);
export const hasIncapacitatingCondition = actor => modsOf(actor).incapacitated;
export const canReact = actor => Boolean(actor) && !actor.reactionUsed && !modsOf(actor).noReactions && !modsOf(actor).incapacitated;
export const autoFailsSave = (actor, ability) => modsOf(actor).autoFail.has(ability);

// Advantage / disadvantage a creature's own saving throw receives from its statuses.
export function saveMode(actor, ability, mods = modsOf(actor)) {
  return {advantage: Boolean(mods.saveAdv[ability] || mods.saveAdv.all), disadvantage: Boolean(mods.saveDis[ability] || mods.saveDis.all)};
}

// Resolve a status's turn-based expiry: `until` is {when:'start'|'end', actor:id, round:n}.
export function expireTurnStatuses(actors, subject, when, round) {
  let removed = false;
  for (const actor of actors) {
    if (!actor.conditions?.length) continue;
    const kept = actor.conditions.filter(entry => !(entry.until && entry.until.actor === subject.id && entry.until.when === when && round >= entry.until.round));
    if (kept.length !== actor.conditions.length) {removed = true; actor.conditions = kept;}
  }
  return removed;
}

// End statuses that declare `ends: {onAttacked | onDamaged | onHit | onAttack}`.
export function endStatuses(actor, event) {
  if (!actor?.conditions?.length) return [];
  const ended = actor.conditions.filter(entry => entry.ends?.[event]);
  if (ended.length) actor.conditions = actor.conditions.filter(entry => !ended.includes(entry));
  return ended;
}

// Maximum-HP statuses: keep `maxHp` consistent with whichever bonuses are currently active.
export function syncStatusHp(actor) {
  const wanted = modsOf(actor).maxHpBonus, applied = actor.maxHpBonusApplied ?? 0;
  if (wanted === applied) return;
  actor.maxHp += wanted - applied;
  if (wanted > applied) actor.hp += wanted - applied;
  else actor.hp = Math.max(actor.hp > 0 ? 1 : 0, Math.min(actor.hp, actor.maxHp));
  actor.maxHpBonusApplied = wanted;
  if (!wanted) delete actor.maxHpBonusApplied;
}

// A short human readable line for tooltips / token badges.
export function conditionSummary(entry) {
  if (entry.summary) return entry.summary;
  if (Object.hasOwn(conditionTable, entry.name)) return conditionTable[entry.name].summary;
  const mods = entry.mods ?? {}, parts = [];
  if (mods.acBonus) parts.push((mods.acBonus > 0 ? '+' : '') + mods.acBonus + ' AC');
  if (mods.acBase) parts.push('AC ' + mods.acBase.base + (mods.acBase.dex ? ' + Dex' : ''));
  if (mods.speedBonus) parts.push((mods.speedBonus > 0 ? '+' : '') + mods.speedBonus + ' ft speed');
  if (mods.speedMultiplier && mods.speedMultiplier !== 1) parts.push('speed ×' + mods.speedMultiplier);
  for (const [key, value] of Object.entries(entry.rollModifiers ?? {})) parts.push(value + ' ' + key);
  if (mods.attack) parts.push((mods.attack === 'adv' ? 'advantage' : 'disadvantage') + ' on attacks');
  if (mods.attackedBy) parts.push('attacks against: ' + (mods.attackedBy === 'adv' ? 'advantage' : 'disadvantage'));
  for (const key of ['resist', 'immune', 'vulnerable']) if (mods[key]?.length) parts.push(key + ' ' + mods[key].join('/'));
  return parts.join(', ');
}
