import {escape} from "./format.mjs";
import {icon} from "./icons.mjs";
import {profilePortrait} from "./profile-photo.mjs";
import {readVoice, postVoice} from "./multiplayer.mjs";
import {MAX_RANGE_FT, FEET_PER_SQUARE, feetBetween, proximityGain} from "./spatial-voice-math.mjs";

const FALLBACK_ICE = [
  {urls: "stun:stun.cloudflare.com:3478"},
  {urls: "stun:stun.l.google.com:19302"},
  {urls: "stun:stun1.l.google.com:19302"},
];
const ONLINE_MS = 12000;
const POLL_MS = 900;
const HIDDEN_POLL_MS = 4000;
const ICE_REFRESH_MS = 50 * 60 * 1000;
const GAIN_TIME_CONSTANT = 0.08;
const SPEAK_THRESHOLD = 0.018;
const SPEAK_HOLD_MS = 450;
const LINK_RETRY_MS = 4500;
const LINK_RETRY_COOLDOWN_MS = 5000;

function gridPos(actor, motion) {
  if (!actor || actor.x == null || actor.y == null) return null;
  const animated = motion?.get?.(actor.id);
  return animated && Number.isFinite(animated.x) && Number.isFinite(animated.y)
    ? {x: animated.x, y: animated.y}
    : {x: actor.x, y: actor.y};
}

function claimedActors(battle, controllerId) {
  if (!battle?.controllers || !controllerId) return [];
  return battle.actors.filter((actor) =>
    actor.side === "party" &&
    battle.controllers[actor.id] === controllerId &&
    actor.x != null &&
    actor.y != null
  );
}

function actorForController(battle, controllerId, preferredId = "") {
  const owned = claimedActors(battle, controllerId);
  if (!owned.length) return null;
  return owned.find((actor) => actor.id === preferredId) ?? owned[0];
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function rmsLevel(analyser, data) {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

export function createSpatialVoice(sessionId, controller) {
  const root = document.createElement("div");
  root.className = "game-voice";
  root.setAttribute("aria-label", "Spatial voice");

  const channel = document.createElement("div");
  channel.className = "game-voice-channel";
  channel.setAttribute("aria-label", "Voice channel");

  const speakingHud = document.createElement("div");
  speakingHud.className = "voice-speaking-hud";
  speakingHud.setAttribute("aria-live", "polite");
  speakingHud.setAttribute("aria-label", "Who is speaking");

  const voicePosKey = "wayfarer-voice-widget-pos-v1";
  const voiceHideKey = "wayfarer-voice-widget-hidden-v1";
  let drag = null;
  let channelHidden = (() => {
    try {return localStorage.getItem(voiceHideKey) === "1";} catch {return false;}
  })();

  function setChannelHidden(hidden) {
    channelHidden = !!hidden;
    try {localStorage.setItem(voiceHideKey, channelHidden ? "1" : "0");} catch {}
    channel.hidden = channelHidden;
  }

  function readSavedPos() {
    try {
      const raw = JSON.parse(localStorage.getItem(voicePosKey) || "null");
      if (raw && Number.isFinite(raw.left) && Number.isFinite(raw.top)) return raw;
    } catch {}
    return null;
  }

  function applyChannelPos(pos = readSavedPos()) {
    if (drag) return;
    if (!pos) {
      channel.style.left = "";
      channel.style.top = "";
      channel.style.right = "10px";
      channel.removeAttribute("data-dragged");
      return;
    }
    channel.dataset.dragged = "1";
    channel.style.right = "auto";
    channel.style.left = `${pos.left}px`;
    channel.style.top = `${pos.top}px`;
  }

  function clampChannelPos(left, top) {
    const slot = channel.parentElement;
    if (!slot) return {left, top};
    const maxLeft = Math.max(0, slot.clientWidth - channel.offsetWidth);
    const maxTop = Math.max(0, slot.clientHeight - channel.offsetHeight);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }

  function bindChannelDrag() {
    const head = channel.querySelector(".voice-channel-head");
    if (!head || head.dataset.dragBound) return;
    head.dataset.dragBound = "1";
    head.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      if (event.target.closest("button, a, input, select, textarea, [data-voice]")) return;
      const slot = channel.parentElement;
      if (!slot) return;
      const rect = channel.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        slotLeft: slotRect.left,
        slotTop: slotRect.top,
      };
      channel.classList.add("is-dragging");
      channel.dataset.dragged = "1";
      channel.style.right = "auto";
      channel.style.left = `${rect.left - slotRect.left}px`;
      channel.style.top = `${rect.top - slotRect.top}px`;
      try {head.setPointerCapture(event.pointerId);} catch {}
      event.preventDefault();
    });
    const move = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const next = clampChannelPos(
        event.clientX - drag.slotLeft - drag.offsetX,
        event.clientY - drag.slotTop - drag.offsetY,
      );
      channel.style.left = `${next.left}px`;
      channel.style.top = `${next.top}px`;
    };
    const end = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const next = clampChannelPos(
        event.clientX - drag.slotLeft - drag.offsetX,
        event.clientY - drag.slotTop - drag.offsetY,
      );
      channel.style.left = `${next.left}px`;
      channel.style.top = `${next.top}px`;
      try {localStorage.setItem(voicePosKey, JSON.stringify(next));} catch {}
      channel.classList.remove("is-dragging");
      drag = null;
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }

  const peers = new Map();
  const speakingUntil = new Map();
  let joined = false;
  let muted = false;
  let deafened = false;
  let members = [];
  let status = "";
  let turnReady = null;
  let turnReason = "";
  let cursor = 0;
  let timer;
  let pollBusy = false;
  let stopped = false;
  let joinEpoch = 0;
  let joining = false;
  let localStream;
  let localMeter;
  let audioCtx;
  let masterGain;
  let iceServers = FALLBACK_ICE;
  let iceFetchedAt = 0;
  let battleRef = null;
  let motionRef = null;
  let playersRef = [];
  let selectedId = "";
  let spatialRaf;
  let speakKey = "";

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      masterGain = audioCtx.createGain();
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  }

  function makeMeter(stream) {
    ensureAudio();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    return {source, analyser, data: new Uint8Array(analyser.frequencyBinCount)};
  }

  function disposeMeter(meter) {
    try {meter?.source?.disconnect();} catch {}
  }

  function applyDeafGain() {
    if (masterGain) masterGain.gain.value = deafened ? 0 : 1;
  }

  function applyMuteTracks() {
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = joined && !muted && !deafened;
  }

  function playerOf(id) {
    return playersRef.find((player) => player.id === id)
      ?? members.find((member) => member.id === id)
      ?? {id, username: "Player"};
  }

  function identityFor(id) {
    const player = playerOf(id);
    const preferred = id === controller ? selectedId : "";
    const actor = actorForController(battleRef, id, preferred);
    if (actor) {
      return {
        id,
        label: actor.name,
        kind: "character",
        tokenImage: actor.tokenImage || "",
        initials: (actor.marker || actor.name || "?").toString().charAt(0).toUpperCase(),
      };
    }
    return {
      id,
      label: player.username || "Player",
      kind: "profile",
      photo: player.photo || "",
      initials: (player.username || "?").trim().charAt(0).toUpperCase(),
    };
  }

  function avatarMarkup(identity, className = "voice-avatar") {
    if (identity.kind === "character" && identity.tokenImage && sessionId) {
      return `<span class="${className}" aria-hidden="true"><img src="/api/sessions/${sessionId}/tokens/${identity.tokenImage}" alt="" decoding="async"></span>`;
    }
    if (identity.kind === "profile" && identity.photo) {
      return profilePortrait({id: identity.id, photo: identity.photo, username: identity.label}, className);
    }
    return `<span class="${className}" aria-hidden="true">${escape(identity.initials || "?")}</span>`;
  }

  function stateBadges(member) {
    const bits = [];
    if (member.deafened) bits.push(`<span class="voice-badge" title="Deafened">${icon("deafOff", 12)}</span>`);
    else if (member.muted) bits.push(`<span class="voice-badge" title="Muted">${icon("micOff", 12)}</span>`);
    return bits.join("");
  }

  function isSpeaking(id) {
    return (speakingUntil.get(id) ?? 0) > Date.now();
  }

  function noteSpeaking(id, active) {
    if (active) speakingUntil.set(id, Date.now() + SPEAK_HOLD_MS);
  }

  function sampleSpeaking() {
    const now = Date.now();
    if (joined && localMeter && localStream && !muted && !deafened) {
      noteSpeaking(controller, rmsLevel(localMeter.analyser, localMeter.data) >= SPEAK_THRESHOLD);
    } else {
      speakingUntil.delete(controller);
    }
    for (const [id, peer] of peers) {
      if (!peer.meter) continue;
      const member = members.find((entry) => entry.id === id);
      if (member?.muted || member?.deafened) {
        speakingUntil.delete(id);
        continue;
      }
      noteSpeaking(id, rmsLevel(peer.meter.analyser, peer.meter.data) >= SPEAK_THRESHOLD);
    }
    for (const [id, until] of [...speakingUntil]) {
      if (until <= now) speakingUntil.delete(id);
    }
  }

  function speakingList() {
    return [...speakingUntil.keys()]
      .filter((id) => isSpeaking(id) && (id === controller ? joined : members.some((member) => member.id === id && member.online)))
      .sort((a, b) => (a === controller ? 0 : 1) - (b === controller ? 0 : 1) || a.localeCompare(b));
  }

  function paintSpeaking() {
    const active = speakingList();
    const key = active.join("|") + ":" + members.map((m) => `${m.id}:${m.muted}:${m.deafened}`).join(",");
    for (const node of document.querySelectorAll("[data-voice-member]")) {
      node.classList.toggle("is-speaking", isSpeaking(node.dataset.voiceMember));
    }
    if (key === speakKey) return;
    speakKey = key;
    speakingHud.innerHTML = active.map((id) => {
      const identity = identityFor(id);
      return `<div class="voice-speaking-chip is-speaking" data-speaker="${escape(id)}">
        ${avatarMarkup(identity, "voice-avatar voice-avatar-lg")}
        <span class="voice-speaking-name">${escape(identity.label)}${id === controller ? " (you)" : ""}</span>
      </div>`;
    }).join("");
    speakingHud.hidden = !active.length;
  }

  function peerLinkState(peer) {
    if (!peer || peer.closed) return "missing";
    const connection = peer.pc.connectionState;
    const ice = peer.pc.iceConnectionState;
    if (connection === "connected" || connection === "completed" || ice === "connected" || ice === "completed") {
      return peer.stream?.getAudioTracks?.().some((track) => track.readyState === "live") ? "linked" : "connecting";
    }
    if (connection === "failed" || ice === "failed" || connection === "closed") return "failed";
    return "connecting";
  }

  function memberSubtitle(member, flags) {
    const identity = identityFor(member.id);
    if (member.id === controller) {
      if (flags.deafened) return "Deafened";
      if (flags.muted) return "Muted";
      return identity.kind === "character" ? (playerOf(member.id).username || "Player") : "Connected";
    }
    const peer = peers.get(member.id);
    const link = peerLinkState(peer);
    if (link === "linked") {
      if (flags.deafened) return "Deafened";
      if (flags.muted) return "Muted";
      if (peer?.outOfRange) return "Too far to hear";
      return identity.kind === "character" ? (playerOf(member.id).username || "Player") : "Connected";
    }
    if (link === "failed") return "Audio link failed";
    return "Connecting audio…";
  }

  function memberRow(member) {
    const identity = identityFor(member.id);
    const self = member.id === controller;
    const flags = self ? {muted, deafened} : member;
    const subtitle = memberSubtitle(member, flags);
    const link = self ? "linked" : peerLinkState(peers.get(member.id));
    return `<li class="voice-channel-row${isSpeaking(member.id) ? " is-speaking" : ""}${link === "linked" ? " is-linked" : link === "failed" ? " is-link-failed" : " is-linking"}" data-voice-member="${escape(member.id)}" title="${escape(identity.label)}">
      ${avatarMarkup(identity, "voice-avatar")}
      <span class="voice-channel-meta">
        <strong>${escape(identity.label)}${self ? " (you)" : ""}</strong>
        <small>${escape(subtitle)}</small>
      </span>
      ${stateBadges(flags)}
    </li>`;
  }

  function renderChannel(online) {
    channel.hidden = channelHidden;
    if (channelHidden) {
      channel.innerHTML = "";
      return;
    }
    const empty = !online.length;
    channel.innerHTML = `<div class="voice-channel ${joined ? "is-live" : ""}">
      <header class="voice-channel-head" title="Drag to move">
        <span class="voice-channel-title">${icon("headphones", 14)} Voice</span>
        <span class="voice-channel-head-end">
          <span class="voice-channel-count">${empty ? "Empty" : online.length + (online.length === 1 ? " connected" : " connected")}</span>
          <button type="button" class="voice-channel-close" data-voice="hide-channel" aria-label="Hide voice panel" title="Hide voice panel">${icon("close", 14)}</button>
        </span>
      </header>
      ${empty
        ? `<p class="voice-channel-empty">No one is in proximity voice. Join to talk with players near your token.</p>`
        : `<ul class="voice-channel-list">${online.map(memberRow).join("")}</ul>`}
      <div class="voice-channel-actions">
        ${joined ? `
          <button type="button" class="game-button" data-voice="mute" aria-pressed="${muted || deafened}" title="${muted || deafened ? "Unmute" : "Mute"}">${icon(muted || deafened ? "micOff" : "mic", 15)}<span>${muted || deafened ? "Unmute" : "Mute"}</span></button>
          <button type="button" class="game-button" data-voice="deafen" aria-pressed="${deafened}" title="${deafened ? "Undeafen" : "Deafen"}">${icon(deafened ? "deafOff" : "headphones", 15)}<span>${deafened ? "Undeafen" : "Deafen"}</span></button>
          <button type="button" class="game-button" data-voice="leave" title="Leave voice">${icon("phoneOff", 15)}<span>Leave</span></button>
        ` : `
          <button type="button" class="game-button game-voice-join" data-voice="join" ${joining ? "disabled" : ""} title="Join proximity voice">${icon("mic", 15)}<span>${joining ? "Joining…" : "Join voice"}</span></button>
        `}
      </div>
      ${status ? `<p class="voice-channel-status" role="status">${escape(status)}</p>` : ""}
      ${turnReady === false ? `<p class="voice-channel-status voice-channel-warn">${
        turnReason === "capped"
          ? "Voice relay is paused this month to stay within Cloudflare’s free allowance. Same-network calls may still work."
          : turnReason === "disabled"
            ? "Voice relay is turned off."
            : "Relay (TURN) isn’t configured — friends on other networks may not connect."
      }</p>` : ""}
    </div>`;
    bindChannelDrag();
    applyChannelPos();
  }

  function render() {
    const online = members.filter((member) => member.online);
    const showChannelBtn = channelHidden
      ? `<button type="button" class="game-button" data-voice="show-channel" aria-label="Show voice panel" title="Show voice panel">${icon("headphones", 16)}<span class="game-button-label">Voice panel</span></button>`
      : "";
    if (!joined) {
      // Join lives only in the voice panel; the bar just reopens it when hidden.
      root.innerHTML = channelHidden
        ? `<div class="game-voice-bar">${showChannelBtn}</div>`
        : "";
    } else {
      root.innerHTML = `<div class="game-voice-bar game-voice-live" title="You’re in proximity voice">
        <span class="game-voice-live-label">${icon("headphones", 14)} In voice</span>
        <button type="button" class="game-button" data-voice="mute" aria-pressed="${muted || deafened}" aria-label="${muted || deafened ? "Unmute" : "Mute"}" title="${muted || deafened ? "Unmute" : "Mute"}">${icon(muted || deafened ? "micOff" : "mic", 16)}</button>
        <button type="button" class="game-button" data-voice="deafen" aria-pressed="${deafened}" aria-label="${deafened ? "Undeafen" : "Deafen"}" title="${deafened ? "Undeafen" : "Deafen"}">${icon(deafened ? "deafOff" : "headphones", 16)}</button>
        <button type="button" class="game-button" data-voice="leave" aria-label="Leave voice" title="Leave voice">${icon("phoneOff", 16)}</button>
        ${showChannelBtn}
      </div>`;
    }
    renderChannel(online);
    paintSpeaking();
  }

  async function signal(to, kind, payload) {
    await postVoice(sessionId, {
      controller,
      action: "signal",
      signal: {to, kind, payload, signalId: crypto.randomUUID()},
    });
  }

  async function publishState() {
    if (!joined) return;
    await postVoice(sessionId, {controller, action: "state", muted, deafened});
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.closed = true;
    try {peer.pc.close();} catch {}
    disposeMeter(peer.meter);
    peer.source?.disconnect();
    peer.panner?.disconnect();
    peer.gain?.disconnect();
    releaseRemoteAudio(peer);
    peers.delete(id);
    speakingUntil.delete(id);
    signalQueues.delete(id);
  }

  function setPeerGain(peer, target) {
    if (!peer.gain || !audioCtx) return;
    const value = deafened ? 0 : target;
    try {
      peer.gain.gain.cancelScheduledValues(audioCtx.currentTime);
      peer.gain.gain.setTargetAtTime(value, audioCtx.currentTime, GAIN_TIME_CONSTANT);
    } catch {
      peer.gain.gain.value = value;
    }
  }

  function releaseRemoteAudio(peer) {
    if (!peer) return;
    try {peer.audioEl?.pause();} catch {}
    if (peer.audioEl) {
      try {peer.audioEl.srcObject = null;} catch {}
      peer.audioEl.remove();
    }
    peer.audioEl = null;
  }

  function attachRemote(id, stream) {
    const peer = peers.get(id);
    if (!peer || !stream) return;
    ensureAudio();
    disposeMeter(peer.meter);
    peer.source?.disconnect();
    peer.panner?.disconnect();
    peer.gain?.disconnect();
    releaseRemoteAudio(peer);
    // Chromium often won't decode remote WebRTC audio into Web Audio unless the
    // stream also has an HTMLMediaElement sink. Keep it silent; spatial gain plays it.
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.setAttribute("playsinline", "");
    audioEl.volume = 0;
    audioEl.srcObject = stream;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    void audioEl.play().catch(() => {});
    const source = audioCtx.createMediaStreamSource(stream);
    const panner = audioCtx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = MAX_RANGE_FT / FEET_PER_SQUARE;
    panner.rolloffFactor = 1.35;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    source.connect(panner);
    panner.connect(gain);
    gain.connect(masterGain);
    peer.audioEl = audioEl;
    peer.source = source;
    peer.panner = panner;
    peer.gain = gain;
    peer.stream = stream;
    peer.meter = makeMeter(stream);
    updateSpatial();
  }

  const signalQueues = new Map();
  const recoverCooldown = new Map();

  async function flushIce(peer) {
    if (!peer?.remoteSet || !peer.pc.remoteDescription) return;
    const pending = peer.iceBuffer.splice(0);
    for (const candidate of pending) {
      try {await peer.pc.addIceCandidate(candidate);} catch (error) {
        if (!peer.ignoreOffer) console.warn("ICE candidate rejected", error);
      }
    }
  }

  function makePeer(id) {
    if (id === controller) return null;
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({iceServers});
    const peer = {
      pc,
      polite: controller < id,
      makingOffer: false,
      ignoreOffer: false,
      remoteSet: false,
      iceBuffer: [],
      reconnecting: false,
      closed: false,
      born: Date.now(),
      lastOfferAt: 0,
    };
    peers.set(id, peer);
    if (localStream) for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    pc.onnegotiationneeded = () => {
      if (peer.closed || peers.get(id) !== peer || !joined || stopped) return;
      // Impolite peer drives offers; polite waits and answers (perfect negotiation).
      if (peer.polite) return;
      void renegotiate(id).catch(() => {});
    };
    pc.onicecandidate = (event) => {
      if (peer.closed) return;
      // null candidate marks end-of-candidates; still forward so the remote can complete checks
      void signal(id, "ice", event.candidate ? event.candidate.toJSON() : null).catch(() => {});
    };
    pc.ontrack = (event) => {
      attachRemote(id, event.streams[0] ?? new MediaStream([event.track]));
      render();
    };
    pc.onconnectionstatechange = () => {
      if (peer.closed || peers.get(id) !== peer) return;
      const state = pc.connectionState;
      if (state === "failed") void recoverPeer(id).catch(() => {});
      else if (state === "connected" || state === "completed") {
        if (status === "Voice reconnecting…" || status === "Connecting audio…") {
          status = "";
        }
        render();
      } else if (state === "closed") closePeer(id);
      else render();
    };
    pc.oniceconnectionstatechange = () => {
      if (peer.closed || peers.get(id) !== peer) return;
      if (pc.iceConnectionState === "failed") void recoverPeer(id).catch(() => {});
      else render();
    };
    return peer;
  }

  async function maintainPeerLinks() {
    if (!joined || stopped) return;
    const now = Date.now();
    let linking = false;
    let failed = false;
    for (const [id, peer] of peers) {
      if (peer.closed) continue;
      const link = peerLinkState(peer);
      if (link === "linked") continue;
      if (link === "failed") {
        failed = true;
        void recoverPeer(id).catch(() => {});
        continue;
      }
      linking = true;
      // Stuck in "new"/"connecting" never reaches "failed" if the first offer was missed.
      if (peer.polite) continue;
      if (now - peer.born < LINK_RETRY_MS) continue;
      if (now - peer.lastOfferAt < LINK_RETRY_COOLDOWN_MS) continue;
      peer.lastOfferAt = now;
      void renegotiate(id, {iceRestart: Boolean(peer.pc.remoteDescription)}).catch(() => {});
    }
    const nextStatus = failed ? "Voice reconnecting…" : linking ? "Connecting audio…" : "";
    if (nextStatus !== status && (nextStatus || status === "Connecting audio…" || status === "Voice reconnecting…")) {
      status = nextStatus;
      render();
    }
  }

  async function recoverPeer(id) {
    const peer = peers.get(id);
    if (!peer || peer.reconnecting || peer.closed || !joined || stopped) return;
    const last = recoverCooldown.get(id) ?? 0;
    if (Date.now() - last < 2500) return;
    recoverCooldown.set(id, Date.now());
    peer.reconnecting = true;
    status = "Voice reconnecting…";
    render();
    try {
      await refreshIce(true);
      if (!joined || stopped || peers.get(id) !== peer || peer.closed) return;
      // Prefer ICE restart in-place; tear down only if restart isn't possible.
      const canRestart = peer.pc.remoteDescription && peer.pc.signalingState === "stable";
      if (canRestart && !peer.polite) {
        try {
          peer.makingOffer = true;
          const offer = await peer.pc.createOffer({iceRestart: true});
          if (peers.get(id) !== peer || peer.closed) return;
          await peer.pc.setLocalDescription(offer);
          await signal(id, "offer", peer.pc.localDescription);
          return;
        } catch {
          // fall through to full rebuild
        } finally {
          peer.makingOffer = false;
        }
      } else if (canRestart && peer.polite) {
        // Impolite peer drives the restart; wait for their offer.
        return;
      }
      closePeer(id);
      if (!joined || stopped) return;
      if (controller > id) await renegotiate(id);
      else makePeer(id);
    } finally {
      const next = peers.get(id);
      if (next) next.reconnecting = false;
    }
  }

  async function refreshIce(force = false) {
    if (!force && iceFetchedAt && Date.now() - iceFetchedAt < ICE_REFRESH_MS) return;
    try {
      const result = await postVoice(sessionId, {controller, action: "ice"});
      if (Array.isArray(result.iceServers) && result.iceServers.length) {
        iceServers = result.iceServers;
        iceFetchedAt = Date.now();
        if (result.turn != null) {
          turnReady = result.turn !== false;
          turnReason = result.turnReason || "";
        }
        for (const peer of peers.values()) {
          try {peer.pc.setConfiguration({iceServers});} catch {}
        }
      }
    } catch {}
  }

  async function renegotiate(id, {iceRestart = false} = {}) {
    let peer = makePeer(id);
    if (!peer || peer.polite || peer.closed) return;
    try {
      peer.makingOffer = true;
      peer.lastOfferAt = Date.now();
      // Unanswered prior offer leaves us stuck in have-local-offer; roll back or rebuild.
      if (peer.pc.signalingState === "have-local-offer") {
        try {
          await peer.pc.setLocalDescription({type: "rollback"});
          peer.remoteSet = false;
          peer.iceBuffer.length = 0;
        } catch {
          closePeer(id);
          if (!joined || stopped) return;
          peer = makePeer(id);
          if (!peer || peer.polite || peer.closed) return;
          peer.makingOffer = true;
          peer.lastOfferAt = Date.now();
        }
      }
      const offer = await peer.pc.createOffer(iceRestart ? {iceRestart: true} : undefined);
      if (peer.closed || peers.get(id) !== peer) return;
      if (peer.pc.signalingState !== "stable" && peer.pc.signalingState !== "have-local-offer") return;
      await peer.pc.setLocalDescription(offer);
      await signal(id, "offer", peer.pc.localDescription);
    } finally {
      if (peer) peer.makingOffer = false;
    }
  }

  async function handleSignalBody(message) {
    const from = message.from;
    if (!from || from === controller) return;
    const peer = makePeer(from);
    if (!peer || peer.closed) return;
    const {kind, payload} = message;
    try {
      if (kind === "offer") {
        const offerCollision = peer.makingOffer || peer.pc.signalingState !== "stable";
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        // Drop candidates collected against a previous remote description / glare loser.
        peer.iceBuffer.length = 0;
        await peer.pc.setRemoteDescription(payload);
        peer.remoteSet = true;
        await flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await signal(from, "answer", peer.pc.localDescription);
      } else if (kind === "answer") {
        if (peer.pc.signalingState !== "have-local-offer") return;
        await peer.pc.setRemoteDescription(payload);
        peer.remoteSet = true;
        await flushIce(peer);
      } else if (kind === "ice") {
        if (peer.ignoreOffer) return;
        if (!peer.remoteSet || !peer.pc.remoteDescription) peer.iceBuffer.push(payload ?? null);
        else {
          try {await peer.pc.addIceCandidate(payload ?? null);} catch (error) {
            if (!peer.ignoreOffer) throw error;
          }
        }
      } else if (kind === "bye") {
        closePeer(from);
      }
    } catch (error) {
      status = error.message || "Voice signaling failed.";
      render();
    }
  }

  async function handleSignal(message) {
    const from = message.from;
    if (!from || from === controller) return;
    const prev = signalQueues.get(from) ?? Promise.resolve();
    const next = prev.then(() => handleSignalBody(message), () => handleSignalBody(message));
    signalQueues.set(from, next.catch(() => {}));
    await next;
  }

  function syncMembers(list) {
    const now = Date.now();
    members = (list ?? []).map((member) => ({
      ...member,
      online: member.online ?? (now - (member.lastSeen ?? 0) < ONLINE_MS),
    }));
    const live = new Set(members.filter((member) => member.online && member.id !== controller).map((member) => member.id));
    for (const id of peers.keys()) if (!live.has(id)) closePeer(id);
    if (joined) {
      for (const id of live) {
        if (!peers.has(id) && controller > id) void renegotiate(id).catch(() => {});
        else makePeer(id);
      }
      void maintainPeerLinks();
    }
    render();
  }

  function updateSpatial() {
    if (!joined || !audioCtx) return;
    if (battleRef) battleRef._voiceSelected = selectedId;
    const listenerActor = actorForController(battleRef, controller, selectedId);
    const listener = gridPos(listenerActor, motionRef);
    const listenerNode = audioCtx.listener;
    if (listener && listenerNode.positionX) {
      listenerNode.positionX.value = listener.x;
      listenerNode.positionY.value = 0;
      listenerNode.positionZ.value = listener.y;
      listenerNode.forwardX.value = 0;
      listenerNode.forwardY.value = 0;
      listenerNode.forwardZ.value = -1;
      listenerNode.upX.value = 0;
      listenerNode.upY.value = 1;
      listenerNode.upZ.value = 0;
    } else if (listener && listenerNode.setPosition) {
      listenerNode.setPosition(listener.x, 0, listener.y);
    }
    for (const [id, peer] of peers) {
      if (!peer.panner || !peer.gain) continue;
      const remoteActor = actorForController(battleRef, id);
      const pos = gridPos(remoteActor, motionRef);
      const distance = feetBetween(listener, pos);
      // No token for either side → full-volume table voice (avoids a silent "connected" call).
      // Both tokens placed → proximity falloff.
      if (!listener || !pos) setPeerGain(peer, 1);
      else setPeerGain(peer, proximityGain(distance));
      peer.outOfRange = Boolean(listener && pos && proximityGain(distance) <= 0);
      if (!pos) continue;
      if (peer.panner.positionX) {
        peer.panner.positionX.value = pos.x;
        peer.panner.positionY.value = 0;
        peer.panner.positionZ.value = pos.y;
      } else if (peer.panner.setPosition) {
        peer.panner.setPosition(pos.x, 0, pos.y);
      }
    }
  }

  function tickFrame() {
    spatialRaf = undefined;
    sampleSpeaking();
    updateSpatial();
    paintSpeaking();
    if ((joined || members.some((member) => member.online)) && !stopped) {
      spatialRaf = requestAnimationFrame(tickFrame);
    }
  }

  function ensureFrame() {
    if (!spatialRaf && !stopped) spatialRaf = requestAnimationFrame(tickFrame);
  }

  function mountSpeakingHud() {
    const stage = document.querySelector(".game-stage");
    if (stage && speakingHud.parentElement !== stage) stage.appendChild(speakingHud);
  }

  async function poll() {
    if (stopped || pollBusy) return;
    pollBusy = true;
    clearTimeout(timer);
    try {
      const snapshot = await readVoice(sessionId, controller, joined ? cursor : undefined);
      if (stopped) return;
      syncMembers(snapshot.members);
      if (joined) {
        for (const message of snapshot.signals ?? []) await handleSignal(message);
        if (snapshot.after != null) cursor = snapshot.after;
        await postVoice(sessionId, {controller, action: "heartbeat", muted, deafened}).catch(() => {});
        if (Date.now() - iceFetchedAt > ICE_REFRESH_MS) void refreshIce(true);
      }
      ensureFrame();
    } catch (error) {
      if (joined) status = error.message || "Voice reconnecting…";
      render();
    } finally {
      pollBusy = false;
      if (!stopped) timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : (joined ? POLL_MS : 2500));
    }
  }

  async function join() {
    if (joined || joining || stopped) return;
    const epoch = ++joinEpoch;
    joining = true;
    status = "Requesting microphone…";
    render();
    let stream = null;
    try {
      ensureAudio();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (stopped || epoch !== joinEpoch) {
        stopStream(stream);
        return;
      }
      const result = await postVoice(sessionId, {controller, action: "join", muted: false, deafened: false});
      if (stopped || epoch !== joinEpoch) {
        stopStream(stream);
        try {await postVoice(sessionId, {controller, action: "leave"});} catch {}
        return;
      }
      localStream = stream;
      stream = null;
      disposeMeter(localMeter);
      localMeter = makeMeter(localStream);
      if (Array.isArray(result.iceServers) && result.iceServers.length) {
        iceServers = result.iceServers;
        iceFetchedAt = Date.now();
      }
      // Always start a fresh signal cursor so a prior leave/rejoin cannot skip offers.
      cursor = 0;
      joined = true;
      muted = false;
      deafened = false;
      turnReady = result.turn !== false;
      turnReason = result.turnReason || "";
      status = result.members?.some((member) => member.id !== controller && (member.online ?? true))
        ? "Connecting audio…"
        : "";
      syncMembers(result.members);
      applyMuteTracks();
      applyDeafGain();
      ensureFrame();
      void poll();
    } catch (error) {
      stopStream(stream);
      if (localStream && epoch === joinEpoch) {
        stopStream(localStream);
        localStream = null;
      }
      if (epoch === joinEpoch) {
        joined = false;
        status = error.name === "NotAllowedError"
          ? "Microphone permission denied."
          : (error.message || "Could not join voice.");
        render();
      }
    } finally {
      if (epoch === joinEpoch) joining = false;
      if (epoch === joinEpoch && !joined) render();
    }
  }

  async function leave() {
    joinEpoch += 1;
    joining = false;
    const wasJoined = joined;
    joined = false;
    cursor = 0;
    for (const id of [...peers.keys()]) {
      void signal(id, "bye", {}).catch(() => {});
      closePeer(id);
    }
    disposeMeter(localMeter);
    localMeter = null;
    stopStream(localStream);
    localStream = null;
    speakingUntil.clear();
    if (wasJoined) {
      try {await postVoice(sessionId, {controller, action: "leave"});} catch {}
    }
    status = "";
    speakKey = "";
    speakingHud.innerHTML = "";
    speakingHud.hidden = true;
    render();
  }

  function onVoiceClick(event) {
    const action = event.target.closest("[data-voice]")?.dataset.voice;
    if (!action) return;
    event.preventDefault();
    if (action === "join") void join();
    else if (action === "leave") void leave();
    else if (action === "hide-channel") {
      setChannelHidden(true);
      render();
    } else if (action === "show-channel") {
      setChannelHidden(false);
      render();
    } else if (action === "mute") {
      muted = !(muted || deafened) ? true : false;
      if (!muted) deafened = false;
      applyMuteTracks();
      applyDeafGain();
      void publishState();
      render();
    } else if (action === "deafen") {
      deafened = !deafened;
      if (deafened) muted = true;
      applyMuteTracks();
      applyDeafGain();
      updateSpatial();
      void publishState();
      render();
    }
  }
  root.addEventListener("click", onVoiceClick);
  channel.addEventListener("click", onVoiceClick);

  render();
  timer = setTimeout(poll, 1200);

  return {
    element: root,
    get isJoined() {return joined;},
    get members() {return members;},
    mount(slot) {
      if (slot && root.parentElement !== slot) slot.replaceChildren(root);
      const channelSlot = document.querySelector(".game-voice-channel-slot");
      if (channelSlot && channel.parentElement !== channelSlot) channelSlot.replaceChildren(channel);
      applyChannelPos();
      mountSpeakingHud();
      render();
    },
    syncPositions({battle, tokenPositions, selected} = {}) {
      // Motion path only — no DOM rebuild (giant maps were paying 60fps voice HTML).
      battleRef = battle ?? battleRef;
      motionRef = tokenPositions ?? motionRef;
      if (selected) selectedId = selected;
      updateSpatial();
      ensureFrame();
    },
    sync({battle, players, tokenPositions, selected} = {}) {
      battleRef = battle ?? battleRef;
      playersRef = players ?? playersRef;
      motionRef = tokenPositions ?? motionRef;
      if (selected) selectedId = selected;
      const channelSlot = document.querySelector(".game-voice-channel-slot");
      if (channelSlot && channel.parentElement !== channelSlot) channelSlot.replaceChildren(channel);
      applyChannelPos();
      mountSpeakingHud();
      updateSpatial();
      speakKey = "";
      render();
      ensureFrame();
    },
    async destroy() {
      stopped = true;
      joinEpoch += 1;
      clearTimeout(timer);
      cancelAnimationFrame(spatialRaf);
      await leave();
      speakingHud.remove();
      channel.remove();
      try {await audioCtx?.close();} catch {}
      audioCtx = null;
      root.remove();
    },
  };
}
