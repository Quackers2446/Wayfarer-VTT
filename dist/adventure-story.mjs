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
    : "Explore the map with your party. New places announce themselves as you enter; this journal keeps the record.";

const rescuedPassage = {
  key: "rescued:sildar",
  name: "Sildar is free",
  entries: ["Between breaths, Sildar tells you he believes the goblins took Gundren and his map to Cragmaw Castle. He asks you to see him safely to Phandalin, where someone might know the way to the castle."],
};

/** Plain text for toasts / cues from journal entry bodies. */
export function storyEntryText(entries) {
  if (!entries) return "";
  if (Array.isArray(entries) && entries.every((line) => typeof line === "string" || line == null)) {
    return entries.filter((line) => typeof line === "string" && line.trim()).join(" ").trim();
  }
  const host = document.createElement("div");
  host.innerHTML = formatEntries(entries);
  return (host.textContent || "").replace(/\s+/g, " ").trim();
}

export function discoverStory(battle, map, actor) {
  battle.story ??= {visited:[], rescued:false};
  if (!actorIsUp(actor) || actor.side !== "party" || !occupies(actor)) return null;
  const region = regionAt(map,...cellCenter(map,actor));
  battle.story.discoveries ??= (battle.story.visited ?? []).map(id=>map.regions.find(region=>region.id===id)).filter(Boolean).map(region=>({key:map.key+':'+region.id,map:map.title,name:region.entry?.name ?? region.id,entries:region.entry?.entries?.find(entry=>entry?.type==='insetReadaloud')?.entries}));
  if(region && !battle.story.discoveries.some(entry=>entry.key===map.key+':'+region.id)){
    const entry = {key:map.key+':'+region.id,map:map.title,name:region.entry?.name ?? region.id,entries:region.entry?.entries?.find(entry=>entry?.type==='insetReadaloud')?.entries};
    battle.story.visited.push(region.id);
    battle.story.discoveries.push(entry);
    return entry;
  }
  return null;
}

export function storyVersion(battle) {
  const story = battle.story;
  return story ? 1 + story.visited.length + Number(story.rescued) + (story.featureFinds?.length ?? 0) : 0;
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
  const findKeys = new Set(story?.featureFinds ?? []);
  const allDiscoveries = story?.discoveries?.slice().reverse() ?? (story?.visited ?? []).slice().reverse().map(id=>map.regions.find(region=>region.id===id)).filter(Boolean).map(region=>({name:region.entry?.name,entries:region.entry?.entries?.find(entry=>entry?.type==='insetReadaloud')?.entries}));
  const featureDiscoveries = allDiscoveries.filter((entry) => entry.key && findKeys.has(entry.key));
  const roomDiscoveries = allDiscoveries.filter((entry) => !(entry.key && findKeys.has(entry.key)));
  return `<div class="story-heading"><h2>Story journal</h2>
    <button type="button" class="game-button" data-play="game-story">Close</button></div>
    <p class="story-journal-note">A record of what the party has already uncovered. New places still announce themselves as you explore.</p>
    ${story?.rescued ? "<section><h3>Sildar is free</h3><p>Between breaths, Sildar tells you he believes the goblins took Gundren and his map to Cragmaw Castle. He asks you to see him safely to Phandalin, where someone might know the way to the castle.</p></section>" : ""}
    ${featureDiscoveries.length ? `<section><h3>Secrets &amp; finds</h3>${featureDiscoveries.map((entry) =>
      `<article class="story-find"><strong>${escape(entry.name ?? "Discovery")}</strong>${
        Array.isArray(entry.entries) ? entry.entries.map((line) => typeof line === "string" ? `<p>${escape(line)}</p>` : "").join("") : ""
      }</article>`).join("")}</section>` : ""}
    ${roomDiscoveries.map((region) => `<section><h3>${escape(region.name ?? "Discovered area")}</h3>
      ${Array.isArray(region.entries) && typeof region.entries[0] === "string" && !region.entries[0]?.type
        ? region.entries.map((line) => `<p>${escape(line)}</p>`).join("")
        : formatEntries(region.entries)}</section>`).join("")}
    <section><h3>${hideout(map) ? "Follow the goblin trail" : practice(map) ? "Challenge the guard" : "Explore the area"}</h3><p>${intro(map)}${findKeys.size ? " Search, Investigate, and Use uncover traps, secrets, and mechanisms recorded above." : ""}</p></section>`;
}

/** Floating read-aloud toasts for newly entered areas / finds (journal stays a record). */
export function createStoryToasts() {
  const host = document.createElement("div");
  host.className = "story-toast-hud";
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-label", "Story");
  const seen = new Set();
  const timers = new Map();

  function dismiss(card) {
    const timer = timers.get(card);
    if (timer) clearTimeout(timer);
    timers.delete(card);
    if (!card.isConnected) return;
    card.classList.add("is-leaving");
    setTimeout(() => card.remove(), 240);
  }

  function clear() {
    for (const card of [...host.children]) dismiss(card);
  }

  function remember(battle) {
    for (const entry of battle?.story?.discoveries ?? []) {
      if (entry?.key) seen.add(entry.key);
    }
    if (battle?.story?.rescued) seen.add(rescuedPassage.key);
  }

  function show(entry, { duration = 9000 } = {}) {
    if (!entry?.key || seen.has(entry.key)) return false;
    seen.add(entry.key);
    const text = storyEntryText(entry.entries);
    if (!entry.name && !text) return false;
    const card = document.createElement("article");
    card.className = "story-toast-card";
    card.dataset.story = entry.key;
    card.innerHTML = `<header><span class="story-toast-label">Story</span><strong>${escape(entry.name || "Discovered area")}</strong>
      <button type="button" class="story-toast-dismiss" aria-label="Dismiss story">×</button></header>
      ${text ? `<p>${escape(text)}</p>` : ""}`;
    card.querySelector(".story-toast-dismiss")?.addEventListener("click", () => dismiss(card));
    host.prepend(card);
    while (host.childElementCount > 2) dismiss(host.lastElementChild);
    timers.set(card, setTimeout(() => dismiss(card), duration));
    return true;
  }

  function reveal(battle) {
    if (battle?.round) return;
    for (const entry of battle?.story?.discoveries ?? []) show(entry);
    if (battle?.story?.rescued) show(rescuedPassage, { duration: 11000 });
  }

  return {
    mount(stage) {
      if (stage && host.parentElement !== stage) stage.append(host);
    },
    remember,
    reveal,
    show,
    clear,
    destroy() {
      clear();
      host.remove();
      seen.clear();
    },
  };
}
