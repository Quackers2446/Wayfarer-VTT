import {keyAt} from "./combat.mjs";
import {escape} from "./format.mjs";
import {cellCenter} from "./map-grid.mjs";
import {createDiceTheatre} from "./dice-theatre.mjs";
import {fogOfWarEnabled} from "./game-settings.mjs";

const clamp = (value,min,max) => Math.min(Math.max(value,min),Math.max(min,max));
const visibleAt = (sight, event) => !fogOfWarEnabled || event.side === "party" || sight.has(keyAt(event.x,event.y));

function visibleEvent(event,sight) {
  const visible=visibleAt(sight,event);
  if (!visible && !event.outcome) return null;
  if (visible) return {...event,visible};
  // An attack from fog may be shown without revealing the attacker or weapon.
  return {...event,name:"Unseen enemy",action:"Attack",visible:false,messages:[],
    rolls:(event.rolls ?? []).map(roll=>({...roll,label:"Attack roll"})),impacts:[]};
}

function groupActions(events, sight) {
  const cues = [];
  for (const raw of events) {
    const event=visibleEvent(raw,sight);
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
  const bubble = document.createElement("div");
  bubble.className = "combat-cue";
  const feed=document.createElement("div");
  feed.className="game-event-feed";
  feed.setAttribute("role","log");
  feed.setAttribute("aria-label","Action messages");
  const dice=createDiceTheatre();
  let scope;
  let cursor = 0;
  let queue = [];
  let active;
  let view;
  let timer;
  let showing=false;
  let impacts=[];

  function appendFeed(events, pending=false) {
    for (const event of events) {
      const visible=visibleEvent(event,view.sight);
      if(!visible) continue;
      const item=Array.from(feed.children).find(item=>item.dataset.event===String(event.id)) ?? document.createElement("div");
      item.className="game-event-line";
      item.dataset.event=event.id;
      const heading=document.createElement("strong"),message=document.createElement("span");
      heading.textContent=visible.name+" · "+visible.action;
      const roll=visible.rolls?.find(roll=>roll.kept != null) ?? visible.rolls?.[0];
      message.textContent=pending && visible.rolls?.some(roll=>roll.dice?.length) ? "Rolling…" : [visible.outcome,roll ? roll.breakdown+" = "+roll.total : "",
        visible.messages?.at(-1) ?? (visible.damage ? visible.damage.damage+" damage" : "")].filter(Boolean).join(" · ");
      item.replaceChildren(heading,message);if(!item.parentElement) feed.append(item);
    }
    while(feed.childElementCount>3) feed.firstElementChild.remove();
  }

  function placeImpacts() {
    if(!view) return;
    const grid=view.grid.getBoundingClientRect(),origin=view.layer.getBoundingClientRect();
    for(const {element,impact} of impacts) {
      const [x,y]=cellCenter(view.map,impact);
      element.style.left=(grid.left-origin.left+x/view.map.width*grid.width)+"px";
      element.style.top=(grid.top-origin.top+y/view.map.height*grid.height)-22+"px";
      view.layer.append(element);
    }
  }

  function place() {
    if (!active || !showing || !view?.layer.isConnected) return;
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
    placeImpacts();
  }

  function reveal() {
    if(!active || !view) return;
    showing=true;
    appendFeed(active.partyEvents ?? [active]);
    bubble.innerHTML = cueText(active);
    bubble.dataset.side=active.side ?? "hostile";
    bubble.dataset.outcome=active.outcome ?? active.kind ?? "action";
    bubble.getAnimations().forEach(animation=>animation.cancel());
    view.layer.append(bubble);
    bubble.animate([{opacity:0,transform:"translateY(12px) scale(.92)"},{opacity:1,transform:"translateY(0) scale(1)"}],
      {duration:matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260,easing:"cubic-bezier(.16,1,.3,1)"});
    impacts=(active.impacts ?? []).filter(impact=>!fogOfWarEnabled || view.sight.has(keyAt(impact.x,impact.y))).map(impact=>{
      const element=document.createElement("div");
      element.className="token-impact-number"+(impact.healing ? " healing" : "")+(impact.critical ? " critical" : "");
      element.textContent=(impact.healing ? "+" : "−")+impact.amount+(impact.absorbed ? " · absorbed "+impact.absorbed : "")+(impact.defeated ? " · Defeated" : "");
      return {element,impact};
    });
    place();
    timer = setTimeout(playNext,active.rolls?.length || active.outcome ? 2600 : 1500);
  }

  function playNext() {
    impacts.forEach(({element})=>element.remove());impacts=[];
    bubble.remove();showing=false;
    active = queue.shift();
    if (!active || !view) return;
    // Enemy initiative is readable in the turn order; avoid a long opening queue.
    if(active.rolls?.some(roll=>roll.dice?.length) && (active.kind!=="initiative" || active.side==="party")) dice.play(active,reveal);
    else reveal();
  }

  function reset() {
    clearTimeout(timer);
    queue = [];
    active = view = undefined;
    showing=false;
    dice.stop();
    impacts.forEach(({element})=>element.remove());impacts=[];
    bubble.remove();
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
        clearTimeout(timer);
        queue = [];
        active = undefined;
        dice.stop();
        showing=false;
        bubble.remove();
        impacts.forEach(({element})=>element.remove());impacts=[];
        feed.remove();
        cursor = latest;
        return;
      }
      if(view.feed) view.feed.append(feed);
      if(!feed.childElementCount && latest===cursor) appendFeed(events.slice(-3));
      if (latest > cursor) {
        const fresh=events.filter(({id}) => id > cursor);
        appendFeed(fresh,true);
        queue.push(...groupActions(fresh,view.sight));
        queue=queue.slice(-12);
        cursor = latest;
      }
      if (active && showing) {
        view.layer.append(bubble);
        place();
      } else if (!active && queue.length) playNext();
    },
    place,
    reset,
    get diceEnabled() {return dice.enabled;},
    toggleDice:() => dice.toggle(),
  };
}
