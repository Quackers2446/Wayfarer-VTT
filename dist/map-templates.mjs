/** Shared map-template load / save / apply for Map Studio and first-time populate. */
import { accountRequest, accountState } from "./account-client.mjs";
import { newBattle, placeToken, canStand, keyAt } from "./combat.mjs";
import { actorCells } from "./actor-space.mjs";
import { creatureActor } from "./encounters.mjs";
import { normalizeFeature, markerFromFeature } from "./room-features.mjs";
import { createSpawnMarker, spawnMarkers } from "./spawn-points.mjs";

export const TEMPLATE_VERSION = 1;
const CACHE_KEY = "wayfarer-map-templates-v1";
const MAX_TEMPLATE_BYTES = 512 * 1024;

const readCache = () => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {}; }
  catch { return {}; }
};
const writeCache = (value) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* quota */ }
};

export function templateStorageKey(module, mapKey) {
  return String(module || "") + "\0" + String(mapKey || "");
}

export function emptyTemplate() {
  return {
    version: TEMPLATE_VERSION,
    grid: null,
    wallData: null,
    fog: null,
    spawns: [],
    actors: null,
    features: null,
    markers: null,
    notes: "",
    artworkId: null,
  };
}

function finitePoint(value) {
  return Number.isFinite(value) && Math.abs(value) <= 90000;
}

function validWalls(v) {
  if (v == null) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return ["walls", "doors"].every((type) => v[type] == null || (
    Array.isArray(v[type]) && v[type].length <= 2000 &&
    v[type].every((s) => s && typeof s === "object" &&
      ["x1", "y1", "x2", "y2"].every((k) => finitePoint(s[k])) &&
      (type !== "doors" || (typeof s.id === "string" && ["open", "closed", "locked", "secret"].includes(s.state))))
  ));
}

function validFog(v) {
  if (v == null) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (v.fogEnabled != null && typeof v.fogEnabled !== "boolean") return false;
  const settings = v.fogSettings;
  if (settings == null) return true;
  if (!settings || typeof settings !== "object") return false;
  for (const key of ["sharedVision", "remember", "blockMovement"]) {
    if (settings[key] != null && typeof settings[key] !== "boolean") return false;
  }
  for (const [key, min, max] of [["opacity", 0, 1], ["exploredOpacity", 0, 1], ["softness", 0, 5]]) {
    if (settings[key] != null && !(Number.isFinite(settings[key]) && settings[key] >= min && settings[key] <= max)) return false;
  }
  return true;
}

function validSpawn(entry) {
  return entry && typeof entry === "object" &&
    Number.isInteger(entry.x) && Number.isInteger(entry.y) &&
    typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 40;
}

function validActorPlacement(entry) {
  return entry && typeof entry === "object" &&
    typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 120 &&
    Number.isInteger(entry.x) && Number.isInteger(entry.y) &&
    (entry.source == null || (typeof entry.source === "string" && entry.source.length <= 40)) &&
    (entry.side == null || ["hostile", "neutral", "party"].includes(entry.side)) &&
    (entry.hp == null || (Number.isFinite(entry.hp) && entry.hp >= 0 && entry.hp <= 99999)) &&
    (entry.origin == null || (typeof entry.origin === "string" && entry.origin.length <= 80));
}

/** Normalize / clamp a template payload. Returns null when invalid. */
export function normalizeTemplate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const version = Number(raw.version) || TEMPLATE_VERSION;
  if (version !== TEMPLATE_VERSION) return null;
  const grid = raw.grid == null ? null : (typeof raw.grid === "object" && !Array.isArray(raw.grid) ? {
    ...(raw.grid.alignment && typeof raw.grid.alignment === "object" ? { alignment: structuredClone(raw.grid.alignment) } : {}),
    ...(raw.grid.gridManual && typeof raw.grid.gridManual === "object" ? { gridManual: structuredClone(raw.grid.gridManual) } : {}),
    ...(raw.grid.artworkFit && typeof raw.grid.artworkFit === "object" ? { artworkFit: structuredClone(raw.grid.artworkFit) } : {}),
    ...(raw.grid.gridOverlay != null ? { gridOverlay: String(raw.grid.gridOverlay).slice(0, 24) } : {}),
    ...(raw.grid.gridSquareFt === 5 || raw.grid.gridSquareFt === 10 ? { gridSquareFt: raw.grid.gridSquareFt } : {}),
  } : null);
  if (!validWalls(raw.wallData)) return null;
  if (!validFog(raw.fog)) return null;
  if (raw.spawns != null && (!Array.isArray(raw.spawns) || raw.spawns.length > 200 || !raw.spawns.every(validSpawn))) return null;
  if (raw.actors != null && (!Array.isArray(raw.actors) || raw.actors.length > 400 || !raw.actors.every(validActorPlacement))) return null;
  if (raw.features != null && (!Array.isArray(raw.features) || raw.features.length > 400)) return null;
  if (raw.markers != null && (!Array.isArray(raw.markers) || raw.markers.length > 400)) return null;
  const notes = typeof raw.notes === "string" ? raw.notes.slice(0, 4000) : "";
  const artworkId = typeof raw.artworkId === "string" && /^[a-f0-9]{64}$/.test(raw.artworkId) ? raw.artworkId : null;
  const template = {
    version: TEMPLATE_VERSION,
    grid,
    wallData: raw.wallData == null ? null : structuredClone(raw.wallData),
    fog: raw.fog == null ? null : structuredClone(raw.fog),
    spawns: Array.isArray(raw.spawns) ? raw.spawns.map((s) => ({
      id: typeof s.id === "string" ? s.id.slice(0, 80) : undefined,
      name: String(s.name).normalize("NFKC").trim().slice(0, 40),
      x: s.x, y: s.y,
      ...(s.origin ? { origin: String(s.origin).slice(0, 80) } : {}),
    })) : [],
    actors: raw.actors == null ? null : raw.actors.map((a) => ({
      name: String(a.name).trim().slice(0, 120),
      source: String(a.source || "MM").trim().slice(0, 40),
      side: a.side || "hostile",
      x: a.x, y: a.y,
      ...(a.hp != null ? { hp: Number(a.hp) } : {}),
      ...(a.origin ? { origin: String(a.origin).slice(0, 80) } : {}),
      ...(a.statName ? { statName: String(a.statName).slice(0, 120) } : {}),
    })),
    features: raw.features == null ? null : raw.features.map((f) => normalizeFeature(f, {
      moduleId: raw.moduleId, mapKey: raw.mapKey, regionId: f.regionId || f.origin,
    })),
    markers: raw.markers == null ? null : structuredClone(raw.markers).slice(0, 400),
    notes,
    artworkId: artworkId ?? (typeof raw.artwork_id === "string" ? raw.artwork_id : null),
  };
  if (new TextEncoder().encode(JSON.stringify(template)).byteLength > MAX_TEMPLATE_BYTES) return null;
  return template;
}

/** Capture the editable template fields from a live studio battle. */
export function captureTemplateFromBattle(battle, { notes = "", artworkId = null } = {}) {
  const spawns = spawnMarkers(battle).map((m) => ({
    id: m.id, name: m.name, x: m.x, y: m.y, ...(m.origin ? { origin: m.origin } : {}),
  }));
  const actors = (battle.actors ?? [])
    .filter((a) => a.side !== "party" && Number.isInteger(a.x) && Number.isInteger(a.y))
    .map((a) => ({
      name: a.statName || a.name.replace(/\s\d+$/, ""),
      source: a.source || "MM",
      side: a.side || "hostile",
      x: a.x, y: a.y,
      hp: a.maxHp ?? a.hp,
      ...(a.origin ? { origin: a.origin } : {}),
      ...(a.statName ? { statName: a.statName } : {}),
    }));
  const features = Array.isArray(battle.features) ? battle.features.map((f) => structuredClone(f)) : [];
  const markers = (battle.markers ?? []).filter((m) => m.type !== "spawn").map((m) => structuredClone(m));
  const grid = {
    ...(battle.alignedGrid || battle.gridManual ? { alignment: structuredClone(battle.alignedGrid ?? battle.gridManual) } : {}),
    ...(battle.gridManual ? { gridManual: structuredClone(battle.gridManual) } : {}),
    ...(battle.artworkFit ? { artworkFit: structuredClone(battle.artworkFit) } : {}),
    ...(battle.gridOverlay != null ? { gridOverlay: battle.gridOverlay } : {}),
    ...(battle.gridSquareFt === 5 || battle.gridSquareFt === 10 ? { gridSquareFt: battle.gridSquareFt } : {}),
  };
  return normalizeTemplate({
    version: TEMPLATE_VERSION,
    grid: Object.keys(grid).length ? grid : null,
    wallData: battle.wallData ? structuredClone(battle.wallData) : null,
    fog: (battle.fogEnabled != null || battle.fogSettings)
      ? { fogEnabled: Boolean(battle.fogEnabled), fogSettings: battle.fogSettings ? structuredClone(battle.fogSettings) : undefined }
      : null,
    spawns,
    actors,
    features,
    markers,
    notes,
    artworkId,
  });
}

export function cacheTemplateLocally(module, mapKey, template) {
  const cache = readCache();
  cache[templateStorageKey(module, mapKey)] = {
    module, mapKey, template, updatedAt: Date.now(),
  };
  writeCache(cache);
}

export function readLocalTemplate(module, mapKey) {
  const entry = readCache()[templateStorageKey(module, mapKey)];
  return entry?.template ? normalizeTemplate(entry.template) : null;
}

export function listLocalTemplates() {
  return Object.values(readCache()).map((entry) => ({
    module: entry.module,
    mapKey: entry.mapKey,
    updatedAt: entry.updatedAt ?? 0,
    notes: entry.template?.notes || "",
    hasArtwork: Boolean(entry.template?.artworkId),
  }));
}

export function templateApiPath(module, mapKey, suffix = "") {
  const base = "/api/account/map-templates/" + encodeURIComponent(module) + "/" +
    String(mapKey).split("/").map(encodeURIComponent).join("/");
  return suffix ? base + suffix : base;
}

export async function listMapTemplates() {
  const local = listLocalTemplates();
  if (!accountState().user) return { templates: local, source: "local" };
  try {
    const remote = await accountRequest("/api/account/map-templates");
    const byKey = new Map(local.map((t) => [templateStorageKey(t.module, t.mapKey), t]));
    for (const row of remote.templates ?? []) {
      byKey.set(templateStorageKey(row.module, row.mapKey), row);
    }
    return { templates: [...byKey.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), source: "remote" };
  } catch {
    return { templates: local, source: "local" };
  }
}

const remoteMiss = new Set();

export async function loadMapTemplate(module, mapKey) {
  if (!module || !mapKey) return null;
  const key = templateStorageKey(module, mapKey);
  const local = readLocalTemplate(module, mapKey);
  if (local) return local;
  if (!accountState().user) return null;
  if (remoteMiss.has(key)) return null;
  try {
    const remote = await accountRequest(templateApiPath(module, mapKey));
    if (remote.template == null) {
      remoteMiss.add(key);
      return null;
    }
    const template = normalizeTemplate(remote.template ?? remote);
    if (template) {
      remoteMiss.delete(key);
      cacheTemplateLocally(module, mapKey, template);
      return template;
    }
    remoteMiss.add(key);
    return null;
  } catch (error) {
    // Legacy 404 or transient errors — keep editing from local/empty.
    if (error?.status === 404) remoteMiss.add(key);
    return null;
  }
}

export async function saveMapTemplate(module, mapKey, template) {
  const normalized = normalizeTemplate(template);
  if (!normalized) throw new Error("This map template is invalid or too large.");
  cacheTemplateLocally(module, mapKey, normalized);
  remoteMiss.delete(templateStorageKey(module, mapKey));
  if (!accountState().user) return { template: normalized, source: "local" };
  if (!accountState().betaAdmin) throw new Error("Only a beta admin can publish map templates.");
  const remote = await accountRequest(templateApiPath(module, mapKey), {
    method: "PUT",
    body: { template: normalized },
  });
  const saved = normalizeTemplate(remote.template ?? normalized);
  cacheTemplateLocally(module, mapKey, saved);
  return { template: saved, source: "remote" };
}

export function templateArtworkUrl(module, mapKey, artworkId) {
  if (!artworkId) return null;
  return templateApiPath(module, mapKey, "/artwork") + "?id=" + encodeURIComponent(artworkId);
}

export async function uploadTemplateArtwork(module, mapKey, blob) {
  if (!(blob instanceof Blob)) throw new Error("Choose a map image.");
  if (!accountState().betaAdmin) throw new Error("Only a beta admin can upload template artwork.");
  const buffer = await blob.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  await accountRequest(templateApiPath(module, mapKey, "/artwork"), {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": blob.type || "image/png", "X-Artwork-Id": hash },
  });
  return hash;
}

/**
 * Apply a template onto a battle before / instead of overlapping populate layers.
 * Sets `battle._fromTemplate` flags so populateScene can skip replaced layers.
 */
export async function applyMapTemplate(map, battle, template, { loadActors = true } = {}) {
  const normalized = normalizeTemplate(template);
  if (!normalized || !battle || !map) return { applied: false };
  const flags = { actors: false, features: false, spawns: false, walls: false, fog: false, grid: false };

  if (normalized.grid) {
    if (normalized.grid.gridManual) battle.gridManual = structuredClone(normalized.grid.gridManual);
    if (normalized.grid.alignment) battle.alignedGrid = structuredClone(normalized.grid.alignment);
    if (normalized.grid.artworkFit) battle.artworkFit = structuredClone(normalized.grid.artworkFit);
    if (normalized.grid.gridOverlay != null) battle.gridOverlay = normalized.grid.gridOverlay;
    if (normalized.grid.gridSquareFt === 5 || normalized.grid.gridSquareFt === 10) {
      battle.gridSquareFt = normalized.grid.gridSquareFt;
    }
    flags.grid = true;
  }

  if (normalized.wallData) {
    battle.wallData = structuredClone(normalized.wallData);
    battle.wallData.manual = true;
    battle.wallRevision = (battle.wallRevision ?? 0) + 1;
    flags.walls = true;
  }

  if (normalized.fog) {
    if (normalized.fog.fogEnabled != null) battle.fogEnabled = Boolean(normalized.fog.fogEnabled);
    if (normalized.fog.fogSettings) {
      battle.fogSettings = { ...battle.fogSettings, ...structuredClone(normalized.fog.fogSettings) };
    }
    flags.fog = true;
  }

  if (Array.isArray(normalized.spawns) && normalized.spawns.length) {
    battle.markers ??= [];
    for (const spawn of normalized.spawns) {
      try {
        createSpawnMarker(battle, {
          x: spawn.x, y: spawn.y, name: spawn.name, origin: spawn.origin ?? null,
        });
      } catch { /* skip invalid */ }
    }
    flags.spawns = true;
  }

  if (normalized.features != null) {
    battle.features = [];
    battle.markers = (battle.markers ?? []).filter((m) => m.type === "spawn");
    for (const raw of normalized.features) {
      const feature = normalizeFeature(raw, {
        moduleId: map.module, mapKey: map.id || map.key, regionId: raw.regionId || raw.origin,
      });
      if (Number.isInteger(raw.x) && Number.isInteger(raw.y)) {
        feature.x = raw.x;
        feature.y = raw.y;
      }
      battle.features.push(feature);
      if (["treasure", "trap", "hazard", "object", "creature_hint", "mechanism", "secret", "lore"].includes(feature.kind) ||
          feature.items || feature.lootCurrency) {
        battle.markers.push(markerFromFeature(feature));
      }
    }
    if (normalized.markers?.length) {
      for (const marker of normalized.markers) {
        if (marker.type === "spawn") continue;
        if (battle.markers.some((m) => m.id === marker.id)) continue;
        battle.markers.push(structuredClone(marker));
      }
    }
    flags.features = true;
  }

  if (normalized.actors != null) {
    flags.actors = true;
    if (loadActors) {
      const occupied = new Set(
        (battle.actors ?? []).filter((a) => Number.isInteger(a.x)).flatMap((a) => actorCells(a).map((c) => keyAt(c.x, c.y))),
      );
      for (const [index, placement] of normalized.actors.entries()) {
        try {
          const base = await creatureActor({
            name: placement.name,
            source: placement.source || "MM",
            side: placement.side,
            hp: placement.hp,
          });
          if (!base) continue;
          const actor = structuredClone(base);
          actor.id = "template:" + (map.key || map.id) + ":" + index + ":" + crypto.randomUUID().slice(0, 8);
          actor.side = placement.side || base.side || "hostile";
          if (placement.hp != null) {
            actor.maxHp = placement.hp;
            actor.hp = placement.hp;
          }
          if (placement.origin) actor.origin = placement.origin;
          const cell = canStand(battle, actor, placement.x, placement.y, map)
            ? { x: placement.x, y: placement.y }
            : null;
          if (!cell) {
            battle.unplacedScene ??= {};
            battle.unplacedScene.template = (battle.unplacedScene.template ?? 0) + 1;
            continue;
          }
          placeToken(battle, actor, cell.x, cell.y, map);
          for (const c of actorCells(actor)) occupied.add(keyAt(c.x, c.y));
          battle.actors.push(actor);
        } catch {
          // Creature data missing — leave unplaced count.
          battle.unplacedScene ??= {};
          battle.unplacedScene.template = (battle.unplacedScene.template ?? 0) + 1;
        }
      }
    }
  }

  if (normalized.artworkId) battle.templateArtworkId = normalized.artworkId;
  battle._fromTemplate = flags;
  return { applied: true, flags };
}

/** Build an ephemeral preview battle from a map + template (no campaign write). */
export async function previewBattleFromTemplate(map, template) {
  const battle = newBattle();
  battle.terrain = {};
  battle.markers = [];
  battle.features = [];
  await applyMapTemplate(map, battle, template);
  battle.sceneReady = true;
  return battle;
}
