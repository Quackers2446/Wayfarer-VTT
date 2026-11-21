import {keyAt, occupies} from "./combat.mjs";
import {cellCenter, regionAt} from "./encounters.mjs";

function polygon(context, points) {
  context.beginPath();
  points.forEach(([x,y], index) => index ? context.lineTo(x,y) : context.moveTo(x,y));
  context.closePath();
}

export function drawGrid(canvas, map, battle, {room, selected, target, cursor, art, path, visible, footprint, showRegions = true, markers = [], tokenImages}) {
  if (!canvas) return;
  const c = canvas.getContext("2d");
  const scale = Math.min(1, 1600 / Math.max(map.width,map.height));
  canvas.width = Math.max(1, Math.round(map.width * scale));
  canvas.height = Math.max(1, Math.round(map.height * scale));
  c.setTransform(canvas.width/map.width,0,0,canvas.height/map.height,0,0);
  c.fillStyle = "#1f2b24";
  c.fillRect(0,0,map.width,map.height);
  if (art) c.drawImage(art,0,0,map.width,map.height);
  c.lineWidth = Math.max(1,map.size *.042);

  for (const {id, points} of showRegions ? map.regions : []) {
    polygon(c,points);
    c.fillStyle = id === room?.id ? "#c9a65c51" : art ? "#dcd7b818" : "#4b6551";
    c.fill();
    c.strokeStyle = id === room?.id ? "#f3cd7f" : art ? "#dad6b371" : "#809481";
    c.stroke();
  }

  const grid = new Path2D();
  for (let x = map.offsetX; x <= map.width; x += map.size) {
    grid.moveTo(x,0); grid.lineTo(x,map.height);
  }
  for (let y = map.offsetY; y <= map.height; y += map.size) {
    grid.moveTo(0,y); grid.lineTo(map.width,y);
  }
  c.lineWidth = Math.max(1,map.size *.019);
  c.strokeStyle = art ? "#15191577" : "#ced9c329";
  c.stroke(grid);

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
    c.fillRect(map.offsetX+x*map.size,map.offsetY+y*map.size,map.size,map.size);
  }

  if (footprint?.size) {
    c.fillStyle = "#d68143a0";
    for (const key of footprint) {
      const [x,y] = key.split(":").map(Number);
      c.fillRect(map.offsetX+x*map.size,map.offsetY+y*map.size,map.size,map.size);
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

  for (const actor of battle.actors.filter((actor) => occupies(actor) && (!visible || visible.has(actor.id)))) {
    const [x,y] = cellCenter(map,actor);
    const radius = map.size * .42;
    c.beginPath(); c.arc(x,y,radius,0,Math.PI*2);
    c.fillStyle = actor.hp === 0 ? "#828584" : actor.side === "party" ? "#356b61" : actor.side === "neutral" ? "#6e6653" : "#9a453a";
    c.strokeStyle = actor.id === selected ? "#ffeead" : actor.id === target ? "#ffd3c8" : "#f6f4de";
    c.lineWidth = map.size * (actor.id === selected || actor.id === target ? .075 : .031);
    c.fill();
    const portrait = tokenImages?.get(actor.tokenArt);
    if (portrait) {
      c.save();
      c.clip();
      const factor = 2*radius / Math.max(portrait.naturalWidth,portrait.naturalHeight);
      const width = portrait.naturalWidth*factor, height = portrait.naturalHeight*factor;
      c.drawImage(portrait,x-width/2,y-height/2,width,height);
      c.restore();
    }
    c.stroke();
    c.font = "700 " + map.size*.42 + "px system-ui";
    c.fillStyle = "#fff9e8";
    c.textAlign = "center"; c.textBaseline = "middle";
    if (!portrait) c.fillText(actor.marker || actor.name.charAt(0).toUpperCase(),x,y);
    else if (actor.marker) {
      const bx=x+radius*.72, by=y+radius*.72;
      c.beginPath(); c.arc(bx,by,map.size*.16,0,Math.PI*2);
      c.fillStyle="#2b3027"; c.fill(); c.lineWidth=map.size*.019; c.strokeStyle="#efe6c7"; c.stroke();
      c.font="700 "+map.size*.19+"px system-ui"; c.fillStyle="#fff9e8";
      c.fillText(actor.marker,bx,by);
    }
  }

  if (cursor) {
    c.strokeStyle = "#ffedaa";
    c.lineWidth = map.size * .055;
    c.strokeRect(map.offsetX+cursor.x*map.size+.04*map.size,map.offsetY+cursor.y*map.size+.04*map.size,
      .92*map.size,.92*map.size);
  }
}

export function gridPosition(map, canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  const px = (event.clientX - bounds.left) * map.width / bounds.width;
  const py = (event.clientY - bounds.top) * map.height / bounds.height;
  return {
    x:Math.floor((px-map.offsetX)/map.size),y:Math.floor((py-map.offsetY)/map.size),
    region:regionAt(map,px,py),
  };
}

export function terrainAt(battle,x,y,mode) {
  if (mode === "clear") delete battle.terrain[keyAt(x,y)];
  else battle.terrain[keyAt(x,y)] = mode;
}
