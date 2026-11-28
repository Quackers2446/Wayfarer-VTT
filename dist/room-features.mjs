/** Unified room feature model for dungeon exploration (Layer 1). */

export const FEATURE_KINDS = Object.freeze([
  "trap", "secret", "hazard", "treasure", "mechanism", "lore", "creature_hint", "object",
]);
export const FEATURE_STATES = Object.freeze([
  "hidden", "hinted", "revealed", "resolved", "triggered",
]);

const slug = (value) => String(value || "feature").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "feature";

/** Normalize a partial feature into the Layer 1 schema. */
export function normalizeFeature(raw = {}, { regionId, mapKey, moduleId } = {}) {
  const kind = FEATURE_KINDS.includes(raw.kind) ? raw.kind : (raw.type === "treasure" ? "treasure" : raw.type === "trap" ? "trap" : raw.type === "hazard" ? "hazard" : raw.type === "creature" ? "creature_hint" : "object");
  const region = raw.regionId ?? regionId ?? raw.origin ?? "";
  const name = String(raw.name || kind).trim() || kind;
  const id = raw.id || [moduleId, mapKey, region, slug(name)].filter(Boolean).join("|");
  let state = FEATURE_STATES.includes(raw.state) ? raw.state : "hidden";
  if (raw.revealed && state === "hidden") state = "revealed";
  if (raw.hidden === false && state === "hidden" && kind !== "trap") state = "revealed";
  const check = raw.check && Number.isFinite(raw.check.dc)
    ? {
        skill: String(raw.check.skill || "investigation").toLowerCase(),
        dc: Number(raw.check.dc),
        ...(raw.check.inferredDC || raw.inferredDC ? { inferredDC: true } : {}),
      }
    : undefined;
  const outcomes = Array.isArray(raw.outcomes)
    ? raw.outcomes.map((entry) => ({
        on: entry.on || "success",
        effect: entry.effect || "reveal",
        ...(entry.creature ? { creature: entry.creature } : {}),
        ...(entry.source ? { source: entry.source } : {}),
        ...(entry.text ? { text: entry.text } : {}),
        ...(entry.state && FEATURE_STATES.includes(entry.state) ? { state: entry.state } : {}),
        ...(entry.targetFeatureId ? { targetFeatureId: entry.targetFeatureId } : {}),
        ...(entry.doorId ? { doorId: entry.doorId } : {}),
        ...(entry.items ? { items: entry.items } : {}),
        ...(entry.lootCurrency ? { lootCurrency: entry.lootCurrency } : {}),
      }))
    : defaultOutcomes(kind);
  return {
    id,
    regionId: region,
    kind,
    name,
    state,
    surfaceText: String(raw.surfaceText || raw.detail || name).trim(),
    truthText: String(raw.truthText || raw.detail || raw.surfaceText || name).trim(),
    ...(Number.isFinite(raw.passivePerceptionDC) ? { passivePerceptionDC: Number(raw.passivePerceptionDC) } : {}),
    ...(check ? { check } : {}),
    ...(raw.inferredDC && !check?.inferredDC ? { inferredDC: true } : {}),
    ...(raw.requiresItem ? { requiresItem: String(raw.requiresItem) } : {}),
    outcomes,
    ...(raw.anchor ? { anchor: raw.anchor } : {}),
    ...(raw.sourceExcerpt ? { sourceExcerpt: String(raw.sourceExcerpt) } : {}),
    ...(raw.items ? { items: structuredClone(raw.items) } : {}),
    ...(raw.lootCurrency ? { lootCurrency: structuredClone(raw.lootCurrency) } : {}),
    ...(raw.detail ? { detail: String(raw.detail) } : {}),
    ...(Number.isInteger(raw.x) ? { x: raw.x } : {}),
    ...(Number.isInteger(raw.y) ? { y: raw.y } : {}),
    origin: raw.origin ?? region,
    hidden: state === "hidden" || state === "hinted",
    revealed: state === "revealed" || state === "resolved" || state === "triggered",
  };
}

function defaultOutcomes(kind) {
  if (kind === "creature_hint") {
    return [{ on: "success", effect: "spawn_creature" }, { on: "success", effect: "reveal" }];
  }
  if (kind === "treasure") return [{ on: "success", effect: "reveal" }, { on: "use", effect: "loot" }];
  if (kind === "trap" || kind === "hazard") return [{ on: "success", effect: "reveal" }, { on: "trigger", effect: "log", text: "The hazard is sprung." }];
  return [{ on: "success", effect: "reveal" }];
}

/** Convert a legacy marker spec into a feature. */
export function featureFromMarker(marker, context = {}) {
  return normalizeFeature({
    ...marker,
    kind: marker.type === "treasure" ? "treasure" : marker.type === "trap" ? "trap" : marker.type === "hazard" ? "hazard" : marker.type === "creature" ? "creature_hint" : "object",
    state: marker.revealed ? "revealed" : marker.hidden ? "hidden" : "revealed",
    surfaceText: marker.hidden
      ? (marker.type === "trap" ? "Something about this spot looks wrong." : "Something here draws a closer look.")
      : (marker.detail || marker.name),
    truthText: marker.detail || marker.name,
  }, context);
}

/** Board marker view of a feature (keeps loot/inspect paths working). */
export function markerFromFeature(feature) {
  const type = feature.kind === "creature_hint" ? "creature"
    : feature.kind === "secret" || feature.kind === "mechanism" || feature.kind === "lore" ? "object"
    : FEATURE_KINDS.includes(feature.kind) ? feature.kind : "object";
  return {
    id: feature.id,
    type,
    kind: feature.kind,
    state: feature.state,
    name: feature.name,
    detail: feature.truthText || feature.surfaceText,
    hidden: feature.state === "hidden" || feature.state === "hinted",
    revealed: feature.state === "revealed" || feature.state === "resolved" || feature.state === "triggered",
    hinted: feature.state === "hinted",
    featureId: feature.id,
    origin: feature.origin ?? feature.regionId,
    ...(feature.items ? { items: feature.items } : {}),
    ...(feature.lootCurrency ? { lootCurrency: feature.lootCurrency } : {}),
    ...(Number.isInteger(feature.x) ? { x: feature.x, y: feature.y } : {}),
    looted: feature.looted,
    lootInitialized: feature.lootInitialized,
  };
}

/**
 * Merge priority: regex baseline → compiled cache → authored overrides (last wins by id).
 * Layers overlay by id only — sparse compiled fixtures must not wipe other baseline features in a region.
 */
export function mergeFeatureLayers({ baseline = [], compiled = [], overrides = [] } = {}) {
  const byId = new Map();
  for (const feature of baseline) byId.set(feature.id, feature);
  for (const feature of compiled) {
    byId.set(feature.id, { ...(byId.get(feature.id) ?? {}), ...feature, id: feature.id });
  }
  for (const feature of overrides) {
    byId.set(feature.id, { ...(byId.get(feature.id) ?? {}), ...feature, id: feature.id });
  }
  return [...byId.values()];
}

/** Strip compile-time grounding fields before play. */
export function stripSourceExcerpts(features) {
  return features.map(({ sourceExcerpt, ...rest }) => rest);
}

export function featuresInRegion(battle, regionId) {
  return (battle.features ?? []).filter((feature) => feature.regionId === regionId || feature.origin === regionId);
}

export function visibleFeaturePips(battle, { dm = false, sight = null, fogOn = false } = {}) {
  return (battle.features ?? []).filter((feature) => {
    if (!Number.isInteger(feature.x) || !Number.isInteger(feature.y)) return false;
    if (fogOn && sight && !sight.has(`${feature.x}:${feature.y}`)) return false;
    if (dm) return feature.state !== "resolved" || feature.kind === "treasure";
    return feature.state === "hinted" || feature.state === "revealed" || feature.state === "triggered"
      || (feature.state === "resolved" && feature.kind === "treasure" && !feature.looted);
  });
}

export function setFeatureState(feature, state) {
  feature.state = state;
  feature.hidden = state === "hidden" || state === "hinted";
  feature.revealed = state === "revealed" || state === "resolved" || state === "triggered";
}

export function syncMarkerForFeature(battle, feature) {
  battle.markers ??= [];
  const marker = battle.markers.find((entry) => entry.id === feature.id || entry.featureId === feature.id);
  if (!marker) return;
  marker.hidden = feature.hidden;
  marker.revealed = feature.revealed;
  marker.hinted = feature.state === "hinted";
  marker.kind = feature.kind;
  marker.state = feature.state;
  marker.detail = feature.truthText || marker.detail;
  if (feature.looted != null) marker.looted = feature.looted;
}
