import assert from "node:assert/strict";
import { applyDamage, makeActor, newBattle, speedOf } from "../dist/combat.mjs";
import {
  ALERT_REGION,
  CALM_DC,
  FOLLOW_DISTANCE_FT,
  KENNEL_REGION,
  MEAT_COST_SP,
  MEAT_NAME,
  POLE_ID,
  betrayKennelPack,
  buyScrapMeat,
  calmKennelWolves,
  checkKennelApproach,
  followKennelAllies,
  freeKennelWolves,
  hasScrapMeat,
  kennelActions,
  kennelPole,
  petKennelWolves,
  seedKennelWolves,
} from "../dist/kennel-wolves.mjs";

function kennelMap() {
  return {
    module: "LMoP",
    id: "1ab",
    key: "adventure/LMoP/Cragmaw Hideout.webp",
    title: "Cragmaw Hideout",
    cols: 30,
    rows: 21,
    size: 165,
    offsetX: 0,
    offsetY: 0,
    regions: [{
      id: KENNEL_REGION,
      entry: { name: "Kennel" },
      points: [[0, 0], [5, 0], [5, 5], [0, 5]],
    }, {
      id: ALERT_REGION,
      entry: { name: "Goblin Den" },
      points: [[10, 0], [15, 0], [15, 5], [10, 5]],
    }],
  };
}

function setup() {
  const map = kennelMap();
  const battle = newBattle();
  const hero = makeActor({
    name: "Ranger", side: "party", hp: 20, maxHp: 20, ac: 15, initiative: 2, dex: 14,
    x: 2, y: 2, ability: { wis: 3 }, skillBonuses: { "animal handling": 5 },
    currency: { gp: 5, sp: 0, cp: 0 }, items: [],
  });
  const wolves = [0, 1, 2].map((index) => makeActor({
    name: "Wolf " + (index + 1), side: "neutral", hp: 11, maxHp: 11, ac: 13, initiative: 2, dex: 15,
    x: 1 + index, y: 1, origin: KENNEL_REGION, statName: "Wolf", source: "MM", speed: 40,
    attacks: [{ name: "Bite", bonus: 4, damage: "2d4+2", type: "piercing", reach: 5 }],
  }));
  const goblin = makeActor({
    name: "Goblin", side: "neutral", hp: 7, maxHp: 7, ac: 15, initiative: 2, dex: 14,
    x: 12, y: 2, origin: ALERT_REGION, attacks: [{ name: "Scimitar", bonus: 4, damage: "1d6+2", type: "slashing", reach: 5 }],
  });
  battle.actors.push(hero, ...wolves, goblin);
  // Open floor for placement / follow pathing in the unit map.
  battle.wallData = { manual: true, walls: [], doors: [] };
  seedKennelWolves(map, battle);
  return { map, battle, hero, wolves, goblin };
}

const { map, battle, hero, wolves, goblin } = setup();

const rock = kennelPole(battle);
assert.ok(battle.features.some((feature) => feature.id === POLE_ID), "rock feature seeded");
assert.ok(battle.markers.some((marker) => marker.type === "rock" || marker.visual === "rock"), "rope-anchor marker seeded");
assert.equal(rock?.image, undefined, "kennel hitch has no rock PNG");
assert.equal(rock?.hidden, true, "kennel hitch stays invisible");
assert.ok(wolves.every((wolf) => wolf.chained), "wolves start tethered");
assert.equal(speedOf(wolves[0]), 0, "tethered wolves cannot move");
assert.ok(
  wolves.every((wolf) => Number.isInteger(wolf.x) && (wolf.x !== rock.x || wolf.y !== rock.y)),
  "wolves seated around the rock, not on it",
);

let actions = kennelActions(battle, map, hero);
assert.ok(actions.some((entry) => entry.id === "kennel-calm"));
assert.ok(actions.some((entry) => entry.id === "kennel-free"));
assert.ok(!actions.some((entry) => entry.id === "kennel-pet"));

// Fail calm → alert den + agitate + action event with dice
const fail = calmKennelWolves(battle, map, hero, { random: () => 0 });
assert.equal(fail.success, false);
assert.equal(battle.story.kennel.agitated, true);
assert.equal(battle.story.kennel.alerted, true);
assert.equal(goblin.side, "hostile");
assert.match(fail.status, /fail/i);
assert.ok(fail.toast?.name);
assert.ok(battle.actionEvents?.some((event) =>
  event.action === "Animal Handling" && event.outcome === "Fail" && event.rolls?.length),
  "failed calm records visible roll event");

// Approach while agitated starts a fight
hero.x = wolves[0].x; hero.y = wolves[0].y;
const engaged = checkKennelApproach(battle, map, hero, () => 0.5);
assert.ok(engaged, "agitated approach engages");
assert.ok(battle.round, "initiative starts");
assert.ok(wolves.every((wolf) => wolf.side === "hostile" || wolf.kennelAlly));

// Reset for success path
const calmSetup = setup();
const meat = buyScrapMeat(calmSetup.battle, calmSetup.hero);
assert.match(meat.status, /scrap meat/i);
assert.ok(hasScrapMeat(calmSetup.hero));
assert.ok(copperSpent(calmSetup.hero));

const success = calmKennelWolves(calmSetup.battle, calmSetup.map, calmSetup.hero, {
  useMeat: true,
  random: () => 0.99,
});
assert.equal(success.success, true);
assert.equal(calmSetup.battle.story.kennel.calmed, true);
assert.ok(!hasScrapMeat(calmSetup.hero), "meat consumed on attempt");
assert.match(success.status, /success/i);
assert.ok(calmSetup.battle.actionEvents?.some((event) =>
  event.action === "Animal Handling" && event.outcome === "Success" && event.rolls?.length),
  "successful calm records visible roll event");
assert.ok(kennelActions(calmSetup.battle, calmSetup.map, calmSetup.hero).some((entry) => entry.id === "kennel-pet"));

petKennelWolves(calmSetup.battle, calmSetup.map, calmSetup.hero);
assert.equal(calmSetup.battle.story.kennel.befriended, true);
assert.ok(calmSetup.wolves.every((wolf) => wolf.kennelAlly && wolf.side === "party"));
assert.ok(calmSetup.battle.actionEvents?.some((event) => event.outcome === "Bonded"));

// Follow the party while exploring
calmSetup.hero.x = 4;
calmSetup.hero.y = 4;
for (const wolf of calmSetup.wolves) {
  wolf.x = 0;
  wolf.y = 0;
}
const followed = followKennelAllies(calmSetup.battle, calmSetup.map, calmSetup.hero);
assert.ok(followed.length, "befriended wolves pad after the party");
assert.ok(
  calmSetup.wolves.every((wolf) => distanceApprox(wolf, calmSetup.hero) <= FOLLOW_DISTANCE_FT + 5),
  "wolves close the gap toward the hero",
);

// Betraying one wolf turns the whole pack hostile
const betrayal = betrayKennelPack(calmSetup.battle, calmSetup.map, calmSetup.hero, calmSetup.wolves[0], () => 0.5);
assert.ok(betrayal);
assert.equal(calmSetup.battle.story.kennel.betrayed, true);
assert.equal(calmSetup.battle.story.kennel.befriended, false);
assert.ok(calmSetup.wolves.every((wolf) => !wolf.kennelAlly && wolf.side === "hostile"));
assert.match(betrayal.status, /trust is broken/i);

// applyDamage flags party harm against kennel allies
const flagSetup = setup();
calmKennelWolves(flagSetup.battle, flagSetup.map, flagSetup.hero, { random: () => 0.99 });
petKennelWolves(flagSetup.battle, flagSetup.map, flagSetup.hero);
applyDamage(flagSetup.battle, flagSetup.wolves[1], 3, "slashing", false, Math.random, flagSetup.hero);
assert.equal(flagSetup.battle.kennelBetrayal?.victimId, flagSetup.wolves[1].id);

const freeCalm = setup();
calmKennelWolves(freeCalm.battle, freeCalm.map, freeCalm.hero, { random: () => 0.99 });
const fled = freeKennelWolves(freeCalm.battle, freeCalm.map, freeCalm.hero);
assert.match(fled.status, /flee/i);
assert.equal(freeCalm.battle.story.kennel.freed, true);
assert.ok(freeCalm.wolves.every((wolf) => wolf.fled && wolf.x == null));

const freeHostile = setup();
const attack = freeKennelWolves(freeHostile.battle, freeHostile.map, freeHostile.hero, () => 0.5);
assert.ok(attack.engage || /attack/i.test(attack.status));
assert.ok(freeHostile.wolves.every((wolf) => !wolf.chained));
assert.equal(freeHostile.goblin.side, "hostile");

function copperSpent(actor) {
  const copper = (Number(actor.currency.cp) || 0)
    + (Number(actor.currency.sp) || 0) * 10
    + (Number(actor.currency.ep) || 0) * 50
    + (Number(actor.currency.gp) || 0) * 100
    + (Number(actor.currency.pp) || 0) * 1000;
  return copper === 500 - MEAT_COST_SP * 10;
}

function distanceApprox(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
}

assert.equal(CALM_DC, 15);
assert.equal(MEAT_NAME, "Scrap meat");
console.log("test-kennel-wolves: ok");
