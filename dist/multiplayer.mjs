import {profilePortrait} from "./profile-photo.mjs";
import {spawnMarkers} from "./spawn-points.mjs";
import {escape} from "./format.mjs";
import {DEFAULT_PARTY_ID, MAX_PARTY_SIZE, actorPartyId, ensureParties, partyFull, partyLabel, partyMembers} from "./parties.mjs";

const api = "/api/sessions";
const recentKey = "wayfarer-last-session-v1";
const hubKey = "wayfarer-hub-session-v1";
const usernameKey = "wayfarer-username-v1";
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

/** Last Yawning Portal hub session for this browser (separate from campaign rooms). */
export function rememberedHubSession(id) {
  try {
    if (id) localStorage.setItem(hubKey, id);
    return sessionCode(localStorage.getItem(hubKey));
  } catch { return ""; }
}

export function rememberedUsername(username) {
  try {
    if (username) localStorage.setItem(usernameKey,username);
    return localStorage.getItem(usernameKey) ?? "";
  } catch {return "";}
}

async function request(path, init, acceptConflict = false) {
  const response = await fetch(path,{...init,cache:"no-store",signal:AbortSignal.timeout(12000)});
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if ((!response.ok && !(acceptConflict && response.status === 409)) || !data) {
    const error = new Error(data?.message ?? "The shared session could not be reached. Check the link and try again.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function createSession(map, state, artwork, tokens, controller) {
  const payload = JSON.stringify({map,state,controller});
  if (!artwork && !tokens.size) return request(api,{method:"POST",body:payload,headers:{"Content-Type":"application/json"}});
  const body = new FormData();
  body.set("session",payload);
  if (artwork) body.set("artwork",artwork);
  for (const [id,blob] of tokens) body.set("token-"+id,blob);
  return request(api,{method:"POST",body});
}

export const listRooms = controller => request("/api/rooms?controller="+encodeURIComponent(controller));

export const deleteRoom=(id,revision)=>request(`${api}/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})});

export const readSession = (id, after) => request(`${api}/${id}${after == null ? "" : "?after=" + after}`);

export function writeSession(id, revision, state) {
  return request(`${api}/${id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision,state})},true);
}

export function syncSessionPlayers(id, controller, username) {
  return request(`${api}/${id}/players`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({controller,username})});
}

export const readChat = (id, after) => request(`${api}/${id}/chat${after == null ? "" : "?after=" + after}`);

export function sendChat(id, message) {
  return request(`${api}/${id}/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(message)});
}

export function readVoice(id, controller, after) {
  const query = new URLSearchParams({controller});
  if (after != null) query.set("after", String(after));
  return request(`${api}/${id}/voice?${query}`);
}

export function postVoice(id, body) {
  return request(`${api}/${id}/voice`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
}

export function joinPanel() {
  const recent = recentSession();
  return `<section class="play-panel session-join" aria-label="Multiplayer">
    <form id="session-join-form" class="session-inline">
      <label class="play-field">Join a room<input id="session-invite" placeholder="Paste an invite link or code" autocomplete="off" required></label>
      <button class="button outline small" type="submit">Join room</button>
      ${recent ? `<a class="button outline small" href="${sessionHash(recent)}">Resume last room</a>` : ""}
    </form>
    <p id="session-join-error" role="status"></p>
  </section>`;
}

function sessionPlayers(players, battle, controller, voiceMembers = []) {
  const claims = new Map();
  for (const actor of battle.actors.filter((entry) => entry.side === "party" && battle.controllers?.[entry.id])) {
    const owner = battle.controllers[actor.id];
    const list = claims.get(owner) ?? [];
    list.push(actor.name);
    claims.set(owner, list);
  }
  const voice = new Map(voiceMembers.map((member) => [member.id, member]));
  const online = players.filter((player) => player.online).length;
  const inVoice = voiceMembers.filter((member) => member.online);
  const claimLabel = (id) => {
    const names = claims.get(id);
    if (!names?.length) return "No character claimed";
    return names.join(", ");
  };
  return `<section class="session-players" aria-label="Players">
    <h3>Players <span>${online} online</span></h3>
    ${inVoice.length ? `<div class="session-voice-now" aria-label="In voice"><strong>In voice</strong><ul>${inVoice.map((member) => {
      const player = players.find((entry) => entry.id === member.id) || member;
      const names = claims.get(member.id);
      const flags = member.deafened ? "Deafened" : member.muted ? "Muted" : "Listening";
      return `<li>${profilePortrait(player, "room-profile-avatar")}<span><strong>${escape(names?.[0] || player.username || member.username || "Player")}</strong><small>${escape(flags)}</small></span></li>`;
    }).join("")}</ul></div>` : ""}
    <ul>${players.map((player) => {
      const channel = voice.get(player.id);
      const voiceLabel = channel
        ? (channel.deafened ? "Deafened" : channel.muted ? "Muted" : "In voice")
        : "";
      return `<li>
      <div class="session-player-name">${!claims.has(player.id)?profilePortrait(player,"room-profile-avatar"):""}<span><strong>${escape(player.username)}${player.id === controller ? " (you)" : ""}</strong>
        <small>${escape(claimLabel(player.id))}${voiceLabel ? " · " + voiceLabel : ""}</small></span></div>
      <span class="session-presence${player.online ? " online" : ""}${channel ? " in-voice" : ""}">${player.online ? "Online" : "Away"}</span>
    </li>`;
    }).join("")}</ul>
  </section>`;
}

export function tablePanel(table, characters, battle, message, needsSignIn, controller) {
  if (!table) return `<h2>Multiplayer</h2><p>Invite friends into the same dungeon. Claim a party member, or open Party to start a rival group on the shared map.</p>
    <button type="button" class="game-button" data-play="host-session">Start shared session</button><p role="status">${escape(message)}</p>`;
  ensureParties(battle);
  const options = characters.filter((character) => !battle.actors.some(({id}) => id === "party:"+character.id));
  const openParty = battle.parties.find(party => !partyFull(battle, party.id)) ?? battle.parties[0];
  const allFull = battle.parties.every(party => partyFull(battle, party.id));
  const partyOptions = battle.parties.map(party =>
    `<option value="${escape(party.id)}" ${party.id === (openParty?.id || DEFAULT_PARTY_ID) ? "selected" : ""}>${escape(party.name)} · ${partyMembers(battle, party.id).length}/${MAX_PARTY_SIZE}</option>`).join("");
  return `<h2>${escape(table.state?.room?.name || "Adventure room")}</h2>
    <p class="session-connection" role="status">${escape(message || (table.online ? "Connected" : "Reconnecting…"))}</p>
    <label class="play-field" for="session-link">Invite link</label>
    <div class="session-inline"><input id="session-link" type="url" readonly value="${escape(inviteURL(table.id))}">
      <button type="button" class="game-button" data-play="copy-session">Copy link</button></div>
    <p class="session-voice-hint">Proximity voice uses each claimed token’s position on the map. Join from the top bar when you are ready to talk.</p>
    ${sessionPlayers(table.players,battle,controller,table.voice?.members ?? [])}
    <p>Progress saves automatically. Share the invite link and use Claim on a party portrait to choose a character.</p>
    <div class="session-parties">${battle.parties.map(party =>
      `<p><strong>${escape(party.name)}</strong> · ${partyMembers(battle, party.id).map(actor => escape(actor.name)).join(", ") || "empty"}</p>`).join("")}</div>
    ${allFull ? "<p>Every party is full (four characters each). Claim an available portrait to play.</p>" : `<form id="session-party-form" class="session-inline">
      ${options.length ? `<label class="play-field">Your character<select id="session-character">${options.map(({id,name}) =>
        `<option value="${escape(id)}">${escape(name)}</option>`).join("")}</select></label>
      <label class="play-field">Party<select id="session-party">${partyOptions}</select></label>
      ${spawnMarkers(battle).length ? `<label class="play-field">Spawn point<select id="session-spawn"><option value="">Default entrance</option>${spawnMarkers(battle).map((marker) =>
        `<option value="${escape(marker.id)}">${escape(marker.name)}</option>`).join("")}</select></label>` : ""}
      <button class="game-button" type="submit">Add to party</button>` : '<a href="#characters" class="game-link">Import a character</a>'}
    </form>
    ${options.length && battle.round ? "<p>New characters roll initiative and join this encounter.</p>" : ""}`}`;
}
