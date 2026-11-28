import assert from "node:assert/strict";
import { makeActor, newBattle } from "../dist/combat.mjs";
import {
  FLOOD_LEVER_ID,
  FLOOD_REGION,
  LOOKOUT_REGION,
  checkLookoutFlood,
  floodCells,
  floodStory,
  releaseCragmawFlood,
} from "../dist/cragmaw-flood.mjs";

function hideoutMap() {
  const s = 165;
  // Region polygons are in map pixel space (cell * size).
  const box = (x0, y0, x1, y1) => [
    [x0 * s, y0 * s], [x1 * s, y0 * s], [x1 * s, y1 * s], [x0 * s, y1 * s],
  ];
  return {
    module: "LMoP",
    id: "1ab",
    key: "adventure/LMoP/Cragmaw Hideout.webp",
    cols: 30,
    rows: 21,
    size: s,
    offsetX: 0,
    offsetY: 0,
    regions: [{
      id: FLOOD_REGION,
      entry: { name: "Passage" },
      points: box(0, 0, 8, 3),
    }, {
      id: "02f",
      entry: { name: "Goblin Den" },
      points: box(10, 0, 16, 4),
    }, {
      id: "029",
      entry: { name: "Lookout" },
      points: box(0, 4, 4, 7),
    }],
  };
}

function setup() {
  const map = hideoutMap();
  const battle = newBattle();
  battle.wallData = { manual: true, walls: [], doors: [] };
  battle.features = [{
    id: FLOOD_LEVER_ID,
    regionId: "029",
    kind: "mechanism",
    name: "Flood signal",
    state: "revealed",
    surfaceText: "signal",
    truthText: "dam",
    outcomes: [],
    x: 1,
    y: 5,
  }];
  const hero = makeActor({
    name: "Fighter", side: "party", hp: 20, maxHp: 20, ac: 16, initiative: 1,
    x: 2, y: 1, ability: { str: 2, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
    saves: { str: 4, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
  });
  const goblin = makeActor({
    name: "Goblin", side: "hostile", hp: 7, maxHp: 7, ac: 15, initiative: 2,
    x: 4, y: 1, ability: { str: -1, dex: 2, con: 0, int: 0, wis: 0, cha: -1 },
    saves: { str: -1, dex: 2, con: 0, int: 0, wis: 0, cha: -1 },
  });
  const lookout = makeActor({
    name: "Lookout", side: "hostile", hp: 7, maxHp: 7, ac: 15, initiative: 2,
    x: 1, y: 5, origin: LOOKOUT_REGION, sight: 90,
    ability: { str: -1, dex: 2, con: 0, int: 0, wis: 0, cha: -1 },
    saves: { str: -1, dex: 2, con: 0, int: 0, wis: 0, cha: -1 },
  });
  battle.actors.push(hero, goblin, lookout);
  return { map, battle, hero, goblin, lookout };
}

const { map, battle, hero, goblin } = setup();
assert.ok(floodCells(map, battle).length > 0, "passage has flood cells");

const first = releaseCragmawFlood(battle, map, hero, () => 0);
assert.equal(floodStory(battle).released, true);
assert.ok(first?.toast?.name);
assert.ok(first.cells > 0);
assert.equal(battle.terrain["2:1"], "water", "hero square painted water");
assert.equal(battle.features[0].state, "triggered");
assert.ok(battle.actionEvents?.some((event) => event.visual?.url?.includes("blfx-tidal-wave")),
  "flood action includes tidal-wave visual");
assert.ok(hero.prone || hero.x !== 2, "failed save knocks prone or sweeps");
assert.ok(goblin.hp < 7 || goblin.prone || goblin.x !== 4, "goblin in water is affected");

const second = releaseCragmawFlood(battle, map, hero, () => 0);
assert.equal(second.already, true, "second release is a no-op");

const heldSetup = setup();
const held = releaseCragmawFlood(heldSetup.battle, heldSetup.map, heldSetup.hero, () => 0.99);
assert.ok(held.held?.includes("Fighter") || !heldSetup.hero.prone, "high roll can hold footing");

const watch = setup();
const spotted = checkLookoutFlood(watch.battle, watch.map, watch.hero, () => 0);
assert.ok(spotted, "lookout spotting releases the flood");
assert.equal(spotted.lookout?.id, watch.lookout.id);
assert.equal(floodStory(watch.battle).released, true);
assert.ok(checkLookoutFlood(watch.battle, watch.map, watch.hero, () => 0) == null, "lookout flood only once");

console.log("test-cragmaw-flood: ok");
