import {escape} from "./format.mjs";

const api = "/api/sessions";
const recentKey = "wayfarer-last-session-v1";
const sessionPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function sessionCode(input) {
  const value = String(input ?? "").trim().split(/(?:#|^)game\//).at(-1);
  return sessionPattern.test(value) ? value.toLowerCase() : "";
}

export const sessionHash = (id) => "#game/" + id;
export const inviteURL = (id) => new URL(sessionHash(id),location.href).href;
export const artworkURL = (id) => `${api}/${id}/artwork`;

export function recentSession(id) {
  try {
    if (id) localStorage.setItem(recentKey,id);
    return sessionCode(localStorage.getItem(recentKey));
  } catch {return "";}
}

async function request(path, init) {
  const response = await fetch(path,{...init,cache:"no-store",signal:AbortSignal.timeout(12000)});
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if ((!response.ok && response.status !== 409) || !data) {
    const error = new Error(data?.message ?? "The shared session could not be reached. Check the link and try again.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function createSession(map, state, artwork, tokens) {
  const payload = JSON.stringify({map,state});
  if (!artwork && !tokens.size) return request(api,{method:"POST",body:payload,headers:{"Content-Type":"application/json"}});
  const body = new FormData();
  body.set("session",payload);
  if (artwork) body.set("artwork",artwork);
  for (const [id,blob] of tokens) body.set("token-"+id,blob);
  return request(api,{method:"POST",body});
}

export const readSession = (id, after) => request(`${api}/${id}${after == null ? "" : "?after=" + after}`);

export function writeSession(id, revision, state) {
  return request(`${api}/${id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision,state})});
}

export const readChat = (id, after) => request(`${api}/${id}/chat${after == null ? "" : "?after=" + after}`);

export function sendChat(id, message) {
  return request(`${api}/${id}/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(message)});
}

export function joinPanel() {
  const recent = recentSession();
  return `<section class="play-panel session-join" aria-label="Multiplayer">
    <form id="session-join-form" class="session-inline">
      <label class="play-field">Join a shared session<input id="session-invite" placeholder="Paste an invite link or code" autocomplete="off" required></label>
      <button class="button outline small" type="submit">Join session</button>
      ${recent ? `<a class="button outline small" href="${sessionHash(recent)}">Resume last session</a>` : ""}
    </form>
    <p id="session-join-error" role="status"></p>
  </section>`;
}

export function tablePanel(table, characters, battle, message, needsSignIn) {
  if (!table) return `<h2>Multiplayer</h2><p>Invite up to three friends. Each player can claim a party member.</p>
    ${needsSignIn ? '<a class="game-button" href="/signin-with-chatgpt?return_to=%2F%23game" target="_top">Sign in to host</a>' :
      '<button type="button" class="game-button" data-play="host-session">Start shared session</button>'}<p role="status">${escape(message)}</p>`;
  const options = characters.filter((character) => !battle.actors.some(({id}) => id === "party:"+character.id));
  const full = battle.actors.filter(({side}) => side === "party").length >= 4;
  return `<h2>Shared session</h2>
    <p class="session-connection" role="status">${escape(message || (table.online ? "Connected" : "Reconnecting…"))}</p>
    <label class="play-field" for="session-link">Invite link</label>
    <div class="session-inline"><input id="session-link" type="url" readonly value="${escape(inviteURL(table.id))}">
      <button type="button" class="game-button" data-play="copy-session">Copy link</button></div>
    <p>Open this link to join without signing in. Use Claim on a party portrait to reserve a character for this browser.</p>
    ${full ? "<p>The party has four characters. Claim an available portrait to play.</p>" : `<form id="session-party-form" class="session-inline">
      ${options.length ? `<label class="play-field">Your character<select id="session-character">${options.map(({id,name}) =>
        `<option value="${escape(id)}">${escape(name)}</option>`).join("")}</select></label>
      <button class="game-button" type="submit"${battle.round ? " disabled" : ""}>Add to party</button>` : '<a href="#characters" class="game-link">Import a character</a>'}
    </form>
    ${options.length && battle.round ? "<p>Party members can join between encounters.</p>" : ""}`}`;
}
