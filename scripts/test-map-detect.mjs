import assert from 'node:assert/strict';
import {toGray, detectMap, pointInPolygon} from '../dist/map-detect.mjs';
import {bakedWallData, applyBakedWalls} from '../dist/baked-walls.mjs';

console.log('Testing map detection and baked walls...');

// Synthetic map: 8x6 cells of 20px. A 4x4 room (cells 2..5, 1..4) has faint printed grid lines on a flat rock background.
const cell = 20, cols = 8, rows = 6, width = cols * cell, height = rows * cell;
const gray = new Uint8Array(width * height).fill(70);
for (let y = cell; y < 5 * cell; y++) for (let x = 2 * cell; x < 6 * cell; x++) {
  const line = x % cell === 0 || y % cell === 0;
  gray[y * width + x] = line ? 20 : 190;
}
const geometry = {cols, rows, cellWidth: cell, cellHeight: cell, offsetX: 0, offsetY: 0};
const region = [[2 * cell, cell], [6 * cell, cell], [6 * cell, 5 * cell], [2 * cell, 5 * cell]];
assert.ok(pointInPolygon(60, 40, region));
const result = detectMap({gray, width, height, scale: 1, geometry, regions: [{points: region}], options: {auto: false, minFloorCells: 4}});
assert.equal(result.stats.floorCells, 16, 'the gridded room is floor');
assert.ok(result.walls.length >= 4, 'room outline becomes walls');
const spans = result.walls.map(([x1, y1, x2, y2]) => `${x1},${y1},${x2},${y2}`);
assert.ok(spans.includes('2,1,2,5'), 'west wall is one merged segment');
assert.ok(spans.includes('2,1,6,1'), 'north wall is one merged segment');

assert.equal(toGray(Uint8Array.from([255, 255, 255, 0, 0, 0]), 3)[0], 255);

// Baked walls convert from normalized image coordinates to the map's own grid.
const baked = {quality: {roomCoverage: .9}, walls: [[.25, .5, .25, .75]], doors: [[.5, .5, .5, .6]]};
const map = {module: 'X', key: 'a', width: 800, height: 400, cellWidth: 100, cellHeight: 100, offsetX: -50, offsetY: 0};
const data = bakedWallData(baked, map, () => 'door-1');
assert.deepEqual(data.walls[0], {x1: 2.5, y1: 2, x2: 2.5, y2: 3});
assert.equal(data.doors[0].state, 'closed');
assert.equal(data.baked, true);
assert.equal(bakedWallData({...baked, quality: {roomCoverage: .3}}, map), null, 'poor detections are ignored');

const fetcher = async () => ({ok: true, json: async () => ({maps: {a: baked}})});
const battle = {};
assert.equal(await applyBakedWalls(map, battle, fetcher), true);
assert.equal(battle.fogSettings.blockMovement, false, 'baked walls never block movement by default');
assert.equal(battle.wallRevision, 1);
assert.equal(await applyBakedWalls(map, battle, fetcher), false, 'applies once');
const hand = {wallData: {manual: true, walls: [], doors: []}};
assert.equal(await applyBakedWalls(map, hand, fetcher), false, 'hand-edited walls are never replaced');
console.log('Map detection and baked walls passed.');
