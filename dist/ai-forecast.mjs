import {cleanForecastGeometry} from './forecast-geometry.mjs';
import { cleanPoint } from './wall-geometry.mjs';

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
 * Call Gemini image understanding with bounded retries for temporary service errors.
 * Uses structured JSON output with a flat coordinate array schema to minimize tokens.
 */
export async function callGeminiVision({
  base64,
  mimeType = 'image/jpeg',
  apiKey,
  model = 'gemini-3.8-flash',
  fetchImpl = globalThis.fetch,
  fallbackModel,
  onProgress = () => {},
  signal,
  sleep = waitForRetry,
  random = Math.random,
  contextText = ''
} = {}) {
  const key = apiKey || getApiKey();
  if (!key) throw new Error('A Gemini API key is required to forecast map walls.');
  if (!base64) throw new Error('Map image data is required.');

  const promptText = `You are an expert tabletop RPG cartographer and architectural battlemap analyzer.
Analyze the provided top-down battlemap image carefully.
Trace only visibly drawn structural walls: stone, timber, masonry, cave boundaries. Follow each physical wall centerline with connected straight segments. At bends, add a vertex. Preserve BOTH walls of narrow corridors and every alcove, inset and partition; never replace a corridor with a line down its walkable center.
Do not infer wall lines from room numbers, labeled region outlines or approximate room rectangles. Never continue a wall through open floor. Open archways remain open.
Identify doors and gates from their drawn symbols. Trace each actual opening from jamb to jamb on the supporting wall. On this style of map a small white rectangle in a dark frame can indicate a door. Nearby door symbols may be separate doors; preserve any wall between them. Do not turn an entire corridor or an open archway into a door. Leave the wall absent across each doorway.
Ignore interior furniture, tables, chairs, carpets, elevation contours, and grid lines. Focus strictly on opaque walls and doorways.
All coordinates must be integers in the range 0 to 1000 representing normalized coordinates on the full image rectangle, where (0,0) is top-left and (1000,1000) is bottom-right.
Do not snap coordinates to the printed grid or invent regular spacing. Ignore text, title, legend, image margins and furniture. Never trace the crop rectangle itself as a wall.
Output ONLY straight line segments as 4-tuples: [x1, y1, x2, y2].
${contextText}`;

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

  const request = async activeModel => {
    const options = {method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key}, body:JSON.stringify(payload), signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000)};
    // Relay only transport failures. An HTTP 503 is still Gemini overload through the relay.
    try {
      return await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent`,options);
    } catch (error) {
      if(signal?.aborted || error.name==='AbortError' || error.name==='TimeoutError')throw error;
      try {
        return await fetchImpl('/api/ai/forecast',{...options,headers:{'Content-Type':'application/json','x-gemini-key':key,'x-gemini-model':activeModel}});
      } catch (error) {
        if(signal?.aborted || error.name==='AbortError' || error.name==='TimeoutError')throw error;
        throw new Error('Could not reach Gemini directly or through the Wayfarer relay. Check your connection and try again.');
      }
    }
  };
  let response, activeModel=model;
  for(let attempt=0;attempt<4;attempt++){
    signal?.throwIfAborted();
    onProgress({model:activeModel,attempt:attempt+1,message:`Analyzing walls and doors with ${activeModel} · attempt ${attempt+1}/4…`});
    try { response=await request(activeModel); }
    catch(error){
      if(error.name==='TimeoutError')throw new Error('Gemini took too long to respond. Try another model or scan again shortly.');
      throw error;
    }
    if(response.ok)break;
    let detail='',errorJson;
    try {errorJson=await response.json();detail=errorJson?.error?.message||response.statusText||'';}catch{detail=response.statusText||'';}
    const status=response.status;
    const retryAfter=response.headers?.get?.('Retry-After');
    const retryInfo=errorJson?.error?.details?.find(item=>item['@type']?.endsWith('RetryInfo'))?.retryDelay;
    const cooldown=retryAfter ? (/^\d+(?:\.\d+)?$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now()) : retryInfo&&/^\d+(?:\.\d+)?s$/.test(retryInfo)?parseFloat(retryInfo)*1000:0;
    const transient=[408,500,502,503,504].includes(status)||status===429&&!/limit:\s*0|quota.*(?:exhausted|exceeded)|daily|per.day/i.test(detail);
    // Never retry credentials, malformed requests, exhausted quotas, or long provider cooldowns.
    if(transient&&attempt<3&&!(cooldown>30000)){
      const switching=attempt===2&&fallbackModel&&fallbackModel!==activeModel&&status!==429;
      const delay=Math.max(cooldown||0,1000*2**attempt+Math.floor(random()*500));
      if(switching)activeModel=fallbackModel;
      onProgress({model:activeModel,attempt:attempt+2,delay,message:`${status===429?'Gemini is rate limited':'Gemini is busy'} · ${switching?'trying '+activeModel:'retrying'} in ${Math.ceil(delay/1000)}s (${attempt+2}/4)…`});
      await sleep(delay,signal);
      continue;
    }
    if(status===400&&/api[ _]?key/i.test(detail))throw new Error('Invalid Gemini API key. Please check your key in Google AI Studio.');
    if(status===403)throw new Error(/blocked|permission/i.test(detail)?'Gemini API key is blocked (403). Check that Generative Language API is allowed for this key in Google Cloud, or create a key in Google AI Studio.':`Gemini API permission denied (403): ${detail}`);
    if(status===404)throw new Error(`Gemini model not found (404): ${activeModel}. Choose another model available to your account.`);
    if(status===429)throw new Error('Gemini API quota or rate limit exceeded. Check your Google AI Studio limits and try again after the cooldown.');
    if([500,502,503,504].includes(status))throw new Error(`Gemini is still busy after ${attempt+1} attempts (${status}). Your existing walls are unchanged. Try another model in AI Forecast or try again later.`);
    throw new Error(`Gemini API error (${status}): ${detail}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join('');
  if (!text) {
    throw new Error('Gemini returned an empty response. The map image may have been flagged or could not be processed.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Failed to parse Gemini vision response: ' + err.message);
  }

  if(!parsed||!Array.isArray(parsed.walls)||!Array.isArray(parsed.doors))throw new Error('Gemini returned invalid wall geometry. Your existing walls are unchanged.');
  return {walls:parsed.walls,doors:parsed.doors};
}

function waitForRetry(ms,signal){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();
  const abort=()=>{clearTimeout(timer);reject(signal.reason??new DOMException('Forecast cancelled','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
 });
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

export const processForecastGeometry=cleanForecastGeometry;
