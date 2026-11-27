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
    x:number(metadata.offsetX,0), y:number(metadata.offsetY,0),
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

/** Feet represented by one printed guide square (adventure default from divisions). */
export function defaultSquareFeet(source) {
  if (!source || !Number.isFinite(source.divisions)) return 5;
  return source.divisions >= 1.5 ? 10 : 5;
}

/** Override printed-square scale: 5 ft or 10 ft per guide square (tactical cells stay 5 ft). */
export function withSquareFeet(source, squareFt) {
  if (!source) return null;
  const feet = Number(squareFt) === 10 ? 10 : 5;
  return {...source, divisions: feet / FIVE_FEET};
}

export function gridGeometry(map, alignment = map.sourceGrid, squareFt = null) {
  const source = squareFt != null ? withSquareFeet(map.sourceGrid, squareFt) : map.sourceGrid;
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
  if (at < 0 || at + 1 >= profile.length) return 0;
  return profile[at]*(1-weight) + profile[at+1]*weight;
}

function profileStats(profile) {
  let sum = 0;
  for (let i = 0; i < profile.length; i++) sum += profile[i];
  const mean = sum / profile.length;
  let variance = 0;
  for (let i = 0; i < profile.length; i++) {
    const delta = profile[i] - mean;
    variance += delta * delta;
  }
  return {mean, deviation: Math.sqrt(variance / profile.length)};
}

/** Light 1D blur so faint / anti-aliased grid lines still form a stable period. */
export function smoothProfile(profile, radius = 1) {
  if (radius <= 0) return Float32Array.from(profile);
  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    let sum = 0, weight = 0;
    for (let d = -radius; d <= radius; d++) {
      const at = i + d;
      if (at < 0 || at >= profile.length) continue;
      const w = radius + 1 - Math.abs(d);
      sum += profile[at] * w;
      weight += w;
    }
    out[i] = sum / weight;
  }
  return out;
}

function measure(profile, spacing, origin) {
  const start = profile.length*.03;
  const end = profile.length-start;
  let score=0, support=0, count=0;
  for (let x=firstLine(origin,spacing);x<end;x+=spacing) {
    if (x-spacing*.18<start || x+spacing*.18>=end) continue;
    const baseline = (sample(profile,x-spacing*.18)+sample(profile,x+spacing*.18))/2;
    const amplitude = sample(profile,x)-baseline;
    score += amplitude;
    if (amplitude>0) support += 1;
    count += 1;
  }
  return count ? {score:score/count,support:support/count,count} : {score:0,support:0,count:0};
}

/**
 * Autocorrelation peak near the adventure's printed spacing.
 * Returns the lag (pixels) of the strongest period in [lo, hi], or null.
 */
export function autocorrPeriod(profile, sourceSpacing, {lo = 0.82, hi = 1.22} = {}) {
  if (!(sourceSpacing > 8) || profile.length < sourceSpacing * 6) return null;
  const {mean} = profileStats(profile);
  const minLag = Math.max(8, Math.floor(sourceSpacing * lo));
  const maxLag = Math.min(Math.floor(profile.length / 3), Math.ceil(sourceSpacing * hi));
  if (maxLag <= minLag + 2) return null;
  let bestLag = 0, bestScore = -Infinity, neighbor = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0, count = 0;
    for (let i = 0; i + lag < profile.length; i++) {
      score += (profile[i] - mean) * (profile[i + lag] - mean);
      count += 1;
    }
    score = count ? score / count : 0;
    if (score > bestScore) {
      neighbor = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (score > neighbor) {
      neighbor = score;
    }
  }
  if (!bestLag || bestScore <= 0) return null;
  // Require a distinct peak so noise floors don't invent a period.
  if (bestScore < neighbor * 1.08 && Math.abs(bestLag - sourceSpacing) > sourceSpacing * 0.04) return null;
  // Parabolic refine around the integer lag.
  const scoreAt = (lag) => {
    let score = 0, count = 0;
    for (let i = 0; i + lag < profile.length; i++) {
      score += (profile[i] - mean) * (profile[i + lag] - mean);
      count += 1;
    }
    return count ? score / count : 0;
  };
  if (bestLag > minLag && bestLag < maxLag) {
    const left = scoreAt(bestLag - 1), mid = bestScore, right = scoreAt(bestLag + 1);
    const denom = left - 2 * mid + right;
    if (Math.abs(denom) > 1e-9) {
      const delta = Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denom));
      bestLag += delta;
    }
  }
  return {spacing: bestLag, score: bestScore};
}

function refinePhase(profile, spacing, sourceOffset, divisions) {
  const offsetRange = Math.min(spacing * 0.5, Math.max(spacing / divisions * 0.55, spacing * 0.18));
  let best = null;
  for (let step = 0; step <= 24; step++) {
    const origin = sourceOffset + (step / 24 - 0.5) * 2 * offsetRange;
    const result = measure(profile, spacing, origin);
    if (result.count < 5) continue;
    const rank = result.score * (0.75 + 0.25 * result.support);
    if (!best || rank > best.rank) best = {spacing, origin, rank, ...result};
  }
  // Local polish around the winner.
  if (best) {
    for (let nudge = -6; nudge <= 6; nudge++) {
      if (!nudge) continue;
      const origin = best.origin + nudge * spacing * 0.01;
      const result = measure(profile, spacing, origin);
      if (result.count < 5) continue;
      const rank = result.score * (0.75 + 0.25 * result.support);
      if (rank > best.rank) best = {spacing, origin, rank, ...result};
    }
  }
  return best;
}

export function fitAxis(profile, sourceSpacing, sourceOffset, divisions) {
  if (sourceSpacing < 9 || profile.length / sourceSpacing < 6) return null;
  const smoothed = smoothProfile(profile, 1);
  const initial = measure(smoothed, sourceSpacing, sourceOffset);
  const {deviation} = profileStats(smoothed);
  const center = (smoothed.length / 2 - sourceOffset) / sourceSpacing;
  const maxCenterShift = sourceSpacing / divisions * 0.55;

  const candidates = [sourceSpacing];
  const auto = autocorrPeriod(smoothed, sourceSpacing, {lo: 0.84, hi: 1.2});
  if (auto?.spacing) candidates.push(auto.spacing);
  // Wider spacing sweep than the old ±2% — artwork is often resampled a bit off the module guide.
  for (let change = -20; change <= 20; change++) {
    if (!change) continue;
    candidates.push(sourceSpacing * (1 + change * 0.004));
  }

  let best = null;
  const seen = new Set();
  for (const spacing of candidates) {
    const key = spacing.toFixed(3);
    if (seen.has(key) || spacing < 8 || smoothed.length / spacing < 5.5) continue;
    seen.add(key);
    const refined = refinePhase(smoothed, spacing, sourceOffset, divisions);
    if (!refined) continue;
    const centerShift = refined.origin - sourceOffset + center * (spacing - sourceSpacing);
    if (Math.abs(centerShift) > maxCenterShift || refined.support < 0.55) continue;
    const nearSource = Math.abs(spacing - sourceSpacing) / sourceSpacing < 0.03;
    const autocorrBoost = auto && Math.abs(spacing - auto.spacing) < 0.75 ? 1.12 : 1;
    const rank = refined.score * (0.72 + 0.28 * refined.support) * autocorrBoost * (nearSource ? 1.04 : 1);
    if (!best || rank > best.rank) best = {...refined, rank};
  }

  if (!best) return null;
  const minScore = Math.max(0.028, deviation * 0.22);
  const improvement = Math.max(0.008, deviation * 0.035);
  const strongAuto = Boolean(auto && Math.abs(best.spacing - auto.spacing) < 1 && best.support >= 0.7);
  if (best.score < minScore) return null;
  if (!strongAuto && best.score < initial.score + improvement && Math.abs(best.spacing - sourceSpacing) < sourceSpacing * 0.01) {
    // No meaningful improvement over the adventure guide — keep the guide.
    return null;
  }
  if (!strongAuto && best.score < initial.score + improvement * 0.35 && best.support < 0.72) return null;
  return {spacing: best.spacing, origin: best.origin, score: best.score, support: best.support};
}

function imageProfiles(image) {
  const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", {willReadFrequently: true});
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const luma = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < luma.length; i++, j += 4) luma[i] = (3 * pixels[j] + 6 * pixels[j + 1] + pixels[j + 2]) / 10;
  const columns = new Float32Array(width), rows = new Float32Array(height);
  const xMargin = Math.max(2, Math.floor(width * 0.03));
  const yMargin = Math.max(2, Math.floor(height * 0.03));
  // Ridge + absolute gradient catches both crisp engraved lines and soft anti-aliased grids.
  const response = (center, before, after) => {
    const ridge = Math.max(0, Math.abs(before + after - 2 * center) * 0.5 - Math.abs(before - after) * 0.45);
    const edge = Math.abs(after - before) * 0.35;
    return Math.min(60, ridge + edge);
  };
  for (let y = yMargin; y < height - yMargin; y++) {
    for (let x = xMargin; x < width - xMargin; x++) {
      const at = y * width + x;
      columns[x] += response(luma[at], luma[at - 1], luma[at + 1]);
      rows[y] += response(luma[at], luma[at - width], luma[at + width]);
    }
  }
  for (let x = 0; x < width; x++) columns[x] /= height - 2 * yMargin;
  for (let y = 0; y < height; y++) rows[y] /= width - 2 * xMargin;
  return {columns, rows};
}

/** Place uploaded artwork under fixed rooms/monsters. scale 1 + x/y 0 fills the map as before. */
export function normalizeArtworkFit(fit) {
  if (!fit || typeof fit !== "object") return { x: 0, y: 0, scale: 1 };
  const scale = Number(fit.scale);
  const x = Number(fit.x), y = Number(fit.y);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    scale: scale > 0 && Number.isFinite(scale) ? scale : 1,
  };
}

export function artworkDestination(map, fit) {
  const place = normalizeArtworkFit(fit);
  return {
    x: place.x,
    y: place.y,
    width: map.width * place.scale,
    height: map.height * place.scale,
    scale: place.scale,
  };
}

export function artworkFitIsDefault(fit) {
  const place = normalizeArtworkFit(fit);
  return place.scale === 1 && place.x === 0 && place.y === 0;
}

/** Map stretch-fill alignment into the placed-image coordinate system. */
export function alignmentForArtworkFit(alignment, fit) {
  if (!alignment) return null;
  const place = normalizeArtworkFit(fit);
  if (artworkFitIsDefault(place)) return alignment;
  return {
    width: alignment.width * place.scale,
    height: alignment.height * place.scale,
    x: place.x + alignment.x * place.scale,
    y: place.y + alignment.y * place.scale,
  };
}

export function alignArtwork(image, map, squareFt = null, fit = null) {
  const source = squareFt != null ? withSquareFeet(map.sourceGrid, squareFt) : map.sourceGrid;
  if (!source) return null;
  const {columns, rows} = imageProfiles(image);
  const sx = columns.length / map.width, sy = rows.length / map.height;
  const x = fitAxis(columns, source.width * sx, source.x * sx, source.divisions);
  const y = fitAxis(rows, source.height * sy, source.y * sy, source.divisions);
  if (!x && !y) return null;

  let width = x ? x.spacing / sx : source.width;
  let height = y ? y.spacing / sy : source.height;
  // Prefer square tactical cells when both axes locked onto nearly the same period.
  if (x && y) {
    const ratio = width / height;
    if (ratio > 0.97 && ratio < 1.03) {
      const shared = (width + height) / 2;
      width = shared;
      height = shared;
    }
  } else if (x && !y) height = width;
  else if (y && !x) width = height;

  return alignmentForArtworkFit({
    width, height,
    x: x ? x.origin / sx : source.x,
    y: y ? y.origin / sy : source.y,
  }, fit);
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
