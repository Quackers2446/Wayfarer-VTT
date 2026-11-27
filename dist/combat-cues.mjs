import {createDamageEffects} from './damage-effects.mjs';
import {keyAt} from "./combat.mjs";
import {escape} from "./format.mjs";
import {cellCenter} from "./map-grid.mjs";
import {createDiceTheatre} from "./dice-theatre.mjs";
import {fogOfWarEnabled} from "./game-settings.mjs";
import {createSpellVisuals} from './spell-visuals.mjs';
import {createZoneVisuals} from './zone-visuals.mjs';

export const movementEvent=event=>event.kind==='move' || /^Moved /.test(event.action ?? '');
export const cueDuration=event=>event.healthChanges?.some(change=>!change.before.dead && change.after.dead) ? (event.healthChanges.some(change=>change.side==='party' && change.after.dead)?6500:4800) : movementEvent(event) ? 0 : event.outcome ? event.side==='party' ? event.outcome==='Critical hit' ? 5000 : 4200 : 3200 : event.rolls?.length ? event.side==='party' ? 3600 : 2600 : 1800;

/** Backlog depth → stagger / motion soft-gate / cue & FX compression. Depth 1 stays readable; deeper stacks overlap hard. */
export function resolvePace(depth){
  const n=Math.max(1,depth|0);
  if(n<=1) return {stagger:380,motionScale:1,cueScale:1,revealAfter:null,fxScale:1,maxInFlight:1};
  if(n===2) return {stagger:200,motionScale:0.32,cueScale:0.7,revealAfter:160,fxScale:0.82,maxInFlight:3};
  if(n<=4) return {stagger:110,motionScale:0.1,cueScale:0.52,revealAfter:70,fxScale:0.68,maxInFlight:4};
  return {stagger:65,motionScale:0,cueScale:0.38,revealAfter:35,fxScale:0.55,maxInFlight:5};
}
const visibleAt = (sight, event, fogEnabled=fogOfWarEnabled) => !fogEnabled || event.side === "party" || sight.has(keyAt(event.x,event.y));

function visibleEvent(event,sight,fogEnabled) {
  const visible=visibleAt(sight,event,fogEnabled);
  if (!visible && !event.outcome) return null;
  if (visible) return {...event,visible};
  // An attack from fog may be shown without revealing the attacker or weapon.
  return {...event,name:"Unseen enemy",action:"Attack",visible:false,messages:[],
    rolls:(event.rolls ?? []).map(roll=>({...roll,label:"Attack roll"})),impacts:(event.impacts??[]).filter(impact=>sight.has(keyAt(impact.x,impact.y))),visual:null,visualPoint:null};
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

const CRIT_WORDS = {
  slashing: "CLEAVE!",
  piercing: "IMPALE!",
  bludgeoning: "CRUSH!",
  fire: "BLAZE!",
  cold: "SHATTER!",
  lightning: "CRACK!",
  thunder: "BOOM!",
  acid: "BURN!",
  poison: "TOXIC!",
  necrotic: "WITHER!",
  radiant: "FLARE!",
  force: "BLAST!",
  psychic: "MIND!",
};

const HIT_WORDS = {
  slashing: "SLASH",
  piercing: "STAB",
  bludgeoning: "SMASH",
  fire: "SCORCH",
  cold: "CHILL",
  lightning: "ZAP",
  thunder: "BOOM",
  acid: "HISS",
  poison: "VENOM",
  necrotic: "DRAIN",
  radiant: "FLARE",
  force: "BLAST",
  psychic: "MIND",
};

function eventDamageType(event) {
  return event.type || event.impacts?.find(impact => impact.type && !impact.healing)?.type || "";
}

/** Comic impact words only when the outcome has a clear punch — never for quiet casts/abilities. */
function impactWord(event) {
  const type = eventDamageType(event);
  if (event.outcome === "Critical hit") return CRIT_WORDS[type] ?? "CRIT!";
  if (event.outcome === "Miss") return event.blocked ? "BLOCKED" : "";
  if (event.outcome === "Hit") return HIT_WORDS[type] ?? "";
  if (event.kind === "heal" || event.impacts?.some(impact => impact.healing)) return "HEAL";
  if (event.kind === "fall") return "THUD";
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

export function createCombatCues({skipDice = false} = {}) {
  const feed=document.createElement("div");
  feed.className="game-event-feed";
  feed.setAttribute("role","log");
  feed.setAttribute("aria-label","Action messages");
  const dice=createDiceTheatre();
  let scope;
  let cursor = 0;
  let queue = [];
  let isRolling = false;
  let reactionHold = false;
  let inFlight = 0;
  let nextSlot = 0;
  let wakeTimer = 0;
  let view;
  const spellVisuals=createSpellVisuals(()=>view);
  const zoneVisuals=createZoneVisuals(()=>view);
  const damageEffects=createDamageEffects(()=>view);
  const activeCues = [];

  const hasDice = event => Boolean(event?.rolls?.some(roll => roll.dice?.length) && (event.kind !== "initiative" || event.side === "party"));
  const backlogDepth = () => queue.length + inFlight + (isRolling ? 1 : 0);
  function scheduleProcess(delay=0) {
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => { wakeTimer = 0; processQueue(); }, Math.max(0, delay));
  }
  function reactionAvailable(event) {
    if (!view?.canOfferReaction || reactionHold) return false;
    try { return Boolean(view.canOfferReaction(event)); } catch { return false; }
  }

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
    if (!view) return;
    const grid = view.grid.getBoundingClientRect(), origin = view.layer.getBoundingClientRect();
    const byActor = new Map();
    for (const cue of activeCues) {
      for (const entry of cue.impacts) {
        const key = entry.impact.actor ?? `${entry.impact.x}:${entry.impact.y}`;
        const list = byActor.get(key) ?? [];
        list.push({...entry, revealedAt: cue.revealedAt});
        byActor.set(key, list);
      }
    }
    for (const entries of byActor.values()) {
      const numbers = entries.filter(({impact}) => !impact.deathBanner);
      const deaths = entries.filter(({impact}) => impact.deathBanner);
      numbers.forEach(({element, impact, revealedAt}, index) => {
        const [x, y] = cellCenter(view.map, impact);
        // Vertical lane above the token — no sideways scatter into neighboring cues.
        const stack = index * 26;
        element.style.left = (grid.left - origin.left + x / view.map.width * grid.width) + "px";
        element.style.top = (grid.top - origin.top + y / view.map.height * grid.height - 28 - stack) + "px";
        element.style.zIndex = String(5 + index);
        if (element.parentElement !== view.layer) {
          element.style.animationDelay = (revealedAt - performance.now()) + "ms";
          view.layer.append(element);
        }
      });
      // Death banners sit in a reserved band above the number stack so they never cover floats.
      const numberBand = numbers.length ? 28 + (numbers.length - 1) * 26 + 36 : 20;
      deaths.forEach(({element, impact, revealedAt}, index) => {
        const [x, y] = cellCenter(view.map, impact);
        element.style.left = (grid.left - origin.left + x / view.map.width * grid.width) + "px";
        element.style.top = (grid.top - origin.top + y / view.map.height * grid.height - numberBand - index * 52) + "px";
        element.style.zIndex = String(8 + index);
        if (element.parentElement !== view.layer) {
          element.style.animationDelay = (revealedAt - performance.now()) + "ms";
          view.layer.append(element);
        }
      });
    }
  }

  function place() {
    spellVisuals.place();
    zoneVisuals.place();
    damageEffects.place();
    if (!view?.layer.isConnected || !activeCues.length) return;
    const board = view.frame.getBoundingClientRect();
    const origin = view.layer.getBoundingClientRect();
    const gap = 8;
    // Predictable action rail: stack along the board's right edge (newest on top).
    // Keeps messages off token damage/death floats and avoids scatter-dodge placement.
    const railMax = Math.min(238, Math.max(160, board.width * 0.34));
    let cursorY = board.top + gap;
    const ordered = [...activeCues].sort((a, b) => b.revealedAt - a.revealedAt);

    for (const cue of ordered) {
      const bubble = cue.element;
      bubble.dataset.layout = "rail";
      bubble.dataset.point = "";
      const width = Math.min(bubble.offsetWidth || railMax, railMax);
      const height = bubble.offsetHeight || 80;
      const left = board.right - width - gap;
      // Prefer hiding overflow over collapsing messages onto the same spot.
      if (cursorY + height > board.bottom - gap) {
        bubble.style.visibility = "hidden";
        continue;
      }
      bubble.style.visibility = "";
      bubble.style.left = left - origin.left + "px";
      bubble.style.top = cursorY - origin.top + "px";
      bubble.style.width = width + "px";
      if (typeof bubble.style.removeProperty === "function") bubble.style.removeProperty("--cue-tip");
      else delete bubble.style["--cue-tip"];
      cursorY += height + gap;
    }

    placeImpacts();
  }

  function reveal(event, pace=resolvePace(1)) {
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

    const visibleImpacts=(event.impacts??[]).filter(impact=>!view.fogEnabled||view.sight.has(keyAt(impact.x,impact.y)));
    damageEffects.play(visibleImpacts);
    const impacts = visibleImpacts.map(impact => {
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
      impacts.push({element,impact:{actor:death.actor,x:death.x,y:death.y,creatureSize:death.creatureSize??event.impacts?.find(impact=>impact.actor===death.actor)?.creatureSize,deathBanner:true}});
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
      {duration:matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : Math.min(260,160+100*pace.cueScale),easing:"cubic-bezier(.16,1,.3,1)"}
    );

    activeCues.push(cue);
    cue.timer = setTimeout(() => dismissCue(cue), Math.max(500, cueDuration(event) * pace.cueScale));
    place();
  }

  function releaseFlight() {
    inFlight = Math.max(0, inFlight - 1);
    processQueue();
  }

  function resolveOne(event) {
    const pace = resolvePace(backlogDepth());
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      reveal(event, pace);
      releaseFlight();
    };
    // Solo: wait for FX. Backlog: reveal on the early timer OR when FX ends first (incl. no-visual sync).
    spellVisuals.play(event, () => {
      if (pace.revealAfter == null || !settled) finish();
    }, {durationScale: pace.fxScale});
    if (pace.revealAfter != null && !settled) setTimeout(finish, pace.revealAfter);
  }

  function launchResolve(batch) {
    if (!batch.length) { processQueue(); return; }
    const pace = resolvePace(queue.length + inFlight + batch.length);
    nextSlot = performance.now() + pace.stagger;
    scheduleProcess(pace.stagger);
    batch.forEach((event, index) => {
      inFlight++;
      const offset = index * Math.min(70, Math.round(pace.stagger * 0.45));
      if (offset) setTimeout(() => resolveOne(event), offset);
      else resolveOne(event);
    });
  }

  function processQueue() {
    if (!view || !queue.length) return;
    if (isRolling) {
      if (!reactionHold && queue.some(hasDice)) dice.expedite();
      return;
    }

    const pace = resolvePace(backlogDepth());
    if (inFlight >= pace.maxInFlight) return;

    const next = queue[0];
    const slotWait = Math.max(0, nextSlot - performance.now());
    const motion = Math.max(view.motion?.remaining(next.actor) ?? 0, view.motion?.remaining(next.targetActor) ?? 0);
    const wait = Math.max(slotWait, motion * pace.motionScale);
    if (wait > 12) {
      scheduleProcess(wait);
      return;
    }

    // When dice FX are off (user toggle) or preview forces skip, go straight to cast videos.
    // Preview uses skipDice so it never mutates the player's wayfarer-dice-fx preference.
    if (skipDice || !dice.enabled || !hasDice(next)) {
      launchResolve([queue.shift()]);
      return;
    }

    // Batch simultaneous attacks from the same actor in this cycle (e.g. multiattack)
    const batch = [queue.shift()];
    while (queue.length > 0 && queue[0].actor === batch[0].actor && hasDice(queue[0]) && batch.length < 4) {
      batch.push(queue.shift());
    }

    isRolling = true;
    const hasMore = queue.some(hasDice) || backlogDepth() > 1;
    const offerEvent = batch.length === 1 ? batch[0] : {
      ...batch[0],
      action: batch.map(e => e.action).join(" & "),
      rolls: batch.flatMap(e => (e.rolls ?? []).map(r => ({
        ...r,
        label: (batch.length > 1 ? e.action + " · " : "") + (r.label || "Roll")
      }))),
      partyEvents: batch,
      healthChanges: batch.flatMap(e => e.healthChanges ?? []),
      impacts: batch.flatMap(e => e.impacts ?? []),
    };
    const reaction = reactionAvailable(offerEvent) ? {batch, event: offerEvent} : null;
    const finishRoll = () => {
      reactionHold = false;
      isRolling = false;
      launchResolve(batch);
    };
    const onReaction = (event, offer) => {
      reactionHold = true;
      view.onReactionPause?.(event, {
        resume: () => { if (!dice.isPlaying) return; dice.resume(); },
        showChoices: html => dice.showReactionChoices(html),
        batch: offer.batch,
      });
    };

    if (batch.length === 1) {
      dice.play(batch[0], finishRoll, hasMore, {reaction, onReaction});
    } else {
      dice.play(offerEvent, finishRoll, hasMore, {reaction, onReaction});
    }
  }

  function reset() {
    clearTimeout(wakeTimer);
    wakeTimer = 0;
    spellVisuals.stop();
    zoneVisuals.reset();
    damageEffects.reset();
    queue = [];
    isRolling = false;
    reactionHold = false;
    inFlight = 0;
    nextSlot = 0;
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
      spellVisuals.place();
      zoneVisuals.sync(view?.battle ?? null);
      damageEffects.place();
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
        const wasIdle = !queue.length && !inFlight && !isRolling;
        queue.push(...grouped);
        const dropped=queue.splice(0,Math.max(0,queue.length-16));
        for(const event of dropped) view.onReveal?.(event);
        cursor = latest;
        // A new burst after the queue drains should not inherit the previous stagger slot.
        if (wasIdle) nextSlot = 0;
        if (dice.isPlaying && !reactionHold && !dice.isReactionPaused && queue.some(hasDice)) {
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
      if (!skipDice && dice.enabled) {
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
    aimPreview(preview) { zoneVisuals.aimPreview(preview); },
    reset,
    get diceEnabled() {return !skipDice && dice.enabled;},
    toggleDice:() => dice.toggle(),
  };
}
