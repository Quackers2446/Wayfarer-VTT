// Free, deterministic floor/wall detection for printed battlemaps. No network and no AI.
//
// Published battlemaps print their 5-foot grid on walkable floor only; rock, wall bands and the
// margin carry none. Scoring every grid cell by how much of the printed grid is visible on its
// border gives a floor mask. The adventure's numbered room polygons then repair the cells that
// furniture covers, and wall edges fall out of the boundary between floor and non-floor.
//
// All geometry arguments are in the source image's pixels. `gray` may be a downscaled copy of the
// image; `scale` is its size relative to the source image.

export const defaults = {
  ridge: 4,          // luminance contrast that counts as a printed grid line
  contrast: 1.6,     // ...and it must beat the texture beside it by this factor
  floorScore: .25,   // share of a cell border that must show grid line to call the cell floor
  holeCells: 6,      // enclosed non-floor patches this small are furniture, not wall
  roomHoleCells: 16, // ...or this small when they sit inside a numbered room
  roomReach: 1,      // floor must lie within this many cells of a numbered room
  thinCut: .4,       // dark share of a grid edge that makes it a thin interior wall
  minFloorCells: 40, // floor patches without a room polygon need at least this many cells
  doorLift: 38,      // door symbols are this much brighter than the wall band around them
};

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function toGray(rgb, channels) {
  const count = rgb.length / channels, gray = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * channels;
    gray[i] = (.3 * rgb[p] + .6 * rgb[p + 1] + .1 * rgb[p + 2]) | 0;
  }
  return gray;
}

// How much of each cell's border shows a printed grid line, 0..1.
export function gridScores({gray, width, height, scale, geometry, options = {}}) {
  const {ridge, contrast} = {...defaults, ...options};
  const {cols, rows} = geometry;
  const cw = geometry.cellWidth * scale, ch = geometry.cellHeight * scale;
  const ox = geometry.offsetX * scale, oy = geometry.offsetY * scale;
  const lum = (x, y) => gray[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  const d = Math.max(2, Math.round(Math.min(cw, ch) * .045));
  const lineX = (x, y) => {
    const a = lum(x - d, y), b = lum(x + d, y), c = Math.min(lum(x - 1, y), lum(x, y), lum(x + 1, y));
    return Math.max(0, Math.abs(a + b - 2 * c) * .5 - Math.abs(a - b) * .57 - 1);
  };
  const lineY = (x, y) => {
    const a = lum(x, y - d), b = lum(x, y + d), c = Math.min(lum(x, y - 1), lum(x, y), lum(x, y + 1));
    return Math.max(0, Math.abs(a + b - 2 * c) * .5 - Math.abs(a - b) * .57 - 1);
  };
  // A printed line stands out from the same-direction texture a third of a cell to either side;
  // rock and hatching are equally busy everywhere.
  const away = Math.max(d + 2, Math.round(Math.min(cw, ch) * .3));
  const ridgeX = (x, y) => {const v = lineX(x, y); return v > ridge && v > contrast * Math.max(lineX(x - away, y), lineX(x + away, y));};
  const ridgeY = (x, y) => {const v = lineY(x, y); return v > ridge && v > contrast * Math.max(lineY(x, y - away), lineY(x, y + away));};
  const scores = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = ox + c * cw, y0 = oy + r * ch;
    let hit = 0, total = 0;
    for (let k = .2; k < .81; k += .1) {
      for (const edge of [0, 1]) {
        hit += ridgeX(Math.round(x0 + edge * cw), Math.round(y0 + k * ch)) ? 1 : 0;
        hit += ridgeY(Math.round(x0 + k * cw), Math.round(y0 + edge * ch)) ? 1 : 0;
        total += 2;
      }
    }
    scores[r * cols + c] = hit / total;
  }
  return scores;
}

function components(mask, cols, rows, want) {
  const label = new Int32Array(cols * rows).fill(-1), found = [];
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== -1 || (mask[start] === 1) !== want) continue;
    const id = found.length, cells = [], stack = [start];
    label[start] = id;
    while (stack.length) {
      const at = stack.pop(), x = at % cols, y = (at / cols) | 0;
      cells.push(at);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (label[next] === -1 && (mask[next] === 1) === want) {label[next] = id; stack.push(next);}
      }
    }
    found.push(cells);
  }
  return found;
}

// Grid-line strength differs a lot between maps (faint on Redbrand, bold on Cragmaw), so pick the
// thresholds per map. The adventure's room polygons are rough but reliable labels: cells whose
// centre lies inside a numbered room are almost all floor. Choose the settings that best
// reproduce that mask, favouring recall because corridors outside numbered rooms are floor too.
const ridges = [1, 2, 3, 4, 6, 8, 12], contrasts = [0, 1.6, 2.5], cuts = [.08, .12, .16, .2, .25, .3, .35, .4, .5, .6];
export function roomMask(geometry, regions) {
  const polygons = regions.map(region => region.points).filter(points => points?.length >= 3);
  const mask = new Uint8Array(geometry.cols * geometry.rows);
  for (let r = 0; r < geometry.rows; r++) for (let c = 0; c < geometry.cols; c++) {
    const x = geometry.offsetX + (c + .5) * geometry.cellWidth, y = geometry.offsetY + (r + .5) * geometry.cellHeight;
    if (polygons.some(points => pointInPolygon(x, y, points))) mask[r * geometry.cols + c] = 1;
  }
  return mask;
}
export function calibrate({gray, width, height, scale, geometry, regions, options = {}}) {
  const inRoom = roomMask(geometry, regions), positives = inRoom.reduce((a, b) => a + b, 0);
  if (positives < 8) return null;
  let best = null;
  for (const ridge of ridges) for (const contrast of contrasts) {
    const scores = gridScores({gray, width, height, scale, geometry, options: {...options, ridge, contrast}});
    for (const cut of cuts) {
      let tp = 0, fp = 0;
      for (let i = 0; i < scores.length; i++) if (scores[i] > cut) {if (inRoom[i]) tp++; else fp++;}
      if (!tp) continue;
      const precision = tp / (tp + fp), recall = tp / positives, beta2 = 4;
      const f = (1 + beta2) * precision * recall / (beta2 * precision + recall);
      if (!best || f > best.f) best = {f: +f.toFixed(3), precision: +precision.toFixed(3), recall: +recall.toFixed(3), ridge, contrast, floorScore: cut};
    }
  }
  return best;
}

// Floor mask from scores plus the numbered room polygons.
export function floorMask({scores, geometry, regions = [], options = {}}) {
  const {floorScore, holeCells, roomHoleCells, minFloorCells} = {...defaults, ...options};
  const {cols, rows} = geometry;
  const polygons = regions.map(region => region.points).filter(points => points?.length >= 3);
  const inRoom = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = geometry.offsetX + (c + .5) * geometry.cellWidth, y = geometry.offsetY + (r + .5) * geometry.cellHeight;
    if (polygons.some(points => pointInPolygon(x, y, points))) inRoom[r * cols + c] = 1;
  }
  const floor = new Uint8Array(cols * rows);
  for (let i = 0; i < floor.length; i++) floor[i] = scores[i] > floorScore ? 1 : 0;
  // Furniture, rubble and water hide the printed grid. Patches enclosed by floor are floor, and
  // so are larger ones that sit almost entirely inside one numbered room (a pool, a crate stack).
  for (const cells of components(floor, cols, rows, false)) {
    const touchesEdge = cells.some(at => at % cols === 0 || at % cols === cols - 1 || at < cols || at >= cols * (rows - 1));
    if (touchesEdge) continue;
    const inside = cells.filter(at => inRoom[at]).length / cells.length;
    if (cells.length <= holeCells || cells.length <= roomHoleCells && inside >= .5 || cells.length <= roomHoleCells * 2 && inside >= .9) for (const at of cells) floor[at] = 1;
  }
  // Decoration (title, legend, border) can show grid-like lines far from any numbered room.
  const near = new Uint8Array(cols * rows), reach = options.roomReach ?? defaults.roomReach;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (inRoom[r * cols + c])
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const x = c + dx, y = r + dy;
      if (x >= 0 && y >= 0 && x < cols && y < rows) near[y * cols + x] = 1;
    }
  for (let i = 0; i < floor.length; i++) if (!near[i]) floor[i] = 0;
  // Trim one-cell spurs where a wall band was misread as floor.
  for (let pass = 0; pass < 2; pass++) {
    const drop = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!floor[r * cols + c] || inRoom[r * cols + c]) continue;
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = c + dx, y = r + dy;
        if (x >= 0 && y >= 0 && x < cols && y < rows && floor[y * cols + x]) n++;
      }
      if (n < 2) drop.push(r * cols + c);
    }
    for (const at of drop) floor[at] = 0;
  }
  // Drop stray patches that no numbered room explains.
  for (const cells of components(floor, cols, rows, true)) {
    if (cells.length < minFloorCells && !cells.some(at => inRoom[at])) for (const at of cells) floor[at] = 0;
  }
  return {floor, inRoom};
}

// Merge unit edges into straight segments, in cell units.
function mergeEdges(edges, vertical) {
  const lines = new Map();
  for (const [line, from] of edges) {
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line).push(from);
  }
  const output = [];
  for (const [line, starts] of lines) {
    starts.sort((a, b) => a - b);
    let begin = starts[0], end = begin + 1;
    for (const at of starts.slice(1)) {
      if (at === end) end++;
      else {output.push(vertical ? [line, begin, line, end] : [begin, line, end, line]); begin = at; end = at + 1;}
    }
    output.push(vertical ? [line, begin, line, end] : [begin, line, end, line]);
  }
  return output;
}

// Doors are bright rectangles drawn across a one-cell wall band between two rooms.
export function findDoors({floor, gray, width, height, scale, geometry, options = {}}) {
  const {doorLift} = {...defaults, ...options};
  const {cols, rows} = geometry;
  const cw = geometry.cellWidth * scale, ch = geometry.cellHeight * scale;
  const ox = geometry.offsetX * scale, oy = geometry.offsetY * scale;
  const at = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows ? floor[r * cols + c] === 1 : false;
  const mean = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(width, Math.round(x1)); y1 = Math.min(height, Math.round(y1));
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {sum += gray[y * width + x]; n++;}
    return n ? sum / n : 0;
  };
  const doors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (at(c, r)) continue;
    const across = at(c, r - 1) && at(c, r + 1) && !at(c - 1, r) && !at(c + 1, r) ? 'ns'
      : at(c - 1, r) && at(c + 1, r) && !at(c, r - 1) && !at(c, r + 1) ? 'ew' : null;
    if (!across) continue;
    const x0 = ox + c * cw, y0 = oy + r * ch;
    const core = mean(x0 + cw * .25, y0 + ch * .25, x0 + cw * .75, y0 + ch * .75);
    // Compare with the wall band continuing on either side of the doorway.
    const side = across === 'ns'
      ? [mean(x0 - cw * .75, y0 + ch * .25, x0 - cw * .25, y0 + ch * .75), mean(x0 + cw * 1.25, y0 + ch * .25, x0 + cw * 1.75, y0 + ch * .75)]
      : [mean(x0 + cw * .25, y0 - ch * .75, x0 + cw * .75, y0 - ch * .25), mean(x0 + cw * .25, y0 + ch * 1.25, x0 + cw * .75, y0 + ch * 1.75)];
    const lift = core - Math.max(...side);
    if (lift >= doorLift) doors.push({c, r, across, lift: Math.round(lift)});
  }
  return doors;
}

function percentile(gray, fraction) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 7) histogram[gray[i]]++;
  const target = Math.floor(histogram.reduce((a, b) => a + b, 0) * fraction);
  let sum = 0;
  for (let v = 0; v < 256; v++) {sum += histogram[v]; if (sum >= target) return v;}
  return 255;
}

// Interior walls are often drawn as thin dark lines on the grid line between two floor cells.
function thinWalls({floor, gray, width, height, scale, geometry, options = {}}) {
  const {thinCut} = {...defaults, ...options};
  const {cols, rows} = geometry;
  const cw = geometry.cellWidth * scale, ch = geometry.cellHeight * scale;
  const ox = geometry.offsetX * scale, oy = geometry.offsetY * scale;
  const dark = Math.max(40, Math.min(70, percentile(gray, .12)));
  const isFloor = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && floor[r * cols + c] === 1;
  const strip = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(width, Math.round(x1)); y1 = Math.min(height, Math.round(y1));
    let hit = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {hit += gray[y * width + x] <= dark ? 1 : 0; n++;}
    return n ? hit / n : 0;
  };
  const t = .12, vertical = [], horizontal = [];
  for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++) {
    if (!isFloor(c - 1, r) || !isFloor(c, r)) continue;
    const x = ox + c * cw;
    if (strip(x - t * cw, oy + (r + .2) * ch, x + t * cw, oy + (r + .8) * ch) > thinCut) vertical.push([c, r]);
  }
  for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isFloor(c, r - 1) || !isFloor(c, r)) continue;
    const y = oy + r * ch;
    if (strip(ox + (c + .2) * cw, y - t * ch, ox + (c + .8) * cw, y + t * ch) > thinCut) horizontal.push([r, c]);
  }
  return {vertical, horizontal};
}

// A lone thin segment is usually a barrel or a crate outline; real walls join other walls.
function dropIsolated(thin, boundary, minLength = 3) {
  const parent = new Map();
  const find = key => {
    if (!parent.has(key)) parent.set(key, key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(key) !== root) {const next = parent.get(key); parent.set(key, root); key = next;}
    return root;
  };
  const ends = edge => edge.vertical ? [edge.a + ',' + edge.b, edge.a + ',' + (edge.b + 1)] : [edge.b + ',' + edge.a, (edge.b + 1) + ',' + edge.a];
  const join = edge => {const [p, q] = ends(edge); parent.set(find(p), find(q));};
  for (const edge of [...thin, ...boundary]) join(edge);
  const size = new Map(), anchored = new Set();
  for (const edge of thin) {const root = find(ends(edge)[0]); size.set(root, (size.get(root) ?? 0) + 1);}
  for (const edge of boundary) anchored.add(find(ends(edge)[0]));
  return thin.filter(edge => {const root = find(ends(edge)[0]); return anchored.has(root) || size.get(root) >= minLength;});
}

export function detectMap({gray, width, height, scale, geometry, regions = [], options = {}}) {
  const tuned = options.auto === false ? null : calibrate({gray, width, height, scale, geometry, regions, options});
  options = {...options, ...(tuned && {ridge: tuned.ridge, contrast: tuned.contrast, floorScore: tuned.floorScore})};
  const scores = gridScores({gray, width, height, scale, geometry, options});
  const {floor, inRoom} = floorMask({scores, geometry, regions, options});
  const {cols, rows} = geometry;
  const doorCells = findDoors({floor, gray, width, height, scale, geometry, options});
  const doorAt = new Map(doorCells.map(door => [door.r * cols + door.c, door]));
  const isFloor = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && floor[r * cols + c] === 1;
  const vertical = [], horizontal = [], doors = [], boundary = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) {
    const left = isFloor(c - 1, r), right = isFloor(c, r);
    if (left === right) continue;
    // A doorway cell replaces the wall edge on one open side with a door and leaves the other open.
    const door = doorAt.get(r * cols + (left ? c : c - 1));
    if (door?.across === 'ew') {if (left) doors.push([c, r, c, r + 1, door.lift]); continue;}
    vertical.push([c, r]);
    boundary.push({vertical: true, a: c, b: r});
  }
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) {
    const up = isFloor(c, r - 1), down = isFloor(c, r);
    if (up === down) continue;
    const door = doorAt.get((up ? r : r - 1) * cols + c);
    if (door?.across === 'ns') {if (up) doors.push([c, r, c + 1, r, door.lift]); continue;}
    horizontal.push([r, c]);
    boundary.push({vertical: false, a: r, b: c});
  }
  // Doorway cells keep walls on the two sides that are not their open axis.
  for (const door of doorCells) {
    if (door.across === 'ns') {vertical.push([door.c, door.r], [door.c + 1, door.r]); boundary.push({vertical: true, a: door.c, b: door.r}, {vertical: true, a: door.c + 1, b: door.r});}
    else {horizontal.push([door.r, door.c], [door.r + 1, door.c]); boundary.push({vertical: false, a: door.r, b: door.c}, {vertical: false, a: door.r + 1, b: door.c});}
  }
  const found = thinWalls({floor, gray, width, height, scale, geometry, options});
  const thin = dropIsolated([...found.vertical.map(([c, r]) => ({vertical: true, a: c, b: r})), ...found.horizontal.map(([r, c]) => ({vertical: false, a: r, b: c}))], boundary);
  for (const edge of thin) (edge.vertical ? vertical : horizontal).push([edge.a, edge.b]);
  const walls = [...mergeEdges(vertical, true), ...mergeEdges(horizontal, false)];
  let roomCells = 0, roomFloor = 0;
  for (let i = 0; i < inRoom.length; i++) if (inRoom[i]) {roomCells++; if (floor[i]) roomFloor++;}
  return {
    floor, scores, walls, doors: doors.map(([x1, y1, x2, y2, lift]) => ({x1, y1, x2, y2, lift})),
    stats: {tuned, cols, rows, floorCells: floor.reduce((a, b) => a + b, 0), roomCells, roomCoverage: roomCells ? +(roomFloor / roomCells).toFixed(3) : null, walls: walls.length, thinEdges: thin.length, doors: doors.length},
  };
}
