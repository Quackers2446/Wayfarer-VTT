import assert from 'node:assert/strict';
import {cellsNearSpawn, createSpawnMarker, findSpawn, preserveSpawnMarkers, removeSpawnMarker, spawnMarkers} from '../dist/spawn-points.mjs';

const battle = {markers: [{id: 'treasure:1', type: 'treasure', name: 'Chest', x: 1, y: 1}]};
const spawn = createSpawnMarker(battle, {x: 4, y: 6, name: '  Party 2 west  ', origin: 'room-a'});
assert.equal(spawn.type, 'spawn');
assert.equal(spawn.name, 'Party 2 west');
assert.equal(spawnMarkers(battle).length, 1);
assert.equal(findSpawn(battle, spawn.id)?.x, 4);

const renamed = createSpawnMarker(battle, {x: 4, y: 6, name: 'South gate'});
assert.equal(renamed.id, spawn.id);
assert.equal(renamed.name, 'South gate');
assert.equal(spawnMarkers(battle).length, 1);

const map = {cols: 10, rows: 10};
const blocked = new Set(['4:6', '5:6']);
const cell = cellsNearSpawn(spawn, map, ({x, y}) => !blocked.has(x + ':' + y));
assert.ok(cell && !blocked.has(cell.x + ':' + cell.y));
assert.equal(Math.max(Math.abs(cell.x - 4), Math.abs(cell.y - 6)), 1);

assert.equal(removeSpawnMarker(battle, spawn.id), true);
assert.equal(spawnMarkers(battle).length, 0);
assert.deepEqual(preserveSpawnMarkers([
  {type: 'spawn', id: 'a'},
  {type: 'treasure', id: 'b'},
]), [{type: 'spawn', id: 'a'}]);

assert.throws(() => createSpawnMarker(battle, {x: 1, y: 1, name: '   '}), /Name this spawn/);
console.log('Spawn point helpers passed.');
