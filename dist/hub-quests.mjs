/** Yawning Portal hub interactions, Missing Expedition quest, and expedition travel helpers. */

import { actorIsUp, distanceFt, log, makeActor, occupies } from "./combat.mjs";
import { cragmawHideoutMap, ypHubMaps } from "./encounters.mjs";
import { HUB_TABLES, nearHubTable, seedHubPatrons, sitAtHubTable, talkToPatron } from "./hub-ambience.mjs";
import { bestiaryTokenPath } from "./rules-library.mjs";
import { travelExpedition, travelRoom } from "./room-state.mjs";
import { MEAT_COST_SP, MEAT_NAME, buyScrapMeat } from "./kennel-wolves.mjs";

const DURNAN_TOKEN = bestiaryTokenPath({ name: "Durnan", source: "WDH" });

export const YP_FIRST = "/assets/yawning-portal/1st-floor.webp";
export const YP_SECOND = "/assets/yawning-portal/2nd-floor.webp";

export function isYpHub(map) {
  return map?.module === "YPHub";
}

export function ypDefaultMap() {
  return structuredClone(ypHubMaps.find((entry) => entry.key === YP_FIRST) ?? ypHubMaps[0]);
}

export function ypMapByKey(key) {
  const found = ypHubMaps.find((entry) => entry.key === key);
  return found ? structuredClone(found) : null;
}

function hubQuest(battle) {
  battle.story ??= { visited: [], rescued: false };
  battle.story.hub ??= {
    metDurnan: false,
    readBoard: false,
    inspectedWell: false,
    quest: "none", // none | offered | accepted | active | resolved
    homecoming: false,
    ready: false,
  };
  return battle.story.hub;
}

export function seedYpHubScene(map, battle) {
  if (!isYpHub(map) || map.key !== YP_FIRST) return;
  hubQuest(battle);
  battle.fogEnabled ??= false;
  battle.features ??= [];
  battle.markers ??= [];

  let durnan = battle.actors.find((actor) => actor.hubId === "durnan");
  if (!durnan) {
    durnan = makeActor({
      name: "Durnan",
      side: "neutral",
      creatureType: "humanoid",
      hp: 45,
      maxHp: 45,
      ac: 16,
      initiative: 1,
      dex: 12,
      x: 11,
      y: 14,
      hubId: "durnan",
      // Waterdeep: Dragon Heist bestiary token (5etools WDH).
      statName: "Durnan",
      source: "WDH",
      tokenArt: DURNAN_TOKEN,
      attacks: [{ name: "Greataxe", bonus: 6, damage: "1d12+4", type: "slashing", reach: 5 }],
    });
    durnan.sceneKey = map.key;
    battle.actors.push(durnan);
  } else {
    durnan.statName ??= "Durnan";
    durnan.source ??= "WDH";
    durnan.tokenArt ??= DURNAN_TOKEN;
  }

  seedHubPatrons(map, battle);

  const ensureFeature = (feature) => {
    if (battle.features.some((entry) => entry.id === feature.id)) return;
    battle.features.push(feature);
    if (["object", "secret", "mechanism"].includes(feature.kind)) {
      battle.markers.push({
        id: feature.id,
        type: feature.kind,
        name: feature.name,
        x: feature.x,
        y: feature.y,
        origin: feature.regionId,
        detail: feature.surfaceText,
      });
    }
  };

  ensureFeature({
    id: "YPHub|yp-first|board|quest-board",
    regionId: "board",
    kind: "object",
    name: "Quest board",
    state: "hinted",
    surfaceText: "Notices flutter on a battered board by the door.",
    truthText: "One notice seeks a party to find a missing expedition on the Triboar Trail.",
    x: 21,
    y: 22,
    hubAction: "read-board",
  });
  ensureFeature({
    id: "YPHub|yp-first|well|yawning-well",
    regionId: "well",
    kind: "object",
    name: "The well",
    state: "hinted",
    surfaceText: "A black shaft drops into Undermountain.",
    truthText: "Descent into Undermountain is not open yet.",
    x: 17,
    y: 13,
    hubAction: "inspect-well",
  });
  ensureFeature({
    id: "YPHub|yp-first|stairs-up|stairs",
    regionId: "stairs-up",
    kind: "mechanism",
    name: "Stairs up",
    state: "hinted",
    surfaceText: "Stairs climb to the guest floors.",
    truthText: "Take the stairs to the second floor.",
    x: 4,
    y: 10,
    hubAction: "stairs-up",
  });
}

function nearCell(actor, x, y, reach = 10) {
  if (!occupies(actor)) return false;
  const dx = Math.abs((actor.x ?? 0) - x);
  const dy = Math.abs((actor.y ?? 0) - y);
  return Math.max(dx, dy) * 5 <= reach;
}

function nearActor(actor, other, reach = 10) {
  return other && occupies(other) && occupies(actor) && distanceFt(actor, other) <= reach;
}

/**
 * Hub / expedition contextual actions for the selected party member.
 * @returns {{id:string,label:string}[]}
 */
export function hubActions(battle, map, actor) {
  if (!actorIsUp(actor) || actor.side !== "party" || battle.round) return [];
  const actions = [];
  const quest = hubQuest(battle);

  if (isYpHub(map)) {
    const durnan = battle.actors.find((entry) => entry.hubId === "durnan" && occupies(entry));
    if (nearActor(actor, durnan)) {
      actions.push({ id: "talk-durnan", label: quest.metDurnan ? "Talk to Durnan again" : "Talk to Durnan" });
      actions.push({ id: "buy-scrap-meat", label: "Buy scrap meat (" + MEAT_COST_SP + " sp)" });
    }
    for (const patron of battle.actors.filter((entry) => entry.hubPatron && occupies(entry))) {
      if (nearActor(actor, patron, 10)) {
        actions.push({ id: "talk-patron:" + patron.hubId, label: "Talk to " + patron.name });
      }
    }
    for (const table of HUB_TABLES) {
      if (nearHubTable(actor, table) && actor.hubSitting !== table.id) {
        actions.push({ id: "sit:" + table.id, label: table.label });
      }
    }
    if (nearCell(actor, 21, 22)) {
      actions.push({ id: "read-board", label: "Read the quest board" });
    }
    if (nearCell(actor, 17, 13)) {
      actions.push({ id: "inspect-well", label: "Inspect the well" });
    }
    if (map.key === YP_FIRST && nearCell(actor, 4, 10)) {
      actions.push({ id: "stairs-up", label: "Climb to the second floor" });
    }
    if (map.key === YP_SECOND && nearCell(actor, 4, 10, 15)) {
      actions.push({ id: "stairs-down", label: "Return to the common room" });
    }
    // After the first expedition the hub stays "active"; still allow another depart / return to the trail.
    if (quest.quest === "offered" || quest.quest === "accepted" || quest.quest === "active") {
      const resume = quest.quest === "active" && quest.ready;
      actions.push({
        id: "ready-depart",
        label: resume
          ? "Return to the Triboar Trail"
          : quest.ready
            ? "Depart for the Triboar Trail"
            : "Ready the party to depart",
      });
    }
    if (quest.quest === "resolved") {
      actions.push({
        id: "ready-depart",
        label: quest.ready ? "Depart for the Triboar Trail again" : "Ready another expedition",
      });
      if (!quest.homecoming && nearActor(actor, durnan)) {
        actions.push({ id: "homecoming", label: "Tell Durnan what happened" });
      }
    }
  }

  if (map.module === "LMoP" && map.id === "1ab") {
    if (battle.story?.rescued) {
      actions.push({ id: "return-hub", label: "Return to the Yawning Portal" });
      actions.push({ id: "continue-phandalin", label: "Continue toward Phandalin" });
    } else if (quest.quest === "active" || quest.quest === "accepted") {
      actions.push({ id: "return-hub-early", label: "Withdraw to the Yawning Portal" });
    }
  }

  return actions;
}

function addDiscovery(battle, map, key, name, entries) {
  battle.story.discoveries ??= [];
  if (battle.story.discoveries.some((entry) => entry.key === key)) return null;
  const entry = { key, map: map.title, name, entries };
  battle.story.discoveries.push(entry);
  return entry;
}

/**
 * Run a hub action. May return { travel: map } or { travelExpedition: map } for the play layer to apply.
 */
export function runHubAction(actionId, battle, map, actor) {
  if (!hubActions(battle, map, actor).some((entry) => entry.id === actionId)) {
    throw new Error("Move closer to use that.");
  }
  const quest = hubQuest(battle);

  if (actionId.startsWith("talk-patron:")) {
    const hubId = actionId.slice("talk-patron:".length);
    const patron = battle.actors.find((entry) => entry.hubId === hubId && entry.hubPatron);
    return talkToPatron(battle, actor, patron);
  }

  if (actionId.startsWith("sit:")) {
    const tableId = actionId.slice("sit:".length);
    const table = HUB_TABLES.find((entry) => entry.id === tableId);
    return sitAtHubTable(battle, actor, table);
  }

  if (actionId === "talk-durnan") {
    quest.metDurnan = true;
    if (quest.quest === "none") quest.quest = "offered";
    const lines = quest.homecoming
      ? ["\"Rest up. Waterdeep never runs out of trouble.\""]
      : quest.quest === "resolved"
        ? ["Durnan nods. \"You look like you've earned a drink. The board will have more work when you're ready.\""]
        : [
          "Durnan polishes a mug and sizes you up.",
          "\"Party went missing on the Triboar Trail — wagons, a dwarf named Gundren, a knight named Sildar. Check the board if you want the work.\"",
          "\"Kitchen's got scrap meat if you're soft on beasts — " + MEAT_COST_SP + " sp a bundle.\"",
        ];
    log(battle, "Durnan: " + lines[lines.length - 1]);
    return {
      discovery: addDiscovery(battle, map, "hub:durnan", "Durnan", lines),
      status: lines[lines.length - 1],
      speech: { actorId: battle.actors.find((entry) => entry.hubId === "durnan")?.id, name: "Durnan", lines },
    };
  }

  if (actionId === "buy-scrap-meat") {
    const bought = buyScrapMeat(battle, actor);
    return {
      status: bought.status,
      speech: {
        actorId: battle.actors.find((entry) => entry.hubId === "durnan")?.id,
        name: "Durnan",
        lines: ["Durnan wraps " + MEAT_NAME.toLowerCase() + " in oilcloth. \"Keep it away from the stew pot.\""],
      },
    };
  }

  if (actionId === "read-board") {
    quest.readBoard = true;
    if (quest.quest === "none" || quest.quest === "offered") quest.quest = "accepted";
    const lines = [
      "Missing Expedition — Triboar Trail. Gundren Rockseeker and Sildar Hallwinter never reached Phandalin. Last seen near a goblin ambush site. Reward on safe return of news or survivors.",
    ];
    log(battle, "Quest board: Missing Expedition accepted.");
    return {
      discovery: addDiscovery(battle, map, "hub:board:missing-expedition", "Missing Expedition", lines),
      status: "You pin the Missing Expedition notice. Ready the party when you wish to depart.",
    };
  }

  if (actionId === "inspect-well") {
    quest.inspectedWell = true;
    const lines = ["The well drops into Undermountain. Rope ladders and stories of fools who climbed down. That descent is not open yet."];
    log(battle, lines[0]);
    return { discovery: addDiscovery(battle, map, "hub:well", "The well", lines), status: lines[0] };
  }

  if (actionId === "stairs-up") {
    const next = ypMapByKey(YP_SECOND);
    if (!next) throw new Error("The upper floor is unavailable.");
    return { travel: next, status: "You climb to the second floor." };
  }

  if (actionId === "stairs-down") {
    const next = ypMapByKey(YP_FIRST);
    if (!next) throw new Error("The common room is unavailable.");
    return { travel: next, status: "You return to the common room." };
  }

  if (actionId === "ready-depart") {
    if (!quest.ready) {
      quest.ready = true;
      log(battle, "The party readies to leave the Yawning Portal.");
      return { status: "Party ready. Choose Depart again to take the road toward the Triboar Trail." };
    }
    quest.quest = "active";
    const hideout = structuredClone(cragmawHideoutMap);
    const again = battle.story?.discoveries?.some((entry) => entry.key === "hub:travel:triboar");
    log(battle, again
      ? "You take the road north again. The goblin trail still leads to Cragmaw Hideout…"
      : "You leave Waterdeep on the long road north. Days later, a goblin trail leads to a cave…");
    return {
      travelExpedition: hideout,
      discovery: addDiscovery(battle, map, again ? "hub:travel:triboar:return" : "hub:travel:triboar",
        again ? "Return — Triboar Trail" : "Travel — Triboar Trail", [
        again
          ? "Back on the Triboar Trail. The cave mouth of Cragmaw Hideout waits in the hills."
          : "Caravan dust, cold camps, and a goblin ambush site. Tracks lead to a cave in the hills — Cragmaw Hideout.",
      ]),
      status: "You arrive at Cragmaw Hideout.",
    };
  }

  if (actionId === "return-hub" || actionId === "return-hub-early") {
    if (actionId === "return-hub") quest.quest = "resolved";
    // Keep the lead open on an early withdraw so the hub can offer "Return to the Triboar Trail".
    if (actionId === "return-hub-early" && quest.quest === "active") quest.ready = true;
    const hub = ypDefaultMap();
    log(battle, actionId === "return-hub"
      ? "With Sildar's news in hand, you turn back toward Waterdeep and the Yawning Portal."
      : "You withdraw to the Yawning Portal to regroup.");
    return { travelExpedition: hub, status: "You return to the Yawning Portal." };
  }

  if (actionId === "continue-phandalin") {
    quest.quest = "resolved";
    log(battle, "Sildar urges the party on to Phandalin. That road continues in a later chapter; for now the lead is secure.");
    return {
      discovery: addDiscovery(battle, map, "hub:continue:phandalin", "On to Phandalin", [
        "Sildar asks to be escorted to Phandalin. The town — and Cragmaw Castle beyond — wait for another expedition day.",
      ]),
      status: "The road to Phandalin remains open for a later session. You can still return to the Yawning Portal.",
    };
  }

  if (actionId === "homecoming") {
    quest.homecoming = true;
    const lines = [
      "Durnan sets down two mugs. \"Missing folk found, or at least their trail. That's more than most manage. The board will have fresh ink when you're hungry again.\"",
    ];
    log(battle, lines[0]);
    return {
      discovery: addDiscovery(battle, map, "hub:homecoming", "Homecoming", lines),
      status: lines[0],
      speech: { actorId: battle.actors.find((entry) => entry.hubId === "durnan")?.id, name: "Durnan", lines },
    };
  }

  throw new Error("Unknown hub action.");
}

export function applyHubTravel(state, nextMap) {
  return travelRoom(state, nextMap);
}

export function applyHubExpedition(state, nextMap) {
  return travelExpedition(state, nextMap);
}
