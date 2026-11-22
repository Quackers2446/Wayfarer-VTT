import {tokenSize} from './actor-space.mjs';
const FIVE_FEET = 5;
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
const positive = (value, fallback) => value > 0 && Number.isFinite(value) ? value : fallback;

export function sourceGrid(metadata) {
  const scale = positive(metadata.scale,1);
  const distance = positive(metadata.distance,FIVE_FEET);
  const nativeCell = metadata.size/scale;
  // With an explicit distance the source specifies the resized grid directly.
  const guideSize = metadata.distance ? nativeCell : metadata.size;
  return {
    width:guideSize, height:guideSize,
    x:number(metadata.offsetX,0)/scale, y:number(metadata.offsetY,0)/scale,
    divisions:(guideSize/nativeCell)*(distance/FIVE_FEET),
  };
}

export function legacyGeometry(metadata,width,height) {
  const size = metadata.size/positive(metadata.scale,1);
  const origin = (value) => {
    const offset = number(value,0)%size;
    return offset>0 ? offset-size : offset;
  };
  const offsetX=origin(metadata.offsetX), offsetY=origin(metadata.offsetY);
  return {size,cellWidth:size,cellHeight:size,offsetX,offsetY,
    cols:Math.ceil((width-offsetX)/size),rows:Math.ceil((height-offsetY)/size)};
}

export function gridGeometry(map, alignment = map.sourceGrid) {
  const source = map.sourceGrid;
  const divisions = source.divisions;
  const cellWidth = alignment.width/divisions;
  const cellHeight = alignment.height/divisions;
  // Keep the same cell numbering as the source, including cropped edge cells.
  const firstCol = Math.floor(-source.x/(source.width/divisions));
  const firstRow = Math.floor(-source.y/(source.height/divisions));
  const offsetX = alignment.x+firstCol*cellWidth;
  const offsetY = alignment.y+firstRow*cellHeight;
  return {
    printedGrid:alignment,
    size:Math.min(cellWidth,cellHeight),cellWidth,cellHeight,offsetX,offsetY,
    cols:Math.ceil((map.width-offsetX)/cellWidth),
    rows:Math.ceil((map.height-offsetY)/cellHeight),
  };
}

export function validGeometry(geometry) {
  return [geometry.cellWidth,geometry.cellHeight].every((value) => Number.isFinite(value) && value>0) &&
    Number.isFinite(geometry.offsetX) && Number.isFinite(geometry.offsetY) &&
    geometry.cols>0 && geometry.rows>0 && geometry.cols*geometry.rows<=90000;
}

export function cellBounds(map, cell) {
  const width = map.cellWidth ?? map.size;
  const height = map.cellHeight ?? map.size;
  return [map.offsetX + cell.x*width, map.offsetY + cell.y*height, width, height];
}

export function cellCenter(map, cell) {
  const [x,y,width,height] = cellBounds(map,cell);
  return [x+width*tokenSize(cell)/2,y+height*tokenSize(cell)/2];
}

export function cellAt(map, x, y) {
  return {
    x:Math.floor((x-map.offsetX)/(map.cellWidth ?? map.size)),
    y:Math.floor((y-map.offsetY)/(map.cellHeight ?? map.size)),
  };
}

export function firstLine(origin, spacing) {
  const phase = origin%spacing;
  return phase<0 ? phase+spacing : phase;
}

function sample(profile, x) {
  const at = Math.floor(x);
  const weight = x-at;
  return profile[at]*(1-weight) + profile[at+1]*weight;
}

function measure(profile, spacing, origin) {
  const start = profile.length*.035;
  const end = profile.length-start;
  let score=0, support=0, count=0;
  for (let x=firstLine(origin,spacing);x<end;x+=spacing) {
    if (x-spacing*.15<start || x+spacing*.15>=end) continue;
    const baseline = (sample(profile,x-spacing*.15)+sample(profile,x+spacing*.15))/2;
    const amplitude = sample(profile,x)-baseline;
    score += amplitude;
    if (amplitude>0) support += 1;
    count += 1;
  }
  return count ? {score:score/count,support:support/count,count} : {score:0,support:0,count:0};
}

export function fitAxis(profile, sourceSpacing, sourceOffset, divisions) {
  if (sourceSpacing<9 || profile.length/sourceSpacing<7) return null;
  const initial = measure(profile,sourceSpacing,sourceOffset);
  const center = (profile.length/2-sourceOffset)/sourceSpacing;
  const offsetRange = Math.min(sourceSpacing*.13,sourceSpacing/divisions*.32);
  let best = null;
  for (let change=-10;change<=10;change++) {
    const spacing = sourceSpacing*(1+change*.002);
    for (let drift=-10;drift<=10;drift++) {
      const origin = sourceOffset + drift*offsetRange/10;
      const result = measure(profile,spacing,origin);
      const centerShift = origin-sourceOffset + center*(spacing-sourceSpacing);
      if (Math.abs(centerShift)>sourceSpacing/divisions*.36 || result.count<6 || result.support<.66) continue;
      const rank = result.score*(.8+.2*result.support);
      if (!best || rank>best.rank) best={spacing,origin,rank,...result};
    }
  }
  const mean = profile.reduce((sum,value) => sum+value,0)/profile.length;
  const deviation = Math.sqrt(profile.reduce((sum,value) => sum+(value-mean)**2,0)/profile.length);
  if (!best || best.score<Math.max(.045,deviation*.34) || best.score<initial.score+Math.max(.022,deviation*.06)) return null;
  return {spacing:best.spacing,origin:best.origin};
}

function imageProfiles(image) {
  const scale = Math.min(1,1800/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas = document.createElement("canvas");
  const width = Math.round(image.naturalWidth*scale), height = Math.round(image.naturalHeight*scale);
  canvas.width=width; canvas.height=height;
  const ctx = canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(image,0,0,width,height);
  const pixels = ctx.getImageData(0,0,width,height).data;
  const luma = new Uint8Array(width*height);
  for (let i=0,j=0;i<luma.length;i++,j+=4) luma[i]=(3*pixels[j]+6*pixels[j+1]+pixels[j+2])/10;
  const columns = new Float32Array(width), rows = new Float32Array(height);
  const xMargin = Math.max(2,Math.floor(width*.045));
  const yMargin = Math.max(2,Math.floor(height*.045));
  const ridge = (center,before,after) => Math.max(0,Math.abs(before+after-2*center)*.5-Math.abs(before-after)*.57-1);
  for (let y=yMargin;y<height-yMargin;y++) {
    for (let x=xMargin;x<width-xMargin;x++) {
      const at = y*width+x;
      columns[x] += Math.min(55,ridge(luma[at],luma[at-1],luma[at+1]));
      rows[y] += Math.min(55,ridge(luma[at],luma[at-width],luma[at+width]));
    }
  }
  for (let x=0;x<width;x++) columns[x] /= height-2*yMargin;
  for (let y=0;y<height;y++) rows[y] /= width-2*xMargin;
  return {columns,rows};
}

export function alignArtwork(image,map) {
  const source = map.sourceGrid;
  if (!source) return null;
  const {columns,rows} = imageProfiles(image);
  const sx = columns.length/map.width, sy = rows.length/map.height;
  const x = fitAxis(columns,source.width*sx,source.x*sx,source.divisions);
  const y = fitAxis(rows,source.height*sy,source.y*sy,source.divisions);
  if (!x && !y) return null;
  return {
    width:x ? x.spacing/sx : source.width, height:y ? y.spacing/sy : source.height,
    x:x ? x.origin/sx : source.x, y:y ? y.origin/sy : source.y,
  };
}

export function fitsCurrentGrid(geometry, state) {
  if (!validGeometry(geometry)) return false;
  const inside = ({x,y}) => x==null || y==null || (x>=0 && y>=0 && x<geometry.cols && y<geometry.rows);
  return state.actors.every(inside) && (state.markers ?? []).every(inside) &&
    Object.keys(state.terrain).every((key) => {
      const [x,y]=key.split(":").map(Number);
      return inside({x,y});
    });
}

export function migrateGridState(map,state) {
  if (state.alignedGrid || !map.legacyGrid) return;
  state.alignedGrid = true;
  const old = map.legacyGrid;
  if (old.cellWidth===map.cellWidth && old.cellHeight===map.cellHeight &&
      old.offsetX===map.offsetX && old.offsetY===map.offsetY) return;
  const limit = ({x,y}) => ({x:Math.max(0,Math.min(map.cols-1,x)),y:Math.max(0,Math.min(map.rows-1,y))});
  const targetFor = (cell) => limit(cellAt(map,...cellCenter(old,cell)));
  const updatedTerrain = {};
  for (const [key,value] of Object.entries(state.terrain)) {
    const [x,y]=key.split(":").map(Number);
    const [left,top,width,height]=cellBounds(old,{x,y});
    const first=limit(cellAt(map,left,top)), last=limit(cellAt(map,left+width,top+height));
    let copied=false;
    for (let row=first.y;row<=last.y;row++) {
      for (let col=first.x;col<=last.x;col++) {
        const [px,py]=cellCenter(map,{x:col,y:row});
        if (px<left || px>=left+width || py<top || py>=top+height) continue;
        updatedTerrain[col+":"+row]=value;
        copied=true;
      }
    }
    if (!copied) {
      const cell=targetFor({x,y});
      updatedTerrain[cell.x+":"+cell.y]=value;
    }
  }
  state.terrain = updatedTerrain;
  const occupied = new Set();
  for (const actor of state.actors) {
    if (actor.x==null || actor.y==null) continue;
    const spot=targetFor(actor);
    let destination=spot;
    const key=(cell)=>cell.x+":"+cell.y;
    if (!actor.dead && (occupied.has(key(spot)) || updatedTerrain[key(spot)]==="wall")) {
      const cells=[];
      for (let dy=-2;dy<=2;dy++) {
        for (let dx=-2;dx<=2;dx++) {
          const cell={x:spot.x+dx,y:spot.y+dy};
          if (cell.x<0 || cell.y<0 || cell.x>=map.cols || cell.y>=map.rows || occupied.has(key(cell)) || updatedTerrain[key(cell)]==="wall") continue;
          cells.push({cell, distance:Math.abs(dx)+Math.abs(dy)});
        }
      }
      cells.sort((a,b)=>a.distance-b.distance);
      destination=cells[0]?.cell ?? {x:null,y:null};
    }
    Object.assign(actor,destination);
    if (!actor.dead && actor.x!=null) occupied.add(key(actor));
  }
  for (const marker of state.markers ?? []) Object.assign(marker,targetFor(marker));
  if (state.movement) {
    state.movement=null;
    state.log.push("Grid aligned. Select the movement destination again.");
  }
}
