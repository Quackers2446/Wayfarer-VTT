import {actorIsUp, currentActor, movementBudget, movementGroup, moveLeft} from "./combat.mjs";
import {escape} from "./format.mjs";
import {icon} from "./icons.mjs";
import {mapControls, mapHint, mapViewport} from "./map-camera.mjs";

function button(label, symbol, action, extra = "") {
  return `<button class="game-button" type="button" data-play="${action}" ${extra} ${extra.includes('aria-label=') ? '' : 'aria-label="'+escape(label)+'"'}>${symbol ? icon(symbol,17) : ""}<span class="game-button-label">${escape(label)}</span></button>`;
}

function portraits(party, selected, inCombat, controllers, controller, players, movers) {
  const names = new Map(players.map(({id,username}) => [id,username]));
  return party.length ? party.map((character, index) => {
    const name = escape(character.name);
    const id = escape(character.id);
    const initials = character.name.split(/\s+/).slice(0,2).map((word) => word[0]).join("");
    const hp = Math.max(0, Math.min(character.hp,character.maxHp));
    const owner = controllers?.[character.id];
    const mine = owner === controller;
    return `<div class="game-character ${character.id === selected?.id ? "game-character-current" : ""}">
      <button type="button" class="game-portrait" data-play="inspect" data-id="${id}" aria-label="Open character sheet for ${name}" title="${escape(character.name+' · '+character.hp+'/'+character.maxHp+' HP'+(owner ? ' · '+(mine ? 'Your character' : names.get(owner) ?? 'Claimed') : ''))}">
        <span class="game-avatar palette-${index%4}" aria-hidden="true">
          <span data-token-initial>${escape(initials)}</span><canvas data-creature-portrait="${id}" hidden></canvas>
        </span>
        <span class="game-character-info"><strong>${name}</strong><small>${character.hp} / ${character.maxHp} HP${character.tempHp ? " · +" + character.tempHp : ""}</small>
          <progress max="${character.maxHp}" value="${hp}" aria-label="${name} hit points"></progress>
          ${owner ? `<small>${mine ? "Your character" : escape(names.get(owner) ?? "Claimed")}</small>` : ""}
        </span>
      </button>
      ${(!inCombat || movers.includes(character)) && (!owner || mine) && actorIsUp(character) && selected?.id !== character.id
        ? button(inCombat ? "Move" : "Control","", "control-party", `data-id="${id}" aria-label="${inCombat ? "Select to move " + name : "Control"}"`) : ""}
      ${controllers && (!owner || mine) ? button(mine ? "Release" : "Claim","","claim-party",`data-id="${id}" aria-label="${mine ? "Release" : "Claim"} ${name}"`) : ""}
    </div>`;
  }).join("") : '<a class="game-link" href="#play">Add a party member</a>';
}

export function gameScreen({
  map, battle, selected, party, category, actions, tacticalTools, room, status, artworkNote,
  logOpen, toolsOpen, storyOpen, storyContent, rescueAvailable, canAct, controllers, controller,hotbar,resourceControls,
  destination, adventureName, hasToken, tableOpen, tableContent, shared, visibleInitiative, players = [],busy=false,actionPanelOpen=false,
}) {
  const active = battle.round > 0;
  const turn = currentActor(battle);
  const movers = movementGroup(battle);
  const reacting=Boolean(battle.classReaction);
  const movingEarly = active && selected && selected !== turn && !reacting;
  const enemyTurn = active && selected?.side === "hostile";
  const online = players.filter((player) => player.online).length;
  const remaining = selected && active ? moveLeft(battle,selected) : 0;
  const total = selected && active ? movementBudget(battle,selected) : 0;
  return `<section class="game-screen ${active ? "game-combat" : ""}" aria-label="Wayfarer game">
    <header class="game-top">
      <div class="game-location">
        <a href="#play" class="game-button game-exit">${icon("home",16)}<span>${shared ? "Leave" : "Setup"}</span></a>
        <span class="game-top-divider"></span>
        <div><h1>${escape(map.title)}</h1>${adventureName ? `<p>${escape(adventureName)}</p>` : ""}</div>
      </div>
      <div class="game-top-right">
        <span class="game-phase" aria-live="polite"><i></i>${active ? "Combat · Round " + battle.round : "Exploring"}</span>
        ${button(shared ? "Session" : "Multiplayer","users","game-table",`aria-pressed="${tableOpen}"${shared ?
          ` data-online="${online}" aria-label="Session" aria-description="${online} ${online === 1 ? "player" : "players"} online"` : ""}`)}
        ${button("Story","book","game-story",`aria-pressed="${storyOpen}"`)}
        ${button("Log","book","game-log",`aria-pressed="${logOpen}"`)}
        ${button("Tools","map","game-tools",`aria-pressed="${toolsOpen}"`)}
      </div>
    </header>
    <div class="game-middle">
      <aside class="game-party" aria-label="Party">
        <h2>Party</h2>
        <div class="game-roster">${portraits(party,selected,active,controllers,controller,players,movers)}</div>
      </aside>
      <div class="game-stage">
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
        <div class="game-event-slot"></div>
        <div class="game-board-meta">
          <div><p id="game-move-preview" class="game-move-preview">${escape(canAct && destination || '')}</p><p id="game-map-status" role="status">${escape(status || room?.entry?.name || artworkNote)}</p>${mapHint()}</div>
          ${mapControls(hasToken)}
        </div>
        ${logOpen ? `<aside class="game-flyout play-panel" aria-label="Combat log"><h2>Combat log</h2>
          ${battle.log.length ? `<ol class="play-log">${battle.log.slice(-25).reverse().map((entry) => "<li>"+escape(entry)+"</li>").join("")}</ol>` : '<p>No rolls recorded.</p>'}
        </aside>` : ""}
        ${storyOpen ? `<aside class="game-flyout play-panel story-flyout" aria-label="Story journal">${storyContent}</aside>` : ""}
        ${toolsOpen ? `<aside class="game-flyout tools-flyout play-panel" aria-label="Table tools">${tacticalTools}</aside>` : ""}
        ${tableOpen ? `<aside class="game-flyout tools-flyout play-panel session-panel" aria-label="Multiplayer">${tableContent}</aside>` : ""}
      </div>
      ${shared ? '<div class="game-chat-slot"></div>' : ""}
    </div>
    <footer class="game-hud" aria-busy="${busy}">
      <div class="game-hud-top">
        <div class="game-active">
          <span class="game-label">${reacting ? "Reaction · Deflect Missiles" : enemyTurn ? "Enemy turn · game controlled" : movingEarly ? "Shared initiative · move" : active ? "Current turn" : "Selected character"}</span>
          <strong>${escape(selected?.name ?? "Choose a party member")}</strong>
          ${selected?.concentration ? `<span class="game-label">Concentrating · ${escape(selected.concentration.name)}</span>` : ""}
        </div>
        ${enemyTurn ? "" : `<div class="game-move" ${active ? 'aria-label="Movement budget"' : ""}>
          ${active ? `<span><strong>${remaining} ft</strong> left / ${total} ft</span>
          <progress value="${Math.min(Math.max(1,total), remaining)}" max="${Math.max(1,total)}" aria-label="Movement remaining"></progress>` :
            '<strong>Free movement</strong>'}
        </div>`}
        ${!enemyTurn && !movingEarly ? resourceControls : ''}
        ${active && !enemyTurn && !movingEarly && !reacting ? button("End turn","check","end",battle.movement || !canAct ? "disabled" : "") : ""}
      </div>
      <div class="game-hud-body">
        ${canAct && !battle.movement && !movingEarly && !reacting && selected?.hp>0 ? hotbar : ''}
        <div class="game-action-content"${actionPanelOpen ? ' role="region" aria-label="Selected action controls"' : ' hidden'}>
          ${rescueAvailable ? button("Free Sildar","users","rescue-sildar") : ""}
          ${actions}
        </div>
      </div>
    </footer>
  </section>`;
}
