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

export function mapWalls(map) {
  return map?.module === "LMoP" && map.id === "1ab" && map.cols >= 30 && map.cols <= 31 && map.rows >= 21 && map.rows <= 22 ?
    hideout : null;
}

function crossesScreen(walls, from, to) {
  if (walls.screen.has(edgeKey(from,to))) return true;
  if (from.x === to.x || from.y === to.y) return false;
  return walls.screen.has(edgeKey(from,{x:to.x,y:from.y})) || walls.screen.has(edgeKey({x:from.x,y:to.y},to));
}

export function mapFloor(map,x,y) {
  const walls = mapWalls(map);
  return !walls || Boolean(walls.rows[y]?.some(([first,last]) => x >= first && x <= last));
}

export function crossesMapWall(map, from, to) {
  const walls = mapWalls(map);
  if (!walls) return false;
  if (!mapFloor(map,to.x,to.y) || walls.edges.has(edgeKey(from,to))) return true;
  if (from.x === to.x || from.y === to.y) return false;
  const across = {x:to.x,y:from.y};
  const down = {x:from.x,y:to.y};
  return [across,down].some((via) => !mapFloor(map,via.x,via.y) || walls.edges.has(edgeKey(from,via)) || walls.edges.has(edgeKey(via,to)));
}

export function mapLineClear(map, from, to, wallAt, vision) {
  const walls = mapWalls(map);
  if (!walls) return true;
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
    if (wallAt(next.x,next.y) || crossesMapWall(map,here,next) || vision && crossesScreen(walls,here,next)) return false;
    if (next.x !== here.x && next.y !== here.y && (wallAt(next.x,here.y) || wallAt(here.x,next.y))) return false;
    here = next;
  }
  return true;
}
