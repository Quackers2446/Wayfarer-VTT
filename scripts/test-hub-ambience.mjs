import assert from "node:assert/strict";
import {makeActor, newBattle} from "../dist/combat.mjs";
import {moduleMapsOrBuiltin} from "../dist/encounters.mjs";
import {HUB_TABLES, seedHubPatrons, sitAtHubTable, talkToPatron, tickHubAmbience} from "../dist/hub-ambience.mjs";
import {hubActions, runHubAction, seedYpHubScene, YP_FIRST} from "../dist/hub-quests.mjs";

const first = moduleMapsOrBuiltin("YPHub").find((entry) => entry.key === YP_FIRST);
const battle = newBattle();
const hero = makeActor({name: "Hero", side: "party", hp: 20, maxHp: 20, x: 14, y: 17});
battle.actors.push(hero);
seedYpHubScene(first, battle);
seedHubPatrons(first, battle);

assert.ok(battle.actors.some((actor) => actor.hubId === "mira"));
const mira = battle.actors.find((actor) => actor.hubId === "mira");
const talk = talkToPatron(battle, hero, mira);
assert.ok(talk.speech?.actorId === mira.id);

hero.x = HUB_TABLES[0].x; hero.y = HUB_TABLES[0].y;
const actions = hubActions(battle, first, hero);
assert.ok(actions.some((entry) => entry.id.startsWith("sit:")));
const sit = runHubAction(actions.find((entry) => entry.id.startsWith("sit:")).id, battle, first, hero);
assert.equal(hero.hubSitting, HUB_TABLES[0].id);
assert.match(sit.status, /settles/);

battle.story.hub.ambience.nextBark = 0;
const bark = tickHubAmbience(battle, first, [hero], Date.now());
assert.ok(bark?.actorId);
assert.ok(bark.lines?.[0]);
assert.ok(battle.story.hub.ambience.nextBark > Date.now());

console.log("Hub ambience: patrons, sit, talk, and ambient barks verified.");
