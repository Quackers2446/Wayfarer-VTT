/** Multi-party membership on a shared dungeon map. Legacy actors without partyId belong to party-1. */

export const DEFAULT_PARTY_ID = 'party-1';
export const MAX_PARTY_SIZE = 4;
export const MAX_PARTIES = 2;

const partyPattern = /^party-\d+$/;

export function actorPartyId(actor) {
  if (!actor || actor.side !== 'party') return null;
  const id = typeof actor.partyId === 'string' && actor.partyId.trim() ? actor.partyId.trim() : DEFAULT_PARTY_ID;
  return partyPattern.test(id) ? id : DEFAULT_PARTY_ID;
}

export function sameParty(a, b) {
  return Boolean(a && b && a.side === 'party' && b.side === 'party' && actorPartyId(a) === actorPartyId(b));
}

export function isPlayerCharacter(actor) {
  return Boolean(actor && actor.side === 'party' && !actor.summoner);
}

/** Another living PC that can be attacked (same or rival party). */
export function isAttackablePc(attacker, target) {
  return isPlayerCharacter(attacker) && isPlayerCharacter(target) && attacker.id !== target.id && !target.dead;
}

/** Hostile monster or rival/same-party PC for opening combat. */
export function isCombatFoe(attacker, target) {
  if (!attacker || !target || attacker.id === target.id || target.dead) return false;
  if (target.side === 'hostile') return attacker.side === 'party';
  return isAttackablePc(attacker, target);
}

export function isAllyOf(actor, other) {
  return sameParty(actor, other);
}

export function ensureParties(battle) {
  const parties = Array.isArray(battle.parties) ? battle.parties.filter(party => party && typeof party.id === 'string') : [];
  const known = new Map(parties.map(party => [party.id, {id: party.id, name: String(party.name || partyLabel(party.id)).slice(0, 40)}]));
  for (const actor of battle.actors.filter(entry => entry.side === 'party')) {
    const id = actorPartyId(actor);
    actor.partyId = id;
    if (!known.has(id)) known.set(id, {id, name: partyLabel(id)});
  }
  if (!known.size) known.set(DEFAULT_PARTY_ID, {id: DEFAULT_PARTY_ID, name: partyLabel(DEFAULT_PARTY_ID)});
  battle.parties = [...known.values()].sort((a, b) => a.id.localeCompare(b.id));
  return battle.parties;
}

export function partyLabel(partyId) {
  const match = /^party-(\d+)$/.exec(partyId);
  if (!match) return 'Party';
  const n = Number(match[1]);
  return n <= 26 ? 'Party ' + String.fromCharCode(64 + n) : 'Party ' + n;
}

export function partyMembers(battle, partyId) {
  const id = partyId || DEFAULT_PARTY_ID;
  return battle.actors.filter(actor => actor.side === 'party' && actorPartyId(actor) === id);
}

export function partyFull(battle, partyId) {
  return partyMembers(battle, partyId).length >= MAX_PARTY_SIZE;
}

export function canCreateParty(battle) {
  return ensureParties(battle).length < MAX_PARTIES;
}

export function nextPartyId(battle) {
  ensureParties(battle);
  for (let n = 1; n <= MAX_PARTIES + 2; n++) {
    const id = 'party-' + n;
    if (!battle.parties.some(party => party.id === id)) return id;
  }
  return null;
}

export function createParty(battle, name) {
  if (!canCreateParty(battle)) throw new Error('This adventure already has ' + MAX_PARTIES + ' parties.');
  const id = nextPartyId(battle);
  if (!id) throw new Error('No party slots remain.');
  const party = {id, name: String(name || partyLabel(id)).trim().slice(0, 40) || partyLabel(id)};
  battle.parties.push(party);
  battle.parties.sort((a, b) => a.id.localeCompare(b.id));
  return party;
}

export function assignParty(actor, partyId) {
  if (actor.side !== 'party') return actor;
  actor.partyId = partyPattern.test(partyId) ? partyId : DEFAULT_PARTY_ID;
  return actor;
}

/** True for a deliberate player scrap — not a monster encounter that just ran out of foes. */
export function isPvpCombat(battle) {
  if (!battle?.round) return false;
  // Clearing hostiles must not flip an encounter into PvP and block auto-end.
  if (battle.combatKind === 'encounter') return false;
  const participants = battle.order.map(id => battle.actors.find(actor => actor.id === id)).filter(Boolean);
  const pcs = participants.filter(actor => actor.side === 'party');
  if (pcs.length < 2) return false;
  if (battle.combatKind === 'pvp') return true;
  // Legacy saves without combatKind: only PvP when no hostiles were ever in the order.
  return !participants.some(actor => actor.side === 'hostile');
}

export function pvpParticipants(battle) {
  if (!battle?.round) return [];
  return battle.order.map(id => battle.actors.find(actor => actor.id === id))
    .filter(actor => actor && actor.side === 'party' && !actor.dead);
}

export function truceReady(battle) {
  const votes = battle.truceVotes ?? {};
  const pcs = pvpParticipants(battle);
  return pcs.length >= 2 && pcs.every(actor => votes[actor.id]);
}
