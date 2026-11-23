import assert from 'node:assert/strict';
import {startingRegion, trainingMap} from '../dist/encounters.mjs';

// 1. Safe handling of empty or missing maps
assert.equal(startingRegion(null), null);
assert.equal(startingRegion({}), null);
assert.equal(startingRegion({regions: []}), null);

// 2. Training map (entry gate)
const trainingStart = startingRegion(trainingMap);
assert.equal(trainingStart.id, 'entry');

// 3. Map with "1. " in entry.name placed later in the array
const mapWithNumberedName = {
  regions: [
    {id: '10', entry: {name: '10. Guard Post'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '05', entry: {name: '5. Barracks'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '01', entry: {name: '1. Cave Mouth'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '12', entry: {name: '12. Boss Chamber'}, points: [[0,0],[1,0],[1,1],[0,1]]},
  ]
};
assert.equal(startingRegion(mapWithNumberedName).id, '01');
assert.equal(startingRegion(mapWithNumberedName).entry.name, '1. Cave Mouth');

// 4. Map with "Area 1" or "Room 1"
const mapWithAreaPrefix = {
  regions: [
    {id: 'area-4', entry: {name: 'Area 4: Prison'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: 'area-1', entry: {name: 'Area 1: Grand Entrance'}, points: [[0,0],[1,0],[1,1],[0,1]]},
  ]
};
assert.equal(startingRegion(mapWithAreaPrefix).id, 'area-1');

// 5. Map with region id "1" or "01" without entry object
const mapWithNumericId = {
  regions: [
    {id: '12', points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '01', points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '02', points: [[0,0],[1,0],[1,1],[0,1]]},
  ]
};
assert.equal(startingRegion(mapWithNumericId).id, '01');

// 6. Map with sub-area like "01b" or "1a" (LMoP Cragmaw Hideout pattern)
const mapWithSubArea = {
  regions: [
    {id: '021', entry: {name: 'Kennel'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '01b', entry: {name: '1b. Cave Mouth'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '025', entry: {name: 'Passage'}, points: [[0,0],[1,0],[1,1],[0,1]]},
  ]
};
assert.equal(startingRegion(mapWithSubArea).id, '01b');

// 7. Ensure "10. Guard Post" does NOT falsely trigger "1."
const mapWithTenFirst = {
  regions: [
    {id: '10', entry: {name: '10. Guard Post'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '11', entry: {name: '11. Mess Hall'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: '01', entry: {name: '1. Dungeon Entry'}, points: [[0,0],[1,0],[1,1],[0,1]]},
  ]
};
assert.equal(startingRegion(mapWithTenFirst).id, '01');

// 8. Fallback to entrance / entry when no 1 exists
const mapWithEntrance = {
  regions: [
    {id: 'hall', entry: {name: 'Great Hall'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: 'gate', entry: {name: 'Entrance Gate'}, points: [[0,0],[1,0],[1,1],[0,1]]},
  ]
};
assert.equal(startingRegion(mapWithEntrance).id, 'gate');

// 9. Fallback to first region when no pattern matches
const mapWithNoMatch = {
  regions: [
    {id: 'alpha', entry: {name: 'Alpha Room'}, points: [[0,0],[1,0],[1,1],[0,1]]},
    {id: 'beta', entry: {name: 'Beta Room'}, points: [[0,0],[1,0],[1,1],[0,1]]},
  ]
};
assert.equal(startingRegion(mapWithNoMatch).id, 'alpha');

console.log('startingRegion resolution tests all passed!');
