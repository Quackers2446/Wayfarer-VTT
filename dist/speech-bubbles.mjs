import {escape} from "./format.mjs";
import {cellCenter} from "./map-grid.mjs";
import {tokenRadius} from "./actor-space.mjs";

const CHAR_MS = 28;
const HOLD_MS = 2800;
const LINE_GAP_MS = 420;

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Pull the spoken quote out of a line when present. */
function extractSpeech(line) {
  const match = String(line).match(/["“]([^"”]+)["”]/);
  if (match) return match[1].trim();
  return String(line).replace(/^["“]+|["”]+$/g, "").trim() || String(line).trim();
}

/** Prefer quoted dialogue; otherwise the last line. */
export function spokenLines(lines = []) {
  const list = (Array.isArray(lines) ? lines : [lines]).map((line) => String(line ?? "").trim()).filter(Boolean);
  if (!list.length) return [];
  const quoted = list.filter((line) => /["“]/.test(line));
  const pick = quoted.length ? quoted : [list.at(-1)];
  return pick.map(extractSpeech).filter(Boolean);
}

export function createSpeechBubbles() {
  let view = null;
  const active = new Map();
  let host;

  function ensureHost() {
    if (host?.isConnected) return host;
    host = document.createElement("div");
    host.className = "speech-bubble-layer";
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
    return host;
  }

  function clearActor(id) {
    const entry = active.get(id);
    if (!entry) return;
    clearTimeout(entry.hold);
    clearTimeout(entry.gap);
    cancelAnimationFrame(entry.frame);
    entry.el.remove();
    active.delete(id);
  }

  function clear() {
    for (const id of [...active.keys()]) clearActor(id);
  }

  function placeOne(entry) {
    if (!view?.surface?.isConnected || !view.map || !entry?.actor) return;
    const {map, surface} = view;
    const actor = entry.actor;
    if (actor.x == null || actor.y == null) return;
    const bounds = surface.getBoundingClientRect();
    const frame = surface.closest(".board-frame")?.getBoundingClientRect();
    if (!frame || bounds.width < 1 || bounds.height < 1) return;
    const [cx, cy] = cellCenter(map, actor);
    const screenX = bounds.left + cx / map.width * bounds.width;
    const screenY = bounds.top + cy / map.height * bounds.height;
    const radius = tokenRadius(map, actor) / map.height * bounds.height;
    const bubble = entry.el;
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const left = Math.max(8, frame.left + 6);
    const right = Math.min(innerWidth - 8, frame.right - 6);
    const top = Math.max(8, frame.top + 6);
    const bottom = Math.min(innerHeight - 8, frame.bottom - 6);
    const x = Math.max(left, Math.min(right - width, screenX - width / 2));
    const above = screenY - radius - height - 10;
    const y = above >= top ? above : Math.min(bottom - height, screenY + radius + 10);
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    bubble.classList.toggle("is-below", above < top);
  }

  function place() {
    for (const entry of active.values()) placeOne(entry);
  }

  function typewrite(entry, text, done) {
    const body = entry.el.querySelector(".speech-bubble-text");
    if (!body) { done?.(); return; }
    if (reducedMotion()) {
      body.textContent = text;
      entry.el.classList.add("is-settled");
      done?.();
      return;
    }
    entry.el.classList.remove("is-settled");
    entry.el.classList.add("is-talking");
    let i = 0;
    const step = () => {
      i = Math.min(text.length, i + 1);
      body.textContent = text.slice(0, i);
      placeOne(entry);
      if (i < text.length) entry.hold = setTimeout(step, CHAR_MS);
      else {
        entry.el.classList.remove("is-talking");
        entry.el.classList.add("is-settled");
        done?.();
      }
    };
    body.textContent = "";
    step();
  }

  function showLine(actorId, text, {name, hold = HOLD_MS} = {}) {
    const actor = view?.battle?.actors?.find((entry) => entry.id === actorId);
    if (!actor || !text) return Promise.resolve(false);
    clearActor(actorId);
    const layer = ensureHost();
    const el = document.createElement("div");
    el.className = "speech-bubble";
    el.dataset.actor = actorId;
    el.innerHTML = `<div class="speech-bubble-card">
      <strong class="speech-bubble-name">${escape(name || actor.name)}</strong>
      <p class="speech-bubble-text"></p>
    </div><span class="speech-bubble-tail" aria-hidden="true"></span>`;
    layer.append(el);
    const entry = {el, actor, hold: 0, gap: 0, frame: 0};
    active.set(actorId, entry);
    placeOne(entry);
    return new Promise((resolve) => {
      typewrite(entry, text, () => {
        entry.hold = setTimeout(() => {
          el.classList.add("is-leaving");
          setTimeout(() => {
            clearActor(actorId);
            resolve(true);
          }, 280);
        }, hold);
      });
    });
  }

  async function say(actorId, lines, options = {}) {
    const sequence = spokenLines(lines);
    if (!sequence.length) return false;
    for (let i = 0; i < sequence.length; i++) {
      if (!view?.battle?.actors?.some((entry) => entry.id === actorId)) return false;
      await showLine(actorId, sequence[i], {
        name: options.name,
        hold: i === sequence.length - 1 ? (options.hold ?? HOLD_MS) : Math.min(HOLD_MS, 1600 + sequence[i].length * 12),
      });
      if (i < sequence.length - 1) {
        await new Promise((resolve) => {
          const gap = setTimeout(resolve, LINE_GAP_MS);
          const entry = active.get(actorId);
          if (entry) entry.gap = gap;
        });
      }
    }
    return true;
  }

  return {
    sync(next) {
      view = next;
      if (!next?.surface) {
        clear();
        return;
      }
      for (const [id, entry] of active) {
        const actor = next.battle?.actors?.find((item) => item.id === id);
        if (!actor || actor.x == null) clearActor(id);
        else entry.actor = actor;
      }
      place();
    },
    place,
    say,
    clear,
    destroy() {
      clear();
      host?.remove();
      host = null;
      view = null;
    },
  };
}
