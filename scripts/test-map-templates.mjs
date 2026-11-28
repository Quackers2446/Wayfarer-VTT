import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, readdir} from 'node:fs/promises';
import {sessionRequest} from '../worker/session.mjs';
import {newBattle} from '../dist/combat.mjs';
import {trainingMap} from '../dist/encounters.mjs';

const memoryStore = new Map();
globalThis.localStorage = {
  getItem: (key) => memoryStore.has(key) ? memoryStore.get(key) : null,
  setItem: (key, value) => memoryStore.set(key, String(value)),
  removeItem: (key) => memoryStore.delete(key),
};
globalThis.document = {
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
};

const {
  applyMapTemplate,
  captureTemplateFromBattle,
  emptyTemplate,
  normalizeTemplate,
} = await import('../dist/map-templates.mjs');
const {populateScene} = await import('../dist/scene-populate.mjs');
const {spawnMarkers} = await import('../dist/spawn-points.mjs');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
}
const DB = {
  prepare(sql) {
    let args = [];
    return {
      bind(...values) {
        args = values.map((v) => v instanceof ArrayBuffer ? new Uint8Array(v) : v);
        return this;
      },
      async first(key) {
        const row = db.prepare(sql).get(...args);
        return key ? row?.[key] ?? null : row ?? null;
      },
      async all() {
        return {results: db.prepare(sql).all(...args)};
      },
      async run() {
        return {meta: {changes: Number(db.prepare(sql).run(...args).changes)}};
      },
    };
  },
  async batch(items) {
    db.exec('BEGIN');
    try {
      const result = [];
      for (const item of items) result.push(await item.run());
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
};

const env = {
  DB,
  GOOGLE_CLIENT_ID: 'qa-web.apps.googleusercontent.com',
  CLOSED_BETA: '1',
  BETA_ADMIN_EMAILS: 'matthew.zhou@gmail.com',
};
const origin = 'https://wayfarer.test';
const cookies = new Map();

async function api(path, {method = 'GET', body, as = 'guest', headers: extra = {}, rawBody} = {}) {
  const jar = cookies.get(as) ?? new Map();
  const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const headers = {
    Origin: origin,
    ...(cookie ? {Cookie: cookie} : {}),
    ...(body && !rawBody ? {'Content-Type': 'application/json'} : {}),
    ...extra,
  };
  const response = await sessionRequest(new Request(origin + path, {
    method,
    headers,
    body: rawBody ?? (body ? JSON.stringify(body) : undefined),
  }), env);
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const at = pair.indexOf('=');
    if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1));
    else jar.delete(pair.slice(0, at));
  }
  cookies.set(as, jar);
  return response;
}

const keypair = await crypto.subtle.generateKey(
  {name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
  true,
  ['sign', 'verify'],
);
const jwk = await crypto.subtle.exportKey('jwk', keypair.publicKey);
jwk.alg = 'RS256';
jwk.use = 'sig';
jwk.kid = 'map-template-test';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('googleapis.com/oauth2/v3/certs')) {
    return new Response(JSON.stringify({keys: [jwk]}), {status: 200, headers: {'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600'}});
  }
  return originalFetch(input, init);
};

function b64url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function googleCredential(email, nonce) {
  const header = b64url(JSON.stringify({alg: 'RS256', kid: 'map-template-test'}));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, azp: env.GOOGLE_CLIENT_ID,
    exp: now + 3600, iat: now, nonce, sub: 'sub-' + email, email, email_verified: true, given_name: 'Tester',
  }));
  const data = new TextEncoder().encode(header + '.' + payload);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keypair.privateKey, data));
  return header + '.' + payload + '.' + b64url(signature);
}

async function signIn(as, email) {
  const nonceRes = await api('/api/auth/nonce', {method: 'POST', as});
  const {nonce} = await nonceRes.json();
  const credential = await googleCredential(email, nonce);
  return api('/api/auth/google', {method: 'POST', as, body: {credential}});
}

// --- normalize / apply helpers ---
const blank = emptyTemplate();
assert.equal(blank.version, 1);
assert.equal(normalizeTemplate({version: 99}), null);

const map = structuredClone(trainingMap);
const battle = newBattle();
battle.terrain = {};
battle.markers = [];
battle.features = [];
battle.actors = [];

const template = normalizeTemplate({
  version: 1,
  fog: {fogEnabled: true, fogSettings: {opacity: 0.8, blockMovement: true}},
  wallData: {manual: true, walls: [{x1: 1, y1: 1, x2: 4, y2: 1}], doors: []},
  spawns: [{name: 'Entry', x: 2, y: 2}],
  actors: [],
  features: [{
    kind: 'trap', name: 'Dart plate', regionId: 'entry',
    surfaceText: 'A raised tile.', truthText: 'Darts fire.',
    x: 3, y: 3,
  }],
  grid: {gridOverlay: 'tactical', gridSquareFt: 5},
  notes: 'Studio default',
});
assert.ok(template);
const applied = await applyMapTemplate(map, battle, template, {loadActors: true});
assert.equal(applied.applied, true);
assert.equal(battle.fogEnabled, true);
assert.equal(battle.wallData.walls.length, 1);
assert.equal(spawnMarkers(battle).length, 1);
assert.equal(battle.features.length, 1);
assert.equal(battle._fromTemplate.actors, true);
assert.equal(battle._fromTemplate.features, true);

const capture = captureTemplateFromBattle(battle, {notes: 'Studio default'});
assert.equal(capture.spawns.length, 1);
assert.equal(capture.features.length, 1);
assert.equal(capture.wallData.walls.length, 1);

// populateScene respects template actor/feature replacement (empty actors = no authored fill)
const popMap = {...structuredClone(trainingMap), module: 'StudioTest', key: 'studio-test'};
const fresh = newBattle();
fresh.terrain = {};
fresh.markers = [];
fresh.features = structuredClone(template.features);
fresh.actors = [];
fresh._fromTemplate = {actors: true, features: true, spawns: true, walls: true, fog: true, grid: true};
fresh.wallData = structuredClone(template.wallData);
fresh.fogEnabled = true;
await populateScene(popMap, fresh);
assert.equal(fresh.sceneReady, true);
assert.equal(fresh.actors.filter((a) => a.side !== 'party').length, 0);
assert.equal(fresh.features.length, 1);

// --- API: non-admin cannot PUT; admin can ---
await env.DB.prepare('INSERT INTO beta_allowlist(email,note,created_at,created_by) VALUES (?,?,?,?)')
  .bind('player@example.com', 'tester', Date.now(), 'system').run();

const playerSign = await signIn('player', 'player@example.com');
assert.equal(playerSign.status, 200);
const playerPut = await api('/api/account/map-templates/training/wayfarer-yard', {
  method: 'PUT', as: 'player',
  body: {template},
});
assert.equal(playerPut.status, 403);

const adminSign = await signIn('admin', 'matthew.zhou@gmail.com');
assert.equal(adminSign.status, 200);
const adminBody = await adminSign.json();
assert.equal(adminBody.betaAdmin, true);

const save = await api('/api/account/map-templates/training/wayfarer-yard', {
  method: 'PUT', as: 'admin',
  body: {template},
});
const saveText = await save.text();
assert.equal(save.status, 200, saveText);
const saved = JSON.parse(saveText);
assert.equal(saved.template.notes, 'Studio default');
assert.equal(saved.template.spawns[0].name, 'Entry');

const listed = await api('/api/account/map-templates', {as: 'player'});
assert.equal(listed.status, 200);
const listBody = await listed.json();
assert.ok(listBody.templates.some((row) => row.module === 'training' && row.mapKey === 'wayfarer-yard'));

const loaded = await api('/api/account/map-templates/training/wayfarer-yard', {as: 'player'});
assert.equal(loaded.status, 200);
const loadedBody = await loaded.json();
assert.equal(loadedBody.template.fog.fogEnabled, true);
assert.equal(loadedBody.template.wallData.walls.length, 1);

const missing = await api('/api/account/map-templates/training/no-such-map', {as: 'player'});
assert.equal(missing.status, 200);
assert.equal((await missing.json()).template, null);

globalThis.fetch = originalFetch;
console.log('Map templates helpers + admin API passed.');
