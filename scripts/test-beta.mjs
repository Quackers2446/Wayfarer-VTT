import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, readdir} from 'node:fs/promises';
import {sessionRequest} from '../worker/session.mjs';
import {newBattle} from '../dist/combat.mjs';
import {trainingMap, trainingActors} from '../dist/encounters.mjs';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) {
  db.exec(await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
}
const DB = {
  prepare(sql) {
    let args = [];
    return {
      bind(...values) {
        args = values.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v);
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

async function api(path, {method = 'GET', body, as = 'guest', originHeader = origin} = {}) {
  const jar = cookies.get(as) ?? new Map();
  const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const headers = {
    Origin: originHeader,
    ...(cookie ? {Cookie: cookie} : {}),
    ...(body ? {'Content-Type': 'application/json'} : {}),
  };
  const response = await sessionRequest(new Request(origin + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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
const publicKey = {...await crypto.subtle.exportKey('jwk', keypair.publicKey), kid: 'qa-key', alg: 'RS256', use: 'sig'};
globalThis.fetch = async url => {
  assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
  return Response.json({keys: [publicKey]}, {headers: {'Cache-Control': 'max-age=3600'}});
};
const b64 = bytes => Buffer.from(bytes).toString('base64url');

async function token(nonce, overrides = {}) {
  const header = b64(JSON.stringify({alg: 'RS256', kid: 'qa-key'}));
  const now = Math.floor(Date.now() / 1000);
  const body = b64(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    sub: 'google-alice',
    email: 'alice@example.com',
    email_verified: true,
    iat: now,
    exp: now + 3600,
    nonce,
    name: 'Alice Player',
    ...overrides,
  }));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keypair.privateKey,
    new TextEncoder().encode(header + '.' + body),
  );
  return header + '.' + body + '.' + b64(signature);
}

async function login(as, {sub, email, invite} = {}) {
  const nonce = await (await api('/api/auth/nonce', {method: 'POST', as})).json();
  return api('/api/auth/google', {
    method: 'POST',
    as,
    body: {
      credential: await token(nonce.nonce, {sub, email, name: email.split('@')[0]}),
      ...(invite ? {invite} : {}),
    },
  });
}

// Session advertises closed beta to guests.
const session = await (await api('/api/auth/session')).json();
assert.equal(session.closedBeta, true);
assert.equal(session.user, null);
assert.equal(session.betaAdmin, false);

// Guests cannot create rooms while closed beta is on.
const guestRoom = await api('/api/sessions', {
  method: 'POST',
  body: {controller: crypto.randomUUID(), map: trainingMap, state: {room: {name: 'Denied'}, battle: {...newBattle(), actors: trainingActors()}}},
});
assert.equal(guestRoom.status, 401);

// Unapproved Google account is refused without an invite.
const denied = await login('outsider', {sub: 'google-outsider', email: 'outsider@example.com'});
assert.equal(denied.status, 403);
assert.equal((await denied.json()).closedBeta, true);

// Admin email can always sign in.
const adminLogin = await login('admin', {sub: 'google-admin', email: 'matthew.zhou@gmail.com'});
assert.equal(adminLogin.status, 200);
const adminBody = await adminLogin.json();
assert.equal(adminBody.betaAdmin, true);

// Public access requests (no sign-in) can be submitted and approved by an admin.
const accessRequest = await api('/api/auth/beta-request', {
  method: 'POST',
  body: {email: 'hopeful@example.com', name: 'Hope', message: 'Want to playtest'},
});
assert.equal(accessRequest.status, 200);
const accessBody = await accessRequest.json();
assert.equal(accessBody.status, 'pending');
assert.ok(accessBody.id);

const listedRequests = await api('/api/account/beta/requests', {as: 'admin'});
assert.equal(listedRequests.status, 200);
const requestRows = (await listedRequests.json()).requests;
assert.ok(requestRows.some((row) => row.email === 'hopeful@example.com' && row.status === 'pending'));

const requestApproved = await api('/api/account/beta/requests', {
  method: 'POST',
  as: 'admin',
  body: {id: accessBody.id, action: 'approve'},
});
assert.equal(requestApproved.status, 200);
assert.equal((await requestApproved.json()).status, 'approved');

const hopefulLogin = await login('hopeful', {sub: 'google-hopeful', email: 'hopeful@example.com'});
assert.equal(hopefulLogin.status, 200);
assert.equal(adminBody.closedBeta, true);
assert.equal(adminBody.user.email, 'matthew.zhou@gmail.com');

const adminSession = await (await api('/api/auth/session', {as: 'admin'})).json();
assert.equal(adminSession.betaAdmin, true);
assert.equal(adminSession.closedBeta, true);

// Non-admin signed-in user cannot manage allowlist.
const friendDeniedLogin = await login('friend-pre', {sub: 'google-friend-pre', email: 'friend@example.com'});
assert.equal(friendDeniedLogin.status, 403);

// Admin can add an email to the allowlist.
assert.equal((await api('/api/account/beta/allowlist', {
  method: 'POST',
  as: 'admin',
  body: {email: 'approved@example.com', note: 'QA seat'},
})).status, 200);
const list = await (await api('/api/account/beta/allowlist', {as: 'admin'})).json();
assert(list.emails.some(row => row.email === 'approved@example.com'));
assert(list.admins.includes('matthew.zhou@gmail.com'));

const approved = await login('approved', {sub: 'google-approved', email: 'approved@example.com'});
assert.equal(approved.status, 200);
const approvedBody = await approved.json();
assert.equal(approvedBody.betaAdmin, false);

// Approved player can open a room.
const created = await api('/api/sessions', {
  method: 'POST',
  as: 'approved',
  body: {
    controller: approvedBody.user.id,
    map: trainingMap,
    state: {room: {name: 'Beta room'}, battle: {...newBattle(), actors: trainingActors()}},
  },
});
assert.equal(created.status, 201, await created.text());

// Admin creates a single-use invite; any Google email can redeem it.
const inviteCreate = await api('/api/account/beta/invites', {
  method: 'POST',
  as: 'admin',
  body: {label: 'Playtest', maxUses: 1, days: 7},
});
assert.equal(inviteCreate.status, 200);
const invite = await inviteCreate.json();
assert.match(invite.path, /^#invite\/[a-f0-9]{32,64}$/);
assert.ok(invite.token);

const peek = await (await api('/api/auth/invite/' + invite.token)).json();
assert.equal(peek.valid, true);
assert.equal(peek.label, 'Playtest');
assert.equal(peek.remaining, 1);

const redeemed = await login('invitee', {sub: 'google-invitee', email: 'any.google@gmail.com', invite: invite.token});
assert.equal(redeemed.status, 200);
const redeemedBody = await redeemed.json();
assert.equal(redeemedBody.inviteRedeemed, true);
assert.equal(redeemedBody.user.email, 'any.google@gmail.com');

const peekUsed = await (await api('/api/auth/invite/' + invite.token)).json();
assert.equal(peekUsed.valid, false);

const second = await login('invitee-two', {sub: 'google-invitee-two', email: 'second@gmail.com', invite: invite.token});
assert.equal(second.status, 403);

// Unlimited invite + revoke.
const openInvite = await (await api('/api/account/beta/invites', {
  method: 'POST',
  as: 'admin',
  body: {label: 'Open', maxUses: 0, days: 0},
})).json();
assert.equal((await (await api('/api/auth/invite/' + openInvite.token)).json()).valid, true);
const invites = await (await api('/api/account/beta/invites', {as: 'admin'})).json();
const openRow = invites.invites.find(row => row.label === 'Open');
assert.ok(openRow);
assert.equal((await api('/api/account/beta/invites', {
  method: 'DELETE',
  as: 'admin',
  body: {id: openRow.id},
})).status, 200);
assert.equal((await (await api('/api/auth/invite/' + openInvite.token)).json()).valid, false);

// Admin email cannot be removed from the allowlist endpoint.
assert.equal((await api('/api/account/beta/allowlist', {
  method: 'DELETE',
  as: 'admin',
  body: {email: 'matthew.zhou@gmail.com'},
})).status, 400);

assert.equal((await api('/api/account/beta/allowlist', {
  method: 'DELETE',
  as: 'admin',
  body: {email: 'approved@example.com'},
})).status, 200);

console.log('Closed beta gate, admin allowlist, invite create/redeem/revoke, and session approval verified.');
