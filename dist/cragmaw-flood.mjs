/** Cragmaw Hideout flood: lookout spots the party → signals twin pools → surge. */

import { regionCells } from "./encounters.mjs";
import { mapFloor } from "./map-walls.mjs";
import {
  actorIsUp,
  applyDamage,
  canSee,
  canStand,
  condition,
  distanceFt,
  keyAt,
  log,
  occupies,
  placeToken,
  rollDice,
  savingThrow,
} from "./combat.mjs";
import { actorCells } from "./actor-space.mjs";
import { recordAction, withActionEvent } from "./action-events.mjs";
import { setFeatureState, syncMarkerForFeature } from "./room-features.mjs";
import { spellVisualEvent } from "./spell-animation-library.mjs";
import { inSight } from "./exploration.mjs";

export const FLOOD_LEVER_ID = "LMoP|1ab|029|flood-lever";
export const LOOKOUT_REGION = "029";
/** Stream / approach passage that the dam empties through. */
export const FLOOD_REGION = "025";
export const FLOOD_DOWNSTREAM_REGION = "02f";
export const FLOOD_SAVE_DC = 10;
export const FLOOD_SWEEP_FT = 40;
export const FLOOD_DAMAGE = "1d6";
/** Lookout perch overlooks the approach — longer watch than a normal goblin scrap. */
export const LOOKOUT_SIGHT_FT = 90;

const FLOOD_VISUAL = Object.freeze({
  url: "/assets/animations/blfx-tidal-wave.webm",
  kind: "burst",
  scale: 2.2,
  duration: 2800,
  diameter: 6,
});

export function isCragmawHideout(map) {
  return map?.module === "LMoP" && map?.id === "1ab";
}

export function floodStory(battle) {
  battle.story ??= { visited: [], rescued: false };
  battle.story.flood ??= {
    released: false,
    at: null,
  };
  return battle.story.flood;
}

function regionById(map, id) {
  return map?.regions?.find((entry) => (entry.key ?? entry.id) === id || entry.id === id) ?? null;
}

function floorCells(map, battle, region) {
  if (!region) return [];
  return regionCells(map, region).filter((cell) =>
    mapFloor(map, cell.x, cell.y, battle) && battle.terrain?.[keyAt(cell.x, cell.y)] !== "wall");
}

function centroid(cells) {
  if (!cells.length) return null;
  return {
    x: Math.round(cells.reduce((n, cell) => n + cell.x, 0) / cells.length),
    y: Math.round(cells.reduce((n, cell) => n + cell.y, 0) / cells.length),
  };
}

/** Passage floor cells that become rushing water. */
export function floodCells(map, battle) {
  return floorCells(map, battle, regionById(map, FLOOD_REGION));
}

function sweepGoal(map, battle, from) {
  const downstream = floorCells(map, battle, regionById(map, FLOOD_DOWNSTREAM_REGION));
  const target = centroid(downstream) ?? (() => {
    const passage = floodCells(map, battle);
    if (!passage.length) return null;
    // Prefer the easternmost passage cell when the den region is missing.
    return passage.slice().sort((a, b) => (b.x - a.x) || (a.y - b.y))[0];
  })();
  if (!target) return null;
  const steps = Math.max(1, Math.round(FLOOD_SWEEP_FT / 5));
  let x = from.x;
  let y = from.y;
  let last = { x, y };
  for (let i = 0; i < steps; i++) {
    const dx = Math.sign(target.x - x);
    const dy = Math.sign(target.y - y);
    const candidates = [
      { x: x + dx, y: y + dy },
      { x: x + dx, y },
      { x, y: y + dy },
    ].filter((cell) => Number.isInteger(cell.x) && Number.isInteger(cell.y));
    let moved = false;
    for (const cell of candidates) {
      if (!mapFloor(map, cell.x, cell.y, battle)) continue;
      if (battle.terrain?.[keyAt(cell.x, cell.y)] === "wall") continue;
      x = cell.x;
      y = cell.y;
      last = { x, y };
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return last;
}

function paintFloodTerrain(battle, cells) {
  battle.terrain ??= {};
  for (const cell of cells) {
    const key = keyAt(cell.x, cell.y);
    if (battle.terrain[key] === "wall") continue;
    battle.terrain[key] = "water";
  }
}

function actorsInFlood(battle, cells) {
  const keys = new Set(cells.map((cell) => keyAt(cell.x, cell.y)));
  return (battle.actors ?? []).filter((actor) =>
    occupies(actor) && actorIsUp(actor) &&
    actorCells(actor).some((cell) => keys.has(keyAt(cell.x, cell.y))));
}

function floodToast(text) {
  return { key: "cragmaw-flood", name: "Flood!", entries: [text] };
}

/**
 * Release the twin-pools dam. Paints water, plays surge FX, forces Str saves,
 * and sweeps failures downstream.
 */
export function releaseCragmawFlood(battle, map, sourceActor, random = Math.random) {
  if (!isCragmawHideout(map) || !battle) return null;
  const story = floodStory(battle);
  if (story.released) {
    return { already: true, status: "The passage is already flooded.", toast: null };
  }
  const cells = floodCells(map, battle);
  if (!cells.length) {
    log(battle, "The dam breaks, but no clear passage cells are marked for the flood.");
    story.released = true;
    story.at = Date.now();
    return { already: false, status: "Flood released, but the corridor could not be painted.", toast: floodToast("The dam gives way.") };
  }

  const center = centroid(cells);
  const caster = sourceActor || (battle.actors ?? []).find((actor) => occupies(actor)) || { x: center.x, y: center.y, name: "Flood" };
  const lever = (battle.features ?? []).find((feature) => feature.id === FLOOD_LEVER_ID);
  if (lever) {
    setFeatureState(lever, "triggered");
    syncMarkerForFeature(battle, lever);
  }

  return withActionEvent(battle, caster, {
    action: "Flood surge",
    kind: "hazard",
    target: "Cragmaw passage",
    ...spellVisualEvent(FLOOD_VISUAL, caster, center, { square: center, diameter: 8 }),
  }, () => {
    paintFloodTerrain(battle, cells);
    story.released = true;
    story.at = Date.now();
    log(battle, "A roar shakes the caves — the twin pools dam bursts and water floods the passage!");

    const swept = [];
    const held = [];
    for (const actor of actorsInFlood(battle, cells)) {
      const save = savingThrow(actor, "str", { random });
      log(battle, actor.name + " Strength save (DC " + FLOOD_SAVE_DC + ") — " + save.breakdown + " = " + save.total + ".");
      if (save.total >= FLOOD_SAVE_DC) {
        held.push(actor.name);
        continue;
      }
      const damage = rollDice(FLOOD_DAMAGE, { random, label: "flood bludgeoning" });
      applyDamage(battle, actor, damage.total, "bludgeoning", false, random, "Flood");
      const goal = sweepGoal(map, battle, actor);
      if (goal && (goal.x !== actor.x || goal.y !== actor.y)) {
        if (canStand(battle, actor, goal.x, goal.y, map)) {
          placeToken(battle, actor, goal.x, goal.y, map);
        } else {
          // Nudge to nearest free floor near the sweep end.
          const nearby = [
            goal,
            { x: goal.x - 1, y: goal.y }, { x: goal.x + 1, y: goal.y },
            { x: goal.x, y: goal.y - 1 }, { x: goal.x, y: goal.y + 1 },
          ];
          const land = nearby.find((cell) => canStand(battle, actor, cell.x, cell.y, map));
          if (land) placeToken(battle, actor, land.x, land.y, map);
        }
      }
      actor.prone = true;
      swept.push(actor.name);
      recordAction(battle, actor, {
        action: "Swept by flood",
        kind: "hazard",
        target: actor.name,
        messages: [actor.name + " is swept downstream and knocked prone."],
      });
    }

    let status = "The passage floods with rushing water.";
    if (swept.length) status += " Swept: " + swept.join(", ") + ".";
    if (held.length) status += " Held footing: " + held.join(", ") + ".";
    log(battle, status);
    return {
      already: false,
      status,
      toast: floodToast(status),
      cells: cells.length,
      swept,
      held,
    };
  });
}

export function isLookoutGoblin(actor) {
  if (!actor || actor.dead || !actorIsUp(actor) || !occupies(actor)) return false;
  if (actor.side === "party" || actor.kennelAlly) return false;
  return actor.origin === LOOKOUT_REGION || /lookout/i.test(actor.name || "");
}

function lookoutSeesHero(battle, map, lookout, hero) {
  if (!hero || hero.side !== "party" || !occupies(hero) || !actorIsUp(hero)) return false;
  if (condition(hero, "Invisible")) return distanceFt(lookout, hero) <= 5;
  const range = Number(lookout.sight) > 0 ? lookout.sight : LOOKOUT_SIGHT_FT;
  if (inSight(battle, map, lookout, hero, range)) return true;
  // Fallback when region adjacency is picky but the ray is clear.
  return distanceFt(lookout, hero) <= range && canSee(battle, lookout, hero, map);
}

export function lookoutWatchers(battle) {
  return (battle.actors ?? []).filter(isLookoutGoblin);
}

/**
 * When a lookout goblin spots the party, he signals the twin pools and the dam breaks.
 * Call during exploration movement (same beat as kennel approach checks).
 */
export function checkLookoutFlood(battle, map, mover, random = Math.random) {
  if (!isCragmawHideout(map) || !battle || floodStory(battle).released) return null;
  if (battle.round) return null;
  const heroes = (battle.actors ?? []).filter((actor) =>
    actor.side === "party" && occupies(actor) && actorIsUp(actor));
  if (!heroes.length) return null;
  const focus = mover && heroes.includes(mover) ? [mover, ...heroes.filter((h) => h !== mover)] : heroes;
  const lookout = lookoutWatchers(battle).find((watcher) =>
    focus.some((hero) => lookoutSeesHero(battle, map, watcher, hero)));
  if (!lookout) return null;

  if (lookout.side !== "hostile") lookout.side = "hostile";
  lookout.sight ??= LOOKOUT_SIGHT_FT;

  log(battle, lookout.name + " spots the party and signals the twin pools!");
  const flood = releaseCragmawFlood(battle, map, lookout, random);
  const spotted = focus.find((hero) => lookoutSeesHero(battle, map, lookout, hero)) ?? mover ?? focus[0];
  return {
    lookout,
    spotted,
    flood,
    status: (flood?.status ? flood.status + " " : "") + lookout.name + " raised the flood signal!",
    toast: flood?.toast ?? {
      key: "cragmaw-flood-signal",
      name: "Lookout!",
      entries: [lookout.name + " sees you and signals the dam."],
    },
  };
}
