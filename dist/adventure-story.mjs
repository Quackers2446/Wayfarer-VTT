import {actorIsUp, distanceFt, lineClear, occupies} from "./combat.mjs";
import {cellCenter, regionAt} from "./encounters.mjs";
import {escape} from "./format.mjs";
import {formatEntries} from "./rules-library.mjs";

const hideout = (map) => map.module === "LMoP" && map.id === "1ab";
const practice = (map) => map.module === "training";
const intro = (map) => hideout(map)
  ? "The goblin trail ends at a cave. Sildar and Gundren never reached Phandalin. Search the hideout for them and find out where the goblins took Gundren."
  : practice(map)
    ? "Cross the yard to challenge the guard. When combat starts, choose your actions on the bottom bar. The guard acts automatically on its initiative."
    : "Explore the map with your party. The journal records the places and story details you discover.";

export function discoverStory(battle, map, actor) {
  battle.story ??= {visited:[], rescued:false};
  if (!actorIsUp(actor) || actor.side !== "party" || !occupies(actor)) return;
  const region = regionAt(map,...cellCenter(map,actor));
  battle.story.discoveries ??= (battle.story.visited ?? []).map(id=>map.regions.find(region=>region.id===id)).filter(Boolean).map(region=>({key:map.key+':'+region.id,map:map.title,name:region.entry?.name ?? region.id,entries:region.entry?.entries?.find(entry=>entry?.type==='insetReadaloud')?.entries}));
  if(region && !battle.story.discoveries.some(entry=>entry.key===map.key+':'+region.id)){
    battle.story.visited.push(region.id);
    battle.story.discoveries.push({key:map.key+':'+region.id,map:map.title,name:region.entry?.name ?? region.id,entries:region.entry?.entries?.find(entry=>entry?.type==='insetReadaloud')?.entries});
  }
}

export function storyVersion(battle) {
  const story = battle.story;
  return story ? 1 + story.visited.length + Number(story.rescued) : 0;
}

export function canRescue(battle, map, actor) {
  if (!hideout(map) || battle.round || battle.story?.rescued || !actorIsUp(actor) || actor.side !== "party") return false;
  const captive = battle.actors.find((entry) => entry.side === "neutral" &&
    /\bsildar\b/i.test(entry.statName ?? entry.name) && actorIsUp(entry) && occupies(entry));
  if (!captive || !occupies(actor) || distanceFt(actor,captive) > 5 || !lineClear(battle,actor,captive,map,{vision:true})) return false;
  return !battle.actors.some((enemy) => enemy.side === "hostile" && actorIsUp(enemy) && occupies(enemy) &&
    regionAt(map,...cellCenter(map,enemy))?.id === "02f");
}

export function rescueSildar(battle, map, actor) {
  if (!canRescue(battle,map,actor)) throw new Error("Clear the goblin den and move next to Sildar to free him.");
  discoverStory(battle,map,actor);
  battle.story.rescued = true;
}

export function storyPanel(battle, map) {
  const story = battle.story;
  const discoveries = story?.discoveries?.slice().reverse() ?? (story?.visited ?? []).slice().reverse().map(id=>map.regions.find(region=>region.id===id)).filter(Boolean).map(region=>({name:region.entry?.name,entries:region.entry?.entries?.find(entry=>entry?.type==='insetReadaloud')?.entries}));
  const readAloud = (region) => region.entry?.entries?.find((entry) => entry?.type === "insetReadaloud");
  return `<div class="story-heading"><h2>Story journal</h2>
    <button type="button" class="game-button" data-play="game-story">Close</button></div>
    ${story?.rescued ? "<section><h3>Sildar is free</h3><p>Between breaths, Sildar tells you he believes the goblins took Gundren and his map to Cragmaw Castle. He asks you to see him safely to Phandalin, where someone might know the way to the castle.</p></section>" : ""}
    ${discoveries.map((region) => `<section><h3>${escape(region.name ?? "Discovered area")}</h3>
      ${formatEntries(region.entries)}</section>`).join("")}
    <section><h3>${hideout(map) ? "Follow the goblin trail" : practice(map) ? "Challenge the guard" : "Explore the area"}</h3><p>${intro(map)}</p></section>`;
}
