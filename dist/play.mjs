import {areaKey, populateScene, rosterTokens} from "./scene-populate.mjs";
import {gameScreen} from "./game-screen.mjs";
import {enemyInSight, engageEnemy, inSight, noticesEnemy} from "./exploration.mjs";
import {escape, plural, signed, text} from "./format.mjs";
import {icon} from "./icons.mjs";
import {attachArchive, archiveName, formatEntries, hasArchive, hostedMapImage, mapImage, monsterRecord} from "./rules-library.mjs";
import {cellCenter, creatureActor, moduleMaps, partyActor, regionAt, regionCells, roomNotes, roomRoster, trainingActors, trainingMap} from "./encounters.mjs";
import {drawGrid, gridPosition, terrainAt} from "./grid-view.mjs";
import {
  actorIsUp, applyDamage, areaCells, castSpell, currentActor, deathSave, diceTerms, drinkPotion, endInitiative, endTurn, joinInitiative, keyAt, moveLeft,
  exploreToken, heal, log, moveToken, newBattle, occupies, opportunity, placeToken, previewMovement, recordSpell, resolveOpportunity, rollDice,
  rollStrike, startInitiative, supportedSpell, turnAction,
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
let zoom = "100";
let artworkRequest;
let artworkNote = "";
let category = "move";
let logOpen = false;
let toolsOpen = false;
let pathPreview;
let previewMessage = "";
let spellSquare;
let castSlot = "";
const extraTargets = new Map();
let pendingSquare;
let centerBoard = false;
const sceneJobs = new WeakMap();
const tokenImages = new Map();
const tokenRequests = new Map();
const activeMapKey = "wayfarer-active-map-v1";
let preferredGame;
try {preferredGame = JSON.parse(localStorage.getItem(activeMapKey));} catch {}


function root() {return document.querySelector("#play-mount");}
function saveBattle(entry = map, state = battle) {
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

function visibleTokens() {
  if (!context?.game) return null;
  const heroes = battle.actors.filter((actor) => actor.side === "party");
  return new Set(battle.actors.filter((actor) => actor.side === "party" || battle.order.includes(actor.id) ||
    (occupies(actor) && heroes.some((hero) => actor.side === "hostile"
      ? noticesEnemy(battle,map,hero,actor) : inSight(battle,map,hero,actor)))).map(({id}) => id));
}

function visibleMarkers() {
  const entries = battle.markers ?? [];
  if (!context?.game || (toolsOpen && tool === "room")) return entries;
  const heroes = battle.actors.filter((actor) => actor.side === "party");
  return entries.filter((marker) => (!marker.hidden || marker.revealed) &&
    heroes.some((hero) => inSight(battle,map,hero,marker)));
}

function loadTokenImages(visible) {
  for (const actor of battle.actors) {
    const path = actor.tokenArt;
    if (!path || actor.dead || (visible && !visible.has(actor.id)) || tokenImages.has(path) || tokenRequests.has(path)) continue;
    const request = (async () => {
      const blob = await mapImage(path).catch(() => null) ??
        await hostedMapImage(path,AbortSignal.timeout(9000));
      return blob ? decodeMapImage(blob) : null;
    })();
    tokenRequests.set(path,request);
    request.catch(() => null).then((image) => {
      if (tokenImages.size >= 128) tokenImages.delete(tokenImages.keys().next().value);
      tokenImages.set(path,image);
      tokenRequests.delete(path);
      if (image && root()) paintBoard();
    });
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
  const canvas = root()?.querySelector("#play-grid");
  if (!canvas) return;
  if (context.game) {
    const board = canvas.parentElement;
    const fitted = Math.min(board.clientWidth,board.clientHeight * map.width / map.height);
    const width = Math.max(1,fitted*Number(zoom)/100);
    canvas.style.width = width + "px";
    canvas.style.marginTop = Math.max(0,(board.clientHeight-width*map.height/map.width)/2) + "px";
  }
  const actor = selectedActor();
  const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.usable && choice.mode === "spell" ? supportedSpell(choice.data.key) : null;
  const footprint = spellSquare ? effect?.area ? areaCells(battle,spellSquare,effect.area,map) :
    new Set([keyAt(spellSquare.x,spellSquare.y)]) : null;
  const visible = visibleTokens();
  loadTokenImages(visible);
  drawGrid(canvas,map,battle,{
    room:context.game && tool !== "room" ? null : room,selected:actor?.id,target:targetId,cursor,art,
    path:pathPreview,visible,footprint,showRegions:!context.game || !art || tool==="room",
    markers:visibleMarkers(),tokenImages,
  });
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

async function loadArtwork(entry, file) {
  artworkRequest?.abort();
  const request = new AbortController();
  artworkRequest = request;
  const current = () => artworkRequest === request && map === entry;
  if (!entry.asset && !file) {
    artworkNote = "Showing the schematic. Choose a map image to add artwork.";
    return;
  }
  artworkNote = "Loading map artwork…";
  updateArtwork();
  const timeout = setTimeout(() => request.abort(), 12000);
  try {
    let image;
    if (file) {
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
      artworkNote = file ? "Using your map image." : entry.artist ? "Map artwork by " + entry.artist + "." : "Map artwork loaded from 5etools.";
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
  artworkNote = "";
  map = entry;
  battle = battles[map.key] ?? newBattle();
  if (map.module === "training" && !battles[map.key]) battle.actors = trainingActors();
  art = null; selectedId = ""; targetId = ""; combatChoice = ""; cursor = null;
  const initialRoom = map.module === "LMoP" && map.id === "1ab" ? "01b" : map.regions[0]?.id;
  room = map.regions.find(({id}) => id === initialRoom) ?? null;
  selectedCreature = 0; tool = context?.game ? "move" : "room"; status = ""; zoom = "100";
  pathPreview = null; previewMessage = ""; spellSquare = null; pendingSquare = null; centerBoard = true;
  battles[map.key] = battle;
  if (map.module !== "training") {
    loadArtwork(entry);
    ensureScene(entry,battle);
  }
}

function currentTarget() {return battle.actors.find((actor) => actor.id === targetId && occupies(actor));}
function selectedActor() {return currentActor(battle) ?? battle.actors.find(({id}) => id === selectedId);}
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
    ...(actor.potions ?? []).map((potion) => ({mode:"potion",name:potion.name + " (" + potion.quantity + ")",data:potion,usable:potion.quantity > 0})),
    {mode:"custom",name:"Custom strike",usable:true},
  ];
}

function playOptions(actor) {
  if (!actor || (!battle.round && !context.game)) return "";
  const reaction = opportunity(battle);
  if (reaction) return `<form id="reaction-form" class="play-form">
    <p>${escape(reaction.foe.name)} can make an opportunity attack before ${escape(reaction.actor.name)} leaves reach.</p>
    ${field("Opportunity attack","reaction-attack",reaction.attacks.map((attack,index) => option(index,attack.name)))}
    <div class="play-action-row"><button class="button primary small" type="submit">Roll reaction</button>${actionButton("Pass","pass-reaction")}</div>
  </form>`;
  if (actor.hp === 0) return battle.round && actor.resolveDeath
    ? `<p>${actor.stable ? "Stable at 0 HP" : "Unconscious · " + actor.successes + " successes, " + actor.failures + " failures"}</p>
      ${actor.stable || battle.deathRolled ? "" : actionButton("Roll death save","death",{primary:true})}` : "";
  const list = choices(actor);
  const choice = combatChoice === "" ? null : list[Number(combatChoice)];
  const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.key) : null;
  const visible = visibleTokens();
  const targets = battle.actors.filter((entry) => occupies(entry) && (!visible || visible.has(entry.id)));
  const pickArea = effect?.area || effect?.teleport;
  const pickTarget = choice && choice.mode !== "potion" && !effect?.self && !pickArea;
  const auxiliary = effect?.beams ? Math.min(3,[5,11,17].filter((level) => actor.level >= level).length) : effect?.aid ? 2 : 0;
  const moveActions = battle.round ? ["dash","dodge","disengage"].map((act) =>
    actionButton(act.charAt(0).toUpperCase()+act.slice(1),act,{disabled:Boolean(battle.action)})).join("") +
    (actor.nimbleEscape ? actionButton("Disengage (bonus)","bonus-disengage",{disabled:battle.bonusUsed}) : "") +
    (actor.prone ? actionButton("Stand up","stand") : "") : "";
  if (context.game && category === "move") return '<div class="play-action-row">' +
    (pendingSquare ? actionButton("Move here","commit-move",{primary:true}) : "") + moveActions + '</div>';
  const legalChoices = list.map((entry,index) => ({entry,index})).filter(({entry}) => !context.game ||
    entry.mode === category || (category === "weapon" && entry.mode === "custom"));
  if (!legalChoices.length) return `<p>${category === "spell" ? "This character has no listed spells." : "This character has no usable items."}</p>`;
  const slotOptions = choice?.mode === "spell" && choice.data.level
    ? Object.entries(actor.slots).filter(([level, pool]) => Number(level) >= choice.data.level && pool.current > 0)
    : [];
  return `<form class="play-form" id="combat-form">
    ${field(context.game ? {weapon:"Weapon",spell:"Spell",potion:"Item"}[category] : "Action","combat-choice",[
      option("","Choose " + (context.game ? {weapon:"a weapon",spell:"a spell",potion:"an item"}[category] : "an action"),combatChoice === ""),
      ...legalChoices.map(({entry,index}) => option(String(index),entry.name + (entry.data?.prepared === false ? " · unprepared" : entry.usable ? "" : " · manual"), combatChoice === String(index)))])}
    ${pickArea ? `<p class="game-spell-note">${spellSquare ? "Selected square " + (spellSquare.x+1) + ", " + (spellSquare.y+1) :
      effect.teleport ? "Choose an unoccupied destination on the map." : "Choose a point on the map."}</p>` : ""}
    ${pickTarget ? field("Target","target-select",[option("","Choose target",!targetId),
      ...targets.map((entry) => option(entry.id,entry.name,entry.id === targetId))]) : ""}
    ${auxiliary ? `<div class="play-field-row">${Array.from({length:auxiliary},(_,index) =>
      field(effect.beams ? "Beam " + (index+2) : "Target " + (index+2),"extra-target-"+index,
        [option("",effect.beams ? "Same as first target" : "Optional",!extraTargets.get(index)),
          ...targets.map((entry) => option(entry.id,entry.name,entry.id === extraTargets.get(index)))])).join("")}</div>` : ""}
    ${choice?.mode === "spell" && choice.data.level ? field("Spell slot","cast-slot",slotOptions.length ?
      slotOptions.map(([level,pool]) => option(level, "Level " + level + " · " + pool.current + " left",level === castSlot)) : [option("","No available slot")]) : ""}
    ${choice?.mode === "custom" ? `<div class="play-field-row">
      ${input("Attack bonus","custom-bonus",customWeapon.bonus,"number",'required step="1"')}
      ${input("Damage dice","custom-damage",customWeapon.damage,"text",'required placeholder="1d8+3"')}
      ${input("Reach (ft)","custom-reach",customWeapon.reach,"number",'min="5" placeholder="5"')}
      ${input("Ranged limit (ft)","custom-range",customWeapon.normalRange,"number",'min="5" placeholder="Melee"')}
    </div>` : ""}
    ${choice && choice.mode !== "potion" && !effect?.self && !effect?.teleport && !effect?.aid ? `<div class="play-field-row">
      ${field("Roll","roll-mode",[option("","Normal",!rollMode),option("advantage","Advantage",rollMode === "advantage"),option("disadvantage","Disadvantage",rollMode === "disadvantage")])}
      ${field("Cover","cover",[option("","None",!cover),option("2","Half (+2)",cover === "2"),option("5","Three-quarters (+5)",cover === "5"),option("full","Total",cover === "full")])}
    </div>` : ""}
    ${effect?.temporary && actor.tempHp ? '<label class="game-spell-note"><input id="keep-temp" type="checkbox"> Keep current temporary HP</label>' : ""}
    ${choice?.mode === "spell" && choice.data.note ? `<p class="game-spell-note">${escape(choice.data.note)}</p>` : ""}
    ${choice?.mode === "spell" && choice.data.reference ? `<button type="button" class="spell-link" data-action="spell" data-id="${escape(choice.data.reference)}">Spell rules</button>` : ""}
    ${choice && !choice.usable ? `<p class="play-hint">${choice.data?.prepared === false ? "This spell is unprepared." :
      "Resolve the effect at the table."}</p>` : ""}
    <div class="play-action-row">${choice?.usable || choice?.manual ? `<button class="button primary small" type="submit"
      ${choice.mode === "spell" && choice.data.level && !slotOptions.length ? "disabled" : ""}>${choice.mode === "spell" ? (choice.usable ? "Cast spell" : "Record manual cast") : choice.mode === "potion" ? "Use item" : "Roll attack"}</button>` : ""}
      ${!context.game ? moveActions : ""}
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
  return `<section class="play-panel token-panel">
    <div class="play-heading"><h2>${battle.round ? "Initiative" : "Tokens"}</h2>
      ${battle.round ? `<span class="tag">Round ${battle.round}</span>` : ""}
    </div>
    ${ordered.length ? `<div class="play-tokens">${ordered.map((entry, index) =>
      `<button type="button" class="play-token${entry.id === actor?.id ? " active-token" : ""}${entry.dead ? " defeated" : ""}"
        data-play="token" data-id="${escape(entry.id)}" aria-pressed="${entry.id === (battle.round ? targetId : selectedId)}">
        <span class="token-marker token-${entry.side}">${escape(entry.marker ?? entry.name.charAt(0).toUpperCase())}</span>
        <span><strong>${escape(entry.name)}</strong><small>${entry.hp} / ${entry.maxHp} HP · AC ${entry.ac}
          ${entry.side === "neutral" ? " · Neutral" : ""}${entry.tempHp ? " · +" + entry.tempHp + " temp" : ""}${entry.prone ? " · Prone" : ""}${entry.dead ? " · Defeated" : ""}</small></span>
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
      <div class="play-action-row"><button type="submit" class="button outline small">Save token</button>${actionButton("Remove token","remove-token")}</div>
    </form>` : ""}
    ${battle.round && actor ? `<div class="turn-info">
      <h3>${escape(actor.name)}’s turn</h3>
      <p>${moveLeft(battle,actor)} ft left · ${battle.action ? (battle.action === "attack" && battle.attacksMade < actor.swings ? (actor.swings-battle.attacksMade)+" attacks left" : "Action used") : "Action ready"} · ${battle.bonusUsed ? "Bonus action used" : "Bonus action ready"}</p>
      ${playOptions(actor)}
    </div>` : ""}
    <div class="play-action-row">
      ${battle.round ? actionButton("End turn","end",{primary:true,disabled:Boolean(battle.movement)}) : actionButton("Roll initiative","start",{primary:true,disabled:sceneJobs.has(battle) || battle.actors.filter((actor) => occupies(actor) && actor.side !== "neutral").length < 2})}
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
          <div class="board-frame">
            <canvas style="width:${zoom}%" id="play-grid" tabindex="0" role="application"
              aria-label="${escape(map.title)} grid. Use arrow keys to choose a square. Press Enter to use the selected tool."></canvas>
          </div>
          <div class="board-toolbar">
            ${field("Grid tool","grid-tool",tools.map(([id,label]) => option(id,label,tool===id)))}
            ${field("Zoom","grid-zoom",["100","150","200","300"].map((value) => option(value,value+"%",zoom===value)))}
            <div class="board-key"><span><i></i> Party</span><span><i></i> Hostile</span><span><i></i> Difficult terrain</span><span><i class="map-marker-key"></i> Room marker</span></div>
          </div>
          ${!isTraining ? `<p id="map-art-note" class="play-hint" role="status">${escape(artworkNote)}</p>` : ""}
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
  const board = element.querySelector(".board-frame");
  const scrollX = board?.scrollLeft ?? 0, scrollY = board?.scrollTop ?? 0;
  const archiveOpen = element.querySelector(".play-archive")?.open;
  element.innerHTML = context.game ? gameScreen({
    map,battle,selected:selectedActor(),party:battle.actors.filter((actor) => actor.side === "party"),
    category,actions:playOptions(selectedActor()), tacticalTools:tableTools(), room,status,artworkNote,
    zoom,logOpen,toolsOpen,destination:previewMessage,cursor,
    adventureName:context.adventures.find(({id}) => id === map.module)?.name,
  }) : playPage();
  if (archiveOpen && !hasArchive()) element.querySelector(".play-archive")?.setAttribute("open","");
  paintBoard();
  const frame = element.querySelector(".board-frame");
  if (context.game && centerBoard) {
    const actor = selectedActor();
    const canvas = frame.querySelector("canvas");
    if (actor && occupies(actor)) {
      const [x,y] = cellCenter(map,actor);
      frame.scrollTo(x/map.width*canvas.clientWidth-frame.clientWidth/2, y/map.height*canvas.clientHeight-frame.clientHeight/2);
    }
    centerBoard = false;
  } else frame.scrollTo(scrollX,scrollY);
  if (active) element.querySelector("#"+CSS.escape(active))?.focus({preventScroll:true});
}

function tableTools() {
  if (!toolsOpen) return "";
  return '<h2>Table tools</h2>' + field("Grid tool","grid-tool",[["move","Move token"],["room","Inspect room"],
    ["difficult","Difficult terrain"],["wall","Block square"],["clear","Clear terrain"]].map(([value,label]) => option(value,label,tool===value))) +
    (battle.round ? actionButton("End initiative","end-initiative",{disabled:Boolean(battle.movement)}) : "") +
    manualHP() + (tool==="room" ? roomPanel() : "");
}

function resetActionSelection() {
  combatChoice = ""; castSlot = ""; targetId = ""; spellSquare = null; extraTargets.clear();
  pathPreview = null; previewMessage = ""; pendingSquare = null;
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
  const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
  const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.key) : null;
  pathPreview = null;
  previewMessage = "";
  if (category === "spell" && (effect?.area || effect?.teleport)) {
    spellSquare = {x,y};
    return;
  }
  if (token && (!visibleTokens()?.has(token.id) || token.id === actor?.id && category === "move")) return;
  if (token) {
    if (!battle.round && token.side === "hostile") beginCombat(actor,token,false);
    else if (!battle.round && token.side === "party" && category === "move") {
      selectedId = token.id;
      detectNearby(token);
    } else targetId = token.id;
    return;
  }
  if (category !== "move") {
    status = "Choose a token as the target, or switch to Move.";
    return;
  }
  if (!actor) throw new Error("Choose a party member to move.");
  if (battle.round) moveToken(battle,actor,x,y,map);
  else exploreToken(battle,actor,x,y,map,detectNearby);
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
    for (const character of context.characters) {
      try {add(partyActor(character),entry);} catch (error) {log(battle,error.message);}
    }
  }
  if (!battle.actors.some((actor) => actor.side === "party")) {
    throw new Error("Import a character to start this adventure, or choose the practice yard.");
  }
  for (const actor of battle.actors.filter((entry) => entry.id.startsWith("party:"))) {
    const character = context.characters.find((entry) => "party:"+entry.id === actor.id);
    if (!character) continue;
    const imported = partyActor(character);
    actor.spells = imported.spells;
    actor.slots = {...imported.slots,...actor.slots};
  }
  const selected = battle.actors.find((actor) => actor.side === "party" && actor.id === selectedId && actorIsUp(actor)) ??
    battle.actors.find((actor) => actor.side === "party" && actorIsUp(actor));
  selectedId = selected?.id ?? "";
  category = "move"; tool = "move"; status = ""; resetActionSelection();
  if (!battle.round) battle.actors.filter((entry) => entry.side === "party").some(detectNearby);
  centerBoard = true;
  preferredGame = {module:moduleId,map:map.key};
  try {localStorage.setItem(activeMapKey,JSON.stringify(preferredGame));} catch {}
  saveBattle();
  location.hash = "game";
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
  const allowed = ({x,y}) => !taken.has(keyAt(x,y)) && battle.terrain[keyAt(x,y)] !== "wall";
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
  const {x,y} = freeCell(area);
  placeToken(battle,actor,x,y,map);
  actor.origin = areaKey(area);
  battle.actors.push(actor);
  selectedId = actor.id;
  tool = "move";
}

function checkCell(x,y,region) {
  if (x < 0 || x >= map.cols || y < 0 || y >= map.rows) return;
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
    } else if (selectedActor()) moveToken(battle, selectedActor(), x,y,map);
    else throw new Error("Select a token to place first.");
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

export function showPlay(data) {
  context = data;
  if (!battle) useMap(trainingMap);
  redraw();
  if (hasArchive() && lastAdventure !== context.activeAdventure) {
    lastAdventure = context.activeAdventure;
    const preferred = context.game ? preferredGame : null;
    selectModule(preferred?.module || context.activeAdventure || "LMoP", preferred?.map);
  }
}

document.addEventListener("wayfarer:archive", () => {
  if (root() && !pending) {
    const preferred = context.game ? preferredGame : null;
    lastAdventure = context.activeAdventure;
    selectModule(preferred?.module || context.activeAdventure || "LMoP",preferred?.map);
  }
});

async function interact(run) {
  try {
    status = "";
    await run();
    if (context.game && battle.round) {
      const heroes = battle.actors.filter((actor) => actor.side === "party");
      for (const enemy of battle.actors.filter((actor) => actor.side === "hostile" && !battle.order.includes(actor.id))) {
        if (heroes.some((hero) => noticesEnemy(battle,map,hero,enemy))) joinInitiative(battle,enemy);
      }
    }
    saveBattle();
  } catch (failure) {
    status = failure instanceof Error ? failure.message : "The action could not be completed.";
  }
  if (context.game && battle.round && !battle.movement &&
      !battle.actors.some((actor) => actor.side === "hostile" && battle.order.includes(actor.id) && actorIsUp(actor))) {
    endInitiative(battle);
    category = "move";
    resetActionSelection();
    status = "Encounter cleared. Free movement restored.";
    saveBattle();
  }
  redraw();
}

document.addEventListener("click", (event) => {
  if (!root()?.contains(event.target)) return;
  if (event.target.id === "play-grid") {
    const {x,y,region} = gridPosition(map,event.target,event);
    if (context.game && battle.round && category === "move" && tool === "move" && matchMedia("(pointer: coarse)").matches &&
        !battle.actors.some((actor) => occupies(actor) && actor.x === x && actor.y === y)) {
      pendingSquare = movePreview(x,y) ? {x,y,region} : null;
      redraw();
      return;
    }
    interact(() => checkCell(x,y,region));
    return;
  }
  const button = event.target.closest("[data-play]");
  if (!button || pending) return;
  const {play,id} = button.dataset;
  if (play === "archive-picker") {root().querySelector("#play-archive-file").click(); return;}
  if (play === "art") {root().querySelector("#play-art").click(); return;}
  if (play === "inspect-marker") {
    const marker = battle.markers?.find((entry) => entry.id === id);
    if (marker) document.dispatchEvent(new CustomEvent("wayfarer:marker",{detail:marker}));
    return;
  }
  if (play === "inspect") {
    const actor = battle.actors.find((entry) => entry.id === id);
    if (actor) document.dispatchEvent(new CustomEvent("wayfarer:inspect",{detail:structuredClone(actor)}));
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
        if (!battle.round && actorIsUp(actor)) {
          selectedId = id; tool = "move"; resetActionSelection(); detectNearby(actor);
        }
        break;
      }
      case "commit-move": {
        if (pendingSquare) {
          const {x,y,region} = pendingSquare;
          pendingSquare = null;
          checkCell(x,y,region);
        }
        break;
      }
      case "game-log": logOpen = !logOpen; toolsOpen = false; break;
      case "game-tools": toolsOpen = !toolsOpen; logOpen = false; if (!toolsOpen) tool="move"; break;
      case "zoom-in": zoom = String(Math.min(300,Number(zoom)+50)); centerBoard = true; break;
      case "zoom-out": zoom = String(Math.max(75,Number(zoom)-50)); centerBoard = true; break;
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
      case "start": startInitiative(battle); combatChoice = ""; targetId = ""; tool = "move"; break;
      case "end-initiative": endInitiative(battle); combatChoice = ""; targetId = ""; tool = "move"; break;
      case "end": endTurn(battle); resetActionSelection(); category = "move"; break;
      case "death": deathSave(battle,selectedActor()); break;
      case "pass-reaction": resolveOpportunity(battle,null); break;
      case "dash": case "dodge": case "disengage": case "bonus-disengage": case "stand": turnAction(battle,selectedActor(),play); break;
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
  if (!keys[event.key] && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  const initial = selectedActor();
  cursor ||= initial?.x != null ? {x:initial.x,y:initial.y} : {x:0,y:0};
  if (keys[event.key]) {
    const [dx,dy] = keys[event.key];
    cursor.x = Math.max(0,Math.min(map.cols-1,cursor.x+dx));
    cursor.y = Math.max(0,Math.min(map.rows-1,cursor.y+dy));
    if (context.game && battle.round && category === "move" && tool === "move") movePreview(cursor.x,cursor.y);
    else paintBoard();
    event.target.setAttribute("aria-label","Square " + (cursor.x+1) + ", " + (cursor.y+1));
  } else interact(() => checkCell(cursor.x,cursor.y,regionAt(map,...cellCenter(map,cursor))));
});

function movePreview(x,y) {
  const actor = selectedActor();
  if (!actor) return null;
  cursor = {x,y};
  const route = battle.round ? previewMovement(battle,actor,x,y,map) : null;
  pathPreview = route?.path.length ? [actor,...route.path] : null;
  previewMessage = battle.round
    ? route ? "Move " + route.cost + " ft · " + (moveLeft(battle,actor)-route.cost) + " ft remaining" : "Outside remaining movement or blocked."
    : "Click a square to move freely.";
  const line = root()?.querySelector("#game-move-preview");
  if (line) line.textContent = previewMessage;
  paintBoard();
  return route;
}

document.addEventListener("pointermove", (event) => {
  if (!context?.game || event.target.id !== "play-grid" || tool !== "move" || category !== "move") return;
  const {x,y} = gridPosition(map,event.target,event);
  if (cursor?.x !== x || cursor?.y !== y) movePreview(x,y);
});
window.addEventListener("resize", () => {if (context?.game && root()) paintBoard();});

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
    case "grid-zoom": zoom = value; break;
    case "room-creature": selectedCreature = Number(value); break;
    case "play-party": selectedParty = value; break;
    case "combat-choice": combatChoice = value; spellSquare = null; castSlot = ""; extraTargets.clear(); break;
    case "cast-slot": castSlot = value; return;
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
  interact(async () => {
    switch (event.target.id) {
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
      case "reaction-form": resolveOpportunity(battle,Number(value("reaction-attack"))); break;
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
        const choice = combatChoice === "" ? null : choices(actor)[Number(combatChoice)];
        const target = currentTarget();
        const effect = choice?.mode === "spell" && choice.usable ? supportedSpell(choice.data.key) : null;
        const options = {mode:rollMode,cover,square:spellSquare,map,
          keepTemp:event.target.querySelector("#keep-temp")?.checked,
          targets:Array.from({length:3},(_,index) => battle.actors.find((entry) => entry.id === extraTargets.get(index)))};
        if (!choice?.usable) {
          if (choice?.manual) {
            recordSpell(battle,actor,choice.data,Number(value("cast-slot")));
            status = battle.log.at(-1);
          }
          return;
        }
        if (!battle.round && (choice.mode === "weapon" || choice.mode === "custom" ||
          (choice.mode === "spell" && !effect?.exploration))) {
          const enemy = target?.side === "hostile" ? target : effect?.area && spellSquare
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
