// Applies walls and doors precomputed offline by scripts/build-map-walls.mjs.
// They are a draft: good enough for dynamic fog, never allowed to trap a token by default.
import {getWallData, mapWalls} from './map-walls.mjs';

const MIN_COVERAGE = .6;
const modules = new Map();

export function bakedModule(module, fetcher = globalThis.fetch?.bind(globalThis)) {
  if (!module || module === 'training' || !fetcher) return Promise.resolve(null);
  if (!modules.has(module)) {
    modules.set(module, fetcher(`/assets/map-walls/${encodeURIComponent(module)}.json`)
      .then(response => response.ok ? response.json() : null)
      .catch(() => null));
  }
  return modules.get(module);
}

const cell = (value, size, origin, scale) => Math.round(((value * scale - origin) / size) * 1e3) / 1e3;

// Convert normalized image coordinates into cell units for the map's current grid.
export function bakedWallData(baked, map, id = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) {
  if (!baked || (baked.quality?.roomCoverage ?? 0) < MIN_COVERAGE || !baked.walls?.length) return null;
  if (!map?.width || !map?.height || !map.cellWidth || !map.cellHeight) return null;
  const point = (x, y) => [cell(x, map.cellWidth, map.offsetX ?? 0, map.width), cell(y, map.cellHeight, map.offsetY ?? 0, map.height)];
  const segment = ([x1, y1, x2, y2]) => { const [a, b] = point(x1, y1), [c, d] = point(x2, y2); return {x1: a, y1: b, x2: c, y2: d}; };
  return {
    manual: true, baked: true,
    walls: baked.walls.map(segment),
    doors: (baked.doors ?? []).map(door => ({id: id(), ...segment(door), state: 'closed', label: 'Door'})),
  };
}

// Returns true when the battle received baked walls.
export async function applyBakedWalls(map, battle, fetcher) {
  if (!map?.module || map.module === 'training' || !battle || battle.wallData || map.wallData) return false;
  if (mapWalls(map, battle)) return false; // hand-calibrated data wins
  const module = await bakedModule(map.module, fetcher);
  if (battle.wallData) return false;
  const data = bakedWallData(module?.maps?.[map.key], map);
  if (!data) return false;
  battle.wallData = data;
  battle.wallRevision = (battle.wallRevision ?? 0) + 1;
  // Draft walls must not be able to trap players: vision only, unless the host turns movement blocking on.
  battle.fogSettings = {blockMovement: false, ...battle.fogSettings};
  return true;
}

export const hasBakedWalls = (map, battle) => Boolean(getWallData(map, battle)?.baked);
