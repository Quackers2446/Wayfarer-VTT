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
import { FEATURE_KINDS, normalizeFeature, markerFromFeature } from "./room-features.mjs";
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

  function boardPaint() {
    if (!map || !camera) return;
    const editor = tool === "walls" ? ensureWallEditor() : null;
    // Bust background cache when art/markers change (kennel hitch must not stick in the cache).
    const markerKey = (battle.markers ?? []).map((m) => [m.id, m.x, m.y, m.type, m.kind || "", m.hidden ? 1 : 0].join(":")).join("|");
    const backgroundKey = [
      map.key || "map",
      art ? "art" : "schematic",
      battle.gridOverlay ?? "printed",
      (battle.actors ?? []).filter((a) => a.chained).map((a) => a.id + "@" + a.x + "," + a.y).join(";"),
      markerKey,
      "kennel-hitch-v2",
    ].join(":");
    const tokenImages = collectTokenImages();
    camera.paint((canvas, view) => {
      drawGrid(canvas, view, map, battle, {
        room: null, selected: selected?.actor || null, target: null, hovered: null, cursor: null,
        art, path: null, visible: null, fog: false,
        footprint: null, showRegions: true,
        markers: battle.markers ?? [],
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

  function inspectorHtml() {
    if (!map) return `<p class="map-studio-hint">Choose a module and map to begin.</p>`;
    if (tool === "monster") {
      const homebrew = listHomebrew("monsters");
      return `
        <h2>Place monster</h2>
        <label>Search name<input name="monster-name" value="${escape(monsterPick.name)}" list="studio-monster-list"></label>
        <label>Source<input name="monster-source" value="${escape(monsterPick.source)}"></label>
        <datalist id="studio-monster-list">${(monsterSuggestions ?? []).slice(0, 40).map((m) =>
          `<option value="${escape(m.name)}">${escape(m.source)}</option>`).join("")}</datalist>
        <p class="map-studio-hint">Click a cell on the map to place. Homebrew: ${homebrew.length} local monsters available by exact name + source Homebrew.</p>
        <div class="map-studio-entity-list">${(battle.actors ?? []).filter((a) => a.side !== "party").map((a, i) =>
          `<button type="button" data-select-actor="${escape(a.id)}" aria-pressed="${selected?.id === a.id}">${escape(a.name)} · ${a.x},${a.y}</button>`).join("") || "<p class='map-studio-hint'>No monsters placed.</p>"}</div>
        ${selected?.kind === "actor" ? `<button type="button" class="button outline" data-studio-action="delete-selected">Remove selected</button>` : ""}
      `;
    }
    if (tool === "spawn") {
      return `
        <h2>Spawn points</h2>
        <label>Name<input name="spawn-name" value="${escape(spawnName)}" maxlength="40"></label>
        <p class="map-studio-hint">Click a cell to place or rename a spawn at that square.</p>
        <div class="map-studio-entity-list">${spawnMarkers(battle).map((s) =>
          `<button type="button" data-select-spawn="${escape(s.id)}" aria-pressed="${selected?.id === s.id}">${escape(s.name)} · ${s.x},${s.y}</button>`).join("") || "<p class='map-studio-hint'>No spawn points.</p>"}</div>
        ${selected?.kind === "spawn" ? `<button type="button" class="button outline" data-studio-action="delete-selected">Remove selected</button>` : ""}
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
        <p class="map-studio-hint">Click a cell to place this feature as the map default.</p>
        <div class="map-studio-entity-list">${(battle.features ?? []).map((f) =>
          `<button type="button" data-select-feature="${escape(f.id)}" aria-pressed="${selected?.id === f.id}">${escape(f.kind)} · ${escape(f.name)}${Number.isInteger(f.x) ? ` · ${f.x},${f.y}` : ""}</button>`).join("") || "<p class='map-studio-hint'>No features.</p>"}</div>
        ${selected?.kind === "feature" ? `<button type="button" class="button outline" data-studio-action="delete-selected">Remove selected</button>` : ""}
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
      camera = createCamera(frame, controls, map, null, null);
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

  function selectAtBoard(px, py, cellX, cellY) {
    const actor = tokenAtPoint(map, battle, px, py)
      ?? (battle.actors ?? []).find((entry) => occupies(entry) && containsCell(entry, cellX, cellY));
    if (actor) {
      selected = { kind: "actor", id: actor.id, actor };
      tool = "monster";
      setStatus("Selected " + actor.name + " at " + actor.x + "," + actor.y + ".");
      paintPanels();
      boardPaint();
      return true;
    }
    const spawn = spawnMarkers(battle).find((marker) => marker.x === cellX && marker.y === cellY);
    if (spawn) {
      selected = { kind: "spawn", id: spawn.id, spawn };
      tool = "spawn";
      setStatus("Selected spawn “" + spawn.name + "”.");
      paintPanels();
      boardPaint();
      return true;
    }
    const feature = (battle.features ?? []).find((entry) =>
      entry.id !== "LMoP|1ab|021|chain-pole" && Number.isInteger(entry.x) && entry.x === cellX && entry.y === cellY);
    if (feature) {
      selected = { kind: "feature", id: feature.id, feature };
      tool = "feature";
      setStatus("Selected " + (feature.name || feature.kind) + ".");
      paintPanels();
      boardPaint();
      return true;
    }
    selected = null;
    setStatus("Nothing on that square.");
    paintPanels();
    boardPaint();
    return false;
  }

  host.addEventListener("change", (event) => {
    const t = event.target;
    if (!(t instanceof HTMLElement)) return;
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
    if (t.name === "template-notes") { notes = t.value; dirty = true; paintChrome(); }
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

  // Bubble phase so a pan (camera capture stopPropagation) does not also select/place.
  host.addEventListener("click", async (event) => {
    if (tool === "walls" || tool === "fog" || tool === "grid" || tool === "upload") return;
    if (event.target.closest?.("[data-camera],[data-tool],[data-pick-map],[data-studio-action],[data-select-actor],[data-select-spawn],[data-select-feature],[data-wall-editor],.map-studio-rail,.map-studio-inspector,.map-studio-top]")) return;
    const surface = event.target.closest?.("#play-grid");
    if (!surface || !map) return;
    event.preventDefault();
    const pos = gridPosition(map, surface, event);
    const x = Math.floor(pos.gx);
    const y = Math.floor(pos.gy);
    if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return;
    try {
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
