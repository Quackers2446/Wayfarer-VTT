import {segmentsBlock} from './wall-geometry.mjs';
// Calibrated against the 30 × 21 printed grid in both Cragmaw Hideout images.
// Each row lists inclusive spans of walkable columns, in source-grid coordinates.
const hideoutRows = [
  [], [], [[9,13]], [[8,9],[13,20],[23,24]], [[3,5],[8,8],[14,25]],
  [[2,8],[14,16],[20,26]], [[2,6],[8,17],[20,27]], [[2,6],[11,14],[17,28]],
  [[2,8],[12,13],[19,19],[21,28]], [[2,9],[12,15],[23,27]], [[4,4],[6,8],[12,17],[20,20],[23,25]],
  [[12,18],[20,25]], [[12,13],[15,25],[27,27]], [[8,13],[16,17],[20,27]],
  [[6,14],[21,27]], [[6,18],[23,27]], [[6,19],[23,27]], [[6,19]], [[6,19]], [[6,20]], [],
];

const cellKey = (x,y) => `${x}:${y}`;
const edgeKey = (a,b) => [cellKey(a.x,a.y),cellKey(b.x,b.y)].sort().join("/");
const hideoutEdges = new Set([
  // The narrow rock between the stream bank and the wolf chamber runs inside this pair of cells.
  edgeKey({x:13,y:9},{x:14,y:9}),
]);
// The dense briars on the east bank conceal the lookout. Characters can cross them on foot.
const hideoutScreen = new Set(Array.from({length:5},(_,i) => edgeKey({x:12,y:15+i},{x:13,y:15+i})));
const hideout = {rows:hideoutRows,edges:hideoutEdges,screen:hideoutScreen};

export function mapWalls(map, battle) {
  const custom = getWallData(map, battle);
  if (custom && (custom.manual || custom.walls?.length || custom.doors?.length)) return custom;
  return map?.module === "LMoP" && map.id === "1ab" && map.cols >= 30 && map.cols <= 31 && map.rows >= 21 && map.rows <= 22 ?
    hideout : null;
}

export function getWallData(map, battle) {
  return battle?.wallData ?? map?.wallData ?? null;
}

export function linesIntersect(ax,ay,bx,by,cx,cy,dx,dy) {
  return segmentsBlock({x:ax,y:ay},{x:bx,y:by},{x:cx,y:cy},{x:dx,y:dy});
}

export function normSeg(x1, y1, x2, y2) {
  if (x1 < x2 || (x1 === x2 && y1 <= y2)) return {x1, y1, x2, y2};
  return {x1:x2, y1:y2, x2:x1, y2:y1};
}

export function segKey(s) {
  const {x1, y1, x2, y2} = normSeg(s.x1, s.y1, s.x2, s.y2);
  return `${x1},${y1}:${x2},${y2}`;
}

export function addWall(wallData, x1, y1, x2, y2) {
  wallData.walls ??= [];
  const seg = normSeg(x1, y1, x2, y2);
  const key = segKey(seg);
  if (!wallData.walls.some(w => segKey(w) === key)) {
    wallData.walls.push(seg);
  }
  return seg;
}

export function removeWall(wallData, x1, y1, x2, y2) {
  if (!wallData?.walls) return;
  const seg = normSeg(x1, y1, x2, y2);
  const nextWalls = [];
  for (const w of wallData.walls) {
    const nw = normSeg(w.x1, w.y1, w.x2, w.y2);
    // Exact match
    if (segKey(nw) === segKey(seg)) continue;
    // Vertical overlap carving
    if (nw.x1 === nw.x2 && seg.x1 === seg.x2 && nw.x1 === seg.x1) {
      const sy1 = Math.min(seg.y1, seg.y2), sy2 = Math.max(seg.y1, seg.y2);
      const wy1 = Math.min(nw.y1, nw.y2), wy2 = Math.max(nw.y1, nw.y2);
      if (sy1 <= wy1 && sy2 >= wy2) continue; // Completely covered and removed
      if (sy1 >= wy1 && sy2 <= wy2) {
        if (sy1 > wy1) nextWalls.push(normSeg(nw.x1, wy1, nw.x1, sy1));
        if (sy2 < wy2) nextWalls.push(normSeg(nw.x1, sy2, nw.x1, wy2));
        continue;
      }
      if (sy1 > wy1 && sy1 < wy2) {
        nextWalls.push(normSeg(nw.x1, wy1, nw.x1, sy1));
        continue;
      }
      if (sy2 > wy1 && sy2 < wy2) {
        nextWalls.push(normSeg(nw.x1, sy2, nw.x1, wy2));
        continue;
      }
    }
    // Horizontal overlap carving
    if (nw.y1 === nw.y2 && seg.y1 === seg.y2 && nw.y1 === seg.y1) {
      const sx1 = Math.min(seg.x1, seg.x2), sx2 = Math.max(seg.x1, seg.x2);
      const wx1 = Math.min(nw.x1, nw.x2), wx2 = Math.max(nw.x1, nw.x2);
      if (sx1 <= wx1 && sx2 >= wx2) continue; // Completely covered and removed
      if (sx1 >= wx1 && sx2 <= wx2) {
        if (sx1 > wx1) nextWalls.push(normSeg(wx1, nw.y1, sx1, nw.y1));
        if (sx2 < wx2) nextWalls.push(normSeg(sx2, nw.y1, wx2, nw.y1));
        continue;
      }
      if (sx1 > wx1 && sx1 < wx2) {
        nextWalls.push(normSeg(wx1, nw.y1, sx1, nw.y1));
        continue;
      }
      if (sx2 > wx1 && sx2 < wx2) {
        nextWalls.push(normSeg(sx2, nw.y1, wx2, nw.y1));
        continue;
      }
    }
    nextWalls.push(w);
  }
  wallData.walls = nextWalls;
}

export function addDoor(wallData, x1, y1, x2, y2, state = "closed", label = "Door") {
  wallData.doors ??= [];
  const seg = normSeg(x1, y1, x2, y2);
  const key = segKey(seg);
  removeWall(wallData, x1, y1, x2, y2);
  let door = wallData.doors.find(d => segKey(d) === key);
  if (!door) {
    door = {id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2), ...seg, state, label};
    wallData.doors.push(door);
  } else {
    door.state = state;
    door.label = label;
  }
  return door;
}

export function removeDoor(wallData, doorId) {
  if (!wallData?.doors) return;
  wallData.doors = wallData.doors.filter(d => d.id !== doorId);
}

export function setDoorState(wallData, doorId, state) {
  const door = wallData?.doors?.find(d => d.id === doorId);
  if (!door) return null;
  door.state = state;
  return door;
}

export function toggleDoor(wallData, doorId, allowLocked = true) {
  const door = wallData?.doors?.find(d => d.id === doorId);
  if (!door) return null;
  if (door.state === "locked" && !allowLocked) return door;
  door.state = door.state === "open" ? "closed" : "open";
  return door;
}

export function doorAt(wallData, px, py, radius = 0.5) {
  if (!wallData?.doors) return null;
  for (const door of wallData.doors) {
    const midX = (door.x1 + door.x2) / 2;
    const midY = (door.y1 + door.y2) / 2;
    if (Math.hypot(px - midX, py - midY) <= radius) return door;
  }
  return null;
}

// Convert cell movement between (ax, ay) and (bx, by) into shared edge segment
function cellSharedEdge(a, b) {
  if (a.x === b.x && Math.abs(a.y - b.y) === 1) {
    // Vertical movement -> shared horizontal edge
    const y = Math.max(a.y, b.y);
    return normSeg(a.x, y, a.x + 1, y);
  }
  if (a.y === b.y && Math.abs(a.x - b.x) === 1) {
    // Horizontal movement -> shared vertical edge
    const x = Math.max(a.x, b.x);
    return normSeg(x, a.y, x, a.y + 1);
  }
  return null;
}

function edgeBlocked(wallData,a,b) {
  return [...(wallData.walls ?? []),...(wallData.doors ?? []).filter(d=>d.state!=='open')].some(w=>
    w.blocksMovement!==false && linesIntersect(a.x+.5,a.y+.5,b.x+.5,b.y+.5,w.x1,w.y1,w.x2,w.y2));
}

function crossesScreen(walls, from, to) {
  if (walls.screen.has(edgeKey(from,to))) return true;
  if (from.x === to.x || from.y === to.y) return false;
  return walls.screen.has(edgeKey(from,{x:to.x,y:from.y})) || walls.screen.has(edgeKey({x:from.x,y:to.y},to));
}

export function mapFloor(map,x,y, battle) {
  const custom = getWallData(map, battle);
  if (custom && (custom.manual || custom.walls?.length || custom.doors?.length)) {
    return x >= 0 && y >= 0 && x < map.cols && y < map.rows;
  }
  const walls = mapWalls(map, battle);
  return !walls || !walls.rows || Boolean(walls.rows[y]?.some(([first,last]) => x >= first && x <= last));
}

export function crossesMapWall(map, from, to, battle) {
  const custom = getWallData(map, battle);
  if(battle?.fogSettings?.blockMovement===false) return false;
  if (custom && (custom.manual || custom.walls?.length || custom.doors?.length)) {
    if (to.x < 0 || to.y < 0 || to.x >= map.cols || to.y >= map.rows) return true;
    if (from.x === to.x || from.y === to.y) {
      return edgeBlocked(custom, from, to);
    }
    // Diagonal move: blocked if shared corner is pinched by walls
    const across = {x:to.x, y:from.y};
    const down = {x:from.x, y:to.y};
    return edgeBlocked(custom,from,to) || edgeBlocked(custom, from, across) || edgeBlocked(custom, across, to) ||
           edgeBlocked(custom, from, down) || edgeBlocked(custom, down, to);
  }
  const walls = mapWalls(map, battle);
  if (!walls || !walls.rows) return false;
  if (!mapFloor(map,to.x,to.y, battle) || walls.edges.has(edgeKey(from,to))) return true;
  if (from.x === to.x || from.y === to.y) return false;
  const across = {x:to.x,y:from.y};
  const down = {x:from.x,y:to.y};
  return [across,down].some((via) => !mapFloor(map,via.x,via.y, battle) || walls.edges.has(edgeKey(from,via)) || walls.edges.has(edgeKey(via,to)));
}

export function mapLineClear(map, from, to, wallAt, vision, battle) {
  const custom = getWallData(map, battle);
  if (custom && (custom.manual || custom.walls?.length || custom.doors?.length)) {
    const rx1 = from.x + 0.5, ry1 = from.y + 0.5;
    const rx2 = to.x + 0.5, ry2 = to.y + 0.5;
    // Check closed doors
    for (const d of custom.doors ?? []) {
      if (d.state !== "open" && d.blocksVision!==false && linesIntersect(rx1, ry1, rx2, ry2, d.x1, d.y1, d.x2, d.y2)) {
        return false;
      }
    }
    // Check walls
    for (const w of custom.walls ?? []) {
      if (w.blocksVision!==false && linesIntersect(rx1, ry1, rx2, ry2, w.x1, w.y1, w.x2, w.y2)) {
        return false;
      }
    }
    // Also check any painted terrain walls along the ray
    const steps=Math.max(1,Math.ceil(Math.hypot(rx2-rx1,ry2-ry1)*4));
    for(let i=1;i<=steps;i++) {
      const t=i/steps;if(wallAt?.(Math.floor(rx1+(rx2-rx1)*t),Math.floor(ry1+(ry2-ry1)*t)))return false;
    }
    return true;
  }

  const walls = mapWalls(map, battle);
  const dx = Math.abs(to.x-from.x), dy = Math.abs(to.y-from.y);
  const stepX = Math.sign(to.x-from.x), stepY = Math.sign(to.y-from.y);
  let xSteps = 0, ySteps = 0;
  let here = {x:from.x,y:from.y};
  while (xSteps < dx || ySteps < dy) {
    const nextX = xSteps === dx ? Infinity : (2*xSteps+1)*dy;
    const nextY = ySteps === dy ? Infinity : (2*ySteps+1)*dx;
    const next = {...here};
    if (nextX <= nextY) {next.x += stepX; xSteps++;}
    if (nextY <= nextX) {next.y += stepY; ySteps++;}
    if (wallAt(next.x,next.y) || walls && (crossesMapWall(map,here,next,battle) || vision && crossesScreen(walls,here,next))) return false;
    if (next.x !== here.x && next.y !== here.y && (wallAt(next.x,here.y) || wallAt(here.x,next.y))) return false;
    here = next;
  }
  return true;
}
