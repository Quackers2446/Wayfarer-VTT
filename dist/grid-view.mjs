import {drawTokenHealth} from './token-health.mjs';
import {drawMonsterArtwork} from "./monster-art.mjs";
import {keyAt, occupies} from "./combat.mjs";
import {regionAt} from "./encounters.mjs";
import {hasExplored} from "./fog-memory.mjs";
import {cellAt, cellBounds, cellCenter, firstLine} from "./map-grid.mjs";
import {tokenSize,tokenRadius,containsCell} from './actor-space.mjs';
import {getWallData} from "./map-walls.mjs";

const maxRasterEdge = 4096;
const maxRasterPixels = 8 * 1024 * 1024;
const fogTextures = new WeakMap();
const fogDark = "#101a19";

export const defeatedCreature = (actor) => actor.dead && actor.side !== "party" &&
  Number.isInteger(actor.x) && Number.isInteger(actor.y);

export function tokenAtPoint(map,battle,x,y,visible=null) {
  // Match the circles and stacking order used by drawGrid, including corpses.
  for(const drawn of [occupies,defeatedCreature]) for(let i=battle.actors.length-1;i>=0;i--) {
    const actor=battle.actors[i];
    if(!drawn(actor) || visible && !visible.has(actor.id)) continue;
    const [cx,cy]=cellCenter(map,actor);
    const radius=tokenRadius(map,actor);
    if(tokenSize(actor)>1 && containsCell(actor,(x-map.offsetX)/(map.cellWidth ?? map.size),(y-map.offsetY)/(map.cellHeight ?? map.size))) return actor;
    if(Math.hypot(x-cx,y-cy)<=radius || actor.dead && Math.hypot(x-cx-radius*.72,y-cy-radius*.72)<=map.size*.20) return actor;
  }
  return null;
}

export function rasterPixelRatio(width, height, ratio) {
  return Math.min(ratio,maxRasterEdge/Math.max(width,height),Math.sqrt(maxRasterPixels/(width*height)));
}

function polygon(context, points) {
  context.beginPath();
  points.forEach(([x,y], index) => index ? context.lineTo(x,y) : context.moveTo(x,y));
  context.closePath();
}

function fogTexture(visible,memory) {
  const previous = fogTextures.get(memory);
  if (previous?.visible === visible && previous.revision === memory.revision) return previous.texture;
  const {cols,rows} = memory;
  const texture = previous?.texture ?? document.createElement("canvas");
  // A few samples per cell make the interpolated edge softer than a tile without blurring the artwork.
  const width = Math.min(cols*3,maxRasterEdge), height = Math.min(rows*3,maxRasterEdge);
  if (texture.width !== width) texture.width = width;
  if (texture.height !== height) texture.height = height;
  const fog = texture.getContext("2d");
  const stepX = width/cols, stepY = height/rows;
  fog.fillStyle = fogDark;
  fog.fillRect(0,0,width,height);
  fog.fillStyle = "#101a19a8";
  for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) {
    if (!hasExplored(memory,x,y)) continue;
    fog.clearRect(x*stepX,y*stepY,stepX,stepY);
    fog.fillRect(x*stepX,y*stepY,stepX,stepY);
  }
  for (const cell of visible) {
    const [x,y] = cell.split(":").map(Number);
    fog.clearRect(x*stepX,y*stepY,stepX,stepY);
  }
  fogTextures.set(memory,{visible,revision:memory.revision,texture});
  return texture;
}

const dynamicTextures=new WeakMap();
function dynamicFogTexture(map,{visible,memory,polygons,settings}) {
  const signature=JSON.stringify(settings),old=dynamicTextures.get(memory);
  if(old?.visible===visible && old.revision===memory.revision && old.signature===signature)return old.texture;
  const scale=Math.min(1,maxRasterEdge/Math.max(map.cols*(map.cellWidth??map.size),map.rows*(map.cellHeight??map.size)));
  const cellW=Math.max(1,Math.round((map.cellWidth??map.size)*scale)),cellH=Math.max(1,Math.round((map.cellHeight??map.size)*scale));
  const width=cellW*map.cols,height=cellH*map.rows;
  const texture=document.createElement('canvas');texture.width=width;texture.height=height;const c=texture.getContext('2d'),sx=cellW,sy=cellH;
  c.fillStyle=`rgba(16,26,25,${settings.opacity})`;c.fillRect(0,0,width,height);
  c.fillStyle=`rgba(16,26,25,${settings.exploredOpacity})`;
  if(settings.remember)for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++)if(hasExplored(memory,x,y)){c.clearRect(x*sx,y*sy,sx,sy);c.fillRect(x*sx,y*sy,sx,sy);}
  const mask=document.createElement('canvas');mask.width=width;mask.height=height;const m=mask.getContext('2d'),path=new Path2D();
  for(const points of polygons){if(!points.length)continue;path.moveTo(points[0].x*sx,points[0].y*sy);for(const p of points.slice(1))path.lineTo(p.x*sx,p.y*sy);path.closePath();}
  m.fillStyle='#fff';m.fill(path);
  // Feather inward: the clipping path prevents the blur from revealing beyond a wall.
  c.save();c.clip(path);c.globalCompositeOperation='destination-out';c.filter=`blur(${Math.max(0,settings.softness)/5*Math.min(sx,sy)}px)`;c.drawImage(mask,0,0);c.restore();
  dynamicTextures.set(memory,{visible,revision:memory.revision,signature,texture});return texture;
}

function drawFog(context,map,options) {
  const {visible,memory}=options;
  const texture = options.polygons ? dynamicFogTexture(map,options) : fogTexture(visible,memory);
  const [x,y,cellWidth,cellHeight] = cellBounds(map,{x:0,y:0});
  const width = cellWidth*map.cols, height = cellHeight*map.rows;
  const border = new Path2D();
  border.rect(0,0,map.width,map.height);
  const left = Math.max(0,x), top = Math.max(0,y);
  const right = Math.min(map.width,x+width), bottom = Math.min(map.height,y+height);
  if (right > left && bottom > top) border.rect(left,top,right-left,bottom-top);
  context.save();
  context.fillStyle = fogDark;
  context.fill(border,"evenodd");
  context.imageSmoothingEnabled = false;
  context.drawImage(texture,x,y,width,height);
  context.restore();
}

function drawToken(c,map,actor,portrait,highlight) {
  const [x,y] = cellCenter(map,actor);
  const radius = tokenRadius(map,actor);
  if(tokenSize(actor)>1) {
    const [left,top,width,height]=cellBounds(map,actor),n=tokenSize(actor);
    c.fillStyle=actor.dead ? '#9aa29c18' : actor.side==='hostile' ? '#bd66552a' : '#83b5a52a';c.fillRect(left,top,width*n,height*n);
    c.strokeStyle=actor.dead ? '#9aa29c' : highlight || '#dccca1';c.lineWidth=map.size*.02;c.strokeRect(left+1,top+1,width*n-2,height*n-2);
  }
  c.beginPath();
  c.arc(x,y,radius,0,Math.PI*2);
  c.fillStyle = actor.dead ? "#565c59" : actor.hp === 0 ? "#828584" :
    actor.side === "party" ? "#356b61" : actor.side === "neutral" ? "#6e6653" : "#9a453a";
  c.strokeStyle = actor.dead ? "#a6aea7" : highlight || "#f6f4de";
  c.lineWidth = map.size * (highlight ? .075 : .031);
  c.fill();
  if (portrait) {
    c.save();
    c.clip();
    if (actor.dead) {
      c.filter = "grayscale(1)";
      c.globalAlpha = .58;
    }
    drawMonsterArtwork(c,portrait,x,y,2*radius);
    c.restore();
  }
  c.stroke();
  c.textAlign = "center";
  c.textBaseline = "middle";
  if (!portrait) {
    c.font = "700 " + map.size*.42*tokenSize(actor) + "px system-ui";
    c.fillStyle = actor.dead ? "#c4c9c4" : "#fff9e8";
    c.fillText(actor.marker || actor.name.charAt(0).toUpperCase(),x,y);
  }
  if (actor.dead || portrait && actor.marker) {
    const bx = x+radius*.72, by = y+radius*.72;
    c.beginPath();
    c.arc(bx,by,map.size*(actor.dead ? .20 : .16),0,Math.PI*2);
    c.fillStyle = "#292e2a";
    c.fill();
    c.lineWidth = map.size*(actor.dead ? .023 : .019);
    c.strokeStyle = actor.dead ? "#efe6d1" : "#efe6c7";
    c.stroke();
    if (actor.dead) {
      const half = map.size*.077;
      c.beginPath();
      c.moveTo(bx-half,by-half);
      c.lineTo(bx+half,by+half);
      c.moveTo(bx+half,by-half);
      c.lineTo(bx-half,by+half);
      c.lineWidth = map.size*.046;
      c.stroke();
    } else {
      c.font = "700 " + map.size*.19 + "px system-ui";
      c.fillStyle = "#fff9e8";
      c.fillText(actor.marker,bx,by);
    }
  }
}

export function drawGrid(canvas, view, map, battle, {room, selected, target, cursor, art, path, visible, fog, footprint, showRegions = true, markers = [], tokenImages, tokenPositions, movementLabels, overlay = "artwork", wallEditor}) {
  // Match the display density while keeping the backing buffer bounded by the visible area.
  const ratio = rasterPixelRatio(view.width,view.height,view.ratio);
  const pixelsWide = Math.max(1,Math.floor(view.width*ratio));
  const pixelsHigh = Math.max(1,Math.floor(view.height*ratio));
  if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
  if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
  const c = canvas.getContext("2d");
  const mapScaleX = view.mapWidth/map.width, mapScaleY = view.mapHeight/map.height;
  const rasterScaleX = pixelsWide/view.width, rasterScaleY = pixelsHigh/view.height;
  const left = view.x/mapScaleX, top = view.y/mapScaleY;
  const width = view.width/mapScaleX, height = view.height/mapScaleY;
  c.save();
  c.setTransform(rasterScaleX*mapScaleX,0,0,rasterScaleY*mapScaleY,-view.x*rasterScaleX,-view.y*rasterScaleY);
  c.fillStyle = "#1f2b24";
  c.fillRect(left,top,width,height);
  c.imageSmoothingQuality = "high";
  if (art) {
    const sourceX = art.naturalWidth/map.width, sourceY = art.naturalHeight/map.height;
    c.drawImage(art,left*sourceX,top*sourceY,width*sourceX,height*sourceY,left,top,width,height);
  }
  c.lineWidth = Math.max(1,map.size *.042);

  for (const {id, points} of showRegions ? map.regions : []) {
    polygon(c,points);
    c.fillStyle = id === room?.id ? "#c9a65c51" : art ? "#dcd7b818" : "#4b6551";
    c.fill();
    c.strokeStyle = id === room?.id ? "#f3cd7f" : art ? "#dad6b371" : "#809481";
    c.stroke();
  }

  const layer = overlay === "artwork" ? (art ? null : "tactical") : overlay;
  if (layer) {
    const spacing = layer === "printed" && map.printedGrid ? map.printedGrid : {
      x:map.offsetX,y:map.offsetY,width:map.cellWidth ?? map.size,height:map.cellHeight ?? map.size,
    };
    const grid = new Path2D();
    for (let x=firstLine(spacing.x,spacing.width);x<=map.width;x+=spacing.width) {
      grid.moveTo(x,0); grid.lineTo(x,map.height);
    }
    for (let y=firstLine(spacing.y,spacing.height);y<=map.height;y+=spacing.height) {
      grid.moveTo(0,y); grid.lineTo(map.width,y);
    }
    c.lineWidth = Math.max(1,map.size*(layer==="printed" ? .028 : .019));
    c.strokeStyle = art ? (layer==="printed" ? "#ffbe63c4" : "#62d7d691") : "#ced9c34a";
    c.stroke(grid);
  }

  for (const {entry, points} of showRegions ? map.regions : []) {
    const label = /^([A-Za-z]?\d+[A-Za-z]?)\./.exec(entry?.name ?? "")?.[1];
    if (!label) continue;
    const [x,y] = points.reduce(([x,y],[px,py]) => [x+px/points.length,y+py/points.length],[0,0]);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "700 " + map.size*.72 + "px system-ui";
    c.lineWidth = map.size * .05;
    c.strokeStyle = "#25352c";
    c.fillStyle = "#e3d4a4";
    c.strokeText(label,x,y);
    c.fillText(label,x,y);
  }

  for (const [pair, value] of Object.entries(battle.terrain)) {
    const [x,y] = pair.split(":").map(Number);
    c.fillStyle = value === "wall" ? "#111713dd" : "#be874a8d";
    c.fillRect(...cellBounds(map,{x,y}));
  }

  if (footprint?.size) {
    c.fillStyle = "#d68143a0";
    for (const key of footprint) {
      const [x,y] = key.split(":").map(Number);
      c.fillRect(...cellBounds(map,{x,y}));
    }
  }

  if (path?.length) {
    c.beginPath();
    for (const [index, cell] of path.entries()) {
      const [x,y] = cellCenter(map,cell);
      if (index) c.lineTo(x,y);
      else c.moveTo(x,y);
    }
    c.strokeStyle = "#ffdc8a";
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = map.size * .10;
    c.stroke();
  }

  drawWallsAndDoors(c, map, battle, fog);

  if (fog) drawFog(c,map,fog);

  for (const zone of battle.spellZones ?? []) {
    c.fillStyle = zone.name === "Darkness" ? "#160e28a8" : "#b3cad252";
    for (const key of zone.cells) {
      const [x,y] = key.split(":").map(Number);
      if (!fog || fog.visible.has(key) || hasExplored(fog.memory,x,y)) c.fillRect(...cellBounds(map,{x,y}));
    }
  }

  for (const marker of markers) {
    const [x,y] = cellCenter(map,marker);
    const length = map.size * .30;
    const tones = {treasure:"#926739",object:"#49647a",hazard:"#a2653b",trap:"#a05142",creature:"#62665c"};
    c.save();
    c.translate(x,y);
    c.rotate(Math.PI/4);
    c.fillStyle = tones[marker.type] ?? tones.object;
    c.strokeStyle = "#f5e8c5"; c.lineWidth = map.size * .034;
    c.fillRect(-length,-length,2*length,2*length);
    c.strokeRect(-length,-length,2*length,2*length);
    c.restore();
    c.textAlign="center"; c.textBaseline="middle"; c.font="700 "+map.size*.35+"px system-ui"; c.fillStyle="#fff2d7";
    c.fillText({treasure:"◆",object:"◈",hazard:"!",trap:"!",creature:"?"}[marker.type] ?? "·",x,y);
  }

  const tokens = (visible ? battle.actors.filter((actor) => visible.has(actor.id)) : battle.actors).map(actor=>tokenPositions?.has(actor.id) ? {...actor,...tokenPositions.get(actor.id)} : actor);
  // Living tokens appear on top when they move through a defeated creature's square.
  for (const actor of tokens.filter(defeatedCreature)) drawToken(c,map,actor,tokenImages?.get(actor.id));
  for (const actor of tokens.filter(occupies)) drawToken(c,map,actor,tokenImages?.get(actor.id),
    actor.id === selected ? "#ffeead" : actor.id === target ? "#ffd3c8" : "");
  for(const actor of tokens.filter(actor=>occupies(actor)||defeatedCreature(actor)))drawTokenHealth(c,map,actor,mapScaleX,mapScaleY,{selected:actor.id===selected});
  for(const actor of tokens) {
    const label=movementLabels?.get(actor.id);if(!label) continue;
    const [x,y]=cellCenter(map,actor),top=y-tokenRadius(map,actor)-map.size*.12;
    c.font='600 '+map.size*.18+'px system-ui';c.textAlign='center';c.textBaseline='bottom';
    const width=c.measureText(label.text).width+map.size*.16;
    c.fillStyle='#122b23ed';c.fillRect(x-width/2,top-map.size*.24,width,map.size*.29);c.fillStyle='#f5e7c6';c.fillText(label.text,x,top);
  }

  if (cursor) {
    if (cursor.edge && (cursor.tool === "wall" || cursor.tool === "door" || cursor.tool === "erase-wall")) {
      const cw = map.cellWidth ?? map.size;
      const ch = map.cellHeight ?? map.size;
      const p1x = map.offsetX + cursor.edge.x1 * cw;
      const p1y = map.offsetY + cursor.edge.y1 * ch;
      const p2x = map.offsetX + cursor.edge.x2 * cw;
      const p2y = map.offsetY + cursor.edge.y2 * ch;
      c.save();
      c.lineCap = "round";
      c.lineWidth = Math.max(3, map.size * 0.12);
      c.strokeStyle = cursor.tool === "erase-wall" ? "#ff4d4dee" : cursor.tool === "door" ? "#f5b041ee" : "#2ecc71ee";
      c.beginPath();
      c.moveTo(p1x, p1y);
      c.lineTo(p2x, p2y);
      c.stroke();
      c.restore();
    } else {
      c.strokeStyle = "#ffedaa";
      c.lineWidth = map.size * .055;
      const [x,y,width,height]=cellBounds(map,cursor);
      c.strokeRect(x+.04*width,y+.04*height,.92*width,.92*height);
    }
  }
  wallEditor?.draw(c,map,mapScaleX,mapScaleY);
  c.restore();
}

export function drawWallsAndDoors(c, map, battle, fog) {
  const wallData = getWallData(map, battle);
  if (!wallData || (!wallData.walls?.length && !wallData.doors?.length)) return;
  const cw = map.cellWidth ?? map.size;
  const ch = map.cellHeight ?? map.size;
  const toPx = (gx, gy) => [map.offsetX + gx * cw, map.offsetY + gy * ch];

  // Draw walls
  if (wallData.walls?.length) {
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";

    // 1. Shadow / outline
    c.beginPath();
    for (const w of wallData.walls) {
      const [x1, y1] = toPx(w.x1, w.y1);
      const [x2, y2] = toPx(w.x2, w.y2);
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
    }
    c.strokeStyle = "#0e1512";
    c.lineWidth = Math.max(3, map.size * 0.12);
    c.stroke();

    // 2. Main stone
    c.strokeStyle = "#324339";
    c.lineWidth = Math.max(2, map.size * 0.08);
    c.stroke();

    // 3. Highlight line
    c.strokeStyle = "#536b5c";
    c.lineWidth = Math.max(1, map.size * 0.025);
    c.stroke();

    c.restore();
  }

  // Draw doors
  for (const door of wallData.doors ?? []) {
    const [p1x, p1y] = toPx(door.x1, door.y1);
    const [p2x, p2y] = toPx(door.x2, door.y2);
    const mx = (p1x + p2x) / 2;
    const my = (p1y + p2y) / 2;
    const len = Math.hypot(p2x - p1x, p2y - p1y);
    const ang = Math.atan2(p2y - p1y, p2x - p1x);

    // Secret door in fog/player mode: draw as normal wall so players don't know
    if (door.state === "secret" && fog) {
      c.save();
      c.lineCap = "round";
      c.strokeStyle = "#0e1512";
      c.lineWidth = Math.max(3, map.size * 0.12);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke();
      c.strokeStyle = "#324339";
      c.lineWidth = Math.max(2, map.size * 0.08);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke();
      c.restore();
      continue;
    }

    if (door.state === "secret" && !fog) {
      // DM view of secret door
      c.save();
      c.lineCap = "round";
      c.strokeStyle = "#b347d9";
      c.setLineDash([map.size * 0.08, map.size * 0.05]);
      c.lineWidth = Math.max(2, map.size * 0.08);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke();
      c.setLineDash([]);
      // Badge [S]
      c.beginPath();
      c.arc(mx, my, map.size * 0.14, 0, Math.PI * 2);
      c.fillStyle = "#2d163d";
      c.fill();
      c.strokeStyle = "#d88bf5";
      c.lineWidth = map.size * 0.025;
      c.stroke();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = "700 " + (map.size * 0.18) + "px system-ui";
      c.fillStyle = "#f5d9ff";
      c.fillText("S", mx, my);
      c.restore();
      continue;
    }

    // Door jambs at p1 and p2
    c.save();
    c.fillStyle = "#1e2823";
    c.beginPath();
    c.arc(p1x, p1y, map.size * 0.065, 0, Math.PI * 2);
    c.arc(p2x, p2y, map.size * 0.065, 0, Math.PI * 2);
    c.fill();

    if (door.state === "open") {
      // Open passageway: dashed archway threshold
      c.strokeStyle = "#5a6e6255";
      c.setLineDash([map.size * 0.04, map.size * 0.04]);
      c.lineWidth = Math.max(1, map.size * 0.03);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke();
      c.setLineDash([]);

      // Swung open door leaf pivoting from p1
      const swing = ang + Math.PI / 3;
      const sx = p1x + Math.cos(swing) * len * 0.85;
      const sy = p1y + Math.sin(swing) * len * 0.85;
      c.lineCap = "round";
      c.strokeStyle = "#1b110b";
      c.lineWidth = Math.max(3, map.size * 0.11);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(sx, sy); c.stroke();
      c.strokeStyle = "#7b431e";
      c.lineWidth = Math.max(2, map.size * 0.075);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(sx, sy); c.stroke();
      // Brass tip
      c.fillStyle = "#e8b348";
      c.beginPath(); c.arc(sx, sy, map.size * 0.035, 0, Math.PI * 2); c.fill();
    } else {
      // Closed or locked door
      c.lineCap = "square";
      // Shadow
      c.strokeStyle = "#170f0a";
      c.lineWidth = Math.max(3, map.size * 0.13);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke();
      // Wood bar
      c.strokeStyle = "#6e3816";
      c.lineWidth = Math.max(2, map.size * 0.095);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke();
      // Wood highlight
      c.strokeStyle = "#9c5728";
      c.lineWidth = Math.max(1, map.size * 0.025);
      c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke();

      // Brass center fitting
      c.fillStyle = door.state === "locked" ? "#c0392b" : "#e8b348";
      c.strokeStyle = "#2e1b08";
      c.lineWidth = map.size * 0.02;
      c.beginPath();
      c.arc(mx, my, map.size * 0.07, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      if (door.state === "locked") {
        c.fillStyle = "#ffffff";
        c.beginPath();
        c.arc(mx, my, map.size * 0.025, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }
}

export function nearestGridEdge(x, y, fx, fy) {
  const dLeft = fx;
  const dRight = 1 - fx;
  const dTop = fy;
  const dBottom = 1 - fy;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return {x1: x, y1: y, x2: x, y2: y + 1, orientation: "vertical"};
  if (min === dRight) return {x1: x + 1, y1: y, x2: x + 1, y2: y + 1, orientation: "vertical"};
  if (min === dTop) return {x1: x, y1: y, x2: x + 1, y2: y, orientation: "horizontal"};
  return {x1: x, y1: y + 1, x2: x + 1, y2: y + 1, orientation: "horizontal"};
}

export function gridPosition(map, surface, event) {
  const bounds = surface.getBoundingClientRect();
  const px = (event.clientX - bounds.left) * map.width / bounds.width;
  const py = (event.clientY - bounds.top) * map.height / bounds.height;
  const cellWidth = map.cellWidth ?? map.size;
  const cellHeight = map.cellHeight ?? map.size;
  const gx = (px - map.offsetX) / cellWidth;
  const gy = (py - map.offsetY) / cellHeight;
  const cellX = Math.floor(gx);
  const cellY = Math.floor(gy);
  const fx = gx - cellX;
  const fy = gy - cellY;
  return {
    ...cellAt(map,px,py),
    gx, gy, fx, fy, px, py,
    edge: nearestGridEdge(cellX, cellY, fx, fy),
    region: regionAt(map,px,py),
  };
}

export function terrainAt(battle,x,y,mode) {
  if (mode === "clear") delete battle.terrain[keyAt(x,y)];
  else battle.terrain[keyAt(x,y)] = mode;
}
