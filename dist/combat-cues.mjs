import {keyAt} from "./combat.mjs";
import {escape} from "./format.mjs";
import {cellCenter} from "./map-grid.mjs";

const clamp = (value,min,max) => Math.min(Math.max(value,min),Math.max(min,max));
const visibleAt = (sight, event) => sight.has(keyAt(event.x,event.y));

function groupActions(events, sight) {
  const cues = [];
  for (const event of events) {
    const visible = visibleAt(sight,event);
    if (!visible && !event.outcome) continue;
    const previous = cues.at(-1);
    const related = visible && previous?.actor === event.actor && !event.reaction && !previous.outcome;
    const context = related ? [...previous.context,previous.action] : [];
    if (related) cues.pop();
    cues.push({...event,context,visible});
  }
  return cues;
}

function cueText(event) {
  const {context, outcome, reaction, damage, type, target} = event;
  const result = outcome === "Critical hit" ? "critical" : outcome === "Hit" ? "hit" : outcome === "Miss" ? "miss" : "";
  const name = event.visible ? event.name : "Unseen enemy";
  const action = event.visible ? event.action : "Attack";
  const detail = [];
  if (damage) {
    detail.push(damage.damage + (type ? " " + type : "") + " damage");
    if (damage.absorbed) detail.push(damage.absorbed + " absorbed by temporary HP");
    if (damage.defeated) detail.push("Defeated");
    else if (damage.unconscious) detail.push("Unconscious");
  }
  if (event.prone) detail.push("Knocked prone");
  return `<div class="combat-cue-heading"><strong>${escape(name)}</strong>
    ${outcome ? `<span class="combat-cue-result ${result}">${escape(outcome)}</span>` : ""}</div>
    ${reaction ? '<div class="combat-cue-note">Opportunity attack</div>' : ""}
    <div>${escape(action)}${target ? " vs " + escape(target) : ""}</div>
    ${outcome ? `<div class="combat-cue-roll">d20 ${escape(event.roll)} = <strong>${escape(event.total)}</strong></div>` : ""}
    ${detail.length ? `<div class="combat-cue-detail">${escape(detail.join(" · "))}</div>` : ""}
    ${context.length ? `<div class="combat-cue-note">${escape(context.join(" · "))}</div>` : ""}`;
}

export function createCombatCues() {
  const bubble = document.createElement("div");
  bubble.className = "combat-cue";
  let scope;
  let cursor = 0;
  let queue = [];
  let active;
  let view;
  let timer;

  function place() {
    if (!active || !view?.layer.isConnected) return;
    const {layer,frame,grid,map,sight} = view;
    const board = frame.getBoundingClientRect();
    const surface = grid.getBoundingClientRect();
    const origin = layer.getBoundingClientRect();
    const [worldX,worldY] = cellCenter(map,active);
    const x = surface.left + worldX/map.width*surface.width;
    const y = surface.top + worldY/map.height*surface.height;
    const onToken = active.visible && visibleAt(sight,active) &&
      x >= board.left && x <= board.right && y >= board.top && y <= board.bottom;
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const gap = 8;
    const left = onToken ? clamp(x-width/2,board.left+gap,board.right-width-gap) : board.right-width-gap;
    const radius = map.size*.42/map.height*surface.height;
    let top = board.top+gap;
    let point = "";
    if (onToken) {
      if (y-radius-height-gap >= board.top+gap) {
        top = y-radius-height-gap;
        point = "bottom";
      } else if (y+radius+gap+height <= board.bottom-gap) {
        top = y+radius+gap;
        point = "top";
      } else {
        top = clamp(y-height-gap,board.top+gap,board.bottom-height-gap);
      }
    }
    bubble.dataset.point = point;
    bubble.style.setProperty("--cue-tip",clamp(x-left,10,width-10)+"px");
    bubble.style.left = left-origin.left+"px";
    bubble.style.top = top-origin.top+"px";
  }

  function playNext() {
    active = queue.shift();
    if (!active || !view) {
      bubble.remove();
      return;
    }
    bubble.innerHTML = cueText(active);
    view.layer.append(bubble);
    place();
    timer = setTimeout(playNext,active.outcome ? 2600 : 1600);
  }

  function reset() {
    clearTimeout(timer);
    queue = [];
    active = view = undefined;
    bubble.remove();
    scope = undefined;
    cursor = 0;
  }

  return {
    sync(nextScope, events, viewport) {
      const latest = events.at(-1)?.id ?? 0;
      if (scope !== nextScope || latest < cursor) {
        reset();
        scope = nextScope;
        cursor = latest;
      }
      view = viewport;
      if (!view) {
        clearTimeout(timer);
        queue = [];
        active = undefined;
        bubble.remove();
        cursor = latest;
        return;
      }
      if (latest > cursor) {
        queue.push(...groupActions(events.filter(({id}) => id > cursor),view.sight));
        cursor = latest;
      }
      if (active) {
        view.layer.append(bubble);
        place();
      } else if (queue.length) playNext();
    },
    place,
    reset,
  };
}
