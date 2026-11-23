import {keyAt} from "./combat.mjs";
import {escape} from "./format.mjs";
import {cellCenter} from "./map-grid.mjs";
import {createDiceTheatre} from "./dice-theatre.mjs";
import {fogOfWarEnabled} from "./game-settings.mjs";

const clamp = (value,min,max) => Math.min(Math.max(value,min),Math.max(min,max));
export const movementEvent=event=>event.kind==='move' || /^Moved /.test(event.action ?? '');
export const cueDuration=event=>event.healthChanges?.some(change=>!change.before.dead && change.after.dead) ? (event.healthChanges.some(change=>change.side==='party' && change.after.dead)?6500:4800) : movementEvent(event) ? 0 : event.outcome ? event.side==='party' ? event.outcome==='Critical hit' ? 5000 : 4200 : 3200 : event.rolls?.length ? event.side==='party' ? 3600 : 2600 : 1800;
const visibleAt = (sight, event, fogEnabled=fogOfWarEnabled) => !fogEnabled || event.side === "party" || sight.has(keyAt(event.x,event.y));

function visibleEvent(event,sight,fogEnabled) {
  const visible=visibleAt(sight,event,fogEnabled);
  if (!visible && !event.outcome) return null;
  if (visible) return {...event,visible};
  // An attack from fog may be shown without revealing the attacker or weapon.
  return {...event,name:"Unseen enemy",action:"Attack",visible:false,messages:[],
    rolls:(event.rolls ?? []).map(roll=>({...roll,label:"Attack roll"})),impacts:[]};
}

function groupActions(events, sight,fogEnabled) {
  const cues = [];
  for (const raw of events) {
    const event=visibleEvent(raw,sight,fogEnabled);
    if (!event) continue;
    if (event.kind === "initiative" && event.side !== "party") continue;
    const visible=event.visible;
    const previous = cues.at(-1);
    if (event.kind === "initiative" && previous?.kind === "initiative") {
      const named=entry=>(entry.rolls ?? []).map(roll=>({...roll,label:entry.name+" · Initiative"}));
      cues[cues.length-1]={...previous,name:"Party",action:"Initiative",rolls:[...(previous.partyInitiative ? previous.rolls : named(previous)),...named(event)],
        partyInitiative:true,partyEvents:[...(previous.partyEvents ?? [previous]),event]};
      continue;
    }
    const related = visible && previous?.actor === event.actor && !event.reaction && !previous.outcome &&
      !previous.rolls?.length && /^(Moved |Dash|Disengage|Stood up)/.test(previous.action);
    const context = related ? [...previous.context,previous.action] : [];
    if (related) cues.pop();
    cues.push({...event,context,visible});
  }
  return cues;
}

function impactWord(event) {
  if (event.outcome === "Critical hit") return "KRAK!";
  if (event.outcome === "Miss") return event.blocked ? "CLANG!" : "WHOOSH!";
  if (event.kind === "spell") return "FWOOM!";
  if (event.kind === "heal") return "GLOW";
  if (event.kind === "fall") return "THUD!";
  if (event.outcome === "Hit") return ({slashing:"SCHWING!",piercing:"THUNK!",bludgeoning:"THWACK!"})[event.type] ?? "POW!";
  if (event.kind === "ability") return "FOCUS!";
  if (event.kind === "chat-roll") return "ROLL!";
  return "";
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
  const word=impactWord(event);
  const messages=event.visible ? (event.messages ?? []).filter(message=>!message.includes(" · "+event.action+" vs ")).slice(-2) : [];
  return `${word ? `<div class="combat-impact" aria-hidden="true">${word}</div>` : ""}<div class="combat-cue-heading"><strong>${escape(name)}</strong>
    <button type="button" class="cue-dismiss" aria-label="Dismiss action message">×</button>
    ${outcome ? `<span class="combat-cue-result ${result}">${escape(outcome)}</span>` : ""}</div>
    ${reaction ? '<div class="combat-cue-note">Opportunity attack</div>' : ""}
    <div>${escape(action)}${target ? " vs " + escape(target) : ""}</div>
    ${event.roll != null ? `<div class="combat-cue-roll">d20 ${escape(event.roll)} = <strong>${escape(event.total)}</strong></div>` : ""}
    ${!event.roll && event.rolls?.length ? `<div class="combat-cue-roll">${event.rolls.slice(0,3).map(roll=>escape(roll.label)+" · "+escape(roll.breakdown)+" = <strong>"+roll.total+"</strong>").join("<br>")}</div>` : ""}
    ${detail.length ? `<div class="combat-cue-detail">${escape(detail.join(" · "))}</div>` : ""}
    ${context.length ? `<div class="combat-cue-note">${escape(context.join(" · "))}</div>` : ""}
    ${messages.map(message=>'<div class="combat-cue-note">'+escape(message)+"</div>").join("")}`;
}

export function createCombatCues() {
  const feed=document.createElement("div");
  feed.className="game-event-feed";
  feed.setAttribute("role","log");
  feed.setAttribute("aria-label","Action messages");
  const dice=createDiceTheatre();
  let scope;
  let cursor = 0;
  let queue = [];
  let isRolling = false;
  let view;
  const activeCues = [];

  const hasDice = event => Boolean(event?.rolls?.some(roll => roll.dice?.length) && (event.kind !== "initiative" || event.side === "party"));

  function appendFeed(events, pending=false) {
    const scroller=feed.closest('.game-event-body');
    const following=scroller && scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop<24;
    for (const event of events) {
      const visible=visibleEvent(event,view.sight,view.fogEnabled);
      if(!visible) continue;
      if(movementEvent(event)) for(const line of feed.children) if(line.dataset.kind==='move' && line.dataset.actor===event.actor) line.remove();
      const item=Array.from(feed.children).find(item=>item.dataset.event===String(event.id)) ?? document.createElement("div");
      item.className="game-event-line";
      item.dataset.event=event.id;
      item.dataset.kind=movementEvent(event) ? 'move' : event.kind ?? '';item.dataset.actor=event.actor;
      const heading=document.createElement("strong"),message=document.createElement("span");
      heading.textContent=visible.name+" · "+visible.action;
      const roll=visible.rolls?.find(roll=>roll.kept != null) ?? visible.rolls?.[0];
      message.textContent=pending && visible.rolls?.some(roll=>roll.dice?.length) ? "Rolling…" : [visible.outcome,roll ? roll.breakdown+" = "+roll.total : "",
        visible.messages?.at(-1) ?? (visible.damage ? visible.damage.damage+" damage" : "")].filter(Boolean).join(" · ");
      item.replaceChildren(heading,message);if(!item.parentElement) feed.append(item);
    }
    while(feed.childElementCount>48) feed.firstElementChild.remove();
    if(following) scroller.scrollTop=scroller.scrollHeight;
  }

  function dismissCue(cue) {
    const index = activeCues.indexOf(cue);
    if (index !== -1) activeCues.splice(index, 1);
    clearTimeout(cue.timer);
    cue.impacts.forEach(({element}) => element.remove());
    cue.impacts = [];
    cue.element.remove();
    place();
  }

  function placeImpacts() {
    if(!view) return;
    const grid=view.grid.getBoundingClientRect(),origin=view.layer.getBoundingClientRect();
    const actorCounts = new Map();
    for (const cue of activeCues) {
      for (const {element, impact} of cue.impacts) {
        const [x,y]=cellCenter(view.map,impact);
        const count = actorCounts.get(impact.actor) ?? 0;
        actorCounts.set(impact.actor, count + 1);
        const offsetX = (count % 3 - 1) * 16;
        const offsetY = Math.floor(count / 3) * -18;
        element.style.left=(grid.left-origin.left+x/view.map.width*grid.width+offsetX)+"px";
        element.style.top=(grid.top-origin.top+y/view.map.height*grid.height-22+offsetY)+"px";
        if(element.parentElement!==view.layer) {
          element.style.animationDelay=(cue.revealedAt-performance.now())+'ms';
          view.layer.append(element);
        }
      }
    }
  }

  function place() {
    if (!view?.layer.isConnected || !activeCues.length) return;
    const {layer,frame,grid,map,sight} = view;
    const board = frame.getBoundingClientRect();
    const surface = grid.getBoundingClientRect();
    const origin = layer.getBoundingClientRect();
    const gap = 8;
    const radius = map.size*.42/map.height*surface.height;
    const placedBoxes = [];

    for (const cue of activeCues) {
      const event = cue.event;
      const bubble = cue.element;
      const [worldX,worldY] = cellCenter(map,event);
      const x = surface.left + worldX/map.width*surface.width;
      const y = surface.top + worldY/map.height*surface.height;
      const onToken = event.visible && visibleAt(sight,event,view.fogEnabled) &&
        x >= board.left && x <= board.right && y >= board.top && y <= board.bottom;
      const width = bubble.offsetWidth || 220;
      const height = bubble.offsetHeight || 80;
      let left = onToken ? clamp(x-width/2,board.left+gap,board.right-width-gap) : board.right-width-gap;
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

      // Anti-overlap positioning: adjust position if overlapping another active cue
      for (const box of placedBoxes) {
        const overlapX = left < box.right + gap && left + width > box.left - gap;
        const overlapY = top < box.bottom + gap && top + height > box.top - gap;
        if (overlapX && overlapY) {
          if (point === "bottom") {
            if (box.top - height - gap >= board.top + gap) {
              top = box.top - height - gap;
            } else if (box.bottom + gap + height <= board.bottom - gap) {
              top = box.bottom + gap;
              point = "top";
            } else if (box.right + gap + width <= board.right - gap) {
              left = box.right + gap;
            } else if (box.left - gap - width >= board.left + gap) {
              left = box.left - gap - width;
            } else {
              top = clamp(box.top - 24, board.top + gap, board.bottom - height - gap);
              left = clamp(box.left + 18, board.left + gap, board.right - width - gap);
            }
          } else if (point === "top") {
            if (box.bottom + gap + height <= board.bottom - gap) {
              top = box.bottom + gap;
            } else if (box.top - height - gap >= board.top + gap) {
              top = box.top - height - gap;
              point = "bottom";
            } else if (box.right + gap + width <= board.right - gap) {
              left = box.right + gap;
            } else if (box.left - gap - width >= board.left + gap) {
              left = box.left - gap - width;
            } else {
              top = clamp(box.top + 24, board.top + gap, board.bottom - height - gap);
              left = clamp(box.left + 18, board.left + gap, board.right - width - gap);
            }
          } else {
            top = box.bottom + gap;
            if (top + height > board.bottom - gap) {
              top = board.top + gap;
              left = Math.max(board.left + gap, box.left - width - gap);
            }
          }
        }
      }

      placedBoxes.push({left, top, right: left + width, bottom: top + height});

      bubble.dataset.point = point;
      bubble.style.setProperty("--cue-tip",clamp(x-left,10,width-10)+"px");
      bubble.style.left = left-origin.left+"px";
      bubble.style.top = top-origin.top+"px";
    }

    placeImpacts();
  }

  function reveal(event) {
    if(!event || !view) return;
    view.onReveal?.(event);
    const revealedAt = performance.now();
    appendFeed(event.partyEvents ?? [event]);

    const bubble = document.createElement("div");
    bubble.className = "combat-cue";
    bubble.innerHTML = cueText(event);
    bubble.dataset.side = event.side ?? "hostile";
    bubble.dataset.outcome = event.outcome ?? event.kind ?? "action";
    bubble.dataset.eventId = String(event.id);

    const impacts = (event.impacts ?? [])
      .filter(impact => !fogOfWarEnabled || view.sight.has(keyAt(impact.x,impact.y)))
      .map(impact => {
        const element = document.createElement("div");
        element.className = "token-impact-number" + (impact.healing ? " healing" : "") + (impact.critical ? " critical" : "");
        element.textContent = (impact.healing ? "+" : "−") + impact.amount +
          (impact.absorbed ? " · absorbed " + impact.absorbed : "") +
          (impact.defeated ? " · Defeated" : "");
        return {element, impact};
      });

    for(const death of event.healthChanges ?? []){
      if(death.before.dead || !death.after.dead || view.fogEnabled && death.side!=='party' && !view.sight.has(keyAt(death.x,death.y)))continue;
      const element=document.createElement('div');element.className='token-death-cue'+(death.side==='party'?' party-fallen':'');
      const label=document.createElement('strong'),name=document.createElement('span');label.textContent=death.side==='party'?'FALLEN':'DEFEATED';name.textContent=death.name; element.append(label,name);
      impacts.push({element,impact:{actor:death.actor,x:death.x,y:death.y}});
    }
    const cue = {
      id: event.id,
      event,
      element: bubble,
      impacts,
      revealedAt,
      timer: null
    };

    bubble.addEventListener('click', ev => {
      if (ev.target.closest('.cue-dismiss')) {
        ev.stopPropagation();
        dismissCue(cue);
      }
    });

    view.layer.append(bubble);
    bubble.animate(
      [{opacity:0,transform:"translateY(12px) scale(.92)"},{opacity:1,transform:"translateY(0) scale(1)"}],
      {duration:matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260,easing:"cubic-bezier(.16,1,.3,1)"}
    );

    activeCues.push(cue);
    cue.timer = setTimeout(() => dismissCue(cue), cueDuration(event));
    place();
  }

  function processQueue() {
    if (!view || isRolling || !queue.length) return;

    const next = queue[0];
    if (!hasDice(next)) {
      queue.shift();
      reveal(next);
      processQueue();
      return;
    }

    const wait = Math.max(view.motion?.remaining(next.actor) ?? 0, view.motion?.remaining(next.targetActor) ?? 0);
    if (wait > 0) {
      setTimeout(() => { if (!isRolling) processQueue(); }, wait + 20);
      return;
    }

    // Batch simultaneous attacks from the same actor in this cycle (e.g. multiattack)
    const batch = [queue.shift()];
    while (queue.length > 0 && queue[0].actor === batch[0].actor && hasDice(queue[0]) && batch.length < 4) {
      batch.push(queue.shift());
    }

    isRolling = true;
    const hasMore = queue.some(hasDice);

    if (batch.length === 1) {
      const event = batch[0];
      dice.play(event, () => {
        isRolling = false;
        reveal(event);
        processQueue();
      }, hasMore);
    } else {
      const combinedRolls = batch.flatMap(e =>
        (e.rolls ?? []).map(r => ({
          ...r,
          label: (batch.length > 1 ? e.action + " · " : "") + (r.label || "Roll")
        }))
      );
      const combinedEvent = {
        ...batch[0],
        action: batch.map(e => e.action).join(" & "),
        rolls: combinedRolls,
        partyEvents: batch
      };
      dice.play(combinedEvent, () => {
        isRolling = false;
        batch.forEach(e => reveal(e));
        processQueue();
      }, hasMore);
    }
  }

  function reset() {
    queue = [];
    isRolling = false;
    while (activeCues.length) {
      const cue = activeCues.pop();
      clearTimeout(cue.timer);
      cue.impacts.forEach(({element}) => element.remove());
      cue.element.remove();
    }
    dice.stop();
    feed.replaceChildren();feed.remove();
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
        reset();
        cursor = latest;
        return;
      }
      if(view.feed && feed.parentElement!==view.feed) view.feed.append(feed);
      if(!feed.childElementCount && latest===cursor) appendFeed(events);
      if (latest > cursor) {
        const fresh=events.filter(({id}) => id > cursor);
        appendFeed(fresh,true);
        const grouped=groupActions(fresh.filter(event=>!movementEvent(event)),view.sight,view.fogEnabled);
        const queued=new Set(grouped.flatMap(event=>(event.partyEvents ?? [event]).map(entry=>entry.id)));
        for(const event of fresh) if(!queued.has(event.id)) view.onReveal?.(event);
        queue.push(...grouped);
        const dropped=queue.splice(0,Math.max(0,queue.length-16));
        for(const event of dropped) view.onReveal?.(event);
        cursor = latest;
        if (dice.isPlaying && queue.some(hasDice)) {
          dice.expedite();
        }
        processQueue();
      }
      if (activeCues.length) {
        for (const cue of activeCues) {
          if (cue.element.parentElement !== view.layer) {
            const word = cue.element.querySelector('.combat-impact');
            if (word) word.style.animationDelay = (cue.revealedAt - performance.now()) + 'ms';
            view.layer.append(cue.element);
          }
        }
        place();
      }
    },
    triggerRoll(event, done) {
      if (!event) return;
      if (dice.enabled) {
        dice.play(event, () => {
          reveal(event);
          done?.();
        });
      } else {
        reveal(event);
        done?.();
      }
    },
    place,
    reset,
    get diceEnabled() {return dice.enabled;},
    toggleDice:() => dice.toggle(),
  };
}
