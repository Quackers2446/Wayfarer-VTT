import {upgradeOpenedRoom, upgradeRoomState} from './room-upgrades.mjs';
import {applyHestiasFury} from './hestias-fury.mjs';
import './custom-select.mjs';
import {loadRestEncounters,restTableChoices,restPolicy,restRiskSummary,restBlocked,takeDungeonRest} from './dungeon-rests.mjs';
import { loadSpellRules, setSpellRuleContext, customSpellRule } from './spell-rule-store.mjs';
import { customSpellCells, moveCustomSphere, fireZoneBeam } from './custom-spells.mjs';
import { directional, needsEndpoint } from './spell-shapes.mjs';
import { allowsWallRing, formRule } from './spell-animation-library.mjs';
import { armReaction, disarmReaction, isArmed, reactionSpells, canOfferManualReaction, manualReactionOptions, resolveManualReaction } from './reactions.mjs';
import { resetSceneBoard } from "./board-reset.mjs";
import { commitRoomState, normalizeRoomState, roomBattle, travelRoom, travelExpedition, roomMapChoices } from "./room-state.mjs";
import { hubActions, isYpHub, runHubAction, seedYpHubScene, ypDefaultMap } from "./hub-quests.mjs";
import { HUB_TABLES, tickHubAmbience } from "./hub-ambience.mjs";
import {
  betrayKennelPack, checkKennelApproach, followKennelAllies, kennelActions, pullAlertedDen, runKennelAction, seedKennelWolves,
} from "./kennel-wolves.mjs";
import { checkLookoutFlood } from "./cragmaw-flood.mjs";
import { prepareMonsterRewards } from "./encounter-rewards.mjs";
import { withinReach, takeLoot, lootContents, carryBody, dragBody, dropBody, placeBody, syncRewardSheets, bodyWeight, initializeTreasure, releaseRevivedBodies, searchRegion, investigateFeature, useFeature, featureCardModel, applyPassiveFeatureHints, triggerFeaturesAt, recordFeatureDiscovery } from "./world-interactions.mjs";
import { featuresInRegion, visibleFeaturePips, setFeatureState, syncMarkerForFeature } from "./room-features.mjs";
import { createFloatingPanels } from "./floating-panels.mjs";
import { createWallEditor } from './wall-editor.mjs';
import { applyBakedWalls } from './baked-walls.mjs';
import { clearApiKey } from './ai-forecast.mjs';
import { fogSettings, visionSettings, viewerVision, viewerMemory } from './dynamic-fog.mjs';
// Temporarily disable Gemini wall forecast — wipe any remembered browser key.
try { clearApiKey(); } catch { /* ignore */ }
import { knownRooms, forgetRoom, rememberRoom, rememberRooms, roomList } from './adventure-rooms.mjs';
import { turnView, canTakeTurn, sharedTurnGroup, turnBudgetStamp } from './combat.mjs';
import { creatureSize, tokenSize, actorCells, containsCell, touchesArea } from './actor-space.mjs';
import { drawMonsterArtwork, monsterArtwork } from "./monster-art.mjs";
import { characterTokenArtwork, localTokenBlob, paintCharacterPortraits, tokenPortrait, uploadSessionToken } from "./character-token.mjs";
import { enrichCharacter } from "./character-rules.mjs";
import { characterProfile, initials } from "./character-view.mjs";
import { alignArtwork, artworkFitIsDefault, defaultSquareFeet, fitsCurrentGrid, gridGeometry, migrateGridState, normalizeArtworkFit } from "./map-grid.mjs";
import { areaKey, populateScene, rosterTokens } from "./scene-populate.mjs";
import { applyMapTemplate, loadMapTemplate } from "./map-templates.mjs";
import { gameScreen } from "./game-screen.mjs";
import { createHealthPresentation } from "./health-presentation.mjs";
import { createCombatCues } from "./combat-cues.mjs";
import { playCombatVictory, shouldPlayCombatVictory } from "./combat-victory.mjs";
import { createSpeechBubbles } from "./speech-bubbles.mjs";
import { createTokenHover } from "./token-hover.mjs";
import { createTokenMotion } from './token-motion.mjs';
import { createGameChat } from "./game-chat.mjs";
import { createSpatialVoice } from "./spatial-voice.mjs";
import { withActionEvent } from "./action-events.mjs";
import { fogOfWarEnabled } from "./game-settings.mjs";
import { buildActionBar, entryReason, hotbarDetailModel, renderActionBar, renderActionResources, toggleHotbarFilter, parseHotbarFilters } from "./action-bar.mjs";
import { classActions, classSkillCheck, classWeapons, migratePactResources, shortRestsLeft, syncClassResources, useClassAction } from "./class-actions.mjs";
import { canRescue, createStoryToasts, discoverStory, rescueSildar, storyPanel, storyVersion } from "./adventure-story.mjs";
import { enemyTurnPending, runEnemyTurns } from "./enemy-turn.mjs";
import { DOMINATE_ORDERS, issueDominateCommand, seizeDominateControl } from "./dominate.mjs";
import { enemyInSight, engageEnemy, noticesEnemy, partyDefeated, partyEscaped, partyVision, rememberVision } from "./exploration.mjs";
import {
  DEFAULT_PARTY_ID, MAX_PARTY_SIZE, actorPartyId, assignParty, canCreateParty, createParty, ensureParties,
  isAttackablePc, isCombatFoe, isPvpCombat, partyFull, partyLabel, partyMembers, sameParty
} from "./parties.mjs";
import { exploredCells, hasExplored, saveExplored, forgetExploration } from "./fog-memory.mjs";
import { addDoor, addWall, doorAt, mapFloor, mapWalls, removeDoor, removeWall, segKey, toggleDoor } from "./map-walls.mjs";
import { escape, plural, signed, text } from "./format.mjs";
import { icon } from "./icons.mjs";
import { attachArchive, archiveName, formatEntries, hasArchive, hostedMapImage, mapImage, monsterRecord } from "./rules-library.mjs";
import { cellCenter, creatureActor, isBuiltinModule, moduleMaps, moduleMapsOrBuiltin, partyActor, regionAt, regionCells, resolveExpeditionMap, roomNotes, roomRoster, startingRegion, trainingActors, trainingMap } from "./encounters.mjs";
import { cellsNearSpawn, createSpawnMarker, findSpawn, removeSpawnMarker, spawnMarkers } from "./spawn-points.mjs";
import { listHomebrew } from "./homebrew-store.mjs";
import { monsterStatBlock } from "./homebrew-schema.mjs";
import { defeatedCreature, drawGrid, gridPosition, nearestGridEdge, terrainAt } from "./grid-view.mjs";
import { createCamera, mapControls, mapHint, mapViewport } from "./map-camera.mjs";
import {
  listRooms, deleteRoom, artworkURL, createSession, inviteURL, joinPanel, readSession, recentSession, rememberedHubSession, rememberedUsername, sessionCode, sessionHash,
  syncSessionPlayers, tablePanel, writeSession
} from "./multiplayer.mjs";
import {
  actorIsUp, applyDamage, armorClass, breathTypes, castSpell, checkSpellTethers, condition, currentActor, deathSave, diceTerms, distanceFt, drinkPotion, helpUp, throwHealingPotion,
  endConcentration, endInitiative, endTurn, fallingDamage, hasFeature, incapacitated, joinInitiative, keyAt, moveLeft,
  approachForStrike, exploreToken, heal, lineClear, log, movementGroup, moveToken, newBattle, occupies, opportunity, placeToken, canStand, previewMovement, recordSpell, resolveDeflection, resolveOpportunity, requestTruce, rollDice,
  rollStrike, sneakAttackStatus, slotRank, spellCells, spellTargetCount, startInitiative, supportedSpell, sustainWitchBolt, turnAction, wakeCreature,
} from "./combat.mjs";

const saveKey = "wayfarer-encounters-v1";
const defaultPageTitle = document.title;
let battles;
try { battles = JSON.parse(localStorage.getItem(saveKey)) || {}; } catch { battles = {}; }
const previewKey='wayfarer-preview-room-v2';
let previewState;try{previewState=JSON.parse(localStorage.getItem(previewKey));}catch{}
let maps = [trainingMap];
let moduleId = "training";
let map = trainingMap;
let context;
let selectedId = "";
let lastPortraitClick;
let targetId = "";
let combatChoice = "";
let battle;
let room;
let art;
let cursor;
let tool = "room";
let pending = false;
let revision = 0;
let status = "";
let diceResult = "";
let lastAdventure;
let diceFormula = "1d20";
let cover = "";
let rollMode = "";
let customWeapon = { name: "Custom strike", bonus: "", damage: "", type: "", normalRange: "", reach: "" };
let selectedCreature = 0;
let selectedHomebrew = 0;
let selectedParty = "";
let camera;
let focusedGameMap;
let artworkRequest;
let artworkLoading = false;
let artworkNote = "";
let customArtwork;
let sessionConnectingTimer = 0;
let table;
let tableOpen = false;
let partyOpen = false;
let restOpen=false;
let defeatedDismissed = false;
let tableMessage = "";
let needsHostSignIn = false;
let showInvitation;
let category = "move";
let hotbarTab = "all", hotbarFilter = "", hotbarSearch = "", hotbarSelection = "", hotbarActor = "", hotbarExpanded = false, hotbarTools = false;
/** Mobile/compact: actions sheet opens from character select; closes when aiming. */
let actionsSheetOpen = false;
function compactPlayUi() {
  return typeof matchMedia === "function" && matchMedia("(max-width: 820px)").matches;
}
let compactUiMatch = compactPlayUi();
if (typeof matchMedia === "function") {
  const compactQuery = matchMedia("(max-width: 820px)");
  const onCompactChange = () => {
    const next = compactQuery.matches;
    if (next === compactUiMatch) return;
    compactUiMatch = next;
    if (!next) actionsSheetOpen = false;
    if (context?.game && root()) redraw();
  };
  if (typeof compactQuery.addEventListener === "function") compactQuery.addEventListener("change", onCompactChange);
  else compactQuery.addListener?.(onCompactChange);
}
let eventLogMode = 'compact';
try { const saved = localStorage.getItem('wayfarer-log-mode-v1'); if (['compact', 'expanded', 'collapsed'].includes(saved)) eventLogMode = saved; } catch { }
let eventLogPlacement = 'chat';
try {
  const saved = localStorage.getItem('wayfarer-activity-placement-v2');
  if (['separate', 'chat', 'hidden'].includes(saved)) eventLogPlacement = saved;
} catch { }
function setActivityPlacement(value) {
  eventLogPlacement = value;
  try { localStorage.setItem('wayfarer-activity-placement-v2', value); } catch { }
  redraw();
}
const eventLogScroll = new Map(); let eventLogScope;
function setEventLogMode(mode) {
  eventLogMode = mode;
  try { localStorage.setItem('wayfarer-log-mode-v1', mode); } catch { }
}
function logRows(panel) {
  return [...(panel.querySelector(panel.dataset.logMode === 'expanded' ? '.game-complete-log' : '.game-event-feed')?.children ?? [])];
}
function rememberEventLogScroll() {
  const panel = root()?.querySelector('.game-event-slot'), body = panel?.querySelector('.game-event-body');
  if (!body || !body.getClientRects().length || panel.dataset.logMode === 'collapsed') return;
  const rows = logRows(panel), rect = body.getBoundingClientRect(), index = rows.findIndex(row => row.getBoundingClientRect().bottom > rect.top);
  eventLogScroll.set(panel.dataset.logMode, {
    top: body.scrollTop, bottom: body.scrollHeight - body.clientHeight - body.scrollTop < 24,
    keys: rows.map(row => row.dataset.event ?? row.textContent), index, offset: index < 0 ? 0 : rows[index].getBoundingClientRect().top - rect.top
  });
}
function restoreEventLogScroll() {
  const panel = root()?.querySelector('.game-event-slot'), body = panel?.querySelector('.game-event-body'), saved = eventLogScroll.get(eventLogMode);
  if (!body || body.hidden || !body.getClientRects().length) return;
  if (!saved || saved.bottom) { body.scrollTop = body.scrollHeight; return; }
  const rows = logRows(panel), keys = rows.map(row => row.dataset.event ?? row.textContent);
  let index = keys.indexOf(saved.keys[saved.index]);
  if (eventLogMode === 'expanded') {
    // The engine bounds history; preserve the visible entry when older lines fall off the front.
    for (let removed = 0; removed < saved.keys.length; removed++) {
      const shared = Math.min(saved.keys.length - removed, keys.length);
      if (shared && saved.keys.slice(removed, removed + shared).every((key, i) => key === keys[i])) { index = saved.index - removed; break; }
    }
  }
  if (index >= 0 && rows[index]) body.scrollTop += rows[index].getBoundingClientRect().top - body.getBoundingClientRect().top - saved.offset;
  else body.scrollTop = saved.top;
}

let toolsOpen = false;
let storyOpen = false;
const storyToasts = createStoryToasts();
let scheduledEnemyBattle;
const combatCues = createCombatCues();
const speechBubbles = createSpeechBubbles();
let ambientTimer = 0;
let reactionPause = null;

function scheduleHubAmbience() {
  clearTimeout(ambientTimer);
  if (!context?.game || !isYpHub(map) || battle?.round) return;
  ambientTimer = setTimeout(() => {
    if (!context?.game || !isYpHub(map) || battle?.round || document.hidden) {
      scheduleHubAmbience();
      return;
    }
    const bark = tickHubAmbience(battle, map, battle.actors.filter((actor) => actor.side === "party"));
    if (bark?.actorId) speechBubbles.say(bark.actorId, bark.lines, { name: bark.name });
    scheduleHubAmbience();
  }, 4500);
}
let localChat;
let revealHudTimer = 0;
let revealPaintFrame = 0;

function openReactionPause(event, resume, showChoices) {
  const choices = () => manualReactionOptions(battle, event, {canControl, map});
  const render = (message = '') => {
    const options = choices();
    const rows = options.map(option =>
      `<button type="button" class="dice-reaction-choice" data-reaction-id="${escape(option.id)}">` +
      `<strong>${escape(option.actorName)}</strong> · ${escape(option.name)}` +
      (option.level ? ` <span class="dice-reaction-slot">slot ${option.slot}</span>` : '') +
      `<small>${escape(option.note)}</small></button>`
    ).join('');
    showChoices(
      `<div class="dice-reaction-menu">` +
      `<p>${escape(message || 'Choose a reaction, then combat continues.')}</p>` +
      (rows || '<p class="dice-reaction-empty">No reactions available right now.</p>') +
      `<button type="button" class="dice-reaction-continue">Continue without reacting</button>` +
      `</div>`
    );
    const panel = document.querySelector('.dice-reaction-panel');
    panel?.querySelector('.dice-reaction-continue')?.addEventListener('click', () => {
      reactionPause = null;
      resume();
    }, {once: true});
    for (const button of panel?.querySelectorAll('.dice-reaction-choice') ?? []) {
      button.addEventListener('click', () => {
        const option = options.find(entry => entry.id === button.dataset.reactionId);
        if (!option) return;
        interact(() => {
          const result = resolveManualReaction(battle, option, event, {map});
          if (result.needsTarget) {
            status = result.message;
            throw new Error(result.message);
          }
          status = result.message;
        }).then(() => {
          reactionPause = null;
          resume();
          if (root() && context?.game) redraw();
        }).catch(() => {
          render(status || 'That reaction could not be used.');
        });
      }, {once: true});
    }
  };
  reactionPause = {event, resume};
  render();
}

document.addEventListener('wayfarer:chat-roll', event => {
  const rollEvent = event.detail;
  if (!rollEvent) return;
  combatCues.triggerRoll?.(rollEvent);
  const currentBattle = table?.state?.battle ?? battle;
  if (currentBattle) {
    const events = currentBattle.actionEvents ??= [...(currentBattle.monsterEvents ?? [])];
    const newId = (events.at(-1)?.id ?? 0) + 1;
    events.push({ id: newId, time: Date.now(), ...rollEvent });
    if (events.length > 48) events.splice(0, events.length - 48);
  }
});
const floatingPanels = createFloatingPanels();
const healthPresentation = createHealthPresentation();
function displayedActor(actor) {
  const committed = table?.writing && table.state?.battle?.actors.find(entry => entry.id === actor?.id);
  return healthPresentation.actor(committed ? { ...actor, hp: committed.hp, tempHp: committed.tempHp, dead: committed.dead, prone: committed.prone } : actor);
}
function prepareHealth() { healthPresentation.sync(table?.id ?? map.key, (table?.state?.battle ?? battle)?.actionEvents ?? []); }
let hoverFrame;
const tokenHover = createTokenHover(id => {
  if(!animatedBoard || animatedBoard.camera!==camera || !context?.game)return;
  animatedBoard.options.hovered=id;
  if(hoverFrame!=null)return;
  hoverFrame=requestAnimationFrame(()=>{
    hoverFrame=null;
    if(animatedBoard?.camera===camera && camera && context?.game)paintAnimationFrame();
  });
});
let animatedBoard;
let voiceSyncFrame = 0;
function paintAnimationFrame() {
  if (animatedBoard && animatedBoard.camera === camera && context?.game) { const { drawingMap, state, options } = animatedBoard; camera.paint((canvas, view) => drawGrid(canvas, view, drawingMap, state, options)); }
  else paintBoard();
  // Voice proximity does not need 60fps DOM during token slides — positions only.
  if (table?.voice && !voiceSyncFrame) {
    voiceSyncFrame = requestAnimationFrame(() => {
      voiceSyncFrame = 0;
      table?.voice?.syncPositions?.({battle, tokenPositions: tokenMotion.positions, selected: selectedId});
    });
  }
}
const tokenMotion = createTokenMotion(paintAnimationFrame);
let queuedMove = null;
const controllerKey = "wayfarer-player-v1";
let controller = globalThis.crypto.randomUUID();
try {
  controller = localStorage.getItem(controllerKey) || controller;
  localStorage.setItem(controllerKey, controller);
} catch { }
let rooms = knownRooms(), roomsLoading = false, roomsError = '', roomListRequest = 0, deletingRoom = '';
const roomDraft = { name: '', username: '', prepared: false, party: null, adventure: 'training' };
let spawnNameDraft = 'Party 1 start';
let selectedSpawnId = '';
async function refreshRooms() {
  const request = ++roomListRequest; rooms = knownRooms(); roomsLoading = true; roomsError = '';
  try {
    const response = await listRooms(controller);
    if (request !== roomListRequest) return;
    rooms = rememberRooms(response.rooms, { authoritative: true });
  } catch (error) {
    if (request === roomListRequest) roomsError = 'Saved rooms are temporarily unavailable. ' + (rooms.length ? 'You can still open a remembered room.' : 'Try again shortly.');
  } finally {
    if (request === roomListRequest) { roomsLoading = false; if (context && !context.game && root()) redraw(); }
  }
}
function roomNameDefault() {
  const name = context?.adventures.find(entry => entry.id === roomDraft.adventure)?.name ?? (roomDraft.adventure === "training" ? trainingMap.title : roomDraft.adventure === "YPHub" ? "Yawning Portal" : roomDraft.adventure);
  return (name + ' · Room ' + (rooms.filter(room => room.adventure === roomDraft.adventure).length + 1)).slice(0, 80);
}
function preferredCharacterId() {
  const id = context?.preferredCharacter;
  return id && context.characters.some((character) => character.id === id) ? id : null;
}
/** Default starting party: only the preferred character when set; otherwise the first sheet. */
function defaultPartyIds() {
  const preferred = preferredCharacterId();
  if (preferred) return [preferred];
  const first = context.characters[0]?.id;
  return first ? [first] : [];
}
function charactersForParty(ids) {
  const preferred = preferredCharacterId();
  const chosen = context.characters.filter((character) => ids.has(character.id));
  if (!preferred) return chosen;
  return [
    ...chosen.filter((character) => character.id === preferred),
    ...chosen.filter((character) => character.id !== preferred),
  ];
}
function preferredPartyActor(actors = battle.actors) {
  const preferred = preferredCharacterId();
  const party = actors.filter((actor) => actor.side === "party" && actorIsUp(actor) && !actor.kennelAlly);
  if (preferred) {
    const match = party.find((actor) => actor.id === "party:" + preferred && canControl(actor));
    if (match) return match;
  }
  return party.find((actor) => canControl(actor)) ?? party[0] ?? null;
}
function rememberPreferredFromActor(actor) {
  const id = actor?.id?.startsWith("party:") ? actor.id.slice(6) : "";
  if (!id || !context?.characters.some((character) => character.id === id)) return;
  context.preferredCharacter = id;
  document.dispatchEvent(new CustomEvent("wayfarer:prefer-character", { detail: { id } }));
}
function adventureLevelLabel(entry) {
  const range = entry?.level;
  if (!range?.start) return "";
  return range.end && range.end !== range.start
    ? `Levels ${range.start}–${range.end}`
    : `Level ${range.start}${range.end ? "" : "+"}`;
}
function adventureBriefing(selected) {
  const id = roomDraft.adventure;
  const party = context.characters.filter((character) => selected.has(character.id)).map((record) => enrichCharacter(record));
  const partyLevels = party.map((character) => Number(character.level)).filter((level) => Number.isFinite(level));
  const partyLine = partyLevels.length
    ? `Your party · ${partyLevels.length === 1 ? `level ${partyLevels[0]}` : `levels ${Math.min(...partyLevels)}–${Math.max(...partyLevels)}`}`
    : "No starting characters selected yet";

  if (id === "YPHub" || context?.hubEntry) {
    return `<aside class="adventure-brief" aria-label="Adventure details">
      <div class="adventure-brief-main">
        <strong>Yawning Portal</strong>
        <p>Central hub — socialize, accept leads, then depart into a separate campaign room. Not listed under Adventure rooms.</p>
      </div>
      <ul class="adventure-brief-facts">
        <li><span>Recommended</span><b>Any level</b></li>
        <li><span>Style</span><b>Social hub</b></li>
        <li><span>Party</span><b>${escape(partyLine)}</b></li>
      </ul>
    </aside>`;
  }
  if (id === "training") {
    return `<aside class="adventure-brief" aria-label="Adventure details">
      <div class="adventure-brief-main">
        <strong>Wayfarer practice yard</strong>
        <p>A safe map for testing movement, combat, and sheets. Includes a ready-to-play character if you start empty.</p>
      </div>
      <ul class="adventure-brief-facts">
        <li><span>Recommended</span><b>Any level</b></li>
        <li><span>Style</span><b>Practice</b></li>
        <li><span>Party</span><b>${escape(partyLine)}</b></li>
      </ul>
    </aside>`;
  }

  const entry = context.adventures.find((adventure) => adventure.id === id);
  if (!entry) {
    return `<aside class="adventure-brief" aria-label="Adventure details">
      <div class="adventure-brief-main"><strong>${escape(id)}</strong><p>Attach your 5etools archive to load this module’s maps and room notes.</p></div>
      <ul class="adventure-brief-facts"><li><span>Party</span><b>${escape(partyLine)}</b></li></ul>
    </aside>`;
  }

  const levelLabel = adventureLevelLabel(entry) || "Levels vary";
  const squareMaps = (entry.maps ?? []).filter((item) => item.grid === "square" && !item.player).length;
  const facts = [
    ["Recommended", levelLabel],
    entry.storyline ? ["Series", entry.storyline] : null,
    entry.source ? ["Source", entry.source] : null,
    entry.chapters?.length ? ["Chapters", String(entry.chapters.length)] : null,
    squareMaps ? ["Square maps", String(squareMaps)] : null,
    ["Party", partyLine],
  ].filter(Boolean);

  let fit = "";
  const start = entry.level?.start, end = entry.level?.end ?? entry.level?.start;
  if (start && partyLevels.length) {
    const low = Math.min(...partyLevels), high = Math.max(...partyLevels);
    if (high < start) fit = `Your party is below the recommended band (level ${start}${end && end !== start ? "–" + end : ""}).`;
    else if (low > end) fit = `Your party is above the recommended band (level ${start}${end && end !== start ? "–" + end : ""}).`;
    else if (low < start || high > end) fit = `Some characters sit outside the recommended band (level ${start}${end && end !== start ? "–" + end : ""}).`;
    else fit = `Fits the recommended level band.`;
  }

  return `<aside class="adventure-brief" aria-label="Adventure details">
    <div class="adventure-brief-main">
      <strong>${escape(entry.name)}</strong>
      <p>${escape([entry.author, entry.published?.slice(0, 4)].filter(Boolean).join(" · ") || "Published 5e adventure module.")}</p>
      ${fit ? `<p class="adventure-brief-fit">${escape(fit)}</p>` : ""}
    </div>
    <ul class="adventure-brief-facts">${facts.map(([label, value]) =>
      `<li><span>${escape(label)}</span><b>${escape(value)}</b></li>`).join("")}</ul>
  </aside>`;
}
function roomCreationForm(moduleOptions, ready) {
  const selected = roomDraft.party ?? new Set(defaultPartyIds());
  const preferred = preferredCharacterId();
  return `<form id="create-room-form" class="room-create-form">
    <div class="play-field-row">
      ${field("Adventure","play-module",moduleOptions,pending?"disabled":"")}
      ${roomDraft.adventure!=="training"&&ready?field("Starting map","play-map",maps.map(entry=>option(entry.key,entry.title,map.key===entry.key)),pending?"disabled":""):""}
    </div>
    ${adventureBriefing(selected)}
    ${!isBuiltinModule(roomDraft.adventure)&&!hasArchive()?archivePanel():""}
    <div class="play-field-row">${input('Room name', 'new-room-name', roomDraft.name || roomNameDefault(), 'text', 'required maxlength="80"')}
      ${input('Your username', 'new-room-username', roomDraft.username || rememberedUsername(), 'text', 'required maxlength="24" autocomplete="nickname"')}</div>
    <div class="room-party-guidance"><p>You can add more characters in the room after you arrive.</p><button type="button" class="button outline small" data-action="upload">Import character sheets</button></div>
    ${context.characters.length ? `<fieldset class="room-party-picker"${roomDraft.prepared?' disabled':''}>
      <legend>Starting party <span class="room-party-count">${selected.size} selected</span><span class="room-party-limit">· up to four</span></legend>
      <div class="room-party-grid">${context.characters.map((record, index) => {
        const character = enrichCharacter(record);
        const checked = selected.has(character.id);
        const isDefault = preferred === character.id;
        const profile = characterProfile(character);
        const level = character.level != null ? 'Level ' + text(character.level) : '';
        const meta = [profile, level].filter(Boolean).join(' · ');
        return `<label class="room-party-tile${checked?' is-selected':''}${isDefault?' is-default':''}">
          <input type="checkbox" class="sr-only" name="room-character" value="${escape(character.id)}" ${checked?'checked':''} ${roomDraft.prepared?'disabled':''}>
          <span class="avatar${character.tokenImage?' has-photo':` tone-${index%4}`}" aria-hidden="true">${tokenPortrait(initials(character.name),character.tokenImage)}</span>
          <span class="room-party-copy"><strong>${escape(character.name)}</strong>${meta?`<small>${meta}</small>`:''}${isDefault?'<small class="room-party-default">Default</small>':''}</span>
          <span class="room-party-mark" aria-hidden="true">${icon('check',15)}</span>
        </label>`;
      }).join('')}</div>
    </fieldset>` :
      (roomDraft.adventure==='training'?'<p class="play-hint">The practice yard includes a ready-to-play character.</p>':'')}
    ${roomDraft.prepared?'<p class="play-hint">The room will use your prepared encounter and its party.</p>':''}
    <div class="play-action-row"><button type="submit" class="button primary small" ${pending || !ready || sceneJobs.has(battle) ? 'disabled' : ''}>${pending ? 'Preparing room…' : 'Create room'}</button>
      <span class="play-hint">${ready?"Saves automatically":""}</span></div>
    <p class="room-create-status" role="status">${escape(status || tableMessage)}</p>
  </form>`;
}
async function createAdventureRoom() {
  if (pending || table || !context?.newRoom || map.module!==roomDraft.adventure || (!isBuiltinModule(map.module)&&!hasArchive())) return;
  if (roomDraft.adventure === "YPHub") { location.hash = "#hub"; return; }
  const name = (roomDraft.name || roomNameDefault()).normalize('NFKC').trim(), username = (roomDraft.username || rememberedUsername()).normalize('NFKC').trim();
  if (!name || name.length > 80 || !username || username.length > 24) { status = 'Enter a room name and a username.'; redraw(); return; }
  const characters = charactersForParty(roomDraft.party ?? new Set(defaultPartyIds()));
  if (!roomDraft.prepared && characters.length > 4) { status = 'Choose up to four starting characters.'; redraw(); return; }
  const previous = { battle, selectedId, room, tool, category,previewState }, route = location.hash;
  const fresh = roomDraft.prepared ? structuredClone(battle) : newBattle();
  if (!roomDraft.prepared && map.module === 'training') fresh.actors = trainingActors().filter(actor => !characters.length || actor.side !== 'party');
  delete fresh.controllers;
  if(!roomDraft.prepared)previewState=null;
  battle = fresh; selectedId = ''; pending = true; status = ''; redraw();
  try {
    await launchGame({ roomName: name, username, roomKind: "campaign" }, characters);
    roomDraft.name = ''; roomDraft.prepared = false; rooms = knownRooms();
  } catch (error) { if (location.hash === route) status = error.message; }
  finally {
    if (battle === fresh) ({ battle, selectedId, room, tool, category,previewState } = previous);
    pending = false; if (context && !context.game && root()) redraw();
  }
}

function hubEntryPage() {
  const selected = roomDraft.party ?? new Set(defaultPartyIds());
  const resumeId = rememberedHubSession();
  return `<section id="hub-entry" class="room-setup hub-entry">
    <header class="play-header"><div><h1>Yawning Portal</h1>
      <p>Central hub for meeting friends and choosing expeditions. Adventures themselves run in separate campaign rooms.</p></div>
      <a class="text-link" href="#play">Adventure rooms</a></header>
    <form id="enter-hub-form" class="room-create-form">
      ${adventureBriefing(selected)}
      <div class="play-field-row">${input("Your username", "hub-username", roomDraft.username || rememberedUsername(), "text", 'required maxlength="24" autocomplete="nickname"')}</div>
      <div class="room-party-guidance"><p>Bring up to four characters into the tavern. Depart later opens a campaign room with this party.</p>
        <button type="button" class="button outline small" data-action="upload">Import character sheets</button></div>
      ${context.characters.length ? `<fieldset class="room-party-picker">
        <legend>Party at the tavern <span class="room-party-count">${selected.size} selected</span><span class="room-party-limit">· up to four</span></legend>
        <div class="room-party-grid">${context.characters.map((record, index) => {
          const character = enrichCharacter(record);
          const checked = selected.has(character.id);
          const isDefault = preferredCharacterId() === character.id;
          const profile = characterProfile(character);
          const level = character.level != null ? "Level " + text(character.level) : "";
          const meta = [profile, level].filter(Boolean).join(" · ");
          return `<label class="room-party-tile${checked ? " is-selected" : ""}${isDefault ? " is-default" : ""}">
            <input type="checkbox" class="sr-only" name="room-character" value="${escape(character.id)}" ${checked ? "checked" : ""}>
            <span class="avatar${character.tokenImage ? " has-photo" : ` tone-${index % 4}`}" aria-hidden="true">${tokenPortrait(initials(character.name), character.tokenImage)}</span>
            <span class="room-party-copy"><strong>${escape(character.name)}</strong>${meta ? `<small>${meta}</small>` : ""}${isDefault ? '<small class="room-party-default">Default</small>' : ""}</span>
            <span class="room-party-mark" aria-hidden="true">${icon("check", 15)}</span>
          </label>`;
        }).join("")}</div>
      </fieldset>` : '<p class="play-hint">Import or create a character before entering the tavern.</p>'}
      <div class="play-action-row">
        <button type="submit" class="button primary small" ${pending || !context.characters.length ? "disabled" : ""}>${pending ? "Opening…" : "Enter the tavern"}</button>
        ${resumeId ? `<a class="button outline small" href="${sessionHash(resumeId)}">Resume last hub</a>` : ""}
      </div>
      <p class="room-create-status" role="status">${escape(status || tableMessage)}</p>
    </form>
  </section>`;
}

async function enterHubSession() {
  if (pending || table || !context?.hubEntry) return;
  const username = (roomDraft.username || rememberedUsername()).normalize("NFKC").trim();
  if (!username || username.length > 24) { status = "Enter a username."; redraw(); return; }
  const characters = charactersForParty(roomDraft.party ?? new Set(defaultPartyIds()));
  if (!characters.length) { status = "Choose at least one character."; redraw(); return; }
  if (characters.length > 4) { status = "Choose up to four characters."; redraw(); return; }
  const previous = { battle, selectedId, room, tool, category, previewState, map }, route = location.hash;
  const hubMap = ypDefaultMap();
  map = hubMap;
  moduleId = "YPHub";
  const fresh = newBattle();
  delete fresh.controllers;
  previewState = null;
  battle = fresh;
  selectedId = "";
  pending = true;
  status = "";
  redraw();
  try {
    await launchGame({ roomName: "Yawning Portal", username, roomKind: "hub" }, characters);
  } catch (error) {
    if (location.hash === route) status = error.message;
  } finally {
    if (battle === fresh) ({ battle, selectedId, room, tool, category, previewState, map } = previous);
    pending = false;
    if (context && !context.game && root()) redraw();
  }
}

/** Leave the hub session and open a campaign room seeded with the party at the destination map. */
async function openCampaignFromHub(destinationMap) {
  if (!table?.state) throw new Error("Depart from the Yawning Portal hub session.");
  const hubId = table.id;
  const username = rememberedUsername() || table.player || "Adventurer";
  status = "Opening the expedition room…";
  redraw();
  const resolved = await resolveExpeditionMap(destinationMap);
  if (resolved.module === "LMoP" && resolved.id === "1ab" && (resolved.regions?.length ?? 0) < 3) {
    throw new Error("Attach your 5etools archive so Cragmaw Hideout can load its rooms, creatures, and map art.");
  }
  // Resume the linked campaign when returning to the same expedition from the hub.
  const linked = knownRooms().find((room) =>
    room.kind === "campaign" &&
    room.hubSession === hubId &&
    (room.mapKey === resolved.key || room.adventure === resolved.module));
  if (linked?.id) {
    rememberedHubSession(hubId);
    leaveTable();
    location.hash = sessionHash(linked.id);
    return;
  }
  const previous = tableState();
  const moved = travelExpedition(previous, resolved);
  const destination = moved.currentMap;
  const active = roomBattle(moved, destination);
  if (!active.sceneReady && destination.module !== "training") await populateScene(destination, active);
  await applyBakedWalls(destination, active);
  const hostiles = active.actors.filter((actor) => actor.side === "hostile" || actor.side === "neutral");
  if (destination.module === "LMoP" && destination.id === "1ab" && !hostiles.length) {
    throw new Error("Cragmaw Hideout did not load its creatures. Re-attach the 5etools archive and depart again.");
  }
  for (const member of active.actors.filter((entry) => entry.side === "party")) discoverStory(active, destination, member);
  rememberVision(active, destination);
  const state = commitRoomState(moved, destination, active, moved.alignment);
  const adventureName = context.adventures.find((entry) => entry.id === destination.module)?.name ?? destination.title;
  state.room = {
    name: destination.title,
    adventure: destination.module,
    adventureName,
    kind: "campaign",
    hubSession: hubId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const tokens = new Map();
  for (const actor of state.battle.actors) {
    const hash = partyTokenImage(actor);
    if (!hash) { delete actor.tokenImage; continue; }
    actor.tokenImage = hash;
    if (!tokens.has(hash)) tokens.set(hash, await localTokenBlob(hash));
  }
  const arrivalKeys = (state.battle.story?.discoveries ?? []).slice(-2).map((entry) => entry.key).filter(Boolean);
  try { sessionStorage.setItem("wayfarer-arrival-story", JSON.stringify(arrivalKeys)); } catch { /* ignore */ }
  const result = await createSession({ ...destination, detectedGrid: null }, state, null, tokens, controller);
  rememberedHubSession(hubId);
  rooms = rememberRoom(result.id, destination, state);
  await syncSessionPlayers(result.id, controller, username).catch(() => null);
  leaveTable();
  location.hash = sessionHash(result.id);
}

let pathPreview;
let previewMessage = "";
/** After a hub interact saves, open a campaign room or return to the tavern. */
let pendingHubDepart = null;
let pendingHubReturn = false;
/** Weapon attack waiting for move-into-range (and any opportunity attacks) to finish. */
let pendingStrike = null;
let interactionPosition = null;
let objectTarget = null, bodyPlacement = '', potionUse = 'drink', featureTargetId = '';
let spellEnd=null,spellHotSide='left',spellWallForm='wall',controlledZone=null;
let spellSquare;
let castSlot = "";
let breathType = "fire";
let featureChoice = "";
const extraTargets = new Map();
let pendingSquare;
const sceneJobs = new WeakMap();
let repaintScheduled = false;
let detectedGrid;
let gridDraft;
let artFitDraft;
let calibrateGrid = false;
const gridFields = ["width", "height", "x", "y"];
const gridModes = { artwork: "Artwork only", printed: "Artwork guides", tactical: "5-foot cells" };
const activeMapKey = "wayfarer-active-map-v1";
let preferredGame;
try { preferredGame = JSON.parse(localStorage.getItem(activeMapKey)); } catch { }


function root() { return document.querySelector("#play-mount"); }
function saveBattle(entry = map, state = battle) {
  if (table) return;
  previewState=commitRoomState(previewState,entry,state,entry.printedGrid ?? null);
  try { localStorage.setItem(previewKey, JSON.stringify(previewState)); } catch {
    status = "Browser storage is unavailable. This encounter will last until the page closes.";
  }
}

async function decodeMapImage(blob, entry) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (entry && Math.abs(image.naturalWidth / image.naturalHeight / (entry.width / entry.height) - 1) > .15) {
      throw new Error("This image’s aspect ratio is too far from this map. Crop it closer, or pick the matching map variant.");
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const wallEditor = createWallEditor({
  state: () => ({ battle, map, surface: root()?.querySelector('#play-grid'), scope: (table?.id ?? 'local') + ':' + map.key }),
  change: () => { paintBoard(); },
  commit: async (before, next) => {
    const scope = (table?.id ?? 'local') + ':' + map.key, expected = JSON.stringify(before);
    return interact(() => { if (JSON.stringify(battle.wallData ?? map.wallData ?? { manual: true, walls: [], doors: [] }) !== expected) throw new Error("Walls changed while you were editing. Try again on the updated map."); battle.wallData = structuredClone(next); battle.wallRevision = (battle.wallRevision ?? 0) + 1; rememberVision(battle, map); saveExplored(battle, map); },
      { cosmetic: true, retryMove: () => scope === (table?.id ?? 'local') + ':' + map.key && JSON.stringify(battle.wallData ?? map.wallData ?? { manual: true, walls: [], doors: [] }) === expected });
  }
});
const displayVision = () => viewerVision(battle, map, table ? controller : null).visible;
const fogActive = () => !wallEditor.active && (battle.fogEnabled ?? fogOfWarEnabled);

function viewerParty() {
  const mine = battle.actors.find((actor) => actor.side === "party" && (table ? battle.controllers?.[actor.id] === controller : actor.id === selectedId))
    ?? selectedActor()
    ?? battle.actors.find((actor) => actor.side === "party");
  return mine?.side === "party" ? actorPartyId(mine) : null;
}

function visibleTokens(sight = context?.game ? displayVision() : null, { includeDefeated = false } = {}) {
  if (!sight) return null;
  const myParty = viewerParty();
  return new Set(battle.actors.filter((actor) => {
    if (actor.side === "party" && (!myParty || sameParty({side: "party", partyId: myParty}, actor))) return true;
    const revealed = (!condition(actor, "Invisible") && occupies(actor) || includeDefeated && defeatedCreature(actor)) &&
      (!fogActive() || touchesArea(actor, sight));
    return revealed;
  }).map(({ id }) => id));
}

function visibleMarkers(sight = context?.game ? displayVision() : null) {
  const entries = battle.markers ?? [];
  return sight ? entries.filter((marker) => (!marker.hidden || marker.revealed) && (!fogActive() || sight.has(keyAt(marker.x, marker.y)))) : entries;
}

function boardFeatureMarkers(sight = context?.game ? displayVision() : null) {
  const dm = !table || table.role === "dm" || !fogActive();
  const pips = visibleFeaturePips(battle, { dm, sight, fogOn: fogActive() });
  return pips.map((feature) => {
    const kind = feature.kind || "object";
    const type = feature.state === "hinted" ? "hint"
      : kind === "creature_hint" ? "creature"
      : kind === "secret" || kind === "mechanism" || kind === "lore" ? "object"
      : kind;
    return {
      id: feature.id,
      type,
      kind,
      state: feature.state,
      name: feature.name,
      x: feature.x,
      y: feature.y,
      hinted: feature.state === "hinted",
      revealed: feature.state === "revealed" || feature.state === "resolved" || feature.state === "triggered",
      looted: feature.looted,
      feature: true,
    };
  });
}

function repaintCreatureArt() {
  if (repaintScheduled) return;
  repaintScheduled = true;
  requestAnimationFrame(() => {
    repaintScheduled = false;
    paintBoard();
  });
}

document.addEventListener("wayfarer:character-token", repaintCreatureArt);

function partyTokenImage(actor) {
  if (actor.side !== "party") return;
  if (table) return actor.tokenImage;
  const character = importedCharacter(actor);
  return character ? character.tokenImage : actor.tokenImage;
}

function importedCharacter(actor) {
  return actor ? context.characters.find(({ id }) => actor.id === "party:" + id) : null;
}

function collectArtwork(visible) {
  const result = new Map();
  for (const actor of battle.actors) {
    if (visible && !visible.has(actor.id)) continue;
    const art = characterTokenArtwork(partyTokenImage(actor), table?.id, repaintCreatureArt) ?? monsterArtwork(actor, map, repaintCreatureArt);
    if (art) result.set(actor.id, art);
  }
  return result;
}

function paintTokenPreviews(images) {
  for (const canvas of root().querySelectorAll("canvas[data-creature-portrait]")) {
    const portrait = images.get(canvas.dataset.creaturePortrait);
    const initials = canvas.parentElement.querySelector("[data-token-initial]");
    canvas.hidden = !portrait;
    if (initials) initials.hidden = Boolean(portrait);
    if (!portrait || canvas.dataset.artPath === portrait.path) continue;
    canvas.width = 96; canvas.height = 96;
    const ctx = canvas.getContext("2d");
    drawMonsterArtwork(ctx, portrait, 48, 48, 96);
    canvas.dataset.artPath = portrait.path;
    canvas.dataset.artKind = portrait.type;
  }
}

function ensureScene(entry = map, state = battle) {
  if (entry.module === "training") return Promise.resolve();
  if (entry.module === "YPHub") seedYpHubScene(entry, state);
  if (entry.module === "LMoP" && entry.id === "1ab" && state.sceneReady) seedKennelWolves(entry, state);
  if (state.sceneReady && (state.wallData || entry.module === "YPHub")) return Promise.resolve();
  if (sceneJobs.has(state)) return sceneJobs.get(state);
  const fresh = !state.sceneReady;
  const loading = (async () => {
    // Seed Map Studio walls/fog/grid before baked walls so studio walls win.
    if (fresh && !state._fromTemplate) {
      try {
        const template = await loadMapTemplate(entry.module, entry.key);
        if (template) await applyMapTemplate(entry, state, template);
      } catch { /* offline / unsigned-in */ }
    }
    const [baked] = await Promise.all([applyBakedWalls(entry, state), fresh ? populateScene(entry, state) : null]);
    if (entry.module === "YPHub") seedYpHubScene(entry, state);
    if (entry.module === "LMoP" && entry.id === "1ab") seedKennelWolves(entry, state);
    if (baked && map === entry && battle === state) rememberVision(state, entry);
    if ((baked || fresh) && !table && battle===state && map.key===entry.key) saveBattle(entry,state);
  })().catch(() => {
    if (map === entry && battle === state) status = "Some starting tokens could not be read. Reopen the map to retry.";
  }).finally(() => {
    sceneJobs.delete(state);
    if (map === entry && battle === state) redraw();
  });
  sceneJobs.set(state, loading);
  return loading;
}

function wallAimRule() {
  if (category !== 'spell' || !spellSquare || spellEnd) return null;
  const actor = selectedActor();
  const choice = combatChoice === '' ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.usable && choice.mode === 'spell' ? supportedSpell(choice.data.reference || choice.data.key) : null;
  if (!effect?.custom) return null;
  const spellDef = formRule(effect.definition, allowsWallRing(effect.definition) ? spellWallForm : undefined);
  return spellDef && needsEndpoint(spellDef) ? spellDef : null;
}

function paintBoard() {
  const element = root();
  if (!element || !camera) return;
  prepareHealth();
  const actor = selectedActor();
  const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.usable && choice.mode === "spell" ? supportedSpell(choice.data.reference || choice.data.key) : null;
  const firstRank = choice?.data?.level && Object.keys(actor.slots).find((rank) =>
    Number(rank) >= choice.data.level && actor.slots[rank].current > 0);
  const spellDef=effect?.custom?formRule(effect.definition,allowsWallRing(effect.definition)?spellWallForm:undefined):null;
  const aimingWall = spellDef && needsEndpoint(spellDef) && spellSquare && !spellEnd;
  const aimEnd = spellEnd ?? (aimingWall && cursor && Number.isFinite(cursor.x) ? {x: cursor.x, y: cursor.y} : undefined);
  const footprint=spellSquare&&spellDef?customSpellCells(spellDef,actor,spellSquare,map,{end:aimEnd,hotSide:spellHotSide}):spellSquare ? effect && (effect.area || effect.cone) && actor ?
    spellCells(battle, actor, spellSquare, effect, map, slotRank(castSlot || firstRank || actor.resources?.pactMagic?.slotLevel || effect.level)) :
    new Set([keyAt(spellSquare.x, spellSquare.y)]) : null;
  const vision = context.game ? viewerVision(battle, map, table ? controller : null) : null;
  const sight = vision?.visible;
  const visible = visibleTokens(sight, { includeDefeated: true });
  const selectedTarget = context.game && category === "weapon" && canControl(actor)
    ? combatSelection(actor, visible).target?.id : targetId;
  const tokenImages = collectArtwork(visible);
  paintTokenPreviews(tokenImages);
  const alignmentOpen = element.querySelector("#grid-settings")?.open;
  const liveAlignment = alignmentOpen ? (gridDraft ?? map.printedGrid) : null;
  const drawingMap = liveAlignment ? { ...map, ...gridGeometry(map, liveAlignment) } : map;
  const liveArtFit = alignmentOpen ? (artFitDraft ?? battle.artworkFit) : battle.artworkFit;
  const previewCursor=cursor?.movement && (tool!=="move" || !["move","interact"].includes(category) || bodyPlacement) ? null : cursor;
  const options = {
    room: context.game && tool !== "room" ? null : room, selected: actor?.id, target: selectedTarget, hovered: context.game ? tokenHover.hovered : undefined, cursor:previewCursor, art,
    tokenPositions: context.game ? tokenMotion.positions : null, movementLabels: context.game ? tokenMotion.labels : null,
    path: pathPreview, visible, fog: fogActive() && sight ? { ...vision, memory: viewerMemory(battle, map, table ? controller : null), settings: fogSettings(battle) } : null,
    wallEditor: wallEditor.active ? wallEditor : null,
    // Hide 5etools room outlines while artwork is loading — show a loader instead of the schematic.
    footprint, showRegions: !artworkLoading && (alignmentOpen || !context.game || !art || tool === "room"),
    markers: (() => {
      const shown = visibleMarkers(sight);
      const ids = new Set(shown.map((marker) => marker.id));
      for (const spawn of spawnMarkers(battle)) if (!ids.has(spawn.id)) shown.push(spawn);
      for (const pip of boardFeatureMarkers(sight)) {
        if (ids.has(pip.id)) {
          const existing = shown.find((marker) => marker.id === pip.id);
          if (existing) {
            if (pip.hinted) existing.hinted = true;
            if (pip.kind) existing.kind = pip.kind;
            if (pip.state) existing.state = pip.state;
            if (pip.looted != null) existing.looted = pip.looted;
          }
          // Kennel hitch stays rope-only — never promote it back to rock art or a crate pip.
          if (existing && (existing.id === "LMoP|1ab|021|chain-pole" || existing.visual === "rock" || existing.type === "rock" || existing.visual === "pole" || existing.type === "pole")) {
            existing.type = "rock";
            existing.visual = "rock";
            existing.hidden = true;
            delete existing.image;
          }
          continue;
        }
        // Skip a fresh kennel hitch pip — ropes are drawn from the feature/marker separately.
        if (pip.id === "LMoP|1ab|021|chain-pole") continue;
        ids.add(pip.id);
        shown.push(pip);
      }
      return shown;
    })(), tokenImages, overlay: artworkLoading ? "none" : alignmentOpen ? "printed" : battle.gridOverlay ?? "artwork",
  };
  // Stable string key — a fresh object every paint defeated the layered board cache and
  // forced full artwork/fog/marker redraws on every token-motion frame (huge on giant maps).
  // Vision positions stay OUT of this key; fog is redrawn on the token overlay instead.
  const fit = liveArtFit ?? null;
  const fogSettingsKey = options.fog?.settings
    ? [options.fog.settings.opacity, options.fog.settings.exploredOpacity, options.fog.settings.softness, options.fog.settings.remember ? 1 : 0].join(",")
    : "";
  options.backgroundKey = [
    map.key,
    options.overlay,
    options.showRegions ? 1 : 0,
    options.room?.id ?? "",
    options.fog ? "fog:" + (options.fog.memory?.revision ?? 0) + ":" + fogSettingsKey : "nofog",
    battle.wallRevision ?? 0,
    fit ? [fit.scale, fit.offsetX, fit.offsetY].join(",") : "",
    Object.keys(battle.terrain || {}).length,
    (battle.spellZones || []).map((zone) => zone.id || zone.name || "").join(","),
    options.markers.map((marker) => [marker.id, marker.x, marker.y, marker.type, marker.kind || "", marker.state || "", marker.hinted ? 1 : 0, marker.revealed ? 1 : 0, marker.looted ? 1 : 0].join(":")).join("|"),
    options.footprint ? [...options.footprint].join(",") : "",
    options.wallEditor ? "walls" : "",
  ].join("/");
  const paintState = { ...battle, artworkFit: liveArtFit, actors: battle.actors.map(actor => displayedActor(actor)) };
  animatedBoard = { camera, drawingMap, state: paintState, options };
  camera.paint((canvas, view) => drawGrid(canvas, view, drawingMap, paintState, options));
  syncMapLoadingOverlay();
  const frame = element.querySelector('.board-frame')?.parentElement;
  if (frame) { let bar = frame.querySelector('.wall-editor-host'); if (wallEditor.active) { if (!bar) { bar = document.createElement('div'); bar.className = 'wall-editor-host'; frame.append(bar); } bar.innerHTML = wallEditor.toolbar(); } else bar?.remove(); }
  tokenHover.sync({ map: drawingMap, battle: { ...battle, actors: battle.actors.map(actor => tokenMotion.positions.has(actor.id) && context.game ? { ...displayedActor(actor), ...tokenMotion.positions.get(actor.id) } : displayedActor(actor)) }, visible, surface: element.querySelector('#play-grid'), gesturing: () => camera?.gesturing() });
  speechBubbles.sync({
    map: drawingMap,
    battle,
    surface: element.querySelector("#play-grid"),
  });
  combatCues.aimPreview(aimingWall && aimEnd ? {
    square: spellSquare,
    end: aimEnd,
    name: spellDef.name,
    rule: spellDef,
    cells: footprint ? [...footprint] : [],
  } : null);
}

function currentSquareFt() {
  if (battle.gridSquareFt === 10 || battle.gridSquareFt === 5) return battle.gridSquareFt;
  return defaultSquareFeet(map.sourceGrid);
}

function setAlignment(alignment) {
  if (!map.sourceGrid) return false;
  const geometry = gridGeometry(map, alignment, currentSquareFt());
  if (!fitsCurrentGrid(geometry, battle)) return false;
  Object.assign(map, geometry);
  return true;
}

function alignmentDescription() {
  return battle.gridManual ? "Saved alignment" : detectedGrid ? "Fitted to artwork" : "Adventure alignment";
}

function alignmentBaseline() {
  return detectedGrid ?? map.sourceGrid;
}

function scaleFromAlignment(alignment) {
  const baseline = alignmentBaseline();
  if (!baseline?.width || !alignment?.width) return 100;
  return Math.round((alignment.width / baseline.width) * 1000) / 10;
}

function alignmentFromScale(scalePct, current = gridDraft ?? map.printedGrid ?? map.sourceGrid) {
  const baseline = alignmentBaseline();
  const factor = scalePct / 100;
  return {
    width: baseline.width * factor,
    height: baseline.height * factor,
    x: current?.x ?? baseline.x,
    y: current?.y ?? baseline.y,
  };
}

function updateAlignmentFields() {
  const description = root()?.querySelector("#grid-align-source");
  if (description) description.textContent = alignmentDescription();
  const alignment = gridDraft ?? map.printedGrid;
  for (const field of gridFields) {
    const element = root()?.querySelector("#grid-align-" + field);
    if (element && alignment) element.value = formatPixels(alignment[field]);
  }
  const scale = root()?.querySelector("#grid-align-scale");
  if (scale && alignment) scale.value = formatPixels(scaleFromAlignment(alignment));
}

function previewAlignment(alignment, { from } = {}) {
  const feedback = root()?.querySelector("#grid-align-feedback");
  if (alignment && fitsCurrentGrid(gridGeometry(map, alignment), battle)) {
    gridDraft = alignment;
    if (feedback) feedback.textContent = "Previewing the adjusted guides. Save when the orange lines match the printed squares.";
    if (from !== "fields") {
      for (const name of gridFields) {
        const element = root()?.querySelector("#grid-align-" + name);
        if (element) element.value = formatPixels(alignment[name]);
      }
    }
    if (from !== "scale") {
      const scale = root()?.querySelector("#grid-align-scale");
      if (scale) scale.value = formatPixels(scaleFromAlignment(alignment));
    }
    paintBoard();
    return true;
  }
  if (feedback) feedback.textContent = "Enter positive spacing and keep saved pieces inside the grid.";
  paintBoard();
  return false;
}

function currentArtworkFit() {
  return normalizeArtworkFit(artFitDraft ?? battle.artworkFit);
}

function alignImage(image) {
  if (!map.sourceGrid) return;
  detectedGrid = null;
  try { detectedGrid = alignArtwork(image, map, currentSquareFt(), currentArtworkFit()); } catch { }
  if (!battle.gridManual && !gridDraft) {
    if (!setAlignment(detectedGrid ?? map.sourceGrid)) detectedGrid = null;
    updateAlignmentFields();
  }
}

function previewArtworkFit(fit) {
  const next = normalizeArtworkFit(fit);
  if (!(next.scale > 0)) {
    const feedback = root()?.querySelector("#art-fit-feedback");
    if (feedback) feedback.textContent = "Enter a positive image scale.";
    return false;
  }
  artFitDraft = next;
  const feedback = root()?.querySelector("#art-fit-feedback");
  if (feedback) feedback.textContent = "Previewing image placement. Rooms and monsters stay put — move the picture under them, then save.";
  const scale = root()?.querySelector("#art-fit-scale");
  const x = root()?.querySelector("#art-fit-x");
  const y = root()?.querySelector("#art-fit-y");
  if (scale && document.activeElement !== scale) scale.value = formatPixels(next.scale * 100);
  if (x && document.activeElement !== x) x.value = formatPixels(next.x);
  if (y && document.activeElement !== y) y.value = formatPixels(next.y);
  paintBoard();
  return true;
}

function readArtworkFit() {
  const scale = root()?.querySelector("#art-fit-scale")?.valueAsNumber;
  const x = root()?.querySelector("#art-fit-x")?.valueAsNumber;
  const y = root()?.querySelector("#art-fit-y")?.valueAsNumber;
  if (![scale, x, y].every(Number.isFinite) || !(scale > 0)) return null;
  return normalizeArtworkFit({ x, y, scale: scale / 100 });
}

function mapLoadingHost() {
  // Prefer the non-scrolling stage so pan/zoom never leaves the loader behind.
  return root()?.querySelector(".game-stage")
    ?? root()?.querySelector(".board-frame")?.parentElement
    ?? root()?.querySelector(".board-frame");
}

function syncMapLoadingOverlay() {
  const host = mapLoadingHost();
  if (!host) return;
  // Drop any loader stuck inside the scrollable board from an older mount.
  root()?.querySelector(".board-frame > .map-loading")?.remove();
  let overlay = host.querySelector(":scope > .map-loading");
  if (!artworkLoading) {
    overlay?.remove();
    return;
  }
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "map-loading";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `<div class="map-loading-stage" aria-hidden="true">
      <div class="map-loading-grid"></div>
      <div class="map-loading-path"></div>
      <div class="map-loading-compass">
        <span class="map-loading-needle"></span>
        <span class="map-loading-ring"></span>
        <span class="map-loading-n">N</span>
      </div>
    </div>
    <p class="map-loading-copy"><strong>Charting the map</strong><span>Unfurling the expedition…</span></p>`;
  host.append(overlay);
}

function updateArtwork() {
  const note = root()?.querySelector("#map-art-note");
  const picker = root()?.querySelector('[data-play="art"]');
  if (note) note.textContent = artworkNote;
  if (picker) picker.textContent = art ? "Change map image" : "Choose map image";
  syncMapLoadingOverlay();
  paintBoard();
}

async function loadArtwork(entry, file, sharedURL) {
  artworkRequest?.abort();
  const request = new AbortController();
  artworkRequest = request;
  const current = () => artworkRequest === request && map.key === entry.key;
  // When a DM map has a paired player variant, prefer the clean player artwork
  // so players see the map without room numbers, trap markers, or DM annotations.
  // The DM can toggle to view DM notes via table tools if desired.
  const useDm = Boolean(battle?.showDmArtwork);
  const preferredAsset = (useDm ? entry.asset : (entry.playerAsset ?? entry.asset)) ?? entry.asset;
  const fallbackAsset = preferredAsset === entry.playerAsset ? entry.asset : (entry.playerAsset ?? null);
  const displayAsset = preferredAsset;
  if (!displayAsset && !file && !sharedURL) {
    art = null;
    customArtwork = null;
    artworkLoading = false;
    artworkNote = "Showing the schematic. Choose a map image to add artwork.";
    updateArtwork();
    return;
  }
  // Drop the previous map image immediately so travel never keeps the old board art or schematic rooms.
  art = null;
  customArtwork = null;
  artworkLoading = true;
  artworkNote = "Loading map artwork…";
  updateArtwork();
  const timeout = setTimeout(() => request.abort(), 12000);
  try {
    let image;
    if (sharedURL) {
      const response = await fetch(sharedURL, { signal: request.signal });
      if (response.ok) image = await decodeMapImage(await response.blob(), entry);
    } else if (file) {
      image = await decodeMapImage(file, entry);
    } else {
      if (typeof displayAsset === "string" && displayAsset.startsWith("/assets/")) {
        const response = await fetch(displayAsset, { signal: request.signal });
        if (response.ok) image = await decodeMapImage(await response.blob(), entry);
      }
      let embedded = image ? null : await mapImage(displayAsset).catch(() => null);
      if (!current()) return;
      if (!image && embedded) image = await decodeMapImage(embedded, entry).catch(() => null);
      if (!image && current()) {
        const hosted = await hostedMapImage(displayAsset, request.signal);
        if (hosted) image = await decodeMapImage(hosted, entry).catch(() => null);
      }
      // Resilient fallback: if the preferred variant fails to load, fall back to the alternate
      if (!image && fallbackAsset && fallbackAsset !== displayAsset && current()) {
        if (typeof fallbackAsset === "string" && fallbackAsset.startsWith("/assets/")) {
          const response = await fetch(fallbackAsset, { signal: request.signal });
          if (response.ok) image = await decodeMapImage(await response.blob(), entry).catch(() => null);
        }
        const fbEmbedded = image ? null : await mapImage(fallbackAsset).catch(() => null);
        if (fbEmbedded) image = await decodeMapImage(fbEmbedded, entry).catch(() => null);
        if (!image && current()) {
          const fbHosted = await hostedMapImage(fallbackAsset, request.signal);
          if (fbHosted) image = await decodeMapImage(fbHosted, entry).catch(() => null);
        }
      }
    }
    if (!current()) return;
    if (image) {
      art = image;
      customArtwork = file;
      if (!table) alignImage(image);
      artworkNote = sharedURL ? "Shared map artwork." : file ? "Using your map image." : (entry.playerAsset && !useDm) ? "Player map artwork (hidden DM notes)" + (entry.artist ? " by " + entry.artist : "") + "." : (entry.playerAsset && useDm) ? "DM map artwork with annotations" + (entry.artist ? " by " + entry.artist : "") + "." : entry.artist ? "Map artwork by " + entry.artist + "." : displayAsset?.startsWith?.("/assets/") ? "Hub map artwork loaded." : "Map artwork loaded from 5etools.";
      if (file && map.sourceGrid && !table) {
        calibrateGrid = true;
        if ((battle.gridOverlay ?? "artwork") === "artwork") battle.gridOverlay = "printed";
        artworkNote = "Using your map image. Move the picture under the rooms (image scale / shift), then save placement. Grid guides are optional.";
      }
    } else {
      art = null;
      customArtwork = null;
      artworkNote = "Map artwork is unavailable. Showing the schematic.";
    }
  } catch (error) {
    if (!current()) return;
    art = null;
    customArtwork = null;
    artworkNote = file
      ? (error instanceof Error && error.message.includes("aspect ratio") ? error.message : "The map image could not be read.")
      : "Map artwork is unavailable. Showing the schematic.";
  } finally {
    clearTimeout(timeout);
    if (current()) {
      artworkLoading = false;
      if (calibrateGrid) redraw();
      else updateArtwork();
    }
  }
}

/** Reset camera/art/selection when hub stairs or expedition travel changes the active map. */
function adoptTravelMap(destination, active, state) {
  artworkRequest?.abort();
  artworkRequest = null;
  camera?.destroy();
  camera = null;
  focusedGameMap = null;
  tokenMotion.reset();
  combatCues.reset();
  speechBubbles.clear();
  tokenHover.clear();
  art = null;
  customArtwork = null;
  detectedGrid = null;
  gridDraft = null;
  artFitDraft = null;
  calibrateGrid = false;
  map = structuredClone(destination);
  if (map.sourceGrid) Object.assign(map, gridGeometry(map, state.alignment ?? map.sourceGrid));
  battle = active;
  moduleId = map.module;
  room = startingRegion(map);
  cursor = null;
  queuedMove = null;
  pathPreview = null;
  previewMessage = "";
  spellSquare = null;
  pendingSquare = null;
  resetActionSelection();
  tool = "move";
  category = "move";
  maps = roomMapChoices(state, moduleMapsOrBuiltin(moduleId) ?? [destination]);
  if (table) table.state = state;
  else previewState = state;
  preferredGame = { module: moduleId, map: map.key };
  try { localStorage.setItem(activeMapKey, JSON.stringify(preferredGame)); } catch { }
  loadArtwork(map);
}

function useMap(entry,{fresh=false}={}) {
  if(!table && previewState?.currentMap?.module===entry.module && previewState.currentMap.key!==entry.key && battle?.round){status='Finish combat before changing maps.';return;}
  tokenMotion.reset(); queuedMove = null;
  tokenHover.clear();
  artworkRequest?.abort();
  artworkRequest = null;
  camera?.destroy();
  camera = null;
  artworkNote = "";
  customArtwork = null;
  detectedGrid = null; gridDraft = null; artFitDraft = null;
  map = entry;moduleId=entry.module;setSpellRuleContext(loadSpellRules());
  storyOpen = false;
  let saved;
  if(previewState?.currentMap?.module===entry.module){previewState=travelRoom(commitRoomState(previewState,previewState.currentMap,roomBattle(previewState),previewState.alignment),entry);saved=roomBattle(previewState,entry);}
  else if(!fresh && !previewState && battles[entry.key])saved=structuredClone(battles[entry.key]);
  else previewState=null;
  battle=saved ?? newBattle();battle.spellRules=loadSpellRules();
  battle.actors.forEach(applyHestiasFury);
  const migrated = map.sourceGrid && saved && !saved.alignedGrid;
  if (map.sourceGrid) {
    Object.assign(map, gridGeometry(map));
    migrateGridState(map, battle);
    if (battle.gridManual) setAlignment(battle.gridManual);
  }
  if (map.module === "training" && !saved) battle.actors = trainingActors();
  const repaired = repairWallPlacement(map, battle);
  art = null; selectedId = ""; targetId = ""; combatChoice = ""; cursor = null;
  room = startingRegion(map);
  selectedCreature = 0; tool = context?.game ? "move" : "room"; status = "";
  pathPreview = null; previewMessage = ""; spellSquare = null; pendingSquare = null;
  saveBattle();
  if (map.module !== "training") {
    loadArtwork(entry);
    ensureScene(entry, battle);
  }
}

function repairWallPlacement(entry, state) {
  const walls = mapWalls(entry);
  if (state.round) return false;
  const taken = new Set(state.actors.filter(occupies).flatMap(a => actorCells(a).map(c => keyAt(c.x, c.y))));
  const floor = walls?.rows ? walls.rows.flatMap((spans, y) => spans.flatMap(([first, last]) =>
    Array.from({ length: last - first + 1 }, (_, i) => ({ x: first + i, y })))) : Array.from({ length: entry.cols * entry.rows }, (_, i) => ({ x: i % entry.cols, y: Math.floor(i / entry.cols) }));
  const allowed = (cell) => mapFloor(entry, cell.x, cell.y) && !taken.has(keyAt(cell.x, cell.y)) && state.terrain[keyAt(cell.x, cell.y)] !== "wall";
  let changed = false;
  for (const actor of state.actors.filter(occupies)) {
    if (canStand(state, actor, actor.x, actor.y, entry)) continue;
    const origin = entry.regions.find((region) => areaKey(region) === actor.origin);
    const roomCells = origin ? regionCells(entry, origin).filter(allowed) : [];
    const cells = (roomCells.length ? roomCells : floor.filter(allowed)).filter(c => canStand(state, actor, c.x, c.y, entry));
    const distance = (cell) => Math.hypot(cell.x - actor.x, cell.y - actor.y);
    const [next] = cells.sort((a, b) => distance(a) - distance(b));
    if (!next) continue;
    taken.delete(keyAt(actor.x, actor.y));
    placeToken(state, actor, next.x, next.y, entry);
    taken.add(keyAt(next.x, next.y));
    changed = true;
  }
  return changed;
}

function selectedActor() {
  if (battle.classReaction) return battle.actors.find(actor => actor.id === battle.classReaction.actor) ?? currentActor(battle);
  const active = currentActor(battle);
  if (context?.game && active?.side === "party") {
    const group = sharedTurnGroup(battle).filter(canControl), ready = group.filter(actor => !battle.sharedEnded?.[actor.id]);
    return ready.find(({ id }) => id === selectedId) ?? ready[0] ?? group.find(({ id }) => id === selectedId) ?? group[0] ?? active;
  }
  return active ?? battle.actors.find(({ id }) => id === selectedId);
}
function canControl(actor) {
  if (actor?.side !== "party") return false;
  // Befriended kennel wolves are AI allies — never player-controllable.
  if (actor?.kennelAlly) return false;
  const owner = table && battle.controllers?.[actor.id];
  return !owner || owner === controller;
}
function requireControl(actor) {
  if (actor?.side === "hostile") throw new Error("The game controls " + actor.name + ".");
  if (actor?.kennelAlly) throw new Error(actor.name + " follows the party on their own.");
  if (!canControl(actor)) throw new Error("Wait for " + (actor?.name ?? "the active character") + " to act.");
}
function resolveKennelBetrayal() {
  const pending = battle.kennelBetrayal;
  if (!pending) return null;
  delete battle.kennelBetrayal;
  const attacker = battle.actors.find((actor) => actor.id === pending.attackerId);
  const victim = battle.actors.find((actor) => actor.id === pending.victimId);
  const result = betrayKennelPack(battle, map, attacker, victim);
  if (!result) return null;
  if (result.status) status = result.status;
  if (result.toast) storyToasts.show(result.toast, { force: true, duration: 11000 });
  if (result.engage) pullAlertedDen(battle, map);
  return result;
}
function presentKennelResult(result) {
  if (!result) return;
  if (result.status) status = result.status;
  if (result.toast) storyToasts.show(result.toast, { force: true, duration: 10000 });
  if (result.engage) pullAlertedDen(battle, map);
}
function presentFloodResult(result) {
  if (!result) return;
  if (result.status) status = result.status;
  if (result.toast) storyToasts.show(result.toast, { force: true, duration: 11000 });
  if (result.lookout && result.spotted) {
    beginCombat(result.spotted, result.lookout, true);
  }
}
function onlinePlayerIds(players) {
  const online = new Set((players ?? []).filter((player) => player.online).map((player) => player.id));
  // Never drop our own claims on a brief heartbeat glitch.
  online.add(controller);
  return online;
}
function hasOfflineClaims(players) {
  if (!table || !battle?.controllers) return false;
  const online = onlinePlayerIds(players);
  return Object.values(battle.controllers).some((owner) => owner && !online.has(owner));
}
function clearOfflineClaims(players) {
  if (!battle?.controllers) return [];
  const online = onlinePlayerIds(players);
  const released = [];
  for (const actor of battle.actors.filter((entry) => entry.side === "party")) {
    const owner = battle.controllers[actor.id];
    if (!owner || online.has(owner)) continue;
    delete battle.controllers[actor.id];
    released.push(actor.name);
  }
  return released;
}
function revealStory(previous) {
  if (storyVersion(battle) <= previous || battle.round) return;
  // Don't yank the Story journal open — toast new passages so play keeps moving.
  // Loading into an already-filled journal seeds "seen" instead of replaying the trail.
  if (previous === 0 && (battle.story?.discoveries?.length ?? 0) > 1) {
    storyToasts.remember(battle);
    return;
  }
  storyToasts.reveal(battle);
}
function mapPoint(square) {
  const [x, y] = cellCenter(map, square);
  return { x: x / map.width, y: y / map.height };
}
function cameraToken() {
  const actor = selectedActor();
  return actor && occupies(actor) ? mapPoint(actor) : null;
}
function actionButton(label, action, options = {}) {
  return `<button class="button ${options.primary ? "primary" : "outline"} small"
    type="button" data-play="${action}"${options.id ? ' data-id="' + escape(options.id) + '"' : ""}
    ${options.disabled ? " disabled" : ""}>${escape(label)}</button>`;
}
function option(value, label, selected) {
  return `<option value="${escape(value)}"${selected ? " selected" : ""}>${escape(label)}</option>`;
}
function field(label, name, options, extra = "") {
  return `<label class="play-field"><span id="${name}-label">${label}</span><span class="select-field"><select id="${name}" aria-labelledby="${name}-label" ${extra}>${options.join("")}</select>${icon("down", 15)}</span></label>`;
}
function input(label, id, value, type = "text", extra = "") {
  return `<label class="play-field"><span>${label}</span><input id="${id}" type="${type}" value="${escape(value)}" ${extra}></label>`;
}
function choices(actor) {
  if (!actor) return [];
  const weapons = classWeapons(actor, battle).flatMap((weapon) => weapon.thrown ? [weapon, { ...weapon, ...weapon.thrown, name: weapon.name + " (thrown)" }] : [weapon]);
  const exhale = battle.round && condition(actor, "Dragon’s Breath") ?
    [{ mode: "spell", name: "Exhale Dragon’s Breath", usable: true, data: { key: "exhale dragons breath", edition: "2014", name: "Dragon’s Breath", level: 0 } }] : [];
  return [
    ...weapons.map((weapon) => ({
      mode: "weapon", name: weapon.name, data: weapon, usable: Number.isFinite(weapon.bonus) && Boolean(diceTerms(weapon.damage)),
    })),
    ...actor.spells.map((spell) => ({
      mode: "spell", name: spell.name, data: spell,
      usable: spell.prepared !== false && !spell.customUse && (spell.edition === "2014" || Boolean(customSpellRule(spell.reference || spell.key))) && Boolean(supportedSpell(spell.reference || spell.key)),
      manual: spell.prepared !== false && !spell.customUse && Boolean(spell.reference) &&
        spell.edition === "2014" && ["action", "bonus", "reaction"].includes(spell.timing),
    })),
    ...exhale,
    ...(actor.potions ?? []).map(potion => ({ mode: "potion", name: potion.name + " (" + potion.quantity + ")", data: potion, usable: potion.quantity > 0 })),
    { mode: "custom", name: "Custom strike", usable: true },
  ];
}

function combatSelection(actor, visible) {
  const list = choices(actor);
  const weapons = context.game && category === "weapon";
  const firstWeapon = weapons && combatChoice === "" ? list.findIndex((entry) => entry.mode === "weapon" && entry.usable) : -1;
  const index = firstWeapon >= 0 ? String(firstWeapon) : combatChoice;
  const choice = index === "" ? null : list[Number(index)];
  const targets = battle.actors.filter((entry) => occupies(entry) && (!visible || visible.has(entry.id)));
  let target = targets.find((entry) => entry.id === targetId);
  if (!target && weapons && choice && actorIsUp(actor) && occupies(actor)) {
    const weapon = choice.data;
    const range = weapon?.normalRange ? weapon.longRange || weapon.normalRange : weapon?.reach || 5;
    const foes = targets.filter((entry) => isCombatFoe(actor, entry) && actorIsUp(entry))
      .sort((a, b) => {
        const rivalBias = (isAttackablePc(actor, a) && !sameParty(actor, a) ? 0 : 1) - (isAttackablePc(actor, b) && !sameParty(actor, b) ? 0 : 1);
        return (a.side === "hostile" ? 0 : 1) - (b.side === "hostile" ? 0 : 1) || rivalBias || distanceFt(actor, a) - distanceFt(actor, b);
      });
    target = foes.find((enemy) => distanceFt(actor, enemy) <= range && lineClear(battle, actor, enemy, map)) ?? foes.find(entry => entry.side === "hostile") ?? null;
  }
  return { list, index, choice, targets, target };
}

function hotbarEntries(actor = selectedActor()) {
  if (!actor) return [];
  const sheet = importedCharacter(actor) ?? battle.sheets?.[actor.id];
  const entries = buildActionBar(actor, battle, choices(actor), { canAct: canControl(actor), features: sheet?.rulesDetails?.classDetails?.features ?? [], filter: hotbarFilter });
  if (table?.writing) for (const entry of entries) if (!entry.inspect) entry.reason = 'Saving your previous action…';
  return entries;
}

function hotbarUtilities(actor) {
  const skills = Object.entries(actor?.skillBonuses ?? {}).filter(([, bonus]) => Number.isFinite(bonus));
  return `<div class="hotbar-utilities">
    ${!battle.round ? '<div class="play-action-row">' + actionButton('Rest · '+shortRestsLeft(battle)+' short rests left', 'game-rest') + '</div>' : ''}
    ${skills.length ? `<form id="class-skill-form" class="play-form">${field('Skill check', 'class-skill', skills.map(([name]) => option(name, name)))}<button class="button outline small" type="submit">Roll check</button></form>` : ''}</div>`;
}

function restPanel(){
 const choices=restTableChoices(map),policy=restPolicy(map,battle),actor=selectedActor(),permission=!actor||actor.side!=='party'||!canControl(actor)?'Select a party member you control.':'',waiting=choices.loading?'Loading dungeon encounter tables…':'',selection=choices.policies.length&&!policy?'Choose the applicable encounter table.':'',busy=table?.writing?'Saving the party action…':'';
 const disabled=permission||waiting||selection||busy;
 const progress=policy?battle.rest?.encounterProgress?.[policy.id]??0:0;
 const checks=hours=>policy?Math.floor((progress+hours*3600)/(policy.intervalHours*3600)):0;
 return `<header class="rest-panel-heading"><h2>Rest the party</h2><button type="button" class="game-button" data-play="game-rest" aria-label="Close rest panel">${icon('close',16)}</button></header><p>${shortRestsLeft(battle)} / 2 short rests remaining. <br> A completed long rest restores both.</p>
 ${choices.policies.length?field('Dungeon encounter table','rest-table',choices.policies.length>1?[option('','Choose a table',!policy),...choices.policies.map(p=>option(p.id,p.caption,p.id===policy?.id))]:choices.policies.map(p=>option(p.id,p.caption,true))):''}
 <p class="rest-danger-note">${escape(waiting||restRiskSummary(policy))}</p>${policy?.minArea?`<p>Source restriction: areas ${policy.minArea} and beyond. Safe areas do not make checks.</p>`:''}${policy?.areaIds?'<p>This source table applies only in its authored room.</p>':''}
 <div class="rest-choice"><h3>Short rest · 1 hour</h3><p>Recover half maximum HP and short-rest resources. Spell slots recover only when their class rules allow it.${policy?' Up to '+checks(1)+' encounter checks at this location.':''}</p>${actionButton('Short rest ('+shortRestsLeft(battle)+'/2 left)','short-rest',{disabled:Boolean(disabled||restBlocked(battle))})}</div>
 <div class="rest-choice"><h3>Long rest · 8 hours</h3><p>Recover HP, spell slots and class resources.${policy?' Up to '+checks(8)+' encounter checks at this location.':''}</p>${actionButton('Long rest','long-rest',{disabled:Boolean(disabled||restBlocked(battle,true))})}</div>
 <p role="status">${escape(disabled||restBlocked(battle,true)||status)}</p>`;
}

function gameOptions(actor) {
  const dominateSelected = () => {
    if (!(context.game && category === 'dominate' && actor && canControl(actor) && actorIsUp(actor) && !incapacitated(actor) && !battle.classReaction && !battle.movement)) return '';
    const entry = hotbarEntries(actor).find(item => item.id === hotbarSelection);
    if (entry?.mode !== 'dominate') return '';
    return `<div class="hotbar-selected-heading"><span>${icon(entry.symbol, 23)}<strong>${escape(entry.name)}</strong></span>
      <button type="button" class="game-button" data-play="hotbar-cancel" aria-label="Cancel selected action">${icon('close', 15)}</button></div>` +
      dominateOptions(actor);
  };
  if (!actor || !canControl(actor) || !actorIsUp(actor) || incapacitated(actor) || battle.classReaction || battle.movement ||
    battle.round && !canTakeTurn(battle, actor)) return dominateSelected() || playOptions(actor);
  if (hotbarTools) return '<div class="hotbar-selected-heading"><strong>Checks' + (!battle.round ? ' & resting' : '') + '</strong>' + actionButton('Close', 'hotbar-cancel') + '</div>' + hotbarUtilities(actor);
  const entry = hotbarEntries(actor).find(entry => entry.id === hotbarSelection);
  if (!entry || entry.mode === 'move') return pendingSquare ? '<div class="play-action-row">' + actionButton('Move here', 'commit-move', { primary: true }) + actionButton('Cancel', 'hotbar-cancel') + '</div>' : '';
  return `<div class="hotbar-selected-heading"><span>${icon(entry.symbol, 23)}<strong>${escape(entry.name)}</strong></span>
    <button type="button" class="game-button" data-play="hotbar-cancel" aria-label="Cancel selected action">${icon('close', 15)}</button></div>` +
    playOptions(actor);
}

function playOptions(actor) {
  if (!actor || (!battle.round && !context.game)) return "";
  if (battle.classReaction) {
    const monk = battle.actors.find(actor => actor.id === battle.classReaction.actor);
    if (!canControl(monk)) return '<p>Waiting for ' + escape(monk.name) + '’s Deflect Missiles reaction.</p>';
    const visible = visibleTokens();
    const targets = battle.actors.filter(target => target.id !== monk.id && actorIsUp(target) && occupies(target) && (!visible || visible.has(target.id)) && distanceFt(monk, target) <= 60)
      .sort((a, b) => Number(b.id === battle.classReaction.source) - Number(a.id === battle.classReaction.source));
    return `<form id="deflect-form" class="play-form"><strong>${escape(monk.name)} · Deflect Missiles</strong>
      <p>Damage reduced to zero. Return the missile as part of this reaction for 1 Ki (range 20/60 ft).</p>
      ${field("Return missile target", "deflect-target", targets.map(target => option(target.id, target.name)))}
      <label><input type="checkbox" name="deflect-fits" required> The missile fits in one hand</label>
      <div class="play-action-row"><button class="button primary small" type="submit"${!targets.length ? ' disabled' : ''}>Return missile · 1 Ki</button>
      ${actionButton("Finish reaction", "finish-deflect")}</div></form>`;
  }
  const reaction = opportunity(battle);
  if (reaction?.foe.side === "hostile") return "<p>The game is resolving " + escape(reaction.foe.name) + "’s reaction.</p>";
  if (reaction && !canControl(reaction.foe)) return "<p>Waiting for " + escape(reaction.foe.name) + "’s reaction.</p>";
  if (reaction) return `<form id="reaction-form" class="play-form">
    <p>${escape(reaction.foe.name)} can use their reaction to attack ${escape(reaction.actor.name)} as it leaves reach.</p>
    ${field("Opportunity attack", "reaction-attack", reaction.attacks.map((attack, index) => option(index, attack.name)))}
    <div class="play-action-row"><button class="button primary small" type="submit">Roll reaction</button>${actionButton("Pass", "pass-reaction")}</div>
  </form>`;
  if (actor.side === "hostile") return "<p>The game is running " + escape(actor.name) + "’s turn.</p>";
  if (!canControl(actor)) return "<p>Waiting for " + escape(actor.name) + ".</p>";
  // Telepathic Dominate commands are free and usable while conscious, including off-turn.
  if (context.game && category === "dominate" && actorIsUp(actor) && !incapacitated(actor)) return dominateOptions(actor);
  if (battle.round && !canTakeTurn(battle, actor)) return '<div class="play-action-row">' +
    (pendingSquare ? actionButton("Move here", "commit-move", { primary: true }) : "") +
    "<p>Waiting for this character’s next turn.</p></div>";
  if (actor.hp === 0) return battle.round && actor.resolveDeath
    ? `<p>${actor.stable ? "Stable at 0 HP" : "Unconscious · " + actor.successes + " successes, " + actor.failures + " failures"}</p>
      ${actor.stable || turnView(battle, actor).deathRolled ? "" : actionButton("Roll death save", "death", { primary: true })}` : "";
  if (incapacitated(actor)) return "<p>" + (condition(actor, "Asleep") ? "Asleep" : "Paralyzed") + "</p>";
  if (context.game && category === 'interact') return worldInteractionPanel(actor);
  if (context.game && (category === 'investigate' || category === 'use-feature')) return featureExplorationPanel(actor, category);
  if(context.game&&category==='spell-zone-choice'){
    const entry=hotbarEntries(actor).find(entry=>entry.id===hotbarSelection),castReason=entry&&entryReason(actor,battle,{...entry,controlZone:null},canControl(actor)),controlReason=entryReason(actor,battle,{mode:'common',timing:'bonus',actionId:'control-spell-zone'},canControl(actor));
    return '<div class="item-action-choices">'+actionButton('Control sphere · Bonus action','sphere-control',{disabled:Boolean(controlReason)})+actionButton('Cast again · Action','sphere-recast',{disabled:Boolean(castReason)})+'</div><p>Control the active sphere without another spell slot, or cast a replacement.</p>';
  }
  if(context.game&&category==='spell-zone')return '<p>Choose a destination or creature to ram. Uses a bonus action, with no additional spell slot.</p>';
  if(context.game&&category==='zone-beam')return '<p>Choose a creature you can see within 60 feet of the wall. Uses your action for a ranged spell attack.</p>';
  if (context.game && category === "feature") return featureOptions(actor);
  if (context.game && category === "dominate") return dominateOptions(actor);
  const { list, index, choice, targets, target } = combatSelection(actor, visibleTokens());
  const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.reference || choice.data.key) : null;
  const pickArea = effect?.area || effect?.cone || effect?.teleport;
  const pickTarget = choice && (choice.mode !== "potion" || potionUse === 'throw') && !effect?.self && !pickArea;
  const asleep = battle.round && battle.actors.find((target) => occupies(target) && target.side === actor.side &&
    (condition(target, "Asleep") || condition(target, "Hypnotic Pattern")) && distanceFt(actor, target) <= 5);
  const moveActions = battle.round ? ["dash", "dodge", "disengage"].map((act) =>
    actionButton(act.charAt(0).toUpperCase() + act.slice(1), act, { disabled: Boolean(turnView(battle, actor).action) })).join("") +
    (actor.nimbleEscape || hasFeature(actor, "Cunning Action") ? actionButton("Disengage (bonus)", "bonus-disengage", { disabled: turnView(battle, actor).bonusUsed }) : "") +
    (actor.prone ? actionButton("Stand up", "stand") : "") +
    (asleep && !turnView(battle, actor).action ? actionButton("Wake " + asleep.name, "wake", { id: asleep.id }) : "") : "";
  if (context.game && category === "move") return '<div class="play-action-row">' +
    (pendingSquare ? actionButton("Move here", "commit-move", { primary: true }) : "") + moveActions + '</div>';
  const legalChoices = list.map((entry, index) => ({ entry, index })).filter(({ entry }) => !context.game ||
    entry.mode === category || (category === "weapon" && entry.mode === "custom"));
  if (!legalChoices.length) return `<p>${category === "spell" ? "This character has no listed spells." : "This character has no usable items."}</p>`;
  const usage = choice?.mode === "spell" && choice.data.castUsage;
  const featurePool = usage?.resource && actor.resources?.[usage.resource];
  const pact = actor.resources?.pactMagic;
  const slotOptions = choice?.mode === "spell" && choice.data.level
    ? [...(usage && (usage.atWill || featurePool?.current >= (usage.cost ?? 1)) ? [["0", { feature: true, current: featurePool?.current }]] : []),
    ...(usage?.itemOnly ? [] : Object.entries(actor.slots).filter(([level, pool]) => Number(level) >= choice.data.level && pool.current > 0)),
    ...(!usage?.itemOnly && pact?.current > 0 && pact.slotLevel >= choice.data.level ? [["pact:" + pact.slotLevel, pact]] : [])]
    : [];
  const selectedRank = slotRank(castSlot || slotOptions[0]?.[0] || 0);
  const rank = selectedRank || (usage ? choice.data.level : 0);
  const auxiliary = effect ? spellTargetCount(effect, actor.level, rank) - 1 : 0;
  const spellTargets = effect?.humanoid ? targets.filter((entry) => !entry.creatureType || entry.creatureType === "humanoid") :
    effect?.breath ? targets.filter((entry) => entry.side === actor.side) : targets;
  const sneak=choice?.mode==='weapon'&&actor.classRules?.sneakDice&&target?sneakAttackStatus(battle,actor,target,choice.data,{mode:rollMode,map}):null;
  const missingWeaponTarget = context.game && category === "weapon" && pickTarget && !target;
  return `<form class="play-form" id="combat-form">
    ${choice?.mode === 'potion' ? `<div class="item-action-choices" role="group" aria-label="Potion use"><button type="button" data-play="potion-use" data-id="drink" aria-pressed="${potionUse === 'drink'}">Drink</button><button type="button" data-play="potion-use" data-id="throw" aria-pressed="${potionUse === 'throw'}">Throw · 30 ft</button></div>` : ''}
    ${context.game ? '' : field("Action", "combat-choice", [
    option("", "Choose " + (context.game ? { weapon: "a weapon", spell: "a spell", potion: "an item" }[category] : "an action"), index === ""),
    ...legalChoices.map(({ entry, index: position }) => option(String(position), entry.name + (entry.data?.prepared === false ? " · unprepared" : entry.usable ? "" : " · manual"), index === String(position)))])}
    ${effect?.custom&&allowsWallRing(effect.definition)?field('Wall form','spell-wall-form',[['wall','Wall'],['ring','Ring']].map(([value,label])=>option(value,label,value===spellWallForm))):''}
    ${effect?.custom&&['wall','ring'].includes(formRule(effect.definition,allowsWallRing(effect.definition)?spellWallForm:undefined).shape)?field('Damaging side','spell-hot-side',(formRule(effect.definition,allowsWallRing(effect.definition)?spellWallForm:undefined).shape==='ring'?[['inside','Inside'],['outside','Outside']]:[['left','Left of drawn wall'],['right','Right of drawn wall']]).map(([value,label])=>option(value,label,value===spellHotSide))):''}
    ${effect?.custom&&effect.definition.weaponAttack?field('Melee weapon','spell-weapon',classWeapons(actor,battle).filter(weapon=>!weapon.normalRange&&Number.isFinite(weapon.bonus)).map((weapon,index)=>option(String(index),weapon.name,true))||[option('','No melee weapon')]):''}
    ${pickArea ? `<p class="game-spell-note">${spellSquare ? "Selected square " + (spellSquare.x + 1) + ", " + (spellSquare.y + 1) + (spellEnd ? " → " + (spellEnd.x + 1) + ", " + (spellEnd.y + 1) : "") :
      effect.custom&&needsEndpoint(formRule(effect.definition,allowsWallRing(effect.definition)?spellWallForm:undefined))?'Choose a start point, then the wall endpoint.':effect.custom&&directional(formRule(effect.definition,allowsWallRing(effect.definition)?spellWallForm:undefined))||effect.cone?'Choose the direction of the effect on the map.':effect.teleport ? "Choose an unoccupied destination on the map." :
        "Choose a point on the map. The square can be empty."}</p>` : ""}
    ${pickTarget ? field("Target", "target-select", [option("", "Choose target", !target),
        ...spellTargets.map((entry) => {
          const tag = entry.side === 'party' && actor && !sameParty(actor, entry) ? ' · ' + partyLabel(actorPartyId(entry)) :
            entry.side === 'party' && actor && entry.id !== actor.id ? ' · PC' : entry.side === 'hostile' ? '' : '';
          return option(entry.id, entry.name + tag, entry.id === target?.id);
        })]) : ""}
    ${sneak?`<p class="game-spell-note">${sneak.eligible?'+'+sneak.dice+'d6 Sneak Attack on hit':'Sneak Attack: '+escape(sneak.reason)}</p>`:''}
    ${auxiliary ? `<div class="play-field-row">${Array.from({ length: auxiliary }, (_, index) =>
          field((effect.beams ? "Beam " : effect.missiles ? "Dart " : "Target ") + (index + 2), "extra-target-" + index,
            [option("", effect.beams || effect.missiles ? "Same as first target" : "Optional", !extraTargets.get(index)),
            ...spellTargets.map((entry) => option(entry.id, entry.name, entry.id === extraTargets.get(index)))])).join("")}</div>` : ""}
    ${choice?.mode === "spell" && choice.data.level ? field("Spell slot", "cast-slot", slotOptions.length ?
              slotOptions.map(([level, pool]) => option(level, pool.feature ? (choice.data.grantedBy ?? "Feature") + " · " + (usage.atWill ? "at will" : usage.cost ? usage.cost + " " + featurePool.name + " · " + pool.current + " left" : pool.current + " left") :
                (pool.slotLevel ? "Pact Magic · level " + pool.slotLevel : "Level " + level) + " · " + pool.current + " left", level === castSlot)) : [option("", "No available slot or feature use")]) : ""}
    ${effect?.breath ? field("Damage type", "breath-type", breathTypes.map((type) =>
                  option(type, type.charAt(0).toUpperCase() + type.slice(1), type === breathType))) : ""}
    ${choice?.mode === "custom" ? `<div class="play-field-row">
      ${input("Attack bonus", "custom-bonus", customWeapon.bonus, "number", 'required step="1"')}
      ${input("Damage dice", "custom-damage", customWeapon.damage, "text", 'required placeholder="1d8+3"')}
      ${input("Reach (ft)", "custom-reach", customWeapon.reach, "number", 'min="5" placeholder="5"')}
      ${input("Ranged limit (ft)", "custom-range", customWeapon.normalRange, "number", 'min="5" placeholder="Melee"')}
    </div>` : ""}
    ${choice?.mode === "weapon" && !choice.data.normalRange && hasFeature(actor, "Stunning Strike") ?
      '<label class="game-spell-note"><input id="stunning-strike" type="checkbox"' + (actor.stunArmed && actor.resources?.ki?.current > 0 ? ' checked' : '') + '> Stunning Strike on hit (1 Ki)</label>' : ""}
    ${choice?.mode === "weapon" && hasFeature(actor, "Focused Aim") ? field("Focused Aim on a miss", "focused-aim",
        [option("0", "Do not spend Ki", true), ...[1, 2, 3].map(cost => option(cost, "Spend up to " + cost + " Ki to turn a miss into a hit"))]) : ""}
    ${choice && choice.mode !== "potion" && !effect?.self && !effect?.teleport && !effect?.aid && !effect?.breath && !effect?.exhale ? `${context.game ? '<details class="hotbar-roll-options"><summary>Roll options</summary>' : ''}<div class="play-field-row">
      ${field("Roll", "roll-mode", [option("", "Normal", !rollMode), option("advantage", "Advantage", rollMode === "advantage"), option("disadvantage", "Disadvantage", rollMode === "disadvantage")])}
      ${field("Cover", "cover", [option("", "None", !cover), option("2", "Half (+2)", cover === "2"), option("5", "Three-quarters (+5)", cover === "5"), option("full", "Total", cover === "full")])}
    </div>${context.game ? '</details>' : ''}` : ""}
    ${effect?.temporary && actor.tempHp ? '<label class="game-spell-note"><input id="keep-temp" type="checkbox"> Keep current temporary HP</label>' : ""}
    ${choice?.mode === "spell" && choice.data.note ? `<p class="game-spell-note">${escape(choice.data.note)}</p>` : ""}
    ${choice?.mode === "spell" && choice.data.reference ? `<button type="button" class="spell-link" data-action="spell" data-id="${escape(choice.data.reference)}">Spell library</button>` : ""}
    ${choice && !choice.usable ? `<p class="play-hint">${choice.data?.prepared === false ? "This spell is unprepared." :
      choice.data?.customUse ? "This spell uses a custom rule or item charge from the sheet." : "This spell’s effect needs a table ruling."}</p>` : ""}
    <div class="play-action-row">${choice?.usable || choice?.manual ? `<button class="button primary small" type="submit"
      ${missingWeaponTarget || context.game && hotbarEntries(actor).find(entry => entry.id === hotbarSelection)?.reason || choice.mode === "spell" && choice.data.level && !slotOptions.length ? "disabled" : ""}>${effect?.exhale ? "Exhale" :
        choice.mode === "spell" ? (choice.usable ? "Cast spell" : "Record manual cast") : choice.mode === "potion" ? "Use item" : "Roll attack"}</button>` : ""}
      ${!context.game ? moveActions : ""}
      ${actor.concentration?.bolt && battle.round && !turnView(battle, actor).action ? actionButton("Sustain Witch Bolt", "witch-bolt") : ""}
    </div>
  </form>`;
}

function dominateOptions(actor) {
  const entry = hotbarEntries(actor).find((item) => item.id === hotbarSelection);
  const thrall = battle.actors.find((creature) => creature.id === entry?.thrallId);
  if (!thrall) return "<p>That creature is no longer dominated.</p>";
  const targets = battle.actors.filter((creature) => occupies(creature) && actorIsUp(creature) && creature.id !== thrall.id)
    .sort((a, b) => distanceFt(thrall, a) - distanceFt(thrall, b));
  const order = thrall.dominateOrder;
  const orderLabel = order ? (DOMINATE_ORDERS.find((item) => item.id === order.kind)?.label ?? order.kind) +
    (order.targetId ? " " + (battle.actors.find((creature) => creature.id === order.targetId)?.name ?? "") : "") : "";
  const actionUsed = battle.round && turnView(battle, actor).action;
  const offTurn = battle.round && !canTakeTurn(battle, actor);
  return `<form id="dominate-form" class="play-form">
    <p>${escape(thrall.name)} is dominated.${thrall.dominateControl?.from === actor.id ? " Total control is active." : ""}${order ? " Standing order: " + escape(orderLabel.trim()) + "." : " No standing order."}</p>
    ${field("Command", "dominate-order", DOMINATE_ORDERS.map((item) => option(item.id, item.label + (item.needsTarget ? "" : " · no target"), item.id === (order?.kind || "attack"))))}
    ${field("Target", "dominate-target", [option("", "Choose target", true), ...targets.map((creature) => option(creature.id, creature.name))])}
    <p class="game-spell-note">Telepathic commands are free and can be issued any time you are conscious. Total control spends your action and lasts until the end of your next turn.</p>
    <div class="play-action-row">
      <button class="button primary small" type="submit" name="dominate-intent" value="command">Issue command</button>
      <button class="button outline small" type="submit" name="dominate-intent" value="control"${actionUsed || offTurn || !battle.round ? " disabled" : ""}>Total control</button>
    </div>
  </form>`;
}

function featureOptions(actor) {
  const resources = Object.values(actor.resources ?? {}).map((pool) => "<span>" + escape(pool.name) + " " + pool.current + " / " + pool.maximum + "</span>").join("");
  const skills = Object.entries(actor.skillBonuses ?? {}).filter(([, bonus]) => Number.isFinite(bonus));
  const checks = skills.length ? `<form id="class-skill-form" class="play-form">${field("Skill check", "class-skill",
    skills.map(([name]) => option(name, name)))}<button class="button outline small" type="submit">Roll check</button></form>` : "";
  const inspiration = actor.inspiration ? actionButton(actor.inspirationArmed ? "Cancel inspiration" : "Use inspiration on next roll", "arm-inspiration") : "";
  const cuttingWords = hasFeature(actor, "Cutting Words") ? actionButton(actor.cuttingWords ? "Cutting Words reactions on" : "Enable Cutting Words reactions", "cutting-words") : "";
  const freeHand = hasFeature(actor, "Deflect Missiles") ? actionButton("Free hand for catching missiles: " + (actor.freeHand ? "Yes" : "No"), "deflect-hand") : "";
  const reactionArm = reactionSpells(actor, battle.spellRules).map(({spell, rule}) => {
    const ref = rule.reference, armed = isArmed(actor, ref);
    return actionButton((armed ? "Armed · " : "Arm · ") + rule.name, armed ? "disarm-reaction" : "arm-reaction", {id: ref});
  }).join("");
  if (!battle.round) return '<div class="feature-resource-row">' + resources + '</div><div class="play-action-row">' +
    actionButton("Rest · "+shortRestsLeft(battle)+" short rests left", "game-rest") +
    actionButton("Feature rules", "inspect", { id: actor.id }) + inspiration + cuttingWords + freeHand + reactionArm + "</div>" + checks;
  const actions = classActions(actor, battle);
  const entry = actions.find((action) => action.id === featureChoice) ?? actions[0];
  const visible = visibleTokens();
  const targets = battle.actors.filter((actor) => occupies(actor) && actorIsUp(actor) && (!visible || visible.has(actor.id)));
  const enemies = targets.filter((target) => target.side !== actor.side && target.side !== "neutral").sort((a, b) => distanceFt(actor, a) - distanceFt(actor, b));
  const targetList = entry?.target === "ally" ? targets.filter((target) => target.side === actor.side && target !== actor) : enemies;
  const unarmed = classWeapons(actor, battle).filter((weapon) => weapon.unarmed || entry?.monkWeapon && weapon.monkWeapon);
  const used = entry?.timing === "bonus" && turnView(battle, actor).bonusUsed || entry?.timing === "action" && turnView(battle, actor).action ||
    entry?.resource && !(actor.resources?.[entry.resource]?.current >= entry.cost) || entry?.id === "ki-fueled" && !turnView(battle, actor).kiAction;
  return (context.game ? '' : '<div class="feature-resource-row">' + resources + "</div>") + (entry ? `<form id="class-action-form" class="play-form">
    ${context.game ? '<input type="hidden" id="feature-select" value="' + escape(entry.id) + '">' : field("Class ability", "feature-select", actions.map((action) => option(action.id, action.name +
    (action.resource ? " · " + action.cost + " " + actor.resources[action.resource].name : ""), action.id === entry.id)))}
    ${entry.target || entry.attack ? field("Target", "feature-target", targetList.map((target, index) =>
      option(target.id, target.name, index === 0))) : ""}
    ${entry.attack ? field(entry.monkWeapon ? "Monk weapon or unarmed strike" : "Unarmed strike", "feature-unarmed", unarmed.map((weapon, index) => option(index, weapon.name, index === 0))) : ""}
    ${entry.area ? `<fieldset class="feature-burst-targets"><legend>Astral Arms targets within 10 ft</legend>${targets.filter((target) =>
        target !== actor && distanceFt(actor, target) <= 10).map((target) => `<label><input type="checkbox" name="burst-target"
      value="${escape(target.id)}"${target.side === "hostile" ? " checked" : ""}> ${escape(target.name)}</label>`).join("")}</fieldset>` : ""}
    <button class="button primary small" type="submit"${used || entry.attack && !enemies.length ? " disabled" : ""}>Use ability</button>
  </form>` : "<p>Open the character’s Actions tab to read its class features.</p>") +
    '<details class="hotbar-utilities"><summary>More class controls</summary><div class="play-action-row">' + actionButton("Feature rules", "inspect", { id: actor.id }) + inspiration + cuttingWords + freeHand + reactionArm + "</div>" + checks + '</details>';
}

function setupControls() {
  if (battle.round || sceneJobs.has(battle)) return "";
  const eligible = context.characters.filter((character) => !battle.actors.some((actor) => actor.id === "party:" + character.id));
  return `<div class="play-stack">
    ${eligible.length ? `<div class="play-inline">
      ${field("Party member", "play-party", [option("", "Choose character", !selectedParty),
  ...eligible.map((character) => option(character.id, character.name, character.id === selectedParty))])}
      ${spawnField("play-spawn", selectedSpawnId)}
      ${actionButton("Add token", "add-party", { disabled: !selectedParty })}
    </div>` : battle.actors.some((actor) => actor.side === "party") ? "" : '<p><a class="text-link" href="#characters">Import a party member</a> to place your character on the map.</p>'}
    ${hasArchive() ? `<form id="creature-form" class="play-inline">
      ${input("Monster name", "creature-name", "", "search", 'required placeholder="Goblin"')}
      ${input("Source", "creature-source", "MM", "text", 'required maxlength="24"')}
      ${field("Side", "creature-side", [option("hostile", "Hostile"), option("neutral", "Neutral"), option("party", "Friendly")])}
      <button class="button outline small" type="submit">Add monster</button>
    </form>` : ""}
  </div>`;
}

function sceneMarkers(region) {
  const markers = (battle.markers ?? []).filter((marker) => marker.origin === areaKey(region));
  const features = featuresInRegion(battle, areaKey(region));
  if (!markers.length && !features.length) return "";
  return '<ul class="scene-markers">' + markers.map((marker) => `<li>
    ${actionButton(marker.name, "inspect-marker", { id: marker.id })}
    ${marker.hidden && !marker.revealed ? actionButton("Reveal", "reveal-marker", { id: marker.id }) : ""}
  </li>`).join("") + features.filter((feature) => !markers.some((marker) => marker.id === feature.id)).map((feature) => `<li>
    <span>${escape(feature.name)} · ${escape(feature.state)}</span>
    ${feature.state === "hidden" || feature.state === "hinted" ? actionButton("Reveal", "reveal-feature", { id: feature.id }) : ""}
  </li>`).join("") + "</ul>";
}

function roomPanel() {
  const roster = room ? roomRoster(map, room) : [];
  const homebrew = listHomebrew("monsters");
  const authored = map.module === "LMoP" && map.id === "1ab";
  const starting = battle.actors.filter((actor) => actor.origin === areaKey(room) && actor.side !== "party");
  const unavailable = battle.unplacedScene?.[areaKey(room)] ?? 0;
  return `<section class="play-panel">
    <h2>Room</h2>
    ${map.regions.length ? field("Map area", "play-room", [option("", "Choose a room", !room),
  ...map.regions.map((region) => {
    const id = areaKey(region);
    const instance = id === region.id ? "" : " (" + id.split(":").at(-1) + ")";
    return option(id, (region.entry?.name ?? region.id) + instance, id === areaKey(room));
  })]) : '<p>The archive has no tagged rooms for this map.</p>'}
    ${room ? `<div class="room-body">
       ${roomNotes[room.id] && authored ? `<p class="play-hint">${roomNotes[room.id]}</p>` : ""}
       ${starting.length ? `<p>${plural(starting.length, "room token")}${starting.some(({ dead }) => dead) ?
        " · " + starting.filter(({ dead }) => dead).length + " defeated" : ""}</p>` : ""}
       ${unavailable ? `<p>${plural(unavailable, "creature")} need more space for placement.</p>` : ""}
       ${authored && room.id === "021" && !battle.round && starting.some((actor) => actor.kennelWolf && actor.chained && !actor.dead)
        ? actionButton("Set wolves hostile", "release-wolves") : ""}
       ${!battle.round && !sceneJobs.has(battle) && roster.length ? `<div class="play-inline">
         ${field("Creature reference", "room-creature", roster.map((entry, index) => option(index, entry.nickname ?? entry.name, index === selectedCreature)))}
         ${actionButton("Add token", "add-room-monster")}
       </div>` : ""}
       ${!battle.round && !sceneJobs.has(battle) && homebrew.length ? `<div class="play-inline">
         ${field("Homebrew creature", "homebrew-creature", homebrew.map((entry, index) => option(index, entry.name, index === selectedHomebrew)))}
         ${actionButton("Add homebrew", "add-homebrew-monster")}
       </div>` : !battle.round && !homebrew.length ? '<p class="play-hint">Save creatures under Homebrew to place custom tokens here.</p>' : ""}
       ${sceneMarkers(room)}
       ${room.entry ? `<details><summary>Room entry</summary><div class="room-text">${formatEntries(room.entry.entries)}</div></details>` : ""}
    </div>` : '<p>Pick an area from the list or select a highlighted room on the grid.</p>'}
  </section>`;
}

function manualHP() {
  const actors = battle.actors.filter((actor) => !actor.dead);
  if (!actors.length) return "";
  return `<details class="manual-hp">
    <summary>Apply a manual ruling</summary>
    <form id="manual-hp-form" class="play-form">
      ${field("Token", "manual-target", actors.map((actor) => option(actor.id, actor.name, actor.id === targetId)))}
      <div class="play-field-row">
        ${field("Effect", "manual-effect", [option("damage", "Damage"), option("heal", "Healing")])}
        ${input("Amount", "manual-amount", "", "number", 'min="0" max="999" required')}
      </div>
      ${field("Damage type", "manual-type", ["untyped", "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]
    .map((type) => option(type, type.charAt(0).toUpperCase() + type.slice(1))))}
      <button type="submit" class="button outline small">Apply effect</button>
    </form>
  </details><details class="manual-hp"><summary>Falling damage</summary><form id="fall-form" class="play-form">
    ${field("Falling character", "fall-target", actors.filter(canControl).map(actor => option(actor.id, actor.name, actor.id === selectedId)))}
    ${input("Fall height (ft)", "fall-height", 10, "number", 'min="0" max="10000" step="5" required')}
    <label><input name="slow-fall" type="checkbox" checked> Use Slow Fall if available (reaction)</label>
    <button class="button outline small" type="submit">Resolve fall</button></form></details>`;
}

function tokenPanel() {
  const ordered = battle.round ? battle.order.map((id) => battle.actors.find((record) => record.id === id)).filter(Boolean) : battle.actors;
  const actor = selectedActor();
  const canStart = !sceneJobs.has(battle) && canRollInitiative();
  return `<section class="play-panel token-panel">
    <div class="play-heading"><h2>${battle.round ? "Initiative" : "Tokens"}</h2>
      ${battle.round ? `<span class="tag">Round ${battle.round}</span>` : ""}
    </div>
    ${ordered.length ? `<div class="play-tokens">${ordered.map((entry, index) =>
    `<button type="button" class="play-token${entry.id === actor?.id ? " active-token" : ""}${entry.dead ? " defeated" : ""}"
        data-play="token" data-id="${escape(entry.id)}" aria-pressed="${entry.id === (battle.round ? targetId : selectedId)}">
        <span class="token-marker token-${entry.side}" aria-hidden="true">
          <span data-token-initial>${escape(entry.marker ?? entry.name.charAt(0).toUpperCase())}</span>
          <canvas data-creature-portrait="${escape(entry.id)}" hidden></canvas>
        </span>
        <span><strong>${escape(entry.name)}</strong><small>${entry.hp} / ${entry.maxHp} HP · AC ${entry.ac}
          ${entry.side === "hostile" ? " · Game controlled" : entry.side === "neutral" ? " · Neutral" : ""}${entry.tempHp ? " · +" + entry.tempHp + " temp" : ""}${entry.prone ? " · Prone" : ""}${entry.dead ? " · Defeated" : ""}</small></span>
        ${battle.round ? `<span class="initiative-value" title="Initiative">${entry.initiativeRoll ?? index + 1}</span>` : ""}
      </button>`).join("")}</div>` : sceneJobs.has(battle) ? '<p role="status">Placing room tokens…</p>' : '<p>Add a party member or a creature from the room entries.</p>'}
    ${setupControls()}
    ${actor && !battle.round ? `<form class="token-settings" id="token-settings">
      <div class="play-field-row">
        ${input("Attacks per Attack action", "actor-swings", actor.swings, "number", 'min="1" max="8" required')}
        ${input("Current HP", "actor-hp", actor.hp, "number", 'min="0" max="' + actor.maxHp + '" required')}
        ${!actor.id.startsWith("party:") && actor.side !== "party" ? field("Disposition", "actor-side",
      [option("hostile", "Hostile", actor.side === "hostile"), option("neutral", "Neutral", actor.side === "neutral")]) : ""}
      </div>
      ${actor.spells.length ? `<div class="play-field-row">
        ${input("Spell save DC", "actor-spell-dc", actor.spellDC, "number", 'min="1" max="40"')}
        ${input("Spell attack bonus", "actor-spell-attack", actor.spellAttack, "number", 'min="-10" max="30"')}
        ${input("Spellcasting modifier", "actor-spell-ability", actor.spellAbility, "number", 'min="-10" max="15"')}
      </div>` : ""}
      ${Object.keys(actor.slots).length ? `<details><summary>Spell slots</summary><div class="play-field-row slot-fields">${Object.entries(actor.slots).map(([level, pool]) =>
        input("Level " + level + (pool.maximum != null ? " / " + pool.maximum : ""), "slot-" + level, pool.current ?? "", "number",
          'min="0" max="' + (pool.maximum ?? 20) + '"')).join("")}</div></details>` : ""}
      <div class="play-action-row"><button type="submit" class="button outline small">Save token</button>
        ${importedCharacter(actor) ? actionButton("Update token from sheet", "refresh-party-token") : ""}${actionButton("Remove token", "remove-token")}</div>
    </form>` : ""}
    ${battle.round && actor ? `<div class="turn-info">
      <h3>${escape(actor.name)}’s turn</h3>
      ${canControl(actor) ? `<p>${moveLeft(battle, actor)} ft left · ${turnView(battle, actor).action ? (turnView(battle, actor).action === "attack" && turnView(battle, actor).attacksMade < actor.swings ? (actor.swings - turnView(battle, actor).attacksMade) + " attacks left" : "Action used") : "Action ready"} · ${turnView(battle, actor).bonusUsed ? "Bonus action used" : "Bonus action ready"}</p>` : ""}
      ${playOptions(actor)}
    </div>` : ""}
    <div class="play-action-row">
      ${battle.round ? canControl(actor) ? actionButton("End turn", "end", { primary: true, disabled: Boolean(battle.movement) }) : ""
      : actionButton("Roll initiative", "start", { primary: true, disabled: !canStart })}
      ${battle.round ? actionButton("End initiative", "end-initiative", { disabled: Boolean(battle.movement) }) : ""}
      ${battle.round || battle.actors.length ? actionButton("Reset encounter", "reset") : ""}
    </div>
    ${manualHP()}
  </section>`;
}

function archivePanel() {
  return `<details class="play-archive"${!hasArchive() ? " open" : ""}>
    <summary>5etools archive <span>${archiveName() ? escape(archiveName()) : "Attach a ZIP to play adventure maps"}</span></summary>
    <div class="play-archive-body">
      <p>Open your 5etools ZIP in this browser to load adventure maps, room entries, and stat blocks.</p>
      <div class="play-action-row">
        ${actionButton(hasArchive() ? "Change ZIP" : "Choose 5etools ZIP", "archive-picker", { primary: !hasArchive(), disabled: pending })}
        ${context.localArchive ? actionButton("Use supplied archive", "archive-local", { disabled: pending }) : ""}
      </div>
      <input type="file" id="play-archive-file" accept=".zip,application/zip" hidden>
    </div>
  </details>`;
}

function formatPixels(value) {
  return String(Math.round(value * 100) / 100);
}

function gridSettings() {
  if (!map.sourceGrid) return "";
  const alignment = gridDraft ?? map.printedGrid;
  const artFit = currentArtworkFit();
  const squareFt = currentSquareFt();
  const fields = [
    ["Square width", "width", 'min="1"'], ["Square height", "height", 'min="1"'],
    ["Horizontal offset", "x", ""], ["Vertical offset", "y", ""],
  ];
  return `<details id="grid-settings" class="grid-settings">
    <summary>Map image placement &amp; grid</summary>
    <div class="grid-settings-body">
      <p class="play-hint">Rooms, monsters, and markers stay fixed. Move the uploaded picture underneath them.</p>
      <form id="art-fit-form" class="play-form">
        <div class="play-field-row">
          ${input("Image scale (%)", "art-fit-scale", formatPixels(artFit.scale * 100), "number", 'min="25" max="400" step="0.1"')}
          ${input("Shift right (px)", "art-fit-x", formatPixels(artFit.x), "number", 'step="any"')}
          ${input("Shift down (px)", "art-fit-y", formatPixels(artFit.y), "number", 'step="any"')}
        </div>
        <p id="art-fit-feedback" role="status" class="play-hint">${calibrateGrid || artFitDraft ? "Previewing image placement. Save when rooms sit on the right parts of the picture." : ""}</p>
        <div class="play-action-row">
          <button type="submit" class="button primary small">Save image placement</button>
          ${actionButton("Reset image placement", "reset-art-fit")}
        </div>
      </form>
      ${field("Grid display", "grid-overlay", Object.entries(gridModes).map(([mode, label]) =>
    option(mode, label, (battle.gridOverlay ?? "artwork") === mode)))}
      ${field("Printed square", "grid-square-ft", [
        option(5, "5 feet (1 tactical cell)", squareFt === 5),
        option(10, "10 feet (2×2 tactical cells)", squareFt === 10),
      ])}
      <p class="play-hint"><strong id="grid-align-source">${alignmentDescription()}</strong> · Optional: match orange guides to printed squares. Each printed square is ${squareFt} ft; movement still uses 5-foot cells.</p>
      <form id="grid-align-form" class="play-form">
        <div class="play-field-row grid-scale-row">
          ${input("Square scale (%)", "grid-align-scale", formatPixels(scaleFromAlignment(alignment)), "number", 'min="25" max="400" step="0.1"')}
        </div>
        <div class="play-field-row">${fields.map(([label, key, limit]) =>
      input(label + " (px)", "grid-align-" + key, formatPixels(alignment[key]), "number", limit + ' step="any" required')).join("")}</div>
        <p id="grid-align-feedback" role="status" class="play-hint">${gridDraft ? "Previewing the adjusted guides. Save when the orange lines match the printed squares." : ""}</p>
        <div class="play-action-row">
          <button type="submit" class="button primary small">Save grid alignment</button>
          ${actionButton("Reset grid to automatic", "reset-grid")}
        </div>
      </form>
    </div>
  </details>`;
}

function readAlignment() {
  const form = root().querySelector("#grid-align-form");
  const alignment = Object.fromEntries(gridFields.map((field) => [field, form.querySelector("#grid-align-" + field).valueAsNumber]));
  return gridFields.every((field) => Number.isFinite(alignment[field])) && alignment.width > 0 && alignment.height > 0 ? alignment : null;
}

function playPage() {
  if (context.hubEntry) return hubEntryPage();
  if(!context.newRoom)return roomList(rooms,{loading:roomsLoading,error:roomsError,deleting:deletingRoom})+joinPanel();
  if (roomDraft.adventure === "YPHub") roomDraft.adventure = "training";
  const isTraining=roomDraft.adventure==="training";
  const ready=map.module===roomDraft.adventure && (isBuiltinModule(roomDraft.adventure)||hasArchive());
  const adventures=context.adventures.filter(entry=>entry.maps?.some(item=>item.grid==="square"));
  const moduleOptions=[
    option("training","Wayfarer practice yard",isTraining),
    ...adventures.map(entry=>option(entry.id,entry.name,roomDraft.adventure===entry.id)),
  ];
  if(!isBuiltinModule(roomDraft.adventure)&&!adventures.some(entry=>entry.id===roomDraft.adventure))moduleOptions.push(option(roomDraft.adventure,roomDraft.adventure,true));
  const tools = [
    ["room", "Inspect room"],
    ["move", battle.round ? "Move token" : "Place token"],
    ["spawn", "Place spawn point"],
    ["difficult", "Difficult terrain"],
    ["clear", "Clear terrain"]
  ];
  return `<section id="room-setup" class="room-setup">
    <header class="play-header"><div><h1>New adventure room</h1><p>Start a campaign or practice table. Meet at the Yawning Portal first if you want a shared hub.</p></div>
      <div class="play-header-actions"><a class="button outline small" href="#hub">Yawning Portal</a><a class="text-link" href="#play">Back to rooms</a></div></header>
    ${roomCreationForm(moduleOptions,ready)}
    ${ready?`<details class="room-advanced"><summary>Advanced encounter setup</summary>
    <div class="room-advanced-body">
    <div class="play-action-row">
      ${actionButton(pending || sceneJobs.has(battle) ? "Preparing…" : "Preview encounter", "enter-game", { disabled: pending || sceneJobs.has(battle) })}
    </div>
    <label class="room-prepared"><input id="new-room-prepared" type="checkbox" ${roomDraft.prepared ? 'checked' : ''}> Use the prepared encounter, including its current party and progress</label>
    ${hasArchive()?archivePanel():""}
    <div class="play-layout">
      <div class="play-main">
        <section class="play-panel play-board-panel">
          <div class="play-heading board-title"><h2>${escape(map.title)}</h2>
            ${!isBuiltinModule(roomDraft.adventure) ? actionButton(art ? "Change map image" : "Choose map image", "art") : ""}
          </div>
          <input type="file" id="play-art" accept="image/png,image/jpeg,image/webp" hidden>
          ${mapViewport(map)}
          <div class="board-toolbar">
            ${field("Grid tool", "grid-tool", tools.map(([id, label]) => option(id, label, tool === id)))}
            ${mapControls(Boolean(cameraToken()))}
            ${mapHint()}
            <div class="board-key"><span><i></i> Party</span><span><i></i> Hostile</span><span><i></i> Difficult terrain</span><span><i class="map-marker-key"></i> Discovery</span><span><i class="map-spawn-key"></i> Spawn</span></div>
          </div>
          ${tool === "spawn" ? spawnToolPanel() : ""}
          ${!isBuiltinModule(roomDraft.adventure) ? `<p id="map-art-note" class="play-hint" role="status">${escape(artworkNote)}</p>` : ""}
          ${gridSettings()}
          <p class="play-status" role="status">${escape(status)}</p>
        </section>
      </div>
      <div class="play-rail">${tokenPanel()}${roomPanel()}</div>
    </div>
    </div></details>`:""}</section>`;
}

function redraw() {
  const element = root();
  if (!element) return;
  closeDistantInteraction();
  const active = document.activeElement?.id;
  if (context.game && table?.state) document.title = (table.state.room?.name || map.title) + ' · Wayfarer';
  if (!(context.sessionRoute && !table?.state)) clearTimeout(sessionConnectingTimer);
  if (context.sessionRoute && !table?.state) {
    // Dark full-bleed wait — a light paper card flashbangs when the room loads quickly.
    if (table?.needsUsername) {
      element.innerHTML = `<section class="session-entry session-entry-dark"><h1>Join the room</h1>
        <form id="session-username-form" class="session-inline">
          ${input("Username", "session-username", table.usernameDraft ?? rememberedUsername(), "text", 'required maxlength="24" autocomplete="nickname"')}
          <button class="button primary small" type="submit" ${table.joining ? "disabled" : ""}>${table.joining ? "Joining…" : "Join room"}</button><a href="#profile" data-account-return="${escape(sessionHash(table.id))}">Sign in with Google instead</a>
        </form><p role="status">${escape(tableMessage)}</p>
        <a href="#play" class="button outline small">Back to rooms</a></section>`;
      if (active === "session-username") element.querySelector("#session-username")?.focus({ preventScroll: true });
    } else if (table?.error) {
      element.innerHTML = `<div class="session-connecting" role="alert">
        <p>${escape(tableMessage || "Could not reach the room.")}</p>
        ${actionButton("Try again", "retry-session")}
        <a href="#play" class="button outline small">Back to rooms</a>
      </div>`;
    } else {
      // Keep the viewport dark immediately; only show copy after a beat so fast joins never flash.
      element.innerHTML = `<div class="session-connecting" role="status" aria-live="polite" data-pending="true"></div>`;
      const host = element.querySelector(".session-connecting");
      clearTimeout(sessionConnectingTimer);
      sessionConnectingTimer = setTimeout(() => {
        if (!host?.isConnected || table?.state || !context?.sessionRoute) return;
        host.removeAttribute("data-pending");
        host.innerHTML = `<p>${escape(tableMessage || "Entering the room…")}</p>`;
      }, 280);
    }
    return;
  }
  let cameraState = camera?.state();
  if (!context.game) focusedGameMap = null;
  camera?.destroy();
  const advancedOpen = element.querySelector(".room-advanced")?.open;
  const archiveOpen = element.querySelector(".play-archive")?.open;
  const gridOpen = element.querySelector("#grid-settings")?.open;
  const previousHotbar = element.querySelector('.game-hotbar');
  const previousActions = previousHotbar?.querySelector('.hotbar-grid');
  const hotbarScroll = previousActions && { view: previousHotbar.dataset.hotbarView, left: previousActions.scrollLeft, top: previousActions.scrollTop, tabs: previousHotbar.querySelector('.hotbar-tabs').scrollLeft };
  const logScope = table?.id ?? map.key;
  if (eventLogScope !== logScope) { eventLogScroll.clear(); eventLogScope = logScope; }
  rememberEventLogScroll();
  table?.chat?.rememberScroll();
  const hotbarActorNow = selectedActor();
  if (context.game && hotbarActor !== hotbarActorNow?.id) {
    hotbarActor = hotbarActorNow?.id ?? ''; hotbarTab = 'all'; hotbarFilter = ''; hotbarSearch = ''; hotbarSelection = ''; hotbarTools = false;
  }
  const barEntries = context.game ? hotbarEntries(hotbarActorNow) : [];
  const selectedEntry = barEntries.find(entry => entry.id === hotbarSelection);
  if (selectedEntry?.index != null) { combatChoice=String(selectedEntry.index);if(!selectedEntry.controlZone||!['spell-zone-choice','spell-zone'].includes(category))category=selectedEntry.mode; }
  if (selectedEntry?.mode === 'feature') { featureChoice = selectedEntry.actionId; category = 'feature'; }
  if (selectedEntry?.mode === 'dominate') category = 'dominate';
  if (hotbarSelection && !selectedEntry) { hotbarSelection = ''; category = 'move'; resetActionSelection(); }
  prepareHealth();
  ensureParties(battle);
  const myPartyId = viewerParty();
  const partyWiped = Boolean(context.game && partyDefeated(battle, myPartyId));
  if (!partyWiped) defeatedDismissed = false;
  const selectedNow = selectedActor();
  const pvpLeave = Boolean(context.game && isPvpCombat(battle) && selectedNow && canControl(selectedNow) && battle.order.includes(selectedNow.id) && !selectedNow.dead);
  const compact = compactPlayUi();
  if (!compact) actionsSheetOpen = false;
  const showActionsSheet = !compact || actionsSheetOpen;
  const aiming = Boolean(hotbarTools || pendingSquare || (selectedEntry && selectedEntry.mode !== 'move') || ['investigate','use-feature','interact','spell-zone','spell-zone-choice','zone-beam'].includes(category));
  const aimMessage = aiming ? aimBannerCopy(hotbarActorNow, selectedEntry || (pendingSquare ? { mode: 'move', name: 'Move' } : null)) : '';
  element.innerHTML = context.game ? gameScreen({
    map, battle, roomName: table?.state?.room?.name, saveStatus: table?.writing ? 'Saving…' : table?.online ? 'Saved' : 'Offline', selected: displayedActor(selectedNow), party: battle.actors.filter((actor) => actor.side === "party").map(actor => displayedActor(actor)),
    visibleInitiative: visibleTokens(),
    category, actions: gameOptions(selectedNow), tacticalTools: tableTools(), status,
    hotbar: hotbarActorNow ? renderActionBar(barEntries, hotbarActorNow, { tab: hotbarTab, filter: hotbarFilter, query: hotbarSearch, selected: hotbarSelection, expanded: hotbarExpanded || (compact && showActionsSheet), utilitiesOpen: hotbarTools }) : '',
    hubActions: canControl(selectedNow)
      ? [...hubActions(battle, map, selectedNow), ...kennelActions(battle, map, selectedNow)]
      : [],
    actionPanelOpen: Boolean(hotbarTools || selectedEntry && selectedEntry.mode !== 'move' || pendingSquare || battle.classReaction || battle.movement || ['investigate','use-feature','interact'].includes(category) || hotbarActorNow && (!actorIsUp(hotbarActorNow) || incapacitated(hotbarActorNow)) || canControl(hotbarActorNow) && (canRescue(battle, map, hotbarActorNow) || hubActions(battle, map, hotbarActorNow).length || kennelActions(battle, map, hotbarActorNow).length)),
    resourceControls: renderActionResources(hotbarActorNow, battle, hotbarFilter),
    logOpen: eventLogPlacement !== 'hidden' && eventLogMode !== 'collapsed' && (eventLogPlacement !== 'chat' || !table || Boolean(table?.chat?.isOpen)), logHistory: table?.state?.battle.log ?? battle.log, eventLogMode, eventLogPlacement, toolsOpen, destination: previewMessage, cursor, hasToken: Boolean(cameraToken()),
    storyOpen, storyContent: storyOpen ? storyPanel(battle, map) : "",
    rescueAvailable: canControl(selectedNow) && canRescue(battle, map, selectedNow),
    canAct: canControl(selectedNow), controllers: table ? battle.controllers ?? {} : null, controller,
    restOpen,restContent:restOpen?restPanel():'',
    partyOpen, partyContent: partyManagement(), chatOpen: (table?.chat ?? localChat)?.isOpen ?? false,
    tableOpen, tableContent: tableOpen ? tablePanel(table, context.characters, battle, tableMessage, needsHostSignIn, controller) : "",
    shared: Boolean(table), players: table?.players, busy: Boolean(table?.writing),
    adventureName: context.adventures.find(({ id }) => id === map.module)?.name,
    defeated: partyWiped && !defeatedDismissed,
    pvpLeave, truceVoted: Boolean(selectedNow && battle.truceVotes?.[selectedNow.id]),
    compact, actionsSheetOpen: showActionsSheet, aiming, aimMessage,
  }) : playPage();
  const nextHotbar = element.querySelector('.game-hotbar');
  if (hotbarScroll && nextHotbar?.dataset.hotbarView === hotbarScroll.view) {
    const grid = nextHotbar.querySelector('.hotbar-grid');
    grid.scrollLeft = hotbarScroll.left; grid.scrollTop = hotbarScroll.top;
  }
  if (nextHotbar) {
    const tabs = nextHotbar.querySelector('.hotbar-tabs'), selected = tabs.querySelector('[aria-pressed="true"]');
    if (hotbarScroll && nextHotbar.dataset.hotbarView.split('|')[0] === hotbarScroll.view.split('|')[0]) tabs.scrollLeft = hotbarScroll.tabs;
    if (selected.offsetLeft < tabs.scrollLeft) tabs.scrollLeft = selected.offsetLeft;
    else if (selected.offsetLeft + selected.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = selected.offsetLeft + selected.offsetWidth - tabs.clientWidth;
  }
  const chatSlot = element.querySelector(".game-chat-slot");
  const activeChat = table?.chat ?? (localChat ??= createGameChat("local", (selectedActor()?.name ?? "Player")));
  if (chatSlot && activeChat) {
    const character = battle.actors.find((actor) => actor.side === "party" && (table ? battle.controllers?.[actor.id] === controller : true));
    activeChat.mount(chatSlot, character?.name || table?.player || selectedActor()?.name || "Player");
    activeChat.setActivity(eventLogPlacement === 'chat' && eventLogMode !== 'collapsed', element.querySelector('.game-live-log'), (table?.state?.battle ?? battle).actionEvents ?? (table?.state?.battle ?? battle).monsterEvents ?? []);
  }
  const voiceSlot = element.querySelector(".game-voice-slot");
  if (table?.voice && voiceSlot) {
    table.voice.mount(voiceSlot);
    table.voice.sync({battle, players: table.players ?? [], tokenPositions: tokenMotion.positions, selected: selectedId});
  }
  floatingPanels.mount(element.querySelector(".game-screen"));
  if (context.game) storyToasts.mount(element.querySelector(".game-stage"));
  if (context.game) void prepareMonsterRewards(battle).catch(() => { });
  if (advancedOpen) element.querySelector(".room-advanced")?.setAttribute("open", "");
  if (archiveOpen && !hasArchive()) element.querySelector(".play-archive")?.setAttribute("open", "");
  if (gridOpen || calibrateGrid) {
    const settings = element.querySelector("#grid-settings");
    settings?.setAttribute("open", "");
    if (calibrateGrid) {
      settings?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      calibrateGrid = false;
    }
  }
  const frame = element.querySelector(".board-frame");
  if (context.game && focusedGameMap !== map.key) {
    const center = cameraToken();
    if (center) {
      const fittedCell = map.size * Math.min(frame.clientWidth / map.width, frame.clientHeight / map.height);
      if (fittedCell > 0 && fittedCell < 14) cameraState = { zoom: Math.min(8, Math.max(30 / fittedCell, cameraState?.zoom ?? 1)), center };
      else if (mapWalls(map)) cameraState = { zoom: 1.4, center };
      if (matchMedia('(max-width:700px)').matches && frame.clientHeight > frame.clientWidth) {
        const fit = Math.min(frame.clientWidth / map.width, frame.clientHeight / map.height);
        const fill = Math.max(frame.clientWidth / map.width, frame.clientHeight / map.height);
        if (fit > 0) cameraState = { zoom: Math.max(cameraState?.zoom ?? 1, Math.min(3, fill / fit)), center };
      }
      focusedGameMap = map.key;
    }
  }
  const cueLayer = element.querySelector(".combat-cues");
  const committedBattle=table?.state?roomBattle(table.state,map):battle;
  if (context.game) tokenMotion.sync(table?.id ?? map.key, committedBattle);
  combatCues.sync(table?.id ?? battle, committedBattle.actionEvents ?? committedBattle.monsterEvents ?? [], cueLayer ? {
    onReveal: event => {
      healthPresentation.reveal(event);
      // Giant maps (e.g. Against the Giants) cannot survive a full DOM/camera rebuild per cue.
      // Paint the board immediately; coalesce expensive HUD redraws.
      if (!revealPaintFrame) {
        revealPaintFrame = requestAnimationFrame(() => {
          revealPaintFrame = 0;
          if (root() && context?.game) paintBoard();
        });
      }
      clearTimeout(revealHudTimer);
      revealHudTimer = setTimeout(() => {
        revealHudTimer = 0;
        if (root() && context?.game) redraw();
      }, 160);
    },
    canOfferReaction: event => canOfferManualReaction(committedBattle, event, {canControl, map}),
    onReactionPause: (event, {resume, showChoices}) => openReactionPause(event, resume, showChoices),
    layer: cueLayer, frame, grid: frame.querySelector("#play-grid"), map, battle: committedBattle,
    sight: viewerVision(committedBattle, map, table ? controller : null).visible,
    memory: viewerMemory(committedBattle, map, table ? controller : null),
    fogEnabled: fogActive(), feed: element.querySelector(".game-live-log"), motion: tokenMotion,
  } : null);
  restoreEventLogScroll();
  camera = frame ? createCamera(frame, element.querySelector(".map-controls"), map, cameraState, () => { combatCues.place(); speechBubbles.place(); tokenHover.refresh(); }) : null;
  if(frame)paintBoard();
  if (context.game && isYpHub(map)) scheduleHubAmbience();
  if (active) element.querySelector("#" + CSS.escape(active))?.focus({ preventScroll: true });
  if (!context.game) paintCharacterPortraits(element);
  if (enemyTurnPending(battle) && scheduledEnemyBattle !== battle && (!table || table.online && !table.writing)) {
    const queued = battle;
    scheduledEnemyBattle = queued;
    setTimeout(() => {
      if (scheduledEnemyBattle === queued) scheduledEnemyBattle = null;
      if (context && root() && battle === queued && enemyTurnPending(battle)) interact(() => { });
    }, 0);
  }
}

function toolsSection(id, title, body, open = false) {
  return `<details class="tools-section"${open ? " open" : ""} data-tools-section="${escape(id)}"><summary>${escape(title)}</summary><div class="tools-section-body">${body}</div></details>`;
}

function tableTools() {
  if (!toolsOpen) return "";
  const tools = [
    ["move", "Move token"],
    ["room", "Inspect room"],
    ["spawn", "Place spawn point"],
    ["difficult", "Difficult terrain"],
    ["clear", "Clear terrain"]
  ];
  const display = actionButton("Dice animations: " + (combatCues.diceEnabled ? "On" : "Off"), "dice-effects") +
    '<p class="party-help">Spell visuals by <a href="https://jb2a.com/" target="_blank" rel="noopener">JB2A — Jules &amp; Ben</a> · <a href="/assets/animations/credits.json" target="_blank" rel="noopener">CC BY-NC-SA 4.0 / credits</a></p>' +
    actionButton("Fog of War: " + ((battle.fogEnabled ?? fogOfWarEnabled) ? "On" : "Off"), "toggle-fog") +
    (map.playerAsset ? actionButton("Map artwork: " + (battle.showDmArtwork ? "DM notes" : "Player version"), "toggle-dm-artwork") : "") +
    `<p id="map-art-note" class="play-hint" role="status">${escape(artworkNote)}</p>` +
    field('Chat & activity', 'activity-placement', [['chat', 'One panel (chat + log)'], ['separate', 'Stacked panels'], ['hidden', 'Hide activity log']].map(([value, label]) => option(value, label, eventLogPlacement === value)));
  const mapBody = (table ? field('Adventure map', 'room-map', maps.map(entry => option(entry.key, entry.title, entry.key === map.key)), battle.round || table.writing ? 'disabled' : '') : '') +
    field("Grid tool", "grid-tool", tools.map(([value, label]) => option(value, label, tool === value))) +
    (tool === "spawn" ? spawnToolPanel() : "") +
    gridSettings() + (tool === "room" ? roomPanel() : "");
  const encounter = (battle.round ? actionButton("End initiative", "end-initiative", { disabled: Boolean(battle.movement) }) : "") +
    actionButton("Reset encounter / board", "reset", { disabled: Boolean(battle.movement || battle.classReaction || table?.writing) }) +
    '<p class="party-help">Restore this map’s monsters and treasure, clear terrain and combat. Party progress and fog walls are kept.</p>' +
    manualHP();
  return '<h2>Table tools</h2>' +
    toolsSection("display", "Display & activity", display, true) +
    toolsSection("fog", "Dynamic fog & vision", dynamicFogTools()) +
    toolsSection("map", "Map & grid", mapBody) +
    toolsSection("encounter", "Encounter", encounter);
}

function partyManagement() {
  ensureParties(battle);
  const members = battle.actors.filter(a => a.side === 'party');
  const eligible = context.characters.filter(c => !members.some(a => a.id === 'party:' + c.id));
  const parties = battle.parties;
  const openParty = parties.find(party => !partyFull(battle, party.id)) ?? parties[0];
  const partyOptions = parties.map(party => option(party.id, `${party.name} · ${partyMembers(battle, party.id).length}/${MAX_PARTY_SIZE}`, party.id === openParty?.id));
  return `<h2>Parties · ${members.length} characters</h2>
 <p>Up to ${MAX_PARTY_SIZE} characters per party, and up to two parties on the same dungeon map. Rival parties share the map and can fight each other.</p>
 <button type="button" class="button primary small" data-action="upload">${icon('plus', 16)} Import character sheet</button>
 ${canCreateParty(battle) ? `<div class="play-action-row"><button type="button" class="button outline small" data-play="create-party">Create rival party</button></div>` : '<p class="party-help">Two parties are already racing this dungeon.</p>'}
 ${eligible.length ? `<form id="game-party-form" class="play-form">
 <label class="play-field" for="session-character">Choose an imported character<select id="session-character">${eligible.map(c => option(c.id, c.name, false)).join('')}</select></label>
 <label class="play-field" for="session-party">Join party<select id="session-party">${partyOptions.join('')}</select></label>
 ${spawnField("session-spawn", selectedSpawnId)}
 <button class="button primary small" type="submit">Add to party</button></form>` : `<p class="party-help">${context.characters.length ? 'All your imported characters are already in this adventure.' : 'No character sheets imported yet. Use Import character sheet above to get started.'}</p>`}
 ${battle.round ? '<p class="party-help">New characters roll initiative and join this encounter.</p>' : ''}
 ${parties.map(party => {
   const roster = partyMembers(battle, party.id);
   return `<h3>${escape(party.name)} · ${roster.length}/${MAX_PARTY_SIZE}</h3>
 <ul class="party-members">${roster.map(a => `<li><strong>${escape(a.name)}</strong><span>${a.hp} / ${a.maxHp} HP${table ? (battle.controllers?.[a.id] ? ' · Claimed' : ' · Available to claim') : ''}</span></li>`).join('') || '<li>No characters yet.</li>'}</ul>`;
 }).join('')}
 <p class="party-help">${table ? 'After adding a character, use Claim beneath their portrait on the left to choose who plays them.' : 'Select a portrait on the left to open their sheet, or Control to play as them.'}</p><p role="status">${escape(status)}</p>`;
}

function dynamicFogTools() {
  const settings = fogSettings(battle), heroes = battle.actors.filter(a => a.side === 'party');
  return `<section class="fog-controls"><h3>Dynamic fog</h3>
  <div class="fog-action-buttons">
    <button type="button" data-play="edit-walls" class="button outline small">Draw / edit walls</button>
  </div>
  <p class="play-hint">Place points freely on the map. Nearby vertices snap together. All room players share wall edits and fog settings.</p>
  <form id="fog-settings"><label><input type="checkbox" name="sharedVision" ${settings.sharedVision ? 'checked' : ''}> Share vision within your party</label>
  <label><input type="checkbox" name="remember" ${settings.remember ? 'checked' : ''}> Remember explored areas</label>
  <label><input type="checkbox" name="blockMovement" ${settings.blockMovement ? 'checked' : ''}> Walls block movement</label>
  <label>Fog opacity (%)<input type="number" name="opacity" min="10" max="100" value="${Math.round(settings.opacity * 100)}" required></label>
  <label>Explored opacity (%)<input type="number" name="exploredOpacity" min="0" max="100" value="${Math.round(settings.exploredOpacity * 100)}" required></label>
  <label>Soft edge (feet)<input type="number" name="softness" min="0" max="5" step="0.25" value="${settings.softness}" required></label>
  <button class="button outline small">Save fog settings</button></form>
  <button type="button" class="button outline small" data-play="reset-fog-memory">Reset exploration</button>
  <h3>Token vision</h3>${heroes.map(a => {
    const v = visionSettings(a); return `<form class="token-vision-form" data-vision-actor="${escape(a.id)}"><strong>${escape(a.name)}</strong>
  <label><input name="enabled" type="checkbox" ${v.enabled ? 'checked' : ''}> Vision enabled</label>
  <div class="vision-fields"><label>Range (ft)<input name="range" type="number" min="0" max="300" value="${v.range}" required></label><label>Cone (°)<input name="angle" type="number" min="1" max="360" value="${v.angle}" required></label><label>Facing (°)<input name="facing" type="number" min="0" max="360" value="${v.facing}" required></label></div>
  <small>0° right · 90° down · 180° left · 270° up</small><button class="button outline small">Save vision</button></form>`;
  }).join('')}</section>`;
}

function resetActionSelection() {
  spellEnd=null;controlledZone=null;
  hotbarSelection = ''; hotbarTools = false;
  combatChoice = ""; castSlot = ""; targetId = ""; spellSquare = null; extraTargets.clear();
  pathPreview = null; previewMessage = ""; pendingSquare = null;
  featureChoice = ""; featureTargetId = '';
  combatCues.aimPreview(null);
}

function canRollInitiative() {
  const available = (side) => battle.actors.some((actor) => actor.side === side && actorIsUp(actor) && occupies(actor));
  const parties = new Set(battle.actors.filter(actor => actor.side === 'party' && actorIsUp(actor) && occupies(actor)).map(actorPartyId));
  return (available("party") && available("hostile")) || parties.size >= 2;
}

function advanceCombat() {
  resolveKennelBetrayal();
  if (!battle.round) return;
  const roundBefore = battle.round;
  if (partyEscaped(battle)) { endInitiative(battle); status = "Your party escaped. Free movement restored."; return; }
  checkSpellTethers(battle, map);
  const message = runEnemyTurns(battle, map);
  if (message && !status && (!context.game || !battle.round)) status = message;
  if (battle.round && !battle.movement && !isPvpCombat(battle) &&
    !battle.actors.some((actor) => actor.side === "hostile" && battle.order.includes(actor.id) && actorIsUp(actor) && occupies(actor))) {
    endInitiative(battle);
    status = context.game ? "Encounter cleared. Free movement restored." : "Encounter cleared.";
  }
  if (context?.game && shouldPlayCombatVictory(roundBefore, battle, { partyWiped: partyDefeated(battle) })) {
    playCombatVictory();
  }
}

function beginCombat(actor, enemy, noticed) {
  const reason = engageEnemy(battle, map, actor, enemy, noticed);
  if (!reason) return false;
  resetActionSelection();
  category = "move";
  tool = "move";
  status = reason;
  log(battle, reason);
  return true;
}

function detectNearby(actor) {
  return beginCombat(actor, enemyInSight(battle, map, actor), true);
}

function checkGameCell(x, y, region, token) {
  const actor = selectedActor();
  if(category==='spell-zone'&&controlledZone){requireControl(actor);moveCustomSphere(battle,actor,controlledZone,{x,y},map);status=battle.log.at(-1);return;}
  if(category==='zone-beam'&&controlledZone){
    if(!token){status='Choose a creature for the beam.';return;}
    requireControl(actor);
    fireZoneBeam(battle,actor,controlledZone,token,map);
    status=battle.log.at(-1);
    resetActionSelection();
    return;
  }
  if (category === 'interact' && bodyPlacement) { requireControl(actor); const body = battle.actors.find(body => body.id === actor.carrying); placeBody(battle, actor, body, { x, y }, map, { thrown: bodyPlacement === 'throw' }); bodyPlacement = ''; status = battle.log.at(-1); return; }
  if (category === 'move' || category === 'interact') {
    // Dead/unconscious bodies and loot do not block walking — only Interact (or
    // clicking the square you already stand on) opens the underfoot object.
    const corpse = battle.actors.find((body) =>
      (body.dead || body.hp === 0) && !body.carriedBy && !body.draggedBy && body.x != null &&
      containsCell(body, x, y) && body.id !== actor?.id && !occupies(body));
    const treasure = visibleMarkers().find((marker) => marker.type === 'treasure' && !marker.looted && marker.x === x && marker.y === y);
    const underfoot = corpse || treasure;
    const standingHere = actor && occupies(actor) && containsCell(actor, x, y);
    if (underfoot && (!fogActive() || displayVision().has(keyAt(x, y))) &&
        (category === 'interact' || standingHere)) {
      requireControl(actor);
      interactionPosition = null;
      objectTarget = { type: corpse ? 'body' : 'treasure', id: underfoot.id };
      bodyPlacement = '';
      category = 'interact';
      hotbarSelection = 'common:interact';
      return;
    }
  }
  if (!battle.round && token?.side === "party" && category === "move" && canControl(token)) {
    selectPartyMember(token);
    return;
  }
  if (battle.round && category === "move" && token?.side === "party" && canControl(token) && movementGroup(battle).includes(token)) {
    selectPartyMember(token);
    return;
  }
  requireControl(actor);
  const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.reference || choice.data.key) : null;
  pathPreview = null;
  previewMessage = "";
  if(category==='spell'&&effect?.custom&&needsEndpoint(formRule(effect.definition,allowsWallRing(effect.definition)?spellWallForm:undefined))){
    if(!spellSquare||spellEnd){spellSquare={x,y};spellEnd=null;status='Choose the wall endpoint.';}
    else{spellEnd={x,y};if(hotbarSelection)executeCombatSelection(root().querySelector('#combat-form'));}
    return;
  }
  if (category === "spell" && (effect?.area || effect?.cone || effect?.teleport || (effect?.custom && directional(effect.definition)))) {
    spellSquare = { x, y }; spellEnd = null;
    if (hotbarSelection) executeCombatSelection(root().querySelector('#combat-form'));
    return;
  }
  if (token && (!visibleTokens()?.has(token.id) || token.id === actor?.id && category === "move")) return;
  if (token) {
    if (!battle.round && token.side === "hostile" && !effect?.exploration) beginCombat(actor, token, false);
    else if (!battle.round && isAttackablePc(actor, token) && ['weapon', 'custom'].includes(category) && !effect?.exploration) {
      targetId = token.id;
      if (!beginCombat(actor, token, false)) throw new Error("Could not start combat with that character.");
    }
    else {
      targetId = token.id;
      if (hotbarSelection && category === 'feature') executeClassSelection(root().querySelector('#class-action-form'), token);
      else if (hotbarSelection && ['weapon', 'spell', 'potion'].includes(category)) executeCombatSelection(root().querySelector('#combat-form'));
    }
    return;
  }
  if (!["move", "interact"].includes(category)) {
    status = "Choose a token as the target, or switch to Move.";
    return;
  }
  if (!actor) throw new Error("Choose a party member to move.");
  if (battle.round) moveToken(battle, actor, x, y, map);
  else exploreToken(battle, actor, x, y, map, (moving) => {
    rememberVision(battle, map);
    discoverStory(battle, map, moving);
    const sprung = triggerFeaturesAt(battle, moving, map);
    if (sprung.length) {
      log(battle, moving.name + " triggers " + sprung.map((feature) => feature.name).join(", ") + "!");
      return true;
    }
    const hinted = applyPassiveFeatureHints(battle, map, moving);
    if (hinted.length) log(battle, moving.name + " senses something odd nearby.");
    const kennel = checkKennelApproach(battle, map, moving);
    if (kennel) {
      status = kennel;
      log(battle, kennel);
      pullAlertedDen(battle, map);
      return true;
    }
    const floodWatch = checkLookoutFlood(battle, map, moving);
    if (floodWatch) {
      presentFloodResult(floodWatch);
      return true;
    }
    return detectNearby(moving);
  });
  followKennelAllies(battle, map, actor);
  if (actor.hubSitting) {
    const table = HUB_TABLES.find((entry) => entry.id === actor.hubSitting);
    if (!table || actor.x !== table.x || actor.y !== table.y) delete actor.hubSitting;
  }
  room = regionAt(map, ...cellCenter(map, actor)) ?? null;
}

async function loadRoster(records, area) {
  const creatures = (await Promise.all(records.map((record) => rosterTokens(record)))).flat();
  for (const creature of creatures) add(creature, area);
  return creatures.length;
}

async function launchGame(hostOptions = null, characters = context.characters) {
  battle.spellRules=loadSpellRules();
  if (map.module === "YPHub") seedYpHubScene(map, battle);
  await ensureScene();
  const entry = startingRegion(map);
  if (entry) room = entry;
  if (!battle.round && !battle.actors.some((actor) => actor.side === "party")) {
    for (const character of characters.slice(0, 4)) {
      try { add(partyActor(character), entry); } catch (error) { log(battle, error.message); }
    }
  }
  if (!battle.actors.some((actor) => actor.side === "party")) {
    throw new Error("Import a character to start this adventure, or choose the practice yard.");
  }
  for (const actor of battle.actors.filter((entry) => entry.id.startsWith("party:"))) {
    const character = importedCharacter(actor);
    if (!character) continue;
    const imported = partyActor(character);
    syncClassResources(actor, imported);
    actor.spells = imported.spells;
    actor.slots ??= {};
    actor.saves ??= {};
    for (const [rank, slot] of Object.entries(imported.slots)) {
      const existing = actor.slots[rank];
      if (!existing) actor.slots[rank] = slot;
      else if (existing.maximum == null && !(existing.current > slot.maximum)) existing.maximum = slot.maximum;
    }
    actor.spellAbility ??= imported.spellAbility;
    actor.darkvision ??= imported.darkvision;
    actor.creatureType ??= imported.creatureType;
    actor.sleepImmune ??= imported.sleepImmune;
    actor.spellDC ??= imported.spellDC;
    actor.spellAttack ??= imported.spellAttack;
    if (!actor.resist?.length) actor.resist = imported.resist;
    for (const [ability, save] of Object.entries(imported.saves)) actor.saves[ability] ??= save;
  }
  const selected = battle.actors.find((actor) => actor.side === "party" && actor.id === selectedId && actorIsUp(actor)) ??
    preferredPartyActor() ??
    battle.actors.find((actor) => actor.side === "party" && actorIsUp(actor));
  selectedId = selected?.id ?? "";
  category = "move"; tool = "move"; status = ""; resetActionSelection();
  if (!battle.story) {
    discoverStory(battle, map, selected);
    revealStory(0);
  } else {
    storyToasts.remember(battle);
  }
  if (!battle.round) battle.actors.filter((entry) => entry.side === "party").some(detectNearby);
  advanceCombat();
  rememberVision(battle, map);
  saveExplored(battle, map);
  if (hostOptions) { await hostTable(hostOptions); return; }
  preferredGame = { module: moduleId, map: map.key };
  try { localStorage.setItem(activeMapKey, JSON.stringify(preferredGame)); } catch { }
  saveBattle();
  location.hash = "game";
}

function refreshPartyToken(actor, character) {
  const sheet = partyActor(character);
  syncClassResources(actor, sheet);
  for (const key of ["name", "ac", "speed", "darkvision", "initiative", "dex", "ability", "saves", "resist", "level", "attacks", "spells", "spellDC", "spellAttack", "spellAbility"]) {
    actor[key] = sheet[key];
  }
  actor.maxHp = sheet.maxHp + (actor.aid ?? 0);
  actor.hp = Math.min(actor.hp, actor.maxHp);
  actor.slots ??= {};
  for (const [rank, slot] of Object.entries(sheet.slots)) {
    const existing = actor.slots[rank];
    const maximum = slot.maximum ?? existing?.maximum ?? null;
    const remaining = existing?.current ?? slot.current ?? null;
    actor.slots[rank] = { maximum, current: remaining == null || maximum == null ? remaining : Math.min(remaining, maximum) };
  }
}

function selectRoom(region) {
  room = region ?? null;
  selectedCreature = 0;
  status = room ? String(room.entry?.name ?? room.id) : "No tagged room covers this square.";
}

async function selectModule(id, preferred) {
  const request = ++revision;
  pending = true;
  redraw();
  try {
    const loaded = moduleMapsOrBuiltin(id) ?? await moduleMaps(id);
    if (request !== revision) return;
    if (!loaded.length) throw new Error("This adventure has no supported square-grid maps in the attached archive.");
    moduleId = id;
    maps = loaded;
    const defaultMap = loaded.find((entry) => entry.key === preferred)
      ?? loaded.find((entry) => entry.sceneId === "hub:yawning-portal:first")
      ?? loaded.find((entry) => entry.id === "1ab" && !entry.title.includes("(Player)"))
      ?? loaded.find((entry) => entry.regions.length) ?? loaded[0];
    useMap(defaultMap);
    if (context.game) {
      selectedId = battle.actors.find((actor) => actor.side === "party" && actorIsUp(actor))?.id ?? "";
      tool = "move";
    }
  } catch (failure) {
    status = failure.message;
  } finally {
    if (request === revision) {
      pending = false;
      redraw();
    }
  }
}

function freeCell(region, actor, spawn = null) {
  const cells = region ? regionCells(map, region) : [];
  const allowed = ({ x, y }) => canStand(battle, actor, x, y, map);
  if (spawn) {
    const near = cellsNearSpawn(spawn, map, allowed);
    if (near) return near;
  }
  if(battle.round && actor.side==='party'){
    const allies=battle.actors.filter(other=>other.side==='party'&&sameParty(actor,other)&&occupies(other)&&(!battle.encounterParticipants?.length||battle.encounterParticipants.includes(other.id)));
    for(let radius=1;radius<=6;radius++)for(const ally of allies)for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
      const candidate={x:ally.x+dx,y:ally.y+dy};if(allowed(candidate)&&lineClear(battle,ally,candidate,map))return candidate;
    }
  }
  const mapped = cells.find(allowed);
  if (mapped) return mapped;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      if (allowed({ x, y })) return { x, y };
    }
  }
  throw new Error("The grid has no free squares.");
}

function add(actor, area = room, partyId = DEFAULT_PARTY_ID, spawnId = null) {
  if(battle.actors.some(existing=>existing.id===actor.id))throw new Error("This character is already in the room.");
  if (actor.side === "party") {
    ensureParties(battle);
    const id = partyId || DEFAULT_PARTY_ID;
    if (!battle.parties.some(party => party.id === id) && canCreateParty(battle)) createParty(battle, partyLabel(id));
    if (partyFull(battle, id)) throw new Error((battle.parties.find(party => party.id === id)?.name || "This party") + " already has four characters.");
    assignParty(actor, id);
  }
  const spawn = findSpawn(battle, spawnId);
  const { x, y } = freeCell(area, actor, spawn);
  placeToken(battle, actor, x, y, map);
  actor.origin = areaKey(area);
  if (spawn) actor.spawnId = spawn.id;
  battle.actors.push(actor);
  if(battle.round && actor.side!=="neutral")joinInitiative(battle,actor);
  selectedId = actor.id;
  tool = "move";
}

function spawnField(id = "play-spawn", selected = selectedSpawnId) {
  const spawns = spawnMarkers(battle);
  if (!spawns.length) return "";
  return field("Spawn point", id, [
    option("", "Default entrance", !selected),
    ...spawns.map((marker) => option(marker.id, marker.name, marker.id === selected)),
  ]);
}

function spawnToolPanel() {
  const spawns = spawnMarkers(battle);
  return `<div class="spawn-tool-panel">
    ${input("Spawn name", "spawn-point-name", spawnNameDraft, "text", 'maxlength="40" placeholder="Party 1 start"')}
    <p class="play-hint">Click a square to place or rename a spawn marker. Characters can pick one when joining.</p>
    ${spawns.length ? `<ul class="spawn-point-list">${spawns.map((marker) => `<li>
      <strong>${escape(marker.name)}</strong>
      <span>@ ${marker.x + 1}, ${marker.y + 1}</span>
      <button type="button" class="button outline small" data-play="remove-spawn" data-id="${escape(marker.id)}">Remove</button>
    </li>`).join("")}</ul>` : '<p class="play-hint">No spawn points yet.</p>'}
  </div>`;
}

function canUseMapSquare(x, y) {
  if (!context.game || !fogActive() || tool === "wall" || tool === "door" || tool === "erase-wall") return true;
  if (hasExplored(viewerMemory(battle, map, table ? controller : null), x, y) || displayVision().has(keyAt(x, y))) return true;
  const actor = selectedActor();
  const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.mode === "spell" && supportedSpell(choice.data.reference || choice.data.key);
  if (category === "spell" && (effect?.area || effect?.cone || effect?.teleport)) return true;
  return tool === "move" && ["move", "interact"].includes(category) && actor?.side === "party" && occupies(actor) &&
    mapFloor(map, x, y, battle) && distanceFt(actor, { x, y }) <= 5;
}

function checkCell(x, y, region) {
  if (root()?.querySelector("#grid-settings")?.open && (gridDraft || artFitDraft)) {
    status = artFitDraft && !gridDraft
      ? "Save the image placement so rooms stay lined up with your map."
      : "Save the grid alignment to use the adjusted squares.";
    return;
  }
  if (x < 0 || x >= map.cols || y < 0 || y >= map.rows) return;
  if (!canUseMapSquare(x, y)) { status = "Choose a square the party has seen."; return; }
  cursor = {x,y,movement:context.game&&tool==="move"&&["move","interact"].includes(category)};
  if (tool === "room") {
    selectRoom(region);
    const marker = visibleMarkers().find((entry) => entry.x === x && entry.y === y);
    if (marker) document.dispatchEvent(new CustomEvent("wayfarer:marker", { detail: marker }));
    return;
  }
  if (tool === "spawn") {
    const marker = createSpawnMarker(battle, {
      x,
      y,
      name: spawnNameDraft || root()?.querySelector("#spawn-point-name")?.value || "Spawn",
      origin: areaKey(region ?? room),
    });
    selectedSpawnId = marker.id;
    status = `Spawn “${marker.name}” set at ${x + 1}, ${y + 1}.`;
    return;
  }
  const token = battle.actors.find((actor) => occupies(actor) && containsCell(actor, x, y));
  if (tool === "move" && context.game) return checkGameCell(x, y, region, token);
  if (tool === "move") {
    if (token) {
      if (battle.round) targetId = token.id;
      else selectedId = token.id;
    } else {
      const actor = selectedActor();
      if (!actor) throw new Error("Select a token to place first.");
      if (battle.round) requireControl(actor);
      moveToken(battle, actor, x, y, map);
    }
    status = token ? "Selected " + token.name + "." : "Square " + (x + 1) + ", " + (y + 1) + ".";
  } else {
    if (tool === "wall" && token) throw new Error("Move the token before blocking this square.");
    terrainAt(battle, x, y, tool);
    status = tool === "clear" ? "Terrain cleared." : tool === "wall" ? "Blocked square marked." : "Difficult terrain marked.";
  }
}

async function loadFile(file, name) {
  if (!file || pending) return;
  pending = true;
  status = "Reading 5etools archive…";
  redraw();
  try {
    const result = await attachArchive(file, name);
    lastAdventure = context.activeAdventure;
    await selectModule(context.newRoom ? roomDraft.adventure : context.activeAdventure || "LMoP");
    status = result.saved
      ? "5etools archive ready — spell tips can load full text from this ZIP."
      : "Archive loaded for this session. Browser storage is unavailable.";
  } catch (failure) {
    status = failure.message;
  } finally {
    pending = false;
    redraw();
  }
}

function sharedSheet(record) {
  const character = enrichCharacter(record);
  const fields = ["id", "species", "characterClass", "level", "abilities", "skills", "items", "spells", "attacks", "proficiency", "passivePerception",
    "background", "alignment", "rulesDetails", "classRules", "resources"];
  const sheet = Object.fromEntries(fields.filter((key) => character[key] != null).map((key) => [key, character[key]]));
  const details = sheet.rulesDetails?.classDetails;
  if (details) {
    sheet.rulesDetails = {
      ...sheet.rulesDetails, classDetails: {
        ...details,
        classes: details.classes.map(({ subclasses, ...cls }) => cls),
        choices: details.choices.map(({ options, ...choice }) => choice),
      }
    };
  }
  return sheet;
}

const tableState=()=>upgradeRoomState(
  commitRoomState(table?.state ?? previewState,map,battle,map.printedGrid ?? null),map
);

async function hostTable({ roomName, username, roomKind, hubSession } = {}) {
  const route = location.hash;
  pending = true;
  setTableMessage("Starting shared session…");
  try {
    rememberVision(battle, map);
    saveExplored(battle, map);
    const state = tableState();
    const kind = roomKind === "hub" || map.module === "YPHub" ? "hub" : "campaign";
    const adventureName = kind === "hub"
      ? "Yawning Portal"
      : (context.adventures.find(entry => entry.id === map.module)?.name ?? map.title);
    state.room = {
      name: roomName || (kind === "hub" ? "Yawning Portal" : map.title),
      adventure: map.module,
      adventureName,
      kind,
      ...(hubSession ? { hubSession } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.battle = structuredClone(state.battle);
    if (roomName) {
      const preferred = preferredCharacterId();
      const first = (preferred && state.battle.actors.find((actor) => actor.id === "party:" + preferred))
        ?? state.battle.actors.find((actor) => actor.side === "party");
      if (first) (state.battle.controllers ??= {})[first.id] = controller;
    }
    state.battle.sheets = Object.fromEntries(context.characters
      .filter(({ id }) => battle.actors.some((actor) => actor.id === "party:" + id))
      .map((character) => ["party:" + character.id, sharedSheet(character)]));
    const tokens = new Map();
    for (const actor of state.battle.actors) {
      const hash = partyTokenImage(actor);
      if (!hash) { delete actor.tokenImage; continue; }
      actor.tokenImage = hash;
      if (!tokens.has(hash)) tokens.set(hash, await localTokenBlob(hash));
    }
    if (location.hash !== route) return;
    const result = await createSession({ ...map, detectedGrid }, state, customArtwork, tokens, controller);
    rooms = rememberRoom(result.id, map, state);
    if (kind === "hub") rememberedHubSession(result.id);
    if (username) {
      rememberedUsername(username);
      // If joining is interrupted, the saved room link still lets the player finish joining.
      await syncSessionPlayers(result.id, controller, username).catch(() => null);
    }
    if (location.hash !== route) return;
    showInvitation = roomName ? null : result.id;
    location.hash = sessionHash(result.id);
  } catch (error) {
    if (location.hash === route) {
      setTableMessage(error.message);
      if (error.status === 401) {
        needsHostSignIn = true;
        redraw();
      }
    }
    if (roomName) throw error;
  } finally { pending = false; }
}

function setTableMessage(message) {
  tableMessage = message;
  const output = root()?.querySelector(".session-panel [role=status]");
  if (output) output.textContent = message;
}

function applyTableState(connection, snapshot) {
  const turn = selectedActor()?.id;
  const round = battle.round;
  const storyBefore = connection.state ? storyVersion(battle) : 0;
  snapshot={...snapshot,state:normalizeRoomState(snapshot.state,snapshot.state.currentMap ?? map)};
  const incomingMap=snapshot.state.currentMap;
  if(incomingMap.key!==map.key){artworkRequest?.abort();camera?.destroy();camera=null;focusedGameMap=null;tokenMotion.reset();combatCues.reset();speechBubbles.clear();tokenHover.clear();map=structuredClone(incomingMap);art=null;customArtwork=null;detectedGrid=map.detectedGrid;gridDraft=null;room=startingRegion(map);cursor=null;queuedMove=null;resetActionSelection();tool='move';category='move';if(map.sourceGrid)Object.assign(map,gridGeometry(map,snapshot.state.alignment ?? map.sourceGrid));if(map.asset || map.playerAsset || snapshot.state.artworkMapKey===map.key)loadArtwork(map,null,snapshot.state.artworkMapKey===map.key?artworkURL(connection.id):null);}
  setSpellRuleContext(snapshot.state.battle.spellRules ?? {});
  const geometryChanged = JSON.stringify(map.printedGrid ?? null) !== JSON.stringify(snapshot.state.alignment);
  connection.state = snapshot.state;maps=roomMapChoices(snapshot.state,maps);
  connection.revision = snapshot.revision;
  connection.online = true;
  battle=structuredClone(roomBattle(snapshot.state,map));
  for (const actor of battle.actors.filter((entry) => entry.side === "party" && !entry.classRules)) {
    const record = importedCharacter(actor) ?? battle.sheets?.[actor.id];
    if (!record) continue;
    try {
      const source = partyActor({ ...record, name: actor.name, ac: actor.ac, hp: actor.hp, maxHp: actor.maxHp, speed: String(actor.speed) });
      syncClassResources(actor, source);
    } catch { }
  }
  for (const actor of battle.actors.filter(actor => actor.side === "party")) {
    migratePactResources(actor);
    applyHestiasFury(actor);
  }
  if (geometryChanged && map.sourceGrid) {
    setAlignment(snapshot.state.alignment ?? map.sourceGrid);
    gridDraft = null;
    cursor = null;
  }
  repairWallPlacement(map, battle);
  const owned = battle.actors.find(({ id }) => battle.controllers?.[id] === controller);
  // Prefer an already-owned token, then the player's default character, then any controllable party token.
  if (!battle.actors.some(actor => actor.id === selectedId && canControl(actor))) {
    selectedId = owned?.id ?? preferredPartyActor()?.id ?? battle.actors.find(actor => actorIsUp(actor) && canControl(actor))?.id ?? "";
  }
  // Remote catch-up: mark existing journal entries seen. Live discoveries still toast via revealStory.
  if (storyBefore === 0) {
    storyToasts.remember(battle);
    // Hub → campaign depart stashes keys so arrival toasts still fire after the session switch.
    try {
      const keys = JSON.parse(sessionStorage.getItem("wayfarer-arrival-story") || "[]");
      sessionStorage.removeItem("wayfarer-arrival-story");
      if (Array.isArray(keys)) {
        for (const key of keys) {
          const entry = battle.story?.discoveries?.find((item) => item.key === key);
          if (entry) storyToasts.show(entry, { force: true });
        }
      }
    } catch { /* ignore */ }
  } else if (storyBefore > 0 || !showInvitation) revealStory(storyBefore);
  if (turn !== selectedActor()?.id || round !== battle.round) {
    resetActionSelection();
    category = "move";
  }
  pathPreview = null; pendingSquare = null; previewMessage = "";
  if (context?.game && shouldPlayCombatVictory(round, battle, { partyWiped: partyDefeated(battle) })) {
    playCombatVictory();
  }
}

async function pollTable(connection) {
  if (table !== connection || connection.reading) return;
  clearTimeout(connection.timer);
  connection.reading = true;
  try {
    if (connection.writing || camera?.gesturing()) return;
    const snapshot = await readSession(connection.id, connection.revision);
    if (table !== connection || connection.writing || camera?.gesturing()) return;
    if (snapshot && snapshot.revision > connection.revision) {
      applyTableState(connection, snapshot);
      status = "";
      tableMessage = "";
      redraw();
    } else if (!connection.online) {
      connection.online = true;
      setTableMessage("Connected");
      if (enemyTurnPending(battle)) redraw();
    }
  } catch (error) {
    if (error.status === 404 && table === connection) { rooms = forgetRoom(connection.id); roomsError = 'This adventure room was deleted.'; location.hash = '#play'; return; }
    if (table === connection) {
      connection.online = false;
      setTableMessage("Connection lost. Reconnecting…");
    }
  } finally {
    connection.reading = false;
    if (table === connection) connection.timer = setTimeout(() => pollTable(connection), document.hidden ? 9000 : 1500);
  }
}

async function pollPlayers(connection) {
  if (table !== connection || connection.readingPlayers || !connection.state) return;
  clearTimeout(connection.playerTimer);
  connection.readingPlayers = true;
  try {
    const result = await syncSessionPlayers(connection.id, controller);
    if (table !== connection) return;
    const playersChanged = JSON.stringify(result.players) !== JSON.stringify(connection.players);
    connection.players = result.players;
    if (playersChanged && !connection.writing && !camera?.gesturing()) redraw();
    // Away players temporarily lose claims so anyone else can Claim — or combat auto-skips.
    if (!connection.writing && !camera?.gesturing() && hasOfflineClaims(result.players)) {
      void interact(() => {
        const released = clearOfflineClaims(connection.players);
        if (released.length) {
          log(battle, released.join(", ") + (released.length === 1 ? " was" : " were") +
            " released (player away). Claim them or wait for the turn to skip.");
        }
      });
    }
  } catch {
    // A failed heartbeat leaves the last visible roster in place until the next poll.
  } finally {
    connection.readingPlayers = false;
    if (table === connection) connection.playerTimer = setTimeout(() => pollPlayers(connection), document.hidden ? 15000 : 3500);
  }
}

async function connectTable(connection, username) {
  if (connection.joining) return;
  connection.joining = true;
  if (username !== undefined) connection.usernameDraft = username;
  connection.error = false;
  tableMessage = "";
  redraw();
  try {
    const entry = await syncSessionPlayers(connection.id, controller, username);
    if (table !== connection) return;
    if (!entry.player) {
      connection.needsUsername = true;
      return;
    }
    connection.player = entry.player;
    connection.players = entry.players;
    connection.needsUsername = false;
    rememberedUsername(entry.player);
    const original = await readSession(connection.id);
    if (table !== connection) return;
    const snapshot = await upgradeOpenedRoom(original,
      (revision, state) => writeSession(connection.id, revision, state),
      () => table === connection);
    if (table !== connection) return;
    map=snapshot.state.currentMap ?? snapshot.map;maps=[map];if(snapshot.hasArtwork && !snapshot.state.artworkMapKey)snapshot.state.artworkMapKey=map.key;
    detectedGrid = map.detectedGrid;
    art = null; artworkNote = ""; customArtwork = null; gridDraft = null;
    storyOpen = false;
    selectedId = ""; tool = "move"; category = "move"; status = ""; room = null; cursor = null;
    resetActionSelection();
    applyTableState(connection, snapshot);
    connection.chat ??= createGameChat(connection.id, controller);
    connection.voice ??= createSpatialVoice(connection.id, controller);
    recentSession(connection.id);
    if (connection.state.room?.kind === "hub" || map.module === "YPHub") rememberedHubSession(connection.id);
    rooms = rememberRoom(connection.id, map, connection.state);
    tableOpen = showInvitation === connection.id;
    showInvitation = null;
    if(map.asset || map.playerAsset || snapshot.state.artworkMapKey===map.key)loadArtwork(map,null,snapshot.state.artworkMapKey===map.key?artworkURL(connection.id):null);
    void loadRoomMaps(connection);
    pollTable(connection);
    connection.playerTimer = setTimeout(() => pollPlayers(connection), 3500);
  } catch (failure) {
    if (table !== connection) return;
    if (failure.status === 404) { rooms = forgetRoom(connection.id); roomsError = 'This adventure room is no longer available.'; location.hash = '#play'; return; }
    tableMessage = failure.message;
    connection.error = true;
  } finally {
    connection.joining = false;
    if (table === connection) redraw();
  }
}

function leaveTable() {
  if (!table) return;
  clearTimeout(table.timer);
  clearTimeout(table.playerTimer);
  table.chat?.destroy();
  void table.voice?.destroy();
  artworkRequest?.abort();
  ({ map, battle, maps,moduleId,art, artworkNote, customArtwork, detectedGrid, room, selectedId, tool } = table.solo);
  table = null;
  lastPortraitClick = null;
  tableOpen = false;
  tableMessage = "";
  status = "";
  resetActionSelection();
  camera?.destroy();
  camera = null;
}

export function showPlay(data) {
  const previousContext=context;
  context = data; document.title = defaultPageTitle;
  if (!data?.game) { tokenMotion.reset(); queuedMove = null; }
  if (!data?.game) focusedGameMap = null;
  if (!data?.sessionRoute) leaveTable();
  if (!data) {
    tokenHover.clear();
    combatCues.reset();
    speechBubbles.clear();
    return;
  }
  if (!battle) useMap(previewState?.currentMap ?? trainingMap);
  if (data.sessionRoute) {
    const id = sessionCode(data.sessionRoute);
    if (table?.id === id) { redraw(); return; }
    leaveTable();
    revision++;
    pending = false;
    artworkRequest?.abort();
    camera?.destroy();
    camera = null;
    table = { id, solo: { map, battle,maps,moduleId, art, artworkNote, customArtwork, detectedGrid, room, selectedId, tool } };
    if (id) connectTable(table);
    else { tableMessage = "Check the session link and try again."; redraw(); }
    return;
  }
  if (data.hubEntry) {
    if (!previousContext?.hubEntry) {
      Object.assign(roomDraft, { name: "", prepared: false, party: null, adventure: "YPHub" });
      status = "";
      tableMessage = "";
    }
    redraw();
    return;
  }
  if(data.newRoom){
    if(!previousContext?.newRoom||previousContext.roomAdventure!==data.roomAdventure){
      Object.assign(roomDraft,{name:'',prepared:false,party:null,adventure:data.roomAdventure==="YPHub"?"training":(data.roomAdventure??data.activeAdventure??'training')});
      status='';
      if(isBuiltinModule(roomDraft.adventure)||hasArchive())void selectModule(roomDraft.adventure);
    }
    redraw();
    return;
  }
  if (!data.game) { rooms = knownRooms(); refreshRooms(); }
  redraw();
  if (hasArchive() && lastAdventure !== context.activeAdventure) {
    lastAdventure = context.activeAdventure;
    const preferred = context.game ? preferredGame : null;
    selectModule(preferred?.module || context.activeAdventure || "LMoP", preferred?.map);
  }
}

document.addEventListener("wayfarer:spell-entries", () => {
  if (context?.game && element?.isConnected) redraw();
});
document.addEventListener("wayfarer:archive", () => {
  if (context?.game && element?.isConnected) redraw();
  if (root() && !pending && context && !table) {
    const preferred = context.game ? preferredGame : null;
    if(context.newRoom){void selectModule(roomDraft.adventure);return;}
    lastAdventure = context.activeAdventure;
    selectModule(preferred?.module || context.activeAdventure || "LMoP", preferred?.map);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && table?.state) {
    pollTable(table);
    pollPlayers(table);
    table.chat?.refresh();
  }
});

async function interact(run, { cosmetic = false, retryMove, remaining = 6 } = {}) {
  const connection = table;
  if (connection && (!connection.state || connection.writing)) return;
  let succeeded = true;
  const storyBefore = storyVersion(battle);
  const turnBefore = selectedActor()?.id;
  const roundBefore = battle.round;
  const commandSelection = { category, tool, combatChoice, castSlot, targetId, spellSquare, featureChoice, hotbarSelection, hotbarTools, pendingSquare, extraTargets: new Map(extraTargets) };
  const commandActor = selectedActor(), actorBefore = JSON.stringify(commandActor), budgetBefore = commandActor && turnBudgetStamp(battle, commandActor);
  const retrySharedAction = () => {
    const actor = selectedActor();
    return !cosmetic && context?.game && roundBefore === battle.round && commandActor?.id === actor?.id &&
      canControl(actor) && canTakeTurn(battle, actor) && !battle.movement && !battle.classReaction &&
      JSON.stringify(actor) === actorBefore && turnBudgetStamp(battle, actor) === budgetBefore;
  };
  if (connection) connection.writing = true;
  if (connection) {
    root()?.querySelector('.game-hud')?.setAttribute('aria-busy', 'true');
    const saving = root()?.querySelector('.game-save-status'); if (saving) saving.textContent = 'Saving…';
  }
  try {
    status = "";
    if (!cosmetic) {
      for (const actor of battle.actors.filter(actor => actor.side === 'party')) { const sheet = battle.sheets?.[actor.id] ?? importedCharacter(actor); actor.items ??= structuredClone(sheet?.items ?? []); actor.currency ??= structuredClone(sheet?.currency ?? {}); actor.xp ??= sheet?.xp ?? 0; }
      await prepareMonsterRewards(battle);
    }
    const movementCursor = battle.actionEvents?.at(-1)?.id ?? 0;
    await run();
    if (context?.game && connection && battle.actionEvents?.some(event => event.id > movementCursor && event.kind === 'move')) { tokenMotion.sync(connection.id, battle); paintBoard(); }
    syncRewardSheets(battle);
    if (connection !== table) return;
    if (!cosmetic && context?.game && battle.round) {
      const heroes = battle.actors.filter((actor) => actor.side === "party");
      for (const enemy of battle.actors.filter((actor) => actor.side === "hostile" && !battle.order.includes(actor.id))) {
        if (heroes.some((hero) => noticesEnemy(battle, map, hero, enemy))) joinInitiative(battle, enemy);
      }
    }
    if (!cosmetic && context) {
      advanceCombat();
      // Hostile OA (or walk finish after a player OA) may clear movement for a queued move-then-attack.
      if (resumePendingStrike()) advanceCombat();
      if (turnBefore !== selectedActor()?.id || roundBefore !== battle.round) {
        resetActionSelection();
        category = "move";
      }
    }
    if (!cosmetic && context?.game && hotbarSelection) {
      const actor = selectedActor(), entry = hotbarEntries(actor).find(entry => entry.id === hotbarSelection);
      if (!entry || entryReason(actor, battle, entry, canControl(actor))) { resetActionSelection(); category = 'move'; }
    }
    if (!cosmetic && context?.game) {
      for (const actor of battle.actors) discoverStory(battle, map, actor);
      rememberVision(battle, map);
      saveExplored(battle, map);
    }
    syncRewardSheets(battle);
    saveBattle();
  } catch (failure) {
    status = failure instanceof Error ? failure.message : "The action could not be completed.";
    succeeded = false;
    pendingHubDepart = null;
    pendingHubReturn = false;
    clearPendingStrike();
    if (connection && connection === table) {
      queuedMove = null;
      applyTableState(connection, connection);
      connection.writing = false;
      redraw();
      return;
    }
  }
  if (connection !== table) return;
  if (succeeded && !cosmetic && context?.game) revealStory(storyBefore);
  if (connection) {
    const next = tableState();
    try {
      if (JSON.stringify(next) !== JSON.stringify(connection.state)) {
        const result = await writeSession(connection.id, connection.revision, next);
        if (connection !== table) return;
        if (result.state) {
          succeeded = false;
          applyTableState(connection, result);
          if (remaining > 0 && (retryMove ? retryMove() : retrySharedAction())) {
            ({ category, tool, combatChoice, castSlot, targetId, spellSquare, featureChoice, hotbarSelection, hotbarTools, pendingSquare } = commandSelection);
            extraTargets.clear(); for (const [key, value] of commandSelection.extraTargets) extraTargets.set(key, value);
            connection.writing = false;
            return await interact(run, { cosmetic, retryMove, remaining: remaining - 1 });
          }
          status = "Another player acted first. Review the board and try again.";
        } else {
          connection.state = structuredClone(next);
          connection.revision = result.revision;
          connection.online = true;
        }
        tableMessage = "";
      }
    } catch (error) {
      succeeded = false;
      if (connection !== table) return;
      applyTableState(connection, connection);
      connection.online = false;
      status = error.message;
    } finally { connection.writing = false; }
  }
  if (!succeeded) {
    pendingHubDepart = null;
    pendingHubReturn = false;
    clearPendingStrike();
  } else if (pendingHubDepart) {
    const destination = pendingHubDepart;
    pendingHubDepart = null;
    pendingHubReturn = false;
    try {
      await openCampaignFromHub(destination);
      return true;
    } catch (error) {
      status = error instanceof Error ? error.message : "The expedition room could not be opened.";
      if (context) redraw();
      return false;
    }
  } else if (pendingHubReturn) {
    pendingHubReturn = false;
    const hubId = table?.state?.room?.hubSession || rememberedHubSession();
    leaveTable();
    location.hash = hubId ? sessionHash(hubId) : "#hub";
    return true;
  }
  if (context) redraw();
  if (connection === table && queuedMove) {
    const move = queuedMove; queuedMove = null;
    if (succeeded) setTimeout(() => {
      if (context?.game && table === connection && map.key === move.map && battle.round === move.round && ['move', 'interact'].includes(category) && selectedActor()?.id === move.actor) interactCell(move.x, move.y, regionAt(map, ...cellCenter(map, move)), { step: move.step });
    }, 0);
  }
  return succeeded;
}

function interactCell(x, y, region, { step = false } = {}) {
  const selectedSpell=combatChoice===''?null:choices(selectedActor())[Number(combatChoice)];
  const aimedRule=context?.game&&category==='spell'&&selectedSpell?.mode==='spell'?customSpellRule(selectedSpell.data.reference||selectedSpell.data.key):null;
  const aimedWall=aimedRule?formRule(aimedRule,allowsWallRing(aimedRule)?spellWallForm:undefined):null;
  if(aimedWall&&needsEndpoint(aimedWall)){
    if(table?.writing)return;
    if(x<0||y<0||x>=map.cols||y>=map.rows||!canUseMapSquare(x,y)){status='Choose a visible map square.';redraw();return;}
    try{requireControl(selectedActor());}catch(error){status=error.message;redraw();return;}
    if(!spellSquare||spellEnd){spellSquare={x,y};spellEnd=null;status='Choose the wall endpoint.';redraw();return;}
    spellEnd={x,y};return interact(()=>executeCombatSelection(root().querySelector('#combat-form')));
  }
  const mover = context.game && ["move", "interact"].includes(category) && tool === "move" ? selectedActor() : null;
  if (table?.writing && mover && canControl(mover) && (!battle.round || movementGroup(battle).includes(mover))) { queuedMove = { x, y, actor: mover.id, map: map.key, round: battle.round, step }; return; }
  const { round } = battle;
  const destinationFree = () => !battle.actors.some((actor) => occupies(actor) && containsCell(actor, x, y));
  const retryMove = mover && destinationFree() ? () => {
    const current = selectedActor();
    return battle.round === round && current?.id === mover.id && current.x === originX && current.y === originY &&
      canControl(current) && (!battle.round || movementGroup(battle).includes(current)) && !battle.movement && destinationFree();
  } : undefined;
  const originX = mover?.x, originY = mover?.y;
  return interact(() => {
    // Direction keys take one adjacent step; never pathfind around a blocked edge.
    if (step && previewMovement(battle, selectedActor(), x, y, map)?.path.length !== 1) return;
    return checkCell(x, y, region);
  }, { retryMove, remaining: 6 });
}

export async function setGameTokenImage(id, image, session) {
  const route = location.hash;
  const sameGame = () => context?.game && location.hash === route && table?.id === session;
  if (!sameGame()) throw new Error("Reopen the character in this session to change its token.");
  const success = await interact(async () => {
    if (session && image) await uploadSessionToken(session, image);
    if (!sameGame()) throw new Error("The game has changed.");
    const actor = battle.actors.find((actor) => actor.id === id && actor.side === "party");
    if (!actor) throw new Error("This character is no longer in the party.");
    if (image) actor.tokenImage = image;
    else delete actor.tokenImage;
    const sheet = battle.sheets?.[id];
    if (sheet) { if (image) sheet.tokenImage = image; else delete sheet.tokenImage; }
  }, { cosmetic: true });
  if (!success) throw new Error(status || "The token could not be updated. Try again.");
}

function inspectActor(id) {
  const actor=battle.actors.find(entry=>entry.id===id);
  if(!actor)return;
  document.dispatchEvent(new CustomEvent("wayfarer:inspect",{
    detail:structuredClone({...actor,tokenImage:partyTokenImage(actor),tokenSession:table?.id,
      ac:armorClass(actor),sharedSheet:table?battle.sheets?.[id]:undefined}),
  }));
}

function canSelectPartyMember(actor) {
  return actorIsUp(actor) && canControl(actor) && (!battle.round || movementGroup(battle).includes(actor));
}

function selectPartyMember(actor) {
  if(!canSelectPartyMember(actor))return;
  const same = selectedId === actor.id;
  selectedId=actor.id;tool="move";category="move";resetActionSelection();
  rememberPreferredFromActor(actor);
  if (compactPlayUi()) actionsSheetOpen = same ? !actionsSheetOpen : true;
  if(!battle.round)detectNearby(actor);
}

function aimBannerCopy(actor, entry) {
  if (hotbarTools) return "Map tools open — tap the board to edit, or cancel.";
  if (!actor || !entry || entry.mode === "move") {
    if (pendingSquare) return `Move ${actor?.name ?? "character"} here — confirm or cancel.`;
    return "";
  }
  const name = entry.name.replace(/^Cunning Action · /, "");
  if (category === "spell") {
    if (spellSquare && !spellEnd) return `${name}: tap the wall endpoint on the map.`;
    if (spellSquare) return `${name}: confirm the cast, or cancel.`;
    return `${name}: tap a target or square on the map.`;
  }
  if (category === "weapon" || category === "potion" || category === "feature" || category === "dominate")
    return `${name}: tap a target on the map.`;
  if (category === "spell-zone" || category === "spell-zone-choice") return `${name}: choose a destination on the map.`;
  if (category === "zone-beam") return `${name}: tap a creature for the beam.`;
  if (category === "interact") return `${name}: select a body or treasure nearby.`;
  if (category === "investigate" || category === "use-feature") return `${name}: choose what to examine.`;
  return `Using ${name}.`;
}

document.addEventListener("click", (event) => {
  if (!root()?.contains(event.target)) return;
  const cameraControl = event.target.closest("[data-camera]");
  if (cameraControl) {
    camera?.control(cameraControl.dataset.camera, cameraToken());
    return;
  }
  if (event.target.closest?.('.game-exit') && table?.writing) { event.preventDefault(); status = 'Saving your action…'; redraw(); return; }
  if (event.target.id === "play-grid") {
    const pos = gridPosition(map, event.target, event);
    const { x, y, region, gx, gy, fx, fy, edge } = pos;
    const wallData = battle.wallData;
    const clickedDoor = doorAt(wallData, gx, gy, 0.45);
    if (clickedDoor && (tool === "move" || tool === "room" || tool === "door")) {
      void interact(() => { const door = toggleDoor(battle.wallData, clickedDoor.id); battle.wallRevision = (battle.wallRevision ?? 0) + 1; rememberVision(battle, map); saveExplored(battle, map); }, { cosmetic: true });
      return;
    }
    if (tool === "wall") {
      battle.wallData ??= { walls: [], doors: [] };
      const existing = battle.wallData.walls?.find(w => segKey(w) === segKey(edge));
      if (existing) {
        removeWall(battle.wallData, edge.x1, edge.y1, edge.x2, edge.y2);
        status = "Wall removed.";
      } else {
        addWall(battle.wallData, edge.x1, edge.y1, edge.x2, edge.y2);
        status = "Wall placed.";
      }
      battle.wallRevision = (battle.wallRevision ?? 0) + 1;
      rememberVision(battle, map);
      saveBattle();
      redraw();
      return;
    }
    if (tool === "door") {
      battle.wallData ??= { walls: [], doors: [] };
      const existing = battle.wallData.doors?.find(d => segKey(d) === segKey(edge));
      if (existing) {
        toggleDoor(battle.wallData, existing.id);
        status = `Door ${existing.state}.`;
      } else {
        addDoor(battle.wallData, edge.x1, edge.y1, edge.x2, edge.y2, "closed");
        status = "Door placed (closed). Click to open/close.";
      }
      battle.wallRevision = (battle.wallRevision ?? 0) + 1;
      rememberVision(battle, map);
      saveBattle();
      redraw();
      return;
    }
    if (tool === "erase-wall") {
      if (battle.wallData) {
        const door = battle.wallData.doors?.find(d => segKey(d) === segKey(edge)) || doorAt(battle.wallData, gx, gy, 0.45);
        if (door) {
          removeDoor(battle.wallData, door.id);
          status = "Door erased.";
        } else {
          removeWall(battle.wallData, edge.x1, edge.y1, edge.x2, edge.y2);
          status = "Wall erased.";
        }
        battle.wallRevision = (battle.wallRevision ?? 0) + 1;
        rememberVision(battle, map);
        saveBattle();
        redraw();
        return;
      }
    }
    if (context.game && battle.round && ["move", "interact"].includes(category) && tool === "move" && matchMedia("(pointer: coarse)").matches &&
      !battle.actors.some((actor) => occupies(actor) && containsCell(actor, x, y))) {
      pendingSquare = movePreview(x, y) ? { x, y, region } : null;
      redraw();
      return;
    }
    interactCell(x, y, region);
    return;
  }
  const button = event.target.closest("[data-play]");
  if (button?.dataset.play === 'new-room') { location.hash = '#play/new'; return; }
  if (button?.dataset.play === 'continue-defeated') { defeatedDismissed = true; redraw(); return; }
  if (!button || pending) return;
  const { play, id } = button.dataset;
  if(play==="party-portrait"){
    const previous=lastPortraitClick;
    const pointerClick=event.detail>0;
    // The first click can rebuild the roster, so a second click can land on a new button node.
    const consecutive=pointerClick && previous?.id===id && previous.scope===table &&
      event.timeStamp-previous.time<=430 && Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<=8;
    if(consecutive||event.detail===2){
      lastPortraitClick=null;
      inspectActor(id);
    }else{
      lastPortraitClick=pointerClick?{id,scope:table,time:event.timeStamp,x:event.clientX,y:event.clientY}:null;
      const actor=battle.actors.find(entry=>entry.id===id);
      if(!canSelectPartyMember(actor)) return;
      // Compact: tapping the selected character toggles the actions sheet (no table write needed).
      if(actor.id===selectedId){
        selectPartyMember(actor);
        redraw();
      }else{
        void interact(()=>selectPartyMember(actor));
      }
    }
    return;
  }
  lastPortraitClick=null;
  if (play === 'delete-room') {
    if (deletingRoom) return;
    const roomId = id; ++roomListRequest; roomsLoading = false; deletingRoom = roomId; roomsError = ''; redraw();
    void (async () => {
      try {
        const snapshot = await readSession(roomId), name = snapshot.state.room?.name || snapshot.map.title;
        if (!confirm(`Permanently delete “${name}”?\n\nThis removes the saved adventure, chat, and uploaded room images for everyone. This cannot be undone.`)) return;
        await deleteRoom(roomId, snapshot.revision); rooms = forgetRoom(roomId); roomsError = 'Room deleted.';
      } catch (error) { if (error.status === 404) { rooms = forgetRoom(roomId); roomsError = 'Room removed.'; } else roomsError = error.message; }
      finally { deletingRoom = ''; if (context && !context.game) redraw(); }
    })(); return;
  }
  if (play === 'game-log') { partyOpen = false; toolsOpen = false; tableOpen = false; storyOpen = false; }
  if (play === 'game-log' && eventLogPlacement === 'hidden') { setEventLogMode('compact'); setActivityPlacement('chat'); return; }
  if (play === 'game-log' && eventLogPlacement === 'chat') {
    setEventLogMode('compact');
    const chat = table?.chat ?? localChat;
    if (chat && !chat.isOpen) chat.show();
    redraw();
    return;
  }
  if (['game-log', 'event-log-expand', 'event-log-toggle'].includes(play)) {
    const next = play === 'event-log-expand' ? eventLogMode === 'expanded' ? 'compact' : 'expanded' : eventLogMode === 'collapsed' ? 'compact' : 'collapsed';
    setEventLogMode(next);
    if (next === 'expanded') { toolsOpen = false; tableOpen = false; storyOpen = false; }
    redraw(); return;
  }
  if (play === 'hotbar-scroll') {
    const grid = root().querySelector('.hotbar-grid');
    grid?.scrollBy({ left: (id === 'back' ? -1 : 1) * Math.max(150, grid.clientWidth * .7), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    return;
  }
  if (play === 'hotbar-tools') { const open = !hotbarTools; resetActionSelection(); hotbarTools = open; category = 'move'; tool = 'move'; if (open && compactPlayUi()) actionsSheetOpen = true; redraw(); return; }
  if (play === 'hotbar-expand') { hotbarExpanded = !hotbarExpanded; redraw(); return; }
  if (play === 'actions-open') { actionsSheetOpen = true; redraw(); return; }
  if (play === 'actions-close') { actionsSheetOpen = false; redraw(); return; }
  if (play === 'actions-back') {
    // Return to the actions sheet without canceling the current aim (selection stays highlighted).
    actionsSheetOpen = true;
    redraw();
    return;
  }
  if (play === 'hotbar-cancel') {
    resetActionSelection(); category = 'move'; tool = 'move';
    if (compactPlayUi()) actionsSheetOpen = true;
    redraw(); return;
  }
  if (play === 'hotbar-tab' || play === 'hotbar-filter') {
    resetActionSelection(); category = 'move'; tool = 'move';
    if (play === 'hotbar-tab') { hotbarTab = id; hotbarFilter = ''; }
    else {
      hotbarFilter = toggleHotbarFilter(hotbarFilter, id);
      hotbarTab = parseHotbarFilters(hotbarFilter).some(part => /^(slot|pact):/.test(part)) ? 'spell' : 'all';
    }
    if (play === 'hotbar-tab' && id === 'weapon') {
      const first = hotbarEntries().find(entry => entry.mode === 'weapon' && entry.usable);
      if (first) { hotbarSelection = first.id; combatChoice = String(first.index); category = 'weapon'; }
    }
    redraw(); return;
  }
  if (play === 'hotbar-select') {
    const entry = hotbarEntries().find(entry => entry.id === id);
    if (!entry) return;
    if (entry.inspect) {
      const actor = selectedActor(); document.dispatchEvent(new CustomEvent('wayfarer:inspect', {
        detail: structuredClone({
          ...actor,
          tokenImage: partyTokenImage(actor), tokenSession: table?.id, sharedSheet: table ? battle.sheets?.[actor.id] : undefined
        })
      })); return;
    }
    if (entry.reason) { status = entry.reason; redraw(); return; }
    resetActionSelection(); tool = 'move'; category = 'move';
    if (entry.instant) {
      interact(() => {
        const actor = selectedActor(); requireControl(actor);
        if (entry.mode === 'feature') useClassAction(battle, actor, entry.actionId, { map });
        else if (entry.mode === 'passive') {
          if (entry.actionId === 'deflect-hand') actor.freeHand = !actor.freeHand;
          if (entry.actionId === 'cutting-words') actor.cuttingWords = !actor.cuttingWords;
          if (entry.actionId === 'arm-inspiration') actor.inspirationArmed = !actor.inspirationArmed;
          if (entry.actionId === 'arm-stun') actor.stunArmed = !actor.stunArmed;
          if (entry.actionId === 'arm-reaction' && entry.reactionRef) armReaction(actor, entry.reactionRef);
          if (entry.actionId === 'disarm-reaction' && entry.reactionRef) disarmReaction(actor, entry.reactionRef);
        }         else if (entry.actionId === 'help-up') helpUp(battle, actor, battle.actors.find(target => target.id === entry.targetId), map);
        else if (entry.actionId === 'wake') wakeCreature(battle, actor, battle.actors.find(target => target.id === entry.targetId));
        else if (entry.actionId === 'witch-bolt') sustainWitchBolt(battle, actor, map);
        else if (entry.actionId === 'end-concentration') endConcentration(battle, actor);
        else if (entry.actionId === 'search') searchRegion(battle, actor, map);
        else turnAction(battle, actor, entry.actionId);
        status = battle.log.at(-1) ?? '';
      }, { cosmetic: entry.mode === 'passive' });
    } else {
      hotbarSelection = entry.id;
      if (entry.index != null) { combatChoice = String(entry.index); category = entry.mode; }
      if (entry.mode === 'feature') { featureChoice = entry.actionId; category = 'feature'; }
      if (entry.mode === 'dominate') category = 'dominate';
      if(entry.actionId==='control-spell-zone'){controlledZone=entry.zoneId;category='spell-zone';}
      if(entry.actionId==='zone-beam'){controlledZone=entry.zoneId;category='zone-beam';}
      if(entry.mode==='spell'){spellSquare=null;spellEnd=null;spellWallForm='wall';const rule=customSpellRule(entry.data.reference||entry.data.key);spellHotSide=rule?.shape==='ring'||spellWallForm==='ring'?'inside':'left';}
      if(entry.controlZone){controlledZone=entry.controlZone;category='spell-zone-choice';}
      if (entry.actionId === 'interact') {
        category = 'interact';
        objectTarget = selectUnderfootObject(selectedActor());
        bodyPlacement = '';
      }
      if (entry.actionId === 'investigate') { category = 'investigate'; featureTargetId = ''; }
      if (entry.actionId === 'use-feature') { category = 'use-feature'; featureTargetId = ''; }
      if (entry.mode === 'potion') potionUse = 'drink';
      if (entry.mode === 'spell') {
        const levelFilters = parseHotbarFilters(hotbarFilter).filter(part => /^(slot|pact):/.test(part));
        const exact = levelFilters.find(part => part.startsWith('slot:') && Number(part.slice(5)) === entry.level)
          || levelFilters.find(part => part.startsWith('pact:') && Number(part.slice(5)) >= entry.level);
        if (exact) castSlot = exact.startsWith('pact:') ? exact : exact.slice(5);
      }
      // Compact: leave the action sheet so the map stays clear while aiming/confirming.
      if (compactPlayUi()) actionsSheetOpen = false;
      redraw();
    }
    return;
  }
  if (play === "dice-effects") { combatCues.toggleDice(); redraw(); return; }
  if(play==='game-rest'){restOpen=!restOpen;partyOpen=false;toolsOpen=false;tableOpen=false;storyOpen=false;if(restOpen&&map.module!=='training')void loadRestEncounters().then(()=>{if(root())redraw();}).catch(error=>{status=error.message;if(root())redraw();});redraw();return;}
  if (play === 'try-again') {
    void interact(async () => {
      const leader = battle.actors.find((actor) => actor.side === 'party' && canControl(actor)) ?? selectedActor();
      requireControl(leader);
      battle = await resetSceneBoard(battle, map, { populate: populateScene, training: trainingActors, reviveParty: true });
      tokenMotion.reset(); queuedMove = null; objectTarget = null; bodyPlacement = '';
      resetActionSelection(); category = 'move'; tool = 'move';
      selectedId = battle.actors.find((actor) => actor.side === 'party' && actorIsUp(actor) && canControl(actor))?.id
        ?? battle.actors.find((actor) => actor.side === 'party' && actorIsUp(actor))?.id ?? '';
      defeatedDismissed = false;
      status = 'Encounter reset. Try again.'; log(battle, status);
    }, { remaining: 0 });
    return;
  }
  if (play === 'game-chat') {
    restOpen = false; partyOpen = false; toolsOpen = false; tableOpen = false; storyOpen = false;
    if (eventLogPlacement === 'hidden') setActivityPlacement('chat');
    (table?.chat ?? localChat)?.toggle();
    redraw();
    return;
  }
  if (play === 'game-party') { restOpen=false; partyOpen = !partyOpen; toolsOpen = false; tableOpen = false; storyOpen = false; redraw(); return; }
  if (play === 'game-tools') { restOpen=false; partyOpen = false; toolsOpen = !toolsOpen; tableOpen = false; storyOpen = false; if (!toolsOpen) { tool = 'move'; gridDraft = null; artFitDraft = null; } redraw(); return; }
  if (play === 'edit-walls') { toolsOpen = false; tool = 'move'; resetActionSelection(); wallEditor.setMode('draw'); redraw(); return; }
  if(play==='sphere-control'){category='spell-zone';redraw();return;}
  if(play==='sphere-recast'){category='spell';controlledZone=null;spellSquare=null;redraw();return;}
  if (play === 'reset-fog-memory') { void interact(() => { forgetExploration(battle); delete battle.fogMemoryByActor; rememberVision(battle, map); saveExplored(battle, map); }, { cosmetic: true }); return; }
  if (play === "toggle-fog") {
    void interact(() => { battle.fogEnabled = !(battle.fogEnabled ?? fogOfWarEnabled); }, { cosmetic: true }); return;
  }
  if (play === "toggle-dm-artwork") {
    void interact(() => {
      battle.showDmArtwork = !battle.showDmArtwork;
      loadArtwork(map);
    }, { cosmetic: true });
    return;
  }
  if (play === "commit-move") {
    if (pendingSquare) {
      const { x, y, region } = pendingSquare;
      pendingSquare = null;
      interactCell(x, y, region);
    }
    return;
  }
  if (play === "retry-session") { if (table?.error) connectTable(table); return; }
  if (play === "game-table") { restOpen=false;
    partyOpen = false;
    tableOpen = !tableOpen;
    if (tableOpen) { toolsOpen = false; storyOpen = false; tool = "move"; gridDraft = null; artFitDraft = null; }
    redraw();
    return;
  }
  if (play === "game-story") { restOpen=false;
    partyOpen = false;
    storyOpen = !storyOpen;
    if (storyOpen) { toolsOpen = false; tableOpen = false; tool = "move"; gridDraft = null; artFitDraft = null; }
    redraw();
    return;
  }
  if (play === "game-category") {
    category = id;
    tool = "move";
    resetActionSelection();
    redraw();
    return;
  }
  if (play === "host-session") { if (!table) hostTable(); return; }
  if (play === "copy-session" && table) {
    const input = root().querySelector("#session-link");
    Promise.resolve().then(() => navigator.clipboard.writeText(inviteURL(table.id)))
      .then(() => setTableMessage("Invite link copied."), () => { input.select(); setTableMessage("Copy the selected invite link."); });
    return;
  }
  if (play === "archive-picker") { root().querySelector("#play-archive-file").click(); return; }
  if (play === "art") { root().querySelector("#play-art").click(); return; }
  if (play === 'potion-use') { potionUse = id === 'throw' ? 'throw' : 'drink'; redraw(); return; }
  if (play === 'world-select') { interactionPosition = null; objectTarget = { type: button.dataset.type, id }; bodyPlacement = ''; redraw(); return; }
  if (play === 'feature-select') { featureTargetId = id; redraw(); return; }
  if (play === 'feature-investigate' || play === 'feature-use') {
    interact(() => {
      const actor = selectedActor();
      requireControl(actor);
      const feature = (battle.features ?? []).find((entry) => entry.id === featureTargetId);
      if (play === 'feature-investigate') investigateFeature(battle, actor, feature, map);
      else useFeature(battle, actor, feature, map);
      status = battle.log.at(-1) ?? '';
    });
    return;
  }
  if (['world-loot', 'world-carry', 'world-drag', 'world-drop', 'world-place', 'world-throw', 'world-help'].includes(play)) {
    if (play === 'world-place' || play === 'world-throw') { bodyPlacement = play === 'world-throw' ? 'throw' : 'place'; status = 'Choose an open map square ' + (bodyPlacement === 'throw' ? 'within 20 feet.' : 'within 5 feet.'); redraw(); return; }
    void interact(() => {
      const actor = selectedActor(); requireControl(actor); const source = worldObject();
      if (play === 'world-loot') takeLoot(battle, actor, source, map);
      if (play === 'world-carry') carryBody(battle, actor, source, map);
      if (play === 'world-drag') dragBody(battle, actor, source, map);
      if (play === 'world-drop') dropBody(battle, actor, source, map);
      if (play === 'world-help') helpUp(battle, actor, source, map);
      status = battle.log.at(-1);
    }); return;
  }
  if (play === "inspect-marker") {
    const marker = battle.markers?.find((entry) => entry.id === id);
    if (marker) document.dispatchEvent(new CustomEvent("wayfarer:marker", { detail: marker }));
    return;
  }
  if (play === "inspect") { inspectActor(id); return; }
  if (play === "enter-game") {
    pending = true;
    redraw();
    launchGame().catch((error) => { status = error.message; }).finally(() => { pending = false; redraw(); });
    return;
  }
  interact(async () => {
    switch (play) {
      case "reset-art-fit":
        artFitDraft = null;
        delete battle.artworkFit;
        if (art && !battle.gridManual) alignImage(art);
        status = "Image placement reset. Rooms stay where the adventure put them.";
        break;
      case "reset-grid":
        gridDraft = null;
        if (!setAlignment(detectedGrid ?? map.sourceGrid) && !setAlignment(map.sourceGrid)) {
          throw new Error("The automatic grid would leave saved pieces outside the map.");
        }
        delete battle.gridManual;
        status = "Automatic grid restored.";
        break;
      case "reveal-marker": {
        const marker = battle.markers?.find((entry) => entry.id === id);
        if (marker) {
          marker.revealed = true;
          marker.hidden = false;
          const feature = (battle.features ?? []).find((entry) => entry.id === marker.id || entry.id === marker.featureId);
          if (feature) {
            setFeatureState(feature, "revealed");
            syncMarkerForFeature(battle, feature);
            recordFeatureDiscovery(battle, map, feature);
          }
          status = marker.name + " revealed.";
        }
        break;
      }
      case "reveal-feature": {
        const feature = (battle.features ?? []).find((entry) => entry.id === id);
        if (feature) {
          setFeatureState(feature, "revealed");
          syncMarkerForFeature(battle, feature);
          recordFeatureDiscovery(battle, map, feature);
          status = feature.name + " revealed.";
        }
        break;
      }
      case "release-wolves":
        if (!battle.round && map.module === "LMoP" && map.id === "1ab" && room?.id === "021") {
          for (const entry of battle.actors.filter((actor) => actor.origin === areaKey(room) && actor.kennelWolf && !actor.kennelAlly && !actor.dead)) {
            entry.side = "hostile";
            entry.chained = false;
          }
          if (context.game) battle.actors.filter((actor) => actor.side === "party").some(detectNearby);
        }
        break;
      case "control-party":
        selectPartyMember(battle.actors.find(entry=>entry.id===id));
        break;
      case "claim-party": {
        const claimTarget = battle.actors.find((actor) => actor.id === id && actor.side === "party");
        if (!table || !claimTarget) break;
        if (claimTarget.kennelAlly) throw new Error("Befriended wolves act on their own — they cannot be claimed.");
        const controllers = battle.controllers ??= {};
        if (controllers[id] && controllers[id] !== controller) throw new Error("Another player claimed this character.");
        if (controllers[id] === controller) delete controllers[id];
        else {
          // Multi-claim: keep any other characters this player already controls.
          controllers[id] = controller;
          selectedId = id;
          rememberPreferredFromActor(claimTarget);
          resetActionSelection();
        }
        break;
      }
      case "rescue-sildar":
        requireControl(selectedActor());
        rescueSildar(battle, map, selectedActor());
        break;
      case "hub-action": {
        requireControl(selectedActor());
        const kennel = runKennelAction(id, battle, map, selectedActor());
        if (kennel) {
          presentKennelResult(kennel);
          break;
        }
        const result = runHubAction(id, battle, map, selectedActor());
        if (result.discovery) storyToasts.show(result.discovery);
        if (result.speech?.actorId) speechBubbles.say(result.speech.actorId, result.speech.lines, { name: result.speech.name });
        if (result.status) status = result.status;
        const roomKind = table?.state?.room?.kind ?? (isYpHub(map) ? "hub" : "campaign");
        // Hub ↔ campaign are separate sessions; stairs stay in-session.
        if (result.travelExpedition && roomKind === "hub" && !isYpHub(result.travelExpedition)) {
          pendingHubDepart = structuredClone(result.travelExpedition);
          break;
        }
        if (result.travelExpedition && roomKind === "campaign" && isYpHub(result.travelExpedition)) {
          pendingHubReturn = true;
          break;
        }
        if (result.travel || result.travelExpedition) {
          const nextMap = result.travel ?? result.travelExpedition;
          const expedition = Boolean(result.travelExpedition);
          const previous = table ? tableState() : (previewState ?? commitRoomState({ battle }, map, battle));
          const moved = expedition ? travelExpedition(previous, nextMap) : travelRoom(previous, nextMap);
          const destination = moved.currentMap;
          const active = roomBattle(moved, destination);
          if (!active.sceneReady && destination.module !== "training") await populateScene(destination, active);
          await applyBakedWalls(destination, active);
          if (destination.module === "YPHub") seedYpHubScene(destination, active);
          for (const member of active.actors.filter((entry) => entry.side === "party")) discoverStory(active, destination, member);
          rememberVision(active, destination);
          const state = commitRoomState(moved, destination, active, moved.alignment);
          adoptTravelMap(destination, active, state);
          if (!table) saveBattle(map, battle);
        }
        break;
      }
      case "archive-local": {
        pending = true;
        status = "Opening the supplied archive…";
        redraw();
        const response = await fetch("local-archive").finally(() => { pending = false; });
        if (!response.ok) throw new Error("The supplied archive could not be opened.");
        await loadFile(await response.blob(), context.localArchive);
        break;
      }
      case "token":
        if (battle.round) targetId = id;
        else { selectedId = id; tool = "move"; }
        break;
      case "add-party": {
        const character = context.characters.find((entry) => entry.id === selectedParty);
        const spawnId = root()?.querySelector("#play-spawn")?.value || selectedSpawnId || "";
        if (character) add(partyActor(character), room ?? startingRegion(map), DEFAULT_PARTY_ID, spawnId || null);
        selectedParty = "";
        break;
      }
      case "remove-spawn": {
        if (removeSpawnMarker(battle, id)) {
          if (selectedSpawnId === id) selectedSpawnId = "";
          status = "Spawn point removed.";
        }
        break;
      }
      case "refresh-party-token": {
        if (table || battle.round) break;
        const actor = selectedActor();
        const character = importedCharacter(actor);
        if (!character) break;
        refreshPartyToken(actor, character);
        status = actor.name + " updated from the character sheet.";
        break;
      }
      case "add-room-monster": {
        if (battle.round || !room) return;
        const roster = roomRoster(map, room);
        const records = [roster[selectedCreature]].filter(Boolean).map((entry) => ({ ...entry, count: 1 }));
        const count = await loadRoster(records, room);
        tool = "room";
        status = plural(count, "token") + " placed.";
        break;
      }
      case "add-homebrew-monster": {
        if (battle.round || !room) return;
        const entry = listHomebrew("monsters")[selectedHomebrew];
        if (!entry) throw new Error("Choose a homebrew creature.");
        const data = monsterStatBlock(entry);
        const actor = await creatureActor({
          name: entry.name,
          source: "HB",
          side: entry.side ?? "hostile",
          data,
        });
        add(actor, room);
        tool = "room";
        status = entry.name + " placed.";
        break;
      }
      case "remove-token":
        if (!battle.round) battle.actors = battle.actors.filter((actor) => actor.id !== selectedId);
        selectedId = "";
        break;
      case "start":
        if (!canRollInitiative()) throw new Error("Place a party member and a hostile creature — or two rival parties — to roll initiative.");
        startInitiative(battle); resetActionSelection(); tool = "move"; break;
      case "end-initiative": endInitiative(battle); clearPendingStrike(); combatChoice = ""; targetId = ""; tool = "move"; break;
      case "leave-combat": {
        const actor = selectedActor();
        requireControl(actor);
        const result = requestTruce(battle, actor);
        status = result === 'ended' ? "Truce accepted. Free movement restored." : battle.log.at(-1);
        if (result === 'ended') { combatChoice = ""; targetId = ""; tool = "move"; }
        break;
      }
      case "create-party": {
        ensureParties(battle);
        const party = createParty(battle);
        status = party.name + " is ready. Add characters to it from this panel.";
        partyOpen = true;
        break;
      }
      case "end":
        requireControl(selectedActor()); endTurn(battle, Math.random, selectedActor()); clearPendingStrike(); resetActionSelection(); category = "move"; break;
      case "death": requireControl(selectedActor()); deathSave(battle, selectedActor()); break;
      case "arm-inspiration": {
        const actor = selectedActor();
        requireControl(actor);
        if (actor.inspiration) actor.inspirationArmed = !actor.inspirationArmed;
        break;
      }
      case "cutting-words": {
        const actor = selectedActor();
        requireControl(actor);
        if (hasFeature(actor, "Cutting Words")) actor.cuttingWords = !actor.cuttingWords;
        break;
      }
      case "arm-reaction": {
        const actor = selectedActor(); requireControl(actor);
        if (!id || !customSpellRule(id, battle.spellRules)) throw new Error("Choose a reaction spell to arm.");
        armReaction(actor, id); status = actor.name + " arms " + (customSpellRule(id, battle.spellRules)?.name || id) + ".";
        break;
      }
      case "disarm-reaction": {
        const actor = selectedActor(); requireControl(actor);
        disarmReaction(actor, id); status = actor.name + " stops holding " + (customSpellRule(id, battle.spellRules)?.name || id) + ".";
        break;
      }
      case "deflect-hand": {
        const actor = selectedActor(); requireControl(actor);
        if (hasFeature(actor, "Deflect Missiles")) actor.freeHand = !actor.freeHand;
        break;
      }
      case "finish-deflect": requireControl(selectedActor()); resolveDeflection(battle, selectedActor(), null); break;
      case "short-rest": case "long-rest": {const actor=selectedActor();requireControl(actor);if(actor?.side!=='party')throw Error('Select a party member to rest.');await takeDungeonRest(battle,map,play==='long-rest',{leaderId:actor.id});status=battle.log.at(-1);break;}
      case "witch-bolt": requireControl(selectedActor()); sustainWitchBolt(battle, selectedActor(), map); break;
      case "wake": requireControl(selectedActor()); wakeCreature(battle, selectedActor(), battle.actors.find((actor) => actor.id === id)); break;
      case "pass-reaction": requireControl(opportunity(battle)?.foe); resolveOpportunity(battle, null, undefined, map); break;
      case "dash": case "dodge": case "disengage": case "bonus-disengage": case "stand":
        requireControl(selectedActor()); turnAction(battle, selectedActor(), play); break;
      case "reset":
        if (window.confirm("Reset this map’s encounter and board? Monsters and treasure will be restored, terrain and combat cleared. Party HP, inventory, XP, character sheets, fog walls, and other maps will be kept.")) {
          requireControl(selectedActor());
          battle = await resetSceneBoard(battle, map, { populate: populateScene, training: trainingActors });
          tokenMotion.reset(); queuedMove = null; objectTarget = null; bodyPlacement = '';
          clearPendingStrike(); resetActionSelection(); category = 'move'; tool = 'move';
          status = 'Encounter and board reset.'; log(battle, status);
        }
        break;
    }
  }, {remaining: ["short-rest", "long-rest", "reset"].includes(play) ? 0 : 6});
});

let lastMovementKeyAt = 0;
function moveWithKey(event) {
  const direction = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0] }[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!direction || !context?.game || !root() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    event.target.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),.game-chat,.game-flyout,.game-event-slot,.dice-theatre,[role="menu"]') ||
    document.querySelector('dialog[open]') || ['wall', 'door', 'erase-wall'].includes(tool)) return false;
  const actor = battle.actors.find(actor => actor.id === selectedId) ?? selectedActor();
  if (!actor || !canControl(actor) || !actorIsUp(actor) || !occupies(actor) || incapacitated(actor) || battle.movement || battle.classReaction ||
    battle.round && !movementGroup(battle).includes(actor)) return false;
  event.preventDefault();
  const now = performance.now();
  if (event.repeat && now - lastMovementKeyAt < 140) return true;
  lastMovementKeyAt = now;
  const [dx, dy] = direction, x = actor.x + dx, y = actor.y + dy;
  if (previewMovement(battle, actor, x, y, map)?.path.length !== 1) return true;
  selectedId = actor.id;
  if (category !== 'interact') { resetActionSelection(); category = 'move'; }
  tool = 'move';
  camera?.reveal(mapPoint({ x, y }));
  interactCell(x, y, regionAt(map, ...cellCenter(map, { x, y })), { step: true });
  return true;
}

document.addEventListener("keydown", (event) => {
  const portrait=event.target.closest?.('[data-play="party-portrait"]');
  if(portrait && root()?.contains(portrait) && event.key==="Enter" && event.shiftKey && !event.repeat){
    event.preventDefault();
    inspectActor(portrait.dataset.id);
    return;
  }
  if (event.key === " " && context?.game && battle?.round && !event.defaultPrevented &&
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      !document.querySelector('dialog[open]') &&
      !event.target.closest?.('input,select,textarea,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="menu"],[role="listbox"],.game-chat,.game-flyout,.game-event-slot,.dice-theatre')) {
    event.preventDefault();
    if (!event.repeat && !pending && !table?.writing) root()?.querySelector('.game-hud [data-play="end"]:enabled')?.click();
    return;
  }
  if (moveWithKey(event)) return;
  if (event.defaultPrevented || event.target.id !== "play-grid") return;
  const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const viewKey = { "+": "in", "=": "in", "-": "out", "0": "fit" }[event.key];
  if (viewKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    camera?.control(viewKey);
    return;
  }
  if (!keys[event.key] && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  const initial = selectedActor();
  cursor ||= initial?.x != null ? { x: initial.x, y: initial.y } : { x: 0, y: 0 };
  if (keys[event.key]) {
    const [dx, dy] = keys[event.key];
    if (event.shiftKey) { camera?.pan(dx, dy); return; }
    cursor.x = Math.max(0, Math.min(map.cols - 1, cursor.x + dx));
    cursor.y = Math.max(0, Math.min(map.rows - 1, cursor.y + dy));
    camera?.reveal(mapPoint(cursor));
    if (context.game && ["move", "interact"].includes(category) && tool === "move") movePreview(cursor.x, cursor.y);
    else paintBoard();
    event.target.setAttribute("aria-label", "Square " + (cursor.x + 1) + ", " + (cursor.y + 1));
  } else interactCell(cursor.x, cursor.y, regionAt(map, ...cellCenter(map, cursor)));
});

function paintMovementPreview(){
  if(animatedBoard?.camera===camera && camera && context?.game){
    animatedBoard.options.cursor=cursor;
    animatedBoard.options.path=pathPreview;
    paintAnimationFrame();
  }else paintBoard();
}

function updateMovementPreviewMessage(){
  const line=root()?.querySelector("#game-move-preview");
  if(line)line.textContent=previewMessage;
}

let explorationPreview;
function movePreview(x,y,{pointer=false}={}){
  clearTimeout(explorationPreview);
  const actor=selectedActor();
  if(!canControl(actor))return null;
  const known=canUseMapSquare(x,y);
  const sameSquare=actor.x===x&&actor.y===y;
  const size=creatureSize(actor), name=actor.name.trim().split(/\s+/)[0];
  const mode=Boolean(battle.round);
  const request={x,y,creatureSize:size,movement:true,known,blocked:false,pointer,label:''};
  cursor=request;
  pathPreview=null;
  const show=route=>{
    request.blocked=!route;
    request.label=route?.cost?'Move '+name+' · '+route.cost+' ft':'Move '+name;
    pathPreview=route?.path.length?[actor,...route.path.map(cell=>({...cell,creatureSize:size}))]:null;
    previewMessage=route?'Move '+actor.name+' · '+route.cost+' ft'+(mode?' · '+(moveLeft(battle,actor)-route.cost)+' ft remaining':''):
      "Can't move "+actor.name+" here · "+(mode?'blocked or beyond remaining movement':'blocked or unreachable');
    updateMovementPreviewMessage();
    paintMovementPreview();
    return route;
  };
  if(!known || sameSquare){
    previewMessage=!known?"Choose a seen square for "+actor.name+".":"Choose a destination for "+actor.name+".";
    updateMovementPreviewMessage();
    paintMovementPreview();
    return null;
  }
  if(mode||!pointer||!canStand(battle,actor,x,y,map))return show(previewMovement(battle,actor,x,y,map));
  // Exploration routes can span large maps. Wait for the pointer to settle.
  const board=map,state=battle,fromX=actor.x,fromY=actor.y;
  request.label="Checking route…";
  previewMessage="Finding a route for "+actor.name+"…";
  updateMovementPreviewMessage();
  paintMovementPreview();
  explorationPreview=setTimeout(()=>{
    if(cursor===request&&battle===state&&map===board&&selectedActor()===actor&&actor.x===fromX&&actor.y===fromY){
      show(previewMovement(state,actor,x,y,board));
    }
  },90);
  return null;
}

document.addEventListener("pointermove", (event) => {
  if (wallEditor.active || !context?.game || ((gridDraft || artFitDraft) && root()?.querySelector("#grid-settings")?.open) || event.target.id !== "play-grid") return;
  if (tool === "wall" || tool === "door" || tool === "erase-wall") {
    const pos = gridPosition(map, event.target, event);
    cursor = { x: pos.x, y: pos.y, edge: pos.edge, tool };
    paintBoard();
    return;
  }
  const { x, y } = gridPosition(map, event.target, event);
  if (wallAimRule()) {
    if (!cursor?.aim || cursor.x !== x || cursor.y !== y) {
      cursor = { x, y, aim: true };
      paintBoard();
    }
    return;
  }
  if (tool !== "move" || !["move","interact"].includes(category) || bodyPlacement ||
      event.pointerType==="touch" || event.buttons) return;
  if (!cursor?.movement || cursor.x !== x || cursor.y !== y) movePreview(x,y,{pointer:true});
});

document.addEventListener('pointerout',event=>{
  if(event.target.id!=='play-grid'||!cursor?.pointer||pendingSquare)return;
  clearTimeout(explorationPreview);
  cursor=null;
  pathPreview=null;
  previewMessage='';
  updateMovementPreviewMessage();
  paintMovementPreview();
});

function positionHotbarTooltip(event) {
  const tile = event.target.closest?.('.hotbar-tile');
  if (!tile || !root()?.contains(tile)) return;
  const tooltip = tile.querySelector('.hotbar-tooltip'); if (!tooltip) return;
  const bounds = tile.getBoundingClientRect();
  tooltip.style.left = Math.max(10, Math.min(innerWidth - tooltip.offsetWidth - 10, bounds.left + bounds.width / 2 - tooltip.offsetWidth / 2)) + 'px';
  tooltip.style.top = Math.max(8, bounds.top - tooltip.offsetHeight - 10) + 'px';
}
document.addEventListener('pointerover', positionHotbarTooltip);
document.addEventListener('focusin', positionHotbarTooltip);

function featureEntriesFor(name, features) {
  if (!name || !features?.length) return null;
  const needle = String(name).replace(/ \(.*\)$/, "").toLowerCase();
  for (const feature of features) {
    if (String(feature.name || "").replace(/ \(.*\)$/, "").toLowerCase() === needle) return feature.entries ?? null;
    const nested = featureEntriesFor(name, feature.entries ?? feature.items);
    if (nested) return nested;
  }
  return null;
}

function openHotbarDetail(entry) {
  if (!entry) return;
  const actor = selectedActor();
  if (entry.inspect) {
    if (!actor) return;
    document.dispatchEvent(new CustomEvent('wayfarer:inspect', {
      detail: structuredClone({
        ...actor,
        tokenImage: partyTokenImage(actor), tokenSession: table?.id, sharedSheet: table ? battle.sheets?.[actor.id] : undefined
      })
    }));
    return;
  }
  const sheet = actor ? (importedCharacter(actor) ?? battle.sheets?.[actor.id]) : null;
  const features = sheet?.rulesDetails?.classDetails?.features ?? [];
  const model = hotbarDetailModel(entry, actor ?? {}, {
    entries: featureEntriesFor(entry.data?.feature || entry.name, features),
  });
  if (!model) return;
  document.dispatchEvent(new CustomEvent('wayfarer:hotbar-detail', { detail: model }));
}

document.addEventListener('contextmenu', event => {
  const tile = event.target.closest?.('.hotbar-tile');
  if (!tile || !root()?.contains(tile)) return;
  event.preventDefault();
  const entry = hotbarEntries().find(item => item.id === tile.dataset.id);
  openHotbarDetail(entry);
});
document.addEventListener('keydown', event => {
  if (!context?.game || !root() || event.altKey || event.ctrlKey || event.metaKey || event.repeat ||
    event.target.closest?.('input,select,textarea,[contenteditable="true"],.game-event-slot') || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape' && (hotbarSelection || hotbarTools || pendingSquare)) { event.preventDefault(); resetActionSelection(); category = 'move'; tool = 'move'; redraw(); return; }
  if (!/^\d$/.test(event.key)) return;
  const tile = root().querySelector('[data-hotbar-shortcut="' + event.key + '"]');
  if (tile && tile.getAttribute('aria-disabled') !== 'true') { event.preventDefault(); tile.click(); }
});
document.addEventListener('wheel', event => {
  const grid = event.target.closest?.('.game-hotbar:not(.expanded) .hotbar-grid, .hotbar-resources');
  if (!grid || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || grid.scrollWidth <= grid.clientWidth) return;
  event.preventDefault();
  grid.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? grid.clientWidth : 1);
}, { passive: false });

document.addEventListener("input", (event) => {
  if (!root()?.contains(event.target)) return;
  if (event.target.id === 'hotbar-search' || event.target.dataset.play === 'hotbar-search') {
    hotbarSearch = event.target.value;
    const start = event.target.selectionStart, end = event.target.selectionEnd;
    redraw();
    const field = root()?.querySelector('#hotbar-search');
    if (field) { field.focus({ preventScroll: true }); try { field.setSelectionRange(start, end); } catch {} }
    return;
  }
  if (event.target.id === 'new-room-name') { roomDraft.name = event.target.value; return; }
  if (event.target.id === 'new-room-username' || event.target.id === "hub-username") { roomDraft.username = event.target.value; return; }
  if (event.target.id === 'new-room-prepared') { roomDraft.prepared = event.target.checked; redraw(); return; }
  if (event.target.id === 'spawn-point-name') { spawnNameDraft = event.target.value; return; }
  if (event.target.id === 'play-spawn' || event.target.id === 'session-spawn') { selectedSpawnId = event.target.value; return; }
  if (event.target.name === 'room-character') {
    const checked = [...root().querySelectorAll('[name="room-character"]:checked')];
    if (checked.length > 4) {
      event.target.checked = false;
      status = 'Choose up to four starting characters.';
      const note = root().querySelector('.room-create-status');
      if (note) note.textContent = status;
    }
    roomDraft.party = new Set([...root().querySelectorAll('[name="room-character"]:checked')].map(input => input.value));
    for (const tile of root().querySelectorAll('.room-party-tile')) {
      const on = tile.querySelector('input')?.checked;
      tile.classList.toggle('is-selected', Boolean(on));
    }
    const count = root().querySelector('.room-party-count');
    if (count) count.textContent = roomDraft.party.size + ' selected';
    const brief = root().querySelector('.adventure-brief');
    if (brief) brief.outerHTML = adventureBriefing(roomDraft.party);
    return;
  }
  if (event.target.id === "session-username" && table?.needsUsername) {
    table.usernameDraft = event.target.value;
    return;
  }
  if (event.target.id.startsWith("art-fit-")) {
    previewArtworkFit(readArtworkFit() ?? currentArtworkFit());
    return;
  }
  if (event.target.id === "grid-align-scale") {
    const scale = event.target.valueAsNumber;
    if (!Number.isFinite(scale) || scale <= 0) {
      const feedback = root().querySelector("#grid-align-feedback");
      if (feedback) feedback.textContent = "Enter a positive scale percentage.";
      return;
    }
    previewAlignment(alignmentFromScale(scale), { from: "scale" });
    return;
  }
  if (!event.target.id.startsWith("grid-align-")) return;
  previewAlignment(readAlignment(), { from: "fields" });
});

document.addEventListener("toggle", (event) => {
  if (event.target.id !== "grid-settings" || !root()?.contains(event.target) || event.target.open) return;
  let redrawBoard = false;
  if (gridDraft) {
    gridDraft = null;
    updateAlignmentFields();
    redrawBoard = true;
  }
  if (artFitDraft) {
    artFitDraft = null;
    redrawBoard = true;
  }
  if (redrawBoard) paintBoard();
}, true);

document.addEventListener("change", (event) => {
  if (!root()?.contains(event.target)) return;
  const { id, value } = event.target;
  if (id.startsWith("extra-target-")) {
    extraTargets.set(Number(id.slice("extra-target-".length)), value);
    return;
  }
  switch (id) {
    case "play-archive-file": loadFile(event.target.files[0], event.target.files[0]?.name); return;
    case "play-module":
      roomDraft.adventure=value;
      roomDraft.prepared=false;
      status="";
      if(isBuiltinModule(value)||hasArchive())void selectModule(value);else redraw();
      return;
    case 'room-map':{const entry=maps.find(entry=>entry.key===value);if(entry)void changeRoomMap(entry);return;}
    case "play-map": { const entry = maps.find(({ key }) => key === value); if (entry) useMap(entry); break; }
    case "play-room": selectRoom(map.regions.find((region) => areaKey(region) === value)); tool = "room"; break;
    case 'rest-table': {if(!restTableChoices(map).policies.some(p=>p.id===value))return;void interact(()=>{battle.rest??={};(battle.rest.tableChoices??={})[map.key]=value;},{cosmetic:true});return;}
    case "activity-placement": if (value !== "hidden") setEventLogMode("compact"); setActivityPlacement(value); return;
    case "grid-tool": tool = value; if (value === "spawn" && !spawnNameDraft) spawnNameDraft = "Party 1 start"; break;
    case "grid-overlay": interact(() => { battle.gridOverlay = value; }); return;
    case "grid-square-ft": {
      const next = Number(value) === 10 ? 10 : 5;
      interact(() => {
        const previous = currentSquareFt();
        if (next === previous) return;
        battle.gridSquareFt = next;
        const alignment = battle.gridManual ?? detectedGrid ?? map.printedGrid ?? map.sourceGrid;
        if (!setAlignment(alignment)) {
          battle.gridSquareFt = previous === defaultSquareFeet(map.sourceGrid) ? undefined : previous;
          throw new Error("That square size would push tokens off the map. Move them first or reset alignment.");
        }
        // Re-fit artwork to the new printed scale when using automatic alignment.
        if (!battle.gridManual && art) {
          try { detectedGrid = alignArtwork(art, map, next, currentArtworkFit()); } catch { detectedGrid = null; }
          if (detectedGrid) setAlignment(detectedGrid);
        }
        updateAlignmentFields();
      });
      return;
    }
    case "room-creature": selectedCreature = Number(value); break;
    case "homebrew-creature": selectedHomebrew = Number(value); break;
    case "play-party": selectedParty = value; break;
    case "play-spawn":
    case "session-spawn": selectedSpawnId = value; break;
    case 'spell-hot-side':spellHotSide=value;break;
    case 'spell-wall-form':spellWallForm=value==='ring'?'ring':'wall';spellEnd=null;spellHotSide=spellWallForm==='ring'?'inside':'left';break;
    case "combat-choice": combatChoice = value; spellSquare = null; castSlot = ""; extraTargets.clear(); break;
    case "cast-slot": castSlot = value; break;
    case "breath-type": breathType = value; return;
    case "feature-select": featureChoice = value; break;
    case "target-select": targetId = value; break;
    case "roll-mode": rollMode = value; break;
    case "cover": cover = value; break;
    case "play-art": {
      const file = event.target.files[0];
      if (file) loadArtwork(map, file);
      return;
    }
    case "custom-bonus": customWeapon.bonus = value; return;
    case "custom-damage": customWeapon.damage = value; return;
    case "custom-range": customWeapon.normalRange = value; return;
    case "custom-reach": customWeapon.reach = value; return;
    default: return;
  }
  redraw();
});


function executeCombatSelection(form) {
  const value = id => form?.querySelector("#" + id)?.value;

  const actor = selectedActor();
  requireControl(actor);
  const { choice, target: creatureTarget } = combatSelection(actor, visibleTokens());
  const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.reference || choice.data.key) : null;
  const target = effect?.area || effect?.cone || effect?.teleport ? null : creatureTarget;
  const meleeWeapons = classWeapons(actor, battle).filter(weapon => !weapon.normalRange && Number.isFinite(weapon.bonus));
  const weaponPick = Number(value("spell-weapon"));
  const options = {
    mode: rollMode, cover, square: spellSquare, map, damageType: breathType,end:spellEnd,hotSide:spellHotSide,
    form: effect?.custom&&allowsWallRing(effect.definition)?spellWallForm:undefined,
    slotPool: (value("cast-slot") ?? "").startsWith("pact:") ? "pact" : slotRank(value("cast-slot")) > 0 ? "spellcasting" : undefined,
    focusedAim: Number(value("focused-aim")) || 0,
    stun: form.querySelector("#stunning-strike")?.checked,
    keepTemp: form.querySelector("#keep-temp")?.checked,
    weapon: effect?.definition?.weaponAttack ? meleeWeapons[Number.isFinite(weaponPick) ? weaponPick : 0] : undefined,
    targets: [...form.querySelectorAll('[id^="extra-target-"]')].map((field) =>
      battle.actors.find((entry) => entry.id === field.value))
  };
  if (!choice?.usable) {
    if (choice?.manual) {
      recordSpell(battle, actor, choice.data, slotRank(value("cast-slot")), options);
      status = battle.log.at(-1);
    }
    return;
  }
  if (!battle.round && (choice.mode === "weapon" || choice.mode === "custom" ||
    (choice.mode === "spell" && !effect?.exploration && target && isCombatFoe(actor, target)))) {
    const enemy = target && isCombatFoe(actor, target) ? target : (effect?.area || effect?.cone) && spellSquare
      ? battle.actors.find((entry) => entry.side === "hostile" && actorIsUp(entry) && noticesEnemy(battle, map, actor, entry)) : null;
    if (!beginCombat(actor, enemy, false)) throw new Error("Choose an enemy or player character to start combat.");
    return;
  }
  if(choice.mode==='spell'&&effect?.custom&&!effect.area&&!battle.round&&effect.definition.effects.some(block=>block.kind!=='healing'&&(block.damage.length||block.condition||block.save))){
    const foe=battle.actors.find(enemy=>isCombatFoe(actor,enemy)&&actorIsUp(enemy)&&(target?.id===enemy.id||options.targets?.some(entry=>entry.id===enemy.id)));
    if(foe){beginCombat(actor,foe,false);if(!canTakeTurn(battle,actor))return;}
  }
  if (choice.mode === "spell") {
    castSpell(battle, actor, target, choice.data, slotRank(value("cast-slot")), options);
    if(effect?.custom&&['sphere','movable'].includes(effect.definition.shape)){const zone=battle.spellZones?.find(zone=>zone.custom&&zone.caster===actor.id&&zone.rule.reference===choice.data.reference);if(zone){controlledZone=zone.id;hotbarSelection='spell:'+(choice.data.reference||choice.data.key);category='spell-zone-choice';}}
    status = battle.log.at(-1);
    if (!battle.round && !effect?.teleport) {
      const hitIds = new Set((battle.actionEvents?.at(-1)?.impacts ?? []).map(impact => impact.actor));
      const foe = battle.actors.find(enemy => isCombatFoe(actor, enemy) && actorIsUp(enemy) && hitIds.has(enemy.id));
      if (foe) beginCombat(actor, foe, false);
    }
    if (!battle.round && effect?.teleport) detectNearby(actor);
  }
  else if (choice.mode === "potion") { if (potionUse === 'throw') throwHealingPotion(battle, actor, target, choice.data, map); else drinkPotion(battle, actor, choice.data); }
  else {
    const weapon = choice.mode === "weapon" ? choice.data : {
      name: "Custom strike", bonus: value("custom-bonus") === "" ? null : Number(value("custom-bonus")),
      damage: value("custom-damage"), normalRange: Number(value("custom-range")) || undefined,
      reach: Number(value("custom-reach")) || 5,
    };
    performWeaponStrike(actor, target, weapon, options);
  }

}

function queuePendingStrike(actor, target, weapon, options) {
  pendingStrike = {
    actorId: actor.id,
    targetId: target.id,
    weapon: structuredClone(weapon),
    options: {
      mode: options.mode,
      cover: options.cover,
      stun: options.stun,
      focusedAim: options.focusedAim,
      bonusStrike: options.bonusStrike,
      kiFueled: options.kiFueled,
    },
    mapKey: map.key,
    round: battle.round,
  };
}

function clearPendingStrike() {
  pendingStrike = null;
}

/** Move into range when needed, then strike — or queue the strike if opportunity attacks pause movement. */
function performWeaponStrike(actor, target, weapon, options) {
  if (!target) throw new Error("Choose a target.");
  if (battle.round) {
    const moved = approachForStrike(battle, actor, target, weapon, map);
    if (moved && battle.movement) {
      queuePendingStrike(actor, target, weapon, options);
      status = actor.name + " moves into range…";
      return;
    }
  }
  rollStrike(battle, actor, target, weapon, options);
  if (target && isCombatFoe(actor, target)) joinInitiative(battle, target);
  status = battle.log.at(-1) ?? status;
}

function resumePendingStrike() {
  if (!pendingStrike || battle.movement || battle.classReaction) return false;
  const job = pendingStrike;
  pendingStrike = null;
  if (map.key !== job.mapKey || battle.round !== job.round) return false;
  const actor = battle.actors.find((entry) => entry.id === job.actorId);
  const target = battle.actors.find((entry) => entry.id === job.targetId);
  if (!actor || !target || !actorIsUp(actor) || !canControl(actor) || !occupies(actor) || !occupies(target)) {
    status = "The attack could not continue after moving.";
    return false;
  }
  try {
    rollStrike(battle, actor, target, job.weapon, { ...job.options, map });
    if (isCombatFoe(actor, target)) joinInitiative(battle, target);
    status = battle.log.at(-1) ?? status;
    return true;
  } catch (failure) {
    status = failure instanceof Error ? failure.message : "The attack could not continue after moving.";
    return false;
  }
}

function executeClassSelection(form, targetOverride) {
  const value = id => form?.querySelector("#" + id)?.value;

  const actor = selectedActor();
  requireControl(actor);
  const id = value("feature-select");
  const action = classActions(actor, battle).find((entry) => entry.id === id);
  const target = targetOverride ?? battle.actors.find((entry) => entry.id === value("feature-target"));
  if (action?.attack) {
    const unarmed = classWeapons(actor, battle).filter((weapon) => weapon.unarmed || action.monkWeapon && weapon.monkWeapon);
    const weapon = unarmed[Number(value("feature-unarmed"))];
    if (!weapon) throw new Error("Choose an unarmed strike.");
    performWeaponStrike(actor, target, weapon, {
      map,
      bonusStrike: true,
      kiFueled: action.id === "ki-fueled",
      stun: Boolean(actor.stunArmed && actor.resources?.ki?.current > 0 && !weapon.normalRange),
    });
  } else {
    const ids = [...form.querySelectorAll('[name="burst-target"]:checked')].map((input) => input.value);
    useClassAction(battle, actor, id, { map, target, targets: battle.actors.filter((entry) => ids.includes(entry.id)) });
  }
  status = battle.log.at(-1);

}
document.addEventListener("submit", (event) => {
  if (!root()?.contains(event.target)) return;
  event.preventDefault();
  const value = (id) => event.target.querySelector("#" + id)?.value;
  if (event.target.id === 'create-room-form') { createAdventureRoom(); return; }
  if (event.target.id === "enter-hub-form") { void enterHubSession(); return; }
  if (event.target.id === "session-join-form") {
    const id = sessionCode(value("session-invite"));
    if (id) location.hash = sessionHash(id);
    else root().querySelector("#session-join-error").textContent = "Enter a valid Wayfarer invite link or session code.";
    return;
  }
  if (event.target.id === "session-username-form") {
    if (table?.needsUsername) connectTable(table, value("session-username"));
    return;
  }
  interact(async () => {
    switch (event.target.id) {
      case "deflect-form": {
        const actor = selectedActor(); requireControl(actor);
        resolveDeflection(battle, actor, battle.actors.find(target => target.id === value("deflect-target")), { map, fits: event.target.elements.namedItem("deflect-fits").checked });
        break;
      }
      case "fall-form": {
        const actor = battle.actors.find(actor => actor.id === value("fall-target")); requireControl(actor);
        fallingDamage(battle, actor, Number(value("fall-height")), { slowFall: event.target.elements.namedItem("slow-fall").checked });
        status = battle.log.at(-1); break;
      }
      case "class-skill-form": {
        const actor = selectedActor();
        requireControl(actor);
        classSkillCheck(battle, actor, value("class-skill"), map);
        status = battle.log.at(-1);
        break;
      }
      case "class-action-form": executeClassSelection(event.target); break;
      case "dominate-form": {
        const actor = selectedActor();
        requireControl(actor);
        const entry = hotbarEntries(actor).find((item) => item.id === hotbarSelection);
        const thrall = battle.actors.find((creature) => creature.id === entry?.thrallId);
        const order = value("dominate-order");
        const targetId = value("dominate-target") || null;
        const intent = event.submitter?.value || event.target.querySelector('[name="dominate-intent"]')?.value || "command";
        if (intent === "control") seizeDominateControl(battle, actor, thrall, order, targetId);
        else issueDominateCommand(battle, actor, thrall, order, targetId);
        status = battle.log.at(-1) ?? "";
        resetActionSelection();
        category = "move";
        break;
      }
      case "session-party-form":
      case "game-party-form": {
        const character = context.characters.find(({ id }) => id === value("session-character"));
        if (!character || battle.actors.some(({ id }) => id === "party:" + character.id)) return;
        const connection = table;
        const actor = partyActor(character);
        const chosenParty = value("session-party") || DEFAULT_PARTY_ID;
        const spawnId = value("session-spawn") || selectedSpawnId || "";
        if (connection && actor.tokenImage) await uploadSessionToken(connection.id, actor.tokenImage);
        if (connection !== table) return;
        add(actor, room ?? startingRegion(map), chosenParty, spawnId || null);
        selectedSpawnId = spawnId || selectedSpawnId;
        (battle.sheets ??= {})[actor.id] = sharedSheet(character);
        const spawn = findSpawn(battle, spawnId);
        status = actor.name + " joined " + (battle.parties.find(party => party.id === actorPartyId(actor))?.name || "the party")
          + (spawn ? " at " + spawn.name : "")
          + "." + (battle.round ? " Initiative: " + actor.initiativeRoll + "." : "");
        break;
      }
      case "art-fit-form": {
        const fit = readArtworkFit();
        if (!fit) throw new Error("Enter a positive image scale and finite shifts.");
        if (artworkFitIsDefault(fit)) delete battle.artworkFit;
        else battle.artworkFit = fit;
        artFitDraft = null;
        if (art && !battle.gridManual) alignImage(art);
        status = "Image placement saved. Rooms and monsters stayed put.";
        break;
      }
      case "grid-align-form": {
        const alignment = readAlignment();
        if (!alignment || !setAlignment(alignment)) throw new Error("Enter valid spacing and keep saved pieces inside the grid.");
        battle.gridManual = alignment;
        gridDraft = null;
        status = "Grid alignment saved.";
        break;
      }
      case "dice-form": {
        diceFormula = value("dice-expression");
        withActionEvent(battle, selectedActor(), { action: "Dice roll", kind: "check" }, () => {
          const roll = rollDice(diceFormula);
          diceResult = roll.breakdown + " = " + roll.total;
          log(battle, "Dice roll — " + diceResult + ".");
        });
        break;
      }
      case "creature-form": {
        const name = value("creature-name").trim();
        const source = value("creature-source").trim();
        if (!await monsterRecord(name, source)) throw new Error("Creature not found. Check its name and source code.");
        const actor = await creatureActor({ name, source });
        actor.side = value("creature-side");
        add(actor);
        break;
      }
      case "token-settings": {
        const actor = selectedActor();
        if (!actor || battle.round) return;
        actor.swings = Number(value("actor-swings"));
        actor.hp = Number(value("actor-hp"));
        const disposition = value("actor-side");
        if (disposition === "hostile" || disposition === "neutral") actor.side = disposition;
        if (actor.spells.length) {
          for (const [field, id] of [["spellDC", "actor-spell-dc"], ["spellAttack", "actor-spell-attack"], ["spellAbility", "actor-spell-ability"]]) {
            const number = value(id);
            actor[field] = number === "" ? null : Number(number);
          }
        }
        if (!actor.hp) {
          actor.prone = actor.resolveDeath;
          actor.dead = !actor.resolveDeath;
        } else {
          actor.dead = false;
          actor.stable = false;
          actor.successes = actor.failures = 0;
        }
        for (const [level, pool] of Object.entries(actor.slots)) {
          const current = value("slot-" + level);
          pool.current = current === "" ? null : Number(current);
        }
        status = "Token updated.";
        break;
      }
      case "reaction-form":
        requireControl(opportunity(battle)?.foe);
        resolveOpportunity(battle, Number(value("reaction-attack")), undefined, map);
        break;
      case "manual-hp-form": {
        if (battle.movement) throw new Error("Resolve the opportunity attack first.");
        const target = battle.actors.find(({ id }) => id === value("manual-target"));
        if (!target || target.dead) throw new Error("Choose a living token.");
        const amount = Number(value("manual-amount"));
        if (value("manual-effect") === "heal") log(battle, target.name + " regains " + heal(target, amount) + " HP by manual ruling.");
        else {
          const type = value("manual-type");
          withActionEvent(battle,target,{action:"Manual damage",kind:"damage"},()=>{
            const result=applyDamage(battle,target,amount,type);
            log(battle,target.name+" takes "+result.damage+" "+type+" damage by manual ruling.");
          });
        }
        break;
      }
      case "combat-form": executeCombatSelection(event.target); break;
    }
  });
});

document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-wall-editor]'); if (button) { event.preventDefault(); event.stopImmediatePropagation(); void wallEditor.action(button.dataset.wallEditor); }
}, true);
document.addEventListener('submit', event => {
  const form = event.target;
  if (form.id !== 'fog-settings' && !form.matches?.('[data-vision-actor]')) return; event.preventDefault(); event.stopImmediatePropagation(); const values = new FormData(form);
  if (form.id === 'fog-settings') void interact(() => { battle.fogSettings = { sharedVision: values.has('sharedVision'), remember: values.has('remember'), blockMovement: values.has('blockMovement'), opacity: Number(values.get('opacity')) / 100, exploredOpacity: Number(values.get('exploredOpacity')) / 100, softness: Number(values.get('softness')) }; rememberVision(battle, map); saveExplored(battle, map); }, { cosmetic: true });
  else { const id = form.dataset.visionActor; void interact(() => { const actor = battle.actors.find(a => a.id === id); if (actor) { actor.vision = { enabled: values.has('enabled'), range: Number(values.get('range')), angle: Number(values.get('angle')), facing: Number(values.get('facing')) }; rememberVision(battle, map); saveExplored(battle, map); } }, { cosmetic: true }); }
}, true);

document.addEventListener('wayfarer:activity-placement', event => { if (event.detail === 'chat') setEventLogMode('compact'); setActivityPlacement(event.detail); });
document.addEventListener('wayfarer:chat-visibility', event => root()?.querySelector('[data-play=game-chat]')?.setAttribute('aria-pressed', String(event.detail)));


export function syncLocalCharacterToken(characterId, image) {
  const id = characterId.startsWith('party:') ? characterId : 'party:' + characterId;
  for(const actor of previewState?.battle?.actors ?? [])if(actor.id===id&&actor.side==='party'){if(image)actor.tokenImage=image;else delete actor.tokenImage;}
  try{if(previewState)localStorage.setItem(previewKey,JSON.stringify(previewState));}catch{}
  document.dispatchEvent(new Event('wayfarer:character-token'));
}


function closeDistantInteraction() {
  if (category !== 'interact' || !objectTarget || bodyPlacement) { interactionPosition = null; return; }
  const actor = selectedActor(), source = worldObject();
  const position = actor && `${actor.id}:${actor.x}:${actor.y}`;
  if (interactionPosition === null) { interactionPosition = position; return; }
  if (position === interactionPosition && source) return;
  interactionPosition = position;
  if (actor && source && (source.carriedBy === actor.id || source.draggedBy === actor.id || withinReach(battle, actor, source, map))) return;
  objectTarget = null; bodyPlacement = ''; resetActionSelection(); category = 'move'; tool = 'move';
}
function worldObject() { return objectTarget?.type === 'body' ? battle.actors.find(body => body.id === objectTarget.id) : battle.markers?.find(marker => marker.id === objectTarget?.id); }
function featureExplorationPanel(actor, mode) {
  const region = regionAt(map, ...cellCenter(map, actor));
  const regionId = region ? areaKey(region) : null;
  const candidates = (battle.features ?? []).filter((feature) => {
    if (regionId && feature.regionId !== regionId && feature.origin !== regionId) return false;
    // Hidden features stay off the card list until Search / passive Perception notices them.
    if (mode === 'investigate') return feature.state === 'hinted' || feature.state === 'revealed';
    return feature.state === 'revealed' || feature.state === 'triggered';
  });
  const selected = candidates.find((feature) => feature.id === featureTargetId) ?? candidates[0];
  if (selected && selected.id !== featureTargetId) featureTargetId = selected.id;
  const card = featureCardModel(selected);
  if (!candidates.length) {
    return `<p>${mode === 'investigate'
      ? 'Nothing here looks worth a closer look. Try Search first.'
      : 'No revealed mechanisms or objects to use in this room.'}</p>`;
  }
  const stateLabel = (state) => state === 'hinted' ? 'noticed' : state === 'revealed' ? 'known' : state === 'triggered' ? 'used' : state;
  const list = `<div class="world-objects">${candidates.map((feature) =>
    `<button type="button" class="game-button" data-play="feature-select" data-id="${escape(feature.id)}" aria-pressed="${feature.id === featureTargetId}">${escape(feature.name)} · ${escape(stateLabel(feature.state))}</button>`
  ).join('')}</div>`;
  if (!card) return list;
  const check = card.check ? `DC ${card.check.dc} ${card.check.skill}` : '';
  return `${list}<div class="feature-card"><div class="world-object-heading"><strong>${escape(card.name)}</strong><small>${escape(card.kind)}${check ? ' · ' + escape(check) : ''}${card.requiresItem ? ' · needs ' + escape(card.requiresItem) : ''}</small></div>
    <p>${escape(card.text)}</p>
    <div class="item-action-choices">${mode === 'investigate' && card.canInvestigate ? actionButton('Investigate', 'feature-investigate', { primary: true }) : ''}${mode === 'use-feature' && card.canUse ? actionButton('Use', 'feature-use', { primary: true }) : ''}</div></div>`;
}
function selectUnderfootObject(actor) {
  if (!actor || !occupies(actor)) return null;
  const body = battle.actors.find((entry) =>
    (entry.dead || entry.hp === 0) && !entry.carriedBy && !entry.draggedBy && entry.x != null &&
    entry.id !== actor.id && containsCell(entry, actor.x, actor.y));
  if (body) return { type: 'body', id: body.id };
  const treasure = visibleMarkers().find((marker) =>
    marker.type === 'treasure' && !marker.looted && marker.x === actor.x && marker.y === actor.y);
  return treasure ? { type: 'treasure', id: treasure.id } : null;
}

function worldInteractionPanel(actor) {
  const source = worldObject();
  const carrying = actor.carrying && battle.actors.find(body => body.id === actor.carrying);
  const dragging = actor.dragging && battle.actors.find(body => body.id === actor.dragging);
  const attached = (body) => (!body.carriedBy || body.carriedBy === actor.id) && (!body.draggedBy || body.draggedBy === actor.id);
  const bodies = battle.actors.filter(body => (body.dead || body.hp === 0) && body.x != null && attached(body) && distanceFt(actor, body) <= 15 && (!fogActive() || displayVision().has(keyAt(body.x, body.y))));
  const treasures = visibleMarkers().filter(marker => marker.type === 'treasure' && !marker.looted && distanceFt(actor, marker) <= 15);
  if (bodyPlacement) return `<p>Choose an open square on the map to ${bodyPlacement === 'throw' ? 'throw the body (20 ft, action, 1d4 impact damage)' : 'place the body (5 ft, free)'}. Throwing an unconscious creature can kill them.</p>`;
  const attachedButtons = (carrying ? `<button type="button" class="game-button" data-play="world-select" data-type="body" data-id="${escape(carrying.id)}">Carrying ${escape(carrying.name)}</button>` : '') +
    (dragging ? `<button type="button" class="game-button" data-play="world-select" data-type="body" data-id="${escape(dragging.id)}">Dragging ${escape(dragging.name)}</button>` : '');
  if (!source) return `<p>Select a body or treasure on the map. You can walk onto a corpse and still loot or drag it.</p><div class="world-objects">${[...bodies, ...treasures].map(object => `<button type="button" class="game-button" data-play="world-select" data-type="${object.side ? 'body' : 'treasure'}" data-id="${escape(object.id)}">${escape(object.name)}${object.dead ? ' · Dead' : object.hp === 0 ? ' · Unconscious' : ''}${actor && occupies(actor) && object.x != null && containsCell(object, actor.x, actor.y) ? ' · Underfoot' : ''}</button>`).join('') || '<p>No bodies or treasure nearby.</p>'}${attachedButtons}</div>`;
  const contents = lootContents(source), lootable = contents.items.length || Object.keys(contents.currency).length;
  const free = !source.carriedBy && !source.draggedBy;
  return `<div class="world-object-heading"><strong>${escape(source.name)}</strong><small>${source.side ? (source.dead ? 'Dead' : 'Unconscious') + ' · ' + bodyWeight(source) + ' lb' : 'Treasure'}</small></div>
 ${lootable ? `<ul class="world-loot">${contents.items.map(item => `<li>${escape(item.name)} × ${item.quantity}</li>`).join('')}${Object.entries(contents.currency).map(([unit, n]) => `<li>${n} ${escape(unit)}</li>`).join('')}</ul>` : '<p>No detailed loot remains.</p>'}
 <div class="item-action-choices">${lootable && (!source.side || source.dead) && !actor.dragging ? actionButton('Take all', 'world-loot') : ''}${source.side && free ? actionButton('Pick up body', 'world-carry') + actionButton('Drag body', 'world-drag') : ''}${source.side && !source.dead && source.hp === 0 && source.side === actor.side && !actor.dragging ? actionButton('Help Up · 1 HP', 'world-help') : ''}${carrying?.id === source.id ? actionButton('Place body', 'world-place') + actionButton('Throw body', 'world-throw') : ''}${dragging?.id === source.id ? actionButton('Drop body', 'world-drop') : ''}</div>`;
}

async function loadRoomMaps(connection){try{const available=moduleMapsOrBuiltin(map.module)??await moduleMaps(map.module);if(table!==connection)return;const fresh=available.find(m=>m.key===map.key);if(fresh?.playerAsset&&!map.playerAsset){map.playerAsset=fresh.playerAsset;if(!customArtwork&&!battle.showDmArtwork)loadArtwork(map);}maps=roomMapChoices(connection.state,available);if(toolsOpen)redraw();}catch{if(table===connection)maps=roomMapChoices(connection.state);}}
async function changeRoomMap(entry){const connection=table;if(!connection?.state||connection.writing)return;connection.writing=true;status='Changing map…';redraw();try{const previous=tableState(),next=travelRoom(previous,entry),destination=next.currentMap,active=roomBattle(next,destination);if(!active.sceneReady&&destination.module!=='training')await populateScene(destination,active);await applyBakedWalls(destination,active);if(destination.module==='YPHub')seedYpHubScene(destination,active);for(const actor of active.actors.filter(actor=>actor.side==='party'))discoverStory(active,destination,actor);rememberVision(active,destination);for(const actor of active.actors.filter(actor=>actor.side==='party')){const enemy=enemyInSight(active,destination,actor);if(enemy){engageEnemy(active,destination,actor,enemy,true);break;}}const state=commitRoomState(next,destination,active,next.alignment),result=await writeSession(connection.id,connection.revision,state);if(table!==connection)return;if(result.state){applyTableState(connection,result);status='Another player acted first. Review the room before changing maps.';}else{applyTableState(connection,{state,revision:result.revision});rooms=rememberRoom(connection.id,map,state);status='Party arrived at '+map.title+'.';}}catch(error){status=error.message;}finally{connection.writing=false;if(table===connection)redraw();}}

export function syncAccountCharacters(characters){if(context)context.characters=characters;}
