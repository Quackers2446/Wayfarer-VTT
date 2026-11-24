import assert from 'node:assert/strict';
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  maskApiKey,
  hasApiKey,
  isKeyRemembered,
  normalizedToGrid,
  processForecastGeometry,
  callGeminiVision
} from '../dist/ai-forecast.mjs';

console.log('Testing AI Forecast Engine...');

// Mock localStorage
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: k => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: k => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

// 1. API Key storage tests
clearApiKey();
assert.equal(hasApiKey(), false);
assert.equal(getApiKey(), '');
assert.equal(maskApiKey(''), '');

setApiKey('AIzaSyAbc123456789Xyz', true);
assert.equal(hasApiKey(), true);
assert.equal(getApiKey(), 'AIzaSyAbc123456789Xyz');
assert.equal(isKeyRemembered(), true);
assert.equal(maskApiKey(getApiKey()), 'AIza••••••••9Xyz');

// Session-only (remember = false)
setApiKey('tempKey123', false);
assert.equal(getApiKey(), 'tempKey123');
assert.equal(isKeyRemembered(), false);

clearApiKey();
assert.equal(hasApiKey(), false);
assert.equal(isKeyRemembered(), false);
console.log('✓ API Key storage and masking verified');

// 2. Coordinate Transformation tests
const sampleMap = {
  cols: 20,
  rows: 15,
  width: 1000,
  height: 750,
  size: 50,
  cellWidth: 50,
  cellHeight: 50,
  offsetX: 0,
  offsetY: 0
};

// Top-left [0, 0] -> grid (0, 0)
const pTopLeft = normalizedToGrid(0, 0, sampleMap);
assert.deepEqual(pTopLeft, { x: 0, y: 0 });

// Bottom-right [1000, 1000] -> grid (20, 15)
const pBottomRight = normalizedToGrid(1000, 1000, sampleMap);
assert.deepEqual(pBottomRight, { x: 20, y: 15 });

// Center [500, 500] -> grid (10, 7.5)
const pCenter = normalizedToGrid(500, 500, sampleMap);
assert.deepEqual(pCenter, { x: 10, y: 7.5 });

// With map offset and non-square cells
const offsetMap = {
  cols: 10,
  rows: 10,
  width: 550,
  height: 550,
  cellWidth: 50,
  cellHeight: 50,
  offsetX: 25,
  offsetY: 25
};
// Pixel x for 500/1000 is 275. Grid x is (275 - 25) / 50 = 5
const pOffset = normalizedToGrid(500, 500, offsetMap);
assert.deepEqual(pOffset, { x: 5, y: 5 });
console.log('✓ Normalized coordinate transformations verified');

// 3. Geometric post-processing tests
// Test vertex welding and door carving:
const rawPrediction = {
  rawWalls: [
    [0, 500, 505, 502],     // Horizontal left: (0, 7.5) to (~10.1, ~7.53)
    [498, 499, 1000, 500],   // Horizontal right: (~9.96, ~7.48) to (20, 7.5)
    [501, 501, 500, 1000],   // Vertical stem: (~10.02, ~7.51) to (10, 15)
    [0, 0, 504, 5],          // Top wall: (0, 0) to (~10.08, ~0.08)
    [497, -3, 500, 500]      // Connecting vertical: (~9.94, ~-0.05) to (~10, 7.5)
  ],
  rawDoors: [
    [240, 500, 260, 500]    // Door: (~4.8, 7.5) to (~5.2, 7.5)
  ],
  map: sampleMap,
  snapThreshold: 0.35
};

const processed = processForecastGeometry(rawPrediction);

assert.equal(processed.manual, true);
assert(Array.isArray(processed.walls));
assert(Array.isArray(processed.doors));
assert.equal(processed.doors.length, 1);
assert.equal(processed.doors[0].state, 'closed');
assert.equal(processed.doors[0].label, 'Door');
assert(processed.doors[0].id.length > 0);

// Verify door carved a gap between 4.8 and 5.2
const doorWallLeft = processed.walls.find(w => w.x1 === 0 && Math.abs(w.x2 - 4.8) < 0.1);
const doorWallRight = processed.walls.find(w => Math.abs(w.x1 - 5.2) < 0.1 && w.x2 > 9.8);
assert(processed.walls.some(w=>Math.abs(w.x1-10)<.1&&w.x2===20),'Intersecting walls expose a shared T-junction vertex');
assert(doorWallLeft, 'Door should carve wall leaving left segment up to door');
assert(doorWallRight, 'Door should carve wall leaving right segment starting after door');

// Verify corner welding at (10, 0) between top wall and connecting vertical
const cornerPoints = processed.walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]);
const cornerMatches = cornerPoints.filter(p => Math.abs(p.x - 10) < 0.1 && Math.abs(p.y - 0) < 0.1);
assert(cornerMatches.length >= 2, 'Top-right corner at (10,0) should weld endpoints together');
console.log('✓ Vertex welding, straightening, and door carving verified');

// 4. Mocked Gemini Vision API Call test
const mockFetch = async (url, options) => {
  assert(url.includes('generativelanguage.googleapis.com'));
  assert(url.includes('gemini-3.8-flash'));
  assert(!url.includes('key='));assert.equal(options.headers['x-goog-api-key'],'test-api-key');
  const body = JSON.parse(options.body);
  assert.equal(body.contents[0].parts[1].inline_data.data, 'fakebase64');
  assert.equal(body.generationConfig.response_mime_type, 'application/json');

  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  walls: [
                    [100, 100, 900, 100],
                    [900, 100, 900, 900],
                    [900, 900, 100, 900],
                    [100, 900, 100, 100]
                  ],
                  doors: [
                    [480, 100, 520, 100]
                  ]
                })
              }
            ]
          }
        }
      ]
    })
  };
};

const visionResult = await callGeminiVision({
  base64: 'fakebase64',
  apiKey: 'test-api-key',
  fetchImpl: mockFetch
});

assert.equal(visionResult.walls.length, 4);
assert.equal(visionResult.doors.length, 1);
assert.deepEqual(visionResult.doors[0], [480, 100, 520, 100]);
console.log('✓ Gemini API request & structured response parsing verified');

// 5. Error handling test
const mockErrorFetch = async () => ({
  ok: false,
  status: 400,
  statusText: 'Bad Request',
  json: async () => ({
    error: { message: 'API_KEY_INVALID: API key not valid' }
  })
});

await assert.rejects(
  () => callGeminiVision({ base64: 'fakebase64', apiKey: 'bad-key', fetchImpl: mockErrorFetch }),
  /Invalid Gemini API key/
);
console.log('✓ Invalid API key error handling verified');

// 6. Proxy fallback test when direct fetch fails (TypeError: Failed to fetch)
let fallbackCalled = false;
const mockFallbackFetch = async (url, options) => {
  if (url.includes('generativelanguage.googleapis.com')) {
    throw new TypeError('Failed to fetch');
  }
  if (url === '/api/ai/forecast') {
    fallbackCalled = true;
    assert.equal(options.headers['x-gemini-key'], 'fallback-key');
    assert.equal(options.headers['x-gemini-model'], 'gemini-3.8-flash');
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({ walls: [[0, 0, 100, 100]], doors: [] })
            }]
          }
        }]
      })
    };
  }
  throw new Error('Unexpected URL: ' + url);
};

const fallbackResult = await callGeminiVision({
  base64: 'fakebase64',
  apiKey: 'fallback-key',
  fetchImpl: mockFallbackFetch
});
assert.equal(fallbackCalled, true);
assert.equal(fallbackResult.walls.length, 1);
console.log('✓ Automatic relay fallback on browser fetch block verified');

// 7. Blocked API key test (403)
const mock403Fetch = async () => ({
  ok: false,
  status: 403,
  statusText: 'Forbidden',
  json: async () => ({
    error: { message: 'Requests to this API are blocked.' }
  })
});

await assert.rejects(
  () => callGeminiVision({ base64: 'fakebase64', apiKey: 'blocked-key', fetchImpl: mock403Fetch }),
  /Gemini API key is blocked \(403\)/
);
console.log('✓ 403 blocked key guidance verified');

console.log('\nAll AI Forecast engine tests passed successfully!');

const success=()=>new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'private reasoning'},{text:JSON.stringify({walls:[[0,0,1000,0]],doors:[]})}]}}]}),{status:200});
const failure=(status,detail='Service temporarily overloaded',headers={})=>new Response(JSON.stringify({error:{message:detail}}),{status,headers:{'Content-Type':'application/json',...headers}});
{
 let calls=0;const delays=[],progress=[];
 const result=await callGeminiVision({base64:'map',apiKey:'test',random:()=>0,sleep:async ms=>delays.push(ms),onProgress:p=>progress.push(p),fetchImpl:async()=>++calls<3?failure(503):success()});
 assert.equal(calls,3);assert.deepEqual(delays,[1000,2000]);assert.equal(result.walls.length,1);assert(progress.some(p=>p.message.includes('busy')));
}
{
 const models=[],delays=[];
 await callGeminiVision({base64:'map',apiKey:'test',fallbackModel:'gemini-3.6-flash',random:()=>0,sleep:async ms=>delays.push(ms),fetchImpl:async url=>{models.push(url);return models.length<4?failure(503):success();}});
 assert.equal(models.length,4);assert(models[2].includes('3.8-flash'));assert(models[3].includes('3.6-flash'));assert.deepEqual(delays,[1000,2000,4000]);
}
{
 let calls=0;await assert.rejects(()=>callGeminiVision({base64:'map',apiKey:'test',sleep:async()=>{},fetchImpl:async()=>{calls++;return failure(503);}}),/still busy after 4 attempts/);assert.equal(calls,4);
}
{
 const delays=[];let calls=0;await callGeminiVision({base64:'map',apiKey:'test',sleep:async ms=>delays.push(ms),fetchImpl:async()=>++calls===1?failure(503,'Busy',{'Retry-After':'8'}):success()});assert.deepEqual(delays,[8000]);
 for(const [status,message] of [[400,'bad input'],[403,'Permission denied'],[404,'not found'],[429,'Daily quota exceeded']]){let calls=0;await assert.rejects(()=>callGeminiVision({base64:'map',apiKey:'test',sleep:async()=>assert.fail('Should not retry'),fetchImpl:async()=>{calls++;return failure(status,message);}}));assert.equal(calls,1);}
 let longCalls=0;await assert.rejects(()=>callGeminiVision({base64:'map',apiKey:'test',sleep:async()=>assert.fail('Do not shorten provider cooldown'),fetchImpl:async()=>{longCalls++;return failure(503,'Busy',{'Retry-After':'120'});}}));assert.equal(longCalls,1);
}
{
 const controller=new AbortController();let calls=0;
 await assert.rejects(()=>callGeminiVision({base64:'map',apiKey:'test',signal:controller.signal,sleep:async()=>controller.abort(),fetchImpl:async()=>{calls++;return failure(503);}}),{name:'AbortError'});assert.equal(calls,1);
 let relay=0;const urls=[];await callGeminiVision({base64:'map',apiKey:'test',sleep:async()=>{},fetchImpl:async url=>{urls.push(url);if(url.startsWith('https:'))throw new TypeError('Blocked');return ++relay<2?failure(503):success();}});assert.equal(relay,2);assert.equal(urls.length,4);
}
console.log('Bounded retries, overload fallback, Retry-After, quota/credential errors, cancellation, relay retries and thought filtering verified.');
