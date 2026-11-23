import assert from 'node:assert/strict';
import {sourceGrid, gridGeometry, legacyGeometry, firstLine, cellBounds} from '../dist/map-grid.mjs';

console.log('Testing map-grid alignment and scale preservation...');

// Case 1: Map 6.1 from Against the Giants (scale=2, 10ft printed squares)
// Raw 5etools metadata: size=58, offsetX=-40, offsetY=-18, scale=2
const atg61 = {
  size: 58,
  offsetX: -40,
  offsetY: -18,
  scale: 2,
};

const source = sourceGrid(atg61);
assert.equal(source.x, -40, 'sourceGrid.x must preserve raw pixel offset without dividing by scale');
assert.equal(source.y, -18, 'sourceGrid.y must preserve raw pixel offset without dividing by scale');
assert.equal(source.width, 58, 'guideSize must match printed grid size 58');
assert.equal(source.divisions, 2, 'divisions must be 2 for 10ft squares (scale=2)');

const geom = gridGeometry({ width: 2280, height: 3000, sourceGrid: source });
const legacy = legacyGeometry(atg61, 2280, 3000);

assert.equal(geom.cellWidth, 29, 'cellWidth must be 29px (58 / 2)');
assert.equal(geom.cellHeight, 29, 'cellHeight must be 29px (58 / 2)');
assert.equal(geom.offsetX, legacy.offsetX, 'gridGeometry.offsetX must match legacyGeometry');
assert.equal(geom.offsetY, legacy.offsetY, 'gridGeometry.offsetY must match legacyGeometry');
assert.equal(geom.offsetX, -11, 'offsetX must be -11 for offsetX=-40 and cellWidth=29');
assert.equal(geom.offsetY, -18, 'offsetY must be -18 for offsetY=-18 and cellHeight=29');

// Printed grid lines: x = -40 + k * 58 (e.g. 18, 76, 134, 192...)
// Tactical grid lines: x = -11 + m * 29 (e.g. 18, 47, 76, 105, 134...)
const printedFirstX = firstLine(atg61.offsetX, atg61.size);
const tacticalFirstX = firstLine(geom.offsetX, geom.cellWidth);
assert.equal(tacticalFirstX, printedFirstX, 'First visible tactical line must match first visible printed line');
assert.equal(tacticalFirstX, 18);

// Verify that every printed line coincides with a tactical line
for (let px = printedFirstX; px < 2280; px += atg61.size) {
  const diffFromTactical = (px - geom.offsetX) % geom.cellWidth;
  assert.equal(diffFromTactical, 0, `Printed line at x=${px} must coincide with tactical grid line`);
}

const printedFirstY = firstLine(atg61.offsetY, atg61.size);
const tacticalFirstY = firstLine(geom.offsetY, geom.cellHeight);
assert.equal((printedFirstY - geom.offsetY) % geom.cellHeight, 0, 'First printed line Y must fall on a tactical line');
assert.equal(printedFirstY, 40);
assert.equal(tacticalFirstY, 11);
for (let py = printedFirstY; py < 3000; py += atg61.size) {
  const diffFromTactical = (py - geom.offsetY) % geom.cellHeight;
  assert.equal(diffFromTactical, 0, `Printed line at y=${py} must coincide with tactical grid line`);
}

// Case 2: Unscaled standard map (scale=1)
const standard = { size: 50, offsetX: 10, offsetY: 15, scale: 1 };
const standardSource = sourceGrid(standard);
assert.equal(standardSource.x, 10);
assert.equal(standardSource.y, 15);
assert.equal(standardSource.divisions, 1);
const standardGeom = gridGeometry({ width: 1000, height: 800, sourceGrid: standardSource });
assert.equal(standardGeom.cellWidth, 50);
assert.equal(firstLine(standardGeom.offsetX, 50), 10);
assert.equal(firstLine(standardGeom.offsetY, 50), 15);

console.log('Map-grid alignment test passed successfully!');
