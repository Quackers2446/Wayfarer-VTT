/** Map Studio — author shared per-map defaults (admin). */
import { accountState } from "./account-client.mjs";
import { escape } from "./format.mjs";
import { icon } from "./icons.mjs";
import { createCamera, mapControls, mapHint, mapViewport } from "./map-camera.mjs";
import { drawGrid, gridPosition, tokenAtPoint } from "./grid-view.mjs";
import { createWallEditor } from "./wall-editor.mjs";
import { newBattle, placeToken, canStand, occupies } from "./combat.mjs";
import { containsCell } from "./actor-space.mjs";
import { creatureActor, moduleMaps, moduleMapsOrBuiltin } from "./encounters.mjs";
import { hasArchive, hostedMapImage, mapImage, restoreArchive } from "./rules-library.mjs";
import {
  FEATURE_KINDS,
  FEATURE_STATES,
  normalizeFeature,
  markerFromFeature,
  syncMarkerForFeature,
  setFeatureState,
} from "./room-features.mjs";

const OUTCOME_ONS = ["success", "fail", "use", "trigger"];
const OUTCOME_EFFECTS = ["reveal", "log", "set_state", "loot", "spawn_creature", "unlock"];
const ACTOR_SIDES = ["hostile", "neutral", "party"];
import { createSpawnMarker, removeSpawnMarker, spawnMarkers } from "./spawn-points.mjs";
import { listHomebrew } from "./homebrew-store.mjs";
import { monsterStatBlock } from "./homebrew-schema.mjs";
import { fogSettings } from "./dynamic-fog.mjs";
import { populateScene } from "./scene-populate.mjs";
import { applyBakedWalls } from "./baked-walls.mjs";
import { seedKennelWolves } from "./kennel-wolves.mjs";
import { seedYpHubScene } from "./hub-quests.mjs";
import { monsterArtwork } from "./monster-art.mjs";
import {
  applyMapTemplate,
  captureTemplateFromBattle,
  emptyTemplate,
  loadMapTemplate,
  listMapTemplates,
  previewBattleFromTemplate,
  saveMapTemplate,
  templateArtworkUrl,
  uploadTemplateArtwork,
} from "./map-templates.mjs";

const TOOLS = [
  ["select", "Select / pan", "target"],
  ["monster", "Place monster", "sword"],
  ["spawn", "Spawn points", "flag"],
  ["feature", "Features / events", "sparkles"],
  ["walls", "Walls / doors", "shield"],
  ["fog", "Default fog", "eye"],
  ["grid", "Grid / size", "fit"],
  ["upload", "Upload map", "upload"],
];

function blankBattle() {
  const battle = newBattle();
  battle.terrain = {};
  battle.markers = [];
  battle.features = [];
  battle.fogEnabled = false;
  battle.fogSettings = fogSettings(battle);
  battle.wallData = { manual: true, walls: [], doors: [] };
  return battle;
}

async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function blobToArt(blob) {
  if (!blob) return null;
  try { return await decodeImage(blob); }
  catch { return null; }
}

async function loadMapArt(entry, artworkId) {
  if (artworkId) {
    try {
      const response = await fetch(templateArtworkUrl(entry.module, entry.key, artworkId), { credentials: "same-origin" });
      if (response.ok) {
        const image = await blobToArt(await response.blob());
        if (image) return image;
      }
    } catch { /* fall through */ }
  }
  // Try DM art and player art — whichever decodes first wins.
  const candidates = [...new Set([entry.asset, entry.playerAsset].filter(Boolean))];
  for (const asset of candidates) {
    if (typeof asset === "string" && asset.startsWith("/assets/")) {
      try {
        const response = await fetch(asset);
        if (response.ok) {
          const image = await blobToArt(await response.blob());
          if (image) return image;
        }
      } catch { /* next */ }
    }
    const embedded = await mapImage(asset).catch(() => null);
    if (embedded) {
      const image = await blobToArt(embedded);
      if (image) return image;
    }
    try {
      const hosted = await hostedMapImage(asset, AbortSignal.timeout(20000));
      if (hosted) {
        const image = await blobToArt(hosted);
        if (image) return image;
      }
    } catch { /* next candidate */ }
  }
  return null;
}

export function mountMapStudio(host) {
  if (!host) return;
  const account = accountState();
  if (!account.betaAdmin) {
    host.innerHTML = `<div class="map-studio-denied">
      <h1>Map Studio</h1>
      <p>Only a closed-beta admin can author shared map defaults. Sign in with an admin account to continue.</p>
    </div>`;
    return;
  }

  let moduleId = "LMoP";
  let maps = [];
  let map = null;
  let battle = blankBattle();
  let savedSnapshot = null;
  let dirty = false;
  let tool = "select";
  let statusText = "";
  let art = null;
  let camera = null;
  let selected = null;
  let monsterQuery = "";
  let monsterPick = { name: "Goblin", source: "MM" };
  let featureDraft = { kind: "trap", name: "Pressure plate", surfaceText: "A worn stone looks slightly raised.", truthText: "A dart trap." };
  let spawnName = "Party arrival";
  let notes = "";
  let artworkId = null;
  let catalog = [];
  let wallEditor = null;
  let monsterSuggestions = null;
  let selectGeneration = 0;

  const setStatus = (text) => { statusText = text; paintChrome(); };

  function markDirty() {
    dirty = true;
    paintPanels();
    boardPaint();
  }

  /** Mark unsaved without remounting the inspector (keeps focus while typing). */
  function touchDirty(repaintBoard = false) {
    dirty = true;
    const save = host.querySelector('[data-studio-action="save"]');
    const discard = host.querySelector('[data-studio-action="discard"]');
    if (save) save.disabled = !map;
    if (discard) discard.disabled = !map;
    const status = host.querySelector("[data-studio-status]");
    if (status) status.textContent = (statusText || "") + ((statusText ? " · " : "") + "Unsaved changes");
    if (repaintBoard) boardPaint();
  }

  function liveFeature() {
    if (selected?.kind !== "feature") return null;
    return (battle.features ?? []).find((entry) => entry.id === selected.id) ?? null;
  }

  function liveActor() {
    if (selected?.kind !== "actor") return null;
    return (battle.actors ?? []).find((entry) => entry.id === selected.id) ?? null;
  }

  function liveSpawn() {
    if (selected?.kind !== "spawn") return null;
    return spawnMarkers(battle).find((entry) => entry.id === selected.id) ?? null;
  }

  function refreshSelectedRefs() {
    if (selected?.kind === "feature") {
      const feature = liveFeature();
      if (feature) selected = { kind: "feature", id: feature.id, feature };
    } else if (selected?.kind === "actor") {
      const actor = liveActor();
      if (actor) selected = { kind: "actor", id: actor.id, actor };
    } else if (selected?.kind === "spawn") {
      const spawn = liveSpawn();
      if (spawn) selected = { kind: "spawn", id: spawn.id, spawn };
    }
  }

  function serialize() {
    return JSON.stringify(captureTemplateFromBattle(battle, { notes, artworkId }));
  }

  function rememberClean() {
    savedSnapshot = serialize();
    dirty = false;
  }

  async function refreshCatalog() {
    try {
      const listed = await listMapTemplates();
      catalog = listed.templates ?? [];
    } catch {
      catalog = [];
    }
  }

  async function loadModuleMaps(id) {
    moduleId = id;
    const builtin = moduleMapsOrBuiltin(id);
    maps = builtin ?? (await moduleMaps(id).catch(() => []));
    maps = maps.filter((entry) => entry.title !== "Player Version" && !/\(player\)$/i.test(entry.title ?? ""));
    if (!maps.length && id !== "training") {
      setStatus("No maps found for " + id + ". Attach the 5etools archive on Overview if this is a published adventure.");
    }
    const preferred = maps.find((entry) => entry.id === "1ab") ?? maps[0] ?? null;
    if (preferred) await selectMap(preferred);
    else {
      map = null;
      battle = blankBattle();
      paint();
    }
  }

  /** Same first-open seeding as an adventure room (template overlays, then authored populate). */
  async function seedLikeAdventure() {
    if (!map || map.module === "training") return;
    if (map.module === "YPHub") seedYpHubScene(map, battle);
    await Promise.all([
      applyBakedWalls(map, battle).catch(() => false),
      populateScene(map, battle),
    ]);
    if (map.module === "YPHub") seedYpHubScene(map, battle);
    if (map.module === "LMoP" && map.id === "1ab") seedKennelWolves(map, battle);
  }

  function boardSummary() {
    const monsters = (battle.actors ?? []).filter((a) => a.side !== "party").length;
    const features = (battle.features ?? []).length;
    const spawns = spawnMarkers(battle).length;
    const walls = (battle.wallData?.walls?.length ?? 0) + (battle.wallData?.doors?.length ?? 0);
    return `${monsters} monsters · ${features} features · ${spawns} spawns · ${walls} walls/doors`;
  }

  async function selectMap(entry) {
    const request = ++selectGeneration;
    map = structuredClone(entry);
    battle = blankBattle();
    art = null;
    selected = null;
    notes = "";
    artworkId = null;
    setStatus("Opening " + (entry.title || entry.key) + "…");
    paint();
    // Load artwork and template in parallel so the board is never stuck blank.
    const artPromise = loadMapArt(map, null).catch(() => null);
    let template = null;
    try {
      template = await loadMapTemplate(entry.module, entry.key);
    } catch (error) {
      if (request !== selectGeneration) return;
      setStatus(error.message || "Could not load template; seeding adventure defaults.");
    }
    if (request !== selectGeneration) return;
    if (template) {
      try {
        await applyMapTemplate(map, battle, template, { loadActors: true });
      } catch {
        // Keep an editable board even if a creature lookup fails.
      }
      notes = template.notes || "";
      artworkId = template.artworkId || null;
    }
    try {
      await seedLikeAdventure();
    } catch {
      // Board stays editable with whatever loaded so far.
    }
    if (request !== selectGeneration) return;
    if (!statusText.startsWith("Could not")) {
      setStatus(template
        ? `Template + adventure seed — ${boardSummary()}.`
        : `Adventure defaults — ${boardSummary()}. Edit and save as a template.`);
    }
    const loadedArt = artworkId
      ? await loadMapArt(map, artworkId).catch(() => null)
      : await artPromise;
    if (request !== selectGeneration) return;
    art = loadedArt || await artPromise;
    if (!art) {
      setStatus((statusText ? statusText + " · " : "") + (hasArchive()
        ? "Map art could not be decoded — showing room outlines. Try Upload map."
        : "Attach the 5etools archive on Overview (or upload map art) to see the image."));
    }
    rememberClean();
    paintPanels();
    boardPaint();
    fitBoard(request);
  }

  function ensureWallEditor() {
    if (wallEditor) return wallEditor;
    wallEditor = createWallEditor({
      state: () => ({
        map, battle, surface: host.querySelector("#play-grid"),
        scope: (map?.module || "") + ":" + (map?.key || ""),
      }),
      commit: async (_before, next) => {
        battle.wallData = structuredClone(next);
        battle.wallRevision = (battle.wallRevision ?? 0) + 1;
        markDirty();
        return true;
      },
      change: () => { paintPanels(); boardPaint(); },
    });
    return wallEditor;
  }

  function collectTokenImages() {
    const images = new Map();
    if (!map) return images;
    for (const actor of battle.actors ?? []) {
      const portrait = monsterArtwork(actor, map, () => {
        if (!host.isConnected || !camera) return;
        boardPaint();
      });
      if (portrait) images.set(actor.id, portrait);
    }
    return images;
  }

  function isKennelHitch(marker) {
    return marker?.id === "LMoP|1ab|021|chain-pole"
      || marker?.featureId === "LMoP|1ab|021|chain-pole"
      || marker?.type === "rock" || marker?.visual === "rock"
      || marker?.type === "pole" || marker?.visual === "pole";
  }

  /**
   * Map Studio is DM authoring — show traps, secrets, treasures, and other normally-hidden
   * features on the board (Select/pan especially). Kennel hitch stays rope-only.
   */
  function studioBoardMarkers() {
    const byId = new Map();
    for (const marker of battle.markers ?? []) {
      if (!Number.isInteger(marker.x) || !Number.isInteger(marker.y)) continue;
      byId.set(marker.id, marker);
    }
    for (const feature of battle.features ?? []) {
      if (!Number.isInteger(feature.x) || !Number.isInteger(feature.y)) continue;
      if (isKennelHitch(feature)) continue;
      const board = markerFromFeature(feature);
      const existing = byId.get(feature.id);
      // Force visible drawing for hidden/hinted authoring (rooms still hide these from players).
      byId.set(feature.id, {
        ...(existing || {}),
        ...board,
        x: feature.x,
        y: feature.y,
        hidden: false,
        revealed: true,
        hinted: feature.state === "hinted",
        // Draw the full prop, not the faint "noticed" dust, so traps/secrets are editable.
        state: feature.state === "hidden" || feature.state === "hinted" ? "revealed" : (feature.state || "revealed"),
        studioHidden: feature.state === "hidden" || feature.state === "hinted",
        name: feature.name,
        kind: feature.kind,
      });
    }
    // Keep hitch for rope lines; drawGrid skips painting it.
    for (const marker of battle.markers ?? []) {
      if (isKennelHitch(marker) && Number.isInteger(marker.x)) byId.set(marker.id, marker);
    }
    return [...byId.values()];
  }

  function boardPaint() {
    if (!map || !camera) return;
    const editor = tool === "walls" ? ensureWallEditor() : null;
    const markers = studioBoardMarkers();
    // Bust background cache when art/markers change (kennel hitch must not stick in the cache).
    const markerKey = markers.map((m) => [m.id, m.x, m.y, m.type, m.kind || "", m.state || "", m.studioHidden ? 1 : 0].join(":")).join("|");
    const backgroundKey = [
      map.key || "map",
      art ? "art" : "schematic",
      battle.gridOverlay ?? "printed",
      tool,
      (battle.actors ?? []).filter((a) => a.chained).map((a) => a.id + "@" + a.x + "," + a.y).join(";"),
      markerKey,
      "studio-show-hidden-v1",
    ].join(":");
    const tokenImages = collectTokenImages();
    camera.paint((canvas, view) => {
      drawGrid(canvas, view, map, battle, {
        // drawGrid compares against actor.id strings (same as the room UI).
        room: null, selected: selected?.actor?.id || selected?.id || null, target: null, hovered: null, cursor: null,
        art, path: null, visible: null, fog: false,
        footprint: null, showRegions: true,
        markers,
        tokenImages, tokenPositions: null, movementLabels: null,
        overlay: art ? (battle.gridOverlay ?? "printed") : "tactical",
        wallEditor: editor,
        backgroundKey,
      });
    });
  }

  /** Fit after the stage has a real size (flex layout can settle a frame late). */
  function fitBoard(request = selectGeneration) {
    requestAnimationFrame(() => {
      if (request !== selectGeneration || !camera || !host.isConnected) return;
      camera.control("fit");
      boardPaint();
      requestAnimationFrame(() => {
        if (request !== selectGeneration || !camera || !host.isConnected) return;
        boardPaint();
      });
    });
  }

  /** Refresh overlays without tearing down the full-bleed board. */
  function paintPanels() {
    const rail = host.querySelector("[data-studio-rail]");
    const inspector = host.querySelector("[data-studio-inspector]");
    const status = host.querySelector("[data-studio-status]");
    const title = host.querySelector("[data-studio-map-title]");
    if (status) status.textContent = statusText + (dirty ? (statusText ? " · " : "") + "Unsaved changes" : "");
    if (title) title.textContent = map ? ((map.title || map.key) + " · " + map.module) : "Map Studio";
    if (rail) rail.innerHTML = railHtml();
    if (inspector) inspector.innerHTML = inspectorHtml();
    const save = host.querySelector('[data-studio-action="save"]');
    const discard = host.querySelector('[data-studio-action="discard"]');
    if (save) save.disabled = !map || !dirty;
    if (discard) discard.disabled = !map || !dirty;
  }

  function paintChrome() {
    paintPanels();
  }

  function railHtml() {
    const modules = [
      ...new Set(["LMoP", "YPHub", "CoS", "ToA", "HotDQ", "PotA", "OotA", "SKT", "WDH", "WDMM", "GoS", "DIP", "BGDIA", "IDRotF", "TCE", "training"]),
    ];
    return `
      <h2>Map</h2>
      <label>Module<select name="module">${modules.map((id) =>
        `<option value="${escape(id)}"${id === moduleId ? " selected" : ""}>${escape(id)}</option>`).join("")}</select></label>
      <div class="map-studio-map-list">${maps.map((entry) =>
        `<button type="button" data-pick-map="${escape(entry.key)}" aria-pressed="${map?.key === entry.key}">
          <strong>${escape(entry.title || entry.key)}</strong>
          <small>${escape(entry.caption || entry.id || "")}${catalog.some((t) => t.module === entry.module && t.mapKey === entry.key) ? " · template" : ""}</small>
        </button>`).join("") || "<p class='map-studio-hint'>No maps in this module. Attach the 5etools archive on Overview.</p>"}</div>
      <h2>Tools</h2>
      <div class="map-studio-tools" role="toolbar">${TOOLS.map(([id, label, artName]) =>
        `<button type="button" data-tool="${id}" aria-pressed="${tool === id}">${icon(artName, 16)}<span>${label}</span></button>`).join("")}</div>
    `;
  }

  function featureEditorHtml(feature) {
    const outcomes = Array.isArray(feature.outcomes) ? feature.outcomes : [];
    const check = feature.check || {};
    return `
      <h2>Edit feature</h2>
      <p class="map-studio-hint">${escape(feature.kind)} · ${Number.isInteger(feature.x) ? `${feature.x},${feature.y}` : "unplaced"} · click empty square to move</p>
      <label>Name<input data-edit="feature" data-field="name" value="${escape(feature.name || "")}"></label>
      <label>Kind<select data-edit="feature" data-field="kind">${FEATURE_KINDS.map((k) =>
        `<option value="${k}"${feature.kind === k ? " selected" : ""}>${k}</option>`).join("")}</select></label>
      <label>State<select data-edit="feature" data-field="state">${FEATURE_STATES.map((s) =>
        `<option value="${s}"${feature.state === s ? " selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Region id<input data-edit="feature" data-field="regionId" value="${escape(feature.regionId || feature.origin || "")}"></label>
      <label>What players see (surface)<textarea data-edit="feature" data-field="surfaceText" rows="3">${escape(feature.surfaceText || "")}</textarea></label>
      <label>DM truth / interaction<textarea data-edit="feature" data-field="truthText" rows="3">${escape(feature.truthText || "")}</textarea></label>
      <label>Requires item<input data-edit="feature" data-field="requiresItem" value="${escape(feature.requiresItem || "")}" placeholder="optional item name"></label>
      <div class="map-studio-edit-row">
        <label>Check skill<input data-edit="feature" data-field="checkSkill" value="${escape(check.skill || "")}" placeholder="perception"></label>
        <label>DC<input data-edit="feature" data-field="checkDc" type="number" min="1" max="40" value="${check.dc ?? ""}"></label>
      </div>
      <label>Passive Perception DC<input data-edit="feature" data-field="passivePerceptionDC" type="number" min="1" max="40" value="${feature.passivePerceptionDC ?? ""}"></label>
      <h3 class="map-studio-subhead">Events / outcomes</h3>
      <p class="map-studio-hint">These fire on investigate / use / trigger (step-on traps).</p>
      ${outcomes.map((outcome, index) => `
        <div class="map-studio-outcome" data-outcome-index="${index}">
          <div class="map-studio-edit-row">
            <label>When<select data-edit="outcome" data-index="${index}" data-field="on">${OUTCOME_ONS.map((v) =>
              `<option value="${v}"${(outcome.on || "success") === v ? " selected" : ""}>${v}</option>`).join("")}</select></label>
            <label>Effect<select data-edit="outcome" data-index="${index}" data-field="effect">${OUTCOME_EFFECTS.map((v) =>
              `<option value="${v}"${(outcome.effect || "reveal") === v ? " selected" : ""}>${v}</option>`).join("")}</select></label>
          </div>
          <label>Text / log<textarea data-edit="outcome" data-index="${index}" data-field="text" rows="2">${escape(outcome.text || "")}</textarea></label>
          <label>Set state<select data-edit="outcome" data-index="${index}" data-field="state">
            <option value="">(none)</option>
            ${FEATURE_STATES.map((s) => `<option value="${s}"${outcome.state === s ? " selected" : ""}>${s}</option>`).join("")}
          </select></label>
          <div class="map-studio-edit-row">
            <label>Creature<input data-edit="outcome" data-index="${index}" data-field="creature" value="${escape(outcome.creature || "")}" placeholder="spawn name"></label>
            <label>Source<input data-edit="outcome" data-index="${index}" data-field="source" value="${escape(outcome.source || "")}" placeholder="MM"></label>
          </div>
          <label>Unlock feature id<input data-edit="outcome" data-index="${index}" data-field="targetFeatureId" value="${escape(outcome.targetFeatureId || "")}"></label>
          <button type="button" class="button outline small" data-studio-action="remove-outcome" data-index="${index}">Remove outcome</button>
        </div>
      `).join("") || `<p class="map-studio-hint">No outcomes yet.</p>`}
      <button type="button" class="button outline" data-studio-action="add-outcome">Add outcome</button>
      <button type="button" class="button outline" data-studio-action="delete-selected">Remove feature</button>
      <button type="button" class="button outline" data-studio-action="clear-selection">Deselect</button>
    `;
  }

  function actorEditorHtml(actor) {
    return `
      <h2>Edit creature</h2>
      <p class="map-studio-hint">${escape(actor.source || "MM")} · ${Number.isInteger(actor.x) ? `${actor.x},${actor.y}` : "unplaced"} — click empty square to move</p>
      <label>Name<input data-edit="actor" data-field="name" value="${escape(actor.name || "")}"></label>
      <label>Stat name<input data-edit="actor" data-field="statName" value="${escape(actor.statName || "")}" placeholder="bestiary name"></label>
      <label>Source<input data-edit="actor" data-field="source" value="${escape(actor.source || "MM")}"></label>
      <label>Side<select data-edit="actor" data-field="side">${ACTOR_SIDES.map((s) =>
        `<option value="${s}"${(actor.side || "hostile") === s ? " selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Origin room<input data-edit="actor" data-field="origin" value="${escape(actor.origin || "")}" placeholder="e.g. 021"></label>
      <div class="map-studio-edit-row">
        <label>HP<input data-edit="actor" data-field="hp" type="number" min="0" value="${actor.hp ?? ""}"></label>
        <label>Max HP<input data-edit="actor" data-field="maxHp" type="number" min="1" value="${actor.maxHp ?? ""}"></label>
      </div>
      <label>AC<input data-edit="actor" data-field="ac" type="number" min="0" value="${actor.ac ?? ""}"></label>
      <label>Marker <span class="map-studio-hint">(token when art missing)</span>
        <input data-edit="actor" data-field="marker" value="${escape(actor.marker || "")}" maxlength="4"></label>
      <label class="map-studio-check"><input type="checkbox" data-edit="actor" data-field="chained"${actor.chained ? " checked" : ""}> Tethered / chained</label>
      <label>Notes / interaction<textarea data-edit="actor" data-field="studioNotes" rows="3" placeholder="DM notes, dialogue cues, special behavior">${escape(actor.studioNotes || actor.notes || "")}</textarea></label>
      <button type="button" class="button outline" data-studio-action="delete-selected">Remove creature</button>
      <button type="button" class="button outline" data-studio-action="clear-selection">Deselect</button>
    `;
  }

  function spawnEditorHtml(spawn) {
    return `
      <h2>Edit spawn</h2>
      <p class="map-studio-hint">${spawn.x},${spawn.y} — click empty square to move</p>
      <label>Name<input data-edit="spawn" data-field="name" value="${escape(spawn.name || "")}" maxlength="40"></label>
      <label>Origin<input data-edit="spawn" data-field="origin" value="${escape(spawn.origin || "")}"></label>
      <button type="button" class="button outline" data-studio-action="delete-selected">Remove spawn</button>
      <button type="button" class="button outline" data-studio-action="clear-selection">Deselect</button>
    `;
  }

  function inspectorHtml() {
    if (!map) return `<p class="map-studio-hint">Choose a module and map to begin.</p>`;
    if (selected?.kind === "feature" && liveFeature()) return featureEditorHtml(liveFeature());
    if (selected?.kind === "actor" && liveActor()) return actorEditorHtml(liveActor());
    if (selected?.kind === "spawn" && liveSpawn()) return spawnEditorHtml(liveSpawn());
    if (tool === "monster") {
      const homebrew = listHomebrew("monsters");
      return `
        <h2>Place monster</h2>
        <label>Search name<input name="monster-name" value="${escape(monsterPick.name)}" list="studio-monster-list"></label>
        <label>Source<input name="monster-source" value="${escape(monsterPick.source)}"></label>
        <datalist id="studio-monster-list">${(monsterSuggestions ?? []).slice(0, 40).map((m) =>
          `<option value="${escape(m.name)}">${escape(m.source)}</option>`).join("")}</datalist>
        <p class="map-studio-hint">Click empty cells to place. Click a creature to edit name, HP, notes, and more.</p>
        <div class="map-studio-entity-list">${(battle.actors ?? []).filter((a) => a.side !== "party").map((a) =>
          `<button type="button" data-select-actor="${escape(a.id)}" aria-pressed="${selected?.id === a.id}">${escape(a.name)} · ${a.x},${a.y}</button>`).join("") || "<p class='map-studio-hint'>No monsters placed.</p>"}</div>
      `;
    }
    if (tool === "spawn") {
      return `
        <h2>Spawn points</h2>
        <label>Name<input name="spawn-name" value="${escape(spawnName)}" maxlength="40"></label>
        <p class="map-studio-hint">Click a cell to place. Click a spawn to edit it.</p>
        <div class="map-studio-entity-list">${spawnMarkers(battle).map((s) =>
          `<button type="button" data-select-spawn="${escape(s.id)}" aria-pressed="${selected?.id === s.id}">${escape(s.name)} · ${s.x},${s.y}</button>`).join("") || "<p class='map-studio-hint'>No spawn points.</p>"}</div>
      `;
    }
    if (tool === "feature") {
      return `
        <h2>Features / events</h2>
        <label>Kind<select name="feature-kind">${FEATURE_KINDS.map((k) =>
          `<option value="${k}"${featureDraft.kind === k ? " selected" : ""}>${k}</option>`).join("")}</select></label>
        <label>Name<input name="feature-name" value="${escape(featureDraft.name)}"></label>
        <label>Surface text<textarea name="feature-surface" rows="2">${escape(featureDraft.surfaceText)}</textarea></label>
        <label>Truth text<textarea name="feature-truth" rows="2">${escape(featureDraft.truthText)}</textarea></label>
        <p class="map-studio-hint">Place new features here, or click one on the board to edit descriptions, checks, and outcomes.</p>
        <div class="map-studio-entity-list">${(battle.features ?? []).filter((f) => !isKennelHitch(f)).map((f) =>
          `<button type="button" data-select-feature="${escape(f.id)}" aria-pressed="${selected?.id === f.id}">${escape(f.kind)} · ${escape(f.name)}${f.state && f.state !== "revealed" ? ` · ${escape(f.state)}` : ""}${Number.isInteger(f.x) ? ` · ${f.x},${f.y}` : ""}</button>`).join("") || "<p class='map-studio-hint'>No features.</p>"}</div>
      `;
    }
    if (tool === "walls") {
      return `<h2>Walls / doors</h2><p class="map-studio-hint">Use the wall toolbar on the board. Saved walls become the default for new rooms (baked walls will not overwrite them).</p>${ensureWallEditor().toolbar()}`;
    }
    if (tool === "fog") {
      const settings = fogSettings(battle);
      return `
        <h2>Default fog</h2>
        <label class="map-studio-check"><input type="checkbox" name="fog-enabled"${battle.fogEnabled ? " checked" : ""}> Fog enabled by default</label>
        <label class="map-studio-check"><input type="checkbox" name="fog-shared"${settings.sharedVision ? " checked" : ""}> Shared vision</label>
        <label class="map-studio-check"><input type="checkbox" name="fog-remember"${settings.remember ? " checked" : ""}> Remember explored</label>
        <label class="map-studio-check"><input type="checkbox" name="fog-block"${settings.blockMovement ? " checked" : ""}> Block movement</label>
        <label>Opacity %<input type="number" name="fog-opacity" min="0" max="100" value="${Math.round((settings.opacity ?? 1) * 100)}"></label>
        <label>Explored opacity %<input type="number" name="fog-explored" min="0" max="100" value="${Math.round((settings.exploredOpacity ?? 0.65) * 100)}"></label>
        <label>Softness<input type="number" name="fog-softness" min="0" max="5" step="0.1" value="${settings.softness ?? 2}"></label>
        <button type="button" class="button" data-studio-action="apply-fog">Apply fog settings</button>
      `;
    }
    if (tool === "grid") {
      const g = map;
      return `
        <h2>Grid / size</h2>
        <p class="map-studio-hint">${g.cols}×${g.rows} cells · ${g.width}×${g.height}px artwork</p>
        <label>Overlay<select name="grid-overlay">
          ${[["artwork","Artwork only"],["printed","Artwork guides"],["tactical","5-foot cells"]].map(([v,l]) =>
            `<option value="${v}"${(battle.gridOverlay ?? "printed") === v ? " selected" : ""}>${l}</option>`).join("")}
        </select></label>
        <label>Feet per printed square<select name="grid-square-ft">
          <option value="5"${(battle.gridSquareFt ?? 5) === 5 ? " selected" : ""}>5 ft</option>
          <option value="10"${battle.gridSquareFt === 10 ? " selected" : ""}>10 ft</option>
        </select></label>
        <label>Cell width (px)<input type="number" name="cell-width" value="${g.cellWidth ?? g.size}"></label>
        <label>Cell height (px)<input type="number" name="cell-height" value="${g.cellHeight ?? g.size}"></label>
        <label>Offset X<input type="number" name="offset-x" value="${g.offsetX ?? 0}"></label>
        <label>Offset Y<input type="number" name="offset-y" value="${g.offsetY ?? 0}"></label>
        <button type="button" class="button" data-studio-action="apply-grid">Apply grid</button>
      `;
    }
    if (tool === "upload") {
      return `
        <h2>Upload map</h2>
        <p class="map-studio-hint">Set default artwork for this template. New rooms use it when no session artwork is set.</p>
        <input type="file" accept="image/png,image/jpeg,image/webp" name="map-upload">
        <button type="button" class="button" data-studio-action="upload-art">Upload &amp; attach</button>
        ${artworkId ? `<p class="map-studio-hint">Artwork attached (${artworkId.slice(0, 12)}…)</p>` : ""}
      `;
    }
    if (tool === "select") {
      const monsters = (battle.actors ?? []).filter((a) => a.side !== "party");
      const features = (battle.features ?? []).filter((f) => !isKennelHitch(f));
      return `
        <h2>Select / edit</h2>
        <p class="map-studio-hint">Click anything on the board to edit its descriptions, events, and stats. Empty square moves the selection.</p>
        <h3 class="map-studio-subhead">Creatures</h3>
        <div class="map-studio-entity-list">${monsters.map((a) =>
          `<button type="button" data-select-actor="${escape(a.id)}" aria-pressed="${selected?.id === a.id}">${escape(a.name)} · ${a.x},${a.y}</button>`).join("") || "<p class='map-studio-hint'>No monsters.</p>"}</div>
        <h3 class="map-studio-subhead">Features / events</h3>
        <div class="map-studio-entity-list">${features.map((f) =>
          `<button type="button" data-select-feature="${escape(f.id)}" aria-pressed="${selected?.id === f.id}">${escape(f.kind)} · ${escape(f.name)}${Number.isInteger(f.x) ? ` · ${f.x},${f.y}` : ""}</button>`).join("") || "<p class='map-studio-hint'>No features.</p>"}</div>
        <h3 class="map-studio-subhead">Spawns</h3>
        <div class="map-studio-entity-list">${spawnMarkers(battle).map((s) =>
          `<button type="button" data-select-spawn="${escape(s.id)}" aria-pressed="${selected?.id === s.id}">${escape(s.name)} · ${s.x},${s.y}</button>`).join("") || "<p class='map-studio-hint'>No spawns.</p>"}</div>
        <label>Template notes<textarea name="template-notes" rows="3">${escape(notes)}</textarea></label>
      `;
    }
    const counts = {
      monsters: (battle.actors ?? []).filter((a) => a.side !== "party").length,
      spawns: spawnMarkers(battle).length,
      features: (battle.features ?? []).length,
      walls: (battle.wallData?.walls?.length ?? 0) + (battle.wallData?.doors?.length ?? 0),
    };
    return `
      <h2>Inspector</h2>
      <p class="map-studio-hint">${escape(map.title || map.key)}</p>
      <ul class="map-studio-hint">
        <li>${counts.monsters} monsters</li>
        <li>${counts.spawns} spawns</li>
        <li>${counts.features} features</li>
        <li>${counts.walls} wall/door segments</li>
        <li>Fog ${battle.fogEnabled ? "on" : "off"}</li>
      </ul>
      <label>Notes<textarea name="template-notes" rows="4">${escape(notes)}</textarea></label>
    `;
  }

  function paint() {
    host.innerHTML = `
      <section class="map-studio-screen" aria-label="Map Studio">
        <header class="map-studio-top">
          <div class="map-studio-top-left">
            <a class="button outline small" href="#overview">${icon("home", 15)} Desk</a>
            <div class="map-studio-title">
              <strong data-studio-map-title>${escape(map ? ((map.title || map.key) + " · " + map.module) : "Map Studio")}</strong>
              <small data-studio-status role="status">${escape(statusText)}${dirty ? (statusText ? " · " : "") + "Unsaved changes" : ""}</small>
            </div>
          </div>
          <div class="map-studio-top-right">
            <button type="button" class="button small" data-studio-action="save" ${!map || !dirty ? "disabled" : ""}>Save template</button>
            <button type="button" class="button outline small" data-studio-action="discard" ${!map || !dirty ? "disabled" : ""}>Discard</button>
            <button type="button" class="button outline small" data-studio-action="preview" ${!map ? "disabled" : ""}>Apply to preview</button>
          </div>
        </header>
        <div class="map-studio-stage">
          ${map ? mapViewport(map, true) : `<div class="map-studio-empty"><strong>Choose a map</strong><span>Pick a module and map from the left rail.</span></div>`}
          ${map ? `<div class="map-studio-board-chrome">${mapHint()}${mapControls(false)}</div>` : ""}
          <aside class="map-studio-rail" data-studio-rail aria-label="Map Studio tools">${railHtml()}</aside>
          <aside class="map-studio-inspector" data-studio-inspector aria-label="Inspector">${inspectorHtml()}</aside>
        </div>
      </section>
    `;

    const frame = host.querySelector(".board-frame");
    const controls = host.querySelector(".map-controls");
    camera?.destroy?.();
    camera = null;
    if (map && frame && controls) {
      // onView must not call boardPaint — camera.paint → render → onView would recurse forever.
      // onTap runs only for real clicks (camera already filtered out pans).
      camera = createCamera(frame, controls, map, null, null, (event) => { void handleBoardTap(event); });
      boardPaint();
      fitBoard();
    }
  }

  async function placeMonsterAt(x, y) {
    const source = (monsterPick.source || "MM").trim();
    const homebrew = listHomebrew("monsters").find((m) =>
      m.name.toLowerCase() === monsterPick.name.toLowerCase());
    let actor;
    if (homebrew && /^(hb|homebrew)$/i.test(source)) {
      actor = await creatureActor({
        name: homebrew.name,
        source: "HB",
        side: homebrew.side ?? "hostile",
        data: monsterStatBlock(homebrew),
      });
    } else {
      actor = await creatureActor({ name: monsterPick.name, source });
    }
    if (!canStand(battle, actor, x, y, map)) throw new Error("That square cannot hold this creature.");
    placeToken(battle, actor, x, y, map);
    battle.actors.push(actor);
    selected = { kind: "actor", id: actor.id, actor };
    markDirty();
    setStatus("Placed " + actor.name + " at " + x + "," + y + ".");
  }

  function placeFeatureAt(x, y) {
    const feature = normalizeFeature({
      ...featureDraft,
      x, y,
      regionId: "studio",
      state: "hidden",
    }, { moduleId: map.module, mapKey: map.id || map.key, regionId: "studio" });
    feature.x = x;
    feature.y = y;
    battle.features ??= [];
    battle.features.push(feature);
    battle.markers ??= [];
    battle.markers.push(markerFromFeature(feature));
    selected = { kind: "feature", id: feature.id, feature };
    markDirty();
    setStatus("Placed " + feature.name + ".");
  }

  function placeSpawnAt(x, y) {
    const marker = createSpawnMarker(battle, { x, y, name: spawnName });
    selected = { kind: "spawn", id: marker.id, spawn: marker };
    markDirty();
    setStatus("Spawn “" + marker.name + "” at " + x + "," + y + ".");
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.kind === "actor") {
      battle.actors = battle.actors.filter((a) => a.id !== selected.id);
    } else if (selected.kind === "spawn") {
      removeSpawnMarker(battle, selected.id);
    } else if (selected.kind === "feature") {
      battle.features = (battle.features ?? []).filter((f) => f.id !== selected.id);
      battle.markers = (battle.markers ?? []).filter((m) => m.id !== selected.id);
    }
    selected = null;
    markDirty();
  }

  function moveSelectedTo(x, y) {
    if (!selected || !map) return false;
    if (selected.kind === "actor") {
      const actor = battle.actors.find((entry) => entry.id === selected.id);
      if (!actor) return false;
      if (actor.x === x && actor.y === y) return true;
      if (!canStand(battle, actor, x, y, map)) throw new Error("That square cannot hold " + actor.name + ".");
      placeToken(battle, actor, x, y, map);
      selected = { kind: "actor", id: actor.id, actor };
      markDirty();
      setStatus("Moved " + actor.name + " to " + x + "," + y + ".");
      return true;
    }
    if (selected.kind === "spawn") {
      const spawn = spawnMarkers(battle).find((marker) => marker.id === selected.id);
      if (!spawn) return false;
      spawn.x = x;
      spawn.y = y;
      selected = { kind: "spawn", id: spawn.id, spawn };
      markDirty();
      setStatus("Moved spawn “" + spawn.name + "” to " + x + "," + y + ".");
      return true;
    }
    if (selected.kind === "feature") {
      const feature = (battle.features ?? []).find((entry) => entry.id === selected.id);
      if (!feature) return false;
      feature.x = x;
      feature.y = y;
      const marker = (battle.markers ?? []).find((entry) => entry.id === feature.id || entry.featureId === feature.id);
      if (marker) { marker.x = x; marker.y = y; }
      selected = { kind: "feature", id: feature.id, feature };
      markDirty();
      setStatus("Moved " + (feature.name || feature.kind) + " to " + x + "," + y + ".");
      return true;
    }
    return false;
  }

  function selectAtBoard(px, py, cellX, cellY) {
    const actor = tokenAtPoint(map, battle, px, py)
      ?? (battle.actors ?? []).find((entry) => occupies(entry) && containsCell(entry, cellX, cellY));
    if (actor) {
      if (selected?.kind === "actor" && selected.id === actor.id) {
        selected = null;
        setStatus("Deselected " + actor.name + ".");
      } else {
        selected = { kind: "actor", id: actor.id, actor };
        setStatus("Selected " + actor.name + " — click an empty square to move.");
      }
      paintPanels();
      boardPaint();
      return true;
    }
    const spawn = spawnMarkers(battle).find((marker) => marker.x === cellX && marker.y === cellY);
    if (spawn) {
      selected = { kind: "spawn", id: spawn.id, spawn };
      setStatus("Selected spawn “" + spawn.name + "” — click an empty square to move.");
      paintPanels();
      boardPaint();
      return true;
    }
    const feature = (battle.features ?? []).find((entry) =>
      entry.id !== "LMoP|1ab|021|chain-pole" && Number.isInteger(entry.x) && entry.x === cellX && entry.y === cellY);
    if (feature) {
      selected = { kind: "feature", id: feature.id, feature };
      setStatus("Selected " + (feature.name || feature.kind) + " — click an empty square to move.");
      paintPanels();
      boardPaint();
      return true;
    }
    selected = null;
    setStatus("Nothing on that square (" + cellX + "," + cellY + ").");
    paintPanels();
    boardPaint();
    return false;
  }

  function boardGridSurface() {
    return host.querySelector(".board-frame #play-grid");
  }

  function mapCellBounds() {
    const cellW = map.cellWidth ?? map.size;
    const cellH = map.cellHeight ?? map.size;
    return {
      cols: map.cols ?? Math.max(1, Math.ceil((map.width - (map.offsetX || 0)) / cellW)),
      rows: map.rows ?? Math.max(1, Math.ceil((map.height - (map.offsetY || 0)) / cellH)),
    };
  }

  async function handleBoardTap(event) {
    if (!map) return;
    if (tool === "walls" || tool === "fog" || tool === "grid" || tool === "upload") return;
    if (event.target.closest?.("[data-camera],.map-studio-rail,.map-studio-inspector,.map-studio-top,.map-studio-board-chrome,.wall-editor-host")) return;
    const surface = boardGridSurface();
    if (!surface) return;
    const pos = gridPosition(map, surface, event);
    const x = Number.isInteger(pos.x) ? pos.x : Math.floor(pos.gx);
    const y = Number.isInteger(pos.y) ? pos.y : Math.floor(pos.gy);
    const { cols, rows } = mapCellBounds();

    // Clicking a token selects it; re-clicking the same token deselects.
    const hit = tokenAtPoint(map, battle, pos.px, pos.py)
      ?? (battle.actors ?? []).find((entry) => occupies(entry) && containsCell(entry, x, y));
    if (hit) {
      if (selected?.kind === "actor" && selected.id === hit.id) {
        selected = null;
        setStatus("Deselected " + hit.name + ".");
      } else {
        selected = { kind: "actor", id: hit.id, actor: hit };
        if (tool !== "monster" && tool !== "select") tool = "select";
        setStatus("Selected " + hit.name + " — click an empty square to move.");
      }
      paintPanels();
      boardPaint();
      return;
    }

    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      setStatus("Outside the grid.");
      return;
    }
    try {
      // With something selected, an empty square moves it (Select or Place monster).
      if (selected && (tool === "select" || tool === "monster" || tool === "spawn" || tool === "feature")) {
        if (tool === "monster" && selected.kind !== "actor") {
          await placeMonsterAt(x, y);
        } else if (tool === "spawn" && selected.kind !== "spawn") {
          placeSpawnAt(x, y);
        } else if (tool === "feature" && selected.kind !== "feature") {
          placeFeatureAt(x, y);
        } else if (moveSelectedTo(x, y)) {
          paintPanels();
          boardPaint();
          return;
        }
        paintPanels();
        boardPaint();
        return;
      }
      if (tool === "select") {
        selectAtBoard(pos.px, pos.py, x, y);
        return;
      }
      if (tool === "monster") await placeMonsterAt(x, y);
      else if (tool === "spawn") placeSpawnAt(x, y);
      else if (tool === "feature") placeFeatureAt(x, y);
      paintPanels();
      boardPaint();
    } catch (error) {
      setStatus(error.message || "Could not place.");
    }
  }

  function applyFeatureField(feature, field, value) {
    if (field === "name") feature.name = value;
    else if (field === "kind" && FEATURE_KINDS.includes(value)) feature.kind = value;
    else if (field === "state" && FEATURE_STATES.includes(value)) setFeatureState(feature, value);
    else if (field === "regionId") { feature.regionId = value; feature.origin = value; }
    else if (field === "surfaceText") feature.surfaceText = value;
    else if (field === "truthText") feature.truthText = value;
    else if (field === "requiresItem") {
      if (value) feature.requiresItem = value;
      else delete feature.requiresItem;
    } else if (field === "checkSkill" || field === "checkDc") {
      const skill = field === "checkSkill" ? value : (feature.check?.skill || "investigation");
      const dcRaw = field === "checkDc" ? value : (feature.check?.dc ?? "");
      const dc = Number(dcRaw);
      if (skill && Number.isFinite(dc) && dc > 0) feature.check = { skill: String(skill).toLowerCase(), dc };
      else if (!skill && !(Number.isFinite(dc) && dc > 0)) delete feature.check;
      else if (feature.check) {
        if (field === "checkSkill") feature.check.skill = String(skill || feature.check.skill).toLowerCase();
        if (field === "checkDc" && Number.isFinite(dc) && dc > 0) feature.check.dc = dc;
      }
    } else if (field === "passivePerceptionDC") {
      const dc = Number(value);
      if (Number.isFinite(dc) && dc > 0) feature.passivePerceptionDC = dc;
      else delete feature.passivePerceptionDC;
    }
    syncMarkerForFeature(battle, feature);
    const marker = (battle.markers ?? []).find((entry) => entry.id === feature.id || entry.featureId === feature.id);
    if (marker) {
      marker.name = feature.name;
      marker.detail = feature.truthText || feature.surfaceText;
      marker.kind = feature.kind;
      marker.type = feature.kind === "creature_hint" ? "creature"
        : feature.kind === "secret" || feature.kind === "mechanism" || feature.kind === "lore" ? "object"
        : FEATURE_KINDS.includes(feature.kind) ? feature.kind : "object";
    }
    refreshSelectedRefs();
    touchDirty(["name", "kind", "state"].includes(field));
  }

  function applyActorField(actor, field, value, checked) {
    if (field === "name") actor.name = value;
    else if (field === "statName") actor.statName = value || undefined;
    else if (field === "source") actor.source = value || "MM";
    else if (field === "side" && ACTOR_SIDES.includes(value)) actor.side = value;
    else if (field === "origin") actor.origin = value || undefined;
    else if (field === "marker") actor.marker = value || undefined;
    else if (field === "studioNotes") actor.studioNotes = value;
    else if (field === "chained") actor.chained = Boolean(checked);
    else if (field === "hp" || field === "maxHp" || field === "ac") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) actor[field] = n;
    }
    refreshSelectedRefs();
    touchDirty(field === "name" || field === "marker" || field === "side" || field === "chained");
  }

  function applySpawnField(spawn, field, value) {
    if (field === "name") spawn.name = value.slice(0, 40);
    else if (field === "origin") spawn.origin = value || undefined;
    refreshSelectedRefs();
    touchDirty(true);
  }

  function applyOutcomeField(feature, index, field, value) {
    feature.outcomes ??= [];
    const outcome = feature.outcomes[index];
    if (!outcome) return;
    if (field === "on") outcome.on = value || "success";
    else if (field === "effect") outcome.effect = value || "reveal";
    else if (field === "text") {
      if (value) outcome.text = value;
      else delete outcome.text;
    } else if (field === "state") {
      if (value && FEATURE_STATES.includes(value)) outcome.state = value;
      else delete outcome.state;
    } else if (field === "creature") {
      if (value) outcome.creature = value;
      else delete outcome.creature;
    } else if (field === "source") {
      if (value) outcome.source = value;
      else delete outcome.source;
    } else if (field === "targetFeatureId") {
      if (value) outcome.targetFeatureId = value;
      else delete outcome.targetFeatureId;
    }
    refreshSelectedRefs();
    touchDirty();
  }

  host.addEventListener("input", (event) => {
    const t = event.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.edit === "feature") {
      const feature = liveFeature();
      if (feature) applyFeatureField(feature, t.dataset.field, t.value);
      return;
    }
    if (t.dataset.edit === "actor") {
      const actor = liveActor();
      if (actor) applyActorField(actor, t.dataset.field, t.value, t.checked);
      return;
    }
    if (t.dataset.edit === "spawn") {
      const spawn = liveSpawn();
      if (spawn) applySpawnField(spawn, t.dataset.field, t.value);
      return;
    }
    if (t.dataset.edit === "outcome") {
      const feature = liveFeature();
      if (feature) applyOutcomeField(feature, Number(t.dataset.index), t.dataset.field, t.value);
    }
  });

  host.addEventListener("change", (event) => {
    const t = event.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.edit === "feature") {
      const feature = liveFeature();
      if (feature) applyFeatureField(feature, t.dataset.field, t.value);
      return;
    }
    if (t.dataset.edit === "actor") {
      const actor = liveActor();
      if (actor) applyActorField(actor, t.dataset.field, t.value, t.checked);
      return;
    }
    if (t.dataset.edit === "spawn") {
      const spawn = liveSpawn();
      if (spawn) applySpawnField(spawn, t.dataset.field, t.value);
      return;
    }
    if (t.dataset.edit === "outcome") {
      const feature = liveFeature();
      if (feature) applyOutcomeField(feature, Number(t.dataset.index), t.dataset.field, t.value);
      return;
    }
    if (t.name === "module") {
      void loadModuleMaps(t.value);
      return;
    }
    if (t.name === "monster-name") monsterPick = { ...monsterPick, name: t.value };
    if (t.name === "monster-source") monsterPick = { ...monsterPick, source: t.value };
    if (t.name === "spawn-name") spawnName = t.value;
    if (t.name === "feature-kind") featureDraft = { ...featureDraft, kind: t.value };
    if (t.name === "feature-name") featureDraft = { ...featureDraft, name: t.value };
    if (t.name === "feature-surface") featureDraft = { ...featureDraft, surfaceText: t.value };
    if (t.name === "feature-truth") featureDraft = { ...featureDraft, truthText: t.value };
    if (t.name === "template-notes") { notes = t.value; touchDirty(); }
    if (t.name === "grid-overlay") { battle.gridOverlay = t.value; markDirty(); }
  });

  host.addEventListener("click", async (event) => {
    const cameraButton = event.target.closest("[data-camera]");
    if (cameraButton && camera) {
      camera.control(cameraButton.dataset.camera);
      return;
    }
    const button = event.target.closest("[data-tool],[data-pick-map],[data-studio-action],[data-select-actor],[data-select-spawn],[data-select-feature],[data-wall-editor]");
    if (!button) return;
    if (button.dataset.tool) {
      tool = button.dataset.tool;
      if (tool === "walls") {
        const editor = ensureWallEditor();
        if (!editor.active) editor.setMode("draw");
      } else if (wallEditor?.active) {
        wallEditor.setMode("");
      }
      paintPanels();
      boardPaint();
      return;
    }
    if (button.dataset.pickMap) {
      const entry = maps.find((m) => m.key === button.dataset.pickMap);
      if (entry) void selectMap(entry);
      return;
    }
    if (button.dataset.selectActor) {
      const actor = battle.actors.find((a) => a.id === button.dataset.selectActor);
      selected = actor ? { kind: "actor", id: actor.id, actor } : null;
      paintPanels();
      boardPaint();
      return;
    }
    if (button.dataset.selectSpawn) {
      const spawn = spawnMarkers(battle).find((s) => s.id === button.dataset.selectSpawn);
      selected = spawn ? { kind: "spawn", id: spawn.id, spawn } : null;
      paintPanels();
      boardPaint();
      return;
    }
    if (button.dataset.selectFeature) {
      const feature = (battle.features ?? []).find((f) => f.id === button.dataset.selectFeature);
      selected = feature ? { kind: "feature", id: feature.id, feature } : null;
      paintPanels();
      boardPaint();
      return;
    }
    if (button.dataset.wallEditor) {
      ensureWallEditor().action(button.dataset.wallEditor);
      return;
    }
    const action = button.dataset.studioAction;
    if (!action) return;
    try {
      if (action === "save") {
        const template = captureTemplateFromBattle(battle, { notes, artworkId });
        const result = await saveMapTemplate(map.module, map.key, template);
        rememberClean();
        await refreshCatalog();
        setStatus(result.source === "remote" ? "Template published." : "Template saved locally.");
        paintPanels();
      } else if (action === "discard") {
        await selectMap(map);
        setStatus("Discarded unsaved changes.");
      } else if (action === "preview") {
        const template = captureTemplateFromBattle(battle, { notes, artworkId });
        const preview = await previewBattleFromTemplate(map, template);
        battle = preview;
        rememberClean();
        dirty = true; // still allow saving the previewed capture
        setStatus(`Preview applied locally — ${preview.actors.length} actors, ${(preview.features ?? []).length} features, ${spawnMarkers(preview).length} spawns.`);
        paintPanels();
        boardPaint();
      } else if (action === "delete-selected") {
        deleteSelected();
        paintPanels();
        boardPaint();
      } else if (action === "clear-selection") {
        selected = null;
        paintPanels();
        boardPaint();
      } else if (action === "add-outcome") {
        const feature = liveFeature();
        if (!feature) return;
        feature.outcomes = Array.isArray(feature.outcomes) ? feature.outcomes : [];
        feature.outcomes.push({ on: "success", effect: "reveal", text: "" });
        refreshSelectedRefs();
        markDirty();
        paintPanels();
      } else if (action === "remove-outcome") {
        const feature = liveFeature();
        if (!feature) return;
        const index = Number(button.dataset.index);
        if (!Number.isInteger(index) || index < 0) return;
        feature.outcomes = (feature.outcomes ?? []).filter((_, i) => i !== index);
        refreshSelectedRefs();
        markDirty();
        paintPanels();
      } else if (action === "apply-fog") {
        const enabled = host.querySelector('[name="fog-enabled"]')?.checked;
        battle.fogEnabled = Boolean(enabled);
        battle.fogSettings = {
          sharedVision: Boolean(host.querySelector('[name="fog-shared"]')?.checked),
          remember: Boolean(host.querySelector('[name="fog-remember"]')?.checked),
          blockMovement: Boolean(host.querySelector('[name="fog-block"]')?.checked),
          opacity: Number(host.querySelector('[name="fog-opacity"]')?.value ?? 100) / 100,
          exploredOpacity: Number(host.querySelector('[name="fog-explored"]')?.value ?? 65) / 100,
          softness: Number(host.querySelector('[name="fog-softness"]')?.value ?? 2),
        };
        markDirty();
        setStatus("Fog defaults updated.");
        paintPanels();
        boardPaint();
      } else if (action === "apply-grid") {
        const cellWidth = Number(host.querySelector('[name="cell-width"]')?.value);
        const cellHeight = Number(host.querySelector('[name="cell-height"]')?.value);
        const offsetX = Number(host.querySelector('[name="offset-x"]')?.value);
        const offsetY = Number(host.querySelector('[name="offset-y"]')?.value);
        const squareFt = Number(host.querySelector('[name="grid-square-ft"]')?.value) === 10 ? 10 : 5;
        if (![cellWidth, cellHeight].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Enter positive cell sizes.");
        map.cellWidth = cellWidth;
        map.cellHeight = cellHeight;
        map.size = Math.min(cellWidth, cellHeight);
        map.offsetX = offsetX;
        map.offsetY = offsetY;
        map.cols = Math.ceil((map.width - offsetX) / cellWidth);
        map.rows = Math.ceil((map.height - offsetY) / cellHeight);
        battle.gridManual = { width: cellWidth, height: cellHeight, x: offsetX, y: offsetY };
        battle.gridSquareFt = squareFt;
        battle.gridOverlay = host.querySelector('[name="grid-overlay"]')?.value || "printed";
        markDirty();
        setStatus("Grid updated.");
        paint();
      } else if (action === "upload-art") {
        const file = host.querySelector('[name="map-upload"]')?.files?.[0];
        if (!file) throw new Error("Choose an image file first.");
        artworkId = await uploadTemplateArtwork(map.module, map.key, file);
        art = await decodeImage(file);
        markDirty();
        setStatus("Artwork uploaded and attached.");
        paintPanels();
        boardPaint();
      }
    } catch (error) {
      setStatus(error.message || "Action failed.");
    }
  });

  // Load monster search suggestions once.
  void fetch("monster-search.json").then((r) => r.ok ? r.json() : []).then((list) => {
    monsterSuggestions = list;
  }).catch(() => { monsterSuggestions = []; });

  paint();
  void (async () => {
    setStatus(hasArchive() ? "Loading maps…" : "Restoring 5etools archive…");
    await restoreArchive().catch(() => null);
    await refreshCatalog();
    if (!hasArchive() && moduleId !== "training" && moduleId !== "YPHub") {
      setStatus("Attach the 5etools archive on Overview to load published adventure maps, or open YPHub / training.");
    }
    await loadModuleMaps(moduleId);
  })();
}
