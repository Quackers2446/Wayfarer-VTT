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
const doorWallRight = processed.walls.find(w => Math.abs(w.x1 - 5.2) < 0.1 && w.x2 === 20);
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
  assert(url.includes('gemini-2.5-flash'));
  assert(url.includes('key=test-api-key'));
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

// 6. Blocked API service error test (403)
const mockBlockedFetch = async () => ({
  ok: false,
  status: 403,
  statusText: 'Forbidden',
  json: async () => ({
    error: { message: 'Requests to this API generativelanguage.googleapis.com method google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent are blocked.' }
  })
});

await assert.rejects(
  () => callGeminiVision({ base64: 'fakebase64', apiKey: 'blocked-key', fetchImpl: mockBlockedFetch }),
  /Gemini API key is blocked/
);
console.log('✓ 403 blocked API key error handling verified');

console.log('\nAll AI Forecast engine tests passed successfully!');
