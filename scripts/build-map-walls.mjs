// Bake walls and doors for the 5etools battlemaps. Free: no AI, no API key.
//
//   cd scripts/map-bake && npm ci          # one-time, installs sharp for image decoding
//   node scripts/build-map-walls.mjs [--data DIR] [--module LMoP] [--map Redbrand] [--overlay DIR]
//
// --data     extracted 5etools release (default: ../5etools-*/ beside the wayfarer folder)
// --module   only these adventure ids (comma separated). Default: every adventure.
// --map      only maps whose title contains this text
// --overlay  also write a PNG per map showing the detected floor, walls and doors
// --force    bake maps even when their quality score is below the runtime threshold
//
// Output: dist/assets/map-walls/<MODULE>.json, loaded by dist/baked-walls.mjs when a map opens.
// Maps are matched by the same key the app uses (the image path inside the 5etools release).
import {mkdir, readdir, readFile, writeFile, access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {detectMap, toGray} from '../dist/map-detect.mjs';
import {gridGeometry, sourceGrid, validGeometry} from '../dist/map-grid.mjs';
import {mapFloor} from '../dist/map-walls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, i, all) => {
  if (arg.startsWith('--')) out.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return out;
}, []));

let sharp;
try {sharp = (await import(pathToFileURL(createRequire(join(here, 'map-bake', 'x.js')).resolve('sharp')).href)).default;}
catch {console.error('Install the image decoder first:  cd scripts/map-bake && npm ci'); process.exit(1);}

async function findData() {
  if (typeof args.data === 'string') return resolve(args.data);
  const parent = resolve(root, '..');
  for (const name of (await readdir(parent)).sort().reverse()) {
    if (!/^5etools/.test(name)) continue;
    try {await access(join(parent, name, 'data', 'adventures.json')); return join(parent, name);} catch {}
  }
  console.error('Pass --data PATH to an extracted 5etools release.'); process.exit(1);
}
const dataRoot = await findData();
const cache = join(here, 'map-bake', 'cache');
await mkdir(cache, {recursive: true});

function *walk(node) {
  if (Array.isArray(node)) for (const value of node) yield *walk(value);
  else if (node && typeof node === 'object') {yield node; for (const value of Object.values(node)) yield *walk(value);}
}

// Same selection the app makes in encounters.mjs: square-grid DM maps that carry numbered rooms.
function mapsOf(adventure) {
  const images = [...walk(adventure.data)].filter(node => node.type === 'image' && node.imageType === 'map');
  const maps = [];
  for (const image of images) {
    const {width, height, grid} = image;
    if (grid?.type !== 'square' || !grid.size || !width || !height) continue;
    if (grid.units && !['ft', 'feet', 'foot'].includes(grid.units.toLowerCase())) continue;
    const parentId = typeof image.mapParent === 'string' ? image.mapParent : image.mapParent?.id;
    const parent = parentId ? images.find(entry => entry.id === parentId) : null;
    const base = image.mapRegions ?? parent?.mapRegions ?? [];
    const regions = base.map(region => ({
      id: region.area,
      points: parent && !image.mapRegions && parent.width ? region.points.map(([x, y]) => [x * width / parent.width, y * height / parent.height]) : region.points,
    })).filter(region => region.points?.length >= 3);
    const source = sourceGrid(grid), geometry = gridGeometry({width, height, sourceGrid: source});
    if (!validGeometry(geometry) || !image.href?.path) continue;
    maps.push({key: image.href.path, id: image.id, title: image.title ?? image.href.path, width, height, regions, geometry, sourceGrid: source});
  }
  return maps;
}

async function imageFor(path) {
  const file = join(cache, path.replaceAll('/', '__'));
  try {return await readFile(file);} catch {}
  for (const base of [join(dataRoot, 'img') + '/', 'https://cdn.5e.tools/2024/img/', 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/']) {
    try {
      let bytes;
      if (!base.startsWith('http')) bytes = await readFile(base + path);
      else {
        const response = await fetch(base + path.split('/').map(encodeURIComponent).join('/'));
        if (!response.ok) continue;
        bytes = Buffer.from(await response.arrayBuffer());
      }
      await writeFile(file, bytes);
      return bytes;
    } catch {}
  }
  return null;
}

const round = value => Math.round(value * 1e5) / 1e5;
const toUnit = (map, [x1, y1, x2, y2]) => {
  const {offsetX, offsetY, cellWidth, cellHeight} = map.geometry;
  return [round((offsetX + x1 * cellWidth) / map.width), round((offsetY + y1 * cellHeight) / map.height),
    round((offsetX + x2 * cellWidth) / map.width), round((offsetY + y2 * cellHeight) / map.height)];
};

async function bake(map) {
  const bytes = await imageFor(map.key);
  if (!bytes) return {error: 'image unavailable'};
  // Aim for roughly 80 px per cell: plenty to see the printed grid, fast to scan.
  const scale = Math.min(1, 80 / Math.min(map.geometry.cellWidth, map.geometry.cellHeight));
  const {data, info} = await sharp(bytes).removeAlpha().resize({width: Math.round(map.width * scale)}).raw().toBuffer({resolveWithObject: true});
  const gray = toGray(data, info.channels);
  const options = Object.fromEntries(['ridge', 'contrast', 'floorScore', 'doorLift'].filter(name => args[name]).map(name => [name, +args[name]]));
  const result = detectMap({gray, width: info.width, height: info.height, scale: info.width / map.width, geometry: map.geometry, regions: map.regions, options});
  return {result, bytes, info, scale: info.width / map.width};
}

async function overlay(map, baked, dir) {
  const {geometry} = map, {result, info, scale} = baked, {cols, rows} = geometry;
  const px = value => value * scale;
  const rects = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    rects.push(`<rect x="${px(geometry.offsetX + c * geometry.cellWidth)}" y="${px(geometry.offsetY + r * geometry.cellHeight)}" width="${px(geometry.cellWidth)}" height="${px(geometry.cellHeight)}" fill="${result.floor[r * cols + c] ? 'rgba(0,200,0,.28)' : 'rgba(220,0,0,.30)'}"/>`);
  }
  const line = ([x1, y1, x2, y2], color, w) => `<line x1="${px(geometry.offsetX + x1 * geometry.cellWidth)}" y1="${px(geometry.offsetY + y1 * geometry.cellHeight)}" x2="${px(geometry.offsetX + x2 * geometry.cellWidth)}" y2="${px(geometry.offsetY + y2 * geometry.cellHeight)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">${rects.join('')}${result.walls.map(w => line(w, '#ffee00', 5)).join('')}${result.doors.map(d => line([d.x1, d.y1, d.x2, d.y2], '#00e5ff', 8)).join('')}</svg>`;
  await mkdir(dir, {recursive: true});
  const base = await sharp(baked.bytes).removeAlpha().resize({width: info.width, height: info.height, fit: 'fill'}).png().toBuffer();
  const merged = await sharp(base).composite([{input: Buffer.from(svg)}]).png().toBuffer();
  await sharp(merged).resize({width: 1400}).jpeg({quality: 80}).toFile(join(dir, map.key.replaceAll('/', '__').replace(/\.\w+$/, '') + '.jpg'));
}

// The hand-calibrated Cragmaw Hideout floor is the one ground truth in the repo.
function agreement(map, result) {
  const probe = {module: 'LMoP', id: '1ab', cols: map.geometry.cols, rows: map.geometry.rows};
  let tp = 0, fp = 0, fn = 0;
  for (let y = 0; y < probe.rows; y++) for (let x = 0; x < probe.cols; x++) {
    const truth = mapFloor(probe, x, y), found = result.floor[y * probe.cols + x] === 1;
    if (truth && found) tp++; else if (found) fp++; else if (truth) fn++;
  }
  return {precision: +(tp / (tp + fp)).toFixed(3), recall: +(tp / (tp + fn)).toFixed(3)};
}

const only = typeof args.module === 'string' ? new Set(args.module.split(',').map(id => id.toLowerCase())) : null;
const files = (await readdir(join(dataRoot, 'data', 'adventure'))).filter(name => /^adventure-.*\.json$/.test(name));
const minCoverage = 0.6;
let total = 0, kept = 0;
for (const name of files.sort()) {
  const file = JSON.parse(await readFile(join(dataRoot, 'data', 'adventure', name), 'utf8'));
  const adventure = file.adventureData?.[0];
  if (!adventure?.id) continue;
  const moduleId = adventure.id;
  if (only && !only.has(moduleId.toLowerCase())) continue;
  const maps = mapsOf(adventure).filter(map => typeof args.map !== 'string' || map.title.toLowerCase().includes(args.map.toLowerCase()));
  if (!maps.length) continue;
  const output = {version: 1, module: moduleId, generated: 'build-map-walls.mjs', maps: {}};
  for (const map of maps) {
    total++;
    const baked = await bake(map);
    if (baked.error) {console.log(`${moduleId.padEnd(10)} ${map.title.padEnd(32)} skipped: ${baked.error}`); continue;}
    const {stats} = baked.result;
    const ok = stats.roomCoverage != null && stats.roomCoverage >= minCoverage && stats.walls > 0;
    let note = '';
    if (map.key === 'adventure/LMoP/Cragmaw Hideout.webp') note = ' truth ' + JSON.stringify(agreement(map, baked.result));
    console.log(`${moduleId.padEnd(10)} ${map.title.slice(0, 32).padEnd(32)} ${String(stats.cols).padStart(3)}x${String(stats.rows).padEnd(3)} rooms ${String(stats.roomCoverage).padEnd(6)} tuned ${stats.tuned ? `r${stats.tuned.ridge} c${stats.tuned.contrast} t${stats.tuned.floorScore}`.padEnd(14) : 'none'.padEnd(14)} walls ${String(stats.walls).padStart(3)} thin ${String(stats.thinEdges).padStart(3)} doors ${String(stats.doors).padStart(2)} ${ok ? 'keep' : 'LOW '}${note}`);
    if (typeof args.overlay === 'string') await overlay(map, baked, resolve(args.overlay));
    if (!ok && !args.force) continue;
    kept++;
    output.maps[map.key] = {
      width: map.width, height: map.height,
      grid: {cols: stats.cols, rows: stats.rows, offsetX: map.geometry.offsetX, offsetY: map.geometry.offsetY, cellWidth: map.geometry.cellWidth, cellHeight: map.geometry.cellHeight},
      quality: {roomCoverage: stats.roomCoverage, floorCells: stats.floorCells},
      walls: baked.result.walls.map(wall => toUnit(map, wall)),
      doors: baked.result.doors.map(door => toUnit(map, [door.x1, door.y1, door.x2, door.y2])),
    };
  }
  if (Object.keys(output.maps).length && !args['dry-run']) {
    const dir = join(root, 'dist', 'assets', 'map-walls');
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, moduleId + '.json'), JSON.stringify(output));
  }
}
console.log(`\n${kept} of ${total} maps baked.`);
