import {escape, plural, signed, text} from "./format.mjs";
import {icon} from "./icons.mjs";
import {attachArchive, archiveName, formatEntries, hasArchive, mapImage, monsterRecord} from "./rules-library.mjs";
import {cellCenter, creatureActor, moduleMaps, partyActor, regionAt, regionCells, roomNotes, roomRoster, trainingActors, trainingMap} from "./encounters.mjs";
import {drawGrid, gridPosition, terrainAt} from "./grid-view.mjs";
import {
  applyDamage, castSpell, currentActor, deathSave, diceTerms, drinkPotion, endInitiative, endTurn, keyAt, makeActor, moveLeft,
  heal, log, moveToken, newBattle, occupies, opportunity, placeToken, resolveOpportunity, rollDice,
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
let artUrl;

function root() {return document.querySelector("#play-mount");}
function saveBattle() {
  battles[map.key] = battle;
  try {localStorage.setItem(saveKey, JSON.stringify(battles));} catch {
    status = "Browser storage is unavailable. This encounter will last until the page closes.";
  }
}

function showImage(blob, entry = map, announce = true) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    if (map !== entry || (!announce && art)) {URL.revokeObjectURL(url); return;}
    if (Math.abs(image.naturalWidth / image.naturalHeight / (map.width / map.height) - 1) > .03) {
      URL.revokeObjectURL(url);
      if (announce) {
        status = "This image does not match the map’s aspect ratio. Choose the image for this map variant.";
        redraw();
      }
      return;
    }
    if (artUrl) URL.revokeObjectURL(artUrl);
    art = image; artUrl = url; redraw();
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    if (announce) {status = "The map image could not be read."; redraw();}
  };
  image.src = url;
}

function useMap(entry) {
  if (artUrl) URL.revokeObjectURL(artUrl);
  map = entry;
  battle = battles[map.key] ?? newBattle();
  if (map.module === "training" && !battles[map.key]) battle.actors = trainingActors();
  art = null; artUrl = null; selectedId = ""; targetId = ""; combatChoice = ""; cursor = null;
  const initialRoom = map.module === "LMoP" && map.id === "1ab" ? "01b" : map.regions[0]?.id;
  room = map.regions.find(({id}) => id === initialRoom) ?? null;
  selectedCreature = 0; tool = "room"; status = ""; zoom = "100";
  mapImage(entry.asset).then((blob) => {
    if (blob && map === entry && !art) showImage(blob,entry,false);
  }).catch(() => {});
}

function currentTarget() {return battle.actors.find((actor) => actor.id === targetId && occupies(actor));}
function selectedActor() {return currentActor(battle) ?? battle.actors.find(({id}) => id === selectedId);}
function actionButton(label, action, options = {}) {
  return `<button class="button ${options.primary ? "primary" : "outline"} small"
    type="button" data-play="${action}" ${options.disabled ? " disabled" : ""}>${escape(label)}</button>`;
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
      mode:"spell", name:spell.name, data:spell, usable:spell.edition === "2014" && Boolean(supportedSpell(spell.key)),
    })),
    ...(actor.potions ?? []).map((potion) => ({mode:"potion",name:potion.name + " (" + potion.quantity + ")",data:potion,usable:potion.quantity > 0})),
    {mode:"custom",name:"Custom strike",usable:true},
  ];
}

function playOptions(actor) {
  if (!actor || !battle.round) return "";
  const reaction = opportunity(battle);
  if (reaction) return `<form id="reaction-form" class="play-form">
    <p>${escape(reaction.foe.name)} can make an opportunity attack before ${escape(reaction.actor.name)} leaves reach.</p>
    ${field("Opportunity attack","reaction-attack",reaction.attacks.map((attack,index) => option(index,attack.name)))}
    <div class="play-action-row"><button class="button primary small" type="submit">Roll reaction</button>${actionButton("Pass","pass-reaction")}</div>
  </form>`;
  if (actor.hp === 0) return actor.resolveDeath
    ? `<p>${actor.stable ? "Stable at 0 HP" : "Unconscious · " + actor.successes + " successes, " + actor.failures + " failures"}</p>
      ${actor.stable || battle.deathRolled ? "" : actionButton("Roll death save","death",{primary:true})}` : "";
  const list = choices(actor);
  const choice = combatChoice === "" ? null : list[Number(combatChoice)];
  const slotOptions = choice?.mode === "spell" && choice.data.level
    ? Object.entries(actor.slots).filter(([level, pool]) => Number(level) >= choice.data.level && pool.current > 0)
    : [];
  return `<form class="play-form" id="combat-form">
    ${field("Action","combat-choice",[option("","Choose a weapon, spell, or item",combatChoice === ""),
      ...list.map((entry,index) => option(String(index), entry.name + (entry.usable ? "" : " · manual"), combatChoice === String(index)))])}
    ${choice && choice.mode !== "potion" ? field("Target","target-select",[option("","Choose target",!targetId),
      ...battle.actors.filter(occupies).map((entry) => option(entry.id,entry.name,entry.id === targetId))]) : ""}
    ${choice?.mode === "spell" && choice.data.level ? field("Spell slot","cast-slot",slotOptions.length ?
      slotOptions.map(([level,pool]) => option(level, "Level " + level + " · " + pool.current + " left")) : [option("","No available slot")]) : ""}
    ${choice?.mode === "custom" ? `<div class="play-field-row">
      ${input("Attack bonus","custom-bonus",customWeapon.bonus,"number",'required step="1"')}
      ${input("Damage dice","custom-damage",customWeapon.damage,"text",'required placeholder="1d8+3"')}
      ${input("Reach (ft)","custom-reach",customWeapon.reach,"number",'min="5" placeholder="5"')}
      ${input("Ranged limit (ft)","custom-range",customWeapon.normalRange,"number",'min="5" placeholder="Melee"')}
    </div>` : ""}
    ${choice && choice.mode !== "potion" ? `<div class="play-field-row">
      ${field("Roll","roll-mode",[option("","Normal",!rollMode),option("advantage","Advantage",rollMode === "advantage"),option("disadvantage","Disadvantage",rollMode === "disadvantage")])}
      ${field("Cover","cover",[option("","None",!cover),option("2","Half (+2)",cover === "2"),option("5","Three-quarters (+5)",cover === "5"),option("full","Total",cover === "full")])}
    </div>` : ""}
    ${choice && !choice.usable ? '<p class="play-hint">Resolve this entry manually or use a custom strike for a weapon’s dice.</p>' : ""}
    <div class="play-action-row">${choice?.usable ? `<button class="button primary small" type="submit">${choice.mode === "spell" ? "Cast spell" : choice.mode === "potion" ? "Use item" : "Roll attack"}</button>` : ""}
      ${["dash","dodge","disengage"].map((act) => actionButton(act.charAt(0).toUpperCase()+act.slice(1),act,{disabled:Boolean(battle.action)})).join("")}
      ${actor.nimbleEscape ? actionButton("Disengage (bonus)","bonus-disengage",{disabled:battle.bonusUsed}) : ""}
      ${actor.prone ? actionButton("Stand up","stand") : ""}
    </div>
  </form>`;
}

function setupControls() {
  if (battle.round) return "";
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

function roomPanel() {
  const roster = room ? roomRoster(map,room) : [];
  const authored = map.module === "LMoP" && map.id === "1ab";
  const loaded = battle.actors.some((actor) => actor.origin === room?.id && actor.side === "hostile" && !actor.dead);
  return `<section class="play-panel">
    <h2>Room</h2>
    ${map.regions.length ? field("Map area","play-room",[option("","Choose a room",!room),
      ...map.regions.map((region) => option(region.id, region.entry?.name ?? region.id,region.id === room?.id))]) :
      '<p>The archive has no tagged rooms for this map.</p>'}
    ${room ? `<div class="room-body">
       ${roomNotes[room.id] && authored ? `<p class="play-hint">${roomNotes[room.id]}</p>` : ""}
       ${roster.length ? `<p>${authored ? "Initial encounter" : "Creature references"} · ${roster.map(({name, count, nickname}) =>
         escape(nickname ?? (authored ? count + " × " + name : name))).join(", ")}</p>
         ${!battle.round ? (authored ? actionButton(loaded ? "Encounter loaded" : "Load room encounter","populate",{disabled:loaded,primary:!loaded}) :
           `<div class="play-inline">${field("Creature","room-creature",roster.map((entry,index) => option(index,entry.name,index === selectedCreature)))}
           ${actionButton("Add token","add-room-monster")}</div>`) : ""}` :
         room.entry && map.module !== "training" ? '<p>No starting enemies are listed for this area.</p>' : ""}
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
          ${entry.tempHp ? " · +" + entry.tempHp + " temp" : ""}${entry.prone ? " · Prone" : ""}${entry.dead ? " · Defeated" : ""}</small></span>
        ${battle.round ? `<span class="initiative-value" title="Initiative">${entry.initiativeRoll ?? index + 1}</span>` : ""}
      </button>`).join("")}</div>` : '<p>Add a party member or load a room encounter.</p>'}
    ${setupControls()}
    ${actor && !battle.round ? `<form class="token-settings" id="token-settings">
      <div class="play-field-row">
        ${input("Attacks per Attack action","actor-swings",actor.swings,"number",'min="1" max="8" required')}
        ${input("Current HP","actor-hp",actor.hp,"number",'min="0" max="'+actor.maxHp+'" required')}
      </div>
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
      ${battle.round ? actionButton("End turn","end",{primary:true,disabled:Boolean(battle.movement)}) : actionButton("Roll initiative","start",{primary:true,disabled:battle.actors.filter(occupies).length < 2})}
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
  return `<header class="play-header"><div><h1>Encounter grid</h1><p>5-foot squares · 2014 rules</p></div></header>
    ${archivePanel()}
    <div class="play-layout">
      <div class="play-main">
        <section class="play-panel play-board-panel">
          <div class="play-map-select">
            ${field("Adventure","play-module",moduleOptions)}
            ${!isTraining ? field("Map","play-map",maps.map((entry) => option(entry.key,entry.title,map.key===entry.key))) : ""}
          </div>
          <div class="play-heading board-title"><h2>${escape(map.title)}</h2>
            ${!isTraining ? actionButton(art ? "Change map image" : "Add map image","art") : ""}
          </div>
          <input type="file" id="play-art" accept="image/png,image/jpeg,image/webp" hidden>
          <div class="board-frame">
            <canvas style="width:${zoom}%" id="play-grid" tabindex="0" role="application"
              aria-label="${escape(map.title)} grid. Use arrow keys to choose a square. Press Enter to use the selected tool."></canvas>
          </div>
          <div class="board-toolbar">
            ${field("Grid tool","grid-tool",tools.map(([id,label]) => option(id,label,tool===id)))}
            ${field("Zoom","grid-zoom",["100","150","200","300"].map((value) => option(value,value+"%",zoom===value)))}
            <div class="board-key"><span><i></i> Party</span><span><i></i> Hostile</span><span><i></i> Difficult terrain</span></div>
          </div>
          ${!isTraining && !art ? '<p class="play-hint">The schematic marks sourced room areas. Attach the matching map image and mark obstacles to enforce movement boundaries.</p>' : ""}
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
  element.innerHTML = playPage();
  if (archiveOpen && !hasArchive()) element.querySelector(".play-archive").open = true;
  const current = currentActor(battle);
  drawGrid(element.querySelector("#play-grid"),map,battle,{room,selected:current?.id ?? selectedId,target:targetId,cursor,art});
  element.querySelector(".board-frame").scrollTo(scrollX,scrollY);
  if (active) element.querySelector("#"+CSS.escape(active))?.focus({preventScroll:true});
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
  actor.origin = area?.id;
  battle.actors.push(actor);
  selectedId = actor.id;
  tool = "move";
}

function checkCell(x,y,region) {
  if (x < 0 || x >= map.cols || y < 0 || y >= map.rows) return;
  cursor = {x,y};
  if (tool === "room") return selectRoom(region);
  const token = battle.actors.find((actor) => occupies(actor) && actor.x === x && actor.y === y);
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
    selectModule(context.activeAdventure || "LMoP");
  }
}

document.addEventListener("wayfarer:archive", () => {
  if (root() && !pending) selectModule(context.activeAdventure || "LMoP");
});

async function interact(run) {
  try {
    status = "";
    await run();
    saveBattle();
  } catch (failure) {
    status = failure instanceof Error ? failure.message : "The action could not be completed.";
  }
  redraw();
}

document.addEventListener("click", (event) => {
  if (!root()?.contains(event.target)) return;
  if (event.target.id === "play-grid") {
    const {x,y,region} = gridPosition(map,event.target,event);
    interact(() => checkCell(x,y,region));
    return;
  }
  const button = event.target.closest("[data-play]");
  if (!button || pending) return;
  const {play,id} = button.dataset;
  if (play === "archive-picker") {root().querySelector("#play-archive-file").click(); return;}
  if (play === "art") {root().querySelector("#play-art").click(); return;}
  interact(async () => {
    switch (play) {
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
      case "populate":
      case "add-room-monster": {
        if (battle.round || !room) return;
        const roster = roomRoster(map,room);
        const records = play === "populate" ? roster : [roster[selectedCreature]].filter(Boolean);
        const creatures = (await Promise.all(records.map(async (record) => {
          const base = await creatureActor(record);
          return Array.from({length:record.count}, (_, index) => makeActor({
            ...structuredClone(base), id:undefined,
            marker:record.count > 1 ? String(index+1) : undefined,
            name:record.count > 1 ? base.name+" "+(index+1) : base.name,
          }));
        }))).flat();
        creatures.forEach((creature) => add(creature));
        tool = "room";
        status = plural(creatures.length,"token") + " placed.";
        break;
      }
      case "remove-token":
        if (!battle.round) battle.actors = battle.actors.filter((actor) => actor.id !== selectedId);
        selectedId = "";
        break;
      case "start": startInitiative(battle); combatChoice = ""; targetId = ""; tool = "move"; break;
      case "end-initiative": endInitiative(battle); combatChoice = ""; targetId = ""; tool = "move"; break;
      case "end": endTurn(battle); combatChoice = ""; targetId = ""; break;
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
    drawGrid(event.target,map,battle,{room,selected:currentActor(battle)?.id ?? selectedId,target:targetId,cursor,art});
    event.target.setAttribute("aria-label","Square " + (cursor.x+1) + ", " + (cursor.y+1));
  } else interact(() => checkCell(cursor.x,cursor.y,regionAt(map,...cellCenter(map,cursor))));
});

document.addEventListener("change", (event) => {
  if (!root()?.contains(event.target)) return;
  const {id,value} = event.target;
  switch (id) {
    case "play-archive-file": loadFile(event.target.files[0], event.target.files[0]?.name); return;
    case "play-module": selectModule(value); return;
    case "play-map": {const entry = maps.find(({key}) => key===value); if (entry) useMap(entry); break;}
    case "play-room": selectRoom(map.regions.find((region) => region.id === value)); tool = "room"; break;
    case "grid-tool": tool = value; break;
    case "grid-zoom": zoom = value; break;
    case "room-creature": selectedCreature = Number(value); break;
    case "play-party": selectedParty = value; break;
    case "combat-choice": combatChoice = value; break;
    case "target-select": targetId = value; break;
    case "roll-mode": rollMode = value; break;
    case "cover": cover = value; break;
    case "play-art": {
      const file = event.target.files[0];
      if (file) showImage(file);
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
        const options = {mode:rollMode,cover};
        if (!choice?.usable) return;
        if (choice.mode === "spell") castSpell(battle,actor,target,choice.data,Number(value("cast-slot")),options);
        else if (choice.mode === "potion") drinkPotion(battle,actor,choice.data);
        else {
          const weapon = choice.mode === "weapon" ? choice.data : {
            name:"Custom strike", bonus:value("custom-bonus") === "" ? null : Number(value("custom-bonus")),
            damage:value("custom-damage"), normalRange:Number(value("custom-range")) || undefined,
            reach:Number(value("custom-reach")) || 5,
          };
          rollStrike(battle,actor,target,weapon,options);
        }
        break;
      }
    }
  });
});
