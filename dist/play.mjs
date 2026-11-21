import {drawMonsterArtwork, monsterArtwork} from "./monster-art.mjs";
import {characterTokenArtwork, localTokenBlob, uploadSessionToken} from "./character-token.mjs";
import {enrichCharacter} from "./character-rules.mjs";
import {alignArtwork, fitsCurrentGrid, gridGeometry, migrateGridState} from "./map-grid.mjs";
import {areaKey, populateScene, rosterTokens} from "./scene-populate.mjs";
import {gameScreen} from "./game-screen.mjs";
import {createCombatCues} from "./combat-cues.mjs";
import {createGameChat} from "./game-chat.mjs";
import {canRescue, discoverStory, rescueSildar, storyPanel, storyVersion} from "./adventure-story.mjs";
import {enemyTurnPending, runEnemyTurns} from "./enemy-turn.mjs";
import {enemyInSight, engageEnemy, noticesEnemy, partyVision, rememberVision} from "./exploration.mjs";
import {exploredCells, hasExplored, saveExplored} from "./fog-memory.mjs";
import {mapFloor, mapWalls} from "./map-walls.mjs";
import {escape, plural, signed, text} from "./format.mjs";
import {icon} from "./icons.mjs";
import {attachArchive, archiveName, formatEntries, hasArchive, hostedMapImage, mapImage, monsterRecord} from "./rules-library.mjs";
import {cellCenter, creatureActor, moduleMaps, partyActor, regionAt, regionCells, roomNotes, roomRoster, trainingActors, trainingMap} from "./encounters.mjs";
import {defeatedCreature, drawGrid, gridPosition, terrainAt} from "./grid-view.mjs";
import {createCamera, mapControls, mapHint, mapViewport} from "./map-camera.mjs";
import {artworkURL, createSession, inviteURL, joinPanel, readSession, recentSession, rememberedUsername, sessionCode, sessionHash,
  syncSessionPlayers, tablePanel, writeSession} from "./multiplayer.mjs";
import {
  actorIsUp, applyDamage, breathTypes, castSpell, checkSpellTethers, condition, currentActor, deathSave, diceTerms, distanceFt, drinkPotion,
  endInitiative, endTurn, incapacitated, joinInitiative, keyAt, moveLeft,
  exploreToken, heal, lineClear, log, movementGroup, moveToken, newBattle, occupies, opportunity, placeToken, previewMovement, recordSpell, resolveOpportunity, rollDice,
  rollStrike, spellCells, spellTargetCount, startInitiative, supportedSpell, sustainWitchBolt, turnAction, wakeCreature,
} from "./combat.mjs";

const saveKey = "wayfarer-encounters-v1";
let battles;
try {battles = JSON.parse(localStorage.getItem(saveKey)) || {};} catch {battles = {};}
let maps = [trainingMap];
let moduleId = "training";
let map = trainingMap;
let context;
let selectedId = "";
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
let customWeapon = {name:"Custom strike", bonus:"", damage:"", type:"", normalRange:"", reach:""};
let selectedCreature = 0;
let selectedParty = "";
let camera;
let focusedGameMap;
let artworkRequest;
let artworkNote = "";
let customArtwork;
let table;
let tableOpen = false;
let tableMessage = "";
let needsHostSignIn = false;
let showInvitation;
let category = "move";
let logOpen = false;
let toolsOpen = false;
let storyOpen = false;
let scheduledEnemyBattle;
const combatCues = createCombatCues();
const controllerKey = "wayfarer-player-v1";
let controller = globalThis.crypto.randomUUID();
try {
  controller = localStorage.getItem(controllerKey) || controller;
  localStorage.setItem(controllerKey,controller);
} catch {}
let pathPreview;
let previewMessage = "";
let spellSquare;
let castSlot = "";
let breathType = "fire";
const extraTargets = new Map();
let pendingSquare;
const sceneJobs = new WeakMap();
let repaintScheduled = false;
let detectedGrid;
let gridDraft;
const gridFields = ["width","height","x","y"];
const gridModes = {artwork:"Artwork only",printed:"Artwork guides",tactical:"5-foot cells"};
const activeMapKey = "wayfarer-active-map-v1";
let preferredGame;
try {preferredGame = JSON.parse(localStorage.getItem(activeMapKey));} catch {}


function root() {return document.querySelector("#play-mount");}
function saveBattle(entry = map, state = battle) {
  if (table) return;
  battles[entry.key] = state;
  try {localStorage.setItem(saveKey, JSON.stringify(battles));} catch {
    status = "Browser storage is unavailable. This encounter will last until the page closes.";
  }
}

async function decodeMapImage(blob, entry) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (entry && Math.abs(image.naturalWidth / image.naturalHeight / (entry.width / entry.height) - 1) > .03) {
      throw new Error("This image does not match the map’s aspect ratio. Choose the image for this map variant.");
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function visibleTokens(sight = context?.game ? partyVision(battle,map) : null, {includeDefeated = false} = {}) {
  if (!sight) return null;
  return new Set(battle.actors.filter((actor) => actor.side === "party" ||
    (!condition(actor,"Invisible") && occupies(actor) || includeDefeated && defeatedCreature(actor)) &&
      sight.has(keyAt(actor.x,actor.y))).map(({id}) => id));
}

function visibleMarkers(sight = context?.game ? partyVision(battle,map) : null) {
  const entries = battle.markers ?? [];
  return sight ? entries.filter((marker) => (!marker.hidden || marker.revealed) && sight.has(keyAt(marker.x,marker.y))) : entries;
}

function repaintCreatureArt() {
  if (repaintScheduled) return;
  repaintScheduled = true;
  requestAnimationFrame(() => {
    repaintScheduled=false;
    paintBoard();
  });
}

document.addEventListener("wayfarer:character-token",repaintCreatureArt);

function partyTokenImage(actor) {
  if (actor.side !== "party") return;
  if (table) return actor.tokenImage;
  const character = importedCharacter(actor);
  return character ? character.tokenImage : actor.tokenImage;
}

function importedCharacter(actor) {
  return actor ? context.characters.find(({id}) => actor.id === "party:"+id) : null;
}

function collectArtwork(visible) {
  const result = new Map();
  for (const actor of battle.actors) {
    if (visible && !visible.has(actor.id)) continue;
    const art = characterTokenArtwork(partyTokenImage(actor),table?.id,repaintCreatureArt) ?? monsterArtwork(actor,map,repaintCreatureArt);
    if (art) result.set(actor.id,art);
  }
  return result;
}

function paintTokenPreviews(images) {
  for (const canvas of root().querySelectorAll("canvas[data-creature-portrait]")) {
    const portrait=images.get(canvas.dataset.creaturePortrait);
    const initials=canvas.parentElement.querySelector("[data-token-initial]");
    canvas.hidden = !portrait;
    if (initials) initials.hidden=Boolean(portrait);
    if (!portrait || canvas.dataset.artPath===portrait.path) continue;
    canvas.width=96; canvas.height=96;
    const ctx=canvas.getContext("2d");
    drawMonsterArtwork(ctx,portrait,48,48,96);
    canvas.dataset.artPath=portrait.path;
    canvas.dataset.artKind=portrait.type;
  }
}

function ensureScene(entry = map, state = battle) {
  if (entry.module === "training" || state.sceneReady) return Promise.resolve();
  if (sceneJobs.has(state)) return sceneJobs.get(state);
  const loading = populateScene(entry,state).then(() => {
    if (battles[entry.key] === state) saveBattle(entry,state);
  }).catch(() => {
    if (map === entry && battle === state) status = "Some starting tokens could not be read. Reopen the map to retry.";
  }).finally(() => {
    sceneJobs.delete(state);
    if (map === entry && battle === state) redraw();
  });
  sceneJobs.set(state,loading);
  return loading;
}

function paintBoard() {
  const element = root();
  if (!element || !camera) return;
  const actor = selectedActor();
  const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.usable && choice.mode === "spell" ? supportedSpell(choice.data.key) : null;
  const firstRank = choice?.data?.level && Object.keys(actor.slots).find((rank) =>
    Number(rank) >= choice.data.level && actor.slots[rank].current > 0);
  const footprint = spellSquare ? effect && (effect.area || effect.cone) && actor ?
    spellCells(battle,actor,spellSquare,effect,map,Number(castSlot || firstRank || effect.level)) :
    new Set([keyAt(spellSquare.x,spellSquare.y)]) : null;
  const sight = context.game ? partyVision(battle,map) : null;
  const visible = visibleTokens(sight,{includeDefeated:true});
  const selectedTarget = context.game && category === "weapon" && canControl(actor)
    ? combatSelection(actor,visible).target?.id : targetId;
  const tokenImages = collectArtwork(visible);
  paintTokenPreviews(tokenImages);
  const alignmentOpen = element.querySelector("#grid-settings")?.open;
  const drawingMap = alignmentOpen && gridDraft ? {...map,...gridGeometry(map,gridDraft)} : map;
  const options = {
    room:context.game && tool !== "room" ? null : room,selected:actor?.id,target:selectedTarget,cursor,art,
    path:pathPreview,visible,fog:sight ? {visible:sight,memory:exploredCells(battle,map)} : null,
    footprint,showRegions:!context.game || !art || tool==="room",
    markers:visibleMarkers(sight),tokenImages,overlay:alignmentOpen && gridDraft ? "printed" : battle.gridOverlay ?? "artwork",
  };
  camera.paint((canvas,view) => drawGrid(canvas,view,drawingMap,battle,options));
}

function setAlignment(alignment) {
  if (!map.sourceGrid) return false;
  const geometry = gridGeometry(map,alignment);
  if (!fitsCurrentGrid(geometry,battle)) return false;
  Object.assign(map,geometry);
  return true;
}

function alignmentDescription() {
  return battle.gridManual ? "Saved alignment" : detectedGrid ? "Fitted to artwork" : "Adventure alignment";
}

function updateAlignmentFields() {
  const description = root()?.querySelector("#grid-align-source");
  if (description) description.textContent = alignmentDescription();
  for (const field of gridFields) {
    const element = root()?.querySelector("#grid-align-"+field);
    if (element) element.value = formatPixels(map.printedGrid[field]);
  }
}

function alignImage(image) {
  if (!map.sourceGrid) return;
  detectedGrid = null;
  try {detectedGrid = alignArtwork(image,map);} catch {}
  if (!battle.gridManual && !gridDraft) {
    if (!setAlignment(detectedGrid ?? map.sourceGrid)) detectedGrid = null;
    updateAlignmentFields();
  }
}

function updateArtwork() {
  const note = root()?.querySelector("#map-art-note");
  const picker = root()?.querySelector('[data-play="art"]');
  if (note) note.textContent = artworkNote;
  const gameNote = root()?.querySelector("#game-map-status");
  if (gameNote && !status && !room?.entry?.name) gameNote.textContent = artworkNote;
  if (picker) picker.textContent = art ? "Change map image" : "Choose map image";
  paintBoard();
}

async function loadArtwork(entry, file, sharedURL) {
  artworkRequest?.abort();
  const request = new AbortController();
  artworkRequest = request;
  const current = () => artworkRequest === request && map === entry;
  if (!entry.asset && !file && !sharedURL) {
    artworkNote = "Showing the schematic. Choose a map image to add artwork.";
    return;
  }
  artworkNote = "Loading map artwork…";
  updateArtwork();
  const timeout = setTimeout(() => request.abort(), 12000);
  try {
    let image;
    if (sharedURL) {
      const response = await fetch(sharedURL,{signal:request.signal});
      if (response.ok) image = await decodeMapImage(await response.blob(),entry);
    } else if (file) {
      image = await decodeMapImage(file, entry);
    } else {
      const embedded = await mapImage(entry.asset).catch(() => null);
      if (!current()) return;
      if (embedded) image = await decodeMapImage(embedded, entry).catch(() => null);
      if (!image && current()) {
        const hosted = await hostedMapImage(entry.asset, request.signal);
        if (hosted) image = await decodeMapImage(hosted, entry);
      }
    }
    if (!current()) return;
    if (image) {
      art = image;
      customArtwork = file;
      if (!table) alignImage(image);
      artworkNote = sharedURL ? "Shared map artwork." : file ? "Using your map image." : entry.artist ? "Map artwork by " + entry.artist + "." : "Map artwork loaded from 5etools.";
    } else {
      artworkNote = "Map artwork is unavailable. Showing the schematic.";
    }
  } catch (error) {
    if (!current()) return;
    artworkNote = file
      ? (error instanceof Error && error.message.includes("aspect ratio") ? error.message : "The map image could not be read.")
      : "Map artwork is unavailable. Showing the schematic.";
  } finally {
    clearTimeout(timeout);
    if (current()) updateArtwork();
  }
}

function useMap(entry) {
  artworkRequest?.abort();
  artworkRequest = null;
  camera?.destroy();
  camera = null;
  artworkNote = "";
  customArtwork = null;
  detectedGrid = null; gridDraft = null;
  map = entry;
  storyOpen = false;
  const saved = battles[map.key];
  battle = saved ?? newBattle();
  const migrated = map.sourceGrid && saved && !saved.alignedGrid;
  if (map.sourceGrid) {
    Object.assign(map,gridGeometry(map));
    migrateGridState(map,battle);
    if (battle.gridManual) setAlignment(battle.gridManual);
  }
  if (map.module === "training" && !battles[map.key]) battle.actors = trainingActors();
  const repaired = repairWallPlacement(map,battle);
  art = null; selectedId = ""; targetId = ""; combatChoice = ""; cursor = null;
  const initialRoom = map.module === "LMoP" && map.id === "1ab" ? "01b" : map.regions[0]?.id;
  room = map.regions.find(({id}) => id === initialRoom) ?? null;
  selectedCreature = 0; tool = context?.game ? "move" : "room"; status = "";
  pathPreview = null; previewMessage = ""; spellSquare = null; pendingSquare = null;
  battles[map.key] = battle;
  if (migrated || repaired) saveBattle();
  if (map.module !== "training") {
    loadArtwork(entry);
    ensureScene(entry,battle);
  }
}

function repairWallPlacement(entry,state) {
  const walls = mapWalls(entry);
  if (!walls || state.round) return false;
  const taken = new Set(state.actors.filter(occupies).map(({x,y}) => keyAt(x,y)));
  const floor = walls.rows.flatMap((spans,y) => spans.flatMap(([first,last]) =>
    Array.from({length:last-first+1},(_,i) => ({x:first+i,y}))));
  const allowed = (cell) => mapFloor(entry,cell.x,cell.y) && !taken.has(keyAt(cell.x,cell.y)) && state.terrain[keyAt(cell.x,cell.y)] !== "wall";
  let changed = false;
  for (const actor of state.actors.filter(occupies)) {
    if (mapFloor(entry,actor.x,actor.y)) continue;
    const origin = entry.regions.find((region) => areaKey(region) === actor.origin);
    const roomCells = origin ? regionCells(entry,origin).filter(allowed) : [];
    const cells = roomCells.length ? roomCells : floor.filter(allowed);
    const distance = (cell) => Math.hypot(cell.x-actor.x,cell.y-actor.y);
    const [next] = cells.sort((a,b) => distance(a)-distance(b));
    if (!next) continue;
    taken.delete(keyAt(actor.x,actor.y));
    placeToken(state,actor,next.x,next.y,entry);
    taken.add(keyAt(next.x,next.y));
    changed = true;
  }
  return changed;
}

function selectedActor() {
  const active = currentActor(battle);
  if (context?.game && category === "move" && active?.side === "party") {
    const movers = movementGroup(battle).filter(canControl);
    return movers.find(({id}) => id === selectedId) ?? movers[0] ?? active;
  }
  return active ?? battle.actors.find(({id}) => id === selectedId);
}
function canControl(actor) {
  if (actor?.side !== "party") return false;
  const owner = table && battle.controllers?.[actor.id];
  return !owner || owner === controller;
}
function requireControl(actor) {
  if (actor?.side === "hostile") throw new Error("The game controls " + actor.name + ".");
  if (!canControl(actor)) throw new Error("Wait for " + (actor?.name ?? "the active character") + " to act.");
}
function revealStory(previous) {
  if (storyVersion(battle) <= previous || battle.round) return;
  storyOpen = true;
  tableOpen = logOpen = toolsOpen = false;
  tool = "move";
  gridDraft = null;
}
function mapPoint(square) {
  const [x,y] = cellCenter(map,square);
  return {x:x/map.width,y:y/map.height};
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
  return `<label class="play-field"><span id="${name}-label">${label}</span><span class="select-field"><select id="${name}" aria-labelledby="${name}-label" ${extra}>${options.join("")}</select>${icon("down",15)}</span></label>`;
}
function input(label, id, value, type = "text", extra = "") {
  return `<label class="play-field"><span>${label}</span><input id="${id}" type="${type}" value="${escape(value)}" ${extra}></label>`;
}
function choices(actor) {
  if (!actor) return [];
  const weapons = actor.attacks.flatMap((weapon) => weapon.thrown ? [weapon, {...weapon, ...weapon.thrown, name:weapon.name+" (thrown)"}] : [weapon]);
  const exhale = battle.round && condition(actor,"Dragon’s Breath") ?
    [{mode:"spell",name:"Exhale Dragon’s Breath",usable:true,data:{key:"exhale dragons breath",edition:"2014",name:"Dragon’s Breath",level:0}}] : [];
  return [
    ...weapons.map((weapon) => ({
      mode:"weapon", name:weapon.name, data:weapon, usable:Number.isFinite(weapon.bonus) && Boolean(diceTerms(weapon.damage)),
    })),
    ...actor.spells.map((spell) => ({
      mode:"spell", name:spell.name, data:spell,
      usable:spell.prepared !== false && !spell.customUse && spell.edition === "2014" && Boolean(supportedSpell(spell.key)),
      manual:spell.prepared !== false && !spell.customUse && Boolean(spell.reference) &&
        spell.edition === "2014" && ["action","bonus","reaction"].includes(spell.timing),
    })),
    ...exhale,
    ...(actor.potions ?? []).map((potion) => ({mode:"potion",name:potion.name + " (" + potion.quantity + ")",data:potion,usable:potion.quantity > 0})),
    {mode:"custom",name:"Custom strike",usable:true},
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
    const enemies = targets.filter((entry) => entry.side === "hostile" && actorIsUp(entry))
      .sort((a,b) => distanceFt(actor,a)-distanceFt(actor,b));
    const weapon = choice.data;
    const range = weapon?.normalRange ? weapon.longRange || weapon.normalRange : weapon?.reach || 5;
    target = enemies.find((enemy) => distanceFt(actor,enemy) <= range && lineClear(battle,actor,enemy,map)) ?? enemies[0];
  }
  return {list,index,choice,targets,target};
}

function playOptions(actor) {
  if (!actor || (!battle.round && !context.game)) return "";
  const reaction = opportunity(battle);
  if (reaction?.foe.side === "hostile") return "<p>The game is resolving " + escape(reaction.foe.name) + "’s reaction.</p>";
  if (reaction && !canControl(reaction.foe)) return "<p>Waiting for " + escape(reaction.foe.name) + "’s reaction.</p>";
  if (reaction) return `<form id="reaction-form" class="play-form">
    <p>${escape(reaction.foe.name)} can use their reaction to attack ${escape(reaction.actor.name)} as it leaves reach.</p>
    ${field("Opportunity attack","reaction-attack",reaction.attacks.map((attack,index) => option(index,attack.name)))}
    <div class="play-action-row"><button class="button primary small" type="submit">Roll reaction</button>${actionButton("Pass","pass-reaction")}</div>
  </form>`;
  if (actor.side === "hostile") return "<p>The game is running " + escape(actor.name) + "’s turn.</p>";
  if (!canControl(actor)) return "<p>Waiting for " + escape(actor.name) + ".</p>";
  if (battle.round && actor !== currentActor(battle)) return '<div class="play-action-row">' +
    (pendingSquare ? actionButton("Move here","commit-move",{primary:true}) : "") +
    "<p>You can move now. Your actions begin after " + escape(currentActor(battle).name) + "’s turn.</p></div>";
  if (actor.hp === 0) return battle.round && actor.resolveDeath
    ? `<p>${actor.stable ? "Stable at 0 HP" : "Unconscious · " + actor.successes + " successes, " + actor.failures + " failures"}</p>
      ${actor.stable || battle.deathRolled ? "" : actionButton("Roll death save","death",{primary:true})}` : "";
  if (incapacitated(actor)) return "<p>" + (condition(actor,"Asleep") ? "Asleep" : "Paralyzed") + "</p>";
  const {list,index,choice,targets,target} = combatSelection(actor,visibleTokens());
  const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.key) : null;
  const pickArea = effect?.area || effect?.cone || effect?.teleport;
  const pickTarget = choice && choice.mode !== "potion" && !effect?.self && !pickArea;
  const asleep = battle.round && battle.actors.find((target) => occupies(target) && target.side === actor.side &&
    condition(target,"Asleep") && distanceFt(actor,target) <= 5);
  const moveActions = battle.round ? ["dash","dodge","disengage"].map((act) =>
    actionButton(act.charAt(0).toUpperCase()+act.slice(1),act,{disabled:Boolean(battle.action)})).join("") +
    (actor.nimbleEscape ? actionButton("Disengage (bonus)","bonus-disengage",{disabled:battle.bonusUsed}) : "") +
    (actor.prone ? actionButton("Stand up","stand") : "") +
    (asleep && !battle.action ? actionButton("Wake "+asleep.name,"wake",{id:asleep.id}) : "") : "";
  if (context.game && category === "move") return '<div class="play-action-row">' +
    (pendingSquare ? actionButton("Move here","commit-move",{primary:true}) : "") + moveActions + '</div>';
  const legalChoices = list.map((entry,index) => ({entry,index})).filter(({entry}) => !context.game ||
    entry.mode === category || (category === "weapon" && entry.mode === "custom"));
  if (!legalChoices.length) return `<p>${category === "spell" ? "This character has no listed spells." : "This character has no usable items."}</p>`;
  const slotOptions = choice?.mode === "spell" && choice.data.level
    ? Object.entries(actor.slots).filter(([level, pool]) => Number(level) >= choice.data.level && pool.current > 0)
    : [];
  const rank = Number(castSlot || slotOptions[0]?.[0] || 0);
  const auxiliary = effect ? spellTargetCount(effect,actor.level,rank)-1 : 0;
  const spellTargets = effect?.humanoid ? targets.filter((entry) => !entry.creatureType || entry.creatureType === "humanoid") :
    effect?.breath ? targets.filter((entry) => entry.side === actor.side) : targets;
  const missingWeaponTarget = context.game && category === "weapon" && pickTarget && !target;
  return `<form class="play-form" id="combat-form">
    ${field(context.game ? {weapon:"Weapon",spell:"Spell",potion:"Item"}[category] : "Action","combat-choice",[
      option("","Choose " + (context.game ? {weapon:"a weapon",spell:"a spell",potion:"an item"}[category] : "an action"),index === ""),
      ...legalChoices.map(({entry,index:position}) => option(String(position),entry.name + (entry.data?.prepared === false ? " · unprepared" : entry.usable ? "" : " · manual"), index === String(position)))])}
    ${pickArea ? `<p class="game-spell-note">${spellSquare ? "Selected square " + (spellSquare.x+1) + ", " + (spellSquare.y+1) :
      effect.teleport ? "Choose an unoccupied destination on the map." : effect.cone ? "Choose the direction of the cone on the map." :
        "Choose a point on the map."}</p>` : ""}
    ${pickTarget ? field("Target","target-select",[option("","Choose target",!target),
      ...spellTargets.map((entry) => option(entry.id,entry.name,entry.id === target?.id))]) : ""}
    ${auxiliary ? `<div class="play-field-row">${Array.from({length:auxiliary},(_,index) =>
      field((effect.beams ? "Beam " : effect.missiles ? "Dart " : "Target ") + (index+2),"extra-target-"+index,
        [option("",effect.beams || effect.missiles ? "Same as first target" : "Optional",!extraTargets.get(index)),
          ...spellTargets.map((entry) => option(entry.id,entry.name,entry.id === extraTargets.get(index)))])).join("")}</div>` : ""}
    ${choice?.mode === "spell" && choice.data.level ? field("Spell slot","cast-slot",slotOptions.length ?
      slotOptions.map(([level,pool]) => option(level, "Level " + level + " · " + pool.current + " left",level === castSlot)) : [option("","No available slot")]) : ""}
    ${effect?.breath ? field("Damage type","breath-type",breathTypes.map((type) =>
      option(type,type.charAt(0).toUpperCase()+type.slice(1),type === breathType))) : ""}
    ${choice?.mode === "custom" ? `<div class="play-field-row">
      ${input("Attack bonus","custom-bonus",customWeapon.bonus,"number",'required step="1"')}
      ${input("Damage dice","custom-damage",customWeapon.damage,"text",'required placeholder="1d8+3"')}
      ${input("Reach (ft)","custom-reach",customWeapon.reach,"number",'min="5" placeholder="5"')}
      ${input("Ranged limit (ft)","custom-range",customWeapon.normalRange,"number",'min="5" placeholder="Melee"')}
    </div>` : ""}
    ${choice && choice.mode !== "potion" && !effect?.self && !effect?.teleport && !effect?.aid && !effect?.breath && !effect?.exhale ? `<div class="play-field-row">
      ${field("Roll","roll-mode",[option("","Normal",!rollMode),option("advantage","Advantage",rollMode === "advantage"),option("disadvantage","Disadvantage",rollMode === "disadvantage")])}
      ${field("Cover","cover",[option("","None",!cover),option("2","Half (+2)",cover === "2"),option("5","Three-quarters (+5)",cover === "5"),option("full","Total",cover === "full")])}
    </div>` : ""}
    ${effect?.temporary && actor.tempHp ? '<label class="game-spell-note"><input id="keep-temp" type="checkbox"> Keep current temporary HP</label>' : ""}
    ${choice?.mode === "spell" && choice.data.note ? `<p class="game-spell-note">${escape(choice.data.note)}</p>` : ""}
    ${choice?.mode === "spell" && choice.data.reference ? `<button type="button" class="spell-link" data-action="spell" data-id="${escape(choice.data.reference)}">Spell rules</button>` : ""}
    ${choice && !choice.usable ? `<p class="play-hint">${choice.data?.prepared === false ? "This spell is unprepared." :
      choice.data?.customUse ? "This spell uses a custom rule or item charge from the sheet." : "This spell’s effect needs a table ruling."}</p>` : ""}
    <div class="play-action-row">${choice?.usable || choice?.manual ? `<button class="button primary small" type="submit"
      ${missingWeaponTarget || choice.mode === "spell" && choice.data.level && !slotOptions.length ? "disabled" : ""}>${effect?.exhale ? "Exhale" :
        choice.mode === "spell" ? (choice.usable ? "Cast spell" : "Record manual cast") : choice.mode === "potion" ? "Use item" : "Roll attack"}</button>` : ""}
      ${!context.game ? moveActions : ""}
      ${actor.concentration?.bolt && battle.round && !battle.action ? actionButton("Sustain Witch Bolt","witch-bolt") : ""}
    </div>
  </form>`;
}

function setupControls() {
  if (battle.round || sceneJobs.has(battle)) return "";
  const eligible = context.characters.filter((character) => !battle.actors.some((actor) => actor.id === "party:" + character.id));
  return `<div class="play-stack">
    ${eligible.length ? `<div class="play-inline">
      ${field("Party member","play-party",[option("","Choose character",!selectedParty),
        ...eligible.map((character) => option(character.id,character.name,character.id === selectedParty))])}
      ${actionButton("Add token","add-party",{disabled:!selectedParty})}
    </div>` : battle.actors.some((actor) => actor.side === "party") ? "" : '<p><a class="text-link" href="#characters">Import a party member</a> to place your character on the map.</p>'}
    ${hasArchive() ? `<form id="creature-form" class="play-inline">
      ${input("Monster name","creature-name","","search",'required placeholder="Goblin"')}
      ${input("Source","creature-source","MM","text",'required maxlength="24"')}
      ${field("Side","creature-side",[option("hostile","Hostile"),option("neutral","Neutral"),option("party","Friendly")])}
      <button class="button outline small" type="submit">Add monster</button>
    </form>` : ""}
  </div>`;
}

function sceneMarkers(region) {
  const markers = (battle.markers ?? []).filter((marker) => marker.origin === areaKey(region));
  if (!markers.length) return "";
  return '<ul class="scene-markers">' + markers.map((marker) => `<li>
    ${actionButton(marker.name,"inspect-marker",{id:marker.id})}
    ${marker.hidden && !marker.revealed ? actionButton("Reveal","reveal-marker",{id:marker.id}) : ""}
  </li>`).join("") + "</ul>";
}

function roomPanel() {
  const roster = room ? roomRoster(map,room) : [];
  const authored = map.module === "LMoP" && map.id === "1ab";
  const starting = battle.actors.filter((actor) => actor.origin === areaKey(room) && actor.side !== "party");
  const unavailable = battle.unplacedScene?.[areaKey(room)] ?? 0;
  return `<section class="play-panel">
    <h2>Room</h2>
    ${map.regions.length ? field("Map area","play-room",[option("","Choose a room",!room),
      ...map.regions.map((region) => {
        const id = areaKey(region);
        const instance = id === region.id ? "" : " (" + id.split(":").at(-1) + ")";
        return option(id,(region.entry?.name ?? region.id)+instance,id === areaKey(room));
      })]) : '<p>The archive has no tagged rooms for this map.</p>'}
    ${room ? `<div class="room-body">
       ${roomNotes[room.id] && authored ? `<p class="play-hint">${roomNotes[room.id]}</p>` : ""}
       ${starting.length ? `<p>${plural(starting.length,"room token")}${starting.some(({dead})=>dead) ?
         " · " + starting.filter(({dead})=>dead).length + " defeated" : ""}</p>` : ""}
       ${unavailable ? `<p>${plural(unavailable,"creature")} need more space for placement.</p>` : ""}
       ${authored && room.id === "021" && !battle.round && starting.some((actor)=>actor.side==="neutral" && !actor.dead)
         ? actionButton("Set wolves hostile","release-wolves") : ""}
       ${!battle.round && !sceneJobs.has(battle) && roster.length ? `<div class="play-inline">
         ${field("Creature reference","room-creature",roster.map((entry,index) => option(index,entry.nickname ?? entry.name,index === selectedCreature)))}
         ${actionButton("Add token","add-room-monster")}
       </div>` : ""}
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
      ${field("Token","manual-target",actors.map((actor) => option(actor.id,actor.name,actor.id === targetId)))}
      <div class="play-field-row">
        ${field("Effect","manual-effect",[option("damage","Damage"),option("heal","Healing")])}
        ${input("Amount","manual-amount","","number",'min="0" max="999" required')}
      </div>
      ${field("Damage type","manual-type",["untyped","acid","bludgeoning","cold","fire","force","lightning","necrotic","piercing","poison","psychic","radiant","slashing","thunder"]
        .map((type) => option(type,type.charAt(0).toUpperCase()+type.slice(1))))}
      <button type="submit" class="button outline small">Apply effect</button>
    </form>
  </details>`;
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
        ${input("Attacks per Attack action","actor-swings",actor.swings,"number",'min="1" max="8" required')}
        ${input("Current HP","actor-hp",actor.hp,"number",'min="0" max="'+actor.maxHp+'" required')}
        ${!actor.id.startsWith("party:") && actor.side !== "party" ? field("Disposition","actor-side",
          [option("hostile","Hostile",actor.side==="hostile"),option("neutral","Neutral",actor.side==="neutral")]) : ""}
      </div>
      ${actor.spells.length ? `<div class="play-field-row">
        ${input("Spell save DC","actor-spell-dc",actor.spellDC,"number",'min="1" max="40"')}
        ${input("Spell attack bonus","actor-spell-attack",actor.spellAttack,"number",'min="-10" max="30"')}
        ${input("Spellcasting modifier","actor-spell-ability",actor.spellAbility,"number",'min="-10" max="15"')}
      </div>` : ""}
      ${Object.keys(actor.slots).length ? `<details><summary>Spell slots</summary><div class="play-field-row slot-fields">${Object.entries(actor.slots).map(([level,pool]) =>
        input("Level " + level + (pool.maximum != null ? " / " + pool.maximum : ""), "slot-"+level, pool.current ?? "", "number",
          'min="0" max="' + (pool.maximum ?? 20) + '"')).join("")}</div></details>` : ""}
      <div class="play-action-row"><button type="submit" class="button outline small">Save token</button>
        ${importedCharacter(actor) ? actionButton("Update token from sheet","refresh-party-token") : ""}${actionButton("Remove token","remove-token")}</div>
    </form>` : ""}
    ${battle.round && actor ? `<div class="turn-info">
      <h3>${escape(actor.name)}’s turn</h3>
      ${canControl(actor) ? `<p>${moveLeft(battle,actor)} ft left · ${battle.action ? (battle.action === "attack" && battle.attacksMade < actor.swings ? (actor.swings-battle.attacksMade)+" attacks left" : "Action used") : "Action ready"} · ${battle.bonusUsed ? "Bonus action used" : "Bonus action ready"}</p>` : ""}
      ${playOptions(actor)}
    </div>` : ""}
    <div class="play-action-row">
      ${battle.round ? canControl(actor) ? actionButton("End turn","end",{primary:true,disabled:Boolean(battle.movement)}) : ""
        : actionButton("Roll initiative","start",{primary:true,disabled:!canStart})}
      ${battle.round ? actionButton("End initiative","end-initiative",{disabled:Boolean(battle.movement)}) : ""}
      ${battle.round || battle.actors.length ? actionButton("Reset encounter","reset") : ""}
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
        ${actionButton(hasArchive() ? "Change ZIP" : "Choose 5etools ZIP","archive-picker",{primary:!hasArchive(),disabled:pending})}
        ${context.localArchive ? actionButton("Use supplied archive","archive-local",{disabled:pending}) : ""}
      </div>
      <input type="file" id="play-archive-file" accept=".zip,application/zip" hidden>
    </div>
  </details>`;
}

function formatPixels(value) {
  return String(Math.round(value*100)/100);
}

function gridSettings() {
  if (!map.sourceGrid) return "";
  const alignment = gridDraft ?? map.printedGrid;
  const fields = [
    ["Square width","width",'min="1"'],["Square height","height",'min="1"'],
    ["Horizontal offset","x",""],["Vertical offset","y",""],
  ];
  return `<details id="grid-settings" class="grid-settings">
    <summary>Grid alignment</summary>
    <div class="grid-settings-body">
      ${field("Grid display","grid-overlay",Object.entries(gridModes).map(([mode,label]) =>
        option(mode,label,(battle.gridOverlay ?? "artwork")===mode)))}
      <p class="play-hint"><strong id="grid-align-source">${alignmentDescription()}</strong> · Adjust the guides in image pixels. Movement uses 5-foot cells.</p>
      <form id="grid-align-form" class="play-form">
        <div class="play-field-row">${fields.map(([label,key,limit]) =>
          input(label+" (px)","grid-align-"+key,formatPixels(alignment[key]),"number",limit+' step="any" required')).join("")}</div>
        <p id="grid-align-feedback" role="status" class="play-hint"></p>
        <div class="play-action-row">
          <button type="submit" class="button primary small">Save alignment</button>
          ${actionButton("Reset to automatic","reset-grid")}
        </div>
      </form>
    </div>
  </details>`;
}

function readAlignment() {
  const form = root().querySelector("#grid-align-form");
  const alignment = Object.fromEntries(gridFields.map((field) => [field,form.querySelector("#grid-align-"+field).valueAsNumber]));
  return gridFields.every((field) => Number.isFinite(alignment[field])) && alignment.width>0 && alignment.height>0 ? alignment : null;
}

function playPage() {
  const isTraining = map.module === "training";
  const moduleOptions = [option("training","Wayfarer practice yard",isTraining)];
  if (hasArchive()) {
    moduleOptions.push(...context.adventures.filter((entry) => entry.maps?.some((item) => item.grid === "square"))
      .map((entry) => option(entry.id,entry.name,moduleId === entry.id)));
  }
  const tools = [["room","Inspect room"],["move",battle.round ? "Move token" : "Place token"],["difficult","Difficult terrain"],["wall","Block square"],["clear","Clear terrain"]];
  return `<header class="play-header"><div><h1>Encounter setup</h1><p>Choose an adventure, map, and party.</p></div>
      ${actionButton(pending || sceneJobs.has(battle) ? "Preparing…" : "Enter game","enter-game",{primary:true,disabled:pending || sceneJobs.has(battle)})}</header>
    ${joinPanel()}
    ${archivePanel()}
    <div class="play-layout">
      <div class="play-main">
        <section class="play-panel play-board-panel">
          <div class="play-map-select">
            ${field("Adventure","play-module",moduleOptions)}
            ${!isTraining ? field("Map","play-map",maps.map((entry) => option(entry.key,entry.title,map.key===entry.key))) : ""}
          </div>
          <div class="play-heading board-title"><h2>${escape(map.title)}</h2>
            ${!isTraining ? actionButton(art ? "Change map image" : "Choose map image","art") : ""}
          </div>
          <input type="file" id="play-art" accept="image/png,image/jpeg,image/webp" hidden>
          ${mapViewport(map)}
          <div class="board-toolbar">
            ${field("Grid tool","grid-tool",tools.map(([id,label]) => option(id,label,tool===id)))}
            ${mapControls(Boolean(cameraToken()))}
            ${mapHint()}
            <div class="board-key"><span><i></i> Party</span><span><i></i> Hostile</span><span><i></i> Difficult terrain</span><span><i class="map-marker-key"></i> Room marker</span></div>
          </div>
          ${!isTraining ? `<p id="map-art-note" class="play-hint" role="status">${escape(artworkNote)}</p>` : ""}
          ${gridSettings()}
          <p class="play-status" role="status">${escape(status)}</p>
        </section>
        <section class="play-panel">
          <div class="play-heading"><h2>Combat log</h2>
            <form id="dice-form" class="dice-form">
              <label><span class="sr-only">Dice expression</span><input id="dice-expression" value="${escape(diceFormula)}" placeholder="1d20+5" required></label>
              <button class="button outline small" type="submit">${icon("dice",16)} Roll dice</button>
            </form>
          </div>
          ${diceResult ? `<p class="dice-result">${escape(diceResult)}</p>` : ""}
          ${battle.log.length ? `<ol class="play-log">${battle.log.slice().reverse().map((entry) => "<li>" + escape(entry) + "</li>").join("")}</ol>` :
            '<p class="play-hint">Roll initiative to begin. The log records rolls, damage, and turn changes.</p>'}
        </section>
      </div>
      <div class="play-rail">${tokenPanel()}${roomPanel()}</div>
    </div>`;
}

function redraw() {
  const element = root();
  if (!element) return;
  const active = document.activeElement?.id;
  if (context.sessionRoute && !table?.state) {
    element.innerHTML = `<section class="session-entry play-panel"><h1>Join shared session</h1>
      ${table?.needsUsername ? `<form id="session-username-form" class="session-inline">
        ${input("Username","session-username",table.usernameDraft ?? rememberedUsername(),"text",'required maxlength="24" autocomplete="nickname"')}
        <button class="button primary small" type="submit" ${table.joining ? "disabled" : ""}>${table.joining ? "Joining…" : "Join session"}</button>
      </form><p role="status">${escape(tableMessage)}</p>` : `<p role="status">${escape(tableMessage || "Connecting to the table…")}</p>
      ${table?.error ? actionButton("Try again","retry-session") : ""}`}
      <a href="#play" class="button outline small">Back to setup</a></section>`;
    if (active === "session-username") element.querySelector("#session-username")?.focus({preventScroll:true});
    return;
  }
  let cameraState = camera?.state();
  if (!context.game) focusedGameMap = null;
  camera?.destroy();
  const archiveOpen = element.querySelector(".play-archive")?.open;
  const gridOpen = element.querySelector("#grid-settings")?.open;
  table?.chat?.rememberScroll();
  element.innerHTML = context.game ? gameScreen({
    map,battle,selected:selectedActor(),party:battle.actors.filter((actor) => actor.side === "party"),
    visibleInitiative:visibleTokens(),
    category,actions:playOptions(selectedActor()), tacticalTools:tableTools(), room,status,artworkNote,
    logOpen,toolsOpen,destination:previewMessage,cursor,hasToken:Boolean(cameraToken()),
    storyOpen,storyContent:storyOpen ? storyPanel(battle,map) : "",
    rescueAvailable:canControl(selectedActor()) && canRescue(battle,map,selectedActor()),
    canAct:canControl(selectedActor()), controllers:table ? battle.controllers ?? {} : null, controller,
    tableOpen,tableContent:tableOpen ? tablePanel(table,context.characters,battle,tableMessage,needsHostSignIn,controller) : "",
    shared:Boolean(table),players:table?.players,
    adventureName:context.adventures.find(({id}) => id === map.module)?.name,
  }) : playPage();
  const chatSlot = element.querySelector(".game-chat-slot");
  if (chatSlot && table?.chat) {
    const character = battle.actors.find((actor) => actor.side === "party" && battle.controllers?.[actor.id] === controller);
    table.chat.mount(chatSlot,character?.name || table.player);
  }
  if (archiveOpen && !hasArchive()) element.querySelector(".play-archive")?.setAttribute("open","");
  if (gridOpen) element.querySelector("#grid-settings")?.setAttribute("open","");
  const frame = element.querySelector(".board-frame");
  if (context.game && focusedGameMap !== map.key) {
    const center = cameraToken();
    if (center) {
      const fittedCell = map.size*Math.min(frame.clientWidth/map.width,frame.clientHeight/map.height);
      if (fittedCell > 0 && fittedCell < 14) cameraState = {zoom:Math.min(8,Math.max(30/fittedCell,cameraState?.zoom ?? 1)),center};
      else if (mapWalls(map)) cameraState = {zoom:1.4,center};
      focusedGameMap = map.key;
    }
  }
  const cueLayer = element.querySelector(".combat-cues");
  const committedBattle = table?.state?.battle ?? battle;
  combatCues.sync(table?.id ?? battle,committedBattle.monsterEvents ?? [],cueLayer ? {
    layer:cueLayer,frame,grid:frame.querySelector("#play-grid"),map,sight:partyVision(committedBattle,map),
  } : null);
  camera = createCamera(frame,element.querySelector(".map-controls"),map,cameraState,combatCues.place);
  paintBoard();
  if (active) element.querySelector("#"+CSS.escape(active))?.focus({preventScroll:true});
  if (enemyTurnPending(battle) && scheduledEnemyBattle !== battle && (!table || table.online && !table.writing)) {
    const queued = battle;
    scheduledEnemyBattle = queued;
    setTimeout(() => {
      if (scheduledEnemyBattle === queued) scheduledEnemyBattle = null;
      if (context && root() && battle === queued && enemyTurnPending(battle)) interact(() => {});
    },0);
  }
}

function tableTools() {
  if (!toolsOpen) return "";
  return '<h2>Table tools</h2>' + field("Grid tool","grid-tool",[["move","Move token"],["room","Inspect room"],
    ["difficult","Difficult terrain"],["wall","Block square"],["clear","Clear terrain"]].map(([value,label]) => option(value,label,tool===value))) +
    (battle.round ? actionButton("End initiative","end-initiative",{disabled:Boolean(battle.movement)}) : "") +
    gridSettings() + manualHP() + (tool==="room" ? roomPanel() : "");
}

function resetActionSelection() {
  combatChoice = ""; castSlot = ""; targetId = ""; spellSquare = null; extraTargets.clear();
  pathPreview = null; previewMessage = ""; pendingSquare = null;
}

function canRollInitiative() {
  const available = (side) => battle.actors.some((actor) => actor.side === side && actorIsUp(actor) && occupies(actor));
  return available("party") && available("hostile");
}

function advanceCombat() {
  if (!battle.round) return;
  checkSpellTethers(battle,map);
  const message = runEnemyTurns(battle,map);
  if (message && !status && (!context.game || !battle.round)) status = message;
  if (battle.round && !battle.movement &&
      !battle.actors.some((actor) => actor.side === "hostile" && battle.order.includes(actor.id) && actorIsUp(actor) && occupies(actor))) {
    endInitiative(battle);
    status = context.game ? "Encounter cleared. Free movement restored." : "Encounter cleared.";
  }
}

function beginCombat(actor, enemy, noticed) {
  const reason = engageEnemy(battle,map,actor,enemy,noticed);
  if (!reason) return false;
  resetActionSelection();
  category = "move";
  tool = "move";
  status = reason;
  log(battle,reason);
  return true;
}

function detectNearby(actor) {
  return beginCombat(actor,enemyInSight(battle,map,actor),true);
}

function checkGameCell(x,y,region,token) {
  const actor = selectedActor();
  if (!battle.round && token?.side === "party" && category === "move" && canControl(token)) {
    selectedId = token.id;
    detectNearby(token);
    return;
  }
  if (battle.round && category === "move" && token?.side === "party" && canControl(token) && movementGroup(battle).includes(token)) {
    selectedId = token.id;
    resetActionSelection();
    return;
  }
  requireControl(actor);
  const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.key) : null;
  pathPreview = null;
  previewMessage = "";
  if (category === "spell" && (effect?.area || effect?.cone || effect?.teleport)) {
    spellSquare = {x,y};
    return;
  }
  if (token && (!visibleTokens()?.has(token.id) || token.id === actor?.id && category === "move")) return;
  if (token) {
    if (!battle.round && token.side === "hostile") beginCombat(actor,token,false);
    else targetId = token.id;
    return;
  }
  if (category !== "move") {
    status = "Choose a token as the target, or switch to Move.";
    return;
  }
  if (!actor) throw new Error("Choose a party member to move.");
  if (battle.round) moveToken(battle,actor,x,y,map);
  else exploreToken(battle,actor,x,y,map,(moving) => {
    rememberVision(battle,map);
    discoverStory(battle,map,moving);
    return detectNearby(moving);
  });
  room = regionAt(map,...cellCenter(map,actor)) ?? null;
}

async function loadRoster(records, area) {
  const creatures = (await Promise.all(records.map((record) => rosterTokens(record)))).flat();
  for (const creature of creatures) add(creature,area);
  return creatures.length;
}

async function launchGame() {
  await ensureScene();
  const entry = map.regions.find(({id}) => id === "01b") ?? map.regions[0];
  if (!battle.round && !battle.actors.some((actor) => actor.side === "party")) {
    for (const character of context.characters.slice(0,4)) {
      try {add(partyActor(character),entry);} catch (error) {log(battle,error.message);}
    }
  }
  if (!battle.actors.some((actor) => actor.side === "party")) {
    throw new Error("Import a character to start this adventure, or choose the practice yard.");
  }
  for (const actor of battle.actors.filter((entry) => entry.id.startsWith("party:"))) {
    const character = importedCharacter(actor);
    if (!character) continue;
    const imported = partyActor(character);
    actor.spells = imported.spells;
    actor.slots ??= {};
    actor.saves ??= {};
    for (const [rank,slot] of Object.entries(imported.slots)) {
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
    for (const [ability,save] of Object.entries(imported.saves)) actor.saves[ability] ??= save;
  }
  const selected = battle.actors.find((actor) => actor.side === "party" && actor.id === selectedId && actorIsUp(actor)) ??
    battle.actors.find((actor) => actor.side === "party" && actorIsUp(actor));
  selectedId = selected?.id ?? "";
  category = "move"; tool = "move"; status = ""; resetActionSelection();
  if (!battle.story) {
    discoverStory(battle,map,selected);
    revealStory(0);
  }
  if (!battle.round) battle.actors.filter((entry) => entry.side === "party").some(detectNearby);
  advanceCombat();
  rememberVision(battle,map);
  saveExplored(battle,map);
  preferredGame = {module:moduleId,map:map.key};
  try {localStorage.setItem(activeMapKey,JSON.stringify(preferredGame));} catch {}
  saveBattle();
  location.hash = "game";
}

function refreshPartyToken(actor, character) {
  const sheet = partyActor(character);
  for (const key of ["name","ac","speed","darkvision","initiative","dex","ability","saves","resist","level","spells","spellDC","spellAttack","spellAbility"]) {
    actor[key] = sheet[key];
  }
  actor.maxHp = sheet.maxHp + (actor.aid ?? 0);
  actor.hp = Math.min(actor.hp,actor.maxHp);
  actor.slots ??= {};
  for (const [rank,slot] of Object.entries(sheet.slots)) {
    const existing = actor.slots[rank];
    const maximum = slot.maximum ?? existing?.maximum ?? null;
    const remaining = existing?.current ?? slot.current ?? null;
    actor.slots[rank] = {maximum,current:remaining == null || maximum == null ? remaining : Math.min(remaining,maximum)};
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
    const loaded = id === "training" ? [trainingMap] : await moduleMaps(id);
    if (request !== revision) return;
    if (!loaded.length) throw new Error("This adventure has no supported square-grid maps in the attached archive.");
    moduleId = id;
    maps = loaded;
    const defaultMap = loaded.find((entry) => entry.key === preferred)
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

function freeCell(region) {
  const cells = region ? regionCells(map,region) : [];
  const taken = new Set(battle.actors.filter(occupies).map(({x,y}) => keyAt(x,y)));
  const allowed = ({x,y}) => mapFloor(map,x,y) && !taken.has(keyAt(x,y)) && battle.terrain[keyAt(x,y)] !== "wall";
  const mapped = cells.find(allowed);
  if (mapped) return mapped;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      if (allowed({x,y})) return {x,y};
    }
  }
  throw new Error("The grid has no free squares.");
}

function add(actor, area = room) {
  if (actor.side === "party" && battle.actors.filter(({side}) => side === "party").length >= 4) {
    throw new Error("The party already has four characters.");
  }
  const {x,y} = freeCell(area);
  placeToken(battle,actor,x,y,map);
  actor.origin = areaKey(area);
  battle.actors.push(actor);
  selectedId = actor.id;
  tool = "move";
}

function canUseMapSquare(x,y) {
  if (!context.game) return true;
  if (hasExplored(exploredCells(battle,map),x,y) || partyVision(battle,map).has(keyAt(x,y))) return true;
  const actor = selectedActor();
  return tool === "move" && category === "move" && actor?.side === "party" && occupies(actor) &&
    mapFloor(map,x,y) && distanceFt(actor,{x,y}) <= 5;
}

function checkCell(x,y,region) {
  if (root()?.querySelector("#grid-settings")?.open && gridDraft) {
    status = "Save the grid alignment to use the adjusted squares.";
    return;
  }
  if (x < 0 || x >= map.cols || y < 0 || y >= map.rows) return;
  if (!canUseMapSquare(x,y)) {status = "Choose a square the party has seen."; return;}
  cursor = {x,y};
  if (tool === "room") {
    selectRoom(region);
    const marker = visibleMarkers().find((entry) => entry.x === x && entry.y === y);
    if (marker) document.dispatchEvent(new CustomEvent("wayfarer:marker",{detail:marker}));
    return;
  }
  const token = battle.actors.find((actor) => occupies(actor) && actor.x === x && actor.y === y);
  if (tool === "move" && context.game) return checkGameCell(x,y,region,token);
  if (tool === "move") {
    if (token) {
      if (battle.round) targetId = token.id;
      else selectedId = token.id;
    } else {
      const actor = selectedActor();
      if (!actor) throw new Error("Select a token to place first.");
      if (battle.round) requireControl(actor);
      moveToken(battle,actor,x,y,map);
    }
    status = token ? "Selected " + token.name + "." : "Square " + (x+1) + ", " + (y+1) + ".";
  } else {
    if (tool === "wall" && token) throw new Error("Move the token before blocking this square.");
    terrainAt(battle,x,y,tool);
    status = tool === "clear" ? "Terrain cleared." : tool === "wall" ? "Blocked square marked." : "Difficult terrain marked.";
  }
}

async function loadFile(file, name) {
  if (!file || pending) return;
  pending = true;
  status = "Reading 5etools archive…";
  redraw();
  try {
    const result = await attachArchive(file,name);
    lastAdventure = context.activeAdventure;
    await selectModule(context.activeAdventure || "LMoP");
    if (!result.saved) status = "Archive loaded for this session. Browser storage is unavailable.";
  } catch (failure) {
    status = failure.message;
  } finally {
    pending = false;
    redraw();
  }
}

function sharedSheet(record) {
  const character = enrichCharacter(record);
  const fields = ["id","species","characterClass","level","abilities","skills","items","spells","attacks","proficiency","passivePerception","background","alignment","rulesDetails"];
  return Object.fromEntries(fields.filter((key) => character[key] != null).map((key) => [key,character[key]]));
}

const tableState = () => ({battle,alignment:map.printedGrid ?? null});

async function hostTable() {
  const route = location.hash;
  pending = true;
  setTableMessage("Starting shared session…");
  try {
    rememberVision(battle,map);
    saveExplored(battle,map);
    const state = tableState();
    state.battle = structuredClone(battle);
    state.battle.sheets = Object.fromEntries(context.characters
      .filter(({id}) => battle.actors.some((actor) => actor.id === "party:"+id))
      .map((character) => ["party:"+character.id,sharedSheet(character)]));
    const tokens = new Map();
    for (const actor of state.battle.actors) {
      const hash = partyTokenImage(actor);
      if (!hash) {delete actor.tokenImage; continue;}
      actor.tokenImage = hash;
      if (!tokens.has(hash)) tokens.set(hash,await localTokenBlob(hash));
    }
    if (location.hash !== route) return;
    const result = await createSession({...map,detectedGrid},state,customArtwork,tokens);
    if (location.hash !== route) return;
    showInvitation = result.id;
    location.hash = sessionHash(result.id);
  } catch (error) {
    if (location.hash === route) {
      setTableMessage(error.message);
      if (error.status === 401) {
        needsHostSignIn = true;
        redraw();
      }
    }
  } finally {pending = false;}
}

function setTableMessage(message) {
  tableMessage = message;
  const output = root()?.querySelector(".session-panel [role=status]");
  if (output) output.textContent = message;
}

function applyTableState(connection, snapshot) {
  const turn = currentActor(battle)?.id;
  const round = battle.round;
  const storyBefore = connection.state ? storyVersion(battle) : 0;
  const geometryChanged = JSON.stringify(map.printedGrid ?? null) !== JSON.stringify(snapshot.state.alignment);
  connection.state = snapshot.state;
  connection.revision = snapshot.revision;
  connection.online = true;
  battle = structuredClone(snapshot.state.battle);
  if (geometryChanged && map.sourceGrid) {
    setAlignment(snapshot.state.alignment ?? map.sourceGrid);
    gridDraft = null;
    cursor = null;
  }
  repairWallPlacement(map,battle);
  const owned = battle.actors.find(({id}) => battle.controllers?.[id] === controller);
  if (owned) selectedId = owned.id;
  else if (!battle.actors.some((actor) => actor.id === selectedId && canControl(actor))) {
    selectedId = battle.actors.find((actor) => actorIsUp(actor) && canControl(actor))?.id ?? "";
  }
  if (storyBefore > 0 || !showInvitation) revealStory(storyBefore);
  if (turn !== currentActor(battle)?.id || round !== battle.round) {
    resetActionSelection();
    category = "move";
  }
  pathPreview = null; pendingSquare = null; previewMessage = "";
}

async function pollTable(connection) {
  if (table !== connection || connection.reading) return;
  clearTimeout(connection.timer);
  connection.reading = true;
  try {
    if (connection.writing || camera?.gesturing()) return;
    const snapshot = await readSession(connection.id,connection.revision);
    if (table !== connection || connection.writing || camera?.gesturing()) return;
    if (snapshot && snapshot.revision > connection.revision) {
      applyTableState(connection,snapshot);
      status = "";
      tableMessage = "";
      redraw();
    } else if (!connection.online) {
      connection.online = true;
      setTableMessage("Connected");
      if (enemyTurnPending(battle)) redraw();
    }
  } catch {
    if (table === connection) {
      connection.online = false;
      setTableMessage("Connection lost. Reconnecting…");
    }
  } finally {
    connection.reading = false;
    if (table === connection) connection.timer = setTimeout(() => pollTable(connection),document.hidden ? 9000 : 1500);
  }
}

async function pollPlayers(connection) {
  if (table !== connection || connection.readingPlayers || !connection.state) return;
  clearTimeout(connection.playerTimer);
  connection.readingPlayers = true;
  try {
    const result = await syncSessionPlayers(connection.id,controller);
    if (table === connection && !connection.writing && !camera?.gesturing() &&
        JSON.stringify(result.players) !== JSON.stringify(connection.players)) {
      connection.players = result.players;
      redraw();
    }
  } catch {
    // A failed heartbeat leaves the last visible roster in place until the next poll.
  } finally {
    connection.readingPlayers = false;
    if (table === connection) connection.playerTimer = setTimeout(() => pollPlayers(connection),document.hidden ? 15000 : 3500);
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
    const entry = await syncSessionPlayers(connection.id,controller,username);
    if (table !== connection) return;
    if (!entry.player) {
      connection.needsUsername = true;
      return;
    }
    connection.player = entry.player;
    connection.players = entry.players;
    connection.needsUsername = false;
    rememberedUsername(entry.player);
    const snapshot = await readSession(connection.id);
    if (table !== connection) return;
    map = snapshot.map;
    detectedGrid = map.detectedGrid;
    art = null; artworkNote = ""; customArtwork = null; gridDraft = null;
    storyOpen = false;
    selectedId = ""; tool = "move"; category = "move"; status = ""; room = null; cursor = null;
    resetActionSelection();
    applyTableState(connection,snapshot);
    connection.chat ??= createGameChat(connection.id,controller);
    recentSession(connection.id);
    tableOpen = showInvitation === connection.id;
    showInvitation = null;
    if (map.asset || snapshot.hasArtwork) loadArtwork(map,null,snapshot.hasArtwork ? artworkURL(connection.id) : null);
    pollTable(connection);
    connection.playerTimer = setTimeout(() => pollPlayers(connection),3500);
  } catch (failure) {
    if (table !== connection) return;
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
  artworkRequest?.abort();
  ({map,battle,art,artworkNote,customArtwork,detectedGrid,room,selectedId,tool} = table.solo);
  table = null;
  tableOpen = false;
  tableMessage = "";
  status = "";
  resetActionSelection();
  camera?.destroy();
  camera = null;
}

export function showPlay(data) {
  context = data;
  if (!data?.game) focusedGameMap = null;
  if (!data?.sessionRoute) leaveTable();
  if (!data) {
    combatCues.reset();
    return;
  }
  if (!battle) useMap(trainingMap);
  if (data.sessionRoute) {
    const id = sessionCode(data.sessionRoute);
    if (table?.id === id) {redraw(); return;}
    leaveTable();
    revision++;
    pending = false;
    artworkRequest?.abort();
    camera?.destroy();
    camera = null;
    table = {id,solo:{map,battle,art,artworkNote,customArtwork,detectedGrid,room,selectedId,tool}};
    if (id) connectTable(table);
    else {tableMessage = "Check the session link and try again."; redraw();}
    return;
  }
  redraw();
  if (hasArchive() && lastAdventure !== context.activeAdventure) {
    lastAdventure = context.activeAdventure;
    const preferred = context.game ? preferredGame : null;
    selectModule(preferred?.module || context.activeAdventure || "LMoP", preferred?.map);
  }
}

document.addEventListener("wayfarer:archive", () => {
  if (root() && !pending && context && !table) {
    const preferred = context.game ? preferredGame : null;
    lastAdventure = context.activeAdventure;
    selectModule(preferred?.module || context.activeAdventure || "LMoP",preferred?.map);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && table?.state) {
    pollTable(table);
    pollPlayers(table);
    table.chat?.refresh();
  }
});

async function interact(run, {cosmetic = false, retryMove, remaining = 2} = {}) {
  const connection = table;
  if (connection && (!connection.state || connection.writing)) return;
  let succeeded = true;
  const storyBefore = storyVersion(battle);
  const turnBefore = currentActor(battle)?.id;
  const roundBefore = battle.round;
  if (connection) connection.writing = true;
  try {
    status = "";
    await run();
    if (connection !== table) return;
    if (!cosmetic && context?.game && battle.round) {
      const heroes = battle.actors.filter((actor) => actor.side === "party");
      for (const enemy of battle.actors.filter((actor) => actor.side === "hostile" && !battle.order.includes(actor.id))) {
        if (heroes.some((hero) => noticesEnemy(battle,map,hero,enemy))) joinInitiative(battle,enemy);
      }
    }
    if (!cosmetic && context) {
      advanceCombat();
      if (turnBefore !== currentActor(battle)?.id || roundBefore !== battle.round) {
        resetActionSelection();
        category = "move";
      }
    }
    if (!cosmetic && context?.game) {
      for (const actor of battle.actors) discoverStory(battle,map,actor);
      rememberVision(battle,map);
      saveExplored(battle,map);
    }
    saveBattle();
  } catch (failure) {
    status = failure instanceof Error ? failure.message : "The action could not be completed.";
    succeeded = false;
    if (connection && connection === table) {
      applyTableState(connection,connection);
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
        const result = await writeSession(connection.id,connection.revision,next);
        if (connection !== table) return;
        if (result.state) {
          succeeded = false;
          applyTableState(connection,result);
          if (remaining > 0 && retryMove?.()) {
            connection.writing = false;
            return await interact(run,{retryMove,remaining:remaining-1});
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
      applyTableState(connection,connection);
      connection.online = false;
      status = error.message;
    } finally {connection.writing = false;}
  }
  if (context) redraw();
  return succeeded;
}

function interactCell(x,y,region) {
  const mover = context.game && battle.round && category === "move" && tool === "move" ? selectedActor() : null;
  const {round} = battle;
  const destinationFree = () => !battle.actors.some((actor) => occupies(actor) && actor.x === x && actor.y === y);
  const retryMove = mover && destinationFree() ? () => {
    const current = selectedActor();
    return battle.round === round && current?.id === mover.id && current.x === originX && current.y === originY &&
      canControl(current) && movementGroup(battle).includes(current) && !battle.movement && destinationFree();
  } : undefined;
  const originX = mover?.x, originY = mover?.y;
  return interact(() => checkCell(x,y,region),{retryMove});
}

export async function setGameTokenImage(id,image,session) {
  const route = location.hash;
  const sameGame = () => context?.game && location.hash === route && table?.id === session;
  if (!sameGame()) throw new Error("Reopen the character in this session to change its token.");
  const success = await interact(async () => {
    if (session && image) await uploadSessionToken(session,image);
    if (!sameGame()) throw new Error("The game has changed.");
    const actor = battle.actors.find((actor) => actor.id === id && actor.side === "party");
    if (!actor) throw new Error("This character is no longer in the party.");
    if (image) actor.tokenImage = image;
    else delete actor.tokenImage;
  },{cosmetic:true});
  if (!success) throw new Error(status || "The token could not be updated. Try again.");
}

document.addEventListener("click", (event) => {
  if (!root()?.contains(event.target)) return;
  const cameraControl = event.target.closest("[data-camera]");
  if (cameraControl) {
    camera?.control(cameraControl.dataset.camera,cameraToken());
    return;
  }
  if (event.target.id === "play-grid") {
    const {x,y,region} = gridPosition(map,event.target,event);
    if (context.game && battle.round && category === "move" && tool === "move" && matchMedia("(pointer: coarse)").matches &&
        !battle.actors.some((actor) => occupies(actor) && actor.x === x && actor.y === y)) {
      pendingSquare = movePreview(x,y) ? {x,y,region} : null;
      redraw();
      return;
    }
    interactCell(x,y,region);
    return;
  }
  const button = event.target.closest("[data-play]");
  if (!button || pending) return;
  const {play,id} = button.dataset;
  if (play === "commit-move") {
    if (pendingSquare) {
      const {x,y,region} = pendingSquare;
      pendingSquare = null;
      interactCell(x,y,region);
    }
    return;
  }
  if (play === "retry-session") {if (table?.error) connectTable(table); return;}
  if (play === "game-table") {
    tableOpen = !tableOpen;
    if (tableOpen) {logOpen = false; toolsOpen = false; storyOpen = false; tool = "move"; gridDraft = null;}
    redraw();
    return;
  }
  if (play === "game-story") {
    storyOpen = !storyOpen;
    if (storyOpen) {logOpen = false; toolsOpen = false; tableOpen = false; tool = "move"; gridDraft = null;}
    redraw();
    return;
  }
  if (play === "host-session") {if (!table) hostTable(); return;}
  if (play === "copy-session" && table) {
    const input = root().querySelector("#session-link");
    Promise.resolve().then(() => navigator.clipboard.writeText(inviteURL(table.id)))
      .then(() => setTableMessage("Invite link copied."), () => {input.select(); setTableMessage("Copy the selected invite link.");});
    return;
  }
  if (play === "archive-picker") {root().querySelector("#play-archive-file").click(); return;}
  if (play === "art") {root().querySelector("#play-art").click(); return;}
  if (play === "inspect-marker") {
    const marker = battle.markers?.find((entry) => entry.id === id);
    if (marker) document.dispatchEvent(new CustomEvent("wayfarer:marker",{detail:marker}));
    return;
  }
  if (play === "inspect") {
    const actor = battle.actors.find((entry) => entry.id === id);
    if (actor) document.dispatchEvent(new CustomEvent("wayfarer:inspect",{
      detail:structuredClone({...actor,tokenImage:partyTokenImage(actor),tokenSession:table?.id,
        sharedSheet:table ? battle.sheets?.[id] : undefined}),
    }));
    return;
  }
  if (play === "enter-game") {
    pending = true;
    redraw();
    launchGame().catch((error) => {status=error.message;}).finally(() => {pending=false; redraw();});
    return;
  }
  interact(async () => {
    switch (play) {
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
        if (marker) { marker.revealed = true; status = marker.name + " revealed."; }
        break;
      }
      case "release-wolves":
        if (!battle.round && map.module === "LMoP" && map.id === "1ab" && room?.id === "021") {
          for (const actor of battle.actors.filter((entry) => entry.origin === areaKey(room) && entry.side === "neutral" && !entry.dead)) {
            actor.side = "hostile";
          }
          if (context.game) battle.actors.filter((actor) => actor.side === "party").some(detectNearby);
        }
        break;
      case "game-category": category = id; tool = "move"; resetActionSelection(); break;
      case "control-party": {
        const actor = battle.actors.find((entry) => entry.id === id);
        if (actorIsUp(actor) && canControl(actor) && (!battle.round || movementGroup(battle).includes(actor))) {
          selectedId = id; tool = "move"; category = "move"; resetActionSelection();
          if (!battle.round) detectNearby(actor);
        }
        break;
      }
      case "claim-party": {
        if (!table || !battle.actors.some((actor) => actor.id === id && actor.side === "party")) break;
        const controllers = battle.controllers ??= {};
        if (controllers[id] && controllers[id] !== controller) throw new Error("Another player claimed this character.");
        if (controllers[id] === controller) delete controllers[id];
        else {
          for (const owned of Object.keys(controllers)) if (controllers[owned] === controller) delete controllers[owned];
          controllers[id] = controller;
          selectedId = id;
          resetActionSelection();
        }
        break;
      }
      case "rescue-sildar":
        requireControl(selectedActor());
        rescueSildar(battle,map,selectedActor());
        break;
      case "game-log": logOpen = !logOpen; toolsOpen = false; tableOpen = false; storyOpen = false; break;
      case "game-tools": toolsOpen = !toolsOpen; logOpen = false; tableOpen = false; storyOpen = false; if (!toolsOpen) {tool="move"; gridDraft=null;} break;
      case "archive-local": {
        pending = true;
        status = "Opening the supplied archive…";
        redraw();
        const response = await fetch("local-archive").finally(() => {pending = false;});
        if (!response.ok) throw new Error("The supplied archive could not be opened.");
        await loadFile(await response.blob(), context.localArchive);
        break;
      }
      case "token":
        if (battle.round) targetId = id;
        else {selectedId = id; tool = "move";}
        break;
      case "add-party": {
        const character = context.characters.find((entry) => entry.id === selectedParty);
        if (character) add(partyActor(character), map.regions.find(({id}) => id === "01b") ?? room);
        selectedParty = "";
        break;
      }
      case "refresh-party-token": {
        if (table || battle.round) break;
        const actor = selectedActor();
        const character = importedCharacter(actor);
        if (!character) break;
        refreshPartyToken(actor,character);
        status = actor.name + " updated from the character sheet.";
        break;
      }
      case "add-room-monster": {
        if (battle.round || !room) return;
        const roster = roomRoster(map,room);
        const records = [roster[selectedCreature]].filter(Boolean).map((entry) => ({...entry,count:1}));
        const count = await loadRoster(records,room);
        tool = "room";
        status = plural(count,"token") + " placed.";
        break;
      }
      case "remove-token":
        if (!battle.round) battle.actors = battle.actors.filter((actor) => actor.id !== selectedId);
        selectedId = "";
        break;
      case "start":
        if (!canRollInitiative()) throw new Error("Place a party member and a hostile creature to roll initiative.");
        startInitiative(battle); resetActionSelection(); tool = "move"; break;
      case "end-initiative": endInitiative(battle); combatChoice = ""; targetId = ""; tool = "move"; break;
      case "end":
        if (selectedActor() !== currentActor(battle)) throw new Error("Wait for this character’s action turn.");
        requireControl(currentActor(battle)); endTurn(battle); resetActionSelection(); category = "move"; break;
      case "death": requireControl(selectedActor()); deathSave(battle,selectedActor()); break;
      case "witch-bolt": requireControl(selectedActor()); sustainWitchBolt(battle,selectedActor(),map); break;
      case "wake": requireControl(selectedActor()); wakeCreature(battle,selectedActor(),battle.actors.find((actor) => actor.id === id)); break;
      case "pass-reaction": requireControl(opportunity(battle)?.foe); resolveOpportunity(battle,null,undefined,map); break;
      case "dash": case "dodge": case "disengage": case "bonus-disengage": case "stand":
        requireControl(selectedActor()); turnAction(battle,selectedActor(),play); break;
      case "reset":
        if (window.confirm("Reset all tokens, terrain, and rolls on this map?")) {
          delete battles[map.key]; useMap(map);
        }
        break;
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.target.id !== "play-grid") return;
  const keys = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  const viewKey = {"+":"in","=":"in","-":"out","0":"fit"}[event.key];
  if (viewKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    camera?.control(viewKey);
    return;
  }
  if (!keys[event.key] && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  const initial = selectedActor();
  cursor ||= initial?.x != null ? {x:initial.x,y:initial.y} : {x:0,y:0};
  if (keys[event.key]) {
    const [dx,dy] = keys[event.key];
    if (event.shiftKey) {camera?.pan(dx,dy); return;}
    cursor.x = Math.max(0,Math.min(map.cols-1,cursor.x+dx));
    cursor.y = Math.max(0,Math.min(map.rows-1,cursor.y+dy));
    camera?.reveal(mapPoint(cursor));
    if (context.game && battle.round && category === "move" && tool === "move") movePreview(cursor.x,cursor.y);
    else paintBoard();
    event.target.setAttribute("aria-label","Square " + (cursor.x+1) + ", " + (cursor.y+1));
  } else interactCell(cursor.x,cursor.y,regionAt(map,...cellCenter(map,cursor)));
});

function movePreview(x,y) {
  const actor = selectedActor();
  if (!canControl(actor)) return null;
  cursor = {x,y};
  const known = canUseMapSquare(x,y);
  const route = battle.round && known ? previewMovement(battle,actor,x,y,map) : null;
  pathPreview = route?.path.length ? [actor,...route.path] : null;
  previewMessage = !known ? "Unexplored square." : battle.round
    ? route ? "Move " + route.cost + " ft · " + (moveLeft(battle,actor)-route.cost) + " ft remaining" : "Outside remaining movement or blocked."
    : "Click a square to move freely.";
  const line = root()?.querySelector("#game-move-preview");
  if (line) line.textContent = previewMessage;
  paintBoard();
  return route;
}

document.addEventListener("pointermove", (event) => {
  if (!context?.game || (gridDraft && root()?.querySelector("#grid-settings")?.open) || event.target.id !== "play-grid" || tool !== "move" || category !== "move") return;
  const {x,y} = gridPosition(map,event.target,event);
  if (cursor?.x !== x || cursor?.y !== y) movePreview(x,y);
});

document.addEventListener("input", (event) => {
  if (!root()?.contains(event.target)) return;
  if (event.target.id === "session-username" && table?.needsUsername) {
    table.usernameDraft = event.target.value;
    return;
  }
  if (!event.target.id.startsWith("grid-align-")) return;
  const alignment = readAlignment();
  const feedback = root().querySelector("#grid-align-feedback");
  if (alignment && fitsCurrentGrid(gridGeometry(map,alignment),battle)) {
    gridDraft = alignment;
    feedback.textContent = "Previewing the adjusted guides.";
  } else {
    feedback.textContent = "Enter positive spacing and keep saved pieces inside the grid.";
  }
  paintBoard();
});

document.addEventListener("toggle", (event) => {
  if (event.target.id !== "grid-settings" || !root()?.contains(event.target) || event.target.open || !gridDraft) return;
  gridDraft = null;
  updateAlignmentFields();
  paintBoard();
}, true);

document.addEventListener("change", (event) => {
  if (!root()?.contains(event.target)) return;
  const {id,value} = event.target;
  if (id.startsWith("extra-target-")) {
    extraTargets.set(Number(id.slice("extra-target-".length)),value);
    return;
  }
  switch (id) {
    case "play-archive-file": loadFile(event.target.files[0], event.target.files[0]?.name); return;
    case "play-module": selectModule(value); return;
    case "play-map": {const entry = maps.find(({key}) => key===value); if (entry) useMap(entry); break;}
    case "play-room": selectRoom(map.regions.find((region) => areaKey(region) === value)); tool = "room"; break;
    case "grid-tool": tool = value; break;
    case "grid-overlay": interact(() => {battle.gridOverlay = value;}); return;
    case "room-creature": selectedCreature = Number(value); break;
    case "play-party": selectedParty = value; break;
    case "combat-choice": combatChoice = value; spellSquare = null; castSlot = ""; extraTargets.clear(); break;
    case "cast-slot": castSlot = value; break;
    case "breath-type": breathType = value; return;
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

document.addEventListener("submit", (event) => {
  if (!root()?.contains(event.target)) return;
  event.preventDefault();
  const value = (id) => event.target.querySelector("#"+id)?.value;
  if (event.target.id === "session-join-form") {
    const id = sessionCode(value("session-invite"));
    if (id) location.hash = sessionHash(id);
    else root().querySelector("#session-join-error").textContent = "Enter a valid Wayfarer invite link or session code.";
    return;
  }
  if (event.target.id === "session-username-form") {
    if (table?.needsUsername) connectTable(table,value("session-username"));
    return;
  }
  interact(async () => {
    switch (event.target.id) {
      case "session-party-form": {
        if (!table || battle.round) return;
        const character = context.characters.find(({id}) => id === value("session-character"));
        if (!character || battle.actors.some(({id}) => id === "party:"+character.id)) return;
        const connection = table;
        const actor = partyActor(character);
        if (actor.tokenImage) await uploadSessionToken(connection.id,actor.tokenImage);
        if (connection !== table) return;
        add(actor,map.regions.find(({id}) => id === "01b") ?? map.regions[0]);
        (battle.sheets ??= {})[actor.id] = sharedSheet(character);
        status = actor.name + " joined the party.";
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
        const roll = rollDice(diceFormula);
        diceResult = roll.breakdown + " = " + roll.total;
        log(battle, "Dice roll — " + diceResult + ".");
        break;
      }
      case "creature-form": {
        const name = value("creature-name").trim();
        const source = value("creature-source").trim();
        if (!await monsterRecord(name,source)) throw new Error("Creature not found. Check its name and source code.");
        const actor = await creatureActor({name,source});
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
          for (const [field,id] of [["spellDC","actor-spell-dc"],["spellAttack","actor-spell-attack"],["spellAbility","actor-spell-ability"]]) {
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
        for (const [level,pool] of Object.entries(actor.slots)) {
          const current = value("slot-"+level);
          pool.current = current === "" ? null : Number(current);
        }
        status = "Token updated.";
        break;
      }
      case "reaction-form":
        requireControl(opportunity(battle)?.foe);
        resolveOpportunity(battle,Number(value("reaction-attack")),undefined,map);
        break;
      case "manual-hp-form": {
        if (battle.movement) throw new Error("Resolve the opportunity attack first.");
        const target = battle.actors.find(({id}) => id === value("manual-target"));
        if (!target || target.dead) throw new Error("Choose a living token.");
        const amount = Number(value("manual-amount"));
        if (value("manual-effect") === "heal") log(battle,target.name+" regains "+heal(target,amount)+" HP by manual ruling.");
        else {
          const type = value("manual-type");
          const result = applyDamage(battle,target,amount,type);
          log(battle,target.name+" takes "+result.damage+" "+type+" damage by manual ruling.");
        }
        break;
      }
      case "combat-form": {
        const actor = selectedActor();
        requireControl(actor);
        const {choice,target} = combatSelection(actor,visibleTokens());
        const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.key) : null;
        const options = {mode:rollMode,cover,square:spellSquare,map,damageType:breathType,
          keepTemp:event.target.querySelector("#keep-temp")?.checked,
          targets:[...event.target.querySelectorAll('[id^="extra-target-"]')].map((field) =>
            battle.actors.find((entry) => entry.id === field.value))};
        if (!choice?.usable) {
          if (choice?.manual) {
            recordSpell(battle,actor,choice.data,Number(value("cast-slot")));
            status = battle.log.at(-1);
          }
          return;
        }
        if (!battle.round && (choice.mode === "weapon" || choice.mode === "custom" ||
          (choice.mode === "spell" && !effect?.exploration))) {
          const enemy = target?.side === "hostile" ? target : (effect?.area || effect?.cone) && spellSquare
            ? battle.actors.find((entry) => entry.side === "hostile" && actorIsUp(entry) && noticesEnemy(battle,map,actor,entry)) : null;
          if (!beginCombat(actor,enemy,false)) throw new Error("Choose an enemy to start combat.");
          return;
        }
        if (choice.mode === "spell") {
          castSpell(battle,actor,target,choice.data,Number(value("cast-slot")),options);
          status = battle.log.at(-1);
          if (!battle.round && effect?.teleport) detectNearby(actor);
        }
        else if (choice.mode === "potion") drinkPotion(battle,actor,choice.data);
        else {
          const weapon = choice.mode === "weapon" ? choice.data : {
            name:"Custom strike", bonus:value("custom-bonus") === "" ? null : Number(value("custom-bonus")),
            damage:value("custom-damage"), normalRange:Number(value("custom-range")) || undefined,
            reach:Number(value("custom-reach")) || 5,
          };
          rollStrike(battle,actor,target,weapon,options);
          if (target?.side === "hostile") joinInitiative(battle,target);
        }
        break;
      }
    }
  });
});
