/** Cragmaw kennel (area 021): tether rock, Animal Handling, free / befriend, alert east den. */

import { actorIsUp, canStand, d20, distanceFt, joinInitiative, log, occupies, keyAt, previewMovement } from "./combat.mjs";
import { actorCells } from "./actor-space.mjs";
import { regionCells } from "./encounters.mjs";
import { mapFloor } from "./map-walls.mjs";
import { syncRewardSheets } from "./world-interactions.mjs";
import { normalizeFeature, markerFromFeature, setFeatureState, syncMarkerForFeature } from "./room-features.mjs";
import { actorPartyId } from "./parties.mjs";
import { engageEnemy } from "./exploration.mjs";
import { withActionEvent, recordAction } from "./action-events.mjs";

export const KENNEL_REGION = "021";
export const ALERT_REGION = "034"; // Goblin den east of the kennel
/** Stable id kept for saves; visual is the tether rock. */
export const POLE_ID = "LMoP|1ab|021|chain-pole";
export const ROCK_ASSET = "assets/kennel/tether-rock.png";
/**
 * Board layout stamp.
 * 1 = hitch/pack one square west of the old rock-art cell (intended).
 * 2 = mistaken second west shift from an earlier version bump — corrected in 3.
 * 3 = restored intended cell; never west-shift again.
 */
export const KENNEL_LAYOUT = 3;
export const CALM_DC = 15;
export const MEAT_NAME = "Scrap meat";
export const MEAT_COST_SP = 2;
export const FOLLOW_DISTANCE_FT = 15;

const fail = (message) => { throw new Error(message); };

export function isCragmawHideout(map) {
  return map?.module === "LMoP" && map?.id === "1ab";
}

export function kennelStory(battle) {
  battle.story ??= { visited: [], rescued: false };
  battle.story.kennel ??= {
    calmed: false,
    agitated: false,
    freed: false,
    befriended: false,
    alerted: false,
    betrayed: false,
    layout: 0,
  };
  return battle.story.kennel;
}

function canSeatKennel(map, battle, x, y, occupied = null) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (occupied?.has(keyAt(x, y))) return false;
  if (battle.terrain?.[keyAt(x, y)] === "wall") return false;
  return mapFloor(map, x, y, battle);
}

/** Apply the one-time kennel hitch offset; never stack west shifts on version bumps. */
function applyKennelLayout(map, battle, rock) {
  if (!rock || !Number.isInteger(rock.x) || !Number.isInteger(rock.y)) return;
  const story = kennelStory(battle);
  const current = Math.max(Number(story.layout) || 0, Number(rock.layout) || 0);
  if (current >= KENNEL_LAYOUT) {
    story.layout = KENNEL_LAYOUT;
    rock.layout = KENNEL_LAYOUT;
    return;
  }
  if (current < 1) {
    // First correction only: one square west of the adventure rock-art cell.
    const next = { x: rock.x - 1, y: rock.y };
    if (canSeatKennel(map, battle, next.x, next.y)) {
      rock.x = next.x;
      rock.y = next.y;
    }
  } else if (current === 2) {
    // Undo the accidental second west shift from KENNEL_LAYOUT=2.
    const next = { x: rock.x + 1, y: rock.y };
    if (canSeatKennel(map, battle, next.x, next.y)) {
      rock.x = next.x;
      rock.y = next.y;
    }
  }
  story.layout = KENNEL_LAYOUT;
  rock.layout = KENNEL_LAYOUT;
}

export function isKennelWolf(actor) {
  return Boolean(actor && (actor.kennelWolf || (actor.origin === KENNEL_REGION && /wolf/i.test(actor.statName || actor.name || ""))));
}

export function kennelWolves(battle) {
  return (battle.actors ?? []).filter((actor) => isKennelWolf(actor) && !actor.dead && actor.hp > 0);
}

function skillModifier(actor, skill) {
  const key = String(skill || "").toLowerCase().replace(/\s+/g, "");
  const bonus = actor.skillBonuses?.[key] ?? actor.skillBonuses?.["animal handling"];
  if (Number.isFinite(bonus)) return bonus;
  if (Number.isFinite(actor.skillBonuses?.["animalhandling"])) return actor.skillBonuses.animalhandling;
  return actor.ability?.wis ?? 0;
}

function copperOf(currency = {}) {
  return (Number(currency.cp) || 0)
    + (Number(currency.sp) || 0) * 10
    + (Number(currency.ep) || 0) * 50
    + (Number(currency.gp) || 0) * 100
    + (Number(currency.pp) || 0) * 1000;
}

function spendCopper(actor, copper) {
  actor.currency ??= {};
  let left = copperOf(actor.currency);
  if (left < copper) fail("You need " + MEAT_COST_SP + " sp for scrap meat.");
  left -= copper;
  const next = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  next.pp = Math.floor(left / 1000); left %= 1000;
  next.gp = Math.floor(left / 100); left %= 100;
  next.ep = Math.floor(left / 50); left %= 50;
  next.sp = Math.floor(left / 10); left %= 10;
  next.cp = left;
  actor.currency = next;
}

export function hasScrapMeat(actor) {
  return (actor.items ?? []).some((item) => String(item.name).toLowerCase().includes("scrap meat") && (item.quantity ?? 1) > 0);
}

function takeMeat(battle, actor) {
  const item = (actor.items ?? []).find((entry) => String(entry.name).toLowerCase().includes("scrap meat") && (entry.quantity ?? 1) > 0);
  if (!item) return false;
  item.quantity = (item.quantity ?? 1) - 1;
  if (item.quantity <= 0) actor.items = actor.items.filter((entry) => entry !== item);
  syncRewardSheets(battle);
  return true;
}

function nearKennel(actor, battle, map, reach = 10) {
  if (!occupies(actor)) return false;
  const rock = kennelPole(battle);
  if (rock && Number.isInteger(rock.x) && distanceFt(actor, rock) <= reach) return true;
  return kennelWolves(battle).some((wolf) => occupies(wolf) && distanceFt(actor, wolf) <= reach);
}

export function kennelPole(battle) {
  return (battle.features ?? []).find((feature) => feature.id === POLE_ID)
    ?? (battle.markers ?? []).find((marker) => marker.id === POLE_ID || marker.visual === "rock" || marker.visual === "pole" || marker.type === "rock" || marker.type === "pole");
}

function markWolvesChained(battle) {
  for (const wolf of kennelWolves(battle)) {
    wolf.kennelWolf = true;
    wolf.origin ??= KENNEL_REGION;
    if (wolf.side === "party" || wolf.kennelAlly) continue;
    if (!kennelStory(battle).freed) {
      wolf.chained = true;
      if (wolf.side !== "hostile") wolf.side = "neutral";
    }
  }
}

function placePoleInKennel(map, battle) {
  const region = map.regions?.find((entry) => (entry.key ?? entry.id) === KENNEL_REGION || entry.id === KENNEL_REGION);
  if (!region) return null;
  const cells = regionCells(map, region).filter((cell) => mapFloor(map, cell.x, cell.y, battle) && battle.terrain?.[keyAt(cell.x, cell.y)] !== "wall");
  if (!cells.length) return null;
  const wolves = kennelWolves(battle).filter(occupies);
  // Prefer a free square near the pack centroid so ropes read clearly.
  let target = cells[0];
  if (wolves.length) {
    const cx = wolves.reduce((n, wolf) => n + wolf.x, 0) / wolves.length;
    const cy = wolves.reduce((n, wolf) => n + wolf.y, 0) / wolves.length;
    const occupied = new Set(battle.actors.filter(occupies).flatMap((actor) => actorCells(actor).map((cell) => keyAt(cell.x, cell.y))));
    target = cells
      .filter((cell) => !occupied.has(keyAt(cell.x, cell.y)))
      .sort((a, b) => (Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)))[0]
      ?? cells.sort((a, b) => (Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)))[0];
  }
  return target;
}

const WOLF_OFFSETS = [
  { x: -1, y: 0 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
];

/** Seat chained wolves around the tether rock so ropes converge on its center. */
function placeWolvesAroundRock(map, battle, rock) {
  if (!rock || !Number.isInteger(rock.x) || !Number.isInteger(rock.y)) return;
  const wolves = kennelWolves(battle).filter((wolf) => occupies(wolf) && wolf.chained && !wolf.kennelAlly);
  if (!wolves.length) return;
  const occupied = new Set(
    battle.actors
      .filter((actor) => occupies(actor) && !wolves.includes(actor))
      .flatMap((actor) => actorCells(actor).map((cell) => keyAt(cell.x, cell.y))),
  );
  occupied.add(keyAt(rock.x, rock.y));
  const region = map.regions?.find((entry) => (entry.key ?? entry.id) === KENNEL_REGION || entry.id === KENNEL_REGION);
  const floor = region
    ? new Set(regionCells(map, region).filter((cell) => mapFloor(map, cell.x, cell.y, battle)).map((cell) => keyAt(cell.x, cell.y)))
    : null;

  wolves.forEach((wolf, index) => {
    const preferred = WOLF_OFFSETS[index % WOLF_OFFSETS.length];
    const candidates = [
      preferred,
      { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: -1 }, { x: -1, y: 1 },
      { x: 2, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 },
    ];
    for (const offset of candidates) {
      const x = rock.x + offset.x;
      const y = rock.y + offset.y;
      const key = keyAt(x, y);
      if (occupied.has(key)) continue;
      if (floor && !floor.has(key)) continue;
      if (battle.terrain?.[key] === "wall") continue;
      if (!mapFloor(map, x, y, battle)) continue;
      wolf.x = x;
      wolf.y = y;
      occupied.add(key);
      return;
    }
  });
}

function rockVisualFields(target = {}) {
  target.visual = "rock";
  target.type = "rock";
  // Rope anchor only — strip any leftover rock PNG / crate pip.
  delete target.image;
  target.hidden = true;
  target.revealed = true;
  target.name = "Kennel ropes";
  return target;
}

/** Seed invisible tether + chain state after the hideout scene populates. */
export function seedKennelWolves(map, battle) {
  if (!isCragmawHideout(map)) return;
  kennelStory(battle);
  markWolvesChained(battle);
  battle.features ??= [];
  battle.markers ??= [];
  const existingPole = battle.features.find((feature) => feature.id === POLE_ID);
  if (existingPole) {
    rockVisualFields(existingPole);
    if (!Number.isInteger(existingPole.x)) {
      const cell = placePoleInKennel(map, battle);
      if (cell) Object.assign(existingPole, cell);
    }
    applyKennelLayout(map, battle, existingPole);
    placeWolvesAroundRock(map, battle, existingPole);
    syncPoleMarker(battle);
    return;
  }
  const cell = placePoleInKennel(map, battle);
  const feature = normalizeFeature(rockVisualFields({
    id: POLE_ID,
    regionId: KENNEL_REGION,
    kind: "mechanism",
    name: "Kennel ropes",
    state: "revealed",
    surfaceText: "Short ropes ring a scarred hitch. Three wolves strain against the rings.",
    truthText: "The kennel ropes hold the pack. Calm them, free them, or leave them tethered.",
    x: cell?.x,
    y: cell?.y,
    outcomes: [{ on: "use", effect: "log", text: "The ropes creak on the hitch." }],
  }), { moduleId: "LMoP", mapKey: "1ab", regionId: KENNEL_REGION });
  battle.features.push(feature);
  applyKennelLayout(map, battle, feature);
  placeWolvesAroundRock(map, battle, feature);
  syncPoleMarker(battle);
}

function syncPoleMarker(battle) {
  const feature = battle.features?.find((entry) => entry.id === POLE_ID);
  if (!feature) return;
  rockVisualFields(feature);
  const story = kennelStory(battle);
  if (story.betrayed) {
    feature.surfaceText = "The pack snarls at the rock, trust broken.";
    feature.truthText = "Attacking the pack broke the bond. The wolves fight as enemies.";
  } else if (story.freed && story.befriended) {
    feature.surfaceText = "Loose ropes hang from the rock. The pack stays close.";
    feature.truthText = "The pack is free and loyal.";
  } else if (story.freed) {
    feature.surfaceText = "An empty rock. The ropes hang loose.";
    feature.truthText = "The kennel ropes have been opened.";
    setFeatureState(feature, "resolved");
  } else if (story.befriended) {
    feature.surfaceText = "The wolves wait by the rock, watching the party.";
    feature.truthText = "The pack trusts you. They follow and fight as allies — AI-controlled.";
  } else if (story.calmed) {
    feature.surfaceText = "The wolves lie quiet by the rock, ears soft.";
    feature.truthText = "The pack is calm. You could free them or try to befriend them.";
  } else if (story.agitated) {
    feature.surfaceText = "The wolves snarl at the ropes, ready to lunge.";
    feature.truthText = "The pack is agitated. Getting close may provoke an attack.";
  } else {
    feature.surfaceText = "A scarred rock anchors short ropes. Three wolves strain against the rings.";
    feature.truthText = "The kennel rock holds the pack. Calm them, free them, or leave them tethered.";
  }
  const board = markerFromFeature(feature);
  rockVisualFields(board);
  board.hinted = false;
  const existing = battle.markers?.find((marker) => marker.id === POLE_ID);
  if (existing) Object.assign(existing, board, { x: feature.x, y: feature.y });
  else {
    battle.markers ??= [];
    battle.markers.push({ ...board, x: feature.x, y: feature.y });
  }
  syncMarkerForFeature(battle, feature);
  const marker = battle.markers.find((entry) => entry.id === POLE_ID || entry.featureId === POLE_ID);
  if (marker) {
    rockVisualFields(marker);
    // Keep an invisible rope anchor in markers; never show a board pip.
    marker.hidden = true;
    marker.revealed = true;
    delete marker.image;
  }
}

function kennelToast(key, name, text) {
  return { key, name, entries: [text] };
}

/** Contextual actions near the kennel rock / pack. */
export function kennelActions(battle, map, actor) {
  if (!isCragmawHideout(map) || !actorIsUp(actor) || actor.side !== "party" || actor.kennelAlly || battle.round) return [];
  if (!nearKennel(actor, battle, map)) return [];
  const story = kennelStory(battle);
  const wolves = kennelWolves(battle);
  if (!wolves.length && story.freed) return [];
  const actions = [];
  if (!story.calmed && !story.freed && !story.betrayed && wolves.some((wolf) => wolf.chained)) {
    actions.push({ id: "kennel-calm", label: "Calm the wolves (Animal Handling)" });
    if (hasScrapMeat(actor)) {
      actions.push({ id: "kennel-calm-meat", label: "Offer scrap meat (adv. Animal Handling)" });
    }
  }
  if (!story.freed && wolves.some((wolf) => wolf.chained)) {
    actions.push({ id: "kennel-free", label: "Free the wolves" });
  }
  if (story.calmed && !story.befriended && !story.betrayed && wolves.length) {
    actions.push({ id: "kennel-pet", label: "Pet / befriend the wolves" });
  }
  return actions;
}

export function alertEastDen(battle, map) {
  const story = kennelStory(battle);
  if (story.alerted) return;
  story.alerted = true;
  let counted = 0;
  for (const goblin of battle.actors.filter((actor) =>
    actor.origin === ALERT_REGION && actor.side !== "party" && !actor.dead && actor.hp > 0)) {
    goblin.side = "hostile";
    goblin.alerted = true;
    counted += 1;
  }
  log(battle, counted
    ? "Barking echoes east. Goblins in the den shout and take up weapons."
    : "The wolves' barking carries into the eastern chamber.");
}

function setWolvesHostile(battle) {
  for (const wolf of kennelWolves(battle)) {
    if (wolf.kennelAlly) continue;
    wolf.side = "hostile";
    wolf.chained = Boolean(wolf.chained);
  }
}

function fleeWolves(battle, map) {
  for (const wolf of kennelWolves(battle)) {
    wolf.chained = false;
    wolf.x = null;
    wolf.y = null;
    wolf.fled = true;
    wolf.side = "neutral";
  }
  log(battle, "The freed wolves bolt into the dark tunnels and are gone.");
}

function befriendWolves(battle, actor) {
  const partyId = actorPartyId(actor);
  for (const wolf of kennelWolves(battle)) {
    wolf.chained = false;
    wolf.side = "party";
    wolf.partyId = partyId;
    wolf.kennelAlly = true;
    wolf.kennelWolf = true;
    // Allies auto-act via AI; never claimable as a player slot.
    delete wolf.resolveDeath;
    if (battle.controllers) delete battle.controllers[wolf.id];
  }
  kennelStory(battle).befriended = true;
  kennelStory(battle).calmed = true;
  log(battle, actor.name + " wins the pack's trust. The wolves follow and fight beside the party.");
}

/**
 * Animal Handling to calm the pack. Meat grants advantage and is consumed on the attempt.
 * Failure agitates the wolves and alerts the goblin den to the east (034).
 * Always records a visible action/dice event like combat checks.
 */
export function calmKennelWolves(battle, map, actor, { useMeat = false, random = Math.random } = {}) {
  if (!nearKennel(actor, battle, map)) fail("Move closer to the kennel first.");
  const story = kennelStory(battle);
  if (story.calmed) fail("The wolves are already calm.");
  if (story.freed) fail("The wolves are no longer tethered here.");
  if (story.betrayed) fail("The pack will not trust you again.");
  const wolves = kennelWolves(battle).filter((wolf) => wolf.chained);
  if (!wolves.length) fail("There are no tethered wolves left to calm.");

  return withActionEvent(battle, actor, {
    action: "Animal Handling",
    kind: "check",
    target: "Kennel wolves",
  }, () => {
    let advantage = false;
    if (useMeat) {
      if (!takeMeat(battle, actor)) fail("You need scrap meat to offer.");
      advantage = true;
      log(battle, actor.name + " offers scrap meat to the pack.");
    }

    const modifier = skillModifier(actor, "animal handling");
    const roll = d20(modifier, { advantage, random, label: "Animal Handling" });
    log(battle, actor.name + " Animal Handling (DC " + CALM_DC + ")" + (advantage ? " with advantage" : "")
      + " — " + roll.breakdown + " = " + roll.total + ".");

    if (roll.total >= CALM_DC) {
      story.calmed = true;
      story.agitated = false;
      for (const wolf of wolves) {
        wolf.side = "neutral";
        wolf.calmed = true;
      }
      syncPoleMarker(battle);
      const status = "Success — the wolves ease against the ropes, ears soft. The pack is calm.";
      log(battle, status);
      recordAction(battle, actor, {
        outcome: "Success",
        total: roll.total,
        dc: CALM_DC,
        messages: [status],
      });
      return {
        success: true,
        status,
        toast: kennelToast("kennel-calm-ok", "Wolves calmed", status),
        roll,
      };
    }

    story.agitated = true;
    alertEastDen(battle, map);
    syncPoleMarker(battle);
    const status = "Fail — the wolves snap and howl! Barking carries east — the den is alerted.";
    log(battle, status);
    recordAction(battle, actor, {
      outcome: "Fail",
      total: roll.total,
      dc: CALM_DC,
      messages: [status],
    });
    return {
      success: false,
      status,
      toast: kennelToast("kennel-calm-fail", "Pack agitated", status),
      roll,
      engage: false,
    };
  });
}

/** Open the ropes. Calm pack flees; agitated/uncalmed pack attacks and alerts the den. */
export function freeKennelWolves(battle, map, actor, random = Math.random) {
  if (!nearKennel(actor, battle, map, 5)) fail("Move within 5 feet of the rock or wolves to free them.");
  const story = kennelStory(battle);
  if (story.freed) fail("The ropes are already open.");
  const wolves = kennelWolves(battle).filter((wolf) => wolf.chained);
  if (!wolves.length) fail("No wolves remain on the ropes.");

  return withActionEvent(battle, actor, {
    action: "Free the wolves",
    kind: "ability",
    target: "Kennel rock",
  }, () => {
    story.freed = true;
    for (const wolf of wolves) wolf.chained = false;
    syncPoleMarker(battle);

    if (story.befriended) {
      const status = "You open the ropes. The pack stays close, still loyal.";
      log(battle, actor.name + " opens the ropes. The pack stays close, still loyal.");
      recordAction(battle, actor, { outcome: "Freed", messages: [status] });
      return { status, toast: kennelToast("kennel-free-ally", "Pack freed", status), engage: false };
    }

    if (story.calmed) {
      fleeWolves(battle, map);
      const status = "You free the calm wolves. They flee into the caves.";
      recordAction(battle, actor, { outcome: "Freed", messages: [status] });
      return { status, toast: kennelToast("kennel-free-flee", "Wolves flee", status), engage: false };
    }

    story.agitated = true;
    setWolvesHostile(battle);
    alertEastDen(battle, map);
    log(battle, actor.name + " frees the snarling pack — they turn on the party!");
    const foe = wolves.find((wolf) => occupies(wolf));
    const engaged = foe ? engageEnemy(battle, map, actor, foe, true, random) : false;
    const status = engaged || "The freed wolves attack!";
    recordAction(battle, actor, { outcome: "Hostile", messages: [status] });
    return {
      status,
      toast: kennelToast("kennel-free-attack", "Pack turns!", status),
      engage: Boolean(engaged),
    };
  });
}

/** Pet a calm pack to bind them as AI-controlled combat allies. */
export function petKennelWolves(battle, map, actor) {
  if (!nearKennel(actor, battle, map)) fail("Move closer to the wolves first.");
  const story = kennelStory(battle);
  if (story.betrayed) fail("The pack will not trust you again.");
  if (!story.calmed) fail("Calm the wolves before trying to befriend them.");
  if (story.befriended) fail("The pack already trusts you.");
  const wolves = kennelWolves(battle);
  if (!wolves.length) fail("No wolves remain to befriend.");

  return withActionEvent(battle, actor, {
    action: "Befriend the pack",
    kind: "ability",
    target: "Kennel wolves",
  }, () => {
    befriendWolves(battle, actor);
    syncPoleMarker(battle);
    const status = "The wolves lean into your hand. They will follow and fight for you — the pack acts on its own.";
    recordAction(battle, actor, { outcome: "Bonded", messages: [status] });
    return {
      status,
      toast: kennelToast("kennel-pet", "Pack bonded", status),
    };
  });
}

/**
 * Party damage against a befriended wolf permanently breaks the bond.
 * The whole pack turns hostile and attacks.
 */
export function betrayKennelPack(battle, map, attacker, victim, random = Math.random) {
  if (!victim?.kennelAlly || !isKennelWolf(victim)) return null;
  if (!attacker || attacker.side !== "party" || attacker.kennelAlly) return null;
  const story = kennelStory(battle);
  if (story.betrayed) return null;

  story.betrayed = true;
  story.befriended = false;
  story.calmed = false;
  story.agitated = true;
  const pack = kennelWolves(battle);
  for (const wolf of pack) {
    wolf.kennelAlly = false;
    wolf.chained = false;
    wolf.side = "hostile";
    delete wolf.partyId;
    if (battle.controllers) delete battle.controllers[wolf.id];
  }
  alertEastDen(battle, map);
  syncPoleMarker(battle);
  const status = "The pack's trust is broken! The wolves snarl and turn on the party.";
  log(battle, status);
  const foe = pack.find((wolf) => occupies(wolf)) ?? victim;
  let engaged = false;
  if (!battle.round && occupies(attacker) && occupies(foe)) {
    engaged = Boolean(engageEnemy(battle, map, attacker, foe, true, random));
  } else if (battle.round) {
    for (const wolf of pack.filter((entry) => occupies(entry) && actorIsUp(entry))) {
      joinInitiative(battle, wolf, random);
    }
  }
  return {
    status,
    toast: kennelToast("kennel-betray", "Bond broken", status),
    engage: engaged,
  };
}

/**
 * Keep befriended wolves near their party leader while exploring.
 * Skips combat — AI turns handle combat positioning.
 */
export function followKennelAllies(battle, map, leader) {
  if (!isCragmawHideout(map) || battle.round || !occupies(leader) || leader.side !== "party" || leader.kennelAlly) return [];
  if (!kennelStory(battle).befriended) return [];
  const partyId = actorPartyId(leader);
  const moved = [];
  for (const wolf of kennelWolves(battle).filter((entry) =>
    entry.kennelAlly && entry.side === "party" && actorPartyId(entry) === partyId && occupies(entry) && actorIsUp(entry))) {
    if (distanceFt(wolf, leader) <= FOLLOW_DISTANCE_FT) continue;
    const goal = bestFollowSquare(battle, map, wolf, leader);
    if (!goal || (goal.x === wolf.x && goal.y === wolf.y)) continue;
    const path = previewMovement(battle, wolf, goal.x, goal.y, map);
    let landed = null;
    if (path?.path?.length) {
      // Take a short leash step — stay near without teleporting across the map.
      const budget = Math.min(40, path.cost || 40);
      for (const step of path.path) {
        if (step.cost > budget) break;
        if (battle.actors.some((other) => other.id !== wolf.id && occupies(other) && other.x === step.x && other.y === step.y)) continue;
        landed = step;
      }
    }
    // Exploration fallback when pathing lacks floor/walls data: step onto a free follow square.
    if (!landed && canStand(battle, wolf, goal.x, goal.y, map) && distanceFt(wolf, goal) <= 40) {
      landed = goal;
    }
    if (!landed) continue;
    wolf.x = landed.x;
    wolf.y = landed.y;
    moved.push(wolf);
  }
  if (moved.length) log(battle, moved.map((wolf) => wolf.name).join(", ") + " pad after the party.");
  return moved;
}

function bestFollowSquare(battle, map, wolf, leader) {
  const slots = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const cell = { x: leader.x + dx, y: leader.y + dy };
      if (!canStand(battle, wolf, cell.x, cell.y, map)) continue;
      slots.push({ ...cell, dist: distanceFt(cell, leader) + distanceFt(cell, wolf) * 0.01 });
    }
  }
  slots.sort((a, b) => a.dist - b.dist);
  return slots[0] ?? null;
}

/** Buy scrap meat from Durnan in the Yawning Portal (2 sp). */
export function buyScrapMeat(battle, actor) {
  spendCopper(actor, MEAT_COST_SP * 10);
  actor.items ??= [];
  const existing = actor.items.find((item) => String(item.name).toLowerCase() === MEAT_NAME.toLowerCase());
  if (existing) existing.quantity = (existing.quantity ?? 1) + 1;
  else actor.items.push({
    name: MEAT_NAME,
    quantity: 1,
    weight: 1,
    notes: "Fresh scraps from the Yawning Portal kitchen. Advantage when calming beasts.",
  });
  syncRewardSheets(battle);
  log(battle, actor.name + " buys scrap meat for " + MEAT_COST_SP + " sp.");
  return { status: "Bought scrap meat (" + MEAT_COST_SP + " sp). Useful for calming animals." };
}

/**
 * If the pack is agitated and a hero steps close, the wolves attack (still on ropes).
 * @returns {string|false} engage reason
 */
export function checkKennelApproach(battle, map, actor, random = Math.random) {
  if (!isCragmawHideout(map) || !actor || actor.side !== "party" || actor.kennelAlly || battle.round) return false;
  const story = kennelStory(battle);
  if (!story.agitated || story.calmed || story.befriended) return false;
  const wolves = kennelWolves(battle).filter((wolf) => occupies(wolf) && !wolf.kennelAlly);
  const near = wolves.find((wolf) => distanceFt(actor, wolf) <= 10);
  if (!near) return false;
  setWolvesHostile(battle);
  alertEastDen(battle, map);
  return engageEnemy(battle, map, actor, near, true, random);
}

/** Pull alerted den goblins into an open fight. */
export function pullAlertedDen(battle, map, random = Math.random) {
  if (!kennelStory(battle).alerted || !battle.round) return;
  for (const goblin of battle.actors.filter((actor) =>
    actor.origin === ALERT_REGION && actor.side === "hostile" && actorIsUp(actor) && occupies(actor))) {
    joinInitiative(battle, goblin, random);
  }
}

export function runKennelAction(actionId, battle, map, actor, random = Math.random) {
  if (actionId === "kennel-calm") return calmKennelWolves(battle, map, actor, { useMeat: false, random });
  if (actionId === "kennel-calm-meat") return calmKennelWolves(battle, map, actor, { useMeat: true, random });
  if (actionId === "kennel-free") return freeKennelWolves(battle, map, actor, random);
  if (actionId === "kennel-pet") return petKennelWolves(battle, map, actor);
  return null;
}
