import assert from 'node:assert/strict';
import {sourceGrid, gridGeometry, legacyGeometry, firstLine, fitAxis, autocorrPeriod, smoothProfile, defaultSquareFeet, withSquareFeet, normalizeArtworkFit, artworkDestination, artworkFitIsDefault, alignmentForArtworkFit} from '../dist/map-grid.mjs';

console.log('Testing map-grid alignment and scale preservation...');

function syntheticGridProfile(length, spacing, origin, {noise = 0.05, random = Math.random} = {}) {
  const profile = new Float32Array(length);
  for (let i = 0; i < length; i++) profile[i] = noise * random();
  for (let x = ((origin % spacing) + spacing) % spacing; x < length; x += spacing) {
    for (let d = -1; d <= 1; d++) {
      const at = Math.round(x + d);
      if (at >= 0 && at < length) profile[at] += d === 0 ? 1.4 : 0.55;
    }
  }
  return profile;
}

{
  const spacing = 42, origin = 11;
  const profile = syntheticGridProfile(900, spacing, origin);
  const period = autocorrPeriod(smoothProfile(profile), spacing * 0.97);
  assert.ok(period, 'autocorr finds a period near the source spacing');
  assert.ok(Math.abs(period.spacing - spacing) < 1.25, 'autocorr period close to true spacing');
  const fit = fitAxis(profile, spacing * 1.04, origin + 3, 1);
  assert.ok(fit, 'fitAxis recovers a slightly wrong adventure guide');
  assert.ok(Math.abs(fit.spacing - spacing) < 0.9, 'fitAxis spacing locks to printed lines');
  assert.ok(Math.abs(((fit.origin % fit.spacing) + fit.spacing) % fit.spacing -
    ((origin % spacing) + spacing) % spacing) < 1.5, 'fitAxis phase locks to printed lines');
}

{
  const spacing = 36;
  const profile = syntheticGridProfile(720, spacing, 8, {noise: 0.35});
  const fit = fitAxis(profile, spacing, 8, 1);
  // Noisy but true guide — either keep guide (null) or a nearby fit; never invent a wild period.
  if (fit) assert.ok(Math.abs(fit.spacing - spacing) / spacing < 0.06);
}


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

// Printed square scale: 5 ft vs 10 ft overrides divisions while keeping the same guide box.
{
  assert.equal(defaultSquareFeet(source), 10, 'ATG 6.1 printed squares are 10 ft');
  assert.equal(defaultSquareFeet(standardSource), 5);
  assert.equal(withSquareFeet(source, 5).divisions, 1);
  assert.equal(withSquareFeet(source, 10).divisions, 2);
  const asFive = gridGeometry({ width: 2280, height: 3000, sourceGrid: source }, source, 5);
  assert.equal(asFive.cellWidth, 58, '5 ft mode uses the full printed square as one tactical cell');
  const asTen = gridGeometry({ width: 2280, height: 3000, sourceGrid: source }, source, 10);
  assert.equal(asTen.cellWidth, 29, '10 ft mode keeps 2×2 tactical cells inside each printed square');
}

// Artwork placement: pan/scale the image under fixed rooms without moving the grid geometry source.
{
  assert.deepEqual(normalizeArtworkFit(null), { x: 0, y: 0, scale: 1 });
  assert.ok(artworkFitIsDefault({ x: 0, y: 0, scale: 1 }));
  assert.ok(!artworkFitIsDefault({ x: -40, y: 12, scale: 1.1 }));
  const dest = artworkDestination({ width: 1000, height: 800 }, { x: -50, y: 20, scale: 1.25 });
  assert.equal(dest.width, 1250);
  assert.equal(dest.height, 1000);
  assert.equal(dest.x, -50);
  assert.equal(dest.y, 20);
  const placed = alignmentForArtworkFit({ width: 50, height: 50, x: 10, y: 15 }, { x: -50, y: 20, scale: 1.25 });
  assert.equal(placed.width, 62.5);
  assert.equal(placed.height, 62.5);
  assert.equal(placed.x, -50 + 12.5);
  assert.equal(placed.y, 20 + 18.75);
}

console.log('Map-grid alignment test passed successfully!');
