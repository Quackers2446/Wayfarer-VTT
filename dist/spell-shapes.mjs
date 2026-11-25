// Pure grid geometry for spell shapes.  No battle state: callers filter creatures / walls themselves.
import {mapFloor} from './map-walls.mjs';
const key = (x, y) => x + ':' + y;
export const lineSquares = (a, b) => {
  const cells = [];
  let x = a.x, y = a.y, dx = Math.abs(b.x - x), dy = Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1, err = dx - dy;
  for (let i = 0; i < 250; i++) {
    cells.push({x, y});
    if (x === b.x && y === b.y) break;
    const twice = err * 2;
    if (twice > -dy) {err -= dy; x += sx;}
    if (twice < dx) {err += dx; y += sy;}
  }
  return cells;
};

// Shapes whose geometry starts at the caster and points toward the chosen square.
export const originatesAtCaster = rule => ['cone', 'line', 'aura'].includes(rule.shape) || rule.shape === 'cube' && rule.origin === 'caster' || rule.shape === 'self';
// Shapes where the player clicks a square only to choose a direction (so range is not checked against the square).
export const directional = rule => ['cone', 'line'].includes(rule.shape) || rule.shape === 'cube' && rule.origin === 'caster';
// Shapes where two clicks (start, end) are needed.
export const needsEndpoint = rule => rule.shape === 'wall';
export const isAimed = rule => !['creature', 'self'].includes(rule.shape);

export function shapeCells(rule, caster, square, map, {end, hotSide = 'left', area = 'footprint'} = {}) {
  const cells = new Set();
  if (!square || !map) return cells;
  if (rule.shape === 'point') {
    if (square.x >= 0 && square.y >= 0 && square.x < map.cols && square.y < map.rows) cells.add(key(square.x, square.y));
    return cells;
  }
  const origin = rule.shape === 'self' || rule.shape === 'aura' ? caster : square, nearby = rule.nearby ?? 0;
  const reach = Math.ceil((rule.shape === 'wall' ? rule.length : ['cone', 'line'].includes(rule.shape) ? rule.length : rule.shape === 'cube' ? rule.side : (rule.radius ?? 0) + nearby) / 5) + 3;
  const centre = directional(rule) ? caster : origin;
  const finish = end ?? {x: Math.min(map.cols - 1, origin.x + Math.floor((rule.length ?? 5) / 5) - 1), y: origin.y};
  const wallPath = rule.shape === 'wall' ? lineSquares(origin, finish) : [];
  const aimX = square.x - caster.x, aimY = square.y - caster.y, aimLength = Math.hypot(aimX, aimY);
  const half = rule.shape === 'cube' && rule.origin !== 'caster' ? Math.ceil((rule.side ?? 5) / 5) : 0, low = -Math.floor((half - 1) / 2), high = low + half - 1;
  for (let y = Math.max(0, centre.y - reach); y < Math.min(map.rows, centre.y + reach + 1); y++) {
    for (let x = Math.max(0, centre.x - reach); x < Math.min(map.cols, centre.x + reach + 1); x++) {
      if (!mapFloor(map, x, y)) continue;
      let inside = false;
      const dx = x - origin.x, dy = y - origin.y, dist = Math.hypot(dx, dy) * 5;
      if (rule.shape === 'wall') {
        const onWall = wallPath.some(p => p.x === x && p.y === y), vx = finish.x - origin.x, vy = finish.y - origin.y, length = Math.hypot(vx, vy) || 1;
        const projection = (dx * vx + dy * vy) / (length * length), signed = (vx * dy - vy * dx) / length;
        inside = area === 'hotSide' ? onWall || projection >= 0 && projection <= 1 && Math.abs(signed) <= 2 && (hotSide === 'right' ? signed < 0 : signed > 0) : onWall;
      } else if (rule.shape === 'ring') {
        const onWall = Math.abs(dist - rule.radius) <= 2.5;
        inside = area === 'hotSide' ? onWall || (hotSide === 'inside' ? dist < rule.radius && dist >= rule.radius - 10 : dist > rule.radius && dist <= rule.radius + 10) : onWall;
      } else if (rule.shape === 'cone' || rule.shape === 'line' || rule.shape === 'cube' && rule.origin === 'caster') {
        if (!aimLength) continue;
        const u = x - caster.x, v = y - caster.y, forward = (u * aimX + v * aimY) / aimLength, side = Math.abs(u * aimY - v * aimX) / aimLength;
        if (rule.shape === 'cone') inside = forward > 0 && forward * 5 <= rule.length && side <= forward / 2;
        else if (rule.shape === 'line') inside = forward > 0 && forward * 5 <= rule.length + .01 && side <= Math.max(.5, (rule.width ?? 5) / 10);
        else inside = forward > 0 && forward * 5 <= rule.side + .01 && side <= rule.side / 10 + .01;
      } else if (rule.shape === 'cube') {
        inside = dx >= low && dx <= high && dy >= low && dy <= high;
      } else inside = area === 'nearby' ? Math.max(Math.abs(dx), Math.abs(dy)) * 5 <= rule.radius + nearby : dist <= rule.radius + .01;
      if (inside) cells.add(key(x, y));
    }
  }
  return cells;
}
