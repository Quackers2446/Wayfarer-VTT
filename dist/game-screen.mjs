import {canTakeTurn, sharedTurnGroup, actorIsUp, concentrationRemaining, currentActor, movementBudget, movementGroup, moveLeft} from "./combat.mjs";
import {escape} from "./format.mjs";
import {icon} from "./icons.mjs";
import {mapControls, mapHint, mapViewport} from "./map-camera.mjs";
import {actorPartyId, ensureParties, partyLabel} from "./parties.mjs";

function button(label, symbol, action, extra = "") {
  return `<button class="game-button" type="button" data-play="${action}" ${extra} ${extra.includes('aria-label=') ? '' : 'aria-label="'+escape(label)+'"'}>${symbol ? icon(symbol,17) : ""}<span class="game-button-label">${escape(label)}</span></button>`;
}

function portraits(party, selected, inCombat, controllers, controller, players, movers, parties) {
  const names = new Map(players.map(({id,username}) => [id,username]));
  const multi = (parties?.length || 0) > 1;
  if (!party.length) return '<a class="game-link" href="#play">Add a party member</a>';
  const groups = multi
    ? (parties || []).map(group => ({...group, members: party.filter(character => actorPartyId(character) === group.id)})).filter(group => group.members.length)
    : [{id: 'all', name: '', members: party}];
  return groups.map(group => `${group.name ? `<h3 class="game-party-group">${escape(group.name)}</h3>` : ""}${group.members.map((character, index) => {
    const name = escape(character.name);
    const id = escape(character.id);
    const initials = character.name.split(/\s+/).slice(0,2).map((word) => word[0]).join("");
    const hp = Math.max(0, Math.min(character.hp,character.maxHp));
    const allyNpc = Boolean(character.kennelAlly);
    const owner = controllers?.[character.id];
    const mine = owner === controller;
    const selectable=!allyNpc&&(!owner||mine)&&actorIsUp(character)&&(!inCombat||movers.includes(character));
    const selectedHere=character.id===selected?.id;
    const hint=allyNpc?'Pack ally — acts automatically.':selectable?'Click to select. Double-click to open sheet.':'Double-click to open sheet.';
    return `<div class="game-character ${character.id === selected?.id ? "game-character-current" : ""}">
      <button type="button" class="game-portrait" id="game-portrait-${id}" data-play="party-portrait" data-id="${id}"
        aria-label="${selectable?'Select':'Inspect'} ${name}" aria-pressed="${selectedHere}" aria-keyshortcuts="Shift+Enter"
        title="${escape(hint+' · '+character.hp+'/'+character.maxHp+' HP'+(allyNpc ? ' · Ally (AI)' : owner ? ' · '+(mine ? 'Your character' : names.get(owner) ?? 'Claimed') : ''))}">
        <span class="game-avatar palette-${index%4}" aria-hidden="true">
          <span data-token-initial>${escape(initials)}</span><canvas data-creature-portrait="${id}" hidden></canvas>
        </span>
        <span class="game-character-info"><strong>${name}</strong><small>${character.hp} / ${character.maxHp} HP${character.tempHp ? " · +" + character.tempHp : ""}</small>
          <progress max="${character.maxHp}" value="${hp}" aria-label="${name} hit points"></progress>
          ${allyNpc
            ? `<small>Ally (AI)</small>`
            : owner
            ? `<small>${mine ? "Your character" : escape(names.get(owner) ?? "Claimed")}</small>`
            : (controllers ? `<small>Unclaimed</small>` : "")}
          ${multi ? `<small class="game-party-tag">${escape(partyLabel(actorPartyId(character)))}</small>` : ""}
        </span>
      </button>
      ${selectable && !selectedHere
        ? button("Control","", "control-party", `data-id="${id}" aria-label="${inCombat ? "Control " + name : "Control"}"`) : ""}
      ${!allyNpc && controllers && (!owner || mine) ? button(mine ? "Release" : "Claim","","claim-party",`data-id="${id}" aria-label="${mine ? "Release" : "Claim"} ${name}"`) : ""}
    </div>`;
  }).join("")}`).join("");
}

function activityLog(history,mode) {
  const expanded=mode==='expanded',collapsed=mode==='collapsed';
  return `<aside class="game-event-slot" data-log-mode="${mode}" aria-label="Activity log">
    <header class="game-event-header">
      <button type="button" class="event-log-toggle" data-play="event-log-toggle" aria-controls="game-event-body" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Show activity log' : 'Minimize activity log'}">${icon('book',14)}<span>Activity log</span>${icon('down',12)}</button>
      <button type="button" class="event-log-size" data-play="event-log-expand" aria-controls="game-event-body" aria-pressed="${expanded}" aria-label="${expanded ? 'Compact activity log' : 'Expand activity log'}" title="${expanded ? 'Compact log' : 'Expand log'}">${icon(expanded ? 'minus' : 'fit',15)}</button>
    </header>
    <div id="game-event-body" class="game-event-body" tabindex="0" aria-label="Log history" ${collapsed ? 'hidden' : ''}>
      <div class="game-live-log" ${expanded ? 'hidden' : ''}></div>
      <ol class="game-complete-log" aria-label="Combat log" ${expanded ? '' : 'hidden'}>${history.length ? history.map(line=>'<li>'+escape(line)+'</li>').join('') : '<li>No actions recorded yet.</li>'}</ol>
    </div>
  </aside>`;
}

export function gameScreen({
  map, battle, roomName, saveStatus, selected, party, category, actions, tacticalTools, status,
  logOpen, logHistory=battle.log, eventLogMode="compact", eventLogPlacement="separate", toolsOpen, storyOpen, storyContent, rescueAvailable, hubActions=[], canAct, controllers, controller,hotbar,resourceControls,
  destination, adventureName, hasToken, tableOpen, tableContent, shared, partyOpen=false,partyContent='',restOpen=false,restContent='',chatOpen=false, visibleInitiative, players = [],busy=false,actionPanelOpen=false,
  defeated=false, pvpLeave=false, truceVoted=false,
  compact=false, actionsSheetOpen=true, aiming=false, aimMessage="",
}) {
  const active = battle.round > 0;
  const turn = currentActor(battle);
  const movers = movementGroup(battle);
  const reacting=Boolean(battle.classReaction);
  const movingEarly = active && selected && !canTakeTurn(battle,selected) && !reacting;
  const enemyTurn = active && selected?.side === "hostile";
  const online = players.filter((player) => player.online).length;
  const remaining = selected && active ? moveLeft(battle,selected) : 0;
  const total = selected && active ? movementBudget(battle,selected) : 0;
  const parties = ensureParties(battle);
  const multiParty = parties.length > 1;
  const menuOpen = tableOpen || partyOpen || restOpen || storyOpen || toolsOpen || chatOpen || logOpen;
  const chromeButtons = [
    button(shared ? "Session" : "Multiplayer","users","game-table",`aria-pressed="${tableOpen}"${shared ?
      ` data-online="${online}" aria-label="Session" aria-description="${online} ${online === 1 ? "player" : "players"} online"` : ""}`),
    button("Party","users","game-party",`aria-pressed="${partyOpen}"`),
    button("Rest","heart","game-rest",`aria-expanded="${restOpen}"`),
    button("Story","book","game-story",`aria-pressed="${storyOpen}"`),
    button(eventLogPlacement === "chat" ? "Chat & log" : "Chat","chat","game-chat",`aria-pressed="${chatOpen}"`),
    eventLogPlacement === "chat" ? "" : button("Log","book","game-log",`aria-pressed="${logOpen}"`),
    button("Tools","map","game-tools",`aria-pressed="${toolsOpen}"`),
  ].filter(Boolean).join("");
  return `<section class="game-screen ${active ? "game-combat" : ""}${defeated ? " game-defeated-active" : ""}${compact ? " game-compact" : ""}${actionsSheetOpen ? " game-actions-open" : ""}${aiming ? " game-aiming" : ""}" aria-label="Wayfarer game">
    <header class="game-top">
      <div class="game-location">
        <a href="#play" class="game-button game-exit" aria-label="${shared ? "Rooms" : "Setup"}">${icon("home",16)}<span>${shared ? "Rooms" : "Setup"}</span></a>
        <span class="game-top-divider"></span>
        <div><h1>${escape(roomName || map.title)}</h1>${roomName || adventureName ? `<p>${escape(roomName ? map.title : adventureName)}</p>` : ""}</div>
      </div>
      <div class="game-top-right">
        ${shared ? `<span class="game-save-status" role="status">${escape(saveStatus || 'Saved')}</span>` : ''}
        <span class="game-phase" aria-live="polite"><i></i>${active ? (battle.combatKind === 'pvp' ? "PvP · Round " : "Combat · Round ") + battle.round : "Exploring"}</span>
        ${shared ? `<div class="game-voice-slot"></div>` : ""}
        <div class="game-top-chrome">${chromeButtons}</div>
        <details class="game-top-menu"${menuOpen ? " open" : ""}>
          <summary class="game-button" aria-label="Menu">${icon("map",16)}<span class="game-button-label">Menu</span></summary>
          <div class="game-top-menu-panel" role="menu">${chromeButtons}</div>
        </details>
      </div>
    </header>
    <div class="game-middle">
      <aside class="game-party" aria-label="Party">
        <h2>${multiParty ? "Parties" : "Party"}</h2>
        <div class="game-roster">${portraits(party,selected,active,controllers,controller,players,movers,parties)}</div><button type="button" class="game-party-add game-button" data-play="game-party" aria-label="Add characters to party">+ Add</button>
      </aside>
      <div class="game-stage">
        ${shared ? `<div class="game-voice-channel-slot"></div>` : ""}
        ${active ? `<div class="game-initiative" aria-label="Initiative order">${battle.order.filter((id) => !visibleInitiative || visibleInitiative.has(id)).map((id) => {
          const actor = battle.actors.find((entry) => entry.id === id);
          return actor ? `<span class="game-turn ${actor.id === turn?.id ? "game-turn-current" : movers.includes(actor) ? "game-turn-shared" : ""} ${actor.side === "hostile" ? "game-turn-hostile" : ""}"
            title="${escape(actor.name)}"><span class="game-turn-portrait" aria-hidden="true">
              <span data-token-initial>${escape(actor.marker ?? actor.name.charAt(0))}</span>
              <canvas data-creature-portrait="${escape(actor.id)}" hidden></canvas>
            </span><small>${actor.initiativeRoll}</small></span>` : "";
        }).join("")}</div>` : ""}
        ${mapViewport(map,true)}
        <div class="combat-cues" aria-live="polite" aria-atomic="true"></div>
        <div class="game-board-meta">
          <div><p id="game-move-preview" class="game-move-preview">${escape(canAct && destination || '')}</p><p id="game-map-status" role="status">${escape(status)}</p>${mapHint()}</div>
          ${mapControls(hasToken)}
        </div>
        ${storyOpen ? `<aside class="game-flyout story-flyout" aria-label="Story journal">${storyContent}</aside>` : ""}
        ${restOpen ? `<aside class="game-flyout rest-flyout" aria-label="Party rest">${restContent}</aside>` : ""}
        ${toolsOpen ? `<aside class="game-flyout tools-flyout" aria-label="Table tools">${tacticalTools}</aside>` : ""}
        ${partyOpen ? `<aside class="game-flyout tools-flyout party-flyout" aria-label="Party management">${partyContent}</aside>` : ""}
        ${tableOpen ? `<aside class="game-flyout tools-flyout session-panel" aria-label="Multiplayer">${tableContent}</aside>` : ""}
      </div>
      <div class="game-social-dock" aria-label="Messages and activity">
        <div class="game-activity-home" data-activity-placement="${eventLogPlacement}">${activityLog(logHistory,eventLogMode)}</div>
        <div class="game-chat-slot"></div>
      </div>
    </div>
    ${compact && aiming && aimMessage && !actionsSheetOpen ? `<div class="game-aim-banner" role="status" aria-live="polite">
      <p>${escape(aimMessage)}</p>
      <div class="game-aim-actions">
        <button type="button" class="game-button" data-play="actions-back" aria-label="Back to actions">${icon("plus",15)}<span>Actions</span></button>
        <button type="button" class="game-button" data-play="hotbar-cancel" aria-label="Cancel action">${icon("close",15)}<span>Cancel</span></button>
      </div>
    </div>` : ""}
    <footer class="game-hud" aria-busy="${busy}">
      <div class="game-hud-top">
        <div class="game-active">
          <span class="game-label">${reacting ? "Reaction · Deflect Missiles" : enemyTurn ? "Enemy turn · game controlled" : movingEarly ? "Waiting for next turn" : active ? sharedTurnGroup(battle).length>1 ? "Shared turn" : "Current turn" : "Selected character"}</span>
          <strong>${escape(selected?.name ?? "Choose a party member")}</strong>
          ${(() => {
            const conc = selected ? concentrationRemaining(battle, selected) : null;
            if (!conc) return "";
            const left = conc.rounds > 0 ? ` · ${conc.rounds} round${conc.rounds === 1 ? "" : "s"} left` : " · expiring";
            return `<span class="game-label">Concentrating · ${escape(conc.name)}${left}</span>`;
          })()}
        </div>
        ${enemyTurn ? "" : `<div class="game-move" ${active ? 'aria-label="Movement budget"' : ""}>
          ${active ? `<span><strong>${remaining} ft</strong> left / ${total} ft</span>
          <progress value="${Math.min(Math.max(1,total), remaining)}" max="${Math.max(1,total)}" aria-label="Movement remaining"></progress>` :
            '<strong>Free movement</strong>'}
        </div>`}
        ${!enemyTurn && !movingEarly && (!compact || actionsSheetOpen) ? resourceControls : ''}
        ${compact && canAct && !battle.movement && !movingEarly && !reacting && selected?.hp>0 && !actionsSheetOpen
          ? `<button type="button" class="game-button game-actions-toggle" data-play="actions-open" aria-expanded="false">${icon("plus",16)}<span>Actions</span></button>` : ""}
        ${pvpLeave ? `<button class="game-button game-leave-combat" type="button" data-play="leave-combat" aria-label="${truceVoted ? 'Truce offered' : 'Leave combat'}" title="PvP ends when every player in the scrap agrees" ${busy || battle.movement || reacting ? "disabled" : ""}>${icon("users",17)}<span>${truceVoted ? "Truce offered…" : "Leave combat"}</span></button>` : ""}
        ${active && !enemyTurn && !movingEarly && !reacting ? `<button class="game-button game-end-turn" type="button" data-play="end" aria-label="End turn" aria-keyshortcuts="Space" title="End turn (Space)" ${battle.movement || !canAct || busy ? "disabled" : ""}>${icon("check",17)}<span>End turn</span><kbd aria-hidden="true">Space</kbd></button>` : ""}
      </div>
      <div class="game-hud-body">
        ${canAct && !battle.movement && !movingEarly && !reacting && selected?.hp>0 && actionsSheetOpen ? `
          <div class="game-actions-sheet" aria-label="Character actions">
            ${compact ? `<header class="game-actions-sheet-head">
              <strong>${escape(selected?.name ?? "Actions")}</strong>
              <button type="button" class="game-button" data-play="actions-close" aria-label="Close actions">${icon("close",15)}<span>Close</span></button>
            </header>` : ""}
            ${hotbar}
          </div>` : ""}
        <div class="game-action-content"${actionPanelOpen && (rescueAvailable || hubActions.length || actions?.trim?.()) ? ' role="region" aria-label="Selected action controls"' : ' hidden'}>
          ${rescueAvailable || hubActions.length ? `<div class="hub-action-stack">${
            (rescueAvailable ? button("Free Sildar","users","rescue-sildar") : "") +
            hubActions.map((entry) => button(entry.label, "flag", "hub-action", `data-id="${escape(entry.id)}"`)).join("")
          }</div>` : ""}
          ${actions}
        </div>
      </div>
    </footer>
    ${defeated ? `<div class="game-defeated" role="dialog" aria-modal="true" aria-labelledby="game-defeated-title">
      <div class="game-defeated-card">
        <h2 id="game-defeated-title">Defeated</h2>
        <p>The party can no longer continue.</p>
        <div class="game-defeated-actions">
          <button type="button" class="game-button game-defeated-retry" data-play="try-again">Try again</button>
          <button type="button" class="game-button" data-play="continue-defeated">Continue</button>
        </div>
      </div>
    </div>` : ""}
  </section>`;
}
