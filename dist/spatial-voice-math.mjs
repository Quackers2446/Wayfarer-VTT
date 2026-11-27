export const MAX_RANGE_FT = 45;
export const SOFT_EDGE_FT = 10;
export const FEET_PER_SQUARE = 5;

export function proximityGain(distanceFt, maxRange = MAX_RANGE_FT, softEdge = SOFT_EDGE_FT) {
  if (!Number.isFinite(distanceFt) || distanceFt > maxRange) return 0;
  if (distanceFt <= maxRange - softEdge) return 1;
  return Math.max(0, 1 - (distanceFt - (maxRange - softEdge)) / softEdge);
}

export function feetBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y) * FEET_PER_SQUARE;
}
