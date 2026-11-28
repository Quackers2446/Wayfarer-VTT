import {escape} from "./format.mjs";

/** Brief BG3-style victory banner when an encounter is cleared. */

const DURATION_MS = 3200;
let host;
let hideTimer;
let lastPlayed = 0;

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ensureHost() {
  if (host?.isConnected) return host;
  host = document.createElement("div");
  host.className = "combat-victory-hud";
  host.hidden = true;
  host.setAttribute("aria-live", "assertive");
  document.body.append(host);
  return host;
}

function dismiss({ immediate = false } = {}) {
  clearTimeout(hideTimer);
  hideTimer = 0;
  if (!host?.isConnected) return;
  const banner = host.querySelector(".combat-victory");
  if (!banner) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  if (immediate || reducedMotion()) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  banner.classList.add("is-leaving");
  setTimeout(() => {
    if (!host) return;
    host.hidden = true;
    host.replaceChildren();
  }, 420);
}

/**
 * Play the encounter-cleared fanfare. Debounced so multiplayer catch-up
 * and a local clear in the same beat do not stack banners.
 */
export function playCombatVictory({
  title = "Victory",
  detail = "Encounter cleared",
  duration = DURATION_MS,
} = {}) {
  const now = performance.now();
  if (now - lastPlayed < 1800) return false;
  lastPlayed = now;
  const layer = ensureHost();
  clearTimeout(hideTimer);
  layer.replaceChildren();
  layer.hidden = false;

  const banner = document.createElement("div");
  banner.className = "combat-victory" + (reducedMotion() ? " is-settled" : "");
  banner.innerHTML = `
    <div class="combat-victory-flare" aria-hidden="true"></div>
    <div class="combat-victory-rays" aria-hidden="true"></div>
    <p class="combat-victory-kicker">Combat won</p>
    <strong class="combat-victory-title">${escape(title)}</strong>
    <p class="combat-victory-detail">${escape(detail)}</p>`;
  layer.append(banner);

  const settle = () => banner.classList.add("is-settled");
  if (reducedMotion()) settle();
  else banner.addEventListener("animationend", settle, { once: true });

  hideTimer = setTimeout(() => dismiss(), Math.max(1200, duration));
  return true;
}

export function clearCombatVictory() {
  dismiss({ immediate: true });
  lastPlayed = 0;
}

/** True when combat just ended with no living hostiles left — a fight win, not a flee/truce. */
export function shouldPlayCombatVictory(previousRound, battle, { partyWiped = false } = {}) {
  if (!(previousRound > 0) || battle?.round || partyWiped) return false;
  return !(battle.actors ?? []).some((actor) =>
    actor.side === "hostile" && actor.hp > 0 && !actor.dead &&
    actor.x != null && actor.y != null && !actor.carriedBy && !actor.draggedBy);
}
