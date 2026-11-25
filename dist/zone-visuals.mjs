import {cellCenter} from './map-grid.mjs';
import {resolveSpellAnimation,spellAnimationSuppressed} from './spell-animation-library.mjs';
import {ruleKey, spellVisualValid} from './spell-rule-schema.mjs';
import {zoneLoopCatalog} from './zone-loop-catalog.mjs';

const MAX_ZONE_LOOPS = 8;
const aliases = {
  'arcane hand': 'bigbys hand',
  'black tentacles': 'evards black tentacles',
};

export function zoneSpellKey(zone) {
  const name = zone?.rule?.name ?? zone?.name ?? '';
  const key = ruleKey(String(name).split('|').at(-1));
  return aliases[key] ?? key;
}

function shapeMatches(clip, shape) {
  if (shape === 'ring') return /ring/i.test(clip.url + clip.id) || clip.kind === 'burst';
  if (shape === 'wall' || shape === 'line') return clip.kind === 'line';
  if (clip.kind === 'line' && !['wall', 'line'].includes(shape)) return false;
  if (/ring/i.test(clip.id) && shape !== 'ring') return false;
  return true;
}

/** Footprint diameter in cells for burst overlays. */
export function zoneDiameter(zone) {
  const rule = zone?.rule;
  if (!rule) return diameterFromCells(zone?.cells) ?? 2;
  if (rule.shape === 'movable' || rule.shape === 'sphere')
    return Math.max(1, (rule.radius > 0 ? rule.radius * 2 : 5) / 5);
  if (['circle', 'ring', 'aura'].includes(rule.shape))
    return Math.max(1, (Number(rule.radius) || 10) * 2 / 5);
  if (rule.shape === 'cube') return Math.max(1, (Number(rule.side) || 10) / 5);
  return diameterFromCells(zone?.cells) ?? Math.max(1, Number(rule.radius || rule.side || 10) / 5);
}

function diameterFromCells(cells) {
  if (!cells?.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const key of cells) {
    const [x, y] = String(key).split(':').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return Math.max(1, Math.max(maxX - minX + 1, maxY - minY + 1));
}

/** Pick a looping overlay for a persistent zone, or null if none is available. */
export function zoneLoopVisual(zone) {
  const rule = zone?.rule;
  // Explicit “no animation” / empty visual must not fall back to the zone-loop catalogue.
  if (spellAnimationSuppressed(rule)) return null;
  const key = zoneSpellKey(zone);
  const shape = rule?.shape;
  const matches = zoneLoopCatalog.filter((clip) => clip.spells.includes(key) && shapeMatches(clip, shape));
  if (shape === 'ring') {
    const ring = matches.find((clip) => /ring/i.test(clip.url + clip.id));
    if (ring) return structuredClone(ring);
  }
  if (shape === 'wall' || shape === 'line') {
    const line = matches.find((clip) => clip.kind === 'line');
    if (line) return structuredClone(line);
  }
  const preferred = matches.find((clip) => clip.url.startsWith('/')) ?? matches[0];
  if (preferred) return structuredClone(preferred);
  const cast = resolveSpellAnimation(zone?.rule?.name ?? zone?.name, rule);
  if (cast?.url) return {...structuredClone(cast), loop: true, duration: cast.duration ?? 4000};
  return null;
}

function zoneAnchor(zone, battle) {
  if (zone.follow) {
    const caster = battle?.actors?.find((actor) => actor.id === zone.caster);
    if (caster && Number.isFinite(caster.x) && Number.isFinite(caster.y))
      return {x: caster.x, y: caster.y};
  }
  const square = zone.square;
  if (square && Number.isFinite(square.x) && Number.isFinite(square.y)) return square;
  const key = zone.cells?.[0];
  if (!key) return null;
  const [x, y] = String(key).split(':').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
}

/** True only when the full footprint is in current sight — a continuous video must not span into fog. */
export function zoneOverlayAllowed(zone, view) {
  if (zone?.preview) return true;
  if (!view?.fogEnabled) return true;
  const sight = view.sight;
  if (!sight) return true;
  const cells = zone.cells?.length
    ? zone.cells
    : [zoneAnchor(zone, view.battle), zone.end].filter((point) => Number.isFinite(point?.x)).map((point) => point.x + ':' + point.y);
  if (!cells.length) {
    const at = zoneAnchor(zone, view.battle);
    return Boolean(at && sight.has(at.x + ':' + at.y));
  }
  // Partial sight keeps soft cell tints only; the looping clip would reveal the rest of the wall/area.
  return cells.every((key) => sight.has(key));
}

function signature(zone, battle, visual) {
  const at = zoneAnchor(zone, battle);
  const end = zone.end;
  return [
    zone.id,
    visual?.url,
    visual?.kind,
    at?.x, at?.y,
    end?.x, end?.y,
    zone.rule?.shape,
    zone.hotSide,
    zoneDiameter(zone),
  ].join(':');
}

function placeEntry(entry, view) {
  const {video, zone, visual, battle} = entry;
  if (!view?.layer?.isConnected || !view.grid || !view.map) return;
  const at = zoneAnchor(zone, battle);
  if (!at) { video.style.display = 'none'; return; }
  if (!zoneOverlayAllowed(zone, view)) { video.style.display = 'none'; return; }
  video.style.display = '';
  const {map, grid, layer} = view;
  const rect = grid.getBoundingClientRect();
  const origin = layer.getBoundingClientRect();
  const project = (point) => {
    const [x, y] = cellCenter(map, point);
    return [rect.left - origin.left + x / map.width * rect.width, rect.top - origin.top + y / map.height * rect.height];
  };
  const [sx, sy] = project(at);
  const unit = map.size / map.width * rect.width;
  const line = visual.kind === 'line' && zone.end && Number.isFinite(zone.end.x);
  if (line) {
    const [tx, ty] = project(zone.end);
    const distance = Math.hypot(tx - sx, ty - sy);
    video.style.width = (distance + unit) + 'px';
    video.style.height = unit + 'px';
    video.style.left = ((sx + tx) / 2) + 'px';
    video.style.top = ((sy + ty) / 2) + 'px';
    video.style.transformOrigin = 'center';
    video.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(ty - sy, tx - sx)}rad)`;
  } else {
    const diameter = Math.max(1, zoneDiameter(zone)) * (visual.scale ?? 1);
    video.style.width = unit * diameter + 'px';
    video.style.height = unit * diameter + 'px';
    video.style.left = sx + 'px';
    video.style.top = sy + 'px';
    video.style.transformOrigin = 'center';
    video.style.transform = 'translate(-50%,-50%)';
  }
  if (video.parentElement !== layer) layer.append(video);
}

/** Keyed BLFX clips use native alpha where decoded and a dark-background fallback on WebKit. */
export function spellClipBlend(visual, key = '') {
  if (visual?.url?.startsWith('/assets/animations/blfx-')) {
    const browser = globalThis.navigator?.userAgent ?? '';
    return /AppleWebKit\//.test(browser) && !/(?:Chrome|Chromium)\//.test(browser) ? 'dark-plate' : '';
  }
  const label = `${key} ${visual?.id ?? ''} ${visual?.url ?? ''}`;
  if (/fire|flaming|daggers|moonbeam|spirit|energy|aura|crusader|circle of power|light|radiant|storm|ice|frost|lightning|holy|sacred|wind|wall of/i.test(label))
    return 'screen';
  return '';
}

function makeVideo(visual, key) {
  const video = document.createElement('video');
  video.className = 'spell-video-effect zone-loop-effect';
  video.setAttribute('aria-hidden', 'true');
  const blend = spellClipBlend(visual, key);
  if (blend) video.dataset.blend = blend;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.referrerPolicy = 'no-referrer';
  video.src = visual.url;
  video.play().catch(() => {});
  return video;
}

export function createZoneVisuals(getView) {
  const active = new Map();
  let aimEntry = null;

  function disposeEntry(entry) {
    if (!entry) return;
    entry.video.pause();
    entry.video.removeAttribute('src');
    entry.video.load();
    entry.video.remove();
  }

  function stopAll() {
    for (const entry of active.values()) disposeEntry(entry);
    active.clear();
  }

  function clearAim() {
    disposeEntry(aimEntry);
    aimEntry = null;
  }

  function place() {
    const view = getView();
    if (!view?.layer?.isConnected) return;
    for (const entry of active.values()) placeEntry(entry, view);
    if (aimEntry) placeEntry(aimEntry, view);
  }

  function sync(battle) {
    const view = getView();
    if (!view?.layer || !battle || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stopAll();
      clearAim();
      return;
    }
    const zones = (battle.spellZones ?? [])
      .filter((zone) => zone && (zone.cells?.length || zone.square || zone.follow))
      .slice(0, MAX_ZONE_LOOPS);
    const keep = new Set();
    for (const zone of zones) {
      const visual = zoneLoopVisual(zone);
      if (!visual || !spellVisualValid(visual) || !visual.url) continue;
      const sig = signature(zone, battle, visual);
      keep.add(zone.id);
      let entry = active.get(zone.id);
      if (!entry || entry.sig !== sig) {
        disposeEntry(entry);
        entry = {video: makeVideo(visual, zoneSpellKey(zone)), zone, visual, battle, sig};
        active.set(zone.id, entry);
      } else {
        entry.zone = zone;
        entry.battle = battle;
        entry.visual = visual;
      }
    }
    for (const [id, entry] of active) {
      if (keep.has(id)) continue;
      disposeEntry(entry);
      active.delete(id);
    }
    place();
  }

  /** Live wall placement ghost: stretch the zone loop clip from start → cursor. */
  function aimPreview(preview) {
    const view = getView();
    if (!preview?.square || !preview?.end || !view?.layer?.isConnected ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clearAim();
      return;
    }
    const zone = {
      id: '__wall-aim__',
      preview: true,
      name: preview.name,
      rule: preview.rule,
      square: preview.square,
      end: preview.end,
      cells: preview.cells ?? [],
    };
    const visual = zoneLoopVisual(zone) ?? resolveSpellAnimation(preview.name, preview.rule);
    if (!visual?.url || !spellVisualValid(visual)) { clearAim(); return; }
    const clipKey = visual.url;
    if (!aimEntry || aimEntry.clipKey !== clipKey) {
      disposeEntry(aimEntry);
      const video = makeVideo(visual, zoneSpellKey(zone));
      video.classList.add('wall-aim-preview');
      aimEntry = {video, zone, visual, battle: view.battle, clipKey};
    } else {
      aimEntry.zone = zone;
      aimEntry.visual = visual;
      aimEntry.battle = view.battle;
    }
    placeEntry(aimEntry, view);
  }

  return {
    sync,
    place,
    aimPreview,
    reset() { stopAll(); clearAim(); },
    get size() { return active.size; },
  };
}
