// Guest player seat credential. Never put in shared state, invite URLs, or JS storage.
const playerCookieName = '__Host-wayfarer-player';
const playerCredPattern = /^[a-f0-9]{64}$/;
const playerCredHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function playerCredential(request) {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map((s) => s.trim()).filter((s) => s.startsWith(playerCookieName + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(playerCookieName.length + 1);
  return playerCredPattern.test(value) ? value : null;
}

export async function playerCredentialHash(request) {
  const credential = playerCredential(request);
  return credential ? hashPlayerCredential(credential) : null;
}

async function hashPlayerCredential(credential) {
  return playerCredHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential))));
}

export async function newPlayerCredential(request) {
  const credential = playerCredential(request) ?? playerCredHex(crypto.getRandomValues(new Uint8Array(32)));
  return {
    hash: await hashPlayerCredential(credential),
    cookie: `${playerCookieName}=${credential}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict`,
  };
}

export function matchesPlayerCredential(stored, presented) {
  if (!stored || !presented || !playerCredPattern.test(stored) || !playerCredPattern.test(presented)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= stored.charCodeAt(i) ^ presented.charCodeAt(i);
  return difference === 0;
}
