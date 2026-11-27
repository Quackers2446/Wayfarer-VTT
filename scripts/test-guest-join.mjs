import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, readdir} from 'node:fs/promises';
import {sessionRequest} from '../worker/session.mjs';
import {newBattle} from '../dist/combat.mjs';
import {trainingMap, trainingActors} from '../dist/encounters.mjs';

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
  const single = response.headers.get('Set-Cookie');
  if (single && !response.headers.getSetCookie) {
    const [pair] = single.split(';');
    const at = pair.indexOf('=');
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return response;
}

const guest = crypto.randomUUID();
const state = {room: {name: 'Guest join QA'}, battle: {...newBattle(), actors: trainingActors()}};
const created = await (await api('guest', '/api/sessions', {method: 'POST', body: {controller: guest, map: trainingMap, state}})).json();
const room = '/api/sessions/' + created.id;

// Anonymous probe must not reserve a seat or leave the browser cookieless.
const probe = await api('guest', room + '/players', {method: 'POST', body: {controller: guest}});
assert.equal(probe.status, 200);
const probeBody = await probe.json();
assert.equal(probeBody.player, null);
assert.equal(jars.get('guest')?.has('__Host-wayfarer-player'), false, 'probe does not issue a seat cookie');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_player_auth WHERE session_id=?').get(created.id).n, 0,
  'probe does not reserve auth');

// Choosing a username issues the cookie and claims the seat.
const named = await api('guest', room + '/players', {method: 'POST', body: {controller: guest, username: 'Guest'}});
assert.equal(named.status, 200);
assert.ok(jars.get('guest').has('__Host-wayfarer-player'), 'username join issues seat cookie');
assert.equal((await named.json()).player, 'Guest');

// Orphan auth from the old probe bug can be reclaimed when no username exists yet.
const orphan = crypto.randomUUID();
db.prepare('INSERT INTO session_player_auth (session_id,controller,credential_hash) VALUES (?,?,?)')
  .run(created.id, orphan, 'a'.repeat(64));
const reclaim = await api('orphan', room + '/players', {method: 'POST', body: {controller: orphan, username: 'Orphan'}});
assert.equal(reclaim.status, 200, 'orphan auth without a seated username is reclaimable');
assert.ok(jars.get('orphan').has('__Host-wayfarer-player'));
assert.equal((await reclaim.json()).player, 'Orphan');

console.log('Guest join probe, cookie issue, and orphan reclaim passed.');
