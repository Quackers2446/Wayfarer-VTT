/** Layer 4 — hand-authored feature patches keyed module|mapKey|regionId (and feature id). */

import { normalizeFeature } from "./room-features.mjs";

/**
 * Small enrichment set for LMoP Cragmaw Hideout (map id 1ab).
 * Keys match module|mapId|regionId for lookup; each entry is a full feature override.
 */
const LMoP_HIDEOUT = [
  {
    id: "LMoP|1ab|021|chain-pole",
    regionId: "021",
    kind: "mechanism",
    name: "Chain pole",
    state: "revealed",
    surfaceText: "A scarred iron pole anchors short chains. Three wolves strain against the rings.",
    truthText: "The kennel pole holds the pack. Calm them with Animal Handling, free them, or leave them chained.",
    visual: "pole",
    outcomes: [
      { on: "use", effect: "log", text: "The chains rattle on the iron pole." },
    ],
  },
  {
    id: "LMoP|1ab|025|goblin-trail-snare",
    regionId: "025",
    kind: "trap",
    name: "Snare in the passage",
    state: "hidden",
    surfaceText: "The muddy passage looks undisturbed at a glance.",
    truthText: "A snare is set across the trail. Triggering it alerts goblins deeper in the caves.",
    check: { skill: "perception", dc: 12 },
    passivePerceptionDC: 12,
    outcomes: [
      { on: "success", effect: "reveal" },
      { on: "trigger", effect: "log", text: "The snare snaps taut — a warning clatter echoes deeper into the caves." },
    ],
  },
  {
    id: "LMoP|1ab|029|flood-lever",
    regionId: "029",
    kind: "mechanism",
    name: "Flood signal",
    state: "hinted",
    surfaceText: "The lookout has a clear view of the twin pools passage and fidgets near a marked rock.",
    truthText: "The lookout can signal goblins at the twin pools to release a flood through the passage.",
    check: { skill: "insight", dc: 12 },
    outcomes: [
      { on: "success", effect: "reveal" },
      { on: "use", effect: "log", text: "A signal goes out toward the twin pools. Water may soon roar through the passage." },
      { on: "use", effect: "set_state", state: "triggered" },
    ],
  },
  {
    id: "LMoP|1ab|02f|yeemik-key",
    regionId: "02f",
    kind: "treasure",
    name: "Yeemik's key",
    state: "hidden",
    surfaceText: "Yeemik fingers something metallic when he thinks no one is watching.",
    truthText: "Yeemik carries a key that opens the manacles holding Sildar.",
    check: { skill: "perception", dc: 13 },
    outcomes: [
      { on: "success", effect: "reveal" },
      { on: "use", effect: "log", text: "The key fits Sildar's manacles." },
    ],
    items: [{ name: "Yeemik's key", quantity: 1, notes: "Opens Sildar's manacles in the goblin den." }],
  },
  {
    id: "LMoP|1ab|034|secret-chimney",
    regionId: "034",
    kind: "secret",
    name: "Chimney crawl",
    state: "hidden",
    surfaceText: "Soot streaks the ceiling near the back of the chamber.",
    truthText: "A narrow chimney leads up to Klarg's cave. Small creatures can squeeze through.",
    check: { skill: "investigation", dc: 15 },
    outcomes: [
      { on: "success", effect: "reveal" },
      { on: "success", effect: "log", text: "You spot a soot-stained chimney that climbs toward another chamber." },
      { on: "use", effect: "log", text: "The chimney crawl connects this den to Klarg's cave above." },
    ],
  },
];

const BY_MODULE = {
  lmop: LMoP_HIDEOUT,
  LMoP: LMoP_HIDEOUT,
};

/** Overrides for a map. `mapKey` is the image path/key; `mapId` is the 5etools image id (e.g. 1ab). */
export function authoredFeatureOverrides(moduleId, map = {}) {
  const list = BY_MODULE[moduleId] ?? BY_MODULE[String(moduleId || "").toLowerCase()] ?? [];
  if (!list.length) return [];
  if (moduleId === "LMoP" || String(moduleId).toLowerCase() === "lmop") {
    if (map.id && map.id !== "1ab") return [];
  }
  return list.map((entry) => normalizeFeature(entry, {
    moduleId: moduleId || "LMoP",
    mapKey: map.id || map.key || "1ab",
    regionId: entry.regionId,
  }));
}
