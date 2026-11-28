import assert from "node:assert/strict";
import { makeActor, newBattle } from "../dist/combat.mjs";
import { isBuiltinModule, moduleMapsOrBuiltin, ypHubMaps, cragmawHideoutMap } from "../dist/encounters.mjs";
import { hubActions, runHubAction, seedYpHubScene, YP_FIRST, YP_SECOND } from "../dist/hub-quests.mjs";
import { commitRoomState, travelExpedition, travelRoom } from "../dist/room-state.mjs";

assert.equal(isBuiltinModule("YPHub"), true);
assert.equal(isBuiltinModule("training"), true);
assert.equal(isBuiltinModule("LMoP"), false);

const maps = moduleMapsOrBuiltin("YPHub");
assert.equal(maps.length, 5);
const first = maps.find((entry) => entry.key === YP_FIRST);
assert.ok(first);
assert.equal(first.cols, 35);
assert.equal(first.rows, 28);
assert.equal(first.size, 128);
assert.ok(first.asset.startsWith("/assets/yawning-portal/"));

const battle = newBattle();
const hero = makeActor({
  name: "Hero", side: "party", hp: 20, maxHp: 20, ac: 15, initiative: 2, dex: 14, x: 11, y: 14,
  attacks: [{ name: "Sword", bonus: 4, damage: "1d8+2", type: "slashing", reach: 5 }],
});
battle.actors.push(hero);
seedYpHubScene(first, battle);
assert.ok(battle.actors.some((actor) => actor.hubId === "durnan"));
assert.ok(battle.actors.filter((actor) => actor.hubPatron).length >= 4, "common room patrons seed");
assert.ok(battle.features.some((feature) => feature.hubAction === "read-board"));

let actions = hubActions(battle, first, hero);
assert.ok(actions.some((entry) => entry.id === "talk-durnan"));

const talk = runHubAction("talk-durnan", battle, first, hero);
assert.equal(battle.story.hub.quest, "offered");
assert.ok(talk.status);

hero.x = 21; hero.y = 22;
actions = hubActions(battle, first, hero);
assert.ok(actions.some((entry) => entry.id === "read-board"));
runHubAction("read-board", battle, first, hero);
assert.equal(battle.story.hub.quest, "accepted");

actions = hubActions(battle, first, hero);
assert.ok(actions.some((entry) => entry.id === "ready-depart"));
runHubAction("ready-depart", battle, first, hero);
assert.equal(battle.story.hub.ready, true);
const depart = runHubAction("ready-depart", battle, first, hero);
assert.equal(battle.story.hub.quest, "active");
assert.equal(depart.travelExpedition.module, "LMoP");
assert.equal(depart.travelExpedition.id, "1ab");
// After an expedition starts, the hub must still offer a way back to the trail.
actions = hubActions(battle, first, hero);
const again = actions.find((entry) => entry.id === "ready-depart");
assert.ok(again, "active quest still offers depart/return");
assert.match(again.label, /Return to the Triboar Trail|Depart/);
const redepart = runHubAction("ready-depart", battle, first, hero);
assert.equal(redepart.travelExpedition.id, "1ab");

const hubState = commitRoomState({ battle, room: { name: "Yawning Portal", adventure: "YPHub", kind: "hub" } }, first, battle);
assert.equal(hubState.room.kind, "hub");
const expedition = travelExpedition(hubState, structuredClone(cragmawHideoutMap));
assert.equal(expedition.currentMap.module, "LMoP");
assert.equal(expedition.room.adventure, "LMoP");
assert.ok(expedition.battle.actors.some((actor) => actor.side === "party" && actor.x != null));

hero.x = 4; hero.y = 10;
const stairs = runHubAction("stairs-up", battle, first, hero);
assert.equal(stairs.travel.key, YP_SECOND);
const upstairs = travelRoom(commitRoomState({ battle }, first, battle), stairs.travel);
assert.equal(upstairs.currentMap.key, YP_SECOND);

assert.equal(ypHubMaps.length, 5);
console.log("test-hub-quests: ok");
