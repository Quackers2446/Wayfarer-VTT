// Forced movement (push / pull).  Moves the creature square by square along a straight line, stopping at walls,
// creatures and edges, and fires zone triggers for every square entered.
import {actorIsUp, canStand, log} from './combat.mjs';
import {crossesMapWall} from './map-walls.mjs';
import {tokenSize, creatureSize} from './actor-space.mjs';
import {customZoneTriggers, refreshFollowZones} from './custom-spells.mjs';
import {sizeAtMost} from './conditions.mjs';

const centre = actor => ({x: actor.x + (tokenSize(actor) - 1) / 2, y: actor.y + (tokenSize(actor) - 1) / 2});

// Returns the number of feet actually moved.
export function forcedMove(battle, target, origin, feet, map, {mode = 'away', maxSize, random = Math.random} = {}) {
  if (!actorIsUp(target) && target.hp !== 0 || target.x == null) return 0;
  if (maxSize && !sizeAtMost(creatureSize(target), maxSize)) {log(battle, target.name + ' is too large to be moved.'); return 0;}
  const from = origin.x == null ? centre(origin) : centre(origin), to = centre(target);
  let vx = to.x - from.x, vy = to.y - from.y;
  if (mode === 'toward') {vx = -vx; vy = -vy;}
  const length = Math.hypot(vx, vy);
  if (!length || !map) return 0;
  vx /= length; vy /= length;
  const start = {x: target.x, y: target.y};
  let moved = 0;
  for (let step = 1; step <= Math.floor(feet / 5); step++) {
    const want = {x: Math.round(start.x + vx * step), y: Math.round(start.y + vy * step)};
    const here = {x: target.x, y: target.y};
    if (want.x === here.x && want.y === here.y) continue;
    if (Math.max(Math.abs(want.x - here.x), Math.abs(want.y - here.y)) > 1) break;
    if (!canStand(battle, target, want.x, want.y, map) || crossesMapWall(map, here, want, battle)) break;
    target.x = want.x; target.y = want.y;
    const body = target.carrying && battle.actors.find(other => other.id === target.carrying);
    if (body) {body.x = target.x; body.y = target.y;}
    moved += 5;
    customZoneTriggers(battle, target, 'enter', here, random);
    refreshFollowZones(battle, target, map);
    if (!actorIsUp(target)) break;
  }
  if (moved) log(battle, target.name + ' is ' + (mode === 'toward' ? 'pulled' : 'pushed') + ' ' + moved + ' ft.');
  else log(battle, target.name + ' cannot be moved.');
  return moved;
}
