import assert from 'node:assert/strict';
import {
  linesIntersect,
  getWallData,
  addWall,
  removeWall,
  addDoor,
  toggleDoor,
  crossesMapWall,
  mapLineClear,
  mapFloor,
} from '../dist/map-walls.mjs';

console.log('Testing map-walls geometry and line of sight...');

// Test 1: linesIntersect
// Ray from (0.5, 0.5) to (2.5, 0.5) crossing vertical wall at x=1, from y=0 to y=1
assert.ok(linesIntersect(0.5, 0.5, 2.5, 0.5, 1, 0, 1, 1), 'Horizontal ray should intersect vertical wall');
// Ray parallel to wall
assert.ok(!linesIntersect(0.5, 0.5, 0.5, 2.5, 1, 0, 1, 1), 'Parallel ray should not intersect');
// Ray that does not reach wall
assert.ok(!linesIntersect(0.2, 0.5, 0.8, 0.5, 1, 0, 1, 1), 'Short ray should not intersect');

// Test 2: WallData creation and manipulation
const wallData = { walls: [], doors: [] };
addWall(wallData, 1, 0, 1, 3); // Vertical wall x=1 from y=0 to y=3
assert.equal(wallData.walls.length, 1);

// Line clear check with wallData
const map = { cols: 10, rows: 10 };
const battle = { wallData, terrain: {} };

// Ray from (0, 1) to (2, 1) should be blocked by wall at x=1
assert.ok(!mapLineClear(map, {x:0, y:1}, {x:2, y:1}, () => false, true, battle), 'Ray through wall should be blocked');

// Ray from (0, 4) to (2, 4) passes through gap (wall ends at y=3)
assert.ok(mapLineClear(map, {x:0, y:4}, {x:2, y:4}, () => false, true, battle), 'Ray through open passageway should be clear');

// Test 3: Movement check with wallData
// Moving from (0, 1) to (1, 1) crosses vertical edge at x=1 (y=1 to y=2)
assert.ok(crossesMapWall(map, {x:0, y:1}, {x:1, y:1}, battle), 'Movement across wall should be blocked');
// Moving from (0, 4) to (1, 4) has no wall
assert.ok(!crossesMapWall(map, {x:0, y:4}, {x:1, y:4}, battle), 'Movement through open passageway should be allowed');

// Test 4: Doors
// Add a closed door at x=1, from y=1 to y=2
const door = addDoor(wallData, 1, 1, 1, 2, 'closed');
assert.equal(wallData.doors.length, 1);

// Closed door blocks ray and movement
assert.ok(!mapLineClear(map, {x:0, y:1}, {x:2, y:1}, () => false, true, battle), 'Closed door should block LOS');
assert.ok(crossesMapWall(map, {x:0, y:1}, {x:1, y:1}, battle), 'Closed door should block movement');

// Toggle door to open
toggleDoor(wallData, door.id);
assert.equal(door.state, 'open');

// Open door allows ray and movement
assert.ok(mapLineClear(map, {x:0, y:1}, {x:2, y:1}, () => false, true, battle), 'Open door should allow LOS');
assert.ok(!crossesMapWall(map, {x:0, y:1}, {x:1, y:1}, battle), 'Open door should allow movement');

// Set door to locked
import { setDoorState } from '../dist/map-walls.mjs';
setDoorState(wallData, door.id, 'locked');
assert.equal(door.state, 'locked');
assert.ok(!mapLineClear(map, {x:0, y:1}, {x:2, y:1}, () => false, true, battle), 'Locked door should block LOS');
assert.ok(crossesMapWall(map, {x:0, y:1}, {x:1, y:1}, battle), 'Locked door should block movement');

// Remove wall
removeWall(wallData, 1, 0, 1, 3);
assert.equal(wallData.walls.length, 0);

// Test 5: nearestGridEdge
import { nearestGridEdge } from '../dist/grid-view.mjs';
const edgeLeft = nearestGridEdge(2, 3, 0.1, 0.5);
assert.deepEqual(edgeLeft, {x1: 2, y1: 3, x2: 2, y2: 4, orientation: 'vertical'});
const edgeRight = nearestGridEdge(2, 3, 0.9, 0.5);
assert.deepEqual(edgeRight, {x1: 3, y1: 3, x2: 3, y2: 4, orientation: 'vertical'});
const edgeTop = nearestGridEdge(2, 3, 0.5, 0.05);
assert.deepEqual(edgeTop, {x1: 2, y1: 3, x2: 3, y2: 3, orientation: 'horizontal'});
const edgeBottom = nearestGridEdge(2, 3, 0.5, 0.95);
assert.deepEqual(edgeBottom, {x1: 2, y1: 4, x2: 3, y2: 4, orientation: 'horizontal'});

// Test 6: partyVision reveals across open door, blocks across closed door
import { partyVision } from '../dist/exploration.mjs';
const testMap = {
  cols: 10, rows: 10, size: 40, cellWidth: 40, cellHeight: 40, offsetX: 0, offsetY: 0,
  regions: [], width: 400, height: 400
};
const testBattle = {
  actors: [
    { id: 'hero1', side: 'party', x: 0, y: 1, hp: 10, sight: 30 }
  ],
  terrain: {},
  wallData: { walls: [], doors: [] },
  wallRevision: 1
};
// Place closed door between (0,1) and (1,1) along edge x=1, y=1..2
const testDoor = addDoor(testBattle.wallData, 1, 1, 1, 2, 'closed');
let vision = partyVision(testBattle, testMap);
assert.ok(vision.has('0:1'), 'Hero should see own space');
assert.ok(!vision.has('1:1'), 'Closed door should block sight into next room (1:1)');

// Open the door
toggleDoor(testBattle.wallData, testDoor.id);
testBattle.wallRevision++;
vision = partyVision(testBattle, testMap);
assert.ok(vision.has('1:1'), 'Open door should permit sight into next room (1:1)');

console.log('All map-walls tests passed!');
