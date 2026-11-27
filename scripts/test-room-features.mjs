import assert from "node:assert/strict";
import { automaticRoom, extractRegionFeatures } from "../dist/scene-data.mjs";
import {
  mergeFeatureLayers,
  normalizeFeature,
  stripSourceExcerpts,
  featureFromMarker,
  markerFromFeature,
} from "../dist/room-features.mjs";
import { authoredFeatureOverrides } from "../dist/feature-overrides.mjs";
import { makeActor, newBattle } from "../dist/combat.mjs";
import { searchRegion, investigateFeature, useFeature, applyPassiveFeatureHints, featureCardModel, triggerFeaturesAt } from "../dist/world-interactions.mjs";

const map = {
  key: "qa", module: "LMoP", id: "1ab", cols: 40, rows: 20, width: 400, height: 200, size: 10, offsetX: 0, offsetY: 0,
  regions: [{
    id: "025", key: "025",
    points: [[0, 0], [100, 0], [100, 100], [0, 100]],
    entry: { name: "Goblin Trail", entries: [
      { type: "entries", name: "Trap", entries: [
        "A snare is hidden across the trail ({@dc 12} {@skill Perception}).",
      ]},
      "A {@trap hunting snare|DMG} waits here for careless travelers.",
    ]},
  }, {
    id: "17b", key: "17b",
    points: [[0, 0], [50, 0], [50, 50], [0, 50]],
    entry: { name: "Statue Chamber", entries: [
      "A marble statue stands in the center of the room (a {@creature black pudding|MM} clings to it, waiting to drop).",
    ]},
  }],
};

{
  const room = automaticRoom(map.regions[0], new Set(map.regions.map((r) => r.id)));
  assert.ok(room.features.some((f) => f.kind === "trap" || f.kind === "secret" || f.check), "trap/DC prose yields features");
  assert.ok(room.markers.some((m) => m.type === "trap"), "trap tag still yields marker");
}

{
  const features = extractRegionFeatures(map.regions[1], new Set(["17b"]));
  assert.ok(features.some((f) => f.kind === "creature_hint" && /pudding/i.test(f.name)), "parenthetical ambush creature becomes creature_hint");
  const actors = automaticRoom(map.regions[1], new Set(["17b"])).creatures;
  assert.equal(actors.filter((c) => /pudding/i.test(c.name)).length, 0, "ambush parenthetical does not auto-spawn roster");
}

{
  const baseline = [normalizeFeature({ id: "a", regionId: "025", kind: "trap", name: "Regex Trap", state: "hidden", surfaceText: "odd", truthText: "trap" })];
  const compiled = [normalizeFeature({ id: "b", regionId: "025", kind: "trap", name: "Compiled Trap", state: "hidden", surfaceText: "odd", truthText: "compiled", sourceExcerpt: "quote" })];
  const overrides = [normalizeFeature({ id: "b", regionId: "025", kind: "trap", name: "Override Trap", state: "hinted", surfaceText: "fixed", truthText: "override wins" })];
  const merged = mergeFeatureLayers({ baseline, compiled, overrides });
  // Id-overlay merge keeps unrelated baseline features in the same region.
  assert.equal(merged.length, 2);
  assert.equal(merged.find((f) => f.id === "b").name, "Override Trap");
  assert.equal(merged.find((f) => f.id === "b").state, "hinted");
  assert.equal(merged.find((f) => f.id === "a").name, "Regex Trap");
  assert.equal(stripSourceExcerpts(compiled)[0].sourceExcerpt, undefined);
}

{
  const overrides = authoredFeatureOverrides("LMoP", { id: "1ab" });
  assert.ok(overrides.length >= 3, "LMoP hideout ships sample overrides");
  assert.ok(overrides.some((f) => f.kind === "treasure" && /key/i.test(f.name)));
  assert.ok(overrides.some((f) => f.kind === "mechanism"));
  assert.ok(overrides.some((f) => f.kind === "secret"));
}

{
  const marker = featureFromMarker({ type: "treasure", name: "Chest", detail: "A locked chest.", hidden: true, items: [{ name: "Gem", quantity: 1 }] });
  assert.equal(marker.kind, "treasure");
  assert.equal(marker.state, "hidden");
  const board = markerFromFeature(marker);
  assert.equal(board.type, "treasure");
  assert.equal(board.hidden, true);
}

{
  const battle = newBattle();
  const hero = makeActor({
    id: "party:a", name: "Hero", side: "party", x: 2, y: 2, hp: 30, maxHp: 30,
    ability: { wis: 3, int: 2 }, skillBonuses: { perception: 5, investigation: 4 }, passivePerception: 15,
  });
  battle.actors = [hero];
  battle.features = [
    normalizeFeature({
      id: "qa|025|snare", regionId: "025", kind: "trap", name: "Snare", state: "hidden",
      surfaceText: "Muddy floor.", truthText: "A snare is here.", check: { skill: "perception", dc: 12 },
      passivePerceptionDC: 12, x: 3, y: 2,
      outcomes: [{ on: "success", effect: "reveal" }],
    }),
    normalizeFeature({
      id: "qa|025|empty-ish", regionId: "025", kind: "lore", name: "Scratch", state: "resolved",
      surfaceText: "Old marks.", truthText: "Old marks.", x: 4, y: 2,
    }),
  ];
  battle.markers = [];
  const tinyMap = {
    ...map,
    regions: [{
      ...map.regions[0],
      // Place the hero inside the region polygon in grid space via cellCenter expectations:
      // regionAt uses polygon in map pixel space; for tests stub regionAt via matching origin search.
    }],
  };

  // Direct feature APIs (region lookup uses regionAt; stub by putting hero cells and a fake region covering them).
  const playMap = {
    key: "qa", module: "LMoP", id: "1ab", cols: 40, rows: 20, width: 400, height: 200,
    size: 10, offsetX: 0, offsetY: 0, cellWidth: 10, cellHeight: 10,
    regions: [{
      id: "025", key: "025",
      points: [[0, 0], [400, 0], [400, 200], [0, 200]],
      entry: { name: "Trail", entries: ["Empty mud."] },
    }],
  };

  const hinted = applyPassiveFeatureHints(battle, playMap, hero);
  assert.ok(hinted.some((f) => f.id === "qa|025|snare"));
  assert.equal(battle.features[0].state, "hinted");

  // Search with a high roll should reveal.
  searchRegion(battle, hero, playMap, () => 0.99);
  assert.equal(battle.features[0].state, "revealed");
  assert.ok(battle.log.some((line) => /searches|discover|Snare|snare/i.test(line)));

  // Empty search messaging: clear features then search again.
  battle.features = [];
  searchRegion(battle, hero, playMap, () => 0.5);
  assert.ok(battle.log.at(-1).match(/nothing of note/i));

  battle.features = [normalizeFeature({
    id: "qa|025|lever", regionId: "025", kind: "mechanism", name: "Lever", state: "revealed",
    surfaceText: "A lever.", truthText: "Pulling the lever opens a gate.", x: 3, y: 2,
    outcomes: [{ on: "use", effect: "log", text: "The gate grinds open." }],
  })];
  useFeature(battle, hero, battle.features[0], playMap);
  assert.ok(battle.log.some((line) => /gate grinds open/i.test(line)));

  battle.features[0].state = "hinted";
  const hintedCard = featureCardModel(battle.features[0]);
  assert.equal(hintedCard.canUse, false, "hinted features cannot be Used yet");
  assert.equal(hintedCard.text, "A lever.", "hinted cards stay on surface text");
  assert.equal(hintedCard.check, undefined, "DC stays hidden until revealed");
  assert.throws(() => useFeature(battle, hero, battle.features[0], playMap), /Reveal this fully/);

  investigateFeature(battle, hero, battle.features[0], playMap, () => 0.99);
  assert.equal(battle.features[0].state, "revealed");

  const card = featureCardModel(battle.features[0]);
  assert.equal(card.canUse, true);
  assert.match(card.text, /gate|opens a gate/i);

  battle.features = [normalizeFeature({
    id: "qa|025|floor-snare", regionId: "025", kind: "trap", name: "Floor snare", state: "hidden",
    surfaceText: "Mud.", truthText: "A snare.", x: 2, y: 2,
    outcomes: [{ on: "trigger", effect: "log", text: "The snare snaps!" }],
  })];
  hero.x = 2; hero.y = 2;
  const sprung = triggerFeaturesAt(battle, hero, playMap);
  assert.equal(sprung.length, 1);
  assert.equal(battle.features[0].state, "triggered");
  assert.ok(battle.log.some((line) => /snare snaps/i.test(line)));
}

console.log("Room features: extraction, merge priority, overrides, Search/Investigate/Use, passive hints verified.");
