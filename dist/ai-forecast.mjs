import { cleanPoint, samePoint, segmentEnds } from './wall-geometry.mjs';

const STORAGE_KEY = 'wayfarer_gemini_api_key';
let inMemoryKey = '';

export function getApiKey() {
  if (inMemoryKey) return inMemoryKey;
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setApiKey(key, remember = true) {
  inMemoryKey = String(key || '').trim();
  try {
    if (remember && inMemoryKey) {
      globalThis.localStorage?.setItem(STORAGE_KEY, inMemoryKey);
    } else {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    }
  } catch { }
}

export function hasApiKey() {
  return Boolean(getApiKey());
}

export function clearApiKey() {
  inMemoryKey = '';
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch { }
}

export function isKeyRemembered() {
  try {
    return Boolean(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function maskApiKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '••••••••';
  return k.slice(0, 4) + '••••••••' + k.slice(-4);
}

/**
 * Downscale and compress a map image element/canvas to JPEG base64 for optimal vision token usage.
 * Preserves aspect ratio, fits within maxDim (default 1280px, ~2-4 vision tiles), quality ~0.82.
 */
export function renderScaledMap(source, maxDim = 1280, quality = 0.82) {
  const naturalWidth = source.naturalWidth || source.videoWidth || source.width || 0;
  const naturalHeight = source.naturalHeight || source.videoHeight || source.height || 0;
  if (!naturalWidth || !naturalHeight) {
    throw new Error('The map image has no valid dimensions.');
  }

  const scale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight));
  const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

  let canvas;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  } else if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(targetWidth, targetHeight);
  } else {
    throw new Error('Canvas rendering is not supported in this environment.');
  }

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

  if (canvas.toDataURL) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1];
    return {
      base64,
      mimeType: 'image/jpeg',
      targetWidth,
      targetHeight,
      originalWidth: naturalWidth,
      originalHeight: naturalHeight
    };
  }

  throw new Error('Canvas toDataURL is unavailable.');
}

/**
 * Call Gemini 3.8 Flash Vision directly from the browser using the user's API key.
 * Uses structured JSON output with a flat coordinate array schema to minimize tokens.
 */
export async function callGeminiVision({
  base64,
  mimeType = 'image/jpeg',
  apiKey,
  model = 'gemini-3.8-flash',
  fetchImpl = globalThis.fetch
} = {}) {
  const key = apiKey || getApiKey();
  if (!key) throw new Error('A Gemini API key is required to forecast map walls.');
  if (!base64) throw new Error('Map image data is required.');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const promptText = `You are an expert tabletop RPG cartographer and architectural battlemap analyzer.
Analyze the provided top-down battlemap image carefully.
Identify all structural walls (stone, masonry, wood, cave walls, and room borders) that block line of sight and passage.
Identify all doors, gates, portcullises, and archways with doors that can open and close.
Ignore interior furniture, tables, chairs, carpets, elevation contours, and grid lines. Focus strictly on opaque walls and doorways.
All coordinates must be integers in the range 0 to 1000 representing normalized coordinates on the full image rectangle, where (0,0) is top-left and (1000,1000) is bottom-right.
Output ONLY straight line segments as 4-tuples: [x1, y1, x2, y2].`;

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          walls: {
            type: 'ARRAY',
            description: 'Solid walls that block line of sight and passage. List of [x1, y1, x2, y2] in 0..1000 range.',
            items: {
              type: 'ARRAY',
              items: { type: 'INTEGER' }
            }
          },
          doors: {
            type: 'ARRAY',
            description: 'Doors, gates, or portcullises that can open and close. List of [x1, y1, x2, y2] in 0..1000 range.',
            items: {
              type: 'ARRAY',
              items: { type: 'INTEGER' }
            }
          }
        },
        required: ['walls', 'doors']
      }
    }
  };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (directErr) {
    // If direct browser fetch is blocked (by ad-blocker, Brave Shields, or CORS):
    // Fall back to same-origin relay
    try {
      response = await fetchImpl('/api/ai/forecast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-key': key,
          'x-gemini-model': model
        },
        body: JSON.stringify(payload)
      });
    } catch {
      throw new Error(
        'Connection to Gemini API failed. If you have an ad blocker (e.g. uBlock Origin or Brave Shields) active, please disable it for this page, or check your internet connection.'
      );
    }
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || response.statusText;
    } catch {
      errorDetail = response.statusText;
    }
    if (response.status === 400 && /api[ _]?key/i.test(errorDetail)) {
      throw new Error('Invalid Gemini API key. Please check your key in Google AI Studio.');
    }
    if (response.status === 403) {
      if (/blocked/i.test(errorDetail) || /permission/i.test(errorDetail)) {
        throw new Error(
          'Gemini API key is blocked (403): Generative Language API is not enabled for this key. In Google Cloud Console, allow "Generative Language API" in API restrictions, or create a free key in Google AI Studio (https://aistudio.google.com/app/apikey).'
        );
      }
      throw new Error(`Gemini API permission denied (403): ${errorDetail}`);
    }
    if (response.status === 404) {
      throw new Error(
        `Gemini model not found (404): ${errorDetail}. Please check that the model name is available on your account.`
      );
    }
    if (response.status === 429) {
      throw new Error('Gemini API quota or rate limit exceeded. Please wait a moment and try again.');
    }
    throw new Error(`Gemini API error (${response.status}): ${errorDetail}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty response. The map image may have been flagged or could not be processed.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Failed to parse Gemini vision response: ' + err.message);
  }

  return {
    walls: Array.isArray(parsed.walls) ? parsed.walls : [],
    doors: Array.isArray(parsed.doors) ? parsed.doors : []
  };
}

/**
 * Maps a single [x, y] in [0, 1000] space to Wayfarer grid cell units.
 */
export function normalizedToGrid(x, y, map) {
  const normX = Math.max(0, Math.min(1000, Number(x) || 0)) / 1000;
  const normY = Math.max(0, Math.min(1000, Number(y) || 0)) / 1000;

  const mapW = map.width || (map.cols * (map.size || 50));
  const mapH = map.height || (map.rows * (map.size || 50));
  const ox = map.offsetX || 0;
  const oy = map.offsetY || 0;
  const cw = map.cellWidth || map.size || 50;
  const ch = map.cellHeight || map.size || 50;

  const px = normX * mapW;
  const py = normY * mapH;

  const gx = (px - ox) / cw;
  const gy = (py - oy) / ch;

  return cleanPoint({
    x: Math.max(0, Math.min(map.cols, gx)),
    y: Math.max(0, Math.min(map.rows, gy))
  });
}

/**
 * Geometric post-processing: converts raw predictions into clean, connected
 * Wayfarer wall and door geometry.
 * - Filters degenerate noise segments.
 * - Welds near vertices (<= snapThreshold) to prevent pinhole fog leaks.
 * - Snaps near-axis walls to clean orthogonal lines.
 * - Merges colinear wall segments.
 * - Carves door gaps out of underlying walls.
 */
export function processForecastGeometry({
  rawWalls = [],
  rawDoors = [],
  map,
  snapThreshold = 0.35,
  minSegmentLength = 0.2
} = {}) {
  if (!map || !map.cols || !map.rows) {
    throw new Error('Valid map grid metadata is required.');
  }

  // 1. Transform raw [x1, y1, x2, y2] to grid coordinates
  const toSegment = ([x1, y1, x2, y2]) => {
    const p1 = normalizedToGrid(x1, y1, map);
    const p2 = normalizedToGrid(x2, y2, map);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  };

  let walls = rawWalls
    .filter(w => Array.isArray(w) && w.length >= 4)
    .map(toSegment)
    .filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minSegmentLength);

  let doors = rawDoors
    .filter(d => Array.isArray(d) && d.length >= 4)
    .map(toSegment)
    .filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minSegmentLength);

  // 2. Vertex Welding: cluster endpoints within snapThreshold
  const points = [];
  for (const s of [...walls, ...doors]) {
    points.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
  }

  const clusters = [];
  for (const p of points) {
    let cluster = clusters.find(c => Math.hypot(c.center.x - p.x, c.center.y - p.y) <= snapThreshold);
    if (!cluster) {
      cluster = { points: [p], center: { ...p } };
      clusters.push(cluster);
    } else {
      cluster.points.push(p);
      const sumX = cluster.points.reduce((s, pt) => s + pt.x, 0);
      const sumY = cluster.points.reduce((s, pt) => s + pt.y, 0);
      cluster.center = cleanPoint({
        x: sumX / cluster.points.length,
        y: sumY / cluster.points.length
      });
    }
  }

  // If a cluster is very close to an integer grid line (< 0.15), snap it to the grid line
  for (const c of clusters) {
    const rx = Math.round(c.center.x);
    const ry = Math.round(c.center.y);
    if (Math.abs(c.center.x - rx) < 0.15) c.center.x = rx;
    if (Math.abs(c.center.y - ry) < 0.15) c.center.y = ry;
    c.center = cleanPoint(c.center);
  }

  const snapPoint = p => {
    const cluster = clusters.find(c => Math.hypot(c.center.x - p.x, c.center.y - p.y) <= snapThreshold + 1e-4);
    return cluster ? cluster.center : cleanPoint(p);
  };

  const remap = s => {
    const p1 = snapPoint({ x: s.x1, y: s.y1 });
    const p2 = snapPoint({ x: s.x2, y: s.y2 });
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  };

  walls = walls.map(remap).filter(s => !samePoint({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }));
  doors = doors.map(remap).filter(s => !samePoint({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }));

  // 3. Orthogonal snapping for near-horizontal / near-vertical segments
  const straighten = s => {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return s;
    // If nearly vertical (< 4 degrees)
    if (dx / len < 0.07) {
      const avgX = cleanPoint({ x: (s.x1 + s.x2) / 2, y: 0 }).x;
      return { x1: avgX, y1: s.y1, x2: avgX, y2: s.y2 };
    }
    // If nearly horizontal (< 4 degrees)
    if (dy / len < 0.07) {
      const avgY = cleanPoint({ x: 0, y: (s.y1 + s.y2) / 2 }).y;
      return { x1: s.x1, y1: avgY, x2: s.x2, y2: avgY };
    }
    return s;
  };

  walls = walls.map(straighten);
  doors = doors.map(straighten);

  // 4. Colinear segment merging for walls
  // Sort endpoints of each segment so x1 <= x2 (and y1 <= y2 on vertical)
  const canonical = s => {
    if (s.x1 > s.x2 || (s.x1 === s.x2 && s.y1 > s.y2)) {
      return { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
    }
    return { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
  };

  walls = walls.map(canonical);

  // Merge segments sharing an endpoint and collinear
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i];
        const b = walls[j];
        // Check if a and b share an endpoint
        let common = null;
        let otherA = null;
        let otherB = null;

        if (samePoint({ x: a.x2, y: a.y2 }, { x: b.x1, y: b.y1 })) {
          common = { x: a.x2, y: a.y2 };
          otherA = { x: a.x1, y: a.y1 };
          otherB = { x: b.x2, y: b.y2 };
        } else if (samePoint({ x: a.x1, y: a.y1 }, { x: b.x2, y: b.y2 })) {
          common = { x: a.x1, y: a.y1 };
          otherA = { x: a.x2, y: a.y2 };
          otherB = { x: b.x1, y: b.y1 };
        } else if (samePoint({ x: a.x2, y: a.y2 }, { x: b.x2, y: b.y2 })) {
          common = { x: a.x2, y: a.y2 };
          otherA = { x: a.x1, y: a.y1 };
          otherB = { x: b.x1, y: b.y1 };
        } else if (samePoint({ x: a.x1, y: a.y1 }, { x: b.x1, y: b.y1 })) {
          common = { x: a.x1, y: a.y1 };
          otherA = { x: a.x2, y: a.y2 };
          otherB = { x: b.x2, y: b.y2 };
        }

        if (common && otherA && otherB) {
          const v1x = common.x - otherA.x;
          const v1y = common.y - otherA.y;
          const v2x = otherB.x - common.x;
          const v2y = otherB.y - common.y;
          const len1 = Math.hypot(v1x, v1y);
          const len2 = Math.hypot(v2x, v2y);
          if (len1 > 0.01 && len2 > 0.01) {
            const cross = Math.abs(v1x * v2y - v1y * v2x) / (len1 * len2);
            const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
            // If colinear and pointing in the same continuous direction
            if (cross < 0.05 && dot > 0.95) {
              walls[i] = canonical({
                x1: otherA.x,
                y1: otherA.y,
                x2: otherB.x,
                y2: otherB.y
              });
              walls.splice(j, 1);
              merged = true;
              break;
            }
          }
        }
      }
      if (merged) break;
    }
  }

  // 5. Door Carving: if a door lies on or near a wall segment, split or trim the wall
  const refinedWalls = [];
  for (const w of walls) {
    const overlappingDoor = doors.find(d => {
      // Check if door endpoints lie along wall segment w
      const wx = w.x2 - w.x1;
      const wy = w.y2 - w.y1;
      const wlen = Math.hypot(wx, wy);
      if (wlen < 0.1) return false;

      const dist = (px, py) => {
        const t = Math.max(0, Math.min(1, ((px - w.x1) * wx + (py - w.y1) * wy) / (wlen * wlen)));
        const projX = w.x1 + t * wx;
        const projY = w.y1 + t * wy;
        return { distance: Math.hypot(px - projX, py - projY), t };
      };

      const d1 = dist(d.x1, d.y1);
      const d2 = dist(d.x2, d.y2);
      const doorLength = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
      return d1.distance < 0.35 && d2.distance < 0.35 && doorLength >= 0.15;
    });

    if (!overlappingDoor) {
      refinedWalls.push(w);
    } else {
      // Split wall around door
      const wx = w.x2 - w.x1;
      const wy = w.y2 - w.y1;
      const wlen2 = wx * wx + wy * wy;
      const wlen = Math.sqrt(wlen2);
      const t1 = Math.max(0, Math.min(1, ((overlappingDoor.x1 - w.x1) * wx + (overlappingDoor.y1 - w.y1) * wy) / wlen2));
      const t2 = Math.max(0, Math.min(1, ((overlappingDoor.x2 - w.x1) * wx + (overlappingDoor.y2 - w.y1) * wy) / wlen2));
      const minT = Math.min(t1, t2);
      const maxT = Math.max(t1, t2);

      if (minT * wlen > 0.2) {
        const pt = cleanPoint({ x: w.x1 + minT * wx, y: w.y1 + minT * wy });
        refinedWalls.push(canonical({
          x1: w.x1,
          y1: w.y1,
          x2: pt.x,
          y2: pt.y
        }));
      }
      if ((1 - maxT) * wlen > 0.2) {
        const pt = cleanPoint({ x: w.x1 + maxT * wx, y: w.y1 + maxT * wy });
        refinedWalls.push(canonical({
          x1: pt.x,
          y1: pt.y,
          x2: w.x2,
          y2: w.y2
        }));
      }
    }
  }

  // 6. Deduplicate segments and attach standard door IDs
  const seenWalls = new Set();
  const finalWalls = [];
  for (const s of refinedWalls) {
    if (samePoint({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 })) continue;
    const key = `${s.x1},${s.y1}/${s.x2},${s.y2}`;
    if (seenWalls.has(key)) continue;
    seenWalls.add(key);
    finalWalls.push(s);
  }

  const seenDoors = new Set();
  const finalDoors = [];
  for (const d of doors) {
    if (samePoint({ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 })) continue;
    const key = `${d.x1},${d.y1}/${d.x2},${d.y2}`;
    if (seenDoors.has(key)) continue;
    seenDoors.add(key);
    finalDoors.push({
      id: globalThis.crypto?.randomUUID?.() || 'door-' + Math.random().toString(36).slice(2, 10),
      x1: d.x1,
      y1: d.y1,
      x2: d.x2,
      y2: d.y2,
      state: 'closed',
      label: 'Door'
    });
  }

  return {
    manual: true,
    walls: finalWalls,
    doors: finalDoors
  };
}
