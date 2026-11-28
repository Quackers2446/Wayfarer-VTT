/** Authored patrons, ambient barks, and casual table seating for the Yawning Portal. */

import {distanceFt, log, makeActor, occupies} from "./combat.mjs";
import {bestiaryTokenPath} from "./rules-library.mjs";

const YP_FIRST = "/assets/yawning-portal/1st-floor.webp";
const isYpHub = (map) => map?.module === "YPHub";

const COMMONER = bestiaryTokenPath({name: "Commoner", source: "MM"});
const NOBLE = bestiaryTokenPath({name: "Noble", source: "MM"});
const GUARD = bestiaryTokenPath({name: "Guard", source: "MM"});
const VETERAN = bestiaryTokenPath({name: "Veteran", source: "MM"});
const ACOLYTE = bestiaryTokenPath({name: "Acolyte", source: "MM"});

/** Table benches the party can sit at (first floor common room). */
export const HUB_TABLES = [
  {id: "table-east", x: 15, y: 17, label: "Sit at the east table"},
  {id: "table-south", x: 19, y: 19, label: "Sit near the hearth tables"},
];

export const HUB_PATRONS = [
  {
    hubId: "mira",
    name: "Mira",
    x: 14, y: 18,
    statName: "Commoner", source: "MM", tokenArt: COMMONER,
    lines: [
      "\"Fresh boots from Waterdeep. Don't ask where I got the leather.\"",
      "\"If you're heading north, stock up before the trail gets mean.\"",
      "\"Heard a caravan never made Phandalin. Bad omen, that.\"",
    ],
    greet: ["\"Looking to trade, or just warm your hands?\""],
  },
  {
    hubId: "torvin",
    name: "Torvin",
    x: 18, y: 16,
    statName: "Veteran", source: "MM", tokenArt: VETERAN,
    lines: [
      "\"Triboar Trail eats soft feet. Pack iron.\"",
      "\"Durnan's seen worse than goblins. Still—watch the hills.\"",
      "\"Another round, and maybe I'll tell you about the well.\"",
    ],
    greet: ["\"Pull up a chair, if you've earned the dust on those boots.\""],
  },
  {
    hubId: "lirael",
    name: "Lirael",
    x: 9, y: 16,
    statName: "Acolyte", source: "MM", tokenArt: ACOLYTE,
    lines: [
      "\"The well listens. Or so the drunks insist.\"",
      "\"Quiet nights are rarer than honest maps.\"",
      "\"May your road be kinder than your last one.\"",
    ],
    greet: ["\"Peace, traveler. The Portal keeps strange company.\""],
  },
  {
    hubId: "cass",
    name: "Cass",
    x: 22, y: 23,
    statName: "Guard", source: "MM", tokenArt: GUARD,
    lines: [
      "\"Keep your steel sheathed indoors. Durnan's rule.\"",
      "\"Board's got fresh ink. Trouble's hiring again.\"",
      "\"Don't lean over the well. Folks disappear that way.\"",
    ],
    greet: ["\"Door's open. Trouble usually walks in on its own.\""],
  },
  {
    hubId: "pell",
    name: "Pell",
    x: 7, y: 12,
    statName: "Noble", source: "MM", tokenArt: NOBLE,
    lines: [
      "\"Waterdeep's finest, reduced to tavern stew. Charming.\"",
      "\"I once funded an Undermountain delve. Never again.\"",
      "\"If you find Gundren, tell him he still owes me a map.\"",
    ],
    greet: ["\"You're not here for the wine. Nobody is.\""],
  },
];

function ensurePatron(battle, map, spec) {
  let actor = battle.actors.find((entry) => entry.hubId === spec.hubId);
  if (!actor) {
    actor = makeActor({
      name: spec.name,
      side: "neutral",
      creatureType: "humanoid",
      hp: 8,
      maxHp: 8,
      ac: 10,
      initiative: 0,
      dex: 10,
      x: spec.x,
      y: spec.y,
      hubId: spec.hubId,
      hubPatron: true,
      ambientLines: spec.lines,
      greetLines: spec.greet,
      statName: spec.statName,
      source: spec.source,
      tokenArt: spec.tokenArt,
      attacks: [],
    });
    actor.sceneKey = map.key;
    battle.actors.push(actor);
  } else {
    actor.hubPatron = true;
    actor.ambientLines ??= spec.lines;
    actor.greetLines ??= spec.greet;
    actor.statName ??= spec.statName;
    actor.source ??= spec.source;
    actor.tokenArt ??= spec.tokenArt;
    if (actor.x == null) { actor.x = spec.x; actor.y = spec.y; }
  }
  return actor;
}

/** Place authored patrons in the first-floor common room. */
export function seedHubPatrons(map, battle) {
  if (!isYpHub(map) || map.key !== YP_FIRST) return;
  for (const spec of HUB_PATRONS) ensurePatron(battle, map, spec);
  battle.story ??= {visited: [], rescued: false};
  battle.story.hub ??= {};
  battle.story.hub.ambience ??= {nextBark: Date.now() + 5500, lastSpeaker: ""};
}

function pickLine(lines, avoid = "") {
  const choices = (lines ?? []).filter((line) => line && line !== avoid);
  if (!choices.length) return null;
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * Occasional ambient speech from patrons near the party.
 * Returns { actorId, name, lines } or null.
 */
export function tickHubAmbience(battle, map, party = [], now = Date.now()) {
  if (!isYpHub(map) || map.key !== YP_FIRST || battle.round) return null;
  seedHubPatrons(map, battle);
  const ambience = battle.story.hub.ambience;
  if (now < (ambience.nextBark ?? 0)) return null;

  const heroes = party.filter((actor) => actor.side === "party" && occupies(actor));
  const patrons = battle.actors.filter((actor) => actor.hubPatron && occupies(actor) && actor.hubId !== ambience.lastSpeaker);
  if (!patrons.length) {
    ambience.nextBark = now + 8000;
    return null;
  }

  const scored = patrons.map((patron) => {
    const near = heroes.length
      ? Math.min(...heroes.map((hero) => distanceFt(hero, patron)))
      : 40;
    return {patron, near};
  }).sort((a, b) => a.near - b.near);

  // Prefer patrons the party can see/hear; still allow distant chatter sometimes.
  const nearby = scored.filter((entry) => entry.near <= 40);
  const pool = nearby.length ? nearby : scored;
  const pick = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
  const line = pickLine(pick.patron.ambientLines);
  if (!line) {
    ambience.nextBark = now + 10000;
    return null;
  }

  ambience.lastSpeaker = pick.patron.hubId;
  ambience.nextBark = now + 14000 + Math.floor(Math.random() * 12000);
  return {actorId: pick.patron.id, name: pick.patron.name, lines: [line]};
}

export function nearHubTable(actor, table, reach = 10) {
  if (!occupies(actor)) return false;
  const dx = Math.abs((actor.x ?? 0) - table.x);
  const dy = Math.abs((actor.y ?? 0) - table.y);
  return Math.max(dx, dy) * 5 <= reach;
}

export function sitAtHubTable(battle, actor, table) {
  if (!table || !occupies(actor)) throw new Error("Choose a table nearby.");
  actor.x = table.x;
  actor.y = table.y;
  actor.hubSitting = table.id;
  log(battle, actor.name + " sits at a table in the Yawning Portal.");
  const neighbor = battle.actors.find((entry) =>
    entry.hubPatron && occupies(entry) && distanceFt(actor, entry) <= 15);
  const reply = neighbor ? pickLine(neighbor.ambientLines ?? neighbor.greetLines) : null;
  return {
    status: actor.name + " settles onto the bench.",
    speech: reply && neighbor ? {actorId: neighbor.id, name: neighbor.name, lines: [reply]} : null,
  };
}

export function talkToPatron(battle, actor, patron) {
  if (!patron?.hubPatron) throw new Error("Choose a patron to talk to.");
  const line = pickLine(patron.greetLines) ?? pickLine(patron.ambientLines);
  if (!line) throw new Error("They have nothing to say right now.");
  log(battle, patron.name + ": " + line);
  return {
    status: patron.name + " answers.",
    speech: {actorId: patron.id, name: patron.name, lines: [line]},
  };
}
