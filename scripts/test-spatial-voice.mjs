import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, readdir} from 'node:fs/promises';
import {sessionRequest} from '../worker/session.mjs';
import {newBattle} from '../dist/combat.mjs';
import {trainingMap, trainingActors} from '../dist/encounters.mjs';
import {proximityGain} from '../dist/spatial-voice-math.mjs';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort()) {
  db.exec(await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
}
const DB = {
  prepare(sql) {
    let args = [];
    return {
      bind(...values) {args = values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this;},
      async first(key) {const row = db.prepare(sql).get(...args); return key ? row?.[key] ?? null : row ?? null;},
      async all() {return {results: db.prepare(sql).all(...args)};},
      async run() {return {meta: {changes: Number(db.prepare(sql).run(...args).changes)}};}
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
const env = {DB}, origin = 'https://wayfarer.test';
const jars = new Map();

async function api(as, path, {method = 'GET', body} = {}) {
  const jar = jars.get(as) ?? new Map();
  jars.set(as, jar);
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await sessionRequest(new Request(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? {Cookie: cookie} : {}),
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const [pair] = header.split(';');
    const at = pair.indexOf('=');
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  // Fallback for runtimes without getSetCookie
  const single = response.headers.get('Set-Cookie');
  if (single && !response.headers.getSetCookie) {
    const [pair] = single.split(';');
    const at = pair.indexOf('=');
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return response;
}

const alice = crypto.randomUUID(), bob = crypto.randomUUID(), mallory = crypto.randomUUID();
const state = {room: {name: 'Voice QA'}, battle: {...newBattle(), actors: trainingActors()}};
const party = state.battle.actors.find((actor) => actor.side === 'party');
state.battle.controllers = {[party.id]: alice};
const created = await (await api('alice', '/api/sessions', {method: 'POST', body: {controller: alice, map: trainingMap, state}})).json();
const room = '/api/sessions/' + created.id;

assert.equal((await api('alice', room + '/players', {method: 'POST', body: {controller: alice, username: 'Alice'}})).status, 200);
assert.equal((await api('bob', room + '/players', {method: 'POST', body: {controller: bob, username: 'Bob'}})).status, 200);
assert.ok(jars.get('alice').has('__Host-wayfarer-player'), 'guest seat cookie issued');
assert.equal((await api('mallory', room + '/players', {method: 'POST', body: {controller: alice, username: 'Hijack'}})).status, 403,
  'another browser cannot claim Alice’s seat');

assert.equal((await api('mallory', room + '/voice', {method: 'POST', body: {controller: alice, action: 'join'}})).status, 403,
  'forged controller cannot join voice');
assert.equal((await api('mallory', room + '/voice?controller=' + alice + '&after=0')).status, 403,
  'forged controller cannot read Alice’s inbox');

const joinAlice = await api('alice', room + '/voice', {method: 'POST', body: {controller: alice, action: 'join'}});
assert.equal(joinAlice.status, 200);
const aliceBody = await joinAlice.json();
assert.ok(Array.isArray(aliceBody.iceServers) && aliceBody.iceServers.length, 'join returns ICE servers');
assert.equal(aliceBody.turn, false, 'TURN absent without secrets falls back to STUN');

assert.equal((await api('bob', room + '/voice?controller=' + bob)).status, 200);
const joined = await (await api('bob', room + '/voice', {method: 'POST', body: {controller: bob, action: 'join'}})).json();
assert.equal(joined.members.length, 2);

assert.equal((await api('alice', room + '/voice', {
  method: 'POST',
  body: {controller: alice, action: 'signal', signal: {to: bob, kind: 'offer', signalId: crypto.randomUUID(), payload: {type: 'offer', sdp: 'v=0'}}},
})).status, 200);
const inbox = await (await api('bob', room + '/voice?controller=' + bob + '&after=0')).json();
assert.equal(inbox.signals.length, 1);
assert.equal(inbox.signals[0].kind, 'offer');
assert.equal(inbox.signals[0].from, alice);

assert.equal((await api('alice', room + '/voice', {method: 'POST', body: {controller: alice, action: 'state', muted: true, deafened: false}})).status, 200);
const muted = await (await api('bob', room + '/voice?controller=' + bob)).json();
assert.equal(muted.members.find((member) => member.id === alice).muted, true);

const ice = await (await api('alice', room + '/voice', {method: 'POST', body: {controller: alice, action: 'ice'}})).json();
assert.ok(ice.iceServers?.length);

assert.equal((await api('alice', room + '/voice', {
  method: 'POST',
  body: {controller: alice, action: 'signal', signal: {to: bob, kind: 'ice', signalId: crypto.randomUUID(), payload: null}},
})).status, 200, 'null ICE end-of-candidates is accepted');

assert.equal((await api('alice', room + '/voice', {method: 'POST', body: {controller: alice, action: 'leave'}})).status, 200);
const left = await (await api('bob', room + '/voice?controller=' + bob)).json();
assert.equal(left.members.length, 1);
assert.equal(left.members[0].id, bob);

// Mock Cloudflare TURN credential minting when secrets are present.
const realFetch = globalThis.fetch;
let turnFetches = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/credentials/generate-ice-servers')) {
    turnFetches += 1;
    return Response.json({
      iceServers: [{urls: 'turn:turn.example.invalid:3478?transport=udp', username: 'u', credential: 'c'}],
    }, {status: 201});
  }
  return realFetch(url, init);
};
env.TURN_KEY_ID = 'test-turn-key';
env.TURN_KEY_API_TOKEN = 'test-turn-token';
const withTurn = await (await api('bob', room + '/voice', {method: 'POST', body: {controller: bob, action: 'ice'}})).json();
assert.equal(withTurn.turn, true);
assert.ok(withTurn.iceServers.some((server) => String(server.urls).includes('turn:')));
assert.ok(withTurn.iceServers.some((server) => String(server.urls).includes('stun:')));
const cached = await (await api('bob', room + '/voice', {method: 'POST', body: {controller: bob, action: 'ice'}})).json();
assert.equal(cached.turn, true);
assert.equal(turnFetches, 1, 'TURN credentials are cached across joins in the same isolate');

// Usage cap kills TURN before the shared 1,000 GB free tier is exhausted.
env.TURN_USAGE_CAP_GB = '1';
env.CF_ACCOUNT_ID = 'acct-test';
env.CLOUDFLARE_API_TOKEN = 'analytics-token';
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/client/v4/graphql')) {
    return Response.json({
      data: {viewer: {accounts: [{callsTurnUsageAdaptiveGroups: [{sum: {egressBytes: 2 * 1024 ** 3}}]}]}},
    });
  }
  if (String(url).includes('/credentials/generate-ice-servers')) {
    turnFetches += 1;
    return Response.json({
      iceServers: [{urls: 'turn:turn.example.invalid:3478?transport=udp', username: 'u', credential: 'c'}],
    }, {status: 201});
  }
  return realFetch(url, init);
};
const capped = await (await api('bob', room + '/voice', {method: 'POST', body: {controller: bob, action: 'ice'}})).json();
assert.equal(capped.turn, false, 'TURN disables near the free-tier cap');
assert.equal(capped.turnReason, 'capped');
assert.ok(!capped.iceServers.some((server) => String(server.urls).includes('turn:')));

env.TURN_DISABLED = '1';
const disabled = await (await api('bob', room + '/voice', {method: 'POST', body: {controller: bob, action: 'ice'}})).json();
assert.equal(disabled.turnReason, 'disabled');

globalThis.fetch = realFetch;
delete env.TURN_KEY_ID;
delete env.TURN_KEY_API_TOKEN;
delete env.TURN_USAGE_CAP_GB;
delete env.CF_ACCOUNT_ID;
delete env.CLOUDFLARE_API_TOKEN;
delete env.TURN_DISABLED;

assert.equal(proximityGain(0), 1);
assert.equal(proximityGain(35), 1);
assert.ok(proximityGain(40) > 0 && proximityGain(40) < 1);
assert.equal(proximityGain(45), 0);
assert.equal(proximityGain(50), 0);

console.log('Spatial voice auth, ICE/TURN, signaling, and proximity math passed.');
