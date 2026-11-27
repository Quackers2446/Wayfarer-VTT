/** Named party spawn markers placed in room setup / tools. */

export function spawnMarkers(battle) {
  return (battle?.markers ?? []).filter((marker) => marker.type === "spawn");
}

export function findSpawn(battle, id) {
  if (!id) return null;
  return spawnMarkers(battle).find((marker) => marker.id === id) ?? null;
}

export function createSpawnMarker(battle, {x, y, name, origin = null}) {
  const label = String(name ?? "").normalize("NFKC").trim().slice(0, 40);
  if (!label) throw new Error("Name this spawn point before placing it.");
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error("Choose a map square for the spawn point.");
  const existing = spawnMarkers(battle).find((marker) => marker.x === x && marker.y === y);
  if (existing) {
    existing.name = label;
    return existing;
  }
  const marker = {
    id: "spawn:" + crypto.randomUUID(),
    type: "spawn",
    name: label,
    x,
    y,
    origin,
    hidden: false,
    revealed: true,
  };
  (battle.markers ??= []).push(marker);
  return marker;
}

export function removeSpawnMarker(battle, id) {
  const list = battle.markers ?? [];
  const index = list.findIndex((marker) => marker.id === id && marker.type === "spawn");
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/** Keep authored spawn points when an encounter board is reset. */
export function preserveSpawnMarkers(markers) {
  return (markers ?? []).filter((marker) => marker.type === "spawn");
}

export function cellsNearSpawn(spawn, map, allowed, maxRadius = 8) {
  if (!spawn || !map) return null;
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = {x: spawn.x + dx, y: spawn.y + dy};
        if (candidate.x < 0 || candidate.y < 0 || candidate.x >= map.cols || candidate.y >= map.rows) continue;
        if (allowed(candidate)) return candidate;
      }
    }
  }
  return null;
}
